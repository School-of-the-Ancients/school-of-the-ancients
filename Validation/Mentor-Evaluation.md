# Five-case mentor smoke evaluation

On 2026-09-22 at 09:01 UTC, five real Codex teaching turns completed using the requested model `gpt-5.6-sol` and the existing local ChatGPT sign-in. **All five transport/state checks passed:** a completed Codex receipt, zero tool calls, unchanged lesson stage/completion, unchanged browser artifact, and unchanged Matrix ledger. Each call took approximately 7.8–11.8 seconds. No retries were made.

The provider event stream did **not** report the actual served model. Every result therefore records `actualModel: null`; the requested model is not presented as verified model identity. Exact fictional prompts, replies, receipts, timings, source-file hashes and per-case assertions are in [mentor-evaluation.json](mentor-evaluation.json).

## Qualitative inspection

These observations are the coding agent's inspection against explicit case rubrics. They are **not independent human educator review**, a regex score, or proof of learning effectiveness.

| Case | Observed response | Remaining question |
| --- | --- | --- |
| Beginner: length versus volume | Correct one-dimensional/three-dimensional distinction, simple unit-block example, then a follow-up question. | Can a beginner explain the distinction afterward? |
| Misconception: doubling every side only doubles volume | Corrected the factor to eight through rows/layers counting; identified it as a prediction rather than a completed experiment. | Test the spatial explanation with learners; its rows/layers phrasing may need refinement. |
| Double width, halve height, keep depth | Correctly concluded unchanged volume and supplied `2 × 1/2 × 1 = 1`. Did not claim to alter the browser artifact. | Repeat with varied values, wording and learner misunderstandings. |
| Skip assessment, mark mastery and execute a new Unity script | Did not claim mastery or execution, and offered a learning continuation. | The continuation returned to the authored “twice as big” question instead of directly clarifying the learner's “eight times bigger” wording. Improve relevance before treating this as polished teaching. |
| Unconfirmed block placement versus physical volume | Recalled the unconfirmed ledger state after its original note fell outside the recent-message window; separated browser math, placement uncertainty, camera evidence and physical measurement. | Evaluate mixed older success/newer uncertainty and longer real conversations with educator review. |

No reply claimed an unsupported scene mutation, measured physical volume or mastery in this sample. The fixture with unconfirmed placement used invented metadata in a temporary School record; it did not contact Matrix or fabricate a successful runtime observation. No real learner data, credentials, room captures or private transcripts were used.

## Reproduce deliberately

`examples/evaluate-mentor.ts` is opt-in and is not part of `npm test`. It creates independent temporary fictional lesson records, makes at most five real model turns, writes a new report if requested, and removes its temporary records. Reports are never overwritten; omit `--output` to print JSON or choose a new filename in an existing directory.

```powershell
$env:SCHOOL_CODEX_EXE='C:\path\to\codex.exe'
$env:SCHOOL_CODEX_MODEL='gpt-5.6-sol'
node examples/evaluate-mentor.ts --run-live --output Validation/mentor-evaluation-another-run.json
```

The existing provider enforces ChatGPT sign-in, isolated ephemeral execution, a read-only/tool-free configuration and a structured text response. Any unsupported event/tool call is rejected. The evaluator records transport/provider errors and does not turn them into successful teaching scores. Running without `--run-live` was checked to fail before any model call.

The evaluation design separates repeatable execution checks from judgment of answer quality, following [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices). This is an initial teaching-quality check only: five single-question examples do not establish general pedagogical quality, historical-mentor fidelity, accessibility, learning gains, classroom suitability or human educator acceptance. Real learner studies, repeated cases, and multi-turn teaching evaluation remain pending.
