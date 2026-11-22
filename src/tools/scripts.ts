import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CleverenceLabelApi, ScriptPreviewInput } from '../lib/api.js';
import { formatPreviewRows, formatScans, withApiErrors } from '../lib/format.js';

/**
 * Tools for label scripts (CLS/1): the reference, and dry runs of a script
 * through POST /api/v1/scripts/preview.
 *
 * A dry run saves nothing, prints nothing and is unmetered on every plan. It
 * runs in a sandbox on the server with seeded uid()/uuid(), so the same call
 * gives the same codes.
 */

const SOURCE_SHAPE = {
  design: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'A whole design (name, width, height, elements, dataFields, scripts) to run, e.g. the one you just validated. Send this or designId.',
    ),
  designId: z
    .string()
    .optional()
    .describe(
      'A saved design to run instead: you see what its reader sees (a linked copy runs its original\'s published script).',
    ),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Form values by param name; omitted params take their defaults. A layout param is { zones: [{ zone, levels: { <level>: "<range spec>" } }] }.',
    ),
  tables: z
    .record(z.string(), z.array(z.record(z.string(), z.unknown())))
    .optional()
    .describe(
      'Stand-ins for the spreadsheets the operator would load: table name → rows as { column: value } (at most 200 rows each).',
    ),
  seed: z.string().optional().describe('Seed for uid()/uuid(); the same seed gives the same codes.'),
  clock: z
    .string()
    .optional()
    .describe('ISO date-time for today()/now(), e.g. 2026-10-03T14:05:00Z (default: now, UTC).'),
};

type SourceArgs = { design?: Record<string, unknown>; designId?: string };

/** Exactly one of design and designId, checked here so the agent gets the reason without a round trip. */
function sourceProblem({ design, designId }: SourceArgs) {
  if ((design === undefined) === (designId === undefined)) {
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: 'Send exactly one of design (a design with a scripts block) or designId.' }],
    };
  }
  return null;
}

export function addScriptTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'get_script_reference',
    {
      title: 'Get Label Script Reference',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'The label script (CLS/1) skill and the builtin function reference, as Markdown. Read before writing a scripts block: it covers the block shape, the expression language, range specs, five complete examples, common mistakes and the validate → preview → save loop.',
      inputSchema: {},
    },
    async () => {
      const [skill, builtins] = await Promise.all([api.getSkill('label-scripts'), api.getSkill('label-scripts-builtins')]);
      return {
        content: [
          { type: 'text', text: skill },
          { type: 'text', text: builtins },
        ],
      };
    },
  );

  server.registerTool(
    'preview_script_rows',
    {
      title: 'Preview Script Rows',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Dry-run a label script\'s generator: the labels its form would make, as a Markdown table of the first rows, with the count, the script\'s warnings, quality checks (duplicate and empty barcode values, values that look like web addresses) and step stats. Static errors come back as path:col CODE message (hint) with a caret; a runtime error shows the row being built and the bindings. Saves and prints nothing; free on every plan. Run validate_design first, then this, then save with update_design_content or create_design_from_json.',
      inputSchema: {
        ...SOURCE_SHAPE,
        limit: z.number().int().min(1).max(50).optional().describe('Rows to show, 1..50 (default 20).'),
      },
    },
    async ({ design, designId, params, tables, limit, seed, clock }) => {
      const problem = sourceProblem({ design, designId });
      if (problem) return problem;
      const input: ScriptPreviewInput = { event: 'generate' };
      if (design !== undefined) input.design = design;
      if (designId !== undefined) input.designId = designId;
      if (params !== undefined) input.params = params;
      if (tables !== undefined) input.tables = tables;
      if (limit !== undefined) input.limit = limit;
      if (seed !== undefined) input.seed = seed;
      if (clock !== undefined) input.clock = clock;
      return withApiErrors(async () => {
        const result = await api.previewScript(input);
        return { content: [{ type: 'text' as const, text: formatPreviewRows(result, design) }] };
      }, design);
    },
  );

  server.registerTool(
    'simulate_scans',
    {
      title: 'Simulate Scans',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Dry-run a label script\'s scan station with up to 20 barcodes, in order, carrying kept values (kept.<name>) and the scan count from scan to scan. One line per scan: applied (route, the fields it sets, kept values, copies to print, warnings), rejected (route and message) or unmatched. Saves and prints nothing; free on every plan.',
      inputSchema: {
        ...SOURCE_SHAPE,
        scans: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('The barcodes to scan, in order, as a scanner would type them (e.g. ["PO777", "4006381333931"]).'),
        base: z
          .record(z.string(), z.string())
          .optional()
          .describe('Field values before any scan (default: the fields\' sample values).'),
      },
    },
    async ({ design, designId, scans, params, tables, base, seed, clock }) => {
      const problem = sourceProblem({ design, designId });
      if (problem) return problem;
      const input: ScriptPreviewInput = { event: 'scan', scans };
      if (design !== undefined) input.design = design;
      if (designId !== undefined) input.designId = designId;
      if (params !== undefined) input.params = params;
      if (tables !== undefined) input.tables = tables;
      if (base !== undefined) input.base = base;
      if (seed !== undefined) input.seed = seed;
      if (clock !== undefined) input.clock = clock;
      return withApiErrors(async () => {
        const result = await api.previewScript(input);
        return { content: [{ type: 'text' as const, text: formatScans(result, design) }] };
      }, design);
    },
  );
}
