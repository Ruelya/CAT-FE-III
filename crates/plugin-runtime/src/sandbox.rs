use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rquickjs::function::This;
use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::{Context, Ctx, Function, Module, Object, Persistent, Promise, Runtime};
use rquickjs::{Error as JsError, Value as JsValue};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use translunar_filter_core::{
    DocumentFilter, ExportReport, ExportRequest, FilterDescriptor, FilterError, FilterEventStream,
    ImportRequest, PluginSandboxFailureKind, ProbeResult, ValidationReport,
    publish_bytes_noclobber,
};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{
    MAX_CONNECTOR_CREDENTIAL_BYTES, PluginCapabilityAuthorizer, PluginCapabilityCheck,
    PluginCapabilityDenialCode, PluginCapabilityId, PluginCapabilityScope, PluginFileArea,
    PluginFilterEvent,
};

pub const SANDBOX_PROTOCOL_VERSION: u32 = 1;
pub const SANDBOX_HEAP_BYTES: usize = 32 * 1024 * 1024;
pub const SANDBOX_STACK_BYTES: usize = 512 * 1024;
pub const SANDBOX_INITIALIZATION_MILLIS: u64 = 1_000;
pub const SANDBOX_INVOCATION_MILLIS: u64 = 2_000;
pub const SANDBOX_SHUTDOWN_MILLIS: u64 = 500;
pub const SANDBOX_MODULE_BYTES: usize = 1024 * 1024;
pub const SANDBOX_MODULE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
pub const SANDBOX_MODULE_COUNT: usize = 128;
pub const SANDBOX_QUEUE_CAPACITY: usize = 32;
pub const SANDBOX_INVOCATION_JSON_BYTES: usize = 1024 * 1024;
pub const SANDBOX_HOST_CALL_JSON_BYTES: usize = 256 * 1024;
pub const SANDBOX_JSON_DEPTH: usize = 16;
pub const SANDBOX_HOST_CALLS_PER_INVOCATION: usize = 256;
pub const SANDBOX_DIAGNOSTIC_BYTES: usize = 4 * 1024;
const MAX_BOUNDARY_ID_BYTES: usize = 128;
const MAX_OPERATION_BYTES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxLimits {
    pub heap_bytes: usize,
    pub stack_bytes: usize,
    pub initialization: Duration,
    pub invocation: Duration,
    pub shutdown: Duration,
    pub module_bytes: usize,
    pub module_total_bytes: usize,
    pub module_count: usize,
    pub queue_capacity: usize,
    pub invocation_json_bytes: usize,
    pub host_call_json_bytes: usize,
    pub json_depth: usize,
    pub host_calls_per_invocation: usize,
    pub diagnostic_bytes: usize,
}

pub const DEFAULT_SANDBOX_LIMITS: SandboxLimits = SandboxLimits {
    heap_bytes: SANDBOX_HEAP_BYTES,
    stack_bytes: SANDBOX_STACK_BYTES,
    initialization: Duration::from_millis(SANDBOX_INITIALIZATION_MILLIS),
    invocation: Duration::from_millis(SANDBOX_INVOCATION_MILLIS),
    shutdown: Duration::from_millis(SANDBOX_SHUTDOWN_MILLIS),
    module_bytes: SANDBOX_MODULE_BYTES,
    module_total_bytes: SANDBOX_MODULE_TOTAL_BYTES,
    module_count: SANDBOX_MODULE_COUNT,
    queue_capacity: SANDBOX_QUEUE_CAPACITY,
    invocation_json_bytes: SANDBOX_INVOCATION_JSON_BYTES,
    host_call_json_bytes: SANDBOX_HOST_CALL_JSON_BYTES,
    json_depth: SANDBOX_JSON_DEPTH,
    host_calls_per_invocation: SANDBOX_HOST_CALLS_PER_INVOCATION,
    diagnostic_bytes: SANDBOX_DIAGNOSTIC_BYTES,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SandboxFailureKind {
    Cancelled,
    Timeout,
    ResourceLimit,
    Module,
    Codec,
    Script,
    HostCall,
    Disconnected,
    InvalidState,
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum SandboxError {
    #[error("sandbox operation was cancelled")]
    Cancelled,
    #[error("sandbox operation exceeded its wall-clock deadline")]
    Timeout,
    #[error("sandbox resource limit exceeded: {resource} ({actual} > {limit})")]
    ResourceLimit {
        resource: &'static str,
        limit: usize,
        actual: usize,
    },
    #[error("sandbox module graph was rejected: {reason}")]
    Module { reason: &'static str },
    #[error("sandbox JSON boundary was rejected: {reason}")]
    Codec { reason: &'static str },
    #[error("sandbox script failed during {stage}")]
    Script { stage: &'static str },
    #[error("sandbox host method is unsupported: {method}")]
    HostMethodUnsupported { method: String },
    #[error("sandbox host call was denied: {method} ({code:?})")]
    HostCallDenied {
        method: String,
        code: PluginCapabilityDenialCode,
    },
    #[error("sandbox host call failed: {method}")]
    HostCallFailed { method: String },
    #[error("sandbox worker queue is full")]
    QueueFull,
    #[error("sandbox worker is not ready")]
    NotReady,
    #[error("sandbox worker disconnected")]
    Disconnected,
    #[error("sandbox runtime already exists")]
    Conflict,
}

impl SandboxError {
    pub const fn failure_kind(&self) -> SandboxFailureKind {
        match self {
            Self::Cancelled => SandboxFailureKind::Cancelled,
            Self::Timeout => SandboxFailureKind::Timeout,
            Self::ResourceLimit { .. } | Self::QueueFull => SandboxFailureKind::ResourceLimit,
            Self::Module { .. } => SandboxFailureKind::Module,
            Self::Codec { .. } => SandboxFailureKind::Codec,
            Self::Script { .. } => SandboxFailureKind::Script,
            Self::HostMethodUnsupported { .. }
            | Self::HostCallDenied { .. }
            | Self::HostCallFailed { .. } => SandboxFailureKind::HostCall,
            Self::Disconnected => SandboxFailureKind::Disconnected,
            Self::NotReady | Self::Conflict => SandboxFailureKind::InvalidState,
        }
    }

    fn is_fatal(&self) -> bool {
        matches!(
            self,
            Self::Timeout
                | Self::ResourceLimit { .. }
                | Self::Module { .. }
                | Self::Codec {
                    reason: "output" | "plugin result"
                }
                | Self::Script { .. }
                | Self::Disconnected
        )
    }
}

pub type SandboxResult<T> = std::result::Result<T, SandboxError>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxLifecycleContextV1 {
    pub protocol_version: u32,
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxInvocationV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub contribution_id: String,
    pub operation: String,
    pub input: Value,
}

struct SandboxEphemeralCredential(String);

impl SandboxEphemeralCredential {
    fn new(value: &str) -> SandboxResult<Self> {
        if value.len() > MAX_CONNECTOR_CREDENTIAL_BYTES {
            return Err(SandboxError::ResourceLimit {
                resource: "credential bytes",
                limit: MAX_CONNECTOR_CREDENTIAL_BYTES,
                actual: value.len(),
            });
        }
        if value.contains('\0') {
            return Err(SandboxError::Codec {
                reason: "invocation context",
            });
        }
        Ok(Self(value.to_string()))
    }

    fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SandboxEphemeralCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SandboxEphemeralCredential([REDACTED])")
    }
}

impl Drop for SandboxEphemeralCredential {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

struct SandboxInvocationEnvelope {
    request: SandboxInvocationV1,
    credentials: BTreeMap<String, SandboxEphemeralCredential>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxPluginErrorV1 {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxResultV1 {
    pub protocol_version: u32,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<SandboxPluginErrorV1>,
}

impl SandboxResultV1 {
    fn validate(&self, limits: SandboxLimits) -> SandboxResult<()> {
        if self.protocol_version != SANDBOX_PROTOCOL_VERSION
            || self.ok == self.error.is_some()
            || self.ok != self.output.is_some()
        {
            return Err(SandboxError::Codec {
                reason: "plugin result",
            });
        }
        if let Some(output) = &self.output {
            validate_json(
                output,
                limits.invocation_json_bytes,
                limits.json_depth,
                "output",
            )?;
        }
        if let Some(error) = &self.error {
            validate_boundary_text(&error.code, MAX_BOUNDARY_ID_BYTES, "plugin result")?;
            validate_boundary_text(&error.message, limits.diagnostic_bytes, "plugin result")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxHostCallV1 {
    pub protocol_version: u32,
    pub request_id: String,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxHostCallContext {
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: i64,
    pub contribution_id: String,
    pub invocation_id: String,
    pub operation: String,
}

type ScopeDeriver = dyn Fn(&Value) -> SandboxResult<PluginCapabilityScope> + Send + Sync + 'static;
type HostHandler =
    dyn Fn(&SandboxHostCallContext, Value) -> SandboxResult<Value> + Send + Sync + 'static;

#[derive(Clone)]
pub struct SandboxHostMethod {
    method: String,
    capability_id: PluginCapabilityId,
    operations: BTreeSet<String>,
    contributions: BTreeSet<String>,
    derive_scope: Arc<ScopeDeriver>,
    handler: Arc<HostHandler>,
}

impl fmt::Debug for SandboxHostMethod {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SandboxHostMethod")
            .field("method", &self.method)
            .field("capability_id", &self.capability_id)
            .field("operations", &self.operations)
            .field("contributions", &self.contributions)
            .finish_non_exhaustive()
    }
}

impl SandboxHostMethod {
    pub fn new(
        method: impl Into<String>,
        capability_id: PluginCapabilityId,
        scope: PluginCapabilityScope,
        operations: impl IntoIterator<Item = String>,
        handler: impl Fn(&SandboxHostCallContext, Value) -> SandboxResult<Value> + Send + Sync + 'static,
    ) -> SandboxResult<Self> {
        let method = method.into();
        validate_boundary_text(&method, MAX_OPERATION_BYTES, "host method")?;
        let operations = operations.into_iter().collect::<BTreeSet<_>>();
        if operations.is_empty()
            || operations.iter().any(|value| {
                validate_boundary_text(value, MAX_OPERATION_BYTES, "operation").is_err()
            })
        {
            return Err(SandboxError::Codec {
                reason: "operation",
            });
        }
        Ok(Self {
            method,
            capability_id,
            operations,
            contributions: BTreeSet::new(),
            derive_scope: Arc::new(move |_| Ok(scope.clone())),
            handler: Arc::new(handler),
        })
    }

    pub fn with_contributions(
        mut self,
        contributions: impl IntoIterator<Item = String>,
    ) -> SandboxResult<Self> {
        self.contributions = contributions.into_iter().collect();
        if self.contributions.iter().any(|value| {
            validate_boundary_text(value, MAX_BOUNDARY_ID_BYTES, "contribution id").is_err()
        }) {
            return Err(SandboxError::Codec {
                reason: "contribution id",
            });
        }
        Ok(self)
    }

    pub fn with_scope_deriver(
        mut self,
        derive_scope: impl Fn(&Value) -> SandboxResult<PluginCapabilityScope> + Send + Sync + 'static,
    ) -> Self {
        self.derive_scope = Arc::new(derive_scope);
        self
    }
}

#[derive(Debug, Default)]
pub struct SandboxHostCallRegistry {
    methods: RwLock<BTreeMap<String, SandboxHostMethod>>,
}

impl SandboxHostCallRegistry {
    pub fn register(&self, method: SandboxHostMethod) -> SandboxResult<()> {
        let mut methods = self
            .methods
            .write()
            .map_err(|_| SandboxError::HostCallFailed {
                method: method.method.clone(),
            })?;
        if methods.contains_key(&method.method) {
            return Err(SandboxError::Conflict);
        }
        methods.insert(method.method.clone(), method);
        Ok(())
    }

    pub fn unregister(&self, method: &str) -> bool {
        self.methods
            .write()
            .map(|mut methods| methods.remove(method).is_some())
            .unwrap_or(false)
    }

    fn method(&self, name: &str) -> SandboxResult<SandboxHostMethod> {
        self.methods
            .read()
            .map_err(|_| SandboxError::HostCallFailed {
                method: name.to_string(),
            })?
            .get(name)
            .cloned()
            .ok_or_else(|| SandboxError::HostMethodUnsupported {
                method: name.to_string(),
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SandboxRuntimeKey {
    pub plugin_id: String,
    pub version_id: String,
}

#[derive(Debug, Clone)]
pub struct SandboxRuntimeConfig {
    pub key: SandboxRuntimeKey,
    pub activation_revision: i64,
    pub package_root: PathBuf,
    pub entry_path: String,
    pub export_name: String,
    pub expected_package_hash: Option<String>,
    pub limits: SandboxLimits,
}

impl SandboxRuntimeConfig {
    pub fn new(
        plugin_id: impl Into<String>,
        version_id: impl Into<String>,
        activation_revision: i64,
        package_root: impl Into<PathBuf>,
        entry_path: impl Into<String>,
        export_name: Option<String>,
    ) -> Self {
        Self {
            key: SandboxRuntimeKey {
                plugin_id: plugin_id.into(),
                version_id: version_id.into(),
            },
            activation_revision,
            package_root: package_root.into(),
            entry_path: entry_path.into(),
            export_name: export_name.unwrap_or_else(|| "default".to_string()),
            expected_package_hash: None,
            limits: DEFAULT_SANDBOX_LIMITS,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SandboxCancellationToken(Arc<AtomicBool>);

impl SandboxCancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SandboxWorkerState {
    Created = 0,
    Initializing = 1,
    Ready = 2,
    Stopping = 3,
    Stopped = 4,
    Failed = 5,
}

impl SandboxWorkerState {
    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Created,
            1 => Self::Initializing,
            2 => Self::Ready,
            3 => Self::Stopping,
            4 => Self::Stopped,
            _ => Self::Failed,
        }
    }
}

#[derive(Debug)]
struct ActiveInterrupt {
    deadline: Instant,
    cancellation: SandboxCancellationToken,
}

#[derive(Debug, Default)]
struct InterruptState {
    active: Mutex<Option<ActiveInterrupt>>,
    stopping: AtomicBool,
}

impl InterruptState {
    fn begin(&self, deadline: Instant, cancellation: SandboxCancellationToken) {
        if let Ok(mut active) = self.active.lock() {
            *active = Some(ActiveInterrupt {
                deadline,
                cancellation,
            });
        }
    }

    fn clear(&self) {
        if let Ok(mut active) = self.active.lock() {
            *active = None;
        }
    }

    fn reason(&self) -> Option<SandboxError> {
        if self.stopping.load(Ordering::Acquire) {
            return Some(SandboxError::Cancelled);
        }
        let active = self.active.lock().ok()?;
        let active = active.as_ref()?;
        if active.cancellation.is_cancelled() {
            Some(SandboxError::Cancelled)
        } else if Instant::now() >= active.deadline {
            Some(SandboxError::Timeout)
        } else {
            None
        }
    }

    fn should_interrupt(&self) -> bool {
        self.reason().is_some()
    }
}

enum WorkerRequest {
    Invoke {
        envelope: SandboxInvocationEnvelope,
        cancellation: SandboxCancellationToken,
        deadline: Instant,
        reply: SyncSender<SandboxResult<SandboxResultV1>>,
    },
    Shutdown {
        reply: SyncSender<()>,
    },
}

struct SandboxWorkerInner {
    key: SandboxRuntimeKey,
    sender: SyncSender<WorkerRequest>,
    state: Arc<AtomicU8>,
    interrupt: Arc<InterruptState>,
    join: Mutex<Option<JoinHandle<()>>>,
    limits: SandboxLimits,
}

impl fmt::Debug for SandboxWorkerInner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SandboxWorkerInner")
            .field("key", &self.key)
            .field(
                "state",
                &SandboxWorkerState::from_u8(self.state.load(Ordering::Acquire)),
            )
            .finish_non_exhaustive()
    }
}

impl Drop for SandboxWorkerInner {
    fn drop(&mut self) {
        self.interrupt.stopping.store(true, Ordering::Release);
        let (reply, response) = mpsc::sync_channel(1);
        let _ = self.sender.try_send(WorkerRequest::Shutdown { reply });
        if response.recv_timeout(self.limits.shutdown).is_ok() {
            if let Ok(join) = self.join.get_mut()
                && let Some(join) = join.take()
            {
                let _ = join.join();
            }
        } else if let Ok(join) = self.join.get_mut() {
            let _ = join.take();
        }
    }
}

#[derive(Debug, Clone)]
pub struct SandboxWorkerHandle(Arc<SandboxWorkerInner>);

impl SandboxWorkerHandle {
    pub fn spawn(
        config: SandboxRuntimeConfig,
        host_calls: Arc<SandboxHostCallRegistry>,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> SandboxResult<Self> {
        validate_config(&config)?;
        let (sender, receiver) = mpsc::sync_channel(config.limits.queue_capacity);
        let (init_sender, init_receiver) = mpsc::sync_channel(1);
        let state = Arc::new(AtomicU8::new(SandboxWorkerState::Initializing as u8));
        let interrupt = Arc::new(InterruptState::default());
        let thread_state = Arc::clone(&state);
        let thread_interrupt = Arc::clone(&interrupt);
        let thread_config = config.clone();
        let thread_name = bounded_thread_name(&config.key.plugin_id);
        let join = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                worker_main(
                    thread_config,
                    receiver,
                    init_sender,
                    thread_state,
                    thread_interrupt,
                    host_calls,
                    authorizer,
                );
            })
            .map_err(|_| SandboxError::Disconnected)?;

        match init_receiver.recv_timeout(config.limits.initialization) {
            Ok(Ok(())) => Ok(Self(Arc::new(SandboxWorkerInner {
                key: config.key,
                sender,
                state,
                interrupt,
                join: Mutex::new(Some(join)),
                limits: config.limits,
            }))),
            Ok(Err(error)) => {
                interrupt.stopping.store(true, Ordering::Release);
                let _ = join.join();
                Err(error)
            }
            Err(_) => {
                interrupt.stopping.store(true, Ordering::Release);
                Err(SandboxError::Timeout)
            }
        }
    }

    pub fn key(&self) -> &SandboxRuntimeKey {
        &self.0.key
    }

    pub fn state(&self) -> SandboxWorkerState {
        SandboxWorkerState::from_u8(self.0.state.load(Ordering::Acquire))
    }

    pub fn invoke(&self, request: SandboxInvocationV1) -> SandboxResult<SandboxResultV1> {
        self.invoke_with_credential_and_cancellation(
            request,
            None,
            SandboxCancellationToken::default(),
        )
    }

    pub fn invoke_with_credential(
        &self,
        request: SandboxInvocationV1,
        credential: Option<&str>,
    ) -> SandboxResult<SandboxResultV1> {
        self.invoke_with_credential_and_cancellation(
            request,
            credential,
            SandboxCancellationToken::default(),
        )
    }

    pub fn invoke_with_credentials_and_cancellation(
        &self,
        request: SandboxInvocationV1,
        credentials: &BTreeMap<String, String>,
        timeout: Duration,
        cancellation: SandboxCancellationToken,
    ) -> SandboxResult<SandboxResultV1> {
        let credentials = credentials
            .iter()
            .map(|(key, value)| Ok((key.clone(), SandboxEphemeralCredential::new(value)?)))
            .collect::<SandboxResult<BTreeMap<_, _>>>()?;
        self.invoke_with_ephemeral_credentials(request, credentials, timeout, cancellation)
    }

    pub fn invoke_with_cancellation(
        &self,
        request: SandboxInvocationV1,
        cancellation: SandboxCancellationToken,
    ) -> SandboxResult<SandboxResultV1> {
        self.invoke_with_credential_and_cancellation(request, None, cancellation)
    }

    pub fn invoke_with_timeout_and_cancellation(
        &self,
        request: SandboxInvocationV1,
        timeout: Duration,
        cancellation: SandboxCancellationToken,
    ) -> SandboxResult<SandboxResultV1> {
        self.invoke_with_credential_timeout_and_cancellation(request, None, timeout, cancellation)
    }

    pub fn invoke_with_credential_and_cancellation(
        &self,
        request: SandboxInvocationV1,
        credential: Option<&str>,
        cancellation: SandboxCancellationToken,
    ) -> SandboxResult<SandboxResultV1> {
        self.invoke_with_credential_timeout_and_cancellation(
            request,
            credential,
            self.0.limits.invocation,
            cancellation,
        )
    }

    fn invoke_with_credential_timeout_and_cancellation(
        &self,
        request: SandboxInvocationV1,
        credential: Option<&str>,
        timeout: Duration,
        cancellation: SandboxCancellationToken,
    ) -> SandboxResult<SandboxResultV1> {
        if timeout.is_zero() {
            return Err(SandboxError::Timeout);
        }
        if self.state() != SandboxWorkerState::Ready {
            return Err(SandboxError::NotReady);
        }
        validate_invocation(&request, self.0.limits)?;
        let credential = credential
            .map(SandboxEphemeralCredential::new)
            .transpose()?;
        let credentials = credential
            .map(|value| BTreeMap::from([("credential".to_string(), value)]))
            .unwrap_or_default();
        self.invoke_with_ephemeral_credentials(request, credentials, timeout, cancellation)
    }

    fn invoke_with_ephemeral_credentials(
        &self,
        request: SandboxInvocationV1,
        credentials: BTreeMap<String, SandboxEphemeralCredential>,
        timeout: Duration,
        cancellation: SandboxCancellationToken,
    ) -> SandboxResult<SandboxResultV1> {
        if cancellation.is_cancelled() {
            return Err(SandboxError::Cancelled);
        }
        let deadline = Instant::now() + timeout.min(self.0.limits.invocation);
        let (reply, response) = mpsc::sync_channel(1);
        self.0
            .sender
            .try_send(WorkerRequest::Invoke {
                envelope: SandboxInvocationEnvelope {
                    request,
                    credentials,
                },
                cancellation: cancellation.clone(),
                deadline,
                reply,
            })
            .map_err(|error| match error {
                TrySendError::Full(_) => SandboxError::QueueFull,
                TrySendError::Disconnected(_) => SandboxError::Disconnected,
            })?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        match response.recv_timeout(remaining) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                cancellation.cancel();
                self.0
                    .state
                    .store(SandboxWorkerState::Failed as u8, Ordering::Release);
                Err(SandboxError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(SandboxError::Disconnected),
        }
    }

    pub fn shutdown(&self) -> SandboxResult<()> {
        loop {
            let current = self.0.state.load(Ordering::Acquire);
            if matches!(
                SandboxWorkerState::from_u8(current),
                SandboxWorkerState::Stopped | SandboxWorkerState::Stopping
            ) {
                return Ok(());
            }
            if self
                .0
                .state
                .compare_exchange(
                    current,
                    SandboxWorkerState::Stopping as u8,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
            {
                break;
            }
        }
        self.0.interrupt.stopping.store(true, Ordering::Release);
        let (reply, response) = mpsc::sync_channel(1);
        match self.0.sender.try_send(WorkerRequest::Shutdown { reply }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(SandboxError::QueueFull),
            Err(TrySendError::Disconnected(_)) => return Err(SandboxError::Disconnected),
        }
        response
            .recv_timeout(self.0.limits.shutdown)
            .map_err(|_| SandboxError::Timeout)?;
        if let Ok(mut join) = self.0.join.lock()
            && let Some(join) = join.take()
        {
            join.join().map_err(|_| SandboxError::Disconnected)?;
        }
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct SandboxRuntimeRegistry {
    workers: Mutex<BTreeMap<SandboxRuntimeKey, SandboxWorkerHandle>>,
}

impl SandboxRuntimeRegistry {
    pub fn prepare(
        &self,
        config: SandboxRuntimeConfig,
        host_calls: Arc<SandboxHostCallRegistry>,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> SandboxResult<SandboxWorkerHandle> {
        if self
            .workers
            .lock()
            .map_err(|_| SandboxError::Disconnected)?
            .contains_key(&config.key)
        {
            return Err(SandboxError::Conflict);
        }
        SandboxWorkerHandle::spawn(config, host_calls, authorizer)
    }

    pub fn attach(&self, worker: SandboxWorkerHandle) -> SandboxResult<()> {
        let mut workers = self
            .workers
            .lock()
            .map_err(|_| SandboxError::Disconnected)?;
        if workers.contains_key(worker.key()) {
            return Err(SandboxError::Conflict);
        }
        workers.insert(worker.key().clone(), worker);
        Ok(())
    }

    pub fn get(&self, key: &SandboxRuntimeKey) -> Option<SandboxWorkerHandle> {
        self.workers.lock().ok()?.get(key).cloned()
    }

    pub fn detach(&self, key: &SandboxRuntimeKey) -> SandboxResult<bool> {
        let worker = self
            .workers
            .lock()
            .map_err(|_| SandboxError::Disconnected)?
            .remove(key);
        let Some(worker) = worker else {
            return Ok(false);
        };
        worker.shutdown()?;
        Ok(true)
    }

    pub fn len(&self) -> usize {
        self.workers
            .lock()
            .map(|workers| workers.len())
            .unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug)]
pub struct SandboxDocumentFilter {
    worker: SandboxWorkerHandle,
    descriptor: FilterDescriptor,
    plugin_id: String,
    version_id: String,
    activation_revision: u64,
    contribution_id: String,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl SandboxDocumentFilter {
    pub fn new(
        worker: SandboxWorkerHandle,
        descriptor: FilterDescriptor,
        plugin_id: impl Into<String>,
        version_id: impl Into<String>,
        activation_revision: u64,
        contribution_id: impl Into<String>,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> SandboxResult<Self> {
        let plugin_id = plugin_id.into();
        let version_id = version_id.into();
        let contribution_id = contribution_id.into();
        validate_boundary_text(&plugin_id, MAX_BOUNDARY_ID_BYTES, "plugin id")?;
        validate_boundary_text(&version_id, MAX_BOUNDARY_ID_BYTES, "version id")?;
        validate_boundary_text(&contribution_id, MAX_BOUNDARY_ID_BYTES, "contribution id")?;
        if descriptor.id != contribution_id {
            return Err(SandboxError::Codec {
                reason: "contribution id",
            });
        }
        Ok(Self {
            worker,
            descriptor,
            plugin_id,
            version_id,
            activation_revision,
            contribution_id,
            authorizer,
        })
    }

    fn authorize(
        &self,
        capability_id: PluginCapabilityId,
        scope: PluginCapabilityScope,
        operation: &str,
    ) -> Result<(), FilterError> {
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.plugin_id.clone(),
                version_id: self.version_id.clone(),
                capability_id,
                scope,
                operation: operation.to_string(),
                contribution_id: Some(self.contribution_id.clone()),
            })
            .map_err(|denial| FilterError::PluginSandboxFailed {
                plugin_id: self.plugin_id.clone(),
                filter_id: self.descriptor.id.clone(),
                operation: operation.to_string(),
                activation_revision: self.activation_revision,
                kind: PluginSandboxFailureKind::HostCallDenied,
                message: sandbox_safe_diagnostic(
                    &SandboxError::HostCallDenied {
                        method: "filter authorization".to_string(),
                        code: denial.code,
                    },
                    SANDBOX_DIAGNOSTIC_BYTES,
                ),
            })
    }

    fn read_source(&self, source: &Path, operation: &str) -> Result<String, FilterError> {
        let decoded_limit = self.worker.0.limits.invocation_json_bytes / 2;
        let file = File::open(source)?;
        let mut bytes = Vec::new();
        file.take(decoded_limit as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > decoded_limit {
            return Err(self.map_error(
                operation,
                SandboxError::ResourceLimit {
                    resource: "filter source bytes",
                    limit: decoded_limit,
                    actual: bytes.len(),
                },
            ));
        }
        Ok(BASE64_STANDARD.encode(bytes))
    }

    fn call<T: for<'de> Deserialize<'de>>(
        &self,
        operation: &str,
        input: Value,
    ) -> Result<T, FilterError> {
        let result = self
            .worker
            .invoke(SandboxInvocationV1 {
                protocol_version: SANDBOX_PROTOCOL_VERSION,
                invocation_id: Uuid::now_v7().to_string(),
                contribution_id: self.contribution_id.clone(),
                operation: operation.to_string(),
                input,
            })
            .map_err(|error| self.map_error(operation, error))?;
        if !result.ok {
            return Err(self.map_error(operation, SandboxError::Script { stage: "invoke" }));
        }
        serde_json::from_value(result.output.unwrap_or(Value::Null)).map_err(|_| {
            self.map_error(
                operation,
                SandboxError::Codec {
                    reason: "filter result",
                },
            )
        })
    }

    fn map_error(&self, operation: &str, error: SandboxError) -> FilterError {
        let kind = match error.failure_kind() {
            SandboxFailureKind::Cancelled => PluginSandboxFailureKind::Cancelled,
            SandboxFailureKind::Timeout => PluginSandboxFailureKind::Timeout,
            SandboxFailureKind::ResourceLimit => PluginSandboxFailureKind::ResourceLimit,
            SandboxFailureKind::Module => PluginSandboxFailureKind::Module,
            SandboxFailureKind::Codec => PluginSandboxFailureKind::Codec,
            SandboxFailureKind::Script => PluginSandboxFailureKind::Script,
            SandboxFailureKind::HostCall => PluginSandboxFailureKind::HostCallDenied,
            SandboxFailureKind::Disconnected | SandboxFailureKind::InvalidState => {
                PluginSandboxFailureKind::Disconnected
            }
        };
        FilterError::PluginSandboxFailed {
            plugin_id: self.plugin_id.clone(),
            filter_id: self.descriptor.id.clone(),
            operation: operation.to_string(),
            activation_revision: self.activation_revision,
            kind,
            message: sandbox_safe_diagnostic(&error, SANDBOX_DIAGNOSTIC_BYTES),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SandboxExportOutput {
    bytes_base64: String,
    translated_segments: u32,
    #[serde(default)]
    degradation: Vec<translunar_filter_core::DegradationFinding>,
}

pub fn sandbox_safe_diagnostic(error: &SandboxError, max_bytes: usize) -> String {
    let message = match error {
        SandboxError::Cancelled => "sandbox operation cancelled",
        SandboxError::Timeout => "sandbox operation timed out",
        SandboxError::ResourceLimit { .. } | SandboxError::QueueFull => {
            "sandbox resource limit exceeded"
        }
        SandboxError::Module { .. } => "sandbox module graph rejected",
        SandboxError::Codec { .. } => "sandbox data contract rejected",
        SandboxError::Script { .. } => "sandbox script failed",
        SandboxError::HostMethodUnsupported { .. } => "sandbox host method unsupported",
        SandboxError::HostCallDenied { .. } => "sandbox host call denied",
        SandboxError::HostCallFailed { .. } => "sandbox host call failed",
        SandboxError::NotReady | SandboxError::Disconnected => "sandbox worker disconnected",
        SandboxError::Conflict => "sandbox runtime conflict",
    };
    let limit = max_bytes.min(message.len());
    message[..limit].to_string()
}

impl DocumentFilter for SandboxDocumentFilter {
    fn descriptor(&self) -> FilterDescriptor {
        self.descriptor.clone()
    }

    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        const OPERATION: &str = "filter.probe";
        self.authorize(
            PluginCapabilityId::FileRead,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Source],
            },
            OPERATION,
        )?;
        let source_base64 = self.read_source(source, OPERATION)?;
        self.call(
            OPERATION,
            serde_json::json!({ "sourceBase64": source_base64 }),
        )
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        const OPERATION: &str = "filter.import";
        self.authorize(
            PluginCapabilityId::FileRead,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Source],
            },
            OPERATION,
        )?;
        let source_base64 = self.read_source(&request.source, OPERATION)?;
        let events: Vec<PluginFilterEvent> = self.call(
            OPERATION,
            serde_json::json!({
                "sourceBase64": source_base64,
                "documentId": request.document_id,
                "sourceLocale": request.source_locale,
                "options": request.options,
            }),
        )?;
        Ok(Box::new(events.into_iter().map(|event| Ok(event.into()))))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        const OPERATION: &str = "filter.export";
        self.authorize(
            PluginCapabilityId::FileRead,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Source],
            },
            OPERATION,
        )?;
        self.authorize(
            PluginCapabilityId::FileWrite,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Output],
            },
            OPERATION,
        )?;
        let source_base64 = self.read_source(request.source, OPERATION)?;
        let output: SandboxExportOutput = self.call(
            OPERATION,
            serde_json::json!({
                "sourceBase64": source_base64,
                "segments": request.segments,
            }),
        )?;
        let bytes = BASE64_STANDARD.decode(output.bytes_base64).map_err(|_| {
            self.map_error(
                OPERATION,
                SandboxError::Codec {
                    reason: "filter result",
                },
            )
        })?;
        if bytes.len() > self.worker.0.limits.invocation_json_bytes {
            return Err(self.map_error(
                OPERATION,
                SandboxError::ResourceLimit {
                    resource: "filter output bytes",
                    limit: self.worker.0.limits.invocation_json_bytes,
                    actual: bytes.len(),
                },
            ));
        }
        publish_bytes_noclobber(request.output, &bytes)?;
        Ok(ExportReport {
            output_path: request.output.to_string_lossy().into_owned(),
            translated_segments: output.translated_segments,
            degradation: output.degradation,
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        const OPERATION: &str = "filter.validate";
        self.authorize(
            PluginCapabilityId::FileRead,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Source],
            },
            OPERATION,
        )?;
        let source_base64 = self.read_source(source, OPERATION)?;
        self.call(
            OPERATION,
            serde_json::json!({ "sourceBase64": source_base64 }),
        )
    }
}

fn worker_main(
    config: SandboxRuntimeConfig,
    receiver: Receiver<WorkerRequest>,
    init_sender: SyncSender<SandboxResult<()>>,
    state: Arc<AtomicU8>,
    interrupt: Arc<InterruptState>,
    host_calls: Arc<SandboxHostCallRegistry>,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
) {
    let initialized = WorkerRuntime::initialize(
        config.clone(),
        Arc::clone(&interrupt),
        host_calls,
        authorizer,
    );
    let mut runtime = match initialized {
        Ok(runtime) => {
            state.store(SandboxWorkerState::Ready as u8, Ordering::Release);
            let _ = init_sender.send(Ok(()));
            runtime
        }
        Err(error) => {
            state.store(SandboxWorkerState::Failed as u8, Ordering::Release);
            let _ = init_sender.send(Err(error));
            return;
        }
    };

    while let Ok(message) = receiver.recv() {
        match message {
            WorkerRequest::Invoke {
                envelope,
                cancellation,
                deadline,
                reply,
            } => {
                interrupt.begin(deadline, cancellation);
                let result = runtime.invoke(envelope.request, &envelope.credentials, deadline);
                drop(envelope.credentials);
                interrupt.clear();
                let fatal = result.as_ref().err().is_some_and(SandboxError::is_fatal);
                let _ = reply.send(result);
                if fatal {
                    state.store(SandboxWorkerState::Failed as u8, Ordering::Release);
                    break;
                }
            }
            WorkerRequest::Shutdown { reply } => {
                state.store(SandboxWorkerState::Stopping as u8, Ordering::Release);
                interrupt.stopping.store(false, Ordering::Release);
                let cancellation = SandboxCancellationToken::default();
                let deadline = Instant::now() + config.limits.shutdown;
                interrupt.begin(deadline, cancellation);
                let _ = runtime.deactivate(deadline);
                interrupt.clear();
                let _ = reply.send(());
                state.store(SandboxWorkerState::Stopped as u8, Ordering::Release);
                return;
            }
        }
    }
    state.store(SandboxWorkerState::Stopped as u8, Ordering::Release);
}

struct WorkerRuntime {
    plugin: Persistent<Object<'static>>,
    context: Context,
    _runtime: Runtime,
    config: SandboxRuntimeConfig,
    interrupt: Arc<InterruptState>,
    host_calls: Arc<SandboxHostCallRegistry>,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl WorkerRuntime {
    fn initialize(
        config: SandboxRuntimeConfig,
        interrupt: Arc<InterruptState>,
        host_calls: Arc<SandboxHostCallRegistry>,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> SandboxResult<Self> {
        let loader = ConfinedModuleLoader::new(&config.package_root, config.limits)?;
        let entry_path = normalize_module_name(&config.entry_path)?;
        let entry_source = loader.read(&entry_path)?;
        let runtime =
            Runtime::new().map_err(|error| map_js_error(error, "initialize", &interrupt))?;
        runtime.set_memory_limit(config.limits.heap_bytes);
        runtime.set_max_stack_size(config.limits.stack_bytes);
        let handler_interrupt = Arc::clone(&interrupt);
        runtime.set_interrupt_handler(Some(Box::new(move || handler_interrupt.should_interrupt())));
        runtime.set_loader(ConfinedModuleResolver, loader);
        let context = Context::full(&runtime)
            .map_err(|error| map_js_error(error, "initialize", &interrupt))?;
        let cancellation = SandboxCancellationToken::default();
        let deadline = Instant::now() + config.limits.initialization;
        interrupt.begin(deadline, cancellation);
        let plugin = context.with(|ctx| {
            let module = Module::declare(ctx.clone(), entry_path, entry_source)
                .map_err(|error| map_js_error(error, "module", &interrupt))?;
            let (module, promise) = module
                .eval()
                .map_err(|error| map_js_error(error, "module", &interrupt))?;
            settle_promise(promise, &ctx, deadline, &interrupt, "module")?;
            let namespace = module
                .namespace()
                .map_err(|error| map_js_error(error, "module", &interrupt))?;
            let keys = namespace
                .keys::<String>()
                .collect::<rquickjs::Result<Vec<_>>>()
                .map_err(|error| map_js_error(error, "module", &interrupt))?;
            if keys.len() != 1 || keys[0] != config.export_name {
                return Err(SandboxError::Codec {
                    reason: "plugin exports",
                });
            }
            let plugin = namespace
                .get::<_, Object>(config.export_name.as_str())
                .map_err(|error| map_js_error(error, "entry contract", &interrupt))?;
            validate_plugin_contract(&ctx, &plugin, &interrupt)?;
            let lifecycle = lifecycle_json(&config)?;
            if let Some(activate) = optional_function(&plugin, "activate", &interrupt)? {
                let argument = json_to_js(&ctx, &lifecycle, &interrupt, "activate")?;
                let value = activate
                    .call::<_, JsValue>((This(plugin.clone()), argument))
                    .map_err(|error| map_js_error(error, "activate", &interrupt))?;
                settle_value(value, &ctx, deadline, &interrupt, "activate")?;
            }
            Ok(Persistent::save(&ctx, plugin))
        });
        interrupt.clear();
        Ok(Self {
            plugin: plugin?,
            context,
            _runtime: runtime,
            config,
            interrupt,
            host_calls,
            authorizer,
        })
    }

    fn invoke(
        &mut self,
        request: SandboxInvocationV1,
        credentials: &BTreeMap<String, SandboxEphemeralCredential>,
        deadline: Instant,
    ) -> SandboxResult<SandboxResultV1> {
        let host_state = Arc::new(Mutex::new(InvocationHostState::new(
            SandboxHostCallContext {
                plugin_id: self.config.key.plugin_id.clone(),
                version_id: self.config.key.version_id.clone(),
                activation_revision: self.config.activation_revision,
                contribution_id: request.contribution_id.clone(),
                invocation_id: request.invocation_id.clone(),
                operation: request.operation.clone(),
            },
        )));
        self.context.with(|ctx| {
            let plugin = self
                .plugin
                .clone()
                .restore(&ctx)
                .map_err(|error| map_js_error(error, "invoke", &self.interrupt))?;
            let invoke = plugin
                .get::<_, Function>("invoke")
                .map_err(|error| map_js_error(error, "invoke", &self.interrupt))?;
            let request_value = serde_json::to_value(&request)
                .map_err(|_| SandboxError::Codec { reason: "input" })?;
            let request_value = json_to_js(&ctx, &request_value, &self.interrupt, "invoke")?;
            let host = make_host_facade(
                &ctx,
                Arc::clone(&host_state),
                Arc::clone(&self.host_calls),
                Arc::clone(&self.authorizer),
                self.config.limits,
                Arc::clone(&self.interrupt),
            )?;
            let invocation_context = Object::new(ctx.clone()).map_err(|_| SandboxError::Codec {
                reason: "invocation context",
            })?;
            if let Some(credential) = credentials.get("credential") {
                invocation_context
                    .set("credential", credential.expose())
                    .map_err(|_| SandboxError::Codec {
                        reason: "invocation context",
                    })?;
            }
            if !credentials.is_empty() {
                let credential_map = Object::new(ctx.clone()).map_err(|_| SandboxError::Codec {
                    reason: "invocation context",
                })?;
                for (key, value) in credentials {
                    credential_map
                        .set(key.as_str(), value.expose())
                        .map_err(|_| SandboxError::Codec {
                            reason: "invocation context",
                        })?;
                }
                invocation_context
                    .set("credentials", credential_map)
                    .map_err(|_| SandboxError::Codec {
                        reason: "invocation context",
                    })?;
            }
            let value = match invoke.call::<_, JsValue>((
                This(plugin),
                request_value,
                host,
                invocation_context.clone(),
            )) {
                Ok(value) => value,
                Err(error) => {
                    clear_invocation_credentials(
                        &ctx,
                        &invocation_context,
                        !credentials.is_empty(),
                    )?;
                    return Err(take_host_error(&host_state)
                        .unwrap_or_else(|| map_js_error(error, "invoke", &self.interrupt)));
                }
            };
            let value = match settle_value(value, &ctx, deadline, &self.interrupt, "invoke") {
                Ok(value) => value,
                Err(error) => {
                    clear_invocation_credentials(
                        &ctx,
                        &invocation_context,
                        !credentials.is_empty(),
                    )?;
                    return Err(take_host_error(&host_state).unwrap_or(error));
                }
            };
            clear_invocation_credentials(&ctx, &invocation_context, !credentials.is_empty())?;
            if let Some(error) = take_host_error(&host_state) {
                return Err(error);
            }
            let output = js_to_json(&ctx, value, self.config.limits, &self.interrupt, "output")?;
            let result: SandboxResultV1 =
                serde_json::from_value(output).map_err(|_| SandboxError::Codec {
                    reason: "plugin result",
                })?;
            result.validate(self.config.limits)?;
            Ok(result)
        })
    }

    fn deactivate(&mut self, deadline: Instant) -> SandboxResult<()> {
        self.context.with(|ctx| {
            let plugin = self
                .plugin
                .clone()
                .restore(&ctx)
                .map_err(|error| map_js_error(error, "deactivate", &self.interrupt))?;
            let Some(deactivate) = optional_function(&plugin, "deactivate", &self.interrupt)?
            else {
                return Ok(());
            };
            let lifecycle = lifecycle_json(&self.config)?;
            let argument = json_to_js(&ctx, &lifecycle, &self.interrupt, "deactivate")?;
            let value = deactivate
                .call::<_, JsValue>((This(plugin), argument))
                .map_err(|error| map_js_error(error, "deactivate", &self.interrupt))?;
            settle_value(value, &ctx, deadline, &self.interrupt, "deactivate")?;
            Ok(())
        })
    }
}

fn clear_invocation_credentials<'js>(
    ctx: &Ctx<'js>,
    invocation_context: &Object<'js>,
    had_credentials: bool,
) -> SandboxResult<()> {
    if had_credentials {
        invocation_context
            .remove("credential")
            .map_err(|_| SandboxError::Codec {
                reason: "invocation context",
            })?;
        invocation_context
            .remove("credentials")
            .map_err(|_| SandboxError::Codec {
                reason: "invocation context",
            })?;
    }
    ctx.run_gc();
    Ok(())
}

fn lifecycle_json(config: &SandboxRuntimeConfig) -> SandboxResult<Value> {
    serde_json::to_value(SandboxLifecycleContextV1 {
        protocol_version: SANDBOX_PROTOCOL_VERSION,
        plugin_id: config.key.plugin_id.clone(),
        version_id: config.key.version_id.clone(),
        activation_revision: config.activation_revision,
    })
    .map_err(|_| SandboxError::Codec {
        reason: "lifecycle",
    })
}

fn optional_function<'js>(
    plugin: &Object<'js>,
    name: &'static str,
    interrupt: &InterruptState,
) -> SandboxResult<Option<Function<'js>>> {
    let value = plugin
        .get::<_, JsValue>(name)
        .map_err(|error| map_js_error(error, "entry contract", interrupt))?;
    if value.is_undefined() {
        return Ok(None);
    }
    value.into_function().map(Some).ok_or(SandboxError::Codec {
        reason: "entry contract",
    })
}

const PLUGIN_CONTRACT_VALIDATOR: &str = r#"
(plugin) => {
  if (plugin === null || typeof plugin !== "object" || Object.getPrototypeOf(plugin) !== Object.prototype) throw new TypeError("invalid plugin");
  const keys = Reflect.ownKeys(plugin);
  if (keys.some((key) => typeof key !== "string" || !["activate", "invoke", "deactivate"].includes(key))) throw new TypeError("unknown plugin member");
  if (typeof plugin.invoke !== "function") throw new TypeError("missing invoke");
  for (const key of ["activate", "deactivate"]) if (plugin[key] !== undefined && typeof plugin[key] !== "function") throw new TypeError("invalid lifecycle member");
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(plugin, key); if (!descriptor || descriptor.get || descriptor.set) throw new TypeError("accessor denied"); }
  return true;
}
"#;

fn validate_plugin_contract<'js>(
    ctx: &Ctx<'js>,
    plugin: &Object<'js>,
    interrupt: &InterruptState,
) -> SandboxResult<()> {
    let validator = ctx
        .eval::<Function, _>(PLUGIN_CONTRACT_VALIDATOR)
        .map_err(|error| map_js_error(error, "entry contract", interrupt))?;
    validator
        .call::<_, bool>((plugin.clone(),))
        .map_err(|error| map_js_error(error, "entry contract", interrupt))?;
    Ok(())
}

#[derive(Debug)]
struct InvocationHostState {
    context: SandboxHostCallContext,
    call_count: usize,
    request_ids: BTreeSet<String>,
    error: Option<SandboxError>,
}

impl InvocationHostState {
    fn new(context: SandboxHostCallContext) -> Self {
        Self {
            context,
            call_count: 0,
            request_ids: BTreeSet::new(),
            error: None,
        }
    }
}

fn make_host_facade<'js>(
    ctx: &Ctx<'js>,
    state: Arc<Mutex<InvocationHostState>>,
    registry: Arc<SandboxHostCallRegistry>,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    limits: SandboxLimits,
    interrupt: Arc<InterruptState>,
) -> SandboxResult<Object<'js>> {
    let callback_state = Arc::clone(&state);
    let callback_interrupt = Arc::clone(&interrupt);
    let callback = Function::new(ctx.clone(), move |json: String| {
        let result = dispatch_host_call(
            &json,
            &callback_state,
            &registry,
            authorizer.as_ref(),
            limits,
            &callback_interrupt,
        );
        match result {
            Ok(value) => serde_json::to_string(&value).map_err(|_| {
                JsError::new_into_js_message("host result", "JSON string", "serialization failed")
            }),
            Err(error) => {
                if let Ok(mut state) = callback_state.lock() {
                    state.error = Some(error);
                }
                Err(JsError::new_from_js_message(
                    "host call",
                    "JSON value",
                    "host call rejected",
                ))
            }
        }
    })
    .map_err(|error| map_js_error(error, "host facade", &interrupt))?;
    let factory = ctx
        .eval::<Function, _>(HOST_FACADE_FACTORY)
        .map_err(|error| map_js_error(error, "host facade", &interrupt))?;
    factory
        .call::<_, Object>((callback,))
        .map_err(|error| map_js_error(error, "host facade", &interrupt))
}

const HOST_FACADE_FACTORY: &str = r#"
(nativeCall) => Object.freeze({
  call(request) {
    const seen = new Set();
    const walk = (item, depth) => {
      if (depth > 16) throw new TypeError("depth");
      if (item === null || typeof item === "string" || typeof item === "boolean") return;
      if (typeof item === "number") { if (!Number.isFinite(item)) throw new TypeError("number"); return; }
      if (typeof item !== "object" || seen.has(item)) throw new TypeError("type");
      seen.add(item);
      const proto = Object.getPrototypeOf(item);
      if (Array.isArray(item) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new TypeError("prototype");
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== "string") throw new TypeError("symbol key");
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || descriptor.get || descriptor.set) throw new TypeError("accessor");
        walk(descriptor.value, depth + 1);
      }
    };
    walk(request, 0);
    return JSON.parse(nativeCall(JSON.stringify(request)));
  }
})
"#;

fn dispatch_host_call(
    json: &str,
    state: &Mutex<InvocationHostState>,
    registry: &SandboxHostCallRegistry,
    authorizer: &dyn PluginCapabilityAuthorizer,
    limits: SandboxLimits,
    interrupt: &InterruptState,
) -> SandboxResult<Value> {
    if let Some(reason) = interrupt.reason() {
        return Err(reason);
    }
    if json.len() > limits.host_call_json_bytes {
        return Err(SandboxError::ResourceLimit {
            resource: "host call",
            limit: limits.host_call_json_bytes,
            actual: json.len(),
        });
    }
    let request_json: Value = serde_json::from_str(json).map_err(|_| SandboxError::Codec {
        reason: "host call",
    })?;
    validate_json(
        &request_json,
        limits.host_call_json_bytes,
        limits.json_depth,
        "host call",
    )?;
    let request: SandboxHostCallV1 =
        serde_json::from_value(request_json).map_err(|_| SandboxError::Codec {
            reason: "host call",
        })?;
    if request.protocol_version != SANDBOX_PROTOCOL_VERSION {
        return Err(SandboxError::Codec {
            reason: "host call",
        });
    }
    validate_boundary_text(&request.request_id, MAX_BOUNDARY_ID_BYTES, "host call")?;
    validate_boundary_text(&request.method, MAX_OPERATION_BYTES, "host call")?;
    let (context, method) = {
        let mut state = state.lock().map_err(|_| SandboxError::HostCallFailed {
            method: request.method.clone(),
        })?;
        if state.call_count >= limits.host_calls_per_invocation {
            return Err(SandboxError::ResourceLimit {
                resource: "host calls",
                limit: limits.host_calls_per_invocation,
                actual: state.call_count + 1,
            });
        }
        if !state.request_ids.insert(request.request_id.clone()) {
            return Err(SandboxError::Codec {
                reason: "duplicate host request",
            });
        }
        state.call_count += 1;
        (state.context.clone(), registry.method(&request.method)?)
    };
    if !method.operations.contains(&context.operation)
        || (!method.contributions.is_empty()
            && !method.contributions.contains(&context.contribution_id))
    {
        return Err(SandboxError::HostMethodUnsupported {
            method: request.method,
        });
    }
    let scope = (method.derive_scope)(&request.params)?;
    let check = PluginCapabilityCheck {
        plugin_id: context.plugin_id.clone(),
        version_id: context.version_id.clone(),
        capability_id: method.capability_id.clone(),
        scope,
        operation: context.operation.clone(),
        contribution_id: Some(context.contribution_id.clone()),
    };
    authorizer
        .authorize(&check)
        .map_err(|denial| SandboxError::HostCallDenied {
            method: request.method.clone(),
            code: denial.code,
        })?;
    let result = (method.handler)(&context, request.params)?;
    validate_json(
        &result,
        limits.host_call_json_bytes,
        limits.json_depth,
        "host result",
    )?;
    Ok(result)
}

fn take_host_error(state: &Mutex<InvocationHostState>) -> Option<SandboxError> {
    state.lock().ok()?.error.take()
}

const JSON_VALUE_VALIDATOR: &str = r#"
(value, maxDepth) => {
  const seen = new Set();
  const walk = (item, depth) => {
    if (depth > maxDepth) throw new TypeError("depth");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") { if (!Number.isFinite(item)) throw new TypeError("number"); return; }
    if (typeof item !== "object") throw new TypeError("type");
    if (seen.has(item)) throw new TypeError("cycle");
    seen.add(item);
    const proto = Object.getPrototypeOf(item);
    if (Array.isArray(item)) { if (proto !== Array.prototype) throw new TypeError("prototype"); }
    else if (proto !== Object.prototype && proto !== null) throw new TypeError("prototype");
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== "string") throw new TypeError("symbol key");
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || descriptor.get || descriptor.set) throw new TypeError("accessor");
      walk(descriptor.value, depth + 1);
    }
  };
  walk(value, 0);
  return value;
}
"#;

fn js_to_json<'js>(
    ctx: &Ctx<'js>,
    value: JsValue<'js>,
    limits: SandboxLimits,
    interrupt: &InterruptState,
    label: &'static str,
) -> SandboxResult<Value> {
    let validator = ctx
        .eval::<Function, _>(JSON_VALUE_VALIDATOR)
        .map_err(|error| map_js_error(error, label, interrupt))?;
    let value = validator
        .call::<_, JsValue>((value, limits.json_depth))
        .map_err(|error| map_js_error(error, label, interrupt))?;
    let json = ctx
        .json_stringify(value)
        .map_err(|error| map_js_error(error, label, interrupt))?
        .ok_or(SandboxError::Codec { reason: label })?;
    let json = json
        .to_string()
        .map_err(|error| map_js_error(error, label, interrupt))?;
    if json.len()
        > match label {
            "host call" | "host result" => limits.host_call_json_bytes,
            _ => limits.invocation_json_bytes,
        }
    {
        return Err(SandboxError::ResourceLimit {
            resource: label,
            limit: match label {
                "host call" | "host result" => limits.host_call_json_bytes,
                _ => limits.invocation_json_bytes,
            },
            actual: json.len(),
        });
    }
    serde_json::from_str(&json).map_err(|_| SandboxError::Codec { reason: label })
}

fn json_to_js<'js>(
    ctx: &Ctx<'js>,
    value: &Value,
    interrupt: &InterruptState,
    label: &'static str,
) -> SandboxResult<JsValue<'js>> {
    let json = serde_json::to_string(value).map_err(|_| SandboxError::Codec { reason: label })?;
    ctx.json_parse(json)
        .map_err(|error| map_js_error(error, label, interrupt))
}

fn settle_value<'js>(
    value: JsValue<'js>,
    ctx: &Ctx<'js>,
    deadline: Instant,
    interrupt: &InterruptState,
    stage: &'static str,
) -> SandboxResult<JsValue<'js>> {
    let Some(promise) = value.clone().into_promise() else {
        return Ok(value);
    };
    settle_promise(promise, ctx, deadline, interrupt, stage)
}

fn settle_promise<'js>(
    promise: Promise<'js>,
    ctx: &Ctx<'js>,
    deadline: Instant,
    interrupt: &InterruptState,
    stage: &'static str,
) -> SandboxResult<JsValue<'js>> {
    loop {
        if let Some(result) = promise.result::<JsValue>() {
            return result.map_err(|error| map_js_error(error, stage, interrupt));
        }
        if let Some(reason) = interrupt.reason() {
            return Err(reason);
        }
        if Instant::now() >= deadline {
            return Err(SandboxError::Timeout);
        }
        if !ctx.execute_pending_job() {
            thread::sleep(Duration::from_millis(1));
        }
    }
}

#[derive(Debug, Clone)]
struct LoadedModule {
    digest: [u8; 32],
    bytes: usize,
}

#[derive(Debug, Default)]
struct ModuleGraphState {
    modules: BTreeMap<String, LoadedModule>,
    total_bytes: usize,
}

#[derive(Debug, Clone, Copy)]
struct ConfinedModuleResolver;

impl Resolver for ConfinedModuleResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if attributes.is_some() || !name.starts_with("./") && !name.starts_with("../") {
            return Err(JsError::new_resolving_message(
                base,
                name,
                "only relative JavaScript modules are supported",
            ));
        }
        resolve_module_name(base, name)
            .map_err(|_| JsError::new_resolving_message(base, name, "module path was rejected"))
    }
}

#[derive(Debug, Clone)]
struct ConfinedModuleLoader {
    root: PathBuf,
    limits: SandboxLimits,
    graph: Arc<Mutex<ModuleGraphState>>,
}

impl ConfinedModuleLoader {
    fn new(root: &Path, limits: SandboxLimits) -> SandboxResult<Self> {
        let metadata = std::fs::symlink_metadata(root).map_err(|_| SandboxError::Module {
            reason: "package root",
        })?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || metadata_is_reparse(&metadata)
        {
            return Err(SandboxError::Module {
                reason: "package root",
            });
        }
        let root = std::fs::canonicalize(root).map_err(|_| SandboxError::Module {
            reason: "package root",
        })?;
        Ok(Self {
            root,
            limits,
            graph: Arc::new(Mutex::new(ModuleGraphState::default())),
        })
    }

    fn read(&self, name: &str) -> SandboxResult<Vec<u8>> {
        let name = normalize_module_name(name)?;
        let extension = Path::new(&name)
            .extension()
            .and_then(|value| value.to_str());
        if !matches!(extension, Some("js" | "mjs")) {
            return Err(SandboxError::Module {
                reason: "unsupported extension",
            });
        }
        let mut current = self.root.clone();
        for component in name.split('/') {
            current.push(component);
            let metadata =
                std::fs::symlink_metadata(&current).map_err(|_| SandboxError::Module {
                    reason: "module unavailable",
                })?;
            if metadata.file_type().is_symlink() || metadata_is_reparse(&metadata) {
                return Err(SandboxError::Module {
                    reason: "module indirection",
                });
            }
        }
        let canonical = std::fs::canonicalize(&current).map_err(|_| SandboxError::Module {
            reason: "module unavailable",
        })?;
        if !canonical.starts_with(&self.root) {
            return Err(SandboxError::Module {
                reason: "module escape",
            });
        }
        let before = std::fs::metadata(&canonical).map_err(|_| SandboxError::Module {
            reason: "module unavailable",
        })?;
        if !before.is_file() {
            return Err(SandboxError::Module {
                reason: "module type",
            });
        }
        let mut file = File::open(&canonical).map_err(|_| SandboxError::Module {
            reason: "module unavailable",
        })?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(self.limits.module_bytes as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| SandboxError::Module {
                reason: "module read",
            })?;
        if bytes.len() > self.limits.module_bytes {
            return Err(SandboxError::ResourceLimit {
                resource: "module bytes",
                limit: self.limits.module_bytes,
                actual: bytes.len(),
            });
        }
        let after = file.metadata().map_err(|_| SandboxError::Module {
            reason: "module metadata",
        })?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err(SandboxError::Module {
                reason: "module changed",
            });
        }
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        let mut graph = self.graph.lock().map_err(|_| SandboxError::Module {
            reason: "module graph",
        })?;
        if let Some(previous) = graph.modules.get(&name) {
            if previous.digest != digest || previous.bytes != bytes.len() {
                return Err(SandboxError::Module {
                    reason: "module changed",
                });
            }
            return Ok(bytes);
        }
        if graph.modules.len() >= self.limits.module_count {
            return Err(SandboxError::ResourceLimit {
                resource: "module count",
                limit: self.limits.module_count,
                actual: graph.modules.len() + 1,
            });
        }
        let total = graph.total_bytes.saturating_add(bytes.len());
        if total > self.limits.module_total_bytes {
            return Err(SandboxError::ResourceLimit {
                resource: "module total bytes",
                limit: self.limits.module_total_bytes,
                actual: total,
            });
        }
        graph.total_bytes = total;
        graph.modules.insert(
            name,
            LoadedModule {
                digest,
                bytes: bytes.len(),
            },
        );
        Ok(bytes)
    }
}

impl Loader for ConfinedModuleLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js>> {
        if attributes.is_some() {
            return Err(JsError::new_loading_message(
                name,
                "module attributes are unsupported",
            ));
        }
        let bytes = self
            .read(name)
            .map_err(|_| JsError::new_loading_message(name, "module load rejected"))?;
        Module::declare(ctx.clone(), name, bytes)
    }
}

fn normalize_module_name(value: &str) -> SandboxResult<String> {
    if value.is_empty()
        || value.len() > 512
        || value.contains('\0')
        || value.contains(':')
        || value.contains('?')
        || value.contains('#')
        || value.starts_with('/')
        || value.starts_with('\\')
        || Path::new(value).is_absolute()
    {
        return Err(SandboxError::Module {
            reason: "module path",
        });
    }
    let normalized = value.replace('\\', "/");
    let mut output = Vec::new();
    for component in normalized.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                if output.pop().is_none() {
                    return Err(SandboxError::Module {
                        reason: "module escape",
                    });
                }
            }
            value => output.push(value),
        }
    }
    if output.is_empty() {
        return Err(SandboxError::Module {
            reason: "module path",
        });
    }
    Ok(output.join("/"))
}

fn resolve_module_name(base: &str, name: &str) -> SandboxResult<String> {
    let base = normalize_module_name(base)?;
    let parent = base
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("");
    normalize_module_name(
        if parent.is_empty() {
            name.to_string()
        } else {
            format!("{parent}/{name}")
        }
        .as_str(),
    )
}

fn validate_config(config: &SandboxRuntimeConfig) -> SandboxResult<()> {
    validate_boundary_text(&config.key.plugin_id, MAX_BOUNDARY_ID_BYTES, "plugin id")?;
    validate_boundary_text(&config.key.version_id, MAX_BOUNDARY_ID_BYTES, "version id")?;
    validate_boundary_text(&config.export_name, MAX_BOUNDARY_ID_BYTES, "export name")?;
    normalize_module_name(&config.entry_path)?;
    if config.limits.queue_capacity == 0
        || config.limits.module_count == 0
        || config.limits.json_depth == 0
        || config.limits.host_calls_per_invocation == 0
    {
        return Err(SandboxError::ResourceLimit {
            resource: "runtime policy",
            limit: 1,
            actual: 0,
        });
    }
    if let Some(expected) = &config.expected_package_hash {
        let actual =
            crate::hash_plugin_package(&config.package_root).map_err(|_| SandboxError::Module {
                reason: "package integrity",
            })?;
        if actual.sha256 != *expected {
            return Err(SandboxError::Module {
                reason: "package integrity",
            });
        }
    }
    Ok(())
}

fn validate_invocation(request: &SandboxInvocationV1, limits: SandboxLimits) -> SandboxResult<()> {
    if request.protocol_version != SANDBOX_PROTOCOL_VERSION {
        return Err(SandboxError::Codec { reason: "input" });
    }
    validate_boundary_text(&request.invocation_id, MAX_BOUNDARY_ID_BYTES, "input")?;
    validate_boundary_text(&request.contribution_id, MAX_BOUNDARY_ID_BYTES, "input")?;
    validate_boundary_text(&request.operation, MAX_OPERATION_BYTES, "input")?;
    validate_json(
        &request.input,
        limits.invocation_json_bytes,
        limits.json_depth,
        "input",
    )?;
    let envelope =
        serde_json::to_value(request).map_err(|_| SandboxError::Codec { reason: "input" })?;
    validate_json(
        &envelope,
        limits.invocation_json_bytes,
        limits.json_depth,
        "input",
    )
}

fn validate_json(
    value: &Value,
    max_bytes: usize,
    max_depth: usize,
    label: &'static str,
) -> SandboxResult<()> {
    fn walk(value: &Value, depth: usize, max_depth: usize) -> bool {
        if depth > max_depth {
            return false;
        }
        match value {
            Value::Array(values) => values.iter().all(|value| walk(value, depth + 1, max_depth)),
            Value::Object(values) => values
                .values()
                .all(|value| walk(value, depth + 1, max_depth)),
            _ => true,
        }
    }
    if !walk(value, 0, max_depth) {
        return Err(SandboxError::ResourceLimit {
            resource: "JSON depth",
            limit: max_depth,
            actual: max_depth + 1,
        });
    }
    let bytes = serde_json::to_vec(value).map_err(|_| SandboxError::Codec { reason: label })?;
    if bytes.len() > max_bytes {
        return Err(SandboxError::ResourceLimit {
            resource: label,
            limit: max_bytes,
            actual: bytes.len(),
        });
    }
    Ok(())
}

fn validate_boundary_text(value: &str, max_bytes: usize, label: &'static str) -> SandboxResult<()> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.chars().any(|character| character.is_control())
    {
        return Err(SandboxError::Codec { reason: label });
    }
    Ok(())
}

fn map_js_error(error: JsError, stage: &'static str, interrupt: &InterruptState) -> SandboxError {
    if let Some(reason) = interrupt.reason() {
        return reason;
    }
    match error {
        JsError::Allocation => SandboxError::ResourceLimit {
            resource: "heap",
            limit: SANDBOX_HEAP_BYTES,
            actual: SANDBOX_HEAP_BYTES + 1,
        },
        JsError::Resolving { .. } | JsError::Loading { .. } => SandboxError::Module {
            reason: "module graph",
        },
        _ if stage == "module" => SandboxError::Module {
            reason: "module graph",
        },
        _ => SandboxError::Script { stage },
    }
}

fn bounded_thread_name(plugin_id: &str) -> String {
    let suffix = plugin_id
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || *value == '-' || *value == '_')
        .take(24)
        .collect::<String>();
    format!("plugin-sandbox-{suffix}")
}

#[cfg(windows)]
fn metadata_is_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PluginCapabilityDenial;
    use serde_json::json;
    use tempfile::tempdir;
    use translunar_filter_core::{FilterCapabilities, PluginSandboxFailureKind};

    #[derive(Debug)]
    struct AllowAll;

    impl PluginCapabilityAuthorizer for AllowAll {
        fn authorize(
            &self,
            _check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct DenyWith(PluginCapabilityDenialCode);

    impl PluginCapabilityAuthorizer for DenyWith {
        fn authorize(
            &self,
            check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
            Err(Box::new(PluginCapabilityDenial {
                code: self.0,
                plugin_id: check.plugin_id.clone(),
                version_id: check.version_id.clone(),
                capability_id: check.capability_id.clone(),
                operation: check.operation.clone(),
                request_id: None,
                message: "denied".to_string(),
            }))
        }
    }

    #[derive(Debug)]
    struct ExactAuthorizer {
        version_id: String,
        scope: PluginCapabilityScope,
    }

    impl PluginCapabilityAuthorizer for ExactAuthorizer {
        fn authorize(
            &self,
            check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
            let code = if check.version_id != self.version_id {
                Some(PluginCapabilityDenialCode::NotRequested)
            } else if check.scope != self.scope {
                Some(PluginCapabilityDenialCode::ScopeMismatch)
            } else {
                None
            };
            match code {
                None => Ok(()),
                Some(code) => Err(Box::new(PluginCapabilityDenial {
                    code,
                    plugin_id: check.plugin_id.clone(),
                    version_id: check.version_id.clone(),
                    capability_id: check.capability_id.clone(),
                    operation: check.operation.clone(),
                    request_id: None,
                    message: "denied".to_string(),
                })),
            }
        }
    }

    fn package(source: &str) -> (tempfile::TempDir, SandboxRuntimeConfig) {
        let directory = tempdir().expect("sandbox package");
        std::fs::write(directory.path().join("entry.mjs"), source).expect("write entry");
        let config = SandboxRuntimeConfig::new(
            "example.sandbox",
            "version-1",
            7,
            directory.path(),
            "entry.mjs",
            None,
        );
        (directory, config)
    }

    fn invocation(input: Value) -> SandboxInvocationV1 {
        SandboxInvocationV1 {
            protocol_version: SANDBOX_PROTOCOL_VERSION,
            invocation_id: "invocation-1".to_string(),
            contribution_id: "example.filter".to_string(),
            operation: "filter.transform".to_string(),
            input,
        }
    }

    fn spawn(source: &str) -> (tempfile::TempDir, SandboxWorkerHandle) {
        let (directory, config) = package(source);
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn sandbox");
        (directory, worker)
    }

    fn host_registry() -> Arc<SandboxHostCallRegistry> {
        let registry = Arc::new(SandboxHostCallRegistry::default());
        registry
            .register(
                SandboxHostMethod::new(
                    "diagnostics.summary",
                    PluginCapabilityId::DiagnosticsRead,
                    PluginCapabilityScope::Diagnostics {
                        categories: vec!["summary".to_string()],
                    },
                    ["filter.transform".to_string()],
                    |_context, params| Ok(json!({"echo": params})),
                )
                .expect("host method")
                .with_contributions(["example.filter".to_string()])
                .expect("bind contribution"),
            )
            .expect("register");
        registry
    }

    const HOST_CALL_PLUGIN: &str = r#"
      export default { invoke(request, host) { return { protocolVersion: 1, ok: true, output:
        host.call({ protocolVersion: 1, requestId: "call-1", method: "diagnostics.summary", params: request.input })
      }; } };
    "#;

    #[test]
    fn published_limits_match_the_reviewed_policy() {
        assert_eq!(DEFAULT_SANDBOX_LIMITS.heap_bytes, 32 * 1024 * 1024);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.stack_bytes, 512 * 1024);
        assert_eq!(
            DEFAULT_SANDBOX_LIMITS.initialization,
            Duration::from_secs(1)
        );
        assert_eq!(DEFAULT_SANDBOX_LIMITS.invocation, Duration::from_secs(2));
        assert_eq!(DEFAULT_SANDBOX_LIMITS.shutdown, Duration::from_millis(500));
        assert_eq!(DEFAULT_SANDBOX_LIMITS.module_bytes, 1024 * 1024);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.module_total_bytes, 8 * 1024 * 1024);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.module_count, 128);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.queue_capacity, 32);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.invocation_json_bytes, 1024 * 1024);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.host_call_json_bytes, 256 * 1024);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.json_depth, 16);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.host_calls_per_invocation, 256);
        assert_eq!(DEFAULT_SANDBOX_LIMITS.diagnostic_bytes, 4 * 1024);
    }

    #[test]
    fn lifecycle_and_promise_result_stay_inside_worker() {
        let (_directory, worker) = spawn(
            r#"
            let active = false;
            export default {
              async activate(context) { active = context.activationRevision === 7; },
              async invoke(request) { return { protocolVersion: 1, ok: true, output: { active, input: request.input } }; },
              deactivate() { active = false; }
            };
            "#,
        );
        let result = worker
            .invoke(invocation(json!({"value": 42})))
            .expect("invoke");
        assert_eq!(
            result.output,
            Some(json!({"active": true, "input": {"value": 42}}))
        );
        worker.shutdown().expect("shutdown");
        assert_eq!(worker.state(), SandboxWorkerState::Stopped);
    }

    #[test]
    fn credential_context_is_bounded_redacted_and_cleared_after_invocation() {
        let (_directory, worker) = spawn(
            r#"
            let retainedContext;
            export default {
              invoke(request, _host, context) {
                const previousHasCredential = retainedContext === undefined
                  ? null
                  : Object.hasOwn(retainedContext, "credential");
                retainedContext = context;
                return { protocolVersion: 1, ok: true, output: {
                  requestHasCredential: Object.hasOwn(request, "credential"),
                  credentialBytes: context.credential === undefined ? null : context.credential.length,
                  previousHasCredential
                } };
              }
            };
            "#,
        );
        let request = invocation(json!({"value": 42}));
        let serialized = serde_json::to_string(&request).expect("serialize public invocation");
        assert!(!serialized.contains("credential"));
        let credential = "ephemeral-secret";
        let wrapped = SandboxEphemeralCredential::new(credential).expect("bounded credential");
        assert!(!format!("{wrapped:?}").contains(credential));
        drop(wrapped);

        let first = worker
            .invoke_with_credential(request, Some(credential))
            .expect("invoke with credential");
        assert_eq!(
            first.output,
            Some(json!({
                "requestHasCredential": false,
                "credentialBytes": credential.len(),
                "previousHasCredential": null
            }))
        );
        let mut second_request = invocation(Value::Null);
        second_request.invocation_id = "invocation-2".to_string();
        let second = worker
            .invoke(second_request)
            .expect("invoke without credential");
        assert_eq!(
            second.output,
            Some(json!({
                "requestHasCredential": false,
                "credentialBytes": null,
                "previousHasCredential": false
            }))
        );

        let oversized = worker
            .invoke_with_credential(
                invocation(Value::Null),
                Some(&"x".repeat(MAX_CONNECTOR_CREDENTIAL_BYTES + 1)),
            )
            .expect_err("oversized credential must fail before dispatch");
        assert!(matches!(
            oversized,
            SandboxError::ResourceLimit {
                resource: "credential bytes",
                limit: MAX_CONNECTOR_CREDENTIAL_BYTES,
                actual,
            } if actual == MAX_CONNECTOR_CREDENTIAL_BYTES + 1
        ));
        assert!(matches!(
            worker
                .invoke_with_credential(invocation(Value::Null), Some("invalid\0credential"))
                .expect_err("NUL credential must fail before dispatch"),
            SandboxError::Codec {
                reason: "invocation context"
            }
        ));
    }

    #[test]
    fn named_credential_slots_are_ephemeral_and_cleared_together() {
        let (_directory, worker) = spawn(
            r#"
            let retainedContext;
            export default {
              invoke(_request, _host, context) {
                const previousSlots = retainedContext === undefined
                  ? null
                  : Object.keys(retainedContext.credentials ?? {});
                retainedContext = context;
                return { protocolVersion: 1, ok: true, output: {
                  slots: Object.keys(context.credentials ?? {}).sort(),
                  combinedBytes: (context.credentials?.apiToken?.length ?? 0)
                    + (context.credentials?.webhookSecret?.length ?? 0),
                  previousSlots
                } };
              }
            };
            "#,
        );
        let credentials = BTreeMap::from([
            ("apiToken".to_string(), "ephemeral-token".to_string()),
            (
                "webhookSecret".to_string(),
                "ephemeral-signature".to_string(),
            ),
        ]);
        let first = worker
            .invoke_with_credentials_and_cancellation(
                invocation(Value::Null),
                &credentials,
                Duration::from_secs(1),
                SandboxCancellationToken::default(),
            )
            .expect("invoke with named credentials");
        assert_eq!(
            first.output,
            Some(json!({
                "slots": ["apiToken", "webhookSecret"],
                "combinedBytes": "ephemeral-token".len() + "ephemeral-signature".len(),
                "previousSlots": null
            }))
        );

        let mut second_request = invocation(Value::Null);
        second_request.invocation_id = "invocation-2".to_string();
        let second = worker
            .invoke(second_request)
            .expect("invoke without credentials");
        assert_eq!(
            second.output,
            Some(json!({
                "slots": [],
                "combinedBytes": 0,
                "previousSlots": []
            }))
        );
    }

    #[test]
    fn node_and_host_globals_are_absent() {
        let (_directory, worker) = spawn(
            r#"
            export default { invoke() { return { protocolVersion: 1, ok: true, output: {
              process: typeof process, require: typeof require, fetch: typeof fetch,
              translunar: typeof translunar, node: typeof global, deno: typeof Deno,
              bun: typeof Bun, wasm: typeof WebAssembly
            } }; } };
            "#,
        );
        let result = worker.invoke(invocation(Value::Null)).expect("invoke");
        assert_eq!(
            result.output,
            Some(json!({
                "process": "undefined", "require": "undefined", "fetch": "undefined",
                "translunar": "undefined", "node": "undefined", "deno": "undefined",
                "bun": "undefined", "wasm": "undefined"
            }))
        );
    }

    #[test]
    fn relative_loader_accepts_modules_and_rejects_bare_and_escape_imports() {
        let directory = tempdir().expect("package");
        std::fs::create_dir(directory.path().join("lib")).expect("create lib");
        std::fs::write(
            directory.path().join("lib/helper.mjs"),
            "export const value = 9;",
        )
        .expect("write helper");
        std::fs::write(
            directory.path().join("entry.mjs"),
            "import { value } from './lib/helper.mjs'; export default { invoke() { return { protocolVersion: 1, ok: true, output: value }; } };",
        )
        .expect("write entry");
        let worker = SandboxWorkerHandle::spawn(
            SandboxRuntimeConfig::new(
                "example.sandbox",
                "v1",
                1,
                directory.path(),
                "entry.mjs",
                None,
            ),
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn relative import");
        assert_eq!(
            worker
                .invoke(invocation(Value::Null))
                .expect("invoke")
                .output,
            Some(json!(9))
        );

        for import in ["node:fs", "../outside.mjs", "https://example.test/a.mjs"] {
            let source = format!(
                "import value from '{import}'; export default {{ invoke() {{ return value; }} }};"
            );
            let (_directory, config) = package(&source);
            let error = SandboxWorkerHandle::spawn(
                config,
                Arc::new(SandboxHostCallRegistry::default()),
                Arc::new(AllowAll),
            )
            .expect_err("unsafe import rejected");
            assert_eq!(error.failure_kind(), SandboxFailureKind::Module);
        }
        for path in [
            "C:/outside.mjs",
            "\\\\server\\share\\outside.mjs",
            "helper.mjs?query",
            "helper.mjs#fragment",
        ] {
            assert!(
                normalize_module_name(path).is_err(),
                "accepted unsafe path: {path}"
            );
        }
    }

    #[test]
    fn infinite_loop_is_interrupted_by_deadline() {
        let (_directory, mut config) = package("export default { invoke() { while (true) {} } };");
        config.limits.invocation = Duration::from_millis(50);
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn");
        let started = Instant::now();
        assert_eq!(
            worker.invoke(invocation(Value::Null)),
            Err(SandboxError::Timeout)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn initialization_deadline_interrupts_top_level_script() {
        let (_directory, mut config) = package("while (true) {} export default { invoke() {} };");
        config.limits.initialization = Duration::from_millis(40);
        let started = Instant::now();
        let error = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect_err("initialization must time out");
        assert_eq!(error, SandboxError::Timeout);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn heap_and_stack_failures_are_bounded_to_the_worker() {
        let (_directory, mut heap_config) = package(
            "export default { invoke() { return { protocolVersion: 1, ok: true, output: new ArrayBuffer(16777216) }; } };",
        );
        heap_config.limits.heap_bytes = 4 * 1024 * 1024;
        let heap_worker = SandboxWorkerHandle::spawn(
            heap_config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn heap fixture");
        assert!(heap_worker.invoke(invocation(Value::Null)).is_err());

        let (_directory, mut stack_config) = package(
            "function recurse() { return recurse(); } export default { invoke() { return recurse(); } };",
        );
        stack_config.limits.stack_bytes = 256 * 1024;
        let stack_worker = SandboxWorkerHandle::spawn(
            stack_config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn stack fixture");
        assert!(stack_worker.invoke(invocation(Value::Null)).is_err());
    }

    #[test]
    fn bounded_queue_rejects_overload_before_serial_execution() {
        let (_directory, mut config) = package("export default { invoke() { while (true) {} } };");
        config.limits.queue_capacity = 1;
        config.limits.invocation = Duration::from_millis(100);
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn queue fixture");
        let make_request = || {
            let (reply, response) = mpsc::sync_channel(1);
            (
                WorkerRequest::Invoke {
                    envelope: SandboxInvocationEnvelope {
                        request: invocation(Value::Null),
                        credentials: BTreeMap::new(),
                    },
                    cancellation: SandboxCancellationToken::default(),
                    deadline: Instant::now() + Duration::from_millis(100),
                    reply,
                },
                response,
            )
        };
        let (first, first_response) = make_request();
        worker.0.sender.try_send(first).expect("active request");
        thread::sleep(Duration::from_millis(10));
        let (queued, _queued_response) = make_request();
        worker
            .0
            .sender
            .try_send(queued)
            .expect("one queued request");
        let (overflow, _overflow_response) = make_request();
        assert!(matches!(
            worker.0.sender.try_send(overflow),
            Err(TrySendError::Full(_))
        ));
        assert!(first_response.recv_timeout(Duration::from_secs(1)).is_ok());
    }

    #[test]
    fn shutdown_deadline_and_idempotent_teardown_are_bounded() {
        let (_directory, mut config) = package(
            "export default { invoke() { return { protocolVersion: 1, ok: true, output: null }; }, deactivate() { while (true) {} } };",
        );
        config.limits.shutdown = Duration::from_millis(50);
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn shutdown fixture");
        let started = Instant::now();
        worker.shutdown().expect("bounded shutdown");
        assert!(started.elapsed() < Duration::from_millis(SANDBOX_SHUTDOWN_MILLIS));
        worker.shutdown().expect("idempotent shutdown");
        assert_eq!(worker.state(), SandboxWorkerState::Stopped);
    }

    #[test]
    fn cancellation_interrupts_running_javascript() {
        let (_directory, mut config) = package("export default { invoke() { while (true) {} } };");
        config.limits.invocation = Duration::from_secs(1);
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn");
        let token = SandboxCancellationToken::default();
        let cancellation = token.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(25));
            cancellation.cancel();
        });
        assert_eq!(
            worker.invoke_with_cancellation(invocation(Value::Null), token),
            Err(SandboxError::Cancelled)
        );
    }

    #[test]
    fn invocation_specific_timeout_narrows_worker_limit() {
        let (_directory, mut config) = package("export default { invoke() { while (true) {} } };");
        config.limits.invocation = Duration::from_secs(1);
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn");
        let started = Instant::now();
        assert_eq!(
            worker.invoke_with_timeout_and_cancellation(
                invocation(Value::Null),
                Duration::from_millis(25),
                SandboxCancellationToken::default(),
            ),
            Err(SandboxError::Timeout)
        );
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn malformed_and_non_json_results_fail_closed() {
        for source in [
            "export default { invoke() { const value = {}; value.self = value; return value; } };",
            "export default { invoke() { return { protocolVersion: 1, ok: true }; } };",
            "export default { invoke() { return 1n; } };",
            "export default { invoke() { return new Date(); } };",
        ] {
            let (_directory, worker) = spawn(source);
            assert!(worker.invoke(invocation(Value::Null)).is_err());
        }
    }

    #[test]
    fn entry_contract_rejects_unknown_exports_members_and_accessors() {
        for source in [
            "export const helper = 1; export default { invoke() {} };",
            "export default { invoke() {}, unexpected: true };",
            "export default { invoke() {}, get activate() { return () => {}; } };",
        ] {
            let (_directory, config) = package(source);
            assert!(matches!(
                SandboxWorkerHandle::spawn(
                    config,
                    Arc::new(SandboxHostCallRegistry::default()),
                    Arc::new(AllowAll),
                ),
                Err(SandboxError::Codec { .. }) | Err(SandboxError::Script { .. })
            ));
        }
    }

    #[test]
    fn host_calls_are_typed_bound_and_limited() {
        let registry = host_registry();
        let (directory, mut config) = package(HOST_CALL_PLUGIN);
        config.limits.host_calls_per_invocation = 1;
        let worker = SandboxWorkerHandle::spawn(config, registry, Arc::new(AllowAll))
            .expect("spawn host fixture");
        let result = worker
            .invoke(invocation(json!({"value": 3})))
            .expect("invoke");
        assert_eq!(result.output, Some(json!({"echo": {"value": 3}})));
        drop(directory);
    }

    #[test]
    fn host_calls_reject_unknown_denied_narrow_revoked_and_stale_authority() {
        let (_directory, config) = package(HOST_CALL_PLUGIN);
        let narrow = SandboxWorkerHandle::spawn(
            config.clone(),
            host_registry(),
            Arc::new(ExactAuthorizer {
                version_id: "version-1".to_string(),
                scope: PluginCapabilityScope::Diagnostics {
                    categories: vec!["full".to_string()],
                },
            }),
        )
        .expect("spawn narrow fixture");
        assert!(matches!(
            narrow.invoke(invocation(Value::Null)),
            Err(SandboxError::HostCallDenied {
                code: PluginCapabilityDenialCode::ScopeMismatch,
                ..
            })
        ));

        let (_directory, stale_config) = package(HOST_CALL_PLUGIN);
        let stale = SandboxWorkerHandle::spawn(
            stale_config,
            host_registry(),
            Arc::new(ExactAuthorizer {
                version_id: "different-version".to_string(),
                scope: PluginCapabilityScope::Diagnostics {
                    categories: vec!["summary".to_string()],
                },
            }),
        )
        .expect("spawn stale fixture");
        assert!(matches!(
            stale.invoke(invocation(Value::Null)),
            Err(SandboxError::HostCallDenied {
                code: PluginCapabilityDenialCode::NotRequested,
                ..
            })
        ));

        for code in [
            PluginCapabilityDenialCode::Pending,
            PluginCapabilityDenialCode::Revoked,
        ] {
            let (_directory, denied_config) = package(HOST_CALL_PLUGIN);
            let denied = SandboxWorkerHandle::spawn(
                denied_config,
                host_registry(),
                Arc::new(DenyWith(code)),
            )
            .expect("spawn denied fixture");
            assert!(matches!(
                denied.invoke(invocation(Value::Null)),
                Err(SandboxError::HostCallDenied { code: actual, .. }) if actual == code
            ));
        }

        let (_directory, unknown_config) = package(
            "export default { invoke(request, host) { try { host.call({ protocolVersion: 1, requestId: 'x', method: 'engine.invoke', params: {} }); } catch (_) {} return { protocolVersion: 1, ok: true, output: null }; } };",
        );
        let unknown =
            SandboxWorkerHandle::spawn(unknown_config, host_registry(), Arc::new(AllowAll))
                .expect("spawn unknown fixture");
        assert!(matches!(
            unknown.invoke(invocation(Value::Null)),
            Err(SandboxError::HostMethodUnsupported { .. })
        ));

        let (_directory, bound_config) = package(HOST_CALL_PLUGIN);
        let bound = SandboxWorkerHandle::spawn(bound_config, host_registry(), Arc::new(AllowAll))
            .expect("spawn bound fixture");
        let mut wrong_operation = invocation(Value::Null);
        wrong_operation.operation = "filter.export".to_string();
        assert!(matches!(
            bound.invoke(wrong_operation),
            Err(SandboxError::HostMethodUnsupported { .. })
        ));
        let mut wrong_contribution = invocation(Value::Null);
        wrong_contribution.contribution_id = "another.filter".to_string();
        assert!(matches!(
            bound.invoke(wrong_contribution),
            Err(SandboxError::HostMethodUnsupported { .. })
        ));
    }

    #[test]
    fn host_call_count_payload_and_duplicate_ids_are_bounded() {
        let source = r#"
          export default { invoke(request, host) {
            host.call({ protocolVersion: 1, requestId: "same", method: "diagnostics.summary", params: {} });
            return { protocolVersion: 1, ok: true, output: host.call({ protocolVersion: 1, requestId: "same", method: "diagnostics.summary", params: request.input }) };
          } };
        "#;
        let (_directory, duplicate_config) = package(source);
        let duplicate =
            SandboxWorkerHandle::spawn(duplicate_config, host_registry(), Arc::new(AllowAll))
                .expect("spawn duplicate fixture");
        assert!(matches!(
            duplicate.invoke(invocation(Value::Null)),
            Err(SandboxError::Codec {
                reason: "duplicate host request"
            })
        ));

        let (_directory, mut count_config) = package(source);
        count_config.limits.host_calls_per_invocation = 1;
        let count = SandboxWorkerHandle::spawn(count_config, host_registry(), Arc::new(AllowAll))
            .expect("spawn count fixture");
        assert!(matches!(
            count.invoke(invocation(Value::Null)),
            Err(SandboxError::ResourceLimit {
                resource: "host calls",
                ..
            })
        ));

        let (_directory, mut payload_config) = package(HOST_CALL_PLUGIN);
        payload_config.limits.host_call_json_bytes = 128;
        let payload =
            SandboxWorkerHandle::spawn(payload_config, host_registry(), Arc::new(AllowAll))
                .expect("spawn payload fixture");
        assert!(matches!(
            payload.invoke(invocation(json!("x".repeat(256)))),
            Err(SandboxError::ResourceLimit {
                resource: "host call",
                ..
            })
        ));

        let output_registry = Arc::new(SandboxHostCallRegistry::default());
        output_registry
            .register(
                SandboxHostMethod::new(
                    "diagnostics.summary",
                    PluginCapabilityId::DiagnosticsRead,
                    PluginCapabilityScope::Diagnostics {
                        categories: vec!["summary".to_string()],
                    },
                    ["filter.transform".to_string()],
                    |_context, _params| Ok(json!("x".repeat(256))),
                )
                .expect("output method")
                .with_contributions(["example.filter".to_string()])
                .expect("output contribution"),
            )
            .expect("register output method");
        let (_directory, mut output_config) = package(HOST_CALL_PLUGIN);
        output_config.limits.host_call_json_bytes = 128;
        let host_output =
            SandboxWorkerHandle::spawn(output_config, output_registry, Arc::new(AllowAll))
                .expect("spawn host output fixture");
        assert!(matches!(
            host_output.invoke(invocation(Value::Null)),
            Err(SandboxError::ResourceLimit {
                resource: "host result",
                ..
            })
        ));
    }

    #[test]
    fn json_and_module_policy_boundaries_are_enforced() {
        let mut deep = Value::Null;
        for _ in 0..=SANDBOX_JSON_DEPTH {
            deep = json!([deep]);
        }
        let (_directory, worker) = spawn(
            "export default { invoke(request) { return { protocolVersion: 1, ok: true, output: request.input }; } };",
        );
        assert!(matches!(
            worker.invoke(invocation(deep)),
            Err(SandboxError::ResourceLimit {
                resource: "JSON depth",
                ..
            })
        ));

        let (_directory, mut config) = package(
            "export default { invoke() { return { protocolVersion: 1, ok: true, output: null }; } };",
        );
        config.limits.module_bytes = 16;
        assert!(matches!(
            SandboxWorkerHandle::spawn(
                config,
                Arc::new(SandboxHostCallRegistry::default()),
                Arc::new(AllowAll),
            ),
            Err(SandboxError::ResourceLimit {
                resource: "module bytes",
                ..
            })
        ));
    }

    #[test]
    fn json_byte_and_module_graph_boundaries_cover_limit_minus_exact_and_plus() {
        let exact = json!("x".repeat(62));
        assert_eq!(serde_json::to_vec(&exact).expect("serialize").len(), 64);
        validate_json(&json!("x".repeat(61)), 64, 16, "input").expect("limit minus one");
        validate_json(&exact, 64, 16, "input").expect("exact limit");
        assert!(matches!(
            validate_json(&json!("x".repeat(63)), 64, 16, "input"),
            Err(SandboxError::ResourceLimit { .. })
        ));

        let directory = tempdir().expect("module boundaries");
        for (name, bytes) in [("a.mjs", "aa"), ("b.mjs", "bb"), ("c.mjs", "c")] {
            std::fs::write(directory.path().join(name), bytes).expect("write module");
        }
        let mut limits = DEFAULT_SANDBOX_LIMITS;
        limits.module_bytes = 2;
        limits.module_count = 2;
        limits.module_total_bytes = 4;
        let loader = ConfinedModuleLoader::new(directory.path(), limits).expect("loader");
        assert_eq!(loader.read("a.mjs").expect("limit module").len(), 2);
        assert_eq!(loader.read("b.mjs").expect("exact aggregate").len(), 2);
        assert!(matches!(
            loader.read("c.mjs"),
            Err(SandboxError::ResourceLimit {
                resource: "module count",
                actual: 3,
                ..
            })
        ));

        limits.module_count = 3;
        let loader = ConfinedModuleLoader::new(directory.path(), limits).expect("aggregate loader");
        loader.read("a.mjs").expect("first module");
        loader.read("b.mjs").expect("exact total");
        assert!(matches!(
            loader.read("c.mjs"),
            Err(SandboxError::ResourceLimit {
                resource: "module total bytes",
                actual: 5,
                ..
            })
        ));

        let (_directory, mut output_config) = package(
            "export default { invoke() { return { protocolVersion: 1, ok: true, output: 'x'.repeat(512) }; } };",
        );
        output_config.limits.invocation_json_bytes = 256;
        let output_worker = SandboxWorkerHandle::spawn(
            output_config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn output fixture");
        assert!(matches!(
            output_worker.invoke(invocation(Value::Null)),
            Err(SandboxError::ResourceLimit {
                resource: "output",
                ..
            })
        ));

        let request = invocation(Value::Null);
        let envelope_bytes = serde_json::to_vec(&request)
            .expect("serialize invocation")
            .len();
        let mut exact_input_limits = DEFAULT_SANDBOX_LIMITS;
        exact_input_limits.invocation_json_bytes = envelope_bytes;
        validate_invocation(&request, exact_input_limits).expect("exact invocation byte limit");
        exact_input_limits.invocation_json_bytes -= 1;
        assert!(matches!(
            validate_invocation(&request, exact_input_limits),
            Err(SandboxError::ResourceLimit {
                resource: "input",
                ..
            })
        ));
    }

    #[test]
    fn default_module_count_and_aggregate_byte_limits_are_hard_boundaries() {
        let directory = tempdir().expect("default module graph");
        let module = vec![b'x'; SANDBOX_MODULE_TOTAL_BYTES / SANDBOX_MODULE_COUNT];
        for index in 0..=SANDBOX_MODULE_COUNT {
            std::fs::write(directory.path().join(format!("m{index}.mjs")), &module)
                .expect("write module");
        }
        let loader = ConfinedModuleLoader::new(directory.path(), DEFAULT_SANDBOX_LIMITS)
            .expect("default loader");
        for index in 0..SANDBOX_MODULE_COUNT {
            loader
                .read(&format!("m{index}.mjs"))
                .expect("module within count and aggregate limits");
        }
        assert!(matches!(
            loader.read(&format!("m{}.mjs", SANDBOX_MODULE_COUNT)),
            Err(SandboxError::ResourceLimit {
                resource: "module count",
                limit: SANDBOX_MODULE_COUNT,
                actual,
            }) if actual == SANDBOX_MODULE_COUNT + 1
        ));

        let mut aggregate_limits = DEFAULT_SANDBOX_LIMITS;
        aggregate_limits.module_count = SANDBOX_MODULE_COUNT + 1;
        let loader = ConfinedModuleLoader::new(directory.path(), aggregate_limits)
            .expect("aggregate loader");
        for index in 0..SANDBOX_MODULE_COUNT {
            loader.read(&format!("m{index}.mjs")).expect("exact 8 MiB");
        }
        assert!(matches!(
            loader.read(&format!("m{}.mjs", SANDBOX_MODULE_COUNT)),
            Err(SandboxError::ResourceLimit {
                resource: "module total bytes",
                limit: SANDBOX_MODULE_TOTAL_BYTES,
                actual,
            }) if actual > SANDBOX_MODULE_TOTAL_BYTES
        ));

        let module_limit_directory = tempdir().expect("module byte boundary");
        std::fs::write(
            module_limit_directory.path().join("exact.mjs"),
            vec![b'x'; SANDBOX_MODULE_BYTES],
        )
        .expect("write exact module");
        std::fs::write(
            module_limit_directory.path().join("over.mjs"),
            vec![b'x'; SANDBOX_MODULE_BYTES + 1],
        )
        .expect("write oversized module");
        let loader =
            ConfinedModuleLoader::new(module_limit_directory.path(), DEFAULT_SANDBOX_LIMITS)
                .expect("module byte loader");
        assert_eq!(
            loader.read("exact.mjs").expect("exact 1 MiB").len(),
            SANDBOX_MODULE_BYTES
        );
        assert!(matches!(
            loader.read("over.mjs"),
            Err(SandboxError::ResourceLimit {
                resource: "module bytes",
                limit: SANDBOX_MODULE_BYTES,
                actual,
            }) if actual == SANDBOX_MODULE_BYTES + 1
        ));
    }

    #[test]
    fn package_hash_and_loaded_module_changes_are_rejected() {
        let (directory, mut config) = package(
            "export default { invoke() { return { protocolVersion: 1, ok: true, output: null }; } };",
        );
        config.expected_package_hash = Some(
            crate::hash_plugin_package(directory.path())
                .expect("package hash")
                .sha256,
        );
        std::fs::write(directory.path().join("entry.mjs"), "export default {};")
            .expect("mutate package");
        assert!(matches!(
            SandboxWorkerHandle::spawn(
                config,
                Arc::new(SandboxHostCallRegistry::default()),
                Arc::new(AllowAll),
            ),
            Err(SandboxError::Module {
                reason: "package integrity"
            })
        ));

        let module_directory = tempdir().expect("module change");
        let path = module_directory.path().join("entry.mjs");
        std::fs::write(&path, "export default 1;").expect("initial module");
        let loader = ConfinedModuleLoader::new(module_directory.path(), DEFAULT_SANDBOX_LIMITS)
            .expect("loader");
        loader.read("entry.mjs").expect("first read");
        std::fs::write(&path, "export default 2;").expect("changed module");
        assert!(matches!(
            loader.read("entry.mjs"),
            Err(SandboxError::Module {
                reason: "module changed"
            })
        ));
    }

    #[test]
    fn diagnostics_are_bounded_and_do_not_echo_plugin_controlled_values() {
        let secret = "C:\\Users\\private\\token=secret".repeat(500);
        let error = SandboxError::HostMethodUnsupported {
            method: secret.clone(),
        };
        let diagnostic = sandbox_safe_diagnostic(&error, SANDBOX_DIAGNOSTIC_BYTES);
        assert!(diagnostic.len() <= SANDBOX_DIAGNOSTIC_BYTES);
        assert!(!diagnostic.contains("private"));
        assert!(!diagnostic.contains("secret"));
        assert!(!diagnostic.chars().any(char::is_control));
    }

    #[test]
    fn registry_and_filter_adapter_teardown_and_validate_are_real() {
        let (directory, config) = package(
            "export default { invoke(request) { if (request.operation === 'filter.validate') return { protocolVersion: 1, ok: true, output: { valid: true, findings: [] } }; return { protocolVersion: 1, ok: true, output: null }; } };",
        );
        let registry = SandboxRuntimeRegistry::default();
        let worker = registry
            .prepare(
                config,
                Arc::new(SandboxHostCallRegistry::default()),
                Arc::new(AllowAll),
            )
            .expect("prepare");
        let key = worker.key().clone();
        let filter = SandboxDocumentFilter::new(
            worker.clone(),
            FilterDescriptor {
                id: "example.filter".to_string(),
                version: "1.0.0".to_string(),
                display_name: "Example".to_string(),
                extensions: vec!["txt".to_string()],
                capabilities: FilterCapabilities {
                    import: false,
                    export: false,
                    validate: true,
                    inline_tags: false,
                    notes: false,
                    degradation_report: false,
                },
            },
            "example.sandbox",
            "version-1",
            7,
            "example.filter",
            Arc::new(AllowAll),
        )
        .expect("filter adapter");
        let source = directory.path().join("sample.txt");
        std::fs::write(&source, "sample").expect("write source");
        assert!(filter.validate(&source).expect("validate").valid);
        registry.attach(worker).expect("attach");
        assert!(registry.detach(&key).expect("detach"));
        assert!(!registry.detach(&key).expect("idempotent detach"));
        assert!(registry.is_empty());
    }

    #[test]
    fn filter_adapter_maps_runtime_failures_to_typed_filter_error() {
        let (directory, config) = package(
            "export default { invoke() { return { protocolVersion: 1, ok: true, output: { unexpected: true } }; } };",
        );
        let worker = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect("spawn");
        let filter = SandboxDocumentFilter::new(
            worker,
            FilterDescriptor {
                id: "example.filter".to_string(),
                version: "1.0.0".to_string(),
                display_name: "Example".to_string(),
                extensions: vec!["txt".to_string()],
                capabilities: FilterCapabilities {
                    import: false,
                    export: false,
                    validate: true,
                    inline_tags: false,
                    notes: false,
                    degradation_report: false,
                },
            },
            "example.sandbox",
            "version-1",
            7,
            "example.filter",
            Arc::new(AllowAll),
        )
        .expect("adapter");
        let source = directory.path().join("sample.txt");
        std::fs::write(&source, "sample").expect("source");
        assert!(matches!(
            filter.validate(&source),
            Err(FilterError::PluginSandboxFailed {
                kind: PluginSandboxFailureKind::Codec,
                activation_revision: 7,
                ..
            })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn loader_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let outside = tempdir().expect("outside");
        std::fs::write(outside.path().join("outside.mjs"), "export default 1;")
            .expect("outside module");
        let (directory, config) = package(
            "import value from './link.mjs'; export default { invoke() { return value; } };",
        );
        symlink(
            outside.path().join("outside.mjs"),
            directory.path().join("link.mjs"),
        )
        .expect("symlink");
        assert!(
            SandboxWorkerHandle::spawn(
                config,
                Arc::new(SandboxHostCallRegistry::default()),
                Arc::new(AllowAll),
            )
            .is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn loader_rejects_windows_reparse_escape() {
        use std::os::windows::fs::symlink_file;
        let outside = tempdir().expect("outside");
        std::fs::write(outside.path().join("outside.mjs"), "export default 1;")
            .expect("outside module");
        let (directory, config) = package(
            "import value from './link.mjs'; export default { invoke() { return value; } };",
        );
        symlink_file(
            outside.path().join("outside.mjs"),
            directory.path().join("link.mjs"),
        )
        .expect("create Windows reparse-point symlink; enable Developer Mode for this test");
        let error = SandboxWorkerHandle::spawn(
            config,
            Arc::new(SandboxHostCallRegistry::default()),
            Arc::new(AllowAll),
        )
        .expect_err("reparse escape rejected");
        assert_eq!(error.failure_kind(), SandboxFailureKind::Module);
    }
}
