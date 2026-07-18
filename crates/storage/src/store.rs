use std::fs;
use std::num::TryFromIntError;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::types::Type;
use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use translunar_domain::{
    Document, ImportedUnit, NumberEvidence, Project, QaIssue, QaIssueStatus, QaSeverity, Segment,
    SegmentCounts, SegmentState, TmEntry, TranslationMemory, new_id, normalize_text,
    number_issue_fingerprint, number_mismatch, segment_hashes, state_for_target,
};

use crate::migrations::{configure_connection, migrate};
use crate::{Result, StorageError};

const NUMBER_RULE_ID: &str = "number-mismatch";
const NUMBER_RULE_MESSAGE: &str = "Source and target numbers do not match.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub sources: PathBuf,
    pub exports: PathBuf,
    pub temporary: PathBuf,
}

impl DataPaths {
    fn prepare(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let sources = root.join("sources");
        let exports = root.join("exports");
        let temporary = root.join("tmp");
        fs::create_dir_all(&sources)?;
        fs::create_dir_all(&exports)?;
        fs::create_dir_all(&temporary)?;
        Ok(Self {
            database: root.join("translunar.sqlite3"),
            root,
            sources,
            exports,
            temporary,
        })
    }

    pub fn managed_docx(&self, document_id: &str) -> PathBuf {
        self.sources.join(format!("{document_id}.docx"))
    }
}

#[derive(Debug, Clone)]
pub struct NewDocument {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub format: String,
    pub source_sha256: String,
    pub original_source_path: PathBuf,
    pub managed_source_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedDocument {
    pub document: Document,
    pub original_source_path: PathBuf,
    pub managed_source_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectAggregate {
    pub project: Project,
    pub documents: Vec<Document>,
    pub counts: SegmentCounts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Confirmation {
    pub segment: Segment,
    pub counts: SegmentCounts,
    pub tm_entry: TmEntry,
    pub qa_issues: Vec<QaIssue>,
}

pub struct Store {
    connection: Connection,
    paths: DataPaths,
}

impl Store {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        let paths = DataPaths::prepare(data_dir)?;
        let mut connection = Connection::open(&paths.database)?;
        configure_connection(&connection)?;
        migrate(&mut connection)?;
        Ok(Self { connection, paths })
    }

    pub fn paths(&self) -> &DataPaths {
        &self.paths
    }

    pub fn create_project(
        &mut self,
        name: &str,
        source_locale: &str,
        target_locale: &str,
        domain: &str,
    ) -> Result<Project> {
        require_nonempty("project name", name)?;
        require_nonempty("source locale", source_locale)?;
        require_nonempty("target locale", target_locale)?;

        let now = now_ms();
        let project = Project {
            id: new_id(),
            name: name.trim().to_string(),
            source_locale: source_locale.trim().to_string(),
            target_locale: target_locale.trim().to_string(),
            domain: domain.trim().to_string(),
            created_at_ms: now,
            updated_at_ms: now,
        };
        let memory = TranslationMemory {
            id: new_id(),
            project_id: project.id.clone(),
            name: format!("{} TM", project.name),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            writable: true,
        };

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO projects (
                id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                project.id,
                project.name,
                project.source_locale,
                project.target_locale,
                project.domain,
                project.created_at_ms,
                project.updated_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO translation_memories (
                id, project_id, name, source_locale, target_locale, writable
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                memory.id,
                memory.project_id,
                memory.name,
                memory.source_locale,
                memory.target_locale,
                memory.writable,
            ],
        )?;
        transaction.commit()?;
        Ok(project)
    }

    pub fn get_project(&self, project_id: &str) -> Result<ProjectAggregate> {
        let project = self
            .connection
            .query_row(
                "SELECT id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 FROM projects WHERE id = ?1",
                [project_id],
                row_to_project,
            )
            .optional()?
            .ok_or_else(|| not_found("project", project_id))?;

        let mut statement = self.connection.prepare(
            "SELECT id, project_id, name, format, source_sha256, segment_count, imported_at_ms
             FROM documents WHERE project_id = ?1 ORDER BY imported_at_ms, id",
        )?;
        let documents = statement
            .query_map([project_id], row_to_document)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let counts = counts_for_project(&self.connection, project_id)?;
        Ok(ProjectAggregate {
            project,
            documents,
            counts,
        })
    }

    pub fn insert_document(
        &mut self,
        input: &NewDocument,
        units: &[ImportedUnit],
    ) -> Result<Document> {
        require_nonempty("document id", &input.id)?;
        require_nonempty("project id", &input.project_id)?;
        require_nonempty("document name", &input.name)?;
        require_nonempty("document format", &input.format)?;
        require_nonempty("source digest", &input.source_sha256)?;
        ensure_unique_units(units)?;

        let imported_at_ms = now_ms();
        let document = Document {
            id: input.id.clone(),
            project_id: input.project_id.clone(),
            name: input.name.clone(),
            format: input.format.clone(),
            source_sha256: input.source_sha256.clone(),
            segment_count: to_u32(units.len())?,
            imported_at_ms,
        };

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "projects", "project", &input.project_id)?;
        transaction.execute(
            "INSERT INTO documents (
                id, project_id, name, format, source_sha256, original_source_path,
                managed_source_path, segment_count, imported_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                document.id,
                document.project_id,
                document.name,
                document.format,
                document.source_sha256,
                path_text(&input.original_source_path),
                path_text(&input.managed_source_path),
                i64::from(document.segment_count),
                document.imported_at_ms,
            ],
        )?;

        for (index, unit) in units.iter().enumerate() {
            let previous = index
                .checked_sub(1)
                .and_then(|position| units.get(position))
                .map(|item| item.source_text.as_str());
            let next = units.get(index + 1).map(|item| item.source_text.as_str());
            let (source_hash, context_hash) = segment_hashes(&unit.source_text, previous, next);
            transaction.execute(
                "INSERT INTO segments (
                    id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, '', 'untranslated', 0, ?6, ?7, ?8)",
                params![
                    new_id(),
                    document.id,
                    i64::from(unit.ordinal),
                    unit.structural_path,
                    unit.source_text,
                    source_hash,
                    context_hash,
                    imported_at_ms,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(document)
    }

    pub fn get_document(&self, document_id: &str) -> Result<ManagedDocument> {
        self.connection
            .query_row(
                "SELECT id, project_id, name, format, source_sha256, segment_count,
                        imported_at_ms, original_source_path, managed_source_path
                 FROM documents WHERE id = ?1",
                [document_id],
                row_to_managed_document,
            )
            .optional()?
            .ok_or_else(|| not_found("document", document_id))
    }

    pub fn list_segments(
        &self,
        document_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<Segment>, u32)> {
        ensure_exists(&self.connection, "documents", "document", document_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM segments WHERE document_id = ?1",
            [document_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE document_id = ?1
             ORDER BY ordinal LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![document_id, i64::from(limit), i64::from(offset)],
                row_to_segment,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn all_segments(&self, document_id: &str) -> Result<Vec<Segment>> {
        let (segments, total) = self.list_segments(document_id, 0, u32::MAX)?;
        debug_assert_eq!(segments.len(), total as usize);
        Ok(segments)
    }

    pub fn update_target(
        &mut self,
        segment_id: &str,
        target_text: &str,
        expected_revision: u64,
    ) -> Result<Segment> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_segment(&transaction, segment_id)?;
        ensure_revision(&current, expected_revision)?;

        if current.target_text == target_text {
            transaction.commit()?;
            return Ok(current);
        }

        let state = state_for_target(target_text);
        let updated_at_ms = now_ms();
        let next_revision = current
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("segment revision overflow".to_string()))?;
        let changed = transaction.execute(
            "UPDATE segments
             SET target_text = ?1, state = ?2, revision = ?3, updated_at_ms = ?4
             WHERE id = ?5 AND revision = ?6",
            params![
                target_text,
                segment_state_text(state),
                to_i64(next_revision)?,
                updated_at_ms,
                segment_id,
                to_i64(expected_revision)?,
            ],
        )?;
        if changed != 1 {
            let actual = find_segment(&transaction, segment_id)?.revision;
            return Err(StorageError::Conflict {
                segment_id: segment_id.to_string(),
                expected_revision,
                actual_revision: actual,
            });
        }
        let updated = find_segment(&transaction, segment_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn confirm_segment(
        &mut self,
        segment_id: &str,
        expected_revision: u64,
    ) -> Result<Confirmation> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut segment = find_segment(&transaction, segment_id)?;
        ensure_revision(&segment, expected_revision)?;
        if segment.target_text.trim().is_empty() {
            return Err(StorageError::InvalidState(
                "an empty target cannot be confirmed".to_string(),
            ));
        }

        let now = now_ms();
        let next_revision = segment
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("segment revision overflow".to_string()))?;
        transaction.execute(
            "UPDATE segments
             SET state = 'confirmed', revision = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                to_i64(next_revision)?,
                now,
                segment_id,
                to_i64(expected_revision)?,
            ],
        )?;
        segment = find_segment(&transaction, segment_id)?;

        let (project_id, memory_id) = transaction.query_row(
            "SELECT d.project_id, tm.id
             FROM documents d
             JOIN translation_memories tm ON tm.project_id = d.project_id AND tm.writable = 1
             WHERE d.id = ?1",
            [&segment.document_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        let tm_entry = upsert_tm_entry(&transaction, &segment, &project_id, &memory_id, now)?;
        let qa_issues = reconcile_number_qa(&transaction, &segment, now)?;
        let counts = counts_for_document(&transaction, &segment.document_id)?;
        transaction.commit()?;

        Ok(Confirmation {
            segment,
            counts,
            tm_entry,
            qa_issues,
        })
    }

    pub fn lookup_exact(&self, project_id: &str, source_text: &str) -> Result<Vec<TmEntry>> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let source_hash = translunar_domain::sha256_hex(normalize_text(source_text).as_bytes());
        let mut statement = self.connection.prepare(
            "SELECT e.id, e.memory_id, e.source_text, e.target_text, e.source_hash,
                    e.origin_project_id, e.origin_document_id, e.origin_segment_id,
                    e.confirmed_at_ms
             FROM tm_entries e
             JOIN translation_memories tm ON tm.id = e.memory_id
             WHERE tm.project_id = ?1 AND e.source_hash = ?2
             ORDER BY e.confirmed_at_ms DESC, e.id",
        )?;
        let normalized = normalize_text(source_text);
        let matches = statement
            .query_map(params![project_id, source_hash], row_to_tm_entry)?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|entry| normalize_text(&entry.source_text) == normalized)
            .collect();
        Ok(matches)
    }

    pub fn run_document_qa(&mut self, document_id: &str) -> Result<Vec<QaIssue>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "documents", "document", document_id)?;
        let segments = query_all_segments(&transaction, document_id)?;
        let now = now_ms();
        for segment in &segments {
            reconcile_number_qa(&transaction, segment, now)?;
        }
        let issues = query_qa_issues(&transaction, document_id, true)?;
        transaction.commit()?;
        Ok(issues)
    }

    pub fn list_qa(&self, document_id: &str, include_resolved: bool) -> Result<Vec<QaIssue>> {
        ensure_exists(&self.connection, "documents", "document", document_id)?;
        query_qa_issues(&self.connection, document_id, include_resolved)
    }

    #[cfg(test)]
    fn connection(&self) -> &Connection {
        &self.connection
    }
}

fn require_nonempty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(StorageError::InvalidState(format!(
            "{label} must not be empty"
        )))
    } else {
        Ok(())
    }
}

fn ensure_unique_units(units: &[ImportedUnit]) -> Result<()> {
    let mut ordinals = std::collections::HashSet::new();
    let mut paths = std::collections::HashSet::new();
    for unit in units {
        require_nonempty("structural path", &unit.structural_path)?;
        require_nonempty("source text", &unit.source_text)?;
        if !ordinals.insert(unit.ordinal) {
            return Err(StorageError::InvalidState(format!(
                "duplicate document unit ordinal {}",
                unit.ordinal
            )));
        }
        if !paths.insert(&unit.structural_path) {
            return Err(StorageError::InvalidState(format!(
                "duplicate document structural path {}",
                unit.structural_path
            )));
        }
    }
    Ok(())
}

fn ensure_exists(
    connection: &Connection,
    table: &'static str,
    entity: &'static str,
    id: &str,
) -> Result<()> {
    let sql = match table {
        "projects" => "SELECT 1 FROM projects WHERE id = ?1",
        "documents" => "SELECT 1 FROM documents WHERE id = ?1",
        _ => {
            return Err(StorageError::InvalidData(format!(
                "unsupported existence table {table}"
            )));
        }
    };
    let found = connection
        .query_row(sql, [id], |_| Ok(()))
        .optional()?
        .is_some();
    if found {
        Ok(())
    } else {
        Err(not_found(entity, id))
    }
}

fn not_found(entity: &'static str, id: &str) -> StorageError {
    StorageError::NotFound {
        entity,
        id: id.to_string(),
    }
}

fn ensure_revision(segment: &Segment, expected_revision: u64) -> Result<()> {
    if segment.revision == expected_revision {
        Ok(())
    } else {
        Err(StorageError::Conflict {
            segment_id: segment.id.clone(),
            expected_revision,
            actual_revision: segment.revision,
        })
    }
}

fn find_segment(connection: &Connection, segment_id: &str) -> Result<Segment> {
    connection
        .query_row(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE id = ?1",
            [segment_id],
            row_to_segment,
        )
        .optional()?
        .ok_or_else(|| not_found("segment", segment_id))
}

fn query_all_segments(connection: &Connection, document_id: &str) -> Result<Vec<Segment>> {
    let mut statement = connection.prepare(
        "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                state, revision, source_hash, context_hash, updated_at_ms
         FROM segments WHERE document_id = ?1 ORDER BY ordinal",
    )?;
    Ok(statement
        .query_map([document_id], row_to_segment)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn upsert_tm_entry(
    transaction: &Transaction<'_>,
    segment: &Segment,
    project_id: &str,
    memory_id: &str,
    confirmed_at_ms: i64,
) -> Result<TmEntry> {
    let existing_id = transaction
        .query_row(
            "SELECT id FROM tm_entries WHERE memory_id = ?1 AND origin_segment_id = ?2",
            params![memory_id, segment.id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let entry_id = existing_id.unwrap_or_else(new_id);
    transaction.execute(
        "INSERT INTO tm_entries (
            id, memory_id, source_text, target_text, source_hash, origin_project_id,
            origin_document_id, origin_segment_id, confirmed_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(memory_id, origin_segment_id) DO UPDATE SET
            source_text = excluded.source_text,
            target_text = excluded.target_text,
            source_hash = excluded.source_hash,
            confirmed_at_ms = excluded.confirmed_at_ms",
        params![
            entry_id,
            memory_id,
            segment.source_text,
            segment.target_text,
            segment.source_hash,
            project_id,
            segment.document_id,
            segment.id,
            confirmed_at_ms,
        ],
    )?;
    transaction
        .query_row(
            "SELECT id, memory_id, source_text, target_text, source_hash, origin_project_id,
                origin_document_id, origin_segment_id, confirmed_at_ms
         FROM tm_entries WHERE memory_id = ?1 AND origin_segment_id = ?2",
            params![memory_id, segment.id],
            row_to_tm_entry,
        )
        .map_err(Into::into)
}

fn reconcile_number_qa(
    transaction: &Transaction<'_>,
    segment: &Segment,
    now: i64,
) -> Result<Vec<QaIssue>> {
    let mismatch = if segment.target_text.trim().is_empty() {
        None
    } else {
        number_mismatch(&segment.source_text, &segment.target_text)
    };

    match mismatch {
        Some(evidence) => {
            let fingerprint = number_issue_fingerprint(&segment.id, &evidence);
            transaction.execute(
                "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
                 WHERE segment_id = ?2 AND rule_id = ?3 AND status = 'open'
                   AND fingerprint <> ?4",
                params![now, segment.id, NUMBER_RULE_ID, fingerprint],
            )?;
            let evidence_json = serde_json::to_string(&evidence)?;
            let existing_id = transaction
                .query_row(
                    "SELECT id FROM qa_issues
                     WHERE segment_id = ?1 AND rule_id = ?2 AND fingerprint = ?3",
                    params![segment.id, NUMBER_RULE_ID, fingerprint],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let issue_id = existing_id.unwrap_or_else(new_id);
            transaction.execute(
                "INSERT INTO qa_issues (
                    id, segment_id, rule_id, severity, status, message, fingerprint,
                    evidence_json, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, 'warning', 'open', ?4, ?5, ?6, ?7, ?7)
                 ON CONFLICT(segment_id, rule_id, fingerprint) DO UPDATE SET
                    severity = 'warning',
                    status = 'open',
                    message = excluded.message,
                    evidence_json = excluded.evidence_json,
                    updated_at_ms = excluded.updated_at_ms",
                params![
                    issue_id,
                    segment.id,
                    NUMBER_RULE_ID,
                    NUMBER_RULE_MESSAGE,
                    fingerprint,
                    evidence_json,
                    now,
                ],
            )?;
        }
        None => {
            transaction.execute(
                "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
                 WHERE segment_id = ?2 AND rule_id = ?3 AND status = 'open'",
                params![now, segment.id, NUMBER_RULE_ID],
            )?;
        }
    }

    query_segment_open_qa(transaction, &segment.id)
}

fn query_segment_open_qa(connection: &Connection, segment_id: &str) -> Result<Vec<QaIssue>> {
    let mut statement = connection.prepare(
        "SELECT id, segment_id, rule_id, severity, status, message, fingerprint,
                evidence_json, created_at_ms, updated_at_ms
         FROM qa_issues WHERE segment_id = ?1 AND status = 'open'
         ORDER BY created_at_ms, id",
    )?;
    Ok(statement
        .query_map([segment_id], row_to_qa_issue)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn query_qa_issues(
    connection: &Connection,
    document_id: &str,
    include_resolved: bool,
) -> Result<Vec<QaIssue>> {
    let mut statement = connection.prepare(
        "SELECT q.id, q.segment_id, q.rule_id, q.severity, q.status, q.message,
                q.fingerprint, q.evidence_json, q.created_at_ms, q.updated_at_ms
         FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         WHERE s.document_id = ?1 AND (?2 = 1 OR q.status = 'open')
         ORDER BY s.ordinal, q.created_at_ms, q.id",
    )?;
    Ok(statement
        .query_map(params![document_id, include_resolved], row_to_qa_issue)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn counts_for_project(connection: &Connection, project_id: &str) -> Result<SegmentCounts> {
    counts_for_scope(
        connection,
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN s.state = 'untranslated' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN s.state = 'draft' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN s.state = 'confirmed' THEN 1 ELSE 0 END), 0)
         FROM segments s JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1",
        "SELECT COUNT(*) FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1 AND q.status = 'open'",
        project_id,
    )
}

fn counts_for_document(connection: &Connection, document_id: &str) -> Result<SegmentCounts> {
    counts_for_scope(
        connection,
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN state = 'untranslated' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'draft' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END), 0)
         FROM segments WHERE document_id = ?1",
        "SELECT COUNT(*) FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         WHERE s.document_id = ?1 AND q.status = 'open'",
        document_id,
    )
}

fn counts_for_scope(
    connection: &Connection,
    segment_sql: &str,
    issue_sql: &str,
    id: &str,
) -> Result<SegmentCounts> {
    let values = connection.query_row(segment_sql, [id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let open_issues = connection.query_row(issue_sql, [id], |row| row.get::<_, i64>(0))?;
    Ok(SegmentCounts {
        total: to_u32(values.0)?,
        untranslated: to_u32(values.1)?,
        draft: to_u32(values.2)?,
        confirmed: to_u32(values.3)?,
        open_issues: to_u32(open_issues)?,
    })
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        source_locale: row.get(2)?,
        target_locale: row.get(3)?,
        domain: row.get(4)?,
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

fn row_to_document(row: &Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        format: row.get(3)?,
        source_sha256: row.get(4)?,
        segment_count: read_u32(row, 5)?,
        imported_at_ms: row.get(6)?,
    })
}

fn row_to_managed_document(row: &Row<'_>) -> rusqlite::Result<ManagedDocument> {
    Ok(ManagedDocument {
        document: Document {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            format: row.get(3)?,
            source_sha256: row.get(4)?,
            segment_count: read_u32(row, 5)?,
            imported_at_ms: row.get(6)?,
        },
        original_source_path: PathBuf::from(row.get::<_, String>(7)?),
        managed_source_path: PathBuf::from(row.get::<_, String>(8)?),
    })
}

fn row_to_segment(row: &Row<'_>) -> rusqlite::Result<Segment> {
    Ok(Segment {
        id: row.get(0)?,
        document_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        structural_path: row.get(3)?,
        source_text: row.get(4)?,
        target_text: row.get(5)?,
        state: parse_segment_state(row.get::<_, String>(6)?, 6)?,
        revision: read_u64(row, 7)?,
        source_hash: row.get(8)?,
        context_hash: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn row_to_tm_entry(row: &Row<'_>) -> rusqlite::Result<TmEntry> {
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

fn row_to_qa_issue(row: &Row<'_>) -> rusqlite::Result<QaIssue> {
    let evidence_json = row.get::<_, String>(7)?;
    let evidence = serde_json::from_str::<NumberEvidence>(&evidence_json)
        .map_err(|error| conversion_error(7, error))?;
    Ok(QaIssue {
        id: row.get(0)?,
        segment_id: row.get(1)?,
        rule_id: row.get(2)?,
        severity: parse_qa_severity(row.get::<_, String>(3)?, 3)?,
        status: parse_qa_status(row.get::<_, String>(4)?, 4)?,
        message: row.get(5)?,
        fingerprint: row.get(6)?,
        evidence,
        created_at_ms: row.get(8)?,
        updated_at_ms: row.get(9)?,
    })
}

fn segment_state_text(state: SegmentState) -> &'static str {
    match state {
        SegmentState::Untranslated => "untranslated",
        SegmentState::Draft => "draft",
        SegmentState::Confirmed => "confirmed",
    }
}

fn parse_segment_state(value: String, column: usize) -> rusqlite::Result<SegmentState> {
    match value.as_str() {
        "untranslated" => Ok(SegmentState::Untranslated),
        "draft" => Ok(SegmentState::Draft),
        "confirmed" => Ok(SegmentState::Confirmed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown segment state {value}")),
        )),
    }
}

fn parse_qa_severity(value: String, column: usize) -> rusqlite::Result<QaSeverity> {
    match value.as_str() {
        "error" => Ok(QaSeverity::Error),
        "warning" => Ok(QaSeverity::Warning),
        "info" => Ok(QaSeverity::Info),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA severity {value}")),
        )),
    }
}

fn parse_qa_status(value: String, column: usize) -> rusqlite::Result<QaIssueStatus> {
    match value.as_str() {
        "open" => Ok(QaIssueStatus::Open),
        "resolved" => Ok(QaIssueStatus::Resolved),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA status {value}")),
        )),
    }
}

fn conversion_error(
    column: usize,
    error: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(column, Type::Text, Box::new(error))
}

fn read_u32(row: &Row<'_>, column: usize) -> rusqlite::Result<u32> {
    let value = row.get::<_, i64>(column)?;
    u32::try_from(value).map_err(|error| conversion_error(column, error))
}

fn read_u64(row: &Row<'_>, column: usize) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(column)?;
    u64::try_from(value).map_err(|error| conversion_error(column, error))
}

fn to_u32(value: impl TryInto<u32, Error = TryFromIntError>) -> Result<u32> {
    value
        .try_into()
        .map_err(|_| StorageError::InvalidData("integer does not fit in u32".to_string()))
}

fn to_i64(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| {
        StorageError::InvalidData("integer does not fit in SQLite INTEGER".to_string())
    })
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use rusqlite::Connection;
    use tempfile::TempDir;

    use super::*;

    struct Fixture {
        _temp: TempDir,
        store: Store,
        project: Project,
        document: Document,
        segments: Vec<Segment>,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().expect("temporary directory");
            let mut store = Store::open(temp.path()).expect("open store");
            let project = store
                .create_project("Retention", "en-US", "zh-CN", "legal")
                .expect("create project");
            let document_id = new_id();
            let input = NewDocument {
                id: document_id.clone(),
                project_id: project.id.clone(),
                name: "retention.docx".to_string(),
                format: "docx".to_string(),
                source_sha256: "fixture-digest".to_string(),
                original_source_path: temp.path().join("retention.docx"),
                managed_source_path: store.paths().managed_docx(&document_id),
            };
            let units = vec![
                ImportedUnit {
                    ordinal: 0,
                    structural_path: "word/document.xml#p:0".to_string(),
                    source_text: "The retention period is 30 days.".to_string(),
                },
                ImportedUnit {
                    ordinal: 1,
                    structural_path: "word/document.xml#p:2".to_string(),
                    source_text: "This paragraph remains untranslated.".to_string(),
                },
            ];
            let document = store
                .insert_document(&input, &units)
                .expect("insert document");
            let segments = store.all_segments(&document.id).expect("list segments");
            Self {
                _temp: temp,
                store,
                project,
                document,
                segments,
            }
        }
    }

    #[test]
    fn configures_sqlite_and_recovers_projects() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let database_path;
        let project_id;
        {
            let mut store = Store::open(temp.path()).expect("open store");
            database_path = store.paths().database.clone();
            let journal_mode = store
                .connection()
                .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
                .expect("journal mode");
            let foreign_keys = store
                .connection()
                .pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
                .expect("foreign keys");
            assert_eq!(journal_mode, "wal");
            assert_eq!(foreign_keys, 1);
            project_id = store
                .create_project("Project", "en", "zh", "general")
                .expect("create project")
                .id;
        }

        assert!(database_path.exists());
        let reopened = Store::open(temp.path()).expect("reopen store");
        let aggregate = reopened.get_project(&project_id).expect("recover project");
        assert_eq!(aggregate.project.name, "Project");
        assert_eq!(aggregate.counts.total, 0);
    }

    #[test]
    fn persists_drafts_and_rejects_stale_writes() {
        let mut fixture = Fixture::new();
        let segment = fixture.segments.remove(0);
        let saved = fixture
            .store
            .update_target(&segment.id, "保留期为 60 天。", segment.revision)
            .expect("save draft");
        assert_eq!(saved.state, SegmentState::Draft);
        assert_eq!(saved.revision, 1);

        let error = fixture
            .store
            .update_target(&segment.id, "stale", segment.revision)
            .expect_err("reject stale write");
        assert!(matches!(
            error,
            StorageError::Conflict {
                expected_revision: 0,
                actual_revision: 1,
                ..
            }
        ));
        let current = fixture
            .store
            .all_segments(&fixture.document.id)
            .expect("reload segments")
            .remove(0);
        assert_eq!(current.target_text, "保留期为 60 天。");
    }

    #[test]
    fn confirmation_sinks_once_and_resolves_number_issue() {
        let mut fixture = Fixture::new();
        let segment = fixture.segments.remove(0);
        let draft = fixture
            .store
            .update_target(&segment.id, "保留期为 60 天。", 0)
            .expect("save mismatch");
        let first = fixture
            .store
            .confirm_segment(&segment.id, draft.revision)
            .expect("confirm mismatch");
        assert_eq!(first.segment.state, SegmentState::Confirmed);
        assert_eq!(first.qa_issues.len(), 1);
        assert_eq!(first.qa_issues[0].evidence.source_numbers, vec!["30"]);
        assert_eq!(first.qa_issues[0].evidence.target_numbers, vec!["60"]);
        let issue_id = first.qa_issues[0].id.clone();

        let second = fixture
            .store
            .confirm_segment(&segment.id, first.segment.revision)
            .expect("reconfirm");
        assert_eq!(first.tm_entry.id, second.tm_entry.id);
        let matches = fixture
            .store
            .lookup_exact(&fixture.project.id, &segment.source_text)
            .expect("lookup TM");
        assert_eq!(matches.len(), 1);

        let corrected = fixture
            .store
            .update_target(&segment.id, "保留期为 30 天。", second.segment.revision)
            .expect("correct target");
        fixture
            .store
            .confirm_segment(&segment.id, corrected.revision)
            .expect("confirm correction");
        let all_issues = fixture
            .store
            .list_qa(&fixture.document.id, true)
            .expect("list all issues");
        assert_eq!(all_issues.len(), 1);
        assert_eq!(all_issues[0].id, issue_id);
        assert_eq!(all_issues[0].status, QaIssueStatus::Resolved);
        assert!(
            fixture
                .store
                .list_qa(&fixture.document.id, false)
                .expect("list open issues")
                .is_empty()
        );
    }

    #[test]
    fn hashes_include_neighbor_context() {
        let fixture = Fixture::new();
        let hashes = fixture
            .segments
            .iter()
            .map(|segment| &segment.context_hash)
            .collect::<HashSet<_>>();
        assert_eq!(hashes.len(), fixture.segments.len());
    }

    #[test]
    fn failed_migration_leaves_user_version_unchanged() {
        let temp = tempfile::tempdir().expect("temporary directory");
        fs::create_dir_all(temp.path()).expect("create data directory");
        let database = temp.path().join("translunar.sqlite3");
        let connection = Connection::open(&database).expect("open database");
        connection
            .execute("CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT", [])
            .expect("create incompatible table");
        drop(connection);

        assert!(Store::open(temp.path()).is_err());
        let connection = Connection::open(database).expect("reopen database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read version");
        assert_eq!(version, 0);
    }
}
