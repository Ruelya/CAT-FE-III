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

/// Parameters for `project.update`. Omitted fields stay unchanged. `name`,
/// `sourceLocale`, and `targetLocale` are trimmed and must not be empty when
/// provided.
///
/// Language-pair rule: the source/target locales may only change while the
/// project holds no linguistic assets — no imported documents, no project-TM
/// entries, and no attached termbases. Documents were segmented with the old
/// source locale and TM/term data was collected for the old pair, so once
/// assets exist a locale change is rejected with `conflict` instead of
/// silently orphaning TM and term lookups.
///
/// Import-default rule: `segmentation` (`sentence` | `paragraph`) and
/// `srxPath` persist the project's default import choices in
/// `configuration`. Empty or omitted values keep the current defaults;
/// `clearSrxPath: true` resets the SRX default back to the built-in rules
/// (and cannot be combined with a new `srxPath`). An `srxPath` is only
/// accepted while the effective segmentation default is `sentence` — SRX
/// rules never apply in paragraph mode. Only the path is stored: a missing
/// SRX file fails honestly at import time, not when the default is saved.
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
    /// Default segmentation mode for future imports: `sentence` or
    /// `paragraph`. Empty or omitted keeps the current default.
    #[serde(default)]
    pub segmentation: Option<String>,
    /// Default SRX ruleset path for future sentence-mode imports. Empty or
    /// omitted keeps the current default; use `clearSrxPath` to reset.
    #[serde(default)]
    pub srx_path: Option<String>,
    /// Reset the stored SRX default back to the built-in rules.
    #[serde(default)]
    pub clear_srx_path: bool,
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
