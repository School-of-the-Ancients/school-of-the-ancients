# Optional local Matrix companion

School remains a standalone text lesson with its browser geometry illustration. The placement bridge adds one optional prepared demonstration: **request one installed built-in block at the placement point selected in Matrix**. The request is always `Place a block here.` using Matrix's offline rules. Neither the learner nor the mentor can supply arbitrary scene commands through this route. After confirmed placement, the optional [Matrix scale lesson](Matrix-Scale-Lesson.md) can propose bounded scale presets and a separate reset in the desktop white room.

School owns the learning session, transcript, lesson stage and durable record. Matrix owns room state, installed content, command execution and observed runtime receipts. The connection uses the versioned Matrix client API and existing TypeScript client; no shared Matrix database or Unity internals are read.

## Walkthrough

1. Run School locally and open a Galileo / Observation and Scale lesson. The browser lesson works without Matrix.
2. Run a Matrix build/service that provides client API v1. The legacy Operator port alone does not establish API support. Configure its owner authentication and connect its runtime using Matrix's instructions. This School app never receives the owner credential.
3. In Matrix, select the surface where the block should appear. For an AR room, complete room localization and confirm alignment in the Operator.
4. Open Matrix's **Clients** page (`/clients`) and create a one-use code. In School's optional Matrix panel, enter that service's loopback origin and the code. Codes are submitted in the request body, never a URL. The School server exchanges the code for a narrow client credential.
5. Refresh readiness. School verifies the exact prepared lesson/mentor references, supported API capabilities, installed `block` asset and usable current selection. Missing room data, incompatible asset identity or a changed scene blocks the request. Built-in asset identity is limited to its reported asset ID; this is stated explicitly.
6. Request the block. School saves the request identity before contacting Matrix. **Ready** means a reviewable proposal exists; the room has not changed yet. Inspect School's proposal summary, then open the Matrix Operator to inspect the complete position/scale and **Apply** there.
7. Check the result. School accepts reported placement only after the original paired runtime reports the matching command acknowledgement and observed block. The optional demonstration never advances a lesson stage. Continue the browser experiment and learner reflection normally.

Cancel before Apply removes a pending proposal if Matrix confirms cancellation. Cancellation after dispatch is not rollback. Disconnect forgets all local Matrix credentials for that School lesson; it does not revoke remote Matrix sessions or cancel pending proposals. Inspect the Operator before disconnecting with unresolved work.

## What the record means

| State | Meaning |
| --- | --- |
| `submitting` | Intent saved in School; a response has not yet been recorded. |
| `ready` | Matrix proposed work and still requires owner Apply. |
| `queued` / `running` | Matrix accepted or dispatched work; this is not confirmed placement. |
| `succeeded` | Original request, runtime, command acknowledgement and observed built-in block matched. |
| `unconfirmed` | School cannot safely establish the result. Inspect/reconcile the original request. |
| `cancelled`, `stale`, `failed`, `partial`, `error` | The original request was not verified as this completed demonstration. Preserve any receipts and inspect its details. |

A successful record proves **reported virtual-object placement**. It does not prove physical volume, camera vision, current headset visibility, learner understanding, or mastery. The browser's dimensions and calculated volume are a separate mathematical illustration. The provider receives only a small explicit transcript summary of verified placement, not a room snapshot or capture.

The bounded recipe also verifies the proposal's selected XYZ, zero rotation and catalog spawn scale. Virtual-room observations must match that transform. For a measured support, the request uses Matrix's existing `surface` placement mode; School records the reported prefab bounds and accepts only the pivot height implied by those bounds: `selectedY - (centerY - sizeY / 2) * spawnScale`. This comparison allows float serialization tolerance, not arbitrary height or a different same-anchor point. Unity still owns actual surface fit and placement validation. An older Matrix service that omits the surface hint cannot be verified as this AR recipe.

## HTTP contract

All routes use School's same-origin, loopback-only API and return `MatrixBridgeResponse`: current `session`, `bridge` connection/readiness/history, and an optional `demonstration` or `experiment`. `bridge.experiments` contains the separate scale history, while `bridge.scale` reports current eligibility and the Matrix revision. Browser code talks only to School; the School server talks to Matrix. There is no School Apply endpoint.

| Method and route | Body / behavior |
| --- | --- |
| `GET /api/v1/sessions/:id/matrix` | Read fresh discovery and paired scene for readiness; never sends scene commands. |
| `POST .../matrix/pair` | `{requestId, expectedRevision, url, pairingCode}` |
| `POST .../matrix/disconnect` | `{requestId, expectedRevision}`; drops this lesson's in-memory credentials. |
| `POST .../matrix/demonstrations` | `{requestId, expectedRevision, bindingId, expectedMatrixRevision}`; fixed block recipe only. |
| `GET .../matrix/demonstrations/:requestId` | Poll the original request under its original pairing. |
| `POST .../matrix/demonstrations/:requestId/cancel` | `{requestId}` identifying this cancellation action, distinct from the demonstration ID in the path. |
| `POST .../matrix/experiments` | `{requestId, expectedRevision, bindingId, expectedMatrixRevision, demonstrationId, action, factors?, baselineExperimentId?}`; configure/reset the confirmed block only. |
| `GET .../matrix/experiments/:requestId` | Reconcile the original experiment without replay. |
| `POST .../matrix/experiments/:requestId/cancel` | `{requestId}`; cancel only before Operator Apply. |

Use a new opaque action ID for a new user action. Repeating an identical action ID returns its recorded result without another mutation. Changing non-secret action data with the same ID returns `request_conflict`. A pairing action never stores its secret code or code digest; changing the code while reusing the same action ID still only returns the first action's state. Obtain a fresh code and use a fresh action ID to pair again deliberately.

School revision and Matrix revision protect different authorities. School rechecks its revision after network readiness reads; Matrix independently rejects a stale scene/selection revision before planning. Bridge requests are serialized per School session while a network action is in progress. A mentor turn may run independently; clients must adopt returned School revisions monotonically.

## Persistence, restarts and uncertain outcomes

The existing School session store contains a bounded optional `matrix` ledger: pairing metadata, prepared-package version/digest and identity references, original selected anchor/point, request/runtime/correlation IDs, summarized proposal, command IDs, sanitized receipts and at most one matched observed block. It excludes bearer tokens, one-use codes, complete proposal/room snapshots, unrelated objects and images. The ledger is part of the ordinary session export and resume; there is no second progress store.

Contradictory results are rejected: a cancelled or unapplied request cannot contain execution acknowledgements, and this one-command recipe cannot claim partial batch success. Later failures preserve previously confirmed evidence and show a separate check error.

- Reservation must save successfully before dispatch. If saving intent fails, no Matrix mutation is sent.
- If Matrix may have accepted an action but its response is lost, the result stays unconfirmed. Polling queries that same request; it never resubmits it.
- If School receives a result but cannot save it, it returns `persistence_failed` and retains the pending local write in memory. Repair storage and check/retry the original action ID to save the result without another network mutation.
- Restarting School loses all credentials. Unfinished records become unconfirmed. Confirmed historical evidence remains, but it does not establish the current scene. Re-pairing does not replay or adopt an earlier request.
- Within one process, an earlier pairing can still be used to check its own request after a deliberate re-pair. It cannot be used to create a new demonstration through a replacement active binding.
- Matrix itself retains client outcomes in memory. A Matrix service restart, runtime lease change, expiry or revocation may prevent reconciliation. In that case inspect the Operator; School cannot infer success from a later room snapshot.
- Command acknowledgements are never dropped or attached to another request. Previously confirmed evidence cannot be replaced by a later mismatched object transform or downgraded by a conflicting response.

Limits are 16 pairing records, 64 demonstration records and 64 scale experiment records per School session, in addition to existing store/session/transcript limits. Capacity failures preserve existing records. This slice does not prune or migrate learning data.

## Validation boundaries

Deterministic fixture tests cover pairing/request/cancel idempotency, revision and concurrency races, uncertainty after lost replies, restart without replay, original-binding reconciliation, receipt/object correlation, secret exclusion, bounded local destinations and write failures. The real-process test can run School HTTP against an isolated Python Matrix server with a synthetic runtime. Such tests establish the API boundary, not Quest headset or physical-room acceptance.

The [headless Windows Unity round trip](Matrix-Windows-Validation.md) has separate recorded acceptance, including actual receipts and provider-disabled cache restore. Still pending: Quest/real-room acceptance, hosted-browser companion pairing, complete prepared checkpoint/scene restoration, content preparation/import, camera capture through the client API, voice, avatar and learning assessment. Each remains independently optional; no unavailable capability is simulated as live success.
