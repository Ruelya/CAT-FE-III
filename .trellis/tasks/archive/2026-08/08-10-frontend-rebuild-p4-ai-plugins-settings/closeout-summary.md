# Closeout summary — Frontend rebuild P4 AI, plugins, collaboration, settings

## Task

- Path: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings`
- Branch: `task/08-10-frontend-rebuild-p4-ai-plugins-settings`
- Verdict: `green_for_closeout` (`review/findings-3.md`)
- Quality: review/verify/fix complete; verify-2 mission `satisfied`

## What shipped

P4 completes the frontend rebuild on top of P0–P3 with real Engine-backed destinations:

1. **AI Control** (`surfaces/AiControl.tsx`, `use-ai-controller.ts`)
   - Provider catalog/profile CRUD, schema projection, unknown-preserving config merge
   - Credentials only via `DesktopApi.setAiCredential`; settings revision-safe update
   - Conversations, grounding, interactive runs/events, apply, batch, usage, quality
   - Runnable profiles require `enabled && credentialPresent`; offset-aware paging
2. **Plugins** (`surfaces/Plugins.tsx`, `use-plugin-controller.ts`)
   - Installed/bundled lifecycle, inspect-before-mutate, permissions, AI actions
   - Authorized UI panel sessions (issue/mount/revoke/revocation event)
   - External connectors: schema/credential slots, typed V1 invoke, checkpoint display
3. **Collaboration** (`surfaces/Collaboration.tsx`, `use-collaboration-controller.ts`)
   - Project-scoped local members, locks, presence, assignments, op-log
   - Honest local-state labeling; chrome gated on project context
4. **Product Settings** (`surfaces/ProductSettings.tsx`, `use-product-settings.ts`)
   - Locale (shell patch `{ locale }` only), data directory, backup/restore, updates, tutorial
5. **Appearance-v1** (`state/appearance.ts`, `appearance-bootstrap.ts`)
   - Key `translunar.renderer.appearance.v1`: `{ version: 1, theme, accentSeed }`
   - Default light + `#765847`; dark + custom seed; total parse fallback; pre-React apply
   - Never written to `ProductShellSettings`
6. **Routing/chrome**
   - `AppSurface` kinds: `ai-control` | `plugins` | `collaboration` | `settings`
   - Save-before-P4 from Workbench; return rehydrates retained identity
   - Nav test IDs: `nav-ai-control`, `nav-plugins`, `nav-collaboration`, `nav-settings`

### Gates (from verify-2 / findings-3)

- Desktop typecheck green
- Unit: 275 passed
- Production build green
- Playwright P0–P4: **9 passed / 7 fixture-skipped / 0 failed**
  - P4 always-on (surface tour + appearance relaunch) passed
  - Deep AI/plugin/connector cases skip without `TRANSLUNAR_P4_*` fixtures

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/ai-plugins-settings.md` | **New** full P4 code-spec (7-section contracts) |
| `.trellis/spec/frontend/index.md` | Index row + pre-dev checklist for P4 / appearance-v1 |
| `.trellis/spec/frontend/directory-structure.md` | P4 surfaces/state layout + bootstrap |
| `.trellis/spec/frontend/electron-workbench.md` | Layout, DesktopApi shell/plugin methods, save-before-P4, pointers to P4 doc |
| `.trellis/spec/frontend/quality-guidelines.md` | Appearance-v1 audit, P4 tests, nav testids, E2E fixture env keys |

No product code changes in closeout. Task not archived (Orchestrator / finish-work).

## Suggested commit message

**Subject:**

```text
feat(desktop): P4 AI Control, plugins, collab, settings, appearance-v1
```

**Body:**

```text
Ship the frontend rebuild P4 surfaces on task/08-10-frontend-rebuild-p4-ai-plugins-settings:

- AI Control: providers/credentials/settings, conversations, grounding, runs,
  apply, batch, usage, quality with generation-scoped ownership and honest
  empty/unavailable states when no credential-backed profile exists
- Plugins: lifecycle, permissions, AI actions, authorized panel sessions,
  external connectors with schema-driven config and typed V1 invoke
- Collaboration: project-local members/locks/presence/assignments/op-log
- Settings: locale-only shell patch, data migration, backup/restore, updates,
  tutorial; appearance via translunar.renderer.appearance.v1 (light default,
  dark + custom accent seed, pre-React bootstrap)
- Chrome: nav-ai-control / nav-plugins / nav-collaboration / nav-settings with
  save-before-navigation from Workbench

Durable frontend specs updated under .trellis/spec/frontend/ (ai-plugins-settings
plus index, directory-structure, electron-workbench, quality-guidelines).

Quality: findings-3 green_for_closeout; 275 unit tests; P0–P4 Playwright
9 pass / 7 explicit fixture skips / 0 fail.

Residual: deep AI/plugin/connector E2E requires TRANSLUNAR_P4_* fixtures;
custom frameless title-bar chrome was out of P4 scope (default Electron frame).
```

## Residual risks

| Risk | Notes |
| --- | --- |
| Fixture-gated deep E2E | `TRANSLUNAR_P4_LOOPBACK_AI`, `TRANSLUNAR_P4_PLUGIN_FIXTURE`, `TRANSLUNAR_P4_CONNECTOR_FIXTURE` unset → 3 P4 deep cases skip; not pass evidence (F8 waiver) |
| Controller test depth | Some deferred controller/session suites thinner than implement plan; product paths closed structurally + always-on E2E |
| Title-bar chrome | Frameless/custom title bar **out of P4 scope** — default Electron frame remains; schedule follow-up if desired |
| Bundle size | Renderer chunk ~693 kB warning (non-blocking) |

## Orchestrator note

Title-bar frameless/custom chrome was **out of P4 scope** and remains default Electron frame — schedule follow-up if desired.
