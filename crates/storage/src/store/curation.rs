use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use translunar_asset_core::TmLibrary;
use translunar_curation_core::{
    CurationAnalysis, CurationDriftGroup, CurationEvidence, CurationFindingKind, CurationPolicy,
    CurationRecommendation, CurationSeverity, CurationSummary, CurationTermCandidate, CurationUnit,
    DatasetUnit, MAX_UNITS_PER_RUN, unit_snapshot_hash,
};

use super::{
    Store, append_operation, conversion_error, ensure_entity_revision, find_project,
    find_tm_library, next_revision, not_found, now_ms, read_json, read_u64, require_nonempty,
    to_i64, to_u32,
};
use crate::{Result, StorageError};

const MAX_PAGE_SIZE: u32 = 500;
const MAX_ACTOR_BYTES: usize = 256;
const MAX_REASON_BYTES: usize = 4_096;
const MAX_CORRELATION_ID_BYTES: usize = 256;
const MAX_ID_BYTES: usize = 256;
const MAX_CATALOG_TEXT_CHARS: usize = 4_096;
const MAX_CATALOG_WINDOW: u32 = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CurationRunMode {
    Offline,
    Provider,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CurationRunStatus {
    Open,
    Applied,
    RolledBack,
    Discarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CurationState {
    Active,
    Quarantined,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationSnapshot {
    pub project_id: String,
    pub library: TmLibrary,
    pub units: Vec<CurationUnit>,
}

#[derive(Debug, Clone)]
pub struct CreateCurationRun {
    pub project_id: String,
    pub library_id: String,
    pub expected_library_revision: u64,
    pub mode: CurationRunMode,
    pub policy: CurationPolicy,
    pub analysis: CurationAnalysis,
    pub actor: String,
    pub reason: String,
    pub provider_profile_id: Option<String>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationRunSummaryRecord {
    pub analysis: CurationSummary,
    #[serde(default)]
    pub term_candidates: Vec<CurationTermCandidate>,
    #[serde(default)]
    pub drift_groups: Vec<CurationDriftGroup>,
    #[serde(default)]
    pub apply_request_hash: Option<String>,
    #[serde(default)]
    pub apply_result: Option<CurationMutationResultRecord>,
    #[serde(default)]
    pub rollback_request_hash: Option<String>,
    #[serde(default)]
    pub rollback_result: Option<CurationMutationResultRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationRunRecord {
    pub id: String,
    pub project_id: String,
    pub library_id: String,
    pub status: CurationRunStatus,
    pub mode: CurationRunMode,
    pub policy: CurationPolicy,
    pub base_library_revision: u64,
    pub revision: u64,
    pub summary: CurationRunSummaryRecord,
    pub actor: String,
    pub reason: String,
    pub provider_profile_id: Option<String>,
    pub created_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationRunUnitRecord {
    pub run_id: String,
    pub library_id: String,
    pub unit_id: String,
    pub quality_score_basis_points: u16,
    pub recommended_action: CurationRecommendation,
    pub explanation: Vec<String>,
    pub unit_snapshot_hash: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationFindingRecord {
    pub id: String,
    pub run_id: String,
    pub library_id: String,
    pub unit_id: String,
    pub kind: CurationFindingKind,
    pub severity: CurationSeverity,
    pub disposition: CurationRecommendation,
    pub penalty_basis_points: u16,
    pub quality_score_basis_points: u16,
    pub canonical_unit_id: Option<String>,
    pub evidence: CurationEvidence,
    pub explanation: String,
    pub revision: u64,
    pub fingerprint: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationChangeRecord {
    pub id: String,
    pub run_id: String,
    pub finding_id: Option<String>,
    pub library_id: String,
    pub unit_id: String,
    pub action: CurationChangeAction,
    pub before: Value,
    pub after: Value,
    pub restored: bool,
    pub revision: u64,
    pub created_at_ms: i64,
    pub restored_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CurationChangeAction {
    Score,
    Quarantine,
}

#[derive(Debug, Clone)]
pub struct ApplyCuration {
    pub run_id: String,
    pub expected_run_revision: u64,
    pub expected_library_revision: u64,
    pub selected_finding_ids: Vec<String>,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RollbackCuration {
    pub run_id: String,
    pub expected_run_revision: u64,
    pub expected_library_revision: u64,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationMutationResultRecord {
    pub run_id: String,
    pub status: CurationRunStatus,
    pub run_revision: u64,
    pub library_id: String,
    pub library_revision: u64,
    pub changed_unit_count: u32,
    pub quarantined_unit_count: u32,
    pub restored_unit_count: u32,
    pub operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationDatasetSnapshot {
    pub run_id: String,
    pub run_revision: u64,
    pub library_id: String,
    pub library_revision: u64,
    pub units: Vec<DatasetUnit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssetCatalogKind {
    All,
    Tm,
    Termbase,
    Corpus,
}

#[derive(Debug, Clone)]
pub struct AssetCatalogFilter {
    pub project_id: Option<String>,
    pub kind: AssetCatalogKind,
    pub source_locale: Option<String>,
    pub target_locale: Option<String>,
    pub domain: Option<String>,
    pub origin_project_id: Option<String>,
    pub origin_document_id: Option<String>,
    pub created_after_ms: Option<i64>,
    pub created_before_ms: Option<i64>,
    pub query: Option<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCatalogItem {
    pub id: String,
    pub collection_id: String,
    pub collection_name: String,
    pub kind: AssetCatalogKind,
    pub source_locale: String,
    pub target_locale: Option<String>,
    pub domain: Option<String>,
    pub source_text: String,
    pub target_text: String,
    pub origin_project_id: Option<String>,
    pub origin_document_id: Option<String>,
    pub origin_segment_id: Option<String>,
    pub structural_path: Option<String>,
    pub quality_score_basis_points: Option<u16>,
    pub curation_state: Option<CurationState>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCatalogPage {
    pub items: Vec<AssetCatalogItem>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurationUnitProjection {
    #[serde(flatten)]
    unit: CurationUnit,
    source_hash: String,
    target_hash: String,
    context_before_hash: Option<String>,
    context_after_hash: Option<String>,
    updated_at_ms: i64,
    quality_score_basis_points: Option<u16>,
    curation_state: CurationState,
    curation_revision: u64,
    last_curated_run_id: Option<String>,
}

impl Store {
    pub fn load_curation_snapshot(
        &self,
        project_id: &str,
        library_id: &str,
    ) -> Result<CurationSnapshot> {
        find_project(&self.connection, project_id)?;
        let library = find_tm_library(&self.connection, library_id)?;
        let projections = list_curation_unit_projections(
            &self.connection,
            library_id,
            Some(CurationState::Active),
            MAX_UNITS_PER_RUN.saturating_add(1),
        )?;
        if projections.len() > MAX_UNITS_PER_RUN {
            return Err(StorageError::InvalidState(format!(
                "curation run exceeds the {MAX_UNITS_PER_RUN}-unit limit"
            )));
        }
        Ok(CurationSnapshot {
            project_id: project_id.to_string(),
            library,
            units: projections
                .into_iter()
                .map(|projection| projection.unit)
                .collect(),
        })
    }

    pub fn get_curation_run(&self, run_id: &str) -> Result<CurationRunRecord> {
        find_curation_run(&self.connection, run_id)
    }

    pub fn list_curation_run_units(
        &self,
        run_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<CurationRunUnitRecord>, u32)> {
        validate_page(offset, limit)?;
        find_curation_run(&self.connection, run_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM curation_run_units WHERE run_id = ?1",
            [run_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT run_id, library_id, unit_id, quality_score_basis_points,
                    recommended_action, explanation_json, unit_snapshot_hash,
                    created_at_ms
             FROM curation_run_units WHERE run_id = ?1
             ORDER BY created_at_ms, unit_id LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![run_id, i64::from(limit), i64::from(offset)],
                row_to_curation_run_unit,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn list_curation_findings(
        &self,
        run_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<CurationFindingRecord>, u32)> {
        validate_page(offset, limit)?;
        find_curation_run(&self.connection, run_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM curation_findings WHERE run_id = ?1",
            [run_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT f.id, f.run_id, f.library_id, f.unit_id, f.kind, f.severity,
                    f.disposition, f.score_basis_points,
                    u.quality_score_basis_points, f.canonical_unit_id,
                    f.evidence_json, f.explanation, f.revision, f.fingerprint,
                    f.created_at_ms, f.updated_at_ms
             FROM curation_findings f
             JOIN curation_run_units u
               ON u.run_id = f.run_id AND u.unit_id = f.unit_id
             WHERE f.run_id = ?1
             ORDER BY f.unit_id, f.kind, f.id LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![run_id, i64::from(limit), i64::from(offset)],
                row_to_curation_finding,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn list_curation_changes(&self, run_id: &str) -> Result<Vec<CurationChangeRecord>> {
        find_curation_run(&self.connection, run_id)?;
        list_curation_changes(&self.connection, run_id)
    }
}

impl Store {
    pub fn create_curation_run(&mut self, input: CreateCurationRun) -> Result<CurationRunRecord> {
        validate_actor_reason(&input.actor, &input.reason)?;
        if let Some(correlation_id) = input.correlation_id.as_deref() {
            validate_bounded_id("correlation ID", correlation_id, MAX_CORRELATION_ID_BYTES)?;
        }
        validate_analysis_shape(&input.analysis)?;
        if input.analysis.scores.len() > MAX_UNITS_PER_RUN {
            return Err(StorageError::InvalidState(format!(
                "curation run exceeds the {MAX_UNITS_PER_RUN}-unit limit"
            )));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        find_project(&transaction, &input.project_id)?;
        let library = find_tm_library(&transaction, &input.library_id)?;
        ensure_entity_revision(
            "tm_library",
            &input.library_id,
            library.revision,
            input.expected_library_revision,
        )?;

        let projections = list_curation_unit_projections(
            &transaction,
            &input.library_id,
            Some(CurationState::Active),
            MAX_UNITS_PER_RUN.saturating_add(1),
        )?;
        if projections.len() > MAX_UNITS_PER_RUN {
            return Err(StorageError::InvalidState(format!(
                "curation run exceeds the {MAX_UNITS_PER_RUN}-unit limit"
            )));
        }
        validate_analysis_against_snapshot(&input.analysis, &projections)?;

        let now = now_ms();
        let run_id = translunar_domain::new_id();
        let summary = CurationRunSummaryRecord {
            analysis: input.analysis.summary.clone(),
            term_candidates: input.analysis.term_candidates.clone(),
            drift_groups: input.analysis.drift_groups.clone(),
            apply_request_hash: None,
            apply_result: None,
            rollback_request_hash: None,
            rollback_result: None,
        };
        transaction.execute(
            "INSERT INTO curation_runs (
                id, project_id, library_id, status, mode, policy_json,
                base_library_revision, revision, summary_json, actor, reason,
                provider_profile_id, created_at_ms, completed_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6, 0, ?7, ?8, ?9,
                       ?10, ?11, ?11, ?11)",
            params![
                run_id,
                input.project_id,
                input.library_id,
                curation_run_mode_text(input.mode),
                serde_json::to_string(&input.policy)?,
                to_i64(input.expected_library_revision)?,
                serde_json::to_string(&summary)?,
                input.actor.trim(),
                input.reason.trim(),
                input.provider_profile_id,
                now,
            ],
        )?;

        let score_by_id = input
            .analysis
            .scores
            .iter()
            .map(|score| (score.unit_id.as_str(), score))
            .collect::<BTreeMap<_, _>>();
        for score in &input.analysis.scores {
            transaction.execute(
                "INSERT INTO curation_run_units (
                    run_id, library_id, unit_id, quality_score_basis_points,
                    recommended_action, explanation_json, unit_snapshot_hash,
                    created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    run_id,
                    input.library_id,
                    score.unit_id,
                    i64::from(score.quality_score_basis_points),
                    curation_recommendation_text(score.recommendation),
                    serde_json::to_string(&score.explanation)?,
                    score.unit_snapshot_hash,
                    now,
                ],
            )?;
        }
        for finding in &input.analysis.findings {
            if !score_by_id.contains_key(finding.unit_id.as_str()) {
                return Err(StorageError::InvalidData(format!(
                    "finding {} references an unknown score",
                    finding.fingerprint
                )));
            }
            let finding_id = curation_finding_id(&run_id, &finding.fingerprint);
            transaction.execute(
                "INSERT INTO curation_findings (
                    id, run_id, library_id, unit_id, kind, severity, disposition,
                    score_basis_points, canonical_unit_id, evidence_json,
                    explanation, revision, fingerprint, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           ?11, 0, ?12, ?13, ?13)",
                params![
                    finding_id,
                    run_id,
                    input.library_id,
                    finding.unit_id,
                    finding.kind.as_str(),
                    curation_severity_text(finding.severity),
                    curation_recommendation_text(finding.recommendation),
                    i64::from(finding.penalty_basis_points),
                    finding.canonical_unit_id,
                    serde_json::to_string(&finding.evidence)?,
                    finding.explanation,
                    finding.fingerprint,
                    now,
                ],
            )?;
        }
        let record = find_curation_run(&transaction, &run_id)?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn apply_curation(&mut self, input: ApplyCuration) -> Result<CurationMutationResultRecord> {
        validate_actor_reason(&input.actor, &input.reason)?;
        if let Some(correlation_id) = input.correlation_id.as_deref() {
            validate_bounded_id("correlation ID", correlation_id, MAX_CORRELATION_ID_BYTES)?;
        }
        if input.selected_finding_ids.is_empty() {
            return Err(StorageError::InvalidState(
                "curation apply requires at least one selected finding".to_string(),
            ));
        }
        if input.selected_finding_ids.len() > MAX_UNITS_PER_RUN {
            return Err(StorageError::InvalidState(format!(
                "curation apply exceeds the {MAX_UNITS_PER_RUN}-finding limit"
            )));
        }
        let mut selected_ids = input.selected_finding_ids.clone();
        selected_ids.sort();
        selected_ids.dedup();
        if selected_ids.len() != input.selected_finding_ids.len() {
            return Err(StorageError::InvalidState(
                "curation apply contains duplicate finding IDs".to_string(),
            ));
        }
        for id in &selected_ids {
            validate_bounded_id("finding ID", id, MAX_ID_BYTES)?;
        }
        let request_hash = request_hash(
            "apply",
            &input.run_id,
            input.expected_run_revision,
            input.expected_library_revision,
            &selected_ids,
            &input.actor,
            &input.reason,
        )?;

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut run = find_curation_run(&transaction, &input.run_id)?;
        if run.status == CurationRunStatus::Applied {
            if run.summary.apply_request_hash.as_deref() == Some(request_hash.as_str()) {
                return run.summary.apply_result.ok_or_else(|| {
                    StorageError::InvalidData(
                        "applied curation run has no terminal result".to_string(),
                    )
                });
            }
            return Err(StorageError::InvalidState(
                "curation run was already applied with a different request".to_string(),
            ));
        }
        if run.status != CurationRunStatus::Open {
            return Err(StorageError::InvalidState(
                "curation run is not open for apply".to_string(),
            ));
        }
        ensure_entity_revision(
            "curation_run",
            &input.run_id,
            run.revision,
            input.expected_run_revision,
        )?;
        let library = find_tm_library(&transaction, &run.library_id)?;
        ensure_entity_revision(
            "tm_library",
            &run.library_id,
            library.revision,
            input.expected_library_revision,
        )?;
        let selected = load_selected_findings(&transaction, &run, &selected_ids)?;
        let mut quarantine_units = BTreeSet::new();
        let mut finding_for_unit = BTreeMap::new();
        for finding in &selected {
            if finding.disposition == CurationRecommendation::Keep {
                return Err(StorageError::InvalidState(
                    "a keep finding cannot be selected for quarantine".to_string(),
                ));
            }
            quarantine_units.insert(finding.unit_id.clone());
            finding_for_unit
                .entry(finding.unit_id.clone())
                .or_insert_with(|| finding.id.clone());
        }

        let run_units = list_curation_unit_records_for_run(&transaction, &run.id)?;
        let current_projections = list_curation_unit_projections(
            &transaction,
            &run.library_id,
            Some(CurationState::Active),
            MAX_UNITS_PER_RUN.saturating_add(1),
        )?;
        let current_by_id = current_projections
            .into_iter()
            .map(|projection| (projection.unit.id.clone(), projection))
            .collect::<BTreeMap<_, _>>();
        let mut changed = 0_u32;
        let mut quarantined = 0_u32;
        let now = now_ms();
        for run_unit in &run_units {
            let current = current_by_id.get(&run_unit.unit_id).ok_or_else(|| {
                StorageError::EntityConflict {
                    entity: "tm_unit",
                    id: run_unit.unit_id.clone(),
                    expected_revision: 0,
                    actual_revision: 1,
                }
            })?;
            if unit_snapshot_hash(&current.unit) != run_unit.unit_snapshot_hash {
                return Err(StorageError::InvalidState(format!(
                    "TM unit {} changed since the curation snapshot",
                    run_unit.unit_id
                )));
            }
            let desired_state = if quarantine_units.contains(&run_unit.unit_id) {
                CurationState::Quarantined
            } else {
                CurationState::Active
            };
            let desired_revision = next_revision(current.curation_revision)?;
            let before = serde_json::to_value(current)?;
            let after = json!({
                "id": current.unit.id,
                "libraryId": current.unit.library_id,
                "sourceLocale": current.unit.source_locale,
                "targetLocale": current.unit.target_locale,
                "sourceText": current.unit.source_text,
                "targetText": current.unit.target_text,
                "sourceHash": current.source_hash,
                "targetHash": current.target_hash,
                "domain": current.unit.domain,
                "originProjectId": current.unit.origin_project_id,
                "originDocumentId": current.unit.origin_document_id,
                "originSegmentId": current.unit.origin_segment_id,
                "contextBeforeHash": current.context_before_hash,
                "contextAfterHash": current.context_after_hash,
                "author": current.unit.author,
                "metadata": current.unit.metadata,
                "createdAtMs": current.unit.created_at_ms,
                "updatedAtMs": current.updated_at_ms,
                "qualityScoreBasisPoints": run_unit.quality_score_basis_points,
                "curationState": curation_state_text(desired_state),
                "curationRevision": desired_revision,
                "lastCuratedRunId": run.id,
            });
            transaction.execute(
                "UPDATE tm_units
                 SET quality_score_basis_points = ?1, curation_state = ?2,
                     curation_revision = ?3, last_curated_run_id = ?4,
                     updated_at_ms = ?5
                 WHERE id = ?6 AND library_id = ?7 AND curation_revision = ?8",
                params![
                    i64::from(run_unit.quality_score_basis_points),
                    curation_state_text(desired_state),
                    to_i64(desired_revision)?,
                    run.id,
                    now,
                    run_unit.unit_id,
                    run.library_id,
                    to_i64(current.curation_revision)?,
                ],
            )?;
            let action = if desired_state == CurationState::Quarantined {
                quarantined = quarantined.checked_add(1).ok_or_else(|| {
                    StorageError::InvalidData("quarantine count overflow".to_string())
                })?;
                CurationChangeAction::Quarantine
            } else {
                CurationChangeAction::Score
            };
            transaction.execute(
                "INSERT INTO curation_changes (
                    id, run_id, finding_id, library_id, unit_id, action,
                    before_json, after_json, restored, revision, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9)",
                params![
                    translunar_domain::new_id(),
                    run.id,
                    finding_for_unit.get(&run_unit.unit_id),
                    run.library_id,
                    run_unit.unit_id,
                    curation_change_action_text(action),
                    serde_json::to_string(&before)?,
                    serde_json::to_string(&after)?,
                    now,
                ],
            )?;
            changed = changed.checked_add(1).ok_or_else(|| {
                StorageError::InvalidData("curation change count overflow".to_string())
            })?;
        }
        let next_library_revision = next_revision(library.revision)?;
        let updated = transaction.execute(
            "UPDATE tm_libraries SET revision = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                to_i64(next_library_revision)?,
                now,
                run.library_id,
                to_i64(library.revision)?,
            ],
        )?;
        if updated != 1 {
            return Err(StorageError::EntityConflict {
                entity: "tm_library",
                id: run.library_id.clone(),
                expected_revision: library.revision,
                actual_revision: find_tm_library(&transaction, &run.library_id)?.revision,
            });
        }
        let next_run_revision = next_revision(run.revision)?;
        let mut result = CurationMutationResultRecord {
            run_id: run.id.clone(),
            status: CurationRunStatus::Applied,
            run_revision: next_run_revision,
            library_id: run.library_id.clone(),
            library_revision: next_library_revision,
            changed_unit_count: changed,
            quarantined_unit_count: quarantined,
            restored_unit_count: 0,
            operation_id: String::new(),
        };
        let operation = append_operation(
            &transaction,
            &run.project_id,
            "curation_run",
            &run.id,
            "curation.apply",
            Some(run.revision),
            Some(next_run_revision),
            input.actor.trim(),
            input.correlation_id.as_deref(),
            Some(json!({
                "runId": run.id,
                "libraryRevision": library.revision,
                "selectedFindingIds": selected_ids,
            })),
            Some(serde_json::to_value(&result)?),
        )?;
        result.operation_id = operation.id;
        run.status = CurationRunStatus::Applied;
        run.revision = next_run_revision;
        run.summary.apply_request_hash = Some(request_hash);
        run.summary.apply_result = Some(result.clone());
        transaction.execute(
            "UPDATE curation_runs
             SET status = 'applied', revision = ?1, summary_json = ?2,
                 completed_at_ms = ?3, updated_at_ms = ?3
             WHERE id = ?4 AND revision = ?5",
            params![
                to_i64(next_run_revision)?,
                serde_json::to_string(&run.summary)?,
                now,
                run.id,
                to_i64(input.expected_run_revision)?,
            ],
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn rollback_curation(
        &mut self,
        input: RollbackCuration,
    ) -> Result<CurationMutationResultRecord> {
        validate_actor_reason(&input.actor, &input.reason)?;
        if let Some(correlation_id) = input.correlation_id.as_deref() {
            validate_bounded_id("correlation ID", correlation_id, MAX_CORRELATION_ID_BYTES)?;
        }
        let request_hash = request_hash(
            "rollback",
            &input.run_id,
            input.expected_run_revision,
            input.expected_library_revision,
            &[],
            &input.actor,
            &input.reason,
        )?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut run = find_curation_run(&transaction, &input.run_id)?;
        if run.status == CurationRunStatus::RolledBack {
            if run.summary.rollback_request_hash.as_deref() == Some(request_hash.as_str()) {
                return run.summary.rollback_result.ok_or_else(|| {
                    StorageError::InvalidData(
                        "rolled-back curation run has no terminal result".to_string(),
                    )
                });
            }
            return Err(StorageError::InvalidState(
                "curation run was already rolled back with a different request".to_string(),
            ));
        }
        if run.status != CurationRunStatus::Applied {
            return Err(StorageError::InvalidState(
                "only an applied curation run can be rolled back".to_string(),
            ));
        }
        ensure_entity_revision(
            "curation_run",
            &run.id,
            run.revision,
            input.expected_run_revision,
        )?;
        let library = find_tm_library(&transaction, &run.library_id)?;
        ensure_entity_revision(
            "tm_library",
            &run.library_id,
            library.revision,
            input.expected_library_revision,
        )?;
        let changes = list_curation_changes(&transaction, &run.id)?;
        let now = now_ms();
        let mut restored = 0_u32;
        for change in &changes {
            if change.restored {
                continue;
            }
            let after = parse_projection(&change.after)?;
            let current = find_curation_unit_projection(&transaction, &change.unit_id)?
                .ok_or_else(|| not_found("tm_unit", &change.unit_id))?;
            if current.curation_revision != after.curation_revision
                || current.unit.source_text != after.unit.source_text
                || current.unit.target_text != after.unit.target_text
                || current.quality_score_basis_points != after.quality_score_basis_points
                || current.curation_state != after.curation_state
                || current.last_curated_run_id != after.last_curated_run_id
            {
                return Err(StorageError::InvalidState(format!(
                    "TM unit {} changed after curation apply",
                    change.unit_id
                )));
            }
            let restored_revision = next_revision(current.curation_revision)?;
            let before = parse_projection(&change.before)?;
            transaction.execute(
                "UPDATE tm_units
                 SET quality_score_basis_points = ?1, curation_state = ?2,
                     curation_revision = ?3, last_curated_run_id = ?4,
                     updated_at_ms = ?5
                 WHERE id = ?6 AND curation_revision = ?7",
                params![
                    before.quality_score_basis_points.map(i64::from),
                    curation_state_text(before.curation_state),
                    to_i64(restored_revision)?,
                    before.last_curated_run_id,
                    now,
                    change.unit_id,
                    to_i64(current.curation_revision)?,
                ],
            )?;
            transaction.execute(
                "UPDATE curation_changes
                 SET restored = 1, revision = revision + 1, restored_at_ms = ?1
                 WHERE id = ?2 AND restored = 0",
                params![now, change.id],
            )?;
            restored = restored
                .checked_add(1)
                .ok_or_else(|| StorageError::InvalidData("restored count overflow".to_string()))?;
        }
        let next_library_revision = next_revision(library.revision)?;
        transaction.execute(
            "UPDATE tm_libraries SET revision = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                to_i64(next_library_revision)?,
                now,
                run.library_id,
                to_i64(library.revision)?,
            ],
        )?;
        let next_run_revision = next_revision(run.revision)?;
        let mut result = CurationMutationResultRecord {
            run_id: run.id.clone(),
            status: CurationRunStatus::RolledBack,
            run_revision: next_run_revision,
            library_id: run.library_id.clone(),
            library_revision: next_library_revision,
            changed_unit_count: 0,
            quarantined_unit_count: 0,
            restored_unit_count: restored,
            operation_id: String::new(),
        };
        let operation = append_operation(
            &transaction,
            &run.project_id,
            "curation_run",
            &run.id,
            "curation.rollback",
            Some(run.revision),
            Some(next_run_revision),
            input.actor.trim(),
            input.correlation_id.as_deref(),
            Some(json!({"runId": run.id, "libraryRevision": library.revision})),
            Some(serde_json::to_value(&result)?),
        )?;
        result.operation_id = operation.id;
        run.summary.rollback_request_hash = Some(request_hash);
        run.summary.rollback_result = Some(result.clone());
        transaction.execute(
            "UPDATE curation_runs
             SET status = 'rolled_back', revision = ?1, summary_json = ?2,
                 completed_at_ms = ?3, updated_at_ms = ?3
             WHERE id = ?4 AND revision = ?5",
            params![
                to_i64(next_run_revision)?,
                serde_json::to_string(&run.summary)?,
                now,
                run.id,
                to_i64(input.expected_run_revision)?,
            ],
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn export_curation_dataset(
        &self,
        run_id: &str,
        minimum_score_basis_points: Option<u16>,
    ) -> Result<CurationDatasetSnapshot> {
        let run = find_curation_run(&self.connection, run_id)?;
        if run.status == CurationRunStatus::Discarded {
            return Err(StorageError::InvalidState(
                "discarded curation runs cannot be exported".to_string(),
            ));
        }
        let library = find_tm_library(&self.connection, &run.library_id)?;
        let mut statement = self.connection.prepare(
            "SELECT u.id, u.source_locale, u.target_locale, u.source_text,
                    u.target_text, u.domain, u.origin_project_id,
                    u.origin_document_id, u.origin_segment_id,
                    ru.quality_score_basis_points
             FROM curation_run_units ru
             JOIN tm_units u ON u.id = ru.unit_id AND u.library_id = ru.library_id
             WHERE ru.run_id = ?1 AND u.curation_state = 'active'
               AND (?2 IS NULL OR ru.quality_score_basis_points >= ?2)
             ORDER BY u.created_at_ms, u.id
             LIMIT ?3",
        )?;
        let rows = statement
            .query_map(
                params![
                    run_id,
                    minimum_score_basis_points.map(i64::from),
                    i64::try_from(MAX_UNITS_PER_RUN).map_err(|_| StorageError::InvalidData(
                        "dataset limit overflow".to_string()
                    ))?,
                ],
                |row| {
                    Ok(DatasetUnit {
                        unit_id: row.get(0)?,
                        source_locale: row.get(1)?,
                        target_locale: row.get(2)?,
                        source_text: row.get(3)?,
                        target_text: row.get(4)?,
                        domain: row.get(5)?,
                        origin_project_id: row.get(6)?,
                        origin_document_id: row.get(7)?,
                        origin_segment_id: row.get(8)?,
                        quality_score_basis_points: read_u16(row, 9)?,
                    })
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(CurationDatasetSnapshot {
            run_id: run.id,
            run_revision: run.revision,
            library_id: run.library_id,
            library_revision: library.revision,
            units: rows,
        })
    }

    pub fn list_asset_catalog(&self, filter: &AssetCatalogFilter) -> Result<AssetCatalogPage> {
        validate_page(filter.offset, filter.limit)?;
        if let Some(project_id) = filter.project_id.as_deref() {
            find_project(&self.connection, project_id)?;
        }
        let query = filter
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let window_end = filter.offset.checked_add(filter.limit).ok_or_else(|| {
            StorageError::InvalidState("catalog page window overflow".to_string())
        })?;
        if window_end > MAX_CATALOG_WINDOW {
            return Err(StorageError::InvalidState(format!(
                "catalog page window exceeds the {MAX_CATALOG_WINDOW}-row limit"
            )));
        }
        let mut items = Vec::new();
        let mut total = 0_u32;
        if matches!(filter.kind, AssetCatalogKind::All | AssetCatalogKind::Tm) {
            let (rows, count) = list_tm_catalog_items(&self.connection, filter, query)?;
            items.extend(rows);
            total = total
                .checked_add(count)
                .ok_or_else(|| StorageError::InvalidData("catalog total overflow".to_string()))?;
        }
        if matches!(
            filter.kind,
            AssetCatalogKind::All | AssetCatalogKind::Termbase
        ) {
            let (rows, count) = list_term_catalog_items(&self.connection, filter, query)?;
            items.extend(rows);
            total = total
                .checked_add(count)
                .ok_or_else(|| StorageError::InvalidData("catalog total overflow".to_string()))?;
        }
        if matches!(
            filter.kind,
            AssetCatalogKind::All | AssetCatalogKind::Corpus
        ) {
            let (rows, count) = list_corpus_catalog_items(&self.connection, filter, query)?;
            items.extend(rows);
            total = total
                .checked_add(count)
                .ok_or_else(|| StorageError::InvalidData("catalog total overflow".to_string()))?;
        }
        items.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then_with(|| catalog_kind_rank(left.kind).cmp(&catalog_kind_rank(right.kind)))
                .then_with(|| left.collection_id.cmp(&right.collection_id))
                .then_with(|| left.id.cmp(&right.id))
        });
        let items = items
            .into_iter()
            .skip(usize::try_from(filter.offset).map_err(|_| {
                StorageError::InvalidData("catalog offset does not fit usize".to_string())
            })?)
            .take(usize::try_from(filter.limit).map_err(|_| {
                StorageError::InvalidData("catalog limit does not fit usize".to_string())
            })?)
            .collect();
        Ok(AssetCatalogPage {
            items,
            total,
            offset: filter.offset,
            limit: filter.limit,
        })
    }
}

fn validate_page(offset: u32, limit: u32) -> Result<()> {
    let _ = offset;
    if !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(StorageError::InvalidState(format!(
            "page limit must be between 1 and {MAX_PAGE_SIZE}"
        )));
    }
    Ok(())
}

fn validate_actor_reason(actor: &str, reason: &str) -> Result<()> {
    validate_bounded_nonempty("actor", actor, MAX_ACTOR_BYTES)?;
    // A reason is optional context, not a gate: curation runs, applies, and
    // rollbacks are already attributed and revision-guarded.
    if reason.len() > MAX_REASON_BYTES {
        return Err(StorageError::InvalidState(format!(
            "reason exceeds the {MAX_REASON_BYTES}-byte limit"
        )));
    }
    Ok(())
}

fn validate_bounded_nonempty(label: &str, value: &str, max_bytes: usize) -> Result<()> {
    require_nonempty(label, value)?;
    if value.len() > max_bytes {
        return Err(StorageError::InvalidState(format!(
            "{label} exceeds the {max_bytes}-byte limit"
        )));
    }
    Ok(())
}

fn validate_bounded_id(label: &str, value: &str, max_bytes: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max_bytes {
        return Err(StorageError::InvalidState(format!(
            "{label} is empty or exceeds the {max_bytes}-byte limit"
        )));
    }
    Ok(())
}

fn validate_analysis_shape(analysis: &CurationAnalysis) -> Result<()> {
    if analysis.scores.len() > MAX_UNITS_PER_RUN || analysis.findings.len() > MAX_UNITS_PER_RUN {
        return Err(StorageError::InvalidState(format!(
            "curation analysis exceeds the {MAX_UNITS_PER_RUN}-item limit"
        )));
    }
    if usize::try_from(analysis.summary.analyzed_units).ok() != Some(analysis.scores.len())
        || usize::try_from(analysis.summary.finding_count).ok() != Some(analysis.findings.len())
        || usize::try_from(analysis.summary.term_candidate_count).ok()
            != Some(analysis.term_candidates.len())
        || usize::try_from(analysis.summary.drift_group_count).ok()
            != Some(analysis.drift_groups.len())
    {
        return Err(StorageError::InvalidData(
            "curation analysis summary does not match its rows".to_string(),
        ));
    }
    let mut score_ids = BTreeSet::new();
    for score in &analysis.scores {
        if !score_ids.insert(score.unit_id.as_str()) {
            return Err(StorageError::InvalidData(
                "curation analysis contains duplicate score IDs".to_string(),
            ));
        }
        if score.quality_score_basis_points > 10_000 {
            return Err(StorageError::InvalidData(
                "curation score exceeds 10000".to_string(),
            ));
        }
    }
    let mut fingerprints = BTreeSet::new();
    for finding in &analysis.findings {
        if !score_ids.contains(finding.unit_id.as_str()) {
            return Err(StorageError::InvalidData(format!(
                "finding {} references an unknown unit",
                finding.fingerprint
            )));
        }
        if !fingerprints.insert(finding.fingerprint.as_str()) {
            return Err(StorageError::InvalidData(
                "curation analysis contains duplicate finding fingerprints".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_analysis_against_snapshot(
    analysis: &CurationAnalysis,
    projections: &[CurationUnitProjection],
) -> Result<()> {
    let by_id = projections
        .iter()
        .map(|projection| (projection.unit.id.as_str(), projection))
        .collect::<BTreeMap<_, _>>();
    if by_id.len() != analysis.scores.len() {
        return Err(StorageError::InvalidState(
            "TM library changed while curation analysis was running".to_string(),
        ));
    }
    for score in &analysis.scores {
        let projection = by_id.get(score.unit_id.as_str()).ok_or_else(|| {
            StorageError::InvalidState(format!(
                "curation analysis contains unknown TM unit {}",
                score.unit_id
            ))
        })?;
        if unit_snapshot_hash(&projection.unit) != score.unit_snapshot_hash {
            return Err(StorageError::InvalidState(format!(
                "TM unit {} changed while curation analysis was running",
                score.unit_id
            )));
        }
    }
    Ok(())
}

fn request_hash(
    action: &str,
    run_id: &str,
    run_revision: u64,
    library_revision: u64,
    finding_ids: &[String],
    actor: &str,
    reason: &str,
) -> Result<String> {
    let payload = serde_json::to_vec(&json!({
        "action": action,
        "runId": run_id,
        "runRevision": run_revision,
        "libraryRevision": library_revision,
        "findingIds": finding_ids,
        "actor": actor.trim(),
        "reason": reason.trim(),
    }))?;
    Ok(format!("{:x}", Sha256::digest(payload)))
}

fn curation_finding_id(run_id: &str, fingerprint: &str) -> String {
    format!("{run_id}:{fingerprint}")
}

fn list_curation_unit_projections(
    connection: &Connection,
    library_id: &str,
    state: Option<CurationState>,
    limit: usize,
) -> Result<Vec<CurationUnitProjection>> {
    let mut statement = connection.prepare(
        "SELECT id, library_id, source_locale, target_locale, source_text,
                target_text, source_hash, target_hash, domain, origin_project_id,
                origin_document_id, origin_segment_id, context_before_hash,
                context_after_hash, author, metadata_json, created_at_ms,
                updated_at_ms, quality_score_basis_points, curation_state,
                curation_revision, last_curated_run_id
         FROM tm_units
         WHERE library_id = ?1 AND (?2 IS NULL OR curation_state = ?2)
         ORDER BY created_at_ms, id LIMIT ?3",
    )?;
    let rows = statement
        .query_map(
            params![
                library_id,
                state.map(curation_state_text),
                i64::try_from(limit).map_err(|_| StorageError::InvalidData(
                    "curation limit overflow".to_string()
                ))?,
            ],
            row_to_curation_projection,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn find_curation_unit_projection(
    connection: &Connection,
    unit_id: &str,
) -> Result<Option<CurationUnitProjection>> {
    let mut statement = connection.prepare(
        "SELECT id, library_id, source_locale, target_locale, source_text,
                target_text, source_hash, target_hash, domain, origin_project_id,
                origin_document_id, origin_segment_id, context_before_hash,
                context_after_hash, author, metadata_json, created_at_ms,
                updated_at_ms, quality_score_basis_points, curation_state,
                curation_revision, last_curated_run_id
         FROM tm_units WHERE id = ?1",
    )?;
    statement
        .query_row([unit_id], row_to_curation_projection)
        .optional()
        .map_err(Into::into)
}

fn list_curation_unit_records_for_run(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<CurationRunUnitRecord>> {
    let mut statement = connection.prepare(
        "SELECT run_id, library_id, unit_id, quality_score_basis_points,
                recommended_action, explanation_json, unit_snapshot_hash,
                created_at_ms
         FROM curation_run_units WHERE run_id = ?1
         ORDER BY created_at_ms, unit_id",
    )?;
    statement
        .query_map([run_id], row_to_curation_run_unit)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn list_curation_changes(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<CurationChangeRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, run_id, finding_id, library_id, unit_id, action,
                before_json, after_json, restored, revision, created_at_ms,
                restored_at_ms
         FROM curation_changes WHERE run_id = ?1
         ORDER BY created_at_ms, id",
    )?;
    statement
        .query_map([run_id], row_to_curation_change)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn load_selected_findings(
    connection: &Connection,
    run: &CurationRunRecord,
    ids: &[String],
) -> Result<Vec<CurationFindingRecord>> {
    let mut selected = Vec::with_capacity(ids.len());
    for id in ids {
        let finding = connection
            .query_row(
                "SELECT f.id, f.run_id, f.library_id, f.unit_id, f.kind, f.severity,
                        f.disposition, f.score_basis_points,
                        u.quality_score_basis_points, f.canonical_unit_id,
                        f.evidence_json, f.explanation, f.revision, f.fingerprint,
                        f.created_at_ms, f.updated_at_ms
                 FROM curation_findings f
                 JOIN curation_run_units u
                   ON u.run_id = f.run_id AND u.unit_id = f.unit_id
                 WHERE f.id = ?1 AND f.run_id = ?2",
                params![id, run.id],
                row_to_curation_finding,
            )
            .optional()?
            .ok_or_else(|| not_found("curation_finding", id))?;
        selected.push(finding);
    }
    Ok(selected)
}

fn parse_projection(value: &Value) -> Result<CurationUnitProjection> {
    serde_json::from_value(value.clone()).map_err(StorageError::from)
}

fn find_curation_run(connection: &Connection, run_id: &str) -> Result<CurationRunRecord> {
    connection
        .query_row(
            "SELECT id, project_id, library_id, status, mode, policy_json,
                    base_library_revision, revision, summary_json, actor, reason,
                    provider_profile_id, created_at_ms, completed_at_ms, updated_at_ms
             FROM curation_runs WHERE id = ?1",
            [run_id],
            row_to_curation_run,
        )
        .optional()?
        .ok_or_else(|| not_found("curation_run", run_id))
}

fn row_to_curation_run(row: &Row<'_>) -> rusqlite::Result<CurationRunRecord> {
    Ok(CurationRunRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        library_id: row.get(2)?,
        status: parse_curation_run_status(row.get::<_, String>(3)?, 3)?,
        mode: parse_curation_run_mode(row.get::<_, String>(4)?, 4)?,
        policy: read_json(row, 5)?,
        base_library_revision: read_u64(row, 6)?,
        revision: read_u64(row, 7)?,
        summary: read_json(row, 8)?,
        actor: row.get(9)?,
        reason: row.get(10)?,
        provider_profile_id: row.get(11)?,
        created_at_ms: row.get(12)?,
        completed_at_ms: row.get(13)?,
        updated_at_ms: row.get(14)?,
    })
}

fn row_to_curation_run_unit(row: &Row<'_>) -> rusqlite::Result<CurationRunUnitRecord> {
    Ok(CurationRunUnitRecord {
        run_id: row.get(0)?,
        library_id: row.get(1)?,
        unit_id: row.get(2)?,
        quality_score_basis_points: read_u16(row, 3)?,
        recommended_action: parse_curation_recommendation(row.get::<_, String>(4)?, 4)?,
        explanation: read_json(row, 5)?,
        unit_snapshot_hash: row.get(6)?,
        created_at_ms: row.get(7)?,
    })
}

fn row_to_curation_finding(row: &Row<'_>) -> rusqlite::Result<CurationFindingRecord> {
    Ok(CurationFindingRecord {
        id: row.get(0)?,
        run_id: row.get(1)?,
        library_id: row.get(2)?,
        unit_id: row.get(3)?,
        kind: parse_curation_finding_kind(row.get::<_, String>(4)?, 4)?,
        severity: parse_curation_severity(row.get::<_, String>(5)?, 5)?,
        disposition: parse_curation_recommendation(row.get::<_, String>(6)?, 6)?,
        penalty_basis_points: read_u16(row, 7)?,
        quality_score_basis_points: read_u16(row, 8)?,
        canonical_unit_id: row.get(9)?,
        evidence: read_json(row, 10)?,
        explanation: row.get(11)?,
        revision: read_u64(row, 12)?,
        fingerprint: row.get(13)?,
        created_at_ms: row.get(14)?,
        updated_at_ms: row.get(15)?,
    })
}

fn row_to_curation_change(row: &Row<'_>) -> rusqlite::Result<CurationChangeRecord> {
    Ok(CurationChangeRecord {
        id: row.get(0)?,
        run_id: row.get(1)?,
        finding_id: row.get(2)?,
        library_id: row.get(3)?,
        unit_id: row.get(4)?,
        action: parse_curation_change_action(row.get::<_, String>(5)?, 5)?,
        before: read_json(row, 6)?,
        after: read_json(row, 7)?,
        restored: row.get(8)?,
        revision: read_u64(row, 9)?,
        created_at_ms: row.get(10)?,
        restored_at_ms: row.get(11)?,
    })
}

fn row_to_curation_projection(row: &Row<'_>) -> rusqlite::Result<CurationUnitProjection> {
    Ok(CurationUnitProjection {
        unit: CurationUnit {
            id: row.get(0)?,
            library_id: row.get(1)?,
            source_locale: row.get(2)?,
            target_locale: row.get(3)?,
            source_text: row.get(4)?,
            target_text: row.get(5)?,
            domain: row.get(8)?,
            origin_project_id: row.get(9)?,
            origin_document_id: row.get(10)?,
            origin_segment_id: row.get(11)?,
            author: row.get(14)?,
            metadata: read_json(row, 15)?,
            created_at_ms: row.get(16)?,
        },
        source_hash: row.get(6)?,
        target_hash: row.get(7)?,
        context_before_hash: row.get(12)?,
        context_after_hash: row.get(13)?,
        updated_at_ms: row.get(17)?,
        quality_score_basis_points: read_optional_u16(row, 18)?,
        curation_state: parse_curation_state(row.get::<_, String>(19)?, 19)?,
        curation_revision: read_u64(row, 20)?,
        last_curated_run_id: row.get(21)?,
    })
}

fn read_u16(row: &Row<'_>, column: usize) -> rusqlite::Result<u16> {
    let value = row.get::<_, i64>(column)?;
    u16::try_from(value).map_err(|error| conversion_error(column, error))
}

fn read_optional_u16(row: &Row<'_>, column: usize) -> rusqlite::Result<Option<u16>> {
    row.get::<_, Option<i64>>(column)?
        .map(|value| u16::try_from(value).map_err(|error| conversion_error(column, error)))
        .transpose()
}

fn invalid_enum<T>(column: usize, label: &str, value: String) -> rusqlite::Result<T> {
    Err(conversion_error(
        column,
        StorageError::InvalidData(format!("unknown {label} {value}")),
    ))
}

fn curation_run_mode_text(mode: CurationRunMode) -> &'static str {
    match mode {
        CurationRunMode::Offline => "offline",
        CurationRunMode::Provider => "provider",
    }
}

fn parse_curation_run_mode(value: String, column: usize) -> rusqlite::Result<CurationRunMode> {
    match value.as_str() {
        "offline" => Ok(CurationRunMode::Offline),
        "provider" => Ok(CurationRunMode::Provider),
        _ => invalid_enum(column, "curation run mode", value),
    }
}

fn parse_curation_run_status(value: String, column: usize) -> rusqlite::Result<CurationRunStatus> {
    match value.as_str() {
        "open" => Ok(CurationRunStatus::Open),
        "applied" => Ok(CurationRunStatus::Applied),
        "rolled_back" => Ok(CurationRunStatus::RolledBack),
        "discarded" => Ok(CurationRunStatus::Discarded),
        _ => invalid_enum(column, "curation run status", value),
    }
}

fn curation_state_text(state: CurationState) -> &'static str {
    match state {
        CurationState::Active => "active",
        CurationState::Quarantined => "quarantined",
    }
}

fn parse_curation_state(value: String, column: usize) -> rusqlite::Result<CurationState> {
    match value.as_str() {
        "active" => Ok(CurationState::Active),
        "quarantined" => Ok(CurationState::Quarantined),
        _ => invalid_enum(column, "curation state", value),
    }
}

fn curation_recommendation_text(recommendation: CurationRecommendation) -> &'static str {
    match recommendation {
        CurationRecommendation::Keep => "keep",
        CurationRecommendation::Review => "review",
        CurationRecommendation::Quarantine => "quarantine",
    }
}

fn parse_curation_recommendation(
    value: String,
    column: usize,
) -> rusqlite::Result<CurationRecommendation> {
    match value.as_str() {
        "keep" => Ok(CurationRecommendation::Keep),
        "review" => Ok(CurationRecommendation::Review),
        "quarantine" => Ok(CurationRecommendation::Quarantine),
        _ => invalid_enum(column, "curation recommendation", value),
    }
}

fn curation_severity_text(severity: CurationSeverity) -> &'static str {
    match severity {
        CurationSeverity::Info => "info",
        CurationSeverity::Warning => "warning",
        CurationSeverity::Error => "error",
    }
}

fn parse_curation_severity(value: String, column: usize) -> rusqlite::Result<CurationSeverity> {
    match value.as_str() {
        "info" => Ok(CurationSeverity::Info),
        "warning" => Ok(CurationSeverity::Warning),
        "error" => Ok(CurationSeverity::Error),
        _ => invalid_enum(column, "curation severity", value),
    }
}

fn parse_curation_finding_kind(
    value: String,
    column: usize,
) -> rusqlite::Result<CurationFindingKind> {
    match value.as_str() {
        "exact-duplicate" => Ok(CurationFindingKind::ExactDuplicate),
        "near-duplicate" => Ok(CurationFindingKind::NearDuplicate),
        "competing-translation" => Ok(CurationFindingKind::CompetingTranslation),
        "source-equals-target" => Ok(CurationFindingKind::SourceEqualsTarget),
        "minimum-length" => Ok(CurationFindingKind::MinimumLength),
        "length-ratio" => Ok(CurationFindingKind::LengthRatio),
        "number-mismatch" => Ok(CurationFindingKind::NumberMismatch),
        "date-mismatch" => Ok(CurationFindingKind::DateMismatch),
        "placeholder-mismatch" => Ok(CurationFindingKind::PlaceholderMismatch),
        "created-outside-range" => Ok(CurationFindingKind::CreatedOutsideRange),
        "likely-wrong-language" => Ok(CurationFindingKind::LikelyWrongLanguage),
        "semantic-mismatch" => Ok(CurationFindingKind::SemanticMismatch),
        _ => invalid_enum(column, "curation finding kind", value),
    }
}

fn curation_change_action_text(action: CurationChangeAction) -> &'static str {
    match action {
        CurationChangeAction::Score => "score",
        CurationChangeAction::Quarantine => "quarantine",
    }
}

fn parse_curation_change_action(
    value: String,
    column: usize,
) -> rusqlite::Result<CurationChangeAction> {
    match value.as_str() {
        "score" => Ok(CurationChangeAction::Score),
        "quarantine" => Ok(CurationChangeAction::Quarantine),
        _ => invalid_enum(column, "curation change action", value),
    }
}

fn catalog_kind_rank(kind: AssetCatalogKind) -> u8 {
    match kind {
        AssetCatalogKind::All => 0,
        AssetCatalogKind::Tm => 1,
        AssetCatalogKind::Termbase => 2,
        AssetCatalogKind::Corpus => 3,
    }
}

fn bounded_catalog_text(value: String) -> String {
    value.chars().take(MAX_CATALOG_TEXT_CHARS).collect()
}

fn catalog_window(filter: &AssetCatalogFilter) -> Result<i64> {
    let value = filter
        .offset
        .checked_add(filter.limit)
        .ok_or_else(|| StorageError::InvalidState("catalog page window overflow".to_string()))?;
    Ok(i64::from(value))
}

fn list_tm_catalog_items(
    connection: &Connection,
    filter: &AssetCatalogFilter,
    query: Option<&str>,
) -> Result<(Vec<AssetCatalogItem>, u32)> {
    let count = connection.query_row(
        "SELECT COUNT(*)
         FROM tm_units u JOIN tm_libraries l ON l.id = u.library_id
         WHERE (?1 IS NULL OR l.owner_project_id = ?1 OR EXISTS (
                    SELECT 1 FROM tm_library_mounts m
                    WHERE m.library_id = u.library_id AND m.project_id = ?1 AND m.enabled = 1
               ))
           AND (?2 IS NULL OR u.source_locale = ?2)
           AND (?3 IS NULL OR u.target_locale = ?3)
           AND (?4 IS NULL OR u.domain = ?4)
           AND (?5 IS NULL OR u.origin_project_id = ?5)
           AND (?6 IS NULL OR u.origin_document_id = ?6)
           AND (?7 IS NULL OR u.created_at_ms >= ?7)
           AND (?8 IS NULL OR u.created_at_ms <= ?8)
           AND (?9 IS NULL OR instr(lower(u.source_text), lower(?9)) > 0
                OR instr(lower(u.target_text), lower(?9)) > 0)",
        params![
            filter.project_id,
            filter.source_locale,
            filter.target_locale,
            filter.domain,
            filter.origin_project_id,
            filter.origin_document_id,
            filter.created_after_ms,
            filter.created_before_ms,
            query,
        ],
        |row| row.get::<_, i64>(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT u.id, u.library_id, l.name, u.source_locale, u.target_locale,
                u.domain, u.source_text, u.target_text, u.origin_project_id,
                u.origin_document_id, u.origin_segment_id,
                u.quality_score_basis_points, u.curation_state,
                u.created_at_ms, u.updated_at_ms
         FROM tm_units u JOIN tm_libraries l ON l.id = u.library_id
         WHERE (?1 IS NULL OR l.owner_project_id = ?1 OR EXISTS (
                    SELECT 1 FROM tm_library_mounts m
                    WHERE m.library_id = u.library_id AND m.project_id = ?1 AND m.enabled = 1
               ))
           AND (?2 IS NULL OR u.source_locale = ?2)
           AND (?3 IS NULL OR u.target_locale = ?3)
           AND (?4 IS NULL OR u.domain = ?4)
           AND (?5 IS NULL OR u.origin_project_id = ?5)
           AND (?6 IS NULL OR u.origin_document_id = ?6)
           AND (?7 IS NULL OR u.created_at_ms >= ?7)
           AND (?8 IS NULL OR u.created_at_ms <= ?8)
           AND (?9 IS NULL OR instr(lower(u.source_text), lower(?9)) > 0
                OR instr(lower(u.target_text), lower(?9)) > 0)
         ORDER BY u.created_at_ms, u.library_id, u.id
         LIMIT ?10",
    )?;
    let rows = statement
        .query_map(
            params![
                filter.project_id,
                filter.source_locale,
                filter.target_locale,
                filter.domain,
                filter.origin_project_id,
                filter.origin_document_id,
                filter.created_after_ms,
                filter.created_before_ms,
                query,
                catalog_window(filter)?,
            ],
            |row| {
                Ok(AssetCatalogItem {
                    id: row.get(0)?,
                    collection_id: row.get(1)?,
                    collection_name: row.get(2)?,
                    kind: AssetCatalogKind::Tm,
                    source_locale: row.get(3)?,
                    target_locale: row.get(4)?,
                    domain: row.get(5)?,
                    source_text: bounded_catalog_text(row.get(6)?),
                    target_text: bounded_catalog_text(row.get(7)?),
                    origin_project_id: row.get(8)?,
                    origin_document_id: row.get(9)?,
                    origin_segment_id: row.get(10)?,
                    structural_path: None,
                    quality_score_basis_points: read_optional_u16(row, 11)?,
                    curation_state: Some(parse_curation_state(row.get::<_, String>(12)?, 12)?),
                    created_at_ms: row.get(13)?,
                    updated_at_ms: row.get(14)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((rows, to_u32(count)?))
}

fn list_term_catalog_items(
    connection: &Connection,
    filter: &AssetCatalogFilter,
    query: Option<&str>,
) -> Result<(Vec<AssetCatalogItem>, u32)> {
    if filter.origin_project_id.is_some() || filter.origin_document_id.is_some() {
        return Ok((Vec::new(), 0));
    }
    let count = connection.query_row(
        "SELECT COUNT(*)
         FROM term_entries e JOIN termbases t ON t.id = e.termbase_id
         WHERE (?1 IS NULL OR EXISTS (
                    SELECT 1 FROM termbase_mounts m
                    WHERE m.termbase_id = e.termbase_id AND m.project_id = ?1 AND m.enabled = 1
               ))
           AND (?2 IS NULL OR e.source_locale = ?2)
           AND (?3 IS NULL OR e.domain = ?3)
           AND (?4 IS NULL OR e.created_at_ms >= ?4)
           AND (?5 IS NULL OR e.created_at_ms <= ?5)
           AND (?6 IS NULL OR EXISTS (
                    SELECT 1 FROM term_translations q
                    WHERE q.entry_id = e.id AND q.locale = ?6
               ))
           AND (?7 IS NULL OR instr(lower(e.source_term), lower(?7)) > 0 OR EXISTS (
                    SELECT 1 FROM term_translations q
                    WHERE q.entry_id = e.id AND instr(lower(q.term), lower(?7)) > 0
               ))",
        params![
            filter.project_id,
            filter.source_locale,
            filter.domain,
            filter.created_after_ms,
            filter.created_before_ms,
            filter.target_locale,
            query,
        ],
        |row| row.get::<_, i64>(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT e.id, e.termbase_id, t.name, e.source_locale, e.domain,
                e.source_term,
                COALESCE((SELECT q.term FROM term_translations q
                          WHERE q.entry_id = e.id
                          ORDER BY (q.locale = ?6) DESC, q.preferred DESC,
                                   q.forbidden ASC, q.locale, q.id LIMIT 1), ''),
                (SELECT q.locale FROM term_translations q
                 WHERE q.entry_id = e.id
                 ORDER BY (q.locale = ?6) DESC, q.preferred DESC,
                          q.forbidden ASC, q.locale, q.id LIMIT 1),
                e.created_at_ms, e.updated_at_ms
         FROM term_entries e JOIN termbases t ON t.id = e.termbase_id
         WHERE (?1 IS NULL OR EXISTS (
                    SELECT 1 FROM termbase_mounts m
                    WHERE m.termbase_id = e.termbase_id AND m.project_id = ?1 AND m.enabled = 1
               ))
           AND (?2 IS NULL OR e.source_locale = ?2)
           AND (?3 IS NULL OR e.domain = ?3)
           AND (?4 IS NULL OR e.created_at_ms >= ?4)
           AND (?5 IS NULL OR e.created_at_ms <= ?5)
           AND (?6 IS NULL OR EXISTS (
                    SELECT 1 FROM term_translations q
                    WHERE q.entry_id = e.id AND q.locale = ?6
               ))
           AND (?7 IS NULL OR instr(lower(e.source_term), lower(?7)) > 0 OR EXISTS (
                    SELECT 1 FROM term_translations q
                    WHERE q.entry_id = e.id AND instr(lower(q.term), lower(?7)) > 0
               ))
         ORDER BY e.created_at_ms, e.termbase_id, e.id
         LIMIT ?8",
    )?;
    let rows = statement
        .query_map(
            params![
                filter.project_id,
                filter.source_locale,
                filter.domain,
                filter.created_after_ms,
                filter.created_before_ms,
                filter.target_locale,
                query,
                catalog_window(filter)?,
            ],
            |row| {
                Ok(AssetCatalogItem {
                    id: row.get(0)?,
                    collection_id: row.get(1)?,
                    collection_name: row.get(2)?,
                    kind: AssetCatalogKind::Termbase,
                    source_locale: row.get(3)?,
                    target_locale: row.get(7)?,
                    domain: row.get(4)?,
                    source_text: bounded_catalog_text(row.get(5)?),
                    target_text: bounded_catalog_text(row.get(6)?),
                    origin_project_id: None,
                    origin_document_id: None,
                    origin_segment_id: None,
                    structural_path: None,
                    quality_score_basis_points: None,
                    curation_state: None,
                    created_at_ms: row.get(8)?,
                    updated_at_ms: row.get(9)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((rows, to_u32(count)?))
}

fn list_corpus_catalog_items(
    connection: &Connection,
    filter: &AssetCatalogFilter,
    query: Option<&str>,
) -> Result<(Vec<AssetCatalogItem>, u32)> {
    let count = connection.query_row(
        "SELECT COUNT(*)
         FROM reference_corpus_entries e
         JOIN reference_corpora c ON c.id = e.corpus_id
         JOIN projects p ON p.id = c.project_id
         WHERE c.status = 'active'
           AND (?1 IS NULL OR c.project_id = ?1)
           AND (?2 IS NULL OR c.source_locale = ?2)
           AND (?3 IS NULL OR c.target_locale = ?3)
           AND (?4 IS NULL OR p.domain = ?4)
           AND (?5 IS NULL OR c.project_id = ?5)
           AND (?6 IS NULL OR c.source_document_id = ?6 OR c.target_document_id = ?6)
           AND (?7 IS NULL OR e.created_at_ms >= ?7)
           AND (?8 IS NULL OR e.created_at_ms <= ?8)
           AND (?9 IS NULL OR instr(lower(e.source_text), lower(?9)) > 0
                OR instr(lower(e.target_text), lower(?9)) > 0)",
        params![
            filter.project_id,
            filter.source_locale,
            filter.target_locale,
            filter.domain,
            filter.origin_project_id,
            filter.origin_document_id,
            filter.created_after_ms,
            filter.created_before_ms,
            query,
        ],
        |row| row.get::<_, i64>(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT e.id, e.corpus_id, c.name, c.source_locale, c.target_locale,
                p.domain, e.source_text, e.target_text, c.project_id,
                c.source_document_id, e.structural_path, e.created_at_ms,
                e.updated_at_ms
         FROM reference_corpus_entries e
         JOIN reference_corpora c ON c.id = e.corpus_id
         JOIN projects p ON p.id = c.project_id
         WHERE c.status = 'active'
           AND (?1 IS NULL OR c.project_id = ?1)
           AND (?2 IS NULL OR c.source_locale = ?2)
           AND (?3 IS NULL OR c.target_locale = ?3)
           AND (?4 IS NULL OR p.domain = ?4)
           AND (?5 IS NULL OR c.project_id = ?5)
           AND (?6 IS NULL OR c.source_document_id = ?6 OR c.target_document_id = ?6)
           AND (?7 IS NULL OR e.created_at_ms >= ?7)
           AND (?8 IS NULL OR e.created_at_ms <= ?8)
           AND (?9 IS NULL OR instr(lower(e.source_text), lower(?9)) > 0
                OR instr(lower(e.target_text), lower(?9)) > 0)
         ORDER BY e.created_at_ms, e.corpus_id, e.id
         LIMIT ?10",
    )?;
    let rows = statement
        .query_map(
            params![
                filter.project_id,
                filter.source_locale,
                filter.target_locale,
                filter.domain,
                filter.origin_project_id,
                filter.origin_document_id,
                filter.created_after_ms,
                filter.created_before_ms,
                query,
                catalog_window(filter)?,
            ],
            |row| {
                Ok(AssetCatalogItem {
                    id: row.get(0)?,
                    collection_id: row.get(1)?,
                    collection_name: row.get(2)?,
                    kind: AssetCatalogKind::Corpus,
                    source_locale: row.get(3)?,
                    target_locale: row.get(4)?,
                    domain: row.get(5)?,
                    source_text: bounded_catalog_text(row.get(6)?),
                    target_text: bounded_catalog_text(row.get(7)?),
                    origin_project_id: row.get(8)?,
                    origin_document_id: row.get(9)?,
                    origin_segment_id: None,
                    structural_path: Some(row.get(10)?),
                    quality_score_basis_points: None,
                    curation_state: None,
                    created_at_ms: row.get(11)?,
                    updated_at_ms: row.get(12)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((rows, to_u32(count)?))
}

#[cfg(test)]
mod tests;
