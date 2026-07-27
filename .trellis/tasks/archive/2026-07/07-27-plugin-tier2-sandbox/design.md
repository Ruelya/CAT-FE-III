# Design: Tier 2 Sandboxed Plugin Host

## 1. Boundary and ownership

The Engine owns JavaScript execution, capability decisions, plugin lifecycle,
and contribution attachment. Electron main owns validated plugin asset serving.
The renderer owns only iframe presentation and the parent side of a typed
message bridge. Plugin code never imports Engine crates, receives SQLite or
filesystem handles, or enters the application preload.

```text
PluginManager / active immutable package
  -> SandboxHostRegistry
       -> one SandboxWorker per enabled plugin version
            rquickjs Runtime + Context
            confined ES-module resolver/loader
            typed invocation codec
            HostCallBroker -> DurablePluginCapabilityAuthorizer
       -> task-owned contribution adapters

Electron main
  -> PluginAssetSessionRegistry -> secure custom protocol
Renderer host component
  -> sandboxed iframe (opaque origin)
  -> nonce-bound MessageChannel -> typed bridge broker
```

Tier 2 is application-level isolation. QuickJS runs native code inside the
Engine process, so memory-unsafety in QuickJS or its bindings remains a host
risk. The dedicated Rust worker is a scheduling and failure-containment
boundary, not an OS process sandbox.

## 2. Runtime choice

Use `rquickjs` with its high-level safe bindings and macros disabled unless the
implementation needs them. Current documentation exposes runtime memory and
stack limits, an interrupt handler, and a custom `Resolver`/`Loader`. QuickJS
does not provide Node APIs by default, so all authority is introduced by our
own host bindings.

Reasons for this choice:

- native memory, stack, and interrupt controls satisfy the bounded-host
  requirement without supervising another Node process;
- a custom loader can reject every module outside the immutable package;
- the runtime is small enough to create one instance per active plugin version;
- Rust bindings can expose a deliberately tiny host object rather than a broad
  browser or Node environment.

The crate version and feature set are pinned in the workspace lockfile. Do not
enable a custom allocator mode that causes QuickJS memory limits to be ignored.
If a pinned release cannot demonstrate hard interrupt and memory tests on all
supported platforms, implementation stops before enabling sandbox packages;
falling back to unrestricted Node is not acceptable.

## 3. Runtime objects and thread model

`SandboxHostRegistry` is keyed by `(plugin_id, version_id)` and owns
`SandboxWorkerHandle`s. Each handle communicates with one named Rust thread via
a bounded request channel. The thread exclusively owns the `rquickjs::Runtime`
and `Context`; QuickJS values never cross the thread.

Worker states are:

```text
created -> initializing -> ready -> stopping -> stopped
                     |        |
                     +------> failed
```

Only `ready` accepts invocations. Queue admission assigns a host-generated
invocation ID and rejects overload before serializing work. Cancellation sets
an invocation-scoped atomic flag read by the QuickJS interrupt handler.
Deadline and shutdown use the same interrupt path. A failed or unresponsive
worker is removed from the registry before the plugin is degraded.

The initial ceilings are centralized constants, surfaced in documentation,
and tested at `limit - 1`, `limit`, and `limit + 1`:

| Resource | Limit |
| --- | ---: |
| QuickJS heap per plugin version | 32 MiB |
| QuickJS stack | 512 KiB |
| Initialization wall time | 1,000 ms |
| Invocation wall time | 2,000 ms |
| Graceful shutdown wall time | 500 ms |
| Source bytes per module | 1 MiB |
| Aggregate source bytes | 8 MiB |
| Module count | 128 |
| Pending worker requests | 32 |
| Invocation input/output JSON | 1 MiB each |
| Host-call request/result JSON | 256 KiB each |
| JSON nesting | 16 |
| Host calls per invocation | 256 |
| Diagnostic message | 4 KiB |

The timeout is wall-clock and includes promise-job draining and host-call wait
time. Limits may become configurable only through a later reviewed host policy;
plugins cannot raise them.

## 4. Module and entry contract

The manifest entry remains:

```typescript
type SandboxRuntimeDescriptorV1 = {
  tier: "sandbox";
  runtimeVersion: 1;
  entry: { kind: "javascript"; path: string; exportName?: string };
};
```

The package validator and runtime loader both normalize paths. The loader
accepts the entry plus relative imports ending in `.js` or `.mjs`. It rejects
bare specifiers, URL schemes, drive/UNC paths, query/fragment suffixes,
extension inference, directory indexes, traversal, symlinks/reparse points,
non-regular files, and graph/byte excess. Each open starts from the immutable
active-version root and revalidates metadata; it never joins against the source
installation directory.

The selected export is `default` unless `exportName` is present. It implements:

```typescript
export interface SandboxPluginV1 {
  activate?(context: SandboxLifecycleContextV1): void | Promise<void>;
  invoke(
    request: SandboxInvocationV1,
    host: SandboxHostV1,
  ): unknown | Promise<unknown>;
  deactivate?(context: SandboxLifecycleContextV1): void | Promise<void>;
}

export interface SandboxInvocationV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  operation: string;
  input: JsonValue;
}

export type SandboxResultV1 =
  | { protocolVersion: 1; ok: true; output: JsonValue }
  | {
      protocolVersion: 1;
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    };
```

The Rust codec parses from and serializes to JSON-compatible values, checks
depth/size before and after JavaScript, copies into owned Rust data, and rejects
cycles, functions, symbols, BigInt, typed/native handles, accessors, and custom
prototypes. Error codes are a closed SDK union; unexpected JavaScript details
become a safe `plugin_sandbox_failed` diagnostic.

## 5. Host-call broker

The only injected global is a frozen host facade passed to `invoke`. It offers
`call(request)` and bounded diagnostic emission. It does not expose an Engine
RPC function.

```typescript
interface SandboxHostCallV1 {
  protocolVersion: 1;
  requestId: string;
  method: string;
  params: JsonValue;
}
```

`SandboxHostCallRegistry` owns the method table. Each entry declares the exact
capability ID, scope derivation function, allowed contribution kind/operation,
input/output codec, concurrency policy, and handler. The host derives the
`PluginCapabilityCheck`; a plugin cannot choose or weaken it. The check includes
the active version, current contribution, current operation, and request scope,
then calls `authorize`, never registration preflight.

Unknown methods fail as `host_method_unsupported`. Duplicate IDs, calls after
cancellation, excess calls, stale versions, and results for a completed
invocation are discarded. Diagnostics strip control characters, paths, stack
traces, and values resembling credentials. Later children extend this registry
with typed handlers and tests rather than adding new globals.

## 6. Contribution attachment and compensation

The registry exposes a tier-neutral `prepare -> attach -> detach` adapter
contract. This child implements the minimum real adapter needed by the official
example and keeps future domain adapters separate.

Enable sequence:

1. Load the active immutable package and revalidate compatibility.
2. Run `authorize_registration` for each exact contribution/capability pair.
3. Create the worker and confined loader; evaluate the entry and run `activate`.
4. Prepare all task-owned adapters without publishing them.
5. Attach adapters and register UI surface metadata.
6. Persist enabled state and activation revision only after all steps succeed.

Any failure unwinds steps 5 through 2 in reverse order, closes asset/bridge
sessions, interrupts the worker, and leaves no candidate ownership entry.
Upgrade keeps the old runtime attached until the candidate reaches step 5;
failure removes the candidate and restores the old active version exactly.

Runtime failure first removes the handle and adapters from live registries,
then records one bounded durable crash/degraded transition. Disable, revoke,
uninstall, rollback, shutdown, and restart use the same idempotent teardown.

## 7. Plugin asset protocol

Electron registers a standard, secure custom scheme before `app.whenReady()`.
After readiness, `PluginAssetSessionRegistry` installs one protocol handler.
The Engine returns only validated UI surface metadata; Electron main maps a
fresh 256-bit base64url session ID to:

- window/webContents identity;
- plugin ID and active version/revision;
- contribution ID and bridge version;
- canonical active package root and surface document;
- creation/expiry timestamps and one state (`issued`, `bound`, `revoked`).

The URL is `translunar-plugin://<session-id>/<relative-file>`. It reveals no
filesystem path or plugin identity. The handler accepts `GET` only, rejects
credentials, ports, queries, fragments, ranges, redirects, encoded separators,
dot components, and unknown sessions, then performs the same canonical,
symlink/reparse, regular-file, module-count, and byte checks as the Engine.

Allowed responses are HTML, JavaScript modules, CSS, JSON data, common raster
images, SVG served as an image, and approved local fonts. HTML receives:

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'none';
worker-src 'none';
child-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```

Responses also set `X-Content-Type-Options: nosniff`, no-store cache policy,
and a restrictive referrer policy. MIME is determined from an allowlist, not
plugin-provided metadata. Session teardown makes all later requests return a
generic not-found response.

## 8. Iframe bridge

The renderer host uses `<iframe sandbox="allow-scripts">`; omitting
`allow-same-origin` deliberately gives the child an opaque origin. It has no
preload, Electron IPC, top navigation, popup, form, download, worker, or
network capability.

On a successful iframe load, the parent creates a fresh `MessageChannel` and
256-bit nonce, then transfers `port2` in a one-time initialization message.
The target origin must be `*` because the child is opaque; the parent trusts
neither origin nor ordinary follow-up `window.message` events. Authority is
the transferred port plus the main-issued session and nonce. The child must
echo the nonce and negotiate bridge version 1 on that port before either side
accepts application messages.

```typescript
type PluginPanelMessageV1 =
  | { version: 1; type: "ready"; nonce: string }
  | { version: 1; type: "request"; id: string; method: string; params: JsonValue }
  | { version: 1; type: "cancel"; id: string };

type HostPanelMessageV1 =
  | { version: 1; type: "context"; context: JsonValue }
  | { version: 1; type: "result"; id: string; result: JsonValue }
  | { version: 1; type: "error"; id: string; error: SafePluginError }
  | { version: 1; type: "revoked"; reason: string };
```

The parent validates discriminants, version, ID uniqueness, size/depth, state,
and method allowlist before forwarding to the existing trusted renderer API.
Each bridge method maps to a generated Engine request and capability rule; no
raw `invoke(method, params)` is exposed to the iframe. Navigation, reload,
timeout, protocol violation, close, disable, revoke, upgrade, or revision drift
closes both ports and asks main to revoke the asset session.

## 9. Official example and proof path

`examples/plugins/sandbox-toolkit` contains a manifest v2, an ES-module entry,
relative helper module, public-SDK typed source, and a static panel with
external JS/CSS. Its executable contribution performs one deterministic
bounded operation, while its panel exercises bridge handshake and one allowed
read-only request. It asks only for the exact contribution-scoped grants.

The Plugins panel exposes the example's panel as a management preview so the
generic host can be qualified before the later product-placement child. The
preview renders Engine-owned contribution metadata and error state; React
never imports the plugin module or reads package files.

## 10. Compatibility, diagnostics, and rollback

- Manifest/runtime/bridge versions remain `1`; changes are additive and old
  Tier 1/Tier 3 rows keep their current projections.
- Existing sandbox inventory becomes compatible only when every runtime,
  contribution, capability, and surface rule validates.
- Runtime heaps, invocation IDs, ports, nonces, and asset sessions are
  ephemeral. Durable state contains only lifecycle status, grants, audit, safe
  diagnostic code/message, crash count, and active version metadata.
- Removing the feature means marking sandbox compatibility false and detaching
  its host/asset adapters. It does not rewrite prior migrations or delete
  package/grant history.
- A native/runtime regression disables Tier 2 activation globally while
  preserving inventory and management; it never falls back to Node execution.

## 11. Security verification matrix

| Threat | Required evidence |
| --- | --- |
| Infinite loop / unresolved promise | interrupt at deadline; later RPC succeeds |
| Heap/stack exhaustion | bounded typed failure; affected plugin degrades |
| Path/import escape | install and runtime-loader rejection on Windows and Unix forms |
| Capability confusion | host-derived exact check; rename/operation spoof denied |
| Candidate activation failure | no attachment/session leak; old version remains usable |
| Iframe direct application access | no preload/Node/Electron/window.translunar |
| Network/navigation/popup/worker | CSP and iframe policy block with test evidence |
| Origin confusion/replay | nonce-bound transferred port; stale sessions rejected |
| Oversize/deep/malformed message | schema rejection and immediate port revocation |
| Disable/revoke/upgrade race | revision-bound teardown before later message handling |
