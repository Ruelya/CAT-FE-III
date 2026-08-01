//! Wire contracts for lightweight collaboration primitives.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{default_actor, default_page_size};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CollabRole {
    Owner,
    Member,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CollabAssignmentStatus {
    Open,
    Completed,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabProjectParams {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabMemberAddParams {
    pub project_id: String,
    pub actor_id: String,
    pub role: CollabRole,
    #[serde(default = "default_actor")]
    pub acting_actor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabMemberRemoveParams {
    pub project_id: String,
    pub actor_id: String,
    #[serde(default = "default_actor")]
    pub acting_actor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabMember {
    pub project_id: String,
    pub actor_id: String,
    pub role: CollabRole,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabMemberListResult {
    pub items: Vec<CollabMember>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabLockAcquireParams {
    pub project_id: String,
    pub document_id: String,
    pub segment_id: String,
    #[serde(default = "default_actor")]
    pub actor_id: String,
    #[serde(default)]
    pub ttl_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabLockActorParams {
    pub segment_id: String,
    #[serde(default = "default_actor")]
    pub actor_id: String,
    #[serde(default)]
    pub ttl_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabLock {
    pub segment_id: String,
    pub project_id: String,
    pub document_id: String,
    pub actor_id: String,
    pub expires_at_ms: i64,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabLockListResult {
    pub items: Vec<CollabLock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabPresenceHeartbeatParams {
    pub project_id: String,
    #[serde(default = "default_actor")]
    pub actor_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub segment_id: Option<String>,
    #[serde(default)]
    pub ttl_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabPresence {
    pub project_id: String,
    pub actor_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    pub expires_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabPresenceListResult {
    pub items: Vec<CollabPresence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabAssignmentCreateParams {
    pub project_id: String,
    pub document_id: String,
    pub assignee_actor_id: String,
    pub ordinal_start: u32,
    pub ordinal_end: u32,
    #[serde(default)]
    pub due_at_ms: Option<i64>,
    #[serde(default = "default_actor")]
    pub created_by: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabAssignmentCompleteParams {
    pub assignment_id: String,
    pub expected_revision: u64,
    #[serde(default = "default_actor")]
    pub actor_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabAssignment {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub assignee_actor_id: String,
    pub ordinal_start: u32,
    pub ordinal_end: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at_ms: Option<i64>,
    pub status: CollabAssignmentStatus,
    pub revision: u64,
    pub created_by: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabAssignmentListResult {
    pub items: Vec<CollabAssignment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollabOpLogListParams {
    pub project_id: String,
    #[serde(default)]
    pub after_sequence: u64,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabOpLogEntry {
    pub id: String,
    pub project_id: String,
    pub sequence: u64,
    pub kind: String,
    pub payload: Value,
    pub actor_id: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabOpLogPage {
    pub items: Vec<CollabOpLogEntry>,
    pub total: u32,
    pub after_sequence: u64,
    pub limit: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn assignment_complete_requires_expected_revision() {
        let ok: CollabAssignmentCompleteParams = serde_json::from_value(json!({
            "assignmentId": "assign-1",
            "expectedRevision": 0,
            "actorId": "bob"
        }))
        .expect("expectedRevision present must deserialize");
        assert_eq!(ok.expected_revision, 0);

        assert!(
            serde_json::from_value::<CollabAssignmentCompleteParams>(json!({
                "assignmentId": "assign-1",
                "actorId": "bob"
            }))
            .is_err(),
            "missing expectedRevision must be rejected"
        );
        assert!(
            serde_json::from_value::<CollabAssignmentCompleteParams>(json!({
                "assignmentId": "assign-1",
                "expectedRevision": null,
                "actorId": "bob"
            }))
            .is_err(),
            "null expectedRevision must be rejected"
        );
    }
}
