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

/// `qa.waive` — record a human decision about findings without pretending
/// they went away.
///
/// Waiving never edits the segment, never confirms it, and never writes TM:
/// the numbers still disagree, and the issue rows say so. The waiver sticks
/// exactly as long as later runs reproduce the same fingerprint (rule +
/// segment + evidence). When the evidence changes, the old row resolves and
/// the changed finding opens as a brand-new issue — a waiver never carries
/// over to evidence the user has not seen.
///
/// Exactly one selector must be provided:
///
/// - `issueId` — one issue. Waiving a resolved issue or restoring a
///   non-waived issue is a conflict.
/// - `ruleId` + `documentId` — every issue of that rule in the document.
/// - `segmentId` — every issue of that segment.
///
/// The batch selectors are operation granularity, not storage granularity:
/// each affected row records its own waiver, so audit and
/// fingerprint-invalidation semantics are identical to per-issue waiving.
/// Batches skip rows already in the requested state instead of erroring.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaWaiveParams {
    /// Selector: one issue by id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_id: Option<String>,
    /// Selector: every issue of this rule; requires `documentId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    /// Scope for `ruleId`. Per-rule waivers are document-scoped — never a
    /// hidden project-wide exemption.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    /// Selector: every issue of this segment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    /// `true` waives open issues; `false` restores waived issues to open.
    pub waived: bool,
    /// Optional free-form note. Deliberately not required: an empty or
    /// omitted note is a perfectly valid waiver.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaWaiveResult {
    /// Every issue the call changed, straight from the store. Clients
    /// replace their copies of these rows wholesale.
    pub issues: Vec<QaIssue>,
}
