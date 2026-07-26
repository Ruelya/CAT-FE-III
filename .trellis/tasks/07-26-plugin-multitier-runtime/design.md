# Design: Plugin Multi-Tier Control Plane

## Boundary and ownership

The current implementation has lifecycle methods directly on `EngineService`;
there is no pre-existing `PluginManager`. This design introduces the smallest
compatible extraction: normalized models and host/adapter registries live
behind the existing Engine service, and the existing process-filter path is
kept intact while it is moved behind those interfaces.

| Layer | Owns | Must not own |
| --- | --- | --- |
| `plugin-runtime` | raw decoders, normalized manifest, bounded package walker/hash, process host and handshake projection | SQLite, protocol DTOs, renderer state |
| `storage` | migration 18, installation projection, immutable version history, CAS and quarantine metadata | process spawning or registry mutation |
| `protocol` | additive v1 DTOs, tagged wire unions, stable error codes and method catalog | runtime policy or filesystem access |
| `engine` | lifecycle orchestration, host resolution, adapter preflight, attach/detach, restart and rollback | renderer code and raw SQL in UI |
| SDK | public normalized types/validators and existing process server | Engine internals and private registries |
| Desktop | existing lifecycle presentation and typed generated calls | manifest parsing, hashing, SQLite, upgrade policy |

Generated TypeScript remains the sole renderer wire source. Raw manifests and
absolute managed paths never cross the renderer boundary.

## Normalization model

### Raw decoders

Use separate `RawPluginManifestV1` and `RawPluginManifestV2` structs with
`deny_unknown_fields`. V1 is the released shape, including
`apiVersionMin/apiVersion`, top-level `tier/entry`, object-shaped
`contributions.filters`, and the non-empty-filter rule. V2 uses
`manifestVersion`, `hostApi`, the tagged `runtime`, and an array of tagged
contributions. Both decode into the same model:

```rust
struct NormalizedPluginManifest {
    normalized_version: u32,       // exactly 1 for this child
    source_manifest_version: u32,  // 1 or 2
    id: String,
    display_name: String,
    version: String,
    host_api: PluginApiRange { min: u32, max: u32 },
    runtime: PluginRuntimeDescriptor,
    contributions: Vec<PluginContributionDescriptor>,
    requested_permissions: Vec<String>,
    original_manifest_json: serde_json::Value, // bounded diagnostic copy
}
```

`PluginRuntimeDescriptor` is a `serde(tag = "tier")` union:

```text
declarative { runtimeVersion: 1, entry: { kind: "manifest" } }
sandbox     { runtimeVersion: 1, entry: { kind: "javascript", path, exportName? } }
process     { runtimeVersion: 1, protocolVersion: 1,
              entry: { kind: "node" | "executable", path } }
```

The decoder validates descriptor versions before looking at fields. It
canonicalizes path separators and components, rejects absolute/escaping paths,
symlinks/reparse points and duplicate normalized entries, and checks a staged
regular file for sandbox/process entries. Legacy v1 maps exactly to the
process variant and preserves filter descriptor order, IDs, versions,
extensions, and capabilities.

`PluginContributionDescriptor` is a `serde(tag = "kind")` union. All variants
carry `descriptorVersion`, `id`, `version`, and `displayName`; the kind-specific
payload is bounded and typed:

```text
filter             { extensions, FilterCapabilities }
engineConnector    { protocol, operations, configSchemaVersion }
qaRule             { ruleType, severity, definition }
pipelineStep       { input, output, configSchemaVersion, resumable, cancellable }
aiAction           { label, placement, input, promptTemplate }
uiPanel            { label, placement, surface, bridgeVersion }
externalConnector  { transports, checkpointVersion, capabilities }
```

The validator enforces field presence, string/array/map bounds, ID syntax,
unique `(kind,id)` within the package, and reserved `builtin.*` IDs. Domain
adapters may add semantic validation later; this child must still reject an
unknown required descriptor version rather than silently accepting an
unversioned descriptor.

### Tier and adapter resolution

`PluginHostRegistry::resolve(runtime)` returns either the existing
`ProcessPluginHost` or a typed `CapabilityUnsupported` result. A separate
`ContributionAdapterRegistry::preflight(all_descriptors)` validates the entire
inventory before attaching any descriptor. The matrix is:

| Runtime | Descriptor forms accepted by normalization | Host/adapter available now |
| --- | --- | --- |
| declarative | filter, qaRule, pipelineStep | none |
| sandbox | filter, engineConnector, qaRule, pipelineStep, aiAction, uiPanel, externalConnector | none |
| process | filter, engineConnector, qaRule, pipelineStep, aiAction, externalConnector | process + filter only |

An invalid pairing is `plugin_invalid_manifest`. A valid but unavailable host
or adapter is `plugin_capability_unsupported`. Preflight happens before
registry mutation, so a package with one unsupported descriptor cannot leave a
subset of filters registered. The process handshake also canonicalizes and
compares the returned runtime/contribution inventory with the persisted
normalized model; mismatch is a typed protocol/manifest failure.

## Storage and migration 18

### SQL phase

Do not edit `MIGRATION_16` or `MIGRATION_17`. `MIGRATION_18` runs in the normal
immediate migration transaction and creates `plugin_versions`, then copies the
old `plugin_installations` table to a new table because the released `tier`
check cannot be altered in place. The new projection keeps every old column
and adds:

```text
active_version_id       nullable only during migration, FK to same plugin version
package_sha256          nullable for missing legacy packages
runtime_json             strict JSON object
normalized_manifest_json strict JSON object
compatibility_json      strict JSON object
diagnostics_json        strict JSON array
```

`plugin_versions` has:

```text
id PRIMARY KEY
plugin_id REFERENCES plugin_installations(id) ON DELETE CASCADE
version CHECK(trim(version) <> '')
package_sha256 nullable, 64 lower-hex characters when present
package_path (original path) and managed_package_path (new staged path)
manifest_version, runtime_json, normalized_manifest_json,
contributions_json, compatibility_json, diagnostics_json
state CHECK(state IN ('validated','failed'))
installed_at_ms, activated_at_ms, deactivated_at_ms, failed_at_ms
UNIQUE(plugin_id,id), UNIQUE(plugin_id,version)
UNIQUE(plugin_id,package_sha256) WHERE package_sha256 IS NOT NULL
```

Foreign-key checks/triggers ensure `active_version_id` belongs to its
installation and cannot be deleted while active. Immutable version columns
are protected by a store update whitelist (and a SQLite guard where practical).
The migration seeds `legacy-v16:<plugin-id>` deterministically, sets the active
pointer, and preserves old JSON/path values. It does not calculate hashes in
SQL.

### Filesystem normalization phase

After SQL reaches schema 18, `Store::open` runs
`normalize_plugin_versions(DataPaths)`:

1. Read each legacy package and normalize/hash outside the database transaction.
2. Start an immediate transaction and re-check the installation id, revision,
   raw manifest, and active version before writing projections.
3. Update only an unchanged row; retry/skip on a concurrent revision change.
4. Preserve a missing/moved package row and write a bounded compatibility
   diagnostic; an enabled row is not registered on restart.

Rerunning the pass produces no duplicate versions or revision increments.
The canonical package hash is lowercase SHA-256 over UTF-8 JSON:

```json
{"algorithm":"sha256","version":1,
 "entries":[{"path":"...","size":123,"sha256":"..."}]}
```

Entries are every regular file, slash-normalized and bytewise sorted; file
digests are streamed. Limits cover manifest bytes, file count, total bytes,
path length, and nesting. Symlinks/reparse points, duplicate paths, and path
escape fail before a managed copy is published.

## Lifecycle and atomicity

```text
inspect -> normalized/compatible report (no write)
install -> staged -> validated -> installed inventory
enable  -> CAS enabled -> host/adapter attach -> active
upgrade -> staged -> validated/probed -> CAS active swap -> attach
          \-> failed candidate (old active unchanged)
rollback -> validated/probed prior version -> CAS active swap
disable -> CAS disabled -> detach -> stop
uninstall -> detach/stop -> quarantine rename -> DB delete -> cleanup
```

### Install

Reserve a unique `.staging/<plugin-id>-<nonce>` directory without deleting an
existing target. Copy regular files, validate and hash the staged bytes, decode
the normalized model, and run host/adapter preflight. For a new unsupported
package, persist inactive inventory with `compatible=false`; do not spawn or
attach. For a supported package, publish a no-clobber version directory and
insert installation + version in one transaction. An existing ID is rejected
before touching its managed bytes.

### Upgrade

Require `expectedRevision`. Stage/hash/decode/preflight/probe the candidate
before touching the active directory. If an enabled process plugin is being
upgraded, start the candidate and verify handshake inventory first. In one
immediate CAS transaction, insert the immutable candidate and swap
`active_version_id` plus legacy projections. Attach/detach under the serialized
Engine dispatcher. If attach fails, compensate with a CAS back to the previous
active and mark only the candidate failed. A stale CAS stops and cleans the
candidate rather than overwriting a newer active version.

Same `(plugin_id,version,hash)` returns the existing authoritative result;
same version with another hash returns `plugin_conflict`. No active package is
removed during candidate work.

### Rollback, crash, and uninstall

Rollback probes a same-plugin `validated` version before swapping. Crash
recording matches plugin id, active version id, enabled status, and activation
revision; a late old-process failure is ignored. Uninstall first renames the
managed root to a private quarantine, then deletes the installation/version
rows transactionally, then removes quarantine. Failed rename/cleanup leaves a
recoverable diagnostic and does not destroy the active state.

The supported concurrency boundary is one serialized Engine dispatcher plus
SQLite CAS for multiple Store connections. No cross-process Engine ownership
claim is made without a separate evidence harness.

## Protocol and SDK contract

Add these exact catalog entries in `crates/protocol` and regenerate schema/TS:

```text
plugin.inspect       PluginInspectParams      -> PluginInspection
plugin.version.list  PluginVersionListParams -> PluginVersionPage
plugin.upgrade       PluginUpgradeParams     -> PluginLifecycleResult
plugin.rollback      PluginRollbackParams    -> PluginLifecycleResult
```

```rust
PluginInspectParams      { source_path: String }
PluginVersionListParams  { plugin_id: String, offset: u32, limit: u32 }
PluginUpgradeParams      { plugin_id: String, source_path: String,
                           expected_revision: u64, actor: String, reason: String }
PluginRollbackParams     { plugin_id: String, version_id: String,
                           expected_revision: u64, actor: String, reason: String }
```

`PluginInspection` contains normalized manifest, `packageSha256`,
`PluginCompatibility`, bounded `PluginDiagnostic[]`, and `canInstall`.
`PluginVersionSummary` contains id/plugin/version/hash/path/tier/runtime,
contribution count, state, compatibility, diagnostics, and bounded timestamps.
`PluginLifecycleResult` returns the authoritative `PluginSummary`, active and
previous version IDs, and `action`. Existing six methods and summary fields
remain source-compatible; new summary fields are additive.

Add stable error codes `plugin_unsupported_version`,
`plugin_incompatible_host`, `plugin_capability_unsupported`,
`plugin_package_invalid`, `plugin_package_hash_mismatch`, and
`plugin_upgrade_failed`; reuse existing `plugin_invalid_manifest`,
`plugin_permission_denied`, `plugin_process_failed`, `conflict`, `not_found`,
and `invalid_state` where their semantics already match. Error `data` is
bounded and includes plugin/version/phase, never raw stderr or secrets.

Advertise control-plane/versioning capabilities only:
`plugin.control-plane.v1`, `plugin.manifest.v2`,
`plugin.version-history.v1`, `plugin.upgrade.v1`, and
`plugin.rollback.v1`, alongside the already qualified process/filter strings.

## Good, base, bad, and wrong/correct cases

- **Good:** normalize a legacy hello-SRT row, reopen twice, upgrade to a
  staged candidate, restart, roll back, and observe the original filter ID,
  bytes, grants, and diagnostics.
- **Base:** inspect a valid declarative or sandbox package and show a complete
  normalized inventory plus `canInstall=false`/unsupported capability; no
  process, row, or registry attach occurs.
- **Bad:** a stale revision, duplicate hash, handshake mismatch, symlink, or
  adapter gap leaves the prior active version authoritative and returns a
  typed bounded error.

Wrong:

```rust
copy_package(source, data_dir.join(plugin_id)); // deletes active bytes first
store.upsert_plugin_installation(candidate);    // no expected revision
register_filter(first_descriptor);              // discovers unsupported kind later
```

Correct:

```rust
let staged = stage_and_hash_without_clobber(source)?;
let candidate = normalize_and_preflight(staged)?;
probe_all_hosts_and_adapters(&candidate)?;
store.cas_swap_active(plugin_id, expected_revision, candidate)?;
attach_all_or_compensate(candidate);
```

## Verification and rollback points

Verification must cover runtime normalization, migration 16→18/reopen/
rollback, hash/path limits, version-store CAS, failed candidate retention,
legacy Engine smoke, unsupported capability isolation, generated contract/SDK
compatibility, and existing desktop lifecycle at 1250x744, 1680x942, and
1920x1080. The implementation plan maps each test to AC1–AC6.

Rollback points are: normalized decoder before migration; migration before
projection normalization; candidate staging before active swap; registry
attachment with compensating CAS; and quarantine before uninstall deletion.
