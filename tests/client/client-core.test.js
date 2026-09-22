import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, escapeHtml, normalDimensions, dimensionsEqual, providerPresentation, stageProgress, safeSourceUrl, volumeOf } from '../../public/client-core.js';
import { scaleDiagram } from '../../public/scale-view.js';

test('model text is escaped and source links only allow credential-free HTTPS', () => {
  assert.equal(escapeHtml('<img onerror="alert(1)">&\''), '&lt;img onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  for (const url of ['javascript:alert(1)', 'http://example.org', 'https://name:secret@example.org', '/relative']) assert.equal(safeSourceUrl(url), null);
  assert.equal(safeSourceUrl('https://example.org/source'), 'https://example.org/source');
});

test('provider state does not equate configuration or demo with a verified live response', () => {
  assert.equal(providerPresentation({ mode: 'demo', available: true, checked: true }).label, 'Authored demo');
  assert.equal(providerPresentation({ mode: 'codex-cli', available: true, checked: false }).label, 'AI configured · unverified');
  assert.equal(providerPresentation({ mode: 'codex-cli', available: false, checked: true }).label, 'AI unavailable');
  assert.equal(providerPresentation({ mode: 'codex-cli', available: true, checked: true }).label, 'AI configured · unverified');
  assert.equal(providerPresentation({ mode: 'codex-cli', available: true, checked: true, lastSucceededAt: '2026-09-22T08:00:00Z', lastOutcome: 'succeeded' }).label, 'Live AI');
  assert.equal(providerPresentation({ mode: 'codex-cli', available: true, lastSucceededAt: '2026-09-22T08:00:00Z', lastOutcome: 'failed' }).label, 'AI needs attention');
});

test('experiment dimensions and volume are bounded, deterministic and safely rendered', () => {
  assert.equal(volumeOf([2, 2, 2]), 8);
  assert.equal(volumeOf([2, 1, 1]), 2);
  assert.equal(volumeOf([0.5, 2, 3]), 3);
  for (const values of [null, [1, 2], [NaN, 1, 1], [Infinity, 1, 1], [0, 1, 1], [1, 1, 500], ['1', 1, 1]]) assert.deepEqual(normalDimensions(values), [1, 1, 1]);
  assert.equal(dimensionsEqual([2, 1, 1], [2, 1, 1]), true);
  assert.equal(dimensionsEqual([2, 1, 1], [1, 2, 1]), false);
  const svg = scaleDiagram([2, 2, 2]);
  assert.match(svg, /2 by 2 by 2 browser units; volume 8 cubic units/);
  assert.match(svg, /8 unit³/);
  assert.doesNotMatch(scaleDiagram(['<script>', 1, 1]), /<script>|NaN/);
  assert.equal(stageProgress('explain'), 0);
  assert.equal(stageProgress('ended'), 100);
  assert.equal(stageProgress('unknown'), 0);
});

test('isometric cuboid paints two adjacent near faces and its top without an open edge', () => {
  const svg = scaleDiagram([2, 2, 2]);
  const faces = [...svg.matchAll(/<polygon points="([^"]+)"/g)].map(match => match[1].split(' '));
  assert.equal(faces.length, 3);
  // The two near planes meet at the front vertical edge, x=width and z=depth.
  const frontBottom = '160.00,217.20';
  const frontTop = '160.00,169.20';
  assert.ok(faces[0].includes(frontBottom) && faces[0].includes(frontTop));
  assert.ok(faces[1].includes(frontBottom) && faces[1].includes(frontTop));
  assert.ok(faces[2].includes(frontTop) && !faces[2].includes(frontBottom));
  assert.deepEqual(faces[0].filter(point => faces[1].includes(point)).sort(), [frontBottom, frontTop].sort());
  const rightmost = '201.76,195.60';
  assert.ok(faces[1].includes(rightmost), 'The near x plane must reach the right-hand bottom corner.');
  assert.match(svg, /polyline points="118\.24,171\.60 160\.00,193\.20 201\.76,171\.60"/);
});

test('API mutations carry JSON and original request id without browser credentials in payload', async () => {
  let call;
  const api = createApiClient({ fetchImpl: async (path, options) => { call = { path, options }; return { ok: true, json: async () => ({ apiVersion: 1, session: {} }) }; } });
  await api('/sessions', { requestId: 'request-1', mentorId: 'galileo', lessonId: 'scale' });
  assert.equal(call.path, '/api/v1/sessions');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.credentials, 'same-origin');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(call.options.body).requestId, 'request-1');
  assert.equal(call.options.headers.Authorization, undefined);
});

test('API timeouts abort stalled requests and report unknown mutation outcome without automatic retry', async () => {
  let calls = 0;
  const api = createApiClient({ timeoutMs: 10, fetchImpl: (_path, { signal }) => new Promise((_resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  await assert.rejects(api('/sessions', { requestId: 'same-on-retry' }), error => error.code === 'request_timeout' && error.uncertain === true);
  assert.equal(calls, 1);
});

test('API distinguishes stale revision, malformed response and service failure', async () => {
  const response = (ok, status, data) => createApiClient({ fetchImpl: async () => ({ ok, status, json: async () => data }) });
  await assert.rejects(response(false, 409, { error: 'Refresh this lesson', code: 'stale_revision' })('/sessions/a'), error => error.status === 409 && error.code === 'stale_revision');
  await assert.rejects(response(true, 200, { apiVersion: 2 })('/sessions'), error => error.code === 'incompatible_response');
  await assert.rejects(response(false, 503, null)('/sessions'), /503/);
});
