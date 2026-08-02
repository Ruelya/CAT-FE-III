## Bug Analysis: MinerU page-tree preflight not a bounded resource-limit gate

### 1. Root Cause Category
- **Category**: E — Implicit Assumption (+ D Test Coverage Gap)
- **Specific Cause**: Page-count preflight was treated as “any page counter that works on normal fixtures,” first via raw `/Type /Page` byte scan, then via unbounded `lopdf::Document::load` + silent `PageTreeIter`, then via a raw Flate token scan + unsupervised `load_mem`. A resource-limit gate requires: (1) structural knowledge of **which** streams the dependency expands (ObjStm + XRef only), (2) hard caps on those paths **before** the dependency allocates, (3) fail-closed filter/metadata policy (LZW / multi / indirect rejected), and (4) strict `/Count` at every `/Pages` node. Convenience APIs and whole-file Flate scans do not provide that contract.

### 2. Why Fixes Failed
1. **Round 1 (raw marker scan)**: Surface fix for “have a number before network.” Missed compressed object streams, decoys, and stale objects — not a page tree.
2. **Round 2–3 (`Document::load` + `get_pages`)**: Incomplete scope. Real tree walking for ordinary PDFs, but load eagerly expands ObjStm/XRef with unbounded Flate/LZW output; iterator silently skips malformed kids and truncates depth. Tests used `doc.compress()` (content streams only), not genuine `/ObjStm` page dictionaries.
3. **Round 4 (`guard_flate_streams` + strict walk)**: Incomplete scope. 512-byte lookback + Flate-only token scan missed LZW, padded/indirect metadata, CR-only line endings; decoded **all** Flate streams (including images) into the aggregate budget; timer/object caps applied only after unsupervised `load_mem`; nested `/Count` ignored when malformed.

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Runtime bounds | Structural preflight of ObjStm/XRef only; bounded Flate; reject LZW/multi/indirect; xref Size budget; strict Count at every Pages; then load | DONE |
| P0 | Test coverage | ObjStm bomb, LZW ObjStm, padded dict, CR-only stream, nested Count mismatch, image-heavy pass, oversized xref Size | DONE |
| P1 | Architecture | Page-tree preflight remains in `filter-pdf::page_tree`; never treat content/image streams as load-time expandable | DONE |
| P2 | Spec note | Document that preflight must bound dependency **expand** paths only; bulk guide → closeout | DONE (this file) |

### 4. Systematic Expansion
- **Similar Issues**: Any preflight that uses full archive/document parsers (zip, OOXML, plugin packages) without decoding only the paths the dependency eagerly expands.
- **Design Improvement**: Resource-limit gates own their bounds; general-purpose PDF libraries are untrusted for amplification. Prefer “prove expandable streams safe → then load” over “load then measure.”
- **Process Improvement**: Review missions must require fixtures for **each** bypass class (LZW, pad/indirect, line endings, content-vs-ObjStm budget, nested Count), not only happy-path ObjStm.

### 5. Knowledge Capture
- [x] Task break-loop write-up: `review/break-loop-page-tree-bounds.md`
- [ ] Closeout may fold a one-liner into filter-pdf / MinerU boundary notes if desired
- Product fix lives in `crates/filter-pdf/src/page_tree.rs` (+ MinerU error mapping already maps `ResourceLimit`)

### Fix summary (round 5 / F2 close)
- **F2**: Replaced raw Flate scan with structural expandable-stream preflight (startxref chain + `/Type /ObjStm|/XRef` stream dicts). Only those streams are decoded under 8/32 MiB caps; LZW/multi/indirect Filter|/Length fail closed; content/image streams are not inflated; xref `Size` checked before load; every `/Pages` requires matching `/Count`; CR-only stream data start supported.
- **F8 / F1 / F3–F7**: Left unchanged (already fixed).
