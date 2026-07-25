# Design - Workbench visual identity completion

## Design authority and resolved contradictions

`docs/stitch/DESIGN.md` is authoritative over the raster reference, the earlier
visual-polish notes, and the old draft of this task.

| Conflict | Resolution |
| --- | --- |
| Old PRD kept Bahnschrift first | Bundled Space Grotesk, Chivo, Space Mono, and Noto Sans SC load first. System faces are fallback only. |
| Old 3 MiB uncompressed budget vs arbitrary CJK content | Measure checked-in WOFF2 and packaged delta; allow at most 20 MiB while retaining full offline SC coverage. Fixture-only glyph subsets are forbidden. |
| Old radius plan used only 4px/6px | Use the source-of-truth 4px input, 6px button, 8px panel tiers. True circles and 0-1px square lamps are explicit exceptions. |
| Old acceptance said five loading/empty surfaces | Cover exactly 8 states: 3 loading plus 5 empty, each separately testable. |
| Design asks for app-bar global search; current app-bar input is in-document | Keep in-document search in the editor toolbar and expose the existing `search.global` behavior in the app bar. Reuse existing result/snippet behavior. |
| Raster implies page-like layout; current non-PDF contracts do not prove pagination | PDF shows real pages. Other formats use truthful ordered structure/segment position and never fabricate page or heading semantics. |
| Visual-polish removed the old Suggestions angle | That rule was dead at the time. This task deliberately introduces the approved single cut terminal with current tests and geometry updated together. |

## Boundaries

Expected implementation ownership:

- Renderer: Workbench composition, Assistant first-token presentation, global
  search component reuse, i18n strings, semantic loading/empty primitives.
- Styling/assets: locally packaged fonts and licenses, font/radius/spacing/type
  tokens, Workbench/Suggestions/Preview/state styles, dark/reduced-motion parity.
- Tests: focused React tests for the state primitive and search/result behavior;
  real-Engine Electron E2E for navigation, panel/focus/IME contracts, responsive
  geometry, font loading, and screenshots.

The Engine remains authoritative. The task uses the existing generated
`search.global`, TM, term, AI, segment, PDF, and document contracts. It does not
add preview-domain data or move search/snippet parsing into ad hoc JSX.

Likely files are `Workbench.tsx`, `LiveAssistantPanel.tsx`, `ProjectHome.tsx`,
`App.tsx`, a small shared global-search/state component if extraction is justified,
`i18n/messages.ts`, `styles.css`, local font/license assets, focused renderer
tests, and `tests/e2e/workbench.spec.ts`. The implementer must re-search before
editing because these files are currently shared with other tasks.

## Typography and asset contract

Use explicit bundled family names so a test can distinguish packaged fonts from
OS aliases:

```css
--font-display: "Translunar Space Grotesk", system-ui, sans-serif;
--font-body: "Translunar Chivo", system-ui, sans-serif;
--font-mono: "Translunar Space Mono", ui-monospace, monospace;
--font-cjk: "Translunar Noto Sans SC", var(--font-body);
```

Each `@font-face` begins with a relative `url(...)` WOFF2 source and uses
`font-display: swap`; do not put `local(...)` before the URL. Package only the
weights/styles used by the Workbench, prefer variable faces where the license and
Electron rendering are verified, and declare accurate weight ranges.

Font provenance lives beside the assets or in a concise manifest containing
upstream release, URL, SHA-256, license, unicode coverage, file size, and intended
role. The production Vite build must include the files under a relative asset base.
E2E waits for `document.fonts.ready`, checks the explicit bundled family names,
renders representative Latin/mono/SC strings, and records actual asset/package
sizes. Network inspection proves no font request leaves the local app.

## Shared working-state primitive

Eight repeated surfaces justify one small presentational primitive rather than
eight independent compositions. The primitive owns only visual semantics:

```ts
type WorkbenchVisualStateKind = "loading" | "empty";

interface WorkbenchVisualStateProps {
  kind: WorkbenchVisualStateKind;
  label: string;
  variant: "matches" | "assistant" | "preview" | "terms" | "qa" | "grid";
  action?: ReactNode;
}
```

It renders a stable wrapper, existing BrandMark-derived geometric mark/dot field,
one concise label, an optional real action, and a bounded live status. Loading
variants render layout-specific skeleton children: match-card rows, an Assistant
response block, or a document-page/block pair. The shared wrapper does not force
identical height across unrelated panels; each variant reserves the final local
geometry so the owning panel does not jump.

State ownership remains with the current request owner:

| State | Owner / transition | Final geometry |
| --- | --- | --- |
| TM loading | Workbench sets a generation-bound `matchesLoading` before `tm.lookupExact`, clears on current success/error | Match card |
| Assistant first token | Live Assistant from accepted run until first non-empty semantic chunk or terminal/error | Assistant response |
| PDF page render | DocumentPreview `pdfLoading`, separated from error/empty | Page image plus block list |
| No TM match | `!matchesLoading && matches.length === 0` | Match panel |
| No term hit | Settled term request with zero matches | Term panel |
| No QA issue | Zero open issues | QA panel |
| No conversation | Settled Assistant conversation/messages with zero messages and no active run | Transcript |
| Empty grid | Settled editor query/filter with zero visible segments | Grid body; real Clear filters action |

Stale request completion must not replace the next segment's state. Errors stay
errors; they are never rendered as empty results. `aria-busy` belongs on the
owning region. Reduced motion removes only shimmer movement, not the skeleton or
status copy.

## App bar and global search

The app bar uses these stable zones:

```text
| identity 280-360 | document | global search command | Run QA | Export | more |
```

Identity keeps the existing BrandMark and real project/domain copy, with one
clipped orbital/registration gesture behind non-reading chrome. The full five
color band remains the only complete band.

Project Home already owns correct `search.global` params, paging, safe balanced
`<mark>` parsing, field/workflow labels, and result navigation. Extract the
reusable search controller/result list only if it prevents duplication; otherwise
open the existing Global Search surface through a new explicit navigation target.
Do not copy the RPC/parse logic into Workbench.

Workbench result selection is an awaited sequence:

```text
select result -> persistAllSegments -> open project/document/segment -> close search
failure       -> keep Workbench/search/draft -> show typed error
```

The app-bar command is keyboard reachable and has an accurate global-search
accessible name. The in-file text field moves/stays in the editor toolbar and
continues to filter only the current document.

## Suggestions composition

The title block and dot field remain one 46-52px header row. The ink title block
uses one CSS polygon/pseudo terminal sized so the label never enters the clipped
area. Tabs begin on the next row. Collapse and maximize buttons occupy stable
32-36px boxes in the dot field and cannot resize the title.

The existing mounted/inert and focus-ref implementation remains. E2E updates the
obsolete `::after content === none` assertion to assert an actual cut geometry and
continues to verify intermediate/final widths and focus handoff.

Result content follows resource hierarchy: source/target text first, provenance
and date second, explicit Insert/Replace/Diff action last. Assistant configuration
stays inside the AI tab. Cards are limited to contained results; tabs, context, and
empty/loading states are unframed.

## Segment density

Keep the four-column table and virtualization. The default row remains quiet and
the active row exposes a compact command group. Frequent actions remain direct;
low-frequency split/merge/source-correction/conversion/review commands may move
under one accessible overflow menu after verifying current shortcut/menu access.
Protected tags and issue evidence never move into the overflow.

Use 32px minimum hit areas, Lucide icons, tooltips/accessibility names, and no
pill treatment. If typography/padding changes measured row height, update
`EDITOR_ROW_HEIGHT` from one shared constant and test scroll targeting, focused
row navigation, and spacer math with the existing 10,000-row fixture.

## Preview hierarchy

Keep `DocumentPreview` as the owner of mode, resize, PDF fetch, and active-location
presentation. Restructure its visual layers without inventing data:

```text
handle: Document preview | file | truthful position | follow | page/zoom/mode tools
body:   structure/thumb rail | paper/document canvas | optional inert chrome field
```

- PDF: actual raster page, real page N of total, extracted blocks, active block,
  OCR correction, errors, and loading skeleton.
- DOCX: ordered paragraph segments grouped by truthful part/path when parseable;
  no claimed page number.
- HTML/Markdown/TXT: ordered document flow with segment position. Structural path
  may support grouping but never becomes user-facing fake hierarchy.
- Degraded/unsupported structure: retain content, label the limitation, and use
  `Segment N of total` rather than `Page`.

Clicking a represented segment calls the existing Workbench active-row navigation
path. Opening/clicking Preview preserves pending target state and follows the
existing focus contract. The canvas uses paper hierarchy and document margins;
decoration stays in handle/outer gutters.

## Token model

```css
--radius-input: 4px;
--radius-button: 6px;
--radius-panel: 8px;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
```

Inputs/tags use the input tier, command buttons use the button tier, and panels,
dialogs, popovers, and contained result cards use the panel tier. `50%` is allowed
only for true circles; `0`/`1px` is allowed for square status/registration marks.
Compound segmented-control corners use the semantic token, not raw 3/5/7/9px.

Radius migration covers the renderer stylesheet so shared surfaces do not keep
contradictory tiers. Spacing/type migration is bounded to the Workbench groups in
the PRD. Use a mechanical search-and-replace pass followed by per-group review;
do not mix structural edits into the token commit.

## Accessibility, responsive, and motion behavior

- Maintain semantic regions/tabs/menus/separators and the exact visible focus
  handoff for Suggestions and Preview.
- Loading status is announced once per request transition. Empty state copy is not
  a live region unless it changes because of an explicit user action.
- At 125% font scaling, wrap or move controls before shrinking type. Keep editor
  source/target at least 14px and Suggestions operable at the minimum viewport.
- New movement uses transform/opacity. Skeleton shimmer is the only new repeating
  animation and exists only while the operation is active. Reduced motion makes it
  static.
- Light/dark contrast is measured for text, focus rings, skeletons, and dot fields.

## Validation and rollback

Each implementation package has a focused test/screenshot gate and may be reverted
without reverting earlier packages. Product behavior stays usable after every
package. Full rollback is a sequence of package commits, never a broad worktree
reset.

The final check compares all three viewports to the primary anchor and written
rules. It checks hierarchy and constraints, not exact pixels. Windows is mandatory
for the current evidence lane; macOS font/package evidence is required before AC1
can be marked complete and may come from CI or a native runner.
