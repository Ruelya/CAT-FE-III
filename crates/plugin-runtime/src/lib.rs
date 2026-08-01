//! Local plugin manifest validation, process host, and filter adapters.

mod ai_ui;
mod connector;
mod declarative;
mod external_connector;
mod package_archive;
mod qa_pipeline;
mod sandbox;

pub use ai_ui::*;
pub use connector::*;
pub use declarative::{
    DECLARATIVE_DEFINITION_VERSION, DeclarativeDocumentFilter, DeclarativeFilterDefinitionV1,
    DeclarativeFilterLimits, DeclarativePipelineDefinitionV1, DeclarativePipelineOperation,
    DeclarativeQaPackDefinitionV1,
};
pub use external_connector::*;
pub use package_archive::{
    MAX_ARCHIVE_BYTES, MAX_COMPRESSION_RATIO, PluginDistributionMetadata, PluginPackageSourceKind,
    TLPLUGIN_EXTENSION, TLPLUGIN_FORMAT_MARKER, TLPLUGIN_FORMAT_VERSION, build_tlplugin_archive,
    extract_tlplugin_archive, inspect_plugin_source, is_tlplugin_path, materialize_plugin_package,
    package_has_license_file, validate_release_package_requirements,
};
pub use qa_pipeline::*;
pub use sandbox::{
    DEFAULT_SANDBOX_LIMITS, SANDBOX_PROTOCOL_VERSION, SandboxCancellationToken,
    SandboxDocumentFilter, SandboxError, SandboxFailureKind, SandboxHostCallContext,
    SandboxHostCallRegistry, SandboxHostCallV1, SandboxHostMethod, SandboxInvocationV1,
    SandboxLifecycleContextV1, SandboxLimits, SandboxPluginErrorV1, SandboxResultV1,
    SandboxRuntimeConfig, SandboxRuntimeKey, SandboxRuntimeRegistry, SandboxWorkerHandle,
    SandboxWorkerState, sandbox_safe_diagnostic,
};

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;
use translunar_domain::{DegradationFinding, DocumentNote, InlineTag};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest,
    PluginProcessFailureKind, ProbeResult, ValidationReport,
};
pub const HOST_API_VERSION: u32 = 1;
pub const MANIFEST_FILE_NAME: &str = "manifest.json";
pub const NORMALIZED_MANIFEST_VERSION: u32 = 1;
pub const MANIFEST_VERSION_V1: u32 = 1;
pub const MANIFEST_VERSION_V2: u32 = 2;
pub const RUNTIME_DESCRIPTOR_VERSION: u32 = 1;
pub const CONTRIBUTION_DESCRIPTOR_VERSION: u32 = 1;
pub const PROCESS_PROTOCOL_VERSION: u32 = 1;
pub const PACKAGE_HASH_ALGORITHM: &str = "sha256";
pub const PACKAGE_HASH_VERSION: u32 = 1;
const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const IMPORT_CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_TAIL_BYTES: usize = 16 * 1024;
const WRITER_QUEUE_CAPACITY: usize = 64;
const CONNECTOR_EVENT_QUEUE_CAPACITY: usize = 64;
const CONNECTOR_RESPONSE_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_ID_BYTES: usize = 128;
const MAX_VERSION_BYTES: usize = 128;
const MAX_DISPLAY_NAME_BYTES: usize = 256;
const MAX_SHORT_STRING_BYTES: usize = 256;
const MAX_LONG_STRING_BYTES: usize = 16 * 1024;
const MAX_PERMISSION_COUNT: usize = 64;
const MAX_PERMISSION_BYTES: usize = 256;
const MAX_CONTRIBUTION_COUNT: usize = 256;
const MAX_LIST_ITEMS: usize = 256;
const MAX_MAP_ENTRIES: usize = 128;
const MAX_JSON_DESCRIPTOR_BYTES: usize = 64 * 1024;
const MAX_JSON_DEPTH: usize = 16;
pub(crate) const MAX_PACKAGE_FILES: usize = 4096;
pub(crate) const MAX_PACKAGE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_PACKAGE_PATH_BYTES: usize = 512;
pub(crate) const MAX_PACKAGE_DEPTH: usize = 32;

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
    #[error("unsupported plugin {component} version {version}")]
    UnsupportedVersion { component: String, version: u32 },
    #[error("host API {host} outside plugin range {min}..={max}")]
    IncompatibleHost { min: u32, max: u32, host: u32 },
    #[error("plugin capability unsupported: {0}")]
    CapabilityUnsupported(String),
    #[error("plugin package invalid: {0}")]
    PackageInvalid(String),
    #[error("plugin package hash mismatch: expected {expected}, actual {actual}")]
    PackageHashMismatch { expected: String, actual: String },
    #[error("plugin process failed: {0}")]
    Process(String),
    #[error("plugin protocol error: {0}")]
    Protocol(String),
    #[error("plugin operation failed: {0}")]
    Remote(String),
    #[error("external connector failed: {0:?}")]
    ExternalConnectorFailure(ExternalConnectorFailureV1),
    #[error("plugin timed out after {0:?}")]
    Timeout(Duration),
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON failed: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, PluginRuntimeError>;

/// Stable capability identifiers shared by manifests, persistence, Engine
/// enforcement, and the public protocol.  The identifiers intentionally use
/// dotted names so they remain readable in audit records and can be extended
/// without changing the wire shape.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PluginCapabilityId {
    FileRead,
    FileWrite,
    NetworkConnect,
    AssetRead,
    AssetWrite,
    ProjectRead,
    ProjectWrite,
    EngineConnector,
    QaRegister,
    PipelineRegister,
    AiAction,
    UiPanel,
    ExternalConnector,
    DiagnosticsRead,
    Unsupported(String),
}

impl PluginCapabilityId {
    pub fn parse(value: &str) -> Result<Self> {
        require_id(value, "capability id")?;
        Ok(match value {
            "file.read" => Self::FileRead,
            "file.write" => Self::FileWrite,
            "network.connect" => Self::NetworkConnect,
            "asset.read" => Self::AssetRead,
            "asset.write" => Self::AssetWrite,
            "project.read" => Self::ProjectRead,
            "project.write" => Self::ProjectWrite,
            "engine.connector" => Self::EngineConnector,
            "qa.register" => Self::QaRegister,
            "pipeline.register" => Self::PipelineRegister,
            "ai.action" => Self::AiAction,
            "ui.panel" => Self::UiPanel,
            "external.connector" => Self::ExternalConnector,
            "diagnostics.read" => Self::DiagnosticsRead,
            other => Self::Unsupported(other.to_string()),
        })
    }

    pub const fn is_supported(&self) -> bool {
        !matches!(self, Self::Unsupported(_))
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::FileRead => "file.read",
            Self::FileWrite => "file.write",
            Self::NetworkConnect => "network.connect",
            Self::AssetRead => "asset.read",
            Self::AssetWrite => "asset.write",
            Self::ProjectRead => "project.read",
            Self::ProjectWrite => "project.write",
            Self::EngineConnector => "engine.connector",
            Self::QaRegister => "qa.register",
            Self::PipelineRegister => "pipeline.register",
            Self::AiAction => "ai.action",
            Self::UiPanel => "ui.panel",
            Self::ExternalConnector => "external.connector",
            Self::DiagnosticsRead => "diagnostics.read",
            Self::Unsupported(value) => value,
        }
    }
}

impl Serialize for PluginCapabilityId {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for PluginCapabilityId {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(serde::de::Error::custom)
    }
}

impl JsonSchema for PluginCapabilityId {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "PluginCapabilityId".into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        generator.subschema_for::<String>()
    }
}

impl std::fmt::Display for PluginCapabilityId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum PluginFileArea {
    Source,
    Output,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginCapabilityScope {
    #[default]
    Unscoped,
    File {
        areas: Vec<PluginFileArea>,
    },
    Network {
        origins: Vec<String>,
    },
    Projects {
        project_ids: Vec<String>,
    },
    Assets {
        project_ids: Vec<String>,
        asset_ids: Vec<String>,
    },
    Operations {
        operations: Vec<String>,
    },
    Contributions {
        contribution_ids: Vec<String>,
    },
    Diagnostics {
        categories: Vec<String>,
    },
}

impl PluginCapabilityScope {
    /// Normalize ordering, trim bounded strings, and reject malformed scopes.
    /// The returned representation is deterministic, which makes semantic
    /// upgrade comparisons and SQLite uniqueness checks reliable.
    pub fn normalized(&self) -> Result<Self> {
        const MAX_SCOPE_ITEMS: usize = 64;
        const MAX_SCOPE_TEXT: usize = 512;
        fn strings(values: &[String], label: &str) -> Result<Vec<String>> {
            if values.is_empty() || values.len() > MAX_SCOPE_ITEMS {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "{label} must contain between one and {MAX_SCOPE_ITEMS} items"
                )));
            }
            let mut result = values
                .iter()
                .map(|value| {
                    let trimmed = value.trim();
                    if trimmed.is_empty()
                        || trimmed.len() > MAX_SCOPE_TEXT
                        || trimmed != value
                        || trimmed.chars().any(char::is_control)
                    {
                        return Err(PluginRuntimeError::InvalidManifest(format!(
                            "{label} contains an invalid value"
                        )));
                    }
                    Ok(trimmed.to_string())
                })
                .collect::<Result<Vec<_>>>()?;
            result.sort();
            result.dedup();
            Ok(result)
        }

        match self {
            Self::Unscoped => Ok(Self::Unscoped),
            Self::File { areas } => {
                if areas.is_empty() || areas.len() > 2 {
                    return Err(PluginRuntimeError::InvalidManifest(
                        "file scope must name at least one managed area".to_string(),
                    ));
                }
                let mut areas = areas.clone();
                areas.sort();
                areas.dedup();
                Ok(Self::File { areas })
            }
            Self::Network { origins } => Ok(Self::Network {
                origins: strings(origins, "network origins")?,
            }),
            Self::Projects { project_ids } => Ok(Self::Projects {
                project_ids: strings(project_ids, "project scope")?,
            }),
            Self::Assets {
                project_ids,
                asset_ids,
            } => {
                if project_ids.is_empty() && asset_ids.is_empty() {
                    return Err(PluginRuntimeError::InvalidManifest(
                        "asset scope must name at least one project or asset".to_string(),
                    ));
                }
                Ok(Self::Assets {
                    project_ids: if project_ids.is_empty() {
                        Vec::new()
                    } else {
                        strings(project_ids, "asset project scope")?
                    },
                    asset_ids: if asset_ids.is_empty() {
                        Vec::new()
                    } else {
                        strings(asset_ids, "asset scope")?
                    },
                })
            }
            Self::Operations { operations } => Ok(Self::Operations {
                operations: strings(operations, "operation scope")?,
            }),
            Self::Contributions { contribution_ids } => Ok(Self::Contributions {
                contribution_ids: strings(contribution_ids, "contribution scope")?,
            }),
            Self::Diagnostics { categories } => Ok(Self::Diagnostics {
                categories: strings(categories, "diagnostic scope")?,
            }),
        }
    }

    /// Return true when `candidate` is contained by this scope.  This is used
    /// both when narrowing a grant and at every privileged operation boundary.
    pub fn allows(&self, candidate: &Self) -> bool {
        match (self, candidate) {
            (Self::Unscoped, Self::Unscoped) => true,
            (Self::File { areas }, Self::File { areas: requested }) => {
                requested.iter().all(|area| areas.contains(area))
            }
            (Self::Network { origins }, Self::Network { origins: requested }) => requested
                .iter()
                .all(|origin| origins.iter().any(|item| item == "*" || item == origin)),
            (
                Self::Projects { project_ids },
                Self::Projects {
                    project_ids: requested,
                },
            ) => requested.iter().all(|project| {
                project_ids
                    .iter()
                    .any(|item| item == "*" || item == project)
            }),
            (
                Self::Assets {
                    project_ids,
                    asset_ids,
                },
                Self::Assets {
                    project_ids: requested_projects,
                    asset_ids: requested_assets,
                },
            ) => {
                requested_projects.iter().all(|project| {
                    project_ids
                        .iter()
                        .any(|item| item == "*" || item == project)
                }) && requested_assets
                    .iter()
                    .all(|asset| asset_ids.iter().any(|item| item == "*" || item == asset))
            }
            (
                Self::Operations { operations },
                Self::Operations {
                    operations: requested,
                },
            ) => requested.iter().all(|operation| {
                operations
                    .iter()
                    .any(|item| item == "*" || item == operation)
            }),
            (
                Self::Contributions { contribution_ids },
                Self::Contributions {
                    contribution_ids: requested,
                },
            ) => requested.iter().all(|id| {
                contribution_ids
                    .iter()
                    .any(|item| item == "*" || item == id)
            }),
            (
                Self::Diagnostics { categories },
                Self::Diagnostics {
                    categories: requested,
                },
            ) => requested.iter().all(|category| {
                categories
                    .iter()
                    .any(|item| item == "*" || item == category)
            }),
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityRequest {
    pub capability_id: PluginCapabilityId,
    #[serde(default = "default_required")]
    pub required: bool,
    #[serde(default)]
    pub scope: PluginCapabilityScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginCapabilityDecision {
    Pending,
    Granted,
    Denied,
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginCapabilityAuditEvent {
    Requested,
    Granted,
    Denied,
    Revoked,
    Carried,
    OperationAllowed,
    OperationDenied,
    Detached,
}

impl PluginCapabilityAuditEvent {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
            Self::Carried => "carried",
            Self::OperationAllowed => "operation_allowed",
            Self::OperationDenied => "operation_denied",
            Self::Detached => "detached",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "requested" => Ok(Self::Requested),
            "granted" => Ok(Self::Granted),
            "denied" => Ok(Self::Denied),
            "revoked" => Ok(Self::Revoked),
            "carried" => Ok(Self::Carried),
            "operation_allowed" => Ok(Self::OperationAllowed),
            "operation_denied" => Ok(Self::OperationDenied),
            "detached" => Ok(Self::Detached),
            other => Err(PluginRuntimeError::InvalidManifest(format!(
                "unknown capability audit event {other}"
            ))),
        }
    }
}

impl PluginCapabilityDecision {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "granted" => Ok(Self::Granted),
            "denied" => Ok(Self::Denied),
            "revoked" => Ok(Self::Revoked),
            other => Err(PluginRuntimeError::InvalidManifest(format!(
                "unknown capability decision {other}"
            ))),
        }
    }
}

fn default_required() -> bool {
    true
}

impl PluginCapabilityRequest {
    pub fn normalized(&self) -> Result<Self> {
        let scope = self.scope.normalized()?;
        if let PluginCapabilityId::Unsupported(capability_id) = &self.capability_id {
            if self.required {
                return Err(PluginRuntimeError::CapabilityUnsupported(
                    capability_id.clone(),
                ));
            }
            if let Some(id) = &self.contribution_id {
                require_id(id, "capability contribution id")?;
            }
            return Ok(Self {
                scope,
                ..self.clone()
            });
        }
        let scope_matches_capability = matches!(
            (&self.capability_id, &scope),
            (
                PluginCapabilityId::FileRead | PluginCapabilityId::FileWrite,
                PluginCapabilityScope::File { .. }
            ) | (
                PluginCapabilityId::NetworkConnect,
                PluginCapabilityScope::Network { .. }
            ) | (
                PluginCapabilityId::AssetRead | PluginCapabilityId::AssetWrite,
                PluginCapabilityScope::Assets { .. }
            ) | (
                PluginCapabilityId::ProjectRead | PluginCapabilityId::ProjectWrite,
                PluginCapabilityScope::Projects { .. }
            ) | (
                PluginCapabilityId::EngineConnector | PluginCapabilityId::ExternalConnector,
                PluginCapabilityScope::Operations { .. }
            ) | (
                PluginCapabilityId::QaRegister
                    | PluginCapabilityId::PipelineRegister
                    | PluginCapabilityId::AiAction
                    | PluginCapabilityId::UiPanel,
                PluginCapabilityScope::Contributions { .. }
            ) | (
                PluginCapabilityId::DiagnosticsRead,
                PluginCapabilityScope::Diagnostics { .. }
            )
        );
        if !scope_matches_capability {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "scope kind does not match capability {}",
                self.capability_id
            )));
        }
        if let Some(id) = &self.contribution_id {
            require_id(id, "capability contribution id")?;
        }
        Ok(Self {
            scope,
            ..self.clone()
        })
    }

    pub fn semantic_key(&self) -> Result<String> {
        let normalized = self.normalized()?;
        serde_json::to_string(&normalized).map_err(PluginRuntimeError::Json)
    }

    pub fn legacy_name(&self) -> String {
        match (&self.capability_id, &self.scope) {
            (PluginCapabilityId::FileRead, PluginCapabilityScope::File { areas })
                if areas == &[PluginFileArea::Source] =>
            {
                "file.read:source".to_string()
            }
            (PluginCapabilityId::FileWrite, PluginCapabilityScope::File { areas })
                if areas == &[PluginFileArea::Output] =>
            {
                "file.write:output".to_string()
            }
            (PluginCapabilityId::NetworkConnect, PluginCapabilityScope::Network { origins })
                if origins.len() == 1 =>
            {
                format!("network:{}", origins[0])
            }
            _ => self.capability_id.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityCheck {
    pub plugin_id: String,
    pub version_id: String,
    pub capability_id: PluginCapabilityId,
    pub scope: PluginCapabilityScope,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginCapabilityDenialCode {
    NotRequested,
    Pending,
    Denied,
    Revoked,
    ScopeMismatch,
    Malformed,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityDenial {
    pub code: PluginCapabilityDenialCode,
    pub plugin_id: String,
    pub version_id: String,
    pub capability_id: PluginCapabilityId,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub message: String,
}

impl std::fmt::Display for PluginCapabilityDenial {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} for {} during {}",
            self.message, self.capability_id, self.operation
        )
    }
}

pub trait PluginCapabilityAuthorizer: Send + Sync + std::fmt::Debug {
    fn authorize(
        &self,
        check: &PluginCapabilityCheck,
    ) -> std::result::Result<(), Box<PluginCapabilityDenial>>;

    fn authorize_registration(
        &self,
        check: &PluginCapabilityCheck,
    ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
        self.authorize(check)
    }
}

/// Convert the released string permission vocabulary into typed requests.
/// Unknown strings are rejected instead of being silently treated as grants.
pub fn parse_legacy_permission(permission: &str) -> Result<PluginCapabilityRequest> {
    validate_permission_name(permission)?;
    let (capability_id, scope) = match permission {
        "file.read:source" => (
            PluginCapabilityId::FileRead,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Source],
            },
        ),
        "file.write:output" => (
            PluginCapabilityId::FileWrite,
            PluginCapabilityScope::File {
                areas: vec![PluginFileArea::Output],
            },
        ),
        value if value.starts_with("network:") => (
            PluginCapabilityId::NetworkConnect,
            PluginCapabilityScope::Network {
                origins: vec![value["network:".len()..].to_string()],
            },
        ),
        value if value.starts_with("asset.read:") => (
            PluginCapabilityId::AssetRead,
            PluginCapabilityScope::Assets {
                project_ids: Vec::new(),
                asset_ids: vec![value["asset.read:".len()..].to_string()],
            },
        ),
        value if value.starts_with("asset.write:") => (
            PluginCapabilityId::AssetWrite,
            PluginCapabilityScope::Assets {
                project_ids: Vec::new(),
                asset_ids: vec![value["asset.write:".len()..].to_string()],
            },
        ),
        value if value.starts_with("project.read:") => (
            PluginCapabilityId::ProjectRead,
            PluginCapabilityScope::Projects {
                project_ids: vec![value["project.read:".len()..].to_string()],
            },
        ),
        value if value.starts_with("project.write:") => (
            PluginCapabilityId::ProjectWrite,
            PluginCapabilityScope::Projects {
                project_ids: vec![value["project.write:".len()..].to_string()],
            },
        ),
        value if value.starts_with("engine.connector:") => (
            PluginCapabilityId::EngineConnector,
            PluginCapabilityScope::Operations {
                operations: vec![value["engine.connector:".len()..].to_string()],
            },
        ),
        value if value.starts_with("qa.register:") => (
            PluginCapabilityId::QaRegister,
            PluginCapabilityScope::Contributions {
                contribution_ids: vec![value["qa.register:".len()..].to_string()],
            },
        ),
        value if value.starts_with("pipeline.register:") => (
            PluginCapabilityId::PipelineRegister,
            PluginCapabilityScope::Contributions {
                contribution_ids: vec![value["pipeline.register:".len()..].to_string()],
            },
        ),
        value if value.starts_with("ai.action:") => (
            PluginCapabilityId::AiAction,
            PluginCapabilityScope::Contributions {
                contribution_ids: vec![value["ai.action:".len()..].to_string()],
            },
        ),
        value if value.starts_with("ui.panel:") => (
            PluginCapabilityId::UiPanel,
            PluginCapabilityScope::Contributions {
                contribution_ids: vec![value["ui.panel:".len()..].to_string()],
            },
        ),
        value if value.starts_with("external.connector:") => (
            PluginCapabilityId::ExternalConnector,
            PluginCapabilityScope::Operations {
                operations: vec![value["external.connector:".len()..].to_string()],
            },
        ),
        value if value.starts_with("diagnostics.read:") => (
            PluginCapabilityId::DiagnosticsRead,
            PluginCapabilityScope::Diagnostics {
                categories: vec![value["diagnostics.read:".len()..].to_string()],
            },
        ),
        other => {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "unsupported permission {other}"
            )));
        }
    };
    PluginCapabilityRequest {
        capability_id,
        required: true,
        scope,
        contribution_id: None,
    }
    .normalized()
}

pub fn normalize_capability_requests(
    legacy_permissions: &[String],
    typed_requests: &[PluginCapabilityRequest],
) -> Result<Vec<PluginCapabilityRequest>> {
    if legacy_permissions
        .len()
        .saturating_add(typed_requests.len())
        > MAX_PERMISSION_COUNT
    {
        return Err(PluginRuntimeError::PackageInvalid(
            "too many requested capabilities".to_string(),
        ));
    }
    let mut requests = legacy_permissions
        .iter()
        .map(|permission| parse_legacy_permission(permission))
        .collect::<Result<Vec<_>>>()?;
    requests.extend(
        typed_requests
            .iter()
            .map(PluginCapabilityRequest::normalized)
            .collect::<Result<Vec<_>>>()?,
    );
    requests.sort_by_key(|request| request.semantic_key().unwrap_or_default());
    requests.dedup_by(|left, right| left.semantic_key().ok() == right.semantic_key().ok());
    Ok(requests)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginTier {
    Declarative,
    Sandbox,
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
    /// Structured capability requests are additive to the released string
    /// vocabulary.  Empty values are omitted when serializing legacy manifests.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<PluginCapabilityRequest>,
}

/// Released manifest-v1 process/filter shape. The alias preserves the public
/// `PluginManifest` and `startProcessPlugin` compatibility contract.
pub type RawPluginManifestV1 = PluginManifest;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginApiRange {
    pub min: u32,
    pub max: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeclarativeRuntimeEntry {
    Manifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SandboxRuntimeEntry {
    Javascript {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        export_name: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProcessRuntimeEntry {
    Node { path: String },
    Executable { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "tier",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginRuntimeDescriptor {
    Declarative {
        runtime_version: u32,
        entry: DeclarativeRuntimeEntry,
    },
    Sandbox {
        runtime_version: u32,
        entry: SandboxRuntimeEntry,
    },
    Process {
        runtime_version: u32,
        protocol_version: u32,
        entry: ProcessRuntimeEntry,
    },
}

impl PluginRuntimeDescriptor {
    pub fn tier(&self) -> PluginTier {
        match self {
            Self::Declarative { .. } => PluginTier::Declarative,
            Self::Sandbox { .. } => PluginTier::Sandbox,
            Self::Process { .. } => PluginTier::Process,
        }
    }

    pub fn entry_path(&self) -> Option<&str> {
        match self {
            Self::Declarative { .. } => None,
            Self::Sandbox {
                entry: SandboxRuntimeEntry::Javascript { path, .. },
                ..
            }
            | Self::Process {
                entry: ProcessRuntimeEntry::Node { path } | ProcessRuntimeEntry::Executable { path },
                ..
            } => Some(path),
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum PluginContributionKind {
    Filter,
    EngineConnector,
    QaRule,
    PipelineStep,
    AiAction,
    UiPanel,
    ExternalConnector,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilterContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub extensions: Vec<String>,
    pub capabilities: FilterCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<DeclarativeFilterDefinitionV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub protocol: String,
    pub operations: Vec<String>,
    pub config_schema_version: u32,
    /// Absent only on the released inventory-only descriptor. Such a
    /// descriptor remains readable but is never executable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<EngineConnectorConfigSchemaV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<EngineConnectorLimitsV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<Box<DeclarativeEngineConnectorDefinitionV1>>,
}

impl EngineConnectorContributionDescriptor {
    pub fn validate_executable_v1(&self, tier: PluginTier) -> Result<()> {
        validate_connector_descriptor_v1(
            &self.protocol,
            self.contract_version,
            &self.operations,
            self.config_schema.as_ref(),
            self.limits.as_ref(),
            self.declarative.as_deref(),
            tier,
        )
    }

    pub fn is_executable_v1(&self, tier: PluginTier) -> bool {
        self.validate_executable_v1(tier).is_ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleDefinitionV1 {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub rule_type: String,
    pub severity: String,
    pub definition: QaRuleDefinitionV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_protocol_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_kind: Option<QaRuleKindV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<translunar_qa_core::QaCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<PublicConfigSchemaV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<QaRuleLimitsV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<DeclarativeQaPackDefinitionV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
}

impl QaRuleContributionDescriptor {
    pub fn contract_compatibility(&self) -> ContributionContractCompatibilityV1 {
        ContributionContractCompatibilityV1::inspect(
            self.descriptor_version,
            self.operation_protocol_version,
            self.config_schema_version,
            None,
            false,
        )
    }

    pub fn validate_executable_v1(&self, tier: PluginTier) -> Result<()> {
        if tier == PluginTier::Declarative {
            return validate_tier_contribution(
                tier,
                &PluginContributionDescriptor::QaRule(self.clone()),
                true,
            );
        }
        let compatibility = self.contract_compatibility();
        if !compatibility.compatible
            || self.rule_type != "mechanical"
            || !matches!(self.severity.as_str(), "error" | "warning" | "info")
            || self.rule_kind != Some(QaRuleKindV1::Mechanical)
            || self.categories.is_empty()
            || self.categories.len() > MAX_LIST_ITEMS
            || !self
                .categories
                .windows(2)
                .all(|pair| pair[0].as_str() < pair[1].as_str())
        {
            return Err(PluginRuntimeError::CapabilityUnsupported(format!(
                "QA contribution {} does not implement the public V1 contract",
                self.id
            )));
        }
        let schema = self.config_schema.as_ref().ok_or_else(|| {
            PluginRuntimeError::CapabilityUnsupported("QA config schema is missing".to_string())
        })?;
        schema.validate_definition()?;
        if let Some(config) = &self.config {
            schema.validate_config(config)?;
        }
        self.limits
            .as_ref()
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported("QA limits are missing".to_string())
            })?
            .validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub input: translunar_pipeline::ArtifactKind,
    pub output: translunar_pipeline::ArtifactKind,
    pub config_schema_version: u32,
    pub resumable: bool,
    pub cancellable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_protocol_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<PublicConfigSchemaV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_schema_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<PipelineStepLimitsV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<DeclarativePipelineDefinitionV1>,
}

impl PipelineStepContributionDescriptor {
    pub fn input_artifact_kind(&self) -> Result<translunar_pipeline::ArtifactKind> {
        Ok(self.input)
    }

    pub fn output_artifact_kind(&self) -> Result<translunar_pipeline::ArtifactKind> {
        Ok(self.output)
    }

    pub fn contract_compatibility(&self) -> ContributionContractCompatibilityV1 {
        ContributionContractCompatibilityV1::inspect(
            self.descriptor_version,
            self.operation_protocol_version,
            Some(self.config_schema_version),
            self.checkpoint_schema_version,
            self.resumable,
        )
    }

    pub fn validate_executable_v1(&self, tier: PluginTier) -> Result<()> {
        if tier == PluginTier::Declarative {
            return validate_tier_contribution(
                tier,
                &PluginContributionDescriptor::PipelineStep(self.clone()),
                true,
            );
        }
        if !self.contract_compatibility().compatible || !self.cancellable {
            return Err(PluginRuntimeError::CapabilityUnsupported(format!(
                "pipeline contribution {} does not implement the public V1 contract",
                self.id
            )));
        }
        let input = self.input_artifact_kind()?;
        let output = self.output_artifact_kind()?;
        if matches!(input, translunar_pipeline::ArtifactKind::None)
            || matches!(output, translunar_pipeline::ArtifactKind::None)
        {
            return Err(PluginRuntimeError::InvalidManifest(
                "plugin pipeline artifact kinds cannot be none".to_string(),
            ));
        }
        self.config_schema
            .as_ref()
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported(
                    "pipeline config schema is missing".to_string(),
                )
            })?
            .validate_definition()?;
        self.limits
            .as_ref()
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported("pipeline limits are missing".to_string())
            })?
            .validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    /// Inventory-era transport list. Executable V1 still serializes a stable
    /// inventory projection derived from declared origins/operations.
    pub transports: Vec<String>,
    pub checkpoint_version: u32,
    pub capabilities: BTreeMap<String, bool>,
    /// Absent only on the released inventory-only descriptor. Such a
    /// descriptor remains readable but is never executable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_schema_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operations: Option<Vec<ExternalConnectorOperationV1>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_slots: Option<Vec<ExternalConnectorCredentialSlotV1>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<EngineConnectorConfigSchemaV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<ExternalConnectorLimitsV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<Box<DeclarativeExternalConnectorDefinitionV1>>,
}

impl ExternalConnectorContributionDescriptor {
    pub fn validate_executable_v1(&self, tier: PluginTier) -> Result<()> {
        let protocol = self.protocol.as_deref().ok_or_else(|| {
            PluginRuntimeError::CapabilityUnsupported(
                "external connector protocol is missing".to_string(),
            )
        })?;
        let operations = self.operations.as_ref().ok_or_else(|| {
            PluginRuntimeError::CapabilityUnsupported(
                "external connector operations are missing".to_string(),
            )
        })?;
        let origins = self.origins.as_ref().ok_or_else(|| {
            PluginRuntimeError::CapabilityUnsupported(
                "external connector origins are missing".to_string(),
            )
        })?;
        let credential_slots = self.credential_slots.as_deref().unwrap_or(&[]);
        let config_schema = self.config_schema.as_ref().ok_or_else(|| {
            PluginRuntimeError::CapabilityUnsupported(
                "external connector config schema is missing".to_string(),
            )
        })?;
        let limits = self.limits.as_ref().ok_or_else(|| {
            PluginRuntimeError::CapabilityUnsupported(
                "external connector limits are missing".to_string(),
            )
        })?;
        let executable = ExternalConnectorExecutableDescriptorV1 {
            protocol: protocol.to_string(),
            contract_version: self.contract_version.unwrap_or(0),
            config_schema_version: self.config_schema_version.unwrap_or(0),
            checkpoint_schema_version: self.checkpoint_schema_version.unwrap_or(0),
            operations: operations.clone(),
            origins: origins.clone(),
            credential_slots: credential_slots.to_vec(),
            config_schema: config_schema.clone(),
            limits: limits.clone(),
            declarative: self.declarative.clone(),
        };
        executable.validate(tier)
    }

    pub fn is_executable_v1(&self, tier: PluginTier) -> bool {
        self.validate_executable_v1(tier).is_ok()
    }

    pub fn executable_v1(
        &self,
        tier: PluginTier,
    ) -> Result<ExternalConnectorExecutableDescriptorV1> {
        self.validate_executable_v1(tier)?;
        Ok(ExternalConnectorExecutableDescriptorV1 {
            protocol: self.protocol.clone().unwrap_or_default(),
            contract_version: self.contract_version.unwrap_or(0),
            config_schema_version: self.config_schema_version.unwrap_or(0),
            checkpoint_schema_version: self.checkpoint_schema_version.unwrap_or(0),
            operations: self.operations.clone().unwrap_or_default(),
            origins: self.origins.clone().unwrap_or_default(),
            credential_slots: self.credential_slots.clone().unwrap_or_default(),
            config_schema: self
                .config_schema
                .clone()
                .expect("validated executable descriptor has config schema"),
            limits: self
                .limits
                .clone()
                .expect("validated executable descriptor has limits"),
            declarative: self.declarative.clone(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginContributionDescriptor {
    #[serde(rename = "filter")]
    Filter(FilterContributionDescriptor),
    #[serde(rename = "engineConnector")]
    EngineConnector(EngineConnectorContributionDescriptor),
    #[serde(rename = "qaRule")]
    QaRule(QaRuleContributionDescriptor),
    #[serde(rename = "pipelineStep")]
    PipelineStep(PipelineStepContributionDescriptor),
    #[serde(rename = "aiAction")]
    AiAction(AiActionContributionDescriptor),
    #[serde(rename = "uiPanel")]
    UiPanel(UiPanelContributionDescriptor),
    #[serde(rename = "externalConnector")]
    ExternalConnector(ExternalConnectorContributionDescriptor),
}

impl PluginContributionDescriptor {
    pub fn kind(&self) -> PluginContributionKind {
        match self {
            Self::Filter(_) => PluginContributionKind::Filter,
            Self::EngineConnector(_) => PluginContributionKind::EngineConnector,
            Self::QaRule(_) => PluginContributionKind::QaRule,
            Self::PipelineStep(_) => PluginContributionKind::PipelineStep,
            Self::AiAction(_) => PluginContributionKind::AiAction,
            Self::UiPanel(_) => PluginContributionKind::UiPanel,
            Self::ExternalConnector(_) => PluginContributionKind::ExternalConnector,
        }
    }

    pub fn descriptor_version(&self) -> u32 {
        match self {
            Self::Filter(value) => value.descriptor_version,
            Self::EngineConnector(value) => value.descriptor_version,
            Self::QaRule(value) => value.descriptor_version,
            Self::PipelineStep(value) => value.descriptor_version,
            Self::AiAction(value) => value.descriptor_version,
            Self::UiPanel(value) => value.descriptor_version,
            Self::ExternalConnector(value) => value.descriptor_version,
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Self::Filter(value) => &value.id,
            Self::EngineConnector(value) => &value.id,
            Self::QaRule(value) => &value.id,
            Self::PipelineStep(value) => &value.id,
            Self::AiAction(value) => &value.id,
            Self::UiPanel(value) => &value.id,
            Self::ExternalConnector(value) => &value.id,
        }
    }

    pub fn version(&self) -> &str {
        match self {
            Self::Filter(value) => &value.version,
            Self::EngineConnector(value) => &value.version,
            Self::QaRule(value) => &value.version,
            Self::PipelineStep(value) => &value.version,
            Self::AiAction(value) => &value.version,
            Self::UiPanel(value) => &value.version,
            Self::ExternalConnector(value) => &value.version,
        }
    }

    pub fn display_name(&self) -> &str {
        match self {
            Self::Filter(value) => &value.display_name,
            Self::EngineConnector(value) => &value.display_name,
            Self::QaRule(value) => &value.display_name,
            Self::PipelineStep(value) => &value.display_name,
            Self::AiAction(value) => &value.display_name,
            Self::UiPanel(value) => &value.display_name,
            Self::ExternalConnector(value) => &value.display_name,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawPluginManifestV2 {
    pub manifest_version: u32,
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub host_api: PluginApiRange,
    pub runtime: PluginRuntimeDescriptor,
    pub contributions: Vec<PluginContributionDescriptor>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<PluginCapabilityRequest>,
    /// Optional closed distribution metadata. Required for release-bundled packages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<PluginDistributionMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPluginManifest {
    pub normalized_version: u32,
    pub source_manifest_version: u32,
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub host_api: PluginApiRange,
    pub runtime: PluginRuntimeDescriptor,
    pub contributions: Vec<PluginContributionDescriptor>,
    pub requested_permissions: Vec<String>,
    #[serde(default)]
    pub requested_capabilities: Vec<PluginCapabilityRequest>,
    /// Projected distribution metadata; null/absent for legacy packages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<PluginDistributionMetadata>,
    pub original_manifest_json: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCompatibility {
    pub compatible: bool,
    pub host_api_supported: bool,
    pub runtime_supported: bool,
    pub contributions_supported: bool,
    #[serde(default)]
    pub unsupported_capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPackageFileDigest {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPackageHash {
    pub algorithm: String,
    pub version: u32,
    pub sha256: String,
    pub total_bytes: u64,
    pub entries: Vec<PluginPackageFileDigest>,
}

#[derive(Debug, Clone)]
pub struct StagedPluginPackage {
    pub path: PathBuf,
    /// Host-derived provenance for this staged package (never from the manifest).
    pub source_kind: PluginPackageSourceKind,
    pub normalized_manifest: NormalizedPluginManifest,
    pub package_hash: PluginPackageHash,
}

impl PluginManifest {
    pub fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        self.contributions.filter_descriptors()
    }
}

impl PluginContributions {
    pub fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        self.filters
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
    let raw = read_manifest_bytes(package_dir)?;
    let value: Value = serde_json::from_slice(&raw).map_err(|error| {
        PluginRuntimeError::InvalidManifest(format!("cannot parse manifest: {error}"))
    })?;
    let version = manifest_version(&value)?;
    if version != MANIFEST_VERSION_V1 {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: "manifest".to_string(),
            version,
        });
    }
    validate_manifest_shape(&value, version)?;
    let manifest: PluginManifest = serde_json::from_value(value).map_err(|error| {
        PluginRuntimeError::InvalidManifest(format!("cannot parse manifest: {error}"))
    })?;
    validate_manifest(&manifest, package_dir)?;
    Ok(manifest)
}

pub fn validate_manifest(manifest: &PluginManifest, package_dir: &Path) -> Result<()> {
    if manifest.manifest_version != MANIFEST_VERSION_V1 {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: "manifest".to_string(),
            version: manifest.manifest_version,
        });
    }
    require_id(&manifest.id, "plugin id")?;
    if manifest.id.starts_with("builtin.") {
        return Err(PluginRuntimeError::InvalidManifest(
            "plugin id must not use the builtin. prefix".to_string(),
        ));
    }
    require_text(
        &manifest.display_name,
        "displayName",
        MAX_DISPLAY_NAME_BYTES,
    )?;
    require_semver(&manifest.version, "version")?;
    validate_api_range(manifest.api_version_min, manifest.api_version, "host API")?;
    if manifest.tier != PluginTier::Process {
        return Err(PluginRuntimeError::InvalidManifest(
            "manifestVersion 1 requires process tier".to_string(),
        ));
    }
    let entry_path = normalize_relative_path(&manifest.entry.path, "entry.path")?;
    ensure_regular_package_file(package_dir, &entry_path, "entry.path")?;
    if manifest.contributions.filters.is_empty() {
        return Err(PluginRuntimeError::InvalidManifest(
            "at least one filter contribution is required in v1".to_string(),
        ));
    }
    if manifest.contributions.filters.len() > MAX_CONTRIBUTION_COUNT {
        return Err(PluginRuntimeError::InvalidManifest(
            "too many filter contributions".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    for filter in &manifest.contributions.filters {
        validate_filter_v1(filter, &mut seen)?;
    }
    validate_permissions(&manifest.permissions)?;
    validate_capability_requests(&manifest.capabilities)?;
    Ok(())
}

fn require_id(value: &str, label: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed != value {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} must be non-empty without surrounding whitespace"
        )));
    }
    if trimmed.len() > MAX_ID_BYTES {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} exceeds {} bytes",
            MAX_ID_BYTES
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
    if permission.is_empty()
        || permission.len() > MAX_PERMISSION_BYTES
        || permission.trim() != permission
    {
        return Err(PluginRuntimeError::InvalidManifest(
            "permission name is empty, oversized, or padded".to_string(),
        ));
    }
    if matches!(permission, "file.read:source" | "file.write:output") {
        return Ok(());
    }
    let prefixes = [
        "network:",
        "asset.read:",
        "asset.write:",
        "project.read:",
        "project.write:",
        "engine.connector:",
        "qa.register:",
        "pipeline.register:",
        "ai.action:",
        "ui.panel:",
        "external.connector:",
        "diagnostics.read:",
    ];
    if prefixes.iter().any(|prefix| {
        permission.starts_with(prefix)
            && permission.len() > prefix.len()
            && permission[prefix.len()..].chars().all(|ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, '.' | ':' | '-' | '_' | '/' | '*')
            })
    }) {
        return Ok(());
    }
    Err(PluginRuntimeError::InvalidManifest(format!(
        "unsupported permission {permission}"
    )))
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

impl NormalizedPluginManifest {
    pub fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        self.contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::Filter(filter) => Some(FilterDescriptor {
                    id: filter.id.clone(),
                    version: filter.version.clone(),
                    display_name: filter.display_name.clone(),
                    extensions: filter.extensions.clone(),
                    capabilities: filter.capabilities.clone(),
                }),
                _ => None,
            })
            .collect()
    }

    pub fn to_legacy_process_manifest(&self) -> Result<PluginManifest> {
        let (entry_kind, entry_path) = match &self.runtime {
            PluginRuntimeDescriptor::Process { entry, .. } => match entry {
                ProcessRuntimeEntry::Node { path } => (PluginEntryKind::Node, path.clone()),
                ProcessRuntimeEntry::Executable { path } => {
                    (PluginEntryKind::Executable, path.clone())
                }
            },
            _ => {
                return Err(PluginRuntimeError::CapabilityUnsupported(
                    "only process runtime can attach to the Tier 3 host".to_string(),
                ));
            }
        };
        let filters = self
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::Filter(filter) => Some(PluginFilterContribution {
                    id: filter.id.clone(),
                    version: filter.version.clone(),
                    display_name: filter.display_name.clone(),
                    extensions: filter.extensions.clone(),
                    capabilities: filter.capabilities.clone(),
                }),
                _ => None,
            })
            .collect::<Vec<_>>();
        let has_public_process_contribution = self.contributions.iter().any(|contribution| {
            matches!(
                contribution,
                PluginContributionDescriptor::EngineConnector(_)
                    | PluginContributionDescriptor::QaRule(_)
                    | PluginContributionDescriptor::PipelineStep(_)
                    | PluginContributionDescriptor::ExternalConnector(_)
            )
        });
        if filters.is_empty() && !has_public_process_contribution {
            return Err(PluginRuntimeError::CapabilityUnsupported(
                "process runtime requires a filter contribution for the Tier 3 host".to_string(),
            ));
        }
        Ok(PluginManifest {
            manifest_version: MANIFEST_VERSION_V1,
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            version: self.version.clone(),
            api_version: self.host_api.max,
            api_version_min: self.host_api.min,
            tier: PluginTier::Process,
            entry: PluginEntry {
                kind: entry_kind,
                path: entry_path,
            },
            contributions: PluginContributions { filters },
            permissions: self.requested_permissions.clone(),
            capabilities: self.requested_capabilities.clone(),
        })
    }

    pub fn supports_process_filter_host(&self) -> bool {
        matches!(self.runtime, PluginRuntimeDescriptor::Process { .. })
            && self
                .contributions
                .iter()
                .all(|contribution| match contribution {
                    PluginContributionDescriptor::Filter(_) => true,
                    PluginContributionDescriptor::EngineConnector(value) => {
                        value.is_executable_v1(PluginTier::Process)
                    }
                    PluginContributionDescriptor::QaRule(value) => {
                        value.validate_executable_v1(PluginTier::Process).is_ok()
                    }
                    PluginContributionDescriptor::PipelineStep(value) => {
                        value.validate_executable_v1(PluginTier::Process).is_ok()
                    }
                    _ => false,
                })
    }

    pub fn supports_sandbox_host(&self) -> bool {
        matches!(self.runtime, PluginRuntimeDescriptor::Sandbox { .. })
            && self
                .contributions
                .iter()
                .all(|contribution| match contribution {
                    PluginContributionDescriptor::EngineConnector(value) => {
                        value.is_executable_v1(PluginTier::Sandbox)
                    }
                    PluginContributionDescriptor::QaRule(value) => {
                        value.validate_executable_v1(PluginTier::Sandbox).is_ok()
                    }
                    PluginContributionDescriptor::PipelineStep(value) => {
                        value.validate_executable_v1(PluginTier::Sandbox).is_ok()
                    }
                    PluginContributionDescriptor::AiAction(value) => {
                        value.validate_executable_v1(PluginTier::Sandbox).is_ok()
                    }
                    PluginContributionDescriptor::UiPanel(value) => {
                        value.contract_version.is_none()
                            || value.validate_executable_v1(PluginTier::Sandbox).is_ok()
                    }
                    _ => matches!(contribution, PluginContributionDescriptor::Filter(_)),
                })
    }

    pub fn compatibility(&self) -> PluginCompatibility {
        let host_api_supported =
            self.host_api.min <= HOST_API_VERSION && HOST_API_VERSION <= self.host_api.max;
        let runtime_supported = matches!(
            self.runtime,
            PluginRuntimeDescriptor::Process { .. }
                | PluginRuntimeDescriptor::Declarative { .. }
                | PluginRuntimeDescriptor::Sandbox { .. }
        );
        let contribution_supported = |contribution: &PluginContributionDescriptor| {
            let tier = self.runtime.tier();
            match contribution {
                PluginContributionDescriptor::EngineConnector(value) => {
                    value.is_executable_v1(tier)
                }
                PluginContributionDescriptor::QaRule(value) => {
                    value.validate_executable_v1(tier).is_ok()
                }
                PluginContributionDescriptor::PipelineStep(value) => {
                    value.validate_executable_v1(tier).is_ok()
                }
                _ => match &self.runtime {
                    PluginRuntimeDescriptor::Process { .. } => {
                        matches!(contribution, PluginContributionDescriptor::Filter(_))
                    }
                    PluginRuntimeDescriptor::Declarative { .. } => {
                        validate_tier_contribution(PluginTier::Declarative, contribution, true)
                            .is_ok()
                    }
                    PluginRuntimeDescriptor::Sandbox { .. } => match contribution {
                        PluginContributionDescriptor::AiAction(value) => {
                            value.validate_executable_v1(PluginTier::Sandbox).is_ok()
                        }
                        PluginContributionDescriptor::UiPanel(value) => {
                            value.contract_version.is_none()
                                || value.validate_executable_v1(PluginTier::Sandbox).is_ok()
                        }
                        _ => matches!(contribution, PluginContributionDescriptor::Filter(_)),
                    },
                },
            }
        };
        let contributions_supported = self.contributions.iter().all(contribution_supported);
        let mut unsupported_capabilities = Vec::new();
        if !runtime_supported {
            unsupported_capabilities.push(format!(
                "runtime.{}",
                match self.runtime.tier() {
                    PluginTier::Declarative => "declarative",
                    PluginTier::Sandbox => "sandbox",
                    PluginTier::Process => "process",
                }
            ));
        }
        for contribution in &self.contributions {
            if !contribution_supported(contribution) {
                unsupported_capabilities.push(format!(
                    "contribution.{}:{}",
                    contribution_kind_name(contribution.kind()),
                    contribution.id()
                ));
            }
        }
        PluginCompatibility {
            compatible: host_api_supported && runtime_supported && contributions_supported,
            host_api_supported,
            runtime_supported,
            contributions_supported,
            unsupported_capabilities,
        }
    }
}

pub fn load_normalized_manifest(package_dir: &Path) -> Result<NormalizedPluginManifest> {
    let raw = read_manifest_bytes(package_dir)?;
    decode_normalized_manifest(&raw, package_dir)
}

pub fn decode_normalized_manifest(
    raw: &[u8],
    package_dir: &Path,
) -> Result<NormalizedPluginManifest> {
    if raw.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(PluginRuntimeError::PackageInvalid(
            "manifest exceeds the configured byte limit".to_string(),
        ));
    }
    let value: Value = serde_json::from_slice(raw).map_err(|error| {
        PluginRuntimeError::InvalidManifest(format!("cannot parse manifest: {error}"))
    })?;
    let source_version = manifest_version(&value)?;
    validate_manifest_shape(&value, source_version)?;
    let normalized = match source_version {
        MANIFEST_VERSION_V1 => {
            let distribution: Option<PluginDistributionMetadata> = value
                .get("distribution")
                .map(|value| serde_json::from_value(value.clone()))
                .transpose()
                .map_err(|error| {
                    PluginRuntimeError::InvalidManifest(format!(
                        "cannot parse distribution metadata: {error}"
                    ))
                })?;
            if let Some(distribution) = &distribution {
                distribution.validate()?;
            }
            let mut legacy_value = value.clone();
            legacy_value
                .as_object_mut()
                .expect("manifest object")
                .remove("distribution");
            let manifest: RawPluginManifestV1 =
                serde_json::from_value(legacy_value).map_err(|error| {
                    PluginRuntimeError::InvalidManifest(format!("cannot parse manifest: {error}"))
                })?;
            validate_manifest(&manifest, package_dir)?;
            NormalizedPluginManifest {
                normalized_version: NORMALIZED_MANIFEST_VERSION,
                source_manifest_version: MANIFEST_VERSION_V1,
                id: manifest.id.clone(),
                display_name: manifest.display_name.clone(),
                version: manifest.version.clone(),
                host_api: PluginApiRange {
                    min: manifest.api_version_min,
                    max: manifest.api_version,
                },
                runtime: PluginRuntimeDescriptor::Process {
                    runtime_version: RUNTIME_DESCRIPTOR_VERSION,
                    protocol_version: PROCESS_PROTOCOL_VERSION,
                    entry: match manifest.entry.kind {
                        PluginEntryKind::Node => ProcessRuntimeEntry::Node {
                            path: normalize_relative_path(&manifest.entry.path, "entry.path")?,
                        },
                        PluginEntryKind::Executable => ProcessRuntimeEntry::Executable {
                            path: normalize_relative_path(&manifest.entry.path, "entry.path")?,
                        },
                    },
                },
                contributions: manifest
                    .contributions
                    .filters
                    .iter()
                    .map(|filter| {
                        PluginContributionDescriptor::Filter(FilterContributionDescriptor {
                            descriptor_version: CONTRIBUTION_DESCRIPTOR_VERSION,
                            id: filter.id.clone(),
                            version: filter.version.clone(),
                            display_name: filter.display_name.clone(),
                            extensions: filter.extensions.clone(),
                            capabilities: filter.capabilities.clone(),
                            declarative: None,
                        })
                    })
                    .collect(),
                requested_permissions: manifest.permissions.clone(),
                requested_capabilities: normalize_capability_requests(
                    &manifest.permissions,
                    &manifest.capabilities,
                )?,
                distribution,
                original_manifest_json: value,
            }
        }
        MANIFEST_VERSION_V2 => {
            let manifest: RawPluginManifestV2 =
                serde_json::from_value(value.clone()).map_err(|error| {
                    PluginRuntimeError::InvalidManifest(format!("cannot parse manifest: {error}"))
                })?;
            validate_manifest_v2(&manifest, package_dir)?;
            let requested_capabilities =
                normalize_capability_requests(&manifest.permissions, &manifest.capabilities)?;
            if let Some(distribution) = &manifest.distribution {
                distribution.validate()?;
            }
            NormalizedPluginManifest {
                normalized_version: NORMALIZED_MANIFEST_VERSION,
                source_manifest_version: MANIFEST_VERSION_V2,
                id: manifest.id,
                display_name: manifest.display_name,
                version: manifest.version,
                host_api: manifest.host_api,
                runtime: manifest.runtime,
                contributions: manifest.contributions,
                requested_permissions: manifest.permissions,
                requested_capabilities,
                distribution: manifest.distribution,
                original_manifest_json: value,
            }
        }
        version => {
            return Err(PluginRuntimeError::UnsupportedVersion {
                component: "manifest".to_string(),
                version,
            });
        }
    };
    Ok(normalized)
}

fn contribution_kind_name(kind: PluginContributionKind) -> &'static str {
    match kind {
        PluginContributionKind::Filter => "filter",
        PluginContributionKind::EngineConnector => "engineConnector",
        PluginContributionKind::QaRule => "qaRule",
        PluginContributionKind::PipelineStep => "pipelineStep",
        PluginContributionKind::AiAction => "aiAction",
        PluginContributionKind::UiPanel => "uiPanel",
        PluginContributionKind::ExternalConnector => "externalConnector",
    }
}

fn read_manifest_bytes(package_dir: &Path) -> Result<Vec<u8>> {
    let path = package_dir.join(MANIFEST_FILE_NAME);
    let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
        PluginRuntimeError::InvalidManifest(format!("cannot read {}: {error}", path.display()))
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
        return Err(PluginRuntimeError::PackageInvalid(
            "manifest.json must be a regular file".to_string(),
        ));
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(PluginRuntimeError::PackageInvalid(
            "manifest exceeds the configured byte limit".to_string(),
        ));
    }
    let mut file = File::open(&path)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn manifest_version(value: &Value) -> Result<u32> {
    let object = value.as_object().ok_or_else(|| {
        PluginRuntimeError::InvalidManifest("manifest must be a JSON object".to_string())
    })?;
    let version = object.get("manifestVersion").ok_or_else(|| {
        PluginRuntimeError::InvalidManifest("manifestVersion is required".to_string())
    })?;
    let version = version.as_u64().ok_or_else(|| {
        PluginRuntimeError::InvalidManifest("manifestVersion must be an integer".to_string())
    })?;
    u32::try_from(version).map_err(|_| PluginRuntimeError::UnsupportedVersion {
        component: "manifest".to_string(),
        version: u32::MAX,
    })
}

fn validate_manifest_shape(value: &Value, version: u32) -> Result<()> {
    validate_json_shape(value, "manifest", 0)?;
    let Some(object) = value.as_object() else {
        return Err(PluginRuntimeError::InvalidManifest(
            "manifest must be a JSON object".to_string(),
        ));
    };
    if object.len() > MAX_MAP_ENTRIES {
        return Err(PluginRuntimeError::PackageInvalid(
            "manifest contains too many fields".to_string(),
        ));
    }
    if version != MANIFEST_VERSION_V1 && version != MANIFEST_VERSION_V2 {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: "manifest".to_string(),
            version,
        });
    }
    Ok(())
}

fn validate_json_shape(value: &Value, label: &str, depth: usize) -> Result<()> {
    if depth > MAX_JSON_DEPTH {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} exceeds JSON nesting limit"
        )));
    }
    match value {
        Value::String(text) => {
            if text.len() > MAX_LONG_STRING_BYTES {
                return Err(PluginRuntimeError::PackageInvalid(format!(
                    "{label} contains an oversized string"
                )));
            }
        }
        Value::Array(items) => {
            if items.len() > MAX_LIST_ITEMS {
                return Err(PluginRuntimeError::PackageInvalid(format!(
                    "{label} contains too many array items"
                )));
            }
            for item in items {
                validate_json_shape(item, label, depth + 1)?;
            }
        }
        Value::Object(items) => {
            if items.len() > MAX_MAP_ENTRIES {
                return Err(PluginRuntimeError::PackageInvalid(format!(
                    "{label} contains too many object fields"
                )));
            }
            for (key, item) in items {
                if key.len() > MAX_SHORT_STRING_BYTES {
                    return Err(PluginRuntimeError::PackageInvalid(format!(
                        "{label} contains an oversized field name"
                    )));
                }
                validate_json_shape(item, label, depth + 1)?;
            }
        }
        _ => {}
    }
    let encoded_len = serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX);
    if encoded_len > MAX_JSON_DESCRIPTOR_BYTES && depth == 0 {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} exceeds the configured JSON byte limit"
        )));
    }
    Ok(())
}

fn require_text(value: &str, label: &str, max_bytes: usize) -> Result<()> {
    if value.trim().is_empty() || value.trim() != value {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} must be non-empty without surrounding whitespace"
        )));
    }
    if value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} exceeds its size or character limit"
        )));
    }
    Ok(())
}

fn require_semver(value: &str, label: &str) -> Result<()> {
    require_text(value, label, MAX_VERSION_BYTES)?;
    let core = value.split(['+', '-']).next().unwrap_or_default();
    let parts = core.split('.').collect::<Vec<_>>();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || (part.len() > 1 && part.starts_with('0'))
                || !part.chars().all(|ch| ch.is_ascii_digit())
        })
    {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} must be a semantic version"
        )));
    }
    Ok(())
}

fn validate_api_range(min: u32, max: u32, label: &str) -> Result<()> {
    if min > max {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} range is inverted"
        )));
    }
    if HOST_API_VERSION < min || HOST_API_VERSION > max {
        return Err(PluginRuntimeError::IncompatibleHost {
            min,
            max,
            host: HOST_API_VERSION,
        });
    }
    Ok(())
}

fn validate_filter_v1(
    filter: &PluginFilterContribution,
    seen: &mut BTreeSet<String>,
) -> Result<()> {
    require_id(&filter.id, "filter contribution id")?;
    if filter.id.starts_with("builtin.") {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "filter id {} must not use builtin. prefix",
            filter.id
        )));
    }
    if !seen.insert(filter.id.clone()) {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "duplicate filter contribution id {}",
            filter.id
        )));
    }
    require_semver(&filter.version, "filter version")?;
    require_text(
        &filter.display_name,
        "filter displayName",
        MAX_DISPLAY_NAME_BYTES,
    )?;
    validate_extensions(&filter.extensions)?;
    Ok(())
}

fn validate_extensions(extensions: &[String]) -> Result<()> {
    if extensions.is_empty() || extensions.len() > MAX_LIST_ITEMS {
        return Err(PluginRuntimeError::InvalidManifest(
            "a filter needs between one and 256 extensions".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    for extension in extensions {
        require_text(extension, "extension", MAX_SHORT_STRING_BYTES)?;
        if extension.contains('/') || extension.contains('\\') || !seen.insert(extension) {
            return Err(PluginRuntimeError::InvalidManifest(
                "extensions must be unique relative names".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_permissions(permissions: &[String]) -> Result<()> {
    if permissions.len() > MAX_PERMISSION_COUNT {
        return Err(PluginRuntimeError::PackageInvalid(
            "too many requested permissions".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    for permission in permissions {
        validate_permission_name(permission)?;
        if !seen.insert(permission) {
            return Err(PluginRuntimeError::InvalidManifest(
                "duplicate requested permission".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_capability_requests(requests: &[PluginCapabilityRequest]) -> Result<()> {
    if requests.len() > MAX_PERMISSION_COUNT {
        return Err(PluginRuntimeError::PackageInvalid(
            "too many structured capability requests".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    for request in requests {
        let normalized = request.normalized()?;
        let key = normalized.semantic_key()?;
        if !seen.insert(key) {
            return Err(PluginRuntimeError::InvalidManifest(
                "duplicate structured capability request".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_manifest_v2(manifest: &RawPluginManifestV2, package_dir: &Path) -> Result<()> {
    if manifest.manifest_version != MANIFEST_VERSION_V2 {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: "manifest".to_string(),
            version: manifest.manifest_version,
        });
    }
    require_id(&manifest.id, "plugin id")?;
    if manifest.id.starts_with("builtin.") {
        return Err(PluginRuntimeError::InvalidManifest(
            "plugin id must not use the builtin. prefix".to_string(),
        ));
    }
    require_text(
        &manifest.display_name,
        "displayName",
        MAX_DISPLAY_NAME_BYTES,
    )?;
    require_semver(&manifest.version, "version")?;
    validate_api_range(manifest.host_api.min, manifest.host_api.max, "host API")?;
    validate_runtime_descriptor(&manifest.runtime, package_dir)?;
    if manifest.contributions.is_empty() {
        return Err(PluginRuntimeError::InvalidManifest(
            "at least one contribution is required in v2".to_string(),
        ));
    }
    if manifest.contributions.len() > MAX_CONTRIBUTION_COUNT {
        return Err(PluginRuntimeError::PackageInvalid(
            "too many contributions".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    for contribution in &manifest.contributions {
        validate_contribution(contribution, &mut seen)?;
        if matches!(manifest.runtime, PluginRuntimeDescriptor::Sandbox { .. })
            && let PluginContributionDescriptor::UiPanel(panel) = contribution
        {
            let surface = normalize_relative_path(&panel.surface, "UI panel surface")?;
            if Path::new(&surface)
                .extension()
                .and_then(|value| value.to_str())
                != Some("html")
            {
                return Err(PluginRuntimeError::InvalidManifest(
                    "sandbox UI panel surface must use a .html extension".to_string(),
                ));
            }
            ensure_regular_package_file(package_dir, &surface, "UI panel surface")?;
            ensure_descriptor_version(
                "UI panel bridge",
                panel.bridge_version,
                SANDBOX_PROTOCOL_VERSION,
            )?;
        }
        if !contribution_allowed(manifest.runtime.tier(), contribution.kind()) {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "{} contribution {} is not valid for {} runtime",
                contribution_kind_name(contribution.kind()),
                contribution.id(),
                contribution_kind_name(match manifest.runtime.tier() {
                    PluginTier::Declarative => PluginContributionKind::PipelineStep,
                    PluginTier::Sandbox => PluginContributionKind::EngineConnector,
                    PluginTier::Process => PluginContributionKind::ExternalConnector,
                })
            )));
        }
        validate_tier_contribution(manifest.runtime.tier(), contribution, false)?;
    }
    validate_permissions(&manifest.permissions)?;
    validate_capability_requests(&manifest.capabilities)?;
    Ok(())
}

fn validate_runtime_descriptor(
    runtime: &PluginRuntimeDescriptor,
    package_dir: &Path,
) -> Result<()> {
    match runtime {
        PluginRuntimeDescriptor::Declarative {
            runtime_version,
            entry: DeclarativeRuntimeEntry::Manifest,
        } => {
            ensure_descriptor_version("runtime", *runtime_version, RUNTIME_DESCRIPTOR_VERSION)?;
        }
        PluginRuntimeDescriptor::Sandbox {
            runtime_version,
            entry: SandboxRuntimeEntry::Javascript { path, export_name },
        } => {
            ensure_descriptor_version("runtime", *runtime_version, RUNTIME_DESCRIPTOR_VERSION)?;
            let path = normalize_relative_path(path, "runtime.entry.path")?;
            if !matches!(
                Path::new(&path)
                    .extension()
                    .and_then(|value| value.to_str()),
                Some("js" | "mjs")
            ) {
                return Err(PluginRuntimeError::InvalidManifest(
                    "sandbox runtime entry must use a .js or .mjs extension".to_string(),
                ));
            }
            ensure_regular_package_file(package_dir, &path, "runtime.entry.path")?;
            if let Some(name) = export_name {
                require_text(name, "runtime.entry.exportName", MAX_SHORT_STRING_BYTES)?;
            }
        }
        PluginRuntimeDescriptor::Process {
            runtime_version,
            protocol_version,
            entry,
        } => {
            ensure_descriptor_version("runtime", *runtime_version, RUNTIME_DESCRIPTOR_VERSION)?;
            ensure_descriptor_version("protocol", *protocol_version, PROCESS_PROTOCOL_VERSION)?;
            let path = match entry {
                ProcessRuntimeEntry::Node { path } | ProcessRuntimeEntry::Executable { path } => {
                    normalize_relative_path(path, "runtime.entry.path")?
                }
            };
            ensure_regular_package_file(package_dir, &path, "runtime.entry.path")?;
        }
    }
    Ok(())
}

fn ensure_descriptor_version(component: &str, actual: u32, expected: u32) -> Result<()> {
    if actual != expected {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: component.to_string(),
            version: actual,
        });
    }
    Ok(())
}

fn contribution_allowed(tier: PluginTier, kind: PluginContributionKind) -> bool {
    match tier {
        PluginTier::Declarative => matches!(
            kind,
            PluginContributionKind::Filter
                | PluginContributionKind::EngineConnector
                | PluginContributionKind::QaRule
                | PluginContributionKind::PipelineStep
                | PluginContributionKind::ExternalConnector
        ),
        PluginTier::Sandbox => true,
        PluginTier::Process => !matches!(kind, PluginContributionKind::UiPanel),
    }
}

fn validate_tier_contribution(
    tier: PluginTier,
    contribution: &PluginContributionDescriptor,
    require_definition: bool,
) -> Result<()> {
    if let PluginContributionDescriptor::EngineConnector(value) = contribution {
        // The released skeletal descriptor has no contractVersion. Keep it
        // inventory-readable, but only the strict V1 shape is executable.
        return if value.contract_version.is_some() || require_definition {
            value.validate_executable_v1(tier)
        } else {
            Ok(())
        };
    }
    if let PluginContributionDescriptor::ExternalConnector(value) = contribution {
        return if value.contract_version.is_some() || require_definition {
            value.validate_executable_v1(tier)
        } else {
            Ok(())
        };
    }
    if let PluginContributionDescriptor::AiAction(value) = contribution {
        return if value.operation_protocol_version.is_some() || require_definition {
            value.validate_executable_v1(tier)
        } else {
            Ok(())
        };
    }
    if let PluginContributionDescriptor::UiPanel(value) = contribution {
        return if value.contract_version.is_some() || require_definition {
            value.validate_executable_v1(tier)
        } else {
            Ok(())
        };
    }
    if tier != PluginTier::Declarative {
        return Ok(());
    }
    match contribution {
        PluginContributionDescriptor::Filter(value) => {
            let Some(definition) = value.declarative.as_ref() else {
                return if require_definition {
                    Err(PluginRuntimeError::InvalidManifest(format!(
                        "declarative filter {} requires a typed declarative definition",
                        value.id
                    )))
                } else {
                    Ok(())
                };
            };
            if !value.capabilities.import
                || !value.capabilities.validate
                || value.capabilities.inline_tags
                || value.capabilities.notes
                || value.capabilities.degradation_report
            {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "declarative filter {} must support import/validate and cannot advertise inline tags, notes, or degradation",
                    value.id
                )));
            }
            definition.validate()
        }
        PluginContributionDescriptor::QaRule(value) => {
            let Some(definition) = value.declarative.as_ref() else {
                return if require_definition {
                    Err(PluginRuntimeError::InvalidManifest(format!(
                        "declarative QA contribution {} requires a typed declarative definition",
                        value.id
                    )))
                } else {
                    Ok(())
                };
            };
            if value.rule_type != "regexPack" {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "declarative QA contribution {} must use ruleType regexPack",
                    value.id
                )));
            }
            definition.validate()
        }
        PluginContributionDescriptor::PipelineStep(value) => {
            let Some(definition) = value.declarative.as_ref() else {
                return if require_definition {
                    Err(PluginRuntimeError::InvalidManifest(format!(
                        "declarative pipeline contribution {} requires a typed declarative definition",
                        value.id
                    )))
                } else {
                    Ok(())
                };
            };
            if value.resumable || !value.cancellable {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "declarative pipeline contribution {} must be non-resumable and cancellable",
                    value.id
                )));
            }
            definition.validate_for_descriptor(
                &value.input,
                &value.output,
                value.config_schema_version,
            )
        }
        _ => Err(PluginRuntimeError::InvalidManifest(
            "unsupported declarative contribution".to_string(),
        )),
    }
}

fn validate_contribution(
    contribution: &PluginContributionDescriptor,
    seen: &mut BTreeSet<(PluginContributionKind, String)>,
) -> Result<()> {
    ensure_descriptor_version(
        &format!(
            "{} contribution",
            contribution_kind_name(contribution.kind())
        ),
        contribution.descriptor_version(),
        CONTRIBUTION_DESCRIPTOR_VERSION,
    )?;
    require_id(contribution.id(), "contribution id")?;
    if contribution.id().starts_with("builtin.") {
        return Err(PluginRuntimeError::InvalidManifest(
            "contribution id must not use the builtin. prefix".to_string(),
        ));
    }
    if !seen.insert((contribution.kind(), contribution.id().to_string())) {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "duplicate {} contribution id {}",
            contribution_kind_name(contribution.kind()),
            contribution.id()
        )));
    }
    require_semver(contribution.version(), "contribution version")?;
    require_text(
        contribution.display_name(),
        "contribution displayName",
        MAX_DISPLAY_NAME_BYTES,
    )?;
    match contribution {
        PluginContributionDescriptor::Filter(value) => validate_filter_v2(value),
        PluginContributionDescriptor::EngineConnector(value) => {
            require_text(
                &value.protocol,
                "connector protocol",
                MAX_SHORT_STRING_BYTES,
            )?;
            validate_string_list(&value.operations, "connector operations")?;
            if value.config_schema_version == 0 {
                return Err(PluginRuntimeError::InvalidManifest(
                    "connector configSchemaVersion must be positive".to_string(),
                ));
            }
            Ok(())
        }
        PluginContributionDescriptor::QaRule(value) => {
            require_text(&value.rule_type, "QA ruleType", MAX_SHORT_STRING_BYTES)?;
            require_text(&value.severity, "QA severity", MAX_SHORT_STRING_BYTES)?;
            if let Some(config) = &value.config {
                validate_json_shape(config, "QA config", 0)?;
            }
            if let Some(schema) = &value.config_schema {
                schema.validate_definition()?;
            }
            if let Some(limits) = &value.limits {
                limits.validate()?;
            }
            Ok(())
        }
        PluginContributionDescriptor::PipelineStep(value) => {
            if value.config_schema_version == 0 {
                return Err(PluginRuntimeError::InvalidManifest(
                    "pipeline configSchemaVersion must be positive".to_string(),
                ));
            }
            if let Some(schema) = &value.config_schema {
                schema.validate_definition()?;
            }
            if let Some(limits) = &value.limits {
                limits.validate()?;
            }
            Ok(())
        }
        PluginContributionDescriptor::AiAction(value) => {
            require_text(&value.label, "AI action label", MAX_DISPLAY_NAME_BYTES)?;
            require_text(
                &value.placement,
                "AI action placement",
                MAX_SHORT_STRING_BYTES,
            )?;
            if !value.prompt_template.is_empty() {
                require_text(
                    &value.prompt_template,
                    "AI action promptTemplate",
                    MAX_LONG_STRING_BYTES,
                )?;
            }
            validate_json_shape(&value.input, "AI action input", 0)?;
            validate_tier_contribution(PluginTier::Sandbox, contribution, false)
        }
        PluginContributionDescriptor::UiPanel(value) => {
            require_text(&value.label, "UI panel label", MAX_DISPLAY_NAME_BYTES)?;
            require_text(
                &value.placement,
                "UI panel placement",
                MAX_SHORT_STRING_BYTES,
            )?;
            require_text(&value.surface, "UI panel surface", MAX_SHORT_STRING_BYTES)?;
            if value.bridge_version == 0 {
                return Err(PluginRuntimeError::InvalidManifest(
                    "UI panel bridgeVersion must be positive".to_string(),
                ));
            }
            validate_tier_contribution(PluginTier::Sandbox, contribution, false)
        }
        PluginContributionDescriptor::ExternalConnector(value) => {
            validate_string_list(&value.transports, "external connector transports")?;
            if value.checkpoint_version == 0 {
                return Err(PluginRuntimeError::InvalidManifest(
                    "external connector checkpointVersion must be positive".to_string(),
                ));
            }
            if value.capabilities.len() > MAX_MAP_ENTRIES {
                return Err(PluginRuntimeError::PackageInvalid(
                    "external connector has too many capabilities".to_string(),
                ));
            }
            // Inventory-only descriptors remain readable. Executable V1 is
            // validated against the package runtime tier in validate_tier_contribution.
            Ok(())
        }
    }
}

fn validate_filter_v2(value: &FilterContributionDescriptor) -> Result<()> {
    validate_extensions(&value.extensions)
}

fn validate_string_list(values: &[String], label: &str) -> Result<()> {
    if values.is_empty() || values.len() > MAX_LIST_ITEMS {
        return Err(PluginRuntimeError::InvalidManifest(format!(
            "{label} must contain between one and 256 items"
        )));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        require_text(value, label, MAX_SHORT_STRING_BYTES)?;
        if !seen.insert(value) {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "{label} must not contain duplicates"
            )));
        }
    }
    Ok(())
}

pub(crate) fn normalize_relative_path(value: &str, label: &str) -> Result<String> {
    if value.is_empty() || value.len() > MAX_PACKAGE_PATH_BYTES || value.contains('\0') {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} is empty or oversized"
        )));
    }
    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.contains(":")
        || Path::new(&normalized).is_absolute()
    {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} must be a relative path"
        )));
    }
    let mut output = Vec::new();
    for component in normalized.split('/') {
        if component.is_empty() || component == "." {
            continue;
        }
        if component == ".." {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "{label} contains an escaping path component"
            )));
        }
        if component.len() > MAX_PACKAGE_PATH_BYTES {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "{label} component is oversized"
            )));
        }
        output.push(component);
    }
    if output.is_empty() {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} must contain a file path"
        )));
    }
    if output.len() > MAX_PACKAGE_DEPTH {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} exceeds package nesting limit"
        )));
    }
    Ok(output.join("/"))
}

fn ensure_regular_package_file(root: &Path, relative: &str, label: &str) -> Result<()> {
    let mut current = root.to_path_buf();
    reject_reparse(&current, label)?;
    let components = relative.split('/').collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        current.push(component);
        let metadata = std::fs::symlink_metadata(&current).map_err(|error| {
            if label.ends_with("entry.path") {
                PluginRuntimeError::InvalidManifest(format!(
                    "entry file missing: {relative} ({error})"
                ))
            } else {
                PluginRuntimeError::InvalidManifest(format!("{label} is missing: {error}"))
            }
        })?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "{label} traverses a symlink or reparse point"
            )));
        }
        if index + 1 < components.len() && !metadata.is_dir() {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "{label} has a non-directory parent"
            )));
        }
        if index + 1 == components.len() && !metadata.is_file() {
            return Err(PluginRuntimeError::InvalidManifest(format!(
                "{label} must be a regular file"
            )));
        }
    }
    Ok(())
}

pub(crate) fn reject_reparse(path: &Path, label: &str) -> Result<()> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        PluginRuntimeError::PackageInvalid(format!("{label} is unavailable: {error}"))
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(PluginRuntimeError::PackageInvalid(format!(
            "{label} is a symlink or reparse point"
        )));
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
pub(crate) fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
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
    contributions: HandshakeContributions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum HandshakeContributions {
    Legacy(PluginContributions),
    Normalized(Vec<PluginContributionDescriptor>),
}

impl HandshakeContributions {
    fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        match self {
            Self::Legacy(contributions) => contributions.filter_descriptors(),
            Self::Normalized(contributions) => contributions
                .iter()
                .filter_map(|contribution| match contribution {
                    PluginContributionDescriptor::Filter(filter) => Some(FilterDescriptor {
                        id: filter.id.clone(),
                        version: filter.version.clone(),
                        display_name: filter.display_name.clone(),
                        extensions: filter.extensions.clone(),
                        capabilities: filter.capabilities.clone(),
                    }),
                    _ => None,
                })
                .collect(),
        }
    }

    fn connector_descriptors(&self) -> Vec<EngineConnectorContributionDescriptor> {
        match self {
            Self::Legacy(_) => Vec::new(),
            Self::Normalized(contributions) => contributions
                .iter()
                .filter_map(|contribution| match contribution {
                    PluginContributionDescriptor::EngineConnector(connector) => {
                        Some(connector.clone())
                    }
                    _ => None,
                })
                .collect(),
        }
    }

    fn qa_rule_descriptors(&self) -> Vec<QaRuleContributionDescriptor> {
        match self {
            Self::Legacy(_) => Vec::new(),
            Self::Normalized(contributions) => contributions
                .iter()
                .filter_map(|contribution| match contribution {
                    PluginContributionDescriptor::QaRule(descriptor) => Some(descriptor.clone()),
                    _ => None,
                })
                .collect(),
        }
    }

    fn pipeline_step_descriptors(&self) -> Vec<PipelineStepContributionDescriptor> {
        match self {
            Self::Legacy(_) => Vec::new(),
            Self::Normalized(contributions) => contributions
                .iter()
                .filter_map(|contribution| match contribution {
                    PluginContributionDescriptor::PipelineStep(descriptor) => {
                        Some(descriptor.clone())
                    }
                    _ => None,
                })
                .collect(),
        }
    }

    fn external_connector_descriptors(&self) -> Vec<ExternalConnectorContributionDescriptor> {
        match self {
            Self::Legacy(_) => Vec::new(),
            Self::Normalized(contributions) => contributions
                .iter()
                .filter_map(|contribution| match contribution {
                    PluginContributionDescriptor::ExternalConnector(descriptor)
                        if descriptor.contract_version.is_some() =>
                    {
                        Some(descriptor.clone())
                    }
                    _ => None,
                })
                .collect(),
        }
    }
}

#[derive(Debug)]
struct PendingCall {
    method: String,
    pipeline_invocation_id: Option<String>,
    sender: std::sync::mpsc::Sender<Result<Value>>,
}

type PipelineCheckpointHandler =
    dyn Fn(PipelineStepCheckpointProgressV1) -> Result<()> + Send + Sync + 'static;

#[derive(Clone)]
struct PendingPipelineCheckpointRoute {
    contribution_id: String,
    checkpoint_schema_version: Option<u32>,
    limits: PipelineStepLimitsV1,
    handler: Arc<PipelineCheckpointHandler>,
    failure: Arc<Mutex<Option<String>>>,
}

impl std::fmt::Debug for PendingPipelineCheckpointRoute {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PendingPipelineCheckpointRoute")
            .field("contribution_id", &self.contribution_id)
            .field("checkpoint_schema_version", &self.checkpoint_schema_version)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
struct PendingConnectorRoute {
    call_id: u64,
    sequence: EngineConnectorEventSequenceV1,
    limits: EngineConnectorLimitsV1,
    events: SyncSender<EngineConnectorEventV1>,
    failure: Arc<Mutex<Option<ConnectorRouteFailure>>>,
}

#[derive(Debug, Clone)]
enum ConnectorRouteFailure {
    Protocol(String),
    FatalProtocol(String),
    Process(String),
    Io(std::io::ErrorKind, String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectorGenerateAck {
    completed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectorCancelAck {}

impl ConnectorRouteFailure {
    fn into_error(self) -> PluginRuntimeError {
        match self {
            Self::Protocol(message) | Self::FatalProtocol(message) => {
                PluginRuntimeError::Protocol(message)
            }
            Self::Process(message) => PluginRuntimeError::Process(message),
            Self::Io(kind, message) => PluginRuntimeError::Io(std::io::Error::new(kind, message)),
        }
    }

    const fn is_fatal(&self) -> bool {
        matches!(
            self,
            Self::FatalProtocol(_) | Self::Process(_) | Self::Io(..)
        )
    }
}

#[derive(Debug)]
struct ProcessState {
    generation: u64,
    child: Child,
    writer: SyncSender<String>,
    pending: Arc<Mutex<BTreeMap<u64, PendingCall>>>,
    connector_routes: Arc<Mutex<BTreeMap<String, PendingConnectorRoute>>>,
    pipeline_checkpoint_routes: Arc<Mutex<BTreeMap<String, PendingPipelineCheckpointRoute>>>,
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
    connector_descriptors: Vec<EngineConnectorContributionDescriptor>,
    qa_rule_descriptors: Vec<QaRuleContributionDescriptor>,
    pipeline_step_descriptors: Vec<PipelineStepContributionDescriptor>,
    external_connector_descriptors: Vec<ExternalConnectorContributionDescriptor>,
    state: Mutex<Option<ProcessState>>,
    start_lock: Mutex<()>,
    next_generation: AtomicU64,
}

impl PluginProcess {
    pub fn new(package_dir: PathBuf, manifest: PluginManifest) -> Self {
        Self::new_with_connector_descriptors(package_dir, manifest, Vec::new())
    }

    pub fn new_with_connector_descriptors(
        package_dir: PathBuf,
        manifest: PluginManifest,
        connector_descriptors: Vec<EngineConnectorContributionDescriptor>,
    ) -> Self {
        Self::new_with_public_descriptors(
            package_dir,
            manifest,
            connector_descriptors,
            Vec::new(),
            Vec::new(),
        )
    }

    pub fn new_with_public_descriptors(
        package_dir: PathBuf,
        manifest: PluginManifest,
        connector_descriptors: Vec<EngineConnectorContributionDescriptor>,
        qa_rule_descriptors: Vec<QaRuleContributionDescriptor>,
        pipeline_step_descriptors: Vec<PipelineStepContributionDescriptor>,
    ) -> Self {
        Self::new_with_all_public_descriptors(
            package_dir,
            manifest,
            connector_descriptors,
            qa_rule_descriptors,
            pipeline_step_descriptors,
            Vec::new(),
        )
    }

    pub fn new_with_all_public_descriptors(
        package_dir: PathBuf,
        manifest: PluginManifest,
        connector_descriptors: Vec<EngineConnectorContributionDescriptor>,
        qa_rule_descriptors: Vec<QaRuleContributionDescriptor>,
        pipeline_step_descriptors: Vec<PipelineStepContributionDescriptor>,
        external_connector_descriptors: Vec<ExternalConnectorContributionDescriptor>,
    ) -> Self {
        Self {
            package_dir,
            manifest,
            connector_descriptors,
            qa_rule_descriptors,
            pipeline_step_descriptors,
            external_connector_descriptors,
            state: Mutex::new(None),
            start_lock: Mutex::new(()),
            next_generation: AtomicU64::new(1),
        }
    }

    pub fn from_normalized_manifest(
        package_dir: PathBuf,
        manifest: &NormalizedPluginManifest,
    ) -> Result<Self> {
        if !matches!(manifest.runtime, PluginRuntimeDescriptor::Process { .. }) {
            return Err(PluginRuntimeError::CapabilityUnsupported(
                "only process manifests can create a Tier 3 process host".to_string(),
            ));
        }
        let connector_descriptors = manifest
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::EngineConnector(descriptor) => {
                    Some(descriptor.clone())
                }
                _ => None,
            })
            .collect();
        let qa_rule_descriptors = manifest
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::QaRule(descriptor) => Some(descriptor.clone()),
                _ => None,
            })
            .collect();
        let pipeline_step_descriptors = manifest
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::PipelineStep(descriptor) => Some(descriptor.clone()),
                _ => None,
            })
            .collect();
        let external_connector_descriptors = manifest
            .contributions
            .iter()
            .filter_map(|contribution| match contribution {
                PluginContributionDescriptor::ExternalConnector(descriptor)
                    if descriptor.contract_version.is_some() =>
                {
                    Some(descriptor.clone())
                }
                _ => None,
            })
            .collect();
        Ok(Self::new_with_all_public_descriptors(
            package_dir,
            manifest.to_legacy_process_manifest()?,
            connector_descriptors,
            qa_rule_descriptors,
            pipeline_step_descriptors,
            external_connector_descriptors,
        ))
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
        let mut connector_ids = BTreeSet::new();
        for connector in &self.connector_descriptors {
            connector.validate_executable_v1(PluginTier::Process)?;
            if !connector_ids.insert(connector.id.as_str()) {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "duplicate process connector contribution {}",
                    connector.id
                )));
            }
        }
        let mut qa_rule_ids = BTreeSet::new();
        for descriptor in &self.qa_rule_descriptors {
            descriptor.validate_executable_v1(PluginTier::Process)?;
            if !qa_rule_ids.insert(descriptor.id.as_str()) {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "duplicate process QA contribution {}",
                    descriptor.id
                )));
            }
        }
        let mut pipeline_step_ids = BTreeSet::new();
        for descriptor in &self.pipeline_step_descriptors {
            descriptor.validate_executable_v1(PluginTier::Process)?;
            if !pipeline_step_ids.insert(descriptor.id.as_str()) {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "duplicate process pipeline contribution {}",
                    descriptor.id
                )));
            }
        }
        let mut external_connector_ids = BTreeSet::new();
        for descriptor in &self.external_connector_descriptors {
            descriptor.validate_executable_v1(PluginTier::Process)?;
            if !external_connector_ids.insert(descriptor.id.as_str()) {
                return Err(PluginRuntimeError::InvalidManifest(format!(
                    "duplicate process external connector contribution {}",
                    descriptor.id
                )));
            }
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
        let expected_contributions = self.manifest.filter_descriptors();
        let actual_contributions = handshake.contributions.filter_descriptors();
        if actual_contributions != expected_contributions {
            self.stop();
            return Err(PluginRuntimeError::Protocol(
                "plugin handshake contribution inventory does not match the manifest".to_string(),
            ));
        }
        if handshake.contributions.connector_descriptors() != self.connector_descriptors {
            self.stop();
            return Err(PluginRuntimeError::Protocol(
                "plugin handshake connector inventory does not match the manifest".to_string(),
            ));
        }
        if handshake.contributions.qa_rule_descriptors() != self.qa_rule_descriptors {
            self.stop();
            return Err(PluginRuntimeError::Protocol(
                "plugin handshake QA rule inventory does not match the manifest".to_string(),
            ));
        }
        if handshake.contributions.pipeline_step_descriptors() != self.pipeline_step_descriptors {
            self.stop();
            return Err(PluginRuntimeError::Protocol(
                "plugin handshake pipeline step inventory does not match the manifest".to_string(),
            ));
        }
        if handshake.contributions.external_connector_descriptors()
            != self.external_connector_descriptors
        {
            self.stop();
            return Err(PluginRuntimeError::Protocol(
                "plugin handshake external connector inventory does not match the manifest"
                    .to_string(),
            ));
        }
        Ok(())
    }

    pub fn stop(&self) {
        let state = self.state.lock().ok().and_then(|mut guard| guard.take());
        if let Some(mut state) = state {
            let mut params = serde_json::Map::new();
            if !self.connector_descriptors.is_empty() {
                params.insert(
                    "contractVersion".to_string(),
                    Value::from(ENGINE_CONNECTOR_CONTRACT_VERSION),
                );
            }
            if !self.qa_rule_descriptors.is_empty() || !self.pipeline_step_descriptors.is_empty() {
                params.insert("protocolVersion".to_string(), Value::from(1));
            }
            if let Ok(notification) =
                Self::encode_notification("plugin.shutdown", Value::Object(params))
            {
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
        let connector_routes: Arc<Mutex<BTreeMap<String, PendingConnectorRoute>>> =
            Arc::new(Mutex::new(BTreeMap::new()));
        let pipeline_checkpoint_routes: Arc<
            Mutex<BTreeMap<String, PendingPipelineCheckpointRoute>>,
        > = Arc::new(Mutex::new(BTreeMap::new()));
        let (writer, writer_receiver) =
            std::sync::mpsc::sync_channel::<String>(WRITER_QUEUE_CAPACITY);
        {
            let pending = Arc::clone(&pending);
            let connector_routes = Arc::clone(&connector_routes);
            thread::spawn(move || {
                let mut stdin = stdin;
                while let Ok(encoded) = writer_receiver.recv() {
                    if let Err(error) = writeln!(stdin, "{encoded}").and_then(|()| stdin.flush()) {
                        fail_connector_writer_routes(&connector_routes, &error);
                        fail_pending_writer_calls(&pending, &error);
                        break;
                    }
                }
            });
        }
        {
            let pending = Arc::clone(&pending);
            let connector_routes = Arc::clone(&connector_routes);
            let pipeline_checkpoint_routes = Arc::clone(&pipeline_checkpoint_routes);
            thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    let line = match read_bounded_frame(&mut reader, MAX_FRAME_BYTES) {
                        Ok(Some(line)) => line,
                        Ok(None) => break,
                        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                            fail_protocol_generation(
                                &pending,
                                &connector_routes,
                                "plugin frame exceeds size limit".to_string(),
                            );
                            break;
                        }
                        Err(_) => break,
                    };
                    if line.iter().all(u8::is_ascii_whitespace) {
                        continue;
                    }
                    match serde_json::from_slice::<Value>(&line) {
                        Ok(frame) => dispatch_frame(
                            &pending,
                            &connector_routes,
                            &pipeline_checkpoint_routes,
                            frame,
                        ),
                        Err(error) => {
                            let message = format!("invalid plugin JSON: {error}");
                            fail_protocol_generation(&pending, &connector_routes, message);
                            break;
                        }
                    }
                }
                fail_connector_routes(
                    &connector_routes,
                    ConnectorRouteFailure::Process("plugin process closed stdout".to_string()),
                );
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
            connector_routes,
            pipeline_checkpoint_routes,
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

    pub fn call_external_connector(
        &self,
        contribution_id: &str,
        request: &ExternalConnectorRequestV1,
        context: &ExternalConnectorInvocationContextV1,
        timeout: Duration,
    ) -> Result<ExternalConnectorResultV1> {
        let descriptor = self
            .external_connector_descriptors
            .iter()
            .find(|descriptor| descriptor.id == contribution_id)
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported(format!(
                    "unknown external connector contribution {contribution_id}"
                ))
            })?;
        let executable = descriptor.executable_v1(PluginTier::Process)?;
        request.validate(&executable.limits)?;
        context.validate_slots(&executable.slots_for(request.operation()))?;
        let method = format!("externalConnector.{}", request.operation().as_str());
        let params = json!({
            "request": request,
            "credentials": context.credentials,
        });
        let deadline = timeout.min(Duration::from_millis(request.header().deadline_ms));
        let result = self.call::<ExternalConnectorResultV1>(&method, params, deadline)?;
        result.validate(&executable.limits)?;
        Ok(result)
    }

    pub fn call_qa_rule(
        &self,
        invocation: &QaRuleInvocationV1,
        timeout: Duration,
    ) -> Result<QaRuleResultV1> {
        let descriptor = self
            .qa_rule_descriptors
            .iter()
            .find(|descriptor| descriptor.id == invocation.contribution_id)
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported(format!(
                    "unknown QA contribution {}",
                    invocation.contribution_id
                ))
            })?;
        let schema = descriptor.config_schema.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("QA config schema is missing".to_string())
        })?;
        let limits = descriptor.limits.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("QA limits are missing".to_string())
        })?;
        invocation.validate(schema, limits)?;
        let result: QaRuleResultV1 = self.call(
            QA_RULE_OPERATION_EVALUATE_SEGMENT,
            serde_json::to_value(invocation)?,
            timeout.min(Duration::from_millis(invocation.deadline_ms)),
        )?;
        result.validate(invocation, limits)?;
        Ok(result)
    }

    pub fn call_pipeline_step(
        &self,
        invocation: &PipelineStepInvocationV1,
        timeout: Duration,
    ) -> Result<PipelineStepResultV1> {
        self.call_pipeline_step_inner(invocation, timeout, None)
    }

    pub fn call_pipeline_checkpoint_migration(
        &self,
        invocation: &PipelineCheckpointMigrationInvocationV1,
        timeout: Duration,
    ) -> Result<PipelineCheckpointMigrationResultV1> {
        let descriptor = self
            .pipeline_step_descriptors
            .iter()
            .find(|descriptor| descriptor.id == invocation.contribution_id)
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported(format!(
                    "unknown pipeline contribution {}",
                    invocation.contribution_id
                ))
            })?;
        let schema = descriptor.config_schema.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("pipeline config schema is missing".to_string())
        })?;
        let limits = descriptor.limits.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("pipeline limits are missing".to_string())
        })?;
        invocation.validate(descriptor.checkpoint_schema_version, schema, limits)?;
        let result: PipelineCheckpointMigrationResultV1 = self.call(
            PIPELINE_STEP_OPERATION_CHECKPOINT_MIGRATE,
            serde_json::to_value(invocation)?,
            timeout.min(Duration::from_millis(invocation.deadline_ms)),
        )?;
        result.validate(descriptor.checkpoint_schema_version, limits)?;
        Ok(result)
    }

    pub fn call_pipeline_step_with_checkpoints(
        &self,
        invocation: &PipelineStepInvocationV1,
        timeout: Duration,
        on_checkpoint: impl Fn(PipelineStepCheckpointProgressV1) -> Result<()> + Send + Sync + 'static,
    ) -> Result<PipelineStepResultV1> {
        self.call_pipeline_step_inner(invocation, timeout, Some(Arc::new(on_checkpoint)))
    }

    fn call_pipeline_step_inner(
        &self,
        invocation: &PipelineStepInvocationV1,
        timeout: Duration,
        on_checkpoint: Option<Arc<PipelineCheckpointHandler>>,
    ) -> Result<PipelineStepResultV1> {
        let descriptor = self
            .pipeline_step_descriptors
            .iter()
            .find(|descriptor| descriptor.id == invocation.contribution_id)
            .ok_or_else(|| {
                PluginRuntimeError::CapabilityUnsupported(format!(
                    "unknown pipeline contribution {}",
                    invocation.contribution_id
                ))
            })?;
        let schema = descriptor.config_schema.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("pipeline config schema is missing".to_string())
        })?;
        let limits = descriptor.limits.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("pipeline limits are missing".to_string())
        })?;
        invocation.validate(
            descriptor.input_artifact_kind()?,
            descriptor.resumable,
            descriptor.checkpoint_schema_version,
            schema,
            limits,
        )?;
        let method = match invocation.operation {
            PipelineStepOperationV1::Execute => PIPELINE_STEP_OPERATION_EXECUTE,
            PipelineStepOperationV1::Resume => PIPELINE_STEP_OPERATION_RESUME,
        };
        let params = serde_json::to_value(invocation)?;
        let checkpoint_route = if let Some(handler) = on_checkpoint {
            self.ensure_started()?;
            let routes = {
                let guard = self.state.lock().map_err(|_| {
                    PluginRuntimeError::Process("process lock poisoned".to_string())
                })?;
                Arc::clone(
                    &guard
                        .as_ref()
                        .ok_or_else(|| {
                            PluginRuntimeError::Process("plugin process is not running".to_string())
                        })?
                        .pipeline_checkpoint_routes,
                )
            };
            let failure = Arc::new(Mutex::new(None));
            let route = PendingPipelineCheckpointRoute {
                contribution_id: invocation.contribution_id.clone(),
                checkpoint_schema_version: descriptor.checkpoint_schema_version,
                limits: limits.clone(),
                handler,
                failure: Arc::clone(&failure),
            };
            let previous = routes
                .lock()
                .map_err(|_| {
                    PluginRuntimeError::Process(
                        "pipeline checkpoint route lock poisoned".to_string(),
                    )
                })?
                .insert(invocation.invocation_id.clone(), route);
            if previous.is_some() {
                return Err(PluginRuntimeError::Protocol(
                    "pipeline checkpoint invocationId is already active".to_string(),
                ));
            }
            Some((routes, failure))
        } else {
            None
        };
        let result = self.call(
            method,
            params,
            timeout.min(Duration::from_millis(invocation.deadline_ms)),
        );
        let checkpoint_failure = checkpoint_route.and_then(|(routes, failure)| {
            routes
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(&invocation.invocation_id);
            failure
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take()
        });
        if checkpoint_failure.is_some() {
            return Err(PluginRuntimeError::Protocol(
                "plugin pipeline checkpoint was rejected".to_string(),
            ));
        }
        let result: PipelineStepResultV1 = result?;
        result.validate(
            descriptor.output_artifact_kind()?,
            descriptor.resumable,
            descriptor.checkpoint_schema_version,
            limits,
        )?;
        Ok(result)
    }

    pub fn cancel_qa_rule(&self, invocation_id: &str) -> Result<()> {
        self.send_public_cancel_notification(QA_RULE_OPERATION_CANCEL, invocation_id)
    }

    pub fn cancel_pipeline_step(&self, invocation_id: &str) -> Result<()> {
        self.send_public_cancel_notification(PIPELINE_STEP_OPERATION_CANCEL, invocation_id)
    }

    fn send_public_cancel_notification(&self, method: &str, invocation_id: &str) -> Result<()> {
        let request = ContributionCancelRequestV1::new(invocation_id);
        request.validate()?;
        self.ensure_started()?;
        let encoded = Self::encode_notification(method, serde_json::to_value(request)?)?;
        let guard = self
            .state
            .lock()
            .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
        let state = guard.as_ref().ok_or_else(|| {
            PluginRuntimeError::Process("plugin process is not running".to_string())
        })?;
        state.writer.try_send(encoded).map_err(|error| match error {
            TrySendError::Full(_) => {
                PluginRuntimeError::Process("plugin process writer queue is full".to_string())
            }
            TrySendError::Disconnected(_) => {
                PluginRuntimeError::Process("plugin process writer is closed".to_string())
            }
        })
    }

    pub fn call_connector_stream<F>(
        &self,
        request: &EngineConnectorGenerateRequestV1,
        credential: Option<&str>,
        limits: &EngineConnectorLimitsV1,
        timeout: Duration,
        mut on_event: F,
    ) -> Result<EngineConnectorResultV1>
    where
        F: FnMut(EngineConnectorEventV1) -> Result<()>,
    {
        EngineConnectorRequestV1::Generate(request.clone()).validate(limits)?;
        if let Some(credential) = credential
            && (credential.len() > MAX_CONNECTOR_CREDENTIAL_BYTES || credential.contains('\0'))
        {
            return Err(PluginRuntimeError::Protocol(
                "connector credential is malformed or oversized".to_string(),
            ));
        }
        self.ensure_started()?;

        let mut params = serde_json::Map::new();
        params.insert(
            "request".to_string(),
            serde_json::to_value(EngineConnectorRequestV1::Generate(request.clone()))?,
        );
        if let Some(credential) = credential {
            params.insert(
                "credential".to_string(),
                Value::String(credential.to_string()),
            );
        }

        let started_at = Instant::now();
        let deadline = timeout.min(Duration::from_millis(request.deadline_ms));
        let (
            generation,
            id,
            response_receiver,
            event_receiver,
            failure,
            pending,
            connector_routes,
            writer,
        ) = {
            let mut guard = self
                .state
                .lock()
                .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
            let state = guard.as_mut().ok_or_else(|| {
                PluginRuntimeError::Process("plugin process is not running".into())
            })?;
            if let Some(status) = state.child.try_wait()? {
                self.log_stderr_tail(state, "exited before connector call");
                *guard = None;
                return Err(PluginRuntimeError::Process(format!(
                    "plugin exited before connector call (status {status})"
                )));
            }
            let id = state.next_id.fetch_add(1, Ordering::Relaxed);
            let (response_sender, response_receiver) = std::sync::mpsc::channel();
            let (event_sender, event_receiver) =
                std::sync::mpsc::sync_channel(CONNECTOR_EVENT_QUEUE_CAPACITY);
            let failure = Arc::new(Mutex::new(None));
            let mut connector_routes = state
                .connector_routes
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if connector_routes.contains_key(&request.request_id) {
                return Err(PluginRuntimeError::Conflict(format!(
                    "connector requestId {} is already active",
                    request.request_id
                )));
            }
            state
                .pending
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(
                    id,
                    PendingCall {
                        method: "connector.generate".to_string(),
                        pipeline_invocation_id: None,
                        sender: response_sender,
                    },
                );
            connector_routes.insert(
                request.request_id.clone(),
                PendingConnectorRoute {
                    call_id: id,
                    sequence: EngineConnectorEventSequenceV1::new(&request.request_id)?,
                    limits: limits.clone(),
                    events: event_sender,
                    failure: Arc::clone(&failure),
                },
            );
            drop(connector_routes);

            let frame = json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "connector.generate",
                "params": Value::Object(params),
            });
            let encoded = serde_json::to_string(&frame)?;
            if encoded.len() > MAX_FRAME_BYTES {
                state
                    .pending
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&id);
                state
                    .connector_routes
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&request.request_id);
                return Err(PluginRuntimeError::Protocol(
                    "request frame exceeds size limit".to_string(),
                ));
            }
            if let Err(error) = state.writer.try_send(encoded) {
                state
                    .pending
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&id);
                state
                    .connector_routes
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&request.request_id);
                return Err(match error {
                    TrySendError::Full(_) => {
                        PluginRuntimeError::Process("plugin stdin writer queue is full".to_string())
                    }
                    TrySendError::Disconnected(_) => PluginRuntimeError::Process(
                        "plugin stdin writer is unavailable".to_string(),
                    ),
                });
            }
            (
                state.generation,
                id,
                response_receiver,
                event_receiver,
                failure,
                Arc::clone(&state.pending),
                Arc::clone(&state.connector_routes),
                state.writer.clone(),
            )
        };

        let mut terminal_result = None;
        loop {
            if let Err(error) = drain_connector_events(
                &event_receiver,
                &mut terminal_result,
                &mut on_event,
                started_at,
                deadline,
            ) {
                remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                send_connector_cancel_notification(&writer, &request.request_id);
                return Err(error);
            }
            if let Some(error) = take_connector_failure(&failure) {
                remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                if error.is_fatal() {
                    self.mark_dead(generation, "fatal connector stream error");
                }
                return Err(error.into_error());
            }

            match response_receiver.try_recv() {
                Ok(response) => {
                    if let Err(error) = drain_connector_events(
                        &event_receiver,
                        &mut terminal_result,
                        &mut on_event,
                        started_at,
                        deadline,
                    ) {
                        remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                        send_connector_cancel_notification(&writer, &request.request_id);
                        return Err(error);
                    }
                    if let Some(error) = take_connector_failure(&failure) {
                        remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                        if error.is_fatal() {
                            self.mark_dead(generation, "fatal connector stream error");
                        }
                        return Err(error.into_error());
                    }
                    return finish_connector_response(
                        response,
                        terminal_result,
                        &pending,
                        &connector_routes,
                        &writer,
                        id,
                        &request.request_id,
                    );
                }
                Err(TryRecvError::Disconnected) => {
                    if let Some(error) = take_connector_failure(&failure) {
                        remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                        if error.is_fatal() {
                            self.mark_dead(generation, "fatal connector stream error");
                        }
                        return Err(error.into_error());
                    }
                    remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                    self.mark_dead(generation, "connector response channel disconnected");
                    return Err(PluginRuntimeError::Process(format!(
                        "plugin call connector.generate disconnected (id {id})"
                    )));
                }
                Err(TryRecvError::Empty) => {}
            }

            let remaining = deadline.saturating_sub(started_at.elapsed());
            if remaining.is_zero() {
                remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                send_connector_cancel_notification(&writer, &request.request_id);
                return Err(PluginRuntimeError::Timeout(deadline));
            }
            match response_receiver.recv_timeout(remaining.min(CONNECTOR_RESPONSE_POLL_INTERVAL)) {
                Ok(response) => {
                    // Re-enter through the single response finalization path.
                    if let Err(error) = drain_connector_events(
                        &event_receiver,
                        &mut terminal_result,
                        &mut on_event,
                        started_at,
                        deadline,
                    ) {
                        remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                        send_connector_cancel_notification(&writer, &request.request_id);
                        return Err(error);
                    }
                    if let Some(error) = take_connector_failure(&failure) {
                        remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                        if error.is_fatal() {
                            self.mark_dead(generation, "fatal connector stream error");
                        }
                        return Err(error.into_error());
                    }
                    return finish_connector_response(
                        response,
                        terminal_result,
                        &pending,
                        &connector_routes,
                        &writer,
                        id,
                        &request.request_id,
                    );
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    if let Some(error) = take_connector_failure(&failure) {
                        remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                        if error.is_fatal() {
                            self.mark_dead(generation, "fatal connector stream error");
                        }
                        return Err(error.into_error());
                    }
                    remove_connector_call(&pending, &connector_routes, id, &request.request_id);
                    self.mark_dead(generation, "connector response channel disconnected");
                    return Err(PluginRuntimeError::Process(format!(
                        "plugin call connector.generate disconnected (id {id})"
                    )));
                }
            }
        }
    }

    pub fn cancel_connector_request(
        &self,
        request: &EngineConnectorCancelRequestV1,
        timeout: Duration,
    ) -> Result<()> {
        request.validate()?;
        self.ensure_started()?;
        self.call_started_with_policy::<ConnectorCancelAck>(
            "connector.cancel",
            serde_json::to_value(request)?,
            timeout,
            false,
        )?;
        Ok(())
    }

    pub fn notify_connector_cancel(&self, request: &EngineConnectorCancelRequestV1) -> Result<()> {
        request.validate()?;
        self.ensure_started()?;
        let guard = self
            .state
            .lock()
            .map_err(|_| PluginRuntimeError::Process("process lock poisoned".to_string()))?;
        let state = guard
            .as_ref()
            .ok_or_else(|| PluginRuntimeError::Process("plugin process is not running".into()))?;
        let encoded =
            Self::encode_notification("connector.cancel", serde_json::to_value(request)?)?;
        state.writer.try_send(encoded).map_err(|error| match error {
            TrySendError::Full(_) => {
                PluginRuntimeError::Process("plugin stdin writer queue is full".to_string())
            }
            TrySendError::Disconnected(_) => {
                PluginRuntimeError::Process("plugin stdin writer is unavailable".to_string())
            }
        })
    }

    pub fn shutdown_connector(&self, timeout: Duration) -> Result<()> {
        let request = EngineConnectorShutdownRequestV1 {
            contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
        };
        request.validate()?;
        self.call::<ConnectorCancelAck>(
            "plugin.shutdown",
            serde_json::to_value(request)?,
            timeout,
        )?;
        self.stop();
        Ok(())
    }

    fn call_started<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<T> {
        self.call_started_with_policy(method, params, timeout, true)
    }

    fn call_started_with_policy<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
        fatal_timeout: bool,
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
                        pipeline_invocation_id: matches!(
                            method,
                            PIPELINE_STEP_OPERATION_EXECUTE
                                | PIPELINE_STEP_OPERATION_RESUME
                                | PIPELINE_STEP_OPERATION_CHECKPOINT_MIGRATE
                        )
                        .then(|| {
                            params
                                .get("invocationId")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .flatten(),
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
                    if fatal_timeout {
                        self.mark_dead(generation, "invalid result payload");
                    }
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
                if fatal_timeout {
                    self.mark_dead(generation, "call timeout");
                } else if let Ok(guard) = self.state.lock()
                    && let Some(state) = guard
                        .as_ref()
                        .filter(|state| state.generation == generation)
                {
                    state
                        .pending
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .remove(&id);
                }
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

fn drain_connector_events<F>(
    receiver: &Receiver<EngineConnectorEventV1>,
    terminal_result: &mut Option<EngineConnectorResultV1>,
    on_event: &mut F,
    started_at: Instant,
    deadline: Duration,
) -> Result<()>
where
    F: FnMut(EngineConnectorEventV1) -> Result<()>,
{
    loop {
        match receiver.try_recv() {
            Ok(event) => {
                if started_at.elapsed() >= deadline {
                    return Err(PluginRuntimeError::Timeout(deadline));
                }
                if let EngineConnectorEventV1::Completed { result, .. } = &event {
                    *terminal_result = Some(result.clone());
                }
                on_event(event)?;
                if started_at.elapsed() >= deadline {
                    return Err(PluginRuntimeError::Timeout(deadline));
                }
            }
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn finish_connector_response(
    response: Result<Value>,
    terminal_result: Option<EngineConnectorResultV1>,
    pending: &Mutex<BTreeMap<u64, PendingCall>>,
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    writer: &SyncSender<String>,
    call_id: u64,
    request_id: &str,
) -> Result<EngineConnectorResultV1> {
    let value = match response {
        Ok(value) => value,
        Err(error) => {
            remove_connector_call(pending, connector_routes, call_id, request_id);
            return Err(error);
        }
    };
    let ack: ConnectorGenerateAck = match serde_json::from_value(value) {
        Ok(ack) => ack,
        Err(error) => {
            remove_connector_call(pending, connector_routes, call_id, request_id);
            send_connector_cancel_notification(writer, request_id);
            return Err(PluginRuntimeError::Protocol(format!(
                "invalid result for connector.generate: {error}"
            )));
        }
    };
    let route = connector_routes
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(request_id);
    pending
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&call_id);
    if !ack.completed || !route.is_some_and(|route| route.sequence.is_completed()) {
        send_connector_cancel_notification(writer, request_id);
        return Err(PluginRuntimeError::Protocol(
            "connector.generate completed without one terminal event".to_string(),
        ));
    }
    terminal_result.ok_or_else(|| {
        PluginRuntimeError::Protocol("connector.generate terminal result is missing".to_string())
    })
}

fn take_connector_failure(
    failure: &Mutex<Option<ConnectorRouteFailure>>,
) -> Option<ConnectorRouteFailure> {
    failure
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
}

fn remove_connector_call(
    pending: &Mutex<BTreeMap<u64, PendingCall>>,
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    call_id: u64,
    request_id: &str,
) {
    connector_routes
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(request_id);
    pending
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&call_id);
}

fn send_connector_cancel_notification(writer: &SyncSender<String>, request_id: &str) {
    let request = EngineConnectorCancelRequestV1 {
        contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
        request_id: request_id.to_string(),
    };
    if let Ok(params) = serde_json::to_value(request)
        && let Ok(encoded) = PluginProcess::encode_notification("connector.cancel", params)
    {
        let _ = writer.try_send(encoded);
    }
}

impl Drop for PluginProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn read_bounded_frame<R: BufRead>(
    reader: &mut R,
    maximum: usize,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((!frame.is_empty()).then_some(frame));
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |position| position + 1);
        let content = newline.map_or(available, |position| &available[..position]);
        if frame.len().saturating_add(content.len()) > maximum {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "plugin frame exceeds size limit",
            ));
        }
        frame.extend_from_slice(content);
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(Some(frame));
        }
    }
}

fn fail_protocol_generation(
    pending: &Mutex<BTreeMap<u64, PendingCall>>,
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    message: String,
) {
    fail_connector_routes(
        connector_routes,
        ConnectorRouteFailure::FatalProtocol(message.clone()),
    );
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    for (_, call) in std::mem::take(&mut *pending) {
        let _ = call
            .sender
            .send(Err(PluginRuntimeError::Protocol(message.clone())));
    }
}

fn dispatch_frame(
    pending: &Mutex<BTreeMap<u64, PendingCall>>,
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    pipeline_checkpoint_routes: &Mutex<BTreeMap<String, PendingPipelineCheckpointRoute>>,
    frame: Value,
) {
    if frame.get("method").is_some() {
        if frame.get("method").and_then(Value::as_str) == Some("pipeline.checkpoint") {
            dispatch_pipeline_checkpoint_notification(
                pending,
                connector_routes,
                pipeline_checkpoint_routes,
                frame,
            );
            return;
        }
        dispatch_connector_notification(pending, connector_routes, frame);
        return;
    }
    let Some(id) = frame.get("id").and_then(Value::as_u64) else {
        return;
    };
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    let Some(call) = pending.remove(&id) else {
        return;
    };
    if let Some(invocation_id) = &call.pipeline_invocation_id {
        pipeline_checkpoint_routes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(invocation_id);
    }
    if call.method.starts_with("connector.") && !is_strict_connector_response(&frame, id) {
        let _ = call.sender.send(Err(PluginRuntimeError::Protocol(format!(
            "invalid JSON-RPC response for {}",
            call.method
        ))));
        return;
    }
    if frame.get("error").is_some() {
        if call.method.starts_with("externalConnector.")
            && let Some(data) = frame.pointer("/error/data").cloned()
            && let Ok(failure) = serde_json::from_value::<ExternalConnectorFailureV1>(data)
            && failure.validate().is_ok()
        {
            let _ = call
                .sender
                .send(Err(PluginRuntimeError::ExternalConnectorFailure(failure)));
            return;
        }
        let _ = call.sender.send(Err(PluginRuntimeError::Remote(format!(
            "{}: plugin operation failed",
            call.method
        ))));
        return;
    }
    let result = frame.get("result").cloned().unwrap_or(Value::Null);
    let _ = call.sender.send(Ok(result));
}

fn dispatch_pipeline_checkpoint_notification(
    pending: &Mutex<BTreeMap<u64, PendingCall>>,
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    routes: &Mutex<BTreeMap<String, PendingPipelineCheckpointRoute>>,
    frame: Value,
) {
    let strict_frame = frame.as_object().is_some_and(|object| {
        object.len() == 3
            && object.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
            && object.get("method").and_then(Value::as_str) == Some("pipeline.checkpoint")
            && object.contains_key("params")
    });
    let progress = strict_frame
        .then(|| frame.get("params").cloned().unwrap_or(Value::Null))
        .ok_or_else(|| "invalid pipeline.checkpoint frame".to_string())
        .and_then(|params| {
            serde_json::from_value::<PipelineStepCheckpointProgressV1>(params)
                .map_err(|_| "invalid pipeline.checkpoint params".to_string())
        });
    let progress = match progress {
        Ok(progress) => progress,
        Err(message) => {
            fail_protocol_generation(pending, connector_routes, message);
            return;
        }
    };
    let route = routes
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&progress.invocation_id)
        .cloned();
    let Some(route) = route else {
        return;
    };
    let accepted = progress
        .validate(
            &progress.invocation_id,
            &route.contribution_id,
            route.checkpoint_schema_version,
            &route.limits,
        )
        .and_then(|()| (route.handler)(progress));
    if accepted.is_err() {
        let mut failure = route
            .failure
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if failure.is_none() {
            *failure = Some("pipeline checkpoint was rejected".to_string());
        }
    }
}

fn is_strict_connector_response(frame: &Value, expected_id: u64) -> bool {
    let Some(object) = frame.as_object() else {
        return false;
    };
    let has_result = object.contains_key("result");
    let has_error = object.get("error").is_some_and(Value::is_object);
    object.len() == 3
        && object.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && object.get("id").and_then(Value::as_u64) == Some(expected_id)
        && has_result != has_error
}

fn dispatch_connector_notification(
    pending: &Mutex<BTreeMap<u64, PendingCall>>,
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    frame: Value,
) {
    if frame.get("method").and_then(Value::as_str) != Some("connector.event") {
        return;
    }
    let Some(request_id) = frame
        .get("params")
        .and_then(Value::as_object)
        .and_then(|params| params.get("requestId"))
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };

    let strict_frame = frame.as_object().is_some_and(|object| {
        object.len() == 3
            && object.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
            && object.get("method").and_then(Value::as_str) == Some("connector.event")
            && object.contains_key("params")
    });
    let event = if strict_frame {
        serde_json::from_value::<EngineConnectorEventV1>(
            frame.get("params").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| format!("invalid connector.event params: {error}"))
    } else {
        Err("invalid connector.event frame".to_string())
    };

    let mut routes = connector_routes
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(route) = routes.get_mut(&request_id) else {
        return;
    };
    let failure_message = match event {
        Ok(event) => match route.sequence.accept(&event, &route.limits) {
            Ok(()) => match route.events.try_send(event) {
                Ok(()) => None,
                Err(TrySendError::Full(_)) => {
                    Some("connector event queue exceeds its capacity".to_string())
                }
                Err(TrySendError::Disconnected(_)) => {
                    Some("connector event receiver is unavailable".to_string())
                }
            },
            Err(error) => Some(format!("invalid connector event sequence: {error}")),
        },
        Err(message) => Some(message),
    };
    let Some(message) = failure_message else {
        return;
    };
    let route = routes
        .remove(&request_id)
        .expect("connector route exists after validation failure");
    drop(routes);
    *route
        .failure
        .lock()
        .unwrap_or_else(|error| error.into_inner()) =
        Some(ConnectorRouteFailure::Protocol(message));
    pending
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&route.call_id);
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

fn fail_connector_routes(
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    failure: ConnectorRouteFailure,
) {
    let mut connector_routes = connector_routes
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for (_, route) in std::mem::take(&mut *connector_routes) {
        *route
            .failure
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(failure.clone());
    }
}

fn fail_connector_writer_routes(
    connector_routes: &Mutex<BTreeMap<String, PendingConnectorRoute>>,
    error: &std::io::Error,
) {
    fail_connector_routes(
        connector_routes,
        ConnectorRouteFailure::Io(error.kind(), error.to_string()),
    );
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
    capability_authorizer: Option<Arc<dyn PluginCapabilityAuthorizer>>,
    capability_version_id: String,
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
            capability_authorizer: None,
            capability_version_id: String::new(),
            default_call_timeout: DEFAULT_CALL_TIMEOUT,
            import_call_timeout: IMPORT_CALL_TIMEOUT,
        }
    }

    /// Attach the Engine-owned authorizer.  The legacy constructor remains
    /// source-compatible for SDK/fixture callers; production registration
    /// always supplies this handle so revocations are observed at operation
    /// time rather than cached in the adapter.
    pub fn with_capability_authorizer(
        mut self,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        version_id: impl Into<String>,
    ) -> Self {
        self.capability_authorizer = Some(authorizer);
        self.capability_version_id = version_id.into();
        self
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
        if let Some(authorizer) = &self.capability_authorizer {
            let request = parse_legacy_permission(permission).map_err(|error| {
                FilterError::PluginPermissionDenied {
                    plugin_id: self.process.manifest().id.clone(),
                    filter_id: self.descriptor.id.clone(),
                    operation: operation.to_string(),
                    message: format!("malformed capability request: {error}"),
                }
            })?;
            let check = PluginCapabilityCheck {
                plugin_id: self.process.manifest().id.clone(),
                version_id: self.capability_version_id.clone(),
                capability_id: request.capability_id,
                scope: request.scope,
                operation: operation.to_string(),
                contribution_id: Some(self.descriptor.id.clone()),
            };
            return authorizer.authorize(&check).map_err(|denial| {
                FilterError::PluginPermissionDenied {
                    plugin_id: denial.plugin_id,
                    filter_id: self.descriptor.id.clone(),
                    operation: denial.operation,
                    message: format!("{} ({:?})", denial.message, denial.code),
                }
            });
        }
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
                    PluginRuntimeError::ExternalConnectorFailure(_) => {
                        PluginProcessFailureKind::Protocol
                    }
                    PluginRuntimeError::Io(_) => PluginProcessFailureKind::Io,
                    PluginRuntimeError::Process(_)
                    | PluginRuntimeError::InvalidManifest(_)
                    | PluginRuntimeError::NotFound(_)
                    | PluginRuntimeError::Conflict(_)
                    | PluginRuntimeError::UnsupportedVersion { .. }
                    | PluginRuntimeError::IncompatibleHost { .. }
                    | PluginRuntimeError::CapabilityUnsupported(_)
                    | PluginRuntimeError::PackageInvalid(_)
                    | PluginRuntimeError::PackageHashMismatch { .. } => {
                        PluginProcessFailureKind::Crash
                    }
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalPackageHash<'a> {
    algorithm: &'a str,
    version: u32,
    entries: &'a [PluginPackageFileDigest],
}

/// Hash every regular file in a package using the canonical package identity
/// described by the multi-tier control-plane contract.  The manifest is
/// included in the same sorted entry list as all other files.
pub fn hash_plugin_package(package_dir: &Path) -> Result<PluginPackageHash> {
    reject_reparse(package_dir, "package root")?;
    if !package_dir.is_dir() {
        return Err(PluginRuntimeError::PackageInvalid(
            "package root must be a directory".to_string(),
        ));
    }
    let mut entries = Vec::new();
    let mut seen_paths = BTreeSet::new();
    let mut total_bytes = 0_u64;
    collect_package_files(
        package_dir,
        package_dir,
        0,
        &mut entries,
        &mut seen_paths,
        &mut total_bytes,
    )?;
    if entries.is_empty() {
        return Err(PluginRuntimeError::PackageInvalid(
            "package contains no regular files".to_string(),
        ));
    }
    entries.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
    let canonical = CanonicalPackageHash {
        algorithm: PACKAGE_HASH_ALGORITHM,
        version: PACKAGE_HASH_VERSION,
        entries: &entries,
    };
    let bytes = serde_json::to_vec(&canonical)?;
    let sha256 = hex_digest(&Sha256::digest(&bytes));
    Ok(PluginPackageHash {
        algorithm: PACKAGE_HASH_ALGORITHM.to_string(),
        version: PACKAGE_HASH_VERSION,
        sha256,
        total_bytes,
        entries,
    })
}

fn collect_package_files(
    root: &Path,
    directory: &Path,
    depth: usize,
    entries: &mut Vec<PluginPackageFileDigest>,
    seen_paths: &mut BTreeSet<String>,
    total_bytes: &mut u64,
) -> Result<()> {
    if depth > MAX_PACKAGE_DEPTH {
        return Err(PluginRuntimeError::PackageInvalid(
            "package exceeds directory nesting limit".to_string(),
        ));
    }
    reject_reparse(directory, "package directory")?;
    let mut children = std::fs::read_dir(directory)
        .map_err(PluginRuntimeError::Io)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for entry in children {
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "package contains a symlink or reparse point: {}",
                path.display()
            )));
        }
        if metadata.is_dir() {
            collect_package_files(root, &path, depth + 1, entries, seen_paths, total_bytes)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "package contains a non-regular entry: {}",
                path.display()
            )));
        }
        if entries.len() >= MAX_PACKAGE_FILES {
            return Err(PluginRuntimeError::PackageInvalid(
                "package contains too many files".to_string(),
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| PluginRuntimeError::PackageInvalid("package path escaped root".into()))?;
        let relative = normalize_relative_path(&relative.to_string_lossy(), "package path")?;
        if !seen_paths.insert(relative.clone()) {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "package contains duplicate normalized path: {relative}"
            )));
        }
        let mut file = File::open(&path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut size = 0_u64;
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            size = size.saturating_add(read as u64);
            *total_bytes = total_bytes.saturating_add(read as u64);
            if *total_bytes > MAX_PACKAGE_TOTAL_BYTES {
                return Err(PluginRuntimeError::PackageInvalid(
                    "package exceeds total byte limit".to_string(),
                ));
            }
            hasher.update(&buffer[..read]);
        }
        entries.push(PluginPackageFileDigest {
            path: relative,
            size,
            sha256: hex_digest(&hasher.finalize()),
        });
    }
    Ok(())
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

pub fn inspect_plugin_package(
    package_dir: &Path,
) -> Result<(NormalizedPluginManifest, PluginPackageHash)> {
    let normalized = load_normalized_manifest(package_dir)?;
    let package_hash = hash_plugin_package(package_dir)?;
    Ok((normalized, package_hash))
}

/// Copy or extract a source package into a unique staging directory and hash
/// the staged bytes. Directories and `.tlplugin` archives share one path.
/// The destination is created with `create_dir`, so an existing path can never
/// be clobbered.
pub fn stage_plugin_package(source: &Path, staging_root: &Path) -> Result<StagedPluginPackage> {
    materialize_plugin_package(source, staging_root, None)
}

pub fn publish_staged_package(staged: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        return Err(PluginRuntimeError::Conflict(format!(
            "managed package destination already exists: {}",
            destination.display()
        )));
    }
    let parent = destination.parent().ok_or_else(|| {
        PluginRuntimeError::PackageInvalid("managed package destination has no parent".into())
    })?;
    std::fs::create_dir_all(parent)?;
    std::fs::rename(staged, destination)?;
    Ok(())
}

pub fn verify_plugin_package_hash(package_dir: &Path, expected: &str) -> Result<PluginPackageHash> {
    let actual = hash_plugin_package(package_dir)?;
    if actual.sha256 != expected {
        return Err(PluginRuntimeError::PackageHashMismatch {
            expected: expected.to_string(),
            actual: actual.sha256.clone(),
        });
    }
    Ok(actual)
}

/// Recursively copy a plugin package into the managed data directory.
pub fn copy_package(source: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        std::fs::remove_dir_all(destination)?;
    }
    copy_dir_secure(source, destination, 0)
}

pub(crate) fn copy_dir_secure(source: &Path, destination: &Path, depth: usize) -> Result<()> {
    if depth > MAX_PACKAGE_DEPTH {
        return Err(PluginRuntimeError::PackageInvalid(
            "package exceeds directory nesting limit".to_string(),
        ));
    }
    reject_reparse(source, "plugin source directory")?;
    std::fs::create_dir_all(destination)?;
    let mut entries = std::fs::read_dir(source)
        .map_err(PluginRuntimeError::Io)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let source_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let metadata = std::fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "package contains a symlink or reparse point: {}",
                source_path.display()
            )));
        }
        if metadata.is_dir() {
            copy_dir_secure(&source_path, &target_path, depth + 1)?;
        } else if metadata.is_file() {
            std::fs::copy(&source_path, &target_path)?;
        } else {
            return Err(PluginRuntimeError::PackageInvalid(format!(
                "package contains a non-regular entry: {}",
                source_path.display()
            )));
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
    use std::process::Command;
    use tempfile::tempdir;

    fn v2_contributions() -> Vec<Value> {
        vec![
            json!({
                "kind": "filter",
                "descriptorVersion": 1,
                "id": "example.v2.filter",
                "version": "1.0.0",
                "displayName": "V2 filter",
                "extensions": ["v2"],
                "capabilities": {
                    "import": true, "export": true, "validate": true,
                    "inlineTags": false, "notes": false, "degradationReport": true
                }
            }),
            json!({
                "kind": "engineConnector",
                "descriptorVersion": 1,
                "id": "example.v2.engine",
                "version": "1.0.0",
                "displayName": "V2 engine",
                "protocol": "local",
                "operations": ["lookup"],
                "configSchemaVersion": 1
            }),
            json!({
                "kind": "qaRule",
                "descriptorVersion": 1,
                "id": "example.v2.qa",
                "version": "1.0.0",
                "displayName": "V2 QA",
                "ruleType": "style",
                "severity": "warning",
                "definition": {}
            }),
            json!({
                "kind": "pipelineStep",
                "descriptorVersion": 1,
                "id": "example.v2.step",
                "version": "1.0.0",
                "displayName": "V2 step",
                "input": "json",
                "output": "json",
                "configSchemaVersion": 1,
                "resumable": true,
                "cancellable": true
            }),
            json!({
                "kind": "aiAction",
                "descriptorVersion": 1,
                "id": "example.v2.action",
                "version": "1.0.0",
                "displayName": "V2 action",
                "label": "Explain",
                "placement": "selection",
                "input": {"type": "string"},
                "promptTemplate": "Explain this"
            }),
            json!({
                "kind": "uiPanel",
                "descriptorVersion": 1,
                "id": "example.v2.panel",
                "version": "1.0.0",
                "displayName": "V2 panel",
                "label": "Panel",
                "placement": "sidebar",
                "surface": "panel.html",
                "bridgeVersion": 1
            }),
            json!({
                "kind": "externalConnector",
                "descriptorVersion": 1,
                "id": "example.v2.external",
                "version": "1.0.0",
                "displayName": "V2 external",
                "transports": ["http"],
                "checkpointVersion": 1,
                "capabilities": {"read": true}
            }),
        ]
    }

    fn v2_manifest(runtime: Value, contributions: Vec<Value>) -> Value {
        json!({
            "manifestVersion": 2,
            "id": "example.v2",
            "displayName": "V2 fixture",
            "version": "1.0.0",
            "hostApi": {"min": 1, "max": 1},
            "runtime": runtime,
            "contributions": contributions,
            "permissions": []
        })
    }

    fn write_manifest(dir: &Path, body: &str) {
        fs::write(dir.join(MANIFEST_FILE_NAME), body).expect("write manifest");
        fs::write(dir.join("entry.mjs"), "console.log('ok')").expect("write entry");
    }

    fn process_connector_descriptor() -> EngineConnectorContributionDescriptor {
        serde_json::from_value(json!({
            "descriptorVersion": 1,
            "id": "example.process.connector",
            "version": "1.0.0",
            "displayName": "Process connector",
            "protocol": ENGINE_CONNECTOR_PROTOCOL_V1,
            "operations": ["validateConfig", "test", "generate"],
            "configSchemaVersion": 1,
            "contractVersion": 1,
            "configSchema": {"schemaVersion": 1, "fields": []},
            "limits": EngineConnectorLimitsV1::default()
        }))
        .expect("process connector descriptor")
    }

    fn external_connector_request(
        operation: ExternalConnectorOperationV1,
    ) -> ExternalConnectorRequestV1 {
        let header = ExternalConnectorRequestHeaderV1 {
            contract_version: 1,
            request_id: format!("fixture-{}", operation.as_str()),
            deadline_ms: 2_000,
            binding: ExternalConnectorProfileBindingV1 {
                profile_id: "fixture-profile".into(),
                contribution_id: "example.external-connector-fixture.system".into(),
                plugin_id: "example.external-connector-fixture".into(),
                version_id: "install-v1:example.external-connector-fixture:1.0.0".into(),
                activation_revision: 1,
                contract_version: 1,
                config_schema_version: 1,
                checkpoint_schema_version: 1,
            },
            idempotency_key: Some(format!("fixture-{}", operation.as_str())),
            expected_checkpoint_revision: None,
            attempt: 1,
            config: BTreeMap::new(),
        };
        match operation {
            ExternalConnectorOperationV1::Pull => ExternalConnectorRequestV1::Pull {
                header,
                payload: ExternalConnectorPullPayloadV1 {
                    stream_id: "default".into(),
                    cursor: None,
                    limit: 10,
                    source_locale: None,
                    target_locale: None,
                },
            },
            ExternalConnectorOperationV1::Push => ExternalConnectorRequestV1::Push {
                header,
                payload: ExternalConnectorPushPayloadV1 {
                    stream_id: "default".into(),
                    items: vec![ExternalConnectorItemV1 {
                        external_id: "item-1".into(),
                        external_revision: None,
                        source_locale: "en".into(),
                        target_locale: "zh".into(),
                        source_text: "hello".into(),
                        target_text: None,
                        context: None,
                        metadata: BTreeMap::new(),
                    }],
                },
            },
            ExternalConnectorOperationV1::Poll => ExternalConnectorRequestV1::Poll {
                header,
                payload: ExternalConnectorPollPayloadV1 {
                    stream_id: "default".into(),
                    cursor: None,
                    limit: 10,
                },
            },
            ExternalConnectorOperationV1::Webhook => ExternalConnectorRequestV1::Webhook {
                header,
                payload: ExternalConnectorWebhookPayloadV1 {
                    stream_id: "default".into(),
                    event_id: "event-1".into(),
                    event_type: "translation.updated".into(),
                    body: json!({"id": "event-1"}),
                    headers: BTreeMap::new(),
                    signature: Some(
                        "sha256=697e575fd989c9f6c2fc161d5914efafed4701b5ce1e72903be07f0f7253452d"
                            .into(),
                    ),
                },
            },
            _ => unreachable!("fixture exchange operations only"),
        }
    }

    fn connector_generate_request(
        request_id: &str,
        model: &str,
    ) -> EngineConnectorGenerateRequestV1 {
        EngineConnectorGenerateRequestV1 {
            contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
            request_id: request_id.to_string(),
            source_locale: "en".to_string(),
            target_locale: "ja".to_string(),
            source_text: "Hello".to_string(),
            messages: Vec::new(),
            model: model.to_string(),
            config: BTreeMap::new(),
            deadline_ms: 2_000,
        }
    }

    fn write_connector_process_fixture(
        dir: &Path,
        handshake_connector: &EngineConnectorContributionDescriptor,
    ) -> PluginManifest {
        write_manifest(
            dir,
            r#"{
              "manifestVersion": 1,
              "id": "example.process-host",
              "displayName": "Process host fixture",
              "version": "1.0.0",
              "apiVersion": 1,
              "apiVersionMin": 1,
              "tier": "process",
              "entry": {"kind": "node", "path": "entry.mjs"},
              "contributions": {"filters": [{
                "id": "example.process.filter",
                "version": "1.0.0",
                "displayName": "Process filter",
                "extensions": ["fixture"],
                "capabilities": {
                  "import": true, "export": false, "validate": false,
                  "inlineTags": false, "notes": false, "degradationReport": false
                }
              }]},
              "permissions": ["file.read:source"]
            }"#,
        );
        let connector_json = serde_json::to_string(&PluginContributionDescriptor::EngineConnector(
            handshake_connector.clone(),
        ))
        .expect("serialize handshake connector");
        let script = r#"import { createInterface } from "node:readline";
const connector = __CONNECTOR__;
const filter = {
  kind: "filter", descriptorVersion: 1, id: "example.process.filter", version: "1.0.0",
  displayName: "Process filter", extensions: ["fixture"],
  capabilities: { import: true, export: false, validate: false, inlineTags: false, notes: false, degradationReport: false }
};
const cancelled = [];
const active = new Map();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const event = (params) => write({ jsonrpc: "2.0", method: "connector.event", params });
const completed = (requestId, sequence, text) => ({
  kind: "completed", contractVersion: 1, requestId, sequence,
  result: { outputText: text, model: "fixture", finishReason: "stop" }
});
const success = (id, requestId, text) => {
  event({ kind: "delta", contractVersion: 1, requestId, sequence: 0, text });
  event({ kind: "usage", contractVersion: 1, requestId, sequence: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  event(completed(requestId, 2, text));
  write({ jsonrpc: "2.0", id, result: { completed: true } });
};
rl.on("line", (line) => {
  const rpc = JSON.parse(line);
  if (rpc.method === "plugin.handshake") {
    write({ jsonrpc: "2.0", id: rpc.id, result: { apiVersion: 1, pluginId: "example.process-host", contributions: [filter, connector] } });
    return;
  }
  if (rpc.method === "plugin.shutdown") {
    if (typeof rpc.id === "number") write({ jsonrpc: "2.0", id: rpc.id, result: {} });
    setTimeout(() => process.exit(0), 0);
    return;
  }
  if (rpc.method === "test.echo") {
    write({ jsonrpc: "2.0", id: rpc.id, result: rpc.params });
    return;
  }
  if (rpc.method === "test.cancelled") {
    write({ jsonrpc: "2.0", id: rpc.id, result: cancelled });
    return;
  }
  if (rpc.method === "connector.cancel") {
    const requestId = rpc.params.requestId;
    cancelled.push(requestId);
    if (requestId === "ignored-cancel") return;
    const activeId = active.get(requestId);
    if (activeId !== undefined) {
      active.delete(requestId);
      write({ jsonrpc: "2.0", id: activeId, error: { code: -32000, message: "cancelled" } });
    }
    if (typeof rpc.id === "number") write({ jsonrpc: "2.0", id: rpc.id, result: {} });
    return;
  }
  if (rpc.method !== "connector.generate") return;
  const request = rpc.params.request;
  const requestId = request.requestId;
  switch (request.model) {
    case "malformed":
      event({ kind: "delta", contractVersion: 1, requestId, sequence: 0, text: 7 });
      setTimeout(() => write({ jsonrpc: "2.0", id: rpc.id, result: { completed: true } }), 10);
      break;
    case "duplicate":
      event(completed(requestId, 0, "done"));
      event(completed(requestId, 1, "again"));
      write({ jsonrpc: "2.0", id: rpc.id, result: { completed: true } });
      break;
    case "bad-response":
      event(completed(requestId, 0, "done"));
      write({ jsonrpc: "2.0", id: rpc.id, result: { completed: true }, extra: true });
      break;
    case "late":
      event(completed(requestId, 0, "done"));
      write({ jsonrpc: "2.0", id: rpc.id, result: { completed: true } });
      setTimeout(() => event({ kind: "delta", contractVersion: 1, requestId, sequence: 1, text: "late" }), 15);
      break;
    case "timeout":
      active.set(requestId, rpc.id);
      break;
    case "oversize":
      event({ kind: "delta", contractVersion: 1, requestId, sequence: 0, text: "x".repeat(8 * 1024 * 1024) });
      break;
    case "interleave": {
      const first = requestId.endsWith("a") ? 8 : 1;
      setTimeout(() => event({ kind: "delta", contractVersion: 1, requestId, sequence: 0, text: requestId }), first);
      setTimeout(() => {
        event(completed(requestId, 1, requestId));
        write({ jsonrpc: "2.0", id: rpc.id, result: { completed: true } });
      }, first + 12);
      break;
    }
    default:
      success(rpc.id, requestId, "translated");
  }
});
"#
        .replace("__CONNECTOR__", &connector_json);
        fs::write(dir.join("entry.mjs"), script).expect("write connector process fixture");
        load_manifest(dir).expect("load connector fixture manifest")
    }

    #[test]
    fn relative_paths_normalize_dot_and_duplicate_components() {
        assert_eq!(
            normalize_relative_path("./bin//./entry.mjs", "entry.path").expect("normalize path"),
            "bin/entry.mjs"
        );
        assert!(normalize_relative_path("../entry.mjs", "entry.path").is_err());
        assert!(normalize_relative_path("/entry.mjs", "entry.path").is_err());
    }

    #[test]
    fn v2_all_tiers_and_contribution_families_normalize_with_camel_case_wire_fields() {
        let all = v2_contributions();
        let sandbox_dir = tempdir().expect("sandbox package");
        fs::write(sandbox_dir.path().join("entry.mjs"), "export default {};")
            .expect("write sandbox entry");
        fs::write(sandbox_dir.path().join("panel.html"), "<!doctype html>")
            .expect("write sandbox panel");
        let sandbox = v2_manifest(
            json!({
                "tier": "sandbox",
                "runtimeVersion": 1,
                "entry": {"kind": "javascript", "path": "entry.mjs", "exportName": "default"}
            }),
            all.clone(),
        );
        let normalized = decode_normalized_manifest(
            &serde_json::to_vec(&sandbox).expect("serialize sandbox manifest"),
            sandbox_dir.path(),
        )
        .expect("normalize sandbox manifest");
        assert_eq!(normalized.source_manifest_version, 2);
        assert_eq!(normalized.contributions.len(), 7);
        assert_eq!(normalized.runtime.tier(), PluginTier::Sandbox);
        assert!(!normalized.compatibility().compatible);
        assert_eq!(
            serde_json::to_value(&normalized.runtime).expect("serialize normalized runtime")["runtimeVersion"],
            1
        );

        let process_dir = tempdir().expect("process package");
        fs::write(process_dir.path().join("entry.mjs"), "export default {};")
            .expect("write process entry");
        let process = v2_manifest(
            json!({
                "tier": "process",
                "runtimeVersion": 1,
                "protocolVersion": 1,
                "entry": {"kind": "node", "path": "entry.mjs"}
            }),
            all.iter()
                .filter(|value| value["kind"] != "uiPanel")
                .cloned()
                .collect(),
        );
        let normalized_process = decode_normalized_manifest(
            &serde_json::to_vec(&process).expect("serialize process manifest"),
            process_dir.path(),
        )
        .expect("normalize process manifest");
        assert_eq!(normalized_process.runtime.tier(), PluginTier::Process);
        assert!(!normalized_process.compatibility().compatible);
        assert!(
            normalized_process
                .contributions
                .iter()
                .all(|value| !matches!(value, PluginContributionDescriptor::UiPanel(_)))
        );

        let declarative_dir = tempdir().expect("declarative package");
        let declarative = v2_manifest(
            json!({
                "tier": "declarative",
                "runtimeVersion": 1,
                "entry": {"kind": "manifest"}
            }),
            all.into_iter()
                .filter(|value| {
                    matches!(
                        value["kind"].as_str(),
                        Some("filter" | "qaRule" | "pipelineStep")
                    )
                })
                .collect(),
        );
        let normalized_declarative = decode_normalized_manifest(
            &serde_json::to_vec(&declarative).expect("serialize declarative manifest"),
            declarative_dir.path(),
        )
        .expect("normalize declarative manifest");
        assert_eq!(
            normalized_declarative.runtime.tier(),
            PluginTier::Declarative
        );
        assert_eq!(normalized_declarative.contributions.len(), 3);
    }

    #[test]
    fn sandbox_filter_and_html_panel_are_compatible_but_other_shapes_fail_closed() {
        let directory = tempdir().expect("sandbox package");
        fs::write(directory.path().join("entry.mjs"), "export default {};").expect("write entry");
        fs::write(directory.path().join("panel.html"), "<!doctype html>").expect("write panel");
        let contributions = v2_contributions()
            .into_iter()
            .filter(|value| matches!(value["kind"].as_str(), Some("filter" | "uiPanel")))
            .collect();
        let manifest = v2_manifest(
            json!({
                "tier": "sandbox",
                "runtimeVersion": 1,
                "entry": {"kind": "javascript", "path": "entry.mjs"}
            }),
            contributions,
        );
        let normalized = decode_normalized_manifest(
            &serde_json::to_vec(&manifest).expect("serialize"),
            directory.path(),
        )
        .expect("normalize executable sandbox");
        assert!(normalized.supports_sandbox_host());
        assert!(normalized.compatibility().compatible);

        let mut invalid_entry = manifest.clone();
        fs::write(directory.path().join("entry.ts"), "export default {};")
            .expect("write TypeScript entry");
        invalid_entry["runtime"]["entry"]["path"] = json!("entry.ts");
        assert!(
            decode_normalized_manifest(
                &serde_json::to_vec(&invalid_entry).expect("serialize invalid entry"),
                directory.path(),
            )
            .is_err()
        );

        let mut invalid_surface = manifest;
        invalid_surface["contributions"][1]["surface"] = json!("panel.js");
        assert!(
            decode_normalized_manifest(
                &serde_json::to_vec(&invalid_surface).expect("serialize invalid surface"),
                directory.path(),
            )
            .is_err()
        );
    }

    #[test]
    fn v2_duplicate_and_unknown_descriptor_versions_fail_closed() {
        let directory = tempdir().expect("v2 package");
        fs::write(directory.path().join("entry.mjs"), "export default {};").expect("write entry");
        let duplicate_filter = v2_contributions().remove(0);
        let mut duplicate = v2_manifest(
            json!({
                "tier": "sandbox",
                "runtimeVersion": 1,
                "entry": {"kind": "javascript", "path": "entry.mjs"}
            }),
            vec![duplicate_filter.clone(), duplicate_filter],
        );
        let duplicate_error = decode_normalized_manifest(
            &serde_json::to_vec(&duplicate).expect("serialize duplicate"),
            directory.path(),
        )
        .expect_err("duplicate contribution must fail");
        assert!(duplicate_error.to_string().contains("duplicate"));

        duplicate["runtime"]["runtimeVersion"] = json!(2);
        let version_error = decode_normalized_manifest(
            &serde_json::to_vec(&duplicate).expect("serialize unknown runtime version"),
            directory.path(),
        )
        .expect_err("unknown runtime version must fail");
        assert!(matches!(
            version_error,
            PluginRuntimeError::UnsupportedVersion { component, version }
                if component == "runtime" && version == 2
        ));
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
    fn capability_vocabulary_normalizes_every_family() {
        let permissions = [
            "file.read:source",
            "file.write:output",
            "network:https://api.example.test",
            "asset.read:tm-main",
            "asset.write:tb-main",
            "project.read:project-a",
            "project.write:project-a",
            "engine.connector:segment.read",
            "qa.register:qa.example",
            "pipeline.register:pipeline.example",
            "ai.action:ai.example",
            "ui.panel:panel.example",
            "external.connector:sync.push",
            "diagnostics.read:runtime",
        ]
        .map(str::to_string);
        let normalized = normalize_capability_requests(&permissions, &[])
            .expect("normalize complete legacy vocabulary");
        let ids = normalized
            .iter()
            .map(|request| request.capability_id.clone())
            .collect::<BTreeSet<_>>();
        assert_eq!(ids.len(), 14);
        assert!(ids.contains(&PluginCapabilityId::FileRead));
        assert!(ids.contains(&PluginCapabilityId::FileWrite));
        assert!(ids.contains(&PluginCapabilityId::NetworkConnect));
        assert!(ids.contains(&PluginCapabilityId::AssetRead));
        assert!(ids.contains(&PluginCapabilityId::AssetWrite));
        assert!(ids.contains(&PluginCapabilityId::ProjectRead));
        assert!(ids.contains(&PluginCapabilityId::ProjectWrite));
        assert!(ids.contains(&PluginCapabilityId::EngineConnector));
        assert!(ids.contains(&PluginCapabilityId::QaRegister));
        assert!(ids.contains(&PluginCapabilityId::PipelineRegister));
        assert!(ids.contains(&PluginCapabilityId::AiAction));
        assert!(ids.contains(&PluginCapabilityId::UiPanel));
        assert!(ids.contains(&PluginCapabilityId::ExternalConnector));
        assert!(ids.contains(&PluginCapabilityId::DiagnosticsRead));
    }

    #[test]
    fn capability_scopes_are_camel_case_narrowable_and_fail_closed() {
        let requested = PluginCapabilityScope::Assets {
            project_ids: vec!["project-b".to_string(), "project-a".to_string()],
            asset_ids: vec!["*".to_string()],
        }
        .normalized()
        .expect("normalize asset scope");
        assert!(requested.allows(&PluginCapabilityScope::Assets {
            project_ids: vec!["project-a".to_string()],
            asset_ids: vec!["tm-main".to_string()],
        }));
        assert!(!requested.allows(&PluginCapabilityScope::Assets {
            project_ids: vec!["project-c".to_string()],
            asset_ids: vec!["tm-main".to_string()],
        }));
        assert_eq!(
            serde_json::to_value(&requested).expect("serialize scope"),
            json!({
                "kind": "assets",
                "projectIds": ["project-a", "project-b"],
                "assetIds": ["*"]
            })
        );
        assert!(
            PluginCapabilityScope::Assets {
                project_ids: Vec::new(),
                asset_ids: Vec::new(),
            }
            .normalized()
            .is_err()
        );
        assert!(
            PluginCapabilityRequest {
                capability_id: PluginCapabilityId::FileRead,
                required: true,
                scope: PluginCapabilityScope::Network {
                    origins: vec!["https://api.example.test".to_string()],
                },
                contribution_id: None,
            }
            .normalized()
            .is_err()
        );
    }

    #[test]
    fn unsupported_optional_capabilities_are_preserved_without_authority() {
        let optional: PluginCapabilityRequest = serde_json::from_value(json!({
            "capabilityId": "future.translation.inspect",
            "required": false,
            "scope": {"kind": "unscoped"}
        }))
        .expect("deserialize optional future capability");
        let normalized = optional.normalized().expect("retain optional capability");
        assert_eq!(
            normalized.capability_id,
            PluginCapabilityId::Unsupported("future.translation.inspect".to_string())
        );
        assert!(!normalized.capability_id.is_supported());
        assert_eq!(
            serde_json::to_value(&normalized).expect("serialize optional future capability"),
            json!({
                "capabilityId": "future.translation.inspect",
                "required": false,
                "scope": {"kind": "unscoped"}
            })
        );

        let required: PluginCapabilityRequest = serde_json::from_value(json!({
            "capabilityId": "future.translation.inspect",
            "required": true,
            "scope": {"kind": "unscoped"}
        }))
        .expect("deserialize required future capability");
        assert!(matches!(
            required.normalized(),
            Err(PluginRuntimeError::CapabilityUnsupported(capability_id))
                if capability_id == "future.translation.inspect"
        ));
        assert!(
            serde_json::from_value::<PluginCapabilityRequest>(json!({
                "capabilityId": "future capability",
                "required": false,
                "scope": {"kind": "unscoped"}
            }))
            .is_err()
        );
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
                pipeline_invocation_id: None,
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
    ? { apiVersion: 1, pluginId: "example.timeout", contributions: { filters: [{ id: "example.timeout", version: "0.1.0", displayName: "Timeout fixture", extensions: ["timeout"], capabilities: { import: true, export: false, validate: false, inlineTags: false, notes: false, degradationReport: false } }] } }
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
    ? { apiVersion: 1, pluginId: "example.backpressure", contributions: { filters: [{ id: "example.backpressure", version: "0.1.0", displayName: "Backpressure fixture", extensions: ["blocked"], capabilities: { import: true, export: false, validate: false, inlineTags: false, notes: false, degradationReport: false } }] } }
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

    #[test]
    fn sandbox_host_accepts_only_executable_v1_connectors() {
        let directory = tempdir().expect("sandbox package");
        fs::write(directory.path().join("entry.mjs"), "export default {};")
            .expect("write sandbox entry");
        let strict = serde_json::to_value(PluginContributionDescriptor::EngineConnector(
            process_connector_descriptor(),
        ))
        .expect("serialize strict connector");
        let strict_manifest = v2_manifest(
            json!({
                "tier": "sandbox",
                "runtimeVersion": 1,
                "entry": {"kind": "javascript", "path": "entry.mjs"}
            }),
            vec![strict],
        );
        let normalized = decode_normalized_manifest(
            &serde_json::to_vec(&strict_manifest).expect("serialize strict manifest"),
            directory.path(),
        )
        .expect("decode strict connector manifest");
        assert!(normalized.supports_sandbox_host());

        let legacy_connector = v2_contributions().remove(1);
        let legacy_manifest = v2_manifest(
            json!({
                "tier": "sandbox",
                "runtimeVersion": 1,
                "entry": {"kind": "javascript", "path": "entry.mjs"}
            }),
            vec![legacy_connector],
        );
        let legacy = decode_normalized_manifest(
            &serde_json::to_vec(&legacy_manifest).expect("serialize legacy manifest"),
            directory.path(),
        )
        .expect("legacy connector remains inventory-readable");
        assert!(!legacy.supports_sandbox_host());
    }

    #[test]
    fn connector_handshake_rejects_descriptor_mismatch() {
        let directory = tempdir().expect("plugin directory");
        let expected = process_connector_descriptor();
        let mut actual = expected.clone();
        actual.display_name = "Unexpected connector".to_string();
        let manifest = write_connector_process_fixture(directory.path(), &actual);
        let process = PluginProcess::new_with_connector_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![expected],
        );

        let error = process
            .ensure_started()
            .expect_err("mismatched connector inventory must fail");
        assert!(matches!(error, PluginRuntimeError::Protocol(_)));
        assert!(process.state.lock().expect("process state").is_none());
    }

    #[test]
    fn connector_stream_preserves_order_and_ordinary_calls() {
        let directory = tempdir().expect("plugin directory");
        let descriptor = process_connector_descriptor();
        let limits = descriptor.limits.clone().expect("connector limits");
        let manifest = write_connector_process_fixture(directory.path(), &descriptor);
        let process = PluginProcess::new_with_connector_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![descriptor],
        );
        let request = connector_generate_request("success-1", "success");
        let invalid_credential = "must-not-leak\0credential";
        let credential_error = process
            .call_connector_stream(
                &request,
                Some(invalid_credential),
                &limits,
                Duration::from_secs(2),
                |_| Ok(()),
            )
            .expect_err("malformed credential must fail before process dispatch");
        assert!(!credential_error.to_string().contains("must-not-leak"));
        let mut events = Vec::new();
        let result = process
            .call_connector_stream(
                &request,
                Some("fixture-secret"),
                &limits,
                Duration::from_secs(2),
                |event| {
                    events.push((event.request_id().to_string(), event.sequence()));
                    Ok(())
                },
            )
            .expect("connector stream succeeds");
        assert!(!format!("{process:?}").contains("fixture-secret"));
        assert_eq!(result.output_text, "translated");
        assert_eq!(
            events,
            vec![
                ("success-1".to_string(), 0),
                ("success-1".to_string(), 1),
                ("success-1".to_string(), 2),
            ]
        );

        let echoed: Value = process
            .call(
                "test.echo",
                json!({"ordinary": true}),
                Duration::from_secs(2),
            )
            .expect("ordinary RPC remains usable");
        assert_eq!(echoed, json!({"ordinary": true}));
    }

    #[test]
    fn concurrent_connector_streams_are_isolated_by_request_id() {
        let directory = tempdir().expect("plugin directory");
        let descriptor = process_connector_descriptor();
        let limits = descriptor.limits.clone().expect("connector limits");
        let manifest = write_connector_process_fixture(directory.path(), &descriptor);
        let process = Arc::new(PluginProcess::new_with_connector_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![descriptor],
        ));
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut workers = Vec::new();
        for request_id in ["request-a", "request-b"] {
            let process = Arc::clone(&process);
            let barrier = Arc::clone(&barrier);
            let limits = limits.clone();
            let request_id = request_id.to_string();
            workers.push(thread::spawn(move || {
                let request = connector_generate_request(&request_id, "interleave");
                let mut seen = Vec::new();
                barrier.wait();
                let result = process
                    .call_connector_stream(
                        &request,
                        None,
                        &limits,
                        Duration::from_secs(2),
                        |event| {
                            seen.push(event.request_id().to_string());
                            Ok(())
                        },
                    )
                    .expect("interleaved connector call succeeds");
                (request_id, seen, result.output_text)
            }));
        }
        barrier.wait();
        for worker in workers {
            let (request_id, seen, output) = worker.join().expect("connector worker");
            assert_eq!(seen, vec![request_id.clone(), request_id.clone()]);
            assert_eq!(output, request_id);
        }
    }

    #[test]
    fn malformed_duplicate_and_late_connector_events_are_isolated() {
        let directory = tempdir().expect("plugin directory");
        let descriptor = process_connector_descriptor();
        let limits = descriptor.limits.clone().expect("connector limits");
        let manifest = write_connector_process_fixture(directory.path(), &descriptor);
        let process = PluginProcess::new_with_connector_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![descriptor],
        );
        for (request_id, model) in [
            ("bad-params", "malformed"),
            ("duplicate", "duplicate"),
            ("bad-response", "bad-response"),
        ] {
            let error = process
                .call_connector_stream(
                    &connector_generate_request(request_id, model),
                    None,
                    &limits,
                    Duration::from_secs(2),
                    |_| Ok(()),
                )
                .expect_err("invalid connector stream must fail");
            assert!(
                matches!(error, PluginRuntimeError::Protocol(_)),
                "unexpected connector error for {request_id}: {error:?}"
            );
            let echoed: String = process
                .call("test.echo", json!(request_id), Duration::from_secs(2))
                .expect("targeted stream failure does not stop ordinary RPC");
            assert_eq!(echoed, request_id);
        }

        let late = process
            .call_connector_stream(
                &connector_generate_request("late-event", "late"),
                None,
                &limits,
                Duration::from_secs(2),
                |_| Ok(()),
            )
            .expect("terminal response succeeds before late event");
        assert_eq!(late.output_text, "done");
        thread::sleep(Duration::from_millis(40));
        let echoed: bool = process
            .call("test.echo", json!(true), Duration::from_secs(2))
            .expect("late event is discarded");
        assert!(echoed);
    }

    #[test]
    fn official_external_connector_fixture_runs_all_exchange_operations_through_process_host() {
        if Command::new(node_executable())
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let package_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/plugins/external-connector-fixture");
        let manifest = load_normalized_manifest(&package_dir).expect("official fixture manifest");
        let descriptor = manifest
            .contributions
            .iter()
            .find_map(|contribution| match contribution {
                PluginContributionDescriptor::ExternalConnector(descriptor) => {
                    Some(descriptor.clone())
                }
                _ => None,
            })
            .expect("official fixture connector");
        let process = PluginProcess::from_normalized_manifest(package_dir, &manifest)
            .expect("official process host");
        let fixture_credential = ["fixture", "token", "not", "for", "production"].join("-");
        let context = ExternalConnectorInvocationContextV1 {
            credentials: BTreeMap::from([("apiToken".into(), fixture_credential)]),
        };
        for operation in [
            ExternalConnectorOperationV1::Pull,
            ExternalConnectorOperationV1::Push,
            ExternalConnectorOperationV1::Poll,
            ExternalConnectorOperationV1::Webhook,
        ] {
            let request = external_connector_request(operation);
            let result = process
                .call_external_connector(&descriptor.id, &request, &context, Duration::from_secs(2))
                .unwrap_or_else(|error| panic!("{} failed: {error:?}", operation.as_str()));
            assert_eq!(result.operation(), operation);
        }
        let mut bad_webhook = external_connector_request(ExternalConnectorOperationV1::Webhook);
        if let ExternalConnectorRequestV1::Webhook { payload, .. } = &mut bad_webhook {
            payload.signature = Some("sha256=invalid".into());
        }
        assert!(matches!(
            process.call_external_connector(
                &descriptor.id,
                &bad_webhook,
                &context,
                Duration::from_secs(2),
            ),
            Err(PluginRuntimeError::ExternalConnectorFailure(
                ExternalConnectorFailureV1 {
                    code: ExternalConnectorFailureCodeV1::Authentication,
                    ..
                }
            ))
        ));
        process.stop();
    }

    #[test]
    fn connector_timeout_cancel_and_oversize_frame_remain_bounded() {
        let directory = tempdir().expect("plugin directory");
        let descriptor = process_connector_descriptor();
        let limits = descriptor.limits.clone().expect("connector limits");
        let manifest = write_connector_process_fixture(directory.path(), &descriptor);
        let process = PluginProcess::new_with_connector_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![descriptor],
        );
        let timeout = process
            .call_connector_stream(
                &connector_generate_request("timed-out", "timeout"),
                None,
                &limits,
                Duration::from_millis(40),
                |_| Ok(()),
            )
            .expect_err("connector deadline must be enforced");
        assert!(matches!(timeout, PluginRuntimeError::Timeout(_)));
        thread::sleep(Duration::from_millis(30));
        let cancelled: Vec<String> = process
            .call("test.cancelled", json!({}), Duration::from_secs(2))
            .expect("inspect cancellation notification");
        assert!(cancelled.contains(&"timed-out".to_string()));

        process
            .cancel_connector_request(
                &EngineConnectorCancelRequestV1 {
                    contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
                    request_id: "explicit-cancel".to_string(),
                },
                Duration::from_secs(2),
            )
            .expect("explicit cancellation call is acknowledged");
        let cancelled: Vec<String> = process
            .call("test.cancelled", json!({}), Duration::from_secs(2))
            .expect("inspect explicit cancellation");
        assert!(cancelled.contains(&"explicit-cancel".to_string()));

        let ignored = process
            .cancel_connector_request(
                &EngineConnectorCancelRequestV1 {
                    contract_version: ENGINE_CONNECTOR_CONTRACT_VERSION,
                    request_id: "ignored-cancel".to_string(),
                },
                Duration::from_millis(30),
            )
            .expect_err("missing cancellation ack respects its deadline");
        assert!(matches!(ignored, PluginRuntimeError::Timeout(_)));
        let still_running: bool = process
            .call("test.echo", json!(true), Duration::from_secs(2))
            .expect("cancellation timeout does not kill unrelated calls");
        assert!(still_running);

        let oversized = process
            .call_connector_stream(
                &connector_generate_request("oversized", "oversize"),
                None,
                &limits,
                Duration::from_secs(2),
                |_| Ok(()),
            )
            .expect_err("oversized process frame must fail");
        assert!(matches!(oversized, PluginRuntimeError::Protocol(_)));
        let echoed: String = process
            .call("test.echo", json!("restarted"), Duration::from_secs(2))
            .expect("fatal frame restarts only this plugin process");
        assert_eq!(echoed, "restarted");

        process
            .shutdown_connector(Duration::from_secs(2))
            .expect("connector shutdown is acknowledged");
        assert!(process.state.lock().expect("process state").is_none());
        let restarted: bool = process
            .call("test.echo", json!(true), Duration::from_secs(2))
            .expect("connector process can restart after graceful shutdown");
        assert!(restarted);
    }
}
