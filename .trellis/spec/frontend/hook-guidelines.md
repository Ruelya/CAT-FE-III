# Hook Guidelines

## Current Pattern

The app currently uses React built-ins directly. `App.tsx`, `Workbench.tsx`,
`WorkbenchPages.tsx`, and `AssistantPanel.tsx` use `useState`, `useEffect`,
`useMemo`, `useReducer`, and refs; there is no project-wide custom hook layer.
Keep a feature-local effect or reducer inline when it is used once and its
ownership is clear.

## Creating A Custom Hook

Create a `useX` hook only when the same stateful behavior is shared by at least
two components or when extracting it makes lifecycle cleanup materially easier.
Give it an explicit return type and keep engine calls behind the owner boundary.
For timers, pointer listeners, and subscriptions, clean up in the effect
return function and handle unmount/restart explicitly.

```tsx
function useDebouncedSave(
  save: (segmentId: string) => Promise<void>,
): { schedule(segmentId: string): void; flush(): Promise<void> } {
  // typed timer ownership; clear timers during cleanup
}
```

The example is a shape, not a reason to extract `Workbench`'s current save
logic prematurely. Preserve the existing `persistSegment`/
`persistAllSegments` ownership until a second consumer exists.

## Effects And Dependencies

- Include every changing value used by an effect in its dependency list.
- Use refs for mutable DOM/focus/timer handles, not for durable engine data.
- Use `void` for intentionally fire-and-forget async work and handle its error
  at the owner (`void persistSegment(...)` in `Workbench.tsx`).
- Never make an effect itself an unhandled async function; define an inner
  async function and catch/report failures.
- Cancel pointer/document listeners and pending timers on cleanup.

## Focus And IME

Focus refs are appropriate for panel transition handoff and issue navigation.
Composition state is tracked per segment in a ref so Ctrl/Cmd+Enter cannot
confirm while an IME candidate is active. Keep `event.nativeEvent.isComposing`
and keyCode 229 checks at the keyboard boundary.

## Avoid

- No hook that silently mutates global/localStorage state for every render.
- No effect that derives authoritative counts from visible rows.
- No custom hook that returns `any` or an untyped `unknown` payload to callers.
- No stale closure workaround that suppresses the exhaustive-deps rule without
  documenting the lifecycle invariant.
