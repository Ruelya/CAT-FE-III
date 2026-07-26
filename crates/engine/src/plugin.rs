use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use translunar_filter_core::{FilterError, FilterRegistry};
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

    pub fn install_plugin(&mut self, params: PluginInstallParams) -> Result<PluginMutationResult> {
        let source = PathBuf::from(params.source_path.trim());
        if !source.is_dir() {
            return Err(EngineError::InvalidRequest(
                "plugin sourcePath must be an existing directory".to_string(),
            ));
        }
        let manifest = load_manifest(&source).map_err(map_plugin_error)?;
        match self.store.get_plugin_installation(&manifest.id) {
            Ok(_) => {
                return Err(EngineError::InvalidState(format!(
                    "plugin {} is already installed",
                    manifest.id
                )));
            }
            Err(translunar_storage::StorageError::NotFound { .. }) => {}
            Err(error) => return Err(error.into()),
        }
        let destination = self.store.paths().plugins.join(&manifest.id);
        if destination.exists() {
            // A stale package directory can remain after an interrupted first
            // install. Installed ids have already failed closed above.
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
        let package_path = record.package_path.clone();
        let summary = to_summary(record);
        self.store.delete_plugin_installation(&params.plugin_id)?;
        remove_package(&package_path).map_err(map_plugin_error)?;
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
            record.package_path.clone(),
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
    inlineTags: false, notes: true, degradationReport: false,
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
