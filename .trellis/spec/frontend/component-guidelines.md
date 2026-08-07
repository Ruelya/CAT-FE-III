# Component Guidelines

## Component Shape

Use named function components with an explicit props interface. Keep a
component responsible for rendering and event orchestration for one surface;
move reusable pure transformations to a typed utility and test them there.
Current examples are `Workbench`, `SuggestionsPanel`, `DocumentPreview`, and
`AssistantPanel` in `src/renderer/Workbench.tsx` and
`src/renderer/AssistantPanel.tsx`.

```tsx
interface AssistantPanelProps {
  activeSegment: Segment | undefined;
  onUseTarget(target: string): void;
}

export function AssistantPanel({
  activeSegment,
  onUseTarget,
}: AssistantPanelProps) {
  // local presentation/reducer state and callbacks
}
```

Callbacks are named by intent (`onUseTarget`, `onNavigate`,
`onModeChange`). A child reports an action; the owner decides how to persist or
navigate. Avoid passing an entire engine client or an untyped payload through
the component tree.

## Controlled Interaction

Inputs are controlled by React state. Textarea saves use the existing
debounce/flush path in `Workbench.tsx`; target confirmation uses the shared
IME guard in `workbench-utils.ts`. Do not update counts or revisions locally:
replace local segment state with the engine response.

Use the existing Lucide icon package for tool buttons. Icon-only buttons must
have a visible tooltip/title and an accessible `aria-label`; text commands may
use icon plus text where the command is not universally recognizable.

## Accessibility And Layout

- Use semantic headings, regions, tabs, menu roles, and labels already used by
  the workbench components.
- Preserve keyboard focus when Suggestions/Preview changes between
  `docked`, `collapsed`, and `maximized`. Collapsed content remains mounted,
  becomes `inert`/`aria-hidden`, and focus moves to the expand control.
- Keep CJK text in the existing `.cjk` styling and avoid fixed widths that
  cause glyph clipping at 1250x744.
- A component must not rely on exact pixel strings; geometry tests use numeric
  tolerances because Windows DPI can return fractional CSS values.

## Composition

Prefer small, unframed layout sections over nested decorative cards. Reuse
`FilterButton`, panel mode controls, and the shared preview separator instead
of copying nearly identical controls. Keep transient toasts and busy states
visible and keyboard reachable.

### ORTHO Workbench extracts (Phase 2–3)

Workbench chrome and grid pieces live under
`src/renderer/components/workbench/`:

| Component | Responsibility |
| --- | --- |
| `Masthead` | Identity plate, document switcher, Run QA / Export only |
| `FilterRail` | Exactly three groups: status chips · match selector · issue nav |
| `ActiveAxis` | Single decorative `[data-axis="active"]` marker |
| `DocumentMatrix` | Document-ordinal matrix beside the segment grid |
| `SegmentGrid` | `role="grid"`, virtual spacers, batch bar, shared row measure, roving host |
| `SegmentRow` | Plate/seam row: lamp, source/target, seam rail, selection, inline QA |
| `SegmentStatusLamp` | Eight shape-coded presentational states + localized names |
| `TagCapsule` | Atomic pair capsules; hover/focus pair highlight; Alt move intent |
| `SeamActionRail` | 24px source/target seam: best match · comment · More (hover/focus-within) |
| `BatchBar` | Multi-select 36px plate; intent-only batch actions |
| `InlineQaStrip` | Existing QA/tag findings under plates; Locate / reason-required Ignore |

Presentational leaves receive explicit props/callbacks; `Workbench.tsx` owns
filter state, drafts, leave-guard registration, Matrix projection, axis
residence, filter-scope ID expansion, and batch/QA RPC adapters. Pure row
mappers live in `segmentTypes.ts` (`deriveLampState`, tag/finding maps).

Executable contracts:

- Phase 2 chrome:
  [ORTHO Workbench Skeleton](./electron-workbench.md#ortho-workbench-skeleton-phase-2)
- Phase 3 grid:
  [ORTHO Segment Grid and Cells](./electron-workbench.md#ortho-segment-grid-and-cells-phase-3)

## Avoid

- No direct `window.translunar.invoke` calls scattered through presentational
  leaf components; route engine work through the owning page/workbench action.
- No `dangerouslySetInnerHTML` for source or target text.
- No CSS `display: none` to animate a collapsible panel.
- No hidden click targets without labels, and no disabled control that silently
  drops a pending-save error.
