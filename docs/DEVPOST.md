# AstraCAD Spatial: Devpost submission text (draft)

Category argued: **Best Productivity Experience.** (The rules allow one prize per entry.)

Items in [brackets] must be confirmed on a Quest before submitting; replace them with what the headset showed.

---

## Tagline

Measure the real thing with your bare hands, shape the part that fits it, prove it holds, and take the file to
your printer. A verified CAD bench on your desk, in the Quest Browser.

## Inspiration

Most things people 3D print are made to fit something real: a phone, a pipe, a shelf, a knob that broke. Today that
means a caliper, a desktop CAD program, a guess at the clearance and two failed prints. We wanted the shortest honest
path from "this object on my desk" to "a part that fits it and will not snap", with nothing in your hands but your
hands, and every number on screen backed by a check you can see.

## What it does

- **Measure the real object.** Hold it between thumb and finger, or pinch both ends with two hands; the reading locks
  when your hands are still and shows its own spread. Calibrate once on a bank card (85.60 mm) and every later reading
  is corrected for your hands and shown as value +/- 2 sigma. Beyond arm's reach, a laser tape uses the headset's
  hit testing against the room.
- **Pull it into CAD.** Trace round the base of a real object and pinch its top: a glowing solid rises out of it and
  lands on the bench as an editable parametric part. Or measure length, width and height and get a cradle with a
  0.4 mm print clearance.
- **Shape it with your fingers.** Pull handles in 1 mm snaps; twist a dial, or swipe your thumb along your index
  finger, in 0.05 mm steps. Draw an outline in the air and pull it up into a solid. Or just say it: "make the arm
  20 mm longer", "double the thickness", "two more bolts", "in aluminium", or in your own words: "a box to keep my
  Raspberry Pi in, 90 by 65 by 30" becomes a verified project box.
- **Real CAD features.** Fillets, shells, sweeps and lofts, each built exactly and verified in closed form: a project
  box with rounded corners and shelled walls, a pull handle swept round two bends (checked by Pappus' theorem), a
  lofted foot (checked by the prismatoid formula). Eleven part templates in all.
- **Prove it.** Every change passes a truth gate: the kernel's volume is compared with a closed-form formula for the
  part (agreement better than 1e-8; the gate refuses anything past 1e-5). Push the part with an open palm and a stress
  preview lights up under your hand; rule-based agents (structure, manufacturing, cost) explain what they see, and
  "make it stronger" lets the structural agent change, rebuild and re-test until the target safety factor holds.
- **See what desktops hide.** Natural frequencies with mode shapes, an ideal-flow preview of where air goes (labelled:
  no wake, no forces), a knife-hand section through the part, a print-in-place hinge that swings to the angle where
  its leaves meet, and an exploded view.
- **Take it with you.** STL, a 3MF with the stress map as colours, a three-view engineering drawing with dimensions,
  a QR code to the part, and a shelf of your saved parts on the desk. Bring a STEP file in from your desktop CAD;
  plain blocks and cylinders become editable.
- **Design together.** Start a room and a partner joins by code from another headset or a phone: one shared part,
  their fingertips shown at your bench.
- **Design anything.** Free design builds a part feature by feature, by voice or from a design strip: boxes,
  cylinders, pockets, bores, holes where your hand ray points, fillets, shells, linear and circular patterns, and
  sketched outlines, with a feature tree beside the part. Everything else (test, explore, slice, export, undo, share
  links) works on a design. Air sketches keep their intent with FreeCAD's constraint solver (planeGCS): square
  corners and equal sides hold, and "this side 40" sets a side.
- **Professional CAD in your hands.** Point at any flat face and say "sketch here": draw on that face and pull it out
  as a boss, cut it in, or revolve it. Chamfer, fillet, shell, mirror, pattern, holes where you point, and "edit
  feature 3" to change any earlier step, with the feature tree beside the part. Point at any edge, straight or curved,
  and say "fillet this edge 3": a rolling-ball fillet that follows tangent edges, and edges filleted one after another
  blend their corner into a sphere. "Round all edges 2" rounds the whole part; "chamfer this edge 2" bevels one.
- **Production parts by voice.** "Gear module 2 with 20 teeth 8 thick bore 6" makes an ISO involute spur gear. "M8
  thread 16 long" makes a threaded rod; "tap m8 15 deep" cuts the thread into a hole. "Draft 3" tapers a boss for
  moulding. "Loft a rectangle 40 by 30 to a circle 20 over 25". "Sweep a circle 8 along 40 up then 30 right, bend
  10" makes a bent pipe or handle. Point at a wall and say "rib 3 thick 20 by 20" to brace it. Point at any face for
  a hole, a counterbore, or an exact rectangle, circle, slot or hexagon.
- **Into your desktop CAD, and back.** "Export step" saves the part as an AP214 solid that SOLIDWORKS, CATIA, Creo
  and Fusion open: flat faces are true planes, and holes, shafts and fillets are true cylinders, so a 10 mm hole
  measures 10 mm there. A test reads every file back with OpenCascade and gets the exact volume. Bring a STEP file in
  and say "make it editable": drill it, add bosses, fillet and chamfer it, and export it again.
- **A real sketcher in VR.** Point at a face, press Sketch, and pick tools from the toolbar: line, rectangle,
  circle, arc, tangent arc, slot, polygon. Pinch to place points; they snap to ends, centres, midpoints and a grid.
  Select two lines and press Perpendicular, or Tangent, or Equal. Smart dimension a line and say "45". The sketch
  tells you when it is fully defined. Fillet a corner, trim, offset an outline, mirror across a centre line, draw
  a spline. Then Extrude, Cut, Revolve about a centre line, Sweep a rod along a sketched path, or Loft to a second
  sketch on an offset plane; FreeCAD's solver runs underneath. A ribbon with
  tabs holds every feature: holes, counterbores, taps, threads, patterns, fillets, chamfers, shell, draft, mirror.
- **Beyond parts: surfaces, sheet metal, weldments.** Pull the control points of a freeform B-spline surface by
  hand. Make a sheet-metal bracket, flange its edges up or down at any angle, and save the flat pattern as DXF for
  the laser, with bend lines and bend allowance. Sketch a frame and turn it into square-tube members with a cut list.
- **Engineering intent.** Drawings carry datums and feature control frames (position, flatness, perpendicularity)
  to ISO 1101, with ISO 2768 general tolerances. Variables and equations drive dimensions ("height equals width
  divided by 3"); configurations switch whole sets of sizes, and a design table lists them.
- **Exact by numbers.** "Sketch 40 right, 20 up, arc 10 left 90, 15 at 135, close, 8 tall" gives every line its own
  dimension. "Drill a 6 mm hole at 12.5, -7" places it exactly. Chamfer any edge, curved or not.
- **Drawings like desktop CAD.** Three views with hidden edges dashed, and an assembly drawing with balloons and the
  parts list. "Convergence study" solves the stress on three grids and tells you how far to trust it.
- **Assemblies and motion.** Insert parts and mate them with the hand ray: pinch a face or a pin on one part, then
  where it goes on another, and it glides into place (coincident, concentric, hinge, slider, gear). An exact clash
  check shows interference in red, an exploded view lifts the parts apart, and a motion study plays keyframes:
  "turn the hinge to 90", "play". Closed loops are solved too: "linkage demo" builds a four-bar that turns through a
  full revolution. Screw mates advance by their pitch, rack and pinion slides as the pinion turns, and any hinge
  or slider can be limited ("limit the hinge 0 to 90"). "Edit part 2" changes a part in place; "bill of materials"
  saves a parts list with masses; "export step" saves the whole assembly. Assemblies are saved, and Share puts the
  whole assembly in the QR code.
- **The Lab.** Explore builds, verifies and stress-tests six variants and marks the best trade-offs. A tip test finds
  the exact centre of mass and the angle the part falls at, with its load resting on it. Point at the part and say
  "make this thicker". Hear the stress rise as you push. A gyroid lattice core behind a solid skin, cut open to see.
  A life-size drilling template stuck on your real wall. Real G-code sliced on the headset (walls, skin, infill,
  time, filament). A ray scan sweeps the hand ray over an object for its rough size. "Make it sleek" reshapes the
  part, then the structure agent keeps it strong.

## How we built it

A static WebXR app on Meta's Immersive Web SDK 1.1, no server. The geometry kernel is Manifold compiled to
WebAssembly, driven by a typed JSON part language; circles are tessellated so their areas are exact, which is what
lets the truth gate hold to 1e-5. The stress preview is a voxel finite-element solver (partial-volume hexahedra,
conjugate gradients) in a Web Worker: a straight cantilever agrees with Timoshenko beam theory within 3 % at three or
more cells through the thickness, and its first natural frequency is within 1.6 % of Euler-Bernoulli. On the wall
bracket, a converged CalculiX solve agrees with ours to 1.3 % in deflection and 0.7 % in stress. (Getting there
was its own story: the first comparison read 23 % stiff, because faces cutting through the middle of a cell
overstate bending stiffness; the grid now lines up with the part's faces.) An independent OpenCASCADE build of 24 test parts matches the closed-form volumes to
1e-15, and our browser kernel matches OpenCASCADE to 2e-9. Flow is a
potential-flow solve on a voxel grid, within 4 % of the textbook sphere solution two cells from the surface. Voice
uses the browser's recogniser where there is one, and otherwise runs Whisper on the device, so audio never leaves
it. Sentences the word rules do not know go to a small on-device language model (all-MiniLM-L6-v2, 23 MB) that
picks the part or action meant; it never supplies numbers, and on 25 sentences it had never seen it got 24 right,
asked on 1 and got none wrong. Fillets, shells, lofts and sweeps are built so they can be checked exactly: a sweep is
one seamless mesh whose inner bend rings are offset so its volume equals Pappus' theorem. The speech and language
models ship with the app, and a service worker keeps everything on the device, so it runs offline once loaded. The
bench is held by a WebXR anchor, and a frame-rate governor raises foveation, drops to 72 Hz and thins effects before
the frame rate can fall. STEP files are read by OpenCASCADE compiled to WebAssembly. Co-design uses WebRTC; a public
broker only introduces the two browsers. 112 automated tests run before every deploy.

## How hands are used

Everything works with bare hands: pinch, pull, twist, push, slice with a flat hand, turn your wrist to see the
feature history on your forearm. Every button also answers a hand ray, gaze-and-pinch on Meta VR Glasses, a
controller, a mouse, and dwell for people who cannot pinch. One-handed mode, a colour-safe stress map, captions on
every sound and large text are in the Access menu.

## The first five minutes, on any headset

A six-step guide starts the first session: pull a handle, turn the dial, measure something real, test the part, take
an agent's fix, save. The one button it wants next carries a soft pulsing amber ring, so nobody hunts through the tool
strip. It never asks for the impossible: when no agent has a fix to offer, that step waits until one does.

The layout reads the headset's real field of view from its projection. On Meta VR Glasses (37 degrees to each side,
25 up) the guide and notices follow your view with a gentle lag, just above its centre, and the side panels shrink a
little and move in until their outer edges fit. Quest 3 keeps the room-fixed layout.

Nothing fails silently. If the geometry worker hangs or crashes it is replaced and the part rebuilt; a crashed
analysis worker is replaced for the next job; a background error is shown once in plain words; a save the browser
refuses (storage full) is reported instead of claimed.

## Challenges

Hand-tracked measurements are good to millimetres, not hundredths, so the app shows each reading's real spread and
lets you calibrate it instead of printing a fixed tolerance. Making a browser solver honest took partial-volume
cells and grid sizes tied to wall thickness; before that, results moved 30 % with the grid.

## What is next

Cones, spheres and B-spline surfaces in the STEP export, feature recognition for imported STEP files (so their own
faces can be re-dimensioned), a stress solver that converges under concentrated loads, supports and bridging in the
slicer, sending G-code to a printer on the network, and the desktop AstraCAD bridge for drawings and production
solvers.

## Built with

Meta Immersive Web SDK, WebXR (anchors, hit test, planes, depth, hands, gaze), three.js, Manifold, OpenCASCADE
(occt-import-js), transformers.js (Whisper tiny, all-MiniLM-L6-v2), ONNX Runtime Web, PeerJS, TypeScript, Vite,
Vitest, GitHub Pages.

## Video

2 minutes 58 seconds, in eleven chapters (scripts/video: film.json is the edit, final2.py composes it). Every shot is
the real app, recorded at 1440 px in Meta's XR emulator (IWER) on a PC, driven by scripted hand and head input; it has
not yet been filmed on a headset. A column beside the footage names each feature, lists what it does, and captions the
narration. Honest markers on screen:

- The voice chapter plays a recorded sentence that is fed to the on-device recogniser, because the emulator has no
  microphone.
- Some chapters skip idle seconds between actions. The vibration solve took 14 s on this PC and is not shown.
- The glasses chapter uses the emulator's Meta VR Glasses device.

Narration is a synthetic voice (Kokoro TTS). The music is original, synthesised for the film. The closing card repeats
the footage disclosure.

## Try it

[Live URL] https://osmiumuas-wq.github.io/astracad-spatial/ (open in the Quest Browser, tap "Enter the bench").
Source: https://github.com/osmiumuas-wq/astracad-spatial

---

Checks before submitting: [frame rate on Quest 3] [voice latency on the headset] [microphone prompt] [hand-measured
accuracy against a ruler] [co-design between two devices]. Do not add claims that are not in PLAN.md section 4b.
