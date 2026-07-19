# Real AI Engine And Grounding Layer

## Goal

Give CAT a real, inspectable AI path for interactive translation and batch
pretranslation. A user can store BYOK credentials in the operating-system
credential manager, select a provider or OpenAI-compatible endpoint, preview
the exact grounded context sent to an engine, receive streamed output, stop and
resume work, and see authoritative usage. AI remains optional: editing,
filters, TM, QA, export, and existing offline Assistant behavior continue to
work with AI disabled or unavailable.

## Scope And Decisions

This child closes the P0 scope assigned by the parent PRD: F-01 (at least six
first-release connectors), F-02, F-03, F-04, F-05, G-01, G-12, and M-02. P1/P2
capabilities such as RAG project chat, QE scoring, style learning, semantic QA,
agentic repair, result caching, and the public connector SDK remain in their
own later tasks.

Confirmed implementation decisions:

- The Engine owns provider validation, grounding, run state, retries,
  persistence, usage, and target writes. React never calls a provider or
  invents a token count/revision.
- Credentials are addressed by an opaque profile reference and stored through
  Rust `keyring` in Windows Credential Manager/macOS Keychain (with an explicit
  unavailable capability on headless systems). Secrets never enter SQLite,
  generated renderer contracts, logs, error messages, or response payloads.
- The first-release connector catalog contains OpenAI, Anthropic, Gemini,
  DeepL, DeepSeek, Qwen, GLM, Kimi, and Volcengine. The OpenAI-compatible
  adapter covers the compatible family and accepts Ollama/LM Studio/vLLM only
  on loopback HTTP; non-loopback custom endpoints require HTTPS.
- JSON-RPC remains request/response. Streaming is exposed as a durable run
  event log (`start`, `events`, `cancel`, `resume`) so a renderer restart does
  not lose already received deltas. The worker uses bounded blocking HTTP and
  never blocks the stdio dispatcher.
- Batch pretranslation always prefers authoritative TM matches. It writes
  drafts, never silently confirms, skips confirmed/signed rows, and resumes
  from per-segment durable item state after interruption.
- Automated tests use a local deterministic HTTP fixture that speaks the real
  connector protocols. No test or default path contacts a public provider.

## Requirements

### R1. Providers, profiles, and credentials (F-01, F-02, M-02)

- Create, update, list, test, enable, and delete provider profiles with a
  stable ID, display name, connector kind, base URL, model, timeout, and safe
  non-secret options. Profile revisions are required for mutable operations.
- Ship at least the nine connector kinds listed above. Each adapter maps
  authentication, request shape, streaming deltas, usage, retryable statuses,
  and bounded provider errors into one internal contract. OpenAI-compatible
  profiles permit arbitrary model names and custom base URLs.
- `ai.credential.set/delete/status` accepts only an opaque profile ID and a
  secret over the trusted Engine boundary. Responses disclose presence and
  capability, never the value. Missing OS credential storage is reported as a
  typed capability, not treated as successful plaintext persistence.
- Validate URLs, model/name lengths, timeout and response limits, redirect
  policy, and allowed schemes before any request. API keys are sent only to
  the configured origin and are never forwarded across redirects.

### R2. Grounded prompt construction (F-03)

- Build a deterministic prompt bundle from the active segment, source/target
  locales, protected tag skeleton, preferred/forbidden terms, top-N Engine TM
  matches, style/system instructions, and bounded previous/next document
  context. Each source is labeled and delimited as data.
- Expose a `grounding.preview` result containing ordered sections, counts,
  truncation flags, and the final message roles/text that would be sent. It
  must not include credentials and must be configurable for terms, TM, style,
  context, and top-N limits.
- Preserve tag/placeholder identity in the request and reject a provider
  result that cannot be represented as a target draft without marking a typed
  finding. Grounding text is bounded before network I/O.

### R3. Interactive translation and editor actions (F-05, G-01)

- Start a grounded run for the active segment and selected action (`translate`,
  `improve`, `formal`, `conversational`, `shorten`, `expand`, `literal`, or
  `freeform`). Stream deltas and a final authoritative draft, usage, latency,
  provider/model, and retry history through the run event log.
- The UI presents the result as a word-level diff with `Use in target` and
  `Discard`. Applying it uses the existing expected-revision editor mutation;
  signed segments and stale revisions are rejected without partial writes.
- Cancel is durable and idempotent. A transient failure can retry within the
  bounded policy; a non-retryable failure leaves a typed terminal error and no
  fabricated target.

### R4. Batch pretranslation and recovery (F-04)

- Start a project/document batch with explicit scope, TM threshold, provider,
  concurrency, requests-per-minute limit, retry policy, and whether existing
  drafts may be replaced. Exact/context TM matches are applied first; engine
  requests cover only eligible untranslated rows.
- Persist a batch run and one item state per segment (`pending`, `tm_applied`,
  `running`, `succeeded`, `retrying`, `failed`, `skipped`, `canceled`). Every
  target write uses the row's expected revision and records provenance. A
  confirmed/signed or concurrently changed row is skipped/conflicted, never
  overwritten.
- Resume after process restart from durable item state and checkpoints.
  Cancellation stops new work, lets in-flight requests settle or time out,
  and reaches a terminal state. Progress pages are deterministic and include
  counts, errors without document text, and usage totals.

### R5. Global AI switch and usage (G-12)

- Persist workspace settings for `enabled`, default profile, allowed origins,
  monthly token budget, and whether interactive/batch requests are allowed.
  Disabled or over-budget requests fail before network I/O with a typed error.
- Persist per-request input, cache-read, reasoning, output, cache-write token
  counts where supplied (unknown values remain null), elapsed time, provider,
  model, project/document/run IDs, and status. Provide bounded daily/monthly,
  project, provider, and model aggregation with no prompt or target text.
- Retry and cancellation do not double-count usage. A provider response is
  counted once when its final usage is committed.

### R6. Desktop experience

- Add provider/credential settings, an AI enable/budget control, a grounding
  inspector, streamed Assistant output, diff actions, and a batch progress
  surface to the existing Electron workbench. Controls have keyboard/ARIA
  semantics, busy/error states, and no horizontal transcript overflow.
- Keep the current offline Assistant available as an explicit offline mode;
  do not label synthetic fixtures as network responses. Switching between
  offline and real runs preserves the existing conversation and panel layout.

## Acceptance Criteria

- [x] Provider profile CRUD, revision conflicts, URL validation, and all nine
      connector descriptors pass Engine unit tests; a local HTTP fixture proves
      OpenAI-compatible SSE, Anthropic, Gemini, and DeepL request/response
      mapping, while missing credentials and unsupported keyring capability are
      typed failures.
- [x] A credential set/retrieve-status/delete/restart test proves the secret is
      available to a run but absent from SQLite, protocol results, logs, errors,
      and renderer state. No plaintext fallback is enabled.
- [x] Grounding preview is deterministic and bounded, exposes terms/TM/style/
      context sections and truncation metadata, preserves tag skeletons, and
      never includes the credential or unbounded document text.
- [x] A real local streaming run emits ordered deltas, completion, usage and
      retry events; cancel, timeout, 429/5xx backoff, stale revision, signed
      read-only, provider error, and Engine restart cases are covered without
      partial target/history writes. Applying a result uses the editor's normal
      diff/expected-revision path.
- [x] Batch pretranslation applies eligible TM matches before network calls,
      honors concurrency/rate/retry limits, persists per-segment checkpoints,
      skips confirmed and stale rows, resumes after restart, and reports
      deterministic progress and exactly-once usage.
- [x] The global switch and budget gate prevent network I/O when disabled or
      over budget; usage queries aggregate by day/month/project/provider/model
      and keep unknown provider token fields nullable.
- [x] Electron E2E uses the local fixture to configure a credential/profile,
      inspect grounding, stream and apply a diff, cancel/retry a run, start and
      resume a batch, change the global switch, and inspect usage. Console/page
      errors, secret leakage, focus loss, and transcript overflow fail the test.
- [x] Existing filter, editor, TM/QA, PDF, panel, protocol-v1, local, VPS,
      Windows GNU, and Electron visual gates remain green.

## Out Of Scope

RAG project chat, semantic QE/QA, terminology auto-repair, style-card
learning, multimodal input, agentic multi-step repair, result-cache policy,
connector/plugin SDK, collaboration, public API/CLI, and provider billing
estimation are later child tasks. This task also does not add a hosted service
or collect telemetry.
