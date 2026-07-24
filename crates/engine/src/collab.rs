use translunar_protocol::{
    CollabAssignment, CollabAssignmentCompleteParams, CollabAssignmentCreateParams,
    CollabAssignmentListResult, CollabAssignmentStatus, CollabLock, CollabLockAcquireParams,
    CollabLockActorParams, CollabLockListResult, CollabMember, CollabMemberAddParams,
    CollabMemberListResult, CollabMemberRemoveParams, CollabOpLogEntry, CollabOpLogListParams,
    CollabOpLogPage, CollabPresence, CollabPresenceHeartbeatParams, CollabPresenceListResult,
    CollabProjectParams, CollabRole, EmptyResult,
};
use translunar_storage::{AssignmentStatus, CollabRole as StoreRole};

use crate::{EngineService, Result};

impl EngineService {
    pub fn list_collab_members(
        &self,
        params: CollabProjectParams,
    ) -> Result<CollabMemberListResult> {
        let items = self
            .store
            .list_collab_members(&params.project_id)?
            .into_iter()
            .map(to_member)
            .collect();
        Ok(CollabMemberListResult { items })
    }

    pub fn add_collab_member(&mut self, params: CollabMemberAddParams) -> Result<CollabMember> {
        Ok(to_member(self.store.add_collab_member(
            &params.project_id,
            &params.actor_id,
            to_store_role(params.role),
            &params.acting_actor,
        )?))
    }

    pub fn remove_collab_member(
        &mut self,
        params: CollabMemberRemoveParams,
    ) -> Result<EmptyResult> {
        self.store.remove_collab_member(
            &params.project_id,
            &params.actor_id,
            &params.acting_actor,
        )?;
        Ok(EmptyResult::default())
    }

    pub fn acquire_collab_lock(&mut self, params: CollabLockAcquireParams) -> Result<CollabLock> {
        Ok(to_lock(self.store.acquire_segment_lock(
            &params.project_id,
            &params.document_id,
            &params.segment_id,
            &params.actor_id,
            params.ttl_ms,
        )?))
    }

    pub fn release_collab_lock(&mut self, params: CollabLockActorParams) -> Result<EmptyResult> {
        self.store
            .release_segment_lock(&params.segment_id, &params.actor_id)?;
        Ok(EmptyResult::default())
    }

    pub fn heartbeat_collab_lock(&mut self, params: CollabLockActorParams) -> Result<CollabLock> {
        Ok(to_lock(self.store.heartbeat_segment_lock(
            &params.segment_id,
            &params.actor_id,
            params.ttl_ms,
        )?))
    }

    pub fn list_collab_locks(&self, params: CollabProjectParams) -> Result<CollabLockListResult> {
        Ok(CollabLockListResult {
            items: self
                .store
                .list_segment_locks(&params.project_id)?
                .into_iter()
                .map(to_lock)
                .collect(),
        })
    }

    pub fn collab_presence_heartbeat(
        &mut self,
        params: CollabPresenceHeartbeatParams,
    ) -> Result<CollabPresence> {
        Ok(to_presence(self.store.presence_heartbeat(
            &params.project_id,
            &params.actor_id,
            params.document_id,
            params.segment_id,
            params.ttl_ms,
        )?))
    }

    pub fn list_collab_presence(
        &self,
        params: CollabProjectParams,
    ) -> Result<CollabPresenceListResult> {
        Ok(CollabPresenceListResult {
            items: self
                .store
                .list_presence(&params.project_id)?
                .into_iter()
                .map(to_presence)
                .collect(),
        })
    }

    pub fn list_collab_assignments(
        &self,
        params: CollabProjectParams,
    ) -> Result<CollabAssignmentListResult> {
        Ok(CollabAssignmentListResult {
            items: self
                .store
                .list_assignments(&params.project_id)?
                .into_iter()
                .map(to_assignment)
                .collect(),
        })
    }

    pub fn create_collab_assignment(
        &mut self,
        params: CollabAssignmentCreateParams,
    ) -> Result<CollabAssignment> {
        Ok(to_assignment(self.store.create_assignment(
            &params.project_id,
            &params.document_id,
            &params.assignee_actor_id,
            params.ordinal_start,
            params.ordinal_end,
            params.due_at_ms,
            &params.created_by,
        )?))
    }

    pub fn complete_collab_assignment(
        &mut self,
        params: CollabAssignmentCompleteParams,
    ) -> Result<CollabAssignment> {
        Ok(to_assignment(self.store.complete_assignment(
            &params.assignment_id,
            params.expected_revision,
            &params.actor_id,
        )?))
    }

    pub fn list_collab_ops(&self, params: CollabOpLogListParams) -> Result<CollabOpLogPage> {
        let (items, total) =
            self.store
                .list_collab_ops(&params.project_id, params.after_sequence, params.limit)?;
        Ok(CollabOpLogPage {
            items: items
                .into_iter()
                .map(|item| CollabOpLogEntry {
                    id: item.id,
                    project_id: item.project_id,
                    sequence: item.sequence,
                    kind: item.kind,
                    payload: item.payload,
                    actor_id: item.actor_id,
                    created_at_ms: item.created_at_ms,
                })
                .collect(),
            total,
            after_sequence: params.after_sequence,
            limit: params.limit.clamp(1, 200),
        })
    }
}

fn to_store_role(role: CollabRole) -> StoreRole {
    match role {
        CollabRole::Owner => StoreRole::Owner,
        CollabRole::Member => StoreRole::Member,
    }
}

fn to_member(record: translunar_storage::CollabMemberRecord) -> CollabMember {
    CollabMember {
        project_id: record.project_id,
        actor_id: record.actor_id,
        role: match record.role {
            StoreRole::Owner => CollabRole::Owner,
            StoreRole::Member => CollabRole::Member,
        },
        created_at_ms: record.created_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
}

fn to_lock(record: translunar_storage::CollabLockRecord) -> CollabLock {
    CollabLock {
        segment_id: record.segment_id,
        project_id: record.project_id,
        document_id: record.document_id,
        actor_id: record.actor_id,
        expires_at_ms: record.expires_at_ms,
        revision: record.revision,
        created_at_ms: record.created_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
}

fn to_presence(record: translunar_storage::CollabPresenceRecord) -> CollabPresence {
    CollabPresence {
        project_id: record.project_id,
        actor_id: record.actor_id,
        document_id: record.document_id,
        segment_id: record.segment_id,
        expires_at_ms: record.expires_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
}

fn to_assignment(record: translunar_storage::CollabAssignmentRecord) -> CollabAssignment {
    CollabAssignment {
        id: record.id,
        project_id: record.project_id,
        document_id: record.document_id,
        assignee_actor_id: record.assignee_actor_id,
        ordinal_start: record.ordinal_start,
        ordinal_end: record.ordinal_end,
        due_at_ms: record.due_at_ms,
        status: match record.status {
            AssignmentStatus::Open => CollabAssignmentStatus::Open,
            AssignmentStatus::Completed => CollabAssignmentStatus::Completed,
            AssignmentStatus::Canceled => CollabAssignmentStatus::Canceled,
        },
        revision: record.revision,
        created_by: record.created_by,
        created_at_ms: record.created_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
}
