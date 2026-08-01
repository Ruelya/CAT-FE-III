# Plugin Management and Release Qualification

## Goal

Complete the final P1 child of the public plugin runtime: users can inspect and
install a bounded local plugin directory or `.tlplugin` file, discover and
restore release-bundled core plugins offline, review exact permissions, upgrade
or roll back immutable versions, understand contribution and failure state, and
complete the lifecycle without developer tools. The release path must preserve
the Engine as authority for package validation, provenance, lifecycle,
permissions, and diagnostics.

## Background and Confirmed Facts

- P-10 requires local file/directory install, bundled official core plugins, and
  manual community install (`docs/PRD.md:454-473`). P-11 remote marketplace and
  one-click online discovery are P2 and outside this parent.
- The Engine already owns directory-package inspection, canonical tree hashing,
  install, immutable versions, upgrade, rollback, enable/disable, uninstall,
  capability review/grant/deny/revoke, audit, and exact-generation compensation
  (`crates/engine/src/plugin.rs`, `crates/plugin-runtime/src/lib.rs`,
  `crates/storage/src/store/plugin.rs`).
- Package traversal already rejects links/reparse points and enforces 4,096
  files, 512 MiB total bytes, 512-byte paths, and depth 32. It accepts only a
  directory today; no archive extractor or archive format exists.
- The desktop Plugins panel installs a directory, reviews permissions, lists
  status/contributions, enables/disables, previews panels, and uninstalls. It
  does not inspect before mutation, choose an upgrade, list immutable versions,
  roll back, or discover uninstalled bundled plugins
  (`apps/desktop/src/renderer/PluginsPanel.tsx:214-297,299-588`).
- Electron currently bundles only `sandbox-toolkit` as a raw resource and its
  picker selects only directories (`apps/desktop/electron-builder.yml:15-21`,
  `apps/desktop/src/main/index.ts:738-751`).

## Requirements

### R1. Closed Local Package Format

- Keep directory installation compatible and add a versioned `.tlplugin` ZIP
  format whose extracted root contains exactly one plugin package with
  `manifest.json`; archive format/version detection is closed and deterministic.
- Extraction must reject absolute/drive/UNC paths, `..`, empty or duplicate
  normalized paths, links/reparse entries, special files, encryption, unsupported
  compression, multiple package roots, case-fold collisions, and count/depth/
  path/compressed/uncompressed limits before a managed package is published.
- Directory and archive forms of identical bytes produce the same canonical
  package SHA-256. Inspect/install/upgrade use one stage-validate-hash path and
  clean temporary output on every failure.
- A repository script builds reproducible archives and an index from an explicit
  allowlist; timestamps, entry ordering, permissions, and compression settings
  cannot introduce nondeterministic output.

### R2. Distribution Metadata and Provenance

- Add bounded, closed public manifest distribution metadata for publisher,
  SPDX-style license expression, and optional homepage. Released manifest v1
  and existing v2 packages remain readable; bundled packages must provide the
  metadata and license material required by the release validator.
- Installation/version state records a host-derived source kind:
  `localDirectory`, `localArchive`, or `bundled`. A manifest or renderer cannot
  claim bundled/core provenance.
- The Engine receives an optional read-only bundled-plugin root from trusted
  startup configuration, validates its generated index and every archive hash,
  and exposes an additive bounded catalog. Absence or corruption degrades only
  the catalog and never prevents Engine startup or ordinary local install.
- The offline catalog distinguishes installed/current/update-available states.
  Applying a bundled item reuses normal install/upgrade, permission-diff,
  optimistic revision, exact-generation, and compensation behavior.

### R3. Package Integrity and Lifecycle

- Inspect is side-effect free and returns normalized identity, compatibility,
  diagnostics, canonical hash, distribution metadata, and derived source kind.
- Install/upgrade revalidate the staged package immediately before publication.
  Same plugin version plus same hash is idempotent; the same semantic version
  with changed bytes is a typed conflict. A post-install managed-tree hash
  mismatch is typed and never activates the candidate.
- Upgrade and bundled apply keep the prior active generation usable until the
  candidate package, capability requests, registries, configuration, and hosts
  are ready. Failure restores the prior generation and leaves an immutable,
  bounded diagnostic/version record.
- Rollback resolves only a stored immutable version, verifies its package hash,
  rechecks compatibility and permissions, and uses the same attach/compensation
  path. Disable/uninstall remove only exact-generation contributions and do not
  delete release-bundled source archives.

### R4. Release-Grade Desktop Management

- The package picker accepts a directory or `.tlplugin` file. Local install and
  upgrade first show an inspection confirmation with identity, version, tier,
  source, hash prefix, compatibility, license/publisher, contributions,
  requested capability risks, and diagnostics before mutation.
- The Plugins surface provides dense, keyboard-accessible views for installed
  and bundled packages, current/available versions, source badges, complete
  contribution inventory, permission decisions, compatibility, crash count,
  bounded last error, and diagnostics.
- Per-plugin commands include review permissions, enable/disable, choose local
  upgrade, list version history, roll back, and uninstall. Bundled entries can be
  installed/restored or applied as an update without exposing filesystem paths
  to renderer state.
- Every mutation uses the current Engine revision, has explicit pending/success/
  error state, closes stale panel sessions when ownership changes, refreshes
  Engine-derived data, and preserves typed errors. No domain authority moves to
  React or Electron main.
- English and Simplified Chinese strings, focus trapping, reduced-motion-safe
  behavior, narrow viewport wrapping, and non-overlap are required.

### R5. Official Packages and Public Guidance

- Build a production-safe offline core set from explicit existing public-SDK
  examples that collectively demonstrate Tier 1, Tier 2, Tier 3, filter,
  QA/pipeline, engine connector, AI action, and UI panel surfaces. Test-only
  fixtures, fixed credentials, and packages requiring private Engine APIs are
  excluded from the release allowlist.
- Every released example declares its license/publisher, carries required
  license text, builds reproducibly, and is validated through the same public
  package command used by community authors.
- Public docs specify package layout/format, validation limits, source badges,
  permission review, install/upgrade/rollback, bundled core behavior, licensing,
  compatibility, failure recovery, and honest Tier 1/2/3 isolation boundaries.

### R6. Qualification and Evidence

- Focused Rust and TypeScript tests cover archive security, reproducibility,
  index/hash tampering, provenance spoofing, restart, idempotent install,
  conflicting same-version bytes, upgrade permission expansion, failed candidate
  compensation, rollback integrity, degraded recovery, and cross-plugin health.
- Real Engine smoke exercises local archive inspect/install, permission review,
  enable, contribution use, restart, upgrade, rollback, revoke, disable, and
  uninstall plus a bundled catalog install/restore path.
- Real Electron E2E exercises inspection confirmation, bundled/local paths,
  permission decisions, upgrade/version history/rollback, diagnostics, stale
  revision recovery, and uninstall with no console/page errors.
- Reproducible evidence maps every requirement and acceptance criterion to tests,
  package artifacts, secret/path scans, and inspected screenshots.

## Acceptance Criteria

- [ ] AC-01: A directory and reproducible `.tlplugin` containing identical files
      inspect to the same normalized manifest and canonical SHA-256, and install
      through the same managed-package transaction.
- [ ] AC-02: Malicious archives covering traversal, absolute/drive/UNC paths,
      duplicate/case-folded entries, links, encryption, unsupported compression,
      bombs, excess count/depth/path/bytes, and invalid roots fail before any
      persistent or managed-package mutation.
- [ ] AC-03: Manifest distribution metadata is bounded and strict; legacy
      packages remain compatible, while release-bundled packages without valid
      publisher/license metadata or license material fail the build gate.
- [ ] AC-04: Bundled provenance is derived only from the configured read-only
      Engine root. A local manifest/path/renderer request cannot spoof it, and a
      missing or corrupted catalog fails closed without breaking local plugins
      or ordinary Engine health.
- [ ] AC-05: Same-version/same-hash install or apply is idempotent; changed bytes
      conflict. Hash tampering before activation, restart, or rollback is typed
      and never changes the active generation.
- [ ] AC-06: Local and bundled upgrades preserve the prior active generation
      until candidate validation, permission review, host startup, registry
      attach, and version CAS succeed; every tested failure compensates fully.
- [ ] AC-07: Rollback activates only a verified immutable stored version,
      restores matching grants/configuration and contribution ownership, and
      leaves unrelated plugins and built-ins healthy.
- [ ] AC-08: Desktop users can inspect then install a directory/archive, browse
      the offline bundled catalog, review exact capability changes, choose an
      upgrade, inspect version history, roll back, recover a degraded plugin,
      disable, and uninstall without developer tools.
- [ ] AC-09: The Plugins surface displays trustworthy source/license/version/
      compatibility/diagnostic/contribution/permission state, remains accessible
      and non-overlapping at 1250x744, 1680x942, and 1920x1080, and has no
      renderer console errors.
- [ ] AC-10: The allowlisted core set and all released examples build from public
      SDK APIs, carry license metadata/text, produce deterministic packages, and
      pass the same validator documented for community authors.
- [ ] AC-11: Generated contracts, SDK/package tests, Engine smoke, plugin runtime
      and storage tests, desktop build/E2E, docs checks, workspace Rust gates, and
      relevant packaging checks pass on supported toolchains or record verified
      unrelated baselines without claiming them as green.
- [ ] AC-12: Evidence maps R1-R6 and AC-01-AC-12, records package hashes and
      screenshot dimensions, and proves archives/index/diagnostics/logs contain
      no credentials, private paths, source text, or raw plugin payloads.

## Out of Scope

- P-11 hosted marketplace/index, online discovery, automatic remote updates,
  accounts, billing, ratings, moderation, remote signing, or trust services.
- Claiming Tier 2 or Tier 3 is an OS sandbox; adding AppContainer, seccomp,
  containers, or per-plugin users.
- Rewriting contribution runtimes, adding new contribution families, converting
  built-in IDML internals, or adding vendor-specific production connectors.
- Application auto-update/signing/notarization and general installer repair;
  those remain owned by platform packaging tasks.

## Constraints

- Preserve manifest v1/v2, existing directory installs, immutable version IDs,
  package hashes, capability audit, generated protocol v1, and exact-generation
  lifecycle semantics.
- Treat archives, manifests, indexes, and renderer requests as untrusted. Do not
  expose arbitrary filesystem paths, package bytes, secrets, stack traces, or
  generic Engine calls to the renderer or plugin hosts.
- Keep release inputs explicit and offline-reproducible. Never silently treat a
  development fixture as a bundled core package.
