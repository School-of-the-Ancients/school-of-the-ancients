import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FileSchoolRepository } from '../../src/server/repository.ts';
import { SchoolService } from '../../src/server/school-service.ts';
import { DemoMentorProvider } from '../../src/server/providers.ts';
import { SchoolError } from '../../src/server/errors.ts';
import { createSchoolServer } from '../../src/server/http.ts';
import { MatrixClient, MatrixClientError } from '../../src/integrations/matrix-client.ts';
import type { MatrixOutcome } from '../../src/integrations/matrix-client.ts';

const intent = { kind: 'matrix-scene' as const, title: 'Compare two lengths', learningGoal: 'Compare linear size and volume.', prompt: 'Build two differently sized block towers to compare linear dimensions.' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const code = (name: string) => (error: unknown) => error instanceof SchoolError && error.code === name;
function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'school-scene-build-'));
  let repository = new FileSchoolRepository(directory);
  const state = { revision: 5, claims: 0, mode: true, sent: [] as any[], cancels: 0, outcomes: new Map<string, MatrixOutcome>(), failSend: false, failCancel: false,
    reject: undefined as { protocolVersion?: string; code: string; status: number } | undefined,
    onScene: undefined as (() => void) | undefined, onSend: undefined as (() => void | Promise<void>) | undefined,
    snapshot: { roomContext: { mode: 'white-room', state: 'ready' }, scene: { schemaVersion: 1, roomId: 'private-room', objects: [] as any[] }, assets: [], anchors: [], privateRoomNote: 'NEVER-PERSIST-ROOM' } as any };
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/discovery')) return json({ protocolVersion: '1', service: 'matrix-loading-operator', transport: 'local-companion', pairingAvailable: true, capabilities: { 'scene.read': true, 'scene.propose_text': { modes: state.mode ? ['offline-rules','codex-cli'] : ['offline-rules'], requiresOperatorApply: true }, 'request.read': true } });
    if (path.endsWith('/sessions')) { state.claims++; return json({ protocolVersion: '1', sessionId: `pair-${state.claims}`, runtimeSessionId: `runtime-${state.claims}`, clientToken: `NEVER-PERSIST-TOKEN-${state.claims}`, expiresInSeconds: 3600 }); }
    const binding = /NEVER-PERSIST-TOKEN-(\d+)/.exec(new Headers(init.headers).get('Authorization')!)![1];
    const sessionId = `pair-${binding}`, runtimeSessionId = `runtime-${binding}`;
    if (path.endsWith('/scene')) { state.onScene?.(); return json({ protocolVersion: '1', sessionId, runtimeSessionId, revision: state.revision, runtime: null, snapshot: state.snapshot }); }
    if (path === '/api/v1/requests') {
      const body = JSON.parse(String(init.body)); state.sent.push(body);
      if (state.reject) { const { status, ...error } = state.reject; return json(error, status); }
      const outcome: MatrixOutcome = { protocolVersion: '1', sessionId, runtimeSessionId, requestId: body.requestId, correlationId: body.correlationId, sequence: 1, status: 'planning', requiresApply: false, proposal: null, commandIds: [], receipts: [], observed: null, error: null };
      state.outcomes.set(body.requestId, outcome); await state.onSend?.(); if (state.failSend) throw Error('NEVER-PERSIST-ERROR'); return json(outcome);
    }
    const match = /\/requests\/([^/]+)(\/cancel)?$/.exec(path)!;
    const outcome = state.outcomes.get(match[1]);
    if (!outcome || outcome.sessionId !== sessionId) return json({ protocolVersion: '1', code: 'request_not_found' }, 404);
    if (match[2]) { state.cancels++; if (state.failCancel) throw Error('NEVER-PERSIST-CANCEL'); if (['planning','ready'].includes(outcome.status)) Object.assign(outcome, { status: 'cancelled', requiresApply: false, sequence: outcome.sequence + 1 }); }
    return json(outcome);
  };
  function provider() { const result = new DemoMentorProvider(0); result.respond = async () => ({ text: 'Let us compare these two towers.', demonstration: structuredClone(intent), receipt: { mode: 'demo', completedTurn: true, toolCallCount: 0 } }); return result; }
  let service = new SchoolService(repository, provider(), { matrix: { fetch: fetcher } });
  const sessionId = service.start({ requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' }).session.id;
  t.after(() => { service.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
  const current = () => service.session(sessionId).session;
  const teach = async (kind: 'question' | 'advance' = 'question') => {
    const turn = service.createTurn(sessionId, { requestId: randomUUID(), expectedRevision: current().revision, kind, ...(kind === 'question' ? { text: 'Show me a comparison.' } : {}) }).turn;
    await new Promise(resolve => setImmediate(resolve)); assert.equal(service.turn(turn.id).turn.status, 'completed'); return turn.id;
  };
  const pair = () => service.matrix.pair(sessionId, { requestId: randomUUID(), expectedRevision: current().revision, url: 'http://127.0.0.1:18898', pairingCode: 'NEVER-PERSIST-CODE' });
  const body = (extra: Record<string, unknown> = {}) => ({ requestId: randomUUID(), expectedRevision: current().revision, bindingId: current().matrix!.activeBindingId, expectedMatrixRevision: state.revision, turnId: current().messages.findLast(item => item.role === 'mentor')!.turnId, ...extra });
  const ready = (id: string, commands: any[] = [{ op: 'clear' }, { op: 'spawn', assetId: 'block' }]) => { const item = state.outcomes.get(id)!; Object.assign(item, { sequence: item.sequence + 1, status: 'ready', requiresApply: true, proposal: { commands, summary: 'NEVER-PERSIST-PLANNER-SUMMARY' } }); };
  const finish = (id: string, ok = [true,true]) => {
    const item = state.outcomes.get(id)!; state.revision++;
    const commands = ok.map((_, index) => `cmd-${index}-${id}`), successes = ok.filter(Boolean).length;
    Object.assign(item, { sequence: item.sequence + 1, status: successes === ok.length ? 'succeeded' : successes ? 'partial' : 'failed', requiresApply: false, commandIds: commands,
      receipts: ok.map((success, index) => ({ requestId: commands[index], ok: success, objectId: success ? `object-${index}` : '', error: success ? '' : 'NEVER-PERSIST-RUNTIME-ERROR' })), observed: { revision: state.revision, snapshot: structuredClone(state.snapshot) } });
  };
  return { directory, state, fetcher, sessionId, current, teach, pair, body, ready, finish, get service() { return service; }, get repository() { return repository; }, restart() { service.close(); repository = new FileSchoolRepository(directory); service = new SchoolService(repository, provider(), { matrix: { fetch: fetcher } }); } };
}

test('saved mentor intent dispatches once through codex-cli without prepared block; historical multi-command evidence leaves lesson unchanged', async t => {
  const f = fixture(t); await f.teach(); await f.pair();
  const before = f.current(), readiness = await f.service.matrix.status(f.sessionId); assert.equal(readiness.bridge.readiness!.canLaunch, false); assert.equal(readiness.bridge.sceneBuilder.available, true);
  const body = f.body(), result = await f.service.matrix.requestSceneBuild(f.sessionId, body);
  assert.equal(result.sceneBuild!.status, 'planning'); assert.deepEqual(f.state.sent[0].intent, { text: intent.prompt, mode: 'codex-cli' });
  await f.service.matrix.requestSceneBuild(f.sessionId, body); const dedup = await f.service.matrix.requestSceneBuild(f.sessionId, f.body()); assert.equal(dedup.sceneBuild!.id, body.requestId); assert.equal(f.state.sent.length, 1);
  f.ready(body.requestId); assert.equal((await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId)).sceneBuild!.requiresApply, true);
  f.finish(body.requestId); const done = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId);
  assert.deepEqual(done.sceneBuild!.observed, { source: 'matrix-runtime', revision: 6, confirmedCommandCount: 2, failedCommandCount: 0, objectIds: ['object-0','object-1'] });
  assert.equal(done.session.stage, before.stage); assert.deepEqual(done.session.artifact, before.artifact);
  const count = done.session.messages.length; await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(f.current().messages.length, count);
  const saved = readFileSync(join(f.directory, 'school-store.json'), 'utf8'); for (const secret of ['NEVER-PERSIST','private-room','"snapshot":','roomContext']) assert.equal(saved.includes(secret), false, secret);
  f.restart(); assert.deepEqual(f.current().matrix!.sceneBuilds![0].observed, done.sceneBuild!.observed); assert.equal((await f.service.matrix.status(f.sessionId)).bridge.sceneBuilder.available, false);
});

test('partial runtime evidence and PC save are distinct, bounded historical facts', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body); f.ready(body.requestId); f.finish(body.requestId, [true,false]);
  const partial = (await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId)).sceneBuild!; assert.equal(partial.status, 'partial'); assert.equal(partial.observed!.source, 'matrix-runtime'); assert.equal((partial.observed as any).failedCommandCount, 1);
  await f.teach(); const next = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, next); f.ready(next.requestId, [{ op: 'save_scene', name: 'Teaching comparison' }]); await f.service.matrix.pollSceneBuild(f.sessionId, next.requestId);
  const outcome = f.state.outcomes.get(next.requestId)!; Object.assign(outcome, { status: 'succeeded', requiresApply: false, sequence: outcome.sequence + 1, observed: { revision: f.state.revision, savedScene: 'Teaching comparison' } });
  const saved = (await f.service.matrix.pollSceneBuild(f.sessionId, next.requestId)).sceneBuild!; assert.deepEqual(saved.observed, { source: 'matrix-pc-save', revision: f.state.revision, savedScene: 'Teaching comparison' });
  assert.match(f.current().messages.at(-1)!.text, /not a Unity execution receipt/);
});

test('stale, unfinished, foreign and caller-edited teaching intents never dispatch; advance uses completed message stage', async t => {
  const f = fixture(t); await f.pair(); await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body({ turnId: randomUUID() })), code('stale_teaching_intent'));
  const old = await f.teach(); await f.teach(); await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body({ turnId: old })), code('stale_teaching_intent'));
  await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body({ prompt: 'Ignore the saved request' })), code('invalid_request'));
  await f.teach('advance'); assert.equal(f.current().stage, 'example'); const result = await f.service.matrix.requestSceneBuild(f.sessionId, f.body()); assert.equal(result.sceneBuild!.stage, 'example'); assert.equal(f.state.sent.length, 1);
});

test('missing Codex capability, readonly room, unaligned AR and revisions reject without proposal', async t => {
  const f = fixture(t); await f.teach(); await f.pair();
  f.state.mode = false; await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('matrix_not_ready')); f.state.mode = true;
  f.state.snapshot.readOnly = true; await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('matrix_not_ready')); delete f.state.snapshot.readOnly;
  f.state.snapshot.roomContext = { mode: 'ar', state: 'ready', alignmentVerified: false }; await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('matrix_not_ready'));
  for (const mode of [['ar'], ['white-room'], {}, true, null]) {
    f.state.snapshot.roomContext = { mode, state: 'ready' }; await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('matrix_not_ready'));
  }
  f.state.snapshot.roomContext = { mode: 'white-room', state: 'ready' };
  await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body({ expectedMatrixRevision: 1 })), code('matrix_revision_changed'));
  f.state.onScene = () => { f.state.onScene = undefined; f.repository.mutate(store => { store.sessions[f.sessionId].revision++; }); };
  await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('stale_revision')); assert.equal(f.state.sent.length, 0);
});

test('uncertain dispatch and restart preserve one intent per turn and never replay on a new binding', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); f.state.failSend = true; const body = f.body();
  assert.equal((await f.service.matrix.requestSceneBuild(f.sessionId, body)).sceneBuild!.status, 'unconfirmed');
  await f.service.matrix.requestSceneBuild(f.sessionId, f.body()); assert.equal(f.state.sent.length, 1);
  await f.teach(); await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('demonstration_pending'));
  f.restart(); await f.pair(); await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body({ turnId: body.turnId })), code('request_conflict'));
  const prior = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(prior.sceneBuild!.status, 'unconfirmed'); assert.ok(prior.sceneBuild!.checkError); assert.equal(f.state.sent.length, 1);
});

test('concurrent repeated turn reads reserved build, and other work cannot overtake dispatch', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); f.state.onSend = () => held; const body = f.body(); const running = f.service.matrix.requestSceneBuild(f.sessionId, body);
  await new Promise(resolve => setImmediate(resolve)); const duplicate = await f.service.matrix.requestSceneBuild(f.sessionId, f.body()); assert.equal(duplicate.sceneBuild!.id, body.requestId); assert.equal(duplicate.sceneBuild!.status, 'submitting');
  await assert.rejects(f.service.matrix.pair(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision, url: 'http://127.0.0.1:18898', pairingCode: 'another-code' }), code('bridge_busy'));
  release(); await running; assert.equal(f.state.sent.length, 1);
});

test('wrong correlation, runtime, same-sequence changes and later changed proposal cannot become evidence', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body); f.ready(body.requestId); await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId);
  const original = structuredClone(f.state.outcomes.get(body.requestId)!);
  for (const mutate of [(o: any) => { o.correlationId = 'unrelated'; }, (o: any) => { o.runtimeSessionId = 'different'; }, (o: any) => { o.proposal.summary = 'rewritten'; }]) {
    const next = structuredClone(original); mutate(next); f.state.outcomes.set(body.requestId, next); const checked = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(checked.sceneBuild!.observed, null); assert.ok(checked.sceneBuild!.checkError);
  }
  f.state.outcomes.set(body.requestId, original); await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId);
  f.finish(body.requestId); (f.state.outcomes.get(body.requestId)!.proposal!.commands as any[])[0].op = 'delete';
  assert.equal((await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId)).sceneBuild!.status, 'unconfirmed');
});

test('contradictory terminal statuses, arbitrary save evidence and missing snapshots stay unconfirmed', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body); f.ready(body.requestId); f.finish(body.requestId);
  const success = structuredClone(f.state.outcomes.get(body.requestId)!);
  for (const mutate of [(o: any) => { o.status = 'cancelled'; }, (o: any) => { o.status = 'failed'; }, (o: any) => { o.observed = { revision: 6, savedScene: 'invented save' }; o.commandIds = []; o.receipts = []; }, (o: any) => { o.observed.snapshot = {}; }]) {
    const next = structuredClone(success); mutate(next); f.state.outcomes.set(body.requestId, next); const checked = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(checked.sceneBuild!.observed, null); assert.ok(checked.sceneBuild!.checkError);
  }
});

test('pre-Apply cancellation is idempotent; uncertain cancellation never retries or invents rollback', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body); f.ready(body.requestId);
  f.state.failCancel = true; const cancel = { requestId: randomUUID() }; assert.equal((await f.service.matrix.cancelSceneBuild(f.sessionId, body.requestId, cancel)).sceneBuild!.status, 'unconfirmed');
  f.state.failCancel = false; await f.service.matrix.cancelSceneBuild(f.sessionId, body.requestId, cancel); assert.equal(f.state.cancels, 1);
  const checked = await f.service.matrix.cancelSceneBuild(f.sessionId, body.requestId, { requestId: randomUUID() }); assert.equal(checked.sceneBuild!.status, 'cancelled'); assert.equal(checked.sceneBuild!.observed, null);
});

test('repository rejects forged intent correspondence, private scene fields and fabricated receipts without changing records', async t => {
  const f = fixture(t); const turnId = await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body);
  const before = f.repository.snapshot();
  for (const mutate of [(s: any) => { s.turns[turnId].demonstration.prompt = 'Changed'; }, (s: any) => { s.sessions[f.sessionId].matrix.sceneBuilds[0].snapshot = f.state.snapshot; }, (s: any) => { s.sessions[f.sessionId].matrix.sceneBuilds[0].status = 'succeeded'; }]) assert.throws(() => f.repository.mutate(mutate), code('invalid_store'));
  assert.deepEqual(f.repository.snapshot(), before);
});

test('disconnect preserves pending scene intent as unconfirmed and original credentials cannot be replaced', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body);
  const response = f.service.matrix.disconnect(f.sessionId, { requestId: randomUUID(), expectedRevision: f.current().revision });
  assert.equal(response.bridge.sceneBuilds[0].status, 'unconfirmed'); assert.equal(response.bridge.sceneBuilder.available, false);
  await f.pair(); const checked = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(checked.sceneBuild!.status, 'unconfirmed'); assert.ok(checked.sceneBuild!.checkError);
  await assert.rejects(f.service.matrix.cancelSceneBuild(f.sessionId, body.requestId, { requestId: randomUUID() }), code('matrix_disconnected')); assert.equal(f.state.cancels, 0);
});

test('failed durable reservation sends nothing, and failed outcome save is flushed without replay', async t => {
  const f = fixture(t); await f.teach(); await f.pair();
  const mutate = f.repository.mutate.bind(f.repository); let reject = true;
  f.repository.mutate = ((change: any) => { if (reject) throw new SchoolError(500, 'persistence_failed', 'fixture failure'); return mutate(change); }) as typeof f.repository.mutate;
  await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, f.body()), code('persistence_failed')); assert.equal(f.state.sent.length, 0);
  reject = false; f.state.onSend = () => { reject = true; }; const body = f.body();
  await assert.rejects(f.service.matrix.requestSceneBuild(f.sessionId, body), code('persistence_failed')); assert.equal(f.current().matrix!.sceneBuilds![0].status, 'submitting'); assert.equal(f.state.sent.length, 1);
  reject = false; f.state.onSend = undefined;
  const retry = await f.service.matrix.requestSceneBuild(f.sessionId, body); assert.equal(retry.sceneBuild!.status, 'planning'); assert.equal(f.state.sent.length, 1);
});

test('late result for original pairing survives re-pair without adopting another runtime or erasing prior evidence', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const body = f.body(); await f.service.matrix.requestSceneBuild(f.sessionId, body); f.ready(body.requestId); await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId);
  await f.pair(); f.finish(body.requestId); const done = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(done.sceneBuild!.status, 'succeeded'); assert.equal(done.sceneBuild!.runtimeSessionId, 'runtime-1'); assert.equal(done.bridge.binding!.runtimeSessionId, 'runtime-2');
  const saved = structuredClone(done.sceneBuild!.observed), bad = f.state.outcomes.get(body.requestId)!;
  bad.sequence++; (bad.observed as any).revision++; const checked = await f.service.matrix.pollSceneBuild(f.sessionId, body.requestId); assert.equal(checked.sceneBuild!.status, 'succeeded'); assert.deepEqual(checked.sceneBuild!.observed, saved); assert.ok(checked.sceneBuild!.checkError);
});

test('scene-build HTTP route accepts only saved turn authority and exposes no Apply endpoint', async t => {
  const f = fixture(t); await f.teach(); await f.pair(); const server = createSchoolServer({ service: f.service }); server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, path = `/api/v1/sessions/${f.sessionId}/matrix/scene-builds`;
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.body()) }); assert.equal(response.status, 200); const saved = await response.json() as any;
  const fetched = await fetch(origin + path + '/' + saved.sceneBuild.id); assert.equal(fetched.status, 200);
  assert.equal((await fetch(origin + path + '/' + saved.sceneBuild.id + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});

test('SDK explicit Codex mode preserves default offline mode and rejects unsafe mode or correlation rewrites', async t => {
  const f = fixture(t), client = await MatrixClient.pair('http://127.0.0.1:18898', 'code', { fetch: f.fetcher });
  await client.propose('Place a block.', { requestId: 'default', revision: 5 }); assert.equal(f.state.sent[0].intent.mode, 'offline-rules');
  await client.propose('A tower.', { requestId: 'codex', revision: 5, mode: 'codex-cli', correlationId: 'original' }); assert.equal(f.state.sent[1].intent.mode, 'codex-cli');
  await assert.rejects(client.propose('A tower.', { requestId: 'bad', revision: 5, mode: 'arbitrary-code' as any }), MatrixClientError);
  await assert.rejects(client.propose('A tower.', { requestId: 'codex', revision: 5, mode: 'codex-cli', correlationId: 'changed' }), MatrixClientError); assert.equal(f.state.sent.length, 2);
});

test('only exact v1 Codex planning-unavailable rejection is definitive; generic5xx and other paths remain uncertain', async t => {
  const f = fixture(t); await f.teach(); await f.pair();
  f.state.reject = { protocolVersion: '1', code: 'planner_unavailable', status: 503 };
  const rejected = await f.service.matrix.requestSceneBuild(f.sessionId, f.body()); assert.equal(rejected.sceneBuild!.status, 'error'); assert.equal(f.state.outcomes.size, 0);
  const client = await MatrixClient.pair('http://127.0.0.1:18898', 'code', { fetch: f.fetcher });
  await assert.rejects(client.propose('Default offline request.', { requestId: 'offline-error', revision: 5 }), (error: unknown) => error instanceof MatrixClientError && error.outcomeUnknown === true);
  await assert.rejects(client.proposeScale({ kind: 'block-scale', version: 1, action: 'configure', objectId: 'block', factors: { x: 1, y: 1, z: 1 } }, { requestId: 'scale-error', revision: 5 }), (error: unknown) => error instanceof MatrixClientError && error.outcomeUnknown === true);
  for (const reject of [{ protocolVersion: '1', code: 'internal_error', status: 503 }, { protocolVersion: '1', code: 'planner_unavailable', status: 500 }, { code: 'planner_unavailable', status: 503 }, { protocolVersion: '2', code: 'planner_unavailable', status: 503 }]) {
    f.state.reject = reject;
    await assert.rejects(client.propose('Codex request.', { requestId: randomUUID(), revision: 5, mode: 'codex-cli' }), (error: unknown) => error instanceof MatrixClientError && error.outcomeUnknown === true);
  }
  await f.teach(); f.state.reject = { protocolVersion: '1', code: 'internal_error', status: 503 };
  assert.equal((await f.service.matrix.requestSceneBuild(f.sessionId, f.body())).sceneBuild!.status, 'unconfirmed');
});
