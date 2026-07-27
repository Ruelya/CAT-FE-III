use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use regex::{Regex, RegexBuilder};
use serde_json::Value;
use translunar_pipeline::{
    PipelineError, PipelineFailure, PipelineStep, StepCheckpointMigrationContext,
    StepCheckpointMigrationOutcome, StepCheckpointSink, StepDescriptor, StepExecutionContext,
    StepOutcome,
};
use translunar_plugin_runtime::{
    DeclarativePipelineDefinitionV1, DeclarativePipelineOperation, PipelineArtifactV1,
    PipelineCheckpointMigrationInvocationV1, PipelineCheckpointMigrationResultV1,
    PipelineCheckpointV1, PipelineStepCheckpointProgressV1, PipelineStepContributionDescriptor,
    PipelineStepInvocationV1, PipelineStepLimitsV1, PipelineStepOperationV1, PipelineStepResultV1,
    PluginCapabilityAuthorizer, PluginCapabilityCheck, PluginCapabilityId, PluginCapabilityScope,
    PluginProcess, PluginRuntimeError, PluginTier, PublicConfigSchemaV1,
    QA_RULE_OPERATION_EVALUATE_SEGMENT, QA_RULE_OPERATION_PROTOCOL_VERSION, QaFindingCandidateV1,
    QaRuleContributionDescriptor, QaRuleInvocationV1, QaRuleLimitsV1, QaRuleOperationV1,
    QaRuleResultV1, QaSegmentContextV1, QaSpanFieldV1, QaTagFindingV1, QaTermExpectationV1,
    SANDBOX_PROTOCOL_VERSION, SandboxCancellationToken, SandboxError, SandboxInvocationV1,
    SandboxResultV1, SandboxWorkerHandle,
};
use translunar_qa_core::{
    CompiledQaProfile, QaCandidateEvidence, QaFindingCandidate, QaProfileDefinition,
    QaRuleExecutionUsage, QaRuleSettings, QaSpan,
};
use uuid::Uuid;

use crate::PluginPipelineCheckpointRouter;
use crate::qa::{
    QaRuleExecutor, QaRuleExecutorFailure, QaRuleExecutorOutput, namespace_plugin_qa_rule_id,
};

const MAX_PIPELINE_JSON_DEPTH: usize = 16;
const PROCESS_CONTRIBUTION_CANCEL_GRACE: Duration = Duration::from_millis(100);

fn recycle_process_after_cancel_grace(finished: &AtomicBool, process: &PluginProcess) {
    let deadline = Instant::now() + PROCESS_CONTRIBUTION_CANCEL_GRACE;
    while !finished.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    if !finished.load(Ordering::Acquire) {
        process.stop();
    }
}

#[derive(Clone)]
struct PublicPluginQaContract {
    plugin_id: String,
    version_id: String,
    contribution_id: String,
    schema: PublicConfigSchemaV1,
    limits: QaRuleLimitsV1,
    config: Value,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl std::fmt::Debug for PublicPluginQaContract {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PublicPluginQaContract")
            .field("plugin_id", &self.plugin_id)
            .field("version_id", &self.version_id)
            .field("contribution_id", &self.contribution_id)
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

impl PublicPluginQaContract {
    fn new(
        plugin_id: &str,
        version_id: &str,
        descriptor: &QaRuleContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        tier: PluginTier,
    ) -> Result<Self, PluginRuntimeError> {
        descriptor.validate_executable_v1(tier)?;
        let schema = match descriptor.config_schema.clone() {
            Some(schema) => schema,
            None if tier == PluginTier::Declarative => PublicConfigSchemaV1 {
                schema_version: descriptor.config_schema_version.unwrap_or(1),
                fields: Vec::new(),
            },
            None => {
                return Err(PluginRuntimeError::InvalidManifest(
                    "QA config schema is missing".to_string(),
                ));
            }
        };
        let limits = match descriptor.limits.clone() {
            Some(limits) => limits,
            None if tier == PluginTier::Declarative => QaRuleLimitsV1::default(),
            None => {
                return Err(PluginRuntimeError::InvalidManifest(
                    "QA limits are missing".to_string(),
                ));
            }
        };
        let config = descriptor
            .config
            .clone()
            .unwrap_or_else(|| Value::Object(Default::default()));
        schema.validate_config(&config)?;
        Ok(Self {
            plugin_id: plugin_id.to_string(),
            version_id: version_id.to_string(),
            contribution_id: descriptor.id.clone(),
            schema,
            limits,
            config,
            authorizer,
        })
    }

    fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.plugin_id.clone(),
                version_id: self.version_id.clone(),
                capability_id: PluginCapabilityId::QaRegister,
                scope: PluginCapabilityScope::Contributions {
                    contribution_ids: vec![self.contribution_id.clone()],
                },
                operation: "qa.execute".to_string(),
                contribution_id: Some(self.contribution_id.clone()),
            })
            .map_err(|_| QaRuleExecutorFailure::failed("plugin_permission_denied", false))
    }

    fn invocation(
        &self,
        segment: &translunar_qa_core::QaExecutionSegment,
    ) -> std::result::Result<QaRuleInvocationV1, QaRuleExecutorFailure> {
        let invocation = QaRuleInvocationV1 {
            protocol_version: QA_RULE_OPERATION_PROTOCOL_VERSION,
            invocation_id: Uuid::now_v7().to_string(),
            contribution_id: self.contribution_id.clone(),
            operation: QaRuleOperationV1::EvaluateSegment,
            context: QaSegmentContextV1 {
                project_id: segment.project_id.clone(),
                document_id: segment.document_id.clone(),
                segment_id: segment.input.segment_id.clone(),
                ordinal: segment.ordinal,
                structural_path: segment.structural_path.clone(),
                source_locale: segment.input.source_locale.clone(),
                target_locale: segment.input.target_locale.clone(),
                source_text: segment.input.source_text.clone(),
                target_text: segment.input.target_text.clone(),
                tag_findings: segment
                    .input
                    .tag_findings
                    .iter()
                    .map(|finding| QaTagFindingV1 {
                        code: finding.code.clone(),
                        message: finding.message.clone(),
                    })
                    .collect(),
                term_expectations: segment
                    .input
                    .terms
                    .iter()
                    .map(|term| QaTermExpectationV1 {
                        id: term.id.clone(),
                        source: term.source_term.clone(),
                        expected_targets: term.preferred_targets.clone(),
                        forbidden_targets: term.forbidden_targets.clone(),
                    })
                    .collect(),
            },
            config_schema_version: self.schema.schema_version,
            config: self.config.clone(),
            deadline_ms: self.limits.max_deadline_ms,
        };
        invocation
            .validate(&self.schema, &self.limits)
            .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_request", false))?;
        Ok(invocation)
    }

    fn output(
        &self,
        invocation: &QaRuleInvocationV1,
        result: QaRuleResultV1,
    ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
        result
            .validate(invocation, &self.limits)
            .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_result", false))?;
        let candidates = result
            .findings
            .into_iter()
            .map(|finding| self.candidate(&invocation.context.segment_id, finding))
            .collect::<Vec<_>>();
        Ok(QaRuleExecutorOutput {
            candidates,
            usage: QaRuleExecutionUsage {
                work_units: result.usage.work_units,
                input_bytes: result.usage.input_bytes,
                output_bytes: result.usage.output_bytes,
            },
        })
    }

    fn candidate(&self, segment_id: &str, finding: QaFindingCandidateV1) -> QaFindingCandidate {
        let mut evidence = QaCandidateEvidence {
            target_values: finding.evidence,
            related_segment_ids: finding.related_segment_ids,
            ..QaCandidateEvidence::default()
        };
        for span in finding.spans {
            let field = span.field;
            let converted = QaSpan {
                start: span.start,
                end: span.end,
            };
            match field {
                QaSpanFieldV1::Source => evidence.source_spans.push(converted),
                QaSpanFieldV1::Target => evidence.target_spans.push(converted),
            }
        }
        QaFindingCandidate {
            segment_id: segment_id.to_string(),
            rule_id: namespace_plugin_qa_rule_id(
                &self.plugin_id,
                &self.version_id,
                &self.contribution_id,
                &finding.rule_id,
            ),
            category: finding.category,
            severity: finding.severity,
            message: finding.message,
            fingerprint: finding.fingerprint,
            evidence,
        }
    }
}

#[derive(Debug)]
pub(crate) struct DeclarativePluginQaRule {
    contract: PublicPluginQaContract,
    compiled: CompiledQaProfile,
    canceled: AtomicBool,
    rule_ids: Vec<String>,
}

impl DeclarativePluginQaRule {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        descriptor: &QaRuleContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> Result<Self, PluginRuntimeError> {
        let contract = PublicPluginQaContract::new(
            plugin_id,
            version_id,
            descriptor,
            authorizer,
            PluginTier::Declarative,
        )?;
        let definition = descriptor.declarative.as_ref().ok_or_else(|| {
            PluginRuntimeError::InvalidManifest("declarative QA definition is missing".to_string())
        })?;
        let mut rules = definition.rules.clone();
        for rule in &mut rules {
            rule.id = namespace_plugin_qa_rule_id(plugin_id, version_id, &descriptor.id, &rule.id);
        }
        let rule_ids = rules
            .iter()
            .map(|rule| format!("qa.regex:{}", rule.id))
            .collect::<Vec<_>>();
        let compiled = CompiledQaProfile::compile(QaProfileDefinition {
            id: format!("runtime.qa.{}", descriptor.id),
            name: descriptor.display_name.clone(),
            enabled_rule_ids: rule_ids.iter().cloned().collect(),
            severity_overrides: Default::default(),
            settings: QaRuleSettings::default(),
            regex_rules: rules,
        })
        .map_err(|error| PluginRuntimeError::InvalidManifest(error.to_string()))?;
        Ok(Self {
            contract,
            compiled,
            canceled: AtomicBool::new(false),
            rule_ids,
        })
    }

    pub(crate) fn rule_ids(&self) -> &[String] {
        &self.rule_ids
    }
}

impl QaRuleExecutor for DeclarativePluginQaRule {
    fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
        self.contract.authorize()
    }

    fn evaluate_segment(
        &self,
        segment: &translunar_qa_core::QaExecutionSegment,
    ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
        self.authorize()?;
        if self.canceled.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::canceled());
        }
        let invocation = self.contract.invocation(segment)?;
        let started = Instant::now();
        let mut candidates = self.compiled.evaluate_segment(&segment.input);
        candidates.sort_by(|left, right| {
            left.rule_id
                .cmp(&right.rule_id)
                .then_with(|| left.fingerprint.cmp(&right.fingerprint))
        });
        if self.canceled.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::canceled());
        }
        if started.elapsed() > Duration::from_millis(invocation.deadline_ms) {
            return Err(QaRuleExecutorFailure::failed("plugin_timeout", true));
        }
        let input_bytes = serde_json::to_vec(&invocation)
            .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_request", false))?
            .len() as u64;
        let output_bytes = serde_json::to_vec(&candidates)
            .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_result", false))?
            .len() as u64;
        Ok(QaRuleExecutorOutput {
            candidates,
            usage: QaRuleExecutionUsage {
                work_units: 1,
                input_bytes,
                output_bytes,
            },
        })
    }

    fn cancel(&self) {
        self.canceled.store(true, Ordering::Release);
    }
}

#[derive(Debug)]
pub(crate) struct SandboxPluginQaRule {
    contract: PublicPluginQaContract,
    worker: SandboxWorkerHandle,
    canceled: Arc<AtomicBool>,
}

impl SandboxPluginQaRule {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        descriptor: &QaRuleContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        worker: SandboxWorkerHandle,
    ) -> Result<Self, PluginRuntimeError> {
        Ok(Self {
            contract: PublicPluginQaContract::new(
                plugin_id,
                version_id,
                descriptor,
                authorizer,
                PluginTier::Sandbox,
            )?,
            worker,
            canceled: Arc::new(AtomicBool::new(false)),
        })
    }
}

impl QaRuleExecutor for SandboxPluginQaRule {
    fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
        self.contract.authorize()
    }

    fn evaluate_segment(
        &self,
        segment: &translunar_qa_core::QaExecutionSegment,
    ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
        self.authorize()?;
        if self.canceled.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::canceled());
        }
        let invocation = self.contract.invocation(segment)?;
        let sandbox_invocation = SandboxInvocationV1 {
            protocol_version: SANDBOX_PROTOCOL_VERSION,
            invocation_id: invocation.invocation_id.clone(),
            contribution_id: invocation.contribution_id.clone(),
            operation: QA_RULE_OPERATION_EVALUATE_SEGMENT.to_string(),
            input: serde_json::to_value(&invocation)
                .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_request", false))?,
        };
        let token = SandboxCancellationToken::default();
        let finished = AtomicBool::new(false);
        let timed_out = AtomicBool::new(false);
        let result = std::thread::scope(|scope| {
            let monitor_finished = &finished;
            let monitor_timeout = &timed_out;
            let cancellation = Arc::clone(&self.canceled);
            let monitor_token = token.clone();
            let deadline = Duration::from_millis(invocation.deadline_ms);
            scope.spawn(move || {
                let started = Instant::now();
                while !monitor_finished.load(Ordering::Acquire) {
                    if cancellation.load(Ordering::Acquire) {
                        monitor_token.cancel();
                        break;
                    }
                    if started.elapsed() >= deadline {
                        monitor_timeout.store(true, Ordering::Release);
                        monitor_token.cancel();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
            let result = self
                .worker
                .invoke_with_cancellation(sandbox_invocation, token);
            finished.store(true, Ordering::Release);
            result
        });
        if self.canceled.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::canceled());
        }
        if timed_out.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::failed("plugin_timeout", true));
        }
        let envelope = result.map_err(map_sandbox_qa_error)?;
        if !envelope.ok {
            return Err(QaRuleExecutorFailure::failed(
                "plugin_rule_failed",
                envelope.error.is_some_and(|error| error.retryable),
            ));
        }
        let result = serde_json::from_value::<QaRuleResultV1>(
            envelope
                .output
                .ok_or_else(|| QaRuleExecutorFailure::failed("plugin_invalid_result", false))?,
        )
        .map_err(|_| QaRuleExecutorFailure::failed("plugin_invalid_result", false))?;
        self.contract.output(&invocation, result)
    }

    fn cancel(&self) {
        self.canceled.store(true, Ordering::Release);
    }
}

#[derive(Debug)]
pub(crate) struct ProcessPluginQaRule {
    contract: PublicPluginQaContract,
    process: Arc<PluginProcess>,
    canceled: Arc<AtomicBool>,
}

impl ProcessPluginQaRule {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        descriptor: &QaRuleContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        process: Arc<PluginProcess>,
    ) -> Result<Self, PluginRuntimeError> {
        Ok(Self {
            contract: PublicPluginQaContract::new(
                plugin_id,
                version_id,
                descriptor,
                authorizer,
                PluginTier::Process,
            )?,
            process,
            canceled: Arc::new(AtomicBool::new(false)),
        })
    }
}

impl QaRuleExecutor for ProcessPluginQaRule {
    fn authorize(&self) -> std::result::Result<(), QaRuleExecutorFailure> {
        self.contract.authorize()
    }

    fn evaluate_segment(
        &self,
        segment: &translunar_qa_core::QaExecutionSegment,
    ) -> std::result::Result<QaRuleExecutorOutput, QaRuleExecutorFailure> {
        self.authorize()?;
        if self.canceled.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::canceled());
        }
        let invocation = self.contract.invocation(segment)?;
        let finished = AtomicBool::new(false);
        let result = std::thread::scope(|scope| {
            let monitor_finished = &finished;
            let cancellation = Arc::clone(&self.canceled);
            let process = Arc::clone(&self.process);
            let invocation_id = invocation.invocation_id.clone();
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if cancellation.load(Ordering::Acquire) {
                        let _ = process.cancel_qa_rule(&invocation_id);
                        recycle_process_after_cancel_grace(monitor_finished, &process);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
            let result = self
                .process
                .call_qa_rule(&invocation, Duration::from_millis(invocation.deadline_ms));
            finished.store(true, Ordering::Release);
            result
        });
        if self.canceled.load(Ordering::Acquire) {
            return Err(QaRuleExecutorFailure::canceled());
        }
        self.contract
            .output(&invocation, result.map_err(map_process_qa_error)?)
    }

    fn cancel(&self) {
        self.canceled.store(true, Ordering::Release);
    }
}

fn map_sandbox_qa_error(error: SandboxError) -> QaRuleExecutorFailure {
    match error {
        SandboxError::Cancelled => QaRuleExecutorFailure::canceled(),
        SandboxError::Timeout => QaRuleExecutorFailure::failed("plugin_timeout", true),
        SandboxError::ResourceLimit { .. } | SandboxError::QueueFull => {
            QaRuleExecutorFailure::failed("plugin_resource_limit", false)
        }
        SandboxError::HostCallDenied { .. } => {
            QaRuleExecutorFailure::failed("plugin_permission_denied", false)
        }
        SandboxError::Disconnected | SandboxError::NotReady => {
            QaRuleExecutorFailure::failed("plugin_host_crash", true)
        }
        _ => QaRuleExecutorFailure::failed("plugin_protocol", false),
    }
}

fn map_process_qa_error(error: PluginRuntimeError) -> QaRuleExecutorFailure {
    match error {
        PluginRuntimeError::PermissionDenied(_) => {
            QaRuleExecutorFailure::failed("plugin_permission_denied", false)
        }
        PluginRuntimeError::Timeout(_) => QaRuleExecutorFailure::failed("plugin_timeout", true),
        PluginRuntimeError::Process(_) | PluginRuntimeError::Io(_) => {
            QaRuleExecutorFailure::failed("plugin_host_crash", true)
        }
        PluginRuntimeError::Protocol(_)
        | PluginRuntimeError::Json(_)
        | PluginRuntimeError::Remote(_) => QaRuleExecutorFailure::failed("plugin_protocol", false),
        _ => QaRuleExecutorFailure::failed("plugin_invalid_request", false),
    }
}

#[derive(Debug, Clone)]
enum CompiledOperation {
    Select {
        path: Vec<String>,
    },
    Set {
        path: Vec<String>,
        value: Value,
    },
    Assert {
        path: Vec<String>,
        equals: Value,
    },
    RegexReplace {
        path: Vec<String>,
        pattern: Regex,
        replacement: String,
        max_replacements: usize,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct DeclarativePipelineStep {
    plugin_id: String,
    version_id: String,
    contribution_id: String,
    descriptor: StepDescriptor,
    operations: Vec<CompiledOperation>,
    max_input_bytes: u64,
    max_output_bytes: u64,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl DeclarativePipelineStep {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        contribution_id: &str,
        descriptor: StepDescriptor,
        definition: &DeclarativePipelineDefinitionV1,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> Result<Self, PipelineError> {
        definition
            .validate()
            .map_err(|error| PipelineError::InvalidDefinition(error.to_string()))?;
        let operations = definition
            .operations
            .iter()
            .map(|operation| match operation {
                DeclarativePipelineOperation::Select { path } => {
                    Ok(CompiledOperation::Select { path: path.clone() })
                }
                DeclarativePipelineOperation::Set { path, value } => Ok(CompiledOperation::Set {
                    path: path.clone(),
                    value: value.clone(),
                }),
                DeclarativePipelineOperation::Assert { path, equals } => {
                    Ok(CompiledOperation::Assert {
                        path: path.clone(),
                        equals: equals.clone(),
                    })
                }
                DeclarativePipelineOperation::RegexReplace {
                    path,
                    pattern,
                    replacement,
                    max_replacements,
                } => Ok(CompiledOperation::RegexReplace {
                    path: path.clone(),
                    pattern: RegexBuilder::new(pattern)
                        .size_limit(1 << 20)
                        .dfa_size_limit(1 << 20)
                        .build()
                        .map_err(|error| PipelineError::InvalidDefinition(error.to_string()))?,
                    replacement: replacement.clone(),
                    max_replacements: *max_replacements as usize,
                }),
            })
            .collect::<Result<Vec<_>, PipelineError>>()?;
        Ok(Self {
            plugin_id: plugin_id.to_string(),
            version_id: version_id.to_string(),
            contribution_id: contribution_id.to_string(),
            descriptor,
            operations,
            max_input_bytes: definition.max_input_bytes,
            max_output_bytes: definition.max_output_bytes,
            authorizer,
        })
    }

    fn authorize(&self) -> Result<(), PipelineError> {
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.plugin_id.clone(),
                version_id: self.version_id.clone(),
                capability_id: PluginCapabilityId::PipelineRegister,
                scope: PluginCapabilityScope::Contributions {
                    contribution_ids: vec![self.contribution_id.clone()],
                },
                operation: "pipeline.execute".to_string(),
                contribution_id: Some(self.contribution_id.clone()),
            })
            .map_err(|denial| PipelineError::Execution(denial.to_string()))
    }
}

impl PipelineStep for DeclarativePipelineStep {
    fn descriptor(&self) -> StepDescriptor {
        self.descriptor.clone()
    }

    fn validate_config(&self, config: &Value) -> Result<(), PipelineError> {
        if !config.is_null() && config.as_object().is_none_or(|config| !config.is_empty()) {
            return Err(PipelineError::Boundary(
                "declarative pipeline config must be empty".to_string(),
            ));
        }
        Ok(())
    }

    fn validate_input(&self, input: &Value) -> Result<(), PipelineError> {
        ensure_size(input, self.max_input_bytes, "input")
    }

    fn validate_output(&self, output: &Value) -> Result<(), PipelineError> {
        ensure_size(output, self.max_output_bytes, "output")
    }

    fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError> {
        self.authorize()?;
        self.validate_config(&context.config)?;
        ensure_size(&context.input, self.max_input_bytes, "input")?;
        let mut output = context.input;
        for operation in &self.operations {
            if context.cancellation.load(Ordering::Relaxed) {
                return Err(PipelineError::Canceled);
            }
            match operation {
                CompiledOperation::Select { path } => {
                    output = resolve_path(&output, path)?.clone();
                }
                CompiledOperation::Set { path, value } => {
                    *resolve_path_mut(&mut output, path)? = value.clone();
                }
                CompiledOperation::Assert { path, equals } => {
                    if resolve_path(&output, path)? != equals {
                        return Err(PipelineError::Execution(format!(
                            "declarative assertion failed at {}",
                            display_path(path)
                        )));
                    }
                }
                CompiledOperation::RegexReplace {
                    path,
                    pattern,
                    replacement,
                    max_replacements,
                } => {
                    let value = resolve_path_mut(&mut output, path)?;
                    let text = value.as_str().ok_or_else(|| {
                        PipelineError::Execution(format!(
                            "regexReplace requires a string at {}",
                            display_path(path)
                        ))
                    })?;
                    *value = Value::String(bounded_replace(
                        pattern,
                        text,
                        replacement,
                        *max_replacements,
                        self.max_output_bytes,
                    )?);
                }
            }
            ensure_size(&output, self.max_output_bytes, "output")?;
        }
        if context.cancellation.load(Ordering::Relaxed) {
            return Err(PipelineError::Canceled);
        }
        Ok(StepOutcome {
            output,
            checkpoint: None,
            usage: None,
        })
    }
}

#[derive(Clone)]
struct PublicPluginPipelineContract {
    plugin_id: String,
    version_id: String,
    contribution_id: String,
    descriptor: StepDescriptor,
    schema: PublicConfigSchemaV1,
    checkpoint_schema_version: Option<u32>,
    limits: PipelineStepLimitsV1,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl std::fmt::Debug for PublicPluginPipelineContract {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PublicPluginPipelineContract")
            .field("plugin_id", &self.plugin_id)
            .field("version_id", &self.version_id)
            .field("contribution_id", &self.contribution_id)
            .field("descriptor", &self.descriptor)
            .finish_non_exhaustive()
    }
}

impl PublicPluginPipelineContract {
    fn new(
        plugin_id: &str,
        version_id: &str,
        contribution: &PipelineStepContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        tier: PluginTier,
    ) -> Result<Self, PipelineError> {
        contribution
            .validate_executable_v1(tier)
            .map_err(public_contract_error)?;
        let input = contribution
            .input_artifact_kind()
            .map_err(public_contract_error)?;
        let output = contribution
            .output_artifact_kind()
            .map_err(public_contract_error)?;
        Ok(Self {
            plugin_id: plugin_id.to_string(),
            version_id: version_id.to_string(),
            contribution_id: contribution.id.clone(),
            descriptor: StepDescriptor {
                id: contribution.id.clone(),
                version: contribution.version.clone(),
                display_name: contribution.display_name.clone(),
                input,
                output,
                config_schema_version: contribution.config_schema_version,
                resumable: contribution.resumable,
                cancellable: contribution.cancellable,
            },
            schema: contribution.config_schema.clone().ok_or_else(|| {
                PipelineError::InvalidDefinition("plugin config schema is missing".to_string())
            })?,
            checkpoint_schema_version: contribution.checkpoint_schema_version,
            limits: contribution.limits.clone().ok_or_else(|| {
                PipelineError::InvalidDefinition("plugin pipeline limits are missing".to_string())
            })?,
            authorizer,
        })
    }

    fn authorize(&self, operation: PipelineStepOperationV1) -> Result<(), PipelineError> {
        let operation = match operation {
            PipelineStepOperationV1::Execute => "pipeline.execute",
            PipelineStepOperationV1::Resume => "pipeline.resume",
        };
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.plugin_id.clone(),
                version_id: self.version_id.clone(),
                capability_id: PluginCapabilityId::PipelineRegister,
                scope: PluginCapabilityScope::Contributions {
                    contribution_ids: vec![self.contribution_id.clone()],
                },
                operation: operation.to_string(),
                contribution_id: Some(self.contribution_id.clone()),
            })
            .map_err(|_| plugin_failure("plugin_permission_denied", false))
    }

    fn invocation(
        &self,
        context: &StepExecutionContext,
    ) -> Result<PipelineStepInvocationV1, PipelineError> {
        let operation = if context.checkpoint.is_some() {
            PipelineStepOperationV1::Resume
        } else {
            PipelineStepOperationV1::Execute
        };
        self.authorize(operation)?;
        let invocation = PipelineStepInvocationV1 {
            protocol_version: 1,
            invocation_id: Uuid::now_v7().to_string(),
            contribution_id: self.contribution_id.clone(),
            operation,
            run_id: context.run_id.clone(),
            project_id: context.project_id.clone(),
            document_id: context.document_id.clone(),
            input: PipelineArtifactV1 {
                kind: self.descriptor.input,
                value: context.input.clone(),
            },
            config_schema_version: self.descriptor.config_schema_version,
            config: context.config.clone(),
            checkpoint: context
                .checkpoint
                .clone()
                .map(|value| PipelineCheckpointV1 {
                    schema_version: self.checkpoint_schema_version.unwrap_or(0),
                    value,
                }),
            deadline_ms: context.deadline_ms.min(self.limits.max_deadline_ms).max(1),
        };
        invocation
            .validate(
                self.descriptor.input,
                self.descriptor.resumable,
                self.checkpoint_schema_version,
                &self.schema,
                &self.limits,
            )
            .map_err(public_contract_error)?;
        Ok(invocation)
    }

    fn checkpoint_migration_invocation(
        &self,
        context: &StepCheckpointMigrationContext,
    ) -> Result<PipelineCheckpointMigrationInvocationV1, PipelineError> {
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.plugin_id.clone(),
                version_id: self.version_id.clone(),
                capability_id: PluginCapabilityId::PipelineRegister,
                scope: PluginCapabilityScope::Contributions {
                    contribution_ids: vec![self.contribution_id.clone()],
                },
                operation: "pipeline.checkpointMigrate".to_string(),
                contribution_id: Some(self.contribution_id.clone()),
            })
            .map_err(|_| plugin_failure("plugin_permission_denied", false))?;
        let invocation = PipelineCheckpointMigrationInvocationV1 {
            protocol_version: 1,
            invocation_id: Uuid::now_v7().to_string(),
            contribution_id: self.contribution_id.clone(),
            run_id: context.run_id.clone(),
            project_id: context.project_id.clone(),
            document_id: context.document_id.clone(),
            config_schema_version: self.descriptor.config_schema_version,
            config: context.config.clone(),
            source_checkpoint: PipelineCheckpointV1 {
                schema_version: context.source_schema_version,
                value: context.checkpoint.clone(),
            },
            target_checkpoint_schema_version: context.target_schema_version,
            deadline_ms: context.deadline_ms.min(self.limits.max_deadline_ms).max(1),
        };
        invocation
            .validate(self.checkpoint_schema_version, &self.schema, &self.limits)
            .map_err(public_contract_error)?;
        Ok(invocation)
    }

    fn checkpoint_migration_outcome(
        &self,
        result: PipelineCheckpointMigrationResultV1,
    ) -> Result<StepCheckpointMigrationOutcome, PipelineError> {
        result
            .validate(self.checkpoint_schema_version, &self.limits)
            .map_err(public_contract_error)?;
        Ok(StepCheckpointMigrationOutcome {
            checkpoint: result.checkpoint.value,
            usage: serde_json::to_value(result.usage).ok(),
        })
    }

    fn outcome(&self, result: PipelineStepResultV1) -> Result<StepOutcome, PipelineError> {
        result
            .validate(
                self.descriptor.output,
                self.descriptor.resumable,
                self.checkpoint_schema_version,
                &self.limits,
            )
            .map_err(public_contract_error)?;
        Ok(StepOutcome {
            output: result.output.value,
            checkpoint: result.checkpoint.map(|checkpoint| checkpoint.value),
            usage: serde_json::to_value(result.usage).ok(),
        })
    }

    fn validate_config(&self, config: &Value) -> Result<(), PipelineError> {
        self.schema
            .validate_config(config)
            .map_err(public_contract_error)
    }

    fn validate_input(&self, input: &Value) -> Result<(), PipelineError> {
        PipelineArtifactV1 {
            kind: self.descriptor.input,
            value: input.clone(),
        }
        .validate(
            self.descriptor.input,
            self.limits.max_input_bytes as usize,
            "pipeline input",
        )
        .map_err(public_contract_error)
    }

    fn validate_output(&self, output: &Value) -> Result<(), PipelineError> {
        PipelineArtifactV1 {
            kind: self.descriptor.output,
            value: output.clone(),
        }
        .validate(
            self.descriptor.output,
            self.limits.max_output_bytes as usize,
            "pipeline output",
        )
        .map_err(public_contract_error)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SandboxPluginPipelineStep {
    contract: PublicPluginPipelineContract,
    worker: SandboxWorkerHandle,
    checkpoint_router: PluginPipelineCheckpointRouter,
}

impl SandboxPluginPipelineStep {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        contribution: &PipelineStepContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        worker: SandboxWorkerHandle,
        checkpoint_router: PluginPipelineCheckpointRouter,
    ) -> Result<Self, PipelineError> {
        Ok(Self {
            contract: PublicPluginPipelineContract::new(
                plugin_id,
                version_id,
                contribution,
                authorizer,
                PluginTier::Sandbox,
            )?,
            worker,
            checkpoint_router,
        })
    }
}

impl PipelineStep for SandboxPluginPipelineStep {
    fn descriptor(&self) -> StepDescriptor {
        self.contract.descriptor.clone()
    }

    fn validate_config(&self, config: &Value) -> Result<(), PipelineError> {
        self.contract.validate_config(config)
    }

    fn validate_input(&self, input: &Value) -> Result<(), PipelineError> {
        self.contract.validate_input(input)
    }

    fn validate_output(&self, output: &Value) -> Result<(), PipelineError> {
        self.contract.validate_output(output)
    }

    fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError> {
        self.execute_with_checkpoint_sink(context, None)
    }

    fn execute_with_checkpoint_sink(
        &self,
        context: StepExecutionContext,
        checkpoint_sink: Option<StepCheckpointSink>,
    ) -> Result<StepOutcome, PipelineError> {
        let invocation = self.contract.invocation(&context)?;
        let _checkpoint_route = checkpoint_sink
            .map(|sink| {
                self.checkpoint_router.register(
                    &invocation.invocation_id,
                    &invocation.contribution_id,
                    sink,
                )
            })
            .transpose()?;
        let sandbox_invocation = SandboxInvocationV1 {
            protocol_version: SANDBOX_PROTOCOL_VERSION,
            invocation_id: invocation.invocation_id.clone(),
            contribution_id: invocation.contribution_id.clone(),
            operation: match invocation.operation {
                PipelineStepOperationV1::Execute => "pipeline.execute",
                PipelineStepOperationV1::Resume => "pipeline.resume",
            }
            .to_string(),
            input: serde_json::to_value(&invocation).map_err(|_| {
                PipelineError::Boundary("pipeline invocation is invalid".to_string())
            })?,
        };
        let cancellation = SandboxCancellationToken::default();
        let finished = AtomicBool::new(false);
        let worker_result = std::thread::scope(|scope| {
            let monitor_cancellation = cancellation.clone();
            let monitor_finished = &finished;
            let engine_cancellation = Arc::clone(&context.cancellation);
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if engine_cancellation.load(Ordering::Acquire) {
                        monitor_cancellation.cancel();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
            let result = self
                .worker
                .invoke_with_cancellation(sandbox_invocation, cancellation);
            finished.store(true, Ordering::Release);
            result
        });
        if context.cancellation.load(Ordering::Acquire) {
            return Err(PipelineError::Canceled);
        }
        let envelope = worker_result.map_err(map_sandbox_pipeline_error)?;
        let result = decode_sandbox_pipeline_result(envelope)?;
        self.contract.outcome(result)
    }

    fn migrate_checkpoint(
        &self,
        context: StepCheckpointMigrationContext,
    ) -> Result<StepCheckpointMigrationOutcome, PipelineError> {
        let invocation = self.contract.checkpoint_migration_invocation(&context)?;
        let sandbox_invocation = SandboxInvocationV1 {
            protocol_version: SANDBOX_PROTOCOL_VERSION,
            invocation_id: invocation.invocation_id.clone(),
            contribution_id: invocation.contribution_id.clone(),
            operation: "pipeline.checkpointMigrate".to_string(),
            input: serde_json::to_value(&invocation).map_err(|_| {
                PipelineError::Boundary("checkpoint migration invocation is invalid".to_string())
            })?,
        };
        let cancellation = SandboxCancellationToken::default();
        let finished = AtomicBool::new(false);
        let worker_result = std::thread::scope(|scope| {
            let monitor_cancellation = cancellation.clone();
            let monitor_finished = &finished;
            let engine_cancellation = Arc::clone(&context.cancellation);
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if engine_cancellation.load(Ordering::Acquire) {
                        monitor_cancellation.cancel();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
            let result = self
                .worker
                .invoke_with_cancellation(sandbox_invocation, cancellation);
            finished.store(true, Ordering::Release);
            result
        });
        if context.cancellation.load(Ordering::Acquire) {
            return Err(PipelineError::Canceled);
        }
        let envelope = worker_result.map_err(map_sandbox_pipeline_error)?;
        let result = decode_sandbox_checkpoint_migration_result(envelope)?;
        self.contract.checkpoint_migration_outcome(result)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ProcessPluginPipelineStep {
    contract: PublicPluginPipelineContract,
    process: Arc<PluginProcess>,
}

impl ProcessPluginPipelineStep {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        contribution: &PipelineStepContributionDescriptor,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
        process: Arc<PluginProcess>,
    ) -> Result<Self, PipelineError> {
        Ok(Self {
            contract: PublicPluginPipelineContract::new(
                plugin_id,
                version_id,
                contribution,
                authorizer,
                PluginTier::Process,
            )?,
            process,
        })
    }
}

impl PipelineStep for ProcessPluginPipelineStep {
    fn descriptor(&self) -> StepDescriptor {
        self.contract.descriptor.clone()
    }

    fn validate_config(&self, config: &Value) -> Result<(), PipelineError> {
        self.contract.validate_config(config)
    }

    fn validate_input(&self, input: &Value) -> Result<(), PipelineError> {
        self.contract.validate_input(input)
    }

    fn validate_output(&self, output: &Value) -> Result<(), PipelineError> {
        self.contract.validate_output(output)
    }

    fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError> {
        self.execute_with_checkpoint_sink(context, None)
    }

    fn execute_with_checkpoint_sink(
        &self,
        context: StepExecutionContext,
        checkpoint_sink: Option<StepCheckpointSink>,
    ) -> Result<StepOutcome, PipelineError> {
        let invocation = self.contract.invocation(&context)?;
        let finished = AtomicBool::new(false);
        let call_result = std::thread::scope(|scope| {
            let monitor_finished = &finished;
            let process = Arc::clone(&self.process);
            let invocation_id = invocation.invocation_id.clone();
            let cancellation = Arc::clone(&context.cancellation);
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if cancellation.load(Ordering::Acquire) {
                        let _ = process.cancel_pipeline_step(&invocation_id);
                        recycle_process_after_cancel_grace(monitor_finished, &process);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
            let result = if let Some(sink) = checkpoint_sink {
                self.process.call_pipeline_step_with_checkpoints(
                    &invocation,
                    Duration::from_millis(invocation.deadline_ms),
                    move |progress: PipelineStepCheckpointProgressV1| {
                        sink.publish(progress.checkpoint.value).map_err(|_| {
                            PluginRuntimeError::Protocol(
                                "pipeline checkpoint was rejected".to_string(),
                            )
                        })
                    },
                )
            } else {
                self.process
                    .call_pipeline_step(&invocation, Duration::from_millis(invocation.deadline_ms))
            };
            finished.store(true, Ordering::Release);
            result
        });
        if context.cancellation.load(Ordering::Acquire) {
            return Err(PipelineError::Canceled);
        }
        self.contract
            .outcome(call_result.map_err(map_process_pipeline_error)?)
    }

    fn migrate_checkpoint(
        &self,
        context: StepCheckpointMigrationContext,
    ) -> Result<StepCheckpointMigrationOutcome, PipelineError> {
        let invocation = self.contract.checkpoint_migration_invocation(&context)?;
        let finished = AtomicBool::new(false);
        let call_result = std::thread::scope(|scope| {
            let monitor_finished = &finished;
            let process = Arc::clone(&self.process);
            let invocation_id = invocation.invocation_id.clone();
            let cancellation = Arc::clone(&context.cancellation);
            scope.spawn(move || {
                while !monitor_finished.load(Ordering::Acquire) {
                    if cancellation.load(Ordering::Acquire) {
                        let _ = process.cancel_pipeline_step(&invocation_id);
                        recycle_process_after_cancel_grace(monitor_finished, &process);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
            let result = self.process.call_pipeline_checkpoint_migration(
                &invocation,
                Duration::from_millis(invocation.deadline_ms),
            );
            finished.store(true, Ordering::Release);
            result
        });
        if context.cancellation.load(Ordering::Acquire) {
            return Err(PipelineError::Canceled);
        }
        self.contract
            .checkpoint_migration_outcome(call_result.map_err(map_process_pipeline_error)?)
    }
}

fn decode_sandbox_checkpoint_migration_result(
    envelope: SandboxResultV1,
) -> Result<PipelineCheckpointMigrationResultV1, PipelineError> {
    if !envelope.ok {
        return Err(plugin_failure("plugin_checkpoint_incompatible", false));
    }
    serde_json::from_value(envelope.output.ok_or_else(|| {
        PipelineError::Boundary("sandbox checkpoint migration result is missing".to_string())
    })?)
    .map_err(|_| {
        PipelineError::Boundary("sandbox checkpoint migration result is malformed".to_string())
    })
}

fn decode_sandbox_pipeline_result(
    envelope: SandboxResultV1,
) -> Result<PipelineStepResultV1, PipelineError> {
    if !envelope.ok {
        return Err(PipelineError::Plugin(PipelineFailure {
            code: "plugin_step_failed".to_string(),
            message: "plugin pipeline step failed".to_string(),
            retryable: envelope.error.is_some_and(|error| error.retryable),
        }));
    }
    serde_json::from_value(
        envelope.output.ok_or_else(|| {
            PipelineError::Boundary("sandbox pipeline result is missing".to_string())
        })?,
    )
    .map_err(|_| PipelineError::Boundary("sandbox pipeline result is malformed".to_string()))
}

fn public_contract_error(_error: PluginRuntimeError) -> PipelineError {
    PipelineError::Boundary("plugin pipeline contract validation failed".to_string())
}

fn plugin_failure(code: &str, retryable: bool) -> PipelineError {
    PipelineError::Plugin(PipelineFailure {
        code: code.to_string(),
        message: "plugin pipeline step failed".to_string(),
        retryable,
    })
}

fn map_sandbox_pipeline_error(error: SandboxError) -> PipelineError {
    match error {
        SandboxError::Cancelled => PipelineError::Canceled,
        SandboxError::Timeout => plugin_failure("plugin_timeout", true),
        SandboxError::ResourceLimit { .. } | SandboxError::QueueFull => {
            plugin_failure("plugin_resource_limit", false)
        }
        SandboxError::HostCallDenied { .. } => plugin_failure("plugin_permission_denied", false),
        SandboxError::Disconnected | SandboxError::NotReady => {
            plugin_failure("plugin_host_crash", true)
        }
        _ => plugin_failure("plugin_protocol", false),
    }
}

fn map_process_pipeline_error(error: PluginRuntimeError) -> PipelineError {
    match error {
        PluginRuntimeError::PermissionDenied(_) => {
            plugin_failure("plugin_permission_denied", false)
        }
        PluginRuntimeError::Timeout(_) => plugin_failure("plugin_timeout", true),
        PluginRuntimeError::Process(_) | PluginRuntimeError::Io(_) => {
            plugin_failure("plugin_host_crash", true)
        }
        PluginRuntimeError::Protocol(_)
        | PluginRuntimeError::Json(_)
        | PluginRuntimeError::Remote(_) => plugin_failure("plugin_protocol", false),
        _ => plugin_failure("plugin_invalid_request", false),
    }
}

fn resolve_path<'a>(value: &'a Value, path: &[String]) -> Result<&'a Value, PipelineError> {
    let mut current = value;
    for segment in path {
        current = match current {
            Value::Object(values) => values.get(segment),
            Value::Array(values) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| values.get(index)),
            _ => None,
        }
        .ok_or_else(|| {
            PipelineError::Execution(format!("JSON path not found: {}", display_path(path)))
        })?;
    }
    Ok(current)
}

fn resolve_path_mut<'a>(
    value: &'a mut Value,
    path: &[String],
) -> Result<&'a mut Value, PipelineError> {
    let path_display = display_path(path);
    let mut current = value;
    for segment in path {
        current = match current {
            Value::Object(values) => values.get_mut(segment),
            Value::Array(values) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| values.get_mut(index)),
            _ => None,
        }
        .ok_or_else(|| PipelineError::Execution(format!("JSON path not found: {path_display}")))?;
    }
    Ok(current)
}

fn ensure_size(value: &Value, limit: u64, label: &str) -> Result<(), PipelineError> {
    ensure_depth(value, label)?;
    let size = serde_json::to_vec(value)
        .map_err(|error| PipelineError::Execution(error.to_string()))?
        .len() as u64;
    if size > limit {
        return Err(PipelineError::Execution(format!(
            "declarative pipeline {label} exceeds {limit} bytes"
        )));
    }
    Ok(())
}

fn ensure_depth(value: &Value, label: &str) -> Result<(), PipelineError> {
    let mut pending = vec![(value, 0_usize)];
    while let Some((current, depth)) = pending.pop() {
        if depth > MAX_PIPELINE_JSON_DEPTH {
            return Err(PipelineError::Execution(format!(
                "declarative pipeline {label} is too deeply nested"
            )));
        }
        match current {
            Value::Array(values) => pending.extend(values.iter().map(|value| (value, depth + 1))),
            Value::Object(values) => {
                pending.extend(values.values().map(|value| (value, depth + 1)));
            }
            _ => {}
        }
    }
    Ok(())
}

fn bounded_replace(
    pattern: &Regex,
    text: &str,
    replacement: &str,
    max_replacements: usize,
    max_output_bytes: u64,
) -> Result<String, PipelineError> {
    let limit = usize::try_from(max_output_bytes).unwrap_or(usize::MAX);
    let mut output = String::with_capacity(text.len().min(limit));
    let mut previous_end = 0;
    for captures in pattern.captures_iter(text).take(max_replacements) {
        let matched = captures.get(0).ok_or_else(|| {
            PipelineError::Execution("regexReplace produced an empty capture set".to_string())
        })?;
        append_bounded(&mut output, &text[previous_end..matched.start()], limit)?;
        let mut expanded = String::new();
        captures.expand(replacement, &mut expanded);
        append_bounded(&mut output, &expanded, limit)?;
        previous_end = matched.end();
    }
    append_bounded(&mut output, &text[previous_end..], limit)?;
    Ok(output)
}

fn append_bounded(output: &mut String, value: &str, limit: usize) -> Result<(), PipelineError> {
    if output.len().saturating_add(value.len()) > limit {
        return Err(PipelineError::Execution(
            "declarative pipeline regexReplace output is oversized".to_string(),
        ));
    }
    output.push_str(value);
    Ok(())
}

fn display_path(path: &[String]) -> String {
    format!("/{}", path.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use tempfile::tempdir;
    use translunar_pipeline::ArtifactKind;

    #[derive(Debug)]
    struct AllowAll;

    impl PluginCapabilityAuthorizer for AllowAll {
        fn authorize(
            &self,
            _check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<translunar_plugin_runtime::PluginCapabilityDenial>>
        {
            Ok(())
        }
    }

    fn step() -> DeclarativePipelineStep {
        let definition = DeclarativePipelineDefinitionV1 {
            definition_version: 1,
            input: ArtifactKind::Json,
            output: ArtifactKind::Json,
            operations: vec![
                DeclarativePipelineOperation::Assert {
                    path: vec!["schemaVersion".to_string()],
                    equals: Value::from(1),
                },
                DeclarativePipelineOperation::Set {
                    path: vec!["status".to_string()],
                    value: Value::String("ready".to_string()),
                },
                DeclarativePipelineOperation::RegexReplace {
                    path: vec!["title".to_string()],
                    pattern: "\\s+".to_string(),
                    replacement: " ".to_string(),
                    max_replacements: 10,
                },
            ],
            max_input_bytes: 1024,
            max_output_bytes: 1024,
        };
        DeclarativePipelineStep::new(
            "test.plugin",
            "version-1",
            "test.pipeline",
            StepDescriptor {
                id: "test.pipeline".to_string(),
                version: "1.0.0".to_string(),
                display_name: "Test pipeline".to_string(),
                input: ArtifactKind::Json,
                output: ArtifactKind::Json,
                config_schema_version: 1,
                resumable: false,
                cancellable: true,
            },
            &definition,
            Arc::new(AllowAll),
        )
        .expect("valid step")
    }

    #[test]
    fn transform_is_deterministic_and_bounded() {
        let step = step();
        let execute = || {
            step.execute(StepExecutionContext {
                run_id: "run".to_string(),
                project_id: "project".to_string(),
                document_id: None,
                input: serde_json::json!({
                    "schemaVersion": 1,
                    "status": "draft",
                    "title": "A   title"
                }),
                config: Value::Null,
                checkpoint: None,
                deadline_ms: 120_000,
                cancellation: Arc::new(AtomicBool::new(false)),
            })
            .expect("execute")
            .output
        };
        let expected = serde_json::json!({
            "schemaVersion": 1,
            "status": "ready",
            "title": "A title"
        });
        assert_eq!(execute(), expected);
        assert_eq!(execute(), expected);
    }

    #[test]
    fn transform_honors_cancellation_before_operations() {
        let error = step()
            .execute(StepExecutionContext {
                run_id: "run".to_string(),
                project_id: "project".to_string(),
                document_id: None,
                input: serde_json::json!({
                    "schemaVersion": 1,
                    "status": "draft",
                    "title": "Title"
                }),
                config: Value::Null,
                checkpoint: None,
                deadline_ms: 120_000,
                cancellation: Arc::new(AtomicBool::new(true)),
            })
            .expect_err("canceled");
        assert!(matches!(error, PipelineError::Canceled));
    }

    #[test]
    fn transform_rejects_deeply_nested_input() {
        let mut input = Value::Null;
        for _ in 0..=MAX_PIPELINE_JSON_DEPTH {
            input = serde_json::json!({ "nested": input });
        }
        let error = ensure_size(&input, 1024, "input").expect_err("nested input");
        assert!(error.to_string().contains("too deeply nested"));
    }

    #[test]
    fn process_pipeline_cancel_kills_uncooperative_child_and_recycles() {
        let directory = tempdir().expect("process fixture directory");
        let descriptor: PipelineStepContributionDescriptor =
            serde_json::from_value(serde_json::json!({
                "descriptorVersion": 1,
                "operationProtocolVersion": 1,
                "id": "test.pipeline.cancel-grace",
                "version": "1.0.0",
                "displayName": "Cancel grace",
                "input": "json",
                "output": "json",
                "configSchemaVersion": 1,
                "configSchema": { "schemaVersion": 1, "fields": [] },
                "resumable": true,
                "cancellable": true,
                "checkpointSchemaVersion": 1,
                "limits": {
                    "maxInputBytes": 1024,
                    "maxOutputBytes": 1024,
                    "maxConfigBytes": 1024,
                    "maxCheckpointBytes": 1024,
                    "maxDeadlineMs": 5000
                }
            }))
            .expect("pipeline descriptor");
        let contributions = serde_json::to_string(&vec![
            translunar_plugin_runtime::PluginContributionDescriptor::PipelineStep(
                descriptor.clone(),
            ),
        ])
        .expect("encode contributions");
        let script = format!(
            r#"import {{ existsSync, writeFileSync }} from "node:fs";
import {{ createInterface }} from "node:readline";
const contributions = {contributions};
const marker = "cancel-observed.marker";
const write = value => process.stdout.write(`${{JSON.stringify(value)}}\n`);
createInterface({{ input: process.stdin, crlfDelay: Infinity }}).on("line", requestLine => {{
  const request = JSON.parse(requestLine);
  if (request.method === "plugin.handshake") {{
    write({{ jsonrpc: "2.0", id: request.id, result: {{ apiVersion: 1, pluginId: "test.process-cancel", contributions }} }});
    return;
  }}
  if (request.method === "pipeline.cancel") {{
    writeFileSync(marker, request.params.invocationId);
    return;
  }}
  if (request.method === "pipeline.execute") {{
    if (!existsSync(marker)) return;
    write({{ jsonrpc: "2.0", id: request.id, result: {{
      protocolVersion: 1,
      output: {{ kind: "json", value: {{ recycled: true }} }},
      checkpoint: {{ schemaVersion: 1, value: {{ cursor: 1 }} }},
      usage: {{ workUnits: 1, inputBytes: 2, outputBytes: 17 }}
    }} }});
    return;
  }}
}});
"#,
        );
        fs::write(directory.path().join("entry.mjs"), script).expect("write fixture");
        let manifest = translunar_plugin_runtime::PluginManifest {
            manifest_version: translunar_plugin_runtime::MANIFEST_VERSION_V1,
            id: "test.process-cancel".to_string(),
            display_name: "Process cancel".to_string(),
            version: "1.0.0".to_string(),
            api_version: translunar_plugin_runtime::HOST_API_VERSION,
            api_version_min: translunar_plugin_runtime::HOST_API_VERSION,
            tier: PluginTier::Process,
            entry: translunar_plugin_runtime::PluginEntry {
                kind: translunar_plugin_runtime::PluginEntryKind::Node,
                path: "entry.mjs".to_string(),
            },
            contributions: translunar_plugin_runtime::PluginContributions { filters: vec![] },
            permissions: vec![],
            capabilities: vec![],
        };
        let process = Arc::new(PluginProcess::new_with_public_descriptors(
            directory.path().to_path_buf(),
            manifest,
            vec![],
            vec![],
            vec![descriptor.clone()],
        ));
        let step = ProcessPluginPipelineStep::new(
            "test.process-cancel",
            "version-1",
            &descriptor,
            Arc::new(AllowAll),
            Arc::clone(&process),
        )
        .expect("process pipeline adapter");
        let cancellation = Arc::new(AtomicBool::new(false));
        let cancel = Arc::clone(&cancellation);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let canceled = step
            .execute(StepExecutionContext {
                run_id: "run-1".to_string(),
                project_id: "project-1".to_string(),
                document_id: None,
                input: serde_json::json!({}),
                config: serde_json::json!({}),
                checkpoint: None,
                deadline_ms: 5_000,
                cancellation,
            })
            .expect_err("uncooperative invocation must be canceled");
        assert!(matches!(canceled, PipelineError::Canceled));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(directory.path().join("cancel-observed.marker").is_file());

        let healthy = step
            .execute(StepExecutionContext {
                run_id: "run-2".to_string(),
                project_id: "project-1".to_string(),
                document_id: None,
                input: serde_json::json!({}),
                config: serde_json::json!({}),
                checkpoint: None,
                deadline_ms: 5_000,
                cancellation: Arc::new(AtomicBool::new(false)),
            })
            .expect("recycled child handles the next invocation");
        assert_eq!(healthy.output, serde_json::json!({ "recycled": true }));
        process.stop();
    }
}
