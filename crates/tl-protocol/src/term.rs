//! Terminology domain: termbases, entries, mounts, and lookup.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_asset::{TermEntry, TermMatch, Termbase, TermbaseMount};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseCreateParams {
    pub name: String,
    pub source_locale: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseListParams {
    /// When set, `mounts` is restricted to this project.
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseListResult {
    pub termbases: Vec<Termbase>,
    pub mounts: Vec<TermbaseMount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseAttachParams {
    pub project_id: String,
    pub termbase_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseAttachResult {
    pub mount: TermbaseMount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseDetachParams {
    pub project_id: String,
    pub termbase_id: String,
}

/// Carries the removed mount. Detaching a termbase that is not attached fails
/// with `notFound` instead of pretending success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseDetachResult {
    pub mount: TermbaseMount,
}

/// `termbase.update` — edit one mount: enable/disable the read path
/// (`term.lookup` and QA only consult enabled mounts), flip the per-mount
/// write switch, and/or move the mount to a new priority position. Omitted
/// fields stay unchanged; an all-omitted update is `invalidParams`.
///
/// Unlike TM mounts there is no single-writable invariant: `termbase.attach`
/// mounts every termbase writable, several writable mounts are the normal
/// state, and `writable` here is a per-mount switch. Term additions target
/// the first writable mount in priority order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseUpdateParams {
    pub project_id: String,
    pub termbase_id: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub writable: Option<bool>,
    /// Target position in the project's mount list (0 = highest priority).
    /// Values past the end clamp to the last position. Sibling mounts are
    /// renumbered to keep priorities contiguous.
    #[serde(default)]
    pub priority: Option<u32>,
}

/// The project's mounts after the edit, in priority order — a priority
/// move renumbers siblings, so one mount alone would hide real changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseUpdateResult {
    pub mounts: Vec<TermbaseMount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermAddParams {
    pub termbase_id: String,
    pub source_term: String,
    pub target_term: String,
    pub target_locale: String,
    /// Marks the target as forbidden instead of preferred.
    #[serde(default)]
    pub forbidden: bool,
    #[serde(default)]
    pub definition: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermAddResult {
    pub entry: TermEntry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermUpdateParams {
    pub entry_id: String,
    /// New source term for the entry. Left unchanged when omitted.
    #[serde(default)]
    pub source_term: Option<String>,
    /// Translation being edited. Required for `target_term` / `forbidden`.
    #[serde(default)]
    pub translation_id: Option<String>,
    /// New term text for the selected translation.
    #[serde(default)]
    pub target_term: Option<String>,
    /// Marks the selected translation as forbidden (or preferred again).
    #[serde(default)]
    pub forbidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermUpdateResult {
    pub entry: TermEntry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermDeleteParams {
    pub entry_id: String,
    /// When set, removes only this translation and keeps the entry.
    #[serde(default)]
    pub translation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermDeleteResult {
    /// The surviving entry after a translation-level delete; `None` when the
    /// whole entry was removed.
    pub entry: Option<TermEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermListParams {
    pub termbase_id: String,
    /// Entries to skip in source-term order; defaults to 0.
    #[serde(default)]
    pub offset: Option<u32>,
    /// Page size. When omitted every entry from `offset` on is returned,
    /// which is the pre-paging behavior existing clients rely on.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermListResult {
    /// One window of entries in source-term order.
    pub entries: Vec<TermEntry>,
    /// Entries in the termbase before the page window was applied, so
    /// clients can page honestly.
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermLookupParams {
    pub project_id: String,
    pub source_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermLookupResult {
    /// Hits over the normalized source text, ordered by span position. Spans
    /// are Unicode-scalar offsets into the normalized text.
    pub matches: Vec<TermMatch>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TermExchangeFormat {
    Csv,
    Tsv,
    Tbx,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseImportParams {
    pub termbase_id: String,
    pub path: String,
    /// Fallback target locale for rows/entries that do not carry one.
    pub target_locale: String,
    /// Explicit exchange format. When omitted, inferred from the extension.
    #[serde(default)]
    pub format: Option<TermExchangeFormat>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseImportResult {
    /// Entries read from the file.
    pub imported: u32,
    /// New term entries created.
    pub added: u32,
    /// Existing entries that gained or refreshed translations.
    pub merged: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseExportParams {
    pub termbase_id: String,
    pub path: String,
    #[serde(default)]
    pub format: Option<TermExchangeFormat>,
    /// Replace an existing destination file (staged sibling temp + atomic
    /// rename). Defaults to false: the export is refused with `exportBlocked`
    /// when the path exists. Even with overwrite, the engine refuses paths
    /// inside its own managed data directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseExportResult {
    pub output_path: String,
    pub exported: u32,
}
