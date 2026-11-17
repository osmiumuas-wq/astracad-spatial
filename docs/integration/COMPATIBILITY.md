# AstraCAD Spatial: Compatibility & Cross-Repository Analysis

This document synthesises the findings from the Phase 1 audits of AstraCAD Spatial and the candidate repositories:
- **AstraCAD Spatial** (Baseline; commit `ea8e924`)
- **LeapShape** (`zalo/LeapShape`; Apache-2.0; commit `aa49985`)
- **MobileCAD XR** (`LucasCoraca/mobilecad-xr`; GPL-3.0; commit `d6986bf`)
- **TinkerXR** (`Boysle/TinkerXR`; MIT; commit `c7cc93e`)
- **XR Blocks** (`google/xrblocks`; Apache-2.0; commit `300f935`)
- **Chili3D** (`xiangechen/chili3d`; AGPL-3.0; commit `4600206`)
- **LeapMotionWebXR** (`procw/LeapMotionWebXR`; Apache-2.0; commit `4aee0c4` [fork of LeapShape])

---

## 1. Capability Matrix

| Capability | AstraCAD Spatial | LeapShape | MobileCAD XR | TinkerXR | XR Blocks | Chili3D | LeapMotionWebXR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Spatial Hand Interaction** | | | | | | | |
| 1€-filtered hand joint smoothing | `has` (`src/app/hands.ts:48`) | `partial` (`src/Frontend/Input/LeapFrameInterpolator.js:15`) | `has` (`core/hands.cpp:25`) | `partial` (`Assets/Scripts/HandRotationDetector.cs:25`) | `partial` (`src/input/Hands.ts:25`) | `no` | `partial` (`src/Frontend/Input/LeapFrameInterpolator.js:15`) |
| Hysteresis pinch filtering (dual threshold) | `partial` (`src/app/hands.ts:114`) | `no` (raw distance) | `has` (`core/hands.h:28`) | `no` | `has` (`src/input/PinchFilter.ts:9`) | `no` | `no` |
| Shoulder-origin ray projection | `no` (wrist/palm ray) | `no` | `has` (`core/hands.cpp:10`) | `no` | `no` | `no` | `no` |
| Direct fingertip window/surface poke | `has` (`src/systems/ui-system.ts:17`) | `no` | `has` (`core/interaction.cpp:55`) | `no` | `has` (`src/interaction/DirectTouch.ts:32`) | `no` | `no` |
| Two-handed model scale & rotate | `has` (`src/systems/interaction-system.ts:689`) | `no` | `has` (`core/interaction.cpp:495`) | `has` (`Assets/Scripts/Selection.cs:243`) | `has` (`src/interaction/Interaction.ts:100`) | `no` | `no` |
| Hand gesture classification (fist, point, palm) | `partial` (`src/systems/interaction-system.ts:790`) | `no` | `has` (`core/hands.cpp:25`) | `no` | `has` (`src/input/gestures/GestureRecognition.ts:20`) | `no` | `no` |
| Quest microgestures (thumb on curled index) | `has` (`src/systems/interaction-system.ts:368`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Synthetic hand pose emulation for automated CI | `no` (controller mocks) | `no` | `has` (`core/hands.cpp:81`) | `no` | `has` (`src/simulator/Simulator.ts:47`) | `no` | `no` |
| Virtual build plate tabletop & rim handles | `partial` (turntable rim) | `no` | `has` (`core/interaction.cpp:66-87`) | `no` | `no` | `no` | `no` |
| Direct 3D transform manipulators & handles | `has` (`src/systems/interaction-system.ts:410`) | `has` (`src/Frontend/Tools/General/LSTransformControls.js:35`) | `has` (`core/interaction.h:57`) | `has` (`Assets/Scripts/CornerScaler.cs:33`) | `partial` (`src/interaction/manipulation/`) | `has` (`packages/app/src/commands/create/box.ts`) | `has` (`src/Frontend/Tools/General/LSTransformControls.js:35`) |
| **Real-World Measurement and Capture** | | | | | | | |
| Tactile physical desk/tabletop calibration | `no` | `no` | `no` | `has` (`Assets/Scripts/CalibrateWorldCoordinates.cs:46`) | `no` | `no` | `no` |
| Real object measurement via hand caliper | `has` (`src/systems/interaction-system.ts:658`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Two-handed tape measurement | `has` (`src/systems/interaction-system.ts:689`) | `no` | `no` | `has` (`Assets/Scripts/RulerManager.cs:33`) | `no` | `no` | `no` |
| WebXR Depth Sensing API depth meshing | `partial` (point scan `src/systems/scan-system.ts:20`) | `no` | `no` | `no` | `has` (`src/depth/DepthMesh.ts:22`) | `no` | `no` |
| True-size 1:1 mm scale toggle | `no` (relative scale) | `no` | `has` (`core/interaction.cpp:103`) | `no` | `no` | `no` | `no` |
| Walk mode / teleport navigation arc | `no` | `partial` (`src/Frontend/Input/LeapPinchLocomotion.js:22`) | `has` (`core/interaction.cpp:139-188`) | `no` | `no` | `no` | `partial` (`src/Frontend/Input/LeapPinchLocomotion.js:22`) |
| **Parametric Geometry** | | | | | | | |
| Solid CSG evaluation kernel | `has` (`src/engine/kernel.ts:35` Manifold) | `has` (`src/Backend/mainWorker.js:32` OCCT) | `has` (OCCT via MobileCAD) | `partial` (`Assets/Scripts/LibCSG-Runtime/CSGBrushOperation.cs:45` Mesh) | `no` | `has` (`packages/wasm/src/` OCCT) | `has` (`src/Backend/mainWorker.js:32` OCCT) |
| Closed-form analytical Truth Gate verification | `has` (`src/engine/truth.ts:52`, `src/engine/expect.ts:40`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Declarative procedural part compiler | `has` (`src/engine/design.ts:112` PLv2) | `no` | `has` (FreeCAD tree) | `no` | `no` | `has` (`packages/parametric/src/`) | `no` |
| Topological entity naming & persistent IDs | `no` (index heuristics) | `no` | `has` (FreeCAD TNP) | `no` | `no` | `has` (`parametric/test/booleanBornEdgeId.kernel.test.ts:1`) | `no` |
| Rolling-ball edge fillets & chamfers | `has` (`src/engine/round.ts:15`, `src/engine/minkowski.ts:25`) | `has` (`src/Frontend/Tools/FilletTool.js:23`) | `has` (OCCT) | `no` | `no` | `has` (`packages/app/src/commands/modify/fillet.ts:1`) | `has` (`src/Frontend/Tools/FilletTool.js:23`) |
| 2D sketch constraint solver | `has` (`src/engine/sketch2d.ts:422` planeGCS) | `no` | `has` (FreeCAD Sketcher) | `no` | `no` | `partial` (snap constraints `packages/core/src/snap/`) | `no` |
| BRep thick-solid / offset hollowing | `has` (`src/engine/advanced.ts:760`) | `has` (`src/Frontend/Tools/OffsetTool.js:26`) | `has` (OCCT) | `no` | `no` | `has` (OCCT) | `has` (`src/Frontend/Tools/OffsetTool.js:26`) |
| **Assemblies and Constraints** | | | | | | | |
| Kinematic assembly joint solver | `has` (`src/engine/assembly.ts:263`, `src/systems/assembly-system.ts:47`) | `no` | `has` (FreeCAD Assembly) | `no` | `no` | `no` | `no` |
| Direct joint manipulation in XR | `has` (`src/systems/assembly-system.ts:47`) | `no` | `partial` | `no` | `no` | `no` | `no` |
| **Drawings and Manufacturing** | | | | | | | |
| Technical 2D drawing & hidden line removal | `has` (`src/engine/drawing.ts:15`, `src/systems/drawing-system.ts:28`) | `no` | `has` (FreeCAD TechDraw) | `no` | `no` | `no` | `no` |
| STEP export | `has` (`src/engine/step-export.ts:142`) | `has` (`src/Frontend/World/FileIO.js:177`) | `has` (OCCT) | `no` | `no` | `has` (`packages/core/src/step/`) | `has` (`src/Frontend/World/FileIO.js:177`) |
| STEP import | `has` (`src/engine/step-import.ts:37`) | `has` (`src/Frontend/World/FileIO.js:246`) | `has` (OCCT) | `no` | `no` | `has` (`packages/core/src/step/`) | `has` (`src/Frontend/World/FileIO.js:246`) |
| 3MF volumetric export | `has` (`src/engine/threemf.ts:90`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Slicing and G-code generation | `has` (`src/engine/gcode.ts:45`) | `no` | `no` | `no` | `no` | `no` | `no` |
| In-situ 3D printer network status & control | `no` | `no` | `no` | `has` (`Assets/Scripts/Artun/PrinterController.cs:65`) | `no` | `no` | `no` |
| Sheet metal bend & unfold calculation | `has` (`src/engine/sheetmetal.ts:45`) | `no` | `partial` | `no` | `no` | `no` | `no` |
| Mould draft & parting line analysis | `has` (`src/engine/mould.ts:23`) | `no` | `no` | `no` | `no` | `no` | `no` |
| **Simulation and Optimisation** | | | | | | | |
| Structural linear elastic FEA | `has` (`src/engine/fea.ts:120`) | `no` | `has` (FreeCAD FEM) | `no` | `no` | `no` | `no` |
| Modal natural frequency solver | `has` (`src/engine/modal.ts:35`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Topology optimization (living bone) | `has` (`src/engine/topo.ts:77`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Dynamic palm push load application | `has` (`src/systems/interaction-system.ts:771`) | `no` | `no` | `no` | `no` | `no` | `no` |
| **Collaboration** | | | | | | | |
| Peer-to-peer WebRTC co-design | `has` (`src/systems/codesign-system.ts:39`) | `no` | `no` | `no` | `partial` (`src/addons/remote-control/`) | `no` | `no` |
| Multimodal AI spatial assistant | `partial` (`src/engine/intents.ts:1`, `whisper.worker.ts`) | `no` | `no` | `no` | `has` (`src/ai/Gemini.ts:25`, `src/agent/Agent.ts:26`) | `partial` (`packages/ai/`) | `no` |
| **Accessibility** | | | | | | | |
| Voice command parsing & execution | `has` (`src/engine/commands.ts:140`) | `no` | `no` | `no` | `no` | `no` | `no` |
| One-handed measurement workflows | `has` (`src/systems/interaction-system.ts:708`) | `no` | `no` | `no` | `no` | `no` | `no` |
| Compositor quad layers for razor-sharp text | `no` (scene canvas) | `no` | `has` (`core/interaction.cpp:316`) | `no` | `partial` (`src/layers/`) | `no` | `no` |

---

## 2. Gaps Analysis

Capabilities where AstraCAD Spatial is absent or inferior compared to candidates, verified with code citations:

### Gap 1: Shoulder-Origin Ray Projection vs Wrist-Aim Ray
- **AstraCAD Current State**: `src/systems/interaction-system.ts:150` casts rays from raw controller/hand wrist poses (`hand.palm`, `hand.wrist`). During fine pinching, the wrist involuntarily rotates, inducing high angular jitter at the ray tip (lever-arm amplification).
- **Candidate Implementation**: `mobilecad-xr` (`core/hands.cpp:10-56`, `shoulderPoint`).
- **Code Comparison**:
  In `mobilecad-xr/core/hands.cpp:10-14`:
  ```cpp
  V3 shoulderPoint(const Pose& head, bool left) {
      V3 r = right(head.rot), up = {0, 1, 0};
      return head.pos + r * (left ? -0.18f : 0.18f) - up * 0.16f - forward(head.rot) * 0.08f;
  }
  ```
  The pointing ray originates at `shoulderPoint` and passes through the hand knuckle (`core/hands.cpp:56`). As a result, finger flexion and wrist tilt do not alter the ray direction; only arm motion moves the pointer. This eliminates cursor oscillation when pinching buttons or handles.

### Gap 2: Pinch Hysteresis State Machine
- **AstraCAD Current State**: `src/app/hands.ts:113-116` uses a single threshold distance (`this.gap < 0.025`) to trigger `pinching`. When a user holds their fingers near the boundary, tracking noise causes rapid on/off toggling (contact chattering), triggering accidental drag releases.
- **Candidate Implementation**: `xrblocks` (`src/input/PinchFilter.ts:9-35`).
- **Code Comparison**:
  `xrblocks` implements a dual-threshold Schmitt trigger with configurable hysteresis:
  ```typescript
  // xrblocks/src/input/PinchFilter.ts:25-35
  if (!this.pinching && distance < this.options.pinchThreshold) {
      this.pinching = true;
      return true;
  }
  if (this.pinching && distance > this.options.unpinchThreshold) {
      this.pinching = false;
      return false;
  }
  ```
  Separating the engagement threshold (e.g. 25 mm) from the disengagement threshold (e.g. 35 mm) completely prevents boundary flutter during spatial dragging.

### Gap 3: Real-Time Environment Collision via WebXR Depth Sensing
- **AstraCAD Current State**: `src/systems/scan-system.ts:20` samples discrete feature points, lacking dense physical mesh reconstruction.
- **Candidate Implementation**: `xrblocks` (`src/depth/DepthMesh.ts:22-110`, `GPUDepthConverter.ts:25-80`).
- **Evidence**: `xrblocks` takes the raw WebXR Depth Sensing API texture buffer (`XRDepthInformation`), maps depth values to a GPU vertex displacement grid, and constructs a live `DepthMesh` that integrates with `three-mesh-bvh` (`DepthMeshRaycast.ts:15`) for spatial occlusion and real-world surface collision.

### Gap 4: Tactile Physical Workspace & Tabletop Calibration
- **AstraCAD Current State**: AstraCAD spawns its workbench at an arbitrary default distance relative to headset start pose (`src/systems/workspace-system.ts:92`). Users must manually drag the entire bench to align with real tables.
- **Candidate Implementation**: `TinkerXR` (`Assets/Scripts/CalibrateWorldCoordinates.cs:46-120`).
- **Evidence**: `TinkerXR` allows the user to touch two corners of their physical desk with the controller or fingertip. The transformation matrix computes exact physical desk height, rotation, and boundary extents, pinning the virtual CAD workspace solidly onto physical furniture.

### Gap 5: Persistent Topological Entity Naming Across Feature Edits
- **AstraCAD Current State**: AstraCAD compiles declarative Part Language v2 ASTs from scratch on edit (`src/engine/design.ts:112`). Feature modifications rely on geometric bounding-box heuristics to re-associate downstream fillets or holes.
- **Candidate Implementation**: `chili3d` (`packages/parametric/`).
- **Evidence**: `chili3d` records born-edge identities, ancestor face lineages, and split histories across Boolean operations (`parametric/test/booleanBornEdgeId.kernel.test.ts:1-75`), ensuring downstream features do not fail when upstream dimensions change.

### Gap 6: True-Size 1:1 Scale Toggle & Large-Model Teleportation
- **AstraCAD Current State**: Models are displayed at interactive workbench scale; no dedicated 1:1 real-world physical verification mode.
- **Candidate Implementation**: `mobilecad-xr` (`core/interaction.cpp:103`, `core/interaction.cpp:139`).
- **Evidence**: `setTrueScale(true)` locks unit representation to exact physical scale (1 mm = 1 mm in room coordinates) and grounds the base to the room floor. In conjunction with `teleportArc()` (`core/interaction.cpp:154`), users can walk or teleport inside full-scale architectural or vehicle assemblies.

---

## 3. Reuse Classification

| Candidate Component | Classification | Rationale |
| --- | --- | --- |
| `xrblocks/src/input/PinchFilter.ts` | **reuse (adapt with notice)** | Permissive Apache-2.0 licence. Drop-in algorithm for dual-threshold hysteresis. Adapting this into `src/app/hands.ts` immediately eliminates pinch chattering. |
| `xrblocks/src/depth/DepthMesh.ts` | **reuse (adapt with notice)** | Permissive Apache-2.0 licence. Provides WebXR Depth Sensing texture conversion into Three.js BufferGeometry for room scanning and occlusion. |
| `xrblocks/src/interaction/DirectTouch.ts` | **reuse (adapt with notice)** | Permissive Apache-2.0 licence. Refined distance calculation for fingertip poke interactions. |
| `mobilecad-xr/core/hands.cpp` (`shoulderPoint`) | **port the idea (rewrite)** | GPL-3.0 copyleft forbids copying C++ source into AstraCAD. Port the mathematical shoulder projection geometry cleanly in TypeScript within `src/app/hands.ts`. |
| `mobilecad-xr/core/interaction.cpp` (build plate & 1:1 true size) | **port the idea (rewrite)** | GPL-3.0 copyleft forbids code reuse. Port the build plate rim manipulation and true-size 1:1 scaling concepts in TypeScript for `src/systems/interaction-system.ts`. |
| `TinkerXR/Assets/Scripts/CalibrateWorldCoordinates.cs` | **port the idea (rewrite)** | Permissive MIT licence, but written in C# for Unity MonoBehaviour architecture. Port the 2-point tactile calibration algorithm into `src/systems/workspace-system.ts`. |
| `chili3d/packages/parametric` | **study only** | AGPL-3.0 strictly copyleft. Study the born-edge topological identification algorithms to inform AstraCAD's future feature graph architecture without incorporating source code. |
| `LeapShape/src/Backend/OpenCascadeMesher.js` | **study only** | Apache-2.0, but AstraCAD already possesses a superior WASM kernel pipeline (`manifold-3d` 3.5.4) and `occt-import-js`. Study solely for BRep mesh buffer optimizations. |
| `LeapMotionWebXR` | **reject** | Confirmed redundant downstream fork of `LeapShape` from Oct 2023. Contains nothing novel over upstream; discarded. |

---

## 4. Risks & Mitigations

### 1. Bundle Size & Memory Overhead
- **Measurement**: Baseline production build generates `dist/assets/index-CjxcvqA0.js` at **2,913.71 kB** (gzip: **835.07 kB**).
- **Risk**: Adding external libraries (such as large portions of XR Blocks or OpenCASCADE) will inflate download time and exceed Quest Browser WebAssembly memory limits.
- **Mitigation**: Zero wholesale package imports. Extract only minimal, self-contained TypeScript routines (`PinchFilter`, math projection utilities). Any new heavy worker modules must be dynamically imported via Vite code-splitting.

### 2. Geometry Engine Invariance
- **Constraint**: AstraCAD's Manifold WASM engine and closed-form Truth Gate (`src/engine/truth.ts:52`) remain the sole authoritative arbiters of part geometry.
- **Risk**: Importing alternative CAD kernels could compromise volume conservation and tolerance guarantees.
- **Mitigation**: Any external geometric data (e.g. from STEP or depth meshes) must pass through typed adapters and undergo Truth Gate verification before being accepted into the document.

### 3. WebXR Hardware Compatibility
- **Risk**: WebXR Depth Sensing API (`depth-sensing`) and Hand Tracking (`hand-tracking`) features are subject to headset capabilities and browser security permissions.
- **Mitigation**: All spatial extensions must implement strict runtime feature detection. If depth sensing or hand tracking is absent, the app must gracefully fall back to controller rays and standard procedural floor planes.

### 4. Security & Sandbox Boundary
- **Risk**: `LeapShape` exhibited severe code injection risk via `new Function()`.
- **Mitigation**: Strict adherence to typed JSON message passing (`src/engine/protocol.ts`). No dynamic code evaluation or external string compilation will enter AstraCAD.

---

## 5. Next Steps
Upon receiving written approval of this compatibility analysis, proceed to **Phase 3: Integration Architecture** (`docs/integration/ARCHITECTURE.md`) to define typed TypeScript adapter interfaces and a ranked implementation roadmap.
