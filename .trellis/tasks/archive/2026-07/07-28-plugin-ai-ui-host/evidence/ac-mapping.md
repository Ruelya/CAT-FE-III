# Acceptance-Criteria Evidence — plugin-ai-ui-host

Date: 2026-07-30

This mapping supersedes the earlier narrow-toolbar-only note. Historical logs
that contain an intermediate failure remain useful remediation records, but
they are not final gate evidence; see `final-review.md` for the latest results.

| Criterion | Status | Reproducible evidence |
| --- | --- | --- |
| AC-01 | PASS | `packages/plugin-sdk/src/ai-ui.test.ts`; `crates/plugin-runtime/src/ai_ui.rs` tests; `focused-tests.log` (SDK 34/34, runtime 4/4); current `pnpm contracts:check` pass in `final-review.md`. |
| AC-02 | PASS | `crates/engine/src/plugin_ai_ui.rs` registry owner/collision/detach tests; `crates/engine/src/plugin.rs::sandbox_toolkit_uses_bounded_runtime_and_detaches_cleanly`; lifecycle/upgrade/rollback cases in `engine-plugin-tests.log`. |
| AC-03 | PASS | `crates/engine/src/plugin_ai_ui.rs` context shaping, cancellation registry, and exact capability tests; sandbox toolkit action execution/history assertion in `crates/engine/src/plugin.rs`; focused Rust results in `final-review.md`. |
| AC-04 | PASS | Invalid/oversized result coverage in runtime tests; timeout/host-failure health cases in `engine-plugin-tests.log`; renderer cancellation and stale-revision guards in `PluginAiActions.tsx` plus `PluginAiActions.test.ts`. |
| AC-05 | PASS | Exact-generation panel registry test; `PluginWorkbenchPanels.test.ts`; focused Electron test in `desktop-e2e-ai-ui-lifecycle.log` proves declared editor placement, explicit open/close, close persistence, and a connected real iframe while built-ins remain present. Engine lifecycle tests cover detach/restart/upgrade/rollback. |
| AC-06 | PASS | `PluginPanelHost.test.tsx` (closed codec, method-shaped host params, Engine `panel.context` omits workbench identifiers, timeout-through-pending-RPC); `plugin-asset-sessions.test.ts`; Engine bridge owner/method/parameter/nested-capability tests in `plugin_ai_ui.rs`. Preview host now forwards `versionId` + mapped methods. |
| AC-07 | PASS | Role/name-driven Electron assertions in `workbench.spec.ts`; generated owner/version/state rendering in `PluginAiActions.tsx` and `PluginWorkbenchPanels.tsx`; toolbar geometry assertion and inspected screenshots at all three target viewports. |
| AC-08 | PASS | `desktop-e2e-ai-ui-lifecycle.log` (2/2): Tier 2 opaque panel session + AI/UI placement lifecycle after action accept — Engine restart/reload reconnection, required permission revoke/detach, re-grant/enable, upgrade to 1.0.1 with exact revision/version ownership, rollback to original, disable/uninstall with surfaces absent, and a healthy ordinary Engine `project.list` RPC. |
| AC-09 | PASS | Engine history test asserts serialized history excludes input/output text; storage records only bounded provenance fields; bridge/action diagnostics normalize codes and omit raw method/payload text; contract is recorded in `.trellis/spec/backend/engine-boundary.md`. |
| AC-10 | PASS | Supported Node v24.11.1: lint, typecheck, contracts, docs, 174/174 desktop unit tests, production build, and complete Electron E2E (33 passed, 1 skipped) pass. The earlier supported-Node full workspace/SDK/Rust/Engine-smoke gates also pass and were unaffected by the final renderer-only bridge fix. Root Prettier reports only unrelated `codexgoal.md`; every task-owned file passes formatting. See `final-review.md`. |

## Viewport evidence

- `screenshots/plugin-ai-ui-editor-1250x744.png`
- `screenshots/plugin-ai-ui-editor-1680x942.png`
- `screenshots/plugin-ai-ui-editor-1920x1080.png`

The 1250x744 E2E path additionally checks pairwise visible toolbar geometry,
containment inside `.editor-region`, and absence of document-level horizontal
overflow.

## Bridge regression remediation (this pass)

Root cause of `#status === Unavailable` in real Electron:

1. `resolvePanelBridgeResult` forwarded workbench `projectId`/`segmentId` on
   every method, including `panel.context`, which Engine rejects as unknown
   fields.
2. Plugins-panel preview omitted `versionId`, so owner tokens failed generation
   match (`""` vs active version id).
3. Host display labels were overwritten by Engine contribution aliases; merge
   order now prefers host `pluginName`/`contributionName`.
