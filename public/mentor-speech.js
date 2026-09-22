/** Optional playback adapter. It reads a saved caption and never edits a lesson. */
export function createMentorSpeech({
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  onChange = () => {},
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let context = null;
  let voice = null;
  let utterance = null;
  let generation = 0;
  let timer = null;
  let disposed = false;
  let status = 'idle';
  let error = '';
  const supported = Boolean(synthesis && typeof synthesis.getVoices === 'function'
    && typeof synthesis.speak === 'function' && typeof synthesis.cancel === 'function'
    && typeof Utterance === 'function');

  const voiceKey = value => [value.voiceURI, value.name, value.lang].join('\n');
  const validContext = value => value && typeof value.sessionId === 'string' && value.sessionId.length > 0
    && typeof value.messageId === 'string' && value.messageId.length > 0
    && typeof value.text === 'string' && value.text.length <= 8000 && value.text.trim().length > 0;
  const sameContext = (left, right) => left === right || (left && right
    && left.sessionId === right.sessionId && left.messageId === right.messageId && left.text === right.text);

  function state() {
    const available = !disposed && supported && voice !== null;
    const phase = disposed || !available ? 'unavailable' : status;
    return {
      available,
      canPlay: available && context !== null && !['starting', 'speaking'].includes(phase),
      status: phase,
      voiceName: available && typeof voice.name === 'string' ? voice.name : '',
      reason: disposed ? 'Speech playback is closed.'
        : !supported ? 'This browser does not support speech playback. The response remains available as text.'
          : !voice ? 'No local English voice is available. The response remains available as text.'
            : error || (!context ? 'Choose a saved mentor response to read aloud.' : ''),
    };
  }

  function notify() {
    if (!disposed) onChange(state());
  }

  function clearStartTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function invalidate(cancelQueue = false) {
    generation += 1;
    clearStartTimer();
    const wasActive = utterance !== null;
    utterance = null;
    if ((wasActive || cancelQueue) && supported) {
      try { synthesis.cancel(); }
      catch {
        status = 'error';
        error = 'The browser could not stop playback. Use its audio controls if speech continues.';
        return false;
      }
    }
    status = 'idle';
    error = '';
    return true;
  }

  function refreshVoices(emit = true) {
    if (disposed) return;
    let candidates = [];
    if (supported) {
      try {
        const found = synthesis.getVoices();
        if (Array.isArray(found)) candidates = found.filter(value => value && value.localService === true
          && typeof value.lang === 'string' && /^en(?:[-_]|$)/i.test(value.lang));
      } catch { /* Text remains usable when voice enumeration fails. */ }
    }
    const retained = voice && candidates.find(candidate => voiceKey(candidate) === voiceKey(voice));
    if (utterance && !retained) invalidate();
    voice = retained || candidates.find(candidate => candidate.default === true) || candidates[0] || null;
    if (emit) notify();
  }

  function setContext(value) {
    if (disposed) return;
    const next = validContext(value) ? { sessionId: value.sessionId, messageId: value.messageId, text: value.text } : null;
    if (!sameContext(context, next)) {
      invalidate();
      context = next;
    }
    // Rendering supplies context synchronously; never cause another render here.
  }

  function play() {
    if (disposed) return false;
    refreshVoices(false);
    if (!context || !voice || !supported) { notify(); return false; }
    if (!invalidate(true)) { notify(); return false; }
    const currentGeneration = generation;
    let created;
    const current = () => !disposed && generation === currentGeneration && utterance === created;
    try {
      created = new Utterance(context.text);
      created.text = context.text;
      created.voice = voice;
      created.lang = voice.lang;
      created.rate = 1;
      created.pitch = 1;
      created.volume = 1;
      utterance = created;
      status = 'starting';
      created.onstart = () => {
        if (!current()) return;
        clearStartTimer();
        status = 'speaking';
        notify();
      };
      created.onend = () => {
        if (!current()) return;
        clearStartTimer();
        utterance = null;
        status = 'idle';
        notify();
      };
      created.onerror = () => {
        if (!current()) return;
        clearStartTimer();
        utterance = null;
        status = 'error';
        error = 'The browser could not finish playback. Read the response or try again.';
        notify();
      };
      timer = setTimer(() => {
        if (!current() || status !== 'starting') return;
        if (invalidate()) {
          status = 'error';
          error = 'Speech did not start. Read the response or try playback again.';
        }
        notify();
      }, 8000);
      synthesis.speak(created);
    } catch {
      if (invalidate()) {
        status = 'error';
        error = 'The browser could not start playback. The response remains available as text.';
      }
      notify();
      return false;
    }
    notify();
    return true;
  }

  function stop() {
    if (disposed) return;
    invalidate(true);
    notify();
  }

  const voicesChanged = () => refreshVoices();
  refreshVoices(false);
  if (supported && typeof synthesis.addEventListener === 'function') synthesis.addEventListener('voiceschanged', voicesChanged);

  function destroy() {
    if (disposed) return;
    invalidate();
    disposed = true;
    context = null;
    voice = null;
    if (supported && typeof synthesis.removeEventListener === 'function') synthesis.removeEventListener('voiceschanged', voicesChanged);
  }

  return { setContext, play, stop, state, destroy };
}
