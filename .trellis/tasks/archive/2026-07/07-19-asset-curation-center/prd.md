# Asset Curation Center

## Goal

Make the translation asset hub inspectable and maintainable. A translator can
browse all local TM, termbase, and reference-corpus assets, run a bounded
curation pass, understand every finding, preview proposed quarantine changes,
apply only selected changes, export the clean bilingual data, and restore the
original state after a restart. Existing confirmation/import/alignment sinks
remain the authoritative ways assets enter the hub.

## Confirmed baseline

- TM libraries and units, termbases, and reference corpora already have
  durable IDs, provenance, paging, open-format exchange, and revision-aware
  writes. See `research/asset-curation-evidence.md` for file anchors.
- The Rust Engine owns all domain rules and SQLite writes; generated protocol
  types are the only renderer boundary.
- Existing QA and alignment crates provide deterministic number,
  placeholder, terminology, consistency, length, and lexical evidence that can
  be reused or wrapped without moving rules into TypeScript.
- There is no scheduler or public curation strategy plugin yet. The next child
  owns those foundations.

## Scope and requirements

### R1. Unified asset catalog (AC-01)

- Expose one bounded, deterministic catalog over TM libraries/units, termbases/
  entries, and active reference corpora/entries.
- Support optional project scope, asset kind, source/target locale, domain,
  origin project/document, created-at range, query text, and paging filters.
- Return collection identity plus enough row provenance to open a finding or
  source record; never return unbounded text or silently merge duplicate IDs.

### R2. Provenance-preserving intake (AC-02)

- Preserve and surface the existing editor confirmation, asset import, and
  alignment/corpus provenance. Curation must not create a second sink or alter
  the legacy confirmation contract.
- Define the curation input projection so future API/plugin children can feed
  the same TM sink and catalog without a schema fork.

### R3. Rule curation (AC-03)

- Analyze one explicitly selected TM library per run for exact duplicates,
  near/competing duplicates, source equals target, empty/minimum text,
  length-ratio outliers, number/date/placeholder
  mismatches, and configurable created-at date bounds.
- Produce stable rule IDs, severity, score contribution, bounded evidence,
  canonical/duplicate relationships, and a proposed disposition. Analysis does
  not mutate rows.

### R4. Semantic and language signals (AC-04)

- Always run offline locale/script and lexical-alignment checks. Detect likely
  wrong-language targets and source/target semantic mismatch as findings, not
  automatic deletion decisions.
- If a configured AI provider is requested, send a bounded delimited payload
  and accept only strict JSON annotations referring to known unit IDs. Invalid,
  stale, over-sized, or text-injecting responses are rejected as a whole.

### R5. Quality scoring (AC-05)

- Assign each analyzed TM unit a deterministic score in basis points with an
  explanation containing rule penalties, provenance, and optional provider
  evidence. Low-score units are quarantine candidates; scores never silently
  change search behavior until an apply is explicitly accepted.
- Store score/state on the unit projection and retain the previous projection in
  a curation change record.

### R6. Terminology mining and drift (AC-06, AC-07)

- Mine bounded candidate source terms and stable target translations from the
  selected TM library. Return frequency, translation agreement, locale,
  domain, and source provenance; candidates remain termbase `candidate` data
  until a later explicit term upsert.
- Report same-source/different-target, competing term translations, and
  source/target drift with related unit IDs and evidence. Offer a selected,
  explicit normalization proposal but do not mutate termbases or corpora in
  this child.

### R7. Explainable preview and rollback (AC-08)

- `run` creates an immutable analysis result and findings. `apply` requires the
  run revision, expected library revision, actor, reason, and selected finding
  IDs. Every run is bound to one existing project for audit ownership even
  when the selected library is shared globally; it atomically quarantines
  selected TM units, updates scores, appends an operation, and records
  before/after JSON.
- `rollback` is revision-protected and atomically restores the prior score,
  state, and last-run fields from the recorded before image while advancing
  revisions monotonically. It is idempotent for an already-restored run
  and rejects stale/interleaved mutations without partial writes.
- No curation operation hard-deletes an asset. Original text/provenance remains
  queryable in the change record and a quarantined unit remains recoverable.

### R8. Bounded clean dataset export (AC-10 foundation)

- Export active, optionally minimum-score-filtered TM units from a completed
  run as UTF-8 JSONL (instruction/response with provenance) or TSV. Validate
  and publish to a new destination atomically without clobbering an existing
  file.
- Export is read-only, reports row count and run/library revisions, and never
  trains a model or sends user data to a provider.

## Acceptance criteria

- [ ] AC1: A catalog request with all-project scope returns deterministic,
      paged TM, termbase, and corpus projections with locale/domain/source/time
      filters; restart returns the same IDs and order.
- [ ] AC2: Existing editor confirmation, TM/TBX/CSV import, and alignment/corpus
      provenance remain intact; curation adds no duplicate sink and future
      source kinds map to the same projection.
- [ ] AC3: The dirty TM fixture detects exact/near duplicates, source=target,
      length/number/date/placeholder anomalies, and date-bound rows with stable
      evidence and no mutation during analysis.
- [ ] AC4: Offline wrong-language and semantic-mismatch signals are present;
      malformed, oversized, unknown-ID, or stale optional-provider responses
      produce a typed error and zero writes.
- [ ] AC5: Every analyzed unit has a bounded score/explanation. The fixture's
      known dirty rows are detected at `>= 90%` and no high-quality fixture row
      is automatically quarantined without an explicit selection.
- [ ] AC6: Mining returns stable term candidates and drift groups with related
      IDs; accepting a candidate requires the existing termbase upsert path.
- [ ] AC7: Same-source/different-target and competing-term reports are
      deterministic, pageable, and include explainable evidence.
- [ ] AC8: Preview/apply/rollback survives restart, enforces run/library
      revisions, appends auditable operations, preserves before images, and
      restores the prior score/state projection without decrementing revisions.
- [ ] AC9: JSONL/TSV export contains only active eligible units, is validated,
      bounded, and never overwrites an existing destination.
- [ ] AC10: Rust unit/storage/engine tests, migration tests, contract drift,
      strict Clippy/fmt, desktop lint/typecheck/unit tests, stdio smoke, and a
      real-Engine Electron flow cover empty/loading/error/stale/rollback,
      accessibility, restart, no console/page errors, and no horizontal
      overflow at supported viewports.

## Constraints and non-goals

- Migration is append-only (current schema 14 -> 15), SQLite remains the
  source of truth, and all compound writes use immediate transactions.
- Catalog scope may be global or project-filtered. A curation run always
  requires `projectId`; the project owns its apply/rollback operation history
  but does not narrow a shared library's analyzed unit set.
- Hard bounds: 100,000 TM units per run; 500 rows per page; 32 evidence values;
  256 characters per evidence value; 256 KiB provider envelopes. Oversized
  requests fail before writes.
- AC-09 idle/background scheduling and AC-11 third-party strategy plugins are
  deferred to `07-19-plugin-runtime-sdk` and its scheduler follow-up. This task
  provides no autonomous or hidden background mutations.
- AI model training, embedding-model distribution, cross-user sync, corpus
  deletion, termbase bulk mutation, billing, and customer-portal behavior are
  out of scope.

## Risk decisions

- Deterministic offline signals are the baseline so the feature remains local
  and testable. Provider-backed semantic evidence is advisory and cannot lower
  the zero-write/explicit-apply safety bar.
- Quarantine is the only automatic disposition. Deletion and term
  normalization remain explicit, reversible follow-up actions.
