# Develop and validate School

Use Node.js 24+ and `npm ci`. The backend uses Node's native TypeScript support and built-ins; the browser uses plain ES modules. There is no compile step for local development. TypeScript and Node types are development-only dependencies. Run `npm start` and open `http://127.0.0.1:8792/`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCHOOL_PORT` | `8792` | Loopback listener; choose an unused port |
| `SCHOOL_DATA_DIR` | `.school-data` in repository | Exclusive local record directory; ignored by Git |
| `SCHOOL_PROVIDER` | `demo` | `demo` or `codex-cli` |
| `SCHOOL_CODEX_EXE` | unset | Absolute native executable path; `.exe` on Windows |
| `SCHOOL_CODEX_MODEL` | unset | Explicit model available through the local Codex sign-in |

Stop and restart School to change backend code or environment. Reload the page after client edits. Use a new data directory for independent tests; two processes cannot own the same directory. Changing the provider does not migrate or erase existing records. Every generated reply stores its actual provider mode; the opening authored guidance remains labeled authored.

### Live mentor verification

With `SCHOOL_CODEX_EXE` and `SCHOOL_CODEX_MODEL` set:

```powershell
node examples/verify-live-mentor.ts
```

This explicitly consumes a real model turn using a fictional geometry question. It creates isolated temporary records, prints the teaching answer and receipt, and removes its own temporary records afterward. It checks that a question leaves the stage unchanged. It does not create a student account or call Matrix.

For a broader five-question smoke check, run `node examples/evaluate-mentor.ts --run-live --output Validation/NEW-REPORT.json`. It makes at most five model turns and refuses to overwrite a report. The [recorded evaluation](../Validation/Mentor-Evaluation.md) separates repeatable transport/state checks from qualitative teaching review.

The adapter checks `codex login status` for a ChatGPT sign-in before inference. It invokes `codex exec --ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only --json`, requests a JSON schema, disables tools/features, and runs from a fresh temporary directory. It strips API-key environment variables from the child. Model configuration is explicit; the receipt records `requestedModel` and records `actualModel` only when the CLI supplies it. Do not infer actual model identity from the requested name alone. Reference: [official noninteractive Codex command documentation](https://learn.chatgpt.com/docs/developer-commands#codex-exec).

Provider errors are sanitized. A timeout, cancelled turn, rejected tool event, invalid output or failed login must not advance the lesson. No application endpoint accepts arbitrary provider executables or model configuration from the browser.

Mentor context contains the recent transcript and current browser experiment. For lessons with Matrix demonstrations it also includes up to four recent request-state summaries and the last confirmed historical placement, so later questions retain evidence after transcript truncation or School record reload. This allowlist includes status and School record timestamps, but excludes connection addresses, pairing data, internal IDs, transforms, raw room data, proposals and error text. It does not query Matrix or establish the current connection, current object presence, camera evidence, physical measurements or mastery.

## Automated checks

```powershell
npm.cmd test
npm.cmd run typecheck
```

Tests cover request identity, concurrent turns, stale revisions, restart recovery, persistence failure, corrupted-store preservation, browser intent/escaping, provider cancellation, scoped Matrix transport and execution evidence. They use deterministic provider fixtures; test counts and observed results are in [Validation](Validation.md).

### Matrix contract test

These local checks require an updated Matrix checkout containing `ControlService/client_api.py`. The scale case also requires the `experiment.block-scale.v1` capability from Matrix PR #36:

```powershell
$env:MATRIX_CHECKOUT='<absolute Matrix checkout path>'
$env:MATRIX_REQUIRE_SCALE='1'
node --test tests/integration/matrix-http.test.ts
node --test tests/integration/school-matrix-http.test.ts
```

`PYTHON_EXE` optionally selects Python. The test starts a **new ephemeral loopback** Matrix server on a dynamically assigned port with a random test credential and synthetic room. It pairs the School-side client, proposes an edit, confirms no pre-Apply command, performs owner review/Apply, delivers synthetic runtime receipts and verifies results, deduplication, cancellation and revocation. It shuts down its own server and never contacts an existing Operator or Quest.

The second file tests three School HTTP paths: virtual placement, AR placement and virtual scale/reset. It reopens School's durable records to verify confirmed evidence survives and unfinished work is not replayed. Together the two files contain four cross-repository tests. Without `MATRIX_CHECKOUT`, all four skip explicitly; ordinary tests still exercise deterministic transport, preflight and bridge fixtures. With an older Matrix checkout, only the scale case may skip unless `MATRIX_REQUIRE_SCALE=1`, which requires the capability and fails if it is absent. These checks use synthetic runtime receipts and do not establish Unity or headset acceptance.

GitHub Actions runs all four cases on Windows and Ubuntu. It checks out Matrix commit `d7fdb511864fd04e228284ead2fe3af08fe97a60` beside the School checkout, sets `MATRIX_CHECKOUT` and `MATRIX_REQUIRE_SCALE=1`, and runs the complete Node test suite and type check. Separate checkout directories keep Matrix's unrelated files outside Node test discovery. CI uses Node 24 and Python 3.13, with read-only repository permissions; it does not call a live model or headset.

CI also runs the Windows acceptance runner's portable cleanup regressions using isolated fake processes and temporary files:

```powershell
python -B -m unittest discover -s tests -p test_windows_acceptance_runner.py -v
```

These four Python tests exercise failure cleanup and preservation of pre-existing configuration on either platform. They do not launch Unity or substitute for the separate actual Windows-player acceptance run.

The optional [live mentor-to-scene Windows runner](Mentor-Scene-Windows-Validation.md) separately checks the full Galileo suggestion → Matrix Codex proposal → narrowly reviewed Apply → actual Unity receipts → Galileo reflection sequence. Its [sanitized September 22 result](../Validation/mentor-scene-windows.json) passed 24 checks. It records desktop runtime execution, with Quest alignment and rendering still to be checked on device.

### Separate local companion sample

Use Matrix's updated `/clients` owner page to create a short-lived pairing code, then:

```powershell
$env:MATRIX_BASE_URL='http://127.0.0.1:<updated-service-port>'
$env:MATRIX_PAIRING_CODE='<current pairing code>'
node examples/matrix-client.ts
```

The sample discovers capabilities and pairs in memory. To submit a proposal, additionally set `MATRIX_REQUEST_TEXT` and a unique stable `MATRIX_REQUEST_ID`. It does not Apply or retry automatically. Review the proposed commands in Matrix. Keep the existing service's authentication/room configuration under its owner; this sample never receives the owner token. Remove the temporary pairing-code environment variable afterward.

Matrix uses memory-only request ledgers in this slice. Reconcile ambiguous outcomes with the same request ID while its session exists. Do not blindly replay after a service restart or new pairing. The client accepts loopback origins only; hosted School connectivity is not implemented. See [Matrix's v1 contract](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/codex/matrix-client-api/Docs/Client-API-v1.md).

## Local record recovery

Graceful shutdown releases `.writer.lock`. A forcibly killed process can leave that lock. Before recovery, stop the owning School process, verify the lock's recorded PID belongs to that stopped instance, and back up the data directory. Remove only the stale `.writer.lock`, then restart. Never remove a live process's lock or delete `school-store.json` to suppress a validation error. Invalid records are preserved for inspection.

An interrupted provider turn is recorded as interrupted on startup. If storage becomes unavailable after inference, status reports a persistence failure instead of pretending completion; once storage recovers, the service records the failed turn without rerunning inference. Exported JSON is a portable record, but automatic import and checkpoint restore are not implemented yet.

### Historical Matrix scale context

When a lesson has Matrix scale records, mentor input includes at most four recent scale requests and the latest confirmed result. Summaries identify requested and acknowledged dimensionless factors, the mathematical ratio, status and historical timing. They exclude credentials, room snapshots, object/binding IDs, origins and full transforms. A later unconfirmed check remains explicit; no record proves current presence, physical volume, browser geometry or learner mastery.
