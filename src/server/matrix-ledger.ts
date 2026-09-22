import type { MatrixLessonLedger } from '../shared/contracts.ts';
import { requireValue, SchoolError } from './errors.ts';

export const MATRIX_ACTIVE_STATUSES = new Set(['submitting', 'planning', 'ready', 'queued', 'running']);
export const MATRIX_STATUSES = [...MATRIX_ACTIVE_STATUSES, 'succeeded', 'failed', 'partial', 'cancelled', 'stale', 'unconfirmed', 'needs_clarification', 'review_only', 'error'];
export const MAX_MATRIX_BINDINGS = 16;
export const MAX_MATRIX_DEMONSTRATIONS = 64;
export const MAX_MATRIX_EXPERIMENTS = 64;
export const MATRIX_BLOCKING_STATUSES = new Set([...MATRIX_ACTIVE_STATUSES, 'unconfirmed']);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 512) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v);
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const date = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const enumValue = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function check(condition: unknown): asserts condition { requireValue(condition, 500, 'invalid_store', 'Saved Matrix demonstration records are invalid; existing data was preserved.'); }
function keys(value: Record<string, unknown>, allowed: string[]) { check(Object.keys(value).every((key) => allowed.includes(key))); }
function vector(value: unknown) { return record(value) && Object.keys(value).length === 3 && ['x', 'y', 'z'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && Math.abs(value[key] as number) <= 100000); }
export function localMatrixOrigin(value: unknown): string {
  requireValue(typeof value === 'string' && value.length <= 128, 400, 'invalid_url', 'Enter a local Matrix HTTP(S) address.');
  let url: URL; try { url = new URL(value); } catch { throw new SchoolError(400, 'invalid_url', 'Enter a valid local Matrix HTTP(S) address.'); }
  requireValue(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 400, 'invalid_url', 'Matrix must be a loopback HTTP(S) origin without credentials or a path.');
  return url.origin;
}

/** Exact field allowlists prevent accidentally persisting bearer tokens, pairing codes or room dumps. */
export function validateMatrixLedger(value: unknown): asserts value is MatrixLessonLedger {
  check(record(value)); keys(value, ['bindings', 'activeBindingId', 'demonstrations', 'experiments']);
  check(Array.isArray(value.bindings) && value.bindings.length <= MAX_MATRIX_BINDINGS && Array.isArray(value.demonstrations) && value.demonstrations.length <= MAX_MATRIX_DEMONSTRATIONS);
  const bindingIds = new Set<string>();
  for (const binding of value.bindings) {
    check(record(binding)); keys(binding, ['id', 'origin', 'status', 'createdAt', 'updatedAt', 'matrixSessionId', 'runtimeSessionId', 'error']);
    check(id(binding.id) && !bindingIds.has(binding.id as string)); bindingIds.add(binding.id as string);
    let origin = ''; try { origin = localMatrixOrigin(binding.origin); } catch { check(false); }
    check(origin === binding.origin && enumValue(binding.status, ['pairing', 'paired', 'disconnected', 'unconfirmed', 'failed']) && date(binding.createdAt) && date(binding.updatedAt));
    check(binding.matrixSessionId === undefined || id(binding.matrixSessionId)); check(binding.runtimeSessionId === undefined || id(binding.runtimeSessionId));
    check(binding.status !== 'paired' || (id(binding.matrixSessionId) && id(binding.runtimeSessionId)));
    check(binding.error === undefined || text(binding.error));
  }
  check(value.activeBindingId === undefined || (typeof value.activeBindingId === 'string' && bindingIds.has(value.activeBindingId)));
  const demonstrationIds = new Set<string>();
  for (const demo of value.demonstrations) {
    check(record(demo)); keys(demo, ['id', 'bindingId', 'matrixSessionId', 'runtimeSessionId', 'correlationId', 'exhibit', 'placement', 'requestText', 'expectedMatrixRevision', 'status', 'createdAt', 'updatedAt', 'sequence', 'requiresApply', 'proposalSummary', 'commandIds', 'receipts', 'observed', 'error', 'lastCheckedAt', 'checkError']);
    check(id(demo.id) && !demonstrationIds.has(demo.id as string)); demonstrationIds.add(demo.id as string);
    const binding = value.bindings.find((candidate) => candidate.id === demo.bindingId);
    check(binding && demo.matrixSessionId === binding.matrixSessionId && demo.runtimeSessionId === binding.runtimeSessionId && demo.correlationId === demo.id);
    check(record(demo.exhibit)); keys(demo.exhibit, ['id', 'version', 'digest', 'identity']);
    check(id(demo.exhibit.id) && text(demo.exhibit.version, 64) && typeof demo.exhibit.digest === 'string' && /^[a-f0-9]{64}$/.test(demo.exhibit.digest));
    const identity = demo.exhibit.identity; check(record(identity)); keys(identity, ['packageId', 'packageVersion', 'lesson', 'mentor', 'sources', 'assets']);
    check(identity.packageId === demo.exhibit.id && identity.packageVersion === demo.exhibit.version && record(identity.lesson) && record(identity.mentor));
    keys(identity.lesson, ['id', 'version']); keys(identity.mentor, ['id', 'promptVersion']);
    check(id(identity.lesson.id) && text(identity.lesson.version, 64) && id(identity.mentor.id) && id(identity.mentor.promptVersion));
    check(Array.isArray(identity.sources) && identity.sources.length >= 1 && identity.sources.length <= 32);
    for (const source of identity.sources) { check(record(source)); keys(source, ['id', 'kind']); check(id(source.id) && enumValue(source.kind, ['authored', 'reference'])); }
    check(Array.isArray(identity.assets) && identity.assets.length === 1 && record(identity.assets[0])); keys(identity.assets[0], ['kind', 'assetId', 'identityGuarantee']);
    check(identity.assets[0].kind === 'builtin' && identity.assets[0].assetId === 'block' && identity.assets[0].identityGuarantee === 'asset-id-only');
    check(record(demo.placement)); keys(demo.placement, ['anchorId', 'position', 'mode', 'spawnScale', 'bounds']); check(id(demo.placement.anchorId) && vector(demo.placement.position));
    check(enumValue(demo.placement.mode, ['direct', 'surface']) && typeof demo.placement.spawnScale === 'number' && Number.isFinite(demo.placement.spawnScale) && demo.placement.spawnScale >= .01 && demo.placement.spawnScale <= 20);
    if (demo.placement.mode === 'surface') {
      check(record(demo.placement.bounds)); keys(demo.placement.bounds, ['center', 'size']);
      check(vector(demo.placement.bounds.center) && vector(demo.placement.bounds.size) && Object.values(demo.placement.bounds.size as object).every(value => typeof value === 'number' && value > 0));
      check((demo.placement.position as { y: number }).y >= 0);
    } else check(demo.placement.bounds === undefined);
    check(demo.requestText === 'Place a block here.' && integer(demo.expectedMatrixRevision) && enumValue(demo.status, MATRIX_STATUSES) && date(demo.createdAt) && date(demo.updatedAt) && integer(demo.sequence) && typeof demo.requiresApply === 'boolean');
    check(demo.proposalSummary === null || text(demo.proposalSummary, 1000));
    check(demo.error === null || text(demo.error)); check(demo.checkError === undefined || text(demo.checkError)); check(demo.lastCheckedAt === undefined || date(demo.lastCheckedAt));
    check(Array.isArray(demo.commandIds) && demo.commandIds.length <= 8 && demo.commandIds.every(id) && new Set(demo.commandIds).size === demo.commandIds.length && Array.isArray(demo.receipts) && demo.receipts.length <= 8);
    const commandIds = demo.commandIds as string[]; const received = new Set<string>();
    for (const ack of demo.receipts) {
      check(record(ack)); keys(ack, ['requestId', 'ok', 'error', 'objectId']);
      check(typeof ack.requestId === 'string' && commandIds.includes(ack.requestId) && !received.has(ack.requestId) && typeof ack.ok === 'boolean' && text(ack.error) && (ack.objectId === '' || id(ack.objectId))); received.add(ack.requestId);
    }
    check(demo.status !== 'ready' || (demo.requiresApply === true && demo.observed === null));
    if (enumValue(demo.status, ['submitting', 'planning', 'ready', 'cancelled', 'stale', 'needs_clarification', 'review_only', 'error'])) check(commandIds.length === 0 && demo.receipts.length === 0 && demo.observed === null);
    if (enumValue(demo.status, ['queued', 'running'])) check(commandIds.length === 1 && demo.receipts.length === 0 && demo.observed === null);
    if (demo.status === 'failed') check(commandIds.length === 1 && demo.receipts.length === 1 && demo.receipts.every(ack => !ack.ok));
    check(demo.status !== 'partial');
    if (demo.observed !== null) {
      check(demo.status === 'succeeded');
      check(record(demo.observed)); keys(demo.observed, ['revision', 'objects', 'source', 'roomId']); check(demo.observed.roomId === undefined || id(demo.observed.roomId));
      check(integer(demo.observed.revision) && Number(demo.observed.revision) >= Number(demo.expectedMatrixRevision) && demo.observed.source === 'matrix-runtime' && Array.isArray(demo.observed.objects) && demo.observed.objects.length === 1);
      for (const item of demo.observed.objects) {
        check(record(item)); keys(item, ['objectId', 'assetId', 'anchorId', 'position', 'scale']);
        check(id(item.objectId) && item.assetId === 'block' && item.anchorId === demo.placement.anchorId && vector(item.position) && vector(item.scale));
        check(demo.receipts.some((ack) => ack.ok && ack.objectId === item.objectId));
        const point = demo.placement.position as { x: number; y: number; z: number };
        const scale = demo.placement.spawnScale as number;
        const bounds = demo.placement.bounds as { center: { y: number }; size: { y: number } } | undefined;
        const expectedY = bounds ? point.y - (bounds.center.y - bounds.size.y / 2) * scale : point.y;
        check(['x','z'].every(axis => Math.abs((item.position as Record<string, number>)[axis] - (point as Record<string, number>)[axis]) <= .00001) && Math.abs((item.position as { y: number }).y - expectedY) <= .00001);
        check(Object.values(item.scale as Record<string, number>).every(value => Math.abs(value - scale) <= .00001));
      }
    }
    check(demo.status !== 'succeeded' || (demo.requiresApply === false && demo.observed !== null && commandIds.length === 1 && demo.receipts.length === 1 && demo.receipts.every((ack) => ack.ok)));
  }
  check(value.experiments === undefined || Array.isArray(value.experiments) && value.experiments.length <= MAX_MATRIX_EXPERIMENTS);
  const experimentIds = new Set<string>();
  for (const experiment of value.experiments ?? []) {
    check(record(experiment)); keys(experiment, ['id','bindingId','demonstrationId','matrixSessionId','runtimeSessionId','correlationId','action','factors','baselineExperimentId','proof','expectedMatrixRevision','status','requiresApply','sequence','createdAt','updatedAt','proposalSummary','commandIds','receipts','observed','error','lastCheckedAt','checkError']);
    check(id(experiment.id) && !experimentIds.has(experiment.id as string) && !demonstrationIds.has(experiment.id as string));
    const binding = value.bindings.find(item => item.id === experiment.bindingId);
    const demo = value.demonstrations.find(item => item.id === experiment.demonstrationId);
    check(binding && demo && demo.bindingId === binding.id && demo.status === 'succeeded' && demo.observed && demo.placement.mode === 'direct');
    check(experiment.matrixSessionId === binding.matrixSessionId && experiment.runtimeSessionId === binding.runtimeSessionId && experiment.correlationId === experiment.id);
    check(enumValue(experiment.action, ['configure','reset']) && vector(experiment.factors) && Object.values(experiment.factors as object).every(item => typeof item === 'number' && item >= .25 && item <= 4));
    const proof = experiment.proof; check(record(proof)); keys(proof, ['action','baseline','factors','expectedTransform']);
    check(proof.action === experiment.action && sameVector(proof.factors, experiment.factors));
    const baseline = proof.baseline; check(record(baseline)); keys(baseline, ['roomId','objectId','assetId','anchorId','transform']);
    const placed = demo.observed.objects[0];
    check(id(baseline.roomId) && baseline.roomId === demo.observed.roomId && baseline.objectId === placed.objectId && baseline.assetId === 'block' && baseline.anchorId === placed.anchorId);
    checkTransform(baseline.transform); checkTransform(proof.expectedTransform);
    check(sameVector(baseline.transform.position, placed.position) && sameVector(baseline.transform.scale, placed.scale) && sameVector(baseline.transform.rotation, {x:0,y:0,z:0}));
    check(sameVector(proof.expectedTransform.position, baseline.transform.position) && sameVector(proof.expectedTransform.rotation, baseline.transform.rotation));
    for (const axis of ['x','y','z']) check(Math.abs(proof.expectedTransform.scale[axis] - baseline.transform.scale[axis] * (experiment.factors as Record<string,number>)[axis]) <= .00001);
    if (experiment.baselineExperimentId !== undefined) {
      check(typeof experiment.baselineExperimentId === 'string' && experimentIds.has(experiment.baselineExperimentId));
      const source = (value.experiments as Array<Record<string,unknown>>).find(item => item.id === experiment.baselineExperimentId)!;
      check(source.bindingId === experiment.bindingId && source.demonstrationId === demo.id && source.status === 'succeeded' && source.observed);
      check(JSON.stringify((source.proof as Record<string,unknown>).baseline) === JSON.stringify(baseline));
    }
    if (experiment.action === 'reset') check(experiment.baselineExperimentId !== undefined && sameVector(experiment.factors, {x:1,y:1,z:1}));
    check(integer(experiment.expectedMatrixRevision) && enumValue(experiment.status, MATRIX_STATUSES) && integer(experiment.sequence) && typeof experiment.requiresApply === 'boolean' && date(experiment.createdAt) && date(experiment.updatedAt));
    check(experiment.proposalSummary === null || text(experiment.proposalSummary,1000)); check(experiment.error === null || text(experiment.error)); check(experiment.checkError === undefined || text(experiment.checkError)); check(experiment.lastCheckedAt === undefined || date(experiment.lastCheckedAt));
    check(Array.isArray(experiment.commandIds) && experiment.commandIds.length <= 1 && experiment.commandIds.every(id));
    check(Array.isArray(experiment.receipts) && experiment.receipts.length <= 1);
    for (const ack of experiment.receipts) { check(record(ack)); keys(ack,['requestId','ok','error','objectId']); check(experiment.commandIds.includes(ack.requestId) && typeof ack.ok === 'boolean' && text(ack.error) && (ack.objectId === '' || id(ack.objectId))); }
    check(experiment.status !== 'ready' || experiment.requiresApply === true && experiment.observed === null);
    check(experiment.requiresApply === false || experiment.status === 'ready');
    if (enumValue(experiment.status,['submitting','planning','ready','cancelled','stale','needs_clarification','review_only','error'])) check(experiment.commandIds.length === 0 && experiment.receipts.length === 0 && experiment.observed === null);
    if (enumValue(experiment.status,['queued','running'])) check(experiment.commandIds.length === 1 && experiment.receipts.length === 0 && experiment.observed === null);
    if (experiment.status === 'failed') check(experiment.commandIds.length === 1 && experiment.receipts.length === 1 && experiment.receipts[0].ok === false);
    check(experiment.status !== 'partial');
    if (experiment.observed !== null) {
      const observed = experiment.observed; check(record(observed)); keys(observed,['source','revision','relativeFactors','mathematicalVolumeRatio','units','physicalMeasurement']);
      check(experiment.status === 'succeeded' && observed.source === 'acknowledged-runtime-transform' && observed.units === 'dimensionless ratio' && observed.physicalMeasurement === false && integer(observed.revision) && Number(observed.revision) >= Number(experiment.expectedMatrixRevision));
      check(vector(observed.relativeFactors) && ['x','y','z'].every(axis => Math.abs((observed.relativeFactors as Record<string,number>)[axis] - (experiment.factors as Record<string,number>)[axis]) <= .00001 / (baseline.transform as {scale:Record<string,number>}).scale[axis] + 1e-12) && typeof observed.mathematicalVolumeRatio === 'number' && Number.isFinite(observed.mathematicalVolumeRatio));
      const factors = observed.relativeFactors as Record<string,number>; check(Math.abs(observed.mathematicalVolumeRatio - factors.x*factors.y*factors.z) <= .00001);
      check(experiment.commandIds.length === 1 && experiment.receipts.length === 1 && experiment.receipts[0].ok === true && experiment.receipts[0].objectId === baseline.objectId && experiment.requiresApply === false);
    }
    check(experiment.status !== 'succeeded' || experiment.observed !== null);
    experimentIds.add(experiment.id as string);
  }

}

function sameVector(a: unknown, b: unknown): boolean {
  return vector(a) && vector(b) && ['x','y','z'].every(axis => Math.abs((a as Record<string,number>)[axis] - (b as Record<string,number>)[axis]) <= .00001);
}
function checkTransform(value: unknown): asserts value is {position:Record<string,number>;rotation:Record<string,number>;scale:Record<string,number>} {
  check(record(value)); keys(value,['position','rotation','scale']); check(vector(value.position) && vector(value.rotation) && vector(value.scale));
  check(Object.values(value.position as Record<string,number>).every(n => Math.abs(n) <=100) && Object.values(value.rotation as Record<string,number>).every(n => Math.abs(n) <=36000) && Object.values(value.scale as Record<string,number>).every(n => n>=.01 && n<=20));
}
