# Closeout summary — Phase 4 Stack dual-pane + Preview dock

**Task:** `.trellis/tasks/08-08-ortho-frontend-phase-4-stack-preview`  
**Branch:** `implement/ortho-frontend`  
**Quality:** Review round 1 green (typecheck exit 0; renderer Vitest 230/230). No open product blockers.  
**Role:** trellis-closeout only (no product code, no git commit/merge).

## What shipped

Expression-only Workbench Phase 4 (no engine/contracts/preload):

1. **`StackPanel`** replaces tabbed `SuggestionsPanel`:
   - Matches + Terms **always co-visible** (no tab strip; QA not in Stack).
   - **Single** collapse control → rail; body `inert`/`aria-hidden`; focus handoff.
   - `suggestionTab` → `assistantOpen`; `maximized` prefs clamp to `docked`.
2. **Match cards** with pure `wordDiff` → `<del>`/`<ins>` (strikethrough/underline; no color blocks). Exact TM tier remains 100% (A1 residual).
3. **Term rows** with preferred/forbidden/pending chips + forbidden error treatment.
4. **`AssistantDrawer`** wraps existing Live/Offline/Assistant + plugin panels.
5. **`GroundingInspector`** shared with `LiveAssistantPanel` — only real `PromptBundle` content; honest unavailable path.
6. **`PreviewDock`** extract of DocumentPreview under **grid column only**: follow-active signal highlight, PDF dual-pane when data exists, best-effort pop-out with disabled honesty on block.
7. **i18n** en+zh for new chrome; stack CSS dual-pane flex in `workbench-stack.css`.
8. **Tests:** `wordDiff.test.ts`, `StackPanel.test.tsx`.

### Accepted residuals (do not block)

| Residual | Notes |
| --- | --- |
| `.wb` + `data-stack` host | Still legacy flex; dual-pane ships without CSS-grid remount (AC14). |
| Collapse rail width | May be ~48px legacy token vs design 40px until `.wb`. |
| Pop-out | Thin `window.open`; not full BrowserWindow session sync (AC10). |
| TM score tier | Hardcoded 100% exact display; no fuzzy engine (A1). |
| Unrelated dirt | `.grok/agents/trellis-plan.md` effort tweak — **exclude from product commit**. |

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | Phase 4 full 7-section code-spec; panel-mode + layout-host + PDF PreviewDock wording updates. |
| `.trellis/spec/frontend/component-guidelines.md` | Phase 2–4 extract table; Stack/PreviewDock examples. |
| `.trellis/spec/frontend/directory-structure.md` | Stack/ + PreviewDock/ tree under `components/workbench/`. |
| `.trellis/spec/frontend/quality-guidelines.md` | Phase 4 unit/coverage checklist. |

Product design note already present: `docs/design-ii/09-implementation.md` 期4 实现记录.

## Suggested commit (Orchestrator)

**Subject:**

```text
feat(ui): ORTHO Phase 4 stack dual-pane, assistant drawer, preview dock
```

**Body:**

```text
Replace tabbed SuggestionsPanel with StackPanel: co-visible Matches and Terms,
single collapse rail, bottom AI drawer, and shared GroundingInspector over real
PromptBundle content only.

Extract PreviewDock under the grid column (follow-active highlight, PDF path,
best-effort pop-out). Add wordDiff unit tests, StackPanel shell tests, and en/zh
chrome strings. Keep Workbench data hooks; no engine/contracts/preload changes.

Residual: legacy flex host (no .wb remount), thin pop-out, exact-TM 100% tier.

Omit unrelated .grok/agents/trellis-plan.md from this commit.
```

**Paths to include (product + task + specs):**

- `apps/desktop/src/renderer/components/workbench/Stack/**`
- `apps/desktop/src/renderer/components/workbench/PreviewDock/**`
- `apps/desktop/src/renderer/Workbench.tsx`
- `apps/desktop/src/renderer/LiveAssistantPanel.tsx`
- `apps/desktop/src/renderer/i18n/messages.ts`
- `apps/desktop/src/renderer/styles/30-surfaces/workbench-stack.css`
- `docs/design-ii/09-implementation.md`
- `.trellis/spec/frontend/**` (updated)
- `.trellis/tasks/08-08-ortho-frontend-phase-4-stack-preview/**`

**Exclude:** `.grok/agents/trellis-plan.md` (and any other `.grok` dirt).

## Residual risks for next tasks

- Later layout task must remount `.wb` carefully without breaking SegmentGrid scroll ownership / Matrix viewport.
- Full multi-window preview polish if product requires BrowserWindow sync.
- Fuzzy TM score UI only after engine score buckets exist.
- Optional full i18n of pre-existing PDF “Page N of M” chrome.

## Archive / merge

Not performed by closeout. Orchestrator commits on `implement/ortho-frontend`, merges per lifecycle, then archives task when finish-work policy allows.
