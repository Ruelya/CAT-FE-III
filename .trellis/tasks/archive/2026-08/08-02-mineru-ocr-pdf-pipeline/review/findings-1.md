# Findings round 1

## meta
- task: `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline`
- requested_branch: `task/08-02-mineru-ocr-pdf-pipeline`
- review_worktree_branch: `Ruelya/08-02-mineru-ocr-review` (same candidate commit as requested branch)
- head_sha: `47954759c8dc908122c66b6d2538784e333989b8`
- base_branch: `master` (`a0ce212`)
- round: 1
- mode: review only; no product code changed
- runtime_evidence:
  - `cargo test -p translunar-engine mineru -- --nocapture`: PASS, 14 passed / 0 failed
  - `cargo fmt --all -- --check`: FAIL on the MinerU changes
  - `cargo clippy -p translunar-engine --all-targets -- -D warnings`: FAIL with 9 MinerU-owned warnings/errors

## need_verify
- required: true
- reason: The current focused suite passes but does not exercise the non-OCR routing contract, page-limit preflight, local-API/batch error codes, production credential provisioning, or log/Debug redaction. Those paths need focused runtime regression coverage after fixes.
- suggested_commands:
  - `cargo fmt --all -- --check`
  - `cargo clippy -p translunar-engine --all-targets -- -D warnings`
  - `cargo test -p translunar-engine mineru -- --nocapture`
  - Run new focused tests proving text-layer PDFs and `ocrEngine=tesseract` / `ocrMode=never` never call MinerU, oversized page ranges fail before transport, and local API/batch surfaces retain typed MinerU error codes.
  - Scan the disposable workspace's `translunar.sqlite3*`, managed sources, and captured stderr for the test secret; do not scan only the main SQLite file.

## issues

### F1 — Configured auto mode replaces the non-OCR PDF path
- severity: major
- files: `crates/engine/src/mineru.rs:719-743`; `crates/engine/src/lib.rs:4766-4786`; `crates/engine/src/lib.rs:14505-14544`; `docs/mineru-ocr.md:20-35`
- problem: `should_handle` returns true for empty/default options whenever a MinerU base URL exists, before `PdfFilter` can inspect whether the PDF already has meaningful text. Consequently every ordinary text-layer PDF becomes dependent on the MinerU key and network, contradicting the design's statement that Poppler remains the non-OCR extraction path. The passing `mineru_network_failure_is_typed_and_leaves_project_clean` test confirms this behavior by expecting a default-options PDF import to fail when MinerU is unavailable. The inverse selection is also unsafe: explicit `ocrEngine=mineru` with no base URL returns false and silently falls through to the local filter instead of returning a typed configuration error. The `tesseract` and `ocrMode=never` opt-outs are present in `should_handle`, but only at helper-test level.
- minimal_fix: Define closed routing semantics. Explicit `mineru` must select MinerU and return a typed configuration/authentication failure when it is unusable; explicit `tesseract`/`poppler`/`local` and `ocrMode=never` must stay local. For `auto`, preserve local text-layer extraction and invoke MinerU only for pages/documents that actually require OCR (or require explicit `mineru` until a per-page fallback exists). Add Engine-level tests with a real text-layer fixture proving zero mock-transport calls, plus end-to-end opt-out and explicit-missing-config tests.
- status: open

### F2 — The configured page limit is bypassed for normal imports
- severity: major
- files: `crates/engine/src/mineru.rs:385-400`; `crates/engine/src/mineru.rs:759-781`; `crates/engine/src/mineru.rs:875-905`; `crates/engine/src/mineru.rs:1173-1194`
- problem: The preflight page-limit check runs only when `pageRange` contains an explicit end page. The default range and `pageRange=N` both produce `end_page=None`, so the implementation never determines the PDF page count and can submit an arbitrarily long remainder of the document despite `max_pages`. This violates R1 and the design requirement to reject page-limit violations before the HTTP call. The only pre-network limit regression covers file bytes, not pages.
- minimal_fix: Determine the selected page count before reading the credential or invoking transport, validate the range against the real PDF page count, and reject any selected span above `max_pages`. Add regressions for an over-limit full document and an over-limit `pageRange=N`, asserting the transport call count remains zero.
- status: open

### F3 — Typed MinerU errors degrade to `internal_error` outside JSON-RPC
- severity: major
- files: `crates/engine/src/lib.rs:354-406`; `crates/engine/src/lib.rs:4042-4147`; `crates/engine/src/lib.rs:4813-4890`; `crates/engine/src/lib.rs:8063-8118`; `crates/engine/src/local_api.rs:76-93`; `crates/engine/src/local_api.rs:366-419`
- problem: `rpc_error` correctly maps missing credential, credential-store failure, auth, timeout, unavailable, protocol/empty, and resource-limit cases. However, the shared batch diagnostic mapper and the local HTTP adapter do not match `EngineError::MinerU`; both fall through to `internal_error` (and HTTP 500). Therefore best-effort/atomic batch imports and `POST /v1/projects/:id/import` lose the typed degradation required by R4/AC-02, even though direct JSON-RPC preserves it.
- minimal_fix: Centralize one exhaustive Engine error classification used by JSON-RPC, local HTTP, CLI/batch diagnostics, with stable codes/data for all MinerU variants. Add focused assertions for missing key, unavailable, timeout, auth, protocol, and resource-limit responses on local API and batch import surfaces.
- status: open

### F4 — Secret-bearing MinerU values have unredacted generic `Debug`
- severity: major
- files: `crates/engine/src/mineru.rs:91-101`; `crates/engine/src/mineru.rs:332-342`; `.trellis/spec/backend/logging-guidelines.md:49-62`
- problem: `MemoryMinerUCredentialStore` and `MinerUParseRequest` derive `Debug` while containing the raw API key as `String`. Rust's derived representation prints those fields, so any diagnostic such as `request = ?request`, assertion context, or generic error instrumentation would expose the credential. This directly violates the backend rule that secrets must not be hidden in generic `Debug` output and makes AC-03's "never in logs" guarantee fragile. The current tests inspect imported values/error text and the main SQLite file, but do not test Debug/log redaction.
- minimal_fix: Store the credential in a redacting, zeroizing wrapper (the workspace already has `SecretString`) or implement custom redacted `Debug`; remove secret-bearing derived Debug implementations. Add a regression proving Debug/captured stderr cannot contain a sentinel secret, and scan SQLite main/WAL/SHM plus managed files rather than only `translunar.sqlite3`.
- status: open

### F5 — Production code can read a keyring entry but exposes no supported way to provision it
- severity: major
- files: `crates/engine/src/mineru.rs:159-237`; `crates/engine/src/mineru.rs:679-697`; `crates/engine/src/lib.rs:3289-3314`; `docs/mineru-ocr.md:7-18`
- problem: The OS-keyring backend implements `set`, `status`, and `delete`, but the service methods are explicitly dead code reserved for a future CLI/settings surface. Production `EngineService` exposes only test-only injection helpers, and the documentation merely lists the service/account names without a supported provisioning command. The shipped path can therefore load only a credential that was pre-seeded out of band; WP2's store/load requirement is not complete or independently testable through a product boundary.
- minimal_fix: Add the smallest Engine-owned status/set/delete surface consistent with existing credential patterns, returning presence/backend only and never the secret, or explicitly document and test a supported external provisioning mechanism if that is the intended contract. Cover the memory backend and production keyring adapter without persisting secret bytes in SQLite.
- status: open

### F6 — MinerU mapping bypasses the existing PDF segmentation path
- severity: minor
- files: `crates/engine/src/mineru.rs:515-633`; `crates/engine/src/mineru.rs:907-936`; `crates/filter-pdf/src/lib.rs:1138-1223`
- problem: The design specifies MinerU layout blocks flowing through the existing PDF block-to-segment model. Instead, `blocks_to_units` creates one `ImportedUnit` per mapped text item and ignores the PDF filter's SRX/`segmentationMode` behavior. Table HTML is stripped without inserting cell/row separators, so adjacent cells such as `Item` and `Qty` become `ItemQty`; the test only checks that the output contains `Item`. Imports succeed, but segment boundaries and structured table text can differ from the established PDF contract.
- minimal_fix: Reuse or expose a shared PDF block-to-unit/SRX mapping path, preserving caller segmentation options and meaningful table separators. Strengthen the fixture assertions to verify exact segment count/order/text and structural paths rather than substring-only success.
- status: open

### F7 — Required Rust hygiene gates are red
- severity: minor
- files: `crates/engine/src/lib.rs`; `crates/engine/src/mineru.rs`
- problem: The focused MinerU tests are green, satisfying the narrow AC-04 command, but `cargo fmt --all -- --check` reports formatting diffs and strict Clippy fails with 9 task-owned findings (`collapsible_if`, `iter_overeager_cloned`, and `field_reassign_with_default`). The backend quality gate is therefore not clean.
- minimal_fix: Apply `cargo fmt`, resolve the reported Clippy findings without suppressing them, then rerun format, strict Clippy, and the focused MinerU suite.
- status: open

## residual_risks
- No live MinerU interoperability was run. The mock proves the internal envelope currently expected by the code, not compatibility with a deployed MinerU version.
- The HTTP response is fully buffered before the 64 MiB limit is checked, so a malicious or broken endpoint can cause memory growth beyond the configured response cap.
- Bounding boxes are projected onto fixed US Letter dimensions and confidence is hard-coded to `900`; page-specific geometry/confidence fidelity remains unverified.
- Re-import preview uses the ordinary filter path rather than the MinerU path, so a MinerU-imported document may produce materially different segment boundaries on re-import.
- The task's `implement.jsonl` and `check.jsonl` still contain only seed examples, so they provide no additional review-context or verification manifest.

## acceptance_assessment
- AC-01: partial pass — mock Engine import creates persisted OCR segments, but F6 leaves the designed mapping/segmentation contract incomplete.
- AC-02: partial pass — direct Engine/JSON-RPC missing-key and network failures are typed and leave no document, but F1 and F3 break selection/cross-surface behavior.
- AC-03: not ready — no direct SQLite persistence path or MinerU log call was found, but F4 leaves a concrete generic-Debug secret leak and the SQLite test omits WAL/SHM/log capture.
- AC-04: partial pass — the requested focused suite passed 14/14; format and strict Clippy gates fail under F7.

## summary_for_orchestrator
- verdict: need_fix
- open_blockers: 0
- open_majors: 5 (`F1`, `F2`, `F3`, `F4`, `F5`)
- open_minors: 2 (`F6`, `F7`)
- ready_for_closeout: false
- summary: The mock import, segment persistence, direct typed RPC errors, clean-abort storage boundary, and Tesseract/never helper opt-outs are structurally present, and the focused suite passes. Closeout is blocked by default routing that replaces non-OCR PDF extraction, unenforced page limits, generic errors on local API/batch surfaces, unredacted secret Debug, and the absence of a supported production credential-provisioning boundary.
