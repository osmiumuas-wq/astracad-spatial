# AstraCAD Spatial

Measure a real object with your bare hands and get a verified, printable part that fits it. A seated, hands-first
mixed-reality bench for Meta Quest 3 / 3S, built with the Immersive Web SDK (IWSDK 1.1). Entry for the Meta VR Start
Developer Competition 2026, Productivity track. Plan and scope: [PLAN.md](PLAN.md). Task board: [COORDINATION.md](COORDINATION.md).

## What runs where

Everything runs in the browser. No server, no account, no third-party service.

| Part | Where | What it does |
|---|---|---|
| `src/engine/` | Web Workers | Part Language v2 compiler on the Manifold kernel, closed-form checker, truth gate, voxel stress solver, topology optimiser, three rule-based agents, STL and record export, share links |
| `src/app/` | Page | App state (signals), hand tracking maths, bench, part view, canvas UI, synthesised sound, storage |
| `src/systems/` | IWSDK ECS | Hand gestures (handles, dial, calipers, palm push, knife slice, turntable), spatial UI, panels and placement, part display |
| `src/flat/` | Page | The 2D page: entry button, and a full editor for phones and PCs opened from a share link |

## Run it

Needs Node 20.19+ (tested with 24).

```bash
npm install
```

Desktop preview with the XR emulator, over HTTPS (needed for a headset on the same Wi-Fi):

```bash
npm run dev
```

Desktop preview over plain HTTP on localhost, headless managed browser, scriptable from the IWSDK CLI:

```bash
node scripts/dev-http.mjs
```

Engine tests (203 tests: the sketch workbench (tools, relations, dimensions, regions), kernel, closed form, truth gate, beam theory, agents, optimiser, export, FEA against
CalculiX and its convergence study, modal, flow, STEP import and export (true cylinders, imported bodies made
editable), hinge, drawings with hidden lines, assembly drawings, describe, spoken commands, voice, co-design,
calibration, stability, explore, lattice, drilling template, G-code, constraint sketching, typed sketches, ray scan,
style, free design, pro part tools, production tools (gears, threads, draft, lofts, sweeps, ribs, holes on any face),
multi-body closed forms, assemblies, mates and loops, screw, rack and limit mates, edge fillets, rolling-ball
fillets, corner blends and chamfers of any edge):

```bash
npx vitest run
```

Type check and production build (output in `dist/`, works from any sub-path):

```bash
npm run typecheck
```

```bash
npm run build
```

## Hands

| Gesture | Where | Effect |
|---|---|---|
| Pinch an amber handle and pull | Shape | Changes that dimension in 1 mm steps; the part rebuilds and is re-verified |
| Pinch the dial ring and turn | Shape | 0.05 mm per click, with a tick sound |
| Pinch the bench rim and swing | Any | Turns the part |
| Flat hand, edge down, through the part | Shape | Slices it open |
| Hold an object between thumb and finger, keep still | Measure | Finger-span caliper; locks after about a second |
| Pinch both ends with both hands, keep still | Measure | Two-hand tape |
| Pinch one end, then the other, with one hand | Measure | One-handed tape |
| Open palm onto the part, then push deeper | Test | Solves at the contact; load grows with push depth |
| Point and pinch (hand ray), poke the dial buttons, or look and pinch (Meta VR Glasses) | Any | Every button |

Accessibility (Access button): colour-safe stress map, captions for every meaningful sound, sound off, dwell to select
(rest a ray or gaze 1.2 s), large text, high contrast, less motion, left-handed.

## Deploy (GitHub Pages)

1. Push this folder to a public GitHub repository, branch `main`.
2. In the repository settings, set Pages to deploy from GitHub Actions.
3. `.github/workflows/pages.yml` runs the tests, builds, and publishes `dist/`.
4. Open the Pages URL in Quest Browser. The page offers "Enter the bench".

Any static HTTPS host works (Vercel, Netlify). The WebAssembly file must be served as `application/wasm`.

## Headset test checklist (entrant, before recording)

Not verified on a device yet. Everything below was checked only in the IWSDK emulator.

1. Open the URL in Quest Browser, allow hand tracking, enter. The bench should appear about 40 cm in front, at chest
   height, and drop onto a table if one is detected.
2. Pinch a handle and pull: steps of 1 mm, tick sounds, gate stays green.
3. Turn the dial: 0.05 mm per click.
4. Measure: hold a phone edge between thumb and finger; it should lock in about a second. Compare with a ruler and note
   the difference (expect a few millimetres).
5. Test: push the part with an open palm. Note how deep the palm must go before the load starts; tune `PALM_SKIN` in
   `src/systems/interaction-system.ts` if it feels late or early.
6. Grow bone on the wall bracket and time it. Over 30 s means `targetElements` in `src/engine/engine.worker.ts`
   should go down.
7. Watch the frame rate (Meta Quest Developer Hub or OVR Metrics). The rules ask for 60 fps minimum.
8. Try a second room you have not used before.
9. Co-design: tap Co-design, Start a room, then open the join link (or scan the QR) on a phone or PC. Change a
   dimension on each side; both should follow. Then try headset to headset if a second Quest is available.
10. Air flow: tap Air flow on the phone stand; tap again for front wind. Note the frame rate while beads run.
11. Capture: tap Capture, trace round the base of a box on the table with a pinch, then pinch its top. Compare the
    part's size with a ruler.
12. Access, then Real occlusion: hold a hand between your eyes and the part; the part should hide behind it.
    Then Clash check: push the bench into a real object (Bring bench here near it); the part should glow red where
    it is inside the object. Check the frame rate with either on.
13. Measure, then Measure again (it reads Laser): point at a wall and pinch, then at the opposite wall. Compare
    with a tape measure.
14. Drawing: the sheet should spring out of the part and be readable. On the flat page, Download drawing and print it.
15. Talk: tap Talk, say "make the arm twenty millimetres longer", wait. Note how long the first answer takes (the
    model downloads once) and how long later ones take. Try "test it" and "show the drawing".
16. Access, then Calibrate with a card: measure a bank card's long edge three times. Then measure something else and
    check the +/- figure against a ruler.
17. First run: clear the site's data in Quest Browser, enter, and follow the Getting started guide. The button it
    wants next should carry a pulsing amber ring. Note anything that is not obvious.
18. Meta VR Glasses, if available: enter and look at the bench. The guide should float just above the centre of the
    view, and the proof and agent panels should fit either side without being cut off.

## Honest limits

- The Lab tools are previews with stated limits. The lattice core is not stress-tested again (the solver's cells are
  coarser than its walls). The G-code is plain: two walls, solid skins, 20 % infill, no supports or bridging rules;
  check it in your slicer's preview before a long print. The ray scan rests on the headset's surface hits and is good
  to about a centimetre. A free design made of several bodies is kernel-checked; only single bodies have a closed form.
- Assemblies are solved in two passes: each part is first placed against parts already placed, then every part is
  refined together (Levenberg-Marquardt) so closed loops close; a four-bar linkage matches Freudenstein's equation.
  A round surface's axis is fitted from the mesh near the pick. Assemblies are kept in the browser and travel in the
  share link; a link of a large assembly makes a dense QR code.

- Stress results are a design preview: linear statics on a voxel grid, typical datasheet material values. Checked
  against CalculiX on the wall bracket (scripts/verify/ccx_bracket.py, tests/ccx-reference.test.ts): deflection
  within 1.3 % and P99 stress within 0.7 % at the app's grid, whose cells are a fraction of the wall and whose origin
  is moved so flat faces sit on cell boundaries. A grid that cannot line up with the walls reads up to about 17 %
  stiff, which is why the app sizes cells from the wall (now also when the element cap applies). "Convergence study"
  solves the standard load on three grids (three, four and five cells through the wall) and reports the change, a
  Richardson extrapolation when the results move one way, or the spread when they do not. On the wall bracket they do
  not settle (4.40, 4.27, 4.85 mm against CalculiX's 4.458 mm), so the app reports a 13 % spread rather than a
  converged value. These are previews to guide a design, not certified results.
- The headset kernel builds sketches, extrudes, cuts, revolves, holes, patterns, fillets, shells, lofts and sweeps,
  each checked against an exact closed form. Their scope is what can be checked exactly: fillets round the corners of
  an extrusion's outline (the edges along the extrusion), shells hollow an extrusion (corners mitred, hole walls from
  later features not thickened), lofts are ruled through profiles on parallel planes, and sweeps follow a polyline
  whose corners are bends of one radius. Chamfers cut an extrusion's outline corners (exact, closed-form checked);
  mirrors join the body with its copy across a plane (kernel-checked). Any other straight edge between two flat faces
  can be filleted or chamfered by pointing at it (convex edges cut, concave edges filled; the area is checked against
  r^2 (cot(phi/2) - (pi - phi)/2) and d^2 sin(phi)/2 in the tests). Fillets of any edge, straight or curved, are
  rolling-ball fillets: the ball rolls along the edge and every tangent edge after it; fillets picked one after
  another with the same radius form a set, and where their edges meet the corner blends into a sphere patch. "Round
  all edges" rolls the ball over the whole part (a rounded block matches Steiner's formula). Circular rims take an
  exact revolved section (Pappus); other curved edges use a 32-segment ball, within about 1 % of the true blend.
  Chamfers follow any edge chain: straight and circular edges exactly, and any other curve (a slot's rim, a sweep's
  edge) by sweeping the chamfer's section along it, one wedge per segment between matched sections (a slot boss rim
  agrees with the offset formula P d^2/2 - pi d^3/3 to within 3 %; concave edges are filled the same way).
- Production tools in free design: ISO involute spur gears (20 degree pressure angle, checked by the area of their
  own outline), ISO 68-1 metric threads (rods and tapped holes; the thread section swept with a twist, 36 steps per
  turn), draft on bosses (closed form A h (1 + (a + b)/2 + ab/3)), lofts between a rectangle, circle or hexagon,
  sweeps of a profile along a path of straight runs and round bends, ribs that brace a wall from the floor, and
  exact rectangles, circles, slots and polygons sketched on any face. A gear on a plate, a sweep, a boss on a block,
  a mirror whose copy only touches the original: these are checked in closed form, because bodies now start exactly
  on the face they stand on (a picked point is snapped onto the design's exact face planes) and the checker adds
  bodies whose bounding boxes only touch. Threads stay kernel-checked: a twist extruded in steps has no exact
  formula. Gear teeth and thread flanks are faceted, not exact curves.
- The sketch workbench works like the sketcher in SOLIDWORKS, CATIA or NX. "Sketch here" (or the ribbon's Sketch
  button) opens a sketch on the face pointed at, with tools picked from a toolbar: line (chains, closes on its first
  point), rectangle, circle, three-point arc, tangent arc, slot, polygon, select, smart dimension, delete,
  construction and undo. A pinch on the face is a click. Picks snap to points, centres, midpoints and a 1 mm grid,
  and near-horizontal or near-vertical lines become so. Relations: horizontal, vertical, parallel, perpendicular,
  equal, tangent (at a shared end, as FreeCAD does it). Sizes come from Smart dimension, then a spoken number or the
  Size buttons; the sketch shows driving sizes plainly and free ones with "~", and reports its degrees of freedom
  ("fully defined" at 0). FreeCAD's planeGCS solves it. Extrude, Cut or Revolve turns every closed region (an outer
  loop and its holes) into a feature, with exact arcs, checked in closed form. The feature ribbon on the left has tabs
  (Create, Holes, Modify, Output) for sketch, boxes, cylinders, pockets, ribs, gears, holes, counterbores, taps,
  threads, patterns, fillets and chamfers on a pointed edge, round all, shell, draft, mirror, STEP and drawings.
  Not in the sketcher yet: splines, ellipses, sketch fillets, trim and extend, offsets, sketch mirror and patterns,
  and sketches on offset or angled planes.
- Typed sketches give every line its own dimension: "sketch 40 right, 20 up, arc 10 left 90, 15 at 135, close, 8
  tall" (lengths, directions, angles, tangent arcs, then a depth or a cut). Arcs are stored as exact arcs. Features
  can be placed by numbers instead of the hand: "drill a 6 mm hole at 12.5, -7". A pointed position snaps to a 0.5 mm
  grid on its face. Hand tracking itself still reads to a few millimetres; typed numbers are exact.
- STEP export writes AP214 (automotive_design): each part a MANIFOLD_SOLID_BREP rebuilt from the mesh as a face
  graph. Flat faces are PLANEs (holes as inner loops); holes, shafts, bosses and fillets of straight edges are true
  CYLINDRICAL_SURFACEs with LINE and CIRCLE edges. The kernel's area-compensated facets are undone, so a 10 mm hole is
  written as a 10 mm cylinder, and OpenCascade reads back the exact closed-form volume (to 1e-4). Cones, spheres,
  tori and freeform blends (rolling-ball corners, chamfers of curves, gear teeth, threads) stay as small flat faces,
  so the shell is always closed. NURBS freeform surfaces are not modelled.
- Assemblies have coincident, concentric, distance, angle, parallel, hinge, slider, gear, screw (pitch per turn),
  rack and pinion, and limits on any hinge, slider or screw. "Edit part 2" opens a part on the bench with every tool;
  "back to the assembly" puts it back and solves the mates again. "Bill of materials" saves a CSV (item, part,
  material, quantity, mass). "Export step" saves every part where it sits. "Assembly drawing" saves an A4 sheet:
  the assembly in isometric view with hidden lines removed, a numbered balloon on each item and the parts list.
- Hand-tracking measurements are good to a few millimetres, not hundredths. The 0.05 mm dial is an input step, and
  typed or spoken numbers are exact.
- The agents are rule-based expert systems, not language models.
- Capture makes a parametric extrusion of an object's traced footprint and height, not a 3D scan: overhangs,
  tapers and curved tops are not captured. The Quest browser gives web pages no camera image.
- Vibration frequencies come from the same coarse voxel grid as the stress preview (about 2 500 cells); on a
  cantilever they agree with beam theory to about 2 %. They are a design preview, not a modal test.
- STEP files are shown and measured as reference models (a cradle can be fitted round one). "Make it editable" turns
  a block or cylinder into a parametric part, and any other closed solid into the base body of a free design: holes,
  bosses, pockets, fillets and chamfers are added to it, and it exports again as STEP. Its own faces keep their shape
  (they are not turned back into features you can re-dimension), and it is kept for the session. The reader is
  OpenCascade (occt-import-js, LGPL-2.1), downloaded on first use (7.6 MB).
- The drawing shows each view's silhouette with the part's edges over it: visible edges solid, hidden edges dashed
  (sharp edges, and the outlines of curved faces as seen), so blind pockets, counterbores and hole walls are drawn.
  Through-holes are called out with their diameter; blind holes are drawn but not called out.
- "Describe it" and the spoken commands are word rules first. A sentence the rules do not know goes to a small
  on-device language model (all-MiniLM-L6-v2, 23 MB, shipped with the app) that picks which part or action is meant
  from a fixed catalogue; on 25 sentences it had never seen it got 24 right, asked on 1 and got none wrong
  (tests/intents.test.ts). It never supplies numbers: sizes come only from the user's words, and a number it cannot
  place is reported. It cannot hold a conversation or design a part it has no template for.
- On-device voice uses Whisper tiny (English) through transformers.js: the model (about 40 MB) comes from the
  Hugging Face CDN and the WebAssembly runtime from jsDelivr on first use; audio is not sent anywhere. It takes a few
  seconds per sentence on a desktop and longer on a headset.
- The laser tape is only as accurate as the headset's model of the room (millimetres to centimetres).
- The hinge's swing limit is plate-against-plate geometry; friction, print sag and elephant's foot are not modelled.
- The +/- figure on a measurement comes from the user's own card calibration; without calibration only the sample
  spread is shown.
- The air-flow preview is ideal (potential) flow: it shows where air goes and where it speeds up, but it has no
  viscosity, so no wake, no separation, no drag and no lift. The app shows no forces.
- Co-design uses the free public PeerJS broker (0.peerjs.com) to introduce two browsers; it sees the room code and
  the two devices' network addresses, as any WebRTC signalling service does. Part data and hand poses then go directly
  between the devices. No TURN relay is configured, so some strict networks cannot connect; the app says so and
  carries on alone. If the broker is down, co-design is unavailable and everything else works.
