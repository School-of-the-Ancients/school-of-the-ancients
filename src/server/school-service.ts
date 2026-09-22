import { randomUUID } from 'node:crypto';
import type { CreateTurnRequest, LessonStage, MentorTurn, SchoolSession, SessionResponse, TurnResponse } from '../shared/contracts.ts';
import { GALILEO, OBSERVATION_LESSON, STAGES, stageContent } from './content.ts';
import { fields, identifier, learnerText, object, requireValue, SchoolError } from './errors.ts';
import { FileSchoolRepository, fingerprint } from './repository.ts';
import type { RequestReceipt, SchoolStore } from './repository.ts';
import type { MentorProvider } from './providers.ts';
import { MatrixLessonBridge } from './matrix-bridge.ts';
import type { MatrixClientOptions } from '../integrations/matrix-client.ts';

const now = () => new Date().toISOString();
const MAX_CONCURRENT_PROVIDER_TURNS = 3;
function getSession(store: SchoolStore, id: string): SchoolSession {
  identifier(id, 'session ID'); requireValue(Object.hasOwn(store.sessions, id), 404, 'not_found', 'Lesson session not found.'); return store.sessions[id];
}
function getTurn(store: SchoolStore, id: string): MentorTurn {
  identifier(id, 'turn ID'); requireValue(Object.hasOwn(store.turns, id), 404, 'not_found', 'Teaching turn not found.'); return store.turns[id];
}
function touch(session: SchoolSession) { session.revision += 1; session.updatedAt = now(); session.savedAt = session.updatedAt; }
function response(session: SchoolSession): SessionResponse { return { apiVersion: 1, session: structuredClone(session) }; }
function turnResponse(store: SchoolStore, turn: MentorTurn): TurnResponse { return { ...response(getSession(store, turn.sessionId)), turn: structuredClone(turn) }; }
function checkRevision(session: SchoolSession, value: unknown) {
  requireValue(Number.isSafeInteger(value) && value === session.revision, 409, 'stale_revision', 'This lesson changed. Refresh it before submitting again.');
}
function receipt(store: SchoolStore, requestId: string, kind: RequestReceipt['kind'], payload: unknown): RequestReceipt | undefined {
  const prior = Object.hasOwn(store.receipts, requestId) ? store.receipts[requestId] : undefined;
  if (prior) requireValue(prior.kind === kind && prior.fingerprint === fingerprint(payload), 409, 'request_conflict', 'This request ID was already used with different data.');
  return prior;
}
function remember(store: SchoolStore, id: string, kind: RequestReceipt['kind'], payload: unknown, resourceId: string) { store.receipts[id] = { kind, fingerprint: fingerprint(payload), resourceId }; }
function nextStage(session: SchoolSession, body: CreateTurnRequest): LessonStage {
  if (body.kind === 'question') return session.stage;
  requireValue(session.stage !== 'ended', 409, 'lesson_complete', 'This lesson is complete. Start a new attempt to continue experimenting.');
  if (body.kind === 'advance') requireValue(session.stage === 'explain', 422, 'answer_required', 'Record your response before moving to the next stage.');
  if (session.stage === 'guided_practice') {
    requireValue(session.events.some((event) => event.type === 'experiment_applied'), 422, 'experiment_required', 'Apply the experiment before recording your observation.');
    requireValue(session.artifact.dimensions.every((value) => Math.abs(value - 2) <= 0.00001), 422, 'experiment_required', 'For this practice, apply width 2, height 2, and depth 2 before submitting your observation.');
  }
  return STAGES[STAGES.indexOf(session.stage) + 1];
}

export class SchoolService {
  repository: FileSchoolRepository;
  provider: MentorProvider;
  readonly matrix: MatrixLessonBridge;
  private running = new Map<string, AbortController>();
  private pendingStorageFailures = new Map<string, string>();
  private closed = false;
  constructor(repository: FileSchoolRepository, provider: MentorProvider, options: { matrix?: MatrixClientOptions } = {}) {
    this.repository = repository; this.provider = provider;
    if (Object.values(repository.snapshot().turns).some((turn) => turn.status === 'running')) {
      repository.mutate((store) => {
        for (const turn of Object.values(store.turns)) if (turn.status === 'running') {
          turn.status = 'interrupted'; turn.error = 'The School service restarted before this turn completed. Your input was saved. Submit a new turn to try again.'; turn.completedAt = now();
          const session = getSession(store, turn.sessionId); delete session.activeTurnId; touch(session);
          session.events.push({ id: randomUUID(), type: 'turn_interrupted', createdAt: now(), stage: session.stage, details: turn.error });
        }
      });
    }
    this.matrix = new MatrixLessonBridge(repository, options.matrix);
  }
  catalog() { return { apiVersion: 1 as const, mentors: [structuredClone(GALILEO)], lessons: [structuredClone(OBSERVATION_LESSON)], provider: this.provider.status() }; }
  capabilities() {
    return { apiVersion: 1 as const, provider: this.provider.status(), capabilities: [
      { id: 'lesson.text.v1', version: 1, available: true, reason: 'Standalone mentor lesson and durable transcript.' },
      { id: 'experiment.scale.v1', version: 1, available: true, reason: 'Deterministic browser geometry illustration; not a Unity or physical-room observation.' },
      { id: 'mentor.voice.v1', version: 1, available: false, reason: 'Voice is a planned optional adapter. This candidate supports text.' },
      { id: 'matrix.scene.v1', version: 1, available: true, reason: 'Optional local companion adapter. Each lesson needs explicit pairing and current readiness; the Matrix owner controls Apply.' },
    ] };
  }
  listSessions() { return { apiVersion: 1 as const, sessions: Object.values(this.repository.snapshot().sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }; }
  session(id: string) { return response(getSession(this.repository.snapshot(), id)); }
  turn(id: string) {
    const pending = this.pendingStorageFailures.get(id);
    if (pending) {
      try { this.persistFailure(id, pending); this.pendingStorageFailures.delete(id); }
      catch { throw new SchoolError(503, 'persistence_failed', 'The mentor turn ended, but its outcome cannot be saved. Your input remains saved. Resolve local storage and retry this status request; no new model call will be made.'); }
    }
    const store = this.repository.snapshot(); return turnResponse(store, getTurn(store, id));
  }
  export(id: string) { const store = this.repository.snapshot(); return { apiVersion: 1 as const, format: 'school-session-export-v1', exportedAt: now(), session: getSession(store, id), turns: Object.values(store.turns).filter((turn) => turn.sessionId === id), disclosure: 'Local learning record. Browser experiments model geometry. Participation is not mastery; this export is not a Matrix room save.' }; }
  start(raw: unknown): SessionResponse {
    const body = object(raw); fields(body, ['requestId', 'mentorId', 'lessonId'], ['requestId', 'mentorId', 'lessonId']);
    const requestId = identifier(body.requestId, 'request ID');
    return this.repository.mutate((store) => {
      const prior = receipt(store, requestId, 'start', body); if (prior) return response(getSession(store, prior.resourceId));
      requireValue(body.mentorId === GALILEO.id && body.lessonId === OBSERVATION_LESSON.id, 404, 'content_unavailable', 'Choose a mentor and lesson from the available catalog.');
      const id = randomUUID(); const timestamp = now(); const stage = 'explain'; const content = stageContent(OBSERVATION_LESSON, stage);
      const session: SchoolSession = { id, revision: 1, mentorId: GALILEO.id, lessonId: OBSERVATION_LESSON.id, lessonVersion: OBSERVATION_LESSON.version,
        mentor: structuredClone(GALILEO), lesson: structuredClone(OBSERVATION_LESSON), stage, stageContent: content, status: 'active',
        messages: [{ id: randomUUID(), role: 'mentor', text: content.explanation + '\n\n' + content.prompt, stage, createdAt: timestamp }],
        events: [{ id: randomUUID(), type: 'session_started', stage, createdAt: timestamp, details: 'Started a new authored lesson. Opening guidance is scripted.' }],
        artifact: { type: 'scale', dimensions: [1, 1, 1], baseline: [1, 1, 1], volume: 1, volumeRatio: 1, units: 'units', observedAt: timestamp, source: 'browser-deterministic' },
        createdAt: timestamp, updatedAt: timestamp, savedAt: timestamp, completionLabel: 'In progress. Participation and reflection are recorded; mastery is not assessed.' };
      store.sessions[id] = session; remember(store, requestId, 'start', body, id); return response(session);
    });
  }
  createTurn(sessionId: string, raw: unknown): TurnResponse {
    requireValue(!this.closed, 503, 'service_closed', 'The School service is stopping.');
    const body = object(raw); fields(body, ['requestId', 'expectedRevision', 'kind', 'text'], ['requestId', 'expectedRevision', 'kind']);
    const requestId = identifier(body.requestId, 'request ID');
    requireValue(typeof body.kind === 'string' && ['question', 'answer', 'advance'].includes(body.kind), 400, 'invalid_request', 'Choose a question, answer, or advance action.');
    const kind = body.kind as CreateTurnRequest['kind']; const text = learnerText(body.text, kind !== 'advance');
    let target: LessonStage | undefined; let created = false;
    const payload = { sessionId, ...body };
    const result = this.repository.mutate((store) => {
      const prior = receipt(store, requestId, 'turn', payload); if (prior) return turnResponse(store, getTurn(store, prior.resourceId));
      const session = getSession(store, sessionId); checkRevision(session, body.expectedRevision);
      requireValue(!session.activeTurnId, 409, 'turn_pending', 'Wait for the mentor or cancel the current turn.');
      requireValue(session.status === 'active', 409, 'lesson_complete', 'This lesson is complete. Start a new attempt to continue.');
      requireValue(this.running.size < MAX_CONCURRENT_PROVIDER_TURNS, 503, 'provider_busy', 'The mentor is handling other lessons. Your message was not submitted. Keep it here and retry shortly.');
      requireValue(this.provider.status().available, 503, 'provider_unavailable', this.provider.status().reason);
      target = nextStage(session, { requestId, expectedRevision: body.expectedRevision as number, kind, text });
      const id = randomUUID(); const turn: MentorTurn = { id, sessionId, requestId, kind, input: text, stage: session.stage, status: 'running', createdAt: now() };
      store.turns[id] = turn; session.activeTurnId = id;
      session.messages.push({ id: randomUUID(), role: 'learner', text: text || 'Continue to the example.', stage: session.stage, turnId: id, createdAt: now() }); touch(session);
      remember(store, requestId, 'turn', payload, id); created = true; return turnResponse(store, turn);
    });
    if (created && target) {
      const controller = new AbortController(); this.running.set(result.turn.id, controller);
      void this.runTurn(result, target, controller);
    }
    return result;
  }
  private async runTurn(initial: TurnResponse, target: LessonStage, controller: AbortController) {
    try {
      const result = await this.provider.respond({ session: initial.session, turn: initial.turn, target: stageContent(initial.session.lesson, target) }, controller.signal);
      if (this.closed || controller.signal.aborted) return;
      requireValue(typeof result.text === 'string' && result.text.trim().length > 0 && result.text.length <= 8000 && result.receipt.completedTurn === true && result.receipt.toolCallCount === 0 && ['demo', 'codex-cli'].includes(result.receipt.mode), 502, 'provider_invalid', 'The mentor returned invalid teaching text.');
      this.repository.mutate((store) => {
        const turn = getTurn(store, initial.turn.id); if (turn.status !== 'running') return;
        const session = getSession(store, turn.sessionId); requireValue(session.activeTurnId === turn.id, 409, 'turn_stale', 'The active teaching turn changed.');
        turn.status = 'completed'; turn.completedAt = now(); turn.output = result.text; turn.receipt = result.receipt;
        if (session.stage !== target) session.events.push({ id: randomUUID(), type: 'stage_changed', stage: target, createdAt: now(), details: `Advanced from ${session.stage} to ${target}; participation recorded, not mastery.` });
        session.stage = target; session.stageContent = stageContent(session.lesson, target); session.status = target === 'ended' ? 'completed' : 'active';
        if (target === 'ended') session.completionLabel = 'Activity completed. Prediction, experiment, explanation, and reflection recorded. Mastery was not assessed.';
        session.messages.push({ id: randomUUID(), role: 'mentor', text: result.text, stage: target, turnId: turn.id, createdAt: now(), providerMode: result.receipt.mode });
        delete session.activeTurnId; touch(session);
      });
    } catch (error) {
      if (this.closed || controller.signal.aborted) return;
      const message = error instanceof SchoolError ? error.message : 'The mentor could not complete this turn. Your input remains saved; try again.';
      try { this.persistFailure(initial.turn.id, message); }
      catch { this.pendingStorageFailures.set(initial.turn.id, 'The mentor result could not be saved. Your input was preserved and the lesson did not advance. Submit a new turn if you want another response.'); }
    } finally { this.running.delete(initial.turn.id); }
  }
  private persistFailure(id: string, message: string) {
    this.repository.mutate((store) => {
      const turn = getTurn(store, id); if (turn.status !== 'running') return;
      turn.status = 'failed'; turn.error = message; turn.completedAt = now(); const session = getSession(store, turn.sessionId);
      delete session.activeTurnId; touch(session); session.events.push({ id: randomUUID(), type: 'turn_failed', stage: session.stage, createdAt: now(), details: message });
    });
  }
  cancel(turnId: string, raw: unknown): TurnResponse {
    const body = object(raw); fields(body, ['requestId'], ['requestId']); const requestId = identifier(body.requestId, 'request ID'); const payload = { turnId, ...body };
    const result = this.repository.mutate((store) => {
      const prior = receipt(store, requestId, 'cancel', payload); if (prior) return turnResponse(store, getTurn(store, prior.resourceId));
      const turn = getTurn(store, turnId); const session = getSession(store, turn.sessionId);
      if (turn.status === 'running') {
        turn.status = 'cancelled'; turn.completedAt = now(); turn.error = 'Cancelled. Your input remains saved and the lesson stage did not advance.';
        delete session.activeTurnId; touch(session); session.events.push({ id: randomUUID(), type: 'turn_cancelled', stage: session.stage, createdAt: now(), details: turn.error });
      }
      remember(store, requestId, 'cancel', payload, turn.id); return turnResponse(store, turn);
    });
    this.running.get(turnId)?.abort(); return result;
  }
  experiment(sessionId: string, raw: unknown): SessionResponse {
    const body = object(raw); fields(body, ['requestId', 'expectedRevision', 'dimensions'], ['requestId', 'expectedRevision', 'dimensions']);
    const requestId = identifier(body.requestId, 'request ID'); const dimensions = body.dimensions;
    requireValue(Array.isArray(dimensions) && dimensions.length === 3 && dimensions.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 4), 400, 'invalid_dimensions', 'Each dimension must be between 0.25 and 4 simulated units.');
    const payload = { sessionId, ...body };
    return this.repository.mutate((store) => {
      const prior = receipt(store, requestId, 'experiment', payload); if (prior) return response(getSession(store, prior.resourceId));
      const session = getSession(store, sessionId); checkRevision(session, body.expectedRevision);
      requireValue(!session.activeTurnId, 409, 'turn_pending', 'Wait for the mentor or cancel the current turn before changing the experiment.');
      requireValue(session.status === 'active', 409, 'lesson_complete', 'This completed record is preserved. Start a new attempt to experiment.');
      const volume = Number((dimensions[0] * dimensions[1] * dimensions[2]).toFixed(8));
      session.artifact = { ...session.artifact, dimensions: [...dimensions] as [number, number, number], volume, volumeRatio: volume, observedAt: now() };
      const details = `Browser simulation: ${dimensions.join(' × ')} = ${volume} cubic units (${volume}× starting volume). This is a mathematical illustration, not a Unity or physical-room observation.`;
      session.events.push({ id: randomUUID(), type: 'experiment_applied', stage: session.stage, createdAt: now(), details });
      session.messages.push({ id: randomUUID(), role: 'system', text: details, stage: session.stage, createdAt: now() });
      touch(session); remember(store, requestId, 'experiment', payload, session.id); return response(session);
    });
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const controller of this.running.values()) controller.abort();
    try { this.matrix.close(); if (this.running.size) this.repository.mutate((store) => { for (const id of this.running.keys()) {
      const turn = getTurn(store, id); if (turn.status !== 'running') continue; turn.status = 'interrupted'; turn.completedAt = now(); turn.error = 'The School service stopped before this turn completed. Your input remains saved.';
      const session = getSession(store, turn.sessionId); delete session.activeTurnId; touch(session); session.events.push({ id: randomUUID(), type: 'turn_interrupted', createdAt: now(), stage: session.stage, details: turn.error });
    } }); } finally { this.repository.close(); }
  }
}
