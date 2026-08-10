# Frontend Project Lifecycle (P1)

## 1. Scope / Trigger

Use this contract when changing multi-document Workbench behavior, multi-file
import, templates, recycle, global search, project insights, example open,
project update/archive, feature operation tokens, or P1 test landmarks.

P1 extends the P0 renderer in place. It does not replace session-v1, the
reducer/controller, `SaveCoordinator`, or the main/preload bridge. Domain
facts remain Engine-owned through `lib/rpc.ts`.

Source-backed modules:

| Area | Paths |
| --- | --- |
| Surfaces | `surfaces/Templates.tsx`, `RecycleBin.tsx`, `GlobalSearch.tsx`, `ProjectInsights.tsx`; extended `ProjectHome`, `ImportDocument`, `Workbench` |
| Workbench | `workbench/DocumentSwitcher.tsx`, `BatchImportSummary.tsx` |
| Shell | `shell/ConfirmDialog.tsx`, `ModalDialog.tsx`; extended `AppChrome` |
| Pure helpers | `state/document-navigation.ts`, `template-definition.ts`, `search-navigation.ts`, `analytics-view.ts` |
| State machine | `state/app-state.ts` (`templates` \| `recycle` \| `search` \| `insights`), `use-app-controller.ts` |
| Tests | `App.p1.integration.test.tsx`, helper `*.test.ts`, `tests/e2e/p1-project-lifecycle.spec.ts` |

## 2. Signatures

### Multi-document session projection

```ts
// Session identity remains identity-only (unchanged from P0)
interface SessionIdentity {
  version: 1;
  projectId: string;
  documentId: string;
}

// Presentation cache only — never written to localStorage
interface SessionContext {
  session: SessionIdentity;
  project: Project;
  document: Document;
  documents: Document[]; // Engine-ordered, full active set via bounded paging
  rows: SegmentEditorRow[];
  counts: SegmentCounts | null;
}
```

### Bounded document aggregation

```ts
// state/document-navigation.ts
const DOCUMENT_PAGE_LIMIT = 200;
const DOCUMENT_PAGE_MAX_ROUNDS = 50;

function aggregateProjectDocuments(
  projectId: string,
  listPage: (projectId: string, offset: number, limit: number) => Promise<DocumentPage>,
  options?: { limit?: number; maxRounds?: number },
): Promise<
  | { ok: true; documents: Document[] }
  | { ok: false; error: UiError }
>;

function resolvePostDeleteDocumentRoute(
  documents: readonly { id: string }[],
  deletedDocumentId: string,
): { kind: "document"; documentId: string } | { kind: "import" };

function chooseImportOpenDocumentId(input: {
  projectId: string;
  diagnostics: readonly {
    status: string;
    document?: { id: string; projectId: string } | null;
  }[];
  documents: readonly { id: string; projectId: string }[];
}): string | null;
```

### Canonical batch import

```ts
// Picker (DesktopApi — existing bridge)
selectSourceDocuments(): Promise<string[]>; // [] = cancel, no Engine call

// One Engine request only
invoke("project.batchImport", {
  projectId: string,
  atomicity: "bestEffort",
  items: paths.map((path) => ({ path })), // picker order; no invented relativePath
}): Promise<BatchImportResult>;
```

### Template definition (unknown-preserving)

```ts
// state/template-definition.ts
interface P1TemplateDefaults {
  sourceLocale: string;
  targetLocale: string;
  domain: string;
}

function decodeTemplateDefinition(definition: unknown): DecodeTemplateDefinitionResult;
function createTemplateDefinition(defaults: P1TemplateDefaults): Record<string, unknown>;
function mergeTemplateDefinition(
  existing: unknown,
  defaults: P1TemplateDefaults,
):
  | { ok: true; definition: Record<string, unknown> }
  | { ok: false; reason: "invalid-definition" };
function isBuiltInTemplate(template: { builtIn: boolean }): boolean;
```

### Recycle vs lifecycle (distinct)

```ts
// Archive only — never trash
invoke("project.setLifecycle", {
  projectId: string,
  expectedRevision: number,
  lifecycle: "active" | "archived",
});

// Soft-delete to recycle
invoke("recycle.delete", {
  entityType: "project" | "document",
  entityId: string,
  expectedRevision: number,
  reason: string, // required non-empty
});

invoke("recycle.restore", { entryId: string, reason?: string });
invoke("recycle.purge", { entryId: string, reason?: string });
```

### Global search

```ts
invoke("search.global", {
  text: string,              // trimmed; empty → no RPC
  includeRecycled: false,    // P1 default always false
  offset: number,
  limit: number,
});
```

### Feature operation token

```ts
// use-app-controller.ts (pattern)
type FeatureOp = {
  generation: number; // app boot/reconnect generation
  opId: number;       // per-domain counter
  origin: SurfaceKindName | null;
};

function beginOp(ref: { current: number }, origin?: SurfaceKindName | null): FeatureOp;
function isOpCurrent(op: FeatureOp, ref: { current: number }): boolean;
function invalidateFeatureOps(): void; // bump all domain counters on reconnect
```

Independent domains (separate refs): open-project, switch-document, import,
example, search, insights, templates, recycle, lifecycle, QA load.

## 3. Contracts

### Multi-doc session

- `documents` is replaced from `document.list` aggregation; never sorted or
  truncated silently in React.
- Cross-project items and non-advancing pages fail as typed invalid Engine data.
- Session-v1 is written only after `project.get` + `document.get` + segment
  hydration succeed for the chosen document.
- Selecting the already-active document in the switcher is a no-op.

### Document switch

```text
select B → no-op if active
  → SaveCoordinator.flush()
  → on flush fail: keep Workbench, draft, session; no hydrate
  → validate B ownership → document.get → segment.editor.list
  → commit SessionContext + session-v1 + replace Workbench
  → attach SaveCoordinator / exact-TM only after commit
```

Old Workbench remains mounted until the new context is ready. Older switch
completions must not update a newer session.

### Batch import

| Origin | After any success |
| --- | --- |
| Empty / Import surface | Prefer first successful diagnostic document; else first fresh list item; hydrate → session → Workbench; keep summary |
| Workbench Add files | Flush first; retain active document; refresh `ctx.documents`; show summary until dismissed/superseded |
| All failed | Keep surface/session; show diagnostics; retry starts a new picker/import |
| Picker `[]` | Zero Engine calls, no error, no route change |

Do not loop `document.import`. Do not expose folder recursion in P1 UI. Guard
duplicate picker/import in both UI disabled state and command code
(`addFilesGuardRef` / import op id).

### Templates

- List/get use Engine paging and exact revision on get-before-edit/use.
- Create writes only P1 keys. Update shallow-copies the fetched definition and
  replaces only `sourceLocale` / `targetLocale` / `domain`.
- Built-in: view/use only; command layer also rejects mutate/delete.
- Create-from-template routes to Import with dependency diagnostics; **no**
  session write until a document hydrates.
- Delete requires confirmation + expected revision; list refreshes only after success.

### Recycle vs lifecycle

| Action | Method | Notes |
| --- | --- | --- |
| Archive / unarchive | `project.setLifecycle` | `archived` / `active` only |
| Move to recycle | `recycle.delete` | Required reason; not lifecycle `"trash"` |
| Restore | `recycle.restore` | Separate confirmation |
| Purge | `recycle.purge` | Separate permanent confirmation; Cancel-first focus |

- Recycled entities must not appear in normal Project Home lists or default
  global search (`includeRecycled: false`).
- Active-document recycle: flush first; after success re-list documents and use
  `resolvePostDeleteDocumentRoute` (next Engine-ordered doc or Import).
- Active-project recycle: clear session only after success; resolve Home from
  fresh Engine data.
- Never invent retention countdowns or purge eligibility in the renderer.

### Global search + save-before-nav

Shared save-before-transition boundary (controller):

1. Capture feature op + generation + origin surface.
2. If current surface is Workbench, `await SaveCoordinator.flush()`.
3. On flush failure: patch transition error; **no** destination RPC.
4. Load/hydrate destination.
5. Commit only if `isOpCurrent` still holds.
6. Write/clear session only at the destination commit point.

**Must use the boundary:** Home, Search, QA, Export, Insights, document switch,
search-hit activation when leaving Workbench, active-document recycle, any
future Workbench exit.

**Does not need Workbench flush:** Project Home / Templates / Recycle actions
that do not leave an active editor (still need command guards and feature ops).

Search navigation classification (`search-navigation.ts`):

1. segment + document → hydrate, verify segment in rows, focus segment  
2. document only → hydrate document, first row  
3. project only → open-project resolver (empty docs → Import)  
4. invalid / missing / cross-project → keep search results, typed error, no false session

### Document switcher testids

Stable landmarks for E2E and integration (prefer roles/labels for ordinary
assertions; use these when labels collide, e.g. Recycle “Document”):

| Landmark | Element |
| --- | --- |
| `data-testid="document-switcher"` | Switcher root |
| `data-testid="document-switcher-select"` | `<select>` of project documents |
| `data-testid="global-search"` | Search surface root |
| `data-testid="nav-search"` | Chrome Search control |
| `data-testid="nav-insights"` | Chrome Insights control |

Do not rely on ambiguous accessible names like bare `/Document/i` when Recycle
and Workbench both expose “Document”.

### Feature op tokens

- Each async feature domain has its own counter ref.
- `beginOp` snapshots `{ generation, opId, origin }`.
- Completions apply only when `isOpCurrent` (generation + opId + optional origin surface).
- Reconnect increments app generation **and** `invalidateFeatureOps()` so all
  in-flight feature completions are discarded.
- UI disable is not sufficient; command code must re-check guards/op ids.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Dirty Workbench → switch / Search / Insights / Home / QA / Export | Flush first; failure keeps Workbench + draft |
| Switch to active document | No-op; no RPC |
| Cross-project document in list/hydrate | Typed error; no session write |
| Picker returns `[]` | No `project.batchImport` |
| Mixed batch import success/failure | Render every diagnostic; not all-success/all-failure |
| Template update with unknown definition keys | Keys preserved via `mergeTemplateDefinition` |
| Built-in template mutate/delete | No UI action; command rejects |
| `project.setLifecycle("trash")` | Forbidden UI path; use `recycle.delete` |
| Empty search submit | No `search.global` RPC |
| Stale search/import/switch completion | Ignore; keep newer surface/session |
| Recycle reason empty | Block submit |
| Escape on destructive dialog | Never confirms; Cancel is initial focus |
| Reconnect mid-feature | Invalidate feature ops; revalidate before mutations |

## 5. Good / Base / Bad Cases

- **Good:** multi-doc project shows Engine-ordered options in
  `document-switcher-select`; dirty switch flushes then hydrates B and writes
  session-v1 only for B.
- **Base:** single-document project; switcher still lists one option; active
  selection is a no-op.
- **Good:** Add files from Workbench → one `bestEffort` batchImport → active
  document unchanged → summary visible → new docs selectable.
- **Good:** archive via `setLifecycle`; recycle via `recycle.delete` with
  reason; restore then purge with separate confirms.
- **Good:** Search from Workbench flushes, then queries with
  `includeRecycled: false`; segment hit focuses verified row.
- **Bad:** loop `document.import` per path, invent `relativePath`, or folder UI.
- **Bad:** `setLifecycle("trash")` as soft-delete.
- **Bad:** persist full `SessionContext` / documents array in localStorage.
- **Bad:** optimistic template revision or recycle list mutation before Engine success.
- **Bad:** navigate on search hit without hydration, or claim success when segment missing.
- **Bad:** E2E that matches generic “Document” and collides with Recycle.

## 6. Tests Required

| Layer | Assertion points |
| --- | --- |
| Unit `document-navigation` | Aggregate order, cross-project reject, stall, post-delete route, import open document choice |
| Unit `template-definition` | Invalid definition, create keys only, merge preserves unknown, built-in guard |
| Unit `search-navigation` | Classify project/document/segment/invalid; trim; stable hit key |
| Unit `analytics-view` | Format basis points/durations; unavailable metrics not zeroed |
| Integration `App.p1` | Batch cancel/mixed, switch save-before, templates CRUD/create-from-template, recycle restore/purge, search nav, insights, example, archive/update, feature op stale guards |
| E2E `p1-project-lifecycle.spec.ts` | Real Engine multi-file + switcher landmark, templates, recycle restore/purge/Home exclusion, search jump, insights, example identity + relaunch |
| Regression | Keep `p0-vertical-slice.spec.ts` green; P0 Home Open must target **Listed** row `Open`, not “Open example” |

## 7. Wrong vs Correct

### Wrong

```ts
// Competing delete paths
await invoke("project.setLifecycle", { lifecycle: "trash", ... });

// Multi-file via N imports
for (const path of paths) {
  await invoke("document.import", { projectId, path });
}

// Session before hydrate
writeSession({ version: 1, projectId, documentId });
await hydrate(...);

// Stale completion
const result = await searchGlobal(...);
setSearchResults(result); // no op/generation check
```

### Correct

```ts
await invoke("recycle.delete", {
  entityType: "project",
  entityId,
  expectedRevision,
  reason: reason.trim(),
});

const paths = await api.selectSourceDocuments();
if (paths.length === 0) return;
const op = beginOp(importOpRef, "import-document");
const result = await invoke("project.batchImport", {
  projectId,
  atomicity: "bestEffort",
  items: paths.map((path) => ({ path })),
});
if (!isOpCurrent(op, importOpRef)) return;

const ctx = await hydrateSession({ version: 1, projectId, documentId });
writeSession(ctx.session);
setSurface({ kind: "workbench", ctx, ... });
```

### Design decisions

1. **One batchImport path** — preserves per-file diagnostics and one duplicate/stale guard surface.
2. **Recycle ≠ lifecycle trash** — avoids two soft-delete semantics in UI and Engine.
3. **Feature op tokens per domain** — prevents import completion from clobbering a later search or switch after reconnect.
4. **Stable switcher testids** — E2E must not depend on ambiguous English labels shared with Recycle.
