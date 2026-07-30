//! Engine-owned external system connector registry, credentials, and
//! synchronous operation boundary (P-08).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use translunar_plugin_runtime::{
    EXTERNAL_CONNECTOR_CONTRACT_VERSION, EXTERNAL_CONNECTOR_CREDENTIAL_NAMESPACE,
    ExternalConnectorBatchResultV1, ExternalConnectorConfigValidationResultV1,
    ExternalConnectorContributionDescriptor, ExternalConnectorExecutableDescriptorV1,
    ExternalConnectorFailureCodeV1, ExternalConnectorFailureV1,
    ExternalConnectorInvocationContextV1, ExternalConnectorItemV1, ExternalConnectorOperationV1,
    ExternalConnectorProfileBindingV1, ExternalConnectorPushResultV1,
    ExternalConnectorRequestHeaderV1, ExternalConnectorRequestV1, ExternalConnectorResultV1,
    ExternalConnectorTestResultV1, PluginCapabilityAuthorizer, PluginCapabilityCheck,
    PluginCapabilityId, PluginCapabilityScope, PluginTier,
};
use translunar_protocol::{
    EmptyResult, ExternalConnectorCatalogEntry, ExternalConnectorCatalogPage,
    ExternalConnectorCheckpointGetParams, ExternalConnectorCheckpointView,
    ExternalConnectorCredentialDeleteParams, ExternalConnectorCredentialSetParams,
    ExternalConnectorCredentialSlotStatus, ExternalConnectorCredentialStatus,
    ExternalConnectorCredentialStatusParams, ExternalConnectorInvokeParams,
    ExternalConnectorInvokeResult, ExternalConnectorProfile, ExternalConnectorProfileCreateParams,
    ExternalConnectorProfileListParams,
    ExternalConnectorProfilePage, ExternalConnectorProfileRevisionParams,
    ExternalConnectorProfileUpdateParams, PluginContributionOwner, PluginContributionState,
};
use translunar_storage::{
    ClaimExternalConnectorIdempotency, ExternalConnectorIdempotencyClaim,
    ExternalConnectorInvocationStatus, ExternalConnectorProfileRecord,
    FinalizeExternalConnectorFailure, FinalizeExternalConnectorSuccess, NewExternalConnectorProfile,
};

use crate::{EngineError, EngineService, Result};

type HostInvoke = Arc<
    dyn Fn(
            &ExternalConnectorExecutableDescriptorV1,
            &ExternalConnectorRequestV1,
            &ExternalConnectorInvocationContextV1,
        ) -> std::result::Result<ExternalConnectorResultV1, ExternalConnectorFailureV1>
        + Send
        + Sync,
>;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ExternalConnectorOwnerToken {
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contribution_id: String,
    pub contract_version: u32,
}

impl ExternalConnectorOwnerToken {
    fn wire(&self) -> PluginContributionOwner {
        PluginContributionOwner {
            plugin_id: self.plugin_id.clone(),
            version_id: self.version_id.clone(),
            activation_revision: self.activation_revision,
            contribution_id: self.contribution_id.clone(),
        }
    }

    fn belongs_to_generation(
        &self,
        plugin_id: &str,
        version_id: &str,
        activation_revision: u64,
    ) -> bool {
        self.plugin_id == plugin_id
            && self.version_id == version_id
            && self.activation_revision == activation_revision
    }
}

#[derive(Clone)]
pub(crate) struct ExternalConnectorRegistration {
    pub owner: ExternalConnectorOwnerToken,
    pub descriptor: ExternalConnectorContributionDescriptor,
    pub executable: ExternalConnectorExecutableDescriptorV1,
    pub tier: PluginTier,
    pub authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    pub host: HostInvoke,
    pub cancel: Arc<AtomicBool>,
}

#[derive(Clone)]
struct ExternalConnectorLease {
    registration: ExternalConnectorRegistration,
    generation: u64,
    active: Arc<AtomicBool>,
}

#[derive(Default)]
struct RegistryState {
    next_generation: u64,
    entries: BTreeMap<String, ExternalConnectorLease>,
}

#[derive(Clone, Default)]
pub(crate) struct ExternalConnectorRegistry {
    state: Arc<RwLock<RegistryState>>,
}

impl ExternalConnectorRegistry {
    pub(crate) fn preflight(&self, candidates: &[ExternalConnectorRegistration]) -> Result<()> {
        let state = self.state.read().map_err(|_| {
            EngineError::InvalidState("external connector registry is unavailable".into())
        })?;
        let mut ids = BTreeSet::new();
        for candidate in candidates {
            let id = &candidate.owner.contribution_id;
            if !ids.insert(id.clone()) || state.entries.contains_key(id) {
                return Err(EngineError::PluginConflict(format!(
                    "external connector contribution id {id} collides"
                )));
            }
            candidate
                .descriptor
                .validate_executable_v1(candidate.tier)
                .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        }
        Ok(())
    }

    pub(crate) fn attach_all(&self, candidates: Vec<ExternalConnectorRegistration>) -> Result<()> {
        self.preflight(&candidates)?;
        let mut state = self.state.write().map_err(|_| {
            EngineError::InvalidState("external connector registry is unavailable".into())
        })?;
        for candidate in candidates {
            state.next_generation = state.next_generation.saturating_add(1);
            let generation = state.next_generation;
            let id = candidate.owner.contribution_id.clone();
            state.entries.insert(
                id,
                ExternalConnectorLease {
                    registration: candidate,
                    generation,
                    active: Arc::new(AtomicBool::new(true)),
                },
            );
        }
        Ok(())
    }

    pub(crate) fn detach_generation(
        &self,
        plugin_id: &str,
        version_id: &str,
        activation_revision: u64,
    ) {
        if let Ok(mut state) = self.state.write() {
            let ids = state
                .entries
                .iter()
                .filter(|(_, lease)| {
                    lease.registration.owner.belongs_to_generation(
                        plugin_id,
                        version_id,
                        activation_revision,
                    )
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in ids {
                if let Some(lease) = state.entries.remove(&id) {
                    lease.active.store(false, Ordering::Release);
                    lease.registration.cancel.store(true, Ordering::Release);
                }
            }
        }
    }

    pub(crate) fn detach_plugin(&self, plugin_id: &str) {
        if let Ok(mut state) = self.state.write() {
            let ids = state
                .entries
                .iter()
                .filter(|(_, lease)| lease.registration.owner.plugin_id == plugin_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in ids {
                if let Some(lease) = state.entries.remove(&id) {
                    lease.active.store(false, Ordering::Release);
                    lease.registration.cancel.store(true, Ordering::Release);
                }
            }
        }
    }

    fn lookup(&self, contribution_id: &str) -> Result<ExternalConnectorLease> {
        let state = self.state.read().map_err(|_| {
            EngineError::InvalidState("external connector registry is unavailable".into())
        })?;
        state
            .entries
            .get(contribution_id)
            .filter(|lease| lease.active.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| {
                EngineError::InvalidRequest(format!(
                    "external connector {contribution_id} was not found"
                ))
            })
    }

    pub(crate) fn catalog(&self) -> ExternalConnectorCatalogPage {
        let Ok(state) = self.state.read() else {
            return ExternalConnectorCatalogPage { items: vec![] };
        };
        let mut items = state
            .entries
            .values()
            .filter(|lease| lease.active.load(Ordering::Acquire))
            .map(|lease| ExternalConnectorCatalogEntry {
                owner: lease.registration.owner.wire(),
                contract_version: lease.registration.executable.contract_version,
                operations: lease
                    .registration
                    .executable
                    .operations
                    .iter()
                    .map(|op| op.as_str().to_string())
                    .collect(),
                origins: lease.registration.executable.origins.clone(),
                credential_slots: lease
                    .registration
                    .executable
                    .credential_slots
                    .iter()
                    .map(|slot| slot.id.clone())
                    .collect(),
                config_schema_version: lease.registration.executable.config_schema_version,
                checkpoint_schema_version: lease.registration.executable.checkpoint_schema_version,
                display_name: lease.registration.descriptor.display_name.clone(),
                state: PluginContributionState::Active,
            })
            .collect::<Vec<_>>();
        items.sort_by(|left, right| {
            left.owner
                .contribution_id
                .cmp(&right.owner.contribution_id)
        });
        ExternalConnectorCatalogPage { items }
    }
}

pub(crate) trait ExternalConnectorCredentialStore: Send + Sync {
    fn status(&self, profile_id: &str, slot_id: &str) -> std::result::Result<bool, CredentialError>;
    fn set(
        &self,
        profile_id: &str,
        slot_id: &str,
        secret: &str,
    ) -> std::result::Result<(), CredentialError>;
    fn get(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<String, CredentialError>;
    fn delete(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<(), CredentialError>;
}

#[derive(Debug)]
pub(crate) enum CredentialError {
    Missing,
    Unavailable,
    Failed,
}

#[derive(Default)]
pub(crate) struct MemoryExternalConnectorCredentialStore {
    values: Mutex<HashMap<(String, String), String>>,
}

impl ExternalConnectorCredentialStore for MemoryExternalConnectorCredentialStore {
    fn status(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<bool, CredentialError> {
        let guard = self.values.lock().map_err(|_| CredentialError::Unavailable)?;
        Ok(guard.contains_key(&(profile_id.to_string(), slot_id.to_string())))
    }

    fn set(
        &self,
        profile_id: &str,
        slot_id: &str,
        secret: &str,
    ) -> std::result::Result<(), CredentialError> {
        let mut guard = self.values.lock().map_err(|_| CredentialError::Unavailable)?;
        guard.insert((profile_id.to_string(), slot_id.to_string()), secret.to_string());
        Ok(())
    }

    fn get(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<String, CredentialError> {
        let guard = self.values.lock().map_err(|_| CredentialError::Unavailable)?;
        guard
            .get(&(profile_id.to_string(), slot_id.to_string()))
            .cloned()
            .ok_or(CredentialError::Missing)
    }

    fn delete(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<(), CredentialError> {
        let mut guard = self.values.lock().map_err(|_| CredentialError::Unavailable)?;
        guard.remove(&(profile_id.to_string(), slot_id.to_string()));
        Ok(())
    }
}

struct KeyringExternalConnectorCredentialStore;

impl KeyringExternalConnectorCredentialStore {
    fn entry(profile_id: &str, slot_id: &str) -> std::result::Result<keyring::Entry, CredentialError> {
        let account = format!("{profile_id}:{slot_id}");
        keyring::Entry::new(EXTERNAL_CONNECTOR_CREDENTIAL_NAMESPACE, &account)
            .map_err(|_| CredentialError::Unavailable)
    }
}

impl ExternalConnectorCredentialStore for KeyringExternalConnectorCredentialStore {
    fn status(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<bool, CredentialError> {
        match Self::entry(profile_id, slot_id)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err(CredentialError::Failed),
        }
    }

    fn set(
        &self,
        profile_id: &str,
        slot_id: &str,
        secret: &str,
    ) -> std::result::Result<(), CredentialError> {
        Self::entry(profile_id, slot_id)?
            .set_password(secret)
            .map_err(|_| CredentialError::Failed)
    }

    fn get(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<String, CredentialError> {
        match Self::entry(profile_id, slot_id)?.get_password() {
            Ok(value) => Ok(value),
            Err(keyring::Error::NoEntry) => Err(CredentialError::Missing),
            Err(_) => Err(CredentialError::Failed),
        }
    }

    fn delete(
        &self,
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<(), CredentialError> {
        match Self::entry(profile_id, slot_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CredentialError::Failed),
        }
    }
}

pub(crate) fn default_external_connector_credential_store(
) -> Arc<dyn ExternalConnectorCredentialStore> {
    if cfg!(test) {
        Arc::new(MemoryExternalConnectorCredentialStore::default())
    } else {
        Arc::new(KeyringExternalConnectorCredentialStore)
    }
}

/// Deterministic in-process host used by the official fixture and unit tests.
pub(crate) fn fixture_external_connector_host() -> HostInvoke {
    Arc::new(|descriptor, request, context| {
        let request_id = request.header().request_id.clone();
        let fail = |code: ExternalConnectorFailureCodeV1, message: &str, retryable: bool, retry_after_ms: Option<u64>| {
            Err(ExternalConnectorFailureV1 {
                contract_version: EXTERNAL_CONNECTOR_CONTRACT_VERSION,
                request_id: request_id.clone(),
                code,
                message: message.to_string(),
                retryable,
                retry_after_ms,
            })
        };

        let scenario = request
            .header()
            .config
            .get("scenario")
            .and_then(|value| match value {
                translunar_plugin_runtime::EngineConnectorConfigValueV1::String(value) => {
                    Some(value.as_str())
                }
                _ => None,
            })
            .unwrap_or("success");

        match scenario {
            "auth" => return fail(
                ExternalConnectorFailureCodeV1::Authentication,
                "authentication failed",
                false,
                None,
            ),
            "rate" => {
                return fail(
                    ExternalConnectorFailureCodeV1::RateLimit,
                    "rate limited",
                    true,
                    Some(1_000),
                );
            }
            "malformed" => {
                return fail(
                    ExternalConnectorFailureCodeV1::Protocol,
                    "malformed upstream payload",
                    false,
                    None,
                );
            }
            "timeout" => {
                return fail(
                    ExternalConnectorFailureCodeV1::Timeout,
                    "deadline exceeded",
                    true,
                    None,
                );
            }
            "crash" => {
                return fail(
                    ExternalConnectorFailureCodeV1::HostCrash,
                    "host crashed",
                    true,
                    None,
                );
            }
            _ => {}
        }

        // Credential presence is required for exchange/test when declared.
        let slots = descriptor.slots_for(request.operation());
        if let Err(error) = context.validate_slots(&slots) {
            return fail(
                ExternalConnectorFailureCodeV1::Authentication,
                &error.to_string(),
                false,
                None,
            );
        }

        let result = match request {
            ExternalConnectorRequestV1::ValidateConfig { .. } => {
                ExternalConnectorResultV1::ValidateConfig(ExternalConnectorConfigValidationResultV1 {
                    valid: true,
                    issues: vec![],
                })
            }
            ExternalConnectorRequestV1::Test { .. } => {
                ExternalConnectorResultV1::Test(ExternalConnectorTestResultV1 {
                    ok: true,
                    latency_ms: 1,
                    message: Some("ok".into()),
                })
            }
            ExternalConnectorRequestV1::Pull { payload, header } => {
                let items = if scenario == "empty" {
                    vec![]
                } else {
                    vec![sample_item("item-1", header)]
                };
                ExternalConnectorResultV1::Pull(ExternalConnectorBatchResultV1 {
                    items,
                    has_more: scenario == "page",
                    next_cursor: if scenario == "page" {
                        Some("cursor-2".into())
                    } else {
                        None
                    },
                    checkpoint: Some(
                        translunar_plugin_runtime::ExternalConnectorCheckpointCandidateV1 {
                            stream_id: payload.stream_id.clone(),
                            schema_version: 1,
                            payload: json!({ "cursor": payload.cursor.clone().unwrap_or_else(|| "c1".into()) }),
                            cursor: Some(payload.cursor.clone().unwrap_or_else(|| "c1".into())),
                        },
                    ),
                })
            }
            ExternalConnectorRequestV1::Push { payload, .. } => {
                ExternalConnectorResultV1::Push(ExternalConnectorPushResultV1 {
                    receipts: payload
                        .items
                        .iter()
                        .map(|item| translunar_plugin_runtime::ExternalConnectorReceiptV1 {
                            external_id: item.external_id.clone(),
                            accepted: true,
                            remote_revision: Some("r1".into()),
                            message: None,
                        })
                        .collect(),
                    checkpoint: Some(
                        translunar_plugin_runtime::ExternalConnectorCheckpointCandidateV1 {
                            stream_id: payload.stream_id.clone(),
                            schema_version: 1,
                            payload: json!({ "pushed": payload.items.len() }),
                            cursor: None,
                        },
                    ),
                })
            }
            ExternalConnectorRequestV1::Poll { payload, header } => {
                ExternalConnectorResultV1::Poll(ExternalConnectorBatchResultV1 {
                    items: if scenario == "empty" {
                        vec![]
                    } else {
                        vec![sample_item("poll-1", header)]
                    },
                    has_more: false,
                    next_cursor: None,
                    checkpoint: Some(
                        translunar_plugin_runtime::ExternalConnectorCheckpointCandidateV1 {
                            stream_id: payload.stream_id.clone(),
                            schema_version: 1,
                            payload: json!({ "polled": true }),
                            cursor: Some("poll-c1".into()),
                        },
                    ),
                })
            }
            ExternalConnectorRequestV1::Webhook { payload, header } => {
                ExternalConnectorResultV1::Webhook(ExternalConnectorBatchResultV1 {
                    items: vec![sample_item(&payload.event_id, header)],
                    has_more: false,
                    next_cursor: None,
                    checkpoint: Some(
                        translunar_plugin_runtime::ExternalConnectorCheckpointCandidateV1 {
                            stream_id: payload.stream_id.clone(),
                            schema_version: 1,
                            payload: json!({ "eventId": payload.event_id }),
                            cursor: None,
                        },
                    ),
                })
            }
        };
        result
            .validate(&descriptor.limits)
            .map_err(|error| ExternalConnectorFailureV1 {
                contract_version: EXTERNAL_CONNECTOR_CONTRACT_VERSION,
                request_id,
                code: ExternalConnectorFailureCodeV1::Protocol,
                message: error.to_string(),
                retryable: false,
                retry_after_ms: None,
            })?;
        Ok(result)
    })
}

fn sample_item(id: &str, header: &ExternalConnectorRequestHeaderV1) -> ExternalConnectorItemV1 {
    let _ = header;
    ExternalConnectorItemV1 {
        external_id: id.to_string(),
        external_revision: Some("1".into()),
        source_locale: "en".into(),
        target_locale: "zh".into(),
        source_text: "hello".into(),
        target_text: Some("你好".into()),
        context: None,
        metadata: BTreeMap::new(),
    }
}

impl EngineService {
    pub(crate) fn list_external_connector_catalog(&self) -> ExternalConnectorCatalogPage {
        self.external_connector_registry.catalog()
    }

    pub(crate) fn list_external_connector_profiles(
        &mut self,
        params: ExternalConnectorProfileListParams,
    ) -> Result<ExternalConnectorProfilePage> {
        let (items, total) = self.store.list_external_connector_profiles(
            params.contribution_id.as_deref(),
            params.offset,
            params.limit,
        )?;
        Ok(ExternalConnectorProfilePage {
            items: items.into_iter().map(profile_view).collect(),
            total,
            offset: params.offset,
            limit: params.limit,
        })
    }

    pub(crate) fn create_external_connector_profile(
        &mut self,
        params: ExternalConnectorProfileCreateParams,
    ) -> Result<ExternalConnectorProfile> {
        let lease = self
            .external_connector_registry
            .lookup(&params.contribution_id)?;
        authorize_registration(&lease)?;
        lease
            .registration
            .executable
            .config_schema
            .validate_config(&value_to_config(&params.configuration)?)
            .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        let descriptor_hash = hash_json(&serde_json::to_value(&lease.registration.descriptor)?)?;
        let record = self.store.create_external_connector_profile(
            NewExternalConnectorProfile {
                display_name: params.display_name,
                contribution_id: lease.registration.owner.contribution_id.clone(),
                plugin_id: lease.registration.owner.plugin_id.clone(),
                version_id: lease.registration.owner.version_id.clone(),
                activation_revision: lease.registration.owner.activation_revision,
                contract_version: lease.registration.executable.contract_version,
                config_schema_version: lease.registration.executable.config_schema_version,
                checkpoint_schema_version: lease.registration.executable.checkpoint_schema_version,
                configuration: params.configuration,
                origins: lease.registration.executable.origins.clone(),
                operations: lease
                    .registration
                    .executable
                    .operations
                    .iter()
                    .map(|op| op.as_str().to_string())
                    .collect(),
                descriptor_hash,
                credential_slot_ids: lease
                    .registration
                    .executable
                    .credential_slots
                    .iter()
                    .map(|slot| slot.id.clone())
                    .collect(),
                enabled: params.enabled,
            },
        )?;
        Ok(profile_view(record))
    }

    pub(crate) fn update_external_connector_profile(
        &mut self,
        params: ExternalConnectorProfileUpdateParams,
    ) -> Result<ExternalConnectorProfile> {
        let current = self.store.get_external_connector_profile(&params.profile_id)?;
        let lease = self
            .external_connector_registry
            .lookup(&current.contribution_id)?;
        authorize_registration(&lease)?;
        lease
            .registration
            .executable
            .config_schema
            .validate_config(&value_to_config(&params.configuration)?)
            .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        let record = self.store.update_external_connector_profile(
            &params.profile_id,
            translunar_storage::ExternalConnectorProfileUpdate {
                display_name: params.display_name,
                configuration: params.configuration,
                enabled: params.enabled,
                expected_revision: params.expected_revision,
            },
        )?;
        Ok(profile_view(record))
    }

    pub(crate) fn delete_external_connector_profile(
        &mut self,
        params: ExternalConnectorProfileRevisionParams,
    ) -> Result<EmptyResult> {
        let current = self.store.get_external_connector_profile(&params.profile_id)?;
        let lease = self
            .external_connector_registry
            .lookup(&current.contribution_id)?;
        authorize_registration(&lease)?;
        // Best-effort secret cleanup for known slots.
        for slot in &current.credential_slots {
            let _ = self
                .external_connector_credentials
                .delete(&params.profile_id, &slot.slot_id);
        }
        self.store
            .delete_external_connector_profile(&params.profile_id, params.expected_revision)?;
        Ok(EmptyResult {})
    }

    pub(crate) fn set_external_connector_credential(
        &mut self,
        params: ExternalConnectorCredentialSetParams,
    ) -> Result<ExternalConnectorCredentialStatus> {
        let current = self.store.get_external_connector_profile(&params.profile_id)?;
        let lease = self
            .external_connector_registry
            .lookup(&current.contribution_id)?;
        authorize_registration(&lease)?;
        if !lease
            .registration
            .executable
            .credential_slots
            .iter()
            .any(|slot| slot.id == params.slot_id)
        {
            return Err(EngineError::InvalidRequest(format!(
                "unknown credential slot {}",
                params.slot_id
            )));
        }
        if params.secret.is_empty() || params.secret.len() > 16 * 1024 {
            return Err(EngineError::InvalidRequest(
                "credential secret is empty or oversized".into(),
            ));
        }
        self.external_connector_credentials
            .set(&params.profile_id, &params.slot_id, &params.secret)
            .map_err(map_credential_error)?;
        let record = self.store.set_external_connector_credential_present(
            &params.profile_id,
            &params.slot_id,
            true,
            params.expected_revision,
        )?;
        Ok(credential_status(&record))
    }

    pub(crate) fn delete_external_connector_credential(
        &mut self,
        params: ExternalConnectorCredentialDeleteParams,
    ) -> Result<ExternalConnectorCredentialStatus> {
        let current = self.store.get_external_connector_profile(&params.profile_id)?;
        let lease = self
            .external_connector_registry
            .lookup(&current.contribution_id)?;
        authorize_registration(&lease)?;
        self.external_connector_credentials
            .delete(&params.profile_id, &params.slot_id)
            .map_err(map_credential_error)?;
        let record = self.store.set_external_connector_credential_present(
            &params.profile_id,
            &params.slot_id,
            false,
            params.expected_revision,
        )?;
        Ok(credential_status(&record))
    }

    pub(crate) fn external_connector_credential_status(
        &mut self,
        params: ExternalConnectorCredentialStatusParams,
    ) -> Result<ExternalConnectorCredentialStatus> {
        let record = self.store.get_external_connector_profile(&params.profile_id)?;
        Ok(credential_status(&record))
    }

    pub(crate) fn get_external_connector_checkpoint(
        &mut self,
        params: ExternalConnectorCheckpointGetParams,
    ) -> Result<ExternalConnectorCheckpointView> {
        let checkpoint = self
            .store
            .get_external_connector_checkpoint(&params.profile_id, &params.stream_id)?
            .ok_or_else(|| {
                EngineError::InvalidRequest(format!(
                    "external connector checkpoint {}/{} was not found",
                    params.profile_id, params.stream_id
                ))
            })?;
        Ok(ExternalConnectorCheckpointView {
            profile_id: checkpoint.profile_id,
            stream_id: checkpoint.stream_id,
            schema_version: checkpoint.schema_version,
            revision: checkpoint.revision,
            payload: checkpoint.payload,
            cursor: checkpoint.cursor,
            payload_hash: checkpoint.payload_hash,
            plugin_id: checkpoint.plugin_id,
            version_id: checkpoint.version_id,
            contribution_id: checkpoint.contribution_id,
            activation_revision: checkpoint.activation_revision,
            created_at_ms: checkpoint.created_at_ms,
        })
    }

    pub(crate) fn invoke_external_connector(
        &mut self,
        params: ExternalConnectorInvokeParams,
    ) -> Result<ExternalConnectorInvokeResult> {
        let profile = self.store.get_external_connector_profile(&params.profile_id)?;
        if !profile.enabled {
            return Err(EngineError::InvalidState(
                "external connector profile is disabled".into(),
            ));
        }
        let lease = self
            .external_connector_registry
            .lookup(&profile.contribution_id)?;
        if !lease.active.load(Ordering::Acquire)
            || lease.registration.owner.plugin_id != profile.plugin_id
            || lease.registration.owner.version_id != profile.version_id
            || lease.registration.owner.activation_revision != profile.activation_revision
        {
            return Err(EngineError::InvalidState(
                "external connector generation is stale".into(),
            ));
        }
        let mut request: ExternalConnectorRequestV1 = serde_json::from_value(params.request)
            .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        // Force binding identity from the active profile/lease.
        let binding = ExternalConnectorProfileBindingV1 {
            profile_id: profile.id.clone(),
            contribution_id: profile.contribution_id.clone(),
            plugin_id: profile.plugin_id.clone(),
            version_id: profile.version_id.clone(),
            activation_revision: profile.activation_revision,
            contract_version: profile.contract_version,
            config_schema_version: profile.config_schema_version,
            checkpoint_schema_version: profile.checkpoint_schema_version,
        };
        match &mut request {
            ExternalConnectorRequestV1::ValidateConfig { header }
            | ExternalConnectorRequestV1::Test { header }
            | ExternalConnectorRequestV1::Pull { header, .. }
            | ExternalConnectorRequestV1::Push { header, .. }
            | ExternalConnectorRequestV1::Poll { header, .. }
            | ExternalConnectorRequestV1::Webhook { header, .. } => {
                header.binding = binding;
                header.config = value_to_config(&profile.configuration)?;
            }
        }
        let operation = request.operation();
        if !lease.registration.executable.declares(operation) {
            return Err(EngineError::InvalidRequest(format!(
                "operation {} is not declared",
                operation.as_str()
            )));
        }
        request
            .validate(&lease.registration.executable.limits)
            .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        authorize_operation(&lease, operation)?;
        for origin in &lease.registration.executable.origins {
            authorize_origin(&lease, origin)?;
        }

        let request_hash = hash_json(&serde_json::to_value(&request)?)?;
        let stream_id = match &request {
            ExternalConnectorRequestV1::Pull { payload, .. } => Some(payload.stream_id.clone()),
            ExternalConnectorRequestV1::Push { payload, .. } => Some(payload.stream_id.clone()),
            ExternalConnectorRequestV1::Poll { payload, .. } => Some(payload.stream_id.clone()),
            ExternalConnectorRequestV1::Webhook { payload, .. } => Some(payload.stream_id.clone()),
            _ => None,
        };
        let mut invocation_id = None;
        if let Some(idempotency_key) = request.header().idempotency_key.clone() {
            match self.store.claim_external_connector_idempotency(
                ClaimExternalConnectorIdempotency {
                    profile_id: profile.id.clone(),
                    operation: operation.as_str().to_string(),
                    idempotency_key,
                    request_hash: request_hash.clone(),
                    request_id: request.header().request_id.clone(),
                    stream_id: stream_id.clone(),
                    attempt: request.header().attempt,
                    plugin_id: profile.plugin_id.clone(),
                    version_id: profile.version_id.clone(),
                    contribution_id: profile.contribution_id.clone(),
                    activation_revision: profile.activation_revision,
                },
            )? {
                ExternalConnectorIdempotencyClaim::Replay(existing) => {
                    let result = existing.result.ok_or_else(|| {
                        EngineError::InvalidState(
                            "idempotent replay is missing a bounded result".into(),
                        )
                    })?;
                    return Ok(ExternalConnectorInvokeResult {
                        profile_id: profile.id,
                        request_id: existing.request_id,
                        operation: existing.operation,
                        result,
                        checkpoint_revision: existing.checkpoint_revision,
                        replayed: true,
                    });
                }
                ExternalConnectorIdempotencyClaim::Conflict { .. } => {
                    return Err(EngineError::InvalidRequest(
                        "external connector idempotency key was reused with a different request"
                            .into(),
                    ));
                }
                ExternalConnectorIdempotencyClaim::Fresh(record) => {
                    invocation_id = Some(record.id);
                }
            }
        }

        let mut context = ExternalConnectorInvocationContextV1::default();
        for slot in lease.registration.executable.slots_for(operation) {
            if let Ok(secret) = self
                .external_connector_credentials
                .get(&profile.id, &slot.id)
            {
                context.credentials.insert(slot.id.clone(), secret);
            } else if slot.required {
                context.clear();
                if let Some(invocation_id) = invocation_id.as_ref() {
                    let _ = self.store.finalize_external_connector_failure(
                        FinalizeExternalConnectorFailure {
                            invocation_id: invocation_id.clone(),
                            status: ExternalConnectorInvocationStatus::Failed,
                            failure_code: "authentication".into(),
                            failure_message: "required credential is missing".into(),
                            retryable: false,
                            retry_after_ms: None,
                        },
                    );
                }
                return Err(EngineError::InvalidState(format!(
                    "required credential slot {} is missing",
                    slot.id
                )));
            }
        }

        if !lease.active.load(Ordering::Acquire) || lease.registration.cancel.load(Ordering::Acquire)
        {
            context.clear();
            return Err(EngineError::InvalidState(
                "external connector call was cancelled".into(),
            ));
        }

        let started = Instant::now();
        let host_result = (lease.registration.host)(
            &lease.registration.executable,
            &request,
            &context,
        );
        context.clear();
        let _elapsed = started.elapsed();

        match host_result {
            Ok(result) => {
                if result.operation() != operation {
                    return Err(EngineError::InvalidState(
                        "external connector result operation mismatch".into(),
                    ));
                }
                result
                    .validate(&lease.registration.executable.limits)
                    .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                let result_value = serde_json::to_value(&result)?;
                let checkpoint = result.checkpoint_candidate();
                let mut checkpoint_revision = None;
                if let Some(invocation_id) = invocation_id {
                    let (_, checkpoint_record) = self.store.finalize_external_connector_success(
                        FinalizeExternalConnectorSuccess {
                            invocation_id,
                            profile_id: profile.id.clone(),
                            stream_id: stream_id.clone(),
                            expected_checkpoint_revision: request
                                .header()
                                .expected_checkpoint_revision,
                            checkpoint_schema_version: checkpoint.map(|value| value.schema_version),
                            checkpoint_payload: checkpoint.map(|value| value.payload.clone()),
                            checkpoint_cursor: checkpoint.and_then(|value| value.cursor.clone()),
                            result: result_value.clone(),
                            plugin_id: profile.plugin_id.clone(),
                            version_id: profile.version_id.clone(),
                            contribution_id: profile.contribution_id.clone(),
                            activation_revision: profile.activation_revision,
                        },
                    )?;
                    checkpoint_revision = checkpoint_record.map(|value| value.revision);
                } else if let Some(checkpoint) = checkpoint {
                    // Non-idempotent success may still advance checkpoint under CAS.
                    let synthetic = ClaimExternalConnectorIdempotency {
                        profile_id: profile.id.clone(),
                        operation: operation.as_str().to_string(),
                        idempotency_key: format!("auto-{}", request.header().request_id),
                        request_hash,
                        request_id: request.header().request_id.clone(),
                        stream_id: stream_id.clone(),
                        attempt: request.header().attempt,
                        plugin_id: profile.plugin_id.clone(),
                        version_id: profile.version_id.clone(),
                        contribution_id: profile.contribution_id.clone(),
                        activation_revision: profile.activation_revision,
                    };
                    if let ExternalConnectorIdempotencyClaim::Fresh(record) =
                        self.store.claim_external_connector_idempotency(synthetic)?
                    {
                        let (_, checkpoint_record) = self.store.finalize_external_connector_success(
                            FinalizeExternalConnectorSuccess {
                                invocation_id: record.id,
                                profile_id: profile.id.clone(),
                                stream_id,
                                expected_checkpoint_revision: request
                                    .header()
                                    .expected_checkpoint_revision,
                                checkpoint_schema_version: Some(checkpoint.schema_version),
                                checkpoint_payload: Some(checkpoint.payload.clone()),
                                checkpoint_cursor: checkpoint.cursor.clone(),
                                result: result_value.clone(),
                                plugin_id: profile.plugin_id.clone(),
                                version_id: profile.version_id.clone(),
                                contribution_id: profile.contribution_id.clone(),
                                activation_revision: profile.activation_revision,
                            },
                        )?;
                        checkpoint_revision = checkpoint_record.map(|value| value.revision);
                    }
                }
                Ok(ExternalConnectorInvokeResult {
                    profile_id: profile.id,
                    request_id: request.header().request_id.clone(),
                    operation: operation.as_str().to_string(),
                    result: result_value,
                    checkpoint_revision,
                    replayed: false,
                })
            }
            Err(failure) => {
                failure
                    .validate()
                    .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                if let Some(invocation_id) = invocation_id {
                    let status = match failure.code {
                        ExternalConnectorFailureCodeV1::Cancelled => {
                            ExternalConnectorInvocationStatus::Cancelled
                        }
                        ExternalConnectorFailureCodeV1::Timeout => {
                            ExternalConnectorInvocationStatus::Timeout
                        }
                        ExternalConnectorFailureCodeV1::IdempotencyConflict
                        | ExternalConnectorFailureCodeV1::Conflict => {
                            ExternalConnectorInvocationStatus::Conflict
                        }
                        _ => ExternalConnectorInvocationStatus::Failed,
                    };
                    let _ = self.store.finalize_external_connector_failure(
                        FinalizeExternalConnectorFailure {
                            invocation_id,
                            status,
                            failure_code: failure.code.as_str().to_string(),
                            failure_message: failure.message.clone(),
                            retryable: failure.retryable,
                            retry_after_ms: failure.retry_after_ms,
                        },
                    );
                }
                Err(EngineError::InvalidState(format!(
                    "external connector {} failed: {}",
                    failure.code.as_str(),
                    failure.message
                )))
            }
        }
    }
}

fn authorize_registration(lease: &ExternalConnectorLease) -> Result<()> {
    for operation in &lease.registration.executable.operations {
        authorize_operation(lease, *operation)?;
    }
    for origin in &lease.registration.executable.origins {
        authorize_origin(lease, origin)?;
    }
    Ok(())
}

fn authorize_operation(
    lease: &ExternalConnectorLease,
    operation: ExternalConnectorOperationV1,
) -> Result<()> {
    lease
        .registration
        .authorizer
        .authorize(&PluginCapabilityCheck {
            plugin_id: lease.registration.owner.plugin_id.clone(),
            version_id: lease.registration.owner.version_id.clone(),
            capability_id: PluginCapabilityId::ExternalConnector,
            scope: PluginCapabilityScope::Operations {
                operations: vec![operation.as_str().to_string()],
            },
            contribution_id: Some(lease.registration.owner.contribution_id.clone()),
            operation: operation.as_str().to_string(),
        })
        .map_err(EngineError::PluginCapabilityDenied)?;
    Ok(())
}

fn authorize_origin(lease: &ExternalConnectorLease, origin: &str) -> Result<()> {
    lease
        .registration
        .authorizer
        .authorize(&PluginCapabilityCheck {
            plugin_id: lease.registration.owner.plugin_id.clone(),
            version_id: lease.registration.owner.version_id.clone(),
            capability_id: PluginCapabilityId::NetworkConnect,
            scope: PluginCapabilityScope::Network {
                origins: vec![origin.to_string()],
            },
            contribution_id: Some(lease.registration.owner.contribution_id.clone()),
            operation: "network.connect".to_string(),
        })
        .map_err(EngineError::PluginCapabilityDenied)?;
    Ok(())
}

fn profile_view(record: ExternalConnectorProfileRecord) -> ExternalConnectorProfile {
    ExternalConnectorProfile {
        id: record.id,
        display_name: record.display_name,
        contribution_id: record.contribution_id,
        plugin_id: record.plugin_id,
        version_id: record.version_id,
        activation_revision: record.activation_revision,
        contract_version: record.contract_version,
        config_schema_version: record.config_schema_version,
        checkpoint_schema_version: record.checkpoint_schema_version,
        configuration: record.configuration,
        enabled: record.enabled,
        credential_slots: record
            .credential_slots
            .into_iter()
            .map(|slot| ExternalConnectorCredentialSlotStatus {
                slot_id: slot.slot_id,
                present: slot.present,
            })
            .collect(),
        origins: record.origins,
        operations: record.operations,
        revision: record.revision,
        created_at_ms: record.created_at_ms,
        updated_at_ms: record.updated_at_ms,
    }
}

fn credential_status(record: &ExternalConnectorProfileRecord) -> ExternalConnectorCredentialStatus {
    ExternalConnectorCredentialStatus {
        profile_id: record.id.clone(),
        slots: record
            .credential_slots
            .iter()
            .map(|slot| ExternalConnectorCredentialSlotStatus {
                slot_id: slot.slot_id.clone(),
                present: slot.present,
            })
            .collect(),
        revision: record.revision,
    }
}

fn value_to_config(
    value: &Value,
) -> Result<translunar_plugin_runtime::EngineConnectorConfigV1> {
    serde_json::from_value(value.clone())
        .map_err(|error| EngineError::InvalidRequest(error.to_string()))
}

fn hash_json(value: &Value) -> Result<String> {
    let bytes = serde_json::to_vec(value)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn map_credential_error(error: CredentialError) -> EngineError {
    match error {
        CredentialError::Missing => {
            EngineError::InvalidRequest("external connector credential is missing".into())
        }
        CredentialError::Unavailable | CredentialError::Failed => {
            EngineError::InvalidState("external connector credential store failed".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use translunar_plugin_runtime::{
        EXTERNAL_CONNECTOR_PROTOCOL_V1, EngineConnectorConfigFieldTypeV1,
        EngineConnectorConfigFieldV1, EngineConnectorConfigSchemaV1,
        EngineConnectorConfigValueV1, ExternalConnectorCredentialSlotV1,
        ExternalConnectorLimitsV1,
    };

    struct AllowAll;

    impl std::fmt::Debug for AllowAll {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("AllowAll")
        }
    }

    impl PluginCapabilityAuthorizer for AllowAll {
        fn authorize(
            &self,
            _check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<translunar_plugin_runtime::PluginCapabilityDenial>> {
            Ok(())
        }
    }

    fn executable() -> ExternalConnectorExecutableDescriptorV1 {
        ExternalConnectorExecutableDescriptorV1 {
            protocol: EXTERNAL_CONNECTOR_PROTOCOL_V1.into(),
            contract_version: 1,
            config_schema_version: 1,
            checkpoint_schema_version: 1,
            operations: vec![
                ExternalConnectorOperationV1::ValidateConfig,
                ExternalConnectorOperationV1::Test,
                ExternalConnectorOperationV1::Pull,
                ExternalConnectorOperationV1::Push,
            ],
            origins: vec!["http://127.0.0.1:43124".into()],
            credential_slots: vec![ExternalConnectorCredentialSlotV1 {
                id: "apiToken".into(),
                label: "API token".into(),
                description: None,
                required: true,
                operations: vec![
                    ExternalConnectorOperationV1::Test,
                    ExternalConnectorOperationV1::Pull,
                    ExternalConnectorOperationV1::Push,
                ],
            }],
            config_schema: EngineConnectorConfigSchemaV1 {
                schema_version: 1,
                fields: vec![EngineConnectorConfigFieldV1 {
                    key: "scenario".into(),
                    label: "Scenario".into(),
                    field_type: EngineConnectorConfigFieldTypeV1::Text,
                    required: false,
                    description: None,
                    default_value: Some(EngineConnectorConfigValueV1::String("success".into())),
                    min: None,
                    max: None,
                    options: vec![],
                }],
            },
            limits: ExternalConnectorLimitsV1::default(),
            declarative: None,
        }
    }

    #[test]
    fn registry_attach_and_stale_detach() {
        let registry = ExternalConnectorRegistry::default();
        let executable = executable();
        let descriptor = ExternalConnectorContributionDescriptor {
            descriptor_version: 1,
            id: "example.external".into(),
            version: "1.0.0".into(),
            display_name: "External".into(),
            transports: vec!["http".into()],
            checkpoint_version: 1,
            capabilities: BTreeMap::new(),
            protocol: Some(executable.protocol.clone()),
            contract_version: Some(1),
            config_schema_version: Some(1),
            checkpoint_schema_version: Some(1),
            operations: Some(executable.operations.clone()),
            origins: Some(executable.origins.clone()),
            credential_slots: Some(executable.credential_slots.clone()),
            config_schema: Some(executable.config_schema.clone()),
            limits: Some(executable.limits.clone()),
            declarative: None,
        };
        let registration = ExternalConnectorRegistration {
            owner: ExternalConnectorOwnerToken {
                plugin_id: "plugin".into(),
                version_id: "install-v1:plugin:1.0.0".into(),
                activation_revision: 1,
                contribution_id: "example.external".into(),
                contract_version: 1,
            },
            descriptor,
            executable,
            tier: PluginTier::Process,
            authorizer: Arc::new(AllowAll),
            host: fixture_external_connector_host(),
            cancel: Arc::new(AtomicBool::new(false)),
        };
        registry.attach_all(vec![registration]).expect("attach");
        assert_eq!(registry.catalog().items.len(), 1);
        registry.detach_generation("plugin", "install-v1:plugin:1.0.0", 1);
        assert!(registry.catalog().items.is_empty());
    }
}
