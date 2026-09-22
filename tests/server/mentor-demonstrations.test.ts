import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { validMentorDemonstration } from '../../src/shared/mentor-demonstration.ts';
import { CodexMentorProvider, DemoMentorProvider, parseCodexResult } from '../../src/server/providers.ts';
import type { MentorInput, MentorProvider, MentorResult, ProcessRunner } from '../../src/server/providers.ts';
import { SchoolService } from '../../src/server/school-service.ts';
import { FileSchoolRepository } from '../../src/server/repository.ts';
import { GALILEO, OBSERVATION_LESSON } from '../../src/server/content.ts';
import type { MentorDemonstrationIntent, TurnResponse } from '../../src/shared/contracts.ts';

const suggestion: MentorDemonstrationIntent = { kind: 'matrix-scene', title: 'Compare two blocks',
  learningGoal: 'Predict the effect of doubling only width.', prompt: 'Place a small cube and a separate double-width block at the selected support surface. Preserve existing objects.' };
const receipt = { mode: 'demo' as const, completedTurn: true, toolCallCount: 0 };
function transcript(final: string) { return [{ type: 'thread.started' }, { type: 'turn.started' }, { type: 'item.completed', item: { type: 'agent_message', text: final } }, { type: 'turn.completed' }].map(item => JSON.stringify(item)).join('\n'); }
function fixture(t: test.TestContext, provider: MentorProvider) {
  const directory = mkdtempSync(join(tmpdir(), 'mentor-scene-test-')); let requests = 0;
  const service = new SchoolService(new FileSchoolRepository(directory), provider, { matrix: { fetch: async () => { requests++; throw new Error('No automatic Matrix call is allowed.'); } } });
  t.after(() => { service.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
  const session = service.start({ requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' }).session;
  return { service, session, directory, requests: () => requests };
}
async function finish(service: SchoolService, result: TurnResponse) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = service.turn(result.turn.id); if (value.turn.status !== 'running') return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Mentor turn did not complete');
}

test('structured mentor output carries an inert suggestion and accepts ordinary legacy text or null', () => {
  for (const data of [{ text: 'Predict the result.' }, { text: 'Predict the result.', demonstration: null }, { text: 'Predict the result.', demonstration: suggestion }]) {
    const encoded = JSON.stringify(data); const parsed = parseCodexResult(transcript(encoded), encoded);
    assert.deepEqual(parsed.demonstration, data.demonstration ?? undefined);
    assert.equal(parsed.receipt.toolCallCount, 0);
  }
});

test('malformed intent or executable/extra fields reject the whole provider result', () => {
  const invalid = [[], 'build', {}, { ...suggestion, kind: ['matrix-scene'] }, { ...suggestion, title: ' ' },
    { ...suggestion, prompt: 'x'.repeat(2001) }, { ...suggestion, prompt: 'line\ncommand' }, { ...suggestion, commands: [{ op: 'clear_scene' }] },
    { ...suggestion, learningGoal: 'bad\u0000text' }, { ...suggestion, kind: 'execute' }];
  for (const intent of invalid) {
    assert.equal(validMentorDemonstration(intent), false);
    const encoded = JSON.stringify({ text: 'A suggestion.', demonstration: intent });
    assert.throws(() => parseCodexResult(transcript(encoded), encoded), /invalid teaching/);
  }
  const extra = JSON.stringify({ text: 'A suggestion.', demonstration: suggestion, apply: true });
  assert.throws(() => parseCodexResult(transcript(extra), extra), /invalid teaching/);
});

test('Codex schema and prompt keep planning separate from tools, measurements and Apply', async () => {
  const output = JSON.stringify({ text: 'Here is a demonstration to send for review.', demonstration: suggestion });
  const runner: ProcessRunner = async (_executable, args, options) => {
    if (args[0] === 'login') return { stdout: 'Logged in using ChatGPT', stderr: '' };
    const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
    assert.deepEqual(schema.required, ['text', 'demonstration']);
    assert.equal(schema.properties.demonstration.anyOf[1].additionalProperties, false);
    assert.match(options.input!, /No automatic request/); assert.match(options.input!, /Matrix alone knows/);
    assert.match(options.input!, /Operator reviews and Applies/); assert.match(options.input!, /not that the teaching goal was met/);
    assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config'));
    writeFileSync(args[args.indexOf('--output-last-message') + 1], output);
    return { stdout: transcript(output), stderr: '' };
  };
  const provider = new CodexMentorProvider({ executable: process.execPath, model: 'test-model', runner });
  const input = { session: { mentor: GALILEO, lesson: OBSERVATION_LESSON, messages: [], artifact: { volume: 1 } }, turn: { kind: 'question', input: 'Show me in AR' }, target: OBSERVATION_LESSON.stages[0] } as unknown as MentorInput;
  assert.deepEqual((await provider.respond(input, new AbortController().signal)).demonstration, suggestion);
});

test('a completed suggestion is saved with its authoritative turn and message, never dispatched, and survives restart', async t => {
  const result: MentorResult = { text: 'Predict, then send this idea to Matrix for review.', demonstration: structuredClone(suggestion), receipt };
  const provider: MentorProvider = { status: () => new DemoMentorProvider().status(), respond: async () => result };
  const f = fixture(t, provider);
  const request = { requestId: randomUUID(), expectedRevision: f.session.revision, kind: 'question', text: 'Show width and volume in my room.' };
  const completed = await finish(f.service, f.service.createTurn(f.session.id, request));
  assert.equal(completed.turn.status, 'completed'); assert.deepEqual(completed.turn.demonstration, suggestion);
  assert.deepEqual(completed.session.messages.at(-1)?.demonstration, suggestion);
  assert.equal(completed.session.messages.at(-1)?.turnId, completed.turn.id);
  assert.equal(completed.session.stage, f.session.stage); assert.deepEqual(completed.session.artifact, f.session.artifact);
  assert.equal(f.requests(), 0);
  result.demonstration!.title = 'Mutated provider object';
  assert.equal(f.service.turn(completed.turn.id).turn.demonstration?.title, suggestion.title);
  assert.equal(f.service.createTurn(f.session.id, request).turn.id, completed.turn.id);
  f.service.close(); const reopened = new SchoolService(new FileSchoolRepository(f.directory), new DemoMentorProvider(0));
  try { assert.deepEqual(reopened.turn(completed.turn.id), completed); } finally { reopened.close(); }
});

test('invalid or cancelled mentor intents never reach saved suggestions or Matrix', async t => {
  const f = fixture(t, { status: () => new DemoMentorProvider().status(), respond: async () => ({ text: 'Invalid', receipt, demonstration: { ...suggestion, prompt: '' } }) });
  const invalid = await finish(f.service, f.service.createTurn(f.session.id, { requestId: randomUUID(), expectedRevision: f.session.revision, kind: 'question', text: 'Show me.' }));
  assert.equal(invalid.turn.status, 'failed'); assert.equal(invalid.turn.demonstration, undefined);
  assert.equal(invalid.session.stage, f.session.stage);
  let deliver!: (value: MentorResult) => void;
  f.service.provider = { status: () => new DemoMentorProvider().status(), respond: () => new Promise(resolve => { deliver = resolve; }) };
  const pending = f.service.createTurn(f.session.id, { requestId: randomUUID(), expectedRevision: invalid.session.revision, kind: 'question', text: 'Another demonstration.' });
  f.service.cancel(pending.turn.id, { requestId: randomUUID() });
  deliver({ text: 'Too late', demonstration: suggestion, receipt }); await new Promise(resolve => setTimeout(resolve, 5));
  const cancelled = f.service.turn(pending.turn.id);
  assert.equal(cancelled.turn.status, 'cancelled'); assert.equal(cancelled.turn.demonstration, undefined);
  assert.equal(cancelled.session.messages.some(message => message.demonstration), false); assert.equal(f.requests(), 0);
});

test('authored demo offers a labeled scene suggestion only for an explicit demonstration question', async t => {
  const f = fixture(t, new DemoMentorProvider(0));
  const completed = await finish(f.service, f.service.createTurn(f.session.id, { requestId: randomUUID(), expectedRevision: f.session.revision, kind: 'question', text: 'Can you demonstrate volume in my AR room?' }));
  assert.equal(completed.turn.receipt?.mode, 'demo'); assert.match(completed.turn.output!, /authored demonstration/);
  assert.match(completed.turn.output!, /not built or observed/); assert.ok(validMentorDemonstration(completed.turn.demonstration));
  assert.equal(f.requests(), 0);
  const ordinary = await finish(f.service, f.service.createTurn(f.session.id, { requestId: randomUUID(), expectedRevision: completed.session.revision, kind: 'question', text: 'Explain volume.' }));
  assert.equal(ordinary.turn.demonstration, undefined);
});

test('mentor receives bounded scene execution history without room data, identifiers or claims of lesson success', async () => {
  const at = '2026-09-22T12:00:00.000Z';
  const rawBuild = { status: 'succeeded', createdAt: at, updatedAt: at, intent: { ...suggestion, prompt: 'PRIVATE-SCENE-PROMPT' },
    proposalSummary: 'PRIVATE-PROPOSAL', turnId: 'PRIVATE-TURN', bindingId: 'PRIVATE-BINDING',
    observed: { source: 'matrix-runtime', revision: 3, confirmedCommandCount: 2, failedCommandCount: 0, objectIds: ['PRIVATE-OBJECT'] } };
  const builds = [rawBuild, ...Array.from({ length: 5 }, () => ({ ...rawBuild, status: 'unconfirmed', observed: null, checkError: 'PRIVATE-FAILURE' }))];
  const output = JSON.stringify({ text: 'Commands were acknowledged earlier, but that does not verify the teaching goal or current scene.', demonstration: null });
  const runner: ProcessRunner = async (_executable, args, options) => {
    if (args[0] === 'login') return { stdout: 'Logged in using ChatGPT', stderr: '' };
    const data = JSON.parse(options.input!.slice(options.input!.indexOf('\n') + 1));
    const history = data.historicalMatrixEvidence;
    assert.equal(history.latestSceneRequests.length, 4);
    assert.ok(history.latestSceneRequests.every((item: { status: string; executionEvidence: string }) => item.status === 'unconfirmed' && item.executionEvidence === 'not-confirmed'));
    assert.equal(history.lastConfirmedScene.confirmedCommandCount, 2);
    assert.equal(history.lastConfirmedScene.teachingGoalVerified, false);
    assert.doesNotMatch(JSON.stringify(history), /PRIVATE|objectIds|proposalSummary|bindingId|position/);
    assert.match(history.scope, /Current connection and object presence have not been checked/);
    writeFileSync(args[args.indexOf('--output-last-message') + 1], output);
    return { stdout: transcript(output), stderr: '' };
  };
  const input = { session: { mentor: GALILEO, lesson: OBSERVATION_LESSON, messages: [], artifact: { volume: 1 }, matrix: { bindings: [], demonstrations: [], sceneBuilds: builds } },
    turn: { kind: 'question', input: 'What happened?' }, target: OBSERVATION_LESSON.stages[0] } as unknown as MentorInput;
  const provider = new CodexMentorProvider({ executable: process.execPath, model: 'test-model', runner });
  await provider.respond(input, new AbortController().signal);
});
