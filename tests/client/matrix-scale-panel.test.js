import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatrixPanel } from '../../public/matrix-panel.js';

function fixture(t, route = () => undefined, options = {}) {
  let current = { id: 'lesson-1', revision: 1, status: 'active', stage: 'example', matrix: {
    bindings: [{ id: 'binding-1', origin: 'http://127.0.0.1:8793' }], demonstrations: [], experiments: [],
  } };
  let count = 0; const calls = [];
  const response = (overrides = {}, experiments = []) => ({ apiVersion: 1, session: structuredClone(current), bridge: {
    connected: true, binding: { id: 'binding-1' }, demonstrations: [], experiments,
    readiness: { canLaunch: true, matrixRequest: { revision: 7 }, issues: [] },
    scale: { available: true, reason: 'Ready for a reviewed experiment.', expectedMatrixRevision: 7, demonstrationId: 'placement-1' },
    ...overrides,
  } });
  const panel = createMatrixPanel({ api: async (path, body) => {
    calls.push({ path, body: structuredClone(body) });
    return await route(path, body, response, current) ?? response();
  }, getSession: () => current, onSession: value => { current = value; }, requestId: () => `action-${++count}`, pollDelay: 60000, ...options });
  panel.render(current); t.after(() => panel.destroy());
  return { panel, calls, current: () => current, render: () => panel.render(current), response };
}

function record(id = 'experiment-1', status = 'ready') {
  return { id, bindingId: 'binding-1', demonstrationId: 'placement-1', action: 'configure', factors: { x: 2, y: 2, z: 2 },
    status, requiresApply: status === 'ready', observed: null, proposalSummary: 'Scale the block.' };
}

test('a preset creates a separate reviewed Matrix request without using browser units or Apply authority', async t => {
  const f = fixture(t, (path, body, response) => path.endsWith('/experiments') ? response({}, [record(body.requestId)]) : undefined);
  await f.panel.action('open'); await f.panel.action('scale', { factors: '2,2,2' });
  const sent = f.calls.find(call => call.body);
  assert.equal(sent.path, '/sessions/lesson-1/matrix/experiments');
  assert.deepEqual(sent.body, { requestId: 'action-1', expectedRevision: 1, bindingId: 'binding-1', expectedMatrixRevision: 7,
    demonstrationId: 'placement-1', action: 'configure', factors: { x: 2, y: 2, z: 2 } });
  assert.ok(f.calls.every(call => !call.path.includes('/apply')));
  assert.equal(f.current().stage, 'example');
  assert.match(f.render(), /No confirmed experiment result yet/);
  assert.match(f.render(), /Review in Matrix/);
  assert.match(f.render(), /do not change your recorded browser experiment/);
  await f.panel.action('scale', { factors: '2,1,1' }); await f.panel.action('request');
  assert.equal(f.calls.filter(call => call.body).length, 1);
});

test('reset requires a confirmed baseline and sends its exact identity as a new proposal', async t => {
  let confirmed = false;
  const f = fixture(t, (path, body, response) => {
    if (body) return response({}, [record(body.requestId)]);
    return response({ scale: { available: true, reason: 'Ready', expectedMatrixRevision: 9, demonstrationId: 'placement-1',
      ...(confirmed ? { latestExperimentId: 'confirmed-original' } : {}) } });
  });
  await f.panel.action('open'); await f.panel.action('scale-reset');
  assert.equal(f.calls.filter(call => call.body).length, 0);
  confirmed = true; await f.panel.action('refresh'); await f.panel.action('scale-reset');
  const sent = f.calls.find(call => call.body).body;
  assert.equal(sent.action, 'reset'); assert.equal(sent.baselineExperimentId, 'confirmed-original');
  assert.equal(sent.factors, undefined); assert.equal(sent.expectedMatrixRevision, 9);
});

test('uncertain experiment blocks additional scene edits and never displays a successful receipt as a ratio', async t => {
  const f = fixture(t, (_path, _body, response) => response({}, [record('unknown', 'unconfirmed')]));
  await f.panel.action('open'); await f.panel.action('scale', { factors: '2,2,2' }); await f.panel.action('request');
  assert.equal(f.calls.filter(call => call.body).length, 0);
  assert.doesNotMatch(f.render(), /Confirmed ratio:/);
  assert.match(f.render(), /No confirmed experiment result yet/);
});

test('retry after a lost School response preserves the exact scale request identity and factors', async t => {
  let attempts = 0;
  const f = fixture(t, (path, body, response) => {
    if (path.endsWith('/experiments')) {
      if (++attempts === 1) throw new Error('Lost reply after durable intent');
      return response({}, [record(body.requestId)]);
    }
  });
  await f.panel.action('open'); await f.panel.action('scale', { factors: '2,0.5,1' });
  assert.equal(attempts, 1); await f.panel.action('retry');
  const writes = f.calls.filter(call => call.body);
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.deepEqual(writes[1].body.factors, { x: 2, y: .5, z: 1 });
});

test('experiment polling uses its own endpoint and only confirmed observed arithmetic is shown', async t => {
  let markRead;
  const read = new Promise(resolve => { markRead = resolve; });
  const f = fixture(t, (path, body, response) => {
    if (path.endsWith('/experiments')) return response({}, [record(body.requestId)]);
    if (path.endsWith('/experiments/action-1')) {
      markRead();
      return response({}, [{ ...record('action-1', 'succeeded'), observed: { source: 'acknowledged-runtime-transform',
        revision: 9, mathematicalVolumeRatio: 8.00000001, physicalMeasurement: false } }]);
    }
  }, { pollDelay: 1 });
  await f.panel.action('open'); await f.panel.action('scale', { factors: '2,2,2' }); await read;
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.render(), /Confirmed ratio: 8× the original baseline/);
  assert.match(f.render(), /not physical volume/);
  assert.equal(f.calls.filter(call => call.body).length, 1);
});

test('missing capability, malformed factors, and busy lessons cannot expose an actionable preset', async t => {
  const f = fixture(t, (_path, _body, response) => response({ scale: { available: false, reason: 'Quest AR is not supported.' } }));
  await f.panel.action('open'); await f.panel.action('scale', { factors: '2,2,2' });
  assert.equal(f.calls.filter(call => call.body).length, 0);
  assert.match(f.render(), /data-factors="2,2,2" disabled/);
  assert.match(f.render(), /Quest AR is not supported/);
  const g = fixture(t); await g.panel.action('open');
  for (const factors of ['NaN,2,2', '0,1,1', '2,2', '2,2,2,2', 'Infinity,1,1']) await g.panel.action('scale', { factors });
  assert.equal(g.calls.filter(call => call.body).length, 0);
  assert.match(g.panel.render(g.current(), { lessonBusy: true }), /data-factors="2,2,2" disabled/);
});

test('historical experiment links keep their original Operator and untrusted text remains escaped', async t => {
  const f = fixture(t, (_path, _body, response) => response({ binding: { id: 'new-binding' } }, [{ ...record(), proposalSummary: '<img onerror=bad>' }]));
  await f.panel.action('open');
  assert.match(f.render(), /http:\/\/127.0.0.1:8793\/clients/);
  assert.match(f.render(), /&lt;img onerror=bad&gt;/);
  assert.doesNotMatch(f.render(), /<img onerror=bad>/);
});

test('a terminal result refreshes even cached pre-Apply readiness with a read and never submits the next experiment', async t => {
  let completed = false;
  const done = { ...record('experiment-1', 'succeeded'), observed: { source: 'acknowledged-runtime-transform', mathematicalVolumeRatio: 8, physicalMeasurement: false } };
  const f = fixture(t, (path, _body, response) => {
    if (path.endsWith('/experiments/experiment-1')) {
      completed = true;
      return { ...response({ readiness: { canLaunch: true, matrixRequest: { revision: 7 }, issues: [] },
        scale: { available: false, reason: 'Old cached transform no longer matches.' } }, [done]), experiment: done };
    }
    return response({ scale: { available: true, reason: 'Fresh readiness', expectedMatrixRevision: completed ? 9 : 7,
      demonstrationId: 'placement-1', ...(completed ? { latestExperimentId: 'experiment-1' } : {}) } }, completed ? [done] : []);
  });
  await f.panel.action('open'); await f.panel.action('scale-check', { id: 'experiment-1' });
  assert.deepEqual(f.calls.map(call => call.path), ['/sessions/lesson-1/matrix', '/sessions/lesson-1/matrix/experiments/experiment-1', '/sessions/lesson-1/matrix']);
  assert.ok(f.calls.every(call => call.body === undefined));
  assert.match(f.render(), /Confirmed ratio: 8×/);
  assert.match(f.render(), /data-action="matrix-scale-reset" >Reset/);
});
