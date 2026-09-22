import test from 'node:test';
import assert from 'node:assert/strict';
import { GALILEO, OBSERVATION_LESSON, stageContent } from '../../src/server/content.ts';

const provider = { mode: 'demo', available: true, configured: true, checked: true, lastOutcome: 'not-run', label: 'Demo', reason: 'Scripted fixture' };
const catalog = { apiVersion: 1, mentors: [GALILEO], lessons: [OBSERVATION_LESSON], provider };
const now = '2026-09-22T08:00:00.000Z';
function session(overrides = {}) {
  return { id: 'session-1', revision: 1, mentorId: 'galileo', lessonId: OBSERVATION_LESSON.id, lessonVersion: '1.0.0', mentor: structuredClone(GALILEO), lesson: structuredClone(OBSERVATION_LESSON), stage: 'explain', stageContent: stageContent(OBSERVATION_LESSON, 'explain'), status: 'active', messages: [{ id: 'm1', role: 'mentor', text: 'Look closely. <script>not executable</script>', stage: 'explain', createdAt: now, providerMode: 'demo' }], events: [], artifact: { type: 'scale', dimensions: [1, 1, 1], baseline: [1, 1, 1], volume: 1, volumeRatio: 1, units: 'units', observedAt: now, source: 'browser-deterministic' }, createdAt: now, updatedAt: now, savedAt: now, completionLabel: 'Participation recorded, not mastery.', ...overrides };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function speechFixture(local = true) {
  return { utterances: [], cancellations: 0,
    getVoices() { return [{ name: 'Fixture English', lang: 'en-US', localService: local, default: true }]; },
    addEventListener() {}, removeEventListener() {},
    cancel() { this.cancellations++; },
    speak(utterance) { this.utterances.push(utterance); utterance.onstart?.(); },
  };
}

test('mentor audio is manual and speaks the exact saved reply without changing the lesson', async t => {
  const voice = speechFixture();
  const client = await harness(t, (path, options) => path === '/api/v1/sessions' && options.method === 'POST' ? { apiVersion: 1, session: session() } : undefined, voice);
  await client.click('start');
  assert.equal(voice.utterances.length, 0);
  assert.match(client.app.innerHTML, /Listen to latest reply/);
  const requestsBefore = client.calls.length;
  await client.click('speech-play');
  assert.equal(voice.utterances.length, 1);
  assert.equal(voice.utterances[0].text, session().messages[0].text);
  assert.match(client.app.innerHTML, /Stop audio/);
  assert.equal(client.calls.length, requestsBefore);
  await client.click('speech-stop');
  assert.match(client.app.innerHTML, /Listen to latest reply/);
  voice.utterances[0].onend?.();
  assert.equal(voice.utterances.length, 1);
  await client.click('speech-play');
  assert.equal(voice.utterances.length, 2);
  assert.equal(voice.utterances[1].text, session().messages[0].text);
  await client.click('home');
});

test('sending a question stops audio and a late voice event cannot restart the prior reply', async t => {
  const voice = speechFixture(); let resolvePoll;
  const initial = session(); const running = { id: 'voice-turn', status: 'running', kind: 'question' };
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: initial };
    if (path.endsWith('/sessions/session-1/turns')) return { apiVersion: 1, session: { ...initial, activeTurnId: 'voice-turn' }, turn: running };
    if (path === '/api/v1/turns/voice-turn') return new Promise(resolve => { resolvePoll = resolve; });
    if (path.endsWith('/turns/voice-turn/cancel')) return { apiVersion: 1, session: initial, turn: { ...running, status: 'cancelled' } };
  }, voice);
  await client.click('start'); await client.click('speech-play');
  const before = voice.cancellations;
  client.input('What happens when width doubles?'); await client.send();
  assert.ok(voice.cancellations > before);
  assert.match(client.app.innerHTML, /data-action="speech-play" disabled/);
  voice.utterances[0].onstart?.(); voice.utterances[0].onend?.();
  assert.equal(voice.utterances.length, 1);
  assert.doesNotMatch(client.app.innerHTML, /data-action="speech-stop"/);
  await client.click('cancel');
  resolvePoll({ apiVersion: 1, session: initial, turn: { ...running, status: 'completed' } }); await settle();
  assert.equal(voice.utterances.length, 1);
  await client.click('home');
});

test('leaving a lesson cancels speech and a different lesson never auto-plays it', async t => {
  const voice = speechFixture(); let starts = 0;
  const client = await harness(t, (path, options) => path === '/api/v1/sessions' && options.method === 'POST'
    ? { apiVersion: 1, session: session({ id: `lesson-${++starts}` }) } : undefined, voice);
  await client.click('start'); await client.click('speech-play');
  const before = voice.cancellations;
  await client.click('home'); assert.ok(voice.cancellations > before);
  await client.click('start');
  voice.utterances[0].onstart?.(); voice.utterances[0].onend?.();
  assert.equal(voice.utterances.length, 1);
  assert.doesNotMatch(client.app.innerHTML, /data-action="speech-stop"/);
  await client.click('home');
});

test('a remote-only voice leaves text fully usable without a cloud fallback', async t => {
  const voice = speechFixture(false);
  const client = await harness(t, (path, options) => path === '/api/v1/sessions' && options.method === 'POST' ? { apiVersion: 1, session: session() } : undefined, voice);
  await client.click('start');
  assert.match(client.app.innerHTML, /data-action="speech-play" disabled/);
  assert.match(client.app.innerHTML, /Look closely/);
  await client.click('speech-play');
  assert.equal(voice.utterances.length, 0);
  assert.match(client.app.innerHTML, /data-action="advance"/);
  await client.click('home');
});
async function settle() { for (let i = 0; i < 12; i++) await tick(); }
let importIndex = 0;

async function harness(t, route = () => undefined, speech) {
  const originals = { fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window, speechSynthesis: globalThis.speechSynthesis, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance };
  const listeners = new Map(); const elements = new Map(); const calls = [];
  const app = { innerHTML: '', addEventListener(name, callback) { listeners.set(name, callback); } };
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { disabled: false, textContent: '', innerHTML: '', scrollTop: 0, selectionStart: 0, selectionEnd: 0, classList: { toggle() {} }, scrollTo({ top }) { this.scrollTop = top; }, focus() {}, setSelectionRange() {} });
    return elements.get(selector);
  };
  globalThis.document = { activeElement: null, querySelector(selector) { return selector === '#app' ? app : element(selector); } };
  globalThis.window = { scrollTo() {} };
  globalThis.speechSynthesis = speech;
  globalThis.SpeechSynthesisUtterance = speech ? class { constructor(text) { this.text = text; } } : undefined;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    let result = await route(path, options, calls);
    if (!result) {
      if (path === '/api/v1/catalog') result = catalog;
      if (path === '/api/v1/sessions' && options.method === 'GET') result = { apiVersion: 1, sessions: [] };
      if (path === '/api/v1/capabilities') result = { apiVersion: 1, capabilities: [{ id: 'mentor.voice.v1', available: false, reason: 'Not connected' }], provider };
    }
    if (result?.httpError) return { ok: false, status: result.status, json: async () => result.data };
    assert.ok(result, `No fixture for ${options.method} ${path}`);
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  };
  t.after(() => { Object.assign(globalThis, originals); });
  await import(`../../public/app.js?client-test=${++importIndex}`);
  await settle();
  return {
    app, calls, elements,
    async click(action, data = {}) { await listeners.get('click')({ target: { closest: () => ({ disabled: false, dataset: { action, ...data } }) } }); await settle(); },
    input(text) { listeners.get('input')({ target: { id: 'message-input', value: text, dataset: {} } }); },
    async send() { listeners.get('submit')({ target: { id: 'message-form' }, preventDefault() {} }); await settle(); },
  };
}

test('academy has an honest empty resume state and starts exactly one server session', async t => {
  const client = await harness(t, (path, options) => path === '/api/v1/sessions' && options.method === 'POST' ? { apiVersion: 1, session: session() } : undefined);
  assert.match(client.app.innerHTML, /Your next discovery starts here/);
  assert.match(client.app.innerHTML, /Authored demo/);
  assert.equal(client.calls.filter(call => call.method === 'POST').length, 0);
  await client.click('start');
  assert.equal(client.calls.filter(call => call.method === 'POST').length, 1);
  assert.match(client.app.innerHTML, /Autosaved on this PC/);
  assert.match(client.app.innerHTML, /&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.doesNotMatch(client.app.innerHTML, /<script>not executable/);
  assert.match(client.app.innerHTML, /not physical-room or Matrix measurements/);
});

test('question keeps its type; duplicate submits are suppressed and stop prevents stale completion', async t => {
  const initial = session(); let resolvePoll;
  const running = { id: 'turn-1', status: 'running', kind: 'question' };
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: initial };
    if (path.endsWith('/sessions/session-1/turns')) return { apiVersion: 1, session: { ...initial, activeTurnId: 'turn-1' }, turn: running };
    if (path === '/api/v1/turns/turn-1') return new Promise(resolve => { resolvePoll = resolve; });
    if (path.endsWith('/turns/turn-1/cancel')) return { apiVersion: 1, session: initial, turn: { ...running, status: 'cancelled' } };
  });
  await client.click('start'); client.input('What if only the width doubles?');
  const first = client.send(); const second = client.send(); await Promise.all([first, second]);
  const posts = client.calls.filter(call => call.path.endsWith('/sessions/session-1/turns'));
  assert.equal(posts.length, 1); assert.equal(posts[0].body.kind, 'question'); assert.equal(posts[0].body.expectedRevision, 1);
  assert.match(client.app.innerHTML, /Stop response/);
  await client.click('cancel');
  resolvePoll({ apiVersion: 1, session: session({ stage: 'ended', status: 'completed', stageContent: stageContent(OBSERVATION_LESSON, 'ended') }), turn: { ...running, status: 'completed' } });
  await settle();
  assert.match(client.app.innerHTML, /lesson step has not advanced/);
  assert.doesNotMatch(client.app.innerHTML, /A discovery worth keeping/);
  await client.click('home');
});

test('retry after an uncertain mutation reuses the original request id and payload', async t => {
  let attempts = 0;
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') {
      attempts++;
      if (attempts === 1) throw new Error('Lost reply after commit');
      return { apiVersion: 1, session: session() };
    }
  });
  await client.click('start'); assert.match(client.app.innerHTML, /Cannot reach the School service/);
  await client.click('retry');
  const posts = client.calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 2); assert.deepEqual(posts[0].body, posts[1].body);
  assert.match(client.app.innerHTML, /Autosaved on this PC/);
});

test('sliding a preset is only a preview until explicit experiment submission', async t => {
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: session() };
    if (path.endsWith('/experiment')) return { apiVersion: 1, session: session({ revision: 2, artifact: { ...session().artifact, dimensions: [2, 2, 2], volume: 8, volumeRatio: 8 } }) };
  });
  await client.click('start'); await client.click('preset', { values: '2,2,2' });
  assert.match(client.app.innerHTML, /Preview only/);
  assert.equal(client.calls.filter(call => call.path.endsWith('/experiment')).length, 0);
  await client.click('experiment');
  const post = client.calls.find(call => call.path.endsWith('/experiment'));
  assert.deepEqual(post.body.dimensions, [2, 2, 2]); assert.equal(post.body.expectedRevision, 1);
  assert.match(client.app.innerHTML, /Recorded: 2 × 2 × 2 browser units/);
});

test('stale revision retry refreshes the existing session without replaying the mutation', async t => {
  let experiments = 0;
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: session() };
    if (path.endsWith('/experiment')) { experiments++; return { httpError: true, status: 409, data: { apiVersion: 1, error: 'The lesson changed. Refresh it.', code: 'stale_revision' } }; }
    if (path === '/api/v1/sessions/session-1') return { apiVersion: 1, session: session({ revision: 4 }) };
  });
  await client.click('start'); await client.click('experiment'); await client.click('retry');
  assert.equal(experiments, 1);
  assert.ok(client.calls.some(call => call.path === '/api/v1/sessions/session-1' && call.method === 'GET'));
});

test('provider busy preserves the unsent draft and retries the same request when capacity returns', async t => {
  let attempts = 0;
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: session() };
    if (path.endsWith('/sessions/session-1/turns')) {
      attempts++;
      if (attempts === 1) return { httpError: true, status: 503, data: { apiVersion: 1, code: 'provider_busy', error: 'The mentor is handling other lessons. Your message was not submitted. Keep it here and retry shortly.' } };
      return { apiVersion: 1, session: session(), turn: { id: 'turn-retried', status: 'completed' } };
    }
  });
  await client.click('start'); client.input('What if only height doubles?'); await client.send();
  assert.match(client.app.innerHTML, /message was not submitted/);
  assert.match(client.app.innerHTML, />What if only height doubles\?<\/textarea>/);
  await client.click('retry');
  const requests = client.calls.filter(call => call.path.endsWith('/sessions/session-1/turns'));
  assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
  assert.doesNotMatch(client.app.innerHTML, /message was not submitted/);
});

test('retrying the original message preserves a newer unsent draft', async t => {
  let attempts = 0;
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: session() };
    if (path.endsWith('/sessions/session-1/turns')) {
      attempts++;
      if (attempts === 1) throw new Error('Reply lost after submission');
      return { apiVersion: 1, session: session(), turn: { id: 'original-turn', status: 'completed' } };
    }
  });
  await client.click('start'); client.input('What happens when width doubles?'); await client.send();
  client.input('A new question I have not submitted.');
  await client.click('retry');
  const requests = client.calls.filter(call => call.path.endsWith('/sessions/session-1/turns'));
  assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(requests[1].body.text, 'What happens when width doubles?');
  assert.match(client.app.innerHTML, />A new question I have not submitted\.<\/textarea>/);
});

test('advancing the opening lesson preserves a question that has not been submitted', async t => {
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: session() };
    if (path.endsWith('/sessions/session-1/turns')) return { apiVersion: 1, session: session({ stage: 'example', stageContent: stageContent(OBSERVATION_LESSON, 'example') }), turn: { id: 'advance-turn', status: 'completed' } };
  });
  await client.click('start'); client.input('A question I am still writing.'); await client.click('advance');
  const request = client.calls.find(call => call.path.endsWith('/sessions/session-1/turns'));
  assert.equal(request.body.kind, 'advance'); assert.equal(request.body.text, undefined);
  assert.match(client.app.innerHTML, />A question I am still writing\.<\/textarea>/);
  assert.match(client.app.innerHTML, /data-value="question" aria-pressed="true"/);
});

test('a newer Matrix response can finish a mentor turn without a late turn poll leaving the composer stuck', async t => {
  let resolvePoll;
  const running = { id: 'turn-1', status: 'running', kind: 'question' };
  const newer = session({ revision: 5, stage: 'example', stageContent: stageContent(OBSERVATION_LESSON, 'example') });
  const client = await harness(t, (path, options) => {
    if (path === '/api/v1/sessions' && options.method === 'POST') return { apiVersion: 1, session: session() };
    if (path.endsWith('/sessions/session-1/turns')) return { apiVersion: 1, session: session({ revision: 2, activeTurnId: 'turn-1' }), turn: running };
    if (path === '/api/v1/turns/turn-1') return new Promise(resolve => { resolvePoll = resolve; });
    if (path.endsWith('/matrix')) return { apiVersion: 1, session: newer, bridge: { connected: false, binding: null, demonstrations: [] } };
  });
  await client.click('start'); client.input('How does it work?'); await client.send();
  assert.match(client.app.innerHTML, /Stop response/);
  await client.click('matrix-open');
  assert.doesNotMatch(client.app.innerHTML, /Stop response/);
  client.input('Keep this new question.');
  resolvePoll({ apiVersion: 1, session: session({ revision: 4 }), turn: { ...running, status: 'completed' } }); await settle();
  assert.doesNotMatch(client.app.innerHTML, /Stop response/);
  assert.match(client.app.innerHTML, /Keep this new question\./);
  assert.match(client.app.innerHTML, /Make a prediction/);
  await client.click('home');
});
