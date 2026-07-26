# WP2 eight-state evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer. The implementation keeps the branded state inventory at exactly
three loading states and five empty states; neutral request/error branches are
not counted as additional branded states.

## State matrix

| Kind | Variant | Accessible name / contract | Visual evidence |
| --- | --- | --- | --- |
| Loading | TM match | `TM lookup loading`; generation-safe lookup skeleton | `screenshots/wp2-loading-tm-match-1250x744-{light,dark-reduced}.png` |
| Loading | Assistant | `Assistant first token loading`; first-token skeleton after an accepted run | `screenshots/wp2-loading-assistant-1250x744-{light,dark-reduced}.png` |
| Loading | Preview | `PDF page loading`; page/block skeleton | `screenshots/wp2-loading-pdf-page-1250x744-{light,dark-reduced}.png` |
| Empty | TM match | `No exact TM match for this segment.` | `screenshots/wp2-empty-no-tm-match-1250x744-{light,dark-reduced}.png` |
| Empty | Terms | `No term hit in this segment.` | `screenshots/wp2-empty-no-term-hit-1250x744-{light,dark-reduced}.png` |
| Empty | QA | `No open QA issue.` | `screenshots/wp2-empty-no-open-qa-1250x744-{light,dark-reduced}.png` |
| Empty | Assistant | `No Assistant conversation yet.` | `screenshots/wp2-empty-no-assistant-conversation-1250x744-{light,dark-reduced}.png` |
| Empty | Grid | `No segment matches these filters.` plus enabled `Clear filters` | `screenshots/wp2-empty-grid-filters-1680x942-{light,dark-reduced}.png` |

`WorkbenchVisualState` renders loading states as `role="status"` with
`aria-live="polite"`, `aria-busy="true"`, and a static skeleton. Settled empty
states render as named `role="region"` surfaces without live/busy semantics or
a skeleton. Actions are owned by the parent surface, so only the grid state
receives a real recovery button. The component does not render a spinner. Unit
coverage also verifies that loading/error/empty presentation is mutually
exclusive.

## Verification

```text
pnpm --filter @translunar/desktop test -- WorkbenchVisualState.test.tsx
24 files / 145 tests passed

pnpm --filter @translunar/desktop typecheck
passed

pnpm --filter @translunar/desktop build
passed

pnpm exec prettier --check <focused WP2 files>
passed

pnpm exec playwright test tests/e2e/workbench.spec.ts --grep
  "exposes the five named Workbench empty states" --reporter=line
1 passed
```

The Electron coverage now captures all eight runtime states in both a light
baseline and a dark/reduced-motion baseline: 16 named images in total. The
test-only Engine delay contract holds selected real IPC calls long enough to
observe TM and PDF loading without replacing production request paths; the
Assistant fixture similarly delays its first readable SSE chunk. Assertions
verify that reduced-motion skeleton animation is disabled, all five empty-state
roles settle correctly, `Clear filters` remains functional, and the renderer
console stays clean. The online Assistant case additionally requires its dark
role/label contrast to be at least 4.5:1, its covered metadata to be at least
11px, and grounding, transcript, run status, and composer bounding boxes to
remain vertically ordered at 1250x744.
