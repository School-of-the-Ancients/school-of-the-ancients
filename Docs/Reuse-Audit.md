# Reuse audit and provisional implementation choice

Reviewed 22 September 2026 before this standalone candidate was built. This is a source review and a bounded implementation decision, not a claim that an older deployment was fully tested.

The user's direction is authoritative: **sota-beta delivered a better experience; sota-v2 was an unsuccessful remake.** The existing Matrix Loader Operator is valuable and should remain an independent runtime that School can use. Neither a newer repository name nor an older architecture document makes v2 the mandatory future home of School.

## Stage 2A inventory (verified 23 September 2026)

Remote main still resolves to the pinned beta and v2 revisions below. This is a bounded source, test, documentation and issue review. No beta/v2 browser session, account or learner record was opened. The live side-by-side journey remains 2B.

| Journey | Beta evidence | V2 evidence | New School candidate and loss |
| --- | --- | --- | --- |
| Mentor and goal | CharacterSelector, direct Speak, QuestCreator, built-in/custom characters | Mentor registry, goal/quest routes | Galileo and one authored lesson work. Custom mentors, free-form quests and the broad roster are absent. |
| Conversation and show me | ConversationView combines text, useGeminiLive, ambience, environment and artifact callbacks | Lesson runtime and artifact/Operator modules; default text gateway constructs EchoTextProvider | Optional real text provider and deterministic diagram work. General image/scene generation and ambience are absent. Browser diagram is a calculation, not Matrix observation. |
| Response and review | QuestQuiz, quiz results and progress | Authored lesson, assessment and progress modules | Prediction, experiment, explanation and reflection work; completion records participation, not mastery. |
| Save and resume | useUserData, local snapshot/Supabase, HistoryView | Session repositories, Operator checkpoints, local state patterns | Atomic local transcript/session and export work. No beta/v2 import, account sync or immutable School checkpoint. |
| Voice | Gemini Live microphone/transcript/playback in one hook | Voice interfaces; inspected default tutor is still echo | Optional local read-aloud works; this branch adds draft-only dictation. Beta's conversational voice remains absent. |
| Matrix | No independent Matrix boundary in beta conversation hook | Existing Operator lesson path | Optional versioned client requests reviewed actions and records receipts. Matrix owns Apply/runtime state. |

### Module decision and authority

| Module | 2A decision |
| --- | --- |
| Identity | Adapt later. School alone owns learner identity; no account migration in this slice. |
| Sessions/persistence | Keep the continuity experience; adapt v2 revision/receipt patterns. School owns lesson, turn, artifact and learner records. Preserve old records until import, conflict policy and rollback exist. |
| Mentor/teaching | Keep beta portraits, direct entry and goals; adapt typed staged lessons. School owns teaching policy. Retire provider-driven lesson state and do not treat v2 echo output as tutoring. |
| Assessment | Repair later. Retain quiz/review as an acceptance target; current completion is participation only. |
| Visuals | Adapt selectively. School owns factual artifact identity/provenance/history; Matrix owns executable scenes and observations. Generated artwork needs its own labeled adapter and factual review. |
| Voice | Retire live-session authority; adapt optional STT/TTS I/O. Disabled voice cannot block text turns. |
| Matrix connector | Keep v2 compatibility; adapt through the versioned connector. School stores opaque correlation and minimal evidence; Matrix retains scene/action authority. |

Existing issue ownership remains: beta #104/#106/#119/#252 cover STT, continuity, non-voice learning and text core; beta #108 flags factual visual quality. V2 #27-#29, #64 and #65-#69 cover artifact records, voice, beta experience planning and visual adapters. None is automatically closed or ported. Curriculum/profile issues remain future work.

**Provisional 2A choice:** continue the established School-of-the-Ancients/school-of-the-ancients app for the small #13 slice. This does not retire beta/v2. Rollback is to stop this separate service and return to untouched products/records. Broader ownership or migration awaits 2B user review.

## Inspected source

| Source | Pinned revision | What was inspected |
| --- | --- | --- |
| [sota-beta](https://github.com/School-of-the-Ancients/sota-beta/tree/5bf4ba01c794b398b3121081c06dd3b6bf6684f4) | `5bf4ba01c794b398b3121081c06dd3b6bf6684f4` | README, current tree, repository guidance, `execplan.md`, `package.json`, `types.ts`, `constants.ts`, and `components/ConversationView.tsx`. |
| [sota-v2](https://github.com/School-of-the-Ancients/sota-v2/tree/f21aaf2e04b2c28ddc6066df2773112b32fd2fac) | `f21aaf2e04b2c28ddc6066df2773112b32fd2fac` | Current tree/package, `docs/FRONTEND_BETA_EXPERIENCE_SPEC.md`, Operator session service, lesson service, mentor types, and server AI gateway. No root `AGENTS.md` was present at this revision. |
| [Matrix Loader Operator](https://github.com/School-of-the-Ancients/matrix-loading-operator) | Local reviewed baseline `c1572f75d487f27faa626dd72b2fa5ec5e53ef16` | Learning sessions/bridge, voice/planner boundary, capture and content documentation, and the existing native Codex provider implementation. New external-client work is validated separately. |

Beta's `AGENTS.md` points to an `execplan.md` containing only a living-document note. It also specifies component/hook ownership and requires preserving private transcripts and credentials. The new candidate has its own narrower repository guidance.

## Product behavior worth preserving

1. **An academy that invites exploration.** Historical mentor portraits, biographies, expertise, and a direct Speak action make the first step clear.
2. **Curiosity becomes a quest.** Goal/quest creation, a concrete objective, estimated duration, focus points, mentor pairing, and begin/continue actions give the learner a reason to enter a session.
3. **Conversation feels responsive.** Transcript, mentor voice, suggested prompts, microphone state, ambience, and text fallback belong to the same learning experience.
4. **“Show me” produces a visible explanation.** Beta actually contains environment-image and inline artifact generation, plus ambience changes. Matrix can extend this behavior into 3D/AR; a generated background must not be represented as an interactive simulation.
5. **Learning has continuity.** Saved mentor/quest associations, transcripts, environments, summaries, resume links, and actionable quiz feedback are product requirements rather than disposable demo details.

V2's own beta-experience specification identifies these strengths. Its proposed ownership and rewrite choices are historical planning input, not binding instructions for this project.

## Reuse decisions for this candidate

| Area | Decision | Reason and boundary |
| --- | --- | --- |
| Beta experience | Preserve its mentor/quest/conversation/history ideas in the acceptance criteria. | A useful experience should not be lost while reorganizing code. This candidate does not claim full beta feature parity. |
| Beta Google Live implementation | Do not make it a prerequisite. | The conversation component couples provider calls, environment generation, ambience and transcript state. Text-first School must run without a microphone, Gemini account, or Google Live session. |
| Beta assets and records | No migration or bulk copying. | Existing applications and learner records remain intact. Reusing portraits/audio later requires explicit provenance and appearance checks. |
| V2 lesson/persistence patterns | Reuse the ideas of versioned content, explicit stages, durable request receipts, optimistic revisions, atomic writes, and immutable content snapshots. | These are useful mechanisms independently of v2's product or future repository ownership. The new service does not import v2's app or database. |
| V2 default AI gateway | Do not claim it is a live tutor. | The inspected factory instantiates `EchoTextProvider` and a passthrough validator. A default gateway seam is not evidence of a working model conversation. |
| Existing Matrix-to-v2 lesson path | Preserve it as an implementation fact. | Its Observation and Scale integration already records responses and restores lesson checkpoints with scenes. This candidate does not replace that API or migrate its records. |
| Matrix executor | Keep independent, reached through a versioned client API. | Unity owns scene/content/runtime state. School owns its own lesson and conversation records. No shared database or Unity internals are needed for the standalone lesson. |
| Native Codex provider | Adapt the established Matrix process boundary into a separate mentor provider. | Existing local ChatGPT sign-in; isolated temporary workspace; tool-free structured output; explicit model configuration; bounded output and cancellation. No API-key substitute or automatic live call is added. |
| Browser scale experiment | Use a deterministic mathematical illustration for first acceptance. | It demonstrates the teaching loop without requiring Matrix or headset hardware. It is explicitly not Unity evidence, a room measurement, or a physics simulation. |

## Provisional code home and modules

This candidate lives in `School-of-the-Ancients/school-of-the-ancients` as a small standalone application. Creating that code home does not deprecate beta/v2, move their data, or commit the organization to another wholesale rewrite.

- `src/shared/contracts.ts`: versioned School session, turn, mentor, lesson and experiment types.
- `src/server/content.ts`: versioned authored lesson and historically inspired mentor metadata.
- `src/server/school-service.ts`: stages, questions/answers, observed browser experiments, asynchronous turn lifecycle and request receipts.
- `src/server/repository.ts`: local durable records and writer ownership.
- `src/server/providers.ts`: replaceable scripted-demo and native Codex mentor adapters.
- `src/server/http.ts`: bounded local HTTP transport and browser-origin boundary.
- `public/`: dependency-free first client; presentation does not own authoritative lesson state.
- `src/integrations/matrix-client.ts`: optional external-runtime client; no lesson-domain authority and no automatic Apply privilege.

Modules need clear contracts and tests, not a separate service or repository for every feature. Voice, avatar, visual artifacts, imported lesson packs, and Matrix presentation are optional capabilities. Missing optional modules must not prevent a complete text lesson.

## Decision gate before expanding or moving ownership

The roadmap's beta/v2 audit can record the evidence above. The subsequent product comparison/user-review gate remains open:

- Demonstrate the same mentor → question → visible explanation → response → save/resume journey in beta and this candidate. Identify what the user actually prefers and what is missing.
- Evaluate code reuse per module using functioning behavior, tests, maintenance cost, and data compatibility. Do not choose an entire app because its architecture document labels it canonical.
- Choose one owner for each record and capability. Explain how the other apps call it without sharing internal state.
- Prove the end-to-end vertical slice before making new migrations or platform-wide abstractions prerequisites.
- Define export/import and rollback before any later record migration. This implementation performs none.
- Preserve provider-neutral contracts, deterministic fixture tests, and truthful availability labels. A configured provider, successful fixture, completed live inference, browser walkthrough, and headset observation are separate evidence.

One prepared lesson and one historically inspired mentor are sufficient to judge the first experience. General curriculum generation, assessment mastery, voice, a rigged mentor, autonomous content acquisition, and the full World’s Fair remain separate roadmap work.
