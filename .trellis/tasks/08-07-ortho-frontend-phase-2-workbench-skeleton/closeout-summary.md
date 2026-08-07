# Closeout summary — 08-07-ortho-frontend-phase-2-workbench-skeleton

## What shipped

ORTHO frontend Phase 2 workbench skeleton on branch `implement/ortho-frontend`
(Phase 0+1 already on branch; Phase 2 is presentation extraction only):

| Area | Delivery |
| --- | --- |
| **Masthead** | `components/workbench/Masthead.tsx` — real project name / locale pair / file count; sole `brand-plate` 45° bevel; document switcher via save-before-navigation; Run QA + Export; no permanent global-search control (`Ctrl+Shift+K` / `Ctrl+K` preserved) |
| **FilterRail** | `components/workbench/FilterRail.tsx` — three groups only: status chips (All / Untranslated / Draft / Confirmed / Issues) · match selector · issue navigation. Removed rail search, Exact TM strip, command strip, Confirm button |
| **Match selector** | Full vocabulary; **only `all` live**; other buckets deferred/disabled; no Engine/RPC field |
| **DocumentMatrix** | Mounted left of segment grid; `segmentStates` / `activeIndex` / `viewportRange` in **document ordinal** space; sole scroll owner remains `.segment-grid` with visually hidden scrollbar; wheel/seek/keyboard forward to grid |
| **Matrix a11y** | Native roving tabindex (one `tabIndex={0}`); real DOM focus + `data-focus`; Enter → exact ordinal; Escape → grid; no illegal `aria-activedescendant` on navigation landmark |
| **ActiveAxis** | `components/workbench/ActiveAxis.tsx` — Workbench singleton `[data-axis="active"]`; row over chip precedence; competing Workbench axis pseudo-elements disabled |
| **Focus restore** | `restorePaletteOwnerFocus` in `workbench-utils.ts` — palette dismiss restores connected invocation owner or editor-region fallback |
| **Leave-guard** | Document switch and surface leave keep `persistAllSegments` / `onRegisterLeaveGuard` path |
| **Layout host** | Intentional legacy flex host retained; `.wb` / `data-stack` migration deferred (documented in `docs/design-ii/09-implementation.md`) |
| **E2E selectors** | Stale Workbench rail Confirm selectors rewritten to active-textarea `Control+Enter` |
| **i18n** | Matrix title / legend / landmark / range copy for both supported locales |

### Quality loop

- Rounds 1–5 findings under `review/findings-*.md`; verify report `review/verify-1.md`
- Final disposition: `review/findings-5.md` — **ready_for_closeout**
- Open severities: `blocker 0 / major 0 / minor 0 / nit 0`
- Branch head (pre-closeout product fix base): `9499896` plus uncommitted Phase 2 + task artifacts

### Evidence (focused)

```text
pnpm --filter @translunar/desktop typecheck   # clean
pnpm --filter @translunar/desktop test        # 198/198 across 32 files
git diff --check                              # exit 0
```

Full Electron Workbench E2E / live geometry at 1250×744, 1680×942, 1920×1080
not re-run on this machine (`target/debug/translunar-engine.exe` unavailable);
accepted residual per findings-5 / verify-1.

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | New **ORTHO Workbench Skeleton (Phase 2)** contract (ActiveAxis, FilterRail, Matrix ordinals, leave-guard, palette focus); global-search masthead button claim updated (shortcut-only after Phase 2) |
| `.trellis/spec/frontend/component-guidelines.md` | Point at workbench extracts + skeleton contract |
| `.trellis/spec/frontend/directory-structure.md` | `components/workbench/*` and `restorePaletteOwnerFocus` placement |
| `.trellis/spec/frontend/quality-guidelines.md` | Roving-focus / illegal ARIA gotcha; E2E selector hygiene after control removal |

Optional thrash note: `review/lessons-phase-2-quality-loop.md`.

## Acceptance (honest)

| Criterion (prd summary) | Status |
| --- | --- |
| Typecheck + renderer tests green (Phase 1 baseline preserved / expanded) | **pass** (198/198 desktop Vitest) |
| Masthead real data, one bevel, no permanent search control | **pass** (static / unit) |
| Ctrl+Shift+K / Ctrl+K + focus return | **pass** (code path + unit helper) |
| Document switcher leave-guard | **pass** (code path; live E2E residual) |
| FilterRail three groups; deferred match | **pass** |
| DocumentMatrix ordinal projection + sole scroll owner | **pass** (unit + host projection) |
| ActiveAxis singleton ≤ 1 | **pass** (unit) |
| No contract/engine/preload/persistence edits | **pass** |
| Supported viewport geometry / live axe | **residual** — needs Engine binary |

## Residual risks (do not block closeout)

1. Live Electron Workbench suite and viewport geometry unobserved without Engine binary.
2. Selective E2E re-run recommended when binary is available: Matrix scroll/seek, focus-return, ActiveAxis count, document-switch persistence, axe, 1250/1680/1920.
3. Legacy flex host intentional; `.wb`/`data-stack` still deferred to Stack/preview phase.
4. Match buckets remain presentation-only until a later match-projection phase.

## Suggested commit (Orchestrator)

**Subject:**

```text
feat(ui): ORTHO Phase 2 workbench skeleton (Masthead, FilterRail, Matrix, ActiveAxis)
```

**Body:**

```text
Ship the Phase 2 presentation layer inside the existing Workbench surface.

Extract Masthead, FilterRail (three groups with deferred match buckets), and
ActiveAxis; mount DocumentMatrix in document-ordinal space with the segment
grid as sole scroll owner and a visually hidden scrollbar. Preserve
leave-guard document switching, command-palette focus restore, and Ctrl+K /
Ctrl+Shift+K without a permanent masthead search control. Fix Matrix roving
focus (no aria-activedescendant on navigation) and update E2E confirm paths
to Control+Enter.

Capture durable contracts under .trellis/spec/frontend (ORTHO skeleton
section, component/directory/quality notes). Implementation record updated
in docs/design-ii/09-implementation.md. Task quality loop closed at
findings-5 (ready_for_closeout).

Validation: pnpm --filter @translunar/desktop typecheck; test 198/198.
Live Electron/viewport residual accepted until Engine binary is available.

No Engine, generated-contract, preload, main, or persistence changes.
```

**Paths to include (this closeout wave + product):**

- `apps/desktop/src/renderer/Workbench.tsx`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/components/workbench/Masthead.tsx` (new)
- `apps/desktop/src/renderer/components/workbench/FilterRail.tsx` (new)
- `apps/desktop/src/renderer/components/workbench/FilterRail.test.tsx` (new)
- `apps/desktop/src/renderer/components/workbench/ActiveAxis.tsx` (new)
- `apps/desktop/src/renderer/components/workbench/ActiveAxis.test.tsx` (new)
- `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx`
- `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx` (new)
- `apps/desktop/src/renderer/workbench-utils.ts`
- `apps/desktop/src/renderer/workbench-utils.test.ts`
- `apps/desktop/src/renderer/i18n/messages.ts`
- `apps/desktop/src/renderer/styles/10-components/matrix.css`
- `apps/desktop/src/renderer/styles/30-surfaces/workbench.css`
- `apps/desktop/tests/e2e/workbench.spec.ts`
- `docs/design-ii/09-implementation.md`
- `.trellis/spec/frontend/electron-workbench.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/tasks/08-07-ortho-frontend-phase-2-workbench-skeleton/` (full task dir)

**Do not include** unrelated dirt (other task dirs, release artifacts, accidental agent/skill edits outside this task).

## Verdict

**Ready for Orchestrator to commit and merge** branch `implement/ortho-frontend`
after the closeout commit. No open blocker/major. Do not archive here
(finish-work / Orchestrator policy).
