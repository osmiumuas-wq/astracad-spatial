# Audit: XR Blocks

## 1. Identity
- **Repository URL**: https://github.com/google/xrblocks
- **Commit Audited**: `300f935c382bec78d3af37b1b4ee45cd6569b07b` (Sat Nov 14 14:04:22 2026 -0800)
- **Licence**: Apache-2.0, verified from `LICENSE` (lines 1-201). Note: asset files in `assets/` carry their own licences. Permissive open source: code and algorithms may be adapted into AstraCAD Spatial with notice in `THIRD_PARTY_NOTICES.md`.
- **Activity**: Highly active; primary open-source XR prototyping SDK maintained by Google XR Blocks authors.
- **Maturity**: Production-ready SDK. Comprehensive test suite via Vitest (`vitest run`), Playwright end-to-end testing (`e2e/playwright.config.ts`), modern Rolldown build pipeline, and Oxlint code analysis.

## 2. Stack
- **Languages**: TypeScript 7.0.2, GLSL, WebGPU (`@webgpu/types`).
- **Frameworks & Runtimes**: Three.js `^0.186.0`, `@dimforge/rapier3d` (WASM physics), `@google/genai` 2.27.0, `@pmndrs/uikit` 1.0.77, `iwer` 2.5.0 (WebXR emulator), `@preact/signals-core`.
- **Build System**: Rolldown (`rolldown.config.js`).
- **Test System**: Vitest 5.0.3, Playwright 1.63.0.
- **Target Runtime**: WebXR on Meta Quest Browser, Apple Vision Pro Safari, and desktop browsers via IWER emulator.

## 3. Geometry
- **Kernel**: Three.js BufferGeometry accelerated by Bounding Volume Hierarchy (`three-mesh-bvh` 0.9.10), Rapier3D rigid body physics colliders.
- **Depth Geometry**: WebXR Depth Sensing API processing generating real-time spatial meshes (`src/depth/DepthMesh.ts:22`, `DepthMeshGeometry.ts:15`, `GPUDepthConverter.ts:25`).
- **Precision**: Single-precision floating-point GPU buffers.
- **File Formats**: glTF/GLB import via Three.js GLTFLoader, OBJ, depth map texture arrays.

## 4. XR and Input
- **API**: WebXR Device API with comprehensive feature detection.
- **Unified Input Manager**: `src/input/Input.ts:53` provides seamless input abstraction across tracked hands, 6DoF controllers, gaze dwell, and mouse/touch fallbacks.
- **Hand Tracking**: `src/input/Hands.ts:25` with `src/input/PinchFilter.ts:9` (hysteresis-based pinch start/end detection), `src/input/gestures/GestureRecognition.ts:20` (hand pose classification: point, fist, peace, thumbs up).
- **Interaction System**: `src/interaction/Interaction.ts:100` (event-driven spatial hover, select, drag, drop, and pinch manipulation).
- **Direct Touch**: `src/interaction/DirectTouch.ts:32` (distance-based fingertip poke interaction with virtual surfaces).
- **Adaptive Reticles**: `src/interaction/reticle/` (dynamic reticles adapting between gaze, ray, and surface normals).
- **Depth & Environment**: `src/depth/Depth.ts:30` (CPU and GPU raw depth texture processing for occlusion and spatial collision).
- **Emulation**: `src/simulator/Simulator.ts:47` (headless and browser simulation powered by IWER).
- **AI & Agent**: `src/agent/Agent.ts:26`, `src/ai/Gemini.ts:25` (multimodal AI agent with tool execution).

## 5. Architecture
- **Package Layout**: Decoupled ES module library exporting root SDK (`"."`) and specialized add-ons (`"./addons/*"`).
- **Subsystem Decoupling**: Input listeners, interaction event dispatchers, depth reconstruction, and AI services communicate via standard DOM event targets and Preact signals.

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| Unified XR input routing | `src/input/Input.ts:53` | read only |
| WebXR hand joint tracking | `src/input/Hands.ts:25` | read only |
| Hysteresis pinch filter | `src/input/PinchFilter.ts:9` | read only |
| Real-time gesture classification | `src/input/gestures/GestureRecognition.ts:20` | read only |
| Event-driven spatial interaction system | `src/interaction/Interaction.ts:100` | read only |
| Direct fingertip poke touch | `src/interaction/DirectTouch.ts:32` | read only |
| Gaze dwell selection | `src/interaction/GazeDwell.ts:15` | read only |
| Planar surface interaction constraints | `src/interaction/PlanarSurface.ts:12` | read only |
| WebXR Depth Sensing & DepthMesh | `src/depth/DepthMesh.ts:22` | read only |
| GPU-accelerated depth texture converter | `src/depth/GPUDepthConverter.ts:25` | read only |
| Rapier3D physics integration | `src/physics/Physics.ts:20` | read only |
| Browser-based IWER simulator | `src/simulator/Simulator.ts:47` | read only |
| Multimodal Gemini AI integration in XR | `src/ai/Gemini.ts:25` | read only |
| Spatial AI Agent with tool execution | `src/agent/Agent.ts:26` | read only |

## 7. Risks
- **Licence**: Apache-2.0 is fully permissive and compatible. Asset licences in `assets/` must be individually checked if any sample models are referenced.
- **Security**: AI integrations (`Gemini.ts`) require API keys; keys must reside exclusively in untracked `.env` files and never leak to client logs.
- **Performance**: High-density depth meshing can stress mobile Quest GPU fill rates without dynamic level-of-detail (LOD) decimation.
- **Maintenance**: Active development by Google may introduce upstream breaking changes to experimental WebXR features.

## 8. What AstraCAD Can Learn
- **Hysteresis Pinch Filtering**: `PinchFilter.ts:9` implements separate engagement and release thresholds (`pinchThreshold` vs `unpinchThreshold`), eliminating boundary chattering during spatial CAD dragging.
- **Real-Time WebXR Depth Meshing**: `DepthMesh.ts:22` and `DepthMeshRaycast.ts` demonstrate how to convert raw WebXR depth buffers into physical collision meshes in the room without requiring photogrammetry.
- **Direct Touch Engine**: `DirectTouch.ts:32` provides clean distance-based fingertip contact calculation for spatial buttons.
