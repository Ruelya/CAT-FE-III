# Findings round 1

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-7-ai-plugins`
- branch: `implement/ortho-frontend`
- head_sha: `62ad512b76fc60a796faa9364ea817a16ed1bc56` (working tree has uncommitted Phase 7 renderer + design notes)
- round: 1

## need_verify
- required: false

### Verify mission
- none (static review + desktop typecheck + scoped unit tests are sufficient for expression-only AC judgment; documented residuals in `docs/design-ii/09-implementation.md` §期7 are **accepted**)

## issues

### F1
- severity: nit
- files: `apps/desktop/src/renderer/AiControlPage.tsx` (~1503 LOC)
- problem: Design suggested extracting `AiControlHeader` / tab panels under `components/ai/`; presenters + consistency UI were extracted, but the AI control orchestrator remains a large single file (comparable to pre-Phase-7 size after restructure). Functionally meets AC1–AC6 (tabs, master–detail, RPC, budget gate).
- minimal_fix: Optional later extract of tab panels only if maintainability pain appears. Not required for Phase 7 closeout.
- status: wontfix

### F2
- severity: nit
- files: `apps/desktop/src/renderer/components/workbench/SelectionAiMenu.tsx:198-211`
- problem: Inline `wordDiff` result strip is rendered with `hidden` and never unhidden — accept/discard UX is already inside `PluginAiActions` menu variant. Dead presentation branch is noise only.
- minimal_fix: Remove the hidden block or wire it when proposal text differs after invoke. Optional polish.
- status: open

### F3
- severity: nit
- files: `apps/desktop/src/renderer/components/workbench/SelectionAiMenu.tsx`, `apps/desktop/src/renderer/Workbench.tsx`
- problem: Accept path uses `activeSegment` / `insertMatch` (assistant-consistent), not `anchor.segmentId` from the selection's editor. Selecting text in a non-active row would still propose against the active segment. Typical focus+select flow is fine.
- minimal_fix: Optional — on accept, focus/activate `anchor.segmentId` before write, or pass segment-scoped insert. Residual accepted for Phase 7.
- status: wontfix

## assumptions
- Expression-only scope holds: Phase 7 dirty tree is renderer (`AiControlPage`, plugins host/panel, workbench wiring, `components/ai/*`, `SelectionAiMenu`, surface CSS, i18n) + `docs/design-ii/09-implementation.md` notes. No engine / contracts / preload / package.json dependency changes in the Phase 7 workset.
- Grounding residual on AI control (no active segment → no `ai.grounding.preview` invoke; honest copy via `GroundingInspector` `unavailableReason`) satisfies AC4 by design.
- Built-in G-01 polish omitted (no Engine selection-rewrite path) — plugin-only selection menu satisfies AC7–AC8 with residual.
- Consistency scan is client-side over loaded segments only, cap 200; apply uses sequential `segment.updateTarget` with live `expectedRevision`; undo residual honest copy — AC9 met within plan bounds.
- Workbench remounts when leaving `ai-control` surface (`App.tsx` surface switch), so `aiSettingsEnabled` reloads from `ai.settings.get` on return — selection menu gate stays coherent without live cross-surface sync.
- en+zh Phase 7 chrome keys exist (`MessageKey` + both locales); typecheck enforces completeness.
- Insights continues to host `PluginsPanel` (no new plugins spine surface).

## evidence_checked

### Commands run
| Command | Result |
| --- | --- |
| `pnpm exec vitest run src/renderer/components/ai src/renderer/components/workbench/SelectionAiMenu` | 4 files / 16 tests passed |
| `pnpm exec vitest run src/renderer/PluginAiActions.test.ts src/renderer/PluginPanelHost.test.tsx src/renderer/plugin-provenance-utils.test.ts` | 3 files / 20 tests passed |
| `pnpm run typecheck` (apps/desktop) | exit 0 |

### AC map (static)
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 three tabs ORTHO | met | `.ai-ortho` + tablist providers/batch/usage; i18n 引擎与配置档/批处理/用量 |
| AC2 enable + 全部关闭 | met | header strip + `ai.settings.update` `enabled: false` via `closeAllAi` |
| AC3 master–detail + credentials | met | profile list + detail; `credentialPresent` status; password field only for store, no secret echo |
| AC4 grounding | met (residual) | button opens inspector with `ai.groundingNeedsWorkbench` when no snapshot |
| AC5 RPC names | met | catalog/list/create/update/delete/test, settings, batch start/cancel/resume, usage.query unchanged |
| AC6 usage honesty + budget | met | `ai.usage.query` aggregates; stack bar; local note; `budgetGate === "block"` disables start |
| AC7 selection menu | met | `SelectionAiMenu` + IME/`canOpenSelectionAiMenu`; `PluginAiActions` editorSelection/menu |
| AC8 accept path | met | additive `selectionText`; accept → `onUseTarget` / insertMatch; no auto-write |
| AC9 consistency | met | term insert → scan → toast → drawer → sequential `segment.updateTarget` |
| AC10 Plugins G7 | met | contribution counts + permission table + Tier3/OS honesty; review action |
| AC11 host bar | met | `.plugin-panel-host__attribution` 24px; `插件：{name}` outside iframe |
| AC12 i18n | met | new keys en+zh |
| AC13 tests/typecheck/no engine | met | tests green; typecheck green; Phase 7 dirty set renderer-only |

## residual_risks (accepted)
1. AI control has no active segment → grounding preview not invoked; honest residual (not labeled as grounded).
2. Built-in polish (润色/更正式) omitted — no Engine path; plugin `editorSelection` actions only.
3. Consistency scan limited to loaded segments; cap 200 + residual copy; no multi-segment undo API.
4. Batch Live Matrix optional not mounted; item list still shows real statuses.
5. Plugin host menu “report issue” disabled residual (no RPC); no dedicated “view permissions” menuitem (row table + review dialog remain).
6. AiControlPage not fully split into design-suggested subcomponents (F1).
7. Electron manual smoke (live provider test, real plugin panel iframe, term-apply toast in app) not run in this review environment; structural ACs covered by static + unit + typecheck.

## summary_for_orchestrator
Phase 7 expression shipped on `implement/ortho-frontend` working tree: AI control three-tab ORTHO console (enable/close-all, master–detail profiles, budget-gated batch, honest usage), selection-anchored plugin AI menu with IME guard, client consistency toast/drawer with `segment.updateTarget` bulk apply, PluginsPanel §G7 permission table + Tier honesty, and 24px PluginPanelHost attribution bar. API/IPC surface preserved; desktop typecheck green; ai/consistency/plugin-permission presenters + SelectionAiMenu + related plugin tests green. Documented residuals in `09-implementation.md` §期7 accepted. Only nits (F1/F3 wontfix, F2 open optional). **No blocker/major**. Verdict **green** — **ready_for_closeout** (commit Phase 7 renderer + task artifacts when closeout runs; no fix or verify round required).
