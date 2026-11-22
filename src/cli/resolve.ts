import type { ParsedArgs } from 'minimist';
import { readCredentials } from '../lib/credentials.js';

export type CliConfig = {
  transport: 'stdio' | 'http';
  apiKey: string | null;
  port: number;
  baseUrl: string | undefined;
};

type ResolveResult =
  | { ok: true; config: CliConfig }
  | { ok: false; error: string };

export function resolveConfig(
  argv: ParsedArgs,
  env: NodeJS.ProcessEnv = process.env,
): ResolveResult {
  const transport = argv.http ? 'http' : 'stdio';
  const port = parseInt(argv.port ?? env.MCP_PORT ?? '3001', 10);
  // CLEVERENCE_BASE_URL and CLEVERENCE_API_KEY are the names before 1.7: Cleverence
  // makes other products with keys of their own, so the names now say Label and
  // which of its keys. The old ones still work, so no setup breaks.
  const baseUrl =
    argv['base-url'] ?? env.CLEVERENCE_LABEL_BASE_URL ?? env.CLEVERENCE_BASE_URL ?? undefined;

  // Explicit configuration wins, then a key saved by a previous `connect`.
  // Starting without any of them is no longer an error: refusing to boot would
  // leave the user with no way to run `connect`, which is the tool that
  // obtains the key in the first place.
  const apiKey =
    argv.key ??
    env.CLEVERENCE_LABEL_DESIGN_KEY ??
    env.CLEVERENCE_API_KEY ??
    readCredentials()?.apiKey ??
    null;

  if (isNaN(port) || port < 1 || port > 65535) {
    return { ok: false, error: `Invalid port: ${argv.port}` };
  }

  return { ok: true, config: { transport, apiKey, port, baseUrl } };
}
