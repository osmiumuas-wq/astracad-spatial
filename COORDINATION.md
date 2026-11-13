# Task board: AstraCAD Spatial

Owner of everything here: Claude. (13 Nov 2026: the entrant decided no other agent takes part; the tasks that were
written for Antigravity are now Claude's.)

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

(none yet)
