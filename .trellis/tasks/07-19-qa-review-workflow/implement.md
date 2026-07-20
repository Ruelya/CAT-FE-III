# Implementation Plan: Comprehensive QA And Review Workflow

## Preconditions

- AI grounding, professional editor, termbase/TM assets, generated contracts,
  generic filters, and current QA/review primitives are committed and green.
- Use Codex inline mode. Read backend Engine/database/error/quality specs and
  frontend Electron/state/type/accessibility specs before editing.
- Preserve released migrations 1..8 and legacy QA/review method behavior.

## 1. QA Core

- [x] Add `crates/qa-core` types, validated built-in/custom profiles, stable
      rule taxonomy, Unicode scalar spans, bounded evidence and fingerprints.
- [x] Implement mechanical rules, CJK punctuation/spacing rules, custom regex,
      terminology input evaluation, and deterministic consistency grouping.
- [x] Implement escaped standalone HTML and valid formula-safe XLSX report
      generation plus unit fixtures for all rules and hostile text.

## 2. Domain And Storage

- [x] Generalize QA evidence/projections compatibly and add migration 9 for
      profiles, runs/items, waivers, overrides, columns, indexes and built-ins.
- [x] Implement profile CRUD/clone, locale default resolution, revision checks,
      segment/document/project reconciliation, run summaries and filtered pages.
- [x] Implement reasoned waiver/revoke, immutable report snapshots, gate queries,
      override transitions, review queue/stats and restart/migration coverage.

## 3. Engine And Protocol

- [x] Add typed `qa.*`/review queue/stats methods, errors and capabilities;
      keep legacy QA methods delegating to the new service and regenerate schema.
- [x] Reconcile live segment QA through target/tag/confirm mutations and reuse
      asset-core/editor-core rather than duplicating term/tag logic.
- [x] Gate generic and legacy exports with fresh QA, reasoned override records,
      valid no-clobber HTML/XLSX exports, and pipeline QA reuse.

## 4. Desktop

- [x] Build profile/scope controls, summary/filter/issue/detail views, location
      navigation, waiver/revoke and HTML/XLSX actions on the QA surface.
- [x] Add review queue/statistics and configurable review-required state while
      preserving revision diff, accept/reject, undo/redo and signed read-only.
- [x] Add export gate blockers and explicit override form; keep inline findings,
      keyboard/IME behavior, generated types, and three-viewport geometry sound.

## 5. Integration And Finish

- [x] Extend storage/Engine tests and stdio smoke through dirty multilingual
      fixtures, profile regex, project runs, reports, waivers, gate/override,
      review stats, restart, and legacy behavior.
- [x] Extend Electron E2E through the real Engine and capture QA/export/review
      surfaces at 1250x744, 1680x942 and 1920x1080 without overflow/errors.
- [x] Run full local/VPS Rust, protocol, smoke, Windows GNU, Node 22, desktop
      unit/build/E2E/performance/visual gates; update specs, commit and archive.

## Validation Commands

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
node scripts/engine-smoke.mjs
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

```bash
pnpm exec prettier --check .
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
cd apps/desktop && xvfb-run -a pnpm exec playwright test
```

## Rollback Points

- Migration 9 is additive; restore the automatic pre-v9 backup when reverting.
- A rule failure cannot partially replace other findings or carry a waiver to a
  changed fingerprint.
- Report and document exports validate and publish no-clobber; failed staging
  leaves the destination absent and records override failure when applicable.
- Renderer state never becomes the export gate, review statistic, or QA source
  of truth.
