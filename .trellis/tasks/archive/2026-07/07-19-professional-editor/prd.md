# Professional Translation Editor

## Goal

Deliver the complete editor surface in `docs/PRD.md` v2.0 section C. A
translator can safely edit tagged content, reuse assets, propagate repeats,
search and transform a project, restructure segments, discuss and revise work,
spell-check, operate entirely from the keyboard, recover every edit, and work
smoothly in thousand-segment documents.

## Requirements

### E1. Authoritative editor projection and tags (C-01..C-04)

- Replace the plain segment page with an additive editor query that returns each
  segment with source/target inline tags, comments, spell findings, review
  revision data, and bounded context. Existing `segment.list` remains
  compatible.
- Protected inline tags render as focusable capsules, not editable text. Users
  can copy the source tag sequence, insert a single tag or matched pair at the
  target caret, and move target tags through an Engine command carrying
  `expectedRevision`.
- Tag identity/payload/protection remains filter-owned and immutable. The Engine
  validates target tag membership, one-use cardinality, pair order/nesting,
  target positions at UTF-8 character boundaries, and emits live structured
  missing/extra/order findings.
- Suggestions unify TM matches, term hits, Assistant output, and QA. Number
  shortcuts insert visible suggestions only when focus is in the editor and IME
  composition is inactive. TM cards display score/provenance and source
  differences without recomputing rankings in React.

### E2. Translation commands and source correction (C-05..C-10, C-16)

- Confirmation can propagate the accepted target/tag structure to other
  unconfirmed segments with the same source hash in one transaction. The
  response lists every changed segment and its new revision; existing confirmed
  targets are never overwritten.
- Concordance supports source and target direction from selection or query and
  exposes surrounding source/target examples.
- Project/file find supports source/target/both, status/QA filters, literal or
  bounded regular expressions, and paged deterministic results. Replace first
  previews an operation set, then applies an unchanged preview token with
  expected revisions; stale sets fail atomically.
- Split and merge are document-authoritative operations. Split uses a
  character-boundary source offset and optional target offset; merge accepts
  adjacent segment IDs only. Both preserve order, tags, notes, revisions,
  structural lineage, and export compatibility, and record a reversible
  operation.
- Generic source correction is P1 but implemented here: a non-empty reason and
  expected revision are mandatory, confirmed segments are rejected, source and
  neighboring context hashes recalculate atomically, and history retains the
  correction. PDF OCR continues through its stricter existing command.
- Autocomplete is a real editor interaction, not only a preference toggle. It
  consumes Engine-ranked TM results first, then preferred non-forbidden term
  translations, displays the provider and completion tail, and accepts with
  Tab only when IME composition is inactive.

### E3. Comments, spelling, CJK and keyboard operation (C-11..C-15)

- Segment comments form a durable thread with author, text, created/edited time,
  revision, and resolved state. Create/edit/resolve/delete require revisions;
  import notes appear as immutable system entries rather than disappearing.
- Spell checking uses system or configured Hunspell dictionaries when present,
  supports a durable per-workspace user dictionary, and returns bounded
  misspelling ranges/suggestions. Missing dictionaries are an explicit
  capability state, not a fake clean result.
- CJK assistance reports configurable mixed-script spacing and full/half-width
  punctuation suggestions. OpenCC exposes Simplified, Traditional, Taiwan and
  Hong Kong conversion in both supported directions through a revisioned,
  signed-safe Engine mutation backed by embedded phrase dictionaries.
  Composition events never trigger confirm, suggestions, navigation, replace,
  split/merge, conversion, or global shortcuts.
- A central command registry owns keyboard bindings, labels, enabled predicates,
  and dispatch. P0 commands cover save, confirm, next/previous segment,
  suggestion 1..9, search/replace, concordance, copy source, copy/insert tags,
  split/merge, comment, undo/redo, panels, theme, zoom, and nonprinting marks.
  Bindings are editable and collision-validated; Trados/memoQ presets are
  additive P1 presets.

### E4. Durable history, review and presentation (C-17..C-20, I-01/I-02 base)

- Every editor mutation writes a reversible operation with before/after state
  and actor/reason where applicable. Undo and redo are project-scoped,
  revision-conflict aware, survive restart, and never erase history. A new edit
  after undo invalidates only the redo cursor.
- Review mode stores proposed target/source/tag changes as revisions against a
  base segment revision. Reviewers can accept or reject one proposal, and the
  UI shows a word-level diff. Accepted revisions apply through the same
  authoritative mutation path; status supports translation, review, and signed
  while remaining optional for personal projects.
- Theme (light/dark/system), editor zoom, nonprinting marks, autocomplete,
  punctuation assistance, and shortcuts persist as user preferences. Theme and
  zoom apply without reloading or changing export content.
- The context panel shows bounded previous/active/next segments and uses the
  existing page preview where available. A documented host contribution point
  renders registered built-in/editor panels and can later accept plugin panels;
  arbitrary plugin code is not executed by this child.

### E5. Large-document performance and accessibility

- Segment queries support authoritative filters, search, stable sort, and cursor
  or offset paging. The renderer virtualizes rows and never loads or mounts all
  thousand segments at once.
- Drafts remain immediate and crash-safe; scrolling/unmounting flushes edits
  without losing focus or IME composition. Focus returns to the engine-selected
  active row after mutation/filter changes.
- Grid, tag capsules, command palette, dialogs, comments, findings, and
  virtualization expose keyboard/ARIA semantics. Reduced motion disables
  scrolling animation, and themes meet readable contrast at supported zoom.

## Acceptance Criteria

- [x] Tagged DOCX/HTML/Markdown/XLIFF fixtures render protected capsules; copy,
      insert, pair, move, confirm, restart, and export preserve valid tag
      identity/order, while missing/extra/crossed tags are blocked with typed
      findings.
- [x] Confirm propagation updates every eligible duplicate atomically, skips
      confirmed/stale rows, persists through restart, and returns authoritative
      changed segments/counts/history.
- [x] Concordance, paged filter/search, regex replace preview/apply, split,
      adjacent merge, and reasoned source correction pass happy, boundary,
      stale, rollback, restart, and export/re-import tests.
- [x] Comments, system import notes, Hunspell/user dictionary, CJK spacing and
      punctuation suggestions are durable, bounded, keyboard accessible, and
      distinguish unavailable capability from zero findings.
- [x] Undo/redo covers target edits, tags, propagation, replace, split/merge,
      comments, source correction, and review acceptance across restart; stale
      undo and redo-after-branch fail without partial writes.
- [x] Keyboard registry/custom bindings/presets, IME guards, suggestion 1..9,
      command palette, theme/system/dark/light, zoom, and nonprinting marks work
      in Electron without browser or OS shortcut leakage.
- [x] A 10,000-segment fixture pages and virtualizes the editor; at most 120 rows
      are mounted, search/filter latency is under 150 ms P95, scroll/input P95
      frame time is below 33 ms, and memory remains bounded during a 60-second
      scripted run.
- [x] Review proposal diff, accept/reject, translation/review/signed flow,
      context panel, and built-in panel registry persist and are covered by
      Engine and Electron tests.
- [x] Existing filter round trips, PDF OCR, assets, QA, backups, protocol v1,
      local build, VPS Rust gates, Engine smoke, and all Electron screenshots
      remain green.

## Acceptance Evidence

- Engine/storage tests cover migrations 6 and 7, editor projection, protected
  tag validation and stable equal-position pair ordering, atomic propagation,
  concordance/find/replace, split/merge, source correction, comments, spelling,
  user dictionary, review/workflow state, preferences, and persistent
  conflict-aware undo/redo including TM and QA side effects.
- The real stdio smoke exercises editor methods across Engine restart, including
  OpenCC conversion and undo. Electron E2E covers tag pair insertion, movement
  and copying; full comment CRUD; TM-backed Tab autocomplete; IME guards;
  command registry/palette; review and signed read-only behavior; Chinese
  conversion; theme/zoom; filters; and symmetric panel modes.
- The 10,000-segment real renderer run lasted 60,001.5 ms with 3,243 frames,
  16.8 ms P95 frame time, 83.4 ms maximum frame time, at most 100 mounted rows,
  56 heap samples, and zero measured peak/final heap growth. The storage search
  benchmark remains below the 150 ms P95 requirement.
- Final release evidence is recorded in `check.jsonl` and the task archive after
  the complete VPS Rust/Node 22, Windows GNU cross-build, and Electron gates
  pass on the synchronized workspace.

## Constraints And Decisions

- Rust/SQLite owns editor semantics and revisions; React never invents state,
  tag validity, replace sets, spell findings, propagation results, or undo.
- Schema evolution is additive from migration 5 and creates a pre-migration
  backup through the existing Store open path. Existing protocol methods and
  source files remain compatible.
- Structural split/merge export uses explicit derived lineage and filter
  validation. If a format cannot safely reconstruct a mutation, the command
  returns a typed unsupported-state error rather than corrupting output.
- Hunspell is optional at runtime and resolved from configured directories or
  supported platform locations. No dictionary or OpenCC corpus is silently
  downloaded.
- Review workflow here is local single-user state; packages, offline exchange,
  assignments, real-time locks, and team presence belong to later children.
- UI plugin execution and third-party permissions belong to the plugin-runtime
  child; this task supplies only the stable host contribution model.
