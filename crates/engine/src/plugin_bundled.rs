//! Offline bundled-plugin catalog loaded from a trusted Engine root.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use translunar_plugin_runtime::PluginPackageSourceKind;
use translunar_protocol::{
    PluginBundledApplyAction, PluginBundledApplyParams, PluginBundledApplyResult,
    PluginBundledInstallState, PluginBundledListParams, PluginBundledPage, PluginBundledSummary,
    PluginDiagnostic, PluginDiagnosticSeverity, PluginInstallParams, PluginLifecycleAction,
    PluginTier as WirePluginTier, PluginUpgradeParams,
};

use crate::plugin::to_summary;
use crate::{EngineError, EngineService, Result};

pub const BUNDLED_INDEX_FILE: &str = "index.json";
pub const BUNDLED_CATALOG_VERSION: u32 = 1;
const MAX_INDEX_BYTES: u64 = 256 * 1024;
const MAX_CATALOG_ENTRIES: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BundledCatalogIndex {
    catalog_version: u32,
    packages: Vec<BundledCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundledCatalogEntry {
    pub plugin_id: String,
    pub display_name: String,
    pub version: String,
    pub tier: String,
    pub archive: String,
    pub package_sha256: String,
    pub archive_sha256: String,
    pub publisher: String,
    pub license: String,
    #[serde(default)]
    pub homepage: Option<String>,
    pub contribution_count: u32,
}

#[derive(Debug, Clone)]
pub struct BundledCatalog {
    root: PathBuf,
    entries: Vec<BundledCatalogEntry>,
    diagnostics: Vec<PluginDiagnostic>,
    available: bool,
}

impl BundledCatalog {
    /// Load and verify a closed catalog. Missing or corrupt roots degrade only
    /// the catalog surface — callers treat `available = false` as empty.
    pub fn load(root: Option<&Path>) -> Self {
        let Some(root) = root else {
            return Self {
                root: PathBuf::new(),
                entries: Vec::new(),
                diagnostics: Vec::new(),
                available: false,
            };
        };
        match load_catalog(root) {
            Ok(catalog) => catalog,
            Err(diagnostic) => Self {
                root: root.to_path_buf(),
                entries: Vec::new(),
                diagnostics: vec![diagnostic],
                available: false,
            },
        }
    }

    pub fn available(&self) -> bool {
        self.available
    }

    pub fn diagnostics(&self) -> &[PluginDiagnostic] {
        &self.diagnostics
    }

    pub fn resolve_archive(&self, plugin_id: &str) -> Result<(PathBuf, BundledCatalogEntry)> {
        if !self.available {
            return Err(EngineError::InvalidState(
                "bundled plugin catalog is unavailable".to_string(),
            ));
        }
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.plugin_id == plugin_id)
            .cloned()
            .ok_or_else(|| {
                EngineError::InvalidRequest(format!("bundled plugin not found: {plugin_id}"))
            })?;
        let archive = self.root.join(&entry.archive);
        verify_archive_hash(&archive, &entry.archive_sha256)?;
        Ok((archive, entry))
    }
}

fn load_catalog(root: &Path) -> std::result::Result<BundledCatalog, PluginDiagnostic> {
    let meta = fs::symlink_metadata(root).map_err(|_| {
        catalog_error(
            "bundled_catalog_unavailable",
            "bundled plugin root is unavailable",
        )
    })?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(catalog_error(
            "bundled_catalog_invalid",
            "bundled plugin root must be a regular directory",
        ));
    }
    let index_path = root.join(BUNDLED_INDEX_FILE);
    let index_meta = fs::symlink_metadata(&index_path).map_err(|_| {
        catalog_error(
            "bundled_catalog_missing_index",
            "bundled catalog index is missing",
        )
    })?;
    if !index_meta.is_file() || index_meta.file_type().is_symlink() {
        return Err(catalog_error(
            "bundled_catalog_invalid_index",
            "bundled catalog index must be a regular file",
        ));
    }
    if index_meta.len() > MAX_INDEX_BYTES {
        return Err(catalog_error(
            "bundled_catalog_index_too_large",
            "bundled catalog index exceeds size limit",
        ));
    }
    let mut bytes = Vec::new();
    File::open(&index_path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|_| {
            catalog_error(
                "bundled_catalog_index_unreadable",
                "bundled catalog index cannot be read",
            )
        })?;
    let index: BundledCatalogIndex = serde_json::from_slice(&bytes).map_err(|_| {
        catalog_error(
            "bundled_catalog_index_invalid",
            "bundled catalog index is malformed",
        )
    })?;
    if index.catalog_version != BUNDLED_CATALOG_VERSION {
        return Err(catalog_error(
            "bundled_catalog_unsupported",
            "bundled catalog version is unsupported",
        ));
    }
    if index.packages.len() > MAX_CATALOG_ENTRIES {
        return Err(catalog_error(
            "bundled_catalog_too_large",
            "bundled catalog exceeds entry limit",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut verified = Vec::new();
    for entry in index.packages {
        if !seen.insert(entry.plugin_id.clone()) {
            return Err(catalog_error(
                "bundled_catalog_duplicate",
                "bundled catalog contains duplicate plugin ids",
            ));
        }
        if entry.archive.contains("..")
            || entry.archive.contains('\\')
            || entry.archive.starts_with('/')
            || entry.archive.contains(':')
        {
            return Err(catalog_error(
                "bundled_catalog_unsafe_archive",
                "bundled catalog archive path is unsafe",
            ));
        }
        let archive = root.join(&entry.archive);
        if verify_archive_hash(&archive, &entry.archive_sha256).is_err() {
            return Err(catalog_error(
                "bundled_catalog_hash_mismatch",
                "bundled catalog archive hash verification failed",
            ));
        }
        verified.push(entry);
    }
    Ok(BundledCatalog {
        root: root.to_path_buf(),
        entries: verified,
        diagnostics: Vec::new(),
        available: true,
    })
}

fn verify_archive_hash(path: &Path, expected: &str) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|error| {
        EngineError::InvalidState(format!("bundled archive unavailable: {error}"))
    })?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(EngineError::InvalidState(
            "bundled archive must be a regular file".to_string(),
        ));
    }
    let mut file = File::open(path).map_err(|error| {
        EngineError::InvalidState(format!("cannot open bundled archive: {error}"))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| EngineError::InvalidState(format!("cannot hash archive: {error}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        return Err(EngineError::PluginPackageHashMismatch(
            "bundled archive hash mismatch".to_string(),
        ));
    }
    Ok(())
}

fn catalog_error(code: &str, message: &str) -> PluginDiagnostic {
    PluginDiagnostic {
        code: code.to_string(),
        message: message.to_string(),
        severity: Some(PluginDiagnosticSeverity::Warning),
        phase: Some("bundled.catalog".to_string()),
    }
}

fn parse_tier(value: &str) -> WirePluginTier {
    match value {
        "declarative" => WirePluginTier::Declarative,
        "sandbox" => WirePluginTier::Sandbox,
        _ => WirePluginTier::Process,
    }
}

/// If `source` lives under the configured bundled root, provenance is `bundled`.
pub(crate) fn classify_source_kind(
    source: &Path,
    bundled_root: Option<&Path>,
    detected: PluginPackageSourceKind,
) -> PluginPackageSourceKind {
    let Some(root) = bundled_root else {
        return detected;
    };
    let Ok(canonical_source) = source.canonicalize() else {
        return detected;
    };
    let Ok(canonical_root) = root.canonicalize() else {
        return detected;
    };
    if canonical_source.starts_with(&canonical_root) {
        PluginPackageSourceKind::Bundled
    } else {
        detected
    }
}

impl EngineService {
    pub fn list_bundled_plugins(
        &self,
        params: PluginBundledListParams,
    ) -> Result<PluginBundledPage> {
        let limit = params.limit.clamp(1, 200);
        let offset = params.offset;
        let catalog = BundledCatalog::load(self.bundled_plugin_root.as_deref());
        if !catalog.available() {
            return Ok(PluginBundledPage {
                items: Vec::new(),
                total: 0,
                offset,
                limit,
                catalog_available: false,
                diagnostics: catalog.diagnostics().to_vec(),
            });
        }
        let mut items = Vec::new();
        for entry in &catalog.entries {
            let installed = self.store.get_plugin_installation(&entry.plugin_id).ok();
            let install_state = match &installed {
                None => PluginBundledInstallState::Available,
                Some(record)
                    if record.package_sha256.as_deref() == Some(entry.package_sha256.as_str())
                        && record.version == entry.version =>
                {
                    PluginBundledInstallState::Current
                }
                Some(_) => PluginBundledInstallState::UpdateAvailable,
            };
            items.push(PluginBundledSummary {
                plugin_id: entry.plugin_id.clone(),
                display_name: entry.display_name.clone(),
                version: entry.version.clone(),
                tier: parse_tier(&entry.tier),
                package_sha256: entry.package_sha256.clone(),
                archive_sha256: entry.archive_sha256.clone(),
                publisher: entry.publisher.clone(),
                license: entry.license.clone(),
                homepage: entry.homepage.clone(),
                contribution_count: entry.contribution_count,
                install_state,
                installed_version: installed.as_ref().map(|row| row.version.clone()),
                installed_package_sha256: installed.and_then(|row| row.package_sha256),
            });
        }
        let total = items.len() as u32;
        let start = offset.min(total) as usize;
        let end = (start + limit as usize).min(items.len());
        Ok(PluginBundledPage {
            items: items[start..end].to_vec(),
            total,
            offset,
            limit,
            catalog_available: true,
            diagnostics: catalog.diagnostics().to_vec(),
        })
    }

    pub fn apply_bundled_plugin(
        &mut self,
        params: PluginBundledApplyParams,
    ) -> Result<PluginBundledApplyResult> {
        let (archive, entry) = {
            let catalog = BundledCatalog::load(self.bundled_plugin_root.as_deref());
            catalog.resolve_archive(&params.plugin_id)?
        };
        match self.store.get_plugin_installation(&entry.plugin_id) {
            Ok(current) => {
                if current.package_sha256.as_deref() == Some(entry.package_sha256.as_str())
                    && current.version == entry.version
                {
                    let active_version_id = current.active_version_id.clone();
                    return Ok(PluginBundledApplyResult {
                        plugin: to_summary(current),
                        action: PluginBundledApplyAction::Unchanged,
                        active_version_id,
                        previous_version_id: None,
                    });
                }
                let expected = params.expected_revision.unwrap_or(current.revision);
                let result = self.upgrade_plugin(PluginUpgradeParams {
                    plugin_id: entry.plugin_id.clone(),
                    source_path: archive.to_string_lossy().into_owned(),
                    expected_revision: expected,
                    actor: params.actor,
                    reason: params.reason,
                })?;
                Ok(PluginBundledApplyResult {
                    plugin: result.plugin,
                    action: match result.action {
                        PluginLifecycleAction::Upgraded | PluginLifecycleAction::RolledBack => {
                            PluginBundledApplyAction::Upgraded
                        }
                    },
                    active_version_id: Some(result.active_version_id),
                    previous_version_id: result.previous_version_id,
                })
            }
            Err(translunar_storage::StorageError::NotFound { .. }) => {
                let installed = self.install_plugin(PluginInstallParams {
                    source_path: archive.to_string_lossy().into_owned(),
                    grant_requested: false,
                    actor: params.actor,
                    reason: params.reason,
                })?;
                let active_version_id = installed.plugin.active_version_id.clone();
                Ok(PluginBundledApplyResult {
                    plugin: installed.plugin,
                    action: PluginBundledApplyAction::Installed,
                    active_version_id,
                    previous_version_id: None,
                })
            }
            Err(error) => Err(error.into()),
        }
    }
}
