import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileSchoolRepository } from '../../src/server/repository.ts';
import { SchoolService } from '../../src/server/school-service.ts';
import { DemoMentorProvider } from '../../src/server/providers.ts';
import type { MentorProvider, MentorResult } from '../../src/server/providers.ts';
import type { SchoolSession, TurnResponse } from '../../src/shared/contracts.ts';

function folder(t: test.TestContext) { const directory = mkdtempSync(join(tmpdir(), 'school-test-')); t.after(() => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); }); return directory; }
function fixture(t: test.TestContext, provider: MentorProvider = new DemoMentorProvider(0)) { const directory = folder(t); const service = new SchoolService(new FileSchoolRepository(directory), provider); t.after(() => service.close()); return { service, directory }; }
function start(service: SchoolService) { return service.start({ requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' }).session; }
async function finished(service: SchoolService, result: TurnResponse) { for (let n = 0; n < 100; n++) { const turn = service.turn(result.turn.id); if (turn.turn.status !== 'running') return turn; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('Turn did not finish'); }
async function answer(service: SchoolService, session: SchoolSession, text: string) { return (await finished(service, service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'answer', text }))).session; }

test('complete authored lesson persists prediction, measured browser geometry and reflection across restart', async (t) => {
  const { service, directory } = fixture(t); let session = start(service);
  session = (await finished(service, service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'advance' }))).session;
  assert.equal(session.stage, 'example'); session = await answer(service, session, '8'); assert.equal(session.stage, 'guided_practice');
  assert.throws(() => service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'answer', text: 'It is bigger' }), /Apply the experiment/);
  session = service.experiment(session.id, { requestId: randomUUID(), expectedRevision: session.revision, dimensions: [2, 2, 2] }).session;
  assert.equal(session.artifact.volume, 8); assert.equal(session.artifact.source, 'browser-deterministic');
  session = await answer(service, session, 'The three sides doubled and volume is eight.'); assert.equal(session.stage, 'socratic_check');
  session = await answer(service, session, 'Two layers, two rows, and two blocks per row give eight.'); assert.equal(session.stage, 'recap');
  session = await answer(service, session, 'I will next double only width.'); assert.equal(session.stage, 'ended'); assert.match(session.completionLabel, /not assessed/);
  const exported = service.export(session.id); assert.equal(exported.turns.length, 5); assert.equal(exported.session.messages.filter((item) => item.role === 'learner').length, 5);
  service.close(); const restarted = new SchoolService(new FileSchoolRepository(directory), new DemoMentorProvider()); t.after(() => restarted.close());
  assert.deepEqual(restarted.session(session.id).session, session);
  assert.throws(() => restarted.experiment(session.id, { requestId: randomUUID(), expectedRevision: session.revision, dimensions: [1, 1, 1] }), /completed record/);
});

test('duplicate start and turn requests remain idempotent; questions never advance', async (t) => {
  let calls = 0; const demo = new DemoMentorProvider(0);
  const provider: MentorProvider = { status: () => demo.status(), respond: async (...args) => { calls++; return demo.respond(...args); } };
  const { service } = fixture(t, provider); const body = { requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' };
  const initial = service.start(body); assert.equal(service.start(body).session.id, initial.session.id);
  const request = { requestId: randomUUID(), expectedRevision: 1, kind: 'question', text: 'What is volume?' };
  const created = service.createTurn(initial.session.id, request); const duplicate = service.createTurn(initial.session.id, request);
  assert.equal(created.turn.id, duplicate.turn.id); const result = await finished(service, created); assert.equal(result.session.stage, 'explain');
  assert.equal(service.createTurn(initial.session.id, request).turn.status, 'completed'); assert.equal(calls, 1);
  assert.throws(() => service.createTurn(initial.session.id, { ...request, text: 'Different payload' }), /request ID/);
  assert.throws(() => service.createTurn(initial.session.id, { ...request, requestId: randomUUID() }), /changed/);
});

test('non-string turn kinds are rejected before persistence, inference or lesson advancement', async (t) => {
  let calls = 0; const demo = new DemoMentorProvider(0);
  const provider: MentorProvider = { status: () => demo.status(), respond: async (...args) => { calls++; return demo.respond(...args); } };
  const { service, directory } = fixture(t, provider); const session = start(service);
  const file = join(directory, 'school-store.json'); const original = readFileSync(file, 'utf8');
  for (const kind of [['question'], ['answer'], ['advance'], {}, null, 1]) {
    assert.throws(() => service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind, text: 'What is volume?' }),
      (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'invalid_request' && 'status' in error && error.status === 400);
    assert.deepEqual(service.session(session.id).session, session);
    assert.equal(readFileSync(file, 'utf8'), original);
  }
  assert.equal(calls, 0); assert.equal(service.export(session.id).turns.length, 0);
  const valid = await finished(service, service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'question', text: 'What is volume?' }));
  assert.equal(calls, 1); assert.equal(valid.session.stage, 'explain');
});

test('saved enum fields reject coercible arrays without replacing existing records', async (t) => {
  const { service, directory } = fixture(t); const session = start(service);
  const result = await finished(service, service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'question', text: 'What is volume?' }));
  service.close(); const file = join(directory, 'school-store.json'); const original = JSON.parse(readFileSync(file, 'utf8'));
  const edits = [
    (store: typeof original) => { store.sessions[session.id].stage = ['explain']; },
    (store: typeof original) => { store.sessions[session.id].messages[0].role = ['mentor']; },
    (store: typeof original) => { store.sessions[session.id].events[0].type = ['session_started']; },
    (store: typeof original) => { store.turns[result.turn.id].kind = ['question']; },
    (store: typeof original) => { store.turns[result.turn.id].status = ['completed']; },
    (store: typeof original) => { store.turns[result.turn.id].receipt.mode = ['demo']; },
    (store: typeof original) => { store.receipts[result.turn.requestId].kind = ['turn']; },
  ];
  for (const edit of edits) {
    const changed = structuredClone(original); edit(changed); const encoded = JSON.stringify(changed); writeFileSync(file, encoded);
    assert.throws(() => new FileSchoolRepository(directory), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'invalid_store');
    assert.equal(readFileSync(file, 'utf8'), encoded);
  }
});

test('cancel persists terminal outcome and ignores a late model result without advancing', async (t) => {
  let resolveResult!: (value: MentorResult) => void;
  const provider: MentorProvider = { status: () => new DemoMentorProvider().status(), respond: () => new Promise((resolve) => { resolveResult = resolve; }) };
  const { service, directory } = fixture(t, provider); const session = start(service);
  const turn = service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'advance' });
  const cancel = { requestId: randomUUID() }; assert.equal(service.cancel(turn.turn.id, cancel).turn.status, 'cancelled'); assert.equal(service.cancel(turn.turn.id, cancel).turn.status, 'cancelled');
  resolveResult({ text: 'This must not appear', receipt: { mode: 'demo', completedTurn: true, toolCallCount: 0 } }); await new Promise((resolve) => setTimeout(resolve, 5));
  const after = service.turn(turn.turn.id); assert.equal(after.session.stage, 'explain'); assert.equal(after.session.activeTurnId, undefined); assert.equal(after.session.messages.length, 2); assert.equal(after.turn.status, 'cancelled');
  service.close(); const reopened = new SchoolService(new FileSchoolRepository(directory), new DemoMentorProvider()); t.after(() => reopened.close()); assert.equal(reopened.turn(turn.turn.id).turn.status, 'cancelled');
});

test('provider failure preserves learner input and allows a fresh retry without advancing', async (t) => {
  const provider: MentorProvider = { status: () => new DemoMentorProvider().status(), respond: async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); } };
  const { service } = fixture(t, provider); const session = start(service);
  const result = await finished(service, service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'answer', text: 'My prediction' }));
  assert.equal(result.turn.status, 'failed'); assert.doesNotMatch(result.turn.error!, /PRIVATE/); assert.equal(result.session.stage, 'explain'); assert.equal(result.session.messages.at(-1)?.text, 'My prediction');
  service.provider = new DemoMentorProvider(0); const retry = await answer(service, result.session, 'Try again'); assert.equal(retry.stage, 'example');
});

test('restart reconciles a durable running turn to interrupted and does not rerun the provider', async (t) => {
  const { service, directory } = fixture(t); const session = start(service); service.close();
  const path = join(directory, 'school-store.json'); const data = JSON.parse(readFileSync(path, 'utf8')); const turnId = randomUUID();
  data.sessions[session.id].activeTurnId = turnId;
  data.turns[turnId] = { id: turnId, sessionId: session.id, requestId: randomUUID(), kind: 'question', input: 'Question', stage: 'explain', status: 'running', createdAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(data)); let calls = 0;
  const provider: MentorProvider = { status: () => new DemoMentorProvider().status(), respond: async () => { calls++; throw new Error('Must not run'); } };
  const resumed = new SchoolService(new FileSchoolRepository(directory), provider); t.after(() => resumed.close());
  assert.equal(resumed.turn(turnId).turn.status, 'interrupted'); assert.equal(resumed.session(session.id).session.activeTurnId, undefined); assert.equal(calls, 0);
});

test('experiment receipts, revisions, bounds and provider isolation are enforced', (t) => {
  const { service } = fixture(t); const session = start(service); const request = { requestId: randomUUID(), expectedRevision: 1, dimensions: [2, 1, 1] };
  const applied = service.experiment(session.id, request); assert.equal(applied.session.artifact.volumeRatio, 2); assert.deepEqual(service.experiment(session.id, request), applied);
  assert.throws(() => service.experiment(session.id, { ...request, requestId: randomUUID() }), /changed/);
  assert.throws(() => service.experiment(session.id, { ...request, requestId: randomUUID(), expectedRevision: 2, dimensions: [-1, 1, 1] }), /between/);
  assert.throws(() => service.experiment(session.id, { ...request, requestId: randomUUID(), expectedRevision: 2, dimensions: [100, 1, 1] }), /between/);
  assert.equal(service.export(session.id).turns.length, 0);
});

test('storage rejects competing writers and preserves corrupt records', (t) => {
  const directory = folder(t); const first = new FileSchoolRepository(directory); t.after(() => first.close());
  assert.throws(() => new FileSchoolRepository(directory), /owns these records/); first.close();
  const path = join(directory, 'school-store.json'); writeFileSync(path, '{broken');
  assert.throws(() => new FileSchoolRepository(directory), /existing data was preserved/); assert.equal(readFileSync(path, 'utf8'), '{broken');
});

test('concurrent learner actions are rejected distinctly from a stale revision', async (t) => {
  const { service } = fixture(t, new DemoMentorProvider(100)); const session = start(service);
  const turn = service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'question', text: 'What is volume?' });
  assert.throws(() => service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: turn.session.revision, kind: 'question', text: 'Another request' }), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'turn_pending');
  assert.throws(() => service.experiment(session.id, { requestId: randomUUID(), expectedRevision: turn.session.revision, dimensions: [2, 2, 2] }), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'turn_pending');
  assert.throws(() => service.experiment(session.id, { requestId: randomUUID(), expectedRevision: 1, dimensions: [2, 2, 2] }), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'stale_revision');
  service.cancel(turn.turn.id, { requestId: randomUUID() });
});

test('failed disk replacement leaves in-memory state and receipt unchanged for the same request retry', (t) => {
  const { service, directory } = fixture(t); const session = start(service);
  const file = join(directory, 'school-store.json'); const backup = join(directory, 'original-store.json'); const original = readFileSync(file, 'utf8');
  renameSync(file, backup); mkdirSync(file);
  const request = { requestId: randomUUID(), expectedRevision: session.revision, dimensions: [2, 1, 1] };
  assert.throws(() => service.experiment(session.id, request), /could not be saved/);
  assert.deepEqual(service.session(session.id).session, session); assert.equal(readFileSync(backup, 'utf8'), original); assert.equal(readdirSync(directory).filter((name) => name.endsWith('.tmp')).length, 0);
  rmdirSync(file); renameSync(backup, file);
  assert.equal(service.experiment(session.id, request).session.artifact.volume, 2);
});

test('tampered derived geometry and saved stage content fail closed without overwriting the record', (t) => {
  const { service, directory } = fixture(t); const session = start(service); service.close(); const file = join(directory, 'school-store.json');
  const original = JSON.parse(readFileSync(file, 'utf8')); original.sessions[session.id].artifact.volume = 999; const altered = JSON.stringify(original); writeFileSync(file, altered);
  assert.throws(() => new FileSchoolRepository(directory), /calculations are inconsistent/); assert.equal(readFileSync(file, 'utf8'), altered);
  original.sessions[session.id].artifact.volume = 1; original.sessions[session.id].stageContent.prompt = 'Injected wrong stage content'; writeFileSync(file, JSON.stringify(original));
  assert.throws(() => new FileSchoolRepository(directory), /presentation is inconsistent/);
});

test('disk failure after inference reports an actionable error and reconciles without a second model call', async (t) => {
  let calls = 0; let resolveResult!: (result: MentorResult) => void;
  const provider: MentorProvider = { status: () => new DemoMentorProvider().status(), respond: () => { calls++; return new Promise((resolve) => { resolveResult = resolve; }); } };
  const { service, directory } = fixture(t, provider); const session = start(service);
  const created = service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'advance' });
  const file = join(directory, 'school-store.json'); const backup = join(directory, 'original-store.json'); renameSync(file, backup); mkdirSync(file);
  resolveResult({ text: 'A response that cannot be saved.', receipt: { mode: 'demo', completedTurn: true, toolCallCount: 0 } }); await new Promise((resolve) => setTimeout(resolve, 5));
  assert.throws(() => service.turn(created.turn.id), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'persistence_failed');
  rmdirSync(file); renameSync(backup, file);
  const reconciled = service.turn(created.turn.id); assert.equal(reconciled.turn.status, 'failed'); assert.equal(reconciled.session.stage, 'explain'); assert.equal(reconciled.session.activeTurnId, undefined); assert.equal(calls, 1);
});

test('global provider capacity spans sessions, preserves rejected input and releases after cancellation or failure', async (t) => {
  const pending = new Map<string, { reject: (error: Error) => void }>(); let calls = 0;
  const provider: MentorProvider = {
    status: () => new DemoMentorProvider().status(),
    respond: (input, signal) => {
      calls++;
      return new Promise<MentorResult>((_resolve, reject) => {
        pending.set(input.turn.id, { reject });
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      });
    },
  };
  const { service } = fixture(t, provider);
  const sessions = Array.from({ length: 5 }, () => start(service));
  const requests = sessions.map(() => ({ requestId: randomUUID(), expectedRevision: 1, kind: 'question', text: 'What is volume?' }));
  const active = sessions.slice(0, 3).map((item, index) => service.createTurn(item.id, requests[index]));
  assert.equal(calls, 3);
  const assertBusy = (index: number) => assert.throws(() => service.createTurn(sessions[index].id, requests[index]), (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === 503 && 'code' in error && error.code === 'provider_busy');
  assertBusy(3);
  assert.deepEqual(service.session(sessions[3].id).session, sessions[3], 'Busy rejection must not record or claim to have saved the learner input.');
  assert.equal(service.createTurn(sessions[0].id, requests[0]).turn.id, active[0].turn.id, 'Already accepted requests remain reconcilable while capacity is full.');
  assert.equal(calls, 3);

  service.cancel(active[0].turn.id, { requestId: randomUUID() });
  await new Promise((resolve) => setImmediate(resolve));
  const acceptedAfterCancel = service.createTurn(sessions[3].id, requests[3]);
  assert.equal(acceptedAfterCancel.turn.status, 'running'); assert.equal(calls, 4);
  assertBusy(4);

  pending.get(active[1].turn.id)!.reject(new Error('Provider failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.turn(active[1].turn.id).turn.status, 'failed');
  const acceptedAfterFailure = service.createTurn(sessions[4].id, requests[4]);
  assert.equal(acceptedAfterFailure.turn.status, 'running'); assert.equal(calls, 5);
  service.close();
});
