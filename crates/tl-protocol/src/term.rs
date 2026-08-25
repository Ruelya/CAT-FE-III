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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermListResult {
    pub entries: Vec<TermEntry>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseExportResult {
    pub output_path: String,
    pub exported: u32,
}
