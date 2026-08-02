# Findings round 5 (orchestrator closeout note)

## meta
- task: `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline`
- branch: `task/08-02-mineru-ocr-pdf-pipeline`
- head_sha: `f2b29e46a37a7c7a2a320a00734d19b6e2e51da7`
- base_branch: `master` (`a0ce212`)
- round: 5
- mode: closeout judgment only; no product code changed
- prior_findings: `review/findings-1.md` … `review/findings-4.md`
- prior_break_loop: `review/break-loop-page-tree-bounds.md`
- runtime_evidence (closeout re-run):
  - `cargo test -p translunar-engine mineru --lib`: PASS, **31** passed / 0 failed
  - `cargo test -p translunar-filter-pdf page_tree --lib`: PASS, **12** passed / 0 failed
  - `cargo clippy -p translunar-engine -p translunar-filter-pdf --all-targets -- -D warnings`: PASS

## need_verify
- required: false
- reason: Quality loop product defects F1–F8 are closed on HEAD; closeout re-confirmed focused MinerU + page_tree + Clippy gates. Formal `review/verify-*.md` was never written during thrash (review 524s); break-loop + fix commits + green focused suites substitute for mission evidence at closeout.

## issues (disposition)

| Id | Title (short) | Final status | Closed by |
| --- | --- | --- | --- |
| F1 | Closed OCR routing / no silent fallthrough | **fixed** | r2–r3 (`44654e4` + earlier) |
| F2 | Page-limit preflight = real, bounded page tree | **fixed** (residual accepted below) | r3–r5 (`0358430`, `f2b29e4`) |
| F3 | Local-API + MinerU error taxonomy | **fixed** | r2–r3 |
| F4 | Secret-bearing Debug redaction | **fixed** | r2 |
| F5 | Credential set/status/delete surface | **fixed** | r2 |
| F6 | Shared PDF segmentation / table separators | **fixed** | r3 |
| F7 | fmt + strict Clippy focused gates | **fixed** | r2+ |
| F8 | Custom SRX prepared once per import | **fixed** | r4 (`0358430`) |

### F2 residual (theoretical, accepted — not open major)

After `f2b29e4`, preflight **structurally** identifies expandable streams (`/Type /ObjStm` and `/Type /XRef` via startxref chain + stream dicts), decodes only those under 8/32 MiB Flate caps, **rejects** LZW / multi-filter / indirect Filter|Length, enforces xref `Size` budget, and requires matching `/Count` at **every** `/Pages` node before `lopdf::Document::load_mem`. Fixtures cover ObjStm Flate bomb, LZW ObjStm, padded dict, CR-only stream syntax, nested Count mismatch, oversized xref Size, cycles/depth, and image-heavy scanned PDF pass without content-stream inflation.

**Accepted theoretical residual:** correctness of the gate still depends on the preflight recognizing every stream form that `lopdf` 0.34 will expand. An unknown future/exotic expand path, or a structural-parse miss that lets `load_mem` allocate before the post-load object-count check, is not a currently demonstrated product defect. Mitigations: fail-closed filter policy, fail-closed Count, 5s wall clock, and the focused hostile suite. Not reopened as major for merge.

## assumptions
- Explicit-only MinerU routing (`ocrEngine=mineru`) remains the interim product contract; automatic per-page MinerU fallback is out of scope (HB10 follow-on).
- Live MinerU HTTP interoperability is outside this task’s mock-focused AC.
- Reviewer 524 thrash does not reopen fixed F* when HEAD evidence is green and break-loop documents the bound.

## residual_risks (product, accepted)
- No deployed MinerU version exercised; mock envelope only.
- HTTP response fully buffered before the 64 MiB response cap is checked.
- Bounding boxes project onto fixed US Letter; confidence hard-coded `900`.
- Re-import preview still uses the ordinary local PDF filter, not the MinerU path.
- SRX preparation counter is production-visible test instrumentation in `filter-pdf` (minor hygiene if public API stabilizes).
- F2 theoretical residual above.

## acceptance_assessment
- **AC-01**: pass — mock MinerU → structured OCR → import segments (incl. custom SRX once-per-import).
- **AC-02**: pass — missing key / network / auth / resource limits → typed errors; preflight fails before credential/transport/persistence; no open major silent routing or unbounded page-tree gate.
- **AC-03**: pass — keyring service `translunar-cat.mineru`; redacted Debug; credential RPC presence/backend only; secrets not in SQLite/log assertions of focused suite.
- **AC-04**: pass — mineru 31+, page_tree 12+, clippy engine+filter-pdf `-D warnings` green.

## summary_for_orchestrator
- verdict: **ready_for_closeout / ready_to_merge**
- open_blockers: 0
- open_majors: 0
- open_minors: 0 (accepted residuals only)
- ready_for_closeout: true
- summary: Product path ships MinerU HTTP OCR (explicit routing), keyring + credential RPC, shared PDF segmentation, and bounded page-tree preflight. All review F1–F8 fixed or residual-accepted. Orchestrator may commit closeout/spec artifacts and merge `task/08-02-mineru-ocr-pdf-pipeline` → main/master.
- next_action: Orchestrator git commit (closeout docs + any spec) then merge; archive via finish-work policy (not this agent).
