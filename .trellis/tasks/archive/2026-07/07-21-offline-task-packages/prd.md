# Offline Task Packages

## Goal

Provide a local-first handoff workflow for a bounded selection of project
documents. An owner can export an assignment package containing the immutable
source/skeleton, current target and review state, explicit TM/TB slices, and
instructions. A recipient can import it into the same CAT application as a
detached task project, work without the owner's workspace or credentials, and
export a return package. The owner can validate, preview, and atomically merge
safe changes while retaining local edits and a durable audit trail.

## Confirmed Facts And Boundaries

- The parent interoperability task already delivers stable document/segment
  identities, source hashes, tags, revisions, comments, workflow state, TM/TB
  provenance, managed immutable sources, and no-clobber publication helpers.
- Project archives already provide bounded canonical manifests, SHA-256 entry
  validation, safe ZIP path checks, and staged source restoration. Task packages
  must reuse those safety rules but must not reuse project-archive identity or
  restore semantics.
- SQLite is authoritative. Package files are transport artifacts and never a
  second live workspace database. All preview/apply writes are Engine-owned,
  expected-revision protected, and transactional.
- This child implements offline handoff only. Network collaboration, locks,
  presence, roles, assignments, notifications, and shared-library sync remain
  out of scope for the collaboration child.

## Requirements

### R1. Assignment export

- Export selected active documents and, optionally, bounded segment ranges.
- Include immutable source/skeleton bytes, stable document and segment IDs,
  source hashes, current targets/tags/comments/workflow state, document and
  segment revisions, project locales, and a human-readable instruction string.
- Include only explicitly selected TM/TB slices, with provenance and library
  identity; never include credentials, provider settings, unrelated mounted
  assets, or full shared libraries.
- Write a versioned `.tltask` ZIP through staging and no-clobber publication.
  The manifest and every payload entry have canonical metadata and SHA-256
  hashes. Unsafe paths, duplicate entries, encryption, excessive compression,
  sizes, depth, or counts fail before any state changes.
- Export records the package identity, base project revision, actor, reason,
  and selected document/asset IDs in project history without document text.

### R2. Detached task import and return

- Preview an assignment package before importing it. Validate format/version,
  hashes, project identity, dependency declarations, source/skeleton presence,
  and all bounded segment/tag identities.
- Import a valid assignment as a normal local task project with new local
  project/document identities plus an immutable origin binding for every
  source document and segment. Import is atomic and restart-safe; a malformed
  row or missing source creates no partial project.
- Preserve the origin IDs, base revisions/hashes, package ID, instructions,
  and selected asset-slice provenance in the local task project's metadata so
  a later return package can address the original project deterministically.
- Export a return package from an imported task project. It contains only the
  bound selected rows and changed target/tag/workflow/comment projections,
  their base hashes/revisions, and bounded package provenance. It never carries
  local credentials or unrelated task-project assets.

### R3. Three-way preview

- Validate a return package against the expected origin project and base
  package identity before reading it into a durable preview.
- Compare base, current-local, and returned-remote projections and classify
  every selected row as `unchanged`, `remoteChanged`, `localChanged`,
  `bothChanged`, `deleted`, `added`, `tagInvalid`, or `missingDependency`.
  Identical local/remote edits remain visible as `bothChanged` with a
  non-conflicting reason; divergent edits are conflicts.
- Preview includes deterministic counts, bounded diagnostics, package/row
  hashes, current revisions, and the exact selectable row IDs. It is pageable,
  survives restart, and performs no target, comment, workflow, TM, or history
  write.
- Stale project/package revisions, duplicate identities, unknown origin IDs,
  invalid tags, missing selected documents, and dependency mismatches produce
  typed errors or row classifications without leaking full source text.

### R4. Transactional merge

- Apply only explicitly selected non-conflicting rows (`remoteChanged` and
  identical `bothChanged`) with the expected project/document/segment
  revisions captured by the preview. Reject selected conflict/invalid rows.
- Apply all selected changes in one SQLite Immediate transaction. Update
  targets/tags/workflow/comments through existing domain rules, preserve local
  history, sink confirmed results only through existing confirmation/TM
  semantics, and record package ID, row IDs, actor, reason, base/result
  revisions, and counts as one auditable operation.
- A failed validation or write changes no target, revision, TM/TB row,
  operation, or package status. The open preview and staged package remain
  retryable after the user changes the selection or resolves conflicts.
- Successful apply is idempotent: retrying the same preview/selection after a
  restart returns the recorded result and cannot duplicate comments, TM units,
  or history operations. Existing package files are never overwritten.

### R5. Desktop workflow

- Project Insights exposes task-package export, assignment preview/import,
  return export, conflict preview, row selection, and merge confirmation with
  trusted native file dialogs and accessible typed errors.
- The UI renders Engine classifications and provenance; it never parses ZIP or
  JSON, computes hashes/conflicts, edits SQLite, or re-ranks rows locally.
- Busy, empty, invalid, stale, conflict, applied, and retryable states remain
  keyboard accessible and contained at 1250x744, 1680x942, and 1920x1080.

### R6. Compatibility and limits

- Existing protocol methods, migrations 1-12, project archives, interop
  previews, editor/review/TM/TB workflows, and generated TypeScript contracts
  remain wire-compatible.
- Default package limits are explicit and enforced: at most 50 documents,
  100,000 segments, 100 MB per payload entry, 500 MB total uncompressed
  payload, 64 MB manifest, 10,000 TM/TB slice rows, and 1,000 comments per
  package. Limits are checked before publication or persistence.
- All paths are workspace-relative slash-separated paths. Logs and errors
  expose IDs, counts, and hashes only; secrets and unbounded document text are
  never serialized or logged.

## Acceptance Criteria

- [x] AC1: Assignment export produces a valid no-clobber `.tltask` with
      canonical manifest, per-entry hashes, selected source/skeleton data,
      target/tag/review state, instructions, and explicit TM/TB slices while
      excluding credentials and unrelated assets.
- [x] AC2: Valid assignment preview/import creates one restart-safe detached
      task project with origin bindings; malformed, tampered, unsafe, oversized,
      duplicate, or incomplete packages leave no project or managed-source
      residue.
- [x] AC3: A completed detached task exports a return package that contains
      only bound selected changes and base identity/revision/hash data and can
      be reopened after process restart.
- [x] AC4: Return preview validates package/base/project identity and produces
      deterministic pageable classifications for unchanged, local-only,
      remote-only, identical-both, divergent-both, deleted, added,
      tag-invalid, and missing-dependency cases without writes.
- [x] AC5: Merge applies selected safe rows atomically, preserves unselected
      local edits, records package/actor/reason provenance and history, sinks
      confirmed changes through existing TM rules, and rolls back completely on
      stale/conflict/invalid/failure paths.
- [x] AC6: Repeating a successful merge after restart is idempotent; existing
      destinations are never clobbered; staged files remain retryable until an
      explicit discard/expiry operation.
- [x] AC7: Real stdio and real-Engine Electron tests cover export, preview,
      detached import, return export, every conflict class, selection/apply,
      stale/tamper/no-clobber/rollback/restart paths, accessibility, console or
      page errors, and horizontal overflow at all supported viewports.
- [x] AC8: Local Node 22 and isolated VPS gates pass formatting, lint,
      typecheck, unit/workspace tests, generated-contract drift, stdio smoke,
      desktop production/Electron checks, Linux release, and Windows GNU
      release builds.

Acceptance evidence, exact commands, environment caveats, release hashes, and
the six final viewport screenshots are recorded in `implement.md`. In
particular, Node 22 lint/typecheck/unit/build/focused Electron passed locally;
the generated-contract and Rust checks passed on the isolated Node 22 VPS
because the local Windows shell lacks a usable MSVC linker.

## Out Of Scope

- Network synchronization, simultaneous editing, segment locks, presence,
  roles, task assignment/notifications, server storage, or shared-library
  replication.
- Proprietary encrypted package formats, arbitrary external scripts/macros,
  customer delivery portals, billing, compliance/audit marketing, and pixel-
  identical vendor UI regeneration.
