# Implementation Plan: Project Lifecycle Acceptance

## 1. Navigation And Project Home

- [x] Add project-home/setup/workspace top-level state to `App`, preserve the
      session restore path, and route workbench exit through pending-edit flush.
- [x] Build Projects tab with recent project/document progress, deterministic
      paging, create/open/add-file actions, loading/error/empty states.
- [x] Add archive open/save trusted IPC and restore/export orchestration.

## 2. Lifecycle Surfaces

- [x] Build Search tab with Engine filters, bounded paging, snippets, and direct
      document/segment navigation.
- [x] Build Templates tab with revisioned CRUD and safe configuration fields.
- [x] Build Recycle tab with restore/purge dialogs and refreshed normal lists.
- [x] Build workspace Project Insights page with document switching/add batch,
      history, re-import preview/apply, archive/recycle, analysis, analytics,
      stale/unavailable states, and no renderer-derived domain metrics.

## 3. Integration Coverage

- [x] Extend `scripts/engine-smoke.mjs` through all lifecycle RPC families and
      restart assertions, including corrupt/no-clobber paths.
- [x] Extend Electron E2E with the real Engine through home, wizard, templates,
      multi-file, search, re-import, archive, recycle, analytics, navigation,
      three viewports, accessibility, overflow, and console/page error gates.
- [x] Add focused renderer tests for any extracted formatting/state helpers.

## 4. Verification And Records

- [x] Run the Node-side format, ESLint, typecheck, unit, and desktop build
      checks locally with Node 22; run Rust-bearing aggregate gates on the VPS.
- [x] Synchronize the committed/source tree to the isolated VPS tree and run
      Rust fmt, strict clippy, workspace tests, contracts, stdio smoke, release
      build, and Windows GNU cross-build.
- [x] Run real-Engine Electron E2E locally with the VPS-built Windows binary.
- [x] Update executable specs and the archived lifecycle records with exact
      validation evidence.
- [ ] Commit and archive this corrective task, then resume
      `07-19-interop-alignment-review`.

## Validation Commands

```powershell
pnpm format:check
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm test:e2e:desktop
```

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
node scripts/engine-smoke.mjs
cargo build --release -p translunar-engine
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

## Risk And Rollback Points

- Do not change migration 10 or generated contracts unless a verified Engine
  defect requires an additive migration/protocol change.
- Do not delete the existing workspace screenshot in `.trellis/workspace`.
- Keep project selection/session changes separate from document/editor state;
  a navigation failure must leave the active workspace usable.
- Never replace Engine-derived analytics/search/re-import results with local
  estimates to make an E2E assertion pass.

## Completion Evidence (2026-07-21)

The following evidence is for the source tree at `K:\Workbench\CAT`. The
portable Node runtime used for local acceptance is
`target/tools/node-v22.17.0-win-x64` (`v22.17.0`) with pnpm `10.18.3`.

### Local Node 22 checks

- `pnpm format:check` passed (Prettier and Rust fmt).
- `pnpm exec eslint apps packages/contracts/src` passed.
- `pnpm typecheck` passed for contracts, Electron, renderer, and E2E
  TypeScript projects.
- `pnpm --filter @translunar/desktop test` passed: 4 files, 15 tests.
- `pnpm --filter @translunar/desktop build` passed, including the relative
  Vite asset base and Electron main TypeScript build.
- The focused lifecycle E2E passed (`1 passed`, about `6.9s`). The professional
  editor E2E passed three consecutive repetitions after replacing the
  position-only first-row locator with the stable `Target segment 1` label.
- The complete Electron suite passed under the real Engine: `7 passed`, `1
  skipped` (the existing PDF OCR prerequisite branch), about `1.8m`. The suite
  included lifecycle, legacy/editor/AI/QA flows, the 10,000-segment 60-second
  performance budget, three-viewport geometry, and console/page error checks.

The aggregate `pnpm lint` and `pnpm contracts:check` commands were also
executed on the VPS below. A local Windows attempt reached the Rust phase but
could not be used as evidence because this shell resolves a non-MSVC
`link.exe` and reports `extra operand`; the TypeScript ESLint phase passed.

### VPS isolated synchronized tree

The acceptance tree is `/home/ubuntu/workspaces/cat-lifecycle-acceptance` on
`moehub`. It intentionally has no `.git` directory, so it is recorded as an
isolated synchronized tree rather than a clean checkout. Its Node 22 runtime
was `/tmp/cat-node-v22.17.0` (`v22.17.0`), pnpm was `10.18.3`, and Rust was
`rustc/cargo 1.97.1`.

The following commands passed there:

```text
pnpm format:check
pnpm lint
pnpm test                  # 4 Vitest files / 15 tests plus Rust workspace
pnpm contracts:check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p translunar-engine
node scripts/engine-smoke.mjs
cargo build --release -p translunar-engine
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

The lifecycle smoke reported `Engine smoke passed` and exercised the
multi-file/template/search/re-import/analysis/recycle/archive/restart chain.
Release SHA-256 values were:

```text
target/release/translunar-engine
1f7c19481d7a25a380975e410d0721f4ef93e3a340fe4bdbf920dd196f871d69

target/x86_64-pc-windows-gnu/release/translunar-engine.exe
b2cd0e0fa8fffa215efdbb460632010d287a39df5d18a0ce22f8cad737fa813d
```

The Windows binary was copied to
`target/cross/lifecycle/translunar-engine.exe` and used by the local Electron
suite; its SHA-256 is
`b2cd0e0fa8fffa215efdbb460632010d287a39df5d18a0ce22f8cad737fa813d`.

### Visual evidence and process notes

The latest lifecycle screenshots are in:

```text
apps/desktop/test-results/workbench-manages-the-comp-ff471-cle-through-the-real-Engine/
  project-home-1250x744.png
  project-home-1680x942.png
  project-home-1920x1080.png
  project-insights-1250x744.png
  project-insights-1680x942.png
  project-insights-1920x1080.png
```

All six were inspected after the final run; no blank surface, overlap,
clipping, or horizontal overflow was observed. The Trellis `mem` executable
was unavailable in this environment (missing
`@mindfoldhq/trellis/bin/trellis.js`), so repository
`.trellis/scripts/get_context.py` was used for the equivalent context and
phase checks. This is a tooling limitation, not an implementation failure.
