# M0 Vertical Slice

## Goal

Deliver the first real, local-first CAT workflow on the already-approved
Translunar product direction: create a project, import a DOCX, persist its
segments, edit and confirm one translation, sink the confirmed pair into a
translation memory, detect a number mismatch, and export a valid translated
DOCX. The workflow must run through the Electron/TypeScript shell and the Rust
headless engine boundary selected in `docs/design-notes.md`.

## Background

- The repository currently contains product/design documents and prototypes,
  but no application implementation.
- The approved platform is Windows 10+ and macOS 12+; Linux is not a product
  target.
- The approved stack is Electron + TypeScript for the UI shell and a Rust
  headless engine for all domain logic and persistence.
- SQLite in WAL mode is the authoritative store. The GUI must never open the
  database directly.
- The current OpenDesign prototype proves the editing, QA, export, project
  setup, and asset-management interactions. This task makes one representative
  path real rather than reproducing every prototype state.

## Requirements

### R1. Workspace and process boundary

- Establish a pnpm workspace for the Electron application and a Cargo workspace
  for the Rust engine.
- Electron main owns the engine child-process lifecycle. The renderer accesses
  the engine only through a typed preload API; Node integration is disabled in
  the renderer.
- Engine communication uses versioned JSON-RPC 2.0 messages over stdio, with a
  startup handshake and typed errors.

### R2. Local data ownership and recovery

- The engine owns a configurable data directory containing one SQLite database,
  managed source documents, and exports.
- SQLite enables foreign keys, WAL, normal synchronous mode, and a busy timeout.
- Schema migrations run atomically and are versioned.
- Target edits are persisted at segment granularity. Reopening the engine must
  recover the latest draft and all confirmed translations.

### R3. Project and document model

- A project stores name, source/target locale, and domain.
- A managed document stores the original source copy, source digest, format,
  and import metadata.
- A segment stores stable content/context identity, structural location,
  ordinal, source, target, state, and optimistic revision.
- Segment states for this slice are `untranslated`, `draft`, and `confirmed`.

### R4. DOCX import through a filter boundary

- Define reusable filter/pipeline contracts before the DOCX implementation.
- Import a real DOCX by reading OOXML package data, extracting translatable body
  paragraphs in document order, and persisting them as segments.
- Tables represented as Word paragraphs participate naturally in document order.
- Empty, non-text, field-code-only, or unsupported package content is skipped
  conservatively and never silently corrupts the source package.

### R5. Editing and confirmation

- The renderer can list imported segments, edit a target, and receive the saved
  revision/state from the engine.
- Updates use expected revisions; stale writes return a conflict instead of
  overwriting newer content.
- Confirming an empty target is rejected.
- Confirmation and its asset/QA side effects are transactional.

### R6. Translation-memory sinking and lookup

- The first project receives a writable translation memory.
- Confirming a segment upserts one provenance-bearing TM entry.
- An exact-source lookup returns the confirmed target and origin metadata.
- Reconfirming the same segment does not create duplicate TM entries.

### R7. Mechanical number QA

- A deterministic QA rule compares normalized numeric tokens in source and
  target text.
- A mismatch produces a persisted issue with rule id, severity, evidence, and
  lifecycle status.
- Correcting the target and rerunning QA resolves the existing issue rather than
  creating an unrelated duplicate.

### R8. DOCX export

- Export copies the original OOXML package and modifies translated body
  paragraphs at their stored structural locations.
- Paragraph properties and package parts not owned by the translation remain
  intact. For the first slice, translated text uses the first writable run and
  clears subsequent text runs in that paragraph.
- Export writes to a temporary file, validates the resulting ZIP/package, and
  atomically publishes the requested output path.
- Untranslated paragraphs retain their original source text.

### R9. Functional Electron workbench

- Provide a focused implementation of the approved Translunar shell for this
  workflow: project creation/import, segment grid, editable target, save state,
  confirm-and-advance, issue evidence, exact TM result, and export action.
- Preserve Chinese IME safety: composition must not trigger confirmation or
  focus movement.
- UI status and counts come from engine responses, not duplicated TypeScript
  business rules.

### R10. Engineering quality

- Rust domain/storage/filter behavior has unit and integration coverage.
- Protocol types are generated or checked from one authoritative schema and
  consumed by TypeScript without handwritten drift.
- The repository includes deterministic fixture generation, developer commands,
  and architecture/run documentation.
- No network service, account, or cloud AI is required for the slice.

## Acceptance Criteria

- [x] AC1: One command installs/builds the workspaces and documented commands
      start the Electron app and Rust engine on Windows.
- [x] AC2: Creating a project and importing the DOCX fixture persists a managed
      source copy and the expected ordered segment set.
- [x] AC3: Entering Chinese target text shows a saved revision; after restarting
      the engine, the draft remains present.
- [x] AC4: `Ctrl/Cmd+Enter` outside IME composition confirms the active segment
      and focuses the next visible segment only after the engine succeeds.
- [x] AC5: Confirmation produces exactly one TM entry with project/document/
      segment provenance, and exact lookup returns it.
- [x] AC6: Source `The retention period is 30 days.` with target
      `保留期为 60 天。` produces one number-mismatch issue containing `30` and `60`.
- [x] AC7: Changing that target to `保留期为 30 天。` and rerunning QA resolves
      the issue.
- [x] AC8: Export produces a DOCX that opens as a valid ZIP/OOXML package,
      contains the confirmed translation, and retains an untranslated paragraph and
      at least one non-document package part byte-for-byte.
- [x] AC9: A stale segment revision is rejected with a typed conflict and does
      not change persisted content.
- [x] AC10: Automated Rust tests, TypeScript type-check/tests, lint, protocol
      contract checks, and an end-to-end smoke test all pass.
- [x] AC11: Browser/Electron interaction testing finds no console errors and
      verifies editable target, IME guard, save, confirmation, QA, TM, and export.

## Out of Scope

- Full M0 format coverage beyond DOCX, full SRX sentence segmentation, PDF/OCR,
  layout-perfect handling of complex Word fields, headers/footers, tracked
  changes, drawings, or bidirectional run-level styling.
- Fuzzy/Tantivy TM search, termbase management, cloud/model connectors, AI chat,
  asset curation, collaboration, external plugin SDK, and public network API.
- Installer/notarization, automatic updates, and macOS execution in this first
  Windows development slice; architecture and CI must remain compatible with the
  approved macOS target.
