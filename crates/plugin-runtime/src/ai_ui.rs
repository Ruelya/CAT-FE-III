//! Public Tier 2 AI-action and isolated workbench-panel contract version 1.

use std::collections::BTreeSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ContributionContractCompatibilityV1, PluginRuntimeError, PluginTier, PublicConfigSchemaV1,
    Result, canonicalize_public_json, validate_public_json,
};

pub const AI_ACTION_OPERATION_PROTOCOL_VERSION: u32 = 1;
pub const AI_ACTION_CONFIG_SCHEMA_VERSION: u32 = 1;
pub const UI_PANEL_CONTRACT_VERSION: u32 = 1;
pub const UI_PANEL_BRIDGE_VERSION: u32 = 1;
pub const AI_ACTION_OPERATION_INVOKE: &str = "ai.action.invoke";
pub const MAX_AI_ACTION_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_AI_ACTION_OUTPUT_BYTES: usize = 1024 * 1024;
pub const MAX_AI_ACTION_TAGS: usize = 1_024;
pub const MAX_AI_ACTION_DEADLINE_MS: u64 = 120_000;
pub const MAX_PANEL_METHODS: usize = 16;

fn invalid(message: impl Into<String>) -> PluginRuntimeError {
    PluginRuntimeError::InvalidManifest(message.into())
}

fn require_id(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(invalid(format!(
            "{label} is empty, malformed, or oversized"
        )));
    }
    Ok(())
}

fn require_text(value: &str, label: &str, max_bytes: usize) -> Result<()> {
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

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AiActionPlacementV1 {
    EditorSelection,
    AssistantSidebar,
}

impl AiActionPlacementV1 {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "editorSelection" => Ok(Self::EditorSelection),
            "assistantSidebar" => Ok(Self::AssistantSidebar),
            _ => Err(invalid("AI action placement is unsupported")),
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AiActionInputFieldV1 {
    SelectionText,
    SegmentText,
    SourceText,
    SourceLocale,
    TargetLocale,
    Tags,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AiActionResultModeV1 {
    ReplaceSelection,
    ReplaceTarget,
    AssistantContent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionLimitsV1 {
    pub max_input_bytes: u32,
    pub max_output_bytes: u32,
    pub max_tags: u32,
    pub max_deadline_ms: u64,
}

impl Default for AiActionLimitsV1 {
    fn default() -> Self {
        Self {
            max_input_bytes: 256 * 1024,
            max_output_bytes: 256 * 1024,
            max_tags: 256,
            max_deadline_ms: 10_000,
        }
    }
}

impl AiActionLimitsV1 {
    pub fn validate(&self) -> Result<()> {
        if self.max_input_bytes == 0
            || self.max_input_bytes as usize > MAX_AI_ACTION_INPUT_BYTES
            || self.max_output_bytes == 0
            || self.max_output_bytes as usize > MAX_AI_ACTION_OUTPUT_BYTES
            || self.max_tags as usize > MAX_AI_ACTION_TAGS
            || self.max_deadline_ms == 0
            || self.max_deadline_ms > MAX_AI_ACTION_DEADLINE_MS
        {
            return Err(invalid("AI action limits are outside the public bounds"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub label: String,
    /// Kept as text so released inventory-only descriptors remain readable.
    pub placement: String,
    /// Legacy inventory metadata. Executable V1 descriptors still carry an object here.
    pub input: Value,
    #[serde(default)]
    pub prompt_template: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_protocol_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_fields: Vec<AiActionInputFieldV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub result_modes: Vec<AiActionResultModeV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<PublicConfigSchemaV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<AiActionLimitsV1>,
}

impl AiActionContributionDescriptor {
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
        if tier != PluginTier::Sandbox || !self.contract_compatibility().compatible {
            return Err(PluginRuntimeError::CapabilityUnsupported(format!(
                "AI action contribution {} does not implement the Tier 2 public V1 contract",
                self.id
            )));
        }
        AiActionPlacementV1::parse(&self.placement)?;
        if self.input_fields.is_empty()
            || self.result_modes.is_empty()
            || self.input_fields.len() > 16
            || self.result_modes.len() > 3
            || self.input_fields.iter().collect::<BTreeSet<_>>().len() != self.input_fields.len()
            || self.result_modes.iter().collect::<BTreeSet<_>>().len() != self.result_modes.len()
        {
            return Err(invalid(
                "AI action fields and result modes must be non-empty closed sets",
            ));
        }
        validate_public_json(
            &self.input,
            "AI action input descriptor",
            64 * 1024,
            16,
            4_096,
        )?;
        if !self.prompt_template.is_empty() {
            require_text(&self.prompt_template, "AI action promptTemplate", 16 * 1024)?;
        }
        self.config_schema
            .as_ref()
            .ok_or_else(|| invalid("AI action config schema is missing"))?
            .validate_definition()?;
        self.limits
            .as_ref()
            .ok_or_else(|| invalid("AI action limits are missing"))?
            .validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionTagV1 {
    pub id: String,
    pub kind: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionContextV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_text: Option<String>,
    pub segment_text: String,
    pub source_text: String,
    pub source_locale: String,
    pub target_locale: String,
    #[serde(default)]
    pub tags: Vec<AiActionTagV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionInvocationV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub contribution_id: String,
    pub operation: String,
    pub context: AiActionContextV1,
    pub config_schema_version: u32,
    pub config: Value,
    pub deadline_ms: u64,
}

impl AiActionInvocationV1 {
    pub fn validate(&self, descriptor: &AiActionContributionDescriptor) -> Result<()> {
        descriptor.validate_executable_v1(PluginTier::Sandbox)?;
        require_id(&self.invocation_id, "AI action invocationId")?;
        if self.protocol_version != AI_ACTION_OPERATION_PROTOCOL_VERSION
            || self.operation != AI_ACTION_OPERATION_INVOKE
            || self.contribution_id != descriptor.id
            || self.config_schema_version != AI_ACTION_CONFIG_SCHEMA_VERSION
        {
            return Err(invalid("AI action invocation contract is incompatible"));
        }
        let limits = descriptor
            .limits
            .as_ref()
            .ok_or_else(|| invalid("AI action limits are missing"))?;
        if self.deadline_ms == 0 || self.deadline_ms > limits.max_deadline_ms {
            return Err(invalid("AI action deadline is outside descriptor limits"));
        }
        let context = serde_json::to_value(&self.context)?;
        validate_public_json(
            &context,
            "AI action context",
            limits.max_input_bytes as usize,
            16,
            8_192,
        )?;
        if self.context.tags.len() > limits.max_tags as usize {
            return Err(invalid("AI action context contains too many tags"));
        }
        for tag in &self.context.tags {
            require_id(&tag.id, "AI action tag id")?;
            require_text(&tag.kind, "AI action tag kind", 128)?;
            if tag.end < tag.start {
                return Err(invalid("AI action tag range is invalid"));
            }
        }
        descriptor
            .config_schema
            .as_ref()
            .ok_or_else(|| invalid("AI action config schema is missing"))?
            .validate_config(&self.config)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AiActionProposalV1 {
    ReplaceSelection { text: String },
    ReplaceTarget { text: String },
    AssistantContent { content: String },
}

impl AiActionProposalV1 {
    pub fn mode(&self) -> AiActionResultModeV1 {
        match self {
            Self::ReplaceSelection { .. } => AiActionResultModeV1::ReplaceSelection,
            Self::ReplaceTarget { .. } => AiActionResultModeV1::ReplaceTarget,
            Self::AssistantContent { .. } => AiActionResultModeV1::AssistantContent,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionUsageV1 {
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionResultV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub proposal: AiActionProposalV1,
    pub usage: AiActionUsageV1,
}

impl AiActionResultV1 {
    pub fn validate(
        &self,
        invocation: &AiActionInvocationV1,
        descriptor: &AiActionContributionDescriptor,
    ) -> Result<Value> {
        if self.protocol_version != AI_ACTION_OPERATION_PROTOCOL_VERSION
            || self.invocation_id != invocation.invocation_id
            || !descriptor.result_modes.contains(&self.proposal.mode())
        {
            return Err(invalid("AI action result contract is incompatible"));
        }
        match &self.proposal {
            AiActionProposalV1::ReplaceSelection { text }
            | AiActionProposalV1::ReplaceTarget { text } => {
                require_text(text, "AI action text proposal", MAX_AI_ACTION_OUTPUT_BYTES)?;
            }
            AiActionProposalV1::AssistantContent { content } => {
                require_text(
                    content,
                    "AI action assistant proposal",
                    MAX_AI_ACTION_OUTPUT_BYTES,
                )?;
            }
        }
        let limits = descriptor
            .limits
            .as_ref()
            .ok_or_else(|| invalid("AI action limits are missing"))?;
        if self.usage.input_bytes > u64::from(limits.max_input_bytes)
            || self.usage.output_bytes > u64::from(limits.max_output_bytes)
            || self.usage.duration_ms > limits.max_deadline_ms
        {
            return Err(invalid("AI action usage is outside descriptor limits"));
        }
        let value = serde_json::to_value(self)?;
        validate_public_json(
            &value,
            "AI action result",
            limits.max_output_bytes as usize,
            16,
            8_192,
        )?;
        canonicalize_public_json(&value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AiActionFailureCodeV1 {
    InvalidRequest,
    PermissionDenied,
    Timeout,
    Cancelled,
    InvalidResult,
    HostFailed,
    StaleActivation,
    ProtocolError,
    ResourceLimit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiActionFailureV1 {
    pub protocol_version: u32,
    pub invocation_id: String,
    pub code: AiActionFailureCodeV1,
    pub message: String,
    pub retryable: bool,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum UiPanelPlacementV1 {
    EditorSidebar,
    AssistantSidebar,
    BottomPanel,
}

impl UiPanelPlacementV1 {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "editorSidebar" => Ok(Self::EditorSidebar),
            "assistantSidebar" => Ok(Self::AssistantSidebar),
            "bottomPanel" => Ok(Self::BottomPanel),
            _ => Err(invalid("UI panel placement is unsupported")),
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum UiPanelBridgeMethodV1 {
    PanelContext,
    ActiveSelection,
    ProjectContext,
    ProposeReplacement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPanelContributionDescriptor {
    pub descriptor_version: u32,
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub label: String,
    /// Kept as text so released inventory-only descriptors remain readable.
    pub placement: String,
    pub surface: String,
    pub bridge_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub methods: Vec<UiPanelBridgeMethodV1>,
    #[serde(default)]
    pub order: i32,
}

impl UiPanelContributionDescriptor {
    pub fn is_executable_v1(&self, tier: PluginTier) -> bool {
        self.validate_executable_v1(tier).is_ok()
    }

    pub fn validate_executable_v1(&self, tier: PluginTier) -> Result<()> {
        if tier != PluginTier::Sandbox
            || self.descriptor_version != 1
            || self.contract_version != Some(UI_PANEL_CONTRACT_VERSION)
            || self.bridge_version != UI_PANEL_BRIDGE_VERSION
        {
            return Err(PluginRuntimeError::CapabilityUnsupported(format!(
                "UI panel contribution {} does not implement the Tier 2 public V1 contract",
                self.id
            )));
        }
        UiPanelPlacementV1::parse(&self.placement)?;
        require_text(&self.surface, "UI panel surface", 512)?;
        if self.surface.starts_with('/')
            || !self.surface.ends_with(".html")
            || self.surface.contains(':')
            || self.surface.split('/').any(|component| component == "..")
        {
            return Err(invalid(
                "UI panel surface must be a package-relative HTML path",
            ));
        }
        if !(0..=1_000_000).contains(&self.order) {
            return Err(invalid("UI panel order is outside the public bounds"));
        }
        if self.methods.is_empty()
            || self.methods.len() > MAX_PANEL_METHODS
            || self.methods.iter().collect::<BTreeSet<_>>().len() != self.methods.len()
            || !self.methods.contains(&UiPanelBridgeMethodV1::PanelContext)
        {
            return Err(invalid("UI panel bridge methods are invalid"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn schema() -> PublicConfigSchemaV1 {
        PublicConfigSchemaV1 {
            schema_version: 1,
            fields: Vec::new(),
        }
    }

    fn descriptor() -> AiActionContributionDescriptor {
        AiActionContributionDescriptor {
            descriptor_version: 1,
            id: "example.terminology".to_string(),
            version: "1.0.0".to_string(),
            display_name: "Terminology rewrite".to_string(),
            label: "Rewrite terminology".to_string(),
            placement: "editorSelection".to_string(),
            input: json!({"type":"object"}),
            prompt_template: String::new(),
            operation_protocol_version: Some(1),
            input_fields: vec![
                AiActionInputFieldV1::SelectionText,
                AiActionInputFieldV1::SourceLocale,
                AiActionInputFieldV1::TargetLocale,
            ],
            result_modes: vec![AiActionResultModeV1::ReplaceSelection],
            config_schema_version: Some(1),
            config_schema: Some(schema()),
            limits: Some(AiActionLimitsV1::default()),
        }
    }

    fn invocation() -> AiActionInvocationV1 {
        AiActionInvocationV1 {
            protocol_version: 1,
            invocation_id: "invoke-1".to_string(),
            contribution_id: "example.terminology".to_string(),
            operation: AI_ACTION_OPERATION_INVOKE.to_string(),
            context: AiActionContextV1 {
                selection_text: Some("colour".to_string()),
                segment_text: "colour".to_string(),
                source_text: "colour".to_string(),
                source_locale: "en-GB".to_string(),
                target_locale: "en-US".to_string(),
                tags: Vec::new(),
            },
            config_schema_version: 1,
            config: json!({}),
            deadline_ms: 1_000,
        }
    }

    #[test]
    fn executable_action_round_trips_and_returns_only_declared_proposals() {
        let descriptor = descriptor();
        descriptor
            .validate_executable_v1(PluginTier::Sandbox)
            .expect("strict descriptor");
        let invocation = invocation();
        invocation.validate(&descriptor).expect("strict invocation");
        let result = AiActionResultV1 {
            protocol_version: 1,
            invocation_id: invocation.invocation_id.clone(),
            proposal: AiActionProposalV1::ReplaceSelection {
                text: "color".to_string(),
            },
            usage: AiActionUsageV1 {
                input_bytes: 6,
                output_bytes: 5,
                duration_ms: 4,
            },
        };
        result
            .validate(&invocation, &descriptor)
            .expect("declared proposal");

        let mut undeclared = result;
        undeclared.proposal = AiActionProposalV1::AssistantContent {
            content: "color".to_string(),
        };
        assert!(undeclared.validate(&invocation, &descriptor).is_err());
    }

    #[test]
    fn legacy_and_unknown_action_contracts_remain_readable_but_not_executable() {
        let legacy: AiActionContributionDescriptor = serde_json::from_value(json!({
            "descriptorVersion": 1,
            "id": "example.legacy",
            "version": "1.0.0",
            "displayName": "Legacy action",
            "label": "Explain",
            "placement": "selection",
            "input": {"type":"string"}
        }))
        .expect("legacy inventory");
        assert!(!legacy.contract_compatibility().compatible);
        assert!(legacy.validate_executable_v1(PluginTier::Sandbox).is_err());

        let mut invalid = descriptor();
        invalid.placement = "floatingWindow".to_string();
        assert!(invalid.validate_executable_v1(PluginTier::Sandbox).is_err());
        invalid = descriptor();
        invalid
            .input_fields
            .push(AiActionInputFieldV1::SelectionText);
        assert!(invalid.validate_executable_v1(PluginTier::Sandbox).is_err());
    }

    #[test]
    fn panel_contract_is_closed_versioned_and_tier_two_only() {
        let panel = UiPanelContributionDescriptor {
            descriptor_version: 1,
            id: "example.panel".to_string(),
            version: "1.0.0".to_string(),
            display_name: "Terminology".to_string(),
            label: "Terminology".to_string(),
            placement: "editorSidebar".to_string(),
            surface: "panel/index.html".to_string(),
            bridge_version: 1,
            contract_version: Some(1),
            methods: vec![
                UiPanelBridgeMethodV1::PanelContext,
                UiPanelBridgeMethodV1::ActiveSelection,
            ],
            order: 10,
        };
        panel
            .validate_executable_v1(PluginTier::Sandbox)
            .expect("strict panel");
        assert!(panel.validate_executable_v1(PluginTier::Process).is_err());
        let mut escaping = panel;
        escaping.surface = "../index.html".to_string();
        assert!(
            escaping
                .validate_executable_v1(PluginTier::Sandbox)
                .is_err()
        );
    }

    #[test]
    fn invocation_and_result_reject_unknown_fields_and_bounds() {
        let descriptor = descriptor();
        let mut oversized_invocation = invocation();
        oversized_invocation.context.tags = (0..257)
            .map(|index| AiActionTagV1 {
                id: format!("tag-{index}"),
                kind: "placeholder".to_string(),
                start: index,
                end: index + 1,
            })
            .collect();
        assert!(oversized_invocation.validate(&descriptor).is_err());

        let mut invalid_range = invocation();
        invalid_range.context.tags.push(AiActionTagV1 {
            id: "tag-1".to_string(),
            kind: "placeholder".to_string(),
            start: 4,
            end: 3,
        });
        assert!(invalid_range.validate(&descriptor).is_err());

        let invalid_result = AiActionResultV1 {
            protocol_version: 1,
            invocation_id: "invoke-1".to_string(),
            proposal: AiActionProposalV1::ReplaceSelection {
                text: String::new(),
            },
            usage: AiActionUsageV1 {
                input_bytes: 0,
                output_bytes: 0,
                duration_ms: 0,
            },
        };
        assert!(invalid_result.validate(&invocation(), &descriptor).is_err());

        let mut invalid_usage = invalid_result;
        invalid_usage.proposal = AiActionProposalV1::ReplaceSelection {
            text: "valid".to_string(),
        };
        invalid_usage.usage.output_bytes = u64::from(
            descriptor
                .limits
                .as_ref()
                .expect("fixture limits")
                .max_output_bytes,
        ) + 1;
        assert!(invalid_usage.validate(&invocation(), &descriptor).is_err());

        assert!(
            serde_json::from_value::<AiActionFailureV1>(json!({
                "protocolVersion": 1,
                "invocationId": "invoke-1",
                "code": "timeout",
                "message": "timed out",
                "retryable": true,
                "payload": "must not leak"
            }))
            .is_err()
        );
    }
}
