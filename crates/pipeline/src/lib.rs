//! Typed pipeline definitions, step registry, and durable run state rules.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, atomic::AtomicBool};

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
    #[serde(default)]
    pub started_at_ms: Option<i64>,
    #[serde(default)]
    pub completed_at_ms: Option<i64>,
    pub updated_at_ms: i64,
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
    pub cancellation: Arc<AtomicBool>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StepOutcome {
    pub output: Value,
    pub checkpoint: Option<Value>,
    pub usage: Option<Value>,
}

pub trait PipelineStep: Send + Sync {
    fn descriptor(&self) -> StepDescriptor;
    fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError>;
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
    #[error("pipeline execution was canceled")]
    Canceled,
}

#[derive(Default, Clone)]
pub struct StepRegistry {
    steps: BTreeMap<String, Arc<dyn PipelineStep>>,
}

impl StepRegistry {
    pub fn register(&mut self, step: Arc<dyn PipelineStep>) -> Result<(), PipelineError> {
        let descriptor = step.descriptor();
        if descriptor.id.trim().is_empty() {
            return Err(PipelineError::Registry(
                "step id must not be empty".to_string(),
            ));
        }
        if self.steps.contains_key(&descriptor.id) {
            return Err(PipelineError::Registry(format!(
                "step id already registered: {}",
                descriptor.id
            )));
        }
        self.steps.insert(descriptor.id, step);
        Ok(())
    }

    pub fn resolve(&self, id: &str) -> Result<Arc<dyn PipelineStep>, PipelineError> {
        self.steps
            .get(id)
            .cloned()
            .ok_or_else(|| PipelineError::UnknownStep(id.to_string()))
    }

    pub fn unregister(&mut self, id: &str) -> Result<Arc<dyn PipelineStep>, PipelineError> {
        self.steps
            .remove(id)
            .ok_or_else(|| PipelineError::UnknownStep(id.to_string()))
    }

    pub fn contains(&self, id: &str) -> bool {
        self.steps.contains_key(id)
    }

    pub fn descriptors(&self) -> Vec<StepDescriptor> {
        self.steps.values().map(|step| step.descriptor()).collect()
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
            let descriptor = self.resolve(&step.step_id)?.descriptor();
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
