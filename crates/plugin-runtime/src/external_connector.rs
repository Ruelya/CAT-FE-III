//! Public, tier-neutral external-system connector contract version 1.
//!
//! The Engine owns credentials, authorization, exact-generation lifecycle,
//! durable checkpoints, and safe failure behavior. Connector handlers exchange
//! bounded translation objects only; they never import CAT application state
//! or schedule automation jobs.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    EngineConnectorConfigSchemaV1, EngineConnectorConfigV1, EngineConnectorConfigValueV1,
    PluginRuntimeError, PluginTier, Result,
};

pub const EXTERNAL_CONNECTOR_CONTRACT_VERSION: u32 = 1;
pub const EXTERNAL_CONNECTOR_PROTOCOL_V1: &str = "translunar.externalConnector.v1";
pub const EXTERNAL_CONNECTOR_CONFIG_SCHEMA_VERSION: u32 = 1;
pub const EXTERNAL_CONNECTOR_CHECKPOINT_SCHEMA_VERSION: u32 = 1;
pub const EXTERNAL_CONNECTOR_CREDENTIAL_NAMESPACE: &str = "translunar-cat.external-connector";

pub const MAX_EXTERNAL_CONNECTOR_CONFIG_BYTES: usize = 64 * 1024;
pub const MAX_EXTERNAL_CONNECTOR_CONFIG_FIELDS: usize = 64;
pub const MAX_EXTERNAL_CONNECTOR_CONFIG_KEY_BYTES: usize = 64;
pub const MAX_EXTERNAL_CONNECTOR_CONFIG_VALUE_BYTES: usize = 4 * 1024;
pub const MAX_EXTERNAL_CONNECTOR_ITEMS: usize = 256;
pub const MAX_EXTERNAL_CONNECTOR_ITEM_TEXT_BYTES: usize = 256 * 1024;
pub const MAX_EXTERNAL_CONNECTOR_METADATA_ENTRIES: usize = 32;
pub const MAX_EXTERNAL_CONNECTOR_METADATA_VALUE_BYTES: usize = 1024;
pub const MAX_EXTERNAL_CONNECTOR_CHECKPOINT_BYTES: usize = 64 * 1024;
pub const MAX_EXTERNAL_CONNECTOR_DEADLINE_MS: u64 = 120_000;
pub const MAX_EXTERNAL_CONNECTOR_REQUEST_ID_BYTES: usize = 128;
pub const MAX_EXTERNAL_CONNECTOR_IDEMPOTENCY_KEY_BYTES: usize = 128;
pub const MAX_EXTERNAL_CONNECTOR_STREAM_ID_BYTES: usize = 128;
pub const MAX_EXTERNAL_CONNECTOR_LOCALE_BYTES: usize = 64;
pub const MAX_EXTERNAL_CONNECTOR_ERROR_MESSAGE_BYTES: usize = 1024;
pub const MAX_EXTERNAL_CONNECTOR_CREDENTIAL_BYTES: usize = 16 * 1024;
pub const MAX_EXTERNAL_CONNECTOR_CREDENTIAL_SLOTS: usize = 16;
pub const MAX_EXTERNAL_CONNECTOR_ORIGINS: usize = 16;
pub const MAX_EXTERNAL_CONNECTOR_ENDPOINT_BYTES: usize = 2_048;
pub const MAX_EXTERNAL_CONNECTOR_HEADERS: usize = 32;
pub const MAX_EXTERNAL_CONNECTOR_HEADER_NAME_BYTES: usize = 128;
pub const MAX_EXTERNAL_CONNECTOR_HEADER_VALUE_BYTES: usize = 1024;
pub const MAX_EXTERNAL_CONNECTOR_JSON_PATH_DEPTH: usize = 16;
pub const MAX_EXTERNAL_CONNECTOR_JSON_PATH_SEGMENT_BYTES: usize = 128;
pub const MAX_EXTERNAL_CONNECTOR_RETRY_AFTER_MS: u64 = 120_000;
pub const MAX_EXTERNAL_CONNECTOR_ATTEMPT: u32 = 32;

fn invalid(message: impl Into<String>) -> PluginRuntimeError {
    PluginRuntimeError::InvalidManifest(message.into())
}

fn require_version(actual: u32, expected: u32, label: &str) -> Result<()> {
    if actual != expected {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: label.to_string(),
            version: actual,
        });
    }
    Ok(())
}

fn require_bounded_text(
    value: &str,
    label: &str,
    min_bytes: usize,
    max_bytes: usize,
) -> Result<()> {
    let bytes = value.len();
    if bytes < min_bytes || bytes > max_bytes || value.contains('\0') {
        return Err(invalid(format!(
            "{label} must contain between {min_bytes} and {max_bytes} UTF-8 bytes"
        )));
    }
    Ok(())
}

fn require_identifier(value: &str, label: &str, max_bytes: usize) -> Result<()> {
    require_bounded_text(value, label, 1, max_bytes)?;
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(invalid(format!("{label} contains unsupported characters")));
    }
    Ok(())
}

fn require_limit(value: u32, maximum: usize, label: &str) -> Result<()> {
    if value == 0 || value as usize > maximum {
        return Err(invalid(format!(
            "external connector {label} must be between 1 and {maximum}"
        )));
    }
    Ok(())
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum ExternalConnectorOperationV1 {
    #[serde(rename = "validateConfig")]
    ValidateConfig,
    #[serde(rename = "test")]
    Test,
    #[serde(rename = "pull")]
    Pull,
    #[serde(rename = "push")]
    Push,
    #[serde(rename = "poll")]
    Poll,
    #[serde(rename = "webhook")]
    Webhook,
}

impl ExternalConnectorOperationV1 {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ValidateConfig => "validateConfig",
            Self::Test => "test",
            Self::Pull => "pull",
            Self::Push => "push",
            Self::Poll => "poll",
            Self::Webhook => "webhook",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "validateConfig" => Some(Self::ValidateConfig),
            "test" => Some(Self::Test),
            "pull" => Some(Self::Pull),
            "push" => Some(Self::Push),
            "poll" => Some(Self::Poll),
            "webhook" => Some(Self::Webhook),
            _ => None,
        }
    }

    pub const fn is_exchange(self) -> bool {
        matches!(self, Self::Pull | Self::Push | Self::Poll | Self::Webhook)
    }
}

pub const REQUIRED_EXTERNAL_CONNECTOR_OPERATIONS_V1: [ExternalConnectorOperationV1; 2] = [
    ExternalConnectorOperationV1::ValidateConfig,
    ExternalConnectorOperationV1::Test,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorCredentialSlotV1 {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub required: bool,
    pub operations: Vec<ExternalConnectorOperationV1>,
}

impl ExternalConnectorCredentialSlotV1 {
    pub fn validate(&self) -> Result<()> {
        require_identifier(&self.id, "credential slot id", 64)?;
        require_bounded_text(&self.label, "credential slot label", 1, 128)?;
        if let Some(description) = &self.description {
            require_bounded_text(description, "credential slot description", 1, 512)?;
        }
        if self.operations.is_empty() || self.operations.len() > 8 {
            return Err(invalid(
                "credential slot operations must contain between 1 and 8 entries",
            ));
        }
        let mut seen = BTreeSet::new();
        for operation in &self.operations {
            if !seen.insert(*operation) {
                return Err(invalid("credential slot operations must be unique"));
            }
            if matches!(operation, ExternalConnectorOperationV1::ValidateConfig) {
                return Err(invalid(
                    "credential slots cannot be declared for validateConfig",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorLimitsV1 {
    pub max_config_bytes: u32,
    pub max_items: u32,
    pub max_item_text_bytes: u32,
    pub max_metadata_entries: u32,
    pub max_checkpoint_bytes: u32,
    pub max_deadline_ms: u64,
    pub max_request_bytes: u32,
    pub max_response_bytes: u32,
}

impl Default for ExternalConnectorLimitsV1 {
    fn default() -> Self {
        Self {
            max_config_bytes: MAX_EXTERNAL_CONNECTOR_CONFIG_BYTES as u32,
            max_items: MAX_EXTERNAL_CONNECTOR_ITEMS as u32,
            max_item_text_bytes: MAX_EXTERNAL_CONNECTOR_ITEM_TEXT_BYTES as u32,
            max_metadata_entries: MAX_EXTERNAL_CONNECTOR_METADATA_ENTRIES as u32,
            max_checkpoint_bytes: MAX_EXTERNAL_CONNECTOR_CHECKPOINT_BYTES as u32,
            max_deadline_ms: MAX_EXTERNAL_CONNECTOR_DEADLINE_MS,
            max_request_bytes: 256 * 1024,
            max_response_bytes: 1024 * 1024,
        }
    }
}

impl ExternalConnectorLimitsV1 {
    pub fn validate(&self) -> Result<()> {
        require_limit(
            self.max_config_bytes,
            MAX_EXTERNAL_CONNECTOR_CONFIG_BYTES,
            "maxConfigBytes",
        )?;
        require_limit(self.max_items, MAX_EXTERNAL_CONNECTOR_ITEMS, "maxItems")?;
        require_limit(
            self.max_item_text_bytes,
            MAX_EXTERNAL_CONNECTOR_ITEM_TEXT_BYTES,
            "maxItemTextBytes",
        )?;
        require_limit(
            self.max_metadata_entries,
            MAX_EXTERNAL_CONNECTOR_METADATA_ENTRIES,
            "maxMetadataEntries",
        )?;
        require_limit(
            self.max_checkpoint_bytes,
            MAX_EXTERNAL_CONNECTOR_CHECKPOINT_BYTES,
            "maxCheckpointBytes",
        )?;
        require_limit(self.max_request_bytes, 4 * 1024 * 1024, "maxRequestBytes")?;
        require_limit(self.max_response_bytes, 8 * 1024 * 1024, "maxResponseBytes")?;
        if self.max_deadline_ms == 0 || self.max_deadline_ms > MAX_EXTERNAL_CONNECTOR_DEADLINE_MS {
            return Err(invalid(format!(
                "external connector maxDeadlineMs must be between 1 and {MAX_EXTERNAL_CONNECTOR_DEADLINE_MS}"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum ExternalConnectorHttpMethodV1 {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorHeaderV1 {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ExternalConnectorAuthenticationV1 {
    None,
    Bearer { slot: String },
    Header { name: String, slot: String },
    Query { name: String, slot: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ExternalConnectorWebhookSignatureV1 {
    None,
    HmacSha256 {
        header: String,
        slot: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,
    },
}

impl ExternalConnectorWebhookSignatureV1 {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::None => Ok(()),
            Self::HmacSha256 {
                header,
                slot,
                prefix,
            } => {
                validate_header_name(header, true)?;
                require_identifier(slot, "webhook signature slot", 64)?;
                if let Some(prefix) = prefix {
                    require_bounded_text(prefix, "webhook signature prefix", 0, 32)?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorEndpointMappingV1 {
    pub destination_origin: String,
    pub url_template: String,
    pub method: ExternalConnectorHttpMethodV1,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fixed_headers: Vec<ExternalConnectorHeaderV1>,
    pub authentication: ExternalConnectorAuthenticationV1,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fixed_query: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fixed_body: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_more_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipts_path: Option<Vec<String>>,
}

impl ExternalConnectorEndpointMappingV1 {
    pub fn validate(&self) -> Result<()> {
        validate_origin_and_endpoint(&self.destination_origin, &self.url_template)?;
        if self.fixed_headers.len() > MAX_EXTERNAL_CONNECTOR_HEADERS {
            return Err(invalid(format!(
                "endpoint exceeds {MAX_EXTERNAL_CONNECTOR_HEADERS} fixed headers"
            )));
        }
        let mut header_names = BTreeSet::new();
        for header in &self.fixed_headers {
            validate_header_name(&header.name, false)?;
            if !header_names.insert(header.name.to_ascii_lowercase()) {
                return Err(invalid("endpoint header names must be unique"));
            }
            require_bounded_text(
                &header.value,
                "endpoint header value",
                0,
                MAX_EXTERNAL_CONNECTOR_HEADER_VALUE_BYTES,
            )?;
            if header.value.contains(['\r', '\n']) {
                return Err(invalid("endpoint header values cannot contain newlines"));
            }
        }
        match &self.authentication {
            ExternalConnectorAuthenticationV1::None => {}
            ExternalConnectorAuthenticationV1::Bearer { slot } => {
                require_identifier(slot, "authentication slot", 64)?;
            }
            ExternalConnectorAuthenticationV1::Header { name, slot }
            | ExternalConnectorAuthenticationV1::Query { name, slot } => {
                validate_header_name(name, true)?;
                require_identifier(slot, "authentication slot", 64)?;
            }
        }
        if self.fixed_query.len() > 32 {
            return Err(invalid("endpoint fixed query has too many entries"));
        }
        for (key, value) in &self.fixed_query {
            require_identifier(key, "fixed query key", 64)?;
            require_bounded_text(value, "fixed query value", 0, 1024)?;
        }
        if serde_json::to_vec(&self.fixed_body)?.len() > MAX_EXTERNAL_CONNECTOR_CONFIG_BYTES {
            return Err(invalid("endpoint fixed body is oversized"));
        }
        validate_json_value(
            &Value::Object(
                self.fixed_body
                    .clone()
                    .into_iter()
                    .collect::<serde_json::Map<_, _>>(),
            ),
            0,
        )?;
        validate_optional_json_path(&self.items_path, "itemsPath")?;
        validate_optional_json_path(&self.has_more_path, "hasMorePath")?;
        validate_optional_json_path(&self.checkpoint_path, "checkpointPath")?;
        validate_optional_json_path(&self.receipts_path, "receiptsPath")?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorFailureMappingV1 {
    pub status: u16,
    pub code: ExternalConnectorFailureCodeV1,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeExternalConnectorDefinitionV1 {
    pub definition_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validate_config: Option<ExternalConnectorEndpointMappingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test: Option<ExternalConnectorEndpointMappingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull: Option<ExternalConnectorEndpointMappingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push: Option<ExternalConnectorEndpointMappingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<ExternalConnectorEndpointMappingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook: Option<ExternalConnectorEndpointMappingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook_signature: Option<ExternalConnectorWebhookSignatureV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<ExternalConnectorFailureMappingV1>,
}

impl DeclarativeExternalConnectorDefinitionV1 {
    pub fn validate(&self, declared_operations: &[ExternalConnectorOperationV1]) -> Result<()> {
        require_version(
            self.definition_version,
            EXTERNAL_CONNECTOR_CONTRACT_VERSION,
            "declarative external connector definition",
        )?;
        let ops: BTreeSet<_> = declared_operations.iter().copied().collect();
        for (operation, mapping) in [
            (
                ExternalConnectorOperationV1::ValidateConfig,
                &self.validate_config,
            ),
            (ExternalConnectorOperationV1::Test, &self.test),
            (ExternalConnectorOperationV1::Pull, &self.pull),
            (ExternalConnectorOperationV1::Push, &self.push),
            (ExternalConnectorOperationV1::Poll, &self.poll),
            (ExternalConnectorOperationV1::Webhook, &self.webhook),
        ] {
            match mapping {
                Some(mapping) if ops.contains(&operation) => mapping.validate()?,
                Some(_) => {
                    return Err(invalid(format!(
                        "declarative mapping for {} is not declared in operations",
                        operation.as_str()
                    )));
                }
                None if ops.contains(&operation)
                    && (operation.is_exchange()
                        || operation == ExternalConnectorOperationV1::Test) =>
                {
                    return Err(invalid(format!(
                        "declarative external connector requires a {} mapping",
                        operation.as_str()
                    )));
                }
                None => {}
            }
        }
        if let Some(signature) = &self.webhook_signature {
            signature.validate()?;
        }
        if self.failures.len() > 64 {
            return Err(invalid(
                "declarative external connector has too many failure mappings",
            ));
        }
        let mut statuses = BTreeSet::new();
        for failure in &self.failures {
            if !(400..=599).contains(&failure.status) || !statuses.insert(failure.status) {
                return Err(invalid(
                    "declarative failure statuses must be unique HTTP 4xx/5xx codes",
                ));
            }
        }
        Ok(())
    }

    pub fn mapping_for(
        &self,
        operation: ExternalConnectorOperationV1,
    ) -> Option<&ExternalConnectorEndpointMappingV1> {
        match operation {
            ExternalConnectorOperationV1::ValidateConfig => self.validate_config.as_ref(),
            ExternalConnectorOperationV1::Test => self.test.as_ref(),
            ExternalConnectorOperationV1::Pull => self.pull.as_ref(),
            ExternalConnectorOperationV1::Push => self.push.as_ref(),
            ExternalConnectorOperationV1::Poll => self.poll.as_ref(),
            ExternalConnectorOperationV1::Webhook => self.webhook.as_ref(),
        }
    }

    pub fn origins(&self) -> Result<Vec<String>> {
        let mut origins = BTreeSet::new();
        for mapping in [
            self.validate_config.as_ref(),
            self.test.as_ref(),
            self.pull.as_ref(),
            self.push.as_ref(),
            self.poll.as_ref(),
            self.webhook.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            origins.insert(normalize_origin(&mapping.destination_origin)?);
        }
        Ok(origins.into_iter().collect())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorExecutableDescriptorV1 {
    pub protocol: String,
    pub contract_version: u32,
    pub config_schema_version: u32,
    pub checkpoint_schema_version: u32,
    pub operations: Vec<ExternalConnectorOperationV1>,
    pub origins: Vec<String>,
    pub credential_slots: Vec<ExternalConnectorCredentialSlotV1>,
    pub config_schema: EngineConnectorConfigSchemaV1,
    pub limits: ExternalConnectorLimitsV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declarative: Option<Box<DeclarativeExternalConnectorDefinitionV1>>,
}

impl ExternalConnectorExecutableDescriptorV1 {
    pub fn validate(&self, tier: PluginTier) -> Result<()> {
        if self.protocol != EXTERNAL_CONNECTOR_PROTOCOL_V1 {
            return Err(invalid(format!(
                "external connector protocol must be {EXTERNAL_CONNECTOR_PROTOCOL_V1}"
            )));
        }
        require_version(
            self.contract_version,
            EXTERNAL_CONNECTOR_CONTRACT_VERSION,
            "external connector contract",
        )?;
        require_version(
            self.config_schema_version,
            EXTERNAL_CONNECTOR_CONFIG_SCHEMA_VERSION,
            "external connector config schema",
        )?;
        require_version(
            self.checkpoint_schema_version,
            EXTERNAL_CONNECTOR_CHECKPOINT_SCHEMA_VERSION,
            "external connector checkpoint schema",
        )?;
        if self.operations.is_empty() || self.operations.len() > 8 {
            return Err(invalid(
                "external connector operations must contain between 1 and 8 entries",
            ));
        }
        let mut seen = BTreeSet::new();
        for operation in &self.operations {
            if !seen.insert(*operation) {
                return Err(invalid("external connector operations must be unique"));
            }
        }
        for required in REQUIRED_EXTERNAL_CONNECTOR_OPERATIONS_V1 {
            if !seen.contains(&required) {
                return Err(invalid(format!(
                    "external connector must declare {}",
                    required.as_str()
                )));
            }
        }
        if !self.operations.iter().any(|op| op.is_exchange()) {
            return Err(invalid(
                "external connector must declare at least one exchange operation",
            ));
        }
        if self.origins.is_empty() || self.origins.len() > MAX_EXTERNAL_CONNECTOR_ORIGINS {
            return Err(invalid(format!(
                "external connector origins must contain between 1 and {MAX_EXTERNAL_CONNECTOR_ORIGINS} entries"
            )));
        }
        let mut origin_set = BTreeSet::new();
        for origin in &self.origins {
            let normalized = normalize_origin(origin)?;
            if !origin_set.insert(normalized) {
                return Err(invalid("external connector origins must be unique"));
            }
        }
        if self.credential_slots.len() > MAX_EXTERNAL_CONNECTOR_CREDENTIAL_SLOTS {
            return Err(invalid(format!(
                "external connector exceeds {MAX_EXTERNAL_CONNECTOR_CREDENTIAL_SLOTS} credential slots"
            )));
        }
        let mut slot_ids = BTreeSet::new();
        for slot in &self.credential_slots {
            slot.validate()?;
            if !slot_ids.insert(slot.id.as_str()) {
                return Err(invalid(
                    "external connector credential slot ids must be unique",
                ));
            }
            for operation in &slot.operations {
                if !seen.contains(operation) {
                    return Err(invalid(format!(
                        "credential slot {} references undeclared operation {}",
                        slot.id,
                        operation.as_str()
                    )));
                }
            }
        }
        if self.config_schema.schema_version != EXTERNAL_CONNECTOR_CONFIG_SCHEMA_VERSION {
            return Err(invalid(
                "external connector configSchema.schemaVersion must match configSchemaVersion",
            ));
        }
        self.config_schema.validate()?;
        self.limits.validate()?;
        match tier {
            PluginTier::Declarative => {
                let definition = self.declarative.as_deref().ok_or_else(|| {
                    invalid("declarative external connector requires a declarative definition")
                })?;
                definition.validate(&self.operations)?;
                let mapped_origins = definition.origins()?;
                if mapped_origins
                    .iter()
                    .any(|origin| !origin_set.contains(origin.as_str()))
                {
                    return Err(invalid(
                        "declarative origins must be subset of declared origins",
                    ));
                }
            }
            PluginTier::Sandbox | PluginTier::Process => {
                if self.declarative.is_some() {
                    return Err(invalid(
                        "executable sandbox/process external connectors cannot declare Tier 1 mappings",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn declares(&self, operation: ExternalConnectorOperationV1) -> bool {
        self.operations.contains(&operation)
    }

    pub fn slots_for(
        &self,
        operation: ExternalConnectorOperationV1,
    ) -> Vec<&ExternalConnectorCredentialSlotV1> {
        self.credential_slots
            .iter()
            .filter(|slot| slot.operations.contains(&operation))
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorProfileBindingV1 {
    pub profile_id: String,
    pub contribution_id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contract_version: u32,
    pub config_schema_version: u32,
    pub checkpoint_schema_version: u32,
}

impl ExternalConnectorProfileBindingV1 {
    pub fn validate(&self) -> Result<()> {
        require_identifier(&self.profile_id, "profileId", 128)?;
        require_identifier(&self.contribution_id, "contributionId", 128)?;
        require_identifier(&self.plugin_id, "pluginId", 128)?;
        require_bounded_text(&self.version_id, "versionId", 1, 384)?;
        if self.activation_revision == 0 {
            return Err(invalid("activationRevision must be positive"));
        }
        require_version(
            self.contract_version,
            EXTERNAL_CONNECTOR_CONTRACT_VERSION,
            "binding contract",
        )?;
        require_version(
            self.config_schema_version,
            EXTERNAL_CONNECTOR_CONFIG_SCHEMA_VERSION,
            "binding config schema",
        )?;
        require_version(
            self.checkpoint_schema_version,
            EXTERNAL_CONNECTOR_CHECKPOINT_SCHEMA_VERSION,
            "binding checkpoint schema",
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorRequestHeaderV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub deadline_ms: u64,
    pub binding: ExternalConnectorProfileBindingV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_checkpoint_revision: Option<u64>,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    pub config: EngineConnectorConfigV1,
}

fn default_attempt() -> u32 {
    1
}

impl ExternalConnectorRequestHeaderV1 {
    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        limits.validate()?;
        require_version(
            self.contract_version,
            EXTERNAL_CONNECTOR_CONTRACT_VERSION,
            "request contract",
        )?;
        require_identifier(
            &self.request_id,
            "requestId",
            MAX_EXTERNAL_CONNECTOR_REQUEST_ID_BYTES,
        )?;
        if self.deadline_ms == 0 || self.deadline_ms > limits.max_deadline_ms {
            return Err(invalid(
                "request deadlineMs is outside descriptor bounds",
            ));
        }
        self.binding.validate()?;
        if let Some(key) = &self.idempotency_key {
            require_identifier(
                key,
                "idempotencyKey",
                MAX_EXTERNAL_CONNECTOR_IDEMPOTENCY_KEY_BYTES,
            )?;
        }
        if self.attempt == 0 || self.attempt > MAX_EXTERNAL_CONNECTOR_ATTEMPT {
            return Err(invalid(format!(
                "attempt must be between 1 and {MAX_EXTERNAL_CONNECTOR_ATTEMPT}"
            )));
        }
        validate_config_shape(&self.config, limits)?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorPullPayloadV1 {
    pub stream_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub limit: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_locale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_locale: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorPushPayloadV1 {
    pub stream_id: String,
    pub items: Vec<ExternalConnectorItemV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorPollPayloadV1 {
    pub stream_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorWebhookPayloadV1 {
    pub stream_id: String,
    pub event_id: String,
    pub event_type: String,
    pub body: Value,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ExternalConnectorRequestV1 {
    #[serde(rename = "validateConfig")]
    ValidateConfig {
        #[serde(flatten)]
        header: ExternalConnectorRequestHeaderV1,
    },
    #[serde(rename = "test")]
    Test {
        #[serde(flatten)]
        header: ExternalConnectorRequestHeaderV1,
    },
    #[serde(rename = "pull")]
    Pull {
        #[serde(flatten)]
        header: ExternalConnectorRequestHeaderV1,
        payload: ExternalConnectorPullPayloadV1,
    },
    #[serde(rename = "push")]
    Push {
        #[serde(flatten)]
        header: ExternalConnectorRequestHeaderV1,
        payload: ExternalConnectorPushPayloadV1,
    },
    #[serde(rename = "poll")]
    Poll {
        #[serde(flatten)]
        header: ExternalConnectorRequestHeaderV1,
        payload: ExternalConnectorPollPayloadV1,
    },
    #[serde(rename = "webhook")]
    Webhook {
        #[serde(flatten)]
        header: ExternalConnectorRequestHeaderV1,
        payload: ExternalConnectorWebhookPayloadV1,
    },
}

impl ExternalConnectorRequestV1 {
    pub fn operation(&self) -> ExternalConnectorOperationV1 {
        match self {
            Self::ValidateConfig { .. } => ExternalConnectorOperationV1::ValidateConfig,
            Self::Test { .. } => ExternalConnectorOperationV1::Test,
            Self::Pull { .. } => ExternalConnectorOperationV1::Pull,
            Self::Push { .. } => ExternalConnectorOperationV1::Push,
            Self::Poll { .. } => ExternalConnectorOperationV1::Poll,
            Self::Webhook { .. } => ExternalConnectorOperationV1::Webhook,
        }
    }

    pub fn header(&self) -> &ExternalConnectorRequestHeaderV1 {
        match self {
            Self::ValidateConfig { header }
            | Self::Test { header }
            | Self::Pull { header, .. }
            | Self::Push { header, .. }
            | Self::Poll { header, .. }
            | Self::Webhook { header, .. } => header,
        }
    }

    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        let header = self.header();
        header.validate(limits)?;
        match self {
            Self::ValidateConfig { .. } | Self::Test { .. } => {
                if header.idempotency_key.is_some() || header.expected_checkpoint_revision.is_some()
                {
                    return Err(invalid(
                        "validateConfig/test cannot carry idempotency or checkpoint revision",
                    ));
                }
                Ok(())
            }
            Self::Pull { payload, .. } => {
                require_identifier(
                    &payload.stream_id,
                    "streamId",
                    MAX_EXTERNAL_CONNECTOR_STREAM_ID_BYTES,
                )?;
                if payload.limit == 0 || payload.limit > limits.max_items {
                    return Err(invalid("pull limit is outside descriptor bounds"));
                }
                if let Some(cursor) = &payload.cursor {
                    require_bounded_text(cursor, "cursor", 1, 512)?;
                }
                validate_optional_locale(&payload.source_locale, "sourceLocale")?;
                validate_optional_locale(&payload.target_locale, "targetLocale")
            }
            Self::Push { payload, header } => {
                if header.idempotency_key.is_none() {
                    return Err(invalid("push requires an idempotencyKey"));
                }
                require_identifier(
                    &payload.stream_id,
                    "streamId",
                    MAX_EXTERNAL_CONNECTOR_STREAM_ID_BYTES,
                )?;
                if payload.items.is_empty() || payload.items.len() > limits.max_items as usize {
                    return Err(invalid("push items are empty or oversized"));
                }
                for item in &payload.items {
                    item.validate(limits)?;
                }
                Ok(())
            }
            Self::Poll { payload, .. } => {
                require_identifier(
                    &payload.stream_id,
                    "streamId",
                    MAX_EXTERNAL_CONNECTOR_STREAM_ID_BYTES,
                )?;
                if payload.limit == 0 || payload.limit > limits.max_items {
                    return Err(invalid("poll limit is outside descriptor bounds"));
                }
                if let Some(cursor) = &payload.cursor {
                    require_bounded_text(cursor, "cursor", 1, 512)?;
                }
                Ok(())
            }
            Self::Webhook { payload, header } => {
                if header.idempotency_key.is_none() {
                    return Err(invalid("webhook requires an idempotencyKey"));
                }
                require_identifier(
                    &payload.stream_id,
                    "streamId",
                    MAX_EXTERNAL_CONNECTOR_STREAM_ID_BYTES,
                )?;
                require_identifier(&payload.event_id, "eventId", 128)?;
                require_identifier(&payload.event_type, "eventType", 128)?;
                if payload.headers.len() > MAX_EXTERNAL_CONNECTOR_HEADERS {
                    return Err(invalid("webhook headers exceed the limit"));
                }
                for (name, value) in &payload.headers {
                    validate_header_name(name, true)?;
                    require_bounded_text(
                        value,
                        "webhook header value",
                        0,
                        MAX_EXTERNAL_CONNECTOR_HEADER_VALUE_BYTES,
                    )?;
                }
                if let Some(signature) = &payload.signature {
                    require_bounded_text(signature, "webhook signature", 1, 512)?;
                }
                let body_bytes = serde_json::to_vec(&payload.body)?.len();
                if body_bytes > limits.max_request_bytes as usize {
                    return Err(invalid("webhook body exceeds maxRequestBytes"));
                }
                validate_json_value(&payload.body, 0)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorItemV1 {
    pub external_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_revision: Option<String>,
    pub source_locale: String,
    pub target_locale: String,
    pub source_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
}

impl ExternalConnectorItemV1 {
    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        require_identifier(&self.external_id, "externalId", 256)?;
        if let Some(revision) = &self.external_revision {
            require_bounded_text(revision, "externalRevision", 1, 256)?;
        }
        validate_locale(&self.source_locale, "sourceLocale")?;
        validate_locale(&self.target_locale, "targetLocale")?;
        require_bounded_text(
            &self.source_text,
            "sourceText",
            0,
            limits.max_item_text_bytes as usize,
        )?;
        if let Some(text) = &self.target_text {
            require_bounded_text(text, "targetText", 0, limits.max_item_text_bytes as usize)?;
        }
        if let Some(context) = &self.context {
            require_bounded_text(context, "context", 0, 4 * 1024)?;
        }
        if self.metadata.len() > limits.max_metadata_entries as usize {
            return Err(invalid("item metadata exceeds descriptor bounds"));
        }
        for (key, value) in &self.metadata {
            require_identifier(key, "metadata key", 64)?;
            require_bounded_text(
                value,
                "metadata value",
                0,
                MAX_EXTERNAL_CONNECTOR_METADATA_VALUE_BYTES,
            )?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorReceiptV1 {
    pub external_id: String,
    pub accepted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ExternalConnectorReceiptV1 {
    pub fn validate(&self) -> Result<()> {
        require_identifier(&self.external_id, "receipt externalId", 256)?;
        if let Some(revision) = &self.remote_revision {
            require_bounded_text(revision, "remoteRevision", 1, 256)?;
        }
        if let Some(message) = &self.message {
            require_bounded_text(message, "receipt message", 1, 512)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorCheckpointCandidateV1 {
    pub stream_id: String,
    pub schema_version: u32,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

impl ExternalConnectorCheckpointCandidateV1 {
    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        require_identifier(
            &self.stream_id,
            "checkpoint streamId",
            MAX_EXTERNAL_CONNECTOR_STREAM_ID_BYTES,
        )?;
        require_version(
            self.schema_version,
            EXTERNAL_CONNECTOR_CHECKPOINT_SCHEMA_VERSION,
            "checkpoint schema",
        )?;
        let bytes = serde_json::to_vec(&self.payload)?.len();
        if bytes > limits.max_checkpoint_bytes as usize {
            return Err(invalid("checkpoint payload exceeds maxCheckpointBytes"));
        }
        validate_json_value(&self.payload, 0)?;
        if let Some(cursor) = &self.cursor {
            require_bounded_text(cursor, "checkpoint cursor", 1, 512)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorConfigIssueV1 {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorConfigValidationResultV1 {
    pub valid: bool,
    pub issues: Vec<ExternalConnectorConfigIssueV1>,
}

impl ExternalConnectorConfigValidationResultV1 {
    pub fn validate(&self) -> Result<()> {
        if self.issues.len() > 64 {
            return Err(invalid("config validation has too many issues"));
        }
        if self.valid && !self.issues.is_empty() {
            return Err(invalid("valid config cannot contain issues"));
        }
        for issue in &self.issues {
            require_identifier(&issue.field, "issue field", 64)?;
            require_identifier(&issue.code, "issue code", 64)?;
            require_bounded_text(&issue.message, "issue message", 1, 512)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorTestResultV1 {
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ExternalConnectorTestResultV1 {
    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        if self.latency_ms > limits.max_deadline_ms {
            return Err(invalid("test latencyMs exceeds descriptor bounds"));
        }
        if let Some(message) = &self.message {
            require_bounded_text(message, "test message", 1, 512)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorBatchResultV1 {
    pub items: Vec<ExternalConnectorItemV1>,
    pub has_more: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<ExternalConnectorCheckpointCandidateV1>,
}

impl ExternalConnectorBatchResultV1 {
    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        if self.items.len() > limits.max_items as usize {
            return Err(invalid("batch items exceed descriptor bounds"));
        }
        for item in &self.items {
            item.validate(limits)?;
        }
        if let Some(cursor) = &self.next_cursor {
            require_bounded_text(cursor, "nextCursor", 1, 512)?;
        }
        if let Some(checkpoint) = &self.checkpoint {
            checkpoint.validate(limits)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorPushResultV1 {
    pub receipts: Vec<ExternalConnectorReceiptV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<ExternalConnectorCheckpointCandidateV1>,
}

impl ExternalConnectorPushResultV1 {
    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        if self.receipts.is_empty() || self.receipts.len() > limits.max_items as usize {
            return Err(invalid("push receipts are empty or oversized"));
        }
        let mut ids = BTreeSet::new();
        for receipt in &self.receipts {
            receipt.validate()?;
            if !ids.insert(receipt.external_id.as_str()) {
                return Err(invalid("push receipt externalIds must be unique"));
            }
        }
        if let Some(checkpoint) = &self.checkpoint {
            checkpoint.validate(limits)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ExternalConnectorResultV1 {
    #[serde(rename = "validateConfig")]
    ValidateConfig(ExternalConnectorConfigValidationResultV1),
    #[serde(rename = "test")]
    Test(ExternalConnectorTestResultV1),
    #[serde(rename = "pull")]
    Pull(ExternalConnectorBatchResultV1),
    #[serde(rename = "push")]
    Push(ExternalConnectorPushResultV1),
    #[serde(rename = "poll")]
    Poll(ExternalConnectorBatchResultV1),
    #[serde(rename = "webhook")]
    Webhook(ExternalConnectorBatchResultV1),
}

impl ExternalConnectorResultV1 {
    pub fn operation(&self) -> ExternalConnectorOperationV1 {
        match self {
            Self::ValidateConfig(_) => ExternalConnectorOperationV1::ValidateConfig,
            Self::Test(_) => ExternalConnectorOperationV1::Test,
            Self::Pull(_) => ExternalConnectorOperationV1::Pull,
            Self::Push(_) => ExternalConnectorOperationV1::Push,
            Self::Poll(_) => ExternalConnectorOperationV1::Poll,
            Self::Webhook(_) => ExternalConnectorOperationV1::Webhook,
        }
    }

    pub fn validate(&self, limits: &ExternalConnectorLimitsV1) -> Result<()> {
        match self {
            Self::ValidateConfig(value) => value.validate(),
            Self::Test(value) => value.validate(limits),
            Self::Pull(value) | Self::Poll(value) | Self::Webhook(value) => value.validate(limits),
            Self::Push(value) => value.validate(limits),
        }
    }

    pub fn checkpoint_candidate(&self) -> Option<&ExternalConnectorCheckpointCandidateV1> {
        match self {
            Self::Pull(value) | Self::Poll(value) | Self::Webhook(value) => {
                value.checkpoint.as_ref()
            }
            Self::Push(value) => value.checkpoint.as_ref(),
            Self::ValidateConfig(_) | Self::Test(_) => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ExternalConnectorFailureCodeV1 {
    InvalidConfig,
    Authentication,
    Conflict,
    RateLimit,
    Timeout,
    Unavailable,
    Protocol,
    PayloadSize,
    Cancelled,
    HostCrash,
    PermissionDenied,
    StaleGeneration,
    IdempotencyConflict,
}

impl ExternalConnectorFailureCodeV1 {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidConfig => "invalidConfig",
            Self::Authentication => "authentication",
            Self::Conflict => "conflict",
            Self::RateLimit => "rateLimit",
            Self::Timeout => "timeout",
            Self::Unavailable => "unavailable",
            Self::Protocol => "protocol",
            Self::PayloadSize => "payloadSize",
            Self::Cancelled => "cancelled",
            Self::HostCrash => "hostCrash",
            Self::PermissionDenied => "permissionDenied",
            Self::StaleGeneration => "staleGeneration",
            Self::IdempotencyConflict => "idempotencyConflict",
        }
    }

    pub const fn retryable_by_default(self) -> bool {
        matches!(
            self,
            Self::RateLimit | Self::Timeout | Self::Unavailable | Self::HostCrash
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorFailureV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub code: ExternalConnectorFailureCodeV1,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl ExternalConnectorFailureV1 {
    pub fn validate(&self) -> Result<()> {
        require_version(
            self.contract_version,
            EXTERNAL_CONNECTOR_CONTRACT_VERSION,
            "failure contract",
        )?;
        require_identifier(
            &self.request_id,
            "failure requestId",
            MAX_EXTERNAL_CONNECTOR_REQUEST_ID_BYTES,
        )?;
        require_bounded_text(
            &self.message,
            "failure message",
            1,
            MAX_EXTERNAL_CONNECTOR_ERROR_MESSAGE_BYTES,
        )?;
        let lowered = self.message.to_ascii_lowercase();
        if self.message.contains('\0')
            || lowered.contains("password")
            || lowered.contains("secret")
            || lowered.contains("authorization")
        {
            return Err(invalid("failure message may not contain secret markers"));
        }
        if let Some(retry_after) = self.retry_after_ms {
            if !self.retryable {
                return Err(invalid(
                    "non-retryable failures cannot include retryAfterMs",
                ));
            }
            if !self.code.retryable_by_default() {
                return Err(invalid(
                    "retryAfterMs is only valid for documented retryable codes",
                ));
            }
            if retry_after > MAX_EXTERNAL_CONNECTOR_RETRY_AFTER_MS {
                return Err(invalid("retryAfterMs exceeds the documented maximum"));
            }
        }
        Ok(())
    }
}

/// Host-owned invocation context. Credential values are never part of the
/// serializable request envelope and must be cleared after every call.
#[derive(Debug, Clone, Default)]
pub struct ExternalConnectorInvocationContextV1 {
    pub credentials: BTreeMap<String, String>,
}

impl ExternalConnectorInvocationContextV1 {
    pub fn clear(&mut self) {
        for value in self.credentials.values_mut() {
            value.clear();
        }
        self.credentials.clear();
    }

    pub fn validate_slots(&self, slots: &[&ExternalConnectorCredentialSlotV1]) -> Result<()> {
        let required: BTreeSet<_> = slots
            .iter()
            .filter(|slot| slot.required)
            .map(|slot| slot.id.as_str())
            .collect();
        let allowed: BTreeSet<_> = slots.iter().map(|slot| slot.id.as_str()).collect();
        for key in self.credentials.keys() {
            if !allowed.contains(key.as_str()) {
                return Err(invalid(format!(
                    "invocation credential slot {key} is not selected for this operation"
                )));
            }
            let value = &self.credentials[key];
            require_bounded_text(
                value,
                "credential value",
                1,
                MAX_EXTERNAL_CONNECTOR_CREDENTIAL_BYTES,
            )?;
        }
        for key in required {
            if !self.credentials.contains_key(key) {
                return Err(invalid(format!(
                    "required credential slot {key} is missing"
                )));
            }
        }
        Ok(())
    }
}

impl Drop for ExternalConnectorInvocationContextV1 {
    fn drop(&mut self) {
        self.clear();
    }
}

fn validate_config_shape(
    config: &EngineConnectorConfigV1,
    limits: &ExternalConnectorLimitsV1,
) -> Result<()> {
    if config.len() > MAX_EXTERNAL_CONNECTOR_CONFIG_FIELDS {
        return Err(invalid("config has too many fields"));
    }
    let bytes = serde_json::to_vec(config)?.len();
    if bytes > limits.max_config_bytes as usize {
        return Err(invalid("config exceeds maxConfigBytes"));
    }
    for (key, value) in config {
        require_identifier(key, "config key", MAX_EXTERNAL_CONNECTOR_CONFIG_KEY_BYTES)?;
        match value {
            EngineConnectorConfigValueV1::String(text) => {
                require_bounded_text(
                    text,
                    "config value",
                    0,
                    MAX_EXTERNAL_CONNECTOR_CONFIG_VALUE_BYTES,
                )?;
            }
            EngineConnectorConfigValueV1::Boolean(_) | EngineConnectorConfigValueV1::Integer(_) => {}
        }
    }
    Ok(())
}

fn validate_locale(value: &str, label: &str) -> Result<()> {
    require_bounded_text(value, label, 1, MAX_EXTERNAL_CONNECTOR_LOCALE_BYTES)?;
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return Err(invalid(format!("{label} is malformed")));
    }
    Ok(())
}

fn validate_optional_locale(value: &Option<String>, label: &str) -> Result<()> {
    if let Some(value) = value {
        validate_locale(value, label)?;
    }
    Ok(())
}

pub fn normalize_external_origin(origin: &str) -> Result<String> {
    normalize_origin(origin)
}

fn normalize_origin(origin: &str) -> Result<String> {
    require_bounded_text(origin, "origin", 1, MAX_EXTERNAL_CONNECTOR_ENDPOINT_BYTES)?;
    if origin.ends_with('/') || origin.contains(['?', '#', '{', '}', '\r', '\n', ' ', '@']) {
        return Err(invalid("origin is malformed"));
    }
    if !origin_scheme_allowed(origin) {
        return Err(invalid(
            "origin must use HTTPS except for loopback HTTP",
        ));
    }
    Ok(origin.to_string())
}

fn origin_scheme_allowed(origin: &str) -> bool {
    if let Some(authority) = origin.strip_prefix("https://") {
        return valid_authority(authority, false);
    }
    let Some(authority) = origin.strip_prefix("http://") else {
        return false;
    };
    valid_authority(authority, true)
}

fn valid_authority(authority: &str, loopback_only: bool) -> bool {
    if authority.is_empty()
        || authority.contains(['/', '?', '#', '@', ' '])
        || authority.ends_with(':')
    {
        return false;
    }
    if !loopback_only {
        return true;
    }
    let host = if authority.starts_with('[') {
        authority.split(']').next().map(|value| format!("{value}]"))
    } else {
        authority.split(':').next().map(ToString::to_string)
    };
    matches!(host.as_deref(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

fn validate_origin_and_endpoint(origin: &str, url_template: &str) -> Result<()> {
    let normalized = normalize_origin(origin)?;
    require_bounded_text(
        url_template,
        "urlTemplate",
        1,
        MAX_EXTERNAL_CONNECTOR_ENDPOINT_BYTES,
    )?;
    if url_template.contains(['#', '\r', '\n', ' ']) {
        return Err(invalid("urlTemplate is malformed"));
    }
    if url_template != normalized && !url_template.starts_with(&format!("{normalized}/")) {
        return Err(invalid(
            "urlTemplate must remain under destinationOrigin",
        ));
    }
    Ok(())
}

fn validate_header_name(name: &str, authentication_header: bool) -> Result<()> {
    require_bounded_text(
        name,
        "header name",
        1,
        MAX_EXTERNAL_CONNECTOR_HEADER_NAME_BYTES,
    )?;
    if !name.bytes().all(|byte| {
        byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
            )
    }) {
        return Err(invalid("header name is malformed"));
    }
    let normalized = name.to_ascii_lowercase();
    let forbidden = ["cookie", "host", "content-length", "transfer-encoding"];
    if forbidden.contains(&normalized.as_str())
        || (!authentication_header && normalized == "authorization")
    {
        return Err(invalid("header is host-owned or sensitive"));
    }
    Ok(())
}

fn validate_json_path(path: &[String], label: &str) -> Result<()> {
    if path.is_empty() || path.len() > MAX_EXTERNAL_CONNECTOR_JSON_PATH_DEPTH {
        return Err(invalid(format!(
            "{label} must contain between 1 and {MAX_EXTERNAL_CONNECTOR_JSON_PATH_DEPTH} segments"
        )));
    }
    for segment in path {
        require_bounded_text(
            segment,
            "JSON path segment",
            1,
            MAX_EXTERNAL_CONNECTOR_JSON_PATH_SEGMENT_BYTES,
        )?;
        if !segment
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
        {
            return Err(invalid("JSON path segment is malformed"));
        }
    }
    Ok(())
}

fn validate_optional_json_path(path: &Option<Vec<String>>, label: &str) -> Result<()> {
    if let Some(path) = path {
        validate_json_path(path, label)?;
    }
    Ok(())
}

fn validate_json_value(value: &Value, depth: usize) -> Result<()> {
    if depth > 16 {
        return Err(invalid("JSON exceeds the depth limit"));
    }
    match value {
        Value::Null | Value::Bool(_) => Ok(()),
        Value::Number(number) => {
            if number.as_f64().is_some_and(|n| !n.is_finite()) {
                return Err(invalid("JSON numbers must be finite"));
            }
            Ok(())
        }
        Value::String(text) => require_bounded_text(
            text,
            "JSON string",
            0,
            MAX_EXTERNAL_CONNECTOR_CONFIG_VALUE_BYTES,
        ),
        Value::Array(values) => {
            if values.len() > 256 {
                return Err(invalid("JSON array has too many items"));
            }
            for value in values {
                validate_json_value(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            if values.len() > 128 {
                return Err(invalid("JSON object has too many fields"));
            }
            for (key, value) in values {
                require_identifier(key, "JSON key", 64)?;
                validate_json_value(value, depth + 1)?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        EngineConnectorConfigFieldTypeV1, EngineConnectorConfigFieldV1,
        EngineConnectorConfigSchemaV1, EngineConnectorConfigValueV1,
    };

    fn sample_schema() -> EngineConnectorConfigSchemaV1 {
        EngineConnectorConfigSchemaV1 {
            schema_version: 1,
            fields: vec![EngineConnectorConfigFieldV1 {
                key: "basePath".into(),
                label: "Base path".into(),
                field_type: EngineConnectorConfigFieldTypeV1::Text,
                required: false,
                description: None,
                default_value: Some(EngineConnectorConfigValueV1::String("/v1".into())),
                min: None,
                max: None,
                options: vec![],
            }],
        }
    }

    fn sample_executable(tier: PluginTier) -> ExternalConnectorExecutableDescriptorV1 {
        let mut descriptor = ExternalConnectorExecutableDescriptorV1 {
            protocol: EXTERNAL_CONNECTOR_PROTOCOL_V1.into(),
            contract_version: 1,
            config_schema_version: 1,
            checkpoint_schema_version: 1,
            operations: vec![
                ExternalConnectorOperationV1::ValidateConfig,
                ExternalConnectorOperationV1::Test,
                ExternalConnectorOperationV1::Pull,
                ExternalConnectorOperationV1::Push,
                ExternalConnectorOperationV1::Poll,
                ExternalConnectorOperationV1::Webhook,
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
                    ExternalConnectorOperationV1::Poll,
                    ExternalConnectorOperationV1::Webhook,
                ],
            }],
            config_schema: sample_schema(),
            limits: ExternalConnectorLimitsV1::default(),
            declarative: None,
        };
        if tier == PluginTier::Declarative {
            let mapping = ExternalConnectorEndpointMappingV1 {
                destination_origin: "http://127.0.0.1:43124".into(),
                url_template: "http://127.0.0.1:43124/v1/items".into(),
                method: ExternalConnectorHttpMethodV1::Get,
                fixed_headers: vec![],
                authentication: ExternalConnectorAuthenticationV1::Bearer {
                    slot: "apiToken".into(),
                },
                fixed_query: BTreeMap::new(),
                fixed_body: BTreeMap::new(),
                items_path: Some(vec!["items".into()]),
                has_more_path: Some(vec!["hasMore".into()]),
                checkpoint_path: Some(vec!["checkpoint".into()]),
                receipts_path: None,
            };
            descriptor.declarative = Some(Box::new(DeclarativeExternalConnectorDefinitionV1 {
                definition_version: 1,
                validate_config: None,
                test: Some(ExternalConnectorEndpointMappingV1 {
                    method: ExternalConnectorHttpMethodV1::Get,
                    url_template: "http://127.0.0.1:43124/v1/health".into(),
                    items_path: None,
                    has_more_path: None,
                    checkpoint_path: None,
                    ..mapping.clone()
                }),
                pull: Some(mapping.clone()),
                push: Some(ExternalConnectorEndpointMappingV1 {
                    method: ExternalConnectorHttpMethodV1::Post,
                    url_template: "http://127.0.0.1:43124/v1/items".into(),
                    items_path: None,
                    receipts_path: Some(vec!["receipts".into()]),
                    ..mapping.clone()
                }),
                poll: Some(mapping.clone()),
                webhook: Some(ExternalConnectorEndpointMappingV1 {
                    method: ExternalConnectorHttpMethodV1::Post,
                    url_template: "http://127.0.0.1:43124/v1/webhook".into(),
                    items_path: Some(vec!["items".into()]),
                    ..mapping
                }),
                webhook_signature: Some(ExternalConnectorWebhookSignatureV1::HmacSha256 {
                    header: "x-signature".into(),
                    slot: "apiToken".into(),
                    prefix: Some("sha256=".into()),
                }),
                failures: vec![ExternalConnectorFailureMappingV1 {
                    status: 429,
                    code: ExternalConnectorFailureCodeV1::RateLimit,
                    retryable: true,
                }],
            }));
        }
        descriptor
    }

    #[test]
    fn accepts_strict_executable_descriptors() {
        for tier in [
            PluginTier::Declarative,
            PluginTier::Sandbox,
            PluginTier::Process,
        ] {
            assert!(
                sample_executable(tier).validate(tier).is_ok(),
                "tier {tier:?}"
            );
        }
    }

    #[test]
    fn rejects_missing_exchange_operation() {
        let mut descriptor = sample_executable(PluginTier::Process);
        descriptor.operations = vec![
            ExternalConnectorOperationV1::ValidateConfig,
            ExternalConnectorOperationV1::Test,
        ];
        assert!(descriptor.validate(PluginTier::Process).is_err());
    }

    #[test]
    fn rejects_unknown_origin_scheme() {
        let mut descriptor = sample_executable(PluginTier::Process);
        descriptor.origins = vec!["ftp://example.com".into()];
        assert!(descriptor.validate(PluginTier::Process).is_err());
    }

    #[test]
    fn push_requires_idempotency_key() {
        let limits = ExternalConnectorLimitsV1::default();
        let request = ExternalConnectorRequestV1::Push {
            header: ExternalConnectorRequestHeaderV1 {
                contract_version: 1,
                request_id: "req-1".into(),
                deadline_ms: 5_000,
                binding: ExternalConnectorProfileBindingV1 {
                    profile_id: "profile-1".into(),
                    contribution_id: "contrib-1".into(),
                    plugin_id: "plugin-1".into(),
                    version_id: "plugin-1@1.0.0".into(),
                    activation_revision: 1,
                    contract_version: 1,
                    config_schema_version: 1,
                    checkpoint_schema_version: 1,
                },
                idempotency_key: None,
                expected_checkpoint_revision: Some(0),
                attempt: 1,
                config: BTreeMap::new(),
            },
            payload: ExternalConnectorPushPayloadV1 {
                stream_id: "default".into(),
                items: vec![ExternalConnectorItemV1 {
                    external_id: "item-1".into(),
                    external_revision: None,
                    source_locale: "en".into(),
                    target_locale: "zh".into(),
                    source_text: "hello".into(),
                    target_text: Some("你好".into()),
                    context: None,
                    metadata: BTreeMap::new(),
                }],
            },
        };
        assert!(request.validate(&limits).is_err());
    }

    #[test]
    fn failure_rejects_secret_markers_and_invalid_retry_hints() {
        let failure = ExternalConnectorFailureV1 {
            contract_version: 1,
            request_id: "req-1".into(),
            code: ExternalConnectorFailureCodeV1::Authentication,
            message: "bad password".into(),
            retryable: false,
            retry_after_ms: None,
        };
        assert!(failure.validate().is_err());
        let retry = ExternalConnectorFailureV1 {
            contract_version: 1,
            request_id: "req-1".into(),
            code: ExternalConnectorFailureCodeV1::RateLimit,
            message: "slow down".into(),
            retryable: true,
            retry_after_ms: Some(1_000),
        };
        assert!(retry.validate().is_ok());
        let bad_retry = ExternalConnectorFailureV1 {
            contract_version: 1,
            request_id: "req-1".into(),
            code: ExternalConnectorFailureCodeV1::Authentication,
            message: "denied".into(),
            retryable: true,
            retry_after_ms: Some(1_000),
        };
        assert!(bad_retry.validate().is_err());
    }

    #[test]
    fn invocation_context_selects_only_declared_slots() {
        let slot = ExternalConnectorCredentialSlotV1 {
            id: "apiToken".into(),
            label: "API token".into(),
            description: None,
            required: true,
            operations: vec![ExternalConnectorOperationV1::Pull],
        };
        let mut context = ExternalConnectorInvocationContextV1 {
            credentials: BTreeMap::from([("apiToken".into(), "secret-value".into())]),
        };
        assert!(context.validate_slots(&[&slot]).is_ok());
        context.credentials.insert("other".into(), "nope".into());
        assert!(context.validate_slots(&[&slot]).is_err());
        context.clear();
        assert!(context.credentials.is_empty());
    }
}
