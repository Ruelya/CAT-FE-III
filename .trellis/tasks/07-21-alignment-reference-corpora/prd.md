# Alignment And Reference Corpora

## Goal

Turn existing project documents and historical files into trustworthy bilingual
assets. A translator must be able to align two documents, correct the proposed
links, explicitly confirm selected pairs into a writable TM, and mount
monolingual or bilingual reference corpora that immediately participate in
concordance and AI grounding with visible provenance.

## Confirmed Baseline

- Project documents already have stable IDs, ordered normalized segments,
  source hashes, segment revisions, protected-tag projections, immutable
  managed source files, and additive document versions.
- TM libraries support project mounts, writable/reference modes, revisioned
  provenance-bearing units, deterministic matching, concordance, import/export,
  restart, and confirmation sinking.
- AI grounding is Engine-owned and already builds bounded terminology, TM,
  context, style, and active-segment sections from generated contracts.
- Project Insights supplies trusted desktop dialogs, authoritative Engine RPCs,
  accessible tabs, typed errors, and real-Engine E2E coverage.
- There is no alignment domain, alignment session persistence, reference-corpus
  model, corpus search projection, or corpus grounding source today.

## Requirements

### R1. Deterministic Alignment Sessions

- Create an alignment session from two active documents in the same project,
  binding the project plus both document and segment revisions before scoring.
- Produce stable ordered candidates with explicit source/target segment ID
  groups, source/target text snapshots, confidence, origin, and human-readable
  evidence. The offline baseline must score length, number, punctuation, tag,
  and lexical anchors and support `1:1`, `1:N`, `N:1`, and unaligned moves.
- Candidate generation must be deterministic for identical inputs, bounded for
  large documents, pageable, restart-safe, and independent of renderer order.
- A changed/reimported/recycled document or changed source segment must produce
  a typed stale conflict rather than silently regenerating or applying links.

### R2. Manual And AI-Assisted Correction

- Users can link, unlink, merge, split, confirm, reject, and mark source or
  target groups unaligned through expected-session/link revisions.
- Each edit validates document membership, order, uniqueness, contiguous group
  bounds, and one-owner-per-segment invariants in Rust. Failed edits change no
  link and do not advance the session revision.
- A bounded optional AI-refinement request may send selected low-confidence
  candidates through an existing configured provider. The response is strict,
  ID-only structured data; invalid, unknown, duplicate, or crossing suggestions
  are rejected. AI suggestions remain proposed and never auto-confirm or write
  TM units.
- Offline deterministic alignment remains fully usable when no AI provider or
  credential is configured.

### R3. Explicit TM Apply

- Apply only explicitly selected, confirmed, non-empty bilingual links to a
  selected writable TM whose locales match the project.
- Revalidate session, document, segment, link, and TM-library revisions inside
  one immediate transaction. Insert deduplicated units with alignment session,
  link, source/target document, segment-group, confidence, actor, and reason
  provenance; then mark the session terminal in the same transaction.
- A stale, read-only, locale-mismatched, malformed, duplicate-selection, or
  partially invalid request writes no TM row, revision, history operation, or
  terminal session result. A successful retry is idempotent after restart.

### R4. Project Reference Corpora

- Import a bounded monolingual source, monolingual target, or bilingual file
  through the Engine filter registry into a project-owned reference corpus.
  Bilingual import accepts only units with an authoritative target; paired
  documents become bilingual corpora through confirmed alignment links.
- Preserve an immutable managed input copy and record format/filter, digest,
  locale, document/session provenance, structural path, ordinal, and diagnostic
  counts. Corpus rows are independent of active project documents and shared TM.
- List, page, search, reindex, and remove a corpus through expected revisions.
  Reindex is deterministic and rebuildable from stored entries; remove excludes
  the corpus immediately without mutating original documents, TM units, or
  unrelated managed files.
- Enforce bounded file/entry/text counts and reject unsupported, empty,
  locale-mismatched, or unsafe filter input without a partial corpus or index.

### R5. Retrieval And Grounding

- Corpus search supports source, target, and both-side queries with stable
  ranking and paging across enabled project corpora. Results include corpus,
  file/document, structural-path, row/link, locale, and matched-side provenance.
- Existing concordance remains compatible while returning corpus results in an
  additive authoritative projection; the renderer does not merge or re-rank
  independently fetched assets.
- AI grounding includes a bounded corpus section when enabled, with visible
  corpus/document provenance in both the prompt bundle and desktop inspector.
  Monolingual target rows may ground style/expression without pretending to be
  bilingual TM matches.
- Corpus input is always delimited as untrusted data and never becomes a system
  instruction. Errors and logs expose bounded IDs/counts, not full corpus text.

### R6. Desktop Workflow

- Project Insights exposes an Alignment/Corpora surface with document selectors,
  session list/create, confidence/evidence, paging, link selection, correction
  commands, AI-refine controls, writable TM selection, and explicit apply.
- The corpus surface supports trusted file selection/drop, kind/locale/name,
  import progress, list, reindex, remove confirmation, search, and provenance.
- Controls remain keyboard accessible and horizontally contained at 1250x744,
  1680x942, and 1920x1080. Busy, error, empty, open, stale, and terminal states
  are coherent; renderer code never parses files, scores links, indexes text,
  invokes providers directly, or writes TM/corpus state.

### R7. Compatibility And Operations

- Additive protocol and migration changes preserve existing documents, TM/TB,
  interop, editor, concordance, AI, lifecycle, archive, and generated-contract
  behavior.
- Alignment/corpus operations are auditable with actor, reason, correlation,
  base/result revisions, and bounded before/after projections.
- The stdio smoke and real-Engine Electron suite cover restart, stale, cancel,
  malformed, rollback, idempotence, accessibility, console/page errors, and
  supported viewport overflow.

## Acceptance Criteria

- [ ] AC1: Deterministic fixtures produce stable `1:1`, `1:N`, `N:1`, and
      unaligned candidates with bounded confidence/evidence; number/tag anchors
      improve the intended pairing and large input stays within configured work.
- [ ] AC2: Manual link/unlink/merge/split/confirm/reject operations persist
      across restart, preserve one-owner/order invariants, and reject stale or
      malformed edits without advancing any revision.
- [ ] AC3: Optional provider-backed refinement accepts only strict ID-based
      suggestions, records AI provenance, never auto-confirms, and leaves the
      deterministic offline workflow usable when AI is unavailable.
- [ ] AC4: Selected confirmed links sink atomically and idempotently into a
      locale-matching writable TM with complete provenance; stale documents,
      segments, links, or libraries and malformed rows prove zero-write rollback.
- [ ] AC5: Monolingual and bilingual corpus fixtures import through registered
      filters, retain managed-source/provenance metadata, restart, reindex to the
      same projection, and remove without changing source documents or TM rows.
- [ ] AC6: Corpus search and additive concordance return stable paged results
      with matched-side/file/path provenance, and AI grounding contains a
      bounded visible corpus section for the active segment.
- [ ] AC7: Real stdio and Electron workflows create/correct/apply alignment,
      import/search/reindex/remove corpora, exercise cancel/error/stale paths,
      and show no accessibility, console, page, overlap, or overflow failures.
- [ ] AC8: Rust format/workspace tests/strict Clippy, contract drift, Node 22
      format/lint/typecheck/unit/build, stdio smoke, Electron E2E, release, and
      Windows GNU release gates pass with exact evidence recorded.

## Out Of Scope

- OCR, speech/subtitle timecode alignment, cross-project corpus sharing,
  background distributed indexing, automatic destructive corpus cleanup,
  autonomous TM writes from model output, and training or hosting an embedding
  model. The later asset-curation task owns corpus-wide quality scoring,
  deduplication, language identification, and terminology mining.
