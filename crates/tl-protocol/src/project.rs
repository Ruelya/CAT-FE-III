//! Project domain.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::Project;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateParams {
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResult {
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGetParams {
    pub project_id: String,
}

/// Parameters for `project.update`. Omitted fields stay unchanged; provided
/// fields are trimmed and must not be empty.
///
/// Language-pair rule: the source/target locales may only change while the
/// project holds no linguistic assets — no imported documents, no project-TM
/// entries, and no attached termbases. Documents were segmented with the old
/// source locale and TM/term data was collected for the old pair, so once
/// assets exist a locale change is rejected with `conflict` instead of
/// silently orphaning TM and term lookups.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateParams {
    pub project_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub source_locale: Option<String>,
    #[serde(default)]
    pub target_locale: Option<String>,
}

/// Parameters for `project.archive`. `archived: true` (the default) moves the
/// lifecycle to `archived` and stamps `archivedAtMs`; `archived: false`
/// restores `active` and clears the stamp. Both directions are idempotent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchiveParams {
    pub project_id: String,
    #[serde(default = "default_archived")]
    pub archived: bool,
}

fn default_archived() -> bool {
    true
}
