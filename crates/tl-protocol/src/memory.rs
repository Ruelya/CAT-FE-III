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
