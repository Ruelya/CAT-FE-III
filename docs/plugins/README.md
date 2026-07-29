# Plugin SDK

Translunar CAT exposes a versioned local plugin contract with three currently
executable runtime tiers:

- **Tier 1 declarative** packages contain only a manifest. The Rust host
  evaluates bounded UTF-8 filters, regex QA packs, and deterministic JSON
  pipeline transforms. No plugin code or child process is loaded.
- **Tier 3 process** packages use newline-framed JSON-RPC over stdio for
  document filters, QA rules, engine connectors, and resumable pipeline steps.
- **Tier 2 sandbox** packages run JavaScript ES modules in an Engine-owned
  QuickJS runtime and may expose isolated desktop panel documents. They never
  run through Node or the Tier 3 process host.

Engine connector and QA/pipeline contracts have closed Tier 2 and Tier 3
adapters. Public AI actions and workbench panels are executable Tier 2
surfaces; see [`ai-ui-sdk.md`](./ai-ui-sdk.md). External connectors remain a
separate inventory/connector path.

## Package layouts

```text
# Tier 1: manifest only
my-toolkit/
  manifest.json

# Tier 3: process entry
my-filter/
  manifest.json
  bin/entry.mjs

# Tier 2: sandboxed logic and panel
my-sandbox-toolkit/
  manifest.json
  entry.mjs
  lib/helper.mjs
  panel/index.html
  panel/panel.mjs
  panel/panel.css
```

See `examples/plugins/tier1-toolkit` for a complete Tier 1 filter, QA pack,
and pipeline transform. See `examples/plugins/hello-srt` for the Tier 3 SRT
filter built with `@translunar/plugin-sdk`.

See `examples/plugins/sandbox-toolkit` for the official Tier 2 package. It uses
only public SDK types, a relative module, a deterministic invocation, and a
static panel.

See `examples/plugins/qa-pipeline-process` and
[`qa-pipeline-sdk.md`](./qa-pipeline-sdk.md) for the public deterministic QA
rule and resumable pipeline-step contract.

## Tier 2 contract

The SDK exports `defineSandboxManifest`, `SandboxPluginV1`, lifecycle,
invocation/result, safe error, host-call, panel message, and limit contracts.
The selected entry export is `default` unless `exportName` is set. It must be
an object with `invoke`; optional `activate` and `deactivate` hooks may return a
promise. All values crossing the runtime boundary are finite JSON values.
Functions, symbols, BigInt, cycles, accessors, custom prototypes, native
handles, and values deeper than 16 levels are rejected.

Sandbox modules must use explicit relative `.js` or `.mjs` specifiers. Bare
packages, URLs, absolute/drive/UNC paths, traversal, extension inference,
directory indexes, links/reparse points, and files outside the immutable
active package are rejected on validation and again on load.

The fixed host policy is:

| Resource | Limit |
| --- | ---: |
| QuickJS heap / stack | 32 MiB / 512 KiB |
| Initialization / invocation / shutdown | 1,000 / 2,000 / 500 ms |
| Module / graph source | 1 MiB / 8 MiB |
| Module count / queued requests | 128 / 32 |
| Invocation / host-call JSON | 1 MiB / 256 KiB |
| JSON depth / host calls per invocation | 16 / 256 |
| Safe diagnostic | 4 KiB |

Deadline, cancellation, and shutdown use the runtime interrupt path. A failed
runtime is discarded and only its active plugin version becomes degraded.
The runtime has no Node, filesystem, network, environment, process, shell,
native module, or generic Engine invoke global.

Host calls use a closed method table. The host derives plugin/version,
contribution, operation, capability, and scope; plugin parameters cannot name
an Engine method or manufacture authority. Every call rechecks the durable
grant. Unknown methods, stale authority, duplicate IDs, post-cancel results,
and calls beyond the fixed bounds fail closed with a typed safe error.

The initial method is `diagnostics.summary`. It accepts only
`{ "category": "summary" }` during `filter.validate`, is bound to the invoking
filter contribution, and requires that contribution's exact
`diagnostics.read` / `summary` grant. Its result contains bounded host-derived
runtime status and contribution metadata; it never returns logs, paths,
document content, environment values, or a generic Engine method result.

Panel files load only from an opaque, expiring `translunar-plugin://` session.
The iframe has `sandbox="allow-scripts"` without `allow-same-origin`, preload,
Node, Electron IPC, or `window.translunar`. A fresh 256-bit nonce and transferred
`MessagePort` negotiate bridge version 1. Only closed, bounded message schemas
are accepted; navigation, close, reload, disable, revoke, upgrade, revision
change, expiry, or protocol failure closes the port and asset session.

## Tier 1 contract

Tier 1 definitions are versioned and reject unknown fields. They support:

- UTF-8 filters with extension/header probing, one bounded unit regex, a
  required named `source` capture, optional `id` and `context` captures,
  immutable-source drift checks, and no-clobber export;
- QA packs using the existing bounded `QaRegexRule` evaluator;
- JSON transforms with `select`, `set`, `assert`, and `regexReplace`
  operations, explicit artifact kinds, cancellation, and byte limits.

Tier 1 definitions cannot access the filesystem directly, network, processes,
environment variables, clocks, random state, AI providers, or Engine services.

The SDK exports `defineDeclarativeManifest`, `defineDeclarativeFilter`,
`defineDeclarativeQaPack`, and `defineDeclarativePipelineStep` builders.

## Lifecycle and consent

```text
plugin.inspect
plugin.install
plugin.permission.review
plugin.permission.grant   # one explicit scoped decision per request
plugin.enable
plugin.disable
plugin.uninstall
```

Installation never grants authority. The legacy `grantRequested` field remains
wire-decodable but has no consent effect. Enable is all-or-nothing across every
contribution. Restart restores only the enabled active version; disable,
revocation, rollback, and uninstall detach only the owning plugin.

Runtime operations check the durable grant again. Tier 1 filters use
`file.read`/`file.write`; QA packs use `qa.register`; pipeline transforms use
`pipeline.register`. Allowed and denied operations are written to the
immutable capability audit.

For Tier 2, enable constructs and activates the candidate runtime before its
adapters become visible. Upgrade keeps the prior version usable until the
candidate is ready. Any attach failure compensates the candidate completely.
Restart always creates a fresh JavaScript heap, asset token, nonce, and port;
none of those values are persisted.

## Develop

```powershell
pnpm --filter @translunar/plugin-sdk test
cargo test -p translunar-plugin-runtime
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:desktop
```

To try the official package, open Plugins, install
`examples/plugins/sandbox-toolkit`, review and grant its exact `ai.action` and
`ui.panel` requests, then enable it. Use the Assistant tab for the terminology
rewrite action (accept the proposal explicitly) and the Plugins workbench tab
for the mounted panel. Disable or revoke a grant to detach the exact generation
and close active sessions immediately.

TypeScript helpers live in `@translunar/plugin-sdk`. Rust protocol schema and
generated TypeScript contracts must remain synchronized with
`pnpm contracts:check`.
