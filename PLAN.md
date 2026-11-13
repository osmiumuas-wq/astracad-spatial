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
| 30, 31: WebRTC co-design | Superseded on day 2: the entrant approved the public PeerJS broker. The risk stays (the broker can be down during judging), so the feature fails gracefully and a phone or PC can be the second person |
| 25: sending a print job over Wi-Fi | Judges have no printer; a secure page cannot reach a LAN device |
| Global leaderboard | Needs a server |

## 4b. Revision 3 (day 2): the whole specification, item by item

The entrant asked for all 36 items. Each one is now in one of three states. "Build" items are scheduled; "honest
version" items ship as the nearest thing that is true; "cannot" items are explained in the submission as future work.

| # | Item | State | What ships |
|---|---|---|---|
| 1 | Dual kernel | Honest version | Manifold kernel in the headset; the exported Part Language JSON builds in SOLIDWORKS and OpenCASCADE on the desktop (cross-check task 1 on the board) |
| 2 | Part Language v2 | Done (subset) | Fillet, chamfer, loft, spline, assemblies refused by name in the headset |
| 3 | Truth gate | Done | Gate at 1e-5, measured agreement 3.9e-9 |
| 4 | APEX solvers | Honest version | Voxel FEA in the headset; CalculiX cross-check of the bracket (board task 2) |
| 5, 6 | STEP and drawing reverse engineering | Cannot (headset) | Desktop AstraCAD only; named as the desktop half of the product |
| 7 | Pinch-and-extract | Build | Three measurements make a glowing box rise out of the real object and fly to the bench |
| 8 | Calipers | Done | Live spread shown, never a fixed +/- figure |
| 9 | Cradle inversion | Done | Cradle job with 0.4 mm clearance |
| 10 | Clash with the real world | Build (stretch) | Red where the hologram is behind real surfaces in the depth map |
| 11 | Micrometer dial | Done + build | Dial ring (done); thumb swipes on the index finger, Quest microgestures, step 0.05 mm (build) |
| 12 | Push-pull handles | Done | 1 mm snaps |
| 13 | Knife-hand slicer | Done | |
| 14 | Forearm time travel | Build | Left wrist face-up shows the feature filmstrip along the forearm; bench rail stays as fallback |
| 15 | Seated ergonomics | Done | |
| 16 | Push-to-stress | Done | Load from push depth; linear scaling is exact |
| 17 | Living bone | Done | Re-tested after carving; real timings shown |
| 18 | CFD wind tunnel | Done (honest version) | Ideal-flow streamlines around the part on the bench, side or front wind, labelled "No wake, no forces". Lift and drag numbers would be invented, so none are shown |
| 19 | Kinematic assembly | Cannot in time | Future work |
| 20, 21 | Agents and self-healing | Done | |
| 22 | Air-sketch to solid | Build | Draw a closed outline on the desk, snap to lines and right angles, pull up to extrude; goes through the truth gate |
| 23 | Arc reactor look | Build (polish) | Emissive cyan edges, glass core, heat glow under load |
| 24 | QR hand-off | Done | |
| 25 | Flick to print | Honest version | Drop the part on the desk: real layer outlines sliced by the kernel, layer count and time. No Wi-Fi transmission: a secure web page cannot reach a printer on the LAN |
| 26 | Gaze and pinch | Done (Meta VR Glasses) | Quest 3 has no eye tracking; hand rays and dwell there |
| 27 | One-handed mode | Done | One-hand tape measure included |
| 28 | Colour-blind map | Done | Cividis-like map |
| 29 | Captions | Done | |
| 30, 31 | WebRTC co-design | Build (approved) | Six-digit room code or join link/QR; the free public PeerJS broker only introduces the two browsers. One shared part (job, dimensions, material), turntable angle, heads and fingertips in the part frame; partners sit opposite. Works headset to headset, or headset to phone/PC, so one judge can try it. Fails with a plain message; the rest of the app is unaffected |
| 32 | Desk shelf | Build | Saved parts as miniatures beside the bench, restored each session |
| 33 | Daily challenge | Done (local) | No global leaderboard: needs a server |
| 34 | Materials incl. Grade 5 titanium | Done | Typical values, labelled as typical |
| 35 | Uncertainty | Done | Measured spread, not +/- 0.2 mm |
| 36 | 3MF with stress colours | Build | 3MF export with per-triangle colours from the last solve |

Build order: 11 (microgestures), 7, 36, 14, 32, 25, 22, 18, 23, 10, then 30-31 if approved.

Day 2 progress (emulator-checked through the IWSDK CLI unless noted):

| # | Result |
|---|---|
| 11 | Thumb microgestures: tap picks the dimension, 3 forward swipes +0.15 mm, right swipe +1 mm |
| 7 | Tape, tape, span locked 80, 45, 78.8 mm; the glowing object box flew into an 84.8 x 49.3 mm cradle |
| 36 | 3MF with stress colours; an independent Python reader recomputes the kernel volume exactly, 0 open edges (unit test) |
| 32 | Saved parts stand as miniatures on a ledge behind the bench; ray and pinch loads one |
| 25 | Bracket sliced into 350 real layers (0.2 mm), built up on the bench, printed left end down, about 22 min |
| 14 | Left palm up shows the feature filmstrip on the forearm; a fingertip touch rolled the cradle back to 3 of 5 |
| 22 | A drawn L became a 6-corner outline (58 x 44.5 mm for 60 x 45 drawn), pulled up to 43 mm, gate verified |
| Fixed | Switching parts threw in the flat page and aborted the switch; persistent XRAnchor moved the bench out of view (removed); caliper window broke at high frame rates |
| 30, 31 | Two browser tabs over the real PeerJS broker: room opened, joined by code, part synced both ways with a "Partner: ..." caption, simultaneous edits converged (host wins a tie), guest seated opposite (head at z -0.52 in the host's part frame), turntable angle followed (+pi for the guest), leave returns the host to waiting, a wrong code says "No room with that code". Not yet run: join by link, partner hands in XR (needs two XR sessions), two headsets |
| UI | Liquid-glass theme on the flat page (frosted rounded cards, blue-violet field, Inter Tight + JetBrains Mono) and on every headset panel and button (glass gradient, bright rim, pill buttons, blue selected state); panels pop forward when a new result arrives (off under Less motion) |
| Capture | Pull a real object into CAD: trace its base with a pinch, pinch its top; a glowing solid rises out of it and flies to the bench as an editable parametric part (outline corners + height), truth gate verified. Emulator: traced 70 x 40, top 55 mm up, got 69 x 40 x 55 mm. It is a footprint extrusion, not a 3D scan; the Quest browser gives pages no camera image (search, Nov 2026) |
| 35 | Calibration with a bank card (85.60 mm, ISO/IEC 7810): 3 readings give the person's bias and scatter per method; later readings are corrected and shown as value +/- 2 sigma. Live page check: readings 88.1, 87.4, 88.4 gave +2.4 mm bias, 0.5 mm scatter; a later 52.0 became 49.6 +/- 1.3 mm |
| 4 (part) | Vibration: three lowest natural frequencies and mode shapes, held by the job's fixture (lumped mass, inverse iteration with M-orthogonal deflation on the voxel model). Steel cantilever 100 x 10 x 10: 828.7 Hz vs 815.4 Hz Euler-Bernoulli (+1.6 %). Wall bracket on the live page: 409 / 1484 / 1763 Hz in 12 s on a desktop (3 439 cells); the part swings in each mode, slowed down |
| 5 (part) | STEP import (OpenCascade via occt-import-js, LGPL, 7.6 MB, loaded on first use): a 60 x 40 x 20 block reads 48.00 cm3 exactly, a 25 x 100 shaft within 0.5 % (chords); laid flat, a cradle is fitted round it and the model sits in the pocket as violet glass. Reference only: not turned back into features |
| 19 | Print-in-place hinge: two separate bodies (leaf A with pin, leaf B bored round it, every gap = clearance), truth gate extended to N bodies, verified for the default and 25 random sets. Swing turns leaf B about the pin until the plates touch: 180 - 2 atan(R / (R + c)) degrees, matched to 0.1 deg by separating-axis sweep; default opens 100.3 deg each way, contact shown in red. Shown in emulated XR |
| 33 | Global leaderboard: skipped (entrant decision, 13 Nov) |
| UX | Undo / redo of job, dimensions and material (a drag is one step); tool strip, flat page, Ctrl+Z / Ctrl+Y; tested in unit tests and on the dev page |
| Drawing | Three-view A4 engineering drawing (third-angle) from kernel silhouettes: exact overall dimensions from the closed-form box, through-hole callouts with exact diameters (flange: 4x 5.2 and 22 THRU), parameters and title block. SVG download; in the headset the sheet springs out of the part (shown 1.6x A4). Blind features and hidden lines are not drawn |
| Describe | "Describe it": rule-based text to part (no AI service), clause-local dimension words, A x B x C, M-size clearance, material; asks for every missing key size. Live page: bracket sentence built exactly; "a cradle please" asked L, W, H |
| Laser | Laser tape: Measure pressed again switches to WebXR hit tests along the hand ray; two pinches measure between real surfaces and bind to the selected dimension. Emulator: floor points aimed 600 mm apart read 597 mm (the rug is 6 mm up) |
| 23 | Bench look: cyan rim light at grazing angles and glowing cyan edges on the part; stressed areas glow hotter from a third of yield to full at yield (shown on the wall bracket at 85 % of yield in emulated XR) |
| 10 (part) | Real occlusion (Access): IWSDK depth sensing hides the part behind real hands and objects. Emulator supplies GPU depth and the part shader recompiles with occlusion; off by default until checked on a headset. A red clash tint is not built |
| UI | Tool strip regrouped into four rows of at most five (about 0.31 m wide, was 0.42 m) |
| 5 (part) | STEP import also checked in the production build (served over HTTP by scripts/preview-http.mjs): shaft 48.96 cm3 against the exact 49.09 |
| 18 | Ideal (potential) flow solved on a 75 000-cell voxel grid in about 0.2 s, bench treated as a wall; 66 streamlines with speed-coloured beads, labelled "No wake, no forces". Check against the textbook sphere: within 4 % two cells from the surface, 1 to 2 % further out; same air through every cross-section within 3 % (unit tests). Shown in emulated XR from the tool strip |


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
