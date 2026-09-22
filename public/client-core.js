export const STAGES = ['explain', 'example', 'guided_practice', 'socratic_check', 'recap', 'ended'];
export const STAGE_LABELS = { explain: 'Explore', example: 'Predict', guided_practice: 'Experiment', socratic_check: 'Explain', recap: 'Reflect', ended: 'Complete' };
export const ANSWER_LABELS = { explain: 'Share a thought', example: 'Share prediction', guided_practice: 'Share observation', socratic_check: 'Explain my reasoning', recap: 'Save reflection', ended: 'Lesson complete' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function stageProgress(stage) {
  const index = STAGES.indexOf(stage);
  return index < 0 ? 0 : Math.round(index / (STAGES.length - 1) * 100);
}

export function providerPresentation(provider) {
  if (!provider) return { label: 'Service unavailable', tone: 'warning', detail: 'Reconnect to the School service to continue.' };
  if (provider.mode === 'demo') return { label: 'Authored demo', tone: 'demo', detail: 'Prepared mentor responses. This lesson works without a live AI provider.' };
  if (!provider.available) return { label: 'AI unavailable', tone: 'warning', detail: provider.reason || 'The configured provider is unavailable. Your saved lessons remain here.' };
  if (provider.lastOutcome === 'failed') return { label: 'AI needs attention', tone: 'warning', detail: provider.reason || 'The last response failed. You can retry without losing your lesson.' };
  if (provider.lastOutcome === 'running') return { label: 'AI responding', tone: 'pending', detail: 'A response is in progress. Its result has not yet been confirmed.' };
  if (provider.lastOutcome === 'cancelled') return { label: 'AI response stopped', tone: 'pending', detail: 'The last response was cancelled. You can send a new message.' };
  if (provider.lastOutcome !== 'succeeded' || !provider.lastSucceededAt) return { label: 'AI configured · unverified', tone: 'pending', detail: provider.reason || 'A live response has not yet been verified in this service session.' };
  return { label: 'Live AI', tone: 'live', detail: provider.reason || 'Mentor responses come from the server’s configured AI provider.' };
}

export function normalDimensions(values) {
  if (!Array.isArray(values) || values.length !== 3 || values.some(value => !Number.isFinite(value) || value < 0.25 || value > 4)) return [1, 1, 1];
  return [...values];
}

export function dimensionsEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3 && a.every((value, index) => value === b[index]);
}

export function volumeOf(dimensions) { return normalDimensions(dimensions).reduce((product, value) => product * value, 1); }
export function numberLabel(value) { return Number.isFinite(value) ? new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value) : '—'; }
export function isPendingTurn(turn) { return Boolean(turn && turn.status === 'running'); }
export function makeRequestId() { return globalThis.crypto.randomUUID(); }

export function formatSavedAt(value) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) : 'Saved on this PC';
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'request_failed', uncertain = false } = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.uncertain = uncertain;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  return async function request(path, body, { signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'same-origin', signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(data?.error || `The service returned an error (${response.status}).`, { status: response.status, code: data?.code });
      if (!data || data.apiVersion !== 1) throw new ApiError('This School service returned an incompatible response. Refresh after checking its version.', { code: 'incompatible_response', uncertain: body !== undefined });
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError('The request took too long. Check the service, then retry the same request.', { code: 'request_timeout', uncertain: body !== undefined });
      throw new ApiError('Cannot reach the School service. Keep this page open and retry when it is running.', { code: 'network_error', uncertain: body !== undefined });
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    }
  };
}
