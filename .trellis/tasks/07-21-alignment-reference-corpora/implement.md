# Implementation Plan: Alignment And Reference Corpora

## Ordered Checklist

- [ ] Add `alignment-core` with bounded deterministic DP candidates, typed
      evidence, stable tie-breaking, partition validation, and quality/limit
      fixtures for `1:1`, `1:N`, `N:1`, and unaligned moves.
- [ ] Add migration 12 plus storage models/queries for sessions, segment
      snapshots, links, corpora, and corpus entries; prove fresh/upgrade/strict/
      rollback/reopen behavior.
- [ ] Implement revisioned session create/list/get/page and atomic manual
      replace/status mutations with one-owner/non-crossing/order invariants.
- [ ] Implement optional bounded provider-backed refinement with strict JSON
      parsing and whole-request validation; keep accepted output proposed.
- [ ] Implement atomic/idempotent selected alignment-to-TM apply with complete
      provenance, deduplication, history, and stale/read-only/locale rollback.
- [ ] Implement filtered corpus import staging, alignment-to-corpus creation,
      list/search/reindex/remove, managed-source cleanup, provenance, and bounds.
- [ ] Add protocol structs/catalog/dispatch/error mapping and regenerate JSON
      Schema plus TypeScript contracts; keep concordance/grounding additive.
- [ ] Extend AI grounding with bounded corpus matches and visible provenance;
      extend authoritative concordance with additive corpus results.
- [ ] Build the Project Insights Alignment/Corpora workflow, trusted dialog,
      correction controls, terminal/stale/error states, corpus management/search,
      Workbench concordance corpus results, and supported responsive layouts.
- [ ] Extend stdio smoke through create/edit/restart/refine/apply, corpus import/
      search/reindex/remove, grounding, stale/rollback/idempotence, and cleanup.
- [ ] Add real-Engine Electron E2E and screenshots at 1250x744, 1680x942, and
      1920x1080 with keyboard labels, no overlap/overflow, and no console errors.
- [ ] Run focused and full local/VPS/release gates, update backend/frontend
      executable specs, and record exact acceptance evidence before commit.

## Data-Flow Review Checklist

- [ ] Document selectors -> generated RPC -> Engine snapshots -> alignment-core
      -> Store transaction is mapped without renderer scoring.
- [ ] Every link member resolves to one immutable session snapshot and at most
      one active link; all mutations revalidate expected revisions.
- [ ] AI provider output is bounded, strict, ID-only, and cannot confirm/apply.
- [ ] TM apply and corpus mutations have explicit atomic and idempotent owners.
- [ ] Corpus filters and managed copies reuse existing safety/publication helpers.
- [ ] Concordance and grounding preserve source/file/path provenance and treat
      corpus content as data.
- [ ] Every failure path leaves document, TM, corpus, operation, revision, and
      managed-source state unchanged or deliberately recoverable.

## Risk Files

`Cargo.toml`, new `crates/alignment-core/`, `crates/asset-core/src/lib.rs`,
`crates/ai-core/src/lib.rs`, `crates/protocol/src/lib.rs`,
`crates/storage/src/{migrations.rs,store.rs,lib.rs}`,
`crates/engine/src/{lib.rs,ai.rs}`, generated `packages/contracts/src/*`,
`apps/desktop/src/{main,preload,shared,renderer}/`,
`apps/desktop/tests/e2e/workbench.spec.ts`, `scripts/engine-smoke.mjs`, and
backend/frontend specs.

`Workbench.tsx` and `styles.css` already contain unrelated visual-polish work;
preserve it and stage only alignment/corpus hunks at the later commit gate.

## Validation Commands

Focused:

```text
cargo fmt --all -- --check
cargo test -p translunar-alignment-core -p translunar-asset-core
cargo test -p translunar-storage -p translunar-protocol -p translunar-engine
pnpm --filter @translunar/desktop test
pnpm typecheck
```

Cross-layer:

```text
pnpm contracts:check
pnpm exec eslint apps packages/contracts/src
pnpm -r --if-present test
pnpm build:desktop
node scripts/engine-smoke.mjs
pnpm --filter @translunar/desktop test:e2e
```

VPS/release:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p translunar-engine
cargo build -p translunar-engine --release --target x86_64-pc-windows-gnu
```

## Acceptance Evidence To Record

- Alignment golden fixtures, deterministic hashes, transition/evidence scores,
  large-input work bounds, and manual partition invariant matrices.
- Strict AI response fixtures for accepted, unknown, duplicate, crossing,
  oversized, malformed, unavailable, and canceled refinement.
- TM apply row/revision/history/provenance counts across success, duplicate,
  stale document/segment/link/library, read-only, locale mismatch, rollback,
  restart, and retry.
- Corpus managed-source digest, bilingual/monolingual projection, provenance,
  search ranking, reindex equality, removal isolation, malformed import cleanup,
  concordance, and grounding section assertions.
- Contract/schema byte equality, stdio output, desktop screenshots/E2E, release
  binary path/hash, and any unrelated dirty-tree caveat.

## Rollback Points

- Keep protocol dispatch disabled until migration and pure alignment tests pass.
- Do not persist a session before all candidates and snapshots validate.
- Do not call AI for more than the bounded selected candidate set and never
  accept provider text outside the strict response schema.
- Do not expose corpus results in concordance/grounding until provenance and
  paging tests pass.
- Failed staging or transaction work must leave the prior retryable state and
  must not remove original documents, TM units, or unrelated managed sources.
