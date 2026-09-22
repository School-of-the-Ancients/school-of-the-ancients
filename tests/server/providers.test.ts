import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { CodexMentorProvider, DemoMentorProvider, parseCodexResult } from '../../src/server/providers.ts';
import type { MentorInput, ProcessRunner } from '../../src/server/providers.ts';
import { GALILEO, OBSERVATION_LESSON } from '../../src/server/content.ts';
import { SchoolService } from '../../src/server/school-service.ts';
import { FileSchoolRepository, fingerprint } from '../../src/server/repository.ts';
import { exhibitIdentity, GALILEO_OBSERVATION_EXHIBIT } from '../../src/exhibits/prepared-exhibits.ts';
import type { MatrixDemonstration } from '../../src/shared/contracts.ts';

function transcript(final: string) { return [{ type: 'thread.started' }, { type: 'turn.started' }, { type: 'item.completed', item: { type: 'agent_message', text: final } }, { type: 'turn.completed' }].map((event) => JSON.stringify(event)).join('\n'); }
test('Codex receipt accepts one complete text-only turn and rejects tools, mismatch and incomplete output', () => {
  const final = JSON.stringify({ text: 'Two by two by two gives eight.' }); assert.equal(parseCodexResult(transcript(final), final).receipt.toolCallCount, 0);
  assert.throws(() => parseCodexResult(transcript(final).replace('agent_message', 'command_execution'), final), /tool call/);
  assert.throws(() => parseCodexResult(transcript(final), '{"text":"Different"}'), /invalid teaching/);
  assert.throws(() => parseCodexResult(transcript(final).split('\n').slice(0, -1).join('\n'), final), /invalid teaching/);
  assert.throws(() => parseCodexResult(transcript(final) + '\n' + JSON.stringify({ type: 'turn.completed' }), final), /invalid turn/);
});

test('configured Codex uses ChatGPT authentication, tool-free ephemeral boundary and cleans private temp prompt output', async () => {
  let calls = 0; let workingDirectory = '';
  const final = JSON.stringify({ text: 'The recorded browser experiment has volume eight.' });
  const runner: ProcessRunner = async (_executable, args, options) => {
    calls++; workingDirectory = options.cwd;
    assert.equal(options.env.CODEX_API_KEY, undefined); assert.equal(options.env.OPENAI_API_KEY, undefined);
    if (args[0] === 'login') return { stdout: 'Logged in using ChatGPT\n', stderr: '' };
    for (const flag of ['--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', '--output-schema', '--output-last-message', '--disable']) assert.ok(args.includes(flag));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only'); assert.ok(args.includes('web_search="disabled"')); assert.match(options.input!, /mathematical illustration/);
    assert.equal(options.input!.includes('historicalMatrixEvidence'), false, 'ordinary lessons add no Matrix context');
    writeFileSync(args[args.indexOf('--output-last-message') + 1], final); return { stdout: transcript(final), stderr: '' };
  };
  const provider = new CodexMentorProvider({ executable: process.execPath, model: 'test-model', runner });
  assert.equal(provider.status().checked, false); assert.equal(calls, 0);
  const input = { session: { mentor: GALILEO, lesson: OBSERVATION_LESSON, messages: [], artifact: { volume: 8 } }, turn: { kind: 'question', input: 'What happened?' }, target: OBSERVATION_LESSON.stages[0] } as unknown as MentorInput;
  const result = await provider.respond(input, new AbortController().signal);
  assert.equal(calls, 2); assert.equal(result.receipt.requestedModel, 'test-model'); assert.equal(result.receipt.actualModel, undefined); assert.ok(provider.status().lastSucceededAt); assert.equal(existsSync(workingDirectory), false);
});

test('demo is explicitly scripted and cancellation aborts a pending response', async () => {
  const demo = new DemoMentorProvider(100); assert.match(demo.status().label, /scripted/); const controller = new AbortController();
  const promise = demo.respond({} as MentorInput, controller.signal); controller.abort(); await assert.rejects(promise, (error: Error) => error.name === 'AbortError');
});

test('bounded historical Matrix evidence survives transcript truncation and record reload without private scene data', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'school-provider-evidence-'));
  let repository = new FileSchoolRepository(directory);
  t.after(() => { repository.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
  const service = new SchoolService(repository, new DemoMentorProvider(0));
  const started = service.start({ requestId: 'start-evidence', mentorId: 'galileo', lessonId: 'observation-and-scale' }).session;
  const at = '2026-09-22T08:00:00.000Z';
  const position = { x: 1, y: 0, z: 2 };
  const successful: MatrixDemonstration = {
    id: 'private-demo', bindingId: 'private-binding', matrixSessionId: 'private-pair', runtimeSessionId: 'private-runtime', correlationId: 'private-demo',
    exhibit: { id: GALILEO_OBSERVATION_EXHIBIT.id, version: GALILEO_OBSERVATION_EXHIBIT.version, digest: fingerprint(GALILEO_OBSERVATION_EXHIBIT), identity: exhibitIdentity(GALILEO_OBSERVATION_EXHIBIT) },
    placement: { anchorId: 'private-anchor', position, mode: 'direct', spawnScale: 1 },
    requestText: 'Place a block here.', expectedMatrixRevision: 4, status: 'succeeded', createdAt: at, updatedAt: at,
    sequence: 2, requiresApply: false, proposalSummary: 'private-proposal', commandIds: ['private-command'],
    receipts: [{ requestId: 'private-command', ok: true, error: '', objectId: 'private-object' }],
    observed: { revision: 5, source: 'matrix-runtime', objects: [{ objectId: 'private-object', assetId: 'block', anchorId: 'private-anchor', position, scale: { x: 1, y: 1, z: 1 } }] },
    error: null, checkError: 'private-check-detail',
  };
  repository.mutate(store => {
    const session = store.sessions[started.id];
    session.matrix = { bindings: [{ id: 'private-binding', origin: 'http://localhost:18789', status: 'disconnected', matrixSessionId: 'private-pair', runtimeSessionId: 'private-runtime', createdAt: at, updatedAt: at }], demonstrations: [successful] };
    for (let index = 0; index < 6; index++) {
      const id = `private-later-${index}`; const status = index % 2 ? 'unconfirmed' : 'failed';
      session.matrix.demonstrations.push({ ...structuredClone(successful), id, correlationId: id, status,
        updatedAt: `2026-09-22T08:0${index + 1}:00.000Z`, observed: null,
        commandIds: status === 'failed' ? ['private-command'] : [],
        receipts: status === 'failed' ? [{ requestId: 'private-command', ok: false, error: 'private-runtime-error', objectId: '' }] : [],
        error: 'private-error',
      });
    }
    session.messages.push({ id: 'old-matrix-note', role: 'system', stage: session.stage, createdAt: at, text: 'Old Matrix success note outside the recent window.' });
    for (let index = 0; index < 20; index++) session.messages.push({ id: `message-${index}`, role: index % 2 ? 'mentor' : 'learner', stage: session.stage, createdAt: at, text: 'Discuss the geometry.' });
  });
  service.close();
  repository = new FileSchoolRepository(directory);
  const resumed = repository.snapshot().sessions[started.id];
  const final = JSON.stringify({ text: 'The saved record confirms an earlier placement; the latest request remains unconfirmed.' });
  const contexts: Array<Record<string, any>> = [];
  const runner: ProcessRunner = async (_executable, args, options) => {
    if (args[0] === 'login') return { stdout: 'Logged in using ChatGPT\n', stderr: '' };
    const context = JSON.parse(options.input!.slice(options.input!.indexOf('\n') + 1)); contexts.push(context);
    for (const privateValue of ['private-', 'localhost', '18789', 'position', 'spawnScale']) assert.equal(JSON.stringify(context.historicalMatrixEvidence).includes(privateValue), false, privateValue);
    writeFileSync(args[args.indexOf('--output-last-message') + 1], final); return { stdout: transcript(final), stderr: '' };
  };
  const provider = new CodexMentorProvider({ executable: process.execPath, model: 'test-model', runner });
  const input: MentorInput = { session: resumed, turn: { id: 'question', sessionId: resumed.id, requestId: 'question-request', kind: 'question', status: 'running', input: 'What happened to the block?', stage: resumed.stage, createdAt: at }, target: resumed.stageContent };
  await provider.respond(input, new AbortController().signal);
  const context = contexts[0]; const evidence = context.historicalMatrixEvidence;
  assert.equal(context.recentMessages.length, 18); assert.equal(JSON.stringify(context.recentMessages).includes('Old Matrix success'), false);
  assert.equal(evidence.latestRequests.length, 4); assert.deepEqual(evidence.latestRequests.map((item: { status: string }) => item.status), ['failed', 'unconfirmed', 'failed', 'unconfirmed']);
  assert.ok(evidence.latestRequests.every((item: { placementEvidence: string }) => item.placementEvidence === 'not-confirmed'));
  assert.deepEqual(evidence.lastConfirmedPlacement, { requestedAt: at, recordUpdatedAt: at, status: 'succeeded', placementEvidence: 'acknowledged-block-placement', latestCheckUnconfirmed: true });
  assert.match(evidence.scope, /Historical/); assert.match(evidence.scope, /Current connection and object presence have not been checked/);
  assert.match(evidence.scope, /No camera evidence, physical measurement/);
  assert.ok(JSON.stringify(evidence).length < 2000);
  // A pending proposal is a distinct request state and cannot inherit the prior success.
  input.session.matrix!.demonstrations.at(-1)!.status = 'ready';
  await provider.respond(input, new AbortController().signal);
  assert.equal(contexts[1].historicalMatrixEvidence.latestRequests.at(-1).status, 'ready');
  assert.equal(contexts[1].historicalMatrixEvidence.latestRequests.at(-1).placementEvidence, 'not-confirmed');
  assert.equal(contexts[1].historicalMatrixEvidence.lastConfirmedPlacement.status, 'succeeded');
});
