# ORTHO Phase 7 — AI control and plugins

## Goal

Deliver **expression-only** AI- and plugin-class UI from `docs/design-ii/09-implementation.md` §期7 and `docs/design-ii/screens/ai.md`:

1. **AI 控制台 (`ai-control`)** — three ORTHO tabs **引擎与配置档 / 批处理 / 用量**, global enable strip, profile master–detail, Grounding Inspector entry, honest usage.
2. **划词 AI 锚定菜单** — selection-anchored §A4 menu using existing `PluginAiActions` (`editorSelection` + `menu`); IME-safe; result presentation via existing accept/discard (+ word-level diff when practical).
3. **一致性修复助手 presentation** — toast → drawer list with before/after + selective bulk apply using existing segment mutate paths (no new Engine scan RPC).
4. **PluginsPanel** — plugin rows as §G7 permission tables + Tier honesty; **PluginPanelHost** 24px host attribution bar.

Branch: `implement/ortho-frontend`. i18n: **en + zh**. Preserve all AI / plugin / permission invoke paths and payload shapes. No new IPC, contracts, engine methods, or npm deps.

## Context (done / do not redo)

| Phase | Delivered (leave alone except wiring) |
| --- | --- |
| 0–1 | Shell, tokens, Band/Index/Instrument, composition guard |
| 2–4 | Workbench grid/stack, `AssistantDrawer`, `GroundingInspector`, `wordDiff` |
| 5 | Project surfaces; Insights mounts `PluginsPanel` |
| 6 | QA / export / assets surfaces |

**Do not** rework engine AI batch/provider algorithms, plugin runtime, permission grant protocol, preload, or invent consistency-scan / built-in polish RPCs.

## Current baseline (evidence)

| Surface / file | Approx LOC | Today |
| --- | --- | --- |
| `AiControlPage.tsx` | ~1,336 | Already three tabs `providers` / `batch` / `usage`; policy band with multi-toggles + budget/origins; create-provider form + profile list (not master–detail); credentials via `setAiCredential` / `ai.credential.delete` (no plaintext echo); batch start/cancel/resume + item list + `<progress>`; usage table from `ai.usage.query`; **no** profile-level Grounding Inspector; marketing kicker/description |
| `PluginAiActions.tsx` | ~320 | Lists `plugin.aiAction.list`; invoke/cancel; `placement: editorSelection \| assistantSidebar`; **`variant: menu`** for menuitem chrome; mounted only as **assistantSidebar panel** inside `AssistantDrawer` — **no editor selection popover** |
| Selection AI (G-01 built-ins) | — | No workbench selection-anchored menu; no 润色/更正式 built-in menu implementation found |
| Consistency repair (G-04) | — | Gap matrix: no Engine impact-scan RPC; no toast/drawer product flow |
| `PluginsPanel.tsx` | ~1,752 | Full install/permission/audit/version/pipeline history; contribution inventory with decision badges; connector authority lines; CSS module `PluginsPanel.css` with literal-ish structure |
| `PluginPanelHost.tsx` | — | Iframe sandbox + bridge; header shows contribution name + status + close — **not** fixed 24px “插件：名称” attribution with permission menu |
| Routing | `WorkbenchPages` | `surface === "ai-control"` → `AiControlPage`; Insights hosts `PluginsPanel` |
| Styles | `styles.css` | `.ai-control-*`, `.plugin-ai-actions*`; panel CSS in `PluginsPanel.css`; no `styles/30-surfaces/ai.css` / `plugins.css` yet |

Contracts / DesktopApi already in use and **must stay green**:

- AI: `ai.provider.catalog|list|create|update|delete|test`, `ai.settings.get|update`, `ai.credential.delete` + `setAiCredential`, `ai.grounding.preview`, `ai.run.*` (via assistant / test wait), `ai.batch.start|get|list|items|cancel|resume`, `ai.usage.query`
- Plugin AI: `plugin.aiAction.list|invoke|cancel`
- Plugins: `plugin.list`, install/enable/disable/uninstall/rollback paths already in panel, `plugin.permission.review|grant|*`, `plugin.permission.audit.list`, panel session + `plugin.uiPanel.bridge.call`
- Segments (consistency apply): `segment.updateTarget` shape already used in Workbench / Phase 6

Utils that stay semantic-stable: `plugin-provenance-utils.ts`, `workbench-utils.ts`, `hooks/useComposition.ts`, `i18n/*`, `components/workbench/Stack/wordDiff.ts`, `GroundingInspector.tsx`.

## Requirements

### R1 — AI control three-tab ORTHO layout

- Reframe `AiControlPage` as **AI 控制台** surface chrome (no second Band; Shell owns spine):
  - **Header**: title + global strip `AI 辅助 · ●已启用|○已关闭` + primary **全部关闭** that sets `settings.enabled = false` via existing `ai.settings.update` (and saves). Interactive/batch allow flags remain editable on engine/config tab or policy sub-row — not marketing copy.
  - Neutralize `surface-kicker` marketing description; keep factual residual only if needed for disabled state.
- **§E2 horizontal tabs** (three only), labels per `ai.md`:
  1. **引擎与配置档** (`providers`)
  2. **批处理** (`batch`)
  3. **用量** (`usage`)
- **引擎与配置档**:
  - Master–detail: left profile list (default badge, connector kind 内置/插件 + schema version, availability); right detail: connector meta, base URL/model fields already edited today, **credential status only** (`credentialPresent` → “已存入系统凭据管理器”, never echo secret), 更换/删除, grounding option checkboxes (from profile/batch options already modeled as `GroundingOptions`), **`查看一次真实注入内容 →`** opens §G6 using existing `GroundingInspector` + `ai.grounding.preview` when a document/segment context is available from props; if preview unavailable, honest residual (do not label “接地” without inspectable bundle).
  - Plugin connector profiles: §G5 provenance strip (plugin id/version/contribution) using existing source fields.
  - Test connection: keep `ai.provider.test` + run wait; show success/failure notice with real error text.
  - Allowed origins / monthly budget: keep on this tab or header policy row; same `ai.settings.update` fields.
  - Create profile: secondary “新建配置档” flow (drawer or lower plate) reusing existing catalog create fields — not a permanent left-column marketing form.
- **批处理**:
  - Keep `ai.batch.start` params already used (`profileId`, `tmThreshold`, concurrency, RPM, `replaceDrafts`, `options: GroundingOptions`, project/document ids).
  - Presentation: estimate line from **real** `total`/concurrency only when known (else omit fake minutes); progress meter + counts (tm/succeeded/skipped/failed); cancel/resume existing; item list status.
  - Optional thin Live Matrix of batch item statuses when item list loaded (reuse Phase 6 `LiveMatrix` states) — only encode real item statuses; no fake cells.
  - Scope selectors beyond current document: residual if no existing multi-scope batch API (do not invent).
- **用量**:
  - Table/aggregates from `ai.usage.query` only; stacked proportion bar by provider when ≥1 aggregate; budget progress from `monthlyTokenBudget` + summed usage when fields exist.
  - Explicit microcopy: local stats, not uploaded (i18n).
  - ≥80% budget: §A8 warn banner; over budget: disable **new** batch start with reason (client gate on existing numbers only).
- Extract subcomponents under `components/ai/` so orchestrator is not a 1.3k JSX monolith; **preserve all invoke names/payloads**.

### R2 — Selection AI anchored menu

- When user selects text in Workbench source/target editor surface and AI is enabled (`ai.settings` / existing assistant gates), show an **anchored popover** (§A4 geometry: deck plate, rule edge, no backdrop blur) near selection end — **not** a floating toolbar strip.
- **IME**: do not open while `useComposition` / session composition active; close or ignore during composition.
- Content:
  - **Plugin group**: mount `PluginAiActions` with `placement="editorSelection"` and `variant="menu"` (already implemented). Preserve invoke/cancel/accept paths.
  - **Built-in G-01 polish list** (润色 / 更正式 / …): only if an **existing** renderer invoke path already supports selection rewrite without new contracts; otherwise **omit or residual disabled group** with honest empty — **do not invent** prompt templates or new Engine methods.
- After proposal: prefer **inline result strip** under the active cell using existing `wordDiff` (current vs proposal) + 采纳/丢弃/重试 when plugin proposal text path already yields replaceable text; accept must call existing `onUseTarget` / draft / `segment.updateTarget` path already used by assistant — **never auto-write without accept**.
- When AI global disabled: do not open menu; optional one-line residual near focus only if already patterned — no external calls.
- Wire from `Workbench` / `SegmentRow` selection events with minimal orchestration; extract `components/workbench/SelectionAiMenu.tsx` (or `components/ai/`).

### R3 — Consistency repair assistant presentation

- **Goal**: present G-04 UX **without** new Engine “impact scan” RPC (gap matrix confirms none).
- **Trigger (presentation)**: after a user-initiated terminology target change that Workbench already performs (term apply / target edit that matches a known term surface), or explicit “检查一致性” action on term row if cheap:
  - Client-side scan of **already-loaded** document segments (and/or pages already fetched via existing list APIs used by Workbench) for same source term with **different** target strings.
  - If `n > 0` other segments: §A7 toast `"{term}" 在另外 n 段中使用了不同译法 · 查看` (i18n).
- **Drawer**: list rows with segment ordinal, before/after, checkbox; select-all; **预览** then **批量应用**.
- **Apply**: sequential or batched `segment.updateTarget` mirroring Workbench field set (`segmentId`, `targetText`, `expectedRevision`); on revision conflict show per-row failure, do not claim full success; support cancel mid-run at presentation level.
- **Undo**: if no durable multi-segment undo API, provide honest residual (“可逐段撤销/依赖既有草稿恢复”) — do not fake multi-undo.
- Empty / no variance: no toast spam; optional quiet status.
- Extract `components/ai/ConsistencyRepairDrawer.tsx` + pure `consistency-presenters.ts` (scan/group) with unit tests.

### R4 — PluginsPanel permission table + host attribution

- **Plugin list rows** (`ai.md` §3.1–3.2 expression):
  - Identity: name · version · Tier (1 声明式 / 2 沙箱 / 3 进程外 human labels) · status · source.
  - Contribution summary counts by kind (format filter / QA / panel / AI action / pipeline / connector) from existing `contributions` array.
  - **§G7 permission table** per plugin: capability · scope · state `已授权 / 未请求 / 已拒绝 / 未知` · actions that already map to `plugin.permission.grant` / revoke / deny flows in the panel. Replace opaque comma-joined `grantedPermissions` string as the primary view (keep raw list as secondary if useful).
  - **Honesty**: Tier 3 / process or filesystem capabilities show `⚠ OS 层无法强制` (or en equivalent) when decision is unknown or host cannot enforce — required product integrity; link/button to existing permission review dialog.
  - Compatibility + crash count already present — restyle, keep data.
- **Do not** change install inspect grant protocol, audit list, version rollback, or pipeline history semantics — expression restyle only.
- **PluginPanelHost attribution bar** (forced 24px, `--frame` plate):
  - Text: `插件：{pluginName}` + contribution name micro + permission affordance + `⋯` menu: view permissions (callback/open existing review), disable/close, report residual if no report RPC.
  - Plugin iframe **must not** cover or remove this bar (host-owned header outside iframe — already true; fix height/tokens).
  - Crash/error: keep §F5-style host message + reload/close; no circular spinner.
- CSS: `styles/30-surfaces/ai.css` + `plugins.css` (or single `ai-plugins.css`); neutralize conflicting mega `styles.css` / `PluginsPanel.css` layout when replaced; tokens only.
- Insights dual-host: keep mounting `PluginsPanel`; no route invent for standalone plugins surface.

### R5 — Expression-only + API preservation

- **No** engine / contracts / preload / new IPC methods / new npm deps.
- **No** semantic changes to pure utils except **additive** presenters with tests.
- Forbidden: fake token charts, fake model version badges, “推荐” quality ratings, grounded wording without inspector, AI write without accept, spinners, permanent box-shadow, marketing kickers.
- When AI disabled: selection menu + batch start + assistant external calls remain gated by existing settings flags.

### R6 — i18n + a11y

- All new chrome strings in `i18n/messages.ts` **en + zh**.
- Tabs: `tablist` / `tab` / `tabpanel`.
- Selection menu: `role="menu"` / `menuitem`; focus return to editor; Esc closes.
- Permission tables: readable headers; icon-only controls labeled.
- Toast: `aria-live` polite; drawer Esc returns focus.

## Acceptance criteria

- [ ] **AC1** AI control surface shows exactly three tabs matching 引擎与配置档 / 批处理 / 用量 (keys may stay providers/batch/usage); ORTHO plate/seam layout without marketing hero.
- [ ] **AC2** Global AI enable + **全部关闭** persists via `ai.settings.update`; disabled state is visible in header.
- [ ] **AC3** Provider tab is master–detail; credentials never show secret plaintext; plugin profiles show provenance from existing source fields.
- [ ] **AC4** Grounding: “查看一次真实注入内容” uses `ai.grounding.preview` + `GroundingInspector` when preview possible; otherwise honest residual — no “接地” claim without inspectable bundle.
- [ ] **AC5** Batch start/cancel/resume/list/items and provider CRUD/test/usage query method names and core payloads unchanged.
- [ ] **AC6** Usage view only shows aggregates from `ai.usage.query` (+ settings budget); local-stats note present; over-budget blocks new batch start client-side when budget known.
- [ ] **AC7** Selection-anchored AI menu opens on non-IME text selection when AI enabled; mounts `PluginAiActions` `editorSelection`/`menu`; does not open while composing.
- [ ] **AC8** Plugin AI invoke/cancel/accept paths unchanged; accept does not write without user action.
- [ ] **AC9** Consistency repair: when client scan finds divergent term targets, toast + drawer list appear; bulk apply uses `segment.updateTarget` with revision; partial failures reported honestly.
- [ ] **AC10** PluginsPanel primary row UI includes §G7-style permission table and Tier 3 honesty marking where applicable; install/permission RPC set unchanged.
- [ ] **AC11** PluginPanelHost shows fixed host attribution bar with plugin name outside iframe; bridge/session/close behavior preserved.
- [ ] **AC12** en + zh for all new Phase 7 chrome.
- [ ] **AC13** Touched pure helper tests green; desktop renderer typecheck green; no engine/contracts/preload diffs.

## Out of scope

- Phase 8: settings Surface rewrite, coach marks, full density screenshot matrix, high-contrast pass as a project.
- New Engine methods: consistency impact scan, built-in polish action catalog, selection-rewrite protocol, plugin “report issue” backend.
- Redesigning Stack assistant conversation UX beyond selection menu + consistency presentation hooks.
- Moving `PluginsPanel` to its own Index Spine surface.
- Changing plugin sandbox/bridge security model or permission capability IDs.
- Fake multi-document batch scope without API.
- Full G-01 built-in polish suite if no invoke path exists (residual OK).

## Assumptions

| Assumption | Confidence | Fallback |
| --- | --- | --- |
| Existing three AI tabs map 1:1 to design labels | High | Rename i18n only; keep tab ids |
| `ai.grounding.preview` can be called from AI control with document + a sample segment from props | Medium | Residual “需在工作台预览接地” without using 接地 as feature claim |
| Selection menu can attach via selectionchange/mouseup on workbench cells without new editor core | High | Keyboard-only “AI 动作” entry from seam if selection API brittle |
| Built-in polish actions lack Engine support → residual omit | High | Plugin-only menu is complete for AC7–AC8 |
| Client-side segment scan is acceptable for G-04 presentation | Medium | Drawer open from explicit action with empty residual when no loaded segments |
| Sequential `segment.updateTarget` is enough for bulk apply | High | Stop on first conflict; list failures |
| Insights continues to host PluginsPanel | High | No new route |
| Branch `implement/ortho-frontend` continues serial ORTHO work | High | Per `task.json` |

## Notes

- Spec anchors: `screens/ai.md`, `09-implementation.md` §期7, `05-components.md` (A4 Popover, A6 Drawer, A7 Toast, A8 Banner, E2 Tabs, G5/G6/G7, D3/D8), `.trellis/spec/frontend/*`.
- Quality bar: complete coherent expression for AI surface + selection + consistency presentation + plugin honesty — shrink inventiveness of missing backends, not finish quality of kept UI.
- `research_needed: []` — contracts and files are in-repo; implement can proceed without a research spawn.
