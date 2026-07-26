# Tier 2 Sandboxed Plugin Host

## Goal

Ship the executable Tier 2 host promised by P-01, P-02, and P-09: installed
JavaScript plugins run inside a bounded Engine-owned runtime, and plugin UI
documents run inside an isolated Electron iframe with a narrow, permissioned
message bridge. A timeout, cancellation, malformed message, denied host call,
or plugin failure must not compromise the Engine, renderer, built-in
contributions, or the previously active plugin version.

## User value

Plugin authors can add logic and UI without requiring a trusted Node process,
while users retain explicit control over the data and operations each plugin
may access. The product can demonstrate the boundary with an official package,
durable lifecycle state, and real desktop evidence instead of advertising an
inventory-only sandbox tier.

## Confirmed baseline

- `docs/PRD.md` and `docs/design-notes.md` define Tier 2 as sandboxed
  JavaScript for UI panels and logic-bearing actions, using an isolate/iframe
  plus `postMessage` API surface.
- Manifest v2 already normalizes `runtime.tier = "sandbox"`, a package-relative
  JavaScript entry, and every contribution descriptor. Package paths reject
  absolute paths, traversal, symlinks, and reparse points.
- Tier 2 packages are currently inventory-only and incompatible. There is no
  JavaScript executor, worker lifecycle, host-call broker, plugin asset
  protocol, iframe bridge, or Tier 2 E2E.
- Durable capability requests, grant/revoke decisions, registration preflight,
  operation authorization, audit, active-version rollback, and contribution
  ownership already exist and remain authoritative.
- The desktop renderer already uses `contextIsolation: true`, `sandbox: true`,
  no Node integration, sender-checked IPC, denied popups, same-origin
  navigation, and a restrictive application CSP.
- `SECURITY.md` permits claims about application-level isolation only. This
  task cannot claim AppContainer, seccomp, filesystem virtualization, or other
  OS-level containment.

## Requirements

### R1. Bounded JavaScript runtime

- Add one Engine-owned Tier 2 runtime per enabled plugin version. The runtime
  must execute on a dedicated worker boundary and must not expose Node,
  filesystem, network, environment, process, native module, shell, or raw
  Engine globals.
- Use a maintained embedded JavaScript engine with supported memory, stack,
  interrupt, and custom module-loader controls. The implementation must pin the
  dependency and document its enabled features.
- Apply explicit ceilings to memory, stack, entry/module bytes, module count,
  input/output bytes and depth, queued work, host calls, initialization,
  invocation, and shutdown. Limits must be constants covered by boundary tests.
- Deadline expiry and cancellation must interrupt running JavaScript, not only
  abandon a waiting Rust future. A wedged plugin must be discardable without
  blocking another plugin or ordinary Engine RPC.

### R2. Confined module loading and stable SDK contract

- Resolve only relative `.js`/`.mjs` modules inside the active immutable
  package version. Reject bare specifiers, absolute paths, traversal,
  symlink/reparse traversal, unsupported extensions, oversized graphs, and
  changes detected after validation.
- Publish versioned SDK request, result, lifecycle, error, and host-call types.
  The selected module export must expose the documented Tier 2 entry contract;
  unknown exports and malformed return values fail closed.
- Cross-boundary values are JSON-compatible data with bounded depth and size.
  Functions, symbols, cycles, typed native handles, and arbitrary object
  prototypes never cross the boundary.

### R3. Permissioned host-call broker

- Expose a small method allowlist owned by the host. Each registered host method
  maps to one typed capability and scope rule; plugin-supplied method names or
  operation strings cannot manufacture authority.
- Bind every call to plugin ID, active version, contribution ID, invocation ID,
  and operation. Authorize it through the durable capability service at the
  moment of use and preserve a typed denial without leaking secrets.
- Bound concurrent calls and payloads, sanitize diagnostics, and reject stale,
  duplicate, unsolicited, or post-cancellation responses.
- Later Engine/QA/pipeline/AI/external children may add typed broker handlers;
  they must not bypass this boundary or expose arbitrary `EngineMethod` access.

### R4. Transactional lifecycle and failure isolation

- Enable must preflight exact contribution registration grants, construct and
  initialize the worker, and attach all owned adapters atomically. Partial
  failure detaches every candidate contribution and destroys the candidate
  runtime.
- Disable, required-capability revoke, uninstall, upgrade, rollback, Engine
  shutdown, and unexpected plugin failure must cancel work, detach adapters,
  invalidate UI sessions, and destroy the matching runtime.
- A timeout, panic-equivalent runtime error, malformed result, memory failure,
  or worker disconnect durably degrades only the affected plugin version,
  records a bounded safe diagnostic, and leaves built-ins and other plugins
  usable.
- Upgrade does not detach the previous active version until the candidate has
  initialized and attached. Failed activation compensates to the previous
  version and its exact grants/contributions.
- Engine restart rehydrates only enabled, compatible, fully granted versions
  and creates fresh workers and UI sessions; no JavaScript heap or token is
  persisted.

### R5. Isolated plugin UI documents

- Electron main serves only validated files from the active package through a
  dedicated secure custom protocol. The public URL uses an opaque, expiring
  session identifier rather than a filesystem path, plugin ID, or grant data.
- The protocol handler accepts only bounded `GET` requests, canonicalizes and
  revalidates every path, applies a MIME allowlist and strict response headers,
  denies directory listing/ranges/redirects, and returns a plugin-document CSP
  that disables network, forms, objects, child frames, workers, inline script,
  eval, and WebAssembly.
- Render plugin documents in an iframe with `sandbox="allow-scripts"` only.
  Do not add `allow-same-origin`, a preload, Node integration, Electron IPC, or
  direct access to `window.translunar`.
- Establish the bridge with a fresh `MessageChannel`, an unpredictable
  single-session nonce, protocol/bridge version negotiation, and a transferred
  port. Because the iframe has an opaque origin, authority comes from the
  token-bound port and validated schemas, not from trusting `event.origin`.
- Parent and plugin messages must use discriminated, versioned envelopes with
  bounded IDs/payloads. Unknown type/version, replay, invalid state, oversize,
  timeout, and navigation invalidate the session and fail closed.
- Disable, revoke, upgrade, panel close, navigation, renderer reload, and
  window destruction revoke the session and close its port immediately.

### R6. Official example and observable product path

- Ship an official Tier 2 example package that uses only public SDK contracts,
  contains executable JavaScript and a static UI document, and requests only
  the exact capabilities it exercises.
- Prove real install, permission review, enable, invocation, iframe handshake,
  bounded message exchange, restart, disable/revoke, and uninstall through the
  Engine and packaged Electron boundary. The example must not rely on a test-
  only evaluator or private Engine import.
- The Plugins management surface may expose a bounded preview/diagnostic entry
  for the official panel. Product-specific AI action placement and general
  workbench panel registration remain assigned to the later AI/UI host child.

### R7. Documentation and honest security posture

- Document the Tier 2 entry contract, module rules, resource limits, lifecycle,
  capability mapping, iframe bridge, example package, and failure semantics in
  public plugin docs and generated SDK types.
- Update `SECURITY.md` to distinguish embedded-runtime and iframe isolation
  from OS sandboxing and to state the residual risks of native host code and
  the Electron/QuickJS dependency chain.
- Do not describe this work as a browser security boundary, multi-tenant
  containment, or protection against a compromised host application.

## Acceptance criteria

- [ ] AC-01: A valid sandbox package installs, remains inactive before grant,
      enables only after exact required grants, initializes one bounded worker,
      and registers its task-owned contribution without starting Node or an
      external executable.
- [ ] AC-02: Unit tests prove memory, stack, deadline, cancellation, input,
      output, JSON depth, module count/bytes, queue, and host-call ceilings;
      infinite loops are interrupted and a subsequent ordinary Engine RPC
      succeeds.
- [ ] AC-03: Tests prove no Node/filesystem/network/process globals, no bare or
      escaping module imports, no symlink/reparse escape, no unsupported module
      type, and no arbitrary Engine method access.
- [ ] AC-04: Every allowed host call is derived from a registered typed handler,
      authorized for the exact active version/contribution/operation, and emits
      typed denial/audit behavior for missing, narrowed, revoked, or stale
      authority.
- [ ] AC-05: Enable/upgrade failure leaves no candidate adapter, worker, port,
      or asset session; upgrade compensation restores the previous active
      version and its usable contribution.
- [ ] AC-06: Timeout, malformed result, runtime failure, and worker loss detach
      only the affected plugin, persist a bounded degraded diagnostic, close UI
      sessions, and leave built-ins, another plugin, and ordinary RPC usable.
- [ ] AC-07: A plugin UI document loads only through an opaque active session,
      runs in `sandbox="allow-scripts"`, receives the strict plugin CSP, lacks
      preload/Node/Electron APIs, and communicates only through the negotiated
      token-bound `MessagePort` schema.
- [ ] AC-08: UI security tests reject stale/replayed tokens, unknown messages,
      wrong versions, oversize/deep payloads, direct IPC, external navigation,
      network/worker/frame attempts, package traversal, and use after
      disable/revoke/upgrade/close/reload.
- [ ] AC-09: The official example completes real Engine lifecycle and Electron
      panel evidence, survives Engine/app restart with a fresh runtime/session,
      and is absent after revoke/disable/uninstall with no page, console, or
      Engine protocol errors.
- [ ] AC-10: SDK tests, focused runtime/Engine tests, desktop unit tests, real
      Electron E2E, `pnpm contracts:check`, format/lint/typecheck/tests/docs,
      Cargo fmt/Clippy/tests, Engine smoke, and desktop build pass on the
      supported Node 22/24 lines where applicable.

## Out of scope

- Full AI action registration, placement, prompt execution, and general
  workbench UI contribution UX; these belong to `plugin-ai-ui-host`.
- Engine connector, QA/pipeline adapter, and external connector domain
  contracts; those children reuse this host and broker.
- Tier 3 native-process hardening, WASM, a remote marketplace, code signing,
  billing, remote indexing, or mandatory online distribution.
- AppContainer, seccomp, containers, per-plugin OS users, filesystem
  virtualization, or a claim that hostile native code is contained.

## Constraints

- Preserve manifest v1, Tier 1, Tier 3, existing installations, generated
  protocol contracts, and public SDK compatibility.
- The Engine remains authoritative for lifecycle, grants, contribution
  identity, failures, and active package paths. React never evaluates plugin
  code or invents plugin state.
- No secrets, raw source documents, local paths, environment values, stderr,
  or unbounded plugin payloads may appear in renderer state, logs, diagnostics,
  audit records, or error messages.
- Planning and implementation are inline in the main Codex session per the
  user's explicit workflow choice; no channel worker context is required.

## Blocking open questions

None. Product scope and isolation claims are fixed by the repository PRD,
design notes, security policy, and parent task.
