import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CleverenceLabelApi } from '../lib/api.js';

/**
 * Fetches the gallery live rather than shipping a copy. The previous hardcoded
 * table listed twelve templates whose ids no longer existed, so every agent
 * that trusted it got TEMPLATE_NOT_FOUND.
 */
export function addTemplatesResource(server: McpServer, api: CleverenceLabelApi) {
  server.registerResource(
    'templates',
    'cleverence://templates',
    {
      title: 'Gallery Templates',
      description: 'Pre-built label templates available in Cleverence Label',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      let body: string;

      try {
        const templates = await api.listTemplates();
        const rows = templates.map(
          (t) =>
            `| \`${t.id}\` | ${t.name} | ${t.width} × ${t.height} mm | ${t.category} | ${t.elementCount} |`,
        );
        body = [
          '# Cleverence Label Gallery Templates',
          '',
          '| ID | Name | Size | Category | Elements |',
          '|----|------|------|----------|----------|',
          ...rows,
          '',
          'Pass an ID as `templateId` to create_design.',
          'If none of these fit, author the design yourself: read the',
          'cleverence://skills/design-a-label resource, then use validate_design',
          'and create_design_from_json. That path uses no AI generation quota.',
        ].join('\n');
      } catch (error) {
        body = [
          '# Cleverence Label Gallery Templates',
          '',
          `Could not load the gallery: ${error instanceof Error ? error.message : String(error)}`,
          '',
          'Call the list_templates tool to retry.',
        ].join('\n');
      }

      return { contents: [{ uri: uri.href, text: body }] };
    },
  );
}
