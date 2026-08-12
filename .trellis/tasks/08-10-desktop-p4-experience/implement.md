# Desktop AI, plugins, collaboration, and settings experience - implementation plan

## Preconditions

- [ ] Begin after the Insights/Assets task is green; read the P4 spec and parent
      UX/history audits.
- [ ] Inventory every P4 section, async state, form, destructive action, raw
      technical detail, navigation semantic, and scroll owner.
- [ ] Capture baseline light/dark screenshots and always-on P4 test results at
      1180x700 and the existing three-view matrix.

## Implementation sequence

- [ ] Establish shared P4 section navigation, toolbar/form/status/table/detail
      patterns without introducing a new component framework.
- [ ] Refine AI profile/credential/settings/run/batch/usage/quality presentation;
      preserve typed schema, secret path, tokens, paging, and explicit apply.
- [ ] Refine plugin lifecycle/permissions/actions/panels and connector profile/
      credential/invoke flows; add confirmed destructive paths and bounded
      issued-session failure/revoke presentation.
- [ ] Refine local collaboration members/locks/presence/assignments/op-log;
      label controls/actions and retain local-only truth.
- [ ] Refine Settings locale, appearance, data, backup/restore, updates, and
      tutorial sections; preserve appearance-v1 and command matrices.
- [ ] Complete form error association, status announcements, section keyboard
      behavior, long-content wrapping, four-view geometry, and reduced motion.
- [ ] Run always-on P4 E2E, then each named deep fixture lane when available;
      record unavailable fixtures rather than altering the test.

## Focused validation

```text
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
pnpm build:desktop
pnpm --filter @translunar/desktop exec playwright test tests/e2e/p4-ai-plugins-settings.spec.ts
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
```

Fixture lanes, when provisioned:

```text
TRANSLUNAR_P4_LOOPBACK_AI=1
TRANSLUNAR_P4_PLUGIN_FIXTURE=1
TRANSLUNAR_P4_CONNECTOR_FIXTURE=1
```

Also run P0-P3 E2E regressions before closeout.

## Review gates

- [ ] No secret, arbitrary JSON operation, optimistic domain fact, or unissued
      plugin panel path appears in presentation code.
- [ ] Destructive actions confirm and close only after current success.
- [ ] Appearance uses only the versioned renderer preference; shell settings
      remain locale-only.
- [ ] Every visible destination/section is real and context-valid; absent
      capabilities are not represented as dead tabs.
- [ ] Skipped deep fixture cases are named residuals, not green totals.

## Rollback points

- Shared P4 visual/navigation primitives.
- AI surface and focused controller wiring.
- Plugins/connectors surface and confirmation/session wiring.
- Collaboration surface/presence presentation.
- Settings surface/appearance presentation.

If a domain unit regresses its Engine/security contract, revert that domain
without reverting previously green P4 domains.
