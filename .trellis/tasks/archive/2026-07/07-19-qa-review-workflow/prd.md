# Comprehensive QA And Review Workflow

## Goal

Turn the existing number/forbidden-term checks and segment review primitives
into a complete, durable quality workflow. Translators receive live findings,
reviewers can run document or project checks, manage justified false positives,
export navigable HTML/XLSX reports, accept or reject revision proposals, inspect
review statistics, and prevent an accidental delivery while blocking errors
remain. Every decision is Engine-owned, revisioned, restart-safe, and auditable.

## Scope And Decisions

This child owns PRD H-01 through H-09 and I-01/I-02 as assigned by parent R6.
It extends the existing `qa_issues`, review revisions, editor history, and
translation -> review -> signed state rather than replacing them.

- Rust owns rule evaluation, profile validation, issue reconciliation,
  waivers, reports, review statistics, and export gates. React never recomputes
  a rule or decides that a delivery is clear.
- Built-in profiles cover general mechanical QA and a CJK-focused variant.
  Custom regex rules are data in revisioned profiles; public plugin rules remain
  in the later plugin-runtime task.
- Mechanical QA is deterministic and local. AI semantic QA (H-10), MQM/LQA
  scorecards (H-11), QA plugin SDK (H-12), and sampling (H-13) belong to later
  tasks.
- Existing document export methods remain additive-compatible. They run a fresh
  gate before publication; an explicit override requires actor and reason and
  is recorded with success/failure status.
- Automated tests use deterministic multilingual fixtures and write reports to
  temporary paths. They do not invoke public network services.

## Requirements

### R1. Profiles And Rule Configuration (H-02, H-03, H-06)

- List built-in `Standard` and `CJK professional` profiles. A profile contains
  enabled rule IDs, severity overrides, length-ratio/absolute limits, CJK
  punctuation and spacing preferences, and bounded custom regex rules.
- Create, clone, update, and delete custom profiles with expected revisions.
  Built-ins are immutable. A project chooses one profile, which is preserved by
  project configuration/templates; locale-aware default selection remains
  deterministic when none is assigned.
- Regex rules specify stable ID, label, source/target/both field, pattern,
  optional replacement hint, severity, and message. Reject invalid regex,
  duplicate IDs, unsupported constructs, and unbounded names/patterns/rule
  counts before persistence.

### R2. Mechanical And CJK Rules (H-01, H-02, H-03)

- Check empty/missing target, source-equals-target, number and unit mismatch,
  protected tag identity/order, unbalanced brackets/quotes, leading/trailing
  whitespace, repeated words, configured length limit/ratio, and regex rules.
- CJK rules cover full-/half-width punctuation, sentence-final punctuation,
  CJK/Latin spacing, ellipsis, and dash conventions with locale-aware behavior.
  Rules emit stable category/rule IDs, severity, message, fingerprint, bounded
  evidence values, and source/target character spans where applicable.
- Target/tag mutations reconcile segment-local QA immediately. Confirmation
  returns current findings and cannot hide errors. Document/project runs also
  reconcile cross-segment rules and persist a reproducible run summary.

### R3. Terminology And Consistency (H-04, H-05)

- For mounted active termbases, flag a preferred target term missing when its
  source term occurs, forbidden target translations that occur, and deprecated
  or explicitly forbidden terminology. Matching remains locale/CJK aware and
  uses the asset-core boundary.
- Detect same normalized source with materially different non-empty targets and
  different normalized sources sharing a suspiciously identical non-empty
  target. Findings reference the related segment IDs without embedding
  unbounded document text.
- Re-running resolves findings whose condition no longer exists and reopens the
  same fingerprint if it returns; it does not create duplicates.

### R4. Runs, Pages, And False-Positive Management (H-01, H-07)

- Run QA for one document or all active documents in a project with an explicit
  profile and scope. Persist run ID, profile revision/snapshot hash, timestamps,
  status, checked segment count, and severity/category/disposition totals.
- List findings with bounded deterministic paging and filters for scope,
  severity, category, rule, disposition, document, and segment. Results include
  document/segment ordinal location data for direct navigation.
- Ignore/waive an open finding only with a non-empty reason and actor. Waivers
  are revisioned, durable, visible in reports, and can be revoked. A changed
  fingerprint is a new finding and is never silently covered by an old waiver.

### R5. HTML/XLSX Reports (H-08)

- Export an immutable report snapshot from a completed QA run as standalone
  UTF-8 HTML or valid XLSX. Both contain project/document, run/profile/time,
  totals, severity/category/disposition, rule/message, bounded evidence,
  waiver reason/actor, and a stable `translunar://segment/<id>` location link.
- Validate the report after generation and publish without replacing an
  existing destination. A failed export leaves no destination or partial DB
  report record.

### R6. Delivery Gate And Override (H-09)

- Before every original-format export, run current QA with the assigned/default
  profile. Open unwaived `error` findings block publication with typed
  `qa_gate_blocked` data containing counts and issue IDs only.
- A caller may override only with bounded non-empty actor and reason. Persist an
  override attempt with project/document/run IDs, error count, reason, actor,
  destination metadata, timestamp, and `pending/succeeded/failed` status. No
  source/target text is stored in the audit row.
- The Export review UI shows the gate, links to each blocker, requires explicit
  override controls, and never converts a failed export into a success notice.

### R7. Review State And Statistics (I-01, I-02)

- Preserve revision proposals with before/proposed source, target, and tags;
  accept/reject remains expected-revision protected and history/undo aware.
  Pending proposals are visible by segment and in a project review queue.
- Keep translation -> review -> signed as the default state flow. A project may
  disable mandatory review; direct sign-off is then explicit and recorded,
  while signed segments remain read-only until deliberately returned.
- Provide project/document review statistics: translation/review/signed segment
  counts, pending/accepted/rejected proposal counts, reviewed characters, and
  reviewer breakdown. Values are derived from durable Engine state.

### R8. Desktop Experience

- Upgrade QA review into a working surface with scope/profile controls,
  run summary, severity/category/disposition filters, issue navigation,
  reasoned waive/revoke actions, HTML/XLSX export, and review statistics.
- Inline QA in Workbench distinguishes error/warning/info and waived findings,
  preserves keyboard/IME behavior, and refreshes from authoritative responses.
- Profile editing, report export, gate override, and review actions expose
  busy/error/empty states, keyboard/ARIA semantics, and no horizontal overflow
  at 1250x744, 1680x942, or 1920x1080.

## Acceptance Criteria

- [x] QA-core tests cover every mechanical/CJK rule, locale edge cases,
      deterministic fingerprints/spans, regex validation, and consistency
      grouping without panics on Unicode or empty text.
- [x] Migration 9 fresh/upgrade/rollback tests prove profile/run/waiver/report/
      gate data survives restart while existing QA/review rows remain readable.
- [x] Profile CRUD/clone/revision conflicts, locale defaulting, custom regex,
      segment-live reconciliation, project/document runs, paging/filtering,
      terminology, consistency, waiver/revoke, and review statistics pass Rust
      unit/integration tests.
- [x] HTML and XLSX reports parse successfully, contain matching totals and
      `translunar://segment/<id>` links, escape hostile text/formulas, and never
      clobber an existing destination.
- [x] Every document export refreshes QA and blocks open unwaived errors before
      publication. A reasoned override is durable and reaches succeeded/failed
      accurately; blocked/failed paths publish no misleading output.
- [x] Review proposals and translation/review/signed state transitions remain
      revision-safe, undoable, restart-safe, configurable per project, and
      represented by authoritative statistics.
- [x] Engine smoke covers profile setup, dirty multilingual fixtures, project
      run, waiver, both report formats, blocked export, successful override,
      review queue/stats, restart, and existing import/export flows.
- [x] Electron E2E exercises the QA surface, profile regex, direct location,
      waive/revoke, report export, gate override, proposal accept/reject, state
      flow and statistics through the real Engine with no console/page errors.
- [x] Rust fmt/clippy/workspace tests, protocol drift, stdio smoke, Windows GNU,
      Node 22 format/lint/typecheck/unit/build, Electron E2E, performance, and
      three-viewport visual gates remain green.

## Out Of Scope

AI semantic QA, QE-driven sampling, MQM/LQA scoring, public QA plugin SDK,
bilingual review DOCX round-trip, offline task packages, discussion mentions,
version snapshots, real-time collaboration, assignments, and enterprise RBAC or
audit are owned by later children. This task adds a narrow delivery-override
record, not a general enterprise audit subsystem.
