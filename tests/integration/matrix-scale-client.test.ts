import test from 'node:test';
import assert from 'node:assert/strict';
import { MatrixClient, MatrixClientError, validateScaleOutcome, verifiedScaleObservation,
  type MatrixScaleIntent, type MatrixScaleProof, type MatrixOutcome } from '../../src/integrations/matrix-client.ts';

const binding = { protocolVersion: '1' as const, sessionId: 'scale-pair', runtimeSessionId: 'scale-runtime' };
const vector = (x: number, y = x, z = x) => ({ x, y, z });
const pose = (x: number, y = x, z = x) => ({ position: vector(0), rotation: vector(0), scale: vector(x, y, z) });
function proof(): MatrixScaleProof {
  return { action: 'configure', baseline: { roomId: 'white-room', objectId: 'block-1', assetId: 'block', anchorId: 'floor', transform: pose(.2) }, factors: vector(2), expectedTransform: pose(.4) };
}
function ready(expected = proof()): MatrixOutcome {
  const metadata = { ...structuredClone(expected), capability: 'experiment.block-scale.v1' as const, version: 1 as const,
    interpretation: 'Static mathematical illustration; not physical volume.' };
  return { ...binding, requestId: 'scale-1', correlationId: 'lesson-scale-1', sequence: 2, status: 'ready', requiresApply: true,
    proposal: { planId: 'plan-1', commands: [{ op: 'set_transform', objectId: 'block-1', transform: structuredClone(expected.expectedTransform) }], experiment: metadata },
    commandIds: [], receipts: [], observed: null, error: null,
    experiment: { ...structuredClone(metadata), observationState: 'not-confirmed', observation: null } };
}
function confirmed(expected = proof()): MatrixOutcome {
  const value = ready(expected);
  const ratio = expected.factors.x * expected.factors.y * expected.factors.z;
  return { ...value, sequence: 5, status: 'succeeded', requiresApply: false, commandIds: ['command-1'],
    receipts: [{ requestId: 'command-1', ok: true, objectId: 'block-1', error: '' }],
    observed: { revision: 4, snapshot: { scene: { roomId: 'white-room', objects: [{ objectId: 'block-1', assetId: 'block', anchorId: 'floor', transform: structuredClone(expected.expectedTransform) }] } } },
    experiment: { ...value.experiment!, observationState: 'confirmed', observation: { source: 'acknowledged-runtime-transform', revision: 4, relativeFactors: structuredClone(expected.factors), mathematicalVolumeRatio: ratio, units: 'dimensionless ratio', physicalMeasurement: false } } };
}
function setup(handler: (body: Record<string, unknown> | null, path: string) => unknown | Promise<unknown> = () => ready()) {
  const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (path === '/api/v1/sessions') return Response.json({ ...binding, clientToken: 'private-scale-client-token', expiresInSeconds: 3600 });
    calls.push({ path, body });
    return Response.json(await handler(body, path));
  };
  return { calls, pair: () => MatrixClient.pair('http://127.0.0.1:8789', 'one-use-test-code', { fetch: fetcher }) };
}
const configure: MatrixScaleIntent = { kind: 'block-scale', version: 1, action: 'configure', objectId: 'block-1', factors: vector(2) };
const options = { requestId: 'scale-1', correlationId: 'lesson-scale-1', revision: 2 };

test('typed configure uses only the versioned request/review path with original pairing and correlation', async () => {
  const f = setup(); const client = await f.pair();
  const result = await client.proposeScale(configure, options);
  assert.equal(result.status, 'ready');
  validateScaleOutcome(result, proof());
  assert.equal(verifiedScaleObservation(result, proof()), null);
  assert.deepEqual(f.calls, [{ path: '/api/v1/requests', body: { requestId: options.requestId, correlationId: options.correlationId,
    expected: { runtimeSessionId: binding.runtimeSessionId, revision: 2 }, intent: configure } }]);
  assert.equal('apply' in client, false);
  assert.equal(JSON.stringify(client).includes('private-scale-client-token'), false);
});

test('typed reset references a confirmed request and has no caller factors', async () => {
  const expected = proof(); expected.action = 'reset'; expected.factors = vector(1); expected.expectedTransform = pose(.2);
  const f = setup(() => ready(expected)); const client = await f.pair();
  const intent: MatrixScaleIntent = { kind: 'block-scale', version: 1, action: 'reset', objectId: 'block-1', baselineRequestId: 'prior-confirmed-scale' };
  const result = await client.proposeScale(intent, options);
  validateScaleOutcome(result, expected);
  assert.deepEqual(f.calls[0].body?.intent, intent);
  assert.equal(verifiedScaleObservation(result, expected), null);
});

test('malformed or executable intents fail before network dispatch', async () => {
  const f = setup(); const client = await f.pair();
  const changes = [{ version: true }, { version: 2 }, { kind: 'script' }, { action: ['configure'], baselineRequestId: 'source' },
    { objectId: '../apply' }, { objectId: 1 }, { factors: vector(NaN) }, { factors: vector(Infinity) },
    { factors: vector(.249) }, { factors: vector(4.01) }, { factors: { x: true, y: 2, z: 2 } },
    { factors: { x: 2, y: 2 } }, { factors: { ...vector(2), w: 1 } }, { commands: [{ op: 'clear' }] },
    { baselineRequestId: null }, { action: 'reset' }];
  for (const change of changes) {
    await assert.rejects(client.proposeScale({ ...configure, ...change } as MatrixScaleIntent, options),
      (error: unknown) => error instanceof MatrixClientError && error.code === 'invalid_request' && !error.outcomeUnknown);
  }
  assert.equal(f.calls.length, 0);
});

test('pre-dispatch cancellation and lost response never replay a scale action', async () => {
  let posts = 0;
  const f = setup((body) => { if (body) { posts++; throw new Error('lost response'); } return confirmed(); });
  const client = await f.pair(); const controller = new AbortController(); controller.abort();
  await assert.rejects(client.proposeScale(configure, { ...options, signal: controller.signal }), (e: unknown) => e instanceof MatrixClientError && !e.outcomeUnknown);
  assert.equal(posts, 0);
  await assert.rejects(client.proposeScale(configure, options), (e: unknown) => e instanceof MatrixClientError && e.outcomeUnknown && e.requestId === 'scale-1');
  assert.equal(posts, 1);
  const recovered = await client.outcome('scale-1');
  assert.equal(verifiedScaleObservation(recovered, proof())?.mathematicalVolumeRatio, 8);
  assert.equal(posts, 1);
});

test('a changed response correlation remains uncertain after dispatch', async () => {
  const f = setup(() => ({ ...ready(), correlationId: 'another-lesson' })); const client = await f.pair();
  await assert.rejects(client.proposeScale(configure, options), (e: unknown) => e instanceof MatrixClientError && e.outcomeUnknown);
  assert.equal(f.calls.length, 1);
});

test('confirmation verifies complete baseline, command, acknowledgement, snapshot and arithmetic', () => {
  const value = confirmed();
  const observed = verifiedScaleObservation(value, proof());
  assert.equal(observed?.mathematicalVolumeRatio, 8);
  assert.equal(observed?.physicalMeasurement, false);
  observed!.relativeFactors.x = 99;
  assert.equal(value.experiment?.observation?.relativeFactors.x, 2, 'Caller cannot mutate original evidence');
});

test('server-replaced baseline, factors or command cannot redefine the caller proof', () => {
  for (const mutate of [
    (v: MatrixOutcome) => { v.experiment!.baseline.roomId = 'different-room'; },
    (v: MatrixOutcome) => { v.experiment!.baseline.transform.scale.x = .1; v.experiment!.expectedTransform.scale.x = .2; },
    (v: MatrixOutcome) => { v.experiment!.factors.x = 3; v.experiment!.expectedTransform.scale.x = .6; },
    (v: MatrixOutcome) => { (v.proposal!.commands as Array<Record<string, unknown>>)[0].op = 'clear'; },
    (v: MatrixOutcome) => { (v.proposal!.commands as Array<Record<string, unknown>>)[0].objectId = 'another-object'; },
    (v: MatrixOutcome) => { (v.proposal!.commands as Array<Record<string, unknown>>)[0].placement = 'surface'; },
    (v: MatrixOutcome) => { v.proposal!.experiment = { ...v.proposal!.experiment as object, version: 2 }; },
  ]) {
    const value = ready(); mutate(value);
    assert.throws(() => validateScaleOutcome(value, proof()), MatrixClientError);
  }
});

test('wrong receipt, observed identity/pose or ratio cannot produce confirmed evidence', () => {
  const mutations: Array<(v: MatrixOutcome) => void> = [
    v => { v.receipts[0].objectId = 'other'; }, v => { v.receipts[0].requestId = 'other'; },
    v => { v.receipts[0].ok = false; }, v => { v.receipts[0].error = 'contradictory'; },
    v => { v.commandIds.push('other'); },
    v => { v.experiment!.observation!.mathematicalVolumeRatio = 7; },
    v => { v.experiment!.observation!.relativeFactors.x = 3; },
    v => { v.experiment!.observation!.revision = 5; },
  ];
  for (const field of ['roomId', 'objectId', 'assetId', 'anchorId', 'scale']) mutations.push(v => {
    const scene = (v.observed as unknown as { snapshot: { scene: { roomId: string; objects: Array<Record<string, unknown>> } } }).snapshot.scene;
    if (field === 'roomId') scene.roomId = 'other';
    else if (field === 'scale') scene.objects[0].transform = pose(.3);
    else scene.objects[0][field] = 'other';
  });
  for (const mutate of mutations) {
    const value = confirmed(); mutate(value);
    assert.throws(() => verifiedScaleObservation(value, proof()), MatrixClientError);
  }
});

test('generic receipt success with unconfirmed experiment remains unconfirmed', () => {
  const value = confirmed(); value.experiment!.observationState = 'unconfirmed'; value.experiment!.observation = null;
  assert.equal(verifiedScaleObservation(value, proof()), null);
  const stale = ready(); stale.status = 'cancelled'; stale.requiresApply = false;
  assert.equal(verifiedScaleObservation(stale, proof()), null);
  assert.throws(() => verifiedScaleObservation({ ...confirmed(), status: 'cancelled' }, proof()), MatrixClientError);
});

test('malformed optional experiment rejects while legacy outcomes remain compatible', async () => {
  for (const experiment of [null, { ...ready().experiment, version: 2 }, { ...ready().experiment, observationState: ['not-confirmed'] },
    { ...ready().experiment, observation: { truncated: true } }, { ...ready().experiment, unexpected: true }]) {
    const f = setup(() => ({ ...ready(), experiment })); const client = await f.pair();
    await assert.rejects(client.outcome('scale-1'), MatrixClientError);
  }
  const legacy = ready(); delete legacy.experiment; legacy.proposal = { planId: 'ordinary-plan' };
  const f = setup(() => legacy); const client = await f.pair();
  assert.equal((await client.outcome('scale-1')).status, 'ready');
});

test('planning errors without a proposal cannot supply scale evidence', () => {
  const value = ready(); delete value.experiment; value.status = 'error'; value.requiresApply = false; value.proposal = null; value.error = 'Rejected before planning';
  validateScaleOutcome(value, proof());
  assert.equal(verifiedScaleObservation(value, proof()), null);
  value.status = 'ready'; value.requiresApply = true;
  assert.throws(() => validateScaleOutcome(value, proof()), MatrixClientError);
});

test('scale lifecycle cannot hide executed work behind pending, failed or cancelled labels', () => {
  for (const status of ['queued', 'running', 'failed', 'cancelled', 'stale', 'unconfirmed'] as const) {
    const value = confirmed(); value.status = status;
    value.experiment!.observationState = 'not-confirmed'; value.experiment!.observation = null;
    assert.throws(() => validateScaleOutcome(value, proof()), MatrixClientError);
  }
  const queued = ready(); queued.status = 'queued'; queued.requiresApply = false; queued.commandIds = ['command-1'];
  validateScaleOutcome(queued, proof());
  const failed = confirmed(); failed.status = 'failed'; failed.receipts[0].ok = false;
  failed.experiment!.observationState = 'not-confirmed'; failed.experiment!.observation = null;
  validateScaleOutcome(failed, proof());
  assert.equal(verifiedScaleObservation(failed, proof()), null);
});

test('equal-sequence scale response must remain identical and caller mutation cannot change the retained evidence', async () => {
  let value = confirmed();
  const f = setup(() => value); const client = await f.pair();
  const original = await client.outcome('scale-1');
  original.experiment!.observation!.mathematicalVolumeRatio = 99;
  assert.equal((await client.outcome('scale-1')).experiment?.observation?.mathematicalVolumeRatio, 8);
  value = { ...confirmed(), error: 'Changed at same sequence' };
  await assert.rejects(client.outcome('scale-1'), /without advancing its sequence/);
});
