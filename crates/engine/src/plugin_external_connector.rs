//! Engine-owned external system connector registry, credentials, and
//! synchronous operation boundary (P-08).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use reqwest::blocking::Client;
use reqwest::header::{HeaderName, HeaderValue};
use serde_json::Value;
use sha2::{Digest, Sha256};
use translunar_plugin_runtime::{
    EXTERNAL_CONNECTOR_CONTRACT_VERSION, EXTERNAL_CONNECTOR_CREDENTIAL_NAMESPACE,
    ExternalConnectorAuthenticationV1, ExternalConnectorBatchResultV1,
    ExternalConnectorConfigValidationResultV1, ExternalConnectorContributionDescriptor,
    ExternalConnectorEndpointMappingV1, ExternalConnectorExecutableDescriptorV1,
    ExternalConnectorFailureCodeV1, ExternalConnectorFailureV1, ExternalConnectorHttpMethodV1,
    ExternalConnectorInvocationContextV1, ExternalConnectorOperationV1,
    ExternalConnectorProfileBindingV1, ExternalConnectorPushResultV1, ExternalConnectorRequestV1,
    ExternalConnectorResultV1, ExternalConnectorTestResultV1, ExternalConnectorWebhookSignatureV1,
    PluginCapabilityAuthorizer, PluginCapabilityCheck, PluginCapabilityId, PluginCapabilityScope,
    PluginRuntimeError, PluginTier, SandboxCancellationToken, SandboxInvocationV1,
    SandboxWorkerHandle,
};

#[cfg(test)]
use serde_json::json;
use translunar_protocol::{
    EmptyResult, ExternalConnectorCatalogEntry, ExternalConnectorCatalogPage,
    ExternalConnectorCheckpointGetParams, ExternalConnectorCheckpointView,
    ExternalConnectorCredentialDeleteParams, ExternalConnectorCredentialSetParams,
    ExternalConnectorCredentialSlotStatus, ExternalConnectorCredentialStatus,
    ExternalConnectorCredentialStatusParams, ExternalConnectorInvokeParams,
    ExternalConnectorInvokeResult, ExternalConnectorProfile, ExternalConnectorProfileCreateParams,
    ExternalConnectorProfileListParams, ExternalConnectorProfilePage,
    ExternalConnectorProfileRevisionParams, ExternalConnectorProfileUpdateParams,
    PluginContributionOwner, PluginContributionState,
};
use translunar_storage::{
    ClaimExternalConnectorIdempotency, ExternalConnectorIdempotencyClaim,
    ExternalConnectorInvocationStatus, ExternalConnectorProfileRecord,
    FinalizeExternalConnectorFailure, FinalizeExternalConnectorSuccess,
    NewExternalConnectorProfile,
};

use crate::{EngineError, EngineService, Result};

#[cfg(test)]
use translunar_plugin_runtime::{ExternalConnectorItemV1, ExternalConnectorRequestHeaderV1};

pub(crate) type HostInvoke = Arc<
    dyn Fn(
            &ExternalConnectorExecutableDescriptorV1,
            &ExternalConnectorRequestV1,
            &ExternalConnectorInvocationContextV1,
        ) -> std::result::Result<ExternalConnectorResultV1, ExternalConnectorFailureV1>
        + Send
        + Sync,
>;

fn host_failure(
    request: &ExternalConnectorRequestV1,
    code: ExternalConnectorFailureCodeV1,
    message: &'static str,
    retryable: bool,
) -> ExternalConnectorFailureV1 {
    ExternalConnectorFailureV1 {
        contract_version: EXTERNAL_CONNECTOR_CONTRACT_VERSION,
        request_id: request.header().request_id.clone(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

pub(crate) fn process_external_connector_host(
    process: Arc<translunar_plugin_runtime::PluginProcess>,
    contribution_id: String,
) -> HostInvoke {
    Arc::new(move |_, request, context| {
        process
            .call_external_connector(
                &contribution_id,
                request,
                context,
                std::time::Duration::from_millis(request.header().deadline_ms),
            )
            .map_err(|error| match error {
                PluginRuntimeError::ExternalConnectorFailure(failure) => failure,
                PluginRuntimeError::Timeout(_) => host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Timeout,
                    "external connector timed out",
                    true,
                ),
                PluginRuntimeError::Process(_) | PluginRuntimeError::Io(_) => host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::HostCrash,
                    "external connector process failed",
                    true,
                ),
                _ => host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Protocol,
                    "external connector process returned an invalid response",
                    false,
                ),
            })
    })
}

pub(crate) fn sandbox_external_connector_host(
    worker: SandboxWorkerHandle,
    contribution_id: String,
) -> HostInvoke {
    Arc::new(move |_, request, context| {
        let operation = format!("externalConnector.{}", request.operation().as_str());
        let invocation = SandboxInvocationV1 {
            protocol_version: translunar_plugin_runtime::SANDBOX_PROTOCOL_VERSION,
            invocation_id: request.header().request_id.clone(),
            contribution_id: contribution_id.clone(),
            operation,
            input: serde_json::to_value(request).map_err(|_| {
                host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Protocol,
                    "external connector request encoding failed",
                    false,
                )
            })?,
        };
        let result = worker
            .invoke_with_credentials_and_cancellation(
                invocation,
                &context.credentials,
                std::time::Duration::from_millis(request.header().deadline_ms),
                SandboxCancellationToken::default(),
            )
            .map_err(|error| {
                let (code, message, retryable) = match error {
                    translunar_plugin_runtime::SandboxError::Cancelled => (
                        ExternalConnectorFailureCodeV1::Cancelled,
                        "external connector was cancelled",
                        false,
                    ),
                    translunar_plugin_runtime::SandboxError::Timeout => (
                        ExternalConnectorFailureCodeV1::Timeout,
                        "external connector timed out",
                        true,
                    ),
                    translunar_plugin_runtime::SandboxError::Disconnected => (
                        ExternalConnectorFailureCodeV1::HostCrash,
                        "external connector sandbox failed",
                        true,
                    ),
                    _ => (
                        ExternalConnectorFailureCodeV1::Protocol,
                        "external connector sandbox returned an invalid response",
                        false,
                    ),
                };
                host_failure(request, code, message, retryable)
            })?;
        if !result.ok {
            return Err(host_failure(
                request,
                ExternalConnectorFailureCodeV1::Unavailable,
                "external connector sandbox operation failed",
                false,
            ));
        }
        serde_json::from_value(result.output.unwrap_or(Value::Null)).map_err(|_| {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::Protocol,
                "external connector sandbox returned an invalid response",
                false,
            )
        })
    })
}

pub(crate) fn declarative_external_connector_host() -> HostInvoke {
    Arc::new(|descriptor, request, context| {
        let Some(definition) = descriptor.declarative.as_deref() else {
            return Err(host_failure(
                request,
                ExternalConnectorFailureCodeV1::InvalidConfig,
                "declarative external connector mapping is missing",
                false,
            ));
        };
        if matches!(request, ExternalConnectorRequestV1::ValidateConfig { .. })
            && definition.validate_config.is_none()
        {
            return Ok(ExternalConnectorResultV1::ValidateConfig(
                ExternalConnectorConfigValidationResultV1 {
                    valid: true,
                    issues: vec![],
                },
            ));
        }
        if let ExternalConnectorRequestV1::Webhook { payload, .. } = request {
            verify_declarative_webhook(definition.webhook_signature.as_ref(), payload, context)
                .map_err(|()| {
                    host_failure(
                        request,
                        ExternalConnectorFailureCodeV1::Authentication,
                        "webhook signature verification failed",
                        false,
                    )
                })?;
        }
        let mapping = declarative_mapping(definition, request.operation()).ok_or_else(|| {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::InvalidConfig,
                "declarative external connector operation mapping is missing",
                false,
            )
        })?;
        invoke_declarative_http(descriptor, mapping, request, context)
    })
}

fn declarative_mapping(
    definition: &translunar_plugin_runtime::DeclarativeExternalConnectorDefinitionV1,
    operation: ExternalConnectorOperationV1,
) -> Option<&ExternalConnectorEndpointMappingV1> {
    match operation {
        ExternalConnectorOperationV1::ValidateConfig => definition.validate_config.as_ref(),
        ExternalConnectorOperationV1::Test => definition.test.as_ref(),
        ExternalConnectorOperationV1::Pull => definition.pull.as_ref(),
        ExternalConnectorOperationV1::Push => definition.push.as_ref(),
        ExternalConnectorOperationV1::Poll => definition.poll.as_ref(),
        ExternalConnectorOperationV1::Webhook => definition.webhook.as_ref(),
    }
}

fn verify_declarative_webhook(
    signature: Option<&ExternalConnectorWebhookSignatureV1>,
    payload: &translunar_plugin_runtime::ExternalConnectorWebhookPayloadV1,
    context: &ExternalConnectorInvocationContextV1,
) -> std::result::Result<(), ()> {
    let Some(signature) = signature else {
        return Ok(());
    };
    match signature {
        ExternalConnectorWebhookSignatureV1::None => Ok(()),
        ExternalConnectorWebhookSignatureV1::HmacSha256 {
            header,
            slot,
            prefix,
        } => {
            let secret = context.credentials.get(slot).ok_or(())?;
            let supplied = payload
                .headers
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(header))
                .map(|(_, value)| value.as_str())
                .or(payload.signature.as_deref())
                .ok_or(())?;
            let expected = hmac_sha256_hex(
                secret.as_bytes(),
                &serde_json::to_vec(&payload.body).map_err(|_| ())?,
            );
            let supplied = prefix
                .as_deref()
                .and_then(|prefix| supplied.strip_prefix(prefix))
                .unwrap_or(supplied);
            if constant_time_eq(expected.as_bytes(), supplied.as_bytes()) {
                Ok(())
            } else {
                Err(())
            }
        }
    }
}

fn hmac_sha256_hex(key: &[u8], body: &[u8]) -> String {
    const BLOCK: usize = 64;
    let hashed;
    let key = if key.len() > BLOCK {
        hashed = Sha256::digest(key).to_vec();
        hashed.as_slice()
    } else {
        key
    };
    let mut outer = [0x5c_u8; BLOCK];
    let mut inner = [0x36_u8; BLOCK];
    for (index, byte) in key.iter().enumerate() {
        outer[index] ^= byte;
        inner[index] ^= byte;
    }
    let inner_hash = Sha256::new()
        .chain_update(inner)
        .chain_update(body)
        .finalize();
    format!(
        "{:x}",
        Sha256::new()
            .chain_update(outer)
            .chain_update(inner_hash)
            .finalize()
    )
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn invoke_declarative_http(
    descriptor: &ExternalConnectorExecutableDescriptorV1,
    mapping: &ExternalConnectorEndpointMappingV1,
    request: &ExternalConnectorRequestV1,
    context: &ExternalConnectorInvocationContextV1,
) -> std::result::Result<ExternalConnectorResultV1, ExternalConnectorFailureV1> {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_millis(
            request.header().deadline_ms,
        ))
        .build()
        .map_err(|_| {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::Unavailable,
                "HTTP host is unavailable",
                true,
            )
        })?;
    let method = match mapping.method {
        ExternalConnectorHttpMethodV1::Get => reqwest::Method::GET,
        ExternalConnectorHttpMethodV1::Post => reqwest::Method::POST,
        ExternalConnectorHttpMethodV1::Put => reqwest::Method::PUT,
        ExternalConnectorHttpMethodV1::Patch => reqwest::Method::PATCH,
        ExternalConnectorHttpMethodV1::Delete => reqwest::Method::DELETE,
    };
    let mut builder = client.request(method.clone(), &mapping.url_template);
    if !mapping.fixed_query.is_empty() {
        builder = builder.query(&mapping.fixed_query);
    }
    for header in &mapping.fixed_headers {
        let name = HeaderName::from_bytes(header.name.as_bytes()).map_err(|_| {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::InvalidConfig,
                "HTTP header mapping is invalid",
                false,
            )
        })?;
        let value = HeaderValue::from_str(&header.value).map_err(|_| {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::InvalidConfig,
                "HTTP header mapping is invalid",
                false,
            )
        })?;
        builder = builder.header(name, value);
    }
    match &mapping.authentication {
        ExternalConnectorAuthenticationV1::None => {}
        ExternalConnectorAuthenticationV1::Bearer { slot } => {
            let value = context.credentials.get(slot).ok_or_else(|| {
                host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Authentication,
                    "required credential is missing",
                    false,
                )
            })?;
            builder = builder.bearer_auth(value);
        }
        ExternalConnectorAuthenticationV1::Header { name, slot } => {
            let value = context.credentials.get(slot).ok_or_else(|| {
                host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Authentication,
                    "required credential is missing",
                    false,
                )
            })?;
            builder = builder.header(name, value);
        }
        ExternalConnectorAuthenticationV1::Query { name, slot } => {
            let value = context.credentials.get(slot).ok_or_else(|| {
                host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Authentication,
                    "required credential is missing",
                    false,
                )
            })?;
            builder = builder.query(&[(name, value)]);
        }
    }
    if method != reqwest::Method::GET {
        let mut body = serde_json::Map::from_iter(mapping.fixed_body.clone());
        body.insert(
            "request".to_string(),
            serde_json::to_value(request).map_err(|_| {
                host_failure(
                    request,
                    ExternalConnectorFailureCodeV1::Protocol,
                    "HTTP request mapping failed",
                    false,
                )
            })?,
        );
        builder = builder.json(&body);
    }
    let mut response = builder.send().map_err(|error| {
        if error.is_timeout() {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::Timeout,
                "HTTP request timed out",
                true,
            )
        } else {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::Unavailable,
                "HTTP request failed",
                true,
            )
        }
    })?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        let failure = descriptor.declarative.as_ref().and_then(|definition| {
            definition
                .failures
                .iter()
                .find(|failure| failure.status == status)
        });
        let code = failure.map_or(ExternalConnectorFailureCodeV1::Unavailable, |failure| {
            failure.code
        });
        let retryable = failure.is_some_and(|failure| failure.retryable);
        return Err(host_failure(
            request,
            code,
            "external HTTP service rejected the request",
            retryable,
        ));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(u64::from(descriptor.limits.max_response_bytes) + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            host_failure(
                request,
                ExternalConnectorFailureCodeV1::Unavailable,
                "HTTP response could not be read",
                true,
            )
        })?;
    if bytes.len() > descriptor.limits.max_response_bytes as usize {
        return Err(host_failure(
            request,
            ExternalConnectorFailureCodeV1::PayloadSize,
            "HTTP response exceeds the configured limit",
            false,
        ));
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        host_failure(
            request,
            ExternalConnectorFailureCodeV1::Protocol,
            "HTTP response is not valid JSON",
            false,
        )
    })?;
    if let Ok(result) = serde_json::from_value::<ExternalConnectorResultV1>(value.clone()) {
        return Ok(result);
    }
    map_declarative_response(mapping, request, &value).map_err(|_| {
        host_failure(
            request,
            ExternalConnectorFailureCodeV1::Protocol,
            "HTTP response does not match the declarative mapping",
            false,
        )
    })
}

fn map_declarative_response(
    mapping: &ExternalConnectorEndpointMappingV1,
    request: &ExternalConnectorRequestV1,
    value: &Value,
) -> std::result::Result<ExternalConnectorResultV1, ()> {
    let path = |path: &Option<Vec<String>>| -> Option<&Value> {
        path.as_ref().and_then(|segments| {
            segments
                .iter()
                .try_fold(value, |current, segment| current.get(segment))
        })
    };
    match request.operation() {
        ExternalConnectorOperationV1::ValidateConfig => {
            Ok(ExternalConnectorResultV1::ValidateConfig(
                serde_json::from_value(value.clone()).map_err(|_| ())?,
            ))
        }
        ExternalConnectorOperationV1::Test => Ok(ExternalConnectorResultV1::Test(
            serde_json::from_value::<ExternalConnectorTestResultV1>(value.clone())
                .map_err(|_| ())?,
        )),
        ExternalConnectorOperationV1::Push => {
            let receipts = path(&mapping.receipts_path).ok_or(())?;
            let checkpoint = path(&mapping.checkpoint_path)
                .map(|value| serde_json::from_value(value.clone()).map_err(|_| ()))
                .transpose()?;
            Ok(ExternalConnectorResultV1::Push(
                ExternalConnectorPushResultV1 {
                    receipts: serde_json::from_value(receipts.clone()).map_err(|_| ())?,
                    checkpoint,
                },
            ))
        }
        operation => {
            let items = path(&mapping.items_path).ok_or(())?;
            let has_more = path(&mapping.has_more_path)
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let checkpoint = path(&mapping.checkpoint_path)
                .map(|value| serde_json::from_value(value.clone()).map_err(|_| ()))
                .transpose()?;
            let batch = ExternalConnectorBatchResultV1 {
                items: serde_json::from_value(items.clone()).map_err(|_| ())?,
                has_more,
                next_cursor: value
                    .get("nextCursor")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                checkpoint,
            };
            match operation {
                ExternalConnectorOperationV1::Pull => Ok(ExternalConnectorResultV1::Pull(batch)),
                ExternalConnectorOperationV1::Poll => Ok(ExternalConnectorResultV1::Poll(batch)),
                ExternalConnectorOperationV1::Webhook => {
                    Ok(ExternalConnectorResultV1::Webhook(batch))
                }
                _ => Err(()),
            }
        }
    }
}

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
        items.sort_by(|left, right| left.owner.contribution_id.cmp(&right.owner.contribution_id));
        ExternalConnectorCatalogPage { items }
    }
}

pub(crate) trait ExternalConnectorCredentialStore: Send + Sync {
    fn status(&self, profile_id: &str, slot_id: &str)
    -> std::result::Result<bool, CredentialError>;
    fn set(
        &self,
        profile_id: &str,
        slot_id: &str,
        secret: &str,
    ) -> std::result::Result<(), CredentialError>;
    fn get(&self, profile_id: &str, slot_id: &str) -> std::result::Result<String, CredentialError>;
    fn delete(&self, profile_id: &str, slot_id: &str) -> std::result::Result<(), CredentialError>;
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
        let guard = self
            .values
            .lock()
            .map_err(|_| CredentialError::Unavailable)?;
        Ok(guard.contains_key(&(profile_id.to_string(), slot_id.to_string())))
    }

    fn set(
        &self,
        profile_id: &str,
        slot_id: &str,
        secret: &str,
    ) -> std::result::Result<(), CredentialError> {
        let mut guard = self
            .values
            .lock()
            .map_err(|_| CredentialError::Unavailable)?;
        guard.insert(
            (profile_id.to_string(), slot_id.to_string()),
            secret.to_string(),
        );
        Ok(())
    }

    fn get(&self, profile_id: &str, slot_id: &str) -> std::result::Result<String, CredentialError> {
        let guard = self
            .values
            .lock()
            .map_err(|_| CredentialError::Unavailable)?;
        guard
            .get(&(profile_id.to_string(), slot_id.to_string()))
            .cloned()
            .ok_or(CredentialError::Missing)
    }

    fn delete(&self, profile_id: &str, slot_id: &str) -> std::result::Result<(), CredentialError> {
        let mut guard = self
            .values
            .lock()
            .map_err(|_| CredentialError::Unavailable)?;
        guard.remove(&(profile_id.to_string(), slot_id.to_string()));
        Ok(())
    }
}

struct KeyringExternalConnectorCredentialStore;

impl KeyringExternalConnectorCredentialStore {
    fn entry(
        profile_id: &str,
        slot_id: &str,
    ) -> std::result::Result<keyring::Entry, CredentialError> {
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

    fn get(&self, profile_id: &str, slot_id: &str) -> std::result::Result<String, CredentialError> {
        match Self::entry(profile_id, slot_id)?.get_password() {
            Ok(value) => Ok(value),
            Err(keyring::Error::NoEntry) => Err(CredentialError::Missing),
            Err(_) => Err(CredentialError::Failed),
        }
    }

    fn delete(&self, profile_id: &str, slot_id: &str) -> std::result::Result<(), CredentialError> {
        match Self::entry(profile_id, slot_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CredentialError::Failed),
        }
    }
}

pub(crate) fn default_external_connector_credential_store()
-> Arc<dyn ExternalConnectorCredentialStore> {
    if cfg!(test) {
        Arc::new(MemoryExternalConnectorCredentialStore::default())
    } else {
        Arc::new(KeyringExternalConnectorCredentialStore)
    }
}

/// Deterministic in-process host used only by unit tests. Production plugin
/// lifecycle registrations must use their tier-specific host constructors.
#[cfg(test)]
pub(crate) fn fixture_external_connector_host() -> HostInvoke {
    Arc::new(|descriptor, request, context| {
        let request_id = request.header().request_id.clone();
        let fail = |code: ExternalConnectorFailureCodeV1,
                    message: &str,
                    retryable: bool,
                    retry_after_ms: Option<u64>| {
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
            "auth" => {
                return fail(
                    ExternalConnectorFailureCodeV1::Authentication,
                    "authentication failed",
                    false,
                    None,
                );
            }
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
                ExternalConnectorResultV1::ValidateConfig(
                    ExternalConnectorConfigValidationResultV1 {
                        valid: true,
                        issues: vec![],
                    },
                )
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
                        .map(
                            |item| translunar_plugin_runtime::ExternalConnectorReceiptV1 {
                                external_id: item.external_id.clone(),
                                accepted: true,
                                remote_revision: Some("r1".into()),
                                message: None,
                            },
                        )
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

#[cfg(test)]
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
        let record = self
            .store
            .create_external_connector_profile(NewExternalConnectorProfile {
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
            })?;
        Ok(profile_view(record))
    }

    pub(crate) fn update_external_connector_profile(
        &mut self,
        params: ExternalConnectorProfileUpdateParams,
    ) -> Result<ExternalConnectorProfile> {
        let current = self
            .store
            .get_external_connector_profile(&params.profile_id)?;
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
        let current = self
            .store
            .get_external_connector_profile(&params.profile_id)?;
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
        let current = self
            .store
            .get_external_connector_profile(&params.profile_id)?;
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
        let current = self
            .store
            .get_external_connector_profile(&params.profile_id)?;
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
        let record = self
            .store
            .get_external_connector_profile(&params.profile_id)?;
        let slots = record
            .credential_slots
            .iter()
            .map(|slot| {
                Ok(ExternalConnectorCredentialSlotStatus {
                    slot_id: slot.slot_id.clone(),
                    present: self
                        .external_connector_credentials
                        .status(&record.id, &slot.slot_id)
                        .map_err(map_credential_error)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(ExternalConnectorCredentialStatus {
            profile_id: record.id,
            slots,
            revision: record.revision,
        })
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
        let profile = self
            .store
            .get_external_connector_profile(&params.profile_id)?;
        if !profile.enabled {
            return Err(EngineError::InvalidState(
                "external connector profile is disabled".into(),
            ));
        }
        let lease = self
            .external_connector_registry
            .lookup(&profile.contribution_id)?;
        let _registry_generation = lease.generation;
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

        if !lease.active.load(Ordering::Acquire)
            || lease.registration.cancel.load(Ordering::Acquire)
        {
            context.clear();
            return Err(EngineError::InvalidState(
                "external connector call was cancelled".into(),
            ));
        }

        let started = Instant::now();
        let host_result =
            (lease.registration.host)(&lease.registration.executable, &request, &context);
        context.clear();
        let _elapsed = started.elapsed();

        // Detach/revocation may race a synchronous Tier 1 or Tier 3 host call.
        // Never let a result from the old exact generation become durable after
        // teardown, even when the remote side completed before cancellation was
        // observable by the adapter.
        if !lease.active.load(Ordering::Acquire)
            || lease.registration.cancel.load(Ordering::Acquire)
        {
            if let Some(invocation_id) = invocation_id.as_ref() {
                let _ = self.store.finalize_external_connector_failure(
                    FinalizeExternalConnectorFailure {
                        invocation_id: invocation_id.clone(),
                        status: ExternalConnectorInvocationStatus::Cancelled,
                        failure_code: "cancelled".into(),
                        failure_message: "external connector generation was detached".into(),
                        retryable: false,
                        retry_after_ms: None,
                    },
                );
            }
            return Err(EngineError::InvalidState(
                "external connector call was cancelled".into(),
            ));
        }

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
                        let (_, checkpoint_record) =
                            self.store.finalize_external_connector_success(
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

fn value_to_config(value: &Value) -> Result<translunar_plugin_runtime::EngineConnectorConfigV1> {
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
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use translunar_plugin_runtime::{
        DeclarativeExternalConnectorDefinitionV1, EXTERNAL_CONNECTOR_PROTOCOL_V1,
        EngineConnectorConfigFieldTypeV1, EngineConnectorConfigFieldV1,
        EngineConnectorConfigSchemaV1, EngineConnectorConfigValueV1,
        ExternalConnectorCredentialSlotV1, ExternalConnectorHeaderV1,
        ExternalConnectorHttpMethodV1, ExternalConnectorLimitsV1, ExternalConnectorPullPayloadV1,
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
        ) -> std::result::Result<(), Box<translunar_plugin_runtime::PluginCapabilityDenial>>
        {
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

    fn request_header() -> ExternalConnectorRequestHeaderV1 {
        ExternalConnectorRequestHeaderV1 {
            contract_version: 1,
            request_id: "request-1".into(),
            deadline_ms: 2_000,
            binding: ExternalConnectorProfileBindingV1 {
                profile_id: "profile-1".into(),
                contribution_id: "example.external".into(),
                plugin_id: "plugin".into(),
                version_id: "install-v1:plugin:1.0.0".into(),
                activation_revision: 1,
                contract_version: 1,
                config_schema_version: 1,
                checkpoint_schema_version: 1,
            },
            idempotency_key: Some("request-1".into()),
            expected_checkpoint_revision: None,
            attempt: 1,
            config: BTreeMap::new(),
        }
    }

    fn serve_once(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind HTTP fixture");
        let address = listener.local_addr().expect("HTTP fixture address");
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept HTTP request");
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .expect("set fixture timeout");
            let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
            let mut headers = String::new();
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read fixture header");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().expect("content length");
                }
                headers.push_str(&line);
            }
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).expect("read fixture body");
            stream
                .write_all(response.as_bytes())
                .expect("write fixture response");
            format!(
                "{headers}__BODY__{}",
                String::from_utf8(body).expect("UTF-8 body")
            )
        });
        (format!("http://{address}"), handle)
    }

    #[test]
    fn declarative_host_uses_real_http_mapping_auth_and_closed_failures() {
        let success = r#"{"items":[{"externalId":"item-1","sourceLocale":"en","targetLocale":"ja","sourceText":"hello"}],"hasMore":false}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{success}",
            success.len()
        );
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (origin, observed) = serve_once(response);
        let mapping = ExternalConnectorEndpointMappingV1 {
            destination_origin: origin.clone(),
            url_template: format!("{origin}/items"),
            method: ExternalConnectorHttpMethodV1::Post,
            fixed_headers: vec![ExternalConnectorHeaderV1 {
                name: "x-fixture".into(),
                value: "fixed".into(),
            }],
            authentication: ExternalConnectorAuthenticationV1::Bearer {
                slot: "apiToken".into(),
            },
            fixed_query: BTreeMap::from([("mode".into(), "mapped".into())]),
            fixed_body: BTreeMap::from([("tenant".into(), json!("fixture"))]),
            items_path: Some(vec!["items".into()]),
            has_more_path: Some(vec!["hasMore".into()]),
            checkpoint_path: None,
            receipts_path: None,
        };
        let mut descriptor = executable();
        descriptor.operations = vec![ExternalConnectorOperationV1::Pull];
        descriptor.origins = vec![origin];
        descriptor.declarative = Some(Box::new(DeclarativeExternalConnectorDefinitionV1 {
            definition_version: 1,
            validate_config: None,
            test: None,
            pull: Some(mapping),
            push: None,
            poll: None,
            webhook: None,
            webhook_signature: None,
            failures: vec![],
        }));
        let request = ExternalConnectorRequestV1::Pull {
            header: request_header(),
            payload: ExternalConnectorPullPayloadV1 {
                stream_id: "default".into(),
                cursor: None,
                limit: 10,
                source_locale: None,
                target_locale: None,
            },
        };
        let context = ExternalConnectorInvocationContextV1 {
            credentials: BTreeMap::from([("apiToken".into(), "unit-test-value".into())]),
        };
        let result = (declarative_external_connector_host())(&descriptor, &request, &context)
            .expect("declarative HTTP invocation");
        assert!(matches!(result, ExternalConnectorResultV1::Pull(_)));
        let request_wire = observed.join().expect("HTTP fixture completion");
        assert!(request_wire.starts_with("POST /items?mode=mapped HTTP/1.1"));
        assert!(
            request_wire
                .to_ascii_lowercase()
                .contains("authorization: bearer unit-test-value")
        );
        assert!(
            request_wire
                .to_ascii_lowercase()
                .contains("x-fixture: fixed")
        );
        let body: Value = serde_json::from_str(request_wire.split_once("__BODY__").unwrap().1)
            .expect("mapped request body");
        assert_eq!(body["tenant"], "fixture");
        assert_eq!(body["request"]["operation"], "pull");

        let (redirect_origin, redirect_observed) = serve_once(
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/escape\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let mut redirect = descriptor;
        let redirect_mapping = redirect
            .declarative
            .as_mut()
            .unwrap()
            .pull
            .as_mut()
            .unwrap();
        redirect_mapping.destination_origin = redirect_origin.clone();
        redirect_mapping.url_template = format!("{redirect_origin}/items");
        redirect.origins = vec![redirect_origin];
        let failure = (declarative_external_connector_host())(&redirect, &request, &context)
            .expect_err("redirect must not be followed");
        assert_eq!(failure.code, ExternalConnectorFailureCodeV1::Unavailable);
        redirect_observed
            .join()
            .expect("redirect fixture completion");
    }
}
