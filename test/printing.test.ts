/**
 * MCP printing tools: list_printers (GET /api/v1/printers), print_to_printer
 * (POST /api/v1/designs/{id}/print with an Idempotency-Key) and get_print_job
 * (GET /api/v1/print-jobs/{jobId}). Requests are checked for path, query, body
 * and headers; refusals keep their code and get their next step.
 *
 * Runs under the root vitest config (it includes cleverence-label-mcp/test).
 * Network is mocked per test; nothing reaches a server.
 */
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CleverenceLabelApi } from '../src/lib/api.js';
import { addPrintingTools } from '../src/tools/printing.js';

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Collects registered tools so a test can call their handlers directly. */
function fakeServer() {
  const tools = new Map<string, Handler>();
  const configs = new Map<string, { description: string }>();
  const server = {
    registerTool: (name: string, config: { description: string }, handler: Handler) => {
      tools.set(name, handler);
      configs.set(name, config);
    },
    registerResource: () => undefined,
  } as unknown as McpServer;
  return { server, tools, configs };
}

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** A fetch that answers every call with `status` and `json`, recording the calls. */
function mockFetch(status: number, json: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-9' },
    });
  });
  return calls;
}

const text = (r: ToolResult) => r.content.map((c) => c.text).join('\n');

function tools() {
  const fake = fakeServer();
  addPrintingTools(fake.server, new CleverenceLabelApi('cl_test_key', 'http://label.test'));
  return fake;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('list_printers', () => {
  it('sends org, site and state as the query and lists code, name, site, online state and language', async () => {
    const calls = mockFetch(200, {
      ok: true,
      data: [
        {
          code: 'oakland-recv',
          name: 'Receiving ZD421',
          activated: true,
          state: 'Online',
          reachableFrom: ['HUB-1'],
          renderProfile: { printLanguage: 'ZPL', dpiX: 203 },
          site: 'oakland',
        },
        { code: 'oakland-ship', name: 'Shipping', activated: true, state: 'NotReporting', reachableFrom: [], renderProfile: null, site: 'oakland' },
        { code: null, name: 'ZDesigner GK420d', activated: false, state: 'Offline', reachableFrom: ['HUB-1'], renderProfile: null, site: 'oakland' },
      ],
    });
    const r = await tools().tools.get('list_printers')!({ org: 'ref:cust_pell', site: 'oakland', state: 'all' });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('http://label.test/api/v1/printers?org=ref%3Acust_pell&site=oakland&state=all');
    const out = text(r);
    expect(out).toContain('Found 3 printer(s)');
    expect(out).toContain('• oakland-recv | "Receiving ZD421" | site oakland | online | language ZPL');
    expect(out).toContain('• oakland-ship | "Shipping" | site oakland | not reporting');
    expect(out).toContain('• (no code yet: adopt it in PrintHub before printing) | "ZDesigner GK420d" | site oakland | offline');
  });

  it('sends no query when nothing is named, and says so when there are no printers', async () => {
    const calls = mockFetch(200, { ok: true, data: [] });
    const r = await tools().tools.get('list_printers')!({});
    expect(calls[0].url).toBe('http://label.test/api/v1/printers');
    expect(text(r)).toContain('No printers found');
  });

  it('PRINTHUB_NOT_LINKED → how to install PrintHub', async () => {
    mockFetch(409, { ok: false, error: { code: 'PRINTHUB_NOT_LINKED', message: 'PrintHub is not set up.', retryable: false } });
    const r = await tools().tools.get('list_printers')!({});
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Code: PRINTHUB_NOT_LINKED (HTTP 409)');
    expect(text(r)).toContain('Add printer');
  });
});

describe('print_to_printer', () => {
  it('posts printer, values, copies, org and site with a fresh UUID Idempotency-Key, and returns the job', async () => {
    const calls = mockFetch(202, { ok: true, data: { jobId: 'job-1', state: 'Pending', format: 'label-json' } });
    const r = await tools().tools.get('print_to_printer')!({
      designId: 'd1',
      printer: 'oakland-recv',
      values: { sku: 'PEL-1044', qty: 3 },
      copies: 2,
      org: 'ref:cust_pell',
      site: 'oakland',
    });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://label.test/api/v1/designs/d1/print' });
    expect(calls[0].body).toEqual({ printer: 'oakland-recv', values: { sku: 'PEL-1044', qty: 3 }, copies: 2, org: 'ref:cust_pell', site: 'oakland' });
    const key = calls[0].headers['idempotency-key'];
    expect(key).toMatch(UUID);
    expect(calls[0].headers['x-api-key']).toBe('cl_test_key');
    const out = text(r);
    expect(out).toContain('Queued 2 labels on printer oakland-recv.');
    expect(out).toContain('Job: job-1');
    expect(out).toContain('State: Pending (waiting for the PrintHub computer to take it)');
    expect(out).toContain(`Idempotency key: ${key}`);
    expect(out).toContain('get_print_job');
  });

  it('makes a new key for each call, and sends the caller\'s key on a retry', async () => {
    const calls = mockFetch(202, { ok: true, data: { jobId: 'job-1', state: 'Pending' } });
    const { tools: t } = tools();
    await t.get('print_to_printer')!({ designId: 'd1', printer: 'p' });
    await t.get('print_to_printer')!({ designId: 'd1', printer: 'p' });
    await t.get('print_to_printer')!({ designId: 'd1', printer: 'p', idempotencyKey: '3f1c2a4e-7b9d-4e6a-8c1d-2a6b0e9f4d11' });
    const keys = calls.map((c) => c.headers['idempotency-key']);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe('3f1c2a4e-7b9d-4e6a-8c1d-2a6b0e9f4d11');
    // copies and values left out are not sent; the server defaults them.
    expect(calls[0].body).toEqual({ printer: 'p' });
  });

  it('shows one job per label when a counter numbers each label', async () => {
    mockFetch(202, {
      ok: true,
      data: { jobId: 'j1', state: 'Pending', jobIds: ['j1', 'j2'], counters: [{ Serial: '0001' }, { Serial: '0002' }] },
    });
    const out = text(await tools().tools.get('print_to_printer')!({ designId: 'd1', printer: 'p', copies: 2 }));
    expect(out).toContain('each label is its own job: j1, j2');
    expect(out).toContain('Counter numbers: Serial=0001; Serial=0002');
  });

  it('TIER_UPGRADE → required plan and the managed printing note', async () => {
    mockFetch(403, {
      ok: false,
      error: {
        code: 'TIER_UPGRADE',
        message: 'Printing through PrintHub is available on Professional and higher plans.',
        retryable: false,
        feature: 'managedPrinting',
        requiredTier: 'PROFESSIONAL_V1',
      },
    });
    const r = await tools().tools.get('print_to_printer')!({ designId: 'd1', printer: 'p' });
    expect(r.isError).toBe(true);
    const out = text(r);
    expect(out).toContain('Code: TIER_UPGRADE (HTTP 403)');
    expect(out).toContain('Required plan: PROFESSIONAL_V1');
    expect(out).toContain('Professional or higher, on the plan of the organization owner');
  });

  it.each([
    ['PRINTER_NOT_FOUND', 404, 'list_printers'],
    ['NO_REACHABLE_HUB', 409, 'again without idempotencyKey'],
    ['UNKNOWN_FIELD', 400, 'get_design'],
    ['BARCODE_VALUE_REQUIRED', 400, 'get_design'],
    ['QUOTA_EXCEEDED', 429, 'whoami'],
    ['IDEMPOTENCY_KEY_REUSED', 409, 'Leave idempotencyKey out'],
  ])('%s gets its next step', async (code, status, next) => {
    mockFetch(status, { ok: false, error: { code, message: `refused: ${code}` } });
    const r = await tools().tools.get('print_to_printer')!({ designId: 'd1', printer: 'p' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`Code: ${code} (HTTP ${status})`);
    expect(text(r)).toContain(next);
  });

  it('a partial refusal lists the jobs already sent', async () => {
    mockFetch(429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down.', sentJobIds: ['j1', 'j2'], sentLabels: 2 } });
    const out = text(await tools().tools.get('print_to_printer')!({ designId: 'd1', printer: 'p', copies: 5 }));
    expect(out).toContain('Do not print them again. Jobs sent: j1, j2');
  });

  it('the description carries the plan, the allowance, field names, printer codes and the no-loop rule', () => {
    const d = tools().configs.get('print_to_printer')!.description;
    expect(d).toContain('PrintHub');
    expect(d).toContain('Professional or higher');
    expect(d).toContain('monthly label allowance');
    expect(d).toContain('get_design');
    expect(d).toContain('list_printers');
    expect(d).toContain('never print in a loop');
  });
});

describe('get_print_job', () => {
  it('reads the job with org in the query and explains the state', async () => {
    const calls = mockFetch(200, {
      ok: true,
      data: { jobId: 'job-1', state: 'Succeeded', printer: 'oakland-recv', copies: 2, attempts: 1, createdAt: '2026-11-18T10:00:00Z', completedAt: '2026-11-18T10:00:04Z', error: null },
    });
    const r = await tools().tools.get('get_print_job')!({ jobId: 'job-1', org: 'ref:cust_pell' });
    expect(calls[0].url).toBe('http://label.test/api/v1/print-jobs/job-1?org=ref%3Acust_pell');
    const out = text(r);
    expect(out).toContain('Job job-1: Succeeded (sent to the printer)');
    expect(out).toContain('Printer: oakland-recv');
    expect(out).not.toContain('Not finished yet');
  });

  it('a pending job says to check again; a failed one shows its error', async () => {
    mockFetch(200, { ok: true, data: { jobId: 'j', state: 'Dispatched', printer: 'p', copies: 1, attempts: 1, createdAt: null, completedAt: null, error: null } });
    expect(text(await tools().tools.get('get_print_job')!({ jobId: 'j' }))).toContain('Not finished yet');
    mockFetch(200, { ok: true, data: { jobId: 'j', state: 'Failed', printer: 'p', copies: 1, attempts: 3, createdAt: null, completedAt: null, error: 'Paper out' } });
    const out = text(await tools().tools.get('get_print_job')!({ jobId: 'j' }));
    expect(out).toContain('Failed (failed and will not be retried)');
    expect(out).toContain('Error: Paper out');
  });

  it.each([
    ['JOB_NOT_FOUND', 404, 'never had a job'],
    ['JOB_EXPIRED_FROM_HISTORY', 410, 'removed from history'],
  ])('%s is told apart', async (code, status, next) => {
    mockFetch(status, { ok: false, error: { code, message: `refused: ${code}` } });
    const r = await tools().tools.get('get_print_job')!({ jobId: 'j' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`Code: ${code} (HTTP ${status})`);
    expect(text(r)).toContain(next);
  });
});
