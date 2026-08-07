# Design — Phase 5 Project surfaces

## Boundaries

| Layer | In | Out |
| --- | --- | --- |
| Renderer presentation | Home 35/65, cards, E2 tabs, Setup 30/70 + Stepper + groups, Insights E3 + overview actions + panel extracts, surface CSS, i18n | Engine algorithms, new contracts |
| App / shell | Existing mode routing; optional small hooks for VT identity / overview navigation callbacks | New surfaces, settings rewrite |
| Utils | Keep `project-home-utils` pure; optional presentational pure helpers | Template secret stripping rule changes |
| IPC | Existing project lifecycle methods only | New methods / preload fields |

## Current baseline (evidence)

- `ProjectHome.tsx`: left `project-home-nav` + `project-home-content`; tabs `projects|search|templates|recycle`; inline `ProjectCard`, `ProjectsView`, dialogs; CSS mostly in `styles.css` (~`.project-home-*`).
- `SetupView.tsx`: `setup-wizard-shell`, `wizard-steps` buttons, three-step form, `project.create` / `createFromTemplate` + `project.batchImport` + empty rollback.
- `ProjectInsightsPage.tsx`: horizontal `project-insights-tabs` (12 entries), large inline panels, mounts asset/discussion/task/plugin panels.
- Motion: `hooks/useViewTransition.ts` kinds `"surface" | "panel"`; `styles/03-motion.css` surface-root seam wipe; Band/Index `view-transition-name: none`.
- Spec: `.trellis/spec/frontend/electron-workbench.md` §Project Lifecycle Desktop Surface.

## Target architecture

```text
App (mode: home | setup | workspace)
├── ProjectHome (orchestrator: loadHome, mutations, dialogs)
│   ├── CompositionRail (35%) — brand + inert field + summary + refresh
│   ├── HomeChrome (65% head) — title, restore archive, new project
│   ├── HomeTabList §E2 — projects | search | templates | recycle
│   ├── ProjectsPane — lifecycle segmented + ProjectCard grid + pagination
│   ├── SearchPane — GlobalSearchPanel host
│   ├── TemplatesPane
│   └── RecyclePane
├── SetupView (orchestrator: options load, create, import)
│   ├── CompositionRail (30%) — brand + summary (locales, file count)
│   ├── Stepper §E5 (01 项目 / 02 配置 / 03 文件)
│   └── WizardPanel (70%) — step forms / import progress
└── ProjectInsightsPage (orchestrator: loadData, mutations, pending dialogs)
    ├── InsightsTabList §E3 (grouped vertical)
    └── panels/* (overview, files, analysis, reimport, archive, history, …)
        + existing Asset/Alignment/Interop/Task/Discussion/Plugins mounts
```

### Suggested paths

```text
apps/desktop/src/renderer/
  ProjectHome.tsx
  SetupView.tsx
  ProjectInsightsPage.tsx
  components/project/
    CompositionRail.tsx          # shared 35%/30% plate language
    HomeTabList.tsx
    ProjectCard.tsx
    ProjectsPane.tsx
    TemplatesPane.tsx
    RecyclePane.tsx
    Stepper.tsx                  # §E5 reusable
    WizardGroups.tsx             # frame+micro title groups (or inline)
    InsightsTabList.tsx          # §E3
    insights/
      OverviewPanel.tsx
      FilesPanel.tsx
      AnalysisPanel.tsx
      ReimportPanel.tsx
      ArchivePanel.tsx
      HistoryPanel.tsx
      insightsShared.tsx         # Metric, Definition, UnavailableState, formatters
  styles/30-surfaces/
    project-home.css
    setup.css
    insights.css
```

Keep App imports stable (`ProjectHome`, `SetupView`, `ProjectInsightsPage` paths). Colocate `*.test.ts(x)` next to pure helpers / tab keyboard if extracted.

## Layout contracts

### Project home 35/65

```css
.project-home-shell {
  display: grid;
  grid-template-columns: minmax(240px, 35%) minmax(0, 65%);
  /* fill surface slot; no 230px nav column */
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0; /* seams via border/rule */
}
.project-card { view-transition-name: none; }
.project-card[data-opening] { view-transition-name: project-identity; }
```

- Tabs: height ~40px, section type, selected under-edge Active Axis (`ActiveAxis variant="chip"` or CSS under-edge consistent with design tokens).
- Composition rail: no interactive project list; refresh + last loaded time at bottom.

### Setup 30/70

```css
.setup-wizard-shell {
  display: grid;
  grid-template-columns: minmax(200px, 30%) minmax(0, 70%);
}
.wizard-stepper { /* vertical list, 36px rows */ }
.wizard-content { max-width: 720px; }
.wizard-group { /* --frame plate + --t-micro title */ }
```

- Stepper current: left axis + `--text-1`; done: check; future: `--text-2`.
- Left rail excluded from step transitions (`view-transition-name: none`).

### Insights vertical tabs

```css
.project-insights-main {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  /* or tablist + content flex */
}
.insights-tablist { /* --frame + right rule */ }
.insights-tablist [role="tab"][aria-selected="true"] {
  /* shade + ActiveAxis left */
}
.insights-tab-group-label { /* --t-micro, non-interactive */ }
```

## Data flow (unchanged RPC)

```text
Home load:
  project.list → project.get + project.analytics.get (per item, existing)
  project.template.list
  recycle.list

Home open:
  ProjectCard → resolve document → onOpen(projectId, documentId, …)
  optional: startViewTransition + data-opening

Setup:
  template/qa/pipeline/ai/analysis lists
  project.create | project.createFromTemplate
  project.batchImport → onCreated | diagnostics + rollback empty

Insights:
  document.list, project.analytics.get, history.list, analysis.profile.list
  analysis.run / analysis.run.get
  reimport preview/apply, batchImport, recycle, archive.export
  child panels own their existing invokes
```

### Props preservation

```ts
// ProjectHome
interface ProjectHomeProps {
  onCreate(): void;
  onOpen(
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ): Promise<void>;
}

// SetupView
interface SetupViewProps {
  onCreated(projectId: string, documentId: string): Promise<void>;
  onCancel?(): void;
}

// ProjectInsightsPage — keep existing; optional additive:
interface ProjectInsightsPageProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
  onOpenDocument(documentId: string): Promise<void>;
  onOpenProject(projectId: string, documentId?: string): Promise<void>;
  onReturnHome(): void;
  // Optional only if parent already can route — do not require for AC residual:
  onOpenQa?(): void;
  onOpenAiControl?(): void;
}
```

## View Transition strategy

| Transition | Approach |
| --- | --- |
| Home → workspace | Prefer extend `useViewTransition` with kind `"project-open"` **or** reuse `"surface"` + card `project-identity` name |
| Card FLIP | `data-opening` only on the clicked card; clear in `transition.finished` / finally |
| Masthead receive | If `Masthead` brand plate can set `view-transition-name: project-identity` when entering workspace **without** breaking Phase 2, do it; else residual |
| Wizard steps | CSS class / `data-wizard-dir` on content; left rail static; no full-page wipe |
| Reduced motion | Existing prefers-reduced path: run update without VT |

No new npm deps. Electron/Chromium View Transitions only.

## Overview action binding

| Block | Preferred action | Fallback |
| --- | --- | --- |
| Progress / documents matrix | Open first/selected document in workbench (`onOpenDocument`) | Files tab |
| TM / match bands | Open workbench (document) — filter only if Workbench already accepts external filter state | Files tab + residual |
| QA blockers | `onOpenQa` if parent wires QA surface | Notice + open document / files |
| AI contribution | `onOpenAiControl` if parent wires | Residual link text without dead button |
| Analysis stale | Banner + `analysis.run` | — |
| Recent activity | Focus history tab | — |

Never show vanity charts without an action or explicit residual note in implement residual list.

## Trade-offs

| Choice | Pros | Cons | Decision |
| --- | --- | --- | --- |
| Extract panels vs restyle monolith | Maintainability, AC12 | More files | **Extract** insights + home cards/panes |
| Perfect FLIP vs layout-first | Design signature | Masthead coupling risk | **Layout-first**; FLIP best-effort |
| Left-rail fake asset totals | Visual match to mock | Dishonest | **Honest available data only** |
| New overview navigation props | Clean actions | Parent churn | Additive optional props; fallbacks required |
| Migrate CSS out of styles.css | Layer discipline | Diff noise | New surface CSS files + import; leave unused legacy rules if safe |

## Rollback

- Layout regressions: restore previous shell class structure behind same component exports; git revert surface CSS files.
- FLIP issues: remove `project-identity` names; keep surface transition.
- Insights extract break: re-export panels from single file temporarily without behavior change.
- Never roll back Engine; renderer-only.

## Risks

| Risk | Mitigation |
| --- | --- |
| `styles.css` size / specificity wars | Prefer `styles/30-surfaces/project-home.css` etc.; increase specificity with shell-scoped roots |
| Opening project without documents | Keep existing error `home.noActiveDocuments` |
| Stepper a11y | `ol`/`list` + `aria-current="step"`; do not use horizontal tabs for steps |
| Horizontal insights tabs CSS leftover | Delete or neutralize old tab strip rules when vertical mounts |
| Performance: N× analytics on home list | Keep existing pattern (already N gets); do not add more fan-out |
| i18n volume | Batch keys with `home.*` / `setup.*` / `insights.*` prefixes |

## Test plan (design-level)

- Unit: any new pure formatters; Stepper/TabList keyboard if non-trivial; keep `project-home-utils.test.ts`.
- Component: ProjectCard lifecycle menu calls handlers; Stepper renders 01/02/03 spacing; InsightsTabList groups.
- Manual: create project 3 steps; open card; archive/recycle; insights overview actions; locale switch.
- Typecheck: `apps/desktop` renderer project.
