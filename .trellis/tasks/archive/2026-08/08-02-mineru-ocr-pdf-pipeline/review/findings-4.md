# Findings round 4

## meta
- task: `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline`
- requested_branch: `task/08-02-mineru-ocr-pdf-pipeline`
- review_worktree_branch: `Ruelya/08-02-mineru-ocr-review-r4` (same candidate commit as requested branch)
- head_sha: `0358430b3eddda5586a75ec1cdfd7bad9499cd3a`
- base_branch: `master` (`a0ce2124810fdc95216c3bf3e1c0e1a40fede3a0`)
- round: 4
- prior_findings: `review/findings-1.md`, `review/findings-2.md`, `review/findings-3.md`
- mode: review only; no product code changed and no commit created
- context_notes:
  - `check.jsonl` remains seed-only, with no attached research.
  - No `review/verify-*.md` report exists for this task; the runtime evidence below was run directly during this review.
  - The requested task branch and this review worktree resolve to the same HEAD, and the worktree was clean before this findings file was written.
- runtime_evidence:
  - `cargo test -p translunar-engine mineru -- --nocapture`: PASS, 31 passed / 0 failed.
  - `cargo test -p translunar-engine local_api`: PASS, 6 passed / 0 failed.
  - `cargo test -p translunar-filter-pdf --lib`: PASS, 14 passed / 0 failed.
  - `cargo fmt --all -- --check`: PASS.
  - `cargo clippy -p translunar-engine -p translunar-filter-pdf --all-targets -- -D warnings`: PASS.

## need_verify
- required: true

### Verify mission
- purpose: Prove that the next F2 fix bounds the PDF parser before any dependency decompression/allocation can amplify attacker-controlled input, while preserving valid scanned PDFs and the now-correct one-prepare-per-import SRX behavior.
- questions:
  - Is every object/xref-stream decoder and filter chain that can reach `lopdf` handled under explicit compressed-byte, decoded-byte, object-count, and wall-clock limits, including LZW, indirect `/Filter` or `/Length`, padded dictionaries, and non-LF stream line endings?
  - Is the parser load itself supervised or structurally bounded before allocation/decompression, rather than checking elapsed time and object count only after `Document::load_mem` returns?
  - Does the strict walk reject missing, malformed, or inconsistent `/Count` values at every `/Pages` node, cycles, deep trees, missing kids, and partial references without accepting a partial count?
  - Does preflight avoid decoding unrelated page-content/image streams, so a valid scanned PDF within the documented source-byte/page limits is not rejected merely because its decoded image content exceeds the object-stream budget?
  - Do all preflight failures occur before credential access, MinerU transport, managed-source publication, and project persistence, while F8 still prepares custom SRX exactly once per import?
- success_criteria:
  - LZW and structurally obscured Flate object/xref amplification fixtures terminate inside hard limits with a typed `resource_limit_exceeded` or documented typed invalid-PDF error; process memory/time is bounded during load, not only afterward.
  - Oversized xref/object tables, deep/cyclic/malformed trees, and every nested `/Count` mismatch fail closed with no partial page count.
  - A valid image-heavy/scanned PDF under the configured file/page limits passes page preflight without decoding or aggregating unrelated content streams.
  - Over-limit or malformed fixtures record zero credential reads, zero transport calls, and no durable import artifacts.
  - The multi-block custom-SRX regression still reports one preparation and exact expected unit text/order/paths.
  - Focused MinerU, local-API, PDF-filter, format, and strict Clippy gates remain green.
- failure_signals:
  - Any supported `lopdf` decoder can allocate an unbounded `Vec` before the project limit layer can stop it, or a raw 512-byte lookback/stream-token heuristic can be bypassed.
  - A timeout is reported only after an unbounded parser call completes, or the object-count cap is applied only after the object map has already been materialized.
  - Valid scanned content is rejected because ordinary page/image streams are decompressed into the page-tree aggregate budget.
  - A malformed nested `/Count` is ignored, a partial traversal is accepted, or any failed preflight touches credentials, HTTP, managed sources, or SQLite.
  - SRX metadata/XML/regexes are prepared more than once per import or exact custom-SRX units drift.
- suggested_commands:
  - `cargo test -p translunar-filter-pdf --lib`
  - `cargo test -p translunar-engine mineru -- --nocapture`
  - `cargo test -p translunar-engine local_api`
  - Add focused fixtures for an LZW object/xref-stream bomb, padded/indirect/multi-filter Flate metadata, CR-only stream syntax, oversized xref/object counts, nested `/Count` mismatch, and a valid image-heavy scanned PDF.
  - Run the hostile fixtures under a supervised subprocess or equivalent memory/time observation so the bound is demonstrated at the process boundary, not inferred only from a returned error.
  - `cargo fmt --all -- --check`
  - `cargo clippy -p translunar-engine -p translunar-filter-pdf --all-targets -- -D warnings`
- scope: `crates/filter-pdf/src/page_tree.rs`, its focused fixtures/tests, `crates/engine/src/mineru.rs` preflight/error mapping, and the existing F8 regression only.
- avoid: Live MinerU, full workspace/desktop/Electron suites, unrelated PDF extraction redesign, and product changes outside F2 regression containment.
- related_issues: `F2`; regression protection for fixed `F8`, `F1`, and `F3`.

## issues

### F1 - OCR routing remains closed and fails invalid enums before either PDF implementation
- severity: major
- files: `crates/engine/src/mineru.rs:1010-1052`; `crates/engine/src/lib.rs:4807-4842`
- problem: Fixed in round 3 and unchanged in round 4. Invalid routing is rejected before either implementation, and the focused MinerU suite remains green.
- minimal_fix: None.
- status: fixed

### F2 - The new preflight still enters unbounded dependency decompression/load paths
- severity: major
- files: `crates/filter-pdf/src/page_tree.rs:37-80`; `crates/filter-pdf/src/page_tree.rs:93-186`; `crates/filter-pdf/src/page_tree.rs:263-414`; `crates/engine/src/mineru.rs:851-879`
- problem: The strict recursive page-tree walk, genuine Flate `/ObjStm` fixture, cycle/depth checks, and pre-credential page-limit test are material improvements, but the resource gate is still not closed. `guard_flate_streams` is a raw token scan with a 512-byte lookback that recognizes only directly described Flate streams, then calls `lopdf::Document::load_mem`. The resolved `lopdf` 0.34 loader also expands LZW object streams and xref streams into unbounded `Vec`s; an LZW stream, an indirect or sufficiently padded `/Filter` or `/Length`, or other syntax the raw scan misses reaches that decompressor without the 8/32 MiB caps. The five-second timer and 50,000-object check do not supervise the load: elapsed time is checked before it and during the later tree walk, while object count is checked only after the full document/object streams have already been materialized. A source below 200 MiB can therefore still amplify memory or monopolize the Engine before returning a typed error. The scan also decodes every detected Flate stream, not only xref/ObjStm streams, so valid image-heavy scanned PDFs can consume the aggregate 32 MiB budget even though `lopdf` would not need to decompress those content streams for page counting. Finally, malformed `/Count` values are converted to `None` and ignored, and child declared counts are discarded, so the claimed strict count-consistency check applies only to a valid root count. The passing tests cover direct Flate fixtures and do not exercise these bypasses.
- minimal_fix: Do not invoke the general `lopdf` loader until stream dictionaries/xref metadata are structurally parsed under hard limits. Either implement a bounded page-tree reader that explicitly handles or rejects every filter/filter-chain and indirect metadata form before decoding only xref/ObjStm data, with pre-load xref/object/time budgets, or isolate the parser behind a supervised process with hard memory/time limits. Avoid decoding ordinary page/image content. Require and validate `/Count` at every `/Pages` node. Add LZW, padded/indirect Flate, line-ending/filter-chain, oversized-object/xref, nested-count-mismatch, and valid image-heavy regressions, with zero credential/transport/persistence assertions.
- status: open

### F3 - Shared classification retains the legacy local-API taxonomy and MinerU codes
- severity: major
- files: `crates/engine/src/lib.rs:354-431`; `crates/engine/src/local_api.rs:364-398`
- problem: Fixed in round 3 and unchanged. The complete six-test local-API focused suite passes.
- minimal_fix: None.
- status: fixed

### F4 - Secret-bearing generic Debug output remains redacted
- severity: major
- files: `crates/engine/src/mineru.rs:92-104`; `crates/engine/src/mineru.rs:342-366`; `crates/protocol/src/lib.rs:2305-2317`
- problem: Fixed in round 2 and unchanged.
- minimal_fix: None.
- status: fixed

### F5 - The Engine credential lifecycle remains supported
- severity: major
- files: `crates/protocol/src/lib.rs:259-261`; `crates/engine/src/lib.rs:3331-3348`; `docs/mineru-ocr.md:18-32`
- problem: Fixed in round 2 and unchanged.
- minimal_fix: None.
- status: fixed

### F6 - MinerU blocks retain the shared PDF segmentation semantics
- severity: minor
- files: `crates/filter-pdf/src/lib.rs:1047-1123`; `crates/engine/src/mineru.rs:1084-1134`
- problem: Fixed in round 3 and unchanged. Paragraph/sentence behavior and structural paths remain covered; F8's preparation lifecycle is assessed separately.
- minimal_fix: None.
- status: fixed

### F7 - Required focused Rust hygiene gates remain green
- severity: minor
- files: `crates/engine/src/mineru.rs`; `crates/filter-pdf/src/lib.rs`; `crates/filter-pdf/src/page_tree.rs`
- problem: Fixed. Format, strict Engine/PDF Clippy, and all scoped tests pass at round-4 HEAD.
- minimal_fix: None.
- status: fixed

### F8 - Custom SRX is prepared once and reused across all MinerU blocks
- severity: minor
- files: `crates/filter-pdf/src/lib.rs:1047-1111`; `crates/engine/src/mineru.rs:1084-1134`; `crates/engine/src/mineru.rs:1989-2072`
- problem: Fixed. `blocks_to_units` constructs one `PdfTextSegmenter` before entering the block loop and reuses its compiled rules for every block. The three-block custom-SRX regression observes exactly one preparation and asserts the exact six unit texts plus stable per-block structural paths. The 31-test MinerU suite passes.
- minimal_fix: None.
- status: fixed

## assumptions
- Explicit-only MinerU routing remains the accepted interim contract; automatic per-page fallback is future work.
- Live MinerU interoperability is outside this mock-focused task acceptance.
- The F2 judgment includes direct inspection of the resolved `lopdf` 0.34 sources: object/xref streams call generic decompression, and its LZW/Flate implementations allocate output vectors without project-owned caps.
- Reviewer-run focused commands are valid evidence for the observed green gates, but a post-fix verifier should still answer the hostile-resource mission above in `review/verify-4.md`.

## residual_risks
- No deployed MinerU version was exercised; the mock proves the Engine's expected envelope, not external API compatibility.
- The HTTP response remains fully buffered before the 64 MiB response cap is checked.
- Bounding boxes still project onto fixed US Letter dimensions and confidence remains hard-coded to `900`.
- Re-import preview still uses the ordinary PDF filter rather than the MinerU path.
- The SRX preparation counter is production-visible test instrumentation in `translunar-filter-pdf`; this is not a closeout blocker but should be feature-gated or replaced with an injectable loader if the public API is later stabilized.
- The task context manifests remain seed-only.

## acceptance_assessment
- AC-01: pass for mock MinerU import, exact custom-SRX mapping, and one preparation per import.
- AC-02: not ready because F2 still allows parser resource amplification before a typed bounded failure.
- AC-03: pass for current code; credential and Debug surfaces remain redacted.
- AC-04: focused pass; all requested/scoped tests, format, and strict Clippy are green.

## summary_for_orchestrator
- verdict: need_fix
- open_blockers: 0
- open_majors: 1 (`F2`)
- open_minors: 0
- needs_evidence: 0
- fixed_this_round: `F8`
- still_open_from_prior: `F2`
- ready_for_closeout: false
- summary: Round 4 closes F8 and keeps all focused quality gates green. F2 is improved but not closed: the raw Flate scan does not cover every decompressor or structural encoding that `lopdf` can expand, and the timer/object caps apply only after the unsupervised document load has already done the risky work. Closeout remains blocked on one major resource-boundary defect.
- next_action: Replace or supervise the pre-load parser boundary as described in F2, run the Verify mission above, write `review/verify-4.md`, and resume review with the full report.
- resume_hint: Resume from `review/findings-4.md` after the F2 fix and full `review/verify-4.md`; do not request research.
