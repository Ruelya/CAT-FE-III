//! Wire contracts for local discussion threads and named project snapshots.
//!
//! The payloads are intentionally additive. Rust/Engine owns scope validation,
//! mention extraction, snapshot hashing, and restore transactions; the
//! renderer only renders these generated projections.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DiscussionScope {
    Project,
    Document,
    Segment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DiscussionStatus {
    Open,
    Resolved,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThread {
    pub id: String,
    pub project_id: String,
    pub scope: DiscussionScope,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub segment_id: Option<String>,
    pub title: String,
    pub status: DiscussionStatus,
    pub revision: u64,
    pub message_count: u32,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub resolved_at_ms: Option<i64>,
    #[serde(default)]
    pub resolved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessage {
    pub id: String,
    pub thread_id: String,
    pub ordinal: u32,
    pub actor: String,
    pub body: String,
    pub mentions: Vec<String>,
    pub revision: u64,
    pub thread_revision: u64,
    pub deleted: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThreadListParams {
    pub project_id: String,
    #[serde(default)]
    pub scope: Option<DiscussionScope>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub segment_id: Option<String>,
    #[serde(default)]
    pub include_resolved: bool,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThreadPage {
    pub items: Vec<DiscussionThread>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThreadCreateParams {
    pub project_id: String,
    pub scope: DiscussionScope,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub segment_id: Option<String>,
    #[serde(default)]
    pub title: String,
    pub body: String,
    pub actor: String,
    pub reason: String,
    pub expected_project_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThreadResolveParams {
    pub thread_id: String,
    pub resolved: bool,
    pub expected_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessageListParams {
    pub thread_id: String,
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessagePage {
    pub items: Vec<DiscussionMessage>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessageCreateParams {
    pub thread_id: String,
    pub body: String,
    pub actor: String,
    pub reason: String,
    pub expected_thread_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessageUpdateParams {
    pub message_id: String,
    pub body: String,
    pub actor: String,
    pub reason: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessageDeleteParams {
    pub message_id: String,
    pub actor: String,
    pub reason: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NamedProjectSnapshot {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub base_project_revision: u64,
    pub state_hash: String,
    pub document_count: u32,
    pub segment_count: u32,
    pub thread_count: u32,
    pub created_at_ms: i64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotListParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotPage {
    pub items: Vec<NamedProjectSnapshot>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotGetParams {
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotCreateParams {
    pub project_id: String,
    pub name: String,
    pub expected_project_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotPreviewRestoreParams {
    pub snapshot_id: String,
    pub expected_project_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ProjectSnapshotPreviewStatus {
    Open,
    Applied,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotChangeSummary {
    pub documents_added: u32,
    pub documents_removed: u32,
    pub documents_changed: u32,
    pub segments_added: u32,
    pub segments_removed: u32,
    pub segments_changed: u32,
    pub comments_changed: u32,
    pub reviews_changed: u32,
    pub discussions_changed: u32,
    pub mounts_added: u32,
    pub mounts_removed: u32,
    pub mounts_changed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotPreview {
    pub preview_id: String,
    pub snapshot_id: String,
    pub project_id: String,
    pub expected_project_revision: u64,
    pub current_project_revision: u64,
    pub current_state_hash: String,
    pub status: ProjectSnapshotPreviewStatus,
    pub summary: ProjectSnapshotChangeSummary,
    pub missing_dependency_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotRestoreParams {
    pub preview_id: String,
    pub expected_project_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotRestoreResult {
    pub preview_id: String,
    pub snapshot_id: String,
    pub status: ProjectSnapshotPreviewStatus,
    pub project_revision: u64,
    pub summary: ProjectSnapshotChangeSummary,
    #[serde(default)]
    pub operation_id: Option<String>,
}

fn default_page_size() -> u32 {
    50
}
