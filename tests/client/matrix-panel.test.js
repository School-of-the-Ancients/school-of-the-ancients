import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatrixPanel, safeOperatorUrl } from '../../public/matrix-panel.js';

const session = () => ({ id: 'lesson-1', revision: 1, status: 'active', stage: 'explain' });
function response(current, overrides = {}) {
  return { apiVersion: 1, session: structuredClone(current), bridge: { binding: null, connected: false, readiness: null, checkedAt: null, reason: 'Not connected.', operatorUrl: null, demonstrations: [], ...overrides } };
}
function connected(current, overrides = {}) {
  return response(current, { connected: true, binding: { id: 'binding-1' }, operatorUrl: 'http://127.0.0.1:8793/clients', readiness: { state: 'ready', canLaunch: true, issues: [], matrixRequest: { text: 'Place a block here.', revision: 7, runtimeSessionId: 'runtime-1' } }, ...overrides });
}
function fixture(t, route) {
  let current = session(); let number = 0; const calls = []; let changed = 0;
  const panel = createMatrixPanel({ api: async (path, body) => { calls.push({ path, body: structuredClone(body) }); return route(path, body, current, calls); }, getSession: () => current,
    onSession: value => { assert.equal(value.id, current.id); assert.ok(value.revision >= current.revision); current = value; }, onChange: () => { changed++; }, requestId: () => `request-${++number}`, pollDelay: 60000 });
  t.after(() => panel.destroy()); panel.render(current);
  return { panel, calls, current: () => current, setCurrent: value => { current = value; }, changed: () => changed };
}

test('optional panel performs no request until opened and never calls Matrix directly', async t => {
  const f = fixture(t, (_path, _body, current) => response(current));
  assert.match(f.panel.render(f.current()), /Open Matrix connection/); assert.equal(f.calls.length, 0);
  await f.panel.action('open'); assert.deepEqual(f.calls, [{ path: '/sessions/lesson-1/matrix', body: undefined }]);
  assert.doesNotMatch(f.panel.render(f.current()), /data-action="matrix-apply"/);
});

test('pairing code stays out of rendered state after dispatch and a reviewed request is not auto-applied', async t => {
  const f = fixture(t, (path, body, current) => {
    if (path.endsWith('/pair')) return connected({ ...current, revision: 2 });
    if (path.endsWith('/demonstrations')) return connected({ ...current, revision: 3 }, { demonstrations: [{ id: body.requestId, status: 'ready', requiresApply: true, proposalSummary: 'Place the block.', observed: null }] });
    return response(current);
  });
  await f.panel.action('open'); f.panel.input('origin', 'http://127.0.0.1:8793'); f.panel.input('code', 'one-use-fixture-code');
  await f.panel.action('pair');
  assert.deepEqual(f.calls[1].body, { requestId: 'request-1', expectedRevision: 1, url: 'http://127.0.0.1:8793', pairingCode: 'one-use-fixture-code' });
  assert.doesNotMatch(f.panel.render(f.current()), /one-use-fixture-code/);
  await f.panel.action('request'); await f.panel.action('request');
  assert.equal(f.calls.filter(call => call.path.endsWith('/demonstrations')).length, 1);
  assert.deepEqual(f.calls[2].body, { requestId: 'request-2', expectedRevision: 2, bindingId: 'binding-1', expectedMatrixRevision: 7 });
  assert.equal(f.current().stage, 'explain'); assert.ok(f.calls.every(call => !call.path.includes('/apply')));
  assert.match(f.panel.render(f.current()), /Waiting for Operator review/);
});

test('readiness and lesson completion gate proposal dispatch', async t => {
  const f = fixture(t, (_path, _body, current) => connected(current, { readiness: { state: 'missing', canLaunch: false, issues: [{ message: 'Select a surface.', remedy: 'Point in Matrix.', blocking: true }] } }));
  await f.panel.action('open'); await f.panel.action('request'); assert.equal(f.calls.length, 1);
  assert.match(f.panel.render(f.current()), /Select a surface/);
  f.setCurrent({ ...f.current(), status: 'completed' }); await f.panel.action('request'); assert.equal(f.calls.length, 1);
});

test('uncertain dispatch retries its original request identity and never silently sends another block', async t => {
  let attempts = 0;
  const f = fixture(t, (path, _body, current) => {
    if (path.endsWith('/demonstrations') && ++attempts === 1) { const error = new Error('Response lost.'); error.uncertain = true; throw error; }
    return connected(current);
  });
  await f.panel.action('open'); await f.panel.action('request');
  assert.equal(attempts, 1); assert.match(f.panel.render(f.current()), /may already exist/);
  await f.panel.action('retry');
  assert.equal(attempts, 2); assert.deepEqual(f.calls[1].body, f.calls[2].body);
});

test('an older bridge response cannot roll back a newer School lesson revision', async t => {
  const f = fixture(t, (_path, _body, current, calls) => calls.length === 1 ? connected({ ...current, revision: 1 }) : connected(current));
  f.setCurrent({ ...f.current(), revision: 5, stage: 'example' });
  await f.panel.action('open');
  assert.equal(f.calls.length, 2); assert.equal(f.current().revision, 5); assert.equal(f.current().stage, 'example');
});

test('historical outcomes are escaped and unsafe Operator links are omitted', async t => {
  const f = fixture(t, (_path, _body, current) => connected(current, { operatorUrl: 'javascript:alert(1)', demonstrations: [{ id: 'demo-1', status: 'unconfirmed', proposalSummary: '<img src=x onerror=bad()>', error: '<script>bad()</script>', observed: null }] }));
  await f.panel.action('open'); const html = f.panel.render(f.current());
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Do not assume the block appeared/); assert.doesNotMatch(html, /Runtime confirmed/);
});

test('late response after switching lessons cannot replace the active lesson or its connection', async t => {
  let resolve;
  const f = fixture(t, () => new Promise(done => { resolve = done; }));
  const request = f.panel.action('open');
  f.setCurrent({ id: 'lesson-2', revision: 1, status: 'active', stage: 'example' }); f.panel.render(f.current());
  resolve(connected(session())); await request;
  assert.equal(f.current().id, 'lesson-2'); assert.match(f.panel.render(f.current()), /Not connected/);
});

test('Operator links require an exact local clients page with no credentials or query', () => {
  assert.equal(safeOperatorUrl('http://127.0.0.1:8789/clients'), 'http://127.0.0.1:8789/clients');
  for (const value of ['https://example.com/clients', 'http://secret@localhost/clients', 'http://localhost/clients?token=secret', 'http://localhost/anything', 'javascript:bad()']) assert.equal(safeOperatorUrl(value), null);
});

test('each historical proposal links to its original Matrix service after a different service is paired', async t => {
  const f = fixture(t, (_path, _body, current) => connected({ ...current, matrix: { bindings: [
    { id: 'old-binding', origin: 'http://127.0.0.1:8789' }, { id: 'new-binding', origin: 'http://127.0.0.1:8793' },
  ] } }, { binding: { id: 'new-binding' }, demonstrations: [
    { id: 'old-demo', bindingId: 'old-binding', status: 'ready', requiresApply: true },
    { id: 'new-demo', bindingId: 'new-binding', status: 'ready', requiresApply: true },
    { id: 'missing-binding', bindingId: 'absent', status: 'ready', requiresApply: true },
  ] }));
  await f.panel.action('open'); const html = f.panel.render(f.current());
  const cards = html.split('<article class="matrix-demonstration">').slice(1);
  assert.doesNotMatch(cards[0], /Review in Matrix/);
  assert.match(cards[1], /href="http:\/\/127\.0\.0\.1:8793\/clients"/);
  assert.match(cards[2], /href="http:\/\/127\.0\.0\.1:8789\/clients"/);
});
