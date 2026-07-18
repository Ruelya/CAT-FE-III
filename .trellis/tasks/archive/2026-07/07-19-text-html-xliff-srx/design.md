# Technical Design: Text, HTML, XLIFF, And SRX Filters

## 1. Architecture And Crate Boundaries

```text
translunar-domain
        |
translunar-filter-core  <---- stable event/import/export contracts
        |        \
segmentation-srx   format filters
                   |-- filter-text (TXT + Markdown)
                   |-- filter-html (HTML5 + XHTML)
                   |-- filter-xliff (1.2 + 2.1)
                             |
                         translunar-engine (registry + generic RPC)
```

`filter-core` remains format-neutral. Each adapter owns native parsing and
range mapping. `segmentation-srx` exposes pure rule parsing/application and has
no filesystem or SQLite dependency. Engine selects a filter, stages managed
input, passes project source locale/options, collects the event stream, and
performs the existing transactional document insert.

## 2. Contract Additions

Extend the internal Rust request additively:

```rust
pub struct ImportRequest {
    pub source: PathBuf,
    pub document_id: Option<String>,
    pub source_locale: Option<String>,
    pub options: BTreeMap<String, String>,
}
```

Use `Default` for optional values and update DOCX/tests at the call sites.
Engine allocates `document_id` before filtering so every imported inline-tag
ID can be namespaced by document; this is required because `inline_tags.id` is
a database-wide primary key. The generic protocol's `ImportDocumentParams`
adds optional string `options` while Engine continues to obtain the project
source locale from storage. The wire map is bounded to 32 entries, keys of
1..64 bytes, and values of at most 4096 bytes. Existing callers that omit
`options` deserialize to an empty map. `filter.list` descriptors identify
extensions and capabilities but do not expose parser internals.

For export, each filter receives the original managed source and authoritative
stored segments. It rejects unknown structural paths, duplicate ownership, and
conflicting translations before writing a temporary destination.

## 3. SRX Model And Algorithm

`segmentation-srx` parses XML with `quick-xml` into language rules and ordered
map rules. A candidate boundary is represented by the byte/character offset
between two source slices. For each rule, `beforebreak` matches the left slice
ending at the boundary and `afterbreak` matches the right slice beginning at
the boundary. This avoids regex lookbehind, which Rust's `regex` crate does not
support. `break="no"` vetoes a boundary; otherwise the first matching
`break="yes"` creates it. Rules are applied in deterministic declaration
order, with longest/most-specific profile selection first.

Built-in profiles are data tables in Rust for zh, en, ja, and ko. They include
abbreviation/no-break sets, decimal and URL guards, paired punctuation, and
language-appropriate terminal punctuation. Paragraph mode returns the original
paragraph as one unit. Sentence mode returns `(start,end)` ranges and preserves
all whitespace in the source buffer.

## 4. TXT And Markdown

TXT scans UTF-8 bytes once, records BOM, newline tokens, paragraph ranges, and
trailing newline. Markdown uses a source-offset parser (such as
`pulldown-cmark`) and a protected-span scanner. Events for visible text are
coalesced into units; code spans/blocks, URL destinations, HTML blocks, and
syntax punctuation are emitted as protected inline tags or excluded spans.
Each unit stores a source range in an internal map keyed by a stable path such
as `markdown:block:<ordinal>:<start>`. Export walks ranges from right to left,
validates that each path occurs once, and applies target text while copying all
other bytes unchanged.

## 5. HTML And XHTML

Use a non-executing tokenizer/parser that retains source byte spans for start
tags, end tags, attributes, text nodes, comments, and entities. Maintain an
element stack and an exclusion depth for `script/style/code/pre`. Text nodes
outside exclusions become units or sentence subunits. Inline element boundaries
produce paired `InlineTag` values with payload containing the original tag
lexeme; attributes selected by a normalized option set become independent units
with a path such as `html:attr:<node-offset>:<name>`.

HTML5 and XHTML differ only in namespace/name matching and empty-element
handling. Export applies replacements in descending source-offset order,
revalidates with the same parser, and atomically publishes. If a parser cannot
prove a safe range, it returns a degradation/error rather than reserializing
the whole document.

## 6. XLIFF 1.2 And 2.1

Parse XML tokens while retaining raw unknown attributes/namespaces and child
ordering. Normalize both versions into an internal `XliffUnit`:

```text
file id + locale metadata
unit stable id + source range + target range + state
segments (source/target token streams, notes, inline code payloads)
```

1.2 units use `trans-unit` IDs; 2.1 units use `unit` plus `segment` IDs. Inline
`bpt/ept/it/ph` (1.2) and `pc/ph/sc/ec` (2.x) are protected tags with source
and target sides. Existing targets are emitted as `TargetText` and remain
editable. Export rewrites only target text/state token ranges, preserving
unknown metadata and ordering. A staged output is parsed again and its IDs,
source text, and tag pairing are compared before publication.

## 7. Engine And Persistence Flow

1. Resolve explicit filter or probe by extension/content.
2. Read project source locale and merge request options.
3. Copy source to a managed temporary path and hash it.
4. Parse/filter/segment; collect and validate all events in memory.
5. Persist managed source, document metadata, units, inline tags, and segment
   notes in one transaction. Migration 5 introduces
   `segment_notes(segment_id, id, text, author)` with a composite primary key;
   XLIFF state/notes survive restart through this table.
6. On export, load authoritative segments, write a temp file, validate/reparse,
   fsync, and publish with no-clobber semantics.

Any failure before commit removes the temporary artifact and leaves the
workspace unchanged. Existing DOCX generic and legacy paths call the same
flow.

## 8. Compatibility, Security, And Limits

- Keep `FilterError` typed (`Invalid`, `Unsupported`, `Io`, `Processing`) and
  map through the single Engine RPC error mapper.
- Cap input bytes, XML depth, unit count, segment length, and option sizes; use
  explicit invalid-request diagnostics for exceeded limits.
- Never execute HTML/Markdown content or resolve external entities. Do not log
  source/target bodies.
- Preserve unknown XLIFF/XML data as opaque bytes only within the staged file;
  never treat it as executable code.

## 9. Rollback And Observability

Add new crates/registrations only after their isolated tests pass. Rollback of
the protocol surface restores the backed-up schema and generated TypeScript
together; rollback of persistence leaves migration 5 in place because schema
migrations are additive. Filter registrations can be removed independently
without deleting managed files or notes. Log filter ID, operation, byte/unit
counts, and degradation codes to stderr/structured tracing, excluding text.
