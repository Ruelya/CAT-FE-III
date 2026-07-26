# Implementation Plan: Tier 2 Sandboxed Plugin Host

## Preconditions

- [x] Confirm parent scope, PRD P-01/P-02/P-09, design notes, and security
      claim boundary.
- [x] Trace complete manifest/runtime/contribution validation, capability
      authorization, lifecycle compensation, Electron sender checks, CSP, and
      current SDK types.
- [x] Confirm a maintained `rquickjs` release exposes memory/stack limits,
      interrupt handlers, and custom module resolution/loading.
- [ ] Review and explicitly approve this final planning summary.
- [ ] Run `task.py start` only after approval.
- [ ] Load `trellis-before-dev` and the backend/frontend specs before editing.

## Ordered implementation

### 1. Runtime dependency and public contracts

- [ ] Pin `rquickjs` and the minimum feature set in workspace dependencies.
- [ ] Add SDK types for lifecycle, invocation/result, safe errors, host calls,
      panel messages, limits, and helper validation without exposing Engine
      internals.
- [ ] Add Rust equivalents/codecs and generated protocol projections where the
      Engine/Desktop boundary requires them.
- [ ] Tighten sandbox entry and UI surface validation with package-relative
      file, module extension, version, and compatibility diagnostics.

### 2. Confined module loader and bounded worker

- [ ] Implement canonical active-package resolver/loader with dual install-time
      and runtime checks, byte/module/depth ceilings, and Windows reparse tests.
- [ ] Implement `SandboxWorker`, bounded queue, state machine, per-version
      registry, memory/stack/GC configuration, deadline/cancel interrupt, and
      deterministic teardown.
- [ ] Evaluate the selected ES-module export and implement activate/invoke/
      deactivate with promise-job draining and JSON boundary validation.
- [ ] Map timeout, cancellation, memory, module, codec, script, and disconnect
      failures to typed safe diagnostics with no source/path/stack leakage.

### 3. Host-call broker and lifecycle integration

- [ ] Implement a closed typed host-call registry whose entries derive exact
      capability/scope/operation checks and bounded codecs.
- [ ] Add initial bounded diagnostics/read-only handlers required by the
      official example; reject arbitrary Engine method names.
- [ ] Integrate sandbox prepare/attach/detach into `PluginManager`, capability
      revoke, enable/disable/uninstall, restart, upgrade/rollback, and shutdown.
- [ ] Add the minimum real contribution adapter used by the official example,
      with ownership collision checks and atomic compensation.
- [ ] Make sandbox compatibility depend on the executable host and validated
      contribution/surface contract rather than inventory-only projection.

### 4. Secure plugin asset sessions

- [ ] Add main-process custom scheme registration before readiness and one
      protocol handler after readiness.
- [ ] Implement opaque expiring session issuance bound to window, plugin,
      active version/revision, contribution, root, surface, and bridge version.
- [ ] Implement GET-only canonical file serving, MIME allowlist, byte limits,
      CSP/security headers, generic denial responses, and idempotent revocation.
- [ ] Add typed main/preload APIs for session issue/revoke that validate the
      trusted top-level sender and never expose paths or grants.

### 5. Opaque iframe and message bridge

- [ ] Add a reusable renderer host with `sandbox="allow-scripts"`, stable
      loading/error/revoked states, and no nested decorative card.
- [ ] Implement one-time nonce + transferred `MessageChannel` negotiation,
      versioned schemas, bounded payloads, request IDs, deadlines,
      cancellation, and closed method routing.
- [ ] Revoke on navigation, reload, close, timeout, invalid message,
      disable/revoke/upgrade, revision change, and window destruction.
- [ ] Expose the bounded management preview for a valid UI panel contribution;
      keep general workbench placement deferred to `plugin-ai-ui-host`.

### 6. Official example, docs, and specifications

- [ ] Add `examples/plugins/sandbox-toolkit` using only public SDK contracts,
      a relative module, deterministic executable operation, and static panel.
- [ ] Extend public plugin docs with entry/module/limit/host-call/bridge/lifecycle
      contracts and exact example commands.
- [ ] Update `SECURITY.md` with application-level isolation and residual native
      dependency risks.
- [ ] After implementation checks pass, update backend Engine/plugin and
      frontend Electron/plugin specs through `trellis-update-spec`.

### 7. Focused tests

- [ ] Runtime: valid lifecycle, promise result, no Node globals, every resource
      ceiling, infinite loop, cancellation, malformed/cyclic/prototype values,
      path/import/reparse escape, and clean teardown.
- [ ] Authorization: unknown/spoofed method, missing/narrow/revoked/stale grant,
      exact contribution and operation binding, call count/payload bounds.
- [ ] Engine: install/grant/enable/invoke/restart/disable/uninstall, collision,
      timeout/degraded isolation, revoke detach, upgrade success, failed
      candidate compensation, and another-plugin/builtin health.
- [ ] Desktop main: scheme/session binding, method/path/MIME/header/CSP limits,
      expiry/replay/revision/close revocation, and trusted sender enforcement.
- [ ] Renderer: iframe attributes, handshake, schema/version/depth/size/ID
      validation, timeout/cancel, invalidation, accessible loading/error states.
- [ ] Real Electron: official package review/enable, actual iframe content and
      bridge exchange, blocked dangerous APIs/network/navigation, restart with
      fresh session, revoke/disable/uninstall, zero page/console/protocol errors.

## Validation commands

Run focused commands during each slice, then the full gate once after the final
implementation/review fixes:

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p translunar-plugin-runtime
cargo test -p translunar-engine plugin
cargo test --workspace
pnpm --filter @translunar/plugin-sdk test
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:desktop
```

Run `pnpm test:e2e:engine` when its documented PDF/OCR native prerequisites are
available. If they remain absent, record the exact missing tools and do not
represent the skipped suite as passing. Execute Node-facing checks on Node 24
locally and retain the declared Node 22/24 CI matrix.

## Review gates

- [ ] Inspect `cargo tree -p translunar-plugin-runtime` and license/security
      implications of the embedded runtime before commit.
- [ ] Verify no QuickJS value, filesystem path, runtime token, port, or secret
      crosses its owning boundary or enters durable state/logs.
- [ ] Verify all limit constants have boundary tests and all cancellation paths
      close worker/session resources exactly once.
- [ ] Verify every host/bridge method has a closed codec and host-derived
      capability check; there is no generic Engine invoke escape hatch.
- [ ] Inspect real screenshots and iframe DOM at 1250x744, 1680x942, and
      1920x1080; confirm no overlap, clipping, or document overflow.
- [ ] Run an independent inline code review after implementation and resolve all
      correctness/security findings before the final full gate.

## Risky files and rollback points

- `Cargo.toml`, `Cargo.lock`, `crates/plugin-runtime/**`: keep the executor
  capability-gated until limit and interrupt tests pass. Roll back by restoring
  sandbox compatibility=false; never substitute Node.
- `crates/engine/src/plugin.rs`, `plugin_capability.rs`: preserve Tier 1/Tier 3
  lifecycle and exact registration authorization. Candidate attach must remain
  compensating and idempotent.
- `apps/desktop/src/main/index.ts` and new protocol/session modules: scheme
  registration ordering and sender/session binding are security-critical.
- Renderer bridge/preload/shared types: iframe messages must not acquire the
  trusted top-level preload API or generic Engine invocation.
- SDK/generated contracts/examples: additive compatibility only; regenerate
  structured contracts and never hand-edit generated outputs.

## Completion and archive

- [ ] Acceptance criteria AC-01 through AC-10 map to reproducible evidence.
- [ ] Full applicable quality gate passes after the last code change.
- [ ] Specs and task evidence are updated without staging unrelated dirty files.
- [ ] Commit implementation, commit task completion metadata, archive this child
      immediately, and then materialize the next dependency-ready plugin child.
