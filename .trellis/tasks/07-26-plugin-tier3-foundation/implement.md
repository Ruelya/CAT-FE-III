# Implementation Plan: Tier 3 Foundation Qualification

## Work packages

1. Add duplicate-id fail-closed validation and no-side-effect Engine tests.
2. Preserve typed plugin process/permission errors through filter and Engine
   boundaries; persist degraded state and unregister failed contributions.
3. Add crash/timeout fixtures and prove Engine survival plus restart behavior.
4. Run the real plugin-sdk TypeScript suite and rebuild hello-SRT from public
   SDK source into a self-contained entry.
5. Extend Engine smoke and desktop E2E for typed failure, lastError/degraded
   presentation, accessibility, console safety, and three viewport screenshots.
6. Update backend/frontend executable specs, capture evidence, run independent
   Codex check, commit, finish, and immediately archive this child.

## Validation

```powershell
pnpm --filter @translunar/plugin-sdk test
pnpm --filter @translunar/plugin-sdk build
cargo test -p translunar-plugin-runtime
cargo test -p translunar-engine plugin
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm --filter @translunar/desktop exec playwright test tests/e2e/workbench.spec.ts -g "plugin"
```

The finish gate additionally runs strict workspace Clippy and the relevant
full Engine/Desktop E2E commands if focused changes affect shared paths.

## Constraints

- Use direct shared-worktree edits; do not mechanically reapply agent diffs.
- Use Codex agents only and keep ownership boundaries disjoint.
- Do not commit or archive the plugin parent from this child.
- Never stage or delete the protected workspace screenshot.
