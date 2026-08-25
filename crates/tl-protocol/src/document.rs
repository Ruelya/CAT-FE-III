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
    /// omitted, the built-in rules for the project source locale apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srx_path: Option<String>,
    /// Segmentation mode: `sentence` (default) or `paragraph`.
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExportResult {
    pub output_path: String,
    pub translated_segments: u32,
    pub degradation: Vec<DegradationFinding>,
}
