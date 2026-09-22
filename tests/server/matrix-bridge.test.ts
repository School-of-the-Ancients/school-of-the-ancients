import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SchoolService } from '../../src/server/school-service.ts';
import { FileSchoolRepository } from '../../src/server/repository.ts';
import { DemoMentorProvider } from '../../src/server/providers.ts';
import { SchoolError } from '../../src/server/errors.ts';
import type { MatrixOutcome } from '../../src/integrations/matrix-client.ts';

const PAIR_CODE = 'one-use-private-pairing-code';
const position = { x: 1, y: 0, z: 2 };
const transform = { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'school-matrix-'));
  const state = { claims: 0, requests: 0, cancellations: 0, gets: 0, revision: 4, throwPropose: false, throwClaim: false, throwCancel: false, throwGet: false,
    sceneOverride: {} as Record<string, unknown>, pairingOverride: {} as Record<string, unknown>, outcomes: new Map<string, MatrixOutcome>(),
    onPropose: undefined as (() => void | Promise<void>) | undefined,
    onScene: undefined as (() => void | Promise<void>) | undefined,
    rawRequests: [] as Array<{ path: string; token: string | null }>,
  };
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname; const token = new Headers(init.headers).get('Authorization'); state.rawRequests.push({ path, token });
    if (path === '/api/v1/discovery') return response({ protocolVersion: '1', service: 'matrix-loading-operator', transport: 'local-companion', pairingAvailable: true, capabilities: { 'scene.read': true, 'scene.propose_text': { modes: ['offline-rules'], requiresOperatorApply: true }, 'request.read': true, 'request.cancel_before_apply': true, capture: false } });
    if (path === '/api/v1/sessions') {
      assert.deepEqual(JSON.parse(String(init.body)), { pairingCode: PAIR_CODE }); state.claims++;
      if (state.throwClaim) throw new Error('private claim transport detail');
      return response({ protocolVersion: '1', sessionId: `pair-${state.claims}`, runtimeSessionId: `runtime-${state.claims}`, clientToken: `secret-bearer-fixture-${state.claims}`, expiresInSeconds: 3600, ...state.pairingOverride });
    }
    const paired = /^Bearer secret-bearer-fixture-(\d+)$/.exec(token ?? ''); assert.ok(paired, 'Only paired client credentials may be sent');
    const sessionId = `pair-${paired[1]}`, runtimeSessionId = `runtime-${paired[1]}`;
    if (path === '/api/v1/scene') {
      await state.onScene?.();
      return response({ protocolVersion: '1', sessionId, runtimeSessionId, revision: state.revision, runtime: null,
        snapshot: { scene: { schemaVersion: 1, roomId: 'private-room-id', objects: [] }, assets: [{ assetId: 'block', displayName: 'Block', spawnScale: 1 }], anchors: [{ anchorId: 'floor', displayName: 'Floor' }], selection: { anchorId: 'floor', objectId: '', position }, ...state.sceneOverride } });
    }
    if (path === '/api/v1/requests') {
      const body = JSON.parse(String(init.body)); assert.equal(body.intent.text, 'Place a block here.'); assert.equal(body.intent.mode, 'offline-rules');
      assert.deepEqual(body.expected, { runtimeSessionId, revision: state.revision }); assert.equal(body.correlationId, body.requestId);
      state.requests++;
      const outcome: MatrixOutcome = { protocolVersion: '1', sessionId, runtimeSessionId, requestId: body.requestId, correlationId: body.correlationId, sequence: 1, status: 'ready', requiresApply: true,
        proposal: { planId: 'private-plan-id', commands: [{ op: 'spawn', assetId: 'block', anchorId: 'floor', transform }], sensitiveRoomData: 'DO-NOT-PERSIST-PROPOSAL-DUMP' }, commandIds: [], receipts: [], observed: null, error: null };
      state.outcomes.set(`${sessionId}:${body.requestId}`, outcome); await state.onPropose?.();
      if (state.throwPropose) throw new Error('private transport detail'); return response(outcome);
    }
    const match = /^\/api\/v1\/requests\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(path); assert.ok(match);
    const result = state.outcomes.get(`${sessionId}:${match[1]}`); if (!result) return response({ protocolVersion: '1', code: 'request_not_found' }, 404);
    if (match[2]) {
      state.cancellations++;
      if (state.throwCancel) throw new Error('private cancel detail');
      if (result.status === 'ready') Object.assign(result, { sequence: result.sequence + 1, status: 'cancelled', requiresApply: false });
    } else { state.gets++; if (state.throwGet) throw new Error('private read detail'); }
    return response(result);
  };
  let service = new SchoolService(new FileSchoolRepository(directory), new DemoMentorProvider(0), { matrix: { fetch: fetcher } });
  t.after(() => { service.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
  const sessionId = service.start({ requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' }).session.id;
  const current = () => service.session(sessionId).session;
  const pairing = () => ({ requestId: randomUUID(), expectedRevision: current().revision, url: 'http://127.0.0.1:8789', pairingCode: PAIR_CODE });
  const pair = async () => service.matrix.pair(sessionId, pairing());
  const request = async () => {
    const status = await service.matrix.status(sessionId);
    const body = { requestId: randomUUID(), expectedRevision: current().revision, bindingId: status.bridge.binding!.id, expectedMatrixRevision: state.revision };
    return { body, result: await service.matrix.request(sessionId, body) };
  };
  const getOutcome = (id: string) => { const binding = current().matrix!.bindings.find(item => item.id === current().matrix!.demonstrations.find(demo => demo.id === id)!.bindingId)!; return state.outcomes.get(`${binding.matrixSessionId}:${id}`)!; };
  const succeed = (id: string) => {
    const outcome = getOutcome(id); Object.assign(outcome, { sequence: outcome.sequence + 1, status: 'succeeded', requiresApply: false, commandIds: ['command-block'], receipts: [{ requestId: 'command-block', ok: true, error: '', objectId: 'placed-block' }],
      observed: { revision: state.revision + 1, snapshot: { privateRoomDescription: 'DO-NOT-PERSIST-ROOM-DUMP', scene: { objects: [{ objectId: 'placed-block', assetId: 'block', anchorId: 'floor', transform }, { objectId: 'unrelated', assetId: 'private-model', anchorId: 'private-anchor', transform }] } } } });
  };
  return { get service() { return service; }, state, directory, sessionId, current, pairing, pair, request, getOutcome, succeed,
    restart() { service.close(); service = new SchoolService(new FileSchoolRepository(directory), new DemoMentorProvider(0), { matrix: { fetch: fetcher } }); },
  };
}
const code = (expected: string) => (error: unknown) => error instanceof SchoolError && error.code === expected;

test('browser lesson works without Matrix and unpaired status performs no network calls', async t => {
  const f = fixture(t); const before = f.current(); const status = await f.service.matrix.status(f.sessionId);
  assert.equal(status.bridge.connected, false); assert.equal(status.bridge.readiness, null); assert.deepEqual(f.current(), before); assert.equal(f.state.rawRequests.length, 0);
  assert.equal(f.service.experiment(f.sessionId, { requestId: randomUUID(), expectedRevision: before.revision, dimensions: [2,2,2] }).session.artifact.volume, 8);
});

test('one-use pairing and fixed block intent are idempotent; tokens and room dumps never enter School records', async t => {
  const f = fixture(t); const body = f.pairing(); const paired = await f.service.matrix.pair(f.sessionId, body);
  assert.equal(paired.bridge.connected, true); assert.equal(paired.bridge.readiness?.canLaunch, true); assert.equal(paired.bridge.operatorUrl, 'http://127.0.0.1:8789/clients');
  assert.deepEqual(await f.service.matrix.pair(f.sessionId, body), paired); assert.equal(f.state.claims, 1);
  const { body: request, result } = await f.request(); assert.equal(result.demonstration?.status, 'ready'); assert.equal(result.demonstration?.requiresApply, true); assert.equal(result.demonstration?.observed, null);
  assert.deepEqual(await f.service.matrix.request(f.sessionId, request), result); assert.equal(f.state.requests, 1); assert.equal(f.current().stage, 'explain');
  assert.deepEqual(result.demonstration?.exhibit.identity.assets, [{ kind: 'builtin', assetId: 'block', identityGuarantee: 'asset-id-only' }]);
  const stored = readFileSync(join(f.directory, 'school-store.json'), 'utf8');
  for (const secret of [PAIR_CODE, 'secret-bearer-fixture', 'private-room-id', 'private-plan-id', 'DO-NOT-PERSIST']) assert.equal(stored.includes(secret), false, secret);
  assert.ok(f.state.rawRequests.every(item => !item.path.includes('apply')));
  await assert.rejects(f.service.matrix.request(f.sessionId, { ...request, expectedMatrixRevision: 99 }), code('request_conflict'));
});

test('only original command acknowledgements plus matched block become evidence, without advancing or replacing browser state', async t => {
  const f = fixture(t); await f.pair(); const { result } = await f.request(); const before = f.current(); const id = result.demonstration!.id; f.succeed(id);
  const checked = await f.service.matrix.poll(f.sessionId, id); assert.equal(checked.demonstration?.status, 'succeeded'); assert.equal(checked.demonstration?.observed?.objects.length, 1);
  assert.equal(checked.demonstration?.observed?.objects[0].objectId, 'placed-block'); assert.equal(checked.session.stage, before.stage); assert.deepEqual(checked.session.artifact, before.artifact);
  assert.equal(checked.session.messages.length, before.messages.length + 1); assert.match(checked.session.messages.at(-1)!.text, /does not establish camera evidence/);
  await f.service.matrix.poll(f.sessionId, id); assert.equal(f.current().messages.length, checked.session.messages.length);
  const stored = readFileSync(join(f.directory, 'school-store.json'), 'utf8'); assert.equal(stored.includes('DO-NOT-PERSIST'), false); assert.equal(stored.includes('private-model'), false);
  f.restart(); assert.equal(f.current().matrix!.demonstrations[0].status, 'succeeded'); assert.deepEqual(f.current().matrix!.demonstrations[0].observed, checked.demonstration?.observed);
});

test('cancel before Apply is idempotent and a dispatched cancellation never invents rollback', async t => {
  const f = fixture(t); await f.pair(); const { result } = await f.request(); const id = result.demonstration!.id; const action = { requestId: randomUUID() };
  const cancelled = await f.service.matrix.cancel(f.sessionId, id, action); assert.equal(cancelled.demonstration?.status, 'cancelled'); assert.equal(cancelled.demonstration?.observed, null);
  await f.service.matrix.cancel(f.sessionId, id, action); assert.equal(f.state.cancellations, 1); assert.equal(f.current().stage, 'explain');
  const next = await f.request(); const queued = f.getOutcome(next.result.demonstration!.id); Object.assign(queued, { status: 'queued', requiresApply: false, sequence: 2, commandIds: ['dispatched'] });
  const afterApply = await f.service.matrix.cancel(f.sessionId, queued.requestId, { requestId: randomUUID() }); assert.equal(afterApply.demonstration?.status, 'queued'); assert.equal(afterApply.demonstration?.observed, null);
});

test('transport loss after proposal acceptance stays unconfirmed and queries the original request without replay', async t => {
  const f = fixture(t); await f.pair(); f.state.throwPropose = true;
  const { body, result } = await f.request(); assert.equal(result.demonstration?.status, 'unconfirmed'); assert.equal(f.state.requests, 1);
  await f.service.matrix.request(f.sessionId, body); assert.equal(f.state.requests, 1);
  const recovered = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(recovered.demonstration?.status, 'ready'); assert.equal(f.state.requests, 1);
});

test('restart loses credentials, preserves uncertain work, and never attaches old requests to a new pairing', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); f.restart();
  assert.equal(f.current().matrix!.demonstrations[0].status, 'unconfirmed'); const count = f.state.rawRequests.length;
  assert.equal((await f.service.matrix.status(f.sessionId)).bridge.connected, false); assert.match((await f.service.matrix.poll(f.sessionId, body.requestId)).demonstration!.checkError!, /original pairing/); assert.equal(f.state.rawRequests.length, count);
  await f.pair(); await f.service.matrix.request(f.sessionId, body); await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(f.state.requests, 1); assert.equal(f.state.gets, 0);
  await assert.rejects(f.service.matrix.cancel(f.sessionId, body.requestId, { requestId: randomUUID() }), code('matrix_disconnected'));
});

test('re-pair within one process retains the old binding solely to reconcile its original request', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); await f.pair(); f.succeed(body.requestId);
  const result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'succeeded'); assert.equal(result.demonstration?.matrixSessionId, 'pair-1'); assert.equal(result.bridge.binding?.matrixSessionId, 'pair-2');
  const last = f.state.rawRequests.at(-1)!; assert.equal(last.token, 'Bearer secret-bearer-fixture-1'); assert.equal(f.state.requests, 1);
});

test('stale School or Matrix revisions and missing assets are rejected before sending a proposal', async t => {
  const f = fixture(t); const paired = await f.pair(); const body = { requestId: randomUUID(), expectedRevision: paired.session.revision, bindingId: paired.bridge.binding!.id, expectedMatrixRevision: f.state.revision };
  await assert.rejects(f.service.matrix.request(f.sessionId, { ...body, expectedRevision: 1 }), code('stale_revision'));
  f.state.revision++; await assert.rejects(f.service.matrix.request(f.sessionId, body), code('matrix_revision_changed'));
  f.state.sceneOverride = { assets: [] }; await assert.rejects(f.service.matrix.request(f.sessionId, { ...body, expectedMatrixRevision: f.state.revision }), code('matrix_not_ready'));
  assert.equal(f.state.requests, 0); assert.equal(f.current().matrix!.demonstrations.length, 0);
});

test('a School revision that changes during readiness is rechecked before reserving scene intent', async t => {
  const f = fixture(t); const paired = await f.pair();
  f.state.onScene = () => { f.state.onScene = undefined; f.service.experiment(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision, dimensions: [2,1,1] }); };
  await assert.rejects(f.service.matrix.request(f.sessionId, { requestId: randomUUID(), expectedRevision: paired.session.revision, bindingId: paired.bridge.binding!.id, expectedMatrixRevision: f.state.revision }), code('stale_revision'));
  assert.equal(f.state.requests, 0); assert.equal(f.current().artifact.volume, 2);
});

test('mismatched runtime, correlation, receipt object, or backwards sequence cannot claim successful placement', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); const outcome = f.getOutcome(body.requestId); const runtime = outcome.runtimeSessionId;
  f.succeed(body.requestId); outcome.runtimeSessionId = 'replacement'; let result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.notEqual(result.demonstration?.status, 'succeeded');
  outcome.runtimeSessionId = runtime; outcome.correlationId = 'unrelated'; result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.notEqual(result.demonstration?.status, 'succeeded');
  outcome.correlationId = body.requestId; outcome.receipts[0].objectId = 'another-object'; result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'unconfirmed'); assert.equal(result.demonstration?.observed, null); assert.equal(result.demonstration?.receipts.length, 1);
  outcome.sequence = 0; result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'unconfirmed'); assert.match(result.demonstration?.checkError ?? '', /matched safely/);
});

test('a room-loss receipt retains its correlation without manufacturing scene evidence', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); const outcome = f.getOutcome(body.requestId);
  Object.assign(outcome, { sequence: 3, status: 'unconfirmed', requiresApply: false, commandIds: ['command-block'], receipts: [{ requestId: 'command-block', ok: true, objectId: 'placed-block', error: '' }], observed: null });
  const result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'unconfirmed'); assert.equal(result.demonstration?.receipts.length, 1); assert.equal(result.demonstration?.observed, null); assert.equal(result.session.messages.length, 1);
});

test('later reads cannot replace command receipts, rewrite confirmed transforms or downgrade known success', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); f.succeed(body.requestId);
  const confirmed = await f.service.matrix.poll(f.sessionId, body.requestId); const evidence = structuredClone(confirmed.demonstration!.observed); const outcome = f.getOutcome(body.requestId);
  Object.assign(outcome, { sequence: 3, status: 'unconfirmed', observed: null });
  let result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'succeeded'); assert.deepEqual(result.demonstration?.observed, evidence);
  f.succeed(body.requestId); (outcome.observed as unknown as { snapshot: { scene: { objects: Array<{ transform: typeof transform }> } } }).snapshot.scene.objects[0].transform = { ...transform, scale: { x: 9, y: 9, z: 9 } };
  result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'succeeded'); assert.deepEqual(result.demonstration?.observed, evidence);
  outcome.receipts[0].objectId = 'replacement'; result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.receipts[0].objectId, 'placed-block'); assert.deepEqual(result.demonstration?.observed, evidence);
});

test('failed durable reservation sends nothing; failed result persistence reconciles without another network mutation', async t => {
  const f = fixture(t); const paired = await f.pair(); const original = f.service.repository.mutate.bind(f.service.repository); let fail = true;
  f.service.repository.mutate = (change) => { if (fail) throw new SchoolError(500, 'persistence_failed', 'fixture'); return original(change); };
  const body = { requestId: randomUUID(), expectedRevision: paired.session.revision, bindingId: paired.bridge.binding!.id, expectedMatrixRevision: f.state.revision };
  await assert.rejects(f.service.matrix.request(f.sessionId, body), code('persistence_failed')); assert.equal(f.state.requests, 0); assert.equal(f.current().matrix!.demonstrations.length, 0);
  fail = false; f.state.onPropose = () => { fail = true; };
  await assert.rejects(f.service.matrix.request(f.sessionId, body), code('persistence_failed')); assert.equal(f.state.requests, 1); assert.equal(f.current().matrix!.demonstrations[0].status, 'submitting');
  await assert.rejects(f.service.matrix.request(f.sessionId, body), code('persistence_failed')); assert.equal(f.state.requests, 1);
  fail = false; const recovered = await f.service.matrix.request(f.sessionId, body); assert.equal(recovered.demonstration?.status, 'ready'); assert.equal(f.state.requests, 1);
});

test('concurrent repeated action reads its durable intent and other bridge mutations wait', async t => {
  const f = fixture(t); const paired = await f.pair(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let dispatched!: () => void; const started = new Promise<void>(resolve => { dispatched = resolve; });
  f.state.onPropose = async () => { dispatched(); await gate; };
  const body = { requestId: randomUUID(), expectedRevision: paired.session.revision, bindingId: paired.bridge.binding!.id, expectedMatrixRevision: f.state.revision };
  const first = f.service.matrix.request(f.sessionId, body); await started;
  assert.equal((await f.service.matrix.request(f.sessionId, body)).demonstration?.status, 'submitting');
  await assert.rejects(f.service.matrix.pair(f.sessionId, f.pairing()), code('bridge_busy'));
  assert.throws(() => f.service.matrix.disconnect(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision }), code('bridge_busy'));
  release(); assert.equal((await first).demonstration?.status, 'ready'); assert.equal(f.state.requests, 1);
});

test('an uncertain claim is never automatically retried and a changed code on the same action ID cannot consume another code', async t => {
  const f = fixture(t); f.state.throwClaim = true; const body = f.pairing(); const result = await f.service.matrix.pair(f.sessionId, body);
  assert.equal(result.bridge.binding?.status, 'unconfirmed'); assert.equal(result.bridge.connected, false);
  await f.service.matrix.pair(f.sessionId, { ...body, pairingCode: 'different-secret-one-use-code' }); assert.equal(f.state.claims, 1);
  assert.equal(readFileSync(join(f.directory, 'school-store.json'), 'utf8').includes(PAIR_CODE), false);
});

test('disconnect preserves uncertain evidence, rejects cancel without original credential and leaves browser lesson usable', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request();
  const disconnected = f.service.matrix.disconnect(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision });
  assert.equal(disconnected.bridge.connected, false); assert.equal(disconnected.bridge.demonstrations[0].status, 'unconfirmed'); assert.equal(f.state.cancellations, 0);
  await assert.rejects(f.service.matrix.cancel(f.sessionId, body.requestId, { requestId: randomUUID() }), code('matrix_disconnected'));
  assert.equal(f.service.experiment(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision, dimensions: [2,2,2] }).session.artifact.volume, 8);
});

test('private token fields or forged successful evidence cannot be written to the shared lesson store', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); const before = readFileSync(join(f.directory, 'school-store.json'), 'utf8');
  assert.throws(() => f.service.repository.mutate(store => { (store.sessions[f.sessionId].matrix!.bindings[0] as unknown as Record<string, unknown>).clientToken = 'should-never-persist'; }), code('invalid_store'));
  assert.throws(() => f.service.repository.mutate(store => { store.sessions[f.sessionId].matrix!.demonstrations[0].status = 'succeeded'; }), code('invalid_store'));
  assert.equal(readFileSync(join(f.directory, 'school-store.json'), 'utf8'), before); assert.equal(f.current().matrix!.demonstrations[0].id, body.requestId);
});

test('uncertain cancellation does not retry and read failures preserve previous confirmed facts', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); f.state.throwCancel = true; const action = { requestId: randomUUID() };
  const cancelled = await f.service.matrix.cancel(f.sessionId, body.requestId, action); assert.equal(cancelled.demonstration?.status, 'unconfirmed'); assert.equal(cancelled.demonstration?.requiresApply, false);
  await f.service.matrix.cancel(f.sessionId, body.requestId, action); assert.equal(f.state.cancellations, 1);
  f.succeed(body.requestId); const confirmed = await f.service.matrix.poll(f.sessionId, body.requestId); f.state.throwGet = true;
  const failedCheck = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(failedCheck.demonstration?.status, 'succeeded'); assert.deepEqual(failedCheck.demonstration?.observed, confirmed.demonstration?.observed); assert.ok(failedCheck.demonstration?.checkError);
});

test('demonstrations cannot cross School sessions and disconnect drops all credentials for this lesson', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); await f.pair();
  const other = f.service.start({ requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' }).session.id;
  await assert.rejects(f.service.matrix.poll(other, body.requestId), code('not_found'));
  f.service.matrix.disconnect(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision }); const calls = f.state.rawRequests.length;
  const result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.match(result.demonstration?.checkError ?? '', /original pairing/); assert.equal(f.state.rawRequests.length, calls);
});

test('remote addresses, embedded credentials, unsupported intents and request ID reuse are rejected before pairing', async t => {
  const f = fixture(t);
  for (const url of ['http://100.100.100.100:8789', 'http://localhost:8789/path', 'http://user:secret@localhost:8789', 'file:///C:/private', 'not-a-url']) await assert.rejects(f.service.matrix.pair(f.sessionId, { ...f.pairing(), url }), code('invalid_url'));
  await assert.rejects(f.service.matrix.pair(f.sessionId, { ...f.pairing(), ownerToken: 'not-allowed' }), code('invalid_request'));
  assert.equal(f.state.claims, 0); assert.equal(f.state.rawRequests.length, 0);
  const paired = await f.pair(); await assert.rejects(f.service.matrix.request(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision, bindingId: paired.bridge.binding!.id, expectedMatrixRevision: 4, text: 'Clear the room' }), code('invalid_request'));
  assert.equal(f.state.requests, 0);
});

test('a same-anchor proposal away from the selected point and malformed block scales cannot be verified', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); const outcome = f.getOutcome(body.requestId);
  (outcome.proposal!.commands as Array<{ transform: typeof transform }>)[0].transform = { ...transform, position: { x: 9, y: 0, z: 2 } }; outcome.sequence++;
  const mismatch = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(mismatch.demonstration?.status, 'unconfirmed'); assert.equal(mismatch.demonstration?.requiresApply, false); assert.match(mismatch.demonstration?.error ?? '', /selected point/);
  (outcome.proposal!.commands as Array<{ transform: typeof transform }>)[0].transform = structuredClone(transform); f.succeed(body.requestId);
  const objects = (outcome.observed as { snapshot: Record<string, unknown> }).snapshot.scene as { objects: Array<{ transform: typeof transform }> };
  objects.objects[0].transform = { ...transform, scale: { x: 0, y: -1, z: 1 } };
  const invalid = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(invalid.demonstration?.status, 'unconfirmed'); assert.equal(invalid.demonstration?.observed, null);
});

test('surface evidence verifies authoritative prefab bounds adjustment rather than accepting arbitrary height', async t => {
  const f = fixture(t);
  f.state.sceneOverride = { roomContext: { mode: 'ar', state: 'ready', alignmentVerified: true },
    assets: [{ assetId: 'block', displayName: 'Block', spawnScale: .5, localBounds: { center: { x: 0, y: .2, z: 0 }, size: { x: 1, y: 2, z: 1 } } }],
    anchors: [{ anchorId: 'floor', displayName: 'Floor', source: 'mruk', surface: { kind: 'support', boundary: [{ x: -3, y: 0, z: -3 }, { x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, { x: -3, y: 0, z: 3 }] } }],
  };
  f.state.onPropose = () => { const outcome = [...f.state.outcomes.values()].at(-1)!; const command = (outcome.proposal!.commands as Array<Record<string, unknown>>)[0]; command.placement = 'surface'; command.transform = { ...transform, scale: { x: .5, y: .5, z: .5 } }; };
  const paired = await f.pair(); assert.equal(paired.bridge.readiness?.canLaunch, true);
  const { body, result } = await f.request(); assert.equal(result.demonstration?.status, 'ready'); assert.equal(result.demonstration?.placement.mode, 'surface');
  f.succeed(body.requestId); const outcome = f.getOutcome(body.requestId); const scene = (outcome.observed as { snapshot: Record<string, unknown> }).snapshot.scene as { objects: Array<{ transform: typeof transform }> };
  scene.objects[0].transform = { ...transform, position: { ...position, y: 5 }, scale: { x: .5, y: .5, z: .5 } };
  assert.equal((await f.service.matrix.poll(f.sessionId, body.requestId)).demonstration?.status, 'unconfirmed');
  // (bounds.center.y - bounds.size.y/2) * scale = -.4, so pivot is y=.4 above the selected plane.
  scene.objects[0].transform.position.y = .4;
  const observed = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(observed.demonstration?.status, 'succeeded'); assert.equal(observed.demonstration?.observed?.objects[0].position.y, .4);
  assert.equal(observed.session.stage, 'explain');
});

test('cancelled, review-only, failed and pre-Apply statuses cannot carry fabricated successful execution evidence', async t => {
  const f = fixture(t); await f.pair(); const { body } = await f.request(); f.succeed(body.requestId); const outcome = f.getOutcome(body.requestId);
  for (const status of ['cancelled','needs_clarification','review_only','stale','failed','partial','queued','running'] as const) {
    outcome.sequence++; outcome.status = status;
    const result = await f.service.matrix.poll(f.sessionId, body.requestId); assert.equal(result.demonstration?.status, 'ready'); assert.equal(result.demonstration?.observed, null); assert.equal(result.demonstration?.receipts.length, 0); assert.ok(result.demonstration?.checkError);
  }
});

test('malformed pairing identity becomes unconfirmed without poisoning the durable store or exposing credentials', async t => {
  const f = fixture(t); f.state.pairingOverride = { sessionId: 'invalid identity' };
  const result = await f.pair(); assert.equal(result.bridge.binding?.status, 'unconfirmed'); assert.equal(result.bridge.connected, false); assert.equal(result.bridge.binding?.matrixSessionId, undefined);
  f.state.pairingOverride = {}; assert.equal((await f.pair()).bridge.connected, true); assert.equal(f.state.claims, 2);
  assert.equal(readFileSync(join(f.directory, 'school-store.json'), 'utf8').includes('secret-bearer'), false);
});
