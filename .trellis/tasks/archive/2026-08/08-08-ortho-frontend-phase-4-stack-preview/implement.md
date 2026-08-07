# Implement — Phase 4 Stack + Preview dock

## Branch

`implement/ortho-frontend` (task.branch). Do not merge main.

## Ordered checklist

### 0. Prep

- [x] Confirm branch and that Phase 2–3 components under `components/workbench/` are present.
- [x] Skim `docs/design-ii/screens/workbench.md` §4–5 and existing CSS `workbench-stack.css` / `.wb` rules — prefer reuse class names (`.stack`, `.match`, `.term`, `.ai-drawer`).
- [x] Locate `SuggestionsPanel`, `DocumentPreview`, preference keys, `editor.toggleSuggestions`, preview toggle commands.

### 1. Pure word-diff helper

- [x] Add `components/workbench/Stack/wordDiff.ts` + `wordDiff.test.ts`.
- [x] Export tokens → render helper or map in MatchCard.
- [x] Run unit test for the helper.

### 2. Extract + dual-pane Stack shell

- [x] Create `StackPanel.tsx` (or `Stack/index` shell) consuming current Suggestions props subset.
- [x] Layout: head (title plate + **one** collapse) → `sec--matches` → `sec--terms` → `AssistantDrawer` bar.
- [x] Remove tablist (Matches/Terms/Assistant/QA).
- [x] Wire matches list into MatchList/MatchCard with word-diff vs `activeSegment.sourceText`.
- [x] Wire terms into TermList/TermRow with state chips + i18n.
- [x] Collapsed mode: 40px rail, expand control, content `inert`/`aria-hidden`, focus transfer (copy from SuggestionsPanel).
- [x] Replace `<SuggestionsPanel …>` call site in Workbench with StackPanel; keep data hooks identical.
- [x] Map / retire `suggestionTab`; introduce `assistantOpen` state (default false).
- [x] Remove maximize as peer primary control if it creates dual chrome; keep preference clamp safe.

### 3. Assistant drawer + Grounding Inspector

- [x] `AssistantDrawer.tsx`: collapsed bar vs expanded body.
- [x] Mount existing Live/Offline/Assistant panel inside expanded body (preserve `projectId`, `activeSegment`, `onApplyMutation`).
- [x] Extract or embed `GroundingInspector` using LiveAssistantPanel snapshot APIs:
  - Prefer minimal change: lift grounding UI into shared component used by LiveAssistantPanel **or** pass render slot — avoid breaking stream/generate.
- [x] Ensure unavailable path is honest; no “grounded” label without content.
- [x] i18n for drawer + inspector section labels (en+zh).

### 4. Preview dock extract + expression

- [x] Move `DocumentPreview` → `PreviewDock/PreviewDock.tsx`; re-export if needed.
- [x] Restyle handle bar to design (follow checkbox, pop-out, collapse, page meta) using tokens; keep behavior.
- [x] Active segment highlight: signal-wash + left edge on structure/PDF mapping already used.
- [x] PDF: if image + text available, dual column; else single + honesty string.
- [x] Non-PDF: structure path with clear limitation copy (i18n).
- [x] Pop-out: implement best-effort; if blocked, disable with aria-label reason.
- [x] Confirm dock remains under grid column only in layout.

### 5. `.wb` host (preferred)

- [ ] Map Workbench main regions to `.wb` grid areas without breaking DocumentMatrix scroll bridge.
- [ ] Set `data-stack` from mode (+ overlay under width threshold).
- [ ] Smoke: scroll grid, matrix viewport bracket, stack collapse, preview resize.
- [x] If unstable: revert host to flex, keep Stack/Preview expression, note residual in task notes / closeout later.
  - **Residual:** kept legacy flex host; dual-pane Stack + PreviewDock ship without `.wb` remount.

### 6. i18n + a11y polish

- [x] Add/adjust keys in `i18n/messages.ts` (en + zh): stack sections, collapse/expand, term states, grounding sections, preview honesty, pop-out, assistant drawer.
- [x] Icon-only buttons: aria-label + title.
- [x] Keyboard: `Ctrl+9` stack; `Ctrl+P` preview; `Alt+1..9` insert if already wired — do not regress.

### 7. Cleanup + validation

- [x] Delete dead tab-only CSS usage where safe; avoid giant styles.css churn — prefer surface CSS files.
- [x] Colocated tests for Stack mode / wordDiff; update any snapshots importing SuggestionsPanel tabs.
- [x] Run targeted tests (see commands).
- [x] Manual checklist against AC1–AC14.

## Validation commands

```bash
# From repo root / apps/desktop as package scripts dictate
pnpm exec vitest run apps/desktop/src/renderer/components/workbench/Stack/wordDiff.test.ts
pnpm exec vitest run apps/desktop/src/renderer/components/workbench --passWithNoTests
# If package-local:
cd apps/desktop && pnpm test -- wordDiff
# Typecheck if available
pnpm exec tsc -p apps/desktop --noEmit
```

Adjust to actual workspace scripts; prefer the project’s existing vitest entry.

Manual:

1. Open project with TM + terms; select segment → both sections visible.
2. Collapse stack → rail 40px; expand; focus OK.
3. Expand AI drawer; open grounding after generate/preview.
4. Toggle preview; follow segment; PDF doc if fixture exists.
5. Locale switch en/zh on new strings.

## Risk points

| Point | Watch |
| --- | --- |
| Workbench.tsx megafile | Extract before large JSX edits; avoid drive-by Phase 3 edits |
| suggestionTab consumers | Grep `suggestionTab` / `SuggestionTab` / QA tab tests |
| Preference maximize | Clamp on read so old prefs don’t break |
| Matrix + `.wb` | Scroll owner must remain `.segment-grid` |
| LiveAssistantPanel internals | Don’t break stream cancellation / conversation load |
| CSS specificity | Legacy `.suggestions-panel` vs new `.stack` — remove dual application |

## Definition of done (implementer)

- All in-scope AC checkboxes in `prd.md` met or residual explicitly written for pop-out / `.wb` only.
- No engine/contracts changes.
- en+zh strings present.
- `research_needed` remains empty unless a hard blocker appears mid-impl (then report to Orchestrator).
