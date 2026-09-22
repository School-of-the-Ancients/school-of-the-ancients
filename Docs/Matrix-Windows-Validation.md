# School → Matrix → Windows runtime acceptance

On 2026-09-22, a real local School server completed the optional prepared
demonstration through Matrix's client API and an isolated Unity Windows player.
This run used actual HTTP, command acknowledgements and Unity snapshots. No
synthetic runtime snapshots were submitted.

[The sanitized evidence](../Validation/matrix-windows-integration.json) records
the exact commits, source/binary hashes, assertions and limits. School's tested
backend matches commit `d3d923bf0216ebd8a14abc997036c96abe2e141f`. Matrix was a
**local-only combination** of [PR #34](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/34)
at `d9166f3d9f2c3fc05a2e9fe2a168d7d690d7e60d` and
[PR #35](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/35)
at `1af3715bcffdcef8e1eb5299b1b4b9918d39b6e9`. Neither PR was merged remotely for
this test. The reused player was built from PR #35 with Unity `6000.6.0f1` and
had its own validation product name and persistent cache.

## What passed

1. School paired through a one-use code and verified Matrix's actual installed
   `block` asset and selected placement point. An earlier `cube` assumption was
   corrected to match the runtime catalog before this acceptance run.
2. School requested its fixed block recipe. Repeated real-player heartbeats left
   the scene unchanged until the harness inspected the exact proposal and called
   the **authenticated owner Apply endpoint**. A human did not click Apply in
   this run; the School client had no Apply authority.
3. Unity placed the block. School matched the command receipt, object ID,
   position and scale and recorded `succeeded`. The lesson stayed at `explain`,
   and its browser geometry artifact was unchanged. The durable School record
   excluded the owner secret, pairing code and full Matrix room identity.
4. The combined service registered a previously cached procedural beacon pack,
   then saved a scene containing the School block and beacon. After the player
   exited, its provider was disabled and a new player process started with no
   downloaded pack registered. Normal restore recovered both exact saved objects
   with **zero additional bundle requests**.
5. School retained the historical confirmed result, withdrew readiness under the
   old pairing, and rejected a new demonstration with HTTP 409 without altering
   the restored scene. Owned processes and temporary owner configuration were
   removed afterward.

The combined Matrix checkout also passed **436 Python tests** and all three Node
panel suites. The reused Windows player had passed **384 Unity core checks** and
a successful desktop build. Its executable and application assembly hashes are
both recorded; the launcher executable hash alone does not identify runtime code.

## Repeating the check

Use disposable checkouts containing the exact revisions above and a new School
data directory. Build an isolated desktop profile with Matrix's
`Build-WhiteRoom.ps1 -Target Desktop -ValidationId <unique-id>`, then export its
procedural beacon using the [content-pack validation instructions](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/1af3715bcffdcef8e1eb5299b1b4b9918d39b6e9/Docs/Content-Packs.md#validation-fixture).
Run independent loopback Matrix/School services on unused ports with a temporary
owner credential confined to that validation profile. Follow the five steps
above and compare actual receipts and saved/restored scenes. The private harness
and raw temporary traces are not committed; this record contains sanitized
results, not a portable one-command test runner.

This is **headless Windows virtual-runtime acceptance**. It does not establish
browser UI interaction, visual appearance, human room alignment, Quest execution,
MRUK recovery, physical measurements, a hosted connection or learner mastery.
The mentor used authored demo responses. Separate synthetic browser/AR tests
remain separate evidence and do not replace those device checks.
