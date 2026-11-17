# AstraCAD Spatial: Integration Architecture & Implementation Roadmap

## 0. Architectural Principles & Browser-First Foundation

AstraCAD Spatial is fundamentally a **web application** designed to run seamlessly in modern desktop and mobile web browsers (Chrome, Edge, Safari, Firefox) as well as WebXR-compliant immersive browsers (Meta Quest Browser). 

Following the user directive (**"make sure it should run on browser"** and **"i dont have one" [no physical headset]**):
1. **100% Browser Execution**: Every feature, manipulator, and solver must function interactively in a standard desktop browser using mouse, keyboard, and touch pointer inputs. No component may depend on native OpenXR binaries, native Android APKs, or external desktop runtime processes.
2. **WebXR as an Progressive Enhancement**: WebXR immersive sessions (IWER emulation or physical headset if available) enhance the spatial experience, but the desktop browser 3D canvas remains fully authoritative and capable.
3. **One Geometry Truth**: The Manifold 3.5 WASM kernel (`src/engine/kernel.ts`) and closed-form Truth Gate (`src/engine/truth.ts`) remain the single source of geometry truth. No external kernel or mesh format may bypass or weaken Truth Gate verification.
4. **Licence Integrity**: No copyleft code (GPL-3.0 from `mobilecad-xr` or AGPL-3.0 from `chili3d`) is imported. Permissive code (Apache-2.0 from `xrblocks` and `LeapShape`, MIT from `TinkerXR`) is adapted with notices preserved in `THIRD_PARTY_NOTICES.md`.

---

## 1. The Adapter Boundary

All foreign capabilities enter AstraCAD Spatial through strongly-typed TypeScript adapter interfaces. These isolate external logic, enforce compile-time type safety, and enable thorough headless unit testing.

### 1.1 Input & Gesture Adapter: `PinchFilterAdapter` & `ShoulderRayAdapter`
**Plugs into**: `src/app/hands.ts` and `src/systems/interaction-system.ts`.

Implements dual-threshold Schmitt hysteresis (adapted from `xrblocks/src/input/PinchFilter.ts`) to eliminate pinch chatter, and shoulder-origin ray projection (ported from `mobilecad-xr/core/hands.cpp:10`) to eliminate wrist-pivot ray jitter. Includes a unified desktop browser pointer fallback.

```typescript
export interface PinchFilterConfig {
  /** Distance (metres) below which pinch engages. Default: 0.022 (22 mm). */
  pinchThreshold: number;
  /** Distance (metres) above which pinch releases. Default: 0.032 (32 mm). */
  unpinchThreshold: number;
  /** Minimum frames in state before transition to prevent transient noise. */
  debounceFrames?: number;
}

export interface IPinchFilter {
  /** Update filter with thumb and finger tip positions. Returns filtered pinching state. */
  update(thumbTip: Vector3, fingerTip: Vector3): boolean;
  /** Whether pinch is currently engaged. */
  readonly isPinching: boolean;
  /** Whether pinch engaged on the current frame. */
  readonly pinchStarted: boolean;
  /** Whether pinch disengaged on the current frame. */
  readonly pinchEnded: boolean;
  /** Current Euclidean distance between pads, metres. */
  readonly distance: number;
  /** Filtered pinch contact midpoint. */
  readonly midpoint: Vector3;
}

export interface IShoulderRayCalculator {
  /** Compute ergonomic shoulder anchor point in world space from head pose. */
  computeShoulder(headPose: { position: Vector3; rotation: Quaternion }, isLeft: boolean): Vector3;
  /** Compute pointing ray originating from shoulder through hand knuckles. */
  computeAimRay(shoulder: Vector3, handKnuckle: Vector3): Ray;
}

export interface IBrowserPointerFallback {
  /** Map desktop mouse click/drag or touch event to equivalent spatial ray and pinch. */
  processPointer(event: MouseEvent | TouchEvent, camera: Camera): { ray: Ray; isDown: boolean };
}
```

**Testing Strategy**:
- Unit test (`tests/hands-filter.test.ts`): Feed noisy sinusoidal distance sequences spanning the 20–35 mm boundary; assert that state transitions occur exactly at thresholds with zero intermediate toggling.
- Ray stability test (`tests/shoulder-ray.test.ts`): Simulate 45° wrist rotation while arm remains stationary; assert that shoulder-projected ray angular drift is < 1.5°, compared to > 25° for raw wrist aim.

---

### 1.2 Tabletop & Workspace Calibration Adapter: `IWorkspaceCalibrationAdapter`
**Plugs into**: `src/systems/workspace-system.ts`.

Ported from `TinkerXR/Assets/Scripts/CalibrateWorldCoordinates.cs`. Allows users to align the virtual workbench to a physical table via 2 contact points, with a pure browser UI fallback (slider & orbit alignment).

```typescript
export interface TableCalibrationPoints {
  /** Touch point on front-left table corner or edge. */
  pointA: Vector3;
  /** Touch point on front-right table corner or edge. */
  pointB: Vector3;
  /** Optional third point for surface plane normal calculation. */
  pointC?: Vector3;
}

export interface IWorkspaceCalibrationAdapter {
  /** Calibrate workspace orientation and height from 2 or 3 tactile points. */
  calibrateFromPoints(points: TableCalibrationPoints): Matrix4;
  /** Set table height and orientation directly via in-browser desktop UI sliders. */
  setManualCalibration(heightMm: number, rotationDeg: number): Matrix4;
  /** Reset to default ergonomic seated/standing origin. */
  resetToDefault(): Matrix4;
}
```

**Testing Strategy**:
- Unit test (`tests/workspace-calib.test.ts`): Verify that two arbitrary 3D points at known slant and height produce a transformation matrix whose ground plane is level (XY aligned) with exact calculated bench width and elevation.

---

### 1.3 True-Scale 1:1 & Walk Navigation Adapter: `ISpatialScaleAdapter`
**Plugs into**: `src/systems/interaction-system.ts`.

Ported from `mobilecad-xr/core/interaction.cpp:103-188`. Switches between bench-manipulation scale and 1:1 physical millimeter scale with floor alignment, plus a desktop WASD / mobile virtual joystick walk mode.

```typescript
export interface ISpatialScaleAdapter {
  /** Toggle true 1:1 scale (1 mm = 1 mm in room units) vs interactive bench fit scale. */
  setTrueScale(enabled: boolean): void;
  readonly isTrueScale: boolean;
  /** Floor alignment offset in metres. */
  readonly floorOffset: number;
  /** Desktop WASD walk / arrow navigation delta update. */
  updateDesktopWalk(moveVector: Vector3, deltaSeconds: number): void;
  /** Parabolic teleport arc calculation for spatial model traversal. */
  computeTeleportArc(start: Vector3, direction: Vector3, obstacles: Object3D[]): Vector3 | null;
}
```

**Testing Strategy**:
- Unit test (`tests/true-scale.test.ts`): Create a 100 mm box; assert bounding box in world coordinates measures exactly 0.100 m when `trueScale` is true.
- Navigation test (`tests/walk-nav.test.ts`): Verify parabolic collision against ground plane and refusal on vertical walls.

---

### 1.4 Depth Mesh & Environment Awareness Adapter: `IDepthMeshAdapter`
**Plugs into**: `src/systems/scan-system.ts`.

Adapted from `xrblocks/src/depth/DepthMesh.ts`. In WebXR, processes raw depth sensing textures into collision meshes. In standard desktop browsers, provides file drag-and-drop import for reference 3D meshes (OBJ/STL/GLB).

```typescript
export interface IDepthMeshAdapter {
  /** Whether runtime environment supports WebXR raw depth sensing. */
  readonly isDepthSensingSupported: boolean;
  /** Process WebXR depth buffer into Three.js BufferGeometry with LOD decimation. */
  updateFromDepthBuffer(depthInfo: XRDepthInformation, camera: Camera): BufferGeometry | null;
  /** Desktop browser fallback: load reference environment mesh from user file. */
  loadDesktopReferenceMesh(fileBuffer: ArrayBuffer, format: 'glb' | 'stl' | 'obj'): Promise<BufferGeometry>;
}
```

**Testing Strategy**:
- Unit test (`tests/depth-mesh.test.ts`): Pass a synthetic 16-bit depth buffer; assert that generated `BufferGeometry` contains valid, indexed triangles with finite normal vectors.

---

## 2. Data Contracts & Truth Gate Integrity

To prevent any foreign component from corrupting the core CAD models, all data crossing adapter boundaries must satisfy strict data contracts:

```
[Adapter Boundary] ---> [Typed Part AST] ---> [Manifold 3.5 WASM] ---> [Closed-form Truth Gate]
      ^                                                                         |
      | (External Data: depth meshes,                                           v
      |  STEP files, parameter edits)                                   Pass: Verified (commit)
                                                                        Fail: Reject (rollback)
```

1. **Geometry Contract (`KernelProps`)**:
   Geometry crossing into the engine is represented strictly as indexed triangle buffers:
   ```typescript
   export interface KernelProps {
     positions: Float32Array;
     indices: Uint32Array;
     volume: number;
     surfaceArea: number;
     centerOfMass: [number, number, number];
     boundingBox: [number, number, number, number, number, number];
   }
   ```
2. **Truth Gate Superiority (`src/engine/truth.ts:52`)**:
   Every part generated or modified by an integrated feature is subjected to analytical closed-form verification:
   $$\left| \frac{V_{\text{kernel}} - V_{\text{analytical}}}{V_{\text{analytical}}} \right| \le 10^{-5}$$ (`VOLUME_TOL`, `src/engine/truth.ts:11`; corrected 16 Nov 2026 from 1e-6)
   If a newly integrated feature yields self-intersecting or non-manifold meshes, the Truth Gate throws a `SpecError` (`src/engine/types.ts:71`) and rejects the transaction.
3. **Pure Typed JSON Messaging**:
   Worker communication strictly uses typed discriminators (`src/engine/protocol.ts`). Stringified dynamic code compilation (`new Function` as seen in LeapShape) is categorically forbidden.

---

## 3. Ranked Implementation Roadmap

The roadmap is prioritized by concrete user value, browser feasibility, and architectural risk:

| Rank | Milestone / Item | User-Visible Gain | Effort | Risk | Verification Tests |
| --- | --- | --- | --- | --- | --- |
| **1** | **Robust Pinch Filter & Shoulder-Origin Raycasting** | Rock-solid pinch interaction without dropouts; jitter-free pointer ray; 100% desktop mouse/touch parity in browser. | 2.0 days | Low | `tests/hands-filter.test.ts`, `tests/shoulder-ray.test.ts`, desktop click/drag verification. |
| **2** | **True-Size 1:1 Scale & Desktop Walk Mode** | Instant toggle to inspect parts at exact 1:1 millimeter scale in the room or on screen; WASD walk-through for large models. | 1.5 days | Low | `tests/true-scale.test.ts`, bounding box scale assertions. |
| **3** | **Tactile Physical Workspace & Desk Calibration** | Align virtual workbench to real furniture with 2 taps (or browser desk slider) so models rest solidly on physical surfaces. | 1.5 days | Low | `tests/workspace-calib.test.ts`, transform levelness assertions. |
| **4** | **WebXR Depth Mesh & Reference Mesh Importer** | Live real-world obstacle collision in WebXR; drag-and-drop reference mesh import in standard browsers. | 3.0 days | Medium | `tests/depth-mesh.test.ts`, mesh decimation performance benchmarks. |
| **5** | **Persistent Topological Entity Naming Heuristics** | Modifying upstream dimensions preserves downstream edge fillets and hole alignments without manual re-picking. | 4.0 days | High | `tests/topological-naming.test.ts`, 50-cycle parameter variation tests. |
| **6** | **In-Situ 3D Printer Telemetry & OctoPrint Bridge** | Real-time 3D print progress, extruder temperatures, and build-volume envelope overlay directly in CAD view. | 2.5 days | Low | `tests/printer-telemetry.test.ts`, mock HTTP Moonraker API tests. |

*Total estimated roadmap effort: 14.5 engineering days.*

---

## 4. What Is Deliberately Not Integrated, and Why

1. **Native OpenXR C++ Runtimes (`mobilecad-xr` native code)**:
   - *Reason*: Cannot run in web browsers. Requires native Android NDK compilation and platform binaries, violating the browser-first requirement. Only mathematical algorithms (`shoulderPoint`, build plate interaction logic) are cleanly ported to TypeScript.
2. **Unity C# Scripts & Monobehaviours (`TinkerXR`)**:
   - *Reason*: Runtime and language barrier (.NET / Mono / Unity engine). The concepts (tabletop calibration, 3D printer telemetry) are ported natively in TypeScript.
3. **AGPL-3.0 Source Code (`chili3d`)**:
   - *Reason*: Licence incompatibility. Copyleft AGPL-3.0 prohibits code reuse in AstraCAD unless the entire AstraCAD Spatial repository is relicensed under AGPL-3.0. Chili3D's topological naming concepts are studied, not copied.
4. **OpenCASCADE Kernel Replacement**:
   - *Reason*: Manifold 3.5.4 WASM is substantially faster, guaranteed watertight, and strictly verified by AstraCAD's Truth Gate. OpenCASCADE is retained exclusively via `occt-import-js` for STEP file exchange, never replacing Manifold as the internal modeling engine.
5. **Stringified Web Worker Evaluation (`LeapShape` `new Function`)**:
   - *Reason*: Severe arbitrary code execution security risk.
6. **Redundant Fork `procw/LeapMotionWebXR`**:
   - *Reason*: Outdated downstream fork of LeapShape with zero novel code. Discarded.
7. **Unresolved `onlineCAD`**:
   - *Reason*: Excluded per user confirmation.

---

## 5. Next Steps
Upon receiving written approval of this architecture document (`Phase 3 approved`), implementation will proceed strictly on isolated feature branches (`integration/<item>`) with full test coverage and Truth Gate verification.

---

## 6. Outcome of Phases 4 and 5 (16 Nov 2026, completed by Claude)

The competition deadline (18 Nov 2026, 12:00 PT) leaves about two days, against the 14.5 days this roadmap
estimates. Before building anything, each item was checked against the code. Three were already in AstraCAD, which
the Phase 1 audit missed:

| Rank | Item | Finding in the code | Decision |
| --- | --- | --- | --- |
| 1 | Pinch filter with hysteresis | Already there: `src/app/hands.ts:42-43` (engage below 8 mm, release above 22 mm, measured between joint surfaces using joint radii), one-euro filtering of the pinch point (`OneEuro3`) and a 0.18 s dropout grace. The ray is the system's WebXR target ray, which Quest computes for hands itself. | Not built: a second filter would duplicate it, and a custom shoulder ray cannot be checked without a headset. |
| 2 | True 1:1 scale | Partly there: the bench draws parts at 1 mm = 1 mm when the view zoom is 1, but zoom was reachable only with a desktop mouse wheel (`src/flat/flat-ui.ts`). In the headset there was no way to zoom or return to true size. | **Built** (below). Walk mode was dropped: the competition's design guidelines ask for seated, stationary use. |
| 3 | Desk calibration | Already there: the bench lowers or raises onto a detected horizontal surface (`src/systems/workspace-system.ts:497`), and the room anchor keeps it in place (`src/app/room-anchor.ts`). | Not built: duplicate. |
| 4 | Depth mesh | Needs WebXR depth sensing on a device to verify. | Deferred: cannot be verified before the deadline. |
| 5 | Topological naming | 4 days, high risk to the geometry core. | Deferred. |
| 6 | Printer telemetry (OctoPrint, Moonraker) | Needs a printer on the local network and its CORS settings; a client-only Quest Browser page cannot reach it reliably. | Deferred. |

No third-party code was copied or adapted, so no `THIRD_PARTY_NOTICES.md` is needed yet.

### Built: zoom and true size by hand and voice

- `src/app/view-zoom.ts`: the commands "true size", "actual size", "life size", "one to one", "1:1", "reset zoom",
  "zoom in" (x1.5), "zoom out", "zoom 2 times", "zoom to 3x", "zoom 150 percent", and "toggle zoom". Zoom is
  clamped to 0.4-4. The reply always says that the part's dimensions are unchanged.
- One zoom state, `App.viewZoom`, is used by voice, typed commands, the new ribbon button and the desktop wheel.
  `src/systems/design-system.ts` applies it to the bench view.
- The ribbon button "Zoom 1:1 / 2x" is on the Output tab, so the feature works with hands alone.
- The help text lists "true size" and "zoom in".

### Verification (Phase 5)

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest run` | 47 files passed, 2 skipped; 247 tests passed, 2 skipped (5 new in `tests/view-zoom.test.ts`). The first full run had 1 failure, which did not recur in two further runs; it was not identified. |
| `npm run build` | built |
| Phrase collisions | No sentence in the command corpus or the parsers matches the zoom phrases (searched); the test also checks that "make it 2 times thicker", "scale 2", "size 20" and others are left alone. |
| In the app (IWER emulator, design job) | "true size" gives 0.001 m per mm (1:1); "zoom 2 times" gives 0.002; "zoom out" gives 1.333x; "zoom in" twice from 3x stops at 4x. The Output tab shows the button with nine tools in three columns. Pressing it with the emulated right hand goes 1 -> 2 -> 1, and the notice reads "True size: 1 mm on the bench is 1 mm in your room." |
| Quest hardware | Not verified: no headset test. |
