use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use translunar_ai_core::{
    ENGINE_CONNECTOR_CONTRACT_VERSION, EngineConnector, EngineConnectorDescriptor,
    EngineConnectorOperation, EngineConnectorRegistration, EngineConnectorSource,
    PluginConnectorOwner,
};
use translunar_filter_core::{DocumentFilter, FilterDescriptor, FilterError, FilterRegistry};
use translunar_pipeline::{PipelineStep, PipelineStepOwner, PluginPipelineTier, StepDescriptor};
use translunar_plugin_runtime::{
    DeclarativeConnectorAuthenticationV1, DeclarativeConnectorResponseMappingV1,
    DeclarativeDocumentFilter, EngineConnectorConfigV1, EngineConnectorContributionDescriptor,
    NormalizedPluginManifest as RuntimeNormalizedPluginManifest, PipelineStepCheckpointProgressV1,
    PipelineStepContributionDescriptor, PluginCapabilityAuthorizer, PluginCapabilityCheck,
    PluginCapabilityId, PluginCapabilityScope, PluginContributionDescriptor, PluginContributions,
    PluginEntry, PluginEntryKind, PluginFileArea, PluginFilterContribution, PluginManifest,
    PluginProcess, PluginRuntimeDescriptor, ProcessDocumentFilter, QaRuleContributionDescriptor,
    SandboxDocumentFilter, SandboxError, SandboxHostCallRegistry, SandboxHostMethod,
    SandboxRuntimeConfig, SandboxRuntimeKey, SandboxWorkerHandle, StagedPluginPackage,
    inspect_plugin_package, publish_staged_package, remove_package, sandbox_safe_diagnostic,
    stage_plugin_package,
};
use translunar_protocol::{
    NormalizedPluginManifest, PluginCompatibility, PluginDiagnostic, PluginIdParams,
    PluginInspectParams, PluginInspection, PluginInstallParams, PluginLifecycleAction,
    PluginLifecycleResult, PluginListParams, PluginMutationParams, PluginMutationResult,
    PluginPage, PluginRollbackParams, PluginRuntimeDescriptor as WirePluginRuntimeDescriptor,
    PluginStatus as WirePluginStatus, PluginSummary, PluginTier as WirePluginTier,
    PluginUpgradeParams, PluginVersionListParams, PluginVersionPage,
    PluginVersionState as WirePluginVersionState, PluginVersionSummary,
};
use translunar_qa_core::QaRuleProvenanceSnapshot;
use translunar_storage::{
    AiPluginConnectorProfileRebind, NewPluginVersion, PluginInstallationRecord, PluginStatus,
    PluginVersionRecord, PluginVersionState, Store, UpsertNormalizedPluginInstallation,
};
use uuid::Uuid;

use crate::plugin_connector::{
    DeclarativePluginEngineConnector, ProcessPluginEngineConnector,
    ReqwestDeclarativeConnectorTransport, SandboxPluginEngineConnector,
};
use crate::plugin_declarative::{
    DeclarativePipelineStep, DeclarativePluginQaRule, ProcessPluginPipelineStep,
    ProcessPluginQaRule, SandboxPluginPipelineStep, SandboxPluginQaRule,
};
use crate::qa::{QaRuleExecutor, QaRuleExecutorFailure, QaRuleExecutorSnapshot};
use crate::{EngineError, EngineService, Result};

#[cfg(test)]
std::thread_local! {
    static FAIL_UNINSTALL_AFTER_DETACH: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_REGISTER_PLUGIN_FILTERS_ATTEMPTS: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

pub(crate) struct PreparedSandboxActivation {
    key: SandboxRuntimeKey,
    worker: SandboxWorkerHandle,
    filters: Vec<(String, Arc<dyn DocumentFilter>)>,
    qa_rules: Vec<QaRuleExecutorSnapshot>,
    pipeline_steps: Vec<(String, PipelineStepOwner, Arc<dyn PipelineStep>)>,
    connectors: Vec<EngineConnectorRegistration>,
    connector_metadata: crate::ai::PluginConnectorCatalog,
}

impl EngineService {
    pub(crate) fn shutdown_plugin_runtimes(&mut self) {
        self.pipeline.begin_shutdown();
        for process in self.plugin_processes.drain() {
            process.stop();
        }
        for (_, process) in std::mem::take(&mut self.pending_plugin_processes) {
            process.stop();
        }
        for (_, key) in std::mem::take(&mut self.plugin_sandbox_keys) {
            let _ = self.plugin_sandbox_runtimes.detach(&key);
        }
        for (_, prepared) in std::mem::take(&mut self.pending_sandbox_workers) {
            let _ = prepared.worker.shutdown();
        }
    }

    pub(crate) fn reload_enabled_plugins(&mut self) -> Result<()> {
        let enabled = self.store.list_enabled_plugins()?;
        for record in enabled {
            if let Some(compatibility) = parse_compatibility(&record.compatibility_json)
                && !compatibility.compatible
            {
                tracing::warn!(plugin_id = %record.id, "skipping enabled plugin with unsupported capability");
                continue;
            }
            if let Err(error) = self.register_plugin_filters(&record) {
                let message = bounded_plugin_message(&error.to_string());
                let _ = self
                    .store
                    .record_plugin_crash(&record.id, record.revision, message);
                self.unregister_plugin_filters(&record.id);
            }
        }
        Ok(())
    }

    pub fn list_plugins(&self, params: PluginListParams) -> Result<PluginPage> {
        let (items, total) = self
            .store
            .list_plugin_installations(params.offset, params.limit)?;
        Ok(PluginPage {
            items: items.into_iter().map(to_summary).collect(),
            total,
            offset: params.offset,
            limit: params.limit.clamp(1, 200),
        })
    }

    pub fn get_plugin(&self, params: PluginIdParams) -> Result<PluginSummary> {
        Ok(to_summary(
            self.store.get_plugin_installation(&params.plugin_id)?,
        ))
    }

    pub fn inspect_plugin(&self, params: PluginInspectParams) -> Result<PluginInspection> {
        let source = checked_source_path(&params.source_path)?;
        let (normalized, package_hash) =
            inspect_plugin_package(&source).map_err(map_plugin_error)?;
        let compatibility = to_wire_compatibility(normalized.compatibility());
        let already_installed = self.store.get_plugin_installation(&normalized.id).is_ok();
        Ok(PluginInspection {
            normalized_manifest: to_wire_normalized_manifest(normalized)?,
            package_sha256: package_hash.sha256,
            can_install: compatibility.compatible && !already_installed,
            compatibility,
            diagnostics: Vec::new(),
        })
    }

    pub fn list_plugin_versions(
        &self,
        params: PluginVersionListParams,
    ) -> Result<PluginVersionPage> {
        let (items, total) =
            self.store
                .list_plugin_versions(&params.plugin_id, params.offset, params.limit)?;
        let limit = params.limit.clamp(1, 200);
        Ok(PluginVersionPage {
            items: items
                .into_iter()
                .map(to_version_summary)
                .collect::<Result<Vec<_>>>()?,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn upgrade_plugin(&mut self, params: PluginUpgradeParams) -> Result<PluginLifecycleResult> {
        let source = checked_source_path(&params.source_path)?;
        let current = self.store.get_plugin_installation(&params.plugin_id)?;
        if current.revision != params.expected_revision {
            return Err(EngineError::Storage(
                translunar_storage::StorageError::EntityConflict {
                    entity: "plugin",
                    id: params.plugin_id.clone(),
                    expected_revision: params.expected_revision,
                    actual_revision: current.revision,
                },
            ));
        }
        let staged = stage_plugin_package(
            &source,
            &self.store.paths().temporary.join("plugin-staging"),
        )
        .map_err(map_plugin_error)?;
        if staged.normalized_manifest.id != params.plugin_id {
            cleanup_staged(&staged);
            return Err(EngineError::PluginConflict(
                "upgrade package id does not match the installed plugin".to_string(),
            ));
        }
        let compatibility = staged.normalized_manifest.compatibility();
        let (history, _) = self.store.list_plugin_versions(&params.plugin_id, 0, 200)?;
        if let Some(existing) = history
            .iter()
            .find(|version| version.version == staged.normalized_manifest.version)
        {
            if existing.package_sha256.as_deref() != Some(staged.package_hash.sha256.as_str()) {
                cleanup_staged(&staged);
                return Err(EngineError::PluginConflict(format!(
                    "plugin version {} already exists with a different package hash",
                    staged.normalized_manifest.version
                )));
            }
            cleanup_staged(&staged);
            if current.active_version_id.as_deref() == Some(existing.id.as_str()) {
                if current.revision != params.expected_revision {
                    return Err(EngineError::Storage(
                        translunar_storage::StorageError::EntityConflict {
                            entity: "plugin",
                            id: params.plugin_id.clone(),
                            expected_revision: params.expected_revision,
                            actual_revision: current.revision,
                        },
                    ));
                }
                return Ok(PluginLifecycleResult {
                    plugin: to_summary(current),
                    active_version_id: existing.id.clone(),
                    previous_version_id: None,
                    action: PluginLifecycleAction::Upgraded,
                });
            }
            return Err(EngineError::PluginConflict(
                "the requested version already exists; use rollback to activate it".to_string(),
            ));
        }

        let legacy_manifest = if staged.normalized_manifest.supports_process_filter_host() {
            staged
                .normalized_manifest
                .to_legacy_process_manifest()
                .map_err(map_plugin_error)?
        } else {
            legacy_inventory_manifest(&staged.normalized_manifest)
        };
        let candidate_destination = version_package_destination(
            &self.store,
            &params.plugin_id,
            &staged.normalized_manifest.version,
            &staged.package_hash.sha256,
        );

        // A valid but unsupported tier/adapter is still retained as immutable
        // inventory. It must never touch the active projection or process/
        // filter registries.
        if !compatibility.compatible {
            let diagnostics = compatibility_diagnostics(&compatibility);
            let mut input = new_version_from_staged(
                &staged,
                &legacy_manifest,
                &current,
                candidate_destination.clone(),
                format!(
                    "upgrade:{}:{}",
                    staged.normalized_manifest.version, staged.package_hash.sha256
                ),
            )?;
            input.state = PluginVersionState::Failed;
            input.diagnostics_json = diagnostics;
            if let Err(error) = publish_staged_package(&staged.path, &candidate_destination) {
                cleanup_staged(&staged);
                return Err(map_plugin_error(error));
            }
            if let Err(error) = self.store.insert_plugin_version(input) {
                let _ = remove_package(&candidate_destination);
                return Err(error.into());
            }
            return Err(EngineError::PluginCapabilityUnsupported(
                compatibility.unsupported_capabilities.join(", "),
            ));
        }

        if let Err(error) = ensure_candidate_contribution_slots(
            self,
            &params.plugin_id,
            &staged.normalized_manifest,
        ) {
            cleanup_staged(&staged);
            return Err(error);
        }
        if let Err(error) = publish_staged_package(&staged.path, &candidate_destination) {
            cleanup_staged(&staged);
            return Err(map_plugin_error(error));
        }
        let input = new_version_from_staged(
            &staged,
            &legacy_manifest,
            &current,
            candidate_destination.clone(),
            format!(
                "upgrade:{}:{}",
                staged.normalized_manifest.version, staged.package_hash.sha256
            ),
        )?;
        let rebind_plan = match self.plan_connector_profile_rebinds(
            &current,
            &input.id,
            &staged.normalized_manifest,
        ) {
            Ok(plan) => plan,
            Err(error) => {
                let _ = remove_package(&candidate_destination);
                return Err(error);
            }
        };
        if current.status == PluginStatus::Enabled
            && staged.normalized_manifest.supports_sandbox_host()
        {
            let version = match self.store.insert_plugin_version(input.clone()) {
                Ok(version) => version,
                Err(error) => {
                    let _ = remove_package(&candidate_destination);
                    return Err(error.into());
                }
            };
            let candidate = candidate_installation_from_version(
                &current,
                &version,
                &staged.normalized_manifest,
                &legacy_manifest,
                current.revision.saturating_add(1),
            )?;
            match self.prepare_sandbox_activation(&candidate) {
                Ok(prepared) => {
                    self.pending_sandbox_workers
                        .insert(prepared.key.clone(), prepared);
                }
                Err(error) => {
                    let message = bounded_plugin_message(&error.to_string());
                    let _ = self.store.mark_plugin_version_failed(
                        &params.plugin_id,
                        &version.id,
                        json!([{
                            "code": "plugin_sandbox_failed",
                            "message": message,
                            "phase": "initialize"
                        }]),
                    );
                    return Err(EngineError::PluginUpgradeFailed(message));
                }
            }
        }
        let target_status = current.status;
        let candidate_version_id = input.id.clone();
        if current.status == PluginStatus::Enabled
            && matches!(
                &staged.normalized_manifest.runtime,
                PluginRuntimeDescriptor::Process { .. }
            )
        {
            let process = match PluginProcess::from_normalized_manifest(
                candidate_destination.clone(),
                &staged.normalized_manifest,
            ) {
                Ok(process) => Arc::new(process),
                Err(error) => {
                    let _ = remove_package(&candidate_destination);
                    return Err(map_plugin_error(error));
                }
            };
            if let Err(error) = process.ensure_started() {
                process.stop();
                let _ = remove_package(&candidate_destination);
                return Err(EngineError::PluginUpgradeFailed(bounded_plugin_message(
                    &error.to_string(),
                )));
            }
            self.pending_plugin_processes.insert(
                (params.plugin_id.clone(), candidate_version_id.clone()),
                process,
            );
        }
        let activation = match self.store.cas_activate_plugin_version(
            &params.plugin_id,
            params.expected_revision,
            input,
            target_status,
        ) {
            Ok(value) => value,
            Err(error) => {
                if let Some(prepared) = self.pending_sandbox_workers.remove(&SandboxRuntimeKey {
                    plugin_id: params.plugin_id.clone(),
                    version_id: candidate_version_id.clone(),
                }) {
                    let _ = prepared.worker.shutdown();
                }
                if let Some(process) = self
                    .pending_plugin_processes
                    .remove(&(params.plugin_id.clone(), candidate_version_id.clone()))
                {
                    process.stop();
                }
                return Err(error.into());
            }
        };
        let pending = self.pending_sandbox_workers.remove(&SandboxRuntimeKey {
            plugin_id: params.plugin_id.clone(),
            version_id: activation.active_version.id.clone(),
        });
        if activation.installation.status == PluginStatus::Enabled {
            self.unregister_plugin_runtime(&params.plugin_id, false);
        } else {
            self.unregister_plugin_filters(&params.plugin_id);
        }
        if let Some(prepared) = pending {
            self.pending_sandbox_workers
                .insert(prepared.key.clone(), prepared);
        }
        if activation.installation.status == PluginStatus::Enabled
            && let Err(error) = self.register_plugin_filters(&activation.installation)
        {
            let message = error.to_string();
            self.compensate_failed_version_switch(&params.plugin_id, &activation, &message, true);
            return Err(EngineError::PluginUpgradeFailed(message));
        }
        if let Err(error) = self.apply_connector_profile_rebinds(&rebind_plan) {
            let message = bounded_plugin_message(&error.to_string());
            self.compensate_failed_version_switch(&params.plugin_id, &activation, &message, true);
            return Err(EngineError::PluginUpgradeFailed(message));
        }
        Ok(PluginLifecycleResult {
            plugin: to_summary(activation.installation),
            active_version_id: activation.active_version.id,
            previous_version_id: activation.previous_version_id,
            action: PluginLifecycleAction::Upgraded,
        })
    }

    pub fn rollback_plugin(
        &mut self,
        params: PluginRollbackParams,
    ) -> Result<PluginLifecycleResult> {
        let current = self.store.get_plugin_installation(&params.plugin_id)?;
        let version = self
            .store
            .get_plugin_version(&params.plugin_id, &params.version_id)?;
        let package_path = resolve_managed_path(
            self.store.paths().root.as_path(),
            &version
                .managed_package_path
                .clone()
                .unwrap_or_else(|| version.package_path.clone()),
        );
        if !package_path.is_dir() {
            return Err(EngineError::PluginPackageInvalid(
                "rollback package is missing".to_string(),
            ));
        }
        let (normalized, hash) = inspect_plugin_package(&package_path).map_err(map_plugin_error)?;
        if let Some(expected_hash) = version.package_sha256.as_deref()
            && expected_hash != hash.sha256
        {
            return Err(EngineError::PluginPackageHashMismatch(
                "rollback package bytes differ from immutable history".to_string(),
            ));
        }
        let compatibility = normalized.compatibility();
        if !compatibility.compatible {
            return Err(EngineError::PluginCapabilityUnsupported(
                compatibility.unsupported_capabilities.join(", "),
            ));
        }
        let rebind_plan =
            self.plan_connector_profile_rebinds(&current, &version.id, &normalized)?;
        ensure_candidate_contribution_slots(self, &params.plugin_id, &normalized)?;
        if current.status == PluginStatus::Enabled && normalized.supports_sandbox_host() {
            let legacy_manifest = legacy_inventory_manifest(&normalized);
            let candidate = candidate_installation_from_version(
                &current,
                &version,
                &normalized,
                &legacy_manifest,
                current.revision.saturating_add(1),
            )?;
            let prepared = self.prepare_sandbox_activation(&candidate)?;
            self.pending_sandbox_workers
                .insert(prepared.key.clone(), prepared);
        }
        if current.status == PluginStatus::Enabled
            && matches!(&normalized.runtime, PluginRuntimeDescriptor::Process { .. })
        {
            let process = Arc::new(
                PluginProcess::from_normalized_manifest(package_path.clone(), &normalized)
                    .map_err(map_plugin_error)?,
            );
            if let Err(error) = process.ensure_started() {
                process.stop();
                return Err(map_plugin_error(error));
            }
            self.pending_plugin_processes.insert(
                (params.plugin_id.clone(), params.version_id.clone()),
                process,
            );
        }
        let activation = match self.store.rollback_plugin_version(
            &params.plugin_id,
            params.expected_revision,
            &params.version_id,
        ) {
            Ok(activation) => activation,
            Err(error) => {
                if let Some(prepared) = self.pending_sandbox_workers.remove(&SandboxRuntimeKey {
                    plugin_id: params.plugin_id.clone(),
                    version_id: params.version_id.clone(),
                }) {
                    let _ = prepared.worker.shutdown();
                }
                if let Some(process) = self
                    .pending_plugin_processes
                    .remove(&(params.plugin_id.clone(), params.version_id.clone()))
                {
                    process.stop();
                }
                return Err(error.into());
            }
        };
        let pending = self.pending_sandbox_workers.remove(&SandboxRuntimeKey {
            plugin_id: params.plugin_id.clone(),
            version_id: activation.active_version.id.clone(),
        });
        if activation.installation.status == PluginStatus::Enabled {
            self.unregister_plugin_runtime(&params.plugin_id, false);
        } else {
            self.unregister_plugin_filters(&params.plugin_id);
        }
        if let Some(prepared) = pending {
            self.pending_sandbox_workers
                .insert(prepared.key.clone(), prepared);
        }
        if activation.installation.status == PluginStatus::Enabled
            && let Err(error) = self.register_plugin_filters(&activation.installation)
        {
            let message = error.to_string();
            self.compensate_failed_version_switch(&params.plugin_id, &activation, &message, false);
            return Err(EngineError::PluginUpgradeFailed(message));
        }
        if let Err(error) = self.apply_connector_profile_rebinds(&rebind_plan) {
            let message = bounded_plugin_message(&error.to_string());
            self.compensate_failed_version_switch(&params.plugin_id, &activation, &message, false);
            return Err(EngineError::PluginUpgradeFailed(message));
        }
        Ok(PluginLifecycleResult {
            plugin: to_summary(activation.installation),
            active_version_id: activation.active_version.id,
            previous_version_id: activation.previous_version_id,
            action: PluginLifecycleAction::RolledBack,
        })
    }

    pub fn install_plugin(&mut self, params: PluginInstallParams) -> Result<PluginMutationResult> {
        let source = checked_source_path(&params.source_path)?;
        let (normalized, source_hash) =
            inspect_plugin_package(&source).map_err(map_plugin_error)?;
        match self.store.get_plugin_installation(&normalized.id) {
            Ok(_) => {
                return Err(EngineError::InvalidState(format!(
                    "plugin {} is already installed",
                    normalized.id
                )));
            }
            Err(translunar_storage::StorageError::NotFound { .. }) => {}
            Err(error) => return Err(error.into()),
        }
        let staged = stage_plugin_package(
            &source,
            &self.store.paths().temporary.join("plugin-staging"),
        )
        .map_err(map_plugin_error)?;
        if staged.package_hash.sha256 != source_hash.sha256 {
            cleanup_staged(&staged);
            return Err(EngineError::PluginPackageHashMismatch(
                "source package changed while it was being staged".to_string(),
            ));
        }
        let destination = version_package_destination(
            &self.store,
            &normalized.id,
            &normalized.version,
            &staged.package_hash.sha256,
        );
        if let Err(error) = publish_staged_package(&staged.path, &destination) {
            cleanup_staged(&staged);
            return Err(map_plugin_error(error));
        }
        let compatibility = normalized.compatibility();
        let legacy_manifest = legacy_inventory_manifest(&normalized);
        let diagnostics = compatibility_diagnostics(&compatibility);
        let record = self
            .store
            .upsert_normalized_plugin_installation(UpsertNormalizedPluginInstallation {
                manifest: legacy_manifest,
                original_manifest_json: normalized.original_manifest_json.clone(),
                normalized_manifest_json: serde_json::to_value(&normalized)?,
                runtime_json: serde_json::to_value(&normalized.runtime)?,
                contributions_json: serde_json::to_value(&normalized.contributions)?,
                compatibility_json: serde_json::to_value(&compatibility)?,
                diagnostics_json: diagnostics,
                package_sha256: Some(staged.package_hash.sha256.clone()),
                package_path: destination.clone(),
                granted_permissions: Vec::new(),
                status: PluginStatus::Installed,
                last_error: None,
                source_manifest_version: normalized.source_manifest_version,
            })
            .inspect_err(|_| {
                let _ = remove_package(&destination);
            })?;
        // `grantRequested` remains wire-decodable for old clients, but install
        // never turns that compatibility field into authority.
        let _ = (&params.grant_requested, &params.actor, &params.reason);
        Ok(PluginMutationResult {
            plugin: to_summary(record),
        })
    }

    pub fn enable_plugin(&mut self, params: PluginMutationParams) -> Result<PluginMutationResult> {
        let record = self.store.get_plugin_installation(&params.plugin_id)?;
        if let Some(expected) = params.expected_revision
            && expected != record.revision
        {
            return Err(EngineError::Storage(
                translunar_storage::StorageError::EntityConflict {
                    entity: "plugin",
                    id: params.plugin_id.clone(),
                    expected_revision: expected,
                    actual_revision: record.revision,
                },
            ));
        }
        self.ensure_plugin_capabilities(&record, "plugin.enable")?;
        if let Some(compatibility) = parse_compatibility(&record.compatibility_json)
            && !compatibility.compatible
        {
            return Err(EngineError::PluginCapabilityUnsupported(
                compatibility.unsupported_capabilities.join(", "),
            ));
        }
        // Ensure contribution ids do not collide with built-ins or other enabled plugins.
        for filter in record.filter_descriptors() {
            if filter.id.starts_with("builtin.") {
                return Err(EngineError::InvalidRequest(format!(
                    "filter id {} collides with builtin prefix",
                    filter.id
                )));
            }
            if self.filters.contains(&filter.id) {
                // Allow re-enable of the same plugin's already-registered filter.
                let owner = self.plugin_filter_owners.get(&filter.id).cloned();
                if owner.as_deref() != Some(record.id.as_str()) {
                    return Err(EngineError::PluginConflict(format!(
                        "filter id {} is already registered",
                        filter.id
                    )));
                }
            }
        }
        if record.tier == translunar_plugin_runtime::PluginTier::Process {
            let updated = self.store.set_plugin_status(
                &params.plugin_id,
                PluginStatus::Enabled,
                params.expected_revision,
                None,
            )?;
            self.unregister_plugin_filters(&params.plugin_id);
            return match self.register_plugin_filters(&updated) {
                Ok(()) => {
                    let _ = (&params.actor, &params.reason);
                    Ok(PluginMutationResult {
                        plugin: to_summary(updated),
                    })
                }
                Err(error) => {
                    let message = error.to_string();
                    let _ = self.store.record_plugin_crash(
                        &params.plugin_id,
                        updated.revision,
                        message,
                    );
                    self.unregister_plugin_filters(&params.plugin_id);
                    Err(error)
                }
            };
        }
        self.unregister_plugin_filters(&params.plugin_id);
        let mut candidate = record.clone();
        candidate.revision = candidate.revision.saturating_add(1);
        if let Err(error) = self.register_plugin_filters(&candidate) {
            self.unregister_plugin_filters(&params.plugin_id);
            return Err(error);
        }
        let updated = match self.store.set_plugin_status(
            &params.plugin_id,
            PluginStatus::Enabled,
            params.expected_revision,
            None,
        ) {
            Ok(updated) => updated,
            Err(error) => {
                self.unregister_plugin_filters(&params.plugin_id);
                return Err(error.into());
            }
        };
        self.plugin_activation_revisions
            .insert(params.plugin_id.clone(), updated.revision);
        let _ = (&params.actor, &params.reason);
        Ok(PluginMutationResult {
            plugin: to_summary(updated),
        })
    }

    pub fn disable_plugin(&mut self, params: PluginMutationParams) -> Result<PluginMutationResult> {
        let updated = self.store.set_plugin_status(
            &params.plugin_id,
            PluginStatus::Disabled,
            params.expected_revision,
            None,
        )?;
        self.unregister_plugin_filters(&params.plugin_id);
        let _ = (&params.actor, &params.reason);
        Ok(PluginMutationResult {
            plugin: to_summary(updated),
        })
    }

    pub fn uninstall_plugin(
        &mut self,
        params: PluginMutationParams,
    ) -> Result<PluginMutationResult> {
        let record = self.store.get_plugin_installation(&params.plugin_id)?;
        if let Some(expected) = params.expected_revision
            && record.revision != expected
        {
            return Err(EngineError::Storage(
                translunar_storage::StorageError::EntityConflict {
                    entity: "plugin",
                    id: params.plugin_id.clone(),
                    expected_revision: expected,
                    actual_revision: record.revision,
                },
            ));
        }
        let package_roots = collect_plugin_package_roots(&self.store, &params.plugin_id, &record)?;
        let summary = to_summary(record.clone());
        let quarantine_root = self.store.paths().temporary.join("plugin-quarantine");
        std::fs::create_dir_all(&quarantine_root)?;
        self.unregister_plugin_filters(&params.plugin_id);
        #[cfg(test)]
        if FAIL_UNINSTALL_AFTER_DETACH.with(std::cell::Cell::take) {
            self.restore_plugin_after_failed_uninstall(&record)?;
            return Err(EngineError::InvalidState(
                "injected uninstall failure after runtime detach".to_string(),
            ));
        }
        let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
        for (index, package_root) in package_roots.iter().enumerate() {
            if !package_root.exists() {
                continue;
            }
            let quarantine =
                quarantine_root.join(format!("{}-{}-{index}", params.plugin_id, Uuid::now_v7()));
            if let Err(error) = std::fs::rename(package_root, &quarantine) {
                for (original, moved_path) in moved.iter().rev() {
                    let _ = std::fs::create_dir_all(original.parent().unwrap_or(Path::new(".")));
                    let _ = std::fs::rename(moved_path, original);
                }
                self.restore_plugin_after_failed_uninstall(&record)?;
                return Err(EngineError::PluginPackageInvalid(format!(
                    "cannot quarantine plugin package before uninstall: {error}"
                )));
            }
            moved.push((package_root.clone(), quarantine));
        }

        if let Err(error) = self
            .store
            .uninstall_plugin_versions_cas(&params.plugin_id, Some(summary.revision))
        {
            for (original, moved_path) in moved.iter().rev() {
                let _ = std::fs::create_dir_all(original.parent().unwrap_or(Path::new(".")));
                let _ = std::fs::rename(moved_path, original);
            }
            self.restore_plugin_after_failed_uninstall(&record)?;
            return Err(error.into());
        }
        for (_, quarantine) in moved {
            if let Err(error) = remove_package(&quarantine) {
                // The database/active projection is already gone. Keep the
                // private quarantine for a later cleanup pass rather than
                // reporting a misleading failed uninstall.
                tracing::warn!(path = %quarantine.display(), error = %error, "plugin quarantine cleanup deferred");
            }
        }
        let _ = (&params.actor, &params.reason);
        Ok(PluginMutationResult { plugin: summary })
    }

    fn restore_plugin_after_failed_uninstall(
        &mut self,
        record: &PluginInstallationRecord,
    ) -> Result<()> {
        if record.status == PluginStatus::Enabled {
            self.register_plugin_filters(record)?;
        }
        Ok(())
    }

    fn plan_connector_profile_rebinds(
        &self,
        current: &PluginInstallationRecord,
        candidate_version_id: &str,
        candidate: &RuntimeNormalizedPluginManifest,
    ) -> Result<Vec<AiPluginConnectorProfileRebind>> {
        let current_version_id = current
            .active_version_id
            .as_deref()
            .ok_or_else(|| EngineError::InvalidState("plugin has no active version".to_string()))?;
        let active: RuntimeNormalizedPluginManifest =
            serde_json::from_value(current.normalized_manifest_json.clone()).map_err(|_| {
                EngineError::PluginInvalidManifest(
                    "stored active connector manifest is invalid".to_string(),
                )
            })?;
        let mut plan = Vec::new();
        for contribution in &active.contributions {
            let PluginContributionDescriptor::EngineConnector(previous) = contribution else {
                continue;
            };
            let previous_contract = previous.contract_version.ok_or_else(|| {
                EngineError::PluginInvalidManifest(
                    "active connector is missing contractVersion".to_string(),
                )
            })?;
            let previous_source = EngineConnectorSource::Plugin {
                owner: PluginConnectorOwner {
                    plugin_id: current.id.clone(),
                    version_id: current_version_id.to_string(),
                },
                contribution_id: previous.id.clone(),
                contract_version: previous_contract,
            };
            let (_, total) =
                self.store
                    .list_ai_plugin_connector_profile_references(&previous_source, 0, 1)?;
            if total == 0 {
                continue;
            }
            let candidate_descriptor = candidate
                .contributions
                .iter()
                .find_map(|contribution| match contribution {
                    PluginContributionDescriptor::EngineConnector(value)
                        if value.id == previous.id =>
                    {
                        Some(value)
                    }
                    _ => None,
                })
                .ok_or_else(|| {
                    EngineError::PluginUpgradeFailed(format!(
                        "connector {} still has provider profiles and cannot be removed",
                        previous.id
                    ))
                })?;
            if active.runtime.tier() != candidate.runtime.tier()
                || !connector_descriptors_profile_compatible(previous, candidate_descriptor)
            {
                return Err(EngineError::PluginUpgradeFailed(format!(
                    "connector {} changes schema, operations, origin, or runtime tier and requires explicit profile migration",
                    previous.id
                )));
            }
            let config_schema = candidate_descriptor.config_schema.as_ref().ok_or_else(|| {
                EngineError::PluginInvalidManifest(
                    "candidate connector is missing configSchema".to_string(),
                )
            })?;
            let mut offset = 0;
            loop {
                let (profiles, profile_total) = self
                    .store
                    .list_ai_plugin_connector_profile_references(&previous_source, offset, 100)?;
                for profile in profiles {
                    let configuration: EngineConnectorConfigV1 =
                        serde_json::from_value(profile.configuration).map_err(|_| {
                            EngineError::PluginUpgradeFailed(format!(
                                "connector {} has an invalid stored profile configuration",
                                previous.id
                            ))
                        })?;
                    config_schema.validate_config(&configuration).map_err(|_| {
                        EngineError::PluginUpgradeFailed(format!(
                            "connector {} profile configuration is incompatible with the candidate",
                            previous.id
                        ))
                    })?;
                }
                offset = offset.saturating_add(100);
                if offset >= profile_total {
                    break;
                }
            }
            let candidate_contract = candidate_descriptor.contract_version.ok_or_else(|| {
                EngineError::PluginInvalidManifest(
                    "candidate connector is missing contractVersion".to_string(),
                )
            })?;
            plan.push(AiPluginConnectorProfileRebind {
                previous_source,
                candidate_source: EngineConnectorSource::Plugin {
                    owner: PluginConnectorOwner {
                        plugin_id: current.id.clone(),
                        version_id: candidate_version_id.to_string(),
                    },
                    contribution_id: candidate_descriptor.id.clone(),
                    contract_version: candidate_contract,
                },
                config_schema_version: candidate_descriptor.config_schema_version,
                previous_descriptor_hash: plugin_connector_descriptor_hash(previous)?,
                candidate_descriptor_hash: plugin_connector_descriptor_hash(candidate_descriptor)?,
            });
        }
        Ok(plan)
    }

    fn apply_connector_profile_rebinds(
        &mut self,
        plan: &[AiPluginConnectorProfileRebind],
    ) -> Result<()> {
        self.store.rebind_ai_plugin_connector_profiles_batch(plan)?;
        Ok(())
    }

    fn attach_plugin_connectors(
        &mut self,
        candidate_owner: PluginConnectorOwner,
        registrations: Vec<EngineConnectorRegistration>,
        metadata: crate::ai::PluginConnectorCatalog,
    ) -> Result<Vec<translunar_ai_core::EngineConnectorLease>> {
        if registrations.len() != metadata.len()
            || registrations.iter().any(|registration| {
                registration.descriptor.source.plugin_owner() != Some(&candidate_owner)
                    || !metadata
                        .get(&registration.descriptor.id)
                        .is_some_and(|item| item.source == registration.descriptor.source)
            })
        {
            return Err(EngineError::InvalidState(
                "plugin connector activation metadata is inconsistent".to_string(),
            ));
        }
        let previous_owner = {
            let candidate = &candidate_owner;
            self.ai.connectors.snapshot().ok().and_then(|leases| {
                leases.into_iter().find_map(|lease| {
                    lease
                        .descriptor
                        .source
                        .plugin_owner()
                        .filter(|owner| {
                            owner.plugin_id == candidate.plugin_id && *owner != candidate
                        })
                        .cloned()
                })
            })
        };
        let attached = if let Some(previous_owner) = previous_owner.as_ref() {
            let replacement = self
                .ai
                .connectors
                .replace_plugin_owner(previous_owner, &candidate_owner, registrations)
                .map_err(|error| EngineError::PluginConflict(error.to_string()))?;
            self.ai.cancel_plugin_connector_owner(previous_owner);
            for lease in replacement.detached {
                let _ = lease.shutdown();
            }
            self.plugin_connector_catalog
                .retain(|_, item| item.source.plugin_owner() != Some(previous_owner));
            replacement.attached
        } else {
            self.ai
                .connectors
                .preflight(&registrations)
                .map_err(|error| EngineError::PluginConflict(error.to_string()))?;
            self.ai
                .connectors
                .attach_all(registrations)
                .map_err(|error| EngineError::PluginConflict(error.to_string()))?
        };
        self.plugin_connector_catalog.extend(metadata);
        Ok(attached)
    }

    fn detach_plugin_connectors(&mut self, plugin_id: &str) {
        let owners = self
            .ai
            .connectors
            .snapshot()
            .map(|leases| {
                leases
                    .into_iter()
                    .filter_map(|lease| match &lease.descriptor.source {
                        EngineConnectorSource::Plugin { owner, .. }
                            if owner.plugin_id == plugin_id =>
                        {
                            Some((owner.version_id.clone(), owner.clone()))
                        }
                        _ => None,
                    })
                    .collect::<BTreeMap<_, _>>()
            })
            .unwrap_or_default();
        for owner in owners.into_values() {
            self.ai.cancel_plugin_connector_owner(&owner);
            if let Ok(detached) = self.ai.connectors.detach_plugin_owner(&owner) {
                for lease in detached {
                    let _ = lease.shutdown();
                }
            }
        }
        self.plugin_connector_catalog.retain(|_, metadata| {
            !matches!(
                &metadata.source,
                EngineConnectorSource::Plugin { owner, .. } if owner.plugin_id == plugin_id
            )
        });
    }

    fn register_plugin_filters(&mut self, record: &PluginInstallationRecord) -> Result<()> {
        #[cfg(test)]
        if FAIL_REGISTER_PLUGIN_FILTERS_ATTEMPTS.with(|attempts| {
            let remaining = attempts.get();
            if remaining == 0 {
                return false;
            }
            attempts.set(remaining - 1);
            true
        }) {
            return Err(EngineError::InvalidState(
                "injected plugin registration failure".to_string(),
            ));
        }
        self.ensure_plugin_capabilities(record, "plugin.register")?;
        let version_id = record
            .active_version_id
            .clone()
            .ok_or_else(|| EngineError::InvalidState("plugin has no active version".to_string()))?;
        let authorizer = self.plugin_capabilities.authorizer();
        if record.tier == translunar_plugin_runtime::PluginTier::Declarative {
            let normalized: RuntimeNormalizedPluginManifest = serde_json::from_value(
                record.normalized_manifest_json.clone(),
            )
            .map_err(|error| {
                EngineError::PluginInvalidManifest(format!(
                    "stored normalized declarative manifest is invalid: {error}"
                ))
            })?;
            if !matches!(
                normalized.runtime,
                PluginRuntimeDescriptor::Declarative { .. }
            ) {
                return Err(EngineError::InvalidState(
                    "declarative plugin has a mismatched runtime projection".to_string(),
                ));
            }

            let mut filters: Vec<(String, Arc<dyn DocumentFilter>)> = Vec::new();
            let mut qa_rules = Vec::new();
            let mut pipeline_steps = Vec::new();
            let mut connectors = Vec::new();
            let mut connector_metadata = crate::ai::PluginConnectorCatalog::new();
            for contribution in &normalized.contributions {
                match contribution {
                    PluginContributionDescriptor::Filter(value) => {
                        let definition = value.declarative.clone().ok_or_else(|| {
                            EngineError::PluginInvalidManifest(format!(
                                "declarative filter {} has no definition",
                                value.id
                            ))
                        })?;
                        authorize_contribution(
                            &authorizer,
                            record,
                            &version_id,
                            PluginCapabilityId::FileRead,
                            PluginCapabilityScope::File {
                                areas: vec![PluginFileArea::Source],
                            },
                            &value.id,
                            "filter.register",
                        )?;
                        if value.capabilities.export {
                            authorize_contribution(
                                &authorizer,
                                record,
                                &version_id,
                                PluginCapabilityId::FileWrite,
                                PluginCapabilityScope::File {
                                    areas: vec![PluginFileArea::Output],
                                },
                                &value.id,
                                "filter.register",
                            )?;
                        }
                        let descriptor = FilterDescriptor {
                            id: value.id.clone(),
                            version: value.version.clone(),
                            display_name: value.display_name.clone(),
                            extensions: value.extensions.clone(),
                            capabilities: value.capabilities.clone(),
                        };
                        let filter = DeclarativeDocumentFilter::new(
                            &record.id,
                            &version_id,
                            descriptor,
                            definition,
                            Arc::clone(&authorizer),
                        )
                        .map_err(map_plugin_error)?;
                        filters.push((value.id.clone(), Arc::new(filter)));
                    }
                    PluginContributionDescriptor::EngineConnector(value) => {
                        authorize_connector_registration(&authorizer, record, &version_id, value)?;
                        let owner = PluginConnectorOwner {
                            plugin_id: record.id.clone(),
                            version_id: version_id.clone(),
                        };
                        let adapter = DeclarativePluginEngineConnector::new(
                            owner,
                            value.id.clone(),
                            value.config_schema.clone().ok_or_else(|| {
                                EngineError::PluginInvalidManifest(
                                    "declarative connector is missing configSchema".to_string(),
                                )
                            })?,
                            value.limits.clone().ok_or_else(|| {
                                EngineError::PluginInvalidManifest(
                                    "declarative connector is missing limits".to_string(),
                                )
                            })?,
                            value.declarative.as_deref().cloned().ok_or_else(|| {
                                EngineError::PluginInvalidManifest(
                                    "declarative connector is missing its definition".to_string(),
                                )
                            })?,
                            Arc::clone(&authorizer),
                            Arc::new(ReqwestDeclarativeConnectorTransport),
                        )
                        .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                        let (registration, metadata) = plugin_connector_registration(
                            record,
                            &version_id,
                            value,
                            Arc::new(adapter),
                        )?;
                        connector_metadata.insert(value.id.clone(), metadata);
                        connectors.push(registration);
                    }
                    PluginContributionDescriptor::QaRule(value) => {
                        authorize_contribution(
                            &authorizer,
                            record,
                            &version_id,
                            PluginCapabilityId::QaRegister,
                            PluginCapabilityScope::Contributions {
                                contribution_ids: vec![value.id.clone()],
                            },
                            &value.id,
                            "qa.register",
                        )?;
                        let adapter = Arc::new(
                            DeclarativePluginQaRule::new(
                                &record.id,
                                &version_id,
                                value,
                                Arc::clone(&authorizer),
                            )
                            .map_err(map_plugin_error)?,
                        );
                        let rule_ids = adapter.rule_ids().to_vec();
                        qa_rules.push(plugin_qa_snapshot(
                            record,
                            &version_id,
                            value,
                            adapter,
                            rule_ids,
                        )?);
                    }
                    PluginContributionDescriptor::PipelineStep(value) => {
                        authorize_contribution(
                            &authorizer,
                            record,
                            &version_id,
                            PluginCapabilityId::PipelineRegister,
                            PluginCapabilityScope::Contributions {
                                contribution_ids: vec![value.id.clone()],
                            },
                            &value.id,
                            "pipeline.register",
                        )?;
                        let definition = value.declarative.as_ref().ok_or_else(|| {
                            EngineError::PluginInvalidManifest(format!(
                                "declarative pipeline contribution {} has no definition",
                                value.id
                            ))
                        })?;
                        let step = DeclarativePipelineStep::new(
                            &record.id,
                            &version_id,
                            &value.id,
                            StepDescriptor {
                                id: value.id.clone(),
                                version: value.version.clone(),
                                display_name: value.display_name.clone(),
                                input: definition.input,
                                output: definition.output,
                                config_schema_version: value.config_schema_version,
                                resumable: value.resumable,
                                cancellable: value.cancellable,
                            },
                            definition,
                            Arc::clone(&authorizer),
                        )
                        .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                        pipeline_steps.push((
                            value.id.clone(),
                            plugin_pipeline_owner(record, &version_id, value)?,
                            Arc::new(step),
                        ));
                    }
                    _ => {
                        return Err(EngineError::PluginCapabilityUnsupported(format!(
                            "unsupported declarative contribution {}",
                            contribution.id()
                        )));
                    }
                }
            }

            for (id, _) in &filters {
                if self.filters.contains(id) {
                    return Err(EngineError::PluginConflict(format!(
                        "filter id {id} is already registered"
                    )));
                }
            }
            self.plugin_qa_registry.preflight(&qa_rules)?;
            for (id, _, _) in &pipeline_steps {
                if self.pipeline.registry.contains(id) {
                    return Err(EngineError::PluginConflict(format!(
                        "pipeline step id {id} is already registered"
                    )));
                }
            }

            let _ = self.attach_plugin_connectors(
                PluginConnectorOwner {
                    plugin_id: record.id.clone(),
                    version_id: version_id.clone(),
                },
                connectors,
                connector_metadata,
            )?;

            for (id, filter) in filters {
                if let Err(error) = self.filters.register(filter) {
                    self.unregister_plugin_filters(&record.id);
                    return Err(EngineError::InvalidState(error.to_string()));
                }
                self.plugin_filter_owners.insert(id, record.id.clone());
            }
            for (id, owner, step) in pipeline_steps {
                if let Err(error) = self.pipeline.registry.register_plugin(step, owner.clone()) {
                    self.unregister_plugin_filters(&record.id);
                    return Err(EngineError::InvalidState(error.to_string()));
                }
                self.plugin_pipeline_owners.insert(id, owner);
            }
            self.plugin_qa_registry.attach_all(qa_rules)?;
            self.plugin_activation_revisions
                .insert(record.id.clone(), record.revision);
            return Ok(());
        }

        if record.tier == translunar_plugin_runtime::PluginTier::Sandbox {
            return self.register_sandbox_contributions(record);
        }
        if record.tier != translunar_plugin_runtime::PluginTier::Process {
            return Err(EngineError::InvalidState(
                "plugin runtime has no executable host".to_string(),
            ));
        }

        let normalized: RuntimeNormalizedPluginManifest =
            serde_json::from_value(record.normalized_manifest_json.clone()).map_err(|_| {
                EngineError::PluginInvalidManifest(
                    "stored normalized process manifest is invalid".to_string(),
                )
            })?;
        if !matches!(normalized.runtime, PluginRuntimeDescriptor::Process { .. }) {
            return Err(EngineError::InvalidState(
                "process plugin has a mismatched runtime projection".to_string(),
            ));
        }
        let connector_descriptors = normalized
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::EngineConnector(value) => Some(value.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let qa_rule_descriptors = normalized
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::QaRule(value) => Some(value.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let pipeline_step_descriptors = normalized
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::PipelineStep(value) => Some(value.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        for descriptor in &connector_descriptors {
            authorize_connector_registration(&authorizer, record, &version_id, descriptor)?;
        }
        for descriptor in &qa_rule_descriptors {
            authorize_contribution(
                &authorizer,
                record,
                &version_id,
                PluginCapabilityId::QaRegister,
                PluginCapabilityScope::Contributions {
                    contribution_ids: vec![descriptor.id.clone()],
                },
                &descriptor.id,
                "qa.register",
            )?;
        }
        for descriptor in &pipeline_step_descriptors {
            authorize_contribution(
                &authorizer,
                record,
                &version_id,
                PluginCapabilityId::PipelineRegister,
                PluginCapabilityScope::Contributions {
                    contribution_ids: vec![descriptor.id.clone()],
                },
                &descriptor.id,
                "pipeline.register",
            )?;
            if self.pipeline.registry.contains(&descriptor.id) {
                return Err(EngineError::PluginConflict(format!(
                    "pipeline step id {} is already registered",
                    descriptor.id
                )));
            }
        }

        let descriptors = record.filter_descriptors();
        for descriptor in &descriptors {
            if descriptor.id.starts_with("builtin.") {
                return Err(EngineError::InvalidRequest(format!(
                    "filter id {} collides with builtin prefix",
                    descriptor.id
                )));
            }
            if self.filters.contains(&descriptor.id) {
                return Err(EngineError::InvalidState(format!(
                    "filter id {} is already registered",
                    descriptor.id
                )));
            }
        }
        let pending_key = (record.id.clone(), version_id.clone());
        let process = match self.pending_plugin_processes.remove(&pending_key) {
            Some(process) => process,
            None => {
                let process = Arc::new(PluginProcess::new_with_public_descriptors(
                    resolve_managed_path(self.store.paths().root.as_path(), &record.package_path),
                    record.manifest.clone(),
                    connector_descriptors.clone(),
                    qa_rule_descriptors.clone(),
                    pipeline_step_descriptors.clone(),
                ));
                process.ensure_started().map_err(map_plugin_error)?;
                process
            }
        };
        let prepared = (|| -> Result<_> {
            let filters = descriptors
                .into_iter()
                .map(|descriptor| {
                    let filter = ProcessDocumentFilter::new(
                        Arc::clone(&process),
                        descriptor.clone(),
                        record.granted_permissions.clone(),
                        record.revision,
                    )
                    .with_capability_authorizer(Arc::clone(&authorizer), version_id.clone());
                    (descriptor.id, Arc::new(filter) as Arc<dyn DocumentFilter>)
                })
                .collect::<Vec<_>>();
            let mut connector_registrations = Vec::new();
            let mut connector_metadata = crate::ai::PluginConnectorCatalog::new();
            for descriptor in &connector_descriptors {
                let adapter = ProcessPluginEngineConnector::new(
                    PluginConnectorOwner {
                        plugin_id: record.id.clone(),
                        version_id: version_id.clone(),
                    },
                    descriptor.id.clone(),
                    descriptor.config_schema.clone().ok_or_else(|| {
                        EngineError::PluginInvalidManifest(
                            "process connector is missing configSchema".to_string(),
                        )
                    })?,
                    descriptor.limits.clone().ok_or_else(|| {
                        EngineError::PluginInvalidManifest(
                            "process connector is missing limits".to_string(),
                        )
                    })?,
                    Arc::clone(&authorizer),
                    Arc::clone(&process),
                )
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                let (registration, metadata) = plugin_connector_registration(
                    record,
                    &version_id,
                    descriptor,
                    Arc::new(adapter),
                )?;
                connector_metadata.insert(descriptor.id.clone(), metadata);
                connector_registrations.push(registration);
            }
            let mut pipeline_steps: Vec<(String, PipelineStepOwner, Arc<dyn PipelineStep>)> =
                Vec::new();
            for descriptor in &pipeline_step_descriptors {
                let owner = plugin_pipeline_owner(record, &version_id, descriptor)?;
                let adapter = ProcessPluginPipelineStep::new(
                    &record.id,
                    &version_id,
                    descriptor,
                    Arc::clone(&authorizer),
                    Arc::clone(&process),
                )
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                pipeline_steps.push((descriptor.id.clone(), owner, Arc::new(adapter)));
            }
            let mut qa_rules = Vec::new();
            for descriptor in &qa_rule_descriptors {
                let adapter = Arc::new(
                    ProcessPluginQaRule::new(
                        &record.id,
                        &version_id,
                        descriptor,
                        Arc::clone(&authorizer),
                        Arc::clone(&process),
                    )
                    .map_err(map_plugin_error)?,
                );
                qa_rules.push(plugin_qa_snapshot(
                    record,
                    &version_id,
                    descriptor,
                    adapter,
                    Vec::new(),
                )?);
            }
            Ok((
                filters,
                connector_registrations,
                connector_metadata,
                pipeline_steps,
                qa_rules,
            ))
        })();
        let (filters, connector_registrations, connector_metadata, pipeline_steps, qa_rules) =
            match prepared {
                Ok(prepared) => prepared,
                Err(error) => {
                    process.stop();
                    return Err(error);
                }
            };
        if let Err(error) = self.plugin_qa_registry.preflight(&qa_rules) {
            process.stop();
            return Err(error);
        }

        let connector_leases = match self.attach_plugin_connectors(
            PluginConnectorOwner {
                plugin_id: record.id.clone(),
                version_id: version_id.clone(),
            },
            connector_registrations,
            connector_metadata,
        ) {
            Ok(leases) => leases,
            Err(error) => {
                process.stop();
                return Err(error);
            }
        };
        let mut registered: Vec<String> = Vec::new();
        let mut registered_filters = Vec::new();
        for (id, filter) in filters {
            if let Err(error) = self.filters.register(Arc::clone(&filter)) {
                for filter_id in &registered {
                    let _ = self.filters.unregister(filter_id);
                    self.plugin_filter_owners.remove(filter_id);
                }
                self.detach_plugin_connectors(&record.id);
                process.stop();
                return Err(EngineError::InvalidState(error.to_string()));
            }
            self.plugin_filter_owners
                .insert(id.clone(), record.id.clone());
            registered_filters.push((id.clone(), filter));
            registered.push(id);
        }
        let mut registered_pipeline_steps: Vec<(String, PipelineStepOwner)> = Vec::new();
        for (id, owner, adapter) in pipeline_steps {
            if let Err(error) = self
                .pipeline
                .registry
                .register_plugin(adapter, owner.clone())
            {
                for (step_id, binding) in &registered_pipeline_steps {
                    self.pipeline.cancel_owner(binding);
                    if let Ok(current) = self.pipeline.registry.resolve_binding(step_id)
                        && current.binding().owner == *binding
                    {
                        let _ = self.pipeline.registry.unregister_binding(current.binding());
                    }
                    self.plugin_pipeline_owners.remove(step_id);
                }
                self.detach_plugin_connectors(&record.id);
                for filter_id in &registered {
                    let _ = self.filters.unregister(filter_id);
                    self.plugin_filter_owners.remove(filter_id);
                }
                process.stop();
                return Err(EngineError::InvalidState(error.to_string()));
            }
            self.plugin_pipeline_owners
                .insert(id.clone(), owner.clone());
            registered_pipeline_steps.push((id, owner));
        }
        if let Err(error) = self.plugin_qa_registry.attach_all(qa_rules) {
            for (step_id, binding) in &registered_pipeline_steps {
                self.pipeline.cancel_owner(binding);
                if let Ok(current) = self.pipeline.registry.resolve_binding(step_id)
                    && current.binding().owner == *binding
                {
                    let _ = self.pipeline.registry.unregister_binding(current.binding());
                }
                self.plugin_pipeline_owners.remove(step_id);
            }
            self.detach_plugin_connectors(&record.id);
            for filter_id in &registered {
                let _ = self.filters.unregister(filter_id);
                self.plugin_filter_owners.remove(filter_id);
            }
            process.stop();
            return Err(error);
        }
        if let Some(previous) = self.plugin_processes.insert(
            record.id.clone(),
            version_id,
            record.revision,
            registered_filters,
            connector_leases,
            Arc::clone(&process),
        ) && !Arc::ptr_eq(&previous, &process)
        {
            previous.stop();
        }
        self.plugin_activation_revisions
            .insert(record.id.clone(), record.revision);
        Ok(())
    }

    fn prepare_sandbox_activation(
        &self,
        record: &PluginInstallationRecord,
    ) -> Result<PreparedSandboxActivation> {
        let normalized: RuntimeNormalizedPluginManifest =
            serde_json::from_value(record.normalized_manifest_json.clone()).map_err(|_| {
                EngineError::PluginInvalidManifest(
                    "stored normalized sandbox manifest is invalid".to_string(),
                )
            })?;
        if !normalized.supports_sandbox_host() {
            return Err(EngineError::PluginCapabilityUnsupported(
                "sandbox package contains an unsupported contribution".to_string(),
            ));
        }
        let version_id = record
            .active_version_id
            .as_deref()
            .ok_or_else(|| EngineError::InvalidState("plugin has no active version".to_string()))?;
        let authorizer = self.plugin_capabilities.authorizer();
        for contribution in &normalized.contributions {
            match contribution {
                PluginContributionDescriptor::Filter(value) => {
                    authorize_contribution(
                        &authorizer,
                        record,
                        version_id,
                        PluginCapabilityId::FileRead,
                        PluginCapabilityScope::File {
                            areas: vec![PluginFileArea::Source],
                        },
                        &value.id,
                        "filter.register",
                    )?;
                    if value.capabilities.export {
                        authorize_contribution(
                            &authorizer,
                            record,
                            version_id,
                            PluginCapabilityId::FileWrite,
                            PluginCapabilityScope::File {
                                areas: vec![PluginFileArea::Output],
                            },
                            &value.id,
                            "filter.register",
                        )?;
                    }
                }
                PluginContributionDescriptor::UiPanel(value) => {
                    authorize_contribution(
                        &authorizer,
                        record,
                        version_id,
                        PluginCapabilityId::UiPanel,
                        PluginCapabilityScope::Contributions {
                            contribution_ids: vec![value.id.clone()],
                        },
                        &value.id,
                        "ui.panel.register",
                    )?;
                }
                PluginContributionDescriptor::EngineConnector(value) => {
                    authorize_connector_registration(&authorizer, record, version_id, value)?;
                }
                PluginContributionDescriptor::QaRule(value) => {
                    authorize_contribution(
                        &authorizer,
                        record,
                        version_id,
                        PluginCapabilityId::QaRegister,
                        PluginCapabilityScope::Contributions {
                            contribution_ids: vec![value.id.clone()],
                        },
                        &value.id,
                        "qa.register",
                    )?;
                }
                PluginContributionDescriptor::PipelineStep(value) => {
                    authorize_contribution(
                        &authorizer,
                        record,
                        version_id,
                        PluginCapabilityId::PipelineRegister,
                        PluginCapabilityScope::Contributions {
                            contribution_ids: vec![value.id.clone()],
                        },
                        &value.id,
                        "pipeline.register",
                    )?;
                }
                _ => {
                    return Err(EngineError::PluginCapabilityUnsupported(format!(
                        "unsupported sandbox contribution {}",
                        contribution.id()
                    )));
                }
            }
        }
        let (entry_path, export_name) = match &normalized.runtime {
            PluginRuntimeDescriptor::Sandbox {
                entry:
                    translunar_plugin_runtime::SandboxRuntimeEntry::Javascript { path, export_name },
                ..
            } => (path.clone(), export_name.clone()),
            _ => {
                return Err(EngineError::InvalidState(
                    "sandbox plugin has a mismatched runtime projection".to_string(),
                ));
            }
        };
        let activation_revision = i64::try_from(record.revision).map_err(|_| {
            EngineError::InvalidState("plugin activation revision is out of range".to_string())
        })?;
        let package_root =
            resolve_managed_path(self.store.paths().root.as_path(), &record.package_path);
        let mut config = SandboxRuntimeConfig::new(
            record.id.clone(),
            version_id.to_string(),
            activation_revision,
            package_root,
            entry_path,
            export_name,
        );
        config.expected_package_hash = record.package_sha256.clone();
        let checkpoint_router = self.pipeline.checkpoint_router();
        let host_calls = sandbox_host_call_registry(&normalized, checkpoint_router.clone())?;
        let worker = self
            .plugin_sandbox_runtimes
            .prepare(config, host_calls, Arc::clone(&authorizer))
            .map_err(map_sandbox_error)?;
        let mut filters: Vec<(String, Arc<dyn DocumentFilter>)> = Vec::new();
        let mut qa_rules = Vec::new();
        let mut pipeline_steps: Vec<(String, PipelineStepOwner, Arc<dyn PipelineStep>)> =
            Vec::new();
        let mut connectors = Vec::new();
        let mut connector_metadata = crate::ai::PluginConnectorCatalog::new();
        for contribution in &normalized.contributions {
            match contribution {
                PluginContributionDescriptor::Filter(value) => {
                    let descriptor = FilterDescriptor {
                        id: value.id.clone(),
                        version: value.version.clone(),
                        display_name: value.display_name.clone(),
                        extensions: value.extensions.clone(),
                        capabilities: value.capabilities.clone(),
                    };
                    let adapter = SandboxDocumentFilter::new(
                        worker.clone(),
                        descriptor,
                        record.id.clone(),
                        version_id.to_string(),
                        record.revision,
                        value.id.clone(),
                        Arc::clone(&authorizer),
                    )
                    .map_err(map_sandbox_error)?;
                    filters.push((value.id.clone(), Arc::new(adapter)));
                }
                PluginContributionDescriptor::EngineConnector(value) => {
                    let adapter = SandboxPluginEngineConnector::new(
                        PluginConnectorOwner {
                            plugin_id: record.id.clone(),
                            version_id: version_id.to_string(),
                        },
                        value.id.clone(),
                        value.config_schema.clone().ok_or_else(|| {
                            EngineError::PluginInvalidManifest(
                                "sandbox connector is missing configSchema".to_string(),
                            )
                        })?,
                        value.limits.clone().ok_or_else(|| {
                            EngineError::PluginInvalidManifest(
                                "sandbox connector is missing limits".to_string(),
                            )
                        })?,
                        Arc::clone(&authorizer),
                        worker.clone(),
                    )
                    .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                    let (registration, metadata) = plugin_connector_registration(
                        record,
                        version_id,
                        value,
                        Arc::new(adapter),
                    )?;
                    connector_metadata.insert(value.id.clone(), metadata);
                    connectors.push(registration);
                }
                PluginContributionDescriptor::QaRule(value) => {
                    let adapter = Arc::new(
                        SandboxPluginQaRule::new(
                            &record.id,
                            version_id,
                            value,
                            Arc::clone(&authorizer),
                            worker.clone(),
                        )
                        .map_err(map_plugin_error)?,
                    );
                    qa_rules.push(plugin_qa_snapshot(
                        record,
                        version_id,
                        value,
                        adapter,
                        Vec::new(),
                    )?);
                }
                PluginContributionDescriptor::PipelineStep(value) => {
                    let adapter = SandboxPluginPipelineStep::new(
                        &record.id,
                        version_id,
                        value,
                        Arc::clone(&authorizer),
                        worker.clone(),
                        checkpoint_router.clone(),
                    )
                    .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                    pipeline_steps.push((
                        value.id.clone(),
                        plugin_pipeline_owner(record, version_id, value)?,
                        Arc::new(adapter),
                    ));
                }
                PluginContributionDescriptor::UiPanel(_) => {}
                _ => unreachable!("sandbox host compatibility was checked before preparation"),
            }
        }
        Ok(PreparedSandboxActivation {
            key: worker.key().clone(),
            worker,
            filters,
            qa_rules,
            pipeline_steps,
            connectors,
            connector_metadata,
        })
    }

    fn register_sandbox_contributions(&mut self, record: &PluginInstallationRecord) -> Result<()> {
        let version_id = record
            .active_version_id
            .clone()
            .ok_or_else(|| EngineError::InvalidState("plugin has no active version".to_string()))?;
        let key = SandboxRuntimeKey {
            plugin_id: record.id.clone(),
            version_id: version_id.clone(),
        };
        let prepared = match self.pending_sandbox_workers.remove(&key) {
            Some(prepared) => prepared,
            None => self.prepare_sandbox_activation(record)?,
        };
        for (id, _) in &prepared.filters {
            if self.filters.contains(id)
                && self.plugin_filter_owners.get(id).map(String::as_str) != Some(record.id.as_str())
            {
                let _ = prepared.worker.shutdown();
                return Err(EngineError::PluginConflict(format!(
                    "filter id {id} is already registered"
                )));
            }
        }
        for (id, _, _) in &prepared.pipeline_steps {
            if self.pipeline.registry.contains(id) {
                let _ = prepared.worker.shutdown();
                return Err(EngineError::PluginConflict(format!(
                    "pipeline step id {id} is already registered"
                )));
            }
        }
        if let Err(error) = self.plugin_qa_registry.preflight(&prepared.qa_rules) {
            let _ = prepared.worker.shutdown();
            return Err(error);
        }
        self.plugin_sandbox_runtimes
            .attach(prepared.worker.clone())
            .map_err(map_sandbox_error)?;
        if let Err(error) = self.attach_plugin_connectors(
            PluginConnectorOwner {
                plugin_id: record.id.clone(),
                version_id: version_id.clone(),
            },
            prepared.connectors,
            prepared.connector_metadata,
        ) {
            let _ = self.plugin_sandbox_runtimes.detach(&key);
            return Err(error);
        }
        let mut registered: Vec<String> = Vec::new();
        for (id, adapter) in prepared.filters {
            if let Err(error) = self.filters.register(adapter) {
                for registered_id in &registered {
                    let _ = self.filters.unregister(registered_id);
                    self.plugin_filter_owners.remove(registered_id);
                }
                let _ = self.plugin_sandbox_runtimes.detach(&key);
                self.detach_plugin_connectors(&record.id);
                return Err(EngineError::InvalidState(error.to_string()));
            }
            self.plugin_filter_owners
                .insert(id.clone(), record.id.clone());
            registered.push(id);
        }
        let mut registered_pipeline_steps: Vec<(String, PipelineStepOwner)> = Vec::new();
        for (id, owner, adapter) in prepared.pipeline_steps {
            if let Err(error) = self
                .pipeline
                .registry
                .register_plugin(adapter, owner.clone())
            {
                for (step_id, binding) in &registered_pipeline_steps {
                    self.pipeline.cancel_owner(binding);
                    if let Ok(current) = self.pipeline.registry.resolve_binding(step_id)
                        && current.binding().owner == *binding
                    {
                        let _ = self.pipeline.registry.unregister_binding(current.binding());
                    }
                    self.plugin_pipeline_owners.remove(step_id);
                }
                for registered_id in &registered {
                    let _ = self.filters.unregister(registered_id);
                    self.plugin_filter_owners.remove(registered_id);
                }
                let _ = self.plugin_sandbox_runtimes.detach(&key);
                self.detach_plugin_connectors(&record.id);
                return Err(EngineError::InvalidState(error.to_string()));
            }
            self.plugin_pipeline_owners
                .insert(id.clone(), owner.clone());
            registered_pipeline_steps.push((id, owner));
        }
        if let Err(error) = self.plugin_qa_registry.attach_all(prepared.qa_rules) {
            for (step_id, binding) in &registered_pipeline_steps {
                self.pipeline.cancel_owner(binding);
                if let Ok(current) = self.pipeline.registry.resolve_binding(step_id)
                    && current.binding().owner == *binding
                {
                    let _ = self.pipeline.registry.unregister_binding(current.binding());
                }
                self.plugin_pipeline_owners.remove(step_id);
            }
            for registered_id in &registered {
                let _ = self.filters.unregister(registered_id);
                self.plugin_filter_owners.remove(registered_id);
            }
            let _ = self.plugin_sandbox_runtimes.detach(&key);
            self.detach_plugin_connectors(&record.id);
            return Err(error);
        }
        if let Some(previous_key) = self
            .plugin_sandbox_keys
            .insert(record.id.clone(), key.clone())
            && previous_key != key
        {
            let _ = self.plugin_sandbox_runtimes.detach(&previous_key);
        }
        self.plugin_activation_revisions
            .insert(record.id.clone(), record.revision);
        Ok(())
    }

    pub(crate) fn unregister_plugin_filters(&mut self, plugin_id: &str) {
        self.unregister_plugin_runtime(plugin_id, true);
    }

    fn unregister_plugin_runtime(&mut self, plugin_id: &str, detach_connectors: bool) {
        if detach_connectors {
            self.detach_plugin_connectors(plugin_id);
        }
        let owned: Vec<String> = self
            .plugin_filter_owners
            .iter()
            .filter_map(|(filter_id, owner)| {
                if owner == plugin_id {
                    Some(filter_id.clone())
                } else {
                    None
                }
            })
            .collect();
        for filter_id in owned {
            let _ = self.filters.unregister(&filter_id);
            self.plugin_filter_owners.remove(&filter_id);
        }
        if let Some(activation_revision) = self.plugin_activation_revisions.get(plugin_id).copied()
        {
            self.plugin_qa_registry
                .detach_generation(plugin_id, activation_revision);
        }
        let pipeline_steps = self
            .plugin_pipeline_owners
            .iter()
            .filter_map(|(step_id, owner)| {
                (owner.plugin_id() == Some(plugin_id)).then_some((step_id.clone(), owner.clone()))
            })
            .collect::<Vec<_>>();
        for (step_id, owner) in pipeline_steps {
            self.pipeline.cancel_owner(&owner);
            if let Ok(binding) = self.pipeline.registry.resolve_binding(&step_id)
                && binding.binding().owner == owner
            {
                let _ = self.pipeline.registry.unregister_binding(binding.binding());
            }
            if self.plugin_pipeline_owners.get(&step_id) == Some(&owner) {
                self.plugin_pipeline_owners.remove(&step_id);
            }
        }
        if detach_connectors {
            if let Some(process) = self.plugin_processes.remove(plugin_id) {
                process.stop();
            }
            if let Some(key) = self.plugin_sandbox_keys.remove(plugin_id) {
                let _ = self.plugin_sandbox_runtimes.detach(&key);
            }
        }
        let pending = self
            .pending_sandbox_workers
            .keys()
            .filter(|key| key.plugin_id == plugin_id)
            .cloned()
            .collect::<Vec<_>>();
        for key in pending {
            if let Some(prepared) = self.pending_sandbox_workers.remove(&key) {
                let _ = prepared.worker.shutdown();
            }
        }
        let pending_processes = self
            .pending_plugin_processes
            .keys()
            .filter(|(pending_plugin_id, _)| pending_plugin_id == plugin_id)
            .cloned()
            .collect::<Vec<_>>();
        for key in pending_processes {
            if let Some(process) = self.pending_plugin_processes.remove(&key) {
                process.stop();
            }
        }
        self.plugin_activation_revisions.remove(plugin_id);
    }

    fn unregister_plugin_activation(&mut self, plugin_id: &str, activation_revision: u64) {
        if self
            .plugin_activation_revisions
            .get(plugin_id)
            .is_some_and(|revision| *revision == activation_revision)
        {
            self.unregister_plugin_filters(plugin_id);
        }
    }

    fn compensate_failed_version_switch(
        &mut self,
        plugin_id: &str,
        activation: &translunar_storage::PluginActivationResult,
        message: &str,
        mark_target_failed: bool,
    ) {
        self.unregister_plugin_filters(plugin_id);
        let Some(previous_version_id) = activation.previous_version_id.as_deref() else {
            tracing::error!(
                plugin_id,
                "upgrade attach failed without a previous version"
            );
            return;
        };
        let mut restored = self.store.rollback_plugin_version(
            plugin_id,
            activation.installation.revision,
            previous_version_id,
        );
        if restored.is_err()
            && let Ok(current) = self.store.get_plugin_installation(plugin_id)
            && current.active_version_id.as_deref() == Some(activation.active_version.id.as_str())
        {
            restored = self.store.rollback_plugin_version(
                plugin_id,
                current.revision,
                previous_version_id,
            );
        }
        match restored {
            Ok(restored) => {
                if restored.installation.status == PluginStatus::Enabled
                    && let Err(error) = self.register_plugin_filters(&restored.installation)
                {
                    tracing::error!(plugin_id, error = %error, "failed to reattach previous plugin version");
                    self.persist_failed_restoration(
                        plugin_id,
                        &format!("plugin_restore_failed: {error}"),
                    );
                }
                if mark_target_failed
                    && let Err(error) = self.store.mark_plugin_version_failed(
                        plugin_id,
                        activation.active_version.id.as_str(),
                        json!([{
                            "code": "plugin_upgrade_failed",
                            "message": bounded_plugin_message(message),
                            "phase": "attach"
                        }]),
                    )
                {
                    tracing::warn!(plugin_id, error = %error, "failed to retain attach-failed candidate");
                }
            }
            Err(error) => {
                tracing::error!(plugin_id, error = %error, "failed to compensate plugin upgrade");
                self.persist_failed_restoration(
                    plugin_id,
                    &format!("plugin_restore_failed: {error}"),
                );
            }
        }
    }

    fn persist_failed_restoration(&mut self, plugin_id: &str, message: &str) {
        self.unregister_plugin_filters(plugin_id);
        let Ok(current) = self.store.get_plugin_installation(plugin_id) else {
            return;
        };
        let bounded = bounded_plugin_message(message);
        match self.store.record_plugin_crash_for_version(
            plugin_id,
            current.active_version_id.as_deref(),
            current.revision,
            bounded,
        ) {
            Ok(Some(_)) | Ok(None) => {}
            Err(error) => tracing::error!(
                plugin_id,
                error = %error,
                "failed to persist degraded restoration state"
            ),
        }
    }

    pub(crate) fn handle_plugin_filter_failure(&mut self, error: EngineError) -> EngineError {
        let failure = match &error {
            EngineError::Import(FilterError::PluginProcessFailed {
                plugin_id,
                filter_id,
                operation,
                activation_revision,
                kind,
                message,
            })
            | EngineError::CorpusImport(FilterError::PluginProcessFailed {
                plugin_id,
                filter_id,
                operation,
                activation_revision,
                kind,
                message,
            })
            | EngineError::Export(FilterError::PluginProcessFailed {
                plugin_id,
                filter_id,
                operation,
                activation_revision,
                kind,
                message,
            }) => Some((
                plugin_id.clone(),
                *activation_revision,
                bounded_plugin_message(&format!(
                    "{operation} for {filter_id} failed ({}): {message}",
                    kind.as_str()
                )),
            )),
            EngineError::Import(FilterError::PluginSandboxFailed {
                plugin_id,
                filter_id,
                operation,
                activation_revision,
                kind,
                message,
            })
            | EngineError::CorpusImport(FilterError::PluginSandboxFailed {
                plugin_id,
                filter_id,
                operation,
                activation_revision,
                kind,
                message,
            })
            | EngineError::Export(FilterError::PluginSandboxFailed {
                plugin_id,
                filter_id,
                operation,
                activation_revision,
                kind,
                message,
            }) => Some((
                plugin_id.clone(),
                *activation_revision,
                bounded_plugin_message(&format!(
                    "{operation} for {filter_id} failed ({}): {message}",
                    kind.as_str()
                )),
            )),
            _ => None,
        };
        let Some((plugin_id, activation_revision, message)) = failure else {
            return error;
        };
        match self
            .store
            .record_plugin_crash(&plugin_id, activation_revision, message)
        {
            Ok(Some(_)) => self.unregister_plugin_activation(&plugin_id, activation_revision),
            Ok(None) => tracing::warn!(
                plugin_id,
                activation_revision,
                "ignored stale plugin failure after lifecycle state changed"
            ),
            Err(storage_error) => {
                self.unregister_plugin_activation(&plugin_id, activation_revision);
                tracing::error!(
                    plugin_id,
                    activation_revision,
                    error = %storage_error,
                    "failed to persist plugin crash state"
                );
            }
        }
        error
    }

    pub(crate) fn handle_plugin_qa_failure(
        &mut self,
        provenance: &QaRuleProvenanceSnapshot,
        failure: &QaRuleExecutorFailure,
    ) {
        if !matches!(
            failure.failure.code.as_str(),
            "plugin_timeout" | "plugin_resource_limit" | "plugin_host_crash" | "plugin_protocol"
        ) {
            return;
        }
        let message = bounded_plugin_message(&format!(
            "QA execution for {} failed ({})",
            provenance.contribution_id, failure.failure.code
        ));
        match self.store.record_plugin_crash(
            &provenance.plugin_id,
            provenance.activation_revision,
            message,
        ) {
            Ok(Some(_)) => self.unregister_plugin_activation(
                &provenance.plugin_id,
                provenance.activation_revision,
            ),
            Ok(None) => tracing::warn!(
                plugin_id = %provenance.plugin_id,
                activation_revision = provenance.activation_revision,
                "ignored stale QA plugin failure after lifecycle state changed"
            ),
            Err(storage_error) => {
                self.unregister_plugin_activation(
                    &provenance.plugin_id,
                    provenance.activation_revision,
                );
                tracing::error!(
                    plugin_id = %provenance.plugin_id,
                    activation_revision = provenance.activation_revision,
                    error = %storage_error,
                    "failed to persist QA plugin crash state"
                );
            }
        }
    }
}

fn authorize_contribution(
    authorizer: &Arc<dyn PluginCapabilityAuthorizer>,
    record: &PluginInstallationRecord,
    version_id: &str,
    capability_id: PluginCapabilityId,
    scope: PluginCapabilityScope,
    contribution_id: &str,
    operation: &str,
) -> Result<()> {
    authorizer
        .authorize_registration(&PluginCapabilityCheck {
            plugin_id: record.id.clone(),
            version_id: version_id.to_string(),
            capability_id,
            scope,
            operation: operation.to_string(),
            contribution_id: Some(contribution_id.to_string()),
        })
        .map_err(EngineError::PluginCapabilityDenied)
}

fn plugin_connector_registration(
    record: &PluginInstallationRecord,
    version_id: &str,
    descriptor: &EngineConnectorContributionDescriptor,
    connector: Arc<dyn EngineConnector>,
) -> Result<(
    EngineConnectorRegistration,
    crate::ai::PluginConnectorCatalogMetadata,
)> {
    descriptor
        .validate_executable_v1(record.tier)
        .map_err(map_plugin_error)?;
    let contract_version = descriptor.contract_version.ok_or_else(|| {
        EngineError::PluginInvalidManifest(
            "plugin connector is missing contractVersion".to_string(),
        )
    })?;
    if contract_version != ENGINE_CONNECTOR_CONTRACT_VERSION {
        return Err(EngineError::PluginCapabilityUnsupported(format!(
            "connector contract version {contract_version} is unsupported"
        )));
    }
    let config_schema = descriptor.config_schema.clone().ok_or_else(|| {
        EngineError::PluginInvalidManifest("plugin connector is missing configSchema".to_string())
    })?;
    let mut operations = descriptor
        .operations
        .iter()
        .map(|operation| match operation.as_str() {
            "validateConfig" => Ok(EngineConnectorOperation::ValidateConfig),
            "test" => Ok(EngineConnectorOperation::Test),
            "models.list" => Ok(EngineConnectorOperation::ModelsList),
            "generate" => Ok(EngineConnectorOperation::Generate),
            _ => Err(EngineError::PluginInvalidManifest(
                "plugin connector declares an unknown operation".to_string(),
            )),
        })
        .collect::<Result<Vec<_>>>()?;
    operations.sort();
    operations.dedup();
    let owner = PluginConnectorOwner {
        plugin_id: record.id.clone(),
        version_id: version_id.to_string(),
    };
    let source = EngineConnectorSource::Plugin {
        owner,
        contribution_id: descriptor.id.clone(),
        contract_version,
    };
    let (default_base_url, supports_streaming, reports_usage, credential_hint) = descriptor
        .declarative
        .as_deref()
        .map(|definition| {
            let supports_streaming = matches!(
                definition.response,
                DeclarativeConnectorResponseMappingV1::ServerSentEvents { .. }
            );
            let reports_usage = match &definition.response {
                DeclarativeConnectorResponseMappingV1::Json { usage, .. }
                | DeclarativeConnectorResponseMappingV1::ServerSentEvents { usage, .. } => {
                    usage.is_some()
                }
            };
            let credential_hint = match definition.authentication {
                DeclarativeConnectorAuthenticationV1::None => "Not required",
                DeclarativeConnectorAuthenticationV1::Bearer
                | DeclarativeConnectorAuthenticationV1::Header { .. } => "Connector credential",
            };
            (
                definition.endpoint.destination_origin.clone(),
                supports_streaming,
                reports_usage,
                credential_hint.to_string(),
            )
        })
        .unwrap_or_else(|| {
            (
                String::new(),
                true,
                true,
                "Connector credential".to_string(),
            )
        });
    let registry_descriptor = EngineConnectorDescriptor {
        id: descriptor.id.clone(),
        display_name: descriptor.display_name.clone(),
        source: source.clone(),
        config_schema_version: descriptor.config_schema_version,
        operations,
        protocol: None,
        default_base_url,
        default_model: String::new(),
        supports_streaming,
        reports_usage,
        credential_hint,
    };
    let descriptor_hash = plugin_connector_descriptor_hash(descriptor)?;
    Ok((
        EngineConnectorRegistration {
            descriptor: registry_descriptor,
            connector,
        },
        crate::ai::PluginConnectorCatalogMetadata {
            source,
            config_schema,
            descriptor_hash,
        },
    ))
}

fn plugin_connector_descriptor_hash(
    descriptor: &EngineConnectorContributionDescriptor,
) -> Result<String> {
    let descriptor_bytes = serde_json::to_vec(descriptor)
        .map_err(|error| EngineError::InvalidState(error.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(descriptor_bytes)))
}

fn plugin_pipeline_owner(
    record: &PluginInstallationRecord,
    version_id: &str,
    descriptor: &PipelineStepContributionDescriptor,
) -> Result<PipelineStepOwner> {
    let encoded = serde_json::to_vec(descriptor).map_err(|_| {
        EngineError::PluginInvalidManifest(
            "pipeline step descriptor could not be canonicalized".to_string(),
        )
    })?;
    Ok(PipelineStepOwner::Plugin {
        plugin_id: record.id.clone(),
        version_id: version_id.to_string(),
        activation_revision: record.revision,
        contribution_id: descriptor.id.clone(),
        contribution_version: descriptor.version.clone(),
        descriptor_version: descriptor.descriptor_version,
        operation_protocol_version: descriptor.operation_protocol_version.unwrap_or(1),
        config_schema_version: descriptor.config_schema_version,
        checkpoint_schema_version: descriptor.checkpoint_schema_version,
        tier: match record.tier {
            translunar_plugin_runtime::PluginTier::Declarative => PluginPipelineTier::Declarative,
            translunar_plugin_runtime::PluginTier::Sandbox => PluginPipelineTier::Sandbox,
            translunar_plugin_runtime::PluginTier::Process => PluginPipelineTier::Process,
        },
        descriptor_hash: format!("{:x}", Sha256::digest(encoded)),
    })
}

fn plugin_qa_snapshot(
    record: &PluginInstallationRecord,
    version_id: &str,
    descriptor: &QaRuleContributionDescriptor,
    executor: Arc<dyn QaRuleExecutor>,
    mut rule_ids: Vec<String>,
) -> Result<QaRuleExecutorSnapshot> {
    let descriptor_bytes = serde_json::to_vec(descriptor).map_err(|_| {
        EngineError::PluginInvalidManifest(
            "QA rule descriptor could not be canonicalized".to_string(),
        )
    })?;
    let config = descriptor
        .config
        .clone()
        .unwrap_or_else(|| Value::Object(Default::default()));
    let config_bytes = serde_json::to_vec(&config).map_err(|_| {
        EngineError::PluginInvalidManifest("QA rule config could not be canonicalized".to_string())
    })?;
    rule_ids.sort();
    rule_ids.dedup();
    Ok(QaRuleExecutorSnapshot::new(
        QaRuleProvenanceSnapshot {
            plugin_id: record.id.clone(),
            version_id: version_id.to_string(),
            contribution_id: descriptor.id.clone(),
            contribution_version: descriptor.version.clone(),
            descriptor_version: descriptor.descriptor_version,
            operation_protocol_version: descriptor.operation_protocol_version.unwrap_or(1),
            config_schema_version: descriptor.config_schema_version.unwrap_or(1),
            activation_revision: record.revision,
            tier: match record.tier {
                translunar_plugin_runtime::PluginTier::Declarative => "declarative",
                translunar_plugin_runtime::PluginTier::Sandbox => "sandbox",
                translunar_plugin_runtime::PluginTier::Process => "process",
            }
            .to_string(),
            descriptor_hash: format!("{:x}", Sha256::digest(descriptor_bytes)),
            config_hash: format!("{:x}", Sha256::digest(config_bytes)),
            rule_ids,
        },
        executor,
    ))
}

fn connector_descriptors_profile_compatible(
    previous: &EngineConnectorContributionDescriptor,
    candidate: &EngineConnectorContributionDescriptor,
) -> bool {
    let mut previous_operations = previous.operations.clone();
    previous_operations.sort();
    let mut candidate_operations = candidate.operations.clone();
    candidate_operations.sort();
    let previous_origin = previous
        .declarative
        .as_deref()
        .map(|definition| definition.endpoint.destination_origin.as_str());
    let candidate_origin = candidate
        .declarative
        .as_deref()
        .map(|definition| definition.endpoint.destination_origin.as_str());
    previous.protocol == candidate.protocol
        && previous.contract_version == candidate.contract_version
        && previous.config_schema_version == candidate.config_schema_version
        && previous.config_schema == candidate.config_schema
        && previous_operations == candidate_operations
        && previous_origin == candidate_origin
}

fn authorize_connector_registration(
    authorizer: &Arc<dyn PluginCapabilityAuthorizer>,
    record: &PluginInstallationRecord,
    version_id: &str,
    descriptor: &EngineConnectorContributionDescriptor,
) -> Result<()> {
    for operation in &descriptor.operations {
        authorize_contribution(
            authorizer,
            record,
            version_id,
            PluginCapabilityId::EngineConnector,
            PluginCapabilityScope::Operations {
                operations: vec![operation.clone()],
            },
            &descriptor.id,
            "connector.register",
        )?;
    }
    if let Some(definition) = descriptor.declarative.as_deref() {
        authorize_contribution(
            authorizer,
            record,
            version_id,
            PluginCapabilityId::NetworkConnect,
            PluginCapabilityScope::Network {
                origins: vec![definition.endpoint.destination_origin.clone()],
            },
            &descriptor.id,
            "connector.register",
        )?;
    }
    Ok(())
}

fn checked_source_path(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value.trim());
    if value.trim().is_empty() || !path.is_dir() {
        return Err(EngineError::InvalidRequest(
            "plugin sourcePath must be an existing directory".to_string(),
        ));
    }
    Ok(path)
}

fn version_package_destination(
    store: &Store,
    plugin_id: &str,
    version: &str,
    package_sha256: &str,
) -> PathBuf {
    store
        .paths()
        .plugins
        .join(".versions")
        .join(plugin_id)
        .join(format!("{version}-{package_sha256}"))
}

fn legacy_inventory_manifest(normalized: &RuntimeNormalizedPluginManifest) -> PluginManifest {
    let entry = match &normalized.runtime {
        translunar_plugin_runtime::PluginRuntimeDescriptor::Process { entry, .. } => match entry {
            translunar_plugin_runtime::ProcessRuntimeEntry::Node { path } => PluginEntry {
                kind: PluginEntryKind::Node,
                path: path.clone(),
            },
            translunar_plugin_runtime::ProcessRuntimeEntry::Executable { path } => PluginEntry {
                kind: PluginEntryKind::Executable,
                path: path.clone(),
            },
        },
        translunar_plugin_runtime::PluginRuntimeDescriptor::Sandbox { entry, .. } => match entry {
            translunar_plugin_runtime::SandboxRuntimeEntry::Javascript { path, .. } => {
                PluginEntry {
                    // The v1 projection has no JavaScript entry discriminator.  It
                    // is inventory-only because compatibility=false for sandbox.
                    kind: PluginEntryKind::Node,
                    path: path.clone(),
                }
            }
        },
        translunar_plugin_runtime::PluginRuntimeDescriptor::Declarative { .. } => PluginEntry {
            // Declarative packages have no executable path.  Keep a regular,
            // bounded placeholder solely for the legacy row decoder.
            kind: PluginEntryKind::Node,
            path: "manifest.json".to_string(),
        },
    };
    let filters = normalized
        .contributions
        .iter()
        .filter_map(|contribution| match contribution {
            translunar_plugin_runtime::PluginContributionDescriptor::Filter(filter) => {
                Some(PluginFilterContribution {
                    id: filter.id.clone(),
                    version: filter.version.clone(),
                    display_name: filter.display_name.clone(),
                    extensions: filter.extensions.clone(),
                    capabilities: filter.capabilities.clone(),
                })
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    PluginManifest {
        manifest_version: normalized.source_manifest_version,
        id: normalized.id.clone(),
        display_name: normalized.display_name.clone(),
        version: normalized.version.clone(),
        api_version: normalized.host_api.max,
        api_version_min: normalized.host_api.min,
        tier: normalized.runtime.tier(),
        entry,
        contributions: PluginContributions { filters },
        permissions: normalized.requested_permissions.clone(),
        capabilities: normalized.requested_capabilities.clone(),
    }
}

fn compatibility_diagnostics(
    compatibility: &translunar_plugin_runtime::PluginCompatibility,
) -> Value {
    if compatibility.compatible {
        json!([])
    } else {
        json!([{
            "code": "plugin_capability_unsupported",
            "message": compatibility.unsupported_capabilities.join(", "),
            "severity": "warning",
            "phase": "inventory"
        }])
    }
}

fn ensure_candidate_contribution_slots(
    service: &EngineService,
    plugin_id: &str,
    normalized: &RuntimeNormalizedPluginManifest,
) -> Result<()> {
    for descriptor in normalized.filter_descriptors() {
        if !service.filters.contains(&descriptor.id) {
            continue;
        }
        let owner = service.plugin_filter_owners.get(&descriptor.id);
        if owner.map(String::as_str) != Some(plugin_id) {
            return Err(EngineError::PluginConflict(format!(
                "filter id {} is already registered",
                descriptor.id
            )));
        }
    }

    for contribution in &normalized.contributions {
        match contribution {
            PluginContributionDescriptor::QaRule(descriptor) => {
                if let Some(owner) = service.plugin_qa_registry.owner(&descriptor.id)
                    && owner.plugin_id != plugin_id
                {
                    return Err(EngineError::PluginConflict(format!(
                        "QA contribution id {} is already registered",
                        descriptor.id
                    )));
                }
            }
            PluginContributionDescriptor::PipelineStep(descriptor) => {
                if let Ok(current) = service.pipeline.registry.resolve_binding(&descriptor.id) {
                    if current.binding().owner.plugin_id() != Some(plugin_id) {
                        return Err(EngineError::PluginConflict(format!(
                            "pipeline step id {} is already registered",
                            descriptor.id
                        )));
                    }
                    let current_descriptor = current.descriptor();
                    if current_descriptor.input != descriptor.input
                        || current_descriptor.output != descriptor.output
                    {
                        return Err(EngineError::PluginConflict(format!(
                            "pipeline step {} changes an active artifact contract",
                            descriptor.id
                        )));
                    }
                }
                let mut offset = 0;
                loop {
                    let (definitions, total) =
                        service.store.list_pipeline_definitions(None, offset, 200)?;
                    for definition in definitions {
                        for step in definition
                            .steps
                            .iter()
                            .filter(|step| step.step_id == descriptor.id)
                        {
                            let compatible = match descriptor.config_schema.as_ref() {
                                Some(schema) => schema.validate_config(&step.config).is_ok(),
                                None => {
                                    step.config.is_null()
                                        || step
                                            .config
                                            .as_object()
                                            .is_some_and(serde_json::Map::is_empty)
                                }
                            };
                            if !compatible {
                                return Err(EngineError::PluginConflict(format!(
                                    "pipeline step {} is incompatible with stored configuration",
                                    descriptor.id
                                )));
                            }
                        }
                    }
                    offset = offset.saturating_add(200);
                    if offset >= total {
                        break;
                    }
                }
            }
            PluginContributionDescriptor::EngineConnector(descriptor) => {
                let collision = service
                    .ai
                    .connectors
                    .lookup(&descriptor.id)
                    .map_err(|error| EngineError::PluginConflict(error.to_string()))?
                    .is_some_and(|lease| {
                        lease
                            .descriptor
                            .source
                            .plugin_owner()
                            .map(|owner| owner.plugin_id.as_str())
                            != Some(plugin_id)
                    });
                if collision {
                    return Err(EngineError::PluginConflict(format!(
                        "engine connector id {} is already registered",
                        descriptor.id
                    )));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn bounded_plugin_message(message: &str) -> String {
    const MAX_BYTES: usize = 4 * 1024;
    static PATH: OnceLock<regex::Regex> = OnceLock::new();
    static SECRET: OnceLock<regex::Regex> = OnceLock::new();
    let path = PATH.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:[a-z]:[\\/]|/(?:[^\s/:]+/)+)[^\s]*")
            .expect("plugin diagnostic path regex")
    });
    let secret = SECRET.get_or_init(|| {
        regex::Regex::new(
            r"(?i)(?:token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+",
        )
        .expect("plugin diagnostic secret regex")
    });
    let flattened = message
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let without_paths = path.replace_all(&flattened, "[path]");
    let sanitized = secret.replace_all(&without_paths, "[credential]");
    let mut bounded = String::new();
    for character in sanitized.chars() {
        if bounded.len() + character.len_utf8() > MAX_BYTES {
            break;
        }
        bounded.push(character);
    }
    bounded
}

fn resolve_managed_path(root: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

fn collect_plugin_package_roots(
    store: &Store,
    plugin_id: &str,
    record: &PluginInstallationRecord,
) -> Result<Vec<PathBuf>> {
    let plugins_root = store
        .paths()
        .plugins
        .canonicalize()
        .map_err(EngineError::Io)?;
    let legacy_root = store.paths().plugins.join(plugin_id);
    let versions_root = store.paths().plugins.join(".versions").join(plugin_id);
    let mut candidates = vec![resolve_managed_path(
        store.paths().root.as_path(),
        &record.package_path,
    )];
    let mut offset = 0_u32;
    loop {
        let (versions, total) = store.list_plugin_versions(plugin_id, offset, 200)?;
        candidates.extend(versions.into_iter().map(|version| {
            resolve_managed_path(
                store.paths().root.as_path(),
                version
                    .managed_package_path
                    .as_deref()
                    .unwrap_or(&version.package_path),
            )
        }));
        offset = offset.saturating_add(200);
        if offset >= total || total == 0 {
            break;
        }
    }
    candidates.push(legacy_root.clone());
    candidates.push(versions_root.clone());

    let legacy_root_canonical = legacy_root.canonicalize().ok();
    let versions_root_canonical = versions_root.canonicalize().ok();
    let mut roots = std::collections::BTreeSet::new();
    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        let canonical = candidate.canonicalize().map_err(EngineError::Io)?;
        if !canonical.starts_with(&plugins_root) {
            return Err(EngineError::PluginPackageInvalid(
                "managed plugin package is outside the plugin root".to_string(),
            ));
        }
        let root = if let Some(version_root) = versions_root_canonical.as_ref()
            && (canonical == *version_root || canonical.starts_with(version_root))
        {
            version_root.clone()
        } else if let Some(legacy) = legacy_root_canonical.as_ref()
            && (canonical == *legacy || canonical.starts_with(legacy))
        {
            legacy.clone()
        } else {
            canonical
        };
        roots.insert(root);
    }
    Ok(roots.into_iter().collect())
}

fn cleanup_staged(staged: &StagedPluginPackage) {
    if staged.path.exists() {
        let _ = remove_package(&staged.path);
    }
}

fn to_wire_normalized_manifest(
    normalized: RuntimeNormalizedPluginManifest,
) -> Result<NormalizedPluginManifest> {
    serde_json::from_value(serde_json::to_value(normalized)?).map_err(|error| {
        EngineError::InvalidState(format!(
            "failed to project normalized plugin manifest: {error}"
        ))
    })
}

fn to_wire_compatibility(
    compatibility: translunar_plugin_runtime::PluginCompatibility,
) -> PluginCompatibility {
    PluginCompatibility {
        compatible: compatibility.compatible,
        host_api_supported: compatibility.host_api_supported,
        runtime_supported: compatibility.runtime_supported,
        contributions_supported: compatibility.contributions_supported,
        unsupported_capabilities: compatibility.unsupported_capabilities,
    }
}

fn parse_diagnostics(value: &Value) -> Vec<PluginDiagnostic> {
    serde_json::from_value(value.clone()).unwrap_or_default()
}

fn parse_compatibility(value: &Value) -> Option<PluginCompatibility> {
    serde_json::from_value(value.clone()).ok()
}

fn parse_wire_runtime(value: &Value) -> Option<WirePluginRuntimeDescriptor> {
    serde_json::from_value(value.clone()).ok()
}

fn parse_wire_runtime_projection(
    runtime: &Value,
    normalized_manifest: &Value,
    original_manifest: &Value,
) -> Option<WirePluginRuntimeDescriptor> {
    parse_wire_runtime(runtime)
        .or_else(|| {
            normalized_manifest
                .get("runtime")
                .and_then(parse_wire_runtime)
        })
        .or_else(|| {
            original_manifest
                .get("runtime")
                .and_then(parse_wire_runtime)
        })
        .or_else(|| {
            let tier = original_manifest.get("tier")?.as_str()?;
            if tier != "process" {
                return None;
            }
            let entry = original_manifest.get("entry")?;
            let path = entry.get("path")?.as_str()?.to_string();
            let entry = match entry.get("kind")?.as_str()? {
                "node" => translunar_protocol::PluginProcessEntry::Node { path },
                "executable" => translunar_protocol::PluginProcessEntry::Executable { path },
                _ => return None,
            };
            Some(WirePluginRuntimeDescriptor::Process {
                runtime_version: 1,
                protocol_version: 1,
                entry,
            })
        })
}

fn new_version_from_staged(
    staged: &StagedPluginPackage,
    legacy_manifest: &translunar_plugin_runtime::PluginManifest,
    _current: &PluginInstallationRecord,
    package_path: PathBuf,
    id: String,
) -> Result<NewPluginVersion> {
    let normalized_json = serde_json::to_value(&staged.normalized_manifest)?;
    let runtime_json = serde_json::to_value(&staged.normalized_manifest.runtime)?;
    let contributions_json = serde_json::to_value(&staged.normalized_manifest.contributions)?;
    let compatibility_json = serde_json::to_value(staged.normalized_manifest.compatibility())?;
    Ok(NewPluginVersion {
        id,
        plugin_id: staged.normalized_manifest.id.clone(),
        display_name: staged.normalized_manifest.display_name.clone(),
        version: staged.normalized_manifest.version.clone(),
        tier: staged.normalized_manifest.runtime.tier(),
        entry_json: serde_json::to_value(&legacy_manifest.entry)?,
        original_manifest_json: staged.normalized_manifest.original_manifest_json.clone(),
        requested_permissions: staged.normalized_manifest.requested_permissions.clone(),
        // Structured capability requests carry semantically identical grants
        // in storage. Legacy arrays are only a compatibility projection.
        granted_permissions: Vec::new(),
        package_sha256: Some(staged.package_hash.sha256.clone()),
        package_path: package_path.clone(),
        managed_package_path: Some(package_path),
        manifest_version: staged.normalized_manifest.source_manifest_version,
        runtime_json,
        normalized_manifest_json: normalized_json,
        contributions_json,
        compatibility_json,
        diagnostics_json: json!([]),
        state: PluginVersionState::Validated,
        installed_at_ms: chrono::Utc::now().timestamp_millis(),
    })
}

fn candidate_installation_from_version(
    current: &PluginInstallationRecord,
    version: &PluginVersionRecord,
    normalized: &RuntimeNormalizedPluginManifest,
    legacy_manifest: &PluginManifest,
    revision: u64,
) -> Result<PluginInstallationRecord> {
    if version.plugin_id != current.id || normalized.id != current.id {
        return Err(EngineError::PluginConflict(
            "candidate version belongs to another plugin".to_string(),
        ));
    }
    Ok(PluginInstallationRecord {
        id: current.id.clone(),
        display_name: normalized.display_name.clone(),
        version: normalized.version.clone(),
        tier: normalized.runtime.tier(),
        status: current.status,
        package_path: version
            .managed_package_path
            .clone()
            .unwrap_or_else(|| version.package_path.clone()),
        entry: legacy_manifest.entry.clone(),
        manifest: legacy_manifest.clone(),
        contributions: legacy_manifest.contributions.clone(),
        requested_permissions: normalized.requested_permissions.clone(),
        granted_permissions: current.granted_permissions.clone(),
        last_error: None,
        crash_count: current.crash_count,
        revision,
        installed_at_ms: current.installed_at_ms,
        updated_at_ms: current.updated_at_ms,
        active_version_id: Some(version.id.clone()),
        package_sha256: version.package_sha256.clone(),
        runtime_json: version.runtime_json.clone(),
        normalized_manifest_json: version.normalized_manifest_json.clone(),
        compatibility_json: version.compatibility_json.clone(),
        diagnostics_json: version.diagnostics_json.clone(),
    })
}

pub(crate) fn to_summary(record: PluginInstallationRecord) -> PluginSummary {
    let runtime = parse_wire_runtime_projection(
        &record.runtime_json,
        &record.normalized_manifest_json,
        &serde_json::to_value(&record.manifest).unwrap_or_else(|_| json!({})),
    );
    let contributions = serde_json::from_value(
        record
            .normalized_manifest_json
            .get("contributions")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .unwrap_or_default();
    PluginSummary {
        id: record.id,
        display_name: record.display_name,
        version: record.version,
        tier: match record.tier {
            translunar_plugin_runtime::PluginTier::Declarative => WirePluginTier::Declarative,
            translunar_plugin_runtime::PluginTier::Sandbox => WirePluginTier::Sandbox,
            translunar_plugin_runtime::PluginTier::Process => WirePluginTier::Process,
        },
        status: match record.status {
            PluginStatus::Installed => WirePluginStatus::Installed,
            PluginStatus::Enabled => WirePluginStatus::Enabled,
            PluginStatus::Disabled => WirePluginStatus::Disabled,
            PluginStatus::Degraded => WirePluginStatus::Degraded,
        },
        package_path: record.package_path.to_string_lossy().into_owned(),
        revision: record.revision,
        requested_permissions: record.requested_permissions,
        granted_permissions: record.granted_permissions,
        filters: record.manifest.filter_descriptors(),
        active_version_id: record.active_version_id,
        package_sha256: record.package_sha256,
        runtime,
        contributions,
        compatibility: parse_compatibility(&record.compatibility_json),
        diagnostics: parse_diagnostics(&record.diagnostics_json),
        last_error: record.last_error,
        crash_count: record.crash_count,
        installed_at_ms: record.installed_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
}

fn to_version_summary(record: PluginVersionRecord) -> Result<PluginVersionSummary> {
    let runtime = parse_wire_runtime_projection(
        &record.runtime_json,
        &record.normalized_manifest_json,
        &record.original_manifest_json,
    )
    .ok_or_else(|| {
        EngineError::InvalidState(format!(
            "plugin version {} has an invalid runtime projection",
            record.id
        ))
    })?;
    let tier = match runtime {
        WirePluginRuntimeDescriptor::Declarative { .. } => WirePluginTier::Declarative,
        WirePluginRuntimeDescriptor::Sandbox { .. } => WirePluginTier::Sandbox,
        WirePluginRuntimeDescriptor::Process { .. } => WirePluginTier::Process,
    };
    let contribution_count = record
        .contributions_json
        .as_array()
        .map(|values| values.len())
        .or_else(|| {
            record
                .contributions_json
                .get("filters")
                .and_then(Value::as_array)
                .map(|values| values.len())
        })
        .unwrap_or(0) as u32;
    Ok(PluginVersionSummary {
        id: record.id,
        plugin_id: record.plugin_id,
        version: record.version,
        package_sha256: record.package_sha256,
        package_path: record.package_path.to_string_lossy().into_owned(),
        tier,
        runtime,
        contribution_count,
        state: match record.state {
            PluginVersionState::Validated => WirePluginVersionState::Validated,
            PluginVersionState::Failed => WirePluginVersionState::Failed,
        },
        compatibility: parse_compatibility(&record.compatibility_json).unwrap_or(
            PluginCompatibility {
                compatible: false,
                host_api_supported: false,
                runtime_supported: false,
                contributions_supported: false,
                unsupported_capabilities: vec!["invalid compatibility projection".to_string()],
            },
        ),
        diagnostics: parse_diagnostics(&record.diagnostics_json),
        installed_at_ms: record.installed_at_ms,
        activated_at_ms: record.activated_at_ms,
        deactivated_at_ms: record.deactivated_at_ms,
        failed_at_ms: record.failed_at_ms,
    })
}

fn map_plugin_error(error: translunar_plugin_runtime::PluginRuntimeError) -> EngineError {
    use translunar_plugin_runtime::PluginRuntimeError;
    match error {
        PluginRuntimeError::InvalidManifest(message) => EngineError::PluginInvalidManifest(message),
        PluginRuntimeError::PermissionDenied(message) => {
            EngineError::PluginPermissionDenied(message)
        }
        PluginRuntimeError::NotFound(message) => EngineError::InvalidRequest(message),
        PluginRuntimeError::Conflict(message) => EngineError::InvalidState(message),
        PluginRuntimeError::UnsupportedVersion { component, version } => {
            EngineError::PluginUnsupportedVersion(format!("{component} version {version}"))
        }
        PluginRuntimeError::IncompatibleHost { min, max, host } => {
            EngineError::PluginIncompatibleHost(format!(
                "host API {host} is outside plugin range {min}..={max}"
            ))
        }
        PluginRuntimeError::CapabilityUnsupported(message) => {
            EngineError::PluginCapabilityUnsupported(message)
        }
        PluginRuntimeError::PackageInvalid(message) => EngineError::PluginPackageInvalid(message),
        PluginRuntimeError::PackageHashMismatch { expected, actual } => {
            EngineError::PluginPackageHashMismatch(format!("expected {expected}, got {actual}"))
        }
        PluginRuntimeError::Process(message)
        | PluginRuntimeError::Protocol(message)
        | PluginRuntimeError::Remote(message) => EngineError::PluginProcessFailed(message),
        PluginRuntimeError::Timeout(duration) => {
            EngineError::PluginProcessFailed(format!("plugin timed out after {duration:?}"))
        }
        PluginRuntimeError::Io(error) => EngineError::Io(error),
        PluginRuntimeError::Json(error) => EngineError::Json(error),
    }
}

fn map_sandbox_error(error: SandboxError) -> EngineError {
    EngineError::PluginSandboxFailed(sandbox_safe_diagnostic(
        &error,
        translunar_plugin_runtime::DEFAULT_SANDBOX_LIMITS.diagnostic_bytes,
    ))
}

fn sandbox_host_call_registry(
    manifest: &RuntimeNormalizedPluginManifest,
    checkpoint_router: crate::PluginPipelineCheckpointRouter,
) -> Result<Arc<SandboxHostCallRegistry>> {
    let filter_ids = manifest
        .contributions
        .iter()
        .filter_map(|contribution| match contribution {
            PluginContributionDescriptor::Filter(filter) => Some(filter.id.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let registry = Arc::new(SandboxHostCallRegistry::default());
    if !filter_ids.is_empty() {
        let method = SandboxHostMethod::new(
            "diagnostics.summary",
            PluginCapabilityId::DiagnosticsRead,
            PluginCapabilityScope::Diagnostics {
                categories: vec!["summary".to_string()],
            },
            ["filter.validate".to_string()],
            |context, _params| {
                Ok(json!({
                    "protocolVersion": 1,
                    "status": "ready",
                    "activationRevision": context.activation_revision,
                    "contributionId": context.contribution_id,
                    "operation": context.operation,
                }))
            },
        )
        .map_err(map_sandbox_error)?
        .with_contributions(filter_ids)
        .map_err(map_sandbox_error)?
        .with_scope_deriver(|params| {
            let category = params
                .as_object()
                .filter(|value| value.len() == 1)
                .and_then(|value| value.get("category"))
                .and_then(Value::as_str);
            if category != Some("summary") {
                return Err(SandboxError::Codec {
                    reason: "diagnostics summary params",
                });
            }
            Ok(PluginCapabilityScope::Diagnostics {
                categories: vec!["summary".to_string()],
            })
        });
        registry.register(method).map_err(map_sandbox_error)?;
    }

    let pipeline_descriptors = manifest
        .contributions
        .iter()
        .filter_map(|contribution| match contribution {
            PluginContributionDescriptor::PipelineStep(descriptor) => Some((
                descriptor.id.clone(),
                (
                    descriptor.checkpoint_schema_version,
                    descriptor.limits.clone(),
                ),
            )),
            _ => None,
        })
        .collect::<BTreeMap<_, _>>();
    if !pipeline_descriptors.is_empty() {
        let pipeline_ids = pipeline_descriptors.keys().cloned().collect::<Vec<_>>();
        let handler_descriptors = pipeline_descriptors.clone();
        let method = SandboxHostMethod::new(
            "pipeline.checkpoint",
            PluginCapabilityId::PipelineRegister,
            PluginCapabilityScope::Contributions {
                contribution_ids: pipeline_ids.clone(),
            },
            [
                "pipeline.execute".to_string(),
                "pipeline.resume".to_string(),
            ],
            move |context, params| {
                let progress = serde_json::from_value::<PipelineStepCheckpointProgressV1>(params)
                    .map_err(|_| SandboxError::Codec {
                    reason: "pipeline checkpoint progress",
                })?;
                let (schema_version, limits) = handler_descriptors
                    .get(&context.contribution_id)
                    .and_then(|(schema_version, limits)| {
                        limits.as_ref().map(|limits| (*schema_version, limits))
                    })
                    .ok_or(SandboxError::Codec {
                        reason: "pipeline checkpoint descriptor",
                    })?;
                progress
                    .validate(
                        &context.invocation_id,
                        &context.contribution_id,
                        schema_version,
                        limits,
                    )
                    .map_err(|_| SandboxError::Codec {
                        reason: "pipeline checkpoint progress",
                    })?;
                checkpoint_router
                    .publish(
                        &progress.invocation_id,
                        &progress.contribution_id,
                        progress.checkpoint.value,
                    )
                    .map_err(|_| SandboxError::HostCallFailed {
                        method: "pipeline.checkpoint".to_string(),
                    })?;
                Ok(json!({ "accepted": true }))
            },
        )
        .map_err(map_sandbox_error)?
        .with_contributions(pipeline_ids)
        .map_err(map_sandbox_error)?
        .with_scope_deriver(|params| {
            let contribution_id = params
                .as_object()
                .and_then(|value| value.get("contributionId"))
                .and_then(Value::as_str)
                .ok_or(SandboxError::Codec {
                    reason: "pipeline checkpoint scope",
                })?;
            Ok(PluginCapabilityScope::Contributions {
                contribution_ids: vec![contribution_id.to_string()],
            })
        });
        registry.register(method).map_err(map_sandbox_error)?;
    }
    Ok(registry)
}

// Silence unused import warnings for path helpers kept for clarity.
#[allow(dead_code)]
fn _path_anchor(path: &Path, _store: &Store, _registry: &FilterRegistry) -> PathBuf {
    path.to_path_buf()
}

#[allow(dead_code)]
type _OwnerMap = BTreeMap<String, String>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;
    use translunar_plugin_runtime::copy_package;
    use translunar_protocol::{AiConnectorAvailability, ErrorCode, PluginCapabilityAuditEvent};

    fn hello_srt_source() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("examples/plugins/hello-srt")
    }

    fn tier1_toolkit_source() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("examples/plugins/tier1-toolkit")
    }

    fn sandbox_toolkit_source() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("examples/plugins/sandbox-toolkit")
    }

    fn qa_pipeline_process_source() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("examples/plugins/qa-pipeline-process")
    }

    fn declarative_connector_source() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("examples/plugins/connector-openai-compatible")
    }

    fn declarative_connector_version_source(
        version: &str,
        mutate: impl FnOnce(&mut Value),
    ) -> tempfile::TempDir {
        let source = tempdir().expect("connector version source");
        copy_package(&declarative_connector_source(), source.path())
            .expect("copy connector package");
        let manifest_path = source.path().join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(
            &std::fs::read(&manifest_path).expect("read connector manifest"),
        )
        .expect("parse connector manifest");
        manifest["version"] = json!(version);
        for contribution in manifest["contributions"]
            .as_array_mut()
            .expect("connector contributions")
        {
            contribution["version"] = json!(version);
        }
        mutate(&mut manifest);
        std::fs::write(
            manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize connector manifest"),
        )
        .expect("write connector manifest");
        source
    }

    fn grant_required_capabilities(service: &mut EngineService, plugin_id: &str) {
        let requests = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: plugin_id.to_string(),
                    version_id: None,
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list capability requests");
        for request in requests.items.into_iter().filter(|item| {
            item.required
                && item.decision != translunar_plugin_runtime::PluginCapabilityDecision::Granted
        }) {
            service
                .grant_plugin_capability(translunar_protocol::PluginCapabilityGrantParams {
                    plugin_id: plugin_id.to_string(),
                    request_id: request.id,
                    expected_revision: request.revision,
                    scope: request.requested_scope,
                    actor: "test".to_string(),
                    reason: "explicit test grant".to_string(),
                })
                .expect("grant required capability");
        }
    }

    #[test]
    fn declarative_connector_lifecycle_restores_exact_catalog_and_profile_availability() {
        let data = tempdir().expect("data directory");
        let (plugin_id, profile_id, source) = {
            let mut service = EngineService::open(data.path()).expect("open connector engine");
            let installed = service
                .install_plugin(PluginInstallParams {
                    source_path: declarative_connector_source()
                        .to_string_lossy()
                        .into_owned(),
                    grant_requested: false,
                    actor: "test".to_string(),
                    reason: "install declarative connector".to_string(),
                })
                .expect("install declarative connector")
                .plugin;
            grant_required_capabilities(&mut service, &installed.id);
            let enabled = service
                .enable_plugin(PluginMutationParams {
                    plugin_id: installed.id.clone(),
                    expected_revision: Some(installed.revision),
                    actor: "test".to_string(),
                    reason: "enable declarative connector".to_string(),
                })
                .expect("enable declarative connector")
                .plugin;
            let catalog = service
                .ai_provider_catalog(translunar_protocol::AiProviderCatalogParams::default())
                .expect("list connector catalog");
            let connector = catalog
                .items
                .into_iter()
                .find(|item| item.id == "example.connector-openai-compatible.chat")
                .expect("active declarative connector catalog item");
            assert_eq!(connector.availability, AiConnectorAvailability::Available);
            assert!(connector.config_schema.is_some());
            assert_eq!(
                connector.operations,
                vec![
                    EngineConnectorOperation::ValidateConfig,
                    EngineConnectorOperation::Test,
                    EngineConnectorOperation::Generate,
                ]
            );
            let profile = service
                .create_ai_provider(translunar_protocol::AiProviderCreateParams {
                    name: "Declarative connector profile".to_string(),
                    kind: None,
                    source: Some(connector.source.clone()),
                    base_url: connector.default_base_url,
                    model: "fixture-model".to_string(),
                    timeout_ms: 5_000,
                    max_response_bytes: 1_048_576,
                    enabled: true,
                    config_schema_version: Some(connector.config_schema_version),
                    configuration: json!({
                        "maxOutputTokens": 1024,
                        "responseMode": "stream"
                    }),
                })
                .expect("create declarative connector profile");
            assert_eq!(profile.source, connector.source);
            assert_eq!(profile.kind, None);
            (enabled.id, profile.id, profile.source)
        };

        let mut restarted = EngineService::open(data.path()).expect("restart connector engine");
        let catalog = restarted
            .ai_provider_catalog(translunar_protocol::AiProviderCatalogParams::default())
            .expect("list restarted connector catalog");
        assert!(catalog.items.iter().any(|item| item.source == source));
        let profile = restarted
            .list_ai_providers(translunar_protocol::AiProviderListParams {
                offset: 0,
                limit: 100,
            })
            .expect("list restarted connector profiles")
            .items
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .expect("restarted connector profile");
        assert_eq!(profile.availability, AiConnectorAvailability::Available);

        let current = restarted
            .get_plugin(PluginIdParams {
                plugin_id: plugin_id.clone(),
            })
            .expect("read connector plugin before disable");
        FAIL_UNINSTALL_AFTER_DETACH.with(|fail| fail.set(true));
        let uninstall_error = restarted
            .uninstall_plugin(PluginMutationParams {
                plugin_id: plugin_id.clone(),
                expected_revision: Some(current.revision),
                actor: "test".to_string(),
                reason: "inject post-detach uninstall failure".to_string(),
            })
            .expect_err("failed uninstall must restore the live connector");
        assert!(matches!(uninstall_error, EngineError::InvalidState(_)));
        let restored_catalog = restarted
            .ai_provider_catalog(translunar_protocol::AiProviderCatalogParams::default())
            .expect("list catalog after failed uninstall");
        assert!(
            restored_catalog
                .items
                .iter()
                .any(|item| item.source == source)
        );
        assert!(restored_catalog.items.iter().any(|item| {
            item.source
                == EngineConnectorSource::Builtin {
                    provider: translunar_ai_core::AiProviderKind::Openai,
                }
        }));
        let current = restarted
            .get_plugin(PluginIdParams {
                plugin_id: plugin_id.clone(),
            })
            .expect("read restored connector plugin");
        assert_eq!(current.status, WirePluginStatus::Enabled);
        restarted
            .disable_plugin(PluginMutationParams {
                plugin_id: plugin_id.clone(),
                expected_revision: Some(current.revision),
                actor: "test".to_string(),
                reason: "disable connector".to_string(),
            })
            .expect("disable declarative connector");
        assert!(
            restarted
                .ai_provider_catalog(translunar_protocol::AiProviderCatalogParams::default())
                .expect("list detached connector catalog")
                .items
                .iter()
                .all(|item| item.source != source)
        );
        let profile = restarted
            .list_ai_providers(translunar_protocol::AiProviderListParams {
                offset: 0,
                limit: 100,
            })
            .expect("list unavailable connector profiles")
            .items
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .expect("preserved unavailable connector profile");
        assert_eq!(profile.availability, AiConnectorAvailability::Unavailable);

        let disabled = restarted
            .get_plugin(PluginIdParams {
                plugin_id: plugin_id.clone(),
            })
            .expect("read disabled connector");
        let reenabled = restarted
            .enable_plugin(PluginMutationParams {
                plugin_id: plugin_id.clone(),
                expected_revision: Some(disabled.revision),
                actor: "test".to_string(),
                reason: "re-enable before revocation".to_string(),
            })
            .expect("re-enable connector")
            .plugin;
        let connector_request = restarted
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: plugin_id.clone(),
                    version_id: reenabled.active_version_id.clone(),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list connector capability requests")
            .items
            .into_iter()
            .find(|request| request.capability_id == PluginCapabilityId::EngineConnector)
            .expect("engine connector capability request");
        let revoked = restarted
            .revoke_plugin_capability(translunar_protocol::PluginCapabilityDecisionParams {
                plugin_id: plugin_id.clone(),
                request_id: connector_request.id,
                expected_revision: connector_request.revision,
                actor: "test".to_string(),
                reason: "revoke connector authority".to_string(),
            })
            .expect("revoke connector capability");
        assert!(revoked.detached);
        assert_eq!(revoked.plugin.status, WirePluginStatus::Disabled);
        assert!(
            restarted
                .ai
                .connectors
                .lookup_source(&source)
                .expect("lookup revoked source")
                .is_none()
        );

        restarted
            .uninstall_plugin(PluginMutationParams {
                plugin_id: plugin_id.clone(),
                expected_revision: Some(revoked.plugin.revision),
                actor: "test".to_string(),
                reason: "uninstall revoked connector".to_string(),
            })
            .expect("uninstall connector");
        assert!(restarted.get_plugin(PluginIdParams { plugin_id }).is_err());
        let preserved_profile = restarted
            .list_ai_providers(translunar_protocol::AiProviderListParams {
                offset: 0,
                limit: 100,
            })
            .expect("list profiles after uninstall")
            .items
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .expect("profile preserved after uninstall");
        assert_eq!(
            preserved_profile.availability,
            AiConnectorAvailability::Unavailable
        );
    }

    #[test]
    fn connector_upgrade_rebinds_compatible_profiles_and_rollback_restores_owner() {
        let data = tempdir().expect("data directory");
        let incompatible = declarative_connector_version_source("2.0.0", |manifest| {
            let connector = &mut manifest["contributions"][0];
            connector["declarative"]["endpoint"]["destinationOrigin"] =
                json!("http://127.0.0.1:43124");
            connector["declarative"]["endpoint"]["urlTemplate"] =
                json!("http://127.0.0.1:43124/v1/chat/completions");
            manifest["capabilities"][1]["scope"]["origins"] = json!(["http://127.0.0.1:43124"]);
        });
        let compatible = declarative_connector_version_source("2.0.0", |_| {});
        let mut service = EngineService::open(data.path()).expect("open connector engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: declarative_connector_source()
                    .to_string_lossy()
                    .into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install connector v1".to_string(),
            })
            .expect("install connector v1")
            .plugin;
        let original_version_id = installed
            .active_version_id
            .clone()
            .expect("original connector version");
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable connector v1".to_string(),
            })
            .expect("enable connector v1")
            .plugin;
        let original_connector = service
            .ai_provider_catalog(translunar_protocol::AiProviderCatalogParams::default())
            .expect("list connector catalog")
            .items
            .into_iter()
            .find(|item| item.id == "example.connector-openai-compatible.chat")
            .expect("connector catalog item");
        let profile = service
            .create_ai_provider(translunar_protocol::AiProviderCreateParams {
                name: "Versioned connector profile".to_string(),
                kind: None,
                source: Some(original_connector.source.clone()),
                base_url: original_connector.default_base_url,
                model: "fixture-model".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
                config_schema_version: Some(original_connector.config_schema_version),
                configuration: json!({
                    "maxOutputTokens": 1024,
                    "responseMode": "stream"
                }),
            })
            .expect("create versioned connector profile");

        let incompatible_error = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: incompatible.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "reject origin expansion".to_string(),
            })
            .expect_err("origin expansion requires explicit migration");
        assert!(matches!(
            incompatible_error,
            EngineError::PluginUpgradeFailed(_)
        ));
        let after_rejection = service
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("read connector after rejected upgrade");
        assert_eq!(
            after_rejection.active_version_id,
            Some(original_version_id.clone())
        );
        assert_eq!(after_rejection.revision, enabled.revision);
        assert_eq!(
            service
                .store
                .get_ai_connector_profile(&profile.id)
                .expect("profile after rejected upgrade")
                .source,
            original_connector.source
        );

        let upgraded = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: compatible.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "compatible connector upgrade".to_string(),
            })
            .expect("upgrade compatible connector");
        let upgraded_profile = service
            .store
            .get_ai_connector_profile(&profile.id)
            .expect("profile rebound to candidate");
        assert_eq!(
            upgraded_profile
                .source
                .plugin_owner()
                .map(|owner| owner.version_id.as_str()),
            Some(upgraded.active_version_id.as_str())
        );
        assert!(
            service
                .ai
                .connectors
                .lookup_source(&upgraded_profile.source)
                .expect("candidate lookup")
                .is_some()
        );
        assert!(
            service
                .ai
                .connectors
                .lookup_source(&original_connector.source)
                .expect("previous lookup")
                .is_none()
        );

        let rolled_back = service
            .rollback_plugin(PluginRollbackParams {
                plugin_id: enabled.id,
                version_id: original_version_id.clone(),
                expected_revision: upgraded.plugin.revision,
                actor: "test".to_string(),
                reason: "restore connector v1".to_string(),
            })
            .expect("rollback connector");
        assert_eq!(rolled_back.active_version_id, original_version_id);
        let restored_profile = service
            .store
            .get_ai_connector_profile(&profile.id)
            .expect("profile rebound to original");
        assert_eq!(restored_profile.source, original_connector.source);
        assert!(
            service
                .ai
                .connectors
                .lookup_source(&restored_profile.source)
                .expect("restored lookup")
                .is_some()
        );
    }

    #[test]
    fn sandbox_toolkit_uses_bounded_runtime_and_detaches_cleanly() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: sandbox_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install sandbox toolkit".to_string(),
            })
            .expect("install sandbox toolkit")
            .plugin;
        assert_eq!(installed.tier, WirePluginTier::Sandbox);
        assert!(
            installed
                .compatibility
                .as_ref()
                .is_some_and(|value| value.compatible)
        );
        assert!(!service.filters.contains("example.sandbox-toolkit.echo"));
        assert!(service.plugin_processes.is_empty());
        assert!(service.plugin_sandbox_runtimes.is_empty());

        grant_required_capabilities(&mut service, &installed.id);
        let before_enable = service
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("sandbox before enable");
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(before_enable.revision),
                actor: "test".to_string(),
                reason: "enable sandbox toolkit".to_string(),
            })
            .expect("enable sandbox toolkit")
            .plugin;
        assert_eq!(enabled.status, WirePluginStatus::Enabled);
        assert!(service.plugin_processes.is_empty());
        assert_eq!(service.plugin_sandbox_runtimes.len(), 1);
        let source = data.path().join("sandbox-validate.txt");
        std::fs::write(&source, "bounded input").expect("write sandbox input");
        let report = service
            .filters
            .resolve("example.sandbox-toolkit.echo")
            .expect("sandbox filter")
            .validate(&source)
            .expect("sandbox validate");
        assert!(report.valid);
        let audit = service
            .list_plugin_capability_audit(translunar_protocol::PluginCapabilityAuditListParams {
                plugin_id: installed.id.clone(),
                request_id: None,
                offset: 0,
                limit: 200,
            })
            .expect("list sandbox capability audit");
        assert!(audit.items.iter().any(|entry| {
            entry.capability_id == PluginCapabilityId::DiagnosticsRead
                && entry.event == PluginCapabilityAuditEvent::OperationAllowed
                && entry.operation == "filter.validate"
                && entry.scope
                    == (PluginCapabilityScope::Diagnostics {
                        categories: vec!["summary".to_string()],
                    })
        }));

        drop(service);
        let mut reopened = EngineService::open(data.path()).expect("reopen engine");
        assert_eq!(reopened.plugin_sandbox_runtimes.len(), 1);
        assert!(reopened.plugin_processes.is_empty());
        let current = reopened
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("reopened sandbox");
        let disabled = reopened
            .disable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(current.revision),
                actor: "test".to_string(),
                reason: "disable sandbox toolkit".to_string(),
            })
            .expect("disable sandbox toolkit")
            .plugin;
        assert!(reopened.plugin_sandbox_runtimes.is_empty());
        assert!(!reopened.filters.contains("example.sandbox-toolkit.echo"));
        let enabled_again = reopened
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(disabled.revision),
                actor: "test".to_string(),
                reason: "re-enable sandbox toolkit".to_string(),
            })
            .expect("re-enable sandbox toolkit")
            .plugin;
        assert_eq!(enabled_again.status, WirePluginStatus::Enabled);
        let request = reopened
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: installed.id.clone(),
                    version_id: None,
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list sandbox requests")
            .items
            .into_iter()
            .find(|request| request.required)
            .expect("required sandbox request");
        let revoked = reopened
            .revoke_plugin_capability(translunar_protocol::PluginCapabilityDecisionParams {
                plugin_id: installed.id.clone(),
                request_id: request.id,
                expected_revision: request.revision,
                actor: "test".to_string(),
                reason: "revoke sandbox capability".to_string(),
            })
            .expect("revoke sandbox capability");
        assert!(revoked.detached);
        assert_eq!(revoked.plugin.status, WirePluginStatus::Disabled);
        assert!(reopened.plugin_sandbox_runtimes.is_empty());
        assert!(!reopened.filters.contains("example.sandbox-toolkit.echo"));

        grant_required_capabilities(&mut reopened, &installed.id);
        let before_final_enable = reopened
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("sandbox before final enable");
        let final_enabled = reopened
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(before_final_enable.revision),
                actor: "test".to_string(),
                reason: "enable before uninstall".to_string(),
            })
            .expect("enable before uninstall")
            .plugin;
        reopened
            .uninstall_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(final_enabled.revision),
                actor: "test".to_string(),
                reason: "uninstall sandbox toolkit".to_string(),
            })
            .expect("uninstall sandbox toolkit");
        assert!(reopened.plugin_sandbox_runtimes.is_empty());
        assert!(!reopened.filters.contains("example.sandbox-toolkit.echo"));
        assert!(
            reopened
                .get_plugin(PluginIdParams {
                    plugin_id: installed.id,
                })
                .is_err()
        );
    }

    #[test]
    fn sandbox_upgrade_initialization_failure_keeps_active_version_usable() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: sandbox_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install sandbox toolkit".to_string(),
            })
            .expect("install sandbox toolkit")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let installed = service
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("sandbox after grants");
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable sandbox toolkit".to_string(),
            })
            .expect("enable sandbox toolkit")
            .plugin;
        let old_version_id = enabled.active_version_id.clone();

        let candidate = tempdir().expect("candidate source");
        copy_package(&sandbox_toolkit_source(), candidate.path()).expect("copy candidate");
        let manifest_path = candidate.path().join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(
            &std::fs::read(&manifest_path).expect("read candidate manifest"),
        )
        .expect("parse candidate manifest");
        manifest["version"] = json!("0.2.0");
        for contribution in manifest["contributions"]
            .as_array_mut()
            .expect("candidate contributions")
        {
            contribution["version"] = json!("0.2.0");
        }
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize candidate manifest"),
        )
        .expect("write candidate manifest");
        std::fs::write(
            candidate.path().join("entry.mjs"),
            "export default { activate() { throw new Error('private path C:\\\\secret'); }, invoke() {} };",
        )
        .expect("write failing candidate entry");
        let error = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: candidate.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "reject failing sandbox candidate".to_string(),
            })
            .expect_err("candidate initialization must fail");
        assert!(matches!(error, EngineError::PluginUpgradeFailed(_)));
        let after = service
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("sandbox after failed upgrade");
        assert_eq!(after.revision, enabled.revision);
        assert_eq!(after.active_version_id, old_version_id);
        assert_eq!(service.plugin_sandbox_runtimes.len(), 1);
        let source = data.path().join("still-usable.txt");
        std::fs::write(&source, "still usable").expect("write validation source");
        assert!(
            service
                .filters
                .resolve("example.sandbox-toolkit.echo")
                .expect("old sandbox filter")
                .validate(&source)
                .expect("old sandbox remains usable")
                .valid
        );
    }

    #[test]
    fn sandbox_upgrade_and_rollback_swap_prepared_runtimes() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: sandbox_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install sandbox toolkit".to_string(),
            })
            .expect("install sandbox toolkit")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let installed = service
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("sandbox after grants");
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable sandbox toolkit".to_string(),
            })
            .expect("enable sandbox toolkit")
            .plugin;
        let original_version_id = enabled
            .active_version_id
            .clone()
            .expect("original active version");

        let candidate = tempdir().expect("candidate source");
        copy_package(&sandbox_toolkit_source(), candidate.path()).expect("copy candidate");
        let manifest_path = candidate.path().join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(
            &std::fs::read(&manifest_path).expect("read candidate manifest"),
        )
        .expect("parse candidate manifest");
        manifest["version"] = json!("0.2.0");
        for contribution in manifest["contributions"]
            .as_array_mut()
            .expect("candidate contributions")
        {
            contribution["version"] = json!("0.2.0");
        }
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize candidate manifest"),
        )
        .expect("write candidate manifest");
        let upgraded = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: candidate.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "upgrade sandbox toolkit".to_string(),
            })
            .expect("upgrade sandbox toolkit");
        assert_eq!(upgraded.plugin.version, "0.2.0");
        assert_ne!(upgraded.active_version_id, original_version_id);
        assert_eq!(service.plugin_sandbox_runtimes.len(), 1);
        assert_eq!(service.plugin_sandbox_keys.len(), 1);

        let rolled_back = service
            .rollback_plugin(PluginRollbackParams {
                plugin_id: enabled.id.clone(),
                version_id: original_version_id.clone(),
                expected_revision: upgraded.plugin.revision,
                actor: "test".to_string(),
                reason: "rollback sandbox toolkit".to_string(),
            })
            .expect("rollback sandbox toolkit");
        assert_eq!(rolled_back.active_version_id, original_version_id);
        assert_eq!(rolled_back.plugin.version, "0.1.0");
        assert_eq!(service.plugin_sandbox_runtimes.len(), 1);
        let source = data.path().join("rollback-usable.txt");
        std::fs::write(&source, "rollback usable").expect("write rollback source");
        assert!(
            service
                .filters
                .resolve("example.sandbox-toolkit.echo")
                .expect("rolled back sandbox filter")
                .validate(&source)
                .expect("rolled back sandbox usable")
                .valid
        );
    }

    #[test]
    fn sandbox_timeout_degrades_only_its_plugin_and_keeps_engine_healthy() {
        let data = tempdir().expect("data directory");
        let package = tempdir().expect("sandbox timeout package");
        copy_package(&sandbox_toolkit_source(), package.path()).expect("copy timeout package");
        std::fs::write(
            package.path().join("entry.mjs"),
            "export default { invoke() { while (true) {} } };",
        )
        .expect("write timeout entry");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: package.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install timeout sandbox".to_string(),
            })
            .expect("install timeout sandbox")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let installed = service
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("timeout sandbox after grants");
        service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable timeout sandbox".to_string(),
            })
            .expect("enable timeout sandbox");
        let source = data.path().join("timeout-source.txt");
        std::fs::write(&source, "bounded source").expect("write timeout source");
        let failure = service
            .filters
            .resolve("example.sandbox-toolkit.echo")
            .expect("timeout sandbox filter")
            .validate(&source)
            .expect_err("infinite loop must time out");
        assert!(matches!(
            &failure,
            FilterError::PluginSandboxFailed {
                kind: translunar_filter_core::PluginSandboxFailureKind::Timeout,
                ..
            }
        ));
        let error = service.handle_plugin_filter_failure(EngineError::Import(failure));
        let degraded = service
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("degraded timeout sandbox");
        assert_eq!(degraded.status, WirePluginStatus::Degraded);
        assert_eq!(degraded.crash_count, 1);
        assert!(
            degraded
                .last_error
                .as_deref()
                .is_some_and(|message| message.len() <= 4 * 1024 && !message.contains("source.txt"))
        );
        assert!(service.plugin_sandbox_runtimes.is_empty());
        assert!(!service.filters.contains("example.sandbox-toolkit.echo"));
        assert!(service.filters.contains("builtin.txt"));
        service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "Healthy after sandbox timeout".to_string(),
                source_locale: "en".to_string(),
                target_locale: "zh".to_string(),
                domain: "test".to_string(),
            })
            .expect("ordinary Engine RPC remains healthy");
        assert_eq!(crate::rpc_error(error).code, ErrorCode::PluginSandboxFailed);
    }

    #[test]
    fn sandbox_filter_collision_rejects_candidate_without_detaching_owner() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let first = service
            .install_plugin(PluginInstallParams {
                source_path: sandbox_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install sandbox owner".to_string(),
            })
            .expect("install sandbox owner")
            .plugin;
        grant_required_capabilities(&mut service, &first.id);
        let first = service
            .get_plugin(PluginIdParams {
                plugin_id: first.id.clone(),
            })
            .expect("sandbox owner after grants");
        service
            .enable_plugin(PluginMutationParams {
                plugin_id: first.id.clone(),
                expected_revision: Some(first.revision),
                actor: "test".to_string(),
                reason: "enable sandbox owner".to_string(),
            })
            .expect("enable sandbox owner");

        let collision = tempdir().expect("collision source");
        copy_package(&sandbox_toolkit_source(), collision.path()).expect("copy collision package");
        let manifest_path = collision.path().join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(
            &std::fs::read(&manifest_path).expect("read collision manifest"),
        )
        .expect("parse collision manifest");
        manifest["id"] = json!("example.sandbox-collision");
        manifest["displayName"] = json!("Sandbox Collision");
        manifest["contributions"][1]["id"] = json!("example.sandbox-collision.panel");
        let panel_capability = manifest["capabilities"]
            .as_array_mut()
            .expect("capability array")
            .iter_mut()
            .find(|capability| capability["capabilityId"] == "ui.panel")
            .expect("panel capability");
        panel_capability["scope"]["contributionIds"] = json!(["example.sandbox-collision.panel"]);
        panel_capability["contributionId"] = json!("example.sandbox-collision.panel");
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize collision manifest"),
        )
        .expect("write collision manifest");
        let second = service
            .install_plugin(PluginInstallParams {
                source_path: collision.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install sandbox collision".to_string(),
            })
            .expect("install sandbox collision")
            .plugin;
        grant_required_capabilities(&mut service, &second.id);
        let second = service
            .get_plugin(PluginIdParams {
                plugin_id: second.id.clone(),
            })
            .expect("sandbox collision after grants");
        let error = service
            .enable_plugin(PluginMutationParams {
                plugin_id: second.id.clone(),
                expected_revision: Some(second.revision),
                actor: "test".to_string(),
                reason: "reject sandbox collision".to_string(),
            })
            .expect_err("sandbox collision must fail");
        assert!(matches!(error, EngineError::PluginConflict(_)));
        assert_eq!(service.plugin_sandbox_runtimes.len(), 1);
        assert_eq!(
            service
                .plugin_filter_owners
                .get("example.sandbox-toolkit.echo")
                .map(String::as_str),
            Some("example.sandbox-toolkit")
        );
        assert_eq!(
            service
                .get_plugin(PluginIdParams {
                    plugin_id: second.id,
                })
                .expect("collision remains installed")
                .status,
            WirePluginStatus::Installed
        );
    }

    #[test]
    fn declarative_toolkit_runs_without_a_process_and_survives_restart() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: tier1_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install declarative toolkit".to_string(),
            })
            .expect("install declarative toolkit")
            .plugin;
        assert_eq!(installed.status, WirePluginStatus::Installed);
        assert!(
            installed
                .compatibility
                .as_ref()
                .is_some_and(|value| value.compatible)
        );
        assert!(!service.plugin_processes.contains_key(&installed.id));
        let denied = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "prove default deny".to_string(),
            })
            .expect_err("ungranted enable must fail");
        assert!(matches!(denied, EngineError::PluginCapabilityDenied(_)));
        assert!(!service.filters.contains("example.tier1.lines"));
        assert!(
            !service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(service.plugin_qa_registry.is_empty());

        grant_required_capabilities(&mut service, &installed.id);
        let inactive_operation = service
            .plugin_capabilities
            .authorizer()
            .authorize(&PluginCapabilityCheck {
                plugin_id: installed.id.clone(),
                version_id: installed
                    .active_version_id
                    .clone()
                    .expect("installed active version"),
                capability_id: PluginCapabilityId::FileRead,
                scope: PluginCapabilityScope::File {
                    areas: vec![PluginFileArea::Source],
                },
                operation: "untrusted.register".to_string(),
                contribution_id: Some("example.tier1.lines".to_string()),
            })
            .expect_err("an operation name cannot opt into registration preflight");
        assert_eq!(
            inactive_operation.code,
            translunar_plugin_runtime::PluginCapabilityDenialCode::Revoked
        );
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable declarative toolkit".to_string(),
            })
            .expect("enable declarative toolkit")
            .plugin;
        assert_eq!(enabled.status, WirePluginStatus::Enabled);
        assert!(service.filters.contains("example.tier1.lines"));
        assert!(
            service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(service.plugin_qa_registry.contains("example.tier1.qa"));
        assert!(!service.plugin_processes.contains_key(&enabled.id));

        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "Tier 1 project".to_string(),
                source_locale: "en".to_string(),
                target_locale: "fr".to_string(),
                domain: "test".to_string(),
            })
            .expect("create project");
        let imported = service
            .import_document(translunar_protocol::ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: tier1_toolkit_source()
                    .join("sample.catlines")
                    .to_string_lossy()
                    .into_owned(),
                relative_path: None,
                filter_id: Some("example.tier1.lines".to_string()),
                options: Default::default(),
            })
            .expect("import declarative document");
        let profile_before = service
            .store
            .resolve_qa_profile(&project.id, None)
            .expect("resolve profile before plugin QA");
        let segments = service
            .store
            .all_segments(&imported.document.id)
            .expect("list imported segments");
        assert_eq!(segments.len(), 2);
        service
            .update_target(translunar_protocol::UpdateTargetParams {
                segment_id: segments[0].id.clone(),
                target_text: "TODO".to_string(),
                expected_revision: segments[0].revision,
            })
            .expect("update target");
        let live_issues = service
            .list_qa_issues(translunar_protocol::QaIssueListParams {
                project_id: project.id.clone(),
                document_id: Some(imported.document.id.clone()),
                segment_id: Some(segments[0].id.clone()),
                severity: None,
                category: None,
                disposition: None,
                rule_id: None,
                offset: 0,
                limit: 200,
            })
            .expect("list live plugin QA issues");
        assert!(
            live_issues
                .items
                .iter()
                .any(|issue| issue.rule_id.ends_with(".todo-placeholder"))
        );
        let qa_run = service
            .run_qa(translunar_protocol::QaRunParams {
                project_id: project.id.clone(),
                document_id: Some(imported.document.id.clone()),
                profile_id: None,
            })
            .expect("run plugin QA");
        let profile_after = service
            .store
            .resolve_qa_profile(&project.id, None)
            .expect("resolve profile after plugin QA");
        assert_eq!(profile_after.definition, profile_before.definition);
        let base_profile_hash = translunar_domain::sha256_hex(
            serde_json::to_string(&profile_before.definition)
                .expect("serialize base profile")
                .as_bytes(),
        );
        assert_ne!(qa_run.profile_snapshot_hash, base_profile_hash);
        let issues = service
            .list_qa_issues(translunar_protocol::QaIssueListParams {
                project_id: project.id,
                document_id: Some(imported.document.id.clone()),
                segment_id: None,
                severity: None,
                category: None,
                disposition: None,
                rule_id: None,
                offset: 0,
                limit: 200,
            })
            .expect("list QA issues");
        assert!(issues.items.iter().any(|issue| {
            issue
                .rule_id
                .starts_with("qa.regex:plugin.qa.example.tier1-toolkit.")
                && issue.rule_id.contains(".example.tier1.qa.v")
                && issue.rule_id.ends_with(".todo-placeholder")
        }));

        let step = service
            .pipeline
            .registry
            .resolve("example.tier1.normalize")
            .expect("resolve declarative step");
        let transformed = step
            .execute(translunar_pipeline::StepExecutionContext {
                run_id: "test-run".to_string(),
                project_id: "test-project".to_string(),
                document_id: None,
                input: json!({
                    "schemaVersion": 1,
                    "status": "draft",
                    "title": "A   title"
                }),
                config: Value::Null,
                checkpoint: None,
                deadline_ms: 120_000,
                cancellation: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            })
            .expect("execute declarative step");
        assert_eq!(transformed.output["status"], "ready");
        assert_eq!(transformed.output["title"], "A title");

        drop(service);
        let mut service = EngineService::open(data.path()).expect("restart engine");
        assert!(service.filters.contains("example.tier1.lines"));
        assert!(
            service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(service.plugin_qa_registry.contains("example.tier1.qa"));
        assert!(service.plugin_processes.is_empty());
        assert_eq!(
            service
                .store
                .get_qa_run(&qa_run.id)
                .expect("historic QA run")
                .id,
            qa_run.id
        );

        let qa_request = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: enabled.id.clone(),
                    version_id: enabled.active_version_id.clone(),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list Tier 1 grants")
            .items
            .into_iter()
            .find(|request| request.capability_id == PluginCapabilityId::QaRegister)
            .expect("QA registration grant");
        let revoked = service
            .revoke_plugin_capability(translunar_protocol::PluginCapabilityDecisionParams {
                plugin_id: enabled.id.clone(),
                request_id: qa_request.id.clone(),
                expected_revision: qa_request.revision,
                actor: "test".to_string(),
                reason: "revoke Tier 1 QA pack".to_string(),
            })
            .expect("revoke Tier 1 QA pack");
        assert!(revoked.detached);
        assert_eq!(revoked.plugin.status, WirePluginStatus::Disabled);
        assert!(!service.filters.contains("example.tier1.lines"));
        assert!(
            !service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(service.plugin_qa_registry.is_empty());
        assert!(service.store.get_qa_run(&qa_run.id).is_ok());

        let granted = service
            .grant_plugin_capability(translunar_protocol::PluginCapabilityGrantParams {
                plugin_id: enabled.id.clone(),
                request_id: revoked.request.id,
                expected_revision: revoked.request.revision,
                scope: revoked.request.requested_scope,
                actor: "test".to_string(),
                reason: "restore Tier 1 QA pack".to_string(),
            })
            .expect("restore Tier 1 QA pack");
        let reenabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: enabled.id.clone(),
                expected_revision: Some(granted.plugin.revision),
                actor: "test".to_string(),
                reason: "reenable declarative toolkit".to_string(),
            })
            .expect("reenable declarative toolkit")
            .plugin;
        let disabled = service
            .disable_plugin(PluginMutationParams {
                plugin_id: enabled.id.clone(),
                expected_revision: Some(reenabled.revision),
                actor: "test".to_string(),
                reason: "disable declarative toolkit".to_string(),
            })
            .expect("disable declarative toolkit")
            .plugin;
        assert!(!service.filters.contains("example.tier1.lines"));
        assert!(
            !service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(service.plugin_qa_registry.is_empty());
        assert!(service.store.get_qa_run(&qa_run.id).is_ok());
        service
            .uninstall_plugin(PluginMutationParams {
                plugin_id: disabled.id,
                expected_revision: Some(disabled.revision),
                actor: "test".to_string(),
                reason: "uninstall declarative toolkit".to_string(),
            })
            .expect("uninstall declarative toolkit");
        assert!(service.store.get_qa_run(&qa_run.id).is_ok());
    }

    #[test]
    fn declarative_collision_rolls_back_without_detaching_the_owner() {
        let data = tempdir().expect("data directory");
        let second_source = tempdir().expect("second plugin package");
        copy_package(&tier1_toolkit_source(), second_source.path()).expect("copy Tier 1 package");
        let manifest_path = second_source.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read second manifest"))
                .expect("parse second manifest");
        manifest["id"] = json!("example.tier1-collision");
        manifest["displayName"] = json!("Tier 1 collision");
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize second manifest"),
        )
        .expect("write second manifest");

        let mut service = EngineService::open(data.path()).expect("open engine");
        let first = service
            .install_plugin(PluginInstallParams {
                source_path: tier1_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install owner".to_string(),
            })
            .expect("install owner")
            .plugin;
        grant_required_capabilities(&mut service, &first.id);
        let first = service
            .enable_plugin(PluginMutationParams {
                plugin_id: first.id,
                expected_revision: Some(first.revision),
                actor: "test".to_string(),
                reason: "enable owner".to_string(),
            })
            .expect("enable owner")
            .plugin;

        let second = service
            .install_plugin(PluginInstallParams {
                source_path: second_source.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install collision".to_string(),
            })
            .expect("install collision")
            .plugin;
        grant_required_capabilities(&mut service, &second.id);
        let error = service
            .enable_plugin(PluginMutationParams {
                plugin_id: second.id.clone(),
                expected_revision: Some(second.revision),
                actor: "test".to_string(),
                reason: "collision must fail".to_string(),
            })
            .expect_err("collision must fail");
        assert!(matches!(error, EngineError::PluginConflict(_)));
        assert!(service.filters.contains("example.tier1.lines"));
        assert!(
            service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert_eq!(
            service
                .plugin_qa_registry
                .owner("example.tier1.qa")
                .map(|owner| owner.plugin_id),
            Some(first.id.clone())
        );
        assert_eq!(
            service
                .get_plugin(PluginIdParams {
                    plugin_id: second.id,
                })
                .expect("collision inventory")
                .status,
            WirePluginStatus::Installed
        );
    }

    #[test]
    fn declarative_upgrade_and_rollback_replace_every_adapter_version() {
        let data = tempdir().expect("data directory");
        let upgrade_source = tempdir().expect("upgrade package");
        copy_package(&tier1_toolkit_source(), upgrade_source.path()).expect("copy Tier 1 package");
        let manifest_path = upgrade_source.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read upgrade manifest"))
                .expect("parse upgrade manifest");
        manifest["version"] = json!("2.0.0");
        for contribution in manifest["contributions"]
            .as_array_mut()
            .expect("contributions")
        {
            contribution["version"] = json!("2.0.0");
            if contribution["kind"] == "pipelineStep" {
                contribution["declarative"]["operations"][1]["value"] = json!("upgraded");
            }
        }
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize upgrade manifest"),
        )
        .expect("write upgrade manifest");

        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: tier1_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install Tier 1 v1".to_string(),
            })
            .expect("install Tier 1 v1")
            .plugin;
        let original_version_id = installed
            .active_version_id
            .clone()
            .expect("original version id");
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id,
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable Tier 1 v1".to_string(),
            })
            .expect("enable Tier 1 v1")
            .plugin;
        let upgraded = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: upgrade_source.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "upgrade Tier 1 adapters".to_string(),
            })
            .expect("upgrade Tier 1 adapters");
        assert_eq!(upgraded.plugin.version, "2.0.0");
        assert_eq!(execute_tier1_pipeline(&service)["status"], "upgraded");

        let rolled_back = service
            .rollback_plugin(PluginRollbackParams {
                plugin_id: enabled.id,
                version_id: original_version_id,
                expected_revision: upgraded.plugin.revision,
                actor: "test".to_string(),
                reason: "rollback Tier 1 adapters".to_string(),
            })
            .expect("rollback Tier 1 adapters");
        assert_eq!(rolled_back.plugin.version, "1.0.0");
        assert_eq!(execute_tier1_pipeline(&service)["status"], "ready");
        assert!(service.filters.contains("example.tier1.lines"));
        assert!(service.plugin_qa_registry.contains("example.tier1.qa"));
    }

    #[test]
    fn declarative_rollback_collision_preflight_keeps_current_version() {
        let data = tempdir().expect("data directory");
        let upgrade_source = tempdir().expect("upgrade package");
        let collision_source = tempdir().expect("collision package");
        copy_package(&tier1_toolkit_source(), upgrade_source.path()).expect("copy upgrade package");
        copy_package(&tier1_toolkit_source(), collision_source.path())
            .expect("copy collision package");

        let upgrade_manifest_path = upgrade_source.path().join("manifest.json");
        let mut upgrade_manifest: Value = serde_json::from_slice(
            &std::fs::read(&upgrade_manifest_path).expect("read upgrade manifest"),
        )
        .expect("parse upgrade manifest");
        upgrade_manifest["version"] = json!("2.0.0");
        let remapped_ids = [
            ("example.tier1.lines", "example.tier1.v2.lines"),
            ("example.tier1.qa", "example.tier1.v2.qa"),
            ("example.tier1.normalize", "example.tier1.v2.normalize"),
        ];
        for contribution in upgrade_manifest["contributions"]
            .as_array_mut()
            .expect("upgrade contributions")
        {
            contribution["version"] = json!("2.0.0");
            let current_id = contribution["id"].as_str().expect("contribution id");
            let next_id = remapped_ids
                .iter()
                .find_map(|(old, new)| (*old == current_id).then_some(*new))
                .expect("remapped contribution id");
            contribution["id"] = json!(next_id);
            if contribution["kind"] == "pipelineStep" {
                contribution["declarative"]["operations"][1]["value"] = json!("upgraded");
            }
        }
        for capability in upgrade_manifest["capabilities"]
            .as_array_mut()
            .expect("upgrade capabilities")
        {
            let current_id = capability["contributionId"]
                .as_str()
                .expect("capability contribution id");
            let next_id = remapped_ids
                .iter()
                .find_map(|(old, new)| (*old == current_id).then_some(*new))
                .expect("remapped capability contribution id");
            capability["contributionId"] = json!(next_id);
            if capability["scope"]["kind"] == "contributions" {
                capability["scope"]["contributionIds"] = json!([next_id]);
            }
        }
        std::fs::write(
            &upgrade_manifest_path,
            serde_json::to_vec_pretty(&upgrade_manifest).expect("serialize upgrade manifest"),
        )
        .expect("write upgrade manifest");

        let collision_manifest_path = collision_source.path().join("manifest.json");
        let mut collision_manifest: Value = serde_json::from_slice(
            &std::fs::read(&collision_manifest_path).expect("read collision manifest"),
        )
        .expect("parse collision manifest");
        collision_manifest["id"] = json!("example.tier1-rollback-collision");
        collision_manifest["displayName"] = json!("Tier 1 rollback collision");
        std::fs::write(
            &collision_manifest_path,
            serde_json::to_vec_pretty(&collision_manifest).expect("serialize collision manifest"),
        )
        .expect("write collision manifest");

        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: tier1_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install rollback owner".to_string(),
            })
            .expect("install rollback owner")
            .plugin;
        let original_version_id = installed
            .active_version_id
            .clone()
            .expect("original version id");
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id,
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable rollback owner".to_string(),
            })
            .expect("enable rollback owner")
            .plugin;
        let disabled = service
            .disable_plugin(PluginMutationParams {
                plugin_id: enabled.id,
                expected_revision: Some(enabled.revision),
                actor: "test".to_string(),
                reason: "prepare remapped upgrade".to_string(),
            })
            .expect("disable rollback owner")
            .plugin;
        let upgraded = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: disabled.id.clone(),
                source_path: upgrade_source.path().to_string_lossy().into_owned(),
                expected_revision: disabled.revision,
                actor: "test".to_string(),
                reason: "activate remapped version".to_string(),
            })
            .expect("upgrade while disabled");
        grant_required_capabilities(&mut service, &disabled.id);
        let upgraded_enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: disabled.id.clone(),
                expected_revision: Some(upgraded.plugin.revision),
                actor: "test".to_string(),
                reason: "enable remapped version".to_string(),
            })
            .expect("enable remapped version")
            .plugin;

        let collision = service
            .install_plugin(PluginInstallParams {
                source_path: collision_source.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install old-id owner".to_string(),
            })
            .expect("install old-id owner")
            .plugin;
        grant_required_capabilities(&mut service, &collision.id);
        let collision = service
            .enable_plugin(PluginMutationParams {
                plugin_id: collision.id,
                expected_revision: Some(collision.revision),
                actor: "test".to_string(),
                reason: "claim old contribution ids".to_string(),
            })
            .expect("enable old-id owner")
            .plugin;

        let error = service
            .rollback_plugin(PluginRollbackParams {
                plugin_id: upgraded_enabled.id.clone(),
                version_id: original_version_id,
                expected_revision: upgraded_enabled.revision,
                actor: "test".to_string(),
                reason: "rollback must reject collision before switching".to_string(),
            })
            .expect_err("rollback preflight must fail");
        assert!(matches!(error, EngineError::PluginConflict(_)));

        let restored = service
            .get_plugin(PluginIdParams {
                plugin_id: upgraded_enabled.id,
            })
            .expect("restored current version");
        assert_eq!(restored.version, "2.0.0");
        assert_eq!(restored.status, WirePluginStatus::Enabled);
        assert_eq!(restored.revision, upgraded_enabled.revision);
        assert_eq!(restored.active_version_id, Some(upgraded.active_version_id));
        assert!(service.filters.contains("example.tier1.v2.lines"));
        assert!(service.plugin_qa_registry.contains("example.tier1.v2.qa"));
        assert!(
            service
                .pipeline
                .registry
                .contains("example.tier1.v2.normalize")
        );
        assert_eq!(
            service
                .plugin_filter_owners
                .get("example.tier1.lines")
                .map(String::as_str),
            Some(collision.id.as_str())
        );
        assert_eq!(
            service
                .plugin_qa_registry
                .owner("example.tier1.qa")
                .map(|owner| owner.plugin_id),
            Some(collision.id.clone())
        );
    }

    fn execute_tier1_pipeline(service: &EngineService) -> Value {
        service
            .pipeline
            .registry
            .resolve("example.tier1.normalize")
            .expect("resolve Tier 1 pipeline")
            .execute(translunar_pipeline::StepExecutionContext {
                run_id: "test-run".to_string(),
                project_id: "test-project".to_string(),
                document_id: None,
                input: json!({
                    "schemaVersion": 1,
                    "status": "draft",
                    "title": "A   title"
                }),
                config: Value::Null,
                checkpoint: None,
                deadline_ms: 120_000,
                cancellation: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            })
            .expect("execute Tier 1 pipeline")
            .output
    }

    #[test]
    fn duplicate_install_is_rejected_without_mutating_enabled_plugin() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let source = hello_srt_source();
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: source.to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "first install".to_string(),
            })
            .expect("install plugin")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable".to_string(),
            })
            .expect("enable plugin")
            .plugin;
        let managed_entry = PathBuf::from(&enabled.package_path).join("bin/hello-srt.mjs");
        let entry_before = std::fs::read(&managed_entry).expect("read managed entry");
        let process_before = service
            .plugin_processes
            .get(&enabled.id)
            .expect("enabled process");

        let stale_disable = service
            .disable_plugin(PluginMutationParams {
                plugin_id: enabled.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "stale disable".to_string(),
            })
            .expect_err("stale disable must fail before unregistering");
        assert!(matches!(stale_disable, EngineError::Storage(_)));
        assert!(service.filters.contains("example.hello-srt"));
        assert!(service.plugin_processes.contains_key("example.hello-srt"));

        let stale_enable = service
            .enable_plugin(PluginMutationParams {
                plugin_id: enabled.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "stale enable".to_string(),
            })
            .expect_err("stale enable must fail before replacing registration");
        assert!(matches!(stale_enable, EngineError::Storage(_)));
        assert!(service.filters.contains("example.hello-srt"));
        assert!(service.plugin_processes.contains_key("example.hello-srt"));

        let error = service
            .install_plugin(PluginInstallParams {
                source_path: source.to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "duplicate".to_string(),
            })
            .expect_err("duplicate id must fail");
        assert!(matches!(error, EngineError::InvalidState(_)));

        let after = service
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("plugin remains installed");
        assert_eq!(after, enabled);
        assert_eq!(
            std::fs::read(&managed_entry).expect("managed entry survives"),
            entry_before
        );
        assert!(service.filters.contains("example.hello-srt"));
        assert!(Arc::ptr_eq(
            &process_before,
            &service
                .plugin_processes
                .get("example.hello-srt")
                .expect("same process survives duplicate rejection")
        ));
    }

    #[test]
    fn invalid_install_and_missing_grants_have_no_partial_registration() {
        for (case, mutation) in [
            ("incompatible API", ("apiVersionMin", json!(2))),
            (
                "missing entry",
                ("entry", json!({ "kind": "node", "path": "missing.mjs" })),
            ),
        ] {
            let data = tempdir().expect("data directory");
            let package = tempdir().expect("plugin package");
            copy_package(&hello_srt_source(), package.path()).expect("copy fixture");
            let manifest_path = package.path().join("manifest.json");
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&manifest_path).expect("read manifest"))
                    .expect("parse manifest");
            manifest[mutation.0] = mutation.1;
            std::fs::write(
                &manifest_path,
                serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
            )
            .expect("write manifest");

            let mut service = EngineService::open(data.path()).expect("open engine");
            let error = service
                .install_plugin(PluginInstallParams {
                    source_path: package.path().to_string_lossy().into_owned(),
                    grant_requested: true,
                    actor: "test".to_string(),
                    reason: case.to_string(),
                })
                .expect_err(case);
            assert_eq!(
                crate::rpc_error(error).code,
                ErrorCode::PluginInvalidManifest
            );
            assert_eq!(
                service
                    .list_plugins(PluginListParams {
                        offset: 0,
                        limit: 20,
                    })
                    .expect("list plugins")
                    .total,
                0
            );
            assert!(service.plugin_processes.is_empty());
            assert!(!service.filters.contains("example.hello-srt"));
            assert!(!data.path().join("plugins/example.hello-srt").exists());
        }

        let data = tempdir().expect("permission data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: hello_srt_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "permission rejection".to_string(),
            })
            .expect("install without grants")
            .plugin;
        assert!(installed.granted_permissions.is_empty());
        let pending = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: installed.id.clone(),
                    version_id: installed.active_version_id.clone(),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list pending requests");
        assert!(pending.items.iter().all(|request| {
            request.decision == translunar_plugin_runtime::PluginCapabilityDecision::Pending
        }));
        let error = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "permission rejection".to_string(),
            })
            .expect_err("missing grants must fail");
        assert_eq!(
            crate::rpc_error(error).code,
            ErrorCode::PluginPermissionDenied
        );
        assert_eq!(
            service
                .get_plugin(PluginIdParams {
                    plugin_id: installed.id.clone(),
                })
                .expect("installed state remains"),
            installed
        );
        assert!(service.plugin_processes.is_empty());
        assert!(!service.filters.contains("example.hello-srt"));
    }

    #[test]
    fn blue_green_upgrade_rollback_and_restart_keep_immutable_package_roots() {
        let data = tempdir().expect("data directory");
        let source_v1 = tempdir().expect("v1 source");
        copy_package(&hello_srt_source(), source_v1.path()).expect("copy v1 fixture");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: source_v1.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install v1".to_string(),
            })
            .expect("install v1")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable v1".to_string(),
            })
            .expect("enable v1")
            .plugin;
        let versions_before = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id.clone(),
                offset: 0,
                limit: 20,
            })
            .expect("list v1 history");
        assert_eq!(versions_before.total, 1);
        let old_version = versions_before.items[0].clone();
        assert!(old_version.package_path.contains(".versions"));
        assert!(Path::new(&old_version.package_path).is_dir());

        let source_v2 = tempdir().expect("v2 source");
        copy_package(&hello_srt_source(), source_v2.path()).expect("copy v2 fixture");
        let manifest_path = source_v2.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read v2 manifest"))
                .expect("parse v2 manifest");
        manifest["version"] = json!("0.2.0");
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize v2 manifest"),
        )
        .expect("write v2 manifest");

        let upgraded = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: source_v2.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "upgrade v2".to_string(),
            })
            .expect("upgrade v2");
        assert_eq!(
            upgraded.plugin.status,
            translunar_protocol::PluginStatus::Enabled
        );
        assert_ne!(upgraded.active_version_id, old_version.id);
        assert_eq!(
            upgraded.previous_version_id.as_deref(),
            Some(old_version.id.as_str())
        );
        assert!(Path::new(&old_version.package_path).is_dir());
        let active_path = upgraded.plugin.package_path.clone();
        assert!(active_path.contains(".versions"));
        assert!(Path::new(&active_path).is_dir());
        let carried = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: enabled.id.clone(),
                    version_id: Some(upgraded.active_version_id.clone()),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list carried grants");
        assert!(carried.items.iter().all(|request| {
            request.decision == translunar_plugin_runtime::PluginCapabilityDecision::Granted
                && request.carried_from_request_id.is_some()
        }));
        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id.clone(),
                offset: 0,
                limit: 20,
            })
            .expect("list upgraded history");
        assert_eq!(history.total, 2);

        drop(service);
        let mut restarted = EngineService::open(data.path()).expect("restart engine");
        let after_restart = restarted
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("read upgraded plugin after restart");
        assert_eq!(
            after_restart.status,
            translunar_protocol::PluginStatus::Enabled
        );
        assert_eq!(
            after_restart.active_version_id,
            upgraded.plugin.active_version_id
        );
        assert!(restarted.filters.contains("example.hello-srt"));

        let rolled_back = restarted
            .rollback_plugin(PluginRollbackParams {
                plugin_id: enabled.id.clone(),
                version_id: old_version.id.clone(),
                expected_revision: after_restart.revision,
                actor: "test".to_string(),
                reason: "rollback v1".to_string(),
            })
            .expect("rollback v1");
        assert_eq!(rolled_back.active_version_id, old_version.id);
        assert!(restarted.filters.contains("example.hello-srt"));
        let uninstall_revision = rolled_back.plugin.revision;
        restarted
            .uninstall_plugin(PluginMutationParams {
                plugin_id: enabled.id,
                expected_revision: Some(uninstall_revision),
                actor: "test".to_string(),
                reason: "uninstall".to_string(),
            })
            .expect("uninstall all version roots");
        assert!(
            !data
                .path()
                .join("plugins/.versions/example.hello-srt")
                .exists()
        );
    }

    #[test]
    fn upgrade_scope_expansion_requires_fresh_consent() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: hello_srt_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install v1".to_string(),
            })
            .expect("install v1")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable v1".to_string(),
            })
            .expect("enable v1")
            .plugin;

        let expanded_package = tempdir().expect("expanded package");
        copy_package(&hello_srt_source(), expanded_package.path()).expect("copy fixture");
        let manifest_path = expanded_package.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read expanded manifest"))
                .expect("parse expanded manifest");
        manifest["version"] = json!("0.2.0");
        manifest["capabilities"] = json!([{
            "capabilityId": "network.connect",
            "required": true,
            "scope": {
                "kind": "network",
                "origins": ["https://api.example.test"]
            }
        }]);
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize expanded manifest"),
        )
        .expect("write expanded manifest");

        let upgraded = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: expanded_package.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "request network scope".to_string(),
            })
            .expect("retain expanded version for review");
        assert_eq!(upgraded.plugin.status, WirePluginStatus::Disabled);
        assert!(!service.filters.contains("example.hello-srt"));
        let requests = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: enabled.id.clone(),
                    version_id: Some(upgraded.active_version_id.clone()),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list expanded requests");
        let network = requests
            .items
            .iter()
            .find(|request| {
                request.capability_id
                    == translunar_plugin_runtime::PluginCapabilityId::NetworkConnect
            })
            .expect("network request");
        assert_eq!(
            network.decision,
            translunar_plugin_runtime::PluginCapabilityDecision::Pending
        );
        assert!(
            requests
                .items
                .iter()
                .filter(|request| {
                    request.capability_id
                        != translunar_plugin_runtime::PluginCapabilityId::NetworkConnect
                })
                .all(|request| {
                    request.decision == translunar_plugin_runtime::PluginCapabilityDecision::Granted
                        && request.carried_from_request_id.is_some()
                })
        );
        let denied = service
            .enable_plugin(PluginMutationParams {
                plugin_id: enabled.id.clone(),
                expected_revision: Some(upgraded.plugin.revision),
                actor: "test".to_string(),
                reason: "premature enable".to_string(),
            })
            .expect_err("expanded scope must remain denied");
        assert_eq!(
            crate::rpc_error(denied).code,
            ErrorCode::PluginPermissionDenied
        );

        grant_required_capabilities(&mut service, &enabled.id);
        let enabled_v2 = service
            .enable_plugin(PluginMutationParams {
                plugin_id: enabled.id,
                expected_revision: Some(upgraded.plugin.revision),
                actor: "test".to_string(),
                reason: "enable after review".to_string(),
            })
            .expect("enable reviewed version")
            .plugin;
        assert_eq!(enabled_v2.status, WirePluginStatus::Enabled);
        assert!(service.filters.contains("example.hello-srt"));
    }

    #[test]
    fn unsupported_optional_capability_stays_visible_and_cannot_be_granted() {
        let data = tempdir().expect("data directory");
        let package = tempdir().expect("plugin package");
        copy_package(&hello_srt_source(), package.path()).expect("copy fixture");
        let manifest_path = package.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read manifest"))
                .expect("parse manifest");
        manifest["capabilities"] = json!([{
            "capabilityId": "future.translation.inspect",
            "required": false,
            "scope": {"kind": "unscoped"}
        }]);
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: package.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "legacy-client".to_string(),
                reason: "install optional future capability".to_string(),
            })
            .expect("install with unsupported optional capability")
            .plugin;
        let review = service
            .review_plugin_capabilities(translunar_protocol::PluginCapabilityReviewParams {
                plugin_id: installed.id.clone(),
            })
            .expect("review optional future capability");
        let unsupported = review
            .requests
            .iter()
            .find(|request| request.capability_id.as_str() == "future.translation.inspect")
            .expect("future capability remains visible");
        assert!(!unsupported.supported);
        assert!(!unsupported.required);
        assert_eq!(
            unsupported.decision,
            translunar_plugin_runtime::PluginCapabilityDecision::Pending
        );
        let grant_error = service
            .grant_plugin_capability(translunar_protocol::PluginCapabilityGrantParams {
                plugin_id: installed.id.clone(),
                request_id: unsupported.id.clone(),
                expected_revision: unsupported.revision,
                scope: unsupported.requested_scope.clone(),
                actor: "reviewer".to_string(),
                reason: "attempt unsupported grant".to_string(),
            })
            .expect_err("unsupported capability must never gain authority");
        assert!(matches!(
            grant_error,
            EngineError::Storage(translunar_storage::StorageError::InvalidState(_))
        ));

        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "reviewer".to_string(),
                reason: "enable with optional unsupported capability".to_string(),
            })
            .expect("optional unsupported capability does not block enable")
            .plugin;
        assert_eq!(enabled.status, WirePluginStatus::Enabled);

        manifest["capabilities"][0]["required"] = json!(true);
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize required manifest"),
        )
        .expect("write required manifest");
        let required_data = tempdir().expect("required data directory");
        let mut required_service =
            EngineService::open(required_data.path()).expect("open required engine");
        let required_error = required_service
            .install_plugin(PluginInstallParams {
                source_path: package.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install required future capability".to_string(),
            })
            .expect_err("required unsupported capability must fail closed");
        assert!(matches!(
            required_error,
            EngineError::PluginCapabilityUnsupported(capability_id)
                if capability_id == "future.translation.inspect"
        ));
    }

    #[test]
    fn unsupported_v2_install_is_inventory_only_and_never_attaches() {
        let data = tempdir().expect("data directory");
        let package = tempdir().expect("v2 package");
        std::fs::write(
            package.path().join("manifest.json"),
            r#"{
              "manifestVersion": 2,
              "id": "example.declarative",
              "displayName": "Declarative fixture",
              "version": "1.0.0",
              "hostApi": { "min": 1, "max": 1 },
              "runtime": {
                "tier": "declarative",
                "runtimeVersion": 1,
                "entry": { "kind": "manifest" }
              },
              "contributions": [{
                "kind": "qaRule",
                "descriptorVersion": 1,
                "id": "example.declarative.rule",
                "version": "1.0.0",
                "displayName": "Declarative rule",
                "ruleType": "style",
                "severity": "warning",
                "definition": {}
              }],
              "permissions": []
            }"#,
        )
        .expect("write v2 manifest");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: package.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "inventory unsupported tier".to_string(),
            })
            .expect("unsupported package remains inventory")
            .plugin;
        assert_eq!(
            installed.status,
            translunar_protocol::PluginStatus::Installed
        );
        assert_eq!(installed.tier, translunar_protocol::PluginTier::Declarative);
        assert_eq!(
            installed
                .compatibility
                .as_ref()
                .map(|value| value.compatible),
            Some(false)
        );
        assert!(installed.contributions.iter().any(|value| matches!(
            value,
            translunar_protocol::PluginContributionDescriptor::QaRule(_)
        )));
        assert!(service.plugin_processes.is_empty());
        assert!(
            service
                .filters
                .descriptors()
                .iter()
                .all(|value| !value.id.starts_with("example.declarative"))
        );
        let error = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "unsupported enable".to_string(),
            })
            .expect_err("unsupported enable must fail closed");
        assert_eq!(
            crate::rpc_error(error).code,
            ErrorCode::PluginCapabilityUnsupported
        );
        assert_eq!(
            service
                .get_plugin(PluginIdParams {
                    plugin_id: installed.id,
                })
                .expect("read inventory")
                .revision,
            installed.revision
        );
    }

    #[test]
    fn process_upgrade_preflight_failure_keeps_active_generation_unchanged() {
        let data = tempdir().expect("data directory");
        let source_v1 = tempdir().expect("v1 source");
        copy_package(&hello_srt_source(), source_v1.path()).expect("copy v1 fixture");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: source_v1.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install".to_string(),
            })
            .expect("install")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable".to_string(),
            })
            .expect("enable")
            .plugin;

        let bad_candidate = tempdir().expect("bad candidate");
        copy_package(&hello_srt_source(), bad_candidate.path()).expect("copy candidate");
        let manifest_path = bad_candidate.path().join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(
            &std::fs::read(&manifest_path).expect("read candidate manifest"),
        )
        .expect("parse candidate manifest");
        manifest["version"] = json!("0.3.0");
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize candidate manifest"),
        )
        .expect("write candidate manifest");
        std::fs::write(
            bad_candidate.path().join("bin/hello-srt.mjs"),
            r#"import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "candidate rejected" } })}\n`);
  }
});
"#,
        )
        .expect("write rejecting candidate");

        let error = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: bad_candidate.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "bad upgrade".to_string(),
            })
            .expect_err("bad candidate must fail");
        assert_eq!(crate::rpc_error(error).code, ErrorCode::PluginUpgradeFailed);
        let current = service
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("active plugin remains");
        assert_eq!(current.active_version_id, enabled.active_version_id);
        assert_eq!(current.revision, enabled.revision);
        assert_eq!(current.status, WirePluginStatus::Enabled);
        assert!(service.filters.contains("example.hello-srt"));
        assert!(service.pending_plugin_processes.is_empty());
        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id,
                offset: 0,
                limit: 20,
            })
            .expect("failed candidate history");
        assert_eq!(history.total, 1);
    }

    #[test]
    fn process_upgrade_rejects_qa_and_pipeline_collisions_before_version_cas() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");

        let tier1 = service
            .install_plugin(PluginInstallParams {
                source_path: tier1_toolkit_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install collision owner".to_string(),
            })
            .expect("install Tier 1 owner")
            .plugin;
        grant_required_capabilities(&mut service, &tier1.id);
        service
            .enable_plugin(PluginMutationParams {
                plugin_id: tier1.id,
                expected_revision: Some(tier1.revision),
                actor: "test".to_string(),
                reason: "enable collision owner".to_string(),
            })
            .expect("enable Tier 1 owner");

        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: qa_pipeline_process_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install process plugin".to_string(),
            })
            .expect("install process plugin")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable process plugin".to_string(),
            })
            .expect("enable process plugin")
            .plugin;
        let active_version_id = enabled
            .active_version_id
            .clone()
            .expect("active process version");
        let active_process = service
            .plugin_processes
            .get(&enabled.id)
            .expect("active process");

        for (version, kind, collision_id, capability_id) in [
            ("2.0.0", "qaRule", "example.tier1.qa", "qa.register"),
            (
                "3.0.0",
                "pipelineStep",
                "example.tier1.normalize",
                "pipeline.register",
            ),
        ] {
            let candidate = tempdir().expect("candidate source");
            copy_package(&qa_pipeline_process_source(), candidate.path())
                .expect("copy process candidate");
            let manifest_path = candidate.path().join("manifest.json");
            let mut manifest: Value = serde_json::from_slice(
                &std::fs::read(&manifest_path).expect("read candidate manifest"),
            )
            .expect("parse candidate manifest");
            manifest["version"] = json!(version);
            let contribution = manifest["contributions"]
                .as_array_mut()
                .expect("candidate contributions")
                .iter_mut()
                .find(|item| item["kind"] == kind)
                .expect("candidate contribution");
            contribution["id"] = json!(collision_id);
            let capability = manifest["capabilities"]
                .as_array_mut()
                .expect("candidate capabilities")
                .iter_mut()
                .find(|item| item["capabilityId"] == capability_id)
                .expect("candidate capability");
            capability["contributionId"] = json!(collision_id);
            capability["scope"]["contributionIds"] = json!([collision_id]);
            std::fs::write(
                &manifest_path,
                serde_json::to_vec_pretty(&manifest).expect("serialize candidate manifest"),
            )
            .expect("write candidate manifest");

            let error = service
                .upgrade_plugin(PluginUpgradeParams {
                    plugin_id: enabled.id.clone(),
                    source_path: candidate.path().to_string_lossy().into_owned(),
                    expected_revision: enabled.revision,
                    actor: "test".to_string(),
                    reason: "collision preflight".to_string(),
                })
                .expect_err("foreign contribution collision must fail");
            assert!(matches!(error, EngineError::PluginConflict(_)));

            let current = service
                .get_plugin(PluginIdParams {
                    plugin_id: enabled.id.clone(),
                })
                .expect("active generation remains");
            assert_eq!(
                current.active_version_id.as_deref(),
                Some(active_version_id.as_str())
            );
            assert_eq!(current.revision, enabled.revision);
            assert!(Arc::ptr_eq(
                &active_process,
                &service
                    .plugin_processes
                    .get(&enabled.id)
                    .expect("same process remains")
            ));
            assert!(service.pending_plugin_processes.is_empty());
            assert!(
                service
                    .plugin_qa_registry
                    .contains("example.qa.brand-compliance")
            );
            assert!(
                service
                    .pipeline
                    .registry
                    .contains("example.pipeline.batch-normalize")
            );
        }
        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id,
                offset: 0,
                limit: 20,
            })
            .expect("process version history");
        assert_eq!(history.total, 1);
        let staging_root = service.store.paths().temporary.join("plugin-staging");
        assert!(
            !staging_root.exists()
                || std::fs::read_dir(staging_root)
                    .expect("read plugin staging directory")
                    .next()
                    .is_none()
        );
    }

    #[test]
    fn process_upgrade_preflights_pipeline_artifacts_and_stored_config() {
        let data = tempdir().expect("data directory");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: qa_pipeline_process_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install process plugin".to_string(),
            })
            .expect("install process plugin")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable process plugin".to_string(),
            })
            .expect("enable process plugin")
            .plugin;
        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "Pipeline compatibility".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "test".to_string(),
            })
            .expect("create project");
        service
            .create_pipeline(translunar_protocol::CreatePipelineParams {
                project_id: Some(project.id),
                name: "Stored plugin config".to_string(),
                steps: vec![translunar_pipeline::PipelineStepDefinition {
                    key: "plugin".to_string(),
                    step_id: "example.pipeline.batch-normalize".to_string(),
                    config: json!({ "batchSize": 10 }),
                }],
            })
            .expect("create stored plugin pipeline");
        let active_version_id = enabled
            .active_version_id
            .clone()
            .expect("active process version");

        for (version, mutation) in [("2.0.0", "artifact"), ("3.0.0", "config")] {
            let candidate = tempdir().expect("candidate source");
            copy_package(&qa_pipeline_process_source(), candidate.path())
                .expect("copy process candidate");
            let manifest_path = candidate.path().join("manifest.json");
            let mut manifest: Value = serde_json::from_slice(
                &std::fs::read(&manifest_path).expect("read candidate manifest"),
            )
            .expect("parse candidate manifest");
            manifest["version"] = json!(version);
            let descriptor = manifest["contributions"]
                .as_array_mut()
                .expect("candidate contributions")
                .iter_mut()
                .find(|item| item["kind"] == "pipelineStep")
                .expect("pipeline contribution");
            if mutation == "artifact" {
                descriptor["input"] = json!("segments");
            } else {
                descriptor["configSchema"]["fields"][0]["max"] = json!(5);
            }
            std::fs::write(
                &manifest_path,
                serde_json::to_vec_pretty(&manifest).expect("serialize candidate manifest"),
            )
            .expect("write candidate manifest");

            let error = service
                .upgrade_plugin(PluginUpgradeParams {
                    plugin_id: enabled.id.clone(),
                    source_path: candidate.path().to_string_lossy().into_owned(),
                    expected_revision: enabled.revision,
                    actor: "test".to_string(),
                    reason: "compatibility preflight".to_string(),
                })
                .expect_err("incompatible pipeline candidate must fail");
            assert!(matches!(error, EngineError::PluginConflict(_)));
            let current = service
                .get_plugin(PluginIdParams {
                    plugin_id: enabled.id.clone(),
                })
                .expect("active generation remains");
            assert_eq!(
                current.active_version_id.as_deref(),
                Some(active_version_id.as_str())
            );
            assert_eq!(current.revision, enabled.revision);
            assert!(service.pending_plugin_processes.is_empty());
        }
        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id,
                offset: 0,
                limit: 20,
            })
            .expect("process version history");
        assert_eq!(history.total, 1);
    }

    #[test]
    fn failed_candidate_attach_restores_previous_process_generation() {
        let data = tempdir().expect("data directory");
        let source_v1 = tempdir().expect("v1 source");
        copy_package(&hello_srt_source(), source_v1.path()).expect("copy v1 fixture");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: source_v1.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install v1".to_string(),
            })
            .expect("install v1")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable v1".to_string(),
            })
            .expect("enable v1")
            .plugin;
        let previous_version_id = enabled
            .active_version_id
            .clone()
            .expect("active v1 version");

        let source_v2 = tempdir().expect("v2 source");
        copy_package(&hello_srt_source(), source_v2.path()).expect("copy v2 fixture");
        let manifest_path = source_v2.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read v2 manifest"))
                .expect("parse v2 manifest");
        manifest["version"] = json!("0.2.0");
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize v2 manifest"),
        )
        .expect("write v2 manifest");

        FAIL_REGISTER_PLUGIN_FILTERS_ATTEMPTS.with(|attempts| attempts.set(1));
        let error = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: source_v2.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "exercise candidate attach compensation".to_string(),
            })
            .expect_err("candidate attach must fail");
        assert_eq!(crate::rpc_error(error).code, ErrorCode::PluginUpgradeFailed);

        let restored = service
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("previous installation restored");
        assert_eq!(restored.status, WirePluginStatus::Enabled);
        assert_eq!(
            restored.active_version_id.as_deref(),
            Some(previous_version_id.as_str())
        );
        assert!(service.filters.contains("example.hello-srt"));
        assert!(service.plugin_processes.contains_key(&enabled.id));
        assert!(service.pending_plugin_processes.is_empty());
        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id,
                offset: 0,
                limit: 20,
            })
            .expect("retained candidate history");
        assert_eq!(history.total, 2);
        assert!(history.items.iter().any(|item| {
            item.state == translunar_protocol::PluginVersionState::Failed
                && item
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.code == "plugin_upgrade_failed")
        }));
    }

    #[test]
    fn failed_version_switch_and_restoration_persist_degraded_without_authority() {
        let data = tempdir().expect("data directory");
        let source_v1 = tempdir().expect("v1 source");
        copy_package(&hello_srt_source(), source_v1.path()).expect("copy v1 fixture");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: source_v1.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install v1".to_string(),
            })
            .expect("install v1")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable v1".to_string(),
            })
            .expect("enable v1")
            .plugin;
        let previous_version_id = enabled
            .active_version_id
            .clone()
            .expect("active v1 version");

        let source_v2 = tempdir().expect("v2 source");
        copy_package(&hello_srt_source(), source_v2.path()).expect("copy v2 fixture");
        let manifest_path = source_v2.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read v2 manifest"))
                .expect("parse v2 manifest");
        manifest["version"] = json!("0.2.0");
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize v2 manifest"),
        )
        .expect("write v2 manifest");

        FAIL_REGISTER_PLUGIN_FILTERS_ATTEMPTS.with(|attempts| attempts.set(2));
        let error = service
            .upgrade_plugin(PluginUpgradeParams {
                plugin_id: enabled.id.clone(),
                source_path: source_v2.path().to_string_lossy().into_owned(),
                expected_revision: enabled.revision,
                actor: "test".to_string(),
                reason: "exercise failed restoration".to_string(),
            })
            .expect_err("candidate attach and restoration must fail");
        assert_eq!(crate::rpc_error(error).code, ErrorCode::PluginUpgradeFailed);

        let degraded = service
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("degraded installation remains");
        assert_eq!(degraded.status, WirePluginStatus::Degraded);
        assert_eq!(
            degraded.active_version_id.as_deref(),
            Some(previous_version_id.as_str())
        );
        assert!(degraded.last_error.as_deref().is_some_and(|message| {
            message.starts_with("plugin_restore_failed:") && message.len() <= 4 * 1024
        }));
        assert!(!service.filters.contains("example.hello-srt"));
        assert!(!service.plugin_processes.contains_key(&enabled.id));
        assert!(service.pending_plugin_processes.is_empty());

        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id.clone(),
                offset: 0,
                limit: 20,
            })
            .expect("version history remains");
        assert_eq!(history.total, 2);
        assert!(history.items.iter().any(|item| {
            item.state == translunar_protocol::PluginVersionState::Failed
                && item
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.code == "plugin_upgrade_failed")
        }));

        drop(service);
        let restarted = EngineService::open(data.path()).expect("restart engine");
        let persisted = restarted
            .get_plugin(PluginIdParams {
                plugin_id: enabled.id.clone(),
            })
            .expect("degraded state persists");
        assert_eq!(persisted.status, WirePluginStatus::Degraded);
        assert!(!restarted.filters.contains("example.hello-srt"));
        assert!(!restarted.plugin_processes.contains_key(&enabled.id));
    }

    #[test]
    fn capability_grants_are_revision_safe_durable_scoped_and_isolated() {
        use translunar_plugin_runtime::{
            PluginCapabilityCheck, PluginCapabilityDecision, PluginCapabilityDenialCode,
            PluginCapabilityId, PluginCapabilityScope, PluginFileArea,
        };

        let data = tempdir().expect("data directory");
        let other_package = tempdir().expect("second plugin package");
        copy_package(&hello_srt_source(), other_package.path()).expect("copy second fixture");
        for relative in ["manifest.json", "bin/hello-srt.mjs"] {
            let path = other_package.path().join(relative);
            let contents = std::fs::read_to_string(&path).expect("read second fixture file");
            std::fs::write(
                path,
                contents.replace("example.hello-srt", "example.other-srt"),
            )
            .expect("write second fixture identity");
        }

        let mut service = EngineService::open(data.path()).expect("open engine");
        let first = service
            .install_plugin(PluginInstallParams {
                source_path: hello_srt_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "legacy-client".to_string(),
                reason: "default deny proof".to_string(),
            })
            .expect("install first plugin")
            .plugin;
        let initial = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: first.id.clone(),
                    version_id: first.active_version_id.clone(),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list initial requests");
        assert_eq!(initial.total, 2);
        assert!(
            initial
                .items
                .iter()
                .all(|request| request.decision == PluginCapabilityDecision::Pending)
        );

        let read_request = initial
            .items
            .iter()
            .find(|request| request.capability_id == PluginCapabilityId::FileRead)
            .expect("file read request")
            .clone();
        service
            .grant_plugin_capability(translunar_protocol::PluginCapabilityGrantParams {
                plugin_id: first.id.clone(),
                request_id: read_request.id.clone(),
                expected_revision: read_request.revision,
                scope: read_request.requested_scope.clone(),
                actor: "reviewer".to_string(),
                reason: "allow source reads".to_string(),
            })
            .expect("grant read request");
        let stale = service
            .deny_plugin_capability(translunar_protocol::PluginCapabilityDecisionParams {
                plugin_id: first.id.clone(),
                request_id: read_request.id.clone(),
                expected_revision: read_request.revision,
                actor: "stale-reviewer".to_string(),
                reason: "stale decision".to_string(),
            })
            .expect_err("stale decision must conflict");
        assert!(matches!(
            stale,
            EngineError::Storage(translunar_storage::StorageError::EntityConflict { .. })
        ));
        grant_required_capabilities(&mut service, &first.id);
        let first = service
            .enable_plugin(PluginMutationParams {
                plugin_id: first.id.clone(),
                expected_revision: Some(first.revision),
                actor: "test".to_string(),
                reason: "enable first".to_string(),
            })
            .expect("enable first plugin")
            .plugin;

        let second = service
            .install_plugin(PluginInstallParams {
                source_path: other_package.path().to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".to_string(),
                reason: "install isolated plugin".to_string(),
            })
            .expect("install second plugin")
            .plugin;
        grant_required_capabilities(&mut service, &second.id);
        let second = service
            .enable_plugin(PluginMutationParams {
                plugin_id: second.id.clone(),
                expected_revision: Some(second.revision),
                actor: "test".to_string(),
                reason: "enable isolated plugin".to_string(),
            })
            .expect("enable second plugin")
            .plugin;

        let first_version = first
            .active_version_id
            .clone()
            .expect("first active version");
        let allowed_check = PluginCapabilityCheck {
            plugin_id: first.id.clone(),
            version_id: first_version.clone(),
            capability_id: PluginCapabilityId::FileRead,
            scope: PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Source],
            },
            operation: "fixture.read".to_string(),
            contribution_id: Some("example.hello-srt".to_string()),
        };
        service
            .plugin_capabilities
            .authorizer()
            .authorize(&allowed_check)
            .expect("granted operation");
        let mismatch = service
            .plugin_capabilities
            .authorizer()
            .authorize(&PluginCapabilityCheck {
                scope: PluginCapabilityScope::File {
                    areas: vec![PluginFileArea::Output],
                },
                operation: "fixture.out-of-scope".to_string(),
                ..allowed_check.clone()
            })
            .expect_err("out-of-scope operation must fail");
        assert_eq!(mismatch.code, PluginCapabilityDenialCode::ScopeMismatch);

        drop(service);
        let mut service = EngineService::open(data.path()).expect("restart engine");
        assert!(service.filters.contains("example.hello-srt"));
        assert!(service.filters.contains("example.other-srt"));
        let current_request = service
            .list_plugin_capability_requests(
                translunar_protocol::PluginCapabilityRequestListParams {
                    plugin_id: first.id.clone(),
                    version_id: Some(first_version.clone()),
                    offset: 0,
                    limit: 200,
                },
            )
            .expect("list durable grants")
            .items
            .into_iter()
            .find(|request| request.capability_id == PluginCapabilityId::FileRead)
            .expect("durable file read grant");
        assert_eq!(current_request.decision, PluginCapabilityDecision::Granted);
        let revoked = service
            .revoke_plugin_capability(translunar_protocol::PluginCapabilityDecisionParams {
                plugin_id: first.id.clone(),
                request_id: current_request.id,
                expected_revision: current_request.revision,
                actor: "reviewer".to_string(),
                reason: "revoke source reads".to_string(),
            })
            .expect("revoke active grant");
        assert!(revoked.detached);
        assert_eq!(revoked.plugin.status, WirePluginStatus::Disabled);
        assert!(!service.filters.contains("example.hello-srt"));
        assert!(service.filters.contains("example.other-srt"));
        assert_eq!(
            service
                .get_plugin(PluginIdParams {
                    plugin_id: second.id.clone(),
                })
                .expect("isolated plugin remains")
                .status,
            WirePluginStatus::Enabled
        );
        let revoked_denial = service
            .plugin_capabilities
            .authorizer()
            .authorize(&allowed_check)
            .expect_err("revoked operation must fail");
        assert_eq!(revoked_denial.code, PluginCapabilityDenialCode::Revoked);

        let audit = service
            .list_plugin_capability_audit(translunar_protocol::PluginCapabilityAuditListParams {
                plugin_id: first.id,
                request_id: None,
                offset: 0,
                limit: 200,
            })
            .expect("list immutable audit");
        assert!(
            audit
                .items
                .windows(2)
                .all(|window| window[0].sequence > window[1].sequence)
        );
        assert!(audit.items.iter().any(|entry| {
            entry.event == translunar_plugin_runtime::PluginCapabilityAuditEvent::OperationDenied
        }));
        assert!(audit.items.iter().any(|entry| {
            entry.event == translunar_plugin_runtime::PluginCapabilityAuditEvent::Detached
        }));
    }

    #[test]
    fn real_timeout_failure_is_typed_degraded_and_restart_safe() {
        let data = tempdir().expect("data directory");
        let package = tempdir().expect("plugin package");
        copy_package(&hello_srt_source(), package.path()).expect("copy fixture");
        std::fs::write(
            package.path().join("bin/hello-srt.mjs"),
            r#"import { createInterface } from "node:readline";
const descriptor = {
  id: "example.hello-srt",
  version: "0.1.0",
  displayName: "Hello SRT",
  extensions: ["srt"],
  capabilities: {
    import: true, export: true, validate: true,
    inlineTags: false, notes: false, degradationReport: true,
  },
};
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "filter.import") return;
  const result = request.method === "plugin.handshake"
    ? { apiVersion: 1, pluginId: "example.hello-srt", contributions: { filters: [descriptor] } }
    : {};
  if (request.id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
  }
});
"#,
        )
        .expect("write timeout fixture");
        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: package.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install".to_string(),
            })
            .expect("install plugin")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable".to_string(),
            })
            .expect("enable plugin")
            .plugin;

        service.unregister_plugin_filters(&enabled.id);
        let record = service
            .store
            .get_plugin_installation(&enabled.id)
            .expect("enabled record");
        let process = Arc::new(PluginProcess::new(
            record.package_path.clone(),
            record.manifest.clone(),
        ));
        process.ensure_started().expect("start timeout fixture");
        let descriptor = record
            .filter_descriptors()
            .into_iter()
            .next()
            .expect("filter descriptor");
        let filter = ProcessDocumentFilter::new(
            Arc::clone(&process),
            descriptor.clone(),
            record.granted_permissions.clone(),
            enabled.revision,
        )
        .with_call_timeouts(
            std::time::Duration::from_millis(100),
            std::time::Duration::from_millis(100),
        );
        let filter: Arc<dyn DocumentFilter> = Arc::new(filter);
        service
            .filters
            .register(Arc::clone(&filter))
            .expect("register timeout filter");
        service
            .plugin_filter_owners
            .insert(descriptor.id.clone(), enabled.id.clone());
        service.plugin_processes.insert(
            enabled.id.clone(),
            enabled
                .active_version_id
                .clone()
                .expect("active process version"),
            enabled.revision,
            vec![(descriptor.id.clone(), filter)],
            Vec::new(),
            process,
        );
        service
            .plugin_activation_revisions
            .insert(enabled.id.clone(), enabled.revision);

        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "Plugin timeout".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "test".to_string(),
            })
            .expect("create project");
        let source = data.path().join("timeout.srt");
        std::fs::write(&source, "1\n00:00:00,000 --> 00:00:01,000\nTimeout\n")
            .expect("write timeout source");
        let error = service
            .import_document(translunar_protocol::ImportDocumentParams {
                project_id: project.id,
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some(descriptor.id.clone()),
                options: Default::default(),
            })
            .expect_err("real plugin import must time out");
        let rpc = crate::rpc_error(error);
        assert_eq!(rpc.code, ErrorCode::PluginProcessFailed);
        assert_eq!(
            rpc.data,
            Some(json!({
                "pluginId": enabled.id.clone(),
                "filterId": "example.hello-srt",
                "operation": "filter.import",
                "failureKind": "timeout",
                "retryable": false,
            }))
        );
        let degraded = service
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("degraded plugin");
        assert_eq!(degraded.status, WirePluginStatus::Degraded);
        assert_eq!(degraded.crash_count, 1);
        assert!(
            degraded.last_error.as_deref().is_some_and(|error| {
                error.contains("filter.import") && error.contains("timeout")
            })
        );
        assert!(!service.filters.contains("example.hello-srt"));
        assert!(!service.plugin_processes.contains_key(&installed.id));
        assert_eq!(
            service
                .list_plugins(PluginListParams {
                    offset: 0,
                    limit: 20,
                })
                .expect("ordinary Engine request remains responsive")
                .total,
            1
        );
        drop(service);

        let restarted = EngineService::open(data.path()).expect("restart engine");
        let persisted = restarted
            .get_plugin(PluginIdParams {
                plugin_id: installed.id.clone(),
            })
            .expect("persisted degraded plugin");
        assert_eq!(persisted.status, WirePluginStatus::Degraded);
        assert_eq!(persisted.crash_count, 1);
        assert!(!restarted.filters.contains("example.hello-srt"));
        assert!(!restarted.plugin_processes.contains_key(&installed.id));
    }

    #[test]
    fn fatal_process_pipeline_failure_detaches_exact_generation_contributions() {
        let data = tempdir().expect("data directory");
        let combined = tempdir().expect("combined plugin source");
        copy_package(&tier1_toolkit_source(), combined.path()).expect("copy Tier 1 package");
        let manifest_path = combined.path().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).expect("read Tier 1 manifest"))
                .expect("parse Tier 1 manifest");
        let connector_manifest: Value = serde_json::from_slice(
            &std::fs::read(declarative_connector_source().join("manifest.json"))
                .expect("read connector manifest"),
        )
        .expect("parse connector manifest");
        manifest["contributions"]
            .as_array_mut()
            .expect("Tier 1 contributions")
            .push(
                connector_manifest["contributions"]
                    .as_array()
                    .expect("connector contributions")[0]
                    .clone(),
            );
        manifest["capabilities"]
            .as_array_mut()
            .expect("Tier 1 capabilities")
            .extend(
                connector_manifest["capabilities"]
                    .as_array()
                    .expect("connector capabilities")
                    .iter()
                    .cloned(),
            );
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize combined manifest"),
        )
        .expect("write combined manifest");

        let mut service = EngineService::open(data.path()).expect("open engine");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: combined.path().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install full contribution generation".to_string(),
            })
            .expect("install combined plugin")
            .plugin;
        grant_required_capabilities(&mut service, &installed.id);
        let enabled = service
            .enable_plugin(PluginMutationParams {
                plugin_id: installed.id.clone(),
                expected_revision: Some(installed.revision),
                actor: "test".to_string(),
                reason: "enable full contribution generation".to_string(),
            })
            .expect("enable combined plugin")
            .plugin;
        let version_id = enabled
            .active_version_id
            .clone()
            .expect("active combined version");
        assert!(service.filters.contains("example.tier1.lines"));
        assert!(service.plugin_qa_registry.contains("example.tier1.qa"));
        assert!(
            service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(
            service
                .ai
                .connectors
                .lookup("example.connector-openai-compatible.chat")
                .expect("connector lookup")
                .is_some()
        );

        let (process_manifest, _) =
            inspect_plugin_package(&hello_srt_source()).expect("inspect process fixture package");
        let process = Arc::new(
            PluginProcess::from_normalized_manifest(hello_srt_source(), &process_manifest)
                .expect("prepare process fixture"),
        );
        process.ensure_started().expect("start process fixture");
        let registered_filter = service
            .filters
            .resolve("example.tier1.lines")
            .expect("resolve registered process filter");
        service.plugin_processes.insert(
            enabled.id.clone(),
            version_id,
            enabled.revision,
            vec![("example.tier1.lines".to_string(), registered_filter)],
            service
                .ai
                .connectors
                .snapshot()
                .expect("connector snapshot")
                .into_iter()
                .filter(|lease| {
                    lease
                        .descriptor
                        .source
                        .plugin_owner()
                        .is_some_and(|owner| owner.plugin_id == enabled.id)
                })
                .collect(),
            process,
        );

        let other = service
            .install_plugin(PluginInstallParams {
                source_path: hello_srt_source().to_string_lossy().into_owned(),
                grant_requested: true,
                actor: "test".to_string(),
                reason: "install unrelated generation".to_string(),
            })
            .expect("install unrelated plugin")
            .plugin;
        grant_required_capabilities(&mut service, &other.id);
        let other = service
            .enable_plugin(PluginMutationParams {
                plugin_id: other.id,
                expected_revision: Some(other.revision),
                actor: "test".to_string(),
                reason: "enable unrelated generation".to_string(),
            })
            .expect("enable unrelated plugin")
            .plugin;

        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "Fatal plugin pipeline".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "test".to_string(),
            })
            .expect("create project");
        let definition = service
            .create_pipeline(translunar_protocol::CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "Fatal contribution generation".to_string(),
                steps: vec![translunar_pipeline::PipelineStepDefinition {
                    key: "plugin".to_string(),
                    step_id: "example.tier1.normalize".to_string(),
                    config: Value::Null,
                }],
            })
            .expect("create plugin pipeline");
        let resolved = service
            .pipeline
            .resolve_new_run(&definition)
            .expect("resolve plugin pipeline");
        let snapshot = service
            .store
            .create_pipeline_run_with_bindings(
                &definition.id,
                &project.id,
                None,
                json!({ "schemaVersion": 1 }),
                &resolved.plugin_bindings,
            )
            .expect("create pinned plugin run");
        let step_run = snapshot.steps[0].clone();
        service.pipeline.clone().degrade_failed_plugin_generation(
            &mut service.store,
            &step_run,
            &translunar_pipeline::PipelineFailure {
                code: "plugin_host_crash".to_string(),
                message: "plugin pipeline step failed".to_string(),
                retryable: true,
            },
        );

        assert_eq!(
            service
                .get_plugin(PluginIdParams {
                    plugin_id: enabled.id.clone(),
                })
                .expect("degraded plugin state")
                .status,
            WirePluginStatus::Degraded
        );
        assert!(!service.filters.contains("example.tier1.lines"));
        assert!(!service.plugin_qa_registry.contains("example.tier1.qa"));
        assert!(
            !service
                .pipeline
                .registry
                .contains("example.tier1.normalize")
        );
        assert!(
            service
                .ai
                .connectors
                .lookup("example.connector-openai-compatible.chat")
                .expect("detached connector lookup")
                .is_none()
        );
        assert!(!service.plugin_processes.contains_key(&enabled.id));

        assert!(service.filters.contains("example.hello-srt"));
        assert!(service.plugin_processes.contains_key(&other.id));
        assert!(service.pipeline.registry.contains("core.checkpoint"));
    }
}
