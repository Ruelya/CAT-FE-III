# Closeout summary — ORTHO Phase 7 AI and plugins

**Task:** `.trellis/tasks/08-08-ortho-frontend-phase-7-ai-plugins`  
**Branch:** `implement/ortho-frontend`  
**Status:** ready for Orchestrator commit/merge (this worker does not commit)  
**Review:** `review/findings-1.md` — green (no blocker/major; F1/F3 wontfix, F2 optional nit)

## What shipped

Expression-only renderer work for design §期7 / `screens/ai.md`:

| Area | Delivery |
| --- | --- |
| AI Control | Three-tab ORTHO console (providers / batch / usage): global enable + 全部关闭 via `ai.settings.update`, master–detail profiles, credential status only, budget-gated batch, honest usage stack, grounding residual when no workbench segment |
| Selection AI | `SelectionAiMenu` §A4 popover; `PluginAiActions` `editorSelection`/`menu`; IME composition guard; optional `selectionText`; accept via existing `onUseTarget` path (no auto-write) |
| Consistency | Client `scanDivergentTargets` on loaded segments; toast → drawer; sequential `segment.updateTarget` with per-row revision honesty |
| Plugins | §G7 permission table + contribution counts + Tier3/OS honesty; `PluginPanelHost` fixed 24px `插件：{name}` attribution outside iframe |
| Styles / i18n | `styles/30-surfaces/ai.css` + `plugins.css`; en+zh Phase 7 chrome keys |
| Presenters | `ai-presenters`, `consistency-presenters`, `plugin-permission-presenters` + unit tests |
| Design notes | `docs/design-ii/09-implementation.md` §期7 implementation record + residuals |

**Preserved:** all `ai.*` / `plugin.*` / `segment.updateTarget` invoke names and core payloads; no engine/contracts/preload/npm dep changes in the Phase 7 product set.

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | Phase 7 full contract section; Project Lifecycle + Engine AI + Plugin AI Actions cross-refs |
| `.trellis/spec/frontend/directory-structure.md` | `components/ai/*`, `SelectionAiMenu`, `ai.css` / `plugins.css`, stable Ai/Plugins paths |
| `.trellis/spec/frontend/component-guidelines.md` | Phase 7 extract table + executable contract link |

## Validation (from review)

- Vitest: `components/ai` + `SelectionAiMenu` — 16 tests pass  
- Vitest: `PluginAiActions` / `PluginPanelHost` / `plugin-provenance-utils` — 20 tests pass  
- `pnpm run typecheck` (apps/desktop) — green  
- AC1–AC13 met or residual accepted (findings-1)

## Residual risks (accepted)

1. Grounding preview on AI Control residual without active segment (honest; not labeled 接地).  
2. Built-in G-01 polish omitted (no Engine selection-rewrite path).  
3. Consistency scan limited to loaded segments (cap 200); no multi-segment undo API.  
4. Batch Live Matrix optional not mounted (item list keeps real statuses).  
5. Plugin host “report issue” residual (no RPC).  
6. `AiControlPage` still large monolith (F1 wontfix).  
7. Selection accept uses active segment, not necessarily selection’s row (F3 wontfix).  
8. Dead hidden `wordDiff` strip in `SelectionAiMenu` (F2 nit open).  
9. Electron manual smoke (live provider, real plugin iframe, term toast in app) not run in review env.

## Out of commit scope for this task

- Unrelated dirty file: `.grok/agents/trellis-plan.md` (exclude unless intentionally part of another change).  
- Task archive / status complete — Orchestrator / finish-work policy.

## Suggested commit

**Subject:**

```text
feat(ui): ORTHO Phase 7 AI control, selection AI, consistency, plugins G7
```

**Body:**

```text
Deliver expression-only Phase 7 surfaces on implement/ortho-frontend:

- AI Control three-tab ORTHO chrome (enable/close-all, master–detail
  profiles, budget-gated batch, honest usage); grounding residual when
  workbench context is missing
- Selection-anchored PluginAiActions menu with IME guard and optional
  selectionText; accept via existing onUseTarget path
- Client consistency toast/drawer after term apply; sequential
  segment.updateTarget with partial-failure honesty
- PluginsPanel §G7 permission table + Tier3 honesty; PluginPanelHost 24px
  host attribution bar outside the iframe
- Surface CSS (ai.css, plugins.css), presenters + unit tests, en/zh i18n
- Capture Phase 7 contracts in .trellis/spec/frontend/*

No engine/contracts/preload/npm dependency changes. Residuals documented
in docs/design-ii/09-implementation.md §期7 and review/findings-1.md.
```

## Files expected in commit (product + specs + task)

**Product (renderer + design notes):**

- `apps/desktop/src/renderer/AiControlPage.tsx`
- `apps/desktop/src/renderer/PluginAiActions.tsx`
- `apps/desktop/src/renderer/PluginPanelHost.tsx`
- `apps/desktop/src/renderer/PluginsPanel.tsx`
- `apps/desktop/src/renderer/Workbench.tsx`
- `apps/desktop/src/renderer/components/workbench/Stack/TermList.tsx`
- `apps/desktop/src/renderer/components/workbench/Stack/TermRow.tsx`
- `apps/desktop/src/renderer/components/workbench/Stack/stackTypes.ts`
- `apps/desktop/src/renderer/components/ai/**` (new)
- `apps/desktop/src/renderer/components/workbench/SelectionAiMenu.tsx` (+ test)
- `apps/desktop/src/renderer/i18n/messages.ts`
- `apps/desktop/src/renderer/styles/index.css`
- `apps/desktop/src/renderer/styles/30-surfaces/ai.css` (new)
- `apps/desktop/src/renderer/styles/30-surfaces/plugins.css` (new)
- `docs/design-ii/09-implementation.md`

**Specs + task artifacts:**

- `.trellis/spec/frontend/electron-workbench.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/tasks/08-08-ortho-frontend-phase-7-ai-plugins/**` (including this summary + review)
