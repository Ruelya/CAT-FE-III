//! SQLite-backed persistence for the engine state.
//!
//! ## Why rusqlite
//!
//! The engine is a single-threaded, synchronous JSON-RPC loop (`main.rs`
//! fans stdin frames and agent-worker events into one thread). `rusqlite`
//! matches that model directly; `sqlx` would pull an async runtime into a
//! loop that has none. The `bundled` feature compiles SQLite into the
//! binary, so the packaged desktop engine keeps zero system dependencies.
//!
//! ## Storage model
//!
//! One database per data directory (`engine.sqlite`), WAL journal mode, and
//! `synchronous=FULL`, so a process kill or power cut mid-write never
//! corrupts the file: SQLite either replays fully committed WAL frames or
//! discards the uncommitted tail on the next open. Every engine mutation is
//! persisted as one [`StateDelta`] inside one transaction; there is no
//! whole-state rewrite anywhere on the write path anymore.
//!
//! ## Read model — what pages from SQL and what stays in RAM
//!
//! The row tables never get a full RAM copy anymore:
//!
//! - `segments` is read per document straight from SQL (`segment.list`
//!   pages with LIMIT/OFFSET over the `(document_id, ordinal)` index; edit,
//!   confirm, pretranslate, agent, QA, and export fetch only the rows of
//!   the document or hash they touch).
//! - `tm_entries` is read per entry or per page from SQL (`tm.list` pages
//!   over the `(memory_id, confirmed_at_ms DESC, id)` index; exact lookups
//!   are point queries on the unique `(memory_id, source_hash)` index).
//! - `term_entries` is read per termbase from SQL (`term.list` pages over
//!   the `term_entries_by_termbase` index; update and delete are point
//!   queries by id; lookup, import, and QA materialize one termbase — or a
//!   project's attached termbases — transiently, never the whole table).
//! - `qa_issues` is read per document from SQL (`qa.list` pages the join
//!   through the document's segments; `qa.run` reconciles one document's
//!   issues transiently and writes only the rows that changed; `qa.waive`
//!   point-reads and point-writes a single row).
//!
//! Honest limits of what remains memory-resident, loaded once at open:
//!
//! - [`EngineState`] still holds every project, document *metadata* row
//!   (not its segments), termbase, and termbase mount. These are tiny
//!   identity tables (one row per project / file / termbase), not per-entry
//!   data.
//! - The fuzzy TM recall index stays in RAM by design: it stores token
//!   postings and per-entry token counts keyed by entry id — not the entry
//!   rows themselves — and open() streams `(id, memory_id, source_text)`
//!   once to rebuild it without retaining the rows.
//!
//! ## Legacy `state.json`
//!
//! Data directories written by earlier builds hold one whole-state
//! `state.json`. The first time this store opens such a directory it imports
//! the file into the database in one transaction and renames it to
//! `state.json.imported-backup`. A meta flag records that the import
//! happened (or that the directory started fresh), so a stale JSON file
//! dropped in later can never overwrite newer database rows.

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tl_asset::{TermEntry, Termbase, TermbaseMount};
use tl_domain::{
    Document, Project, QaIssue, QaIssueStatus, Segment, SegmentCounts, SegmentOrigin, SegmentState,
    TmEntry, source_word_count,
};

pub const DB_FILE_NAME: &str = "engine.sqlite";
const LEGACY_STATE_FILE: &str = "state.json";
const LEGACY_BACKUP_FILE: &str = "state.json.imported-backup";
const META_LEGACY_IMPORT: &str = "legacy_state_json_import";

/// Ordered migration scripts; `PRAGMA user_version` records how many have
/// been applied. Append-only: never edit a shipped script, add a new one.
const MIGRATIONS: &[&str] = &[
    SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6,
];

/// Backs `tm.list` paging: `WHERE memory_id = ? ORDER BY confirmed_at_ms
/// DESC, id` walks this index instead of sorting the memory per request.
const SCHEMA_V2: &str = "
CREATE INDEX tm_entries_by_memory_recency ON tm_entries(memory_id, confirmed_at_ms DESC, id);
";

/// `qa.waive` support: the optional note recorded with a waiver. NULL for
/// every non-waived row (and for all rows written by earlier builds).
const SCHEMA_V3: &str = "
ALTER TABLE qa_issues ADD COLUMN waive_note TEXT;
";

/// `Segment.origin` persistence. Deliberately no backfill: rows written
/// before origins existed keep a NULL `origin_kind` forever, which reads
/// back as "no origin" — the engine never invents where old text came from.
const SCHEMA_V4: &str = "
ALTER TABLE segments ADD COLUMN origin_kind TEXT;
ALTER TABLE segments ADD COLUMN origin_score INTEGER;
ALTER TABLE segments ADD COLUMN origin_model TEXT;
ALTER TABLE segments ADD COLUMN origin_edited INTEGER NOT NULL DEFAULT 0;
";

/// `Segment.locked` persistence. Rows written by earlier builds default to
/// unlocked, matching the wire default.
const SCHEMA_V5: &str = "
ALTER TABLE segments ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
";

/// `QaIssue.params` persistence: structured message parameters as a JSON
/// object. NULL for rows written by earlier builds, read back as empty —
/// old findings simply have nothing to parameterize.
const SCHEMA_V6: &str = "
ALTER TABLE qa_issues ADD COLUMN params TEXT;
";

const SCHEMA_V1: &str = "
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  domain TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  revision INTEGER NOT NULL,
  configuration TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  archived_at_ms INTEGER
) STRICT;

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  format TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  segment_count INTEGER NOT NULL,
  degradation TEXT NOT NULL,
  imported_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  managed_source_path TEXT NOT NULL
) STRICT;
CREATE INDEX documents_by_project ON documents(project_id);

CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  structural_path TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  leading TEXT NOT NULL
) STRICT;
CREATE INDEX segments_by_document ON segments(document_id, ordinal);
CREATE INDEX segments_by_source_hash ON segments(source_hash);

CREATE TABLE tm_entries (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  origin_project_id TEXT NOT NULL,
  origin_document_id TEXT NOT NULL,
  origin_segment_id TEXT NOT NULL,
  confirmed_at_ms INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX tm_entries_by_memory_hash ON tm_entries(memory_id, source_hash);

CREATE TABLE qa_issues (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX qa_issues_by_segment ON qa_issues(segment_id);
CREATE INDEX qa_issues_by_fingerprint ON qa_issues(fingerprint);

CREATE TABLE termbases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  domain TEXT,
  writable INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE term_entries (
  id TEXT PRIMARY KEY,
  termbase_id TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  source_term TEXT NOT NULL,
  part_of_speech TEXT,
  definition TEXT,
  example TEXT,
  domain TEXT,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  translations TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX term_entries_by_termbase ON term_entries(termbase_id);

CREATE TABLE termbase_mounts (
  project_id TEXT NOT NULL,
  termbase_id TEXT NOT NULL,
  priority INTEGER NOT NULL,
  writable INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, termbase_id)
) STRICT;
";

/// The in-memory working set loaded once at open. Deliberately excludes the
/// row tables: segments, TM entries, term entries, and QA issues are read
/// from SQL on demand (see the module docs for the honest split).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct EngineState {
    pub projects: BTreeMap<String, Project>,
    pub documents: BTreeMap<String, DocumentRecord>,
    pub termbases: BTreeMap<String, Termbase>,
    pub termbase_mounts: Vec<TermbaseMount>,
}

/// Document metadata kept in RAM. Segment ids, ordering, and leading text
/// live in the `segments` table and are queried per document when needed.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentRecord {
    pub document: Document,
    /// Engine-managed copy of the imported source file; export re-reads it.
    pub managed_source_path: String,
}

/// Legacy whole-state `state.json` document shape. Exists only so the
/// one-time import can parse files written by earlier builds.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyState {
    #[serde(default)]
    projects: BTreeMap<String, Project>,
    #[serde(default)]
    documents: BTreeMap<String, LegacyDocumentRecord>,
    #[serde(default)]
    segments: BTreeMap<String, Segment>,
    #[serde(default)]
    tm_entries: BTreeMap<String, TmEntry>,
    #[serde(default)]
    qa_issues: BTreeMap<String, QaIssue>,
    #[serde(default)]
    termbases: BTreeMap<String, Termbase>,
    #[serde(default)]
    term_entries: BTreeMap<String, TermEntry>,
    #[serde(default)]
    termbase_mounts: Vec<TermbaseMount>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDocumentRecord {
    document: Document,
    managed_source_path: String,
    /// Ignored on import: the `ordinal` column is the order of record.
    #[serde(default)]
    segment_ids: Vec<String>,
    #[serde(default)]
    segment_leading: BTreeMap<String, String>,
}

/// One engine mutation, persisted as one transaction. Entities not touched
/// by the mutation stay untouched in the database, which is what makes
/// writes O(change) instead of O(state).
#[derive(Debug, Default)]
pub struct StateDelta {
    pub projects: Vec<Project>,
    pub documents: Vec<DocumentRecord>,
    pub segments: Vec<Segment>,
    /// Leading text for segments inserted for the first time (import).
    /// Existing rows keep their stored leading on conflict.
    pub segment_leading: BTreeMap<String, String>,
    pub tm_entries: Vec<TmEntry>,
    pub qa_issues: Vec<QaIssue>,
    pub termbases: Vec<Termbase>,
    pub term_entries: Vec<TermEntry>,
    pub termbase_mounts: Vec<TermbaseMount>,
    /// Row deletions by id, applied before the upserts in the same
    /// transaction (tm.delete / term.delete remove-then-never-reuse ids).
    pub deleted_tm_entries: Vec<String>,
    pub deleted_term_entries: Vec<String>,
    /// `(project_id, termbase_id)` mount rows removed by termbase.detach.
    pub deleted_termbase_mounts: Vec<(String, String)>,
    /// Document ids removed by document.remove. Each id cascades inside the
    /// same transaction: the document's QA issues (through the segment
    /// join), its segments, and the document row itself. TM entries are
    /// deliberately not part of the cascade — confirmed translations
    /// outlive the document they came from.
    pub deleted_documents: Vec<String>,
}

impl StateDelta {
    pub fn is_empty(&self) -> bool {
        self.projects.is_empty()
            && self.documents.is_empty()
            && self.segments.is_empty()
            && self.tm_entries.is_empty()
            && self.qa_issues.is_empty()
            && self.termbases.is_empty()
            && self.term_entries.is_empty()
            && self.termbase_mounts.is_empty()
            && self.deleted_tm_entries.is_empty()
            && self.deleted_term_entries.is_empty()
            && self.deleted_termbase_mounts.is_empty()
            && self.deleted_documents.is_empty()
    }
}

#[derive(Debug)]
pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(data_dir: &Path) -> io::Result<(Self, EngineState)> {
        std::fs::create_dir_all(data_dir)?;
        let mut conn = Connection::open(data_dir.join(DB_FILE_NAME)).map_err(db_err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(db_err)?;
        // journal_mode returns the resulting mode as a row; read and check it.
        let mode: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
            .map_err(db_err)?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(io::Error::other(format!(
                "could not enable WAL journal mode, got {mode}"
            )));
        }
        // FULL keeps every committed transaction durable across power loss,
        // not just structurally consistent. Commit-time fsync cost is fine
        // for a desktop engine whose writes are user-paced.
        conn.pragma_update(None, "synchronous", "FULL")
            .map_err(db_err)?;
        migrate(&mut conn)?;
        import_legacy_state(&mut conn, data_dir)?;
        let state = load_state(&conn)?;
        Ok((Self { conn }, state))
    }

    /// Persist one mutation in one transaction. Either every row in the
    /// delta commits or none does.
    pub fn apply(&mut self, delta: &StateDelta) -> io::Result<()> {
        if delta.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction().map_err(db_err)?;
        write_delta(&tx, delta)?;
        tx.commit().map_err(db_err)
    }

    // ---- Segment reads (per document or per row, never the whole table) ----

    /// One segment by id.
    pub fn segment(&self, segment_id: &str) -> io::Result<Option<Segment>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {SEGMENT_COLUMNS} FROM segments WHERE id = ?1"
            ))
            .map_err(db_err)?;
        statement
            .query_row([segment_id], segment_from_row)
            .optional()
            .map_err(db_err)
    }

    /// One page of a document's segments in grid order (ordinal, then id).
    /// `limit: None` returns everything from `offset` on.
    pub fn document_segments_page(
        &self,
        document_id: &str,
        offset: u32,
        limit: Option<u32>,
    ) -> io::Result<Vec<Segment>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {SEGMENT_COLUMNS} FROM segments WHERE document_id = ?1
                 ORDER BY ordinal, id LIMIT ?2 OFFSET ?3"
            ))
            .map_err(db_err)?;
        // SQLite treats a negative LIMIT as "no limit".
        let limit = limit.map_or(-1_i64, i64::from);
        let rows = statement
            .query_map(params![document_id, limit, i64::from(offset)], |row| {
                segment_from_row(row)
            })
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    pub fn document_segment_count(&self, document_id: &str) -> io::Result<u32> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT COUNT(*) FROM segments WHERE document_id = ?1")
            .map_err(db_err)?;
        let count: i64 = statement
            .query_row([document_id], |row| row.get(0))
            .map_err(db_err)?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    /// One document's per-state segment counts, its open QA issue count,
    /// and its source word count — the file-rail progress numbers. State
    /// and QA are indexed aggregate queries; the word count streams the
    /// document's source texts once through [`source_word_count`] (the 口径
    /// lives on `SegmentCounts.sourceWords`) because UAX #29 segmentation
    /// cannot run in SQL. Source text is immutable per row, so the sum is
    /// stable for a document's lifetime.
    pub fn document_segment_counts(&self, document_id: &str) -> io::Result<SegmentCounts> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT state, COUNT(*) FROM segments WHERE document_id = ?1 GROUP BY state",
            )
            .map_err(db_err)?;
        let rows = statement
            .query_map([document_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(db_err)?;
        let mut counts = SegmentCounts {
            total: 0,
            untranslated: 0,
            draft: 0,
            confirmed: 0,
            open_issues: 0,
            source_words: 0,
        };
        let untranslated = enum_text(&SegmentState::Untranslated)?;
        let draft = enum_text(&SegmentState::Draft)?;
        let confirmed = enum_text(&SegmentState::Confirmed)?;
        for row in rows {
            let (state, count) = row.map_err(db_err)?;
            let count = u32::try_from(count).unwrap_or(u32::MAX);
            counts.total = counts.total.saturating_add(count);
            if state == untranslated {
                counts.untranslated = count;
            } else if state == draft {
                counts.draft = count;
            } else if state == confirmed {
                counts.confirmed = count;
            }
        }
        let mut open_statement = self
            .conn
            .prepare_cached(
                "SELECT COUNT(*) FROM qa_issues q
                 JOIN segments s ON s.id = q.segment_id
                 WHERE s.document_id = ?1 AND q.status = ?2",
            )
            .map_err(db_err)?;
        let open: i64 = open_statement
            .query_row(
                params![document_id, enum_text(&QaIssueStatus::Open)?],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        counts.open_issues = u32::try_from(open).unwrap_or(u32::MAX);
        let mut words_statement = self
            .conn
            .prepare_cached("SELECT source_text FROM segments WHERE document_id = ?1")
            .map_err(db_err)?;
        let mut rows = words_statement.query([document_id]).map_err(db_err)?;
        while let Some(row) = rows.next().map_err(db_err)? {
            let source_text: String = row.get(0).map_err(db_err)?;
            counts.source_words = counts
                .source_words
                .saturating_add(source_word_count(&source_text));
        }
        Ok(counts)
    }

    /// A document's segments plus their non-empty leading text, for export
    /// reassembly. Materializes one document transiently, never the table.
    pub fn document_segments_with_leading(
        &self,
        document_id: &str,
    ) -> io::Result<(Vec<Segment>, BTreeMap<String, String>)> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {SEGMENT_COLUMNS}, leading FROM segments WHERE document_id = ?1
                 ORDER BY ordinal, id"
            ))
            .map_err(db_err)?;
        let rows = statement
            .query_map([document_id], |row| {
                // `leading` sits right after the SEGMENT_COLUMNS list.
                Ok((segment_from_row(row)?, row.get::<_, String>(16)?))
            })
            .map_err(db_err)?;
        let mut segments = Vec::new();
        let mut leading = BTreeMap::new();
        for row in rows {
            let (segment, gap) = row.map_err(db_err)?;
            if !gap.is_empty() {
                leading.insert(segment.id.clone(), gap);
            }
            segments.push(segment);
        }
        Ok((segments, leading))
    }

    /// Untranslated segments of one document in grid order — the rows
    /// pretranslation and the agent planner work through.
    pub fn untranslated_document_segments(&self, document_id: &str) -> io::Result<Vec<Segment>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {SEGMENT_COLUMNS} FROM segments
                 WHERE document_id = ?1 AND state = ?2 ORDER BY ordinal, id"
            ))
            .map_err(db_err)?;
        let rows = statement
            .query_map(
                params![document_id, enum_text(&SegmentState::Untranslated)?],
                segment_from_row,
            )
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    /// Untranslated segments across one project that share a source hash —
    /// the confirm-time propagation candidates. Walks the source-hash index
    /// joined against the project's documents instead of scanning segments.
    /// Locked rows are excluded: propagation never writes into them.
    pub fn untranslated_siblings(
        &self,
        project_id: &str,
        source_hash: &str,
        exclude_segment_id: &str,
    ) -> io::Result<Vec<Segment>> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT s.id, s.document_id, s.ordinal, s.structural_path, s.source_text,
                    s.target_text, s.state, s.revision, s.source_hash, s.context_hash,
                    s.updated_at_ms, s.origin_kind, s.origin_score, s.origin_model,
                    s.origin_edited, s.locked
                 FROM segments s
                 JOIN documents d ON d.id = s.document_id
                 WHERE s.source_hash = ?1 AND d.project_id = ?2
                   AND s.state = ?3 AND s.id <> ?4 AND s.locked = 0
                 ORDER BY s.document_id, s.ordinal, s.id",
            )
            .map_err(db_err)?;
        let rows = statement
            .query_map(
                params![
                    source_hash,
                    project_id,
                    enum_text(&SegmentState::Untranslated)?,
                    exclude_segment_id
                ],
                segment_from_row,
            )
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    // ---- TM reads (point queries and pages over the memory indexes) ----

    /// One TM entry by id.
    pub fn tm_entry(&self, entry_id: &str) -> io::Result<Option<TmEntry>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {TM_ENTRY_COLUMNS} FROM tm_entries WHERE id = ?1"
            ))
            .map_err(db_err)?;
        statement
            .query_row([entry_id], tm_entry_from_row)
            .optional()
            .map_err(db_err)
    }

    /// Exact-match point query on the unique `(memory_id, source_hash)`
    /// index; replaces the in-memory exact map the engine used to carry.
    pub fn tm_entry_by_source(
        &self,
        memory_id: &str,
        source_hash: &str,
    ) -> io::Result<Option<TmEntry>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {TM_ENTRY_COLUMNS} FROM tm_entries
                 WHERE memory_id = ?1 AND source_hash = ?2"
            ))
            .map_err(db_err)?;
        statement
            .query_row([memory_id, source_hash], tm_entry_from_row)
            .optional()
            .map_err(db_err)
    }

    /// Entries in a memory that match the optional substring filter (see
    /// [`Store::tm_entries_page`]) — the honest pre-page total.
    pub fn tm_entry_count(&self, memory_id: &str, query: Option<&str>) -> io::Result<u32> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT COUNT(*) FROM tm_entries WHERE memory_id = ?1
                 AND (?2 IS NULL
                      OR source_text LIKE '%' || ?2 || '%' ESCAPE '\\'
                      OR target_text LIKE '%' || ?2 || '%' ESCAPE '\\')",
            )
            .map_err(db_err)?;
        let count: i64 = statement
            .query_row(params![memory_id, query.map(escape_like_pattern)], |row| {
                row.get(0)
            })
            .map_err(db_err)?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    /// One page of a memory, newest confirmation first, walking the
    /// `(memory_id, confirmed_at_ms DESC, id)` index. The optional query is
    /// a substring filter over source and target text, matched in SQL with
    /// `LIKE` (ASCII case-insensitive) so the filtered set is never
    /// materialized in RAM.
    pub fn tm_entries_page(
        &self,
        memory_id: &str,
        query: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> io::Result<Vec<TmEntry>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {TM_ENTRY_COLUMNS} FROM tm_entries WHERE memory_id = ?1
                 AND (?2 IS NULL
                      OR source_text LIKE '%' || ?2 || '%' ESCAPE '\\'
                      OR target_text LIKE '%' || ?2 || '%' ESCAPE '\\')
                 ORDER BY confirmed_at_ms DESC, id LIMIT ?3 OFFSET ?4"
            ))
            .map_err(db_err)?;
        let rows = statement
            .query_map(
                params![
                    memory_id,
                    query.map(escape_like_pattern),
                    i64::from(limit),
                    i64::from(offset)
                ],
                tm_entry_from_row,
            )
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    /// Every entry of one memory, oldest confirmation first — the export
    /// order. Materializes one memory transiently for the outgoing file.
    pub fn tm_entries_for_export(&self, memory_id: &str) -> io::Result<Vec<TmEntry>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {TM_ENTRY_COLUMNS} FROM tm_entries WHERE memory_id = ?1
                 ORDER BY confirmed_at_ms, id"
            ))
            .map_err(db_err)?;
        let rows = statement
            .query_map([memory_id], tm_entry_from_row)
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    /// Stream `(id, memory_id, source_text)` for every TM entry so the
    /// engine can rebuild its fuzzy recall index at open without keeping
    /// the rows themselves in memory.
    pub fn for_each_tm_index_seed(
        &self,
        mut visit: impl FnMut(&str, &str, &str),
    ) -> io::Result<()> {
        let mut statement = self
            .conn
            .prepare("SELECT id, memory_id, source_text FROM tm_entries")
            .map_err(db_err)?;
        let mut rows = statement.query([]).map_err(db_err)?;
        while let Some(row) = rows.next().map_err(db_err)? {
            let id: String = row.get(0).map_err(db_err)?;
            let memory_id: String = row.get(1).map_err(db_err)?;
            let source_text: String = row.get(2).map_err(db_err)?;
            visit(&id, &memory_id, &source_text);
        }
        Ok(())
    }

    // ---- Term reads (point queries and per-termbase windows) ----

    /// One term entry by id.
    pub fn term_entry(&self, entry_id: &str) -> io::Result<Option<TermEntry>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {TERM_ENTRY_COLUMNS} FROM term_entries WHERE id = ?1"
            ))
            .map_err(db_err)?;
        statement
            .query_row([entry_id], term_entry_from_row)
            .optional()
            .map_err(db_err)
    }

    /// One page of a termbase's entries in source-term order (then id),
    /// walking the `term_entries_by_termbase` index. `limit: None` returns
    /// everything from `offset` on.
    pub fn termbase_entries_page(
        &self,
        termbase_id: &str,
        offset: u32,
        limit: Option<u32>,
    ) -> io::Result<Vec<TermEntry>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {TERM_ENTRY_COLUMNS} FROM term_entries WHERE termbase_id = ?1
                 ORDER BY source_term, id LIMIT ?2 OFFSET ?3"
            ))
            .map_err(db_err)?;
        // SQLite treats a negative LIMIT as "no limit".
        let limit = limit.map_or(-1_i64, i64::from);
        let rows = statement
            .query_map(params![termbase_id, limit, i64::from(offset)], |row| {
                term_entry_from_row(row)
            })
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    pub fn termbase_entry_count(&self, termbase_id: &str) -> io::Result<u32> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT COUNT(*) FROM term_entries WHERE termbase_id = ?1")
            .map_err(db_err)?;
        let count: i64 = statement
            .query_row([termbase_id], |row| row.get(0))
            .map_err(db_err)?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    /// First entry id in a termbase whose `(id, source_term)` satisfies the
    /// predicate, walking ids in order. Backs the normalized-source dedupe
    /// checks (term.add, term.update, termbase.import) without materializing
    /// entry rows: normalization happens Rust-side, so SQL streams the two
    /// text columns and the caller decides.
    pub fn find_term_entry_id(
        &self,
        termbase_id: &str,
        mut matches: impl FnMut(&str, &str) -> bool,
    ) -> io::Result<Option<String>> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT id, source_term FROM term_entries WHERE termbase_id = ?1 ORDER BY id",
            )
            .map_err(db_err)?;
        let mut rows = statement.query([termbase_id]).map_err(db_err)?;
        while let Some(row) = rows.next().map_err(db_err)? {
            let id: String = row.get(0).map_err(db_err)?;
            let source_term: String = row.get(1).map_err(db_err)?;
            if matches(&id, &source_term) {
                return Ok(Some(id));
            }
        }
        Ok(None)
    }

    // ---- QA reads (per document through the segment join) ----

    /// One page of a document's issues in list order — open first, then
    /// waived, then resolved, each group oldest first, then id — joined
    /// through the document's segments so only this document's rows leave
    /// SQL. `limit: None` returns everything from `offset` on.
    pub fn document_qa_issues_page(
        &self,
        document_id: &str,
        offset: u32,
        limit: Option<u32>,
    ) -> io::Result<Vec<QaIssue>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {QA_ISSUE_COLUMNS} FROM qa_issues q
                 JOIN segments s ON s.id = q.segment_id
                 WHERE s.document_id = ?1
                 ORDER BY (q.status = ?2) * 2 + (q.status = ?3),
                   q.created_at_ms, q.id LIMIT ?4 OFFSET ?5"
            ))
            .map_err(db_err)?;
        let limit = limit.map_or(-1_i64, i64::from);
        let rows = statement
            .query_map(
                params![
                    document_id,
                    enum_text(&QaIssueStatus::Resolved)?,
                    enum_text(&QaIssueStatus::Waived)?,
                    limit,
                    i64::from(offset)
                ],
                qa_issue_from_row,
            )
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    /// Every issue of one segment, for the confirm-time segment-scoped
    /// reconcile. Walks the `qa_issues_by_segment` index; the caller sorts.
    pub fn segment_qa_issues(&self, segment_id: &str) -> io::Result<Vec<QaIssue>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {QA_ISSUE_COLUMNS} FROM qa_issues q WHERE q.segment_id = ?1"
            ))
            .map_err(db_err)?;
        let rows = statement
            .query_map([segment_id], qa_issue_from_row)
            .map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
    }

    /// One issue by id, for `qa.waive`. Point query on the primary key.
    pub fn qa_issue_by_id(&self, issue_id: &str) -> io::Result<Option<QaIssue>> {
        let mut statement = self
            .conn
            .prepare_cached(&format!(
                "SELECT {QA_ISSUE_COLUMNS} FROM qa_issues q WHERE q.id = ?1"
            ))
            .map_err(db_err)?;
        statement
            .query_row([issue_id], qa_issue_from_row)
            .optional()
            .map_err(db_err)
    }

    pub fn document_qa_issue_count(&self, document_id: &str) -> io::Result<u32> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT COUNT(*) FROM qa_issues q
                 JOIN segments s ON s.id = q.segment_id
                 WHERE s.document_id = ?1",
            )
            .map_err(db_err)?;
        let count: i64 = statement
            .query_row([document_id], |row| row.get(0))
            .map_err(db_err)?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }
}

const SEGMENT_COLUMNS: &str = "id, document_id, ordinal, structural_path, source_text, \
     target_text, state, revision, source_hash, context_hash, updated_at_ms, \
     origin_kind, origin_score, origin_model, origin_edited, locked";

const TM_ENTRY_COLUMNS: &str = "id, memory_id, source_text, target_text, source_hash, \
     origin_project_id, origin_document_id, origin_segment_id, confirmed_at_ms";

const TERM_ENTRY_COLUMNS: &str = "id, termbase_id, source_locale, source_term, \
     part_of_speech, definition, example, domain, status, revision, translations, \
     created_at_ms, updated_at_ms";

/// Qualified with the `q.` alias because every QA read joins through the
/// document's segments.
const QA_ISSUE_COLUMNS: &str = "q.id, q.segment_id, q.rule_id, q.severity, q.status, \
     q.message, q.fingerprint, q.evidence, q.params, q.waive_note, q.created_at_ms, \
     q.updated_at_ms";

fn segment_from_row(row: &Row) -> rusqlite::Result<Segment> {
    Ok(Segment {
        id: row.get(0)?,
        document_id: row.get(1)?,
        ordinal: row.get(2)?,
        structural_path: row.get(3)?,
        source_text: row.get(4)?,
        target_text: row.get(5)?,
        state: enum_column(row, 6)?,
        revision: revision_column(row, 7)?,
        source_hash: row.get(8)?,
        context_hash: row.get(9)?,
        updated_at_ms: row.get(10)?,
        origin: segment_origin_from_row(row, 11)?,
        locked: row.get(15)?,
    })
}

/// A NULL `origin_kind` means the row predates origins or the write that
/// produced the current target carried none — never a fabricated value.
fn segment_origin_from_row(row: &Row, first: usize) -> rusqlite::Result<Option<SegmentOrigin>> {
    let kind: Option<String> = row.get(first)?;
    let Some(kind) = kind else {
        return Ok(None);
    };
    let kind = serde_json::from_value(Value::String(kind)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(first, rusqlite::types::Type::Text, error.into())
    })?;
    Ok(Some(SegmentOrigin {
        kind,
        score: row.get(first + 1)?,
        model: row.get(first + 2)?,
        edited: row.get(first + 3)?,
    }))
}

fn tm_entry_from_row(row: &Row) -> rusqlite::Result<TmEntry> {
    Ok(TmEntry {
        id: row.get(0)?,
        memory_id: row.get(1)?,
        source_text: row.get(2)?,
        target_text: row.get(3)?,
        source_hash: row.get(4)?,
        origin_project_id: row.get(5)?,
        origin_document_id: row.get(6)?,
        origin_segment_id: row.get(7)?,
        confirmed_at_ms: row.get(8)?,
    })
}

fn term_entry_from_row(row: &Row) -> rusqlite::Result<TermEntry> {
    Ok(TermEntry {
        id: row.get(0)?,
        termbase_id: row.get(1)?,
        source_locale: row.get(2)?,
        source_term: row.get(3)?,
        part_of_speech: row.get(4)?,
        definition: row.get(5)?,
        example: row.get(6)?,
        domain: row.get(7)?,
        status: enum_column(row, 8)?,
        revision: revision_column(row, 9)?,
        translations: json_column(row, 10)?,
        created_at_ms: row.get(11)?,
        updated_at_ms: row.get(12)?,
    })
}

fn qa_issue_from_row(row: &Row) -> rusqlite::Result<QaIssue> {
    Ok(QaIssue {
        id: row.get(0)?,
        segment_id: row.get(1)?,
        rule_id: row.get(2)?,
        severity: enum_column(row, 3)?,
        status: enum_column(row, 4)?,
        message: row.get(5)?,
        fingerprint: row.get(6)?,
        evidence: json_column(row, 7)?,
        // NULL for rows written before V6: nothing to parameterize.
        params: optional_json_column(row, 8)?.unwrap_or_default(),
        waive_note: row.get(9)?,
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

fn db_err(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

/// Escape `LIKE` metacharacters in a user-supplied substring so the pattern
/// matches the literal text (paired with `ESCAPE '\'` in the queries above).
fn escape_like_pattern(needle: &str) -> String {
    needle
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn migrate(conn: &mut Connection) -> io::Result<()> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(db_err)?;
    let applied = usize::try_from(version).unwrap_or(0);
    if applied > MIGRATIONS.len() {
        return Err(io::Error::other(format!(
            "database schema version {applied} is newer than this engine supports ({}); refusing to open",
            MIGRATIONS.len()
        )));
    }
    for (index, script) in MIGRATIONS.iter().enumerate().skip(applied) {
        let tx = conn.transaction().map_err(db_err)?;
        tx.execute_batch(script).map_err(db_err)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
    }
    Ok(())
}

/// One-time import of a legacy whole-state `state.json`. Runs only when the
/// database has never been opened before (no meta flag yet).
fn import_legacy_state(conn: &mut Connection, data_dir: &Path) -> io::Result<()> {
    if meta_get(conn, META_LEGACY_IMPORT)?.is_some() {
        return Ok(());
    }
    let legacy_path = data_dir.join(LEGACY_STATE_FILE);
    if !legacy_path.is_file() {
        meta_set(conn, META_LEGACY_IMPORT, "fresh")?;
        return Ok(());
    }
    let bytes = std::fs::read(&legacy_path)?;
    let mut state: LegacyState = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    dedupe_legacy_tm_entries(&mut state);
    let delta = legacy_state_delta(&state);
    let tx = conn.transaction().map_err(db_err)?;
    write_delta(&tx, &delta)?;
    meta_set(&tx, META_LEGACY_IMPORT, "imported")?;
    tx.commit().map_err(db_err)?;
    // Keep the JSON as an inert backup; the database is the store now.
    // Best-effort: a failed rename only means the (ignored) file stays.
    let _ = std::fs::rename(&legacy_path, data_dir.join(LEGACY_BACKUP_FILE));
    Ok(())
}

/// The legacy linear-scan upsert could not enforce uniqueness, so a legacy
/// file may carry duplicate `(memory_id, source_hash)` pairs. Keep the
/// newest entry per pair so the unique index holds.
fn dedupe_legacy_tm_entries(state: &mut LegacyState) {
    let mut keep: BTreeMap<(String, String), String> = BTreeMap::new();
    for entry in state.tm_entries.values() {
        let key = (entry.memory_id.clone(), entry.source_hash.clone());
        match keep.get(&key) {
            Some(existing_id) => {
                let existing = &state.tm_entries[existing_id];
                if (entry.confirmed_at_ms, &entry.id) > (existing.confirmed_at_ms, &existing.id) {
                    keep.insert(key, entry.id.clone());
                }
            }
            None => {
                keep.insert(key, entry.id.clone());
            }
        }
    }
    let kept: BTreeSet<String> = keep.into_values().collect();
    state.tm_entries.retain(|id, _| kept.contains(id));
}

fn legacy_state_delta(state: &LegacyState) -> StateDelta {
    let mut delta = StateDelta {
        projects: state.projects.values().cloned().collect(),
        documents: state
            .documents
            .values()
            .map(|record| DocumentRecord {
                document: record.document.clone(),
                managed_source_path: record.managed_source_path.clone(),
            })
            .collect(),
        segments: state.segments.values().cloned().collect(),
        tm_entries: state.tm_entries.values().cloned().collect(),
        qa_issues: state.qa_issues.values().cloned().collect(),
        termbases: state.termbases.values().cloned().collect(),
        term_entries: state.term_entries.values().cloned().collect(),
        termbase_mounts: state.termbase_mounts.clone(),
        ..Default::default()
    };
    for record in state.documents.values() {
        for (segment_id, leading) in &record.segment_leading {
            delta
                .segment_leading
                .insert(segment_id.clone(), leading.clone());
        }
    }
    delta
}

fn write_delta(conn: &Connection, delta: &StateDelta) -> io::Result<()> {
    // Deletions first: a detach that re-compacts the remaining mount
    // priorities must remove the old row before upserting the survivors.
    for document_id in &delta.deleted_documents {
        // Cascade order matters: QA issues reference segments, so they go
        // before the segment rows their join runs through, and the document
        // row goes last. All inside the caller's single transaction.
        let mut statement = conn
            .prepare_cached(
                "DELETE FROM qa_issues WHERE segment_id IN
                   (SELECT id FROM segments WHERE document_id = ?1)",
            )
            .map_err(db_err)?;
        statement.execute(params![document_id]).map_err(db_err)?;
        delete_row(
            conn,
            "DELETE FROM segments WHERE document_id = ?1",
            document_id,
        )?;
        delete_row(conn, "DELETE FROM documents WHERE id = ?1", document_id)?;
    }
    for entry_id in &delta.deleted_tm_entries {
        delete_row(conn, "DELETE FROM tm_entries WHERE id = ?1", entry_id)?;
    }
    for entry_id in &delta.deleted_term_entries {
        delete_row(conn, "DELETE FROM term_entries WHERE id = ?1", entry_id)?;
    }
    for (project_id, termbase_id) in &delta.deleted_termbase_mounts {
        let mut statement = conn
            .prepare_cached(
                "DELETE FROM termbase_mounts WHERE project_id = ?1 AND termbase_id = ?2",
            )
            .map_err(db_err)?;
        statement
            .execute(params![project_id, termbase_id])
            .map_err(db_err)?;
    }
    for project in &delta.projects {
        upsert_project(conn, project)?;
    }
    for record in &delta.documents {
        upsert_document(conn, record)?;
    }
    for segment in &delta.segments {
        let leading = delta
            .segment_leading
            .get(&segment.id)
            .map(String::as_str)
            .unwrap_or_default();
        upsert_segment(conn, segment, leading)?;
    }
    for entry in &delta.tm_entries {
        upsert_tm_entry(conn, entry)?;
    }
    for issue in &delta.qa_issues {
        upsert_qa_issue(conn, issue)?;
    }
    for termbase in &delta.termbases {
        upsert_termbase(conn, termbase)?;
    }
    for entry in &delta.term_entries {
        upsert_term_entry(conn, entry)?;
    }
    for mount in &delta.termbase_mounts {
        upsert_termbase_mount(conn, mount)?;
    }
    Ok(())
}

fn delete_row(conn: &Connection, sql: &str, id: &str) -> io::Result<()> {
    let mut statement = conn.prepare_cached(sql).map_err(db_err)?;
    statement.execute(params![id]).map_err(db_err)?;
    Ok(())
}

fn upsert_project(conn: &Connection, project: &Project) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO projects (id, name, source_locale, target_locale, domain, lifecycle,
               revision, configuration, created_at_ms, updated_at_ms, archived_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               source_locale = excluded.source_locale,
               target_locale = excluded.target_locale,
               domain = excluded.domain,
               lifecycle = excluded.lifecycle,
               revision = excluded.revision,
               configuration = excluded.configuration,
               created_at_ms = excluded.created_at_ms,
               updated_at_ms = excluded.updated_at_ms,
               archived_at_ms = excluded.archived_at_ms",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            project.id,
            project.name,
            project.source_locale,
            project.target_locale,
            project.domain,
            enum_text(&project.lifecycle)?,
            revision_param(project.revision)?,
            json_text(&project.configuration)?,
            project.created_at_ms,
            project.updated_at_ms,
            project.archived_at_ms,
        ])
        .map_err(db_err)?;
    Ok(())
}

fn upsert_document(conn: &Connection, record: &DocumentRecord) -> io::Result<()> {
    let document = &record.document;
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO documents (id, project_id, name, relative_path, format, filter_id,
               source_sha256, current_version, status, revision, segment_count, degradation,
               imported_at_ms, updated_at_ms, managed_source_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
               project_id = excluded.project_id,
               name = excluded.name,
               relative_path = excluded.relative_path,
               format = excluded.format,
               filter_id = excluded.filter_id,
               source_sha256 = excluded.source_sha256,
               current_version = excluded.current_version,
               status = excluded.status,
               revision = excluded.revision,
               segment_count = excluded.segment_count,
               degradation = excluded.degradation,
               imported_at_ms = excluded.imported_at_ms,
               updated_at_ms = excluded.updated_at_ms,
               managed_source_path = excluded.managed_source_path",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            document.id,
            document.project_id,
            document.name,
            document.relative_path,
            document.format,
            document.filter_id,
            document.source_sha256,
            document.current_version,
            enum_text(&document.status)?,
            revision_param(document.revision)?,
            document.segment_count,
            json_text(&document.degradation)?,
            document.imported_at_ms,
            document.updated_at_ms,
            record.managed_source_path,
        ])
        .map_err(db_err)?;
    Ok(())
}

/// Source-side columns and `leading` are immutable once a segment exists;
/// updates only touch the translation-side columns (target, state,
/// revision, timestamps, origin — origin describes the target — and the
/// lock flag).
fn upsert_segment(conn: &Connection, segment: &Segment, leading: &str) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO segments (id, document_id, ordinal, structural_path, source_text,
               target_text, state, revision, source_hash, context_hash, updated_at_ms, leading,
               origin_kind, origin_score, origin_model, origin_edited, locked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET
               target_text = excluded.target_text,
               state = excluded.state,
               revision = excluded.revision,
               updated_at_ms = excluded.updated_at_ms,
               origin_kind = excluded.origin_kind,
               origin_score = excluded.origin_score,
               origin_model = excluded.origin_model,
               origin_edited = excluded.origin_edited,
               locked = excluded.locked",
        )
        .map_err(db_err)?;
    let origin = segment.origin.as_ref();
    let origin_kind = origin.map(|origin| enum_text(&origin.kind)).transpose()?;
    statement
        .execute(params![
            segment.id,
            segment.document_id,
            segment.ordinal,
            segment.structural_path,
            segment.source_text,
            segment.target_text,
            enum_text(&segment.state)?,
            revision_param(segment.revision)?,
            segment.source_hash,
            segment.context_hash,
            segment.updated_at_ms,
            leading,
            origin_kind,
            origin.and_then(|origin| origin.score),
            origin.and_then(|origin| origin.model.as_deref()),
            origin.is_some_and(|origin| origin.edited),
            segment.locked,
        ])
        .map_err(db_err)?;
    Ok(())
}

/// `memory_id` is immutable per entry id. `source_text` / `source_hash`
/// normally are too, but tm.update may re-key an entry's source; the engine
/// pre-checks uniqueness, and the unique `(memory_id, source_hash)` index
/// still backs the invariant of at most one entry per normalized source in
/// a memory (a conflicting re-key fails the transaction).
fn upsert_tm_entry(conn: &Connection, entry: &TmEntry) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO tm_entries (id, memory_id, source_text, target_text, source_hash,
               origin_project_id, origin_document_id, origin_segment_id, confirmed_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               source_text = excluded.source_text,
               source_hash = excluded.source_hash,
               target_text = excluded.target_text,
               origin_project_id = excluded.origin_project_id,
               origin_document_id = excluded.origin_document_id,
               origin_segment_id = excluded.origin_segment_id,
               confirmed_at_ms = excluded.confirmed_at_ms",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            entry.id,
            entry.memory_id,
            entry.source_text,
            entry.target_text,
            entry.source_hash,
            entry.origin_project_id,
            entry.origin_document_id,
            entry.origin_segment_id,
            entry.confirmed_at_ms,
        ])
        .map_err(db_err)?;
    Ok(())
}

fn upsert_qa_issue(conn: &Connection, issue: &QaIssue) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO qa_issues (id, segment_id, rule_id, severity, status, message,
               fingerprint, evidence, params, waive_note, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               severity = excluded.severity,
               status = excluded.status,
               message = excluded.message,
               evidence = excluded.evidence,
               params = excluded.params,
               waive_note = excluded.waive_note,
               updated_at_ms = excluded.updated_at_ms",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            issue.id,
            issue.segment_id,
            issue.rule_id,
            enum_text(&issue.severity)?,
            enum_text(&issue.status)?,
            issue.message,
            issue.fingerprint,
            json_text(&issue.evidence)?,
            json_text(&issue.params)?,
            issue.waive_note,
            issue.created_at_ms,
            issue.updated_at_ms,
        ])
        .map_err(db_err)?;
    Ok(())
}

fn upsert_termbase(conn: &Connection, termbase: &Termbase) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO termbases (id, name, source_locale, domain, writable, revision,
               created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               source_locale = excluded.source_locale,
               domain = excluded.domain,
               writable = excluded.writable,
               revision = excluded.revision,
               created_at_ms = excluded.created_at_ms,
               updated_at_ms = excluded.updated_at_ms",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            termbase.id,
            termbase.name,
            termbase.source_locale,
            termbase.domain,
            termbase.writable,
            revision_param(termbase.revision)?,
            termbase.created_at_ms,
            termbase.updated_at_ms,
        ])
        .map_err(db_err)?;
    Ok(())
}

/// Translations stay embedded as JSON: the engine mutates a term entry and
/// its translations as one aggregate, so the row is the unit of write.
fn upsert_term_entry(conn: &Connection, entry: &TermEntry) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO term_entries (id, termbase_id, source_locale, source_term,
               part_of_speech, definition, example, domain, status, revision, translations,
               created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               source_term = excluded.source_term,
               part_of_speech = excluded.part_of_speech,
               definition = excluded.definition,
               example = excluded.example,
               domain = excluded.domain,
               status = excluded.status,
               revision = excluded.revision,
               translations = excluded.translations,
               updated_at_ms = excluded.updated_at_ms",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            entry.id,
            entry.termbase_id,
            entry.source_locale,
            entry.source_term,
            entry.part_of_speech,
            entry.definition,
            entry.example,
            entry.domain,
            enum_text(&entry.status)?,
            revision_param(entry.revision)?,
            json_text(&entry.translations)?,
            entry.created_at_ms,
            entry.updated_at_ms,
        ])
        .map_err(db_err)?;
    Ok(())
}

fn upsert_termbase_mount(conn: &Connection, mount: &TermbaseMount) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO termbase_mounts (project_id, termbase_id, priority, writable, enabled,
               revision, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(project_id, termbase_id) DO UPDATE SET
               priority = excluded.priority,
               writable = excluded.writable,
               enabled = excluded.enabled,
               revision = excluded.revision,
               updated_at_ms = excluded.updated_at_ms",
        )
        .map_err(db_err)?;
    statement
        .execute(params![
            mount.project_id,
            mount.termbase_id,
            mount.priority,
            mount.writable,
            mount.enabled,
            revision_param(mount.revision)?,
            mount.created_at_ms,
            mount.updated_at_ms,
        ])
        .map_err(db_err)?;
    Ok(())
}

/// Load the metadata working set. Deliberately never touches the
/// `segments`, `tm_entries`, `term_entries`, or `qa_issues` tables: those
/// are queried on demand (see module docs).
fn load_state(conn: &Connection) -> io::Result<EngineState> {
    let mut state = EngineState::default();

    let mut statement = conn
        .prepare(
            "SELECT id, name, source_locale, target_locale, domain, lifecycle, revision,
               configuration, created_at_ms, updated_at_ms, archived_at_ms
             FROM projects",
        )
        .map_err(db_err)?;
    let projects = statement
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                source_locale: row.get(2)?,
                target_locale: row.get(3)?,
                domain: row.get(4)?,
                lifecycle: enum_column(row, 5)?,
                revision: revision_column(row, 6)?,
                configuration: json_column(row, 7)?,
                created_at_ms: row.get(8)?,
                updated_at_ms: row.get(9)?,
                archived_at_ms: row.get(10)?,
            })
        })
        .map_err(db_err)?;
    for project in projects {
        let project = project.map_err(db_err)?;
        state.projects.insert(project.id.clone(), project);
    }

    let mut statement = conn
        .prepare(
            "SELECT id, project_id, name, relative_path, format, filter_id, source_sha256,
               current_version, status, revision, segment_count, degradation, imported_at_ms,
               updated_at_ms, managed_source_path
             FROM documents",
        )
        .map_err(db_err)?;
    let documents = statement
        .query_map([], |row| {
            Ok(DocumentRecord {
                document: Document {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    relative_path: row.get(3)?,
                    format: row.get(4)?,
                    filter_id: row.get(5)?,
                    source_sha256: row.get(6)?,
                    current_version: row.get(7)?,
                    status: enum_column(row, 8)?,
                    revision: revision_column(row, 9)?,
                    segment_count: row.get(10)?,
                    degradation: json_column(row, 11)?,
                    imported_at_ms: row.get(12)?,
                    updated_at_ms: row.get(13)?,
                },
                managed_source_path: row.get(14)?,
            })
        })
        .map_err(db_err)?;
    for record in documents {
        let record = record.map_err(db_err)?;
        state.documents.insert(record.document.id.clone(), record);
    }

    let mut statement = conn
        .prepare(
            "SELECT id, name, source_locale, domain, writable, revision, created_at_ms,
               updated_at_ms
             FROM termbases",
        )
        .map_err(db_err)?;
    let termbases = statement
        .query_map([], |row| {
            Ok(Termbase {
                id: row.get(0)?,
                name: row.get(1)?,
                source_locale: row.get(2)?,
                domain: row.get(3)?,
                writable: row.get(4)?,
                revision: revision_column(row, 5)?,
                created_at_ms: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        })
        .map_err(db_err)?;
    for termbase in termbases {
        let termbase = termbase.map_err(db_err)?;
        state.termbases.insert(termbase.id.clone(), termbase);
    }

    let mut statement = conn
        .prepare(
            "SELECT project_id, termbase_id, priority, writable, enabled, revision,
               created_at_ms, updated_at_ms
             FROM termbase_mounts ORDER BY project_id, priority, termbase_id",
        )
        .map_err(db_err)?;
    let mounts = statement
        .query_map([], |row| {
            Ok(TermbaseMount {
                project_id: row.get(0)?,
                termbase_id: row.get(1)?,
                priority: row.get(2)?,
                writable: row.get(3)?,
                enabled: row.get(4)?,
                revision: revision_column(row, 5)?,
                created_at_ms: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        })
        .map_err(db_err)?;
    for mount in mounts {
        state.termbase_mounts.push(mount.map_err(db_err)?);
    }

    Ok(state)
}

fn meta_get(conn: &Connection, key: &str) -> io::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(db_err)
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> io::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(drop)
    .map_err(db_err)
}

/// Serialize a unit enum through serde so column text always matches the
/// wire spelling (camelCase), keeping SQL rows greppable against the API.
fn enum_text<T: Serialize>(value: &T) -> io::Result<String> {
    match serde_json::to_value(value).map_err(io::Error::other)? {
        Value::String(text) => Ok(text),
        other => Err(io::Error::other(format!(
            "expected a string-serialized enum, got {other}"
        ))),
    }
}

fn json_text<T: Serialize>(value: &T) -> io::Result<String> {
    serde_json::to_string(value).map_err(io::Error::other)
}

/// Revisions are u64 in the domain but SQLite integers are i64; the range
/// loss is theoretical, the check keeps it honest.
fn revision_param(value: u64) -> io::Result<i64> {
    i64::try_from(value)
        .map_err(|_| io::Error::other(format!("revision {value} exceeds the storable range")))
}

fn revision_column(row: &Row, index: usize) -> rusqlite::Result<u64> {
    let value: i64 = row.get(index)?;
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            error.into(),
        )
    })
}

fn enum_column<T: DeserializeOwned>(row: &Row, index: usize) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_value(Value::String(text)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, error.into())
    })
}

fn json_column<T: DeserializeOwned>(row: &Row, index: usize) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, error.into())
    })
}

/// JSON column added by a later migration: NULL rows predate the column.
fn optional_json_column<T: DeserializeOwned>(
    row: &Row,
    index: usize,
) -> rusqlite::Result<Option<T>> {
    let text: Option<String> = row.get(index)?;
    text.map(|text| {
        serde_json::from_str(&text).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                error.into(),
            )
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use tl_asset::{TermStatus, TermTranslation};
    use tl_domain::{
        DegradationFinding, DegradationSeverity, DocumentStatus, NumberEvidence, ProjectLifecycle,
        QaIssueStatus, QaSeverity, SegmentState,
    };

    use super::*;

    fn sample_project(id: &str) -> Project {
        Project {
            id: id.to_string(),
            name: format!("Project {id}"),
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            domain: "general".to_string(),
            lifecycle: ProjectLifecycle::Active,
            revision: 1,
            configuration: Default::default(),
            created_at_ms: 1,
            updated_at_ms: 1,
            archived_at_ms: None,
        }
    }

    fn sample_segment(id: &str, document_id: &str, ordinal: u32) -> Segment {
        Segment {
            id: id.to_string(),
            document_id: document_id.to_string(),
            ordinal,
            structural_path: format!("p:{ordinal}"),
            source_text: format!("Source {ordinal}."),
            target_text: String::new(),
            state: SegmentState::Untranslated,
            revision: 1,
            source_hash: format!("hash-{id}"),
            context_hash: format!("context-{id}"),
            updated_at_ms: 1,
            origin: None,
            locked: false,
        }
    }

    fn sample_record(document_id: &str, project_id: &str, segment_count: u32) -> DocumentRecord {
        DocumentRecord {
            document: Document {
                id: document_id.to_string(),
                project_id: project_id.to_string(),
                name: "demo.docx".to_string(),
                relative_path: "/in/demo.docx".to_string(),
                format: "docx".to_string(),
                filter_id: "builtin.docx".to_string(),
                source_sha256: "abc123".to_string(),
                current_version: 1,
                status: DocumentStatus::Active,
                revision: 1,
                segment_count,
                degradation: vec![DegradationFinding {
                    code: "docx.dropped-shape".to_string(),
                    severity: DegradationSeverity::Warning,
                    message: "one drawing was not translatable".to_string(),
                    structural_path: Some("body/drawing:0".to_string()),
                }],
                imported_at_ms: 1,
                updated_at_ms: 1,
            },
            managed_source_path: "/managed/demo.docx".to_string(),
        }
    }

    fn sample_tm_entry(id: &str, memory_id: &str, source_hash: &str) -> TmEntry {
        TmEntry {
            id: id.to_string(),
            memory_id: memory_id.to_string(),
            source_text: "Source 0.".to_string(),
            target_text: "译文零。".to_string(),
            source_hash: source_hash.to_string(),
            origin_project_id: "p1".to_string(),
            origin_document_id: "d1".to_string(),
            origin_segment_id: "s1".to_string(),
            confirmed_at_ms: 7,
        }
    }

    /// One of everything the store holds, applied as row deltas. Metadata
    /// reloads into the working set byte-for-byte; the bulk tables answer
    /// through the per-document / per-memory read API instead of a RAM copy.
    #[test]
    fn roundtrips_every_entity_type() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, initial) = Store::open(directory.path()).expect("open");
        assert_eq!(initial, EngineState::default());

        let project = sample_project("p1");
        let first = sample_segment("s1", "d1", 0);
        let second = sample_segment("s2", "d1", 1);
        let record = sample_record("d1", "p1", 2);
        let leading = BTreeMap::from([("s2".to_string(), " ".to_string())]);
        let tm_entry = sample_tm_entry("tm1", "tm-p1", "hash-s1");
        let qa_issue = QaIssue {
            id: "qa1".to_string(),
            segment_id: "s1".to_string(),
            rule_id: "number-mismatch".to_string(),
            severity: QaSeverity::Error,
            status: QaIssueStatus::Open,
            message: "numbers differ".to_string(),
            fingerprint: "fp1".to_string(),
            evidence: NumberEvidence {
                source_numbers: vec!["30".to_string()],
                target_numbers: vec!["60".to_string()],
                ..Default::default()
            },
            params: BTreeMap::from([
                ("expected".to_string(), "30".to_string()),
                ("found".to_string(), "60".to_string()),
            ]),
            waive_note: None,
            created_at_ms: 5,
            updated_at_ms: 5,
        };
        let termbase = Termbase {
            id: "tb1".to_string(),
            name: "Glossary".to_string(),
            source_locale: "en-US".to_string(),
            domain: Some("legal".to_string()),
            writable: true,
            revision: 1,
            created_at_ms: 2,
            updated_at_ms: 2,
        };
        let term_entry = TermEntry {
            id: "te1".to_string(),
            termbase_id: "tb1".to_string(),
            source_locale: "en-US".to_string(),
            source_term: "agreement".to_string(),
            part_of_speech: Some("noun".to_string()),
            definition: None,
            example: None,
            domain: None,
            status: TermStatus::Active,
            revision: 1,
            translations: vec![TermTranslation {
                id: "tt1".to_string(),
                entry_id: "te1".to_string(),
                locale: "zh-CN".to_string(),
                term: "协议".to_string(),
                preferred: true,
                forbidden: false,
                created_at_ms: 3,
                updated_at_ms: 3,
            }],
            created_at_ms: 3,
            updated_at_ms: 3,
        };
        let mount = TermbaseMount {
            project_id: "p1".to_string(),
            termbase_id: "tb1".to_string(),
            priority: 0,
            writable: true,
            enabled: true,
            revision: 1,
            created_at_ms: 4,
            updated_at_ms: 4,
        };

        let delta = StateDelta {
            projects: vec![project.clone()],
            documents: vec![record.clone()],
            segments: vec![first.clone(), second.clone()],
            segment_leading: leading,
            tm_entries: vec![tm_entry.clone()],
            qa_issues: vec![qa_issue.clone()],
            termbases: vec![termbase.clone()],
            term_entries: vec![term_entry.clone()],
            termbase_mounts: vec![mount.clone()],
            ..Default::default()
        };
        store.apply(&delta).expect("apply");
        drop(store);

        let mut expected = EngineState::default();
        expected.projects.insert("p1".to_string(), project);
        expected.documents.insert("d1".to_string(), record);
        expected.termbases.insert("tb1".to_string(), termbase);
        expected.termbase_mounts.push(mount);

        let (reopened, reloaded) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reloaded, expected);

        // Row tables come back through queries, not through the working set.
        assert_eq!(
            reopened
                .document_segments_page("d1", 0, None)
                .expect("segments"),
            vec![first, second]
        );
        assert_eq!(reopened.document_segment_count("d1").expect("count"), 2);
        let (segments, gaps) = reopened
            .document_segments_with_leading("d1")
            .expect("segments with leading");
        assert_eq!(segments.len(), 2);
        assert_eq!(gaps.get("s2").map(String::as_str), Some(" "));
        assert_eq!(
            reopened.tm_entry("tm1").expect("tm entry"),
            Some(tm_entry.clone())
        );
        assert_eq!(
            reopened
                .tm_entry_by_source("tm-p1", "hash-s1")
                .expect("tm by source"),
            Some(tm_entry)
        );
        assert_eq!(
            reopened.term_entry("te1").expect("term entry"),
            Some(term_entry.clone())
        );
        assert_eq!(
            reopened
                .termbase_entries_page("tb1", 0, None)
                .expect("termbase entries"),
            vec![term_entry]
        );
        assert_eq!(reopened.termbase_entry_count("tb1").expect("count"), 1);
        assert_eq!(
            reopened
                .document_qa_issues_page("d1", 0, None)
                .expect("qa issues"),
            vec![qa_issue]
        );
        assert_eq!(reopened.document_qa_issue_count("d1").expect("count"), 1);
    }

    /// LIMIT/OFFSET windows come back in grid order for segments and in
    /// recency order for TM entries, with totals available separately.
    #[test]
    fn pages_bulk_tables_from_sql() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        let segments: Vec<Segment> = (0..5)
            .map(|ordinal| sample_segment(&format!("s{ordinal}"), "d1", ordinal))
            .collect();
        let mut tm_entries = Vec::new();
        for index in 0..4 {
            let mut entry = sample_tm_entry(&format!("tm{index}"), "m", &format!("hash-{index}"));
            entry.confirmed_at_ms = i64::from(index);
            tm_entries.push(entry);
        }
        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![sample_record("d1", "p1", 5)],
                segments,
                tm_entries,
                ..Default::default()
            })
            .expect("apply");

        let page = store
            .document_segments_page("d1", 1, Some(2))
            .expect("segment page");
        assert_eq!(
            page.iter()
                .map(|segment| segment.id.as_str())
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
        assert_eq!(store.document_segment_count("d1").expect("count"), 5);
        // Past the end: an empty page, not an error.
        assert!(
            store
                .document_segments_page("d1", 9, Some(2))
                .expect("tail page")
                .is_empty()
        );

        let newest = store.tm_entries_page("m", None, 0, 2).expect("tm page one");
        assert_eq!(
            newest
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tm3", "tm2"],
            "newest confirmation first"
        );
        let older = store.tm_entries_page("m", None, 2, 2).expect("tm page two");
        assert_eq!(
            older
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tm1", "tm0"]
        );
        assert_eq!(store.tm_entry_count("m", None).expect("tm count"), 4);
        assert_eq!(
            store
                .tm_entries_for_export("m")
                .expect("export order")
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tm0", "tm1", "tm2", "tm3"],
            "export walks oldest first"
        );
    }

    fn sample_term_entry(id: &str, termbase_id: &str, source_term: &str) -> TermEntry {
        TermEntry {
            id: id.to_string(),
            termbase_id: termbase_id.to_string(),
            source_locale: "en-US".to_string(),
            source_term: source_term.to_string(),
            part_of_speech: None,
            definition: None,
            example: None,
            domain: None,
            status: TermStatus::Active,
            revision: 1,
            translations: Vec::new(),
            created_at_ms: 1,
            updated_at_ms: 1,
        }
    }

    fn sample_qa_issue(
        id: &str,
        segment_id: &str,
        status: QaIssueStatus,
        created_at_ms: i64,
    ) -> QaIssue {
        QaIssue {
            id: id.to_string(),
            segment_id: segment_id.to_string(),
            rule_id: "qa.number-mismatch".to_string(),
            severity: QaSeverity::Error,
            status,
            message: format!("issue {id}"),
            fingerprint: format!("fp-{id}"),
            evidence: NumberEvidence::default(),
            params: BTreeMap::new(),
            waive_note: None,
            created_at_ms,
            updated_at_ms: created_at_ms,
        }
    }

    /// Term entries window per termbase in source-term order; QA issues
    /// window per document (open, then waived, then resolved, oldest first)
    /// through the segment join. Rows of other termbases / documents never
    /// leak in.
    #[test]
    fn pages_term_entries_and_qa_issues_from_sql() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        let terms = vec![
            sample_term_entry("te-b", "tb1", "bracket"),
            sample_term_entry("te-a", "tb1", "actuator"),
            sample_term_entry("te-c", "tb1", "coupling"),
            sample_term_entry("te-other", "tb2", "gasket"),
        ];
        let issues = vec![
            sample_qa_issue("qa-resolved", "s0", QaIssueStatus::Resolved, 1),
            sample_qa_issue("qa-late", "s1", QaIssueStatus::Open, 9),
            sample_qa_issue("qa-early", "s1", QaIssueStatus::Open, 2),
            sample_qa_issue("qa-waived", "s0", QaIssueStatus::Waived, 1),
            sample_qa_issue("qa-foreign", "elsewhere", QaIssueStatus::Open, 1),
        ];
        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![sample_record("d1", "p1", 2)],
                segments: vec![sample_segment("s0", "d1", 0), sample_segment("s1", "d1", 1)],
                term_entries: terms,
                qa_issues: issues,
                ..Default::default()
            })
            .expect("apply");

        let window = store
            .termbase_entries_page("tb1", 1, Some(1))
            .expect("term window");
        assert_eq!(
            window
                .iter()
                .map(|entry| entry.source_term.as_str())
                .collect::<Vec<_>>(),
            vec!["bracket"],
            "source-term order, offset applied"
        );
        assert_eq!(store.termbase_entry_count("tb1").expect("count"), 3);
        assert_eq!(
            store
                .termbase_entries_page("tb1", 9, Some(2))
                .expect("tail window")
                .len(),
            0,
            "past the end: an empty page, not an error"
        );
        assert_eq!(
            store
                .find_term_entry_id("tb1", |_, source_term| source_term == "coupling")
                .expect("find"),
            Some("te-c".to_string())
        );
        assert_eq!(
            store
                .find_term_entry_id("tb1", |_, source_term| source_term == "gasket")
                .expect("find in wrong termbase"),
            None
        );

        let ordered = store
            .document_qa_issues_page("d1", 0, None)
            .expect("qa order");
        assert_eq!(
            ordered
                .iter()
                .map(|issue| issue.id.as_str())
                .collect::<Vec<_>>(),
            vec!["qa-early", "qa-late", "qa-waived", "qa-resolved"],
            "open first, then waived, resolved last; foreign document excluded"
        );
        assert_eq!(
            store
                .document_qa_issues_page("d1", 1, Some(1))
                .expect("qa window")
                .iter()
                .map(|issue| issue.id.as_str())
                .collect::<Vec<_>>(),
            vec!["qa-late"]
        );
        assert_eq!(store.document_qa_issue_count("d1").expect("count"), 4);
        assert_eq!(
            store.qa_issue_by_id("qa-waived").expect("by id"),
            Some(sample_qa_issue("qa-waived", "s0", QaIssueStatus::Waived, 1))
        );
        assert_eq!(store.qa_issue_by_id("missing").expect("by id"), None);
    }

    /// One deleted document id cascades to its QA issues and segments in
    /// the same transaction, while sibling documents and the TM table stay
    /// untouched — and the deletion survives a reopen.
    #[test]
    fn deleted_document_cascades_to_segments_and_qa_issues() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![sample_record("d1", "p1", 2), sample_record("d2", "p1", 1)],
                segments: vec![
                    sample_segment("s1", "d1", 0),
                    sample_segment("s2", "d1", 1),
                    sample_segment("s3", "d2", 0),
                ],
                tm_entries: vec![sample_tm_entry("tm1", "tm-p1", "hash-s1")],
                qa_issues: vec![
                    sample_qa_issue("qa-doomed", "s1", QaIssueStatus::Open, 1),
                    sample_qa_issue("qa-kept", "s3", QaIssueStatus::Open, 2),
                ],
                ..Default::default()
            })
            .expect("seed");

        store
            .apply(&StateDelta {
                deleted_documents: vec!["d1".to_string()],
                ..Default::default()
            })
            .expect("remove document");
        drop(store);

        let (reopened, state) = Store::open(directory.path()).expect("reopen");
        assert!(!state.documents.contains_key("d1"), "document row is gone");
        assert!(state.documents.contains_key("d2"), "sibling document stays");
        assert_eq!(reopened.document_segment_count("d1").expect("count"), 0);
        assert_eq!(reopened.document_qa_issue_count("d1").expect("count"), 0);
        assert_eq!(reopened.segment("s1").expect("segment"), None);
        assert_eq!(reopened.document_segment_count("d2").expect("count"), 1);
        assert_eq!(reopened.document_qa_issue_count("d2").expect("count"), 1);
        assert_eq!(
            reopened.tm_entry_count("tm-p1", None).expect("tm count"),
            1,
            "TM entries outlive the document they came from"
        );
    }

    /// Updates rewrite the mutable columns only: segment leading text and
    /// source columns survive a target edit untouched.
    #[test]
    fn updates_preserve_immutable_columns() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        let mut segment = sample_segment("s1", "d1", 0);
        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![sample_record("d1", "p1", 1)],
                segments: vec![segment.clone()],
                segment_leading: BTreeMap::from([("s1".to_string(), "\t".to_string())]),
                tm_entries: vec![sample_tm_entry("tm1", "tm-p1", "hash-s1")],
                ..Default::default()
            })
            .expect("initial apply");

        // Later delta carries no leading map, as live edits do.
        segment.target_text = "编辑后的译文。".to_string();
        segment.state = SegmentState::Draft;
        segment.revision = 2;
        segment.updated_at_ms = 9;
        let mut tm_entry = sample_tm_entry("tm1", "tm-p1", "hash-s1");
        tm_entry.target_text = "更新的译文。".to_string();
        tm_entry.confirmed_at_ms = 9;
        store
            .apply(&StateDelta {
                segments: vec![segment.clone()],
                tm_entries: vec![tm_entry.clone()],
                ..Default::default()
            })
            .expect("update apply");
        drop(store);

        let (reopened, _) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reopened.segment("s1").expect("segment"), Some(segment));
        let (_, gaps) = reopened
            .document_segments_with_leading("d1")
            .expect("leading");
        assert_eq!(gaps.get("s1").map(String::as_str), Some("\t"));
        assert_eq!(reopened.tm_entry_count("tm-p1", None).expect("count"), 1);
        assert_eq!(reopened.tm_entry("tm1").expect("tm entry"), Some(tm_entry));
    }

    /// A legacy `state.json` is imported exactly once; afterwards the
    /// database rows win over any JSON file dropped into the directory.
    #[test]
    fn imports_legacy_state_json_once() {
        let directory = tempfile::tempdir().expect("tempdir");
        let mut legacy = LegacyState::default();
        legacy
            .projects
            .insert("p1".to_string(), sample_project("p1"));
        // A document with segments and leading text: the legacy record embeds
        // them; the import must land them as ordinal-ordered rows.
        let light = sample_record("d1", "p1", 2);
        legacy.documents.insert(
            "d1".to_string(),
            LegacyDocumentRecord {
                document: light.document.clone(),
                managed_source_path: light.managed_source_path.clone(),
                segment_ids: vec!["s1".to_string(), "s2".to_string()],
                segment_leading: BTreeMap::from([("s2".to_string(), " ".to_string())]),
            },
        );
        legacy
            .segments
            .insert("s1".to_string(), sample_segment("s1", "d1", 0));
        legacy
            .segments
            .insert("s2".to_string(), sample_segment("s2", "d1", 1));
        // Two entries for the same (memory, hash): the legacy linear upsert
        // could not prevent this; the newer confirmation must win.
        let mut older = sample_tm_entry("tm-old", "tm-p1", "hash-dup");
        older.confirmed_at_ms = 1;
        let mut newer = sample_tm_entry("tm-new", "tm-p1", "hash-dup");
        newer.confirmed_at_ms = 2;
        legacy.tm_entries.insert("tm-old".to_string(), older);
        legacy
            .tm_entries
            .insert("tm-new".to_string(), newer.clone());
        std::fs::write(
            directory.path().join(LEGACY_STATE_FILE),
            serde_json::to_vec(&legacy).expect("serialize legacy state"),
        )
        .expect("write legacy state");

        let (store, imported) = Store::open(directory.path()).expect("open imports legacy");
        assert_eq!(imported.projects.len(), 1);
        assert_eq!(imported.documents["d1"], light);
        let (segments, gaps) = store
            .document_segments_with_leading("d1")
            .expect("imported segments");
        assert_eq!(
            segments
                .iter()
                .map(|segment| segment.id.as_str())
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
        assert_eq!(gaps.get("s2").map(String::as_str), Some(" "));
        assert_eq!(store.tm_entry_count("tm-p1", None).expect("count"), 1);
        assert_eq!(
            store
                .tm_entry_by_source("tm-p1", "hash-dup")
                .expect("deduped entry"),
            Some(newer),
            "newest duplicate wins"
        );
        assert!(
            directory.path().join(LEGACY_BACKUP_FILE).is_file(),
            "legacy file becomes a backup"
        );
        assert!(!directory.path().join(LEGACY_STATE_FILE).exists());

        // A stale file appearing later must not overwrite database rows.
        let mut stale = LegacyState::default();
        stale
            .projects
            .insert("stale".to_string(), sample_project("stale"));
        std::fs::write(
            directory.path().join(LEGACY_STATE_FILE),
            serde_json::to_vec(&stale).expect("serialize stale state"),
        )
        .expect("write stale state");
        let (_, reloaded) = Store::open(directory.path()).expect("reopen");
        assert!(reloaded.projects.contains_key("p1"));
        assert!(!reloaded.projects.contains_key("stale"));
    }

    /// A directory that starts fresh is flagged too, so a legacy file can
    /// never sneak in after the database is in use.
    #[test]
    fn fresh_directories_never_import_late_legacy_files() {
        let directory = tempfile::tempdir().expect("tempdir");
        {
            let (mut store, _) = Store::open(directory.path()).expect("first open");
            store
                .apply(&StateDelta {
                    projects: vec![sample_project("live")],
                    ..Default::default()
                })
                .expect("apply");
        }
        let mut late = LegacyState::default();
        late.projects
            .insert("late".to_string(), sample_project("late"));
        std::fs::write(
            directory.path().join(LEGACY_STATE_FILE),
            serde_json::to_vec(&late).expect("serialize"),
        )
        .expect("write late legacy file");
        let (_, reloaded) = Store::open(directory.path()).expect("reopen");
        assert!(reloaded.projects.contains_key("live"));
        assert!(!reloaded.projects.contains_key("late"));
    }

    /// Crash simulation: snapshot the database files while a spilled,
    /// uncommitted transaction from another connection is in flight — the
    /// exact on-disk state a kill or power cut would leave. Recovery must
    /// keep every committed row and none of the uncommitted ones.
    #[test]
    fn mid_transaction_crash_snapshot_recovers_committed_rows_only() {
        let directory = tempfile::tempdir().expect("tempdir");
        let data_dir = directory.path();
        let (mut store, _) = Store::open(data_dir).expect("open");
        store
            .apply(&StateDelta {
                projects: vec![sample_project("committed")],
                ..Default::default()
            })
            .expect("apply committed project");

        // Second connection: tiny page cache so the uncommitted transaction
        // spills real frames into the WAL before any commit record exists.
        let raw = Connection::open(data_dir.join(DB_FILE_NAME)).expect("raw connection");
        raw.pragma_update(None, "cache_size", "-16")
            .expect("shrink cache");
        raw.execute_batch("BEGIN IMMEDIATE").expect("begin");
        let wal_path = data_dir.join(format!("{DB_FILE_NAME}-wal"));
        let wal_before = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
        let filler = "x".repeat(4096);
        for index in 0..256 {
            raw.execute(
                "INSERT INTO tm_entries (id, memory_id, source_text, target_text, source_hash,
                   origin_project_id, origin_document_id, origin_segment_id, confirmed_at_ms)
                 VALUES (?1, 'm', ?2, 't', ?3, 'p', '', '', 0)",
                params![format!("uncommitted-{index}"), filler, format!("h-{index}")],
            )
            .expect("uncommitted insert");
        }
        let wal_after = std::fs::metadata(&wal_path).expect("wal exists").len();
        assert!(
            wal_after > wal_before,
            "uncommitted frames spilled to the WAL ({wal_before} -> {wal_after})"
        );

        let snapshot = tempfile::tempdir().expect("snapshot dir");
        for suffix in ["", "-wal", "-shm"] {
            let source = data_dir.join(format!("{DB_FILE_NAME}{suffix}"));
            if source.exists() {
                std::fs::copy(
                    &source,
                    snapshot.path().join(format!("{DB_FILE_NAME}{suffix}")),
                )
                .expect("copy database file");
            }
        }
        drop(raw);
        drop(store);

        let (recovered_store, recovered) =
            Store::open(snapshot.path()).expect("open crash snapshot");
        assert!(recovered.projects.contains_key("committed"));
        let uncommitted = recovered_store.tm_entry_count("m", None).expect("tm count");
        assert_eq!(
            uncommitted, 0,
            "uncommitted rows must not survive, found {uncommitted}"
        );
    }

    /// The unique `(memory_id, source_hash)` index is a hard invariant, not
    /// just an in-memory convention.
    #[test]
    fn rejects_second_tm_entry_for_same_memory_and_hash() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        store
            .apply(&StateDelta {
                tm_entries: vec![sample_tm_entry("tm1", "tm-p1", "hash-same")],
                ..Default::default()
            })
            .expect("first entry");
        let error = store
            .apply(&StateDelta {
                tm_entries: vec![sample_tm_entry("tm2", "tm-p1", "hash-same")],
                ..Default::default()
            })
            .expect_err("duplicate pair must be rejected");
        assert!(error.to_string().to_lowercase().contains("unique"));
    }

    #[test]
    fn refuses_databases_from_a_newer_engine() {
        let directory = tempfile::tempdir().expect("tempdir");
        drop(Store::open(directory.path()).expect("create database"));
        let conn = Connection::open(directory.path().join(DB_FILE_NAME)).expect("raw connection");
        conn.pragma_update(None, "user_version", 99).expect("bump");
        drop(conn);
        let error = Store::open(directory.path()).expect_err("newer schema must refuse");
        assert!(error.to_string().contains("newer"));
    }

    /// A database written before migration 3 (no `waive_note` column yet)
    /// upgrades in place: legacy QA rows read back with no note, and the new
    /// column round-trips a waiver afterwards.
    #[test]
    fn migrates_pre_waiver_databases_and_reads_legacy_qa_rows() {
        let directory = tempfile::tempdir().expect("tempdir");
        let mut conn =
            Connection::open(directory.path().join(DB_FILE_NAME)).expect("raw connection");
        let tx = conn.transaction().expect("tx");
        tx.execute_batch(SCHEMA_V1).expect("v1");
        tx.execute_batch(SCHEMA_V2).expect("v2");
        tx.commit().expect("commit");
        conn.pragma_update(None, "user_version", 2)
            .expect("version");
        // A QA row exactly as a pre-waiver engine wrote it.
        conn.execute(
            "INSERT INTO qa_issues (id, segment_id, rule_id, severity, status, message,
               fingerprint, evidence, created_at_ms, updated_at_ms)
             VALUES ('qa1', 's1', 'qa.number-mismatch', 'error', 'open', 'numbers differ',
               'fp1', '{\"sourceNumbers\":[\"30\"],\"targetNumbers\":[\"60\"]}', 5, 5)",
            [],
        )
        .expect("legacy row");
        drop(conn);

        let (mut store, _) = Store::open(directory.path()).expect("open migrates to v3");
        let issue = store
            .qa_issue_by_id("qa1")
            .expect("read")
            .expect("legacy row survives");
        assert_eq!(issue.status, QaIssueStatus::Open);
        assert_eq!(issue.waive_note, None);

        let mut waived = issue;
        waived.status = QaIssueStatus::Waived;
        waived.waive_note = Some("accepted".to_string());
        waived.updated_at_ms = 6;
        store
            .apply(&StateDelta {
                qa_issues: vec![waived.clone()],
                ..Default::default()
            })
            .expect("apply waiver");
        assert_eq!(store.qa_issue_by_id("qa1").expect("read"), Some(waived));
    }

    /// A database written before migration 4 (no origin columns) upgrades
    /// in place: legacy segment rows read back origin-less — the migration
    /// never invents where old text came from — and a stamped write
    /// round-trips through the new columns afterwards.
    #[test]
    fn migrates_pre_origin_databases_without_backfilling_origins() {
        use tl_domain::{SegmentOrigin, SegmentOriginKind};

        let directory = tempfile::tempdir().expect("tempdir");
        let mut conn =
            Connection::open(directory.path().join(DB_FILE_NAME)).expect("raw connection");
        let tx = conn.transaction().expect("tx");
        tx.execute_batch(SCHEMA_V1).expect("v1");
        tx.execute_batch(SCHEMA_V2).expect("v2");
        tx.execute_batch(SCHEMA_V3).expect("v3");
        tx.commit().expect("commit");
        conn.pragma_update(None, "user_version", 3)
            .expect("version");
        // A segment row exactly as a pre-origin engine wrote it.
        conn.execute(
            "INSERT INTO segments (id, document_id, ordinal, structural_path, source_text,
               target_text, state, revision, source_hash, context_hash, updated_at_ms, leading)
             VALUES ('s1', 'd1', 0, 'p:0', 'Source 0.', '旧译文。', 'draft', 3, 'h1', 'c1', 5, '')",
            [],
        )
        .expect("legacy row");
        drop(conn);

        let (mut store, _) = Store::open(directory.path()).expect("open migrates to v4");
        let legacy = store
            .segment("s1")
            .expect("read")
            .expect("legacy row survives");
        assert_eq!(legacy.state, SegmentState::Draft);
        assert_eq!(legacy.origin, None, "no backfilled origin");

        let mut stamped = legacy;
        stamped.origin = Some(SegmentOrigin {
            kind: SegmentOriginKind::TmFuzzy,
            score: Some(85),
            model: None,
            edited: false,
        });
        stamped.revision = 4;
        store
            .apply(&StateDelta {
                segments: vec![stamped.clone()],
                ..Default::default()
            })
            .expect("apply stamp");
        drop(store);
        let (reopened, _) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reopened.segment("s1").expect("read"), Some(stamped));
    }

    /// A database written before migration 5 (no `locked` column) upgrades
    /// in place: legacy segment rows read back unlocked, a lock write
    /// round-trips through the new column, and locked rows drop out of the
    /// propagation-sibling query.
    #[test]
    fn migrates_pre_lock_databases_and_locked_rows_leave_sibling_query() {
        let directory = tempfile::tempdir().expect("tempdir");
        let mut conn =
            Connection::open(directory.path().join(DB_FILE_NAME)).expect("raw connection");
        let tx = conn.transaction().expect("tx");
        tx.execute_batch(SCHEMA_V1).expect("v1");
        tx.execute_batch(SCHEMA_V2).expect("v2");
        tx.execute_batch(SCHEMA_V3).expect("v3");
        tx.execute_batch(SCHEMA_V4).expect("v4");
        tx.commit().expect("commit");
        conn.pragma_update(None, "user_version", 4)
            .expect("version");
        // A segment row exactly as a pre-lock engine wrote it.
        conn.execute(
            "INSERT INTO segments (id, document_id, ordinal, structural_path, source_text,
               target_text, state, revision, source_hash, context_hash, updated_at_ms, leading,
               origin_edited)
             VALUES ('s1', 'd1', 0, 'p:0', 'Source 0.', '', 'untranslated', 3, 'h1', 'c1', 5, '',
               0)",
            [],
        )
        .expect("legacy row");
        drop(conn);

        let (mut store, _) = Store::open(directory.path()).expect("open migrates to v5");
        let legacy = store
            .segment("s1")
            .expect("read")
            .expect("legacy row survives");
        assert!(!legacy.locked, "legacy rows read back unlocked");

        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![sample_record("d1", "p1", 1)],
                ..Default::default()
            })
            .expect("apply metadata");
        assert_eq!(
            store
                .untranslated_siblings("p1", "h1", "elsewhere")
                .expect("siblings")
                .len(),
            1
        );

        let mut locked = legacy;
        locked.locked = true;
        locked.revision = 4;
        store
            .apply(&StateDelta {
                segments: vec![locked.clone()],
                ..Default::default()
            })
            .expect("apply lock");
        drop(store);
        let (reopened, _) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reopened.segment("s1").expect("read"), Some(locked));
        assert!(
            reopened
                .untranslated_siblings("p1", "h1", "elsewhere")
                .expect("siblings")
                .is_empty(),
            "locked rows never propagate"
        );
    }

    /// A database written before migration 6 (no `params` column) upgrades
    /// in place: legacy QA rows read back with empty params — nothing is
    /// invented for old findings — and a parameterized row round-trips
    /// through the new column afterwards.
    #[test]
    fn migrates_pre_params_databases_and_reads_legacy_qa_rows() {
        let directory = tempfile::tempdir().expect("tempdir");
        let mut conn =
            Connection::open(directory.path().join(DB_FILE_NAME)).expect("raw connection");
        let tx = conn.transaction().expect("tx");
        for script in [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5] {
            tx.execute_batch(script).expect("legacy schema");
        }
        tx.commit().expect("commit");
        conn.pragma_update(None, "user_version", 5)
            .expect("version");
        // A QA row exactly as a pre-params engine wrote it.
        conn.execute(
            "INSERT INTO qa_issues (id, segment_id, rule_id, severity, status, message,
               fingerprint, evidence, waive_note, created_at_ms, updated_at_ms)
             VALUES ('qa1', 's1', 'qa.length-ratio', 'warning', 'open', 'ratio off',
               'fp1', '{\"sourceNumbers\":[],\"targetNumbers\":[]}', NULL, 5, 5)",
            [],
        )
        .expect("legacy row");
        drop(conn);

        let (mut store, _) = Store::open(directory.path()).expect("open migrates to v6");
        let issue = store
            .qa_issue_by_id("qa1")
            .expect("read")
            .expect("legacy row survives");
        assert!(issue.params.is_empty(), "no invented params");

        let mut parameterized = issue;
        parameterized.params = BTreeMap::from([("ratio".to_string(), "420".to_string())]);
        parameterized.updated_at_ms = 6;
        store
            .apply(&StateDelta {
                qa_issues: vec![parameterized.clone()],
                ..Default::default()
            })
            .expect("apply params");
        drop(store);
        let (reopened, _) = Store::open(directory.path()).expect("reopen");
        assert_eq!(
            reopened.qa_issue_by_id("qa1").expect("read"),
            Some(parameterized)
        );
    }

    /// Every read path returns the stored origin, and the counts include
    /// the engine-computed source word count (UAX #29 / CJK-per-char 口径).
    #[test]
    fn origin_flows_through_reads_and_counts_include_source_words() {
        use tl_domain::{SegmentOrigin, SegmentOriginKind};

        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        let mut ai_row = sample_segment("s1", "d1", 0);
        ai_row.source_text = "The retention period is 30 days.".to_string(); // 6 words
        ai_row.target_text = "保留期为 30 天。".to_string();
        ai_row.state = SegmentState::Draft;
        ai_row.origin = Some(SegmentOrigin {
            kind: SegmentOriginKind::AiDraft,
            score: None,
            model: Some("test-model".to_string()),
            edited: true,
        });
        let mut plain_row = sample_segment("s2", "d1", 1);
        plain_row.source_text = "保留期为 60 天。".to_string(); // 6 words (5 hanzi + number)
        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![sample_record("d1", "p1", 2)],
                segments: vec![ai_row.clone(), plain_row.clone()],
                ..Default::default()
            })
            .expect("apply");

        let page = store.document_segments_page("d1", 0, None).expect("page");
        assert_eq!(page, vec![ai_row.clone(), plain_row.clone()]);
        let siblings = store
            .untranslated_siblings("p1", &plain_row.source_hash, "elsewhere")
            .expect("siblings");
        assert_eq!(siblings, vec![plain_row]);

        let counts = store.document_segment_counts("d1").expect("counts");
        assert_eq!(counts.total, 2);
        assert_eq!(counts.draft, 1);
        assert_eq!(counts.untranslated, 1);
        assert_eq!(counts.source_words, 12);
    }
}
