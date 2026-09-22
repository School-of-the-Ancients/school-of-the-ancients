import test from 'node:test';
import assert from 'node:assert/strict';
import { GALILEO, OBSERVATION_LESSON } from '../../src/server/content.ts';
import { exhibitIdentity, GALILEO_OBSERVATION_EXHIBIT, preflightExhibit, validateExhibitManifest } from '../../src/exhibits/prepared-exhibits.ts';
import type { BundleSource, ExhibitPreflightContext, PreparedExhibitManifest } from '../../src/exhibits/prepared-exhibits.ts';

function manifest() { return structuredClone(GALILEO_OBSERVATION_EXHIBIT); }
function context(): ExhibitPreflightContext {
  return {
    target: 'matrix', lesson: structuredClone(OBSERVATION_LESSON), mentor: structuredClone(GALILEO),
    discovery: { protocolVersion: '1', service: 'matrix-loading-operator', transport: 'local-companion', pairingAvailable: true,
      capabilities: { 'scene.read': true, 'scene.propose_text': { modes: ['offline-rules'], requiresOperatorApply: true },
        'request.read': true, 'request.cancel_before_apply': true, capture: false, 'content.prepare': false } },
    scene: { protocolVersion: '1', sessionId: 'paired-fixture', runtimeSessionId: 'runtime-fixture.1', revision: 9,
      snapshot: { scene: { schemaVersion: 1, roomId: 'virtual-fixture', objects: [] },
        assets: [{ assetId: 'block', displayName: 'Terracotta block' }], anchors: [{ anchorId: 'floor', displayName: 'Floor' }],
        selection: { anchorId: 'floor', objectId: '', position: { x: 1, y: 0, z: 2 } } },
      // Existing virtual-room runtime predates roomContext; API v1 can return null.
      runtime: null as unknown as Record<string, unknown>,
    },
  };
}
function arContext(): ExhibitPreflightContext {
  const input = context();
  const room = { mode: 'ar', state: 'ready', alignmentVerified: true, message: '' };
  input.scene!.runtime = room;
  input.scene!.snapshot.roomContext = structuredClone(room);
  input.scene!.snapshot.assets = [{ assetId: 'block', displayName: 'Terracotta block', spawnScale: .2,
    localBounds: { center: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } } }];
  input.scene!.snapshot.anchors = [{ anchorId: 'floor', displayName: 'Floor', source: 'mruk', semanticLabels: ['FLOOR'],
    surface: { kind: 'support', boundary: [{ x: -3, y: 0, z: -3 }, { x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, { x: -3, y: 0, z: 3 }] } }];
  return input;
}
function blocked(input: ExhibitPreflightContext, code: string, prepared: unknown = manifest()) {
  const result = preflightExhibit(prepared, input);
  assert.equal(result.canLaunch, false);
  assert.equal(result.matrixRequest, undefined);
  assert.ok(result.issues.some(issue => issue.code === code && issue.blocking), `Expected blocking issue ${code}: ${JSON.stringify(result.issues)}`);
  for (const issue of result.issues) assert.ok(issue.message && issue.remedy);
  return result;
}

test('authored package validates and identity copies preserve exact lesson, prompt and asset references', () => {
  assert.deepEqual(validateExhibitManifest(manifest()), { valid: true, issues: [] });
  const prepared = manifest(); const identity = exhibitIdentity(prepared);
  assert.deepEqual(identity, {
    packageId: 'galileo-observation-scale', packageVersion: '1.0.0',
    lesson: { id: 'observation-and-scale', version: '1.0.0' }, mentor: { id: 'galileo', promptVersion: 'galileo-observation-1' },
    sources: [{ id: 'authored-scale-v1', kind: 'authored' }],
    assets: [{ kind: 'builtin', assetId: 'block', identityGuarantee: 'asset-id-only' }],
  });
  identity.lesson.version = '9.0.0'; identity.assets[0].assetId = 'different';
  assert.equal(prepared.lesson.version, '1.0.0'); assert.equal(prepared.assets[0].assetId, 'block');
  assert.deepEqual(exhibitIdentity(JSON.parse(JSON.stringify(prepared))), exhibitIdentity(prepared));
});

test('browser fallback is ready without Matrix, camera, voice, or avatar', () => {
  const result = preflightExhibit(manifest(), { target: 'browser', lesson: OBSERVATION_LESSON, mentor: GALILEO });
  assert.equal(result.state, 'ready'); assert.equal(result.canLaunch, true); assert.equal(result.matrixRequest, undefined);
  assert.ok(result.issues.some(issue => issue.message.includes('mentor.voice.v1') && !issue.blocking));
  assert.ok(result.issues.some(issue => issue.message.includes('mentor.avatar.v1') && !issue.blocking));
  assert.ok(!result.issues.some(issue => issue.blocking));
});

test('virtual room preflight returns only an additive reviewed request bound to current runtime/revision', () => {
  const input = context(); const prepared = manifest();
  const before = JSON.stringify({ input, prepared });
  const result = preflightExhibit(prepared, input);
  assert.equal(result.state, 'ready'); assert.equal(result.canLaunch, true);
  assert.deepEqual(result.matrixRequest, { text: 'Place a block here.', revision: 9, runtimeSessionId: 'runtime-fixture.1' });
  assert.ok(result.issues.some(issue => issue.code === 'builtin_identity_limited' && !issue.blocking));
  assert.ok(result.issues.some(issue => issue.message.includes('capture') && !issue.blocking));
  assert.equal(JSON.stringify({ input, prepared }), before, 'preflight must not mutate snapshots or package data');
  assert.equal('sha256' in result.identity!.assets[0], false);
});

test('the real runtime block identity wins over aliases and a synthetic cube cannot replace it', () => {
  const input = context();
  input.scene!.snapshot.assets = [
    { assetId: 'block', displayName: 'Terracotta block' },
    { assetId: 'cube', displayName: 'Cube' },
    { assetId: 'another-block', displayName: 'Decorative block' },
  ];
  assert.equal(preflightExhibit(manifest(), input).state, 'ready');
  input.scene!.snapshot.assets = [{ assetId: 'cube', displayName: 'Cube' }];
  blocked(input, 'asset_missing');
});

test('AR requires ready aligned room context and an explicit support surface', () => {
  assert.equal(preflightExhibit(manifest(), arContext()).state, 'ready');
  let input = arContext(); input.scene!.snapshot.readOnly = true; blocked(input, 'room_read_only');
  input = arContext(); input.scene!.runtime.alignmentVerified = false;
  (input.scene!.snapshot.roomContext as Record<string, unknown>).alignmentVerified = false;
  assert.equal(blocked(input, 'room_alignment_unconfirmed').state, 'unconfirmed');
  input = arContext(); input.scene!.runtime.state = 'loading';
  (input.scene!.snapshot.roomContext as Record<string, unknown>).state = 'loading';
  blocked(input, 'room_not_ready');
  input = arContext(); input.scene!.runtime.mode = 'virtual'; blocked(input, 'room_context_mismatch');
  input = arContext(); ((input.scene!.snapshot.anchors as Record<string, unknown>[])[0].surface as Record<string, unknown>).kind = 'wall';
  blocked(input, 'surface_incompatible');
});

test('explicit API white-room mode maps to the package virtual room capability', () => {
  const input = context();
  input.scene!.runtime = { mode: 'white-room', state: 'ready', alignmentVerified: false };
  input.scene!.snapshot.roomContext = structuredClone(input.scene!.runtime);
  assert.equal(preflightExhibit(manifest(), input).state, 'ready');
});

test('AR selected point must be inside reported surface, including boundary tolerance', () => {
  let input = arContext(); (input.scene!.snapshot.selection as Record<string, unknown>).position = { x: 4, y: 0, z: 0 };
  assert.equal(blocked(input, 'selected_point_outside_surface').state, 'incompatible');
  input = arContext(); (input.scene!.snapshot.selection as Record<string, unknown>).position = { x: 3, y: 0, z: 0 };
  assert.equal(preflightExhibit(manifest(), input).canLaunch, true);
  input = arContext(); ((input.scene!.snapshot.anchors as Record<string, unknown>[])[0].surface as Record<string, unknown>).boundary = [];
  blocked(input, 'surface_boundary_unconfirmed');
  input = arContext(); ((input.scene!.snapshot.anchors as Record<string, unknown>[])[0].surface as Record<string, unknown>).boundary = [{ x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }];
  blocked(input, 'surface_boundary_unconfirmed');
});

test('AR placement requires reported block bounds, catalog scale and nonnegative surface clearance', () => {
  for (const bounds of [null, {}, { center: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } },
    { center: { x: 0, y: Number.NaN, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    { center: { x: 0, y: 0, z: 0 }, size: { x: -1, y: 1, z: 1 } }]) {
    const input = arContext(); (input.scene!.snapshot.assets as Record<string, unknown>[])[0].localBounds = bounds;
    blocked(input, 'surface_asset_bounds_unconfirmed');
  }
  for (const scale of [undefined, null, Number.NaN, 0, .001, 21]) {
    const input = arContext(); (input.scene!.snapshot.assets as Record<string, unknown>[])[0].spawnScale = scale;
    blocked(input, 'surface_asset_scale_unconfirmed');
  }
  const input = arContext(); (input.scene!.snapshot.selection as Record<string, unknown>).position = { x: 0, y: -.1, z: 0 };
  blocked(input, 'surface_clearance_incompatible');
});

test('missing runtime/discovery is unconfirmed and missing assets are not inferred from a cache', () => {
  let input = context(); delete input.scene; assert.equal(blocked(input, 'matrix_scene_unconfirmed').state, 'unconfirmed');
  input = context(); delete input.discovery; blocked(input, 'matrix_discovery_unconfirmed');
  input = context(); input.scene!.snapshot.assets = []; input.scene!.snapshot.cachedAssets = [{ assetId: 'block' }];
  assert.equal(blocked(input, 'asset_missing').state, 'missing');
  input = context(); delete input.scene!.snapshot.assets; blocked(input, 'installed_assets_unconfirmed');
});

test('missing or mismatched required capabilities block; optional capability absence does not', () => {
  let input = context(); input.availableSchoolCapabilities = ['lesson.text.v1']; blocked(input, 'required_capability_missing');
  for (const capability of ['scene.read', 'request.read', 'request.cancel_before_apply']) {
    input = context(); input.discovery!.capabilities[capability] = false; blocked(input, 'required_capability_missing');
  }
  for (const proposal of [false, true, { modes: ['another-engine'], requiresOperatorApply: true }, { modes: ['offline-rules'], requiresOperatorApply: false }]) {
    input = context(); input.discovery!.capabilities['scene.propose_text'] = proposal; blocked(input, 'required_capability_incompatible');
  }
  input = context(); input.discovery!.capabilities.capture = false;
  assert.equal(preflightExhibit(manifest(), input).state, 'ready');
});

test('package, lesson, mentor, source, and recipe version mismatches fail before a request exists', () => {
  let prepared: unknown = { ...manifest(), schemaVersion: 2 }; blocked(context(), 'invalid_manifest', prepared);
  let input = context(); input.lesson.version = '2.0.0'; blocked(input, 'lesson_identity_mismatch');
  input = context(); input.mentor.promptVersion = 'galileo-observation-2'; blocked(input, 'mentor_identity_mismatch');
  input = context(); input.lesson.mentorId = 'other-mentor'; blocked(input, 'mentor_identity_mismatch');
  input = context(); input.lesson.sources = []; blocked(input, 'source_identity_mismatch');
  prepared = manifest(); (prepared as PreparedExhibitManifest).start.matrix.version = 2 as 1;
  blocked(context(), 'invalid_manifest', prepared);
});

test('malformed, absent, stale and nonfinite selections cannot generate a Matrix request', () => {
  for (const selection of [null, {}, { anchorId: 'floor' }, { anchorId: 'missing', position: { x: 0, y: 0, z: 0 } },
    { anchorId: 'floor', position: { x: Number.NaN, y: 0, z: 0 } }, { anchorId: 'floor', position: { x: 0, y: Infinity, z: 0 } },
    { anchorId: 'floor', position: { x: 101, y: 0, z: 0 } }, { anchorId: 'floor', position: { x: -101, y: 0, z: 0 } }]) {
    const input = context(); input.scene!.snapshot.selection = selection;
    const code = selection?.anchorId === 'missing' ? 'selected_anchor_missing' : 'selected_surface_missing';
    blocked(input, code);
  }
  const input = context(); input.scene!.snapshot.anchors = [{ anchorId: 'floor' }, { anchorId: 'floor' }];
  blocked(input, 'selected_anchor_missing');
});

const bundleSource: BundleSource = { providerId: 'fixture', packId: 'geometry', version: '2.0.1', sha256: 'a'.repeat(64), platform: 'Android', unityVersion: '6000.6.0f1' };
function bundleFixture() {
  const prepared = manifest(); const input = context();
  const assetId = 'fixture:geometry:2.0.1:block';
  prepared.assets = [{ kind: 'bundle', assetId, source: structuredClone(bundleSource) }];
  prepared.start.matrix.assetId = assetId;
  input.scene!.snapshot.assets = [{ assetId, displayName: 'Prepared block', source: structuredClone(bundleSource) }];
  return { prepared, input };
}

test('installed bundles require exact source versions/digests/platform/Unity identities', () => {
  const fixture = bundleFixture();
  assert.equal(preflightExhibit(fixture.prepared, fixture.input).state, 'ready');
  assert.deepEqual(preflightExhibit(fixture.prepared, fixture.input).identity?.assets, fixture.prepared.assets);
  for (const [field, value] of Object.entries({ providerId: 'different', packId: 'different', version: '2.0.2', sha256: 'b'.repeat(64), platform: 'StandaloneWindows64', unityVersion: '6000.6.1f1' })) {
    const { prepared, input } = bundleFixture();
    ((input.scene!.snapshot.assets as Record<string, unknown>[])[0].source as Record<string, unknown>)[field] = value;
    blocked(input, 'asset_identity_mismatch', prepared);
  }
  const { prepared, input } = bundleFixture(); delete (input.scene!.snapshot.assets as Record<string, unknown>[])[0].source;
  assert.equal(blocked(input, 'asset_identity_unconfirmed', prepared).state, 'unconfirmed');
  const incomplete = bundleFixture();
  delete ((incomplete.input.scene!.snapshot.assets as Record<string, unknown>[])[0].source as Record<string, unknown>).sha256;
  blocked(incomplete.input, 'asset_identity_unconfirmed', incomplete.prepared);
});

test('invalid bundle source relationship and fabricated builtin digest are rejected', () => {
  const { prepared } = bundleFixture(); prepared.start.matrix.assetId = 'fixture:geometry:2.0.1:block';
  (prepared.assets[0] as { source: BundleSource }).source.sha256 = 'not-a-digest';
  blocked(context(), 'invalid_manifest', prepared);
  const badBuiltin = manifest(); (badBuiltin.assets[0] as unknown as Record<string, unknown>).sha256 = 'f'.repeat(64);
  blocked(context(), 'invalid_manifest', badBuiltin);
  const wrongVersion = bundleFixture(); (wrongVersion.prepared.assets[0] as { source: BundleSource }).source.version = '2.0.2';
  blocked(context(), 'invalid_manifest', wrongVersion.prepared);
});

test('all manifest asset dependencies must be installed and display-name ambiguity cannot select the wrong asset', () => {
  let input = context(); const prepared = manifest(); prepared.assets.push({ kind: 'builtin', assetId: 'chair', identityGuarantee: 'asset-id-only' });
  blocked(input, 'asset_missing', prepared);
  input = context(); (input.scene!.snapshot.assets as unknown[]).push({ assetId: 'another-block', displayName: 'Block' });
  blocked(input, 'request_asset_ambiguous');
  input = context(); (input.scene!.snapshot.assets as unknown[]).push({ assetId: 'block', displayName: 'Block duplicate' });
  blocked(input, 'asset_identity_ambiguous');
});

test('unknown executable recipe, missing dependency, duplicate capability and oversized manifests are incompatible', () => {
  let prepared = manifest(); (prepared.start.matrix as unknown as Record<string, unknown>).script = 'execute arbitrary code';
  blocked(context(), 'invalid_manifest', prepared);
  prepared = manifest(); prepared.start.matrix.scenePolicy = 'replace' as 'additive'; blocked(context(), 'invalid_manifest', prepared);
  prepared = manifest(); prepared.requiredCapabilities = prepared.requiredCapabilities.filter(capability => capability.id !== 'scene.read');
  blocked(context(), 'invalid_manifest', prepared);
  prepared = manifest(); prepared.optionalCapabilities.push({ id: 'scene.read', scope: 'matrix', fallback: 'No read' });
  blocked(context(), 'invalid_manifest', prepared);
  prepared = manifest(); prepared.title = 'x'.repeat(40000); blocked(context(), 'invalid_manifest', prepared);
});

test('wrong runtime protocol, room schema, room mode or capacity cannot be marked ready', () => {
  let input = context(); input.scene!.protocolVersion = '2' as '1'; blocked(input, 'matrix_scene_incompatible');
  input = context(); input.discovery!.transport = 'hosted'; blocked(input, 'matrix_protocol_incompatible');
  input = context(); (input.scene!.snapshot.scene as Record<string, unknown>).schemaVersion = 2; blocked(input, 'room_unconfirmed');
  input = arContext(); const prepared = manifest(); prepared.start.matrix.supportedRoomModes = ['virtual']; blocked(input, 'room_mode_incompatible', prepared);
  input = context(); (input.scene!.snapshot.scene as Record<string, unknown>).objects = Array.from({ length: 100 }, (_, i) => ({ objectId: `object-${i}` }));
  blocked(input, 'scene_capacity');
});
