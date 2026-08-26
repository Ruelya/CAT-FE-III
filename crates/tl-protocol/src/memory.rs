//! Translation-memory mounts: memories, project mounts, and mount edits.
//!
//! The same family shape as the termbase RPCs. A [`Memory`] is a named
//! store of TM entries; a project reaches it through a [`MemoryMount`]
//! whose `enabled` flag gates the read path (lookup, pretranslate) and
//! whose `writable` flag marks the working memory — the single mount
//! confirmation-time TM writes go to.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_asset::{Memory, MemoryMount};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCreateParams {
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListParams {
    /// When set, `mounts` is restricted to this project.
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListResult {
    pub memories: Vec<Memory>,
    /// Mounts in (project, priority) order.
    pub mounts: Vec<MemoryMount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryAttachParams {
    pub project_id: String,
    pub memory_id: String,
}

/// New mounts are enabled for lookup but never writable: promoting the
/// working memory is always an explicit `memory.update`, so a confirm can
/// never silently start writing into a freshly attached memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryAttachResult {
    pub mount: MemoryMount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDetachParams {
    pub project_id: String,
    pub memory_id: String,
}

/// Carries the removed mount. Detaching a memory that is not mounted fails
/// with `notFound` instead of pretending success. Detaching the writable
/// mount is allowed and leaves the project without a working memory —
/// confirms then fail honestly until another mount is promoted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDetachResult {
    pub mount: MemoryMount,
}

/// `memory.rename` — rename the memory itself (mount edits stay in
/// `memory.update`). The new name applies everywhere the memory is
/// mounted; entries and mounts are untouched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRenameParams {
    pub memory_id: String,
    pub name: String,
    /// Optimistic concurrency: must match the memory's current revision.
    pub base_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRenameResult {
    pub memory: Memory,
}

/// `memory.delete` — remove a memory row for good. Honest conflicts, never
/// a silent orphan: mounted anywhere fails (detach it from every project
/// first), and entries remaining fails unless `deleteEntries` explicitly
/// asks for the cascade. The conflict message names the entry count so the
/// caller can put a real number in front of the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDeleteParams {
    pub memory_id: String,
    /// Delete the memory's TM entries along with it. Defaults to false:
    /// a memory that still holds entries conflicts instead.
    #[serde(default)]
    pub delete_entries: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDeleteResult {
    /// The memory as it was at deletion time.
    pub memory: Memory,
    /// TM entries removed in the same transaction (0 for an empty memory).
    pub deleted_entries: u32,
}

/// Edit one mount: enable/disable the read path, promote/demote the
/// working memory, and/or move the mount to a new priority position.
/// Omitted fields stay unchanged.
///
/// `writable: true` while another mount is writable fails with `conflict`
/// (demote the current working memory first) — the engine never lets two
/// mounts receive confirmation-time writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdateParams {
    pub project_id: String,
    pub memory_id: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub writable: Option<bool>,
    /// Target position in the project's mount list (0 = highest priority).
    /// Values past the end clamp to the last position. Sibling mounts are
    /// renumbered to keep priorities contiguous.
    #[serde(default)]
    pub priority: Option<u32>,
}

/// The project's mounts after the edit, in priority order — a priority
/// move renumbers siblings, so one mount alone would hide real changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdateResult {
    pub mounts: Vec<MemoryMount>,
}
