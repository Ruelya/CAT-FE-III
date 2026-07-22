# External CAT Interchange Formats

## Goal

Add conservative, Engine-owned SDLXLIFF, MQXLIFF, MQXLZ, and common dialect-
XLIFF interchange to the existing generic filter boundary. Translators must be
able to open an external CAT handoff, edit in the existing editor, and return a
valid native package without losing unowned metadata or silently changing
vendor state.

## Background And Baseline

- `filter-xliff` already handles XLIFF 1.2/2.1 with structural paths, target
  insertion, inline tags, notes, unknown namespaces, and no-clobber export.
- `filter-core` owns bounded event validation, document-scoped IDs and atomic
  publication; Engine registers filters and persists normalized segments.
- No private CAT filter ID, ZIP envelope reader, vendor-state model, or native
  fixture corpus exists today.

## Requirements

### R1. SDLXLIFF

- Register `builtin.sdlxliff` for `.sdlxliff` and compatible XLIFF XML.
- Import `sdl:seg`, `sdl:mrk`, locked/confirmed/translated state, comments,
  inline codes, segment IDs, and source/target text through stable structural
  paths. Preserve all non-owned XML and unknown namespaces.
- Export only target/status/comment ranges owned by the imported structure;
  preserve skeleton-like metadata and reject duplicate/unknown paths.

### R2. MQXLIFF And MQXLZ

- Register `builtin.mqxliff` and `builtin.mqxlz`; probe XML and bounded ZIP
  envelopes without following external relationships.
- Preserve memoQ namespace metadata, segment status, comments, inline tags,
  and opaque auxiliary entries. MQXLZ output is a valid ZIP with the original
  non-XLIFF entries copied byte-for-byte where possible.
- Reject traversal, duplicate names, encrypted entries, oversized/deep XML,
  malformed manifest/central directory, and an existing destination.

### R3. Dialect And Safety Behavior

- Accept bounded namespace/version dialect variants when the structural
  identity is unambiguous; return degradation findings for unsupported vendor
  fields rather than dropping them silently.
- Never expose source text or vendor payloads in errors/logs beyond bounded IDs
  and counts.
- Keep existing `builtin.xliff` behavior and generated contracts compatible.

## Acceptance Criteria

- [x] AC1: SDLXLIFF fixtures import through generic `document.import`, retain
      source/target/status/comments/tags, restart, and export to a no-clobber
      native file that reparses with unchanged opaque metadata.
- [x] AC2: MQXLIFF XML and MQXLZ ZIP fixtures round-trip with auxiliary entries,
      bounded resource checks, and explicit degradation findings.
- [x] AC3: malformed XML, DTD, traversal ZIP, duplicate ZIP names, encryption,
      oversized entry, unknown path, stale destination, and unsupported state
      produce typed errors with no persisted partial document or output.
- [x] AC4: `filter.list` exposes the new descriptors and existing filters retain
      their IDs/capabilities; protocol schema and TypeScript contracts remain
      drift-free.
- [x] AC5: stdio smoke covers import/edit/restart/export for both XML and ZIP
      forms, and focused Rust tests cover dialect fixtures and adversarial cases.

## Out Of Scope

- Reproducing proprietary vendor UI, executing macros/scripts, remote package
  fetching, undocumented binary containers, or changing the existing XLIFF
  semantics. Bilingual review DOCX and task packages are later child tasks.
