# Task board: AstraCAD Spatial

Owner of everything here: Claude. (13 Nov 2026: the entrant decided no other agent takes part; the tasks that were
written for Antigravity are now Claude's.) 16 Nov 2026: the entrant asked Antigravity to run the multi-repository
integration mission, `docs/integration/MISSION.md`, on `integration/*` branches only, under
`.agents/rules/astracad-quality-bar.md`.

Rules for every result: state the command that produced it, the numbers, and anything that could not be checked.
"Not verified" is an acceptable answer. Do not round a failure into a pass.

## Now (13-14 Nov)

Live: https://osmiumuas-wq.github.io/astracad-spatial/ (deployed from `main` by GitHub Pages; tests run first).

Built so far, with measured numbers: PLAN.md section 4b. Nothing has run on a Quest yet; the entrant's headset pass
(README checklist 1-16) is the most important open item, and only the entrant can do it.

## Open tasks

1. **Devpost text.** About 500 words from PLAN.md sections 4b and 5: inspiration, how it was built, how hands and
   voice are used, what is next. Only claims marked done; never the numbers in section 5's left column; "rule-based
   agents", "design preview" for stress, "typical datasheet values" for materials. Argue one award category (the
   rules allow one prize per entry). Output: `docs/DEVPOST.md`.
2. **Phrase corpus for the command engine.** 120+ sentences a user might say or type, each with the expected parse;
   becomes `tests/phrases.test.ts`; report the hit rate here.
3. **Independent stress check of the bracket.** Input `exchange/stress_reference.json`. Solve with CalculiX if it is
   installed on this PC (quadratic tetrahedra, refine until tip deflection changes < 1 %); compare max deflection
   and P99 von Mises with the spatial solver (3.42 mm, 27.2 MPa at its default grid). Output
   `exchange/results/ccx_bracket.json`.
4. **Second-kernel volume check.** Input `exchange/specs/*.json` and `exchange/expected.json`. Build each spec with an
   independent OpenCASCADE route and compare volumes (pass: <= 1e-5 relative). Output
   `exchange/results/occ_volumes.json`.

## Results

**Task 1, Devpost text: done.** `docs/DEVPOST.md`, argued for Best Productivity Experience; items in [brackets] wait
for the headset pass.

**Task 2, phrase corpus: done.** `tests/phrases.test.ts`, 133 sentences over every part (edits, spoken numbers,
counts, materials, actions, new parts, 10 that must not be understood). First run 126/133 (94.7 %); the misses
showed real gaps ("shorten", "bolt circle 60" read as a count, "bore depth" read as "bore", "plate height" and "swing
the hinge" read as new parts). After fixing the rules: 133/133. The corpus was written by Claude, not collected from
users.

**Task 3, CalculiX stress check: done.** `python scripts/verify/ccx_bracket.py <ccx.exe> <work dir>` with
`solvers/fea/Library/bin/ccx.exe`. Conforming C3D8I hexahedra, refined 552 -> 2 448 -> 8 262 elements; tip
deflection changed 0.6 % at the last step. Holes in the clamped back plate left out; load a uniform pressure on the
stated patch (470.4 mm2).

| | CalculiX (converged) | Spatial solver, default grid (1.33 mm) | Difference |
|---|---|---|---|
| Max deflection | 4.458 mm | 3.419 mm | -23 % |
| P99 von Mises (load patch excluded) | 28.33 MPa | 27.19 MPa | -4 % |

Follow-up (same day): the cause was grid alignment, not the element. The arm's faces (y = 66, 70) fell half a cell
off a grid starting at y = 0, so the arm's outer layers were half-full cells, which overstate bending stiffness
(I = 3h^3 instead of 2.25h^3 for three cells). The stress grid's origin now moves so flat faces land on cell
boundaries, and the element is now the incompatible-mode hexahedron. Result at the default grid: **4.401 mm
(-1.3 %), 28.53 MPa (+0.7 %)**. `tests/ccx-reference.test.ts` keeps it within 5 %.

**Task 4, second-kernel volumes: done.** `<python with OCP> scripts/verify/occ_volumes.py astracad-gen/src` builds
each of the 24 exchange specs with OpenCASCADE (`astracad_geom.occ_build`, imported unchanged). 24/24 within 1e-5 of
the closed form; worst 6.4e-16. The browser's Manifold kernel agrees with OpenCASCADE to within 2.0e-9 on every
spec. (`exchange/results/` is git-ignored; rerun the scripts to regenerate.)
