# School implementation boundaries

- School owns learning sessions, teaching policy, mentor conversation, learner records, and assessment. Matrix owns its scene/content/runtime state. Connect through a versioned API, not shared databases or Unity internals.
- Preserve useful beta ideas while improving implementation. Do not migrate, delete, or rewrite beta/v2 records as a side effect of development here.
- The text/lesson core must work with voice disabled and Matrix absent. Model, STT, TTS, artifact, and Matrix adapters remain replaceable. Demo responses must be visibly labeled and never claimed as live model output.
- Server-side provider credentials and learner records are private. Keep local data, tokens, transcripts, raw room captures, and generated test artifacts out of Git.
- Scene outcomes must come from actual Matrix receipts/state. The browser scale activity is a mathematical illustration, not a Unity or physical-room observation.
- Use Node 24 native TypeScript modules for the backend and browser ES modules for the initial client. Keep module interfaces typed; avoid unnecessary dependencies or framework rewrites during the first slice.
- Run meaningful unit/integration tests and type checking. Preserve cancellation, idempotency, optimistic revisions, explicit error states, and durable resume.
- Report fixture, live provider, browser, hosted deployment, and headset evidence separately. Do not close parent roadmap issues while required acceptance remains.
