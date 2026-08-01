# Findings round 1

## meta
- task: `.trellis/tasks/07-19-full-prd-release-qualification`
- branch: `task/07-19-full-prd-release-qualification`
- head_sha (candidate freeze): `8c8df12fceef913073b683c0cfe0877dd8148aac`
- round: 1
- mode: **stopped failed RC** (qualification evidence recorded; product release not claimed)

## need_verify
- required: false
- reason: Closeout of a completed qualification run with immutable evidence under `evidence/`. No further verify mission — release is hard-stopped via `BLOCKED.md`.

## Verdict
- Qualification run: **completed with evidence** (ledger, manifest, automated logs, partial benchmarks/manual notes).
- Product release: **FAIL / BLOCKED**.
- Parent `07-19-complete-full-cat-prd`: remains **in_progress** (do **not** archive).
- This task: recommend keep **in_progress** with `review/BLOCKED.md` until blockers clear and a new candidate is re-qualified.

## issues

### F1 — Packaging gates failed on freeze (HB1 / HB2)
- severity: blocker
- files: `scripts/package-desktop.mjs`, `apps/desktop/electron-builder.yml`, `scripts/release-package-check.mjs`
- problem: On candidate `8c8df12`, Windows `package:dir` omitted Engine (`extraResources` absolute-path join) and `release:package:check` failed size (unpacked 383.36 MB vs 200 MiB ceiling applied to dir).
- mitigation (worktree, **not** re-qualified): relative `.package-engine-resource` staging; dual ceilings (installer 200 MiB / unpacked 420 MiB); `electronLanguages` prune. Requires new candidate SHA + re-package evidence.
- status: open (mitigated-in-tree; freeze still fail)

### F2 — Format / lint hygiene red (HB4)
- severity: blocker (release quality lane)
- files: evidence `automated/format-check.log`, `cargo-fmt.log`, `eslint.log`
- problem: `format:check`, `cargo fmt --check`, ESLint (2 errors in `workbench-utils.ts`) red on freeze.
- status: open

### F3 — PDF / fidelity / E2E skip (HB3 / HB10 / AC6)
- severity: blocker
- files: `scripts/engine-smoke.mjs`, desktop `pdf-workbench.spec.ts`
- problem: Default engine smoke fails without `pdfinfo`; desktop E2E 34 pass / **1 required skip** (scanned PDF). Unit green does not prove process PDF.
- status: open (env Poppler/Tesseract + product ownership `07-19-pdf-ocr-workflow`)

### F4 — Dual Node / macOS / studies blocked-external (HB5 / HB6 / HB9)
- severity: blocker
- problem: Node 22 lane not run; all macOS package + Workbench font/VoiceOver gates blocked; usability/productivity studies not run.
- status: open (blocked-external)

### F5 — NFR capacity + two-client collab incomplete (HB7 / HB8)
- severity: blocker
- problem: Only storage-benchmark 100k partial; 1M TM / 5M / full reliability campaign missing; two-client collab acceptance not evidenced.
- status: open

### F6 — AC scorecard not green
- severity: blocker
- problem: AC1 partial; AC2–AC6/AC10 fail; AC7/AC9 partial; AC8 blocked-external. Overall release readiness **0%**.
- status: open

## assumptions
- No product behavior was fixed inside this qualification task on the freeze SHA; later packaging/script edits in the worktree are **post-freeze** and do not re-label `8c8df12` as pass.
- Exit 0 with required skips is treated as fail for Full PRD gates (per PRD / design honesty rules).
