# saas-gpt-plus - full-fidelity Workbench studies

Nine self-contained studies share one renderer, fixture set, command dispatcher,
keyboard map, dialog catalog, scenario matrix, grouped ribbon, VS Code-style tree,
and Fable proofing blocks. Open any `index.html` directly from disk.

| Study | Open | System |
| --- | --- | --- |
| Aperture | [`saas-gpt-plus-aperture/index.html`](saas-gpt-plus-aperture/index.html) | cool daylight |
| Moss | [`saas-gpt-plus-moss/index.html`](saas-gpt-plus-moss/index.html) | low-glare paper |
| Orbit | [`saas-gpt-plus-orbit/index.html`](saas-gpt-plus-orbit/index.html) | graphite dark |
| Prism | [`saas-gpt-plus-prism/index.html`](saas-gpt-plus-prism/index.html) | violet mist |
| Folio | [`saas-gpt-plus-folio/index.html`](saas-gpt-plus-folio/index.html) | editorial paper |
| Relay | [`saas-gpt-plus-relay/index.html`](saas-gpt-plus-relay/index.html) | refractive ice |
| Signal | [`saas-gpt-plus-signal/index.html`](saas-gpt-plus-signal/index.html) | poster utility |
| Nocturne | [`saas-gpt-plus-nocturne/index.html`](saas-gpt-plus-nocturne/index.html) | black satin |
| Orbit Light | [`saas-gpt-plus-orbit-light/index.html`](saas-gpt-plus-orbit-light/index.html) | daylight sibling |

Source of truth: [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md), vendored unchanged from
`cursor/gf-design-saas-opus-2398`.

## Inventory

- [x] 文件 / 编辑 / 视图 / 项目 / 翻译 / QA / 帮助 menus and accelerator hints
- [x] Grouped icon-over-label ribbon using each study's own toolbar and confirmation palette
- [x] `Ctrl+K` / `Ctrl+Shift+P` palette, complete status strip, search, and replace
- [x] VS Code-style nested workspace tree with folders, guides, search, progress, and removal
- [x] Multi-document tabs, filters, origin, lock, QA, tokens, editor, row menu, and confirm navigation
- [x] Memory, concordance, terminology, grouped QA waive/fix, AI, and Agent review docks
- [x] Proofread and DOCX-layout preview with wrapped translated, source, and active color blocks
- [x] Empty projects, import, settings, TM, termbase, overwrite, QA gate, and engine gate
- [x] Projects, grid, confirmed, locked, QA, AI, Agent review, and export gate scenes

## Art-study design reads

### Folio

Archival paper, forest ink, sharp editorial rules, and serif document proofing. The
grid stays sans and compact while the content layer gains a manuscript rhythm.

### Relay

Ice-glass chrome, opaque reading surfaces, and teal refraction cues. Motion is limited
to icon feedback so dense editing remains stable.

### Signal

Condensed poster typography, hard geometry, black rules, and a vermilion location
signal. It treats every command group as explicit information architecture.

### Nocturne

Black satin surfaces, chartreuse position cues, and low-luminance depth. Bright
proofing chips preserve the Fable translation states inside a dark control room.

Orbit Light is the daylight sibling of Orbit, preserving its cyan focus, tight rows,
and control-room geometry on pale graphite.

## Scenario URLs

Append `?scene=projects|grid|confirmed|locked|qa|ai|agent|gate` to any study URL.

## Build and verification

```sh
node docs/design-studies/saas-gpt-plus-src/build.mjs
PW=$(npm root -g)/playwright/index.mjs node docs/design-studies/saas-gpt-plus-src/shots.mjs
```
