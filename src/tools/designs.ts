import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CleverenceLabelApi, DesignDetail } from '../lib/api.js';

/** One line about the design's label script, or null when it has none. */
function scriptLine(d: DesignDetail): string | null {
  const src = d.scriptsSource;
  if (src?.inherited && src.unavailable) {
    return `Label script: none (it followed "${src.designName}", which is no longer available)`;
  }
  const s = d.scripts;
  if (!s) return null;
  const kinds = [s.generate ? 'generator' : null, s.station ? 'scan station' : null].filter(Boolean).join(' + ');
  const title = typeof s.title === 'string' ? `"${s.title}"` : 'untitled';
  const from = src?.inherited ? `, inherited read-only from "${src.designName}" (${src.designId})` : '';
  return `Label script: ${title} (${kinds || 'no event'})${from}`;
}

/** The design's data field names, comma-separated, or null when it has none. */
function fieldNames(d: DesignDetail): string | null {
  const names = (d.dataFields ?? [])
    .map((f) => (f && typeof f === 'object' ? (f as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  return names.length > 0 ? names.join(', ') : null;
}

export function addDesignTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'list_designs',
    {
      title: 'List Designs',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'List all label designs owned by the authenticated user. Returns id, name, dimensions, and thumbnail URL for each.',
      inputSchema: {
        includeDeleted: z
          .boolean()
          .optional()
          .describe('Include soft-deleted designs (default false)'),
      },
    },
    async ({ includeDeleted }) => {
      const designs = await api.listDesigns(includeDeleted ?? false);
      if (designs.length === 0) {
        return { content: [{ type: 'text', text: 'No designs found.' }] };
      }
      const lines = designs.map(
        (d) =>
          `• ${d.name} (${d.width}×${d.height}mm)` +
          `\n  ID: ${d.id}` +
          `\n  Public: ${d.isPublic} | Updated: ${d.updatedAt}` +
          `\n  Thumbnail: ${d.thumbnailUrl}`,
      );
      return {
        content: [
          { type: 'text', text: `Found ${designs.length} design(s):\n\n${lines.join('\n\n')}` },
        ],
      };
    },
  );

  server.registerTool(
    'create_design',
    {
      title: 'Create Design',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description:
        'Create an empty label design, or one based on a gallery template. To save design content you authored yourself, use create_design_from_json instead — it validates the content first. Returns the design ID and URLs for the designer, viewer, and thumbnail.',
      inputSchema: {
        name: z.string().describe('Name for the new design'),
        templateId: z
          .string()
          .optional()
          .describe('Gallery template ID to start from (e.g. "itf14-case-code"). Call list_templates for current ids.'),
        width: z.number().optional().describe('Width in mm (default 101.6)'),
        height: z.number().optional().describe('Height in mm (default 50.8)'),
        isPublic: z.boolean().optional().describe('Whether the design is publicly viewable (default true)'),
        description: z.string().optional().describe('Description of the design'),
      },
    },
    async ({ name, templateId, width, height, isPublic, description }) => {
      const design = await api.createDesign({
        name,
        templateId,
        width,
        height,
        isPublic,
        description,
      });
      return {
        content: [
          {
            type: 'text',
            text: [
              `Design created: ${design.name}`,
              `ID: ${design.id}`,
              `Size: ${design.width}×${design.height}mm`,
              templateId ? `Template: ${templateId}` : null,
              `Designer URL: ${design.designerUrl}`,
              `Viewer URL: ${design.viewerUrl}`,
              `Thumbnail: ${design.thumbnailUrl}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_design',
    {
      title: 'Get Design',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Get full details of a label design including elements, dimensions, data fields, and URLs.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
      },
    },
    async ({ id }) => {
      const d = await api.getDesign(id);
      return {
        content: [
          {
            type: 'text',
            text: [
              `Name: ${d.name}`,
              `Author: ${d.author}`,
              `Size: ${d.width}×${d.height}mm`,
              `Public: ${d.isPublic} | Owner: ${d.isOwner}`,
              `Elements: ${d.elements.length}`,
              `Data fields: ${(d.dataFields ?? []).length}`,
              fieldNames(d) ? `Field names (the keys of values in print_to_printer): ${fieldNames(d)}` : null,
              scriptLine(d),
              `Designer: ${d.designerUrl}`,
              `Viewer: ${d.viewerUrl}`,
              `Thumbnail: ${d.thumbnailUrl}`,
              `Created: ${d.createdAt} | Updated: ${d.updatedAt}`,
              d.description ? `Description: ${d.description}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'update_design',
    {
      title: 'Update Design',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Update metadata of an existing label design (name, description, visibility, folder). To change the elements or data fields, use update_design_content.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
        name: z.string().optional().describe('New name'),
        description: z.string().optional().describe('New description'),
        isPublic: z.boolean().optional().describe('Set public visibility'),
        folder: z.string().optional().describe('Move to folder'),
      },
    },
    async ({ id, name, description, isPublic, folder }) => {
      await api.updateDesign(id, { name, description, isPublic, folder });
      return { content: [{ type: 'text', text: `Design ${id} updated.` }] };
    },
  );

  server.registerTool(
    'delete_design',
    {
      title: 'Delete Design',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description:
        'Soft-delete a label design. The design can still be listed with includeDeleted=true. Before using this tool, confirm with the user that they want to delete the design.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
      },
    },
    async ({ id }) => {
      await api.deleteDesign(id);
      return { content: [{ type: 'text', text: `Design ${id} deleted.` }] };
    },
  );
}
