# Desktop visual release qualification

## Goal

Qualify the completed desktop frontend summit as one immutable integrated
candidate. This task aggregates child evidence, reruns the full UI quality
matrix, and returns defects to their owning child; it does not become a final
catch-all redesign task or duplicate the broader Full PRD release program.

## Relationship to full release qualification

`07-19-full-prd-release-qualification` remains the authority for complete
product NFRs, native packages, fidelity corpus, usability studies, security,
signing, and overall release approval. This child qualifies only the frontend
summit's visual, interaction, accessibility, responsive, performance-delivery,
and P0-P4 regression scope. Its pass is input evidence to that larger task, not
a release approval.

## Dependencies and ownership

- Runs last, after all eight implementation/audit children are green.
- Owns the candidate manifest, evidence ledger, integrated screenshots and
  assertions, full quality commands, residual-risk report, and defect routing.
- Product fixes return to the child that owns the affected layer; after a fix,
  freeze a new candidate and rerun every invalidated lane.

## Requirements

### R1 - Immutable candidate and ledger

- Record candidate commit, dirty-state check, dependency lock hash, Node/pnpm/
  Rust/Electron versions, OS/architecture, build output hash, commands, duration,
  counts, skips, warnings, and evidence paths.
- Map every parent AC and every child AC to current-candidate executable or
  manual evidence. Older-SHA evidence is contextual only.
- Use `pass`, `fail`, `blocked-external`, or `not-applicable`; fixture-gated
  skips and absent native/manual runs are never converted to pass.

### R2 - Visual and state matrix

- Cover every route family and owned nested state: boot/reconnect/recovery;
  lifecycle/search/QA/export; Workbench/editor/TM/PDF/reimport; Insights/
  interop/task packages/Assets; AI/plugins/collaboration/settings.
- Capture light/dark, default/custom accent where relevant, 1180x700,
  1250x744, 1680x942, 1920x1080, 125% text scaling, long CJK/identity data,
  reduced motion, and defined loading/empty/error/pending/confirmation states.
- Screenshots must show the actual state; numeric geometry, DOM semantics, and
  workflow assertions determine pass. No overlap, clipping, document overflow,
  blank canvas, broken asset, or hidden primary action is accepted.

### R3 - Accessibility and interaction evidence

- Run complete axe impact reporting, keyboard-only navigation, focus entry/
  restoration, menus/tabs/dialogs/collapsibles, field errors, live statuses,
  and named controls across the matrix.
- Record Windows native checks available in this environment and carry macOS,
  NVDA/VoiceOver, real OS IME, and forced-color limitations explicitly to the
  broader release task when they cannot run here.
- Verify computed reduced-motion behavior and both-theme contrast; do not rely
  on token inspection alone.

### R4 - Behavior and delivery regression

- Run unit/integration, strict typecheck, formatting/lint, production desktop
  build, static material/icon audit, and all P0-P4/titlebar real-Engine E2E.
- Exercise packaged or production-loaded renderer assets, fonts, lazy chunks,
  titlebar behavior, session/appearance persistence, and zero unexpected
  console/page errors.
- Provision named P3/P4 fixtures where available. Every unavailable deep case
  remains a named residual with the exact environment key and consequence.

### R5 - Performance evidence

- Consume the performance child's environment-bound budgets and rerun its
  candidate checks. Record regressions rather than replacing the budget with a
  looser final number.
- Verify that instrumentation/evidence tooling does not ship in production or
  alter the runtime behavior being measured.

## Acceptance criteria

- [ ] AC1: The candidate manifest and AC ledger are complete, hash/SHA-bound,
      reproducible, and contain no stale or prose-only pass claim.
- [ ] AC2: Every route/state family has named visual and geometry evidence for
      the required themes, viewports, text scale, CJK/long-content, and reduced
      motion lanes, with no overlap, clipping, blank content, or overflow.
- [ ] AC3: Axe, keyboard, focus, names, status, dialog/menu/tab/collapse, and
      contrast checks pass; manual/native limits remain explicitly unpassed.
- [ ] AC4: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm build:desktop`, static audits, and `pnpm test:e2e:desktop` pass on a
      supported Node lane with zero unexpected console/page errors.
- [ ] AC5: All required P0-P4/titlebar workflows pass against the real Engine;
      fixture-gated skips are reported by name and are not counted as passes.
- [ ] AC6: Renderer performance/delivery budgets and production/package asset
      checks pass on the frozen candidate.
- [ ] AC7: Every blocker/major defect is fixed in and rerun from its owning
      child; the final report clearly separates frontend-summit pass from the
      broader release qualification still in progress.

## Out of scope

- Full PRD fidelity corpus, usability/productivity studies, connector/provider
  breadth, API/CLI parity, signing/notarization, installer qualification, or
  final release approval.
- Waiving a failed product behavior, broad visual changes, or adding new
  features during qualification.
- Treating screenshots, archive status, or historical test totals as current
  candidate proof.

## Blocking questions

None. External/native gaps can block the corresponding evidence row but cannot
be relabeled as a pass or silently removed from the ledger.
