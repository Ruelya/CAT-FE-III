# Hook Guidelines

## Current Pattern

The app uses React built-ins plus one primary controller hook:

- `state/use-app-controller.ts` — boot, session routing, surface transitions,
  Engine status/reconnect, recovery, and command wiring for surfaces
- Surfaces and workbench pieces use `useState` / `useEffect` / refs for local
  presentation (form fields, focus, panel collapse)
- There is no project-wide third-party state library

Keep a feature-local effect or reducer inline when it is used once and its
ownership is clear. Cross-surface coordination belongs in the app controller,
not duplicated in each surface.

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
