# ORTHO Phase 2 — Workbench skeleton design

## Design intent

Make the existing Workbench read as the ORTHO skeleton through a bounded presentation refactor. The implementation extracts three local components, mounts the existing Document Matrix beside the real grid, and keeps the current editor state, commands, persistence, and contracts as the source of truth. Legacy classes may coexist where that reduces risk; the new components own the Phase 2 structure and semantics.

## Boundaries and new files

### `components/workbench/ActiveAxis.tsx`

A single reusable visual residence marker. It receives the current residence (filter-chip or segment-row), an anchor/measurement target, and visibility state from Workbench-owned focus/active state. It renders one `[data-axis="active"]` node, uses `--signal`, is `aria-hidden`, and does not own focus or keyboard behavior.

The component must not render one axis per possible residence. The parent computes one winning residence:

1. active segment row, when a segment is active;
2. otherwise the active/current status chip, when a rail chip has focus/selection;
3. hidden when Workbench has no applicable focus residence.

The implementation may position the node with an anchor ref, CSS custom properties, or a portal/local overlay, provided it stays Workbench-scoped and preserves the target's normal focus outline. Reduced-motion preferences must disable or shorten movement transitions.

### `components/workbench/Masthead.tsx`

A presentational Workbench header with explicit data and callbacks. It receives the current workspace/project projection, active document, document list, and existing Run QA/Export/document-selection handlers. It owns only layout, accessible labels, current-document indication, and action presentation. It does not load documents, persist drafts, search globally, or introduce new commands.

The identity plate uses the existing `brand-plate`/45° bevel treatment as its only masthead bevel. The data fields are real projection values: project name, source/target locale pair, and document/file count. The document switcher must expose a native or equivalently accessible list/menu, current state, and disabled/busy semantics while an existing load/save transition is running.

### `components/workbench/FilterRail.tsx`

A compact, non-wrapping rail containing exactly three logical groups:

- status chip group for All, Untranslated, Draft, Confirmed, Issues;
- match-range selector;
- issue navigation.

It receives authoritative counts, selected status, match presentation state, issue position/list state, and existing callbacks (`setSegmentFilter`/equivalent and `navigateIssue`). It does not own Engine requests. Match options other than `All` are rendered as deferred/non-operative presentation choices for Phase 2; selecting them must not claim a filter or send a fabricated request. Tagged/commented remain reachable only through an existing compact secondary path/command if needed and are not promoted to a fourth group.

Search, Exact TM decoration, command/undo/redo/comment strip, and Confirm are intentionally absent. Existing keyboard handlers remain at their current owner.

## Workbench wiring

`Workbench.tsx` is changed surgically in three places:

1. Replace the existing `<header className="app-bar">` block with `<Masthead ... />` inside the current Workbench surface. Pass through existing action and navigation handlers rather than recreating them.
2. Replace the contents of the current `editor-toolbar` block with `<FilterRail ... />`. Keep surrounding focus/keyboard ownership and legacy layout hooks only where they do not create duplicate controls.
3. Wrap the editor region toward the `.wb` grid using classes already defined in `styles/30-surfaces/workbench.css` where practical. Place `DocumentMatrix` immediately left of the segment grid, keep the grid as the sole scroll owner, and leave Stack panels, plugins dock, leave guard, drafts, and existing panel composition untouched.

A small Workbench CSS addition is allowed only if the existing stylesheet cannot express the required matrix placement, rail overflow behavior, ActiveAxis residence, or scrollbar hiding. Avoid broad theme or geometry rewrites.

## Data flow and contracts

### Masthead flow

`workspace projection → Workbench derived metadata → Masthead`:

- project name comes from the current real project projection;
- locale pair comes from source/target locale projection;
- document/file count comes from the available workspace document projection;
- active document and available documents come from the existing workspace state;
- selection calls the existing save-before-navigation/workspace-loading path.

Loading or unavailable values use existing truthful loading/empty states. No hardcoded sample project copy or invented count is introduced.

### FilterRail flow

`SegmentCounts + current SegmentFilter + open issues → FilterRail`.

The five primary chips use the same authoritative count and filter state already consumed by the editor. The selected chip is exposed through `aria-pressed`/equivalent current semantics. Issue controls call `navigateIssue` with the existing ordered issue list and retain F8/Shift+F8 handling at its current keyboard owner. A zero-issue list renders disabled navigation and a truthful zero position.

The match selector is deliberately renderer-only in Phase 2. Its state is local/presentation state (default `all`), and unsupported choices are marked deferred or disabled. No match field is appended to an Engine request, no score is synthesized, and the exact-TM concept remains available via existing Stack/command behavior outside the rail.

### DocumentMatrix flow

`editorRows/segments + open QA issues + virtual window + active segment + grid scroll/resize → DocumentMatrix props`.

- `segmentStates`: construct document-order entries from known editor rows/segments. Overlay open QA issues as `error`; otherwise map known segment states in the required precedence `error > untranslated > draft > confirmed`. Do not infer a state for unloaded/unknown positions; use the Matrix's neutral/loading representation if its API supports it.
- `activeIndex`: derive the 0-based document index of the active segment. Use an absent/neutral value while there is no active segment rather than selecting a guessed index.
- `viewportRange`: derive from the editor's current virtual-window indices and visible grid window. Recompute after grid scroll, filter/virtual-window changes, and resize.
- `onNavigate(index)`: resolve the target segment in document order, clear an incompatible status/text projection when required to make it visible, invoke existing `setActiveId`, then use the existing grid `scrollIntoView`/scroll path. This is navigation intent only: it must not mutate a segment and must not forcibly blur or focus an active translation textarea.

The grid's scroll container remains the only scroll state. Matrix bracket dragging/seeking calls the same navigation/scroll helper instead of maintaining a parallel Matrix offset. Subscriptions/effects are renderer-local and are invalidated on authoritative update, QA refresh, reconnect, document replacement, and document switch.

## ActiveAxis behavior

Workbench computes one `axisResidence` state from focus and active-segment state. When both are present, the active segment row wins. `ActiveAxis` receives that one residence and an anchor geometry; the parent renders one node or none. Existing per-chip/per-row pseudo-elements or duplicate `data-axis` markers are removed/disabled in the Workbench surface so the singleton invariant is observable in the DOM.

The axis is decorative and `aria-hidden`; target controls retain their own focus ring, pressed state, and keyboard behavior. Position changes honor `prefers-reduced-motion`. The shell-owned Phase 1 Index Spine marker is outside this Workbench singleton boundary and is not duplicated by this phase.

## Styling and layout

Prefer existing `.wb` and Workbench surface classes from `styles/30-surfaces/workbench.css`. The layout should reserve a narrow Matrix column adjacent to the grid, keep the rail as a single horizontally reachable non-wrapping row, and preserve Stack/preview/instrument regions. The grid scrollbar is hidden with browser-compatible scrollbar styling (`scrollbar-width` and Chromium/WebKit scrollbar rules) while `overflow` and keyboard scroll behavior remain unchanged. Any new selectors are local to Workbench and do not alter global shell geometry.

## Trade-offs

- **Extract rather than redesign:** lowers regression risk and preserves command/focus ownership, at the cost of temporarily retaining some legacy class names.
- **Deferred match buckets:** gives the design a stable control without inventing data or changing contracts; unsupported options must be explicit until a later phase supplies real projections.
- **Matrix as a view over grid scroll:** avoids two competing scroll positions and preserves accessibility/programmatic scrolling, while requiring careful synchronization with virtualized rows.
- **One axis with precedence:** satisfies the singleton invariant and makes simultaneous chip/row focus deterministic; the row's more specific active context wins.

## Error, loading, and rollback behavior

- Masthead and Matrix show existing loading/empty/error states when projections are unavailable; never substitute decorative metadata or guessed segment states.
- A failed Matrix projection must not block grid editing. Keep the grid usable and expose the Matrix as unavailable/neutral using its existing failure presentation.
- If Matrix navigation cannot resolve an index, leave the current editor target unchanged and do not issue a mutation.
- Preserve leave-guard/persistence before any document/project/surface replacement.
- Rollback is bounded: revert the Workbench component imports/mounts and any Phase 2-local CSS, restoring the prior header/toolbar/matrix-free layout. Do not revert or modify engine, persistence, command, contract, or preload changes because this phase must not make any.

## Verification focus

Verify component rendering with real project/document data, keyboard reachability and shortcut continuity, exactly three rail groups, Matrix hydration and navigation across virtual windows, scrollbar visual hiding with active scrolling, one-axis DOM count, no page overflow at supported widths, and green typecheck/renderer tests. Keep leave-guard, drafts, plugins dock, Stack, QA/TM, Preview, and global-search behavior in the regression set.
