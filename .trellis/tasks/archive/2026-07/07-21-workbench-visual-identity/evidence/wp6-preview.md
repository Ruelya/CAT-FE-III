# WP6 truthful Preview evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer.

## Delivered behavior

- Preview has a document identity header, truthful segment/page position,
  grouped follow/mode controls, a structure rail, and a paper-like document
  canvas. The rail and canvas use real Engine segment ordinals and structural
  paths; they do not invent pages, headings, tables, or layout relations.
- DOCX/HTML/Markdown/TXT-style non-paginated documents show `Segment N of
  total`, ordered source/target flow, and a bounded note explaining that page
  layout is unavailable. The represented segments are pointer- and
  keyboard-navigable and call Workbench's active-row/focus path.
- Collapsed Preview content stays mounted and becomes `inert`/`aria-hidden`
  while the visible Open Preview control remains available. Docked,
  collapsed, maximized, follow-active, and 120–320px resize behavior remains
  intact.
- PDF behavior remains Engine-backed: `pdf.page.list`, `pdf.page.get`, the
  actual page image, extracted blocks, OCR correction, loading skeleton, and
  error path are preserved. PDF blocks now expose the same active-location
  navigation affordance.

## Focused verification

```text
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "keeps non-PDF Preview truthful, mounted, and navigable"          pass
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "keeps panel motion, geometry, and Windows rendering coherent"    pass
pnpm --filter @translunar/desktop typecheck                          pass
pnpm --filter @translunar/desktop build                              pass
pnpm exec prettier --check <focused files>                            pass
```

The non-PDF test asserts the structure rail and paper surface, absence of a
fake page label, keyboard navigation to a real editor row, mounted
collapsed/inert state, no horizontal overflow, and clean renderer console at
1250x744, 1680x942, and 1920x1080.

The PDF lane ran against Poppler 26.02.0 and Tesseract on this Windows host with
`TRANSLUNAR_PDF_E2E=1`. It creates the current project through the production
setup flow, waits for a decoded real page image after every resize/mode change,
checks loading-state geometry against the status bar, exercises OCR correction
and the export-review override flow, and finishes with a clean console.

## Visual evidence

| Fixture / mode | Viewports and screenshots |
| --- | --- |
| DOCX ordered flow / default | `screenshots/wp6-preview-nonpdf-{1250x744,1680x942,1920x1080}.png` |
| DOCX ordered flow / collapsed | `screenshots/wp6-preview-nonpdf-collapsed-{1250x744,1680x942,1920x1080}.png` |
| DOCX ordered flow / maximized | `screenshots/wp6-preview-nonpdf-maximized-{1250x744,1680x942,1920x1080}.png` |
| Scanned PDF / default | `screenshots/wp6-preview-pdf-default-{1250x744,1680x942,1920x1080}.png` |
| Scanned PDF / collapsed | `screenshots/wp6-preview-pdf-collapsed-{1250x744,1680x942,1920x1080}.png` |
| Scanned PDF / maximized | `screenshots/wp6-preview-pdf-maximized-{1250x744,1680x942,1920x1080}.png` |

The durable matrix contains 18 nonblank screenshots. The PDF loading label is
kept below the page skeleton and above the status bar; bounding-box assertions
guard that geometry at runtime.
