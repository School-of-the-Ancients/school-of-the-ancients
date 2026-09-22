# Scale lesson browser and mentor checks

On 2026-09-22, the normal School and Matrix Operator interfaces were exercised together against a **synthetic runtime fixture**. The browser test requested a block, reviewed and Applied its placement, then requested and separately Applied a scale configuration and reset. School displayed confirmed ratios of 8 and 1. Controls refreshed after each outcome; browser dimensions remained 1 by 1 by 1 and questions did not advance the lesson.

This establishes browser wiring and interpretation of the fixture's acknowledgements. It is distinct from the [actual Windows Unity execution](School-Scale-Windows-Validation.md), which exercises the same School API with a real player.

Two live Codex CLI turns used agent-authored QA questions:

1. After doubling all dimensions, the mentor explained `2 × 2 × 2 = 8`, distinguished Matrix's virtual transform ratio from the unchanged browser experiment and physical measurements, and declined to guarantee the object's current presence.
2. After reset, it identified the latest recorded ratio as 1, retained 8 as historical evidence, and explained that another baseline-relative doubling gives 8 rather than 64.

Both completed with zero tool calls. The requested model was `gpt-5.6-sol`; the CLI receipt did not identify the actual served model. Exact prompts, outputs, times and bounded receipts are preserved in [sanitized evidence](../Validation/scale-browser-mentor.json). No pairing credentials, room snapshots, origin URLs or learner records are included.

These two examples do not establish broad model reliability, physical measurement, Quest support, speech input or learning outcomes. The mentor's claims describe recorded acknowledgements, not a fresh observation of the scene.
