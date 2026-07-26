# Implementation Plan: Plugin Multi-Tier Control Plane

## Start gate

This task remains `planning` until the latest PRD/design summary is explicitly
approved in a subsequent user turn. After approval, implementation is Codex-only
for this session; do not dispatch Claude or Grok and do not re-apply a worker
diff when a worker can edit the shared worktree directly.

Before editing product code:

- run `trellis-before-dev` for backend, protocol, storage, runtime, SDK, and
  frontend guidance;
- verify `task.py validate 07-26-plugin-multitier-runtime`;
- record the current dirty-path boundary and preserve unrelated parent-task
  planning files and the protected Workbench screenshot;
- confirm migration 16/17 files are unchanged.

## Ordered implementation units

### 1. Normalized runtime model and package security

Owner scope: `crates/plugin-runtime/src/lib.rs`, its tests, and public SDK
normalization fixtures only.

- Add raw v1/v2 decoders, `NormalizedPluginManifest`, runtime tagged union,
  all seven contribution variants, compatibility matrix, bounded metadata, and
  typed validation errors.
- Preserve legacy v1 filter identity and `startProcessPlugin` behavior.
- Replace substring path checks with component-aware canonical validation;
  reject symlinks/reparse points, duplicate paths, and bounded package
  violations.
- Add deterministic staged-package SHA-256 and no-clobber staging utilities.
- Compare process handshake runtime/contribution inventory to the normalized
  candidate before any attach.

Checkpoint: legacy hello-SRT tests and v2 all-tier/all-kind fixture tests pass;
no Engine or storage changes are required to run these tests.

### 2. Migration 18 and immutable version store

Owner scope: `crates/storage/src/migrations.rs`,
`crates/storage/src/store/plugin.rs`, storage tests, and any narrowly required
storage model exports.

- Append `MIGRATION_18`; never edit released migrations 16/17.
- Copy the migration-16 installation table to a tier-neutral projection,
  create `plugin_versions`, FKs/triggers/indexes, and seed deterministic
  `legacy-v16:<plugin-id>` rows.
- Implement the post-SQL, filesystem-aware normalization pass with immediate
  transaction/revision recheck, missing-package diagnostics, and idempotence.
- Add immutable version queries, bounded history paging, active-version CAS,
  same-hash idempotence, same-version/different-hash conflict, candidate
  failure retention, rollback selection, and quarantine metadata.
- Preserve legacy path/status/grants/crash/timestamp/revision values exactly.

Checkpoint fixtures: fresh 18, v16→18 with all statuses, reopen twice,
missing/moved package, malformed/rollback migration, strict FK/unique/hash
constraints, and stale CAS.

### 3. Tier-neutral Engine lifecycle

Owner scope: `crates/engine/src/plugin.rs`, relevant `EngineService` fields and
dispatch in `crates/engine/src/lib.rs`, plus Engine tests.

- Introduce host and contribution-adapter registries behind existing methods;
  do not assume a pre-existing `PluginManager`.
- Keep the current process/filter host as the only executable host. Normalize
  and inventory unsupported tiers/kinds, but return
  `plugin_capability_unsupported` before status/registry mutation.
- Implement inspect, version list, staged install, CAS upgrade, rollback,
  restart restoration, isolation, and quarantine uninstall.
- Ensure all descriptors preflight before any filter registration; preserve
  built-ins and unrelated plugins.
- Guard crash persistence with plugin id + active version + activation
  revision, and retain the prior active process/path on candidate failure.

Checkpoint: Engine tests cover successful blue/green upgrade, invalid/API/
unsupported/handshake/hash failures, duplicate/version conflicts, rollback,
stale revision, stale crash, restart, and ordinary RPC responsiveness.

### 4. Protocol, error surface, and generated contracts

Owner scope: `crates/protocol/src/plugin.rs`, `crates/protocol/src/lib.rs`,
Engine method dispatch/error mapping, and generated contract outputs under
`packages/contracts/src`.

- Add exact `plugin.inspect`, `plugin.version.list`, `plugin.upgrade`, and
  `plugin.rollback` params/results and method catalog entries.
- Add tagged runtime/contribution DTOs, compatibility/diagnostic/version
  projections, additive summary fields, and stable capability error codes.
- Run the repository contract generator; never hand-edit generated output.
- Keep existing six method payloads and legacy error data compatible.

Checkpoint: `pnpm contracts:check` plus serialization tests for discriminators,
unknown versions, camelCase, bounded diagnostics, and legacy payloads.

### 5. Public SDK and compatibility examples

Owner scope: `packages/plugin-sdk`, `examples/plugins/hello-srt`, and focused
fixtures/tests.

- Export normalized types, runtime/contribution unions, compatibility and
  diagnostic types, package validation/hash helpers, and version lifecycle
  result types.
- Keep the legacy process API source-compatible and ensure hello-SRT still
  imports only public SDK symbols.
- Add descriptor-only v2 fixtures for every tier/kind; do not add a fake Tier 1
  evaluator or Tier 2 sandbox to this task.

Checkpoint: SDK typecheck/build/tests, public-only example bundle, and
deterministic hash fixture.

### 6. Existing desktop/smoke regression evidence

Owner scope: `scripts/engine-smoke.mjs`, existing Plugins-panel E2E/tests, and
only additive generated-field assertions required by the new summary.

- Extend real Engine smoke through install → restart → inspect/history →
  successful and failed upgrade → rollback → unsupported capability.
- Preserve existing install/enable/disable/uninstall and degraded/crash flows.
- Keep upgrade UI out of this child; the existing panel only renders additive
  authoritative fields and typed diagnostics where needed.
- Run the existing Electron lifecycle/failure E2E at 1250x744, 1680x942, and
  1920x1080 with no console/page errors or horizontal overflow.

### 7. Specs, quality gate, and evidence

Owner scope: `.trellis/spec/backend/engine-boundary.md`,
`.trellis/spec/backend/database-guidelines.md` only when executable knowledge
is new, plus this task's `evidence/verification.md`.

- Document migration 18 immutability, staged hash/swap, CAS, typed capability
  behavior, and the honest serialized-Engine concurrency boundary.
- Map every test/evidence item to AC1–AC6 and record commands/results.
- Run focused tests first, then all required repository gates. A remaining
  Vite chunk-size warning is informational only if every gate passes.

## Acceptance-to-test map

| AC | Required evidence |
| --- | --- |
| AC1 | migration18 fresh/upgrade/reopen/idempotence/missing-package fixtures |
| AC2 | hello-SRT Engine smoke + restart/import/export/disable/uninstall |
| AC3 | runtime v1/v2 union fixtures, all 3 tiers/7 kinds, typed unsupported preflight |
| AC4 | staged hash/no-clobber, upgrade success/failure, version conflict, rollback/restart |
| AC5 | Store/Engine CAS, isolation, built-in preservation, stale crash guard |
| AC6 | contracts, SDK, Rust/Engine, smoke, desktop E2E/screenshots, full gates |

## Validation sequence

Focused while iterating:

```powershell
pnpm contracts:check
pnpm --filter @translunar/plugin-sdk test
pnpm --filter @translunar/plugin-sdk build
cargo test -p translunar-plugin-runtime -p translunar-storage -p translunar-engine
node scripts/engine-smoke.mjs --plugin-multitier
```

Final gate:

```powershell
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm build:desktop
pnpm test:e2e:engine
pnpm test:e2e:desktop
pnpm docs:check
```

If a focused command is not an existing script, add the smallest deterministic
fixture/selector needed and record the actual command used; do not silently
claim an unrun command as evidence.

## Risk and rollback points

- Decoder risk: revert runtime normalization before migration changes.
- Migration risk: restore the pre-migration backup; released migrations remain
  untouched and migration transaction must leave `user_version` unchanged on
  failure.
- Filesystem risk: delete only the task-owned staging/quarantine directory;
  never remove an active package as cleanup.
- Lifecycle risk: stop candidate and compensating-CAS the old active version;
  never amend or force-reset a commit.
- Contract risk: regenerate schema/TypeScript from Rust and keep old methods
  decodable.
- Scope risk: do not implement permission grants, Tier 1/Tier 2 execution,
  non-filter adapters, marketplace/distribution, or upgrade UI here.

## Commit and archive order

1. Run the independent Codex check against the complete task scope.
2. Update only owned specs/evidence if the check exposes executable knowledge.
3. Create one implementation commit for owned code/spec/evidence; do not amend.
4. Run `python ./.trellis/scripts/task.py archive 07-26-plugin-multitier-runtime`
   so only this leaf is archived and auto-committed.
5. Record the implementation commit (not archive commit) in the journal.
6. Return active context to `07-19-plugin-runtime-sdk`, then activate the
   permission-grants child only after its own planning gate.
