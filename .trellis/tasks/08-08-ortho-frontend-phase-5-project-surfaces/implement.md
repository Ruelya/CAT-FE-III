# Implement — Phase 5 Project surfaces

## Branch

`implement/ortho-frontend` (task.branch). Do not merge master/main from this worker.

## Ordered checklist

### 0. Prep

- [ ] Confirm branch `implement/ortho-frontend` and Phase 0–4 shell/workbench extracts exist.
- [ ] Read `docs/design-ii/screens/project.md` + `09-implementation.md` §期5 + `05-components.md` §E2/E3/E5.
- [ ] Skim existing RPCs in `ProjectHome` / `SetupView` / `ProjectInsightsPage` — **do not change invoke names/payloads**.
- [ ] Note CSS anchors in `styles.css` (`.project-home-*`, `.setup-*`, `.project-insights-*`) for migration.

### 1. Shared primitives

- [ ] Add `components/project/Stepper.tsx` (§E5): props `steps: { id, label }[]`, `current`, `onSelect?` (only completed/current navigable if desired).
- [ ] Add `components/project/CompositionRail.tsx` (brand plate slot + children + optional footer).
- [ ] Add `components/project/HomeTabList.tsx` (§E2 horizontal) and `InsightsTabList.tsx` (§E3 vertical + groups).
- [ ] Reuse `ActiveAxis` from workbench where geometry matches; else token-equivalent under-edge/left edge.
- [ ] Surface CSS files: `project-home.css`, `setup.css`, `insights.css` imported from styles index.

### 2. Project home rewrite (R1–R3)

- [ ] Restructure `ProjectHome` to 35/65 grid; remove `project-home-nav` vertical four-button column.
- [ ] Move tabs to content-top §E2 with counts (`projects total`, `templates length`, `recycle total`).
- [ ] Extract `ProjectCard` + panes (`ProjectsPane`, `TemplatesPane`, `RecyclePane`); keep search via `GlobalSearchPanel`.
- [ ] Restyle cards: plate/seam, band echo, 4px progress, mono metrics, overflow menu, archived saturate.
- [ ] Empty state §D6; refresh meta on rail; restore archive control in chrome.
- [ ] Wire open path: set `data-opening` + `startViewTransition` / `useViewTransition` before `onOpen`; clear attribute after.
- [ ] Optional: masthead `project-identity` receive name — only if low-risk.
- [ ] Preserve all mutations: lifecycle, recycle, templates, archive restore, pagination, lifecycle segmented control.

### 3. Setup wizard rewrite (R4)

- [ ] Restructure to 30/70: left rail composition + Stepper; right form panel.
- [ ] Replace sticky step buttons with `Stepper` 01/02/03 labels (i18n).
- [ ] Step 2: three groups (reuse / quality / automation) with frame + meta consequences.
- [ ] Remove decorative workspace chips / wasteful side info column.
- [ ] Keep validation, create, batchImport, diagnostics, rollbackEmptyProject, openSuccessfulDocument.
- [ ] Step change motion: content-only; left static.
- [ ] Ensure tutorial target ids (e.g. `tutorial-target-import`) still present if tutorials reference them.

### 4. Insights vertical tabs + overview + extracts (R5)

- [ ] Extract `insights/*` panels + shared formatters from `ProjectInsightsPage.tsx`.
- [ ] Replace horizontal tabs with grouped `InsightsTabList` (map all existing tab ids).
- [ ] Overview: add action footers per major block; stale analysis banner; keep real analytics fields only.
- [ ] Wire optional `onOpenQa` / `onOpenAiControl` if App/WorkbenchPages already can accept; else fallbacks.
- [ ] Confirm child panels still receive same props and refresh hooks.
- [ ] Target orchestrator size ≪ 1677 LOC.

### 5. i18n + a11y

- [ ] Add/adjust en+zh keys: tab counts pattern, empty states, stepper, group titles, overview actions, archived badge, wizard meta.
- [ ] Audit new icon-only buttons for aria-label/title.
- [ ] Keyboard: home tabs ←→; insights tabs ↑↓; stepper activation.
- [ ] Confirm dialogs: danger focus policy unchanged.

### 6. Cleanup + validation

- [ ] Neutralize obsolete CSS for old home nav / horizontal insights tabs when unused.
- [ ] Run unit tests + typecheck (commands below).
- [ ] Manual AC walkthrough AC1–AC14.
- [ ] Document residuals (FLIP incomplete, missing overview deep-links, asset totals) in task notes if any.

## Validation commands

```bash
# From repo root
cd apps/desktop

# Utils + new colocated tests
pnpm exec vitest run src/renderer/project-home-utils.test.ts
pnpm exec vitest run src/renderer/components/project --passWithNoTests

# Broader renderer smoke if time
pnpm exec vitest run src/renderer --passWithNoTests

# Typecheck desktop packages
pnpm run typecheck
```

Manual:

1. Cold start → home 35/65; tabs work; create project.
2. Setup three steps; language-must-differ; import success opens workspace.
3. Card open → workspace; archive/recycle/restore archive.
4. Insights: vertical groups; every overview block has action; analysis run/stale.
5. Locale en/zh on new strings.
6. `prefers-reduced-motion`: open project still works without stuck VT state.

## Risk points

| Point | Watch |
| --- | --- |
| Megafile edits | Extract first, then restyle call sites |
| `styles.css` collisions | Scope under `.project-home-shell` / `.setup-wizard-shell` / `.project-insights-main` |
| Search mark parsing | Only `parseSearchSnippet` |
| Template definition clone | Do not bypass `cloneTemplateDefinition` |
| App mode transitions | Keep `setMode("setup"|"home")` and `openWorkspace` |
| Tutorial anchors | Preserve import button id |
| Insights tab id rename | Prefer keep ids; only regroup presentation |
| Performance home N+1 | Do not add extra per-card RPCs |

## Definition of done (implementer)

- AC1–AC14 met or residual explicitly listed (FLIP / deep-link / asset totals only).
- No engine/contracts/preload changes.
- en+zh strings present.
- Orchestrators + extracts compile; utils tests green.
- `research_needed` remains empty unless hard blocker (report Orchestrator).
