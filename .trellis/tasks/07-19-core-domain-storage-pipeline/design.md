# Technical Design: Core Domain, Storage, And Pipeline v2

## 1. Boundary And Dependency Shape

The existing headless-engine boundary remains unchanged. Two reusable crates
separate format/pipeline extension contracts from domain entities:

```text
translunar-domain
  <- translunar-filter-core <- translunar-filter-docx
  <- translunar-pipeline
  <- translunar-storage

domain + filter-core + pipeline + storage + filter-docx
  <- translunar-engine <- JSON-RPC clients
```

`domain` contains serializable business values and pure validation. It no
longer owns `Path`-based filter I/O. `filter-core` owns filter descriptors,
event streams, registry, and import/export contracts. `pipeline` owns step
descriptors, registry, definition validation, state-machine rules, and runner
coordination interfaces. `engine` registers built-ins and composes them with
storage.

## 2. Domain Contracts

### Project

```text
Project {
  id, name, sourceLocale, targetLocale, domain,
  lifecycle: active | archived | trash,
  revision,
  configuration: { templateId?, qaProfileId?, pipelineId?, engineAllowlist[] },
  createdAtMs, updatedAtMs, archivedAtMs?
}
```

The existing create payload remains valid; new configuration fields have
defaults. Metadata and lifecycle writes require `expectedRevision`.

### Document And Version

`Document` is the stable logical file. `DocumentVersion` is one immutable
managed source revision. A document points at exactly one current version.
Relative paths are normalized to forward-slash project paths, reject absolute
or parent traversal, and may be empty only for migrated root documents.

```text
Document { id, projectId, name, relativePath, format, filterId,
           currentVersion, status, revision, segmentCount,
           degradationSummary, importedAtMs, updatedAtMs }
DocumentVersion { id, documentId, version, sourceSha256,
                  originalSourcePath, managedSourcePath, reason, createdAtMs }
```

Existing segments gain a version link. Their stable IDs remain unchanged for
the schema-v1 migration. Future re-import creates a version and performs an
explicit matching operation rather than changing this migration's semantics.

### Inline Tags

Tags are separate rows/protocol values so plain source/target projections stay
searchable. `position` is a zero-based Unicode scalar index in the relevant
plain-text side. `kind` is `start`, `end`, or `standalone`; paired tags share
`pairId`. Payload is protected opaque format data and is never rendered as
HTML. Validation checks range, unique stable IDs, pair consistency, and order.

### Operation

Operations are an append-only project-local sequence. `beforeJson` and
`afterJson` contain typed entity snapshots for reversible commands; current
segment/project methods write them atomically with the row change. The sequence
is allocated inside the same immediate transaction with a unique
`(project_id, sequence)` constraint.

## 3. Schema Evolution

Migration 1 remains byte-for-byte unchanged.

Migration 2 adds lifecycle/version/history foundations:

- additive project columns: lifecycle, revision, configuration JSON,
  archived timestamp;
- additive document columns: relative path, filter ID, current version, status,
  revision, degradation JSON, updated timestamp;
- `document_versions`, `inline_tags`, and `operations` tables plus query indexes;
- nullable/backfilled segment `document_version_id` and source version;
- one version row per legacy document using its existing managed source.

Migration 3 adds pipeline persistence:

- `pipeline_definitions` and `pipeline_steps`;
- `pipeline_runs` and `pipeline_step_runs`;
- revision/status checks, deterministic step indexes, timestamps, JSON payloads,
  checkpoints/errors/usage, and cancellation flag.

JSON columns are decoded through typed helpers. Invalid stored JSON is
`StorageError::InvalidData`, never silently replaced with defaults after a row
has been written.

Before `migrate`, `Store::open` reads `user_version`. If an existing database
has pending migrations, it uses SQLite's online backup API to create
`backups/pre-migration-v<old>-<timestamp>/translunar.sqlite3` and a manifest.
Migration begins only after the backup is durable. Failure leaves the source DB
and its `user_version` unchanged.

## 4. Filter Contract

`filter-core` exposes:

```rust
pub trait DocumentFilter: Send + Sync {
    fn descriptor(&self) -> &FilterDescriptor;
    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError>;
    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError>;
    fn export(&self, request: ExportRequest) -> Result<ExportReport, FilterError>;
    fn validate(&self, path: &Path) -> Result<ValidationReport, FilterError>;
}
```

`FilterEventStream` yields `Result<FilterEvent, FilterError>` and can be
consumed without first materializing the complete document. The collector is a
state machine over document/unit boundaries and records metadata, text, tags,
notes, and degradation findings. The DOCX adapter may internally materialize
its current XML parts, but clients consume the public streaming interface.

`FilterRegistry` stores `Arc<dyn DocumentFilter>`, rejects duplicate IDs,
orders candidates by descriptor ID, and selects the highest probe confidence;
ties resolve deterministically by ID. An explicit filter ID bypasses probing.

## 5. Generic Document Flow

```text
document.import(path, project, relativePath?, filterId?)
  -> normalize/validate project-relative path
  -> explicit filter lookup or deterministic probe
  -> stream + validate events into normalized imported units/tags
  -> copy source to a version-owned managed path
  -> one transaction: document + version + segments + tags + operation
  -> return DocumentImportResult
```

On failure, incomplete rows roll back and the managed copy is removed. The old
DOCX method constructs the generic request with `builtin.docx`; its result is
projected back to the existing response type.

Export reads the current version, segments, and tags; resolves the stored
filter; writes a temporary output; validates; then atomically publishes. The
legacy DOCX export delegates and preserves its result shape.

## 6. Pipeline Contract And Runtime

Definitions reference registered step IDs, not executable code. Each
`StepDescriptor` declares input/output artifact kinds, config schema version,
and resumable/cancellable flags. Validation rejects duplicate step keys,
unknown IDs, incompatible adjacent artifact kinds, and invalid configuration.

Run state machine:

```text
queued -> running -> succeeded
                   -> failed
                   -> canceling -> canceled
running -> interrupted (restart/crash)
interrupted -> queued (resume when remaining/current step is resumable)
interrupted -> failed (explicit non-resumable recovery result)
```

Every transition requires expected run revision and commits before a status
response can observe it. Step output/checkpoint commits before advancing the
run cursor. Progress is derived from persisted step states.

`PipelineManager` returns the run after the queued transaction and starts work
on a background thread. Workers open their own configured SQLite connection;
they do not share a `rusqlite::Connection`. A thread-safe cancellation token is
paired with the durable cancellation flag. On startup, storage marks orphaned
running work interrupted before new RPC requests are accepted.

Two built-ins prove the runtime:

- `core.checkpoint`: commits a deterministic checkpoint/output and can pause in
  tests; resumable and cancellable.
- `core.qa.document`: requires a document artifact and invokes the existing
  authoritative number-QA storage path; resumable at the step boundary.

No pipeline worker writes JSON-RPC output. Polling uses `pipeline.getRun`; event
notifications are added later with the desktop streaming bridge.

## 7. Protocol Additions

Legacy methods remain. Additive method groups are:

```text
project.list                 project.update
project.setLifecycle         document.list
document.get                 document.import
document.export              filter.list
history.list                 data.checkHealth
data.createBackup            pipeline.step.list
pipeline.create              pipeline.list
pipeline.get                 pipeline.validate
pipeline.run                 pipeline.run.list
pipeline.run.get             pipeline.run.cancel
pipeline.run.resume
```

All pages default to 100 and cap at 500. Invalid page limits are
`invalid_request`. Unknown filters/steps are `not_found` with entity/id data;
invalid state transitions are `invalid_state`; stale revisions are `conflict`
with entity/expected/actual fields. Backup path failures map to `storage_error`.

## 8. Health And Backup

`data.checkHealth` is read-only. It runs `quick_check`, `foreign_key_check`,
schema/version checks, aggregate/document-version invariants, and managed-file
existence/hash checks. Findings contain IDs/paths/hashes only, never document
text. A fatal database-open error is still a protocol storage failure; row/file
problems are returned as findings so the user can act.

Explicit backup creates a new directory containing a SQLite online snapshot,
managed sources/exports required for restoration, and a versioned JSON
manifest with relative paths, sizes, and SHA-256. Files are copied to a staging
directory, verified, then renamed to the destination. Existing destinations
are never overwritten.

## 9. Compatibility And Rollback

- Protocol stays version 1 because existing request/response semantics remain.
- New fields have migration/default behavior; existing Electron consumers
  ignore additive response fields and compile against regenerated types.
- Old DOCX entry points remain covered by the original process and desktop E2E.
- Each migration and new crate lands in one task commit, but capability methods
  are not advertised until their tests pass.
- Rollback is restoring the generated pre-migration backup with the old binary;
  there is no down-migration that risks user data.

## 10. Performance Shape

Segment and history APIs are paged and select only requested rows. Aggregate
counts use indexed SQL, not in-memory scans. The 100k fixture records cold-open,
count, first/middle/last-page, and operation-page timings on VPS; these are
evidence inputs, not hardcoded unit-test wall-clock assertions on shared CI.
