# Local API, CLI, and automation

## Goal

Expose the same Engine application services through an authenticated loopback
HTTP API and a headless CLI so scripts can complete import → process → QA →
export and sink results into the local asset hub without opening the GUI.

## Confirmed baseline

- `EngineService` already owns projects, documents, segments, TM/TB, QA,
  pipelines, AI, plugins, and export (`crates/engine`).
- Production transport today is stdio JSON-RPC only (`translunar-engine`).
- AI credentials already use OS keyring with a test-memory fallback.
- No production HTTP server, workflow CLI, folder watch, clipboard hook, or
  webhook stack exists yet.
- Parent design requires API/CLI adapters to call services directly, not via
  Electron/renderer.

## Scope and requirements

### R1. Local API auth and binding (X-01)

- Serve HTTP on loopback by default (`127.0.0.1`).
- Authenticate non-health endpoints with a bearer token stored in the OS
  keyring under a dedicated service namespace.
- Reject non-loopback binds unless an explicit unsafe opt-in flag is set.
- Never persist the raw token in SQLite or logs.

### R2. Versioned local API surface (X-01)

- Expose `/v1` JSON endpoints covering project create/list/get, document
  import/list, document export, filter list, QA run for a document, TM library
  list, and termbase list at minimum.
- Return stable error codes aligned with Engine/protocol failures.
- Long-running work may complete inline for MVP when the Engine call is
  synchronous; do not hold GUI-owned stdio sessions.

### R3. Workflow CLI (X-02)

- Ship a user-facing `translunar` CLI binary that embeds/calls `EngineService`
  directly with `--data-dir`.
- Commands: `token ensure|status|rotate`, `serve`, `project list|create`,
  `run` (import → optional pipeline/QA → export).
- `run` must work without the desktop app, emit human or `--json` output, and
  use non-zero exit codes on failure.
- Results land in the same SQLite workspace and asset hub as the GUI.

### R4. Evidence and gates

- Focused smoke/integration covers unauthenticated rejection, authenticated
  project/import/export, and CLI `run` on a fixture.
- Contracts remain additive; desktop stdio path stays unchanged.

## Out of scope

- X-03 folder watch, X-04 clipboard/global shortcut, X-05 webhooks,
  X-06 editor/browser plugins, X-07 third-party connectors.
- Collaboration server, billing/portals, remote multi-tenant hosting.
- Replacing stdio JSON-RPC used by Electron.

## Acceptance criteria

- [ ] AC-01: `translunar serve` binds loopback, requires bearer token, and
      rejects missing/invalid tokens on protected routes.
- [ ] AC-02: Authenticated API can create a project, import a fixture, list
      documents, run document QA, and export without the GUI.
- [ ] AC-03: `translunar run` completes import → QA → export into `--data-dir`
      and leaves durable project/document rows after exit.
- [ ] AC-04: Token ensure/rotate uses OS keyring (or test memory backend) and
      never writes the secret into SQLite.
- [ ] AC-05: Desktop stdio engine path still works; focused API/CLI smoke and
      package quality gates pass for owned surfaces.

## Constraints

- Preserve unrelated dirty worktree paths.
- Prefer direct `EngineService` calls over spawning nested stdio engines for CLI.
- API must not become a customer portal or delivery system.
