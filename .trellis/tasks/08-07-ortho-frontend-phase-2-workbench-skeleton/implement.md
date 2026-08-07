# ORTHO Phase 2 — Implementation checklist

## Ordered implementation steps

### 1. Add the `ActiveAxis` component

- [ ] Create `components/workbench/ActiveAxis.tsx` with a small, typed residence/anchor API and one `[data-axis="active"]` render path.
- [ ] Compute the Workbench residence in the parent with deterministic precedence: active segment row first; otherwise the focused/current status chip; otherwise hidden.
- [ ] Preserve target focus rings and keyboard semantics; mark the axis `aria-hidden`, use `--signal`, and honor `prefers-reduced-motion`.
- [ ] Remove or neutralize any competing Workbench `data-axis="active"`/axis pseudo-element created by the old chip/row markup. Do not touch the shell-owned Phase 1 Index Spine marker.
- [ ] Add/adjust focused renderer coverage for the singleton count and row-over-chip precedence.

### 2. Extract and mount `Masthead`

- [ ] Create `components/workbench/Masthead.tsx` as a presentational component with explicit project/document metadata, action callbacks, busy/error props, and accessible switcher semantics.
- [ ] Replace the `<header className="app-bar">` block in `Workbench.tsx` with `Masthead` inside the existing Workbench surface slot.
- [ ] Derive identity fields from real workspace projection data (project name, source/target locales, and document/file count); do not add decorative “Craft Contract” copy or a fabricated fallback.
- [ ] Preserve existing Run QA, Export, document-loading, leave-guard, and draft-persistence handlers and focus return behavior.
- [ ] Remove the permanent masthead global-search control while preserving `Ctrl+Shift+K` → `GlobalSearchPanel` and `Ctrl+K` → command palette.
- [ ] Confirm the identity plate is the sole masthead 45° bevel and that no permanent duplicate bevel/control is introduced.

### 3. Extract and mount `FilterRail`

- [ ] Create `components/workbench/FilterRail.tsx` with exactly three logical groups: five status chips, match selector, and issue navigation.
- [ ] Pass authoritative `SegmentCounts`/filter state through the existing filtering callbacks; expose pressed/current state and preserve `Alt+1..5`/IME behavior at the existing keyboard owner.
- [ ] Add the match selector vocabulary (`All`, `101%`, `100%`, `95–99%`, `85–94%`, `75–84%`, `50–74%`, `No match`, `MT-only`). Keep `All` as the only live Phase 2 projection; mark unsupported buckets deferred/non-operative and send no Engine field.
- [ ] Wire previous/next issue controls to existing `navigateIssue`, preserve F8/Shift+F8, and render truthful `n/N` plus a disabled zero-issue state.
- [ ] Remove in-document search, Exact TM decorative strip, command/undo/redo/comment strip, and rail Confirm button. Keep their existing keyboard, command, Stack, row, and drawer paths intact.
- [ ] Keep the rail non-wrapping and horizontally reachable at supported widths without clipping or overlap.

### 4. Mount `DocumentMatrix`, hide the grid scrollbar, and wire the viewport

- [ ] Import/render the existing `DocumentMatrix` to the left of the segment grid when segments exist; use existing `.wb`/`workbench.css` layout classes where practical.
- [ ] Derive document-order `segmentStates` from editor rows/segments and open issues with precedence `error > untranslated > draft > confirmed`; leave unknown/unloaded positions neutral/loading rather than guessed.
- [ ] Derive `activeIndex` from the active segment and `viewportRange` from virtual-window/visible-window indices. Update on editor scroll, filtering/virtual-window changes, and resize.
- [ ] Connect Matrix `onNavigate` to the existing `setActiveId` and scroll-into-view helpers. Resolve incompatible filter/text projections as the existing navigation path requires; do not mutate business data or steal an active translation textarea's focus.
- [ ] Keep the editor grid as the sole scroll owner. Hide its native scrollbar in Chromium/WebKit and Firefox while retaining wheel, touchpad, keyboard, programmatic, and accessibility scrolling. Matrix bracket seeking must call the same grid scroll path.
- [ ] Leave leave-guard, drafts, plugins dock, Stack panels, Suggestions, Preview, and panel composition unchanged.
- [ ] Add focused renderer/layout checks for Matrix hydration, navigation across virtual windows, synchronization after segment/QA updates/document changes, scrollbar visibility rules, and no page-level overflow.

### 5. Run light typecheck and renderer tests

- [ ] Run the repository's existing frontend/renderer typecheck command (normally `pnpm typecheck`, or the package-local equivalent if scripts are scoped).
- [ ] Run the existing renderer test command covering the Phase 1 baseline (normally the renderer package test script; preserve the 175-test baseline) plus the focused Workbench/Masthead/FilterRail/Matrix/ActiveAxis tests.
- [ ] Review failures for contract or behavior regressions rather than weakening assertions; do not modify business contract files to make the UI compile.
- [ ] Perform a targeted visual/runtime pass at 1250×744, 1680×942, and 1920×1080, checking no overlap, clipping, horizontal page overflow, or renderer console errors.

### 6. Record the Phase 2 implementation note

- [ ] Update `docs/design-ii/09-implementation.md` with a brief Phase 2 implementation record covering the shipped Masthead, three-group FilterRail, Matrix/grid scroll ownership, ActiveAxis singleton, deferred match-selector decision, and validation status.
- [ ] Keep the record scoped to Phase 2; do not claim Phase 3 cell geometry, Phase 4 Stack, dark-theme bridge, or contract/engine work.
- [ ] Ensure the task manifests remain real spec/context entries and document any unresolved implementation risk in the task report rather than inventing completion.

## Validation commands

Use the repository's existing package scripts and keep runs scoped to the renderer/frontend where possible:

```text
pnpm typecheck
pnpm test -- renderer
```

If the workspace uses package-local script names, run the equivalent existing typecheck and renderer test scripts and record the actual commands/results in the implementation report. Add the focused Workbench tests to the same renderer invocation. A successful validation must include the existing 175-test Phase 1 baseline (or an explicitly documented test-count change unrelated to this phase).

## Risk points and mitigations

- **Focus/shortcut regression:** Masthead extraction can remove the old search owner. Preserve global shortcut listeners and return focus to a surviving Workbench element; verify IME guards.
- **Leave-guard bypass:** document switching must call the existing save-before-navigation path, never a new direct load call.
- **Virtualized Matrix drift:** derive all Matrix state/range from the grid's existing virtual and scroll measurements; never add an independent scroll position. Test filtered and off-window issue navigation.
- **Incorrect state coloring:** overlay only known open issues and authoritative segment states; leave unknown positions neutral/loading.
- **Contract creep:** match selector stays renderer-only and deferred; no Engine/RPC/generated-contract edits are permitted.
- **Axis duplication:** render the axis once from parent state and inspect the DOM in chip, row, and simultaneous-focus states.
- **Layout regressions:** prefer existing `.wb` surface classes, keep the rail non-wrapping, and check all three supported desktop sizes.
- **Scrollbar accessibility:** hide only the visual scrollbar; retain the scroll container's overflow and keyboard/programmatic behavior.

## Completion gate

All in-scope acceptance criteria in `prd.md` must be demonstrably satisfied, typecheck and renderer tests must be green, and the implementation record must be updated before handing the task to review. No `task.py start` is run by this planning worker.
