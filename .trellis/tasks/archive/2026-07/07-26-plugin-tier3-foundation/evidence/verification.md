# Tier 3 foundation verification

Date: 2026-07-26

## Acceptance evidence

- AC-01: `cargo test -p translunar-engine plugin` verifies duplicate install
  before package/registry/process mutation, complete summary/revision equality,
  managed entry bytes, and the same `Arc<PluginProcess>` identity.
- AC-02: the same Engine test target covers incompatible API range, missing
  entry, and missing grants; all map to `plugin_invalid_manifest` or
  `plugin_permission_denied` with no filter/process/package registration.
- AC-03/04: runtime tests cover response timeout, blocked stdin backpressure,
  writer I/O typing, generation recovery, and environment isolation. The real
  Engine `real_timeout_failure_is_typed_degraded_and_restart_safe` test covers
  hanging import -> typed timeout RPC -> degraded/crashCount=1 -> contribution
  removal -> ordinary list request -> restart persistence. The crash fixture
  covers process exit and the same lifecycle path.
- AC-05: `@translunar/plugin-sdk` runs 9 Vitest tests, strict TypeScript checks,
  reproducible self-contained hello-SRT bundle build, and source-level proof
  that `startProcessPlugin` is imported and invoked.
- AC-06: focused `scripts/engine-smoke.mjs` plugin scope passes install,
  enable, import/export, restart, duplicate rejection, crash typing, degraded
  persistence, contribution removal, and ordinary RPC recovery.
- AC-07: focused Electron E2E passes 2/2 plugin flows at the supported desktop
  harness and task-owned screenshots cover enabled/degraded states at
  1250x744, 1680x942, and 1920x1080; review found no incoherent overlap or
  global overflow.

## Commands and results

All commands below passed on the shared Windows worktree after the final
writer, timeout, and cancellation fixes:

```text
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                 # toolchain, SDK, Desktop 145 tests, Rust workspace
cargo build -p translunar-engine
TRANSLUNAR_SMOKE_SCOPE=plugin node scripts/engine-smoke.mjs
pnpm build:desktop
pnpm --filter @translunar/desktop exec playwright test tests/e2e/workbench.spec.ts -g plugin
```

Observed focused totals: plugin-runtime 7/7, Engine plugin 3/3, SDK 9/9,
Desktop E2E 2/2. The production Vite build emits only its existing chunk-size
warning; it does not fail the build or produce renderer/page errors.

## Review boundary

The independent Codex review confirmed the original blocking issue—synchronous
stdin writes could bypass deadlines—is closed by the bounded writer design and
regressions. A hypothetical second Engine process sharing one data directory
is outside the current serialized Engine contract and remains a separate
workspace-lock design concern, not an unverified claim of this child.
