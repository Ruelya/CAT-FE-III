# First-run tutorial

The desktop product shell shows an interactive bilingual tutorial on first
launch (persisted in product shell settings, not `localStorage` document text).

## Guided steps

1. Welcome
2. Create / open a project (real Project Home control)
3. Import a source document
4. Edit and confirm segments
5. Run QA
6. Export
7. Complete — optional offline example project

Skip, resume, and restart are supported. Focus is trapped in the overlay while
it is open; Escape skips.

## Bundled example

- Path: `apps/desktop/resources/examples/welcome/source.txt`
- License: Apache-2.0-compatible sample text (`LICENSE.txt` beside the fixture)
- Action: Product Settings → **Open example project** copies/opens through the
  normal Engine `project.create` + `document.import` path (works offline)

## Manual path

1. Launch Translunar CAT.
2. Create or open a project (source/target locales + domain).
3. Import a source document (start with the bundled example or
   `fixtures/docx/m0-source.docx`).
4. Translate and confirm segments; confirmed work sinks into local TM.
5. Open Project Insights → QA / Assets / Plugins as needed.
6. Export the translated document.
7. Optional headless path:

```bash
cargo build -p translunar-engine
./target/debug/translunar --data-dir ./tmp-data run \
  --source ./fixtures/docx/m0-source.docx \
  --output ./tmp-out.docx
```
