---
name: astracad-integration-audit
description: Run the AstraCAD Spatial multi-repository integration mission one phase at a time (audit, compatibility, architecture, implementation, verification). Use when asked to integrate, compare or learn from LeapShape, MobileCAD XR, TinkerXR, XR Blocks, onlineCAD or another spatial-CAD repository.
argument-hint: 'phase number (1-5); default 1'
---

# AstraCAD integration: one phase at a time

1. Read `docs/integration/MISSION.md` in full, then `.agents/rules/astracad-quality-bar.md` and `AGENTS.md`.
2. Find the phase: the argument, or the first phase whose deliverables in `docs/integration/` are missing. Never
   run a phase whose previous phase lacks the user's written approval in this conversation.
3. Record the baseline first: `git status`, `git rev-parse HEAD`, then `npm run typecheck`, `npx vitest run` and
   `npm run build`, with their summary lines.
4. Work on the phase's branch only (`integration/phase-1-audit` for Phases 1-3; `integration/<item>` in Phase 4).
5. Produce exactly the deliverables and sections the mission lists for that phase. Every feature claim cites a
   file and line; every licence is read from the LICENSE file at a recorded commit; every number names its command.
6. Before reporting, tick the phase's "done when" checklist in the mission, item by item, and re-run the three
   gates.
7. Report in the quality-bar format (Outcome, Evidence, Changes, Not done / not verified, Decisions for the user),
   then stop and wait for approval. Do not commit to `main`, push or merge.
