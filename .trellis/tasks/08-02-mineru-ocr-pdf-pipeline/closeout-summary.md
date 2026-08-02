# Closeout summary — 08-02-mineru-ocr-pdf-pipeline

## What shipped

MinerU HTTP OCR path for PDF document import in CAT Engine (Full PRD HB3 supersession):

| Area | Delivery |
| --- | --- |
| **Client** | Engine `MinerUClient`: base URL, timeouts, page/byte limits, mockable transport |
| **Credentials** | OS keyring `translunar-cat.mineru` / account `default`; test memory mode; RPC `mineru.credential.{set,status,delete}` (presence/backend only) |
| **Routing** | Explicit-only: `ocrEngine=mineru` selects MinerU; closed enums for engine/mode; invalid → `invalid_request` (no silent Poppler fallthrough) |
| **Import wire** | `document.import` / builtin.pdf path; layout blocks → shared PDF segmentation (`segmentationMode` / `srxPath`, one SRX prepare per import) → segments |
| **Degrade** | Typed MinerU errors (missing key, auth, timeout, unavailable, protocol/empty, resource limit, config) on JSON-RPC, batch diagnostics, and local API without regressing legacy local-API codes |
| **Page preflight** | Bounded page-tree count in `filter-pdf::page_tree` (ObjStm/XRef Flate expand only, LZW reject, `/Count` consistency) before credential/HTTP |
| **Docs** | `docs/mineru-ocr.md` |

### Quality loop

- Rounds 1–4 findings + fix commits; F2 thrash documented in `review/break-loop-page-tree-bounds.md`
- Final HEAD: `f2b29e4` (`fix(pdf): tighten page-tree preflight stream expansion bounds`)
- Closeout disposition: `review/findings-5.md` (all F1–F8 fixed; F2 theoretical residual accepted)

### Evidence (focused)

```text
cargo test -p translunar-engine mineru --lib     # 31 passed
cargo test -p translunar-filter-pdf page_tree --lib  # 12 passed
cargo clippy -p translunar-engine -p translunar-filter-pdf --all-targets -- -D warnings  # clean
```

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/backend/engine-boundary.md` | MinerU HTTP OCR + credential RPC + page-tree preflight contract under PDF/OCR boundary |
| Task PRD/implement | AC/WP checkboxes aligned with shipped evidence |

## Acceptance (honest)

| AC | Status |
| --- | --- |
| AC-01 mock OCR → import | **pass** |
| AC-02 typed degrade, no corrupt project | **pass** (with accepted residuals below) |
| AC-03 secrets never in SQLite/logs | **pass** |
| AC-04 focused tests green | **pass** |

## Residual risks (do not block merge)

1. Live MinerU interoperability untested (mock-only CI).
2. HTTP body fully buffered before 64 MiB cap check.
3. Fixed US Letter bbox projection; hard-coded confidence `900`.
4. Re-import preview uses local PDF filter, not MinerU.
5. F2 theoretical: preflight must keep covering every stream form `lopdf` expands; unknown exotic paths remain unproven.
6. Auto/default never selects MinerU even when configured (explicit-only interim; HB10 follow-on).

## Suggested commit (Orchestrator)

**Subject:**

```text
chore(task): closeout MinerU OCR PDF pipeline
```

**Body:**

```text
Document quality-loop disposition (findings-5), capture MinerU HTTP OCR /
keyring / explicit routing / bounded page-tree preflight in engine-boundary,
and mark task AC/WP complete.

Product already on branch (feat + fix commits through f2b29e4). No further
product features. Ready to merge task/08-02-mineru-ocr-pdf-pipeline.

Tests: mineru 31+, page_tree 12+, clippy engine+filter-pdf -D warnings.
```

**Paths to include (this closeout wave):**

- `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline/review/findings-5.md`
- `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline/closeout-summary.md`
- `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline/implement.md` (and prd if AC text tweaked)
- `.trellis/spec/backend/engine-boundary.md`

**Do not include** unrelated dirt (e.g. `.grok/agents/trellis-plan.md`, other task dirs, `apps/desktop/release/`).

Note: `review/findings-3.md` and `findings-4.md` are already committed on the task branch; findings-1..2 likewise in earlier fix commits.

## Verdict

**Ready for Orchestrator to merge** the task branch after committing closeout/spec artifacts. No open blocker/major in closeout judgment. Do not archive here (finish-work / Orchestrator policy).
