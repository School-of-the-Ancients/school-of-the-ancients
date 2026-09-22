# School scale: actual Windows acceptance

The [sanitized evidence](../Validation/school-scale-windows.json) records **31 passed checks** on September 22, 2026, 09:50:21–09:50:28 UTC. The runner connected the actual School HTTP server to Matrix's HTTP API and a real isolated Windows Unity player. It injected no synthetic runtime snapshots or acknowledgements.

## Observed result

School paired with Matrix and requested its built-in Terracotta block. The proposal waited without changing Unity. After the harness inspected the exact spawn command and called the authenticated owner Apply endpoint, School confirmed the real runtime receipt and observed object.

The next request configured scale factors `(2, 2, 2)` on that same block. It again required separate owner review and Apply. Unity reported scale approximately `(0.4, 0.4, 0.4)` from the original `(0.2, 0.2, 0.2)`. School saved the acknowledged mathematical volume ratio **8**, matching independent arithmetic on the actual Unity transform.

A separately reviewed reset restored the original position, rotation and scale and recorded ratio **1**. Both records remained in the lesson history. Neither placement, configuration nor reset advanced the lesson stage or changed the browser's independent experiment.

The runner then stopped and restarted its own School process using the same disposable store. Both confirmed observations survived. The temporary pairing was unavailable after restart, readiness was withdrawn, and no Matrix commands replayed. The stored record contained no owner secret, pairing code, client token or complete runtime snapshot.

The real-player preparation also exposed a compatibility defect: this desktop fixture omits `snapshot.roomContext` and reports `runtime: null`. The bridge now accepts that existing virtual-room format while rejecting explicit AR contexts and MRUK anchors. The successful run used the unmodified runtime format. Fresh placement records also retain their original room identity for later scale checks.

## Code and build identity

| Component | Tested identity |
| --- | --- |
| School base | `1210494c29654c46597307365bdfcc2dbb80dc39`, plus the frozen scale implementation |
| Matrix scale API | `ddb2a0df065321104244f31bbb0af367e3524dec`, [PR #36](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/36) |
| Reused Unity runtime source | `1af3715bcffdcef8e1eb5299b1b4b9918d39b6e9`, [PR #35](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/35) |
| Runtime target | Unity `6000.6.0f1`, `StandaloneWindows64` |
| Harness environment | Python `3.13.14`, Node.js `24.16.0` |

The JSON pins all 13 School source/package files, all 13 Matrix service modules, the runner, the player executable and `Assembly-CSharp.dll`. Source hashes normalize CRLF to LF; binary hashes use the original bytes. The School fingerprints were checked against the publication worktree after execution. The School base commit alone does not identify its then-uncommitted implementation; use the file hashes for exact comparison.

This capability added no Unity code. The reused PR #35 player had already passed its separate 384-check Unity build validation; this run did not repeat that build. Its own validation product profile stayed separate from the normal Matrix application, and its content cache remained byte-identical.

## Reproduce

Use Windows, Python 3.10 or newer, Node.js 24 or newer, a Matrix checkout including PR #36, and an isolated validation player. The PR #35 build script supports a separate product identity through `Build-WhiteRoom.ps1 -Target Desktop -ValidationId <unique-id>`. A normal user application build is intentionally rejected by this runner.

From this School checkout:

```powershell
python examples/verify-matrix-scale-windows.py `
  --matrix-checkout '<Matrix checkout including PR #36>' `
  --player '<isolated validation MatrixOperator.exe>'
```

The [opt-in runner](../examples/verify-matrix-scale-windows.py) checks the player's product identity, freezes source copies, creates fresh loopback ports and disposable service data, and uses authored demo mentoring without model calls. It writes its temporary credential file exclusively and never overwrites an existing one. It inspects each proposal before calling owner Apply; no School Apply endpoint is introduced.

Raw traces, frozen sources and temporary learner data remain in ignored `work/`. The runner prints its report path. After finishing, its School and Matrix services and player are stopped, and its temporary credential file is removed. Live Matrix services, Workshop and Quest are untouched.

The cleanup audit reproduced a child-exit race that could interrupt the original runner's cleanup. The runner now handles a broken child-input pipe and attempts each owned resource independently; an unreleased resource makes the report fail. It preserves pre-existing or externally replaced credential files and only stops processes it launched. Four cleanup regressions passed before the real-player rerun above:

```powershell
python -B -m unittest discover -s tests -p test_windows_acceptance_runner.py -v
```

## Limits

This is actual headless Windows execution with API-level owner approval. A human did not click Apply in this run, and rendered appearance was not inspected. Browser interaction and live mentor checks are separate evidence. The confirmed ratios describe virtual transform geometry; they do not establish measured physical volume, physics, learning mastery, current object presence after later edits, or Quest/AR acceptance.
