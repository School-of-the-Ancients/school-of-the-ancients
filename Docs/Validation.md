# Candidate validation

Recorded on 2026-09-22. This is a local School candidate with an optional Matrix connection, not a deployed School/Quest integration.

## Automated evidence

On Windows, Node.js 24.16.0:

- **45 tests passed, zero failed or skipped**, with `MATRIX_CHECKOUT` pointing to the isolated Matrix API checkout. This includes the opt-in cross-process test.
- `npm run typecheck` passed.
- `git diff --check` passed; Git reported only the checkout's normal LF/CRLF conversion notice.
- The ordinary CI suite omits the opt-in cross-repository check unless `MATRIX_CHECKOUT` is explicitly set. It does not call a live model.

Coverage includes complete lesson progression, exact saved lesson/mentor/artifact state, restart/interruption, request deduplication, cancellation and ignored late results, global provider concurrency, revision conflicts, malformed records, failed disk replacement and recovery, provider output/tool boundaries, Host/Origin checks, escaped transcript content and browser draft recovery.

Independent review found and fixed two additional defects: coercible array values could masquerade as a question kind and advance the lesson, and retrying an older submission could erase a newer unsent draft. Regression tests now reject non-string enums without persistence/inference and preserve draft text and its question/answer intent across retry and stage changes.

The real Matrix HTTP test starts a new ephemeral Python service and synthetic runtime. It verifies discovery, scoped pairing, current revision, no automatic Apply, owner Apply, command receipts and observed snapshot, duplicate suppression, cancellation and revocation. It uses no existing room, service token, or headset.

## Browser and live-provider checks

The Codex in-app browser exercised the locally running candidate:

1. Academy → selected Galileo/scale lesson → authored opening.
2. Submitted a question; received an authored explanation without advancing the stage.
3. Advanced to prediction, restarted the dedicated School test service, reloaded and resumed the same saved transcript and stage from the academy.
4. Submitted a prediction, previewed `2 × 2 × 2`, then applied it. Preview and recorded states were visibly distinct; the saved result was volume `8`.
5. Submitted observation, explanation and reflection. The lesson reached complete with an explicit participation-not-mastery label.
6. Reloaded and reopened the completed notebook. Export produced the export notice; the export API/content are separately covered by automated tests.
7. Inspected the academy and lesson screenshots. Corrected the initial cuboid face geometry and verified the closed three-face diagram visually and with a regression test.

Two real Codex turns were verified through the existing local ChatGPT sign-in with **requested model** `gpt-5.6-sol`:

- `examples/verify-live-mentor.ts`: doubling width alone gave twice the volume, completed receipt, zero tool calls, unchanged lesson stage.
- Actual browser → HTTP → provider → saved transcript: asked about doubling width while halving height. The response correctly explained `2 × ½ × 1 = 1` and explicitly distinguished this hypothetical calculation from the unchanged recorded browser experiment. The UI changed from configured/unverified to **Live AI** only after success.

The CLI did not report an actual model identifier in those receipts; this record does not infer one. These successful examples prove the local transport/turn path, not broad teaching-quality or historical-accuracy evaluation.

Matrix's isolated owner page was also exercised in the in-app browser: load connections → inspect ready proposal → Apply → queued → succeeded with a synthetic runtime receipt → revoke client. An expired proposal correctly showed stale with no Apply control. That test service was stopped afterward. Existing Matrix services and Quest were untouched.

## Optional prepared-exhibit bridge

The next increment adds the versioned Galileo exhibit manifest, readiness checks, durable demonstration records, and a pairing/review/result panel inside the lesson. The original 45-test baseline above remains the evidence for PR #1; this increment adds its own fixture and integration coverage.

At this checkpoint, **99 tests passed, zero failed or skipped**, with `MATRIX_CHECKOUT` set. Type checking and whitespace checks passed. The ordinary suite explicitly skips the three real cross-repository HTTP cases when that checkout is absent.

The actual School HTTP server was exercised against the actual Matrix Python HTTP server and a synthetic runtime. The acceptance test verifies pairing, fresh readiness, a fixed block request, duplicate suppression, no dispatch before Operator Apply, no School Apply endpoint, matched command receipts and observed object evidence, and unchanged lesson stage/browser experiment. Reopening School's store preserves confirmed evidence, marks an unfinished proposal unconfirmed, and performs no automatic replay. The browser experiment remains usable while disconnected.

Manual in-app browser checks exercised the separate School and Operator pages: begin lesson → open optional connection → enter temporary code → request block → inspect exact proposal in Operator → Apply → School displays **Runtime confirmed** and saves a lesson note. The lesson remained at Explore and its recorded browser dimensions remained `1 × 1 × 1`. This was a synthetic runtime, not a headset.

A real Codex reply through that browser session correctly distinguished the historical placement report from current object presence, camera evidence and physical volume. It described the browser's `1 × 1 × 1` record as a mathematical model. The question did not advance the lesson. The requested model was `gpt-5.6-sol`; the receipt supplied no actual model identifier. Browser inspection also caught and fixed a transcript scroll being cancelled by a follow-up provider-status render.

The [actual Windows runtime check](Matrix-Windows-Validation.md) subsequently passed using the exact committed School backend and a local combination of Matrix PRs #34/#35. It verified reviewed placement, original Unity receipts/snapshot, provider-disabled restart restore with zero downloads, and rejection of a stale pairing. The [five-case live mentor smoke evaluation](../Validation/Mentor-Evaluation.md) separately records five successful text-only turns, correct geometry in those examples, preserved uncertainty, and one wording/relevance improvement. Neither substitutes for headset or educator acceptance.

Review and regression work includes older connection links pointing to their original Operator, out-of-order School responses preserving the newer lesson state, a mentor-turn/Matrix-result race that could leave the composer waiting, contradictory runtime outcomes, and bounded AR selection/placement checks. Successful evidence is retained as the original historical result rather than rewritten by later scene reads.

Real-player preparation exposed the built-in asset's actual ID, `block` (Terracotta block), rather than the earlier synthetic `cube` fixture. The package now requires that exact identity and uses the parser's exact-ID tier. A persisted, allowlisted historical evidence summary also remains in mentor context after the original placement note falls outside the recent-message window; it does not claim current presence or current connectivity.

## Optional local mentor read-aloud

This increment adds manual playback, replay and stop for the latest persisted mentor reply using a browser-reported local English voice. Text remains available without speech support. It adds no microphone input or historical voice imitation. Server capability `mentor.voice.v1` remains unavailable; the browser controls expose their own narrower playback availability.

On September 22, 2026, the targeted run of `node --test tests/mentor-speech.test.js tests/client/app-interactions.test.js` passed **29 tests, zero failed or skipped**: 16 adapter checks and 13 application checks, including four new speech interactions. Coverage includes local-only voice selection, missing support, asynchronous voice availability, exact saved text, cancellation, ignored stale playback callbacks, and lesson/context transitions. These are simulated speech API events, not recorded audible output. The subsequent full suite passed **119 tests, zero failed or skipped**, with `MATRIX_CHECKOUT` pointing to the isolated Matrix scale-capability checkout; type checking also passed. Earlier counts above describe their respective checkpoints.

The actual Codex in-app browser separately detected **Microsoft David, English (United States)** as a local device voice. Manual **Listen to latest reply** changed the UI from **Starting audio…** to **Reading the latest reply**, driven by the real browser's utterance `onstart` event. **Stop audio** returned it to **Ready when you are.** Manual replay read the same current caption, and no automatic playback was observed.

This verifies browser voice enumeration and the start/stop/replay lifecycle. No human listening assessment was performed: sound audibility, intelligibility, pronunciation and comfort remain pending, as do screen-reader compatibility, broader browser/device coverage, hosted behavior and Quest acceptance. See [mentor read-aloud](Mentor-Speech.md) for the controls and browser API references.

## Remaining acceptance

- User comparison of this concrete candidate with beta's preferred experience, before expanding a remake (roadmap #2B).
- Real Quest placement and teacher/student walkthrough of the optional bridge; hosted transport and durable Matrix events/checkpoints.
- Browser/device speech acceptance, voice input and broader voice adapters, additional visual adapters, sourced historical teaching evaluation and more prepared lessons.
- Immutable checkpoints/import, retention and multi-user/hosted deployment design. Current export is a record, not an import/restore implementation.
- A full beta/v2 runtime comparison remains pending; the reuse audit's repository inspection must not be described as side-by-side deployed acceptance.

No repositories or learner records were migrated, and no PR was merged by this implementation work.
