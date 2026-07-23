# Interoperability, Alignment, And Offline Review

## Goal

Deliver the full interoperability and offline-review slice from `docs/PRD.md`:
accept work from common external CAT ecosystems, return conservative native or
bilingual deliverables, align existing documents into reviewed TM assets, make
reference corpora available to retrieval and AI grounding, exchange bounded
offline task packages, and preserve discussion and restorable project history.

## Confirmed Baseline

- Generic Engine-owned `document.import` / `document.export` and the
  `DocumentFilter` registry already support XLIFF 1.2/2.1, TMX 1.4b,
  TBX-Basic, SRX, DOCX/XLSX/PPTX, text/HTML, and PDF without renderer parsing.
- The XLIFF filter preserves unknown namespaces and unowned XML, imports notes
  and targets, protects inline codes, and writes target ranges no-clobber.
- TM libraries already support provenance-bearing TMX/CSV exchange, mounting,
  deterministic retrieval, and automatic confirmation sinking.
- Segment comments, review proposals, editor history, project operation
  history, document versions, and project archives exist, but there is no
  threaded discussion, named project snapshot/restore, or offline task merge.
- No SDLXLIFF, MQXLIFF/MQXLZ, bilingual review DOCX, alignment, reference
  corpus, or offline review-package contract exists in protocol or storage.

## Requirements

### R1. External CAT Interchange (L-03..L-05)

- Import and export SDLXLIFF while preserving Trados metadata, segment IDs,
  locked state, comments, status, inline codes, and every unowned XML part.
- Import and export MQXLIFF and MQXLZ while preserving memoQ metadata, skeleton
  and auxiliary ZIP entries; export never overwrites an existing destination.
- Tolerate bounded, well-formed XLIFF dialect extensions from common CAT tools
  while rejecting unsafe XML, ambiguous duplicate identities, invalid ZIP
  paths, unsupported encryption, and resource-limit violations.
- Native round trips update only owned target/status/comment ranges. A format
  that cannot preserve a construct reports an explicit degradation finding.

### R2. Bilingual DOCX And Table Ingest (I-03, J-01, L-06)

- Export a three-column bilingual review DOCX with stable opaque segment IDs,
  source, editable target, status/comment context, and tamper-evident manifest.
- Preview and apply a returned review DOCX through expected project/document
  revisions. Show changed, unchanged, missing, added, and invalid rows before
  any target or review proposal is written.
- Import two-column DOCX/XLSX bilingual tables into a selected writable TM
  library only after a preview. Preserve row provenance and reject partial
  commits when any accepted row is malformed.
- Provide a generic bilingual DOCX filter mode for source/target table import
  and export without conflating it with the signed review-package workflow.

### R3. Alignment And Reference Corpora (J-02, J-03)

- Align two imported documents using deterministic sentence candidates,
  length/number/tag anchors, bounded many-to-one/one-to-many moves, and an
  explicit unaligned state. No pair enters TM before user confirmation.
- Provide a keyboard-accessible alignment editor for merge/split/link/unlink,
  candidate confidence/evidence, paging, and confirmed provenance-bearing TM
  sinking with expected revisions.
- Import bilingual or monolingual documents into project-mounted reference
  corpora. Corpus search participates in concordance and Engine-owned AI
  grounding with visible source/document provenance.
- Reference assets are independently removable/reindexable and never mutate
  the original managed document or writable TM library implicitly.

### R4. Offline Task Packages (I-04)

- Export a bounded no-clobber task package containing selected documents,
  immutable source/skeleton data, current targets/tags/revisions, instructions,
  and explicit TM/TB slices without credentials or unrelated shared assets.
- Validate schema, limits, entry hashes, identities, and base revisions before
  merge. Produce a complete conflict preview for local/remote/both-changed,
  deleted, added, tag-invalid, and missing-dependency cases.
- Apply only selected non-conflicting changes in one transaction, preserving
  local history and recording package/actor/reason provenance. A failed merge
  changes nothing and remains retryable after conflicts are resolved.

### R5. Discussion And Restorable Snapshots (I-07, I-09)

- Add project/document/segment discussion threads with ordered messages,
  resolved/reopened state, literal `@mention` tokens, bounded paging, actor,
  timestamps, and durable operation history. Mentions are local metadata until
  the later collaboration task adds notification delivery.
- Create named project snapshots covering project configuration, active
  documents/versions, segments/tags/comments/reviews, mounted-asset references,
  and relevant workflow state without copying credentials or shared libraries.
- Preview and restore a snapshot through expected project revision. Restore is
  an atomic, auditable forward operation and never deletes the snapshot or
  rewrites unrelated shared assets.

### R6. Product Surfaces And Boundaries

- Desktop surfaces expose native interchange, bilingual review, alignment,
  corpus, task-package, discussion, and snapshot workflows with trusted file
  dialogs, accessible in-app confirmations, typed errors, and no browser-native
  confirm dialog.
- Renderer code never parses XML/ZIP/DOCX, computes alignment scores, validates
  packages, merges revisions, writes TM/corpus rows, or fabricates history.
- Existing XLIFF/TMX/TBX/SRX, editor, QA, lifecycle, AI, and archive workflows
  remain wire-compatible and green.

## Acceptance Criteria

- [x] AC1: Representative SDLXLIFF, MQXLIFF, MQXLZ, and dialect-XLIFF fixtures
      import, edit, restart, and return to their native format with stable IDs,
      valid tags, preserved opaque metadata, typed degradation, and no-clobber.
- [x] AC2: A reviewer can export a bilingual DOCX, edit targets/comments,
      preview a diff, reject stale/tampered input, apply selected proposals, and
      observe durable review/history state after restart.
- [x] AC3: Two-column DOCX/XLSX import previews and atomically sinks accepted
      pairs into a selected writable TM with row provenance and rollback tests.
- [x] AC4: A user can align two documents, manually correct proposed links,
      confirm selected pairs into TM, mount reference corpora, and retrieve
      corpus evidence through concordance and AI grounding.
- [x] AC5: Offline task export/import/merge validates hashes and revisions,
      previews every conflict class, commits selected safe changes atomically,
      excludes secrets, and survives process restart.
- [x] AC6: Threaded discussions and named snapshots are pageable, reasoned,
      restart-safe, restorable, and visible in desktop history without implying
      network notification or multi-user synchronization.
- [x] AC7: Real stdio smoke and real-Engine Electron E2E cover all five child
      workflows, cancellation/error/no-clobber/stale paths, console/page errors,
      accessibility labels, and horizontal overflow at all supported viewports.
- [x] AC8: Local Node 22 and isolated VPS gates pass for format, lint,
      typecheck, unit/workspace tests, contracts, smoke, release build, Windows
      GNU build, and desktop production/Electron checks.

## Dependency Order

1. External CAT interchange establishes conservative native round trips.
2. Bilingual DOCX/table ingest establishes reviewed bilingual exchange rows.
3. Alignment/reference corpora reuse the bilingual model and asset provenance.
4. Offline task packages reuse stable external IDs and review-diff contracts.
5. Discussion/snapshots reuse package merge/history projections, then the
   parent runs cross-child acceptance.

## Out Of Scope

- Proprietary binary formats whose payload cannot be conservatively preserved;
  server-side notifications, simultaneous editing, locks, roles, assignments,
  and sync (owned by the collaboration child); marketplace/plugin packaging;
  billing, customer portals, delivery operations, and compliance claims.
- Pixel-identical regeneration of vendor UI files or undocumented executable
  behavior. Compatibility means bounded parsing, conservative native writeback,
  explicit degradation, and fixture-backed evidence.
