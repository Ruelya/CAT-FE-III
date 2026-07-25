//! Project-level AI engine allowlist policy.
//!
//! Empty `engine_allowlist` is permissive. Non-empty lists require an exact
//! match against the selected provider profile ID before interactive runs,
//! batch runs, or pipeline pretranslation may start.

use serde_json::{Value, json};
use translunar_storage::Store;

use crate::{EngineError, Result};

/// Stable structured data for allowlist denials (for RPC `data` mapping).
pub(crate) fn allowlist_denial_data(project_id: &str, profile_id: &str) -> Value {
    json!({
        "reason": "policy_denied",
        "projectId": project_id,
        "profileId": profile_id,
    })
}

/// Enforce `ProjectConfiguration.engine_allowlist` for the selected profile.
///
/// - Empty allowlist → allow any profile
/// - Non-empty → require exact `profile_id` membership
pub(crate) fn enforce_project_engine_allowlist(
    store: &Store,
    project_id: &str,
    profile_id: &str,
) -> Result<()> {
    let aggregate = store.get_project(project_id)?;
    let allowlist = &aggregate.project.configuration.engine_allowlist;
    if allowlist.is_empty() {
        return Ok(());
    }
    if allowlist.iter().any(|entry| entry == profile_id) {
        return Ok(());
    }
    Err(EngineError::PolicyDenied {
        project_id: project_id.to_string(),
        profile_id: profile_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;
    use translunar_ai_core::AiProviderKind;
    use translunar_domain::ProjectConfiguration;
    use translunar_protocol::{AiProviderCreateParams, CreateProjectParams, UpdateProjectParams};

    use super::*;
    use crate::EngineService;

    fn open_service() -> (tempfile::TempDir, EngineService) {
        let root = tempdir().expect("temporary data directory");
        let service = EngineService::open(root.path()).expect("open engine");
        (root, service)
    }

    fn seed_project_and_profile(
        service: &mut EngineService,
    ) -> (
        translunar_domain::Project,
        translunar_ai_core::AiProviderProfile,
    ) {
        let project = service
            .create_project(CreateProjectParams {
                name: "Allowlist project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
            })
            .expect("create project");
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Allowlist fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: "https://example.test/v1".to_string(),
                model: "fixture-model".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create AI provider");
        (project, profile)
    }

    fn set_engine_allowlist(
        service: &mut EngineService,
        project: &translunar_domain::Project,
        engine_allowlist: Vec<String>,
    ) -> translunar_domain::Project {
        let mut configuration = project.configuration.clone();
        configuration.engine_allowlist = engine_allowlist;
        service
            .update_project(UpdateProjectParams {
                project_id: project.id.clone(),
                name: project.name.clone(),
                source_locale: project.source_locale.clone(),
                target_locale: project.target_locale.clone(),
                domain: project.domain.clone(),
                configuration,
                expected_revision: project.revision,
                actor: "allowlist-test".to_string(),
                correlation_id: None,
            })
            .expect("update project allowlist")
    }

    #[test]
    fn empty_allowlist_is_permissive() {
        let (_root, mut service) = open_service();
        let (project, profile) = seed_project_and_profile(&mut service);
        assert!(project.configuration.engine_allowlist.is_empty());
        enforce_project_engine_allowlist(&service.store, &project.id, &profile.id)
            .expect("empty allowlist permits any profile");
    }

    #[test]
    fn exact_profile_id_is_allowed() {
        let (_root, mut service) = open_service();
        let (project, profile) = seed_project_and_profile(&mut service);
        let project = set_engine_allowlist(
            &mut service,
            &project,
            vec![profile.id.clone(), "other-profile".to_string()],
        );
        enforce_project_engine_allowlist(&service.store, &project.id, &profile.id)
            .expect("listed profile id is allowed");
    }

    #[test]
    fn unlisted_profile_id_is_denied() {
        let (_root, mut service) = open_service();
        let (project, profile) = seed_project_and_profile(&mut service);
        let other = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Other fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: "https://other.test/v1".to_string(),
                model: "other-model".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create other AI provider");
        let project = set_engine_allowlist(&mut service, &project, vec![other.id.clone()]);
        let error = enforce_project_engine_allowlist(&service.store, &project.id, &profile.id)
            .expect_err("unlisted profile must be denied");
        assert!(matches!(
            error,
            EngineError::PolicyDenied {
                ref project_id,
                ref profile_id,
            } if project_id == &project.id && profile_id == &profile.id
        ));
    }

    #[test]
    fn existing_project_with_disallowed_profile_cannot_start_new_work() {
        // Simulates a project that previously used a profile, then the allowlist
        // was tightened so that profile is no longer permitted.
        let (_root, mut service) = open_service();
        let (project, profile) = seed_project_and_profile(&mut service);
        // First: permissive (empty) — would have allowed historical work.
        enforce_project_engine_allowlist(&service.store, &project.id, &profile.id)
            .expect("historical empty allowlist permits profile");
        // Then: allowlist tightened to exclude the profile.
        let project = set_engine_allowlist(
            &mut service,
            &project,
            vec!["only-this-profile".to_string()],
        );
        let error = enforce_project_engine_allowlist(&service.store, &project.id, &profile.id)
            .expect_err("disallowed profile cannot start new work");
        assert!(matches!(error, EngineError::PolicyDenied { .. }));
    }

    #[test]
    fn denial_data_shape_is_stable() {
        let data = allowlist_denial_data("proj-1", "prof-2");
        assert_eq!(data["reason"], json!("policy_denied"));
        assert_eq!(data["projectId"], json!("proj-1"));
        assert_eq!(data["profileId"], json!("prof-2"));

        let rpc = crate::rpc_error(EngineError::PolicyDenied {
            project_id: "proj-1".to_string(),
            profile_id: "prof-2".to_string(),
        });
        assert_eq!(rpc.code, translunar_protocol::ErrorCode::PolicyDenied);
        assert_eq!(rpc.data, Some(data));
    }

    #[test]
    fn missing_project_surfaces_storage_not_found() {
        let (_root, service) = open_service();
        let error = enforce_project_engine_allowlist(&service.store, "missing-project", "any")
            .expect_err("missing project must fail");
        assert!(matches!(
            error,
            EngineError::Storage(translunar_storage::StorageError::NotFound { .. })
        ));
    }

    #[test]
    fn configuration_default_has_empty_allowlist() {
        let configuration = ProjectConfiguration::default();
        assert!(configuration.engine_allowlist.is_empty());
    }
}
