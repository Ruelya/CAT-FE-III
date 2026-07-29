//! Engine-owned public AI-action and workbench-panel registries.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use sha2::Digest;
use translunar_plugin_runtime::{
    AI_ACTION_OPERATION_INVOKE, AI_ACTION_OPERATION_PROTOCOL_VERSION, AiActionContextV1,
    AiActionContributionDescriptor, AiActionFailureCodeV1, AiActionInputFieldV1,
    AiActionInvocationV1, AiActionResultV1, PluginCapabilityAuthorizer, PluginCapabilityCheck,
    PluginCapabilityId, PluginCapabilityScope, SandboxCancellationToken, SandboxError,
    SandboxInvocationV1, SandboxRuntimeKey, SandboxRuntimeRegistry, UiPanelBridgeMethodV1,
    UiPanelContributionDescriptor,
};
use translunar_protocol::{
    PluginAiActionInvokeResult, PluginAiActionView, PluginContributionOwner,
    PluginContributionState, PluginUiPanelBridgeCallParams, PluginUiPanelBridgeCallResult,
    PluginUiPanelView,
};

use crate::{EngineError, Result};

/// In-flight AI action cancel tokens shared with the sequential stdio cancel path.
#[derive(Clone, Default)]
pub(crate) struct AiActionCancelRegistry {
    tokens: Arc<Mutex<HashMap<String, SandboxCancellationToken>>>,
}

impl AiActionCancelRegistry {
    pub(crate) fn register(&self, invocation_id: &str, token: SandboxCancellationToken) {
        if let Ok(mut guard) = self.tokens.lock() {
            guard.insert(invocation_id.to_string(), token);
        }
    }

    pub(crate) fn cancel(&self, invocation_id: &str) -> bool {
        self.tokens
            .lock()
            .ok()
            .and_then(|guard| guard.get(invocation_id).cloned())
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }

    pub(crate) fn forget(&self, invocation_id: &str) {
        if let Ok(mut guard) = self.tokens.lock() {
            guard.remove(invocation_id);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContributionOwnerToken {
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contribution_id: String,
}

impl ContributionOwnerToken {
    fn wire(&self) -> PluginContributionOwner {
        PluginContributionOwner {
            plugin_id: self.plugin_id.clone(),
            version_id: self.version_id.clone(),
            activation_revision: self.activation_revision,
            contribution_id: self.contribution_id.clone(),
        }
    }

    fn belongs_to_generation(
        &self,
        plugin_id: &str,
        version_id: &str,
        activation_revision: u64,
    ) -> bool {
        self.plugin_id == plugin_id
            && self.version_id == version_id
            && self.activation_revision == activation_revision
    }
}

#[derive(Clone)]
pub(crate) struct AiActionRegistration {
    pub owner: ContributionOwnerToken,
    pub descriptor: AiActionContributionDescriptor,
    pub sandbox_key: SandboxRuntimeKey,
    pub authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

#[derive(Clone, Default)]
pub(crate) struct PluginAiActionRegistry {
    entries: Arc<RwLock<BTreeMap<String, AiActionRegistration>>>,
}

impl PluginAiActionRegistry {
    pub(crate) fn preflight(&self, candidates: &[AiActionRegistration]) -> Result<()> {
        let entries = self.entries.read().map_err(|_| {
            EngineError::InvalidState("plugin AI action registry is unavailable".to_string())
        })?;
        let mut ids = BTreeSet::new();
        for candidate in candidates {
            let id = &candidate.owner.contribution_id;
            if id.starts_with("builtin.") || !ids.insert(id) || entries.contains_key(id) {
                return Err(EngineError::PluginConflict(format!(
                    "AI action contribution id {id} is already registered or reserved"
                )));
            }
        }
        Ok(())
    }

    pub(crate) fn attach_all(&self, candidates: Vec<AiActionRegistration>) -> Result<()> {
        let mut entries = self.entries.write().map_err(|_| {
            EngineError::InvalidState("plugin AI action registry is unavailable".to_string())
        })?;
        let mut ids = BTreeSet::new();
        for candidate in &candidates {
            let id = &candidate.owner.contribution_id;
            if id.starts_with("builtin.") || !ids.insert(id) || entries.contains_key(id) {
                return Err(EngineError::PluginConflict(format!(
                    "AI action contribution id {id} is already registered or reserved"
                )));
            }
        }
        for candidate in candidates {
            entries.insert(candidate.owner.contribution_id.clone(), candidate);
        }
        Ok(())
    }

    pub(crate) fn detach_generation(
        &self,
        plugin_id: &str,
        version_id: &str,
        activation_revision: u64,
    ) {
        if let Ok(mut entries) = self.entries.write() {
            entries.retain(|_, entry| {
                !entry
                    .owner
                    .belongs_to_generation(plugin_id, version_id, activation_revision)
            });
        }
    }

    pub(crate) fn views(&self) -> Vec<PluginAiActionView> {
        let mut views = self
            .entries
            .read()
            .map(|entries| {
                entries
                    .values()
                    .map(|entry| PluginAiActionView {
                        owner: entry.owner.wire(),
                        descriptor: entry.descriptor.clone(),
                        state: PluginContributionState::Active,
                        last_failure_code: None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        views.sort_by(|left, right| {
            left.descriptor
                .placement
                .cmp(&right.descriptor.placement)
                .then(left.owner.contribution_id.cmp(&right.owner.contribution_id))
        });
        views
    }

    fn resolve(&self, contribution_id: &str) -> Result<AiActionRegistration> {
        self.entries
            .read()
            .map_err(|_| {
                EngineError::InvalidState("plugin AI action registry is unavailable".to_string())
            })?
            .get(contribution_id)
            .cloned()
            .ok_or_else(|| {
                EngineError::InvalidRequest(format!("AI action {contribution_id} was not found"))
            })
    }

    fn is_current(&self, registration: &AiActionRegistration) -> bool {
        self.entries.read().is_ok_and(|entries| {
            entries
                .get(&registration.owner.contribution_id)
                .is_some_and(|current| {
                    current.owner == registration.owner
                        && current.sandbox_key == registration.sandbox_key
                })
        })
    }
}

#[derive(Clone)]
pub(crate) struct UiPanelRegistration {
    pub owner: ContributionOwnerToken,
    pub descriptor: UiPanelContributionDescriptor,
    pub authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

#[derive(Clone, Default)]
pub(crate) struct PluginUiPanelRegistry {
    entries: Arc<RwLock<BTreeMap<String, UiPanelRegistration>>>,
}

impl PluginUiPanelRegistry {
    pub(crate) fn preflight(&self, candidates: &[UiPanelRegistration]) -> Result<()> {
        let entries = self.entries.read().map_err(|_| {
            EngineError::InvalidState("plugin UI panel registry is unavailable".to_string())
        })?;
        let mut ids = BTreeSet::new();
        for candidate in candidates {
            let id = &candidate.owner.contribution_id;
            if id.starts_with("builtin.") || !ids.insert(id) || entries.contains_key(id) {
                return Err(EngineError::PluginConflict(format!(
                    "UI panel contribution id {id} is already registered or reserved"
                )));
            }
        }
        Ok(())
    }

    pub(crate) fn attach_all(&self, candidates: Vec<UiPanelRegistration>) -> Result<()> {
        let mut entries = self.entries.write().map_err(|_| {
            EngineError::InvalidState("plugin UI panel registry is unavailable".to_string())
        })?;
        let mut ids = BTreeSet::new();
        for candidate in &candidates {
            let id = &candidate.owner.contribution_id;
            if id.starts_with("builtin.") || !ids.insert(id) || entries.contains_key(id) {
                return Err(EngineError::PluginConflict(format!(
                    "UI panel contribution id {id} is already registered or reserved"
                )));
            }
        }
        for candidate in candidates {
            entries.insert(candidate.owner.contribution_id.clone(), candidate);
        }
        Ok(())
    }

    pub(crate) fn detach_generation(
        &self,
        plugin_id: &str,
        version_id: &str,
        activation_revision: u64,
    ) {
        if let Ok(mut entries) = self.entries.write() {
            entries.retain(|_, entry| {
                !entry
                    .owner
                    .belongs_to_generation(plugin_id, version_id, activation_revision)
            });
        }
    }

    pub(crate) fn views(&self) -> Vec<PluginUiPanelView> {
        let mut views = self
            .entries
            .read()
            .map(|entries| {
                entries
                    .values()
                    .map(|entry| PluginUiPanelView {
                        owner: entry.owner.wire(),
                        descriptor: entry.descriptor.clone(),
                        state: PluginContributionState::Active,
                        last_failure_code: None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        views.sort_by(|left, right| {
            left.descriptor
                .placement
                .cmp(&right.descriptor.placement)
                .then(left.descriptor.order.cmp(&right.descriptor.order))
                .then(left.owner.contribution_id.cmp(&right.owner.contribution_id))
        });
        views
    }

    fn resolve(&self, contribution_id: &str) -> Result<UiPanelRegistration> {
        self.entries
            .read()
            .map_err(|_| {
                EngineError::InvalidState("plugin UI panel registry is unavailable".to_string())
            })?
            .get(contribution_id)
            .cloned()
            .ok_or_else(|| {
                EngineError::InvalidRequest(format!("UI panel {contribution_id} was not found"))
            })
    }

    fn is_current(&self, registration: &UiPanelRegistration) -> bool {
        self.entries.read().is_ok_and(|entries| {
            entries
                .get(&registration.owner.contribution_id)
                .is_some_and(|current| current.owner == registration.owner)
        })
    }
}

/// Restrict the plugin-visible context to fields declared on the descriptor.
pub(crate) fn shape_ai_action_context(
    context: &AiActionContextV1,
    fields: &[AiActionInputFieldV1],
) -> AiActionContextV1 {
    let allow: BTreeSet<_> = fields.iter().copied().collect();
    AiActionContextV1 {
        selection_text: allow
            .contains(&AiActionInputFieldV1::SelectionText)
            .then(|| context.selection_text.clone())
            .flatten(),
        segment_text: if allow.contains(&AiActionInputFieldV1::SegmentText) {
            context.segment_text.clone()
        } else {
            String::new()
        },
        source_text: if allow.contains(&AiActionInputFieldV1::SourceText) {
            context.source_text.clone()
        } else {
            String::new()
        },
        source_locale: if allow.contains(&AiActionInputFieldV1::SourceLocale) {
            context.source_locale.clone()
        } else {
            String::new()
        },
        target_locale: if allow.contains(&AiActionInputFieldV1::TargetLocale) {
            context.target_locale.clone()
        } else {
            String::new()
        },
        tags: if allow.contains(&AiActionInputFieldV1::Tags) {
            context.tags.clone()
        } else {
            Vec::new()
        },
    }
}

pub(crate) fn invoke_ai_action(
    registry: &PluginAiActionRegistry,
    runtimes: &SandboxRuntimeRegistry,
    cancels: &AiActionCancelRegistry,
    mut invocation: AiActionInvocationV1,
    cancellation: SandboxCancellationToken,
) -> Result<PluginAiActionInvokeResult> {
    let registration = registry.resolve(&invocation.contribution_id)?;
    invocation
        .validate(&registration.descriptor)
        .map_err(map_contract_error)?;
    // Engine-owned privacy shaping: plugins only see declared input fields.
    invocation.context =
        shape_ai_action_context(&invocation.context, &registration.descriptor.input_fields);
    registration
        .authorizer
        .authorize(&PluginCapabilityCheck {
            plugin_id: registration.owner.plugin_id.clone(),
            version_id: registration.owner.version_id.clone(),
            capability_id: PluginCapabilityId::AiAction,
            scope: PluginCapabilityScope::Contributions {
                contribution_ids: vec![registration.owner.contribution_id.clone()],
            },
            operation: AI_ACTION_OPERATION_INVOKE.to_string(),
            contribution_id: Some(registration.owner.contribution_id.clone()),
        })
        .map_err(EngineError::PluginCapabilityDenied)?;
    let worker = runtimes.get(&registration.sandbox_key).ok_or_else(|| {
        action_failure(
            &registration,
            AiActionFailureCodeV1::HostFailed,
            "plugin sandbox is unavailable",
        )
    })?;
    cancels.register(&invocation.invocation_id, cancellation.clone());
    let started = Instant::now();
    let response = worker
        .invoke_with_timeout_and_cancellation(
            SandboxInvocationV1 {
                protocol_version: AI_ACTION_OPERATION_PROTOCOL_VERSION,
                invocation_id: invocation.invocation_id.clone(),
                contribution_id: invocation.contribution_id.clone(),
                operation: AI_ACTION_OPERATION_INVOKE.to_string(),
                input: serde_json::to_value(&invocation).map_err(|error| {
                    EngineError::InvalidRequest(format!("invalid AI action invocation: {error}"))
                })?,
            },
            Duration::from_millis(invocation.deadline_ms),
            cancellation.clone(),
        )
        .map_err(|error| {
            cancels.forget(&invocation.invocation_id);
            map_sandbox_error(&registration, error)
        });
    cancels.forget(&invocation.invocation_id);
    let response = response?;
    if cancellation.is_cancelled() {
        return Err(action_failure(
            &registration,
            AiActionFailureCodeV1::Cancelled,
            "plugin AI action was cancelled",
        ));
    }
    if !registry.is_current(&registration) {
        return Err(action_failure(
            &registration,
            AiActionFailureCodeV1::StaleActivation,
            "plugin AI action activation is stale",
        ));
    }
    if !response.ok {
        let error = response
            .error
            .unwrap_or(translunar_plugin_runtime::SandboxPluginErrorV1 {
                code: "host_failed".to_string(),
                message: "plugin AI action failed".to_string(),
                retryable: false,
            });
        return Err(action_failure_with_code(
            &registration,
            normalize_failure_code(&error.code),
            "plugin AI action reported a failure",
        ));
    }
    let output = response.output.ok_or_else(|| {
        action_failure(
            &registration,
            AiActionFailureCodeV1::InvalidResult,
            "plugin AI action returned no result",
        )
    })?;
    let mut result: AiActionResultV1 = serde_json::from_value(output).map_err(|_| {
        action_failure(
            &registration,
            AiActionFailureCodeV1::InvalidResult,
            "plugin AI action result is malformed",
        )
    })?;
    result.usage.duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let canonical = result
        .validate(&invocation, &registration.descriptor)
        .map_err(|_| {
            action_failure(
                &registration,
                AiActionFailureCodeV1::InvalidResult,
                "plugin AI action result failed validation",
            )
        })?;
    let canonical_bytes = serde_json::to_vec(&canonical).map_err(|_| {
        action_failure(
            &registration,
            AiActionFailureCodeV1::InvalidResult,
            "plugin AI action result could not be canonicalized",
        )
    })?;
    Ok(PluginAiActionInvokeResult {
        owner: registration.owner.wire(),
        descriptor: registration.descriptor,
        result,
        canonical_sha256: format!("{:x}", sha2::Sha256::digest(canonical_bytes)),
    })
}

/// Derive bounded panel bridge results. `store` is used for project/segment
/// context; renderer may only supply identifiers (`projectId` / `segmentId`).
pub(crate) fn call_ui_panel_bridge(
    registry: &PluginUiPanelRegistry,
    store: &translunar_storage::Store,
    params: PluginUiPanelBridgeCallParams,
) -> Result<PluginUiPanelBridgeCallResult> {
    let registration = registry.resolve(&params.owner.contribution_id)?;
    if registration.owner.plugin_id != params.owner.plugin_id
        || registration.owner.version_id != params.owner.version_id
        || registration.owner.activation_revision != params.owner.activation_revision
        || registration.owner.contribution_id != params.owner.contribution_id
    {
        return Err(panel_capability_denied(
            &registration,
            "panel.bridge",
            "panel owner token does not match the active generation",
        ));
    }
    if !registry.is_current(&registration) {
        return Err(EngineError::InvalidState(
            "panel contribution activation is stale".to_string(),
        ));
    }
    let method = parse_bridge_method(&params.method)?;
    if !registration.descriptor.methods.contains(&method) {
        return Err(panel_capability_denied(
            &registration,
            "panel.bridge",
            &format!("panel bridge method {} is not declared", params.method),
        ));
    }
    // Always re-check ui.panel for the contribution.
    registration
        .authorizer
        .authorize(&PluginCapabilityCheck {
            plugin_id: registration.owner.plugin_id.clone(),
            version_id: registration.owner.version_id.clone(),
            capability_id: PluginCapabilityId::UiPanel,
            scope: PluginCapabilityScope::Contributions {
                contribution_ids: vec![registration.owner.contribution_id.clone()],
            },
            operation: match method {
                UiPanelBridgeMethodV1::PanelContext => "ui.panel.panelContext",
                UiPanelBridgeMethodV1::ActiveSelection => "ui.panel.activeSelection",
                UiPanelBridgeMethodV1::ProjectContext => "ui.panel.projectContext",
                UiPanelBridgeMethodV1::ProposeReplacement => "ui.panel.proposeReplacement",
            }
            .to_string(),
            contribution_id: Some(registration.owner.contribution_id.clone()),
        })
        .map_err(EngineError::PluginCapabilityDenied)?;

    validate_bridge_params(method, &params.params)?;
    let project_id = params
        .params
        .get("projectId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let segment_id = params
        .params
        .get("segmentId")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    // Nested capabilities: default-deny without exact project scope grants.
    match method {
        UiPanelBridgeMethodV1::ActiveSelection | UiPanelBridgeMethodV1::ProjectContext => {
            let project_id = project_id.as_deref().ok_or_else(|| {
                EngineError::InvalidRequest(
                    "panel bridge method requires projectId identifier".to_string(),
                )
            })?;
            registration
                .authorizer
                .authorize(&PluginCapabilityCheck {
                    plugin_id: registration.owner.plugin_id.clone(),
                    version_id: registration.owner.version_id.clone(),
                    capability_id: PluginCapabilityId::ProjectRead,
                    scope: PluginCapabilityScope::Projects {
                        project_ids: vec![project_id.to_string()],
                    },
                    operation: "panel.project.read".to_string(),
                    contribution_id: Some(registration.owner.contribution_id.clone()),
                })
                .map_err(EngineError::PluginCapabilityDenied)?;
        }
        UiPanelBridgeMethodV1::ProposeReplacement => {
            let project_id = project_id.as_deref().ok_or_else(|| {
                EngineError::InvalidRequest(
                    "proposeReplacement requires projectId identifier".to_string(),
                )
            })?;
            registration
                .authorizer
                .authorize(&PluginCapabilityCheck {
                    plugin_id: registration.owner.plugin_id.clone(),
                    version_id: registration.owner.version_id.clone(),
                    capability_id: PluginCapabilityId::ProjectWrite,
                    scope: PluginCapabilityScope::Projects {
                        project_ids: vec![project_id.to_string()],
                    },
                    operation: "panel.project.write".to_string(),
                    contribution_id: Some(registration.owner.contribution_id.clone()),
                })
                .map_err(EngineError::PluginCapabilityDenied)?;
        }
        UiPanelBridgeMethodV1::PanelContext => {}
    }

    let result = match method {
        UiPanelBridgeMethodV1::PanelContext => serde_json::json!({
            "pluginId": registration.owner.plugin_id,
            "contributionId": registration.owner.contribution_id,
            "revision": registration.owner.activation_revision,
            "displayName": registration.descriptor.display_name,
            "label": registration.descriptor.label,
            // Host-facing aliases used by public panel example scripts.
            "pluginName": registration.descriptor.display_name,
            "contributionName": registration.descriptor.display_name,
        }),
        UiPanelBridgeMethodV1::ActiveSelection => {
            let project_id = project_id.as_deref().ok_or_else(|| {
                EngineError::InvalidRequest(
                    "panel bridge method requires projectId identifier".to_string(),
                )
            })?;
            let project = store.get_project(project_id)?;
            let (has_active_segment, segment_ordinal) =
                if let Some(segment_id) = segment_id.as_deref() {
                    match store.get_segment(segment_id) {
                        Ok(segment) => match store.get_document(&segment.document_id) {
                            Ok(document) if document.document.project_id == project_id => {
                                (true, Some(segment.ordinal))
                            }
                            _ => (false, None),
                        },
                        Err(_) => (false, None),
                    }
                } else {
                    (false, None)
                };
            // Bounded Engine-derived envelope only — no source/target text.
            serde_json::json!({
                "hasActiveSegment": has_active_segment,
                "segmentOrdinal": segment_ordinal,
                "sourceLocale": project.project.source_locale,
                "targetLocale": project.project.target_locale,
            })
        }
        UiPanelBridgeMethodV1::ProjectContext => {
            let project_id = project_id.as_deref().ok_or_else(|| {
                EngineError::InvalidRequest(
                    "panel bridge method requires projectId identifier".to_string(),
                )
            })?;
            let project = store.get_project(project_id)?;
            serde_json::json!({
                "projectId": project.project.id,
                "sourceLocale": project.project.source_locale,
                "targetLocale": project.project.target_locale,
                "domain": project.project.domain,
                "pluginId": registration.owner.plugin_id,
                "versionId": registration.owner.version_id,
                "contributionId": registration.owner.contribution_id,
                "placement": registration.descriptor.placement,
            })
        }
        UiPanelBridgeMethodV1::ProposeReplacement => {
            let text = params
                .params
                .get("text")
                .and_then(|value| value.as_str())
                .ok_or_else(|| {
                    EngineError::InvalidRequest(
                        "proposeReplacement requires a bounded text field".to_string(),
                    )
                })?;
            if text.is_empty() || text.len() > 256 * 1024 {
                return Err(EngineError::InvalidRequest(
                    "proposeReplacement text is empty or oversized".to_string(),
                ));
            }
            if text.chars().any(char::is_control) {
                return Err(EngineError::InvalidRequest(
                    "proposeReplacement text is malformed".to_string(),
                ));
            }
            let hash = format!("{:x}", sha2::Sha256::digest(text.as_bytes()));
            // Explicit proposal envelope only — never mutates segment state.
            serde_json::json!({
                "accepted": false,
                "projectId": project_id,
                "segmentId": segment_id,
                "proposal": {
                    "kind": "replaceTarget",
                    "textSha256": hash,
                    "bytes": text.len() as u64,
                }
            })
        }
    };
    Ok(PluginUiPanelBridgeCallResult {
        owner: registration.owner.wire(),
        method: params.method,
        result,
    })
}

fn validate_bridge_params(method: UiPanelBridgeMethodV1, params: &serde_json::Value) -> Result<()> {
    let object = params.as_object().ok_or_else(|| {
        EngineError::InvalidRequest("panel bridge params must be an object".to_string())
    })?;
    let allowed: &[&str] = match method {
        UiPanelBridgeMethodV1::PanelContext => &[],
        UiPanelBridgeMethodV1::ActiveSelection => &["projectId", "segmentId"],
        UiPanelBridgeMethodV1::ProjectContext => &["projectId"],
        UiPanelBridgeMethodV1::ProposeReplacement => &["projectId", "segmentId", "text"],
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(EngineError::InvalidRequest(
            "panel bridge params contain an unknown field".to_string(),
        ));
    }
    for key in ["projectId", "segmentId"] {
        if let Some(value) = object.get(key)
            && value.as_str().is_none_or(|text| {
                text.is_empty()
                    || text.len() > 128
                    || !text
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
            })
        {
            return Err(EngineError::InvalidRequest(format!(
                "panel bridge {key} is malformed or oversized"
            )));
        }
    }
    Ok(())
}

fn parse_bridge_method(value: &str) -> Result<UiPanelBridgeMethodV1> {
    match value {
        "panel.context" | "panelContext" => Ok(UiPanelBridgeMethodV1::PanelContext),
        "panel.activeSelection" | "activeSelection" => Ok(UiPanelBridgeMethodV1::ActiveSelection),
        "panel.projectContext" | "projectContext" => Ok(UiPanelBridgeMethodV1::ProjectContext),
        "panel.proposeReplacement" | "proposeReplacement" => {
            Ok(UiPanelBridgeMethodV1::ProposeReplacement)
        }
        _ => Err(EngineError::InvalidRequest(
            "unsupported panel bridge method".to_string(),
        )),
    }
}

fn panel_capability_denied(
    registration: &UiPanelRegistration,
    operation: &str,
    message: &str,
) -> EngineError {
    EngineError::PluginCapabilityDenied(Box::new(
        translunar_plugin_runtime::PluginCapabilityDenial {
            code: translunar_plugin_runtime::PluginCapabilityDenialCode::ScopeMismatch,
            plugin_id: registration.owner.plugin_id.clone(),
            version_id: registration.owner.version_id.clone(),
            capability_id: PluginCapabilityId::UiPanel,
            operation: operation.to_string(),
            request_id: None,
            message: message.to_string(),
        },
    ))
}

fn failure_code(code: AiActionFailureCodeV1) -> &'static str {
    match code {
        AiActionFailureCodeV1::InvalidRequest => "invalid_request",
        AiActionFailureCodeV1::PermissionDenied => "permission_denied",
        AiActionFailureCodeV1::Timeout => "timeout",
        AiActionFailureCodeV1::Cancelled => "cancelled",
        AiActionFailureCodeV1::InvalidResult => "invalid_result",
        AiActionFailureCodeV1::HostFailed => "host_failed",
        AiActionFailureCodeV1::StaleActivation => "stale_activation",
        AiActionFailureCodeV1::ProtocolError => "protocol_error",
        AiActionFailureCodeV1::ResourceLimit => "resource_limit",
    }
}

fn map_contract_error(error: translunar_plugin_runtime::PluginRuntimeError) -> EngineError {
    EngineError::InvalidRequest(error.to_string())
}

fn normalize_failure_code(code: &str) -> &'static str {
    match code {
        "invalid_request" => "invalid_request",
        "permission_denied" => "permission_denied",
        "timeout" => "timeout",
        "cancelled" => "cancelled",
        "invalid_result" => "invalid_result",
        "host_failed" => "host_failed",
        "stale_activation" => "stale_activation",
        "protocol_error" => "protocol_error",
        "resource_limit" => "resource_limit",
        _ => "protocol_error",
    }
}

fn action_failure(
    registration: &AiActionRegistration,
    code: AiActionFailureCodeV1,
    message: &str,
) -> EngineError {
    action_failure_with_code(registration, failure_code(code), message)
}

fn action_failure_with_code(
    registration: &AiActionRegistration,
    code: &str,
    message: &str,
) -> EngineError {
    EngineError::PluginAiActionFailed {
        plugin_id: registration.owner.plugin_id.clone(),
        contribution_id: registration.owner.contribution_id.clone(),
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn map_sandbox_error(registration: &AiActionRegistration, error: SandboxError) -> EngineError {
    let code = match error {
        SandboxError::Cancelled => "cancelled",
        SandboxError::Timeout => "timeout",
        SandboxError::ResourceLimit { .. } | SandboxError::QueueFull => "resource_limit",
        SandboxError::HostCallDenied { .. } => "permission_denied",
        SandboxError::Codec { .. } => "invalid_result",
        SandboxError::Script { .. } | SandboxError::Module { .. } => "protocol_error",
        _ => "host_failed",
    };
    action_failure_with_code(
        registration,
        code,
        &translunar_plugin_runtime::sandbox_safe_diagnostic(&error, 1_024),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use translunar_plugin_runtime::UiPanelBridgeMethodV1;

    fn owner(id: &str, revision: u64) -> ContributionOwnerToken {
        ContributionOwnerToken {
            plugin_id: "example.plugin".to_string(),
            version_id: format!("version-{revision}"),
            activation_revision: revision,
            contribution_id: id.to_string(),
        }
    }

    #[derive(Debug)]
    struct AllowAll;

    impl PluginCapabilityAuthorizer for AllowAll {
        fn authorize(
            &self,
            _: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<translunar_plugin_runtime::PluginCapabilityDenial>>
        {
            Ok(())
        }
    }

    fn panel(id: &str, revision: u64) -> UiPanelRegistration {
        UiPanelRegistration {
            owner: owner(id, revision),
            descriptor: UiPanelContributionDescriptor {
                descriptor_version: 1,
                id: id.to_string(),
                version: "1.0.0".to_string(),
                display_name: "Panel".to_string(),
                label: "Panel".to_string(),
                placement: "editorSidebar".to_string(),
                surface: "panel.html".to_string(),
                bridge_version: 1,
                contract_version: Some(1),
                methods: vec![UiPanelBridgeMethodV1::PanelContext],
                order: 0,
            },
            authorizer: Arc::new(AllowAll),
        }
    }

    #[test]
    fn shapes_context_to_declared_input_fields_only() {
        let context = AiActionContextV1 {
            selection_text: Some("colour".into()),
            segment_text: "segment".into(),
            source_text: "source".into(),
            source_locale: "en-GB".into(),
            target_locale: "en-US".into(),
            tags: Vec::new(),
        };
        let shaped = shape_ai_action_context(
            &context,
            &[
                AiActionInputFieldV1::SelectionText,
                AiActionInputFieldV1::TargetLocale,
            ],
        );
        assert_eq!(shaped.selection_text.as_deref(), Some("colour"));
        assert_eq!(shaped.target_locale, "en-US");
        assert!(shaped.segment_text.is_empty());
        assert!(shaped.source_text.is_empty());
        assert!(shaped.source_locale.is_empty());
        assert!(shaped.tags.is_empty());
    }

    #[test]
    fn cancel_registry_marks_tokens() {
        let registry = AiActionCancelRegistry::default();
        let token = SandboxCancellationToken::default();
        registry.register("inv-1", token.clone());
        assert!(!token.is_cancelled());
        assert!(registry.cancel("inv-1"));
        assert!(token.is_cancelled());
        registry.forget("inv-1");
        assert!(!registry.cancel("inv-1"));
    }

    #[test]
    fn bridge_rejects_renderer_locale_payloads_and_stale_owners() {
        use tempfile::tempdir;
        use translunar_protocol::PluginUiPanelBridgeCallParams;
        use translunar_storage::Store;

        let data = tempdir().expect("data");
        let store = Store::open(data.path()).expect("store");
        let registry = PluginUiPanelRegistry::default();
        registry
            .attach_all(vec![panel("example.panel", 1)])
            .unwrap();
        let err = call_ui_panel_bridge(
            &registry,
            &store,
            PluginUiPanelBridgeCallParams {
                owner: translunar_protocol::PluginContributionOwner {
                    plugin_id: "example.plugin".into(),
                    version_id: "version-1".into(),
                    activation_revision: 1,
                    contribution_id: "example.panel".into(),
                },
                method: "panel.context".into(),
                params: serde_json::json!({
                    "sourceLocale": "en-US",
                    "hasActiveSegment": true,
                }),
            },
        )
        .expect_err("renderer locale payload must fail closed");
        assert!(err.to_string().contains("unknown field"));

        let stale = call_ui_panel_bridge(
            &registry,
            &store,
            PluginUiPanelBridgeCallParams {
                owner: translunar_protocol::PluginContributionOwner {
                    plugin_id: "example.plugin".into(),
                    version_id: "version-1".into(),
                    activation_revision: 99,
                    contribution_id: "example.panel".into(),
                },
                method: "panel.context".into(),
                params: serde_json::json!({}),
            },
        )
        .expect_err("stale owner token fails");
        assert!(
            matches!(stale, EngineError::PluginCapabilityDenied(_))
                || stale.to_string().contains("owner token")
        );
    }

    #[test]
    fn bridge_default_denies_project_read_methods_without_grant() {
        use tempfile::tempdir;
        use translunar_protocol::PluginUiPanelBridgeCallParams;
        use translunar_storage::Store;

        #[derive(Debug)]
        struct DenyProject;

        impl PluginCapabilityAuthorizer for DenyProject {
            fn authorize(
                &self,
                check: &PluginCapabilityCheck,
            ) -> std::result::Result<(), Box<translunar_plugin_runtime::PluginCapabilityDenial>>
            {
                if check.capability_id == PluginCapabilityId::UiPanel {
                    return Ok(());
                }
                Err(Box::new(
                    translunar_plugin_runtime::PluginCapabilityDenial {
                        code: translunar_plugin_runtime::PluginCapabilityDenialCode::NotRequested,
                        plugin_id: check.plugin_id.clone(),
                        version_id: check.version_id.clone(),
                        capability_id: check.capability_id.clone(),
                        operation: check.operation.clone(),
                        request_id: None,
                        message: "nested project scope denied".into(),
                    },
                ))
            }
        }

        let data = tempdir().expect("data");
        let store = Store::open(data.path()).expect("store");
        let registry = PluginUiPanelRegistry::default();
        let mut registration = panel("example.panel", 1);
        registration.descriptor.methods = vec![
            UiPanelBridgeMethodV1::PanelContext,
            UiPanelBridgeMethodV1::ActiveSelection,
        ];
        registration.authorizer = Arc::new(DenyProject);
        registry.attach_all(vec![registration]).unwrap();
        let err = call_ui_panel_bridge(
            &registry,
            &store,
            PluginUiPanelBridgeCallParams {
                owner: translunar_protocol::PluginContributionOwner {
                    plugin_id: "example.plugin".into(),
                    version_id: "version-1".into(),
                    activation_revision: 1,
                    contribution_id: "example.panel".into(),
                },
                method: "panel.activeSelection".into(),
                params: serde_json::json!({ "projectId": "proj-1" }),
            },
        )
        .expect_err("activeSelection requires project.read");
        assert!(matches!(err, EngineError::PluginCapabilityDenied(_)));
    }

    #[test]
    fn panel_registry_detaches_only_the_exact_generation() {
        let registry = PluginUiPanelRegistry::default();
        registry
            .attach_all(vec![panel("example.panel", 1)])
            .unwrap();
        registry.detach_generation("example.plugin", "version-2", 1);
        assert_eq!(registry.views().len(), 1);
        registry.detach_generation("example.plugin", "version-1", 2);
        assert_eq!(registry.views().len(), 1);
        registry.detach_generation("example.plugin", "version-1", 1);
        assert!(registry.views().is_empty());
    }

    #[test]
    fn registries_reject_reserved_and_conflicting_ids() {
        let panels = PluginUiPanelRegistry::default();
        assert!(panels.preflight(&[panel("builtin.panel", 1)]).is_err());
        panels.attach_all(vec![panel("example.panel", 1)]).unwrap();
        assert!(panels.preflight(&[panel("example.panel", 2)]).is_err());
    }
}
