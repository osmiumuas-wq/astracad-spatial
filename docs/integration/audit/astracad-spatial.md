# Audit: AstraCAD Spatial

## 1. Identity
- **Repository URL**: https://github.com/osmiumuas-wq/astracad-spatial
- **Commit Audited**: ea8e924d431acb5d625706cb570581d4d5be7fd5 (Mon Nov 16 08:09:01 2026 +0530)
- **Licence**: None asserted in repository (All rights reserved). Quality bar dictates strict adherence: copyleft (GPL/AGPL) candidate code can only be studied, not adapted, unless relicensed.
- **Activity**: Active primary project; recent commits establishing multi-agent audit and integration frameworks.
- **Maturity**: Production-grade verification pipeline. 242 tests passing, 2 skipped across 46 test files (itest); typecheck clean (	sc --noEmit); production client build passes (ite build).

## 2. Stack
- **Languages**: TypeScript 5.5.0, HTML5, GLSL.
- **Frameworks & Runtimes**: IWSDK @iwsdk/core 1.1.0-rc.2 (WebXR ECS architecture), Three.js (super-three 0.185.0), @pmndrs/uikit 1.0.74, @pmndrs/uikit-horizon 1.0.74.
- **Build System**: Vite 7.1.4 with @iwsdk/vite-plugin-dev.
- **Test System**: Vitest 5.1.0 running Node-based and headless worker tests.
- **Target Runtime**: Meta Quest 3 Browser / WebXR-compliant immersive browsers, with desktop/emulator fallback via IWER (@iwsdk/reference).

## 3. Geometry
- **Kernel**: Manifold 3.5.4 (manifold-3d WASM) executed off-thread in Web Workers (src/engine/engine.worker.ts:1, src/engine/kernel.ts:35).
- **Precision**: High-precision floating-point evaluated against closed-form analytical formulas via the Truth Gate (src/engine/truth.ts:52, src/engine/expect.ts:40). Relative volume tolerances verified to ~1e-9.
- **Modeling Paradigm**: Part Language v2 declarative procedural feature tree (src/engine/design.ts:112), rolling-ball edge fillets and chamfers (src/engine/round.ts:15, src/engine/minkowski.ts:25), 2D constraint solving via FreeCAD planeGCS WASM (src/engine/sketch2d.ts:422), sheet metal bending/unfolding (src/engine/sheetmetal.ts:45), mould parting line analysis (src/engine/mould.ts:23), and structural voxel FEA/modal/topology optimization (src/engine/fea.ts:120, src/engine/modal.ts:35, src/engine/topo.ts:77).
- **File Formats**:
  - In: STEP (via occt-import-js 0.0.23 WASM in src/engine/step-import.ts:37), 2D DXF/JSON profiles.
  - Out: STEP BRep synthesis (src/engine/step-export.ts:142, src/engine/step-brep.ts:415), 3MF (src/engine/threemf.ts:90), STL & OBJ (src/engine/exporters.ts:25), G-code toolpaths (src/engine/gcode.ts:45).

## 4. XR and Input
- **API**: WebXR Device API orchestrated by IWSDK Entity-Component-System (ECS).
- **Hand Tracking**: Raw WebXR joint data smoothed with 1€ (OneEuro) 3D filter (src/app/hands.ts:48, src/app/hands.ts:95). Tracks wrist, tips, palm position, palm normal, forward/across vectors, and pinch midpoint.
- **Input Paradigms**:
  - Direct manipulation amber handles (src/systems/interaction-system.ts:410-496) with 1 mm step snapping.
  - Rotary dial ring with 0.05 mm increments (src/systems/interaction-system.ts:227).
  - Quest microgestures: thumb swipes/taps on curled index finger mapped via gamepad API (src/systems/interaction-system.ts:368).
  - Real-world measurement calipers: single-hand thumb-index span (src/systems/interaction-system.ts:658-684) and two-handed pinch tape (src/systems/interaction-system.ts:689-701).
  - Knife-hand plane slicer (src/systems/interaction-system.ts:864-907).
  - Palm contact push load for FEA (src/systems/interaction-system.ts:771-845).
- **Gaze, Controllers & Remote**: Pointer rays via Raycaster and RayInteractable (src/systems/interaction-system.ts:150, src/systems/laser-system.ts:32), spatial UI poke buttons (src/systems/ui-system.ts:17).
- **Scene & Passthrough**: Room passthrough enabled by default in immersive mode; spatial anchors and depth scanning integrated via src/systems/scan-system.ts:20 and src/systems/capture-system.ts:68.

## 5. Architecture
- **Module Boundaries**:
  - src/engine/: Pure geometry, mathematical models, analytical truth gate, solvers, and export formats. Communicates with UI/ECS via typed asynchronous jobs (src/engine/jobs.ts:1, src/engine/protocol.ts:1).
  - src/systems/: IWSDK ECS systems governing state, XR input, UI rendering, spatial scene graph, and collaboration.
  - src/app/: Application state store, session lifecycle, and low-level WebXR hand input filters.
- **Threading**: Heavy geometric operations (Manifold CSG, FEA, modal analysis, topology optimization, STEP parsing, Whisper STT) executed in background Web Workers (engine.worker.ts, whisper.worker.ts, intent.worker.ts).
- **Data Flow**: Reactive property graph and signals driving procedural part reconstruction; every part must pass the truth gate before acceptance.

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| Manifold CSG evaluation | src/engine/kernel.ts:35 | ran |
| Closed-form Truth Gate verification | src/engine/truth.ts:52 | ran |
| Analytical volume & property formulas | src/engine/expect.ts:40 | ran |
| Procedural Part Language v2 compiler | src/engine/design.ts:112 | ran |
| Rolling-ball edge filleting & chamfers | src/engine/round.ts:15, src/engine/minkowski.ts:25 | ran |
| 2D constraint sketcher (planeGCS) | src/engine/sketch2d.ts:422, src/systems/sketch-bench-system.ts:25 | ran |
| Voxel linear elastic FEA solver | src/engine/fea.ts:120 | ran |
| Structural natural frequencies (modal) | src/engine/modal.ts:35 | ran |
| Topology optimization (living bone) | src/engine/topo.ts:77 | ran |
| Sheet metal bend & unfold calculation | src/engine/sheetmetal.ts:45 | ran |
| Mould draft & parting line analysis | src/engine/mould.ts:23 | ran |
| Assembly kinematic joints & solver | src/engine/assembly.ts:263, src/systems/assembly-system.ts:47 | ran |
| Technical 2D drawing & hidden-line removal | src/engine/drawing.ts:15, src/systems/drawing-system.ts:28 | ran |
| STEP import (OCCT WASM) | src/engine/step-import.ts:37 | ran |
| BRep STEP export (cylinder & plane synthesis) | src/engine/step-export.ts:142, src/engine/step-brep.ts:415 | ran |
| 3MF volumetric export | src/engine/threemf.ts:90 | ran |
| Slicing & 3D printer G-code generator | src/engine/gcode.ts:45, src/systems/gcode-system.ts:18 | ran |
| 1€-filtered spatial hand tracking | src/app/hands.ts:48, src/app/hands.ts:95 | ran |
| Spatial dimension handle manipulation | src/systems/interaction-system.ts:410-496 | ran |
| Quest hand microgestures | src/systems/interaction-system.ts:368 | ran |
| Caliper span & tape real-world measurement | src/systems/interaction-system.ts:658-701 | ran |
| Dynamic knife-hand slicing plane | src/systems/interaction-system.ts:864-907 | ran |
| Peer-to-peer WebRTC co-design | src/systems/codesign-system.ts:39 | ran |
| Spatial object scanning & capture | src/systems/scan-system.ts:20, src/systems/capture-system.ts:68 | ran |

## 7. Risks
- **Licence**: Currently proprietary / all rights reserved. Candidate integrations must strictly respect copyright; no copyleft code (GPL/AGPL) can be imported into the repository codebase.
- **Security**: Local WebRTC peer signalling (peerjs) and speech recognition model execution require sandboxing.
- **Performance**: Large monolithic bundle chunks (index-*.js ~2.9 MB, ort-wasm-simd-threaded.jsep.wasm ~21.6 MB) could slow initial loading on standalone mobile headsets (Quest Browser).
- **Maintenance**: Dependencies on prerelease IWSDK (1.1.0-rc.2) and custom three.js fork (super-three 0.185.0).

## 8. What AstraCAD Can Learn
- **Candidate Architectures**: Other projects demonstrate specialised methods for OpenXR compositor layer integration (crisp UI text), BRep face/edge topology picking, and depth-mesh spatial anchoring that AstraCAD can adapt cleanly through typed adapter boundaries.
