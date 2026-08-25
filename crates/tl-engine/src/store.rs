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
//! Reads still come from the in-memory [`EngineState`] working set loaded
//! once at open, which keeps every RPC read path unchanged. The scale win in
//! this phase is on the write path (row-level transactional upserts instead
//! of rewriting one `state.json`) and on the TM upsert path (the engine keys
//! exact lookups by `(memory_id, source_hash)`, mirrored here by a unique
//! index). Remaining honest limit: opening a data directory still loads all
//! rows into memory; paged reads are a follow-up that this schema already
//! supports.
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
use tl_domain::{Document, Project, QaIssue, Segment, TmEntry};

pub const DB_FILE_NAME: &str = "engine.sqlite";
const LEGACY_STATE_FILE: &str = "state.json";
const LEGACY_BACKUP_FILE: &str = "state.json.imported-backup";
const META_LEGACY_IMPORT: &str = "legacy_state_json_import";

/// Ordered migration scripts; `PRAGMA user_version` records how many have
/// been applied. Append-only: never edit a shipped script, add a new one.
const MIGRATIONS: &[&str] = &[SCHEMA_V1];

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

/// The in-memory working set. Same shape as the legacy `state.json`
/// document, which is also how legacy files are imported.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    #[serde(default)]
    pub projects: BTreeMap<String, Project>,
    #[serde(default)]
    pub documents: BTreeMap<String, DocumentRecord>,
    #[serde(default)]
    pub segments: BTreeMap<String, Segment>,
    #[serde(default)]
    pub tm_entries: BTreeMap<String, TmEntry>,
    #[serde(default)]
    pub qa_issues: BTreeMap<String, QaIssue>,
    #[serde(default)]
    pub termbases: BTreeMap<String, Termbase>,
    #[serde(default)]
    pub term_entries: BTreeMap<String, TermEntry>,
    #[serde(default)]
    pub termbase_mounts: Vec<TermbaseMount>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub document: Document,
    /// Engine-managed copy of the imported source file; export re-reads it.
    pub managed_source_path: String,
    /// Segment ids in ordinal order.
    pub segment_ids: Vec<String>,
    /// Raw text that precedes each segment inside its unit. Kept so export can
    /// reassemble a paragraph from its sentence segments byte-for-byte.
    #[serde(default)]
    pub segment_leading: BTreeMap<String, String>,
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
}

fn db_err(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
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
    let mut state: EngineState = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    dedupe_legacy_tm_entries(&mut state);
    let delta = full_state_delta(&state);
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
fn dedupe_legacy_tm_entries(state: &mut EngineState) {
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

fn full_state_delta(state: &EngineState) -> StateDelta {
    let mut delta = StateDelta {
        projects: state.projects.values().cloned().collect(),
        documents: state.documents.values().cloned().collect(),
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
/// updates only touch the translation-side columns.
fn upsert_segment(conn: &Connection, segment: &Segment, leading: &str) -> io::Result<()> {
    let mut statement = conn
        .prepare_cached(
            "INSERT INTO segments (id, document_id, ordinal, structural_path, source_text,
               target_text, state, revision, source_hash, context_hash, updated_at_ms, leading)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               target_text = excluded.target_text,
               state = excluded.state,
               revision = excluded.revision,
               updated_at_ms = excluded.updated_at_ms",
        )
        .map_err(db_err)?;
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
               fingerprint, evidence, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               severity = excluded.severity,
               status = excluded.status,
               message = excluded.message,
               evidence = excluded.evidence,
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
                segment_ids: Vec::new(),
                segment_leading: BTreeMap::new(),
            })
        })
        .map_err(db_err)?;
    for record in documents {
        let record = record.map_err(db_err)?;
        state.documents.insert(record.document.id.clone(), record);
    }

    // Ordinal order rebuilds each document's segment id list.
    let mut statement = conn
        .prepare(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text, state,
               revision, source_hash, context_hash, updated_at_ms, leading
             FROM segments ORDER BY document_id, ordinal, id",
        )
        .map_err(db_err)?;
    let segments = statement
        .query_map([], |row| {
            Ok((
                Segment {
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
                },
                row.get::<_, String>(11)?,
            ))
        })
        .map_err(db_err)?;
    for item in segments {
        let (segment, leading) = item.map_err(db_err)?;
        if let Some(record) = state.documents.get_mut(&segment.document_id) {
            record.segment_ids.push(segment.id.clone());
            if !leading.is_empty() {
                record.segment_leading.insert(segment.id.clone(), leading);
            }
        }
        state.segments.insert(segment.id.clone(), segment);
    }

    let mut statement = conn
        .prepare(
            "SELECT id, memory_id, source_text, target_text, source_hash, origin_project_id,
               origin_document_id, origin_segment_id, confirmed_at_ms
             FROM tm_entries",
        )
        .map_err(db_err)?;
    let tm_entries = statement
        .query_map([], |row| {
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
        })
        .map_err(db_err)?;
    for entry in tm_entries {
        let entry = entry.map_err(db_err)?;
        state.tm_entries.insert(entry.id.clone(), entry);
    }

    let mut statement = conn
        .prepare(
            "SELECT id, segment_id, rule_id, severity, status, message, fingerprint, evidence,
               created_at_ms, updated_at_ms
             FROM qa_issues",
        )
        .map_err(db_err)?;
    let qa_issues = statement
        .query_map([], |row| {
            Ok(QaIssue {
                id: row.get(0)?,
                segment_id: row.get(1)?,
                rule_id: row.get(2)?,
                severity: enum_column(row, 3)?,
                status: enum_column(row, 4)?,
                message: row.get(5)?,
                fingerprint: row.get(6)?,
                evidence: json_column(row, 7)?,
                created_at_ms: row.get(8)?,
                updated_at_ms: row.get(9)?,
            })
        })
        .map_err(db_err)?;
    for issue in qa_issues {
        let issue = issue.map_err(db_err)?;
        state.qa_issues.insert(issue.id.clone(), issue);
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
            "SELECT id, termbase_id, source_locale, source_term, part_of_speech, definition,
               example, domain, status, revision, translations, created_at_ms, updated_at_ms
             FROM term_entries",
        )
        .map_err(db_err)?;
    let term_entries = statement
        .query_map([], |row| {
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
        })
        .map_err(db_err)?;
    for entry in term_entries {
        let entry = entry.map_err(db_err)?;
        state.term_entries.insert(entry.id.clone(), entry);
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
        }
    }

    fn sample_record(document_id: &str, project_id: &str, segments: &[Segment]) -> DocumentRecord {
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
                segment_count: segments.len() as u32,
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
            segment_ids: segments.iter().map(|segment| segment.id.clone()).collect(),
            segment_leading: BTreeMap::new(),
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

    /// One of everything `state.json` used to hold, applied as row deltas,
    /// reloaded byte-for-byte equal.
    #[test]
    fn roundtrips_every_entity_type() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, initial) = Store::open(directory.path()).expect("open");
        assert_eq!(initial, EngineState::default());

        let project = sample_project("p1");
        let first = sample_segment("s1", "d1", 0);
        let second = sample_segment("s2", "d1", 1);
        let mut record = sample_record("d1", "p1", &[first.clone(), second.clone()]);
        record
            .segment_leading
            .insert("s2".to_string(), " ".to_string());
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
            segment_leading: record.segment_leading.clone(),
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
        expected.segments.insert("s1".to_string(), first);
        expected.segments.insert("s2".to_string(), second);
        expected.tm_entries.insert("tm1".to_string(), tm_entry);
        expected.qa_issues.insert("qa1".to_string(), qa_issue);
        expected.termbases.insert("tb1".to_string(), termbase);
        expected.term_entries.insert("te1".to_string(), term_entry);
        expected.termbase_mounts.push(mount);

        let (_, reloaded) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reloaded, expected);
    }

    /// Updates rewrite the mutable columns only: segment leading text and
    /// source columns survive a target edit untouched.
    #[test]
    fn updates_preserve_immutable_columns() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (mut store, _) = Store::open(directory.path()).expect("open");
        let mut segment = sample_segment("s1", "d1", 0);
        let mut record = sample_record("d1", "p1", std::slice::from_ref(&segment));
        record
            .segment_leading
            .insert("s1".to_string(), "\t".to_string());
        store
            .apply(&StateDelta {
                projects: vec![sample_project("p1")],
                documents: vec![record.clone()],
                segments: vec![segment.clone()],
                segment_leading: record.segment_leading.clone(),
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

        let (_, reloaded) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reloaded.segments["s1"], segment);
        assert_eq!(
            reloaded.documents["d1"].segment_leading["s1"],
            "\t".to_string()
        );
        assert_eq!(reloaded.tm_entries.len(), 1);
        assert_eq!(reloaded.tm_entries["tm1"], tm_entry);
    }

    /// A legacy `state.json` is imported exactly once; afterwards the
    /// database rows win over any JSON file dropped into the directory.
    #[test]
    fn imports_legacy_state_json_once() {
        let directory = tempfile::tempdir().expect("tempdir");
        let mut legacy = EngineState::default();
        legacy
            .projects
            .insert("p1".to_string(), sample_project("p1"));
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

        let (_, imported) = Store::open(directory.path()).expect("open imports legacy");
        assert_eq!(imported.projects.len(), 1);
        assert_eq!(
            imported.tm_entries.keys().collect::<Vec<_>>(),
            vec!["tm-new"],
            "newest duplicate wins"
        );
        assert_eq!(imported.tm_entries["tm-new"], newer);
        assert!(
            directory.path().join(LEGACY_BACKUP_FILE).is_file(),
            "legacy file becomes a backup"
        );
        assert!(!directory.path().join(LEGACY_STATE_FILE).exists());

        // A stale file appearing later must not overwrite database rows.
        let mut stale = EngineState::default();
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
        let mut late = EngineState::default();
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

        let (_, recovered) = Store::open(snapshot.path()).expect("open crash snapshot");
        assert!(recovered.projects.contains_key("committed"));
        assert!(
            recovered.tm_entries.is_empty(),
            "uncommitted rows must not survive, found {}",
            recovered.tm_entries.len()
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
}
