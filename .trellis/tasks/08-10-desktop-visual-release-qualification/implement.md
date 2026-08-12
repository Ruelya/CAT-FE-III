# Desktop visual release qualification - implementation plan

## Candidate freeze

- [ ] Confirm all eight preceding children are green and their evidence is
      candidate-compatible.
- [ ] Require a clean task-related worktree, freeze SHA and output hashes, and
      record runner/toolchain/lockfile metadata.
- [ ] Build the parent/child AC ledger and mark missing evidence as fail or
      blocked-external before running tests.

## Automated qualification

- [ ] Run format, lint, typecheck, unit/integration, production build, static
      appearance/icon, and real-Engine P0-P4/titlebar E2E gates.
- [ ] Run the shared route/state/viewport/theme/text-scale/motion matrix with
      full axe impacts, keyboard/focus assertions, geometry checks, screenshots,
      and console/page error capture.
- [ ] Provision P3/P4 fixtures where available; record exact skipped scenario,
      environment key, and unproven behavior otherwise.
- [ ] Rerun performance/delivery budgets and production/package asset checks on
      the same candidate and environment.

## Manual/native qualification

- [ ] Record available Windows keyboard, focus, CJK IME, 125% scaling, contrast,
      reduced motion, and custom-titlebar checks.
- [ ] Link or leave explicit open rows for macOS titlebar/font/VoiceOver,
      NVDA/VoiceOver, real OS IME, forced colors, or other unavailable lanes.
- [ ] Ensure no manual row is marked pass without runner, candidate, procedure,
      result, and evidence.

## Final commands

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build:desktop
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
pnpm test:e2e:desktop
pnpm package:dir
pnpm release:package:check
```

## Review and defect loop

- [ ] Triage every failure to the owning child; qualification itself receives
      only harness/evidence fixes.
- [ ] After a product fix, freeze a new candidate and rerun every affected and
      downstream lane; retain prior failed evidence.
- [ ] Publish a final frontend-summit report with pass/fail/blocked rows,
      warnings, fixture skips, native gaps, and relationship to the ongoing
      Full PRD release qualification.

## Exit gate

All frontend-summit blocker/major rows pass on one candidate. Any unavailable
native/manual/fixture row remains explicit and is handed to the broader release
task; it is never counted as green evidence.
