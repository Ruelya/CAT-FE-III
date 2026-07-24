# Design: Local API and CLI

## Architecture

```text
translunar CLI / local HTTP
  -> LocalApi / CliCommands
  -> EngineService (same as desktop stdio path)
  -> Store / filters / QA / pipelines
```

Desktop keeps:

```text
Electron -> stdio JSON-RPC -> RpcDispatcher -> EngineService
```

## Auth

- Service name: `translunar-cat.local-api`
- Account/key: `default`
- Token: 32+ random bytes, base64url, shown once on `token ensure/rotate`
- Header: `Authorization: Bearer <token>`
- Test mode: `TRANSLUNAR_API_TEST_MODE=1` + optional `TRANSLUNAR_API_TEST_TOKEN`

## HTTP surface (MVP)

| Method | Path | Auth | Engine call |
| --- | --- | --- | --- |
| GET | `/health` | no | static ok |
| GET | `/v1/capabilities` | yes | initialize-equivalent capability list subset |
| GET/POST | `/v1/projects` | yes | list/create |
| GET | `/v1/projects/{id}` | yes | get |
| POST | `/v1/projects/{id}/import` | yes | document.import |
| GET | `/v1/projects/{id}/documents` | yes | document.list |
| POST | `/v1/documents/{id}/export` | yes | document.export |
| POST | `/v1/documents/{id}/qa` | yes | qa.runDocument |
| GET | `/v1/filters` | yes | filter.list |
| GET | `/v1/tm/libraries` | yes | tm.library.list |
| GET | `/v1/termbases` | yes | termbase.list |

Implementation: lightweight `tiny_http` server in-process with JSON bodies.

## CLI

Binary: `translunar` (`crates/engine/src/bin/translunar.rs`)

```text
translunar --data-dir DIR token ensure|status|rotate
translunar --data-dir DIR serve --host 127.0.0.1 --port 7431
translunar --data-dir DIR project list|create ...
translunar --data-dir DIR run --source PATH --output PATH [--json]
```

`run` flow:

1. ensure data dir / open EngineService
2. create project (or reuse `--project-id`)
3. import source
4. run document QA (best-effort profile)
5. export to output path
6. print summary (human or JSON)

## Trade-offs

| Choice | Why |
| --- | --- |
| Separate `translunar` binary | Keep desktop `translunar-engine` stdio host stable |
| tiny_http | Small dependency, enough for loopback JSON API |
| Direct EngineService | Matches parent design; no double RPC hop |
| Defer watch/webhook | M2; needs durable automation config first |

## Rollback

- Remove binary/API modules without touching stdio dispatcher.
- No schema migration required for MVP token storage (keyring only).
