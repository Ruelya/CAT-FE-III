# Plugin SDK

Translunar CAT exposes a versioned local plugin contract with two currently
executable runtime tiers:

- **Tier 1 declarative** packages contain only a manifest. The Rust host
  evaluates bounded UTF-8 filters, regex QA packs, and deterministic JSON
  pipeline transforms. No plugin code or child process is loaded.
- **Tier 3 process** packages use newline-framed JSON-RPC over stdio for
  process-isolated document filters.

Tier 2 sandboxed JavaScript and the remaining connector, AI action, and UI
panel hosts are separate runtime surfaces and are not implied by Tier 1.

## Package layouts

```text
# Tier 1: manifest only
my-toolkit/
  manifest.json

# Tier 3: process entry
my-filter/
  manifest.json
  bin/entry.mjs
```

See `examples/plugins/tier1-toolkit` for a complete Tier 1 filter, QA pack,
and pipeline transform. See `examples/plugins/hello-srt` for the Tier 3 SRT
filter built with `@translunar/plugin-sdk`.

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

## Develop

```powershell
pnpm --filter @translunar/plugin-sdk test
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:desktop
```

TypeScript helpers live in `@translunar/plugin-sdk`. Rust protocol schema and
generated TypeScript contracts must remain synchronized with
`pnpm contracts:check`.
