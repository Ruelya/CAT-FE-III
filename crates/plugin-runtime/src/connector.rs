use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{PluginRuntimeError, PluginTier, Result};

pub const ENGINE_CONNECTOR_CONTRACT_VERSION: u32 = 1;
pub const ENGINE_CONNECTOR_PROTOCOL_V1: &str = "translunar.engineConnector.v1";
pub const ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION: u32 = 1;

pub const MAX_CONNECTOR_CONFIG_BYTES: usize = 64 * 1024;
pub const MAX_CONNECTOR_CONFIG_FIELDS: usize = 64;
pub const MAX_CONNECTOR_CONFIG_KEY_BYTES: usize = 64;
pub const MAX_CONNECTOR_CONFIG_VALUE_BYTES: usize = 4 * 1024;
pub const MAX_CONNECTOR_MESSAGES: usize = 128;
pub const MAX_CONNECTOR_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_CONNECTOR_SOURCE_TEXT_BYTES: usize = 1024 * 1024;
pub const MAX_CONNECTOR_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CONNECTOR_EVENTS: u32 = 8_192;
pub const MAX_CONNECTOR_MODELS: usize = 256;
pub const MAX_CONNECTOR_MODEL_ID_BYTES: usize = 256;
pub const MAX_CONNECTOR_DEADLINE_MS: u64 = 120_000;
pub const MAX_CONNECTOR_REQUEST_ID_BYTES: usize = 128;
pub const MAX_CONNECTOR_LOCALE_BYTES: usize = 64;
pub const MAX_CONNECTOR_ERROR_MESSAGE_BYTES: usize = 1024;
pub const MAX_CONNECTOR_CREDENTIAL_BYTES: usize = 16 * 1024;
pub const MAX_CONNECTOR_ENDPOINT_BYTES: usize = 2_048;
pub const MAX_CONNECTOR_HEADERS: usize = 32;
pub const MAX_CONNECTOR_HEADER_NAME_BYTES: usize = 128;
pub const MAX_CONNECTOR_HEADER_VALUE_BYTES: usize = 1024;
pub const MAX_CONNECTOR_JSON_PATH_DEPTH: usize = 16;
pub const MAX_CONNECTOR_JSON_PATH_SEGMENT_BYTES: usize = 128;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
pub enum EngineConnectorOperationV1 {
    #[serde(rename = "validateConfig")]
    ValidateConfig,
    #[serde(rename = "test")]
    Test,
    #[serde(rename = "models.list")]
    ModelsList,
    #[serde(rename = "generate")]
    Generate,
}

impl EngineConnectorOperationV1 {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ValidateConfig => "validateConfig",
            Self::Test => "test",
            Self::ModelsList => "models.list",
            Self::Generate => "generate",
        }
    }
}

pub const REQUIRED_ENGINE_CONNECTOR_OPERATIONS_V1: [EngineConnectorOperationV1; 3] = [
    EngineConnectorOperationV1::ValidateConfig,
    EngineConnectorOperationV1::Test,
    EngineConnectorOperationV1::Generate,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum EngineConnectorConfigValueV1 {
    String(String),
    Boolean(bool),
    Integer(i64),
}

impl EngineConnectorConfigValueV1 {
    fn validate(&self, label: &str) -> Result<()> {
        if let Self::String(value) = self {
            require_bounded_text(value, label, 0, MAX_CONNECTOR_CONFIG_VALUE_BYTES)?;
        }
        Ok(())
    }
}

pub type EngineConnectorConfigV1 = BTreeMap<String, EngineConnectorConfigValueV1>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorConfigOptionV1 {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EngineConnectorConfigFieldTypeV1 {
    Text,
    Boolean,
    Integer,
    Select,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorConfigFieldV1 {
    pub key: String,
    pub label: String,
    pub field_type: EngineConnectorConfigFieldTypeV1,
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<EngineConnectorConfigValueV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<EngineConnectorConfigOptionV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorConfigSchemaV1 {
    pub schema_version: u32,
    pub fields: Vec<EngineConnectorConfigFieldV1>,
}

impl EngineConnectorConfigSchemaV1 {
    pub fn validate(&self) -> Result<()> {
        require_version(
            self.schema_version,
            ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION,
            "connector config schema",
        )?;
        if self.fields.len() > MAX_CONNECTOR_CONFIG_FIELDS {
            return Err(invalid(format!(
                "connector config schema exceeds {MAX_CONNECTOR_CONFIG_FIELDS} fields"
            )));
        }
        let mut keys = BTreeSet::new();
        for field in &self.fields {
            require_config_key(&field.key, "connector config field key")?;
            if !keys.insert(field.key.as_str()) {
                return Err(invalid("connector config field keys must be unique"));
            }
            require_bounded_text(&field.label, "connector config field label", 1, 128)?;
            if let Some(description) = &field.description {
                require_bounded_text(description, "connector config field description", 1, 512)?;
            }
            if let Some(value) = &field.default_value {
                value.validate("connector config default value")?;
            }
            match field.field_type {
                EngineConnectorConfigFieldTypeV1::Text => {
                    require_no_numeric_bounds(field)?;
                    if !field.options.is_empty() {
                        return Err(invalid("text connector config fields cannot have options"));
                    }
                    require_value_kind(field.default_value.as_ref(), "string")?;
                }
                EngineConnectorConfigFieldTypeV1::Boolean => {
                    require_no_numeric_bounds(field)?;
                    if !field.options.is_empty() {
                        return Err(invalid(
                            "boolean connector config fields cannot have options",
                        ));
                    }
                    if field.default_value.is_some()
                        && !matches!(
                            field.default_value,
                            Some(EngineConnectorConfigValueV1::Boolean(_))
                        )
                    {
                        return Err(invalid("boolean connector config default must be boolean"));
                    }
                }
                EngineConnectorConfigFieldTypeV1::Integer => {
                    if !field.options.is_empty() {
                        return Err(invalid(
                            "integer connector config fields cannot have options",
                        ));
                    }
                    if field.min.zip(field.max).is_some_and(|(min, max)| min > max) {
                        return Err(invalid("connector config integer min must not exceed max"));
                    }
                    if let Some(EngineConnectorConfigValueV1::Integer(value)) = field.default_value
                    {
                        if field.min.is_some_and(|min| value < min)
                            || field.max.is_some_and(|max| value > max)
                        {
                            return Err(invalid(
                                "connector config integer default is outside its bounds",
                            ));
                        }
                    } else if field.default_value.is_some() {
                        return Err(invalid("integer connector config default must be integer"));
                    }
                }
                EngineConnectorConfigFieldTypeV1::Select => {
                    require_no_numeric_bounds(field)?;
                    if field.options.is_empty() || field.options.len() > 128 {
                        return Err(invalid(
                            "select connector config fields require between 1 and 128 options",
                        ));
                    }
                    let mut values = BTreeSet::new();
                    for option in &field.options {
                        require_bounded_text(
                            &option.value,
                            "connector config option value",
                            1,
                            MAX_CONNECTOR_CONFIG_VALUE_BYTES,
                        )?;
                        require_bounded_text(
                            &option.label,
                            "connector config option label",
                            1,
                            128,
                        )?;
                        if !values.insert(option.value.as_str()) {
                            return Err(invalid("connector config option values must be unique"));
                        }
                    }
                    match field.default_value.as_ref() {
                        None => {}
                        Some(EngineConnectorConfigValueV1::String(value))
                            if values.contains(value.as_str()) => {}
                        Some(EngineConnectorConfigValueV1::String(_)) => {
                            return Err(invalid(
                                "select connector config default must name an option",
                            ));
                        }
                        Some(_) => {
                            return Err(invalid(
                                "select connector config default must be a string",
                            ));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn validate_config(&self, config: &EngineConnectorConfigV1) -> Result<()> {
        self.validate()?;
        validate_config_shape(config)?;
        let fields = self
            .fields
            .iter()
            .map(|field| (field.key.as_str(), field))
            .collect::<BTreeMap<_, _>>();
        for key in config.keys() {
            if !fields.contains_key(key.as_str()) {
                return Err(invalid(format!("unknown connector config field {key}")));
            }
        }
        for field in &self.fields {
            let Some(value) = config.get(&field.key) else {
                if field.required && field.default_value.is_none() {
                    return Err(invalid(format!(
                        "required connector config field {} is missing",
                        field.key
                    )));
                }
                continue;
            };
            validate_field_value(field, value)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorLimitsV1 {
    pub max_config_bytes: u32,
    pub max_messages: u32,
    pub max_message_bytes: u32,
    pub max_source_text_bytes: u32,
    pub max_output_bytes: u32,
    pub max_events: u32,
    pub max_models: u32,
    pub max_model_id_bytes: u32,
    pub max_deadline_ms: u64,
}

impl Default for EngineConnectorLimitsV1 {
    fn default() -> Self {
        Self {
            max_config_bytes: MAX_CONNECTOR_CONFIG_BYTES as u32,
            max_messages: MAX_CONNECTOR_MESSAGES as u32,
            max_message_bytes: MAX_CONNECTOR_MESSAGE_BYTES as u32,
            max_source_text_bytes: MAX_CONNECTOR_SOURCE_TEXT_BYTES as u32,
            max_output_bytes: MAX_CONNECTOR_OUTPUT_BYTES as u32,
            max_events: MAX_CONNECTOR_EVENTS,
            max_models: MAX_CONNECTOR_MODELS as u32,
            max_model_id_bytes: MAX_CONNECTOR_MODEL_ID_BYTES as u32,
            max_deadline_ms: MAX_CONNECTOR_DEADLINE_MS,
        }
    }
}

impl EngineConnectorLimitsV1 {
    pub fn validate(&self) -> Result<()> {
        require_limit(
            self.max_config_bytes,
            MAX_CONNECTOR_CONFIG_BYTES,
            "maxConfigBytes",
        )?;
        require_limit(self.max_messages, MAX_CONNECTOR_MESSAGES, "maxMessages")?;
        require_limit(
            self.max_message_bytes,
            MAX_CONNECTOR_MESSAGE_BYTES,
            "maxMessageBytes",
        )?;
        require_limit(
            self.max_source_text_bytes,
            MAX_CONNECTOR_SOURCE_TEXT_BYTES,
            "maxSourceTextBytes",
        )?;
        require_limit(
            self.max_output_bytes,
            MAX_CONNECTOR_OUTPUT_BYTES,
            "maxOutputBytes",
        )?;
        require_limit(self.max_events, MAX_CONNECTOR_EVENTS as usize, "maxEvents")?;
        require_limit(self.max_models, MAX_CONNECTOR_MODELS, "maxModels")?;
        require_limit(
            self.max_model_id_bytes,
            MAX_CONNECTOR_MODEL_ID_BYTES,
            "maxModelIdBytes",
        )?;
        if self.max_deadline_ms == 0 || self.max_deadline_ms > MAX_CONNECTOR_DEADLINE_MS {
            return Err(invalid(format!(
                "connector maxDeadlineMs must be between 1 and {MAX_CONNECTOR_DEADLINE_MS}"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeConnectorHeaderV1 {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum DeclarativeConnectorHttpMethodV1 {
    Post,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeConnectorEndpointV1 {
    pub destination_origin: String,
    pub url_template: String,
    pub method: DeclarativeConnectorHttpMethodV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeclarativeConnectorAuthenticationV1 {
    None,
    Bearer,
    Header { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeConnectorRequestMappingV1 {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fixed_body: BTreeMap<String, Value>,
    pub model_path: Vec<String>,
    pub messages_path: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_text_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_locale_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_locale_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeConnectorUsageMappingV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens_path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_tokens_path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeclarativeConnectorResponseMappingV1 {
    Json {
        text_path: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finish_reason_path: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<DeclarativeConnectorUsageMappingV1>,
    },
    ServerSentEvents {
        delta_path: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finish_reason_path: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<DeclarativeConnectorUsageMappingV1>,
        done_marker: String,
        max_line_bytes: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeConnectorFailureMappingV1 {
    pub status: u16,
    pub code: EngineConnectorFailureCodeV1,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeEngineConnectorDefinitionV1 {
    pub definition_version: u32,
    pub endpoint: DeclarativeConnectorEndpointV1,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fixed_headers: Vec<DeclarativeConnectorHeaderV1>,
    pub authentication: DeclarativeConnectorAuthenticationV1,
    pub request: DeclarativeConnectorRequestMappingV1,
    pub response: DeclarativeConnectorResponseMappingV1,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<DeclarativeConnectorFailureMappingV1>,
}

impl DeclarativeEngineConnectorDefinitionV1 {
    pub fn validate(&self) -> Result<()> {
        require_version(
            self.definition_version,
            ENGINE_CONNECTOR_CONTRACT_VERSION,
            "declarative connector definition",
        )?;
        validate_origin_and_endpoint(&self.endpoint)?;
        if self.fixed_headers.len() > MAX_CONNECTOR_HEADERS {
            return Err(invalid(format!(
                "declarative connector exceeds {MAX_CONNECTOR_HEADERS} fixed headers"
            )));
        }
        let mut header_names = BTreeSet::new();
        for header in &self.fixed_headers {
            validate_header_name(&header.name, false)?;
            let normalized = header.name.to_ascii_lowercase();
            if !header_names.insert(normalized) {
                return Err(invalid("declarative connector header names must be unique"));
            }
            require_bounded_text(
                &header.value,
                "declarative connector header value",
                0,
                MAX_CONNECTOR_HEADER_VALUE_BYTES,
            )?;
            if header.value.contains(['\r', '\n']) {
                return Err(invalid(
                    "declarative connector header values cannot contain newlines",
                ));
            }
        }
        if let DeclarativeConnectorAuthenticationV1::Header { name } = &self.authentication {
            validate_header_name(name, true)?;
        }
        if serde_json::to_vec(&self.request.fixed_body)?.len() > MAX_CONNECTOR_CONFIG_BYTES {
            return Err(invalid("declarative connector fixed body is oversized"));
        }
        validate_json_value(
            &Value::Object(
                self.request
                    .fixed_body
                    .clone()
                    .into_iter()
                    .collect::<serde_json::Map<_, _>>(),
            ),
            0,
        )?;
        validate_json_path(&self.request.model_path, "modelPath")?;
        validate_json_path(&self.request.messages_path, "messagesPath")?;
        validate_optional_json_path(&self.request.source_text_path, "sourceTextPath")?;
        validate_optional_json_path(&self.request.source_locale_path, "sourceLocalePath")?;
        validate_optional_json_path(&self.request.target_locale_path, "targetLocalePath")?;
        validate_optional_json_path(&self.request.stream_path, "streamPath")?;
        validate_response_mapping(&self.response)?;
        if self.failures.len() > 64 {
            return Err(invalid(
                "declarative connector has too many failure mappings",
            ));
        }
        let mut statuses = BTreeSet::new();
        for failure in &self.failures {
            if !(400..=599).contains(&failure.status) || !statuses.insert(failure.status) {
                return Err(invalid(
                    "declarative connector failure statuses must be unique HTTP 4xx/5xx codes",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EngineConnectorMessageRoleV1 {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorMessageV1 {
    pub role: EngineConnectorMessageRoleV1,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorValidateConfigRequestV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub config: EngineConnectorConfigV1,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorTestRequestV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub config: EngineConnectorConfigV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub source_locale: String,
    pub target_locale: String,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorModelsListRequestV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub config: EngineConnectorConfigV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub limit: u32,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorGenerateRequestV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub source_locale: String,
    pub target_locale: String,
    pub source_text: String,
    pub messages: Vec<EngineConnectorMessageV1>,
    pub model: String,
    pub config: EngineConnectorConfigV1,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EngineConnectorRequestV1 {
    #[serde(rename = "validateConfig")]
    ValidateConfig(EngineConnectorValidateConfigRequestV1),
    #[serde(rename = "test")]
    Test(EngineConnectorTestRequestV1),
    #[serde(rename = "models.list")]
    ModelsList(EngineConnectorModelsListRequestV1),
    #[serde(rename = "generate")]
    Generate(EngineConnectorGenerateRequestV1),
}

impl EngineConnectorRequestV1 {
    pub fn operation(&self) -> EngineConnectorOperationV1 {
        match self {
            Self::ValidateConfig(_) => EngineConnectorOperationV1::ValidateConfig,
            Self::Test(_) => EngineConnectorOperationV1::Test,
            Self::ModelsList(_) => EngineConnectorOperationV1::ModelsList,
            Self::Generate(_) => EngineConnectorOperationV1::Generate,
        }
    }

    pub fn validate(&self, limits: &EngineConnectorLimitsV1) -> Result<()> {
        limits.validate()?;
        match self {
            Self::ValidateConfig(request) => validate_common_request(
                request.contract_version,
                &request.request_id,
                &request.config,
                request.deadline_ms,
                limits,
            ),
            Self::Test(request) => {
                validate_common_request(
                    request.contract_version,
                    &request.request_id,
                    &request.config,
                    request.deadline_ms,
                    limits,
                )?;
                validate_optional_model(&request.model, limits)?;
                validate_locale(&request.source_locale, "sourceLocale")?;
                validate_locale(&request.target_locale, "targetLocale")
            }
            Self::ModelsList(request) => {
                validate_common_request(
                    request.contract_version,
                    &request.request_id,
                    &request.config,
                    request.deadline_ms,
                    limits,
                )?;
                if request.limit == 0 || request.limit > limits.max_models {
                    return Err(invalid(
                        "connector model list limit is outside descriptor bounds",
                    ));
                }
                if let Some(cursor) = &request.cursor {
                    require_bounded_text(cursor, "connector model cursor", 1, 512)?;
                }
                Ok(())
            }
            Self::Generate(request) => {
                validate_common_request(
                    request.contract_version,
                    &request.request_id,
                    &request.config,
                    request.deadline_ms,
                    limits,
                )?;
                validate_locale(&request.source_locale, "sourceLocale")?;
                validate_locale(&request.target_locale, "targetLocale")?;
                require_bounded_text(
                    &request.source_text,
                    "connector sourceText",
                    0,
                    limits.max_source_text_bytes as usize,
                )?;
                require_bounded_text(
                    &request.model,
                    "connector model",
                    1,
                    limits.max_model_id_bytes as usize,
                )?;
                if request.messages.len() > limits.max_messages as usize {
                    return Err(invalid("connector request has too many messages"));
                }
                let mut total = 0usize;
                for message in &request.messages {
                    require_bounded_text(
                        &message.content,
                        "connector message",
                        0,
                        limits.max_message_bytes as usize,
                    )?;
                    total = total.saturating_add(message.content.len());
                    if total > MAX_CONNECTOR_SOURCE_TEXT_BYTES {
                        return Err(invalid(
                            "connector messages exceed the aggregate byte limit",
                        ));
                    }
                }
                if request.messages.is_empty() && request.source_text.is_empty() {
                    return Err(invalid(
                        "connector generation requires sourceText or at least one message",
                    ));
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorConfigIssueV1 {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorConfigValidationResultV1 {
    pub valid: bool,
    pub issues: Vec<EngineConnectorConfigIssueV1>,
}

impl EngineConnectorConfigValidationResultV1 {
    pub fn validate(&self) -> Result<()> {
        if self.issues.len() > 64 {
            return Err(invalid("connector config validation has too many issues"));
        }
        if self.valid && !self.issues.is_empty() {
            return Err(invalid("valid connector config cannot contain issues"));
        }
        for issue in &self.issues {
            require_config_key(&issue.field, "connector config issue field")?;
            require_config_key(&issue.code, "connector config issue code")?;
            require_bounded_text(&issue.message, "connector config issue message", 1, 512)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorTestResultV1 {
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

impl EngineConnectorTestResultV1 {
    pub fn validate(&self, limits: &EngineConnectorLimitsV1) -> Result<()> {
        if self.latency_ms > limits.max_deadline_ms {
            return Err(invalid(
                "connector test latencyMs exceeds descriptor bounds",
            ));
        }
        validate_optional_model(&self.model, limits)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorModelV1 {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_tokens: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorModelCatalogV1 {
    pub models: Vec<EngineConnectorModelV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

impl EngineConnectorModelCatalogV1 {
    pub fn validate(&self, limits: &EngineConnectorLimitsV1) -> Result<()> {
        if self.models.len() > limits.max_models as usize {
            return Err(invalid("connector model catalog exceeds descriptor bounds"));
        }
        let mut ids = BTreeSet::new();
        for model in &self.models {
            require_bounded_text(
                &model.id,
                "connector model id",
                1,
                limits.max_model_id_bytes as usize,
            )?;
            require_bounded_text(&model.display_name, "connector model displayName", 1, 256)?;
            if !ids.insert(model.id.as_str()) {
                return Err(invalid("connector model ids must be unique"));
            }
            if model.context_tokens == Some(0) {
                return Err(invalid("connector model contextTokens must be positive"));
            }
        }
        if let Some(cursor) = &self.next_cursor {
            require_bounded_text(cursor, "connector nextCursor", 1, 512)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorUsageV1 {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

impl EngineConnectorUsageV1 {
    pub fn validate(&self) -> Result<()> {
        if self.input_tokens.saturating_add(self.output_tokens) != self.total_tokens {
            return Err(invalid(
                "connector usage totalTokens must equal inputTokens plus outputTokens",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EngineConnectorFinishReasonV1 {
    Stop,
    Length,
    ContentFilter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorResultV1 {
    pub output_text: String,
    pub model: String,
    pub finish_reason: EngineConnectorFinishReasonV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<EngineConnectorUsageV1>,
}

impl EngineConnectorResultV1 {
    pub fn validate(&self, limits: &EngineConnectorLimitsV1) -> Result<()> {
        require_bounded_text(
            &self.output_text,
            "connector outputText",
            0,
            limits.max_output_bytes as usize,
        )?;
        require_bounded_text(
            &self.model,
            "connector result model",
            1,
            limits.max_model_id_bytes as usize,
        )?;
        if let Some(usage) = &self.usage {
            usage.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EngineConnectorEventV1 {
    Delta {
        contract_version: u32,
        request_id: String,
        sequence: u32,
        text: String,
    },
    Usage {
        contract_version: u32,
        request_id: String,
        sequence: u32,
        usage: EngineConnectorUsageV1,
    },
    Completed {
        contract_version: u32,
        request_id: String,
        sequence: u32,
        result: EngineConnectorResultV1,
    },
}

impl EngineConnectorEventV1 {
    pub fn request_id(&self) -> &str {
        match self {
            Self::Delta { request_id, .. }
            | Self::Usage { request_id, .. }
            | Self::Completed { request_id, .. } => request_id,
        }
    }

    pub fn sequence(&self) -> u32 {
        match self {
            Self::Delta { sequence, .. }
            | Self::Usage { sequence, .. }
            | Self::Completed { sequence, .. } => *sequence,
        }
    }

    pub fn validate(&self, limits: &EngineConnectorLimitsV1) -> Result<()> {
        let (contract_version, request_id, sequence) = match self {
            Self::Delta {
                contract_version,
                request_id,
                sequence,
                text,
            } => {
                require_bounded_text(
                    text,
                    "connector delta text",
                    1,
                    limits.max_output_bytes as usize,
                )?;
                (*contract_version, request_id, *sequence)
            }
            Self::Usage {
                contract_version,
                request_id,
                sequence,
                usage,
            } => {
                usage.validate()?;
                (*contract_version, request_id, *sequence)
            }
            Self::Completed {
                contract_version,
                request_id,
                sequence,
                result,
            } => {
                result.validate(limits)?;
                (*contract_version, request_id, *sequence)
            }
        };
        require_version(
            contract_version,
            ENGINE_CONNECTOR_CONTRACT_VERSION,
            "connector event",
        )?;
        validate_request_id(request_id)?;
        if sequence >= limits.max_events {
            return Err(invalid(
                "connector event sequence exceeds descriptor bounds",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineConnectorEventSequenceV1 {
    request_id: String,
    next_sequence: u32,
    output_bytes: usize,
    completed: bool,
}

impl EngineConnectorEventSequenceV1 {
    pub fn new(request_id: impl Into<String>) -> Result<Self> {
        let request_id = request_id.into();
        validate_request_id(&request_id)?;
        Ok(Self {
            request_id,
            next_sequence: 0,
            output_bytes: 0,
            completed: false,
        })
    }

    pub fn accept(
        &mut self,
        event: &EngineConnectorEventV1,
        limits: &EngineConnectorLimitsV1,
    ) -> Result<()> {
        event.validate(limits)?;
        if self.completed {
            return Err(invalid("connector emitted an event after completion"));
        }
        if event.request_id() != self.request_id {
            return Err(invalid("connector event targets another request"));
        }
        if event.sequence() != self.next_sequence {
            return Err(invalid("connector event sequence is not contiguous"));
        }
        if let EngineConnectorEventV1::Delta { text, .. } = event {
            self.output_bytes = self.output_bytes.saturating_add(text.len());
            if self.output_bytes > limits.max_output_bytes as usize {
                return Err(invalid("connector delta stream exceeds maxOutputBytes"));
            }
        }
        self.completed = matches!(event, EngineConnectorEventV1::Completed { .. });
        self.next_sequence = self.next_sequence.saturating_add(1);
        Ok(())
    }

    pub const fn is_completed(&self) -> bool {
        self.completed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EngineConnectorFailureCodeV1 {
    InvalidConfig,
    Authentication,
    RateLimit,
    Timeout,
    Unavailable,
    Protocol,
    ResponseSize,
    Cancelled,
    HostCrash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorFailureV1 {
    pub contract_version: u32,
    pub request_id: String,
    pub code: EngineConnectorFailureCodeV1,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl EngineConnectorFailureV1 {
    pub fn validate(&self) -> Result<()> {
        require_version(
            self.contract_version,
            ENGINE_CONNECTOR_CONTRACT_VERSION,
            "connector failure",
        )?;
        validate_request_id(&self.request_id)?;
        require_bounded_text(
            &self.message,
            "connector failure message",
            1,
            MAX_CONNECTOR_ERROR_MESSAGE_BYTES,
        )?;
        if self.retry_after_ms.is_some()
            && (!self.retryable
                || !matches!(
                    self.code,
                    EngineConnectorFailureCodeV1::RateLimit
                        | EngineConnectorFailureCodeV1::Unavailable
                ))
        {
            return Err(invalid(
                "connector retryAfterMs is allowed only on retryable rate-limit or unavailable failures",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorCancelRequestV1 {
    pub contract_version: u32,
    pub request_id: String,
}

impl EngineConnectorCancelRequestV1 {
    pub fn validate(&self) -> Result<()> {
        require_version(
            self.contract_version,
            ENGINE_CONNECTOR_CONTRACT_VERSION,
            "connector cancellation",
        )?;
        validate_request_id(&self.request_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineConnectorShutdownRequestV1 {
    pub contract_version: u32,
}

impl EngineConnectorShutdownRequestV1 {
    pub fn validate(&self) -> Result<()> {
        require_version(
            self.contract_version,
            ENGINE_CONNECTOR_CONTRACT_VERSION,
            "connector shutdown",
        )
    }
}

pub fn validate_connector_operations_v1(
    operations: &[String],
) -> Result<Vec<EngineConnectorOperationV1>> {
    if operations.is_empty() || operations.len() > 4 {
        return Err(invalid(
            "connector operations must contain between 1 and 4 items",
        ));
    }
    let mut parsed = Vec::with_capacity(operations.len());
    let mut seen = BTreeSet::new();
    for operation in operations {
        let value = match operation.as_str() {
            "validateConfig" => EngineConnectorOperationV1::ValidateConfig,
            "test" => EngineConnectorOperationV1::Test,
            "models.list" => EngineConnectorOperationV1::ModelsList,
            "generate" => EngineConnectorOperationV1::Generate,
            _ => {
                return Err(invalid(format!(
                    "unsupported connector operation {operation}"
                )));
            }
        };
        if !seen.insert(value) {
            return Err(invalid("connector operations must not contain duplicates"));
        }
        parsed.push(value);
    }
    for required in REQUIRED_ENGINE_CONNECTOR_OPERATIONS_V1 {
        if !seen.contains(&required) {
            return Err(invalid(format!(
                "connector operations must include {}",
                required.as_str()
            )));
        }
    }
    Ok(parsed)
}

pub fn validate_connector_descriptor_v1(
    protocol: &str,
    contract_version: Option<u32>,
    operations: &[String],
    config_schema: Option<&EngineConnectorConfigSchemaV1>,
    limits: Option<&EngineConnectorLimitsV1>,
    declarative: Option<&DeclarativeEngineConnectorDefinitionV1>,
    tier: PluginTier,
) -> Result<()> {
    if protocol != ENGINE_CONNECTOR_PROTOCOL_V1 {
        return Err(invalid(format!(
            "connector protocol must be {ENGINE_CONNECTOR_PROTOCOL_V1}"
        )));
    }
    require_version(
        contract_version.unwrap_or_default(),
        ENGINE_CONNECTOR_CONTRACT_VERSION,
        "connector contract",
    )?;
    validate_connector_operations_v1(operations)?;
    config_schema
        .ok_or_else(|| invalid("connector configSchema is required"))?
        .validate()?;
    limits
        .ok_or_else(|| invalid("connector limits are required"))?
        .validate()?;
    match (tier, declarative) {
        (PluginTier::Declarative, Some(definition)) => definition.validate(),
        (PluginTier::Declarative, None) => Err(invalid(
            "declarative connector requires a typed declarative definition",
        )),
        (_, Some(_)) => Err(invalid(
            "executable connector tiers cannot include a declarative definition",
        )),
        (_, None) => Ok(()),
    }
}

fn validate_common_request(
    contract_version: u32,
    request_id: &str,
    config: &EngineConnectorConfigV1,
    deadline_ms: u64,
    limits: &EngineConnectorLimitsV1,
) -> Result<()> {
    require_version(
        contract_version,
        ENGINE_CONNECTOR_CONTRACT_VERSION,
        "connector request",
    )?;
    validate_request_id(request_id)?;
    validate_config_shape(config)?;
    if serde_json::to_vec(config)?.len() > limits.max_config_bytes as usize {
        return Err(invalid("connector config exceeds descriptor byte bounds"));
    }
    if deadline_ms == 0 || deadline_ms > limits.max_deadline_ms {
        return Err(invalid("connector deadlineMs is outside descriptor bounds"));
    }
    Ok(())
}

fn validate_config_shape(config: &EngineConnectorConfigV1) -> Result<()> {
    if config.len() > MAX_CONNECTOR_CONFIG_FIELDS {
        return Err(invalid("connector config has too many fields"));
    }
    for (key, value) in config {
        require_config_key(key, "connector config key")?;
        value.validate("connector config value")?;
    }
    if serde_json::to_vec(config)?.len() > MAX_CONNECTOR_CONFIG_BYTES {
        return Err(invalid("connector config exceeds the global byte limit"));
    }
    Ok(())
}

fn validate_field_value(
    field: &EngineConnectorConfigFieldV1,
    value: &EngineConnectorConfigValueV1,
) -> Result<()> {
    value.validate("connector config value")?;
    match (field.field_type, value) {
        (EngineConnectorConfigFieldTypeV1::Text, EngineConnectorConfigValueV1::String(_))
        | (EngineConnectorConfigFieldTypeV1::Boolean, EngineConnectorConfigValueV1::Boolean(_)) => {
            Ok(())
        }
        (
            EngineConnectorConfigFieldTypeV1::Integer,
            EngineConnectorConfigValueV1::Integer(value),
        ) => {
            if field.min.is_some_and(|min| *value < min)
                || field.max.is_some_and(|max| *value > max)
            {
                Err(invalid(format!(
                    "connector config field {} is outside its integer bounds",
                    field.key
                )))
            } else {
                Ok(())
            }
        }
        (EngineConnectorConfigFieldTypeV1::Select, EngineConnectorConfigValueV1::String(value)) => {
            if field.options.iter().any(|option| option.value == *value) {
                Ok(())
            } else {
                Err(invalid(format!(
                    "connector config field {} does not name an allowed option",
                    field.key
                )))
            }
        }
        _ => Err(invalid(format!(
            "connector config field {} has the wrong value type",
            field.key
        ))),
    }
}

fn require_value_kind(value: Option<&EngineConnectorConfigValueV1>, expected: &str) -> Result<()> {
    if value.is_some() && !matches!(value, Some(EngineConnectorConfigValueV1::String(_))) {
        return Err(invalid(format!(
            "connector config default must be {expected}"
        )));
    }
    Ok(())
}

fn require_no_numeric_bounds(field: &EngineConnectorConfigFieldV1) -> Result<()> {
    if field.min.is_some() || field.max.is_some() {
        return Err(invalid(
            "only integer connector config fields can have min/max bounds",
        ));
    }
    Ok(())
}

fn validate_response_mapping(mapping: &DeclarativeConnectorResponseMappingV1) -> Result<()> {
    match mapping {
        DeclarativeConnectorResponseMappingV1::Json {
            text_path,
            finish_reason_path,
            usage,
        } => {
            validate_json_path(text_path, "response textPath")?;
            validate_optional_json_path(finish_reason_path, "response finishReasonPath")?;
            validate_usage_mapping(usage.as_ref())
        }
        DeclarativeConnectorResponseMappingV1::ServerSentEvents {
            delta_path,
            finish_reason_path,
            usage,
            done_marker,
            max_line_bytes,
        } => {
            validate_json_path(delta_path, "response deltaPath")?;
            validate_optional_json_path(finish_reason_path, "response finishReasonPath")?;
            validate_usage_mapping(usage.as_ref())?;
            require_bounded_text(done_marker, "SSE doneMarker", 1, 128)?;
            require_limit(*max_line_bytes, 256 * 1024, "SSE maxLineBytes")
        }
    }
}

fn validate_usage_mapping(mapping: Option<&DeclarativeConnectorUsageMappingV1>) -> Result<()> {
    let Some(mapping) = mapping else {
        return Ok(());
    };
    if mapping.input_tokens_path.is_none()
        && mapping.output_tokens_path.is_none()
        && mapping.total_tokens_path.is_none()
    {
        return Err(invalid(
            "connector usage mapping must define at least one path",
        ));
    }
    validate_optional_json_path(&mapping.input_tokens_path, "usage inputTokensPath")?;
    validate_optional_json_path(&mapping.output_tokens_path, "usage outputTokensPath")?;
    validate_optional_json_path(&mapping.total_tokens_path, "usage totalTokensPath")
}

fn validate_origin_and_endpoint(endpoint: &DeclarativeConnectorEndpointV1) -> Result<()> {
    require_bounded_text(
        &endpoint.destination_origin,
        "connector destinationOrigin",
        1,
        MAX_CONNECTOR_ENDPOINT_BYTES,
    )?;
    require_bounded_text(
        &endpoint.url_template,
        "connector urlTemplate",
        1,
        MAX_CONNECTOR_ENDPOINT_BYTES,
    )?;
    if endpoint.destination_origin.ends_with('/')
        || endpoint
            .destination_origin
            .contains(['?', '#', '{', '}', '\r', '\n'])
        || endpoint.url_template.contains(['#', '\r', '\n'])
    {
        return Err(invalid(
            "connector endpoint contains an invalid origin or URL template",
        ));
    }
    if !origin_scheme_allowed(&endpoint.destination_origin) {
        return Err(invalid(
            "connector destinationOrigin must use HTTPS except for loopback HTTP",
        ));
    }
    if endpoint.url_template != endpoint.destination_origin
        && !endpoint
            .url_template
            .starts_with(&format!("{}/", endpoint.destination_origin))
    {
        return Err(invalid(
            "connector urlTemplate must remain under destinationOrigin",
        ));
    }
    for placeholder in extract_placeholders(&endpoint.url_template)? {
        if placeholder != "model" {
            return Err(invalid(format!(
                "unsupported connector URL placeholder {{{placeholder}}}"
            )));
        }
    }
    Ok(())
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

fn extract_placeholders(value: &str) -> Result<Vec<&str>> {
    let mut output = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            return Err(invalid(
                "connector URL template has an unclosed placeholder",
            ));
        };
        output.push(&after[..end]);
        rest = &after[end + 1..];
    }
    if rest.contains('}') {
        return Err(invalid(
            "connector URL template has an unmatched placeholder",
        ));
    }
    Ok(output)
}

fn validate_header_name(name: &str, authentication_header: bool) -> Result<()> {
    require_bounded_text(
        name,
        "connector header name",
        1,
        MAX_CONNECTOR_HEADER_NAME_BYTES,
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
        return Err(invalid("connector header name is malformed"));
    }
    let normalized = name.to_ascii_lowercase();
    let forbidden = ["cookie", "host", "content-length", "transfer-encoding"];
    if forbidden.contains(&normalized.as_str())
        || (!authentication_header && normalized == "authorization")
    {
        return Err(invalid("connector fixed header is host-owned or sensitive"));
    }
    Ok(())
}

fn validate_json_path(path: &[String], label: &str) -> Result<()> {
    if path.is_empty() || path.len() > MAX_CONNECTOR_JSON_PATH_DEPTH {
        return Err(invalid(format!(
            "connector {label} must contain between 1 and {MAX_CONNECTOR_JSON_PATH_DEPTH} segments"
        )));
    }
    for segment in path {
        require_bounded_text(
            segment,
            "connector JSON path segment",
            1,
            MAX_CONNECTOR_JSON_PATH_SEGMENT_BYTES,
        )?;
        if !segment
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
        {
            return Err(invalid("connector JSON path segment is malformed"));
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
        return Err(invalid("connector fixed JSON exceeds the depth limit"));
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
        Value::String(value) => require_bounded_text(
            value,
            "connector fixed JSON string",
            0,
            MAX_CONNECTOR_CONFIG_VALUE_BYTES,
        ),
        Value::Array(values) => {
            if values.len() > 128 {
                return Err(invalid("connector fixed JSON array has too many items"));
            }
            for value in values {
                validate_json_value(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            if values.len() > 128 {
                return Err(invalid("connector fixed JSON object has too many fields"));
            }
            for (key, value) in values {
                require_config_key(key, "connector fixed JSON key")?;
                validate_json_value(value, depth + 1)?;
            }
            Ok(())
        }
    }
}

fn validate_optional_model(model: &Option<String>, limits: &EngineConnectorLimitsV1) -> Result<()> {
    if let Some(model) = model {
        require_bounded_text(
            model,
            "connector model",
            1,
            limits.max_model_id_bytes as usize,
        )?;
    }
    Ok(())
}

fn validate_request_id(value: &str) -> Result<()> {
    require_bounded_text(
        value,
        "connector requestId",
        1,
        MAX_CONNECTOR_REQUEST_ID_BYTES,
    )?;
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(invalid(
            "connector requestId contains unsupported characters",
        ));
    }
    Ok(())
}

fn validate_locale(value: &str, label: &str) -> Result<()> {
    require_bounded_text(value, label, 1, MAX_CONNECTOR_LOCALE_BYTES)?;
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return Err(invalid(format!("connector {label} is malformed")));
    }
    Ok(())
}

fn require_config_key(value: &str, label: &str) -> Result<()> {
    require_bounded_text(value, label, 1, MAX_CONNECTOR_CONFIG_KEY_BYTES)?;
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(invalid(format!("{label} contains unsupported characters")));
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

fn require_version(actual: u32, expected: u32, label: &str) -> Result<()> {
    if actual != expected {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: label.to_string(),
            version: actual,
        });
    }
    Ok(())
}

fn require_limit(value: u32, maximum: usize, label: &str) -> Result<()> {
    if value == 0 || value as usize > maximum {
        return Err(invalid(format!(
            "connector {label} must be between 1 and {maximum}"
        )));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> PluginRuntimeError {
    PluginRuntimeError::InvalidManifest(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema() -> EngineConnectorConfigSchemaV1 {
        EngineConnectorConfigSchemaV1 {
            schema_version: 1,
            fields: vec![EngineConnectorConfigFieldV1 {
                key: "temperature".into(),
                label: "Temperature".into(),
                field_type: EngineConnectorConfigFieldTypeV1::Integer,
                required: false,
                description: None,
                default_value: Some(EngineConnectorConfigValueV1::Integer(0)),
                min: Some(0),
                max: Some(2),
                options: vec![],
            }],
        }
    }

    fn descriptor_json() -> Value {
        json!({
            "descriptorVersion": 1,
            "id": "example.connector",
            "version": "1.0.0",
            "displayName": "Example connector",
            "protocol": ENGINE_CONNECTOR_PROTOCOL_V1,
            "operations": ["validateConfig", "test", "generate"],
            "configSchemaVersion": 1,
            "contractVersion": 1,
            "configSchema": {
                "schemaVersion": 1,
                "fields": []
            },
            "limits": EngineConnectorLimitsV1::default()
        })
    }

    #[test]
    fn strict_descriptor_is_executable_while_legacy_inventory_is_not() {
        let descriptor: crate::EngineConnectorContributionDescriptor =
            serde_json::from_value(descriptor_json()).expect("strict descriptor should decode");
        assert!(descriptor.is_executable_v1(PluginTier::Sandbox));

        let legacy: crate::EngineConnectorContributionDescriptor = serde_json::from_value(json!({
            "descriptorVersion": 1,
            "id": "example.legacy",
            "version": "1.0.0",
            "displayName": "Legacy connector",
            "protocol": "local",
            "operations": ["lookup"],
            "configSchemaVersion": 1
        }))
        .expect("released inventory descriptor should remain readable");
        assert!(!legacy.is_executable_v1(PluginTier::Sandbox));

        let mut unknown = descriptor_json();
        unknown["extra"] = json!(true);
        assert!(
            serde_json::from_value::<crate::EngineConnectorContributionDescriptor>(unknown)
                .is_err()
        );
    }

    #[test]
    fn connector_operations_are_closed_and_mandatory() {
        assert!(
            validate_connector_operations_v1(&[
                "validateConfig".into(),
                "test".into(),
                "generate".into(),
            ])
            .is_ok()
        );
        assert!(validate_connector_operations_v1(&["lookup".into()]).is_err());
        assert!(
            validate_connector_operations_v1(&["validateConfig".into(), "test".into(),]).is_err()
        );
    }

    #[test]
    fn config_schema_rejects_unknown_and_wrong_typed_values() {
        let schema = schema();
        assert!(schema.validate().is_ok());
        assert!(
            schema
                .validate_config(&BTreeMap::from([(
                    "temperature".into(),
                    EngineConnectorConfigValueV1::Integer(1),
                )]))
                .is_ok()
        );
        assert!(
            schema
                .validate_config(&BTreeMap::from([(
                    "temperature".into(),
                    EngineConnectorConfigValueV1::String("1".into()),
                )]))
                .is_err()
        );
        assert!(
            schema
                .validate_config(&BTreeMap::from([(
                    "secret".into(),
                    EngineConnectorConfigValueV1::String("not-a-config-field".into()),
                )]))
                .is_err()
        );
    }

    #[test]
    fn request_codecs_reject_unknown_fields_versions_and_bounds() {
        let limits = EngineConnectorLimitsV1::default();
        let request: EngineConnectorRequestV1 = serde_json::from_value(json!({
            "operation": "generate",
            "contractVersion": 1,
            "requestId": "request-1",
            "sourceLocale": "en",
            "targetLocale": "ja",
            "sourceText": "Hello",
            "messages": [{"role": "user", "content": "Hello"}],
            "model": "fixture-1",
            "config": {"temperature": 1},
            "deadlineMs": 1000
        }))
        .expect("strict request should decode");
        assert_eq!(request.operation(), EngineConnectorOperationV1::Generate);
        assert!(request.validate(&limits).is_ok());
        assert!(
            serde_json::from_value::<EngineConnectorRequestV1>(json!({
                "operation": "generate",
                "contractVersion": 1,
                "requestId": "request-1",
                "sourceLocale": "en",
                "targetLocale": "ja",
                "sourceText": "Hello",
                "messages": [],
                "model": "fixture-1",
                "config": {},
                "deadlineMs": 1000,
                "unknown": true
            }))
            .is_err()
        );
        let wrong_version: EngineConnectorRequestV1 = serde_json::from_value(json!({
            "operation": "validateConfig",
            "contractVersion": 2,
            "requestId": "request-1",
            "config": {},
            "deadlineMs": 1000
        }))
        .expect("shape remains decodable for a typed version error");
        assert!(matches!(
            wrong_version.validate(&limits),
            Err(PluginRuntimeError::UnsupportedVersion { version: 2, .. })
        ));
    }

    #[test]
    fn events_results_and_failures_are_bounded() {
        let limits = EngineConnectorLimitsV1::default();
        let event = EngineConnectorEventV1::Completed {
            contract_version: 1,
            request_id: "request-1".into(),
            sequence: 2,
            result: EngineConnectorResultV1 {
                output_text: "translation".into(),
                model: "fixture-1".into(),
                finish_reason: EngineConnectorFinishReasonV1::Stop,
                usage: Some(EngineConnectorUsageV1 {
                    input_tokens: 2,
                    output_tokens: 3,
                    total_tokens: 5,
                }),
            },
        };
        assert!(event.validate(&limits).is_ok());
        let mut sequence =
            EngineConnectorEventSequenceV1::new("request-1").expect("request id should be valid");
        let delta = EngineConnectorEventV1::Delta {
            contract_version: 1,
            request_id: "request-1".into(),
            sequence: 0,
            text: "translation".into(),
        };
        assert!(sequence.accept(&delta, &limits).is_ok());
        assert!(sequence.accept(&event, &limits).is_err());
        let mut completed =
            EngineConnectorEventSequenceV1::new("request-1").expect("request id should be valid");
        assert!(completed.accept(&delta, &limits).is_ok());
        let terminal = EngineConnectorEventV1::Completed {
            contract_version: 1,
            request_id: "request-1".into(),
            sequence: 1,
            result: match event {
                EngineConnectorEventV1::Completed { result, .. } => result,
                _ => unreachable!(),
            },
        };
        assert!(completed.accept(&terminal, &limits).is_ok());
        assert!(completed.is_completed());
        assert!(completed.accept(&terminal, &limits).is_err());
        let failure = EngineConnectorFailureV1 {
            contract_version: 1,
            request_id: "request-1".into(),
            code: EngineConnectorFailureCodeV1::Authentication,
            message: "authentication failed".into(),
            retryable: false,
            retry_after_ms: Some(100),
        };
        assert!(failure.validate().is_err());
    }

    #[test]
    fn declarative_definition_confines_origin_headers_and_paths() {
        let definition = DeclarativeEngineConnectorDefinitionV1 {
            definition_version: 1,
            endpoint: DeclarativeConnectorEndpointV1 {
                destination_origin: "http://127.0.0.1:43123".into(),
                url_template: "http://127.0.0.1:43123/v1/chat/completions".into(),
                method: DeclarativeConnectorHttpMethodV1::Post,
            },
            fixed_headers: vec![DeclarativeConnectorHeaderV1 {
                name: "x-client".into(),
                value: "translunar-fixture".into(),
            }],
            authentication: DeclarativeConnectorAuthenticationV1::Bearer,
            request: DeclarativeConnectorRequestMappingV1 {
                fixed_body: BTreeMap::new(),
                model_path: vec!["model".into()],
                messages_path: vec!["messages".into()],
                source_text_path: None,
                source_locale_path: None,
                target_locale_path: None,
                stream_path: Some(vec!["stream".into()]),
            },
            response: DeclarativeConnectorResponseMappingV1::ServerSentEvents {
                delta_path: vec!["choices".into(), "delta".into(), "content".into()],
                finish_reason_path: Some(vec!["choices".into(), "finish_reason".into()]),
                usage: Some(DeclarativeConnectorUsageMappingV1 {
                    input_tokens_path: Some(vec!["usage".into(), "prompt_tokens".into()]),
                    output_tokens_path: Some(vec!["usage".into(), "completion_tokens".into()]),
                    total_tokens_path: Some(vec!["usage".into(), "total_tokens".into()]),
                }),
                done_marker: "[DONE]".into(),
                max_line_bytes: 64 * 1024,
            },
            failures: vec![DeclarativeConnectorFailureMappingV1 {
                status: 429,
                code: EngineConnectorFailureCodeV1::RateLimit,
                retryable: true,
            }],
        };
        assert!(definition.validate().is_ok());
        let mut widened = definition.clone();
        widened.endpoint.url_template = "https://other.example/v1".into();
        assert!(widened.validate().is_err());
        let mut forbidden = definition;
        forbidden.fixed_headers[0].name = "Authorization".into();
        assert!(forbidden.validate().is_err());
    }
}
