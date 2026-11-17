# Audit: LeapShape

## 1. Identity
- **Repository URL**: https://github.com/zalo/LeapShape
- **Commit Audited**: `aa49985006d85854c1e45bdf7e4a353862a4fac9` (Tue Jun 4 23:12:57 2024 -0700)
- **Licence**: Apache-2.0, verified from `LICENSE` (lines 1-201). Permissive open source: code, algorithms, and techniques may be adapted with appropriate copyright notice in `THIRD_PARTY_NOTICES.md`.
- **Activity**: Stale/archived; last pushed June 2024 by John Robinson (`zalo`).
- **Maturity**: Prototype/proof-of-concept. No automated test suite, no CI workflows, no release tags. Verified exclusively through manual browser runs by its authors.

## 2. Stack
- **Languages**: JavaScript (ES2020 modules).
- **Frameworks & Runtimes**: Three.js `^0.165.0`, `opencascade.js` (custom GitHub fork `zalo/opencascade.js`), `leapjs` `^1.1.1`, `potpack` `^1.0.1`.
- **Build System**: `esbuild` `^0.12.6` configured via `package.json:14`.
- **Test System**: None (no tests found in repository).
- **Target Runtime**: Chromium-based desktop browsers and WebXR headsets (Meta Quest Browser).

## 3. Geometry
- **Kernel**: OpenCASCADE Technology (BRep) compiled to WebAssembly via Emscripten (`src/Backend/mainWorker.js:32`).
- **Precision**: Double-precision analytical BRep representations; tessellation tolerances controlled during meshing (`src/Backend/OpenCascadeMesher.js:62`).
- **Modeling Paradigm**: Direct BRep modeling with primitive solid generation, extrusion, fillets, thick-solid hollowing, and CSG booleans (`BRepAlgoAPI_Fuse`, `BRepAlgoAPI_Cut`).
- **File Formats**:
  - In: STEP & IGES via `STEPControl_Reader` and `IGESControl_Reader` (`src/Frontend/World/FileIO.js:246`); ASCII STL via `BRepBuilderAPI_MakeSolid` (`src/Frontend/World/FileIO.js:276`).
  - Out: STEP via `STEPControl_Writer` (`src/Frontend/World/FileIO.js:177`), STL via Three.js `STLExporter` (`src/Frontend/World/FileIO.js:144`), OBJ via `OBJExporter` (`src/Frontend/World/FileIO.js:135`).

## 4. XR and Input
- **API**: WebXR Device API (`src/Frontend/Input/OpenXRInput.js:25`) and Ultraleap Leap Motion tracking (`src/Frontend/Input/LeapJSInput.js:20`).
- **Hand Tracking**: Joint pose tracking through WebXR `XRHand` (`OpenXRInput.js:35`). Includes custom pinch locomotion (`src/Frontend/Input/LeapPinchLocomotion.js:22`), temporal frame interpolation (`src/Frontend/Input/LeapFrameInterpolator.js:15`), and temporal warping (`src/Frontend/Input/LeapTemporalWarping.js:12`).
- **Controllers & Mouse**: Desktop mouse raycasting fallback (`src/Frontend/Input/MouseInput.js:15`).
- **Interaction Elements**: Custom spatial transform gizmo `LSTransformControls` (`src/Frontend/Tools/General/LSTransformControls.js:35`), spatial 3D grid with snap increments (`src/Frontend/Tools/General/Grid.js:20`), and hand-attached floating tool menu (`src/Frontend/Tools/General/Menu.js:20`).

## 5. Architecture
- **Module Boundaries**:
  - `src/Frontend/`: Handles user interaction, camera, WebXR session loops, tool selection state machines (`src/Frontend/Tools/Tools.js:44`), and Three.js scene graph.
  - `src/Backend/`: Dedicated Web Worker (`src/Backend/mainWorker.js:24`) hosting OpenCASCADE WASM.
- **Threading Model**: Asynchronous message passing between main thread and worker thread via `postMessage`.
- **Public APIs**: Engine executor interface `this.engine.execute(operationName, functionCode, args, callback)` (`src/Backend/main.js:25`).

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| OpenCASCADE WASM worker mesher | `src/Backend/OpenCascadeMesher.js:25` | read only |
| Primitive Box creation (`BRepPrimAPI_MakeBox`) | `src/Frontend/Tools/BoxTool.js:25` | read only |
| Primitive Cylinder creation (`BRepPrimAPI_MakeCylinder`) | `src/Frontend/Tools/CylinderTool.js:25` | read only |
| Primitive Sphere creation (`BRepPrimAPI_MakeSphere`) | `src/Frontend/Tools/SphereTool.js:25` | read only |
| 2D Profile Extrusion (`BRepPrimAPI_MakePrism`) | `src/Frontend/Tools/ExtrusionTool.js:23` | read only |
| Edge Filleting (`BRepFilletAPI_MakeFillet`) | `src/Frontend/Tools/FilletTool.js:23` | read only |
| Thick Solid / Offset Hollowing (`BRepOffsetAPI_MakeThickSolid`) | `src/Frontend/Tools/OffsetTool.js:26` | read only |
| Boolean Union (`BRepAlgoAPI_Fuse`) | `src/Frontend/Tools/UnionTool.js:24` | read only |
| Boolean Difference (`BRepAlgoAPI_Cut`) | `src/Frontend/Tools/DifferenceTool.js:24` | read only |
| Edge cleaning (`ShapeUpgrade_UnifySameDomain`) | `src/Frontend/Tools/CleanEdgesTool.js:24` | read only |
| STEP export (`STEPControl_Writer`) | `src/Frontend/World/FileIO.js:177` | read only |
| STEP / IGES import | `src/Frontend/World/FileIO.js:246` | read only |
| ASCII STL to BRep solid import | `src/Frontend/World/FileIO.js:276` | read only |
| WebXR hand tracking joint capture | `src/Frontend/Input/OpenXRInput.js:25` | read only |
| Leap Motion pinch locomotion in VR | `src/Frontend/Input/LeapPinchLocomotion.js:22` | read only |
| Hand frame interpolation & temporal warping | `src/Frontend/Input/LeapFrameInterpolator.js:15`, `src/Frontend/Input/LeapTemporalWarping.js:12` | read only |
| 3D Transform Gizmos | `src/Frontend/Tools/General/LSTransformControls.js:35` | read only |
| Spatial snapping grid | `src/Frontend/Tools/General/Grid.js:20` | read only |
| Undo/Redo transaction stack | `src/Frontend/World/History.js:20` | read only |

## 7. Risks
- **Licence**: Apache-2.0 is compatible with AstraCAD, allowing algorithmic and code adaptation provided notices are preserved.
- **Security**: Critical code injection vector in `src/Backend/mainWorker.js:72`: `new Function("return function " + payload.shapeFunction)().bind(this)`. Passing code strings from frontend to worker `Function()` constructor bypasses type safety and allows arbitrary code execution.
- **Performance**: OpenCASCADE WASM payload exceeds 25 MB, causing significant download and initialization overhead on standalone headsets. Meshing complex BRep shapes blocks worker threads.
- **Maintenance**: Unmaintained since June 2024; relies on outdated dependencies (`three@0.165`, `esbuild@0.12`).

## 8. What AstraCAD Can Learn
- **OpenCASCADE BRep Meshing**: `OpenCascadeMesher.js:62` provides an efficient routine for extracting vertex buffers, normal vectors, and face/edge boundary indices from OpenCASCADE shapes into Three.js BufferGeometry without intermediate file serialisation.
- **Shape Healing**: `CleanEdgesTool.js:24` shows how `ShapeUpgrade_UnifySameDomain` effectively removes redundant planar edges and blends post-boolean BRep boundaries.
- **What to Avoid**: Never adopt stringified function execution (`new Function()`) across the worker boundary; AstraCAD must strictly maintain typed message discriminators.
