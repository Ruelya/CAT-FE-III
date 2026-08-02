# Findings round 3

## meta
- task: `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline`
- requested_branch: `task/08-02-mineru-ocr-pdf-pipeline`
- review_worktree_branch: `Ruelya/08-02-mineru-ocr-review-r3` (same candidate commit as requested branch)
- head_sha: `44654e48a08d3d7694251fb98d0d2d14eb5f3b38`
- base_branch: `master` (`a0ce2124810fdc95216c3bf3e1c0e1a40fede3a0`)
- round: 3
- prior_findings: `review/findings-1.md`, `review/findings-2.md`
- mode: review only; no product code changed and no commit created
- context_notes:
  - `check.jsonl` and `implement.jsonl` still contain only seed rows.
  - No `research/` directory or `review/verify-*.md` report exists for this task.
  - The requested task branch and this review worktree resolve to the same HEAD.
- runtime_evidence:
  - `cargo test -p translunar-engine mineru`: PASS, 28 passed / 0 failed.
  - `cargo test -p translunar-engine local_api`: PASS, 6 passed / 0 failed.
  - `cargo test -p translunar-filter-pdf --lib`: PASS, 8 passed / 0 failed.
  - `cargo fmt --all -- --check`: PASS.
  - `cargo clippy -p translunar-engine -p translunar-filter-pdf --all-targets -- -D warnings`: PASS.

## need_verify
- required: true
- reason: The routing and local-API regressions are closed and the focused suites are green, but the page-count replacement is not yet a bounded, strict parser and the custom-SRX path is reloaded for every MinerU block. After those fixes, runtime evidence must use a genuine object-stream PDF and exact custom-SRX assertions rather than the current compressed-content surrogate and loose sentence checks.

### Verify mission
- purpose: Prove that MinerU preflight cannot be bypassed or exhaust the Engine on compressed/malformed page trees, and that shared PDF segmentation remains exact, deterministic, and one-load-per-import.
- questions:
  - Does a genuine PDF whose page dictionaries live in `/ObjStm` report the exact page count, ignore unlinked/decoy page markers, and enforce full-document plus `pageRange=N` limits before credential access and transport?
  - Do oversized, deeply nested, cyclic, malformed, or compression-amplifying page trees fail within explicit byte/object/depth/time bounds with a typed error and no partial project/source publication?
  - Is `segmentationMode`/`srxPath` prepared once per MinerU import, then reused across every layout block without repeated file reads/parses or mixed rules if the file changes concurrently?
  - Do paragraph, sentence, and custom-SRX modes produce exact unit count/order/text/structural paths/notes, while table cell and row separators remain intact?
  - Do closed OCR routing and the legacy plus MinerU local-API error matrix remain unchanged after the fixes?
- success_criteria:
  - A fixture generated with actual object streams (for example qpdf object-stream generation or an equivalent checked-in fixture) counts exactly and an over-limit selection records zero credential reads and zero transport calls.
  - Parser amplification, traversal-depth/object-count excess, malformed branches, and count inconsistencies terminate under explicit bounds and return `resource_limit_exceeded` or the documented typed invalid/unsupported error, never a hang, panic, partial count, or HTTP call.
  - A test-only SRX loader/parser counter proves one preparation per import regardless of block count; exact paragraph/sentence/custom-SRX expected units match the local PDF contract.
  - `404/not_found`, `400/export_error`, `409/qa_gate_blocked`, and the complete MinerU typed matrix remain stable on the local API.
  - Format, strict Engine/PDF Clippy, MinerU, local-API, and PDF-filter focused tests pass.
- failure_signals:
  - Page counting uses an iterator that silently skips invalid branches, accepts a partial traversal, or eagerly expands unbounded object/xref streams in the Engine process.
  - The only "compressed PDF" regression compresses ordinary content streams while page dictionaries remain normal indirect objects.
  - Custom SRX metadata/XML/regexes are read or compiled once per block, or exact segment boundaries differ from the local PDF filter.
  - Any invalid routing value falls through locally, any established local-API code becomes `internal_error`, or any failed preflight touches credentials/transport/persistence.
- suggested_commands:
  - `cargo test -p translunar-engine mineru -- --nocapture`
  - `cargo test -p translunar-engine local_api -- --nocapture`
  - `cargo test -p translunar-filter-pdf --lib`
  - Run new focused regressions for genuine `/ObjStm` page dictionaries, malformed/deep/cyclic and compression-amplifying page trees, pre-credential limit rejection, one-time SRX preparation, and exact custom-SRX units.
  - `cargo fmt --all -- --check`
  - `cargo clippy -p translunar-engine -p translunar-filter-pdf --all-targets -- -D warnings`
- scope: `crates/filter-pdf/src/lib.rs`, `crates/engine/src/mineru.rs`, focused Engine/local-API tests, and PDF/SRX fixtures only.
- avoid: Live MinerU, full workspace/desktop/Electron suites, unrelated release lanes, and product changes outside the two open findings.
- related_issues: `F2`, `F8`; regression coverage for fixed `F1`, `F3`, and `F6`.

## issues

### F1 - OCR routing is now closed and fails invalid enums before either PDF implementation
- severity: major
- files: `crates/engine/src/mineru.rs:976-1043`; `crates/engine/src/lib.rs:4807-4842`; `crates/engine/src/lib.rs:14732-14782`; `docs/mineru-ocr.md:1-49`
- problem: Fixed. `resolve_pdf_ocr_route` validates both closed enums, preserves `ocrMode=never`, selects MinerU only explicitly, and maps invalid values to `EngineError::InvalidRequest` before the MinerU transport or local filter is called. Engine-level typo and invalid-mode tests pass with zero transport calls, and the documentation now matches explicit-only routing.
- minimal_fix: None.
- status: fixed

### F2 - Page-tree counting is real for normal PDFs but is not bounded or strict enough for a resource-limit gate
- severity: major
- files: `crates/filter-pdf/src/lib.rs:1034-1053`; `crates/filter-pdf/Cargo.toml:9-12`; `crates/engine/src/mineru.rs:851-876`; `crates/engine/src/mineru.rs:1267-1307`; `crates/engine/src/mineru.rs:1684-1695`
- problem: The raw `/Type /Page` scan is gone and `lopdf::Document::get_pages()` follows the catalog page tree, so ordinary and decoy-marker cases improve materially. It is not the bounded parser required by the prior finding and the PDF boundary, however. `Document::load` reads the whole PDF and eagerly expands object/xref streams; lopdf 0.34's object-stream path calls `Stream::decompress`, whose Flate/LZW implementations grow an unbounded `Vec` with no decoded-byte or compression-ratio cap. Its `PageTreeIter` also returns no error: malformed references are skipped, depth is silently truncated at 256, and traversal exhaustion yields a partial page set. A crafted PDF below the 200 MiB source cap can therefore amplify memory or be under-counted instead of producing a typed preflight failure. The new test calls `doc.compress()`, which compresses streams but does not place the page dictionaries into a genuine `/ObjStm`, so the prior object-stream mission remains unproven.
- minimal_fix: Use a page-tree reader whose compressed and decoded bytes, object count, nesting depth, and traversal time are explicitly capped and whose traversal reports malformed/partial trees rather than silently skipping them. If lopdf remains, add a bounded loading/traversal layer or isolate it behind a supervised resource-bounded process; validate the page-tree count consistently and map bound breaches to the typed resource-limit taxonomy. Add genuine `/ObjStm`, malformed/deep/cyclic, compression-amplification, and zero-credential/zero-transport regressions.
- status: open

### F3 - Shared classification restores the legacy local-API taxonomy and retains MinerU codes
- severity: major
- files: `crates/engine/src/lib.rs:354-431`; `crates/engine/src/local_api.rs:364-398`; `crates/engine/src/local_api.rs:538-610`
- problem: Fixed. Filter `NotFound` is classified before broad import/export arms; export, report, QA gate, JSON, policy, credential, storage, plugin, and MinerU cases retain their intended codes/statuses. Both the table-driven matrix and the broader local-API suite pass, including actual HTTP client-failure probes.
- minimal_fix: None.
- status: fixed

### F4 - Secret-bearing generic Debug output remains redacted
- severity: major
- files: `crates/engine/src/mineru.rs:92-104`; `crates/engine/src/mineru.rs:342-366`; `crates/protocol/src/lib.rs:2305-2317`
- problem: Fixed in round 2 and unchanged in round 3. Focused tests remain green.
- minimal_fix: None.
- status: fixed

### F5 - The Engine credential lifecycle remains supported
- severity: major
- files: `crates/protocol/src/lib.rs:259-261`; `crates/protocol/src/lib.rs:2294-2317`; `crates/engine/src/lib.rs:3331-3348`; `docs/mineru-ocr.md:18-32`
- problem: Fixed in round 2 and unchanged in round 3. Set/status/delete expose presence/backend only.
- minimal_fix: None.
- status: fixed

### F6 - MinerU blocks now use the shared PDF segmentation semantics
- severity: minor
- files: `crates/filter-pdf/src/lib.rs:1016-1080`; `crates/filter-pdf/src/lib.rs:1195-1280`; `crates/engine/src/mineru.rs:1075-1122`; `crates/engine/src/mineru.rs:1697-1734`
- problem: The semantic defect is fixed. MinerU block text now goes through the same `SegmentationMode` and `SrxRules::ranges` behavior as the local PDF filter, keeps a stable PDF structural path for every segment derived from the block, assigns dense ordinals and MinerU notes, and retains the round-two table separators. Paragraph and sentence focused checks pass. The one-load/determinism problem is tracked separately as F8.
- minimal_fix: None for the original segmentation-boundary defect.
- status: fixed

### F7 - Required focused Rust hygiene gates remain green
- severity: minor
- files: `crates/engine/src/lib.rs`; `crates/engine/src/local_api.rs`; `crates/engine/src/mineru.rs`; `crates/filter-pdf/src/lib.rs`
- problem: Fixed. Format and strict Clippy pass for the Engine and PDF filter, and all scoped tests are green.
- minimal_fix: None.
- status: fixed

### F8 - Custom SRX is loaded and compiled once per MinerU block instead of once per import
- severity: minor
- files: `crates/filter-pdf/src/lib.rs:1056-1080`; `crates/engine/src/mineru.rs:1075-1109`
- problem: `blocks_to_units` calls `segment_pdf_text` inside the block loop, and that helper performs `metadata`, `read_to_string`, SRX XML parsing, and regex compilation on every call when `srxPath` is present. The response guard permits up to `max_pages * 500` blocks, so a valid custom-SRX import can perform thousands of synchronous reads/parses after the HTTP response. It also allows one document to use different rules across blocks if the SRX file changes mid-import. The local PDF path loads the rules once before iterating blocks, so the new helper is not equivalent in performance or determinism.
- minimal_fix: Prepare the segmentation mode and `SrxRules` once per import, then pass a reusable segmenter/rule reference through all MinerU blocks. Add an exact custom-SRX regression with multiple blocks and a test-only loader/parser counter proving one preparation per import.
- status: open

## assumptions
- Explicit-only MinerU routing remains the accepted interim contract; automatic per-page MinerU fallback is future work.
- Live MinerU interoperability is not required by this task's mock-focused acceptance.
- The review inspected the resolved lopdf 0.34 source used by this build to verify object-stream decompression and page-iterator behavior; the F2 judgment is not based only on dependency naming.

## residual_risks
- No deployed MinerU version was exercised; the mock proves the Engine's expected envelope, not external API compatibility.
- The HTTP response is still fully buffered before the 64 MiB response cap is checked.
- Bounding boxes still project onto fixed US Letter dimensions and confidence remains hard-coded to `900`.
- Re-import preview still uses the ordinary PDF filter rather than the MinerU path.
- The in-repo secret workspace scan still covers top-level ordinary files rather than recursively scanning every managed directory, although round-two independent evidence performed a recursive scan.
- MinerU metadata now stores `blockCount = units.len()`, so sentence/SRX splitting makes that property a segment count rather than a layout-block count; no current consumer was found.
- The task context manifests remain seed-only.

## acceptance_assessment
- AC-01: pass for the mock import and functional block-to-segment mapping; F8 leaves an optional custom-SRX scaling/determinism defect.
- AC-02: not ready because F2 can turn page-limit preflight into unbounded/partial parsing instead of a typed bounded failure.
- AC-03: pass for current code; secret-bearing Debug and credential surfaces remain redacted.
- AC-04: focused pass; all requested/scoped tests, format, and strict Clippy are green.

## summary_for_orchestrator
- verdict: need_fix
- open_blockers: 0
- open_majors: 1 (`F2`)
- open_minors: 1 (`F8`)
- needs_evidence: 0
- fixed_this_round: `F1`, `F3`, `F6`
- still_open_from_prior: `F2`
- ready_for_closeout: false
- summary: Round 3 closes the routing enum, legacy local-API taxonomy, and functional PDF/SRX segmentation findings, with all scoped quality gates green. Closeout is still blocked because the new lopdf preflight eagerly expands unbounded object streams and silently tolerates partial page-tree traversal, so it is not a safe resource-limit gate. Custom SRX is also re-read/recompiled per block rather than once per import.
- next_action: Fix `F2` and `F8`, run the Verify mission above, write `review/verify-3.md`, and resume review with the full report.
- resume_hint: Resume from `review/findings-3.md` after the fix and full `review/verify-3.md`; do not request research.

