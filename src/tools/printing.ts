import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CleverenceLabelApi, Printer, PrintJob } from '../lib/api.js';
import { withApiErrors } from '../lib/format.js';

/**
 * Printing on a label printer through PrintHub: the printer list
 * (GET /api/v1/printers), the print call (POST /api/v1/designs/{id}/print) and
 * the job read (GET /api/v1/print-jobs/{jobId}).
 *
 * The routes accept any valid key, including the one device sign-in gives this
 * server. Only the print call checks the plan: the organization owner needs
 * Professional or higher (managedPrinting). Each label printed counts against
 * the owner's monthly label allowance.
 */

/** What a printer's PrintHub state means for printing to it. */
const PRINTER_STATE: Record<string, string> = {
  Online: 'online',
  Warning: 'online, with a warning',
  Error: 'error',
  Offline: 'offline',
  NotReporting: 'not reporting (its PrintHub computer is off or disconnected)',
  Unknown: 'state unknown',
};

/** What a job state means, in the words the agent passes on to the user. */
const JOB_STATE: Record<string, string> = {
  Pending: 'waiting for the PrintHub computer to take it',
  Dispatched: 'taken by the PrintHub computer, printing',
  Succeeded: 'sent to the printer',
  Failed: 'failed and will not be retried',
  Cancelled: 'cancelled',
  Expired: 'expired: no PrintHub computer took it in time, so nothing printed',
};

const FINAL_STATES = new Set(['Succeeded', 'Failed', 'Cancelled', 'Expired']);

/** One line per printer: code, name, site, online state, language when given. */
export function formatPrinter(p: Printer): string {
  const language = p.renderProfile?.printLanguage;
  const parts = [
    p.code ? `${p.code}` : '(no code yet: adopt it in PrintHub before printing)',
    p.name ? `"${p.name}"` : null,
    p.site ? `site ${p.site}` : null,
    PRINTER_STATE[p.state] ?? p.state,
    typeof language === 'string' && language ? `language ${language}` : null,
  ];
  return `• ${parts.filter(Boolean).join(' | ')}`;
}

export function formatPrintJob(job: PrintJob): string {
  const meaning = JOB_STATE[job.state];
  return [
    `Job ${job.jobId}: ${job.state}${meaning ? ` (${meaning})` : ''}`,
    job.printer ? `Printer: ${job.printer}` : null,
    `Copies: ${job.copies} | Attempts: ${job.attempts}`,
    job.createdAt ? `Created: ${job.createdAt}` : null,
    job.completedAt ? `Completed: ${job.completedAt}` : null,
    job.error ? `Error: ${job.error}` : null,
    FINAL_STATES.has(job.state) ? null : 'Not finished yet. Call get_print_job again in a few seconds.',
  ]
    .filter(Boolean)
    .join('\n');
}

const SCOPE_SHAPE = {
  org: z
    .string()
    .optional()
    .describe('Organization: an id, a slug or ref:<your customer id>. Leave out to use your default organization.'),
  site: z.string().optional().describe('Site slug, e.g. "oakland". Leave out for the whole organization.'),
};

export function addPrintingTools(server: McpServer, api: CleverenceLabelApi) {
  server.registerTool(
    'list_printers',
    {
      title: 'List Printers',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description:
        'List the label printers PrintHub has found for the organization: code, name, site, online or offline, and the printer language when PrintHub reports it. Use a printer\'s code with print_to_printer. Needs PrintHub installed on a computer the printer is connected to. Listing works on every plan; printing needs Professional or higher.',
      inputSchema: {
        ...SCOPE_SHAPE,
        state: z
          .enum(['activated', 'discovered', 'all'])
          .optional()
          .describe(
            'activated (default): printers that have a code and can be printed to. discovered: found but not adopted yet. all: both.',
          ),
      },
    },
    async ({ org, site, state }) =>
      withApiErrors(async () => {
        const printers = await api.listPrinters({ org, site, state });
        if (printers.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  'No printers found. PrintHub may not be installed yet, or its printers are not adopted. ' +
                  'Try state "all" to see printers that were found but not adopted.',
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${printers.length} printer(s):\n\n${printers.map(formatPrinter).join('\n')}`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    'print_to_printer',
    {
      title: 'Print to Printer',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description:
        'Print a saved design on a label printer through PrintHub. Needs PrintHub installed at the printer\'s place and a Professional or higher plan. Each label counts against the monthly label allowance (copies: 5 is five labels). ' +
        'Get the printer code from list_printers. The keys of values are the design\'s field names; get them from get_design. A field left out prints empty. ' +
        'Print only when the user asked for it, and never print in a loop or repeat a print without the user\'s say-so. ' +
        'Returns a jobId; call get_print_job to see whether it printed. If the answer to this call is lost, retry once with the same idempotencyKey: that returns the same job instead of printing twice.',
      inputSchema: {
        designId: z.string().describe('Design UUID'),
        printer: z.string().describe('Printer code from list_printers, e.g. "oakland-recv"'),
        values: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe('Field name → value, e.g. { "sku": "PEL-1044", "bin": "A-14" }. Field names come from get_design.'),
        copies: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Number of labels, 1 to 1000 (default 1). Each is one label from the allowance.'),
        ...SCOPE_SHAPE,
        idempotencyKey: z
          .string()
          .optional()
          .describe(
            'Only for retrying a print whose answer was lost: the key the earlier call reported. Leave out for a new print; a new UUID is made.',
          ),
      },
    },
    async ({ designId, printer, values, copies, org, site, idempotencyKey }) => {
      const key = idempotencyKey?.trim() || randomUUID();
      return withApiErrors(async () => {
        const job = await api.printDesign(designId, { printer, values, copies, org, site }, key);
        const labels = copies ?? 1;
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Queued ${labels} label${labels === 1 ? '' : 's'} on printer ${printer}.`,
                `Job: ${job.jobId}`,
                `State: ${job.state}${JOB_STATE[job.state] ? ` (${JOB_STATE[job.state]})` : ''}`,
                job.jobIds && job.jobIds.length > 1
                  ? `A counter gave each label its own number, so each label is its own job: ${job.jobIds.join(', ')}`
                  : null,
                job.counters?.length
                  ? `Counter numbers: ${job.counters.map((c) => Object.entries(c).map(([k, v]) => `${k}=${v ?? ''}`).join(', ')).join('; ')}`
                  : null,
                `Idempotency key: ${key} (reuse it only to retry this same print)`,
                'Call get_print_job with the job id to see whether it printed.',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'get_print_job',
    {
      title: 'Get Print Job',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description:
        'Check what happened to a job from print_to_printer. States: Pending (waiting for the PrintHub computer), Dispatched (printing), Succeeded (sent to the printer), Failed, Cancelled, Expired (no PrintHub computer took it, nothing printed). ' +
        'JOB_NOT_FOUND means this account never had that job; JOB_EXPIRED_FROM_HISTORY means it finished and its details were removed after about seven days.',
      inputSchema: {
        jobId: z.string().describe('The job id print_to_printer returned'),
        ...SCOPE_SHAPE,
      },
    },
    async ({ jobId, org, site }) =>
      withApiErrors(async () => {
        const job = await api.getPrintJob(jobId, { org, site });
        return { content: [{ type: 'text' as const, text: formatPrintJob(job) }] };
      }),
  );
}
