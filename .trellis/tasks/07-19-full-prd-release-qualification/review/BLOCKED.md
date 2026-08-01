# BLOCKED — Full PRD release qualification

**Date:** 2026-08-02  
**Candidate SHA:** `8c8df12fceef913073b683c0cfe0877dd8148aac`  
**Stop kind:** failed RC (evidence complete; product release **not** authorized)

## Hard stop

This task **must not** be archived as a successful release qualification, and
parent `07-19-complete-full-cat-prd` **must not** be completed/archived, until
every hard blocker below is cleared on a **new** immutable candidate SHA with
fresh evidence (package/manual lanes re-invalidated per `design.md`).

| ID | Severity | Status on freeze | Summary | Owner |
| --- | --- | --- | --- | --- |
| HB1 | blocker | fail (worktree mitigation unproven) | Windows package missing Engine (`file source doesn't exist` absolute path join) | packaging / `package-desktop.mjs` |
| HB2 | blocker | fail (worktree gate + locale prune unproven) | Size gate: freeze measured unpacked 383.36 MB; installer N-02 still required | packaging |
| HB3 | blocker | fail | Default engine smoke PDF / `pdfinfo` | env Poppler + `07-19-pdf-ocr-workflow` |
| HB4 | blocker | fail | `format:check` + `cargo fmt` + ESLint red | repo hygiene / owning packages |
| HB5 | blocker | blocked-external | Node 22 clean quality lane not run | CI/runner |
| HB6 | blocker | blocked-external | macOS package + fonts + native a11y | macOS runner |
| HB7 | blocker | fail | 1M TM / multi-tier capacity / full NFR campaign | NFR fixtures + storage/TM owners |
| HB8 | blocker | fail | Two-client collaboration acceptance | `07-19-collaboration-server` |
| HB9 | blocker | blocked-external | Usability / productivity studies | product/research ops |
| HB10 | blocker | fail | Desktop E2E required PDF skip (34/1) | Poppler/Tesseract + PDF E2E |

## What is *not* a release pass

- Green focused Engine smokes, full `cargo test --workspace`, clippy, typecheck,
  contracts, desktop/plugin unit counts.
- Desktop E2E **exit 0** with a **required** PDF skip.
- Any worktree packaging fix that has not been re-run and bound to a new SHA.

## Resume criteria (minimum)

1. Hygiene lane green (format + rustfmt + eslint) on candidate.
2. Windows package embeds matching Engine; installer ≤ 200 MiB; package check green.
3. Default multi-format smoke + zero required E2E skips (or honest env + product fix).
4. Node 22 + Node 24 quality lanes recorded.
5. macOS package + inherited Workbench font/a11y gates recorded (or remain open — still blocks Full PRD close).
6. NFR capacity + two-client collab + studies either pass or remain explicit open gates (never prose-only pass).
7. New freeze SHA; append-only ledger; parent AC map closed only when all accepted criteria pass.

## Policy

- Qualification may fix harnesses/evidence only; product defects return to owning implementation tasks.
- Do **not** force-update or relabel this failed candidate as the final release candidate.
- Keep this task **in_progress** with this file until resume criteria are met (or product scope is formally re-baselined by humans).
