# Backend Logging Guidelines

## Logging Boundary

The engine uses `tracing` and initializes one JSON formatter in
`crates/engine/src/main.rs`. Diagnostics always go to stderr. Stdout is
reserved exclusively for newline-delimited JSON-RPC responses; any ordinary
print to stdout corrupts the process protocol.

The default filter comes from `RUST_LOG` through `EnvFilter`. Code must remain
useful at the default filter and may add `debug`/`trace` events for opt-in
diagnostics without changing protocol behavior.

## Levels

- `error`: the current operation cannot proceed or a protocol frame cannot be
  read/serialized. Include the causal error as a structured field.
- `warn`: recoverable degradation, retry, unsupported optional capability, or
  cleanup failure that does not invalidate the response.
- `info`: low-volume lifecycle milestones such as engine start/stop, migration,
  import/export completion, or provider request completion.
- `debug`: operation IDs, counts, selected capability, timings, and state
  transitions useful during development.
- `trace`: high-volume internal iteration only; never enable by default.

Use message-first structured events:

```rust
info!(data_dir = %data_dir.display(), "engine started");
error!(%error, "failed to read protocol frame");
```

Prefer stable fields such as `request_id`, `method`, `project_id`,
`document_id`, `segment_id`, `duration_ms`, and `item_count`. A log consumer
must not need to parse values out of the message string.

## What To Record

Record process lifecycle, migration versions, operation boundaries, aggregate
counts, elapsed time, retry/degradation decisions, and typed error codes. For a
failed RPC, log the request ID and method once at the owning boundary rather
than logging the same error in every layer.

Electron main may use `console.error` for fatal startup because it is a small
process boundary (`apps/desktop/src/main/index.ts`). Renderer console output is
not an application logging channel and E2E treats unexpected console errors as
failures.

## Sensitive Data

Never log source/target text, full prompts, document bodies, API keys, auth
headers, keychain values, provider response bodies, or entire JSON-RPC frames.
Paths may contain personal data: log managed paths only when operationally
needed and avoid original user paths at info level. Log token counts and
provider/model identifiers, not prompt content.

## Avoid

- No `println!`/`eprintln!` in libraries or protocol handling.
- No duplicate logging at every `?` propagation point.
- No secrets hidden in generic `Debug` output.
- No high-cardinality content as tracing field names or values.
- No renderer-only telemetry presented as a durable audit log.
