/**
 * On-disk storage for a key obtained through device authorization.
 *
 * Without this the `connect` flow would end by printing a key and asking the
 * user to paste it into their MCP config — which is the copy-paste step the
 * flow exists to remove. Persisting it means connecting once is enough.
 *
 * An explicit --key or CLEVERENCE_LABEL_DESIGN_KEY still wins, so anyone managing
 * credentials themselves is unaffected.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredCredentials {
  apiKey: string;
  baseUrl?: string;
  savedAt: string;
}

export function credentialsPath(): string {
  const dir =
    process.env.CLEVERENCE_CONFIG_DIR ?? join(homedir(), '.cleverence');
  return join(dir, 'credentials.json');
}

export function readCredentials(): StoredCredentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredCredentials;
    return typeof parsed?.apiKey === 'string' && parsed.apiKey ? parsed : null;
  } catch {
    // A corrupt file should not stop the server from starting; the user can
    // reconnect and overwrite it.
    return null;
  }
}

/** Removes the saved key. Returns whether there was one to remove. */
export function clearCredentials(): boolean {
  const path = credentialsPath();
  if (!existsSync(path)) return false;

  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

export function writeCredentials(credentials: StoredCredentials): string {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });

  // writeFileSync only applies mode when creating the file, so an existing
  // file keeps whatever permissions it had. Set it explicitly.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows and some filesystems do not support this; not worth failing over.
  }

  return path;
}
