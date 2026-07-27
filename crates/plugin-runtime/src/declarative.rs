use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use regex::{Regex, RegexBuilder};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use translunar_domain::Segment;
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterDescriptor, FilterError,
    FilterEvent, FilterEventStream, ImportRequest, ProbeResult, ValidationReport,
    publish_bytes_noclobber,
};
use translunar_pipeline::ArtifactKind;
use translunar_qa_core::{
    CompiledQaProfile, MAX_REGEX_RULES, QaProfileDefinition, QaRegexRule, QaRuleSettings,
};

use crate::{
    PluginCapabilityAuthorizer, PluginCapabilityCheck, PluginCapabilityId, PluginCapabilityScope,
    PluginFileArea, PluginRuntimeError, Result,
};

pub const DECLARATIVE_DEFINITION_VERSION: u32 = 1;
const MAX_FILTER_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILTER_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILTER_UNITS: u32 = 100_000;
const MAX_FILTER_UNIT_BYTES: u32 = 1024 * 1024;
const MAX_CAPTURE_BYTES: u32 = 4_096;
const MAX_PROBE_HEADER_BYTES: u32 = 64 * 1024;
const MAX_PATTERN_BYTES: usize = 4_096;
const MAX_PIPELINE_OPERATIONS: usize = 128;
const MAX_PIPELINE_PATH_DEPTH: usize = 32;
const MAX_PIPELINE_PATH_SEGMENT_BYTES: usize = 128;
const MAX_PIPELINE_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PIPELINE_REPLACEMENTS: u32 = 100_000;
const MAX_PIPELINE_REPLACEMENT_BYTES: usize = 16 * 1024;
const MAX_PIPELINE_LITERAL_BYTES: usize = 64 * 1024;
const MAX_PIPELINE_JSON_DEPTH: usize = 16;
const MAX_DECLARATIVE_QA_RULE_ID_BYTES: usize = 96;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DeclarativeTextEncoding {
    Utf8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeFilterLimits {
    pub max_source_bytes: u64,
    pub max_output_bytes: u64,
    pub max_units: u32,
    pub max_unit_bytes: u32,
    pub max_capture_bytes: u32,
    pub probe_header_bytes: u32,
}

impl DeclarativeFilterLimits {
    fn validate(&self) -> Result<()> {
        require_range(
            self.max_source_bytes,
            1,
            MAX_FILTER_SOURCE_BYTES,
            "filter maxSourceBytes",
        )?;
        require_range(
            self.max_output_bytes,
            1,
            MAX_FILTER_OUTPUT_BYTES,
            "filter maxOutputBytes",
        )?;
        require_range(
            u64::from(self.max_units),
            1,
            u64::from(MAX_FILTER_UNITS),
            "filter maxUnits",
        )?;
        require_range(
            u64::from(self.max_unit_bytes),
            1,
            u64::from(MAX_FILTER_UNIT_BYTES),
            "filter maxUnitBytes",
        )?;
        require_range(
            u64::from(self.max_capture_bytes),
            1,
            u64::from(MAX_CAPTURE_BYTES),
            "filter maxCaptureBytes",
        )?;
        require_range(
            u64::from(self.probe_header_bytes),
            1,
            u64::from(MAX_PROBE_HEADER_BYTES),
            "filter probeHeaderBytes",
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeFilterDefinitionV1 {
    pub definition_version: u32,
    pub encoding: DeclarativeTextEncoding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe_header_pattern: Option<String>,
    pub unit_pattern: String,
    pub limits: DeclarativeFilterLimits,
}

impl DeclarativeFilterDefinitionV1 {
    pub fn validate(&self) -> Result<()> {
        require_definition_version(self.definition_version, "filter")?;
        self.limits.validate()?;
        if let Some(pattern) = &self.probe_header_pattern {
            compile_pattern(pattern, "filter probeHeaderPattern")?;
        }
        let unit = compile_pattern(&self.unit_pattern, "filter unitPattern")?;
        let captures = unit.capture_names().flatten().collect::<BTreeSet<_>>();
        if !captures.contains("source") {
            return Err(invalid(
                "filter unitPattern requires a named source capture",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativeQaPackDefinitionV1 {
    pub definition_version: u32,
    pub rules: Vec<QaRegexRule>,
}

impl DeclarativeQaPackDefinitionV1 {
    pub fn validate(&self) -> Result<()> {
        require_definition_version(self.definition_version, "QA pack")?;
        if self.rules.is_empty() || self.rules.len() > MAX_REGEX_RULES {
            return Err(invalid(format!(
                "QA pack rules must contain between 1 and {MAX_REGEX_RULES} items"
            )));
        }
        let enabled_rule_ids = self
            .rules
            .iter()
            .map(|rule| rule.id.clone())
            .collect::<BTreeSet<_>>();
        if enabled_rule_ids.len() != self.rules.len() {
            return Err(invalid("QA pack rule ids must be unique"));
        }
        if self
            .rules
            .iter()
            .any(|rule| rule.id.len() > MAX_DECLARATIVE_QA_RULE_ID_BYTES)
        {
            return Err(invalid(format!(
                "QA pack rule ids must not exceed {MAX_DECLARATIVE_QA_RULE_ID_BYTES} bytes"
            )));
        }
        CompiledQaProfile::compile(QaProfileDefinition {
            id: "plugin.qa.preflight".to_string(),
            name: "Plugin QA preflight".to_string(),
            enabled_rule_ids,
            severity_overrides: Default::default(),
            settings: QaRuleSettings::default(),
            regex_rules: self.rules.clone(),
        })
        .map_err(|error| invalid(error.to_string()))?;
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
pub enum DeclarativePipelineOperation {
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
        pattern: String,
        replacement: String,
        max_replacements: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarativePipelineDefinitionV1 {
    pub definition_version: u32,
    pub input: ArtifactKind,
    pub output: ArtifactKind,
    pub operations: Vec<DeclarativePipelineOperation>,
    pub max_input_bytes: u64,
    pub max_output_bytes: u64,
}

impl DeclarativePipelineDefinitionV1 {
    pub fn validate(&self) -> Result<()> {
        require_definition_version(self.definition_version, "pipeline")?;
        if self.input == ArtifactKind::None || self.output == ArtifactKind::None {
            return Err(invalid(
                "declarative pipeline input and output must name concrete artifacts",
            ));
        }
        if self.operations.is_empty() || self.operations.len() > MAX_PIPELINE_OPERATIONS {
            return Err(invalid(format!(
                "declarative pipeline operations must contain between 1 and {MAX_PIPELINE_OPERATIONS} items"
            )));
        }
        require_range(
            self.max_input_bytes,
            1,
            MAX_PIPELINE_OUTPUT_BYTES,
            "pipeline maxInputBytes",
        )?;
        require_range(
            self.max_output_bytes,
            1,
            MAX_PIPELINE_OUTPUT_BYTES,
            "pipeline maxOutputBytes",
        )?;
        for operation in &self.operations {
            let path = match operation {
                DeclarativePipelineOperation::Select { path }
                | DeclarativePipelineOperation::Set { path, .. }
                | DeclarativePipelineOperation::Assert { path, .. }
                | DeclarativePipelineOperation::RegexReplace { path, .. } => path,
            };
            validate_json_path(path)?;
            match operation {
                DeclarativePipelineOperation::Set { value, .. } => validate_literal(value)?,
                DeclarativePipelineOperation::Assert { equals, .. } => validate_literal(equals)?,
                DeclarativePipelineOperation::RegexReplace {
                    pattern,
                    replacement,
                    max_replacements,
                    ..
                } => {
                    compile_pattern(pattern, "pipeline regexReplace pattern")?;
                    if replacement.len() > MAX_PIPELINE_REPLACEMENT_BYTES {
                        return Err(invalid("pipeline regexReplace replacement is oversized"));
                    }
                    require_range(
                        u64::from(*max_replacements),
                        1,
                        u64::from(MAX_PIPELINE_REPLACEMENTS),
                        "pipeline regexReplace maxReplacements",
                    )?;
                }
                DeclarativePipelineOperation::Select { .. } => {}
            }
        }
        Ok(())
    }

    pub fn validate_for_descriptor(
        &self,
        input: &ArtifactKind,
        output: &ArtifactKind,
        config_schema_version: u32,
    ) -> Result<()> {
        self.validate()?;
        if config_schema_version != DECLARATIVE_DEFINITION_VERSION {
            return Err(invalid(
                "declarative pipeline configSchemaVersion must be 1",
            ));
        }
        if input != &self.input || output != &self.output {
            return Err(invalid(
                "declarative pipeline descriptor artifact kinds do not match its definition",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct ParsedUnit {
    structural_path: String,
    source_text: String,
    source_start: usize,
    source_end: usize,
}

#[derive(Debug, Clone)]
pub struct DeclarativeDocumentFilter {
    plugin_id: String,
    version_id: String,
    descriptor: FilterDescriptor,
    definition: DeclarativeFilterDefinitionV1,
    probe_header: Option<Regex>,
    unit: Regex,
    authorizer: Arc<dyn PluginCapabilityAuthorizer>,
}

impl DeclarativeDocumentFilter {
    pub fn new(
        plugin_id: impl Into<String>,
        version_id: impl Into<String>,
        descriptor: FilterDescriptor,
        definition: DeclarativeFilterDefinitionV1,
        authorizer: Arc<dyn PluginCapabilityAuthorizer>,
    ) -> Result<Self> {
        definition.validate()?;
        let probe_header = definition
            .probe_header_pattern
            .as_deref()
            .map(|pattern| compile_pattern(pattern, "filter probeHeaderPattern"))
            .transpose()?;
        let unit = compile_pattern(&definition.unit_pattern, "filter unitPattern")?;
        Ok(Self {
            plugin_id: plugin_id.into(),
            version_id: version_id.into(),
            descriptor,
            definition,
            probe_header,
            unit,
            authorizer,
        })
    }

    fn require_file(
        &self,
        capability_id: PluginCapabilityId,
        area: PluginFileArea,
        operation: &str,
    ) -> std::result::Result<(), FilterError> {
        self.authorizer
            .authorize(&PluginCapabilityCheck {
                plugin_id: self.plugin_id.clone(),
                version_id: self.version_id.clone(),
                capability_id,
                scope: PluginCapabilityScope::File { areas: vec![area] },
                operation: operation.to_string(),
                contribution_id: Some(self.descriptor.id.clone()),
            })
            .map_err(|denial| FilterError::PluginPermissionDenied {
                plugin_id: self.plugin_id.clone(),
                filter_id: self.descriptor.id.clone(),
                operation: operation.to_string(),
                message: denial.to_string(),
            })
    }

    fn read_source(&self, source: &Path) -> std::result::Result<String, FilterError> {
        let metadata = fs::metadata(source)?;
        if metadata.len() > self.definition.limits.max_source_bytes {
            return Err(FilterError::Invalid(format!(
                "source exceeds {} bytes",
                self.definition.limits.max_source_bytes
            )));
        }
        let bytes = fs::read(source)?;
        if bytes.len() as u64 > self.definition.limits.max_source_bytes {
            return Err(FilterError::Invalid(format!(
                "source exceeds {} bytes",
                self.definition.limits.max_source_bytes
            )));
        }
        String::from_utf8(bytes)
            .map_err(|_| FilterError::Invalid("source is not valid UTF-8".to_string()))
    }

    fn parse_units(&self, text: &str) -> std::result::Result<Vec<ParsedUnit>, FilterError> {
        let mut units = Vec::new();
        let mut previous_end = 0;
        for (ordinal, captures) in self.unit.captures_iter(text).enumerate() {
            if units.len() >= self.definition.limits.max_units as usize {
                return Err(FilterError::Invalid(
                    "source has too many units".to_string(),
                ));
            }
            let source = captures.name("source").ok_or_else(|| {
                FilterError::Invalid("unit match omitted its source capture".to_string())
            })?;
            if source.start() == source.end() {
                return Err(FilterError::Invalid(
                    "unit source captures must not be empty".to_string(),
                ));
            }
            if source.start() < previous_end {
                return Err(FilterError::Invalid(
                    "unit source captures must not overlap".to_string(),
                ));
            }
            if source.as_str().len() > self.definition.limits.max_unit_bytes as usize {
                return Err(FilterError::Invalid("unit source is oversized".to_string()));
            }
            let identity = captures
                .name("id")
                .map(|value| value.as_str())
                .unwrap_or("");
            let context = captures
                .name("context")
                .map(|value| value.as_str())
                .unwrap_or("");
            if identity.len() > self.definition.limits.max_capture_bytes as usize
                || context.len() > self.definition.limits.max_capture_bytes as usize
            {
                return Err(FilterError::Invalid(
                    "unit identity or context capture is oversized".to_string(),
                ));
            }
            let structural_path = unit_path(&self.descriptor.id, ordinal, identity, context);
            previous_end = source.end();
            units.push(ParsedUnit {
                structural_path,
                source_text: source.as_str().to_string(),
                source_start: source.start(),
                source_end: source.end(),
            });
        }
        if units.is_empty() {
            return Err(FilterError::Invalid(
                "source contains no declarative filter units".to_string(),
            ));
        }
        Ok(units)
    }
}

impl DocumentFilter for DeclarativeDocumentFilter {
    fn descriptor(&self) -> FilterDescriptor {
        self.descriptor.clone()
    }

    fn probe(&self, source: &Path) -> std::result::Result<ProbeResult, FilterError> {
        self.require_file(
            PluginCapabilityId::FileRead,
            PluginFileArea::Source,
            "filter.probe",
        )?;
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if !extension.is_some_and(|extension| {
            self.descriptor
                .extensions
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
        }) {
            return Ok(ProbeResult::no_match("extension does not match"));
        }
        let text = self.read_source(source)?;
        if let Some(pattern) = &self.probe_header {
            let mut end = text
                .len()
                .min(self.definition.limits.probe_header_bytes as usize);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            if !pattern.is_match(&text[..end]) {
                return Ok(ProbeResult::no_match("header pattern does not match"));
            }
        }
        Ok(ProbeResult::matches(90, "declarative filter matched"))
    }

    fn import(
        &self,
        request: ImportRequest,
    ) -> std::result::Result<FilterEventStream, FilterError> {
        self.require_file(
            PluginCapabilityId::FileRead,
            PluginFileArea::Source,
            "filter.import",
        )?;
        let text = self.read_source(&request.source)?;
        let units = self.parse_units(&text)?;
        let mut events = Vec::with_capacity(units.len() * 3 + 2);
        events.push(Ok(FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: self.descriptor.id.clone(),
                source_locale: request.source_locale,
                properties: Default::default(),
            },
        }));
        for (ordinal, unit) in units.into_iter().enumerate() {
            events.push(Ok(FilterEvent::StartUnit {
                ordinal: ordinal as u32,
                structural_path: unit.structural_path,
            }));
            events.push(Ok(FilterEvent::Text(unit.source_text)));
            events.push(Ok(FilterEvent::EndUnit));
        }
        events.push(Ok(FilterEvent::EndDocument));
        Ok(Box::new(events.into_iter()))
    }

    fn export(&self, request: ExportRequest<'_>) -> std::result::Result<ExportReport, FilterError> {
        if !self.descriptor.capabilities.export {
            return Err(FilterError::Unsupported(format!(
                "filter {} does not support export",
                self.descriptor.id
            )));
        }
        self.require_file(
            PluginCapabilityId::FileRead,
            PluginFileArea::Source,
            "filter.export",
        )?;
        self.require_file(
            PluginCapabilityId::FileWrite,
            PluginFileArea::Output,
            "filter.export",
        )?;
        let text = self.read_source(request.source)?;
        let units = self.parse_units(&text)?;
        validate_segments(&units, request.segments)?;
        let output_size = units.iter().zip(request.segments).try_fold(
            text.len() as u64,
            |size, (unit, segment)| {
                if segment.target_text.is_empty() {
                    return Some(size);
                }
                size.checked_sub((unit.source_end - unit.source_start) as u64)?
                    .checked_add(segment.target_text.len() as u64)
            },
        );
        if output_size.is_none_or(|size| size > self.definition.limits.max_output_bytes) {
            return Err(FilterError::Processing(
                "declarative output is oversized".to_string(),
            ));
        }
        let mut output = text.into_bytes();
        let mut translated_segments = 0;
        for (unit, segment) in units.iter().zip(request.segments).rev() {
            if segment.target_text.is_empty() {
                continue;
            }
            output.splice(
                unit.source_start..unit.source_end,
                segment.target_text.as_bytes().iter().copied(),
            );
            translated_segments += 1;
        }
        if output.len() as u64 > self.definition.limits.max_output_bytes {
            return Err(FilterError::Processing(
                "declarative output is oversized".to_string(),
            ));
        }
        let staged = String::from_utf8(output)
            .map_err(|_| FilterError::Processing("declarative output is not UTF-8".to_string()))?;
        let staged_units = self.parse_units(&staged)?;
        if staged_units.len() != units.len()
            || staged_units
                .iter()
                .zip(units.iter().zip(request.segments))
                .any(|(next, (previous, segment))| {
                    next.structural_path != previous.structural_path
                        || next.source_text
                            != if segment.target_text.is_empty() {
                                previous.source_text.as_str()
                            } else {
                                segment.target_text.as_str()
                            }
                })
        {
            return Err(FilterError::Processing(
                "declarative output changed unit identity or count".to_string(),
            ));
        }
        publish_bytes_noclobber(request.output, staged.as_bytes())?;
        Ok(ExportReport {
            output_path: request.output.to_string_lossy().into_owned(),
            translated_segments,
            degradation: Vec::new(),
        })
    }

    fn validate(&self, source: &Path) -> std::result::Result<ValidationReport, FilterError> {
        self.require_file(
            PluginCapabilityId::FileRead,
            PluginFileArea::Source,
            "filter.validate",
        )?;
        let text = self.read_source(source)?;
        self.parse_units(&text)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

fn validate_segments(
    units: &[ParsedUnit],
    segments: &[Segment],
) -> std::result::Result<(), FilterError> {
    if units.len() != segments.len() {
        return Err(FilterError::Processing(
            "segment count differs from the immutable source".to_string(),
        ));
    }
    for (unit, segment) in units.iter().zip(segments) {
        if unit.structural_path != segment.structural_path
            || unit.source_text != segment.source_text
        {
            return Err(FilterError::Processing(
                "segment identity or source text drifted from the immutable source".to_string(),
            ));
        }
    }
    Ok(())
}

fn unit_path(filter_id: &str, ordinal: usize, identity: &str, context: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(identity.as_bytes());
    hasher.update([0]);
    hasher.update(context.as_bytes());
    format!("tier1/{filter_id}/{ordinal}/{:x}", hasher.finalize())
}

fn require_definition_version(version: u32, label: &str) -> Result<()> {
    if version != DECLARATIVE_DEFINITION_VERSION {
        return Err(PluginRuntimeError::UnsupportedVersion {
            component: format!("declarative {label} definition"),
            version,
        });
    }
    Ok(())
}

fn require_range(value: u64, min: u64, max: u64, label: &str) -> Result<()> {
    if !(min..=max).contains(&value) {
        return Err(invalid(format!("{label} must be between {min} and {max}")));
    }
    Ok(())
}

fn compile_pattern(pattern: &str, label: &str) -> Result<Regex> {
    if pattern.is_empty() || pattern.len() > MAX_PATTERN_BYTES {
        return Err(invalid(format!(
            "{label} must contain between 1 and {MAX_PATTERN_BYTES} bytes"
        )));
    }
    RegexBuilder::new(pattern)
        .size_limit(1 << 20)
        .dfa_size_limit(1 << 20)
        .build()
        .map_err(|error| invalid(format!("{label} cannot compile: {error}")))
}

fn validate_json_path(path: &[String]) -> Result<()> {
    if path.is_empty() || path.len() > MAX_PIPELINE_PATH_DEPTH {
        return Err(invalid(format!(
            "pipeline paths must contain between 1 and {MAX_PIPELINE_PATH_DEPTH} segments"
        )));
    }
    for segment in path {
        if segment.is_empty()
            || segment.len() > MAX_PIPELINE_PATH_SEGMENT_BYTES
            || segment.contains('\0')
        {
            return Err(invalid("pipeline path segment is empty or oversized"));
        }
    }
    Ok(())
}

fn validate_literal(value: &Value) -> Result<()> {
    if serde_json::to_vec(value)?.len() > MAX_PIPELINE_LITERAL_BYTES {
        return Err(invalid("pipeline literal is oversized"));
    }
    validate_literal_depth(value, 0)
}

fn validate_literal_depth(value: &Value, depth: usize) -> Result<()> {
    if depth > MAX_PIPELINE_JSON_DEPTH {
        return Err(invalid("pipeline literal is too deeply nested"));
    }
    match value {
        Value::Array(values) => {
            for value in values {
                validate_literal_depth(value, depth + 1)?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if key.len() > MAX_PIPELINE_PATH_SEGMENT_BYTES {
                    return Err(invalid("pipeline literal key is oversized"));
                }
                validate_literal_depth(value, depth + 1)?;
            }
        }
        _ => {}
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
    use tempfile::tempdir;
    use translunar_domain::{QaSeverity, SegmentState};
    use translunar_filter_core::{FilterCapabilities, collect_imported_document};
    use translunar_qa_core::QaField;

    #[derive(Debug)]
    struct AllowAll;

    impl PluginCapabilityAuthorizer for AllowAll {
        fn authorize(
            &self,
            _check: &PluginCapabilityCheck,
        ) -> std::result::Result<(), Box<crate::PluginCapabilityDenial>> {
            Ok(())
        }
    }

    fn definition() -> DeclarativeFilterDefinitionV1 {
        DeclarativeFilterDefinitionV1 {
            definition_version: 1,
            encoding: DeclarativeTextEncoding::Utf8,
            probe_header_pattern: Some("(?m)^CAT1\\r?$".to_string()),
            unit_pattern: "(?m)^(?<id>[A-Za-z0-9_-]+)\\|(?<source>[^\\r\\n]+)$".to_string(),
            limits: DeclarativeFilterLimits {
                max_source_bytes: 1024,
                max_output_bytes: 1024,
                max_units: 10,
                max_unit_bytes: 256,
                max_capture_bytes: 64,
                probe_header_bytes: 128,
            },
        }
    }

    fn filter() -> DeclarativeDocumentFilter {
        DeclarativeDocumentFilter::new(
            "test.plugin",
            "version-1",
            FilterDescriptor {
                id: "test.lines".to_string(),
                version: "1.0.0".to_string(),
                display_name: "Test lines".to_string(),
                extensions: vec!["catlines".to_string()],
                capabilities: FilterCapabilities {
                    import: true,
                    export: true,
                    validate: true,
                    inline_tags: false,
                    notes: false,
                    degradation_report: false,
                },
            },
            definition(),
            Arc::new(AllowAll),
        )
        .expect("valid filter")
    }

    fn segment(ordinal: u32, path: String, source: String, target: &str) -> Segment {
        Segment {
            id: format!("segment-{ordinal}"),
            document_id: "document".to_string(),
            ordinal,
            structural_path: path,
            source_text: source,
            target_text: target.to_string(),
            state: SegmentState::Draft,
            revision: 0,
            source_hash: "source-hash".to_string(),
            context_hash: "context-hash".to_string(),
            updated_at_ms: 0,
        }
    }

    #[test]
    fn definition_rejects_missing_capture_and_unsafe_bounds() {
        let mut invalid_capture = definition();
        invalid_capture.unit_pattern = "(?m)^.+$".to_string();
        assert!(invalid_capture.validate().is_err());

        let mut invalid_bound = definition();
        invalid_bound.limits.max_units = MAX_FILTER_UNITS + 1;
        assert!(invalid_bound.validate().is_err());
    }

    #[test]
    fn qa_and_pipeline_definitions_reject_invalid_programs() {
        let empty_qa = DeclarativeQaPackDefinitionV1 {
            definition_version: 1,
            rules: Vec::new(),
        };
        assert!(empty_qa.validate().is_err());
        let duplicate_rule = QaRegexRule {
            id: "duplicate".to_string(),
            label: "Duplicate".to_string(),
            field: QaField::Target,
            pattern: "TODO".to_string(),
            severity: QaSeverity::Warning,
            message: "Duplicate".to_string(),
            replacement_hint: None,
        };
        assert!(
            DeclarativeQaPackDefinitionV1 {
                definition_version: 1,
                rules: vec![duplicate_rule.clone(), duplicate_rule],
            }
            .validate()
            .is_err()
        );

        let invalid_pipeline = DeclarativePipelineDefinitionV1 {
            definition_version: 1,
            input: ArtifactKind::Json,
            output: ArtifactKind::Json,
            operations: vec![DeclarativePipelineOperation::RegexReplace {
                path: Vec::new(),
                pattern: "(".to_string(),
                replacement: String::new(),
                max_replacements: 0,
            }],
            max_input_bytes: 1024,
            max_output_bytes: 1024,
        };
        assert!(invalid_pipeline.validate().is_err());
    }

    #[test]
    fn typed_definitions_deny_unknown_fields() {
        assert!(
            serde_json::from_value::<DeclarativeFilterDefinitionV1>(json!({
                "definitionVersion": 1,
                "encoding": "utf8",
                "unitPattern": "(?<source>.+)",
                "limits": {
                    "maxSourceBytes": 1024,
                    "maxOutputBytes": 1024,
                    "maxUnits": 10,
                    "maxUnitBytes": 256,
                    "maxCaptureBytes": 64,
                    "probeHeaderBytes": 64
                },
                "unknown": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<DeclarativePipelineDefinitionV1>(json!({
                "definitionVersion": 1,
                "input": "json",
                "output": "json",
                "operations": [{
                    "operation": "select",
                    "path": ["value"],
                    "unknown": true
                }],
                "maxInputBytes": 1024,
                "maxOutputBytes": 1024
            }))
            .is_err()
        );
    }

    #[test]
    fn filter_round_trips_owned_ranges_and_never_clobbers() {
        let directory = tempdir().expect("temporary directory");
        let source = directory.path().join("source.catlines");
        let output = directory.path().join("output.catlines");
        fs::write(&source, "CAT1\nfirst|First source\nsecond|Second source\n")
            .expect("write fixture");
        let filter = filter();
        assert_eq!(filter.probe(&source).expect("probe").confidence, 90);
        let imported = collect_imported_document(
            filter
                .import(ImportRequest::new(source.clone()))
                .expect("import"),
        )
        .expect("collect import");
        let segments = imported
            .units
            .into_iter()
            .enumerate()
            .map(|(ordinal, unit)| {
                segment(
                    ordinal as u32,
                    unit.structural_path,
                    unit.source_text,
                    if ordinal == 0 { "First target" } else { "" },
                )
            })
            .collect::<Vec<_>>();
        let report = filter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: &segments,
            })
            .expect("export");
        assert_eq!(report.translated_segments, 1);
        assert_eq!(
            fs::read_to_string(&output).expect("read output"),
            "CAT1\nfirst|First target\nsecond|Second source\n"
        );
        assert!(
            filter
                .export(ExportRequest {
                    source: &source,
                    output: &output,
                    segments: &segments,
                })
                .is_err()
        );
    }

    #[test]
    fn filter_rejects_drift_malformed_utf8_and_partial_output() {
        let directory = tempdir().expect("temporary directory");
        let source = directory.path().join("source.catlines");
        let output = directory.path().join("output.catlines");
        fs::write(&source, "CAT1\nfirst|First source\n").expect("write fixture");
        let filter = filter();
        let imported = collect_imported_document(
            filter
                .import(ImportRequest::new(source.clone()))
                .expect("import"),
        )
        .expect("collect import");
        let unit = imported.units.into_iter().next().expect("unit");
        let drifted = vec![segment(
            0,
            unit.structural_path,
            "drifted".to_string(),
            "target",
        )];
        assert!(
            filter
                .export(ExportRequest {
                    source: &source,
                    output: &output,
                    segments: &drifted,
                })
                .is_err()
        );
        assert!(!output.exists());

        fs::write(&source, [0xff, 0xfe]).expect("write malformed fixture");
        assert!(filter.validate(&source).is_err());
    }
}
