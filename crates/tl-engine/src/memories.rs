//! The `memory.*` RPC family: memories, project mounts, and mount edits.
//!
//! Semantics (PRD S3 multi-TM):
//!
//! - `enabled` gates the read path — lookup, pretranslate, and the agent's
//!   exact-match pass only see enabled mounts.
//! - `writable` marks the working memory, the single mount confirm-time TM
//!   writes go to. At most one mount per project is writable; promoting a
//!   second one is an honest `conflict` (demote the current one first),
//!   never a silent fan-out write.
//! - Priorities are contiguous per project (0 = highest); attach appends,
//!   detach and priority moves renumber the survivors.

use tl_asset::{Memory, MemoryMount};
use tl_protocol::{
    MemoryAttachParams, MemoryAttachResult, MemoryCreateParams, MemoryDeleteParams,
    MemoryDeleteResult, MemoryDetachParams, MemoryDetachResult, MemoryListParams, MemoryListResult,
    MemoryRenameParams, MemoryRenameResult, MemoryUpdateParams, MemoryUpdateResult,
};

use crate::store::StateDelta;
use crate::{Engine, EngineError, now_ms};

impl Engine {
    pub(crate) fn memory_create(
        &mut self,
        params: MemoryCreateParams,
    ) -> Result<Memory, EngineError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(EngineError::InvalidParams(
                "memory name must not be empty".to_string(),
            ));
        }
        if params.source_locale.trim().is_empty() || params.target_locale.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "memory source and target locales are required".to_string(),
            ));
        }
        let now = now_ms();
        let memory = Memory {
            id: tl_domain::new_id(),
            name: name.to_string(),
            source_locale: params.source_locale.trim().to_string(),
            target_locale: params.target_locale.trim().to_string(),
            revision: 1,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.store.apply(&StateDelta {
            memories: vec![memory.clone()],
            ..Default::default()
        })?;
        self.state
            .memories
            .insert(memory.id.clone(), memory.clone());
        Ok(memory)
    }

    pub(crate) fn memory_list(
        &self,
        params: MemoryListParams,
    ) -> Result<MemoryListResult, EngineError> {
        if let Some(project_id) = params.project_id.as_deref() {
            self.require_project(project_id)?;
        }
        let mut memories: Vec<Memory> = self.state.memories.values().cloned().collect();
        memories.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then(left.id.cmp(&right.id))
        });
        let mut mounts: Vec<MemoryMount> = self
            .state
            .memory_mounts
            .iter()
            .filter(|mount| {
                params
                    .project_id
                    .as_deref()
                    .is_none_or(|project_id| mount.project_id == project_id)
            })
            .cloned()
            .collect();
        mounts.sort_by(|left, right| {
            left.project_id
                .cmp(&right.project_id)
                .then(left.priority.cmp(&right.priority))
        });
        Ok(MemoryListResult { memories, mounts })
    }

    /// Attach appends at the lowest priority, enabled but never writable:
    /// promoting the working memory is always an explicit `memory.update`.
    /// Attaching an already-mounted memory returns the existing mount.
    pub(crate) fn memory_attach(
        &mut self,
        params: MemoryAttachParams,
    ) -> Result<MemoryAttachResult, EngineError> {
        self.require_project(&params.project_id)?;
        self.require_memory(&params.memory_id)?;
        if let Some(existing) = self
            .state
            .memory_mounts
            .iter()
            .find(|mount| {
                mount.project_id == params.project_id && mount.memory_id == params.memory_id
            })
            .cloned()
        {
            return Ok(MemoryAttachResult { mount: existing });
        }
        let now = now_ms();
        let priority = self
            .state
            .memory_mounts
            .iter()
            .filter(|mount| mount.project_id == params.project_id)
            .count() as u32;
        let mount = MemoryMount {
            project_id: params.project_id,
            memory_id: params.memory_id,
            priority,
            enabled: true,
            writable: false,
            revision: 1,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.store.apply(&StateDelta {
            memory_mounts: vec![mount.clone()],
            ..Default::default()
        })?;
        self.state.memory_mounts.push(mount.clone());
        Ok(MemoryAttachResult { mount })
    }

    /// Detach removes the mount and renumbers the survivors. The memory and
    /// its entries stay untouched. Detaching the writable mount is allowed
    /// and leaves the project without a working memory — confirms then fail
    /// honestly until another mount is promoted.
    pub(crate) fn memory_detach(
        &mut self,
        params: MemoryDetachParams,
    ) -> Result<MemoryDetachResult, EngineError> {
        self.require_project(&params.project_id)?;
        self.require_memory(&params.memory_id)?;
        let position = self
            .state
            .memory_mounts
            .iter()
            .position(|mount| {
                mount.project_id == params.project_id && mount.memory_id == params.memory_id
            })
            .ok_or_else(|| {
                EngineError::NotFound(format!(
                    "memory {} is not mounted on project {}",
                    params.memory_id, params.project_id
                ))
            })?;
        let removed = self.state.memory_mounts.remove(position);
        let now = now_ms();
        let recompacted =
            recompact_priorities(&mut self.state.memory_mounts, &removed.project_id, now);
        self.store.apply(&StateDelta {
            memory_mounts: recompacted,
            deleted_memory_mounts: vec![(removed.project_id.clone(), removed.memory_id.clone())],
            ..Default::default()
        })?;
        Ok(MemoryDetachResult { mount: removed })
    }

    /// Edit one mount: enable/disable, promote/demote writable, and/or move
    /// it to a new priority position. Every changed sibling persists in the
    /// same transaction; the result is the project's full mount list.
    pub(crate) fn memory_update(
        &mut self,
        params: MemoryUpdateParams,
    ) -> Result<MemoryUpdateResult, EngineError> {
        self.require_project(&params.project_id)?;
        self.require_memory(&params.memory_id)?;
        if params.enabled.is_none() && params.writable.is_none() && params.priority.is_none() {
            return Err(EngineError::InvalidParams(
                "nothing to update: pass enabled, writable, or priority".to_string(),
            ));
        }
        self.state
            .memory_mounts
            .iter()
            .position(|mount| {
                mount.project_id == params.project_id && mount.memory_id == params.memory_id
            })
            .ok_or_else(|| {
                EngineError::NotFound(format!(
                    "memory {} is not mounted on project {}",
                    params.memory_id, params.project_id
                ))
            })?;
        // The single-writable invariant: promoting while another mount is
        // writable is a conflict, not a silent demotion of the other one.
        if params.writable == Some(true)
            && let Some(current) = self.state.memory_mounts.iter().find(|mount| {
                mount.project_id == params.project_id
                    && mount.writable
                    && mount.memory_id != params.memory_id
            })
        {
            return Err(EngineError::Conflict(format!(
                "memory {} is already the writable mount for this project; \
                 set it read-only first",
                current.memory_id
            )));
        }

        let now = now_ms();
        let mut changed: Vec<MemoryMount> = Vec::new();
        {
            let mount = self
                .state
                .memory_mounts
                .iter_mut()
                .find(|mount| {
                    mount.project_id == params.project_id && mount.memory_id == params.memory_id
                })
                .expect("mount just resolved");
            let mut touched = false;
            if let Some(enabled) = params.enabled
                && mount.enabled != enabled
            {
                mount.enabled = enabled;
                touched = true;
            }
            if let Some(writable) = params.writable
                && mount.writable != writable
            {
                mount.writable = writable;
                touched = true;
            }
            if touched {
                mount.revision += 1;
                mount.updated_at_ms = now;
                changed.push(mount.clone());
            }
        }
        if let Some(position) = params.priority {
            for mount in
                self.move_mount_priority(&params.project_id, &params.memory_id, position, now)
            {
                match changed.iter_mut().find(|existing| {
                    existing.project_id == mount.project_id && existing.memory_id == mount.memory_id
                }) {
                    Some(existing) => *existing = mount,
                    None => changed.push(mount),
                }
            }
        }
        self.store.apply(&StateDelta {
            memory_mounts: changed,
            ..Default::default()
        })?;
        let mut mounts: Vec<MemoryMount> = self
            .state
            .memory_mounts
            .iter()
            .filter(|mount| mount.project_id == params.project_id)
            .cloned()
            .collect();
        mounts.sort_by_key(|mount| mount.priority);
        Ok(MemoryUpdateResult { mounts })
    }

    /// Move one mount to `position` (clamped to the last slot) and renumber
    /// the project's mounts contiguously. Returns every mount whose stored
    /// priority changed.
    fn move_mount_priority(
        &mut self,
        project_id: &str,
        memory_id: &str,
        position: u32,
        now: i64,
    ) -> Vec<MemoryMount> {
        let mut ordered: Vec<&mut MemoryMount> = self
            .state
            .memory_mounts
            .iter_mut()
            .filter(|mount| mount.project_id == project_id)
            .collect();
        ordered.sort_by_key(|mount| mount.priority);
        let from = ordered
            .iter()
            .position(|mount| mount.memory_id == memory_id)
            .expect("mount just resolved");
        let to = (position as usize).min(ordered.len().saturating_sub(1));
        let moved = ordered.remove(from);
        ordered.insert(to, moved);
        let mut changed = Vec::new();
        for (index, mount) in ordered.into_iter().enumerate() {
            let priority = index as u32;
            if mount.priority != priority {
                mount.priority = priority;
                mount.revision += 1;
                mount.updated_at_ms = now;
                changed.push(mount.clone());
            }
        }
        changed
    }

    /// Rename the memory itself — mounts and entries stay untouched, and
    /// the new name shows up in every project the memory is mounted on.
    pub(crate) fn memory_rename(
        &mut self,
        params: MemoryRenameParams,
    ) -> Result<MemoryRenameResult, EngineError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(EngineError::InvalidParams(
                "memory name must not be empty".to_string(),
            ));
        }
        let memory = self.require_memory(&params.memory_id)?.clone();
        if memory.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "memory revision moved to {}; refresh before renaming",
                memory.revision
            )));
        }
        if memory.name == name {
            return Ok(MemoryRenameResult { memory });
        }
        let mut renamed = memory;
        renamed.name = name.to_string();
        renamed.revision += 1;
        renamed.updated_at_ms = now_ms();
        self.store.apply(&StateDelta {
            memories: vec![renamed.clone()],
            ..Default::default()
        })?;
        self.state
            .memories
            .insert(renamed.id.clone(), renamed.clone());
        Ok(MemoryRenameResult { memory: renamed })
    }

    /// Delete a memory for good. Honest conflicts, never a silent orphan:
    /// mounted anywhere refuses (detach it from every project first), and
    /// remaining entries refuse unless `deleteEntries` explicitly asks for
    /// the cascade. The cascade removes the entries, the memory row, and
    /// the in-memory fuzzy index in the same mutation.
    pub(crate) fn memory_delete(
        &mut self,
        params: MemoryDeleteParams,
    ) -> Result<MemoryDeleteResult, EngineError> {
        let memory = self.require_memory(&params.memory_id)?.clone();
        let mounted_on = self
            .state
            .memory_mounts
            .iter()
            .filter(|mount| mount.memory_id == params.memory_id)
            .count();
        if mounted_on > 0 {
            return Err(EngineError::Conflict(format!(
                "memory is mounted on {mounted_on} project(s); detach it everywhere first"
            )));
        }
        let entries = self.store.tm_entry_count(&params.memory_id, None)?;
        if entries > 0 && !params.delete_entries {
            return Err(EngineError::Conflict(format!(
                "memory still holds {entries} TM entries; pass deleteEntries to remove them with it"
            )));
        }
        self.store.apply(&StateDelta {
            deleted_memories: vec![params.memory_id.clone()],
            ..Default::default()
        })?;
        self.state.memories.remove(&params.memory_id);
        self.tm_indexes.remove(&params.memory_id);
        Ok(MemoryDeleteResult {
            memory,
            deleted_entries: entries,
        })
    }

    pub(crate) fn require_memory(&self, memory_id: &str) -> Result<&Memory, EngineError> {
        self.state
            .memories
            .get(memory_id)
            .ok_or_else(|| EngineError::NotFound(format!("memory {memory_id}")))
    }

    /// A project's mounts in priority order.
    pub(crate) fn memory_mounts_for(&self, project_id: &str) -> Vec<&MemoryMount> {
        let mut mounts: Vec<&MemoryMount> = self
            .state
            .memory_mounts
            .iter()
            .filter(|mount| mount.project_id == project_id)
            .collect();
        mounts.sort_by_key(|mount| mount.priority);
        mounts
    }

    /// The enabled mounts of a project in priority order — the read path.
    pub(crate) fn enabled_memory_mounts(&self, project_id: &str) -> Vec<&MemoryMount> {
        let mut mounts: Vec<&MemoryMount> = self
            .state
            .memory_mounts
            .iter()
            .filter(|mount| mount.project_id == project_id && mount.enabled)
            .collect();
        mounts.sort_by_key(|mount| mount.priority);
        mounts
    }

    /// The working memory — the single mount confirm-time TM writes go to.
    /// `conflict` when the project has none (every mount demoted or
    /// detached); the caller surfaces that instead of writing anywhere.
    pub(crate) fn working_memory_id(&self, project_id: &str) -> Result<String, EngineError> {
        self.state
            .memory_mounts
            .iter()
            .find(|mount| mount.project_id == project_id && mount.writable)
            .map(|mount| mount.memory_id.clone())
            .ok_or_else(|| {
                EngineError::Conflict(
                    "project has no writable memory mount; set one writable in TM management"
                        .to_string(),
                )
            })
    }

    /// Resolve the memory a project-scoped TM management call targets:
    /// an explicit `memoryId` must be mounted on the project (enabled or
    /// not); omitted, it defaults to the working memory.
    pub(crate) fn resolve_project_memory(
        &self,
        project_id: &str,
        memory_id: Option<&str>,
    ) -> Result<String, EngineError> {
        match memory_id {
            Some(memory_id) => {
                self.require_memory(memory_id)?;
                let mounted =
                    self.state.memory_mounts.iter().any(|mount| {
                        mount.project_id == project_id && mount.memory_id == memory_id
                    });
                if !mounted {
                    return Err(EngineError::NotFound(format!(
                        "memory {memory_id} is not mounted on project {project_id}"
                    )));
                }
                Ok(memory_id.to_string())
            }
            None => self.working_memory_id(project_id),
        }
    }
}

/// Renumber a project's mounts contiguously after a removal. Returns every
/// mount whose stored priority changed.
fn recompact_priorities(
    mounts: &mut [MemoryMount],
    project_id: &str,
    now: i64,
) -> Vec<MemoryMount> {
    let mut remaining: Vec<&mut MemoryMount> = mounts
        .iter_mut()
        .filter(|mount| mount.project_id == project_id)
        .collect();
    remaining.sort_by_key(|mount| mount.priority);
    let mut recompacted = Vec::new();
    for (index, mount) in remaining.into_iter().enumerate() {
        let priority = index as u32;
        if mount.priority != priority {
            mount.priority = priority;
            mount.revision += 1;
            mount.updated_at_ms = now;
            recompacted.push(mount.clone());
        }
    }
    recompacted
}
