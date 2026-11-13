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
  20 mm longer", "double the thickness", "two more bolts", "in aluminium".
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
it. STEP files are read by OpenCASCADE compiled to WebAssembly. Co-design uses WebRTC; a public broker only
introduces the two browsers. 81 automated tests run before every deploy.

## How hands are used

Everything works with bare hands: pinch, pull, twist, push, slice with a flat hand, turn your wrist to see the
feature history on your forearm. Every button also answers a hand ray, gaze-and-pinch on Meta VR Glasses, a
controller, a mouse, and dwell for people who cannot pinch. One-handed mode, a colour-safe stress map, captions on
every sound and large text are in the Access menu.

## Challenges

Hand-tracked measurements are good to millimetres, not hundredths, so the app shows each reading's real spread and
lets you calibrate it instead of printing a fixed tolerance. Making a browser solver honest took partial-volume
cells and grid sizes tied to wall thickness; before that, results moved 30 % with the grid.

## What is next

Gears and general mates for assemblies, a red clash highlight from the depth map, full feature recognition for
imported STEP files, and the desktop AstraCAD bridge for drawings and production solvers.

## Built with

Meta Immersive Web SDK, WebXR, three.js, Manifold, OpenCASCADE (occt-import-js), transformers.js (Whisper), PeerJS,
TypeScript, Vite, Vitest, GitHub Pages.

## Try it

[Live URL] https://osmiumuas-wq.github.io/astracad-spatial/ (open in the Quest Browser, tap "Enter the bench").
Source: https://github.com/osmiumuas-wq/astracad-spatial

---

Checks before submitting: [frame rate on Quest 3] [voice latency on the headset] [microphone prompt] [hand-measured
accuracy against a ruler] [co-design between two devices]. Do not add claims that are not in PLAN.md section 4b.
