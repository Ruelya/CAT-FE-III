# Implementation Plan: Offline Task Packages

## Ordered Checklist

- [x] Add `task-package-core` pure manifest, projection, limit, canonical-hash,
      safe-path, and three-way classification primitives with adversarial unit
      fixtures for every disposition and identical/divergent dual edits.
- [x] Add migration 13 for package records, immutable origin bindings, durable
      previews, and preview rows; add fresh/upgrade/reopen/strict/rollback
      storage tests.
- [x] Implement bounded `.tltask` ZIP export/import codecs in Engine using
      existing staging/no-clobber and managed-source helpers. Cover assignment
      slices, detached identity remapping, return projection, tamper, path,
      compression, limit, and missing-entry failures.
- [x] Add Store transactions for assignment import, return preview staging,
      three-way row persistence, selected merge, idempotent result replay, and
      explicit discard. Reuse editor/review/TM provenance rules and preserve
      local history.
- [x] Add protocol structs, method constants/catalog/dispatch/error mapping and
      regenerate `packages/contracts` without changing existing wire shapes.
- [x] Add Project Insights task-package workflow with trusted dialogs,
      assignment/return modes, paged classifications, selection/apply guards,
      stale/conflict/retry states, keyboard labels, and supported responsive
      layouts. Keep unrelated visual-polish work in `Workbench.tsx`/styles.css
      untouched.
- [x] Extend `scripts/engine-smoke.mjs` through assignment export/preview/import,
      detached edit/return export, conflict matrix, selected merge, restart,
      stale/tamper/no-clobber/rollback, and idempotent retry.
- [x] Add real-Engine Electron E2E and screenshots at 1250x744, 1680x942, and
      1920x1080; assert accessibility, no console/page errors, and no document
      horizontal overflow.
- [x] Run focused and full local/VPS/release gates, update executable backend
      and frontend specs with verified contracts/evidence, commit task-owned
      files only, and archive the child.

## Data-Flow And Review Gates

- [x] Every package entry is canonicalized and hash-checked before Store access.
- [x] Assignment import creates one normal project transaction and immutable
      local-to-origin bindings; no package ZIP is mounted as a database.
- [x] Preview is read-only and persists all rows, counts, hashes, and expected
      revisions for restart.
- [x] Apply validates every selected row inside one Immediate transaction and
      cannot partially update targets, tags, comments, TM, or history.
- [x] Return packages contain only bound changed rows and no credentials or
      unrelated assets.
- [x] Existing archive/interop/alignment/corpus/editor/TM flows remain green.

## Risk Files

`Cargo.toml`, new `crates/task-package-core/`,
`crates/protocol/src/lib.rs`, `crates/storage/src/{migrations.rs,store.rs,lib.rs}`,
`crates/engine/src/lib.rs`, generated `packages/contracts/src/*`,
`apps/desktop/src/{main,preload,shared,renderer}/`,
`apps/desktop/tests/e2e/workbench.spec.ts`, `scripts/engine-smoke.mjs`, and
backend/frontend executable specs. Preserve unrelated dirty Trellis, `.devin`,
visual-polish, `Workbench.tsx`, and `styles.css` changes.

## Validation Commands

Focused:

```text
cargo fmt --all -- --check
cargo test -p translunar-task-package-core -p translunar-storage -p translunar-protocol -p translunar-engine
pnpm --filter @translunar/desktop test
pnpm typecheck
```

Cross-layer:

```text
pnpm contracts:check
pnpm exec eslint apps packages/contracts/src
pnpm --filter @translunar/desktop build
node scripts/engine-smoke.mjs
pnpm --filter @translunar/desktop test:e2e
```

VPS/release:

```text
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --release -p translunar-engine
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

## Rollback Points

- Do not expose task-package methods until pure validation and migration tests
  pass.
- Do not create a detached project before the entire assignment is validated
  and staged.
- Do not apply any selected row outside one transaction or bypass existing
  confirmation/TM provenance rules.
- Keep open previews and staged files on failed merge so conflict selection can
  be retried; remove only on explicit discard/expiry.

## Completion Evidence (2026-07-23)

### Local Node 22 and desktop

The portable runtime is
`target/e2e/node-v22.17.0-win-x64-download/node-v22.17.0-win-x64`
(`v22.17.0`) with pnpm `10.18.3`. The following passed with that runtime:

```text
node --check scripts/engine-smoke.mjs
pnpm exec eslint apps/desktop/src/renderer/TaskPackagePanel.tsx \
  apps/desktop/tests/e2e/workbench.spec.ts apps packages/contracts/src
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test       # 6 files, 21 tests
pnpm --filter @translunar/desktop build
pnpm exec playwright test tests/e2e/workbench.spec.ts \
  -g "offline task package"                  # 1 passed
```

The focused Electron run used
`target/e2e/translunar-engine-task-package-release.exe`. The complete
`workbench.spec.ts` real-Engine suite also passed locally: 11 tests, about 2.1
minutes. It covered existing editor, AI, lifecycle, interop, alignment/corpus,
10,000-segment performance, and motion/geometry workflows in addition to task
packages. `git diff --check` and the same lint/typecheck/unit/build gates also
passed under the installed Node 24 runtime as development feedback.

Local `pnpm contracts:check` was attempted under Node 22 but this Windows shell
resolves a non-MSVC `link.exe` and Rust reports `extra operand`; therefore it is
not counted as a local contract pass. The generated-contract check and all
Rust gates passed in the synchronized VPS tree below.

### VPS Node 22, Rust, smoke, and release

The synchronized tree is
`/home/ubuntu/workspaces/cat-alignment-core-20260722-a` on `ssh moe`. Its ARM64
Node runtime is `/home/ubuntu/tools/node-v22.17.0-linux-arm64/bin/node`
(`v22.17.0`). The following passed; the contract check was run both directly
and through pnpm with host-engine strictness disabled:

```text
node scripts/check-contracts.mjs
pnpm run --config.engine-strict=false contracts:check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/engine-smoke.mjs
cargo build --release -p translunar-engine
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

The workspace tests included Engine 51, Storage 72, task-package-core 6, and
all other crate tests. The stdio smoke covered assignment export/preview/import,
return export, every disposition, selected apply, stale/tamper/no-clobber/
rollback, restart, and idempotence. Release hashes are:

```text
target/release/translunar-engine
1f509dde129291bdd608303a9c7fa7fb0e9abc64912312f94c7a6daf41b7ea15

target/x86_64-pc-windows-gnu/release/translunar-engine.exe
6d58ad516d39ac386d3d4edf522a053ac575375f8864965a9a80afb915c2c6ed
```

The copied Windows release binary has the same SHA-256 and powered the local
Electron acceptance run.

### Visual and accessibility evidence

The latest assignment/return captures are under:

```text
apps/desktop/test-results/
  workbench-hands-off-an-off-7d605-ween-real-Engine-workspaces/
```

That directory contains assignment and return screenshots at 1250x744,
1680x942, and 1920x1080. The final run asserted named controls, no renderer
console/page errors, and no `html`/`body`/root horizontal overflow at all three
viewports. The regenerated 1250x744 assignment and return images were manually
inspected after the final run; controls, labels, rows, and terminal actions are
visible without overlap or clipping.
