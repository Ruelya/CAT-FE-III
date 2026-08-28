# Renderer performance budgets

## Current status: no measurement harness

The `pnpm ui:perf` harness that produced the numbers previously recorded here
was deleted together with the pre-greenfield renderer. The current tree has no
performance measurement script, and no budget is currently enforced or
claimed. The old measurements (initial script size, first contentful paint,
keystroke cost, font-request counts) described a renderer and font stack that
no longer exist; treat them as history, not as facts about this application.

## What to measure when a harness returns

The budget categories remain sensible for a desktop CAT tool and are worth
re-establishing against the current renderer:

- Initial renderer script and stylesheet size (gzipped). The bundle is a
  local file read, so the limit is about parse and evaluate cost rather than
  transfer.
- First contentful paint of a cold launch.
- Synchronous keystroke cost in the segment grid at the median. A keystroke
  must fit inside one frame; measure the discrete input event cost, not
  `requestAnimationFrame` intervals.
- Grid scroll cost on a large document. The Playwright suite already
  exercises grid virtualization on a large document
  (`pnpm test:e2e:desktop`), which guards behavior but does not measure
  latency.

Budgets should be set from measurements of this renderer, not inherited from
the deleted one.
