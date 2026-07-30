use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use translunar_filter_core::FilterDescriptor;
use translunar_plugin_runtime::{
    PluginContributions, PluginDistributionMetadata, PluginEntry, PluginManifest,
    PluginPackageSourceKind, PluginTier, hash_plugin_package, load_normalized_manifest,
};

use super::{
    Store, conversion_error, now_ms, read_json, read_u64, require_nonempty, to_i64, to_u32,
};
use crate::{Result, StorageError};

const MAX_PAGE_SIZE: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginStatus {
    Installed,
    Enabled,
    Disabled,
    Degraded,
}

impl PluginStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Installed => "installed",
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
            Self::Degraded => "degraded",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "installed" => Ok(Self::Installed),
            "enabled" => Ok(Self::Enabled),
            "disabled" => Ok(Self::Disabled),
            "degraded" => Ok(Self::Degraded),
            other => Err(StorageError::InvalidData(format!(
                "unknown plugin status {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PluginInstallationRecord {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub tier: PluginTier,
    pub status: PluginStatus,
    pub package_path: PathBuf,
    pub entry: PluginEntry,
    pub manifest: PluginManifest,
    pub contributions: PluginContributions,
    pub requested_permissions: Vec<String>,
    pub granted_permissions: Vec<String>,
    pub last_error: Option<String>,
    pub crash_count: u32,
    pub revision: u64,
    pub installed_at_ms: i64,
    pub updated_at_ms: i64,
    /// Immutable version currently projected into the legacy installation row.
    pub active_version_id: Option<String>,
    pub package_sha256: Option<String>,
    pub runtime_json: Value,
    pub normalized_manifest_json: Value,
    pub compatibility_json: Value,
    pub diagnostics_json: Value,
    /// Host-derived provenance mirrored from the active version.
    pub source_kind: PluginPackageSourceKind,
    pub distribution: Option<PluginDistributionMetadata>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginAiActionInvocationStatus {
    Succeeded,
    Failed,
    Cancelled,
    Timeout,
    StaleActivation,
}

impl PluginAiActionInvocationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::StaleActivation => "stale_activation",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "timeout" => Ok(Self::Timeout),
            "stale_activation" => Ok(Self::StaleActivation),
            other => Err(StorageError::InvalidData(format!(
                "unknown AI action invocation status {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionUsageRecord {
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewPluginAiActionInvocation<'a> {
    pub id: &'a str,
    pub plugin_id: &'a str,
    pub version_id: &'a str,
    pub activation_revision: u64,
    pub contribution_id: &'a str,
    pub contribution_version: &'a str,
    pub status: PluginAiActionInvocationStatus,
    pub failure_code: Option<&'a str>,
    pub canonical_sha256: Option<&'a str>,
    pub usage: PluginAiActionUsageRecord,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginAiActionInvocationRecord {
    pub id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contribution_id: String,
    pub contribution_version: String,
    pub status: PluginAiActionInvocationStatus,
    pub failure_code: Option<String>,
    pub canonical_sha256: Option<String>,
    pub usage: PluginAiActionUsageRecord,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginAiActionInvocationPage {
    pub items: Vec<PluginAiActionInvocationRecord>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

impl PluginInstallationRecord {
    pub fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        self.manifest.filter_descriptors()
    }
}

#[derive(Debug, Clone)]
pub struct UpsertPluginInstallation {
    pub manifest: PluginManifest,
    pub package_path: PathBuf,
    pub status: PluginStatus,
    pub granted_permissions: Vec<String>,
    pub last_error: Option<String>,
}

/// Installation projection for a manifest that is valid but not executable
/// by the currently shipped host/adapter set.  The legacy-shaped fields keep
/// the v16 wire projection decodable while the normalized/version JSON retains
/// the complete tier-neutral inventory.
#[derive(Debug, Clone)]
pub struct UpsertNormalizedPluginInstallation {
    pub manifest: PluginManifest,
    pub original_manifest_json: Value,
    pub normalized_manifest_json: Value,
    pub runtime_json: Value,
    pub contributions_json: Value,
    pub compatibility_json: Value,
    pub diagnostics_json: Value,
    pub package_sha256: Option<String>,
    pub package_path: PathBuf,
    pub granted_permissions: Vec<String>,
    pub status: PluginStatus,
    pub last_error: Option<String>,
    pub source_manifest_version: u32,
    pub source_kind: PluginPackageSourceKind,
    pub distribution: Option<PluginDistributionMetadata>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginVersionState {
    Validated,
    Failed,
}

impl PluginVersionState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Validated => "validated",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "validated" => Ok(Self::Validated),
            "failed" => Ok(Self::Failed),
            other => Err(StorageError::InvalidData(format!(
                "unknown plugin version state {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PluginVersionRecord {
    pub id: String,
    pub plugin_id: String,
    pub version: String,
    pub package_sha256: Option<String>,
    pub package_path: PathBuf,
    pub managed_package_path: Option<PathBuf>,
    pub manifest_version: u32,
    pub original_manifest_json: Value,
    pub runtime_json: Value,
    pub normalized_manifest_json: Value,
    pub contributions_json: Value,
    pub compatibility_json: Value,
    pub diagnostics_json: Value,
    pub state: PluginVersionState,
    pub installed_at_ms: i64,
    pub activated_at_ms: Option<i64>,
    pub deactivated_at_ms: Option<i64>,
    pub failed_at_ms: Option<i64>,
    pub source_kind: PluginPackageSourceKind,
    pub distribution: Option<PluginDistributionMetadata>,
}

/// Complete immutable version payload.  The installation projection fields are
/// kept here so a CAS activation can update legacy v16 columns atomically with
/// the new version pointer.
#[derive(Debug, Clone)]
pub struct NewPluginVersion {
    pub id: String,
    pub plugin_id: String,
    pub display_name: String,
    pub version: String,
    pub tier: PluginTier,
    pub entry_json: Value,
    pub original_manifest_json: Value,
    pub requested_permissions: Vec<String>,
    pub granted_permissions: Vec<String>,
    pub package_sha256: Option<String>,
    pub package_path: PathBuf,
    pub managed_package_path: Option<PathBuf>,
    pub manifest_version: u32,
    pub runtime_json: Value,
    pub normalized_manifest_json: Value,
    pub contributions_json: Value,
    pub compatibility_json: Value,
    pub diagnostics_json: Value,
    pub state: PluginVersionState,
    pub installed_at_ms: i64,
    pub source_kind: PluginPackageSourceKind,
    pub distribution: Option<PluginDistributionMetadata>,
}

#[derive(Debug, Clone)]
pub struct PluginActivationResult {
    pub installation: PluginInstallationRecord,
    pub active_version: PluginVersionRecord,
    pub previous_version_id: Option<String>,
}

const INSTALLATION_COLUMNS: &str = "id, display_name, version, tier, status, package_path,
    entry_json, manifest_json, contributions_json, requested_permissions_json,
    granted_permissions_json, last_error, crash_count, revision,
    installed_at_ms, updated_at_ms, active_version_id, package_sha256,
    runtime_json, normalized_manifest_json, compatibility_json, diagnostics_json,
    source_kind, distribution_json";

const VERSION_COLUMNS: &str = "id, plugin_id, version, package_sha256, package_path,
    managed_package_path, manifest_version, original_manifest_json, runtime_json,
    normalized_manifest_json, contributions_json, compatibility_json,
    diagnostics_json, state, installed_at_ms, activated_at_ms,
    deactivated_at_ms, failed_at_ms, source_kind, distribution_json";

const MAX_PLUGIN_DIAGNOSTICS_BYTES: usize = 16 * 1024;
const MAX_PLUGIN_DIAGNOSTIC_COUNT: usize = 128;

/// Complete the SQL-only migration with filesystem-derived projections.  The
/// pass intentionally never changes legacy lifecycle fields or revisions.  It
/// is safe to run on every open: each row is rechecked in an Immediate
/// transaction and an already matching digest becomes a no-op.
pub(super) fn normalize_plugin_versions(
    connection: &mut rusqlite::Connection,
    paths: &super::DataPaths,
) -> Result<()> {
    let mut statement = connection.prepare(
        "SELECT id, revision, package_path, manifest_json, active_version_id
         FROM plugin_installations ORDER BY id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);

    for (plugin_id, revision, package_path, manifest_json, active_version_id) in rows {
        let Some(active_version_id) = active_version_id else {
            continue;
        };
        let package_path_buf = PathBuf::from(&package_path);
        let package_dir = if package_path_buf.is_absolute() {
            package_path_buf
        } else {
            paths.root.join(package_path_buf)
        };
        let projection = if package_dir.is_dir() {
            match normalize_package_directory(&package_dir) {
                Ok(value) => value,
                Err(error) => NormalizedPackageProjection::missing_with_manifest(
                    &manifest_json,
                    "package_invalid",
                    &bounded_error_message(error),
                ),
            }
        } else {
            NormalizedPackageProjection::missing_with_manifest(
                &manifest_json,
                "package_missing",
                "managed plugin package is missing",
            )
        };

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Re-check the complete identity before writing projections.  A
        // concurrent upgrade wins; this normalization pass simply retries on
        // the next Store::open rather than clobbering it.
        let unchanged = transaction
            .query_row(
                "SELECT revision, package_path, manifest_json, active_version_id
                 FROM plugin_installations WHERE id = ?1",
                [&plugin_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((current_revision, current_path, current_manifest, current_active)) = unchanged
        else {
            transaction.rollback()?;
            continue;
        };
        if current_revision != revision
            || current_path != package_path
            || current_manifest != manifest_json
            || current_active.as_deref() != Some(active_version_id.as_str())
        {
            transaction.rollback()?;
            continue;
        }

        let existing_hash: Option<String> = transaction
            .query_row(
                "SELECT package_sha256 FROM plugin_versions
                 WHERE plugin_id = ?1 AND id = ?2",
                params![plugin_id, active_version_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        let hash_changed = existing_hash.is_some()
            && projection.package_sha256.is_some()
            && existing_hash != projection.package_sha256;
        if hash_changed {
            // The version is immutable once a digest has been published.  A
            // changed managed directory is retained as a diagnostic instead of
            // replacing the authoritative bytes/history.
            let diagnostic = json!([{
                "code": "package_hash_changed",
                "message": "managed plugin package bytes differ from its immutable version"
            }]);
            transaction.execute(
                "UPDATE plugin_versions
                 SET compatibility_json = ?3, diagnostics_json = ?4
                 WHERE plugin_id = ?1 AND id = ?2",
                params![
                    plugin_id,
                    active_version_id,
                    json!({"compatible": false, "reason": "package_hash_changed"}).to_string(),
                    diagnostic.to_string(),
                ],
            )?;
            transaction.execute(
                "UPDATE plugin_installations
                 SET compatibility_json = ?2, diagnostics_json = ?3
                 WHERE id = ?1 AND revision = ?4 AND manifest_json = ?5",
                params![
                    plugin_id,
                    json!({"compatible": false, "reason": "package_hash_changed"}).to_string(),
                    diagnostic.to_string(),
                    revision,
                    manifest_json,
                ],
            )?;
            transaction.commit()?;
            continue;
        }

        // A published version is immutable.  Once its digest and projections
        // have been filled, reopening the workspace must be a true no-op
        // rather than attempting to rewrite equivalent JSON with a different
        // serialization order (which the SQLite immutability trigger rejects).
        if existing_hash.is_some()
            && (existing_hash == projection.package_sha256 || projection.package_sha256.is_none())
        {
            transaction.execute(
                "UPDATE plugin_versions SET
                    compatibility_json = ?3, diagnostics_json = ?4
                 WHERE plugin_id = ?1 AND id = ?2",
                params![
                    plugin_id,
                    active_version_id,
                    projection.compatibility.to_string(),
                    projection.diagnostics.to_string(),
                ],
            )?;
            transaction.execute(
                "UPDATE plugin_installations SET
                    package_sha256 = COALESCE(package_sha256, ?2),
                    compatibility_json = ?3, diagnostics_json = ?4
                 WHERE id = ?1 AND revision = ?5 AND manifest_json = ?6",
                params![
                    plugin_id,
                    projection.package_sha256,
                    projection.compatibility.to_string(),
                    projection.diagnostics.to_string(),
                    revision,
                    manifest_json,
                ],
            )?;
            transaction.commit()?;
            continue;
        }

        let diagnostics_json = projection.diagnostics.to_string();
        let compatibility_json = projection.compatibility.to_string();
        let state = if projection.package_sha256.is_some() {
            "validated"
        } else {
            // An active legacy version remains the pointer even when its
            // package is missing; the Engine sees compatibility=false and will
            // not register it.  Keeping the state validated preserves the
            // active-version FK and the original lifecycle fields.
            "validated"
        };
        transaction.execute(
            "UPDATE plugin_versions SET
                package_sha256 = COALESCE(package_sha256, ?3),
                managed_package_path = COALESCE(managed_package_path, ?4),
                runtime_json = ?5, normalized_manifest_json = ?6,
                contributions_json = ?7, compatibility_json = ?8,
                diagnostics_json = ?9, state = ?10,
                failed_at_ms = CASE WHEN ?11 = 1 THEN NULL ELSE failed_at_ms END
             WHERE plugin_id = ?1 AND id = ?2",
            params![
                plugin_id,
                active_version_id,
                projection.package_sha256,
                package_path,
                projection.runtime.to_string(),
                projection.normalized_manifest.to_string(),
                projection.contributions.to_string(),
                compatibility_json,
                diagnostics_json,
                state,
                if projection.package_sha256.is_some() {
                    1_i64
                } else {
                    0_i64
                },
            ],
        )?;
        transaction.execute(
            "UPDATE plugin_installations SET
                package_sha256 = COALESCE(package_sha256, ?2),
                runtime_json = ?3, normalized_manifest_json = ?4,
                compatibility_json = ?5, diagnostics_json = ?6
             WHERE id = ?1 AND revision = ?7 AND manifest_json = ?8",
            params![
                plugin_id,
                projection.package_sha256,
                projection.runtime.to_string(),
                projection.normalized_manifest.to_string(),
                compatibility_json,
                diagnostics_json,
                revision,
                manifest_json,
            ],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct NormalizedPackageProjection {
    package_sha256: Option<String>,
    runtime: Value,
    normalized_manifest: Value,
    contributions: Value,
    compatibility: Value,
    diagnostics: Value,
}

impl NormalizedPackageProjection {
    fn missing(code: &str, message: &str) -> Self {
        Self {
            package_sha256: None,
            runtime: json!({}),
            normalized_manifest: json!({}),
            contributions: json!([]),
            compatibility: json!({ "compatible": false, "reason": code }),
            diagnostics: json!([{
                "code": code,
                "message": message.chars().take(512).collect::<String>()
            }]),
        }
    }

    fn missing_with_manifest(manifest_json: &str, code: &str, message: &str) -> Self {
        let parsed = serde_json::from_str::<Value>(manifest_json).ok();
        let typed = parsed
            .as_ref()
            .and_then(|value| serde_json::from_value::<PluginManifest>(value.clone()).ok());
        let Some(typed) = typed else {
            return Self::missing(code, message);
        };
        let original = parsed.unwrap_or_else(|| json!({}));
        let normalized_manifest = normalize_v1_value(&typed, original);
        Self {
            package_sha256: None,
            runtime: normalized_manifest
                .get("runtime")
                .cloned()
                .unwrap_or_else(|| json!({})),
            contributions: normalized_manifest
                .get("contributions")
                .cloned()
                .unwrap_or_else(|| json!([])),
            normalized_manifest,
            compatibility: json!({ "compatible": false, "reason": code }),
            diagnostics: json!([{
                "code": code,
                "message": message.chars().take(512).collect::<String>()
            }]),
        }
    }
}

fn normalize_package_directory(package_dir: &Path) -> Result<NormalizedPackageProjection> {
    let normalized = load_normalized_manifest(package_dir)
        .map_err(|error| StorageError::InvalidData(error.to_string()))?;
    let package_hash = hash_plugin_package(package_dir)
        .map_err(|error| StorageError::InvalidData(error.to_string()))?;
    let normalized_value = serde_json::to_value(&normalized)?;
    let runtime = serde_json::to_value(&normalized.runtime)?;
    let contributions = serde_json::to_value(&normalized.contributions)?;
    let compatibility = serde_json::to_value(normalized.compatibility())?;
    Ok(NormalizedPackageProjection {
        package_sha256: Some(package_hash.sha256),
        runtime,
        contributions,
        normalized_manifest: normalized_value,
        compatibility,
        diagnostics: json!([]),
    })
}

fn normalize_v1_value(legacy: &PluginManifest, original: Value) -> Value {
    let runtime = json!({
        "tier": "process",
        "runtimeVersion": 1,
        "protocolVersion": 1,
        "entry": legacy.entry.clone(),
    });
    let contributions = legacy
        .contributions
        .filters
        .iter()
        .map(|filter| {
            json!({
                "kind": "filter",
                "descriptorVersion": 1,
                "id": filter.id.clone(),
                "version": filter.version.clone(),
                "displayName": filter.display_name.clone(),
                "extensions": filter.extensions.clone(),
                "capabilities": filter.capabilities.clone(),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "normalizedVersion": 1,
        "sourceManifestVersion": 1,
        "id": legacy.id.clone(),
        "displayName": legacy.display_name.clone(),
        "version": legacy.version.clone(),
        "hostApi": { "min": legacy.api_version_min, "max": legacy.api_version },
        "runtime": runtime,
        "contributions": contributions,
        "requestedPermissions": legacy.permissions.clone(),
        "originalManifestJson": original,
    })
}

fn bounded_error_message(error: StorageError) -> String {
    error.to_string().chars().take(512).collect()
}

impl Store {
    pub fn list_plugin_installations(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<PluginInstallationRecord>, u32)> {
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let total =
            self.connection
                .query_row("SELECT COUNT(*) FROM plugin_installations", [], |row| {
                    row.get::<_, i64>(0)
                })?;
        let query = format!(
            "SELECT {INSTALLATION_COLUMNS} FROM plugin_installations
             ORDER BY display_name COLLATE NOCASE, id LIMIT ?1 OFFSET ?2"
        );
        let mut statement = self.connection.prepare(&query)?;
        let items = statement
            .query_map(
                params![to_i64(u64::from(limit))?, to_i64(u64::from(offset))?],
                map_plugin_row,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn get_plugin_installation(&self, plugin_id: &str) -> Result<PluginInstallationRecord> {
        require_nonempty("plugin id", plugin_id)?;
        let query =
            format!("SELECT {INSTALLATION_COLUMNS} FROM plugin_installations WHERE id = ?1");
        self.connection
            .query_row(&query, [plugin_id], map_plugin_row)
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            })
    }

    pub fn upsert_plugin_installation(
        &mut self,
        input: UpsertPluginInstallation,
    ) -> Result<PluginInstallationRecord> {
        let manifest = input.manifest;
        require_nonempty("plugin id", &manifest.id)?;
        let now = now_ms();
        let package_path = path_string(&input.package_path);
        let entry_value = serde_json::to_value(&manifest.entry)?;
        let original_manifest_json = serde_json::to_value(&manifest)?;
        let (
            normalized_manifest_json,
            runtime_json,
            version_contributions_value,
            compatibility_json,
            package_sha256,
        ) = if input.package_path.is_dir() {
            let normalized = load_normalized_manifest(&input.package_path)
                .map_err(|error| StorageError::InvalidData(error.to_string()))?;
            let normalized_manifest_json = serde_json::to_value(&normalized)?;
            let runtime_json = serde_json::to_value(&normalized.runtime)?;
            let contributions = serde_json::to_value(&normalized.contributions)?;
            let compatibility = serde_json::to_value(normalized.compatibility())?;
            let package_hash = hash_plugin_package(&input.package_path)
                .map_err(|error| StorageError::InvalidData(error.to_string()))?
                .sha256;
            (
                normalized_manifest_json,
                runtime_json,
                contributions,
                compatibility,
                Some(package_hash),
            )
        } else {
            let normalized_manifest_json =
                normalize_v1_value(&manifest, original_manifest_json.clone());
            let runtime_json = normalized_manifest_json
                .get("runtime")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let contributions = normalized_manifest_json
                .get("contributions")
                .cloned()
                .unwrap_or_else(|| json!([]));
            (
                normalized_manifest_json,
                runtime_json,
                contributions,
                json!({ "compatible": true }),
                None,
            )
        };
        let entry_json = entry_value.to_string();
        let manifest_json = original_manifest_json.to_string();
        let contributions_value = serde_json::to_value(&manifest.contributions)?;
        let contributions_json = contributions_value.to_string();
        let requested_json = serde_json::to_string(&manifest.permissions)?;
        let granted_json = serde_json::to_string(&input.granted_permissions)?;
        let tier = match manifest.tier {
            PluginTier::Declarative => "declarative",
            PluginTier::Sandbox => "sandbox",
            PluginTier::Process => "process",
        };
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = tx
            .query_row(
                "SELECT revision FROM plugin_installations WHERE id = ?1",
                [&manifest.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if let Some(revision) = existing {
            tx.execute(
                "UPDATE plugin_installations
                 SET display_name = ?2, version = ?3, tier = ?4, status = ?5,
                     package_path = ?6, entry_json = ?7, manifest_json = ?8,
                     contributions_json = ?9, requested_permissions_json = ?10,
                     granted_permissions_json = ?11, last_error = ?12,
                     revision = ?13, updated_at_ms = ?14
                 WHERE id = ?1",
                params![
                    manifest.id,
                    manifest.display_name,
                    manifest.version,
                    tier,
                    input.status.as_str(),
                    package_path,
                    entry_json,
                    manifest_json,
                    contributions_json,
                    requested_json,
                    granted_json,
                    input.last_error,
                    revision + 1,
                    now,
                ],
            )?;
        } else {
            tx.execute(
                "INSERT INTO plugin_installations (
                    id, display_name, version, tier, status, package_path, entry_json,
                    manifest_json, contributions_json, requested_permissions_json,
                    granted_permissions_json, last_error, crash_count, revision,
                    installed_at_ms, updated_at_ms, active_version_id,
                    runtime_json, normalized_manifest_json, compatibility_json,
                    diagnostics_json, source_kind, distribution_json
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                    0, 0, ?13, ?13, NULL, ?14, ?15, ?16, ?17, ?18, NULL
                 )",
                params![
                    manifest.id,
                    manifest.display_name,
                    manifest.version,
                    tier,
                    input.status.as_str(),
                    package_path,
                    entry_json,
                    manifest_json,
                    contributions_json,
                    requested_json,
                    granted_json,
                    input.last_error,
                    now,
                    runtime_json.to_string(),
                    normalized_manifest_json.to_string(),
                    compatibility_json.to_string(),
                    json!([]).to_string(),
                    PluginPackageSourceKind::LocalDirectory.as_str(),
                ],
            )?;
            let version_id = format!("install-v1:{}:{}", manifest.id, manifest.version);
            let version = NewPluginVersion {
                id: version_id.clone(),
                plugin_id: manifest.id.clone(),
                display_name: manifest.display_name.clone(),
                version: manifest.version.clone(),
                tier: manifest.tier,
                entry_json: entry_value,
                original_manifest_json,
                requested_permissions: manifest.permissions.clone(),
                granted_permissions: input.granted_permissions.clone(),
                package_sha256,
                package_path: input.package_path.clone(),
                managed_package_path: Some(input.package_path.clone()),
                manifest_version: manifest.manifest_version,
                runtime_json,
                normalized_manifest_json,
                contributions_json: version_contributions_value,
                compatibility_json,
                diagnostics_json: json!([]),
                state: PluginVersionState::Validated,
                installed_at_ms: now,
                source_kind: PluginPackageSourceKind::LocalDirectory,
                distribution: None,
            };
            validate_version_input(&version)?;
            let requested_capabilities = super::plugin_permissions::requests_from_manifest_values(
                &version.normalized_manifest_json,
                &version.original_manifest_json,
            )?;
            insert_plugin_version_tx(&tx, &version)?;
            super::plugin_permissions::insert_plugin_capability_requests_tx(
                &tx,
                &version.plugin_id,
                &version.id,
                &requested_capabilities,
                None,
                now,
            )?;
            tx.execute(
                "UPDATE plugin_installations SET active_version_id = ?2,
                    package_sha256 = ?3 WHERE id = ?1",
                params![&manifest.id, version_id, version.package_sha256],
            )?;
            super::plugin_permissions::sync_plugin_legacy_grants_tx(
                &tx,
                &manifest.id,
                &version_id,
            )?;
        }
        tx.commit()?;
        self.get_plugin_installation(&manifest.id)
    }

    pub fn upsert_normalized_plugin_installation(
        &mut self,
        input: UpsertNormalizedPluginInstallation,
    ) -> Result<PluginInstallationRecord> {
        require_nonempty("plugin id", &input.manifest.id)?;
        validate_version_projection_values(
            &input.original_manifest_json,
            &input.normalized_manifest_json,
            &input.runtime_json,
            &input.contributions_json,
            &input.compatibility_json,
            &input.diagnostics_json,
            input.package_sha256.as_deref(),
        )?;
        let now = now_ms();
        let tier = plugin_tier_string(input.manifest.tier);
        let entry_json = serde_json::to_value(&input.manifest.entry)?;
        let legacy_contributions = legacy_contributions_value(&input.contributions_json);
        let requested_json = serde_json::to_string(&input.manifest.permissions)?;
        let granted_json = serde_json::to_string(&input.granted_permissions)?;
        let version_id = format!(
            "inventory-v{}:{}:{}",
            input.source_manifest_version, input.manifest.id, input.manifest.version
        );
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx
            .query_row(
                "SELECT 1 FROM plugin_installations WHERE id = ?1",
                [&input.manifest.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some()
        {
            return Err(StorageError::InvalidState(
                "plugin id is already installed".to_string(),
            ));
        }
        let distribution_json = input
            .distribution
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| StorageError::InvalidData(error.to_string()))?;
        tx.execute(
            "INSERT INTO plugin_installations (
                id, display_name, version, tier, status, package_path, entry_json,
                manifest_json, contributions_json, requested_permissions_json,
                granted_permissions_json, last_error, crash_count, revision,
                installed_at_ms, updated_at_ms, active_version_id, package_sha256,
                runtime_json, normalized_manifest_json, compatibility_json, diagnostics_json,
                source_kind, distribution_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                       0, 0, ?13, ?13, NULL, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![
                input.manifest.id,
                input.manifest.display_name,
                input.manifest.version,
                tier,
                input.status.as_str(),
                path_string(&input.package_path),
                entry_json.to_string(),
                input.original_manifest_json.to_string(),
                legacy_contributions.to_string(),
                requested_json,
                granted_json,
                input.last_error,
                now,
                input.package_sha256,
                input.runtime_json.to_string(),
                input.normalized_manifest_json.to_string(),
                input.compatibility_json.to_string(),
                input.diagnostics_json.to_string(),
                input.source_kind.as_str(),
                distribution_json,
            ],
        )?;
        let version = NewPluginVersion {
            id: version_id.clone(),
            plugin_id: input.manifest.id.clone(),
            display_name: input.manifest.display_name.clone(),
            version: input.manifest.version.clone(),
            tier: input.manifest.tier,
            entry_json,
            original_manifest_json: input.original_manifest_json,
            requested_permissions: input.manifest.permissions.clone(),
            granted_permissions: input.granted_permissions,
            package_sha256: input.package_sha256,
            package_path: input.package_path.clone(),
            managed_package_path: Some(input.package_path),
            manifest_version: input.source_manifest_version,
            runtime_json: input.runtime_json,
            normalized_manifest_json: input.normalized_manifest_json,
            contributions_json: input.contributions_json,
            compatibility_json: input.compatibility_json,
            diagnostics_json: input.diagnostics_json,
            state: PluginVersionState::Validated,
            installed_at_ms: now,
            source_kind: input.source_kind,
            distribution: input.distribution,
        };
        validate_version_input(&version)?;
        let requested_capabilities = super::plugin_permissions::requests_from_manifest_values(
            &version.normalized_manifest_json,
            &version.original_manifest_json,
        )?;
        insert_plugin_version_tx(&tx, &version)?;
        super::plugin_permissions::insert_plugin_capability_requests_tx(
            &tx,
            &version.plugin_id,
            &version.id,
            &requested_capabilities,
            None,
            now,
        )?;
        tx.execute(
            "UPDATE plugin_installations SET active_version_id = ?2 WHERE id = ?1",
            params![version.plugin_id, version.id],
        )?;
        super::plugin_permissions::sync_plugin_legacy_grants_tx(
            &tx,
            &version.plugin_id,
            &version.id,
        )?;
        tx.commit()?;
        self.get_plugin_installation(&version.plugin_id)
    }

    pub fn set_plugin_status(
        &mut self,
        plugin_id: &str,
        status: PluginStatus,
        expected_revision: Option<u64>,
        last_error: Option<String>,
    ) -> Result<PluginInstallationRecord> {
        let now = now_ms();
        let updated = if let Some(expected) = expected_revision {
            self.connection.execute(
                "UPDATE plugin_installations
                 SET status = ?2, last_error = ?3, revision = revision + 1, updated_at_ms = ?4
                 WHERE id = ?1 AND revision = ?5",
                params![
                    plugin_id,
                    status.as_str(),
                    last_error,
                    now,
                    to_i64(expected)?
                ],
            )?
        } else {
            self.connection.execute(
                "UPDATE plugin_installations
                 SET status = ?2, last_error = ?3, revision = revision + 1, updated_at_ms = ?4
                 WHERE id = ?1",
                params![plugin_id, status.as_str(), last_error, now],
            )?
        };
        if updated == 0 {
            let current = self.get_plugin_installation(plugin_id)?;
            if let Some(expected) = expected_revision {
                return Err(StorageError::EntityConflict {
                    entity: "plugin",
                    id: plugin_id.to_string(),
                    expected_revision: expected,
                    actual_revision: current.revision,
                });
            }
        }
        self.get_plugin_installation(plugin_id)
    }

    pub fn record_plugin_crash(
        &mut self,
        plugin_id: &str,
        activation_revision: u64,
        last_error: impl Into<String>,
    ) -> Result<Option<PluginInstallationRecord>> {
        let active_version_id: Option<String> = self
            .connection
            .query_row(
                "SELECT active_version_id FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                |row| row.get(0),
            )
            .optional()?;
        self.record_plugin_crash_for_version(
            plugin_id,
            active_version_id.as_deref(),
            activation_revision,
            last_error,
        )
    }

    /// Version-aware crash CAS used by newer Engine activations.  The legacy
    /// method above remains source-compatible and derives the current pointer.
    pub fn record_plugin_crash_for_version(
        &mut self,
        plugin_id: &str,
        active_version_id: Option<&str>,
        activation_revision: u64,
        last_error: impl Into<String>,
    ) -> Result<Option<PluginInstallationRecord>> {
        let now = now_ms();
        let updated = self.connection.execute(
            "UPDATE plugin_installations
             SET status = 'degraded', last_error = ?2, crash_count = crash_count + 1,
                 revision = revision + 1, updated_at_ms = ?3
             WHERE id = ?1 AND status = 'enabled' AND revision = ?4
               AND (?5 IS NULL OR active_version_id = ?5)",
            params![
                plugin_id,
                last_error.into(),
                now,
                to_i64(activation_revision)?,
                active_version_id,
            ],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.get_plugin_installation(plugin_id).map(Some)
    }

    pub fn delete_plugin_installation(&mut self, plugin_id: &str) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE plugin_installations SET active_version_id = NULL WHERE id = ?1",
            [plugin_id],
        )?;
        let deleted = tx.execute(
            "DELETE FROM plugin_installations WHERE id = ?1",
            [plugin_id],
        )?;
        if deleted == 0 {
            return Err(StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            });
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_enabled_plugins(&self) -> Result<Vec<PluginInstallationRecord>> {
        let query = format!(
            "SELECT {INSTALLATION_COLUMNS} FROM plugin_installations
             WHERE status = 'enabled' ORDER BY id"
        );
        let mut statement = self.connection.prepare(&query)?;
        let items = statement
            .query_map([], map_plugin_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(items)
    }

    /// Return a bounded, deterministic page of immutable package versions.
    pub fn list_plugin_versions(
        &self,
        plugin_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<PluginVersionRecord>, u32)> {
        require_nonempty("plugin id", plugin_id)?;
        // Distinguish an empty history from an unknown installation.
        self.ensure_plugin_exists(plugin_id)?;
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM plugin_versions WHERE plugin_id = ?1",
            [plugin_id],
            |row| row.get::<_, i64>(0),
        )?;
        let query = format!(
            "SELECT {VERSION_COLUMNS} FROM plugin_versions
             WHERE plugin_id = ?1
             ORDER BY installed_at_ms, id LIMIT ?2 OFFSET ?3"
        );
        let mut statement = self.connection.prepare(&query)?;
        let items = statement
            .query_map(
                params![
                    plugin_id,
                    to_i64(u64::from(limit))?,
                    to_i64(u64::from(offset))?
                ],
                map_plugin_version_row,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn get_plugin_version(
        &self,
        plugin_id: &str,
        version_id: &str,
    ) -> Result<PluginVersionRecord> {
        require_nonempty("plugin id", plugin_id)?;
        require_nonempty("plugin version id", version_id)?;
        let query = format!(
            "SELECT {VERSION_COLUMNS} FROM plugin_versions
             WHERE plugin_id = ?1 AND id = ?2"
        );
        self.connection
            .query_row(
                &query,
                params![plugin_id, version_id],
                map_plugin_version_row,
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin version",
                id: version_id.to_string(),
            })
    }

    pub fn insert_plugin_version(
        &mut self,
        input: NewPluginVersion,
    ) -> Result<PluginVersionRecord> {
        validate_version_input(&input)?;
        let requested_capabilities = super::plugin_permissions::requests_from_manifest_values(
            &input.normalized_manifest_json,
            &input.original_manifest_json,
        )?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_plugin_exists_tx(&tx, &input.plugin_id)?;
        if let Some(existing_id) = existing_version_id_tx(&tx, &input)? {
            tx.commit()?;
            return self.get_plugin_version(&input.plugin_id, &existing_id);
        }
        let carry_from_version_id = tx.query_row(
            "SELECT active_version_id FROM plugin_installations WHERE id = ?1",
            [&input.plugin_id],
            |row| row.get::<_, Option<String>>(0),
        )?;
        insert_plugin_version_tx(&tx, &input)?;
        super::plugin_permissions::insert_plugin_capability_requests_tx(
            &tx,
            &input.plugin_id,
            &input.id,
            &requested_capabilities,
            carry_from_version_id.as_deref(),
            input.installed_at_ms,
        )?;
        tx.commit()?;
        self.get_plugin_version(&input.plugin_id, &input.id)
    }

    /// Insert a candidate and atomically swap the installation projection.  A
    /// stale revision is rejected before any candidate row is written.
    pub fn cas_activate_plugin_version(
        &mut self,
        plugin_id: &str,
        expected_revision: u64,
        input: NewPluginVersion,
        status: PluginStatus,
    ) -> Result<PluginActivationResult> {
        require_nonempty("plugin id", plugin_id)?;
        if input.plugin_id != plugin_id {
            return Err(StorageError::InvalidState(
                "plugin version candidate belongs to another plugin".to_string(),
            ));
        }
        validate_version_input(&input)?;
        let requested_capabilities = super::plugin_permissions::requests_from_manifest_values(
            &input.normalized_manifest_json,
            &input.original_manifest_json,
        )?;
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (actual_revision, previous_version_id): (i64, Option<String>) = tx
            .query_row(
                "SELECT revision, active_version_id FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            })?;
        let actual_revision = to_u64_i64(actual_revision)?;
        if actual_revision != expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision,
                actual_revision,
            });
        }

        let existing_by_version: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT id, package_sha256 FROM plugin_versions
                 WHERE plugin_id = ?1 AND version = ?2",
                params![plugin_id, input.version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let mut candidate_id = input.id.clone();
        if let Some((existing_id, existing_hash)) = existing_by_version {
            if existing_hash != input.package_sha256 {
                return Err(StorageError::InvalidState(format!(
                    "plugin version {} already exists with a different package hash",
                    input.version
                )));
            }
            candidate_id = existing_id;
        } else {
            ensure_package_hash_unique_tx(&tx, &input)?;
            insert_plugin_version_tx(&tx, &input)?;
            super::plugin_permissions::insert_plugin_capability_requests_tx(
                &tx,
                plugin_id,
                &candidate_id,
                &requested_capabilities,
                previous_version_id.as_deref(),
                input.installed_at_ms,
            )?;
        }

        if previous_version_id.as_deref() == Some(candidate_id.as_str()) {
            tx.commit()?;
            return Ok(PluginActivationResult {
                installation: self.get_plugin_installation(plugin_id)?,
                active_version: self.get_plugin_version(plugin_id, &candidate_id)?,
                previous_version_id,
            });
        }

        if let Some(previous) = previous_version_id.as_deref() {
            tx.execute(
                "UPDATE plugin_versions SET deactivated_at_ms = ?3
                 WHERE plugin_id = ?1 AND id = ?2",
                params![plugin_id, previous, now],
            )?;
        }
        tx.execute(
            "UPDATE plugin_versions
             SET state = 'validated', activated_at_ms = ?3,
                 deactivated_at_ms = NULL, failed_at_ms = NULL
             WHERE plugin_id = ?1 AND id = ?2",
            params![plugin_id, candidate_id, now],
        )?;

        let legacy_manifest = input.original_manifest_json.to_string();
        let legacy_contributions = legacy_contributions_json(&input.contributions_json);
        let requested_permissions = serde_json::to_string(&input.requested_permissions)?;
        let granted_permissions = "[]".to_string();
        let effective_status = if status == PluginStatus::Enabled
            && !super::plugin_permissions::required_plugin_capabilities_satisfied_tx(
                &tx,
                plugin_id,
                &candidate_id,
            )? {
            PluginStatus::Disabled
        } else {
            status
        };
        let entry_json = input.entry_json.to_string();
        let runtime_json = input.runtime_json.to_string();
        let normalized_manifest_json = input.normalized_manifest_json.to_string();
        let compatibility_json = input.compatibility_json.to_string();
        let diagnostics_json = input.diagnostics_json.to_string();
        let distribution_json = input
            .distribution
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| StorageError::InvalidData(error.to_string()))?;
        let package_path = path_string(&input.package_path);
        let updated = tx.execute(
            "UPDATE plugin_installations SET
                display_name = ?2, version = ?3, tier = ?4, status = ?5,
                package_path = ?6, entry_json = ?7, manifest_json = ?8,
                contributions_json = ?9, requested_permissions_json = ?10,
                granted_permissions_json = ?11, last_error = NULL,
                revision = revision + 1, updated_at_ms = ?12,
                active_version_id = ?13, package_sha256 = ?14,
                runtime_json = ?15, normalized_manifest_json = ?16,
                compatibility_json = ?17, diagnostics_json = ?18,
                source_kind = ?19, distribution_json = ?20
             WHERE id = ?1 AND revision = ?21",
            params![
                plugin_id,
                input.display_name,
                input.version,
                plugin_tier_string(input.tier),
                effective_status.as_str(),
                package_path,
                entry_json,
                legacy_manifest,
                legacy_contributions,
                requested_permissions,
                granted_permissions,
                now,
                candidate_id,
                input.package_sha256,
                runtime_json,
                normalized_manifest_json,
                compatibility_json,
                diagnostics_json,
                input.source_kind.as_str(),
                distribution_json,
                to_i64(expected_revision)?,
            ],
        )?;
        if updated != 1 {
            // This should only be reachable if a future trigger changes the
            // revision between the read and CAS; report the authoritative row.
            let actual = tx.query_row(
                "SELECT revision FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                |row| row.get::<_, i64>(0),
            )?;
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision,
                actual_revision: to_u64_i64(actual)?,
            });
        }
        super::plugin_permissions::sync_plugin_legacy_grants_tx(&tx, plugin_id, &candidate_id)?;
        tx.commit()?;
        Ok(PluginActivationResult {
            installation: self.get_plugin_installation(plugin_id)?,
            active_version: self.get_plugin_version(plugin_id, &candidate_id)?,
            previous_version_id,
        })
    }

    pub fn mark_plugin_version_failed(
        &mut self,
        plugin_id: &str,
        version_id: &str,
        diagnostics: Value,
    ) -> Result<PluginVersionRecord> {
        if !diagnostics.is_array() {
            return Err(StorageError::InvalidState(
                "plugin version diagnostics must be an array".to_string(),
            ));
        }
        validate_diagnostics(&diagnostics)?;
        let now = now_ms();
        let updated = self.connection.execute(
            "UPDATE plugin_versions
             SET state = 'failed', diagnostics_json = ?3, failed_at_ms = ?4
             WHERE plugin_id = ?1 AND id = ?2
               AND NOT EXISTS (
                   SELECT 1 FROM plugin_installations
                   WHERE id = ?1 AND active_version_id = ?2
               )",
            params![plugin_id, version_id, diagnostics.to_string(), now],
        )?;
        if updated == 0 {
            // Return a useful distinction for an active candidate rather than
            // silently marking the authoritative version failed.
            let _ = self.get_plugin_version(plugin_id, version_id)?;
            return Err(StorageError::InvalidState(
                "active plugin version cannot be marked failed".to_string(),
            ));
        }
        self.get_plugin_version(plugin_id, version_id)
    }

    /// Roll back the active projection to a validated version belonging to the
    /// same plugin.  Legacy columns are reconstructed from the stored original
    /// manifest where possible; grants are restored from that version's
    /// capability decisions and crash counters remain untouched.
    pub fn rollback_plugin_version(
        &mut self,
        plugin_id: &str,
        expected_revision: u64,
        version_id: &str,
    ) -> Result<PluginActivationResult> {
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (actual_revision, previous_version_id, current_status): (i64, Option<String>, String) =
            tx.query_row(
                "SELECT revision, active_version_id, status
                 FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            })?;
        let actual_revision = to_u64_i64(actual_revision)?;
        if actual_revision != expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision,
                actual_revision,
            });
        }
        let query = format!(
            "SELECT {VERSION_COLUMNS} FROM plugin_versions
             WHERE plugin_id = ?1 AND id = ?2"
        );
        let version = tx
            .query_row(
                &query,
                params![plugin_id, version_id],
                map_plugin_version_row,
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin version",
                id: version_id.to_string(),
            })?;
        if version.state != PluginVersionState::Validated {
            return Err(StorageError::InvalidState(
                "only a validated plugin version can be activated".to_string(),
            ));
        }
        if previous_version_id.as_deref() == Some(version_id) {
            tx.commit()?;
            return Ok(PluginActivationResult {
                installation: self.get_plugin_installation(plugin_id)?,
                active_version: self.get_plugin_version(plugin_id, version_id)?,
                previous_version_id,
            });
        }
        let (display_name, tier, entry_json, manifest_json, contributions_json, requested_json) =
            legacy_projection_from_version(&version)?;
        let granted_json = serde_json::to_string(
            &super::plugin_permissions::granted_plugin_legacy_permissions_tx(
                &tx, plugin_id, version_id,
            )?,
        )?;
        let required_satisfied =
            super::plugin_permissions::required_plugin_capabilities_satisfied_tx(
                &tx, plugin_id, version_id,
            )?;
        let rollback_status = if current_status == "enabled" && !required_satisfied {
            "disabled"
        } else {
            current_status.as_str()
        };
        if let Some(previous) = previous_version_id.as_deref() {
            tx.execute(
                "UPDATE plugin_versions SET deactivated_at_ms = ?3
                 WHERE plugin_id = ?1 AND id = ?2",
                params![plugin_id, previous, now],
            )?;
        }
        tx.execute(
            "UPDATE plugin_versions SET activated_at_ms = ?3,
                deactivated_at_ms = NULL, failed_at_ms = NULL, state = 'validated'
             WHERE plugin_id = ?1 AND id = ?2",
            params![plugin_id, version_id, now],
        )?;
        let distribution_json = version
            .distribution
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| StorageError::InvalidData(error.to_string()))?;
        let updated = tx.execute(
            "UPDATE plugin_installations SET
                display_name = ?2, version = ?3, tier = ?4,
                package_path = ?5, entry_json = ?6, manifest_json = ?7,
                contributions_json = ?8, requested_permissions_json = ?9,
                granted_permissions_json = ?10, last_error = NULL,
                revision = revision + 1, updated_at_ms = ?11,
                active_version_id = ?12, package_sha256 = ?13,
                runtime_json = ?14, normalized_manifest_json = ?15,
                compatibility_json = ?16, diagnostics_json = ?17,
                status = ?18, source_kind = ?19, distribution_json = ?20
             WHERE id = ?1 AND revision = ?21",
            params![
                plugin_id,
                display_name,
                version.version,
                tier,
                path_string(
                    version
                        .managed_package_path
                        .as_deref()
                        .unwrap_or(&version.package_path),
                ),
                entry_json,
                manifest_json,
                contributions_json,
                requested_json,
                granted_json,
                now,
                version.id,
                version.package_sha256,
                version.runtime_json.to_string(),
                version.normalized_manifest_json.to_string(),
                version.compatibility_json.to_string(),
                version.diagnostics_json.to_string(),
                rollback_status,
                version.source_kind.as_str(),
                distribution_json,
                to_i64(expected_revision)?,
            ],
        )?;
        if updated != 1 {
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision,
                actual_revision: to_u64_i64(tx.query_row(
                    "SELECT revision FROM plugin_installations WHERE id = ?1",
                    [plugin_id],
                    |row| row.get::<_, i64>(0),
                )?)?,
            });
        }
        tx.commit()?;
        Ok(PluginActivationResult {
            installation: self.get_plugin_installation(plugin_id)?,
            active_version: self.get_plugin_version(plugin_id, version_id)?,
            previous_version_id,
        })
    }

    /// Delete an installation and all versions atomically.  The package bytes
    /// are deliberately left to the Engine's quarantine/cleanup phase.
    pub fn uninstall_plugin_versions(&mut self, plugin_id: &str) -> Result<()> {
        self.uninstall_plugin_versions_cas(plugin_id, None)
    }

    pub fn uninstall_plugin_versions_cas(
        &mut self,
        plugin_id: &str,
        expected_revision: Option<u64>,
    ) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current_revision = tx
            .query_row(
                "SELECT revision FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(current_revision) = current_revision else {
            return Err(StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            });
        };
        let current_revision = to_u64_i64(current_revision)?;
        if let Some(expected_revision) = expected_revision
            && expected_revision != current_revision
        {
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision,
                actual_revision: current_revision,
            });
        }
        tx.execute(
            "UPDATE plugin_installations SET active_version_id = NULL WHERE id = ?1",
            [plugin_id],
        )?;
        tx.execute(
            "DELETE FROM plugin_installations WHERE id = ?1",
            [plugin_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Detach an installation only after its managed package has been moved
    /// into a private quarantine directory.  The caller owns cleanup of the
    /// returned path; a failed rename or database delete leaves the original
    /// package and row recoverable.
    pub fn quarantine_and_uninstall_plugin(
        &mut self,
        plugin_id: &str,
        expected_revision: Option<u64>,
    ) -> Result<PathBuf> {
        let record = self.get_plugin_installation(plugin_id)?;
        if let Some(expected_revision) = expected_revision
            && expected_revision != record.revision
        {
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision,
                actual_revision: record.revision,
            });
        }
        let managed = self.paths.resolve_plugin_path(&record.package_path);
        if !managed.exists() {
            return Err(StorageError::InvalidState(
                "managed plugin package is missing; uninstall was not committed".to_string(),
            ));
        }
        let plugins_root = self
            .paths
            .plugins
            .canonicalize()
            .map_err(StorageError::Io)?;
        let managed_absolute = managed.canonicalize().map_err(StorageError::Io)?;
        if !managed_absolute.starts_with(&plugins_root) {
            return Err(StorageError::InvalidState(
                "managed plugin package is outside the plugin root".to_string(),
            ));
        }
        let quarantine_root = self.paths.plugins.join(".quarantine");
        fs::create_dir_all(&quarantine_root)?;
        let quarantine = quarantine_root.join(format!("{plugin_id}-{}", now_ms()));
        fs::rename(&managed, &quarantine)?;
        if let Err(error) = self.uninstall_plugin_versions_cas(plugin_id, Some(record.revision)) {
            let _ = fs::rename(&quarantine, &managed);
            return Err(error);
        }
        Ok(quarantine)
    }

    pub fn record_plugin_ai_action_invocation(
        &mut self,
        record: NewPluginAiActionInvocation,
    ) -> Result<PluginAiActionInvocationRecord> {
        require_nonempty(record.id, "AI action invocation id")?;
        require_nonempty(record.plugin_id, "plugin id")?;
        require_nonempty(record.version_id, "version id")?;
        require_nonempty(record.contribution_id, "contribution id")?;
        require_nonempty(record.contribution_version, "contribution version")?;
        let status = record.status.as_str();
        let usage_json = serde_json::to_string(&record.usage)?;
        if usage_json.len() > 4_096 {
            return Err(StorageError::InvalidData(
                "AI action usage payload is oversized".to_string(),
            ));
        }
        let created_at_ms = now_ms();
        self.connection.execute(
            "INSERT INTO plugin_ai_action_invocations (
                id, plugin_id, version_id, activation_revision, contribution_id,
                contribution_version, status, failure_code, canonical_sha256,
                usage_json, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                record.id,
                record.plugin_id,
                record.version_id,
                to_i64(record.activation_revision)?,
                record.contribution_id,
                record.contribution_version,
                status,
                record.failure_code,
                record.canonical_sha256,
                usage_json,
                created_at_ms,
            ],
        )?;
        Ok(PluginAiActionInvocationRecord {
            id: record.id.to_string(),
            plugin_id: record.plugin_id.to_string(),
            version_id: record.version_id.to_string(),
            activation_revision: record.activation_revision,
            contribution_id: record.contribution_id.to_string(),
            contribution_version: record.contribution_version.to_string(),
            status: record.status,
            failure_code: record.failure_code.map(str::to_string),
            canonical_sha256: record.canonical_sha256.map(str::to_string),
            usage: record.usage,
            created_at_ms,
        })
    }

    pub fn plugin_ai_action_invocation_exists(&self, invocation_id: &str) -> Result<bool> {
        let exists = self
            .connection
            .query_row(
                "SELECT 1 FROM plugin_ai_action_invocations WHERE id = ?1",
                [invocation_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        Ok(exists)
    }

    pub fn list_plugin_ai_action_invocations(
        &self,
        plugin_id: Option<&str>,
        contribution_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<PluginAiActionInvocationPage> {
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let (total, items) = match (plugin_id, contribution_id) {
            (Some(plugin_id), Some(contribution_id)) => {
                let total: i64 = self.connection.query_row(
                    "SELECT COUNT(*) FROM plugin_ai_action_invocations
                     WHERE plugin_id = ?1 AND contribution_id = ?2",
                    params![plugin_id, contribution_id],
                    |row| row.get(0),
                )?;
                let mut statement = self.connection.prepare(
                    "SELECT id, plugin_id, version_id, activation_revision, contribution_id,
                            contribution_version, status, failure_code, canonical_sha256,
                            usage_json, created_at_ms
                     FROM plugin_ai_action_invocations
                     WHERE plugin_id = ?1 AND contribution_id = ?2
                     ORDER BY created_at_ms DESC, id DESC
                     LIMIT ?3 OFFSET ?4",
                )?;
                let items = statement
                    .query_map(
                        params![
                            plugin_id,
                            contribution_id,
                            i64::from(limit),
                            i64::from(offset)
                        ],
                        map_ai_action_invocation_row,
                    )?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                (total, items)
            }
            (Some(plugin_id), None) => {
                let total: i64 = self.connection.query_row(
                    "SELECT COUNT(*) FROM plugin_ai_action_invocations WHERE plugin_id = ?1",
                    params![plugin_id],
                    |row| row.get(0),
                )?;
                let mut statement = self.connection.prepare(
                    "SELECT id, plugin_id, version_id, activation_revision, contribution_id,
                            contribution_version, status, failure_code, canonical_sha256,
                            usage_json, created_at_ms
                     FROM plugin_ai_action_invocations
                     WHERE plugin_id = ?1
                     ORDER BY created_at_ms DESC, id DESC
                     LIMIT ?2 OFFSET ?3",
                )?;
                let items = statement
                    .query_map(
                        params![plugin_id, i64::from(limit), i64::from(offset)],
                        map_ai_action_invocation_row,
                    )?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                (total, items)
            }
            _ => {
                let total: i64 = self.connection.query_row(
                    "SELECT COUNT(*) FROM plugin_ai_action_invocations",
                    [],
                    |row| row.get(0),
                )?;
                let mut statement = self.connection.prepare(
                    "SELECT id, plugin_id, version_id, activation_revision, contribution_id,
                            contribution_version, status, failure_code, canonical_sha256,
                            usage_json, created_at_ms
                     FROM plugin_ai_action_invocations
                     ORDER BY created_at_ms DESC, id DESC
                     LIMIT ?1 OFFSET ?2",
                )?;
                let items = statement
                    .query_map(
                        params![i64::from(limit), i64::from(offset)],
                        map_ai_action_invocation_row,
                    )?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                (total, items)
            }
        };
        Ok(PluginAiActionInvocationPage {
            items,
            total: to_u32(total)?,
            offset,
            limit,
        })
    }

    fn ensure_plugin_exists(&self, plugin_id: &str) -> Result<()> {
        self.connection
            .query_row(
                "SELECT 1 FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            })?;
        Ok(())
    }
}

fn ensure_plugin_exists_tx(tx: &rusqlite::Transaction<'_>, plugin_id: &str) -> Result<()> {
    tx.query_row(
        "SELECT 1 FROM plugin_installations WHERE id = ?1",
        [plugin_id],
        |row| row.get::<_, i64>(0),
    )
    .optional()?
    .ok_or_else(|| StorageError::NotFound {
        entity: "plugin",
        id: plugin_id.to_string(),
    })?;
    Ok(())
}

fn validate_version_input(input: &NewPluginVersion) -> Result<()> {
    require_nonempty("plugin version id", &input.id)?;
    require_nonempty("plugin id", &input.plugin_id)?;
    require_nonempty("plugin display name", &input.display_name)?;
    require_nonempty("plugin version", &input.version)?;
    if input.manifest_version == 0 {
        return Err(StorageError::InvalidState(
            "plugin manifest version must be positive".to_string(),
        ));
    }
    validate_version_projection_values(
        &input.original_manifest_json,
        &input.normalized_manifest_json,
        &input.runtime_json,
        &input.contributions_json,
        &input.compatibility_json,
        &input.diagnostics_json,
        input.package_sha256.as_deref(),
    )
}

/// Validate the JSON projection shared by the installation row and immutable
/// version history. Keeping this check in one place ensures the normalized
/// inventory API cannot bypass the same SQLite shape and diagnostic bounds as
/// the legacy upsert path.
fn validate_version_projection_values(
    original_manifest_json: &Value,
    normalized_manifest_json: &Value,
    runtime_json: &Value,
    contributions_json: &Value,
    compatibility_json: &Value,
    diagnostics_json: &Value,
    package_sha256: Option<&str>,
) -> Result<()> {
    for (name, value) in [
        ("original manifest", original_manifest_json),
        ("runtime", runtime_json),
        ("normalized manifest", normalized_manifest_json),
        ("compatibility", compatibility_json),
    ] {
        if !value.is_object() {
            return Err(StorageError::InvalidState(format!(
                "plugin {name} JSON must be an object"
            )));
        }
    }
    if !diagnostics_json.is_array() {
        return Err(StorageError::InvalidState(
            "plugin diagnostics JSON must be an array".to_string(),
        ));
    }
    validate_diagnostics(diagnostics_json)?;
    if !(contributions_json.is_array() || contributions_json.is_object()) {
        return Err(StorageError::InvalidState(
            "plugin contributions JSON must be an array or object".to_string(),
        ));
    }
    if let Some(hash) = package_sha256
        && !is_sha256_hex(hash)
    {
        return Err(StorageError::InvalidState(
            "plugin package SHA-256 must be lowercase hexadecimal".to_string(),
        ));
    }
    Ok(())
}

fn validate_diagnostics(value: &Value) -> Result<()> {
    let count = value.as_array().map_or(0, std::vec::Vec::len);
    if count > MAX_PLUGIN_DIAGNOSTIC_COUNT {
        return Err(StorageError::InvalidState(
            "plugin diagnostics contain too many entries".to_string(),
        ));
    }
    if value.to_string().len() > MAX_PLUGIN_DIAGNOSTICS_BYTES {
        return Err(StorageError::InvalidState(
            "plugin diagnostics exceed the size limit".to_string(),
        ));
    }
    Ok(())
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value == value.to_ascii_lowercase()
}

fn plugin_tier_string(tier: PluginTier) -> &'static str {
    match tier {
        PluginTier::Declarative => "declarative",
        PluginTier::Sandbox => "sandbox",
        PluginTier::Process => "process",
    }
}

fn existing_version_id_tx(
    tx: &rusqlite::Transaction<'_>,
    input: &NewPluginVersion,
) -> Result<Option<String>> {
    let existing: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT id, package_sha256 FROM plugin_versions
             WHERE plugin_id = ?1 AND version = ?2",
            params![&input.plugin_id, &input.version],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((id, hash)) = existing {
        if id == input.id && hash == input.package_sha256 {
            return Ok(Some(id));
        }
        return Err(StorageError::InvalidState(format!(
            "plugin version {} already exists with a different identity or package hash",
            input.version
        )));
    }
    ensure_package_hash_unique_tx(tx, input)?;
    Ok(None)
}

fn ensure_package_hash_unique_tx(
    tx: &rusqlite::Transaction<'_>,
    input: &NewPluginVersion,
) -> Result<()> {
    let Some(hash) = input.package_sha256.as_deref() else {
        return Ok(());
    };
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT id, version FROM plugin_versions
             WHERE plugin_id = ?1 AND package_sha256 = ?2",
            params![&input.plugin_id, hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((id, version)) = existing
        && (id != input.id || version != input.version)
    {
        return Err(StorageError::InvalidState(
            "plugin package hash is already registered for another version".to_string(),
        ));
    }
    Ok(())
}

fn insert_plugin_version_tx(
    tx: &rusqlite::Transaction<'_>,
    input: &NewPluginVersion,
) -> Result<()> {
    let managed_package_path = input.managed_package_path.as_deref().map(path_string);
    let distribution_json = input
        .distribution
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| StorageError::InvalidData(error.to_string()))?;
    tx.execute(
        "INSERT INTO plugin_versions (
            id, plugin_id, version, package_sha256, package_path, managed_package_path,
            manifest_version, original_manifest_json, runtime_json,
            normalized_manifest_json, contributions_json, compatibility_json,
            diagnostics_json, state, installed_at_ms, source_kind, distribution_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            input.id,
            input.plugin_id,
            input.version,
            input.package_sha256,
            path_string(&input.package_path),
            managed_package_path,
            to_i64(u64::from(input.manifest_version))?,
            input.original_manifest_json.to_string(),
            input.runtime_json.to_string(),
            input.normalized_manifest_json.to_string(),
            input.contributions_json.to_string(),
            input.compatibility_json.to_string(),
            input.diagnostics_json.to_string(),
            input.state.as_str(),
            input.installed_at_ms,
            input.source_kind.as_str(),
            distribution_json,
        ],
    )?;
    Ok(())
}

fn map_plugin_version_row(row: &Row<'_>) -> rusqlite::Result<PluginVersionRecord> {
    let state = PluginVersionState::parse(&row.get::<_, String>(13)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(13, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let manifest_version = to_u32(row.get::<_, i64>(6)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })?;
    let source_kind = parse_source_kind_row(row, 18)?;
    let distribution = optional_distribution_row(row, 19)?;
    Ok(PluginVersionRecord {
        id: row.get(0)?,
        plugin_id: row.get(1)?,
        version: row.get(2)?,
        package_sha256: row.get(3)?,
        package_path: PathBuf::from(row.get::<_, String>(4)?),
        managed_package_path: row.get::<_, Option<String>>(5)?.map(PathBuf::from),
        manifest_version,
        original_manifest_json: read_json(row, 7)?,
        runtime_json: read_json(row, 8)?,
        normalized_manifest_json: read_json(row, 9)?,
        contributions_json: read_json(row, 10)?,
        compatibility_json: read_json(row, 11)?,
        diagnostics_json: read_json(row, 12)?,
        state,
        installed_at_ms: row.get(14)?,
        activated_at_ms: row.get(15)?,
        deactivated_at_ms: row.get(16)?,
        failed_at_ms: row.get(17)?,
        source_kind,
        distribution,
    })
}

fn parse_source_kind_row(row: &Row<'_>, index: usize) -> rusqlite::Result<PluginPackageSourceKind> {
    let value: String = row.get(index)?;
    PluginPackageSourceKind::parse(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(StorageError::InvalidData(error.to_string())),
        )
    })
}

fn optional_distribution_row(
    row: &Row<'_>,
    index: usize,
) -> rusqlite::Result<Option<PluginDistributionMetadata>> {
    let raw: Option<String> = row.get(index)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    serde_json::from_str(&raw).map(Some).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(StorageError::InvalidData(error.to_string())),
        )
    })
}

fn legacy_contributions_json(value: &Value) -> String {
    legacy_contributions_value(value).to_string()
}

/// Convert a normalized contribution array into the released v1 object shape
/// used by `plugin_installations.contributions_json`. Unknown contribution
/// families remain inventory-only and are intentionally omitted from the
/// legacy filter projection. V2-only discriminator fields are stripped so the
/// v1 `deny_unknown_fields` decoder remains compatible.
fn legacy_contributions_value(value: &Value) -> Value {
    if let Some(object) = value.as_object() {
        return Value::Object(object.clone());
    }
    let filters = value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|descriptor| {
            let object = descriptor.as_object()?;
            if object.get("kind").and_then(Value::as_str) != Some("filter") {
                return None;
            }
            Some(json!({
                "id": object.get("id")?.clone(),
                "version": object.get("version")?.clone(),
                "displayName": object.get("displayName")?.clone(),
                "extensions": object.get("extensions")?.clone(),
                "capabilities": object.get("capabilities")?.clone(),
            }))
        })
        .collect::<Vec<_>>();
    json!({ "filters": filters })
}

fn legacy_projection_from_version(
    version: &PluginVersionRecord,
) -> Result<(String, String, String, String, String, String)> {
    let original = &version.original_manifest_json;
    let display_name = original
        .get("displayName")
        .and_then(Value::as_str)
        .or_else(|| {
            version
                .normalized_manifest_json
                .get("displayName")
                .and_then(Value::as_str)
        })
        .unwrap_or("plugin")
        .to_string();
    let runtime = &version.runtime_json;
    let tier = runtime
        .get("tier")
        .and_then(Value::as_str)
        .or_else(|| original.get("tier").and_then(Value::as_str))
        .unwrap_or("process")
        .to_string();
    let entry = original
        .get("entry")
        .cloned()
        .or_else(|| runtime.get("entry").cloned())
        .unwrap_or_else(|| json!({ "kind": "node", "path": "" }));
    let manifest_json = original.to_string();
    let contributions = original
        .get("contributions")
        .cloned()
        .unwrap_or_else(|| json!({ "filters": [] }));
    let contributions_json = legacy_contributions_json(&contributions);
    let requested = original
        .get("permissions")
        .cloned()
        .or_else(|| {
            version
                .normalized_manifest_json
                .get("requestedPermissions")
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    if !requested.is_array() {
        return Err(StorageError::InvalidData(
            "stored plugin permissions are not an array".to_string(),
        ));
    }
    Ok((
        display_name,
        tier,
        entry.to_string(),
        manifest_json,
        contributions_json,
        requested.to_string(),
    ))
}

fn to_u64_i64(value: i64) -> Result<u64> {
    u64::try_from(value)
        .map_err(|_| StorageError::InvalidData("negative integer in plugin row".into()))
}

fn map_plugin_row(row: &Row<'_>) -> rusqlite::Result<PluginInstallationRecord> {
    let tier = match row.get::<_, String>(3)?.as_str() {
        "declarative" => PluginTier::Declarative,
        "sandbox" => PluginTier::Sandbox,
        "process" => PluginTier::Process,
        other => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                Box::new(StorageError::InvalidData(format!("unknown tier {other}"))),
            ));
        }
    };
    let status = PluginStatus::parse(&row.get::<_, String>(4)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let requested: Vec<String> = read_json(row, 9)?;
    let granted: Vec<String> = read_json(row, 10)?;
    let entry_value: Value = read_json(row, 6)?;
    let manifest_value: Value = read_json(row, 7)?;
    let contributions_value: Value = read_json(row, 8)?;
    let runtime_json: Value = read_json(row, 18)?;
    let normalized_manifest_json: Value = read_json(row, 19)?;
    let compatibility_json: Value = read_json(row, 20)?;
    let diagnostics_json: Value = read_json(row, 21)?;
    let entry = serde_json::from_value::<PluginEntry>(entry_value.clone()).unwrap_or_else(|_| {
        entry_from_runtime(&runtime_json).unwrap_or(PluginEntry {
            kind: translunar_plugin_runtime::PluginEntryKind::Node,
            path: String::new(),
        })
    });
    let contributions = serde_json::from_value::<PluginContributions>(contributions_value.clone())
        .unwrap_or_else(|_| contributions_from_normalized(&normalized_manifest_json));
    let manifest =
        serde_json::from_value::<PluginManifest>(manifest_value.clone()).unwrap_or_else(|_| {
            manifest_from_projection(
                row,
                &tier,
                &entry,
                &contributions,
                &requested,
                &normalized_manifest_json,
            )
        });
    Ok(PluginInstallationRecord {
        id: row.get(0)?,
        display_name: row.get(1)?,
        version: row.get(2)?,
        tier,
        status,
        package_path: PathBuf::from(row.get::<_, String>(5)?),
        entry,
        manifest,
        contributions,
        requested_permissions: requested,
        granted_permissions: granted,
        last_error: row.get(11)?,
        crash_count: to_u32(row.get::<_, i64>(12)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                12,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?,
        revision: read_u64(row, 13)?,
        installed_at_ms: row.get(14)?,
        updated_at_ms: row.get(15)?,
        active_version_id: row.get(16)?,
        package_sha256: row.get(17)?,
        runtime_json,
        normalized_manifest_json,
        compatibility_json,
        diagnostics_json,
        source_kind: parse_source_kind_row(row, 22)?,
        distribution: optional_distribution_row(row, 23)?,
    })
}

fn entry_from_runtime(runtime: &Value) -> Option<PluginEntry> {
    let entry = runtime.get("entry")?;
    let kind = entry.get("kind")?.as_str()?;
    let path = entry
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let kind = match kind {
        "node" => translunar_plugin_runtime::PluginEntryKind::Node,
        "executable" => translunar_plugin_runtime::PluginEntryKind::Executable,
        _ => return None,
    };
    Some(PluginEntry {
        kind,
        path: path.to_string(),
    })
}

fn contributions_from_normalized(normalized: &Value) -> PluginContributions {
    let filters = normalized
        .get("contributions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|value| value.get("kind").and_then(Value::as_str) == Some("filter"))
        .filter_map(|value| {
            Some(translunar_plugin_runtime::PluginFilterContribution {
                id: value.get("id")?.as_str()?.to_string(),
                version: value.get("version")?.as_str()?.to_string(),
                display_name: value.get("displayName")?.as_str()?.to_string(),
                extensions: serde_json::from_value(value.get("extensions")?.clone()).ok()?,
                capabilities: serde_json::from_value(value.get("capabilities")?.clone()).ok()?,
            })
        })
        .collect();
    PluginContributions { filters }
}

fn manifest_from_projection(
    row: &Row<'_>,
    tier: &PluginTier,
    entry: &PluginEntry,
    contributions: &PluginContributions,
    requested: &[String],
    normalized: &Value,
) -> PluginManifest {
    let host_api = normalized
        .get("hostApi")
        .cloned()
        .and_then(|value| {
            serde_json::from_value::<translunar_plugin_runtime::PluginApiRange>(value).ok()
        })
        .unwrap_or(translunar_plugin_runtime::PluginApiRange { min: 1, max: 1 });
    PluginManifest {
        manifest_version: normalized
            .get("sourceManifestVersion")
            .and_then(Value::as_u64)
            .unwrap_or(1) as u32,
        id: row.get(0).unwrap_or_default(),
        display_name: row.get(1).unwrap_or_default(),
        version: row.get(2).unwrap_or_default(),
        api_version: host_api.max,
        api_version_min: host_api.min,
        tier: *tier,
        entry: entry.clone(),
        contributions: contributions.clone(),
        permissions: requested.to_vec(),
        capabilities: Vec::new(),
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn map_ai_action_invocation_row(row: &Row<'_>) -> rusqlite::Result<PluginAiActionInvocationRecord> {
    let usage_json: String = row.get(9)?;
    let usage: PluginAiActionUsageRecord = serde_json::from_str(&usage_json).map_err(|error| {
        conversion_error(
            9,
            StorageError::InvalidData(format!("invalid AI action usage payload: {error}")),
        )
    })?;
    let status = PluginAiActionInvocationStatus::parse(&row.get::<_, String>(6)?)
        .map_err(|error| conversion_error(6, error))?;
    Ok(PluginAiActionInvocationRecord {
        id: row.get(0)?,
        plugin_id: row.get(1)?,
        version_id: row.get(2)?,
        activation_revision: read_u64(row, 3)?,
        contribution_id: row.get(4)?,
        contribution_version: row.get(5)?,
        status,
        failure_code: row.get(7)?,
        canonical_sha256: row.get(8)?,
        usage,
        created_at_ms: row.get(10)?,
    })
}

// Keep conversion_error referenced for row mapping helpers consistency.
#[allow(dead_code)]
fn _conversion_anchor(column: usize) -> rusqlite::Error {
    conversion_error(column, StorageError::InvalidData("anchor".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use translunar_filter_core::FilterCapabilities;
    use translunar_plugin_runtime::{
        PluginContributions, PluginEntryKind, PluginFilterContribution,
    };

    fn manifest() -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            id: "example.crash-cas".to_string(),
            display_name: "Crash CAS".to_string(),
            version: "0.1.0".to_string(),
            api_version: 1,
            api_version_min: 1,
            tier: PluginTier::Process,
            entry: PluginEntry {
                kind: PluginEntryKind::Node,
                path: "entry.mjs".to_string(),
            },
            contributions: PluginContributions {
                filters: vec![PluginFilterContribution {
                    id: "example.crash-cas".to_string(),
                    version: "0.1.0".to_string(),
                    display_name: "Crash CAS".to_string(),
                    extensions: vec!["cas".to_string()],
                    capabilities: FilterCapabilities {
                        import: true,
                        export: false,
                        validate: false,
                        inline_tags: false,
                        notes: false,
                        degradation_report: false,
                    },
                }],
            },
            permissions: vec!["file.read:source".to_string()],
            capabilities: Vec::new(),
        }
    }

    #[test]
    fn crash_transition_is_guarded_by_enabled_activation_revision() {
        let directory = tempdir().expect("data directory");
        let mut store = Store::open(directory.path()).expect("open store");
        let installed = store
            .upsert_plugin_installation(UpsertPluginInstallation {
                manifest: manifest(),
                package_path: directory.path().join("plugins/example.crash-cas"),
                status: PluginStatus::Installed,
                granted_permissions: vec!["file.read:source".to_string()],
                last_error: None,
            })
            .expect("install row");
        let enabled = store
            .set_plugin_status(
                &installed.id,
                PluginStatus::Enabled,
                Some(installed.revision),
                None,
            )
            .expect("enable row");

        let degraded = store
            .record_plugin_crash(&enabled.id, enabled.revision, "first crash")
            .expect("record crash")
            .expect("matching activation updates");
        assert_eq!(degraded.status, PluginStatus::Degraded);
        assert_eq!(degraded.crash_count, 1);

        assert!(
            store
                .record_plugin_crash(&enabled.id, enabled.revision, "duplicate crash")
                .expect("stale crash is ignored")
                .is_none()
        );
        let reenabled = store
            .set_plugin_status(
                &degraded.id,
                PluginStatus::Enabled,
                Some(degraded.revision),
                None,
            )
            .expect("re-enable row");
        assert!(
            store
                .record_plugin_crash(&reenabled.id, enabled.revision, "old activation")
                .expect("old activation is ignored")
                .is_none()
        );
        let disabled = store
            .set_plugin_status(
                &reenabled.id,
                PluginStatus::Disabled,
                Some(reenabled.revision),
                None,
            )
            .expect("disable row");
        assert!(
            store
                .record_plugin_crash(&disabled.id, reenabled.revision, "after disable")
                .expect("disabled activation is ignored")
                .is_none()
        );
        let current = store
            .get_plugin_installation(&disabled.id)
            .expect("current row");
        assert_eq!(current.status, PluginStatus::Disabled);
        assert_eq!(current.crash_count, 1);
        assert_eq!(current.last_error, None);
    }

    fn version_input(plugin_id: &str, version: &str, id: &str) -> NewPluginVersion {
        let original = json!({
            "manifestVersion": 1,
            "id": plugin_id,
            "displayName": "Version fixture",
            "version": version,
            "apiVersion": 1,
            "apiVersionMin": 1,
            "tier": "process",
            "entry": { "kind": "node", "path": "entry.mjs" },
            "contributions": { "filters": [] },
            "permissions": []
        });
        NewPluginVersion {
            id: id.to_string(),
            plugin_id: plugin_id.to_string(),
            display_name: "Version fixture".to_string(),
            version: version.to_string(),
            tier: PluginTier::Process,
            entry_json: json!({ "kind": "node", "path": "entry.mjs" }),
            original_manifest_json: original.clone(),
            requested_permissions: Vec::new(),
            granted_permissions: Vec::new(),
            package_sha256: Some("a".repeat(64)),
            package_path: PathBuf::from(format!("plugins/{plugin_id}/{version}")),
            managed_package_path: Some(PathBuf::from(format!("plugins/{plugin_id}/{version}"))),
            manifest_version: 1,
            runtime_json: json!({
                "tier": "process",
                "runtimeVersion": 1,
                "protocolVersion": 1,
                "entry": { "kind": "node", "path": "entry.mjs" }
            }),
            normalized_manifest_json: json!({
                "normalizedVersion": 1,
                "sourceManifestVersion": 1,
                "id": plugin_id,
                "displayName": "Version fixture",
                "version": version,
                "hostApi": { "min": 1, "max": 1 },
                "runtime": {
                    "tier": "process",
                    "runtimeVersion": 1,
                    "protocolVersion": 1,
                    "entry": { "kind": "node", "path": "entry.mjs" }
                },
                "contributions": [],
                "requestedPermissions": [],
                "originalManifestJson": original
            }),
            contributions_json: json!({ "filters": [] }),
            compatibility_json: json!({ "compatible": true }),
            diagnostics_json: json!([]),
            state: PluginVersionState::Validated,
            installed_at_ms: 10,
            source_kind: PluginPackageSourceKind::LocalDirectory,
            distribution: None,
        }
    }

    #[test]
    fn version_history_cas_idempotence_failure_and_rollback_are_atomic() {
        let directory = tempdir().expect("data directory");
        let mut store = Store::open(directory.path()).expect("open store");
        let installed = store
            .upsert_plugin_installation(UpsertPluginInstallation {
                manifest: manifest(),
                package_path: directory.path().join("plugins/example.crash-cas"),
                status: PluginStatus::Installed,
                granted_permissions: vec!["file.read:source".to_string()],
                last_error: None,
            })
            .expect("install fixture");
        let (versions, total) = store
            .list_plugin_versions(&installed.id, 0, 20)
            .expect("list seeded version");
        assert_eq!(total, 1);
        assert_eq!(versions.len(), 1);
        let legacy_id = versions[0].id.clone();

        let candidate = version_input(&installed.id, "0.2.0", "candidate-0.2.0");
        let activated = store
            .cas_activate_plugin_version(
                &installed.id,
                installed.revision,
                candidate.clone(),
                PluginStatus::Enabled,
            )
            .expect("activate candidate");
        assert_eq!(activated.installation.revision, installed.revision + 1);
        assert_eq!(
            activated.installation.active_version_id.as_deref(),
            Some("candidate-0.2.0")
        );
        assert_eq!(
            activated.previous_version_id.as_deref(),
            Some(legacy_id.as_str())
        );

        let idempotent = store
            .cas_activate_plugin_version(
                &installed.id,
                activated.installation.revision,
                candidate,
                PluginStatus::Enabled,
            )
            .expect("same candidate is idempotent");
        assert_eq!(
            idempotent.installation.revision,
            activated.installation.revision
        );

        let mut failed_input = version_input(&installed.id, "0.3.0", "candidate-0.3.0");
        failed_input.package_sha256 = Some("b".repeat(64));
        let failed = store
            .insert_plugin_version(failed_input)
            .expect("insert failed candidate inventory");
        let failed = store
            .mark_plugin_version_failed(
                &installed.id,
                &failed.id,
                json!([{ "code": "probe_failed", "message": "fixture" }]),
            )
            .expect("retain failed candidate");
        assert_eq!(failed.state, PluginVersionState::Failed);
        assert_eq!(
            store
                .get_plugin_installation(&installed.id)
                .expect("active remains")
                .active_version_id
                .as_deref(),
            Some("candidate-0.2.0")
        );

        let stale = store.cas_activate_plugin_version(
            &installed.id,
            installed.revision,
            version_input(&installed.id, "0.4.0", "candidate-0.4.0"),
            PluginStatus::Enabled,
        );
        assert!(matches!(stale, Err(StorageError::EntityConflict { .. })));

        let rolled_back = store
            .rollback_plugin_version(&installed.id, idempotent.installation.revision, &legacy_id)
            .expect("rollback to legacy version");
        assert_eq!(
            rolled_back.installation.revision,
            idempotent.installation.revision + 1
        );
        assert_eq!(
            rolled_back.installation.active_version_id.as_deref(),
            Some(legacy_id.as_str())
        );
        assert_eq!(
            store
                .list_plugin_versions(&installed.id, 0, 20)
                .expect("history")
                .1,
            3
        );
    }

    #[test]
    fn reopening_missing_legacy_package_keeps_row_with_bounded_diagnostic() {
        let directory = tempdir().expect("data directory");
        let package_path = directory.path().join("plugins/missing-plugin");
        let mut store = Store::open(directory.path()).expect("open store");
        let installed = store
            .upsert_plugin_installation(UpsertPluginInstallation {
                manifest: manifest(),
                package_path: package_path.clone(),
                status: PluginStatus::Enabled,
                granted_permissions: vec!["file.read:source".to_string()],
                last_error: None,
            })
            .expect("insert missing package");
        drop(store);

        let reopened = Store::open(directory.path()).expect("reopen store");
        let current = reopened
            .get_plugin_installation(&installed.id)
            .expect("missing row retained");
        assert_eq!(current.status, PluginStatus::Enabled);
        assert_eq!(current.revision, installed.revision);
        assert_eq!(current.package_path, package_path);
        assert_eq!(current.compatibility_json["compatible"], false);
        assert_eq!(current.diagnostics_json[0]["code"], "package_missing");
        assert!(current.diagnostics_json.to_string().len() <= 1024);
    }

    #[test]
    fn managed_package_normalization_uses_runtime_hash_and_is_reopen_idempotent() {
        let directory = tempdir().expect("data directory");
        let package_path = directory.path().join("plugins/hash-plugin");
        std::fs::create_dir_all(&package_path).expect("create managed package");
        let package_manifest = manifest();
        std::fs::write(
            package_path.join("manifest.json"),
            serde_json::to_vec(&package_manifest).expect("serialize package manifest"),
        )
        .expect("write package manifest");
        std::fs::write(package_path.join("entry.mjs"), b"console.log('hash');")
            .expect("write package entry");

        let mut store = Store::open(directory.path()).expect("open store");
        let installed = store
            .upsert_plugin_installation(UpsertPluginInstallation {
                manifest: package_manifest,
                package_path: package_path.clone(),
                status: PluginStatus::Installed,
                granted_permissions: vec!["file.read:source".to_string()],
                last_error: None,
            })
            .expect("insert managed package");
        let expected_hash = translunar_plugin_runtime::hash_plugin_package(&package_path)
            .expect("hash managed package")
            .sha256;
        assert_eq!(
            installed.package_sha256.as_deref(),
            Some(expected_hash.as_str())
        );
        drop(store);

        let reopened = Store::open(directory.path()).expect("reopen store");
        let current = reopened
            .get_plugin_installation(&installed.id)
            .expect("read normalized package");
        assert_eq!(
            current.package_sha256.as_deref(),
            Some(expected_hash.as_str())
        );
        assert_eq!(current.diagnostics_json, json!([]));
        assert_eq!(current.compatibility_json["compatible"], true);
        let (versions, total) = reopened
            .list_plugin_versions(&installed.id, 0, 20)
            .expect("read version history");
        assert_eq!(total, 1);
        assert_eq!(
            versions[0].package_sha256.as_deref(),
            Some(expected_hash.as_str())
        );
        assert_eq!(versions[0].state, PluginVersionState::Validated);

        std::fs::write(package_path.join("entry.mjs"), b"tampered")
            .expect("tamper managed package for guard");
        drop(reopened);
        let tampered = Store::open(directory.path()).expect("reopen tampered package");
        let tampered_summary = tampered
            .get_plugin_installation(&installed.id)
            .expect("read tampered summary");
        assert_eq!(tampered_summary.revision, installed.revision);
        assert_eq!(
            tampered_summary.package_sha256.as_deref(),
            Some(expected_hash.as_str())
        );
        assert_eq!(
            tampered_summary.compatibility_json["reason"],
            "package_hash_changed"
        );
        assert_eq!(
            tampered
                .get_plugin_version(&installed.id, &versions[0].id)
                .expect("read tampered version")
                .diagnostics_json[0]["code"],
            "package_hash_changed"
        );
    }

    #[test]
    fn quarantine_uninstall_preserves_bytes_until_cleanup_after_cas_delete() {
        let directory = tempdir().expect("data directory");
        let package_path = directory.path().join("plugins/quarantine-plugin");
        std::fs::create_dir_all(&package_path).expect("create package");
        let package_manifest = manifest();
        std::fs::write(
            package_path.join("manifest.json"),
            serde_json::to_vec(&package_manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        std::fs::write(package_path.join("entry.mjs"), b"quarantine").expect("write entry");
        let mut store = Store::open(directory.path()).expect("open store");
        let installed = store
            .upsert_plugin_installation(UpsertPluginInstallation {
                manifest: package_manifest,
                package_path: package_path.clone(),
                status: PluginStatus::Installed,
                granted_permissions: Vec::new(),
                last_error: None,
            })
            .expect("install package");
        let quarantine = store
            .quarantine_and_uninstall_plugin(&installed.id, Some(installed.revision))
            .expect("quarantine and uninstall");
        assert!(quarantine.is_dir());
        assert!(quarantine.join("entry.mjs").is_file());
        assert!(!package_path.exists());
        assert!(matches!(
            store.get_plugin_installation(&installed.id),
            Err(StorageError::NotFound { .. })
        ));
        std::fs::remove_dir_all(&quarantine).expect("cleanup quarantine");
    }
}
