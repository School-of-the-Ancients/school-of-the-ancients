# Initial candidate validation

Recorded on 2026-09-22. This is a local School candidate and a separately tested Matrix connector building block, not a deployed School/Quest integration.

## Automated evidence

On Windows, Node.js 24.16.0:

- **41 tests passed, zero failed or skipped**, with `MATRIX_CHECKOUT` pointing to the isolated Matrix API checkout. This includes the opt-in cross-process test.
- `npm run typecheck` passed.
- `git diff --check` passed; Git reported only the checkout's normal LF/CRLF conversion notice.
- The ordinary CI suite omits the opt-in cross-repository check unless `MATRIX_CHECKOUT` is explicitly set. It does not call a live model.

Coverage includes complete lesson progression, exact saved lesson/mentor/artifact state, restart/interruption, request deduplication, cancellation and ignored late results, global provider concurrency, revision conflicts, malformed records, failed disk replacement and recovery, provider output/tool boundaries, Host/Origin checks, escaped transcript content and browser draft recovery.

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

## Remaining acceptance

- User comparison of this concrete candidate with beta's preferred experience, before expanding a remake (roadmap #2B).
- School lesson controls connected to Matrix through the optional adapter; hosted transport, durable connector events/checkpoints and headset acceptance.
- Optional speech/captions, additional visual adapters, sourced historical teaching evaluation and more prepared lessons.
- Immutable checkpoints/import, retention and multi-user/hosted deployment design. Current export is a record, not an import/restore implementation.
- A full beta/v2 runtime comparison remains pending; the reuse audit's repository inspection must not be described as side-by-side deployed acceptance.

No repositories or learner records were migrated, and no PR was merged by this implementation work.
