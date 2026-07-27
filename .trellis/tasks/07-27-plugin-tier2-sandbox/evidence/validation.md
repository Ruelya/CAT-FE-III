# Tier 2 Sandbox Validation Evidence

## Outcome

Tier 2 sandbox execution, lifecycle integration, the permissioned host-call
broker, Electron asset isolation, the opaque iframe bridge, and the official
`sandbox-toolkit` example satisfy AC-01 through AC-10. The full applicable
quality gate passed on Node `v24.17.0` and pnpm `10.18.3`. CI continues to
exercise the declared Node `22.17.0` and Node `24` matrix.

## Acceptance criteria traceability

| AC | Evidence |
| --- | --- |
| AC-01 | `crates/engine/src/plugin.rs::sandbox_toolkit_uses_bounded_runtime_and_detaches_cleanly` installs without grants, proves the contribution and runtime remain inactive, grants exact requests, enables exactly one sandbox runtime/filter adapter, proves no process plugin starts, and covers restart, disable, revoke, re-enable, and uninstall. `apps/desktop/tests/e2e/workbench.spec.ts::hosts a Tier 2 sandbox panel through an opaque revocable session` repeats the real packaged Electron install/review/enable path. |
| AC-02 | `crates/plugin-runtime/src/sandbox.rs` tests `published_limits_match_the_reviewed_policy`, `infinite_loop_is_interrupted_by_deadline`, `initialization_deadline_interrupts_top_level_script`, `heap_and_stack_failures_are_bounded_to_the_worker`, `bounded_queue_rejects_overload_before_serial_execution`, `shutdown_deadline_and_idempotent_teardown_are_bounded`, `cancellation_interrupts_running_javascript`, `host_call_count_payload_and_duplicate_ids_are_bounded`, `json_and_module_policy_boundaries_are_enforced`, `json_byte_and_module_graph_boundaries_cover_limit_minus_exact_and_plus`, and `default_module_count_and_aggregate_byte_limits_are_hard_boundaries`. Engine timeout coverage additionally proves an ordinary project RPC remains healthy. |
| AC-03 | Runtime tests `node_and_host_globals_are_absent`, `relative_loader_accepts_modules_and_rejects_bare_and_escape_imports`, `loader_rejects_symlink_escape`, `loader_rejects_windows_reparse_escape`, `package_hash_and_loaded_module_changes_are_rejected`, and `entry_contract_rejects_unknown_exports_members_and_accessors` cover globals, import confinement, indirection, module type/contract, and changed-file rejection. `host_calls_reject_unknown_denied_narrow_revoked_and_stale_authority` proves there is no arbitrary host/Engine method path. |
| AC-04 | Runtime tests `host_calls_are_typed_bound_and_limited`, `host_calls_reject_unknown_denied_narrow_revoked_and_stale_authority`, and `host_call_count_payload_and_duplicate_ids_are_bounded` cover the closed registry and typed denials. The production Engine registry exposes only `diagnostics.summary`, derives `diagnostics.read` scope `summary`, and binds it to the active filter contribution and `filter.validate`; `sandbox_toolkit_uses_bounded_runtime_and_detaches_cleanly` asserts the resulting `operation_allowed` audit entry. The official example invokes this real handler. |
| AC-05 | Engine tests `sandbox_upgrade_initialization_failure_keeps_active_version_usable`, `sandbox_upgrade_and_rollback_swap_prepared_runtimes`, and `sandbox_filter_collision_rejects_candidate_without_detaching_owner` prove candidate compensation, one-runtime ownership, usable rollback, and no partial adapter replacement. Desktop session unit/E2E tests prove navigation, disable, revoke, reload, and close remove matching ports/assets. |
| AC-06 | Runtime tests `malformed_and_non_json_results_fail_closed`, `heap_and_stack_failures_are_bounded_to_the_worker`, `filter_adapter_maps_runtime_failures_to_typed_filter_error`, and `diagnostics_are_bounded_and_do_not_echo_plugin_controlled_values` cover typed bounded failures. Engine test `sandbox_timeout_degrades_only_its_plugin_and_keeps_engine_healthy` proves only the affected plugin degrades, its runtime/filter detach, built-ins remain present, safe state persists, and ordinary Engine RPC still succeeds. Lifecycle failure handling revokes matching panel sessions. |
| AC-07 | Main test `serves an opaque session with strict headers and MIME` proves opaque URLs, single-use HTML entry loading, approved subtree module loading, strict plugin CSP, no-store/nosniff, and module CORS. Renderer/E2E evidence proves `sandbox="allow-scripts"`, no same-origin privilege, no preload/Node/Electron API, a nonce-negotiated transferred `MessagePort`, and successful closed `panel.context` exchange. |
| AC-08 | Main tests reject unsupported methods, ranges, query/fragment, MIME, expiry, normalized traversal, symlink/junction escape, async issue/serve races, stale owner/plugin/global generations, and use after revoke. Renderer tests reject unknown/wrong-version messages, non-empty `panel.context` params, cycles, custom prototypes, excess depth/nodes/keys/items/bytes, unknown cancellation, timeout, and late callbacks. Main IPC requires the trusted top-level frame. Real Electron E2E proves network denial, traversal denial, one-time entry replay denial, external navigation invalidation, and immediate disable/revoke/restart/reload/close invalidation. |
| AC-09 | The real Electron E2E installs the official package, reviews/grants permissions, enables its runtime/filter, loads a nonblank connected panel, exercises its bridge, restarts the Engine into a fresh session, reloads the renderer into a fresh session, then revokes, disables, and uninstalls it. Old session resources return 404 and non-CSP console/Engine/protocol errors remain empty. Screenshots are stored at `evidence/screenshots/plugin-tier2-panel-1250x744.png`, `plugin-tier2-panel-1680x942.png`, and `plugin-tier2-panel-1920x1080.png`; visual inspection and automated overflow assertions found no overlap, clipping, horizontal overflow, or blank iframe. |
| AC-10 | The complete command matrix below passed, including SDK/runtime/Engine/Desktop tests, contracts/docs checks, Engine smoke, production Desktop build, focused real Electron proof, and the complete Desktop E2E suite. |

## Validation commands

The following completed successfully after the production implementation and
security fixes:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm docs:check
pnpm test
pnpm --filter @translunar/plugin-sdk test       # 19 passed
pnpm --filter @translunar/desktop test          # 164 passed
pnpm --filter @translunar/desktop build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p translunar-plugin-runtime         # 42 passed
cargo test -p translunar-engine plugin          # 90 passed
cargo test --workspace
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:desktop                           # 31 passed, 1 existing skipped
```

After adding screenshot capture, the focused Tier 2 Electron test and Desktop
typecheck passed again. The complete Desktop E2E run took approximately eight
minutes. Its one skipped test predates this task and is not a Tier 2 sandbox
failure. The production Desktop build emitted the repository's existing Vite
chunk-size warning; it is a non-blocking advisory and did not fail the build.

## Dependency and security review

`cargo tree -p translunar-plugin-runtime` confirms the pinned chain
`rquickjs 0.12.1 -> rquickjs-core 0.12.1 -> rquickjs-sys 0.12.1`. The enabled
workspace feature is `loader`, and the three rquickjs crates declare the MIT
license. Their application-level isolation and native dependency residual risk
are documented in `SECURITY.md`; no OS-level sandbox claim is made.

`cargo audit` was not run because `cargo-audit` is not installed on this
machine (`cargo: no such command: audit`). This is recorded as a tooling gap,
not represented as a passing vulnerability scan. The resolved dependency tree,
pin, enabled feature, and rquickjs license metadata were inspected directly.
