---
trigger: model_decision
description: Read before any work that studies, compares or brings in another repository (LeapShape, MobileCAD XR, TinkerXR, XR Blocks, onlineCAD or any other) - the integration mission, its phases, approval gates and deliverable formats.
---

# Integrating other projects into AstraCAD Spatial

The full mission, the verified candidate list and the deliverable formats are in
`docs/integration/MISSION.md`. Read it completely before you start; it is the task.

Hard rules for this work (on top of `astracad-quality-bar.md`):

1. **Phase 1 is read-only.** Clone candidates outside this repository (into `../integration-candidates/`). Do
   not change source code here, do not install or upgrade dependencies here, do not run a candidate's install
   scripts or binaries. Reading, searching, `git log` and building a candidate in its own folder to measure it are
   fine. The only files you write in Phase 1 are the deliverables under `docs/integration/`, on the branch
   `integration/phase-1-audit`.
2. **Stop at every gate.** After Phase 1, Phase 2 and Phase 3, stop and wait for the user's written approval. Do
   not start the next phase on your own judgement, a partial approval or an approval for a different phase.
3. **AstraCAD Spatial stays the product.** Nothing is merged wholesale. A component comes in only when the audit
   shows it does something AstraCAD cannot do yet, measurably better, under a licence that allows it, through an
   adapter, with tests. Everything else is "study only".
4. **One geometry truth.** Manifold and Part Language v2 stay the source of geometry. A second kernel (for
   example OpenCASCADE in a candidate) may only be an import/export or cross-check adapter that never replaces a
   Manifold result without the truth gate agreeing.
5. **Measure, do not estimate, where you can.** Feature presence is checked in code (file and line), not in a
   README. Performance claims come from runs you made, with the command and machine noted.
