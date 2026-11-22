import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CleverenceLabelApi } from '../lib/api.js';

export function addTemplateTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'list_templates',
    {
      title: 'List Templates',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'List all available gallery templates. Templates are pre-built label designs you can use as a starting point when creating a new design with create_design.',
      inputSchema: {},
    },
    async () => {
      const templates = await api.listTemplates();
      if (templates.length === 0) {
        return { content: [{ type: 'text', text: 'No templates available.' }] };
      }
      const lines = templates.map(
        (t) =>
          `• ${t.name} [${t.id}]` +
          `\n  ${t.description}` +
          `\n  Size: ${t.width}×${t.height}mm | Category: ${t.category}` +
          `\n  Elements: ${t.elementCount} | Data fields: ${t.dataFields.length}` +
          `\n  Thumbnail: ${t.thumbnailUrl}`,
      );
      return {
        content: [
          { type: 'text', text: `${templates.length} template(s) available:\n\n${lines.join('\n\n')}` },
        ],
      };
    },
  );

  server.registerTool(
    'get_snippets',
    {
      title: 'Get Integration Snippets',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Get ready-to-use code snippets for integrating Cleverence Label into a web app: iframe embed, thumbnail image tag, direct links, and a server-side proxy example for Next.js.',
      inputSchema: {},
    },
    async () => {
      const snippets = await api.getSnippets();
      return {
        content: [
          { type: 'text', text: '## iframe embed\n\n' + snippets.iframe },
          { type: 'text', text: '## Thumbnail image\n\n' + snippets.thumbnail },
          {
            type: 'text',
            text: [
              '## Direct links',
              `Designer: ${snippets.links.designer}`,
              `Viewer: ${snippets.links.viewer}`,
              `Embed: ${snippets.links.embed}`,
              `Thumbnail: ${snippets.links.thumbnail}`,
            ].join('\n'),
          },
          { type: 'text', text: '## Server-side proxy (Next.js)\n\n' + snippets.serverProxy },
        ],
      };
    },
  );
}
