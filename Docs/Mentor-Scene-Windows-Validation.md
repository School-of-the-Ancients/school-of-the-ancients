# Live mentor-to-scene Windows validation

The opt-in runner exercises Galileo's saved scene suggestion, School's explicit send, Matrix's existing Codex planner, Operator Apply, actual command acknowledgments from the isolated Windows Unity player, and Galileo's follow-up explanation. It uses new loopback ports and a temporary profile control file. The owned player, School service, Matrix service, and control file are cleaned up after the run.

Run the pure proposal guard without a provider or Unity player:

```powershell
python -B examples/verify-mentor-scene-windows.py --self-test
```

To repeat the live run, use an explicitly isolated validation player and a Matrix checkout with client AI planning:

```powershell
python -B examples/verify-mentor-scene-windows.py --run-live `
  --matrix-checkout 'C:\path\to\matrix-loading-operator' `
  --player 'C:\path\to\isolated-validation\MatrixOperator.exe' `
  --codex-exe 'C:\path\to\native\codex.exe'
```

The runner requires the validation player's product identity, checks that no profile control file already exists, and never targets the open Quest app or normal project player. It copies both product sources before launch and hashes those copies. It invokes three actual Codex turns: Galileo's suggestion, Matrix planning, and Galileo's reflection. The complete Matrix proposal must contain exactly two separated small built-in block spawns with the same height/depth and a two-to-one width comparison. Any different proposal ends the run before Apply. Apply here is an authenticated, automated owner action made only after that narrow inspection; it is not a human Operator UI review.

The runner writes a detailed `report.json` and private traces under ignored `work/`. The checked-in [sanitized result](../Validation/mentor-scene-windows.json) records the September 22 run: 24 checks passed, two real Unity command acknowledgments succeeded, both transforms matched the reviewed proposal, the mentor used that historical result without claiming physical measurement or mastery, and all owned resources were cleaned up. The player was Unity 6000.6.0f1 StandaloneWindows64 with the recorded binary hashes. This establishes the desktop handoff only. Quest room alignment, passthrough rendering, human review, and learning outcomes still require their own acceptance.
