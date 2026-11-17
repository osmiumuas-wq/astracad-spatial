# Audit: LeapMotionWebXR

## 1. Identity
- **Repository URL**: https://github.com/procw/LeapMotionWebXR
- **Commit Audited**: `4aee0c44f480841b2cc001ae6ca4caf8afe6dbc5` (Fri Oct 6 15:40:30 2023 -0400)
- **Licence**: Apache-2.0, verified from `LICENSE` (lines 1-201). Permissive open source.
- **Activity**: Stale/abandoned; 5 commits in October 2023 by `Martin` (`developerteam888@outlook.com`).
- **Fork Analysis**: Confirmed direct fork / mirror of `zalo/LeapShape` from early October 2023. Code comparison between `LeapShape/src` and `LeapMotionWebXR/src` reveals identical CAD algorithms, worker message structures, and tool implementations. Changes are confined to adding a GitHub Actions workflow (`.github/workflows/main.yml`) and trivial README edits.

## 2. Stack
- **Languages**: JavaScript (ES2020 modules).
- **Frameworks & Runtimes**: Three.js `^0.155.0`, `opencascade.js` (custom fork `zalo/opencascade.js`), `leapjs` `^1.1.1`, `potpack` `^1.0.1`.
- **Build System**: `esbuild` `^0.12.6` (`package.json`).
- **Test System**: None.
- **Target Runtime**: Chromium browsers, WebXR headsets.

## 3. Geometry
- **Kernel**: OpenCASCADE Technology compiled to WebAssembly via Emscripten (`src/Backend/mainWorker.js:32`).
- **Precision**: Analytical BRep representations (identical to LeapShape).
- **File Formats**: STEP, IGES, STL, OBJ (`src/Frontend/World/FileIO.js:177, 246`).

## 4. XR and Input
- **API**: WebXR Device API and Leap Motion tracking.
- **Input Paradigms**: Identical to `zalo/LeapShape` (`src/Frontend/Input/OpenXRInput.js:25`, `LeapPinchLocomotion.js:22`).

## 5. Architecture
- **Structure**: Main thread UI + Three.js, Web Worker for OpenCASCADE WASM. Identical to `zalo/LeapShape`.

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| OpenCASCADE WASM worker mesher | `src/Backend/OpenCascadeMesher.js:25` | read only |
| Primitive Box creation | `src/Frontend/Tools/BoxTool.js:25` | read only |
| Primitive Cylinder creation | `src/Frontend/Tools/CylinderTool.js:25` | read only |
| Primitive Sphere creation | `src/Frontend/Tools/SphereTool.js:25` | read only |
| 2D Profile Extrusion | `src/Frontend/Tools/ExtrusionTool.js:23` | read only |
| Edge Filleting | `src/Frontend/Tools/FilletTool.js:23` | read only |
| Thick Solid / Offset Hollowing | `src/Frontend/Tools/OffsetTool.js:26` | read only |
| Boolean Union & Difference | `src/Frontend/Tools/UnionTool.js:24`, `src/Frontend/Tools/DifferenceTool.js:24` | read only |
| STEP & IGES import/export | `src/Frontend/World/FileIO.js:177, 246` | read only |
| WebXR hand tracking joint capture | `src/Frontend/Input/OpenXRInput.js:25` | read only |
| Leap Motion pinch locomotion | `src/Frontend/Input/LeapPinchLocomotion.js:22` | read only |

## 7. Risks
- **Redundancy & Staleness**: Superseded in all aspects by the upstream repository `zalo/LeapShape`. Misses upstream 2024 fixes and Three.js 0.165 updates.
- **Security**: Contains the same arbitrary code execution risk via `new Function()` in `src/Backend/mainWorker.js:72`.

## 8. What AstraCAD Can Learn
- **Integration Assessment**: This repository is a redundant downstream snapshot. AstraCAD should track `zalo/LeapShape` directly and discard `procw/LeapMotionWebXR` from future evaluation phases.
