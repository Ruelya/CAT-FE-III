# WP2 eight-state evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer. The implementation keeps the branded state inventory at exactly
three loading states and five empty states; neutral request/error branches are
not counted as additional branded states.

## State matrix

| Kind | Variant | Accessible name / contract | Visual evidence |
| --- | --- | --- | --- |
| Loading | TM match | `TM lookup loading`; generation-safe lookup skeleton | Unit contract |
| Loading | Assistant | `Assistant first token loading`; first-token skeleton after an accepted run | Unit contract |
| Loading | Preview | `PDF page loading`; page/block skeleton | Unit contract |
| Empty | TM match | `No exact TM match for this segment.` | `screenshots/wp2-empty-no-tm-match-1250x744-light.png` |
| Empty | Terms | `No term hit in this segment.` | `screenshots/wp2-empty-no-term-hit-1250x744-light.png` |
| Empty | QA | `No open QA issue.` | `screenshots/wp2-empty-no-open-qa-1250x744-light.png` |
| Empty | Assistant | `No Assistant conversation yet.` | `screenshots/wp2-empty-no-assistant-conversation-1250x744-light.png` |
| Empty | Grid | `No segment matches these filters.` plus enabled `Clear filters` | `screenshots/wp2-empty-grid-filters-1680x942-light.png` |

`WorkbenchVisualState` renders each state as `role="status"` with
`aria-live="polite"`. Loading states set `aria-busy="true"` and contain a
static skeleton; empty states have no `aria-busy` and no skeleton. Actions are
owned by the parent surface, so only the grid state receives a real recovery
button. The component does not render a spinner. Unit coverage also verifies
that loading/error/empty presentation is mutually exclusive.

## Verification

```text
pnpm --filter @translunar/desktop test -- WorkbenchVisualState.test.tsx
24 files / 144 tests passed

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

The focused Electron E2E asserted all five named empty-state roles, enabled and
functional `Clear filters` recovery, and an empty browser-console error list.
The screenshots above are the generated artifacts from that run.

## Remaining visual gate

The focused run intentionally captures the five empty states only, in light
theme (four at 1250x744 and the grid at 1680x942). Engine requests in the test
fixture resolve too quickly to produce stable runtime screenshots of the three
loading states. Dark-theme, reduced-motion, and loading screenshot/manual
checks therefore remain open; the loading behavior itself is covered by the
presentational unit contract and request-state wiring.
