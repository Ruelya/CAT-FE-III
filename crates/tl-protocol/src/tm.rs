//! Translation-memory domain.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::TmEntry;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TmMatchGrade {
    /// Normalized source text matches exactly.
    Exact,
    /// Exact source and matching neighbour context. Reserved for later phases.
    InContext,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLookupResult {
    pub matches: Vec<TmMatchItem>,
}
