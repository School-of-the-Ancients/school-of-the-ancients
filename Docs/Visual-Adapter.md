# Replaceable lesson visual

The first School artifact is a saved, typed scale observation: dimensions, calculated volume, source and time. Its presentation is handled by a separate browser visual adapter. The lesson service and mentor provider read the same saved artifact regardless of which view the learner chooses.

The workbench offers **Diagram**, **Data table**, and **Hide visual**. The table exposes the same simulated dimensions and calculated volume in text. Hiding the visual leaves the numeric metrics, sliders, recorded state and lesson conversation available. Changing formats makes no API request and does not change the recorded artifact. Reloading defaults to the diagram; the saved dimensions and experiment history still resume exactly.

The adapter accepts a diagram renderer at composition time. Another vetted renderer can replace it without changing School's lesson transitions or Matrix connector. This does not yet implement generated factual diagrams or image creation. Future generated images need separate provenance, loading/error/history records and factual review. A browser calculation must never be labeled as a physical measurement or observed Matrix scene.
