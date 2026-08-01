# Implementation Plan: Plugin Management and Release Qualification

## Preconditions

- [x] Confirm the active branch is `task/07-30-plugin-management-release` from
      merged `origin/master` and the active task is this directory.
- [x] Load backend, frontend, cross-layer, error, database, and quality specs plus
      `research/codebase-contracts.md`.
- [x] Preserve the dirty main worktree; edit only the isolated Orca worktree.

## 1. Package Format and Runtime Materializer

Owner scope: `crates/plugin-runtime`, workspace Cargo metadata, focused tests.

- [x] Add closed distribution metadata and source/materialized package types.
- [x] Implement deterministic `.tlplugin` extraction with all path/link/
      collision/compression/count/depth/byte guards before writes.
- [x] Route directory/archive inspect and stage through one validate/hash path;
      prove equal canonical hashes and cleanup on every error.
- [x] Add public SDK types/validators/build helpers without breaking manifest v1
      or existing v2 packages.

## 2. Persistence and Generated Protocol

Owner scope: `crates/storage`, `crates/protocol`, generated contracts.

- [x] Add migration 24 for active-version and immutable-version distribution
      provenance/metadata with deterministic legacy backfill and restart tests.
- [x] Extend inspection, summary, and version projections; add bounded bundled
      catalog/apply contracts and method catalog entries.
- [x] Regenerate schema/TypeScript contracts and run drift checks.

## 3. Engine Bundle and Lifecycle Integration

Owner scope: Engine CLI/service/plugin lifecycle and focused smoke fixtures.

- [x] Accept an optional trusted bundled-plugin root at Engine startup and pass
      the packaged resources path from Electron main.
- [x] Load/validate the closed generated index and expose bounded list/apply;
      infer source kind from canonical materialization context only.
- [x] Refactor inspect/install/upgrade around the shared materializer; re-hash
      managed candidates before persistence.
- [x] Verify package hash on restart and rollback; degrade/detach only the exact
      corrupt generation with bounded diagnostics.
- [x] Reuse existing permission diff, candidate preflight, registry attach,
      version CAS, and compensation paths for local/bundled upgrades.

## 4. Reproducible Core Packages

Owner scope: package scripts, explicit allowlist, production-safe examples,
Electron packaging resources, docs.

- [x] Add deterministic pack/check/index scripts with stable entry order,
      timestamps, modes, hashes, and allowlist validation.
- [x] Add publisher/license metadata and license text to every released example;
      exclude credentials and test-only fixtures from the core catalog.
- [x] Package the generated offline catalog as desktop resources and add drift,
      tamper, reproducibility, and secret/path scan tests.

## 5. Desktop Management Workflow

Owner scope: Electron main/preload/shared API, Plugins renderer modules/styles/
i18n, focused tests.

- [x] Update the trusted picker for directories and `.tlplugin` files.
- [x] Add inspection confirmation and bundled catalog states without exposing
      bundled resource paths to React.
- [x] Add local upgrade, version history, rollback, source/license/hash/
      compatibility/crash/diagnostic projections, and complete contribution
      inventory.
- [x] Preserve permission-review authority, exact revisions, panel teardown,
      typed errors, focus traps, keyboard operation, and responsive layout.
- [x] Add English/Simplified Chinese strings (EN + zh-CN). Focused PluginsPanel
      unit tests remain residual (covered by Engine catalog tests + planned E2E).

## 6. End-to-End Qualification and Evidence

- [x] Extend real Engine smoke through archive inspect/install, permission review,
      enable/use/restart, upgrade, rollback, revoke, disable, uninstall, bundled
      apply/restore, failure compensation, and post-failure health (see
      `scripts/engine-smoke.mjs` plugin scope; evidence in review/verify +
      acceptance-evidence).
- [x] Extend Electron E2E through local and bundled workflows, inspection
      confirmation, permission decisions, diagnostics, and uninstall with
      console checks (fresh-build seven-case matrix; Path A+B after F7/F8).
- [x] Capture/inspect 1250x744, 1680x942, and 1920x1080 evidence for installed,
      bundled, inspection, and permission states (via E2E harness screenshots).
- [x] Create `acceptance-evidence.md` mapping R1-R6 and AC-01-AC-12 to exact
      commands/tests/screenshots/hashes and record only verified baselines.

### Residual (non-blocking; documented in findings-5)

- Plugins **Versions** dialog / version-history list / UI rollback entry: Engine
  and connector/AI host RPC paths covered; dedicated Plugins-panel Versions E2E
  not present.
- Plugin **stale-revision** typed recovery on the Plugins surface: no dedicated
  Electron E2E (other domains have fixtures; not equivalent).
- **Reduced-motion** mode: not specially tested.
- Full seven-case Electron matrix was not re-run after the F7/F8 focused fix;
  verify-2 already passed six cases on the prior fresh build; focused bundled+
  `.tlplugin` case re-passed post-fix.
- Full workspace clippy / monorepo-wide non-plugin E2E not claimed green.

## Validation Commands

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p translunar-plugin-runtime
cargo test -p translunar-storage plugin
cargo test -p translunar-engine plugin --lib
pnpm --filter @translunar/plugin-sdk test
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:desktop
pnpm docs:check
pnpm format:check
```

Use the repository-supported Node 24 executable. Redirect `CARGO_TARGET_DIR` to
a volume with sufficient capacity if the Windows worktree target exhausts local
space. Run targeted Prettier on every changed JS/TS/JSON/Markdown file even when
the repository-wide baseline remains red.

## Review Gates

- [x] Independent quality loop (findings-1..5 + verify-1..2) reviewed archive
      extraction attacks, bundled provenance spoofing, inspect/install source
      classification consistency, renderer trust boundaries, and public-vs-
      fixture release inputs. Open blocker/major after findings-5: 0.
- [x] Generated contracts and built example artifacts show no drift.
- [x] No credential, absolute private path, source/target text, raw plugin payload,
      or stack trace appears in persistence, catalog, errors, diagnostics, logs,
      screenshots, or evidence.
- [x] No marketplace, remote signing/index, app updater, or OS-sandbox claim has
      entered scope.

## Rollback Points

- Archive materialization remains behind the source-type branch; directory
  install continues independently.
- Bundled catalog absence is non-fatal and cannot mutate installed state.
- Migration 24 only adds/backfills fields; previous package/version rows remain
  authoritative and readable.
- Candidate attach and version CAS reuse existing compensation so a failed
  upgrade never requires deleting the prior managed package.
