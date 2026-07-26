# WP5 segment density and virtualization evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer.

## Delivered behavior

- The active-row toolbar keeps the four frequent actions directly available:
  protected-tag copy, protected-tag insertion, protected-tag pair insertion,
  and comments. Split, merge, source correction, Chinese conversion, and
  review are grouped under one labeled overflow menu.
- Direct and overflow controls use Lucide icons, accessible names, tooltips,
  and stable 32px hit boxes. Protected-tag and issue evidence remains visible
  in the row; no cell was converted into a card or decorative illustration.
- Segment/status/tag/autocomplete/issue metadata is at least 11px. The active
  edge is 2px, while the existing `EDITOR_ROW_HEIGHT` and virtualization math
  remain authoritative.
- Overflow closes on blur and Escape; Escape returns focus to its trigger.
  Composition guards prevent split, merge, source correction, conversion,
  comments, and review commands from firing while a CJK IME composition is
  active.

## Focused verification

```text
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "keeps active segment actions quiet and IME-safe at 125% zoom"   pass
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "uses the authoritative professional editor commands"             pass
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "keeps a 10,000 segment document"                                  pass
pnpm exec prettier --check <focused files>                            pass
pnpm --filter @translunar/desktop typecheck                          pass
pnpm lint                                                             pass
pnpm --filter @translunar/desktop build                              pass
```

The 125% test asserts four direct toolbar controls, one overflow trigger,
32px geometry with DPI tolerance, menu keyboard return, IME suppression,
save/confirm behavior, and no document/root/toolbar horizontal overflow at
1250x744, 1680x942, and 1920x1080. The 10,000-row test retains the shared row
height and spacer/scroll budget contract.

## Visual evidence

| Viewport | Screenshot |
| --- | --- |
| 1250x744 at 125% | `screenshots/wp5-segment-density-1250x744-125pct.png` |
| 1680x942 at 125% | `screenshots/wp5-segment-density-1680x942-125pct.png` |
| 1920x1080 at 125% | `screenshots/wp5-segment-density-1920x1080-125pct.png` |

The captures show the active source/target pair as the strongest row focus,
quiet direct tools, visible issue/tag evidence, and a single overflow menu
without clipping or horizontal scroll.
