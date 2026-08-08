# Frontend State Management

## Ownership Rule

Rust/SQLite is authoritative for projects, documents, segments, revisions,
counts, TM entries, and QA issues. React state is a presentation cache and
ephemeral interaction state. A successful RPC response replaces the affected
object; it is never merged with a guessed revision or count.

### Owners (P0 rebuild)

| Concern | Owner | Persistence |
| --- | --- | --- |
| Projects, documents, segments, revisions, statuses, counts, TM, QA, export | Engine via `lib/rpc.ts` | Engine |
| Active surface / boot / recovery gating | `state/use-app-controller.ts` + `state/app-state.ts` | Memory (derived) |
| Session identity (projectId + documentId only) | `state/session.ts` | Versioned `localStorage` key `translunar.renderer.session.v1` |
| Target draft, dirty/saving/error, journal coordination | `state/save-coordinator.ts` | DraftJournal via preload while pending |
| Draft journal classification | `state/draft-recovery.ts` | Read-only classification of journal snapshot |
| Appearance (light / advanced brown) | `state/appearance.ts` + CSS tokens | None — fixed constants |
| Active segment, panel collapse, form fields | Owning surface / workbench piece | Memory (optional disposable UI pref for panel only) |
| Engine connection | Preload events + controller | Memory |

`App.tsx` composes the controller and gates; it is not a second state store.

## Session Routing

### Convention: Versioned identity + pure resolver

**What**: Persist only `{ version: 1, projectId, documentId }`. Parse is total
and never throws. A syntactically valid identity becomes active only after
`project.get`, `document.get`, and segment hydration succeed.

**Startup destinations** (`routes/resolveSurface.ts`):

- Valid hydrated session → Workbench
- No valid session + empty `project.list` → Welcome
- No valid session + non-empty list → Project Home (`projects`)
- Non-empty recoverable draft journal → Recovery before normal editing
- Open project with zero documents → Import; otherwise first Engine-returned
  document (P0 has no document manager)

**Rules**:

- Clear the session key only when identity is proven invalid/recycled, not on
  transport outage.
- Write the session only after import/open hydration succeeds — never after
  bare project create.
- Home navigation flushes Workbench saves, intentionally clears session, then
  reloads `project.list`.

**Example**:

```ts
// session.ts
export const SESSION_STORAGE_KEY = "translunar.renderer.session.v1";
export interface SessionIdentity {
  version: 1;
  projectId: string;
  documentId: string;
}
```

## Save Coordinator

### Pattern: Generation-stable draft + journal

**Problem**: Debounced saves, confirm, and leave-workbench transitions must not
drop a newer keystroke or confirm a stale target.

**Solution**: `SaveCoordinator` tracks per active segment:

- `engineTarget` / `draftTarget`
- `editGeneration` / `savedGeneration`
- `saveState`: `idle` | `scheduled` | `saving` | `error`
- `journalError` independent of Engine save success
- `isComposing`

Sequence:

1. Input updates draft + generation; trailing journal write (~150 ms) and
   domain save (~350 ms) when not composing.
2. One in-flight domain mutation; acknowledge only the submitted generation;
   retain newer dirty text.
3. `flush()` serializes until edit generation is stable against saved
   generation (bounded loop), so typing during an older update is not dropped.
4. Successful Engine save may clear the matching journal entry; journal-clear
   failure surfaces as `journalError` / UI status without rolling back the
   Engine-saved target.
5. Confirm: IME guard → flush → `segment.confirm` → refresh → focus advance
   only on success and still-current command.
6. Leave Workbench: `flush()` first; on failure keep surface = Workbench,
   preserve draft, show typed error, make no QA/export/home call.

**Don't**: claim domain confirmation from local draft state, or clear a multi-
record recovery map after applying only the active segment.

## Draft Recovery

### Pattern: Classify → Recover / Discard → multi-record retention

- `classifyDraftJournal` returns `empty` | `recoverable` | `stale` with typed
  reasons. Never present unvalidated journal data as restored.
- Recover applies draft text only after referenced identities validate.
- Multiple valid journal records for a document stay pending until each matching
  segment is visited and saved (or explicit discard). Clearing one record must
  not discard the others.
- Stale/unresolvable journals show Retry validation and Discard; they are never
  labeled recovered.
- Discard requires successful `clearDraftJournal` (or visible failure that
  withholds the transition).

## Reconnect

While reconnecting: retain the mounted projection and dirty draft, show a
status banner, disable domain mutations and new navigation, revalidate
identities, rehydrate, then re-enable. Startup/reconnect operations carry a
generation so stale responses cannot replace current state.

## State Mechanisms

- Use `useState` for independent presentation values and controlled inputs.
- Use `useReducer` / controller-owned state for the cross-surface machine
  (`app-state.ts` + `use-app-controller.ts`).
- Use `useMemo` only for a derived value that is expensive or must have stable
  identity for a child; do not use it as a general state store.
- Use refs for timers, composition flags, pending recovery maps, and focus
  handoff — not as an alternate domain source of truth.
- Persist only versioned session identity (and optional disposable UI prefs) in
  `localStorage`. Never persist source/target text, secrets, or domain
  snapshots there (drafts use DraftJournal via preload).

## Server/Engine Flow

```text
input -> SaveCoordinator draft/generation
      -> journal write + segment.updateTarget
      -> replace segment from Engine
      -> confirm only after flush + IME clear
      -> leave surface only after flush success
```

Navigation from Workbench to QA, Export, or Home must await coordinator flush
first. Surfaces re-fetch projections through RPC; they must not receive stale
draft objects from a previous surface as domain truth.

## Derived State

Search/filter visibility, current issue position, and exact-TM display are
derived from the latest engine-backed arrays. Never derive QA totals,
translation state, or revision numbers from only the visible/filtered rows.

## Avoid

- No Redux/store dependency unless the app has a demonstrated cross-surface
  state problem that local ownership cannot solve.
- No optimistic count/revision mutation for an engine write.
- No persistence of source/target text or API secrets in localStorage.
- No state update after an unmounted async request without an owner/generation
  guard.
- No theme/accent settings persistence in P0.
- No treating transport failure as recycled session identity.
