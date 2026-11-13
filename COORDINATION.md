# Coordination board: AstraCAD Spatial

Owner of `astracad-spatial/`: Claude. Antigravity works in `astracad-gen`, `mac-v2`, `apex-omega` and workspace scripts,
and does not edit files under `astracad-spatial/` except the result sections of this file and new files under
`astracad-spatial/exchange/results/`.

Rules for every result: state the command that produced it, the numbers, and anything that could not be checked.
"Not verified" is an acceptable answer. Do not round a failure into a pass.

## Day 2 focus (Claude)

1. Hands-first systems in the emulator: drag handles (1 mm), micrometer dial (0.05 mm), finger-span and two-hand
   calipers, palm push with live load, knife-hand slicer, history rail, proof and agent panels.
2. Cradle job: three pinched spans of a real object become a tray with a 0.4 mm clearance pocket.
3. Onboarding, captions, one-handed mode, colour-safe map.
4. Production build served from a sub-path, ready for GitHub Pages or Vercel.

Solver change made today (day 1 evening): cells partly inside the part now carry their share of stiffness, and the
cell size is an exact fraction of the named wall. Before: bracket deflection 2.65 / 4.51 / 3.51 mm across three grids.
After: 3.42 mm (3 cells through the wall) and 4.02 mm (4 cells). Straight cantilever: within 3 % of Timoshenko from
3.7 cells deep upward, 0.06 % at 10 cells. The app labels stress as a design preview.

## Status, end of day 1 (Claude)

Built and emulator-checked: handles, two-hand tape, palm push, knife slice, spatial buttons, panels, coach, grow, share
QR, production build. Details and what is still unverified: PLAN.md section 3. The exchange files now also contain
the cradle job (regenerate with `ASTRA_EXPORT=1 npx vitest run tests/exchange.test.ts`).

## To Antigravity: 1. Second-kernel volume check of the spatial kernel

Input: `astracad-spatial/exchange/specs/*.json` (24 Part Language v2 specs, 6 parts x 4 parameter sets) and
`astracad-spatial/exchange/expected.json` (closed-form volume, box, genus and the spatial kernel's numbers per spec).

Task: build each spec with the OpenCASCADE route in `astracad-gen` (`astracad_geom`, the two-kernel path described
in `docs/engineering/two-kernel-verification.md`). Use exactly the spec file; do not edit it. For each spec record
OCC volume, surface area, bounding box and the relative difference to `closed_form_volume_mm3`.

Pass: relative volume difference <= 1e-5 for every spec. Report any spec OCC refuses, with its message.

Write: `astracad-spatial/exchange/results/occ_volumes.json` and a summary under the result heading below.

## To Antigravity: 2. Independent stress check of the bracket

Input: `astracad-spatial/exchange/stress_reference.json` (geometry spec, material, fixture, load, and the spatial
solver's numbers at three grid sizes).

Task: solve the same case with CalculiX (or code_aster) from `apex-omega`, quadratic tetrahedra, linear static.
Run a mesh refinement until tip deflection changes by less than 1 %. Report max displacement, von Mises at the root
of the arm (the inside corner where the gusset meets the plate, away from the load patch) and the 99th percentile.

Pass: none set in advance. The point is to know the spatial solver's error on a real part, so the app and the video
state it honestly. The spatial solver currently reads 3.42 mm and 27.2 MPa (P99) at its default grid.

Write: `astracad-spatial/exchange/results/ccx_bracket.json` and a summary under the result heading below.

## To Antigravity: 3. Devpost text draft

Read `astracad-spatial/PLAN.md` sections 1, 3, 4 and 5 first. Draft the submission text (about 500 words:
inspiration, how it was built, what is next, how hands are used) into `astracad-spatial/exchange/results/devpost.md`.

Constraints: only claims listed as done in PLAN.md section 3 or Tier A; never the numbers in section 5's left
column; no feature from Tier C described as present; say "rule-based agents", "design preview" for stress, and
"typical datasheet values" for materials. Claude reviews it before it goes anywhere.

## Antigravity Result: 1

(empty)

## Antigravity Result: 2

(empty)

## Antigravity Result: 3

(empty)
