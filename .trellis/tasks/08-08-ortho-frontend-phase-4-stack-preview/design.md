# Design — Phase 4 Stack + Preview dock

## Boundaries

| Layer | In | Out |
| --- | --- | --- |
| Renderer presentation | Stack extract, match/term UI, assistant drawer shell, grounding inspector UI, preview dock chrome/layout, CSS host classes, i18n | Engine algorithms, new contracts |
| Workbench orchestrator | Pass-through existing state/handlers; mode persistence; keyboard command wiring | Business rules for TM scoring |
| CSS | Activate `.wb` / `.stack` / dock tokens already under `styles/30-surfaces/` | New color systems |
| IPC | Existing `ai.*` grounding preview, `pdf.page.*`, segment mutations already used | New methods |

## Current baseline (evidence)

- `Workbench.tsx` still embeds `SuggestionsPanel` (4 tabs) and `DocumentPreview` (~L3093 / L4815+).
- Props already supply: `matches*`, `termMatches*`, `onInsert`, `onApplyMutation`, preview mode/height/follow/navigate, PDF hooks.
- Design CSS ready: `workbench.css` `.wb[data-stack]`, `workbench-stack.css` `.stack` / `.match` / `.term` / `.ai-drawer`.
- Phase 2 host: `workbench-app` + flex `workbench-layout` / `editor-column` / `editor-grid-row` — `.wb` not mounted.
- `LiveAssistantPanel` already has `previewGrounding` + `GroundingSnapshot` + details toggle.

## Target component tree

```text
Workbench (orchestrator)
├── host: .wb  (or flex fallback — see trade-off)
│   ├── Masthead / FilterRail / DocumentMatrix / SegmentGrid   [Phase 2–3 unchanged]
│   ├── PreviewDock/                                          [extract + restyle DocumentPreview]
│   └── Stack/
│       ├── StackChrome (title plate + single collapse)
│       ├── MatchList + MatchCard (+ wordDiff)
│       ├── TermList + TermRow
│       └── AssistantDrawer
│           ├── collapsed bar
│           ├── Live | Offline | disabled branches (existing panels)
│           └── GroundingInspector
└── collapsed StackRail (40px) when data-stack=collapsed
```

Suggested paths (align `09-implementation.md` + `directory-structure.md`):

```text
apps/desktop/src/renderer/components/workbench/
  Stack/
    StackPanel.tsx          # replaces SuggestionsPanel shell
    MatchList.tsx
    MatchCard.tsx
    TermList.tsx
    TermRow.tsx
    AssistantDrawer.tsx
    GroundingInspector.tsx
    wordDiff.ts             # pure helper + wordDiff.test.ts
    stackTypes.ts           # props mirrors of existing SuggestionsProps subset
  PreviewDock/
    PreviewDock.tsx         # extract DocumentPreview
    previewTypes.ts
```

Keep pure helpers unit-tested; presentational leaves get explicit props/callbacks only.

## Contracts (props — preserve hooks)

### StackPanel (replaces SuggestionsPanel)

```ts
// Conceptual — implement mirrors existing SuggestionsProps without QA tab
interface StackPanelProps {
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  mode: PanelMode;                 // reuse docked | collapsed | maximized or slim to expanded|collapsed
  onModeChange(mode: PanelMode): void;
  assistantOpen: boolean;          // replaces suggestionTab === "assistant"
  onAssistantOpenChange(open: boolean): void;
  activeSegment: Segment | undefined;
  matches: TmMatch[];              // existing type from Workbench
  matchesLoading: boolean;
  matchesError: string | null;
  termMatches: TermHit[];
  termLoading: boolean;
  termSettled: boolean;
  termError: string | null;
  onInsert(target: string): void;
  onApplyMutation(mutation: EditorMutationResult): void;
}
```

- Drop `tab` / `onTabChange` / issues list for stack QA (issues remain for other chrome if needed elsewhere).
- Prefer migrate `suggestionTab` → `assistantOpen` boolean in Workbench state; remove dead tab enum values carefully (commands/tests).

### PreviewDock

Keep existing `PreviewProps` surface from `DocumentPreview` unchanged at the Workbench call site:

- `document`, `activeSegment`, `segments`, `total`, `mode`, `onModeChange`, `height`, `onHeightChange`, `followActive`, `onFollowActiveChange`, `onNavigateSegment`, `onSourceCorrected`.

### GroundingInspector

```ts
interface GroundingInspectorProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: { contextKey: string; bundle: PromptBundle } | null;
  unavailableReason?: string | null;
}
```

Render sections from `bundle` fields already returned by preview (terms, TM, style, context). No fabrication.

## Data flow

```text
activeSegment id
    → Workbench existing effects load matches + termMatches
    → StackPanel sections render both lists
user Insert
    → onInsert(target) → existing insertMatch
user expand AI + generate
    → LiveAssistantPanel path → previewGrounding → set snapshot → GroundingInspector
user Ctrl+9 / collapse click
    → onModeChange(collapsed|docked) → preferences persist (existing)
    → host data-stack attribute updates; content inert
activeSegment + followActive
    → PreviewDock highlight + optional page seek (existing PDF effects)
user click preview segment
    → onNavigateSegment → navigateToPreviewSegment (preserve focus policy)
```

## Word-level diff

- Pure `wordDiff(activeSource: string, matchSource: string): DiffToken[]`.
- Tokenize on Unicode-aware word boundaries / whitespace; CJK consecutive non-space runs as tokens if needed.
- LCS or simple Myers on token arrays — keep dependency-free unless repo already has a diff util (prefer local small implementation under 100 LOC).
- Map to `<del>` / `<ins>` / plain spans; CSS already in `workbench-stack.css` (`.match__text del|ins`).
- If match source equals active source, render plain text (no empty ins/del noise).

## Layout strategy

### Preferred: mount `.wb`

1. Change main workbench content wrapper classes to `wb` with `data-stack={collapsed|expanded|overlay}`.
2. Assign `grid-area` classes to masthead / filter / matrix / grid / dock / stack matching CSS areas.
3. Ensure SegmentGrid scroll parent remains the grid area element (Phase 2 Matrix contract).
4. Media or resize observer: width < 1180 → `data-stack="overlay"` when expanded (stack overlays grid) or keep collapsed rail behavior per design.
5. Remove obsolete dual chrome that conflicts (maximize peer button → drop or demote).

### Fallback

- Keep `workbench-layout` flex; restyle `suggestions-panel` to dual-pane using stack CSS class names; set width 40px when collapsed.
- Record residual: `.wb` host not mounted.

**Decision rule for implementer:** attempt preferred path first in a single vertical slice; if Matrix viewport or masthead adjacency breaks within first implementation pass, ship fallback without blocking AC1–AC12.

## Assistant drawer behavior

| State | UI |
| --- | --- |
| Collapsed | `.ai-drawer` bar; chevron; label; status |
| Expanded | flex child ~50%; hosts Live/Offline panel body with constrained scroll |
| AI globally off | honest closed state + link/action to settings if existing route exists |
| No engine | OfflineAssistantPanel content |

Grounding: show summary chips (counts) only when snapshot exists; “Inspect” opens `GroundingInspector` disclosure (details/summary or button+region).

## Preview dock behavior

| Concern | Design |
| --- | --- |
| Width | Grid column only (editor column under SegmentGrid) |
| Highlight | `[data-preview-active]` segment node: `--signal-wash` + 2px left `--signal` |
| PDF dual | If page detail has image + text/OCR fields, two columns; else single + honesty note |
| Structure path | Non-paginated docs: segment sequence / engine structure with explicit i18n limitation string |
| Pop-out | Prefer `window.open` to a hash/route the app already understands, or Electron BrowserWindow pattern if present; on failure disable with title reason |
| Band echo | Optional 20×3 band echo in handle only if Band component exists and second-band rule still holds (≤1 band-echo) |

## State / preference mapping

| Existing | Phase 4 |
| --- | --- |
| `suggestionsMode: docked` | expanded stack |
| `suggestionsMode: collapsed` | rail + `data-stack=collapsed` |
| `suggestionsMode: maximized` | map to expanded (drop maximize) **or** keep internal wide stack without dual-arrow chrome |
| `suggestionTab` | `assistantOpen` boolean; ignore matches/terms tabs |
| `previewMode` / `previewHeight` / `followActivePreview` | unchanged semantics |

Persist via existing preference write path in Workbench.

## Trade-offs

| Option | Pros | Cons | Choice |
| --- | --- | --- | --- |
| Full `.wb` grid now | Design-complete collapse/overlay | Risk to Matrix/grid scroll | **Try first** |
| Flex + dual-pane only | Safer | Residual host | Fallback |
| Keep 4 tabs + show two panes | Less code | Fails AC / design | Reject |
| Extract all of LiveAssistant into Stack | Cleaner files | Large move | Shell drawer wraps existing panel first; deeper merge residual OK |
| External diff lib | Quality | New dependency policy | Prefer pure local |

## Rollback

- Component extracts are mechanical: re-export old names or restore tabbed `SuggestionsPanel` from git on branch.
- CSS: `.wb` attribute removal returns to previous flex classes.
- Preferences: unknown mode values clamp to docked.
- No schema migration; no engine rollback needed.

## Risks

| Risk | Mitigation |
| --- | --- |
| Workbench.tsx size / merge conflict | Extract first, wire second; small commits |
| Focus trap when collapsing with assistant focused | inert content + focus rail control (existing pattern) |
| CJK word-diff poor quality | Document limitation; still better than color blocks; test Latin + simple CJK cases |
| Pop-out incomplete | Honest disabled; don’t block stack ACs |
| Overlay mode covers grid unexpectedly | Only enable with width guard + Esc/collapse path |
| Double scroll owners | Never put overflow-y on matrix or outer wb; only grid + stack sections |

## Testing design

- `wordDiff.test.ts`: equal strings, single substitution, insertion, deletion, empty.
- StackPanel mode: collapsed sets inert; assistant drawer open state.
- Optional RTL smoke: MatchList renders N cards; TermList forbidden class.
- Do not require full Electron e2e for Phase 4 gate unless already cheap; quality loop may add later.
