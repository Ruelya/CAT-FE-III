# Complete Project Lifecycle Acceptance

## Goal

Finish the user-facing and process-level acceptance work that was missing when
`07-19-project-lifecycle-analytics` was archived. Preserve its full A-01..A-08
and K-01..K-05 scope: a user must be able to discover, create, reopen, search,
analyze, re-import, archive, recycle, restore, and manage a multi-file project
through the desktop, with the Engine remaining authoritative.

## Background And Audit Findings

- Commit `775b706` added lifecycle-core, migration 10, storage, protocol, and
  Engine services, plus only the three-step setup wizard.
- The desktop has no project home. Without a valid local session, `App.tsx`
  renders setup directly, so existing projects cannot be discovered or opened.
- No renderer consumer exists for template CRUD, global search, re-import,
  archive export/restore, recycle administration, analysis runs, or project
  analytics.
- `scripts/engine-smoke.mjs` and Electron E2E do not exercise the new lifecycle
  RPC surface. The archived PRD and implementation checklist are entirely
  unchecked, and the session journal explicitly recorded these missing items.
- Backend unit tests exist for most core operations, so this task extends and
  validates those contracts rather than replacing them.

## Requirements

### R1. Project Home And Navigation

- Make a project home the first usable screen when no workspace is active.
  List recent active projects with deterministic document/progress summaries,
  loading/error/empty states, and actions to open or create a project.
- Let users return to project home from the workbench only after pending edits
  have followed the existing flush path. Opening a search result or document
  stores the authoritative project/document selection and can focus a segment.
- Keep the three-step wizard, batch diagnostics, folder/file drag-drop, and
  template selection. If no file imports, rollback the newly created empty
  project without exposing a partially usable workspace.

### R2. Lifecycle Operations

- Add files/folders to an existing project with mixed diagnostics and allow the
  user to open any imported document.
- Provide project archive export and restore using trusted main-process dialogs,
  explicit no-clobber errors, dependency diagnostics, and refreshed project
  lists after restore.
- Provide project/document recycle, restore, and explicit purge with actor and
  reason. Destructive actions require accessible confirmation and never use a
  browser-native confirmation dialog.
- Show bounded project/document operation history already owned by the Engine.

### R3. Templates And Re-Import

- Provide template list/create/update/delete, revision visibility, safe
  configuration fields, and dependency diagnostics. Credentials and source
  content must never be requested or rendered.
- For the active document, select a replacement source, preview authoritative
  reconciliation counts/items, warn about ambiguous/removed work, and apply
  only with the preview's expected document revision. Refresh the workspace
  from Engine results after apply.

### R4. Global Search And Analytics

- Search source, target, project/document names, comments, and notes with the
  Engine's filters and bounded paging. Results show bounded snippets and direct
  project/document/segment navigation; normal search excludes recycled data.
- Run and display Engine-owned analysis snapshots including word/character/CJK,
  repetition, match-band, and weighted-effort data with explicit stale state.
- Display operational project analytics for file/project progress, QA blockers,
  workflow state, productivity, AI contribution, asset health, and trends.
  Unavailable history is visibly unavailable, not shown as zero.
- No renderer code estimates domain counts, weights, retention, productivity,
  or archive validity, and no billing/rate/currency copy is introduced.

### R5. Acceptance Evidence

- Extend the real stdio smoke through template creation/use, multi-file batch
  import, both search directions, re-import preview/apply, analysis, recycle/
  restore, archive export/restore, and process restart.
- Extend real-Engine Electron E2E through project home, wizard/batch import,
  template CRUD, search/direct navigation, re-import, recycle/restore, archive/
  restore, and analytics. Assert no console/page errors and no horizontal
  overflow at 1250x744, 1680x942, and 1920x1080.
- Run Node 22 gates locally where possible and Rust fmt, strict clippy, workspace
  tests, contracts, smoke, and Windows GNU build on `ssh moehub` using the
  synchronized clean checkout.

## Acceptance Criteria

- [x] AC1: Starting without a session shows project home; a user can page/open
      existing multi-file projects, create a new one, switch documents, and
      return home without losing pending edits.
- [x] AC2: The wizard and existing-project add flow preserve relative paths,
      show every mixed diagnostic, support drag/drop, and leave no empty active
      project when all imports fail.
- [x] AC3: Template CRUD/revisions and create-from-template are usable from the
      desktop, report missing/remapped dependencies, and expose no credential
      or private-source fields.
- [x] AC4: Re-import preview/apply shows unchanged/changed/new/removed/ambiguous
      counts, rejects stale apply, preserves unchanged work, and refreshes the
      active editor after success.
- [x] AC5: Archive export is no-clobber; valid restore creates a new identity;
      corrupt restore changes nothing; recycle/restore/purge/history actions are
      explicit, reasoned, restart-safe, and reflected in normal project/search
      lists.
- [x] AC6: Global search supports filters/paging and direct segment navigation;
      analysis and analytics render authoritative stale/unavailable states and
      contain no billing semantics.
- [x] AC7: Real stdio smoke covers every lifecycle RPC family across restart,
      and existing legacy/filter/editor/AI/QA flows remain green.
- [x] AC8: Real-Engine Electron E2E covers the complete desktop workflow at all
      three viewports with accessibility labels, no overflow, and no console or
      page errors.
- [x] AC9: Full format/lint/typecheck/unit/build/contracts/Rust workspace/
      Windows GNU/smoke/Electron gates pass with exact local and VPS evidence.
- [x] AC10: The archived lifecycle PRD and implementation record are amended
      with verified completion evidence or an explicit cross-reference to this
      corrective task; no unchecked record is represented as completed.

## Out Of Scope

Do not add multiple target locales, offline review packages, alignment,
semantic curation, plugin/API/collaboration behavior, billing, or release
packaging. Those remain owned by later children of the full-product parent.
