# ORTHO Phase 4 — Stack dual-pane + Preview dock

## Goal

Deliver **expression-only** Workbench Phase 4 from `docs/design-ii/09-implementation.md` §期4 and `docs/design-ii/screens/workbench.md` §4–5:

1. **Stack**: TM matches + Terms **always co-visible**; AI Assistant as a **drawer**; **one** collapse control (no bidirectional arrows, no floating capsule).
2. **Match cards** with word-level strikethrough / underline diff (no color-block diffs).
3. **Term rows** (compact preferred/forbidden/pending).
4. **Grounding Inspector** for assistant (real injected content only; no “grounded” claims without it).
5. **Preview dock**: real page structure where available, follow-active segment highlight, pop-out window, PDF dual-pane when data exists.
6. Prefer mounting design-token **`.wb` grid + `data-stack`** for collapse/overlay when low-risk with Phase 2 residual layout.

Branch: `implement/ortho-frontend`. i18n: **en + zh**.

## Context (done / do not redo)

| Phase | Delivered (leave alone except for stack/dock wiring) |
| --- | --- |
| 0–1 | Shell, tokens, surfaces |
| 2 | Masthead, FilterRail, DocumentMatrix, ActiveAxis; legacy flex host intentional |
| 3 | SegmentGrid / SegmentRow / lamps / tags / seam / batch / inline QA / roving |

**Do not** re-implement grid cells, FilterRail groups, Matrix ownership, or engine/contracts/preload.

## Requirements

### R1 — Stack structure (co-visible dual pane + AI drawer)

- Replace mutual-exclusive **Matches | Terms | Assistant | QA** tabs with:
  - **Matches** section: always mounted, primary flex growth, scrollable; sticky section head (count, sort/settings placeholders if already present; no new engine).
  - **Terms** section: always mounted below a structural seam; `max-height` ~30%; internal scroll when many hits.
  - **AI Assistant**: bottom **drawer** — collapsed bar ~32–34px; expanded takes ~50% of stack body while matches remain ≥ ~180px min.
  - **QA tab removed from Stack** (QA remains row-inline + future QA Surface; Phase 3 already owns inline QA).
- Single collapse control on stack chrome:
  - Expanded: one control → collapse to **40px rail** with expand affordance only.
  - Collapsed: rail only; no second competing maximize-as-primary chrome (remove dual maximize/collapse as peer primary actions if they violate “single collapse control”; restore width may stay as non-primary if needed for existing preference persistence — prefer map maximize → optional later, not dual arrows).
  - Keyboard: `Ctrl+9` (existing toggle command path).
  - No bidirectional arrow pair; no floating capsule toggle.
- Focus: on collapse, move focus to rail expand control; content stays mounted, `inert` + `aria-hidden` when collapsed (existing SuggestionsPanel pattern).

### R2 — Match cards (G2)

- Presentational match list fed by **existing** `matches` / loading / error / `onInsert` hooks from Workbench.
- Card geometry per design: rule separators, not bordered cards; current item shade + left axis.
- Header: score tier (mono), library/source label, date.
- Source/target blocks on `--deck`; **word-level diff** vs active segment source:
  - deleted → `del` / line-through + muted text
  - inserted → `ins` / 1px underline
  - **No** green/blue highlight blocks
- Footer: provenance meta + Insert (+ shortcut hint display for ranks 1–9 where data supports).
- Empty / loading / error: existing Workbench visual-state patterns (no circular spinners).

### R3 — Term rows (G3)

- Feed from existing `termMatches` / loading / settled / error.
- Compact row: `source → preferred target` + state chip (`首选` / `禁用` / `待定` via i18n).
- Forbidden uses error ink + clear mark; optional hover detail if data already carries definition (no new RPC).
- Add-term affordance may remain intent-only if current Workbench has no dialog wiring; do not invent backend.

### R4 — Assistant drawer + Grounding Inspector (G6)

- Drawer hosts existing assistant capability via **LiveAssistantPanel / OfflineAssistantPanel / AssistantPanel** data paths — re-skin into drawer shell; do not invent new AI RPC.
- Collapsed bar: label + engine/profile summary or “not configured” / “AI off” + generate shortcut hint if already present.
- Expanded: reuse existing generate / stream / apply mutation / replace-insert actions.
- **Grounding Inspector**: expandable panel listing **actual** injected terms / TM examples / style / document context from existing grounding preview result (`previewGrounding` / `PromptBundle` path in LiveAssistantPanel). If preview unavailable, show honest unavailable state — never label UI “grounded” without inspectable content (PRD F-03).
- Machine provenance strip on AI results where already required.

### R5 — Preview dock (workbench.md §5)

- Keep under **grid column only** (not under Stack); preserve existing `DocumentPreview` props: document, segments, active segment, mode, height, follow-active, navigate, source-correct hooks, PDF page list/get.
- Chrome bar (~32px): document name, page/position meta when known, prev/next when applicable, zoom if already present, **follow current segment** checkbox, **pop-out** control, collapse/expand.
- Height: collapsed 32px; expanded default ~216px; drag clamp existing `clampPreviewHeight` / prefs; `Ctrl+P` toggle path.
- Content honesty:
  - PDF: keep real page image + text layer path when `builtin.pdf` + `pdf.page.*` works; dual-pane image vs OCR/text when both exist in current data.
  - Non-page formats: real structure when renderer already has it; otherwise clear **structure-path / no layout** message — never fake a print layout.
- Follow-active: highlight current segment with signal-wash + left signal edge (not heavy orange frame).
- Click-to-navigate: existing `onNavigateSegment` — preserve target focus policy already implemented.
- Pop-out: open preview in secondary window if Electron path exists or can reuse existing shell; main dock collapses with “open in separate window” status. If pop-out infrastructure is incomplete, implement best-effort window open with same document/segment id and document residual risk — do not block dual-pane stack on perfect multi-window.

### R6 — `.wb` layout mount (preferred, low-risk)

- Design CSS already defines `.wb` + `data-stack="collapsed|overlay"` and `.stack` / `.dock` rules; Phase 2 left them unmounted on legacy `workbench-layout` flex.
- Phase 4 **should** wire root workbench content host to `.wb` **if** Matrix + grid + masthead + filter + stack + dock areas map without breaking Phase 2–3 scroll ownership (grid remains sole scroll owner; Matrix viewport sync preserved).
- Overlay mode for narrow width (<1180px): stack overlays or zero column per CSS; single collapse still works.
- If full CSS-grid remount is high-risk mid-task, fall back: keep flex host but **still** deliver dual-pane stack + dock expression + rail collapse; document residual “`.wb` host deferred” in implement notes — prefer remount when changes stay layout-class + area wrappers only.

### R7 — Expression-only + data hooks

- **No** engine / contracts / preload / new IPC for this task.
- Preserve Workbench-owned state: `matches*`, `termMatches*`, `suggestionsMode` (map to stack collapsed/expanded), `suggestionTab` (retire tab state or map assistant open), `previewMode` / `previewHeight` / `followActivePreview`, insert + applyMutation.
- Extract components under `components/workbench/Stack/` and `components/workbench/PreviewDock/` (or equivalent) per `09-implementation.md` split guidance; Workbench remains orchestrator.
- Style via existing tokens / `workbench-stack.css` / dock rules; no literal palette inventing; no circular spinners; no decorative filler copy in UI (project front-end discipline).

### R8 — i18n

- All new chrome strings in `i18n/messages.ts` **en + zh**.
- Retire or stop using tab labels for QA-in-stack; add stack section / drawer / grounding / dock honesty strings as needed.
- Accessibility names on collapse, expand, insert, follow, pop-out.

## Acceptance criteria

- [ ] **AC1** With an active segment that has TM matches and term hits, both **Matches** and **Terms** sections are visible **at the same time** without switching tabs.
- [ ] **AC2** Stack has no Matches/Terms/Assistant/QA tab strip; QA list is not re-hosted in Stack.
- [ ] **AC3** Exactly one primary stack collapse control: expanded → 40px rail; rail → expand; no simultaneous bidirectional arrows; no floating capsule toggle.
- [ ] **AC4** `Ctrl+9` toggles stack collapse; focus moves to the surviving control; collapsed body is `inert`/`aria-hidden`.
- [ ] **AC5** Match cards show word-level `del`/`ins` (strikethrough/underline) against active source when texts differ; no color-block diff styling.
- [ ] **AC6** Term rows show source → target + state; forbidden styling uses error treatment when state is forbidden.
- [ ] **AC7** Assistant is a bottom drawer (collapsed by default or restored from preference if present); expand does not hide Terms entirely; matches keep usable min height.
- [ ] **AC8** Grounding Inspector opens only over real preview bundle content (or honest unavailable); UI does not claim “grounded” without inspectable sections.
- [ ] **AC9** Preview dock sits under the grid column only; follow-active highlight and navigate callbacks still work; PDF path still loads pages when document is PDF.
- [ ] **AC10** Pop-out control either opens a secondary preview or documents a clear disabled/honest residual if shell cannot; no fake dual-monitor claim.
- [ ] **AC11** Existing insert match / apply assistant mutation / preview height prefs continue to work without new engine methods.
- [ ] **AC12** en + zh keys exist for all new user-visible Phase 4 chrome.
- [ ] **AC13** Unit tests for pure word-diff helper + critical stack/drawer mode behavior; no regression to SegmentGrid scroll ownership smoke assumptions.
- [ ] **AC14** If `.wb` is mounted: `data-stack` collapsed/overlay classes drive width; if not: residual explicitly listed and dual-pane still ships.

## Out of scope

- Phase 5–8 surfaces (project home, QA review surface, AI Control three-tab rewrite, plugins, coach marks, full dark dual-track).
- Match-bucket FilterRail live counts / engine score buckets.
- Column resize between source/target; optional match-source grid column.
- Concordance full rewrite (may keep existing injection hooks if already present; not required to complete Phase 4).
- New TM/term write APIs; new grounding server semantics.
- Redo of Masthead / FilterRail / Matrix / SegmentRow geometry.
- Git merge to main (Orchestrator lifecycle).

## Assumptions

| ID | Assumption | Confidence |
| --- | --- | --- |
| A1 | Exact TM list currently surfaces 100% project matches without fuzzy score tiers; score UI may show 100% or available score fields only — no invented fuzzy engine. | High |
| A2 | Word-level diff is client-side pure function over strings (token/word split); good-enough for CJK/space languages without external diff package unless one already exists. | High |
| A3 | `LiveAssistantPanel` grounding preview IPC is the sole grounding data source for inspector. | High |
| A4 | Mapping `suggestionsMode` collapsed/docked/maximized → design collapsed/expanded (+ optional drop of maximize) is acceptable if prefs migration is loss-tolerant. | Medium |
| A5 | `.wb` remount is preferred but dual-pane stack is P0 over perfect CSS-grid migration if conflict with Matrix scroll. | High |
| A6 | Pop-out may be thin Electron `window.open` / existing pattern; full second-display polish can residual. | Medium |

## Success definition

Translator can keep TM and terminology **on screen together**, collapse the stack with **one** control, inspect **real** AI grounding when generating, and use a **honest** document preview dock under the grid — without engine changes and without regressing Phase 2–3 chrome.
