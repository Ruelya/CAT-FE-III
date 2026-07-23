# Frontend State Management

## Ownership Rule

Rust/SQLite is authoritative for projects, documents, segments, revisions,
counts, TM entries, and QA issues. React state is a presentation cache and
ephemeral interaction state. A successful RPC response replaces the affected
object; it is never merged with a guessed revision or count.

`App.tsx` owns the restored workspace and active surface. `Workbench.tsx`
owns drafts, active row, filters/search, save status, panel modes, preview
height, and navigation busy state. `AssistantPanel.tsx` owns its local
conversation reducer, model/reasoning selection, composer, and applied-message
feedback. `WorkbenchPages.tsx` owns page-local query/loading state.

## State Mechanisms

- Use `useState` for independent presentation values and controlled inputs.
- Use `useReducer` when a state transition table has multiple action kinds;
  `assistantReducer` in `assistant-state.ts` is the current example.
- Use `useMemo` only for a derived value that is expensive or must have stable
  identity for a child; do not use it as a general state store.
- Use refs for timers, composition sets, resize pointers, and focus handoff,
  not as an alternate source of truth.
- Persist only disposable UI preferences/session identity in `localStorage`.
  `SESSION_KEY` and `WORKBENCH_PREFERENCES_KEY` are validated on read; invalid
  values fall back to documented defaults and missing sessions return to setup.

## Server/Engine Flow

The normal mutation flow is:

```text
input -> draft state -> debounced persistSegment -> engine response
      -> replace segment -> refresh counts/QA projections when needed
```

Navigation from Workbench to QA, export, TM, or setup must await
`persistAllSegments` first. The parent then reloads the project snapshot and
page projection through `DesktopApi`; a page must not receive stale draft
objects from the previous surface.

## Derived State

Search/filter visibility, current issue position, match lists, and preview text
are derived from the latest engine-backed arrays. Never derive QA totals,
translation state, or revision numbers from only the visible/filtered rows.

## Avoid

- No Redux/store dependency unless the app has a demonstrated cross-surface
  state problem that local ownership cannot solve.
- No optimistic count/revision mutation for an engine write.
- No persistence of source/target text or API secrets in localStorage.
- No state update after an unmounted async request without an owner guard.
- No duplicate reducer logic in rendering branches; action transitions belong
  in one reducer or explicit callback.

## Task Package State

`TaskPackagePanel` owns only transient mode, paths, actor/reason fields, busy
state, page-local row selection, and confirmation visibility. Engine results
own package identity, status, counts, diagnostics, projections, hashes, and
revisions. Keep selected row IDs in a set across page requests; merge the
returned page's `selected` flags without dropping selections from other pages.

Treat every preview status other than `open` as terminal. A failed apply keeps
the current preview and selection; a successful apply replaces the status from
the result and reloads the project snapshot. Never persist package bytes,
source/target projections, or an apply digest in `localStorage`, and never
optimistically change a project/document revision.
