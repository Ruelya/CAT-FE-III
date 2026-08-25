# Frontend Editor Operations and Asset Hub (P2)

> **Historical / not current greenfield.** The P2 surfaces described here
> (editor command registry, Asset Hub, curation) belonged to the
> pre-greenfield renderer and were removed in the greenfield reset. The
> current workbench is `views/WorkbenchView.tsx` plus the panel components
> under `components/`.

## 1. Scope / Trigger

Use this contract when changing Workbench editor commands/panels, segment
mutation sequences, find/replace preview-apply, undo/redo/history, editor
preferences, light review accept/reject, Asset Hub navigation, or any
TM / termbase / alignment / corpus / catalog / curation surface.

P2 extends the P0/P1 renderer in place. It does not replace session-v1,
`SaveCoordinator`, the app surface machine, or the main/preload bridge.
Domain facts (rows, scores, revisions, diagnostics, mounts, findings,
history) remain Engine-owned through `lib/rpc.ts`.

Source-backed modules (shipped layout; leaf files may consolidate):

| Area | Paths |
| --- | --- |
| Surfaces | `surfaces/Workbench.tsx`, `surfaces/AssetHub.tsx` (all six asset sections live here) |
| Workbench UI | `workbench/EditorCommandBar.tsx`, `workbench/EditorPanels.tsx`, `workbench/SegmentContextMenu.tsx`, `workbench/ActivityBar.tsx`, `workbench/EditorTabs.tsx`, `workbench/AcpChatPanel.tsx` |
| Shell | `shell/AppChrome.tsx` (real Assets destination when session/project exists) |
| Pure helpers | `state/editor-operations.ts`, `state/asset-view.ts`, `state/asset-state.ts` |
| Orchestration | `state/use-editor-operations.ts`, `state/use-asset-controller.ts` |
| App gateway | `state/app-state.ts` (`assets` surface), `use-app-controller.ts` (`goAssets`, `setAssetsSection`, `backFromAssets`) |
| Tests | `editor-operations.test.ts`, `use-editor-operations.test.tsx`, `asset-view.test.ts`, `use-asset-controller.test.tsx`, `tests/e2e/p2-editor-assets.spec.ts` |

Related: [project-lifecycle.md](./project-lifecycle.md) (P1 save-before /
feature ops), [state-management.md](./state-management.md),
[electron-workbench.md](./electron-workbench.md).

---

## 2. Signatures

### App surface (route identity only)

```ts
// state/app-state.ts — large asset forms/results stay OUT of the reducer
type AppSurface =
  | /* …P0/P1 surfaces… */
  | {
      kind: "assets";
      projectId: string;
      projectName: string;
      sourceLocale: string;
      targetLocale: string;
      returnTo: "workbench" | "projects";
      session: SessionIdentity | null;
      section: AssetSection;
    };

type AssetSection =
  | "tm"
  | "termbase"
  | "alignment"
  | "corpus"
  | "catalog"
  | "curation";
```

### Editor pure helpers

```ts
// state/editor-operations.ts
type EditorMutationMode = "replace" | "structural";

function applyEditorMutationResult(
  currentRows: readonly SegmentEditorRow[],
  result: EditorMutationResult,
  mode: EditorMutationMode,
  currentFocusId: string | null,
): {
  needsFullRefresh: boolean;
  rows: SegmentEditorRow[];
  counts: SegmentCounts;
  focusSegmentId: string | null;
};

function shouldRefreshEditorRows(
  currentRows: readonly SegmentEditorRow[],
  result: EditorMutationResult,
  mode: EditorMutationMode,
): boolean;

function orderedMergePair(
  rows: readonly SegmentEditorRow[],
  idA: string,
  idB: string,
): { first: SegmentEditorRow; second: SegmentEditorRow } | null;

type EditorCommandId =
  | "editor.findReplace"
  | "editor.tags"
  | "editor.propagate"
  | "editor.split"
  | "editor.merge"
  | "editor.correctSource"
  | "editor.comments"
  | "editor.spell"
  | "editor.chinese"
  | "editor.undo"
  | "editor.redo"
  | "editor.history"
  | "editor.preferences"
  | "editor.review";

const EDITOR_COMMAND_REGISTRY: readonly EditorCommandDef[];

function resolveAcceptedEditorShortcut(
  input: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  },
  avail: EditorCommandAvailability,
  options?: { workbenchFocused?: boolean },
): EditorCommandId | null;
```

### Editor operation gateway (app controller → hook)

```ts
// state/use-editor-operations.ts
interface EditorOpsGateway {
  generation: number;
  mutationsEnabled: boolean;
  workbenchActive: boolean;
  ctx: SessionContext | null;
  activeSegmentId: string | null;
  focusSegmentId: string | null;
  selectedSegmentIds: string[];
  saveCoordinator: SaveCoordinator;
  flushOrStay: () => Promise<boolean>;
  commitWorkbenchRows(input: {
    rows: SegmentEditorRow[];
    counts: SessionContext["counts"];
    activeSegmentId: string | null;
    focusSegmentId: string | null;
    needsRefresh: boolean;
  }): Promise<void>;
  refreshActiveDocumentRows(focusSegmentId?: string | null): Promise<void>;
}
```

### Asset controller gateway

```ts
// state/use-asset-controller.ts
interface AssetControllerGateway {
  generation: number;
  mutationsEnabled: boolean;
  projectId: string;
  projectName: string;
  sourceLocale: string;
  targetLocale: string;
  section: AssetSection;
}

// Per domain: independent list counter + mutation counter + pending flag
type AssetDomain =
  | "tm"
  | "termbase"
  | "alignment"
  | "corpus"
  | "catalog"
  | "curation";

function beginList(domain: AssetDomain): number;
function beginMut(domain: AssetDomain): number | null; // null = already pending
function isListCurrent(domain, opId, projectId): boolean;
function isMutCurrent(domain, opId, projectId): boolean;
function invalidate(): void; // bump all domain counters on reconnect
```

### Desktop dialogs used by assets

```ts
// Existing DesktopApi — do not invent renderer File paths
selectCorpusInput(): Promise<string | null>; // corpus import only
selectExportPath(suggestedName: string): Promise<string | null>;
// selectSourceDocument() filter is NOT suitable for TMX/TBX/CSV/TSV
// (WP0-TM-TB-IMPORT-FILTER): omit TM/TB import UI until a trusted filter exists
```

### Generated Engine methods (catalog-backed)

Editor: `segment.tag.set`, `segment.propagate`, `segment.find`,
`segment.replace.preview`, `segment.replace.apply`, `segment.split`,
`segment.merge`, `segment.correctSource`, `segment.comment.*`,
`segment.spell.check`, `segment.chinese.convert`, `editor.undo`,
`editor.redo`, `editor.history`, `editor.preferences.get|update`,
`dictionary.*`.

Review: `review.queue`, `review.accept`, `review.reject`.

Assets: `tm.*`, `termbase.*`, `alignment.session.*`, `corpus.*`,
`asset.catalog.list`, `curation.run`, `curation.run.get`,
`curation.finding.list`, `curation.apply`, `curation.rollback`,
`curation.export`.

---

## 3. Contracts

### 3.1 Editor mutation sequence

```text
intent(command, stable segment IDs)
  → capture { generation, mutOpId, documentId, selected IDs }
  → if composing on target-affecting path: stop (no RPC)
  → if dirty active target: SaveCoordinator.flush via flushOrStay
  → on flush failure: retain Workbench/draft/focus; stop
  → re-read authoritative row(s)/revision(s) AFTER flush
  → invoke generated method with exact revision(s)
  → verify generation + mutOp still current
  → apply EditorMutationResult (stable ID replace or full refresh)
  → reattach SaveCoordinator to authoritative focused row
```

Rules:

- Segment identity is always the Engine segment ID — never array index.
- Replace mode: patch matching rows by ID; use Engine `counts` / `focusSegmentId`.
- Structural mode (split/merge) and incomplete ID sets: set `needsFullRefresh`
  and re-list the active document; never invent ordinal placement.
- Undo/redo: mutation-owned token; after success commit rows then refresh active
  document + history when the response is incomplete.
- History / find / comment list use an **independent read token** so a read
  completion cannot clear mutation busy or steal mutation ownership.
- Cancel closing a panel is not an error and must not invoke Engine.

### 3.2 Keyboard / command registry

- One `EDITOR_COMMAND_REGISTRY` drives the command bar, overflow, availability,
  and keyboard matching. IDs are UI intents (`editor.findReplace`), not RPC names.
- `resolveAcceptedEditorShortcut` is the only acceptance gate before
  `preventDefault`. It rejects composition, keyCode/which `229`, inactive
  Workbench session, focus outside Workbench, unregistered chords, and
  unavailable commands.
- Main process must **not** globally intercept Ctrl/Cmd+F/K (or other editor
  chords). Keyboard ownership is renderer-side.
- `DesktopApi.onEditorCommand` may forward menu/IPC ids only after
  `isEditorCommandId` + availability + non-composing checks.

### 3.3 Asset Hub enter / leave

| Transition | Contract |
| --- | --- |
| Workbench → Assets | `flushOrStay()` first; failure keeps Workbench; success sets surface `assets` with default `section: "tm"` and `returnTo: "workbench"` |
| Project Home → Assets | No draft flush; requires real project selection; `returnTo: "projects"` |
| Assets → Workbench | Full session rehydration (P1 pattern); do not trust asset-side document revisions |
| Assets → Home | When `returnTo === "projects"` |
| Reconnect on Assets | App generation bump + asset controller `invalidate()`; reload active section after mutations re-enable |

Chrome: Assets is a real destination only when a project session (or explicit
project selection from Home) exists. No dead/disabled marketing nav.

### 3.4 Asset list vs mutation authority

- Each `AssetDomain` has **separate** list and mutation counters.
- List completions apply only when `isListCurrent`.
- Mutations use `beginMut` (synchronous pending flag); duplicate in-flight
  mutations return without a second RPC.
- Completions also require matching `projectId` and app `generation`.
- Paging uses Engine `total` / `offset` / `limit` and returned order only.
  React never sorts, scores, deduplicates, or estimates domain counts.

### 3.5 Snapshot form state before pending patches

**What**: Read query/filter/reason/policy/session fields from
`stateRef.current` (or equivalent latest ref) **before** calling `setState` to
mark loading/pending.

**Why**: Reading inside a `setState` updater is a deferred side effect; React
may skip or delay it, so valid actions return without RPC and later-page
requests never fire (P2 F6).

```ts
// Correct
const query = stateRef.current.tm.searchQuery.trim();
if (!query) return;
const opId = beginList("tm");
setState((s) => ({ /* loading only — no param reads here */ }));
const result = await invokeEngine("tm.search", { query, /* … */ });
```

### 3.6 File exchange boundary

| Path | Dialog | Engine | Notes |
| --- | --- | --- | --- |
| Corpus import | `selectCorpusInput()` | `corpus.import` | Cancel → idle, no RPC |
| TM/TB/curation export | `selectExportPath` | matching `*.export` | Extension-driven save filters |
| TM/TB import | **Not exposed** | — | `selectSourceDocument` lacks tmx/tbx/csv/tsv (`WP0-TM-TB-IMPORT-FILTER`) |

Renderer never reads filesystem paths from DOM `File`, never parses TMX/TBX/
CSV/TSV/corpus text, and never invents match scores.

### 3.7 Curation rollback boolean contract

```ts
// Returns true only after a current successful Engine response
rollbackCuration(reason: string): Promise<boolean>
```

- Snapshot `stateRef.current.curation.snapshot` before pending.
- Require trimmed reason, enabled mutations, and a run snapshot.
- Send exact `runId`, `expectedRunRevision`, `expectedLibraryRevision`.
- On failure: retain snapshot + `actionError`; return `false`.
- Surface `ConfirmDialog` closes only when the controller returns `true`.

### 3.8 Preferences

- Open → `editor.preferences.get`; keep full `basePreferences` object.
- Update sends the **complete** `EditorPreferences` returned by Engine with
  only P2-edited fields overlaid.
- Shell theme/accent (`APPEARANCE_*`, localStorage) is never written from this path.

### 3.9 Review panel

- Workbench-adjacent panel only (not a top-level surface).
- Queue/accept/reject with exact `expectedSegmentRevision`.
- Refresh queue only after success; failure retains item + typed error.
- No review create/import/export/admin UI.

---

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Dirty target + target-affecting command | Flush first; flush fail → no RPC, draft/focus retained |
| Composing / keyCode 229 | Target-affecting commands and keyboard acceptance blocked |
| Stale mut/list op or generation | Ignore result; do not replace newer projection |
| Duplicate domain mutation (`beginMut` null) | No second RPC; retain first pending state |
| Blank find / blank TM/term/corpus query | No RPC |
| Replace apply with stale preview/token | Typed conflict; retain preview for retry/dismiss |
| Merge without adjacent stable IDs | Command unavailable / no RPC |
| Source correction without reason | No RPC |
| Read-only mount / stale library revision | Typed error; no optimistic mount/list change |
| Dialog cancel | Idle; no Engine call |
| Curation rollback missing snapshot/reason | Return `false`; no RPC |
| Curation rollback Engine failure | Return `false`; keep dialog; show `actionError` |
| Provider unavailable (alignment refine) | Typed error; retryable; no fabricated links |
| Reconnect mid-flight | Invalidate all editor + asset tokens; re-enable only after hydrate |

---

## 5. Good / Base / Bad Cases

### Good

- Dirty target → Tags: flush → re-read revision → `segment.tag.set` → replace
  row + tagIssues from `EditorMutationResult`.
- Find blank query: no request. Non-blank: paged `segment.find` by segment ID.
- Replace: preview (no write) → apply sends complete returned preview/token.
- Merge: capture stable IDs → flush → re-read both rows/revisions →
  `segment.merge` → structural refresh.
- Ctrl+F on focused Workbench: `resolveAcceptedEditorShortcut` returns
  `editor.findReplace`; `preventDefault` + open find panel.
- Assets from Workbench after successful flush; return rehydrates Workbench.
- TM search later page: `stateRef` query + explicit offset; list op guards
  stale pages.
- Curation rollback: exact revisions; dialog closes only on `true`.

### Base

- Empty Asset Hub section: real empty state (not a placeholder tab).
- Single-document Workbench: editor commands still require registry + session.
- History panel open: read token only; does not block or clear undo busy.

### Bad

- Main `before-input-event` swallows Ctrl+F for all webContents.
- Keyboard `preventDefault` for unregistered Ctrl+K.
- `setState((s) => { void runSearch(s.query); return loading; })` as the only
  param source.
- Optimistic TM score / catalog quality invented in React.
- Undo local inverse stack without Engine.
- Preferences update that patches only form fields and drops unknown Engine keys.
- TM import button that uses `selectSourceDocument` or renderer File parse.
- Assets chrome action that navigates without flush or shows a dead section.

---

## 6. Tests Required

| Layer | Assertion points |
| --- | --- |
| Unit `editor-operations` | Row replace vs structural refresh; focus validation; counts authority; merge adjacency; `resolveAcceptedEditorShortcut` accept/suppress (IME 229, no session, outside focus, unregistered key, unavailable) |
| Integration `use-editor-operations` | Flush-fail stops RPC; stale mut ignore; history read token independent of mutation busy; merge post-flush revisions; preview no-write; apply conflict retains preview |
| Unit `asset-view` | Formatting/selection guards only; no domain scoring |
| Integration `use-asset-controller` | Per-domain list/mut tokens; blank query no RPC; snapshot-before-pending for TM/concordance/term/corpus/catalog/alignment/curation; later offsets; `rollbackCuration` success/missing snapshot/exact params/duplicate/error retention |
| Fake desktop | Typed defaults + deferred promises for all P2 methods used |
| E2E `p2-editor-assets.spec.ts` | Isolated real Engine: editor path, Asset Hub all six sections, TM create, return Workbench; keep `p0-vertical-slice` + `p1-project-lifecycle` green |
| Static | No `backdrop-filter` / new `lucide-react` in renderer; typecheck + desktop unit suite |

### Accepted residual (do not reopen without new failure)

- Test-only `@typescript-eslint/require-await` in new test files (hygiene).
- Catalog/curation real-Engine E2E may remain presence-level while controller
  tests own exact RPC params and rollback boolean contract.

---

## 7. Wrong vs Correct

### Wrong

```ts
// Main intercepts editor chords globally
mainWindow.webContents.on("before-input-event", (event, input) => {
  if (input.control && input.key.toLowerCase() === "f") event.preventDefault();
});

// Read form fields only inside setState (deferred; may never RPC)
setState((s) => {
  void invokeEngine("tm.search", { query: s.tm.searchQuery });
  return { ...s, tm: { ...s.tm, search: loading } };
});

// Capture revisions before flush
const rev = activeRow.segment.revision;
await flushOrStay();
await invokeEngine("segment.merge", { expectedRevision: rev, /* stale */ });

// History read shares mutation token and clears busy incorrectly
const op = beginMutOp();
const history = await invokeEngine("editor.history", …);
// … finally { busy = false } races with in-flight undo

// Optimistic curation success
await invokeEngine("curation.rollback", …);
closeDialog(); // even if RPC throws
```

### Correct

```ts
// Renderer-owned acceptance
const id = resolveAcceptedEditorShortcut(event, avail, { workbenchFocused });
if (!id) return;
event.preventDefault();
runCommand(id);

// Snapshot then pending
const query = stateRef.current.tm.searchQuery.trim();
if (!query) return;
const opId = beginList("tm");
setState((s) => ({ …loading only… }));
const result = await invokeEngine("tm.search", { query, offset, limit: PAGE });
if (!isListCurrent("tm", opId, projectId)) return;

// Merge: stable IDs first, revisions after flush
const ids = orderedMergePair(rows, idA, idB);
const ok = await flushOrStay();
if (!ok) return;
const first = rowBySegmentId(currentRows(), ids.first.segment.id);
const second = rowBySegmentId(currentRows(), ids.second.segment.id);
await invokeEngine("segment.merge", {
  firstSegmentId: first.segment.id,
  secondSegmentId: second.segment.id,
  expectedFirstRevision: first.segment.revision,
  expectedSecondRevision: second.segment.revision,
});

// Independent history read token
const op = beginReadOp();
const history = await invokeEngine("editor.history", { projectId });
if (!isReadCurrent(op)) return;

// Rollback boolean + dialog
const ok = await assets.rollbackCuration(reason);
if (ok) closeDialog();
```

### Design decisions

1. **Controller split** — `use-app-controller` owns surface/session/save/
   reconnect only; editor and assets use dedicated hooks so the app controller
   does not absorb form/paging state.
2. **Independent read vs mutation tokens (editor)** — history/find/list must not
   invalidate undo/redo ownership or leave the command surface busy.
3. **Per-domain asset list + mutation counters** — prevent TM search completion
   from clobbering catalog/curation after reconnect or section switch.
4. **Snapshot-before-pending** — form/query authority is always the latest ref,
   never a `setState` side effect.
5. **No TM/TB import without trusted dialog filter** — omit controls rather than
   widen main/preload or parse files in React (`WP0-TM-TB-IMPORT-FILTER`).
6. **Structural refresh over invented order** — split/merge/undo incompleteness
   re-lists; React never renumbers segments.
7. **Keyboard ownership in renderer** — main never preventDefaults unregistered
   or IME-sensitive editor chords.

---

## Common Mistakes

### Common Mistake: Deferred param read

**Symptom**: Button click does nothing; no RPC in fake/real Engine.

**Cause**: Query/offset read inside `setState` updater.

**Fix**: `const q = stateRef.current…` before any pending patch.

### Common Mistake: Shared editor token for history

**Symptom**: Undo stays busy forever or history overwrites in-flight mutation.

**Cause**: One op counter for both reads and mutations.

**Fix**: `mutOpRef` + `readOpRef` with separate current checks.

### Common Mistake: Pre-flush merge revisions

**Symptom**: Conflict on merge after typing in one of the rows.

**Cause**: Revision captured before `flushOrStay`.

**Fix**: Stable IDs only pre-flush; re-read rows after flush.

### Common Mistake: Dead TM import control

**Symptom**: Import opens wrong file types or fails silently.

**Cause**: Reusing `selectSourceDocument` without tmx/tbx/csv/tsv.

**Fix**: Hide import until bridge filter exists; export still uses
`selectExportPath`.
