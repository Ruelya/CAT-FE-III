# Renderer performance budgets

Measured with `pnpm ui:perf`, which runs against a real production build in a
real Electron window. Every number below is observed, not estimated.

```bash
pnpm build:desktop
node scripts/ui-perf.mjs          # or ./scripts/linux-display.sh node scripts/ui-perf.mjs
```

The script writes `apps/desktop/test-results/ui-perf.json` and exits non-zero
when a budget is exceeded, so it can gate a release.

## Budgets and current measurements

| Budget | Limit | Measured | Headroom |
| --- | ---: | ---: | ---: |
| Initial renderer script, gzipped | 200 KiB | 170.7 KiB | 15 % |
| Renderer stylesheet, gzipped | 32 KiB | 9.8 KiB | 69 % |
| First contentful paint, cold | 1500 ms | 116 ms | 92 % |
| Font requests in a Latin-only session | 3 | 3 | at limit |
| Keystroke cost in the segment grid, median | 16 ms | 0.1 ms | 99 % |

Long tasks during a 40-keystroke typing run: none.

## How each budget was chosen

**Initial script.** The renderer must be interactive before a translator can do
anything, and this is a local file read rather than a network fetch, so the
limit is about parse and evaluate cost rather than transfer. 200 KiB gzipped
leaves room for roughly one more major feature area before a split is required.

**First contentful paint.** 1500 ms is the point at which a desktop application
launch stops feeling immediate. The measured 116 ms means the bundle is not the
constraint; Engine boot is.

**Font requests.** The four bundled type roles are Space Grotesk for display,
Chivo for interface, Space Mono for metadata, and Noto Sans SC for CJK content.
Noto Sans SC is 7.42 MB unsubsetted, so it is declared with a `unicode-range`
covering only CJK, Kana, and Hangul blocks and is never preloaded. A Latin-only
session therefore fetches three faces; the CJK face arrives only once a glyph
in one of those ranges is actually rendered.

The measurement confirms the strategy: **3 font requests before any CJK content
is on screen, 4 after.** A translator working into a Latin target language never
pays the 7.42 MB.

**Keystroke cost.** The target editor is where a translator spends the session,
so a keystroke must fit inside one frame. The metric measures the synchronous
work a discrete input event causes, which is where React renders and commits.
An earlier version of this script waited on `requestAnimationFrame` and so
reported a floor of about 16.7 ms for every sample regardless of actual cost;
that measured the display refresh interval, not the application.

## Deliberate non-optimisations

**No code splitting.** The plan reserved the option to split heavy feature
surfaces behind `React.lazy`. The measurement does not support it: the initial
script is 15 % under budget and first contentful paint is 116 ms, so splitting
would add dynamic-chunk loading, an Electron `loadFile` relative-path surface,
and an error-recovery path to solve a problem that does not exist. Revisit when
the initial script passes 180 KiB gzipped.

**No font subsetting.** Subsetting Noto Sans SC would reduce the 7.42 MB, but
`unicode-range` already keeps it out of a Latin-only session entirely, and a
subset risks missing a glyph in a translator's source text. The manifest records
the faces as unsubsetted deliberately.

## Residual risks

- Measurements come from a Linux validation lane under Xvfb with a window
  manager. Windows and macOS numbers are expected to differ, particularly first
  contentful paint, which depends on GPU compositor startup.
- Segment-grid scroll cost is not yet measured, because the current fixtures
  are single-segment. Measuring it needs a large-document fixture, tracked as
  residual work rather than claimed as verified.
