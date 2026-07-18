# Backend Error Handling

## Error Ownership

Each library boundary exposes a typed `thiserror` enum. Examples are
`StorageError` in `crates/storage/src/error.rs`, filter-specific errors in
`crates/filter-docx/src/lib.rs`, and `EngineError` in
`crates/engine/src/lib.rs`. Use `#[from]` only where every error from the lower
layer has the same meaning at the current boundary.

`anyhow` is reserved for executable startup and contextual process I/O in
`crates/engine/src/main.rs`. Domain, storage, filter, and protocol APIs must
return concrete errors that callers can match.

## Propagation And Mapping

- Propagate unexpected lower-level failures with `?`; add context at the
  process boundary where a path or operation makes the error actionable.
- Represent expected business outcomes explicitly: `NotFound`, `Conflict`,
  `InvalidState`, `SchemaTooNew`, or a format-specific unsupported error.
- Convert `EngineError` to the stable protocol `RpcError` in one place:
  `rpc_error` in `crates/engine/src/lib.rs`.
- Keep wire codes stable and snake_case through `ErrorCode`. Put structured
  conflict/not-found fields in `RpcError.data`; do not force clients to parse
  an English message.
- A JSON-RPC failure has `error` and no `result`. A success has `result` and no
  `error`, as enforced by `RpcResponse::success` and `failure`.

```rust
StorageError::Conflict {
    segment_id,
    expected_revision,
    actual_revision,
} => RpcError {
    code: ErrorCode::Conflict,
    message: "segment was modified by another writer".to_string(),
    data: Some(json!({
        "segmentId": segment_id,
        "expectedRevision": expected_revision,
        "actualRevision": actual_revision,
    })),
}
```

## Atomic Failure Behavior

Validate before publishing side effects. Database compound writes use one
transaction. File imports copy to a managed temporary/source location before
persistence; exports validate a temporary package before atomic publication.
On any error, return without inventing an updated revision or replacing the
destination.

The stdio loop may recover from a malformed frame by returning
`invalid_request` and continuing. Startup failures may terminate the process
after logging because no valid service exists.

## Client-Facing Messages

Messages are concise descriptions for a person; `code` and `data` are for
programmatic handling. Never expose SQL text, API credentials, source document
contents, or a full provider response in a protocol message. Preserve the
causal error in local logs when diagnostic detail is needed.

## Avoid

- No `unwrap`, `expect`, or panic on runtime input or persistent data.
  `expect` is acceptable in tests and deterministic fixture builders.
- No catch-all conversion to a string before the engine mapping boundary.
- No duplicated error-code mapping in Electron or individual service methods.
- No success response after a partial side effect.
- No client logic that branches on message text.
