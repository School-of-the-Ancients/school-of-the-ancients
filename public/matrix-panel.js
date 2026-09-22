import { escapeHtml as h, makeRequestId } from './client-core.js';

const ACTIVE = new Set(['submitting', 'planning', 'ready', 'queued', 'running']);
const BLOCKING = new Set([...ACTIVE, 'unconfirmed']);
const LABELS = { submitting: 'Preparing request', planning: 'Preparing proposal', ready: 'Waiting for Operator review', queued: 'Approved · waiting for the runtime', running: 'Runtime is processing', succeeded: 'Runtime confirmed', failed: 'Runtime reported failure', partial: 'Some commands failed', cancelled: 'Cancelled before Apply', stale: 'Scene changed', unconfirmed: 'Outcome unconfirmed', needs_clarification: 'Placement needs clarification', review_only: 'Review only', error: 'Request failed' };

export function safeOperatorUrl(value) {
  try {
    const url = new URL(value);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/clients') return null;
    return url.href;
  } catch { return null; }
}

/** Optional UI adapter. It never contacts Matrix directly or receives its bearer token. */
export function createMatrixPanel({ api, getSession, onSession, onChange, requestId = makeRequestId, pollDelay = 1500, pollLimit = 120000 }) {
  let sessionId = null; let result = null; let open = false; let busy = false; let error = '';
  let origin = 'http://127.0.0.1:8789'; let pairingCode = ''; let timer; let generation = 0; let pollingStarted = 0;
  let retry = null; let pendingDescription = ''; let sceneSubmission = null;
  const changed = () => onChange?.();
  function stop() { clearTimeout(timer); generation++; }
  function select(session) {
    if (sessionId === session?.id) return;
    stop(); sessionId = session?.id ?? null; result = null; open = false; busy = false; error = ''; retry = null; pairingCode = ''; pollingStarted = 0; sceneSubmission = null;
  }
  function adopt(value, id) {
    if (sessionId !== id || getSession()?.id !== id) return false;
    if (!value?.session || value.session.id !== id || !value.bridge || !Number.isSafeInteger(value.session.revision)) throw new Error('The connection returned an incompatible lesson record.');
    if (value.session.revision < getSession().revision) return false;
    result = value; onSession(value.session); return true;
  }
  function path(id) { return `/sessions/${encodeURIComponent(id)}/matrix`; }
  function records(bridge = result?.bridge) { return [...(bridge?.demonstrations ?? []), ...(bridge?.experiments ?? []), ...(bridge?.sceneBuilds ?? [])]; }
  function pendingRequest() {
    for (const collection of ['demonstrations', 'experiments', 'sceneBuilds']) {
      const item = result?.bridge?.[collection]?.find(value => ACTIVE.has(value.status));
      if (item) return { ...item, collection: collection === 'sceneBuilds' ? 'scene-builds' : collection };
    }
    return null;
  }
  async function refreshAfterOutcome(value, id) {
    const outcome = value.sceneBuild ?? value.experiment ?? value.demonstration;
    if (outcome && !BLOCKING.has(outcome.status) && value.bridge.connected) {
      // Reading fresh readiness is safe after completion; it never submits another action.
      const refreshed = await api(path(id));
      adopt(refreshed, id);
    }
  }
  async function perform(label, task, { allowRetry = false } = {}) {
    if (busy) return;
    const id = sessionId; busy = true; error = ''; retry = null; pendingDescription = label; changed();
    try {
      const value = await task();
      let accepted = adopt(value, id);
      if (!accepted && sessionId === id && getSession()?.id === id) accepted = adopt(await api(path(id)), id);
      if (accepted) { await refreshAfterOutcome(value, id); error = ''; retry = null; schedule(); }
    }
    catch (failure) {
      if (sessionId !== id) return;
      error = failure.message || 'The Matrix connection could not be checked.';
      if (failure.uncertain) error += ' The request may already exist. Check its result before requesting another scene change.';
      if (allowRetry && (!failure.status || failure.status >= 500)) retry = () => perform(label, task, { allowRetry });
    } finally { if (sessionId === id) { busy = false; pendingDescription = ''; changed(); } }
  }
  async function refresh() {
    const id = sessionId;
    await perform('Checking Matrix…', () => api(path(id)), { allowRetry: true });
  }
  function schedule() {
    clearTimeout(timer);
    if (!open || !result?.bridge?.connected || !pendingRequest()) return;
    if (!pollingStarted) pollingStarted = Date.now();
    if (Date.now() - pollingStarted > pollLimit) { error = 'This demonstration is still pending. Check its result or inspect it in Matrix.'; return; }
    const currentGeneration = generation; const id = sessionId;
    timer = setTimeout(async () => {
      if (currentGeneration !== generation || getSession()?.id !== id || !open) return;
      if (busy) { schedule(); return; }
      const item = pendingRequest();
      if (!item) return;
      try {
        const value = await api(`${path(id)}/${item.collection}/${encodeURIComponent(item.id)}`);
        if (currentGeneration !== generation) return;
        adopt(value, id); await refreshAfterOutcome(value, id);
        if (currentGeneration !== generation) return;
        changed(); schedule();
      } catch (failure) {
        if (currentGeneration !== generation) return;
        error = `${failure.message || 'Could not check the result.'} No request was repeated. Use Check result to reconcile it.`; changed();
      }
    }, pollDelay);
  }
  function input(field, value) {
    if (field === 'origin') origin = value;
    if (field === 'code') pairingCode = value;
  }
  async function action(name, data = {}) {
    const session = getSession(); if (!session) return;
    select(session);
    if (name === 'open') { open = true; pollingStarted = 0; await refresh(); return; }
    if (name === 'close') { open = false; pairingCode = ''; stop(); changed(); return; }
    if (name === 'retry') { const task = retry; retry = null; await task?.(); return; }
    if (busy) return;
    if (name === 'refresh') { pollingStarted = 0; await refresh(); return; }
    if (name === 'pair') {
      if (!pairingCode.trim()) { error = 'Enter the temporary pairing code from Matrix.'; changed(); return; }
      const id = session.id;
      const body = { requestId: requestId(), expectedRevision: session.revision, url: origin.trim(), pairingCode: pairingCode.trim() };
      pairingCode = ''; pollingStarted = 0;
      // A retry keeps the same one-use code and durable School request ID in memory.
      await perform('Connecting…', () => api(`${path(id)}/pair`, body), { allowRetry: true });
    }
    if (name === 'request') {
      const bridge = result?.bridge; const request = bridge?.readiness?.matrixRequest;
      if (!bridge?.connected || !bridge.readiness?.canLaunch || !request || !bridge.binding || session.status !== 'active' || records(bridge).some(item => BLOCKING.has(item.status))) return;
      const id = session.id;
      const body = { requestId: requestId(), expectedRevision: session.revision, bindingId: bridge.binding.id, expectedMatrixRevision: request.revision };
      pollingStarted = 0;
      await perform('Requesting a block…', () => api(`${path(id)}/demonstrations`, body), { allowRetry: true });
    }
    if (name === 'check' && typeof data.id === 'string') {
      const id = session.id; pollingStarted = 0;
      await perform('Checking the recorded request…', () => api(`${path(id)}/demonstrations/${encodeURIComponent(data.id)}`), { allowRetry: true });
    }
    if (name === 'cancel' && typeof data.id === 'string') {
      const id = session.id; const body = { requestId: requestId() };
      await perform('Cancelling before Apply…', () => api(`${path(id)}/demonstrations/${encodeURIComponent(data.id)}/cancel`, body), { allowRetry: true });
    }
    if (name === 'disconnect') {
      const id = session.id; const body = { requestId: requestId(), expectedRevision: session.revision }; stop();
      await perform('Disconnecting…', () => api(`${path(id)}/disconnect`, body), { allowRetry: true });
    }
    if (name === 'scene-build') {
      const suggestion = latestSceneSuggestion(session);
      if (!suggestion || data.turnId !== suggestion.turnId || session.status !== 'active' || session.activeTurnId || suggestion.stage !== session.stage) return;
      const bridge = result?.bridge;
      const existing = (bridge?.sceneBuilds ?? session.matrix?.sceneBuilds ?? []).find(item => item.turnId === suggestion.turnId);
      open = true;
      if (existing) {
        const id = session.id; pollingStarted = 0;
        await perform('Checking the demonstration…', () => api(`${path(id)}/scene-builds/${encodeURIComponent(existing.id)}`), { allowRetry: true });
        return;
      }
      // Opening or pairing a connection never dispatches the suggestion. A second
      // explicit learner action is needed after current readiness is available.
      if (!bridge?.connected) { pollingStarted = 0; await refresh(); return; }
      if (!bridge.sceneBuilder?.available || !bridge.binding || !Number.isSafeInteger(bridge.sceneBuilder.expectedMatrixRevision)
        || records(bridge).some(item => BLOCKING.has(item.status))) { changed(); return; }
      const id = session.id;
      if (!sceneSubmission || sceneSubmission.turnId !== suggestion.turnId) sceneSubmission = {
        turnId: suggestion.turnId,
        body: { requestId: requestId(), expectedRevision: session.revision, bindingId: bridge.binding.id,
          expectedMatrixRevision: bridge.sceneBuilder.expectedMatrixRevision, turnId: suggestion.turnId },
      };
      const submission = sceneSubmission;
      pollingStarted = 0;
      await perform('Sending the scene request for Matrix planning…', async () => {
        try { return await api(`${path(id)}/scene-builds`, submission.body); }
        catch (failure) {
          // Definite rejection can be corrected with a newly reviewed request;
          // transport uncertainty retains this exact identity and payload.
          if (failure.status >= 400 && failure.status < 500 && !failure.uncertain && sceneSubmission === submission) sceneSubmission = null;
          throw failure;
        }
      }, { allowRetry: true });
      return;
    }
    if (name === 'scene-check' && typeof data.id === 'string') {
      const id = session.id; open = true; pollingStarted = 0;
      await perform('Checking the demonstration…', () => api(`${path(id)}/scene-builds/${encodeURIComponent(data.id)}`), { allowRetry: true });
    }
    if (name === 'scene-cancel' && typeof data.id === 'string') {
      const id = session.id; const body = { requestId: requestId() };
      await perform('Cancelling before Apply…', () => api(`${path(id)}/scene-builds/${encodeURIComponent(data.id)}/cancel`, body), { allowRetry: true });
    }
    if (name === 'scale' || name === 'scale-reset') {
      const bridge = result?.bridge; const scale = bridge?.scale;
      if (!bridge?.connected || !scale?.available || !bridge.binding || !scale.demonstrationId || !Number.isSafeInteger(scale.expectedMatrixRevision)
        || session.status !== 'active' || records(bridge).some(item => BLOCKING.has(item.status))) return;
      const resetting = name === 'scale-reset';
      if (resetting && !scale.latestExperimentId) return;
      const factors = resetting ? null : String(data.factors ?? '').split(',').map(Number);
      if (!resetting && (factors.length !== 3 || factors.some(value => !Number.isFinite(value) || value < .25 || value > 4))) return;
      const id = session.id;
      const body = { requestId: requestId(), expectedRevision: session.revision, bindingId: bridge.binding.id,
        expectedMatrixRevision: scale.expectedMatrixRevision, demonstrationId: scale.demonstrationId,
        action: resetting ? 'reset' : 'configure', ...(resetting ? { baselineExperimentId: scale.latestExperimentId }
          : { factors: { x: factors[0], y: factors[1], z: factors[2] } }) };
      pollingStarted = 0;
      await perform(resetting ? 'Proposing a reset…' : 'Proposing a scale experiment…', () => api(`${path(id)}/experiments`, body), { allowRetry: true });
    }
    if (name === 'scale-check' && typeof data.id === 'string') {
      const id = session.id; pollingStarted = 0;
      await perform('Checking the experiment…', () => api(`${path(id)}/experiments/${encodeURIComponent(data.id)}`), { allowRetry: true });
    }
    if (name === 'scale-cancel' && typeof data.id === 'string') {
      const id = session.id; const body = { requestId: requestId() };
      await perform('Cancelling before Apply…', () => api(`${path(id)}/experiments/${encodeURIComponent(data.id)}/cancel`, body), { allowRetry: true });
    }
  }

  function latestSceneSuggestion(session) {
    const message = session?.messages?.findLast(item => item.role === 'mentor');
    const intent = message?.demonstration;
    if (!message?.turnId || typeof message.turnId !== 'string' || !intent || intent.kind !== 'matrix-scene'
      || ![['title', 120], ['learningGoal', 500], ['prompt', 2000]].every(([key, max]) => typeof intent[key] === 'string' && intent[key].trim() && intent[key].length <= max)) return null;
    return message;
  }
  function sceneBuild(item, bindings) {
    const binding = bindings.find(value => value.id === item.bindingId);
    const operatorUrl = safeOperatorUrl(binding ? binding.origin + '/clients' : null);
    const observed = item.observed;
    const counts = observed?.source === 'matrix-runtime' && Number.isSafeInteger(observed.confirmedCommandCount) && observed.confirmedCommandCount >= 0
      && Number.isSafeInteger(observed.failedCommandCount) && observed.failedCommandCount >= 0 && observed.confirmedCommandCount + observed.failedCommandCount > 0
      && observed.confirmedCommandCount + observed.failedCommandCount <= 20;
    const allConfirmed = item.status === 'succeeded' && counts && observed.failedCommandCount === 0 && observed.confirmedCommandCount > 0;
    const partial = item.status === 'partial' && counts && observed.confirmedCommandCount > 0 && observed.failedCommandCount > 0;
    const saved = item.status === 'succeeded' && observed?.source === 'matrix-pc-save' && typeof observed.savedScene === 'string' && observed.savedScene.length > 0;
    const failed = item.status === 'failed' && counts && observed.confirmedCommandCount === 0 && observed.failedCommandCount > 0;
    const label = saved ? 'Matrix save confirmed' : item.status === 'succeeded' && !allConfirmed ? 'Outcome unconfirmed' : LABELS[item.status] || 'Unknown outcome';
    const evidence = allConfirmed ? `Matrix acknowledged all ${observed.confirmedCommandCount} command${observed.confirmedCommandCount === 1 ? '' : 's'} in this demonstration. This records the runtime result; it does not establish physical measurements or learning mastery.`
      : partial ? `Matrix acknowledged ${observed.confirmedCommandCount} successful commands and ${observed.failedCommandCount} failed commands. This demonstration is only partly completed; inspect the original Matrix request.`
      : failed ? `Matrix reported ${observed.failedCommandCount} failed commands and no successful commands. Inspect the original request before continuing.`
      : saved ? `Matrix confirmed a PC scene save: ${observed.savedScene}. A saved scene is not proof of runtime placement or physical observation.`
      : item.status === 'ready' ? 'A proposal is ready for your review. Nothing is confirmed as built yet. Inspect the commands and choose Apply in the Matrix Operator.'
      : ['submitting', 'planning'].includes(item.status) ? 'Matrix is preparing the proposal. This is planning, not a completed demonstration.'
      : item.status === 'unconfirmed' ? 'School cannot confirm what happened. Check this original request or inspect its Matrix Operator before sending another scene change.'
      : item.status === 'cancelled' ? 'The proposal was cancelled before Apply. No completed demonstration is claimed.'
      : 'No completed demonstration is confirmed yet. Check this original request for its result.';
    return `<article class="matrix-demonstration matrix-scene-build"><div class="matrix-result-heading"><strong>${h(label)}</strong><span>${h(item.intent?.title || 'Mentor demonstration')}</span></div>
      ${!allConfirmed && !saved && item.proposalSummary ? `<p>${h(item.proposalSummary)}</p>` : ''}<p>${h(evidence)}</p>
      ${item.error ? `<p class="matrix-warning">${h(item.error)}</p>` : ''}${item.checkError ? `<p class="matrix-warning">${h(item.checkError)}</p>` : ''}
      <div class="matrix-actions">${operatorUrl ? `<a class="button button-small button-secondary" href="${h(operatorUrl)}" target="_blank" rel="noopener noreferrer">${item.status === 'ready' ? 'Review in Matrix' : 'Inspect original Matrix'} ↗</a>` : ''}
      <button class="text-button" data-action="matrix-scene-check" data-id="${h(item.id)}" ${busy ? 'disabled' : ''}>Check demonstration</button>
      ${['planning', 'ready'].includes(item.status) ? `<button class="text-button" data-action="matrix-scene-cancel" data-id="${h(item.id)}" ${busy ? 'disabled' : ''}>Cancel before Apply</button>` : ''}</div></article>`;
  }
  function renderSuggestion(session, { lessonBusy = false } = {}) {
    select(session);
    const message = latestSceneSuggestion(session);
    if (!message) return '';
    const intent = message.demonstration;
    const bridge = result?.bridge;
    const builds = bridge?.sceneBuilds ?? session.matrix?.sceneBuilds ?? [];
    const existing = builds.find(item => item.turnId === message.turnId);
    const submitted = sceneSubmission?.turnId === message.turnId;
    const changedStage = message.stage !== session.stage;
    const blocked = records(bridge ?? session.matrix).some(item => BLOCKING.has(item.status));
    const unavailable = session.status !== 'active' || changedStage || lessonBusy || session.activeTurnId || busy
      || !existing && (blocked || bridge?.connected && !bridge.sceneBuilder?.available);
    const reason = changedStage ? 'This suggestion belongs to an earlier lesson step. Ask Galileo for a current demonstration.'
      : session.status !== 'active' ? 'This completed lesson is preserved. Start a new lesson for another demonstration.'
      : existing ? '' : submitted ? 'This request was sent, but its result is not confirmed here. Retry the same request to reconcile it; another build will not be submitted.'
      : blocked ? 'Reconcile the pending Matrix request before sending another demonstration.'
      : bridge?.connected ? bridge.sceneBuilder?.reason || 'Refresh Matrix readiness before sending this suggestion.'
      : 'Connect Matrix first. Opening the connection does not send this suggestion; choose Build this demonstration again when it is ready.';
    return `<section class="mentor-demonstration" aria-label="Suggested Matrix demonstration"><p class="eyebrow">${existing || submitted ? 'GALILEO’S DEMONSTRATION REQUEST' : 'GALILEO’S SUGGESTION · NOT BUILT YET'}</p><h3>${h(intent.title)}</h3><p>${h(intent.learningGoal)}</p><div class="mentor-scene-request"><strong>Scene request</strong><p>${h(intent.prompt)}</p></div>
      ${busy ? `<p role="status">${h(pendingDescription)}</p>` : ''}
      ${existing ? sceneBuild(existing, session.matrix?.bindings ?? []) : `<button class="button button-small button-secondary" data-action="matrix-scene-build" data-turn-id="${h(message.turnId)}" ${unavailable ? 'disabled' : ''}>${submitted ? busy ? 'Sending request…' : 'Retry the same request' : 'Build this demonstration'}</button>`}
      ${reason ? `<p class="matrix-footnote">${h(reason)}</p>` : ''}<p class="matrix-footnote">Matrix plans the scene and you review and Apply there. This does not change the browser experiment or lesson step. AR requires a connected headset and aligned room.</p></section>`;
  }

  function scaleExperiment(item, bindings) {
    const binding = bindings.find(value => value.id === item.bindingId);
    const operatorUrl = safeOperatorUrl(binding ? binding.origin + '/clients' : null);
    const observed = item.observed;
    const confirmed = item.status === 'succeeded' && observed?.source === 'acknowledged-runtime-transform'
      && observed.physicalMeasurement === false && Number.isFinite(observed.mathematicalVolumeRatio) && observed.mathematicalVolumeRatio > 0;
    return `<article class="matrix-demonstration"><div class="matrix-result-heading"><strong>${h(LABELS[item.status] || 'Unknown outcome')}</strong><span>${item.action === 'reset' ? 'Reset block' : 'Scale block'}</span></div>
      ${!confirmed && item.proposalSummary ? `<p>${h(item.proposalSummary)}</p>` : ''}${confirmed ? `<p><strong>Confirmed ratio: ${h(Number(observed.mathematicalVolumeRatio.toPrecision(6)))}× the original baseline.</strong> Calculated from the acknowledged transform; not physical volume.</p>` : '<p>No confirmed experiment result yet. A proposal or approval alone is not an observation.</p>'}
      ${item.error ? `<p class="matrix-warning">${h(item.error)}</p>` : ''}${item.checkError ? `<p class="matrix-warning">${h(item.checkError)}</p>` : ''}
      <div class="matrix-actions">${item.status === 'ready' && operatorUrl ? `<a class="button button-small button-secondary" href="${h(operatorUrl)}" target="_blank" rel="noopener noreferrer">Review in Matrix ↗</a>` : ''}
      <button class="text-button" data-action="matrix-scale-check" data-id="${h(item.id)}" ${busy ? 'disabled' : ''}>Check experiment</button>
      ${['ready', 'planning'].includes(item.status) && item.requiresApply ? `<button class="text-button" data-action="matrix-scale-cancel" data-id="${h(item.id)}" ${busy ? 'disabled' : ''}>Cancel experiment proposal</button>` : ''}</div></article>`;
  }

  function scaleControls(session, bridge, experiments, lessonBusy) {
    const scale = bridge?.scale;
    const canConfigure = bridge?.connected && scale?.available && session.status === 'active' && !busy && !lessonBusy && !records(bridge).some(item => BLOCKING.has(item.status));
    return `<section class="matrix-scale" aria-label="Matrix scale experiment"><h3>Try scale in Matrix</h3><p>Change the block placed by this lesson in Matrix’s desktop white room. Each preset uses the original captured size. Review every change and reset in the Operator.</p>
      <div class="matrix-actions"><button class="button button-small button-secondary" data-action="matrix-scale" data-factors="2,2,2" ${canConfigure ? '' : 'disabled'}>Double every side in Matrix</button>
      <button class="text-button" data-action="matrix-scale" data-factors="2,1,1" ${canConfigure ? '' : 'disabled'}>Double width in Matrix</button>
      <button class="text-button" data-action="matrix-scale" data-factors="2,0.5,1" ${canConfigure ? '' : 'disabled'}>Double width, halve height</button>
      <button class="text-button" data-action="matrix-scale-reset" ${canConfigure && scale?.latestExperimentId ? '' : 'disabled'}>Reset Matrix block</button></div>
      <p>${h(scale?.reason || 'Connect a compatible Matrix service and confirm a block placement to prepare this experiment.')}</p>
      <p class="matrix-footnote">These are separate Matrix requests. They do not change your recorded browser experiment or lesson step. Quest AR scaling is not available in this version.</p>
      ${experiments.length ? `<div class="matrix-history"><h4>Matrix experiment history</h4>${[...experiments].reverse().map(item => scaleExperiment(item, session.matrix?.bindings ?? [])).join('')}</div>` : ''}</section>`;
  }
  function demonstration(item, bindings) {
    const binding = bindings.find(value => value.id === item.bindingId);
    const operatorUrl = safeOperatorUrl(binding ? binding.origin + '/clients' : null);
    const canCancel = ['ready', 'planning'].includes(item.status) && item.requiresApply;
    const observed = item.observed?.objects || [];
    return `<article class="matrix-demonstration"><div class="matrix-result-heading"><strong>${h(LABELS[item.status] || 'Unknown outcome')}</strong><span>${h(item.exhibit?.version ? `Exhibit ${item.exhibit.version}` : '')}</span></div>${item.proposalSummary ? `<p>${h(item.proposalSummary)}</p>` : ''}${item.status === 'ready' ? '<p>The block is only proposed. Open Matrix, inspect the commands, and choose Apply there.</p>' : ''}${item.status === 'unconfirmed' ? '<p>Do not assume the block appeared or disappeared. Inspect Matrix before making another request.</p>' : ''}${observed.length ? `<p>Runtime evidence: ${observed.map(value => `${h(value.assetId)} (${h(value.objectId)})`).join(', ')}. This is not a physical volume measurement.</p>` : ''}${item.error ? `<p class="matrix-warning">${h(item.error)}</p>` : ''}${item.checkError ? `<p class="matrix-warning">${h(item.checkError)}</p>` : ''}<div class="matrix-actions">${item.status === 'ready' && operatorUrl ? `<a class="button button-small button-secondary" href="${h(operatorUrl)}" target="_blank" rel="noopener noreferrer">Review in Matrix ↗</a>` : ''}<button class="text-button" data-action="matrix-check" data-id="${h(item.id)}" ${busy ? 'disabled' : ''}>Check result</button>${canCancel ? `<button class="text-button" data-action="matrix-cancel" data-id="${h(item.id)}" ${busy ? 'disabled' : ''}>Cancel proposal</button>` : ''}</div></article>`;
  }
  function readinessNotes(issues) {
    const blocking = issues.filter(issue => issue.blocking);
    const optional = issues.filter(issue => !issue.blocking);
    return `${blocking.length ? `<ul class="matrix-readiness">${blocking.map(issue => `<li class="blocking"><strong>${h(issue.message)}</strong><span>${h(issue.remedy || '')}</span></li>`).join('')}</ul>` : ''}${optional.length ? `<details class="matrix-limitations"><summary>What this connection supports</summary><p>This first connection places an installed block after Operator review. Voice, an animated mentor, and camera images are separate features.</p><ul class="matrix-readiness">${optional.map(issue => `<li>${h(issue.code === 'builtin_identity_limited' ? 'Matrix reports that the block is installed. Check the preview in Operator; this connection cannot verify which build supplied it.' : issue.remedy || issue.message)}</li>`).join('')}</ul></details>` : ''}`;
  }
  function render(session, { lessonBusy = false } = {}) {
    select(session);
    const bridge = result?.bridge; const readiness = bridge?.readiness;
    const operatorUrl = safeOperatorUrl(bridge?.operatorUrl);
    const demos = bridge?.demonstrations ?? session.matrix?.demonstrations ?? [];
    const experiments = bridge?.experiments ?? session.matrix?.experiments ?? [];
    const builds = bridge?.sceneBuilds ?? session.matrix?.sceneBuilds ?? [];
    const pending = [...demos, ...experiments, ...builds].find(item => BLOCKING.has(item.status));
    const status = pending ? LABELS[pending.status] : !result ? (session.matrix?.activeBindingId ? 'Connection not checked' : 'Not connected') : bridge?.connected ? (readiness?.canLaunch ? 'Ready to request' : readiness ? 'Needs preparation' : 'Refresh readiness') : 'Not connected';
    const canRequest = bridge?.connected && readiness?.canLaunch && !busy && !lessonBusy && session.status === 'active' && !pending;
    return `<section class="matrix-panel" aria-labelledby="matrix-panel-title"><div class="matrix-panel-heading"><div><span class="eyebrow">OPTIONAL · YOUR MATRIX SCENE</span><h2 id="matrix-panel-title">Take the idea into your room.</h2></div><span class="pill">${h(status)}</span></div><p class="matrix-intro">Send the mentor scene suggestion or request a prepared block in Matrix, then discuss the acknowledged result. Your browser experiment and lesson still work on their own.</p>${!open ? '<button class="text-button" data-action="matrix-open">Open Matrix connection</button>' : `<div class="matrix-panel-content">${error ? `<div class="matrix-warning" role="alert">${h(error)}${retry ? '<button class="text-button" data-action="matrix-retry">Retry the same request</button>' : ''}</div>` : ''}${busy ? `<p role="status">${h(pendingDescription)}</p>` : ''}${bridge?.connected ? `<p>${h(bridge.reason || 'Connected to the local Matrix service.')}</p><div class="matrix-actions"><button class="button button-small" data-action="matrix-request" ${canRequest ? '' : 'disabled'}>Request a block in Matrix</button><button class="text-button" data-action="matrix-refresh" ${busy ? 'disabled' : ''}>Refresh readiness</button><button class="text-button" data-action="matrix-disconnect" ${busy || lessonBusy ? 'disabled' : ''}>Disconnect</button>${operatorUrl ? `<a href="${h(operatorUrl)}" target="_blank" rel="noopener noreferrer">Open Operator ↗</a>` : ''}</div>` : `<p>${h(bridge?.reason || 'Use a temporary pairing code from Matrix’s Client connections page. The two apps keep their own records.')}</p><div class="matrix-pair-fields"><label for="matrix-origin">Matrix address<input id="matrix-origin" data-matrix-field="origin" type="url" value="${h(origin)}" autocomplete="off" spellcheck="false" ${busy ? 'disabled' : ''}></label><label for="matrix-code">Temporary pairing code<input id="matrix-code" data-matrix-field="code" type="password" value="${h(pairingCode)}" autocomplete="off" spellcheck="false" ${busy ? 'disabled' : ''}></label><button class="button button-small button-secondary" data-action="matrix-pair" ${busy || lessonBusy || session.status !== 'active' ? 'disabled' : ''}>Connect Matrix</button></div><p class="matrix-footnote">Use the temporary code, not the Operator service token. You can continue this lesson without connecting.</p>`}${readinessNotes(readiness?.issues ?? [])}${builds.length ? `<div class="matrix-history"><h3>Mentor demonstration history</h3>${[...builds].reverse().map(item => sceneBuild(item, session.matrix?.bindings ?? [])).join('')}</div>` : ''}${scaleControls(session, bridge, experiments, lessonBusy)}${demos.length ? `<div class="matrix-history"><h3>Demonstration history</h3>${[...demos].reverse().map(item => demonstration(item, session.matrix?.bindings ?? [])).join('')}</div>` : ''}<p class="matrix-footnote">Matrix requires its own Operator review before an action runs. Approved actions may still finish after disconnection. A runtime acknowledgment does not advance this lesson or assess mastery.</p><button class="text-button" data-action="matrix-close">Close connection panel</button></div>`}</section>`;
  }
  return { render, renderSuggestion, action, input, hide() { stop(); open = false; pairingCode = ''; retry = null; }, destroy: stop };
}
