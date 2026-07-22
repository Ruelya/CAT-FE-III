# Technical Design: External CAT Interchange Formats

## Boundary

Implement a new `filter-interop` crate that depends on `filter-core` and may
reuse bounded package utilities from `filter-office-core`; the Engine remains
the sole registry owner. The renderer calls only the existing generic
import/export methods and never opens XML or ZIP data.

## Representation

Normalize SDLXLIFF/MQXLIFF units into the existing `FilterEvent` stream. Encode
vendor identity in structural paths (`sdlxliff:<file>/<trans-unit>` and
`mqxliff:<file>/<unit>/<segment>`), namespace inline tags with the Engine
document ID, and preserve vendor state/comments as metadata/notes. Keep the
original immutable source as the export base so unknown XML survives.

For MQXLZ, validate and stage the ZIP, select exactly one bounded XLIFF entry,
parse its units through the vendor adapter, then rebuild the package with the
changed XLIFF entry and raw-copy all other entries. Publication uses the shared
no-clobber helper after reparsing the staged package.

## Safety Limits

Reject DTD/DOCTYPE, external entities, excessive XML depth/unit/text sizes, ZIP
traversal/duplicates/encryption, more than 4,096 entries, any uncompressed
entry over 256 MiB, total uncompressed size over 1 GiB, and compression ratios
above 200:1. Error messages contain only IDs, entry names, and counts.

## Compatibility

No new wire method is required. Add filter descriptors through the existing
catalog. Existing `document.import`, `document.export`, `filter.list`, restart,
and no-clobber contracts stay intact. The new crate is registered in the Cargo
workspace and Engine filter construction.

## Rollback

If a vendor fixture cannot preserve a construct, leave the adapter disabled or
return an explicit unsupported/degradation result; never fall back to generic
XLIFF while claiming native fidelity. A failed staged ZIP/XML write removes
staging and leaves the destination and SQLite unchanged.
