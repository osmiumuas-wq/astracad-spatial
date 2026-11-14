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

Gears and general mates for assemblies, full feature recognition for
imported STEP files, and the desktop AstraCAD bridge for drawings and production solvers.

## Built with

Meta Immersive Web SDK, WebXR (anchors, hit test, planes, depth, hands, gaze), three.js, Manifold, OpenCASCADE
(occt-import-js), transformers.js (Whisper tiny, all-MiniLM-L6-v2), ONNX Runtime Web, PeerJS, TypeScript, Vite,
Vitest, GitHub Pages.

## Video

2 minutes 58 seconds (scripts/video, edit list in scripts/video/edl.json). Two kinds of shot, each labelled on screen:

- REAL APP: the app itself, recorded in Meta's XR emulator (IWER) on a PC, driven by scripted hand and head input. Not
  yet filmed on a headset. The voice scene feeds a synthesised recording of the sentence to the on-device recogniser,
  because the emulator has no microphone. One clip is shortened: the vibration solve took 36 s, and the cut is marked
  on screen.
- RENDER: product shots made in Blender from the STL files the app exported, each part verified by the app's truth gate.

Narration is a synthetic voice (Kokoro TTS). The music is original, synthesised for the film. The closing card repeats
these disclosures and the honest limits: hand measurements are good to millimetres; stress and flow are design previews.

## Try it

[Live URL] https://osmiumuas-wq.github.io/astracad-spatial/ (open in the Quest Browser, tap "Enter the bench").
Source: https://github.com/osmiumuas-wq/astracad-spatial

---

Checks before submitting: [frame rate on Quest 3] [voice latency on the headset] [microphone prompt] [hand-measured
accuracy against a ruler] [co-design between two devices]. Do not add claims that are not in PLAN.md section 4b.
