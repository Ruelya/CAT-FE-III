//! QA domain: deterministic checks over document segments.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::{QaIssue, QaRuleSettings, QaSeverity, Segment};

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

/// `qa.fix.list` — the engine-proposed corrections for a document's open
/// findings (PRD S3 ④).
///
/// Corrections are recomputed from each segment's *current* target text at
/// call time, never persisted: a stale issue whose text was already edited
/// simply stops producing one. Only mechanically fixable rules propose
/// anything (edge whitespace, CJK half-width punctuation and the ASCII
/// ellipsis, adjacent repeated words, the unambiguous single-number
/// mismatch); a finding without a correction is honestly absent from the
/// list. Locked segments are shielded — their findings never offer a fix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaFixListParams {
    pub document_id: String,
}

/// One engine-proposed correction. The client previews `fixedTargetText`
/// verbatim and applies it through `qa.fix.apply` — it never invents or
/// edits replacement text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaFix {
    pub issue_id: String,
    pub segment_id: String,
    pub rule_id: String,
    /// Segment revision the fix was computed against; pass it as
    /// `baseRevision` to `qa.fix.apply`.
    pub base_revision: u64,
    /// The target text the fix replaces (the segment's current text).
    pub current_target_text: String,
    /// The full replacement target text, applied verbatim.
    pub fixed_target_text: String,
    /// Short English description of the mechanical change; clients
    /// localize by `ruleId`, like issue messages.
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaFixListResult {
    pub fixes: Vec<QaFix>,
}

/// `qa.fix.apply` — apply one correction through the exact `segment.update`
/// guards: a stale `baseRevision` conflicts, a locked segment conflicts,
/// and a confirmed segment honestly returns to draft. The engine recomputes
/// the correction from the current text (a finding without one conflicts);
/// the segment's QA refreshes in the same transaction. Applying never
/// confirms and never writes TM.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaFixApplyParams {
    pub issue_id: String,
    /// Optimistic concurrency: must match the segment's current revision.
    pub base_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaFixApplyResult {
    pub segment: Segment,
    /// The segment's full issue list after the same-transaction refresh.
    pub qa_issues: Vec<QaIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileGetParams {
    pub project_id: String,
}

/// The QA profile the engine will actually run for one project: the
/// resolved built-in base plus the project-level overrides layered on it.
/// Built-in profiles are immutable; the project layer is a clone-then-
/// override (memoQ convention), stored in the project configuration.
///
/// Returned by both `qa.profile.get` and `qa.profile.update`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileView {
    /// The built-in profile the project resolves to (configured id when it
    /// names a built-in, otherwise the target-locale default).
    pub base_profile_id: String,
    /// Project-level severity remaps (rule id → severity), layered over the
    /// base profile's table. Built-in profiles ship without remaps, so this
    /// is also the effective table.
    pub severity_overrides: BTreeMap<String, QaSeverity>,
    /// Effective settings: the project replacement when one is stored,
    /// otherwise the base profile's own values.
    pub settings: QaRuleSettings,
    /// Whether `document.export` refuses while error-severity open issues
    /// exist. Off by default.
    pub block_export_on_error: bool,
    /// Project revision, for `qa.profile.update` optimistic concurrency.
    pub revision: u64,
}

/// `qa.profile.update` — write the project-level QA overrides. Omitted
/// fields keep their stored values; provided fields replace them wholesale
/// (`severityOverrides: {}` clears every remap). The engine compiles the
/// merged profile before storing anything, so a configuration that cannot
/// run is rejected instead of persisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileUpdateParams {
    pub project_id: String,
    /// Optimistic concurrency: must match the project's current revision.
    pub base_revision: u64,
    /// Replacement severity remap table. Keys must be rule ids
    /// (`qa.`-prefixed, including parameterized `qa.term-*:<id>` /
    /// `qa.regex:<id>` forms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity_overrides: Option<BTreeMap<String, QaSeverity>>,
    /// Replacement settings. `null` inside the option is not expressible —
    /// send `clearSettings: true` to drop the project replacement and
    /// return to the base profile's values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<QaRuleSettings>,
    /// Drop the stored settings replacement (mutually exclusive with
    /// `settings`).
    #[serde(default)]
    pub clear_settings: bool,
    /// Toggle the export gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_export_on_error: Option<bool>,
}
