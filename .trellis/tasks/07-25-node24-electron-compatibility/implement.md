# Implementation plan: Node 24 and Electron install-chain compatibility

## Preconditions and ownership

- Task remains in `planning` until the latest planning summary is explicitly
  approved and `task.py start` is run.
- Own only toolchain files, lockfile, install-integrity tests/scripts, CI,
  packaging docs, and the task/spec evidence required by this plan.
- Do not touch the protected Workbench visual files or unrelated PRD features.

## Ordered work packages

### 1. Establish the reproducible baseline

- Capture Node 22 and Node 24 versions, pnpm version, Electron version, and
  `extract-zip` dependency resolution.
- Run clean frozen installs in isolated directories; inspect the Electron
  package inventory and launch/version probe.
- Record the exact failure or prove that the current graph is already safe.

### 2. Repair the install chain

- Evaluate the smallest upstream Electron/electron-builder update that fixes
  the Node 24 postinstall behavior.
- If needed, prototype a narrow pnpm override/patch with a regression test.
- Rebuild the lockfile deterministically and inspect all changed transitive
  packages before accepting it.

### 3. Synchronize version policy

- Update `package.json`, `scripts/check-node-version.mjs`, `.node-version`, CI
  and native packaging workflows, README/contributing/packaging docs, and
  `.trellis/spec` references.
- Ensure Node 23 remains rejected and Node 22 remains available.

### 4. Run the quality and release matrix

- Node 22: install, contracts, lint, typecheck, unit/Rust, desktop build, and
  real Engine/Electron E2E.
- Node 24: repeat the same chain plus package architecture/size/install smoke.
- Native Windows/macOS runners: produce package and launch/Engine evidence.
- Compare artifact file inventories and checksums where relevant.

### 5. Review and handoff

- Update the task evidence with exact commands/results and unresolved platform
  limitations.
- Run the Trellis quality check, update specs, and commit only owned changes.
- Do not archive until all acceptance criteria are evidenced.

## Required validation commands

```text
pnpm install --frozen-lockfile
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @translunar/desktop build
pnpm test:e2e:engine
pnpm --filter @translunar/desktop test:e2e
pnpm release:package:arch-test
pnpm release:package:gate-test
pnpm release:package:check
pnpm release:install-smoke:test
pnpm release:install-smoke --platform win32
pnpm release:install-smoke --platform darwin
```

The last two commands require their native platform runners and cannot be
replaced with a Linux or Windows-only result.

## Risk points

- `apps/desktop/package.json` Electron/electron-builder versions
- `pnpm-lock.yaml` extraction and postinstall graph
- `scripts/check-node-version.mjs`
- `.node-version`, `package.json`, CI/package workflows, and toolchain docs
- Native package scripts and install-smoke helpers

## Rollback point

If the clean install or native smoke fails, restore the Node 22 policy and
dependency graph as one coherent change; keep the regression evidence and
failure record, and do not claim Node 24 support.
