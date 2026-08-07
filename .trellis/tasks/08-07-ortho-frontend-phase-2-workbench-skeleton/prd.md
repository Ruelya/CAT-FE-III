# ORTHO Phase 2 — Workbench skeleton

## Goal

Deliver the ORTHO Phase 2 presentation layer inside the existing Workbench surface while preserving the current editor workflow and all existing contracts. The phase replaces the Workbench masthead and rail presentation, adds the live Document Matrix beside the segment grid, and expresses focus with one Workbench-scoped Active Axis. It is a surgical UI extraction, not a full redesign.

## Scope

### In scope

#### 1. Workbench Masthead

- Replace the current Workbench `<header className="app-bar">` presentation with a `Masthead` component mounted inside the Workbench surface slot.
- Render one identity plate containing real current-workspace data:
  - project name;
  - source locale → target locale pair;
  - document/file count (and document count metadata where the projection provides it).
- The identity plate is the sole 45° bevel treatment in this masthead. Do not add a second permanent bevel, slogan, year, or decorative project copy.
- Render an accessible document switcher showing the active document, the available workspace documents, and the current-document state. Selecting another document must use the existing save-before-navigation/workspace-loading path.
- Keep Run QA and Export actions in the masthead and preserve their existing handlers, busy states, disabled states, and error semantics.
- Remove the permanent global-search field/button/command control from the masthead layout. Keep `Ctrl+Shift+K` wired to the existing `GlobalSearchPanel`; keep `Ctrl+K` and the existing command-palette path unchanged. Search close/focus return must target a stable remaining Workbench owner.

#### 2. Three-group FilterRail

Replace the current `editor-toolbar` contents with exactly three logical groups, in this order:

1. **Status chips:** All, Untranslated, Draft, Confirmed, Issues. Chips use the authoritative counts and existing filtering path, expose selected/pressed state, and remain keyboard reachable. Tagged/commented remain reachable only through a compact select or existing command path if that access is already available; they must not become additional primary rail groups.
2. **Match filter:** a compact selector with `All`, `101%`, `100%`, `95–99%`, `85–94%`, `75–84%`, `50–74%`, `No match`, and `MT-only` vocabulary.
3. **Issue navigation:** previous/next controls with the existing `navigateIssue` behavior and visible `n/N` position.

Phase 2 match-filter decision: the selector is shipped as presentation state with `All` as the only supported live projection. The remaining values are prepared/deferred and visibly non-operative until a real match-bucket projection exists. The selector must not fabricate scores, counts, row filters, or Engine/RPC fields. Exact-TM behavior remains reachable through its existing Stack/command path; the removed decorative Exact TM rail strip is not recreated.

Remove from the main rail:

- in-document search input;
- Exact TM decorative strip;
- command/undo/redo/comment icon strip;
- Confirm button.

Existing keyboard, command-palette, Stack, row, drawer, and editor paths remain responsible for those behaviors, including `Ctrl+F`/`Ctrl+H`, `Ctrl+Shift+F`, `Ctrl+Z`/`Ctrl+Y`, `Ctrl+M`, and `Ctrl+Enter`.

#### 3. Document Matrix and grid scroll takeover

- Mount the existing `DocumentMatrix` to the left of the segment grid when segments exist.
- Derive document-order `segmentStates` from the editor rows/segments and open issues. Apply state precedence `error > untranslated > draft > confirmed`; do not invent state for unknown/unloaded positions.
- Derive `activeIndex` from the active segment and `viewportRange` from the editor's virtual-window indices plus the visible grid window.
- Pass `onNavigate` through the existing `setActiveId`/scroll-into-view helpers so a Matrix seek updates the active target and the real grid scroll owner. It must not introduce a second scroll state or mutate business data.
- Hide the segment grid's native scrollbar visually while retaining wheel, touchpad, touch, keyboard, programmatic, and accessibility scrolling. The grid remains the actual scroll owner; Matrix navigation drives the same scroll path.
- Keep Matrix state synchronized with authoritative segment/QA updates, filtering or virtual-window changes, resize/scroll events, reconnect/document replacement, and document switching.

#### 4. ActiveAxis singleton

- Add a reusable `ActiveAxis` component and mount one Workbench-surface instance.
- Use `[data-axis="active"]` for the rendered axis and ensure the count is at most one in normal focused Workbench states.
- The primary residences are the focused/current status chip under-edge and the active segment row left edge.
- Residence precedence: when a segment is active, the active segment row owns the axis; otherwise the active filter chip owns it. The axis moves between residences instead of being rendered once per chip or row.
- Use `--signal`, `aria-hidden`, and reduced-motion-safe transitions without replacing normal focus indicators or keyboard semantics. Existing competing Workbench axis pseudo-elements are removed/disabled as part of the extraction.

## Non-goals / out of scope

- Phase 3 cell geometry, segment-cell/row redesign, tag rendering, roving grid, multi-select, or inline QA redesign.
- Phase 4 Stack or full Preview redesign.
- Dark-theme dual-track bridge/reconciliation.
- Full decomposition of all Workbench internals into a ≤400-line split.
- Full match-score/bucket computation, per-segment TM scoring, MT classification, or new Engine/RPC/protocol fields.
- New document-list/count Engine projections, persistence changes, generated-contract changes, preload/main boundary changes, or any business command/contract logic changes.
- Density/zoom redesign or unrelated shell navigation changes.

## Acceptance criteria

- [ ] Typecheck and the existing renderer test suite are green; the Phase 1 baseline of 175 renderer tests remains green.
- [ ] `Masthead` is rendered inside the Workbench surface, uses real project name/locale/document data, has exactly one identity-plate 45° bevel, keeps Run QA and Export handlers, and has no permanent global-search field/button.
- [ ] `Ctrl+Shift+K` still opens `GlobalSearchPanel`, `Ctrl+K` still opens the command palette, and closing either returns focus to a remaining stable Workbench owner.
- [ ] The accessible document switcher marks the current document and selecting another document follows the existing save-before-navigation path without losing drafts.
- [ ] The FilterRail has exactly three logical groups: the five required status chips, the match selector, and issue navigation. It contains no in-document search, Exact TM strip, command/undo/redo/comment strip, or rail Confirm button.
- [ ] Status counts/filtering use authoritative existing projections; issue navigation uses existing `navigateIssue` and shows truthful `n/N`, including a disabled zero-issue state.
- [ ] Match selector renders the specified vocabulary, has the documented Phase 2 deferred behavior, and sends no fabricated match bucket, score, or Engine request field.
- [ ] `DocumentMatrix` is imported and rendered whenever segments are available, receives document-order states, active index, and viewport range, and `onNavigate` reaches the existing active-id/grid-scroll path.
- [ ] The segment-grid scrollbar is visually hidden in supported browsers while wheel/keyboard/programmatic/accessibility scrolling still works.
- [ ] The Matrix viewport bracket tracks editor scroll, virtual-window/filter changes, and resize; Matrix navigation does not create a second scroll position or steal an active translation textarea's focus.
- [ ] In normal focused Workbench states, `[data-axis="active"]` count is ≤ 1; an active segment row wins over an active filter chip, otherwise the chip owns the axis.
- [ ] Leave-guard/draft persistence, plugins dock, Stack panels, Suggestions, Preview, QA/TM, IME handling, global search, and Surface navigation remain reachable and behaviorally unchanged.
- [ ] No business contract file, generated contract, preload/main boundary, Engine, or persistence logic is changed.
- [ ] At supported desktop widths (1250×744, 1680×942, 1920×1080), required Workbench controls do not overlap, clip, or create page-level horizontal overflow.

## Assumptions and decisions

- Existing workspace projection values are authoritative for Masthead identity: current project name, source/target locales, and available document/file count. No decorative fallback such as “Craft Contract” is acceptable; if a value is genuinely unavailable, use the existing loading/unknown presentation rather than invented data.
- Existing editor rows/segments and open-issue projection are sufficient for a renderer-owned, read-only Matrix state projection. Unknown/unloaded positions remain neutral/loading rather than receiving a guessed status.
- The grid remains the sole scroll owner. Matrix seeking is an intent that calls existing active-id and scroll-into-view helpers.
- The active segment row takes ActiveAxis precedence over a focused filter chip because row focus is the more specific Workbench residence. If no segment is active, the current/focused filter chip is the residence.
- Full match buckets are unavailable in this phase. The selector therefore exposes the design vocabulary with `All` live and other options explicitly deferred; no Engine contract is extended. Exact-TM remains reachable through existing non-rail paths.
- Existing leave-guard and `persistAllSegments` behavior is preserved for project/document/surface changes.

## Research needed

[]
