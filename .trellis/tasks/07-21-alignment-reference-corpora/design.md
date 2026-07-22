# Technical Design: Alignment And Reference Corpora

## 1. Ownership And Boundaries

```text
trusted Project Insights controls
  -> generated protocol-v1 alignment/corpus RPCs
  -> Engine orchestration and filter/provider access
  -> alignment-core deterministic scorer/validator
  -> transactional Store sessions, corpora, indexes, TM sink
```

`alignment-core` is a new pure Rust crate. It owns candidate generation,
confidence evidence, transition bounds, and edit-shape validation, but has no
SQLite, filesystem, network, or protocol dependency. Engine constructs bounded
inputs from authoritative documents and translates pure results into storage
records. Storage owns revisions, membership, transactions, idempotence, and
operation history. React renders returned state and sends IDs/selections only.

Corpus file parsing stays behind the existing Engine filter registry. AI
refinement reuses configured AI profiles/credentials and the existing provider
transport; `alignment-core` only validates the returned ID graph.

## 2. Alignment Model And Algorithm

An `AlignmentSession` binds one project, source document/revision, target
document/revision, project locales, algorithm version, status, session revision,
and optional terminal apply result. Creation snapshots every segment ID,
ordinal, revision, source hash/text, number signature, and protected-tag
signature into `alignment_session_segments`.

The deterministic aligner uses a banded dynamic program over ordered snapshots.
Allowed transitions are `1:1`, `1:2`, `2:1`, `1:0`, and `0:1`; configured group
and band limits prevent quadratic unbounded work. The score combines normalized
length ratio, identical number tokens, punctuation boundaries, tag-count/pair
shape, lexical anchors, and displacement penalty. Tie-breaking is stable by
transition priority and ordinal. Each output link stores source/target ID arrays,
confidence basis points, typed evidence, origin (`deterministic`, `manual`, or
`ai`), status, and revision.

Manual mutation replaces a bounded contiguous link range with a complete new
partition. That single primitive implements link/unlink/merge/split and makes
the one-owner, non-crossing, ordered invariants testable. Status-only mutations
confirm/reject links without rewriting membership.

AI refinement is bounded to selected open links and at most 64 source/target
groups. Engine sends a delimited JSON payload and requires a strict JSON result
containing only known segment IDs, grouping, confidence, and short evidence.
Unknown/duplicate/crossing IDs, text echoes, excessive output, or an invalid
partition reject the whole refinement. Accepted suggestions are persisted as
`ai`/`proposed` links and still require manual confirmation.

## 3. Persistence And Migration 12

Migration 12 adds:

- `alignment_sessions`: project/document bindings, expected revisions, locales,
  algorithm version, status, revision, terminal result, timestamps.
- `alignment_session_segments`: immutable per-side segment snapshots and
  signatures keyed by session/side/segment with unique ordinals.
- `alignment_links`: ordered membership JSON, text snapshots, confidence,
  evidence JSON, origin, status, revision, timestamps.
- `reference_corpora`: project/name/kind/locales, source kind and managed path,
  filter/format/digest, optional document/session provenance, status, revision,
  entry/diagnostic counts, timestamps.
- `reference_corpus_entries`: ordered bilingual/monolingual text, normalized
  search keys, structural path, provenance JSON, timestamps.

Foreign keys cascade session/corpus rows only with their owning project. Active
documents and TM libraries are referenced for validation but never cascade TM
or document content through corpus removal. Strict checks constrain enum text,
non-negative revisions/counts, and terminal timestamps. Migration tests cover
fresh install, v11 upgrade, restart, strict constraints, and full rollback when
a late statement fails.

## 4. Store Transactions

Session creation validates active same-project documents, non-identical IDs,
bounded segment counts, and current document revisions before inserting the
session, snapshots, and candidate links in one immediate transaction.

Every edit loads the complete affected partition, validates expected session
and link revisions plus snapshot membership/order/ownership, writes replacements,
increments the session revision once, and appends one operation. No partial link
rewrite is observable.

Alignment apply revalidates project/document/segment/library/session/link
revisions and locale/writability inside one immediate transaction. It inserts
deduplicated `tm_units` with alignment metadata, increments the library once,
records one operation, and stores a terminal `AlignmentApplyResult`. Repeating
an identical request returns that result after restart.

Corpus create inserts a validated staged managed-source reference and all
bounded entries atomically. Reindex recomputes normalized keys/projections from
stored entry text under an expected corpus revision. Remove marks the corpus
removed and deletes searchable entries while retaining the immutable managed
source for recoverability; it does not touch original document/session/TM data.

## 5. Corpus Import And Retrieval

`corpus.import` accepts one trusted input path, project ID, name, kind, locales,
and expected project revision. Engine probes or honors an explicit filter,
streams bounded filter events, and maps units as follows:

- bilingual: non-empty source and authoritative non-empty target;
- monolingual source: source text only in the project source locale;
- monolingual target: imported source text is treated as target-language
  expression data only after an explicit target kind/locale match.

`corpus.fromAlignment` materializes selected confirmed session links without
copying or mutating the documents. Provenance identifies the session, link, and
both document/segment groups.

Search normalizes the query with asset-core rules, scans only active corpora for
the project and requested side, ranks exact-prefix before contains and then by
corpus recency/ordinal/ID, and pages after deterministic sorting. Configured
limits cap corpus count, entries, text length, and candidates inspected.

`tm.concordance` remains wire-compatible: existing TM `hits` and `total` retain
their meaning, while additive `corpusHits` and `corpusTotal` fields carry the
authoritative corpus projection. `corpus.search` exposes the same result directly.

## 6. AI Grounding

Grounding options gain additive defaulted `includeCorpus` and `corpusTopN`
fields. Engine retrieves top corpus hits for the active source text and maps
them to a dedicated `GroundingCorpusMatch` list with corpus, source label,
structural path, side, source, and optional target. `build_grounded_prompt`
renders a bounded `corpus` section before document context. The section is
delimited JSON data and cannot alter system instructions. Existing callers that
omit the fields keep default behavior and generated contracts remain additive.

## 7. Protocol Surface

```text
alignment.session.create / get / list / update / refine / apply
corpus.list / import / fromAlignment / search / reindex / remove
```

List/search/get results are paged. Update uses a tagged mutation (`replaceLinks`
or `setStatus`) with expected session/link revisions. Apply carries selected
link IDs, expected session/library revisions, actor, and reason. Corpus mutations
carry expected project/corpus revisions. Typed errors map stale entity, invalid
partition, AI unavailable/invalid response, unsupported corpus input, and
resource-limit failures without source-text leakage.

## 8. Desktop Integration

Project Insights adds an `Alignment & corpora` tab backed by a focused
`AlignmentCorpusPanel`. Alignment mode provides source/target document selectors,
session creation/list, pageable rows, confidence/evidence, selection, manual
partition/status controls, optional AI refinement, writable TM selection, and
terminal apply. Corpus mode provides file selection/drop, kind/name/locale,
list, search, provenance, reindex, and a mounted accessible remove confirmation.

Main owns corpus file dialogs. Preload exposes only the typed selector. The
Workbench concordance dialog renders Engine-returned `corpusHits` below TM hits,
and the existing grounding inspector naturally renders the new corpus section.
All surfaces preserve stable dimensions at supported viewports.

## 9. Rollback And Compatibility

- New methods and fields are additive; existing TM/concordance/AI payloads keep
  their current semantics.
- No candidate, AI suggestion, or corpus row writes a TM unit implicitly.
- Failed parse/index/refine/edit/apply removes staging and leaves revisions,
  operations, managed sources, corpus entries, and TM rows unchanged.
- Disabling the new UI or methods leaves existing document, editor, interop,
  asset, AI, lifecycle, and archive workflows unchanged.
