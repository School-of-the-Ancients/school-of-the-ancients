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
  let retry = null; let pendingDescription = '';
  const changed = () => onChange?.();
  function stop() { clearTimeout(timer); generation++; }
  function select(session) {
    if (sessionId === session?.id) return;
    stop(); sessionId = session?.id ?? null; result = null; open = false; busy = false; error = ''; retry = null; pairingCode = ''; pollingStarted = 0;
  }
  function adopt(value, id) {
    if (sessionId !== id || getSession()?.id !== id) return false;
    if (!value?.session || value.session.id !== id || !value.bridge || !Number.isSafeInteger(value.session.revision)) throw new Error('The connection returned an incompatible lesson record.');
    if (value.session.revision < getSession().revision) return false;
    result = value; onSession(value.session); return true;
  }
  function path(id) { return `/sessions/${encodeURIComponent(id)}/matrix`; }
  function records(bridge = result?.bridge) { return [...(bridge?.demonstrations ?? []), ...(bridge?.experiments ?? [])]; }
  function pendingRequest() {
    for (const collection of ['demonstrations', 'experiments']) {
      const item = result?.bridge?.[collection]?.find(value => ACTIVE.has(value.status));
      if (item) return { ...item, collection };
    }
    return null;
  }
  async function refreshAfterOutcome(value, id) {
    const outcome = value.experiment ?? value.demonstration;
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
    const pending = [...demos, ...experiments].find(item => BLOCKING.has(item.status));
    const status = pending ? LABELS[pending.status] : !result ? (session.matrix?.activeBindingId ? 'Connection not checked' : 'Not connected') : bridge?.connected ? (readiness?.canLaunch ? 'Ready to request' : readiness ? 'Needs preparation' : 'Refresh readiness') : 'Not connected';
    const canRequest = bridge?.connected && readiness?.canLaunch && !busy && !lessonBusy && session.status === 'active' && !pending;
    return `<section class="matrix-panel" aria-labelledby="matrix-panel-title"><div class="matrix-panel-heading"><div><span class="eyebrow">OPTIONAL · YOUR MATRIX SCENE</span><h2 id="matrix-panel-title">Take the idea into your room.</h2></div><span class="pill">${h(status)}</span></div><p class="matrix-intro">Request a block in the connected Matrix scene, then discuss the acknowledged result. Your browser experiment and lesson still work on their own.</p>${!open ? '<button class="text-button" data-action="matrix-open">Open Matrix connection</button>' : `<div class="matrix-panel-content">${error ? `<div class="matrix-warning" role="alert">${h(error)}${retry ? '<button class="text-button" data-action="matrix-retry">Retry the same request</button>' : ''}</div>` : ''}${busy ? `<p role="status">${h(pendingDescription)}</p>` : ''}${bridge?.connected ? `<p>${h(bridge.reason || 'Connected to the local Matrix service.')}</p><div class="matrix-actions"><button class="button button-small" data-action="matrix-request" ${canRequest ? '' : 'disabled'}>Request a block in Matrix</button><button class="text-button" data-action="matrix-refresh" ${busy ? 'disabled' : ''}>Refresh readiness</button><button class="text-button" data-action="matrix-disconnect" ${busy || lessonBusy ? 'disabled' : ''}>Disconnect</button>${operatorUrl ? `<a href="${h(operatorUrl)}" target="_blank" rel="noopener noreferrer">Open Operator ↗</a>` : ''}</div>` : `<p>${h(bridge?.reason || 'Use a temporary pairing code from Matrix’s Client connections page. The two apps keep their own records.')}</p><div class="matrix-pair-fields"><label for="matrix-origin">Matrix address<input id="matrix-origin" data-matrix-field="origin" type="url" value="${h(origin)}" autocomplete="off" spellcheck="false" ${busy ? 'disabled' : ''}></label><label for="matrix-code">Temporary pairing code<input id="matrix-code" data-matrix-field="code" type="password" value="${h(pairingCode)}" autocomplete="off" spellcheck="false" ${busy ? 'disabled' : ''}></label><button class="button button-small button-secondary" data-action="matrix-pair" ${busy || lessonBusy || session.status !== 'active' ? 'disabled' : ''}>Connect Matrix</button></div><p class="matrix-footnote">Use the temporary code, not the Operator service token. You can continue this lesson without connecting.</p>`}${readinessNotes(readiness?.issues ?? [])}${scaleControls(session, bridge, experiments, lessonBusy)}${demos.length ? `<div class="matrix-history"><h3>Demonstration history</h3>${[...demos].reverse().map(item => demonstration(item, session.matrix?.bindings ?? [])).join('')}</div>` : ''}<p class="matrix-footnote">Matrix requires its own Operator review before an action runs. Approved actions may still finish after disconnection. A runtime acknowledgment does not advance this lesson or assess mastery.</p><button class="text-button" data-action="matrix-close">Close connection panel</button></div>`}</section>`;
  }
  return { render, action, input, hide() { stop(); open = false; pairingCode = ''; retry = null; }, destroy: stop };
}
