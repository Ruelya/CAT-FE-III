//! Translation-memory domain.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::{Segment, TmEntry};

/// Default result cap applied when a lookup omits `limit`.
pub const TM_LOOKUP_DEFAULT_LIMIT: u32 = 20;
/// Hard ceiling on an explicit lookup `limit`.
pub const TM_LOOKUP_MAX_LIMIT: u32 = 500;
/// Default page size applied when `tm.list` omits `limit`.
pub const TM_LIST_DEFAULT_LIMIT: u32 = 100;
/// Hard ceiling on an explicit `tm.list` `limit`.
pub const TM_LIST_MAX_LIMIT: u32 = 500;
/// Default fuzzy floor applied when a lookup omits `min_score`.
pub const TM_LOOKUP_DEFAULT_MIN_SCORE: u8 = 60;
/// Default threshold applied when pretranslation omits `min_score`.
pub const TM_PRETRANSLATE_DEFAULT_MIN_SCORE: u8 = 75;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TmMatchGrade {
    /// Normalized source text matches exactly.
    Exact,
    /// Exact source and matching neighbour context. Reserved for later phases.
    InContext,
    /// Recalled by similarity; score reflects the fuzzy match quality.
    Fuzzy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmMatchItem {
    pub entry: TmEntry,
    /// 0..=100.
    pub score: u8,
    pub grade: TmMatchGrade,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLookupParams {
    pub project_id: String,
    pub source_text: String,
    /// Maximum matches to return; defaults to [`TM_LOOKUP_DEFAULT_LIMIT`].
    #[serde(default)]
    pub limit: Option<u32>,
    /// Fuzzy score floor (1..=100); defaults to
    /// [`TM_LOOKUP_DEFAULT_MIN_SCORE`]. Exact matches always pass.
    #[serde(default)]
    pub min_score: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLookupResult {
    pub matches: Vec<TmMatchItem>,
    /// Total candidates that met the floor before the limit was applied, so
    /// clients can tell when a `limit` cut the list short.
    pub total_matches: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmListParams {
    pub project_id: String,
    /// Case-insensitive substring filter over source and target text.
    #[serde(default)]
    pub query: Option<String>,
    /// Page size (1..=[`TM_LIST_MAX_LIMIT`]); defaults to
    /// [`TM_LIST_DEFAULT_LIMIT`].
    #[serde(default)]
    pub limit: Option<u32>,
    /// Entries to skip before the page starts; defaults to 0.
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmListResult {
    /// One page of entries, most recently confirmed first.
    pub entries: Vec<TmEntry>,
    /// Entries that matched the filter before `offset`/`limit`, so clients
    /// can page honestly.
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmUpdateParams {
    pub entry_id: String,
    pub source_text: String,
    pub target_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmUpdateResult {
    pub entry: TmEntry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmDeleteParams {
    pub entry_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmDeleteResult {
    /// The removed entry, echoed so clients can report what was deleted.
    pub entry: TmEntry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TmExchangeFormat {
    Tmx,
    Csv,
    Tsv,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmImportParams {
    pub project_id: String,
    pub path: String,
    /// Explicit exchange format. When omitted, inferred from the extension.
    #[serde(default)]
    pub format: Option<TmExchangeFormat>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmImportResult {
    /// Units read from the file.
    pub imported: u32,
    /// New TM entries created.
    pub added: u32,
    /// Existing entries whose target was replaced.
    pub updated: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmExportParams {
    pub project_id: String,
    pub path: String,
    #[serde(default)]
    pub format: Option<TmExchangeFormat>,
    /// Replace an existing destination file (staged sibling temp + atomic
    /// rename). Defaults to false: the export is refused with `exportBlocked`
    /// when the path exists. Even with overwrite, the engine refuses paths
    /// inside its own managed data directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmExportResult {
    pub output_path: String,
    pub exported: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmPretranslateParams {
    pub document_id: String,
    /// Score threshold (1..=100) a match must reach to be applied; defaults
    /// to [`TM_PRETRANSLATE_DEFAULT_MIN_SCORE`].
    #[serde(default)]
    pub min_score: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmPretranslateResult {
    /// Untranslated segments examined.
    pub checked: u32,
    /// Segments filled from the TM (exact + fuzzy).
    pub pretranslated: u32,
    pub exact: u32,
    pub fuzzy: u32,
    /// The segments that changed, at their new revisions.
    pub segments: Vec<Segment>,
}
