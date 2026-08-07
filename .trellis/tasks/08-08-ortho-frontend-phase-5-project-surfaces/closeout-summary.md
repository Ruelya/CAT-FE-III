# Closeout summary — ORTHO Phase 5 Project surfaces

**Task:** `.trellis/tasks/08-08-ortho-frontend-phase-5-project-surfaces`  
**Branch:** `implement/ortho-frontend`  
**Review:** `review/findings-1.md` — green / ready_for_closeout (nits wontfix)

## What shipped

Expression-only rewrite of the three project-class surfaces:

1. **Project Home** — 35/65 composition rail + content; horizontal §E2 tabs
   (projects / search / templates / recycle) with counts; plate/seam
   `ProjectCard` grid; §D6 empty; non-FAB refresh; archive restore chrome;
   `project-open` View Transition (`data-opening` → `project-identity` with
   Masthead `.identity` receive).
2. **Setup wizard** — 30/70 rail + §E5 Stepper (01/02/03); step 2 semantic
   groups (reuse / quality / automation); create + batchImport + empty
   rollback + language-must-differ preserved; tutorial anchors kept.
3. **Project Insights** — vertical grouped §E3 tab list (all 12 prior tab
   ids); overview decision actions / residuals; panels extracted under
   `components/project/insights/*`; orchestrator ~718 LOC (was ~1677).

Supporting:

- Shared primitives: `CompositionRail`, `HomeTabList`, `InsightsTabList`,
  `Stepper`, home panes, surface CSS
  (`project-home.css` / `setup.css` / `insights.css`).
- i18n en + zh for Phase 5 chrome.
- No Engine / contracts / preload / main changes.
- Validation (review evidence): `pnpm run typecheck` green; vitest
  `project-home-utils` + `components/project` — 8 tests passed.

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | Project Lifecycle pointer + new **ORTHO Project Surfaces (Phase 5)** 7-section contract (layouts, signatures, VT, overview residuals, wrong/correct). |
| `.trellis/spec/frontend/directory-structure.md` | `components/project/**` tree + `30-surfaces` project CSS files; orchestrator import stability. |
| `.trellis/spec/frontend/component-guidelines.md` | Phase 5 extract table + executable contract links. |

## Suggested commit

**Subject:**

```text
feat(ui): ORTHO Phase 5 project home, setup stepper, insights tabs
```

**Body:**

```text
Expression-only project surfaces for desktop:

- ProjectHome: 35/65 composition rail, §E2 horizontal tabs, plate/seam
  cards, project-identity view transition on open
- SetupView: 30/70 rail + §E5 Stepper, grouped configuration step, preserved
  create/batchImport/diagnostics contracts
- ProjectInsightsPage: §E3 vertical grouped tabs, overview actions with
  residual fallbacks, extract panels under components/project/insights

Surface CSS in styles/30-surfaces/{project-home,setup,insights}.css.
i18n en+zh for new chrome. No engine/contracts/preload changes.

Specs: electron-workbench Phase 5 contract; frontend directory + component
guidelines for project extracts.

Task: 08-08-ortho-frontend-phase-5-project-surfaces
```

**Omit from commit:** `.grok/**` dirt (e.g. `.grok/agents/trellis-plan.md`).

**Include:**

- `apps/desktop/src/renderer/ProjectHome.tsx`
- `apps/desktop/src/renderer/SetupView.tsx`
- `apps/desktop/src/renderer/ProjectInsightsPage.tsx`
- `apps/desktop/src/renderer/components/project/**`
- `apps/desktop/src/renderer/components/workbench/Masthead.tsx` (identity VT)
- `apps/desktop/src/renderer/i18n/messages.ts`
- `apps/desktop/src/renderer/styles.css` (legacy neutralize as needed)
- `apps/desktop/src/renderer/styles/index.css`
- `apps/desktop/src/renderer/styles/30-surfaces/{project-home,setup,insights,workbench}.css`
- `docs/design-ii/09-implementation.md` (if intentional phase note)
- `.trellis/tasks/08-08-ortho-frontend-phase-5-project-surfaces/**`
- `.trellis/spec/frontend/{electron-workbench,directory-structure,component-guidelines}.md`

## Residual risks (accepted)

1. No cross-project TM/term/corpus totals on home rail (no new RPC).
2. Overview QA/AI deep-links residual until parent wires `onOpenQa` /
   `onOpenAiControl`.
3. Workspace path picker omitted on Setup step 1.
4. Perfect card→masthead FLIP quality depends on Chromium VT timing;
   reduced-motion path still opens workspace.
5. Tab↔panel `aria-controls` / `aria-labelledby` linkage incomplete (nit F1).
6. Insights orchestrator slightly above ideal ≤~600 LOC (~718; F2 wontfix).
7. Home card overflow may omit save-as-template / export-archive (export
   remains on Insights archive panel).

## Closeout policy

- Spec updates applied per `trellis-update-spec`.
- Task **not** archived here (Orchestrator / finish-work).
- **No commit** from this worker; Orchestrator commits on
  `implement/ortho-frontend` and merges per autoloop git policy.
