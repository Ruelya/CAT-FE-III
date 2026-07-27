use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::Deserialize;
use serde_json::{Map, Value};
use translunar_ai_core::{
    AiMessageRole, AiUsage, ConnectorCompletion, ConnectorConfigurationRequest,
    ConnectorGenerationRequest, EngineConnector, EngineConnectorEvent, EngineConnectorEventSink,
    EngineConnectorFailure, EngineConnectorModel, EngineConnectorOperation, EngineConnectorRequest,
    EngineConnectorResult, PluginConnectorOwner, SecretString,
};
use translunar_plugin_runtime::{
    DeclarativeConnectorAuthenticationV1, DeclarativeConnectorResponseMappingV1,
    DeclarativeConnectorUsageMappingV1, DeclarativeEngineConnectorDefinitionV1,
    EngineConnectorCancelRequestV1, EngineConnectorConfigSchemaV1, EngineConnectorConfigV1,
    EngineConnectorConfigValidationResultV1, EngineConnectorConfigValueV1,
    EngineConnectorEventSequenceV1, EngineConnectorEventV1, EngineConnectorFailureCodeV1,
    EngineConnectorGenerateRequestV1, EngineConnectorLimitsV1, EngineConnectorMessageRoleV1,
    EngineConnectorMessageV1, EngineConnectorModelCatalogV1, EngineConnectorModelsListRequestV1,
    EngineConnectorOperationV1, EngineConnectorRequestV1, EngineConnectorTestRequestV1,
    EngineConnectorTestResultV1, EngineConnectorValidateConfigRequestV1,
    PluginCapabilityAuthorizer, PluginCapabilityCheck, PluginCapabilityId, PluginCapabilityScope,
    PluginProcess, PluginRuntimeError, SANDBOX_PROTOCOL_VERSION, SandboxCancellationToken,
    SandboxError, SandboxInvocationV1, SandboxResultV1, SandboxWorkerHandle,
};

const POLL_INTERVAL: Duration = Duration::from_millis(5);
const CONTENT_TYPE: &str = "content-type";
const JSON_CONTENT_TYPE: &str = "application/json";

/// A host-owned HTTP request. Implementations must disable redirects and must
/// not log or persist headers or bodies. Keeping transport behind this boundary
/// lets the adapter enforce policy without giving plugins a generic HTTP API.
pub struct DeclarativeConnectorHttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub timeout: Duration,
    pub max_response_bytes: usize,
}

impl std::fmt::Debug for DeclarativeConnectorHttpRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DeclarativeConnectorHttpRequest")
            .field("url", &self.url)
            .field("header_count", &self.headers.len())
            .field("body_bytes", &self.body.len())
            .field("timeout", &self.timeout)
            .field("max_response_bytes", &self.max_response_bytes)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct DeclarativeConnectorHttpResponse {
    pub status: u16,
    /// The final URL observed by the transport. It must equal the requested URL;
    /// a different value is treated as a forbidden redirect.
    pub final_url: String,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
    pub retry_after_ms: Option<u64>,
}

impl std::fmt::Debug for DeclarativeConnectorHttpResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DeclarativeConnectorHttpResponse")
            .field("status", &self.status)
            .field("final_url", &self.final_url)
            .field("content_type", &self.content_type)
            .field("body_bytes", &self.body.len())
            .field("retry_after_ms", &self.retry_after_ms)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeclarativeConnectorTransportError {
    Canceled,
    Timeout,
    Unavailable,
    Protocol,
    ResponseTooLarge,
}

pub trait DeclarativeConnectorTransport: Send + Sync + std::fmt::Debug {
    fn execute(
        &self,
        request: DeclarativeConnectorHttpRequest,
        cancellation: &AtomicBool,
    ) -> Result<DeclarativeConnectorHttpResponse, DeclarativeConnectorTransportError>;
}

#[derive(Debug, Default)]
pub struct ReqwestDeclarativeConnectorTransport;

impl DeclarativeConnectorTransport for ReqwestDeclarativeConnectorTransport {
    fn execute(
        &self,
        request: DeclarativeConnectorHttpRequest,
        cancellation: &AtomicBool,
    ) -> Result<DeclarativeConnectorHttpResponse, DeclarativeConnectorTransportError> {
        if cancellation.load(Ordering::Acquire) {
            return Err(DeclarativeConnectorTransportError::Canceled);
        }
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(request.timeout)
            .build()
            .map_err(map_reqwest_transport_error)?;
        let mut headers = reqwest::header::HeaderMap::new();
        for (name, value) in request.headers {
            let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| DeclarativeConnectorTransportError::Protocol)?;
            let value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|_| DeclarativeConnectorTransportError::Protocol)?;
            if headers.insert(name, value).is_some() {
                return Err(DeclarativeConnectorTransportError::Protocol);
            }
        }
        let mut response = client
            .post(&request.url)
            .headers(headers)
            .body(request.body)
            .send()
            .map_err(map_reqwest_transport_error)?;
        if cancellation.load(Ordering::Acquire) {
            return Err(DeclarativeConnectorTransportError::Canceled);
        }
        if response
            .content_length()
            .is_some_and(|length| length > request.max_response_bytes as u64)
        {
            return Err(DeclarativeConnectorTransportError::ResponseTooLarge);
        }
        let status = response.status().as_u16();
        let final_url = response.url().as_str().to_string();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_ascii_lowercase);
        let retry_after_ms = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(|seconds| seconds.saturating_mul(1_000).min(120_000));
        let mut body = Vec::with_capacity(
            response
                .content_length()
                .and_then(|length| usize::try_from(length).ok())
                .unwrap_or(0)
                .min(request.max_response_bytes),
        );
        let mut buffer = [0u8; 8 * 1024];
        loop {
            if cancellation.load(Ordering::Acquire) {
                return Err(DeclarativeConnectorTransportError::Canceled);
            }
            let read = response.read(&mut buffer).map_err(map_transport_io_error)?;
            if read == 0 {
                break;
            }
            if body.len().saturating_add(read) > request.max_response_bytes {
                return Err(DeclarativeConnectorTransportError::ResponseTooLarge);
            }
            body.extend_from_slice(&buffer[..read]);
        }
        Ok(DeclarativeConnectorHttpResponse {
            status,
            final_url,
            content_type,
            body,
            retry_after_ms,
        })
    }
}

fn map_reqwest_transport_error(error: reqwest::Error) -> DeclarativeConnectorTransportError {
    if error.is_timeout() {
        DeclarativeConnectorTransportError::Timeout
    } else if error.is_connect() || error.is_request() || error.is_body() {
        DeclarativeConnectorTransportError::Unavailable
    } else {
        DeclarativeConnectorTransportError::Protocol
    }
}

fn map_transport_io_error(error: std::io::Error) -> DeclarativeConnectorTransportError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        DeclarativeConnectorTransportError::Timeout
    } else {
        DeclarativeConnectorTransportError::Unavailable
    }
}

pub struct DeclarativePluginEngineConnector {
    owner: PluginConnectorOwner,
    contribution_id: String,
    config_schema: EngineConnectorConfigSchemaV1,
    limits: EngineConnectorLimitsV1,
    definition: DeclarativeEngineConnectorDefinitionV1,
    destination_origin: String,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    transport: Arc<dyn DeclarativeConnectorTransport>,
}

impl std::fmt::Debug for DeclarativePluginEngineConnector {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DeclarativePluginEngineConnector")
            .field("owner", &self.owner)
            .field("contribution_id", &self.contribution_id)
            .field("destination_origin", &self.destination_origin)
            .finish_non_exhaustive()
    }
}

impl DeclarativePluginEngineConnector {
    pub fn new(
        owner: PluginConnectorOwner,
        contribution_id: String,
        config_schema: EngineConnectorConfigSchemaV1,
        limits: EngineConnectorLimitsV1,
        definition: DeclarativeEngineConnectorDefinitionV1,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        transport: Arc<dyn DeclarativeConnectorTransport>,
    ) -> Result<Self, EngineConnectorFailure> {
        config_schema
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        limits
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        definition
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        let destination_origin = normalize_origin(&definition.endpoint.destination_origin)?;
        if destination_origin != definition.endpoint.destination_origin {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Ok(Self {
            owner,
            contribution_id,
            config_schema,
            limits,
            definition,
            destination_origin,
            authorizer,
            transport,
        })
    }

    fn invoke_network(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        self.authorize_network(request.operation())?;
        let (configuration, generation) = request_parts(request);
        let config = strict_config(&configuration.configuration)?;
        self.config_schema
            .validate_config(&config)
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        let timeout = remaining_timeout(configuration, &self.limits)?;
        let url = render_url(&self.definition.endpoint.url_template, &configuration.model)?;
        ensure_url_in_origin(&url, &self.destination_origin)?;
        let body = build_request_body(&self.definition, configuration, generation)?;
        let max_body_bytes = (self.limits.max_config_bytes as usize)
            .saturating_add(self.limits.max_source_text_bytes as usize)
            .saturating_add(
                (self.limits.max_messages as usize)
                    .saturating_mul(self.limits.max_message_bytes as usize),
            );
        if body.len() > max_body_bytes {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        let headers = build_headers(&self.definition, credential)?;
        let response = self
            .transport
            .execute(
                DeclarativeConnectorHttpRequest {
                    url: url.clone(),
                    headers,
                    body,
                    timeout,
                    max_response_bytes: response_limit(configuration, &self.limits),
                },
                cancellation,
            )
            .map_err(map_transport_error)?;
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        if response.final_url != url || (300..=399).contains(&response.status) {
            return Err(EngineConnectorFailure::Protocol);
        }
        if response.body.len() > response_limit(configuration, &self.limits) {
            return Err(EngineConnectorFailure::ResponseTooLarge);
        }
        if !(200..=299).contains(&response.status) {
            return Err(self.map_status(response.status, response.retry_after_ms));
        }
        validate_content_type(response.content_type.as_deref(), &self.definition.response)?;
        map_declarative_success(
            request.operation(),
            &self.definition.response,
            &response.body,
            &self.limits,
            sink,
        )
    }

    fn authorize_network(
        &self,
        operation: EngineConnectorOperation,
    ) -> Result<(), EngineConnectorFailure> {
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.owner.plugin_id.clone(),
                version_id: self.owner.version_id.clone(),
                capability_id: PluginCapabilityId::NetworkConnect,
                scope: PluginCapabilityScope::Network {
                    origins: vec![self.destination_origin.clone()],
                },
                operation: operation_name(operation).to_string(),
                contribution_id: Some(self.contribution_id.clone()),
            })
            .map_err(|_| EngineConnectorFailure::Unavailable { retryable: false })
    }

    fn map_status(&self, status: u16, retry_after_ms: Option<u64>) -> EngineConnectorFailure {
        let mapped = self
            .definition
            .failures
            .iter()
            .find(|mapping| mapping.status == status);
        if let Some(mapping) = mapped {
            return map_failure_code(mapping.code, mapping.retryable, retry_after_ms);
        }
        match status {
            401 | 403 => EngineConnectorFailure::Authentication,
            408 => EngineConnectorFailure::Timeout,
            413 => EngineConnectorFailure::ResponseTooLarge,
            429 => EngineConnectorFailure::RateLimited { retry_after_ms },
            500..=599 => EngineConnectorFailure::Unavailable { retryable: true },
            _ => EngineConnectorFailure::Protocol,
        }
    }
}

impl EngineConnector for DeclarativePluginEngineConnector {
    fn invoke(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        request.validate()?;
        authorize_connector(
            self.authorizer.as_ref(),
            &self.owner,
            &self.contribution_id,
            request.operation(),
            operation_name(request.operation()),
        )?;
        if let EngineConnectorRequest::ValidateConfig { request } = request {
            let config = strict_config(&request.configuration)?;
            self.config_schema
                .validate_config(&config)
                .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
            return Ok(EngineConnectorResult::ValidateConfig);
        }
        self.invoke_network(request, credential, cancellation, sink)
    }
}

#[derive(Clone)]
struct ActiveSandboxRequest {
    operation: EngineConnectorOperation,
    token: SandboxCancellationToken,
}

pub struct SandboxPluginEngineConnector {
    owner: PluginConnectorOwner,
    contribution_id: String,
    config_schema: EngineConnectorConfigSchemaV1,
    limits: EngineConnectorLimitsV1,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    worker: SandboxWorkerHandle,
    active: Mutex<HashMap<String, ActiveSandboxRequest>>,
}

impl std::fmt::Debug for SandboxPluginEngineConnector {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SandboxPluginEngineConnector")
            .field("owner", &self.owner)
            .field("contribution_id", &self.contribution_id)
            .field("worker_key", &self.worker.key())
            .finish_non_exhaustive()
    }
}

impl SandboxPluginEngineConnector {
    pub fn new(
        owner: PluginConnectorOwner,
        contribution_id: String,
        config_schema: EngineConnectorConfigSchemaV1,
        limits: EngineConnectorLimitsV1,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        worker: SandboxWorkerHandle,
    ) -> Result<Self, EngineConnectorFailure> {
        config_schema
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        limits
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        if worker.key().plugin_id != owner.plugin_id || worker.key().version_id != owner.version_id
        {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Ok(Self {
            owner,
            contribution_id,
            config_schema,
            limits,
            authorizer,
            worker,
            active: Mutex::new(HashMap::new()),
        })
    }

    fn invoke_worker(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
    ) -> Result<SandboxResultV1, EngineConnectorFailure> {
        let runtime_request = to_runtime_request(request, &self.config_schema, &self.limits)?;
        let request_id = request.request_id().to_string();
        let token = SandboxCancellationToken::default();
        {
            let mut active = self
                .active
                .lock()
                .map_err(|_| EngineConnectorFailure::Unavailable { retryable: false })?;
            if active.contains_key(&request_id) {
                return Err(EngineConnectorFailure::InvalidRequest);
            }
            active.insert(
                request_id.clone(),
                ActiveSandboxRequest {
                    operation: request.operation(),
                    token: token.clone(),
                },
            );
        }
        let input = serde_json::to_value(runtime_request)
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        let invocation = SandboxInvocationV1 {
            protocol_version: SANDBOX_PROTOCOL_VERSION,
            invocation_id: request_id.clone(),
            contribution_id: self.contribution_id.clone(),
            operation: format!("connector.{}", operation_name(request.operation())),
            input,
        };
        let deadline_ms = request_deadline_ms(request);
        let finished = AtomicBool::new(false);
        let worker_result = std::thread::scope(|scope| {
            let monitor_finished = &finished;
            let monitor_token = token.clone();
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if cancellation.load(Ordering::Acquire)
                        || Utc::now().timestamp_millis() >= deadline_ms
                    {
                        monitor_token.cancel();
                        break;
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            });
            let result = self.worker.invoke_with_credential_and_cancellation(
                invocation,
                credential.map(SecretString::expose),
                token,
            );
            finished.store(true, Ordering::Release);
            result
        });
        if let Ok(mut active) = self.active.lock() {
            active.remove(&request_id);
        }
        worker_result.map_err(|error| map_sandbox_error(&error))
    }
}

impl EngineConnector for SandboxPluginEngineConnector {
    fn invoke(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        request.validate()?;
        authorize_connector(
            self.authorizer.as_ref(),
            &self.owner,
            &self.contribution_id,
            request.operation(),
            operation_name(request.operation()),
        )?;
        let result = self.invoke_worker(request, credential, cancellation);
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        let result = result?;
        map_sandbox_result(request, result, &self.limits, sink)
    }

    fn cancel(&self, request_id: &str) -> Result<(), EngineConnectorFailure> {
        let active = self
            .active
            .lock()
            .map_err(|_| EngineConnectorFailure::Unavailable { retryable: false })?
            .get(request_id)
            .cloned();
        let Some(active) = active else {
            return Ok(());
        };
        authorize_connector(
            self.authorizer.as_ref(),
            &self.owner,
            &self.contribution_id,
            active.operation,
            "connector.cancel",
        )?;
        active.token.cancel();
        Ok(())
    }

    fn shutdown(&self) -> Result<(), EngineConnectorFailure> {
        if let Ok(active) = self.active.lock() {
            for request in active.values() {
                request.token.cancel();
            }
        }
        self.worker
            .shutdown()
            .map_err(|error| map_sandbox_error(&error))
    }
}

#[derive(Debug, Clone, Copy)]
struct ActiveProcessRequest {
    operation: EngineConnectorOperation,
}

pub struct ProcessPluginEngineConnector {
    owner: PluginConnectorOwner,
    contribution_id: String,
    config_schema: EngineConnectorConfigSchemaV1,
    limits: EngineConnectorLimitsV1,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    process: Arc<PluginProcess>,
    active: Mutex<HashMap<String, ActiveProcessRequest>>,
}

impl std::fmt::Debug for ProcessPluginEngineConnector {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProcessPluginEngineConnector")
            .field("owner", &self.owner)
            .field("contribution_id", &self.contribution_id)
            .finish_non_exhaustive()
    }
}

impl ProcessPluginEngineConnector {
    pub fn new(
        owner: PluginConnectorOwner,
        contribution_id: String,
        config_schema: EngineConnectorConfigSchemaV1,
        limits: EngineConnectorLimitsV1,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        process: Arc<PluginProcess>,
    ) -> Result<Self, EngineConnectorFailure> {
        config_schema
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        limits
            .validate()
            .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
        if process.manifest().id != owner.plugin_id {
            return Err(EngineConnectorFailure::InvalidRequest);
        }
        Ok(Self {
            owner,
            contribution_id,
            config_schema,
            limits,
            authorizer,
            process,
            active: Mutex::new(HashMap::new()),
        })
    }

    fn invoke_process(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        let runtime_request = to_runtime_request(request, &self.config_schema, &self.limits)?;
        let request_id = request.request_id().to_string();
        let timeout = remaining_timeout(request_parts(request).0, &self.limits)?;
        {
            let mut active = self
                .active
                .lock()
                .map_err(|_| EngineConnectorFailure::Unavailable { retryable: false })?;
            if active.contains_key(&request_id) {
                return Err(EngineConnectorFailure::InvalidRequest);
            }
            active.insert(
                request_id.clone(),
                ActiveProcessRequest {
                    operation: request.operation(),
                },
            );
        }

        let finished = AtomicBool::new(false);
        let call_result = std::thread::scope(|scope| {
            let monitor_finished = &finished;
            let process = Arc::clone(&self.process);
            let cancel_request = EngineConnectorCancelRequestV1 {
                contract_version: 1,
                request_id: request_id.clone(),
            };
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if cancellation.load(Ordering::Acquire) {
                        let _ = process.notify_connector_cancel(&cancel_request);
                        break;
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            });
            let result = match runtime_request {
                EngineConnectorRequestV1::Generate(generate) => {
                    let mut events = Vec::new();
                    self.process
                        .call_connector_stream(
                            &generate,
                            credential.map(SecretString::expose),
                            &self.limits,
                            timeout,
                            |event| {
                                events.push(event);
                                Ok(())
                            },
                        )
                        .map(|terminal| ProcessCallResult::Generate { terminal, events })
                }
                request => {
                    process_connector_call(self.process.as_ref(), request, credential, timeout)
                        .map(ProcessCallResult::Other)
                }
            };
            finished.store(true, Ordering::Release);
            result
        });
        if let Ok(mut active) = self.active.lock() {
            active.remove(&request_id);
        }
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        let call_result = call_result.map_err(|error| map_process_error(&error))?;
        match call_result {
            ProcessCallResult::Generate { terminal, events } => {
                terminal
                    .validate(&self.limits)
                    .map_err(|_| EngineConnectorFailure::Protocol)?;
                let mapped = map_sandbox_events(&request_id, events, &self.limits, sink)?;
                let EngineConnectorResult::Generate { completion } = &mapped else {
                    return Err(EngineConnectorFailure::Protocol);
                };
                if completion.text != terminal.output_text
                    || terminal.usage.as_ref().map(|usage| usage.input_tokens)
                        != completion.usage.input_tokens
                    || terminal.usage.as_ref().map(|usage| usage.output_tokens)
                        != completion.usage.output_tokens
                {
                    return Err(EngineConnectorFailure::Protocol);
                }
                Ok(mapped)
            }
            ProcessCallResult::Other(output) => {
                map_connector_output(request, output, &self.limits, sink)
            }
        }
    }
}

enum ProcessCallResult {
    Generate {
        terminal: translunar_plugin_runtime::EngineConnectorResultV1,
        events: Vec<EngineConnectorEventV1>,
    },
    Other(Value),
}

impl EngineConnector for ProcessPluginEngineConnector {
    fn invoke(
        &self,
        request: &EngineConnectorRequest,
        credential: Option<&SecretString>,
        cancellation: &AtomicBool,
        sink: &mut dyn EngineConnectorEventSink,
    ) -> Result<EngineConnectorResult, EngineConnectorFailure> {
        request.validate()?;
        authorize_connector(
            self.authorizer.as_ref(),
            &self.owner,
            &self.contribution_id,
            request.operation(),
            operation_name(request.operation()),
        )?;
        if cancellation.load(Ordering::Acquire) {
            return Err(EngineConnectorFailure::Canceled);
        }
        self.invoke_process(request, credential, cancellation, sink)
    }

    fn cancel(&self, request_id: &str) -> Result<(), EngineConnectorFailure> {
        let active = self
            .active
            .lock()
            .map_err(|_| EngineConnectorFailure::Unavailable { retryable: false })?
            .get(request_id)
            .copied();
        let Some(active) = active else {
            return Ok(());
        };
        authorize_connector(
            self.authorizer.as_ref(),
            &self.owner,
            &self.contribution_id,
            active.operation,
            "connector.cancel",
        )?;
        self.process
            .notify_connector_cancel(&EngineConnectorCancelRequestV1 {
                contract_version: 1,
                request_id: request_id.to_string(),
            })
            .map_err(|error| map_process_error(&error))
    }

    fn shutdown(&self) -> Result<(), EngineConnectorFailure> {
        let request_ids = self
            .active
            .lock()
            .map(|active| active.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for request_id in request_ids {
            let _ = self
                .process
                .notify_connector_cancel(&EngineConnectorCancelRequestV1 {
                    contract_version: 1,
                    request_id,
                });
        }
        self.process
            .shutdown_connector(Duration::from_millis(
                self.limits.max_deadline_ms.min(5_000),
            ))
            .map_err(|error| map_process_error(&error))
    }
}

fn process_connector_call(
    process: &PluginProcess,
    request: EngineConnectorRequestV1,
    credential: Option<&SecretString>,
    timeout: Duration,
) -> Result<Value, PluginRuntimeError> {
    let method = format!("connector.{}", request.operation().as_str());
    let mut params = Map::new();
    params.insert("request".to_string(), serde_json::to_value(request)?);
    if let Some(credential) = credential {
        params.insert(
            "credential".to_string(),
            Value::String(credential.expose().to_string()),
        );
    }
    process.call(&method, Value::Object(params), timeout)
}

fn map_process_error(error: &PluginRuntimeError) -> EngineConnectorFailure {
    match error {
        PluginRuntimeError::Timeout(_) => EngineConnectorFailure::Timeout,
        PluginRuntimeError::PermissionDenied(_) | PluginRuntimeError::CapabilityUnsupported(_) => {
            EngineConnectorFailure::Unavailable { retryable: false }
        }
        PluginRuntimeError::Process(_) | PluginRuntimeError::Io(_) => {
            EngineConnectorFailure::Unavailable { retryable: true }
        }
        PluginRuntimeError::Conflict(_) => EngineConnectorFailure::InvalidRequest,
        PluginRuntimeError::Protocol(_)
        | PluginRuntimeError::Remote(_)
        | PluginRuntimeError::Json(_) => EngineConnectorFailure::Protocol,
        PluginRuntimeError::InvalidManifest(_)
        | PluginRuntimeError::NotFound(_)
        | PluginRuntimeError::UnsupportedVersion { .. }
        | PluginRuntimeError::IncompatibleHost { .. }
        | PluginRuntimeError::PackageInvalid(_)
        | PluginRuntimeError::PackageHashMismatch { .. } => {
            EngineConnectorFailure::Unavailable { retryable: false }
        }
    }
}

fn authorize_connector(
    authorizer: &dyn PluginCapabilityAuthorizer,
    owner: &PluginConnectorOwner,
    contribution_id: &str,
    operation: EngineConnectorOperation,
    audit_operation: &str,
) -> Result<(), EngineConnectorFailure> {
    authorizer
        .authorize(&PluginCapabilityCheck {
            plugin_id: owner.plugin_id.clone(),
            version_id: owner.version_id.clone(),
            capability_id: PluginCapabilityId::EngineConnector,
            scope: PluginCapabilityScope::Operations {
                operations: vec![operation_name(operation).to_string()],
            },
            operation: audit_operation.to_string(),
            contribution_id: Some(contribution_id.to_string()),
        })
        .map_err(|_| EngineConnectorFailure::Unavailable { retryable: false })
}

fn operation_name(operation: EngineConnectorOperation) -> &'static str {
    match operation {
        EngineConnectorOperation::ValidateConfig => "validateConfig",
        EngineConnectorOperation::Test => "test",
        EngineConnectorOperation::ModelsList => "models.list",
        EngineConnectorOperation::Generate => "generate",
    }
}

fn runtime_operation(operation: EngineConnectorOperation) -> EngineConnectorOperationV1 {
    match operation {
        EngineConnectorOperation::ValidateConfig => EngineConnectorOperationV1::ValidateConfig,
        EngineConnectorOperation::Test => EngineConnectorOperationV1::Test,
        EngineConnectorOperation::ModelsList => EngineConnectorOperationV1::ModelsList,
        EngineConnectorOperation::Generate => EngineConnectorOperationV1::Generate,
    }
}

fn request_parts(
    request: &EngineConnectorRequest,
) -> (
    &ConnectorConfigurationRequest,
    Option<&ConnectorGenerationRequest>,
) {
    match request {
        EngineConnectorRequest::ValidateConfig { request }
        | EngineConnectorRequest::ModelsList { request } => (request, None),
        EngineConnectorRequest::Test { request } | EngineConnectorRequest::Generate { request } => {
            (&request.configuration, Some(request))
        }
    }
}

fn request_deadline_ms(request: &EngineConnectorRequest) -> i64 {
    request_parts(request).0.context.deadline_ms
}

fn strict_config(value: &Value) -> Result<EngineConnectorConfigV1, EngineConnectorFailure> {
    let object = value
        .as_object()
        .ok_or(EngineConnectorFailure::InvalidRequest)?;
    object
        .iter()
        .map(|(key, value)| {
            let value = match value {
                Value::String(value) => EngineConnectorConfigValueV1::String(value.clone()),
                Value::Bool(value) => EngineConnectorConfigValueV1::Boolean(*value),
                Value::Number(value) => value
                    .as_i64()
                    .map(EngineConnectorConfigValueV1::Integer)
                    .ok_or(EngineConnectorFailure::InvalidRequest)?,
                _ => return Err(EngineConnectorFailure::InvalidRequest),
            };
            Ok((key.clone(), value))
        })
        .collect()
}

fn remaining_timeout(
    request: &ConnectorConfigurationRequest,
    limits: &EngineConnectorLimitsV1,
) -> Result<Duration, EngineConnectorFailure> {
    let remaining = request
        .context
        .deadline_ms
        .saturating_sub(Utc::now().timestamp_millis());
    if remaining <= 0 {
        return Err(EngineConnectorFailure::Timeout);
    }
    let millis = u64::try_from(remaining)
        .unwrap_or(u64::MAX)
        .min(u64::from(request.timeout_ms))
        .min(limits.max_deadline_ms);
    if millis == 0 {
        return Err(EngineConnectorFailure::Timeout);
    }
    Ok(Duration::from_millis(millis))
}

fn response_limit(
    request: &ConnectorConfigurationRequest,
    limits: &EngineConnectorLimitsV1,
) -> usize {
    (request.max_response_bytes as usize).min(limits.max_output_bytes as usize)
}

fn normalize_origin(origin: &str) -> Result<String, EngineConnectorFailure> {
    let url = translunar_ai_core::validate_endpoint(origin)
        .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(EngineConnectorFailure::InvalidRequest);
    }
    let host = url
        .host_str()
        .ok_or(EngineConnectorFailure::InvalidRequest)?;
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_ascii_lowercase()
    };
    let mut normalized = format!("{}://{host}", url.scheme());
    let port = url
        .port()
        .filter(|port| !matches!((url.scheme(), *port), ("http", 80) | ("https", 443)));
    if let Some(port) = port {
        normalized.push(':');
        normalized.push_str(&port.to_string());
    }
    Ok(normalized)
}

fn ensure_url_in_origin(url: &str, origin: &str) -> Result<(), EngineConnectorFailure> {
    translunar_ai_core::validate_endpoint(url)
        .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
    if url != origin && !url.starts_with(&format!("{origin}/")) {
        return Err(EngineConnectorFailure::InvalidRequest);
    }
    Ok(())
}

fn render_url(template: &str, model: &str) -> Result<String, EngineConnectorFailure> {
    if template.contains('{') && !template.contains("{model}") {
        return Err(EngineConnectorFailure::InvalidRequest);
    }
    Ok(template.replace("{model}", &percent_encode_path_segment(model)))
}

fn percent_encode_path_segment(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            output.push(char::from(byte));
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn build_headers(
    definition: &DeclarativeEngineConnectorDefinitionV1,
    credential: Option<&SecretString>,
) -> Result<Vec<(String, String)>, EngineConnectorFailure> {
    let mut headers = definition
        .fixed_headers
        .iter()
        .map(|header| (header.name.clone(), header.value.clone()))
        .collect::<Vec<_>>();
    if !headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case(CONTENT_TYPE))
    {
        headers.push((CONTENT_TYPE.to_string(), JSON_CONTENT_TYPE.to_string()));
    }
    match &definition.authentication {
        DeclarativeConnectorAuthenticationV1::None => {}
        DeclarativeConnectorAuthenticationV1::Bearer => {
            let credential = credential.ok_or(EngineConnectorFailure::Authentication)?;
            headers.push((
                "authorization".to_string(),
                format!("Bearer {}", credential.expose()),
            ));
        }
        DeclarativeConnectorAuthenticationV1::Header { name } => {
            let credential = credential.ok_or(EngineConnectorFailure::Authentication)?;
            if headers
                .iter()
                .any(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            {
                return Err(EngineConnectorFailure::InvalidRequest);
            }
            headers.push((name.clone(), credential.expose().to_string()));
        }
    }
    Ok(headers)
}

fn build_request_body(
    definition: &DeclarativeEngineConnectorDefinitionV1,
    configuration: &ConnectorConfigurationRequest,
    generation: Option<&ConnectorGenerationRequest>,
) -> Result<Vec<u8>, EngineConnectorFailure> {
    let mut root = Value::Object(
        definition
            .request
            .fixed_body
            .clone()
            .into_iter()
            .collect::<Map<_, _>>(),
    );
    set_json_path(
        &mut root,
        &definition.request.model_path,
        Value::String(configuration.model.clone()),
    )?;
    let messages = generation
        .map(|request| {
            request
                .messages
                .iter()
                .map(|message| {
                    serde_json::json!({
                        "role": match message.role {
                            AiMessageRole::System => "system",
                            AiMessageRole::User => "user",
                            AiMessageRole::Assistant => "assistant",
                        },
                        "content": message.text,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    set_json_path(
        &mut root,
        &definition.request.messages_path,
        Value::Array(messages),
    )?;
    if let Some(request) = generation {
        set_optional_json_path(
            &mut root,
            definition.request.source_text_path.as_deref(),
            Value::String(request.source_text.clone()),
        )?;
        set_optional_json_path(
            &mut root,
            definition.request.source_locale_path.as_deref(),
            Value::String(request.source_locale.clone()),
        )?;
        set_optional_json_path(
            &mut root,
            definition.request.target_locale_path.as_deref(),
            Value::String(request.target_locale.clone()),
        )?;
    }
    set_optional_json_path(
        &mut root,
        definition.request.stream_path.as_deref(),
        Value::Bool(matches!(
            definition.response,
            DeclarativeConnectorResponseMappingV1::ServerSentEvents { .. }
        )),
    )?;
    serde_json::to_vec(&root).map_err(|_| EngineConnectorFailure::InvalidRequest)
}

fn set_optional_json_path(
    root: &mut Value,
    path: Option<&[String]>,
    value: Value,
) -> Result<(), EngineConnectorFailure> {
    match path {
        Some(path) => set_json_path(root, path, value),
        None => Ok(()),
    }
}

fn set_json_path(
    root: &mut Value,
    path: &[String],
    value: Value,
) -> Result<(), EngineConnectorFailure> {
    let (last, parents) = path
        .split_last()
        .ok_or(EngineConnectorFailure::InvalidRequest)?;
    let mut current = root;
    for segment in parents {
        let object = current
            .as_object_mut()
            .ok_or(EngineConnectorFailure::InvalidRequest)?;
        current = object
            .entry(segment.clone())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    let object = current
        .as_object_mut()
        .ok_or(EngineConnectorFailure::InvalidRequest)?;
    if object.insert(last.clone(), value).is_some() {
        return Err(EngineConnectorFailure::InvalidRequest);
    }
    Ok(())
}

fn json_path<'a>(root: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter()
        .try_fold(root, |current, segment| match current {
            Value::Object(object) => object.get(segment),
            Value::Array(array) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| array.get(index)),
            _ => None,
        })
}

fn map_declarative_success(
    operation: EngineConnectorOperation,
    mapping: &DeclarativeConnectorResponseMappingV1,
    body: &[u8],
    limits: &EngineConnectorLimitsV1,
    sink: &mut dyn EngineConnectorEventSink,
) -> Result<EngineConnectorResult, EngineConnectorFailure> {
    if operation == EngineConnectorOperation::ModelsList {
        return map_declarative_models(mapping, body, limits);
    }
    let started = Instant::now();
    let (text, usage) = match mapping {
        DeclarativeConnectorResponseMappingV1::Json {
            text_path,
            finish_reason_path,
            usage,
        } => {
            let payload: Value =
                serde_json::from_slice(body).map_err(|_| EngineConnectorFailure::Protocol)?;
            validate_finish_reason(&payload, finish_reason_path.as_deref())?;
            let text = json_path(&payload, text_path)
                .and_then(Value::as_str)
                .ok_or(EngineConnectorFailure::Protocol)?
                .to_string();
            let usage = map_usage(&payload, usage.as_ref())?;
            (text, usage.unwrap_or_default())
        }
        DeclarativeConnectorResponseMappingV1::ServerSentEvents {
            delta_path,
            finish_reason_path,
            usage,
            done_marker,
            max_line_bytes,
        } => map_sse(
            body,
            delta_path,
            finish_reason_path.as_deref(),
            usage.as_ref(),
            done_marker,
            *max_line_bytes as usize,
            sink,
        )?,
    };
    if text.trim().is_empty() {
        return Err(EngineConnectorFailure::Protocol);
    }
    if matches!(mapping, DeclarativeConnectorResponseMappingV1::Json { .. }) {
        sink.event(&EngineConnectorEvent::TextDelta { text: text.clone() })?;
        if usage != AiUsage::default() {
            sink.event(&EngineConnectorEvent::Usage {
                usage: usage.clone(),
            })?;
        }
    }
    sink.event(&EngineConnectorEvent::Completion)?;
    let completion = ConnectorCompletion {
        text,
        usage,
        elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    };
    Ok(if operation == EngineConnectorOperation::Test {
        EngineConnectorResult::Test { completion }
    } else {
        EngineConnectorResult::Generate { completion }
    })
}

fn validate_content_type(
    content_type: Option<&str>,
    mapping: &DeclarativeConnectorResponseMappingV1,
) -> Result<(), EngineConnectorFailure> {
    let content_type = content_type.ok_or(EngineConnectorFailure::Protocol)?;
    let media_type = content_type
        .split(';')
        .next()
        .map(str::trim)
        .ok_or(EngineConnectorFailure::Protocol)?;
    let expected = match mapping {
        DeclarativeConnectorResponseMappingV1::Json { .. } => "application/json",
        DeclarativeConnectorResponseMappingV1::ServerSentEvents { .. } => "text/event-stream",
    };
    if media_type == expected {
        Ok(())
    } else {
        Err(EngineConnectorFailure::Protocol)
    }
}

fn map_declarative_models(
    mapping: &DeclarativeConnectorResponseMappingV1,
    body: &[u8],
    limits: &EngineConnectorLimitsV1,
) -> Result<EngineConnectorResult, EngineConnectorFailure> {
    let DeclarativeConnectorResponseMappingV1::Json { text_path, .. } = mapping else {
        return Err(EngineConnectorFailure::UnsupportedOperation);
    };
    let payload: Value =
        serde_json::from_slice(body).map_err(|_| EngineConnectorFailure::Protocol)?;
    let values = json_path(&payload, text_path)
        .and_then(Value::as_array)
        .ok_or(EngineConnectorFailure::Protocol)?;
    if values.len() > limits.max_models as usize {
        return Err(EngineConnectorFailure::ResponseTooLarge);
    }
    let models = values
        .iter()
        .map(|value| {
            let object = value.as_object().ok_or(EngineConnectorFailure::Protocol)?;
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .ok_or(EngineConnectorFailure::Protocol)?;
            let display_name = object
                .get("displayName")
                .or_else(|| object.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(id);
            if id.is_empty()
                || id.len() > limits.max_model_id_bytes as usize
                || display_name.is_empty()
                || display_name.chars().count()
                    > translunar_ai_core::MAX_CONNECTOR_DISPLAY_NAME_CHARS
            {
                return Err(EngineConnectorFailure::Protocol);
            }
            Ok(EngineConnectorModel {
                id: id.to_string(),
                display_name: display_name.to_string(),
            })
        })
        .collect::<Result<Vec<_>, EngineConnectorFailure>>()?;
    Ok(EngineConnectorResult::ModelsList { models })
}

fn map_sse(
    body: &[u8],
    delta_path: &[String],
    finish_reason_path: Option<&[String]>,
    usage_mapping: Option<&DeclarativeConnectorUsageMappingV1>,
    done_marker: &str,
    max_line_bytes: usize,
    sink: &mut dyn EngineConnectorEventSink,
) -> Result<(String, AiUsage), EngineConnectorFailure> {
    let text = std::str::from_utf8(body).map_err(|_| EngineConnectorFailure::Protocol)?;
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.lines().any(|line| line.len() > max_line_bytes) {
        return Err(EngineConnectorFailure::ResponseTooLarge);
    }
    let mut output = String::new();
    let mut final_usage = None;
    let mut mapped_events = Vec::new();
    let mut saw_done = false;
    for frame in normalized.split("\n\n") {
        let mut data = Vec::new();
        for line in frame.lines() {
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let Some(value) = line.strip_prefix("data:") else {
                return Err(EngineConnectorFailure::Protocol);
            };
            data.push(value.strip_prefix(' ').unwrap_or(value));
        }
        if data.is_empty() {
            continue;
        }
        if saw_done {
            return Err(EngineConnectorFailure::Protocol);
        }
        let data = data.join("\n");
        if data == done_marker {
            saw_done = true;
            continue;
        }
        let payload: Value =
            serde_json::from_str(&data).map_err(|_| EngineConnectorFailure::Protocol)?;
        validate_finish_reason(&payload, finish_reason_path)?;
        if let Some(delta) = json_path(&payload, delta_path) {
            let delta = delta.as_str().ok_or(EngineConnectorFailure::Protocol)?;
            if !delta.is_empty() {
                output.push_str(delta);
                mapped_events.push(EngineConnectorEvent::TextDelta {
                    text: delta.to_string(),
                });
            }
        }
        if let Some(usage) = map_usage(&payload, usage_mapping)? {
            if final_usage.is_some() {
                return Err(EngineConnectorFailure::Protocol);
            }
            mapped_events.push(EngineConnectorEvent::Usage {
                usage: usage.clone(),
            });
            final_usage = Some(usage);
        }
    }
    if !saw_done {
        return Err(EngineConnectorFailure::Protocol);
    }
    for event in mapped_events {
        sink.event(&event)?;
    }
    Ok((output, final_usage.unwrap_or_default()))
}

fn validate_finish_reason(
    payload: &Value,
    path: Option<&[String]>,
) -> Result<(), EngineConnectorFailure> {
    let Some(path) = path else {
        return Ok(());
    };
    let Some(value) = json_path(payload, path) else {
        return Ok(());
    };
    match value.as_str() {
        Some("stop" | "length" | "content_filter" | "contentFilter") | None if value.is_null() => {
            Ok(())
        }
        _ => Err(EngineConnectorFailure::Protocol),
    }
}

fn map_usage(
    payload: &Value,
    mapping: Option<&DeclarativeConnectorUsageMappingV1>,
) -> Result<Option<AiUsage>, EngineConnectorFailure> {
    let Some(mapping) = mapping else {
        return Ok(None);
    };
    let input = mapped_u64(payload, mapping.input_tokens_path.as_deref())?;
    let output = mapped_u64(payload, mapping.output_tokens_path.as_deref())?;
    let total = mapped_u64(payload, mapping.total_tokens_path.as_deref())?;
    if input.is_none() && output.is_none() && total.is_none() {
        return Ok(None);
    }
    if let (Some(input), Some(output), Some(total)) = (input, output, total)
        && input.saturating_add(output) != total
    {
        return Err(EngineConnectorFailure::Protocol);
    }
    Ok(Some(AiUsage {
        input_tokens: input,
        output_tokens: output,
        ..AiUsage::default()
    }))
}

fn mapped_u64(
    payload: &Value,
    path: Option<&[String]>,
) -> Result<Option<u64>, EngineConnectorFailure> {
    let Some(path) = path else {
        return Ok(None);
    };
    let Some(value) = json_path(payload, path) else {
        return Ok(None);
    };
    value
        .as_u64()
        .map(Some)
        .ok_or(EngineConnectorFailure::Protocol)
}

fn map_transport_error(error: DeclarativeConnectorTransportError) -> EngineConnectorFailure {
    match error {
        DeclarativeConnectorTransportError::Canceled => EngineConnectorFailure::Canceled,
        DeclarativeConnectorTransportError::Timeout => EngineConnectorFailure::Timeout,
        DeclarativeConnectorTransportError::Unavailable => {
            EngineConnectorFailure::Unavailable { retryable: true }
        }
        DeclarativeConnectorTransportError::ResponseTooLarge => {
            EngineConnectorFailure::ResponseTooLarge
        }
        DeclarativeConnectorTransportError::Protocol => EngineConnectorFailure::Protocol,
    }
}

fn map_failure_code(
    code: EngineConnectorFailureCodeV1,
    retryable: bool,
    retry_after_ms: Option<u64>,
) -> EngineConnectorFailure {
    match code {
        EngineConnectorFailureCodeV1::InvalidConfig => EngineConnectorFailure::InvalidRequest,
        EngineConnectorFailureCodeV1::Authentication => EngineConnectorFailure::Authentication,
        EngineConnectorFailureCodeV1::RateLimit => {
            EngineConnectorFailure::RateLimited { retry_after_ms }
        }
        EngineConnectorFailureCodeV1::Timeout => EngineConnectorFailure::Timeout,
        EngineConnectorFailureCodeV1::Unavailable | EngineConnectorFailureCodeV1::HostCrash => {
            EngineConnectorFailure::Unavailable { retryable }
        }
        EngineConnectorFailureCodeV1::Protocol => EngineConnectorFailure::Protocol,
        EngineConnectorFailureCodeV1::ResponseSize => EngineConnectorFailure::ResponseTooLarge,
        EngineConnectorFailureCodeV1::Cancelled => EngineConnectorFailure::Canceled,
    }
}

fn to_runtime_request(
    request: &EngineConnectorRequest,
    schema: &EngineConnectorConfigSchemaV1,
    limits: &EngineConnectorLimitsV1,
) -> Result<EngineConnectorRequestV1, EngineConnectorFailure> {
    let (configuration, generation) = request_parts(request);
    let config = strict_config(&configuration.configuration)?;
    schema
        .validate_config(&config)
        .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
    let deadline_ms = u64::try_from(
        configuration
            .context
            .deadline_ms
            .saturating_sub(Utc::now().timestamp_millis()),
    )
    .map_err(|_| EngineConnectorFailure::Timeout)?
    .min(u64::from(configuration.timeout_ms))
    .min(limits.max_deadline_ms);
    if deadline_ms == 0 {
        return Err(EngineConnectorFailure::Timeout);
    }
    let request_id = configuration.context.request_id.clone();
    let runtime = match (runtime_operation(request.operation()), generation) {
        (EngineConnectorOperationV1::ValidateConfig, _) => {
            EngineConnectorRequestV1::ValidateConfig(EngineConnectorValidateConfigRequestV1 {
                contract_version: 1,
                request_id,
                config,
                deadline_ms,
            })
        }
        (EngineConnectorOperationV1::Test, Some(generation)) => {
            EngineConnectorRequestV1::Test(EngineConnectorTestRequestV1 {
                contract_version: 1,
                request_id,
                config,
                model: Some(configuration.model.clone()),
                source_locale: generation.source_locale.clone(),
                target_locale: generation.target_locale.clone(),
                deadline_ms,
            })
        }
        (EngineConnectorOperationV1::ModelsList, _) => {
            EngineConnectorRequestV1::ModelsList(EngineConnectorModelsListRequestV1 {
                contract_version: 1,
                request_id,
                config,
                cursor: None,
                limit: limits.max_models,
                deadline_ms,
            })
        }
        (EngineConnectorOperationV1::Generate, Some(generation)) => {
            EngineConnectorRequestV1::Generate(EngineConnectorGenerateRequestV1 {
                contract_version: 1,
                request_id,
                source_locale: generation.source_locale.clone(),
                target_locale: generation.target_locale.clone(),
                source_text: generation.source_text.clone(),
                messages: generation
                    .messages
                    .iter()
                    .map(|message| EngineConnectorMessageV1 {
                        role: match message.role {
                            AiMessageRole::System => EngineConnectorMessageRoleV1::System,
                            AiMessageRole::User => EngineConnectorMessageRoleV1::User,
                            AiMessageRole::Assistant => EngineConnectorMessageRoleV1::Assistant,
                        },
                        content: message.text.clone(),
                    })
                    .collect(),
                model: configuration.model.clone(),
                config,
                deadline_ms,
            })
        }
        _ => return Err(EngineConnectorFailure::InvalidRequest),
    };
    runtime
        .validate(limits)
        .map_err(|_| EngineConnectorFailure::InvalidRequest)?;
    Ok(runtime)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SandboxEventEnvelope {
    events: Vec<EngineConnectorEventV1>,
}

fn map_sandbox_result(
    request: &EngineConnectorRequest,
    result: SandboxResultV1,
    limits: &EngineConnectorLimitsV1,
    sink: &mut dyn EngineConnectorEventSink,
) -> Result<EngineConnectorResult, EngineConnectorFailure> {
    if !result.ok {
        let error = result.error.ok_or(EngineConnectorFailure::Protocol)?;
        return Err(map_plugin_error(&error.code, error.retryable));
    }
    let output = result.output.ok_or(EngineConnectorFailure::Protocol)?;
    map_connector_output(request, output, limits, sink)
}

fn map_connector_output(
    request: &EngineConnectorRequest,
    output: Value,
    limits: &EngineConnectorLimitsV1,
    sink: &mut dyn EngineConnectorEventSink,
) -> Result<EngineConnectorResult, EngineConnectorFailure> {
    match request.operation() {
        EngineConnectorOperation::ValidateConfig => {
            let validation: EngineConnectorConfigValidationResultV1 =
                serde_json::from_value(output).map_err(|_| EngineConnectorFailure::Protocol)?;
            validation
                .validate()
                .map_err(|_| EngineConnectorFailure::Protocol)?;
            if !validation.valid {
                return Err(EngineConnectorFailure::InvalidRequest);
            }
            Ok(EngineConnectorResult::ValidateConfig)
        }
        EngineConnectorOperation::Test => {
            let test: EngineConnectorTestResultV1 =
                serde_json::from_value(output).map_err(|_| EngineConnectorFailure::Protocol)?;
            test.validate(limits)
                .map_err(|_| EngineConnectorFailure::Protocol)?;
            if !test.ok {
                return Err(EngineConnectorFailure::Unavailable { retryable: false });
            }
            let text = test
                .model
                .unwrap_or_else(|| "connector test succeeded".to_string());
            sink.event(&EngineConnectorEvent::TextDelta { text: text.clone() })?;
            sink.event(&EngineConnectorEvent::Completion)?;
            Ok(EngineConnectorResult::Test {
                completion: ConnectorCompletion {
                    text,
                    usage: AiUsage::default(),
                    elapsed_ms: test.latency_ms,
                },
            })
        }
        EngineConnectorOperation::ModelsList => {
            let catalog: EngineConnectorModelCatalogV1 =
                serde_json::from_value(output).map_err(|_| EngineConnectorFailure::Protocol)?;
            catalog
                .validate(limits)
                .map_err(|_| EngineConnectorFailure::Protocol)?;
            Ok(EngineConnectorResult::ModelsList {
                models: catalog
                    .models
                    .into_iter()
                    .map(|model| EngineConnectorModel {
                        id: model.id,
                        display_name: model.display_name,
                    })
                    .collect(),
            })
        }
        EngineConnectorOperation::Generate => {
            let envelope: SandboxEventEnvelope =
                serde_json::from_value(output).map_err(|_| EngineConnectorFailure::Protocol)?;
            map_sandbox_events(request.request_id(), envelope.events, limits, sink)
        }
    }
}

fn map_sandbox_events(
    request_id: &str,
    events: Vec<EngineConnectorEventV1>,
    limits: &EngineConnectorLimitsV1,
    sink: &mut dyn EngineConnectorEventSink,
) -> Result<EngineConnectorResult, EngineConnectorFailure> {
    if events.len() > limits.max_events as usize {
        return Err(EngineConnectorFailure::ResponseTooLarge);
    }
    let mut sequence = EngineConnectorEventSequenceV1::new(request_id.to_string())
        .map_err(|_| EngineConnectorFailure::Protocol)?;
    let mut streamed = String::new();
    let mut streamed_usage = None;
    let mut completion = None;
    let mut mapped_events = Vec::new();
    for event in events {
        sequence
            .accept(&event, limits)
            .map_err(|_| EngineConnectorFailure::Protocol)?;
        match event {
            EngineConnectorEventV1::Delta { text, .. } => {
                if streamed_usage.is_some() {
                    return Err(EngineConnectorFailure::Protocol);
                }
                streamed.push_str(&text);
                mapped_events.push(EngineConnectorEvent::TextDelta { text });
            }
            EngineConnectorEventV1::Usage { usage, .. } => {
                if streamed_usage.is_some() {
                    return Err(EngineConnectorFailure::Protocol);
                }
                let usage = runtime_usage(usage);
                mapped_events.push(EngineConnectorEvent::Usage {
                    usage: usage.clone(),
                });
                streamed_usage = Some(usage);
            }
            EngineConnectorEventV1::Completed { result, .. } => completion = Some(result),
        }
    }
    if !sequence.is_completed() {
        return Err(EngineConnectorFailure::Protocol);
    }
    let completion = completion.ok_or(EngineConnectorFailure::Protocol)?;
    if completion.output_text.trim().is_empty()
        || (!streamed.is_empty() && streamed != completion.output_text)
    {
        return Err(EngineConnectorFailure::Protocol);
    }
    let completion_usage = completion.usage.map(runtime_usage);
    if completion_usage.is_some() && streamed_usage.is_some() && completion_usage != streamed_usage
    {
        return Err(EngineConnectorFailure::Protocol);
    }
    let usage = completion_usage.or(streamed_usage).unwrap_or_default();
    for event in mapped_events {
        sink.event(&event)?;
    }
    sink.event(&EngineConnectorEvent::Completion)?;
    Ok(EngineConnectorResult::Generate {
        completion: ConnectorCompletion {
            text: completion.output_text,
            usage,
            elapsed_ms: 0,
        },
    })
}

fn runtime_usage(usage: translunar_plugin_runtime::EngineConnectorUsageV1) -> AiUsage {
    AiUsage {
        input_tokens: Some(usage.input_tokens),
        output_tokens: Some(usage.output_tokens),
        ..AiUsage::default()
    }
}

fn map_plugin_error(code: &str, retryable: bool) -> EngineConnectorFailure {
    match code {
        "invalidConfig" | "invalid_config" => EngineConnectorFailure::InvalidRequest,
        "authentication" => EngineConnectorFailure::Authentication,
        "rateLimit" | "rate_limit" => EngineConnectorFailure::RateLimited {
            retry_after_ms: None,
        },
        "timeout" => EngineConnectorFailure::Timeout,
        "unavailable" | "hostCrash" | "host_crash" => {
            EngineConnectorFailure::Unavailable { retryable }
        }
        "responseSize" | "response_size" => EngineConnectorFailure::ResponseTooLarge,
        "cancelled" | "canceled" => EngineConnectorFailure::Canceled,
        _ => EngineConnectorFailure::Protocol,
    }
}

fn map_sandbox_error(error: &SandboxError) -> EngineConnectorFailure {
    match error {
        SandboxError::Cancelled => EngineConnectorFailure::Canceled,
        SandboxError::Timeout => EngineConnectorFailure::Timeout,
        SandboxError::ResourceLimit { .. } => EngineConnectorFailure::ResponseTooLarge,
        SandboxError::QueueFull | SandboxError::NotReady | SandboxError::Disconnected => {
            EngineConnectorFailure::Unavailable { retryable: true }
        }
        SandboxError::Module { .. }
        | SandboxError::Codec { .. }
        | SandboxError::Script { .. }
        | SandboxError::HostMethodUnsupported { .. }
        | SandboxError::HostCallDenied { .. }
        | SandboxError::HostCallFailed { .. }
        | SandboxError::Conflict => EngineConnectorFailure::Protocol,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Default)]
    struct AllowAuthorizer(Mutex<Vec<PluginCapabilityCheck>>);

    impl PluginCapabilityAuthorizer for AllowAuthorizer {
        fn authorize(
            &self,
            check: &PluginCapabilityCheck,
        ) -> Result<(), Box<translunar_plugin_runtime::PluginCapabilityDenial>> {
            self.0
                .lock()
                .expect("authorization log")
                .push(check.clone());
            Ok(())
        }
    }

    #[derive(Debug)]
    struct FixtureTransport {
        response: DeclarativeConnectorHttpResponse,
        request: Mutex<Option<DeclarativeConnectorHttpRequest>>,
    }

    impl DeclarativeConnectorTransport for FixtureTransport {
        fn execute(
            &self,
            request: DeclarativeConnectorHttpRequest,
            _cancellation: &AtomicBool,
        ) -> Result<DeclarativeConnectorHttpResponse, DeclarativeConnectorTransportError> {
            *self.request.lock().expect("transport request") = Some(request);
            Ok(self.response.clone())
        }
    }

    #[derive(Default)]
    struct CollectSink(Vec<EngineConnectorEvent>);

    impl EngineConnectorEventSink for CollectSink {
        fn event(&mut self, event: &EngineConnectorEvent) -> Result<(), EngineConnectorFailure> {
            self.0.push(event.clone());
            Ok(())
        }
    }

    fn declarative_definition() -> DeclarativeEngineConnectorDefinitionV1 {
        DeclarativeEngineConnectorDefinitionV1 {
            definition_version: 1,
            endpoint: translunar_plugin_runtime::DeclarativeConnectorEndpointV1 {
                destination_origin: "http://127.0.0.1:43123".into(),
                url_template: "http://127.0.0.1:43123/v1/chat/completions".into(),
                method: translunar_plugin_runtime::DeclarativeConnectorHttpMethodV1::Post,
            },
            fixed_headers: Vec::new(),
            authentication: DeclarativeConnectorAuthenticationV1::Bearer,
            request: translunar_plugin_runtime::DeclarativeConnectorRequestMappingV1 {
                fixed_body: std::collections::BTreeMap::new(),
                model_path: vec!["model".into()],
                messages_path: vec!["messages".into()],
                source_text_path: Some(vec!["source_text".into()]),
                source_locale_path: Some(vec!["source_locale".into()]),
                target_locale_path: Some(vec!["target_locale".into()]),
                stream_path: Some(vec!["stream".into()]),
            },
            response: DeclarativeConnectorResponseMappingV1::ServerSentEvents {
                delta_path: vec![
                    "choices".into(),
                    "0".into(),
                    "delta".into(),
                    "content".into(),
                ],
                finish_reason_path: None,
                usage: None,
                done_marker: "[DONE]".into(),
                max_line_bytes: 65_536,
            },
            failures: Vec::new(),
        }
    }

    fn adapter_generation_request(request_id: &str, model: &str) -> EngineConnectorRequest {
        EngineConnectorRequest::Generate {
            request: ConnectorGenerationRequest {
                configuration: ConnectorConfigurationRequest {
                    context: translunar_ai_core::ConnectorRequestContext {
                        contract_version: 1,
                        request_id: request_id.into(),
                        deadline_ms: Utc::now().timestamp_millis() + 5_000,
                    },
                    base_url: String::new(),
                    model: model.into(),
                    timeout_ms: 5_000,
                    max_response_bytes: 1_048_576,
                    configuration: serde_json::json!({}),
                },
                messages: vec![translunar_ai_core::AiMessage {
                    role: AiMessageRole::User,
                    text: "source".into(),
                }],
                source_text: "source".into(),
                source_locale: "en-US".into(),
                target_locale: "zh-CN".into(),
            },
        }
    }

    fn empty_schema() -> EngineConnectorConfigSchemaV1 {
        EngineConnectorConfigSchemaV1 {
            schema_version: 1,
            fields: Vec::new(),
        }
    }

    fn sandbox_adapter(source: &str) -> (tempfile::TempDir, Arc<SandboxPluginEngineConnector>) {
        let directory = tempfile::tempdir().expect("sandbox directory");
        std::fs::write(directory.path().join("entry.mjs"), source).expect("sandbox entry");
        let config = translunar_plugin_runtime::SandboxRuntimeConfig::new(
            "org.example.sandbox-connector",
            "version-1",
            1,
            directory.path(),
            "entry.mjs",
            None,
        );
        let authorizer = Arc::new(AllowAuthorizer::default());
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(translunar_plugin_runtime::SandboxHostCallRegistry::default()),
            authorizer.clone(),
        )
        .expect("sandbox worker");
        let connector = SandboxPluginEngineConnector::new(
            PluginConnectorOwner {
                plugin_id: "org.example.sandbox-connector".into(),
                version_id: "version-1".into(),
            },
            "org.example.sandbox-connector.chat".into(),
            empty_schema(),
            EngineConnectorLimitsV1::default(),
            authorizer,
            worker,
        )
        .expect("sandbox adapter");
        (directory, Arc::new(connector))
    }

    fn process_adapter() -> (tempfile::TempDir, Arc<ProcessPluginEngineConnector>) {
        let directory = tempfile::tempdir().expect("process directory");
        let descriptor: translunar_plugin_runtime::EngineConnectorContributionDescriptor =
            serde_json::from_value(serde_json::json!({
                "descriptorVersion": 1,
                "id": "org.example.process-connector.chat",
                "version": "1.0.0",
                "displayName": "Process connector fixture",
                "protocol": translunar_plugin_runtime::ENGINE_CONNECTOR_PROTOCOL_V1,
                "operations": ["validateConfig", "test", "generate"],
                "configSchemaVersion": 1,
                "contractVersion": 1,
                "configSchema": {"schemaVersion": 1, "fields": []},
                "limits": EngineConnectorLimitsV1::default()
            }))
            .expect("process descriptor");
        let connector_json = serde_json::to_string(
            &translunar_plugin_runtime::PluginContributionDescriptor::EngineConnector(
                descriptor.clone(),
            ),
        )
        .expect("serialize process descriptor");
        let source = r#"
          import { createInterface } from "node:readline";
          const connector = __CONNECTOR__;
          const active = new Map();
          const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
          const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
          const event = (params) => write({ jsonrpc: "2.0", method: "connector.event", params });
          const complete = (rpc, request, text) => {
            event({ kind: "delta", contractVersion: 1, requestId: request.requestId, sequence: 0, text });
            event({ kind: "usage", contractVersion: 1, requestId: request.requestId, sequence: 1,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
            event({ kind: "completed", contractVersion: 1, requestId: request.requestId, sequence: 2,
              result: { outputText: text, model: request.model, finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } });
            write({ jsonrpc: "2.0", id: rpc.id, result: { completed: true } });
          };
          rl.on("line", (line) => {
            const rpc = JSON.parse(line);
            if (rpc.method === "plugin.handshake") {
              write({ jsonrpc: "2.0", id: rpc.id, result: {
                apiVersion: 1, pluginId: "org.example.process-connector", contributions: [connector]
              } });
              return;
            }
            if (rpc.method === "plugin.shutdown") {
              write({ jsonrpc: "2.0", id: rpc.id, result: {} });
              setTimeout(() => process.exit(0), 0);
              return;
            }
            if (rpc.method === "connector.cancel") {
              const activeId = active.get(rpc.params.requestId);
              if (activeId !== undefined) {
                active.delete(rpc.params.requestId);
                write({ jsonrpc: "2.0", id: activeId, error: { code: -32000, message: "cancelled" } });
              }
              if (typeof rpc.id === "number") write({ jsonrpc: "2.0", id: rpc.id, result: {} });
              return;
            }
            if (rpc.method !== "connector.generate") return;
            const request = rpc.params.request;
            if (request.model === "failure") {
              write({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "typed fixture failure" } });
              return;
            }
            if (request.model === "cancel") {
              active.set(request.requestId, rpc.id);
              return;
            }
            complete(rpc, request, rpc.params.credential === undefined ? "credential-absent" : "credential-present");
          });
        "#
        .replace("__CONNECTOR__", &connector_json);
        std::fs::write(directory.path().join("entry.mjs"), source).expect("process entry");
        let manifest = translunar_plugin_runtime::PluginManifest {
            manifest_version: 1,
            id: "org.example.process-connector".into(),
            display_name: "Process connector fixture".into(),
            version: "1.0.0".into(),
            api_version: 1,
            api_version_min: 1,
            tier: translunar_plugin_runtime::PluginTier::Process,
            entry: translunar_plugin_runtime::PluginEntry {
                kind: translunar_plugin_runtime::PluginEntryKind::Node,
                path: "entry.mjs".into(),
            },
            contributions: translunar_plugin_runtime::PluginContributions::default(),
            permissions: Vec::new(),
            capabilities: Vec::new(),
        };
        let process = Arc::new(PluginProcess::new_with_connector_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![descriptor],
        ));
        let connector = ProcessPluginEngineConnector::new(
            PluginConnectorOwner {
                plugin_id: "org.example.process-connector".into(),
                version_id: "version-1".into(),
            },
            "org.example.process-connector.chat".into(),
            empty_schema(),
            EngineConnectorLimitsV1::default(),
            Arc::new(AllowAuthorizer::default()),
            process,
        )
        .expect("process adapter");
        (directory, Arc::new(connector))
    }

    #[test]
    fn sandbox_adapter_hands_off_credential_cancels_and_recovers() {
        let source = r#"
          let retainedContext;
          export default {
            invoke(envelope, _host, context) {
              const request = envelope.input;
              if (request.model === "cancel") { while (true) {} }
              const previous = retainedContext === undefined
                ? "first"
                : (Object.hasOwn(retainedContext, "credential") ? "leaked" : "cleared");
              retainedContext = context;
              const credential = context.credential === undefined ? "absent" : "present";
              const requestHasCredential = Object.hasOwn(request, "credential") ? "request-leak" : "request-clean";
              const text = `${credential}:${requestHasCredential}:${previous}`;
              return { protocolVersion: 1, ok: true, output: { events: [
                { kind: "delta", contractVersion: 1, requestId: request.requestId, sequence: 0, text },
                { kind: "usage", contractVersion: 1, requestId: request.requestId, sequence: 1,
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
                { kind: "completed", contractVersion: 1, requestId: request.requestId, sequence: 2,
                  result: { outputText: text, model: request.model, finishReason: "stop",
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } }
              ] } };
            }
          };
        "#;
        let (_directory, connector) = sandbox_adapter(source);
        let secret = "sandbox-ephemeral-secret";
        let credential = SecretString::new(secret.into()).expect("credential");
        let mut sink = CollectSink::default();
        let result = connector
            .invoke(
                &adapter_generation_request("sandbox-credential", "healthy"),
                Some(&credential),
                &AtomicBool::new(false),
                &mut sink,
            )
            .expect("sandbox credential invocation");
        let EngineConnectorResult::Generate { completion } = result else {
            panic!("expected sandbox generation");
        };
        assert_eq!(completion.text, "present:request-clean:first");
        assert_eq!(sink.0.len(), 3);
        assert!(!format!("{connector:?}{completion:?}{:?}", sink.0).contains(secret));

        let mut sink = CollectSink::default();
        let result = connector
            .invoke(
                &adapter_generation_request("sandbox-no-credential", "healthy"),
                None,
                &AtomicBool::new(false),
                &mut sink,
            )
            .expect("sandbox credential is cleared");
        let EngineConnectorResult::Generate { completion } = result else {
            panic!("expected sandbox generation");
        };
        assert_eq!(completion.text, "absent:request-clean:cleared");

        let cancellation = Arc::new(AtomicBool::new(false));
        let invoke_connector = Arc::clone(&connector);
        let invoke_cancellation = Arc::clone(&cancellation);
        let canceled = std::thread::spawn(move || {
            invoke_connector.invoke(
                &adapter_generation_request("sandbox-cancel", "cancel"),
                None,
                invoke_cancellation.as_ref(),
                &mut CollectSink::default(),
            )
        });
        std::thread::sleep(Duration::from_millis(30));
        cancellation.store(true, Ordering::Release);
        assert_eq!(
            canceled.join().expect("sandbox cancellation thread"),
            Err(EngineConnectorFailure::Canceled)
        );

        let mut sink = CollectSink::default();
        assert!(
            connector
                .invoke(
                    &adapter_generation_request("sandbox-after-cancel", "healthy"),
                    None,
                    &AtomicBool::new(false),
                    &mut sink,
                )
                .is_ok()
        );
        connector.shutdown().expect("sandbox shutdown");
    }

    #[test]
    fn process_adapter_maps_ordered_events_cancels_and_stays_healthy() {
        let (_directory, connector) = process_adapter();
        let secret = "process-ephemeral-secret";
        let credential = SecretString::new(secret.into()).expect("credential");
        let mut sink = CollectSink::default();
        let result = connector
            .invoke(
                &adapter_generation_request("process-credential", "healthy"),
                Some(&credential),
                &AtomicBool::new(false),
                &mut sink,
            )
            .expect("process credential invocation");
        let EngineConnectorResult::Generate { completion } = result else {
            panic!("expected process generation");
        };
        assert_eq!(completion.text, "credential-present");
        assert_eq!(
            sink.0,
            vec![
                EngineConnectorEvent::TextDelta {
                    text: "credential-present".into()
                },
                EngineConnectorEvent::Usage {
                    usage: AiUsage {
                        input_tokens: Some(1),
                        output_tokens: Some(1),
                        ..AiUsage::default()
                    }
                },
                EngineConnectorEvent::Completion
            ]
        );
        assert!(!format!("{connector:?}{completion:?}{:?}", sink.0).contains(secret));

        let failure = connector
            .invoke(
                &adapter_generation_request("process-failure", "failure"),
                None,
                &AtomicBool::new(false),
                &mut CollectSink::default(),
            )
            .expect_err("process failure is typed");
        assert_eq!(failure, EngineConnectorFailure::Protocol);

        let cancellation = Arc::new(AtomicBool::new(false));
        let invoke_connector = Arc::clone(&connector);
        let invoke_cancellation = Arc::clone(&cancellation);
        let canceled = std::thread::spawn(move || {
            invoke_connector.invoke(
                &adapter_generation_request("process-cancel", "cancel"),
                None,
                invoke_cancellation.as_ref(),
                &mut CollectSink::default(),
            )
        });
        std::thread::sleep(Duration::from_millis(40));
        cancellation.store(true, Ordering::Release);
        assert_eq!(
            canceled.join().expect("process cancellation thread"),
            Err(EngineConnectorFailure::Canceled)
        );

        let mut healthy_sink = CollectSink::default();
        let healthy = connector
            .invoke(
                &adapter_generation_request("process-after-errors", "healthy"),
                None,
                &AtomicBool::new(false),
                &mut healthy_sink,
            )
            .expect("process remains healthy");
        let EngineConnectorResult::Generate { completion } = healthy else {
            panic!("expected process generation");
        };
        assert_eq!(completion.text, "credential-absent");
        connector.shutdown().expect("process shutdown");
    }

    #[test]
    fn declarative_adapter_authorizes_origin_and_maps_bounded_stream() {
        let response_body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"translated\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let transport = Arc::new(FixtureTransport {
            response: DeclarativeConnectorHttpResponse {
                status: 200,
                final_url: "http://127.0.0.1:43123/v1/chat/completions".into(),
                content_type: Some("text/event-stream".into()),
                body: response_body.as_bytes().to_vec(),
                retry_after_ms: None,
            },
            request: Mutex::new(None),
        });
        let authorizer = Arc::new(AllowAuthorizer::default());
        let connector = DeclarativePluginEngineConnector::new(
            PluginConnectorOwner {
                plugin_id: "org.example.connector".into(),
                version_id: "version-1".into(),
            },
            "org.example.connector.chat".into(),
            EngineConnectorConfigSchemaV1 {
                schema_version: 1,
                fields: Vec::new(),
            },
            EngineConnectorLimitsV1::default(),
            declarative_definition(),
            authorizer.clone(),
            transport.clone(),
        )
        .expect("declarative connector");
        let request = EngineConnectorRequest::Generate {
            request: ConnectorGenerationRequest {
                configuration: ConnectorConfigurationRequest {
                    context: translunar_ai_core::ConnectorRequestContext {
                        contract_version: 1,
                        request_id: "request-1".into(),
                        deadline_ms: Utc::now().timestamp_millis() + 5_000,
                    },
                    base_url: String::new(),
                    model: "fixture-model".into(),
                    timeout_ms: 5_000,
                    max_response_bytes: 1_048_576,
                    configuration: serde_json::json!({}),
                },
                messages: vec![translunar_ai_core::AiMessage {
                    role: AiMessageRole::User,
                    text: "source".into(),
                }],
                source_text: "source".into(),
                source_locale: "en-US".into(),
                target_locale: "zh-CN".into(),
            },
        };
        let credential = SecretString::new("fixture-secret".into()).expect("credential");
        let mut sink = CollectSink::default();
        let result = connector
            .invoke(
                &request,
                Some(&credential),
                &AtomicBool::new(false),
                &mut sink,
            )
            .expect("invoke declarative connector");
        let EngineConnectorResult::Generate { completion } = result else {
            panic!("expected generation result");
        };
        assert_eq!(completion.text, "translated");
        assert_eq!(sink.0.last(), Some(&EngineConnectorEvent::Completion));

        let checks = authorizer.0.lock().expect("authorization checks");
        assert_eq!(checks.len(), 2);
        assert_eq!(checks[0].capability_id, PluginCapabilityId::EngineConnector);
        assert_eq!(checks[1].capability_id, PluginCapabilityId::NetworkConnect);
        assert_eq!(
            checks[1].scope,
            PluginCapabilityScope::Network {
                origins: vec!["http://127.0.0.1:43123".into()]
            }
        );
        drop(checks);

        let mut transport_request = transport.request.lock().expect("transport request");
        let sent = transport_request.take().expect("captured request");
        assert!(sent.headers.iter().any(|(name, value)| {
            name.eq_ignore_ascii_case("authorization") && value == "Bearer fixture-secret"
        }));
        assert!(!format!("{sent:?}").contains("fixture-secret"));
        let body: Value = serde_json::from_slice(&sent.body).expect("request body");
        assert_eq!(body["model"], "fixture-model");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["content"], "source");
    }

    #[test]
    fn origin_normalization_and_url_containment_fail_closed() {
        assert_eq!(
            normalize_origin("https://EXAMPLE.com").expect("normalized origin"),
            "https://example.com"
        );
        assert_eq!(
            normalize_origin("https://example.com:443").expect("default port normalization"),
            "https://example.com"
        );
        assert_eq!(
            normalize_origin("http://127.0.0.1:43123").expect("loopback origin"),
            "http://127.0.0.1:43123"
        );
        assert!(normalize_origin("http://example.com").is_err());
        assert!(
            ensure_url_in_origin("https://example.com.evil.test/v1", "https://example.com")
                .is_err()
        );
    }

    #[test]
    fn request_paths_do_not_overwrite_fixed_body_fields() {
        let mut value = serde_json::json!({ "model": "fixed" });
        assert!(
            set_json_path(
                &mut value,
                &["model".to_string()],
                Value::String("new".into())
            )
            .is_err()
        );
        let mut value = serde_json::json!({});
        set_json_path(
            &mut value,
            &["request".to_string(), "model".to_string()],
            Value::String("model-1".into()),
        )
        .expect("insert nested path");
        assert_eq!(
            value,
            serde_json::json!({ "request": { "model": "model-1" } })
        );
    }

    #[test]
    fn sse_mapping_rejects_late_frames_and_preserves_usage() {
        #[derive(Default)]
        struct Sink(Vec<EngineConnectorEvent>);
        impl EngineConnectorEventSink for Sink {
            fn event(
                &mut self,
                event: &EngineConnectorEvent,
            ) -> Result<(), EngineConnectorFailure> {
                self.0.push(event.clone());
                Ok(())
            }
        }
        let delta = vec![
            "choices".into(),
            "0".into(),
            "delta".into(),
            "content".into(),
        ];
        let usage = DeclarativeConnectorUsageMappingV1 {
            input_tokens_path: Some(vec!["usage".into(), "prompt_tokens".into()]),
            output_tokens_path: Some(vec!["usage".into(), "completion_tokens".into()]),
            total_tokens_path: Some(vec!["usage".into(), "total_tokens".into()]),
        };
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n",
            "data: {\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\n",
            "data: [DONE]\n\n"
        );
        let mut sink = Sink::default();
        let (text, mapped) = map_sse(
            body.as_bytes(),
            &delta,
            None,
            Some(&usage),
            "[DONE]",
            65_536,
            &mut sink,
        )
        .expect("map fixture stream");
        assert_eq!(text, "ok");
        assert_eq!(mapped.input_tokens, Some(2));
        assert_eq!(mapped.output_tokens, Some(1));
        assert_eq!(sink.0.len(), 2);

        let late =
            format!("{body}data: {{\"choices\":[{{\"delta\":{{\"content\":\"late\"}}}}]}}\n\n");
        let mut late_sink = Sink::default();
        assert!(
            map_sse(
                late.as_bytes(),
                &delta,
                None,
                Some(&usage),
                "[DONE]",
                65_536,
                &mut late_sink,
            )
            .is_err()
        );
        assert!(late_sink.0.is_empty());
    }

    #[test]
    fn reqwest_transport_forbids_redirects_and_enforces_response_limit() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        fn serve(response: &'static str) -> String {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
            let address = listener.local_addr().expect("fixture address");
            std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept request");
                let mut reader = BufReader::new(stream.try_clone().expect("clone request"));
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).expect("read request");
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                stream
                    .write_all(response.as_bytes())
                    .expect("write response");
            });
            format!("http://{address}/v1")
        }

        let url = serve(concat!(
            "HTTP/1.1 302 Found\r\n",
            "Location: http://127.0.0.1:9/forbidden\r\n",
            "Content-Length: 0\r\nConnection: close\r\n\r\n"
        ));
        let response = ReqwestDeclarativeConnectorTransport
            .execute(
                DeclarativeConnectorHttpRequest {
                    url: url.clone(),
                    headers: Vec::new(),
                    body: Vec::new(),
                    timeout: Duration::from_secs(2),
                    max_response_bytes: 1024,
                },
                &AtomicBool::new(false),
            )
            .expect("redirect response");
        assert_eq!(response.status, 302);
        assert_eq!(response.final_url, url);

        let url = serve(concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Length: 10\r\nConnection: close\r\n\r\n",
            "0123456789"
        ));
        assert_eq!(
            ReqwestDeclarativeConnectorTransport.execute(
                DeclarativeConnectorHttpRequest {
                    url,
                    headers: Vec::new(),
                    body: Vec::new(),
                    timeout: Duration::from_secs(2),
                    max_response_bytes: 4,
                },
                &AtomicBool::new(false),
            ),
            Err(DeclarativeConnectorTransportError::ResponseTooLarge)
        );
    }

    #[test]
    fn transport_request_debug_redacts_headers_and_body() {
        let request = DeclarativeConnectorHttpRequest {
            url: "https://example.com/v1".into(),
            headers: vec![("authorization".into(), "Bearer secret".into())],
            body: br#"{\"secret\":\"value\"}"#.to_vec(),
            timeout: Duration::from_secs(1),
            max_response_bytes: 1024,
        };
        let debug = format!("{request:?}");
        assert!(!debug.contains("Bearer secret"));
        assert!(!debug.contains("value"));

        let response = DeclarativeConnectorHttpResponse {
            status: 200,
            final_url: "https://example.com/v1".into(),
            content_type: Some("application/json".into()),
            body: b"sensitive response".to_vec(),
            retry_after_ms: None,
        };
        let debug = format!("{response:?}");
        assert!(!debug.contains("sensitive response"));
    }
}
