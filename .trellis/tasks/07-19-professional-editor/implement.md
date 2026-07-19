# Implementation Plan: Professional Translation Editor

## Preconditions

- PDF/Office/text filters, assets, generic protocol and operation history are
  archived and green.
- Use Codex inline mode; no sub-agents.
- Read backend engine/database/error/quality specs and frontend
  Electron/state/type/accessibility specs before editing.

## 1. Domain, Migration And Projection

- [x] Add migration 6 editor meta/comments/operations/cursors/review/dictionary/
      preferences with legacy backfill and schema-v5 upgrade/rollback tests.
- [x] Add editor row, tag, comment, finding, operation, preference and review
      domain/protocol types plus generated TypeScript.
- [x] Implement bounded filtered/sorted editor paging with tags, context,
      comment/finding counts and stable totals.

## 2. Durable Mutation Core

- [x] Implement a shared immediate editor mutation transaction with expected
      revisions, before/after payloads, count/hash/QA reconciliation and history.
- [x] Implement target tag set/copy/insert/move validation and filter-safe
      structured export.
- [x] Implement duplicate propagation, source correction, split/merge and
      deterministic focus results.
- [x] Implement find/regex preview token/apply with atomic stale protection.
- [x] Implement undo/redo cursor, branching, restart, conflict and inverse
      coverage for every mutation kind.

## 3. Comments, Review, Spell And Preferences

- [x] Implement comment lifecycle and projection of immutable import notes.
- [x] Implement Hunspell capability, bounded checking, user dictionary and
      deterministic CJK spacing/punctuation findings.
- [x] Implement review proposals/diffs/accept/reject and optional
      translation/review/signed workflow states.
- [x] Implement durable validated preferences and customizable command bindings.
- [x] Implement six-profile embedded OpenCC conversion as a revisioned,
      signed-safe, undoable Engine mutation.

## 4. Professional Desktop Editor

- [x] Extract virtualized editor rows and render at most 120 mounted rows with
      stable active-row/draft/IME/focus behavior.
- [x] Add protected source/target tag capsules, tag toolbar and live findings.
- [x] Add command palette, shortcuts 1..9, concordance, find/replace preview,
      split/merge, comments, spelling and undo/redo controls.
- [x] Add review diff, context panel, panel registry, light/dark/system theme,
      zoom and nonprinting marks with accessible/reduced-motion behavior.
- [x] Retain symmetric Suggestions/Preview animation and PDF review surfaces.
- [x] Implement Engine-ranked TM/term autocomplete with IME-safe Tab acceptance.

## 5. Integration, Performance And Finish

- [x] Add a deterministic 10,000-segment fixture/benchmark for paging, search,
      replace and renderer mounted-row/frame/memory assertions.
- [x] Extend Engine smoke through tags, propagation, find/replace, split/merge,
      comments, spell/dictionary, undo/redo, review and restart.
- [x] Add Electron E2E for tagged translation, IME, palette/shortcuts,
      find/replace, comments, spell, history, review, theme/zoom and virtualization.
- [x] Run VPS fmt/clippy/tests/contracts/smoke/release and Node 22 Electron E2E;
      run local Prettier/ESLint/typecheck/unit/build and visual checks.
- [ ] Update backend/frontend code specs, acceptance evidence, commit/archive,
      and continue to `07-19-ai-engine-grounding`.

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

## Rollback Points

- Protocol additions remain additive; do not remove legacy segment methods.
- Split/merge stays disabled per filter until export/re-import fixtures pass.
- A missing Hunspell dictionary reports unavailable and never blocks editing.
- Virtualized rows keep engine state authoritative; no unacknowledged draft may
  be evicted.
- Undo/redo never deletes operations or bypasses expected revisions.
