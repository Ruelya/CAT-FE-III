use std::path::Path;
use std::sync::{Arc, Mutex};

use translunar_plugin_runtime::{
    PluginCapabilityAuthorizer, PluginCapabilityCheck, PluginCapabilityDecision,
    PluginCapabilityDenial, PluginCapabilityDenialCode, PluginCapabilityId,
};
use translunar_protocol::{
    PluginCapabilityAuditEntry, PluginCapabilityAuditListParams,
    PluginCapabilityAuditPage as WireAuditPage, PluginCapabilityChange, PluginCapabilityChangeKind,
    PluginCapabilityDecisionParams, PluginCapabilityDecisionResult as WireDecisionResult,
    PluginCapabilityGrantParams, PluginCapabilityRequestListParams,
    PluginCapabilityRequestPage as WireRequestPage, PluginCapabilityRequestView,
    PluginCapabilityReview, PluginCapabilityReviewParams, PluginCapabilityRisk,
};
use translunar_storage::{
    PluginCapabilityAuditRecord, PluginCapabilityAuthorization, PluginCapabilityDecisionInput,
    PluginCapabilityDecisionResult as StorageDecisionResult, PluginCapabilityRequestRecord,
    PluginInstallationRecord, Store,
};

use crate::{EngineError, EngineService, Result};

pub(crate) struct PluginCapabilityService {
    authorizer: Arc<DurablePluginCapabilityAuthorizer>,
}

impl PluginCapabilityService {
    pub(crate) fn open(data_dir: &Path) -> Result<Self> {
        Ok(Self {
            authorizer: Arc::new(DurablePluginCapabilityAuthorizer {
                store: Mutex::new(Store::open_worker(data_dir)?),
            }),
        })
    }

    pub(crate) fn authorizer(&self) -> Arc<dyn PluginCapabilityAuthorizer> {
        self.authorizer.clone()
    }
}

struct DurablePluginCapabilityAuthorizer {
    store: Mutex<Store>,
}

impl DurablePluginCapabilityAuthorizer {
    fn authorize_with_mode(
        &self,
        check: &PluginCapabilityCheck,
        registration_preflight: bool,
    ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| Box::new(service_denial(check)))?;
        let authorization = if registration_preflight {
            store.authorize_plugin_registration(check)
        } else {
            store.authorize_plugin_capability(check)
        };
        match authorization {
            Ok(PluginCapabilityAuthorization::Allowed(_)) => Ok(()),
            Ok(PluginCapabilityAuthorization::Denied(denial)) => Err(Box::new(denial)),
            Err(error) => {
                tracing::error!(
                    plugin_id = %check.plugin_id,
                    capability_id = %check.capability_id,
                    error = %error,
                    "plugin capability authorization failed closed"
                );
                Err(Box::new(service_denial(check)))
            }
        }
    }
}

impl std::fmt::Debug for DurablePluginCapabilityAuthorizer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DurablePluginCapabilityAuthorizer")
            .finish_non_exhaustive()
    }
}

impl PluginCapabilityAuthorizer for DurablePluginCapabilityAuthorizer {
    fn authorize(
        &self,
        check: &PluginCapabilityCheck,
    ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
        self.authorize_with_mode(check, false)
    }

    fn authorize_registration(
        &self,
        check: &PluginCapabilityCheck,
    ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
        self.authorize_with_mode(check, true)
    }
}

impl EngineService {
    pub(crate) fn ensure_plugin_capabilities(
        &self,
        record: &PluginInstallationRecord,
        operation: &str,
    ) -> Result<()> {
        let version_id = record
            .active_version_id
            .as_deref()
            .ok_or_else(|| EngineError::InvalidState("plugin has no active version".to_string()))?;
        let page =
            self.store
                .list_plugin_capability_requests(&record.id, Some(version_id), 0, 200)?;
        if let Some(request) = page.items.iter().find(|request| {
            request.request.required
                && (!request.request.capability_id.is_supported()
                    || request.decision != PluginCapabilityDecision::Granted
                    || request.granted_scope.is_none())
        }) {
            return Err(EngineError::PluginCapabilityDenied(Box::new(
                denial_for_request(request, operation),
            )));
        }
        Ok(())
    }

    pub fn list_plugin_capability_requests(
        &self,
        params: PluginCapabilityRequestListParams,
    ) -> Result<WireRequestPage> {
        let page = self.store.list_plugin_capability_requests(
            &params.plugin_id,
            params.version_id.as_deref(),
            params.offset,
            params.limit,
        )?;
        Ok(WireRequestPage {
            items: page.items.into_iter().map(request_view).collect(),
            total: page.total,
            offset: page.offset,
            limit: page.limit,
        })
    }

    pub fn review_plugin_capabilities(
        &self,
        params: PluginCapabilityReviewParams,
    ) -> Result<PluginCapabilityReview> {
        let installation = self.store.get_plugin_installation(&params.plugin_id)?;
        let version_id = installation
            .active_version_id
            .clone()
            .ok_or_else(|| EngineError::InvalidState("plugin has no active version".to_string()))?;
        let current = self
            .store
            .list_plugin_capability_requests(&params.plugin_id, Some(&version_id), 0, 200)?
            .items;
        let (versions, _) = self.store.list_plugin_versions(&params.plugin_id, 0, 200)?;
        let previous_version_id = versions
            .iter()
            .filter(|version| version.id != version_id)
            .max_by_key(|version| {
                version
                    .deactivated_at_ms
                    .or(version.activated_at_ms)
                    .unwrap_or(version.installed_at_ms)
            })
            .map(|version| version.id.clone());
        let previous = if let Some(previous_version_id) = previous_version_id.as_deref() {
            self.store
                .list_plugin_capability_requests(
                    &params.plugin_id,
                    Some(previous_version_id),
                    0,
                    200,
                )?
                .items
        } else {
            Vec::new()
        };
        let changes = capability_changes(&current, &previous);
        Ok(PluginCapabilityReview {
            plugin: super::plugin::to_summary(installation),
            version_id,
            previous_version_id,
            requests: current.into_iter().map(request_view).collect(),
            changes,
        })
    }

    pub fn grant_plugin_capability(
        &mut self,
        params: PluginCapabilityGrantParams,
    ) -> Result<WireDecisionResult> {
        let plugin_id = params.plugin_id.clone();
        let result = self
            .store
            .decide_plugin_capability(PluginCapabilityDecisionInput {
                plugin_id: &params.plugin_id,
                request_id: &params.request_id,
                expected_revision: params.expected_revision,
                decision: PluginCapabilityDecision::Granted,
                grant_scope: Some(params.scope),
                actor: &params.actor,
                reason: &params.reason,
            })?;
        self.finish_capability_decision(&plugin_id, result)
    }

    pub fn deny_plugin_capability(
        &mut self,
        params: PluginCapabilityDecisionParams,
    ) -> Result<WireDecisionResult> {
        self.decide_plugin_capability(params, PluginCapabilityDecision::Denied)
    }

    pub fn revoke_plugin_capability(
        &mut self,
        params: PluginCapabilityDecisionParams,
    ) -> Result<WireDecisionResult> {
        self.decide_plugin_capability(params, PluginCapabilityDecision::Revoked)
    }

    fn decide_plugin_capability(
        &mut self,
        params: PluginCapabilityDecisionParams,
        decision: PluginCapabilityDecision,
    ) -> Result<WireDecisionResult> {
        let plugin_id = params.plugin_id.clone();
        let result = self
            .store
            .decide_plugin_capability(PluginCapabilityDecisionInput {
                plugin_id: &params.plugin_id,
                request_id: &params.request_id,
                expected_revision: params.expected_revision,
                decision,
                grant_scope: None,
                actor: &params.actor,
                reason: &params.reason,
            })?;
        self.finish_capability_decision(&plugin_id, result)
    }

    fn finish_capability_decision(
        &mut self,
        plugin_id: &str,
        result: StorageDecisionResult,
    ) -> Result<WireDecisionResult> {
        if result.detached {
            self.unregister_plugin_filters(plugin_id);
        }
        let plugin = self.store.get_plugin_installation(plugin_id)?;
        Ok(WireDecisionResult {
            request: request_view(result.request),
            plugin: super::plugin::to_summary(plugin),
            detached: result.detached,
        })
    }

    pub fn list_plugin_capability_audit(
        &self,
        params: PluginCapabilityAuditListParams,
    ) -> Result<WireAuditPage> {
        let page = self.store.list_plugin_capability_audit(
            &params.plugin_id,
            params.request_id.as_deref(),
            params.offset,
            params.limit,
        )?;
        Ok(WireAuditPage {
            items: page.items.into_iter().map(audit_entry).collect(),
            total: page.total,
            offset: page.offset,
            limit: page.limit,
        })
    }
}

fn request_view(record: PluginCapabilityRequestRecord) -> PluginCapabilityRequestView {
    let capability_id = record.request.capability_id.clone();
    let supported = capability_id.is_supported();
    PluginCapabilityRequestView {
        id: record.id,
        plugin_id: record.plugin_id,
        version_id: record.version_id,
        capability_id: capability_id.clone(),
        supported,
        required: record.request.required,
        requested_scope: record.request.scope,
        granted_scope: record.granted_scope,
        contribution_id: record.request.contribution_id,
        decision: record.decision,
        risk: capability_risk(&capability_id),
        effect_key: format!("plugin.permission.effect.{}", capability_id.as_str()),
        carried_from_request_id: record.carried_from_request_id,
        actor: record.actor,
        reason: record.reason,
        revision: record.revision,
        created_at_ms: record.created_at_ms,
        updated_at_ms: record.updated_at_ms,
        decided_at_ms: record.decided_at_ms,
    }
}

fn audit_entry(record: PluginCapabilityAuditRecord) -> PluginCapabilityAuditEntry {
    PluginCapabilityAuditEntry {
        sequence: record.sequence,
        id: record.id,
        plugin_id: record.plugin_id,
        version_id: record.version_id,
        request_id: record.request_id,
        capability_id: record.capability_id,
        scope: record.scope,
        event: record.event,
        outcome: record.outcome,
        operation: record.operation,
        actor: record.actor,
        reason: record.reason,
        request_revision: record.request_revision,
        created_at_ms: record.created_at_ms,
    }
}

fn capability_risk(capability_id: &PluginCapabilityId) -> PluginCapabilityRisk {
    match capability_id {
        PluginCapabilityId::DiagnosticsRead | PluginCapabilityId::ProjectRead => {
            PluginCapabilityRisk::Low
        }
        PluginCapabilityId::FileRead
        | PluginCapabilityId::AssetRead
        | PluginCapabilityId::QaRegister
        | PluginCapabilityId::PipelineRegister
        | PluginCapabilityId::UiPanel => PluginCapabilityRisk::Medium,
        PluginCapabilityId::FileWrite
        | PluginCapabilityId::AssetWrite
        | PluginCapabilityId::ProjectWrite
        | PluginCapabilityId::AiAction
        | PluginCapabilityId::EngineConnector => PluginCapabilityRisk::High,
        PluginCapabilityId::NetworkConnect | PluginCapabilityId::ExternalConnector => {
            PluginCapabilityRisk::Critical
        }
        PluginCapabilityId::Unsupported(_) => PluginCapabilityRisk::Critical,
    }
}

fn capability_changes(
    current: &[PluginCapabilityRequestRecord],
    previous: &[PluginCapabilityRequestRecord],
) -> Vec<PluginCapabilityChange> {
    let mut matched_previous = vec![false; previous.len()];
    let mut changes = Vec::new();
    for request in current {
        let exact = previous.iter().enumerate().find(|(_, prior)| {
            prior.request.capability_id == request.request.capability_id
                && prior.request.contribution_id == request.request.contribution_id
                && prior.request.required == request.request.required
                && prior.request.scope == request.request.scope
        });
        if let Some((index, prior)) = exact {
            matched_previous[index] = true;
            changes.push(change(
                request,
                Some(prior),
                PluginCapabilityChangeKind::Unchanged,
            ));
            continue;
        }
        let related = previous.iter().enumerate().find(|(index, prior)| {
            !matched_previous[*index]
                && prior.request.capability_id == request.request.capability_id
                && prior.request.contribution_id == request.request.contribution_id
        });
        if let Some((index, prior)) = related {
            matched_previous[index] = true;
            let kind = if request.request.scope.allows(&prior.request.scope) {
                PluginCapabilityChangeKind::Expanded
            } else if prior.request.scope.allows(&request.request.scope) {
                PluginCapabilityChangeKind::Narrowed
            } else {
                PluginCapabilityChangeKind::Expanded
            };
            changes.push(change(request, Some(prior), kind));
        } else {
            changes.push(change(request, None, PluginCapabilityChangeKind::Added));
        }
    }
    for (index, prior) in previous.iter().enumerate() {
        if !matched_previous[index] {
            changes.push(PluginCapabilityChange {
                capability_id: prior.request.capability_id.clone(),
                contribution_id: prior.request.contribution_id.clone(),
                kind: PluginCapabilityChangeKind::Removed,
                previous_scope: Some(prior.request.scope.clone()),
                requested_scope: None,
            });
        }
    }
    changes
}

fn change(
    request: &PluginCapabilityRequestRecord,
    previous: Option<&PluginCapabilityRequestRecord>,
    kind: PluginCapabilityChangeKind,
) -> PluginCapabilityChange {
    PluginCapabilityChange {
        capability_id: request.request.capability_id.clone(),
        contribution_id: request.request.contribution_id.clone(),
        kind,
        previous_scope: previous.map(|record| record.request.scope.clone()),
        requested_scope: Some(request.request.scope.clone()),
    }
}

fn denial_for_request(
    request: &PluginCapabilityRequestRecord,
    operation: &str,
) -> PluginCapabilityDenial {
    let code = match request.decision {
        PluginCapabilityDecision::Pending => PluginCapabilityDenialCode::Pending,
        PluginCapabilityDecision::Denied => PluginCapabilityDenialCode::Denied,
        PluginCapabilityDecision::Revoked => PluginCapabilityDenialCode::Revoked,
        PluginCapabilityDecision::Granted => PluginCapabilityDenialCode::ScopeMismatch,
    };
    PluginCapabilityDenial {
        code,
        plugin_id: request.plugin_id.clone(),
        version_id: request.version_id.clone(),
        capability_id: request.request.capability_id.clone(),
        operation: bounded_detail(operation, 128),
        request_id: Some(request.id.clone()),
        message: match code {
            PluginCapabilityDenialCode::Pending => "required capability is awaiting review",
            PluginCapabilityDenialCode::Denied => "required capability was denied",
            PluginCapabilityDenialCode::Revoked => "required capability was revoked",
            _ => "required capability has no valid grant",
        }
        .to_string(),
    }
}

fn service_denial(check: &PluginCapabilityCheck) -> PluginCapabilityDenial {
    PluginCapabilityDenial {
        code: PluginCapabilityDenialCode::Unsupported,
        plugin_id: bounded_detail(&check.plugin_id, 128),
        version_id: bounded_detail(&check.version_id, 256),
        capability_id: check.capability_id.clone(),
        operation: bounded_detail(&check.operation, 128),
        request_id: None,
        message: "capability service is unavailable".to_string(),
    }
}

fn bounded_detail(value: &str, max_bytes: usize) -> String {
    let mut output = String::new();
    for character in value.chars().filter(|character| !character.is_control()) {
        if output.len().saturating_add(character.len_utf8()) > max_bytes {
            break;
        }
        output.push(character);
    }
    output
}
