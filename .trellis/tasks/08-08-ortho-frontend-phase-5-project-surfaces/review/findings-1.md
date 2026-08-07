# Findings round 1

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-5-project-surfaces`
- branch: `implement/ortho-frontend` (working tree; not yet committed as task-only commit)
- head_sha: `ba4046e9f47486172526f1fb242a958404edecba` (+ unstaged Phase 5 renderer changes)
- round: 1
- scope: fast pass — open/create/archive contracts + critical a11y only

## need_verify
- required: false

### Verify mission
- none — desktop typecheck and scoped vitest already green on this tree; static review covers AC lifecycle contracts.

## issues

### F1
- severity: nit
- files: `apps/desktop/src/renderer/components/project/HomeTabList.tsx`, `apps/desktop/src/renderer/ProjectHome.tsx`, `apps/desktop/src/renderer/ProjectInsightsPage.tsx`
- problem: Home/Insights tabs implement roving `tabIndex` + keyboard correctly, but tabs are not fully linked to panels via `aria-controls` / `aria-labelledby` (insights panel has `role="tabpanel"` id only).
- minimal_fix: Optional polish — set `aria-controls` on each tab to the panel id; set `aria-labelledby` on panel to selected tab id. Not required for Phase 5 closeout.
- status: wontfix

### F2
- severity: nit
- files: `apps/desktop/src/renderer/ProjectInsightsPage.tsx` (~718 LOC)
- problem: Orchestrator is well under prior ~1677 LOC and primarily mounts extracts, but slightly above ideal ≤~600.
- minimal_fix: Further extract confirm dialog / load helpers if desired later. Not a product-function issue.
- status: wontfix

## assumptions
- Cross-project TM/term/corpus totals remain unavailable without new RPC — left rail shows honest project/template/recycle counts only (accepted residual).
- Optional `onOpenQa` / `onOpenAiControl` are not wired from parent; overview shows residual copy instead of dead buttons (accepted residual).
- Workspace path picker omitted on Setup step 1 (accepted residual).
- Home project cards omit save-as-template / export-archive overflow items (not previously required invent-new); archive export remains on Insights Archive panel via `project.archive.export`.
- `project-open` FLIP: card `[data-opening]` → `view-transition-name: project-identity`; Masthead `.identity` receives same name — best-effort VT path present; surface transition used for open.
- Engine / contracts / preload / main: no changes in this diff.

## evidence (static + commands)

### Commands run
| Command | Result |
| --- | --- |
| `pnpm run typecheck` (apps/desktop) | exit 0 |
| `pnpm exec vitest run src/renderer/project-home-utils.test.ts src/renderer/components/project --passWithNoTests` | 3 files / 8 tests passed |

### Contract spot-check (AC4 / AC9 / AC10)
| Path | Status |
| --- | --- |
| Home open → `onOpen(projectId, documentId, …)` via VT | preserved |
| Create chrome → `onCreate` / tutorial `tutorial-target-create` | preserved |
| `project.setLifecycle` archive/restore confirm | preserved |
| `recycle.delete` / `recycle.restore` / `recycle.purge` (+ name confirm) | preserved |
| `project.template.create/update/delete` + `cloneTemplateDefinition` | preserved |
| `project.archive.restore` (home) / `project.archive.export` (insights) | preserved |
| Setup `project.create` / `createFromTemplate` + `batchImport` + empty rollback | preserved |
| `setup.languagesMustDiffer` on step 1 | preserved |
| Insights all prior tab ids (12) in grouped E3 list | preserved |
| Overview metric sections with decision action or residual | present |
| Confirm danger: confirm not autofocused (`autoFocus={!action.danger}`) | preserved pattern |

### Layout / expression (AC1–3, 5–8, 11–13)
- Home: 35/65 composition rail + horizontal E2 tabs with counts; plate/seam cards; D6 empty; non-FAB refresh.
- Setup: 30/70 + §E5 Stepper 01/02/03; step 2 reuse/quality/automation groups; tutorial import id kept.
- Insights: vertical grouped tablist (~180px CSS); extracts under `components/project/insights/*`.
- i18n: new Phase 5 keys present en + zh in `messages.ts`.
- Surface CSS: `project-home.css`, `setup.css`, `insights.css` imported from styles index.

## residual_risks (accepted)
1. No cross-project TM totals on home rail (no new RPC).
2. QA/AI overview deep-links residual until parent wires optional callbacks.
3. Path picker not on Setup step 1.
4. Perfect FLIP quality depends on Chromium VT + simultaneous named elements; reduced-motion path still opens workspace.
5. Tab↔panel ARIA linkage incomplete (nit F1).

## summary_for_orchestrator
Phase 5 project surfaces land expression-only with preserved open/create/archive/recycle/template/search Engine and parent contracts. Desktop typecheck and project-related unit tests are green. No open blocker or major. Accepted residuals match plan (TM totals, optional QA/AI callbacks, path picker). Verdict **green / ready_for_closeout** — no fix or verify mission required; proceed to closeout (commit on `implement/ortho-frontend` when ready).
