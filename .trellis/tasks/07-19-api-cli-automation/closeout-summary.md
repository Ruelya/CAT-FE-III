# Closeout summary: 07-19-api-cli-automation

## What shipped

Authenticated loopback Local HTTP API and headless `translunar` CLI over the
same `EngineService` / SQLite workspace as the desktop stdio path (no Electron
hop, no nested stdio for workflow commands).

| Area | Deliverable |
| --- | --- |
| Auth | `local_auth`: OS keyring `translunar-cat.local-api` / `default`; 32-byte CSPRNG base64url tokens; test memory only when `TRANSLUNAR_API_TEST_MODE=1`; invalid `TRANSLUNAR_API_TEST_TOKEN` fails loudly |
| HTTP | `local_api`: default `127.0.0.1:7431`; non-loopback needs `--allow-remote`; `/health` public; `/v1` projects/import/export/qa/filters/tm/termbases; stable Engine-aligned error codes + HTTP status mapping |
| CLI | `translunar` binary: `token ensure\|status\|rotate`, `serve`, `project list\|create`, `run` (import → QA → export, optional `--project-id`, `--json`) |
| Gates | `cargo test -p translunar-engine --lib local_`; `TRANSLUNAR_SMOKE_SCOPE=api` smoke (fixed valid token + cross-process project/document durability); package clippy; stdio probe still viable |

Quality loop: review findings F1–F6 all **fixed**; findings-3 **green**;
ready_for_closeout.

## Specs touched

- `.trellis/spec/backend/engine-boundary.md` — expanded **Local API and CLI**
  from a five-bullet summary into a full code-spec (scope, signatures, contracts,
  error matrix, cases, tests, wrong/correct). Captures durable review fixes
  (token format, exact test-mode opt-in, loud invalid injection, taxonomy).
- Task honesty: `prd.md` AC checkboxes marked met; `implement.md` notes +
  acceptance table + residual.

## Suggested commit

**Subject:**

```text
feat(engine): local API, CLI, and authenticated loopback automation
```

**Body:**

```text
Add translunar CLI and loopback HTTP adapter over EngineService for
import → QA → export without the GUI.

- local_auth: keyring service translunar-cat.local-api; 32-byte CSPRNG
  base64url tokens; TRANSLUNAR_API_TEST_MODE=1 memory backend; invalid
  TRANSLUNAR_API_TEST_TOKEN fails loudly
- local_api: /health + /v1 project/document/QA/asset routes; non-loopback
  requires --allow-remote; Engine-aligned HTTP error taxonomy
- CLI: token ensure|status|rotate, serve, project list|create, run --json
- Focused unit tests (local_*) and TRANSLUNAR_SMOKE_SCOPE=api smoke with
  cross-process project/document durability asserts
- Spec: engine-boundary Local API/CLI executable contract

Out of scope: X-03..X-07 (watch/clipboard/webhooks/plugins/connectors).
Residual: live OS keyring not exercised under disposable test-mode runs.

Task: .trellis/tasks/07-19-api-cli-automation
Branch: task/07-19-api-cli-automation
```

## Residual risks

| Risk | Severity | Notes |
| --- | --- | --- |
| OS keyring not live-tested | medium/env | Test memory path covered; production keyring prompts/availability are host-dependent |
| X-03..X-07 deferred | n/a | Explicit PRD out of scope |
| Memory token store is process-local | low | Separate CLI processes under test mode do not share one store unless `TRANSLUNAR_API_TEST_TOKEN` seeds both |
| Worktree may contain unrelated dirty paths | process | Orchestrator must stage only this task’s files when committing |

## Do not

- Archive this task here (Orchestrator / finish-work policy).
- Commit or merge from closeout (Orchestrator owns git).
