# Audit: Chili3D

## 1. Identity
- **Repository URL**: https://github.com/xiangechen/chili3d
- **Commit Audited**: `4600206f9b354421f4de288e853efcde926da080` (Mon Nov 2 09:21:53 2026 +0800)
- **Licence**: AGPL-3.0, verified from `LICENSE` (lines 1-661). Strong copyleft: study only. Code cannot be copied or adapted into AstraCAD Spatial unless AstraCAD is relicensed under AGPL-3.0.
- **Activity**: Highly active; last commit November 2026 by Xiange Chen. Over 5,000 GitHub stars.
- **Maturity**: Production-grade web CAD application with extensive automated unit, kernel, and visual regression tests (`rstest`), modern bundler (`rspack`), and code quality tooling (`biome`).

## 2. Stack
- **Languages**: TypeScript, C++ (Emscripten WebAssembly).
- **Frameworks & Runtimes**: React, Three.js, OpenCASCADE Technology (custom C++ WASM bindings in `cpp/`).
- **Build System**: Rspack (`rspack.config.ts`), Turborepo/pnpm monorepo architecture (`packages/*`, `plugins/*`).
- **Test System**: Rstest (`rstest.config.ts`).
- **Target Runtime**: Desktop and mobile web browsers (WebGL2).

## 3. Geometry
- **Kernel**: OpenCASCADE BRep Technology compiled via Emscripten into custom WASM module (`packages/wasm/`).
- **Precision**: Analytical BRep precision with topological naming and persistent edge/face ID tracking (`packages/parametric/test/booleanBornEdgeId.kernel.test.ts:1`).
- **Modeling Paradigm**: Parametric history-based feature graph (`packages/parametric/`). Features include Extrude (with drafts and end conditions), Revolve, Loft, Sweep, Fillet (constant and variable), Chamfer, and Boolean operations.
- **File Formats**:
  - In: STEP (`packages/core/src/step`), IGES, BREP, glTF, STL.
  - Out: STEP, IGES, STL, OBJ, glTF.

## 4. XR and Input
- **API**: None. Desktop mouse/keyboard and mobile touch events only. No WebXR or OpenXR implementations.
- **Snapping**: Sophisticated 3D snapping system (`packages/core/src/snap/`) supporting point-on-curve, point-on-axis, point-on-plane, and grid snapping.

## 5. Architecture
- **Monorepo Structure**:
  - `packages/core/`: Foundation, command pattern, selection filters, snap engine, data exchange.
  - `packages/parametric/`: Parametric feature graph, dependency tracking, rebuild pipeline.
  - `packages/wasm/`: WebAssembly bridge interfacing TypeScript with C++ OpenCASCADE.
  - `packages/app/`: Top-level application UI, ribbon, canvas, document store.
  - `packages/ai/`: Natural language CAD assistance.
- **Command Store**: Transactional command store (`packages/core/src/command/commandStore.ts:11`) maintaining undo/redo history.

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| OpenCASCADE custom WASM bindings | `packages/wasm/src/` | read only |
| Parametric feature tree rebuild engine | `packages/parametric/src/` | read only |
| Extrude with draft & end conditions | `packages/parametric/src/features/extrude.ts:1` | read only |
| Revolve around arbitrary axis | `packages/parametric/src/features/revolve.ts:1` | read only |
| Loft through multi-section profiles | `packages/parametric/src/features/loft.ts:1` | read only |
| Constant & variable edge filleting | `packages/app/src/commands/modify/fillet.ts:1` | read only |
| Boolean Cut, Fuse, and Common | `packages/parametric/src/features/boolean.ts:1` | read only |
| Topological naming & persistent entity IDs | `packages/parametric/src/features/` | read only |
| STEP import and export | `packages/core/src/step/` | read only |
| Advanced 3D object snapping | `packages/core/src/snap/` | read only |
| Visual programming & macro plugin system | `plugins/visual-programming/`, `plugins/macro/` | read only |
| Undo/Redo transaction command store | `packages/core/src/command/commandStore.ts:11` | read only |

## 7. Risks
- **Licence**: AGPL-3.0 strictly prohibits code reuse without relicensing AstraCAD under AGPL-3.0.
- **Performance**: Large OpenCASCADE WASM payload; complex BRep operations block main thread without fine-grained web worker sharding.
- **Complexity**: Deep package coupling within monorepo.

## 8. What AstraCAD Can Learn
- **Topological Entity Naming**: `chili3d` implements an effective solution to the CAD topological naming dilemma, tracking born-edge and parent-face ancestries across boolean operations (`booleanBornEdgeId.kernel.test.ts`).
- **Feature Graph Rebuild**: Decoupling the parametric feature dependency DAG from interactive manipulators allows deterministic parametric recalculations.
