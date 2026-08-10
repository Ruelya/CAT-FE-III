# Hook Guidelines

## Current Pattern

The app uses React built-ins plus a small set of ownership hooks:

- `state/use-app-controller.ts` — boot, session routing, surface transitions,
  Engine status/reconnect, recovery, feature operation tokens, save-before-
  transition, and command wiring for surfaces (including P1 lifecycle and the
  Assets entry/return gateway)
- `state/use-editor-operations.ts` — Workbench editor command sequences,
  panel/pending/error state, mut vs read op tokens, keyboard/registry dispatch
- `state/use-asset-controller.ts` — project-scoped Asset Hub section forms,
  paging, and per-domain list/mutation tokens
- Surfaces and workbench pieces use `useState` / `useEffect` / refs for local
  presentation (form fields, focus, panel collapse, search query text)
- Pure helpers live beside state without hooks (`document-navigation`,
  `template-definition`, `search-navigation`, `analytics-view`,
  `editor-operations`, `asset-view`, `asset-state` factories)
- There is no project-wide third-party state library

Keep a feature-local effect or reducer inline when it is used once and its
ownership is clear. Cross-surface coordination belongs in the app controller,
not duplicated in each surface. Large P2 form/query/paging state stays in the
editor or asset hook — **not** in `app-state` / the app reducer.

## Creating A Custom Hook

Create a `useX` hook only when the same stateful behavior is shared by at least
two components or when extracting it makes lifecycle cleanup materially easier.
Give it an explicit return type and keep engine calls behind the owner boundary
(`lib/rpc.ts` + controller commands). For timers, pointer listeners, and
subscriptions, clean up in the effect return function and handle unmount/
restart explicitly (Strict Mode safe).

```tsx
function useDebouncedSave(
  save: (segmentId: string) => Promise<void>,
): { schedule(segmentId: string): void; flush(): Promise<void> } {
  // typed timer ownership; clear timers during cleanup
}
```

Prefer extending `SaveCoordinator` for draft/save behavior rather than
introducing a second debounce path in a component.

## Effects And Dependencies

- Include every changing value used by an effect in its dependency list.
- Use refs for mutable DOM/focus/timer handles, not for durable engine data.
- Use `void` for intentionally fire-and-forget async work and handle its error
  at the owner.
- Never make an effect itself an unhandled async function; define an inner
  async function and catch/report failures.
- Cancel pointer/document listeners, Engine status subscriptions, and pending
  timers on cleanup.
- Guard async completions with boot/reconnect generation IDs so stale retries
  cannot replace current state.
- P1 feature domains also use per-domain op counters (`beginOp` /
  `isOpCurrent` / `invalidateFeatureOps` in the app controller). Do not add a
  second ad-hoc “latest request id” pattern in a surface when the controller
  already owns that domain.
- P2 editor: keep **mutation** and **read** tokens separate so history/find
  cannot clear undo busy.
- P2 assets: keep **list** and **mutation** counters per domain; read
  query/form fields from a `stateRef` (or equivalent) **before** pending
  patches — never only inside a `setState` updater side effect.
- Editor target-affecting commands: composition block → `flushOrStay` → re-read
  authoritative revisions → invoke → verify token/generation → commit.

## Focus And IME

Focus refs are appropriate for recovery dialog handoff, panel expand/collapse,
and post-confirm advance. Composition state is tracked through
`lib/ime.ts` helpers and `SaveCoordinator.setComposing`:

- Between `compositionstart` and `compositionend`
- `event.isComposing === true`
- `keyCode === 229` or `which === 229`

While composition is active: no domain `updateTarget`, no `confirm`, no focus
advance, no selection mutation from the confirm path. Pause domain-save timers
during composition; journal local draft only. Keyboard handling must not
`preventDefault` a rejected composition event in a way that disrupts the IME.

## Avoid

- No hook that silently mutates global/localStorage state for every render.
- No hook that invents a second Engine client or bypasses `lib/rpc.ts`.
- No confirm/save path that omits the shared IME guard.
- No folding Asset Hub or editor panel form state into `use-app-controller`.
- No keyboard `preventDefault` for editor chords unless
  `resolveAcceptedEditorShortcut` (or equivalent registry gate) accepts them.
- No asset action that invents TM/corpus scores or parses exchange files.
