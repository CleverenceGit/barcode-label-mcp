/**
 * MCP label-script surface (§6.4): validation output renders script issues as
 * `path:col CODE message (hint)` with a caret under the column and the script
 * report; API refusals keep their code and details (`ApiError`) and the tool
 * output shows them; the preview tools render rows and scans.
 *
 * Runs under the root vitest config (it includes cleverence-label-mcp/test).
 * Network is mocked per test; nothing reaches a server.
 */
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiError, CleverenceLabelApi, CLIENT_VERSION, type ValidationResult } from '../src/lib/api.js';
import { caretLines, formatApiError, valueAtPointer } from '../src/lib/format.js';
import { addAuthoringTools, formatValidation } from '../src/tools/authoring.js';
import { addScriptTools } from '../src/tools/scripts.js';

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Collects registered tools so a test can call their handlers directly. */
function fakeServer() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
    registerResource: () => undefined,
  } as unknown as McpServer;
  return { server, tools };
}

type Call = { url: string; method: string; body: unknown };

/** A fetch that answers every call with `status` and `json`, recording the calls. */
function mockFetch(status: number, json: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-123' },
    });
  });
  return calls;
}

const text = (r: ToolResult) => r.content.map((c) => c.text).join('\n');

const design = {
  $schema: 'https://label.cleverence.com/schema/label-design.v2.json',
  name: 'Assets',
  width: 50,
  height: 25,
  elements: [],
  dataFields: [{ id: 'f1', name: 'AssetId', type: 'string', sampleValue: 'AST-1' }],
  scripts: {
    lang: 'cls1',
    title: 'Asset tags',
    description: 'Numbers asset tags.',
    generate: {
      for: [{ name: 'n', in: 'seq(1, 5)' }],
      emit: { AssetId: "'AST-' && n", 'A/B': 'n' },
    },
  },
};

const validation: ValidationResult = {
  valid: false,
  schema: 'v2',
  errorCount: 1,
  warningCount: 1,
  fixed: [],
  issues: [
    {
      severity: 'error',
      code: 'E_HINT_SYNTAX',
      path: '/scripts/generate/emit/AssetId',
      col: 8,
      message: "'&&' is not an operator in label scripts.",
      hint: 'use and: a and b',
    },
    { severity: 'warning', element: 'bc1', message: 'Barcode is close to the edge.' },
  ],
  summary: { elementCount: 0, dataFieldCount: 1, width: 50, height: 25, renderCheck: true },
  design,
  scriptReport: {
    staticRowBound: 5,
    fieldsWritten: ['AssetId'],
    inputFieldsNotSet: [],
    capabilities: ['uid'],
    urlLiterals: [],
  },
};

describe('formatValidation', () => {
  it('renders a script issue as path:col CODE message (hint) with a caret under the column', () => {
    const out = formatValidation(validation).split('\n');
    const i = out.findIndex((l) => l.includes('E_HINT_SYNTAX'));
    expect(out[i]).toBe(
      "  ✗ /scripts/generate/emit/AssetId:8 E_HINT_SYNTAX '&&' is not an operator in label scripts. (use and: a and b)",
    );
    expect(out[i + 1]).toBe("    'AST-' && n");
    expect(out[i + 2]).toBe('           ^');
    // The caret sits under the 8th character of the cell: the first '&'.
    expect(out[i + 1][out[i + 2].indexOf('^')]).toBe('&');
  });

  it('keeps element issues in their old form and adds the script report', () => {
    const out = formatValidation(validation);
    expect(out).toContain('  ! [bc1] Barcode is close to the edge.');
    expect(out).toContain('Script report:');
    expect(out).toContain('Fields written: AssetId');
    expect(out).toContain('Static row bound: 5');
    expect(out).toContain('Capabilities: uid');
  });

  it('omits the caret when the cell cannot be found', () => {
    const out = formatValidation({ ...validation, design: {} }).split('\n');
    const i = out.findIndex((l) => l.includes('E_HINT_SYNTAX'));
    expect(out[i + 1]).not.toMatch(/^\s+\^$/);
  });
});

describe('carets and pointers', () => {
  it('resolves escaped JSON Pointer segments', () => {
    expect(valueAtPointer(design, '/scripts/generate/emit/A~1B')).toBe('n');
    expect(valueAtPointer(design, '/scripts/generate/for/0/in')).toBe('seq(1, 5)');
    expect(valueAtPointer(design, '/scripts/nope')).toBeUndefined();
  });

  it('windows a long cell around the column', () => {
    const cell = 'a'.repeat(300) + '&&' + 'b'.repeat(300);
    const [shown, caret] = caretLines(cell, 301, '');
    expect(shown.length).toBeLessThan(80);
    expect(shown.startsWith('…') && shown.endsWith('…')).toBe(true);
    expect(shown[caret.indexOf('^')]).toBe('&');
  });
});

describe('ApiError', () => {
  it('carries the code, status, details and request id of a refusal', async () => {
    mockFetch(403, {
      ok: false,
      error: {
        code: 'FEATURE_REQUIRES_UPGRADE',
        message: 'Label scripts need Professional.',
        details: {
          requiredTier: { internalName: 'PROFESSIONAL_V1', displayName: 'Professional' },
          blocked: [{ featurePath: 'features.labelScripts', value: true, label: 'label scripts' }],
        },
      },
    });
    const api = new CleverenceLabelApi('cl_test_key', 'http://label.test');
    const err = await api.updateDesign('d1', { scripts: design.scripts }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'FEATURE_REQUIRES_UPGRADE', requestId: 'req-123' });
    expect((err as ApiError).details).toMatchObject({ requiredTier: { displayName: 'Professional' } });
  });

  it('formats a non-JSON failure with the HTTP status as the code', () => {
    const e = new ApiError('HTTP 502: Bad gateway', { status: 502 });
    expect(formatApiError(e)).toContain('Code: HTTP_502 (HTTP 502)');
  });
});

describe('tool output carries the API error details', () => {
  it('update_design_content: plan gate → required plan and blocked feature', async () => {
    const calls = mockFetch(403, {
      ok: false,
      error: {
        code: 'FEATURE_REQUIRES_UPGRADE',
        message: 'Saving this needs Professional.',
        details: {
          requiredTier: { internalName: 'PROFESSIONAL_V1', displayName: 'Professional' },
          blocked: [{ featurePath: 'features.labelScripts', value: true, label: 'label scripts' }],
        },
      },
    });
    const { server, tools } = fakeServer();
    addAuthoringTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('update_design_content')!({ id: 'd1', scripts: design.scripts });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'http://label.test/api/v1/designs/d1' });
    expect((calls[0].body as Record<string, unknown>).scripts).toEqual(design.scripts);
    expect(r.isError).toBe(true);
    const out = text(r);
    expect(out).toContain('Code: FEATURE_REQUIRES_UPGRADE (HTTP 403)');
    expect(out).toContain('Required plan: Professional (PROFESSIONAL_V1)');
    expect(out).toContain('✗ label scripts (features.labelScripts)');
    expect(out).toContain('Running scripts is free');
  });

  it('create_design_from_json: SCRIPT_INVALID → diagnostics with carets into the sent design', async () => {
    const calls = mockFetch(422, {
      ok: false,
      error: {
        code: 'SCRIPT_INVALID',
        message: 'The label script has errors. Fix them and save again; see details.diagnostics.',
        details: {
          diagnostics: [
            {
              severity: 'error',
              code: 'E_HINT_SYNTAX',
              path: '/scripts/generate/emit/AssetId',
              col: 8,
              message: "'&&' is not an operator in label scripts.",
              hint: 'use and: a and b',
            },
          ],
        },
      },
    });
    const { server, tools } = fakeServer();
    addAuthoringTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('create_design_from_json')!({ ...design });
    expect(calls[0].body).toMatchObject({ $schema: design.$schema, scripts: design.scripts });
    expect(r.isError).toBe(true);
    const out = text(r);
    expect(out).toContain('Code: SCRIPT_INVALID (HTTP 422)');
    expect(out).toContain("/scripts/generate/emit/AssetId:8 E_HINT_SYNTAX '&&' is not an operator in label scripts. (use and: a and b)");
    expect(out).toContain("    'AST-' && n\n           ^");
  });

  it.each([
    ['SCRIPT_INHERITED', 409, 'linked copy'],
    ['SCRIPTS_REQUIRE_V2', 422, 'label-design.v2.json'],
    ['SCRIPTS_NOT_ALLOWED_IN_BODY', 422, 'print it by id'],
  ])('%s gets its next step', async (code, status, next) => {
    mockFetch(status, { ok: false, error: { code, message: `refused: ${code}` } });
    const { server, tools } = fakeServer();
    addAuthoringTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('update_design_content')!({ id: 'd1', scripts: design.scripts });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`refused: ${code}`);
    expect(text(r)).toContain(`Code: ${code} (HTTP ${status})`);
    expect(text(r)).toContain(next);
  });

  it('update_design_content refuses dataFields without elements and sends nothing', async () => {
    const calls = mockFetch(200, { ok: true });
    const { server, tools } = fakeServer();
    addAuthoringTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('update_design_content')!({ id: 'd1', dataFields: design.dataFields, scripts: design.scripts });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Send elements together with dataFields');
    expect(calls).toHaveLength(0);
  });

  it('a non-API failure (not connected) still surfaces as a thrown error', async () => {
    const { server, tools } = fakeServer();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    addAuthoringTools(server, new CleverenceLabelApi(null, 'http://label.test'));
    await expect(tools.get('update_design_content')!({ id: 'd1' })).rejects.toThrow(/Not connected/);
  });
});

describe('script tools', () => {
  it('preview_script_rows posts event generate and renders a Markdown table, checks and stats', async () => {
    const calls = mockFetch(200, {
      ok: true,
      data: {
        ok: true,
        seeded: true,
        diagnostics: [],
        scriptReport: { staticRowBound: 5, fieldsWritten: ['AssetId'], inputFieldsNotSet: [], capabilities: [], urlLiterals: [] },
        count: 5,
        exact: true,
        rowCount: 5,
        columns: ['AssetId', 'Note'],
        rows: [
          { AssetId: 'AST-1', Note: 'a|b' },
          { AssetId: 'AST-2', Note: '' },
        ],
        hostChecks: { duplicates: [{ field: 'AssetId', count: 1, rows: [2], values: ['AST-1'] }], empty: [], urlLike: { count: 0, examples: [] } },
        stats: { steps: 120, stepBudget: 1000000, ms: 3 },
      },
    });
    const { server, tools } = fakeServer();
    addScriptTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('preview_script_rows')!({ design, params: { count: 5 }, limit: 2, seed: 's' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://label.test/api/v1/scripts/preview' });
    expect(calls[0].body).toMatchObject({ event: 'generate', design, params: { count: 5 }, limit: 2, seed: 's' });
    const out = text(r);
    expect(out).toContain('5 labels.');
    expect(out).toContain('| # | AssetId | Note |');
    expect(out).toContain('| 1 | AST-1 | a\\|b |');
    expect(out).toContain('1 duplicate AssetId value(s), rows 2');
    expect(out).toContain('Stats: 120 of 1,000,000 steps, 3 ms');
  });

  it('preview_script_rows renders a runtime error with the row and bindings', async () => {
    mockFetch(200, {
      ok: true,
      data: {
        ok: false,
        seeded: true,
        diagnostics: [],
        scriptReport: null,
        error: {
          severity: 'error',
          code: 'E_DUPLICATE_VALUE',
          path: '/scripts/generate/unique/0',
          message: "AssetId 'AST-1' appears twice.",
          operatorMessage: "The value AST-1 would appear twice in AssetId.",
          row: 2,
          bindings: { n: '1' },
          steps: 40,
        },
        stats: { steps: 40, stepBudget: 1000000, ms: 1 },
      },
    });
    const { server, tools } = fakeServer();
    addScriptTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const out = text(await tools.get('preview_script_rows')!({ design }));
    expect(out).toContain('Runtime error on row 2:');
    expect(out).toContain('/scripts/generate/unique/0 E_DUPLICATE_VALUE');
    expect(out).toContain('Bindings: n = "1"');
  });

  it('simulate_scans renders one line per scan', async () => {
    const calls = mockFetch(200, {
      ok: true,
      data: {
        ok: true,
        seeded: true,
        diagnostics: [],
        scriptReport: null,
        scans: [
          { scan: 'x1', result: { kind: 'rejected', route: 1, message: 'Scan the PO first' } },
          { scan: 'PO7', result: { kind: 'applied', route: 0, set: { PO: 'PO7' }, keep: { po: 'PO7' }, print: null, warnings: [], uids: [] } },
          { scan: 'A1', result: { kind: 'applied', route: 1, set: { SKU: 'A1' }, keep: {}, print: { copies: 2 }, warnings: ['odd price'], uids: [] } },
          { scan: '??', result: { kind: 'unmatched' } },
          { scan: 'ab', result: { kind: 'rejected', route: -1, message: 'The scan is shorter than 4 characters.' } },
        ],
        stats: { steps: 300, stepBudget: 1000000, ms: 2 },
      },
    });
    const { server, tools } = fakeServer();
    addScriptTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const out = text(await tools.get('simulate_scans')!({ designId: 'd1', scans: ['x1', 'PO7', 'A1', '??', 'ab'], tables: { items: [] } }));
    expect(calls[0].body).toMatchObject({ event: 'scan', designId: 'd1', scans: ['x1', 'PO7', 'A1', '??', 'ab'] });
    expect(out).toContain('1. "x1" → rejected by route 1: "Scan the PO first"');
    expect(out).toContain('2. "PO7" → applied by route 0; set PO="PO7"; keep po="PO7"; no print');
    expect(out).toContain('3. "A1" → applied by route 1; set SKU="A1"; print 2 copies; warnings: "odd price"');
    expect(out).toContain('4. "??" → unmatched');
    expect(out).toContain('5. "ab" → rejected before any route (station.accept / clean): "The scan is shorter than 4 characters."');
    expect(out).not.toContain('route -1');
  });

  it('busy sandbox → SCRIPT_PREVIEW_BUSY with a retry hint', async () => {
    mockFetch(503, { ok: false, error: { code: 'SCRIPT_PREVIEW_BUSY', message: 'Both preview sandboxes are busy.' } });
    const { server, tools } = fakeServer();
    addScriptTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('simulate_scans')!({ design, scans: ['A'] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Wait a second');
  });

  it('refuses both or neither of design and designId without calling the API', async () => {
    const calls = mockFetch(200, { ok: true, data: {} });
    const { server, tools } = fakeServer();
    addScriptTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const both = await tools.get('preview_script_rows')!({ design, designId: 'd1' });
    const neither = await tools.get('preview_script_rows')!({});
    expect(both.isError && neither.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('get_script_reference returns the skill and the builtin reference', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return new Response(`# ${String(url).split('/').pop()}`, { status: 200 });
    });
    const { server, tools } = fakeServer();
    addScriptTools(server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
    const r = await tools.get('get_script_reference')!({});
    expect(urls.sort()).toEqual(['http://label.test/skills/label-scripts-builtins.md', 'http://label.test/skills/label-scripts.md']);
    expect(r.content).toHaveLength(2);
  });

  it('is version 1.8.2', () => {
    expect(CLIENT_VERSION).toBe('1.8.2');
  });
});
