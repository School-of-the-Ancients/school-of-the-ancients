# Try the lesson's scale experiment in Matrix

School can now propose scale changes to the block it placed through Matrix. Matrix still owns the scene and execution; School keeps the learning conversation and a record of the confirmed result.

This version uses Matrix's **desktop white room** and the built-in Terracotta block. Quest AR placement remains a separate capability; these scale controls do not support AR yet. Both products continue to work independently.

## Walkthrough

1. Start a Galileo lesson and follow the [Matrix connection guide](Matrix-Bridge.md). Use a Matrix service with `experiment.block-scale.v1`, implemented in [Matrix PR #36](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/36). An older client API alone is insufficient.
2. Request a block from School, review its proposal in the Operator, and Apply it there. Wait for **Runtime confirmed**. The scale experiment uses that exact block; it cannot select another object or an arbitrary imported asset.
3. Choose a preset under **Try scale in Matrix**. **Double every side in Matrix** proposes factors `(2, 2, 2)`. **Double width in Matrix** proposes `(2, 1, 1)`. **Double width, halve height** proposes `(2, 0.5, 1)`. The preset saves a request; it does not immediately change the scene.
4. Open **Review in Matrix**, inspect the command, and Apply. Return to School and wait for the result or choose **Check experiment**. Only a verified acknowledgement and matching observed transform produce a confirmed ratio.
5. Choose **Reset Matrix block** when finished. This creates another proposal that needs its own Operator Apply. It restores the captured original transform after the current block is checked against the latest confirmed result.

The first configuration captures the original baseline. Later presets refer to that baseline, so choosing “Double every side” twice does not accidentally make the object four times as wide. If you edit, move, delete, undo, or reload the object in Matrix, refresh readiness and reconcile any pending proposal before continuing.

## Understand the two experiments

| Browser workbench | Matrix experiment |
| --- | --- |
| Changes the standalone browser illustration. | Proposes a change to the lesson's confirmed Matrix block. |
| **Apply experiment** records browser dimensions. | The Matrix Operator reviews and Applies the scene command. |
| Volume is calculated in simulated browser units. | Ratio is calculated from the acknowledged scale relative to the original baseline. |
| Works with no Matrix connection. | Requires a current pairing, compatible service and eligible virtual block. |

For Matrix factors `(2, 2, 2)`, the mathematical volume ratio is `8`; `(2, 1, 1)` gives `2`; `(2, 0.5, 1)` gives `1`. These are geometric transform ratios, not physical volume measurements or validated physics. A recorded result describes the acknowledging runtime snapshot and does not prove the object is still present now.

School stores the outcome separately from the browser dimensions. Neither requesting a change nor receiving its result advances the lesson, assesses mastery, or changes the browser illustration. The mentor receives a bounded historical summary so it can discuss what was confirmed without receiving the full room or pairing credential.

## When a request is uncertain

Use **Check experiment** to query the original request. A successful generic command receipt with missing or mismatched experiment evidence stays unconfirmed in School. No preset or reset is automatically replayed. **Cancel experiment proposal** is available before Apply; it is not a rollback for dispatched work.

Restarting School preserves the lesson's experiment history but loses its Matrix credentials. A new pairing cannot adopt an earlier request. If the original request can no longer be reconciled, inspect the Operator before proceeding. Start a new lesson for a new experiment after resolving the scene manually; the old record remains an honest account of uncertainty.

Historical records may still be read after disconnection. Their **Check experiment** actions refer to the original pairing, and their review links refer to the original Operator. They never silently move to a replacement runtime.

See [actual Windows integration evidence](School-Scale-Windows-Validation.md) for tested code/build identities and the remaining device limits.

The [browser and live mentor checks](Scale-Browser-Validation.md) separately record the UI walkthrough and how the mentor interpreted a scale result and reset.
