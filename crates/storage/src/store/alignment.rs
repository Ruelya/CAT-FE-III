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
    HARD_MAX_REFINEMENT_LINKS, HARD_MAX_SEGMENTS_PER_SIDE, PartitionLimits,
    parse_alignment_refinement_response, validate_partition, validate_refinement_input,
};
use translunar_asset_core::{exact_key, normalize_match_key};
use translunar_domain::{
    Document, DocumentStatus, Project, ProjectLifecycle, Segment, new_id, number_tokens, sha256_hex,
};

use super::{
    Store, append_operation, conversion_error, ensure_entity_revision, find_document, find_project,
    find_tm_library, next_revision, not_found, now_ms, read_json, read_optional_json, read_u32,
    read_u64, require_nonempty, row_to_segment, to_i64, to_u32,
};
use crate::{Result, StorageError};

use super::ai::complete_ai_run_tx;

const MAX_MANUAL_REPLACEMENT_LINKS: usize = 256;
const MAX_MANUAL_GROUP_SIZE: u32 = 64;
const MAX_ALIGNMENT_APPLY_LINKS: usize = 100_000;
const MAX_ALIGNMENT_ID_BYTES: usize = 256;
const MAX_ALIGNMENT_ACTOR_BYTES: usize = 256;
const MAX_ALIGNMENT_REASON_BYTES: usize = 4_096;
const MAX_ALIGNMENT_CORRELATION_ID_BYTES: usize = 256;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedAlignmentLinkRevision {
    pub link_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone)]
pub struct ApplyAlignmentToTm {
    pub session_id: String,
    pub library_id: String,
    pub expected_session_revision: u64,
    pub expected_library_revision: u64,
    pub links: Vec<ExpectedAlignmentLinkRevision>,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentApplyDuplicate {
    pub link_id: String,
    pub tm_unit_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentApplyResult {
    pub session_id: String,
    pub library_id: String,
    pub status: AlignmentSessionStatus,
    pub selected_count: u32,
    pub inserted_count: u32,
    pub duplicate_count: u32,
    pub session_revision: u64,
    pub library_revision: u64,
    pub operation_id: String,
    pub tm_unit_ids: Vec<String>,
    pub duplicates: Vec<AlignmentApplyDuplicate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAlignmentApplyTerminal {
    request_fingerprint: String,
    result: AlignmentApplyResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentApplyRequestFingerprint<'a> {
    session_id: &'a str,
    library_id: &'a str,
    expected_session_revision: u64,
    expected_library_revision: u64,
    links: &'a [ExpectedAlignmentLinkRevision],
    actor: &'a str,
    reason: &'a str,
    correlation_id: Option<&'a str>,
}

struct AlignmentTmUnitPlan {
    id: String,
    source_text: String,
    target_text: String,
    source_hash: String,
    source_key: String,
    target_hash: String,
    context_before_hash: Option<String>,
    context_after_hash: Option<String>,
    metadata_json: String,
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

    pub fn apply_alignment_to_tm(
        &mut self,
        input: ApplyAlignmentToTm,
    ) -> Result<AlignmentApplyResult> {
        let canonical_links = validate_alignment_apply_input(&input)?;
        let request_fingerprint = alignment_apply_request_fingerprint(&input, &canonical_links)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let session = find_alignment_session(&transaction, &input.session_id)?;
        if session.status == AlignmentSessionStatus::Applied {
            return decode_alignment_apply_terminal(&session, &request_fingerprint);
        }
        ensure_entity_revision(
            "alignment_session",
            &session.id,
            session.revision,
            input.expected_session_revision,
        )?;
        ensure_alignment_session_open(&session)?;
        validate_alignment_session_documents(&transaction, &session)?;
        let project = find_project(&transaction, &session.project_id)?;
        if project.source_locale != session.source_locale
            || project.target_locale != session.target_locale
        {
            return Err(StorageError::InvalidState(
                "alignment session locales no longer match the project".to_string(),
            ));
        }

        let library = find_tm_library(&transaction, &input.library_id)?;
        ensure_entity_revision(
            "tm_library",
            &library.id,
            library.revision,
            input.expected_library_revision,
        )?;
        if !library.writable {
            return Err(StorageError::InvalidState(
                "TM library is read-only".to_string(),
            ));
        }
        if library.source_locale != project.source_locale
            || library.target_locale != project.target_locale
        {
            return Err(StorageError::InvalidState(
                "TM library locales do not match the alignment project".to_string(),
            ));
        }

        let current_links = load_all_alignment_links(&transaction, &session.id)?;
        let source_snapshots =
            load_all_alignment_snapshots(&transaction, &session.id, AlignmentSide::Source)?;
        let target_snapshots =
            load_all_alignment_snapshots(&transaction, &session.id, AlignmentSide::Target)?;
        validate_snapshot_partition(
            &source_snapshots,
            &target_snapshots,
            &partition_links(&current_links),
        )?;
        validate_alignment_snapshots_current(
            &transaction,
            &session,
            &source_snapshots,
            &target_snapshots,
        )?;
        let selected_links = select_alignment_links_for_apply(&current_links, &canonical_links)?;
        let source_by_id = source_snapshots
            .iter()
            .map(|snapshot| (snapshot.segment_id.as_str(), snapshot))
            .collect::<BTreeMap<_, _>>();
        let target_by_id = target_snapshots
            .iter()
            .map(|snapshot| (snapshot.segment_id.as_str(), snapshot))
            .collect::<BTreeMap<_, _>>();
        let source_by_ordinal = source_snapshots
            .iter()
            .map(|snapshot| (snapshot.ordinal, snapshot))
            .collect::<BTreeMap<_, _>>();
        let mut seen_content = BTreeMap::<(String, String), String>::new();
        let mut plans = Vec::with_capacity(selected_links.len());
        let mut duplicates = Vec::new();
        for link in &selected_links {
            let source_text = snapshot_text_for_ids(&link.source_segment_ids, &source_by_id)?;
            let target_text = snapshot_text_for_ids(&link.target_segment_ids, &target_by_id)?;
            if source_text != link.source_text || target_text != link.target_text {
                return Err(StorageError::InvalidData(format!(
                    "alignment link {} text does not match its immutable snapshots",
                    link.id
                )));
            }
            require_nonempty("TM source text", &source_text)?;
            require_nonempty("TM target text", &target_text)?;
            let source_key = exact_key(&source_text);
            let source_hash = sha256_hex(normalize_match_key(&source_text).as_bytes());
            let target_hash = sha256_hex(normalize_match_key(&target_text).as_bytes());
            let content_key = (source_key.clone(), target_hash.clone());
            if let Some(tm_unit_id) = seen_content.get(&content_key) {
                duplicates.push(AlignmentApplyDuplicate {
                    link_id: link.id.clone(),
                    tm_unit_id: tm_unit_id.clone(),
                });
                continue;
            }
            if let Some(tm_unit_id) =
                find_duplicate_tm_unit_id(&transaction, &library.id, &source_key, &target_hash)?
            {
                seen_content.insert(content_key, tm_unit_id.clone());
                duplicates.push(AlignmentApplyDuplicate {
                    link_id: link.id.clone(),
                    tm_unit_id,
                });
                continue;
            }

            let first_source_id = link.source_segment_ids.first().ok_or_else(|| {
                StorageError::InvalidState(format!(
                    "alignment link {} has no source segments",
                    link.id
                ))
            })?;
            let last_source_id = link.source_segment_ids.last().ok_or_else(|| {
                StorageError::InvalidState(format!(
                    "alignment link {} has no source segments",
                    link.id
                ))
            })?;
            let first_source = source_by_id
                .get(first_source_id.as_str())
                .ok_or_else(|| not_found("alignment_session_segment", first_source_id))?;
            let last_source = source_by_id
                .get(last_source_id.as_str())
                .ok_or_else(|| not_found("alignment_session_segment", last_source_id))?;
            let context_before_hash = first_source
                .ordinal
                .checked_sub(1)
                .and_then(|ordinal| source_by_ordinal.get(&ordinal).copied())
                .map(|snapshot| {
                    sha256_hex(normalize_match_key(&snapshot.text_snapshot).as_bytes())
                });
            let context_after_hash = last_source
                .ordinal
                .checked_add(1)
                .and_then(|ordinal| source_by_ordinal.get(&ordinal).copied())
                .map(|snapshot| {
                    sha256_hex(normalize_match_key(&snapshot.text_snapshot).as_bytes())
                });
            let metadata_json = alignment_tm_metadata(
                &session,
                link,
                &input.actor,
                &input.reason,
                input.correlation_id.as_deref(),
            )?;
            let unit_id = new_id();
            seen_content.insert(content_key, unit_id.clone());
            plans.push(AlignmentTmUnitPlan {
                id: unit_id,
                source_text,
                target_text,
                source_hash,
                source_key,
                target_hash,
                context_before_hash,
                context_after_hash,
                metadata_json,
            });
        }

        let now = now_ms();
        for plan in &plans {
            transaction.execute(
                "INSERT INTO tm_units (
                    id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, source_key, target_hash, domain,
                    origin_project_id, origin_document_id, origin_segment_id,
                    context_before_hash, context_after_hash, author, metadata_json,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           ?11, ?12, NULL, ?13, ?14, ?15, ?16, ?17, ?17)",
                params![
                    plan.id,
                    library.id,
                    library.source_locale,
                    library.target_locale,
                    plan.source_text,
                    plan.target_text,
                    plan.source_hash,
                    plan.source_key,
                    plan.target_hash,
                    library.domain,
                    session.project_id,
                    session.source_document_id,
                    plan.context_before_hash,
                    plan.context_after_hash,
                    input.actor,
                    plan.metadata_json,
                    now,
                ],
            )?;
        }

        let result_library_revision = next_revision(library.revision)?;
        let library_changed = transaction.execute(
            "UPDATE tm_libraries SET revision = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4 AND writable = 1",
            params![
                to_i64(result_library_revision)?,
                now,
                library.id,
                to_i64(library.revision)?,
            ],
        )?;
        if library_changed != 1 {
            let actual = find_tm_library(&transaction, &library.id)?.revision;
            return Err(StorageError::EntityConflict {
                entity: "tm_library",
                id: library.id,
                expected_revision: library.revision,
                actual_revision: actual,
            });
        }
        let result_session_revision = next_revision(session.revision)?;
        let tm_unit_ids = plans.iter().map(|plan| plan.id.clone()).collect::<Vec<_>>();
        let operation = append_operation(
            &transaction,
            &session.project_id,
            "alignment_session",
            &session.id,
            "alignment.session.apply",
            Some(session.revision),
            Some(result_session_revision),
            &input.actor,
            input.correlation_id.as_deref(),
            Some(json!({
                "reason": input.reason,
                "libraryId": library.id,
                "libraryRevision": library.revision,
                "linkIds": selected_links.iter().map(|link| &link.id).collect::<Vec<_>>(),
            })),
            Some(json!({
                "status": "applied",
                "libraryRevision": result_library_revision,
                "tmUnitIds": tm_unit_ids,
                "duplicates": duplicates,
            })),
        )?;
        let result = AlignmentApplyResult {
            session_id: session.id.clone(),
            library_id: library.id.clone(),
            status: AlignmentSessionStatus::Applied,
            selected_count: to_u32(selected_links.len())?,
            inserted_count: to_u32(plans.len())?,
            duplicate_count: to_u32(duplicates.len())?,
            session_revision: result_session_revision,
            library_revision: result_library_revision,
            operation_id: operation.id,
            tm_unit_ids,
            duplicates,
        };
        let terminal = StoredAlignmentApplyTerminal {
            request_fingerprint,
            result: result.clone(),
        };
        let session_changed = transaction.execute(
            "UPDATE alignment_sessions
             SET status = 'applied', revision = ?1, terminal_result_json = ?2,
                 updated_at_ms = ?3, closed_at_ms = ?3
             WHERE id = ?4 AND revision = ?5 AND status = 'open'",
            params![
                to_i64(result_session_revision)?,
                serde_json::to_string(&terminal)?,
                now,
                session.id,
                to_i64(session.revision)?,
            ],
        )?;
        if session_changed != 1 {
            let actual = find_alignment_session(&transaction, &session.id)?.revision;
            return Err(StorageError::EntityConflict {
                entity: "alignment_session",
                id: session.id,
                expected_revision: session.revision,
                actual_revision: actual,
            });
        }
        transaction.commit()?;
        Ok(result)
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
        validate_alignment_snapshots_current(
            &transaction,
            &session,
            &source_snapshots,
            &target_snapshots,
        )?;
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
        let source_snapshots =
            load_all_alignment_snapshots(&transaction, &session.id, AlignmentSide::Source)?;
        let target_snapshots =
            load_all_alignment_snapshots(&transaction, &session.id, AlignmentSide::Target)?;
        validate_alignment_snapshots_current(
            &transaction,
            &session,
            &source_snapshots,
            &target_snapshots,
        )?;
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

fn validate_alignment_apply_input(
    input: &ApplyAlignmentToTm,
) -> Result<Vec<ExpectedAlignmentLinkRevision>> {
    require_nonempty("alignment session id", &input.session_id)?;
    require_nonempty("TM library id", &input.library_id)?;
    require_nonempty("operation actor", &input.actor)?;
    require_nonempty("operation reason", &input.reason)?;
    if input.session_id.len() > MAX_ALIGNMENT_ID_BYTES
        || input.library_id.len() > MAX_ALIGNMENT_ID_BYTES
        || input.actor.len() > MAX_ALIGNMENT_ACTOR_BYTES
        || input.reason.len() > MAX_ALIGNMENT_REASON_BYTES
        || input.correlation_id.as_ref().is_some_and(|value| {
            value.trim().is_empty() || value.len() > MAX_ALIGNMENT_CORRELATION_ID_BYTES
        })
    {
        return Err(StorageError::InvalidState(
            "alignment apply identities, actor, reason, or correlation exceed configured bounds"
                .to_string(),
        ));
    }
    if input.links.is_empty() || input.links.len() > MAX_ALIGNMENT_APPLY_LINKS {
        return Err(StorageError::InvalidState(format!(
            "alignment apply must select 1..{MAX_ALIGNMENT_APPLY_LINKS} links"
        )));
    }
    let mut unique = BTreeSet::new();
    let mut canonical = Vec::with_capacity(input.links.len());
    for link in &input.links {
        if link.link_id.trim().is_empty()
            || link.link_id.len() > MAX_ALIGNMENT_ID_BYTES
            || !unique.insert(link.link_id.as_str())
        {
            return Err(StorageError::InvalidState(
                "alignment apply link IDs must be bounded and unique".to_string(),
            ));
        }
        canonical.push(link.clone());
    }
    canonical.sort_by(|left, right| left.link_id.cmp(&right.link_id));
    Ok(canonical)
}

fn alignment_apply_request_fingerprint(
    input: &ApplyAlignmentToTm,
    canonical_links: &[ExpectedAlignmentLinkRevision],
) -> Result<String> {
    let value = AlignmentApplyRequestFingerprint {
        session_id: &input.session_id,
        library_id: &input.library_id,
        expected_session_revision: input.expected_session_revision,
        expected_library_revision: input.expected_library_revision,
        links: canonical_links,
        actor: &input.actor,
        reason: &input.reason,
        correlation_id: input.correlation_id.as_deref(),
    };
    Ok(sha256_hex(&serde_json::to_vec(&value)?))
}

fn decode_alignment_apply_terminal(
    session: &AlignmentSessionRecord,
    request_fingerprint: &str,
) -> Result<AlignmentApplyResult> {
    let terminal = session.terminal_result.clone().ok_or_else(|| {
        StorageError::InvalidData("applied alignment session has no terminal result".to_string())
    })?;
    let terminal: StoredAlignmentApplyTerminal = serde_json::from_value(terminal)?;
    if terminal.request_fingerprint != request_fingerprint {
        return Err(StorageError::InvalidState(
            "alignment session was applied by a different request".to_string(),
        ));
    }
    if terminal.result.session_id != session.id
        || terminal.result.status != AlignmentSessionStatus::Applied
        || terminal.result.session_revision != session.revision
    {
        return Err(StorageError::InvalidData(
            "alignment terminal result does not match its session".to_string(),
        ));
    }
    Ok(terminal.result)
}

fn select_alignment_links_for_apply(
    current: &[AlignmentLinkRecord],
    expected: &[ExpectedAlignmentLinkRevision],
) -> Result<Vec<AlignmentLinkRecord>> {
    let expected_by_id = expected
        .iter()
        .map(|link| (link.link_id.as_str(), link.expected_revision))
        .collect::<BTreeMap<_, _>>();
    let mut selected = Vec::with_capacity(expected.len());
    for link in current {
        let Some(expected_revision) = expected_by_id.get(link.id.as_str()).copied() else {
            continue;
        };
        ensure_entity_revision("alignment_link", &link.id, link.revision, expected_revision)?;
        if link.status != AlignmentLinkStatus::Confirmed {
            return Err(StorageError::InvalidState(format!(
                "alignment link {} is not confirmed",
                link.id
            )));
        }
        if link.source_segment_ids.is_empty() || link.target_segment_ids.is_empty() {
            return Err(StorageError::InvalidState(format!(
                "alignment link {} is not a non-empty bilingual link",
                link.id
            )));
        }
        selected.push(link.clone());
    }
    if selected.len() != expected.len() {
        let current_ids = current
            .iter()
            .map(|link| link.id.as_str())
            .collect::<BTreeSet<_>>();
        let missing = expected
            .iter()
            .find(|link| !current_ids.contains(link.link_id.as_str()))
            .map(|link| link.link_id.as_str())
            .unwrap_or("unknown");
        return Err(not_found("alignment_link", missing));
    }
    Ok(selected)
}

fn find_duplicate_tm_unit_id(
    connection: &Connection,
    library_id: &str,
    source_key: &str,
    target_hash: &str,
) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT id FROM tm_units
             WHERE library_id = ?1 AND source_key = ?2 AND target_hash = ?3
             ORDER BY created_at_ms, id LIMIT 1",
            params![library_id, source_key, target_hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

fn alignment_tm_metadata(
    session: &AlignmentSessionRecord,
    link: &AlignmentLinkRecord,
    actor: &str,
    reason: &str,
    correlation_id: Option<&str>,
) -> Result<String> {
    let mut metadata = BTreeMap::<String, String>::new();
    metadata.insert("alignmentSessionId".to_string(), session.id.clone());
    metadata.insert("alignmentLinkId".to_string(), link.id.clone());
    metadata.insert(
        "sourceDocumentId".to_string(),
        session.source_document_id.clone(),
    );
    metadata.insert(
        "targetDocumentId".to_string(),
        session.target_document_id.clone(),
    );
    metadata.insert(
        "sourceDocumentRevision".to_string(),
        session.source_document_revision.to_string(),
    );
    metadata.insert(
        "targetDocumentRevision".to_string(),
        session.target_document_revision.to_string(),
    );
    metadata.insert(
        "sourceSegmentIds".to_string(),
        serde_json::to_string(&link.source_segment_ids)?,
    );
    metadata.insert(
        "targetSegmentIds".to_string(),
        serde_json::to_string(&link.target_segment_ids)?,
    );
    metadata.insert(
        "confidenceBasisPoints".to_string(),
        link.confidence_basis_points.to_string(),
    );
    metadata.insert(
        "alignmentOrigin".to_string(),
        alignment_origin_text(link.origin).to_string(),
    );
    metadata.insert(
        "alignmentEvidence".to_string(),
        serde_json::to_string(&link.evidence)?,
    );
    metadata.insert("sessionRevision".to_string(), session.revision.to_string());
    metadata.insert("linkRevision".to_string(), link.revision.to_string());
    metadata.insert(
        "alignmentAlgorithmVersion".to_string(),
        session.algorithm_version.clone(),
    );
    metadata.insert("actor".to_string(), actor.to_string());
    metadata.insert("reason".to_string(), reason.to_string());
    if let Some(correlation_id) = correlation_id {
        metadata.insert("correlationId".to_string(), correlation_id.to_string());
    }
    serde_json::to_string(&metadata).map_err(Into::into)
}

fn validate_alignment_snapshots_current(
    connection: &Connection,
    session: &AlignmentSessionRecord,
    source: &[AlignmentSessionSegmentRecord],
    target: &[AlignmentSessionSegmentRecord],
) -> Result<()> {
    validate_alignment_snapshot_side_current(
        connection,
        &session.source_document_id,
        source,
        AlignmentSide::Source,
    )?;
    validate_alignment_snapshot_side_current(
        connection,
        &session.target_document_id,
        target,
        AlignmentSide::Target,
    )
}

fn validate_alignment_snapshot_side_current(
    connection: &Connection,
    document_id: &str,
    snapshots: &[AlignmentSessionSegmentRecord],
    side: AlignmentSide,
) -> Result<()> {
    let document = find_document(connection, document_id)?;
    let current = load_alignment_segments(connection, &document, HARD_MAX_SEGMENTS_PER_SIDE)?;
    if current.len() != snapshots.len() {
        return Err(StorageError::InvalidState(format!(
            "alignment {side} segment membership changed"
        )));
    }
    let current_by_id = current
        .iter()
        .map(|segment| (segment.id.as_str(), segment))
        .collect::<BTreeMap<_, _>>();
    for snapshot in snapshots {
        let segment = current_by_id
            .get(snapshot.segment_id.as_str())
            .copied()
            .ok_or_else(|| not_found("segment", &snapshot.segment_id))?;
        if segment.ordinal != snapshot.ordinal {
            return Err(StorageError::InvalidState(format!(
                "alignment {side} segment order changed"
            )));
        }
        if segment.revision != snapshot.segment_revision {
            return Err(StorageError::Conflict {
                segment_id: segment.id.clone(),
                expected_revision: snapshot.segment_revision,
                actual_revision: segment.revision,
            });
        }
        if segment.source_hash != snapshot.source_hash
            || segment.source_text != snapshot.text_snapshot
        {
            return Err(StorageError::InvalidData(format!(
                "alignment {side} segment {} changed without a revision",
                segment.id
            )));
        }
    }
    Ok(())
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
    validate_alignment_snapshots_current(
        connection,
        &session,
        &source_snapshots,
        &target_snapshots,
    )?;
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
    use translunar_asset_core::{TmExchangeUnit, TmLibrary};

    use super::*;
    use crate::{NewAiProviderProfile, NewAiRun, NewTmLibrary};

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

    fn create_alignment_tm_library(
        store: &mut Store,
        writable: bool,
        source_locale: &str,
        target_locale: &str,
    ) -> TmLibrary {
        store
            .create_tm_library(NewTmLibrary {
                name: format!("Alignment TM {source_locale}-{target_locale}"),
                source_locale: source_locale.to_string(),
                target_locale: target_locale.to_string(),
                domain: Some("general".to_string()),
                writable,
                owner_project_id: Some("alignment-p".to_string()),
            })
            .expect("create alignment TM library")
    }

    fn confirm_alignment_links(
        store: &mut Store,
        session: &AlignmentSessionRecord,
        links: &[AlignmentLinkRecord],
    ) -> (AlignmentSessionRecord, Vec<AlignmentLinkRecord>) {
        let link_ids = links.iter().map(|link| link.id.clone()).collect::<Vec<_>>();
        let mut current_session = session.clone();
        let mut current_links = links.to_vec();
        for link_id in link_ids {
            let link = current_links
                .iter()
                .find(|link| link.id == link_id)
                .expect("find alignment link to confirm")
                .clone();
            let result = store
                .update_alignment_link_status(UpdateAlignmentLinkStatus {
                    session_id: current_session.id.clone(),
                    link_id,
                    expected_session_revision: current_session.revision,
                    expected_link_revision: link.revision,
                    status: AlignmentLinkStatus::Confirmed,
                    actor: "alignment-apply-tester".to_string(),
                    reason: "confirm link before TM apply".to_string(),
                    correlation_id: None,
                })
                .expect("confirm alignment link");
            current_session = result.session;
            current_links = result.links;
        }
        (current_session, current_links)
    }

    fn alignment_apply_input(
        session: &AlignmentSessionRecord,
        library: &TmLibrary,
        links: &[AlignmentLinkRecord],
    ) -> ApplyAlignmentToTm {
        ApplyAlignmentToTm {
            session_id: session.id.clone(),
            library_id: library.id.clone(),
            expected_session_revision: session.revision,
            expected_library_revision: library.revision,
            links: links
                .iter()
                .map(|link| ExpectedAlignmentLinkRevision {
                    link_id: link.id.clone(),
                    expected_revision: link.revision,
                })
                .collect(),
            actor: "alignment-apply-tester".to_string(),
            reason: "apply confirmed alignment links".to_string(),
            correlation_id: Some("alignment-apply-correlation".to_string()),
        }
    }

    fn create_open_alignment(
        store: &mut Store,
    ) -> (AlignmentSessionRecord, Vec<AlignmentLinkRecord>) {
        seed_alignment_documents(store);
        let created = store
            .create_alignment_session(new_alignment_session())
            .expect("create alignment session");
        let links = store
            .list_alignment_links(&created.session.id, None, 0, 10)
            .expect("list alignment links")
            .0;
        (created.session, links)
    }

    fn create_confirmed_alignment(
        store: &mut Store,
    ) -> (AlignmentSessionRecord, Vec<AlignmentLinkRecord>) {
        let (session, links) = create_open_alignment(store);
        confirm_alignment_links(store, &session, &links)
    }

    fn assert_no_alignment_apply_side_effects(
        store: &Store,
        session: &AlignmentSessionRecord,
        library: &TmLibrary,
        expected_library_revision: u64,
        expected_tm_unit_count: usize,
    ) {
        let current_session = store
            .get_alignment_session(&session.id)
            .expect("reload alignment session");
        assert_eq!(current_session.status, AlignmentSessionStatus::Open);
        assert_eq!(current_session.revision, session.revision);
        assert!(current_session.terminal_result.is_none());
        assert!(current_session.closed_at_ms.is_none());
        assert_eq!(
            store
                .get_tm_library(&library.id)
                .expect("reload TM library")
                .revision,
            expected_library_revision
        );
        assert_eq!(
            store
                .export_tm_units(&library.id)
                .expect("reload TM units")
                .len(),
            expected_tm_unit_count
        );
        let apply_operation_count = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM operations WHERE kind = 'alignment.session.apply'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count alignment apply operations");
        assert_eq!(apply_operation_count, 0);
    }

    #[test]
    fn alignment_apply_is_provenance_complete_terminal_and_restart_idempotent() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let input = alignment_apply_input(&session, &library, &links);

        let result = store
            .apply_alignment_to_tm(input.clone())
            .expect("apply confirmed alignment links to TM");

        assert_eq!(result.session_id, session.id);
        assert_eq!(result.library_id, library.id);
        assert_eq!(result.status, AlignmentSessionStatus::Applied);
        assert_eq!(result.selected_count, 2);
        assert_eq!(result.inserted_count, 2);
        assert_eq!(result.duplicate_count, 0);
        assert_eq!(result.session_revision, session.revision + 1);
        assert_eq!(result.library_revision, library.revision + 1);
        assert_eq!(result.tm_unit_ids.len(), 2);
        assert!(result.duplicates.is_empty());

        let units = store
            .export_tm_units(&library.id)
            .expect("list alignment TM units");
        assert_eq!(units.len(), 2);
        assert_eq!(
            units
                .iter()
                .map(|unit| unit.id.as_str())
                .collect::<BTreeSet<_>>(),
            result
                .tm_unit_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
        );
        for link in &links {
            let unit = units
                .iter()
                .find(|unit| unit.metadata["alignmentLinkId"] == link.id)
                .expect("find TM unit for alignment link");
            assert_eq!(unit.source_text, link.source_text);
            assert_eq!(unit.target_text, link.target_text);
            assert_eq!(unit.origin_project_id.as_deref(), Some("alignment-p"));
            assert_eq!(unit.origin_document_id.as_deref(), Some("alignment-source"));
            assert!(unit.origin_segment_id.is_none());
            assert_eq!(unit.author.as_deref(), Some(input.actor.as_str()));
            assert_eq!(unit.metadata["alignmentSessionId"], session.id);
            assert_eq!(unit.metadata["sourceDocumentId"], "alignment-source");
            assert_eq!(unit.metadata["targetDocumentId"], "alignment-target");
            assert_eq!(
                unit.metadata["sourceSegmentIds"],
                serde_json::to_string(&link.source_segment_ids)
                    .expect("serialize expected source segment IDs")
            );
            assert_eq!(
                unit.metadata["targetSegmentIds"],
                serde_json::to_string(&link.target_segment_ids)
                    .expect("serialize expected target segment IDs")
            );
            assert_eq!(
                unit.metadata["confidenceBasisPoints"],
                link.confidence_basis_points.to_string()
            );
            assert_eq!(
                unit.metadata["alignmentEvidence"],
                serde_json::to_string(&link.evidence).expect("serialize expected evidence")
            );
            assert_eq!(unit.metadata["actor"], input.actor);
            assert_eq!(unit.metadata["reason"], input.reason);
            assert_eq!(
                unit.metadata["correlationId"],
                input
                    .correlation_id
                    .as_deref()
                    .expect("alignment apply correlation ID")
            );
            assert_eq!(
                unit.metadata["sessionRevision"],
                session.revision.to_string()
            );
            assert_eq!(unit.metadata["linkRevision"], link.revision.to_string());
        }

        let terminal = store
            .get_alignment_session(&session.id)
            .expect("reload terminal alignment session");
        assert_eq!(terminal.status, AlignmentSessionStatus::Applied);
        assert_eq!(terminal.revision, result.session_revision);
        assert!(terminal.terminal_result.is_some());
        assert!(terminal.closed_at_ms.is_some());
        assert_eq!(
            store
                .get_tm_library(&library.id)
                .expect("reload revised TM library")
                .revision,
            result.library_revision
        );
        let (operations, operation_total) = store
            .list_operations("alignment-p", 0, 100, false)
            .expect("list alignment operations");
        let apply_operation = operations
            .iter()
            .find(|operation| operation.kind == "alignment.session.apply")
            .expect("find alignment apply operation");
        assert_eq!(operation_total, 4);
        assert_eq!(apply_operation.id, result.operation_id);
        assert_eq!(apply_operation.base_revision, Some(session.revision));
        assert_eq!(
            apply_operation.result_revision,
            Some(result.session_revision)
        );
        assert_eq!(apply_operation.actor, input.actor);
        assert_eq!(
            apply_operation.correlation_id.as_deref(),
            input.correlation_id.as_deref()
        );
        assert_eq!(
            apply_operation
                .before
                .as_ref()
                .and_then(|value| value["reason"].as_str()),
            Some(input.reason.as_str())
        );
        assert_eq!(
            apply_operation
                .after
                .as_ref()
                .and_then(|value| value["status"].as_str()),
            Some("applied")
        );
        drop(store);

        let mut store = Store::open(temp.path()).expect("reopen store");
        let mut replay_input = input.clone();
        replay_input.links.reverse();
        assert_eq!(
            store
                .apply_alignment_to_tm(replay_input)
                .expect("replay identical alignment apply after restart"),
            result
        );
        assert_eq!(
            store
                .export_tm_units(&library.id)
                .expect("list TM units after replay")
                .len(),
            2
        );
        assert_eq!(
            store
                .list_operations("alignment-p", 0, 100, false)
                .expect("list operations after replay")
                .1,
            operation_total
        );
        assert_eq!(
            store
                .get_tm_library(&library.id)
                .expect("reload TM library after replay")
                .revision,
            result.library_revision
        );

        let mut different_request = input;
        different_request.reason = "different terminal request".to_string();
        assert!(matches!(
            store.apply_alignment_to_tm(different_request),
            Err(StorageError::InvalidState(message))
                if message.contains("different request")
        ));
        assert_eq!(
            store
                .export_tm_units(&library.id)
                .expect("list TM units after rejected terminal request")
                .len(),
            2
        );
        assert_eq!(
            store
                .list_operations("alignment-p", 0, 100, false)
                .expect("list operations after rejected terminal request")
                .1,
            operation_total
        );
    }

    #[test]
    fn alignment_apply_deduplicates_existing_content_and_still_revises_library_once() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let mut library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let existing_units = links
            .iter()
            .map(|link| TmExchangeUnit {
                source_locale: "en".to_string(),
                target_locale: "zh".to_string(),
                source_text: link.source_text.clone(),
                target_text: link.target_text.clone(),
                domain: Some("general".to_string()),
                author: Some("existing-unit-author".to_string()),
                created_at_ms: None,
                metadata: BTreeMap::new(),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            store
                .import_tm_units(&library.id, &existing_units)
                .expect("seed existing TM content"),
            (2, 0)
        );
        library = store
            .get_tm_library(&library.id)
            .expect("reload seeded TM library");
        let existing = store
            .export_tm_units(&library.id)
            .expect("list seeded TM units");
        let input = alignment_apply_input(&session, &library, &links);

        let result = store
            .apply_alignment_to_tm(input)
            .expect("apply fully duplicate alignment content");

        assert_eq!(result.selected_count, 2);
        assert_eq!(result.inserted_count, 0);
        assert_eq!(result.duplicate_count, 2);
        assert!(result.tm_unit_ids.is_empty());
        assert_eq!(result.duplicates.len(), 2);
        assert_eq!(result.library_revision, library.revision + 1);
        assert_eq!(
            result
                .duplicates
                .iter()
                .map(|duplicate| duplicate.tm_unit_id.as_str())
                .collect::<BTreeSet<_>>(),
            existing
                .iter()
                .map(|unit| unit.id.as_str())
                .collect::<BTreeSet<_>>()
        );
        assert_eq!(
            store
                .export_tm_units(&library.id)
                .expect("list deduplicated TM units")
                .len(),
            2
        );
        assert_eq!(
            store
                .get_tm_library(&library.id)
                .expect("reload library after duplicate-only apply")
                .revision,
            library.revision + 1
        );
        assert_eq!(
            store
                .get_alignment_session(&session.id)
                .expect("reload applied duplicate-only session")
                .status,
            AlignmentSessionStatus::Applied
        );
    }

    #[test]
    fn alignment_apply_rejects_duplicate_selection_without_side_effects() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let mut input = alignment_apply_input(&session, &library, &links);
        input.links = vec![input.links[0].clone(), input.links[0].clone()];

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::InvalidState(message)) if message.contains("unique")
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
    }

    #[test]
    fn alignment_apply_rejects_mixed_confirmed_and_proposed_selection_atomically() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_open_alignment(&mut store);
        let (session, links) = confirm_alignment_links(&mut store, &session, &links[..1]);
        assert!(
            links
                .iter()
                .any(|link| link.status == AlignmentLinkStatus::Confirmed)
        );
        assert!(
            links
                .iter()
                .any(|link| link.status == AlignmentLinkStatus::Proposed)
        );
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let input = alignment_apply_input(&session, &library, &links);

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::InvalidState(message)) if message.contains("not confirmed")
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
    }

    #[test]
    fn alignment_apply_rejects_stale_session_revision_without_side_effects() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let mut input = alignment_apply_input(&session, &library, &links);
        input.expected_session_revision -= 1;

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::EntityConflict {
                entity: "alignment_session",
                expected_revision: 1,
                actual_revision: 2,
                ..
            })
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
    }

    #[test]
    fn alignment_apply_rejects_stale_link_revision_without_side_effects() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let mut input = alignment_apply_input(&session, &library, &links);
        input.links[0].expected_revision -= 1;

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::EntityConflict {
                entity: "alignment_link",
                expected_revision: 0,
                actual_revision: 1,
                ..
            })
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
    }

    #[test]
    fn alignment_apply_rejects_stale_segment_revision_without_side_effects() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let input = alignment_apply_input(&session, &library, &links);
        store
            .connection
            .execute(
                "UPDATE segments SET revision = revision + 1 WHERE id = 'alignment-s1'",
                [],
            )
            .expect("advance source segment revision");

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::Conflict {
                segment_id,
                expected_revision: 0,
                actual_revision: 1,
            }) if segment_id == "alignment-s1"
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
    }

    #[test]
    fn stale_snapshot_blocks_manual_status_and_refinement_mutations() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_open_alignment(&mut store);
        store
            .connection
            .execute(
                "UPDATE segments SET revision = revision + 1 WHERE id = 'alignment-s1'",
                [],
            )
            .expect("advance source segment revision");

        let status_error = store.update_alignment_link_status(UpdateAlignmentLinkStatus {
            session_id: session.id.clone(),
            link_id: links[0].id.clone(),
            expected_session_revision: session.revision,
            expected_link_revision: links[0].revision,
            status: AlignmentLinkStatus::Confirmed,
            actor: "alignment-stale-tester".to_string(),
            reason: "reject stale status mutation".to_string(),
            correlation_id: None,
        });
        assert!(matches!(
            status_error,
            Err(StorageError::Conflict {
                segment_id,
                expected_revision: 0,
                actual_revision: 1,
            }) if segment_id == "alignment-s1"
        ));

        let replacement_error = store.replace_alignment_partition(ReplaceAlignmentPartition {
            session_id: session.id.clone(),
            expected_session_revision: session.revision,
            links: links
                .iter()
                .map(|link| ExpectedAlignmentLinkRevision {
                    link_id: link.id.clone(),
                    expected_revision: link.revision,
                })
                .collect(),
            replacement: links
                .iter()
                .map(|link| ManualAlignmentPartitionLink {
                    source_segment_ids: link.source_segment_ids.clone(),
                    target_segment_ids: link.target_segment_ids.clone(),
                })
                .collect(),
            actor: "alignment-stale-tester".to_string(),
            reason: "reject stale manual replacement".to_string(),
            correlation_id: None,
        });
        assert!(matches!(
            replacement_error,
            Err(StorageError::Conflict {
                segment_id,
                expected_revision: 0,
                actual_revision: 1,
            }) if segment_id == "alignment-s1"
        ));

        let refinement_error = store.prepare_alignment_refinement(&AlignmentRefinementRunContext {
            session_id: session.id.clone(),
            expected_session_revision: session.revision,
            links: links
                .iter()
                .map(|link| AlignmentRefinementLinkRevision {
                    link_id: link.id.clone(),
                    expected_revision: link.revision,
                })
                .collect(),
            actor: "alignment-stale-tester".to_string(),
            reason: "reject stale AI refinement".to_string(),
            correlation_id: None,
        });
        assert!(matches!(
            refinement_error,
            Err(StorageError::Conflict {
                segment_id,
                expected_revision: 0,
                actual_revision: 1,
            }) if segment_id == "alignment-s1"
        ));

        assert_eq!(
            store
                .get_alignment_session(&session.id)
                .expect("reload unchanged stale session")
                .revision,
            session.revision
        );
        assert_eq!(
            store
                .list_alignment_links(&session.id, None, 0, 10)
                .expect("reload unchanged stale links")
                .0,
            links
        );
        assert_eq!(
            store
                .list_operations("alignment-p", 0, 100, false)
                .expect("list stale-rejected operations")
                .1,
            1
        );
    }

    #[test]
    fn alignment_apply_rejects_stale_document_revision_without_side_effects() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let input = alignment_apply_input(&session, &library, &links);
        store
            .connection
            .execute(
                "UPDATE documents SET revision = revision + 1 WHERE id = 'alignment-target'",
                [],
            )
            .expect("advance target document revision");

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::EntityConflict {
                entity: "document",
                expected_revision: 0,
                actual_revision: 1,
                ..
            })
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
    }

    #[test]
    fn alignment_apply_rejects_stale_read_only_and_locale_mismatched_libraries() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);

        let read_only = create_alignment_tm_library(&mut store, false, "en", "zh");
        assert!(matches!(
            store.apply_alignment_to_tm(alignment_apply_input(
                &session,
                &read_only,
                &links,
            )),
            Err(StorageError::InvalidState(message)) if message.contains("read-only")
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &read_only, read_only.revision, 0);

        let mismatched = create_alignment_tm_library(&mut store, true, "en", "fr");
        assert!(matches!(
            store.apply_alignment_to_tm(alignment_apply_input(
                &session,
                &mismatched,
                &links,
            )),
            Err(StorageError::InvalidState(message)) if message.contains("locales")
        ));
        assert_no_alignment_apply_side_effects(
            &store,
            &session,
            &mismatched,
            mismatched.revision,
            0,
        );

        let stale = create_alignment_tm_library(&mut store, true, "en", "zh");
        let stale_input = alignment_apply_input(&session, &stale, &links);
        store
            .connection
            .execute(
                "UPDATE tm_libraries SET revision = revision + 1 WHERE id = ?1",
                [&stale.id],
            )
            .expect("advance TM library revision");
        assert!(matches!(
            store.apply_alignment_to_tm(stale_input),
            Err(StorageError::EntityConflict {
                entity: "tm_library",
                expected_revision: 0,
                actual_revision: 1,
                ..
            })
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &stale, 1, 0);
    }

    #[test]
    fn alignment_apply_rolls_back_first_insert_when_second_insert_fails() {
        let temp = tempdir().expect("temporary storage directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let (session, links) = create_confirmed_alignment(&mut store);
        let library = create_alignment_tm_library(&mut store, true, "en", "zh");
        let input = alignment_apply_input(&session, &library, &links);
        store
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER fail_second_alignment_tm_insert
                 BEFORE INSERT ON tm_units
                 WHEN NEW.target_text = 'Beta remains active.'
                 BEGIN
                     SELECT RAISE(ABORT, 'forced second alignment TM insert failure');
                 END;",
            )
            .expect("install forced second-insert failure trigger");

        assert!(matches!(
            store.apply_alignment_to_tm(input),
            Err(StorageError::Database(_))
        ));
        assert_no_alignment_apply_side_effects(&store, &session, &library, library.revision, 0);
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
