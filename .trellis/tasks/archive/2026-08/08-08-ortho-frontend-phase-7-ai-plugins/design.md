# Design — Phase 7 AI control and plugins

## Boundaries

| Layer | In | Out |
| --- | --- | --- |
| Renderer presentation | AI control ORTHO tabs, selection menu chrome, consistency toast/drawer, plugin G7 rows, host bar | Engine algorithms, new contracts, new IPC |
| Workbench wiring | Selection events → menu; term/target hooks → consistency scan | New editor command protocol |
| Utils | Additive presenters (permission row map, consistency scan, usage bar fractions) + tests | Semantic changes to plugin-provenance / workbench-utils |
| IPC | Existing methods only | New methods / preload fields |

## Current baseline (evidence)

- `WorkbenchPages` mounts `AiControlPage` for `ai-control` with standard workspace props (`snapshot`, `document`, …).
- `AiControlPage` already implements tab state and full provider/batch/usage RPC graph (~1.3k LOC).
- `GroundingInspector` + `ai.grounding.preview` exist in Stack/Live assistant path.
- `PluginAiActions` supports `editorSelection` + `menu` but is only mounted with `assistantSidebar` in `AssistantDrawer`.
- No selection-anchored popover in workbench; `useComposition` / `shouldIgnoreKey` available.
- G-04 Engine scan absent; Workbench has `segment.updateTarget`, `term.search`, loaded `segments`.
- `PluginsPanel` already loads permissions via `plugin.permission.review` and shows contribution inventory — not G7 table layout.
- `PluginPanelHost` header is host-owned (outside iframe) but not 24px attribution strip with plugin label + permission menu.

## Target architecture

```text
WorkbenchPages
└── AiControlPage                         # orchestrator: load/settings/providers/batch/usage
    └── components/ai/
        ├── AiControlHeader               # title + enable + 全部关闭
        ├── AiControlTabList              # §E2 three tabs
        ├── AiProvidersTab                # master–detail profiles
        │   ├── AiProfileList
        │   ├── AiProfileDetail           # connector, credential, grounding, test
        │   └── AiGroundingSlot           # wraps GroundingInspector + preview invoke
        ├── AiBatchTab                    # config + progress + optional LiveMatrix
        ├── AiUsageTab                    # aggregates + stack bar + budget banner
        └── ai-presenters.ts              # budget ratio, usage stack, connector labels

Workbench / SegmentRow (minimal wiring)
├── components/workbench/SelectionAiMenu.tsx   # §A4 anchor + PluginAiActions menu
└── components/ai/ConsistencyRepair*           # toast host + drawer + presenters

ProjectInsightsPage
└── PluginsPanel                          # keep path; restyle rows
    ├── PluginRow / PermissionTable       # §G7 extract optional
    └── PluginPanelHost                   # attribution bar only expression change
```

### Suggested paths

```text
apps/desktop/src/renderer/
  AiControlPage.tsx                 # slim orchestrator
  PluginAiActions.tsx               # stable API; optional class hooks only
  PluginsPanel.tsx                  # row expression + extracts
  PluginPanelHost.tsx               # attribution bar markup/CSS
  components/ai/
    AiControlHeader.tsx
    AiControlTabList.tsx
    AiProvidersTab.tsx
    AiProfileList.tsx
    AiProfileDetail.tsx
    AiBatchTab.tsx
    AiUsageTab.tsx
    ConsistencyRepairToast.tsx
    ConsistencyRepairDrawer.tsx
    ai-presenters.ts
    consistency-presenters.ts
    *.test.ts(x)
  components/workbench/
    SelectionAiMenu.tsx
    SelectionAiMenu.test.tsx
  styles/30-surfaces/
    ai.css
    plugins.css
  i18n/messages.ts
```

Stable import paths: `AiControlPage`, `PluginsPanel`, `PluginPanelHost`, `PluginAiActions`.

## Layout contracts

### AI control

```css
.ai-ortho {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-block-size: 0;
  height: 100%;
}
.ai-ortho__tabs { /* §E2 ~40px; selected under-edge Active Axis */ }
.ai-providers {
  display: grid;
  grid-template-columns: minmax(200px, 280px) minmax(0, 1fr);
  min-block-size: 0;
}
.ai-profile-row[data-selected] { /* Active Axis 3px left */ }
.ai-batch {
  display: grid;
  grid-template-columns: minmax(240px, 360px) minmax(0, 1fr);
}
.ai-usage-stack { /* §D3 horizontal stacked bar from real fractions */ }
```

- Header outside tabs: title + enable lamp + 全部关闭.
- No permanent marketing description paragraph.
- Budget warn: §A8 banner inside usage (and block batch CTA when over).

### Selection AI menu

```css
.selection-ai-menu {
  /* A4: --deck, 1px --rule-strong, --elev-pop only on popover, --r-pop */
  position: fixed; /* or anchor(); fallback fixed from getBoundingClientRect */
  z-index: /* popover layer */;
  min-inline-size: 12rem;
  max-inline-size: 18rem;
}
.selection-ai-result {
  /* under cell: wordDiff del/ins; actions row */
}
```

- Prefer CSS Anchor Positioning when available; else `getBoundingClientRect` + flip.
- `role="menu"`; first item focus optional; Esc closes and restores selection/caret when possible.
- Group separator before plugin actions; plugin items show plugin name in title/tooltip.

### Consistency repair

```css
.consistency-drawer { /* A6 420–560px right */ }
.consistency-row {
  display: grid;
  grid-template-columns: auto 1fr;
  /* before/after mono pair; checkbox */
}
```

- Toast A7 bottom-right, 8s if action present; does not steal focus.
- Drawer lists only scanned hits; apply disabled until ≥1 selected.

### Plugins G7 + host bar

```css
.plugin-perm-table {
  display: grid;
  grid-template-columns: 1fr auto auto auto; /* cap / scope / state / action */
  /* seams not card gaps */
}
.plugin-panel-host__attribution {
  block-size: 24px;
  background: var(--frame);
  display: flex;
  align-items: center;
  /* “插件：{name}” + icons + menu; never covered by iframe */
}
.plugin-panel-host iframe {
  min-block-size: 0;
  flex: 1;
}
```

- Tier 3 honesty cell: `--warn` lamp + i18n string for OS non-enforcement.
- Decision chips: granted / not-requested / denied / unknown — map existing `permission.decision` + null/undefined.

## Data flow (unchanged RPC)

### AI control

```text
load:
  ai.provider.catalog
  ai.provider.list
  ai.settings.get
  ai.batch.list { projectId }
  ai.usage.query { projectId, sinceMs, untilMs, dimension: "provider" }

settings:
  ai.settings.update { enabled, defaultProfileId, monthlyTokenBudget,
    allowInteractive, allowBatch, allowedOrigins, expectedRevision }

providers:
  ai.provider.create | update | delete | test
  setAiCredential(profileId, secret) | ai.credential.delete

grounding preview (detail):
  ai.grounding.preview { …mirror LiveAssistantPanel payload fields only… }
  → GroundingInspector(snapshot)

batch:
  ai.batch.start { projectId, documentId, profileId, tmThreshold,
    concurrency, requestsPerMinute, maxAttempts, replaceDrafts, options }
  ai.batch.get | items | cancel | resume
```

Mirror `LiveAssistantPanel` for grounding preview argument names; if required segment id missing, skip invoke and show residual.

### Selection AI

```text
plugin.aiAction.list {}
  → filter placement === "editorSelection" && state === "active"
plugin.aiAction.invoke { invocation: { …existing PluginAiActions shape… } }
plugin.aiAction.cancel { invocationId }
accept → onUseTarget(text) → Workbench draft / existing insert path
```

Selection text should populate `context.selectionText` when menu opens (today PluginAiActions uses segment target/source — **prefer passing real selection** only if props can be extended **without** changing invoke envelope fields; if invoke context already has `selectionText`, set it from DOM selection string while keeping other fields).

### Consistency repair

```text
scan (client):
  inputs: term source string, new target, segments[] (loaded)
  output: { segmentId, ordinal, before, after }[] where source contains term
          and targetText !== newTarget (normalize per presenter rules)

apply:
  for each selected:
    segment.updateTarget { segmentId, targetText: after, expectedRevision }
    on conflict → mark row failed; continue or stop (document in implement)
```

No `consistency.*` Engine methods.

### Plugins

```text
plugin.list / install / enable-disable / permission.review / grant / deny / revoke
plugin.permission.audit.list
panel: issuePluginPanelSession / bridge.call / revoke — unchanged
```

Presentation maps `PluginCapabilityRequestView[]` → G7 rows; unknown/null → 未知 + honesty when Tier 3 / unenforceable capabilities.

## Selection menu interaction contract

| Event | Behavior |
| --- | --- |
| mouseup / selectionchange with non-collapsed range in editable source/target | open menu if AI enabled && !composing && range length ≥ 1 |
| compositionstart | close menu; suppress open |
| Escape | close; focus editor |
| scroll / segment change | close or reposition; prefer close for simplicity |
| AI settings.enabled false | never open |
| click outside | close |

## Consistency trigger contract

Prefer **one** primary trigger to avoid spam:

1. **Explicit**: user applies term translation from `TermList` / term row action → scan → toast if n>0.
2. Optional secondary: manual “相关译法” from term stack — only if wiring is cheap.

Do not toast on every keystroke. Debounce scans. Cap listed rows (e.g. 200) with residual “仅显示已加载段”.

## CSS / token discipline

- New rules in `styles/30-surfaces/ai.css` and `plugins.css` under `@layer surfaces`.
- Import from `styles/index.css`.
- Neutralize obsolete `.ai-control-surface` layout in mega `styles.css` when replaced (prefix legacy or delete dead).
- `PluginsPanel.css`: retarget to tokens; remove decorative gaps/shadows when touching.
- Popover elevation: only on selection menu / transient layers (A4 exception), not permanent plates.

## Insights dual-host

- `PluginsPanel` remains under Insights plugins tab.
- Workbench hosts selection menu + consistency UI.
- AI control remains Spine surface `ai-control`.

## Trade-offs

| Choice | Why | Cost |
| --- | --- | --- |
| Keep tab ids providers/batch/usage | Less churn in state/tests | i18n labels carry design names |
| Plugin-only selection menu if no built-in RPC | Expression-only honesty | G-01 built-ins residual |
| Client consistency scan | No Engine method | Limited to loaded segments |
| Sequential updateTarget apply | Existing mutate path | Slower bulk; partial failure UX needed |
| Host bar outside iframe | Plugin cannot remove it | Already architecture; CSS only |
| Reuse GroundingInspector | Phase 4 investment | Preview context may be residual on control page |
| Extract ai components | Matches Phase 5–6 pattern | Larger file touch set |

## Rollback

- Expression-only: revert renderer/CSS/i18n on branch; no DB/schema migration.
- Keep `PluginAiActions` / `PluginPanelHost` public props stable.
- Feature flags not required.

## Risk register

| Risk | Mitigation |
| --- | --- |
| Grounding preview args mismatch | Copy LiveAssistantPanel invoke literally |
| Selection menu steals IME | composition guard + tests |
| selectionText wrong in invoke | Extend PluginAiActions optional `selectionText` prop **only if** invoke context field already exists (it does) |
| Bulk apply revision races | Per-row expectedRevision; refresh segment after success |
| PluginsPanel 1.7k LOC regression | Extract table/row; do not rewrite install state machine |
| CSS dual sources | Scope `.ai-ortho` / `.plugins-ortho` |
| Toast spam | Single toast id; only on term apply |
| Over-budget false positive | Only gate when budget + usage numbers both known |
