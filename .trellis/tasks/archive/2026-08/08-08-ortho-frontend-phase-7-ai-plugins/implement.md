# Implement — Phase 7 AI control and plugins

## Branch

`implement/ortho-frontend` (task.branch). Do not merge master/main from this worker.

## Ordered checklist

### 0. Prep

- [ ] Confirm branch `implement/ortho-frontend` and Phases 0–6 shell/surfaces exist.
- [ ] Read `docs/design-ii/screens/ai.md`, `05-components.md` G5–G7/A4/A7, `09-implementation.md` §期7.
- [ ] Inventory invokes in `AiControlPage`, `PluginAiActions`, `PluginsPanel`, `PluginPanelHost`, `LiveAssistantPanel` grounding preview — **do not change method names/core payloads**.
- [ ] Copy `ai.grounding.preview` argument shape from `LiveAssistantPanel.tsx`.
- [ ] Copy `segment.updateTarget` shape from `Workbench.tsx`.
- [ ] Note legacy CSS: `.ai-control-*`, `.plugin-ai-actions*`, `PluginsPanel.css`, `plugin-panel-host*`.

### 1. Surface CSS + presenters

- [ ] Add `styles/30-surfaces/ai.css` + `plugins.css`; import in `styles/index.css`.
- [ ] Add `components/ai/ai-presenters.ts`: tab ids, budget ratio, usage stack fractions, connector source labels — unit tests.
- [ ] Add `components/ai/consistency-presenters.ts`: normalize term, scan segments for divergent targets, cap list — unit tests.
- [ ] Reuse `LiveMatrix` only if batch item matrix is in scope and cheap; else skip (residual).

### 2. AI control three tabs (R1)

- [ ] Extract header / tab list / providers / batch / usage from `AiControlPage.tsx`.
- [ ] Restructure to `.ai-ortho` grid; remove marketing kicker/description.
- [ ] Global enable + 全部关闭 → `ai.settings.update` with existing fields.
- [ ] Providers master–detail; credential status only; plugin §G5 strip from `source`.
- [ ] Wire GroundingInspector slot + `ai.grounding.preview` when context available; residual otherwise.
- [ ] Batch: preserve start/cancel/resume/items; restyle meter; optional matrix from real items.
- [ ] Usage: real aggregates; stack bar; local-stats note; budget warn/block batch CTA.
- [ ] i18n tab labels 引擎与配置档/批处理/用量 (en equivalents).
- [ ] Target orchestrator ≪ 1,336 LOC of JSX.

### 3. Selection AI menu (R2)

- [ ] Add `SelectionAiMenu` (popover geometry §A4).
- [ ] Wire from Workbench/SegmentRow: selection in source/target → open if enabled && !composing.
- [ ] Mount `PluginAiActions` `placement="editorSelection"` `variant="menu"`.
- [ ] Pass real `selectionText` into invoke context via PluginAiActions prop if needed (additive prop; same invoke envelope).
- [ ] Result strip: wordDiff + accept/discard; accept uses existing insert/draft path.
- [ ] Omit built-in polish group unless existing invoke path found — document residual.
- [ ] Tests: composition suppresses open; disabled AI suppresses open (unit/hook where practical).

### 4. Consistency repair presentation (R3)

- [ ] Hook term-apply (or explicit action) → `scanDivergentTargets` on loaded segments.
- [ ] Toast with count + 查看 → open drawer.
- [ ] Drawer: checkboxes, before/after, select-all, apply via `segment.updateTarget`.
- [ ] Partial failure reporting; no fake full undo.
- [ ] Cap rows; residual for unloaded segments.
- [ ] Unit tests for presenters.

### 5. PluginsPanel G7 + host bar (R4)

- [ ] Restyle plugin rows: contribution counts, §G7 table from `contributionPermissions` / review results.
- [ ] Tier labels + Tier 3 honesty string for unenforceable/unknown process-FS style capabilities.
- [ ] Keep install/inspect/grant/audit/version/pipeline logic and invoke names.
- [ ] `PluginPanelHost`: 24px attribution `插件：{pluginName}` + status + menu/close; iframe below.
- [ ] Tokenize `PluginsPanel.css` / move shared host rules to `plugins.css` as needed.
- [ ] Insights mount still works.

### 6. i18n + a11y + cleanup

- [ ] en+zh for all new strings (tabs, close-all, permission states, honesty, toast, drawer, host bar, local usage note).
- [ ] Tab ARIA; menu ARIA; table headers; icon labels.
- [ ] Neutralize obsolete mega `styles.css` AI control layout when unused.
- [ ] Run validation commands; manual AC walkthrough; list residuals.

## Validation commands

```bash
# From repo root
cd apps/desktop

# AI / consistency presenters + selection menu tests
pnpm exec vitest run src/renderer/components/ai --passWithNoTests
pnpm exec vitest run src/renderer/components/workbench/SelectionAiMenu --passWithNoTests
pnpm exec vitest run src/renderer/PluginAiActions.test.ts
pnpm exec vitest run src/renderer/PluginPanelHost.test.tsx
pnpm exec vitest run src/renderer/plugin-provenance-utils.test.ts

# Broader renderer smoke if time
pnpm exec vitest run src/renderer --passWithNoTests

# Typecheck
pnpm run typecheck
```

Manual:

1. Open project → AI control (Spine): three tabs; toggle enable; 全部关闭; create/edit profile; credential never plaintext; test connection; grounding inspect or residual; start batch cancel/resume; usage numbers real; over-budget blocks start when budget set.
2. Workbench: select text in target (AI on) → anchored menu with plugin actions (if plugins contribute); IME composition does not open menu; accept/discard.
3. Apply term with divergent existing targets → toast → drawer → selective apply updates segments.
4. Insights → plugins: G7 table + honesty; open panel preview → 24px 插件： name bar; close/reload.
5. Locale en/zh on new chrome.

## Risk points

| Point | Watch |
| --- | --- |
| Grounding preview payload | Mirror LiveAssistant exactly |
| PluginAiActions selectionText | Additive prop only; filter placement unchanged |
| IME races | compositionstart closes menu |
| Bulk updateTarget | expectedRevision per row |
| PluginsPanel state machine | Do not “simplify” grant flow |
| styles.css collisions | Scope `.ai-ortho` / `.plugins-ortho` |
| Fake estimates | Omit minutes if not computable from real concurrency × items |

## Done definition

All AC1–AC13 met or residual explicitly listed in task notes; typecheck + relevant unit tests green; expression-only (no contracts/engine/preload diffs).
