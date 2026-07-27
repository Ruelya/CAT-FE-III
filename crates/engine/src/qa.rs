use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use translunar_domain::sha256_hex;
use translunar_filter_core::publish_bytes_noclobber;
use translunar_protocol::{
    EmptyResult, QaGateCheckParams, QaIssueListParams, QaIssuePage, QaIssueRevokeParams,
    QaIssueWaiveParams, QaOverrideListParams, QaOverridePage, QaProfileCloneParams,
    QaProfileCreateParams, QaProfileDeleteParams, QaProfileListParams, QaProfilePage,
    QaProfileUpdateParams, QaReportExportParams, QaReportExportResult, QaRunIdParams,
    QaRunListParams, QaRunPage, QaRunParams, QaRunResult, ReviewQueuePage, ReviewQueueParams,
    ReviewStatisticsParams, ReviewStatisticsResult,
};
use translunar_qa_core::{
    QaExecutionSegment, QaFindingCandidate, QaReportFormat, QaRuleExecutionFailure,
    QaRuleExecutionRecord, QaRuleExecutionStatus, QaRuleExecutionUsage, QaRuleProvenanceSnapshot,
    render_html, render_xlsx, validate_html, validate_qa_candidate_batch, validate_xlsx,
};
use translunar_storage::{
    EvaluatedQaRun, NewQaProfile, PreparedQaRun, QaIssueFilter, QaProfileUpdate,
};

use super::{EngineError, EngineService, Result, bounded_page_size};

pub(crate) struct QaRuleExecutorOutput {
    pub(crate) candidates: Vec<QaFindingCandidate>,
    pub(crate) usage: QaRuleExecutionUsage,
}

#[derive(Debug, Clone)]
pub(crate) struct QaRuleExecutorFailure {
    pub(crate) status: QaRuleExecutionStatus,
    pub(crate) failure: QaRuleExecutionFailure,
    pub(crate) usage: QaRuleExecutionUsage,
}

impl QaRuleExecutorFailure {
    pub(crate) fn failed(code: &str, retryable: bool) -> Self {
        Self {
            status: QaRuleExecutionStatus::Failed,
            failure: QaRuleExecutionFailure {
                code: code.to_string(),
                message: "Plugin QA rule execution failed.".to_string(),
                retryable,
            },
            usage: QaRuleExecutionUsage::default(),
        }
    }

    pub(crate) fn canceled() -> Self {
        Self {
            status: QaRuleExecutionStatus::Canceled,
            failure: QaRuleExecutionFailure {
                code: "plugin_canceled".to_string(),
                message: "Plugin QA rule execution was canceled.".to_string(),
                retryable: true,
            },
            usage: QaRuleExecutionUsage::default(),
        }
    }

    fn engine_error(&self) -> EngineError {
        match self.failure.code.as_str() {
            "plugin_permission_denied" => {
                EngineError::PluginPermissionDenied(self.failure.message.clone())
            }
            "plugin_timeout" | "plugin_resource_limit" | "plugin_protocol" => {
                EngineError::PluginSandboxFailed(self.failure.message.clone())
            }
            "plugin_host_crash" => EngineError::PluginProcessFailed(self.failure.message.clone()),
            _ => EngineError::InvalidState(self.failure.message.clone()),
        }
    }
}

pub(crate) trait QaRuleExecutor: Send + Sync {
    fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure>;
    fn evaluate_segment(
        &self,
        segment: &QaExecutionSegment,
    ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure>;
    fn cancel(&self);
}

#[derive(Clone)]
pub(crate) struct QaRuleExecutorSnapshot {
    provenance: QaRuleProvenanceSnapshot,
    executor: Arc<dyn QaRuleExecutor>,
}

impl QaRuleExecutorSnapshot {
    pub(crate) fn new(
        provenance: QaRuleProvenanceSnapshot,
        executor: Arc<dyn QaRuleExecutor>,
    ) -> Self {
        Self {
            provenance,
            executor,
        }
    }

    pub(crate) fn provenance(&self) -> &QaRuleProvenanceSnapshot {
        &self.provenance
    }

    fn cancel(&self) {
        self.executor.cancel();
    }
}

#[derive(Clone, Default)]
pub(crate) struct PluginQaRegistry {
    entries: Arc<RwLock<BTreeMap<String, QaRuleExecutorSnapshot>>>,
}

impl PluginQaRegistry {
    #[cfg(test)]
    pub(crate) fn contains(&self, contribution_id: &str) -> bool {
        self.entries
            .read()
            .is_ok_and(|entries| entries.contains_key(contribution_id))
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.entries.read().is_ok_and(|entries| entries.is_empty())
    }

    pub(crate) fn owner(&self, contribution_id: &str) -> Option<QaRuleProvenanceSnapshot> {
        self.entries
            .read()
            .ok()?
            .get(contribution_id)
            .map(|entry| entry.provenance.clone())
    }

    pub(crate) fn preflight(&self, candidates: &[QaRuleExecutorSnapshot]) -> Result<()> {
        let entries = self.entries.read().map_err(|_| {
            EngineError::InvalidState("plugin QA registry is unavailable".to_string())
        })?;
        let mut ids = BTreeSet::new();
        for candidate in candidates {
            let id = &candidate.provenance.contribution_id;
            if id.starts_with("builtin.") || !ids.insert(id) || entries.contains_key(id) {
                return Err(EngineError::PluginConflict(format!(
                    "QA contribution id {id} is already registered or reserved"
                )));
            }
        }
        Ok(())
    }

    pub(crate) fn attach_all(&self, candidates: Vec<QaRuleExecutorSnapshot>) -> Result<()> {
        self.preflight(&candidates)?;
        let mut entries = self.entries.write().map_err(|_| {
            EngineError::InvalidState("plugin QA registry is unavailable".to_string())
        })?;
        for candidate in candidates {
            entries.insert(candidate.provenance.contribution_id.clone(), candidate);
        }
        Ok(())
    }

    pub(crate) fn detach_owner(&self, owner: &QaRuleProvenanceSnapshot) -> bool {
        let Ok(mut entries) = self.entries.write() else {
            return false;
        };
        let matches = entries
            .get(&owner.contribution_id)
            .is_some_and(|entry| entry.provenance == *owner);
        if matches && let Some(entry) = entries.remove(&owner.contribution_id) {
            entry.cancel();
            return true;
        }
        false
    }

    pub(crate) fn detach_generation(&self, plugin_id: &str, activation_revision: u64) {
        let owners = self
            .entries
            .read()
            .map(|entries| {
                entries
                    .values()
                    .filter(|entry| {
                        entry.provenance.plugin_id == plugin_id
                            && entry.provenance.activation_revision == activation_revision
                    })
                    .map(|entry| entry.provenance.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for owner in owners {
            self.detach_owner(&owner);
        }
    }

    pub(crate) fn snapshots(&self) -> Vec<QaRuleExecutorSnapshot> {
        self.entries
            .read()
            .map(|entries| entries.values().cloned().collect())
            .unwrap_or_default()
    }

    fn is_current(&self, snapshot: &QaRuleExecutorSnapshot) -> bool {
        self.entries.read().is_ok_and(|entries| {
            entries
                .get(&snapshot.provenance.contribution_id)
                .is_some_and(|current| current.provenance == snapshot.provenance)
        })
    }
}

#[derive(Debug)]
pub(crate) struct QaRuleEvaluationFailure {
    plugin_rules: Vec<QaRuleExecutionRecord>,
    error: QaRuleExecutorFailure,
}

pub(crate) fn execute_qa_rule_snapshots(
    prepared: &PreparedQaRun,
    snapshots: &[QaRuleExecutorSnapshot],
) -> std::result::Result<EvaluatedQaRun, QaRuleEvaluationFailure> {
    let known_segment_ids = prepared
        .segments
        .iter()
        .map(|segment| segment.input.segment_id.clone())
        .collect::<BTreeSet<_>>();
    let mut evaluated = EvaluatedQaRun::default();
    for snapshot in snapshots {
        let provenance = snapshot.provenance();
        let allowed_rule_ids = provenance.rule_ids.iter().collect::<BTreeSet<_>>();
        let mut contribution_candidates = Vec::new();
        let mut usage = QaRuleExecutionUsage::default();
        let mut execution_count = 0_u32;
        for segment in &prepared.segments {
            let output = match snapshot.executor.evaluate_segment(segment) {
                Ok(output) => output,
                Err(mut failure) => {
                    if let Err(overflow) = add_usage(&mut usage, &failure.usage) {
                        failure = overflow;
                    }
                    evaluated.plugin_rules.push(failed_execution_record(
                        prepared,
                        provenance,
                        execution_count,
                        usage,
                        &failure,
                    ));
                    return Err(QaRuleEvaluationFailure {
                        plugin_rules: evaluated.plugin_rules,
                        error: failure,
                    });
                }
            };
            let validation =
                validate_qa_candidate_batch(segment, &known_segment_ids, &output.candidates)
                    .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_result", false))
                    .and_then(|()| {
                        if !allowed_rule_ids.is_empty()
                            && output
                                .candidates
                                .iter()
                                .any(|candidate| !allowed_rule_ids.contains(&candidate.rule_id))
                        {
                            Err(QaRuleExecutorFailure::failed(
                                "plugin_invalid_result",
                                false,
                            ))
                        } else {
                            Ok(())
                        }
                    });
            if let Err(failure) = validation {
                evaluated.plugin_rules.push(failed_execution_record(
                    prepared,
                    provenance,
                    execution_count,
                    usage,
                    &failure,
                ));
                return Err(QaRuleEvaluationFailure {
                    plugin_rules: evaluated.plugin_rules,
                    error: failure,
                });
            }
            if let Err(failure) = add_usage(&mut usage, &output.usage) {
                evaluated.plugin_rules.push(failed_execution_record(
                    prepared,
                    provenance,
                    execution_count,
                    usage,
                    &failure,
                ));
                return Err(QaRuleEvaluationFailure {
                    plugin_rules: evaluated.plugin_rules,
                    error: failure,
                });
            }
            execution_count = execution_count.saturating_add(1);
            contribution_candidates.extend(output.candidates);
        }
        let output_bytes = match serde_json::to_vec(&contribution_candidates) {
            Ok(output_bytes) => output_bytes,
            Err(_) => {
                let failure = QaRuleExecutorFailure::failed("plugin_invalid_result", false);
                evaluated.plugin_rules.push(failed_execution_record(
                    prepared,
                    provenance,
                    execution_count,
                    usage,
                    &failure,
                ));
                return Err(QaRuleEvaluationFailure {
                    plugin_rules: evaluated.plugin_rules,
                    error: failure,
                });
            }
        };
        let finding_count = match u32::try_from(contribution_candidates.len()) {
            Ok(finding_count) => finding_count,
            Err(_) => {
                let failure = QaRuleExecutorFailure::failed("plugin_resource_limit", false);
                evaluated.plugin_rules.push(failed_execution_record(
                    prepared,
                    provenance,
                    execution_count,
                    usage,
                    &failure,
                ));
                return Err(QaRuleEvaluationFailure {
                    plugin_rules: evaluated.plugin_rules,
                    error: failure,
                });
            }
        };
        let output_hash = sha256_hex(&output_bytes);
        let mut completed_provenance = provenance.clone();
        if completed_provenance.rule_ids.is_empty() {
            completed_provenance.rule_ids = contribution_candidates
                .iter()
                .map(|candidate| candidate.rule_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
        }
        evaluated.candidates.extend(contribution_candidates);
        evaluated.plugin_rules.push(QaRuleExecutionRecord {
            provenance: completed_provenance,
            status: QaRuleExecutionStatus::Succeeded,
            execution_count,
            input_hash: prepared.input_snapshot_hash.clone(),
            output_hash: Some(output_hash),
            finding_count,
            usage,
            failure: None,
        });
    }
    Ok(evaluated)
}

fn add_usage(
    total: &mut QaRuleExecutionUsage,
    value: &QaRuleExecutionUsage,
) -> std::result::Result<(), QaRuleExecutorFailure> {
    let work_units = total
        .work_units
        .checked_add(value.work_units)
        .ok_or_else(|| QaRuleExecutorFailure::failed("plugin_resource_limit", false))?;
    let input_bytes = total
        .input_bytes
        .checked_add(value.input_bytes)
        .ok_or_else(|| QaRuleExecutorFailure::failed("plugin_resource_limit", false))?;
    let output_bytes = total
        .output_bytes
        .checked_add(value.output_bytes)
        .ok_or_else(|| QaRuleExecutorFailure::failed("plugin_resource_limit", false))?;
    total.work_units = work_units;
    total.input_bytes = input_bytes;
    total.output_bytes = output_bytes;
    Ok(())
}

fn failed_execution_record(
    prepared: &PreparedQaRun,
    provenance: &QaRuleProvenanceSnapshot,
    execution_count: u32,
    usage: QaRuleExecutionUsage,
    failure: &QaRuleExecutorFailure,
) -> QaRuleExecutionRecord {
    QaRuleExecutionRecord {
        provenance: provenance.clone(),
        status: failure.status,
        execution_count,
        input_hash: prepared.input_snapshot_hash.clone(),
        output_hash: None,
        finding_count: 0,
        usage,
        failure: Some(failure.failure.clone()),
    }
}

impl EngineService {
    fn ensure_qa_activation_leases(
        &self,
        snapshots: &[QaRuleExecutorSnapshot],
    ) -> std::result::Result<(), (String, QaRuleExecutorFailure)> {
        for snapshot in snapshots {
            let provenance = snapshot.provenance();
            if !self.plugin_qa_registry.is_current(snapshot)
                || self
                    .plugin_activation_revisions
                    .get(&provenance.plugin_id)
                    .is_none_or(|revision| *revision != provenance.activation_revision)
            {
                return Err((
                    provenance.contribution_id.clone(),
                    QaRuleExecutorFailure::failed("plugin_stale_activation", false),
                ));
            }
            snapshot
                .executor
                .authorize()
                .map_err(|failure| (provenance.contribution_id.clone(), failure))?;
        }
        Ok(())
    }

    pub fn list_qa_profiles(&self, params: QaProfileListParams) -> Result<QaProfilePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_qa_profiles(params.project_id.as_deref(), params.offset, limit)?;
        Ok(QaProfilePage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_qa_profile(
        &mut self,
        params: QaProfileCreateParams,
    ) -> Result<translunar_qa_core::QaProfile> {
        Ok(self.store.create_qa_profile(NewQaProfile {
            name: params.name,
            owner_project_id: params.owner_project_id,
            definition: params.definition,
        })?)
    }

    pub fn clone_qa_profile(
        &mut self,
        params: QaProfileCloneParams,
    ) -> Result<translunar_qa_core::QaProfile> {
        Ok(self
            .store
            .clone_qa_profile(&params.profile_id, params.owner_project_id, params.name)?)
    }

    pub fn update_qa_profile(
        &mut self,
        params: QaProfileUpdateParams,
    ) -> Result<translunar_qa_core::QaProfile> {
        Ok(self.store.update_qa_profile(
            &params.profile_id,
            QaProfileUpdate {
                name: params.name,
                definition: params.definition,
                expected_revision: params.expected_revision,
            },
        )?)
    }

    pub fn delete_qa_profile(&mut self, params: QaProfileDeleteParams) -> Result<EmptyResult> {
        self.store
            .delete_qa_profile(&params.profile_id, params.expected_revision)?;
        Ok(EmptyResult::default())
    }

    pub fn run_qa(&mut self, params: QaRunParams) -> Result<QaRunResult> {
        self.execute_qa_run(
            &params.project_id,
            params.document_id.as_deref(),
            params.profile_id.as_deref(),
        )
    }

    pub(crate) fn execute_qa_run(
        &mut self,
        project_id: &str,
        document_id: Option<&str>,
        profile_id: Option<&str>,
    ) -> Result<QaRunResult> {
        let prepared = self
            .store
            .prepare_qa_run(project_id, document_id, profile_id)?;
        let mut evaluated = translunar_storage::Store::evaluate_prepared_qa_run(&prepared)?;
        let snapshots = self.plugin_qa_registry.snapshots();
        let plugin_evaluated = match execute_qa_rule_snapshots(&prepared, &snapshots) {
            Ok(evaluated) => evaluated,
            Err(failed) => {
                let failed_provenance = failed
                    .plugin_rules
                    .last()
                    .map(|record| record.provenance.clone());
                let commit_result = self
                    .store
                    .commit_failed_prepared_qa_run(prepared, failed.plugin_rules);
                if let Some(provenance) = failed_provenance {
                    self.handle_plugin_qa_failure(&provenance, &failed.error);
                }
                commit_result?;
                return Err(failed.error.engine_error());
            }
        };
        evaluated.candidates.extend(plugin_evaluated.candidates);
        evaluated.plugin_rules.extend(plugin_evaluated.plugin_rules);
        if let Err((contribution_id, failure)) = self.ensure_qa_activation_leases(&snapshots) {
            if let Some(record) = evaluated
                .plugin_rules
                .iter_mut()
                .find(|record| record.provenance.contribution_id == contribution_id)
            {
                record.status = failure.status;
                record.output_hash = None;
                record.finding_count = 0;
                record.failure = Some(failure.failure.clone());
            }
            self.store
                .commit_failed_prepared_qa_run(prepared, evaluated.plugin_rules)?;
            return Err(failure.engine_error());
        }
        Ok(self.store.commit_prepared_qa_run(prepared, evaluated)?)
    }

    pub fn list_qa_runs(&self, params: QaRunListParams) -> Result<QaRunPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_qa_runs(
            &params.project_id,
            params.document_id.as_deref(),
            params.offset,
            limit,
        )?;
        Ok(QaRunPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_qa_run(&self, params: QaRunIdParams) -> Result<QaRunResult> {
        Ok(self.store.get_qa_run(&params.run_id)?)
    }

    pub fn list_qa_issues(&self, params: QaIssueListParams) -> Result<QaIssuePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_qa_issue_views(QaIssueFilter {
            project_id: params.project_id,
            document_id: params.document_id,
            segment_id: params.segment_id,
            severity: params.severity,
            category: params.category,
            disposition: params.disposition,
            rule_id: params.rule_id,
            offset: params.offset,
            limit,
        })?;
        Ok(QaIssuePage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn waive_qa_issue(
        &mut self,
        params: QaIssueWaiveParams,
    ) -> Result<translunar_qa_core::QaIssueView> {
        Ok(self
            .store
            .waive_qa_issue(&params.issue_id, &params.actor, &params.reason)?)
    }

    pub fn revoke_qa_issue(
        &mut self,
        params: QaIssueRevokeParams,
    ) -> Result<translunar_qa_core::QaIssueView> {
        Ok(self
            .store
            .revoke_qa_waiver(&params.issue_id, params.expected_revision)?)
    }

    pub fn export_qa_report(
        &mut self,
        params: QaReportExportParams,
    ) -> Result<QaReportExportResult> {
        let output_path = PathBuf::from(&params.output_path);
        if output_path.as_os_str().is_empty() {
            return Err(EngineError::InvalidRequest(
                "outputPath must not be empty".to_string(),
            ));
        }
        let snapshot = self.store.qa_report_snapshot(&params.run_id)?;
        let bytes = match params.format {
            QaReportFormat::Html => {
                let bytes = render_html(&snapshot);
                validate_html(&bytes)
                    .map_err(|error| EngineError::ReportExport(error.to_string()))?;
                bytes
            }
            QaReportFormat::Xlsx => {
                let bytes = render_xlsx(&snapshot)
                    .map_err(|error| EngineError::ReportExport(error.to_string()))?;
                validate_xlsx(&bytes)
                    .map_err(|error| EngineError::ReportExport(error.to_string()))?;
                bytes
            }
        };
        publish_bytes_noclobber(&output_path, &bytes)
            .map_err(|error| EngineError::ReportExport(error.to_string()))?;
        match self.store.record_qa_report(
            &params.run_id,
            params.format,
            &output_path.to_string_lossy(),
        ) {
            Ok(record) => Ok(record),
            Err(error) => {
                let _ = fs::remove_file(&output_path);
                Err(error.into())
            }
        }
    }

    pub fn check_qa_gate(
        &mut self,
        params: QaGateCheckParams,
    ) -> Result<translunar_qa_core::QaGateResult> {
        let run = self.execute_qa_run(
            &params.project_id,
            Some(&params.document_id),
            params.profile_id.as_deref(),
        )?;
        Ok(self.store.qa_gate_result(&params.document_id, run)?)
    }

    pub fn list_qa_overrides(&self, params: QaOverrideListParams) -> Result<QaOverridePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_qa_export_overrides(
            &params.project_id,
            params.document_id.as_deref(),
            params.offset,
            limit,
        )?;
        Ok(QaOverridePage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_review_queue(&self, params: ReviewQueueParams) -> Result<ReviewQueuePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_review_queue(
            &params.project_id,
            params.document_id.as_deref(),
            params.status,
            params.offset,
            limit,
        )?;
        Ok(ReviewQueuePage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn review_statistics(
        &self,
        params: ReviewStatisticsParams,
    ) -> Result<ReviewStatisticsResult> {
        Ok(self
            .store
            .review_statistics(&params.project_id, params.document_id.as_deref())?)
    }
}

pub(crate) fn namespace_plugin_qa_rule_id(
    plugin_id: &str,
    version_id: &str,
    contribution_id: &str,
    local_rule_id: &str,
) -> String {
    let version_hash = sha256_hex(version_id.as_bytes());
    format!("plugin.qa.{plugin_id}.{contribution_id}.v{version_hash}.{local_rule_id}")
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use translunar_domain::QaSeverity;
    use translunar_qa_core::{
        QaCandidateEvidence, QaCategory, QaProfile, QaRunScope, QaSegmentInput, standard_profile,
    };

    use super::*;

    struct FixtureExecutor {
        candidates: Vec<QaFindingCandidate>,
    }

    impl QaRuleExecutor for FixtureExecutor {
        fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
            Ok(())
        }

        fn evaluate_segment(
            &self,
            _segment: &QaExecutionSegment,
        ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
            Ok(QaRuleExecutorOutput {
                candidates: self.candidates.clone(),
                usage: QaRuleExecutionUsage {
                    work_units: 1,
                    input_bytes: 2,
                    output_bytes: 3,
                },
            })
        }

        fn cancel(&self) {}
    }

    struct FailingExecutor {
        failure: QaRuleExecutorFailure,
    }

    impl QaRuleExecutor for FailingExecutor {
        fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
            Ok(())
        }

        fn evaluate_segment(
            &self,
            _segment: &QaExecutionSegment,
        ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
            Err(self.failure.clone())
        }

        fn cancel(&self) {}
    }

    struct CancelRecordingExecutor {
        canceled: Arc<AtomicBool>,
    }

    impl QaRuleExecutor for CancelRecordingExecutor {
        fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
            Ok(())
        }

        fn evaluate_segment(
            &self,
            _segment: &QaExecutionSegment,
        ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
            Ok(QaRuleExecutorOutput {
                candidates: Vec::new(),
                usage: QaRuleExecutionUsage::default(),
            })
        }

        fn cancel(&self) {
            self.canceled.store(true, Ordering::Release);
        }
    }

    fn prepared_run() -> PreparedQaRun {
        let definition = standard_profile();
        PreparedQaRun {
            run_id: "run-1".to_string(),
            project_id: "project-1".to_string(),
            document_id: Some("document-1".to_string()),
            requested_profile_id: Some(definition.id.clone()),
            scope: QaRunScope::Document,
            profile: QaProfile {
                id: definition.id.clone(),
                name: definition.name.clone(),
                owner_project_id: None,
                built_in: true,
                definition,
                revision: 0,
                created_at_ms: 0,
                updated_at_ms: 0,
            },
            segments: vec![QaExecutionSegment {
                project_id: "project-1".to_string(),
                document_id: "document-1".to_string(),
                ordinal: 0,
                structural_path: "/p[1]".to_string(),
                revision: 0,
                input: QaSegmentInput {
                    segment_id: "segment-1".to_string(),
                    source_text: "Source".to_string(),
                    target_text: "Target".to_string(),
                    source_locale: "en-US".to_string(),
                    target_locale: "zh-CN".to_string(),
                    tag_findings: Vec::new(),
                    terms: Vec::new(),
                },
            }],
            input_snapshot_hash: "a".repeat(64),
            created_at_ms: 0,
        }
    }

    fn provenance() -> QaRuleProvenanceSnapshot {
        QaRuleProvenanceSnapshot {
            plugin_id: "example.plugin".to_string(),
            version_id: "version:1".to_string(),
            contribution_id: "example.qa".to_string(),
            contribution_version: "1.0.0".to_string(),
            descriptor_version: 1,
            operation_protocol_version: 1,
            config_schema_version: 1,
            activation_revision: 1,
            tier: "sandbox".to_string(),
            descriptor_hash: "b".repeat(64),
            config_hash: "c".repeat(64),
            rule_ids: vec![
                "qa.plugin.example.a".to_string(),
                "qa.plugin.example.z".to_string(),
            ],
        }
    }

    fn candidate(rule_id: &str) -> QaFindingCandidate {
        QaFindingCandidate {
            segment_id: "segment-1".to_string(),
            rule_id: rule_id.to_string(),
            category: QaCategory::Custom,
            severity: QaSeverity::Warning,
            message: "Finding".to_string(),
            fingerprint: format!("{rule_id}.fingerprint"),
            evidence: QaCandidateEvidence::default(),
        }
    }

    #[test]
    fn executor_snapshots_record_deterministic_provenance() {
        let prepared = prepared_run();
        let executor = FixtureExecutor {
            candidates: vec![candidate("qa.plugin.example.a")],
        };
        let evaluated = execute_qa_rule_snapshots(
            &prepared,
            &[QaRuleExecutorSnapshot::new(
                provenance(),
                Arc::new(executor),
            )],
        )
        .expect("execute snapshot");
        assert_eq!(evaluated.candidates.len(), 1);
        assert_eq!(evaluated.plugin_rules.len(), 1);
        assert_eq!(evaluated.plugin_rules[0].execution_count, 1);
        assert_eq!(evaluated.plugin_rules[0].finding_count, 1);
        assert_eq!(
            evaluated.plugin_rules[0].usage,
            QaRuleExecutionUsage {
                work_units: 1,
                input_bytes: 2,
                output_bytes: 3,
            }
        );
        assert_eq!(
            evaluated.plugin_rules[0].input_hash,
            prepared.input_snapshot_hash
        );
    }

    #[test]
    fn executor_snapshots_reject_unordered_batches() {
        let prepared = prepared_run();
        let executor = FixtureExecutor {
            candidates: vec![
                candidate("qa.plugin.example.z"),
                candidate("qa.plugin.example.a"),
            ],
        };
        assert!(
            execute_qa_rule_snapshots(
                &prepared,
                &[QaRuleExecutorSnapshot::new(
                    provenance(),
                    Arc::new(executor),
                )]
            )
            .is_err()
        );
    }

    #[test]
    fn executor_failure_records_completed_and_failed_contributions() {
        let prepared = prepared_run();
        let mut first_provenance = provenance();
        first_provenance.contribution_id = "example.qa.a".to_string();
        first_provenance.rule_ids = vec!["qa.plugin.example.a".to_string()];
        let mut second_provenance = provenance();
        second_provenance.contribution_id = "example.qa.b".to_string();
        second_provenance.rule_ids = vec!["qa.plugin.example.b".to_string()];
        let failure = QaRuleExecutorFailure {
            status: QaRuleExecutionStatus::Failed,
            failure: QaRuleExecutionFailure {
                code: "plugin_timeout".to_string(),
                message: "Plugin QA rule execution failed.".to_string(),
                retryable: true,
            },
            usage: QaRuleExecutionUsage {
                work_units: 4,
                input_bytes: 5,
                output_bytes: 0,
            },
        };
        let failed = execute_qa_rule_snapshots(
            &prepared,
            &[
                QaRuleExecutorSnapshot::new(
                    first_provenance,
                    Arc::new(FixtureExecutor {
                        candidates: vec![candidate("qa.plugin.example.a")],
                    }),
                ),
                QaRuleExecutorSnapshot::new(
                    second_provenance,
                    Arc::new(FailingExecutor {
                        failure: failure.clone(),
                    }),
                ),
            ],
        )
        .expect_err("second contribution must fail the batch");
        assert_eq!(failed.plugin_rules.len(), 2);
        assert_eq!(
            failed.plugin_rules[0].status,
            QaRuleExecutionStatus::Succeeded
        );
        assert_eq!(failed.plugin_rules[1].status, QaRuleExecutionStatus::Failed);
        assert_eq!(failed.plugin_rules[1].finding_count, 0);
        assert_eq!(failed.plugin_rules[1].usage, failure.usage);
        assert_eq!(
            failed.plugin_rules[1]
                .failure
                .as_ref()
                .map(|value| value.code.as_str()),
            Some("plugin_timeout")
        );
    }

    #[test]
    fn dynamic_rule_ids_are_frozen_into_completed_provenance() {
        let prepared = prepared_run();
        let mut dynamic_provenance = provenance();
        dynamic_provenance.rule_ids.clear();
        let evaluated = execute_qa_rule_snapshots(
            &prepared,
            &[QaRuleExecutorSnapshot::new(
                dynamic_provenance,
                Arc::new(FixtureExecutor {
                    candidates: vec![
                        candidate("qa.plugin.example.a"),
                        candidate("qa.plugin.example.z"),
                    ],
                }),
            )],
        )
        .expect("execute dynamic rule snapshot");
        assert_eq!(
            evaluated.plugin_rules[0].provenance.rule_ids,
            vec![
                "qa.plugin.example.a".to_string(),
                "qa.plugin.example.z".to_string(),
            ]
        );
    }

    #[test]
    fn registry_detaches_and_cancels_only_the_exact_generation() {
        let canceled = Arc::new(AtomicBool::new(false));
        let owner = provenance();
        let mut newer_owner = owner.clone();
        newer_owner.activation_revision += 1;
        let registry = PluginQaRegistry::default();
        registry
            .attach_all(vec![QaRuleExecutorSnapshot::new(
                owner.clone(),
                Arc::new(CancelRecordingExecutor {
                    canceled: Arc::clone(&canceled),
                }),
            )])
            .expect("attach owner");

        assert!(
            registry
                .preflight(&[QaRuleExecutorSnapshot::new(
                    newer_owner.clone(),
                    Arc::new(FixtureExecutor {
                        candidates: Vec::new(),
                    }),
                )])
                .is_err()
        );
        assert!(!registry.detach_owner(&newer_owner));
        registry.detach_generation(&owner.plugin_id, newer_owner.activation_revision);
        assert!(registry.contains(&owner.contribution_id));
        assert!(!canceled.load(Ordering::Acquire));

        registry.detach_generation(&owner.plugin_id, owner.activation_revision);
        assert!(registry.is_empty());
        assert!(canceled.load(Ordering::Acquire));
    }

    #[test]
    fn usage_overflow_does_not_partially_mutate_the_total() {
        let original = QaRuleExecutionUsage {
            work_units: 10,
            input_bytes: u64::MAX,
            output_bytes: 30,
        };
        let mut total = original.clone();
        let error = add_usage(
            &mut total,
            &QaRuleExecutionUsage {
                work_units: 1,
                input_bytes: 1,
                output_bytes: 1,
            },
        )
        .expect_err("input usage overflow must fail");
        assert_eq!(error.failure.code, "plugin_resource_limit");
        assert_eq!(total, original);
    }

    #[test]
    fn declarative_rule_identity_is_stable_and_version_scoped() {
        let first_version = "inventory-v2:example.plugin:1.0.0+build.1";
        let second_version = "inventory-v2:example.plugin:1.0.1";
        let first = namespace_plugin_qa_rule_id(
            "example.plugin",
            first_version,
            "example.qa",
            "brand.case",
        );
        assert_eq!(
            first,
            namespace_plugin_qa_rule_id(
                "example.plugin",
                first_version,
                "example.qa",
                "brand.case",
            )
        );
        assert_ne!(
            first,
            namespace_plugin_qa_rule_id(
                "example.plugin",
                second_version,
                "example.qa",
                "brand.case",
            )
        );
        assert!(
            first
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
        );
    }
}
