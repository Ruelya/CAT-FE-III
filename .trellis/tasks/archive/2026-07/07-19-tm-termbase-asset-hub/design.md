# Technical Design: TM And Termbase Asset Hub

## 1. Boundary And Crate Shape

```text
translunar-domain
  <- translunar-asset-core (normalization, scoring, TMX/TBX/CSV codecs)
  <- translunar-storage (migration 4, repositories, atomic sinking)
  <- translunar-engine (protocol services and file publication)
  <- JSON-RPC / Electron
```

`asset-core` contains pure, format-neutral values and algorithms. SQLite
repositories remain in `storage`; the renderer receives generated protocol
types and never computes a score or parses an exchange format.

## 2. Durable Model And Migration

Migration 4 is additive. It creates:

- `tm_libraries` (`id`, name, source/target locale, domain, writable,
  timestamps, optional owner project);
- `tm_library_mounts` (`project_id`, `library_id`, mode, priority, enabled,
  timestamps, unique project/library);
- `tm_units` (library, source/target text and normalized keys, locale/domain,
  source/target hashes, origin project/document/segment, context-before/after
  hashes, author, metadata JSON, timestamps, unique provenance key);
- `termbases`, `termbase_mounts`, `term_entries`, and `term_translations` with
  preferred/forbidden/status checks and locale indexes.

Migration copies each schema-v3 `translation_memories` row to one
`tm_libraries` row and mounts it writable for its project. Existing
`tm_entries` become `tm_units` with their origin metadata. Legacy tables remain
readable for protocol compatibility; new sinks write both representations in
one transaction until the compatibility methods are retired.

`project.create` inserts its default library and mount atomically. A library
delete is rejected while mounted or referenced by provenance. Mount changes use
optimistic revision/operation records where mutable.

## 3. Matching Contract

`asset-core` exposes a pure `match_query` pipeline:

1. NFKC, case-fold (for non-CJK), whitespace, and placeholder normalization;
2. exact hash candidate lookup;
3. context equality for 101% (source plus before/after hashes);
4. fuzzy score from weighted character n-gram and token Jaccard similarity,
   with a bounded normalized Levenshtein tie-breaker;
5. number/date and protected-placeholder correspondence extraction.

The storage query first restricts by mounted library/language/metadata and a
bounded candidate limit, then scores in Rust. Results are sorted by descending
score, ascending mount priority, descending `created_at_ms`, and ID. CJK uses
characters as tokens plus whitespace/alphanumeric tokens, so it does not rely
on an English-only word splitter.

## 4. Term Recognition And QA

Mounted active term entries are loaded with a bounded query. Latin terms use
Unicode-aware case-insensitive word boundaries; CJK terms use normalized
substring matching. The result includes source span, entry/translation IDs,
preferred and forbidden flags. `run_document_qa` adds/upserts a
`term-forbidden` issue for forbidden target occurrences and resolves it when
the target is corrected, using the existing atomic QA transaction.

## 5. Exchange Codecs And File Flow

`asset-core` parses TMX 1.4b `<tu>/<tuv>/<seg>`, TBX-Basic concept/term nodes,
and RFC-4180 CSV/TSV through typed event/record structs. Unknown metadata is
retained in a JSON map where safe. The engine validates the requested library,
reads the file, persists records in one transaction, and reports row-level
diagnostics without committing a failed batch. Exports write a temporary file,
fsync, validate by reparse, then atomically publish; existing destinations are
never overwritten.

## 6. Protocol Additions

Additive v1 methods:

```text
tm.library.list/create/mount/unmount
tm.search
tm.concordance
tm.import/tm.export
termbase.list/create/mount/unmount
term.search/upsert
termbase.import/termbase.export
```

All pages use the existing 1..500 bound. Unknown libraries/termbases map to
`not_found`; malformed exchange data maps to `invalid_request` with row
diagnostics; stale mount/library revisions map to structured `conflict`.

## 7. Compatibility And Rollback

The old `translation_memories`, `tm_entries`, `tm.lookupExact`, and confirmation
response remain untouched on the wire. Migration 4 has no down migration;
rollback is restoring the pre-migration backup. New capability strings are only
advertised after migration, codec, matching, and sink tests pass.

## 8. Performance And Safety

Indexes cover library/source hash, locale/domain, mount priority, term key, and
origin. Search never materializes all project segments. Exchange parsers cap
record lengths and counts from request configuration, reject path traversal,
and never interpolate values into SQL. A deterministic 100k-unit search smoke
will record latency evidence without committing a generated database.
