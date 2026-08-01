//! Offline bundled-plugin catalog loaded from a trusted Engine root.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use translunar_plugin_runtime::{
    MAX_ARCHIVE_BYTES, PluginPackageSourceKind, TLPLUGIN_EXTENSION, materialize_plugin_package,
    remove_package, validate_release_package_requirements, verify_plugin_package_hash,
};
use translunar_protocol::{
    PluginBundledApplyAction, PluginBundledApplyParams, PluginBundledApplyResult,
    PluginBundledInstallState, PluginBundledListParams, PluginBundledPage, PluginBundledSummary,
    PluginDiagnostic, PluginDiagnosticSeverity, PluginInstallParams, PluginLifecycleAction,
    PluginTier as WirePluginTier, PluginUpgradeParams,
};

use crate::plugin::{resolve_managed_path, to_summary};
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
    pub fn load(root: Option<&Path>, staging_root: &Path) -> Self {
        let Some(root) = root else {
            return Self {
                root: PathBuf::new(),
                entries: Vec::new(),
                diagnostics: Vec::new(),
                available: false,
            };
        };
        match load_catalog(root, staging_root) {
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

fn load_catalog(
    root: &Path,
    staging_root: &Path,
) -> std::result::Result<BundledCatalog, PluginDiagnostic> {
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
    let mut seen_archives = std::collections::BTreeSet::new();
    let mut verified = Vec::new();
    for entry in index.packages {
        if !seen.insert(entry.plugin_id.clone()) {
            return Err(catalog_error(
                "bundled_catalog_duplicate",
                "bundled catalog contains duplicate plugin ids",
            ));
        }
        let archive_path = Path::new(&entry.archive);
        if entry.archive.is_empty()
            || !is_sha256(&entry.package_sha256)
            || !is_sha256(&entry.archive_sha256)
            || !entry
                .archive
                .to_ascii_lowercase()
                .ends_with(TLPLUGIN_EXTENSION)
            || archive_path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
            || archive_path.is_absolute()
            || archive_path
                .components()
                .any(|component| matches!(component, Component::Prefix(_) | Component::RootDir))
            || !seen_archives.insert(entry.archive.clone())
        {
            return Err(catalog_error(
                "bundled_catalog_unsafe_archive",
                "bundled catalog archive path is unsafe",
            ));
        }
        let archive = root.join(&entry.archive);
        let archive_meta = match fs::symlink_metadata(&archive) {
            Ok(meta) => meta,
            Err(_) => {
                return Err(catalog_error(
                    "bundled_catalog_archive_missing",
                    "bundled catalog archive is missing",
                ));
            }
        };
        if archive_meta.len() > MAX_ARCHIVE_BYTES {
            return Err(catalog_error(
                "bundled_catalog_archive_too_large",
                "bundled catalog archive exceeds size limit",
            ));
        }
        if verify_archive_hash(&archive, &entry.archive_sha256).is_err() {
            return Err(catalog_error(
                "bundled_catalog_hash_mismatch",
                "bundled catalog archive hash verification failed",
            ));
        }
        if !validate_catalog_archive(&archive, &entry, staging_root) {
            return Err(catalog_error(
                "bundled_catalog_manifest_mismatch",
                "bundled catalog archive metadata does not match its index",
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
    let mut total = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| EngineError::InvalidState(format!("cannot hash archive: {error}")))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_ARCHIVE_BYTES {
            return Err(EngineError::InvalidState(
                "bundled archive exceeds compressed byte limit".to_string(),
            ));
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

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_catalog_archive(
    archive: &Path,
    entry: &BundledCatalogEntry,
    staging_root: &Path,
) -> bool {
    let staged = match materialize_plugin_package(
        archive,
        staging_root,
        Some(PluginPackageSourceKind::Bundled),
    ) {
        Ok(staged) => staged,
        Err(_) => return false,
    };
    let valid = (|| {
        validate_release_package_requirements(&staged.path).ok()?;
        if staged.package_hash.sha256 != entry.package_sha256
            || staged.normalized_manifest.id != entry.plugin_id
            || staged.normalized_manifest.display_name != entry.display_name
            || staged.normalized_manifest.version != entry.version
            || staged.normalized_manifest.contributions.len() as u32 != entry.contribution_count
        {
            return None;
        }
        let tier = match staged.normalized_manifest.runtime.tier() {
            translunar_plugin_runtime::PluginTier::Declarative => "declarative",
            translunar_plugin_runtime::PluginTier::Sandbox => "sandbox",
            translunar_plugin_runtime::PluginTier::Process => "process",
        };
        if tier != entry.tier {
            return None;
        }
        let distribution = staged.normalized_manifest.distribution.as_ref()?;
        if distribution.publisher != entry.publisher
            || distribution.license != entry.license
            || distribution.homepage != entry.homepage
        {
            return None;
        }
        Some(())
    })()
    .is_some();
    let _ = remove_package(&staged.path);
    valid
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
    // A path merely being under the resources directory is not sufficient:
    // provenance is granted only to an archive named by the verified index.
    let index_path = canonical_root.join(BUNDLED_INDEX_FILE);
    let Ok(index_bytes) = fs::read(index_path) else {
        return detected;
    };
    let Ok(index) = serde_json::from_slice::<BundledCatalogIndex>(&index_bytes) else {
        return detected;
    };
    if index.catalog_version != BUNDLED_CATALOG_VERSION {
        return detected;
    }
    if index.packages.iter().any(|entry| {
        let candidate = canonical_root.join(&entry.archive);
        candidate
            .canonicalize()
            .ok()
            .is_some_and(|path| path == canonical_source)
            && verify_archive_hash(&candidate, &entry.archive_sha256).is_ok()
    }) {
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
        let catalog = BundledCatalog::load(
            self.bundled_plugin_root.as_deref(),
            &self.store.paths().temporary.join("bundled-catalog-staging"),
        );
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
                Some(record) if semver_greater(&entry.version, &record.version) => {
                    PluginBundledInstallState::UpdateAvailable
                }
                Some(_) => PluginBundledInstallState::Installed,
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
            let catalog = BundledCatalog::load(
                self.bundled_plugin_root.as_deref(),
                &self.store.paths().temporary.join("bundled-catalog-staging"),
            );
            catalog.resolve_archive(&params.plugin_id)?
        };
        match self.store.get_plugin_installation(&entry.plugin_id) {
            Ok(current) => {
                if current.package_sha256.as_deref() == Some(entry.package_sha256.as_str())
                    && current.version == entry.version
                {
                    let managed_path = resolve_managed_path(
                        self.store.paths().root.as_path(),
                        &current.package_path,
                    );
                    verify_plugin_package_hash(&managed_path, &entry.package_sha256).map_err(
                        |_| {
                            EngineError::PluginPackageHashMismatch(
                                "installed bundled package bytes differ from recorded hash"
                                    .to_string(),
                            )
                        },
                    )?;
                    let active_version_id = current.active_version_id.clone();
                    return Ok(PluginBundledApplyResult {
                        plugin: to_summary(current),
                        action: PluginBundledApplyAction::Unchanged,
                        active_version_id,
                        previous_version_id: None,
                    });
                }
                if !semver_greater(&entry.version, &current.version) {
                    return Err(EngineError::PluginConflict(
                        "bundled package is not newer; use explicit version history rollback"
                            .to_string(),
                    ));
                }
                let expected = params.expected_revision.ok_or_else(|| {
                    EngineError::InvalidRequest(
                        "expectedRevision is required when applying a bundled update".to_string(),
                    )
                })?;
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

fn semver_greater(candidate: &str, current: &str) -> bool {
    fn parse(value: &str) -> Option<([u64; 3], Option<Vec<&str>>)> {
        let without_build = value.split_once('+').map_or(value, |(left, _)| left);
        let (core, prerelease) = without_build
            .split_once('-')
            .map_or((without_build, None), |(left, right)| (left, Some(right)));
        let parts = core
            .split('.')
            .map(str::parse::<u64>)
            .collect::<std::result::Result<Vec<_>, _>>()
            .ok()?;
        let core: [u64; 3] = parts.try_into().ok()?;
        let prerelease = match prerelease {
            None => None,
            Some(value) => {
                let identifiers = value.split('.').collect::<Vec<_>>();
                if identifiers.iter().any(|part| {
                    part.is_empty()
                        || !part
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                        || (part.len() > 1
                            && part.starts_with('0')
                            && part.chars().all(|ch| ch.is_ascii_digit()))
                }) {
                    return None;
                }
                Some(identifiers)
            }
        };
        Some((core, prerelease))
    }

    fn compare_prerelease(left: Option<&[&str]>, right: Option<&[&str]>) -> std::cmp::Ordering {
        match (left, right) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(_), None) => std::cmp::Ordering::Less,
            (Some(left), Some(right)) => {
                for (left, right) in left.iter().zip(right.iter()) {
                    let ordering = match (left.parse::<u64>(), right.parse::<u64>()) {
                        (Ok(left), Ok(right)) => left.cmp(&right),
                        (Ok(_), Err(_)) => std::cmp::Ordering::Less,
                        (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
                        (Err(_), Err(_)) => left.cmp(right),
                    };
                    if ordering != std::cmp::Ordering::Equal {
                        return ordering;
                    }
                }
                left.len().cmp(&right.len())
            }
        }
    }

    let (Some((candidate_core, candidate_pre)), Some((current_core, current_pre))) =
        (parse(candidate), parse(current))
    else {
        return false;
    };
    candidate_core
        .cmp(&current_core)
        .then_with(|| compare_prerelease(candidate_pre.as_deref(), current_pre.as_deref()))
        == std::cmp::Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::semver_greater;
    use crate::EngineService;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use translunar_protocol::{PluginBundledInstallState, PluginBundledListParams};

    #[test]
    fn bundled_updates_follow_semver_precedence() {
        assert!(semver_greater("1.0.1", "1.0.0"));
        assert!(semver_greater("1.0.0", "1.0.0-rc.1"));
        assert!(semver_greater("1.0.0-rc.2", "1.0.0-rc.1"));
        assert!(semver_greater("1.0.0-beta.11", "1.0.0-beta.2"));
        assert!(!semver_greater("1.0.0-rc.1", "1.0.0"));
        assert!(!semver_greater("1.0.0+build.2", "1.0.0+build.1"));
        assert!(!semver_greater("invalid", "1.0.0"));
    }

    fn desktop_plugins_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/resources/plugins")
            .canonicalize()
            .expect("desktop plugins catalog root")
    }

    #[test]
    fn missing_bundled_root_degrades_catalog_without_breaking_engine() {
        let data = tempdir().expect("data directory");
        let service = EngineService::open(data.path()).expect("open engine without bundled root");
        let page = service
            .list_bundled_plugins(PluginBundledListParams {
                offset: 0,
                limit: 50,
            })
            .expect("list catalog");
        assert!(!page.catalog_available);
        assert!(page.items.is_empty());
        // Ordinary local plugin list remains healthy.
        let installed = service
            .list_plugins(translunar_protocol::PluginListParams {
                offset: 0,
                limit: 50,
            })
            .expect("list installed plugins");
        assert!(installed.items.is_empty());
    }

    #[test]
    fn verified_release_catalog_lists_allowlisted_packages() {
        let data = tempdir().expect("data directory");
        let root = desktop_plugins_root();
        let service = EngineService::open_with_bundled_plugin_root(data.path(), Some(root))
            .expect("open engine with bundled root");
        let page = service
            .list_bundled_plugins(PluginBundledListParams {
                offset: 0,
                limit: 50,
            })
            .expect("list verified catalog");
        assert!(page.catalog_available, "catalog diagnostics: {:?}", page.diagnostics);
        assert_eq!(page.total, 5);
        assert!(
            page.items
                .iter()
                .all(|item| item.install_state == PluginBundledInstallState::Available)
        );
        assert!(
            page.items
                .iter()
                .any(|item| item.plugin_id == "example.tier1-toolkit")
        );
        assert!(
            page.items
                .iter()
                .all(|item| item.package_sha256.len() == 64 && item.archive_sha256.len() == 64)
        );
    }

    #[test]
    fn tampered_catalog_index_fails_closed_for_catalog_only() {
        let data = tempdir().expect("data directory");
        let source = desktop_plugins_root();
        let root = data.path().join("plugins");
        fs::create_dir_all(&root).expect("create catalog root");
        for entry in fs::read_dir(&source).expect("read source catalog") {
            let entry = entry.expect("entry");
            let dest = root.join(entry.file_name());
            fs::copy(entry.path(), &dest).expect("copy catalog artifact");
        }
        let index_path = root.join("index.json");
        let mut index: serde_json::Value =
            serde_json::from_slice(&fs::read(&index_path).expect("read index")).expect("parse index");
        index["packages"][0]["packageSha256"] =
            serde_json::Value::String("0".repeat(64));
        fs::write(
            &index_path,
            serde_json::to_vec_pretty(&index).expect("serialize tampered index"),
        )
        .expect("write tampered index");

        let service = EngineService::open_with_bundled_plugin_root(data.path(), Some(root))
            .expect("engine still opens with tampered catalog");
        let page = service
            .list_bundled_plugins(PluginBundledListParams {
                offset: 0,
                limit: 50,
            })
            .expect("degraded catalog list");
        assert!(!page.catalog_available);
        assert!(page.items.is_empty());
        assert!(!page.diagnostics.is_empty());
    }

    #[test]
    fn unlisted_or_hash_mismatched_archives_under_bundled_root_are_not_bundled() {
        use super::classify_source_kind;
        use translunar_plugin_runtime::PluginPackageSourceKind;
        use translunar_protocol::PluginInstallParams;

        let data = tempdir().expect("data directory");
        let source = desktop_plugins_root();
        let root = data.path().join("plugins");
        fs::create_dir_all(&root).expect("create catalog root");
        // Copy a single known archive into the root without listing it.
        let archive_name = "example.tier1-toolkit-1.0.0.tlplugin";
        fs::copy(source.join(archive_name), root.join(archive_name)).expect("copy archive");
        // Empty but well-formed index: archive exists on disk but is not authorized.
        fs::write(
            root.join("index.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "catalogVersion": 1,
                "packages": []
            }))
            .expect("serialize empty index"),
        )
        .expect("write empty index");

        let unlisted = root.join(archive_name);
        assert_eq!(
            classify_source_kind(
                &unlisted,
                Some(root.as_path()),
                PluginPackageSourceKind::LocalArchive
            ),
            PluginPackageSourceKind::LocalArchive,
            "unlisted archive under bundled root must not gain Bundled provenance"
        );

        // Index lists the archive filename but with a forged archive hash.
        fs::write(
            root.join("index.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "catalogVersion": 1,
                "packages": [{
                    "pluginId": "example.tier1-toolkit",
                    "displayName": "Tier 1 Toolkit",
                    "version": "1.0.0",
                    "tier": "declarative",
                    "archive": archive_name,
                    "packageSha256": "1".repeat(64),
                    "archiveSha256": "2".repeat(64),
                    "publisher": "Translunar",
                    "license": "MIT",
                    "contributionCount": 3
                }]
            }))
            .expect("serialize forged index"),
        )
        .expect("write forged index");
        assert_eq!(
            classify_source_kind(
                &unlisted,
                Some(root.as_path()),
                PluginPackageSourceKind::LocalArchive
            ),
            PluginPackageSourceKind::LocalArchive,
            "hash-mismatched catalog entry must not grant Bundled provenance"
        );

        // Install still works as a local archive; host-derived kind stays local.
        let mut service =
            EngineService::open_with_bundled_plugin_root(data.path(), Some(root.clone()))
                .expect("engine opens with forged catalog");
        // Catalog itself fails closed (hash mismatch during load).
        let page = service
            .list_bundled_plugins(PluginBundledListParams {
                offset: 0,
                limit: 10,
            })
            .expect("list");
        assert!(!page.catalog_available);

        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: unlisted.to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".into(),
                reason: "spoofed bundled path install".into(),
            })
            .expect("local install of unlisted archive still works")
            .plugin;
        assert_eq!(installed.source_kind, PluginPackageSourceKind::LocalArchive);
        assert_ne!(installed.source_kind, PluginPackageSourceKind::Bundled);
    }

    #[test]
    fn local_directory_install_never_inherits_bundled_provenance() {
        use translunar_plugin_runtime::PluginPackageSourceKind;
        use translunar_protocol::PluginInstallParams;

        let data = tempdir().expect("data directory");
        let root = desktop_plugins_root();
        let mut service = EngineService::open_with_bundled_plugin_root(data.path(), Some(root))
            .expect("open with real catalog");
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/plugins/tier1-toolkit")
            .canonicalize()
            .expect("tier1 source");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: source.to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".into(),
                reason: "directory install beside bundled root".into(),
            })
            .expect("install local directory")
            .plugin;
        assert_eq!(
            installed.source_kind,
            PluginPackageSourceKind::LocalDirectory,
            "host must derive LocalDirectory even when a bundled catalog is configured"
        );
    }

    #[test]
    fn inspect_plugin_uses_host_derived_source_kind_like_install() {
        use translunar_plugin_runtime::PluginPackageSourceKind;
        use translunar_protocol::PluginInspectParams;

        let data = tempdir().expect("data directory");
        let root = desktop_plugins_root();
        let service = EngineService::open_with_bundled_plugin_root(data.path(), Some(root.clone()))
            .expect("open with real catalog");

        let catalog_archive = root.join("example.hello-srt-0.1.0.tlplugin");
        assert!(
            catalog_archive.is_file(),
            "release catalog must ship hello-srt archive"
        );
        let catalog_inspect = service
            .inspect_plugin(PluginInspectParams {
                source_path: catalog_archive.to_string_lossy().into_owned(),
            })
            .expect("inspect verified catalog archive");
        assert_eq!(
            catalog_inspect.source_kind,
            PluginPackageSourceKind::Bundled,
            "inspect of indexed+hash-matched catalog archive must report Bundled"
        );

        // Same bytes outside the configured bundled root → local archive.
        let outside = data.path().join("community-copy.tlplugin");
        fs::copy(&catalog_archive, &outside).expect("copy archive outside bundled root");
        let outside_inspect = service
            .inspect_plugin(PluginInspectParams {
                source_path: outside.to_string_lossy().into_owned(),
            })
            .expect("inspect community local archive");
        assert_eq!(
            outside_inspect.source_kind,
            PluginPackageSourceKind::LocalArchive,
            "inspect of archive outside bundled root must report LocalArchive"
        );

        // Unlisted archive under a forged root must not promote to Bundled.
        let forged_root = data.path().join("forged-plugins");
        fs::create_dir_all(&forged_root).expect("forged root");
        let archive_name = "example.hello-srt-0.1.0.tlplugin";
        fs::copy(&catalog_archive, forged_root.join(archive_name)).expect("copy unlisted");
        fs::write(
            forged_root.join("index.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "catalogVersion": 1,
                "packages": []
            }))
            .expect("serialize empty index"),
        )
        .expect("write empty index");
        let forged_service =
            EngineService::open_with_bundled_plugin_root(data.path().join("forged-data"), Some(forged_root.clone()))
                .expect("open with empty catalog");
        let unlisted = forged_root.join(archive_name);
        let unlisted_inspect = forged_service
            .inspect_plugin(PluginInspectParams {
                source_path: unlisted.to_string_lossy().into_owned(),
            })
            .expect("inspect unlisted under bundled root");
        assert_eq!(
            unlisted_inspect.source_kind,
            PluginPackageSourceKind::LocalArchive,
            "unlisted archive under bundled root must not promote on inspect"
        );
    }

    #[test]
    fn invalid_release_metadata_degrades_catalog_without_breaking_local_install() {
        use translunar_plugin_runtime::{
            build_tlplugin_archive, hash_plugin_package, validate_release_package_requirements,
        };
        use translunar_protocol::PluginInstallParams;

        let data = tempdir().expect("data directory");
        let package = data.path().join("pkg");
        fs::create_dir_all(&package).expect("pkg");
        // Valid parseable package with distribution, but missing LICENSE material
        // so release packaging requirements fail closed at catalog validation.
        fs::write(
            package.join("manifest.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "manifestVersion": 2,
                "id": "example.bad-release",
                "displayName": "Bad release",
                "version": "1.0.0",
                "hostApi": {"min": 1, "max": 1},
                "runtime": {
                    "tier": "declarative",
                    "runtimeVersion": 1,
                    "entry": {"kind": "manifest"}
                },
                "contributions": [{
                    "kind": "filter",
                    "descriptorVersion": 1,
                    "id": "example.bad-release.filter",
                    "version": "1.0.0",
                    "displayName": "Bad filter",
                    "extensions": ["bad"],
                    "capabilities": {
                        "import": true, "export": true, "validate": true,
                        "inlineTags": false, "notes": false, "degradationReport": false
                    },
                    "declarative": {
                        "definitionVersion": 1,
                        "encoding": "utf8",
                        "probeHeaderPattern": "(?m)^A\\r?$",
                        "unitPattern": "(?m)^(?<id>[A-Za-z0-9_-]+)\\|(?<source>[^\\r\\n]+)$",
                        "limits": {
                            "maxSourceBytes": 1048576,
                            "maxOutputBytes": 1048576,
                            "maxUnits": 10000,
                            "maxUnitBytes": 65536,
                            "maxCaptureBytes": 256,
                            "probeHeaderBytes": 4096
                        }
                    }
                }],
                "permissions": [],
                "distribution": {
                    "publisher": "Translunar",
                    "license": "MIT"
                }
            }))
            .expect("manifest"),
        )
        .expect("write manifest");
        // No LICENSE file on purpose.
        assert!(validate_release_package_requirements(&package).is_err());

        let root = data.path().join("plugins");
        fs::create_dir_all(&root).expect("root");
        let archive = root.join("example.bad-release-1.0.0.tlplugin");
        let package_hash = hash_plugin_package(&package).expect("package hash").sha256;
        // build returns archive content hash (separate from package identity).
        let archive_sha = build_tlplugin_archive(&package, &archive).expect("build archive");
        fs::write(
            root.join("index.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "catalogVersion": 1,
                "packages": [{
                    "pluginId": "example.bad-release",
                    "displayName": "Bad release",
                    "version": "1.0.0",
                    "tier": "declarative",
                    "archive": "example.bad-release-1.0.0.tlplugin",
                    "packageSha256": package_hash,
                    "archiveSha256": archive_sha,
                    "publisher": "Translunar",
                    "license": "MIT",
                    "contributionCount": 1
                }]
            }))
            .expect("index"),
        )
        .expect("write index");

        let mut service = EngineService::open_with_bundled_plugin_root(data.path(), Some(root))
            .expect("engine still opens with invalid release catalog");
        let page = service
            .list_bundled_plugins(PluginBundledListParams {
                offset: 0,
                limit: 20,
            })
            .expect("list degraded catalog");
        assert!(!page.catalog_available);
        assert!(page.items.is_empty());
        assert!(
            page.diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code.contains("bundled_catalog"))
        );

        // Local directory install remains healthy while catalog is degraded.
        let local = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/plugins/hello-srt");
        let installed = service
            .install_plugin(PluginInstallParams {
                source_path: local.to_string_lossy().into_owned(),
                grant_requested: false,
                actor: "test".into(),
                reason: "local install under bad catalog".into(),
            })
            .expect("local install survives degraded catalog")
            .plugin;
        assert_eq!(installed.id, "example.hello-srt");
        let listed = service
            .list_plugins(translunar_protocol::PluginListParams {
                offset: 0,
                limit: 20,
            })
            .expect("list installed");
        assert_eq!(listed.total, 1);
    }

    #[test]
    fn invalid_publisher_or_license_expression_is_rejected_by_release_validation() {
        use translunar_plugin_runtime::{
            PluginDistributionMetadata, validate_release_package_requirements,
        };

        let data = tempdir().expect("data");
        let package = data.path().join("pkg");
        fs::create_dir_all(&package).expect("pkg");
        fs::write(package.join("LICENSE"), "MIT\n").expect("license");
        fs::write(
            package.join("manifest.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "manifestVersion": 2,
                "id": "example.invalid-meta",
                "displayName": "Invalid meta",
                "version": "1.0.0",
                "hostApi": {"min": 1, "max": 1},
                "runtime": {
                    "tier": "declarative",
                    "runtimeVersion": 1,
                    "entry": {"kind": "manifest"}
                },
                "contributions": [{
                    "kind": "filter",
                    "descriptorVersion": 1,
                    "id": "example.invalid-meta.filter",
                    "version": "1.0.0",
                    "displayName": "Filter",
                    "extensions": ["im"],
                    "capabilities": {
                        "import": true, "export": true, "validate": true,
                        "inlineTags": false, "notes": false, "degradationReport": false
                    },
                    "declarative": {
                        "definitionVersion": 1,
                        "encoding": "utf8",
                        "probeHeaderPattern": "(?m)^A\\r?$",
                        "unitPattern": "(?m)^(?<id>[A-Za-z0-9_-]+)\\|(?<source>[^\\r\\n]+)$",
                        "limits": {
                            "maxSourceBytes": 1048576,
                            "maxOutputBytes": 1048576,
                            "maxUnits": 10000,
                            "maxUnitBytes": 65536,
                            "maxCaptureBytes": 256,
                            "probeHeaderBytes": 4096
                        }
                    }
                }],
                "permissions": [],
                "distribution": {
                    "publisher": "Translunar",
                    "license": "MIT"
                }
            }))
            .expect("manifest"),
        )
        .expect("write");

        // Direct metadata edges used by release packaging.
        assert!(
            PluginDistributionMetadata {
                publisher: String::new(),
                license: "MIT".into(),
                homepage: None,
            }
            .validate()
            .is_err()
        );
        assert!(
            PluginDistributionMetadata {
                publisher: "Translunar".into(),
                license: "!!!not-a-license!!!".into(),
                homepage: None,
            }
            .validate()
            .is_err()
        );
        // Good package with LICENSE passes release requirements.
        validate_release_package_requirements(&package).expect("valid release package");
        // Removing LICENSE fails the release gate.
        fs::remove_file(package.join("LICENSE")).expect("remove license");
        assert!(validate_release_package_requirements(&package).is_err());
    }
}
