# Desktop renderer performance and delivery hygiene

## Goal

Measure and improve renderer startup, initial delivery, font cost, dense-editor
interaction, layout stability, and Electron production asset loading after the
integrated UI is functionally and accessibly green. Optimizations must be based
on recorded baselines and must preserve deterministic P0-P4 behavior.

## Background

- The P4 closeout recorded an approximately 693 kB renderer chunk warning; the
  current output must be rebuilt and measured before treating it as active.
- Adopting four bundled font families includes an approximately 7.8 MB CJK
  asset, so loading strategy and package provenance must be measured.
- Vite uses `base: "./"`; Electron loads production files locally. Any split
  chunk or font path must work under `loadFile()` and packaging.
- The segment grid already virtualizes dense content and must retain stable
  scrolling, selection, editing, IME, and focus behavior.

## Dependencies and ownership

- Runs after `08-10-desktop-accessibility-responsive-state-audit`, from the
  fully integrated UI baseline, and before final visual qualification.
- Owns measurement harnesses, loading boundaries, font delivery, renderer
  render-path optimization, Vite output configuration, and delivery evidence.
- Does not redesign surfaces, alter Engine performance claims, or weaken test
  determinism. Backend capacity/NFR benchmarks remain owned by the full PRD
  release-qualification program.

## Requirements

### R1 - Reproducible baseline and budgets

- Record commit, OS, CPU/RAM, Node/Electron versions, cold/warm conditions,
  sample count, fixture, commands, and raw measurements before changes.
- Measure initial JS/CSS/font assets, chunk graph, renderer navigation cost,
  cold renderer-ready time, Workbench first usable time, layout shifts, and
  representative scroll/edit input latency.
- Set acceptance budgets from the measured baseline and parent product gates.
  Required minimums: no regression over baseline, ordinary frame work within
  16 ms, interaction feedback within 100 ms, and no material layout shift.

### R2 - Initial renderer delivery

- Feature-split only heavy surfaces whose deferral materially lowers initial
  cost. Boot, recovery, shell, and current startup destination remain reliable.
- Lazy boundaries include stable pending and typed failure/retry states, do not
  flash an incorrect route, and do not make Playwright timing nondeterministic.
- Remove an unused dependency only after confirming every package consumer;
  current unused-looking `lucide-react` declaration is a candidate, not an
  assumed deletion.

### R3 - Font delivery

- Use local WOFF2 assets with `font-display: swap` or `optional` according to
  measured legibility/CLS, preload only critical faces, and preserve offline CJK
  coverage and theme-first paint.
- Record font bytes, loaded faces per representative surface, fallback metrics,
  first/settled screenshots, CJK glyph coverage, and packaged asset presence.
- No external font request, invisible text interval, clipped fallback text, or
  late font-induced control overlap is allowed.

### R4 - Dense interaction performance

- Preserve segment virtualization and stable row/editor geometry for large
  documents. Avoid unnecessary root rerenders, layout read/write thrashing,
  high-frequency unbounded handlers, and expensive hidden panels.
- Measure scroll and typing on representative ordinary and large fixtures with
  PDF/TM/panels combinations. Optimizations may memoize or extract only where
  profiler evidence identifies meaningful work.
- Async state and code splitting must preserve operation-token, save, IME,
  focus, and reconnect behavior.

### R5 - Production delivery integrity

- `dist/renderer`, Electron main/preload output, dynamic chunks, source maps as
  configured, fonts, and relative URLs load in built and packaged applications.
- Startup and route errors surface bounded recovery rather than a blank stage.
- Build output contains no missing assets, unintended external requests,
  duplicate font payloads, unexpected console/page errors, or unsupported
  absolute `/assets` URLs.

## Acceptance criteria

- [ ] AC1: A checked-in task evidence report records reproducible before/after
      measurements, budgets, environment, samples, fixtures, and raw artifacts.
- [ ] AC2: Initial renderer JS/CSS and cold/first-usable timings improve or stay
      within the accepted no-regression tolerance; all budget thresholds pass.
- [ ] AC3: Ordinary editor frame work is <=16 ms and visible action feedback is
      <=100 ms in the defined fixture; large-fixture behavior has no regression.
- [ ] AC4: Font loading is offline, CJK-complete for the chosen subset, within
      the recorded payload budget, and causes no visible FOIT/CLS/overlap.
- [ ] AC5: Any feature split has deterministic pending/error/retry behavior and
      preserves boot, recovery, direct route selection, navigation, and tests.
- [ ] AC6: Built and packaged smoke evidence proves relative dynamic chunks,
      fonts, preload/main output, and Engine startup load without missing assets
      or unexpected network requests.
- [ ] AC7: Focused performance checks and the full desktop quality gates pass
      with zero behavior, accessibility, screenshot, console, or page errors.

## Out of scope

- Rust Engine throughput, million-pair TM capacity, package signing/notarizing,
  or the full product cold-start/capacity qualification owned by the release
  task.
- A service worker, CDN, web deployment, remote fonts, or replacing Vite.
- Speculative memoization, broad architecture changes, or hiding content to
  achieve a number.

## Blocking questions

None. Exact numeric initial-bundle and startup budgets are intentionally set
from the recorded baseline during this task, before optimization begins.
