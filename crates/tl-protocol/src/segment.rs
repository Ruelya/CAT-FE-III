//! Segment domain: the editing grid.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::{Segment, TmEntry};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListParams {
    pub document_id: String,
    /// Rows to skip in ordinal order; defaults to 0.
    #[serde(default)]
    pub offset: Option<u32>,
    /// Page size. When omitted the whole document is returned, which is the
    /// pre-paging behavior existing clients rely on.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListResult {
    pub segments: Vec<Segment>,
    /// Segments in the document before the page window was applied, so
    /// clients can size scrollbars without fetching every row.
    pub total_segments: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentUpdateParams {
    pub segment_id: String,
    pub target_text: String,
    /// Optimistic concurrency: must match the segment's current revision.
    pub base_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentUpdateResult {
    pub segment: Segment,
}

/// Parameters for `segment.replace`: one document-wide search-and-replace
/// over target text. Matching is case-insensitive with per-character
/// Unicode lowercase folding — the same semantics as the grid find box —
/// and occurrences never overlap. Source text is never touched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentReplaceParams {
    pub document_id: String,
    /// Text to find in target text. Must not be empty.
    pub find: String,
    /// Replacement text. May be empty, which deletes the found text; a
    /// target emptied this way honestly returns to `untranslated`.
    pub replace_with: String,
    /// Also rewrite confirmed segments. A rewritten confirmed segment moves
    /// back to `draft` — the confirmation covered the old text — and its TM
    /// entry is left as it was (replace drafts, it never confirms). Default
    /// false: confirmed matches are skipped and counted instead.
    #[serde(default)]
    pub include_confirmed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentReplaceResult {
    /// Rewritten segments in grid order, carrying their new revision and
    /// state, so clients can apply them without a full reload.
    pub segments: Vec<Segment>,
    /// Total occurrences replaced across `segments`.
    pub replaced_occurrences: u32,
    /// How many of `segments` were confirmed before this replace moved them
    /// back to draft. Non-zero only with `includeConfirmed`.
    pub demoted_confirmed: u32,
    /// Matching confirmed segments left untouched because
    /// `includeConfirmed` was not set.
    pub skipped_confirmed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentConfirmParams {
    pub segment_id: String,
    pub base_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentConfirmResult {
    pub segment: Segment,
    /// The translation-memory entry written by the confirmation.
    pub tm_entry: TmEntry,
    /// Sibling segments auto-filled from the confirmed translation.
    pub propagated: Vec<Segment>,
}
