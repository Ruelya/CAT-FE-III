//! Wire contracts for offline `.tltask` packages.
//!
//! The package payload and projection models are shared with the pure
//! task-package core.  This module owns only the RPC request/result surface;
//! Engine remains responsible for filesystem and persistence semantics.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use translunar_domain::{Document, Project};

pub use translunar_task_package_core::{
    TaskPackageAssetRow, TaskPackageAssetSlicePayload, TaskPackageClassification,
    TaskPackageDisposition, TaskPackageDocumentPayload, TaskPackageDocumentRef, TaskPackageEntry,
    TaskPackageKind, TaskPackageManifest, TaskPackageProjection, TaskPackageReturnPayload,
    TaskPackageReturnRow,
};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDocumentSelection {
    pub document_id: String,
    #[serde(default)]
    pub segment_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssetSelection {
    /// `tm` or `termbase` (the `tb` alias is accepted by Engine).
    pub kind: String,
    pub library_id: String,
    #[serde(default)]
    pub row_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageExportParams {
    pub kind: TaskPackageKind,
    pub destination_path: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub expected_project_revision: Option<u64>,
    #[serde(default)]
    pub documents: Vec<TaskPackageDocumentSelection>,
    #[serde(default)]
    pub asset_slices: Vec<TaskPackageAssetSelection>,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub working_project_id: Option<String>,
    #[serde(default)]
    pub parent_package_id: Option<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewParams {
    #[serde(default)]
    pub package_path: Option<String>,
    #[serde(default)]
    pub preview_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageImportParams {
    pub preview_id: String,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageApplyParams {
    pub preview_id: String,
    pub expected_project_revision: u64,
    pub selected_row_ids: Vec<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDiscardParams {
    pub package_id: String,
    #[serde(default)]
    pub preview_id: Option<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageResult {
    pub package_id: String,
    pub kind: TaskPackageKind,
    pub package_path: String,
    pub package_sha256: String,
    pub manifest_hash: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewCounts {
    pub total: u32,
    pub unchanged: u32,
    pub remote_changed: u32,
    pub local_changed: u32,
    pub both_changed: u32,
    pub deleted: u32,
    pub added: u32,
    pub tag_invalid: u32,
    pub missing_dependency: u32,
    #[serde(default)]
    pub document_revisions: std::collections::BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub row_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewRow {
    pub row_id: String,
    pub ordinal: u32,
    pub origin_document_id: String,
    pub origin_segment_id: String,
    pub disposition: TaskPackageDisposition,
    pub reason: String,
    pub safe_to_apply: bool,
    pub identical_change: bool,
    pub selected: bool,
    #[serde(default)]
    pub base_hash: Option<String>,
    #[serde(default)]
    pub current_hash: Option<String>,
    #[serde(default)]
    pub remote_hash: Option<String>,
    #[serde(default)]
    pub current_revision: Option<u64>,
    #[serde(default)]
    pub remote_revision: Option<u64>,
    #[serde(default)]
    pub base_projection: Option<TaskPackageProjection>,
    #[serde(default)]
    pub current_projection: Option<TaskPackageProjection>,
    #[serde(default)]
    pub remote_projection: Option<TaskPackageProjection>,
    #[serde(default)]
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewResult {
    pub preview_id: String,
    pub package_id: String,
    pub kind: TaskPackageKind,
    pub project_id: String,
    pub expected_project_revision: u64,
    pub status: String,
    pub manifest_hash: String,
    pub counts: TaskPackagePreviewCounts,
    pub diagnostics: Vec<TaskPackageDiagnostic>,
    pub rows: Vec<TaskPackagePreviewRow>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageImportResult {
    pub package_id: String,
    pub preview_id: String,
    pub project: Project,
    pub documents: Vec<Document>,
    pub binding_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageApplyResult {
    pub preview_id: String,
    pub status: String,
    pub selected_count: u32,
    pub applied_count: u32,
    pub skipped_count: u32,
    pub project_revision: u64,
    pub document_revisions: std::collections::BTreeMap<String, u64>,
    pub segment_ids: Vec<String>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDiscardResult {
    pub package_id: String,
    #[serde(default)]
    pub preview_id: Option<String>,
    pub status: String,
    pub removed_staged_file: bool,
}

fn default_page_size() -> u32 {
    50
}
