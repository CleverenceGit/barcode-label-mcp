import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CleverenceLabelApi, ValidationIssue, ValidationResult } from '../lib/api.js';
import { formatLocated, formatScriptReport, withApiErrors } from '../lib/format.js';

/**
 * Tools for designs the agent writes itself.
 *
 * The agent already has the context and spends its own tokens, so authoring
 * costs Cleverence nothing beyond CPU. These tools are therefore unmetered and
 * work on every plan — unlike the in-app AI chat, which Cleverence pays for.
 */

const DESIGN_SHAPE = {
  name: z.string().describe('Label name'),
  width: z.number().describe('Label width in mm (e.g. 101.6 for 4in)'),
  height: z.number().describe('Label height in mm (e.g. 152.4 for 6in)'),
  elements: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      'Design elements. Each needs id, type (text|variable|barcode-1d|barcode-2d|line|rectangle|circle|image), x, y, width, height — all in mm from the top-left origin. Call get_design_schema or read the design-a-label skill for the full contract.',
    ),
  dataFields: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      'Data fields with id, name, type and sampleValue. Variable elements bind to these by name via dataFieldName.',
    ),
  $schema: z
    .string()
    .optional()
    .describe(
      'Schema id. Use "https://label.cleverence.com/schema/label-design.v2.json" (or omit) when sending scripts; a v1 id with scripts is refused.',
    ),
  scripts: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional label script (CLS/1): a generator form (generate) that makes label rows, or a scan station (station). JSON with one-line expression cells, not code. Read cleverence://skills/label-scripts (or call get_script_reference) before writing one; check it with validate_design and preview_script_rows or simulate_scans. Saving a new or changed script needs Professional or higher; running it is free.',
    ),
};

/** One issue: script issues as `path:col CODE message (hint)` with a caret under the column; others as before. */
function issueLines(issue: ValidationIssue, source: unknown): string[] {
  if (issue.code || issue.path) return formatLocated(issue, source);
  const mark = issue.severity === 'warning' ? '!' : '✗';
  return [`  ${mark} ${issue.element ? `[${issue.element}] ` : ''}${issue.message}`];
}

/**
 * The validate answer as text. `source` is the design the issue paths point
 * into, for the caret under a script cell; it defaults to the returned design,
 * which carries the script byte-identical (scripts are never auto-fixed).
 */
export function formatValidation(result: ValidationResult, source: unknown = result.design): string {
  const lines: string[] = [];

  lines.push(
    result.valid
      ? `Valid — ${result.summary.elementCount} elements, ${result.summary.dataFieldCount} data fields, ${result.summary.width}×${result.summary.height}mm`
      : `${result.errorCount} error(s) remain after auto-fix.`,
  );

  if (result.fixed.length > 0) {
    lines.push('', `Fixed automatically (${result.fixed.length}):`);
    result.fixed.forEach((f) => lines.push(`  • ${f}`));
  }

  const errors = result.issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    lines.push('', 'Errors you must fix:');
    errors.forEach((i) => lines.push(...issueLines(i, source)));
  }

  const warnings = result.issues.filter((i) => i.severity === 'warning');
  if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    warnings.forEach((i) => lines.push(...issueLines(i, source)));
  }

  if (result.scriptReport) {
    lines.push('', ...formatScriptReport(result.scriptReport));
  }

  return lines.join('\n');
}

export function addAuthoringTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'get_design_schema',
    {
      title: 'Get Design Schema',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Fetch the JSON Schema for a Cleverence Label design. Read this before authoring design JSON by hand so element and data-field shapes are correct.',
      inputSchema: {},
    },
    async () => {
      const schema = await api.getDesignSchema();
      return { content: [{ type: 'text', text: schema }] };
    },
  );

  server.registerTool(
    'validate_design',
    {
      title: 'Validate Design',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Check a label design you authored and get it back repaired. Recomputes UPC/EAN/ITF-14 check digits, test-renders every barcode to confirm a scanner could read it, clamps out-of-bounds elements, and reconciles data fields with the dataFieldName the elements use. Reports what it fixed, and separately the problems it could not fix. Nothing is saved and no AI runs, so this is free on every plan. Always run this before saving, and save the returned design rather than your original.',
      inputSchema: {
        ...DESIGN_SHAPE,
        renderCheck: z
          .boolean()
          .optional()
          .describe('Test-render every barcode (default true). Set false for a faster check.'),
      },
    },
    async ({ renderCheck, ...design }) =>
      withApiErrors(async () => {
        const result = await api.validateDesign(design, renderCheck ?? true);
        return {
          content: [
            { type: 'text' as const, text: formatValidation(result) },
            {
              type: 'text' as const,
              text: `\nCorrected design (save this):\n${JSON.stringify(result.design, null, 2)}`,
            },
          ],
        };
      }, design),
  );

  server.registerTool(
    'create_design_from_json',
    {
      title: 'Create Design from JSON',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description:
        'Save a label design you authored yourself. The content is validated and auto-fixed before storage, and the corrections are reported back. Uses no AI generation quota. Returns the design id plus designer, viewer and thumbnail URLs. A design with a label script (scripts) needs Professional or higher; a script with errors is refused with its diagnostics.',
      inputSchema: {
        ...DESIGN_SHAPE,
        description: z.string().optional().describe('Description of the design'),
        isPublic: z
          .boolean()
          .optional()
          .describe('Whether the design is publicly viewable (default true)'),
        strict: z
          .boolean()
          .optional()
          .describe('Refuse to save if errors remain after auto-fix (default false)'),
      },
    },
    async ({ description, isPublic, strict, ...design }) =>
      withApiErrors(async () => {
        if (strict) {
          const check = await api.validateDesign(design);
          if (!check.valid) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Not saved — strict mode and the design still has errors.\n\n${formatValidation(check)}`,
                },
              ],
            };
          }
        }

        const created = await api.createDesign({ ...design, description, isPublic });

        const lines = [
          `Design created: ${created.name}`,
          `ID: ${created.id}`,
          `Size: ${created.width}×${created.height}mm`,
          created.elementCount !== undefined ? `Elements: ${created.elementCount}` : null,
          `Designer URL: ${created.designerUrl}`,
          `Viewer URL: ${created.viewerUrl}`,
          `Thumbnail: ${created.thumbnailUrl}`,
        ].filter(Boolean) as string[];

        if (created.validation?.fixed.length) {
          lines.push('', `Auto-fixed ${created.validation.fixed.length} issue(s):`);
          created.validation.fixed.forEach((f) => lines.push(`  • ${f}`));
        }

        const remaining = created.validation?.issues.filter((i) => i.severity === 'error') ?? [];
        if (remaining.length > 0) {
          lines.push('', 'Errors still present — fix and call update_design_content:');
          remaining.forEach((i) => lines.push(...issueLines(i, design)));
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }, design),
  );

  server.registerTool(
    'update_design_content',
    {
      title: 'Update Design Content',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description:
        'Replace the elements, data fields and/or label script of an existing design. Content is validated and auto-fixed (scripts are checked, never changed), then saved as a new version so the user keeps history and can revert. Uses no AI generation quota. Adding or changing a script needs Professional or higher; removing one (scripts: null) works on every plan; a linked copy cannot change the script it inherits.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
        elements: DESIGN_SHAPE.elements.optional().describe(
          'Design elements (see create_design_from_json). Required whenever dataFields is sent. Omit both elements and dataFields to change only the script and keep the content as stored.',
        ),
        dataFields: DESIGN_SHAPE.dataFields.describe(
          'Data fields (see create_design_from_json). Send them together with elements: a content update replaces both.',
        ),
        $schema: DESIGN_SHAPE.$schema,
        scripts: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional()
          .describe(
            'Label script (CLS/1). Omit to keep the stored script, null to remove it. See cleverence://skills/label-scripts.',
          ),
        name: z.string().optional().describe('Rename the design at the same time'),
        message: z
          .string()
          .optional()
          .describe('Version history message, e.g. "Widened the tracking barcode"'),
      },
    },
    async ({ id, elements, dataFields, $schema, scripts, name, message }) =>
      withApiErrors(async () => {
        if (dataFields !== undefined && elements === undefined) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Send elements together with dataFields: a content update replaces both, so dataFields alone would leave the label with no elements. Fetch the design (get_design), then send its elements with the new dataFields. To change only the script, omit both.',
              },
            ],
            isError: true,
          };
        }
        const updated = await api.updateDesign(id, { elements, dataFields, $schema, scripts, name, message });

        const lines = [
          `Design ${id} updated.`,
          updated.versionId ? `New version: ${updated.versionId}` : null,
          `Viewer URL: ${updated.viewerUrl}`,
        ].filter(Boolean) as string[];

        if (updated.validation?.fixed.length) {
          lines.push('', `Auto-fixed ${updated.validation.fixed.length} issue(s):`);
          updated.validation.fixed.forEach((f) => lines.push(`  • ${f}`));
        }

        const remaining = updated.validation?.issues.filter((i) => i.severity === 'error') ?? [];
        if (remaining.length > 0) {
          lines.push('', 'Errors still present:');
          remaining.forEach((i) => lines.push(...issueLines(i, { elements, dataFields, scripts })));
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }, { elements, dataFields, scripts }),
  );
}
