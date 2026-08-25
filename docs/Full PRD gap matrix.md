Full PRD gap matrix
# Full-scope implementation audit

> **Historical record (pre-greenfield).** This audit measured the previous
> implementation, which was removed in the greenfield reset. The crates,
> scripts, and features cited here do not exist in the current tree. See
> `README.md` and [architecture.md](./architecture.md) for the current state.

## Executive summary

### Status update: 2026-07-27

The audit below remains the historical baseline that triggered the Full PRD
remediation. The plugin row is no longer current in three areas:

- the runtime now normalizes Tier 1 declarative, Tier 2 sandbox, and Tier 3
  process inventory with immutable versions and upgrade/rollback lifecycle;
- scoped capability review, explicit grant/deny/revoke, operation-time checks,
  detach, and immutable audit are implemented; `grantRequested` grants no
  authority;
- the executable Tier 1 host now provides bounded UTF-8 filters, regex QA
  packs, deterministic JSON pipeline transforms, generated contracts, public
  SDK builders, a manifest-only official example, focused stdio smoke, and
  real Electron lifecycle evidence.

Tier 1 does not close the whole plugin parent. Engine connectors, AI actions,
UI panels, Tier 2 sandbox execution, and external connectors remain owned by
their dedicated child tasks. Treat the older "Missing required P1 items"
section as dated audit evidence, not the current implementation inventory.

The five children were implemented as narrow foundations rather than their parent-assigned full PRD scope:

| Child                   | Current state                                                | Main gap                                                     |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Plugin runtime/SDK      | Functional Tier 3 process-filter runtime                     | No Tier 1/2 and none of P-03..P-08                           |
| API/CLI automation      | Authenticated loopback API and basic import→QA→export CLI    | API is incomplete; no pretranslation path or X-03..X-07      |
| Advanced AI/quality     | Offline heuristic QE, limited semantic QA, term candidate extraction | Most F/G/H requirements and desktop workflows absent         |
| Collaboration           | Local SQLite collaboration primitives                        | No self-hosted server, synchronization, enforcement, or collaboration UI |
| Packaging/product shell | Packaging configuration, skeleton catalogs/docs/CI           | No updater, real localization, interactive tutorial, full crash recovery, or release gates |

The existing child PRDs explicitly excluded many  requirements that the parent assigns to those children. For example, the plugin child excludes Tier 2 and P-03..P-08, the API child excludes  X-03..X-07, and the collaboration child excludes replica sync. Those  exclusions conflict with `.trellis/tasks/07-19-complete-full-cat-prd/prd.md:162-175` and `implement.md:75-95`.

------

# 1. `07-19-plugin-runtime-sdk`

## Implemented, with evidence

### P-01 / P-10: Tier 3 lifecycle and local installation

A real process-plugin foundation exists:

- Manifest identity, API range, process tier, entry, filter contributions, and requested permissions:
  - `crates/plugin-runtime/src/lib.rs:54-106`
- Strict manifest parsing and validation:
  - version/API compatibility: `crates/plugin-runtime/src/lib.rs:124-173`
  - relative entry and required filter contribution: `crates/plugin-runtime/src/lib.rs:175-222`
  - permission vocabulary validation: `crates/plugin-runtime/src/lib.rs:223-264`
- Persistent install/list/get/enable/disable/uninstall orchestration:
  - `crates/engine/src/plugin.rs:18-183`
- Restart reload and degraded/crash recording:
  - `crates/engine/src/plugin.rs:19-27`
- Contribution registration/unregistration in the document filter registry:
  - `crates/engine/src/plugin.rs:185-237`
- Protocol lifecycle surface and summaries:
  - `crates/protocol/src/plugin.rs:9-104`
- Advertised capabilities:
  - `crates/engine/src/lib.rs:6566-6569`
- Focused engine smoke includes plugin lifecycle:
  - `scripts/engine-smoke.mjs:2071+`

### P-02 / B-12: Tier 3 process filter

- Supervised child process, handshake, bounded frames, stderr tail, timeout handling:
  - `crates/plugin-runtime/src/lib.rs:318-611`
- Filter event codec and `ProcessDocumentFilter` adapter:
  - `crates/plugin-runtime/src/lib.rs:267-315`
  - `crates/plugin-runtime/src/lib.rs:648-756`
- Package copy/removal utilities:
  - `crates/plugin-runtime/src/lib.rs:758+`
- Working SRT example:
  - `examples/plugins/hello-srt/manifest.json:1-32`
  - `examples/plugins/hello-srt/bin/hello-srt.mjs:70-194`

### P-09: partial permission enforcement

- Requested permissions must be granted before enable:
  - `crates/engine/src/plugin.rs:84-101`
- Runtime filter adapter receives granted permissions:
  - `crates/engine/src/plugin.rs:203-207`
- Supported permissions are currently source-read, output-write, and syntactically accepted `network:*`:
  - `crates/plugin-runtime/src/lib.rs:247-264`

### Public SDK and desktop management

- TypeScript process-filter SDK:
  - manifest/filter interfaces: `packages/plugin-sdk/src/index.ts:4-109`
  - process JSON-RPC helper: `packages/plugin-sdk/src/index.ts:119-232`
- SDK tests:
  - `packages/plugin-sdk/src/index.test.ts`
- Public documentation:
  - `docs/plugins/README.md:1-42`
- Desktop list/install/enable/disable/uninstall/error panel:
  - `apps/desktop/src/renderer/PluginsPanel.tsx:13-172`

## Missing required P1 items

### Three-tier runtime is not implemented

The parent design requires:

- Tier 1 declarative manifests
- Tier 2 sandboxed JavaScript/UI
- Tier 3 process plugins

Evidence of current limitation:

- Rust `PluginTier` has only `Process`:
  - `crates/plugin-runtime/src/lib.rs:54-58`
  - `crates/protocol/src/plugin.rs:9-13`
- Manifest validation explicitly rejects everything except process:
  - `crates/plugin-runtime/src/lib.rs:170-173`
- SDK type fixes `tier` to `"process"`:
  - `packages/plugin-sdk/src/index.ts:23-34`

Missing:

- Tier 1 declarative filter/provider/regex-QA/pipeline contribution schema and evaluator.
- Tier 2 sandboxed JS execution with narrow host bridge, CPU/memory/deadline controls, and renderer isolation.
- Tier-aware lifecycle and SDK helpers.
- At least one example for each tier.

### P-03 / F-12: engine connector extension point

No manifest contribution, runtime adapter, registry mutation, SDK  interface, or example exists for engine connectors. Existing AI provider catalogs remain internal.

### P-04 / H-12: QA rule extension point

No plugin QA-rule descriptor or executable adapter exists. Plugins cannot add mechanical or semantic QA rules.

### P-05: pipeline step extension point

`StepRegistry` exists internally, but plugin lifecycle  never adds/removes plugin steps. No plugin step manifest contract,  process protocol, resumability/cancellation bridge, or SDK exists.

### P-06: AI actions

No contribution contract or UI host exists for adding selection-menu/sidebar LLM actions and prompts.

### P-07 / C-20: UI panels

Only a future-facing built-in descriptor exists:

- `apps/desktop/src/renderer/editor-panels.ts:1-33`

It explicitly says a future runtime may append declarative contributions. Missing:

- plugin UI panel manifest schema;
- Tier 2 sandbox/iframe or declarative panel renderer;
- host message bridge;
- panel registration/removal;
- per-panel permissions;
- desktop rendering and crash containment.

### P-08: external-system connectors

No external connector contract, host service, checkpoint/cursor model, source ingestion, or result writeback interface exists.

### P-09: full permissions and sandbox

Current security is insufficient for full P-09:

- Installation grants every requested permission with one boolean:
  - `crates/engine/src/plugin.rs:64-68`
  - `PluginsPanel.tsx:45-49`
- No per-permission consent UI or later grant/revoke operation.
- `network:*` is accepted by validation but no network policy enforcement was found.
- No asset permissions.
- No project/document scoped grants.
- Tier 3 is process isolation, not filesystem or OS sandboxing.
- The child inherits the parent environment except for adding `TRANSLUNAR_PLUGIN_ID`; there is no explicit environment clearing at `crates/plugin-runtime/src/lib.rs:406-421`.
- No permission audit/history surface.

### P-10: incomplete distribution

Local directory installation works, but missing:

- install from packaged file/archive;
- official core-plugin packaging and discovery;
- package integrity/version upgrade behavior;
- SDK/example licensing;
- clean distinction between bundled core and manually installed community plugins.

The example also duplicates the JSON-RPC host rather than importing `@translunar/plugin-sdk`:

- `examples/plugins/hello-srt/bin/hello-srt.mjs:1-96`

Thus it does not fully prove the public SDK as the only implementation dependency.

## Recommended order

1. Generalize the manifest/storage/protocol model to multiple tiers and contribution kinds.
2. Add central capability grants with per-permission consent, scope, grant/revoke, and audit.
3. Implement Tier 1 declarative host.
4. Add registry-backed P-03/P-04/P-05 adapters.
5. Add external connector contract shared with X-07.
6. Implement Tier 2 sandbox and UI-panel host.
7. Add AI-action contributions.
8. Add official examples for all contribution kinds and all tiers.
9. Expand Plugins UI for permission review, contribution inventory, upgrades, and failures.
10. Add full lifecycle, permission-denial, timeout, restart, UI, and registry E2E coverage.

## Estimated major work packages

**9 major packages:**

1. Multi-tier manifest/runtime refactor
2. Permission/grant subsystem
3. Tier 1 declarative runtime
4. Tier 2 JS sandbox
5. Engine connector SDK
6. QA/pipeline SDK
7. AI action/UI panel host
8. External connector SDK/examples
9. Desktop management, packaging, docs, and E2E

------

# 2. `07-19-api-cli-automation`

## Implemented, with evidence

### X-01: partial local API

- Loopback default and explicit remote opt-in:
  - `crates/engine/src/local_api.rs:20-48`
- Bearer authentication:
  - `crates/engine/src/local_api.rs:94-116`
  - token implementation under `crates/engine/src/local_auth.rs`
- Stable error envelope:
  - `crates/engine/src/local_api.rs:74-91`
  - `crates/engine/src/local_api.rs:371-382`
- Implemented routes:
  - capabilities/project CRUD subset: `crates/engine/src/local_api.rs:118-157`
  - document import/list/export/QA: `crates/engine/src/local_api.rs:142-181`
  - filters/TM library/termbase listing: `crates/engine/src/local_api.rs:183-202`
- Loopback/auth fixture tests:
  - `crates/engine/src/local_api.rs:437-506`

### X-02: partial CLI

- `token ensure|status|rotate`, `serve`, project list/create, and `run`:
  - `crates/engine/src/bin/translunar.rs:14-89`
  - command execution: `crates/engine/src/bin/translunar.rs:91-220`
- Human and JSON output support.
- One-shot import→QA→export:
  - `crates/engine/src/local_api.rs:385-435`
- CLI/API smoke:
  - `scripts/engine-smoke.mjs:1988-2052`

### Internal pretranslation capability exists

The engine has a registered AI pretranslation pipeline step:

- configuration and execution: `crates/engine/src/lib.rs:1812-1900`
- registration: `crates/engine/src/lib.rs:1964-1980`

It is not used by the API/CLI flow.

## Missing required P1 items

### X-01 is not the full API contract

The PRD requires project/file/segment/TM/terminology/pretranslation/QA/export read-write. Current API lacks:

- segment list/get/update/confirm;
- file/document get and richer mutation operations;
- TM search/import/upsert/writeback;
- termbase search/create/upsert/writeback;
- pretranslation start/status/cancel/results;
- pipeline create/run/status;
- durable job model for long operations;
- plugin/connector operations needed for automation;
- pagination/query consistency across resources.

The server is a sequential blocking `TcpListener` loop:

- `crates/engine/src/local_api.rs:50-70`

There is no concurrency, graceful shutdown, request-size policy, CORS/origin policy, rate limiting, or event stream.

The API test does not actually execute an authenticated create/import/export route sequence; it switches to the direct `run_pipeline` helper:

- `crates/engine/src/local_api.rs:497-503`

### X-02 omits required pretranslation

`run_pipeline` is only import→QA→export:

- `crates/engine/src/local_api.rs:395-434`

Missing:

- pretranslate stage;
- provider/profile selection;
- pipeline preset selection;
- reuse existing project;
- progress/status output;
- cancellation/resume;
- explicit QA gate behavior rather than automatically overriding the gate at lines 415-423;
- batch/multi-file inputs.

## Missing required P2 items

### X-03: folder watch

No watch service, durable watch configuration, debounce/stability check, output routing, retry/quarantine, or CLI `watch` command exists.

### X-04: clipboard/global shortcut translation

No Electron clipboard integration, `globalShortcut`, quick-translation window, asset/TM writeback, or OS lifecycle handling exists.

### X-05: inbound/outbound webhooks

No webhook registration storage, inbound route/auth/signature checks, outbound delivery queue, retries, idempotency, secret management, or  delivery history exists.

### X-06: editor/browser integrations

No VS Code extension, browser extension, API client package, selection-send command, or writeback workflow exists.

### X-07: connector example

No P-08 external connector contract or official example connector  exists. The current plugin runtime is filter-only and cannot fulfill  this requirement.

## Recommended order

1. Define the complete automation application-service/API contract.
2. Add durable async jobs and expose pretranslation/pipeline execution.
3. Bring CLI to parity, including multi-file and existing-project paths.
4. Build X-03 watch on the same durable job service.
5. Implement webhook registration and delivery queue.
6. Complete P-08 connector runtime, then ship X-07 example.
7. Publish a typed API client and build a small VS Code integration.
8. Add desktop clipboard/global-shortcut workflow.
9. Add real HTTP integration/security/restart tests.

## Estimated major work packages

**7 major packages:**

1. Full versioned API and async jobs
2. Full CLI/pretranslation orchestration
3. Folder-watch daemon and presets
4. Clipboard/quick-translation shell
5. Webhook ingress/delivery subsystem
6. API client plus VS Code/browser example
7. P-08 connector example and end-to-end validation

------

# 3. `07-19-advanced-ai-quality`

## Implemented, with evidence

### F-08: partial offline QE

- Deterministic 0–100 scoring and route values:
  - `crates/ai-quality-core/src/lib.rs:27-61`
  - `crates/ai-quality-core/src/lib.rs:122-147`
- Factors include empty/equal target, length, numbers, placeholders, and negation:
  - `crates/ai-quality-core/src/lib.rs:237-325`
- Required route thresholds:
  - `crates/ai-quality-core/src/lib.rs:427-435`
- Engine protocol exposure:
  - `crates/engine/src/ai_quality.rs:12-47`
- Capability:
  - `crates/engine/src/lib.rs:6609`
- Determinism test:
  - `crates/ai-quality-core/src/lib.rs:536-549`

### H-10 / G-05: partial semantic QA

- Structured findings with severity, confidence, evidence:
  - `crates/ai-quality-core/src/lib.rs:63-88`
- Implemented detectors:
  - empty target;
  - source equals target;
  - number mismatch;
  - negation mismatch;
  - obvious length collapse.
  - `crates/ai-quality-core/src/lib.rs:328-390`
- Focused tests:
  - `crates/ai-quality-core/src/lib.rs:551-570`
- Engine smoke invokes quality methods:
  - `scripts/engine-smoke.mjs:1926-1980`

### E-06: partial terminology extraction

- Frequency-based English-token candidates, examples, bounded result:
  - `crates/ai-quality-core/src/lib.rs:164-234`
- Optional target suggestion based on co-occurrence stability:
  - `crates/ai-quality-core/src/lib.rs:196-221`
- Unit test:
  - `crates/ai-quality-core/src/lib.rs:572-593`

### Existing AI foundation useful to this child

- AI conversations, grounded context preview, provider run and event polling:
  - `apps/desktop/src/renderer/LiveAssistantPanel.tsx:217-290`
- Grounding inspector:
  - `apps/desktop/src/renderer/LiveAssistantPanel.tsx:558-586`
- AI batch pretranslation step:
  - `crates/engine/src/lib.rs:1812-1900`

## Missing required P1 items

### F-06: result cache

No cache keyed by segment + context + engine + prompt version was  found. Existing persisted AI runs/conversations are not a reusable,  invalidation-aware result cache.

Needed:

- canonical cache key;
- prompt/model/context versioning;
- TTL and explicit invalidation;
- cache-hit provenance;
- project-level controls;
- usage/cost treatment.

### F-07: 2–3 alternative styles

No multi-candidate generation contract, storage, side-by-side UI, candidate provenance, or candidate selection/writeback exists.

### F-08 remains incomplete

The current implementation is deterministic heuristics, not the  specified initial LLM judge with an interface reserved for a COMET-like  local model.

Missing:

- pluggable QE provider/model interface;
- LLM-judge implementation;
- local model adapter contract;
- model/version provenance;
- persisted scores and review queue integration;
- desktop score/routing presentation.

### F-09: terminology compliance post-check

No post-MT termbase compliance scan, correction proposal, or flagged-result workflow exists.

### F-10: session adaptation

No capture of user edits as ranked dynamic few-shot examples for later segments exists.

### F-11: prompt template library

No domain prompt-template CRUD, import/export, versioning, or desktop manager exists.

### F-12: engine connector plugin SDK

Absent, as noted in the plugin audit.

### G-02: source explanation

The assistant can perform generic actions, but there is no defined  grammar/culture/polysemy explanation workflow with structured output and dedicated UI.

### G-03: project RAG Q&A

Grounding preview is not a project-question answering system. Missing retrieval/citation semantics, document/TM/TB/style scoped query, answer evidence, and sidebar UX.

### G-04: consistency repair assistant

No terminology-change impact scan, linked change list, batch preview, revision guard, or apply/rollback workflow exists.

### G-06: pretranslation profiling

No automatic domain/genre/style classifier that recommends prompts and engines exists.

### G-07: source diagnosis

No document preflight for ambiguity, probable typo, unclear reference, or culture-specific/untranslatable content exists.

### G-08: intelligent tag placement

Current editor supports manual tag copy/placement, but no semantic AI placement or confidence/review workflow was found.

### H-10 incomplete detector coverage

Missing specified detectors for:

- unauthorized additions beyond coarse length;
- subject/object reversal;
- tone/register mismatch;
- translationese/MT style.

The current heuristic confidence values are constants, not calibrated model confidence.

### H-11: LQA/MQM

No error taxonomy, severity scorecard, evaluator workflow, persisted  assessment, translator/project aggregation, or reports exist.

### H-12: QA plugin SDK

Absent, as noted in the plugin audit.

### E-06 incomplete workflow

Current extraction:

- only recognizes Latin tokens with a regex:
  - `crates/ai-quality-core/src/lib.rs:492-508`
- does not support multiword terms, CJK terminology, linguistic ranking, or provider enrichment;
- has no desktop candidate-review UI;
- has no accept/reject/edit and explicit termbase-upsert workflow.

## Missing required P2 items

### G-09: agentic batch pipeline

No translate→self-QA→repair→recheck workflow with confidence routing and an auditable step log exists.

### G-10: style learning

No history/corpus style analysis, reusable style-card model, approval UI, or grounding injection exists.

### G-11: multimodal aid

PDF OCR exists as format extraction (`crates/filter-pdf/src/lib.rs:842+`), but there is no multimodal AI workflow for translating image text or chart descriptions.

## Desktop integration gap

The three new quality RPC methods are not used by the desktop. `LiveAssistantPanel` calls grounding/run APIs, not `ai.quality.*`. Therefore the currently implemented quality logic is effectively backend-only.

## Recommended order

1. Define persisted quality artifacts, model-provider interfaces, and desktop review surfaces.
2. Complete F-08 and H-10 with provider/local-model adapters and full detector taxonomy.
3. Build F-09 and G-04 around terminology consistency.
4. Complete E-06 candidate review and termbase confirmation.
5. Add F-06 cache and F-11 prompt templates.
6. Add F-07 alternatives and F-10 adaptive few-shot.
7. Build G-02/G-03/G-06/G-07/G-08 assistant workflows.
8. Add H-11 reports and H-12 plugin rules.
9. Implement P2 agentic/style/multimodal features.

## Estimated major work packages

**10 major packages:**

1. Persistent quality/review data model
2. QE judge and pluggable model interface
3. Full semantic QA detector stack
4. Term extraction/review/termbase workflow
5. Cache and prompt-template library
6. Alternatives and adaptive few-shot
7. RAG/explanation/source-diagnosis assistant
8. Consistency repair and tag placement
9. LQA/MQM plus QA plugin SDK
10. Agentic batch, style cards, and multimodal assistance

------

# 4. `07-19-collaboration-server`

## Implemented, with evidence

### Local persistence primitives

Migration/schema exists for members, locks, presence, assignments, and operation log:

- `crates/storage/src/migrations.rs:1721-1785`

### I-06: partial roles

- Owner/member enum and member contracts:
  - `crates/protocol/src/collab.rs:9-63`
- Durable add/remove/list:
  - `crates/storage/src/store/collab.rs:130-208`
- Engine forwarding:
  - `crates/engine/src/collab.rs:13-46`

### I-05: partial locks and presence

- Lock acquire/conflict/release/heartbeat/list:
  - `crates/storage/src/store/collab.rs:210-336`
- Presence heartbeat/TTL listing:
  - `crates/storage/src/store/collab.rs:338-392`
- Engine methods:
  - `crates/engine/src/collab.rs:48-108`

### I-08: partial assignments

- Assignment contract with document, ordinal range, due date, status:
  - `crates/protocol/src/collab.rs:139-185`
- Create/list/complete:
  - `crates/storage/src/store/collab.rs:394-482`
  - `crates/engine/src/collab.rs:110-148`

### Operation-log foundation

- Append/list sequence:
  - `crates/storage/src/store/collab.rs:484-530`
  - `crates/storage/src/store/collab.rs:572-599`
- Protocol and engine exposure:
  - `crates/protocol/src/collab.rs:187-216`
  - `crates/engine/src/collab.rs:150-171`
- Smoke covers local collaboration methods:
  - `scripts/engine-smoke.mjs:1857+`

## Missing required items

### I-05: no self-hosted collaboration server

The existing HTTP server is an authenticated loopback automation adapter, not a collaborative server:

- `crates/engine/src/local_api.rs:1-70`
- Its routes omit `collab.*`: `crates/engine/src/local_api.rs:118-209`

Missing:

- deployable one-container server;
- network authentication and workspace membership sessions;
- server database/configuration;
- WebSocket/SSE event fanout;
- server health/administration;
- TLS/reverse-proxy guidance;
- container image and deployment artifacts.

### I-05: no shared asset replica synchronization

The operation log is append/read only. Missing:

- replica identity and cursor persistence;
- push/pull protocol;
- project/TM/termbase snapshot/bootstrap;
- asset payload replication;
- idempotent remote operation application;
- conflict resolution;
- compaction/retention;
- attachment/source-file transfer;
- reconnect catch-up and retry handling.

### Locks are not enforced

Lock records exist, but target/editor mutation paths do not consult  them. Therefore they are not “Engine-enforced gates” as the child PRD  claims.

Missing:

- actor/session identity on writes;
- lock check in segment update/confirm/review operations;
- lock-loss behavior;
- readonly UI when another actor owns the lock;
- automatic heartbeat and release.

### No presence or progress board UI

There are no desktop callers for collaboration presence or locks and  no progress board aggregating users, assignments, files, segment ranges, and completion.

### I-06: roles are not authorized

`acting_actor` is accepted and logged, but owner status is not checked before membership mutation:

- `crates/storage/src/store/collab.rs:150-207`

Missing:

- implicit local owner initialization;
- owner-only member management;
- member read/write scope enforcement;
- assigned-work enforcement;
- server-side authorization tests.

### I-07: discussions are local only

Local durable comments/discussions exist, but:

- mention tokens are stored as metadata;
- no member resolution;
- no notification inbox/delivery;
- no collaboration fanout;
- no unread state;
- no reconnect synchronization.

The UI labels this as local review/discussion behavior rather than collaborative delivery.

### I-08: assignments incomplete

- `Canceled` is declared:
  - `crates/protocol/src/collab.rs:16-22`
- No cancel mutation exists.
- No assignment update/reassign operation.
- No authorization, overlap validation, member validation, or progress calculation.
- No assignment board/UI or due-date notification.

### No reconnect/offline synchronization

Missing:

- online/offline state machine;
- queued local operations;
- durable retry/outbox;
- reconnect cursor;
- conflict UI;
- stale lock recovery;
- presence re-establishment;
- server-change reconciliation.

## Recommended order

1. Specify authoritative server/replica protocol and conflict model.
2. Build a separate self-hosted server binary/container with authentication.
3. Implement snapshot/bootstrap and incremental project/TM/TB replication.
4. Add client outbox, cursors, idempotent apply, and reconnect.
5. Enforce membership, roles, assignments, and locks in mutation paths.
6. Add real-time event transport and presence.
7. Complete assignment lifecycle and progress aggregation.
8. Synchronize discussions and implement mention notifications.
9. Build the desktop collaboration board and editor lock/presence UX.
10. Add two-client disconnect/reconnect/conflict E2E tests.

## Estimated major work packages

**8 major packages:**

1. Server binary/container/authentication
2. Replica and synchronization protocol
3. Asset snapshot and payload transfer
4. Offline outbox/reconnect/conflict handling
5. Authorization and lock enforcement
6. Realtime presence/event fanout
7. Assignments/discussions/mentions backend
8. Desktop collaboration board and multi-client E2E

------

# 5. `07-19-platform-packaging-product-shell`

## Implemented, with evidence

### M-01: mostly implemented local data directory

- Electron chooses one engine data directory with environment override:
  - `apps/desktop/src/main/index.ts:49-55`
- Engine workspace backup creates a complete reopenable directory:
  - `crates/engine/src/lib.rs:5429-5445`
  - round-trip test: `crates/engine/src/lib.rs:9895-9987`

### M-02: secure credentials

- AI credential storage uses OS keyring in production:
  - `crates/engine/src/ai.rs:46-125`
  - `crates/engine/src/ai.rs:186-196`
- Local API tokens also use a dedicated secure-store abstraction.

### M-03: model only

- `engine_allowlist` exists in project configuration:
  - `crates/domain/src/lib.rs:32-79`
  - persisted at `crates/storage/src/store/lifecycle.rs:1453`

No enforcement was found.

### M-04: telemetry default off

No telemetry SDK/emitter was found. The default-off policy is documented:

- `docs/packaging.md:33-41`

### M-05: partial backup/restore

- Backup RPC:
  - `crates/engine/src/lib.rs:5429-5445`
- Complete reopenable backup test:
  - `crates/engine/src/lib.rs:9895-9987`
- Automatic pre-migration backup exists in storage:
  - `crates/storage/src/store.rs:603-621`
  - `crates/storage/src/store.rs:8844-8893`

### N-01 / N-02: packaging skeleton

- Windows NSIS and macOS DMG x64/arm64:
  - `apps/desktop/electron-builder.yml:1-40`
- Root package scripts:
  - `package.json:29-30`
- ASAR, maximum compression, release binaries only:
  - `apps/desktop/electron-builder.yml:7-19`
- Size guidance:
  - `docs/packaging.md:20-26`

### N-03: offline local engine architecture

- Electron launches the local Rust engine over stdio:
  - `apps/desktop/src/main/engine-client.ts:44-65`
- Local SQLite/data-directory architecture supports offline core workflows.

### N-05: catalog skeleton

- Typed `en-US` and `zh-CN` catalogs:
  - `apps/desktop/src/renderer/i18n/messages.ts:1-74`
- Catalog tests:
  - `apps/desktop/src/renderer/i18n/messages.test.ts:1-17`

### N-06: tutorial documentation/example fixture

- `docs/tutorial.md`
- example fixture paths referenced there.

### N-08: partial engineering infrastructure

- CI:
  - `.github/workflows/ci.yml:1-42`
- Build/contribution docs:
  - `docs/contributing.md`
- Plugin docs:
  - `docs/plugins/README.md`

## Missing P0 items

### M-01: selectable/migratable data directory UI

The environment override is not a user-facing selectable location. Missing:

- settings picker;
- validation and free-space check;
- safe move/copy migration;
- restart workflow;
- rollback on migration failure.

### M-03: allowlist enforcement

Although P1, it is entirely inert:

- no settings UI;
- no validation against provider/profile selection;
- no enforcement when starting AI runs or batches;
- no behavior for an existing profile that becomes disallowed.

### M-05: one-click backup and restore

The engine can create and reopen a backup, but there is no:

- desktop backup command;
- restore selection and manifest validation;
- safe shutdown/swap/restart;
- rollback if restore fails;
- user-visible backup history.

### N-01: release-grade platform parity not demonstrated

Configuration exists, but missing:

- Windows and macOS packaging CI;
- executable launch/install smoke on both OSes;
- code signing/notarization pipeline;
- platform parity test matrix;
- macOS minimum-version enforcement evidence.

### N-02: size/time gates absent

- No generated-artifact size measurement.
- No CI failure at 200 MB.
- No clean-machine installation-to-usable test under three minutes.
- No explicit no-login acceptance test.

### N-04: updater absent

No `electron-updater`/`autoUpdater` usage was found. Missing:

- automatic/manual update check;
- download/install UI;
- disable/defer preference;
- release feed configuration;
- migration backup integration;
- update failure/rollback behavior;
- platform update tests.

### N-05: localization is not integrated

Only tests import the catalogs. The application continues to contain extensive hard-coded English strings.

Missing:

- locale context/provider;
- system-locale initialization;
- persisted locale preference and selector;
- migration of all product-facing strings;
- interpolation/plural/date/number support;
- localization QA and layout tests;
- meaningful Chinese translation review.

### N-07: crash recovery incomplete

Confirmed content is durable in SQLite, but the “editing segment draft” requirement is not implemented.

The engine client exposes a manual `restart()` but does not call it after unexpected exit:

- `apps/desktop/src/main/engine-client.ts:82-85`
- unexpected exit only rejects pending calls:
  - `apps/desktop/src/main/engine-client.ts:163-177`

Missing:

- automatic bounded engine restart;
- renderer reconnection/state reload;
- unsaved textarea draft persistence;
- draft restoration after renderer/app crash;
- recovery prompt and stale-revision handling;
- crash-recovery E2E.

## Missing P1 items

### N-06: interactive tutorial and example project

Documentation is not an in-product tutorial. Missing:

- first-run detection;
- interactive guided steps;
- progress/skip/restart state;
- bundled example project creation/opening;
- tutorial actions tied to real UI controls;
- zh-CN/en-US tutorial content.

### N-08: open-source release completeness

- No `LICENSE` file was found despite the parent selecting Apache-2.0.
- No packaging/release workflow.
- No code-signing/release secret documentation.
- No security policy, code of conduct, issue templates, or release process evidence.
- Public repository status cannot be proven from the working tree.

### Accessibility is only guidance, not qualification

`docs/packaging.md:43-48` describes a baseline, but missing:

- automated axe/accessibility tests;
- keyboard-only acceptance matrix;
- focus restoration/modal trapping audit;
- contrast verification;
- screen-reader labels/status announcements across the product;
- reduced-motion implementation check.

## Recommended order

1. Implement real locale infrastructure and migrate product-facing strings.
2. Add updater service with migration backup and defer/disable controls.
3. Build data-directory settings plus one-click backup/restore.
4. Add crash-safe editor drafts and automatic engine restart/reconnect.
5. Build in-app tutorial and bundled example-project flow.
6. Enforce project engine allowlists.
7. Add packaging CI on Windows/macOS, signing hooks, artifact size gates, and install smoke.
8. Complete accessibility qualification.
9. Add Apache-2.0 license and release/open-source governance files.

## Estimated major work packages

**9 major packages:**

1. Full desktop localization
2. Update service and UI
3. Data-directory migration plus backup/restore UI
4. Crash restart and draft recovery
5. Interactive tutorial/example project
6. Engine allowlist enforcement
7. Cross-platform release/signing pipeline
8. Size/performance/accessibility qualification
9. License and open-source release infrastructure

------

# Overall implementation dependency order

A practical order across the five children is:

1. **Plugin manifest/permissions and all extension contracts** — required by F-12, H-12, P-08, and X-07.
2. **Complete API/CLI application-service and async job model** — reusable by watch, webhooks, connectors, and collaboration automation.
3. **Advanced AI/quality persisted workflows and desktop surfaces**.
4. **Collaboration server and replica protocol**, then enforce collaboration in editor mutations.
5. **Product-shell completion and release qualification**, after all services and UI are stable.

## Verification performed

This was a read-only static audit of current files under `crates/`, `apps/desktop/`, `packages/`, `scripts/`, `docs/`, `.github/`, examples, and the parent/child Trellis artifacts. No files were  modified and no build/test suite was run. The reported “missing”  conclusions are based on semantic searches followed by direct inspection of the relevant definitions and call paths.
