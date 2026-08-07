# Findings round 1

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-4-stack-preview`
- branch: `implement/ortho-frontend`
- head_sha: `3ba57713bde80c1d0882863068a67c3e1cf2bede` (uncommitted Phase 4 work in working tree)
- round: 1
- reviewer: trellis-review
- evidence_run:
  - `pnpm typecheck` in `apps/desktop` — **exit 0** (contracts build + electron + renderer + e2e tsc)
  - `pnpm test -- src/renderer` in `apps/desktop` — **40 files / 230 tests pass** (includes Stack `wordDiff` + `StackPanel` tests)

## need_verify
- required: false

### Verify mission
- none — desktop typecheck and renderer unit suite already run in this review pass with clean results. No open judgment blocked on runtime UI.

## issues

### F1
- severity: nit
- files: `.grok/agents/trellis-plan.md`
- problem: Working tree includes an unrelated one-line agent effort change (`max` → `xhigh`) that is outside Phase 4 product scope.
- minimal_fix: Exclude this file from the Phase 4 commit (or restore before commit). Do not package it with Stack/PreviewDock delivery.
- status: open

### F2 (residual — accepted)
- severity: minor
- files: `docs/design-ii/09-implementation.md` (implementation residual section); layout host still `workbench-layout` flex, not `.wb`
- problem: Design-preferred `.wb` + `data-stack=collapsed|overlay` host is **not** mounted. Collapse width uses legacy `--suggestions-rail` (48px) rather than design 40px rail on `.wb[data-stack=collapsed]`.
- minimal_fix: none for this task — AC14 / implement checklist allow deferral when dual-pane still ships. Residual already written in `09-implementation.md` 期4 实现记录.
- status: wontfix

### F3 (residual — accepted)
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/PreviewDock/PreviewDock.tsx` (`tryPopOut`)
- problem: Pop-out is best-effort `window.open` + hash; not a full second BrowserWindow session sync. On block, control disables with honest aria-label.
- minimal_fix: none — AC10 / A6 allow residual; honesty path present.
- status: wontfix

### F4 (residual — accepted)
- severity: nit
- files: `MatchCard.tsx` (hardcoded `100%` tier)
- problem: Exact TM UI always shows 100% score tier; no fuzzy score engine (PRD A1).
- minimal_fix: none — documented residual; no invented fuzzy engine in scope.
- status: wontfix

## assumptions
- Uncommitted tree on `implement/ortho-frontend` is the deliverable under review (no commit SHA for Phase 4 product files yet).
- Phase 2–3 components under `components/workbench/` are out of scope except wiring; no intentional rework of SegmentGrid scroll ownership was required and none was observed in the diff.
- QA tab removal is intentional; inline QA (Phase 3) remains the path; `runQa` no longer flips a stack tab (tab state deleted).

## AC checklist (static + tests)

| AC | Judgment | Notes |
| --- | --- | --- |
| AC1 Matches+Terms co-visible | met | `StackPanel` mounts both `sec--matches` and `sec--terms`; unit test asserts no tablist |
| AC2 No tab strip / no QA in Stack | met | Tab enum/`SuggestionsPanel` removed from Workbench |
| AC3 Single collapse control | met | One collapse button; maximize peer removed from stack; test asserts no maximize label |
| AC4 Ctrl+9 + inert/focus | met (code) | `editor.toggleSuggestions` → `togglePanelCollapsed`; body `inert`/`aria-hidden`; focus transfer refs present |
| AC5 Word-level del/ins | met | `wordDiff` LCS + `MatchCard` `<del>`/`<ins>`; CSS line-through/underline, no color blocks; unit tests pass |
| AC6 Term rows + forbidden | met | `TermRow` chips + `data-forbidden` / `--err-ink` |
| AC7 Assistant drawer | met | `AssistantDrawer` bottom bar; expanded shell flex ~50% with matches min-height 180px |
| AC8 Grounding honesty | met | `GroundingInspector` only with real `PromptBundle`; LiveAssistant wired to shared component |
| AC9 Preview under grid | met | `PreviewDock` still under editor column after SegmentGrid; follow + PDF path preserved |
| AC10 Pop-out residual | met | Best-effort open; blocked → disabled + i18n reason |
| AC11 Hooks preserved | met | matches/terms/insert/applyMutation/preview prefs still Workbench-owned |
| AC12 en+zh | met | New keys in `messages.ts` both catalogs |
| AC13 Tests | met | `wordDiff.test.ts` + `StackPanel.test.tsx`; broader renderer suite green |
| AC14 `.wb` residual | met | Deferred + documented in implement notes / `09-implementation.md` |

## residual_risks (accepted, do not block green)
- `.wb` CSS-grid host + overlay mode for narrow widths remain dead CSS until a later layout task.
- Pop-out is not multi-window product polish.
- Collapse rail width may be 48px (legacy token) vs design 40px until `.wb` remount.
- PDF toolbar still has a pre-existing hard-coded English “Page N of M” string (not introduced as a Phase 4 contract break; full i18n polish optional).

## summary_for_orchestrator
Phase 4 Stack dual-pane + PreviewDock extract is **green** for closeout. Workbench drops tabbed SuggestionsPanel for StackPanel (co-visible matches/terms, single collapse, AI drawer, no QA tab), extracts PreviewDock with follow/highlight and honest pop-out residual, shares GroundingInspector with LiveAssistant, adds en/zh strings and stack CSS for dual-pane flex. Documented residuals (`.wb` host, fuzzy 100%, pop-out thin path) match PRD fallbacks and do not block. **Evidence already collected:** desktop `pnpm typecheck` clean; `pnpm test -- src/renderer` 230/230. Only open nit: exclude unrelated `.grok/agents/trellis-plan.md` from the product commit. No fix cycle required for product code; proceed **closeout → commit on `implement/ortho-frontend` → merge when lifecycle allows**.
