# Prompt to paste into Antigravity

Open the `astracad-spatial` folder as the workspace (Antigravity then loads `AGENTS.md` and
`.agents/rules/*.md` by itself), set terminal and file changes to "review" mode, and paste:

---

Run the AstraCAD Spatial integration mission, Phase 1 only.

Read `docs/integration/MISSION.md` completely, then `.agents/rules/astracad-quality-bar.md` and `AGENTS.md`, and
follow them exactly; use the `astracad-integration-audit` skill. Create the branch `integration/phase-1-audit` from
`main`. Record the baseline (commit hash, `npm run typecheck`, `npx vitest run`, `npm run build`). Clone the
candidates into `../integration-candidates/` as the mission shows, and write one audit file per candidate plus one
for AstraCAD itself under `docs/integration/audit/`, with all eight sections, file-and-line evidence for every
feature, and each licence read from its LICENSE file at a recorded commit.

Do not change anything outside `docs/integration/`, do not install dependencies in this repository, and do not
commit to `main`, push or merge. Ask me which "onlineCAD" I mean before auditing it.

When the mission's Phase 1 "done when" checklist is fully ticked and the three gates still pass, report in the
quality-bar format (Outcome, Evidence, Changes, Not done / not verified, Decisions for me) and stop.

---

After each phase, read the report and the files, then reply "Phase N approved" (or ask for changes) before the
next phase.
