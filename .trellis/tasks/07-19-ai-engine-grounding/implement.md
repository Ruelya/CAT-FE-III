# Implementation Plan: Real AI Engine And Grounding Layer

## Preconditions

- Professional editor, TM/termbase assets, pipeline recovery, generated
  protocol contracts, and Electron Assistant/panel geometry are committed and
  green.
- Use Codex inline mode. Read backend Engine/database/error/quality specs and
  frontend Electron/state/type/accessibility specs before editing.
- No public provider is called by automated tests; use loopback fixtures.

## 1. AI Core And Provider Contracts

- [x] Add `crates/ai-core` with provider/profile/run/usage types, endpoint and
      option validation, secret-redacting errors, retry classification, and
      deterministic grounding models.
- [x] Implement bounded OpenAI-compatible SSE plus Anthropic, Gemini, and DeepL
      adapters; register built-in defaults for all nine first-release kinds.
- [x] Add loopback HTTP fixtures and unit tests for request mapping, ordered
      deltas, usage, 429/5xx retry, auth failure, timeout, malformed/oversized
      responses, cancellation, URL rules, and secret redaction.

## 2. Credential And Storage Foundation

- [x] Add migration 8 tables/indexes/check constraints for profiles, settings,
      runs/events, batch items, usage, conversations, and messages, including
      fresh/v7 upgrade/rollback/pre-migration-backup tests.
- [x] Add a `CredentialStore` boundary with production keyring and injected
      memory test backend. Prove set/status/delete/restart without plaintext in
      SQLite or logs and typed unavailable behavior on headless systems.
- [x] Implement revisioned profile/settings CRUD, deterministic pages,
      credential reconciliation, usage aggregation, run/event transitions,
      interruption recovery, and exactly-once usage transactions.

## 3. Grounding And Interactive Runs

- [x] Implement Engine grounding from segment/tags, term search, ranked TM,
      style instructions, and bounded document context. Preview and execution
      share the same builder and prompt hash.
- [x] Add `AiManager` worker lifecycle, run start/get/list/events/cancel/resume,
      durable event buffering, bounded retries/backoff, and typed redacted errors.
- [x] Persist conversations/messages and final proposals with base revision;
      implement diff projection and `ai.result.apply` through editor history,
      signed/tag/stale validation, undo/redo, and restart coverage.

## 4. Batch Pretranslation

- [x] Implement durable batch creation and per-segment claim/state machine with
      TM priority, scope/draft policies, expected revisions, provenance, and
      deterministic progress/item pages.
- [x] Implement bounded concurrency, requests-per-minute pacing, retry and
      cancellation convergence, process interruption recovery, and resume of
      only eligible work without double usage or overwriting confirmed/stale rows.
- [x] Register a resumable `core.ai.pretranslate` pipeline step that delegates
      to the same batch service rather than duplicating provider or storage logic.

## 5. Protocol And Desktop

- [x] Add all generated `ai.*` protocol types/methods/capabilities and stable
      error mapping; regenerate JSON Schema and TypeScript contracts.
- [x] Add AI settings/profile/credential/budget UI with write-only secret
      fields, connection test, typed states, keyboard/ARIA coverage, and no
      localStorage secret/prompt persistence.
- [x] Replace synthetic online Assistant turns with Engine conversations and
      streamed runs; retain explicit offline preview; add grounding inspector,
      cancel/retry, real nullable metrics, word diff, use/discard.
- [x] Add batch pretranslation controls, progress/items/errors/usage, cancel and
      resume while preserving the existing editor/Suggestions/Preview geometry.

## 6. Integration And Finish

- [x] Extend stdio smoke through profile/credential, grounding, streaming,
      result application, usage, batch TM priority, cancel, restart and resume
      against the loopback fixture.
- [x] Add Electron E2E for credential/profile setup, real streamed Assistant,
      grounding visibility, apply/discard/stale/signed, retry/cancel, batch
      resume, global disable/budget gate, usage, accessibility and no leakage.
- [x] Run local Prettier/ESLint/typecheck/unit/build and full VPS fmt/clippy/
      workspace tests/contracts/smoke/Windows GNU/Node 22/Electron E2E.
- [x] Update backend/frontend specs with the verified AI boundary, record
      acceptance evidence, commit/archive, and continue to
      `07-19-qa-review-workflow`.

## Validation Commands

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
node scripts/engine-smoke.mjs
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

```powershell
pnpm exec prettier --check .
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm --filter @translunar/desktop test:e2e
```

## Acceptance Evidence

- `cargo test --workspace`: all workspace unit and doc tests passed on VPS;
  AI-core (5), Engine (20), and Storage (17) suites are included.
- `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all
  -- --check`, `pnpm contracts:check`, and the loopback `engine-smoke.mjs`
  passed. The Windows GNU release Engine also built successfully.
- Node 22.17 gates passed: Prettier, ESLint, TypeScript, 11 Vitest tests,
  production desktop build, and Electron E2E (6 passed, 1 intentionally
  skipped PDF test). The AI E2E was repeated three times after the grounding
  context race fix.
- AI Control and online Assistant screenshots were captured and inspected at
  1250x744, 1680x942, and 1920x1080. The E2E asserts horizontal overflow is at
  most one pixel and narrow toolbar controls do not overlap.

## Rollback Points

- Migration 8 is additive; never edit released migrations 1..7.
- A missing keyring backend disables credential writes and real runs; it never
  falls back to plaintext or blocks non-AI CAT work.
- Provider errors/cancellation cannot mutate a target. Interactive output is a
  proposal until explicit apply; batch writes only through expected revisions.
- Retry/resume reuses durable run/item state and exactly-once usage keys; never
  restart a batch by rebuilding an untracked renderer queue.
- OpenAI-compatible HTTP is loopback-only; remote custom endpoints require
  HTTPS and redirects remain disabled.
