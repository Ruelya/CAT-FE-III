use std::fs;
use std::path::PathBuf;

use translunar_filter_core::publish_bytes_noclobber;
use translunar_protocol::{
    EmptyResult, QaGateCheckParams, QaIssueListParams, QaIssuePage, QaIssueRevokeParams,
    QaIssueWaiveParams, QaOverrideListParams, QaOverridePage, QaProfileCloneParams,
    QaProfileCreateParams, QaProfileDeleteParams, QaProfileListParams, QaProfilePage,
    QaProfileUpdateParams, QaReportExportParams, QaReportExportResult, QaRunIdParams,
    QaRunListParams, QaRunPage, QaRunParams, QaRunResult, ReviewQueuePage, ReviewQueueParams,
    ReviewStatisticsParams, ReviewStatisticsResult,
};
use translunar_qa_core::{QaReportFormat, render_html, render_xlsx, validate_html, validate_xlsx};
use translunar_storage::{NewQaProfile, QaIssueFilter, QaProfileUpdate};

use super::{EngineError, EngineService, Result, bounded_page_size};

impl EngineService {
    pub(crate) fn plugin_qa_rules(&self) -> Result<Vec<translunar_qa_core::QaRegexRule>> {
        let mut rules = Vec::new();
        for pack in self.plugin_qa_packs.values() {
            let authorized = pack
                .authorized_rules()
                .map_err(EngineError::PluginCapabilityDenied)?;
            let requested_scope = translunar_plugin_runtime::PluginCapabilityScope::Contributions {
                contribution_ids: vec![pack.contribution_id.clone()],
            };
            let grants = self.store.list_plugin_capability_requests(
                &pack.plugin_id,
                Some(&pack.version_id),
                0,
                200,
            )?;
            let grant = grants
                .items
                .iter()
                .filter(|request| {
                    request.request.capability_id
                        == translunar_plugin_runtime::PluginCapabilityId::QaRegister
                        && request.decision
                            == translunar_plugin_runtime::PluginCapabilityDecision::Granted
                        && request
                            .request
                            .contribution_id
                            .as_deref()
                            .is_none_or(|id| id == pack.contribution_id.as_str())
                        && request
                            .granted_scope
                            .as_ref()
                            .is_some_and(|scope| scope.allows(&requested_scope))
                })
                .min_by_key(|request| {
                    (
                        request.request.contribution_id.as_deref()
                            != Some(pack.contribution_id.as_str()),
                        request.id.as_str(),
                    )
                })
                .ok_or_else(|| {
                    EngineError::InvalidState(format!(
                        "authorized QA pack {} has no matching durable grant",
                        pack.contribution_id
                    ))
                })?;
            rules.extend(authorized.into_iter().map(|mut rule| {
                rule.id = format!("{}.grant.{}.r{}", rule.id, grant.id, grant.revision);
                rule
            }));
        }
        rules.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(rules)
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
        let plugin_rules = self.plugin_qa_rules()?;
        Ok(self.store.run_qa_with_rules(
            &params.project_id,
            params.document_id.as_deref(),
            params.profile_id.as_deref(),
            &plugin_rules,
        )?)
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
        let plugin_rules = self.plugin_qa_rules()?;
        Ok(self.store.check_qa_gate_with_rules(
            &params.project_id,
            &params.document_id,
            params.profile_id.as_deref(),
            &plugin_rules,
        )?)
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
