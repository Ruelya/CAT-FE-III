# Closeout summary — Frontend rebuild P2 editor operations and Asset Hub

## Task

- Path: `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets`
- Branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- Verdict: `green_for_closeout` (`review/findings-4.md`)
- Parent: `07-19-complete-full-cat-prd`

## What shipped

P2 extends the P0/P1 desktop renderer with real, Engine-backed editor operations and a project-scoped Asset Hub while preserving save-before-navigation, IME, session-v1, and typed RPC boundaries.

### Editor operations

- Compact `EditorCommandBar` + `EditorPanels` on Workbench (find/replace, tags, propagate, split/merge, source correction, comments, spell/dictionary, Chinese conversion, undo/redo/history, editor preferences, light review queue).
- Pure helpers in `editor-operations.ts`: `EditorMutationResult` apply by stable segment ID, structural refresh decision, merge adjacency, `EDITOR_COMMAND_REGISTRY`, `resolveAcceptedEditorShortcut`.
- Orchestration in `use-editor-operations.ts`: flush-before-mutate, post-flush revision re-read, separate mutation vs read op tokens, busy/error retention, keyboard dispatch (renderer-owned; main does not intercept Ctrl/Cmd+F/K).

### Asset Hub

- App surface `assets` with route identity only (`projectId`, locales, `returnTo`, `section`); forms/paging live in `use-asset-controller`.
- Real destination with six sections: TM, termbase, alignment, corpus, catalog, curation — each with loading/empty/error/success paths.
- Per-domain list + mutation counters; snapshot form/query from `stateRef` before pending patches; reconnect invalidation.
- Corpus import via `selectCorpusInput`; exports via `selectExportPath`.
- **Scoped omission:** TM/TB **import** UI omitted (`WP0-TM-TB-IMPORT-FILTER` — `selectSourceDocument` lacks tmx/tbx/csv/tsv); no main/preload widen in this task.

### App / chrome

- `goAssets` (flush from Workbench), `setAssetsSection`, `backFromAssets` / return rehydration.
- `AppChrome` real Assets entry when project/session allows; no dead nav.

### Tests / quality evidence (from verify-3 / findings-4)

- Desktop Vitest: **215/215** including focused editor/asset controller tests (shortcut gates, snapshot-before-pending, curation rollback boolean).
- Desktop typecheck, production build, Engine build, static appearance scan green.
- Real-Engine Playwright P0/P1/P2 matrix **6/6**.
- Waived residual: test-only `require-await` lint in new test files (RR1); catalog/curation E2E depth presence-level (RR2).

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/editor-assets.md` | **New** P2 code-spec (7-section contracts: editor mutation sequence, registry/keyboard, Asset Hub enter/leave, domain tokens, snapshot-before-pending, exchange boundary, curation rollback, tests, wrong/correct) |
| `.trellis/spec/frontend/index.md` | Index link + pre-dev checklist for P2 |
| `.trellis/spec/frontend/directory-structure.md` | P2 layout (AssetHub, EditorCommandBar/Panels, editor/asset state modules, E2E) |
| `.trellis/spec/frontend/state-management.md` | Owners, save-before Assets, mut/read + per-domain asset tokens |
| `.trellis/spec/frontend/hook-guidelines.md` | Dedicated editor/asset hooks; token and snapshot rules |
| `.trellis/spec/frontend/component-guidelines.md` | Command bar + Asset Hub conventions |
| `.trellis/spec/frontend/quality-guidelines.md` | P2 unit/E2E expectations and review checklist |
| `.trellis/spec/frontend/electron-workbench.md` | Layout + pointer to editor-assets |
| `.trellis/spec/frontend/type-safety.md` | `assets` surface, command IDs, `AssetSection` |

Task artifact: this file (`closeout-summary.md`). Task **not** archived (Orchestrator / finish-work policy).

## Suggested commit message

**Subject:**

```text
feat(desktop): P2 editor operations and Asset Hub
```

**Body:**

```text
Add Workbench editor commands/panels and a project-scoped Asset Hub on the
P0/P1 renderer locks.

Editor: registry-driven command bar, flush-before-mutate with post-flush
revision re-read, independent mutation/read tokens, replace preview-apply,
structural refresh, preferences, and light review accept/reject. Keyboard
acceptance is renderer-owned (no main chord interception).

Assets: real TM, termbase, alignment, corpus, catalog, and curation sections
with per-domain list/mutation tokens, snapshot-before-pending queries, and
main-owned dialogs. Omit TM/TB import until a trusted open-dialog filter
exists (WP0-TM-TB-IMPORT-FILTER).

Capture P2 contracts in .trellis/spec/frontend/editor-assets.md and cross-link
existing frontend specs. Tests: focused renderer coverage + p2-editor-assets
real-Engine E2E; keep P0/P1 green.

Residual (accepted): test-only require-await lint; catalog/curation E2E depth.
```

## Residual risks

| ID | Severity | Description | Reopen if |
| --- | --- | --- | --- |
| RR1 | minor | 13 `@typescript-eslint/require-await` findings in `use-asset-controller.test.tsx` / `use-editor-operations.test.tsx` only | Lint spreads to product code, hides floating promises, or a required CI gate rejects the task |
| RR2 | minor | P2 E2E asserts catalog/curation presence more than full run/rollback outcomes; controller unit tests own exact params | Real Engine catalog fails to settle, curation start/rollback wrong revisions/duplicates, or confirm dialog closes on Engine failure |
| WP0 | scope | TM/TB import UI absent without bridge filter | Product requires import and Orchestrator expands main/preload scope |

## Staging notes for Orchestrator

- Task product + task dir + frontend specs are largely **uncommitted / untracked** on the task branch at closeout time.
- Repo also has **unrelated dirty paths** (e.g. other task.json / agent files). Stage **only** task-owned changes:
  - `apps/desktop/**` P2 product/test files
  - `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets/**`
  - `.trellis/spec/frontend/**` updates from this closeout
- Do **not** archive the task in closeout; Orchestrator owns git commit/merge and finish-work archive policy.
- No product features added during closeout.
