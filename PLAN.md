# AstraCAD Spatial: plan for the Meta VR Start Developer Competition 2026

Revised 2026-11-13 (day 1, evening) after the grand specification was issued.
Submission closes **2026-11-18 12:00 PT (2026-11-19 01:30 IST)**.

## 1. What the rules allow us to win

- **One prize per entry.** Official rules, section 7: "Limit one (1) prize per Entry." The FAQ adds that an entry in
  the running for several prizes gets the highest one. A sweep is not possible. The largest prize we can win is Best
  Productivity Experience: 70 000 USD (runner-up 35 000 USD). The special awards (25 000 USD each) are a second
  chance if the track prize goes elsewhere, not extra money on top.
- Four criteria, 25 % each: innovation, experience design, technical implementation, polish and presentation.
- Judges test on Quest 3 / 3S, alone, for a few minutes. They need not watch more than 3 minutes of video.
- The video must "honestly represent the experience". False or misleading content is a ground for disqualification.

So the strategy is depth, not breadth: one loop that works every time, in any room, with nothing staged. Breadth
only counts where it costs little and is real.

## 2. Architecture (unchanged)

A static, client-only WebXR app built on IWSDK 1.1. The engine was written for this entry and runs in Web Workers:
Part Language v2 compiler, Manifold mesh kernel (540 KB WebAssembly), closed-form checker, truth gate, voxel
finite-element solver, topology optimiser, three rule-based agents, exporters. No server. SOLIDWORKS, OpenCASCADE,
CalculiX, OpenFOAM and Chrono stay on the desktop; the headset exports the same Part Language JSON they read.

## 3. Where the build stands (measured, end of day 1)

| Area | State | Evidence |
|---|---|---|
| Kernel, closed form, truth gate | Done | 156 builds (6 parts x 26 parameter sets): worst volume difference 3.9e-9; gate tolerance 1e-5 |
| Stress solver | Done, preview grade | Partly filled cells and wall-sized grid since the evening fix. Cantilever: within 3 % of Timoshenko from 3.7 cells deep, 0.06 % at 10. Bracket deflection 3.42 mm (3 cells per wall) vs 4.02 mm (4 cells): about 15 % grid sensitivity on thin walls |
| Agents | Done | Bracket at 120 N: factor 1.14, 1.54, 2.17, each re-tested. Marcus never proposes a wall Elena would reject |
| Topology optimiser | Done | 19 s for the cradle in the headless emulator browser; not timed on a Quest |
| Cradle job (fit a tray to a measured object) | Done | Passes the truth gate on 26 random parameter sets |
| Exporters, share link | Done | STL volume matches the kernel to 1e-5; link opens the exact part from a production build on a sub-path |
| Flat page | Done | Editor, gate, test, agents, QR, shelf; narrow-screen layout |
| Handle drag | Emulator-verified | Pinch and pull 30 mm: cradle length 75 to 149 mm, gate still verified |
| Dial | Emulator: appears and steps by buttons | Twist gesture not yet driven in the emulator |
| Two-hand tape | Emulator-verified | 90.0 mm locked and bound; prompt moved to the next dimension |
| Finger span, one-hand tape | Written, not yet driven | |
| Palm push | Emulator-verified | Touch runs a solve at the contact; 3.5 mm deeper gives 9 N |
| Knife-hand slice | Emulator-verified | Clip plane follows a vertical flat hand inside the part |
| Spatial buttons | Emulator-verified with a controller ray | Hand-ray and gaze paths not yet driven |
| Placement on a table | Written, not verified | The emulator room reported no table plane in range |
| Shelf of saved parts in the room | Not built | Saved parts appear on the flat page only |
| Depth occlusion, ghost-hand onboarding | Not built | Coach panel with six text steps exists |
| Production build | Done | 3.9 MB (about 1 MB gzipped), served from a sub-path with the right wasm type |
| Device test | Not done | No headset run yet |

35 engine tests pass. Gesture checks are emulator runs driven from the IWSDK CLI (`scripts/probe/`), not unit tests.

## 4. Grand specification, triaged

### Tier A: ships (the core loop)

| Spec item | What ships | Honest wording |
|---|---|---|
| 1, 2, 3 | Client-side kernel, Part Language v2 subset, truth gate | The headset kernel refuses fillet, loft, shell and sweep by name; they build on the desktop |
| 8, 35 | Finger-span and two-hand calipers | Shows the measured spread of the samples. Never a fixed "+/- 0.2 mm": hand tracking is good to millimetres |
| 7, 9 | "Cradle": three pinched spans make a box the size of the real object, and a tray with a 0.4 mm clearance pocket for it | A bounding box, not a scan of the object's shape |
| 11, 12 | Handles in 1 mm steps; micrometer dial in 0.05 mm steps | 0.05 mm is the input step, not a measuring accuracy |
| 13, 14 | Knife-hand slicer; feature-history rail on the bench | Rail first. The forearm version only if a device test shows no clash with the system palm menu |
| 15 | Seated, two-foot reach | |
| 16 | Palm push with live load scaling | Linear statics, so scaling one solve with the load is exact |
| 17 | Living bone | Stiffer than the same mass spread evenly; lighter and less stiff than the solid. Re-solved after carving |
| 20, 21 | Marcus, Elena, Viktor; one-pinch fix with re-test | Rule-based expert systems, not language models |
| 10 (part) | Real hands and objects occlude the hologram (IWSDK depth occlusion) | |
| 23 | One visual language: dark glass, cyan line work, amber handles | |
| 24 | QR link that rebuilds the part on a phone or PC | Parametric parts only; a grown shape is too large for a link |
| 26, 27, 28, 29 | Gaze and pinch, one-handed use, colour-safe map, captions | Quest 3 has no eye tracking: gaze works on Meta VR Glasses, hand rays on Quest |
| 32, 33 | Shelf anchored to the desk; a daily job with a personal best | No global leaderboard: that needs a server |
| 34 | Materials with typical datasheet values, including Ti-6Al-4V | "Typical", not "verified" |

### Tier B: stretch, in this order, only after Tier A works on a device

1. Air-sketch: draw a closed outline on the desk, pull it up into a solid. Snapping is geometric rules, not a neural
   network. The result goes through the same truth gate.
2. Print preview on the desk: real layer outlines sliced by the kernel. No transmission to a printer.
3. Clash highlight: red where the hologram sits inside real geometry, from the depth map.
4. Stress colours in an exported file.
5. Thumb-roll as a second way to turn the dial.

### Tier C: not in this entry

| Spec item | Why |
|---|---|
| 4: CalculiX, OpenFOAM, Chrono, SOLIDWORKS, OpenCASCADE in the headset | Native programs. They run on the desktop only |
| 5, 6: STEP and drawing reverse engineering | Desktop Python. Not part of the judged build |
| 18: particle wind tunnel with lift and drag in newtons | A real flow solver does not fit the frame budget. Invented force numbers would be false content |
| 19: kinematic assemblies | A second product. Future plan |
| 30, 31: WebRTC co-design | A six-digit code cannot carry a WebRTC offer; it needs a signalling service. That service can fail during three weeks of judging, and one judge with one headset cannot see the feature |
| 25: sending a print job over Wi-Fi | Judges have no printer; a secure page cannot reach a LAN device |
| Global leaderboard | Needs a server |

## 5. Numbers in the directive that must not be used

| Claim | Measured | Use instead |
|---|---|---|
| Truth gate "< 1e-9" | Tolerance is 1e-5; worst seen 3.9e-9 | "Agrees to better than 1e-8; gate at 1e-5" |
| "125 sweeps, worst 1.85e-9" | 130 builds, worst 3.9e-9 | The measured figures |
| "+/- 0.2 mm tracking confidence" | Not measured; implausible for hand tracking | The live sample spread |
| "6x stiffer, 50 %+ lighter in 8 s" | 6x stiffer than the same mass spread evenly; 36 % lighter than the solid; 9 s on a desktop | Those words, plus the re-solved safety factor |
| "Re-runs FEA in 300 ms" | 0.2 to 2.7 s on a desktop at 6 000 cells | The time the app shows |
| "0.05 mm machine tolerances with bare fingers" | 0.05 mm is the dial step | "0.05 mm steps" |
| "Hands-first systems tested" | Not built yet | Nothing, until they are |

## 6. The experience (about four minutes)

1. Enter. A bench appears at chest height and snaps to a real table if one is detected.
2. A ghost hand shows each gesture once.
3. Pinch both sides of a real object. The caliper locks with its spread.
4. Bind it. The clip, stand or cradle resizes to fit.
5. Drag for millimetres, twist for hundredths.
6. The truth gate shows closed form against kernel, or refuses with the reason.
7. Three agents report. One pinch applies a fix; the agent re-tests it.
8. Push with an open palm. Push deeper and the stress map follows.
9. Slice with a flat hand. Scrub the history rail.
10. Scan the QR code. The part joins the shelf on the desk.

## 7. Video (under 2 min 50 s, real footage only)

Rule: every shot is the submitted build doing what it does. Every number on screen is read from the app during that
take. A side camera shows bare hands. No shot of a feature in Tier C.

| Time | Shot | Line |
|---|---|---|
| 0:00 | Bare hands pinch both sides of a real phone; the caliper locks; a stand grows on the desk | "Measure the real thing with your hands. Get the part that fits." |
| 0:20 | Drag a handle in 1 mm clicks; twist the dial in 0.05 mm ticks; truth gate turns green | "Millimetres by hand, hundredths by dial. Every part is checked against closed-form maths." |
| 0:45 | Open palm pushes the bracket; it bends, the map runs to red, the crack sounds | "A real finite-element solve under your palm." |
| 1:05 | Marcus flags it; one pinch; gusset grows; re-test; factor shown | "The agent fixes it, then proves its own fix." |
| 1:30 | Living bone grows; knife hand slices it | "Material leaves where it carries nothing." |
| 1:55 | Phone scans the QR; STL opens; part goes to the shelf | "No server. The link is the part." |
| 2:15 | Colour-safe map, captions, one hand in the lap with a far pinch | "Built to be used by everyone." |
| 2:35 | Title, URL | "AstraCAD Spatial. Open it in your Quest Browser." |

Capture settings for the Quest (entrant runs these): `adb shell setprop debug.oculus.capture.width 2560`,
`...height 1440`, `...bitrate 30000000`, `...fps 60`.

## 8. Schedule

| Day | Date | Work |
|---|---|---|
| 1 | Nov 13 | Engine and tests (done). Flat page (running). XR systems started |
| 2 | Nov 14 | Handles, dial, calipers, panels, push, slicer, rail in the emulator. Cradle job. First headset run if a device is available |
| 3 | Nov 15 | Device fixes. Onboarding, sound, shelf, daily job, accessibility. Production build on a sub-path |
| 4 | Nov 16 | Tier B items 1 and 2 if Tier A is solid. Deploy. Record |
| 5 | Nov 17 | Buffer. Fresh-room test. Submit a day early |

After the deadline nothing may change until winners are announced (about Dec 11).

## 9. What only the entrant can do

1. Meta VR Start membership and Developer Access before submitting.
2. Join the hackathon on Devpost.
3. Choose the division. This WebXR app was written from scratch on 2026-11-13. If AstraCAD as a project began before
   2026-09-24, choose "Adapted / Significantly Updated". Do not guess: the sponsor can re-assign or disqualify.
4. A public HTTPS URL that stays up until Dec 11.
5. The video, public, under three minutes.
6. A headset test. The rules do not require one; hand tracking, depth and anchors still differ from the emulator.

## 10. Rules the build never breaks

1. Every number on screen is computed. Missing is shown as missing.
2. Nothing is called tested until a test or a device run shows it.
3. Hand tracking is the only input the app needs.
4. Optional device features never block the session.
5. Heavy work runs in a worker. No per-frame allocation in update loops.

No plan can promise a prize. This one spends every hour on what the rules say is scored.
