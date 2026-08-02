## Bug Analysis: MinerU page-tree preflight not a bounded resource-limit gate

### 1. Root Cause Category
- **Category**: E — Implicit Assumption (+ D Test Coverage Gap)
- **Specific Cause**: Page-count preflight was treated as “any page counter that works on normal fixtures,” first via raw `/Type /Page` byte scan, then via unbounded `lopdf::Document::load` + silent `PageTreeIter`. A resource-limit gate requires explicit caps (decoded bytes, objects, depth, time) and fail-closed traversal; dependency convenience APIs do not provide that contract.

### 2. Why Fixes Failed
1. **Round 1 (raw marker scan)**: Surface fix for “have a number before network.” Missed compressed object streams, decoys, and stale objects — not a page tree.
2. **Round 2–3 (`Document::load` + `get_pages`)**: Incomplete scope. Real tree walking for ordinary PDFs, but load eagerly expands ObjStm/XRef with unbounded Flate output; iterator silently skips malformed kids and truncates depth. Tests used `doc.compress()` (content streams only), not genuine `/ObjStm` page dictionaries.

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Runtime bounds | Bounded Flate preflight + strict walk with depth/object/time/page caps; map breaches to `ResourceLimit` | DONE |
| P0 | Test coverage | Genuine ObjStm fixture; cyclic/deep/malformed/bomb fixtures; zero credential + zero transport on over-limit ObjStm | DONE |
| P1 | Architecture | Keep page-tree preflight in `filter-pdf::page_tree` as the only allowed counter for MinerU limits | DONE |
| P2 | Spec note | Document that preflight counters must not call unbounded third-party full-document load without decode caps | DONE (this file; bulk guide → closeout) |

### 4. Systematic Expansion
- **Similar Issues**: Any other preflight that uses full archive/document parsers (zip, OOXML, plugin packages) without decode/ratio caps — package paths already bound compression; keep PDF preflight aligned.
- **Design Improvement**: Resource-limit gates own their bounds; general-purpose PDF libraries are untrusted for amplification.
- **Process Improvement**: Review missions must require fixtures that exercise the threat (ObjStm, bombs), not surrogates (`compress()` only).

### 5. Knowledge Capture
- [x] Task break-loop write-up: `review/break-loop-page-tree-bounds.md`
- [ ] Closeout may fold a one-liner into filter-pdf / MinerU boundary notes if desired
- Product fix lives in `crates/filter-pdf/src/page_tree.rs` + MinerU error mapping

### Fix summary (this round)
- **F2**: `count_page_tree` → bounded Flate stream preflight, then load, then strict page-tree walk (cycle/depth/kids/Count mismatch fail closed). Bound breaches → `PdfError::ResourceLimit` → `MinerUError::ResourceLimit`.
- **F8**: `PdfTextSegmenter::prepare` once per import; `blocks_to_units` reuses `segment`; thread-local prepare counter + exact multi-block custom-SRX test.
