# Codebase Research: Plugin Management and Release

## Product and Parent Boundary

- `docs/PRD.md:454-473` defines P-01..P-10 as P1 plugin scope. P-10 requires
  local file/directory distribution, official bundled core plugins, and manual
  community installation; P-11 remote marketplace/index is P2.
- `.trellis/tasks/07-19-plugin-runtime-sdk/prd.md:113-119` assigns the last child
  desktop management, contribution inventory, permission review, upgrades,
  degraded/crash state, diagnostics, examples, packaging, docs, and lifecycle
  qualification.
- `.trellis/tasks/07-19-plugin-runtime-sdk/implement.md:9-34` names
  `plugin-management-release` as child 10 after all nine runtime/contract
  predecessors. Those predecessors are now archived.

## Existing Reusable Contracts

- `crates/protocol/src/plugin.rs:18-273` already defines tier/status/runtime,
  normalized manifest, compatibility/diagnostics, inspect/install/upgrade/
  rollback params, package hash, contribution inventory, and summaries.
- `crates/engine/src/plugin.rs:348-447` implements side-effect-free directory
  inspect, immutable version listing, optimistic-revision upgrade, same-version
  hash conflict, and candidate staging.
- `crates/plugin-runtime/src/lib.rs:4737-4970` computes a canonical sorted tree
  hash, rejects links/reparse points, bounds files/bytes/path/depth, securely
  stages a directory, verifies managed hashes, and copies with no-clobber
  semantics. It has no archive reader.
- `crates/storage/src/store/plugin.rs:51-76,193-260` stores installation and
  immutable version status, managed paths, package SHA-256, normalized manifests,
  compatibility, and diagnostics. Provenance/license source fields do not exist.
- `crates/storage/src/store/plugin_permissions.rs` owns immutable capability
  requests/audit, scoped decisions, CAS revisions, runtime authorization, and
  detach-on-deny/revoke.
- `scripts/engine-smoke.mjs:2131-2737` already exercises directory inspection,
  install, permission review/grant, enable, upgrade, rollback, revoke, audit, and
  failure paths through the real Engine.

## Desktop Flow and Gaps

- `apps/desktop/src/main/index.ts:738-751` exposes a trusted native picker with
  `openDirectory` only.
- `apps/desktop/src/renderer/PluginsPanel.tsx:214-297` directly installs the
  selected directory, then opens permission review. It has no pre-install
  inspection confirmation or upgrade/rollback commands.
- `PluginsPanel.tsx:299-588` lists installed plugins, permission review,
  enable/disable/uninstall, panel preview, connector state, and partial
  contribution inventory. It does not list uninstalled bundled packages or
  immutable versions and surfaces only compact diagnostics.
- `apps/desktop/electron-builder.yml:15-21` packages the Engine, examples, and a
  raw sandbox-toolkit resource. There is no generated core catalog/index/hash
  gate and no trusted Engine bundle-root configuration.
- There is no focused `PluginsPanel` unit test; existing proof is distributed
  across Engine smoke and Electron E2E.

## Release and Example Gaps

- `docs/Full PRD gap matrix.md:178-219` identifies archive install, official core
  packaging/discovery, package integrity/version behavior, SDK/example licensing,
  and bundled-vs-community distinction as the final major plugin work package.
- Existing examples collectively cover all tiers and contribution families, but
  `examples/plugins` contains no package license metadata or license file.
- Test fixtures include fixed credentials and loopback assumptions; they must
  not be implicitly swept into application resources.

## Decisions Derived from Evidence

1. Reuse canonical tree SHA-256 as package identity so directory and archive
   forms remain equivalent.
2. Use `.tlplugin` as a closed deterministic ZIP transport, not a new executable
   runtime or remote package protocol.
3. Derive `bundled` only from an Engine-configured canonical read-only root and
   closed index; never trust manifest or renderer provenance claims.
4. Reuse existing immutable versions, permission review, preflight, CAS, exact
   attach, and compensation rather than creating a parallel updater.
5. Ship only an explicit allowlist of production-safe public-SDK examples;
   retain fixtures as test-only inputs.
6. Keep P-11 marketplace, remote signing/index, billing, and OS sandboxing out
   of scope.
