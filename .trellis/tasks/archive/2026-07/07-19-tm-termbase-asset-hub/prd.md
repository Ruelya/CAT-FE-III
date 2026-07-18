# TM And Termbase Asset Hub

## Goal

Deliver the P0 translation-memory and termbase foundation that turns every
confirmed translation into reusable, searchable project asset while preserving
the schema-v1/v2 TM methods. A user must be able to mount multiple local TM
libraries, search exact/context/fuzzy matches (including CJK), exchange TMX/CSV
data, maintain a multilingual termbase, recognize terms, enforce forbidden
terms, run concordance searches, and export/import open formats.

## Source Requirements

This child implements PRD D-01/D-02/D-03/D-05/D-07, E-01/E-02/E-03/E-04/E-05,
J-01, and AC-02. Existing `tm.lookupExact` and confirmation behavior remain
compatible. Confirmed segments sink atomically into every enabled writable TM
mount and retain project/document/segment provenance and context metadata.

## Requirements

### R1. Libraries And Mounts

- Add durable TM library records with name, language pair, domain, writable
  flag, timestamps, and stable IDs.
- A project can mount many libraries in deterministic priority order as
  `write` or `reference`; writes go only to enabled writable mounts.
- Existing project-created TM data is migrated into a default library/mount;
  no legacy entry or provenance is discarded.

### R2. Matching And Concordance

- Search APIs support exact (100%), context (101%), and fuzzy results with a
  caller threshold and bounded result count.
- Matching normalizes Unicode/whitespace, handles CJK character-plus-token
  similarity, and returns deterministic scores, library/source metadata, and
  numeric/date/placeholder substitutions.
- Domain, project/source, language pair, library, and time metadata filters are
  supported. Results are ordered by score, library priority, recency, and ID.
- Concordance searches source or target text across mounted libraries with
  bounded paging and no document-body loading.

### R3. Exchange

- Import and export TMX 1.4b and UTF-8 CSV with explicit source/target locale
  mapping, metadata preservation where the format permits it, duplicate
  handling, row-level diagnostics, and atomic output publication.
- Malformed rows/documents fail with typed errors and never partially commit.
- A deterministic bilingual table import path covers J-01; it accepts CSV/TSV
  and the same normalized unit model used by TMX.

### R4. Termbase

- Add termbase, entry, and one-to-many target-translation records with source
  term, target term(s), part of speech, definition, example, domain, status,
  preferred flag, and forbidden flag.
- Projects mount multiple termbases with priority and writable state.
- Term search recognizes Latin word forms case-insensitively and CJK substrings
  in source/target text, returning preferred/forbidden state and translations.
- Add/upsert operations support one-click source/target insertion semantics;
  TBX-Basic and CSV import/export are round-trippable.
- Forbidden-term hits are surfaced by the authoritative Rust QA path.

### R5. Automatic Sinking And Compatibility

- `segment.confirm` writes legacy TM provenance and new asset-library units in
  the same immediate transaction. A retry is idempotent per library and source
  segment.
- Existing protocol-v1 methods, generated casing, error codes, and renderer
  behavior remain valid. New methods are additive and page limits are bounded.

## Acceptance Criteria

- [x] A migrated workspace has a default writable TM library; old exact lookup,
      entries, and confirmation export results are unchanged.
- [x] A project mounts two reference libraries and one writable library; exact
      and 101% context searches return deterministic source/priority metadata,
      while a read-only mount rejects sinking without changing any row.
- [x] CJK fuzzy matching ranks a near match above an unrelated sentence at a
      configurable threshold and exposes number/date/placeholder substitutions.
- [x] TMX 1.4b and CSV/TSV import/export round-trip locales, metadata,
      duplicates, and malformed-row diagnostics without partial commits.
- [x] A termbase with multiple target terms round-trips through TBX-Basic and
      CSV; source recognition returns preferred and forbidden flags for Latin
      and CJK samples.
- [x] Confirming a segment appends exactly one idempotent unit to every writable
      mount, including origin project/document/segment and neighboring context;
      restarting preserves the units and history.
- [x] A forbidden target term produces a typed `term-forbidden` QA issue while
      a clean target does not; no source/target text leaks into unrelated error
      responses.
- [x] Concordance searches both directions with bounded deterministic paging.
- [x] Protocol schema/TypeScript generation, all Rust tests, expanded engine
      smoke, existing renderer tests, and Electron E2E remain green.
- [x] Strict fmt/clippy/lint/typecheck pass and no renderer code opens SQLite or
      reimplements matching/asset rules.

## Out Of Scope

- AI/embedding semantic cleaning, quality scores, duplicate curation,
  terminology mining, drift reports, preview/rollback maintenance jobs, and
  scheduled background curation (AC-01/AC-03..AC-11; later asset-curation task).
- Fuzzy subsegment leverage, alignment UI, single-language corpora, and
  provider-specific TM formats beyond TMX/CSV/TBX.
- Multi-user conflict resolution, server-side asset sharing, and API/CLI
  endpoints beyond the engine protocol primitives in this child.

## Constraints

- SQLite remains durable truth; migrations are append-only and all compound
  writes use immediate transactions and foreign keys.
- `crates/protocol` is the wire source; generated JSON Schema/TypeScript are
  committed together.
- Matching is deterministic and bounded; no network calls or model inference.
- Open-format parsers must preserve protected text as data, not execute XML or
  CSV content.
