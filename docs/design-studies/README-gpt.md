# saas-gpt-plus — full-fidelity Workbench studies

Four self-contained Modern SaaS HTML studies share one renderer, fixture set, command
dispatcher, keyboard map, dialog catalog, and scenario matrix. Open any `index.html`
directly from disk.

| Study | Open | Density |
| --- | --- | --- |
| Aperture | [`saas-gpt-plus-aperture/index.html`](saas-gpt-plus-aperture/index.html) | compact |
| Moss | [`saas-gpt-plus-moss/index.html`](saas-gpt-plus-moss/index.html) | comfortable |
| Orbit | [`saas-gpt-plus-orbit/index.html`](saas-gpt-plus-orbit/index.html) | compact dark |
| Prism | [`saas-gpt-plus-prism/index.html`](saas-gpt-plus-prism/index.html) | balanced |

Source of truth: [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md), vendored unchanged from
`cursor/gf-design-saas-opus-2398`.

## Inventory checklist

- [x] 文件 / 编辑 / 视图 / 项目 / 翻译 / QA / 帮助 menus and accelerator hints
- [x] Complete ribbon, overflow-safe grouping, segment search, command search
- [x] `Ctrl+K` / `Ctrl+Shift+P` palette with commands, docks, and documents
- [x] Status message, segment counts, draft and QA jumps, progress, caret, INS, engine identity
- [x] VS Code-style nested workspace tree with folders, indent guides, search, progress, removal
- [x] Multi-document tabs, state and proposed data filters, removable chips, visible/total count
- [x] Segment origin, lock, QA count, token chips, editor, row menu, confirm navigation
- [x] VS Code-shaped find/replace with next/previous, replace all, confirmed-row policy
- [x] Memory and concordance, terminology and quick capture, grouped QA waive/fix, AI and Agent review
- [x] Proofread and DOCX-layout preview modes with segment jump
- [x] Empty projects, import, settings, TM management, termbase management, overwrite, QA gate, engine gate
- [x] All eight scenarios: projects, grid, confirmed, locked, QA, AI unconfigured, Agent review, export gate

## Design reads

### Aperture

Cool daylight surfaces, cobalt focus, compact Inter-scale typography, and restrained
surface stepping. Best for mixed translation and review in bright offices.

### Moss

Warm paper neutrals, pine focus, slightly larger rows, and dashed hierarchy guides.
Best for long translation sessions where low glare matters.

### Orbit

Graphite layers, cyan location cues, tinted state glass, and a focused editor outline.
Best for dark workspaces and users who keep the CAT tool beside an IDE.

### Prism

Violet-grey chrome, controlled translucency, indigo focus, and a gradient selection
marker. The grid stays opaque for stable reading contrast.

## Scenario URLs

Append `?scene=projects|grid|confirmed|locked|qa|ai|agent|gate` to any study URL.

## Build and verification

```sh
node docs/design-studies/saas-gpt-plus-src/build.mjs
PW=$(npm root -g)/playwright/index.mjs node docs/design-studies/saas-gpt-plus-src/shots.mjs
```
