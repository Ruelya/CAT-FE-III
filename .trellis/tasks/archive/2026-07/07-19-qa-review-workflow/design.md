# Technical Design: Comprehensive QA And Review Workflow

## 1. Architecture And Ownership

```text
Workbench / QA surface / Export review
  -> generated qa.*, review.*, document.export RPC
  -> Engine QA service and export gate
  -> qa-core deterministic rules/report serialization
  -> Storage migration 9 profiles/runs/findings/waivers/overrides
  -> existing editor history, termbase, tags, review revisions, filters
```

Add `crates/qa-core` for provider-free rule configuration, Unicode-safe checks,
fingerprints, consistency grouping, report models, HTML escaping, and minimal
XLSX serialization. It has no SQLite, Engine, Electron, or network dependency.
Storage gathers authoritative segment/tag/term data, persists projections, and
reconciles findings. Engine validates scope, coordinates export gating, and
maps typed errors. Renderer code only renders and invokes generated contracts.

## 2. Domain And Profile Model

Generalize `QaIssue.evidence` from number-only data to a backward-compatible
`QaEvidence` retaining `sourceNumbers`/`targetNumbers` plus bounded values,
related segment IDs, and Unicode scalar spans. Add `category`, `profileId`,
`runId`, location, and optional `QaWaiver` projection. Existing migration-1
JSON deserializes because new evidence fields default empty.

`QaProfile` contains immutable identity, optional owner project, built-in flag,
revision, enabled rule IDs, severity overrides, `QaRuleSettings`, and up to 100
`QaRegexRule` values. Fixed built-ins are seeded by migration 9. The default is
selected from target locale (`zh`, `ja`, `ko` -> CJK; otherwise Standard) when
`ProjectConfiguration.qa_profile_id` is absent.

Regex uses Rust `regex` with a 4 KiB pattern bound and a compile size limit.
Patterns operate independently on source/target text; no replacement or eval
is executed. Rule IDs, profile names, messages, and evidence are bounded.

## 3. Rule Evaluation And Reconciliation

`qa-core::evaluate_segment` receives source/target, locales, source/target tag
shapes, term requirements, and a validated profile. It returns sorted
`QaFindingCandidate` values with stable fingerprints over rule ID, segment ID,
normalized evidence, and related IDs. Character spans use Unicode scalar
indices, matching editor conventions.

Segment-local checks run after target/tag changes and confirmation. Document or
project QA runs evaluate every segment, then build consistency groups from the
scope. One immediate transaction upserts current fingerprints, resolves absent
findings for the evaluated rule namespace/scope, writes a `qa_runs` summary and
snapshot items, and preserves matching waivers. A waiver references one issue
ID/fingerprint; it never follows a changed finding.

Term requirements are queried from mounted active termbases at Storage and
passed to qa-core. The existing asset-core boundary remains the only owner of
locale/CJK term matching. Protected-tag checks reuse editor-core.

## 4. Migration 9

Migration 9 adds:

- `qa_profiles`: built-in/custom configuration, owner project, revision;
- `qa_runs`: project/document scope, profile snapshot hash/revision, status and
  totals;
- `qa_run_items`: immutable report snapshot rows with location/evidence/waiver;
- `qa_waivers`: one active/revocable reasoned decision per issue fingerprint;
- `qa_export_overrides`: pending/succeeded/failed delivery override attempts.

It adds nullable/defaulted columns to `qa_issues` for category/profile/run and
keeps the released status CHECK (`open|resolved`) unchanged. "Ignored" is a
derived disposition from an active waiver, avoiding a table rebuild and keeping
old readers valid. Indexes cover project/document run pages, open gate queries,
waiver lookup, and review statistics.

## 5. Protocol

Additive protocol-v1 methods:

```text
qa.profile.list/create/clone/update/delete
qa.run                 QaRunParams -> QaRunResult
qa.run.list/get        bounded pages/snapshot
qa.issue.list          filtered bounded location page
qa.issue.waive/revoke  expected waiver/issue revision -> issue
qa.report.export       runId + html|xlsx + path -> report record
qa.gate.check          documentId -> gate result
qa.override.list       bounded project/document page
review.queue           filtered pending/history page
review.stats           project/document -> statistics
```

Legacy `qa.runDocument` and `qa.list` remain and delegate to the assigned
profile/new projections. `ProjectConfiguration` gains `reviewRequired` with a
serde default of true. `ExportDocumentParams` and legacy `ExportDocxParams`
gain optional `qaOverride { actor, reason }`; omission preserves the safe gate.

New error codes are `qa_gate_blocked`, `qa_profile_invalid`, and
`report_export_error`. Error data contains IDs/counts/limits, never source or
target text.

## 6. Report And Delivery Flow

HTML is standalone UTF-8 with escaped cells and `translunar://segment/<id>`
anchors. XLSX is a minimal OOXML package written through the existing ZIP/no-
clobber utilities; all text is inline-string escaped, formula-looking content
is stored as text, hyperlinks target the same location scheme, and the package
is reopened/validated before atomic publication.

Before any filter export, Engine runs document QA and checks open unwaived error
findings. Without override it returns `qa_gate_blocked` before the filter can
publish. With override it creates a pending record, performs export, then marks
the attempt succeeded/failed. The record intentionally represents an attempt,
so a process failure cannot erase the fact that a gate bypass was requested.

## 7. Review Flow

Existing review revisions remain canonical. `review.queue` joins segment/
document location and pages pending/history deterministically. `review.stats`
derives proposal decisions and workflow counts from durable rows; it does not
cache renderer counters. `reviewRequired=true` keeps signed reachable only from
review. When false, a confirmed translation can move directly to signed and the
operation log records that explicit transition.

## 8. Desktop

Replace the current single-document QA list with a profile/scope toolbar,
summary strip, filter rail, paged issue table, detail/waiver action, report
menu, and review statistics band. `Go to segment` keeps the existing navigation
callback. Export review calls `qa.gate.check`, displays blockers, and reveals a
reason/actor override form only after the user selects override.

Workbench inline findings consume returned issue category/severity/waiver state.
No regex evaluation, term matching, consistency grouping, report construction,
or gate decision is implemented in React.

## 9. Compatibility And Rollback

Migration 9 is additive and uses the existing pre-migration backup. Built-in
profiles are deterministic seeded rows. Hiding the new UI leaves legacy QA RPC
behavior functional, but export remains safely gated. Rollback means reverting
the binary and restoring the automatic pre-v9 backup; released migrations 1..8
are never edited.
