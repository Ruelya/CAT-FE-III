# First project walkthrough

There is no in-app tutorial in the current build. This is the manual path
through the vertical slice.

## Desktop path

1. Start the app: `pnpm bootstrap` once, then `pnpm dev:desktop`.
2. Create a project in the Projects view (name, source and target locale).
3. Import a source document. Registered import formats: DOCX, TXT, Markdown,
   HTML, XLIFF, XLSX, and PPTX. `fixtures/docx/m0-source.docx` and the files
   under `fixtures/formats/` are good starting points.
4. Translate in the workbench grid. Confirming a segment writes it into the
   project translation memory; exact and fuzzy TM matches, term hits, and
   concordance search appear in the side panels.
5. Optionally pretranslate the remaining segments from TM, and run QA to see
   deterministic number-mismatch issues.
6. Export the translated document.

## Headless path

The engine is a standalone process speaking JSON-RPC 2.0 over stdio, one
request per stdin line and one response per stdout line:

```bash
cargo build -p tl-engine
./target/debug/tl-engine --data-dir ./tmp-data
```

`scripts/engine-smoke.mjs` (run via `pnpm test:e2e:engine`) drives the whole
flow over that protocol and is the best executable reference for the method
sequence: handshake, project, import, edit/confirm, TM, termbases,
pretranslate, QA, and export.
