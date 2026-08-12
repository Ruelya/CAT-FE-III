# Desktop renderer performance and delivery hygiene - design

## Measurement-first flow

```text
production build
  -> artifact/chunk/font inventory
  -> built Electron timing + trace samples
  -> React/Chromium interaction profiles
  -> written baseline and budgets
  -> smallest evidence-backed optimization
  -> identical after-measurement + regression matrix
```

No optimization lands before the task records a baseline and a causal
hypothesis.

## Loading boundaries

The shell, boot/recovery gates, startup resolver, and current surface contract
remain eagerly reliable. Candidate lazy boundaries are feature-heavy P3/P4
surfaces and controllers, selected only from bundle analysis. Each boundary has
a fixed-geometry pending state, local error boundary/retry path, and stable
accessible announcement.

Dynamic imports must resolve through Vite's relative production paths in an
Electron `file:` context. No URL router or duplicate route state is introduced.

## Font strategy

- Foundation owns family/role choice; this task owns loading mechanics and
  delivery proof.
- Critical Latin UI faces may load early; Space Mono and the large CJK face load
  only where evidence supports the cost, while fallback metrics reserve stable
  geometry.
- Package and runtime checks enumerate every expected font and verify no remote
  request. Any subsetting must retain the declared Simplified Chinese coverage
  and licensing/provenance.

## Interaction profiling

Use deterministic fixtures and Chromium performance traces for:

- boot to first stable surface;
- project open to usable Workbench;
- virtualized segment scroll;
- target typing and confirm;
- PDF/TM/editor-panel combinations;
- navigation to a lazy heavy surface and recovery from a load error.

Report median and tail samples. Frame/long-task assertions complement, rather
than replace, functional E2E.

## Rollout and rollback

Optimizations land one family at a time: dependency cleanup, font loading,
feature splitting, then render-path fixes. Each family gets before/after proof
and can be reverted independently. A behavior or accessibility regression
invalidates the optimization even if a budget improves.
