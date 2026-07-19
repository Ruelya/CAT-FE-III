# Technical Design: Office Document Filters

## 1. Boundaries

```text
filter-core (event contract, bounds, no-clobber publication)
        |-- filter-docx (DOCX package parts and revision policy)
        |-- filter-xlsx (workbook/sheet/shared-string selection)
        |-- filter-pptx (slides/tables/SmartArt/notes/masters)
        `-- engine (registry, generic RPC, transaction)
```

The new adapters remain format-specific. A small `filter-office-core` helper
owns bounded ZIP entry access, UTF-8 XML validation, stable XML text-span
scanning, and package reassembly; it has no domain or storage dependency.
Existing `filter-docx` public methods remain source-compatible and delegate to
the enhanced implementation.

## 2. Normalized Unit Contract

Each unit emits `StartUnit`, source `Text`, protected `InlineTag` events for
run/rich-text boundaries, optional `Note`, and `EndUnit`. Paths are opaque to
the renderer but decode to a package part and owner:

```text
docx:<part>#p:<stable-paragraph-id>
xlsx:<worksheet-part>#cell:<A1-reference>
pptx:<slide-or-diagram-part>#text:<stable-owner-id>
```

The Engine supplies `document_id` to namespace tag IDs. The filter does not
use ordinal-only IDs for persistence. Source locale is copied into
`DocumentMetadata`; options are parsed once and invalid combinations fail
before any event is emitted.

## 3. Package Discovery And Limits

1. Open the ZIP with a bounded entry-size and entry-count guard.
2. Validate `[Content_Types].xml`, the root relationships, and each owned XML
   part without resolving external targets.
3. Discover parts through relationship targets, not filename guesses alone.
4. Keep an ordered list of raw entries. Rebuild only entries with replacements;
   copy all other entries with their original compression metadata.

The helper rejects encrypted entries, path traversal names, XML over the
configured byte/depth limits, duplicate relationship IDs, and unsupported
encodings. Error messages identify the part and byte position, never document
text.

## 4. DOCX Extraction And Export

The part walker visits document, header/footer, footnote/endnote, and optional
comments XML. It tracks paragraph identity from the part-local XML node offset
and filters revision depth (`w:ins`/`w:moveTo` included, `w:del`/`w:moveFrom`
excluded). Text boxes are ordinary `w:t` nodes in drawing shapes, so they are
covered by the same walker. Each paragraph's text runs are coalesced while
run properties and controls become protected tags.

On export, the walker finds the same stable paragraph and replaces only its
owned writable text nodes. It keeps controls and all non-owned XML events in
place, then validates every changed part and the final ZIP. Comments are
written back only when they were explicitly imported and targeted.

## 5. XLSX Extraction And Export

The workbook relationship graph yields visible worksheets, their names, and
sheet parts. Selection is evaluated against normalized sheet names/indexes and
inclusive row/column ranges. Cell classification is:

```text
shared string (`t=s`) -> resolve `sharedStrings.xml` rich-text runs
inline string (`t=inlineStr`) -> read `<is>` rich-text runs
formula/numeric/error/boolean -> protected, no unit
```

Shared-string units use cell paths, not shared-string ordinal paths. During
export, a translated cell that shares an index is assigned a cloned `<si>`
entry containing the translated text; untouched cells retain the original
index. Rich-text run tags are emitted as protected source tags and the target
is placed in the first writable run while preserving the run/property skeleton.
The workbook is reparsed and selected cell values are compared before publish.

## 6. PPTX Extraction And Export

Slide relationships are resolved in presentation order, then each slide's
shape/tree XML is scanned for `a:t`. Tables are naturally covered because
their cells contain the same text body. SmartArt data parts are discovered
from slide relationships and scan `dgm:t`/`a:t`. Notes and slide masters are
included only when their options are enabled. Owner IDs include the part path,
XML node offset, and parent shape/table identity, so reordering slides does
not remap a stored segment.

Export performs range-local replacement of owned text nodes, reparses changed
slide/diagram/notes/master parts, and checks that all non-text package entries
remain present. Unsupported text-bearing relationship targets produce a
degradation finding with the part path.

## 7. Engine And Protocol Integration

- Register filters in deterministic order: DOCX, XLSX, PPTX, then existing text
  and interchange filters.
- Keep `document.importDocx` and `document.exportDocx` as compatibility wrappers
  over `builtin.docx`.
- Pass project source locale and bounded `options` through `ImportRequest`.
- Temporary imports retain their original extension so probes select the right
  Office filter. Managed source paths remain workspace-relative.
- Persist units, tags, notes, and degradation findings in the existing import
  transaction. No Office-specific tables or protocol methods are required.

## 8. Compatibility, Security, And Rollback

Old schema versions and old requests continue to work. New crates can be
disabled by removing registry entries without changing persisted documents.
Package parsing is non-executing: macros, formulas, external links, ActiveX,
and embedded scripts are opaque bytes. If a changed part cannot be reparsed,
the staged file is deleted and the existing destination is untouched.
