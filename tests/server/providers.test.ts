import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { CodexMentorProvider, DemoMentorProvider, parseCodexResult } from '../../src/server/providers.ts';
import type { MentorInput, ProcessRunner } from '../../src/server/providers.ts';
import { GALILEO, OBSERVATION_LESSON } from '../../src/server/content.ts';

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
