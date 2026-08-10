# WP0 — Bridge / contract verification

## Generated catalog

Confirmed present in `packages/contracts/src/protocol.generated.ts` for all P2 methods:

- Editor: `segment.tag.set`, `segment.propagate`, `segment.find`, `segment.replace.preview|apply`, `segment.split|merge`, `segment.correctSource`, `segment.comment.*`, `segment.spell.check`, `segment.chinese.convert`, `editor.undo|redo|history`, `editor.preferences.get|update`, `dictionary.*`
- Review: `review.queue`, `review.accept`, `review.reject`
- Assets: `tm.*`, `termbase.*`, `alignment.session.*`, `corpus.*`, `asset.catalog.list`, `curation.*`

## File dialogs

| Dialog | Status | Notes |
| --- | --- | --- |
| `selectCorpusInput()` | OK | Main open dialog; Engine-owned parse |
| `selectExportPath(suggestedName)` | OK | Extension-driven save filters |
| `selectSourceDocument()` | **Not suitable for TM/TB** | `supportedDocumentFilter` extensions: docx, xlsx, pptx, pdf, txt, md, markdown, html, htm, xhtml, xlf, xliff, sdlxliff, mqxliff, mqxlz — **no tmx/tbx/csv/tsv** |

## Blocker ID: `WP0-TM-TB-IMPORT-FILTER`

**Decision:** Omit TM/TB **import** UI controls (no dead button). Ship create/list/mount/unmount/search/concordance/export and all other non-file asset paths. Do not widen main/preload in this task. Corpus import continues via `selectCorpusInput()`.

## Foundations present

`SaveCoordinator`, session-v1, feature op-token pattern (`beginOp`/`isOpCurrent`/`invalidateFeatureOps`), typed `fake-desktop-api`, Workbench + TargetEditor IME contract — all present on base.
