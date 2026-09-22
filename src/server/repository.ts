import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MentorTurn, SchoolSession } from '../shared/contracts.ts';
import { requireValue, SchoolError } from './errors.ts';
import { validateMatrixLedger } from './matrix-ledger.ts';

export interface RequestReceipt { fingerprint: string; kind: 'start' | 'turn' | 'cancel' | 'experiment' | 'matrix_pair' | 'matrix_disconnect' | 'matrix_demonstration' | 'matrix_cancel'; resourceId: string; }
export interface SchoolStore { formatVersion: 1; sessions: Record<string, SchoolSession>; turns: Record<string, MentorTurn>; receipts: Record<string, RequestReceipt>; }
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SESSIONS = 200;
const MAX_TURNS = 5000;
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  return JSON.stringify(value);
}
export function fingerprint(value: unknown) { return createHash('sha256').update(stable(value)).digest('hex'); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function savedId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value); }
function savedDate(value: unknown) { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function savedText(value: unknown, max = 10000) { return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value); }
function savedEnum(value: unknown, allowed: readonly string[]) { return typeof value === 'string' && allowed.includes(value); }
function validStore(value: unknown): asserts value is SchoolStore {
  requireValue(record(value) && value.formatVersion === 1 && record(value.sessions) && record(value.turns) && record(value.receipts), 500, 'invalid_store', 'Saved School records are invalid; existing data was preserved.');
  requireValue(Object.keys(value.sessions).length <= MAX_SESSIONS && Object.keys(value.turns).length <= MAX_TURNS && Object.keys(value.receipts).length <= 10000, 409, 'store_capacity', 'Local record capacity reached. Export records before changing storage.');
  for (const [id, raw] of Object.entries(value.sessions)) {
    requireValue(record(raw) && savedId(id) && raw.id === id && Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 1 && savedEnum(raw.stage, ['explain', 'example', 'guided_practice', 'socratic_check', 'recap', 'ended']) && Array.isArray(raw.messages) && raw.messages.length <= 1000 && Array.isArray(raw.events) && raw.events.length <= 1000 && record(raw.lesson) && record(raw.mentor) && record(raw.artifact) && savedDate(raw.createdAt) && savedDate(raw.updatedAt) && savedDate(raw.savedAt), 500, 'invalid_store', 'Saved School session is invalid; existing data was preserved.');
    requireValue(raw.lessonId === raw.lesson.id && raw.lessonVersion === raw.lesson.version && raw.mentorId === raw.mentor.id && Array.isArray(raw.lesson.stages) && raw.lesson.stages.some((stage: unknown) => record(stage) && stage.stage === raw.stage), 500, 'invalid_store', 'Saved content identity is inconsistent; existing data was preserved.');
    const currentContent = raw.lesson.stages.find((stage: unknown) => record(stage) && stage.stage === raw.stage);
    requireValue(stable(currentContent) === stable(raw.stageContent) && raw.status === (raw.stage === 'ended' ? 'completed' : 'active'), 500, 'invalid_store', 'Saved lesson presentation is inconsistent; existing data was preserved.');
    const dimensions = raw.artifact.dimensions;
    requireValue(Array.isArray(dimensions) && dimensions.length === 3 && dimensions.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0.25 && item <= 4) && raw.artifact.source === 'browser-deterministic', 500, 'invalid_store', 'Saved experiment is invalid; existing data was preserved.');
    const derivedVolume = Number((dimensions[0] * dimensions[1] * dimensions[2]).toFixed(8));
    requireValue(raw.artifact.volume === derivedVolume && raw.artifact.volumeRatio === derivedVolume && stable(raw.artifact.baseline) === '[1,1,1]' && raw.artifact.units === 'units' && raw.artifact.type === 'scale' && savedDate(raw.artifact.observedAt), 500, 'invalid_store', 'Saved experiment calculations are inconsistent; existing data was preserved.');
    for (const message of raw.messages) requireValue(record(message) && savedId(message.id) && savedText(message.text) && savedDate(message.createdAt) && savedEnum(message.role, ['learner', 'mentor', 'system']), 500, 'invalid_store', 'Saved transcript is invalid; existing data was preserved.');
    for (const event of raw.events) requireValue(record(event) && savedId(event.id) && savedDate(event.createdAt) && savedText(event.details) && savedEnum(event.type, ['session_started', 'stage_changed', 'experiment_applied', 'turn_cancelled', 'turn_failed', 'turn_interrupted']), 500, 'invalid_store', 'Saved lesson event is invalid; existing data was preserved.');
    if (raw.matrix !== undefined) {
      validateMatrixLedger(raw.matrix);
      const savedSources = Array.isArray(raw.lesson.sources) ? raw.lesson.sources : [];
      for (const demo of raw.matrix.demonstrations) {
        const identity = demo.exhibit.identity;
        requireValue(identity.lesson.id === raw.lessonId && identity.lesson.version === raw.lessonVersion &&
          identity.mentor.id === raw.mentorId && identity.mentor.promptVersion === raw.mentor.promptVersion &&
          identity.sources.every(source => savedSources.some(saved => record(saved) && saved.id === source.id && saved.kind === source.kind)),
        500, 'invalid_store', 'Saved Matrix exhibit references do not match the preserved lesson; existing data was preserved.');
      }
    }
    if (raw.activeTurnId !== undefined) {
      const pending = savedId(raw.activeTurnId) ? value.turns[raw.activeTurnId] : undefined;
      requireValue(record(pending) && pending.sessionId === id && pending.status === 'running', 500, 'invalid_store', 'Saved active turn is inconsistent; existing data was preserved.');
    }
  }
  for (const [id, raw] of Object.entries(value.turns)) {
    requireValue(record(raw) && savedId(id) && raw.id === id && typeof raw.sessionId === 'string' && Object.hasOwn(value.sessions, raw.sessionId) && savedId(raw.requestId) && savedText(raw.input, 4000) && savedDate(raw.createdAt) && savedEnum(raw.kind, ['question', 'answer', 'advance']) && savedEnum(raw.status, ['running', 'completed', 'failed', 'cancelled', 'interrupted']), 500, 'invalid_store', 'Saved turn is invalid; existing data was preserved.');
    const session = value.sessions[raw.sessionId] as SchoolSession;
    requireValue(raw.status !== 'running' || session.activeTurnId === id, 500, 'invalid_store', 'Saved running turn is inconsistent; existing data was preserved.');
    requireValue(raw.status === 'running' || savedDate(raw.completedAt), 500, 'invalid_store', 'Saved turn completion is invalid; existing data was preserved.');
    if (raw.status === 'completed') requireValue(savedText(raw.output, 8000) && record(raw.receipt) && raw.receipt.completedTurn === true && raw.receipt.toolCallCount === 0 && savedEnum(raw.receipt.mode, ['demo', 'codex-cli']), 500, 'invalid_store', 'Saved provider receipt is invalid; existing data was preserved.');
  }
  for (const [id, raw] of Object.entries(value.receipts)) {
    requireValue(savedId(id) && record(raw) && typeof raw.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(raw.fingerprint) && typeof raw.resourceId === 'string' && savedEnum(raw.kind, ['start', 'turn', 'cancel', 'experiment', 'matrix_pair', 'matrix_disconnect', 'matrix_demonstration', 'matrix_cancel']), 500, 'invalid_store', 'Saved receipt is invalid; existing data was preserved.');
    requireValue(Object.hasOwn(raw.kind === 'turn' || raw.kind === 'cancel' ? value.turns : value.sessions, raw.resourceId), 500, 'invalid_store', 'Saved receipt points to a missing record; existing data was preserved.');
  }
}

/** One process owns a directory. Incomplete turns are reconciled by the lesson service. */
export class FileSchoolRepository {
  readonly directory: string;
  private file: string;
  private lock: string;
  private lockId: string;
  private data: SchoolStore;
  private closed = false;
  constructor(directory: string) {
    this.directory = resolve(directory); mkdirSync(this.directory, { recursive: true });
    this.file = join(this.directory, 'school-store.json'); this.lock = join(this.directory, '.writer.lock'); this.lockId = randomUUID();
    let fd: number;
    try { fd = openSync(this.lock, 'wx'); }
    catch { throw new SchoolError(409, 'store_locked', 'Another School process owns these records, or an interrupted process left a lock. Stop that process before recovery.'); }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, owner: this.lockId })); fsyncSync(fd); } finally { closeSync(fd); }
    try {
      if (existsSync(this.file)) {
        requireValue(!lstatSync(this.file).isSymbolicLink() && lstatSync(this.file).size <= MAX_BYTES, 500, 'invalid_store', 'Saved School records are invalid or too large.');
        this.data = JSON.parse(readFileSync(this.file, 'utf8')) as SchoolStore; validStore(this.data);
      } else this.data = { formatVersion: 1, sessions: {}, turns: {}, receipts: {} };
    } catch (error) { this.close(); throw error instanceof SchoolError ? error : new SchoolError(500, 'invalid_store', 'Cannot read saved School records; existing data was preserved.'); }
  }
  snapshot(): SchoolStore { return structuredClone(this.data); }
  mutate<T>(change: (draft: SchoolStore) => T): T {
    requireValue(!this.closed, 503, 'store_closed', 'Record storage is closed.');
    const draft = structuredClone(this.data); const result = change(draft); validStore(draft);
    const encoded = JSON.stringify(draft); requireValue(Buffer.byteLength(encoded) <= MAX_BYTES, 409, 'store_capacity', 'Local record capacity reached.');
    const temporary = join(this.directory, `.store-${randomUUID()}.tmp`);
    try {
      const fd = openSync(temporary, 'wx'); try { writeFileSync(fd, encoded); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.file); this.data = draft;
    } catch { throw new SchoolError(500, 'persistence_failed', 'The change could not be saved. Existing records were preserved.'); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return structuredClone(result);
  }
  close() {
    if (this.closed) return; this.closed = true;
    try { const owner = JSON.parse(readFileSync(this.lock, 'utf8')); if (owner.owner === this.lockId) unlinkSync(this.lock); } catch { /* Preserve an unknown lock. */ }
  }
}
