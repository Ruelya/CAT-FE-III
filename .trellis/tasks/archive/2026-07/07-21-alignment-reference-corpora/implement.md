# Implementation Plan: Alignment And Reference Corpora

## Ordered Checklist

- [x] Add `alignment-core` with bounded deterministic DP candidates, typed
      evidence, stable tie-breaking, partition validation, and quality/limit
      fixtures for `1:1`, `1:N`, `N:1`, and unaligned moves.
- [x] Add migration 12 plus storage models/queries for sessions, segment
      snapshots, links, corpora, and corpus entries; prove fresh/upgrade/strict/
      rollback/reopen behavior.
- [x] Implement revisioned session create/list/get/page and atomic manual
      replace/status mutations with one-owner/non-crossing/order invariants.
- [x] Implement optional bounded provider-backed refinement with strict JSON
      parsing and whole-request validation; keep accepted output proposed.
- [x] Implement atomic/idempotent selected alignment-to-TM apply with complete
      provenance, deduplication, history, and stale/read-only/locale rollback.
- [x] Implement filtered corpus import staging, alignment-to-corpus creation,
      list/search/reindex/remove, managed-source cleanup, provenance, and bounds.
- [x] Add protocol structs/catalog/dispatch/error mapping and regenerate JSON
      Schema plus TypeScript contracts; keep concordance/grounding additive.
- [x] Extend AI grounding with bounded corpus matches and visible provenance;
      extend authoritative concordance with additive corpus results.
- [x] Build the Project Insights Alignment/Corpora workflow, trusted dialog,
      correction controls, terminal/stale/error states, corpus management/search,
      Workbench concordance corpus results, and supported responsive layouts.
- [x] Extend stdio smoke through create/edit/restart/refine/apply, corpus import/
      search/reindex/remove, grounding, stale/rollback/idempotence, and cleanup.
- [x] Add real-Engine Electron E2E and screenshots at 1250x744, 1680x942, and
      1920x1080 with keyboard labels, no overlap/overflow, and no console errors.
- [x] Run focused and full local/VPS/release gates, update backend/frontend
      executable specs, and record exact acceptance evidence before commit.

## Data-Flow Review Checklist

- [x] Document selectors -> generated RPC -> Engine snapshots -> alignment-core
      -> Store transaction is mapped without renderer scoring.
- [x] Every link member resolves to one immutable session snapshot and at most
      one active link; all mutations revalidate expected revisions.
- [x] AI provider output is bounded, strict, ID-only, and cannot confirm/apply.
- [x] TM apply and corpus mutations have explicit atomic and idempotent owners.
- [x] Corpus filters and managed copies reuse existing safety/publication helpers.
- [x] Concordance and grounding preserve source/file/path provenance and treat
      corpus content as data.
- [x] Every failure path leaves document, TM, corpus, operation, revision, and
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

- VPS `cargo test --workspace` passed every crate, including 14 alignment-core,
  43 Engine, 65 storage, and 8 protocol tests. These cover golden transitions,
  deterministic bounds, strict refinement graphs, atomic/idempotent TM apply,
  stale/rollback matrices, corpus lifecycle, concordance, and grounding.
- VPS `cargo fmt --all -- --check`, strict workspace Clippy, and
  `pnpm contracts:check` passed; the latter reported `Protocol contracts are
  current.` Backend and frontend executable contracts are recorded in
  `.trellis/spec/backend/engine-boundary.md` and
  `.trellis/spec/frontend/electron-workbench.md`.
- VPS `pnpm test:e2e:engine` passed the real stdio process, including restart,
  refinement, apply, import/search/reindex/remove, concordance, grounding,
  malformed cleanup, stale rollback, and retry/idempotence assertions.
- Local focused Electron E2E passed in 6.4 seconds. The full real-Engine suite
  passed 10 tests with one platform-gated PDF test skipped in 2.0 minutes.
  Alignment and corpus screenshots passed document overflow checks and visual
  inspection at 1250x744, 1680x942, and 1920x1080; console/page errors were
  empty. Unit tests passed 21/21 across six Vitest files; ESLint, desktop
  typecheck, desktop build, and scoped Prettier checks passed.
- VPS optimized Linux and Windows GNU Engine builds passed. The Windows binary
  is `/home/ubuntu/workspaces/cat-alignment-core-20260722-a/target/x86_64-pc-windows-gnu/release/translunar-engine.exe`, 37,947,204 bytes,
  SHA-256 `161441dd06cebb5a70de169900b38b815db472fb1eebb06200528d5773c10cc7`.
  The synchronized local E2E binary has the same size and hash.
- Local Node 24 emits the existing Node-22 engine warning. Local Rust contract
  generation remains blocked because `link.exe` resolves to GNU `link`; the
  same contract gate passed on VPS. Local stdio smoke reaches the Windows PDF
  import and stops because that release binary has no local PDF toolchain; the
  complete Linux stdio smoke passed on VPS. Full-repository Prettier also sees
  unrelated untracked `.devin` files, so project/task paths were checked
  directly. Approximately 125 unrelated dirty files were left untouched.

## Rollback Points

- Keep protocol dispatch disabled until migration and pure alignment tests pass.
- Do not persist a session before all candidates and snapshots validate.
- Do not call AI for more than the bounded selected candidate set and never
  accept provider text outside the strict response schema.
- Do not expose corpus results in concordance/grounding until provenance and
  paging tests pass.
- Failed staging or transaction work must leave the prior retryable state and
  must not remove original documents, TM units, or unrelated managed sources.
