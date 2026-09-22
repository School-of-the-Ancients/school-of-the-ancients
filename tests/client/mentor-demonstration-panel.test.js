import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatrixPanel } from '../../public/matrix-panel.js';

const intent = { kind: 'matrix-scene', title: 'Compare three blocks', learningGoal: 'Observe how scale changes volume.', prompt: 'Place three blocks side by side at scales 1, 2 and 3.' };
function fixture(t, route = () => undefined, options = {}) {
  let current = { id: 'lesson-1', revision: 4, status: 'active', stage: 'example', messages: [{ id: 'message-1', turnId: 'turn-1', role: 'mentor', stage: 'example', text: 'I suggest a demonstration.', demonstration: structuredClone(intent) }],
    matrix: { bindings: [{ id: 'binding-1', origin: 'http://127.0.0.1:8793' }], demonstrations: [], experiments: [], sceneBuilds: [] } };
  const calls = []; let count = 0;
  const response = (overrides = {}, builds = []) => ({ apiVersion: 1, session: { ...structuredClone(current), matrix: { ...structuredClone(current.matrix), sceneBuilds: builds } }, bridge: {
    connected: true, binding: { id: 'binding-1' }, demonstrations: [], experiments: [], sceneBuilds: builds,
    readiness: { canLaunch: true, matrixRequest: { revision: 7 }, issues: [] },
    scale: { available: true, demonstrationId: 'placed-block', expectedMatrixRevision: 7 },
    sceneBuilder: { available: true, reason: 'Matrix is ready to plan a reviewed scene.', expectedMatrixRevision: 7 }, ...overrides,
  } });
  const panel = createMatrixPanel({ api: async (path, body) => { calls.push({ path, body: structuredClone(body) }); return await route(path, body, response, current) ?? response(); },
    getSession: () => current, onSession: value => { current = value; }, requestId: () => `action-${++count}`, pollDelay: 60000, ...options });
  panel.render(current); t.after(() => panel.destroy());
  return { panel, calls, response, current: () => current, setCurrent: value => { current = value; panel.render(current); }, card: () => panel.renderSuggestion(current), render: () => panel.render(current) };
}
function build(id = 'build-1', status = 'ready') {
  return { id, turnId: 'turn-1', bindingId: 'binding-1', intent: structuredClone(intent), status, requiresApply: status === 'ready', sequence: 1,
    proposalSummary: 'Three blocks will illustrate the comparison.', observed: null, error: null };
}
const clickBuild = f => f.panel.action('scene-build', { turnId: 'turn-1' });

test('latest mentor suggestion is inert, fully visible and escaped; older suggestions and malformed metadata stay unavailable', async t => {
  const f = fixture(t); const message = f.current().messages[0];
  message.demonstration = { ...intent, title: '<img src=x onerror=bad()>', learningGoal: '<script>bad()</script>', prompt: '<a href="javascript:bad()">Make a scene</a>' };
  const card = f.card(); assert.match(card, /&lt;img/); assert.match(card, /&lt;script/); assert.match(card, /&lt;a href=/); assert.doesNotMatch(card, /<img|<script|href="javascript:/);
  assert.match(card, /NOT BUILT YET/); assert.match(card, /Scene request/); assert.equal(f.calls.length, 0);
  f.current().messages.push({ role: 'mentor', text: 'A later reply has no scene suggestion.' }); assert.equal(f.card(), '');
  await clickBuild(f); assert.equal(f.calls.length, 0);
  f.current().messages.pop(); message.demonstration.prompt = 'x'.repeat(2001); assert.equal(f.card(), '');
});

test('disconnected Build opens connection only; pairing and rendering never automatically dispatch the suggestion', async t => {
  let paired = false;
  const f = fixture(t, (path, body, response) => {
    if (path.endsWith('/pair')) paired = true;
    if (path.endsWith('/scene-builds')) return { ...response({}, [build(body.requestId)]), sceneBuild: build(body.requestId) };
    return response({ connected: paired, binding: paired ? { id: 'binding-1' } : null });
  });
  await clickBuild(f); assert.deepEqual(f.calls.map(call => call.path), ['/sessions/lesson-1/matrix']); assert.ok(f.calls.every(call => !call.body));
  assert.match(f.render(), /Temporary pairing code/); f.panel.input('code', 'fixture-one-use-code'); await f.panel.action('pair');
  assert.equal(f.calls.filter(call => call.path.endsWith('/scene-builds')).length, 0); f.card(); f.render();
  await clickBuild(f); const sent = f.calls.find(call => call.path.endsWith('/scene-builds'));
  assert.deepEqual(sent.body, { requestId: 'action-2', expectedRevision: 4, bindingId: 'binding-1', expectedMatrixRevision: 7, turnId: 'turn-1' });
  assert.equal(sent.body.prompt, undefined); assert.ok(f.calls.every(call => !call.path.includes('/apply')));
  assert.match(f.card(), /Waiting for Operator review/); assert.match(f.card(), /Nothing is confirmed as built yet/);
});

test('a sent suggestion checks its existing request on repeated clicks, including after reload', async t => {
  const stored = build(); const f = fixture(t, (_path, _body, response) => response({}, [stored]));
  f.current().matrix.sceneBuilds = [stored]; await clickBuild(f); assert.equal(f.calls[0].path, '/sessions/lesson-1/matrix/scene-builds/build-1'); assert.equal(f.calls[0].body, undefined);
  await clickBuild(f); assert.ok(f.calls.every(call => call.body === undefined)); assert.doesNotMatch(f.card(), /data-action="matrix-scene-build"/);
});

test('a lost response retains the same scene request ID and payload even when Build is clicked again', async t => {
  let attempts = 0;
  const f = fixture(t, (path, body, response) => {
    if (path.endsWith('/scene-builds')) { if (++attempts === 1) { const error = new Error('Lost reply.'); error.uncertain = true; throw error; } return response({}, [build(body.requestId)]); }
  });
  await f.panel.action('open'); await clickBuild(f); assert.equal(attempts, 1); assert.match(f.render(), /may already exist/);
  assert.doesNotMatch(f.card(), /NOT BUILT YET/); assert.match(f.card(), /Retry the same request/);
  f.current().revision++; await clickBuild(f); const writes = f.calls.filter(call => call.body); assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
});

test('a definite stale revision rejection requires another learner click and a fresh request after readiness refresh', async t => {
  let attempts = 0;
  const f = fixture(t, (path, body, response) => { if (path.endsWith('/scene-builds')) { if (++attempts === 1) { const error = new Error('Refresh this lesson.'); error.status = 409; throw error; } return response({}, [build(body.requestId)]); } });
  await f.panel.action('open'); await clickBuild(f); assert.equal(attempts, 1); f.current().revision = 5; await f.panel.action('refresh'); assert.equal(attempts, 1);
  await clickBuild(f); const writes = f.calls.filter(call => call.body); assert.notEqual(writes[0].body.requestId, writes[1].body.requestId); assert.equal(writes[1].body.expectedRevision, 5);
});

test('a slow scene request shows pending state, suppresses duplicate clicks and cannot attach its late reply to another lesson', async t => {
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, (path, body, response) => {
    if (path.endsWith('/scene-builds')) { const result = response({}, [build(body.requestId)]); entered(); return new Promise(resolve => { release = () => resolve(result); }); }
  });
  await f.panel.action('open'); const request = clickBuild(f); await started;
  assert.match(f.card(), /Sending the scene request for Matrix planning/); assert.match(f.card(), /Sending request/); await clickBuild(f);
  assert.equal(f.calls.filter(call => call.body).length, 1);
  f.setCurrent({ ...f.current(), id: 'lesson-2', messages: [], matrix: undefined }); release(); await request;
  assert.equal(f.current().id, 'lesson-2'); assert.equal(f.card(), ''); assert.doesNotMatch(f.render(), /Three blocks|Waiting for Operator review/);
});

test('new scene work is blocked by an uncertain request, active mentor turn, changed stage, or unavailable builder', async t => {
  const f = fixture(t, (_path, _body, response) => response({ experiments: [{ status: 'unconfirmed' }] }));
  await f.panel.action('open'); await clickBuild(f); assert.equal(f.calls.filter(call => call.body).length, 0); assert.match(f.card(), /Reconcile/);
  const g = fixture(t); await g.panel.action('open'); g.current().activeTurnId = 'new-turn'; await clickBuild(g); assert.equal(g.calls.filter(call => call.body).length, 0); delete g.current().activeTurnId;
  g.current().stage = 'recap'; await clickBuild(g); assert.match(g.card(), /earlier lesson step/); assert.equal(g.calls.filter(call => call.body).length, 0);
  const h = fixture(t, (_path, _body, response) => response({ sceneBuilder: { available: false, reason: 'Matrix model planning is unavailable.' } })); await h.panel.action('open'); await clickBuild(h); assert.equal(h.calls.filter(call => call.body).length, 0); assert.match(h.card(), /model planning is unavailable/);
});

test('pending scene builds block placement and scale and use their own polling endpoint', async t => {
  let read; const polled = new Promise(resolve => { read = resolve; });
  const f = fixture(t, (path, body, response) => {
    if (path.endsWith('/scene-builds')) return response({}, [build(body.requestId)]);
    if (path.endsWith('/scene-builds/action-1')) { read(); return response({}, [build('action-1', 'queued')]); }
  }, { pollDelay: 1 });
  await f.panel.action('open'); await clickBuild(f); await f.panel.action('request'); await f.panel.action('scale', { factors: '2,2,2' }); await polled;
  assert.equal(f.calls.filter(call => call.body).length, 1); assert.ok(f.calls.some(call => call.path === '/sessions/lesson-1/matrix/scene-builds/action-1'));
});

test('partial command evidence, PC save and malformed success stay distinct from confirmed runtime completion', async t => {
  const results = [
    { ...build('partial', 'partial'), observed: { source: 'matrix-runtime', revision: 9, confirmedCommandCount: 2, failedCommandCount: 1, objectIds: ['one', 'two'] } },
    { ...build('saved', 'succeeded'), observed: { source: 'matrix-pc-save', revision: 9, savedScene: 'comparison' } },
    { ...build('unconfirmed', 'succeeded'), observed: null },
  ];
  const f = fixture(t, (_path, _body, response) => response({}, results)); await f.panel.action('open'); const html = f.render();
  assert.match(html, /2 successful commands and 1 failed commands/); assert.match(html, /only partly completed/); assert.match(html, /PC scene save: comparison/); assert.match(html, /not proof of runtime placement/);
  assert.match(html, /Outcome unconfirmed/); assert.doesNotMatch(html, /Matrix acknowledged all/);
});

test('confirmed runtime result refreshes readiness with GET and cannot advance the lesson or dispatch another scene', async t => {
  const done = { ...build('build-1', 'succeeded'), observed: { source: 'matrix-runtime', revision: 9, confirmedCommandCount: 3, failedCommandCount: 0, objectIds: ['a', 'b', 'c'] } };
  const f = fixture(t, (path, _body, response) => path.endsWith('/scene-builds/build-1') ? { ...response({}, [done]), sceneBuild: done } : response({}, [done]));
  await f.panel.action('open'); await f.panel.action('scene-check', { id: 'build-1' }); assert.equal(f.current().stage, 'example'); assert.ok(f.calls.every(call => call.body === undefined));
  assert.deepEqual(f.calls.map(call => call.path), ['/sessions/lesson-1/matrix', '/sessions/lesson-1/matrix/scene-builds/build-1', '/sessions/lesson-1/matrix']); assert.match(f.card(), /Matrix acknowledged all 3 commands/); assert.doesNotMatch(f.card(), /NOT BUILT YET/);
});

test('cancel is an explicit original request action and uncertain history links to the original safe Operator', async t => {
  const f = fixture(t, (path, _body, response) => response({ binding: { id: 'replacement-binding' } }, [build('original', path.endsWith('/cancel') ? 'cancelled' : 'unconfirmed')]));
  await f.panel.action('open'); assert.match(f.card(), /href="http:\/\/127\.0\.0\.1:8793\/clients"/); assert.match(f.card(), /Inspect original Matrix/);
  await f.panel.action('scene-cancel', { id: 'original' }); const sent = f.calls.find(call => call.body); assert.equal(sent.path, '/sessions/lesson-1/matrix/scene-builds/original/cancel'); assert.deepEqual(sent.body, { requestId: 'action-1' });
  assert.match(f.card(), /cancelled before Apply/); assert.ok(f.calls.every(call => !call.path.endsWith('/apply')));
});
