# Technical design: Node 24 and Electron install-chain compatibility

## 1. Boundary

```text
Node version policy
  -> pnpm lifecycle / Electron postinstall
  -> Electron + electron-builder dependency graph
  -> desktop build and native package smoke
  -> CI and contributor documentation
```

The host Node version controls package installation, TypeScript/Vite scripts,
Playwright, and packaging helpers. The packaged Electron application uses the
Node runtime embedded by Electron. The Electron 39 -> 41 upgrade changes that
embedded runtime as a necessary dependency repair, so both host and packaged
runtime boundaries require explicit regression evidence.

## 2. Compatibility strategies

1. **Selected — upstream upgrade:** move Electron from `39.8.10` to `41.10.3`.
   Its dependency graph uses `@electron/get@5` and the repaired
   `@electron-internal/extract-zip`; require extractor `1.0.4` or newer. Keep
   electron-builder/electron-updater unchanged unless tests prove a required
   compatibility update.
2. **Fallback — narrow dependency repair:** if the Electron major cannot move,
   apply a reviewed pnpm override/patch to the exact extraction dependency and
   add a regression inventory/launch test. The patch must be removable and
   must not bypass lifecycle scripts.
3. **Reject:** widening `engines`, setting `--ignore-scripts`, or deleting the
   guard without proving a complete Electron install.

The implementation uses strategy 1. Strategy 2 is a rollback alternative only
if Electron 41 introduces an unresolvable product or packaging regression; it
is not the default because it would retain an EOL Electron major.

## 3. Version policy contract

The supported set is explicit:

```text
Node 22.17.x through 22.x  -> release lane
Node 24.x                  -> development and CI lane
Node 23.x / older          -> rejected
```

The executable guard, `package.json` engine range, `.node-version`, CI matrix,
packaging workflows, and docs are updated together. A semver expression that
accidentally admits Node 23 is not acceptable.

## 4. Verification matrix

| Layer | Node 22 | Node 24 | Required evidence |
| --- | --- | --- | --- |
| Frozen install | yes | yes | Electron package complete; no partial runtime |
| Contracts/lint/typecheck/unit | yes | yes | green command output |
| Desktop build | yes | yes | main/preload/renderer artifacts |
| Real Engine/Electron E2E | release baseline | compatibility baseline | no console/page errors |
| Windows package/install smoke | native runner | native runner | installer launches bundled Engine |
| macOS package/install smoke | native runner | native runner | DMG/app launches bundled Engine |

Linux may provide deterministic install/build evidence, but it cannot replace
the Windows/macOS native gates.

## 5. Rollback and safety

- Keep the Node 22 lockfile and CI lane green while testing Node 24.
- Do not remove the current guard until a clean-install regression passes.
- If an Electron upgrade changes packaging output, revert only the toolchain
  branch and retain the test/evidence additions for the next attempt.
- Never clean or reset unrelated visual-task files in the shared worktree.

## 6. Observable outputs

- Updated root/toolchain contracts and lockfile.
- A deterministic install-integrity test or script that detects a partial
  Electron runtime.
- CI matrix entries for Node 22 and Node 24.
- A research/evidence record containing versions, commands, platform, and
  results for each matrix cell.
