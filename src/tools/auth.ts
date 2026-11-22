import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CleverenceLabelApi } from '../lib/api.js';

export function addAuthTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'whoami',
    {
      title: 'Who Am I',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Validate the API key and return account info: user name, email, tier, granted scopes, and remaining allowance.',
      inputSchema: {},
    },
    async () => {
      const data = await api.whoami();
      const cap = (value: number | null | undefined) =>
        value === null || value === undefined ? 'unlimited' : String(value);

      return {
        content: [
          {
            type: 'text',
            text: [
              `User: ${data.name} (${data.email})`,
              `Tier: ${data.tier}`,
              data.scopes?.length ? `Scopes: ${data.scopes.join(', ')}` : null,
              `Designs: ${data.usage.designsUsed} used of ${cap(data.usage.designsLimit)}`,
              // Rendering draws on this, so the figure used matters as much as
              // the cap when deciding whether the next print will go through.
              `Monthly labels: ${data.usage.monthlyLabelsUsed ?? 0} used of ` +
                `${cap(data.usage.monthlyLabelsLimit)} (printing and rendering count; authoring does not)`,
              `Cleverence AI generations/month: ${data.usage.monthlyAIGenerationsUsed ?? 0} used of ` +
                `${cap(data.usage.monthlyAIGenerationsLimit)} (designs you author yourself are not counted)`,
              data.api ? `API version: ${data.api.version}` : null,
              `Member since: ${data.createdAt}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'invite_user',
    {
      title: 'Invite User',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description:
        'Send an invitation email prompting the user to create a Cleverence Label account. Does NOT create an account — the user signs up themselves. No API key required. Rate limited to 5/min per IP.',
      inputSchema: {
        email: z.string().describe('Email address to invite'),
        source: z
          .string()
          .optional()
          .describe('Originating agent or tool (e.g. "cursor", "lovable")'),
      },
    },
    async ({ email, source }) => {
      const result = await api.invite(email, source ?? 'mcp');
      return {
        content: [{ type: 'text', text: result.message }],
      };
    },
  );
}
