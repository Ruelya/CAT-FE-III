//! QA domain: deterministic checks over document segments.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::QaIssue;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRunParams {
    pub document_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRunResult {
    pub checked_segments: u32,
    pub open_issues: u32,
    pub issues: Vec<QaIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaListParams {
    pub document_id: String,
    /// Issues to skip in list order (open first, then oldest); defaults to 0.
    #[serde(default)]
    pub offset: Option<u32>,
    /// Page size. When omitted every issue from `offset` on is returned,
    /// which is the pre-paging behavior existing clients rely on.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaListResult {
    /// One window of the document's issues: open first, then waived, then
    /// resolved.
    pub issues: Vec<QaIssue>,
    /// Issues for the document before the page window was applied, so
    /// clients can page honestly.
    pub total: u32,
}

/// `qa.waive` — record a human decision about one issue without pretending
/// the finding went away.
///
/// Waiving never edits the segment, never confirms it, and never writes TM:
/// the numbers still disagree, and the issue row says so. The waiver sticks
/// exactly as long as later runs reproduce the same fingerprint (rule +
/// segment + evidence). When the evidence changes, the old row resolves and
/// the changed finding opens as a brand-new issue — a waiver never carries
/// over to evidence the user has not seen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaWaiveParams {
    pub issue_id: String,
    /// `true` waives an open issue; `false` restores a waived issue to open.
    pub waived: bool,
    /// Optional free-form note. Deliberately not required: an empty or
    /// omitted note is a perfectly valid waiver.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaWaiveResult {
    /// The issue after the status change, straight from the store.
    pub issue: QaIssue,
}
