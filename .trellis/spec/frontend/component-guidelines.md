# Component Guidelines

## Component Shape

Use named function components with an explicit props interface. Keep a
component responsible for rendering and event orchestration for one surface;
move reusable pure transformations to a typed utility and test them there.

Source-backed examples:

- Surfaces: `surfaces/Workbench.tsx`, `surfaces/ProjectHome.tsx`,
  `surfaces/QaReview.tsx`, `surfaces/ExportReview.tsx`,
  `surfaces/Templates.tsx`, `surfaces/RecycleBin.tsx`,
  `surfaces/GlobalSearch.tsx`, `surfaces/ProjectInsights.tsx`
- Workbench pieces: `workbench/TargetEditor.tsx`, `workbench/SegmentGrid.tsx`,
  `workbench/TmExactPanel.tsx`, `workbench/PanelChrome.tsx`,
  `workbench/DocumentSwitcher.tsx`, `workbench/BatchImportSummary.tsx`
- Shell: `shell/AppChrome.tsx`, `shell/RecoveryDialog.tsx`,
  `shell/EngineStatusBanner.tsx`, `shell/ConfirmDialog.tsx`,
  `shell/ModalDialog.tsx`

```tsx
interface TargetEditorProps {
  draft: string;
  disabled: boolean;
  onDraftChange(text: string): void;
  onConfirm(): void;
  onCompositionChange(isComposing: boolean): void;
}

export function TargetEditor({
  draft,
  disabled,
  onDraftChange,
  onConfirm,
  onCompositionChange,
}: TargetEditorProps) {
  // controlled textarea + IME composition boundary
}
```

Callbacks are named by intent (`onDraftChange`, `onConfirm`, `onNavigate`).
A child reports an action; the app controller decides how to persist or
navigate. Avoid passing an entire engine client or an untyped payload through
the component tree.

## Controlled Interaction

Inputs are controlled by React state. Target drafts flow through
`SaveCoordinator` (`state/save-coordinator.ts`): debounced journal write,
debounced `segment.updateTarget`, generation-stable `flush()` before leave or
confirm. Target confirmation must use the shared IME guard in `lib/ime.ts`.

Do not update counts or revisions locally: replace local segment state with the
engine response.

## Icons (Phosphor)

### Convention: Phosphor for new renderer icons

**What**: All new renderer iconography uses `@phosphor-icons/react`.

**Why**: P0 design consensus standardized on Phosphor; the prior Lucide
convention is obsolete for renderer work. Mixing icon sets fragments visual
weight and hit-area treatment.

**Example**:

```tsx
import { House, SealCheck, Export } from "@phosphor-icons/react";

<button type="button" aria-label="Home" title="Home">
  <House size={18} weight="regular" />
</button>
```

Icon-only buttons must have a visible tooltip/title and an accessible
`aria-label`; text commands may use icon plus text where the command is not
universally recognizable.

**Don't**: import new icons from `lucide-react` under `src/renderer`.

## Appearance Tokens (Light / Advanced Brown / No Glass)

### Convention: Fixed P0 appearance

**What**: Light canvas is the only default. Interactive accent is advanced
brown (`--color-accent` family). Semantic success/warning/error tokens are
independent of the accent. Appearance is not user-configurable in P0.

**Why**: Prevents dark-first flash, theme-settings scope creep, and
low-contrast glass panels that fail professional CAT density.

**Rules**:

- Tokens live in `tokens.css`; component CSS lives in `styles.css`.
- Fixed constants live in `state/appearance.ts` (`APPEARANCE_THEME = "light"`,
  `APPEARANCE_ACCENT = "advanced-brown"`). Never write theme/accent to shell
  settings or `localStorage`.
- Solid colors define surfaces. Alpha may be used for conventional shadows
  only.
- `backdrop-filter` and `-webkit-backdrop-filter` are forbidden (no frosted
  glass / translucent panel material).
- Initial HTML/`color-scheme: light` must match `--color-canvas` before React
  mounts.
- Brand ribbon colors are for the brand mark only; interactive controls use
  advanced brown.
- Honor `prefers-reduced-motion: reduce` (collapse motion to effectively
  immediate).

**Related**: `state/appearance.test.ts` asserts required token vars, light/
brown defaults, semantic separation, and absence of glass CSS.

## Document switcher landmarks

`workbench/DocumentSwitcher.tsx` is the Workbench multi-document control:

- Root: `data-testid="document-switcher"`
- Select: `id="document-switcher-select"` and
  `data-testid="document-switcher-select"`
- Options use stable Engine document IDs as values; labels are Engine names
- Active document is identified; pending switch disables the control
- Keyboard reachable with a programmatic label (“Document”)

Tests and E2E must prefer `document-switcher-select` over ambiguous name
matchers that also hit Recycle “Document” rows. See
[project-lifecycle.md](./project-lifecycle.md).

## Accessibility And Layout

- Use semantic headings, regions, dialogs, lists/tables, and labels before
  recreating them with ARIA.
- Exact-TM (and similar) collapsed content remains mounted, becomes
  `inert`/`aria-hidden`, and focus moves to the expand control. Do not use
  `display: none` to animate a collapsible panel.
- Keep CJK text readable; avoid fixed widths that clip glyphs at compact
  viewports.
- A component must not rely on exact pixel strings; geometry tests use numeric
  tolerances because Windows DPI can return fractional CSS values.
- Visible `:focus-visible` treatment is required; selected-row styling must not
  remove focus affordance.
- Recovery and destructive confirms are modal dialogs: initial focus on Cancel
  (safest non-destructive action), focus trap, Escape is non-destructive,
  restore prior focus on close. Purge uses distinct permanent-action copy from
  restore/delete.

## Composition

Prefer small, unframed layout sections over nested decorative cards. Reuse
panel chrome (`workbench/PanelChrome.tsx`) and shared shell chrome rather than
copying nearly identical controls. Keep transient busy/error states visible and
keyboard reachable.

Surfaces receive data and command callbacks from the app controller. Presentational
leaves must not call `window.translunar` directly.

## UI Copy

Keep labels concise and functional. Do not add filler subtitles, guiding
microcopy, or contrast-copy constructions using “不是”.

## Avoid

- No direct `window.translunar.invoke` calls scattered through presentational
  leaf components; route engine work through `lib/rpc.ts` and controller
  commands.
- No `dangerouslySetInnerHTML` for source or target text.
- No CSS `display: none` to animate a collapsible panel.
- No hidden click targets without labels, and no disabled control that silently
  drops a pending-save error.
- No glass material, dark-default scaffold, or new Lucide icons in the renderer.
