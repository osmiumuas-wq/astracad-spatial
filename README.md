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

Engine tests (35 tests: kernel, closed form, truth gate, beam theory, agents, optimiser, export):

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
    Check the frame rate with it on.
14. Measure, then Measure again (it reads Laser): point at a wall and pinch, then at the opposite wall. Compare
    with a tape measure.
15. Drawing: the sheet should spring out of the part and be readable. On the flat page, Download drawing and print it.
13. Access, then Calibrate with a card: measure a bank card's long edge three times. Then measure something else and
    check the +/- figure against a ruler.

## Honest limits

- Stress results are a design preview: linear statics on a voxel grid, typical datasheet material values. Deflection
  agrees with beam theory to a few percent on simple members; on thin walls the grid size moves results by up to
  about 15 %.
- The headset kernel builds sketches, extrudes, cuts, revolves, holes and patterns. Fillets, shells, lofts and sweeps
  are refused by name and belong to desktop AstraCAD.
- Hand-tracking measurements are good to a few millimetres, not hundredths. The 0.05 mm dial is an input step.
- The agents are rule-based expert systems, not language models.
- Capture makes a parametric extrusion of an object's traced footprint and height, not a 3D scan: overhangs,
  tapers and curved tops are not captured. The Quest browser gives web pages no camera image.
- Vibration frequencies come from the same coarse voxel grid as the stress preview (about 2 500 cells); on a
  cantilever they agree with beam theory to about 2 %. They are a design preview, not a modal test.
- STEP files are shown and measured as reference models (a cradle can be fitted round one); they are not turned back
  into editable features. The reader is OpenCascade (occt-import-js, LGPL-2.1), downloaded on first use (7.6 MB).
- The drawing shows each view's silhouette: holes that go right through are drawn and called out; blind pockets,
  counterbores and hidden edges are not.
- "Describe it" is a fixed set of word rules, not a language model; it asks rather than guesses.
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
