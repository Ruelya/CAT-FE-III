# Closeout summary — Frontend rebuild P0 vertical slice

**Task:** `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice`  
**Branch:** `task/08-08-frontend-rebuild-p0-vertical-slice`  
**Review verdict:** `green_for_closeout` (`review/findings-3.md`)  
**Date:** 2026-08-08

## What shipped

End-to-end Electron renderer rebuild as a Workbench-first vertical slice over the existing main/preload/`DesktopApi`/Engine boundary:

1. **Shell & boot** — Light-first paint (`tokens.css` + HTML `color-scheme`), `BootGate`, Engine status banner, reconnect generation safety, Recovery dialog (Recover/Discard, keyboard trap, non-destructive Escape).
2. **Session routing** — Versioned identity-only storage (`translunar.renderer.session.v1`), pure resolvers for Welcome vs Project Home vs Workbench, open-project → Import or first Engine document.
3. **Workflow surfaces** — Welcome, Project Home, Create Project, Import Document, Workbench, QA Review, Export Review (no roadmap placeholders).
4. **Editing safety** — `SaveCoordinator` (draft generations, journal debounce, generation-stable `flush`, journal-error without Engine rollback), IME guards (`lib/ime.ts`), confirm-after-flush, exact-TM panel with collapse.
5. **QA / Export** — Engine-backed issue list/jump, `qa.gate.check` before picker/export, real export path on pass.
6. **Visual system** — Light default, advanced-brown accent, solid surfaces, no glass/`backdrop-filter`, Phosphor icons, reduced-motion support.
7. **Quality evidence** — 144 unit tests green; real-Engine Playwright 2/2 (export file + resume, Project Home Open); typecheck / ESLint / Prettier / desktop build green.

### Primary code areas

- `apps/desktop/src/renderer/{shell,routes,surfaces,workbench,state,lib,test}/`
- `apps/desktop/src/renderer/{App,main,tokens,styles}.*`
- `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts` (+ fixtures)
- Dependency: `@phosphor-icons/react` (desktop package + lockfile)
- Removed obsolete renderer monolith (root `Workbench.tsx` and related pre-rebuild surfaces/CSS/E2E)

## Spec updates (`.trellis/spec/`)

| Path | Change |
| --- | --- |
| `frontend/directory-structure.md` | Authoritative P0 renderer tree; stale monolith paths retired |
| `frontend/component-guidelines.md` | Phosphor icons; light/brown/no-glass tokens; IME/save ownership; UI copy rules |
| `frontend/state-management.md` | Session routing, SaveCoordinator, multi-record recovery, reconnect |
| `frontend/hook-guidelines.md` | `use-app-controller`, IME composition contract |
| `frontend/quality-guidelines.md` | P0 test matrix, Phosphor, static glass/Lucide audit |
| `frontend/type-safety.md` | P0 unions, `lib/rpc` / `toUiError` |
| `frontend/electron-workbench.md` | P0 layout banner; session/save/IME contracts; Phosphor; stale path notes |
| `frontend/index.md` | Pre-dev checklist for layout, save, appearance |

## Residual risks

| ID | Severity | Notes |
| --- | --- | --- |
| RR1 / F13 | minor / accepted | Manual AC17: real OS Chinese/Japanese IME composition + unexpected live Engine process kill under `pnpm dev:desktop` not executed. Automated composition lifecycle, dirty reconnect rehydrate, and real-Engine workflow are green. **Reopen** if real IME allows update/confirm/focus during composition, or live Engine exit loses dirty draft / remounts Workbench unsafely / re-enables mutations before hydration / console errors. |
| Git hygiene | process | Working tree is broad (delete+add). Orchestrator must stage **task-scoped** product + spec + task artifacts carefully before commit/merge. |
| Optional test depth | non-blocking | Dedicated deferred `segment.confirm` and QA-active reconnect unit assertions noted in review; not product defects. |
| Post-P0 features | scope | AI Control, Assistant, full i18n catalog, multi-doc manager, Suggestions/Preview triad, Task Package UI not in this slice; Engine contracts for some remain documented for later return. |

## Suggested commit message

**Subject:**

```text
feat(desktop): P0 renderer vertical slice (workbench rebuild)
```

**Body:**

```text
Replace the wiped Electron renderer with a Workbench-first light shell over
the existing DesktopApi/Engine boundary.

- Surfaces: Welcome, Project Home, Create, Import, Workbench, QA, Export
- Session identity v1, draft recovery, SaveCoordinator flush generations
- IME-safe confirm, exact TM, gate-enforced export, relaunch resume
- Phosphor icons; light + advanced-brown tokens; no glass
- Unit (144) + real-Engine Playwright P0 E2E; update frontend code-specs

Residual: manual AC17 real-OS IME / live Engine kill waived as minor risk.
```

## Closeout notes

- Do **not** archive the task in this step; Orchestrator archives after merge
  per finish-work policy.
- Do **not** commit from closeout; Orchestrator owns git.
- No further Verify mission required unless RR1 is revoked or a real regression
  appears.
