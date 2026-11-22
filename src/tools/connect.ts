import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CleverenceLabelApi } from '../lib/api.js';
import {
  readCredentials,
  writeCredentials,
  clearCredentials,
  credentialsPath,
} from '../lib/credentials.js';

/**
 * Gets this agent its own API key without the user copy-pasting anything.
 *
 * The tool returns as soon as it has a link, rather than blocking for the
 * minutes a human takes to sign up: an MCP call that hangs that long tends to
 * be killed by the client, and the agent cannot relay the link while it is
 * stuck waiting. So `connect` hands back the link and `finish_connecting`
 * collects the key afterwards.
 */

const DEFAULT_POLL_SECONDS = 5;
/**
 * Kept under the ~60s tool timeout most MCP clients use, with headroom. If the
 * call were to run right up to that limit the client would kill it and the
 * agent would never see the "not approved yet" answer it needs in order to
 * retry sensibly.
 */
const MAX_WAIT_SECONDS = 45;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function persist(api: CleverenceLabelApi, apiKey: string): string | null {
  try {
    return writeCredentials({
      apiKey,
      baseUrl: api.base,
      savedAt: new Date().toISOString(),
    });
  } catch {
    // A read-only home directory should not lose the key: it still works for
    // this session, and the caller is told to save it themselves.
    return null;
  }
}

export function addConnectTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'connect',
    {
      title: 'Connect to Cleverence Label',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description:
        'Get this agent its own Cleverence Label API key. Call this immediately when you are not connected — do not ask the user for an API key and do not stop to ask permission first. Returns an approval link: show that link to the user verbatim, then call finish_connecting. The key is saved locally, so this is needed only once.',
      inputSchema: {},
    },
    async () => {
      if (api.hasKey()) {
        return {
          content: [
            {
              type: 'text',
              text: 'Already connected. Call whoami to confirm which account this key belongs to.',
            },
          ],
        };
      }

      // Reuses a grant already started by a failed tool call, so the user is
      // not shown a second link for the same connection attempt.
      const grant = await api.startOrReusePendingGrant();

      return {
        content: [
          {
            type: 'text',
            text: [
              'Ask the user to open this link and approve:',
              '',
              `  ${grant.verificationUrlComplete}`,
              '',
              `Confirmation code: ${grant.userCode}`,
              `This link expires at ${grant.expiresAt}.`,
              '',
              'They can sign in or create a free account — either finishes the connection.',
              'Show them the link itself, not a summary of it.',
              '',
              'Then call finish_connecting (it takes no arguments) to collect the key.',
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'finish_connecting',
    {
      title: 'Finish Connecting',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description:
        'Collect the API key after the user approves the link from connect. Takes no arguments. Waits up to 45 seconds; if the user has not approved yet it says so, and you can simply call it again.',
      inputSchema: {},
    },
    async () => {
      if (api.hasKey()) {
        return {
          content: [{ type: 'text', text: 'Already connected. Call whoami to confirm.' }],
        };
      }

      const pending = api.getPendingGrant();
      if (!pending) {
        return {
          content: [
            {
              type: 'text',
              text: 'No authorization in progress, or it expired. Call connect to get a fresh link.',
            },
          ],
        };
      }

      const intervalMs = Math.max(pending.interval, DEFAULT_POLL_SECONDS) * 1000;
      const deadline = Date.now() + MAX_WAIT_SECONDS * 1000;

      while (Date.now() < deadline) {
        const token = await api.pollDeviceAuth(pending.deviceCode);

        if (token) {
          // Clears the pending grant as a side effect.
          api.setApiKey(token.apiKey);
          const saved = persist(api, token.apiKey);

          return {
            content: [
              {
                type: 'text',
                text: [
                  'Connected. Retry whatever you were doing.',
                  `Scopes: ${token.scopes.join(', ')}`,
                  saved
                    ? `Key saved to ${saved}, so this will not be needed again.`
                    : `Could not write ${credentialsPath()}. The key works for this session; to keep it, set CLEVERENCE_LABEL_DESIGN_KEY=${token.apiKey}`,
                  '',
                  'Call whoami to confirm the account.',
                ].join('\n'),
              },
            ],
          };
        }

        await sleep(intervalMs);
      }

      return {
        content: [
          {
            type: 'text',
            text: 'The user has not approved yet. Ask them to open the link, then call finish_connecting again.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'disconnect',
    {
      title: 'Disconnect from Cleverence Label',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      description:
        'Revoke the API key this agent is using and delete the saved copy. Use when the user asks to disconnect, or when uninstalling. The key stops working immediately; connect again to get a new one.',
      inputSchema: {},
    },
    async () => {
      if (!api.hasKey()) {
        return { content: [{ type: 'text', text: 'Not connected — nothing to revoke.' }] };
      }

      // Revoke first: clearing the file while the key still works would leave
      // a live credential behind with no record of it here.
      const revoked = await api.revokeApiKey('self');
      const removed = clearCredentials();

      return {
        content: [
          {
            type: 'text',
            text: [
              revoked.alreadyRevoked
                ? `Key "${revoked.name}" was already revoked.`
                : `Revoked key "${revoked.name}". It no longer works.`,
              removed
                ? `Removed ${credentialsPath()}.`
                : 'No saved credentials file to remove — if the key came from CLEVERENCE_LABEL_DESIGN_KEY, clear that too.',
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_api_keys',
    {
      title: 'List API Keys',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "List the API keys on the connected account, showing name, prefix, scopes and last use — never the key itself. Requires the 'keys:manage' scope.",
      inputSchema: {},
    },
    async () => {
      const { keys } = await api.listApiKeys();

      if (keys.length === 0) {
        return { content: [{ type: 'text', text: 'No API keys on this account.' }] };
      }

      const lines = keys.map(k =>
        [
          `${k.name} (${k.keyPrefix}…)`,
          k.isCurrent ? ' — this key' : '',
          k.revoked ? ' [revoked]' : '',
          `\n  scopes: ${k.scopes?.join(', ') ?? 'default'}`,
          `\n  last used: ${k.lastUsedAt ?? 'never'}`,
        ].join(''),
      );

      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    },
  );

  server.registerTool(
    'connection_status',
    {
      title: 'Connection Status',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Report whether this agent has a Cleverence Label API key and where it came from. Use it to decide whether connect is needed.',
      inputSchema: {},
    },
    async () => {
      if (!api.hasKey()) {
        return {
          content: [
            { type: 'text', text: 'Not connected. Call connect to authorize this agent.' },
          ],
        };
      }

      const stored = readCredentials();
      return {
        content: [
          {
            type: 'text',
            text: [
              `Connected to ${api.base}.`,
              stored
                ? `Key loaded from ${credentialsPath()} (saved ${stored.savedAt}).`
                : 'Key supplied via --key or CLEVERENCE_LABEL_DESIGN_KEY.',
            ].join('\n'),
          },
        ],
      };
    },
  );
}
