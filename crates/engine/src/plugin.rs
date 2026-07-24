use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use translunar_filter_core::FilterRegistry;
use translunar_plugin_runtime::{
    PluginProcess, ProcessDocumentFilter, copy_package, load_manifest, remove_package,
};
use translunar_protocol::{
    PluginIdParams, PluginInstallParams, PluginListParams, PluginMutationParams,
    PluginMutationResult, PluginPage, PluginStatus as WirePluginStatus, PluginSummary,
    PluginTier as WirePluginTier,
};
use translunar_storage::{PluginInstallationRecord, PluginStatus, Store, UpsertPluginInstallation};

use crate::{EngineError, EngineService, Result};

impl EngineService {
    pub(crate) fn reload_enabled_plugins(&mut self) -> Result<()> {
        let enabled = self.store.list_enabled_plugins()?;
        for record in enabled {
            if let Err(error) = self.register_plugin_filters(&record) {
                let message = error.to_string();
                let _ = self.store.record_plugin_crash(&record.id, message);
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

    pub fn install_plugin(&mut self, params: PluginInstallParams) -> Result<PluginMutationResult> {
        let source = PathBuf::from(params.source_path.trim());
        if !source.is_dir() {
            return Err(EngineError::InvalidRequest(
                "plugin sourcePath must be an existing directory".to_string(),
            ));
        }
        let manifest = load_manifest(&source).map_err(map_plugin_error)?;
        let destination = self.store.paths().plugins.join(&manifest.id);
        if destination.exists() {
            // Reinstall replaces the managed package copy.
            remove_package(&destination).map_err(map_plugin_error)?;
        }
        copy_package(&source, &destination).map_err(map_plugin_error)?;
        // Re-validate from the managed copy so missing entry files fail before persistence.
        let manifest = load_manifest(&destination).map_err(map_plugin_error)?;
        let granted = if params.grant_requested {
            manifest.permissions.clone()
        } else {
            Vec::new()
        };
        let record = self
            .store
            .upsert_plugin_installation(UpsertPluginInstallation {
                manifest,
                package_path: destination,
                status: PluginStatus::Installed,
                granted_permissions: granted,
                last_error: None,
            })?;
        let _ = (&params.actor, &params.reason);
        Ok(PluginMutationResult {
            plugin: to_summary(record),
        })
    }

    pub fn enable_plugin(&mut self, params: PluginMutationParams) -> Result<PluginMutationResult> {
        let record = self.store.get_plugin_installation(&params.plugin_id)?;
        if record.granted_permissions.is_empty() && !record.requested_permissions.is_empty() {
            return Err(EngineError::PluginPermissionDenied(
                "enable requires granted permissions; reinstall with grantRequested".to_string(),
            ));
        }
        for permission in &record.requested_permissions {
            if !record
                .granted_permissions
                .iter()
                .any(|item| item == permission)
            {
                return Err(EngineError::PluginPermissionDenied(format!(
                    "missing granted permission {permission}"
                )));
            }
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
        match self.register_plugin_filters(&record) {
            Ok(()) => {
                let updated = self.store.set_plugin_status(
                    &params.plugin_id,
                    PluginStatus::Enabled,
                    params.expected_revision,
                    None,
                )?;
                let _ = (&params.actor, &params.reason);
                Ok(PluginMutationResult {
                    plugin: to_summary(updated),
                })
            }
            Err(error) => {
                let message = error.to_string();
                let _ = self
                    .store
                    .record_plugin_crash(&params.plugin_id, message.clone());
                self.unregister_plugin_filters(&params.plugin_id);
                Err(error)
            }
        }
    }

    pub fn disable_plugin(&mut self, params: PluginMutationParams) -> Result<PluginMutationResult> {
        self.unregister_plugin_filters(&params.plugin_id);
        let updated = self.store.set_plugin_status(
            &params.plugin_id,
            PluginStatus::Disabled,
            params.expected_revision,
            None,
        )?;
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
        let package_path = record.package_path.clone();
        let summary = to_summary(record);
        self.store.delete_plugin_installation(&params.plugin_id)?;
        remove_package(&package_path).map_err(map_plugin_error)?;
        let _ = (&params.actor, &params.reason);
        Ok(PluginMutationResult { plugin: summary })
    }

    fn register_plugin_filters(&mut self, record: &PluginInstallationRecord) -> Result<()> {
        let process = Arc::new(PluginProcess::new(
            record.package_path.clone(),
            record.manifest.clone(),
        ));
        process.ensure_started().map_err(map_plugin_error)?;
        for descriptor in record.filter_descriptors() {
            if self.filters.contains(&descriptor.id) {
                let owner = self.plugin_filter_owners.get(&descriptor.id).cloned();
                if owner.as_deref() == Some(record.id.as_str()) {
                    let _ = self.filters.unregister(&descriptor.id);
                } else {
                    return Err(EngineError::InvalidState(format!(
                        "filter id {} is already registered",
                        descriptor.id
                    )));
                }
            }
            let filter = ProcessDocumentFilter::new(
                Arc::clone(&process),
                descriptor.clone(),
                record.granted_permissions.clone(),
            );
            self.filters
                .register(Arc::new(filter))
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
            self.plugin_filter_owners
                .insert(descriptor.id.clone(), record.id.clone());
        }
        self.plugin_processes.insert(record.id.clone(), process);
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
    }
}

fn to_summary(record: PluginInstallationRecord) -> PluginSummary {
    PluginSummary {
        id: record.id,
        display_name: record.display_name,
        version: record.version,
        tier: match record.tier {
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
        last_error: record.last_error,
        crash_count: record.crash_count,
        installed_at_ms: record.installed_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
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
        PluginRuntimeError::Process(message) | PluginRuntimeError::Protocol(message) => {
            EngineError::PluginProcessFailed(message)
        }
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
