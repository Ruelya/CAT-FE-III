# Findings round 2

## meta
- task: `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline`
- requested_branch: `task/08-02-mineru-ocr-pdf-pipeline`
- review_worktree_branch: `Ruelya/08-02-mineru-ocr-review-r2` (same candidate commit as requested branch)
- head_sha: `6d4a9f54712d8d69823585b567aaf84338c18f1a`
- base_branch: `master` (`a0ce2124810fdc95216c3bf3e1c0e1a40fede3a0`)
- round: 2
- prior_findings: `review/findings-1.md` (`F1`-`F7`)
- mode: review only; no product code changed and no commit created
- context_notes:
  - `check.jsonl` and `implement.jsonl` still contain only seed rows.
  - No `research/` directory and no prior `verify-*.md` report exist for this task.
  - Worktree was clean before this findings file was written.
- runtime_evidence:
  - `cargo fmt --all -- --check`: PASS
  - `cargo clippy -p translunar-engine --all-targets -- -D warnings`: PASS
  - `cargo test -p translunar-engine mineru -- --nocapture`: PASS, 24 passed / 0 failed
  - `cargo build -p translunar-engine --bin translunar-engine`: PASS
  - Direct stdio probe in `TRANSLUNAR_MINERU_TEST_MODE=1`: PASS; `mineru.credential.set/status/delete` returned 4 successful responses, set/status reported present, delete reported absent, and the sentinel secret was absent from stdout, stderr, SQLite/WAL/SHM, and recursively scanned disposable workspace files.

## need_verify
- required: true
- reason: The current 24-test suite is green, but it exercises synthetic PDFs with literal page markers, MinerU-only local-API classifications, and one-block-per-unit mapping. After the open fixes, focused evidence is required for real PDF page-tree counting, closed routing validation, preservation of the existing local-API taxonomy, and SRX/segmentation behavior.

### Verify mission
- purpose: Prove that the next fix closes the remaining product contracts without reintroducing network calls, local-PDF regressions, error-code drift, or segment-boundary drift.
- questions:
  - Does an unknown or misspelled `ocrEngine`, and every invalid `ocrMode`, fail as typed `invalid_request` before either the local PDF filter or MinerU transport is invoked?
  - Does MinerU preflight obtain the actual selected page count for ordinary and object-stream/compressed PDFs, including `pageRange=N`, and reject an over-limit selection before credential access and transport?
  - Do local HTTP responses retain the established `not_found`, `export_error`, and `qa_gate_blocked` codes/statuses while every MinerU auth/timeout/unavailable/protocol/resource-limit case remains typed?
  - Do MinerU blocks use the same paragraph/sentence/custom-SRX segmentation contract as `translunar-filter-pdf`, with exact segment order/text/structural paths and preserved table cell/row separators?
- success_criteria:
  - Invalid routing values return `invalid_request` and record zero MinerU transport calls and zero local-filter side effects.
  - A real object-stream/compressed PDF reports its true page count; over-limit full-document and start-only ranges fail before credential/HTTP access.
  - Focused local-API assertions prove `404/not_found`, `400/export_error`, `409/qa_gate_blocked`, and the complete typed MinerU matrix without any `internal_error` fallback.
  - Paragraph, sentence, and custom-SRX imports produce exact expected units; table text contains meaningful cell/row separators and no collapsed tokens.
  - `cargo fmt --all -- --check`, strict Engine Clippy, and the focused Engine/PDF tests pass after the fix.
- failure_signals:
  - A typo silently falls through to Poppler/Tesseract or is treated as MinerU `auto`.
  - Page count depends on textual `/Type /Page` occurrences, rejects a valid compressed PDF, or permits a selected span above `max_pages`.
  - Any established local-API client error becomes HTTP 500/`internal_error`, or an unknown filter becomes `unsupported_document` instead of `not_found`.
  - `segmentationMode`/`srxPath` does not alter MinerU units consistently with the PDF filter, or table cells collapse together.
- suggested_commands:
  - `cargo test -p translunar-engine mineru -- --nocapture`
  - `cargo test -p translunar-engine local_api -- --nocapture`
  - `cargo test -p translunar-filter-pdf --lib`
  - Run the new focused regressions for invalid routing enums, object-stream page counting, legacy local-API error taxonomy, and exact MinerU paragraph/sentence/SRX mapping.
  - `cargo fmt --all -- --check`
  - `cargo clippy -p translunar-engine --all-targets -- -D warnings`
- scope: `crates/engine/src/mineru.rs`, `crates/engine/src/lib.rs`, `crates/engine/src/local_api.rs`, the shared PDF block/segmentation code and focused tests in `crates/filter-pdf`, plus `docs/mineru-ocr.md`.
- avoid: Live MinerU, full workspace/desktop/Electron suites, and unrelated release-qualification lanes; keep the verification package- and path-scoped.
- related_issues: `F1`, `F2`, `F3`, `F6`

## issues

### F1 - Routing fixes cover defaults but invalid values still silently select the wrong path
- severity: major
- files: `crates/engine/src/mineru.rs:823-839`; `crates/engine/src/mineru.rs:902-914`; `crates/filter-pdf/src/lib.rs:66-75`; `docs/mineru-ocr.md:3-4`; `docs/mineru-ocr.md:34-45`
- problem: The round-one default/auto hijack and explicit-missing-base-URL cases are fixed: default/`auto` stays local, explicit `mineru` selects MinerU and fails typed when unconfigured, and Tesseract/`never` do not call the transport. However, routing is not actually closed. An unknown `ocrEngine` returns `false` from `should_handle` and silently falls through to the local PDF filter, which does not validate that option. With explicit MinerU, every `ocrMode` other than `always` or `never` is silently normalized to `auto`, whereas the existing PDF option parser rejects invalid modes. A typo can therefore run a different OCR engine instead of returning a typed configuration error. The documentation also opens by saying a configured endpoint causes MinerU preference, contradicting the later explicit-only rule.
- minimal_fix: Parse `ocrEngine` and `ocrMode` through one validated routing enum before choosing either path. Reject unknown values as `invalid_request`, preserve the documented `never` override, and add Engine-level tests proving typo/invalid-mode requests make zero MinerU calls and do not fall through locally. Align the documentation introduction with explicit-only routing.
- status: open

### F2 - Page-limit preflight uses a raw-byte heuristic, not the real PDF page count
- severity: major
- files: `crates/engine/src/mineru.rs:868-893`; `crates/engine/src/mineru.rs:987-1023`; `crates/engine/src/mineru.rs:1383-1449`; `crates/engine/src/mineru.rs:1567-1571`; `docs/mineru-ocr.md:43-45`
- problem: Full-document and `pageRange=N` spans are now checked before credential lookup/transport, and the new synthetic tests pass. The count itself is obtained by scanning the complete file bytes for textual `/Type /Page`. That is not a PDF page-tree count: page dictionaries may live inside compressed object streams, stale incremental objects may remain in the file, and content/metadata can contain decoy markers. The heuristic can reject valid PDFs, over-count stale pages, or under-count/bypass `max_pages`; the tests only generate literal uncompressed markers. This does not satisfy R1 or the documentation's claim that the real page count is validated.
- minimal_fix: Use a bounded PDF parser/page-tree reader, or expose a validated page-count helper from the PDF layer, rather than scanning raw bytes. Add real fixtures with compressed/object-stream page dictionaries and misleading stale/stream markers; assert the exact selected span and zero credential/transport access on over-limit input.
- status: open

### F3 - MinerU codes are typed, but the shared classifier regresses existing local-API errors
- severity: major
- files: `crates/engine/src/lib.rs:355-408`; `crates/engine/src/lib.rs:8543-8603`; `crates/engine/src/local_api.rs:364-398`; `crates/engine/src/local_api.rs:480-535`
- problem: The original MinerU gap is fixed: batch diagnostics and local HTTP now receive typed MinerU codes, and the focused mapping table passes. The replacement local-API mapper delegates all other errors to `engine_error_code`, which is not exhaustive for the established HTTP surface. `EngineError::QaGateBlocked`, ordinary `EngineError::Export`, `CurationExport`, and `ReportExport` fall to `internal_error`; `EngineError::Import(FilterError::NotFound(_))` is caught by the broad `Import(_)` arm and becomes `unsupported_document`. The richer `rpc_error` mapping still classifies these correctly, so the attempted centralization introduces cross-surface drift and violates the Local API contract.
- minimal_fix: Make the shared classifier exhaustive for every previously supported local-API variant before delegating to it, including filter not-found, export/report failures, QA gate, credential, policy, plugin, storage, and MinerU cases. Add a table-driven regression covering the pre-existing taxonomy plus the MinerU matrix and assert both code and HTTP status.
- status: open

### F4 - Secret-bearing generic Debug output is redacted
- severity: major
- files: `crates/engine/src/mineru.rs:92-104`; `crates/engine/src/mineru.rs:342-366`; `crates/protocol/src/lib.rs:2305-2317`; `crates/engine/src/lib.rs:14466-14502`
- problem: The round-one leak is fixed. `MemoryMinerUCredentialStore`, `MinerUParseRequest`, and the protocol credential-set params now use custom redacted `Debug` implementations. Unit tests pass, and an independent direct-engine stdio probe confirmed the sentinel secret was absent from protocol output, stderr, and recursively scanned disposable workspace files.
- minimal_fix: None for the product defect. Strengthen the in-repo `secret_absent_from_workspace` helper to recurse into managed directories so CI retains the same coverage as the review probe.
- status: fixed

### F5 - A supported Engine credential lifecycle now exists
- severity: major
- files: `crates/protocol/src/lib.rs:259-261`; `crates/protocol/src/lib.rs:2294-2317`; `crates/engine/src/lib.rs:3331-3348`; `crates/engine/src/lib.rs:7860-7885`; `docs/mineru-ocr.md:20-32`
- problem: The production service now exposes set/delete/status, the trusted Engine dispatcher handles `mineru.credential.*`, responses contain presence/backend only, and documentation identifies the supported surface. The direct stdio probe exercised the shipped boundary successfully in memory mode without disclosing or persisting the sentinel.
- minimal_fix: None.
- status: fixed

### F6 - Table separators are fixed, but MinerU still bypasses PDF SRX/segmentation
- severity: minor
- files: `crates/engine/src/mineru.rs:593-721`; `crates/engine/src/mineru.rs:1056-1083`; `crates/filter-pdf/src/lib.rs:1138-1223`; `docs/mineru-ocr.md:53-55`
- problem: The table subproblem is fixed: cell and row separators are preserved and the fixture rejects `ItemQty`. The architectural part remains unchanged. `blocks_to_units` still emits one `ImportedUnit` per MinerU text item and never loads SRX or reads `segmentationMode`; the established PDF path applies `srx.ranges` to each ordered block. MinerU imports therefore produce different segment counts and boundaries from the caller-selected PDF contract and still do not implement the design's layout-block -> filter-pdf block -> segment flow.
- minimal_fix: Expose/reuse one PDF block-to-unit mapping function that accepts locale, `segmentationMode`, and `srxPath`, then feed MinerU blocks through it. Add exact paragraph/sentence/custom-SRX assertions for segment count, order, text, structural path, notes, and table separators.
- status: open

### F7 - Required focused Rust hygiene gates are green
- severity: minor
- files: `crates/engine/src/lib.rs`; `crates/engine/src/local_api.rs`; `crates/engine/src/mineru.rs`
- problem: The round-one formatting and Clippy failures are fixed. Review reran format, strict Engine Clippy, and the focused MinerU suite successfully; the suite reports 24 passed / 0 failed.
- minimal_fix: None.
- status: fixed

## assumptions
- The raw `mineru.credential.*` dispatch methods are treated as a trusted/internal Engine boundary, analogous to the existing AI credential operation, rather than renderer-generated public methods.
- Live MinerU interoperability is not required by this task's CI acceptance; mockability is the stated requirement.
- Explicit-only MinerU routing is accepted as the interim interpretation from findings round 1; automatic per-page MinerU fallback remains future work.

## residual_risks
- No live deployed MinerU version was exercised; the mock proves the Engine's expected envelope, not external API compatibility.
- `response.bytes()` fully buffers the HTTP response before checking the 64 MiB cap, so a broken endpoint can consume more memory than the configured response limit.
- Bounding boxes are projected onto fixed US Letter dimensions and confidence remains hard-coded to `900`; page-specific geometry/confidence fidelity is unverified.
- Re-import preview still calls the ordinary PDF filter directly rather than the MinerU path, so a MinerU-imported document can preview different segment boundaries or fail when local PDF tools are absent.
- The checked-in `secret_absent_from_workspace` helper scans SQLite artifacts but only top-level ordinary files; it does not recursively inspect `sources/` or `tmp/`, although the independent process probe performed a recursive scan for this review.
- Default/`auto` never invokes MinerU even when configured; callers must explicitly pass `ocrEngine=mineru` until a safe per-page fallback is designed.
- The task context manifests remain seed-only, so future workers receive no curated spec/research manifest beyond the task documents.

## acceptance_assessment
- AC-01: partial pass - mock MinerU import succeeds and persists OCR units, but F6 leaves the designed segmentation contract incomplete.
- AC-02: partial pass - MinerU failures are typed and abort cleanly, but F1 still permits silent routing fallback and F2 does not enforce limits from a real page count.
- AC-03: pass for current code - custom Debug redaction plus the direct stdio sentinel probe found no secret in protocol output, stderr, or disposable workspace artifacts; the in-repo recursive regression should still be strengthened.
- AC-04: focused pass - format, strict Engine Clippy, and all 24 MinerU-filtered tests are green.

## summary_for_orchestrator
- verdict: need_fix
- open_blockers: 0
- open_majors: 3 (`F1`, `F2`, `F3`)
- open_minors: 1 (`F6`)
- needs_evidence: 0
- fixed_this_round: `F4`, `F5`, `F7`
- ready_for_closeout: false
- summary: The fix successfully restores default/local routing, makes explicit missing MinerU configuration typed, maps MinerU failures across batch/local surfaces, redacts secret-bearing Debug values, exposes a working credential lifecycle, preserves table separators, and clears the focused Rust gates. Closeout remains blocked because routing still accepts invalid enum values silently, page limits rely on an unsafe raw-byte PDF heuristic, the shared classifier regresses established local-API errors, and MinerU still bypasses PDF SRX/segmentation.
- next_action: Fix `F1`, `F2`, `F3`, and `F6`, then run the Verify mission above and resume review with the full verify report.
- resume_hint: Resume this review after the next fix with the new commit SHA and `review/verify-2.md`; do not re-run research.
