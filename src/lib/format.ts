import {
  ApiError,
  type ScanResult,
  type ScriptDiagnostic,
  type ScriptPreviewResult,
  type ScriptReport,
  type ScriptRuntimeError,
} from './api.js';

/**
 * Text renderings shared by the authoring and script tools.
 *
 * Label script problems are rendered the way an agent fixes them fastest:
 * `path:col CODE message (hint)`, then the expression cell with a caret under
 * the column when the cell is known.
 */

type Located = {
  severity?: 'error' | 'warning';
  code?: string;
  path?: string;
  col?: number;
  message: string;
  hint?: string;
};

const CELL_WINDOW = 70;

/** The value at a JSON Pointer ("/scripts/generate/emit/A~1B") inside `root`, or undefined. */
export function valueAtPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) return undefined;
  let node: unknown = root;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) return undefined;
      node = node[Number(key)];
    } else if (node !== null && typeof node === 'object') {
      if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
      node = (node as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * The expression cell and a caret line under `col` (1-based). Long cells are
 * shown as a window around the column. Tabs and newlines are shown as spaces so
 * the caret stays aligned.
 */
export function caretLines(cell: string, col: number, indent = '    '): [string, string] {
  const flat = cell.replace(/[\t\r\n]/g, ' ');
  const at = Math.min(Math.max(col - 1, 0), flat.length);
  let start = 0;
  let end = flat.length;
  if (flat.length > CELL_WINDOW) {
    start = Math.max(0, at - Math.floor(CELL_WINDOW / 2));
    end = Math.min(flat.length, start + CELL_WINDOW);
    start = Math.max(0, end - CELL_WINDOW);
  }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < flat.length ? '…' : '';
  const shown = prefix + flat.slice(start, end) + suffix;
  const caretAt = prefix.length + (at - start);
  return [`${indent}${shown}`, `${indent}${' '.repeat(caretAt)}^`];
}

/**
 * One problem: `path:col CODE message (hint)`, plus the cell and a caret when
 * `source` (the design the paths point into) holds a text cell at `path`.
 */
export function formatLocated(issue: Located, source?: unknown, mark = issue.severity === 'warning' ? '!' : '✗'): string[] {
  const where = issue.path ? `${issue.path}${issue.col !== undefined ? `:${issue.col}` : ''} ` : '';
  const code = issue.code ? `${issue.code} ` : '';
  const hint = issue.hint ? ` (${issue.hint})` : '';
  const lines = [`  ${mark} ${where}${code}${issue.message}${hint}`];
  if (issue.path && issue.col !== undefined && source !== undefined) {
    const cell = valueAtPointer(source, issue.path);
    if (typeof cell === 'string' && cell.length > 0) lines.push(...caretLines(cell, issue.col));
  }
  return lines;
}

/** Errors first, then warnings, each with its caret when the source is known. */
export function formatDiagnostics(diagnostics: readonly ScriptDiagnostic[], source?: unknown): string[] {
  const lines: string[] = [];
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity !== 'error');
  if (errors.length > 0) {
    lines.push('Script errors:');
    errors.forEach((d) => lines.push(...formatLocated(d, source)));
  }
  if (warnings.length > 0) {
    lines.push('Script warnings:');
    warnings.forEach((d) => lines.push(...formatLocated(d, source)));
  }
  return lines;
}

export function formatScriptReport(report: ScriptReport): string[] {
  const list = (xs: readonly string[]) => (xs.length > 0 ? xs.join(', ') : 'none');
  const lines = ['Script report:'];
  lines.push(`  Fields written: ${list(report.fieldsWritten)}`);
  if (report.inputFieldsNotSet.length > 0) lines.push(`  Input fields it never sets: ${list(report.inputFieldsNotSet)}`);
  lines.push(
    `  Static row bound: ${report.staticRowBound === null ? 'n/a (no generator)' : report.staticRowBound.toLocaleString('en-US')}`,
  );
  lines.push(`  Capabilities: ${list(report.capabilities)}`);
  if (report.urlLiterals.length > 0) lines.push(`  Web-address literals: ${list(report.urlLiterals)}`);
  return lines;
}

/** A runtime failure: code, where, the operator's message, the row being built and the bindings. */
export function formatRuntimeError(error: ScriptRuntimeError, source?: unknown): string[] {
  const lines = [`Runtime error${error.row !== undefined ? ` on row ${error.row}` : ''}:`];
  lines.push(...formatLocated({ ...error, severity: 'error' }, source));
  if (error.operatorMessage && error.operatorMessage !== error.message) {
    lines.push(`  The operator would see: ${error.operatorMessage}`);
  }
  const bindings = Object.entries(error.bindings ?? {});
  if (bindings.length > 0) {
    lines.push(`  Bindings: ${bindings.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}`);
  }
  return lines;
}

const cellText = (v: unknown) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

/** Rows as a Markdown table with a 1-based `#` column. */
export function markdownTable(columns: readonly string[], rows: readonly Record<string, string>[]): string[] {
  const head = ['#', ...columns];
  const lines = [`| ${head.map(cellText).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  rows.forEach((row, i) => lines.push(`| ${[String(i + 1), ...columns.map((c) => cellText(row[c]))].join(' | ')} |`));
  return lines;
}

function formatStats(result: ScriptPreviewResult): string {
  const { steps, stepBudget, ms } = result.stats;
  return (
    `Stats: ${steps.toLocaleString('en-US')} of ${stepBudget.toLocaleString('en-US')} steps, ${ms} ms` +
    (result.seeded ? '; uid()/uuid() seeded (same request, same codes)' : '')
  );
}

function formatSource(result: ScriptPreviewResult): string[] {
  const src = result.scriptsSource;
  if (!src?.inherited) return [];
  return [`Script inherited from "${src.designName}" (${src.designId}), its published version; read-only on this design.`];
}

/** The answer of preview_script_rows: count, a Markdown table, warnings, host checks and stats. */
export function formatPreviewRows(result: ScriptPreviewResult, source?: unknown): string {
  const lines: string[] = [...formatSource(result)];
  const errors = result.diagnostics.filter((d) => d.severity === 'error');

  if (errors.length > 0) {
    lines.push('The script has errors, so nothing ran. Fix these and preview again:', '');
    lines.push(...formatDiagnostics(result.diagnostics, source));
  } else if (result.error) {
    lines.push('The run failed; a run is all-or-nothing, so it made no rows.', '');
    lines.push(...formatRuntimeError(result.error, source));
  } else {
    const count = result.count ?? result.rowCount ?? 0;
    const made = result.rowCount ?? result.rows?.length ?? 0;
    const head =
      result.exact === false
        ? `The form walks ${count.toLocaleString('en-US')} combinations; \`where\` kept ${made.toLocaleString('en-US')} labels.`
        : `${made.toLocaleString('en-US')} label${made === 1 ? '' : 's'}.`;
    lines.push(head);
    const rows = result.rows ?? [];
    const columns = result.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
    if (rows.length > 0) {
      lines.push('', `First ${rows.length} of ${made.toLocaleString('en-US')}:`, '', ...markdownTable(columns, rows));
    }
  }

  if (result.warnings?.length) {
    lines.push('', 'Helper warnings (from the script\'s warn guards):');
    for (const w of result.warnings) {
      lines.push(`  ! ${w.message} — ${w.count} row(s): ${w.rows.join(', ')}${w.count > w.rows.length ? ', …' : ''}`);
    }
  }

  const checks = result.hostChecks;
  if (checks) {
    const notes: string[] = [];
    for (const d of checks.duplicates ?? []) {
      notes.push(
        `  ! ${d.count} duplicate ${d.field} value(s), rows ${d.rows.join(', ')}` +
          (d.values?.length ? ` (e.g. ${d.values.map((v) => JSON.stringify(v)).join(', ')})` : ''),
      );
    }
    for (const e of checks.empty ?? []) notes.push(`  ! ${e.count} empty ${e.field} barcode value(s), rows ${e.rows.join(', ')}`);
    if (checks.urlLike?.count) {
      notes.push(
        `  ! ${checks.urlLike.count} value(s) look like web addresses, e.g. ${checks.urlLike.examples.map((v) => JSON.stringify(v)).join(', ')}`,
      );
    }
    for (const r of checks.render ?? []) notes.push(`  ! Row ${r.row}: ${r.field} would not render as a barcode: ${r.message}`);
    lines.push('', notes.length > 0 ? 'Quality checks on these rows:' : 'Quality checks: no duplicate or empty barcode values, no web addresses.');
    lines.push(...notes);
  }

  if (errors.length === 0) {
    const warnings = result.diagnostics.filter((d) => d.severity !== 'error');
    if (warnings.length > 0) lines.push('', ...formatDiagnostics(warnings, source));
  }
  if (result.scriptReport) lines.push('', ...formatScriptReport(result.scriptReport));
  lines.push('', formatStats(result));
  return lines.join('\n');
}

const kv = (rec: Record<string, unknown>) =>
  Object.entries(rec)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');

function formatScanResult(result: ScanResult | null): string {
  if (!result) return 'not run';
  switch (result.kind) {
    case 'unmatched':
      return 'unmatched: no route\'s `when` was true; nothing set or printed';
    case 'rejected':
      // route -1: the host's `station.accept` cleaning (or an empty `clean` result) refused it before any route ran.
      return result.route < 0
        ? `rejected before any route (station.accept / clean): ${JSON.stringify(result.message)}`
        : `rejected by route ${result.route}: ${JSON.stringify(result.message)}`;
    case 'applied': {
      const parts = [`applied by route ${result.route}`];
      parts.push(Object.keys(result.set).length > 0 ? `set ${kv(result.set)}` : 'sets nothing');
      if (Object.keys(result.keep).length > 0) parts.push(`keep ${kv(result.keep)}`);
      parts.push(result.print ? `print ${result.print.copies} cop${result.print.copies === 1 ? 'y' : 'ies'}` : 'no print');
      if (result.warnings.length > 0) parts.push(`warnings: ${result.warnings.map((w) => JSON.stringify(w)).join('; ')}`);
      return parts.join('; ');
    }
  }
}

/** The answer of simulate_scans: one line per scan (kind, route, set, keep, print, message). */
export function formatScans(result: ScriptPreviewResult, source?: unknown): string {
  const lines: string[] = [...formatSource(result)];
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    lines.push('The script has errors, so no scan ran. Fix these and simulate again:', '');
    lines.push(...formatDiagnostics(result.diagnostics, source));
  } else {
    const scans = result.scans ?? [];
    lines.push(`${scans.length} scan(s), in order, with kept values carried from scan to scan:`, '');
    scans.forEach((s, i) => {
      lines.push(`${i + 1}. ${JSON.stringify(s.scan)} → ${s.error ? `error ${s.error.code}` : formatScanResult(s.result)}`);
      if (s.error) lines.push(...formatRuntimeError(s.error, source).slice(1));
    });
    if (result.error) lines.push('', ...formatRuntimeError(result.error, source));
    const warnings = result.diagnostics.filter((d) => d.severity !== 'error');
    if (warnings.length > 0) lines.push('', ...formatDiagnostics(warnings, source));
  }
  if (result.scriptReport) lines.push('', ...formatScriptReport(result.scriptReport));
  lines.push('', formatStats(result));
  return lines.join('\n');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What to do about refusals whose fix is not in the message itself. */
const NEXT_STEP: Record<string, string> = {
  SCRIPT_INHERITED:
    'This design is a linked copy: it runs its original\'s published script and cannot change it. Omit `scripts` when saving it, and change the script in the original design instead.',
  SCRIPTS_REQUIRE_V2:
    'Set "$schema": "https://label.cleverence.com/schema/label-design.v2.json" (or leave $schema out) to send a scripts block.',
  SCRIPTS_NOT_ALLOWED_IN_BODY:
    'Scripts run in the viewer, not on print-by-body. Save the design (create_design_from_json or update_design_content) and print it by id.',
  ELEMENTS_REQUIRED:
    'Send the elements of the design together with dataFields (get_design returns them), or omit both to change only the script.',
  SCRIPT_INVALID: 'Fix the script problems below (validate_design shows the same list), then save again.',
  SCRIPT_PREVIEW_BUSY: 'Both preview sandboxes are busy. Wait a second and call the tool again.',
  // Printing on a printer (print_to_printer, list_printers, get_print_job).
  PRINTHUB_NOT_LINKED:
    'PrintHub is not set up for this organization yet. In Cleverence Label, the user opens the organization\'s Printers and chooses Add printer, which installs PrintHub on the computer the printer is connected to.',
  PRINTER_NOT_FOUND: 'No printer has that code. Call list_printers and use a code from it.',
  PRINTER_NOT_ACTIVATED: 'The printer was found but not adopted yet, so it has no code to print to. The user adopts it in PrintHub first.',
  NO_REACHABLE_HUB:
    'No PrintHub computer can reach that printer right now. Ask the user to check that the PrintHub computer is on and connected, then call print_to_printer again without idempotencyKey (a refused key keeps its refusal).',
  PRINTER_NOT_IN_SCOPE: 'The printer belongs to another site or organization than the one you named. Leave org and site out, or name the printer\'s own.',
  UNKNOWN_FIELD: 'A key in values is not a field of this design. Call get_design for the field names.',
  BARCODE_VALUE_REQUIRED: 'A barcode on the design has no value. Add its field to values (get_design lists the field names).',
  QUOTA_EXCEEDED: 'This print would pass the label limit for the month. whoami shows what is left. Ask the user before printing fewer labels or buying more.',
  IDEMPOTENCY_KEY_REUSED: 'That idempotencyKey was already used for a different print. Leave idempotencyKey out to make a new job.',
  JOB_NOT_FOUND: 'This account never had a job with that id. Check the jobId that print_to_printer returned, and the org it printed in.',
  JOB_EXPIRED_FROM_HISTORY: 'The job existed and finished, and its details were removed from history (after about seven days).',
  PRINTHUB_UNAVAILABLE: 'PrintHub is not answering. Wait a few seconds and try again.',
};

/**
 * An API refusal as text an agent can act on: the message, the code and status,
 * the plan that unlocks a blocked feature and what was blocked, script
 * diagnostics with carets (when `source` is the design that was sent), and the
 * next step for the script-specific refusals.
 */
export function formatApiError(error: ApiError, source?: unknown): string {
  const lines = [error.message, `Code: ${error.code} (HTTP ${error.status})`];
  const details = isRecord(error.details) ? error.details : undefined;

  if (details) {
    const tier = details.requiredTier;
    if (isRecord(tier)) {
      lines.push(`Required plan: ${String(tier.displayName ?? tier.internalName)}${tier.internalName ? ` (${String(tier.internalName)})` : ''}`);
    } else if (typeof tier === 'string') {
      lines.push(`Required plan: ${tier}`);
    }
    if (Array.isArray(details.blocked) && details.blocked.length > 0) {
      lines.push('Blocked by the plan:');
      for (const b of details.blocked) {
        if (isRecord(b)) {
          const label = String(b.label ?? b.featurePath ?? 'feature');
          lines.push(`  ✗ ${label}${b.featurePath ? ` (${String(b.featurePath)})` : ''}`);
        }
      }
      if (details.blocked.some((b) => isRecord(b) && b.featurePath === 'features.labelScripts')) {
        lines.push(
          'Adding or changing a label script needs Professional or higher. Running scripts is free; removing one (scripts: null) is always allowed.',
        );
      }
    }
    if (tier !== undefined && details.feature === 'managedPrinting') {
      lines.push(
        'Printing on a printer through PrintHub needs Professional or higher, on the plan of the organization owner. Listing printers and reading jobs work on every plan.',
      );
    }
    if (Array.isArray(details.sentJobIds) && details.sentJobIds.length > 0) {
      lines.push(
        `Some labels were already sent before the refusal. Do not print them again. Jobs sent: ${details.sentJobIds.map(String).join(', ')}`,
      );
    }
    if (Array.isArray(details.diagnostics) && details.diagnostics.length > 0) {
      lines.push(...formatDiagnostics(details.diagnostics as ScriptDiagnostic[], source));
    }
    if (isRecord(details.scriptsSource)) {
      const src = details.scriptsSource;
      lines.push(
        `Script source: "${String(src.designName ?? '')}" (${String(src.designId ?? '')})${src.unavailable ? ', no longer available' : ''}`,
      );
    }
  }

  const next = NEXT_STEP[error.code];
  if (next) lines.push(next);
  if (error.requestId) lines.push(`Request id: ${error.requestId}`);
  return lines.join('\n');
}

/**
 * Runs a tool handler and turns an `ApiError` into an error result whose text
 * carries the code and details. Other errors (not connected, network) are
 * re-thrown unchanged, so their messages reach the agent as before.
 */
export async function withApiErrors<T>(
  run: () => Promise<T>,
  source?: unknown,
): Promise<T | { isError: true; content: { type: 'text'; text: string }[] }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      return { isError: true, content: [{ type: 'text', text: formatApiError(error, source) }] };
    }
    throw error;
  }
}
