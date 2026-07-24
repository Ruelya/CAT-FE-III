//! Local plugin manifest validation, process host, and filter adapters.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use translunar_domain::{DegradationFinding, DocumentNote, InlineTag};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport,
};

pub const HOST_API_VERSION: u32 = 1;
pub const MANIFEST_FILE_NAME: &str = "manifest.json";
const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const IMPORT_CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_TAIL_LINES: usize = 40;

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
    child: Child,
    stdin: ChildStdin,
    pending: Arc<Mutex<BTreeMap<u64, PendingCall>>>,
    next_id: AtomicU64,
    stderr_tail: Arc<Mutex<Vec<String>>>,
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
}

impl PluginProcess {
    pub fn new(package_dir: PathBuf, manifest: PluginManifest) -> Self {
        Self {
            package_dir,
            manifest,
            state: Mutex::new(None),
        }
    }

    pub fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    pub fn ensure_started(&self) -> Result<()> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
        if guard.is_some() {
            return Ok(());
        }
        *guard = Some(self.spawn_locked()?);
        drop(guard);
        let handshake: HandshakeResult =
            self.call("plugin.handshake", json!({}), DEFAULT_CALL_TIMEOUT)?;
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
        if let Ok(mut guard) = self.state.lock()
            && let Some(mut state) = guard.take()
        {
            let _ = Self::write_notification(&mut state.stdin, "plugin.shutdown", json!({}));
            state.kill();
        }
    }

    fn spawn_locked(&self) -> Result<ProcessState> {
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
            .env("TRANSLUNAR_PLUGIN_ID", &self.manifest.id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
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
        let stderr_tail = Arc::new(Mutex::new(Vec::new()));
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
        {
            let stderr_tail = Arc::clone(&stderr_tail);
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(|line| line.ok()) {
                    let mut tail = stderr_tail
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    tail.push(line);
                    if tail.len() > MAX_STDERR_TAIL_LINES {
                        let overflow = tail.len() - MAX_STDERR_TAIL_LINES;
                        tail.drain(0..overflow);
                    }
                }
            });
        }
        Ok(ProcessState {
            child,
            stdin,
            pending,
            next_id: AtomicU64::new(1),
            stderr_tail,
        })
    }

    pub fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<T> {
        self.ensure_started()?;
        let (id, receiver) = {
            let mut guard = self
                .state
                .lock()
                .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
            let state = guard.as_mut().ok_or_else(|| {
                PluginRuntimeError::Process("plugin process is not running".into())
            })?;
            if let Some(status) = state.child.try_wait()? {
                let tail = state
                    .stderr_tail
                    .lock()
                    .map(|lines| lines.join("\n"))
                    .unwrap_or_default();
                *guard = None;
                return Err(PluginRuntimeError::Process(format!(
                    "plugin exited before call (status {status}): {tail}"
                )));
            }
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
            writeln!(state.stdin, "{encoded}")?;
            state.stdin.flush()?;
            (id, receiver)
        };

        match receiver.recv_timeout(timeout) {
            Ok(Ok(value)) => Ok(serde_json::from_value(value)?),
            Ok(Err(error)) => {
                self.mark_dead();
                Err(error)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                self.mark_dead();
                Err(PluginRuntimeError::Timeout(timeout))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                self.mark_dead();
                Err(PluginRuntimeError::Process(format!(
                    "plugin call {method} disconnected (id {id})"
                )))
            }
        }
    }

    fn mark_dead(&self) {
        if let Ok(mut guard) = self.state.lock()
            && let Some(mut state) = guard.take()
        {
            state.kill();
        }
    }

    fn write_notification(stdin: &mut ChildStdin, method: &str, params: Value) -> Result<()> {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        writeln!(stdin, "{}", serde_json::to_string(&frame)?)?;
        stdin.flush()?;
        Ok(())
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
    if let Some(error) = frame.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("plugin returned an error");
        let _ = call.sender.send(Err(PluginRuntimeError::Protocol(format!(
            "{}: {message}",
            call.method
        ))));
        return;
    }
    let result = frame.get("result").cloned().unwrap_or(Value::Null);
    let _ = call.sender.send(Ok(result));
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
}

impl ProcessDocumentFilter {
    pub fn new(
        process: Arc<PluginProcess>,
        descriptor: FilterDescriptor,
        granted_permissions: Vec<String>,
    ) -> Self {
        Self {
            process,
            descriptor,
            granted_permissions,
        }
    }

    fn require(&self, permission: &str) -> std::result::Result<(), FilterError> {
        ensure_permissions(&[permission.to_string()], &self.granted_permissions)
            .map_err(|error| FilterError::Processing(error.to_string()))
    }

    fn map_err(error: PluginRuntimeError) -> FilterError {
        match error {
            PluginRuntimeError::PermissionDenied(message) => {
                FilterError::Processing(format!("permission denied: {message}"))
            }
            PluginRuntimeError::Timeout(duration) => {
                FilterError::Processing(format!("plugin timed out after {duration:?}"))
            }
            other => FilterError::Processing(other.to_string()),
        }
    }
}

impl DocumentFilter for ProcessDocumentFilter {
    fn descriptor(&self) -> FilterDescriptor {
        self.descriptor.clone()
    }

    fn probe(&self, source: &Path) -> std::result::Result<ProbeResult, FilterError> {
        self.require("file.read:source")?;
        let result = self
            .process
            .call::<ProbeResult>(
                "filter.probe",
                json!({ "sourcePath": path_string(source) }),
                DEFAULT_CALL_TIMEOUT,
            )
            .map_err(Self::map_err)?;
        Ok(result)
    }

    fn import(
        &self,
        request: ImportRequest,
    ) -> std::result::Result<FilterEventStream, FilterError> {
        self.require("file.read:source")?;
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
                IMPORT_CALL_TIMEOUT,
            )
            .map_err(Self::map_err)?;
        let mapped = events
            .into_iter()
            .map(|event| Ok::<FilterEvent, FilterError>(FilterEvent::from(event)));
        Ok(Box::new(mapped.collect::<Vec<_>>().into_iter()))
    }

    fn export(&self, request: ExportRequest<'_>) -> std::result::Result<ExportReport, FilterError> {
        self.require("file.read:source")?;
        self.require("file.write:output")?;
        self.process
            .call::<ExportReport>(
                "filter.export",
                json!({
                    "sourcePath": path_string(request.source),
                    "outputPath": path_string(request.output),
                    "segments": request.segments,
                }),
                IMPORT_CALL_TIMEOUT,
            )
            .map_err(Self::map_err)
    }

    fn validate(&self, source: &Path) -> std::result::Result<ValidationReport, FilterError> {
        self.require("file.read:source")?;
        self.process
            .call::<ValidationReport>(
                "filter.validate",
                json!({ "sourcePath": path_string(source) }),
                DEFAULT_CALL_TIMEOUT,
            )
            .map_err(Self::map_err)
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
    fn rejects_builtin_prefix_and_missing_entry() {
        let dir = tempdir().unwrap();
        write_manifest(
            dir.path(),
            r#"{
              "manifestVersion": 1,
              "id": "builtin.evil",
              "displayName": "Evil",
              "version": "0.1.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": { "kind": "node", "path": "missing.mjs" },
              "contributions": {
                "filters": [{
                  "id": "example.x",
                  "version": "0.1.0",
                  "displayName": "X",
                  "extensions": ["x"],
                  "capabilities": {
                    "import": true,
                    "export": true,
                    "validate": true,
                    "inlineTags": false,
                    "notes": false,
                    "degradationReport": false
                  }
                }]
              },
              "permissions": ["file.read:source"]
            }"#,
        );
        let error = load_manifest(dir.path()).expect_err("builtin id");
        assert!(error.to_string().contains("builtin"));
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
}
