# Audit: MobileCAD XR

## 1. Identity
- **Repository URL**: https://github.com/LucasCoraca/mobilecad-xr
- **Commit Audited**: `d6986bf9a7df2f57c08d8e5315b4ff319d790212` (Sat Nov 14 23:07:14 2026 -0500)
- **Licence**: GPL-3.0, verified from `LICENSE` (lines 1-674). Copyleft license: study only. Cannot be copied or adapted into AstraCAD Spatial unless the user chooses to license AstraCAD under GPL-3.0.
- **Activity**: Active; last pushed November 2026 by Lucas Coraca.
- **Maturity**: Working native application with Android Quest 3 packaging and a standalone desktop test bench (`desktop/main.cpp`) featuring headless autotests (`--autotest`) and visual screenshot verification.

## 2. Stack
- **Languages**: C++ (C++17/20), Python (conversion scripts in `tools/`), Kotlin/Gradle (Android wrapper).
- **Frameworks & Runtimes**: Android OpenXR NDK (`XR_EXT_hand_tracking`, `XR_FB_hand_tracking_aim`, `XR_EXT_hand_interaction`), OpenGL ES 3.2, Linux Monado OpenXR runtime for desktop simulation, GLFW/GLX.
- **Build System**: CMake, Gradle (Android).
- **Test System**: Custom in-tree automated test runner in `desktop/main.cpp` (`--autotest`, `--walk`, `--sheets`, `--ui`).
- **Target Runtime**: Native Android OpenXR on Meta Quest 3, Monado on Linux.

## 3. Geometry
- **Kernel**: OpenCASCADE / FreeCAD PartDesign kernel embedded via the `mobilecad` submodule.
- **Precision**: Double-precision analytical CAD geometry with parametric history.
- **Modeling Paradigm**: Full feature-based parametric CAD (pad, pocket, revolve, groove, fillet, chamfer, assembly joints, sketch constraints).
- **File Formats**:
  - In: `.mcxr` scene bundles exported by `tools/export_scenes.py` containing glTF meshes, BRep topology, feature tree.
  - Out: Native FreeCAD documents (`.FCStd`), STEP, STL.

## 4. XR and Input
- **API**: Native OpenXR via `core/xr_session.cpp:456`.
- **Hand Tracking**: Detailed joint processing in `core/hands.h:1` and `core/hands.cpp:25` (`XR_EXT_hand_tracking`):
  - Pinch (thumb + index) -> trigger / tap / drag (`core/hands.h:3`).
  - Pinch (thumb + middle) -> context menu B/Y (`core/hands.h:4`).
  - Fist held >0.15s -> grip (`core/hands.h:5`).
  - Two fists -> scale and turn (`core/hands.h:6`, `core/interaction.cpp:495`).
  - Index finger on window -> direct poke touch (`core/hands.h:8`, `core/interaction.cpp:55`).
- **Ray Origin**: Shoulder-point ray casting (`core/hands.cpp:10`, `shoulderPoint`) projecting rays from an estimated shoulder position through the hand, eliminating unnatural wrist swivel.
- **Synthetic Hands**: `core/hands.cpp:81` (`syntheticHand`) creates deterministic joint sets for automated headless CI/test simulation.
- **Build Plate**: Virtual tabletop on FreeCAD XY plane with grid and axes (`core/interaction.cpp:66-87`). Carried by its rim with wrist-turn level locking, or slid via ray trigger.
- **True Size Mode**: 1:1 mm scale toggle (`core/interaction.cpp:103`).
- **Walk / Teleport Mode**: Teleport arc navigation with ground and building slab collision detection for architectural exploration (`core/interaction.cpp:139-188`).
- **UI Compositor Layers**: Multi-sheet compositor quad layers (`Sheet` struct in `core/interaction.h:58`, `core/interaction.cpp:316`) rendering UI panels straight at display resolution for razor-sharp text.

## 5. Architecture
- **Module Boundaries**:
  - `core/`: OpenXR session management (`xr_session.cpp`), input/gesture abstraction (`hands.cpp`), spatial interaction state machine (`interaction.cpp`), OpenGL renderer (`renderer.cpp`), scene graph (`scene.cpp`).
  - `desktop/`: Headless and desktop simulator using Monado and simulated hand joints.
  - `android/`: Quest 3 APK harness.
- **Decoupling**: The interaction subsystem does not depend on Android or OpenXR headers; it consumes generic `HandInput` structures.

## 6. Features
| Feature | Implementation File & Line | Status |
| --- | --- | --- |
| Shoulder ray estimation | `core/hands.cpp:10` | read only |
| Hand gesture recognition & hysteresis | `core/hands.cpp:25` | read only |
| Synthetic hand joint emulator for tests | `core/hands.cpp:81` | read only |
| Virtual build plate tabletop & rim handles | `core/interaction.cpp:66-87` | read only |
| True size 1:1 mm scale toggle | `core/interaction.cpp:103` | read only |
| Walk mode & parabolic teleport arc | `core/interaction.cpp:139-188` | read only |
| Floating scale badge with mode buttons | `core/interaction.cpp:208` | read only |
| Multi-sheet compositor quad layers | `core/interaction.cpp:316` | read only |
| Direct fingertip window poke | `core/interaction.cpp:55`, `core/hands.h:8` | read only |
| Two-handed model scale and rotation | `core/interaction.cpp:495` | read only |
| Headless screenshot & autotest runner | `desktop/main.cpp:42` | read only |
| glTF scene and BRep mesh loader | `core/gltf_model.cpp:15` | read only |
| Native OpenXR session event pump | `core/xr_session.cpp:456` | read only |

## 7. Risks
- **Licence**: GPL-3.0 copyleft prohibits copying code into AstraCAD Spatial without relicensing the entire repository under GPL-3.0.
- **Security**: Native C++ pointer manipulation, GLX/EGL context management.
- **Maintenance**: Native C++ codebase requires Android NDK, CMake, and Monado; cannot run directly inside WebXR browsers without architecture rewrites.

## 8. What AstraCAD Can Learn
- **Shoulder-Origin Ray Casting**: `shoulderPoint(head, left)` in `core/hands.cpp:10` produces far more stable pointing rays than raw wrist-aim poses, preventing ray jitter during fine pinching.
- **Build Plate Tabletop Paradigm**: Anchoring the model to a physical-like build plate with rim manipulation handles provides intuitive spatial orientation.
- **Synthetic Hand Emulation**: `syntheticHand` in `core/hands.cpp:81` is a powerful testing pattern for automated regression verification of hand gestures without physical headsets.
- **True-Size Scaling**: Switching instantly between tabletop scale and 1:1 physical millimeter scale gives immediate spatial scale perception.
