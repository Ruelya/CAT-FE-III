//! Closed `.tlplugin` ZIP transport: extract, validate, and stage packages.

use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::CompressionMethod;
use zip::ZipArchive;

use crate::{
    MAX_PACKAGE_DEPTH, MAX_PACKAGE_FILES, MAX_PACKAGE_PATH_BYTES, MAX_PACKAGE_TOTAL_BYTES,
    MANIFEST_FILE_NAME, NormalizedPluginManifest, PluginPackageHash, PluginRuntimeError, Result,
    StagedPluginPackage, copy_dir_secure, hash_plugin_package, inspect_plugin_package,
    is_reparse_point, normalize_relative_path, reject_reparse, remove_package,
};

/// Closed transport extension for a single local plugin package archive.
pub const TLPLUGIN_EXTENSION: &str = "tlplugin";
/// Format marker file required at the archive root by the repository packager.
pub const TLPLUGIN_FORMAT_MARKER: &str = ".tlplugin-format";
/// Current closed archive format version.
pub const TLPLUGIN_FORMAT_VERSION: u32 = 1;
/// Hard cap on the compressed archive file itself (smaller than uncompressed limits).
pub const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
/// Reject zip bombs where uncompressed/compressed exceeds this ratio for any entry.
pub const MAX_COMPRESSION_RATIO: u64 = 100;

/// Host-derived package provenance. Never trusted from a manifest or renderer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginPackageSourceKind {
    LocalDirectory,
    LocalArchive,
    Bundled,
}

impl PluginPackageSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalDirectory => "localDirectory",
            Self::LocalArchive => "localArchive",
            Self::Bundled => "bundled",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "localDirectory" => Ok(Self::LocalDirectory),
            "localArchive" => Ok(Self::LocalArchive),
            "bundled" => Ok(Self::Bundled),
            other => Err(PluginRuntimeError::PackageInvalid(format!(
                "unknown plugin package source kind: {other}"
            ))),
        }
    }
}

/// Bounded public distribution metadata declared in a released package manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginDistributionMetadata {
    pub publisher: String,
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
}

const MAX_PUBLISHER_BYTES: usize = 128;
const MAX_LICENSE_BYTES: usize = 128;
const MAX_HOMEPAGE_BYTES: usize = 512;

impl PluginDistributionMetadata {
    pub fn validate(&self) -> Result<()> {
        require_bounded_text(&self.publisher, "distribution.publisher", MAX_PUBLISHER_BYTES)?;
        require_bounded_text(&self.license, "distribution.license", MAX_LICENSE_BYTES)?;
        validate_license_expression(&self.license)?;
        if let Some(homepage) = &self.homepage {
            require_bounded_text(homepage, "distribution.homepage", MAX_HOMEPAGE_BYTES)?;
            validate_https_homepage(homepage)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TlpluginFormatMarker {
    format_version: u32,
}

/// Materialize a directory or `.tlplugin` archive into a fresh staging root,
/// then validate and hash through the same package path used by install/upgrade.
pub fn materialize_plugin_package(
    source: &Path,
    staging_root: &Path,
    source_kind_override: Option<PluginPackageSourceKind>,
) -> Result<StagedPluginPackage> {
    reject_reparse(source, "plugin source")?;
    let metadata = fs::symlink_metadata(source).map_err(PluginRuntimeError::Io)?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(PluginRuntimeError::PackageInvalid(
            "plugin source must not be a symlink or reparse point".to_string(),
        ));
    }

    fs::create_dir_all(staging_root)?;
    let staging = staging_root.join(format!("stage-{}", Uuid::now_v7()));
    fs::create_dir(&staging).map_err(|error| {
        PluginRuntimeError::PackageInvalid(format!("cannot reserve staging directory: {error}"))
    })?;

    let source_kind = if metadata.is_dir() {
        if let Err(error) = copy_dir_secure(source, &staging, 0) {
            let _ = remove_package(&staging);
            return Err(error);
        }
        source_kind_override.unwrap_or(PluginPackageSourceKind::LocalDirectory)
    } else if metadata.is_file() {
        if !is_tlplugin_path(source) {
            let _ = remove_package(&staging);
            return Err(PluginRuntimeError::PackageInvalid(
                "plugin archive must use the .tlplugin extension".to_string(),
            ));
        }
        if let Err(error) = extract_tlplugin_archive(source, &staging) {
            let _ = remove_package(&staging);
            return Err(error);
        }
        source_kind_override.unwrap_or(PluginPackageSourceKind::LocalArchive)
    } else {
        let _ = remove_package(&staging);
        return Err(PluginRuntimeError::PackageInvalid(
            "plugin source must be a directory or .tlplugin archive".to_string(),
        ));
    };

    match inspect_plugin_package(&staging) {
        Ok((normalized_manifest, package_hash)) => Ok(StagedPluginPackage {
            path: staging,
            source_kind,
            normalized_manifest,
            package_hash,
        }),
        Err(error) => {
            let _ = remove_package(&staging);
            Err(error)
        }
    }
}

/// Side-effect free inspection for a directory or archive source.
/// Archives are extracted into a temporary staging root that is always cleaned up.
pub fn inspect_plugin_source(
    source: &Path,
    staging_root: &Path,
) -> Result<(
    NormalizedPluginManifest,
    PluginPackageHash,
    PluginPackageSourceKind,
)> {
    let staged = materialize_plugin_package(source, staging_root, None)?;
    let result = (
        staged.normalized_manifest.clone(),
        staged.package_hash.clone(),
        staged.source_kind,
    );
    let _ = remove_package(&staged.path);
    Ok(result)
}

pub fn is_tlplugin_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(TLPLUGIN_EXTENSION))
}

/// Extract a closed `.tlplugin` archive into `destination` (must be empty).
/// Validates every entry name before any write and re-validates the tree after.
pub fn extract_tlplugin_archive(archive_path: &Path, destination: &Path) -> Result<()> {
    reject_reparse(archive_path, "plugin archive")?;
    let archive_meta = fs::symlink_metadata(archive_path).map_err(PluginRuntimeError::Io)?;
    if !archive_meta.is_file() {
        return Err(PluginRuntimeError::PackageInvalid(
            "plugin archive must be a regular file".to_string(),
        ));
    }
    if archive_meta.len() > MAX_ARCHIVE_BYTES {
        return Err(PluginRuntimeError::PackageInvalid(
            "plugin archive exceeds compressed byte limit".to_string(),
        ));
    }
    if !destination.is_dir() {
        return Err(PluginRuntimeError::PackageInvalid(
            "archive extraction destination must be a directory".to_string(),
        ));
    }
    if destination
        .read_dir()
        .map_err(PluginRuntimeError::Io)?
        .next()
        .is_some()
    {
        return Err(PluginRuntimeError::PackageInvalid(
            "archive extraction destination must be empty".to_string(),
        ));
    }

    let file = File::open(archive_path).map_err(PluginRuntimeError::Io)?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        PluginRuntimeError::PackageInvalid(format!("invalid plugin archive: {error}"))
    })?;

    let mut planned: Vec<PlannedEntry> = Vec::new();
    let mut seen_exact = BTreeSet::new();
    let mut seen_folded = BTreeSet::new();
    let mut format_marker_body: Option<Vec<u8>> = None;
    let mut total_uncompressed = 0_u64;
    let mut file_count = 0_usize;

    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| {
            PluginRuntimeError::PackageInvalid(format!("invalid archive entry: {error}"))
        })?;
        let raw_name = entry.name().to_string();
        if raw_name.is_empty() {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive contains an empty entry name".to_string(),
            ));
        }
        if entry.encrypted() {
            return Err(PluginRuntimeError::PackageInvalid(
                "encrypted archive entries are not supported".to_string(),
            ));
        }
        match entry.compression() {
            CompressionMethod::Stored | CompressionMethod::Deflated => {}
            other => {
                return Err(PluginRuntimeError::PackageInvalid(format!(
                    "unsupported archive compression method: {other:?}"
                )));
            }
        }
        if entry.is_symlink() {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive contains a symlink entry".to_string(),
            ));
        }
        // Reject special files encoded via exotic unix modes (only file/dir allowed).
        if let Some(mode) = entry.unix_mode() {
            let file_type = mode & 0o170000;
            if file_type != 0 && file_type != 0o100000 && file_type != 0o040000 {
                return Err(PluginRuntimeError::PackageInvalid(
                    "archive contains a special file entry".to_string(),
                ));
            }
        }

        let is_dir = entry.is_dir() || raw_name.ends_with('/');
        let normalized = normalize_archive_entry_name(&raw_name, is_dir)?;
        if normalized == TLPLUGIN_FORMAT_MARKER {
            if is_dir {
                return Err(PluginRuntimeError::PackageInvalid(
                    "format marker must be a file".to_string(),
                ));
            }
            let compressed = entry.compressed_size().max(1);
            let uncompressed = entry.size();
            guard_compression_ratio(compressed, uncompressed)?;
            total_uncompressed = total_uncompressed.saturating_add(uncompressed);
            if total_uncompressed > MAX_PACKAGE_TOTAL_BYTES {
                return Err(PluginRuntimeError::PackageInvalid(
                    "archive exceeds uncompressed byte limit".to_string(),
                ));
            }
            let mut body = Vec::new();
            let mut limited = entry.take(MAX_PACKAGE_TOTAL_BYTES.saturating_add(1));
            limited
                .read_to_end(&mut body)
                .map_err(|error| PluginRuntimeError::PackageInvalid(format!(
                    "cannot read format marker: {error}"
                )))?;
            if body.len() as u64 > 4 * 1024 {
                return Err(PluginRuntimeError::PackageInvalid(
                    "format marker exceeds size limit".to_string(),
                ));
            }
            if format_marker_body.replace(body).is_some() {
                return Err(PluginRuntimeError::PackageInvalid(
                    "archive contains duplicate format marker".to_string(),
                ));
            }
            continue;
        }

        if !seen_exact.insert(normalized.clone()) {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "archive contains duplicate entry path: {normalized}"
            )));
        }
        let folded = normalized.to_ascii_lowercase();
        if !seen_folded.insert(folded) {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "archive contains case-fold colliding entry path: {normalized}"
            )));
        }

        if is_dir {
            planned.push(PlannedEntry {
                relative: normalized,
                is_dir: true,
                index: None,
                size: 0,
            });
            continue;
        }

        file_count = file_count.saturating_add(1);
        if file_count > MAX_PACKAGE_FILES {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive contains too many files".to_string(),
            ));
        }
        let compressed = entry.compressed_size().max(1);
        let uncompressed = entry.size();
        guard_compression_ratio(compressed, uncompressed)?;
        total_uncompressed = total_uncompressed.saturating_add(uncompressed);
        if total_uncompressed > MAX_PACKAGE_TOTAL_BYTES {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive exceeds uncompressed byte limit".to_string(),
            ));
        }
        planned.push(PlannedEntry {
            relative: normalized,
            is_dir: false,
            index: Some(index),
            size: uncompressed,
        });
    }

    let marker = format_marker_body.ok_or_else(|| {
        PluginRuntimeError::PackageInvalid(
            "archive is missing the required .tlplugin-format marker".to_string(),
        )
    })?;
    let marker: TlpluginFormatMarker = serde_json::from_slice(&marker).map_err(|error| {
        PluginRuntimeError::PackageInvalid(format!("invalid format marker: {error}"))
    })?;
    if marker.format_version != TLPLUGIN_FORMAT_VERSION {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "unsupported .tlplugin format version {}",
            marker.format_version
        )));
    }

    let package_root_name = resolve_single_package_root(&planned)?;
    let extract_root = if let Some(root_name) = &package_root_name {
        destination.join(root_name)
    } else {
        destination.to_path_buf()
    };
    if package_root_name.is_some() {
        fs::create_dir_all(&extract_root).map_err(PluginRuntimeError::Io)?;
    }

    // Write planned entries with create-new semantics only.
    for plan in &planned {
        let relative_in_package = if let Some(root_name) = &package_root_name {
            plan.relative
                .strip_prefix(&format!("{root_name}/"))
                .or_else(|| {
                    if plan.relative == *root_name {
                        Some("")
                    } else {
                        None
                    }
                })
                .ok_or_else(|| {
                    PluginRuntimeError::PackageInvalid(
                        "archive entry escaped the single package root".to_string(),
                    )
                })?
        } else {
            plan.relative.as_str()
        };

        if relative_in_package.is_empty() {
            continue;
        }

        let target = join_under_root(&extract_root, relative_in_package)?;
        if plan.is_dir {
            fs::create_dir_all(&target).map_err(PluginRuntimeError::Io)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(PluginRuntimeError::Io)?;
        }
        let index = plan.index.ok_or_else(|| {
            PluginRuntimeError::PackageInvalid("archive file entry missing index".to_string())
        })?;
        let mut entry = archive.by_index(index).map_err(|error| {
            PluginRuntimeError::PackageInvalid(format!("cannot re-open archive entry: {error}"))
        })?;
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| {
                PluginRuntimeError::PackageInvalid(format!(
                    "cannot create extracted file {}: {error}",
                    target.display()
                ))
            })?;
        let mut written = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buffer).map_err(|error| {
                PluginRuntimeError::PackageInvalid(format!("cannot read archive entry: {error}"))
            })?;
            if read == 0 {
                break;
            }
            written = written.saturating_add(read as u64);
            if written > plan.size.saturating_add(1) || written > MAX_PACKAGE_TOTAL_BYTES {
                return Err(PluginRuntimeError::PackageInvalid(
                    "archive entry exceeded declared uncompressed size".to_string(),
                ));
            }
            out.write_all(&buffer[..read]).map_err(PluginRuntimeError::Io)?;
        }
        if written != plan.size {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive entry size did not match declared uncompressed size".to_string(),
            ));
        }
        out.flush().map_err(PluginRuntimeError::Io)?;
    }

    // If the archive nested the package under one directory, promote that tree
    // to the destination root so callers always receive a flat package directory.
    if package_root_name.is_some() {
        promote_single_child(destination, &extract_root)?;
    }

    // Final tree validation reuses directory security checks and hash bounds.
    let _ = hash_plugin_package(destination)?;
    let manifest = destination.join(MANIFEST_FILE_NAME);
    if !manifest.is_file() {
        return Err(PluginRuntimeError::PackageInvalid(
            "extracted package is missing manifest.json".to_string(),
        ));
    }
    Ok(())
}

struct PlannedEntry {
    relative: String,
    is_dir: bool,
    index: Option<usize>,
    size: u64,
}

fn guard_compression_ratio(compressed: u64, uncompressed: u64) -> Result<()> {
    if compressed == 0 {
        return Ok(());
    }
    if uncompressed / compressed > MAX_COMPRESSION_RATIO {
        return Err(PluginRuntimeError::PackageInvalid(
            "archive entry exceeds compression ratio limit".to_string(),
        ));
    }
    Ok(())
}

fn normalize_archive_entry_name(raw: &str, is_dir: bool) -> Result<String> {
    let trimmed = raw.trim_matches('/');
    // Reject absolute / drive / UNC style names before general normalization.
    if raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.contains('\0')
        || raw.contains(':')
        || raw.starts_with("//")
        || raw.starts_with("\\\\")
        || raw.contains("..")
    {
        // Still allow `..` detection via normalize_relative_path after split;
        // but hard-reject absolute and drive forms immediately.
        if raw.starts_with('/')
            || raw.starts_with('\\')
            || raw.contains('\0')
            || raw.contains(':')
            || raw.starts_with("//")
            || raw.starts_with("\\\\")
        {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive entry path must be a safe relative path".to_string(),
            ));
        }
    }
    if trimmed.is_empty() {
        return Err(PluginRuntimeError::PackageInvalid(
            "archive contains an empty entry name".to_string(),
        ));
    }
    if is_dir {
        // Directory entries may end with `/`; normalize without requiring a file leaf.
        let normalized = trimmed.replace('\\', "/");
        if normalized.starts_with('/') || normalized.contains(':') {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive directory entry must be a relative path".to_string(),
            ));
        }
        let mut parts = Vec::new();
        for component in normalized.split('/') {
            if component.is_empty() || component == "." {
                continue;
            }
            if component == ".." {
                return Err(PluginRuntimeError::PackageInvalid(
                    "archive entry contains an escaping path component".to_string(),
                ));
            }
            if component.len() > MAX_PACKAGE_PATH_BYTES {
                return Err(PluginRuntimeError::PackageInvalid(
                    "archive entry path component is oversized".to_string(),
                ));
            }
            parts.push(component);
        }
        if parts.is_empty() {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive directory entry must contain a path".to_string(),
            ));
        }
        if parts.len() > MAX_PACKAGE_DEPTH {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive entry exceeds package nesting limit".to_string(),
            ));
        }
        let joined = parts.join("/");
        if joined.len() > MAX_PACKAGE_PATH_BYTES {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive entry path is oversized".to_string(),
            ));
        }
        return Ok(joined);
    }
    normalize_relative_path(trimmed, "archive entry")
}

fn resolve_single_package_root(planned: &[PlannedEntry]) -> Result<Option<String>> {
    let mut has_root_manifest = false;
    let mut top_level_dirs = BTreeSet::new();
    let mut top_level_files = BTreeSet::new();

    for plan in planned {
        let mut parts = plan.relative.split('/');
        let first = parts.next().unwrap_or_default();
        if first.is_empty() {
            continue;
        }
        if parts.next().is_none() {
            if plan.is_dir {
                top_level_dirs.insert(first.to_string());
            } else {
                top_level_files.insert(first.to_string());
                if first == MANIFEST_FILE_NAME {
                    has_root_manifest = true;
                }
            }
        } else {
            top_level_dirs.insert(first.to_string());
        }
    }

    if has_root_manifest {
        // Flat package: only package files + optional empty dirs under root.
        if top_level_dirs.is_empty() {
            return Ok(None);
        }
        // Nested directories under a flat package are fine; top-level sibling
        // package roots are not.
        return Ok(None);
    }

    // Nested single package root: exactly one top-level directory and no
    // package files outside it (format marker already stripped).
    if top_level_files.is_empty() && top_level_dirs.len() == 1 {
        let root = top_level_dirs.into_iter().next().expect("one root");
        let manifest_path = format!("{root}/{MANIFEST_FILE_NAME}");
        let has_manifest = planned.iter().any(|plan| plan.relative == manifest_path);
        if !has_manifest {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive package root is missing manifest.json".to_string(),
            ));
        }
        return Ok(Some(root));
    }

    Err(PluginRuntimeError::PackageInvalid(
        "archive must contain exactly one plugin package root with manifest.json".to_string(),
    ))
}

fn join_under_root(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut current = root.to_path_buf();
    for component in relative.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(PluginRuntimeError::PackageInvalid(
                "archive entry escaped extraction root".to_string(),
            ));
        }
        current.push(component);
    }
    Ok(current)
}

fn promote_single_child(destination: &Path, nested: &Path) -> Result<()> {
    if nested == destination {
        return Ok(());
    }
    let temp = destination
        .parent()
        .unwrap_or(destination)
        .join(format!(".promote-{}", Uuid::now_v7()));
    fs::rename(nested, &temp).map_err(PluginRuntimeError::Io)?;
    // Remove emptied nest path if still present.
    let _ = fs::remove_dir_all(destination);
    fs::create_dir_all(destination).map_err(PluginRuntimeError::Io)?;
    // Move children of temp into destination.
    for entry in fs::read_dir(&temp).map_err(PluginRuntimeError::Io)? {
        let entry = entry.map_err(PluginRuntimeError::Io)?;
        let target = destination.join(entry.file_name());
        fs::rename(entry.path(), target).map_err(PluginRuntimeError::Io)?;
    }
    let _ = fs::remove_dir_all(&temp);
    Ok(())
}

fn require_bounded_text(value: &str, label: &str, max_bytes: usize) -> Result<()> {
    if value.trim().is_empty() || value.trim() != value {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} must be non-empty without surrounding whitespace"
        )));
    }
    if value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} exceeds its size or character limit"
        )));
    }
    Ok(())
}

fn validate_license_expression(value: &str) -> Result<()> {
    // Closed SPDX-style subset: identifiers, WITH/AND/OR, parentheses, `+`.
    if !value.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || matches!(ch, '-' | '.' | '+' | '(' | ')' | ' ')
    }) {
        return Err(PluginRuntimeError::InvalidManifest(
            "distribution.license contains unsupported characters".to_string(),
        ));
    }
    let tokens = value.split_whitespace().collect::<Vec<_>>();
    if tokens.is_empty() {
        return Err(PluginRuntimeError::InvalidManifest(
            "distribution.license must be a non-empty SPDX-style expression".to_string(),
        ));
    }
    for token in tokens {
        let upper = token.to_ascii_uppercase();
        if matches!(upper.as_str(), "AND" | "OR" | "WITH") {
            continue;
        }
        let stripped = token.trim_matches(|ch| ch == '(' || ch == ')');
        if stripped.is_empty() {
            continue;
        }
        if !stripped
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '+'))
        {
            return Err(PluginRuntimeError::InvalidManifest(
                "distribution.license token is invalid".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_https_homepage(value: &str) -> Result<()> {
    let lower = value.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return Err(PluginRuntimeError::InvalidManifest(
            "distribution.homepage must use https".to_string(),
        ));
    }
    if value.contains(char::is_whitespace) || value.contains('\0') {
        return Err(PluginRuntimeError::InvalidManifest(
            "distribution.homepage contains invalid characters".to_string(),
        ));
    }
    Ok(())
}

/// Build a deterministic `.tlplugin` archive from a package directory.
/// Timestamps, modes, entry order, and compression settings are fixed.
pub fn build_tlplugin_archive(package_dir: &Path, output_path: &Path) -> Result<String> {
    reject_reparse(package_dir, "package directory")?;
    if !package_dir.is_dir() {
        return Err(PluginRuntimeError::PackageInvalid(
            "package directory must be a directory".to_string(),
        ));
    }
    let package_hash = hash_plugin_package(package_dir)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(PluginRuntimeError::Io)?;
    }
    let file = File::create(output_path).map_err(PluginRuntimeError::Io)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6))
        .last_modified_time(
            zip::DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).map_err(|error| {
                PluginRuntimeError::PackageInvalid(format!("invalid zip timestamp: {error}"))
            })?,
        )
        .unix_permissions(0o644);

    // Format marker first for stable tooling.
    let marker = serde_json::to_vec(&TlpluginFormatMarker {
        format_version: TLPLUGIN_FORMAT_VERSION,
    })?;
    zip.start_file(TLPLUGIN_FORMAT_MARKER, options)
        .map_err(|error| {
            PluginRuntimeError::PackageInvalid(format!("cannot write format marker: {error}"))
        })?;
    zip.write_all(&marker).map_err(PluginRuntimeError::Io)?;

    let mut files = package_hash.entries.clone();
    files.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
    for entry in files {
        let source = package_dir.join(entry.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let bytes = fs::read(&source).map_err(PluginRuntimeError::Io)?;
        zip.start_file(&entry.path, options).map_err(|error| {
            PluginRuntimeError::PackageInvalid(format!("cannot write archive entry: {error}"))
        })?;
        zip.write_all(&bytes).map_err(PluginRuntimeError::Io)?;
    }
    zip.finish().map_err(|error| {
        PluginRuntimeError::PackageInvalid(format!("cannot finish archive: {error}"))
    })?;

    // Archive content hash (file bytes), separate from package identity hash.
    let mut hasher = Sha256::new();
    let mut archive = File::open(output_path).map_err(PluginRuntimeError::Io)?;
    io::copy(&mut archive, &mut hasher).map_err(PluginRuntimeError::Io)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Require a root LICENSE / LICENSE.* file for release-bundled packages.
pub fn package_has_license_file(package_dir: &Path) -> Result<bool> {
    reject_reparse(package_dir, "package directory")?;
    for entry in fs::read_dir(package_dir).map_err(PluginRuntimeError::Io)? {
        let entry = entry.map_err(PluginRuntimeError::Io)?;
        let name = entry.file_name().to_string_lossy().to_string();
        let upper = name.to_ascii_uppercase();
        if upper == "LICENSE"
            || upper.starts_with("LICENSE.")
            || upper == "LICENCE"
            || upper.starts_with("LICENCE.")
        {
            let meta = entry.metadata().map_err(PluginRuntimeError::Io)?;
            if meta.is_file() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Validate release packaging requirements (distribution metadata + license file).
pub fn validate_release_package_requirements(package_dir: &Path) -> Result<()> {
    let normalized = crate::load_normalized_manifest(package_dir)?;
    let distribution = normalized.distribution.as_ref().ok_or_else(|| {
        PluginRuntimeError::InvalidManifest(
            "release packages require distribution metadata".to_string(),
        )
    })?;
    distribution.validate()?;
    if !package_has_license_file(package_dir)? {
        return Err(PluginRuntimeError::InvalidManifest(
            "release packages require a LICENSE file".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MANIFEST_FILE_NAME, hash_plugin_package};
    use serde_json::json;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    fn write_minimal_package(dir: &Path) {
        fs::create_dir_all(dir).expect("mkdir");
        fs::write(
            dir.join(MANIFEST_FILE_NAME),
            serde_json::to_vec(&json!({
                "manifestVersion": 2,
                "id": "example.archive-fixture",
                "displayName": "Archive fixture",
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
                    "id": "example.archive-fixture.filter",
                    "version": "1.0.0",
                    "displayName": "Archive filter",
                    "extensions": ["arcfix"],
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
        fs::write(dir.join("LICENSE"), "MIT License\n").expect("license");
        fs::write(dir.join("README.md"), "fixture\n").expect("readme");
    }

    #[test]
    fn directory_and_archive_share_canonical_hash() {
        let temp = tempdir().expect("temp");
        let package = temp.path().join("pkg");
        write_minimal_package(&package);
        let dir_hash = hash_plugin_package(&package).expect("dir hash");
        let archive = temp.path().join("pkg.tlplugin");
        let _archive_hash = build_tlplugin_archive(&package, &archive).expect("build archive");
        let staging = temp.path().join("stage-root");
        fs::create_dir_all(&staging).expect("stage root");
        let staged = materialize_plugin_package(&archive, &staging, None).expect("materialize");
        assert_eq!(staged.package_hash.sha256, dir_hash.sha256);
        assert_eq!(staged.source_kind, PluginPackageSourceKind::LocalArchive);
        assert_eq!(staged.normalized_manifest.id, "example.archive-fixture");
    }

    #[test]
    fn rejects_path_traversal_before_write() {
        let temp = tempdir().expect("temp");
        let archive_path = temp.path().join("evil.tlplugin");
        {
            let file = File::create(&archive_path).expect("create");
            let mut zip = zip::ZipWriter::new(file);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Stored)
                .last_modified_time(
                    zip::DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap(),
                );
            zip.start_file(
                TLPLUGIN_FORMAT_MARKER,
                options,
            )
            .unwrap();
            zip.write_all(br#"{"formatVersion":1}"#).unwrap();
            zip.start_file("../escape.txt", options).unwrap();
            zip.write_all(b"nope").unwrap();
            zip.finish().unwrap();
        }
        let dest = temp.path().join("out");
        fs::create_dir_all(&dest).unwrap();
        let error = extract_tlplugin_archive(&archive_path, &dest).expect_err("must reject");
        assert!(error.to_string().contains("escaping") || error.to_string().contains("relative") || error.to_string().contains("safe"));
        assert!(dest.read_dir().unwrap().next().is_none() || !dest.join("escape.txt").exists());
    }

    #[test]
    fn rejects_missing_format_marker() {
        let temp = tempdir().expect("temp");
        let package = temp.path().join("pkg");
        write_minimal_package(&package);
        let archive_path = temp.path().join("no-marker.zip");
        {
            let file = File::create(&archive_path).expect("create");
            let mut zip = zip::ZipWriter::new(file);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Stored)
                .last_modified_time(
                    zip::DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap(),
                );
            for entry in hash_plugin_package(&package).unwrap().entries {
                let bytes = fs::read(package.join(&entry.path)).unwrap();
                zip.start_file(&entry.path, options).unwrap();
                zip.write_all(&bytes).unwrap();
            }
            zip.finish().unwrap();
        }
        // Rename to .tlplugin for extension check path via materialize.
        let tl = temp.path().join("no-marker.tlplugin");
        fs::copy(&archive_path, &tl).unwrap();
        let staging = temp.path().join("stage");
        fs::create_dir_all(&staging).unwrap();
        let error = materialize_plugin_package(&tl, &staging, None).expect_err("marker required");
        assert!(error.to_string().contains("format"));
    }

    #[test]
    fn build_is_reproducible() {
        let temp = tempdir().expect("temp");
        let package = temp.path().join("pkg");
        write_minimal_package(&package);
        let a = temp.path().join("a.tlplugin");
        let b = temp.path().join("b.tlplugin");
        let hash_a = build_tlplugin_archive(&package, &a).expect("a");
        let hash_b = build_tlplugin_archive(&package, &b).expect("b");
        assert_eq!(hash_a, hash_b);
        let bytes_a = fs::read(&a).unwrap();
        let bytes_b = fs::read(&b).unwrap();
        assert_eq!(bytes_a, bytes_b);
    }

    #[test]
    fn distribution_metadata_validation() {
        let good = PluginDistributionMetadata {
            publisher: "Translunar".into(),
            license: "Apache-2.0".into(),
            homepage: Some("https://example.com/plugins".into()),
        };
        good.validate().expect("valid");
        let bad = PluginDistributionMetadata {
            publisher: "Translunar".into(),
            license: "MIT".into(),
            homepage: Some("http://insecure.example".into()),
        };
        assert!(bad.validate().is_err());
    }
}
