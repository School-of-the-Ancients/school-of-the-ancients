/** Server-side local companion client. No School domain types or Apply authority. */
export interface MatrixDiscovery {
  protocolVersion: '1'; service: string; transport: string; pairingAvailable: boolean;
  pairingReason?: string | null; capabilities: Record<string, unknown>;
  limits?: Record<string, number>; retention?: string;
}
export interface MatrixScene {
  protocolVersion: '1'; sessionId: string; runtimeSessionId: string; revision: number;
  snapshot: Record<string, unknown>; runtime: Record<string, unknown>;
}
export type MatrixRequestStatus = 'planning' | 'ready' | 'queued' | 'running' | 'succeeded' |
  'failed' | 'partial' | 'cancelled' | 'stale' | 'unconfirmed' | 'needs_clarification' | 'review_only' | 'error';
export interface MatrixOutcome {
  protocolVersion: '1'; sessionId: string; runtimeSessionId: string; requestId: string;
  correlationId?: string | null; sequence: number; status: MatrixRequestStatus; requiresApply: boolean;
  proposal: Record<string, unknown> | null; commandIds: string[];
  receipts: Array<{ requestId: string; ok: boolean; error: string; objectId: string }>;
  observed: { revision: number; snapshot: Record<string, unknown> } | { revision: number; savedScene: string } | null;
  error: string | null;
}
export interface MatrixPairing {
  protocolVersion: '1'; sessionId: string; runtimeSessionId: string;
  clientToken: string; expiresInSeconds: number;
}
export interface MatrixClientOptions { timeoutMs?: number; maxResponseBytes?: number; fetch?: typeof fetch; }

export class MatrixClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly outcomeUnknown: boolean;
  readonly requestId?: string;
  constructor(code: string, message: string, options: { status?: number; outcomeUnknown?: boolean; requestId?: string } = {}) {
    super(message); this.name = 'MatrixClientError'; this.code = code;
    this.status = options.status; this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.requestId = options.requestId;
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const STATUSES = new Set<MatrixRequestStatus>(['planning','ready','queued','running','succeeded','failed','partial','cancelled','stale','unconfirmed','needs_clarification','review_only','error']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new MatrixClientError('invalid_response', message);
}
function identifier(value: string, name: string): void {
  if (!IDENTIFIER.test(value)) throw new MatrixClientError('invalid_request', `${name} must be a bounded stable identifier.`);
}
function baseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new MatrixClientError('invalid_url', 'Matrix needs a valid local HTTP address.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!local || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new MatrixClientError('invalid_url', 'This initial connector accepts a loopback HTTP(S) origin only, without embedded credentials.');
  }
  return url;
}

class Transport {
  #base: URL;
  #fetch: typeof fetch;
  #timeout: number;
  #maxBytes: number;
  constructor(url: string, options: MatrixClientOptions) {
    this.#base = baseUrl(url); this.#fetch = options.fetch ?? fetch;
    this.#timeout = options.timeoutMs ?? 10_000; this.#maxBytes = options.maxResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 120_000 ||
        !Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1 || this.#maxBytes > 8_388_608) {
      throw new MatrixClientError('invalid_options', 'Transport limits are outside the supported range.');
    }
  }
  async send(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; token?: string; requestId?: string; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const mutation = options.method === 'POST';
    const failed = (code: string, message: string) => new MatrixClientError(code, message, { outcomeUnknown: mutation, requestId: options.requestId });
    try {
      if (options.signal?.aborted) {
        throw new MatrixClientError('cancelled', 'Request was cancelled before dispatch.', { requestId: options.requestId });
      }
      let response: Response;
      try {
        response = await this.#fetch(new URL(path, this.#base), {
          method: options.method ?? 'GET', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch {
        throw failed(controller.signal.aborted ? 'timeout_or_cancelled' : 'transport_error', mutation
          ? 'Matrix did not return a confirmed result. Query the same request ID before retrying; do not replay after re-pairing.'
          : 'Matrix could not be reached or the request was interrupted.');
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > this.#maxBytes) { controller.abort(); throw failed('response_too_large', 'Matrix response exceeded the configured size limit.'); }
      const reader = response.body?.getReader();
      if (!reader) throw failed('invalid_response', 'Matrix returned an empty response.');
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > this.#maxBytes) { await reader.cancel(); throw failed('response_too_large', 'Matrix response exceeded the configured size limit.'); }
          chunks.push(next.value);
        }
      } catch (error) {
        if (error instanceof MatrixClientError) throw error;
        throw failed('transport_error', 'Matrix response was interrupted; reconcile an in-flight request before retrying.');
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failed('invalid_response', 'Matrix returned malformed JSON.'); }
      if (!object(body)) throw failed('invalid_response', 'Matrix response must be an object.');
      if (!response.ok) {
        // Do not reflect server text, credentials, HTML, or room data into application errors.
        const code = typeof body.code === 'string' && /^[a-z_]{1,64}$/.test(body.code) ? body.code : 'http_error';
        throw new MatrixClientError(code, `Matrix rejected the request (HTTP ${response.status}).`, { status: response.status, requestId: options.requestId, outcomeUnknown: mutation && response.status >= 500 });
      }
      if (body.protocolVersion !== '1') throw failed('protocol_mismatch', 'Matrix returned an unsupported protocol version.');
      return body;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    }
  }
}

export class MatrixClient {
  #transport: Transport;
  #token: string;
  #sessionId: string;
  #runtimeSessionId: string;
  #lastSequence = new Map<string, number>();
  private constructor(transport: Transport, pairing: MatrixPairing) {
    this.#transport = transport; this.#token = pairing.clientToken;
    this.#sessionId = pairing.sessionId; this.#runtimeSessionId = pairing.runtimeSessionId;
  }
  static async discover(url: string, options: MatrixClientOptions = {}): Promise<MatrixDiscovery> {
    const result = await new Transport(url, options).send('/api/v1/discovery');
    requireValue(result.service === 'matrix-loading-operator' && object(result.capabilities) && typeof result.pairingAvailable === 'boolean', 'Invalid Matrix discovery response.');
    return result as unknown as MatrixDiscovery;
  }
  static async pair(url: string, pairingCode: string, options: MatrixClientOptions = {}): Promise<MatrixClient> {
    if (typeof pairingCode !== 'string' || pairingCode.length < 1 || pairingCode.length > 128) throw new MatrixClientError('invalid_pairing', 'Use a current pairing code from the local Matrix Operator.');
    const transport = new Transport(url, options);
    const result = await transport.send('/api/v1/sessions', { method: 'POST', body: { pairingCode } });
    try {
      requireValue(typeof result.clientToken === 'string' && result.clientToken.length >= 16 && typeof result.sessionId === 'string' && typeof result.runtimeSessionId === 'string', 'Matrix pairing response is incomplete.');
      requireValue(typeof result.expiresInSeconds === 'number' && result.expiresInSeconds > 0, 'Matrix pairing expiry is invalid.');
    } catch { throw new MatrixClientError('invalid_response', 'Pairing returned incomplete data; its one-use code may already be consumed.', { outcomeUnknown: true }); }
    return new MatrixClient(transport, result as unknown as MatrixPairing);
  }
  /** Safe metadata only; the bearer token is never serialized or exposed to browser UI. */
  get session(): { sessionId: string; runtimeSessionId: string } { return { sessionId: this.#sessionId, runtimeSessionId: this.#runtimeSessionId }; }
  async scene(signal?: AbortSignal): Promise<MatrixScene> {
    const result = await this.#transport.send('/api/v1/scene', { token: this.#token, signal });
    this.#bound(result);
    requireValue(Number.isSafeInteger(result.revision) && (result.revision as number) >= 0 && object(result.snapshot), 'Matrix scene is missing its authoritative revision or snapshot.');
    return result as unknown as MatrixScene;
  }
  async propose(text: string, options: { requestId: string; revision: number; correlationId?: string; signal?: AbortSignal }): Promise<MatrixOutcome> {
    identifier(options.requestId, 'requestId');
    if (options.correlationId !== undefined) identifier(options.correlationId, 'correlationId');
    if (typeof text !== 'string' || !text.trim() || text.length > 4000 || !Number.isSafeInteger(options.revision) || options.revision < 0) {
      throw new MatrixClientError('invalid_request', 'Use a bounded scene request and current nonnegative revision.');
    }
    const result = await this.#transport.send('/api/v1/requests', {
      method: 'POST', token: this.#token, requestId: options.requestId, signal: options.signal,
      body: { requestId: options.requestId, ...(options.correlationId ? { correlationId: options.correlationId } : {}),
        expected: { runtimeSessionId: this.#runtimeSessionId, revision: options.revision }, intent: { text, mode: 'offline-rules' } },
    });
    return this.#mutationOutcome(result, options.requestId);
  }
  async outcome(requestId: string, signal?: AbortSignal): Promise<MatrixOutcome> {
    identifier(requestId, 'requestId');
    return this.#outcome(await this.#transport.send(`/api/v1/requests/${encodeURIComponent(requestId)}`, { token: this.#token, requestId, signal }), requestId);
  }
  async cancel(requestId: string, signal?: AbortSignal): Promise<MatrixOutcome> {
    identifier(requestId, 'requestId');
    return this.#mutationOutcome(await this.#transport.send(`/api/v1/requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST', body: {}, token: this.#token, requestId, signal }), requestId);
  }
  #mutationOutcome(result: Record<string, unknown>, requestId: string): MatrixOutcome {
    try { return this.#outcome(result, requestId); }
    catch (error) {
      if (error instanceof MatrixClientError) throw new MatrixClientError(error.code, error.message + ' The mutation may have been accepted; reconcile its request ID.', { status: error.status, requestId, outcomeUnknown: true });
      throw error;
    }
  }
  #bound(result: Record<string, unknown>): void {
    requireValue(result.sessionId === this.#sessionId && result.runtimeSessionId === this.#runtimeSessionId, 'Matrix response belongs to another pairing or runtime.');
  }
  #outcome(result: Record<string, unknown>, requestId: string): MatrixOutcome {
    this.#bound(result);
    requireValue(result.requestId === requestId && Number.isSafeInteger(result.sequence) && (result.sequence as number) >= 0 && STATUSES.has(result.status as MatrixRequestStatus), 'Matrix outcome identity/status is invalid.');
    requireValue(typeof result.requiresApply === 'boolean' && Array.isArray(result.commandIds) && result.commandIds.every(id => typeof id === 'string') && Array.isArray(result.receipts), 'Matrix outcome is missing command/receipt information.');
    requireValue(result.receipts.every(receipt => object(receipt) && typeof receipt.requestId === 'string' && typeof receipt.ok === 'boolean' && typeof receipt.error === 'string' && typeof receipt.objectId === 'string'), 'Matrix returned an invalid runtime receipt.');
    requireValue(result.observed === null || (object(result.observed) && Number.isSafeInteger(result.observed.revision) && (result.observed.revision as number) >= 0 && (object(result.observed.snapshot) || typeof result.observed.savedScene === 'string')), 'Matrix returned invalid observed evidence.');
    requireValue((result.proposal === null || object(result.proposal)) && (result.error === null || typeof result.error === 'string'), 'Matrix outcome proposal/error is invalid.');
    const commandIds = result.commandIds as string[];
    const receipts = result.receipts as MatrixOutcome['receipts'];
    requireValue(new Set(commandIds).size === commandIds.length && new Set(receipts.map(receipt => receipt.requestId)).size === receipts.length && receipts.every(receipt => commandIds.includes(receipt.requestId)), 'Matrix returned unrelated or duplicate command receipts.');
    if (result.status === 'ready') requireValue(result.requiresApply === true && object(result.proposal) && result.observed === null, 'A ready proposal must still require owner review.');
    if (result.status === 'succeeded') requireValue(result.requiresApply === false && object(result.observed) && (commandIds.length > 0 ? receipts.length === commandIds.length && receipts.every(receipt => receipt.ok) && object(result.observed.snapshot) : typeof result.observed.savedScene === 'string'), 'A successful result must contain confirmed execution evidence.');
    const last = this.#lastSequence.get(requestId) ?? -1;
    if ((result.sequence as number) < last) throw new MatrixClientError('out_of_order', 'An older Matrix outcome cannot replace a newer observation.', { requestId });
    this.#lastSequence.set(requestId, result.sequence as number);
    return result as unknown as MatrixOutcome;
  }
}
