import { randomUUID } from 'node:crypto';
import { exhibitIdentity, GALILEO_OBSERVATION_EXHIBIT, preflightExhibit } from '../exhibits/prepared-exhibits.ts';
import type { ExhibitPreflight } from '../exhibits/prepared-exhibits.ts';
import { MatrixClient, MatrixClientError } from '../integrations/matrix-client.ts';
import type { MatrixClientOptions, MatrixDiscovery, MatrixOutcome, MatrixScene } from '../integrations/matrix-client.ts';
import type { MatrixBindingRecord, MatrixBridgeResponse, MatrixDemonstration, MatrixLessonLedger, MatrixObjectEvidence, SchoolSession } from '../shared/contracts.ts';
import { fields, identifier, object, requireValue, SchoolError } from './errors.ts';
import { localMatrixOrigin, MATRIX_ACTIVE_STATUSES, MAX_MATRIX_BINDINGS, MAX_MATRIX_DEMONSTRATIONS } from './matrix-ledger.ts';
import { FileSchoolRepository, fingerprint, stable } from './repository.ts';
import type { RequestReceipt, SchoolStore } from './repository.ts';

const timestamp = () => new Date().toISOString();
const RECORD_LOST = 'This School process has no credential for the original pairing. Inspect the Matrix Operator for unresolved work. Pairing again never replays or adopts an earlier request.';
const UNKNOWN = 'Matrix did not confirm this action. Check the original request or inspect it in the Matrix Operator before creating another demonstration.';
type BridgeKind = Extract<RequestReceipt['kind'], 'matrix_pair' | 'matrix_disconnect' | 'matrix_demonstration' | 'matrix_cancel'>;
type Commit = (store: SchoolStore) => void;
interface LiveBinding { client: MatrixClient; origin: string; }
interface CachedReadiness { readiness: ExhibitPreflight; checkedAt: string; scene: MatrixScene; }
function session(store: SchoolStore, id: string): SchoolSession { identifier(id, 'session ID'); requireValue(Object.hasOwn(store.sessions, id), 404, 'not_found', 'Lesson session not found.'); return store.sessions[id]; }
function ledger(value: SchoolSession): MatrixLessonLedger { return value.matrix ??= { bindings: [], demonstrations: [] }; }
function touch(value: SchoolSession) { value.revision++; value.savedAt = value.updatedAt = timestamp(); }
function revision(value: SchoolSession, expected: unknown) { requireValue(Number.isSafeInteger(expected) && expected === value.revision, 409, 'stale_revision', 'This lesson changed. Refresh it before submitting again.'); }
function demonstration(value: SchoolSession, id: string) { identifier(id, 'demonstration ID'); const demo = value.matrix?.demonstrations.find(item => item.id === id); requireValue(demo, 404, 'not_found', 'Matrix demonstration not found in this lesson.'); return demo; }
function prior(store: SchoolStore, id: string, kind: BridgeKind, payload: unknown) {
  const value = Object.hasOwn(store.receipts, id) ? store.receipts[id] : undefined;
  if (value) requireValue(value.kind === kind && value.fingerprint === fingerprint(payload), 409, 'request_conflict', 'This request ID was already used with different data.');
  return !!value;
}
function remember(store: SchoolStore, id: string, kind: BridgeKind, payload: unknown, sessionId: string) { store.receipts[id] = { kind, fingerprint: fingerprint(payload), resourceId: sessionId }; }
function safeFailure(error: unknown): string {
  if (error instanceof MatrixClientError) {
    if (error.code === 'authentication_required' || error.code === 'invalid_pairing') return 'Matrix pairing is invalid, expired, or revoked. Inspect prior requests before obtaining a new one-use code.';
    if (error.code === 'runtime_changed') return 'The paired Matrix runtime changed. Prior requests remain bound to their original runtime; inspect them before pairing again.';
    if (error.code === 'room_unavailable') return 'The Matrix room is not currently available. Localize the room and confirm alignment in the Matrix Operator.';
    if (error.code === 'request_not_found') return 'The original Matrix pairing cannot find this request. Its outcome remains unconfirmed; inspect the Operator before creating another request.';
    if (error.code === 'invalid_response' || error.code === 'out_of_order') return 'Matrix returned evidence that could not be matched safely to the original request. Earlier confirmed evidence was preserved.';
  }
  return UNKNOWN;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function vector(value: unknown): value is { x: number; y: number; z: number } { return record(value) && ['x','y','z'].every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]) && Math.abs(value[axis] as number) <= 10000); }
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value);
function sameVector(value: unknown, expected: { x: number; y: number; z: number }): boolean { return vector(value) && ['x','y','z'].every(axis => Math.abs(value[axis as keyof typeof expected] - expected[axis as keyof typeof expected]) <= .00001); }
function expectedPosition(placement: MatrixDemonstration['placement']) {
  const result = { ...placement.position };
  if (placement.mode === 'surface' && placement.bounds) result.y -= (placement.bounds.center.y - placement.bounds.size.y / 2) * placement.spawnScale;
  return result;
}

/** Optional local adapter. Tokens exist only inside MatrixClient instances in this process. */
export class MatrixLessonBridge {
  private clients = new Map<string, LiveBinding>();
  private readiness = new Map<string, CachedReadiness>();
  private busy = new Set<string>();
  private pendingCommits = new Map<string, Commit>();
  private closed = false;
  private repository: FileSchoolRepository;
  private options: MatrixClientOptions;
  constructor(repository: FileSchoolRepository, options: MatrixClientOptions = {}) {
    this.repository = repository; this.options = options;
    const needsRecovery = Object.values(repository.snapshot().sessions).some(value => value.matrix?.bindings.some(binding => binding.status === 'paired' || binding.status === 'pairing') || value.matrix?.demonstrations.some(demo => MATRIX_ACTIVE_STATUSES.has(demo.status)));
    if (needsRecovery) repository.mutate(store => this.interrupt(store));
  }
  private interrupt(store: SchoolStore) {
    for (const value of Object.values(store.sessions)) {
      let changed = false;
      for (const binding of value.matrix?.bindings ?? []) if (binding.status === 'paired' || binding.status === 'pairing') { binding.status = binding.status === 'pairing' ? 'unconfirmed' : 'disconnected'; binding.error = RECORD_LOST; binding.updatedAt = timestamp(); changed = true; }
      for (const demo of value.matrix?.demonstrations ?? []) if (MATRIX_ACTIVE_STATUSES.has(demo.status)) { demo.status = 'unconfirmed'; demo.requiresApply = false; demo.error = RECORD_LOST; demo.updatedAt = timestamp(); changed = true; }
      if (changed) touch(value);
    }
  }
  private flush(sessionId: string) {
    requireValue(!this.closed, 503, 'bridge_closed', 'The Matrix companion is stopping.');
    const commit = this.pendingCommits.get(sessionId);
    if (commit) this.commit(sessionId, commit);
  }
  private commit(sessionId: string, change: Commit) {
    requireValue(!this.closed, 503, 'bridge_closed', 'The Matrix companion stopped before its result was saved. The saved intent remains unconfirmed.');
    try { this.repository.mutate(change); this.pendingCommits.delete(sessionId); }
    catch { this.pendingCommits.set(sessionId, change); throw new SchoolError(503, 'persistence_failed', 'Matrix may have processed the action, but School cannot save its outcome. Repair local storage and check this request; it will not be replayed.'); }
  }
  private enter(sessionId: string) { this.flush(sessionId); requireValue(!this.busy.has(sessionId), 409, 'bridge_busy', 'Another Matrix operation is still being checked for this lesson.'); this.busy.add(sessionId); }
  private view(sessionId: string, demoId?: string): MatrixBridgeResponse {
    const value = session(this.repository.snapshot(), sessionId);
    const binding = value.matrix?.bindings.find(item => item.id === value.matrix?.activeBindingId) ?? null;
    const connected = !!binding && binding.status === 'paired' && this.clients.has(binding.id);
    const cached = binding && connected ? this.readiness.get(binding.id) : undefined;
    return { apiVersion: 1, session: value, bridge: {
      binding, connected, readiness: cached?.readiness ?? null, checkedAt: cached?.checkedAt ?? null,
      reason: cached ? (cached.readiness.canLaunch ? 'The prepared block is available at the current Matrix selection. The owner must review and Apply each proposal.' : 'Matrix needs attention before this demonstration can be requested.') : binding?.error ?? (connected ? 'Refresh readiness before requesting a demonstration.' : 'Matrix is optional. Connect with a one-use code from the local Matrix Operator.'),
      operatorUrl: binding ? binding.origin + '/clients' : null,
      demonstrations: value.matrix?.demonstrations ?? [],
    }, ...(demoId ? { demonstration: demonstration(value, demoId) } : {}) };
  }
  private async readReady(sessionId: string, binding: MatrixBindingRecord): Promise<CachedReadiness> {
    const live = this.clients.get(binding.id); requireValue(live, 409, 'matrix_disconnected', RECORD_LOST);
    this.readiness.delete(binding.id);
    const results = await Promise.allSettled([MatrixClient.discover(live.origin, this.options), live.client.scene()]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const discovery = (results[0] as PromiseFulfilledResult<MatrixDiscovery>).value;
    const scene = (results[1] as PromiseFulfilledResult<MatrixScene>).value;
    const value = session(this.repository.snapshot(), sessionId);
    const result = { readiness: preflightExhibit(GALILEO_OBSERVATION_EXHIBIT, { target: 'matrix', lesson: value.lesson, mentor: value.mentor, discovery, scene }), checkedAt: timestamp(), scene };
    this.readiness.set(binding.id, result); return result;
  }
  async status(sessionId: string): Promise<MatrixBridgeResponse> {
    this.flush(sessionId); const current = this.view(sessionId); if (!current.bridge.connected || this.busy.has(sessionId)) return current;
    this.enter(sessionId);
    try {
      try { await this.readReady(sessionId, current.bridge.binding!); }
      catch (error) {
        const reason = safeFailure(error);
        const response = this.view(sessionId); response.bridge.reason = reason; return response;
      }
      return this.view(sessionId);
    } finally { this.busy.delete(sessionId); }
  }
  async pair(sessionId: string, raw: unknown): Promise<MatrixBridgeResponse> {
    const body = object(raw); fields(body, ['requestId','expectedRevision','url','pairingCode'], ['requestId','expectedRevision','url','pairingCode']);
    const requestId = identifier(body.requestId, 'request ID'); const origin = localMatrixOrigin(body.url);
    requireValue(typeof body.pairingCode === 'string' && body.pairingCode.length >= 1 && body.pairingCode.length <= 128 && !/[\u0000-\u0020]/.test(body.pairingCode), 400, 'invalid_pairing', 'Enter a current one-use Matrix pairing code.');
    // Do not persist the code or even its digest. Retrying this action ID only reads its outcome.
    const payload = { sessionId, requestId, expectedRevision: body.expectedRevision, origin };
    this.flush(sessionId); if (prior(this.repository.snapshot(), requestId, 'matrix_pair', payload)) return this.view(sessionId);
    this.enter(sessionId); let bindingId = '';
    try {
      this.repository.mutate(store => {
        const value = session(store, sessionId); revision(value, body.expectedRevision); const state = ledger(value);
        requireValue(state.bindings.length < MAX_MATRIX_BINDINGS, 409, 'bridge_capacity', 'This lesson has reached its pairing limit. Existing records are preserved.');
        bindingId = randomUUID(); const at = timestamp();
        state.bindings.push({ id: bindingId, origin, status: 'pairing', createdAt: at, updatedAt: at }); state.activeBindingId = bindingId;
        touch(value); remember(store, requestId, 'matrix_pair', payload, sessionId);
      });
      let client: MatrixClient;
      try {
        client = await MatrixClient.pair(origin, body.pairingCode, this.options);
        if (!safeId(client.session.sessionId) || !safeId(client.session.runtimeSessionId)) throw new MatrixClientError('invalid_response', 'Invalid pairing identity.', { outcomeUnknown: true });
      }
      catch (error) {
        this.commit(sessionId, store => { const value = session(store, sessionId); const binding = ledger(value).bindings.find(item => item.id === bindingId)!; binding.status = error instanceof MatrixClientError && !error.outcomeUnknown ? 'failed' : 'unconfirmed'; binding.error = safeFailure(error); binding.updatedAt = timestamp(); touch(value); });
        return this.view(sessionId);
      }
      if (!this.closed) this.clients.set(bindingId, { client, origin });
      this.commit(sessionId, store => { const value = session(store, sessionId); const binding = ledger(value).bindings.find(item => item.id === bindingId)!; binding.status = 'paired'; binding.matrixSessionId = client.session.sessionId; binding.runtimeSessionId = client.session.runtimeSessionId; binding.updatedAt = timestamp(); touch(value); });
      // Readiness is read-only; a failed check does not repeat the one-use claim.
      try { await this.readReady(sessionId, this.view(sessionId).bridge.binding!); }
      catch (error) { const result = this.view(sessionId); result.bridge.reason = safeFailure(error); return result; }
      return this.view(sessionId);
    } finally { this.busy.delete(sessionId); }
  }
  disconnect(sessionId: string, raw: unknown): MatrixBridgeResponse {
    const body = object(raw); fields(body, ['requestId','expectedRevision'], ['requestId','expectedRevision']); const requestId = identifier(body.requestId, 'request ID'); const payload = { sessionId, ...body };
    this.flush(sessionId); if (prior(this.repository.snapshot(), requestId, 'matrix_disconnect', payload)) return this.view(sessionId);
    this.enter(sessionId); const bindingIds: string[] = [];
    try {
      this.repository.mutate(store => {
        const value = session(store, sessionId); revision(value, body.expectedRevision); const state = ledger(value);
        for (const binding of state.bindings) {
          bindingIds.push(binding.id);
          if (binding.status === 'paired' || binding.status === 'pairing') { binding.status = 'disconnected'; binding.updatedAt = timestamp(); binding.error = 'Disconnected locally. This does not cancel or revoke Matrix work; inspect the Matrix Operator for pending proposals.'; }
        }
        for (const demo of state.demonstrations) if (MATRIX_ACTIVE_STATUSES.has(demo.status)) { demo.status = 'unconfirmed'; demo.requiresApply = false; demo.error = RECORD_LOST; demo.updatedAt = timestamp(); }
        touch(value); remember(store, requestId, 'matrix_disconnect', payload, sessionId);
      });
      for (const bindingId of bindingIds) { this.clients.delete(bindingId); this.readiness.delete(bindingId); }
      return this.view(sessionId);
    } finally { this.busy.delete(sessionId); }
  }
  async request(sessionId: string, raw: unknown): Promise<MatrixBridgeResponse> {
    const body = object(raw); fields(body, ['requestId','expectedRevision','bindingId','expectedMatrixRevision'], ['requestId','expectedRevision','bindingId','expectedMatrixRevision']);
    const requestId = identifier(body.requestId, 'request ID'); requireValue(requestId.length <= 96, 400, 'invalid_request', 'Matrix request IDs must be at most 96 characters.'); identifier(body.bindingId, 'binding ID');
    requireValue(Number.isSafeInteger(body.expectedMatrixRevision) && Number(body.expectedMatrixRevision) >= 0, 400, 'invalid_request', 'Use a nonnegative Matrix revision from current readiness.');
    const payload = { sessionId, ...body }; this.flush(sessionId);
    if (prior(this.repository.snapshot(), requestId, 'matrix_demonstration', payload)) return this.view(sessionId, requestId);
    this.enter(sessionId);
    try {
      const initial = this.view(sessionId); revision(initial.session, body.expectedRevision);
      requireValue(initial.session.status === 'active', 409, 'lesson_complete', 'This completed learning record is preserved. Start a new attempt to request another demonstration.');
      const binding = initial.bridge.binding;
      requireValue(binding && initial.bridge.connected && binding.id === body.bindingId, 409, 'matrix_disconnected', 'Connect this lesson to its current Matrix pairing before requesting a demonstration.');
      let ready: CachedReadiness;
      try { ready = await this.readReady(sessionId, binding); }
      catch (error) { throw new SchoolError(409, 'matrix_not_ready', safeFailure(error)); }
      requireValue(ready.readiness.canLaunch && ready.readiness.matrixRequest && ready.readiness.matrixRequest.text === 'Place a block here.', 409, 'matrix_not_ready', 'This prepared exhibit is not ready. Refresh readiness and resolve its reported requirements.');
      requireValue(ready.scene.revision === body.expectedMatrixRevision, 409, 'matrix_revision_changed', 'The Matrix scene or selection changed. Refresh readiness and review the new selection.');
      const selection = ready.scene.snapshot.selection as { anchorId: string; position: { x: number; y: number; z: number } };
      const assets = ready.scene.snapshot.assets as Array<Record<string, unknown>>; const asset = assets.find(item => item.assetId === 'block')!;
      const anchors = ready.scene.snapshot.anchors as Array<Record<string, unknown>>; const anchor = anchors.find(item => item.anchorId === selection.anchorId)!;
      const placement: MatrixDemonstration['placement'] = { anchorId: selection.anchorId, position: { ...selection.position }, mode: anchor.source === 'mruk' ? 'surface' : 'direct', spawnScale: asset.spawnScale === undefined ? .2 : asset.spawnScale as number };
      requireValue(typeof placement.spawnScale === 'number' && Number.isFinite(placement.spawnScale) && placement.spawnScale >= .01 && placement.spawnScale <= 20, 409, 'matrix_not_ready', 'The built-in block has an invalid reported spawn scale.');
      if (placement.mode === 'surface') {
        requireValue(record(asset.localBounds) && vector(asset.localBounds.center) && vector(asset.localBounds.size) && Object.values(asset.localBounds.size).every(size => size > 0) && placement.position.y >= 0, 409, 'matrix_not_ready', 'Measured support placement needs known prefab bounds and nonnegative surface clearance.');
        placement.bounds = { center: { x: asset.localBounds.center.x, y: asset.localBounds.center.y, z: asset.localBounds.center.z }, size: { x: asset.localBounds.size.x, y: asset.localBounds.size.y, z: asset.localBounds.size.z } };
      }
      requireValue(Object.values(expectedPosition(placement)).every(value => Math.abs(value) <= 100), 409, 'matrix_not_ready', 'The block placement exceeds the supported Matrix position range.');
      this.repository.mutate(store => {
        const value = session(store, sessionId); revision(value, body.expectedRevision); const state = ledger(value);
        requireValue(state.demonstrations.length < MAX_MATRIX_DEMONSTRATIONS, 409, 'bridge_capacity', 'This lesson has reached its demonstration limit. Existing records are preserved.');
        requireValue(!state.demonstrations.some(item => item.bindingId === binding.id && MATRIX_ACTIVE_STATUSES.has(item.status)), 409, 'demonstration_pending', 'Review, cancel, or reconcile the current demonstration before requesting another.');
        const at = timestamp(); state.demonstrations.push({ id: requestId, bindingId: binding.id, matrixSessionId: binding.matrixSessionId!, runtimeSessionId: binding.runtimeSessionId!, correlationId: requestId,
          exhibit: { id: GALILEO_OBSERVATION_EXHIBIT.id, version: GALILEO_OBSERVATION_EXHIBIT.version, digest: fingerprint(GALILEO_OBSERVATION_EXHIBIT), identity: exhibitIdentity(GALILEO_OBSERVATION_EXHIBIT) }, placement: structuredClone(placement),
          requestText: 'Place a block here.', expectedMatrixRevision: ready.scene.revision, status: 'submitting', createdAt: at, updatedAt: at, sequence: 0, requiresApply: false, proposalSummary: null, commandIds: [], receipts: [], observed: null, error: null });
        touch(value); remember(store, requestId, 'matrix_demonstration', payload, sessionId);
      });
      this.readiness.delete(binding.id);
      let outcome: MatrixOutcome;
      try { outcome = await this.clients.get(binding.id)!.client.propose('Place a block here.', { requestId, correlationId: requestId, revision: ready.scene.revision }); }
      catch (error) {
        this.commit(sessionId, store => { const value = session(store, sessionId); const demo = demonstration(value, requestId); demo.status = error instanceof MatrixClientError && !error.outcomeUnknown ? 'error' : 'unconfirmed'; demo.error = safeFailure(error); demo.updatedAt = timestamp(); touch(value); });
        return this.view(sessionId, requestId);
      }
      this.recordOutcome(sessionId, requestId, outcome); return this.view(sessionId, requestId);
    } finally { this.busy.delete(sessionId); }
  }
  async poll(sessionId: string, demoId: string): Promise<MatrixBridgeResponse> {
    this.flush(sessionId); const current = this.view(sessionId, demoId); const demo = current.demonstration!;
    if (this.busy.has(sessionId)) return current;
    const live = this.clients.get(demo.bindingId);
    if (!live) { current.demonstration!.checkError = RECORD_LOST; return current; }
    this.enter(sessionId);
    try {
      let result: MatrixOutcome;
      try { result = await live.client.outcome(demoId); }
      catch (error) { this.recordCheckFailure(sessionId, demoId, error); return this.view(sessionId, demoId); }
      this.recordOutcome(sessionId, demoId, result); return this.view(sessionId, demoId);
    } finally { this.busy.delete(sessionId); }
  }
  async cancel(sessionId: string, demoId: string, raw: unknown): Promise<MatrixBridgeResponse> {
    const body = object(raw); fields(body, ['requestId'], ['requestId']); const requestId = identifier(body.requestId, 'request ID'); const payload = { sessionId, demoId, ...body };
    this.flush(sessionId); if (prior(this.repository.snapshot(), requestId, 'matrix_cancel', payload)) return this.view(sessionId, demoId);
    this.enter(sessionId);
    try {
      const demo = demonstration(session(this.repository.snapshot(), sessionId), demoId); const live = this.clients.get(demo.bindingId);
      requireValue(live, 409, 'matrix_disconnected', RECORD_LOST);
      // Persist the cancellation intent before dispatch. A duplicate action never sends it twice.
      this.repository.mutate(store => { remember(store, requestId, 'matrix_cancel', payload, sessionId); });
      let outcome: MatrixOutcome;
      try { outcome = await live.client.cancel(demoId); }
      catch (error) { this.recordCheckFailure(sessionId, demoId, error, true); return this.view(sessionId, demoId); }
      this.recordOutcome(sessionId, demoId, outcome); return this.view(sessionId, demoId);
    } finally { this.busy.delete(sessionId); }
  }
  private recordCheckFailure(sessionId: string, demoId: string, error: unknown, mutation = false) {
    this.commit(sessionId, store => {
      const value = session(store, sessionId); const demo = demonstration(value, demoId);
      if (demo.status === 'submitting' || mutation && !(error instanceof MatrixClientError && !error.outcomeUnknown) && MATRIX_ACTIVE_STATUSES.has(demo.status)) { demo.status = 'unconfirmed'; demo.requiresApply = false; }
      demo.checkError = safeFailure(error); demo.lastCheckedAt = timestamp(); demo.updatedAt = timestamp(); touch(value);
    });
  }
  private recordOutcome(sessionId: string, demoId: string, outcome: MatrixOutcome) {
    const original = demonstration(session(this.repository.snapshot(), sessionId), demoId);
    const valid = outcome.requestId === original.id && outcome.correlationId === original.correlationId && outcome.sessionId === original.matrixSessionId && outcome.runtimeSessionId === original.runtimeSessionId && outcome.sequence >= original.sequence &&
      (original.commandIds.length === 0 || stable(original.commandIds) === stable(outcome.commandIds)) &&
      original.receipts.every(known => outcome.receipts.some(next => next.requestId === known.requestId && next.ok === known.ok && next.objectId === known.objectId)) &&
      (original.status !== 'succeeded' || outcome.status === 'succeeded');
    if (!valid) { this.recordCheckFailure(sessionId, demoId, new MatrixClientError('invalid_response', 'Mismatched outcome.')); return; }
    const beforeExecution = ['planning', 'ready', 'cancelled', 'stale', 'needs_clarification', 'review_only', 'error'].includes(outcome.status);
    const contradictory = beforeExecution && (outcome.commandIds.length > 0 || outcome.receipts.length > 0 || outcome.observed !== null) ||
      ['queued','running'].includes(outcome.status) && (outcome.commandIds.length !== 1 || outcome.receipts.length > 0 || outcome.observed !== null) ||
      outcome.status === 'failed' && (outcome.commandIds.length !== 1 || outcome.receipts.length !== 1 || outcome.receipts.some(ack => ack.ok)) ||
      outcome.status === 'partial'; // This prepared recipe has one command; it cannot partially execute a batch.
    if (contradictory) { this.recordCheckFailure(sessionId, demoId, new MatrixClientError('invalid_response', 'Contradictory execution evidence.')); return; }
    const command = Array.isArray(outcome.proposal?.commands) && outcome.proposal.commands.length === 1 ? outcome.proposal.commands[0] : null;
    const zero = { x: 0, y: 0, z: 0 }; const scale = { x: original.placement.spawnScale, y: original.placement.spawnScale, z: original.placement.spawnScale };
    const boundedProposal = record(command) && command.op === 'spawn' && command.assetId === 'block' && command.anchorId === original.placement.anchorId && record(command.transform) &&
      sameVector(command.transform.position, original.placement.position) && sameVector(command.transform.rotation, zero) && sameVector(command.transform.scale, scale) &&
      (original.placement.mode === 'surface' ? command.placement === 'surface' : command.placement === undefined);
    const objects: MatrixObjectEvidence[] = [];
    if (outcome.observed && 'snapshot' in outcome.observed && record(outcome.observed.snapshot.scene) && Array.isArray(outcome.observed.snapshot.scene.objects)) {
      for (const item of outcome.observed.snapshot.scene.objects) {
        if (!record(item) || !outcome.receipts.some(ack => ack.ok && ack.objectId === item.objectId) || item.assetId !== 'block' || item.anchorId !== original.placement.anchorId || !safeId(item.objectId) || !record(item.transform) ||
          !sameVector(item.transform.position, expectedPosition(original.placement)) || !sameVector(item.transform.rotation, zero) || !sameVector(item.transform.scale, scale) || !vector(item.transform.position) || !vector(item.transform.scale)) continue;
        objects.push({ objectId: item.objectId, assetId: 'block', anchorId: original.placement.anchorId, position: { x: item.transform.position.x, y: item.transform.position.y, z: item.transform.position.z }, scale: { x: item.transform.scale.x, y: item.transform.scale.y, z: item.transform.scale.z } });
      }
    }
    // This slice can evidence exactly one acknowledged block, never arbitrary snapshots or physical measurements.
    const observed = outcome.observed && outcome.observed.revision >= original.expectedMatrixRevision && objects.length === 1 && outcome.commandIds.length === 1 && outcome.receipts.length === 1 && outcome.receipts[0].ok ? { revision: outcome.observed.revision, objects, source: 'matrix-runtime' as const } : null;
    const tooBroad = outcome.commandIds.length > 1 || outcome.receipts.length > 1 || outcome.commandIds.some(id => !safeId(id)) || outcome.receipts.some(ack => !safeId(ack.requestId) || (ack.objectId !== '' && !safeId(ack.objectId)));
    if (tooBroad) { this.recordCheckFailure(sessionId, demoId, new MatrixClientError('invalid_response', 'Unbounded outcome.')); return; }
    const recipeMismatch = ['ready','queued','running','succeeded'].includes(outcome.status) && !boundedProposal;
    const unverifiable = recipeMismatch || outcome.status === 'succeeded' && !observed;
    const update = { status: unverifiable ? 'unconfirmed' as const : outcome.status, sequence: outcome.sequence, requiresApply: unverifiable ? false : outcome.requiresApply,
      proposalSummary: boundedProposal ? `Matrix proposed one built-in block on ${original.placement.anchorId}. Review the exact position and scale in the Matrix Operator before Apply.` : outcome.proposal ? 'Matrix returned a proposal outside this prepared block recipe. Inspect it in the Operator; School does not verify this as the requested exhibit.' : null,
      commandIds: [...outcome.commandIds], receipts: outcome.receipts.map(ack => ({ requestId: ack.requestId, ok: ack.ok, error: ack.error ? 'The Matrix runtime reported a command error.' : '', objectId: ack.objectId })),
      observed: unverifiable || outcome.status !== 'succeeded' ? null : observed,
      error: recipeMismatch ? 'The Matrix proposal does not match the selected point, catalog scale and prepared block recipe. Inspect or cancel it in the Operator; School does not verify this demonstration.' : unverifiable ? 'Matrix reported completion, but the original block request, command receipt and observed block could not all be matched. No verified demonstration is claimed.' : outcome.error ? 'Matrix reported an incomplete or rejected request. Inspect this request in the Operator for details.' : null,
    };
    // Confirmed evidence is immutable; later reads cannot rewrite its object transform or erase it.
    if (original.observed && stable(original.observed) !== stable(update.observed)) { this.recordCheckFailure(sessionId, demoId, new MatrixClientError('invalid_response', 'Changed confirmed evidence.')); return; }
    // A repeated Matrix sequence may repeat evidence, but cannot revise previously known execution facts.
    if (original.sequence > 0 && outcome.sequence === original.sequence && !['submitting','unconfirmed'].includes(original.status) &&
        (original.status !== update.status || stable(original.commandIds) !== stable(update.commandIds) || stable(original.receipts) !== stable(update.receipts))) {
      this.recordCheckFailure(sessionId, demoId, new MatrixClientError('invalid_response', 'Conflicting sequence.')); return;
    }
    this.commit(sessionId, store => {
      const value = session(store, sessionId); const demo = demonstration(value, demoId);
      const changed = Object.entries(update).some(([key, item]) => stable((demo as unknown as Record<string, unknown>)[key]) !== stable(item)) || demo.checkError !== undefined;
      const firstSuccess = demo.status !== 'succeeded' && update.status === 'succeeded';
      Object.assign(demo, update); delete demo.checkError; demo.lastCheckedAt = timestamp();
      if (changed) {
        demo.updatedAt = timestamp(); touch(value);
        if (firstSuccess) value.messages.push({ id: randomUUID(), role: 'system', stage: value.stage, createdAt: timestamp(), text: 'Matrix reported that a block was placed at the selected surface point. This confirms virtual-object placement only; it does not establish camera evidence, physical volume, browser experiment results, or learner mastery. The lesson stage is unchanged.' });
      }
    });
  }
  close() {
    if (this.closed) return;
    try {
      if (Object.values(this.repository.snapshot().sessions).some(value => value.matrix?.bindings.some(binding => ['paired','pairing'].includes(binding.status)) || value.matrix?.demonstrations.some(demo => MATRIX_ACTIVE_STATUSES.has(demo.status)))) this.repository.mutate(store => this.interrupt(store));
    }
    finally { this.closed = true; this.clients.clear(); this.readiness.clear(); this.pendingCommits.clear(); }
  }
}
