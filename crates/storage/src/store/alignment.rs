use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_alignment_core::{
    AlignmentEvidence, AlignmentLinkStatus, AlignmentOrigin, AlignmentSide,
};

use super::{
    Store, conversion_error, not_found, read_json, read_optional_json, read_u32, read_u64, to_u32,
};
use crate::{Result, StorageError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentSessionStatus {
    Open,
    Applied,
    Discarded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSessionRecord {
    pub id: String,
    pub project_id: String,
    pub source_document_id: String,
    pub target_document_id: String,
    pub source_document_revision: u64,
    pub target_document_revision: u64,
    pub source_locale: String,
    pub target_locale: String,
    pub algorithm_version: String,
    pub status: AlignmentSessionStatus,
    pub revision: u64,
    pub terminal_result: Option<Value>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub closed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSessionSegmentRecord {
    pub session_id: String,
    pub side: AlignmentSide,
    pub segment_id: String,
    pub ordinal: u32,
    pub segment_revision: u64,
    pub source_hash: String,
    pub text_snapshot: String,
    pub number_signature: Vec<String>,
    pub tag_signature: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentLinkRecord {
    pub id: String,
    pub session_id: String,
    pub ordinal: u32,
    pub source_segment_ids: Vec<String>,
    pub target_segment_ids: Vec<String>,
    pub source_text: String,
    pub target_text: String,
    pub confidence_basis_points: u16,
    pub evidence: Vec<AlignmentEvidence>,
    pub origin: AlignmentOrigin,
    pub status: AlignmentLinkStatus,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceCorpusKind {
    MonolingualSource,
    MonolingualTarget,
    Bilingual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceCorpusSourceKind {
    File,
    Alignment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceCorpusStatus {
    Active,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCorpusRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub kind: ReferenceCorpusKind,
    pub source_locale: String,
    pub target_locale: String,
    pub source_kind: ReferenceCorpusSourceKind,
    pub managed_source_path: Option<String>,
    pub input_filter_id: Option<String>,
    pub input_format: Option<String>,
    pub input_sha256: Option<String>,
    pub source_document_id: Option<String>,
    pub target_document_id: Option<String>,
    pub alignment_session_id: Option<String>,
    pub status: ReferenceCorpusStatus,
    pub revision: u64,
    pub entry_count: u32,
    pub diagnostic_count: u32,
    pub diagnostics: Vec<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub removed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCorpusEntryRecord {
    pub id: String,
    pub corpus_id: String,
    pub ordinal: u32,
    pub source_text: String,
    pub target_text: String,
    pub normalized_source: String,
    pub normalized_target: String,
    pub structural_path: String,
    pub provenance: Value,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl Store {
    pub fn get_alignment_session(&self, session_id: &str) -> Result<AlignmentSessionRecord> {
        self.connection
            .query_row(
                "SELECT id, project_id, source_document_id, target_document_id,
                        source_document_revision, target_document_revision, source_locale,
                        target_locale, algorithm_version, status, revision,
                        terminal_result_json, created_at_ms, updated_at_ms, closed_at_ms
                 FROM alignment_sessions WHERE id = ?1",
                [session_id],
                row_to_alignment_session,
            )
            .optional()?
            .ok_or_else(|| not_found("alignment_session", session_id))
    }

    pub fn list_alignment_sessions(
        &self,
        project_id: &str,
        status: Option<AlignmentSessionStatus>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AlignmentSessionRecord>, u32)> {
        let status = status.map(alignment_session_status_text);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM alignment_sessions
             WHERE project_id = ?1 AND (?2 IS NULL OR status = ?2)",
            params![project_id, status],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, source_document_id, target_document_id,
                    source_document_revision, target_document_revision, source_locale,
                    target_locale, algorithm_version, status, revision,
                    terminal_result_json, created_at_ms, updated_at_ms, closed_at_ms
             FROM alignment_sessions
             WHERE project_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY updated_at_ms DESC, id
             LIMIT ?3 OFFSET ?4",
        )?;
        let records = statement
            .query_map(
                params![project_id, status, i64::from(limit), i64::from(offset)],
                row_to_alignment_session,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((records, to_u32(total)?))
    }

    pub fn list_alignment_session_segments(
        &self,
        session_id: &str,
        side: AlignmentSide,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AlignmentSessionSegmentRecord>, u32)> {
        let side = alignment_side_text(side);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM alignment_session_segments
             WHERE session_id = ?1 AND side = ?2",
            params![session_id, side],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT session_id, side, segment_id, ordinal, segment_revision, source_hash,
                    text_snapshot, number_signature_json, tag_signature_json
             FROM alignment_session_segments
             WHERE session_id = ?1 AND side = ?2
             ORDER BY ordinal, segment_id
             LIMIT ?3 OFFSET ?4",
        )?;
        let records = statement
            .query_map(
                params![session_id, side, i64::from(limit), i64::from(offset)],
                row_to_alignment_session_segment,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((records, to_u32(total)?))
    }

    pub fn get_alignment_link(&self, link_id: &str) -> Result<AlignmentLinkRecord> {
        self.connection
            .query_row(
                "SELECT id, session_id, ordinal, source_segment_ids_json,
                        target_segment_ids_json, source_text, target_text,
                        confidence_basis_points, evidence_json, origin, status, revision,
                        created_at_ms, updated_at_ms
                 FROM alignment_links WHERE id = ?1",
                [link_id],
                row_to_alignment_link,
            )
            .optional()?
            .ok_or_else(|| not_found("alignment_link", link_id))
    }

    pub fn list_alignment_links(
        &self,
        session_id: &str,
        status: Option<AlignmentLinkStatus>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AlignmentLinkRecord>, u32)> {
        let status = status.map(alignment_link_status_text);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM alignment_links
             WHERE session_id = ?1 AND (?2 IS NULL OR status = ?2)",
            params![session_id, status],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, session_id, ordinal, source_segment_ids_json,
                    target_segment_ids_json, source_text, target_text,
                    confidence_basis_points, evidence_json, origin, status, revision,
                    created_at_ms, updated_at_ms
             FROM alignment_links
             WHERE session_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY ordinal, id
             LIMIT ?3 OFFSET ?4",
        )?;
        let records = statement
            .query_map(
                params![session_id, status, i64::from(limit), i64::from(offset)],
                row_to_alignment_link,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((records, to_u32(total)?))
    }

    pub fn get_reference_corpus(&self, corpus_id: &str) -> Result<ReferenceCorpusRecord> {
        self.connection
            .query_row(
                "SELECT id, project_id, name, kind, source_locale, target_locale, source_kind,
                        managed_source_path, input_filter_id, input_format, input_sha256,
                        source_document_id, target_document_id, alignment_session_id, status,
                        revision, entry_count, diagnostic_count, diagnostics_json,
                        created_at_ms, updated_at_ms, removed_at_ms
                 FROM reference_corpora WHERE id = ?1",
                [corpus_id],
                row_to_reference_corpus,
            )
            .optional()?
            .ok_or_else(|| not_found("reference_corpus", corpus_id))
    }

    pub fn list_reference_corpora(
        &self,
        project_id: &str,
        status: Option<ReferenceCorpusStatus>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<ReferenceCorpusRecord>, u32)> {
        let status = status.map(reference_corpus_status_text);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM reference_corpora
             WHERE project_id = ?1 AND (?2 IS NULL OR status = ?2)",
            params![project_id, status],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, name, kind, source_locale, target_locale, source_kind,
                    managed_source_path, input_filter_id, input_format, input_sha256,
                    source_document_id, target_document_id, alignment_session_id, status,
                    revision, entry_count, diagnostic_count, diagnostics_json,
                    created_at_ms, updated_at_ms, removed_at_ms
             FROM reference_corpora
             WHERE project_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY updated_at_ms DESC, id
             LIMIT ?3 OFFSET ?4",
        )?;
        let records = statement
            .query_map(
                params![project_id, status, i64::from(limit), i64::from(offset)],
                row_to_reference_corpus,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((records, to_u32(total)?))
    }

    pub fn get_reference_corpus_entry(&self, entry_id: &str) -> Result<ReferenceCorpusEntryRecord> {
        self.connection
            .query_row(
                "SELECT id, corpus_id, ordinal, source_text, target_text, normalized_source,
                        normalized_target, structural_path, provenance_json,
                        created_at_ms, updated_at_ms
                 FROM reference_corpus_entries WHERE id = ?1",
                [entry_id],
                row_to_reference_corpus_entry,
            )
            .optional()?
            .ok_or_else(|| not_found("reference_corpus_entry", entry_id))
    }

    pub fn list_reference_corpus_entries(
        &self,
        corpus_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<ReferenceCorpusEntryRecord>, u32)> {
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM reference_corpus_entries WHERE corpus_id = ?1",
            [corpus_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, corpus_id, ordinal, source_text, target_text, normalized_source,
                    normalized_target, structural_path, provenance_json,
                    created_at_ms, updated_at_ms
             FROM reference_corpus_entries
             WHERE corpus_id = ?1
             ORDER BY ordinal, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let records = statement
            .query_map(
                params![corpus_id, i64::from(limit), i64::from(offset)],
                row_to_reference_corpus_entry,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((records, to_u32(total)?))
    }
}

fn row_to_alignment_session(row: &Row<'_>) -> rusqlite::Result<AlignmentSessionRecord> {
    Ok(AlignmentSessionRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        source_document_id: row.get(2)?,
        target_document_id: row.get(3)?,
        source_document_revision: read_u64(row, 4)?,
        target_document_revision: read_u64(row, 5)?,
        source_locale: row.get(6)?,
        target_locale: row.get(7)?,
        algorithm_version: row.get(8)?,
        status: parse_alignment_session_status(row.get::<_, String>(9)?, 9)?,
        revision: read_u64(row, 10)?,
        terminal_result: read_optional_json(row, 11)?,
        created_at_ms: row.get(12)?,
        updated_at_ms: row.get(13)?,
        closed_at_ms: row.get(14)?,
    })
}

fn row_to_alignment_session_segment(
    row: &Row<'_>,
) -> rusqlite::Result<AlignmentSessionSegmentRecord> {
    Ok(AlignmentSessionSegmentRecord {
        session_id: row.get(0)?,
        side: parse_alignment_side(row.get::<_, String>(1)?, 1)?,
        segment_id: row.get(2)?,
        ordinal: read_u32(row, 3)?,
        segment_revision: read_u64(row, 4)?,
        source_hash: row.get(5)?,
        text_snapshot: row.get(6)?,
        number_signature: read_json(row, 7)?,
        tag_signature: read_json(row, 8)?,
    })
}

fn row_to_alignment_link(row: &Row<'_>) -> rusqlite::Result<AlignmentLinkRecord> {
    Ok(AlignmentLinkRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        source_segment_ids: read_json(row, 3)?,
        target_segment_ids: read_json(row, 4)?,
        source_text: row.get(5)?,
        target_text: row.get(6)?,
        confidence_basis_points: read_u16(row, 7)?,
        evidence: read_json(row, 8)?,
        origin: parse_alignment_origin(row.get::<_, String>(9)?, 9)?,
        status: parse_alignment_link_status(row.get::<_, String>(10)?, 10)?,
        revision: read_u64(row, 11)?,
        created_at_ms: row.get(12)?,
        updated_at_ms: row.get(13)?,
    })
}

fn row_to_reference_corpus(row: &Row<'_>) -> rusqlite::Result<ReferenceCorpusRecord> {
    Ok(ReferenceCorpusRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        kind: parse_reference_corpus_kind(row.get::<_, String>(3)?, 3)?,
        source_locale: row.get(4)?,
        target_locale: row.get(5)?,
        source_kind: parse_reference_corpus_source_kind(row.get::<_, String>(6)?, 6)?,
        managed_source_path: row.get(7)?,
        input_filter_id: row.get(8)?,
        input_format: row.get(9)?,
        input_sha256: row.get(10)?,
        source_document_id: row.get(11)?,
        target_document_id: row.get(12)?,
        alignment_session_id: row.get(13)?,
        status: parse_reference_corpus_status(row.get::<_, String>(14)?, 14)?,
        revision: read_u64(row, 15)?,
        entry_count: read_u32(row, 16)?,
        diagnostic_count: read_u32(row, 17)?,
        diagnostics: read_json(row, 18)?,
        created_at_ms: row.get(19)?,
        updated_at_ms: row.get(20)?,
        removed_at_ms: row.get(21)?,
    })
}

fn row_to_reference_corpus_entry(row: &Row<'_>) -> rusqlite::Result<ReferenceCorpusEntryRecord> {
    Ok(ReferenceCorpusEntryRecord {
        id: row.get(0)?,
        corpus_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        source_text: row.get(3)?,
        target_text: row.get(4)?,
        normalized_source: row.get(5)?,
        normalized_target: row.get(6)?,
        structural_path: row.get(7)?,
        provenance: read_json(row, 8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn read_u16(row: &Row<'_>, column: usize) -> rusqlite::Result<u16> {
    let value = row.get::<_, i64>(column)?;
    u16::try_from(value).map_err(|error| conversion_error(column, error))
}

fn alignment_side_text(side: AlignmentSide) -> &'static str {
    match side {
        AlignmentSide::Source => "source",
        AlignmentSide::Target => "target",
    }
}

fn parse_alignment_side(value: String, column: usize) -> rusqlite::Result<AlignmentSide> {
    match value.as_str() {
        "source" => Ok(AlignmentSide::Source),
        "target" => Ok(AlignmentSide::Target),
        _ => invalid_enum(column, "alignment side", value),
    }
}

fn alignment_session_status_text(status: AlignmentSessionStatus) -> &'static str {
    match status {
        AlignmentSessionStatus::Open => "open",
        AlignmentSessionStatus::Applied => "applied",
        AlignmentSessionStatus::Discarded => "discarded",
    }
}

fn parse_alignment_session_status(
    value: String,
    column: usize,
) -> rusqlite::Result<AlignmentSessionStatus> {
    match value.as_str() {
        "open" => Ok(AlignmentSessionStatus::Open),
        "applied" => Ok(AlignmentSessionStatus::Applied),
        "discarded" => Ok(AlignmentSessionStatus::Discarded),
        _ => invalid_enum(column, "alignment session status", value),
    }
}

#[cfg(test)]
fn alignment_origin_text(origin: AlignmentOrigin) -> &'static str {
    match origin {
        AlignmentOrigin::Deterministic => "deterministic",
        AlignmentOrigin::Manual => "manual",
        AlignmentOrigin::Ai => "ai",
    }
}

fn parse_alignment_origin(value: String, column: usize) -> rusqlite::Result<AlignmentOrigin> {
    match value.as_str() {
        "deterministic" => Ok(AlignmentOrigin::Deterministic),
        "manual" => Ok(AlignmentOrigin::Manual),
        "ai" => Ok(AlignmentOrigin::Ai),
        _ => invalid_enum(column, "alignment origin", value),
    }
}

fn alignment_link_status_text(status: AlignmentLinkStatus) -> &'static str {
    match status {
        AlignmentLinkStatus::Proposed => "proposed",
        AlignmentLinkStatus::Confirmed => "confirmed",
        AlignmentLinkStatus::Rejected => "rejected",
    }
}

fn parse_alignment_link_status(
    value: String,
    column: usize,
) -> rusqlite::Result<AlignmentLinkStatus> {
    match value.as_str() {
        "proposed" => Ok(AlignmentLinkStatus::Proposed),
        "confirmed" => Ok(AlignmentLinkStatus::Confirmed),
        "rejected" => Ok(AlignmentLinkStatus::Rejected),
        _ => invalid_enum(column, "alignment link status", value),
    }
}

#[cfg(test)]
fn reference_corpus_kind_text(kind: ReferenceCorpusKind) -> &'static str {
    match kind {
        ReferenceCorpusKind::MonolingualSource => "monolingual_source",
        ReferenceCorpusKind::MonolingualTarget => "monolingual_target",
        ReferenceCorpusKind::Bilingual => "bilingual",
    }
}

fn parse_reference_corpus_kind(
    value: String,
    column: usize,
) -> rusqlite::Result<ReferenceCorpusKind> {
    match value.as_str() {
        "monolingual_source" => Ok(ReferenceCorpusKind::MonolingualSource),
        "monolingual_target" => Ok(ReferenceCorpusKind::MonolingualTarget),
        "bilingual" => Ok(ReferenceCorpusKind::Bilingual),
        _ => invalid_enum(column, "reference corpus kind", value),
    }
}

#[cfg(test)]
fn reference_corpus_source_kind_text(kind: ReferenceCorpusSourceKind) -> &'static str {
    match kind {
        ReferenceCorpusSourceKind::File => "file",
        ReferenceCorpusSourceKind::Alignment => "alignment",
    }
}

fn parse_reference_corpus_source_kind(
    value: String,
    column: usize,
) -> rusqlite::Result<ReferenceCorpusSourceKind> {
    match value.as_str() {
        "file" => Ok(ReferenceCorpusSourceKind::File),
        "alignment" => Ok(ReferenceCorpusSourceKind::Alignment),
        _ => invalid_enum(column, "reference corpus source kind", value),
    }
}

fn reference_corpus_status_text(status: ReferenceCorpusStatus) -> &'static str {
    match status {
        ReferenceCorpusStatus::Active => "active",
        ReferenceCorpusStatus::Removed => "removed",
    }
}

fn parse_reference_corpus_status(
    value: String,
    column: usize,
) -> rusqlite::Result<ReferenceCorpusStatus> {
    match value.as_str() {
        "active" => Ok(ReferenceCorpusStatus::Active),
        "removed" => Ok(ReferenceCorpusStatus::Removed),
        _ => invalid_enum(column, "reference corpus status", value),
    }
}

fn invalid_enum<T>(column: usize, label: &str, value: String) -> rusqlite::Result<T> {
    Err(conversion_error(
        column,
        StorageError::InvalidData(format!("unknown {label} {value}")),
    ))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn typed_alignment_and_corpus_queries_survive_reopen() {
        let temp = tempdir().expect("temporary storage directory");
        let store = Store::open(temp.path()).expect("open store");
        store
            .connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('query-p', 'Query project', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert query project");
        for document_id in ["query-source", "query-target"] {
            store
                .connection
                .execute(
                    "INSERT INTO documents (
                        id, project_id, name, format, source_sha256, original_source_path,
                        managed_source_path, segment_count, imported_at_ms
                     ) VALUES (?1, 'query-p', ?1, 'txt', 'digest', ?1, ?1, 1, 1)",
                    [document_id],
                )
                .expect("insert query document");
        }
        store
            .connection
            .execute(
                "INSERT INTO alignment_sessions (
                    id, project_id, source_document_id, target_document_id,
                    source_document_revision, target_document_revision, source_locale,
                    target_locale, algorithm_version, created_at_ms, updated_at_ms
                 ) VALUES ('query-session', 'query-p', 'query-source', 'query-target',
                           2, 3, 'en', 'zh', 'query-v1', 4, 4)",
                [],
            )
            .expect("insert query session");
        for (side, segment_id, text) in [
            ("source", "query-s", "Source 42."),
            ("target", "query-t", "Target 42."),
        ] {
            store
                .connection
                .execute(
                    "INSERT INTO alignment_session_segments (
                        session_id, side, segment_id, ordinal, segment_revision, source_hash,
                        text_snapshot, number_signature_json, tag_signature_json
                     ) VALUES ('query-session', ?1, ?2, 0, 1, 'hash', ?3,
                               '[\"42\"]', '[\"pair:1\"]')",
                    (side, segment_id, text),
                )
                .expect("insert query snapshot");
        }
        store
            .connection
            .execute(
                "INSERT INTO alignment_links (
                    id, session_id, ordinal, source_segment_ids_json, target_segment_ids_json,
                    source_text, target_text, confidence_basis_points, evidence_json, origin,
                    status, revision, created_at_ms, updated_at_ms
                 ) VALUES ('query-link', 'query-session', 0, '[\"query-s\"]',
                           '[\"query-t\"]', 'Source 42.', 'Target 42.', 9200, '[]',
                           'manual', 'confirmed', 1, 5, 5)",
                [],
            )
            .expect("insert query link");
        store
            .connection
            .execute(
                "INSERT INTO reference_corpora (
                    id, project_id, name, kind, source_locale, target_locale, source_kind,
                    source_document_id, target_document_id, alignment_session_id,
                    entry_count, diagnostics_json, created_at_ms, updated_at_ms
                 ) VALUES ('query-corpus', 'query-p', 'Query corpus', 'bilingual', 'en', 'zh',
                           'alignment', 'query-source', 'query-target', 'query-session', 1,
                           '[\"accepted\"]', 6, 6)",
                [],
            )
            .expect("insert query corpus");
        store
            .connection
            .execute(
                "INSERT INTO reference_corpus_entries (
                    id, corpus_id, ordinal, source_text, target_text, normalized_source,
                    normalized_target, structural_path, provenance_json,
                    created_at_ms, updated_at_ms
                 ) VALUES ('query-entry', 'query-corpus', 0, 'Source 42.', 'Target 42.',
                           'source 42.', 'target 42.', 'alignment:0',
                           '{\"linkId\":\"query-link\"}', 6, 6)",
                [],
            )
            .expect("insert query entry");
        drop(store);

        let store = Store::open(temp.path()).expect("reopen store");
        let session = store
            .get_alignment_session("query-session")
            .expect("read session");
        assert_eq!(session.status, AlignmentSessionStatus::Open);
        assert_eq!(session.source_document_revision, 2);
        let (snapshots, snapshot_total) = store
            .list_alignment_session_segments("query-session", AlignmentSide::Source, 0, 10)
            .expect("list snapshots");
        assert_eq!(snapshot_total, 1);
        assert_eq!(snapshots[0].number_signature, ["42"]);
        let (links, link_total) = store
            .list_alignment_links("query-session", Some(AlignmentLinkStatus::Confirmed), 0, 10)
            .expect("list links");
        assert_eq!(link_total, 1);
        assert_eq!(links[0].origin, AlignmentOrigin::Manual);
        let corpus = store
            .get_reference_corpus("query-corpus")
            .expect("read corpus");
        assert_eq!(corpus.kind, ReferenceCorpusKind::Bilingual);
        assert_eq!(corpus.diagnostics, ["accepted"]);
        let entry = store
            .get_reference_corpus_entry("query-entry")
            .expect("read corpus entry");
        assert_eq!(entry.provenance["linkId"], "query-link");
    }

    #[test]
    fn enum_storage_text_mappings_are_total() {
        assert_eq!(alignment_origin_text(AlignmentOrigin::Ai), "ai");
        assert_eq!(
            reference_corpus_kind_text(ReferenceCorpusKind::MonolingualTarget),
            "monolingual_target"
        );
        assert_eq!(
            reference_corpus_source_kind_text(ReferenceCorpusSourceKind::File),
            "file"
        );
    }
}
