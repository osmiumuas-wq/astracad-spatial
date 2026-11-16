# Audit: TinkerXR

## 1. Identity
- **Repository URL**: https://github.com/Boysle/TinkerXR
- **Commit Audited**: `c7cc93e8568556cf12b1d2a40126b3fd1289edff` (Wed Apr 22 12:01:13 2026 +0200)
- **Licence**: MIT, verified from `LICENSE` (lines 1-21). Permissive open source: concepts, algorithms, and designs may be adapted with attribution in `THIRD_PARTY_NOTICES.md`.
- **Activity**: Academic research codebase; last pushed April 2026 by Oğuz Arslan (`Boysle`). Associated with ACM CHI publication.
- **Maturity**: Research prototype in Unity 2022.3 LTS. No automated unit tests in repository; verified through interactive Unity editor and Quest headset sessions.

## 2. Stack
- **Languages**: C# (.NET / Mono).
- **Frameworks & Runtimes**: Unity 2022.3 LTS, Oculus Integration SDK, Universal Render Pipeline (URP), TextMesh Pro.
- **Build System**: Unity Editor build pipeline.
- **Test System**: None.
- **Target Runtime**: Meta Quest 2 / Quest Pro / Quest 3 via Oculus XR plugin.

## 3. Geometry
- **Kernel**: Custom mesh-based CSG engine (`Assets/Scripts/LibCSG-Runtime/CSGBrush.cs`, `CSGBrushOperation.cs`, `Build2DFaces.cs`, `MeshMerge.cs`).
- **Precision**: Single-precision floating-point mesh representations. Lacks exact BRep topology; prone to coplanar polygon artifacts.
- **Modeling Paradigm**: Direct CSG solid subtraction and union of polyhedral primitive brushes.
- **File Formats**:
  - In: Unity Mesh assets.
  - Out: STL and OBJ for 3D printer slicing and manufacturing.

## 4. XR and Input
- **API**: Oculus XR SDK / OpenXR.
- **Hand & Controller Tracking**: Hand physics and controller interactions handled in `Assets/Scripts/ObjectGrabDetector.cs:37` and `HandRotationDetector.cs:25`.
- **Reality-Aware World Calibration**: `Assets/Scripts/CalibrateWorldCoordinates.cs:46` aligns the virtual workspace coordinate frame to physical tabletop surfaces using two tactile calibration points.
- **Workspace Zone Selection**: `Assets/Scripts/SelectWorkspace.cs:33` partitions the physical environment into designated active fabrication zones.
- **Spatial Manipulation**:
  - 3D Grid Snapping: `Assets/Scripts/SnapToGrid.cs:36`.
  - Corner, Edge, and Vertex Scale Handles: `CornerScaler.cs:33`, `EdgeScaler.cs:30`, `VertexScaler.cs:38`.
  - 3D Visual Measurement Ruler: `RulerManager.cs:33`, `ScaleBilboard.cs:29`.
- **Physical Fabrication**: In-situ 3D printer control (`Assets/Scripts/Artun/PrinterController.cs:65`, `PrinterProperties.cs:64`) communicating with real printers via local network bridge (`MgrServer`).

## 5. Architecture
- **Component Model**: Unity MonoBehaviour component system.
- **Key Subsystems**:
  - `LibCSG-Runtime/`: Runtime polygon clipping and mesh union/subtraction.
  - `Scripts/`: Interaction handles, selection, scaling, and calibration.
  - `Artun/`: 3D printer client communication.
  - `MgrServer/`: Local bridge service for printer status and job transmission.

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| Reality-aware world coordinate calibration | `Assets/Scripts/CalibrateWorldCoordinates.cs:46` | read only |
| Workspace zone demarcation | `Assets/Scripts/SelectWorkspace.cs:33` | read only |
| Runtime Mesh CSG Boolean Union | `Assets/Scripts/LibCSG-Runtime/CSGBrushOperation.cs:45`, `Selection.cs:1044` | read only |
| Interactive 3D measurement ruler | `Assets/Scripts/RulerManager.cs:33` | read only |
| Real-time spatial grid snapping | `Assets/Scripts/SnapToGrid.cs:36` | read only |
| Direct corner scale handles | `Assets/Scripts/CornerScaler.cs:33` | read only |
| Direct edge scale handles | `Assets/Scripts/EdgeScaler.cs:30` | read only |
| Direct vertex scale handles | `Assets/Scripts/VertexScaler.cs:38` | read only |
| Object multi-selection and duplicate | `Assets/Scripts/Selection.cs:601, 628` | read only |
| Physical 3D printer integration | `Assets/Scripts/Artun/PrinterController.cs:65` | read only |
| Hand rotation gesture detection | `Assets/Scripts/HandRotationDetector.cs:25` | read only |

## 7. Risks
- **Licence**: MIT is fully permissive and compatible.
- **Language/Runtime Barrier**: Written entirely in C# for Unity engine; cannot be directly linked or compiled into AstraCAD's TypeScript/WebXR architecture. All concepts must be re-engineered.
- **Geometry Fragility**: Mesh CSG lacks analytical precision and produces invalid non-manifold meshes on complex intersections.

## 8. What AstraCAD Can Learn
- **Reality-Aware Tabletop Calibration**: Tactile two-point calibration (`CalibrateWorldCoordinates.cs:46`) allowing users to tap real physical desks with controllers/fingers to anchor the CAD workspace cleanly in room space.
- **Direct Sub-Element Handles**: Corner, edge, and vertex scaling gizmos attached directly to bounding geometry for rapid volumetric adjustments.
- **Physical Fabrication Pipeline**: Incorporating real-time 3D printer status and build-envelope visualization directly into the spatial design environment.
