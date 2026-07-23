# Technical Design: Offline Task Packages

## 1. Ownership And Flow

```text
trusted file dialogs / Project Insights
  -> generated taskPackage RPC contracts
  -> Engine package service and staged ZIP codec
  -> task-package-core validation + three-way classifier
  -> Store migration 13 and Immediate transactions
  -> existing document/editor/review/TM/TB domain operations
```

Rust owns package parsing, canonicalization, hashing, limits, origin binding,
conflict classification, revision validation, merge semantics, and history.
The renderer sends paths, IDs, selections, expected revisions, actor, and
reason only. Package files are never opened as SQLite databases.

## 2. Package Format

Use a new `.tltask` ZIP format, distinct from `.tlcat` project archives.
`task-package-core` owns the pure manifest and projection models:

- `TaskPackageManifest`: `formatVersion`, `packageId`, `kind` (`assignment` or
  `return`), origin `projectId`, project name/locales, `baseProjectRevision`,
  optional `parentPackageId`, instruction digest, selected document IDs,
  entry metadata, and a manifest hash over canonical JSON with the hash field
  omitted.
- `TaskPackageDocument`: origin document ID, source digest, base document
  revision, immutable source/skeleton entry path, and bounded segment rows.
- `TaskPackageSegment`: origin document/segment IDs, ordinal, source hash,
  base revision, target/tag/workflow/comment projections, and a projection
  hash. Return packages omit unchanged rows and include the original base
  projection alongside each changed row.
- `TaskPackageAssetSlice`: explicit TM/TB library identity, locale, row
  provenance, and bounded content. Assignment slices are read-only in the task
  project and are never implicitly merged back.

Payload paths are deterministic (`manifest.json`, `documents/<id>/source.*`,
`documents/<id>/segments.json`, `assets/tm/<id>.json`, `assets/tb/<id>.json`,
`instructions.txt`). ZIP readers reject traversal, duplicate names,
encryption, unsupported compression, excessive entry count/size/ratio, and
malformed canonical JSON before any Store call. Publication uses the existing
staging/no-clobber helper.

## 3. Detached Import Identity

An assignment import creates a regular local project through one Store
transaction, but generates new local project/document/segment IDs. Migration
13 stores `task_package_bindings` mapping each local identity to the origin
project/document/segment ID, base revision/hash, package ID, and source entry.
The binding is immutable and has a unique `(package_id, origin_segment_id)`
constraint. Imported source bytes are copied to managed workspace paths. The
task project configuration carries only a non-secret package reference and
instructions; TM/TB slices are imported as read-only, project-owned snapshots
with provenance and no writable mount.

Return export resolves changed local rows through bindings, verifies their
source hash and base revision, and emits origin IDs plus the base projection.
It refuses rows whose binding is missing, duplicated, or no longer matches the
immutable source. The return package is a transport artifact; the local task
project remains intact after export.

## 4. Durable Preview And Merge Model

Migration 13 adds:

- `task_packages`: package identity, kind, origin/working project IDs,
  parent package, base project revision, canonical manifest/hash, staged path,
  status, actor, and timestamps.
- `task_package_bindings`: immutable local-to-origin document/segment mapping
  and base hashes/revisions for imported assignments.
- `task_package_previews`: preview ID, package ID, origin project, expected
  project revision, status, counts JSON, staged path, and result metadata.
- `task_package_preview_rows`: preview row ID, origin IDs, disposition,
  base/current/remote projection hashes, current/remote revisions, diagnostic
  code, and selected flag. Foreign keys cascade only to their owning preview.

`taskPackage.preview` stages and validates the package, loads the authoritative
origin rows, and calls the pure classifier. It stores all row classifications
in one transaction. It never mutates document, TM/TB, or operation tables.

`taskPackage.apply` validates preview status, expected project/document/segment
revisions, selected IDs, and row dispositions. It then opens one Immediate
transaction and applies selected rows through shared Store helpers. Target,
tag, workflow, and comment changes use the same invariants as editor/review
writes; confirmed target changes use the existing confirmation/TM sink path.
One package operation records counts, selected row IDs, actor, reason, base and
result project revisions. The preview is marked applied with the serialized
result. Any error rolls back all writes and leaves the preview/package staged.

`taskPackage.apply` is idempotent by preview ID plus an Engine/Storage-owned
request digest derived inside the write boundary from the preview ID, expected
project revision, sorted selected row IDs, actor, and reason. The Renderer
neither sends nor computes this digest. A terminal preview returns the stored
result only when the internally derived digest matches; a different retry
receives a typed invalid-state error. An explicit discard operation removes
staged transport files only after the package and its open previews have been
marked discarded.

## 5. Protocol Surface

Additive methods:

```text
taskPackage.export       TaskPackageExportParams       -> TaskPackageResult
taskPackage.preview      TaskPackagePreviewParams      -> TaskPackagePreviewResult
taskPackage.apply        TaskPackageApplyParams        -> TaskPackageApplyResult
taskPackage.import       TaskPackageImportParams       -> TaskPackageImportResult
taskPackage.discard      TaskPackageDiscardParams      -> TaskPackageResult
```

`export` accepts assignment source (`projectId`, selected document/segment
IDs, asset slices, instructions, destination, actor/reason) or return source
(`workingProjectId`, parent package ID, destination, actor/reason). `import`
accepts an assignment preview ID and creates the detached project. `preview`
accepts exactly one of an assignment/return package path or a durable preview
ID and returns kind, package metadata, paged rows, counts, and diagnostics.
`apply` accepts a return preview ID, expected origin project revision, selected
row IDs, actor, and reason. `discard` accepts package/optional preview identity,
actor, and reason. No public request carries an idempotency digest.

All payloads are bounded and use stable error codes (`invalid_request`,
`invalid_state`, `conflict`, `not_found`, `storage_error`, `export_error`, and
`resource_limit`). Generated TypeScript contracts are the only renderer-facing
types.

## 6. Desktop Surface

Add a focused Task Packages area to Project Insights. It has assignment export,
package preview/import, return export, paged conflict rows with disposition
labels, selection, and merge confirmation. Main owns native open/save dialogs;
preload uses the existing typed invoke bridge and path selectors. The UI keeps
dialog focus until awaited Engine results settle, renders authoritative counts
and revisions, and reloads the project after import/apply. No ZIP/JSON parsing,
hashing, or conflict ranking lives in React.

## 7. Compatibility, Security, And Rollback

- Migration 13 is append-only and proves fresh, v12 upgrade, reopen, strict
  constraints, and rollback on a late statement failure.
- Existing project archive, interop preview, alignment/corpus, editor, and TM/TB
  methods remain unchanged; task package methods are additive.
- Credentials, provider profiles, API payloads, unrelated mounted assets, and
  full document text are excluded from manifests/logs. Instruction and segment
  text is bounded by package limits and only returned to the UI where required
  for a review row.
- Failed parse, staging, preview, import, export, or merge removes only its
  own temporary files and leaves authoritative state untouched. Existing
  destinations are never replaced.
