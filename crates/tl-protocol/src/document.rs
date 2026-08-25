//! Document domain: import, listing, and export.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::{DegradationFinding, Document};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImportParams {
    pub project_id: String,
    pub source_path: String,
    /// Explicit filter id. When omitted, the engine probes registered filters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
    /// Path to a custom SRX ruleset used for sentence segmentation. When
    /// omitted together with `segmentation`, the project's stored default
    /// applies; when provided without `segmentation` it implies sentence
    /// mode. An explicit `segmentation` makes the params the complete
    /// choice, so `srxPath: null` then means the built-in rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srx_path: Option<String>,
    /// Segmentation mode: `sentence` or `paragraph`. When omitted together
    /// with `srxPath`, the project's stored default applies (falling back
    /// to sentence with built-in rules).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segmentation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImportResult {
    pub document: Document,
    pub segment_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentListParams {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentListResult {
    pub documents: Vec<Document>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExportParams {
    pub document_id: String,
    pub output_path: String,
    /// Embed per-paragraph grid-segment anchors into the exported artifact so
    /// a layout preview can map clicks back to segments. Preview aid; filters
    /// without anchor support ignore it. Defaults to a plain export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_anchors: Option<bool>,
    /// Replace an existing destination file (staged sibling temp + atomic
    /// rename). Defaults to false: the export is refused with `exportBlocked`
    /// when the path exists. Even with overwrite, the engine refuses paths
    /// inside its own managed data directory — it cannot tell who owns an
    /// arbitrary file on disk, but its own project data it can protect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExportResult {
    pub output_path: String,
    pub translated_segments: u32,
    pub degradation: Vec<DegradationFinding>,
}
