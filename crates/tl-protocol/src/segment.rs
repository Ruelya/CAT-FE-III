//! Segment domain: the editing grid.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::{Segment, TmEntry};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListParams {
    pub document_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListResult {
    pub segments: Vec<Segment>,
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
