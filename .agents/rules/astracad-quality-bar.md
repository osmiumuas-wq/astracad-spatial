---
trigger: always_on
description: The working standard for every task in AstraCAD Spatial - evidence, verification gates, honest reporting, git safety and byte-exact files.
---

# AstraCAD Spatial: the quality bar

This repository is a WebXR CAD app (IWSDK, Manifold kernel, a closed-form truth gate) that has been built and
verified to a strict standard. Every task you do here must meet that standard. When this file and a task prompt
disagree, this file wins; ask the user.

## 1. Evidence, not claims

- Every statement about the code or its behaviour cites where it comes from: a file and line
  (`src/engine/kernel.ts:214`), a command you ran and its output, or a URL you read. Nothing from memory.
- Every number has a source: the command that produced it, the input, and the unit. "Faster" means
  "41.2 s -> 1.0 s on the box-plus-boss case, `npx vitest run tests/round.test.ts`".
- "Not verified" is an acceptable answer. Never round a failure into a pass, a partial into done, or a guess into a
  fact. If a test fails, report the failing test name and the decisive error line, verbatim.
- Never claim anything works on a Meta Quest or Meta's glasses without a test on the device. The emulator (IWER)
  proves the app renders and responds to emulated input; it does not prove headset performance, tracking or comfort.
- When you read another repository, quote only short fragments; summarise in your own words. Record its licence
  from its LICENSE file, not from a README, a badge or a third-party site.

## 2. The verification gates

Run all of these before reporting any change as done, and paste the summary lines in your report:

| Gate | Command | Baseline on `main` (16 Nov 2026) |
| --- | --- | --- |
| Types | `npm run typecheck` | clean, no output |
| Tests | `npx vitest run` | 46 files passed, 2 skipped; 242 tests passed, 2 skipped |
| Build | `npm run build` | builds (one chunk-size warning is expected) |

A change that lowers the passing count, adds a type error or breaks the build is not done. A new feature comes
with tests that would fail without it. Geometry changes keep the truth gate's verdicts: a part that was
`verified` stays `verified` (closed form and kernel agree to about 1e-9 relative); never loosen a tolerance to
make a check pass.

For anything the browser shows, also check it in the running app (`npm run dev`, then the IWSDK CLI or the
browser) and say exactly what you observed. Read `AGENTS.md` at the repository root first: this is an IWSDK
project, and several things do not work the way a normal Vite project works.

## 3. Do not break what exists

- The Manifold kernel (`manifold-3d`), the Part Language v2 compiler (`src/engine/`), the truth gate
  (`src/engine/truth.ts`, `src/engine/expect.ts`) and the IWSDK architecture are the core. Do not replace,
  wrap away or duplicate them. New capability enters through an adapter with a typed interface and its own tests.
- Never delete a feature, a test or a check to make something pass.
- Keep the user-facing words honest: stress results are a "design preview", materials are "typical datasheet
  values", the agents are "rule-based agents".

## 4. Git safety

- Work on a branch named for the task (for example `integration/phase-1-audit`). Never commit to `main`, never
  push, never merge, never force-push, never rewrite history, unless the user has said so for that specific action
  in this conversation. Approval for one push is not approval for the next.
- Commits: one logical change each, a subject line that says what changed, a body that says why and what was
  measured. Do not commit `node_modules`, `dist` or `artifacts`.
- Before deleting or overwriting any file, read it.

## 5. Files are byte-exact

- The repository is `* -text`: Git does not convert line endings. Write every text file with LF (`\n`) line
  endings and UTF-8, exactly as the existing files are. In Python, open files with `newline='\n'`; never use a
  Windows default that writes CRLF. Check with `git diff --stat` that you changed only the lines you meant to.
- Never touch the repository or folder named `mecagent-alternative`.

## 6. Licences and other people's code

- AstraCAD Spatial has no licence file yet: the code is all rights reserved. Code under MIT or Apache-2.0 may be
  adapted with its copyright notice kept and the licence recorded in `THIRD_PARTY_NOTICES.md`. Code under GPL,
  LGPL, AGPL or with no licence may be studied but not copied or adapted; reusing it would need the user to choose a
  licence for the whole project, which is the user's decision, not yours. Say so plainly when it applies.
- Assets (models, textures, sounds, fonts) carry their own licences; check each one.

## 7. Reporting

End every task with a report that has these parts, in this order:

1. **Outcome**: one or two sentences on what is now true.
2. **Evidence**: the gate commands and their summary lines; any measurement with its command and input.
3. **Changes**: each file changed and why (or "no files changed").
4. **Not done / not verified**: everything you could not check, did not finish or are unsure of.
5. **Decisions for the user**: anything that needs their choice, as a short question with the options.

Plain, short sentences; active voice; no marketing words. Explain an XR term the first time it matters.
