# Desktop renderer performance and delivery hygiene - implementation plan

## Preconditions and baseline

- [ ] Start from the green integrated accessibility task result.
- [ ] Build production output and record chunk, CSS, font, and total renderer
      bytes, including the approximately 693 kB historical warning comparison.
- [ ] Define deterministic ordinary/large fixtures and collect cold/warm timing,
      layout, frame, long-task, and input samples with environment metadata.
- [ ] Write explicit budgets and no-regression tolerances before editing code.

## Optimization sequence

- [ ] Audit dependency consumers and remove only proven unused renderer cost.
- [ ] Measure font requests/paint/CLS; implement the minimum preload/display/
      fallback strategy that preserves offline and CJK requirements.
- [ ] Inspect bundle graph; add feature boundaries only where initial-cost gain
      exceeds loading-state and cache complexity.
- [ ] Profile Workbench renders, virtualization, handlers, and panel visibility;
      fix only measured hot paths while preserving stable identity/focus.
- [ ] Add local error/retry and stable pending geometry for every deferred
      module; verify reconnect and session routing during load.
- [ ] Validate built and packaged relative assets, dynamic chunks, fonts,
      preload/main output, and absence of external requests.
- [ ] Repeat the identical measurement suite and publish before/after results.

## Validation

```text
pnpm --filter @translunar/desktop build
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test
pnpm build:desktop
pnpm --filter @translunar/desktop exec playwright test
pnpm package:dir
pnpm release:package:check
rg -n "(?:src|href)=['\"]\/assets|https?://" apps/desktop/dist/renderer
```

Run focused timing/trace scripts defined by the task, then the root final gates
through the qualification child. Inspect build logs for chunk warnings rather
than treating exit zero as sufficient.

## Review gates

- [ ] Every optimization cites a baseline finding and after-measurement.
- [ ] Lazy boundaries remain keyboard/focus/announcement complete.
- [ ] CJK and fallback screenshots show stable geometry before/after font load.
- [ ] No test waits rely on arbitrary sleeps introduced by code splitting.
- [ ] Package smoke uses local production assets and no network dependency.

## Rollback points

- Dependency manifest/lockfile cleanup.
- Font declarations/preloads/fallback metrics.
- Feature import boundaries and local error states.
- Workbench profiling-driven render changes.

Revert any family that misses behavior, accessibility, or delivery gates even
when its performance number improves.
