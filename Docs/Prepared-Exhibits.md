# Prepared exhibits: bounded Observation and Scale package

This candidate implements the package/preflight portion of [roadmap #3](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/issues/3). `src/exhibits/prepared-exhibits.ts` contains a renderer-independent data manifest and pure validation/readiness functions. It reuses the existing authored Galileo lesson and mentor. School owns their teaching stages, transcript, browser illustration and participation record; Matrix owns its installed content, room, proposals and execution.

The one shipped package is `galileo-observation-scale` version `1.0.0`. It references lesson `observation-and-scale` version `1.0.0`, mentor `galileo`, prompt `galileo-observation-1`, and authored source `authored-scale-v1`. Its browser path uses the existing deterministic scale illustration. Its optional Matrix path requests one installed block at the current selected placement point. It does not replace the scene, import files, run arbitrary scripts, or add another catalog.

## Manifest and identity contract

The version 1 manifest declares:

- Package ID/version, exact lesson ID/version, mentor ID/prompt version, and source ID/kind references.
- Required capabilities scoped to School or Matrix, plus explicit optional capability fallbacks.
- Installed asset dependencies, a browser recipe, and one additive Matrix recipe.
- Supported room modes, expected observations and School's participation-only completion authority.

Unknown fields, unsupported recipe/schema versions, duplicate dependencies, omitted required capabilities and unbounded data are rejected. The Matrix recipe supports only `offline-rules`, selected-surface placement and an additive scene policy. The current lesson source contract has no independent source-version or digest field; the exact source ID is retained with the existing lesson snapshot. The module does not fabricate one.

`exhibitIdentity()` returns an independent copy containing package ID/version, lesson and mentor/prompt references, source references and asset identities. The School bridge persists this snapshot with a demonstration. It must compare the persisted identity to the currently supported package before proposing new work; package changes must never silently rebind an earlier demonstration. School's existing lesson and mentor snapshots remain the authority for saved educational content. A package reference is not a Matrix room checkpoint.

There are two supported asset identities:

| Kind | Required identity | Actual guarantee |
| --- | --- | --- |
| Built-in | Exact runtime-reported `assetId`, with explicit `identityGuarantee: asset-id-only` | The current runtime advertises that installed asset ID. The API does **not** expose an immutable built-in build version or digest. The block is labeled with this limitation. |
| Bundle | Exact `assetId` and source `providerId`, `packId`, `version`, `sha256`, `platform`, `unityVersion` | Every supplied source field must match the runtime-installed asset. A missing source field is unconfirmed; a differing value is incompatible. |

Bundle asset IDs must agree with their `providerId:packId:version:localId` source. A package requiring one bundle version cannot use a later version or a same-named cached download as a substitute. This slice performs no content download, preparation, installation, or cold restore. Those remain Matrix responsibilities under [#9](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/9), [#21](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/21) and [#28](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28).

## Pure readiness API

```ts
validateExhibitManifest(value: unknown): { valid: boolean; issues: ExhibitIssue[] }
exhibitIdentity(manifest: PreparedExhibitManifest): ExhibitIdentity
preflightExhibit(manifest: unknown, context: ExhibitPreflightContext): ExhibitPreflight
```

Context includes the requested `browser` or `matrix` target, current lesson and mentor snapshots, and optional fresh Matrix discovery/scene responses. School capabilities default to the two implemented local capabilities, `lesson.text.v1` and `experiment.scale.v1`; callers can supply an explicit current list. The pure function has no network, filesystem, clock, content-loading or mutation side effects.

The result includes `state`, `canLaunch`, exact `identity`, and `issues` with `code`, `state`, `message`, `remedy`, and `blocking`. A `matrixRequest` containing fixed text, current revision and runtime session identity exists only when every blocking check passes. Callers must refresh discovery and the paired scene before a new proposal and pass its revision/runtime binding to the existing Matrix client. This function cannot prove a cached snapshot is fresh; the bridge and Matrix revision/lease checks provide that boundary.

| State | Meaning | Example remedy |
| --- | --- | --- |
| `ready` | Required dependencies are satisfied for the selected path. Optional limitations remain visible. | Review the proposal in Matrix; only the owner can Apply. |
| `missing` | A named required capability, asset, usable room, or selected anchor is absent. | Select a floor/tabletop in Matrix, reconnect the room, or install the required content there. |
| `incompatible` | A supplied identity, recipe, protocol, capability mode, or selected surface contradicts the package. | Use the matching lesson/content version or a supported room surface. |
| `unconfirmed` | Discovery, a current paired scene, AR alignment, or source identity cannot be established. | Reconnect/read current state or verify room alignment in Matrix. |

Blocking incompatibility takes precedence over missing dependencies, then unconfirmed state. Optional voice, avatar and camera absence produces a nonblocking issue with a text/receipt/browser fallback. The built-in block's limited identity guarantee also remains visible without preventing this explicitly limited demonstration. Browser readiness does not require Matrix, camera, voice, an avatar, or a content provider.

Preparation progress and execution failure are distinct from pure preflight. Matrix's actual proposal/outcome states describe planning, owner review, dispatch, failure and uncertain execution. A ready preflight or accepted proposal is never a successful placement receipt.

## Matrix checks and room-mode differences

The preflight reads existing Matrix API v1 discovery and `snapshot.assets`, `snapshot.anchors`, `snapshot.selection`, scene revision/runtime identity and room context from the paired `/scene` response. It requires `scene.read`, reviewed `scene.propose_text` with `offline-rules`, `request.read`, and cancellation-before-Apply support. A bare true value for the proposal capability does not establish its mode or Apply contract.

| Mode | Required placement context | Limits |
| --- | --- | --- |
| Virtual room | A current scene, exact installed asset, selected finite point and matching available anchor. API `white-room` maps to manifest `virtual`; older virtual scenes can omit `roomContext`. | This is an application room. No physical alignment or measured room geometry is inferred. |
| Room AR | The above plus ready, aligned, editable AR context and a measured MRUK support surface. The selected XZ point must be inside its reported polygon, with nonnegative surface clearance, positive reported prefab bounds and a valid catalog spawn scale. | Selection containment does not prove the whole prop footprint fits, prove physical volume, or establish wearer-visible placement. Matrix owns final geometry resolution, including lifting the prefab pivot so its lower bounds rest on the support plane. |

Read-only retained AR snapshots, missing anchors, walls, malformed/degenerate polygons, points outside a reported support polygon, position components outside Matrix's supported ±100 range, conflicting runtime/snapshot context and full scenes block the request. Installed asset display-name ambiguity also blocks: the existing text parser matches both asset IDs and exact display names.

The request is `Place a block here.` using the existing offline grammar and the runtime's exact installed `block` ID (display name `Terracotta block`). The parser checks exact asset IDs and display names before broader aliases; preflight requires that exact ID and rejects duplicate exact matches. An unrelated cube or compound block name cannot substitute for the required asset. The placement preflight proposes an optional geometric prop. The separate [Matrix scale lesson](Matrix-Scale-Lesson.md) discovers `experiment.block-scale.v1` after confirmed placement and checks the exact current block before each follow-up. Missing scale support does not prevent the placement or browser lesson. A successful command receipt plus matching observed object supports reported placement only. The browser's mathematical dimensions, volume ratio, learner responses and participation remain separate. No physical measurement, mastery, or successful save/restore is inferred from transform scale.

## Read-only reuse audit

The earlier [Reuse Audit](Reuse-Audit.md) remains applicable. This increment additionally read the following issue/source material without copying code, migrating data or changing the older applications:

| Existing work | Evidence reviewed | Decision for this bounded slice |
| --- | --- | --- |
| [sota-v2 #30](https://github.com/School-of-the-Ancients/sota-v2/issues/30) | Open creator-template proposal; it explicitly reports no template model/review flow in its baseline and points to existing versioned mentor/prompt/quest primitives. | Reuse versioned references and preserve the template/learner-record distinction. Do not build a second marketplace, creator repository or template import flow here. |
| [v2 lesson types](https://github.com/School-of-the-Ancients/sota-v2/blob/f21aaf2e04b2c28ddc6066df2773112b32fd2fac/src/features/lessons/lessonTypes.ts) and [lesson prompt directory](https://github.com/School-of-the-Ancients/sota-v2/blob/f21aaf2e04b2c28ddc6066df2773112b32fd2fac/prompts/lessons/README.md) | Stage/event types and persisted lesson/message mentor and prompt-version references; prompt directory scope. | Preserve authored stages, explicit provenance and saved learning continuity through the existing standalone lesson snapshots. No v2 service/database adoption. |
| [sota-beta #113](https://github.com/School-of-the-Ancients/sota-beta/issues/113) and [#114](https://github.com/School-of-the-Ancients/sota-beta/issues/114) | Open download/upload and user-created-character/quest database issues; neither has an implementation contract in its body. | Keep these as future reuse candidates, not evidence that an import/catalog implementation exists. |
| [beta types](https://github.com/School-of-the-Ancients/sota-beta/blob/5bf4ba01c794b398b3121081c06dd3b6bf6684f4/types.ts) | Character persona/prompt fields, quest objective/mentor binding, conversation artifacts, saved quest associations and learner records. | Preserve mentor/quest context and continuity in the learning experience. Do not import private records or require voice/media for text fallback. |

Matrix source was checked against local `matrix-client-api` revision `2b72319be01d4dd632ac4e41d700d1772dbbba8d`: `ControlService/client_api.py`, `ControlService/ai_adapter.py`, `Assets/Sandbox/Runtime/SandboxData.cs`, and `SandboxContentData.cs`. This confirms actual API fields, reviewed offline grammar, legacy virtual context, MRUK support geometry and bundle-source identity. Cached content lists are not used as installation evidence.

## Validation and remaining acceptance

`node --test tests/exhibits/prepared-exhibits.test.ts` covers valid browser/virtual/AR paths; manifest and lesson/prompt versions; missing capabilities/dependencies/runtime/selection; nonfinite points; out-of-bound and malformed support geometry; exact bundle provenance; ambiguous asset names; unsupported scripts/replacement; and unchanged inputs. Type checking covers the pure contract and its server integration.

These are deterministic synthetic fixtures. They do not claim a live provider call, headset acceptance, hosted browser transport, physical volume, immutable built-in build identity, or durable Matrix scene restore. The full roadmap issue remains open until its deployment, unfamiliar-user, real-room, and exact restore/content acceptance requirements have separate evidence.
