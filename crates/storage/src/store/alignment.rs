use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use translunar_ai_core::{
    ALIGNMENT_REFINEMENT_ACTION, AiProviderKind, AiRunKind, AiRunStatus, AiUsage,
    AlignmentRefinementRunContext,
};
use translunar_alignment_core::{
    AlignmentCandidate, AlignmentError, AlignmentEvidence, AlignmentLinkStatus, AlignmentOptions,
    AlignmentOrigin, AlignmentPartitionLink, AlignmentPartitionSegment,
    AlignmentRefinementSuggestion, AlignmentResource, AlignmentSegment, AlignmentSide,
    HARD_MAX_REFINEMENT_LINKS, PartitionLimits, parse_alignment_refinement_response,
    validate_partition, validate_refinement_input,
};
use translunar_domain::{
    Document, DocumentStatus, Project, ProjectLifecycle, Segment, new_id, number_tokens,
};

use super::{
    Store, append_operation, conversion_error, ensure_entity_revision, find_document, find_project,
    next_revision, not_found, now_ms, read_json, read_optional_json, read_u32, read_u64,
    require_nonempty, row_to_segment, to_i64, to_u32,
};
use crate::{Result, StorageError};

use super::ai::complete_ai_run_tx;

const MAX_MANUAL_REPLACEMENT_LINKS: usize = 256;
const MAX_MANUAL_GROUP_SIZE: u32 = 64;

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

#[derive(Debug, Clone)]
pub struct NewAlignmentSession {
    pub project_id: String,
    pub source_document_id: String,
    pub target_document_id: String,
    pub expected_project_revision: u64,
    pub expected_source_document_revision: u64,
    pub expected_target_document_revision: u64,
    pub options: AlignmentOptions,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSessionCreateResult {
    pub session: AlignmentSessionRecord,
    pub work_units: u64,
    pub source_segment_count: u32,
    pub target_segment_count: u32,
    pub link_count: u32,
    pub operation_id: String,
}

#[derive(Debug, Clone)]
pub struct ExpectedAlignmentLinkRevision {
    pub link_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone)]
pub struct ManualAlignmentPartitionLink {
    pub source_segment_ids: Vec<String>,
    pub target_segment_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ReplaceAlignmentPartition {
    pub session_id: String,
    pub expected_session_revision: u64,
    pub links: Vec<ExpectedAlignmentLinkRevision>,
    pub replacement: Vec<ManualAlignmentPartitionLink>,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateAlignmentLinkStatus {
    pub session_id: String,
    pub link_id: String,
    pub expected_session_revision: u64,
    pub expected_link_revision: u64,
    pub status: AlignmentLinkStatus,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentMutationResult {
    pub session: AlignmentSessionRecord,
    pub links: Vec<AlignmentLinkRecord>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlignmentRefinementSelection {
    pub session: AlignmentSessionRecord,
    pub links: Vec<AlignmentLinkRecord>,
    pub source_segments: Vec<AlignmentSessionSegmentRecord>,
    pub target_segments: Vec<AlignmentSessionSegmentRecord>,
}

enum AlignmentReplacementMode<'a> {
    Manual,
    Ai {
        run_id: &'a str,
        profile_id: Option<&'a str>,
        response: &'a str,
        suggestions: &'a [AlignmentRefinementSuggestion],
        provider: AiProviderKind,
        usage: &'a AiUsage,
        elapsed_ms: u64,
    },
}

impl AlignmentReplacementMode<'_> {
    fn origin(&self) -> AlignmentOrigin {
        match self {
            Self::Manual => AlignmentOrigin::Manual,
            Self::Ai { .. } => AlignmentOrigin::Ai,
        }
    }

    fn operation_kind(&self) -> &'static str {
        match self {
            Self::Manual => "alignment.partition.replace",
            Self::Ai { .. } => "alignment.partition.refine",
        }
    }

    fn run_id(&self) -> Option<&str> {
        match self {
            Self::Manual => None,
            Self::Ai { run_id, .. } => Some(*run_id),
        }
    }

    fn profile_id(&self) -> Option<&str> {
        match self {
            Self::Manual => None,
            Self::Ai { profile_id, .. } => *profile_id,
        }
    }
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

    pub fn prepare_alignment_refinement(
        &self,
        context: &AlignmentRefinementRunContext,
    ) -> Result<AlignmentRefinementSelection> {
        load_alignment_refinement_selection(&self.connection, context)
    }

    pub fn complete_alignment_refinement_run(
        &mut self,
        run_id: &str,
        response: &str,
        provider: AiProviderKind,
        usage: &AiUsage,
        elapsed_ms: u64,
    ) -> Result<AlignmentMutationResult> {
        let run = self.get_ai_run(run_id)?;
        if run.kind != AiRunKind::Action || run.action != ALIGNMENT_REFINEMENT_ACTION {
            return Err(StorageError::InvalidState(
                "AI run is not an alignment refinement".to_string(),
            ));
        }
        if run.status != AiRunStatus::Running || run.cancellation_requested {
            return Err(StorageError::InvalidState(
                "alignment refinement run is not active".to_string(),
            ));
        }
        let context = run.request.alignment_refinement.clone().ok_or_else(|| {
            StorageError::InvalidState(
                "alignment refinement run is missing its context".to_string(),
            )
        })?;
        let selection = self.prepare_alignment_refinement(&context)?;
        let source = refinement_segments(&selection.source_segments);
        let target = refinement_segments(&selection.target_segments);
        let suggestions =
            parse_alignment_refinement_response(response.as_bytes(), &source, &target)?;
        let replacement = suggestions
            .iter()
            .map(|suggestion| ManualAlignmentPartitionLink {
                source_segment_ids: suggestion.source_segment_ids.clone(),
                target_segment_ids: suggestion.target_segment_ids.clone(),
            })
            .collect();
        let input = ReplaceAlignmentPartition {
            session_id: context.session_id,
            expected_session_revision: context.expected_session_revision,
            links: context
                .links
                .into_iter()
                .map(|link| ExpectedAlignmentLinkRevision {
                    link_id: link.link_id,
                    expected_revision: link.expected_revision,
                })
                .collect(),
            replacement,
            actor: context.actor,
            reason: context.reason,
            correlation_id: context.correlation_id,
        };
        self.replace_alignment_partition_inner(
            input,
            AlignmentReplacementMode::Ai {
                run_id,
                profile_id: run.profile_id.as_deref(),
                response,
                suggestions: &suggestions,
                provider,
                usage,
                elapsed_ms,
            },
        )
    }

    pub fn create_alignment_session(
        &mut self,
        input: NewAlignmentSession,
    ) -> Result<AlignmentSessionCreateResult> {
        require_nonempty("alignment project id", &input.project_id)?;
        require_nonempty("alignment source document id", &input.source_document_id)?;
        require_nonempty("alignment target document id", &input.target_document_id)?;
        require_nonempty("operation actor", &input.actor)?;
        require_nonempty("operation reason", &input.reason)?;

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let project = find_project(&transaction, &input.project_id)?;
        ensure_entity_revision(
            "project",
            &project.id,
            project.revision,
            input.expected_project_revision,
        )?;
        if project.lifecycle != ProjectLifecycle::Active {
            return Err(StorageError::InvalidState(
                "alignment requires an active project".to_string(),
            ));
        }
        let source_document = find_document(&transaction, &input.source_document_id)?;
        let target_document = find_document(&transaction, &input.target_document_id)?;
        validate_alignment_documents(
            &project,
            &source_document,
            &target_document,
            input.expected_source_document_revision,
            input.expected_target_document_revision,
        )?;

        let source_segments = load_alignment_segments(
            &transaction,
            &source_document,
            input.options.max_segments_per_side,
        )?;
        let target_segments = load_alignment_segments(
            &transaction,
            &target_document,
            input.options.max_segments_per_side,
        )?;
        let source_tags = load_protected_tag_signatures(&transaction, &source_document.id)?;
        let target_tags = load_protected_tag_signatures(&transaction, &target_document.id)?;
        let source_input = alignment_segments(&source_segments, &source_tags);
        let target_input = alignment_segments(&target_segments, &target_tags);
        let plan = translunar_alignment_core::align(&source_input, &target_input, &input.options)?;
        let session_id = new_id();
        let now = now_ms();
        transaction.execute(
            "INSERT INTO alignment_sessions (
                id, project_id, source_document_id, target_document_id,
                source_document_revision, target_document_revision, source_locale,
                target_locale, algorithm_version, status, revision, created_at_ms,
                updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', 0, ?10, ?10)",
            params![
                session_id,
                project.id,
                source_document.id,
                target_document.id,
                to_i64(input.expected_source_document_revision)?,
                to_i64(input.expected_target_document_revision)?,
                project.source_locale,
                project.target_locale,
                translunar_alignment_core::ALGORITHM_VERSION,
                now,
            ],
        )?;
        insert_alignment_snapshots(
            &transaction,
            &session_id,
            AlignmentSide::Source,
            &source_segments,
            &source_tags,
        )?;
        insert_alignment_snapshots(
            &transaction,
            &session_id,
            AlignmentSide::Target,
            &target_segments,
            &target_tags,
        )?;
        for (ordinal, candidate) in plan.candidates.iter().enumerate() {
            insert_alignment_candidate(&transaction, &session_id, ordinal, candidate, now)?;
        }
        let operation = append_operation(
            &transaction,
            &project.id,
            "alignment_session",
            &session_id,
            "alignment.session.create",
            Some(0),
            Some(0),
            &input.actor,
            input.correlation_id.as_deref(),
            None,
            Some(json!({
                "reason": input.reason,
                "sourceDocumentId": source_document.id,
                "targetDocumentId": target_document.id,
                "sourceSegmentCount": source_segments.len(),
                "targetSegmentCount": target_segments.len(),
                "linkCount": plan.candidates.len(),
                "workUnits": plan.work_units,
            })),
        )?;
        let session = find_alignment_session(&transaction, &session_id)?;
        transaction.commit()?;
        Ok(AlignmentSessionCreateResult {
            session,
            work_units: plan.work_units,
            source_segment_count: to_u32(source_segments.len())?,
            target_segment_count: to_u32(target_segments.len())?,
            link_count: to_u32(plan.candidates.len())?,
            operation_id: operation.id,
        })
    }

    pub fn replace_alignment_partition(
        &mut self,
        input: ReplaceAlignmentPartition,
    ) -> Result<AlignmentMutationResult> {
        self.replace_alignment_partition_inner(input, AlignmentReplacementMode::Manual)
    }

    fn replace_alignment_partition_inner(
        &mut self,
        input: ReplaceAlignmentPartition,
        mode: AlignmentReplacementMode<'_>,
    ) -> Result<AlignmentMutationResult> {
        require_nonempty("alignment session id", &input.session_id)?;
        require_nonempty("operation actor", &input.actor)?;
        require_nonempty("operation reason", &input.reason)?;
        if input.links.is_empty() || input.links.len() > MAX_MANUAL_REPLACEMENT_LINKS {
            return Err(StorageError::InvalidState(format!(
                "alignment replacement selects 1..{MAX_MANUAL_REPLACEMENT_LINKS} links"
            )));
        }
        if input.replacement.is_empty() || input.replacement.len() > MAX_MANUAL_REPLACEMENT_LINKS {
            return Err(StorageError::InvalidState(format!(
                "alignment replacement must contain 1..{MAX_MANUAL_REPLACEMENT_LINKS} links"
            )));
        }

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let session = find_alignment_session(&transaction, &input.session_id)?;
        ensure_entity_revision(
            "alignment_session",
            &session.id,
            session.revision,
            input.expected_session_revision,
        )?;
        ensure_alignment_session_open(&session)?;
        validate_alignment_session_documents(&transaction, &session)?;

        let current_links = load_all_alignment_links(&transaction, &session.id)?;
        let current_partition = partition_links(&current_links);
        let source_snapshots =
            load_all_alignment_snapshots(&transaction, &session.id, AlignmentSide::Source)?;
        let target_snapshots =
            load_all_alignment_snapshots(&transaction, &session.id, AlignmentSide::Target)?;
        validate_snapshot_partition(&source_snapshots, &target_snapshots, &current_partition)?;
        let selected_start = selected_link_range(&current_links, &input.links)?;
        let selected_end = selected_start + input.links.len();
        let selected = &current_links[selected_start..selected_end];
        if matches!(&mode, AlignmentReplacementMode::Ai { .. })
            && selected
                .iter()
                .any(|link| link.status != AlignmentLinkStatus::Proposed)
        {
            return Err(StorageError::InvalidState(
                "AI refinement accepts proposed links only".to_string(),
            ));
        }
        let source_ids = selected
            .iter()
            .flat_map(|link| link.source_segment_ids.iter().cloned())
            .collect::<BTreeSet<_>>();
        let target_ids = selected
            .iter()
            .flat_map(|link| link.target_segment_ids.iter().cloned())
            .collect::<BTreeSet<_>>();
        let source_partition = snapshots_for_ids(&source_snapshots, &source_ids);
        let target_partition = snapshots_for_ids(&target_snapshots, &target_ids);
        let replacement_partition = input
            .replacement
            .iter()
            .map(|link| AlignmentPartitionLink {
                source_segment_ids: link.source_segment_ids.clone(),
                target_segment_ids: link.target_segment_ids.clone(),
            })
            .collect::<Vec<_>>();
        validate_partition(
            &partition_segments(&source_partition),
            &partition_segments(&target_partition),
            &replacement_partition,
            &PartitionLimits {
                max_links: translunar_alignment_core::HARD_MAX_PARTITION_LINKS,
                max_group_size: MAX_MANUAL_GROUP_SIZE,
            },
        )?;

        let source_by_id = source_snapshots
            .iter()
            .map(|snapshot| (snapshot.segment_id.as_str(), snapshot))
            .collect::<BTreeMap<_, _>>();
        let target_by_id = target_snapshots
            .iter()
            .map(|snapshot| (snapshot.segment_id.as_str(), snapshot))
            .collect::<BTreeMap<_, _>>();
        let mut replacement_records = Vec::with_capacity(input.replacement.len());
        let replacement_at = now_ms();
        for (index, link) in input.replacement.iter().enumerate() {
            let source_text = snapshot_text_for_ids(&link.source_segment_ids, &source_by_id)?;
            let target_text = snapshot_text_for_ids(&link.target_segment_ids, &target_by_id)?;
            let (confidence_basis_points, evidence) = match &mode {
                AlignmentReplacementMode::Manual => {
                    let evidence = if link.source_segment_ids.is_empty() {
                        vec![AlignmentEvidence::Unaligned {
                            side: AlignmentSide::Target,
                            penalty_basis_points: 3_000,
                            summary: "target group remains unaligned".to_string(),
                        }]
                    } else if link.target_segment_ids.is_empty() {
                        vec![AlignmentEvidence::Unaligned {
                            side: AlignmentSide::Source,
                            penalty_basis_points: 3_000,
                            summary: "source group remains unaligned".to_string(),
                        }]
                    } else {
                        Vec::new()
                    };
                    let confidence = if link.source_segment_ids.is_empty()
                        || link.target_segment_ids.is_empty()
                    {
                        0
                    } else {
                        10_000
                    };
                    (confidence, evidence)
                }
                AlignmentReplacementMode::Ai { suggestions, .. } => {
                    let suggestion = suggestions.get(index).ok_or_else(|| {
                        StorageError::InvalidState(
                            "AI refinement suggestion count changed".to_string(),
                        )
                    })?;
                    if suggestion.source_segment_ids != link.source_segment_ids
                        || suggestion.target_segment_ids != link.target_segment_ids
                    {
                        return Err(StorageError::InvalidState(
                            "AI refinement suggestion membership changed".to_string(),
                        ));
                    }
                    (
                        suggestion.confidence_basis_points,
                        vec![AlignmentEvidence::AiRefinement {
                            summary: suggestion.evidence.clone(),
                        }],
                    )
                }
            };
            replacement_records.push(AlignmentLinkRecord {
                id: new_id(),
                session_id: session.id.clone(),
                ordinal: 0,
                source_segment_ids: link.source_segment_ids.clone(),
                target_segment_ids: link.target_segment_ids.clone(),
                source_text,
                target_text,
                confidence_basis_points,
                evidence,
                origin: mode.origin(),
                status: AlignmentLinkStatus::Proposed,
                revision: 0,
                created_at_ms: replacement_at,
                updated_at_ms: replacement_at,
            });
        }

        let mut final_links = current_links.clone();
        final_links.splice(selected_start..selected_end, replacement_records.clone());
        for (ordinal, link) in final_links.iter_mut().enumerate() {
            link.ordinal = to_u32(ordinal)?;
        }
        validate_snapshot_partition(
            &source_snapshots,
            &target_snapshots,
            &partition_links(&final_links),
        )?;

        let offset = i64::try_from(
            current_links
                .len()
                .saturating_add(final_links.len())
                .saturating_add(1),
        )
        .map_err(|_| StorageError::InvalidData("alignment ordinal offset overflow".to_string()))?;
        transaction.execute(
            "UPDATE alignment_links SET ordinal = ordinal + ?1 WHERE session_id = ?2",
            params![offset, session.id],
        )?;
        for selected_link in selected {
            let changed = transaction.execute(
                "DELETE FROM alignment_links WHERE id = ?1 AND session_id = ?2 AND revision = ?3",
                params![
                    selected_link.id,
                    session.id,
                    to_i64(
                        input
                            .links
                            .iter()
                            .find(|expected| expected.link_id == selected_link.id)
                            .map(|expected| expected.expected_revision)
                            .unwrap_or(selected_link.revision),
                    )?,
                ],
            )?;
            if changed != 1 {
                return Err(StorageError::EntityConflict {
                    entity: "alignment_link",
                    id: selected_link.id.clone(),
                    expected_revision: selected_link.revision,
                    actual_revision: selected_link.revision.saturating_add(1),
                });
            }
        }
        for link in final_links.iter().filter(|link| {
            current_links.iter().any(|current| current.id == link.id)
                && !selected.iter().any(|selected| selected.id == link.id)
        }) {
            transaction.execute(
                "UPDATE alignment_links SET ordinal = ?1
                 WHERE id = ?2 AND session_id = ?3",
                params![to_i64(u64::from(link.ordinal))?, link.id, session.id],
            )?;
        }
        for link in &replacement_records {
            let mut link = link.clone();
            link.ordinal = final_links
                .iter()
                .find(|candidate| candidate.id == link.id)
                .map(|candidate| candidate.ordinal)
                .unwrap_or_default();
            insert_alignment_link_record(&transaction, &link)?;
        }
        let result_revision = next_revision(session.revision)?;
        update_alignment_session_revision(&transaction, &session, result_revision, replacement_at)?;
        let operation = append_operation(
            &transaction,
            &session.project_id,
            "alignment_session",
            &session.id,
            mode.operation_kind(),
            Some(session.revision),
            Some(result_revision),
            &input.actor,
            input.correlation_id.as_deref(),
            Some(json!({
                "reason": input.reason,
                "linkIds": input.links.iter().map(|link| &link.link_id).collect::<Vec<_>>(),
            })),
            Some(json!({
                "replacementLinkIds": replacement_records.iter().map(|link| &link.id).collect::<Vec<_>>(),
                "sourceGroups": replacement_records.iter().map(|link| &link.source_segment_ids).collect::<Vec<_>>(),
                "targetGroups": replacement_records.iter().map(|link| &link.target_segment_ids).collect::<Vec<_>>(),
                "origin": alignment_origin_text(mode.origin()),
                "aiRunId": mode.run_id(),
                "profileId": mode.profile_id(),
            })),
        )?;
        if let AlignmentReplacementMode::Ai {
            run_id,
            response,
            provider,
            usage,
            elapsed_ms,
            ..
        } = &mode
        {
            complete_ai_run_tx(
                &transaction,
                run_id,
                response,
                *provider,
                usage,
                *elapsed_ms,
            )?;
        }
        let updated_session = find_alignment_session(&transaction, &session.id)?;
        let updated_links = load_all_alignment_links(&transaction, &session.id)?;
        transaction.commit()?;
        Ok(AlignmentMutationResult {
            session: updated_session,
            links: updated_links,
            operation_id: Some(operation.id),
        })
    }

    pub fn update_alignment_link_status(
        &mut self,
        input: UpdateAlignmentLinkStatus,
    ) -> Result<AlignmentMutationResult> {
        require_nonempty("alignment session id", &input.session_id)?;
        require_nonempty("alignment link id", &input.link_id)?;
        require_nonempty("operation actor", &input.actor)?;
        require_nonempty("operation reason", &input.reason)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let session = find_alignment_session(&transaction, &input.session_id)?;
        ensure_entity_revision(
            "alignment_session",
            &session.id,
            session.revision,
            input.expected_session_revision,
        )?;
        ensure_alignment_session_open(&session)?;
        validate_alignment_session_documents(&transaction, &session)?;
        let link = find_alignment_link(&transaction, &input.link_id)?;
        if link.session_id != session.id {
            return Err(StorageError::InvalidState(
                "alignment link does not belong to session".to_string(),
            ));
        }
        ensure_entity_revision(
            "alignment_link",
            &link.id,
            link.revision,
            input.expected_link_revision,
        )?;
        if link.status == input.status {
            let links = load_all_alignment_links(&transaction, &session.id)?;
            transaction.commit()?;
            return Ok(AlignmentMutationResult {
                session,
                links,
                operation_id: None,
            });
        }
        let now = now_ms();
        let link_revision = next_revision(link.revision)?;
        let changed = transaction.execute(
            "UPDATE alignment_links SET status = ?1, revision = ?2, updated_at_ms = ?3
             WHERE id = ?4 AND session_id = ?5 AND revision = ?6",
            params![
                alignment_link_status_text(input.status),
                to_i64(link_revision)?,
                now,
                link.id,
                session.id,
                to_i64(input.expected_link_revision)?,
            ],
        )?;
        if changed != 1 {
            return Err(StorageError::EntityConflict {
                entity: "alignment_link",
                id: input.link_id,
                expected_revision: input.expected_link_revision,
                actual_revision: link_revision,
            });
        }
        let result_revision = next_revision(session.revision)?;
        update_alignment_session_revision(&transaction, &session, result_revision, now)?;
        let operation = append_operation(
            &transaction,
            &session.project_id,
            "alignment_link",
            &link.id,
            "alignment.link.status",
            Some(session.revision),
            Some(result_revision),
            &input.actor,
            input.correlation_id.as_deref(),
            Some(json!({
                "reason": input.reason,
                "status": alignment_link_status_text(link.status),
                "linkRevision": link.revision,
            })),
            Some(json!({
                "status": alignment_link_status_text(input.status),
                "linkRevision": link_revision,
            })),
        )?;
        let updated_session = find_alignment_session(&transaction, &session.id)?;
        let links = load_all_alignment_links(&transaction, &session.id)?;
        transaction.commit()?;
        Ok(AlignmentMutationResult {
            session: updated_session,
            links,
            operation_id: Some(operation.id),
        })
    }
}

fn load_alignment_refinement_selection(
    connection: &Connection,
    context: &AlignmentRefinementRunContext,
) -> Result<AlignmentRefinementSelection> {
    require_nonempty("alignment session id", &context.session_id)?;
    require_nonempty("operation actor", &context.actor)?;
    require_nonempty("operation reason", &context.reason)?;
    if context.links.is_empty() {
        return Err(StorageError::InvalidState(
            "AI refinement must select at least one link".to_string(),
        ));
    }
    if context.links.len() > usize::try_from(HARD_MAX_REFINEMENT_LINKS).unwrap_or(usize::MAX) {
        return Err(AlignmentError::ResourceLimitExceeded {
            resource: AlignmentResource::PartitionLinks,
            limit: u64::from(HARD_MAX_REFINEMENT_LINKS),
            actual: u64::try_from(context.links.len()).unwrap_or(u64::MAX),
        }
        .into());
    }

    let session = find_alignment_session(connection, &context.session_id)?;
    ensure_entity_revision(
        "alignment_session",
        &session.id,
        session.revision,
        context.expected_session_revision,
    )?;
    ensure_alignment_session_open(&session)?;
    validate_alignment_session_documents(connection, &session)?;
    let current_links = load_all_alignment_links(connection, &session.id)?;
    let source_snapshots =
        load_all_alignment_snapshots(connection, &session.id, AlignmentSide::Source)?;
    let target_snapshots =
        load_all_alignment_snapshots(connection, &session.id, AlignmentSide::Target)?;
    validate_snapshot_partition(
        &source_snapshots,
        &target_snapshots,
        &partition_links(&current_links),
    )?;
    let expected = context
        .links
        .iter()
        .map(|link| ExpectedAlignmentLinkRevision {
            link_id: link.link_id.clone(),
            expected_revision: link.expected_revision,
        })
        .collect::<Vec<_>>();
    let selected_start = selected_link_range(&current_links, &expected)?;
    let selected_end = selected_start + expected.len();
    let links = current_links[selected_start..selected_end].to_vec();
    if links
        .iter()
        .any(|link| link.status != AlignmentLinkStatus::Proposed)
    {
        return Err(StorageError::InvalidState(
            "AI refinement accepts proposed links only".to_string(),
        ));
    }
    let source_ids = links
        .iter()
        .flat_map(|link| link.source_segment_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    let target_ids = links
        .iter()
        .flat_map(|link| link.target_segment_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    let source_segments = snapshots_for_ids(&source_snapshots, &source_ids);
    let target_segments = snapshots_for_ids(&target_snapshots, &target_ids);
    validate_refinement_input(
        &refinement_segments(&source_segments),
        &refinement_segments(&target_segments),
    )?;
    Ok(AlignmentRefinementSelection {
        session,
        links,
        source_segments,
        target_segments,
    })
}

fn refinement_segments(snapshots: &[AlignmentSessionSegmentRecord]) -> Vec<AlignmentSegment> {
    snapshots
        .iter()
        .map(|snapshot| AlignmentSegment {
            id: snapshot.segment_id.clone(),
            ordinal: snapshot.ordinal,
            text: snapshot.text_snapshot.clone(),
            tag_signature: snapshot.tag_signature.clone(),
        })
        .collect()
}

fn validate_alignment_documents(
    project: &Project,
    source: &Document,
    target: &Document,
    expected_source_revision: u64,
    expected_target_revision: u64,
) -> Result<()> {
    if source.id == target.id {
        return Err(StorageError::InvalidState(
            "alignment requires two different documents".to_string(),
        ));
    }
    if source.project_id != project.id || target.project_id != project.id {
        return Err(StorageError::InvalidState(
            "alignment documents must belong to the selected project".to_string(),
        ));
    }
    if source.status != DocumentStatus::Active || target.status != DocumentStatus::Active {
        return Err(StorageError::InvalidState(
            "alignment requires active documents".to_string(),
        ));
    }
    ensure_entity_revision(
        "document",
        &source.id,
        source.revision,
        expected_source_revision,
    )?;
    ensure_entity_revision(
        "document",
        &target.id,
        target.revision,
        expected_target_revision,
    )
}

fn validate_alignment_session_documents(
    connection: &Connection,
    session: &AlignmentSessionRecord,
) -> Result<()> {
    let project = find_project(connection, &session.project_id)?;
    if project.lifecycle != ProjectLifecycle::Active {
        return Err(StorageError::InvalidState(
            "alignment session project is not active".to_string(),
        ));
    }
    let source = find_document(connection, &session.source_document_id)?;
    let target = find_document(connection, &session.target_document_id)?;
    validate_alignment_documents(
        &project,
        &source,
        &target,
        session.source_document_revision,
        session.target_document_revision,
    )
}

fn load_alignment_segments(
    connection: &Connection,
    document: &Document,
    maximum: u32,
) -> Result<Vec<Segment>> {
    let count = connection.query_row(
        "SELECT COUNT(*) FROM segments WHERE document_id = ?1",
        [&document.id],
        |row| row.get::<_, i64>(0),
    )?;
    let count = u64::try_from(count)
        .map_err(|_| StorageError::InvalidData("negative segment count".to_string()))?;
    if count > u64::from(maximum) {
        return Err(AlignmentError::ResourceLimitExceeded {
            resource: AlignmentResource::Segments,
            limit: u64::from(maximum),
            actual: count,
        }
        .into());
    }
    let mut statement = connection.prepare(
        "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                state, revision, source_hash, context_hash, updated_at_ms
         FROM segments WHERE document_id = ?1
         ORDER BY ordinal, id",
    )?;
    statement
        .query_map([&document.id], row_to_segment)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load_protected_tag_signatures(
    connection: &Connection,
    document_id: &str,
) -> Result<BTreeMap<String, Vec<String>>> {
    let mut statement = connection.prepare(
        "SELECT t.segment_id, t.kind, t.pair_id
         FROM inline_tags t
         JOIN segments s ON s.id = t.segment_id
         WHERE s.document_id = ?1 AND t.side = 'source' AND t.protected = 1
         ORDER BY s.ordinal, t.position, t.id",
    )?;
    let rows = statement.query_map([document_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut signatures = BTreeMap::<String, Vec<String>>::new();
    for row in rows {
        let (segment_id, kind, pair_id) = row?;
        signatures.entry(segment_id).or_default().push(format!(
            "{kind}:{}",
            if pair_id.is_some() {
                "paired"
            } else {
                "single"
            }
        ));
    }
    Ok(signatures)
}

fn alignment_segments(
    segments: &[Segment],
    tags: &BTreeMap<String, Vec<String>>,
) -> Vec<AlignmentSegment> {
    segments
        .iter()
        .map(|segment| AlignmentSegment {
            id: segment.id.clone(),
            ordinal: segment.ordinal,
            text: segment.source_text.clone(),
            tag_signature: tags.get(&segment.id).cloned().unwrap_or_default(),
        })
        .collect()
}

fn insert_alignment_snapshots(
    transaction: &Transaction<'_>,
    session_id: &str,
    side: AlignmentSide,
    segments: &[Segment],
    tags: &BTreeMap<String, Vec<String>>,
) -> Result<()> {
    for segment in segments {
        let number_signature = number_tokens(&segment.source_text);
        let tag_signature = tags.get(&segment.id).cloned().unwrap_or_default();
        transaction.execute(
            "INSERT INTO alignment_session_segments (
                session_id, side, segment_id, ordinal, segment_revision, source_hash,
                text_snapshot, number_signature_json, tag_signature_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                session_id,
                alignment_side_text(side),
                segment.id,
                i64::from(segment.ordinal),
                to_i64(segment.revision)?,
                segment.source_hash,
                segment.source_text,
                serde_json::to_string(&number_signature)?,
                serde_json::to_string(&tag_signature)?,
            ],
        )?;
    }
    Ok(())
}

fn insert_alignment_candidate(
    transaction: &Transaction<'_>,
    session_id: &str,
    ordinal: usize,
    candidate: &AlignmentCandidate,
    now: i64,
) -> Result<()> {
    insert_alignment_link_record(
        transaction,
        &AlignmentLinkRecord {
            id: new_id(),
            session_id: session_id.to_string(),
            ordinal: to_u32(ordinal)?,
            source_segment_ids: candidate.source_segment_ids.clone(),
            target_segment_ids: candidate.target_segment_ids.clone(),
            source_text: candidate.source_text.clone(),
            target_text: candidate.target_text.clone(),
            confidence_basis_points: candidate.confidence_basis_points,
            evidence: candidate.evidence.clone(),
            origin: candidate.origin,
            status: candidate.status,
            revision: 0,
            created_at_ms: now,
            updated_at_ms: now,
        },
    )
}

fn insert_alignment_link_record(
    transaction: &Transaction<'_>,
    link: &AlignmentLinkRecord,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO alignment_links (
            id, session_id, ordinal, source_segment_ids_json, target_segment_ids_json,
            source_text, target_text, confidence_basis_points, evidence_json, origin,
            status, revision, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            link.id,
            link.session_id,
            i64::from(link.ordinal),
            serde_json::to_string(&link.source_segment_ids)?,
            serde_json::to_string(&link.target_segment_ids)?,
            link.source_text,
            link.target_text,
            i64::from(link.confidence_basis_points),
            serde_json::to_string(&link.evidence)?,
            alignment_origin_text(link.origin),
            alignment_link_status_text(link.status),
            to_i64(link.revision)?,
            link.created_at_ms,
            link.updated_at_ms,
        ],
    )?;
    Ok(())
}

fn find_alignment_session(
    connection: &Connection,
    session_id: &str,
) -> Result<AlignmentSessionRecord> {
    connection
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

fn find_alignment_link(connection: &Connection, link_id: &str) -> Result<AlignmentLinkRecord> {
    connection
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

fn load_all_alignment_links(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<AlignmentLinkRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, session_id, ordinal, source_segment_ids_json,
                target_segment_ids_json, source_text, target_text,
                confidence_basis_points, evidence_json, origin, status, revision,
                created_at_ms, updated_at_ms
         FROM alignment_links WHERE session_id = ?1
         ORDER BY ordinal, id",
    )?;
    statement
        .query_map([session_id], row_to_alignment_link)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load_all_alignment_snapshots(
    connection: &Connection,
    session_id: &str,
    side: AlignmentSide,
) -> Result<Vec<AlignmentSessionSegmentRecord>> {
    let mut statement = connection.prepare(
        "SELECT session_id, side, segment_id, ordinal, segment_revision, source_hash,
                text_snapshot, number_signature_json, tag_signature_json
         FROM alignment_session_segments
         WHERE session_id = ?1 AND side = ?2
         ORDER BY ordinal, segment_id",
    )?;
    statement
        .query_map(
            params![session_id, alignment_side_text(side)],
            row_to_alignment_session_segment,
        )?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn ensure_alignment_session_open(session: &AlignmentSessionRecord) -> Result<()> {
    if session.status == AlignmentSessionStatus::Open {
        Ok(())
    } else {
        Err(StorageError::InvalidState(
            "alignment session is terminal".to_string(),
        ))
    }
}

fn partition_segments(
    snapshots: &[AlignmentSessionSegmentRecord],
) -> Vec<AlignmentPartitionSegment> {
    snapshots
        .iter()
        .map(|snapshot| AlignmentPartitionSegment {
            id: snapshot.segment_id.clone(),
            ordinal: snapshot.ordinal,
        })
        .collect()
}

fn partition_links(links: &[AlignmentLinkRecord]) -> Vec<AlignmentPartitionLink> {
    links
        .iter()
        .map(|link| AlignmentPartitionLink {
            source_segment_ids: link.source_segment_ids.clone(),
            target_segment_ids: link.target_segment_ids.clone(),
        })
        .collect()
}

fn validate_snapshot_partition(
    source: &[AlignmentSessionSegmentRecord],
    target: &[AlignmentSessionSegmentRecord],
    links: &[AlignmentPartitionLink],
) -> Result<()> {
    validate_partition(
        &partition_segments(source),
        &partition_segments(target),
        links,
        &PartitionLimits {
            max_links: translunar_alignment_core::HARD_MAX_PARTITION_LINKS,
            max_group_size: MAX_MANUAL_GROUP_SIZE,
        },
    )?;
    Ok(())
}

fn selected_link_range(
    current: &[AlignmentLinkRecord],
    expected: &[ExpectedAlignmentLinkRevision],
) -> Result<usize> {
    let unique = expected
        .iter()
        .map(|link| link.link_id.as_str())
        .collect::<BTreeSet<_>>();
    if unique.len() != expected.len() {
        return Err(StorageError::InvalidState(
            "alignment replacement link IDs must be unique".to_string(),
        ));
    }
    let start = current
        .iter()
        .position(|link| link.id == expected[0].link_id)
        .ok_or_else(|| not_found("alignment_link", &expected[0].link_id))?;
    let end = start.saturating_add(expected.len());
    if end > current.len() {
        return Err(StorageError::InvalidState(
            "alignment replacement links are not contiguous".to_string(),
        ));
    }
    for (current, expected) in current[start..end].iter().zip(expected) {
        if current.id != expected.link_id {
            return Err(StorageError::InvalidState(
                "alignment replacement links are not contiguous and ordered".to_string(),
            ));
        }
        ensure_entity_revision(
            "alignment_link",
            &current.id,
            current.revision,
            expected.expected_revision,
        )?;
    }
    Ok(start)
}

fn snapshots_for_ids(
    snapshots: &[AlignmentSessionSegmentRecord],
    ids: &BTreeSet<String>,
) -> Vec<AlignmentSessionSegmentRecord> {
    snapshots
        .iter()
        .filter(|snapshot| ids.contains(&snapshot.segment_id))
        .cloned()
        .collect()
}

fn snapshot_text_for_ids(
    ids: &[String],
    snapshots: &BTreeMap<&str, &AlignmentSessionSegmentRecord>,
) -> Result<String> {
    ids.iter()
        .map(|id| {
            snapshots
                .get(id.as_str())
                .map(|snapshot| snapshot.text_snapshot.as_str())
                .ok_or_else(|| not_found("alignment_session_segment", id))
        })
        .collect::<Result<Vec<_>>>()
        .map(|texts| texts.join("\n"))
}

fn update_alignment_session_revision(
    transaction: &Transaction<'_>,
    session: &AlignmentSessionRecord,
    result_revision: u64,
    now: i64,
) -> Result<()> {
    let changed = transaction.execute(
        "UPDATE alignment_sessions SET revision = ?1, updated_at_ms = ?2
         WHERE id = ?3 AND revision = ?4 AND status = 'open'",
        params![
            to_i64(result_revision)?,
            now,
            session.id,
            to_i64(session.revision)?,
        ],
    )?;
    if changed == 1 {
        Ok(())
    } else {
        let actual = find_alignment_session(transaction, &session.id)?.revision;
        Err(StorageError::EntityConflict {
            entity: "alignment_session",
            id: session.id.clone(),
            expected_revision: session.revision,
            actual_revision: actual,
        })
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
    use translunar_ai_core::{AiRunRequest, AlignmentRefinementLinkRevision, GroundingOptions};

    use super::*;
    use crate::{NewAiProviderProfile, NewAiRun};

    fn seed_alignment_documents(store: &Store) {
        store
            .connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('alignment-p', 'Alignment project', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert alignment project");
        for document_id in ["alignment-source", "alignment-target"] {
            store
                .connection
                .execute(
                    "INSERT INTO documents (
                        id, project_id, name, format, source_sha256, original_source_path,
                        managed_source_path, segment_count, imported_at_ms
                     ) VALUES (?1, 'alignment-p', ?1, 'txt', 'digest', ?1, ?1, 2, 1)",
                    [document_id],
                )
                .expect("insert alignment document");
        }
        for (segment_id, document_id, ordinal, text) in [
            ("alignment-s1", "alignment-source", 0_i64, "Alpha 42."),
            (
                "alignment-s2",
                "alignment-source",
                1_i64,
                "Beta remains active.",
            ),
            ("alignment-t1", "alignment-target", 0_i64, "Alpha 42."),
            (
                "alignment-t2",
                "alignment-target",
                1_i64,
                "Beta remains active.",
            ),
        ] {
            store
                .connection
                .execute(
                    "INSERT INTO segments (
                        id, document_id, ordinal, structural_path, source_text, target_text,
                        state, revision, source_hash, context_hash, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?1, ?4, '', 'untranslated', 0, ?1, ?1, 1)",
                    params![segment_id, document_id, ordinal, text],
                )
                .expect("insert alignment segment");
        }
        for (tag_id, segment_id, pair_id) in [
            ("alignment-tag-source", "alignment-s1", "source-pair"),
            ("alignment-tag-target", "alignment-t1", "target-pair"),
        ] {
            store
                .connection
                .execute(
                    "INSERT INTO inline_tags (
                        id, segment_id, side, position, kind, pair_id, payload,
                        display_text, protected
                     ) VALUES (?1, ?2, 'source', 0, 'start', ?3, '<b>', '<b>', 1)",
                    (tag_id, segment_id, pair_id),
                )
                .expect("insert protected alignment tag");
        }
    }

    fn new_alignment_session() -> NewAlignmentSession {
        NewAlignmentSession {
            project_id: "alignment-p".to_string(),
            source_document_id: "alignment-source".to_string(),
            target_document_id: "alignment-target".to_string(),
            expected_project_revision: 0,
            expected_source_document_revision: 0,
            expected_target_document_revision: 0,
            options: AlignmentOptions::default(),
            actor: "alignment-tester".to_string(),
            reason: "create deterministic alignment".to_string(),
            correlation_id: Some("alignment-correlation".to_string()),
        }
    }

    fn start_alignment_refinement_run(
        store: &mut Store,
        session: &AlignmentSessionRecord,
        links: &[AlignmentLinkRecord],
    ) -> translunar_ai_core::AiRun {
        let profile = store
            .create_ai_provider_profile(NewAiProviderProfile {
                name: "Alignment fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: "http://127.0.0.1:11434/v1".to_string(),
                model: "alignment-fixture".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create alignment AI profile");
        let run = store
            .create_ai_run(NewAiRun {
                kind: AiRunKind::Action,
                project_id: Some(session.project_id.clone()),
                document_id: None,
                segment_id: None,
                profile_id: Some(profile.id),
                model: profile.model,
                action: ALIGNMENT_REFINEMENT_ACTION.to_string(),
                prompt_hash: "a".repeat(64),
                request: AiRunRequest {
                    grounding_options: GroundingOptions::default(),
                    freeform_prompt: String::new(),
                    conversation_id: None,
                    alignment_refinement: Some(AlignmentRefinementRunContext {
                        session_id: session.id.clone(),
                        expected_session_revision: session.revision,
                        links: links
                            .iter()
                            .map(|link| AlignmentRefinementLinkRevision {
                                link_id: link.id.clone(),
                                expected_revision: link.revision,
                            })
                            .collect(),
                        actor: "alignment-ai".to_string(),
                        reason: "refine low-confidence links".to_string(),
                        correlation_id: Some("alignment-ai-correlation".to_string()),
                    }),
                },
                base_segment_revision: None,
                max_attempts: 1,
            })
            .expect("create alignment refinement run");
        store
            .start_ai_run_attempt(&run.id)
            .expect("start alignment refinement run")
    }

    #[test]
    fn session_create_manual_partition_and_status_are_atomic_and_durable() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        seed_alignment_documents(&store);

        let created = store
            .create_alignment_session(new_alignment_session())
            .expect("create alignment session");
        assert_eq!(created.session.revision, 0);
        assert_eq!(created.link_count, 2);
        let (source_snapshots, source_total) = store
            .list_alignment_session_segments(&created.session.id, AlignmentSide::Source, 0, 10)
            .expect("list source snapshots");
        assert_eq!(source_total, 2);
        assert_eq!(source_snapshots[0].number_signature, ["42"]);
        assert_eq!(source_snapshots[0].tag_signature, ["start:paired"]);
        let (initial_links, initial_total) = store
            .list_alignment_links(&created.session.id, None, 0, 10)
            .expect("list deterministic links");
        assert_eq!(initial_total, 2);

        let replaced = store
            .replace_alignment_partition(ReplaceAlignmentPartition {
                session_id: created.session.id.clone(),
                expected_session_revision: 0,
                links: initial_links
                    .iter()
                    .map(|link| ExpectedAlignmentLinkRevision {
                        link_id: link.id.clone(),
                        expected_revision: link.revision,
                    })
                    .collect(),
                replacement: vec![ManualAlignmentPartitionLink {
                    source_segment_ids: vec![
                        "alignment-s1".to_string(),
                        "alignment-s2".to_string(),
                    ],
                    target_segment_ids: vec![
                        "alignment-t1".to_string(),
                        "alignment-t2".to_string(),
                    ],
                }],
                actor: "alignment-tester".to_string(),
                reason: "merge aligned clauses".to_string(),
                correlation_id: Some("alignment-replace".to_string()),
            })
            .expect("replace alignment partition");
        assert_eq!(replaced.session.revision, 1);
        assert_eq!(replaced.links.len(), 1);
        assert_eq!(replaced.links[0].origin, AlignmentOrigin::Manual);
        assert_eq!(replaced.links[0].status, AlignmentLinkStatus::Proposed);
        let manual_link = replaced.links[0].clone();

        let malformed = store.replace_alignment_partition(ReplaceAlignmentPartition {
            session_id: created.session.id.clone(),
            expected_session_revision: 1,
            links: vec![ExpectedAlignmentLinkRevision {
                link_id: manual_link.id.clone(),
                expected_revision: 0,
            }],
            replacement: vec![
                ManualAlignmentPartitionLink {
                    source_segment_ids: vec!["alignment-s1".to_string()],
                    target_segment_ids: vec!["alignment-t1".to_string()],
                },
                ManualAlignmentPartitionLink {
                    source_segment_ids: vec![
                        "alignment-s1".to_string(),
                        "alignment-s2".to_string(),
                    ],
                    target_segment_ids: vec!["alignment-t2".to_string()],
                },
            ],
            actor: "alignment-tester".to_string(),
            reason: "invalid duplicate member".to_string(),
            correlation_id: None,
        });
        assert!(matches!(
            malformed,
            Err(StorageError::Alignment(
                AlignmentError::DuplicatePartitionMember { .. }
            ))
        ));
        assert_eq!(
            store
                .get_alignment_session(&created.session.id)
                .expect("reload unchanged session")
                .revision,
            1
        );
        assert_eq!(
            store
                .list_alignment_links(&created.session.id, None, 0, 10)
                .expect("reload unchanged links")
                .1,
            1
        );

        let confirmed = store
            .update_alignment_link_status(UpdateAlignmentLinkStatus {
                session_id: created.session.id.clone(),
                link_id: manual_link.id.clone(),
                expected_session_revision: 1,
                expected_link_revision: 0,
                status: AlignmentLinkStatus::Confirmed,
                actor: "alignment-tester".to_string(),
                reason: "confirm reviewed link".to_string(),
                correlation_id: Some("alignment-confirm".to_string()),
            })
            .expect("confirm alignment link");
        assert_eq!(confirmed.session.revision, 2);
        assert_eq!(confirmed.links[0].revision, 1);
        assert_eq!(confirmed.links[0].status, AlignmentLinkStatus::Confirmed);

        let stale = store.update_alignment_link_status(UpdateAlignmentLinkStatus {
            session_id: created.session.id.clone(),
            link_id: manual_link.id.clone(),
            expected_session_revision: 2,
            expected_link_revision: 0,
            status: AlignmentLinkStatus::Rejected,
            actor: "alignment-tester".to_string(),
            reason: "stale rejection".to_string(),
            correlation_id: None,
        });
        assert!(matches!(
            stale,
            Err(StorageError::EntityConflict {
                entity: "alignment_link",
                expected_revision: 0,
                actual_revision: 1,
                ..
            })
        ));
        drop(store);

        let store = Store::open(temp.path()).expect("reopen store");
        let session = store
            .get_alignment_session(&created.session.id)
            .expect("reload session after restart");
        assert_eq!(session.revision, 2);
        let link = store
            .get_alignment_link(&manual_link.id)
            .expect("reload confirmed link");
        assert_eq!(link.status, AlignmentLinkStatus::Confirmed);
        assert_eq!(link.revision, 1);
        let operation_kinds = {
            let mut statement = store
                .connection
                .prepare(
                    "SELECT kind FROM operations
                     WHERE project_id = 'alignment-p' ORDER BY sequence",
                )
                .expect("prepare alignment operation query");
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query alignment operations")
                .collect::<std::result::Result<Vec<_>, _>>()
                .expect("collect alignment operations")
        };
        assert_eq!(
            operation_kinds,
            [
                "alignment.session.create",
                "alignment.partition.replace",
                "alignment.link.status",
            ]
        );
    }

    #[test]
    fn stale_session_create_writes_nothing() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        seed_alignment_documents(&store);
        let mut input = new_alignment_session();
        input.expected_source_document_revision = 9;

        assert!(matches!(
            store.create_alignment_session(input),
            Err(StorageError::EntityConflict {
                entity: "document",
                expected_revision: 9,
                actual_revision: 0,
                ..
            })
        ));
        let session_count = store
            .connection
            .query_row("SELECT COUNT(*) FROM alignment_sessions", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count alignment sessions");
        let operation_count = store
            .connection
            .query_row("SELECT COUNT(*) FROM operations", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count alignment operations");
        assert_eq!((session_count, operation_count), (0, 0));
    }

    #[test]
    fn valid_ai_refinement_completes_links_run_usage_and_audit_atomically() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        seed_alignment_documents(&store);
        let created = store
            .create_alignment_session(new_alignment_session())
            .expect("create alignment session");
        let links = store
            .list_alignment_links(&created.session.id, None, 0, 10)
            .expect("list deterministic links")
            .0;
        let run = start_alignment_refinement_run(&mut store, &created.session, &links);
        let response = serde_json::json!({
            "links": [{
                "sourceSegmentIds": ["alignment-s1", "alignment-s2"],
                "targetSegmentIds": ["alignment-t1", "alignment-t2"],
                "confidenceBasisPoints": 9100,
                "evidence": "Adjacent clauses form one bilingual unit."
            }]
        })
        .to_string();
        let usage = AiUsage {
            input_tokens: Some(10),
            output_tokens: Some(2),
            ..AiUsage::default()
        };

        let result = store
            .complete_alignment_refinement_run(
                &run.id,
                &response,
                AiProviderKind::OpenaiCompatible,
                &usage,
                25,
            )
            .expect("complete alignment refinement");

        assert_eq!(result.session.revision, 1);
        assert_eq!(result.links.len(), 1);
        assert_eq!(result.links[0].origin, AlignmentOrigin::Ai);
        assert_eq!(result.links[0].status, AlignmentLinkStatus::Proposed);
        assert_eq!(result.links[0].confidence_basis_points, 9_100);
        assert!(matches!(
            result.links[0].evidence.as_slice(),
            [AlignmentEvidence::AiRefinement { summary }]
                if summary == "Adjacent clauses form one bilingual unit."
        ));
        let completed_run = store
            .get_ai_run(&run.id)
            .expect("reload completed refinement run");
        assert_eq!(completed_run.status, AiRunStatus::Succeeded);
        assert_eq!(
            completed_run.proposal_text.as_deref(),
            Some(response.as_str())
        );
        assert_eq!(store.ai_token_usage_since(0).expect("AI usage"), 12);
        let operation_kinds = {
            let mut statement = store
                .connection
                .prepare("SELECT kind FROM operations ORDER BY sequence")
                .expect("prepare operation query");
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query operations")
                .collect::<std::result::Result<Vec<_>, _>>()
                .expect("collect operations")
        };
        assert_eq!(
            operation_kinds,
            ["alignment.session.create", "alignment.partition.refine"]
        );
        drop(store);

        let store = Store::open(temp.path()).expect("reopen store");
        assert_eq!(
            store
                .get_alignment_session(&created.session.id)
                .expect("reload refined session")
                .revision,
            1
        );
        assert_eq!(
            store
                .get_ai_run(&run.id)
                .expect("reload refinement run")
                .status,
            AiRunStatus::Succeeded
        );
    }

    #[test]
    fn invalid_ai_refinement_response_rolls_back_every_success_side_effect() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        seed_alignment_documents(&store);
        let created = store
            .create_alignment_session(new_alignment_session())
            .expect("create alignment session");
        let links = store
            .list_alignment_links(&created.session.id, None, 0, 10)
            .expect("list deterministic links")
            .0;
        let original_ids = links.iter().map(|link| link.id.clone()).collect::<Vec<_>>();
        let run = start_alignment_refinement_run(&mut store, &created.session, &links);
        let response = serde_json::json!({
            "links": [{
                "sourceSegmentIds": ["alignment-s1", "alignment-s2"],
                "targetSegmentIds": ["alignment-t1", "alignment-t2"],
                "sourceText": "Alpha 42. Beta remains active.",
                "confidenceBasisPoints": 9100,
                "evidence": "Echoed source text is forbidden."
            }]
        })
        .to_string();
        let usage = AiUsage {
            input_tokens: Some(10),
            output_tokens: Some(2),
            ..AiUsage::default()
        };

        assert!(matches!(
            store.complete_alignment_refinement_run(
                &run.id,
                &response,
                AiProviderKind::OpenaiCompatible,
                &usage,
                25,
            ),
            Err(StorageError::Alignment(
                AlignmentError::InvalidRefinementResponse { .. }
            ))
        ));
        assert_eq!(
            store
                .get_alignment_session(&created.session.id)
                .expect("reload unchanged session")
                .revision,
            0
        );
        assert_eq!(
            store
                .list_alignment_links(&created.session.id, None, 0, 10)
                .expect("reload unchanged links")
                .0
                .into_iter()
                .map(|link| link.id)
                .collect::<Vec<_>>(),
            original_ids
        );
        assert_eq!(
            store.get_ai_run(&run.id).expect("reload active run").status,
            AiRunStatus::Running
        );
        assert_eq!(store.ai_token_usage_since(0).expect("AI usage"), 0);
        let failed = store
            .fail_ai_run_with_usage(
                &run.id,
                "alignment_response_invalid",
                false,
                AiProviderKind::OpenaiCompatible,
                usage,
                25,
            )
            .expect("record rejected provider response");
        assert_eq!(failed.status, AiRunStatus::Failed);
        assert_eq!(store.ai_token_usage_since(0).expect("failed AI usage"), 12);
    }

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
