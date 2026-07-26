use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};
use translunar_filter_core::{FilterError, FilterRegistry};
use translunar_plugin_runtime::{
    NormalizedPluginManifest as RuntimeNormalizedPluginManifest, PluginContributions, PluginEntry,
    PluginEntryKind, PluginFilterContribution, PluginManifest, PluginProcess,
    ProcessDocumentFilter, StagedPluginPackage, inspect_plugin_package, publish_staged_package,
    remove_package, stage_plugin_package,
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
use translunar_storage::{
    NewPluginVersion, PluginInstallationRecord, PluginStatus, PluginVersionRecord,
    PluginVersionState, Store, UpsertNormalizedPluginInstallation,
};
use uuid::Uuid;

use crate::{EngineError, EngineService, Result};

impl EngineService {
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
                let message = error.to_string();
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

        let legacy_manifest = if compatibility.compatible {
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

        ensure_plugin_grants(&current)?;
        ensure_candidate_filter_slots(self, &params.plugin_id, &staged.normalized_manifest)?;
        let candidate_process = Arc::new(PluginProcess::new(
            staged.path.clone(),
            legacy_manifest.clone(),
        ));
        if let Err(error) = candidate_process.ensure_started() {
            let message = error.to_string();
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
            input.diagnostics_json = json!([{
                "code": "plugin_upgrade_failed",
                "message": bounded_plugin_message(&message),
                "phase": "probe"
            }]);
            if publish_staged_package(&staged.path, &candidate_destination).is_ok() {
                if let Err(insert_error) = self.store.insert_plugin_version(input) {
                    let _ = remove_package(&candidate_destination);
                    tracing::warn!(error = %insert_error, "failed to retain plugin probe candidate");
                }
            } else {
                cleanup_staged(&staged);
            }
            return Err(EngineError::PluginUpgradeFailed(message));
        }
        candidate_process.stop();
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
        let target_status = current.status;
        let activation = match self.store.cas_activate_plugin_version(
            &params.plugin_id,
            params.expected_revision,
            input,
            target_status,
        ) {
            Ok(value) => value,
            Err(error) => {
                let _ = remove_package(&candidate_destination);
                return Err(error.into());
            }
        };
        self.unregister_plugin_filters(&params.plugin_id);
        if activation.installation.status == PluginStatus::Enabled
            && let Err(error) = self.register_plugin_filters(&activation.installation)
        {
            let message = error.to_string();
            self.compensate_failed_upgrade(&params.plugin_id, &activation, &message);
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
        let _current = self.store.get_plugin_installation(&params.plugin_id)?;
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
        let legacy_manifest = normalized
            .to_legacy_process_manifest()
            .map_err(map_plugin_error)?;
        let process = Arc::new(PluginProcess::new(package_path.clone(), legacy_manifest));
        process.ensure_started().map_err(|error| {
            EngineError::PluginUpgradeFailed(format!("rollback probe failed: {error}"))
        })?;
        process.stop();
        let activation = self.store.rollback_plugin_version(
            &params.plugin_id,
            params.expected_revision,
            &params.version_id,
        )?;
        self.unregister_plugin_filters(&params.plugin_id);
        if activation.installation.status == PluginStatus::Enabled {
            self.register_plugin_filters(&activation.installation)
                .map_err(|error| EngineError::PluginUpgradeFailed(error.to_string()))?;
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
        let granted = if params.grant_requested {
            normalized.requested_permissions.clone()
        } else {
            Vec::new()
        };
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
                granted_permissions: granted,
                status: PluginStatus::Installed,
                last_error: None,
                source_manifest_version: normalized.source_manifest_version,
            })
            .inspect_err(|_| {
                let _ = remove_package(&destination);
            })?;
        let _ = (&params.actor, &params.reason);
        Ok(PluginMutationResult {
            plugin: to_summary(record),
        })
    }

    pub fn enable_plugin(&mut self, params: PluginMutationParams) -> Result<PluginMutationResult> {
        let record = self.store.get_plugin_installation(&params.plugin_id)?;
        ensure_plugin_grants(&record)?;
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
                    return Err(EngineError::InvalidState(format!(
                        "filter id {} is already registered",
                        filter.id
                    )));
                }
            }
        }
        let updated = self.store.set_plugin_status(
            &params.plugin_id,
            PluginStatus::Enabled,
            params.expected_revision,
            None,
        )?;
        self.unregister_plugin_filters(&params.plugin_id);
        match self.register_plugin_filters(&updated) {
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
                    message.clone(),
                );
                self.unregister_plugin_filters(&params.plugin_id);
                Err(error)
            }
        }
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
        self.unregister_plugin_filters(&params.plugin_id);
        let package_roots = collect_plugin_package_roots(&self.store, &params.plugin_id, &record)?;
        let summary = to_summary(record);
        let quarantine_root = self.store.paths().temporary.join("plugin-quarantine");
        std::fs::create_dir_all(&quarantine_root)?;
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

    fn register_plugin_filters(&mut self, record: &PluginInstallationRecord) -> Result<()> {
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
        let process = Arc::new(PluginProcess::new(
            resolve_managed_path(self.store.paths().root.as_path(), &record.package_path),
            record.manifest.clone(),
        ));
        process.ensure_started().map_err(map_plugin_error)?;
        let mut registered: Vec<String> = Vec::new();
        for descriptor in descriptors {
            let filter = ProcessDocumentFilter::new(
                Arc::clone(&process),
                descriptor.clone(),
                record.granted_permissions.clone(),
                record.revision,
            );
            if let Err(error) = self.filters.register(Arc::new(filter)) {
                for filter_id in &registered {
                    let _ = self.filters.unregister(filter_id);
                    self.plugin_filter_owners.remove(filter_id);
                }
                process.stop();
                return Err(EngineError::InvalidState(error.to_string()));
            }
            self.plugin_filter_owners
                .insert(descriptor.id.clone(), record.id.clone());
            registered.push(descriptor.id);
        }
        self.plugin_processes.insert(record.id.clone(), process);
        self.plugin_activation_revisions
            .insert(record.id.clone(), record.revision);
        Ok(())
    }

    fn unregister_plugin_filters(&mut self, plugin_id: &str) {
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
        if let Some(process) = self.plugin_processes.remove(plugin_id) {
            process.stop();
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

    fn compensate_failed_upgrade(
        &mut self,
        plugin_id: &str,
        activation: &translunar_storage::PluginActivationResult,
        message: &str,
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
                }
                if let Err(error) = self.store.mark_plugin_version_failed(
                    plugin_id,
                    activation.active_version.id.as_str(),
                    json!([{
                        "code": "plugin_upgrade_failed",
                        "message": bounded_plugin_message(message),
                        "phase": "attach"
                    }]),
                ) {
                    tracing::warn!(plugin_id, error = %error, "failed to retain attach-failed candidate");
                }
            }
            Err(error) => {
                tracing::error!(plugin_id, error = %error, "failed to compensate plugin upgrade");
            }
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
                format!(
                    "{operation} for {filter_id} failed ({}): {message}",
                    kind.as_str()
                ),
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

fn ensure_candidate_filter_slots(
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
    Ok(())
}

fn bounded_plugin_message(message: &str) -> String {
    message.chars().take(512).collect()
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

fn ensure_plugin_grants(record: &PluginInstallationRecord) -> Result<()> {
    for permission in &record.requested_permissions {
        if !record
            .granted_permissions
            .iter()
            .any(|granted| granted == permission)
        {
            return Err(EngineError::PluginPermissionDenied(format!(
                "missing granted permission {permission}"
            )));
        }
    }
    Ok(())
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
    current: &PluginInstallationRecord,
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
        granted_permissions: current.granted_permissions.clone(),
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

fn to_summary(record: PluginInstallationRecord) -> PluginSummary {
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
    use translunar_protocol::ErrorCode;

    fn hello_srt_source() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("examples/plugins/hello-srt")
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
        let process_before = Arc::clone(
            service
                .plugin_processes
                .get(&enabled.id)
                .expect("enabled process"),
        );

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
            service
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
                grant_requested: false,
                actor: "test".to_string(),
                reason: "permission rejection".to_string(),
            })
            .expect("install without grants")
            .plugin;
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
                "definition": { "pattern": "x" }
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
            translunar_protocol::PluginContributionDescriptor::QaRule { .. }
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
    fn failed_upgrade_candidate_is_retained_without_clobbering_active_plugin() {
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
        assert!(service.filters.contains("example.hello-srt"));
        let history = service
            .list_plugin_versions(PluginVersionListParams {
                plugin_id: enabled.id,
                offset: 0,
                limit: 20,
            })
            .expect("failed candidate history");
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
        service
            .filters
            .register(Arc::new(filter))
            .expect("register timeout filter");
        service
            .plugin_filter_owners
            .insert(descriptor.id.clone(), enabled.id.clone());
        service.plugin_processes.insert(enabled.id.clone(), process);
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
}
