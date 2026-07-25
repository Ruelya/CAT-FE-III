# Node 24 and Electron install-chain compatibility

## Goal

Validate and, if safe, upgrade the repository toolchain from the Node 22
release baseline to Node 24 by resolving the Electron 39 extract-zip
installation risk, preserving reproducible desktop builds and native package
smoke evidence.

## User value

The developer workstation currently runs Node 24 and reports an unsupported
engine warning (or fails the install guard), even though the application code
can run with an already-installed dependency tree. Node 24 should become a
first-class, clean-installable development and CI option instead of requiring
every contributor to switch runtimes merely to install Electron.

## Confirmed baseline

- The root `engines.node` range is `>=22.17.0 <23` and `preinstall` calls
  `scripts/check-node-version.mjs`.
- The guard's stated reason is the Electron 39 installation chain: Electron
  `39.8.10` depends on `extract-zip@2.0.1`, which has been observed/documented
  as capable of leaving a partial runtime under Node 24.
- CI and both native packaging workflows currently use Node 22.
- Node 24 test/build commands can run against the existing installation, but
  that is not evidence that a fresh frozen install is safe.
- The Node version used to install dependencies is separate from the Node
  runtime embedded in the packaged Electron application.

## Requirements

### N24-01 — reproduce the actual install risk

- Run isolated, clean `pnpm install --frozen-lockfile` experiments under the
  supported Node 22 line and Node 24 on the current dependency graph.
- Record whether Electron's postinstall produces a complete runtime and give
  the failure a deterministic check (file inventory, executable launch, or
  equivalent), rather than relying on the warning text alone.

### N24-02 — resolve the Electron install chain

- Prefer an upstream Electron/electron-builder update that fixes the problem
  while preserving the app's current packaging and API behavior.
- If an upstream update is not yet viable, use a narrowly scoped, documented
  dependency patch/override only when it passes the same clean-install and
  package tests. Do not hide the problem with `--ignore-scripts` or a broad
  postinstall bypass.
- Keep the generated lockfile reproducible and do not commit `node_modules`.

### N24-03 — establish a deliberate support policy

- Make Node 24.x a supported development/CI version.
- Retain Node 22.17.x as a supported release lane while the Electron runtime
  and native packages remain on their current compatibility line.
- Reject unsupported Node 23 and older versions explicitly; do not silently
  accept arbitrary majors through a widened semver range.

### N24-04 — synchronize repository contracts

After the install chain is proven, update the root engine range and guard,
`.node-version`, CI/package workflows, README/contributing/packaging docs, and
the relevant Trellis specs. Every place that describes the tested toolchain
must agree with the executable version check.

### N24-05 — prove development and release behavior

- Run install, contracts, lint, typecheck, unit/Rust tests, desktop build, and
  real Engine/Electron E2E under Node 24.
- Run the same essential checks under Node 22 to preserve the release lane.
- On native runners, run Windows and macOS package plus install/launch/Engine
  smoke. A successful JavaScript build alone is insufficient.
- Verify no renderer, preload, native module, or updater behavior changes are
  introduced by the toolchain update.

## Constraints

- This task changes the development/toolchain contract, not the Electron
  application's embedded Node runtime or CAT product behavior.
- Do not mix unrelated dependency upgrades, visual changes, or PRD feature
  work into this task.
- Preserve the protected visual-task files in the shared worktree.
- If the current Electron line cannot be made safe, leave the Node 22 guard in
  place and record the exact reproducible blocker; that is a blocked outcome,
  not a completed Node 24 migration.

## Acceptance criteria

- [ ] A fresh Node 24 checkout completes `pnpm install --frozen-lockfile`
      without an incomplete Electron runtime.
- [ ] The Electron executable and package inventory are validated after the
      install; the old `extract-zip` failure mode is covered by a regression
      check or eliminated by an upstream version.
- [ ] `package.json`, the version guard, `.node-version`, CI, packaging
      workflows, docs, and Trellis specs agree on the Node 22 + Node 24 policy.
- [ ] Node 24 passes the full supported quality chain and a real Electron
      Engine smoke; Node 22 remains green on the same essential chain.
- [ ] Windows and macOS native package/install evidence is recorded, or the
      exact external-runner limitation and pending evidence are recorded.
- [ ] No `--ignore-scripts`, unreviewed lockfile drift, or hidden fallback is
      used to claim compatibility.

## Recommended decision

Adopt a dual supported matrix (`22.17.x` and `24.x`, with Node 23 excluded)
rather than replacing Node 22 immediately. This removes the local Node 24
friction while keeping the current Electron release lane stable; dropping
Node 22 can be considered later when the packaged Electron runtime itself is
upgraded and its native-platform evidence is complete.
