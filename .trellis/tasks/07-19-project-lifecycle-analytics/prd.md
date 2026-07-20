# Project Lifecycle And Analytics

## Goal

Turn the current single-document setup and basic project lifecycle flag into a
durable multi-file project workspace. Users can add files/folders, preserve
relative paths, archive and restore a complete project across machines, reuse
templates, re-import changed sources without discarding unchanged work, search
across projects, recover deleted items/history, and understand progress and
effort without introducing pricing or billing semantics.

## Scope And Decisions

This child owns PRD A-01 through A-08 and K-01 through K-05 as assigned by
parent R7. Existing filter imports, project configuration, mounted assets,
editor history, QA, TM provenance, AI usage, and workspace backup are extended
rather than duplicated.

- Rust owns archive manifests, restore validation, source reconciliation,
  search, recycle/history, word/match analysis, progress, productivity, AI
  contribution, and asset-health projections. React renders returned data.
- Projects remain one source locale and one target locale in this child;
  multiple target locales remain outside the assigned scope.
- Templates store reusable references/configuration, never credentials or
  private source content. Missing referenced assets are reported and may be
  deliberately remapped during project creation.
- Archive/restore is project-scoped and portable. General workspace backup
  remains the disaster-recovery primitive and is not renamed as project export.
- Analytics are local operational insights only. No rates, currency, quotes,
  invoices, billable units, or worker surveillance are introduced.

## Requirements

### R1. Multi-File Project Setup And Import (A-01, A-02, A-03)

- Provide a three-step project wizard for identity/locales/domain, reusable
  configuration/assets/engine, and file/folder review. Existing quick create
  remains compatible.
- Add multiple files or recursively discovered supported files to one project,
  preserve normalized relative paths, reject traversal/collisions, and return
  per-file success/failure diagnostics without silently dropping a selection.
- Desktop file/folder picking and drag/drop call generated Engine contracts;
  renderer code never reads file contents or recursively walks the filesystem.
- Project/document lists expose file-level segment/state progress and bounded
  deterministic paging for projects with many documents.

### R2. Templates (A-04)

- Create/list/get/update/delete revisioned project templates containing locales,
  domain, mounted TM/TB references/modes/priorities, selected AI/QA/pipeline
  references, review policy, and safe editor defaults.
- Built-in/default behavior remains available when a referenced resource is
  missing. Project creation from a template returns explicit missing/remapped
  reference diagnostics and never persists credentials in the template.

### R3. Source Re-Import (A-05)

- Preview and apply a new source version for an existing document using the
  same filter/options. Match stable structural identity first, then exact
  normalized source/context within deterministic bounds.
- Preserve target/tags/workflow/comments/review state for unchanged segments;
  mark changed/new segments for translation and removed segments as recoverable
  superseded rows. Never transfer a translation across an ambiguous match.
- Persist source version, source hash, reconciliation counts/mapping, actor,
  timestamp, and prior state so apply is expected-revision protected,
  restart-safe, inspectable, and undoable where safe.

### R4. Project Archive, Restore, Recycle, And Deletion (A-06, A-08)

- Export a no-clobber single-file project archive containing a versioned
  manifest, project/document managed source packages, segments/tags/comments/
  reviews/QA/history/configuration, and project-owned asset slices required for
  faithful restore. Secrets and external shared-library data are excluded and
  declared as dependencies.
- Validate hashes/schema/limits before restore and import atomically to a new
  project identity, with deterministic conflict/remap diagnostics. A corrupt or
  incompatible archive changes no workspace state.
- Archive/restore lifecycle is distinct from recycle. Soft-delete documents and
  projects into a durable recycle bin with actor/reason/deletion time, restore
  within retention, and require explicit final purge. Existing safe backup
  behavior precedes destructive workspace-wide maintenance.
- Expose bounded project/document operation history derived from durable events.

### R5. Global Search (A-07)

- Search source, target, document/project names, comments, and import notes
  across active projects with field/project/locale/status/date filters,
  deterministic paging, bounded snippets, and direct document/segment location.
- Search indexing/rebuild is Engine-owned, restart-safe, and reflects edits,
  re-import, recycle/restore, and purge without leaking deleted content into
  normal results.

### R6. Word And Weighted Effort Analysis (K-01, K-02)

- Compute Unicode words, characters, CJK characters, translatable segments,
  repetitions, internal repetitions, and authoritative TM match bands per
  document/project from a reproducible analysis snapshot.
- Compute configurable weighted effort from match bands/status using integer
  basis points or another deterministic non-currency representation. Defaults
  are documented, revisioned, and reusable in templates.
- Analysis records source/document revisions and becomes stale explicitly after
  source/configuration changes; renderer code never estimates counts locally.

### R7. Progress, Productivity, AI Contribution, Asset Health (K-03..K-05)

- Return file/project completion by workflow state, QA blockers, reviewed and
  confirmed volume, elapsed active editing time, throughput, and time-in-state
  from durable events. Idle-gap rules are deterministic and configurable.
- Measure AI contribution from durable AI proposals/applies to final targets:
  applied/retained/replaced counts and Unicode-safe edit distance/retention,
  without claiming causality for untracked text.
- Report TM confirmed-unit growth/reuse, mounted-library hit contribution,
  termbase growth, QA/curation outcomes available from current durable data,
  and trend buckets. Missing historical instrumentation is represented as
  unavailable rather than fabricated zero.

### R8. Desktop Experience

- Add a project home/dashboard with multi-file progress, recent projects,
  lifecycle/recycle actions, archive/restore, templates, global search, and
  analytics drill-down. Workbench navigation preserves pending edits.
- Add files/folders through dialogs and drag/drop with batch diagnostics;
  re-import shows a preview/counts before apply; purge/restore/override actions
  use explicit accessible dialogs.
- Provide loading/error/empty/stale states, keyboard/ARIA semantics, no
  horizontal overflow at 1250x744, 1680x942, or 1920x1080, and no billing copy.

## Acceptance Criteria

- [ ] Migration 10 fresh/upgrade/rollback/reopen tests cover templates,
      versions/re-import maps, recycle records, archive metadata, analysis
      snapshots, search index, and analytics events without breaking v1..v9.
- [ ] Multi-file and recursive folder import preserve relative paths, return
      mixed batch diagnostics, reject traversal/collisions, and survive restart.
- [ ] Template CRUD/revisions and create-from-template preserve safe references,
      report missing dependencies, and never serialize credentials.
- [ ] Re-import preview/apply fixtures prove unchanged translations/tags/history
      survive, changed/new/removed segments are explicit, ambiguous mappings do
      not transfer work, and stale previews conflict.
- [ ] Project archive validates hashes, restores an equivalent project under a
      new identity, excludes secrets, publishes no-clobber, and corrupt restore
      leaves the workspace unchanged.
- [ ] Recycle/restore/purge and operation history are reasoned, restart-safe,
      bounded, and excluded/included correctly by normal/admin queries.
- [ ] Global search updates after edits/re-import/recycle and returns bounded
      multilingual snippets plus direct locations with deterministic paging.
- [ ] Word/CJK/repetition/TM-band and weighted-effort fixtures are deterministic;
      progress/time/AI/asset trends derive from durable state and mark missing
      history unavailable.
- [ ] Stdio smoke covers a multi-file project, template, re-import, both search
      directions, analysis, recycle/restore, archive/restore, and restart.
- [ ] Electron E2E covers wizard/drag-drop or batch add, dashboard/search,
      template, re-import preview, recycle/restore, archive/restore, analytics,
      three viewports, direct navigation, and no console/page errors.
- [ ] Rust fmt/clippy/workspace tests, contracts, Node 22 format/lint/typecheck/
      unit/build, Windows GNU, stdio smoke, Electron E2E and performance gates
      remain green.

## Out Of Scope

Multi-target projects, VCS/webhook continuous localization, offline task-package
handoff, bilingual review DOCX, alignment/reference corpora, collaboration
server sync, enterprise retention/RBAC/audit, billing/rates/currency/invoicing,
and new semantic asset-curation scoring belong to later children.
