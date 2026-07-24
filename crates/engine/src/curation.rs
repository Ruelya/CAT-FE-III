use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use translunar_curation_core::{DatasetUnit, analyze, render_dataset_jsonl, render_dataset_tsv};
use translunar_protocol as protocol;
use translunar_storage as storage;

use crate::{EngineError, EngineService, Result, bounded_page_size, publish_asset_file};

impl EngineService {
    pub fn list_asset_catalog(
        &self,
        params: protocol::AssetCatalogListParams,
    ) -> Result<protocol::AssetCatalogPage> {
        let limit = bounded_page_size(params.limit)?;
        validate_time_range(params.created_after_ms, params.created_before_ms)?;
        let page = self
            .store
            .list_asset_catalog(&storage::AssetCatalogFilter {
                project_id: params.project_id,
                kind: storage_asset_catalog_kind(params.kind),
                source_locale: params.source_locale,
                target_locale: params.target_locale,
                domain: params.domain,
                origin_project_id: params.origin_project_id,
                origin_document_id: params.origin_document_id,
                created_after_ms: params.created_after_ms,
                created_before_ms: params.created_before_ms,
                query: params.query,
                offset: params.offset,
                limit,
            })?;
        Ok(protocol::AssetCatalogPage {
            items: page
                .items
                .into_iter()
                .map(protocol_asset_catalog_item)
                .collect(),
            total: page.total,
            offset: page.offset,
            limit: page.limit,
        })
    }

    pub fn run_curation(
        &mut self,
        params: protocol::CurationRunParams,
    ) -> Result<protocol::CurationRunSnapshot> {
        let limit = bounded_page_size(params.limit)?;
        let snapshot = self
            .store
            .load_curation_snapshot(&params.project_id, &params.library_id)?;
        ensure_revision(
            "tm_library",
            &snapshot.library.id,
            params.expected_library_revision,
            snapshot.library.revision,
        )?;
        let policy = translunar_curation_core::CurationPolicy::from(params.policy);
        let (mode, annotations) = if let Some(profile_id) = params.provider_profile_id.as_deref() {
            (
                storage::CurationRunMode::Provider,
                self.curation_semantic_annotations(profile_id, &snapshot.units)?,
            )
        } else {
            (storage::CurationRunMode::Offline, Vec::new())
        };
        let analysis = analyze(&snapshot.units, &policy, &annotations)?;
        let run = self.store.create_curation_run(storage::CreateCurationRun {
            project_id: params.project_id,
            library_id: params.library_id,
            expected_library_revision: params.expected_library_revision,
            mode,
            policy,
            analysis,
            actor: params.actor,
            reason: params.reason,
            provider_profile_id: params.provider_profile_id,
            correlation_id: params.correlation_id,
        })?;
        self.curation_run_snapshot(run, params.offset, limit)
    }

    pub fn get_curation_run(
        &self,
        params: protocol::CurationRunIdParams,
    ) -> Result<protocol::CurationRunSnapshot> {
        let limit = bounded_page_size(params.limit)?;
        let run = self.store.get_curation_run(&params.run_id)?;
        self.curation_run_snapshot(run, params.offset, limit)
    }

    pub fn list_curation_findings(
        &self,
        params: protocol::CurationFindingListParams,
    ) -> Result<protocol::CurationFindingPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_curation_findings(&params.run_id, params.offset, limit)?;
        Ok(protocol::CurationFindingPage {
            items: items.into_iter().map(protocol_curation_finding).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn apply_curation(
        &mut self,
        params: protocol::CurationApplyParams,
    ) -> Result<protocol::CurationMutationResult> {
        let result = self.store.apply_curation(storage::ApplyCuration {
            run_id: params.run_id,
            expected_run_revision: params.expected_run_revision,
            expected_library_revision: params.expected_library_revision,
            selected_finding_ids: params.selected_finding_ids,
            actor: params.actor,
            reason: params.reason,
            correlation_id: params.correlation_id,
        })?;
        Ok(protocol_curation_mutation_result(result))
    }

    pub fn rollback_curation(
        &mut self,
        params: protocol::CurationRollbackParams,
    ) -> Result<protocol::CurationMutationResult> {
        let result = self.store.rollback_curation(storage::RollbackCuration {
            run_id: params.run_id,
            expected_run_revision: params.expected_run_revision,
            expected_library_revision: params.expected_library_revision,
            actor: params.actor,
            reason: params.reason,
            correlation_id: params.correlation_id,
        })?;
        Ok(protocol_curation_mutation_result(result))
    }

    pub fn export_curation(
        &self,
        params: protocol::CurationExportParams,
    ) -> Result<protocol::CurationExportResult> {
        if params.output_path.trim().is_empty() {
            return Err(EngineError::InvalidRequest(
                "outputPath must not be empty".to_string(),
            ));
        }
        if params
            .minimum_score_basis_points
            .is_some_and(|score| score > 10_000)
        {
            return Err(EngineError::InvalidRequest(
                "minimumScoreBasisPoints must not exceed 10000".to_string(),
            ));
        }
        let snapshot = self
            .store
            .export_curation_dataset(&params.run_id, params.minimum_score_basis_points)?;
        ensure_revision(
            "curation_run",
            &snapshot.run_id,
            params.expected_run_revision,
            snapshot.run_revision,
        )?;
        ensure_revision(
            "tm_library",
            &snapshot.library_id,
            params.expected_library_revision,
            snapshot.library_revision,
        )?;
        let row_count = u32::try_from(snapshot.units.len()).map_err(|_| {
            EngineError::InvalidState("curation export row count overflow".to_string())
        })?;
        let bytes = match params.format {
            protocol::CurationExportFormat::Jsonl => render_dataset_jsonl(&snapshot.units),
            protocol::CurationExportFormat::Tsv => render_dataset_tsv(&snapshot.units),
        }?;
        let bytes_written = u64::try_from(bytes.len()).map_err(|_| {
            EngineError::InvalidState("curation export byte count overflow".to_string())
        })?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let output_path = PathBuf::from(&params.output_path);
        publish_asset_file(
            &output_path,
            |file| file.write_all(&bytes).map_err(EngineError::Io),
            |path| validate_curation_dataset_file(path, params.format, row_count),
        )
        .map_err(|error| EngineError::CurationExport(error.to_string()))?;
        Ok(protocol::CurationExportResult {
            run_id: snapshot.run_id,
            run_revision: snapshot.run_revision,
            library_id: snapshot.library_id,
            library_revision: snapshot.library_revision,
            format: params.format,
            output_path: params.output_path,
            row_count,
            bytes_written,
            sha256,
        })
    }

    fn curation_run_snapshot(
        &self,
        run: storage::CurationRunRecord,
        offset: u32,
        limit: u32,
    ) -> Result<protocol::CurationRunSnapshot> {
        let (units, total) = self.store.list_curation_run_units(&run.id, offset, limit)?;
        Ok(protocol::CurationRunSnapshot {
            run: protocol_curation_run(run),
            units: units.into_iter().map(protocol_curation_run_unit).collect(),
            total,
            offset,
            limit,
        })
    }
}

fn validate_time_range(after_ms: Option<i64>, before_ms: Option<i64>) -> Result<()> {
    if after_ms
        .zip(before_ms)
        .is_some_and(|(after, before)| after > before)
    {
        Err(EngineError::InvalidRequest(
            "created-at range is inverted".to_string(),
        ))
    } else {
        Ok(())
    }
}

fn ensure_revision(entity: &'static str, id: &str, expected: u64, actual: u64) -> Result<()> {
    if expected == actual {
        Ok(())
    } else {
        Err(EngineError::Storage(
            storage::StorageError::EntityConflict {
                entity,
                id: id.to_string(),
                expected_revision: expected,
                actual_revision: actual,
            },
        ))
    }
}

fn storage_asset_catalog_kind(value: protocol::AssetCatalogKind) -> storage::AssetCatalogKind {
    match value {
        protocol::AssetCatalogKind::All => storage::AssetCatalogKind::All,
        protocol::AssetCatalogKind::Tm => storage::AssetCatalogKind::Tm,
        protocol::AssetCatalogKind::Termbase => storage::AssetCatalogKind::Termbase,
        protocol::AssetCatalogKind::Corpus => storage::AssetCatalogKind::Corpus,
    }
}

fn protocol_asset_catalog_kind(value: storage::AssetCatalogKind) -> protocol::AssetCatalogKind {
    match value {
        storage::AssetCatalogKind::All => protocol::AssetCatalogKind::All,
        storage::AssetCatalogKind::Tm => protocol::AssetCatalogKind::Tm,
        storage::AssetCatalogKind::Termbase => protocol::AssetCatalogKind::Termbase,
        storage::AssetCatalogKind::Corpus => protocol::AssetCatalogKind::Corpus,
    }
}

fn protocol_curation_state(value: storage::CurationState) -> protocol::CurationState {
    match value {
        storage::CurationState::Active => protocol::CurationState::Active,
        storage::CurationState::Quarantined => protocol::CurationState::Quarantined,
    }
}

fn protocol_asset_catalog_item(value: storage::AssetCatalogItem) -> protocol::AssetCatalogItem {
    protocol::AssetCatalogItem {
        id: value.id,
        collection_id: value.collection_id,
        collection_name: value.collection_name,
        kind: protocol_asset_catalog_kind(value.kind),
        source_locale: value.source_locale,
        target_locale: value.target_locale,
        domain: value.domain,
        source_text: value.source_text,
        target_text: value.target_text,
        origin_project_id: value.origin_project_id,
        origin_document_id: value.origin_document_id,
        origin_segment_id: value.origin_segment_id,
        structural_path: value.structural_path,
        quality_score_basis_points: value.quality_score_basis_points,
        curation_state: value.curation_state.map(protocol_curation_state),
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_curation_run_mode(value: storage::CurationRunMode) -> protocol::CurationRunMode {
    match value {
        storage::CurationRunMode::Offline => protocol::CurationRunMode::Offline,
        storage::CurationRunMode::Provider => protocol::CurationRunMode::Provider,
    }
}

fn protocol_curation_run_status(value: storage::CurationRunStatus) -> protocol::CurationRunStatus {
    match value {
        storage::CurationRunStatus::Open => protocol::CurationRunStatus::Open,
        storage::CurationRunStatus::Applied => protocol::CurationRunStatus::Applied,
        storage::CurationRunStatus::RolledBack => protocol::CurationRunStatus::RolledBack,
        storage::CurationRunStatus::Discarded => protocol::CurationRunStatus::Discarded,
    }
}

fn protocol_curation_run(value: storage::CurationRunRecord) -> protocol::CurationRun {
    protocol::CurationRun {
        id: value.id,
        project_id: value.project_id,
        library_id: value.library_id,
        status: protocol_curation_run_status(value.status),
        mode: protocol_curation_run_mode(value.mode),
        policy: value.policy.into(),
        base_library_revision: value.base_library_revision,
        revision: value.revision,
        summary: protocol::CurationRunSummary {
            analysis: value.summary.analysis,
            term_candidates: value.summary.term_candidates,
            drift_groups: value.summary.drift_groups,
        },
        actor: value.actor,
        reason: value.reason,
        provider_profile_id: value.provider_profile_id,
        created_at_ms: value.created_at_ms,
        completed_at_ms: value.completed_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_curation_run_unit(value: storage::CurationRunUnitRecord) -> protocol::CurationRunUnit {
    protocol::CurationRunUnit {
        run_id: value.run_id,
        library_id: value.library_id,
        unit_id: value.unit_id,
        quality_score_basis_points: value.quality_score_basis_points,
        recommended_action: value.recommended_action,
        explanation: value.explanation,
        unit_snapshot_hash: value.unit_snapshot_hash,
        created_at_ms: value.created_at_ms,
    }
}

fn protocol_curation_finding(value: storage::CurationFindingRecord) -> protocol::CurationFinding {
    protocol::CurationFinding {
        id: value.id,
        run_id: value.run_id,
        library_id: value.library_id,
        unit_id: value.unit_id,
        kind: value.kind,
        severity: value.severity,
        disposition: value.disposition,
        penalty_basis_points: value.penalty_basis_points,
        quality_score_basis_points: value.quality_score_basis_points,
        canonical_unit_id: value.canonical_unit_id,
        evidence: value.evidence,
        explanation: value.explanation,
        revision: value.revision,
        fingerprint: value.fingerprint,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_curation_mutation_result(
    value: storage::CurationMutationResultRecord,
) -> protocol::CurationMutationResult {
    protocol::CurationMutationResult {
        run_id: value.run_id,
        status: protocol_curation_run_status(value.status),
        run_revision: value.run_revision,
        library_id: value.library_id,
        library_revision: value.library_revision,
        changed_unit_count: value.changed_unit_count,
        quarantined_unit_count: value.quarantined_unit_count,
        restored_unit_count: value.restored_unit_count,
        operation_id: value.operation_id,
    }
}

fn validate_curation_dataset_file(
    path: &Path,
    format: protocol::CurationExportFormat,
    expected_rows: u32,
) -> Result<()> {
    let bytes = fs::read(path).map_err(|error| EngineError::CurationExport(error.to_string()))?;
    std::str::from_utf8(&bytes)
        .map_err(|_| EngineError::CurationExport("curation export is not UTF-8".to_string()))?;
    let actual_rows = match format {
        protocol::CurationExportFormat::Jsonl => {
            let mut count = 0_u32;
            for line in bytes.split(|byte| *byte == b'\n') {
                if line.is_empty() {
                    continue;
                }
                serde_json::from_slice::<DatasetUnit>(line).map_err(|_| {
                    EngineError::CurationExport(
                        "curation JSONL export failed validation".to_string(),
                    )
                })?;
                count = count.checked_add(1).ok_or_else(|| {
                    EngineError::CurationExport("curation export row count overflow".to_string())
                })?;
            }
            count
        }
        protocol::CurationExportFormat::Tsv => {
            let mut reader = csv::ReaderBuilder::new()
                .delimiter(b'\t')
                .from_reader(bytes.as_slice());
            const HEADERS: [&str; 10] = [
                "unit_id",
                "source_locale",
                "target_locale",
                "source_text",
                "target_text",
                "domain",
                "origin_project_id",
                "origin_document_id",
                "origin_segment_id",
                "quality_score_basis_points",
            ];
            let headers = reader.headers().map_err(|_| {
                EngineError::CurationExport("curation TSV export failed validation".to_string())
            })?;
            if headers.len() != HEADERS.len()
                || !headers
                    .iter()
                    .zip(HEADERS)
                    .all(|(actual, expected)| actual == expected)
            {
                return Err(EngineError::CurationExport(
                    "curation TSV export failed validation".to_string(),
                ));
            }
            let mut count = 0_u32;
            for row in reader.records() {
                let row = row.map_err(|_| {
                    EngineError::CurationExport("curation TSV export failed validation".to_string())
                })?;
                let required_fields_are_present =
                    (0..=4).all(|index| row.get(index).is_some_and(|value| !value.is_empty()));
                let score_is_valid = row
                    .get(9)
                    .and_then(|value| value.parse::<u16>().ok())
                    .is_some_and(|value| value <= 10_000);
                if row.len() != HEADERS.len() || !required_fields_are_present || !score_is_valid {
                    return Err(EngineError::CurationExport(
                        "curation TSV export failed validation".to_string(),
                    ));
                }
                count = count.checked_add(1).ok_or_else(|| {
                    EngineError::CurationExport("curation export row count overflow".to_string())
                })?;
            }
            count
        }
    };
    if actual_rows != expected_rows {
        return Err(EngineError::CurationExport(format!(
            "curation export row count mismatch: expected {expected_rows}, found {actual_rows}"
        )));
    }
    Ok(())
}
