//! Local plugin manifest validation, process host, and filter adapters.

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use translunar_domain::{DegradationFinding, DocumentNote, InlineTag};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest,
    PluginProcessFailureKind, ProbeResult, ValidationReport,
};

pub const HOST_API_VERSION: u32 = 1;
pub const MANIFEST_FILE_NAME: &str = "manifest.json";
const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const IMPORT_CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_TAIL_BYTES: usize = 16 * 1024;
const WRITER_QUEUE_CAPACITY: usize = 64;

#[derive(Debug, Error)]
pub enum PluginRuntimeError {
    #[error("plugin manifest invalid: {0}")]
    InvalidManifest(String),
    #[error("plugin permission denied: {0}")]
    PermissionDenied(String),
    #[error("plugin not found: {0}")]
    NotFound(String),
    #[error("plugin conflict: {0}")]
    Conflict(String),
    #[error("plugin process failed: {0}")]
    Process(String),
    #[error("plugin protocol error: {0}")]
    Protocol(String),
    #[error("plugin operation failed: {0}")]
    Remote(String),
    #[error("plugin timed out after {0:?}")]
    Timeout(Duration),
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON failed: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, PluginRuntimeError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginTier {
    Process,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginEntryKind {
    Node,
    Executable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginEntry {
    pub kind: PluginEntryKind,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginFilterContribution {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub extensions: Vec<String>,
    pub capabilities: FilterCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginContributions {
    #[serde(default)]
    pub filters: Vec<PluginFilterContribution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub manifest_version: u32,
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub api_version: u32,
    pub api_version_min: u32,
    pub tier: PluginTier,
    pub entry: PluginEntry,
    #[serde(default)]
    pub contributions: PluginContributions,
    #[serde(default)]
    pub permissions: Vec<String>,
}

impl PluginManifest {
    pub fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        self.contributions
            .filters
            .iter()
            .map(|filter| FilterDescriptor {
                id: filter.id.clone(),
                version: filter.version.clone(),
                display_name: filter.display_name.clone(),
                extensions: filter.extensions.clone(),
                capabilities: filter.capabilities.clone(),
            })
            .collect()
    }
}

pub fn load_manifest(package_dir: &Path) -> Result<PluginManifest> {
    let path = package_dir.join(MANIFEST_FILE_NAME);
    let raw = std::fs::read_to_string(&path).map_err(|error| {
        PluginRuntimeError::InvalidManifest(format!("cannot read {}: {error}", path.display()))
    })?;
    let manifest: PluginManifest = serde_json::from_str(&raw).map_err(|error| {
        PluginRuntimeError::InvalidManifest(format!("cannot parse manifest: {error}"))
    })?;
    validate_manifest(&manifest, package_dir)?;
    Ok(manifest)
}

pub fn validate_manifest(manifest: &PluginManifest, package_dir: &Path) -> Result<()> {
    if manifest.manifest_version != 1 {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "unsupported manifestVersion {}",
            manifest.manifest_version
        )));
    }
    require_id(&manifest.id, "plugin id")?;
    if manifest.id.starts_with("builtin.") {
        return Err(PluginRuntimeError::InvalidManifest(
            "plugin id must not use the builtin. prefix".to_string(),
        ));
    }
    if manifest.display_name.trim().is_empty() {
        return Err(PluginRuntimeError::InvalidManifest(
            "displayName must not be empty".to_string(),
        ));
    }
    if manifest.version.trim().is_empty() {
        return Err(PluginRuntimeError::InvalidManifest(
            "version must not be empty".to_string(),
        ));
    }
    if manifest.api_version_min > manifest.api_version {
        return Err(PluginRuntimeError::InvalidManifest(
            "apiVersionMin must be <= apiVersion".to_string(),
        ));
    }
    if HOST_API_VERSION < manifest.api_version_min || HOST_API_VERSION > manifest.api_version {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "host API {HOST_API_VERSION} outside plugin range {}..={}",
            manifest.api_version_min, manifest.api_version
        )));
    }
    if manifest.tier != PluginTier::Process {
        return Err(PluginRuntimeError::InvalidManifest(
            "only process tier is supported in v1".to_string(),
        ));
    }
    if manifest.entry.path.trim().is_empty()
        || Path::new(&manifest.entry.path).is_absolute()
        || manifest.entry.path.contains("..")
    {
        return Err(PluginRuntimeError::InvalidManifest(
            "entry.path must be a relative path without '..'".to_string(),
        ));
    }
    let entry_path = package_dir.join(&manifest.entry.path);
    if !entry_path.is_file() {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "entry file missing: {}",
            manifest.entry.path
        )));
    }
    if manifest.contributions.filters.is_empty() {
        return Err(PluginRuntimeError::InvalidManifest(
            "at least one filter contribution is required in v1".to_string(),
        ));
    }
    let mut seen = BTreeMap::new();
    for filter in &manifest.contributions.filters {
        require_id(&filter.id, "filter contribution id")?;
        if filter.id.starts_with("builtin.") {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "filter id {} must not use builtin. prefix",
                filter.id
            )));
        }
        if seen.insert(filter.id.clone(), ()).is_some() {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "duplicate filter contribution id {}",
                filter.id
            )));
        }
        if filter.version.trim().is_empty() || filter.display_name.trim().is_empty() {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "filter {} needs version and displayName",
                filter.id
            )));
        }
        if filter.extensions.is_empty() {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "filter {} needs at least one extension",
                filter.id
            )));
        }
    }
    for permission in &manifest.permissions {
        validate_permission_name(permission)?;
    }
    Ok(())
}

fn require_id(value: &str, label: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed != value {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} must be non-empty without surrounding whitespace"
        )));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} contains unsupported characters"
        )));
    }
    Ok(())
}

pub fn validate_permission_name(permission: &str) -> Result<()> {
    match permission {
        "file.read:source" | "file.write:output" => Ok(()),
        other if other.starts_with("network:") && other.len() > "network:".len() => Ok(()),
        other => Err(PluginRuntimeError::InvalidManifest(format!(
            "unsupported permission {other}"
        ))),
    }
}

pub fn ensure_permissions(required: &[String], granted: &[String]) -> Result<()> {
    let granted_set: BTreeMap<&str, ()> = granted.iter().map(|item| (item.as_str(), ())).collect();
    for permission in required {
        if !granted_set.contains_key(permission.as_str()) {
            return Err(PluginRuntimeError::PermissionDenied(permission.clone()));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type")]
pub enum PluginFilterEvent {
    #[serde(rename = "startDocument")]
    StartDocument { metadata: DocumentMetadata },
    #[serde(rename = "startUnit")]
    StartUnit {
        ordinal: u32,
        #[serde(rename = "structuralPath")]
        structural_path: String,
    },
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "targetText")]
    TargetText { text: String },
    #[serde(rename = "inlineTag")]
    InlineTag { tag: InlineTag },
    #[serde(rename = "note")]
    Note { note: DocumentNote },
    #[serde(rename = "degradation")]
    Degradation { finding: DegradationFinding },
    #[serde(rename = "endUnit")]
    EndUnit,
    #[serde(rename = "endDocument")]
    EndDocument,
}

impl From<PluginFilterEvent> for FilterEvent {
    fn from(value: PluginFilterEvent) -> Self {
        match value {
            PluginFilterEvent::StartDocument { metadata } => {
                FilterEvent::StartDocument { metadata }
            }
            PluginFilterEvent::StartUnit {
                ordinal,
                structural_path,
            } => FilterEvent::StartUnit {
                ordinal,
                structural_path,
            },
            PluginFilterEvent::Text { text } => FilterEvent::Text(text),
            PluginFilterEvent::TargetText { text } => FilterEvent::TargetText(text),
            PluginFilterEvent::InlineTag { tag } => FilterEvent::InlineTag(tag),
            PluginFilterEvent::Note { note } => FilterEvent::Note(note),
            PluginFilterEvent::Degradation { finding } => FilterEvent::Degradation(finding),
            PluginFilterEvent::EndUnit => FilterEvent::EndUnit,
            PluginFilterEvent::EndDocument => FilterEvent::EndDocument,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandshakeResult {
    api_version: u32,
    plugin_id: String,
    contributions: PluginContributions,
}

#[derive(Debug)]
struct PendingCall {
    method: String,
    sender: std::sync::mpsc::Sender<Result<Value>>,
}

#[derive(Debug)]
struct ProcessState {
    generation: u64,
    child: Child,
    writer: SyncSender<String>,
    pending: Arc<Mutex<BTreeMap<u64, PendingCall>>>,
    next_id: AtomicU64,
    stderr_tail: Arc<Mutex<VecDeque<u8>>>,
}

impl ProcessState {
    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Debug)]
pub struct PluginProcess {
    package_dir: PathBuf,
    manifest: PluginManifest,
    state: Mutex<Option<ProcessState>>,
    start_lock: Mutex<()>,
    next_generation: AtomicU64,
}

impl PluginProcess {
    pub fn new(package_dir: PathBuf, manifest: PluginManifest) -> Self {
        Self {
            package_dir,
            manifest,
            state: Mutex::new(None),
            start_lock: Mutex::new(()),
            next_generation: AtomicU64::new(1),
        }
    }

    pub fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    pub fn ensure_started(&self) -> Result<()> {
        let _start_guard = self
            .start_lock
            .lock()
            .map_err(|_| PluginRuntimeError::Process("start lock poisoned".to_string()))?;
        let mut guard = self
            .state
            .lock()
            .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
        if guard.is_some() {
            return Ok(());
        }
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        *guard = Some(self.spawn_locked(generation)?);
        drop(guard);
        let handshake: HandshakeResult =
            match self.call_started("plugin.handshake", json!({}), DEFAULT_CALL_TIMEOUT) {
                Ok(handshake) => handshake,
                Err(PluginRuntimeError::Remote(_)) => {
                    self.stop();
                    return Err(PluginRuntimeError::Protocol(
                        "plugin rejected the handshake".to_string(),
                    ));
                }
                Err(error) => {
                    self.stop();
                    return Err(error);
                }
            };
        if handshake.plugin_id != self.manifest.id {
            self.stop();
            return Err(PluginRuntimeError::Protocol(format!(
                "handshake pluginId {} does not match manifest {}",
                handshake.plugin_id, self.manifest.id
            )));
        }
        if handshake.api_version != HOST_API_VERSION {
            self.stop();
            return Err(PluginRuntimeError::Protocol(format!(
                "handshake apiVersion {} unsupported",
                handshake.api_version
            )));
        }
        Ok(())
    }

    pub fn stop(&self) {
        let state = self.state.lock().ok().and_then(|mut guard| guard.take());
        if let Some(mut state) = state {
            if let Ok(notification) = Self::encode_notification("plugin.shutdown", json!({})) {
                let _ = state.writer.try_send(notification);
            }
            state.kill();
        }
    }

    fn spawn_locked(&self, generation: u64) -> Result<ProcessState> {
        let entry = self.package_dir.join(&self.manifest.entry.path);
        let mut command = match self.manifest.entry.kind {
            PluginEntryKind::Node => {
                let mut command = Command::new(node_executable());
                command.arg(&entry);
                command
            }
            PluginEntryKind::Executable => Command::new(&entry),
        };
        command
            .current_dir(&self.package_dir)
            .env_clear()
            .env("TRANSLUNAR_PLUGIN_ID", &self.manifest.id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            for name in ["SystemRoot", "WINDIR"] {
                if let Some(value) = std::env::var_os(name) {
                    command.env(name, value);
                }
            }
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| PluginRuntimeError::Process("missing stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PluginRuntimeError::Process("missing stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| PluginRuntimeError::Process("missing stderr".to_string()))?;
        let pending: Arc<Mutex<BTreeMap<u64, PendingCall>>> = Arc::new(Mutex::new(BTreeMap::new()));
        let (writer, writer_receiver) =
            std::sync::mpsc::sync_channel::<String>(WRITER_QUEUE_CAPACITY);
        {
            let pending = Arc::clone(&pending);
            thread::spawn(move || {
                let mut stdin = stdin;
                while let Ok(encoded) = writer_receiver.recv() {
                    if let Err(error) = writeln!(stdin, "{encoded}").and_then(|()| stdin.flush()) {
                        fail_pending_writer_calls(&pending, &error);
                        break;
                    }
                }
            });
        }
        {
            let pending = Arc::clone(&pending);
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else {
                        break;
                    };
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if line.len() > MAX_FRAME_BYTES {
                        let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
                        for (_, call) in std::mem::take(&mut *pending) {
                            let _ = call.sender.send(Err(PluginRuntimeError::Protocol(
                                "plugin frame exceeds size limit".to_string(),
                            )));
                        }
                        break;
                    }
                    match serde_json::from_str::<Value>(&line) {
                        Ok(frame) => dispatch_frame(&pending, frame),
                        Err(error) => {
                            let mut pending =
                                pending.lock().unwrap_or_else(|error| error.into_inner());
                            for (_, call) in std::mem::take(&mut *pending) {
                                let _ = call.sender.send(Err(PluginRuntimeError::Protocol(
                                    format!("invalid plugin JSON: {error}"),
                                )));
                            }
                            break;
                        }
                    }
                }
                let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
                for (_, call) in std::mem::take(&mut *pending) {
                    let _ = call.sender.send(Err(PluginRuntimeError::Process(
                        "plugin process closed stdout".to_string(),
                    )));
                }
            });
        }
        let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_STDERR_TAIL_BYTES)));
        {
            let stderr_tail = Arc::clone(&stderr_tail);
            thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                loop {
                    let available = match reader.fill_buf() {
                        Ok([]) | Err(_) => break,
                        Ok(bytes) => bytes,
                    };
                    let consumed = available.len();
                    {
                        let mut tail = stderr_tail
                            .lock()
                            .unwrap_or_else(|error| error.into_inner());
                        for byte in available {
                            if tail.len() == MAX_STDERR_TAIL_BYTES {
                                tail.pop_front();
                            }
                            tail.push_back(*byte);
                        }
                    }
                    reader.consume(consumed);
                }
            });
        }
        Ok(ProcessState {
            generation,
            child,
            writer,
            pending,
            next_id: AtomicU64::new(1),
            stderr_tail,
        })
    }

    fn log_stderr_tail(&self, state: &ProcessState, reason: &str) {
        let tail = state
            .stderr_tail
            .lock()
            .map(|bytes| bytes.iter().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        tracing::warn!(
            plugin_id = %self.manifest.id,
            reason,
            stderr_tail_bytes = tail.len(),
            "plugin process terminated"
        );
    }

    pub fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<T> {
        self.ensure_started()?;
        self.call_started(method, params, timeout)
    }

    fn call_started<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<T> {
        let started_at = Instant::now();
        let (generation, id, receiver) = {
            let mut guard = self
                .state
                .lock()
                .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
            let state = guard.as_mut().ok_or_else(|| {
                PluginRuntimeError::Process("plugin process is not running".into())
            })?;
            if let Some(status) = state.child.try_wait()? {
                self.log_stderr_tail(state, "exited before call");
                *guard = None;
                return Err(PluginRuntimeError::Process(format!(
                    "plugin exited before call (status {status})"
                )));
            }
            let generation = state.generation;
            let id = state.next_id.fetch_add(1, Ordering::Relaxed);
            let (sender, receiver) = std::sync::mpsc::channel();
            state
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(
                    id,
                    PendingCall {
                        method: method.to_string(),
                        sender,
                    },
                );
            let frame = json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params,
            });
            let encoded = serde_json::to_string(&frame)?;
            if encoded.len() > MAX_FRAME_BYTES {
                state
                    .pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                return Err(PluginRuntimeError::Protocol(
                    "request frame exceeds size limit".to_string(),
                ));
            }
            if let Err(error) = state.writer.try_send(encoded) {
                state
                    .pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                drop(guard);
                self.mark_dead(generation, "request enqueue failed");
                return Err(match error {
                    TrySendError::Full(_) => {
                        PluginRuntimeError::Process("plugin stdin writer queue is full".to_string())
                    }
                    TrySendError::Disconnected(_) => PluginRuntimeError::Process(
                        "plugin stdin writer is unavailable".to_string(),
                    ),
                });
            }
            (generation, id, receiver)
        };

        let remaining = timeout.saturating_sub(started_at.elapsed());
        match receiver.recv_timeout(remaining) {
            Ok(Ok(value)) => match serde_json::from_value(value) {
                Ok(value) => Ok(value),
                Err(error) => {
                    self.mark_dead(generation, "invalid result payload");
                    Err(PluginRuntimeError::Protocol(format!(
                        "invalid result for {method}: {error}"
                    )))
                }
            },
            Ok(Err(PluginRuntimeError::Remote(message))) => {
                Err(PluginRuntimeError::Remote(message))
            }
            Ok(Err(error)) => {
                self.mark_dead(generation, "fatal call error");
                Err(error)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                self.mark_dead(generation, "call timeout");
                Err(PluginRuntimeError::Timeout(timeout))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                self.mark_dead(generation, "response channel disconnected");
                Err(PluginRuntimeError::Process(format!(
                    "plugin call {method} disconnected (id {id})"
                )))
            }
        }
    }

    fn mark_dead(&self, generation: u64, reason: &str) {
        let state = self.state.lock().ok().and_then(|mut guard| {
            guard
                .as_ref()
                .is_some_and(|state| state.generation == generation)
                .then(|| guard.take())
                .flatten()
        });
        if let Some(mut state) = state {
            self.log_stderr_tail(&state, reason);
            state.kill();
        }
    }

    fn encode_notification(method: &str, params: Value) -> Result<String> {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        Ok(serde_json::to_string(&frame)?)
    }
}

impl Drop for PluginProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn dispatch_frame(pending: &Mutex<BTreeMap<u64, PendingCall>>, frame: Value) {
    let Some(id) = frame.get("id").and_then(Value::as_u64) else {
        return;
    };
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    let Some(call) = pending.remove(&id) else {
        return;
    };
    if frame.get("error").is_some() {
        let _ = call.sender.send(Err(PluginRuntimeError::Remote(format!(
            "{}: plugin operation failed",
            call.method
        ))));
        return;
    }
    let result = frame.get("result").cloned().unwrap_or(Value::Null);
    let _ = call.sender.send(Ok(result));
}

fn fail_pending_writer_calls(pending: &Mutex<BTreeMap<u64, PendingCall>>, error: &std::io::Error) {
    let kind = error.kind();
    let message = error.to_string();
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    for (_, call) in std::mem::take(&mut *pending) {
        let error = std::io::Error::new(kind, message.clone());
        let _ = call.sender.send(Err(PluginRuntimeError::Io(error)));
    }
}

fn node_executable() -> PathBuf {
    std::env::var_os("TRANSLUNAR_NODE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"))
}

#[derive(Debug, Clone)]
pub struct ProcessDocumentFilter {
    process: Arc<PluginProcess>,
    descriptor: FilterDescriptor,
    granted_permissions: Vec<String>,
    activation_revision: u64,
    default_call_timeout: Duration,
    import_call_timeout: Duration,
}

impl ProcessDocumentFilter {
    pub fn new(
        process: Arc<PluginProcess>,
        descriptor: FilterDescriptor,
        granted_permissions: Vec<String>,
        activation_revision: u64,
    ) -> Self {
        Self {
            process,
            descriptor,
            granted_permissions,
            activation_revision,
            default_call_timeout: DEFAULT_CALL_TIMEOUT,
            import_call_timeout: IMPORT_CALL_TIMEOUT,
        }
    }

    pub fn with_call_timeouts(
        mut self,
        default_call_timeout: Duration,
        import_call_timeout: Duration,
    ) -> Self {
        self.default_call_timeout = default_call_timeout;
        self.import_call_timeout = import_call_timeout;
        self
    }

    fn require(&self, permission: &str, operation: &str) -> std::result::Result<(), FilterError> {
        ensure_permissions(&[permission.to_string()], &self.granted_permissions).map_err(|error| {
            FilterError::PluginPermissionDenied {
                plugin_id: self.process.manifest().id.clone(),
                filter_id: self.descriptor.id.clone(),
                operation: operation.to_string(),
                message: error.to_string(),
            }
        })
    }

    fn map_err(&self, operation: &str, error: PluginRuntimeError) -> FilterError {
        match error {
            PluginRuntimeError::PermissionDenied(message) => FilterError::PluginPermissionDenied {
                plugin_id: self.process.manifest().id.clone(),
                filter_id: self.descriptor.id.clone(),
                operation: operation.to_string(),
                message,
            },
            PluginRuntimeError::Remote(message) => FilterError::PluginOperationFailed {
                plugin_id: self.process.manifest().id.clone(),
                filter_id: self.descriptor.id.clone(),
                operation: operation.to_string(),
                message,
            },
            other => {
                let kind = match &other {
                    PluginRuntimeError::Timeout(_) => PluginProcessFailureKind::Timeout,
                    PluginRuntimeError::Protocol(_) | PluginRuntimeError::Json(_) => {
                        PluginProcessFailureKind::Protocol
                    }
                    PluginRuntimeError::Io(_) => PluginProcessFailureKind::Io,
                    PluginRuntimeError::Process(_)
                    | PluginRuntimeError::InvalidManifest(_)
                    | PluginRuntimeError::NotFound(_)
                    | PluginRuntimeError::Conflict(_) => PluginProcessFailureKind::Crash,
                    PluginRuntimeError::PermissionDenied(_) | PluginRuntimeError::Remote(_) => {
                        unreachable!("handled above")
                    }
                };
                FilterError::PluginProcessFailed {
                    plugin_id: self.process.manifest().id.clone(),
                    filter_id: self.descriptor.id.clone(),
                    operation: operation.to_string(),
                    activation_revision: self.activation_revision,
                    kind,
                    message: other.to_string(),
                }
            }
        }
    }
}

impl DocumentFilter for ProcessDocumentFilter {
    fn descriptor(&self) -> FilterDescriptor {
        self.descriptor.clone()
    }

    fn probe(&self, source: &Path) -> std::result::Result<ProbeResult, FilterError> {
        self.require("file.read:source", "filter.probe")?;
        let result = self
            .process
            .call::<ProbeResult>(
                "filter.probe",
                json!({ "sourcePath": path_string(source) }),
                self.default_call_timeout,
            )
            .map_err(|error| self.map_err("filter.probe", error))?;
        Ok(result)
    }

    fn import(
        &self,
        request: ImportRequest,
    ) -> std::result::Result<FilterEventStream, FilterError> {
        self.require("file.read:source", "filter.import")?;
        let events = self
            .process
            .call::<Vec<PluginFilterEvent>>(
                "filter.import",
                json!({
                    "sourcePath": path_string(&request.source),
                    "documentId": request.document_id,
                    "sourceLocale": request.source_locale,
                    "options": request.options,
                }),
                self.import_call_timeout,
            )
            .map_err(|error| self.map_err("filter.import", error))?;
        let mapped = events
            .into_iter()
            .map(|event| Ok::<FilterEvent, FilterError>(FilterEvent::from(event)));
        Ok(Box::new(mapped.collect::<Vec<_>>().into_iter()))
    }

    fn export(&self, request: ExportRequest<'_>) -> std::result::Result<ExportReport, FilterError> {
        self.require("file.read:source", "filter.export")?;
        self.require("file.write:output", "filter.export")?;
        self.process
            .call::<ExportReport>(
                "filter.export",
                json!({
                    "sourcePath": path_string(request.source),
                    "outputPath": path_string(request.output),
                    "segments": request.segments,
                }),
                self.import_call_timeout,
            )
            .map_err(|error| self.map_err("filter.export", error))
    }

    fn validate(&self, source: &Path) -> std::result::Result<ValidationReport, FilterError> {
        self.require("file.read:source", "filter.validate")?;
        self.process
            .call::<ValidationReport>(
                "filter.validate",
                json!({ "sourcePath": path_string(source) }),
                self.default_call_timeout,
            )
            .map_err(|error| self.map_err("filter.validate", error))
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Recursively copy a plugin package into the managed data directory.
pub fn copy_package(source: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        std::fs::remove_dir_all(destination)?;
    }
    copy_dir_all(source, destination)
}

fn copy_dir_all(source: &Path, destination: &Path) -> Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

pub fn remove_package(path: &Path) -> Result<()> {
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_manifest(dir: &Path, body: &str) {
        fs::write(dir.join(MANIFEST_FILE_NAME), body).expect("write manifest");
        fs::write(dir.join("entry.mjs"), "console.log('ok')").expect("write entry");
    }

    #[test]
    fn rejects_reserved_id_missing_entry_and_incompatible_api_range() {
        let manifest = json!({
            "manifestVersion": 1,
            "id": "example.invalid",
            "displayName": "Invalid fixture",
            "version": "0.1.0",
            "apiVersion": 1,
            "apiVersionMin": 1,
            "tier": "process",
            "entry": { "kind": "node", "path": "entry.mjs" },
            "contributions": { "filters": [{
                "id": "example.invalid",
                "version": "0.1.0",
                "displayName": "Invalid fixture",
                "extensions": ["invalid"],
                "capabilities": {
                    "import": true, "export": false, "validate": false,
                    "inlineTags": false, "notes": false,
                    "degradationReport": false
                }
            }] },
            "permissions": ["file.read:source"]
        });

        let reserved_dir = tempdir().expect("reserved id directory");
        let mut reserved = manifest.clone();
        reserved["id"] = json!("builtin.evil");
        write_manifest(reserved_dir.path(), &reserved.to_string());
        let error = load_manifest(reserved_dir.path()).expect_err("reserved id");
        assert!(error.to_string().contains("builtin"));

        let missing_dir = tempdir().expect("missing entry directory");
        fs::write(
            missing_dir.path().join(MANIFEST_FILE_NAME),
            manifest.to_string(),
        )
        .expect("write missing-entry manifest");
        let error = load_manifest(missing_dir.path()).expect_err("missing entry");
        assert!(error.to_string().contains("entry file missing"));

        let api_dir = tempdir().expect("API range directory");
        let mut incompatible = manifest;
        incompatible["apiVersion"] = json!(2);
        incompatible["apiVersionMin"] = json!(2);
        write_manifest(api_dir.path(), &incompatible.to_string());
        let error = load_manifest(api_dir.path()).expect_err("incompatible API range");
        assert!(error.to_string().contains("outside plugin range"));
    }

    #[test]
    fn accepts_valid_manifest() {
        let dir = tempdir().unwrap();
        write_manifest(
            dir.path(),
            r#"{
              "manifestVersion": 1,
              "id": "example.hello",
              "displayName": "Hello",
              "version": "0.1.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": { "kind": "node", "path": "entry.mjs" },
              "contributions": {
                "filters": [{
                  "id": "example.hello",
                  "version": "0.1.0",
                  "displayName": "Hello",
                  "extensions": ["srt"],
                  "capabilities": {
                    "import": true,
                    "export": true,
                    "validate": true,
                    "inlineTags": false,
                    "notes": false,
                    "degradationReport": true
                  }
                }]
              },
              "permissions": ["file.read:source", "file.write:output"]
            }"#,
        );
        let manifest = load_manifest(dir.path()).expect("valid");
        assert_eq!(manifest.id, "example.hello");
        assert_eq!(manifest.filter_descriptors().len(), 1);
    }

    #[test]
    fn permission_intersection_is_fail_closed() {
        let error = ensure_permissions(
            &["file.read:source".into(), "file.write:output".into()],
            &["file.read:source".into()],
        )
        .expect_err("missing write");
        assert!(matches!(error, PluginRuntimeError::PermissionDenied(_)));
    }

    #[test]
    fn writer_io_failure_retains_io_classification_at_the_filter_boundary() {
        let dir = tempdir().expect("plugin directory");
        write_manifest(
            dir.path(),
            r#"{
              "manifestVersion": 1,
              "id": "example.writer-io",
              "displayName": "Writer I/O fixture",
              "version": "0.1.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": { "kind": "node", "path": "entry.mjs" },
              "contributions": { "filters": [{
                "id": "example.writer-io",
                "version": "0.1.0",
                "displayName": "Writer I/O fixture",
                "extensions": ["writer-io"],
                "capabilities": {
                  "import": true, "export": false, "validate": false,
                  "inlineTags": false, "notes": false,
                  "degradationReport": false
                }
              }] },
              "permissions": ["file.read:source"]
            }"#,
        );
        fs::write(dir.path().join("entry.mjs"), "").expect("write entry");
        let manifest = load_manifest(dir.path()).expect("fixture manifest");
        let descriptor = manifest.filter_descriptors().remove(0);
        let process = Arc::new(PluginProcess::new(dir.path().to_path_buf(), manifest));
        let filter = ProcessDocumentFilter::new(
            process,
            descriptor,
            vec!["file.read:source".to_string()],
            7,
        );
        let (sender, receiver) = std::sync::mpsc::channel();
        let pending = Mutex::new(BTreeMap::from([(
            1,
            PendingCall {
                method: "filter.probe".to_string(),
                sender,
            },
        )]));

        fail_pending_writer_calls(
            &pending,
            &std::io::Error::new(std::io::ErrorKind::BrokenPipe, "fixture broken pipe"),
        );
        let runtime_error = receiver
            .recv()
            .expect("writer failure response")
            .expect_err("writer failure must fail the pending call");
        assert!(matches!(runtime_error, PluginRuntimeError::Io(_)));
        assert!(matches!(
            filter.map_err("filter.probe", runtime_error),
            FilterError::PluginProcessFailed {
                kind: PluginProcessFailureKind::Io,
                activation_revision: 7,
                ..
            }
        ));
    }

    #[test]
    fn timeout_kills_only_the_plugin_and_restart_keeps_host_environment_clear() {
        let dir = tempdir().expect("plugin directory");
        write_manifest(
            dir.path(),
            r#"{
              "manifestVersion": 1,
              "id": "example.timeout",
              "displayName": "Timeout fixture",
              "version": "0.1.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": { "kind": "node", "path": "entry.mjs" },
              "contributions": {
                "filters": [{
                  "id": "example.timeout",
                  "version": "0.1.0",
                  "displayName": "Timeout fixture",
                  "extensions": ["timeout"],
                  "capabilities": {
                    "import": true,
                    "export": false,
                    "validate": false,
                    "inlineTags": false,
                    "notes": false,
                    "degradationReport": false
                  }
                }]
              },
              "permissions": ["file.read:source"]
            }"#,
        );
        fs::write(
            dir.path().join("entry.mjs"),
            r#"import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "test.timeout") return;
  const result = request.method === "plugin.handshake"
    ? { apiVersion: 1, pluginId: "example.timeout", contributions: { filters: [] } }
    : request.method === "test.path"
      ? (process.env.PATH ?? null)
      : {};
  if (request.method === "test.remote") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "fixture details" } })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
"#,
        )
        .expect("write process fixture");
        let manifest = load_manifest(dir.path()).expect("fixture manifest");
        let process = PluginProcess::new(dir.path().to_path_buf(), manifest);

        let inherited_path: Option<String> = process
            .call("test.path", json!({}), Duration::from_secs(2))
            .expect("environment probe");
        assert_eq!(inherited_path, None);
        let generation = process
            .state
            .lock()
            .expect("process state")
            .as_ref()
            .expect("running process")
            .generation;

        let remote = process
            .call::<Value>("test.remote", json!({}), Duration::from_secs(2))
            .expect_err("remote operation must fail");
        assert!(matches!(remote, PluginRuntimeError::Remote(_)));
        assert_eq!(
            process
                .state
                .lock()
                .expect("process state")
                .as_ref()
                .expect("remote error keeps process alive")
                .generation,
            generation
        );
        let still_usable: Option<String> = process
            .call("test.path", json!({}), Duration::from_secs(2))
            .expect("remote error does not poison process");
        assert_eq!(still_usable, None);

        let error = process
            .call::<Value>("test.timeout", json!({}), Duration::from_millis(50))
            .expect_err("call must time out");
        assert!(matches!(error, PluginRuntimeError::Timeout(_)));

        let inherited_path_after_restart: Option<String> = process
            .call("test.path", json!({}), Duration::from_secs(2))
            .expect("plugin restarts after timeout");
        assert_eq!(inherited_path_after_restart, None);
    }

    #[test]
    fn rejected_handshake_never_exposes_an_uninitialized_process() {
        let dir = tempdir().expect("plugin directory");
        write_manifest(
            dir.path(),
            r#"{
              "manifestVersion": 1,
              "id": "example.reject-handshake",
              "displayName": "Reject handshake fixture",
              "version": "0.1.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": { "kind": "node", "path": "entry.mjs" },
              "contributions": { "filters": [{
                "id": "example.reject-handshake",
                "version": "0.1.0",
                "displayName": "Reject handshake fixture",
                "extensions": ["reject"],
                "capabilities": {
                  "import": true, "export": false, "validate": false,
                  "inlineTags": false, "notes": false,
                  "degradationReport": false
                }
              }] },
              "permissions": ["file.read:source"]
            }"#,
        );
        fs::write(
            dir.path().join("entry.mjs"),
            r#"import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "no" } })}\n`);
});
"#,
        )
        .expect("write rejecting process");
        let manifest = load_manifest(dir.path()).expect("fixture manifest");
        let process = PluginProcess::new(dir.path().to_path_buf(), manifest);

        let error = process.ensure_started().expect_err("handshake must fail");
        assert!(matches!(error, PluginRuntimeError::Protocol(_)));
        assert!(process.state.lock().expect("process state").is_none());
    }

    #[test]
    fn writer_backpressure_obeys_deadline_and_recovers_with_a_new_generation() {
        let dir = tempdir().expect("plugin directory");
        write_manifest(
            dir.path(),
            r#"{
              "manifestVersion": 1,
              "id": "example.backpressure",
              "displayName": "Backpressure fixture",
              "version": "0.1.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": { "kind": "node", "path": "entry.mjs" },
              "contributions": { "filters": [{
                "id": "example.backpressure",
                "version": "0.1.0",
                "displayName": "Backpressure fixture",
                "extensions": ["blocked"],
                "capabilities": {
                  "import": true, "export": false, "validate": false,
                  "inlineTags": false, "notes": false,
                  "degradationReport": false
                }
              }] },
              "permissions": ["file.read:source"]
            }"#,
        );
        fs::write(
            dir.path().join("entry.mjs"),
            r#"import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const marker = ".backpressure-observed";
const blockThisGeneration = !existsSync(marker);
if (blockThisGeneration) writeFileSync(marker, "blocked");
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  const result = request.method === "plugin.handshake"
    ? { apiVersion: 1, pluginId: "example.backpressure", contributions: { filters: [] } }
    : "recovered";
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
  if (request.method === "plugin.handshake" && blockThisGeneration) {
    rl.close();
    process.stdin.pause();
  }
});
setInterval(() => {}, 1_000);
"#,
        )
        .expect("write backpressure fixture");
        let manifest = load_manifest(dir.path()).expect("fixture manifest");
        let process = PluginProcess::new(dir.path().to_path_buf(), manifest);
        process
            .ensure_started()
            .expect("first generation handshake");

        let started_at = Instant::now();
        let error = process
            .call::<Value>(
                "test.backpressure",
                json!({ "payload": "x".repeat(4 * 1024 * 1024) }),
                Duration::from_millis(100),
            )
            .expect_err("blocked writer must honor the deadline");
        assert!(matches!(error, PluginRuntimeError::Timeout(_)));
        assert!(
            started_at.elapsed() < Duration::from_secs(2),
            "wall-clock deadline was not bounded"
        );

        let recovered: String = process
            .call("test.recovered", json!({}), Duration::from_secs(2))
            .expect("next generation remains usable");
        assert_eq!(recovered, "recovered");
    }
}
