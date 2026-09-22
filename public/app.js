import { createApiClient, escapeHtml as h, STAGES, STAGE_LABELS, ANSWER_LABELS, stageProgress, providerPresentation, normalDimensions, dimensionsEqual, volumeOf, numberLabel, makeRequestId, formatSavedAt, safeSourceUrl } from './client-core.js';
import { scaleDiagram } from './scale-view.js';
import { createMatrixPanel } from './matrix-panel.js';
import { createMentorSpeech } from './mentor-speech.js';

const api = createApiClient();
const app = document.querySelector('#app');
const state = { catalog: null, capabilities: [], sessions: [], session: null, turn: null, loading: true, busy: false, busyLabel: '', error: '', retry: null, notice: '', draft: '', intent: 'question', dimensions: [1, 1, 1], selectedMentor: '', selectedLesson: '', pollGeneration: 0 };
let pollTimer;
const matrixPanel = createMatrixPanel({ api, getSession: () => state.session, onSession: session => adoptSession(session), onChange: () => render() });
const mentorSpeech = createMentorSpeech({ onChange: () => render() });

function syncSpeechContext() {
  const session = state.session;
  const message = session?.messages.findLast(item => item.role === 'mentor');
  mentorSpeech.setContext(message && !session.activeTurnId && state.turn?.status !== 'running'
    ? { sessionId: session.id, messageId: message.id, text: message.text } : null);
}

function speechControls() {
  const voice = mentorSpeech.state();
  const playing = voice.status === 'starting' || voice.status === 'speaking';
  const disabled = !voice.canPlay || state.busy || state.turn?.status === 'running';
  return `<div class="mentor-speech" aria-label="Mentor audio"><div class="mentor-speech-actions">${playing
    ? '<button class="text-button" data-action="speech-stop">Stop audio</button>'
    : `<button class="text-button" data-action="speech-play" ${disabled ? 'disabled' : ''}>Listen to latest reply</button>`}
    <span role="status">${h(playing ? (voice.status === 'starting' ? 'Starting audio…' : 'Reading the latest reply') : voice.reason || 'Ready when you are.')}</span></div>
    <small>${h(voice.available && voice.voiceName ? `Device voice: ${voice.voiceName}. ` : '')}The transcript stays visible. This is optional playback, not voice input or a historical voice.</small></div>`;
}

const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 5-7 7 7 7M6 12h14"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-4 0h8M3 3l18 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>',
};

function brand() {
  return `<button class="brand" data-action="home" aria-label="School of the Ancients, return to academy" ${state.busy || state.turn?.status === 'running' ? 'disabled' : ''}><span class="brand-symbol" aria-hidden="true">✳</span><span>School of<br><strong>the Ancients</strong></span></button>`;
}

function providerBadge() {
  const provider = providerPresentation(state.catalog?.provider);
  return `<span class="status-badge ${h(provider.tone)}" title="${h(provider.detail)}"><span class="status-dot"></span>${h(provider.label)}</span>`;
}

function shell(content) {
  return `<header class="site-header">${brand()}<nav aria-label="Main"><span class="header-caption">A place for curiosity</span>${providerBadge()}</nav></header>${state.error ? `<div class="error-banner" role="alert"><div><strong>We couldn’t finish that.</strong><p>${h(state.error)}</p></div><div class="error-actions">${state.retry ? '<button class="button button-small" data-action="retry">Retry</button>' : ''}<button class="icon-button" data-action="dismiss-error" aria-label="Dismiss error">×</button></div></div>` : ''}${state.notice ? `<div class="notice-banner" role="status">${h(state.notice)}</div>` : ''}${content}<footer class="site-footer"><span>Built for questions worth exploring.</span><span>Historical mentors are AI interpretations, not historical testimony.</span></footer>`;
}

function academy() {
  const mentors = state.catalog?.mentors || [];
  const lessons = (state.catalog?.lessons || []).filter(lesson => !state.selectedMentor || lesson.mentorId === state.selectedMentor);
  return `<main id="main" class="academy">
    <section class="academy-hero"><div><p class="eyebrow">THE ACADEMY · FIRST EXHIBIT</p><h1>Great questions.<br><em>Remarkable company.</em></h1><p class="hero-description">Meet a mind from the past. Explore an idea together.<br class="desktop-only"> Learn by asking, making, and seeing for yourself.</p></div><div class="hero-annotation"><span class="orbit-mark" aria-hidden="true">◎</span><p>Knowledge begins<br>with a little wonder.</p><span class="tiny-rule"></span><small>CONVERSATION → DISCOVERY</small></div></section>
    <section class="begin-section" aria-labelledby="begin-title"><div class="section-heading"><div><span class="eyebrow">01 / CHOOSE YOUR COMPANY</span><h2 id="begin-title">A guide for the curious.</h2></div><p>One prepared exhibit. Room to ask your own questions.</p></div>
      <div class="begin-grid"><div class="mentor-options">${mentors.map(mentor => `<button class="mentor-card ${state.selectedMentor === mentor.id ? 'selected' : ''}" data-action="mentor" data-id="${h(mentor.id)}" aria-pressed="${state.selectedMentor === mentor.id}"><div class="mentor-portrait"><img src="/assets/galileo.jpg" alt="Portrait used for ${h(mentor.name)} in the School’s beta" loading="eager"><span class="portrait-caption">${h(mentor.timeframe)}</span><span class="selection-mark">${icons.check}</span></div><div class="mentor-card-body"><p class="eyebrow">${h(mentor.title)}</p><h3>${h(mentor.name)}</h3><p>${h(mentor.description)}</p><div class="tag-row">${mentor.expertise.slice(0, 3).map(tag => `<span>${h(tag)}</span>`).join('')}</div></div></button>`).join('')}</div>
      <div class="lesson-picker"><span class="eyebrow">02 / FOLLOW AN IDEA</span>${lessons.length ? lessons.map(lesson => `<button class="lesson-choice ${state.selectedLesson === lesson.id ? 'selected' : ''}" data-action="lesson" data-id="${h(lesson.id)}" aria-pressed="${state.selectedLesson === lesson.id}"><span class="lesson-icon">${icons.book}</span><span><strong>${h(lesson.title)}</strong><small>${h(lesson.duration)} · Interactive exploration</small><p>${h(lesson.description)}</p></span><span class="radio-dot"></span></button>`).join('') : '<p>Select a mentor to see their lessons.</p>'}
        <div class="what-to-expect"><h3>A small change. A surprising difference.</h3><p>Make a prediction, change a block’s dimensions, and discover what happens to its volume.</p><div class="mini-path"><span>Predict</span><i>→</i><span>Try</span><i>→</i><span>Reflect</span></div></div>
        <button class="button start-button" data-action="start" ${state.busy || !state.selectedMentor || !state.selectedLesson ? 'disabled' : ''}>${state.busy ? h(state.busyLabel) : 'Begin the exploration'}${icons.arrow}</button>
        <p class="support-note">Text first. No microphone or headset needed.<br>Your work is saved on this PC.</p>
      </div></div>
    </section>
    <section class="resume-section" aria-labelledby="resume-title"><div class="section-heading"><div><span class="eyebrow">YOUR NOTEBOOK</span><h2 id="resume-title">Pick up the thread.</h2></div><button class="text-button" data-action="refresh-sessions" ${state.busy ? 'disabled' : ''}>Refresh saved lessons</button></div>${state.sessions.length ? `<div class="saved-grid">${state.sessions.map(session => `<button class="saved-card" data-action="resume" data-id="${h(session.id)}" ${state.busy ? 'disabled' : ''}><div class="saved-icon">${icons.book}</div><div><strong>${h(session.lesson.title)}</strong><p>With ${h(session.mentor.name)} · ${h(STAGE_LABELS[session.stage] || session.stage)}</p><small>${h(formatSavedAt(session.savedAt))}</small></div>${icons.arrow}</button>`).join('')}</div>` : `<div class="empty-notebook"><span>${icons.book}</span><div><strong>Your next discovery starts here.</strong><p>Saved lessons will appear here after you begin. You can leave and return at any stage.</p></div></div>`}</section>
    <div class="academy-footnote"><span class="pill">BROWSER EXPERIENCE</span><p>Explore independently here. Connecting a Matrix scene is optional and separate from this simulated activity.</p></div>
  </main>`;
}

function stageRail(session) {
  const stageIndex = STAGES.indexOf(session.stage);
  return `<ol class="stage-rail" aria-label="Lesson progress">${STAGES.filter(stage => stage !== 'ended').map((stage, index) => `<li class="${index < stageIndex ? 'done' : ''} ${session.stage === stage ? 'current' : ''}" ${session.stage === stage ? 'aria-current="step"' : ''}><span class="stage-number">${index < stageIndex ? icons.check : index + 1}</span><span>${h(STAGE_LABELS[stage])}</span></li>`).join('')}</ol>`;
}

function artifactPanel(session) {
  const committed = normalDimensions(session.artifact.dimensions);
  const dirty = !dimensionsEqual(committed, state.dimensions);
  const busy = state.busy || state.turn?.status === 'running' || session.status === 'completed';
  return `<aside class="experiment-panel" aria-labelledby="experiment-title"><div class="panel-heading"><div><span class="eyebrow">THE WORKBENCH</span><h2 id="experiment-title">Observation & scale</h2></div><span class="tiny-star" aria-hidden="true">✧</span></div>
    <div class="artifact-visual" id="artifact-visual">${scaleDiagram(state.dimensions)}</div>
    <div class="artifact-metrics" id="artifact-metrics"><div><span>VOLUME</span><strong>${numberLabel(volumeOf(state.dimensions))}<small> unit³</small></strong></div><div><span>VS. UNIT CUBE</span><strong>${numberLabel(volumeOf(state.dimensions))}<small> ×</small></strong></div></div>
    <div class="experiment-controls">${['Width', 'Height', 'Depth'].map((label, index) => `<label class="slider-label" for="dimension-${index}"><span>${label}</span><output id="dimension-output-${index}" for="dimension-${index}">${numberLabel(state.dimensions[index])}</output><input id="dimension-${index}" data-dimension="${index}" type="range" min="0.5" max="4" step="0.5" value="${state.dimensions[index]}" ${busy ? 'disabled' : ''}></label>`).join('')}
    <div class="preset-row"><button data-action="preset" data-values="2,2,2" ${busy ? 'disabled' : ''}>Double every side</button><button data-action="preset" data-values="2,1,1" ${busy ? 'disabled' : ''}>Width only</button><button data-action="preset" data-values="1,1,1" ${busy ? 'disabled' : ''}>Unit cube</button></div>
    <button class="button button-secondary apply-experiment" data-action="experiment" ${busy ? 'disabled' : ''}>${icons.check}Apply experiment</button>
    <p class="artifact-state ${dirty ? 'preview' : ''}" id="artifact-state">${dirty ? 'Preview only — apply to share this result with your mentor.' : `Recorded: ${committed.map(numberLabel).join(' × ')} browser units.`}</p></div>
    <div class="artifact-disclosure"><span class="pill">DETERMINISTIC ILLUSTRATION</span><p>Simulated browser dimensions, calculated as width × height × depth. These are not physical-room or Matrix measurements.</p></div>
  </aside>`;
}

function conversation(session) {
  const pending = state.turn?.status === 'running';
  const closed = session.status === 'completed';
  const suggestions = session.stageContent.suggestedQuestions || [];
  const label = state.intent === 'question' ? 'Ask Galileo' : (ANSWER_LABELS[session.stage] || 'Share response');
  return `<section class="conversation-panel" aria-labelledby="conversation-title"><div class="conversation-heading"><div><span class="eyebrow">A CONVERSATION WITH</span><h2 id="conversation-title">${h(session.mentor.name)}</h2></div><span class="conversation-mode">${providerBadge()}</span></div>
    <div class="transcript" id="transcript" role="log" aria-live="polite" aria-relevant="additions text">${session.messages.map(message => `<article class="message ${h(message.role)}"><div class="message-avatar" aria-hidden="true">${message.role === 'mentor' ? 'G' : message.role === 'learner' ? 'Y' : '·'}</div><div class="message-body"><div class="message-meta"><strong>${message.role === 'mentor' ? h(session.mentor.name.split(' ')[0]) : message.role === 'learner' ? 'You' : 'Lesson note'}</strong>${message.role === 'mentor' ? `<span>${message.providerMode === 'codex-cli' ? 'AI RESPONSE' : 'AUTHORED'}</span>` : ''}</div><p>${h(message.text)}</p></div></article>`).join('')}${pending ? `<article class="message mentor pending-message"><div class="message-avatar" aria-hidden="true">G</div><div class="message-body"><div class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></div><p>${state.catalog?.provider?.mode === 'demo' ? 'Preparing the next part of your exploration…' : 'Considering your question…'}</p></div></article>` : ''}</div>
    ${matrixPanel.renderSuggestion(session, { lessonBusy: state.busy || pending })}
    ${speechControls()}
    ${closed ? `<div class="completion-card"><span class="completion-symbol">${icons.check}</span><div><h3>A discovery worth keeping.</h3><p>${h(session.completionLabel || 'You completed this exploration. Your conversation and reflection are saved.')}</p><small>Completion records participation, not a mastery assessment.</small></div></div><div class="completion-actions"><button class="button" data-action="home">Return to the academy${icons.arrow}</button><button class="text-button" data-action="export">Export notebook</button></div>` : `<div class="conversation-composer"><div class="suggestions" aria-label="Suggested questions">${suggestions.slice(0, 2).map(text => `<button data-action="suggestion" data-text="${h(text)}" ${state.busy || pending ? 'disabled' : ''}>${h(text)}</button>`).join('')}</div><div class="intent-switch" role="group" aria-label="Message purpose"><button data-action="intent" data-value="question" aria-pressed="${state.intent === 'question'}" ${state.busy || pending ? 'disabled' : ''}>Ask a question</button><button data-action="intent" data-value="answer" aria-pressed="${state.intent === 'answer'}" ${state.busy || pending ? 'disabled' : ''}>Respond to the lesson</button></div><form id="message-form"><label class="sr-only" for="message-input">${h(label)}</label><textarea id="message-input" name="message" rows="2" maxlength="4000" placeholder="${state.intent === 'question' ? 'What are you curious about?' : h(session.stageContent.prompt)}" ${state.busy || pending ? 'disabled' : ''}>${h(state.draft)}</textarea><div class="composer-bottom"><span class="voice-unavailable" title="Type your questions here. Optional mentor playback is above the composer.">${icons.mic}<span>Type a question · audio optional</span></span>${pending ? `<button type="button" class="button button-small button-stop" data-action="cancel" ${state.busy ? 'disabled' : ''}>Stop response</button>` : `<button type="submit" class="button button-small" id="send-message" ${state.busy || !state.draft.trim() ? 'disabled' : ''}>${state.busy ? h(state.busyLabel) : h(label)}${icons.arrow}</button>`}</div></form><p class="composer-note">${state.intent === 'question' ? 'Questions keep you on the current lesson step.' : 'Your response advances the lesson after the mentor replies.'} <span>Enter to send · Shift + Enter for a new line</span></p></div>`}
  </section>`;
}

function lesson() {
  const session = state.session;
  const busy = state.busy || state.turn?.status === 'running';
  return `<main id="main" class="lesson-shell"><div class="lesson-toolbar"><button class="text-button" data-action="home" ${busy ? 'disabled' : ''}>${icons.back}The academy</button><div class="save-tools"><span class="save-status">${icons.check}Autosaved on this PC<span>${h(formatSavedAt(session.savedAt))}</span></span><button class="text-button" data-action="export" ${state.busy ? 'disabled' : ''}>${icons.download}Export</button></div></div><div class="lesson-title-row"><div><p class="eyebrow">YOUR EXPLORATION</p><h1>${h(session.lesson.title)}</h1></div><span class="lesson-progress-label">${stageProgress(session.stage)}% of lesson steps<span>Not a mastery score</span></span></div>${stageRail(session)}
    <section class="current-step" aria-label="Current lesson step"><span class="step-glyph">${session.status === 'completed' ? '✓' : String(STAGES.indexOf(session.stage) + 1).padStart(2, '0')}</span><div><p class="eyebrow">${h(STAGE_LABELS[session.stage] || 'LESSON')}</p><h2>${h(session.stageContent.title)}</h2><p>${h(session.stageContent.prompt)}</p></div>${session.stage === 'explain' ? `<button class="button button-small button-secondary" data-action="advance" ${busy ? 'disabled' : ''}>Make a prediction${icons.arrow}</button>` : ''}</section>
    <div class="lesson-workspace">${conversation(session)}${artifactPanel(session)}</div>
    ${matrixPanel.render(session, { lessonBusy: busy })}
    <details class="lesson-sources"><summary>About this lesson & its sources<span>+</span></summary><div><p>${h(session.lesson.objective)}</p><p>${h(session.mentor.disclosure)}</p><ul>${session.lesson.sources.map(source => `<li><strong>${safeSourceUrl(source.url) ? `<a href="${h(safeSourceUrl(source.url))}" target="_blank" rel="noopener noreferrer">${h(source.title)}</a>` : h(source.title)}</strong> — ${h(source.description)}</li>`).join('')}</ul><p>Portrait: the School of the Ancients beta, retained with its repository provenance. No historical quotation is implied by generated dialogue.</p></div></details>
  </main>`;
}

function render({ scrollTranscript = false } = {}) {
  syncSpeechContext();
  const restoreSpeechFocus = document.activeElement?.dataset?.action?.startsWith('speech-');
  const previousScroll = document.querySelector('#transcript')?.scrollTop || 0;
  const oldInput = document.querySelector('#message-input');
  const restoreInputFocus = Boolean(oldInput && document.activeElement === oldInput);
  const selection = restoreInputFocus ? [oldInput.selectionStart, oldInput.selectionEnd] : null;
  if (state.loading) app.innerHTML = shell('<main id="main" class="initial-loading"><span class="loading-orbit" aria-hidden="true"></span><h1>Opening the academy…</h1><p>Preparing your mentors and saved explorations.</p></main>');
  else if (!state.catalog) app.innerHTML = shell('<main id="main" class="initial-loading"><h1>The academy is waiting.</h1><p>Start the School service on this PC, then try again.</p><button class="button" data-action="bootstrap">Reconnect to School</button></main>');
  else app.innerHTML = shell(state.session ? lesson() : academy());
  const transcript = document.querySelector('#transcript');
  if (transcript) {
    // This node is replaced on provider/Matrix status renders. Finish the scroll
    // synchronously so a second render cannot cancel it before the reply is visible.
    if (scrollTranscript) transcript.scrollTo({ top: 100000, behavior: 'auto' });
    else transcript.scrollTop = previousScroll;
  }
  const input = document.querySelector('#message-input');
  if (restoreInputFocus && input && !input.disabled) { input.focus({ preventScroll: true }); input.setSelectionRange(...selection); }
  if (restoreSpeechFocus) document.querySelector('[data-action="speech-stop"], [data-action="speech-play"]')?.focus({ preventScroll: true });
}

function adoptSession(session, { reset = false } = {}) {
  if (state.session?.id === session.id && session.revision < state.session.revision) return false;
  const changedArtifact = !state.session || !dimensionsEqual(state.session.artifact.dimensions, session.artifact.dimensions);
  const changedSession = state.session?.id !== session.id;
  const changedStage = state.session?.stage !== session.stage;
  state.session = session;
  // Matrix results can arrive while a mentor turn is being polled. The latest
  // School record remains the authority for whether that turn is still active.
  if (state.turn?.status === 'running' && session.activeTurnId !== state.turn.id) state.turn = session.activeTurnId ? { id: session.activeTurnId, status: 'running' } : null;
  if (reset || changedSession || changedArtifact) state.dimensions = normalDimensions(session.artifact.dimensions);
  state.sessions = [session, ...state.sessions.filter(item => item.id !== session.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (changedSession) state.draft = '';
  if (changedSession || (changedStage && !state.draft.trim())) state.intent = session.stage === 'explain' ? 'question' : 'answer';
  return true;
}

function adoptTurn(result) {
  if (!adoptSession(result.session)) return;
  state.turn = result.turn;
  if (result.turn.status === 'failed' || result.turn.status === 'interrupted') {
    state.error = result.turn.error || 'The mentor response did not complete. Your message is saved; the lesson step has not advanced.';
    state.retry = null;
  } else if (result.turn.status === 'cancelled') state.notice = 'Response stopped. Your message is saved and the lesson remains on the same step.';
}

async function operation(label, task, { retry = task } = {}) {
  if (state.busy) return;
  state.busy = true; state.busyLabel = label; state.error = ''; state.retry = null; state.notice = '';
  render();
  try { await task(); }
  catch (error) {
    state.error = (error.message || 'The request failed.') + (error.uncertain ? ' It may already have been saved. Retry checks the same request instead of submitting it twice.' : '');
    if (error.status === 409 && state.session) state.retry = () => refreshSession(state.session.id);
    else if (!error.status || error.status >= 500) state.retry = () => operation(label, retry, { retry });
  } finally { state.busy = false; render({ scrollTranscript: true }); }
}

async function bootstrap() {
  state.loading = true; state.error = ''; state.retry = null; render();
  try {
    const [catalog, sessions, capabilities] = await Promise.all([api('/catalog'), api('/sessions'), api('/capabilities')]);
    state.catalog = catalog; state.sessions = sessions.sessions; state.capabilities = capabilities.capabilities;
    state.selectedMentor ||= catalog.mentors[0]?.id || '';
    state.selectedLesson ||= catalog.lessons.find(item => item.mentorId === state.selectedMentor)?.id || '';
  } catch (error) { state.error = error.message; state.retry = bootstrap; }
  finally { state.loading = false; render(); }
}

function stopPolling() { clearTimeout(pollTimer); state.pollGeneration++; }

function monitorTurn(turnId) {
  stopPolling();
  const generation = state.pollGeneration;
  const started = Date.now();
  const sessionId = state.session.id;
  async function poll() {
    if (generation !== state.pollGeneration || state.session?.id !== sessionId) return;
    try {
      const result = await api(`/turns/${encodeURIComponent(turnId)}`);
      if (generation !== state.pollGeneration || state.session?.id !== sessionId) return;
      const previousStage = state.session.stage;
      adoptTurn(result);
      if (result.turn.status === 'running') {
        if (Date.now() - started > 120000) {
          state.error = 'This response is still pending. Check progress or stop it before sending another message.';
          state.retry = () => monitorTurn(turnId);
        } else pollTimer = setTimeout(poll, 700);
      } else {
        if (previousStage !== state.session.stage && !state.draft.trim()) state.intent = state.session.stage === 'explain' ? 'question' : 'answer';
        api('/catalog').then(catalog => { state.catalog = catalog; render(); }).catch(() => {});
      }
      render({ scrollTranscript: true });
    } catch (error) {
      if (generation !== state.pollGeneration) return;
      state.error = `${error.message} The response may still be running; retry checks its status without sending your message again.`;
      state.retry = () => monitorTurn(turnId); render();
    }
  }
  void poll();
}

async function refreshSession(id) {
  await operation('Opening lesson…', async () => {
    const { session } = await api(`/sessions/${encodeURIComponent(id)}`);
    stopPolling(); adoptSession(session, { reset: true }); state.turn = session.activeTurnId ? { id: session.activeTurnId, status: 'running' } : null;
    if (session.activeTurnId) monitorTurn(session.activeTurnId);
  });
}

function sendTurn(kind, text = '') {
  if (!state.session || state.session.status === 'completed' || state.turn?.status === 'running' || state.busy) return;
  if (kind !== 'advance' && !text.trim()) return;
  mentorSpeech.stop();
  const id = state.session.id;
  const submittedDraft = state.draft;
  const body = { requestId: makeRequestId(), expectedRevision: state.session.revision, kind, ...(text.trim() ? { text: text.trim() } : {}) };
  void operation('Sending…', async () => {
    const result = await api(`/sessions/${encodeURIComponent(id)}/turns`, body);
    adoptTurn(result);
    if (kind !== 'advance' && state.draft === submittedDraft) state.draft = '';
    if (result.turn.status === 'running') monitorTurn(result.turn.id);
  });
}

async function exportSession() {
  if (!state.session) return;
  await operation('Exporting…', async () => {
    const data = await api(`/sessions/${encodeURIComponent(state.session.id)}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `school-lesson-${state.session.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.notice = 'Your notebook export includes this conversation and lesson state. Keep it private if it contains personal information.';
  });
}

function updateDiagram() {
  const visual = document.querySelector('#artifact-visual');
  const metrics = document.querySelector('#artifact-metrics');
  if (visual) visual.innerHTML = scaleDiagram(state.dimensions);
  if (metrics) metrics.innerHTML = `<div><span>VOLUME</span><strong>${numberLabel(volumeOf(state.dimensions))}<small> unit³</small></strong></div><div><span>VS. UNIT CUBE</span><strong>${numberLabel(volumeOf(state.dimensions))}<small> ×</small></strong></div>`;
  const artifactState = document.querySelector('#artifact-state');
  const dirty = !dimensionsEqual(state.dimensions, state.session.artifact.dimensions);
  if (artifactState) { artifactState.textContent = dirty ? 'Preview only — apply to share this result with your mentor.' : `Recorded: ${state.session.artifact.dimensions.map(numberLabel).join(' × ')} browser units.`; artifactState.classList.toggle('preview', dirty); }
}

app.addEventListener('input', event => {
  if (event.target.dataset.matrixField) { matrixPanel.input(event.target.dataset.matrixField, event.target.value); return; }
  if (event.target.id === 'message-input') {
    state.draft = event.target.value;
    const send = document.querySelector('#send-message'); if (send) send.disabled = !state.draft.trim() || state.busy;
  }
  if (event.target.dataset.dimension !== undefined) {
    const index = Number(event.target.dataset.dimension); state.dimensions[index] = Number(event.target.value);
    document.querySelector(`#dimension-output-${index}`).textContent = numberLabel(state.dimensions[index]); updateDiagram();
  }
});

app.addEventListener('keydown', event => {
  if (event.target.id === 'message-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendTurn(state.intent, state.draft); }
});
app.addEventListener('submit', event => { if (event.target.id === 'message-form') { event.preventDefault(); sendTurn(state.intent, state.draft); } });

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'speech-stop') { mentorSpeech.stop(); return; }
  if (action === 'speech-play') { if (!state.busy && state.turn?.status !== 'running') mentorSpeech.play(); return; }
  if (action === 'dismiss-error') { state.error = ''; state.retry = null; render(); return; }
  if (action === 'retry') { const retry = state.retry; state.error = ''; state.retry = null; await retry?.(); return; }
  if (action === 'bootstrap') { await bootstrap(); return; }
  if (action === 'home') { if (state.busy || state.turn?.status === 'running') return; stopPolling(); matrixPanel.hide(); state.session = null; state.turn = null; state.error = ''; state.notice = ''; render(); window.scrollTo({ top: 0 }); return; }
  if (state.busy) return;
  if (action.startsWith('matrix-')) {
    await matrixPanel.action(action.slice(7), button.dataset);
    if (['matrix-scene-build', 'matrix-scene-check'].includes(action)) document.querySelector('#matrix-panel-title')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'mentor') { state.selectedMentor = button.dataset.id; state.selectedLesson = state.catalog.lessons.find(lesson => lesson.mentorId === state.selectedMentor)?.id || ''; render(); }
  if (action === 'lesson') { state.selectedLesson = button.dataset.id; render(); }
  if (action === 'start') {
    const body = { requestId: makeRequestId(), mentorId: state.selectedMentor, lessonId: state.selectedLesson };
    await operation('Preparing your lesson…', async () => { const { session } = await api('/sessions', body); adoptSession(session, { reset: true }); state.turn = null; window.scrollTo({ top: 0 }); });
  }
  if (action === 'resume') { await refreshSession(button.dataset.id); window.scrollTo({ top: 0 }); }
  if (action === 'refresh-sessions') await operation('Refreshing…', async () => { state.sessions = (await api('/sessions')).sessions; });
  if (action === 'intent') { state.intent = button.dataset.value; render(); document.querySelector('#message-input')?.focus(); }
  if (action === 'suggestion') { state.intent = 'question'; state.draft = button.dataset.text; render(); document.querySelector('#message-input')?.focus(); }
  if (action === 'advance') sendTurn('advance');
  if (action === 'preset') { state.dimensions = normalDimensions(button.dataset.values.split(',').map(Number)); render(); }
  if (action === 'experiment') {
    const body = { requestId: makeRequestId(), expectedRevision: state.session.revision, dimensions: [...state.dimensions] };
    const id = state.session.id;
    await operation('Recording experiment…', async () => { const { session } = await api(`/sessions/${encodeURIComponent(id)}/experiment`, body); adoptSession(session); state.notice = 'Experiment recorded. Your mentor can now discuss this simulated result.'; });
  }
  if (action === 'cancel' && state.turn) {
    mentorSpeech.stop();
    const id = state.turn.id; const body = { requestId: makeRequestId() };
    await operation('Stopping…', async () => { const result = await api(`/turns/${encodeURIComponent(id)}/cancel`, body); stopPolling(); adoptSession(result.session); state.turn = result.turn; state.notice = result.turn.status === 'cancelled' ? 'Response stopped. The lesson step has not advanced.' : 'The response finished before it could be stopped. Its recorded result is shown.'; });
  }
  if (action === 'export') await exportSession();
});

window.addEventListener?.('pagehide', () => mentorSpeech.stop());
document.addEventListener?.('visibilitychange', () => { if (document.hidden) mentorSpeech.stop(); });
void bootstrap();
