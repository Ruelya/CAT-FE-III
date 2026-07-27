//! Typed pipeline definitions, step registry, and durable run state rules.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock, atomic::AtomicBool};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactKind {
    None,
    Project,
    Document,
    Segments,
    QaFindings,
    Json,
}

pub const MAX_PIPELINE_CONFIG_BYTES: usize = 64 * 1024;
pub const MAX_PIPELINE_INPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PIPELINE_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_PIPELINE_JSON_DEPTH: usize = 16;
pub const MAX_PIPELINE_JSON_NODES: usize = 65_536;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StepDescriptor {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub input: ArtifactKind,
    pub output: ArtifactKind,
    pub config_schema_version: u32,
    pub resumable: bool,
    pub cancellable: bool,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum PluginPipelineTier {
    Declarative,
    Sandbox,
    Process,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum PipelineStepOwner {
    Builtin,
    Plugin {
        plugin_id: String,
        version_id: String,
        activation_revision: u64,
        contribution_id: String,
        contribution_version: String,
        descriptor_version: u32,
        operation_protocol_version: u32,
        config_schema_version: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        checkpoint_schema_version: Option<u32>,
        tier: PluginPipelineTier,
        descriptor_hash: String,
    },
}

impl PipelineStepOwner {
    pub fn plugin_id(&self) -> Option<&str> {
        match self {
            Self::Builtin => None,
            Self::Plugin { plugin_id, .. } => Some(plugin_id),
        }
    }

    pub fn activation_revision(&self) -> Option<u64> {
        match self {
            Self::Builtin => None,
            Self::Plugin {
                activation_revision,
                ..
            } => Some(*activation_revision),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepBinding {
    pub descriptor: StepDescriptor,
    pub owner: PipelineStepOwner,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepDefinition {
    pub key: String,
    pub step_id: String,
    #[serde(default)]
    pub config: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinition {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub name: String,
    pub version: u32,
    pub revision: u64,
    pub steps: Vec<PipelineStepDefinition>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PipelineRunStatus {
    Queued,
    Running,
    Canceling,
    Canceled,
    Interrupted,
    Succeeded,
    Failed,
}

impl PipelineRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Canceled | Self::Succeeded | Self::Failed)
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Queued, Self::Running)
                | (Self::Queued, Self::Canceling)
                | (Self::Running, Self::Succeeded)
                | (Self::Running, Self::Failed)
                | (Self::Running, Self::Canceling)
                | (Self::Running, Self::Interrupted)
                | (Self::Canceling, Self::Canceled)
                | (Self::Canceling, Self::Failed)
                | (Self::Canceling, Self::Interrupted)
                | (Self::Interrupted, Self::Queued)
                | (Self::Interrupted, Self::Failed)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PipelineStepStatus {
    Pending,
    Running,
    Canceled,
    Interrupted,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRun {
    pub id: String,
    pub definition_id: String,
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    pub status: PipelineRunStatus,
    pub revision: u64,
    pub current_step_index: u32,
    pub step_count: u32,
    pub cancellation_requested: bool,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default)]
    pub error: Option<PipelineFailure>,
    pub created_at_ms: i64,
    #[serde(default)]
    pub started_at_ms: Option<i64>,
    #[serde(default)]
    pub completed_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepRun {
    pub id: String,
    pub run_id: String,
    pub step_key: String,
    pub step_id: String,
    pub step_index: u32,
    pub status: PipelineStepStatus,
    pub revision: u64,
    #[serde(default)]
    pub input: Option<Value>,
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default)]
    pub checkpoint: Option<Value>,
    #[serde(default)]
    pub usage: Option<Value>,
    #[serde(default)]
    pub error: Option<PipelineFailure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_binding: Option<PipelineStepPluginBinding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_plugin_attempt: Option<PipelineStepPluginAttempt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_checkpoint: Option<PipelineStepCheckpointMetadata>,
    #[serde(default)]
    pub started_at_ms: Option<i64>,
    #[serde(default)]
    pub completed_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepPluginBinding {
    pub owner: PipelineStepOwner,
    pub config_hash: String,
    pub created_at_ms: i64,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum PipelineStepPluginOperation {
    Execute,
    Resume,
    CheckpointMigrate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepPluginAttempt {
    pub id: String,
    pub attempt_index: u32,
    pub operation: PipelineStepPluginOperation,
    pub input_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_input_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_output_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_schema_version: Option<u32>,
    #[serde(default)]
    pub usage: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<PipelineFailure>,
    pub started_at_ms: i64,
    pub completed_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PipelineStepCheckpointMetadata {
    pub sequence: u32,
    pub schema_version: u32,
    pub checkpoint_hash: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone)]
pub struct StepExecutionContext {
    pub run_id: String,
    pub project_id: String,
    pub document_id: Option<String>,
    pub input: Value,
    pub config: Value,
    pub checkpoint: Option<Value>,
    pub deadline_ms: u64,
    pub cancellation: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
pub struct StepCheckpointMigrationContext {
    pub run_id: String,
    pub project_id: String,
    pub document_id: Option<String>,
    pub config: Value,
    pub checkpoint: Value,
    pub source_schema_version: u32,
    pub target_schema_version: u32,
    pub deadline_ms: u64,
    pub cancellation: Arc<AtomicBool>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StepCheckpointMigrationOutcome {
    pub checkpoint: Value,
    pub usage: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StepOutcome {
    pub output: Value,
    pub checkpoint: Option<Value>,
    pub usage: Option<Value>,
}

#[derive(Clone)]
pub struct StepCheckpointSink {
    publish: Arc<dyn Fn(Value) -> Result<(), PipelineError> + Send + Sync>,
}

impl std::fmt::Debug for StepCheckpointSink {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StepCheckpointSink")
            .finish_non_exhaustive()
    }
}

impl StepCheckpointSink {
    pub fn new(
        publish: impl Fn(Value) -> Result<(), PipelineError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            publish: Arc::new(publish),
        }
    }

    pub fn publish(&self, checkpoint: Value) -> Result<(), PipelineError> {
        (self.publish)(checkpoint)
    }
}

pub trait PipelineStep: Send + Sync {
    fn descriptor(&self) -> StepDescriptor;

    fn validate_config(&self, config: &Value) -> Result<(), PipelineError> {
        validate_pipeline_json(config, "pipeline config", MAX_PIPELINE_CONFIG_BYTES)
    }

    fn validate_input(&self, input: &Value) -> Result<(), PipelineError> {
        validate_pipeline_json(input, "pipeline input", MAX_PIPELINE_INPUT_BYTES)
    }

    fn validate_output(&self, output: &Value) -> Result<(), PipelineError> {
        validate_pipeline_json(output, "pipeline output", MAX_PIPELINE_OUTPUT_BYTES)
    }

    fn execute_with_checkpoint_sink(
        &self,
        context: StepExecutionContext,
        _checkpoint_sink: Option<StepCheckpointSink>,
    ) -> Result<StepOutcome, PipelineError> {
        self.execute(context)
    }

    fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError>;

    fn migrate_checkpoint(
        &self,
        _context: StepCheckpointMigrationContext,
    ) -> Result<StepCheckpointMigrationOutcome, PipelineError> {
        Err(PipelineError::Plugin(PipelineFailure {
            code: "plugin_checkpoint_incompatible".to_string(),
            message: "the plugin has no checkpoint migration handler".to_string(),
            retryable: false,
        }))
    }
}

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("pipeline definition is invalid: {0}")]
    InvalidDefinition(String),
    #[error("pipeline registry error: {0}")]
    Registry(String),
    #[error("pipeline step not found: {0}")]
    UnknownStep(String),
    #[error("pipeline transition is invalid: {from:?} -> {to:?}")]
    InvalidTransition {
        from: PipelineRunStatus,
        to: PipelineRunStatus,
    },
    #[error("pipeline execution failed: {0}")]
    Execution(String),
    #[error("pipeline boundary rejected: {0}")]
    Boundary(String),
    #[error("pipeline plugin step failed: {0:?}")]
    Plugin(PipelineFailure),
    #[error("pipeline step activation is stale")]
    StaleActivation,
    #[error("pipeline execution was canceled")]
    Canceled,
}

#[derive(Clone)]
pub struct StepRegistry {
    steps: Arc<RwLock<BTreeMap<String, RegisteredPipelineStep>>>,
}

#[derive(Clone)]
struct RegisteredPipelineStep {
    binding: PipelineStepBinding,
    step: Arc<dyn PipelineStep>,
}

#[derive(Clone)]
pub struct ResolvedPipelineStep {
    binding: PipelineStepBinding,
    step: Arc<dyn PipelineStep>,
}

impl std::fmt::Debug for ResolvedPipelineStep {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResolvedPipelineStep")
            .field("binding", &self.binding)
            .finish_non_exhaustive()
    }
}

impl ResolvedPipelineStep {
    pub fn binding(&self) -> &PipelineStepBinding {
        &self.binding
    }

    pub fn descriptor(&self) -> &StepDescriptor {
        &self.binding.descriptor
    }

    pub fn step(&self) -> &Arc<dyn PipelineStep> {
        &self.step
    }
}

impl Default for StepRegistry {
    fn default() -> Self {
        Self {
            steps: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }
}

impl StepRegistry {
    pub fn register(&mut self, step: Arc<dyn PipelineStep>) -> Result<(), PipelineError> {
        self.register_owned(step, PipelineStepOwner::Builtin)
    }

    pub fn register_plugin(
        &mut self,
        step: Arc<dyn PipelineStep>,
        owner: PipelineStepOwner,
    ) -> Result<(), PipelineError> {
        if !matches!(owner, PipelineStepOwner::Plugin { .. }) {
            return Err(PipelineError::Registry(
                "plugin registration requires a plugin owner".to_string(),
            ));
        }
        self.register_owned(step, owner)
    }

    fn register_owned(
        &self,
        step: Arc<dyn PipelineStep>,
        owner: PipelineStepOwner,
    ) -> Result<(), PipelineError> {
        let descriptor = step.descriptor();
        if descriptor.id.trim().is_empty() {
            return Err(PipelineError::Registry(
                "step id must not be empty".to_string(),
            ));
        }
        if matches!(owner, PipelineStepOwner::Plugin { .. })
            && descriptor.id.starts_with("builtin.")
        {
            return Err(PipelineError::Registry(
                "plugin step id must not use the builtin. prefix".to_string(),
            ));
        }
        let mut steps = self
            .steps
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if steps.contains_key(&descriptor.id) {
            return Err(PipelineError::Registry(format!(
                "step id already registered: {}",
                descriptor.id
            )));
        }
        steps.insert(
            descriptor.id.clone(),
            RegisteredPipelineStep {
                binding: PipelineStepBinding { descriptor, owner },
                step,
            },
        );
        Ok(())
    }

    pub fn resolve(&self, id: &str) -> Result<Arc<dyn PipelineStep>, PipelineError> {
        Ok(self.resolve_binding(id)?.step)
    }

    pub fn resolve_binding(&self, id: &str) -> Result<ResolvedPipelineStep, PipelineError> {
        self.steps
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(id)
            .cloned()
            .map(|registered| ResolvedPipelineStep {
                binding: registered.binding,
                step: registered.step,
            })
            .ok_or_else(|| PipelineError::UnknownStep(id.to_string()))
    }

    pub fn unregister(&self, id: &str) -> Result<Arc<dyn PipelineStep>, PipelineError> {
        self.steps
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(id)
            .map(|registered| registered.step)
            .ok_or_else(|| PipelineError::UnknownStep(id.to_string()))
    }

    pub fn unregister_binding(
        &self,
        binding: &PipelineStepBinding,
    ) -> Result<Arc<dyn PipelineStep>, PipelineError> {
        let mut steps = self
            .steps
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(registered) = steps.get(&binding.descriptor.id) else {
            return Err(PipelineError::UnknownStep(binding.descriptor.id.clone()));
        };
        if registered.binding != *binding {
            return Err(PipelineError::StaleActivation);
        }
        Ok(steps
            .remove(&binding.descriptor.id)
            .expect("binding was checked while holding the registry lock")
            .step)
    }

    pub fn unregister_plugin_generation(
        &self,
        plugin_id: &str,
        activation_revision: u64,
    ) -> Vec<PipelineStepOwner> {
        let mut steps = self
            .steps
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ids = steps
            .iter()
            .filter_map(|(id, registered)| match &registered.binding.owner {
                PipelineStepOwner::Plugin {
                    plugin_id: owner_plugin_id,
                    activation_revision: owner_revision,
                    ..
                } if owner_plugin_id == plugin_id && *owner_revision == activation_revision => {
                    Some(id.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        ids.into_iter()
            .filter_map(|id| steps.remove(&id).map(|registered| registered.binding.owner))
            .collect()
    }

    pub fn contains(&self, id: &str) -> bool {
        self.steps
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(id)
    }

    pub fn is_current(&self, binding: &PipelineStepBinding) -> bool {
        self.steps
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&binding.descriptor.id)
            .is_some_and(|registered| registered.binding == *binding)
    }

    pub fn descriptors(&self) -> Vec<StepDescriptor> {
        self.steps
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .map(|registered| registered.binding.descriptor.clone())
            .collect()
    }

    pub fn bindings(&self) -> Vec<PipelineStepBinding> {
        self.steps
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .map(|registered| registered.binding.clone())
            .collect()
    }

    pub fn validate_definition(
        &self,
        definition: &PipelineDefinition,
    ) -> Result<(), PipelineError> {
        if definition.name.trim().is_empty() {
            return Err(PipelineError::InvalidDefinition(
                "name must not be empty".to_string(),
            ));
        }
        if definition.steps.is_empty() {
            return Err(PipelineError::InvalidDefinition(
                "at least one step is required".to_string(),
            ));
        }
        let mut keys = BTreeSet::new();
        let mut previous_output: Option<ArtifactKind> = None;
        for (index, step) in definition.steps.iter().enumerate() {
            if step.key.trim().is_empty() || !keys.insert(step.key.clone()) {
                return Err(PipelineError::InvalidDefinition(format!(
                    "step key must be non-empty and unique: {}",
                    step.key
                )));
            }
            let registered = self.resolve_binding(&step.step_id)?;
            let descriptor = registered.descriptor();
            registered.step().validate_config(&step.config)?;
            if let Some(output) = previous_output
                && descriptor.input != ArtifactKind::None
                && descriptor.input != ArtifactKind::Json
                && descriptor.input != output
            {
                return Err(PipelineError::InvalidDefinition(format!(
                    "step {index} ({}) expects {:?}, previous step emits {:?}",
                    descriptor.id, descriptor.input, output
                )));
            }
            previous_output = Some(descriptor.output);
        }
        Ok(())
    }
}

pub fn validate_pipeline_json(
    value: &Value,
    label: &str,
    max_bytes: usize,
) -> Result<(), PipelineError> {
    fn walk(value: &Value, depth: usize, nodes: &mut usize, max_bytes: usize) -> bool {
        if depth > MAX_PIPELINE_JSON_DEPTH || *nodes >= MAX_PIPELINE_JSON_NODES {
            return false;
        }
        *nodes += 1;
        match value {
            Value::Array(values) => values
                .iter()
                .all(|value| walk(value, depth + 1, nodes, max_bytes)),
            Value::Object(values) => values
                .iter()
                .all(|(key, value)| key.len() <= 512 && walk(value, depth + 1, nodes, max_bytes)),
            Value::String(value) => value.len() <= max_bytes,
            Value::Null | Value::Bool(_) | Value::Number(_) => true,
        }
    }

    let bytes = serde_json::to_vec(value)
        .map_err(|_| PipelineError::Boundary(format!("{label} is not valid JSON")))?;
    let mut nodes = 0;
    if bytes.len() > max_bytes || !walk(value, 0, &mut nodes, max_bytes) {
        return Err(PipelineError::Boundary(format!(
            "{label} exceeds its size or structure limit"
        )));
    }
    Ok(())
}

pub fn ensure_run_transition(
    current: PipelineRunStatus,
    next: PipelineRunStatus,
) -> Result<(), PipelineError> {
    if current.can_transition_to(next) {
        Ok(())
    } else {
        Err(PipelineError::InvalidTransition {
            from: current,
            to: next,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoStep {
        descriptor: StepDescriptor,
    }

    impl PipelineStep for EchoStep {
        fn descriptor(&self) -> StepDescriptor {
            self.descriptor.clone()
        }

        fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError> {
            Ok(StepOutcome {
                output: context.input,
                checkpoint: context.checkpoint,
                usage: None,
            })
        }
    }

    fn step(id: &str, input: ArtifactKind, output: ArtifactKind) -> Arc<dyn PipelineStep> {
        Arc::new(EchoStep {
            descriptor: StepDescriptor {
                id: id.to_string(),
                version: "1".to_string(),
                display_name: id.to_string(),
                input,
                output,
                config_schema_version: 1,
                resumable: true,
                cancellable: true,
            },
        })
    }

    fn definition(steps: Vec<PipelineStepDefinition>) -> PipelineDefinition {
        PipelineDefinition {
            id: "pipeline-1".to_string(),
            project_id: None,
            name: "test".to_string(),
            version: 1,
            revision: 0,
            steps,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    fn plugin_owner(activation_revision: u64) -> PipelineStepOwner {
        PipelineStepOwner::Plugin {
            plugin_id: "example.plugin".to_string(),
            version_id: format!("version:{activation_revision}"),
            activation_revision,
            contribution_id: "example.step".to_string(),
            contribution_version: format!("{activation_revision}.0.0"),
            descriptor_version: 1,
            operation_protocol_version: 1,
            config_schema_version: 1,
            checkpoint_schema_version: Some(1),
            tier: PluginPipelineTier::Sandbox,
            descriptor_hash: format!("{activation_revision:064x}"),
        }
    }

    #[test]
    fn plugin_owner_uses_camel_case_wire_fields() {
        let value = serde_json::to_value(plugin_owner(7)).expect("serialize plugin owner");
        assert_eq!(value["kind"], "plugin");
        assert_eq!(value["pluginId"], "example.plugin");
        assert_eq!(value["versionId"], "version:7");
        assert_eq!(value["activationRevision"], 7);
        assert!(value.get("plugin_id").is_none());
    }

    #[test]
    fn validates_step_keys_and_artifact_flow() {
        let mut registry = StepRegistry::default();
        registry
            .register(step("import", ArtifactKind::None, ArtifactKind::Document))
            .expect("register import");
        registry
            .register(step("qa", ArtifactKind::Document, ArtifactKind::QaFindings))
            .expect("register qa");
        registry
            .validate_definition(&definition(vec![
                PipelineStepDefinition {
                    key: "load".to_string(),
                    step_id: "import".to_string(),
                    config: Value::Null,
                },
                PipelineStepDefinition {
                    key: "check".to_string(),
                    step_id: "qa".to_string(),
                    config: Value::Null,
                },
            ]))
            .expect("valid pipeline");
    }

    #[test]
    fn rejects_duplicates_and_incompatible_artifacts() {
        let mut registry = StepRegistry::default();
        registry
            .register(step("project", ArtifactKind::None, ArtifactKind::Project))
            .expect("register project");
        assert!(
            registry
                .register(step("project", ArtifactKind::None, ArtifactKind::Project))
                .is_err()
        );
        registry
            .register(step("qa", ArtifactKind::Document, ArtifactKind::QaFindings))
            .expect("register qa");
        let error = registry
            .validate_definition(&definition(vec![
                PipelineStepDefinition {
                    key: "one".to_string(),
                    step_id: "project".to_string(),
                    config: Value::Null,
                },
                PipelineStepDefinition {
                    key: "two".to_string(),
                    step_id: "qa".to_string(),
                    config: Value::Null,
                },
            ]))
            .expect_err("incompatible artifacts");
        assert!(matches!(error, PipelineError::InvalidDefinition(_)));
    }

    #[test]
    fn unregister_removes_only_the_requested_step() {
        let mut registry = StepRegistry::default();
        registry
            .register(step("first", ArtifactKind::Json, ArtifactKind::Json))
            .expect("register first");
        registry
            .register(step("second", ArtifactKind::Json, ArtifactKind::Json))
            .expect("register second");
        assert!(registry.contains("first"));
        assert_eq!(
            registry
                .unregister("first")
                .expect("unregister first")
                .descriptor()
                .id,
            "first"
        );
        assert!(!registry.contains("first"));
        assert!(registry.contains("second"));
        assert!(registry.unregister("first").is_err());
    }

    #[test]
    fn plugin_bindings_are_generation_exact_and_shared_across_clones() {
        let mut registry = StepRegistry::default();
        let clone = registry.clone();
        let owner_v1 = plugin_owner(1);
        registry
            .register_plugin(
                step("example.step", ArtifactKind::Json, ArtifactKind::Json),
                owner_v1,
            )
            .expect("register plugin generation");
        let v1 = clone
            .resolve_binding("example.step")
            .expect("shared registry sees plugin step");
        let mut wrong_binding = v1.binding().clone();
        wrong_binding.owner = plugin_owner(2);
        assert!(matches!(
            registry.unregister_binding(&wrong_binding),
            Err(PipelineError::StaleActivation)
        ));
        registry
            .unregister_binding(v1.binding())
            .expect("detach exact generation");
        registry
            .register_plugin(
                step("example.step", ArtifactKind::Json, ArtifactKind::Json),
                plugin_owner(2),
            )
            .expect("register replacement generation");
        assert!(!clone.is_current(v1.binding()));
        assert_eq!(
            clone
                .resolve_binding("example.step")
                .expect("replacement is visible")
                .binding()
                .owner
                .activation_revision(),
            Some(2)
        );
    }

    #[test]
    fn definition_validation_rejects_structurally_unbounded_config() {
        let mut registry = StepRegistry::default();
        registry
            .register(step("bounded", ArtifactKind::Json, ArtifactKind::Json))
            .expect("register bounded step");
        let mut config = Value::Null;
        for _ in 0..=MAX_PIPELINE_JSON_DEPTH {
            config = serde_json::json!({ "nested": config });
        }
        let error = registry
            .validate_definition(&definition(vec![PipelineStepDefinition {
                key: "bounded".to_string(),
                step_id: "bounded".to_string(),
                config,
            }]))
            .expect_err("deep config must fail");
        assert!(matches!(error, PipelineError::Boundary(_)));
    }

    #[test]
    fn run_state_machine_is_explicit() {
        assert!(
            ensure_run_transition(PipelineRunStatus::Queued, PipelineRunStatus::Running).is_ok()
        );
        assert!(
            ensure_run_transition(PipelineRunStatus::Running, PipelineRunStatus::Interrupted)
                .is_ok()
        );
        assert!(
            ensure_run_transition(PipelineRunStatus::Interrupted, PipelineRunStatus::Queued)
                .is_ok()
        );
        assert!(
            ensure_run_transition(PipelineRunStatus::Succeeded, PipelineRunStatus::Running)
                .is_err()
        );
    }
}
