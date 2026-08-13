# Component Guidelines

## Component Shape

Use named function components with an explicit props interface. Keep a
component responsible for rendering and event orchestration for one surface;
move reusable pure transformations to a typed utility and test them there.

Source-backed examples:

- Surfaces: `surfaces/Workbench.tsx`, `surfaces/ProjectHome.tsx`,
  `surfaces/QaReview.tsx`, `surfaces/ExportReview.tsx`,
  `surfaces/Templates.tsx`, `surfaces/RecycleBin.tsx`,
  `surfaces/GlobalSearch.tsx`, `surfaces/ProjectInsights.tsx`,
  `surfaces/AssetHub.tsx`
- Workbench pieces: `workbench/TargetEditor.tsx`, `workbench/SegmentGrid.tsx`,
  `workbench/TmExactPanel.tsx`, `workbench/PanelChrome.tsx`,
  `workbench/DocumentSwitcher.tsx`, `workbench/BatchImportSummary.tsx`,
  `workbench/EditorCommandBar.tsx`, `workbench/EditorPanels.tsx`
- Shell: `shell/AppChrome.tsx` (product title strip), `shell/WindowControls.tsx`,
  `shell/use-window-chrome.ts`, `shell/RecoveryDialog.tsx`,
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

## Appearance Tokens (Light default / Advanced Brown / No Glass)

The full colour, type, space, shape, and motion system is defined in
[design-language.md](./design-language.md). That file is the authority; the
rules below are the component-level obligations that follow from it.

### Convention: Light default, user-adjustable theme and accent seed

**What**: Light canvas is the default. The interactive accent is advanced brown
(`--color-accent` family). Semantic success/warning/error/info tokens are
theme-fixed and never derived from the accent seed. Since P4 the user may
select dark mode and a custom accent seed in Product Settings.

**Why**: Prevents dark-first flash, keeps status meaning stable when a user
re-seeds the accent, and keeps professional CAT density readable.

**Rules**:

- Design tokens live in `tokens.css`. Component CSS lives under `styles/`,
  reached through the single `styles.css` entry point.
- Appearance persists in exactly one versioned renderer key,
  `translunar.renderer.appearance.v1`, parsed by `state/appearance.ts`
  (`{ version: 1, theme, accentSeed }`). Never write theme or accent into
  `ProductShellSettings`, and never introduce a second appearance key.
- The preference is applied before React mounts
  (`appearance-bootstrap.ts`), and a storage write failure stays visible to
  the user rather than being swallowed.
- A custom accent seed must still reach 4.5:1 for on-accent body text and 3:1
  for the focus ring against canvas, surface, and raised. A seed that cannot
  is rejected with a visible reason.
- Surfaces are solid. `backdrop-filter` and `-webkit-backdrop-filter` are
  forbidden. Tokenised modal scrims and bounded state tints are allowed; the
  prohibition is on translucent panel *material*, not on all alpha.
- The first-paint fallback in `index.html` must match `--color-canvas` and
  `color-scheme` for the persisted theme.
- Brand ribbon colours are the brand mark and the `--color-series-*` data
  palette only. They never colour an interactive control.
- Title-strip chrome (`.app-chrome`, `.window-controls*`) uses the same solid
  tokens. Close-active may mix `--color-error` with another token; raw `#000`
  and chrome-only literals are forbidden. Drag/no-drag and platform inset rules
  live in [electron-workbench.md](./electron-workbench.md).
- Honour `prefers-reduced-motion: reduce`: motion tokens collapse to `0ms` and
  view transitions are skipped.

**Related**: `state/appearance.test.ts` asserts required token vars, light and
brown defaults, the surface-ladder lightness deltas, contrast floors, semantic
independence, absence of glass CSS, and the title-strip token rules.
`pnpm ui:audit` enforces the mechanical half at the file level.

## Editor command bar and Asset Hub

### Convention: Registry-driven editor chrome

**What**: Workbench editor actions use `EDITOR_COMMAND_REGISTRY` +
`EditorCommandBar` / `EditorPanels`. Panels call intents on
`use-editor-operations`; they do not invent RPC names or inverse history.

**Why**: Keeps keyboard, overflow, availability, and IME gates consistent.

**Rules**:

- Icon-only or dense controls still need `title`/`aria-label` (Phosphor only).
- Target-affecting panels inherit composition + flush sequencing from the hook.
- Review is a Workbench panel, not a top-level chrome destination.
- Full contracts: [editor-assets.md](./editor-assets.md).

### Convention: Asset Hub is a real project-scoped surface

**What**: `surfaces/AssetHub.tsx` hosts TM, termbase, alignment, corpus,
catalog, and curation with complete empty/loading/error/success states.

**Why**: Placeholder tabs and dead nav violate P2 acceptance.

**Rules**:

- Every displayed section is Engine-backed; no marketing dashboard cards.
- Dense lists/tables with confined scroll; no viewport horizontal overflow.
- Destructive actions use Cancel-first `ConfirmDialog` and stay mounted until
  success/cancel (curation rollback closes only when the controller returns
  true).
- Do not expose TM/TB import controls until a trusted open-dialog filter
  accepts tmx/tbx/csv/tsv (`WP0-TM-TB-IMPORT-FILTER`).

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
- Section switching that behaves like a route uses `<nav>` with `aria-current`.
  `role="tab"` is only for a real tab widget and then requires the complete
  APG pattern: roving `tabIndex`, Arrow, Home, End, `aria-controls`, and a
  named `tabpanel`. A partial tab pattern is worse than a link list.
- Interactive targets are at least 32x32 CSS pixels. A visually smaller
  affordance extends its hit area with padding or a pseudo-element instead of
  shrinking the target.
- Menus follow the APG menu-button pattern: opening moves focus to the first
  enabled item, Arrow/Home/End navigate, and Escape closes and returns focus to
  the trigger.
- A non-modal panel records its opener and returns focus there on close, with a
  stable fallback target when the opener has unmounted.
- Exact-TM (and similar) collapsed content remains mounted, becomes
  `inert`/`aria-hidden`, and focus moves to the expand control. Do not use
  `display: none` to animate a collapsible panel.
- Keep CJK text readable; avoid fixed widths that clip glyphs at compact
  viewports.
- A component must not rely on exact pixel strings; geometry tests use numeric
  tolerances because Windows DPI can return fractional CSS values.
- Visible `:focus-visible` treatment is required; selected-row styling must not
  remove focus affordance.
- Recovery and destructive confirms are modal dialogs: focus trap, Escape is
  non-destructive, restore prior focus on close. Purge uses distinct
  permanent-action copy from restore/delete.
- Initial focus goes to **the safest action the dialog offers**, meaning the
  one that cannot lose user work. For a confirmation that is Cancel. The draft
  recovery dialog has no Cancel, so Recover (or Retry in the stale variant)
  takes initial focus, because Discard is the destructive option there. See
  [design-language.md](./design-language.md) §6.

## Composition

Prefer small, unframed layout sections over nested decorative cards. Reuse
panel chrome (`workbench/PanelChrome.tsx`) and shared shell chrome rather than
copying nearly identical controls. Keep transient busy/error states visible and
keyboard reachable.

Surface content is width-constrained and anchored to the top. A form must not
float alone in an otherwise empty viewport: either the surface carries further
real content, or the form sits in a bounded panel. A submit button never
stretches to the full container width.

Surfaces receive data and command callbacks from the app controller. Presentational
leaves must not call `window.translunar` directly.

## Interaction State Completeness

Every interactive element covers rest, hover, focus-visible, active, selected
or current, and disabled, without changing layout bounds.

Every asynchronous action covers pending with a duplicate-submit guard,
success where the result is not otherwise visible, a typed error rendered next
to the affected control with the user's input preserved, cancellation for long
operations, and a recovery path.

Every collection covers loading as a skeleton matching settled geometry, an
empty state that is bounded and offers exactly one real action, and an error
state with retry. A bare header row with no body, or the lone strings
`Loading` and `Empty`, is a defect.

## UI Copy

Keep labels concise and functional. Do not add filler subtitles, guiding
microcopy, or contrast-copy constructions using “不是”. Do not use em dash or
en dash characters, marketing filler verbs, or invented precise numbers. See
[design-language.md](./design-language.md) §9.

## Avoid

- No direct `window.translunar.invoke` calls scattered through presentational
  leaf components; route engine work through `lib/rpc.ts` and controller
  commands.
- No `dangerouslySetInnerHTML` for source or target text.
- No CSS `display: none` to animate a collapsible panel.
- No hidden click targets without labels, and no disabled control that silently
  drops a pending-save error.
- No glass material, dark-default scaffold, or new Lucide icons in the renderer.
