# Desktop visual release qualification - design

## Evidence pipeline

```text
green children
  -> freeze candidate SHA + environment manifest
  -> clean production build
  -> static/unit/type/lint gates
  -> real-Engine Electron matrix
  -> accessibility/geometry/screenshots/performance
  -> AC ledger + residual report
  -> pass or route defect to owner and freeze a new candidate
```

## Evidence structure

Use task-local evidence directories grouped by `manifest`, `automated`,
`visual`, `manual`, `performance`, and `reports`. Each artifact names candidate,
runner, command/scenario, theme, viewport, state, and result. Generated binary
or privacy-sensitive output stays outside Git; sanitized hashes/manifests and
small screenshots follow repository policy.

## Matrix model

Define a machine-readable scenario matrix that composes:

- route/state owner;
- fixture/precondition;
- theme/accent;
- viewport/text-scale/motion mode;
- actions and semantic assertions;
- expected screenshot and console/error policy.

Shared helpers create state through user-facing/Engine boundaries. They do not
mock persistence or patch `window.translunar` to manufacture a pass.

## Defect routing

| Finding | Owner |
| --- | --- |
| Token/font/primitive | visual foundation |
| Chrome/boot/recovery/dialog/titlebar | shell |
| P0/P1 lifecycle/search/QA/export | lifecycle surfaces |
| Workbench/editor/PDF/reimport | Workbench |
| Insights/interop/task/assets | insights/assets |
| AI/plugins/collab/settings | P4 |
| Cross-surface a11y/responsive/state | accessibility audit |
| Bundle/font loading/runtime performance | performance |

Qualification adds only evidence/harness fixes. Product findings return to the
owner and invalidate affected and downstream evidence.

## Compatibility and residuals

The existing Full PRD release task remains open. The final report links into it
and explicitly lists native/manual/fixture lanes that remain. A frontend summit
pass means its bounded integrated contracts are green on the candidate; it does
not assert overall release readiness.
