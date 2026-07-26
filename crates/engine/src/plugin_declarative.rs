use std::sync::Arc;
use std::sync::atomic::Ordering;

use regex::{Regex, RegexBuilder};
use serde_json::Value;
use translunar_pipeline::{
    PipelineError, PipelineStep, StepDescriptor, StepExecutionContext, StepOutcome,
};
use translunar_plugin_runtime::{
    DeclarativePipelineDefinitionV1, DeclarativePipelineOperation, DeclarativeQaPackDefinitionV1,
    PluginCapabilityAuthorizer, PluginCapabilityCheck, PluginCapabilityDenial, PluginCapabilityId,
    PluginCapabilityScope,
};
use translunar_qa_core::QaRegexRule;

const MAX_PIPELINE_JSON_DEPTH: usize = 16;

#[derive(Debug, Clone)]
pub(crate) struct PluginQaPack {
    pub(crate) plugin_id: String,
    pub(crate) version_id: String,
    pub(crate) contribution_id: String,
    pub(crate) rules: Vec<QaRegexRule>,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl PluginQaPack {
    pub(crate) fn new(
        plugin_id: &str,
        version_id: &str,
        contribution_id: &str,
        definition: &DeclarativeQaPackDefinitionV1,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> Self {
        let rules = definition
            .rules
            .iter()
            .cloned()
            .map(|mut rule| {
                rule.id = format!(
                    "plugin.qa.{}.{}.{}.{}",
                    plugin_id, version_id, contribution_id, rule.id
                );
                rule
            })
            .collect();
        Self {
            plugin_id: plugin_id.to_string(),
            version_id: version_id.to_string(),
            contribution_id: contribution_id.to_string(),
            rules,
            authorizer,
        }
    }

    pub(crate) fn authorized_rules(
        &self,
    ) -> std::result::Result<Vec<QaRegexRule>, Box<PluginCapabilityDenial>> {
        self.authorizer.authorize(&PluginCapabilityCheck {
            plugin_id: self.plugin_id.clone(),
            version_id: self.version_id.clone(),
            capability_id: PluginCapabilityId::QaRegister,
            scope: PluginCapabilityScope::Contributions {
                contribution_ids: vec![self.contribution_id.clone()],
            },
            operation: "qa.execute".to_string(),
            contribution_id: Some(self.contribution_id.clone()),
        })?;
        Ok(self.rules.clone())
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

    fn execute(&self, context: StepExecutionContext) -> Result<StepOutcome, PipelineError> {
        self.authorize()?;
        if !context.config.is_null()
            && context
                .config
                .as_object()
                .is_none_or(|config| !config.is_empty())
        {
            return Err(PipelineError::Execution(
                "declarative pipeline config must be empty".to_string(),
            ));
        }
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
    use std::sync::atomic::AtomicBool;
    use translunar_pipeline::ArtifactKind;

    #[derive(Debug)]
    struct AllowAll;

    impl PluginCapabilityAuthorizer for AllowAll {
        fn authorize(
            &self,
            _check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<PluginCapabilityDenial>> {
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
}
