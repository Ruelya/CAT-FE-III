# Node 24 compatibility: current evidence

## Repository facts

- Root `package.json` requires `>=22.17.0 <23` and runs a preinstall guard.
- `scripts/check-node-version.mjs` rejects every major other than 22 and names
  Electron 39 installation reliability under Node 24 as the reason.
- `apps/desktop/package.json` pins Electron `39.8.10`, electron-builder
  `26.0.12`, and electron-updater `6.8.9`.
- `pnpm why extract-zip --recursive` resolves `extract-zip@2.0.1` through
  Electron 39.8.10.
- CI and both native packaging workflows currently use Node 22.
- The current workstation is Node `v24.17.0` with pnpm `10.18.3`; commands
  run against the existing install can pass while the preinstall guard is not
  exercised.

## Evidence gap

The repository documents the partial-runtime risk but does not yet contain a
clean-install reproduction or an integrity probe that distinguishes a
complete Electron package from a truncated one. That experiment is the first
required step of this task.

## Decision direction

Prefer dual support for Node 22 release builds and Node 24 development/CI. Do
not widen the version guard until Electron postinstall and native package
smoke evidence is available on all supported platforms.
