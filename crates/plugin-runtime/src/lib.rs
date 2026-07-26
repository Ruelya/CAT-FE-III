//! Local plugin manifest validation, process host, and filter adapters.

mod declarative;

pub use declarative::{
    DECLARATIVE_DEFINITION_VERSION, DeclarativeDocumentFilter, DeclarativeFilterDefinitionV1,
    DeclarativeFilterLimits, DeclarativePipelineDefinitionV1, DeclarativePipelineOperation,
    DeclarativeQaPackDefinitionV1,
};

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
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
use uuid::Uuid;

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
const MAX_PACKAGE_FILES: usize = 4096;
const MAX_PACKAGE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PACKAGE_PATH_BYTES: usize = 512;
const MAX_PACKAGE_DEPTH: usize = 32;

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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub rule_type: String,
    pub severity: String,
    pub definition: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<DeclarativeQaPackDefinitionV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub input: Value,
    pub output: Value,
    pub config_schema_version: u32,
    pub resumable: bool,
    pub cancellable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<DeclarativePipelineDefinitionV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub label: String,
    pub placement: String,
    pub input: Value,
    pub prompt_template: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPanelContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub label: String,
    pub placement: String,
    pub surface: String,
    pub bridge_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub transports: Vec<String>,
    pub checkpoint_version: u32,
    pub capabilities: BTreeMap<String, bool>,
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
        if filters.is_empty() {
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
                .all(|contribution| matches!(contribution, PluginContributionDescriptor::Filter(_)))
    }

    pub fn compatibility(&self) -> PluginCompatibility {
        let host_api_supported =
            self.host_api.min <= HOST_API_VERSION && HOST_API_VERSION <= self.host_api.max;
        let runtime_supported = matches!(
            self.runtime,
            PluginRuntimeDescriptor::Process { .. } | PluginRuntimeDescriptor::Declarative { .. }
        );
        let contribution_supported =
            |contribution: &PluginContributionDescriptor| match &self.runtime {
                PluginRuntimeDescriptor::Process { .. } => {
                    matches!(contribution, PluginContributionDescriptor::Filter(_))
                }
                PluginRuntimeDescriptor::Declarative { .. } => {
                    validate_tier_contribution(PluginTier::Declarative, contribution, true).is_ok()
                }
                PluginRuntimeDescriptor::Sandbox { .. } => false,
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
            let manifest: RawPluginManifestV1 =
                serde_json::from_value(value.clone()).map_err(|error| {
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
                | PluginContributionKind::QaRule
                | PluginContributionKind::PipelineStep
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
            validate_json_shape(&value.definition, "QA definition", 0)?;
            if let Some(config) = &value.config {
                validate_json_shape(config, "QA config", 0)?;
            }
            Ok(())
        }
        PluginContributionDescriptor::PipelineStep(value) => {
            if value.config_schema_version == 0 {
                return Err(PluginRuntimeError::InvalidManifest(
                    "pipeline configSchemaVersion must be positive".to_string(),
                ));
            }
            validate_json_shape(&value.input, "pipeline input", 0)?;
            validate_json_shape(&value.output, "pipeline output", 0)?;
            Ok(())
        }
        PluginContributionDescriptor::AiAction(value) => {
            require_text(&value.label, "AI action label", MAX_DISPLAY_NAME_BYTES)?;
            require_text(
                &value.placement,
                "AI action placement",
                MAX_SHORT_STRING_BYTES,
            )?;
            require_text(
                &value.prompt_template,
                "AI action promptTemplate",
                MAX_LONG_STRING_BYTES,
            )?;
            validate_json_shape(&value.input, "AI action input", 0)
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
            Ok(())
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

fn normalize_relative_path(value: &str, label: &str) -> Result<String> {
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

fn reject_reparse(path: &Path, label: &str) -> Result<()> {
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
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
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
        let expected_contributions = self.manifest.filter_descriptors();
        let actual_contributions = handshake.contributions.filter_descriptors();
        if actual_contributions != expected_contributions {
            self.stop();
            return Err(PluginRuntimeError::Protocol(
                "plugin handshake contribution inventory does not match the manifest".to_string(),
            ));
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

/// Copy a source package into a unique staging directory and hash the staged
/// bytes.  The destination is created with `create_dir`, so an existing path
/// can never be clobbered.
pub fn stage_plugin_package(source: &Path, staging_root: &Path) -> Result<StagedPluginPackage> {
    reject_reparse(source, "plugin source")?;
    if !source.is_dir() {
        return Err(PluginRuntimeError::PackageInvalid(
            "plugin source must be a directory".to_string(),
        ));
    }
    std::fs::create_dir_all(staging_root)?;
    let staging = staging_root.join(format!("stage-{}", Uuid::now_v7()));
    std::fs::create_dir(&staging).map_err(|error| {
        PluginRuntimeError::PackageInvalid(format!("cannot reserve staging directory: {error}"))
    })?;
    if let Err(error) = copy_dir_secure(source, &staging, 0) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let result = inspect_plugin_package(&staging);
    match result {
        Ok((normalized_manifest, package_hash)) => Ok(StagedPluginPackage {
            path: staging,
            normalized_manifest,
            package_hash,
        }),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            Err(error)
        }
    }
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

fn copy_dir_secure(source: &Path, destination: &Path, depth: usize) -> Result<()> {
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
                "definition": {"pattern": "v2"}
            }),
            json!({
                "kind": "pipelineStep",
                "descriptorVersion": 1,
                "id": "example.v2.step",
                "version": "1.0.0",
                "displayName": "V2 step",
                "input": {"type": "text"},
                "output": {"type": "text"},
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
                "surface": "workbench",
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
}
