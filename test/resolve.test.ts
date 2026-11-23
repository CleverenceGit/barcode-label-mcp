/**
 * Where the MCP server finds its key and base URL. The names say Label and which
 * of its keys (CLEVERENCE_LABEL_DESIGN_KEY); the names before 1.7 still work.
 *
 * Runs under the root vitest config (it includes cleverence-label-mcp/test).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/cli/resolve.js';

// An empty config dir, so a credentials file on this machine is never read.
process.env.CLEVERENCE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cl-mcp-'));

const resolve = (env: Record<string, string>, argv: Record<string, unknown> = {}) => {
  const result = resolveConfig({ _: [], ...argv }, env);
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

describe('the key and base URL', () => {
  it('reads CLEVERENCE_LABEL_DESIGN_KEY and CLEVERENCE_LABEL_BASE_URL', () => {
    const config = resolve({ CLEVERENCE_LABEL_DESIGN_KEY: 'cl_live_new', CLEVERENCE_LABEL_BASE_URL: 'http://new' });
    expect([config.apiKey, config.baseUrl]).toEqual(['cl_live_new', 'http://new']);
  });

  it('still reads the names before 1.7', () => {
    const config = resolve({ CLEVERENCE_API_KEY: 'cl_live_old', CLEVERENCE_BASE_URL: 'http://old' });
    expect([config.apiKey, config.baseUrl]).toEqual(['cl_live_old', 'http://old']);
  });

  it('prefers the new names, and --key over both', () => {
    const env = { CLEVERENCE_LABEL_DESIGN_KEY: 'cl_live_new', CLEVERENCE_API_KEY: 'cl_live_old' };
    expect(resolve(env).apiKey).toBe('cl_live_new');
    expect(resolve(env, { key: 'cl_live_flag' }).apiKey).toBe('cl_live_flag');
  });

  it('treats a blank key as unset, so the key saved by connect is used', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cl-mcp-saved-'));
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ apiKey: 'cl_live_saved', savedAt: '2026-11-23' }));
    const before = process.env.CLEVERENCE_CONFIG_DIR;
    process.env.CLEVERENCE_CONFIG_DIR = dir;
    try {
      expect(resolve({ CLEVERENCE_LABEL_DESIGN_KEY: '' }).apiKey).toBe('cl_live_saved');
      expect(resolve({ CLEVERENCE_LABEL_DESIGN_KEY: '  ' }).apiKey).toBe('cl_live_saved');
    } finally {
      process.env.CLEVERENCE_CONFIG_DIR = before;
    }
    expect(resolve({ CLEVERENCE_LABEL_DESIGN_KEY: '' }).apiKey).toBeNull();
  });
});
