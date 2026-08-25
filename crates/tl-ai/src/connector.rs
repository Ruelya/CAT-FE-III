use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::{
    AiCoreError, AiEventSink, AiMessage, AiProviderKind, AiProviderProfile, AiProviderProtocol,
    AiUsage, MAX_BASE_URL_CHARS, MAX_MODEL_CHARS, MAX_RESPONSE_BYTES, MAX_TIMEOUT_MS,
    MIN_RESPONSE_BYTES, MIN_TIMEOUT_MS, ProviderRequest, SecretString, execute_provider,
    provider_catalog, provider_descriptor, validate_profile_fields,
};

pub const ENGINE_CONNECTOR_CONTRACT_VERSION: u32 = 1;
pub const MAX_CONNECTOR_ID_CHARS: usize = 128;
pub const MAX_CONNECTOR_VERSION_ID_CHARS: usize = 384;
pub const MAX_CONNECTOR_DISPLAY_NAME_CHARS: usize = 120;
pub const MAX_CONNECTOR_REQUEST_ID_CHARS: usize = 128;
pub const MAX_CONNECTOR_MESSAGES: usize = 64;
pub const MAX_CONNECTOR_MESSAGE_BYTES: usize = 128 * 1024;
pub const MAX_CONNECTOR_MESSAGE_TOTAL_BYTES: usize = 512 * 1024;
pub const MAX_CONNECTOR_SOURCE_BYTES: usize = 256 * 1024;
pub const MAX_CONNECTOR_LOCALE_CHARS: usize = 64;
pub const MAX_CONNECTOR_CONFIG_BYTES: usize = 64 * 1024;
pub const MAX_CONNECTOR_CONFIG_DEPTH: usize = 16;
pub const MAX_CONNECTOR_CONFIG_NODES: usize = 2_048;
pub const MAX_CONNECTOR_EVENT_COUNT: usize = 8_192;
pub const MAX_CONNECTOR_EVENT_DELTA_BYTES: usize = 64 * 1024;
pub const MAX_CONNECTOR_MODELS: usize = 512;
pub const MAX_CONNECTOR_MODEL_ID_CHARS: usize = 200;
pub const MAX_CONNECTOR_USAGE_VALUE: u64 = 1_000_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginConnectorOwner {
    pub plugin_id: String,
    pub version_id: String,
}

impl PluginConnectorOwner {
    pub fn validate(&self) -> Result<(), ConnectorRegistryError> {
        validate_identifier("pluginId", &self.plugin_id)?;
        validate_version_identifier("versionId", &self.version_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EngineConnectorSource {
    Builtin {
        provider: AiProviderKind,
    },
    Plugin {
        owner: PluginConnectorOwner,
        contribution_id: String,
        contract_version: u32,
    },
}

impl EngineConnectorSource {
    pub fn connector_id(&self) -> &str {
        match self {
            Self::Builtin { provider } => builtin_provider_id(*provider),
            Self::Plugin {
                contribution_id, ..
            } => contribution_id,
        }
    }

    pub fn plugin_owner(&self) -> Option<&PluginConnectorOwner> {
        match self {
            Self::Builtin { .. } => None,
            Self::Plugin { owner, .. } => Some(owner),
        }
    }

    fn validate(&self) -> Result<(), ConnectorRegistryError> {
        match self {
            Self::Builtin { .. } => Ok(()),
            Self::Plugin {
                owner,
                contribution_id,
                contract_version,
            } => {
                owner.validate()?;
                validate_identifier("contributionId", contribution_id)?;
                if *contract_version != ENGINE_CONNECTOR_CONTRACT_VERSION {
                    return Err(ConnectorRegistryError::UnsupportedContractVersion {
                        version: *contract_version,
                    });
                }
                Ok(())
            }
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum EngineConnectorOperation {
    ValidateConfig,
    Test,
    #[serde(rename = "models.list")]
    ModelsList,
    Generate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorDescriptor {
    pub id: String,
    pub display_name: String,
    pub source: EngineConnectorSource,
    pub config_schema_version: u32,
    pub operations: Vec<EngineConnectorOperation>,
    pub protocol: Option<AiProviderProtocol>,
    pub default_base_url: String,
    pub default_model: String,
    pub supports_streaming: bool,
    pub reports_usage: bool,
    pub credential_hint: String,
}

impl EngineConnectorDescriptor {
    pub fn validate(&self) -> Result<(), ConnectorRegistryError> {
        validate_identifier("connectorId", &self.id)?;
        self.source.validate()?;
        if self.id != self.source.connector_id() {
            return Err(ConnectorRegistryError::SourceIdentityMismatch {
                connector_id: self.id.clone(),
            });
        }
        let display_chars = self.display_name.trim().chars().count();
        if display_chars == 0 || display_chars > MAX_CONNECTOR_DISPLAY_NAME_CHARS {
            return Err(ConnectorRegistryError::InvalidDescriptor {
                field: "displayName",
            });
        }
        if self.config_schema_version == 0 {
            return Err(ConnectorRegistryError::InvalidDescriptor {
                field: "configSchemaVersion",
            });
        }
        let operations = self.operations.iter().copied().collect::<BTreeSet<_>>();
        if operations.len() != self.operations.len()
            || !self.operations.windows(2).all(|pair| pair[0] < pair[1])
            || !operations.contains(&EngineConnectorOperation::ValidateConfig)
            || !operations.contains(&EngineConnectorOperation::Test)
            || !operations.contains(&EngineConnectorOperation::Generate)
        {
            return Err(ConnectorRegistryError::InvalidDescriptor {
                field: "operations",
            });
        }
        if self.default_base_url.len() > MAX_BASE_URL_CHARS
            || self.default_model.chars().count() > MAX_MODEL_CHARS
            || self.credential_hint.chars().count() > MAX_CONNECTOR_DISPLAY_NAME_CHARS
        {
            return Err(ConnectorRegistryError::InvalidDescriptor { field: "defaults" });
        }
        match self.source {
            EngineConnectorSource::Builtin { provider } => {
                if self.protocol != Some(provider_descriptor(provider).protocol) {
                    return Err(ConnectorRegistryError::InvalidDescriptor { field: "protocol" });
                }
            }
            EngineConnectorSource::Plugin { .. } if self.protocol.is_some() => {
                return Err(ConnectorRegistryError::InvalidDescriptor { field: "protocol" });
            }
            EngineConnectorSource::Plugin { .. } => {}
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectorRequestContext {
    pub contract_version: u32,
    pub request_id: String,
    pub deadline_ms: i64,
}

impl ConnectorRequestContext {
    fn validate(&self) -> Result<(), EngineConnectorFailure> {
        let request_id_chars = self.request_id.chars().count();
        if self.contract_version != ENGINE_CONNECTOR_CONTRACT_VERSION
            || request_id_chars == 0
            || request_id_chars > MAX_CONNECTOR_REQUEST_ID_CHARS
        {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?
            .as_millis();
        let now_ms = i64::try_from(now_ms).map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        let remaining_ms = self.deadline_ms.saturating_sub(now_ms);
        if remaining_ms <= 0 {
            return Err(EngineConnectorFailure::Timeout);
        }
        if remaining_ms > i64::from(MAX_TIMEOUT_MS) {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectorConfigurationRequest {
    pub context: ConnectorRequestContext,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub configuration: Value,
}

impl ConnectorConfigurationRequest {
    pub fn validate(&self) -> Result<(), EngineConnectorFailure> {
        self.context.validate()?;
        validate_configuration(&self.configuration)?;
        if self.base_url.len() > MAX_BASE_URL_CHARS
            || self.model.trim().is_empty()
            || self.model.chars().count() > MAX_MODEL_CHARS
            || !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&self.timeout_ms)
            || !(MIN_RESPONSE_BYTES..=MAX_RESPONSE_BYTES).contains(&self.max_response_bytes)
        {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectorGenerationRequest {
    pub configuration: ConnectorConfigurationRequest,
    pub messages: Vec<AiMessage>,
    pub source_text: String,
    pub source_locale: String,
    pub target_locale: String,
}

impl ConnectorGenerationRequest {
    pub fn validate(&self) -> Result<(), EngineConnectorFailure> {
        self.configuration.validate()?;
        if self.messages.is_empty() || self.messages.len() > MAX_CONNECTOR_MESSAGES {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        let mut total_bytes = 0usize;
        for message in &self.messages {
            let bytes = message.text.len();
            if bytes == 0 || bytes > MAX_CONNECTOR_MESSAGE_BYTES {
                return Err(EngineConnectorFailure::InvalidRequest);
            }
            total_bytes = total_bytes
                .checked_add(bytes)
                .ok_or(EngineConnectorFailure::InvalidRequest)?;
        }
        if total_bytes > MAX_CONNECTOR_MESSAGE_TOTAL_BYTES
            || self.source_text.len() > MAX_CONNECTOR_SOURCE_BYTES
            || !valid_locale(&self.source_locale)
            || !valid_locale(&self.target_locale)
        {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum EngineConnectorRequest {
    ValidateConfig {
        request: ConnectorConfigurationRequest,
    },
    Test {
        request: ConnectorGenerationRequest,
    },
    ModelsList {
        request: ConnectorConfigurationRequest,
    },
    Generate {
        request: ConnectorGenerationRequest,
    },
}

impl EngineConnectorRequest {
    pub fn operation(&self) -> EngineConnectorOperation {
        match self {
            Self::ValidateConfig { .. } => EngineConnectorOperation::ValidateConfig,
            Self::Test { .. } => EngineConnectorOperation::Test,
            Self::ModelsList { .. } => EngineConnectorOperation::ModelsList,
            Self::Generate { .. } => EngineConnectorOperation::Generate,
        }
    }

    pub fn request_id(&self) -> &str {
        match self {
            Self::ValidateConfig { request } | Self::ModelsList { request } => {
                &request.context.request_id
            }
            Self::Test { request } | Self::Generate { request } => {
                &request.configuration.context.request_id
            }
        }
    }

    pub fn validate(&self) -> Result<(), EngineConnectorFailure> {
        match self {
            Self::ValidateConfig { request } | Self::ModelsList { request } => request.validate(),
            Self::Test { request } | Self::Generate { request } => request.validate(),
        }
    }

    fn max_response_bytes(&self) -> Option<usize> {
        match self {
            Self::Test { request } | Self::Generate { request } => {
                Some(request.configuration.max_response_bytes as usize)
            }
            Self::ValidateConfig { .. } | Self::ModelsList { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorModel {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "event", rename_all = "camelCase", deny_unknown_fields)]
pub enum EngineConnectorEvent {
    TextDelta { text: String },
    Usage { usage: AiUsage },
    Completion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum EngineConnectorResult {
    ValidateConfig,
    Test { completion: ConnectorCompletion },
    ModelsList { models: Vec<EngineConnectorModel> },
    Generate { completion: ConnectorCompletion },
}

impl EngineConnectorResult {
    pub fn operation(&self) -> EngineConnectorOperation {
        match self {
            Self::ValidateConfig => EngineConnectorOperation::ValidateConfig,
            Self::Test { .. } => EngineConnectorOperation::Test,
            Self::ModelsList { .. } => EngineConnectorOperation::ModelsList,
            Self::Generate { .. } => EngineConnectorOperation::Generate,
        }
    }

    pub fn validate(&self) -> Result<(), EngineConnectorFailure> {
        match self {
            Self::ValidateConfig => Ok(()),
            Self::Test { completion } | Self::Generate { completion } => completion.validate(),
            Self::ModelsList { models } => {
                if models.len() > MAX_CONNECTOR_MODELS
                    || models.iter().any(|model| {
                        let id_chars = model.id.chars().count();
                        let name_chars = model.display_name.chars().count();
                        id_chars == 0
                            || id_chars > MAX_CONNECTOR_MODEL_ID_CHARS
                            || name_chars == 0
                            || name_chars > MAX_CONNECTOR_DISPLAY_NAME_CHARS
                    })
                {
                    return Err(EngineConnectorFailure::Protocol);
                }
                Ok(())
            }
        }
    }

    fn validate_response_limit(
        &self,
        max_response_bytes: usize,
    ) -> Result<(), EngineConnectorFailure> {
        match self {
            Self::Test { completion } | Self::Generate { completion }
                if completion.text.len() > max_response_bytes =>
            {
                Err(EngineConnectorFailure::ResponseTooLarge)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectorCompletion {
    pub text: String,
    pub usage: AiUsage,
    pub elapsed_ms: u64,
}

impl ConnectorCompletion {
    fn validate(&self) -> Result<(), EngineConnectorFailure> {
        if self.text.trim().is_empty() || !valid_usage(&self.usage) {
            return Err(EngineConnectorFailure::Protocol);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Error)]
#[serde(tag = "code", rename_all = "snake_case", deny_unknown_fields)]
pub enum EngineConnectorFailure {
    #[error("connector request is invalid")]
    InvalidRequest,
    #[error("connector operation is unsupported")]
    UnsupportedOperation,
    #[error("connector authentication failed")]
    Authentication,
    #[error("connector rate limit was reached")]
    RateLimited { retry_after_ms: Option<u64> },
    #[error("connector request timed out")]
    Timeout,
    #[error("connector is unavailable")]
    Unavailable { retryable: bool },
    #[error("connector protocol failed")]
    Protocol,
    #[error("connector response exceeded the configured limit")]
    ResponseTooLarge,
    #[error("connector request was canceled")]
    Canceled,
}

impl EngineConnectorFailure {
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::RateLimited { .. } | Self::Timeout | Self::Unavailable { retryable: true }
        )
    }
}

impl From<AiCoreError> for EngineConnectorFailure {
    fn from(error: AiCoreError) -> Self {
        match error {
            AiCoreError::InvalidProfile(_)
            | AiCoreError::InvalidEndpoint(_)
            | AiCoreError::InvalidGrounding(_) => Self::InvalidRequest,
            AiCoreError::InvalidCredential | AiCoreError::Authentication => Self::Authentication,
            AiCoreError::RateLimited { retry_after_ms } => Self::RateLimited { retry_after_ms },
            AiCoreError::Timeout => Self::Timeout,
            AiCoreError::Unavailable { retryable } => Self::Unavailable { retryable },
            AiCoreError::ResponseTooLarge => Self::ResponseTooLarge,
            AiCoreError::Canceled => Self::Canceled,
            AiCoreError::Protocol | AiCoreError::EventSink => Self::Protocol,
        }
    }
}

pub trait EngineConnectorEventSink {
    fn event(&mut self, event: &EngineConnectorEvent) -> Result<(), EngineConnectorFailure>;
}

pub trait EngineConnector: Send + Sync {
    fn invoke(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure>;

    fn cancel(&self, _request_id: &str) -> Result<(), EngineConnectorFailure> {
        Ok(())
    }

    fn shutdown(&self) -> Result<(), EngineConnectorFailure> {
        Ok(())
    }
}

pub struct ValidatingConnectorEventSink<'a> {
    inner: &'a mut dyn EngineConnectorEventSink,
    event_count: usize,
    text_bytes: usize,
    text: String,
    max_text_bytes: usize,
    usage: Option<AiUsage>,
    completed: bool,
}

impl<'a> ValidatingConnectorEventSink<'a> {
    pub fn new(inner: &'a mut dyn EngineConnectorEventSink) -> Self {
        Self::with_max_text_bytes(inner, MAX_RESPONSE_BYTES as usize)
    }

    pub fn with_max_text_bytes(
        inner: &'a mut dyn EngineConnectorEventSink,
        max_text_bytes: usize,
    ) -> Self {
        Self {
            inner,
            event_count: 0,
            text_bytes: 0,
            text: String::new(),
            max_text_bytes,
            usage: None,
            completed: false,
        }
    }

    pub fn is_completed(&self) -> bool {
        self.completed
    }

    pub fn event_count(&self) -> usize {
        self.event_count
    }

    fn finish(&mut self, result: &EngineConnectorResult) -> Result<(), EngineConnectorFailure> {
        let completion = match result {
            EngineConnectorResult::Test { completion }
            | EngineConnectorResult::Generate { completion } => completion,
            EngineConnectorResult::ValidateConfig | EngineConnectorResult::ModelsList { .. } => {
                return Err(EngineConnectorFailure::Protocol);
            }
        };
        if (!self.text.is_empty() && self.text != completion.text)
            || self
                .usage
                .as_ref()
                .is_some_and(|usage| usage != &completion.usage)
        {
            return Err(EngineConnectorFailure::Protocol);
        }
        self.inner.event(&EngineConnectorEvent::Completion)
    }
}

impl EngineConnectorEventSink for ValidatingConnectorEventSink<'_> {
    fn event(&mut self, event: &EngineConnectorEvent) -> Result<(), EngineConnectorFailure> {
        if self.completed || self.event_count >= MAX_CONNECTOR_EVENT_COUNT {
            return Err(EngineConnectorFailure::Protocol);
        }
        match event {
            EngineConnectorEvent::TextDelta { text } => {
                if self.usage.is_some()
                    || text.is_empty()
                    || text.len() > MAX_CONNECTOR_EVENT_DELTA_BYTES
                {
                    return Err(EngineConnectorFailure::Protocol);
                }
                self.text_bytes = self
                    .text_bytes
                    .checked_add(text.len())
                    .ok_or(EngineConnectorFailure::ResponseTooLarge)?;
                if self.text_bytes > self.max_text_bytes {
                    return Err(EngineConnectorFailure::ResponseTooLarge);
                }
                self.text.push_str(text);
            }
            EngineConnectorEvent::Usage { usage } => {
                if self.usage.is_some() || !valid_usage(usage) {
                    return Err(EngineConnectorFailure::Protocol);
                }
                self.usage = Some(usage.clone());
            }
            EngineConnectorEvent::Completion => self.completed = true,
        }
        self.event_count += 1;
        if matches!(event, EngineConnectorEvent::Completion) {
            Ok(())
        } else {
            self.inner.event(event)
        }
    }
}

#[derive(Clone)]
pub struct EngineConnectorRegistration {
    pub descriptor: EngineConnectorDescriptor,
    pub connector: Arc<dyn EngineConnector>,
}

#[derive(Clone)]
pub struct EngineConnectorLease {
    pub descriptor: Arc<EngineConnectorDescriptor>,
    connector: Arc<dyn EngineConnector>,
    pub generation: u64,
    active: Arc<AtomicBool>,
}

#[derive(Debug)]
pub struct EngineConnectorOwnerReplacement {
    pub detached: Vec<EngineConnectorLease>,
    pub attached: Vec<EngineConnectorLease>,
}

impl EngineConnectorLease {
    pub fn invoke(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        if !self.active.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Unavailable { retryable: false });
        }
        request.validate()?;
        let operation = request.operation();
        if !self.descriptor.operations.contains(&operation) {
            return Err(EngineConnectorFailure::UnsupportedOperation);
        }
        let mut validating_sink = ValidatingConnectorEventSink::with_max_text_bytes(
            sink,
            request.max_response_bytes().unwrap_or(0),
        );
        let result =
            match self
                .connector
                .invoke(request, credential, cancellation, &mut validating_sink)
            {
                Ok(result) => result,
                Err(_) if cancellation.load(Ordering::Acquire) => {
                    return Err(EngineConnectorFailure::Canceled);
                }
                Err(error) => return Err(error),
            };
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        if !self.active.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Unavailable { retryable: false });
        }
        result.validate()?;
        if let Some(max_response_bytes) = request.max_response_bytes() {
            result.validate_response_limit(max_response_bytes)?;
        }
        if result.operation() != operation {
            return Err(EngineConnectorFailure::Protocol);
        }
        let streams = matches!(
            operation,
            EngineConnectorOperation::Test | EngineConnectorOperation::Generate
        );
        if (streams && !validating_sink.is_completed())
            || (!streams && validating_sink.event_count() != 0)
        {
            return Err(EngineConnectorFailure::Protocol);
        }
        if streams {
            if cancellation.load(Ordering::Acquire) {
                return Err(EngineConnectorFailure::Canceled);
            }
            if !self.active.load(Ordering::Acquire) {
                return Err(EngineConnectorFailure::Unavailable { retryable: false });
            }
            validating_sink.finish(&result)?;
            if cancellation.load(Ordering::Acquire) {
                return Err(EngineConnectorFailure::Canceled);
            }
            if !self.active.load(Ordering::Acquire) {
                return Err(EngineConnectorFailure::Unavailable { retryable: false });
            }
        }
        Ok(result)
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), EngineConnectorFailure> {
        let chars = request_id.chars().count();
        if chars == 0 || chars > MAX_CONNECTOR_REQUEST_ID_CHARS {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        self.connector.cancel(request_id)
    }

    pub fn shutdown(&self) -> Result<(), EngineConnectorFailure> {
        self.connector.shutdown()
    }
}

impl std::fmt::Debug for EngineConnectorLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("EngineConnectorLease")
            .field("descriptor", &self.descriptor)
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ConnectorRegistryError {
    #[error("connector descriptor field {field} is invalid")]
    InvalidDescriptor { field: &'static str },
    #[error("connector contract version {version} is unsupported")]
    UnsupportedContractVersion { version: u32 },
    #[error("connector {connector_id} source identity does not match its catalog ID")]
    SourceIdentityMismatch { connector_id: String },
    #[error("connector catalog ID {connector_id} is already attached")]
    Collision { connector_id: String },
    #[error("previous plugin connector owner is not attached")]
    PreviousOwnerNotAttached,
    #[error("connector {connector_id} is not owned by the replacement candidate")]
    ReplacementOwnerMismatch { connector_id: String },
    #[error("connector registry generation was exhausted")]
    GenerationExhausted,
    #[error("connector registry lock is unavailable")]
    Unavailable,
}

#[derive(Default)]
struct RegistryState {
    next_generation: u64,
    entries: HashMap<String, EngineConnectorLease>,
}

#[derive(Default)]
pub struct EngineConnectorRegistry {
    state: RwLock<RegistryState>,
}

impl EngineConnectorRegistry {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn with_builtins() -> Result<Self, ConnectorRegistryError> {
        let registry = Self::empty();
        registry.attach_all(builtin_connector_registrations())?;
        Ok(registry)
    }

    pub fn preflight(
        &self,
        registrations: &[EngineConnectorRegistration],
    ) -> Result<(), ConnectorRegistryError> {
        let state = self
            .state
            .read()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        validate_registrations(&state, registrations)
    }

    pub fn attach_all(
        &self,
        registrations: Vec<EngineConnectorRegistration>,
    ) -> Result<Vec<EngineConnectorLease>, ConnectorRegistryError> {
        let mut state = self
            .state
            .write()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        validate_registrations(&state, &registrations)?;
        let count = u64::try_from(registrations.len())
            .map_err(|_| ConnectorRegistryError::GenerationExhausted)?;
        let final_generation = state
            .next_generation
            .checked_add(count)
            .ok_or(ConnectorRegistryError::GenerationExhausted)?;
        let mut attached = Vec::with_capacity(registrations.len());
        for registration in registrations {
            state.next_generation += 1;
            let id = registration.descriptor.id.clone();
            let lease = EngineConnectorLease {
                descriptor: Arc::new(registration.descriptor),
                connector: registration.connector,
                generation: state.next_generation,
                active: Arc::new(AtomicBool::new(true)),
            };
            state.entries.insert(id, lease.clone());
            attached.push(lease);
        }
        debug_assert_eq!(state.next_generation, final_generation);
        Ok(attached)
    }

    pub fn replace_plugin_owner(
        &self,
        previous_owner: &PluginConnectorOwner,
        candidate_owner: &PluginConnectorOwner,
        registrations: Vec<EngineConnectorRegistration>,
    ) -> Result<EngineConnectorOwnerReplacement, ConnectorRegistryError> {
        previous_owner.validate()?;
        candidate_owner.validate()?;
        let mut state = self
            .state
            .write()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        validate_replacement_registrations(
            &state,
            previous_owner,
            candidate_owner,
            &registrations,
        )?;

        let count = u64::try_from(registrations.len())
            .map_err(|_| ConnectorRegistryError::GenerationExhausted)?;
        let final_generation = state
            .next_generation
            .checked_add(count)
            .ok_or(ConnectorRegistryError::GenerationExhausted)?;

        let mut next_generation = state.next_generation;
        let attached = registrations
            .into_iter()
            .map(|registration| {
                next_generation += 1;
                EngineConnectorLease {
                    descriptor: Arc::new(registration.descriptor),
                    connector: registration.connector,
                    generation: next_generation,
                    active: Arc::new(AtomicBool::new(true)),
                }
            })
            .collect::<Vec<_>>();
        debug_assert_eq!(next_generation, final_generation);

        let mut detached_ids = state
            .entries
            .iter()
            .filter(|(_, lease)| lease.descriptor.source.plugin_owner() == Some(previous_owner))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        detached_ids.sort();
        let detached = detached_ids
            .into_iter()
            .filter_map(|id| state.entries.remove(&id))
            .collect::<Vec<_>>();
        for lease in &detached {
            lease.active.store(false, Ordering::Release);
        }
        for lease in &attached {
            state
                .entries
                .insert(lease.descriptor.id.clone(), lease.clone());
        }
        state.next_generation = final_generation;

        Ok(EngineConnectorOwnerReplacement { detached, attached })
    }

    pub fn lookup(
        &self,
        connector_id: &str,
    ) -> Result<Option<EngineConnectorLease>, ConnectorRegistryError> {
        let state = self
            .state
            .read()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        Ok(state.entries.get(connector_id).cloned())
    }

    pub fn lookup_source(
        &self,
        source: &EngineConnectorSource,
    ) -> Result<Option<EngineConnectorLease>, ConnectorRegistryError> {
        source.validate()?;
        Ok(self
            .lookup(source.connector_id())?
            .filter(|lease| lease.descriptor.source == *source))
    }

    pub fn is_current(&self, lease: &EngineConnectorLease) -> Result<bool, ConnectorRegistryError> {
        Ok(self.lookup(&lease.descriptor.id)?.is_some_and(|current| {
            current.active.load(Ordering::Acquire)
                && lease.active.load(Ordering::Acquire)
                && current.generation == lease.generation
                && current.descriptor.source == lease.descriptor.source
        }))
    }

    pub fn snapshot(&self) -> Result<Vec<EngineConnectorLease>, ConnectorRegistryError> {
        let state = self
            .state
            .read()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        let mut entries = state.entries.values().cloned().collect::<Vec<_>>();
        entries.sort_by(|left, right| left.descriptor.id.cmp(&right.descriptor.id));
        Ok(entries)
    }

    pub fn detach_plugin_owner(
        &self,
        owner: &PluginConnectorOwner,
    ) -> Result<Vec<EngineConnectorLease>, ConnectorRegistryError> {
        owner.validate()?;
        let mut state = self
            .state
            .write()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        let mut ids = state
            .entries
            .iter()
            .filter(|(_, lease)| lease.descriptor.source.plugin_owner() == Some(owner))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        let detached = ids
            .into_iter()
            .filter_map(|id| state.entries.remove(&id))
            .collect::<Vec<_>>();
        for lease in &detached {
            lease.active.store(false, Ordering::Release);
        }
        Ok(detached)
    }

    pub fn detach_source(
        &self,
        source: &EngineConnectorSource,
    ) -> Result<Option<EngineConnectorLease>, ConnectorRegistryError> {
        source.validate()?;
        if source.plugin_owner().is_none() {
            return Ok(None);
        }
        let mut state = self
            .state
            .write()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        let id = source.connector_id();
        if state
            .entries
            .get(id)
            .is_some_and(|lease| lease.descriptor.source == *source)
        {
            let detached = state.entries.remove(id);
            if let Some(lease) = &detached {
                lease.active.store(false, Ordering::Release);
            }
            Ok(detached)
        } else {
            Ok(None)
        }
    }

    pub fn detach_lease(
        &self,
        lease: &EngineConnectorLease,
    ) -> Result<Option<EngineConnectorLease>, ConnectorRegistryError> {
        let mut state = self
            .state
            .write()
            .map_err(|_| ConnectorRegistryError::Unavailable)?;
        let id = &lease.descriptor.id;
        let is_current = state.entries.get(id).is_some_and(|current| {
            current.generation == lease.generation
                && current.descriptor.source == lease.descriptor.source
                && current.active.load(Ordering::Acquire)
                && lease.active.load(Ordering::Acquire)
        });
        if !is_current {
            return Ok(None);
        }
        let detached = state.entries.remove(id);
        if let Some(detached) = &detached {
            detached.active.store(false, Ordering::Release);
        }
        Ok(detached)
    }
}

fn validate_registrations(
    state: &RegistryState,
    registrations: &[EngineConnectorRegistration],
) -> Result<(), ConnectorRegistryError> {
    let mut candidate_ids = BTreeSet::new();
    for registration in registrations {
        registration.descriptor.validate()?;
        let id = &registration.descriptor.id;
        if state.entries.contains_key(id) || !candidate_ids.insert(id.clone()) {
            return Err(ConnectorRegistryError::Collision {
                connector_id: id.clone(),
            });
        }
    }
    Ok(())
}

fn validate_replacement_registrations(
    state: &RegistryState,
    previous_owner: &PluginConnectorOwner,
    candidate_owner: &PluginConnectorOwner,
    registrations: &[EngineConnectorRegistration],
) -> Result<(), ConnectorRegistryError> {
    if !state
        .entries
        .values()
        .any(|lease| lease.descriptor.source.plugin_owner() == Some(previous_owner))
    {
        return Err(ConnectorRegistryError::PreviousOwnerNotAttached);
    }
    let mut candidate_ids = BTreeSet::new();
    for registration in registrations {
        registration.descriptor.validate()?;
        let id = &registration.descriptor.id;
        if registration.descriptor.source.plugin_owner() != Some(candidate_owner) {
            return Err(ConnectorRegistryError::ReplacementOwnerMismatch {
                connector_id: id.clone(),
            });
        }
        if !candidate_ids.insert(id.clone())
            || state
                .entries
                .get(id)
                .is_some_and(|lease| lease.descriptor.source.plugin_owner() != Some(previous_owner))
        {
            return Err(ConnectorRegistryError::Collision {
                connector_id: id.clone(),
            });
        }
    }
    Ok(())
}

fn builtin_connector_registrations() -> Vec<EngineConnectorRegistration> {
    provider_catalog()
        .into_iter()
        .map(|provider| {
            let kind = provider.kind;
            EngineConnectorRegistration {
                descriptor: EngineConnectorDescriptor {
                    id: builtin_provider_id(kind).to_string(),
                    display_name: provider.display_name,
                    source: EngineConnectorSource::Builtin { provider: kind },
                    config_schema_version: 1,
                    operations: vec![
                        EngineConnectorOperation::ValidateConfig,
                        EngineConnectorOperation::Test,
                        EngineConnectorOperation::Generate,
                    ],
                    protocol: Some(provider.protocol),
                    default_base_url: provider.default_base_url,
                    default_model: provider.default_model,
                    supports_streaming: provider.supports_streaming,
                    reports_usage: provider.reports_usage,
                    credential_hint: provider.credential_hint,
                },
                connector: Arc::new(BuiltinEngineConnector { kind }),
            }
        })
        .collect()
}

struct BuiltinEngineConnector {
    kind: AiProviderKind,
}

impl EngineConnector for BuiltinEngineConnector {
    fn invoke(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        request.validate()?;
        let operation = request.operation();
        match request {
            EngineConnectorRequest::ValidateConfig { request } => {
                validate_profile_fields(
                    "Connector profile",
                    self.kind,
                    &request.base_url,
                    &request.model,
                    request.timeout_ms,
                    request.max_response_bytes,
                )?;
                Ok(EngineConnectorResult::ValidateConfig)
            }
            EngineConnectorRequest::ModelsList { .. } => {
                Err(EngineConnectorFailure::UnsupportedOperation)
            }
            EngineConnectorRequest::Test { request }
            | EngineConnectorRequest::Generate { request } => {
                let credential = credential.ok_or(EngineConnectorFailure::Authentication)?;
                let profile = builtin_profile(self.kind, request);
                let provider_request = ProviderRequest {
                    profile,
                    messages: request.messages.clone(),
                    source_text: request.source_text.clone(),
                    source_locale: request.source_locale.clone(),
                    target_locale: request.target_locale.clone(),
                };
                let completion = {
                    let mut adapter = BuiltinEventSink { sink };
                    execute_provider(&provider_request, credential, cancellation, &mut adapter)?
                };
                sink.event(&EngineConnectorEvent::Usage {
                    usage: completion.usage.clone(),
                })?;
                sink.event(&EngineConnectorEvent::Completion)?;
                let completion = ConnectorCompletion {
                    text: completion.text,
                    usage: completion.usage,
                    elapsed_ms: completion.elapsed_ms,
                };
                if operation == EngineConnectorOperation::Test {
                    Ok(EngineConnectorResult::Test { completion })
                } else {
                    Ok(EngineConnectorResult::Generate { completion })
                }
            }
        }
    }
}

struct BuiltinEventSink<'a> {
    sink: &'a mut dyn EngineConnectorEventSink,
}

impl AiEventSink for BuiltinEventSink<'_> {
    fn delta(&mut self, text: &str) -> Result<(), AiCoreError> {
        self.sink
            .event(&EngineConnectorEvent::TextDelta {
                text: text.to_string(),
            })
            .map_err(|error| match error {
                EngineConnectorFailure::ResponseTooLarge => AiCoreError::ResponseTooLarge,
                _ => AiCoreError::EventSink,
            })
    }
}

fn builtin_profile(
    kind: AiProviderKind,
    request: &ConnectorGenerationRequest,
) -> AiProviderProfile {
    AiProviderProfile {
        id: request.configuration.context.request_id.clone(),
        name: "Connector profile".to_string(),
        kind,
        base_url: request.configuration.base_url.clone(),
        model: request.configuration.model.clone(),
        timeout_ms: request.configuration.timeout_ms,
        max_response_bytes: request.configuration.max_response_bytes,
        enabled: true,
        credential_present: true,
        revision: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    }
}

fn builtin_provider_id(kind: AiProviderKind) -> &'static str {
    match kind {
        AiProviderKind::Openai => "openai",
        AiProviderKind::Anthropic => "anthropic",
        AiProviderKind::Gemini => "gemini",
        AiProviderKind::Deepl => "deepl",
        AiProviderKind::Deepseek => "deepseek",
        AiProviderKind::Qwen => "qwen",
        AiProviderKind::Glm => "glm",
        AiProviderKind::Kimi => "kimi",
        AiProviderKind::Volcengine => "volcengine",
        AiProviderKind::OpenaiCompatible => "openaiCompatible",
    }
}

fn validate_identifier(field: &'static str, value: &str) -> Result<(), ConnectorRegistryError> {
    let chars = value.chars().count();
    if chars == 0
        || chars > MAX_CONNECTOR_ID_CHARS
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(ConnectorRegistryError::InvalidDescriptor { field });
    }
    Ok(())
}

fn validate_version_identifier(
    field: &'static str,
    value: &str,
) -> Result<(), ConnectorRegistryError> {
    let chars = value.chars().count();
    if chars == 0
        || chars > MAX_CONNECTOR_VERSION_ID_CHARS
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err(ConnectorRegistryError::InvalidDescriptor { field });
    }
    Ok(())
}

fn valid_locale(locale: &str) -> bool {
    let chars = locale.chars().count();
    chars > 0 && chars <= MAX_CONNECTOR_LOCALE_CHARS
}

fn validate_configuration(configuration: &Value) -> Result<(), EngineConnectorFailure> {
    let serialized =
        serde_json::to_vec(configuration).map_err(|_| EngineConnectorFailure::InvalidRequest)?;
    if serialized.len() > MAX_CONNECTOR_CONFIG_BYTES {
        return Err(EngineConnectorFailure::InvalidRequest);
    }
    let mut remaining = MAX_CONNECTOR_CONFIG_NODES;
    validate_configuration_node(configuration, 0, &mut remaining)
}

fn validate_configuration_node(
    value: &Value,
    depth: usize,
    remaining: &mut usize,
) -> Result<(), EngineConnectorFailure> {
    if depth > MAX_CONNECTOR_CONFIG_DEPTH || *remaining == 0 {
        return Err(EngineConnectorFailure::InvalidRequest);
    }
    *remaining -= 1;
    match value {
        Value::Array(items) => {
            for item in items {
                validate_configuration_node(item, depth + 1, remaining)?;
            }
        }
        Value::Object(fields) => {
            for (key, item) in fields {
                if key.len() > MAX_CONNECTOR_ID_CHARS {
                    return Err(EngineConnectorFailure::InvalidRequest);
                }
                validate_configuration_node(item, depth + 1, remaining)?;
            }
        }
        Value::String(value) if value.len() > MAX_CONNECTOR_CONFIG_BYTES => {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
    Ok(())
}

fn valid_usage(usage: &AiUsage) -> bool {
    [
        usage.input_tokens,
        usage.cache_read_tokens,
        usage.reasoning_tokens,
        usage.output_tokens,
        usage.cache_write_tokens,
    ]
    .into_iter()
    .flatten()
    .all(|value| value <= MAX_CONNECTOR_USAGE_VALUE)
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    use serde_json::json;

    use super::*;

    #[derive(Default)]
    struct CollectEventSink(Vec<EngineConnectorEvent>);

    impl EngineConnectorEventSink for CollectEventSink {
        fn event(&mut self, event: &EngineConnectorEvent) -> Result<(), EngineConnectorFailure> {
            self.0.push(event.clone());
            Ok(())
        }
    }

    struct FixtureConnector;

    impl EngineConnector for FixtureConnector {
        fn invoke(
            &self,
            request: &EngineConnectorRequest,
            _credential: Option<&SecretString>,
            _cancellation: &AtomicBool,
            sink: &mut dyn EngineConnectorEventSink,
        ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
            match request {
                EngineConnectorRequest::ValidateConfig { .. } => {
                    Ok(EngineConnectorResult::ValidateConfig)
                }
                EngineConnectorRequest::ModelsList { .. } => {
                    Ok(EngineConnectorResult::ModelsList {
                        models: vec![EngineConnectorModel {
                            id: "fixture-model".to_string(),
                            display_name: "Fixture model".to_string(),
                        }],
                    })
                }
                EngineConnectorRequest::Test { .. } | EngineConnectorRequest::Generate { .. } => {
                    sink.event(&EngineConnectorEvent::TextDelta {
                        text: "fixture".to_string(),
                    })?;
                    sink.event(&EngineConnectorEvent::Usage {
                        usage: AiUsage {
                            output_tokens: Some(1),
                            ..AiUsage::default()
                        },
                    })?;
                    sink.event(&EngineConnectorEvent::Completion)?;
                    let completion = ConnectorCompletion {
                        text: "fixture".to_string(),
                        usage: AiUsage {
                            output_tokens: Some(1),
                            ..AiUsage::default()
                        },
                        elapsed_ms: 1,
                    };
                    if request.operation() == EngineConnectorOperation::Test {
                        Ok(EngineConnectorResult::Test { completion })
                    } else {
                        Ok(EngineConnectorResult::Generate { completion })
                    }
                }
            }
        }
    }

    fn plugin_source(
        plugin_id: &str,
        version_id: &str,
        contribution_id: &str,
    ) -> EngineConnectorSource {
        EngineConnectorSource::Plugin {
            owner: PluginConnectorOwner {
                plugin_id: plugin_id.to_string(),
                version_id: version_id.to_string(),
            },
            contribution_id: contribution_id.to_string(),
            contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
        }
    }

    fn plugin_owner(plugin_id: &str, version_id: &str) -> PluginConnectorOwner {
        PluginConnectorOwner {
            plugin_id: plugin_id.to_string(),
            version_id: version_id.to_string(),
        }
    }

    fn plugin_registration(
        plugin_id: &str,
        version_id: &str,
        contribution_id: &str,
    ) -> EngineConnectorRegistration {
        EngineConnectorRegistration {
            descriptor: EngineConnectorDescriptor {
                id: contribution_id.to_string(),
                display_name: format!("{contribution_id} display"),
                source: plugin_source(plugin_id, version_id, contribution_id),
                config_schema_version: 1,
                operations: vec![
                    EngineConnectorOperation::ValidateConfig,
                    EngineConnectorOperation::Test,
                    EngineConnectorOperation::ModelsList,
                    EngineConnectorOperation::Generate,
                ],
                protocol: None,
                default_base_url: String::new(),
                default_model: "fixture-model".to_string(),
                supports_streaming: true,
                reports_usage: true,
                credential_hint: "Fixture credential".to_string(),
            },
            connector: Arc::new(FixtureConnector),
        }
    }

    fn configuration_request() -> ConnectorConfigurationRequest {
        ConnectorConfigurationRequest {
            context: ConnectorRequestContext {
                contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
                request_id: "request-1".to_string(),
                deadline_ms: i64::try_from(
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .expect("system time")
                        .as_millis(),
                )
                .expect("deadline epoch")
                    + 5_000,
            },
            base_url: "http://127.0.0.1:11434/v1".to_string(),
            model: "fixture-model".to_string(),
            timeout_ms: 5_000,
            max_response_bytes: 1_048_576,
            configuration: json!({}),
        }
    }

    fn generation_request(base_url: String) -> ConnectorGenerationRequest {
        let mut configuration = configuration_request();
        configuration.base_url = base_url;
        ConnectorGenerationRequest {
            configuration,
            messages: vec![AiMessage {
                role: crate::AiMessageRole::User,
                text: "Hello".to_string(),
            }],
            source_text: "Hello".to_string(),
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
        }
    }

    #[test]
    fn plugin_owner_accepts_storage_inventory_version_identity() {
        let owner = plugin_owner(
            "example.connector-openai-compatible",
            "inventory-v2:example.connector-openai-compatible:1.0.0",
        );
        owner.validate().expect("inventory version identity");

        let invalid = plugin_owner("example.connector", "inventory-v2/example.connector/1.0.0");
        assert!(matches!(
            invalid.validate(),
            Err(ConnectorRegistryError::InvalidDescriptor { field: "versionId" })
        ));
    }

    #[test]
    fn builtin_registry_preserves_legacy_catalog_identity_and_metadata() {
        let registry = EngineConnectorRegistry::with_builtins().expect("builtin registry");
        let snapshot = registry.snapshot().expect("registry snapshot");
        let legacy = provider_catalog();
        assert_eq!(snapshot.len(), legacy.len());
        for provider in legacy {
            let id = builtin_provider_id(provider.kind);
            let entry = registry
                .lookup(id)
                .expect("registry lookup")
                .expect("builtin connector");
            assert_eq!(
                entry.descriptor.source,
                EngineConnectorSource::Builtin {
                    provider: provider.kind
                }
            );
            assert_eq!(entry.descriptor.display_name, provider.display_name);
            assert_eq!(entry.descriptor.protocol, Some(provider.protocol));
            assert_eq!(entry.descriptor.default_base_url, provider.default_base_url);
            assert_eq!(entry.descriptor.default_model, provider.default_model);
            assert_eq!(
                entry.descriptor.supports_streaming,
                provider.supports_streaming
            );
            assert_eq!(entry.descriptor.reports_usage, provider.reports_usage);
            assert_eq!(entry.descriptor.credential_hint, provider.credential_hint);
        }
        assert_eq!(
            serde_json::to_value(EngineConnectorSource::Builtin {
                provider: AiProviderKind::Openai
            })
            .expect("serialize builtin source"),
            json!({ "kind": "builtin", "provider": "openai" })
        );
        assert!(
            serde_json::from_value::<EngineConnectorSource>(json!({
                "kind": "builtin",
                "provider": "openai",
                "unexpected": true
            }))
            .is_err()
        );
        assert_eq!(
            serde_json::to_value(EngineConnectorOperation::ModelsList)
                .expect("serialize model list operation"),
            json!("models.list")
        );
    }

    #[test]
    fn plugin_collision_preflight_is_atomic_and_protects_builtins() {
        let registry = EngineConnectorRegistry::with_builtins().expect("builtin registry");
        let before = registry.snapshot().expect("before snapshot").len();
        let registrations = vec![
            plugin_registration("org.example.one", "version-1", "fixture-one"),
            plugin_registration("org.example.two", "version-1", "fixture-one"),
        ];
        assert!(matches!(
            registry.attach_all(registrations),
            Err(ConnectorRegistryError::Collision { connector_id })
                if connector_id == "fixture-one"
        ));
        assert_eq!(registry.snapshot().expect("after snapshot").len(), before);
        assert!(registry.lookup("fixture-one").expect("lookup").is_none());

        assert!(matches!(
            registry.preflight(&[plugin_registration(
                "org.example.plugin",
                "version-1",
                "openai"
            )]),
            Err(ConnectorRegistryError::Collision { connector_id }) if connector_id == "openai"
        ));
    }

    #[test]
    fn exact_owner_detach_and_generation_checks_ignore_unrelated_plugins() {
        let registry = EngineConnectorRegistry::with_builtins().expect("builtin registry");
        let old = registry
            .attach_all(vec![
                plugin_registration("org.example.one", "version-1", "fixture-one"),
                plugin_registration("org.example.one", "version-1", "fixture-two"),
                plugin_registration("org.example.two", "version-1", "fixture-three"),
            ])
            .expect("attach plugins")
            .remove(0);
        assert!(registry.is_current(&old).expect("old current"));

        let detached = registry
            .detach_plugin_owner(&PluginConnectorOwner {
                plugin_id: "org.example.one".to_string(),
                version_id: "version-1".to_string(),
            })
            .expect("detach exact owner");
        assert_eq!(detached.len(), 2);
        assert!(registry.lookup("fixture-one").expect("lookup").is_none());
        assert!(registry.lookup("fixture-two").expect("lookup").is_none());
        assert!(registry.lookup("fixture-three").expect("lookup").is_some());
        assert!(registry.lookup("openai").expect("lookup").is_some());
        assert!(!registry.is_current(&old).expect("old stale"));

        let replacement = registry
            .attach_all(vec![plugin_registration(
                "org.example.one",
                "version-2",
                "fixture-one",
            )])
            .expect("attach replacement")
            .remove(0);
        assert!(replacement.generation > old.generation);
        assert!(
            registry
                .is_current(&replacement)
                .expect("replacement current")
        );
        assert!(
            registry
                .lookup_source(&old.descriptor.source)
                .expect("old source lookup")
                .is_none()
        );
    }

    #[test]
    fn stale_lease_detach_preserves_same_version_replacement() {
        let registry = EngineConnectorRegistry::empty();
        let old = registry
            .attach_all(vec![plugin_registration(
                "org.example.plugin",
                "version-1",
                "fixture",
            )])
            .expect("attach old generation")
            .remove(0);
        registry
            .detach_plugin_owner(old.descriptor.source.plugin_owner().expect("plugin owner"))
            .expect("detach old owner");
        let replacement = registry
            .attach_all(vec![plugin_registration(
                "org.example.plugin",
                "version-1",
                "fixture",
            )])
            .expect("attach same-version replacement")
            .remove(0);

        assert!(
            registry
                .detach_lease(&old)
                .expect("ignore stale lease")
                .is_none()
        );
        assert!(
            registry
                .is_current(&replacement)
                .expect("replacement current")
        );
        assert!(
            registry
                .detach_lease(&replacement)
                .expect("detach current lease")
                .is_some()
        );
    }

    #[test]
    fn owner_replacement_atomically_swaps_complete_inventory_and_returns_leases() {
        let registry = EngineConnectorRegistry::with_builtins().expect("builtin registry");
        let previous_owner = plugin_owner("org.example.one", "version-1");
        let candidate_owner = plugin_owner("org.example.one", "version-2");
        let old = registry
            .attach_all(vec![
                plugin_registration("org.example.one", "version-1", "fixture-one"),
                plugin_registration("org.example.one", "version-1", "fixture-removed"),
                plugin_registration("org.example.other", "version-1", "fixture-other"),
            ])
            .expect("attach old inventory");
        let other = old[2].clone();
        let builtin = registry
            .lookup("openai")
            .expect("lookup builtin")
            .expect("builtin lease");

        let replaced = registry
            .replace_plugin_owner(
                &previous_owner,
                &candidate_owner,
                vec![
                    plugin_registration("org.example.one", "version-2", "fixture-one"),
                    plugin_registration("org.example.one", "version-2", "fixture-added"),
                ],
            )
            .expect("replace owner");

        assert_eq!(
            replaced
                .detached
                .iter()
                .map(|lease| lease.descriptor.id.as_str())
                .collect::<Vec<_>>(),
            ["fixture-one", "fixture-removed"]
        );
        assert_eq!(
            replaced
                .attached
                .iter()
                .map(|lease| lease.descriptor.id.as_str())
                .collect::<Vec<_>>(),
            ["fixture-one", "fixture-added"]
        );
        assert!(
            registry
                .lookup("fixture-removed")
                .expect("lookup")
                .is_none()
        );
        for lease in &replaced.attached {
            assert_eq!(
                lease.descriptor.source.plugin_owner(),
                Some(&candidate_owner)
            );
            assert!(registry.is_current(lease).expect("candidate current"));
        }
        assert!(registry.is_current(&other).expect("other current"));
        assert!(registry.is_current(&builtin).expect("builtin current"));
        assert!(
            old[..2]
                .iter()
                .all(|lease| !registry.is_current(lease).expect("old stale"))
        );
    }

    #[test]
    fn failed_owner_replacement_preserves_previous_inventory_and_generation() {
        let registry = EngineConnectorRegistry::empty();
        let previous_owner = plugin_owner("org.example.plugin", "version-1");
        let candidate_owner = plugin_owner("org.example.plugin", "version-2");
        let old = registry
            .attach_all(vec![
                plugin_registration("org.example.plugin", "version-1", "fixture-one"),
                plugin_registration("org.example.plugin", "version-1", "fixture-two"),
            ])
            .expect("attach previous inventory");
        let before_generation = old[1].generation;
        let mut invalid = plugin_registration("org.example.plugin", "version-2", "fixture-two");
        invalid.descriptor.config_schema_version = 0;

        assert!(matches!(
            registry.replace_plugin_owner(
                &previous_owner,
                &candidate_owner,
                vec![
                    plugin_registration("org.example.plugin", "version-2", "fixture-one"),
                    invalid,
                ],
            ),
            Err(ConnectorRegistryError::InvalidDescriptor {
                field: "configSchemaVersion"
            })
        ));
        for lease in &old {
            let current = registry
                .lookup(&lease.descriptor.id)
                .expect("lookup")
                .expect("previous lease preserved");
            assert_eq!(current.generation, lease.generation);
            assert!(Arc::ptr_eq(&current.descriptor, &lease.descriptor));
            assert!(Arc::ptr_eq(&current.connector, &lease.connector));
        }

        let attached = registry
            .attach_all(vec![plugin_registration(
                "org.example.other",
                "version-1",
                "fixture-three",
            )])
            .expect("generation remains usable");
        assert_eq!(attached[0].generation, before_generation + 1);
    }

    #[test]
    fn generation_exhaustion_is_checked_before_previous_owner_is_removed() {
        let registry = EngineConnectorRegistry::empty();
        let previous_owner = plugin_owner("org.example.plugin", "version-1");
        let candidate_owner = plugin_owner("org.example.plugin", "version-2");
        let old = registry
            .attach_all(vec![plugin_registration(
                "org.example.plugin",
                "version-1",
                "fixture",
            )])
            .expect("attach previous")
            .remove(0);
        registry
            .state
            .write()
            .expect("registry state")
            .next_generation = u64::MAX;

        assert!(matches!(
            registry.replace_plugin_owner(
                &previous_owner,
                &candidate_owner,
                vec![plugin_registration(
                    "org.example.plugin",
                    "version-2",
                    "fixture",
                )],
            ),
            Err(ConnectorRegistryError::GenerationExhausted)
        ));
        assert!(registry.is_current(&old).expect("previous remains current"));
    }

    #[test]
    fn owner_replacement_rejects_builtin_cross_plugin_and_mixed_owner_candidates() {
        let registry = EngineConnectorRegistry::with_builtins().expect("builtin registry");
        let previous_owner = plugin_owner("org.example.one", "version-1");
        let candidate_owner = plugin_owner("org.example.one", "version-2");
        let old = registry
            .attach_all(vec![
                plugin_registration("org.example.one", "version-1", "fixture-one"),
                plugin_registration("org.example.other", "version-1", "fixture-other"),
            ])
            .expect("attach plugins");

        for collision_id in ["openai", "fixture-other"] {
            assert!(matches!(
                registry.replace_plugin_owner(
                    &previous_owner,
                    &candidate_owner,
                    vec![plugin_registration(
                        "org.example.one",
                        "version-2",
                        collision_id,
                    )],
                ),
                Err(ConnectorRegistryError::Collision { connector_id })
                    if connector_id == collision_id
            ));
        }
        assert!(matches!(
            registry.replace_plugin_owner(
                &previous_owner,
                &candidate_owner,
                vec![plugin_registration(
                    "org.example.wrong",
                    "version-2",
                    "fixture-one",
                )],
            ),
            Err(ConnectorRegistryError::ReplacementOwnerMismatch { connector_id })
                if connector_id == "fixture-one"
        ));
        assert!(
            old.iter()
                .all(|lease| registry.is_current(lease).expect("original current"))
        );
    }

    #[test]
    fn concurrent_owner_replacements_publish_only_one_complete_candidate() {
        let registry = Arc::new(EngineConnectorRegistry::empty());
        let previous_owner = plugin_owner("org.example.plugin", "version-1");
        registry
            .attach_all(vec![
                plugin_registration("org.example.plugin", "version-1", "fixture-one"),
                plugin_registration("org.example.plugin", "version-1", "fixture-two"),
            ])
            .expect("attach previous");
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut workers = Vec::new();
        for version_id in ["version-2", "version-3"] {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            let previous_owner = previous_owner.clone();
            workers.push(std::thread::spawn(move || {
                let candidate_owner = plugin_owner("org.example.plugin", version_id);
                barrier.wait();
                registry.replace_plugin_owner(
                    &previous_owner,
                    &candidate_owner,
                    vec![
                        plugin_registration("org.example.plugin", version_id, "fixture-one"),
                        plugin_registration("org.example.plugin", version_id, "fixture-two"),
                    ],
                )
            }));
        }
        barrier.wait();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().expect("replacement worker"))
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);

        let first = registry
            .lookup("fixture-one")
            .expect("lookup first")
            .expect("first candidate connector");
        let second = registry
            .lookup("fixture-two")
            .expect("lookup second")
            .expect("second candidate connector");
        assert_eq!(
            first.descriptor.source.plugin_owner(),
            second.descriptor.source.plugin_owner()
        );
        assert_ne!(
            first.descriptor.source.plugin_owner(),
            Some(&previous_owner)
        );
    }

    #[test]
    fn lease_validates_event_order_completion_and_result_operation() {
        let registry = EngineConnectorRegistry::empty();
        let lease = registry
            .attach_all(vec![plugin_registration(
                "org.example.plugin",
                "version-1",
                "fixture",
            )])
            .expect("attach fixture")
            .remove(0);
        let request = EngineConnectorRequest::Generate {
            request: generation_request("http://127.0.0.1:11434/v1".to_string()),
        };
        let mut sink = CollectEventSink::default();
        let result = lease
            .invoke(&request, None, &AtomicBool::new(false), &mut sink)
            .expect("invoke fixture");
        assert!(matches!(result, EngineConnectorResult::Generate { .. }));
        assert_eq!(
            sink.0,
            vec![
                EngineConnectorEvent::TextDelta {
                    text: "fixture".to_string()
                },
                EngineConnectorEvent::Usage {
                    usage: AiUsage {
                        output_tokens: Some(1),
                        ..AiUsage::default()
                    }
                },
                EngineConnectorEvent::Completion,
            ]
        );

        let mut sink = CollectEventSink::default();
        let mut validating = ValidatingConnectorEventSink::new(&mut sink);
        validating
            .event(&EngineConnectorEvent::Usage {
                usage: AiUsage::default(),
            })
            .expect("usage");
        assert!(matches!(
            validating.event(&EngineConnectorEvent::TextDelta {
                text: "late".to_string()
            }),
            Err(EngineConnectorFailure::Protocol)
        ));

        let mut sink = CollectEventSink::default();
        let mut validating = ValidatingConnectorEventSink::with_max_text_bytes(&mut sink, 4);
        assert!(matches!(
            validating.event(&EngineConnectorEvent::TextDelta {
                text: "12345".to_string()
            }),
            Err(EngineConnectorFailure::ResponseTooLarge)
        ));
        validating
            .event(&EngineConnectorEvent::Completion)
            .expect("completion");
        assert!(matches!(
            validating.event(&EngineConnectorEvent::Completion),
            Err(EngineConnectorFailure::Protocol)
        ));
    }

    #[test]
    fn lease_rejects_stale_invocation_and_cancellation_wins_terminal_result() {
        struct CancelingConnector;

        impl EngineConnector for CancelingConnector {
            fn invoke(
                &self,
                _request: &EngineConnectorRequest,
                _credential: Option<&SecretString>,
                cancellation: &AtomicBool,
                sink: &mut dyn EngineConnectorEventSink,
            ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
                sink.event(&EngineConnectorEvent::TextDelta {
                    text: "fixture".to_string(),
                })?;
                sink.event(&EngineConnectorEvent::Usage {
                    usage: AiUsage {
                        output_tokens: Some(1),
                        ..AiUsage::default()
                    },
                })?;
                sink.event(&EngineConnectorEvent::Completion)?;
                cancellation.store(true, Ordering::Release);
                Ok(EngineConnectorResult::Generate {
                    completion: ConnectorCompletion {
                        text: "fixture".to_string(),
                        usage: AiUsage {
                            output_tokens: Some(1),
                            ..AiUsage::default()
                        },
                        elapsed_ms: 1,
                    },
                })
            }
        }

        let registry = EngineConnectorRegistry::empty();
        let mut registration = plugin_registration("org.example.plugin", "version-1", "fixture");
        registration.connector = Arc::new(CancelingConnector);
        let lease = registry
            .attach_all(vec![registration])
            .expect("attach connector")
            .remove(0);
        let request = EngineConnectorRequest::Generate {
            request: generation_request("http://127.0.0.1:11434/v1".to_string()),
        };
        let cancellation = AtomicBool::new(false);
        let mut sink = CollectEventSink::default();
        assert!(matches!(
            lease.invoke(&request, None, &cancellation, &mut sink),
            Err(EngineConnectorFailure::Canceled)
        ));
        assert!(!sink.0.contains(&EngineConnectorEvent::Completion));

        registry
            .detach_source(&lease.descriptor.source)
            .expect("detach exact source")
            .expect("detached lease");
        cancellation.store(false, Ordering::Release);
        let mut sink = CollectEventSink::default();
        assert!(matches!(
            lease.invoke(&request, None, &cancellation, &mut sink),
            Err(EngineConnectorFailure::Unavailable { retryable: false })
        ));
        assert!(sink.0.is_empty());
    }

    #[test]
    fn lease_reconciles_stream_and_terminal_before_publishing_completion() {
        struct MismatchedConnector;

        impl EngineConnector for MismatchedConnector {
            fn invoke(
                &self,
                _request: &EngineConnectorRequest,
                _credential: Option<&SecretString>,
                _cancellation: &AtomicBool,
                sink: &mut dyn EngineConnectorEventSink,
            ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
                sink.event(&EngineConnectorEvent::TextDelta {
                    text: "streamed".to_string(),
                })?;
                sink.event(&EngineConnectorEvent::Usage {
                    usage: AiUsage {
                        output_tokens: Some(1),
                        ..AiUsage::default()
                    },
                })?;
                sink.event(&EngineConnectorEvent::Completion)?;
                Ok(EngineConnectorResult::Generate {
                    completion: ConnectorCompletion {
                        text: "terminal".to_string(),
                        usage: AiUsage {
                            output_tokens: Some(2),
                            ..AiUsage::default()
                        },
                        elapsed_ms: 1,
                    },
                })
            }
        }

        let registry = EngineConnectorRegistry::empty();
        let mut registration = plugin_registration("org.example.plugin", "version-1", "fixture");
        registration.connector = Arc::new(MismatchedConnector);
        let lease = registry
            .attach_all(vec![registration])
            .expect("attach connector")
            .remove(0);
        let request = EngineConnectorRequest::Generate {
            request: generation_request("http://127.0.0.1:11434/v1".to_string()),
        };
        let mut sink = CollectEventSink::default();
        assert!(matches!(
            lease.invoke(&request, None, &AtomicBool::new(false), &mut sink),
            Err(EngineConnectorFailure::Protocol)
        ));
        assert_eq!(
            sink.0,
            vec![
                EngineConnectorEvent::TextDelta {
                    text: "streamed".to_string()
                },
                EngineConnectorEvent::Usage {
                    usage: AiUsage {
                        output_tokens: Some(1),
                        ..AiUsage::default()
                    }
                },
            ]
        );
    }

    #[test]
    fn request_and_event_bounds_fail_closed() {
        let now_ms: i64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis()
            .try_into()
            .expect("epoch milliseconds");
        let mut expired = configuration_request();
        expired.context.deadline_ms = now_ms - 1;
        assert!(matches!(
            expired.validate(),
            Err(EngineConnectorFailure::Timeout)
        ));
        let mut unbounded = configuration_request();
        unbounded.context.deadline_ms = now_ms + i64::from(MAX_TIMEOUT_MS) + 1;
        assert!(matches!(
            unbounded.validate(),
            Err(EngineConnectorFailure::InvalidRequest)
        ));

        let mut request = generation_request("http://127.0.0.1:11434/v1".to_string());
        request.messages[0].text = "x".repeat(MAX_CONNECTOR_MESSAGE_BYTES + 1);
        assert!(matches!(
            request.validate(),
            Err(EngineConnectorFailure::InvalidRequest)
        ));

        let mut nested = Value::Null;
        for _ in 0..=MAX_CONNECTOR_CONFIG_DEPTH {
            nested = json!({ "nested": nested });
        }
        let mut configuration = configuration_request();
        configuration.configuration = nested;
        assert!(matches!(
            configuration.validate(),
            Err(EngineConnectorFailure::InvalidRequest)
        ));

        let mut sink = CollectEventSink::default();
        let mut validating = ValidatingConnectorEventSink::new(&mut sink);
        assert!(matches!(
            validating.event(&EngineConnectorEvent::Usage {
                usage: AiUsage {
                    input_tokens: Some(MAX_CONNECTOR_USAGE_VALUE + 1),
                    ..AiUsage::default()
                }
            }),
            Err(EngineConnectorFailure::Protocol)
        ));
    }

    #[test]
    fn builtin_adapter_preserves_streaming_completion_and_usage() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1}}\n\n",
            "data: [DONE]\n\n"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
        let address = listener.local_addr().expect("fixture address");
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept fixture request");
            let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read fixture request");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().expect("content length");
                }
            }
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).expect("read fixture body");
            stream
                .write_all(response.as_bytes())
                .expect("write fixture response");
        });

        let registry = EngineConnectorRegistry::with_builtins().expect("builtin registry");
        let lease = registry
            .lookup("openaiCompatible")
            .expect("lookup builtin")
            .expect("builtin connector");
        let request = EngineConnectorRequest::Generate {
            request: generation_request(format!("http://{address}/v1")),
        };
        let credential = SecretString::new("fixture-secret".to_string()).expect("credential");
        let mut sink = CollectEventSink::default();
        let result = lease
            .invoke(
                &request,
                Some(&credential),
                &AtomicBool::new(false),
                &mut sink,
            )
            .expect("builtin invocation");
        let EngineConnectorResult::Generate { completion } = result else {
            panic!("expected generate result");
        };
        assert_eq!(completion.text, "你");
        assert_eq!(completion.usage.input_tokens, Some(2));
        assert_eq!(completion.usage.output_tokens, Some(1));
        assert_eq!(
            sink.0,
            vec![
                EngineConnectorEvent::TextDelta {
                    text: "你".to_string()
                },
                EngineConnectorEvent::Usage {
                    usage: completion.usage
                },
                EngineConnectorEvent::Completion,
            ]
        );
    }
}
