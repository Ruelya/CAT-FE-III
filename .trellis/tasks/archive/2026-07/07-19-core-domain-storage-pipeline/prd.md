# Core domain, storage, and pipeline v2

## Goal

Create the durable, format-neutral Rust foundation on which every remaining
PRD child can build without replacing the working DOCX MVP. The engine must
support multi-document projects, versioned source data, inline structure,
operation history, registered filters, persistent pipeline runs, and
recoverable local storage while retaining protocol-v1 compatibility.

## Background

The current product is a real but narrow schema-v1 DOCX vertical slice. It has
one project-owned TM, one document import method, plain-text segments, exact
matching, number QA, and eleven JSON-RPC methods. It already proves the
Electron -> protocol -> Rust -> SQLite boundary and must remain usable through
this expansion.

This child provides the backend foundations for PRD architecture section 4.1,
A-01/A-02/A-05/A-08, M-01/M-05, N-07, and the reliability/capacity/
extensibility NFRs. Later children own the complete user-facing lifecycle,
formats, editor undo/redo, assets, AI, API, plugins, and collaboration.

## Requirements

### R1. Additive Domain Model

- Extend `Project` with revision, lifecycle, and typed configuration metadata.
- Extend `Document` with stable logical identity, relative path, filter ID,
  current version, status, revision, update time, and degradation summary.
- Add document-version records that preserve every imported source revision and
  its managed immutable file.
- Add format-neutral inline tags with stable IDs, source/target side, Unicode
  scalar position, kind, pairing, protected payload, and display text.
- Add operation, data-health, filter descriptor, pipeline definition/step/run,
  checkpoint, and run-status domain types with stable serialization.

### R2. Schema-v1 Compatibility And Crash Safety

- Append migrations; never edit migration 1.
- Upgrade a real schema-v1 database in place, backfill project/document/version
  metadata, retain every target/state/revision/TM/QA row, and keep the original
  DOCX exportable.
- Before applying pending migrations, create a consistent automatic SQLite
  backup in the managed backup directory. A failed migration leaves the
  original database usable and `user_version` unchanged.
- All new writes use immediate transactions, foreign keys, optimistic
  revisions where mutable, deterministic ordering, and checked conversions.
- Restart recovers committed drafts, operation history, and pipeline run state.

### R3. Project And Document Service Foundations

- Add paged project listing, project metadata update, and lifecycle transition
  operations. Archive/trash are reversible states; this child does not hard
  delete user data.
- Add paged document listing and document lookup with current-version metadata.
- Add generic `document.import`/`document.export` operations that resolve a
  registered filter by probe or explicit ID. Existing
  `document.importDocx`/`document.exportDocx` methods remain and delegate to the
  generic path.
- Preserve relative paths so multiple files with the same base name can coexist
  in one project. Duplicate imports create independent logical documents unless
  a later re-import operation explicitly targets an existing document.
- Record authoritative project/document counts and progress per file.

### R4. Filter Core

- Move filter contracts out of the domain crate into a dedicated format-core
  crate while retaining domain-only imported content types.
- A filter exposes an ID/version/format descriptor, probe result, capabilities,
  streaming import events, export, and validation/degradation results.
- The event validator accepts metadata, units, text, inline tags, notes, and
  degradation findings, and rejects nested/incomplete/invalid event sequences.
- A registry rejects duplicate IDs, resolves explicit IDs, and performs
  deterministic best-probe selection. The built-in DOCX filter uses the public
  contract and registry.

### R5. Pipeline Core

- Persist versioned pipeline definitions containing ordered typed step
  references and validated JSON configuration.
- A step registry exposes descriptors, input/output artifact kinds, resumable
  and cancellable capabilities, and duplicate/unknown-step validation.
- Persist pipeline runs and per-step runs with status, revision, timestamps,
  input/output/checkpoint/error/usage JSON, and cancellation requests.
- Enforce one documented state machine. On engine restart, unfinished `running`
  steps/runs become `interrupted`; resumable work can continue from the last
  committed checkpoint, while non-resumable work fails explicitly.
- Provide protocol operations to create/list/get/validate definitions and to
  create/get/list/cancel/resume runs. Core includes deterministic built-in
  checkpoint and document-QA steps so execution is proven with real data rather
  than only a registry unit test.
- Starting a run returns its ID without holding a JSON-RPC request open for the
  duration. Status polling observes monotonic committed progress.

### R6. Operation History

- Every project metadata/lifecycle write and current segment target/confirm
  write appends one operation in the same transaction as the mutation.
- An operation has project-local monotonic sequence, entity/kind, base/result
  revision, actor/source, before/after JSON, timestamp, and optional correlation
  ID. History is paged in deterministic descending or ascending order.
- Migration does not fabricate history for pre-existing writes. The absence of
  legacy operations is explicit, not inferred as data loss.
- This child records reversible inputs; the professional editor child owns the
  user-facing undo/redo command set.

### R7. Backup And Health Primitives

- Expose a non-destructive health check covering SQLite quick/foreign-key
  checks, schema version, row-count invariants, current document-version links,
  and existence/hash of managed source files.
- Expose an explicit consistent backup primitive that writes a manifest,
  SQLite snapshot, and managed source files to a new destination without
  mutating the active data directory.
- Health findings are typed by category/severity and never include source or
  target content. No automatic repair may discard or rewrite user translation
  data in this child.

### R8. Protocol And Compatibility

- All new wire methods are additive under protocol version 1, use generated
  camelCase payloads, stable snake_case errors, and bounded page sizes.
- `engine.initialize` reports filter, pipeline, history, backup, health, and
  multi-document capabilities.
- Regenerate and commit JSON Schema/TypeScript contracts. Electron continues to
  build and the current renderer requires no domain duplication.

## Acceptance Criteria

- [ ] A schema-v1 fixture upgrades to the latest schema after an automatic
      pre-migration backup; all legacy projects/documents/segments/TM/QA values
      compare equal and the translated DOCX still exports correctly.
- [ ] A deliberately failing migration test proves transaction rollback and an
      unchanged `user_version`; a newer-than-supported database is rejected.
- [ ] One project imports two DOCX files with the same base name under different
      relative paths, lists them deterministically, edits both, restarts, and
      exports both through generic and legacy methods.
- [ ] Generic import auto-probes DOCX, explicit unknown filters return a typed
      error, duplicate filter/step registration fails, and malformed tag/event
      streams are rejected before persistence.
- [ ] Project update/lifecycle methods require expected revision, stale writes
      return structured conflicts, and archive/trash transitions are reversible.
- [ ] Segment update and confirm each append exactly one operation atomically;
      a failed stale mutation appends none. History pagination and ordering are
      deterministic across restart.
- [ ] A real pipeline definition runs checkpoint + document QA steps, returns a
      run ID immediately, persists step progress, supports cancellation, and
      resumes or explicitly fails interrupted work according to capabilities.
- [ ] Health check returns clean for a valid workspace and typed findings for a
      missing managed source, broken version link, and foreign-key violation
      without exposing document text.
- [ ] Explicit backup can be restored into a separate data directory and passes
      health check with the same authoritative counts and export result.
- [ ] A generated 100,000-segment storage fixture can open, count, page, and
      query history without loading all segment bodies into memory; measured
      evidence is recorded for the release task.
- [ ] `pnpm contracts:check`, all Rust tests, engine smoke, existing eight
      renderer tests, and all existing Electron E2E workflows pass unchanged in
      behavior.
- [ ] Strict Rust formatting/clippy and TypeScript lint/typecheck are green; no
      renderer module opens SQLite or implements filter/pipeline/domain rules.

## Out Of Scope

- Non-DOCX filters and full re-import diff matching.
- Multi-library TM/TB and fuzzy/concordance search.
- Editor split/merge/comments/undo UI and global search UI.
- Portable single-file project archives and product backup UI.
- Provider connectors, production pretranslation steps, plugins, API/CLI,
  collaboration, and packaging.
- Destructive repair or hard deletion of projects/assets.

## Constraints

- Preserve Electron + TypeScript + Rust + SQLite and protocol version 1.
- SQLite remains durable truth; indexes/caches are rebuildable projections.
- Work inline and serially; use `ssh moehub` for Rust linking/tests when the
  local Windows SDK is unavailable.
- Do not claim capacity or recovery acceptance without generated fixtures and
  restart/restore evidence.
