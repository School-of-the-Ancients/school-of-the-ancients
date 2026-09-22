import { randomUUID } from 'node:crypto';
import { exhibitIdentity, GALILEO_OBSERVATION_EXHIBIT, preflightExhibit } from '../exhibits/prepared-exhibits.ts';
import type { ExhibitPreflight } from '../exhibits/prepared-exhibits.ts';
import { MatrixClient, MatrixClientError, validateScaleOutcome, verifiedScaleObservation } from '../integrations/matrix-client.ts';
import type { MatrixClientOptions, MatrixDiscovery, MatrixOutcome, MatrixScene, MatrixScaleProof, MatrixScaleTransform, MatrixScaleIntent } from '../integrations/matrix-client.ts';
import type { MatrixBindingRecord, MatrixBridgeResponse, MatrixDemonstration, MatrixLessonLedger, MatrixObjectEvidence, MatrixScaleExperiment, MatrixSceneBuild, SchoolSession } from '../shared/contracts.ts';
import { validMentorDemonstration } from '../shared/mentor-demonstration.ts';
import { fields, identifier, object, requireValue, SchoolError } from './errors.ts';
import { localMatrixOrigin, MATRIX_ACTIVE_STATUSES, MAX_MATRIX_BINDINGS, MAX_MATRIX_DEMONSTRATIONS, MAX_MATRIX_EXPERIMENTS, MAX_MATRIX_SCENE_BUILDS, MATRIX_BLOCKING_STATUSES } from './matrix-ledger.ts';
import { FileSchoolRepository, fingerprint, stable } from './repository.ts';
import type { RequestReceipt, SchoolStore } from './repository.ts';

const timestamp = () => new Date().toISOString();
const RECORD_LOST = 'This School process has no credential for the original pairing. Inspect the Matrix Operator for unresolved work. Pairing again never replays or adopts an earlier request.';
const UNKNOWN = 'Matrix did not confirm this action. Check the original request or inspect it in the Matrix Operator before creating another demonstration.';
type BridgeKind = Extract<RequestReceipt['kind'], 'matrix_pair' | 'matrix_disconnect' | 'matrix_demonstration' | 'matrix_cancel' | 'matrix_scale' | 'matrix_scale_cancel' | 'matrix_scene_build' | 'matrix_scene_cancel'>;
type Commit = (store: SchoolStore) => void;
interface LiveBinding { client: MatrixClient; origin: string; }
interface CachedReadiness { readiness: ExhibitPreflight; checkedAt: string; scene: MatrixScene; discovery: MatrixDiscovery; }
function session(store: SchoolStore, id: string): SchoolSession { identifier(id, 'session ID'); requireValue(Object.hasOwn(store.sessions, id), 404, 'not_found', 'Lesson session not found.'); return store.sessions[id]; }
function ledger(value: SchoolSession): MatrixLessonLedger { return value.matrix ??= { bindings: [], demonstrations: [] }; }
function touch(value: SchoolSession) { value.revision++; value.savedAt = value.updatedAt = timestamp(); }
function revision(value: SchoolSession, expected: unknown) { requireValue(Number.isSafeInteger(expected) && expected === value.revision, 409, 'stale_revision', 'This lesson changed. Refresh it before submitting again.'); }
function demonstration(value: SchoolSession, id: string) { identifier(id, 'demonstration ID'); const demo = value.matrix?.demonstrations.find(item => item.id === id); requireValue(demo, 404, 'not_found', 'Matrix demonstration not found in this lesson.'); return demo; }
function experiment(value: SchoolSession, id: string) { identifier(id, 'experiment ID'); const result = value.matrix?.experiments?.find(item => item.id === id); requireValue(result, 404, 'not_found', 'Matrix scale experiment not found in this lesson.'); return result; }
function sceneBuild(value: SchoolSession, id: string) { identifier(id, 'scene build ID'); const result = value.matrix?.sceneBuilds?.find(item => item.id === id); requireValue(result, 404, 'not_found', 'Matrix scene build not found in this lesson.'); return result; }
function allWork(value: SchoolSession) { return [...value.matrix?.demonstrations ?? [], ...value.matrix?.experiments ?? [], ...value.matrix?.sceneBuilds ?? []]; }
function blocked(value: SchoolSession) { return allWork(value).some(item => MATRIX_BLOCKING_STATUSES.has(item.status)); }
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
    if (error.code === 'planner_unavailable') return 'Matrix Codex planning is unavailable. Configure it in the Matrix Operator; School will not fall back or replay this request.';
    if (error.code === 'planner_busy') return 'Matrix is already planning another request. This saved teaching request was not planned; ask the mentor for a new suggestion after that work completes.';
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

function sceneBuilderReadiness(value: SchoolSession, cached?: CachedReadiness): MatrixBridgeResponse['bridge']['sceneBuilder'] {
  const unavailable = (reason: string) => ({ available: false, reason });
  if (value.status !== 'active') return unavailable('Start a new lesson to request a scene build.');
  if (value.activeTurnId) return unavailable('Wait for the mentor reply before requesting its demonstration.');
  if (blocked(value)) return unavailable('Review, cancel, or reconcile pending Matrix work before requesting another scene build.');
  if (!cached) return unavailable('Connect and refresh Matrix to check scene planning readiness.');
  const capability = cached.discovery.capabilities['scene.propose_text'];
  if (!record(capability) || !Array.isArray(capability.modes) || !capability.modes.includes('codex-cli') || capability.requiresOperatorApply !== true || cached.discovery.capabilities['scene.read'] !== true || cached.discovery.capabilities['request.read'] !== true) return unavailable('This Matrix service does not advertise Codex scene planning with owner review. Configure the Matrix planner, then refresh.');
  const { snapshot, runtime } = cached.scene;
  if (snapshot.readOnly === true || !record(snapshot.scene) || snapshot.scene.schemaVersion !== 1 || !safeId(snapshot.scene.roomId) || !Array.isArray(snapshot.scene.objects)) return unavailable('Matrix needs a current writable scene before it can plan a demonstration.');
  const contexts = [snapshot.roomContext, runtime].filter(context => context !== undefined && context !== null);
  if (contexts.some(context => !record(context) || typeof context.mode !== 'string' || !['white-room','ar'].includes(context.mode) || context.state !== 'ready' || context.mode === 'ar' && context.alignmentVerified !== true)) return unavailable('Matrix room data or AR alignment is not ready. Check the Operator before requesting a demonstration.');
  if (record(snapshot.roomContext) && record(runtime) && ['mode','state','alignmentVerified'].some(key => (snapshot.roomContext as Record<string, unknown>)[key] !== runtime[key])) return unavailable('Matrix room and runtime readiness disagree. Refresh after reconnecting.');
  return { available: true, expectedMatrixRevision: cached.scene.revision, reason: 'Send the saved mentor teaching request to Matrix Codex, then review and Apply its proposal in the Matrix Operator.' };
}

function savedTeachingIntent(store: SchoolStore, sessionId: string, turnId: string) {
  const value = session(store, sessionId), turn = store.turns[turnId];
  const message = value.messages.findLast(item => item.role === 'mentor');
  requireValue(value.status === 'active' && !value.activeTurnId && turn?.sessionId === sessionId && turn.status === 'completed' && validMentorDemonstration(turn.demonstration) && message?.turnId === turnId && message.stage === value.stage && message.text === turn.output && stable(message.demonstration) === stable(turn.demonstration), 409, 'stale_teaching_intent', 'Use the latest completed mentor suggestion for the current lesson stage.');
  return { intent: structuredClone(turn.demonstration), stage: message.stage };
}

function scaleReadiness(value:SchoolSession,cached?:CachedReadiness):{scale:MatrixBridgeResponse['bridge']['scale'];proof?:MatrixScaleProof}{
  const unavailable=(reason:string)=>({scale:{available:false,reason}});
  if(value.status!=='active')return unavailable('Start a new lesson to request another scale experiment.');
  if(blocked(value))return unavailable('Review, cancel, or reconcile pending Matrix work first. If its original pairing is lost, inspect the Operator and start a new lesson.');
  if(!cached)return unavailable('Connect and refresh Matrix to check scale readiness.');
  const capability=cached.discovery.capabilities['experiment.block-scale.v1'];
  if(!record(capability)||capability.version!==1||capability.kind!=='block-scale'||capability.assetId!=='block'||capability.requiresOperatorApply!==true||!Array.isArray(capability.supportedRoomModes)||!capability.supportedRoomModes.includes('white-room')||!Array.isArray(capability.actions)||!['configure','reset'].every(action=>(capability.actions as unknown[]).includes(action)))return unavailable('This Matrix service does not advertise the reviewed block-scale capability.');
  const snapshot=cached.scene.snapshot;
  const contexts=[snapshot.roomContext,cached.scene.runtime].filter(context=>context!==null&&context!==undefined);
  // Legacy desktop snapshots omit both contexts; explicit contexts must all say virtual.
  if(contexts.some(context=>!record(context)||context.mode!=='white-room'||context.state!=='ready')||snapshot.readOnly===true)return unavailable('Scale experiments need a writable virtual white room. AR scale is not supported.');
  const demo=value.matrix?.demonstrations.findLast(item=>item.bindingId===value.matrix?.activeBindingId&&item.status==='succeeded'&&item.observed&&item.placement.mode==='direct');
  if(!demo?.observed)return unavailable('First place and confirm a School block in this Matrix pairing.');
  if(!demo.observed.roomId)return unavailable('This older placement record has no confirmed room identity. Place and confirm a new School block before scaling.');
  const placed=demo.observed.objects[0];
  const latest=value.matrix?.experiments?.findLast(item=>item.demonstrationId===demo.id&&item.bindingId===demo.bindingId&&item.status==='succeeded'&&item.observed);
  const scene=snapshot.scene;
  if(!record(scene)||!safeId(scene.roomId)||scene.roomId!==demo.observed.roomId||!Array.isArray(scene.objects))return unavailable('The current Matrix scene identity is unavailable.');
  const objects=scene.objects.filter(item=>record(item)&&item.objectId===placed.objectId);
  const item=objects[0];
  if(objects.length!==1||!record(item)||item.assetId!=='block'||item.anchorId!==placed.anchorId||!record(item.transform))return unavailable('The confirmed School block is missing or changed. Restore it in Matrix before refreshing.');
  const expected=latest?.proof.expectedTransform??{position:placed.position,rotation:{x:0,y:0,z:0},scale:placed.scale};
  if(!['position','rotation','scale'].every(part=>sameVector((item.transform as Record<string,unknown>)[part],expected[part as keyof MatrixScaleTransform]))||latest&&latest.proof.baseline.roomId!==scene.roomId)return unavailable('The block changed after its confirmed result. Restore its recorded transform in Matrix, then refresh.');
  const anchors=Array.isArray(snapshot.anchors)?snapshot.anchors.filter(a=>record(a)&&a.anchorId===placed.anchorId):[];
  const assets=Array.isArray(snapshot.assets)?snapshot.assets.filter(a=>record(a)&&a.assetId==='block'):[];
  if(anchors.length!==1||!record(anchors[0])||anchors[0].source==='mruk'||assets.length!==1||!record(assets[0])||assets[0].source)return unavailable('The original virtual anchor or built-in block identity is unavailable.');
  if(item.behaviors!==undefined&&(!Array.isArray(item.behaviors)||item.behaviors.some(b=>!record(b)||b.enabled!==false)))return unavailable('Disable the block behaviors in Matrix before requesting a static scale experiment.');
  const transform:MatrixScaleTransform={position:{...expected.position},rotation:{...expected.rotation},scale:{...expected.scale}};
  // Capture actual finite runtime values so the Matrix proposal uses the identical baseline.
  for(const part of ['position','rotation','scale'] as const)transform[part]={...(item.transform[part] as MatrixScaleTransform[typeof part])};
  if(!Object.values(transform.position).every(n=>Math.abs(n)<=100)||!Object.values(transform.scale).every(n=>n>=.01&&n<=20))return unavailable('The block transform exceeds the supported range.');
  const baseline=latest?structuredClone(latest.proof.baseline):{roomId:scene.roomId,objectId:placed.objectId,assetId:'block' as const,anchorId:placed.anchorId,transform};
  return {scale:{available:true,reason:'Configure relative factors for this confirmed School block, then review and Apply in Matrix.',expectedMatrixRevision:cached.scene.revision,demonstrationId:demo.id,...(latest?{latestExperimentId:latest.id}:{})},proof:{action:'configure',baseline,factors:{x:1,y:1,z:1},expectedTransform:structuredClone(baseline.transform)}};
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
    const needsRecovery = Object.values(repository.snapshot().sessions).some(value => value.matrix?.bindings.some(binding => binding.status === 'paired' || binding.status === 'pairing') || allWork(value).some(demo => MATRIX_ACTIVE_STATUSES.has(demo.status)));
    if (needsRecovery) repository.mutate(store => this.interrupt(store));
  }
  private interrupt(store: SchoolStore) {
    for (const value of Object.values(store.sessions)) {
      let changed = false;
      for (const binding of value.matrix?.bindings ?? []) if (binding.status === 'paired' || binding.status === 'pairing') { binding.status = binding.status === 'pairing' ? 'unconfirmed' : 'disconnected'; binding.error = RECORD_LOST; binding.updatedAt = timestamp(); changed = true; }
      for (const demo of allWork(value)) if (MATRIX_ACTIVE_STATUSES.has(demo.status)) { demo.status = 'unconfirmed'; demo.requiresApply = false; demo.error = RECORD_LOST; demo.updatedAt = timestamp(); changed = true; }
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
  private view(sessionId: string, demoId?: string, experimentId?: string, sceneBuildId?: string): MatrixBridgeResponse {
    const value = session(this.repository.snapshot(), sessionId);
    const binding = value.matrix?.bindings.find(item => item.id === value.matrix?.activeBindingId) ?? null;
    const connected = !!binding && binding.status === 'paired' && this.clients.has(binding.id);
    const cached = binding && connected ? this.readiness.get(binding.id) : undefined;
    return { apiVersion: 1, session: value, bridge: {
      binding, connected, readiness: cached?.readiness ?? null, checkedAt: cached?.checkedAt ?? null,
      reason: cached ? (cached.readiness.canLaunch ? 'The prepared block is available at the current Matrix selection. The owner must review and Apply each proposal.' : 'Matrix needs attention before this demonstration can be requested.') : binding?.error ?? (connected ? 'Refresh readiness before requesting a demonstration.' : 'Matrix is optional. Connect with a one-use code from the local Matrix Operator.'),
      operatorUrl: binding ? binding.origin + '/clients' : null,
      demonstrations: value.matrix?.demonstrations ?? [], experiments: value.matrix?.experiments ?? [],
      scale: scaleReadiness(value, cached).scale,
      sceneBuilds: value.matrix?.sceneBuilds ?? [], sceneBuilder: sceneBuilderReadiness(value, cached),
    }, ...(demoId ? { demonstration: demonstration(value, demoId) } : {}), ...(experimentId ? { experiment: experiment(value, experimentId) } : {}), ...(sceneBuildId ? { sceneBuild: sceneBuild(value, sceneBuildId) } : {}) };
  }
  private async readReady(sessionId: string, binding: MatrixBindingRecord): Promise<CachedReadiness> {
    const live = this.clients.get(binding.id); requireValue(live, 409, 'matrix_disconnected', RECORD_LOST);
    this.readiness.delete(binding.id);
    const results = await Promise.allSettled([MatrixClient.discover(live.origin, this.options), live.client.scene()]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const discovery = (results[0] as PromiseFulfilledResult<MatrixDiscovery>).value;
    const scene = (results[1] as PromiseFulfilledResult<MatrixScene>).value;
    const value = session(this.repository.snapshot(), sessionId);
    const result = { readiness: preflightExhibit(GALILEO_OBSERVATION_EXHIBIT, { target: 'matrix', lesson: value.lesson, mentor: value.mentor, discovery, scene }), checkedAt: timestamp(), scene, discovery };
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
        for (const demo of allWork(value)) if (MATRIX_ACTIVE_STATUSES.has(demo.status)) { demo.status = 'unconfirmed'; demo.requiresApply = false; demo.error = RECORD_LOST; demo.updatedAt = timestamp(); }
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
        requireValue(!blocked(value), 409, 'demonstration_pending', 'Review, cancel, or reconcile all pending Matrix work first. If the original pairing is lost, inspect the Operator and start a new lesson.');
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
    const observedRoom = outcome.observed && 'snapshot' in outcome.observed && record(outcome.observed.snapshot.scene) ? outcome.observed.snapshot.scene.roomId : undefined;
    const observed = outcome.observed && outcome.observed.revision >= original.expectedMatrixRevision && objects.length === 1 && outcome.commandIds.length === 1 && outcome.receipts.length === 1 && outcome.receipts[0].ok ? { revision: outcome.observed.revision, objects, source: 'matrix-runtime' as const, ...(safeId(observedRoom) ? { roomId: observedRoom } : {}) } : null;
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
  async requestScale(sessionId: string, raw: unknown): Promise<MatrixBridgeResponse> {
    const body = object(raw); fields(body, ['requestId','expectedRevision','bindingId','expectedMatrixRevision','demonstrationId','action','factors','baselineExperimentId'], ['requestId','expectedRevision','bindingId','expectedMatrixRevision','demonstrationId','action']);
    const requestId = identifier(body.requestId, 'request ID'); identifier(body.bindingId,'binding ID'); identifier(body.demonstrationId,'demonstration ID');
    requireValue(requestId.length <= 96 && Number.isSafeInteger(body.expectedMatrixRevision) && Number(body.expectedMatrixRevision) >= 0,400,'invalid_request','Use a bounded request ID and current Matrix revision.');
    requireValue(body.action === 'configure' || body.action === 'reset',400,'invalid_request','Choose configure or reset.');
    if (body.baselineExperimentId !== undefined) identifier(body.baselineExperimentId,'baseline experiment ID');
    if (body.action === 'configure') requireValue(vector(body.factors) && Object.keys(body.factors).length === 3 && Object.values(body.factors).every(n => n >= .25 && n <= 4),400,'invalid_request','Use X, Y and Z factors between 0.25 and 4.');
    else requireValue(body.factors === undefined && body.baselineExperimentId !== undefined,400,'invalid_request','Reset needs a confirmed baseline experiment and no factors.');
    const payload = {sessionId,...body}; this.flush(sessionId);
    if (prior(this.repository.snapshot(),requestId,'matrix_scale',payload)) return this.view(sessionId,undefined,requestId);
    this.enter(sessionId);
    try {
      const initial = this.view(sessionId); revision(initial.session,body.expectedRevision);
      const binding = initial.bridge.binding;
      requireValue(binding && initial.bridge.connected && binding.id === body.bindingId,409,'matrix_disconnected',RECORD_LOST);
      requireValue(initial.session.status === 'active',409,'lesson_complete','Start a new lesson to request more scene work.');
      requireValue(!blocked(initial.session),409,'demonstration_pending','Reconcile pending or unconfirmed Matrix work before requesting another change. If its pairing is lost, inspect the Operator and start a new lesson.');
      let ready: CachedReadiness; try { ready = await this.readReady(sessionId,binding); } catch(error) { throw new SchoolError(409,'matrix_not_ready',safeFailure(error)); }
      requireValue(ready.scene.revision === body.expectedMatrixRevision,409,'matrix_revision_changed','The Matrix scene changed. Refresh and review it before requesting a scale change.');
      const available = scaleReadiness(session(this.repository.snapshot(),sessionId),ready);
      requireValue(available.scale.available && available.proof && available.scale.demonstrationId === body.demonstrationId,409,'matrix_not_ready',available.scale.reason);
      const latestId = available.scale.latestExperimentId;
      requireValue(body.baselineExperimentId === undefined || body.baselineExperimentId === latestId,409,'stale_baseline','Use the latest confirmed experiment for this demonstration.');
      requireValue(body.action !== 'reset' || latestId !== undefined,409,'stale_baseline','Reset requires a confirmed scale experiment.');
      const proof: MatrixScaleProof = structuredClone(available.proof);
      proof.action = body.action; proof.factors = body.action === 'reset' ? {x:1,y:1,z:1} : structuredClone(body.factors as MatrixScaleProof['factors']);
      proof.expectedTransform = structuredClone(proof.baseline.transform);
      for (const axis of ['x','y','z'] as const) proof.expectedTransform.scale[axis] *= proof.factors[axis];
      requireValue(Object.values(proof.expectedTransform.scale).every(n => n>=.01 && n<=20),400,'invalid_request','The requested scale exceeds the supported transform range.');
      this.repository.mutate(store => {
        const value = session(store,sessionId); revision(value,body.expectedRevision); requireValue(!blocked(value),409,'demonstration_pending','Reconcile existing Matrix work first.');
        const state=ledger(value); state.experiments ??= []; requireValue(state.experiments.length < MAX_MATRIX_EXPERIMENTS,409,'bridge_capacity','This lesson reached its Matrix experiment limit. Existing records are preserved.');
        const at=timestamp(); state.experiments.push({id:requestId,bindingId:binding.id,demonstrationId:body.demonstrationId as string,matrixSessionId:binding.matrixSessionId!,runtimeSessionId:binding.runtimeSessionId!,correlationId:requestId,action:proof.action,factors:structuredClone(proof.factors),...(latestId?{baselineExperimentId:latestId}:{}),proof,expectedMatrixRevision:ready.scene.revision,status:'submitting',requiresApply:false,sequence:0,createdAt:at,updatedAt:at,proposalSummary:null,commandIds:[],receipts:[],observed:null,error:null});
        touch(value); remember(store,requestId,'matrix_scale',payload,sessionId);
      });
      this.readiness.delete(binding.id);
      const intent: MatrixScaleIntent = proof.action === 'reset' ? {kind:'block-scale',version:1,action:'reset',objectId:proof.baseline.objectId,baselineRequestId:latestId!} : {kind:'block-scale',version:1,action:'configure',objectId:proof.baseline.objectId,factors:proof.factors,...(latestId?{baselineRequestId:latestId}:{})};
      let outcome: MatrixOutcome;
      try { outcome=await this.clients.get(binding.id)!.client.proposeScale(intent,{requestId,correlationId:requestId,revision:ready.scene.revision}); }
      catch(error) { this.commit(sessionId,store => {const value=session(store,sessionId), item=experiment(value,requestId); item.status=error instanceof MatrixClientError && !error.outcomeUnknown?'error':'unconfirmed'; item.error=safeFailure(error); item.updatedAt=timestamp(); touch(value);}); return this.view(sessionId,undefined,requestId); }
      this.recordScaleOutcome(sessionId,requestId,outcome); return this.view(sessionId,undefined,requestId);
    } finally {this.busy.delete(sessionId);}
  }
  async pollScale(sessionId:string, id:string):Promise<MatrixBridgeResponse> {
    this.flush(sessionId); const current=this.view(sessionId,undefined,id), item=current.experiment!;
    if(this.busy.has(sessionId)) return current;
    const live=this.clients.get(item.bindingId); if(!live){item.checkError=RECORD_LOST;return current;}
    this.enter(sessionId);
    try {let outcome:MatrixOutcome; try{outcome=await live.client.outcome(id);}catch(error){this.scaleCheckFailure(sessionId,id,error);return this.view(sessionId,undefined,id);}
      this.recordScaleOutcome(sessionId,id,outcome);return this.view(sessionId,undefined,id);
    }finally{this.busy.delete(sessionId);}
  }
  async cancelScale(sessionId:string,id:string,raw:unknown):Promise<MatrixBridgeResponse>{
    const body=object(raw);fields(body,['requestId'],['requestId']);const requestId=identifier(body.requestId,'request ID'),payload={sessionId,id,...body};
    this.flush(sessionId);if(prior(this.repository.snapshot(),requestId,'matrix_scale_cancel',payload))return this.view(sessionId,undefined,id);
    this.enter(sessionId);
    try{const item=experiment(session(this.repository.snapshot(),sessionId),id),live=this.clients.get(item.bindingId);requireValue(live,409,'matrix_disconnected',RECORD_LOST);
      this.repository.mutate(store=>remember(store,requestId,'matrix_scale_cancel',payload,sessionId));
      let outcome:MatrixOutcome;try{outcome=await live.client.cancel(id);}catch(error){this.scaleCheckFailure(sessionId,id,error,true);return this.view(sessionId,undefined,id);}
      this.recordScaleOutcome(sessionId,id,outcome);return this.view(sessionId,undefined,id);
    }finally{this.busy.delete(sessionId);}
  }
  private scaleCheckFailure(sessionId:string,id:string,error:unknown,mutation=false){
    this.commit(sessionId,store=>{const value=session(store,sessionId),item=experiment(value,id);
      if(item.status!=='succeeded' && (item.status==='submitting'||mutation&&!(error instanceof MatrixClientError&&!error.outcomeUnknown)||error instanceof MatrixClientError&&error.code==='invalid_response')){item.status='unconfirmed';item.requiresApply=false;}
      item.checkError=safeFailure(error);item.lastCheckedAt=item.updatedAt=timestamp();touch(value);
    });
  }
  private recordScaleOutcome(sessionId:string,id:string,outcome:MatrixOutcome){
    const original=experiment(session(this.repository.snapshot(),sessionId),id);
    try{
      requireValue(outcome.requestId===original.id&&outcome.correlationId===original.correlationId&&outcome.sessionId===original.matrixSessionId&&outcome.runtimeSessionId===original.runtimeSessionId&&outcome.sequence>=original.sequence,502,'invalid_response','Mismatched experiment identity.');
      requireValue(outcome.commandIds.length<=1&&outcome.receipts.length<=1&&outcome.commandIds.every(safeId)&&outcome.receipts.every(ack=>safeId(ack.requestId)&&(ack.objectId===''||safeId(ack.objectId))),502,'invalid_response','Unbounded experiment receipts.');
      requireValue((original.commandIds.length===0||stable(original.commandIds)===stable(outcome.commandIds))&&original.receipts.every(known=>outcome.receipts.some(next=>next.requestId===known.requestId&&next.ok===known.ok&&next.objectId===known.objectId)),502,'invalid_response','Changed experiment receipts.');
      validateScaleOutcome(outcome,original.proof);
      const observed=verifiedScaleObservation(outcome,original.proof);
      requireValue(!observed||observed.revision>=original.expectedMatrixRevision,502,'invalid_response','Older experiment observation.');
      const unverifiable=outcome.status==='succeeded'&&!observed;
      const update={status:unverifiable?'unconfirmed' as const:outcome.status,sequence:outcome.sequence,requiresApply:unverifiable?false:outcome.requiresApply,
        proposalSummary:outcome.proposal?(original.action==='reset'?'Restore this block to its captured baseline. Review and Apply in the Matrix Operator.':`Scale this block from its captured baseline by X=${original.factors.x}, Y=${original.factors.y}, Z=${original.factors.z}. Review and Apply in the Matrix Operator.`):null,
        commandIds:[...outcome.commandIds],receipts:outcome.receipts.map(ack=>({...ack,error:ack.error?'The Matrix runtime reported a command error.':''})),observed,
        error:unverifiable?'Matrix reported completion without verified scale observation. Inspect the original request; no mathematical ratio is confirmed.':outcome.error?'Matrix reported an incomplete or rejected scale request. Inspect the Operator for details.':null};
      requireValue(!original.observed||stable(original.observed)===stable(observed)&&update.status==='succeeded',502,'invalid_response','Changed confirmed scale evidence.');
      requireValue(original.sequence===0||outcome.sequence!==original.sequence||['submitting','unconfirmed'].includes(original.status)||(original.status===update.status&&stable(original.receipts)===stable(update.receipts)&&stable(original.commandIds)===stable(update.commandIds)),502,'invalid_response','Conflicting experiment sequence.');
      this.commit(sessionId,store=>{const value=session(store,sessionId),item=experiment(value,id), first=!item.observed&&!!observed;
        const changed=Object.entries(update).some(([key,v])=>stable((item as unknown as Record<string,unknown>)[key])!==stable(v))||item.checkError!==undefined;
        Object.assign(item,update);delete item.checkError;item.lastCheckedAt=timestamp();
        if(changed){item.updatedAt=timestamp();touch(value);if(first)value.messages.push({id:randomUUID(),role:'system',stage:value.stage,createdAt:timestamp(),text:`Matrix acknowledged a static block scale change with mathematical volume ratio ${Number(observed!.mathematicalVolumeRatio.toPrecision(8))} relative to the captured baseline. This is historical virtual-transform evidence, not physical measurement, camera evidence, browser activity or mastery. The lesson stage is unchanged.`});}
      });
    }catch(error){if(error instanceof SchoolError&&error.code==='persistence_failed')throw error;this.scaleCheckFailure(sessionId,id,new MatrixClientError('invalid_response','Scale evidence mismatch.'));}
  }
  async requestSceneBuild(sessionId: string, raw: unknown): Promise<MatrixBridgeResponse> {
    const body = object(raw); fields(body, ['requestId','expectedRevision','bindingId','expectedMatrixRevision','turnId'], ['requestId','expectedRevision','bindingId','expectedMatrixRevision','turnId']);
    const requestId = identifier(body.requestId, 'request ID'), turnId = identifier(body.turnId, 'turn ID'); identifier(body.bindingId, 'binding ID');
    requireValue(requestId.length <= 96 && Number.isSafeInteger(body.expectedMatrixRevision) && Number(body.expectedMatrixRevision) >= 0, 400, 'invalid_request', 'Use a bounded request ID and current Matrix revision.');
    const payload = { sessionId, ...body }; this.flush(sessionId);
    const snapshot = this.repository.snapshot();
    const repeated = prior(snapshot, requestId, 'matrix_scene_build', payload);
    const existing = session(snapshot, sessionId).matrix?.sceneBuilds?.find(item => item.turnId === turnId);
    if (existing) {
      requireValue(existing.bindingId === body.bindingId, 409, 'request_conflict', 'This mentor suggestion already belongs to its original Matrix pairing. It cannot be replayed in another pairing.');
      if (!repeated) this.repository.mutate(store => remember(store, requestId, 'matrix_scene_build', payload, sessionId));
      return this.view(sessionId, undefined, undefined, existing.id);
    }
    requireValue(!repeated, 409, 'request_conflict', 'The saved scene build request no longer matches its original teaching intent.');
    this.enter(sessionId);
    try {
      const initial = this.view(sessionId); revision(initial.session, body.expectedRevision);
      const binding = initial.bridge.binding;
      requireValue(binding && initial.bridge.connected && binding.id === body.bindingId, 409, 'matrix_disconnected', RECORD_LOST);
      requireValue(!blocked(initial.session), 409, 'demonstration_pending', 'Reconcile pending or unconfirmed Matrix work before requesting another change.');
      const teaching = savedTeachingIntent(this.repository.snapshot(), sessionId, turnId);
      let ready: CachedReadiness;
      try { ready = await this.readReady(sessionId, binding); } catch (error) { throw new SchoolError(409, 'matrix_not_ready', safeFailure(error)); }
      requireValue(ready.scene.revision === body.expectedMatrixRevision, 409, 'matrix_revision_changed', 'The Matrix scene changed. Refresh before sending the teaching request.');
      const available = sceneBuilderReadiness(session(this.repository.snapshot(), sessionId), ready);
      requireValue(available.available, 409, 'matrix_not_ready', available.reason);
      this.repository.mutate(store => {
        const value = session(store, sessionId); revision(value, body.expectedRevision);
        requireValue(!blocked(value) && value.matrix?.activeBindingId === binding.id, 409, 'demonstration_pending', 'The lesson or Matrix pairing changed while readiness was being checked.');
        const current = savedTeachingIntent(store, sessionId, turnId);
        requireValue(stable(current) === stable(teaching), 409, 'stale_teaching_intent', 'The saved mentor suggestion changed. Refresh the lesson.');
        const state = ledger(value); state.sceneBuilds ??= [];
        requireValue(state.sceneBuilds.length < MAX_MATRIX_SCENE_BUILDS, 409, 'bridge_capacity', 'This lesson reached its scene-build limit. Existing records are preserved.');
        const at = timestamp();
        state.sceneBuilds.push({ id: requestId, bindingId: binding.id, matrixSessionId: binding.matrixSessionId!, runtimeSessionId: binding.runtimeSessionId!, correlationId: requestId,
          turnId, stage: teaching.stage, intent: teaching.intent, expectedMatrixRevision: ready.scene.revision,
          status: 'submitting', requiresApply: false, sequence: 0, createdAt: at, updatedAt: at, proposalSummary: null, commandIds: [], receipts: [], observed: null, error: null });
        touch(value); remember(store, requestId, 'matrix_scene_build', payload, sessionId);
      });
      this.readiness.delete(binding.id);
      let outcome: MatrixOutcome;
      try { outcome = await this.clients.get(binding.id)!.client.propose(teaching.intent.prompt, { requestId, correlationId: requestId, revision: ready.scene.revision, mode: 'codex-cli' }); }
      catch (error) {
        this.commit(sessionId, store => { const value = session(store, sessionId), item = sceneBuild(value, requestId); item.status = error instanceof MatrixClientError && !error.outcomeUnknown ? 'error' : 'unconfirmed'; item.error = safeFailure(error); item.updatedAt = timestamp(); touch(value); });
        return this.view(sessionId, undefined, undefined, requestId);
      }
      this.recordSceneBuildOutcome(sessionId, requestId, outcome); return this.view(sessionId, undefined, undefined, requestId);
    } finally { this.busy.delete(sessionId); }
  }
  async pollSceneBuild(sessionId: string, id: string): Promise<MatrixBridgeResponse> {
    this.flush(sessionId); const current = this.view(sessionId, undefined, undefined, id), item = current.sceneBuild!;
    if (this.busy.has(sessionId)) return current;
    const live = this.clients.get(item.bindingId);
    if (!live) { item.checkError = RECORD_LOST; return current; }
    this.enter(sessionId);
    try {
      let outcome: MatrixOutcome;
      try { outcome = await live.client.outcome(id); } catch (error) { this.sceneBuildCheckFailure(sessionId, id, error); return this.view(sessionId, undefined, undefined, id); }
      this.recordSceneBuildOutcome(sessionId, id, outcome); return this.view(sessionId, undefined, undefined, id);
    } finally { this.busy.delete(sessionId); }
  }
  async cancelSceneBuild(sessionId: string, id: string, raw: unknown): Promise<MatrixBridgeResponse> {
    const body = object(raw); fields(body, ['requestId'], ['requestId']); const requestId = identifier(body.requestId, 'request ID'), payload = { sessionId, id, ...body };
    this.flush(sessionId); if (prior(this.repository.snapshot(), requestId, 'matrix_scene_cancel', payload)) return this.view(sessionId, undefined, undefined, id);
    this.enter(sessionId);
    try {
      const item = sceneBuild(session(this.repository.snapshot(), sessionId), id), live = this.clients.get(item.bindingId);
      requireValue(live, 409, 'matrix_disconnected', RECORD_LOST);
      this.repository.mutate(store => remember(store, requestId, 'matrix_scene_cancel', payload, sessionId));
      let outcome: MatrixOutcome;
      try { outcome = await live.client.cancel(id); } catch (error) { this.sceneBuildCheckFailure(sessionId, id, error, true); return this.view(sessionId, undefined, undefined, id); }
      this.recordSceneBuildOutcome(sessionId, id, outcome); return this.view(sessionId, undefined, undefined, id);
    } finally { this.busy.delete(sessionId); }
  }
  private sceneBuildCheckFailure(sessionId: string, id: string, error: unknown, mutation = false) {
    this.commit(sessionId, store => {
      const value = session(store, sessionId), item = sceneBuild(value, id);
      if (!item.observed && (item.status === 'submitting' || mutation && !(error instanceof MatrixClientError && !error.outcomeUnknown) || error instanceof MatrixClientError && ['invalid_response','out_of_order'].includes(error.code))) { item.status = 'unconfirmed'; item.requiresApply = false; }
      item.checkError = safeFailure(error); item.lastCheckedAt = item.updatedAt = timestamp(); touch(value);
    });
  }
  private recordSceneBuildOutcome(sessionId: string, id: string, outcome: MatrixOutcome) {
    const original = sceneBuild(session(this.repository.snapshot(), sessionId), id);
    try {
      const invalid = (condition: unknown, message: string) => requireValue(condition, 502, 'invalid_response', message);
      invalid(outcome.requestId === original.id && outcome.correlationId === original.correlationId && outcome.sessionId === original.matrixSessionId && outcome.runtimeSessionId === original.runtimeSessionId && outcome.sequence >= original.sequence, 'Mismatched scene build identity.');
      invalid(outcome.commandIds.length <= 20 && outcome.receipts.length <= 20 && outcome.commandIds.every(safeId) && outcome.receipts.every(ack => safeId(ack.requestId) && (ack.objectId === '' || safeId(ack.objectId)) && (!ack.ok || ack.error === '')), 'Unbounded or contradictory scene receipts.');
      invalid((original.commandIds.length === 0 || stable(original.commandIds) === stable(outcome.commandIds)) && original.receipts.every(known => outcome.receipts.some(next => known.requestId === next.requestId && known.ok === next.ok && known.objectId === next.objectId && Boolean(known.error) === Boolean(next.error))), 'Changed scene build receipts.');
      invalid(outcome.requiresApply === (outcome.status === 'ready') && outcome.experiment === undefined, 'Unexpected scene build authority or experiment.');
      const before = ['planning','ready','cancelled','stale','needs_clarification','review_only','error'].includes(outcome.status);
      if (before) invalid(outcome.commandIds.length === 0 && outcome.receipts.length === 0 && outcome.observed === null, 'Nonexecuted scene request contains execution evidence.');
      if (['queued','running'].includes(outcome.status)) invalid(outcome.commandIds.length > 0 && outcome.receipts.length < outcome.commandIds.length && outcome.observed === null, 'Invalid pending scene command evidence.');
      if (outcome.status === 'unconfirmed') invalid(outcome.observed === null, 'Unconfirmed scene request contains a confirmed observation.');
      const commands = outcome.proposal?.commands;
      if (['ready','queued','running','succeeded','failed','partial'].includes(outcome.status)) invalid(Array.isArray(commands) && commands.length > 0 && commands.length <= 20 && commands.every(command => record(command) && typeof command.op === 'string'), 'Missing bounded reviewed scene proposal.');
      const proposalDigest = outcome.proposal ? fingerprint(outcome.proposal) : undefined;
      invalid(!original.proposalDigest || proposalDigest === original.proposalDigest, 'The original reviewed scene proposal changed.');
      if (outcome.commandIds.length > 0) invalid(Array.isArray(commands) && commands.length === outcome.commandIds.length, 'Queued commands do not match the reviewed batch size.');
      let observed: MatrixSceneBuild['observed'] = null;
      if (['succeeded','failed','partial'].includes(outcome.status)) {
        invalid(outcome.observed && outcome.observed.revision >= original.expectedMatrixRevision, 'Missing original scene observation.');
        if (outcome.observed && 'savedScene' in outcome.observed) {
          const command = Array.isArray(commands) && commands.length === 1 ? commands[0] : null;
          invalid(outcome.status === 'succeeded' && outcome.commandIds.length === 0 && outcome.receipts.length === 0 && record(command) && command.op === 'save_scene' && command.name === outcome.observed.savedScene && /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(outcome.observed.savedScene), 'PC save evidence does not match the reviewed save command.');
          observed = { source: 'matrix-pc-save', revision: outcome.observed.revision, savedScene: outcome.observed.savedScene };
        } else {
          invalid(outcome.observed && 'snapshot' in outcome.observed && record(outcome.observed.snapshot.scene) && outcome.observed.snapshot.scene.schemaVersion === 1 && Array.isArray(outcome.observed.snapshot.scene.objects), 'Missing paired runtime scene snapshot.');
          invalid(outcome.commandIds.length > 0 && outcome.receipts.length === outcome.commandIds.length, 'Incomplete scene receipts.');
          const successes = outcome.receipts.filter(ack => ack.ok);
          const status = successes.length === outcome.receipts.length ? 'succeeded' : successes.length === 0 ? 'failed' : 'partial';
          invalid(outcome.status === status, 'Scene status contradicts runtime receipts.');
          observed = { source: 'matrix-runtime', revision: outcome.observed!.revision, confirmedCommandCount: successes.length, failedCommandCount: outcome.receipts.length - successes.length, objectIds: [...new Set(successes.map(ack => ack.objectId).filter(Boolean))] };
        }
      }
      const digest = fingerprint(outcome);
      invalid(!original.outcomeDigest || outcome.sequence !== original.sequence || digest === original.outcomeDigest, 'Same-sequence scene evidence changed.');
      invalid(!original.observed || outcome.status === original.status && stable(observed) === stable(original.observed), 'Confirmed scene evidence changed.');
      const update = {
        status: outcome.status, sequence: outcome.sequence, requiresApply: outcome.requiresApply, outcomeDigest: digest,
        ...(proposalDigest ? { proposalDigest } : {}),
        proposalSummary: Array.isArray(commands) && commands.length ? `Matrix proposed ${commands.length} scene operation${commands.length === 1 ? '' : 's'}. Review the full proposal and its assumptions in the Matrix Operator before Apply.` : outcome.proposal ? 'Matrix returned planning feedback. Inspect this request in the Matrix Operator.' : null,
        commandIds: [...outcome.commandIds], receipts: outcome.receipts.map(ack => ({ ...ack, error: ack.error ? 'The Matrix runtime reported a command error.' : '' })), observed,
        error: outcome.error ? 'Matrix reported an incomplete or rejected scene request. Inspect its original Operator request for details.' : null,
      };
      this.commit(sessionId, store => {
        const value = session(store, sessionId), item = sceneBuild(value, id), first = !item.observed && !!observed;
        const changed = Object.entries(update).some(([key, v]) => stable((item as unknown as Record<string, unknown>)[key]) !== stable(v)) || item.checkError !== undefined;
        Object.assign(item, update); delete item.checkError; item.lastCheckedAt = timestamp();
        if (changed) {
          item.updatedAt = timestamp(); touch(value);
          if (first) value.messages.push({ id: randomUUID(), role: 'system', stage: value.stage, createdAt: timestamp(), text: observed!.source === 'matrix-pc-save'
            ? 'Matrix confirmed a scene save on the PC. This is not a Unity execution receipt or proof of physical learning outcomes. The lesson stage is unchanged.'
            : `Matrix reported ${observed!.confirmedCommandCount} successful and ${observed!.failedCommandCount} failed scene commands with a runtime snapshot. This is historical virtual-scene evidence, not camera evidence, physical measurement, browser activity or learner mastery. The lesson stage is unchanged.` });
        }
      });
    } catch (error) { if (error instanceof SchoolError && error.code === 'persistence_failed') throw error; this.sceneBuildCheckFailure(sessionId, id, new MatrixClientError('invalid_response', 'Scene build evidence mismatch.')); }
  }
  close() {
    if (this.closed) return;
    try {
      if (Object.values(this.repository.snapshot().sessions).some(value => value.matrix?.bindings.some(binding => ['paired','pairing'].includes(binding.status)) || allWork(value).some(demo => MATRIX_ACTIVE_STATUSES.has(demo.status)))) this.repository.mutate(store => this.interrupt(store));
    }
    finally { this.closed = true; this.clients.clear(); this.readiness.clear(); this.pendingCommits.clear(); }
  }
}
