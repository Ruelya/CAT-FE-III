//! Pure, bounded contracts for offline task packages.
//!
//! This crate deliberately has no filesystem, SQLite, Electron, or Engine
//! dependencies.  The ZIP codec and persistence layers consume these models so
//! validation and three-way classification cannot drift between call sites.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const TASK_PACKAGE_FORMAT_VERSION: u16 = 1;
pub const MAX_DOCUMENTS: usize = 50;
pub const MAX_SEGMENTS: usize = 100_000;
pub const MAX_ENTRY_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ASSET_ROWS: usize = 10_000;
pub const MAX_COMMENTS: usize = 1_000;
pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
pub const MAX_ID_BYTES: usize = 256;
pub const MAX_INSTRUCTION_BYTES: usize = 256 * 1024;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TaskPackageError {
    #[error("invalid task package input: {0}")]
    InvalidInput(String),
    #[error("invalid task package: {0}")]
    InvalidPackage(String),
    #[error("task package resource limit exceeded for {resource}: limit {limit}, actual {actual}")]
    ResourceLimit {
        resource: &'static str,
        limit: u64,
        actual: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TaskPackageKind {
    Assignment,
    Return,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageEntry {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDocumentRef {
    pub origin_document_id: String,
    pub name: String,
    pub format: String,
    pub source_sha256: String,
    pub base_revision: u64,
    pub segment_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssetSliceRef {
    pub kind: String,
    pub library_id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub row_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageManifest {
    pub format_version: u16,
    pub package_id: String,
    pub kind: TaskPackageKind,
    pub project_id: String,
    pub project_name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub base_project_revision: u64,
    #[serde(default)]
    pub parent_package_id: Option<String>,
    #[serde(default)]
    pub instruction_sha256: Option<String>,
    pub documents: Vec<TaskPackageDocumentRef>,
    #[serde(default)]
    pub asset_slices: Vec<TaskPackageAssetSliceRef>,
    pub entries: Vec<TaskPackageEntry>,
    pub manifest_hash: String,
}

impl TaskPackageManifest {
    pub fn digest(&self) -> Result<String, TaskPackageError> {
        let mut unsigned = self.clone();
        unsigned.manifest_hash.clear();
        canonical_sha256(&unsigned)
    }

    pub fn validate(&self) -> Result<(), TaskPackageError> {
        if self.format_version != TASK_PACKAGE_FORMAT_VERSION {
            return Err(TaskPackageError::InvalidPackage(format!(
                "unsupported format version {}",
                self.format_version
            )));
        }
        require_id("package_id", &self.package_id)?;
        require_id("project_id", &self.project_id)?;
        require_text("project_name", &self.project_name, MAX_TEXT_BYTES)?;
        require_id("source_locale", &self.source_locale)?;
        require_id("target_locale", &self.target_locale)?;
        match self.kind {
            TaskPackageKind::Assignment if self.parent_package_id.is_some() => {
                return Err(TaskPackageError::InvalidPackage(
                    "assignment cannot have a parent package".to_string(),
                ));
            }
            TaskPackageKind::Return if self.parent_package_id.is_none() => {
                return Err(TaskPackageError::InvalidPackage(
                    "return package requires a parent package".to_string(),
                ));
            }
            _ => {}
        }
        if let Some(parent) = &self.parent_package_id {
            require_id("parent_package_id", parent)?;
        }
        if let Some(digest) = &self.instruction_sha256 {
            validate_sha256("instruction_sha256", digest)?;
        }
        if self.documents.is_empty() {
            return Err(TaskPackageError::InvalidPackage(
                "package must contain at least one document".to_string(),
            ));
        }
        if self.documents.len() > MAX_DOCUMENTS {
            return Err(TaskPackageError::ResourceLimit {
                resource: "documents",
                limit: MAX_DOCUMENTS as u64,
                actual: self.documents.len() as u64,
            });
        }
        let mut document_ids = BTreeSet::new();
        let mut segment_count = 0_u64;
        for document in &self.documents {
            require_id("origin_document_id", &document.origin_document_id)?;
            require_text("document_name", &document.name, MAX_TEXT_BYTES)?;
            require_id("document_format", &document.format)?;
            validate_sha256("source_sha256", &document.source_sha256)?;
            if document.segment_count == 0 {
                return Err(TaskPackageError::InvalidPackage(
                    "document must contain at least one segment".to_string(),
                ));
            }
            if !document_ids.insert(document.origin_document_id.as_str()) {
                return Err(TaskPackageError::InvalidPackage(
                    "package contains duplicate document identities".to_string(),
                ));
            }
            segment_count = segment_count.saturating_add(u64::from(document.segment_count));
        }
        if segment_count > MAX_SEGMENTS as u64 {
            return Err(TaskPackageError::ResourceLimit {
                resource: "segments",
                limit: MAX_SEGMENTS as u64,
                actual: segment_count,
            });
        }
        let mut asset_rows = 0_u64;
        for slice in &self.asset_slices {
            require_id("asset_kind", &slice.kind)?;
            if !matches!(slice.kind.as_str(), "tm" | "termbase") {
                return Err(TaskPackageError::InvalidPackage(
                    "asset slice kind must be tm or termbase".to_string(),
                ));
            }
            require_id("asset_library_id", &slice.library_id)?;
            require_text("asset_name", &slice.name, MAX_TEXT_BYTES)?;
            require_id("asset_source_locale", &slice.source_locale)?;
            require_id("asset_target_locale", &slice.target_locale)?;
            if slice.row_count == 0 {
                return Err(TaskPackageError::InvalidPackage(
                    "asset slice must contain at least one row".to_string(),
                ));
            }
            asset_rows = asset_rows.saturating_add(u64::from(slice.row_count));
        }
        if asset_rows > MAX_ASSET_ROWS as u64 {
            return Err(TaskPackageError::ResourceLimit {
                resource: "asset rows",
                limit: MAX_ASSET_ROWS as u64,
                actual: asset_rows,
            });
        }
        validate_entries(&self.entries)?;
        validate_sha256("manifest_hash", &self.manifest_hash)?;
        let expected = self.digest()?;
        if !expected.eq_ignore_ascii_case(&self.manifest_hash) {
            return Err(TaskPackageError::InvalidPackage(
                "manifest hash does not match canonical content".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageProjection {
    pub origin_document_id: String,
    pub origin_segment_id: String,
    pub ordinal: u32,
    pub structural_path: String,
    pub source_hash: String,
    pub base_revision: u64,
    pub source_text: String,
    #[serde(default)]
    pub target_text: String,
    #[serde(default)]
    pub segment_state: String,
    #[serde(default)]
    pub tags_json: String,
    #[serde(default)]
    pub workflow_state: String,
    #[serde(default)]
    pub comments_json: String,
    pub projection_hash: String,
}

impl TaskPackageProjection {
    pub fn unsigned(&self) -> Self {
        let mut value = self.clone();
        value.projection_hash.clear();
        value
    }

    pub fn digest(&self) -> Result<String, TaskPackageError> {
        let mut unsigned = self.unsigned();
        // Revisions are guarded independently during preview/apply. The
        // projection hash describes editable content, not revision metadata.
        unsigned.base_revision = 0;
        canonical_sha256(&unsigned)
    }

    pub fn with_computed_hash(mut self) -> Result<Self, TaskPackageError> {
        validate_projection_fields(&self)?;
        self.projection_hash = self.digest()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), TaskPackageError> {
        validate_projection_fields(self)?;
        validate_sha256("projection_hash", &self.projection_hash)?;
        let expected = self.digest()?;
        if !expected.eq_ignore_ascii_case(&self.projection_hash) {
            return Err(TaskPackageError::InvalidPackage(format!(
                "projection hash mismatch for segment {}",
                self.origin_segment_id
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageReturnRow {
    pub base: TaskPackageProjection,
    pub remote: Option<TaskPackageProjection>,
    #[serde(default = "default_dependency_ok")]
    pub dependency_ok: bool,
}

fn default_dependency_ok() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDocumentPayload {
    pub origin_document_id: String,
    pub source_sha256: String,
    pub base_revision: u64,
    pub source_entry: String,
    pub segments: Vec<TaskPackageProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageReturnPayload {
    pub origin_document_id: String,
    pub source_sha256: String,
    pub base_revision: u64,
    pub rows: Vec<TaskPackageReturnRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssetRow {
    pub row_id: String,
    pub source_text: String,
    pub target_text: String,
    #[serde(default)]
    pub metadata_json: String,
    #[serde(default)]
    pub provenance_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssetSlicePayload {
    pub kind: String,
    pub library_id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub rows: Vec<TaskPackageAssetRow>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TaskPackageDisposition {
    Unchanged,
    RemoteChanged,
    LocalChanged,
    BothChanged,
    Deleted,
    Added,
    TagInvalid,
    MissingDependency,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageClassification {
    pub disposition: TaskPackageDisposition,
    pub reason: String,
    pub safe_to_apply: bool,
    pub identical_change: bool,
    pub base_hash: Option<String>,
    pub current_hash: Option<String>,
    pub remote_hash: Option<String>,
}

impl TaskPackageClassification {
    pub fn is_conflict(&self) -> bool {
        matches!(
            self.disposition,
            TaskPackageDisposition::BothChanged
                | TaskPackageDisposition::Deleted
                | TaskPackageDisposition::Added
                | TaskPackageDisposition::TagInvalid
                | TaskPackageDisposition::MissingDependency
        ) && !self.safe_to_apply
    }
}

/// Classify one origin row against the base projection in the package, the
/// current local projection, and the returned remote projection.
pub fn classify_three_way(
    base: Option<&TaskPackageProjection>,
    current: Option<&TaskPackageProjection>,
    remote: Option<&TaskPackageProjection>,
    tag_valid: bool,
    dependency_ok: bool,
) -> Result<TaskPackageClassification, TaskPackageError> {
    for projection in [base, current, remote].into_iter().flatten() {
        projection.validate()?;
    }
    if !dependency_ok {
        return Ok(classification(
            TaskPackageDisposition::MissingDependency,
            "required document or asset dependency is unavailable",
            false,
            false,
            base,
            current,
            remote,
        ));
    }
    if !tag_valid {
        return Ok(classification(
            TaskPackageDisposition::TagInvalid,
            "returned tag projection is invalid",
            false,
            false,
            base,
            current,
            remote,
        ));
    }

    let base_hash = base.map(|value| value.projection_hash.as_str());
    let current_hash = current.map(|value| value.projection_hash.as_str());
    let remote_hash = remote.map(|value| value.projection_hash.as_str());
    let local_changed = current_hash != base_hash;
    let remote_changed = remote_hash != base_hash;

    let result = match (base, current, remote) {
        (None, None, Some(_)) => classification(
            TaskPackageDisposition::Added,
            "returned row has no local or base identity",
            false,
            false,
            base,
            current,
            remote,
        ),
        (Some(_), None, Some(_)) | (Some(_), Some(_), None) => classification(
            TaskPackageDisposition::Deleted,
            "one side deleted a bound row",
            false,
            false,
            base,
            current,
            remote,
        ),
        (None, Some(_), None) => classification(
            TaskPackageDisposition::Added,
            "local row has no package base identity",
            false,
            false,
            base,
            current,
            remote,
        ),
        (None, Some(local), Some(remote_projection))
            if local.projection_hash == remote_projection.projection_hash =>
        {
            classification(
                TaskPackageDisposition::Added,
                "new row is identical on both sides",
                false,
                true,
                base,
                current,
                remote,
            )
        }
        (None, Some(_), Some(_)) => classification(
            TaskPackageDisposition::Added,
            "new row differs on both sides",
            false,
            false,
            base,
            current,
            remote,
        ),
        (Some(_), Some(_), Some(_)) if !local_changed && !remote_changed => classification(
            TaskPackageDisposition::Unchanged,
            "neither side changed the base row",
            false,
            false,
            base,
            current,
            remote,
        ),
        (Some(_), Some(_), Some(_)) if !local_changed && remote_changed => classification(
            TaskPackageDisposition::RemoteChanged,
            "only the returned task changed the base row",
            true,
            false,
            base,
            current,
            remote,
        ),
        (Some(_), Some(_), Some(_)) if local_changed && !remote_changed => classification(
            TaskPackageDisposition::LocalChanged,
            "only the local project changed the base row",
            false,
            false,
            base,
            current,
            remote,
        ),
        (Some(_), Some(local), Some(remote_projection))
            if local.projection_hash == remote_projection.projection_hash =>
        {
            classification(
                TaskPackageDisposition::BothChanged,
                "both sides made the same change",
                true,
                true,
                base,
                current,
                remote,
            )
        }
        (Some(_), Some(_), Some(_)) => classification(
            TaskPackageDisposition::BothChanged,
            "local and returned changes diverge",
            false,
            false,
            base,
            current,
            remote,
        ),
        _ => classification(
            TaskPackageDisposition::Unchanged,
            "row is absent from both current and returned projections",
            false,
            false,
            base,
            current,
            remote,
        ),
    };
    Ok(result)
}

fn classification(
    disposition: TaskPackageDisposition,
    reason: &str,
    safe_to_apply: bool,
    identical_change: bool,
    base: Option<&TaskPackageProjection>,
    current: Option<&TaskPackageProjection>,
    remote: Option<&TaskPackageProjection>,
) -> TaskPackageClassification {
    TaskPackageClassification {
        disposition,
        reason: reason.to_string(),
        safe_to_apply,
        identical_change,
        base_hash: base.map(|value| value.projection_hash.clone()),
        current_hash: current.map(|value| value.projection_hash.clone()),
        remote_hash: remote.map(|value| value.projection_hash.clone()),
    }
}

pub fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>, TaskPackageError> {
    let value = serde_json::to_value(value)
        .map_err(|error| TaskPackageError::InvalidInput(format!("cannot encode JSON: {error}")))?;
    let normalized = canonical_value(value);
    serde_json::to_vec(&normalized).map_err(|error| {
        TaskPackageError::InvalidInput(format!("cannot encode canonical JSON: {error}"))
    })
}

pub fn canonical_sha256<T: Serialize>(value: &T) -> Result<String, TaskPackageError> {
    let bytes = canonical_json(value)?;
    Ok(sha256_hex(&bytes))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn validate_entries(entries: &[TaskPackageEntry]) -> Result<(), TaskPackageError> {
    if entries.is_empty() {
        return Err(TaskPackageError::InvalidPackage(
            "package has no payload entries".to_string(),
        ));
    }
    let mut paths = BTreeSet::new();
    let mut total = 0_u64;
    for entry in entries {
        validate_safe_path(&entry.path)?;
        if !paths.insert(entry.path.as_str()) {
            return Err(TaskPackageError::InvalidPackage(
                "package contains duplicate entry paths".to_string(),
            ));
        }
        if entry.size_bytes > MAX_ENTRY_BYTES {
            return Err(TaskPackageError::ResourceLimit {
                resource: "entry bytes",
                limit: MAX_ENTRY_BYTES,
                actual: entry.size_bytes,
            });
        }
        total = total
            .checked_add(entry.size_bytes)
            .ok_or_else(|| TaskPackageError::InvalidPackage("package size overflow".to_string()))?;
        if total > MAX_TOTAL_BYTES {
            return Err(TaskPackageError::ResourceLimit {
                resource: "total bytes",
                limit: MAX_TOTAL_BYTES,
                actual: total,
            });
        }
        validate_sha256("entry sha256", &entry.sha256)?;
    }
    Ok(())
}

pub fn validate_safe_path(path: &str) -> Result<(), TaskPackageError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path.as_bytes().get(1) == Some(&b':')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(TaskPackageError::InvalidPackage(
            "package entry path is unsafe".to_string(),
        ));
    }
    Ok(())
}

fn validate_projection_fields(value: &TaskPackageProjection) -> Result<(), TaskPackageError> {
    require_id("origin_document_id", &value.origin_document_id)?;
    require_id("origin_segment_id", &value.origin_segment_id)?;
    require_text("structural_path", &value.structural_path, 4_096)?;
    if value.structural_path.trim().is_empty() {
        return Err(TaskPackageError::InvalidPackage(
            "segment structural path is required".to_string(),
        ));
    }
    validate_sha256("source_hash", &value.source_hash)?;
    require_text("source_text", &value.source_text, MAX_TEXT_BYTES)?;
    require_text("target_text", &value.target_text, MAX_TEXT_BYTES)?;
    require_text("segment_state", &value.segment_state, 64)?;
    require_text("tags_json", &value.tags_json, MAX_TEXT_BYTES)?;
    require_text("workflow_state", &value.workflow_state, 128)?;
    require_text("comments_json", &value.comments_json, MAX_TEXT_BYTES)?;
    if !value.tags_json.is_empty() {
        serde_json::from_str::<Value>(&value.tags_json).map_err(|_| {
            TaskPackageError::InvalidPackage(format!(
                "tags JSON is invalid for segment {}",
                value.origin_segment_id
            ))
        })?;
    }
    if !value.comments_json.is_empty() {
        let comments = serde_json::from_str::<Value>(&value.comments_json).map_err(|_| {
            TaskPackageError::InvalidPackage(format!(
                "comments JSON is invalid for segment {}",
                value.origin_segment_id
            ))
        })?;
        let count = comments.as_array().ok_or_else(|| {
            TaskPackageError::InvalidPackage(format!(
                "comments JSON must be an array for segment {}",
                value.origin_segment_id
            ))
        })?;
        if count.len() > MAX_COMMENTS {
            return Err(TaskPackageError::ResourceLimit {
                resource: "comments",
                limit: MAX_COMMENTS as u64,
                actual: count.len() as u64,
            });
        }
    }
    Ok(())
}

fn require_id(field: &'static str, value: &str) -> Result<(), TaskPackageError> {
    if value.trim().is_empty() {
        return Err(TaskPackageError::InvalidInput(format!(
            "{field} is required"
        )));
    }
    if value.len() > MAX_ID_BYTES {
        return Err(TaskPackageError::ResourceLimit {
            resource: field,
            limit: MAX_ID_BYTES as u64,
            actual: value.len() as u64,
        });
    }
    Ok(())
}

fn require_text(field: &'static str, value: &str, limit: usize) -> Result<(), TaskPackageError> {
    if value.len() > limit {
        return Err(TaskPackageError::ResourceLimit {
            resource: field,
            limit: limit as u64,
            actual: value.len() as u64,
        });
    }
    Ok(())
}

fn validate_sha256(field: &'static str, value: &str) -> Result<(), TaskPackageError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(TaskPackageError::InvalidPackage(format!(
            "{field} is not a SHA-256 digest"
        )));
    }
    Ok(())
}

fn canonical_value(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let sorted = object
                .into_iter()
                .map(|(key, value)| (key, canonical_value(value)))
                .collect::<BTreeMap<_, _>>();
            let mut output = Map::new();
            for (key, value) in sorted {
                output.insert(key, value);
            }
            Value::Object(output)
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_value).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn projection(id: &str, target: &str, revision: u64) -> TaskPackageProjection {
        TaskPackageProjection {
            origin_document_id: "doc-1".to_string(),
            origin_segment_id: id.to_string(),
            ordinal: 0,
            structural_path: "txt:0".to_string(),
            source_hash: sha256_hex(b"source"),
            base_revision: revision,
            source_text: "Source".to_string(),
            target_text: target.to_string(),
            segment_state: "draft".to_string(),
            tags_json: "[]".to_string(),
            workflow_state: "translation".to_string(),
            comments_json: "[]".to_string(),
            projection_hash: String::new(),
        }
        .with_computed_hash()
        .expect("valid projection")
    }

    fn manifest() -> TaskPackageManifest {
        let mut value = TaskPackageManifest {
            format_version: TASK_PACKAGE_FORMAT_VERSION,
            package_id: "pkg-1".to_string(),
            kind: TaskPackageKind::Assignment,
            project_id: "project-1".to_string(),
            project_name: "Project".to_string(),
            source_locale: "en".to_string(),
            target_locale: "zh".to_string(),
            base_project_revision: 0,
            parent_package_id: None,
            instruction_sha256: None,
            documents: vec![TaskPackageDocumentRef {
                origin_document_id: "doc-1".to_string(),
                name: "source.txt".to_string(),
                format: "txt".to_string(),
                source_sha256: sha256_hex(b"source"),
                base_revision: 0,
                segment_count: 1,
            }],
            asset_slices: vec![],
            entries: vec![TaskPackageEntry {
                path: "manifest.json".to_string(),
                size_bytes: 1,
                sha256: sha256_hex(b"{}"),
            }],
            manifest_hash: String::new(),
        };
        value.manifest_hash = value.digest().expect("manifest digest");
        value
    }

    #[test]
    fn canonical_hash_is_stable_for_object_key_order() {
        let left = serde_json::json!({"b": 2, "a": {"d": 4, "c": 3}});
        let right = serde_json::json!({"a": {"c": 3, "d": 4}, "b": 2});
        assert_eq!(
            canonical_sha256(&left).unwrap(),
            canonical_sha256(&right).unwrap()
        );
    }

    #[test]
    fn manifest_validates_digest_and_limits() {
        let value = manifest();
        value.validate().expect("valid assignment manifest");
        let mut tampered = value.clone();
        tampered.project_name = "Changed".to_string();
        assert!(tampered.validate().is_err());
        let mut unsafe_path = value;
        unsafe_path.entries[0].path = "../secret".to_string();
        unsafe_path.manifest_hash = unsafe_path.digest().unwrap();
        assert!(unsafe_path.validate().is_err());
    }

    #[test]
    fn three_way_classifies_remote_local_and_both_changes() {
        let base = projection("s-1", "base", 1);
        let remote = projection("s-1", "remote", 1);
        let local = projection("s-1", "local", 2);
        let same_remote_local = projection("s-1", "same", 2);
        let remote_only =
            classify_three_way(Some(&base), Some(&base), Some(&remote), true, true).unwrap();
        assert_eq!(
            remote_only.disposition,
            TaskPackageDisposition::RemoteChanged
        );
        assert!(remote_only.safe_to_apply);
        let local_only =
            classify_three_way(Some(&base), Some(&local), Some(&base), true, true).unwrap();
        assert_eq!(local_only.disposition, TaskPackageDisposition::LocalChanged);
        let both =
            classify_three_way(Some(&base), Some(&local), Some(&remote), true, true).unwrap();
        assert_eq!(both.disposition, TaskPackageDisposition::BothChanged);
        assert!(!both.safe_to_apply);
        let identical = classify_three_way(
            Some(&base),
            Some(&same_remote_local),
            Some(&same_remote_local),
            true,
            true,
        )
        .unwrap();
        assert!(identical.safe_to_apply);
        assert!(identical.identical_change);
    }

    #[test]
    fn projection_hash_ignores_revision_metadata() {
        let first = projection("s-1", "same", 1);
        let second = projection("s-1", "same", 99);
        assert_eq!(first.projection_hash, second.projection_hash);
        let classification =
            classify_three_way(Some(&first), Some(&second), Some(&second), true, true).unwrap();
        assert_eq!(
            classification.disposition,
            TaskPackageDisposition::Unchanged
        );
    }

    #[test]
    fn invalid_tags_and_dependencies_override_change_classification() {
        let base = projection("s-1", "base", 1);
        let remote = projection("s-1", "remote", 1);
        let invalid_tag =
            classify_three_way(Some(&base), Some(&base), Some(&remote), false, true).unwrap();
        assert_eq!(invalid_tag.disposition, TaskPackageDisposition::TagInvalid);
        assert!(!invalid_tag.safe_to_apply);
        let missing =
            classify_three_way(Some(&base), Some(&base), Some(&remote), true, false).unwrap();
        assert_eq!(
            missing.disposition,
            TaskPackageDisposition::MissingDependency
        );
    }

    #[test]
    fn safe_paths_reject_windows_and_traversal_forms() {
        for path in ["../x", "/x", r"C:\\x", r"a\\b", "a//b", "a/./b"] {
            assert!(validate_safe_path(path).is_err(), "{path}");
        }
        validate_safe_path("documents/doc-1/source.txt").unwrap();
    }
}
