import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechInput } from '../public/speech-input.js';

function fixture() {
  const instances = [];
  class Recognition {
    constructor() { this.aborts = 0; instances.push(this); }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborts++; }
  }
  return { Recognition, instances };
}
function result(text, isFinal = true) {
  const item = [{ transcript: text }];
  item.isFinal = isFinal;
  return { results: [item] };
}

test('dictation only delivers a final draft and ignores duplicate or stale results', () => {
  const { Recognition, instances } = fixture();
  const transcripts = [];
  const input = createSpeechInput({ Recognition, onTranscript: (text, context) => transcripts.push([text, context]) });
  input.setContext('lesson-a');
  assert.equal(input.start(), true);
  const active = instances[0];
  assert.equal(active.lang, 'en-US');
  assert.equal(active.interimResults, false);
  assert.equal(input.state().status, 'listening');
  active.onresult(result('uncertain', false));
  assert.deepEqual(transcripts, []);
  const late = active.onresult;
  active.onresult(result('  explain the scale  '));
  assert.deepEqual(transcripts, [['explain the scale', 'lesson-a']]);
  assert.equal(active.aborts, 1);
  late(result('duplicate'));
  assert.equal(transcripts.length, 1);
  input.start();
  const other = instances[1];
  const oldCallback = other.onresult;
  input.setContext('lesson-b');
  assert.equal(other.aborts, 1);
  oldCallback(result('wrong lesson'));
  assert.equal(transcripts.length, 1);
  input.destroy();
});

test('unsupported, denied, and failed recognition leave text mode usable', () => {
  const absent = createSpeechInput({ Recognition: null });
  absent.setContext('lesson-a');
  assert.equal(absent.state().available, false);
  assert.equal(absent.start(), false);
  const { Recognition, instances } = fixture();
  const input = createSpeechInput({ Recognition });
  input.setContext('lesson-a');
  input.start();
  instances[0].onerror({ error: 'not-allowed' });
  assert.match(input.state().reason, /permission was denied/);
  assert.equal(input.state().canStart, true);
  input.destroy();
  class Broken { start() { throw new Error('microphone unavailable'); } abort() {} }
  const failed = createSpeechInput({ Recognition: Broken });
  failed.setContext('lesson-a');
  assert.equal(failed.start(), false);
  assert.match(failed.state().reason, /could not start/);
});
