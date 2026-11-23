const DEFAULT_BASE = 'https://label.cleverence.com';

/** Compares dotted numeric versions, like a comparator: <0, 0 or >0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Kept in step with package.json; sent on every request so the server can
 *  attribute traffic to this client and flag installs that are too old. */
export const CLIENT_NAME = 'barcode-label-mcp';
export const CLIENT_VERSION = '1.8.1';

/**
 * A refusal from the API, with the machine-readable parts kept.
 *
 * `message` is the server's sentence. `code` (e.g. FEATURE_REQUIRES_UPGRADE,
 * SCRIPT_INVALID, SCRIPT_INHERITED) and `details` (e.g. `requiredTier`,
 * `blocked`, `diagnostics`) are what an agent needs to fix the request, so tool
 * handlers render them with `formatApiError` instead of dropping them.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(message: string, init: { status: number; code?: string; details?: unknown; requestId?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code ?? `HTTP_${init.status}`;
    if (init.details !== undefined) this.details = init.details;
    if (init.requestId) this.requestId = init.requestId;
  }
}

type ErrorEnvelope = {
  ok?: boolean;
  error?: { code?: string; message?: string; details?: unknown } & Record<string, unknown>;
};

/**
 * The details of a refusal. Most routes put them in `error.details`; the print
 * routes put them beside the code (`requiredTier`, `feature`, `sentJobIds`), so
 * those fields stand in for `details` when it is absent.
 */
function detailsOf(error: NonNullable<ErrorEnvelope['error']>): unknown {
  if (error.details !== undefined) return error.details;
  const { code: _code, message: _message, details: _details, ...rest } = error;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export class CleverenceLabelApi {
  private baseUrl: string;
  /** Null until the user connects: the server can now start without a key. */
  private apiKey: string | null;
  /** Warn once per process, not once per call. */
  private warnedOutdated = false;
  /**
   * The authorization in flight, held here rather than in the connect tools so
   * that a grant started by a failed call and one started by `connect` are the
   * same grant.
   */
  private pending: DeviceGrant | null = null;

  constructor(apiKey: string | null, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  }

  get base(): string {
    return this.baseUrl;
  }

  hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  /** Adopts a key obtained mid-session, so `connect` works without a restart. */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.pending = null;
  }

  getPendingGrant(): DeviceGrant | null {
    if (this.pending && new Date(this.pending.expiresAt) < new Date()) {
      this.pending = null;
    }
    return this.pending;
  }

  /**
   * Returns the authorization link, starting a grant only if there is not
   * already a live one. Several tools failing in a row must not produce
   * several different links for the user to choose between.
   */
  async startOrReusePendingGrant(): Promise<DeviceGrant> {
    const live = this.getPendingGrant();
    if (live) return live;

    this.pending = await this.startDeviceAuth();
    return this.pending;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!this.apiKey) {
      // Start the authorization here rather than telling the agent to go and
      // run `connect`. That instruction costs a round trip the agent has to
      // take on its own initiative, and in practice it often just relays the
      // instruction to the user and stops — leaving them with no link. Putting
      // a real link in the failure makes the first attempt actionable.
      let grant: DeviceGrant | null = null;
      try {
        grant = await this.startOrReusePendingGrant();
      } catch {
        // Offline, or the service is down. Fall through to the plain message.
      }

      throw new Error(
        grant
          ? [
              'Not connected to Cleverence Label — one approval and you are in.',
              '',
              'Show the user this link and ask them to approve it:',
              `  ${grant.verificationUrlComplete}`,
              '',
              `Confirmation code: ${grant.userCode}`,
              'They can sign in or create a free account; either one works.',
              '',
              'Then call finish_connecting and retry. No API key to copy.',
            ].join('\n')
          : 'Not connected to Cleverence Label, and the authorization service could not ' +
            'be reached. Check the connection, then run the `connect` tool, or set ' +
            'CLEVERENCE_LABEL_DESIGN_KEY if you already have a key.',
      );
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      // Without this the server cannot tell MCP traffic from curl, which makes
      // both usage reporting and old-client detection impossible.
      'x-cleverence-client': `${CLIENT_NAME}/${CLIENT_VERSION}`,
      'user-agent': `${CLIENT_NAME}/${CLIENT_VERSION}`,
    };
    if (body) {
      headers['content-type'] = 'application/json';
    }
    Object.assign(headers, extraHeaders);

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    this.checkServerVersion(res);

    const requestId = res.headers.get('x-request-id') ?? undefined;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed: ErrorEnvelope | null = null;
      try {
        parsed = JSON.parse(text) as ErrorEnvelope;
      } catch {
        // Not JSON: a proxy page or an empty body.
      }
      const err = parsed?.error;
      throw new ApiError(err?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`, {
        status: res.status,
        code: err?.code,
        details: err ? detailsOf(err) : undefined,
        requestId,
      });
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as { ok: boolean; data?: T } & ErrorEnvelope;
      if (!json.ok && json.error) {
        throw new ApiError(json.error.message ?? 'Request failed', {
          status: res.status,
          code: json.error.code,
          details: detailsOf(json.error),
          requestId,
        });
      }
      return json.data as T;
    }

    return (await res.text()) as unknown as T;
  }

  /**
   * Notices when this install has fallen behind what the server supports.
   *
   * `npx -y` normally fetches the latest, but a pinned version or a cached
   * install can sit on a machine for months, so an old client is an ordinary
   * situation rather than an exceptional one. The warning goes to stderr:
   * stdout carries the MCP protocol and must not be polluted.
   */
  private checkServerVersion(res: Response): void {
    if (this.warnedOutdated) return;

    const minimum = res.headers.get('x-min-client-version');
    if (!minimum || compareVersions(CLIENT_VERSION, minimum) >= 0) return;

    this.warnedOutdated = true;
    console.error(
      `[cleverence-label] This MCP server is ${CLIENT_VERSION}, but ${this.baseUrl} ` +
        `now requires ${minimum} or newer. Some tools may not work correctly. ` +
        `Update with: npx -y @cleverence/barcode-label-mcp@latest`,
    );
  }

  // ── Device authorization ──────────────────────────────────────────
  //
  // These two deliberately bypass request(): they are the calls made when
  // there is no key yet, so they must not go through the guard above.

  async startDeviceAuth(scopes?: string[]): Promise<DeviceGrant> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/device`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cleverence-client': `${CLIENT_NAME}/${CLIENT_VERSION}`,
        'user-agent': `${CLIENT_NAME}/${CLIENT_VERSION}`,
      },
      body: JSON.stringify({ clientName: `${CLIENT_NAME} ${CLIENT_VERSION}`, scopes }),
    });

    const json = (await res.json()) as {
      ok: boolean;
      data?: DeviceGrant;
      error?: { message: string };
    };

    if (!res.ok || !json.ok || !json.data) {
      throw new Error(json.error?.message ?? `Could not start authorization (HTTP ${res.status})`);
    }
    return json.data;
  }

  /** One poll. Returns null while the user has not answered yet. */
  async pollDeviceAuth(deviceCode: string): Promise<DeviceToken | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/device/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cleverence-client': `${CLIENT_NAME}/${CLIENT_VERSION}`,
      },
      body: JSON.stringify({ deviceCode }),
    });

    const json = (await res.json()) as {
      ok: boolean;
      data?: DeviceToken;
      error?: { code: string; message: string };
    };

    if (json.ok && json.data) return json.data;

    // Still waiting is the expected case, not a failure.
    if (json.error?.code === 'AUTHORIZATION_PENDING' || json.error?.code === 'SLOW_DOWN') {
      return null;
    }

    throw new Error(json.error?.message ?? `Authorization failed (HTTP ${res.status})`);
  }

  // ── Keys ──────────────────────────────────────────────────────────

  async listApiKeys() {
    return this.request<{ keys: ApiKeyInfo[] }>('GET', '/api/v1/keys');
  }

  /** `self` revokes the key making the call and needs no extra scope. */
  async revokeApiKey(id = 'self') {
    return this.request<RevokedKey>('DELETE', `/api/v1/keys/${id}`);
  }

  // ── Auth ──────────────────────────────────────────────────────────

  async whoami() {
    return this.request<{
      userId: string;
      name: string;
      email: string;
      tier: string;
      scopes?: string[];
      api?: {
        version: string;
        minClientVersion: string;
      };
      usage: {
        designsUsed: number;
        designsLimit: number | null;
        designsRemaining: number | null;
        monthlyLabelsUsed?: number;
        monthlyLabelsLimit: number | null;
        monthlyLabelsRemaining?: number | null;
        monthlyAIGenerationsUsed?: number;
        monthlyAIGenerationsLimit: number | null;
      };
      createdAt: string;
    }>('GET', '/api/v1/whoami');
  }

  async invite(email: string, source: string) {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, source }),
    });
    const json = (await res.json()) as { ok: boolean; message?: string; error?: { message: string } };
    if (!json.ok && json.error) throw new Error(json.error.message);
    return { message: json.message ?? 'Invitation sent' };
  }

  // ── Designs ───────────────────────────────────────────────────────

  async listDesigns(includeDeleted = false) {
    const qs = includeDeleted ? '?includeDeleted=true' : '';
    return this.request<DesignSummary[]>('GET', `/api/v1/designs${qs}`);
  }

  async createDesign(input: CreateDesignInput) {
    return this.request<CreatedDesign>('POST', '/api/v1/designs', input);
  }

  async getDesign(id: string) {
    return this.request<DesignDetail>('GET', `/api/v1/designs/${id}`);
  }

  async updateDesign(id: string, input: UpdateDesignInput) {
    return this.request<UpdatedDesign>('PUT', `/api/v1/designs/${id}`, input);
  }

  async deleteDesign(id: string) {
    return this.request<void>('DELETE', `/api/v1/designs/${id}`);
  }

  // ── Embed / Render / Thumbnail ────────────────────────────────────

  async getEmbedCode(id: string, format: 'iframe' | 'html' = 'iframe', width = 360) {
    return this.request<{ format: string; code: string }>(
      'GET',
      `/api/v1/designs/${id}/embed?format=${format}&width=${width}`,
    );
  }

  async getThumbnailUrl(id: string): Promise<string> {
    return `${this.baseUrl}/api/v1/designs/${id}/thumbnail`;
  }

  /**
   * Builds the render URL without rendering.
   *
   * This used to fetch the URL to check it worked, then hand the same URL back
   * for the caller to fetch again. Now that a render consumes a label, that
   * verification would bill the user twice for one picture, so the check is
   * gone and the single render happens when someone actually wants the file.
   */
  renderUrl(id: string, format: 'pdf' | 'png' | 'svg' | 'html' = 'png'): string {
    return `${this.baseUrl}/api/v1/designs/${id}/render?format=${format}`;
  }

  // ── Templates ─────────────────────────────────────────────────────

  async listTemplates() {
    return this.request<Template[]>('GET', '/api/v1/templates');
  }

  // ── Authoring ─────────────────────────────────────────────────────

  /**
   * Checks a design you authored and returns it repaired. Runs no model and
   * saves nothing, so it costs no AI quota.
   */
  async validateDesign(design: unknown, renderCheck = true) {
    const qs = renderCheck ? '' : '?renderCheck=false';
    return this.request<ValidationResult>('POST', `/api/v1/designs/validate${qs}`, design);
  }

  /**
   * Dry-runs a label script (the design's `scripts` block) without saving or
   * printing: generator rows, or a sequence of simulated scans. Unmetered.
   */
  async previewScript(input: ScriptPreviewInput) {
    return this.request<ScriptPreviewResult>('POST', '/api/v1/scripts/preview', input);
  }

  /**
   * The published JSON Schema for a label design: v2, which adds the optional
   * `scripts` block (v1 documents remain valid v2 documents).
   */
  async getDesignSchema(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/schema/label-design.v2.json`);
    if (!res.ok) throw new Error(`Could not fetch design schema: HTTP ${res.status}`);
    return res.text();
  }

  /** A published agent skill, as markdown. */
  async getSkill(slug: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/skills/${slug}.md`);
    if (!res.ok) throw new Error(`Could not fetch skill "${slug}": HTTP ${res.status}`);
    return res.text();
  }

  // ── Printing on a printer (PrintHub) ──────────────────────────────

  /**
   * The printing points of the caller's organization, or of the one `org`
   * names. Any valid key may call it, on every plan.
   */
  async listPrinters(input: { org?: string; site?: string; state?: PrinterStateFilter } = {}) {
    return this.request<Printer[]>('GET', `/api/v1/printers${query(input)}`);
  }

  /**
   * Queues a design on a printer through PrintHub. The key goes in the
   * `Idempotency-Key` header: the same key on a retry gets the same job, never
   * a second print.
   */
  async printDesign(id: string, input: PrintDesignInput, idempotencyKey: string) {
    return this.request<PrintSubmitted>('POST', `/api/v1/designs/${encodeURIComponent(id)}/print`, input, {
      'idempotency-key': idempotencyKey,
    });
  }

  /** What happened to a print job. */
  async getPrintJob(jobId: string, input: { org?: string; site?: string } = {}) {
    return this.request<PrintJob>('GET', `/api/v1/print-jobs/${encodeURIComponent(jobId)}${query(input)}`);
  }

  // ── Integration Snippets ──────────────────────────────────────────

  async getSnippets() {
    return this.request<IntegrationSnippets>('GET', '/api/v1/integration/snippets');
  }
}

/** `?a=1&b=2` from the defined values, or an empty string. */
function query(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const text = qs.toString();
  return text ? `?${text}` : '';
}

// ── Types ─────────────────────────────────────────────────────────────

export type ApiKeyInfo = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  isCurrent: boolean;
};

export type RevokedKey = {
  id: string;
  name: string;
  revoked: boolean;
  alreadyRevoked: boolean;
  selfRevoked?: boolean;
};

export type DeviceGrant = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Same url with the code pre-filled, so the user only has to confirm. */
  verificationUrlComplete: string;
  expiresAt: string;
  /** Seconds to wait between polls. */
  interval: number;
};

export type DeviceToken = {
  apiKey: string;
  keyId: string;
  scopes: string[];
};

export type DesignSummary = {
  id: string;
  name: string;
  author: string;
  description: string;
  folder: string;
  isPublic: boolean;
  isDeleted: boolean;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string;
};

export type DesignDetail = DesignSummary & {
  elements: unknown[];
  dataFields: unknown[];
  /** The label script (CLS/1), or null. For a linked copy, its original's published script. */
  scripts?: Record<string, unknown> | null;
  /** Set when the script is inherited from another design. */
  scriptsSource?: ScriptsSource | null;
  isOwner: boolean;
  designerUrl: string;
  viewerUrl: string;
};

export type CreateDesignInput = {
  name: string;
  templateId?: string;
  width?: number;
  height?: number;
  isPublic?: boolean;
  description?: string;
  elements?: unknown[];
  dataFields?: unknown[];
  $schema?: string;
  /** A label script (CLS/1). Adding one needs Professional or higher. */
  scripts?: Record<string, unknown>;
};

export type UpdateDesignInput = {
  name?: string;
  description?: string;
  isPublic?: boolean;
  folder?: string;
  elements?: unknown[];
  dataFields?: unknown[];
  $schema?: string;
  /** Omit to keep the stored script, null to remove it; a changed script needs Professional. */
  scripts?: Record<string, unknown> | null;
  message?: string;
};

export type UpdatedDesign = {
  id: string;
  updated: string[];
  versionId?: string | number;
  validation?: ValidationSummary;
  designerUrl: string;
  viewerUrl: string;
  thumbnailUrl: string;
};

export type ValidationIssue = {
  severity: 'error' | 'warning';
  message: string;
  element?: string;
  field?: string;
  /** Label script issues: the diagnostic code, e.g. E_UNKNOWN_FIELD. */
  code?: string;
  /** Label script issues: JSON Pointer from the design root, e.g. /scripts/generate/emit/Location. */
  path?: string;
  /** Label script issues: 1-based column inside the expression cell. */
  col?: number;
  /** Label script issues: a concrete rewrite or did-you-mean. */
  hint?: string;
};

/** What a label script does, from the static check. */
export type ScriptReport = {
  staticRowBound: number | null;
  fieldsWritten: string[];
  inputFieldsNotSet: string[];
  capabilities: string[];
  urlLiterals: string[];
};

/** A static or runtime problem in a label script. */
export type ScriptDiagnostic = {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  col?: number;
  message: string;
  hint?: string;
  data?: Record<string, string | number>;
};

export type ScriptRuntimeError = ScriptDiagnostic & {
  operatorMessage: string;
  row?: number;
  bindings?: Record<string, string>;
  steps: number;
};

export type ScriptsSource = {
  designId: string;
  designName: string;
  versionId: string | null;
  inherited: boolean;
  unavailable?: boolean;
};

export type ScanResult =
  | { kind: 'unmatched' }
  | { kind: 'rejected'; route: number; message: string }
  | {
      kind: 'applied';
      route: number;
      set: Record<string, string>;
      keep: Record<string, string | number | boolean | null>;
      print: { copies: number } | null;
      warnings: string[];
      uids: string[];
    };

export type ScriptPreviewInput = {
  design?: Record<string, unknown>;
  designId?: string;
  event: 'generate' | 'scan';
  params?: Record<string, unknown>;
  tables?: Record<string, Record<string, unknown>[]>;
  scans?: string[];
  base?: Record<string, string>;
  limit?: number;
  seed?: string;
  clock?: string;
};

/** Host quality checks on generated rows (duplicate and empty barcode values, web-address-like values). */
export type ScriptHostChecks = {
  /** Barcode-bound fields with repeated values: rows repeating an earlier value (first 20) and examples. */
  duplicates: { field: string; count: number; rows: number[]; values?: string[] }[];
  /** Barcode-bound fields left empty. */
  empty: { field: string; count: number; rows: number[] }[];
  urlLike: { count: number; examples: string[] };
  render?: { row: number; field: string; message: string }[];
};

export type ScriptPreviewResult = {
  ok: boolean;
  seeded: boolean;
  diagnostics: ScriptDiagnostic[];
  scriptReport: ScriptReport | null;
  count?: number;
  exact?: boolean;
  rowCount?: number;
  columns?: string[];
  rows?: Record<string, string>[];
  warnings?: { message: string; rows: number[]; count: number }[];
  hostChecks?: ScriptHostChecks;
  scans?: { scan: string; result: ScanResult | null; error?: ScriptRuntimeError }[];
  error?: ScriptRuntimeError;
  stats: { steps: number; stepBudget: number; ms: number };
  designId?: string;
  scriptsSource?: ScriptsSource | null;
};

export type ValidationSummary = {
  valid: boolean;
  schema: string;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  fixed: string[];
};

export type ValidationResult = ValidationSummary & {
  /** Present when the design carries a label script. */
  scriptReport?: ScriptReport;
  summary: {
    elementCount: number;
    dataFieldCount: number;
    width: number;
    height: number;
    renderCheck: boolean;
  };
  design: Record<string, unknown>;
};

export type CreatedDesign = {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  isPublic: boolean;
  createdAt: string;
  templateId?: string;
  elementCount?: number;
  validation?: ValidationSummary;
  designerUrl: string;
  viewerUrl: string;
  thumbnailUrl: string;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  category: string;
  dataFields: { id: string; name: string; type: string; sampleValue: string }[];
  elementCount: number;
  thumbnailUrl: string;
};

export type IntegrationSnippets = {
  iframe: string;
  thumbnail: string;
  links: {
    designer: string;
    viewer: string;
    embed: string;
    thumbnail: string;
  };
  serverProxy: string;
};

export type PrinterStateFilter = 'activated' | 'discovered' | 'all';

/** One printing point, as GET /api/v1/printers returns it. */
export type Printer = {
  /** What a print job names; null while the point is not adopted. */
  code: string | null;
  name: string | null;
  activated: boolean;
  /** PrintHub's state: Online, Warning, Error, Offline, NotReporting or Unknown. */
  state: string;
  /** The Hubs (client codes) that can reach it. */
  reachableFrom: string[];
  /** printLanguage, dpiX, dpiY, mediaSizeName, mediaWidth/mediaHeight (hundredths of an inch). */
  renderProfile: Record<string, unknown> | null;
  rfid?: { eligible: boolean; reason: string | null };
  /** The site slug it prints at. */
  site: string | null;
};

export type PrintDesignInput = {
  printer: string;
  copies?: number;
  values?: Record<string, string | number | boolean | null>;
  org?: string;
  site?: string;
};

export type PrintSubmitted = {
  jobId: string;
  state: string;
  format?: string;
  /** Present when a counter gave each label its own number: one job per label. */
  jobIds?: string[];
  /** The counter numbers the labels got, one entry per label. */
  counters?: Record<string, string | null>[];
};

export type PrintJob = {
  jobId: string;
  /** Pending, Dispatched, Succeeded, Failed, Cancelled or Expired. */
  state: string;
  printer: string | null;
  copies: number;
  attempts: number;
  createdAt: string | null;
  completedAt: string | null;
  error: string | null;
};
