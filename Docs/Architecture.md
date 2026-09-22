# Text-first implementation candidate

Decision status: provisional implementation for roadmap #2A and #13. User comparison/review (#2B), broad migration and hosted deployment remain pending.

## Authority and modules

| Module | Owns | Does not own |
| --- | --- | --- |
| `src/shared/contracts.ts` | Versioned School session, turn, lesson, artifact and provider receipts | Matrix runtime schemas or provider audio sessions |
| `src/server/content.ts` | Authored mentor/lesson definitions and teaching stages | Model inference or scene execution |
| `src/server/school-service.ts` | Validated transitions, cancellation, revision checks, durable request identity | Browser layout or provider process management |
| `src/server/repository.ts` | Local records, validation, exclusive writer and atomic replacement | Cloud identity or beta/v2 migrations |
| `src/server/providers.ts` | Text provider interface, scripted demo, bounded Codex CLI adapter | Lesson progression or executable scene tools |
| `src/server/http.ts` | Local HTTP delivery, request/origin limits and static content | Hosted authentication |
| `public/` | Browser experience and deterministic visual preview | Credentials, model calls or authoritative progress |
| `src/integrations/matrix-client.ts` | Optional local Matrix transport, request/result validation | Apply authority or student records |
| `src/exhibits/prepared-exhibits.ts` | Versioned exhibit data and pure dependency/readiness checks | Content downloads, room mutation or inference |
| `src/server/matrix-bridge.ts` | Explicit lesson pairing, durable request intent, minimal observed evidence | Operator credentials, Apply authority or lesson advancement |
| `src/server/matrix-ledger.ts` | Strict saved demonstration validation and bounded connection history | Runtime state or token storage |

The lesson engine owns the next step. A model receives the target stage and can explain it, but cannot advance the stored session, execute tools, grant mastery, or invent an observation. A question leaves the stage unchanged. A successful answer advances according to the authored lesson. The initial model response is text, not arbitrary HTML or downloadable executable behavior.

The first artifact is intentionally a typed scale illustration. Future artifact adapters need their own validated type, provenance, loading/error/history states and capability acceptance; general interactive HTML and generated-image modules are not implemented by this one visual. STT/TTS are absent, so the canonical session has no audio-provider dependency.

## Persistence and concurrency

One process exclusively owns each data directory. Mutations clone and validate a draft, write and fsync a temporary record, and rename it into place before publishing the new in-memory state. Failed writes preserve the prior record. Accepted turns persist before inference begins. On restart, running turns become interrupted rather than replaying inference. Existing lesson and mentor snapshots stay with each saved session.

Stable request IDs and fingerprints prevent duplicated turns, experiments or cancellations. Reusing an ID with different input fails. Session revisions reject stale edits; only one mentor turn may run per session. Cancellation commits before aborting the provider and suppresses late output. Exports are learning records, not immutable checkpoints or a Matrix save.

This bounded candidate stores up to 200 sessions, 5,000 turns, 10,000 request receipts and 16 MiB. It deliberately refuses capacity overflow instead of silently deleting history. Multi-user identity, database migrations, automatic lock recovery and record retention policy are future deployment work.

## Optional Matrix boundary

The connector uses Matrix's independently implemented `/api/v1/` local companion API. A short-lived code grants a scoped session tied to one runtime generation. The client can discover capabilities, read a scene, propose a supported text edit, poll results and cancel before Apply. Only the owner can Apply. Runtime command receipts and observed snapshots are distinct from proposal success and educational interpretation.

The current Matrix implementation uses bounded **memory-only** session/request ledgers. Service restart loses them; an uncertain request must not be replayed after re-pairing. This client never automatically retries a mutation. Hosted browser transport, durable replay, room captures and content installation are not exposed by this slice. A real cross-process test uses synthetic data and does not establish headset acceptance.

No learner transcript is sent to Matrix. The optional lesson bridge sends one fixed prepared block request with an opaque correlation ID. It reserves the intent in School before network submission, keeps the scoped Matrix credential only in memory, and saves a minimal original acknowledgment/object summary. A separate lesson note supplies that result to future mentor turns. Neither that note nor runtime success advances the lesson, replaces its browser experiment, or grants mastery.

On School restart, successful demonstration evidence survives while unfinished requests become unconfirmed. Re-pairing cannot adopt or replay an earlier request. School records, curriculum and assessment stay here. See [the bridge contract](Matrix-Bridge.md) and [prepared-exhibit module](Prepared-Exhibits.md).

## Compatibility and rollback

This app runs beside beta, v2 and Matrix on its own loopback port and new directory. It imports no existing records and replaces no existing service. Stop it and return to the original products to roll back the experiment. Reuse candidates and known experience losses are documented in [Reuse-Audit](Reuse-Audit.md). Broader expansion requires review of this working slice, not an automatic migration decision.
