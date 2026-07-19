# Technical Design: Real AI Engine And Grounding Layer

## 1. Architecture And Ownership

```text
React settings / Assistant / batch progress
  -> generated ai.* RPC methods
  -> Engine AiManager + GroundingBuilder
  -> keyring credential reference + provider adapter
  -> bounded HTTPS/SSE request in worker thread
  -> SQLite ai_runs / ai_events / ai_usage / ai_batch_items
  -> renderer polls ordered events and replaces authoritative projections
```

Add `crates/ai-core` for provider-neutral types, prompt construction, endpoint
validation, SSE/JSON parsing, retry classification, and concrete HTTP adapters.
It has no SQLite or Electron dependency. `crates/engine` owns worker lifecycle,
credential lookup, orchestration, and error mapping. `crates/storage` owns every
durable profile, setting, run, event, batch item, usage row, and conversation
projection.

The existing request/response stdio framing does not change. Long work starts
quickly and returns a run snapshot; the renderer polls an append-only event
page. This is compatible with the current EngineClient and later local API/CLI.

## 2. Provider And Credential Model

`AiProviderKind` contains:

```text
openai, anthropic, gemini, deepl, deepseek, qwen, glm, kimi, volcengine,
openaiCompatible
```

An `AiProviderDescriptor` is built-in and immutable: display name, default base
URL, protocol family, supported streaming/usage features, and credential hint.
An `AiProviderProfile` is durable and revisioned: descriptor kind, user name,
base URL, model, timeout, maximum response bytes, enabled state, and bounded
non-secret options. SQLite stores only `credential_ref = profile_id` and a
cached `credential_present` projection that may be reconciled with keyring.

`CredentialStore` is an Engine trait. Production uses `keyring::Entry` under
service `translunar-cat.ai` and account `<workspace-id>:<profile-id>`. Tests use
an injected in-memory implementation. `ai.credential.set` takes a secret but
returns only `{ available, present, backend }`; there is no get-secret RPC.
Deletion removes the OS entry before clearing the projection. A failed keyring
write never marks the profile credential present.

Endpoint validation rejects userinfo, fragments, non-HTTP schemes, empty host,
and overlong values. HTTPS is required except `http://localhost`, loopback IPs,
and test-bound explicit loopback. Redirects are disabled. Error normalization
removes URLs and provider response bodies before crossing RPC.

## 3. Provider Adapter Contract

```rust
pub trait AiProvider: Send + Sync {
    fn descriptor(&self) -> &AiProviderDescriptor;
    fn execute(
        &self,
        request: ProviderRequest,
        credential: SecretString,
        cancellation: &AtomicBool,
        sink: &mut dyn AiEventSink,
    ) -> Result<ProviderCompletion, AiProviderError>;
}
```

`reqwest::blocking::Client` is created with explicit connect/read/total
timeouts, redirect policy `none`, bounded response bytes, and a stable user
agent. SSE is parsed incrementally with a maximum line/event size. Deltas are
buffered for at most 50 ms or 4 KiB before one event transaction. Cancellation
is checked between reads and before every event/usage write.

Protocol families:

- OpenAI chat-completions SSE: OpenAI, DeepSeek, Qwen, GLM, Kimi,
  Volcengine, and custom OpenAI-compatible endpoints.
- Anthropic Messages SSE with `content_block_delta` and `message_delta` usage.
- Gemini `streamGenerateContent?alt=sse`, extracting candidate text and usage
  metadata.
- DeepL JSON translation, emitted as one delta plus completion because the API
  is non-streaming.

Status 408/409/425/429 and 5xx, connect/read timeouts, and clean premature EOF
are retryable. Authentication, validation, most 4xx, oversized output, and
malformed protocol are terminal. Retry uses provider `Retry-After` when
bounded, otherwise capped exponential backoff; attempts are durable events.

## 4. Grounding Contract

`GroundingBuilder` accepts a segment projection and `GroundingOptions`:

```text
includeTerms, includeTm, includeContext, includeStyle,
tmTopN (0..10), contextBefore/After (0..5), maxChars (1k..64k),
systemInstruction, styleInstruction
```

It queries Engine-owned term and TM ranking, then emits ordered sections:

1. translation task and locale pair;
2. non-negotiable tag/placeholder skeleton;
3. preferred and forbidden terminology;
4. ranked TM examples with score/provenance;
5. style/system instructions;
6. bounded previous/current/next source context;
7. requested editor action and current target when applicable.

Every external text block is length-bounded and wrapped as data, with explicit
instruction that embedded text is not executable policy. Truncation is
deterministic and reported per section. `ai.grounding.preview` returns the
same `PromptBundle` later hashed into `prompt_hash`; execution rebuilds and
checks the segment revision rather than trusting a renderer-supplied prompt.

## 5. Migration And Durable Run Model

Migration 8 adds:

- `ai_provider_profiles`: non-secret profile configuration and revision;
- `ai_settings`: workspace switch, defaults, budgets, allowed origins, revision;
- `ai_runs`: interactive/action/batch request state, profile/model, prompt hash,
  segment/document/project references, revision, attempt, terminal result/error;
- `ai_run_events`: append-only `(run_id, seq)` events (`started`, `attempt`,
  `delta`, `usage`, `retry`, `completed`, `failed`, `canceling`, `canceled`);
- `ai_batch_items`: per-segment state, expected/current revision, source
  (`tm`/`engine`), attempts, result run ID, and typed error code;
- `ai_usage_records`: exactly-once normalized usage and elapsed time with no
  prompt/document text;
- `ai_conversations` and `ai_messages`: durable Assistant threads referencing
  runs and optional target proposals, never credentials.

Run states are:

```text
queued -> running -> succeeded|failed
queued|running|retrying -> canceling -> canceled
running|retrying -> interrupted -> queued (resume) | failed
```

Startup marks orphaned `running`, `retrying`, and `canceling` runs interrupted
in one immediate transaction. Interactive runs can be retried explicitly;
batch resume requeues only pending/retryable/interrupted items. Events and run
revision update atomically. Usage has a unique `(run_id, attempt)` key.

## 6. Interactive And Batch Writes

Interactive completion remains a proposal until the user applies it. The
proposal stores base segment revision and tag skeleton. `ai.result.apply`
revalidates the run, segment revision, signed state, and tag findings, then
uses the editor mutation path so undo/redo/history remain complete.

Batch creation snapshots eligible IDs and revisions. For each item:

1. skip confirmed/signed and, unless opted in, non-empty drafts;
2. query authoritative TM; apply context/exact or threshold-qualified match;
3. otherwise build grounding and start a provider request;
4. write the resulting target as a draft with AI/TM provenance using expected
   revision;
5. atomically finish the item and aggregate progress.

Concurrency is bounded to 1..16 and rate limit to 1..600 requests/minute.
Workers claim pending items through an immediate transaction so one item has
one owner. Cancellation prevents new claims. A stale target becomes `skipped`
with `revision_conflict`, not a batch failure or overwrite.

## 7. Protocol

Additive protocol-v1 methods:

```text
ai.provider.catalog/list/create/update/delete/test
ai.credential.set/delete/status
ai.settings.get/update
ai.grounding.preview
ai.run.start/get/list/events/cancel/resume
ai.result.apply
ai.batch.start/get/list/items/cancel/resume
ai.usage.query
ai.conversation.list/create/update/archive/messages
```

Pages use bounded offset/limit and stable ordering. Mutations require expected
revisions. `AiRunEvent` uses a monotonically increasing sequence, so polling
passes `afterSeq` and cannot duplicate display. Error codes add
`credential_unavailable`, `ai_disabled`, `budget_exceeded`,
`provider_authentication`, `provider_rate_limited`, `provider_timeout`,
`provider_protocol`, and `provider_unavailable` while retaining structured
retryability data and redacted messages.

## 8. Desktop

Add an AI settings surface for catalog/profile CRUD, credential presence,
endpoint/model validation, connection test, global switch, default profile,
and monthly token budget. Credential inputs are write-only and clear after a
successful set.

Replace the Assistant's synthetic online profiles with real Engine runs while
retaining `local-preview` as explicitly offline. A run shows grounding details,
streaming text, cancel/retry, final diff, use/discard, and real nullable metrics.
Conversations load from Engine and link messages to run IDs. A project toolbar
starts batch pretranslation and shows resumable counts/items/errors/usage.

Polling stops when the panel is collapsed or unmounted but run execution does
not. Reopening uses the latest event sequence and run snapshot. No API key,
prompt bundle, or raw provider error is placed in localStorage.

## 9. Compatibility, Operations, And Rollback

Migration 8 is additive and receives the existing pre-migration backup. AI is
disabled by default until a profile and credential exist. Old clients ignore
new methods/tables. Hiding AI UI or disabling the workspace switch leaves
provider profiles, run history, and usage intact.

Tests never depend on public networks. The fixture server binds loopback,
records redacted request structure, emits controlled SSE/429/timeout/malformed
responses, and supports restart/cancel assertions. Logs include run/profile
IDs, status and latency only; no credential, prompt, source, target, TM, or term
text.
