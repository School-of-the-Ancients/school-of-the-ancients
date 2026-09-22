import test from 'node:test';
import assert from 'node:assert/strict';
import { createMentorSpeech } from '../public/mentor-speech.js';

const local = { name: 'Local English', lang: 'en-US', voiceURI: 'local-en', localService: true, default: true };
const saved = { sessionId: 'session-1', messageId: 'message-1', text: 'Doubling every side gives eight times the volume.' };

function fixture(voices = [local]) {
  const events = new Map();
  const timers = new Map();
  const notifications = [];
  let timerId = 0;
  const synthesis = {
    voices, calls: [], cancels: 0,
    getVoices() { return this.voices; },
    speak(value) { this.calls.push(value); },
    cancel() { this.cancels += 1; this.onCancel?.(); },
    addEventListener(name, listener) { events.set(name, listener); },
    removeEventListener(name, listener) { if (events.get(name) === listener) events.delete(name); },
  };
  class Utterance { constructor(text) { this.text = text; } }
  const adapter = createMentorSpeech({ synthesis, Utterance, onChange: value => notifications.push(value),
    setTimer: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimer: id => timers.delete(id) });
  return { adapter, synthesis, notifications, events, timers,
    changeVoices(voices) { synthesis.voices = voices; events.get('voiceschanged')?.(); },
    timeout() { for (const callback of [...timers.values()]) callback(); } };
}

test('voice initialization and saved context never start or announce playback', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  assert.equal(f.synthesis.calls.length, 0);
  assert.equal(f.notifications.length, 0);
  assert.deepEqual(f.adapter.state(), { available: true, canPlay: true, status: 'idle', voiceName: local.name, reason: '' });
});

test('manual playback speaks the exact saved caption with fixed natural settings', () => {
  const f = fixture();
  const context = { ...saved, text: '  Width × height × depth.\nThe ratio is 8.  ' };
  f.adapter.setContext(context);
  context.text = 'Caller mutation must not replace the saved caption.';
  assert.equal(f.adapter.play(), true);
  const spoken = f.synthesis.calls[0];
  assert.equal(spoken.text, '  Width × height × depth.\nThe ratio is 8.  ');
  assert.equal(spoken.voice, local);
  assert.equal(spoken.lang, 'en-US');
  assert.deepEqual([spoken.rate, spoken.pitch, spoken.volume], [1, 1, 1]);
  assert.equal(f.synthesis.cancels, 1);
  assert.equal(f.adapter.state().status, 'starting');
  assert.equal(f.adapter.state().canPlay, false);
  spoken.onstart();
  assert.equal(f.adapter.state().status, 'speaking');
  assert.equal(f.timers.size, 0);
  spoken.onend();
  assert.equal(f.adapter.state().status, 'idle');
  assert.equal(f.adapter.state().canPlay, true);
});

test('remote, non-English and unknown-locality voices never receive text', () => {
  const f = fixture([{ ...local, localService: false }, { ...local, localService: undefined },
    { ...local, localService: 1 }, { ...local, lang: 'fr-FR' }, { ...local, lang: 'english' }]);
  f.adapter.setContext(saved);
  assert.equal(f.adapter.state().available, false);
  assert.equal(f.adapter.state().status, 'unavailable');
  assert.match(f.adapter.state().reason, /No local English voice/);
  assert.equal(f.adapter.play(), false);
  assert.equal(f.synthesis.calls.length, 0);
});

test('asynchronous voiceschanged enables playback without playing automatically', () => {
  const f = fixture([]);
  f.adapter.setContext(saved);
  f.changeVoices([local]);
  assert.equal(f.adapter.state().canPlay, true);
  assert.equal(f.synthesis.calls.length, 0);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].voiceName, local.name);
});

test('empty, malformed and overlong context is unavailable without truncation', () => {
  const f = fixture();
  for (const context of [null, {}, { ...saved, sessionId: '' }, { ...saved, messageId: null },
    { ...saved, text: '' }, { ...saved, text: ' \n ' }, { ...saved, text: 'x'.repeat(8001) }]) {
    f.adapter.setContext(context);
    assert.equal(f.adapter.state().canPlay, false);
    assert.equal(f.adapter.play(), false);
  }
  f.adapter.setContext({ ...saved, text: 'x'.repeat(8000) });
  assert.equal(f.adapter.play(), true);
  assert.equal(f.synthesis.calls[0].text.length, 8000);
});

test('unsupported browsers keep the saved text path and do not throw', () => {
  const adapter = createMentorSpeech({ synthesis: undefined, Utterance: undefined });
  adapter.setContext(saved);
  assert.equal(adapter.play(), false);
  assert.equal(adapter.state().status, 'unavailable');
  assert.match(adapter.state().reason, /does not support speech playback/);
  adapter.stop();
  adapter.destroy();
});

test('new session, message or changed text stops playback without render recursion', () => {
  for (const next of [{ ...saved, sessionId: 'session-2' }, { ...saved, messageId: 'message-2' },
    { ...saved, text: 'Another saved response.' }, null]) {
    const f = fixture();
    f.adapter.setContext(saved);
    f.adapter.play();
    const old = f.synthesis.calls[0];
    old.onstart();
    const count = f.notifications.length;
    f.synthesis.onCancel = () => { old.onend(); old.onerror({ error: 'interrupted' }); };
    f.adapter.setContext(next);
    assert.equal(f.synthesis.cancels, 2);
    assert.equal(f.notifications.length, count);
    assert.equal(f.adapter.state().status, 'idle');
    old.onstart();
    old.onend();
    old.onerror();
    assert.equal(f.notifications.length, count);
    assert.equal(f.adapter.state().status, 'idle');
  }
});

test('re-rendering the same context preserves current playback', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.adapter.play();
  f.synthesis.calls[0].onstart();
  const before = f.notifications.length;
  f.adapter.setContext({ ...saved });
  assert.equal(f.synthesis.cancels, 1);
  assert.equal(f.notifications.length, before);
  assert.equal(f.adapter.state().status, 'speaking');
});

test('manual stop and later replay ignore all callbacks from the cancelled utterance', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.adapter.play();
  const first = f.synthesis.calls[0];
  f.adapter.stop();
  f.adapter.play();
  const next = f.synthesis.calls[1];
  const before = f.notifications.length;
  first.onstart(); first.onend(); first.onerror();
  assert.equal(f.notifications.length, before);
  assert.equal(f.adapter.state().status, 'starting');
  next.onstart();
  assert.equal(f.adapter.state().status, 'speaking');
});

test('loss or changed locality of active voice cancels it without remote fallback', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.adapter.play();
  const old = f.synthesis.calls[0];
  old.onstart();
  f.changeVoices([{ ...local, localService: false }]);
  assert.equal(f.synthesis.cancels, 2);
  assert.equal(f.adapter.state().status, 'unavailable');
  old.onerror();
  assert.equal(f.adapter.state().status, 'unavailable');
  f.changeVoices([{ ...local, name: 'Other local English', voiceURI: 'other' }]);
  assert.equal(f.adapter.state().canPlay, true);
  assert.equal(f.synthesis.calls.length, 1);
});

test('voice enumeration and speaking exceptions expose fixed errors without breaking text', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.synthesis.getVoices = () => { throw new Error('private engine diagnostics'); };
  assert.equal(f.adapter.play(), false);
  assert.equal(f.adapter.state().status, 'unavailable');
  f.synthesis.getVoices = () => [local];
  f.synthesis.speak = () => { throw new Error('private engine diagnostics'); };
  assert.equal(f.adapter.play(), false);
  assert.equal(f.adapter.state().status, 'error');
  assert.equal(f.adapter.state().canPlay, true);
  assert.doesNotMatch(f.adapter.state().reason, /private engine/);
});

test('failed cancel prevents new speech and does not claim that playback stopped', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.synthesis.cancel = () => { throw new Error('cancel failed'); };
  assert.equal(f.adapter.play(), false);
  assert.equal(f.synthesis.calls.length, 0);
  assert.equal(f.adapter.state().status, 'error');
  assert.match(f.adapter.state().reason, /could not stop playback/);
});

test('start timeout cancels uncertain audio and late callbacks cannot revive it', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.adapter.play();
  const spoken = f.synthesis.calls[0];
  f.timeout();
  assert.equal(f.adapter.state().status, 'error');
  assert.match(f.adapter.state().reason, /did not start/);
  assert.equal(f.synthesis.cancels, 2);
  assert.equal(f.timers.size, 0);
  const before = f.notifications.length;
  spoken.onstart(); spoken.onend();
  assert.equal(f.notifications.length, before);
  assert.equal(f.synthesis.calls.length, 1);
});

test('runtime playback error stops the playback state without lesson side effects or retry', () => {
  const f = fixture();
  const context = Object.freeze({ ...saved });
  f.adapter.setContext(context);
  f.adapter.play();
  const spoken = f.synthesis.calls[0];
  spoken.onstart();
  spoken.onerror({ error: 'synthesis-failed' });
  assert.equal(f.adapter.state().status, 'error');
  assert.equal(f.timers.size, 0);
  spoken.onend();
  assert.equal(f.adapter.state().status, 'error');
  assert.equal(f.synthesis.calls.length, 1);
  assert.deepEqual(context, saved);
});

test('failed cancellation after a start timeout preserves its more specific uncertainty', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.adapter.play();
  f.synthesis.cancel = () => { throw new Error('engine cannot cancel'); };
  f.timeout();
  assert.equal(f.adapter.state().status, 'error');
  assert.match(f.adapter.state().reason, /could not stop playback/);
  assert.match(f.adapter.state().reason, /if speech continues/);
  assert.equal(f.synthesis.calls.length, 1);
});

test('destroy cancels owned audio and detaches voice listeners and timers', () => {
  const f = fixture();
  f.adapter.setContext(saved);
  f.adapter.play();
  const spoken = f.synthesis.calls[0];
  f.adapter.destroy();
  assert.equal(f.events.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.adapter.state().status, 'unavailable');
  const before = f.notifications.length;
  spoken.onstart(); spoken.onend(); spoken.onerror();
  f.adapter.stop(); f.adapter.setContext(saved); f.adapter.destroy();
  assert.equal(f.adapter.play(), false);
  assert.equal(f.notifications.length, before);
  assert.equal(f.synthesis.calls.length, 1);
});
