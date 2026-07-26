# Plugin Multi-Tier Manifest and Runtime

## Goal and user value

Provide one versioned, tier-aware plugin control plane that can safely carry
the shipped Tier 3 process-filter plugins and the later Tier 1/Tier 2 and
non-filter contribution families. A user must be able to inspect a package,
restart the Engine, upgrade or roll back a plugin, and recover from a failed
candidate without losing the last working package, lifecycle state, grants,
diagnostics, or contribution identity.

This child closes the common control plane. It does not claim that Tier 1
evaluation, Tier 2 JavaScript/UI execution, or any new registry adapter is
implemented.

## Confirmed repository facts

- Migration 16 is released and immutable. It has one `plugin_installations`
  row per id, embeds the raw manifest/contributions/permissions, constrains
  `tier` to `process`, and has no package hash or version history.
- `crates/plugin-runtime` currently accepts only the legacy process manifest;
  `crates/protocol` currently exposes only `Process` and the six existing
  lifecycle methods (`plugin.list/get/install/enable/disable/uninstall`).
- The Engine lifecycle is currently implemented directly in
  `crates/engine/src/plugin.rs`; there is no `PluginManager` or host registry
  yet. The existing Tier 3 filter host, Engine smoke, SDK, hello-SRT example,
  and Plugins panel are the compatibility baseline and are already qualified.
- Contract generation is Rust schema → committed JSON schema → generated
  TypeScript. New wire types must therefore be added in Rust first and
  regenerated together.
- Permission grant/consent/enforcement work belongs to
  `07-26-plugin-permission-grants`; this child only preserves and transports
  the existing requested/granted fields.

## In scope

### R1. Raw manifests and one normalized model

The decoder accepts the released legacy `manifestVersion: 1` process shape
without changing its observable identity or filter behavior. It also accepts
the new `manifestVersion: 2` shape below; unknown manifest, runtime, protocol,
or contribution descriptor versions fail closed.

```json
{
  "manifestVersion": 2,
  "id": "example.hello-srt",
  "displayName": "Hello SRT",
  "version": "0.2.0",
  "hostApi": { "min": 1, "max": 1 },
  "runtime": {
    "tier": "process",
    "runtimeVersion": 1,
    "protocolVersion": 1,
    "entry": { "kind": "node", "path": "bin/hello-srt.mjs" }
  },
  "contributions": [
    {
      "kind": "filter",
      "descriptorVersion": 1,
      "id": "example.hello-srt",
      "version": "0.2.0",
      "displayName": "Hello SRT",
      "extensions": ["srt"],
      "capabilities": {
        "import": true,
        "export": true,
        "validate": true,
        "inlineTags": false,
        "notes": false,
        "degradationReport": true
      }
    }
  ],
  "permissions": []
}
```

The normalized internal contract is:

```text
NormalizedPluginManifest {
  normalizedVersion: 1,
  sourceManifestVersion: 1 | 2,
  id, displayName, version,
  hostApi: { min, max },
  runtime: DeclarativeRuntime | SandboxRuntime | ProcessRuntime,
  contributions: PluginContributionDescriptor[],
  requestedPermissions: string[],
  originalManifestJson: bounded diagnostic copy
}
```

Runtime is a tagged union. Declarative has a manifest entry only; sandbox has
`entry.kind = javascript` and a relative module path; process has
`entry.kind = node | executable` and a relative path. Legacy v1 maps
`apiVersionMin..apiVersion`, top-level `tier/entry`, and
`contributions.filters` into this model. Legacy v1 keeps its non-empty-filter
rule; v2 requires at least one total contribution.

Every contribution is tagged by `kind` and has `id`, `version`,
`displayName`, and `descriptorVersion`. The seven normalized variants are:

| Kind | Required kind-specific fields | This child does |
| --- | --- | --- |
| `filter` | `extensions`, existing `FilterCapabilities` | Keeps the shipped adapter working |
| `engineConnector` | bounded `protocol`, `operations`, `configSchemaVersion` | Validates and inventories only |
| `qaRule` | `ruleType`, `severity`, bounded definition/config | Validates and inventories only |
| `pipelineStep` | `input`, `output`, `configSchemaVersion`, `resumable`, `cancellable` | Validates and inventories only |
| `aiAction` | `label`, `placement`, bounded input/prompt descriptor | Validates and inventories only |
| `uiPanel` | `label`, `placement`, `surface`, `bridgeVersion` | Validates and inventories only |
| `externalConnector` | `transports`, `checkpointVersion`, bounded capabilities | Validates and inventories only |

All strings, arrays, maps, and JSON descriptors have explicit size/count
bounds. IDs are trimmed `[A-Za-z0-9._-]+`, `builtin.*` is reserved, and
`(kind,id)` is unique within a package. Path validation canonicalizes `/` and
`\\`, rejects absolute paths, `..` components, symlinks/reparse points,
duplicate normalized paths, and non-regular entries.

The compatibility matrix is part of the normalized validator:

| Runtime tier | Valid contribution families in this child | Executable here |
| --- | --- | --- |
| declarative | filter, qaRule, pipelineStep | none yet |
| sandbox | filter, engineConnector, qaRule, pipelineStep, aiAction, uiPanel, externalConnector | none yet |
| process | filter, engineConnector, qaRule, pipelineStep, aiAction, externalConnector | process filter only |

An invalid tier/entry or tier/contribution pair is `plugin_invalid_manifest`.
A valid descriptor whose host or adapter is not shipped is
`plugin_capability_unsupported`, never a partial registration.

### R2. Migration 18 and version history

Migration 16 and 17 remain byte-for-byte unchanged. Migration 18 creates
immutable `plugin_versions` history and adds an installation projection:

- `plugin_versions`: `id`, `plugin_id` FK, semantic `version`, nullable
  `packageSha256`, original and normalized manifest/runtime/contribution JSON,
  compatibility JSON, bounded diagnostics, `state`, and install/activate/
  deactivate/failure timestamps. It has unique `(plugin_id,id)`,
  `(plugin_id,version)`, and non-null `(plugin_id,packageSha256)` constraints.
- `plugin_installations`: `activeVersionId`, package hash, normalized
  manifest/runtime/contribution projections, compatibility and diagnostics,
  while retaining every migration-16 column and value for wire compatibility.
- Foreign keys/triggers ensure an active version belongs to the same plugin;
  an active version cannot be deleted. Package/version JSON is immutable.

The SQL migration seeds one deterministic legacy version per v16 row. Hashing
and manifest normalization require filesystem access, so `Store::open` follows
the SQL migration with an idempotent immediate transaction that computes a
canonical package hash and fills the projections. A missing legacy package
never deletes the row; it records a bounded compatibility diagnostic and
prevents registration. Reopening or rerunning normalization is a no-op.
Existing paths, status, grants, crash count, timestamps, revision, and raw
manifest bytes are preserved.

The package SHA-256 is lowercase hex over canonical UTF-8 JSON containing
sorted `{path,size,sha256}` entries for every regular file (including the
manifest); each file digest is streamed. The staged copy is the hashed copy,
not the caller's source directory.

### R3. Tier-neutral lifecycle and atomic packages

Install, inspect, enable, disable, upgrade, rollback, restart restoration,
and uninstall go through a host registry plus a contribution-adapter registry.
The existing process-filter host remains the only executable host in this
child.

- `plugin.inspect` validates and normalizes a source package without copying,
  persisting, starting, or registering it.
- Install reserves a unique staging directory, validates/hash-checks it, and
  persists an `installed` inventory. A valid but unsupported tier/adapter may
  remain installed with `compatible=false`; enable returns the typed capability
  error before changing status or registries.
- Upgrade requires an expected installation revision. It stages and probes a
  candidate before touching the active directory. A single immediate CAS
  transaction inserts the immutable version and swaps the active projection;
  the previous active version/path/process remains recoverable. Same version
  plus same hash is idempotent; same version plus a different hash is a typed
  conflict. Candidate validation/start/adapter failure retains only a failed
  candidate diagnostic and leaves the old active summary, bytes, process, and
  filters unchanged.
- Rollback requires an expected revision and a validated version belonging to
  the same plugin. It probes before the CAS swap and retains all packages.
- Uninstall detaches and stops first, renames the package root into a private
  quarantine, deletes rows in one transaction, then removes quarantine. A
  failed rename or cleanup never destroys the active package or database row.
- Enable/disable/upgrade/rollback increment the installation revision exactly
  once on success. Crash recording remains guarded by plugin id, active
  version, enabled status, and activation revision, so an old process cannot
  degrade a newer version.

The serialized Engine dispatcher remains the supported lifecycle contract.
SQLite immediate transactions/CAS protect concurrent Store connections; this
task makes no untested claim of two independent Engine processes sharing one
data directory.

### R4. Additive protocol and public SDK

Existing six methods and fields remain decodable. Add these exact protocol-v1
methods and generated contracts:

```text
plugin.inspect       PluginInspectParams      -> PluginInspection
plugin.version.list  PluginVersionListParams -> PluginVersionPage
plugin.upgrade       PluginUpgradeParams     -> PluginLifecycleResult
plugin.rollback      PluginRollbackParams    -> PluginLifecycleResult
```

`PluginInspectParams` carries `sourcePath`; the result carries normalized
manifest, package hash, compatibility, diagnostics, and `canInstall` without
raw paths in renderer state. Version-list is bounded/pageable and ordered by
install time then id. Upgrade carries `pluginId`, `sourcePath`, required
`expectedRevision`, `actor`, and `reason`. Rollback carries `pluginId`,
`versionId`, required `expectedRevision`, `actor`, and `reason`.

`PluginSummary` gains additive active-version, runtime, tagged-contribution,
compatibility, diagnostics, and package-hash projections; old `filters` and
permission fields remain. `PluginVersionSummary` exposes id, plugin/version,
hash, tier/runtime, contribution count, state, compatibility, diagnostics, and
bounded timestamps. `PluginLifecycleResult` returns the authoritative summary,
new active version, previous version, and action (`upgraded` or `rolledBack`).
The SDK exports the same normalized unions and validation helpers while keeping
the legacy process manifest and `startProcessPlugin` API source-compatible.

Stable error behavior is:

| Condition | Error code and mutation rule |
| --- | --- |
| Unknown schema/field, invalid id/path/tier/descriptor | `plugin_invalid_manifest`; no row/path/registry write |
| Unsupported required schema/API version | `plugin_unsupported_version` or `plugin_incompatible_host`; no activation |
| Valid but unavailable tier/adapter | `plugin_capability_unsupported`; install inventory may remain disabled, enable/upgrade has no active mutation |
| Built-in/duplicate id or version/hash collision | `plugin_conflict`; existing bytes/process/summary unchanged |
| Hash/staging mismatch or symlink/path escape | `plugin_package_hash_mismatch`/`plugin_package_invalid`; candidate only is removed or marked failed |
| Stale expected revision | `conflict` with entity/id/expected/actual; no package or registry mutation |
| Candidate start/handshake/adapter failure | `plugin_upgrade_failed`; previous active version remains authoritative |
| Existing process crash/timeout | existing `plugin_process_failed` data and degraded CAS semantics |
| Permission grant mismatch | existing `plugin_permission_denied`; grant policy remains the next child |

Add `plugin.control-plane.v1`, `plugin.manifest.v2`,
`plugin.version-history.v1`, `plugin.upgrade.v1`, and
`plugin.rollback.v1` capabilities. Do not advertise Tier 1/Tier 2 hosts or
non-filter adapters until their owning children pass.

### R5. Compatibility and evidence

The implementation must prove legacy decoding, migration/reopen, package
hashing, duplicate and revision conflicts, successful blue/green upgrade,
failed upgrade retention, rollback, unsupported capability behavior, restart,
and unchanged Tier 3 hello-SRT lifecycle. Existing Plugins-panel lifecycle
and three viewport regression remain required; upgrade UI is a later management
child.

## Out of scope

- Per-capability consent, scoped grants, revoke, audit, and enforcement
  changes (permission-grants child).
- Tier 1 evaluation, Tier 2 JavaScript/UI sandboxing, new contribution adapters,
  provider catalogs, marketplace/archive distribution, signing, billing, and
  remote indexes.
- Claims of native OS sandboxing or cross-process Engine ownership beyond the
  tested serialized Engine/SQLite contract.

## Acceptance criteria

- [ ] AC1: A migration-16 fixture containing installed/enabled/disabled/
      degraded rows reopens under migration 18 twice with every legacy field,
      grant, crash, timestamp, revision, contribution, raw manifest, and path
      preserved; normalized version/history and deterministic hash are present
      when the package exists, and missing packages retain a diagnostic row.
- [ ] AC2: Legacy hello-SRT installs, enables, restarts, imports/exports,
      disables, uninstalls, and remains byte/descriptor compatible through the
      normalized model.
- [ ] AC3: v2 fixtures cover all three tiers and all seven contribution kinds;
      valid unions normalize, invalid version/entry/path/collision cases fail
      closed, and unsupported hosts/adapters return a typed capability error
      without partial registry/process mutation.
- [ ] AC4: Staged install/upgrade hashes the staged bytes; duplicate/version
      collisions, failed validation/start/handshake, and hash changes never
      clobber the prior active package. A successful upgrade and explicit
      rollback are restart-safe and retain the prior version.
- [ ] AC5: Enable/disable/upgrade/rollback use expected-revision CAS, isolate
      plugins and built-ins, increment revision once on success, and ignore a
      stale old-process crash after a newer activation.
- [ ] AC6: Protocol schema/generated TypeScript, SDK build/tests, storage/
      Engine tests, real Engine smoke, existing Plugins-panel Electron E2E,
      three viewport screenshots, and all relevant repository quality gates
      pass.

## Planning decisions and deferred risk

No product decision remains blocking: unsupported packages are inspectable and
may persist as inactive inventory, but they can never attach or execute until
their host/adapter child ships. The only deliberate technical limitation is
that cross-process Engine ownership is not asserted without a dedicated
multi-process evidence harness.
