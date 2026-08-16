# Option 2 spike: keep the engine, replace the editor surface

| Item | Value |
| --- | --- |
| Date | 2026-08-16 |
| Parent | [research-rebase-from-mature-cat.md](./research-rebase-from-mature-cat.md) |
| Status | Explored against live Swordfish 5.26 source, Okapi Tikal **1.48.0** on this machine, a live `translunar-engine` RPC session, and the generated protocol |

This is the Option 2 exploration. It does not add an engine method, does not fork VS Code, and does not claim Word COM.

## Verdict

| Spike | Can we drop it in? | What we actually do |
| --- | --- | --- |
| Swordfish `TranslationView` | **No.** 3.7k-line vanilla Electron class bound to a Java XLIFF store on `127.0.0.1:8070`. | Steal the **interaction**, reimplement a React grid on `segment.editor.list`. |
| Okapi Tikal | **Yes as a sidecar, with two filter bugs we had to fix, and one export gap still open.** | Use for formats we do **not** already own (IDML, WorldServer XLIFF). Do **not** send `.sdlxliff` through Tikal — `builtin.sdlxliff` already exists. |
| OnlyOffice Docs | **Not as a first embed.** Needs Document Server + JWT + a URL the server can fetch. | Preview host later. Until then: existing `document.export` + current preview. |

Code that exists from this spike:

- `apps/desktop/src/renderer/lib/bilingual-row-view.ts` — view-model mapping from `SegmentEditorRow` onto a Swordfish-shaped page request. No new engine method.
- `crates/filter-xliff` — `its:version` no longer shadows XLIFF `version`; `<mrk mtype="seg">` is not an inline tag.

## 0. What the homemade grid actually does today

`SegmentGrid` is a four-column table (`#` / Source / Target / Status). Source is **plain text**. Only the active row mounts `TargetEditor`. There is no page control.

`use-app-controller.ts` already pages the engine at `PAGE_LIMIT = 200`, then **concatenates every page** in `listAllEditorRows`. Swordfish keeps one 500-row window. Option 2 replaces that accumulation, not the RPC.

The engine already registers:

`builtin.bilingual-docx`, `builtin.bilingual-xlsx`, `builtin.docx`, `builtin.html`, `builtin.markdown`, `builtin.mqxliff`, `builtin.mqxlz`, `builtin.pdf`, `builtin.pptx`, `builtin.sdlxliff`, `builtin.txt`, `builtin.xliff`, `builtin.xlsx`.

There is **no** `builtin.idml`.

## 1. Swordfish editor

Inspected `/tmp/swordfish-src` (clone of [maxprograms-com/Swordfish](https://github.com/maxprograms-com/Swordfish), 5.26.0, EPL-1.0).

### What it is

```
Electron renderer (ts/translation.ts)
        │  ipcRenderer.send('get-segments' | 'set-target' | …)
        ▼
Java HttpHandler  :8070/projects/segments | /setTarget | /matches
        ▼
XliffStore  (SQLite + XLIFF file on disk)
```

Related conversion stack is **OpenXLIFF** (`com.maxprograms.converters`), not Okapi. Do not take both sidecars.

`ts/segment.ts` identity is XLIFF, not ours:

```ts
{ index, file, unit, segment, state, source /* HTML */, target /* HTML */, match, tagErrors, … }
```

`getSegments` pages with `start` / `count` (default **500** rows) and several independent `showUntranslated` / `showTranslated` / `showConfirmed` / `showReviewed` flags. Columns are `#`, Source, a translate action, match `%`, a confirm checkbox, Target.

Saves write HTML target blobs into `XliffStore.setTarget`. There is **no `expectedRevision`**.

### Why we cannot mount it

- Source/target are HTML strings. Ours are `sourceText` + structured `InlineTag[]`.
- Identity is `{file, unit, segment}`. Ours is `segment.id` + `revision`.
- TM/terms come from Java `SqliteDatabase` / `ITmEngine`. Ours already live in the Rust engine.
- Copying `translation.ts` would pull EPL code and the Java server. That is Option 1 in disguise.

### What we take

Interaction only, reimplemented:

- Paged bilingual table (one engine page at a time; do not keep `listAllEditorRows`)
- Source cell shows tags as chips; target is the existing `TargetEditor` (keep `target-editor-${id}` and IME / `SaveCoordinator`)
- Right rail: matches / MT / terms (we already have `IntelDock`)
- Filter bar: one engine `filter` at a time; combined Swordfish flags collapse to `all` and narrow in the renderer via `filterHints`
- `showReviewed` has no engine filter. Keep it as a local `filterHints` / `workflowState` view, or do not offer it.

Proven mapping: `editorListParamsFromPage` / `toBilingualRowView`. Combined show-flags do **not** get a new protocol field.

### Mutation path (unchanged)

| Grid action | Existing method |
| --- | --- |
| Load page | `segment.editor.list` |
| Type target | `segment.updateTarget` + `expectedRevision` |
| Confirm | `segment.confirm` |
| Move tags | `segment.tag.set` |
| Export for preview | `document.export` (`outputPath` required; QA gate may need `qaOverride`) |

## 2. Okapi sidecar — live probe (Tikal 1.48.0 + this engine)

Java 21 is enough. Tikal 1.48.0 lists `okf_idml`, `okf_html`, `okf_xliff`, `okf_xliff-sdl`, `okf_xliff-iws`, `okf_sdlpackage`.

### What we ran

1. `tikal -x sample.html -sl en-US -tl zh-CN -seg` → XLIFF 1.2 with `xmlns:okp`, `xmlns:its`, and **`its:version="2.0"` next to `version="1.2"`**.
2. `tikal -x handoff.sdlxliff -fc okf_xliff-sdl` → another generic 1.2 XLIFF. Vendor `sdl:` metadata is gone.
3. `document.import` of the raw `.sdlxliff` → **`builtin.sdlxliff`**, 1 segment, no protocol change.
4. After the filter fix: `document.import` of the Tikal HTML XLIFF → **`builtin.xliff`**, 4 segments.
5. `segment.updateTarget` + `segment.confirm` on the untagged title → `欢迎来到极光`, revision 2, state `confirmed`.
6. `document.export` without override → **`qa_gate_blocked`** (existing gate, 1 error / 3 warnings). With `qaOverride` it wrote the XLIFF.
7. `tikal -m` merged that XLIFF back to HTML. The edited title survived. **Untouched tagged units did not.**

### Two ingest bugs this spike fixed

`builtin.xliff` first rejected every Tikal file with `XLIFF contains no translatable units`.

Root cause: `parse_attributes` stored keys by local name, so `its:version="2.0"` overwrote `version="1.2"`. The parser then looked for XLIFF 2 `<segment>` nodes and found none.

Second bug: Tikal wraps targets in `<mrk mtype="seg">`. Those wrappers were imported as protected tags, so `segment.confirm` failed with `tag_extra` on `<mrk>`. Segmentation markers are not inline tags.

Both fixes stay inside `crates/filter-xliff`. No new RPC.

### What still breaks tagged round-trip

Export rewrites target inners with `render_template`, which spreads characters across text slots. An unedited unit:

```text
Welcome to <em>Aurora</em>
```

came back as:

```text
Welcome<em> to Aur</em>ora
```

The sidecar is proven for **untagged** extract → import → edit → export → merge. It is **not** proven for tagged HTML/IDML until export keeps the original target template when the translator did not move tags.

### Corrected format advice

| Format | Path |
| --- | --- |
| `.sdlxliff` / `.mqxliff` / `.mqxlz` | Existing Rust interop. Do not put these through Tikal. |
| DOCX / HTML / MD / TXT / PDF / XLSX / PPTX | Existing Rust filters. Do not extract them with Tikal just to re-import. |
| IDML / WorldServer XLIFF / other Okapi-only types | Tikal sidecar. Still need a real IDML file before we promise it. `okf_idml` is listed; we did not have a sample. |

### Pipeline (no new engine method)

```text
source.idml
    │  tikal -x -sl en-US -tl zh-CN -fc okf_idml -seg
    ▼
source.idml.xlf          (XLIFF 1.2 + okp/its)
    │  document.import { sourcePath, filterId: "builtin.xliff" }
    ▼
Translunar segments      (editor works as today)
    │  document.export { documentId, outputPath, qaOverride? }
    ▼
translated.xlf
    │  tikal -m -sd <original-dir>
    ▼
translated.idml
```

Need a Java runtime next to the desktop (sidecar binary, not in-process). Engine always writes XLIFF; Tikal only extracts and merges.

## 3. OnlyOffice preview host

OnlyOffice Docs (Document Server) embeds via JS API + iframe:

```js
new DocsAPI.DocEditor("host", {
  documentType: "word",
  document: { fileType: "docx", title, url, key },
  editorConfig: { mode: "view", lang: "zh" },
  token, // JWT, required since Docs 7.2
});
```

That `url` must be reachable **by the Document Server**, not only by the renderer. In Electron that means:

1. `document.export` to a temp file (existing method, needs `outputPath`, may need `qaOverride`)
2. Main process serves that file on a loopback URL
3. A Document Server process (Docker / installed) fetches it
4. Iframe is `mode: "view"` only — no editing, no Bergamot-as-CAT

This is a **product-ops** sidecar (hundreds of MB, JWT secret, loopback allowlist). It is the correct Trados-shaped split (grid owns translation, Word-like host owns layout). It is not the first week of Option 2.

Until that sidecar exists, do not spend more time making homemade reconstruction look like Word.

## 4. What not to do in the next month

- Do not paste Swordfish `translation.ts` into `apps/desktop`.
- Do not fork OpenXLIFF and Okapi at the same time.
- Do not add `document.sourceBytes` or a new list filter combinator.
- Do not rebase the workbench onto OnlyOffice editing.
- Do not send `.sdlxliff` through Tikal.
- Do not resume chrome-only Trados iterations (dock placement, wizard copy) unless they unblock the grid rewrite.

## 5. Next implementation order

1. **React bilingual grid** consuming `BilingualRowView`, still using `TargetEditor` + `SaveCoordinator`. Page through `segment.editor.list` instead of `listAllEditorRows`. Keep `target-editor-*` / `target-surface-*` / confirm button contracts.
2. **XLIFF export template fidelity** for tagged Tikal units (keep original target inner when tags did not move). Then one real IDML: extract → import → edit one segment → export → merge.
3. **OnlyOffice view host** only after (1) is the daily editor. Export-to-temp is the feed.

Option 2 is viable. The drop-in fantasy is not. The engine stays; the homemade grid is what we replace.
