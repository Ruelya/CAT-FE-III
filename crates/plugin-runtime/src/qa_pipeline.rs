//! Public, tier-neutral QA-rule and pipeline-step contract version 1.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_domain::QaSeverity;
use translunar_pipeline::ArtifactKind;
use translunar_qa_core::QaCategory;

use crate::{PluginRuntimeError, Result};

pub const QA_RULE_OPERATION_PROTOCOL_VERSION: u32 = 1;
pub const PIPELINE_STEP_OPERATION_PROTOCOL_VERSION: u32 = 1;
pub const PUBLIC_CONFIG_SCHEMA_VERSION: u32 = 1;

pub const QA_RULE_OPERATION_EVALUATE_SEGMENT: &str = "qa.evaluateSegment";
pub const QA_RULE_OPERATION_CANCEL: &str = "qa.cancel";
pub const PIPELINE_STEP_OPERATION_EXECUTE: &str = "pipeline.execute";
pub const PIPELINE_STEP_OPERATION_RESUME: &str = "pipeline.resume";
pub const PIPELINE_STEP_OPERATION_CHECKPOINT_MIGRATE: &str = "pipeline.checkpointMigrate";
pub const PIPELINE_STEP_OPERATION_CHECKPOINT: &str = "pipeline.checkpoint";
pub const PIPELINE_STEP_OPERATION_CANCEL: &str = "pipeline.cancel";

pub const MAX_PUBLIC_DESCRIPTOR_BYTES: usize = 64 * 1024;
pub const MAX_PUBLIC_CONFIG_BYTES: usize = 64 * 1024;
pub const MAX_PUBLIC_CHECKPOINT_BYTES: usize = 1024 * 1024;
pub const MAX_PUBLIC_INVOCATION_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PUBLIC_RESULT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_PUBLIC_JSON_DEPTH: usize = 16;
pub const MAX_PUBLIC_JSON_NODES: usize = 65_536;
pub const MAX_PUBLIC_COLLECTION_ITEMS: usize = 4_096;
pub const MAX_PUBLIC_TEXT_BYTES: usize = 1024 * 1024;
pub const MAX_QA_FINDINGS: usize = 1_024;
pub const MAX_QA_MESSAGE_BYTES: usize = 2_048;
pub const MAX_QA_EVIDENCE_ITEMS: usize = 128;
pub const MAX_QA_EVIDENCE_TEXT_BYTES: usize = 4_096;
pub const MAX_QA_RELATED_SEGMENTS: usize = 128;
pub const MAX_USAGE_UNITS: u64 = 1_000_000_000;
pub const MAX_OPERATION_DEADLINE_MS: u64 = 120_000;

fn invalid(message: impl Into<String>) -> PluginRuntimeError {
    PluginRuntimeError::InvalidManifest(message.into())
}

fn require_boundary_text(value: &str, label: &str, max_bytes: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.chars().any(|character| character.is_control())
    {
        return Err(invalid(format!(
            "{label} is empty, malformed, or oversized"
        )));
    }
    Ok(())
}

fn require_boundary_id(value: &str, label: &str) -> Result<()> {
    require_boundary_text(value, label, 128)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(invalid(format!("{label} contains unsupported characters")));
    }
    Ok(())
}

pub fn validate_public_json(
    value: &Value,
    label: &str,
    max_bytes: usize,
    max_depth: usize,
    max_nodes: usize,
) -> Result<()> {
    fn walk(
        value: &Value,
        depth: usize,
        max_depth: usize,
        nodes: &mut usize,
        max_nodes: usize,
    ) -> bool {
        *nodes = nodes.saturating_add(1);
        if depth > max_depth || *nodes > max_nodes {
            return false;
        }
        match value {
            Value::Array(values) => {
                values.len() <= MAX_PUBLIC_COLLECTION_ITEMS
                    && values
                        .iter()
                        .all(|value| walk(value, depth + 1, max_depth, nodes, max_nodes))
            }
            Value::Object(values) => {
                values.len() <= MAX_PUBLIC_COLLECTION_ITEMS
                    && values.iter().all(|(key, value)| {
                        key.len() <= 256
                            && !key.chars().any(char::is_control)
                            && walk(value, depth + 1, max_depth, nodes, max_nodes)
                    })
            }
            Value::String(value) => value.len() <= MAX_PUBLIC_TEXT_BYTES,
            Value::Number(value) => value.as_f64().is_some_and(f64::is_finite),
            Value::Null | Value::Bool(_) => true,
        }
    }

    let mut nodes = 0;
    if !walk(value, 0, max_depth, &mut nodes, max_nodes) {
        return Err(invalid(format!("{label} exceeds the JSON boundary limits")));
    }
    let bytes =
        serde_json::to_vec(value).map_err(|_| invalid(format!("{label} is not valid JSON")))?;
    if bytes.len() > max_bytes {
        return Err(invalid(format!("{label} exceeds {max_bytes} bytes")));
    }
    Ok(())
}

pub fn canonicalize_public_json(value: &Value) -> Result<Value> {
    validate_public_json(
        value,
        "JSON value",
        MAX_PUBLIC_RESULT_BYTES,
        MAX_PUBLIC_JSON_DEPTH,
        MAX_PUBLIC_JSON_NODES,
    )?;
    Ok(match value {
        Value::Array(values) => Value::Array(
            values
                .iter()
                .map(canonicalize_public_json)
                .collect::<Result<Vec<_>>>()?,
        ),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| Ok((key.clone(), canonicalize_public_json(value)?)))
                .collect::<Result<BTreeMap<_, _>>>()?
                .into_iter()
                .collect(),
        ),
        value => value.clone(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PublicConfigFieldTypeV1 {
    Text,
    Boolean,
    Integer,
    Number,
    Select,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicConfigOptionV1 {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicConfigFieldV1 {
    pub key: String,
    pub label: String,
    pub field_type: PublicConfigFieldTypeV1,
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<PublicConfigOptionV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicConfigSchemaV1 {
    pub schema_version: u32,
    pub fields: Vec<PublicConfigFieldV1>,
}

impl PublicConfigSchemaV1 {
    pub fn validate_definition(&self) -> Result<()> {
        if self.schema_version != PUBLIC_CONFIG_SCHEMA_VERSION {
            return Err(invalid("config schemaVersion is unsupported"));
        }
        if self.fields.len() > 128 {
            return Err(invalid("config schema has too many fields"));
        }
        let mut keys = BTreeSet::new();
        for field in &self.fields {
            require_boundary_id(&field.key, "config field key")?;
            require_boundary_text(&field.label, "config field label", 256)?;
            if !keys.insert(field.key.as_str()) {
                return Err(invalid("config schema contains duplicate field keys"));
            }
            if matches!((field.min, field.max), (Some(min), Some(max)) if min > max) {
                return Err(invalid("config field range is invalid"));
            }
            if field.options.len() > 128
                || field.options.iter().any(|option| {
                    option.value.is_empty()
                        || option.value.len() > 256
                        || option.label.is_empty()
                        || option.label.len() > 256
                })
            {
                return Err(invalid("config field options are invalid"));
            }
            let option_values = field
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<BTreeSet<_>>();
            if option_values.len() != field.options.len() {
                return Err(invalid("config field contains duplicate option values"));
            }
            if matches!(field.field_type, PublicConfigFieldTypeV1::Select)
                != !field.options.is_empty()
            {
                return Err(invalid("only select fields may define non-empty options"));
            }
            if let Some(default) = &field.default_value {
                validate_config_field(field, default)?;
            }
        }
        validate_public_json(
            &serde_json::to_value(self)?,
            "config schema",
            MAX_PUBLIC_DESCRIPTOR_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }

    pub fn validate_config(&self, value: &Value) -> Result<()> {
        self.validate_definition()?;
        validate_public_json(
            value,
            "config",
            MAX_PUBLIC_CONFIG_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )?;
        let object = value
            .as_object()
            .ok_or_else(|| invalid("config must be an object"))?;
        let fields = self
            .fields
            .iter()
            .map(|field| (field.key.as_str(), field))
            .collect::<BTreeMap<_, _>>();
        for key in object.keys() {
            if !fields.contains_key(key.as_str()) {
                return Err(invalid(format!("config contains unknown field {key}")));
            }
        }
        for field in &self.fields {
            match object.get(&field.key) {
                Some(value) => validate_config_field(field, value)?,
                None if field.required && field.default_value.is_none() => {
                    return Err(invalid(format!(
                        "config is missing required field {}",
                        field.key
                    )));
                }
                None => {}
            }
        }
        Ok(())
    }
}

fn validate_config_field(field: &PublicConfigFieldV1, value: &Value) -> Result<()> {
    let number = match field.field_type {
        PublicConfigFieldTypeV1::Text | PublicConfigFieldTypeV1::Select => {
            let text = value
                .as_str()
                .ok_or_else(|| invalid(format!("config field {} must be text", field.key)))?;
            if text.len() > 16 * 1024 {
                return Err(invalid(format!("config field {} is oversized", field.key)));
            }
            if matches!(field.field_type, PublicConfigFieldTypeV1::Select)
                && !field.options.iter().any(|option| option.value == text)
            {
                return Err(invalid(format!(
                    "config field {} has an unknown option",
                    field.key
                )));
            }
            None
        }
        PublicConfigFieldTypeV1::Boolean => {
            if !value.is_boolean() {
                return Err(invalid(format!(
                    "config field {} must be boolean",
                    field.key
                )));
            }
            None
        }
        PublicConfigFieldTypeV1::Integer => Some(
            value
                .as_i64()
                .map(|value| value as f64)
                .ok_or_else(|| invalid(format!("config field {} must be an integer", field.key)))?,
        ),
        PublicConfigFieldTypeV1::Number => Some(
            value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| invalid(format!("config field {} must be finite", field.key)))?,
        ),
        PublicConfigFieldTypeV1::Json => {
            validate_public_json(
                value,
                "config field",
                MAX_PUBLIC_CONFIG_BYTES,
                MAX_PUBLIC_JSON_DEPTH,
                MAX_PUBLIC_JSON_NODES,
            )?;
            None
        }
    };
    if let Some(number) = number
        && (field.min.is_some_and(|min| number < min as f64)
            || field.max.is_some_and(|max| number > max as f64))
    {
        return Err(invalid(format!(
            "config field {} is outside its range",
            field.key
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaRuleKindV1 {
    Mechanical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleLimitsV1 {
    pub max_findings: u32,
    pub max_message_bytes: u32,
    pub max_evidence_items: u32,
    pub max_related_segment_ids: u32,
    pub max_deadline_ms: u64,
}

impl Default for QaRuleLimitsV1 {
    fn default() -> Self {
        Self {
            max_findings: 256,
            max_message_bytes: 1_024,
            max_evidence_items: 64,
            max_related_segment_ids: 32,
            max_deadline_ms: 2_000,
        }
    }
}

impl QaRuleLimitsV1 {
    pub fn validate(&self) -> Result<()> {
        if self.max_findings == 0
            || self.max_findings as usize > MAX_QA_FINDINGS
            || self.max_message_bytes == 0
            || self.max_message_bytes as usize > MAX_QA_MESSAGE_BYTES
            || self.max_evidence_items == 0
            || self.max_evidence_items as usize > MAX_QA_EVIDENCE_ITEMS
            || self.max_related_segment_ids as usize > MAX_QA_RELATED_SEGMENTS
            || self.max_deadline_ms == 0
            || self.max_deadline_ms > MAX_OPERATION_DEADLINE_MS
        {
            return Err(invalid("QA limits are outside the public bounds"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaTagFindingV1 {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaTermExpectationV1 {
    pub id: String,
    pub source: String,
    #[serde(default)]
    pub expected_targets: Vec<String>,
    #[serde(default)]
    pub forbidden_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaSegmentContextV1 {
    pub project_id: String,
    pub document_id: String,
    pub segment_id: String,
    pub ordinal: u32,
    pub structural_path: String,
    pub source_locale: String,
    pub target_locale: String,
    pub source_text: String,
    pub target_text: String,
    #[serde(default)]
    pub tag_findings: Vec<QaTagFindingV1>,
    #[serde(default)]
    pub term_expectations: Vec<QaTermExpectationV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaRuleOperationV1 {
    EvaluateSegment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleInvocationV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub contribution_id: String,
    pub operation: QaRuleOperationV1,
    pub context: QaSegmentContextV1,
    pub config_schema_version: u32,
    pub config: Value,
    pub deadline_ms: u64,
}

impl QaRuleInvocationV1 {
    pub fn validate(&self, schema: &PublicConfigSchemaV1, limits: &QaRuleLimitsV1) -> Result<()> {
        if self.protocol_version != QA_RULE_OPERATION_PROTOCOL_VERSION
            || self.config_schema_version != schema.schema_version
            || self.deadline_ms == 0
            || self.deadline_ms > limits.max_deadline_ms
        {
            return Err(invalid(
                "QA invocation uses an unsupported version or deadline",
            ));
        }
        require_boundary_id(&self.invocation_id, "QA invocationId")?;
        require_boundary_id(&self.contribution_id, "QA contributionId")?;
        require_boundary_id(&self.context.project_id, "QA projectId")?;
        require_boundary_id(&self.context.document_id, "QA documentId")?;
        require_boundary_id(&self.context.segment_id, "QA segmentId")?;
        require_boundary_text(&self.context.structural_path, "QA structuralPath", 4_096)?;
        require_boundary_text(&self.context.source_locale, "QA sourceLocale", 64)?;
        require_boundary_text(&self.context.target_locale, "QA targetLocale", 64)?;
        if self.context.source_text.len() > MAX_PUBLIC_TEXT_BYTES
            || self.context.target_text.len() > MAX_PUBLIC_TEXT_BYTES
            || self.context.tag_findings.len() > MAX_QA_EVIDENCE_ITEMS
            || self.context.term_expectations.len() > MAX_QA_EVIDENCE_ITEMS
        {
            return Err(invalid("QA segment context exceeds public bounds"));
        }
        for finding in &self.context.tag_findings {
            require_boundary_id(&finding.code, "QA tag finding code")?;
            require_boundary_text(
                &finding.message,
                "QA tag finding message",
                MAX_QA_EVIDENCE_TEXT_BYTES,
            )?;
        }
        for term in &self.context.term_expectations {
            require_boundary_id(&term.id, "QA term expectation id")?;
            require_boundary_text(
                &term.source,
                "QA term expectation source",
                MAX_QA_EVIDENCE_TEXT_BYTES,
            )?;
            for value in term.expected_targets.iter().chain(&term.forbidden_targets) {
                if value.len() > MAX_QA_EVIDENCE_TEXT_BYTES {
                    return Err(invalid("QA term expectation text is oversized"));
                }
            }
        }
        schema.validate_config(&self.config)?;
        validate_public_json(
            &serde_json::to_value(self)?,
            "QA invocation",
            MAX_PUBLIC_INVOCATION_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum QaSpanFieldV1 {
    Source,
    Target,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaSpanV1 {
    pub field: QaSpanFieldV1,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaFindingCandidateV1 {
    pub rule_id: String,
    pub category: QaCategory,
    pub severity: QaSeverity,
    pub message: String,
    pub fingerprint: String,
    #[serde(default)]
    pub spans: Vec<QaSpanV1>,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub related_segment_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginUsageV1 {
    pub work_units: u64,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

impl PluginUsageV1 {
    pub fn validate(&self) -> Result<()> {
        if self.work_units > MAX_USAGE_UNITS
            || self.input_bytes > MAX_PUBLIC_INVOCATION_BYTES as u64
            || self.output_bytes > MAX_PUBLIC_RESULT_BYTES as u64
        {
            return Err(invalid("plugin usage exceeds public bounds"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleResultV1 {
    pub protocol_version: u32,
    pub findings: Vec<QaFindingCandidateV1>,
    pub usage: PluginUsageV1,
}

impl QaRuleResultV1 {
    pub fn validate(&self, invocation: &QaRuleInvocationV1, limits: &QaRuleLimitsV1) -> Result<()> {
        if self.protocol_version != QA_RULE_OPERATION_PROTOCOL_VERSION
            || self.findings.len() > limits.max_findings as usize
        {
            return Err(invalid(
                "QA result uses an unsupported version or finding count",
            ));
        }
        self.usage.validate()?;
        let source_len = invocation.context.source_text.chars().count() as u32;
        let target_len = invocation.context.target_text.chars().count() as u32;
        let mut identities = BTreeSet::new();
        let mut previous_key: Option<(String, String)> = None;
        for finding in &self.findings {
            require_boundary_id(&finding.rule_id, "QA finding ruleId")?;
            require_boundary_text(
                &finding.message,
                "QA finding message",
                limits.max_message_bytes as usize,
            )?;
            require_boundary_text(&finding.fingerprint, "QA finding fingerprint", 256)?;
            if !identities.insert((finding.rule_id.as_str(), finding.fingerprint.as_str())) {
                return Err(invalid("QA result contains duplicate findings"));
            }
            let key = (finding.rule_id.clone(), finding.fingerprint.clone());
            if previous_key
                .as_ref()
                .is_some_and(|previous| previous >= &key)
            {
                return Err(invalid("QA findings are not deterministically ordered"));
            }
            previous_key = Some(key);
            if finding.spans.len() > limits.max_evidence_items as usize
                || finding.evidence.len() > limits.max_evidence_items as usize
                || finding.related_segment_ids.len() > limits.max_related_segment_ids as usize
                || finding
                    .evidence
                    .iter()
                    .any(|value| value.len() > MAX_QA_EVIDENCE_TEXT_BYTES)
            {
                return Err(invalid("QA finding evidence exceeds public bounds"));
            }
            if !finding.spans.windows(2).all(|pair| pair[0] < pair[1]) {
                return Err(invalid(
                    "QA finding spans are not deterministically ordered",
                ));
            }
            for span in &finding.spans {
                let limit = match span.field {
                    QaSpanFieldV1::Source => source_len,
                    QaSpanFieldV1::Target => target_len,
                };
                if span.start >= span.end || span.end > limit {
                    return Err(invalid("QA finding span is outside the segment"));
                }
            }
            for segment_id in &finding.related_segment_ids {
                require_boundary_id(segment_id, "QA related segmentId")?;
            }
            if !finding
                .related_segment_ids
                .windows(2)
                .all(|pair| pair[0] < pair[1])
            {
                return Err(invalid(
                    "QA related segment IDs are not deterministically ordered",
                ));
            }
        }
        validate_public_json(
            &serde_json::to_value(self)?,
            "QA result",
            MAX_PUBLIC_RESULT_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QaRuleFailureCodeV1 {
    InvalidInput,
    InvalidResult,
    PermissionDenied,
    Cancelled,
    Timeout,
    HostCrash,
    Protocol,
    ResourceLimit,
    StaleActivation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRuleFailureV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub code: QaRuleFailureCodeV1,
    pub message: String,
    pub retryable: bool,
}

impl QaRuleFailureV1 {
    pub fn validate(&self) -> Result<()> {
        if self.protocol_version != QA_RULE_OPERATION_PROTOCOL_VERSION {
            return Err(invalid("QA failure protocolVersion is unsupported"));
        }
        require_boundary_id(&self.invocation_id, "QA failure invocationId")?;
        require_boundary_text(&self.message, "QA failure message", 1_024)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepLimitsV1 {
    pub max_input_bytes: u32,
    pub max_output_bytes: u32,
    pub max_config_bytes: u32,
    pub max_checkpoint_bytes: u32,
    pub max_deadline_ms: u64,
}

impl Default for PipelineStepLimitsV1 {
    fn default() -> Self {
        Self {
            max_input_bytes: 1024 * 1024,
            max_output_bytes: 1024 * 1024,
            max_config_bytes: MAX_PUBLIC_CONFIG_BYTES as u32,
            max_checkpoint_bytes: MAX_PUBLIC_CHECKPOINT_BYTES as u32,
            max_deadline_ms: 30_000,
        }
    }
}

impl PipelineStepLimitsV1 {
    pub fn validate(&self) -> Result<()> {
        if self.max_input_bytes == 0
            || self.max_input_bytes as usize > MAX_PUBLIC_INVOCATION_BYTES
            || self.max_output_bytes == 0
            || self.max_output_bytes as usize > MAX_PUBLIC_RESULT_BYTES
            || self.max_config_bytes == 0
            || self.max_config_bytes as usize > MAX_PUBLIC_CONFIG_BYTES
            || self.max_checkpoint_bytes as usize > MAX_PUBLIC_CHECKPOINT_BYTES
            || self.max_deadline_ms == 0
            || self.max_deadline_ms > MAX_OPERATION_DEADLINE_MS
        {
            return Err(invalid("pipeline limits are outside the public bounds"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineArtifactV1 {
    pub kind: ArtifactKind,
    pub value: Value,
}

impl PipelineArtifactV1 {
    pub fn validate(&self, expected: ArtifactKind, max_bytes: usize, label: &str) -> Result<()> {
        if self.kind != expected {
            return Err(invalid(format!(
                "{label} artifact kind does not match the descriptor"
            )));
        }
        validate_public_json(
            &self.value,
            label,
            max_bytes,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PipelineStepOperationV1 {
    Execute,
    Resume,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineCheckpointV1 {
    pub schema_version: u32,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepCheckpointProgressV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub contribution_id: String,
    pub checkpoint: PipelineCheckpointV1,
}

impl PipelineStepCheckpointProgressV1 {
    pub fn validate(
        &self,
        expected_invocation_id: &str,
        expected_contribution_id: &str,
        checkpoint_schema_version: Option<u32>,
        limits: &PipelineStepLimitsV1,
    ) -> Result<()> {
        if self.protocol_version != PIPELINE_STEP_OPERATION_PROTOCOL_VERSION
            || self.invocation_id != expected_invocation_id
            || self.contribution_id != expected_contribution_id
            || Some(self.checkpoint.schema_version) != checkpoint_schema_version
        {
            return Err(invalid(
                "pipeline checkpoint progress identity or schema is incompatible",
            ));
        }
        require_boundary_id(&self.invocation_id, "pipeline checkpoint invocationId")?;
        require_boundary_id(&self.contribution_id, "pipeline checkpoint contributionId")?;
        limits.validate()?;
        validate_public_json(
            &self.checkpoint.value,
            "pipeline checkpoint progress",
            limits.max_checkpoint_bytes as usize,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )?;
        validate_public_json(
            &serde_json::to_value(self)?,
            "pipeline checkpoint progress envelope",
            MAX_PUBLIC_RESULT_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepInvocationV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub contribution_id: String,
    pub operation: PipelineStepOperationV1,
    pub run_id: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    pub input: PipelineArtifactV1,
    pub config_schema_version: u32,
    pub config: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<PipelineCheckpointV1>,
    pub deadline_ms: u64,
}

impl PipelineStepInvocationV1 {
    pub fn validate(
        &self,
        input_kind: ArtifactKind,
        resumable: bool,
        checkpoint_schema_version: Option<u32>,
        schema: &PublicConfigSchemaV1,
        limits: &PipelineStepLimitsV1,
    ) -> Result<()> {
        if self.protocol_version != PIPELINE_STEP_OPERATION_PROTOCOL_VERSION
            || self.config_schema_version != schema.schema_version
            || self.deadline_ms == 0
            || self.deadline_ms > limits.max_deadline_ms
        {
            return Err(invalid(
                "pipeline invocation uses an unsupported version or deadline",
            ));
        }
        for (value, label) in [
            (&self.invocation_id, "pipeline invocationId"),
            (&self.contribution_id, "pipeline contributionId"),
            (&self.run_id, "pipeline runId"),
            (&self.project_id, "pipeline projectId"),
        ] {
            require_boundary_id(value, label)?;
        }
        if let Some(document_id) = &self.document_id {
            require_boundary_id(document_id, "pipeline documentId")?;
        }
        limits.validate()?;
        schema.validate_config(&self.config)?;
        self.input.validate(
            input_kind,
            limits.max_input_bytes as usize,
            "pipeline input",
        )?;
        match (&self.operation, &self.checkpoint) {
            (PipelineStepOperationV1::Execute, None) => {}
            (PipelineStepOperationV1::Execute, Some(_)) => {
                return Err(invalid("pipeline execute cannot include a checkpoint"));
            }
            (PipelineStepOperationV1::Resume, Some(checkpoint)) if resumable => {
                if Some(checkpoint.schema_version) != checkpoint_schema_version {
                    return Err(invalid("plugin checkpoint schema is incompatible"));
                }
                validate_public_json(
                    &checkpoint.value,
                    "pipeline checkpoint",
                    limits.max_checkpoint_bytes as usize,
                    MAX_PUBLIC_JSON_DEPTH,
                    MAX_PUBLIC_JSON_NODES,
                )?;
            }
            (PipelineStepOperationV1::Resume, _) => {
                return Err(invalid("pipeline step is not resumable"));
            }
        }
        validate_public_json(
            &serde_json::to_value(self)?,
            "pipeline invocation",
            MAX_PUBLIC_INVOCATION_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepResultV1 {
    pub protocol_version: u32,
    pub output: PipelineArtifactV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<PipelineCheckpointV1>,
    pub usage: PluginUsageV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineCheckpointMigrationInvocationV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub contribution_id: String,
    pub run_id: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    pub config_schema_version: u32,
    pub config: Value,
    pub source_checkpoint: PipelineCheckpointV1,
    pub target_checkpoint_schema_version: u32,
    pub deadline_ms: u64,
}

impl PipelineCheckpointMigrationInvocationV1 {
    pub fn validate(
        &self,
        target_checkpoint_schema_version: Option<u32>,
        schema: &PublicConfigSchemaV1,
        limits: &PipelineStepLimitsV1,
    ) -> Result<()> {
        if self.protocol_version != PIPELINE_STEP_OPERATION_PROTOCOL_VERSION
            || self.config_schema_version != schema.schema_version
            || Some(self.target_checkpoint_schema_version) != target_checkpoint_schema_version
            || self.source_checkpoint.schema_version == 0
            || self.deadline_ms == 0
            || self.deadline_ms > limits.max_deadline_ms
        {
            return Err(invalid(
                "checkpoint migration uses an unsupported version or deadline",
            ));
        }
        for (value, label) in [
            (&self.invocation_id, "checkpoint migration invocationId"),
            (&self.contribution_id, "checkpoint migration contributionId"),
            (&self.run_id, "checkpoint migration runId"),
            (&self.project_id, "checkpoint migration projectId"),
        ] {
            require_boundary_id(value, label)?;
        }
        if let Some(document_id) = &self.document_id {
            require_boundary_id(document_id, "checkpoint migration documentId")?;
        }
        limits.validate()?;
        schema.validate_config(&self.config)?;
        validate_public_json(
            &self.source_checkpoint.value,
            "source checkpoint",
            limits.max_checkpoint_bytes as usize,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )?;
        validate_public_json(
            &serde_json::to_value(self)?,
            "checkpoint migration invocation",
            MAX_PUBLIC_INVOCATION_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineCheckpointMigrationResultV1 {
    pub protocol_version: u32,
    pub checkpoint: PipelineCheckpointV1,
    pub usage: PluginUsageV1,
}

impl PipelineCheckpointMigrationResultV1 {
    pub fn validate(
        &self,
        target_checkpoint_schema_version: Option<u32>,
        limits: &PipelineStepLimitsV1,
    ) -> Result<()> {
        if self.protocol_version != PIPELINE_STEP_OPERATION_PROTOCOL_VERSION
            || Some(self.checkpoint.schema_version) != target_checkpoint_schema_version
        {
            return Err(invalid("migrated checkpoint schema is incompatible"));
        }
        self.usage.validate()?;
        validate_public_json(
            &self.checkpoint.value,
            "migrated checkpoint",
            limits.max_checkpoint_bytes as usize,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )?;
        validate_public_json(
            &serde_json::to_value(self)?,
            "checkpoint migration result",
            MAX_PUBLIC_RESULT_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

impl PipelineStepResultV1 {
    pub fn validate(
        &self,
        output_kind: ArtifactKind,
        resumable: bool,
        checkpoint_schema_version: Option<u32>,
        limits: &PipelineStepLimitsV1,
    ) -> Result<()> {
        if self.protocol_version != PIPELINE_STEP_OPERATION_PROTOCOL_VERSION {
            return Err(invalid("pipeline result protocolVersion is unsupported"));
        }
        self.output.validate(
            output_kind,
            limits.max_output_bytes as usize,
            "pipeline output",
        )?;
        self.usage.validate()?;
        match &self.checkpoint {
            None => {}
            Some(checkpoint)
                if resumable && Some(checkpoint.schema_version) == checkpoint_schema_version =>
            {
                validate_public_json(
                    &checkpoint.value,
                    "pipeline checkpoint",
                    limits.max_checkpoint_bytes as usize,
                    MAX_PUBLIC_JSON_DEPTH,
                    MAX_PUBLIC_JSON_NODES,
                )?;
            }
            Some(_) => return Err(invalid("pipeline result checkpoint is incompatible")),
        }
        validate_public_json(
            &serde_json::to_value(self)?,
            "pipeline result",
            MAX_PUBLIC_RESULT_BYTES,
            MAX_PUBLIC_JSON_DEPTH,
            MAX_PUBLIC_JSON_NODES,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStepFailureCodeV1 {
    InvalidInput,
    InvalidOutput,
    PermissionDenied,
    Cancelled,
    Timeout,
    HostCrash,
    Protocol,
    ResourceLimit,
    StaleActivation,
    StepNotResumable,
    PluginCheckpointIncompatible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepFailureV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub code: PipelineStepFailureCodeV1,
    pub message: String,
    pub retryable: bool,
}

impl PipelineStepFailureV1 {
    pub fn validate(&self) -> Result<()> {
        if self.protocol_version != PIPELINE_STEP_OPERATION_PROTOCOL_VERSION {
            return Err(invalid("pipeline failure protocolVersion is unsupported"));
        }
        require_boundary_id(&self.invocation_id, "pipeline failure invocationId")?;
        require_boundary_text(&self.message, "pipeline failure message", 1_024)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContributionCancelRequestV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
}

impl ContributionCancelRequestV1 {
    pub fn new(invocation_id: impl Into<String>) -> Self {
        Self {
            protocol_version: 1,
            invocation_id: invocation_id.into(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.protocol_version != 1 {
            return Err(invalid("cancel protocolVersion is unsupported"));
        }
        require_boundary_id(&self.invocation_id, "cancel invocationId")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContributionContractCompatibilityV1 {
    pub compatible: bool,
    pub descriptor_version_supported: bool,
    pub operation_protocol_version_supported: bool,
    pub config_schema_version_supported: bool,
    pub checkpoint_schema_version_supported: bool,
    #[serde(default)]
    pub reasons: Vec<String>,
}

impl ContributionContractCompatibilityV1 {
    pub fn inspect(
        descriptor_version: u32,
        operation_protocol_version: Option<u32>,
        config_schema_version: Option<u32>,
        checkpoint_schema_version: Option<u32>,
        resumable: bool,
    ) -> Self {
        let descriptor_version_supported = descriptor_version == 1;
        let operation_protocol_version_supported = operation_protocol_version == Some(1);
        let config_schema_version_supported = config_schema_version == Some(1);
        let checkpoint_schema_version_supported = if resumable {
            checkpoint_schema_version == Some(1)
        } else {
            checkpoint_schema_version.is_none()
        };
        let mut reasons = Vec::new();
        if !descriptor_version_supported {
            reasons.push("unsupported_descriptor_version".to_string());
        }
        if !operation_protocol_version_supported {
            reasons.push("unsupported_operation_protocol_version".to_string());
        }
        if !config_schema_version_supported {
            reasons.push("unsupported_config_schema_version".to_string());
        }
        if !checkpoint_schema_version_supported {
            reasons.push("unsupported_checkpoint_schema_version".to_string());
        }
        Self {
            compatible: reasons.is_empty(),
            descriptor_version_supported,
            operation_protocol_version_supported,
            config_schema_version_supported,
            checkpoint_schema_version_supported,
            reasons,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PluginContributionDescriptor;
    use serde_json::json;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tempfile::tempdir;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct GoldenContract {
        qa_descriptor: PluginContributionDescriptor,
        qa_invocation: QaRuleInvocationV1,
        qa_result: QaRuleResultV1,
        pipeline_descriptor: PluginContributionDescriptor,
        pipeline_invocation: PipelineStepInvocationV1,
        pipeline_result: PipelineStepResultV1,
    }

    fn empty_schema() -> PublicConfigSchemaV1 {
        PublicConfigSchemaV1 {
            schema_version: 1,
            fields: Vec::new(),
        }
    }

    fn qa_invocation() -> QaRuleInvocationV1 {
        QaRuleInvocationV1 {
            protocol_version: 1,
            invocation_id: "invoke-1".to_string(),
            contribution_id: "example.qa".to_string(),
            operation: QaRuleOperationV1::EvaluateSegment,
            context: QaSegmentContextV1 {
                project_id: "project-1".to_string(),
                document_id: "document-1".to_string(),
                segment_id: "segment-1".to_string(),
                ordinal: 0,
                structural_path: "body/p[1]".to_string(),
                source_locale: "en".to_string(),
                target_locale: "fr".to_string(),
                source_text: "Use ACME".to_string(),
                target_text: "Utiliser ACME".to_string(),
                tag_findings: Vec::new(),
                term_expectations: Vec::new(),
            },
            config_schema_version: 1,
            config: json!({}),
            deadline_ms: 1_000,
        }
    }

    #[test]
    fn qa_contract_round_trips_and_enforces_unicode_scalar_spans_and_ordering() {
        let invocation = qa_invocation();
        invocation
            .validate(&empty_schema(), &QaRuleLimitsV1::default())
            .expect("valid invocation");
        let encoded = serde_json::to_vec(&invocation).expect("encode invocation");
        assert_eq!(
            serde_json::from_slice::<QaRuleInvocationV1>(&encoded).expect("decode invocation"),
            invocation
        );
        let result = QaRuleResultV1 {
            protocol_version: 1,
            findings: vec![QaFindingCandidateV1 {
                rule_id: "brand.case".to_string(),
                category: QaCategory::Custom,
                severity: QaSeverity::Warning,
                message: "Brand spelling must remain ACME.".to_string(),
                fingerprint: "brand.case:0".to_string(),
                spans: vec![QaSpanV1 {
                    field: QaSpanFieldV1::Target,
                    start: 9,
                    end: 13,
                }],
                evidence: vec!["ACME".to_string()],
                related_segment_ids: Vec::new(),
            }],
            usage: PluginUsageV1 {
                work_units: 1,
                input_bytes: 22,
                output_bytes: 4,
            },
        };
        result
            .validate(&invocation, &QaRuleLimitsV1::default())
            .expect("valid deterministic result");

        let mut invalid = result.clone();
        invalid.findings[0].spans[0].end = 99;
        assert!(
            invalid
                .validate(&invocation, &QaRuleLimitsV1::default())
                .is_err()
        );
    }

    #[test]
    fn pipeline_resume_requires_matching_checkpoint_schema() {
        let limits = PipelineStepLimitsV1::default();
        let invocation = PipelineStepInvocationV1 {
            protocol_version: 1,
            invocation_id: "invoke-2".to_string(),
            contribution_id: "example.step".to_string(),
            operation: PipelineStepOperationV1::Resume,
            run_id: "run-1".to_string(),
            project_id: "project-1".to_string(),
            document_id: None,
            input: PipelineArtifactV1 {
                kind: ArtifactKind::Json,
                value: json!({"batch": 2}),
            },
            config_schema_version: 1,
            config: json!({}),
            checkpoint: Some(PipelineCheckpointV1 {
                schema_version: 1,
                value: json!({"cursor": 10}),
            }),
            deadline_ms: 1_000,
        };
        invocation
            .validate(ArtifactKind::Json, true, Some(1), &empty_schema(), &limits)
            .expect("compatible checkpoint");
        assert!(
            invocation
                .validate(ArtifactKind::Json, true, Some(2), &empty_schema(), &limits)
                .is_err()
        );
        assert!(
            invocation
                .validate(ArtifactKind::Json, false, None, &empty_schema(), &limits)
                .is_err()
        );
    }

    #[test]
    fn config_and_json_bounds_fail_closed() {
        let schema = PublicConfigSchemaV1 {
            schema_version: 1,
            fields: vec![PublicConfigFieldV1 {
                key: "mode".to_string(),
                label: "Mode".to_string(),
                field_type: PublicConfigFieldTypeV1::Select,
                required: true,
                default_value: None,
                min: None,
                max: None,
                options: vec![PublicConfigOptionV1 {
                    value: "strict".to_string(),
                    label: "Strict".to_string(),
                }],
            }],
        };
        schema
            .validate_config(&json!({"mode": "strict"}))
            .expect("valid config");
        assert!(schema.validate_config(&json!({"mode": "loose"})).is_err());
        assert!(
            schema
                .validate_config(&json!({"mode": "strict", "unknown": true}))
                .is_err()
        );

        let deep = json!({"a":{"b":{"c":1}}});
        assert!(validate_public_json(&deep, "deep", 1_000, 1, 100).is_err());
    }

    #[test]
    fn compatibility_reports_each_version_axis_without_execution() {
        let report =
            ContributionContractCompatibilityV1::inspect(1, Some(2), Some(1), Some(2), true);
        assert!(!report.compatible);
        assert_eq!(
            report.reasons,
            vec![
                "unsupported_operation_protocol_version",
                "unsupported_checkpoint_schema_version"
            ]
        );
    }

    #[test]
    fn unknown_envelope_fields_and_enum_values_are_rejected() {
        let unknown_field = json!({
            "protocolVersion": 1,
            "findings": [],
            "usage": {"workUnits": 0, "inputBytes": 0, "outputBytes": 0},
            "extra": true
        });
        assert!(serde_json::from_value::<QaRuleResultV1>(unknown_field).is_err());
        let unknown_failure = json!({
            "protocolVersion": 1,
            "invocationId": "invoke-1",
            "code": "surprise",
            "message": "failed",
            "retryable": false
        });
        assert!(serde_json::from_value::<QaRuleFailureV1>(unknown_failure).is_err());
    }

    #[test]
    fn shared_sdk_golden_fixture_round_trips_and_validates() {
        let golden: GoldenContract = serde_json::from_str(include_str!(
            "../../../fixtures/plugins/qa-pipeline-contract-v1.json"
        ))
        .expect("decode shared golden fixture");
        let PluginContributionDescriptor::QaRule(qa_descriptor) = &golden.qa_descriptor else {
            panic!("golden QA descriptor kind");
        };
        let PluginContributionDescriptor::PipelineStep(pipeline_descriptor) =
            &golden.pipeline_descriptor
        else {
            panic!("golden pipeline descriptor kind");
        };
        qa_descriptor
            .validate_executable_v1(crate::PluginTier::Process)
            .expect("strict QA descriptor");
        let qa_schema = qa_descriptor.config_schema.as_ref().expect("QA schema");
        let qa_limits = qa_descriptor.limits.as_ref().expect("QA limits");
        golden
            .qa_invocation
            .validate(qa_schema, qa_limits)
            .expect("QA invocation");
        golden
            .qa_result
            .validate(&golden.qa_invocation, qa_limits)
            .expect("QA result");

        pipeline_descriptor
            .validate_executable_v1(crate::PluginTier::Process)
            .expect("strict pipeline descriptor");
        let pipeline_schema = pipeline_descriptor
            .config_schema
            .as_ref()
            .expect("pipeline schema");
        let pipeline_limits = pipeline_descriptor
            .limits
            .as_ref()
            .expect("pipeline limits");
        golden
            .pipeline_invocation
            .validate(
                pipeline_descriptor
                    .input_artifact_kind()
                    .expect("input kind"),
                true,
                Some(1),
                pipeline_schema,
                pipeline_limits,
            )
            .expect("pipeline invocation");
        golden
            .pipeline_result
            .validate(
                pipeline_descriptor
                    .output_artifact_kind()
                    .expect("output kind"),
                true,
                Some(1),
                pipeline_limits,
            )
            .expect("pipeline result");

        let encoded = serde_json::to_value(&golden.qa_result).expect("encode QA result");
        assert_eq!(
            serde_json::from_value::<QaRuleResultV1>(encoded).expect("decode QA result"),
            golden.qa_result
        );
    }

    #[test]
    fn tier_three_process_dispatches_typed_calls_and_cancel_notifications() {
        let golden: GoldenContract = serde_json::from_str(include_str!(
            "../../../fixtures/plugins/qa-pipeline-contract-v1.json"
        ))
        .expect("decode shared golden fixture");
        let PluginContributionDescriptor::QaRule(qa_descriptor) = golden.qa_descriptor else {
            panic!("golden QA descriptor kind");
        };
        let PluginContributionDescriptor::PipelineStep(pipeline_descriptor) =
            golden.pipeline_descriptor
        else {
            panic!("golden pipeline descriptor kind");
        };
        let contributions = serde_json::to_string(&vec![
            PluginContributionDescriptor::QaRule(qa_descriptor.clone()),
            PluginContributionDescriptor::PipelineStep(pipeline_descriptor.clone()),
        ])
        .expect("encode contributions");
        let qa_result = serde_json::to_string(&golden.qa_result).expect("encode QA result");
        let pipeline_result =
            serde_json::to_string(&golden.pipeline_result).expect("encode pipeline result");
        let migration_invocation = PipelineCheckpointMigrationInvocationV1 {
            protocol_version: 1,
            invocation_id: "migration-1".to_string(),
            contribution_id: pipeline_descriptor.id.clone(),
            run_id: golden.pipeline_invocation.run_id.clone(),
            project_id: golden.pipeline_invocation.project_id.clone(),
            document_id: golden.pipeline_invocation.document_id.clone(),
            config_schema_version: 1,
            config: golden.pipeline_invocation.config.clone(),
            source_checkpoint: PipelineCheckpointV1 {
                schema_version: 2,
                value: json!({ "cursor": 2 }),
            },
            target_checkpoint_schema_version: 1,
            deadline_ms: 1_000,
        };
        let migration_result = PipelineCheckpointMigrationResultV1 {
            protocol_version: 1,
            checkpoint: PipelineCheckpointV1 {
                schema_version: 1,
                value: json!({ "cursor": 2 }),
            },
            usage: PluginUsageV1 {
                work_units: 1,
                input_bytes: 8,
                output_bytes: 8,
            },
        };
        migration_invocation
            .validate(
                pipeline_descriptor.checkpoint_schema_version,
                pipeline_descriptor
                    .config_schema
                    .as_ref()
                    .expect("pipeline config schema"),
                pipeline_descriptor
                    .limits
                    .as_ref()
                    .expect("pipeline limits"),
            )
            .expect("migration invocation");
        let migration_result_json =
            serde_json::to_string(&migration_result).expect("encode migration result");
        let script = format!(
            r#"import {{ createInterface }} from "node:readline";
const contributions = {contributions};
const qaResult = {qa_result};
const pipelineResult = {pipeline_result};
const migrationResult = {migration_result_json};
const cancelled = [];
const write = value => process.stdout.write(`${{JSON.stringify(value)}}\n`);
createInterface({{ input: process.stdin, crlfDelay: Infinity }}).on("line", line => {{
  const request = JSON.parse(line);
  if (request.method === "qa.cancel" || request.method === "pipeline.cancel") {{
    cancelled.push(request.params.invocationId);
    return;
  }}
  let result;
  if (request.method === "plugin.handshake") result = {{ apiVersion: 1, pluginId: "example.public-process", contributions }};
  else if (request.method === "qa.evaluateSegment") result = qaResult;
  else if (request.method === "pipeline.resume") {{
    write({{ jsonrpc: "2.0", method: "pipeline.checkpoint", params: {{
      protocolVersion: 1,
      invocationId: request.params.invocationId,
      contributionId: request.params.contributionId,
      checkpoint: pipelineResult.checkpoint
    }} }});
    result = pipelineResult;
  }}
  else if (request.method === "pipeline.checkpointMigrate") result = migrationResult;
  else if (request.method === "fixture.cancelled") result = cancelled;
  else if (request.method === "plugin.shutdown") result = {{}};
  else throw new Error(`unexpected method ${{request.method}}`);
  write({{ jsonrpc: "2.0", id: request.id, result }});
}});
"#
        );
        let directory = tempdir().expect("process fixture directory");
        fs::write(directory.path().join("entry.mjs"), script).expect("write process fixture");
        let manifest = crate::PluginManifest {
            manifest_version: crate::MANIFEST_VERSION_V1,
            id: "example.public-process".to_string(),
            display_name: "Public process".to_string(),
            version: "1.0.0".to_string(),
            api_version: crate::HOST_API_VERSION,
            api_version_min: crate::HOST_API_VERSION,
            tier: crate::PluginTier::Process,
            entry: crate::PluginEntry {
                kind: crate::PluginEntryKind::Node,
                path: "entry.mjs".to_string(),
            },
            contributions: crate::PluginContributions {
                filters: Vec::new(),
            },
            permissions: Vec::new(),
            capabilities: Vec::new(),
        };
        let process = crate::PluginProcess::new_with_public_descriptors(
            directory.path().to_path_buf(),
            manifest,
            Vec::new(),
            vec![qa_descriptor],
            vec![pipeline_descriptor],
        );
        assert_eq!(
            process
                .call_qa_rule(&golden.qa_invocation, Duration::from_secs(2))
                .expect("QA process call"),
            golden.qa_result
        );
        let checkpoints = Arc::new(Mutex::new(Vec::new()));
        let received = Arc::clone(&checkpoints);
        assert_eq!(
            process
                .call_pipeline_step_with_checkpoints(
                    &golden.pipeline_invocation,
                    Duration::from_secs(2),
                    move |progress| {
                        received
                            .lock()
                            .expect("checkpoint capture")
                            .push(progress.checkpoint.value);
                        Ok(())
                    },
                )
                .expect("pipeline process call"),
            golden.pipeline_result
        );
        assert_eq!(
            process
                .call_pipeline_checkpoint_migration(&migration_invocation, Duration::from_secs(2),)
                .expect("pipeline checkpoint migration"),
            migration_result
        );
        assert_eq!(
            *checkpoints.lock().expect("checkpoint results"),
            vec![json!({ "cursor": 2 })]
        );
        process
            .cancel_qa_rule("qa-cancel-1")
            .expect("QA cancel notification");
        process
            .cancel_pipeline_step("pipeline-cancel-1")
            .expect("pipeline cancel notification");
        let cancelled: Vec<String> = process
            .call("fixture.cancelled", json!({}), Duration::from_secs(2))
            .expect("read cancellations");
        assert_eq!(cancelled, vec!["qa-cancel-1", "pipeline-cancel-1"]);
        process.stop();
    }
}
