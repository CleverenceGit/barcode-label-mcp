import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CleverenceLabelApi } from '../lib/api.js';

export function addEmbedTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'get_embed_code',
    {
      title: 'Get Embed Code',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Get ready-to-paste HTML code for embedding a label design. Returns either an iframe snippet or a standalone HTML snippet.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
        format: z
          .enum(['iframe', 'html'])
          .optional()
          .describe('Embed format: "iframe" (default) or "html"'),
        width: z.number().optional().describe('Width in pixels (default 360)'),
      },
    },
    async ({ id, format, width }) => {
      const embed = await api.getEmbedCode(id, format ?? 'iframe', width ?? 360);
      return {
        content: [
          { type: 'text', text: `Embed code (${embed.format}):\n\n${embed.code}` },
        ],
      };
    },
  );

  server.registerTool(
    'get_thumbnail',
    {
      title: 'Get Thumbnail URL',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Get the SVG thumbnail URL for a label design. Use this URL in an <img> tag to show a preview.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
      },
    },
    async ({ id }) => {
      const url = await api.getThumbnailUrl(id);
      return {
        content: [
          { type: 'text', text: `Thumbnail URL: ${url}` },
          { type: 'text', text: `HTML:\n<img src="${url}" alt="Label preview" style="max-width:100%;height:auto" />` },
        ],
      };
    },
  );

  server.registerTool(
    'render_design',
    {
      title: 'Render Design',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Render a label design to PDF, PNG, SVG, or HTML. Returns a URL that can be fetched to download the rendered file. Unlike authoring and validation, a render is Cleverence compute and consumes one label from the monthly allowance, so validate until the design is clean rather than rendering to check your work.',
      inputSchema: {
        id: z.string().describe('Design UUID'),
        format: z
          .enum(['pdf', 'png', 'svg', 'html'])
          .optional()
          .describe('Output format: pdf, png (default), svg, or html'),
      },
    },
    async ({ id, format }) => {
      const url = api.renderUrl(id, format ?? 'png');
      return {
        content: [
          {
            type: 'text',
            text:
              `Render URL: ${url}\n\n` +
              'Fetch it with the x-api-key header to download the file. One label is ' +
              'consumed per fetch, so fetch it once and keep the result.',
          },
        ],
      };
    },
  );
}
