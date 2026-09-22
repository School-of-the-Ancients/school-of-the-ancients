import type { Lesson, Mentor } from '../shared/contracts.ts';
import type { MatrixDiscovery, MatrixScene } from '../integrations/matrix-client.ts';

/** Prepared educational content is data. Matrix remains the scene/content authority. */
export type ExhibitReadinessState = 'ready' | 'missing' | 'incompatible' | 'unconfirmed';
export interface ExhibitIssue {
  code: string; state: Exclude<ExhibitReadinessState, 'ready'>; message: string; remedy: string; blocking: boolean;
}
export interface BundleSource {
  providerId: string; packId: string; version: string; sha256: string;
  platform: 'Android' | 'StandaloneWindows64'; unityVersion: string;
}
export type ExhibitAsset = { kind: 'builtin'; assetId: string; identityGuarantee: 'asset-id-only' }
  | { kind: 'bundle'; assetId: string; source: BundleSource };
export interface ExhibitCapability { id: string; scope: 'school' | 'matrix'; }
export interface PreparedExhibitManifest {
  schemaVersion: 1; id: string; version: string; title: string;
  lesson: { id: string; version: string };
  mentor: { id: string; promptVersion: string };
  sources: Array<{ id: string; kind: 'authored' | 'reference' }>;
  requiredCapabilities: ExhibitCapability[];
  optionalCapabilities: Array<ExhibitCapability & { fallback: string }>;
  assets: ExhibitAsset[];
  start: {
    browser: { kind: 'scale-illustration'; version: 1 };
    matrix: { kind: 'add-installed-asset'; version: 1; assetId: string; mode: 'offline-rules';
      placement: 'selected-surface'; scenePolicy: 'additive'; supportedRoomModes: Array<'virtual' | 'ar'> };
  };
  expectedObservations: Array<{ id: string; target: 'browser' | 'matrix'; description: string }>;
  completion: { authority: 'school'; role: 'participation-only'; matrixEvidence: 'placement-only' };
}
export interface ExhibitIdentity {
  packageId: string; packageVersion: string; lesson: PreparedExhibitManifest['lesson'];
  mentor: PreparedExhibitManifest['mentor']; sources: PreparedExhibitManifest['sources']; assets: ExhibitAsset[];
}
export interface ExhibitPreflightContext {
  target: 'browser' | 'matrix'; lesson: Lesson; mentor: Mentor;
  discovery?: MatrixDiscovery | null; scene?: MatrixScene | null; availableSchoolCapabilities?: string[];
}
export interface ExhibitPreflight {
  schemaVersion: 1; target: 'browser' | 'matrix'; state: ExhibitReadinessState; canLaunch: boolean;
  identity: ExhibitIdentity | null; issues: ExhibitIssue[];
  matrixRequest?: { text: string; revision: number; runtimeSessionId: string };
}

export const GALILEO_OBSERVATION_EXHIBIT: PreparedExhibitManifest = {
  schemaVersion: 1, id: 'galileo-observation-scale', version: '1.0.0', title: 'Galileo: Observation and Scale',
  lesson: { id: 'observation-and-scale', version: '1.0.0' },
  mentor: { id: 'galileo', promptVersion: 'galileo-observation-1' },
  sources: [{ id: 'authored-scale-v1', kind: 'authored' }],
  requiredCapabilities: [
    { scope: 'school', id: 'lesson.text.v1' }, { scope: 'school', id: 'experiment.scale.v1' },
    { scope: 'matrix', id: 'scene.read' }, { scope: 'matrix', id: 'scene.propose_text' },
    { scope: 'matrix', id: 'request.read' }, { scope: 'matrix', id: 'request.cancel_before_apply' },
  ],
  optionalCapabilities: [
    { scope: 'school', id: 'mentor.voice.v1', fallback: 'Read and type the mentor conversation. Voice is optional.' },
    { scope: 'school', id: 'mentor.avatar.v1', fallback: 'Use the mentor name and text conversation. An animated avatar is optional.' },
    { scope: 'matrix', id: 'capture', fallback: 'Use reported placement receipts and the browser illustration. Camera imagery is optional and unavailable through this client API.' },
  ],
  assets: [{ kind: 'builtin', assetId: 'block', identityGuarantee: 'asset-id-only' }],
  start: {
    browser: { kind: 'scale-illustration', version: 1 },
    matrix: { kind: 'add-installed-asset', version: 1, assetId: 'block', mode: 'offline-rules',
      placement: 'selected-surface', scenePolicy: 'additive', supportedRoomModes: ['virtual', 'ar'] },
  },
  expectedObservations: [
    { id: 'browser-scale', target: 'browser', description: 'The browser records authored dimensions and their mathematical volume ratio. This is a geometry illustration.' },
    { id: 'matrix-placement', target: 'matrix', description: 'A successful Matrix command receipt and matching observed object establish reported placement only; no physical volume or mastery is inferred.' },
  ],
  completion: { authority: 'school', role: 'participation-only', matrixEvidence: 'placement-only' },
};

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const bounded = (value: unknown, limit = 500): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const version = (value: unknown): value is string => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value) && value.length <= 64;
const vector = (value: unknown): value is { x: number; y: number; z: number } => record(value) &&
  ['x', 'y', 'z'].every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]) && Math.abs(value[axis] as number) <= 100);
function require(condition: unknown, path: string): asserts condition { if (!condition) throw new Error(path); }
function exact(value: unknown, keys: string[], path: string): asserts value is RecordValue {
  require(record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), path);
}
function list(value: unknown, path: string, min = 1, max = 32): asserts value is unknown[] {
  require(Array.isArray(value) && value.length >= min && value.length <= max, path);
}
function unique(values: unknown[], path: string) { require(new Set(values).size === values.length, path); }

/** Reject unknown recipe properties rather than interpreting executable or imported content. */
export function validateExhibitManifest(value: unknown): { valid: boolean; issues: ExhibitIssue[] } {
  try {
    require(JSON.stringify(value)?.length <= 32768, 'manifest size');
    exact(value, ['schemaVersion', 'id', 'version', 'title', 'lesson', 'mentor', 'sources', 'requiredCapabilities', 'optionalCapabilities', 'assets', 'start', 'expectedObservations', 'completion'], 'manifest fields');
    require(value.schemaVersion === 1, 'manifest schema version');
    require(id(value.id) && version(value.version) && bounded(value.title, 160), 'package identity');
    exact(value.lesson, ['id', 'version'], 'lesson reference');
    require(id(value.lesson.id) && version(value.lesson.version), 'lesson identity');
    exact(value.mentor, ['id', 'promptVersion'], 'mentor reference');
    require(id(value.mentor.id) && id(value.mentor.promptVersion), 'mentor prompt identity');
    list(value.sources, 'source references');
    for (const source of value.sources) {
      exact(source, ['id', 'kind'], 'source reference'); require(id(source.id) && ['authored', 'reference'].includes(String(source.kind)), 'source identity');
    }
    unique(value.sources.map(source => (source as RecordValue).id), 'duplicate source');
    for (const field of ['requiredCapabilities', 'optionalCapabilities'] as const) {
      list(value[field], field, field === 'requiredCapabilities' ? 1 : 0);
      for (const capability of value[field]) {
        exact(capability, field === 'requiredCapabilities' ? ['id', 'scope'] : ['id', 'scope', 'fallback'], 'capability fields');
        require(id(capability.id) && ['school', 'matrix'].includes(String(capability.scope)), 'capability identity');
        if (field === 'optionalCapabilities') require(bounded(capability.fallback), 'capability fallback');
      }
    }
    const capabilities = [...value.requiredCapabilities as RecordValue[], ...value.optionalCapabilities as RecordValue[]];
    unique(capabilities.map(capability => `${capability.scope}:${capability.id}`), 'duplicate capability');
    for (const [scope, name] of [['school', 'lesson.text.v1'], ['school', 'experiment.scale.v1'], ['matrix', 'scene.read'], ['matrix', 'scene.propose_text'], ['matrix', 'request.read'], ['matrix', 'request.cancel_before_apply']]) {
      require((value.requiredCapabilities as RecordValue[]).some(capability => capability.scope === scope && capability.id === name), 'recipe capability dependencies');
    }
    list(value.assets, 'asset dependencies');
    for (const asset of value.assets) {
      require(record(asset), 'asset dependency');
      if (asset.kind === 'builtin') {
        exact(asset, ['kind', 'assetId', 'identityGuarantee'], 'builtin asset fields');
        require(id(asset.assetId) && !String(asset.assetId).includes(':') && asset.identityGuarantee === 'asset-id-only', 'builtin asset identity');
      } else {
        exact(asset, ['kind', 'assetId', 'source'], 'bundle asset fields');
        require(asset.kind === 'bundle' && id(asset.assetId), 'bundle asset identity');
        exact(asset.source, ['providerId', 'packId', 'version', 'sha256', 'platform', 'unityVersion'], 'bundle source fields');
        const source = asset.source;
        require([source.providerId, source.packId, source.version].every(part => typeof part === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(part)), 'bundle source identity');
        require(String(asset.assetId).startsWith(`${source.providerId}:${source.packId}:${source.version}:`) && String(asset.assetId).split(':').length === 4, 'bundle asset source relationship');
        require(typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256), 'bundle digest');
        require(['Android', 'StandaloneWindows64'].includes(String(source.platform)) && bounded(source.unityVersion, 64), 'bundle runtime identity');
      }
    }
    unique(value.assets.map(asset => (asset as RecordValue).assetId), 'duplicate asset');
    exact(value.start, ['browser', 'matrix'], 'start recipes');
    exact(value.start.browser, ['kind', 'version'], 'browser recipe');
    require(value.start.browser.kind === 'scale-illustration' && value.start.browser.version === 1, 'browser recipe version');
    exact(value.start.matrix, ['kind', 'version', 'assetId', 'mode', 'placement', 'scenePolicy', 'supportedRoomModes'], 'Matrix recipe');
    const recipe = value.start.matrix;
    require(recipe.kind === 'add-installed-asset' && recipe.version === 1 && recipe.mode === 'offline-rules' && recipe.placement === 'selected-surface' && recipe.scenePolicy === 'additive', 'Matrix recipe version');
    require(value.assets.some(asset => (asset as RecordValue).assetId === recipe.assetId), 'start asset dependency');
    list(recipe.supportedRoomModes, 'supported room modes', 1, 2);
    require(recipe.supportedRoomModes.every(mode => mode === 'virtual' || mode === 'ar'), 'supported room modes');
    unique(recipe.supportedRoomModes, 'duplicate room mode');
    list(value.expectedObservations, 'expected observations', 1, 8);
    for (const observation of value.expectedObservations) {
      exact(observation, ['id', 'target', 'description'], 'expected observation');
      require(id(observation.id) && ['browser', 'matrix'].includes(String(observation.target)) && bounded(observation.description), 'expected observation fields');
    }
    unique(value.expectedObservations.map(observation => (observation as RecordValue).id), 'duplicate observation');
    exact(value.completion, ['authority', 'role', 'matrixEvidence'], 'completion fields');
    require(value.completion.authority === 'school' && value.completion.role === 'participation-only' && value.completion.matrixEvidence === 'placement-only', 'completion authority');
    return { valid: true, issues: [] };
  } catch (error) {
    const field = error instanceof Error && error.message.length < 80 ? error.message : 'manifest data';
    return { valid: false, issues: [{ code: 'invalid_manifest', state: 'incompatible', blocking: true,
      message: `This prepared exhibit has unsupported or invalid ${field}.`, remedy: 'Use a supported, complete prepared exhibit package. The current scene has not been changed.' }] };
  }
}

export function exhibitIdentity(manifest: PreparedExhibitManifest): ExhibitIdentity {
  return structuredClone({ packageId: manifest.id, packageVersion: manifest.version, lesson: manifest.lesson,
    mentor: manifest.mentor, sources: manifest.sources, assets: manifest.assets });
}

/** Uses a fresh paired /scene response, never files, cache entries, or preparation status. No I/O or mutation. */
export function preflightExhibit(value: unknown, context: ExhibitPreflightContext): ExhibitPreflight {
  const validation = validateExhibitManifest(value);
  const issues = [...validation.issues];
  const result: ExhibitPreflight = { schemaVersion: 1, target: context.target, state: 'incompatible', canLaunch: false, identity: null, issues };
  if (!validation.valid) return result;
  const manifest = value as PreparedExhibitManifest;
  result.identity = exhibitIdentity(manifest);
  const add = (code: string, state: ExhibitIssue['state'], message: string, remedy: string, blocking = true) => issues.push({ code, state, message, remedy, blocking });
  if (manifest.lesson.id !== context.lesson.id || manifest.lesson.version !== context.lesson.version) {
    add('lesson_identity_mismatch', 'incompatible', 'The saved exhibit and lesson versions do not match.', 'Resume with the original lesson snapshot or choose its matching prepared package.');
  }
  if (manifest.mentor.id !== context.mentor.id || manifest.mentor.id !== context.lesson.mentorId || manifest.mentor.promptVersion !== context.mentor.promptVersion) {
    add('mentor_identity_mismatch', 'incompatible', 'The saved exhibit requires a different mentor or prompt version.', 'Resume with the original mentor and prompt snapshot.');
  }
  for (const source of manifest.sources) if (!context.lesson.sources.some(item => item.id === source.id && item.kind === source.kind)) {
    add('source_identity_mismatch', 'incompatible', 'A referenced lesson source is absent or has changed kind.', 'Restore the exact authored lesson source reference before starting this exhibit.');
  }
  const schoolCapabilities = context.availableSchoolCapabilities ?? ['lesson.text.v1', 'experiment.scale.v1'];
  for (const capability of manifest.requiredCapabilities) {
    if (capability.scope === 'school' && !schoolCapabilities.includes(capability.id)) {
      add('required_capability_missing', 'missing', `School capability ${capability.id} is unavailable.`, 'Use a School build that provides this prepared lesson capability.');
    }
  }
  for (const capability of manifest.optionalCapabilities) {
    if (capability.scope === 'school' ? !schoolCapabilities.includes(capability.id) : context.target === 'matrix' && context.discovery?.capabilities[capability.id] !== true) {
      add('optional_capability_missing', 'missing', `Optional capability ${capability.id} is unavailable.`, capability.fallback, false);
    }
  }
  if (context.target === 'matrix') matrixPreflight(manifest, context, add);
  const blocking = issues.filter(issue => issue.blocking);
  result.state = blocking.some(issue => issue.state === 'incompatible') ? 'incompatible' : blocking.some(issue => issue.state === 'missing') ? 'missing' : blocking.length ? 'unconfirmed' : 'ready';
  result.canLaunch = result.state === 'ready';
  if (result.canLaunch && context.target === 'matrix' && context.scene) {
    result.matrixRequest = { text: `Place a ${manifest.start.matrix.assetId} here.`, revision: context.scene.revision, runtimeSessionId: context.scene.runtimeSessionId };
  }
  return result;
}

type AddIssue = (code: string, state: ExhibitIssue['state'], message: string, remedy: string, blocking?: boolean) => void;
function matrixPreflight(manifest: PreparedExhibitManifest, context: ExhibitPreflightContext, add: AddIssue) {
  const { discovery, scene } = context;
  if (!discovery) add('matrix_discovery_unconfirmed', 'unconfirmed', 'Matrix capabilities have not been checked.', 'Connect to the local Matrix companion and check readiness again.');
  else if (discovery.protocolVersion !== '1' || discovery.service !== 'matrix-loading-operator' || discovery.transport !== 'local-companion' || !record(discovery.capabilities)) {
    add('matrix_protocol_incompatible', 'incompatible', 'This Matrix connection does not provide the supported local companion API.', 'Use a compatible Matrix API v1 local companion.');
  } else {
    for (const capability of manifest.requiredCapabilities.filter(item => item.scope === 'matrix')) {
      const actual = discovery.capabilities[capability.id];
      if (capability.id === 'scene.propose_text') {
        if (!record(actual) || !Array.isArray(actual.modes) || !actual.modes.includes('offline-rules') || actual.requiresOperatorApply !== true) {
          add('required_capability_incompatible', actual === undefined || actual === false ? 'missing' : 'incompatible', 'Matrix cannot provide the required reviewed offline scene proposal.', 'Use Matrix API v1 with offline-rules proposals and owner Apply.');
        }
      } else if (actual !== true) add('required_capability_missing', 'missing', `Matrix capability ${capability.id} is unavailable.`, 'Update or configure Matrix to provide this required capability, or use the browser lesson.');
    }
  }
  if (!scene) {
    add('matrix_scene_unconfirmed', 'unconfirmed', 'No current paired Matrix runtime scene is available.', 'Start or reconnect the runtime, pair with Matrix, and check readiness again. The browser lesson is available.');
    return;
  }
  if (scene.protocolVersion !== '1' || !id(scene.runtimeSessionId) || !id(scene.sessionId) || !Number.isSafeInteger(scene.revision) || scene.revision < 0 || !record(scene.snapshot)) {
    add('matrix_scene_incompatible', 'incompatible', 'Matrix returned an incomplete scene identity.', 'Read a new scene from the currently paired runtime.'); return;
  }
  const snapshot = scene.snapshot;
  if (snapshot.readOnly === true) add('room_read_only', 'missing', 'The current Matrix room is retained for viewing only.', 'Reload room data and verify alignment in Matrix before adding an exhibit.');
  if (!record(snapshot.scene) || snapshot.scene.schemaVersion !== 1 || !bounded(snapshot.scene.roomId, 128) || !Array.isArray(snapshot.scene.objects)) {
    add('room_unconfirmed', 'unconfirmed', 'A current supported room scene has not been reported.', 'Load a room in Matrix and read its current scene.');
  } else if (snapshot.scene.objects.length >= 100) add('scene_capacity', 'missing', 'The current scene has reached its supported object limit.', 'Remove an unneeded object in Matrix before adding this exhibit.');
  const room = record(snapshot.roomContext) ? snapshot.roomContext : record(scene.runtime) && typeof scene.runtime.mode === 'string' ? scene.runtime : null;
  const mode = room?.mode === 'white-room' ? 'virtual' : room?.mode ?? 'virtual'; // API v1 calls the virtual mode white-room; older virtual snapshots omit RoomContext.
  if (!manifest.start.matrix.supportedRoomModes.includes(mode as 'virtual' | 'ar')) add('room_mode_incompatible', 'incompatible', 'This package does not support the current room mode.', 'Choose one of the room modes declared by this package.');
  if (room && room.state !== 'ready') add('room_not_ready', 'missing', 'Matrix room data is not ready.', 'Finish loading the room in Matrix and check readiness again.');
  if (mode === 'ar' && room?.alignmentVerified !== true) add('room_alignment_unconfirmed', 'unconfirmed', 'Room AR alignment has not been verified.', 'Verify the room outlines in Matrix before requesting placement.');
  if (record(snapshot.roomContext) && record(scene.runtime) && typeof scene.runtime.mode === 'string' &&
      ['mode', 'state', 'alignmentVerified'].some(key => snapshot.roomContext && (snapshot.roomContext as RecordValue)[key] !== scene.runtime[key])) {
    add('room_context_mismatch', 'incompatible', 'Matrix runtime and scene room context disagree.', 'Refresh the paired scene after Matrix finishes reconnecting.');
  }
  if (!Array.isArray(snapshot.assets)) add('installed_assets_unconfirmed', 'unconfirmed', 'The runtime has not reported its installed assets.', 'Reconnect the current runtime. Cached downloads do not prove that assets are installed.');
  else for (const dependency of manifest.assets) {
    const matches = snapshot.assets.filter(asset => record(asset) && asset.assetId === dependency.assetId) as RecordValue[];
    if (matches.length === 0) { add('asset_missing', 'missing', `Required installed asset ${dependency.assetId} is missing.`, 'Prepare and install the content in Matrix, then refresh the runtime scene. School does not import content.'); continue; }
    if (matches.length !== 1) { add('asset_identity_ambiguous', 'incompatible', 'The runtime reported duplicate asset identities.', 'Resolve duplicate installed asset identities in Matrix.'); continue; }
    const asset = matches[0];
    if (dependency.kind === 'bundle') {
      if (!record(asset.source)) add('asset_identity_unconfirmed', 'unconfirmed', 'The installed bundle has no complete source identity.', 'Use an installed runtime asset that reports its exact content version and digest.');
      else if (Object.keys(dependency.source).some(key => !bounded((asset.source as RecordValue)[key], 128))) {
        add('asset_identity_unconfirmed', 'unconfirmed', 'The installed bundle has an incomplete source identity.', 'Use an installed runtime asset that reports its exact content version and digest.');
      } else if (Object.entries(dependency.source).some(([key, expected]) => asset.source && (asset.source as RecordValue)[key] !== expected)) {
        add('asset_identity_mismatch', 'incompatible', 'The installed asset differs from the required bundle version, digest, platform, or Unity version.', 'Install the exact prepared bundle in Matrix. Keep the current scene until its dependencies match.');
      }
    } else {
      if (record(asset.source) && Object.values(asset.source).some(value => value !== null && value !== '')) add('builtin_identity_mismatch', 'incompatible', 'An asset with bundle provenance occupies the expected built-in identity.', 'Use the built-in asset declared by this package.');
      add('builtin_identity_limited', 'unconfirmed', `Built-in ${dependency.assetId} is reported by asset ID only; its immutable build identity is unavailable.`, 'Review the installed Matrix build. This package cannot verify a built-in asset version or digest.', false);
    }
  }
  // The existing text parser also matches exact display names. Refuse aliases that could select another installed asset.
  if (Array.isArray(snapshot.assets)) {
    const wanted = manifest.start.matrix.assetId.toLowerCase();
    const matches = snapshot.assets.filter(asset => record(asset) && (typeof asset.assetId === 'string' && asset.assetId.trim().toLowerCase() === wanted || typeof asset.displayName === 'string' && asset.displayName.trim().toLowerCase() === wanted));
    if (matches.length > 1) add('request_asset_ambiguous', 'incompatible', 'More than one installed asset matches the scene request.', 'Resolve the duplicate asset name in Matrix before requesting this exhibit.');
  }
  const selection = snapshot.selection;
  if (!record(selection) || !id(selection.anchorId) || !vector(selection.position)) {
    add('selected_surface_missing', 'missing', 'No valid placement point is selected in Matrix.', 'Select a floor or support surface in Matrix, then check readiness again.'); return;
  }
  const anchors = Array.isArray(snapshot.anchors) ? snapshot.anchors.filter(anchor => record(anchor) && anchor.anchorId === selection.anchorId) as RecordValue[] : [];
  if (anchors.length !== 1) { add('selected_anchor_missing', 'missing', 'The selected placement anchor is no longer available.', 'Select an available surface in the current Matrix room.'); return; }
  const anchor = anchors[0];
  if (anchor.source === 'mruk' && (mode !== 'ar' || !record(anchor.surface))) add('surface_context_unconfirmed', 'unconfirmed', 'The selected physical surface has incomplete room context.', 'Reload room data and select a verified support surface in Matrix.');
  if (anchor.source === 'mruk') {
    const asset = Array.isArray(snapshot.assets) ? snapshot.assets.find(item => record(item) && item.assetId === manifest.start.matrix.assetId) : null;
    const bounds = record(asset) && record(asset.localBounds) ? asset.localBounds : null;
    const boundsVector = (value: unknown): value is { x: number; y: number; z: number } => record(value) &&
      ['x', 'y', 'z'].every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]) && Math.abs(value[axis] as number) <= 10000);
    if (!bounds || !boundsVector(bounds.center) || !boundsVector(bounds.size) || ['x', 'y', 'z'].some(axis => (bounds.size as Record<string, number>)[axis] <= 0)) {
      add('surface_asset_bounds_unconfirmed', 'unconfirmed', 'The installed block has no usable reported bounds for surface placement.', 'Use a Matrix runtime that reports the installed block bounds before requesting placement in room AR.');
    }
    if (!record(asset) || typeof asset.spawnScale !== 'number' || !Number.isFinite(asset.spawnScale) || asset.spawnScale < .01 || asset.spawnScale > 20) {
      add('surface_asset_scale_unconfirmed', 'unconfirmed', 'The installed block has no valid reported placement scale.', 'Refresh the runtime installed asset list in Matrix. Its placement scale must be between 0.01 and 20.');
    }
    if (selection.position.y < 0) add('surface_clearance_incompatible', 'incompatible', 'The selected point requests placement below the support surface.', 'Select a point on or above the support surface in Matrix.');
  }
  if (record(anchor.surface)) {
    if (anchor.surface.kind !== 'support') { add('surface_incompatible', 'incompatible', 'The selected surface cannot support this exhibit.', 'Select a floor or tabletop support surface in Matrix.'); return; }
    const boundary = anchor.surface.boundary;
    if (!Array.isArray(boundary) || boundary.length < 3 || boundary.length > 256 || !boundary.every(vector) ||
        boundary.some(point => Math.abs(point.y) > .001) || Math.abs(boundary.reduce((area, a, i) => { const b = boundary[(i + 1) % boundary.length]; return area + a.x * b.z - b.x * a.z; }, 0)) <= 1e-6) {
      add('surface_boundary_unconfirmed', 'unconfirmed', 'The selected support surface has no valid reported boundary.', 'Reload room geometry in Matrix and select a valid support surface.');
    } else if (!pointInPolygon(selection.position, boundary)) {
      add('selected_point_outside_surface', 'incompatible', 'The selected point is outside the reported support surface.', 'Select a point inside the floor or tabletop boundary in Matrix.');
    }
  }
}

/** XZ containment of the selected point only. This does not measure the prop footprint or physical volume. */
function pointInPolygon(point: { x: number; z: number }, boundary: Array<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[j], b = boundary[i];
    const cross = (point.x - a.x) * (b.z - a.z) - (point.z - a.z) * (b.x - a.x);
    if (Math.abs(cross) <= 1e-8 && point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 && point.z >= Math.min(a.z, b.z) - 1e-8 && point.z <= Math.max(a.z, b.z) + 1e-8) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
