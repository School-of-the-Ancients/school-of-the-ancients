/** Optional browser dictation. It only fills an editable draft; it never submits a turn. */
export function createSpeechInput({
  Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
  onChange = () => {},
  onTranscript = () => {},
} = {}) {
  const available = typeof Recognition === 'function';
  let context = null;
  let recognition = null;
  let generation = 0;
  let status = 'idle';
  let error = '';
  let disposed = false;

  function notify() { if (!disposed) onChange(); }
  function state() {
    return {
      available: available && !disposed,
      status,
      canStart: available && !disposed && context !== null && recognition === null,
      reason: error || (!available ? 'Speech input is unavailable in this browser. You can type instead.' : ''),
    };
  }
  function stop() {
    generation++;
    const active = recognition;
    recognition = null;
    status = 'idle';
    error = '';
    if (active) {
      active.onstart = null;
      active.onresult = null;
      active.onerror = null;
      active.onend = null;
      try { active.abort(); } catch { /* Draft remains editable. */ }
    }
    notify();
  }
  function setContext(value) {
    const next = typeof value === 'string' && value ? value : null;
    if (context === next) return;
    context = next;
    if (recognition) stop();
  }
  function start() {
    if (!state().canStart) return false;
    let active;
    try {
      active = new Recognition();
      active.lang = 'en-US';
      active.continuous = false;
      active.interimResults = false;
      active.maxAlternatives = 1;
      recognition = active;
      status = 'starting';
      error = '';
      const currentGeneration = ++generation;
      let delivered = false;
      const current = () => !disposed && recognition === active && generation === currentGeneration;
      active.onstart = () => { if (current()) { status = 'listening'; notify(); } };
      active.onresult = event => {
        if (!current() || delivered) return;
        const results = event?.results;
        if (!results || typeof results.length !== 'number') return;
        for (let index = 0; index < results.length; index++) {
          const item = results[index];
          const transcript = item?.isFinal ? item[0]?.transcript : null;
          if (typeof transcript !== 'string' || !transcript.trim()) continue;
          delivered = true;
          onTranscript(transcript.trim().slice(0, 4000), context);
          if (current()) stop();
          return;
        }
      };
      active.onerror = event => {
        if (!current()) return;
        generation++;
        recognition = null;
        status = 'error';
        error = event?.error === 'not-allowed' || event?.error === 'service-not-allowed'
          ? 'Microphone permission was denied. Type your response instead.'
          : 'Speech input could not finish. Your typed draft is still available.';
        try { active.abort(); } catch { /* Text remains available. */ }
        notify();
      };
      active.onend = () => {
        if (!current()) return;
        recognition = null;
        status = 'idle';
        notify();
      };
      active.start();
      notify();
      return true;
    } catch {
      if (active) {
        try { active.abort(); } catch { /* Text remains available. */ }
      }
      generation++;
      recognition = null;
      status = 'error';
      error = 'Speech input could not start. Type your response instead.';
      notify();
      return false;
    }
  }
  function destroy() {
    if (disposed) return;
    stop();
    context = null;
    disposed = true;
  }
  return { setContext, start, stop, state, destroy };
}
