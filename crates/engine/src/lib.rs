use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use translunar_asset_core::{
    AssetError, TermExchangeEntry, TermExchangeTranslation, TermStatus, TmExchangeUnit,
};
use translunar_domain::{
    DataHealthReport, Document, EditorPreferences, Project, Segment, SegmentState, SpellFinding,
    state_for_target,
};
use translunar_editor_core::{
    SearchOptions, TextMatch, check_user_dictionary, cjk_assistance, normalize_dictionary_word,
    spell_word_spans,
};
use translunar_filter_core::{
    ExportRequest, FilterError, FilterRegistry, ImportRequest, collect_imported_document,
};
use translunar_filter_docx::DocxFilter;
use translunar_filter_html::HtmlFilter;
use translunar_filter_pdf::{PdfError, PdfFilter, PdfPath};
use translunar_filter_pptx::PptxFilter;
use translunar_filter_text::{MarkdownFilter, TxtFilter};
use translunar_filter_xliff::XliffFilter;
use translunar_filter_xlsx::XlsxFilter;
use translunar_pipeline::{
    ArtifactKind, PipelineDefinition, PipelineError, PipelineFailure, PipelineStep,
    PipelineStepDefinition, StepDescriptor, StepExecutionContext, StepOutcome, StepRegistry,
};
use translunar_protocol::methods;
use translunar_protocol::{
    AssetExchangeFormat, BackupResult, ConcordanceParams, ConcordanceResult, ConfirmSegmentParams,
    ConfirmSegmentResult, ConvertSegmentChineseParams, CorrectOcrParams, CorrectSourceParams,
    CreateBackupParams, CreatePipelineParams, CreateProjectParams, CreateSegmentCommentParams,
    DeleteSegmentCommentParams, DictionaryListParams, DictionaryListResult, DictionaryWordParams,
    DocumentIdParams, DocumentListParams, DocumentPage, EditorHistoryParams, EditorHistoryResult,
    EditorMutationResult, EditorSearchField, EditorSegmentFilter, EditorSegmentListParams,
    EditorSegmentPage, EditorSegmentSort, EditorUndoRedoParams, EmptyParams, EmptyResult,
    ErrorCode, ExactLookupParams, ExactLookupResult, ExportDocumentParams, ExportDocumentResult,
    ExportDocxParams, ExportDocxResult, FilterListResult, FindSegmentsParams, HistoryListParams,
    ImportDocumentParams, ImportDocumentResult, ImportDocxParams, InitializeParams,
    InitializeResult, ListQaParams, MergeSegmentsParams, OperationPage, PROTOCOL_VERSION,
    PdfBoundingBox, PdfPageBlock, PdfPageDetail, PdfPageGetParams, PdfPageListParams,
    PdfPageListResult, PdfPageSummary, PipelineCapabilityResult, PipelineDefinitionPage,
    PipelineIdParams, PipelineListParams, PipelineRunIdParams, PipelineRunListParams,
    PipelineRunPage, PipelineRunRevisionParams, PipelineRunSnapshot as ProtocolPipelineRunSnapshot,
    PipelineValidationResult, ProjectIdParams, ProjectListParams, ProjectPage, ProjectSnapshot,
    PropagateSegmentParams, QaListResult, ReplaceApplyParams, ReplacePreviewItem,
    ReplacePreviewParams, ReplacePreviewResult, ResolveSegmentCommentParams, ReviewCreateParams,
    ReviewDecisionParams, ReviewListParams, ReviewListResult, RpcError, RpcRequest, RpcResponse,
    RunPipelineParams, SegmentCommentListParams, SegmentCommentListResult, SegmentFindMatch,
    SegmentFindResult, SegmentListParams, SegmentPage, SetEditorWorkflowParams,
    SetProjectLifecycleParams, SetSegmentTagsParams, SpellCheckParams, SpellCheckResult,
    SplitSegmentParams, TermSearchParams, TermSearchResult, TermUpsertParams, TermbaseCreateParams,
    TermbaseExportParams, TermbaseExportResult, TermbaseImportParams, TermbaseImportResult,
    TermbaseListParams, TermbaseMountParams, TermbasePage, TermbaseUnmountParams, TmExportParams,
    TmExportResult, TmImportParams, TmImportResult, TmLibraryCreateParams, TmLibraryListParams,
    TmLibraryMountParams, TmLibraryPage, TmLibraryUnmountParams, TmSearchParams, TmSearchResult,
    UpdateEditorPreferencesParams, UpdateProjectParams, UpdateSegmentCommentParams,
    UpdateTargetParams, ValidatePipelineParams,
};
use translunar_storage::{
    ConcordanceRequest as StorageConcordanceRequest, EditorFilter as StorageEditorFilter,
    EditorListRequest as StorageEditorListRequest, EditorMutation as StorageEditorMutation,
    EditorSearchField as StorageEditorSearchField, EditorSort as StorageEditorSort, NewDocument,
    NewPipelineDefinition, NewTermEntry, NewTermTranslation, NewTmLibrary, ProjectUpdate,
    ReplaceItem as StorageReplaceItem, ReplacePreview as StorageReplacePreview,
    ReplaceRequest as StorageReplaceRequest, ReviewProposal, StorageError, Store,
    TermSearchRequest as StorageTermSearchRequest, TmSearchRequest as StorageTmSearchRequest,
};

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Storage(#[from] StorageError),

    #[error("document import failed: {0}")]
    Import(#[source] FilterError),

    #[error("document export failed: {0}")]
    Export(#[source] FilterError),

    #[error("asset exchange failed: {0}")]
    Asset(#[from] AssetError),

    #[error("engine I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("invalid engine state: {0}")]
    InvalidState(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;

fn bounded_page_size(limit: u32) -> Result<u32> {
    if (1..=500).contains(&limit) {
        Ok(limit)
    } else {
        Err(EngineError::InvalidRequest(
            "limit must be between 1 and 500".to_string(),
        ))
    }
}

fn storage_editor_field(field: EditorSearchField) -> StorageEditorSearchField {
    match field {
        EditorSearchField::Source => StorageEditorSearchField::Source,
        EditorSearchField::Target => StorageEditorSearchField::Target,
        EditorSearchField::Both => StorageEditorSearchField::Both,
    }
}

fn protocol_editor_field(field: StorageEditorSearchField) -> EditorSearchField {
    match field {
        StorageEditorSearchField::Source => EditorSearchField::Source,
        StorageEditorSearchField::Target => EditorSearchField::Target,
        StorageEditorSearchField::Both => EditorSearchField::Both,
    }
}

fn storage_editor_filter(filter: EditorSegmentFilter) -> StorageEditorFilter {
    match filter {
        EditorSegmentFilter::All => StorageEditorFilter::All,
        EditorSegmentFilter::Untranslated => StorageEditorFilter::Untranslated,
        EditorSegmentFilter::Draft => StorageEditorFilter::Draft,
        EditorSegmentFilter::Confirmed => StorageEditorFilter::Confirmed,
        EditorSegmentFilter::Issues => StorageEditorFilter::Issues,
        EditorSegmentFilter::Tagged => StorageEditorFilter::Tagged,
        EditorSegmentFilter::Commented => StorageEditorFilter::Commented,
    }
}

fn storage_editor_sort(sort: EditorSegmentSort) -> StorageEditorSort {
    match sort {
        EditorSegmentSort::Ordinal => StorageEditorSort::Ordinal,
        EditorSegmentSort::UpdatedAt => StorageEditorSort::UpdatedAt,
        EditorSegmentSort::State => StorageEditorSort::State,
    }
}

fn editor_mutation_result(mutation: StorageEditorMutation) -> EditorMutationResult {
    EditorMutationResult {
        rows: mutation.rows,
        counts: mutation.counts,
        operation_id: mutation.operation_id,
        focus_segment_id: mutation.focus_segment_id,
    }
}

fn structural_split_path(path: &str) -> Option<(&str, &str, u8)> {
    let (base, suffix) = path.rsplit_once("#split:")?;
    let (lineage, part) = suffix.rsplit_once(':')?;
    if base.is_empty() || lineage.is_empty() {
        return None;
    }
    let part = part.parse::<u8>().ok()?;
    matches!(part, 1 | 2).then_some((base, lineage, part))
}

fn collapse_structural_segments(mut segments: Vec<Segment>) -> Result<Vec<Segment>> {
    loop {
        let mut collapsed = Vec::with_capacity(segments.len());
        let mut index = 0;
        let mut changed = false;
        while index < segments.len() {
            let segment = &segments[index];
            let Some((base, lineage, part)) = structural_split_path(&segment.structural_path)
            else {
                collapsed.push(segment.clone());
                index += 1;
                continue;
            };
            if part != 1 {
                return Err(EngineError::InvalidState(format!(
                    "structural split part has no preceding sibling: {}",
                    segment.structural_path
                )));
            }
            let second = segments.get(index + 1).ok_or_else(|| {
                EngineError::InvalidState(format!(
                    "structural split is incomplete: {}",
                    segment.structural_path
                ))
            })?;
            let Some((second_base, second_lineage, second_part)) =
                structural_split_path(&second.structural_path)
            else {
                return Err(EngineError::InvalidState(format!(
                    "structural split is incomplete: {}",
                    segment.structural_path
                )));
            };
            if base != second_base || lineage != second_lineage || second_part != 2 {
                return Err(EngineError::InvalidState(format!(
                    "structural split siblings do not match: {} and {}",
                    segment.structural_path, second.structural_path
                )));
            }
            let mut combined = segment.clone();
            combined.structural_path = base.to_string();
            combined.source_text = format!("{}{}", segment.source_text, second.source_text);
            combined.target_text =
                if segment.target_text.is_empty() && second.target_text.is_empty() {
                    String::new()
                } else {
                    format!(
                        "{}{}",
                        if segment.target_text.is_empty() {
                            &segment.source_text
                        } else {
                            &segment.target_text
                        },
                        if second.target_text.is_empty() {
                            &second.source_text
                        } else {
                            &second.target_text
                        }
                    )
                };
            combined.state = if segment.state == SegmentState::Confirmed
                && second.state == SegmentState::Confirmed
            {
                SegmentState::Confirmed
            } else {
                state_for_target(&combined.target_text)
            };
            combined.revision = segment.revision.max(second.revision);
            combined.updated_at_ms = segment.updated_at_ms.max(second.updated_at_ms);
            collapsed.push(combined);
            index += 2;
            changed = true;
        }
        if !changed {
            return Ok(collapsed);
        }
        segments = collapsed;
    }
}

fn hunspell_dictionary(locale: &str) -> Option<(PathBuf, String)> {
    let normalized = locale.replace('-', "_");
    let language = normalized.split('_').next().unwrap_or(&normalized);
    let mut names = vec![normalized.clone(), locale.to_string(), language.to_string()];
    names.sort();
    names.dedup();
    let mut directories = env::var_os("TRANSLUNAR_HUNSPELL_DIRS")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    directories.extend([
        PathBuf::from("/usr/share/hunspell"),
        PathBuf::from("/usr/share/myspell"),
        PathBuf::from("/usr/share/myspell/dicts"),
        PathBuf::from("/usr/local/share/hunspell"),
        PathBuf::from("/Library/Spelling"),
        PathBuf::from("C:/Program Files/LibreOffice/share/extensions"),
    ]);
    for directory in directories {
        for name in &names {
            let direct = directory.join(format!("{name}.dic"));
            let direct_affix = directory.join(format!("{name}.aff"));
            if direct.is_file() && direct_affix.is_file() {
                return Some((directory.clone(), name.clone()));
            }
            if let Ok(entries) = fs::read_dir(&directory) {
                for entry in entries.flatten().take(256) {
                    let child = entry.path();
                    if child.join(format!("{name}.dic")).is_file()
                        && child.join(format!("{name}.aff")).is_file()
                    {
                        return Some((child, name.clone()));
                    }
                }
            }
        }
    }
    None
}

fn run_hunspell(
    locale: &str,
    text: &str,
    user_words: &BTreeSet<String>,
    limit: usize,
) -> Option<(String, Vec<SpellFinding>)> {
    let (dictionary_directory, dictionary_name) = hunspell_dictionary(locale)?;
    let words = spell_word_spans(text)
        .into_iter()
        .filter(|word| !user_words.contains(&normalize_dictionary_word(&word.text)))
        .take(5_000)
        .collect::<Vec<_>>();
    let input = words
        .iter()
        .map(|word| word.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let binary = env::var_os("TRANSLUNAR_HUNSPELL_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(if cfg!(windows) {
                "hunspell.exe"
            } else {
                "hunspell"
            })
        });
    let stdout = NamedTempFile::new().ok()?;
    let stderr = NamedTempFile::new().ok()?;
    let mut command = Command::new(binary);
    command
        .arg("-a")
        .arg("-d")
        .arg(&dictionary_name)
        .env("DICPATH", env::join_paths([&dictionary_directory]).ok()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(stdout.reopen().ok()?))
        .stderr(Stdio::from(stderr.reopen().ok()?));
    let mut child = command.spawn().ok()?;
    if let Some(mut stdin) = child.stdin.take()
        && (stdin.write_all(input.as_bytes()).is_err() || stdin.write_all(b"\n").is_err())
    {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    };
    if !status.success() || stdout.as_file().metadata().ok()?.len() > 1_048_576 {
        return None;
    }
    let output = fs::read_to_string(stdout.path()).ok()?;
    let findings = parse_hunspell_output(
        &output,
        &words,
        text,
        &format!("hunspell:{dictionary_name}"),
        limit,
    )?;
    Some((format!("hunspell:{dictionary_name}"), findings))
}

fn parse_hunspell_output(
    output: &str,
    words: &[TextMatch],
    text: &str,
    provider: &str,
    limit: usize,
) -> Option<Vec<SpellFinding>> {
    let results = output
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('@'))
        .collect::<Vec<_>>();
    if results.len() < words.len() {
        return None;
    }
    let mut findings = Vec::new();
    for (word, result) in words.iter().zip(results) {
        let marker = result.as_bytes().first().copied().unwrap_or_default();
        if matches!(marker, b'*' | b'+' | b'-') {
            continue;
        }
        if !matches!(marker, b'&' | b'#' | b'?') {
            return None;
        }
        let suggestions = result
            .split_once(':')
            .map(|(_, suggestions)| {
                suggestions
                    .split(',')
                    .map(str::trim)
                    .filter(|suggestion| !suggestion.is_empty())
                    .take(8)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        findings.push(SpellFinding {
            word: word.text.clone(),
            start: u32::try_from(text[..word.start].chars().count()).unwrap_or(u32::MAX),
            end: u32::try_from(text[..word.end].chars().count()).unwrap_or(u32::MAX),
            suggestions,
            provider: provider.to_string(),
        });
        if findings.len() >= limit {
            break;
        }
    }
    Some(findings)
}

fn validate_filter_options(options: &std::collections::BTreeMap<String, String>) -> Result<()> {
    if options.len() > 32 {
        return Err(EngineError::InvalidRequest(
            "filter options must contain at most 32 entries".to_string(),
        ));
    }
    for (key, value) in options {
        if key.trim().is_empty() || key.len() > 64 || value.len() > 4096 {
            return Err(EngineError::InvalidRequest(
                "filter option keys must be 1..64 bytes and values at most 4096 bytes".to_string(),
            ));
        }
    }
    Ok(())
}

fn map_pdf_service_error(error: PdfError) -> EngineError {
    EngineError::Import(FilterError::Processing(error.to_string()))
}

fn normalize_relative_path(value: Option<&str>, source: &Path) -> Result<String> {
    let fallback = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| EngineError::InvalidRequest("sourcePath must name a file".to_string()))?;
    let candidate = value
        .filter(|path| !path.trim().is_empty())
        .unwrap_or(fallback);
    let candidate = candidate.replace('\\', "/");
    if candidate.starts_with('/')
        || candidate.starts_with("//")
        || candidate.as_bytes().get(1) == Some(&b':')
    {
        return Err(EngineError::InvalidRequest(
            "relativePath must be project-relative".to_string(),
        ));
    }
    let mut parts = Vec::new();
    for part in candidate.split('/') {
        match part.trim() {
            "" | "." => {}
            ".." => {
                return Err(EngineError::InvalidRequest(
                    "relativePath must not contain parent traversal".to_string(),
                ));
            }
            normalized => parts.push(normalized),
        }
    }
    if parts.is_empty() {
        return Err(EngineError::InvalidRequest(
            "relativePath must name a file".to_string(),
        ));
    }
    Ok(parts.join("/"))
}

#[derive(Clone)]
struct PipelineManager {
    data_dir: PathBuf,
    registry: StepRegistry,
    active: Arc<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>,
}

struct CheckpointStep;

impl PipelineStep for CheckpointStep {
    fn descriptor(&self) -> StepDescriptor {
        StepDescriptor {
            id: "core.checkpoint".to_string(),
            version: "1".to_string(),
            display_name: "Checkpoint".to_string(),
            input: ArtifactKind::None,
            output: ArtifactKind::Json,
            config_schema_version: 1,
            resumable: true,
            cancellable: true,
        }
    }

    fn execute(
        &self,
        context: StepExecutionContext,
    ) -> std::result::Result<StepOutcome, PipelineError> {
        let delay_ms = context
            .config
            .get("delayMs")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(60_000);
        let mut elapsed = 0;
        while elapsed < delay_ms {
            if context.cancellation.load(Ordering::Relaxed) {
                return Err(PipelineError::Canceled);
            }
            let tick = (delay_ms - elapsed).min(10);
            thread::sleep(Duration::from_millis(tick));
            elapsed += tick;
        }
        if context.cancellation.load(Ordering::Relaxed) {
            return Err(PipelineError::Canceled);
        }
        Ok(StepOutcome {
            output: context.input,
            checkpoint: Some(json!({ "completed": true })),
            usage: None,
        })
    }
}

struct QaDocumentStep {
    data_dir: PathBuf,
}

impl PipelineStep for QaDocumentStep {
    fn descriptor(&self) -> StepDescriptor {
        StepDescriptor {
            id: "core.qa.document".to_string(),
            version: "1".to_string(),
            display_name: "Document QA".to_string(),
            input: ArtifactKind::None,
            output: ArtifactKind::QaFindings,
            config_schema_version: 1,
            resumable: true,
            cancellable: true,
        }
    }

    fn execute(
        &self,
        context: StepExecutionContext,
    ) -> std::result::Result<StepOutcome, PipelineError> {
        if context.cancellation.load(Ordering::Relaxed) {
            return Err(PipelineError::Canceled);
        }
        let document_id = context
            .document_id
            .clone()
            .or_else(|| {
                context
                    .input
                    .get("documentId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .ok_or_else(|| PipelineError::Execution("documentId is required".to_string()))?;
        let mut store = Store::open_worker(&self.data_dir)
            .map_err(|error| PipelineError::Execution(error.to_string()))?;
        let issues = store
            .run_document_qa(&document_id)
            .map_err(|error| PipelineError::Execution(error.to_string()))?;
        Ok(StepOutcome {
            output: serde_json::to_value(issues)
                .map_err(|error| PipelineError::Execution(error.to_string()))?,
            checkpoint: Some(json!({ "documentId": document_id })),
            usage: None,
        })
    }
}

impl PipelineManager {
    fn new(data_dir: PathBuf) -> Result<Self> {
        let mut registry = StepRegistry::default();
        registry
            .register(Arc::new(CheckpointStep))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        registry
            .register(Arc::new(QaDocumentStep {
                data_dir: data_dir.clone(),
            }))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        Ok(Self {
            data_dir,
            registry,
            active: Arc::new(Mutex::new(std::collections::HashMap::new())),
        })
    }

    fn descriptors(&self) -> Vec<StepDescriptor> {
        self.registry.descriptors()
    }

    fn validate(
        &self,
        name: String,
        steps: Vec<PipelineStepDefinition>,
    ) -> PipelineValidationResult {
        let definition = translunar_pipeline::PipelineDefinition {
            id: "validation".to_string(),
            project_id: None,
            name,
            version: 1,
            revision: 0,
            steps,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        match self.registry.validate_definition(&definition) {
            Ok(()) => PipelineValidationResult {
                valid: true,
                errors: Vec::new(),
            },
            Err(error) => PipelineValidationResult {
                valid: false,
                errors: vec![error.to_string()],
            },
        }
    }

    fn spawn(&self, run_id: String) {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = self.active.lock() {
            if active.contains_key(&run_id) {
                return;
            }
            active.insert(run_id.clone(), Arc::clone(&token));
        } else {
            return;
        }
        let manager = self.clone();
        thread::spawn(move || {
            manager.execute(run_id.clone(), token);
            if let Ok(mut active) = manager.active.lock() {
                active.remove(&run_id);
            }
        });
    }

    fn cancel(&self, run_id: &str) {
        if let Ok(active) = self.active.lock()
            && let Some(token) = active.get(run_id)
        {
            token.store(true, Ordering::Relaxed);
        }
    }

    fn execute(&self, run_id: String, token: Arc<AtomicBool>) {
        let mut store = match Store::open_worker(&self.data_dir) {
            Ok(store) => store,
            Err(_) => return,
        };
        let initial = match store.get_pipeline_run(&run_id) {
            Ok(snapshot) => snapshot,
            Err(_) => return,
        };
        if initial.run.status == translunar_pipeline::PipelineRunStatus::Canceling {
            let _ = store.finalize_pipeline_canceled(&run_id);
            return;
        }
        let mut snapshot = match store.start_pipeline_run(&run_id) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let _ = Self::finalize_if_canceling(&mut store, &run_id);
                return;
            }
        };
        let definition = match store.get_pipeline_definition(&snapshot.run.definition_id) {
            Ok(definition) => definition,
            Err(error) => {
                let _ = store.fail_pipeline_run(
                    &run_id,
                    PipelineFailure {
                        code: "definition_not_found".to_string(),
                        message: error.to_string(),
                        retryable: false,
                    },
                );
                return;
            }
        };
        while snapshot.run.current_step_index < snapshot.run.step_count {
            if token.load(Ordering::Relaxed)
                || store.pipeline_cancel_requested(&run_id).unwrap_or(false)
            {
                let _ = Self::finalize_if_canceling(&mut store, &run_id);
                return;
            }
            let index = snapshot.run.current_step_index;
            let Some(definition_step) = definition.steps.get(index as usize) else {
                let _ = store.fail_pipeline_run(
                    &run_id,
                    PipelineFailure {
                        code: "step_index_invalid".to_string(),
                        message: format!("missing pipeline step {index}"),
                        retryable: false,
                    },
                );
                return;
            };
            let step = match self.registry.resolve(&definition_step.step_id) {
                Ok(step) => step,
                Err(error) => {
                    if Self::finalize_if_canceling(&mut store, &run_id) {
                        return;
                    }
                    let _ = store.fail_pipeline_run(
                        &run_id,
                        PipelineFailure {
                            code: "step_not_found".to_string(),
                            message: error.to_string(),
                            retryable: false,
                        },
                    );
                    return;
                }
            };
            let input = if index == 0 {
                snapshot.run.input.clone()
            } else {
                snapshot
                    .steps
                    .get(index as usize - 1)
                    .and_then(|item| item.output.clone())
                    .unwrap_or(Value::Null)
            };
            let step_run = match store.start_pipeline_step(&run_id, index, input.clone()) {
                Ok(step_run) => step_run,
                Err(error) => {
                    let _ = store.fail_pipeline_run(
                        &run_id,
                        PipelineFailure {
                            code: "step_start_failed".to_string(),
                            message: error.to_string(),
                            retryable: true,
                        },
                    );
                    return;
                }
            };
            let context = StepExecutionContext {
                run_id: run_id.clone(),
                project_id: snapshot.run.project_id.clone(),
                document_id: snapshot.run.document_id.clone(),
                input,
                config: definition_step.config.clone(),
                checkpoint: step_run.checkpoint,
                cancellation: Arc::clone(&token),
            };
            match step.execute(context) {
                Ok(outcome) => {
                    if token.load(Ordering::Relaxed)
                        || store.pipeline_cancel_requested(&run_id).unwrap_or(false)
                    {
                        let _ = Self::finalize_if_canceling(&mut store, &run_id);
                        return;
                    }
                    match store.complete_pipeline_step(
                        &run_id,
                        index,
                        outcome.output,
                        outcome.checkpoint,
                        outcome.usage,
                    ) {
                        Ok(updated) => snapshot = updated,
                        Err(error) => {
                            if Self::finalize_if_canceling(&mut store, &run_id) {
                                return;
                            }
                            let _ = store.fail_pipeline_run(
                                &run_id,
                                PipelineFailure {
                                    code: "step_commit_failed".to_string(),
                                    message: error.to_string(),
                                    retryable: true,
                                },
                            );
                            return;
                        }
                    }
                }
                Err(PipelineError::Canceled) => {
                    let _ = Self::finalize_if_canceling(&mut store, &run_id);
                    return;
                }
                Err(error) => {
                    if Self::finalize_if_canceling(&mut store, &run_id) {
                        return;
                    }
                    let _ = store.fail_pipeline_run(
                        &run_id,
                        PipelineFailure {
                            code: "step_failed".to_string(),
                            message: error.to_string(),
                            retryable: true,
                        },
                    );
                    return;
                }
            }
        }
    }

    fn finalize_if_canceling(store: &mut Store, run_id: &str) -> bool {
        let is_canceling = store
            .get_pipeline_run(run_id)
            .map(|snapshot| {
                snapshot.run.status == translunar_pipeline::PipelineRunStatus::Canceling
            })
            .unwrap_or(false);
        if is_canceling {
            let _ = store.finalize_pipeline_canceled(run_id);
        }
        is_canceling
    }
}

pub struct EngineService {
    store: Store,
    filters: FilterRegistry,
    pipeline: PipelineManager,
}

impl EngineService {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        let data_dir = data_dir.as_ref().to_path_buf();
        let mut filters = FilterRegistry::default();
        filters
            .register(Arc::new(DocxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(XlsxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(PptxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(PdfFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(TxtFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(MarkdownFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(HtmlFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(XliffFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        Ok(Self {
            store: Store::open(&data_dir)?,
            filters,
            pipeline: PipelineManager::new(data_dir)?,
        })
    }

    pub fn create_project(&mut self, params: CreateProjectParams) -> Result<Project> {
        self.store
            .create_project(
                &params.name,
                &params.source_locale,
                &params.target_locale,
                &params.domain,
            )
            .map_err(Into::into)
    }

    pub fn get_project(&self, project_id: &str) -> Result<ProjectSnapshot> {
        let aggregate = self.store.get_project(project_id)?;
        Ok(ProjectSnapshot {
            project: aggregate.project,
            documents: aggregate.documents,
            counts: aggregate.counts,
        })
    }

    pub fn list_projects(&self, params: ProjectListParams) -> Result<ProjectPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self
            .store
            .list_projects(params.lifecycle, params.offset, limit)?;
        Ok(ProjectPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn update_project(&mut self, params: UpdateProjectParams) -> Result<Project> {
        self.store
            .update_project(
                &params.project_id,
                ProjectUpdate {
                    name: params.name,
                    source_locale: params.source_locale,
                    target_locale: params.target_locale,
                    domain: params.domain,
                    configuration: params.configuration,
                    expected_revision: params.expected_revision,
                    actor: params.actor,
                    correlation_id: params.correlation_id,
                },
            )
            .map_err(Into::into)
    }

    pub fn set_project_lifecycle(&mut self, params: SetProjectLifecycleParams) -> Result<Project> {
        self.store
            .set_project_lifecycle(
                &params.project_id,
                params.lifecycle,
                params.expected_revision,
                &params.actor,
                params.correlation_id.as_deref(),
            )
            .map_err(Into::into)
    }

    pub fn list_documents(&self, params: DocumentListParams) -> Result<DocumentPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self
            .store
            .list_documents(&params.project_id, params.offset, limit)?;
        Ok(DocumentPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_document(&self, document_id: &str) -> Result<Document> {
        Ok(self.store.get_document(document_id)?.document)
    }

    pub fn import_docx(&mut self, params: ImportDocxParams) -> Result<Document> {
        Ok(self
            .import_document(ImportDocumentParams {
                project_id: params.project_id,
                source_path: params.source_path,
                relative_path: None,
                filter_id: Some("builtin.docx".to_string()),
                options: Default::default(),
            })?
            .document)
    }

    pub fn import_document(
        &mut self,
        params: ImportDocumentParams,
    ) -> Result<ImportDocumentResult> {
        let project = self.store.get_project(&params.project_id)?;
        validate_filter_options(&params.options)?;
        let source_path = PathBuf::from(&params.source_path);
        if !source_path.is_file() {
            return Err(EngineError::InvalidRequest(format!(
                "source document does not exist: {}",
                source_path.display()
            )));
        }
        let relative_path = normalize_relative_path(params.relative_path.as_deref(), &source_path)?;
        let name = Path::new(&relative_path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                EngineError::InvalidRequest("relativePath must name a file".to_string())
            })?
            .to_string();
        let filter = self
            .filters
            .select(&source_path, params.filter_id.as_deref())
            .map_err(EngineError::Import)?;
        let descriptor = filter.descriptor();

        let document_id = translunar_domain::new_id();
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("source");
        let managed_source_path = self.store.paths().managed_source(&document_id, extension);
        let mut temporary = tempfile::Builder::new()
            .prefix("import-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(&self.store.paths().temporary)?;
        let source_sha256 = copy_and_hash(&source_path, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        let stream = filter
            .import(ImportRequest {
                source: temporary.path().to_path_buf(),
                document_id: Some(document_id.clone()),
                source_locale: Some(project.project.source_locale.clone()),
                options: params.options.clone(),
            })
            .map_err(EngineError::Import)?;
        let imported = collect_imported_document(stream).map_err(EngineError::Import)?;
        if imported.units.is_empty() && descriptor.id != "builtin.pdf" {
            return Err(EngineError::Import(FilterError::Invalid(
                "document contains no translatable units".to_string(),
            )));
        }
        temporary
            .persist_noclobber(&managed_source_path)
            .map_err(|error| EngineError::Io(error.error))?;

        let input = NewDocument {
            id: document_id,
            project_id: params.project_id,
            name,
            relative_path,
            format: imported.metadata.format,
            filter_id: descriptor.id.clone(),
            source_sha256,
            degradation: imported.degradation.clone(),
            original_source_path: source_path,
            managed_source_path: managed_source_path.clone(),
        };
        match self.store.insert_document(&input, &imported.units) {
            Ok(document) => Ok(ImportDocumentResult {
                filter_id: descriptor.id,
                degradation: imported.degradation,
                document,
            }),
            Err(error) => {
                let _ = std::fs::remove_file(managed_source_path);
                Err(error.into())
            }
        }
    }

    pub fn list_segments(&self, params: SegmentListParams) -> Result<SegmentPage> {
        let limit = params.limit.clamp(1, 1_000);
        let (items, total) = self
            .store
            .list_segments(&params.document_id, params.offset, limit)?;
        Ok(SegmentPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_editor_segments(
        &self,
        params: EditorSegmentListParams,
    ) -> Result<EditorSegmentPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_editor_rows(&StorageEditorListRequest {
            document_id: params.document_id,
            query: params.query,
            field: storage_editor_field(params.field),
            filter: storage_editor_filter(params.filter),
            sort: storage_editor_sort(params.sort),
            descending: params.descending,
            offset: params.offset,
            limit,
            include_context: params.include_context,
        })?;
        Ok(EditorSegmentPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn set_segment_tags(
        &mut self,
        params: SetSegmentTagsParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.set_target_tags(
            &params.segment_id,
            &params.target_tags,
            params.expected_revision,
        )?))
    }

    pub fn convert_segment_chinese(
        &mut self,
        params: ConvertSegmentChineseParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.convert_chinese_target(
            &params.segment_id,
            params.profile,
            params.expected_revision,
        )?))
    }

    pub fn propagate_segment(
        &mut self,
        params: PropagateSegmentParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.propagate_segment(
            &params.segment_id,
            params.expected_revision,
        )?))
    }

    pub fn find_segments(&self, params: FindSegmentsParams) -> Result<SegmentFindResult> {
        let limit = bounded_page_size(params.limit)?;
        let options = SearchOptions {
            regex: params.regex,
            case_sensitive: params.case_sensitive,
            whole_word: params.whole_word,
        };
        let (matches, total) = self.store.find_editor_matches(
            &params.document_id,
            &params.query,
            storage_editor_field(params.field),
            options,
            params.offset,
            limit,
        )?;
        Ok(SegmentFindResult {
            matches: matches
                .into_iter()
                .map(|item| SegmentFindMatch {
                    segment_id: item.segment_id,
                    field: protocol_editor_field(item.field),
                    start: item.start,
                    end: item.end,
                    matched_text: item.matched_text,
                    revision: item.revision,
                })
                .collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn preview_replace(&self, params: ReplacePreviewParams) -> Result<ReplacePreviewResult> {
        let preview = self.store.preview_replace(&StorageReplaceRequest {
            document_id: params.document_id,
            query: params.query,
            replacement: params.replacement,
            field: storage_editor_field(params.field),
            options: SearchOptions {
                regex: params.regex,
                case_sensitive: params.case_sensitive,
                whole_word: params.whole_word,
            },
        })?;
        let changed_segments = preview
            .items
            .iter()
            .map(|item| item.segment_id.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        let replacement_count = preview
            .items
            .iter()
            .fold(0_u32, |total, item| total.saturating_add(item.replacements));
        Ok(ReplacePreviewResult {
            token: preview.token,
            document_id: preview.document_id,
            items: preview
                .items
                .into_iter()
                .map(|item| ReplacePreviewItem {
                    segment_id: item.segment_id,
                    revision: item.revision,
                    field: protocol_editor_field(item.field),
                    before: item.before,
                    after: item.after,
                    replacements: item.replacements,
                })
                .collect(),
            changed_segments: u32::try_from(changed_segments).unwrap_or(u32::MAX),
            replacement_count,
        })
    }

    pub fn apply_replace(&mut self, params: ReplaceApplyParams) -> Result<EditorMutationResult> {
        let preview = StorageReplacePreview {
            token: params.preview.token,
            document_id: params.preview.document_id,
            items: params
                .preview
                .items
                .into_iter()
                .map(|item| StorageReplaceItem {
                    segment_id: item.segment_id,
                    revision: item.revision,
                    field: storage_editor_field(item.field),
                    before: item.before,
                    after: item.after,
                    replacements: item.replacements,
                })
                .collect(),
        };
        Ok(editor_mutation_result(
            self.store.apply_replace_preview(&preview)?,
        ))
    }

    pub fn split_segment(&mut self, params: SplitSegmentParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.split_segment(
            &params.segment_id,
            params.source_offset,
            params.target_offset,
            params.expected_revision,
        )?))
    }

    pub fn merge_segments(&mut self, params: MergeSegmentsParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.merge_segments(
            &params.first_segment_id,
            &params.second_segment_id,
            params.first_expected_revision,
            params.second_expected_revision,
        )?))
    }

    pub fn correct_source(&mut self, params: CorrectSourceParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(
            self.store.generic_source_correction(
                &params.segment_id,
                &params.source_text,
                &params.reason,
                params.expected_revision,
            )?,
        ))
    }

    pub fn list_segment_comments(
        &self,
        params: SegmentCommentListParams,
    ) -> Result<SegmentCommentListResult> {
        Ok(SegmentCommentListResult {
            comments: self
                .store
                .list_editor_comments(&params.segment_id, params.include_resolved)?,
        })
    }

    pub fn create_segment_comment(
        &mut self,
        params: CreateSegmentCommentParams,
    ) -> Result<translunar_domain::EditorComment> {
        Ok(self
            .store
            .create_editor_comment(&params.segment_id, &params.author, &params.text)?)
    }

    pub fn update_segment_comment(
        &mut self,
        params: UpdateSegmentCommentParams,
    ) -> Result<translunar_domain::EditorComment> {
        Ok(self.store.update_editor_comment(
            &params.comment_id,
            &params.text,
            params.expected_revision,
        )?)
    }

    pub fn resolve_segment_comment(
        &mut self,
        params: ResolveSegmentCommentParams,
    ) -> Result<translunar_domain::EditorComment> {
        Ok(self.store.resolve_editor_comment(
            &params.comment_id,
            params.resolved,
            params.expected_revision,
        )?)
    }

    pub fn delete_segment_comment(
        &mut self,
        params: DeleteSegmentCommentParams,
    ) -> Result<EmptyResult> {
        self.store
            .delete_editor_comment(&params.comment_id, params.expected_revision)?;
        Ok(EmptyResult {})
    }

    pub fn spell_check(&self, params: SpellCheckParams) -> Result<SpellCheckResult> {
        let limit = bounded_page_size(params.limit)? as usize;
        if params.text.len() > 65_536 {
            return Err(EngineError::InvalidRequest(
                "spell-check text must be at most 65536 bytes".to_string(),
            ));
        }
        let words = self
            .store
            .list_dictionary_words(&params.locale)?
            .into_iter()
            .map(|word| normalize_dictionary_word(&word))
            .collect::<BTreeSet<_>>();
        let (available, provider, mut findings) = if let Some((provider, findings)) =
            run_hunspell(&params.locale, &params.text, &words, limit)
        {
            (true, provider, findings)
        } else {
            (
                false,
                "builtin-fallback".to_string(),
                check_user_dictionary(&params.text, &words, limit),
            )
        };
        if findings.len() < limit {
            findings.extend(cjk_assistance(&params.text, limit - findings.len()));
        }
        Ok(SpellCheckResult {
            available,
            provider,
            findings,
        })
    }

    pub fn list_dictionary(&self, params: DictionaryListParams) -> Result<DictionaryListResult> {
        Ok(DictionaryListResult {
            words: self.store.list_dictionary_words(&params.locale)?,
            locale: params.locale,
        })
    }

    pub fn add_dictionary_word(
        &mut self,
        params: DictionaryWordParams,
    ) -> Result<DictionaryListResult> {
        Ok(DictionaryListResult {
            words: self
                .store
                .add_dictionary_word(&params.locale, &params.word)?,
            locale: params.locale,
        })
    }

    pub fn remove_dictionary_word(
        &mut self,
        params: DictionaryWordParams,
    ) -> Result<DictionaryListResult> {
        Ok(DictionaryListResult {
            words: self
                .store
                .remove_dictionary_word(&params.locale, &params.word)?,
            locale: params.locale,
        })
    }

    pub fn editor_history(&self, params: EditorHistoryParams) -> Result<EditorHistoryResult> {
        let limit = bounded_page_size(params.limit)?;
        let (operations, total, can_undo, can_redo) =
            self.store
                .editor_history(&params.project_id, params.offset, limit)?;
        Ok(EditorHistoryResult {
            operations,
            total,
            can_undo,
            can_redo,
        })
    }

    pub fn undo_editor(&mut self, params: EditorUndoRedoParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(
            self.store.undo_editor(&params.project_id)?,
        ))
    }

    pub fn redo_editor(&mut self, params: EditorUndoRedoParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(
            self.store.redo_editor(&params.project_id)?,
        ))
    }

    pub fn create_review(
        &mut self,
        params: ReviewCreateParams,
    ) -> Result<translunar_domain::ReviewRevision> {
        Ok(self.store.create_review_revision(&ReviewProposal {
            segment_id: &params.segment_id,
            proposed_target: params.proposed_target.as_deref(),
            proposed_source: params.proposed_source.as_deref(),
            proposed_target_tags: params.proposed_target_tags.as_deref(),
            author: &params.author,
            reason: &params.reason,
            expected_revision: params.expected_revision,
        })?)
    }

    pub fn set_editor_workflow(
        &mut self,
        params: SetEditorWorkflowParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.set_editor_workflow(
            &params.segment_id,
            params.state,
            params.expected_revision,
        )?))
    }

    pub fn list_reviews(&self, params: ReviewListParams) -> Result<ReviewListResult> {
        Ok(ReviewListResult {
            revisions: self
                .store
                .list_review_revisions(&params.document_id, params.include_closed)?,
        })
    }

    pub fn accept_review(&mut self, params: ReviewDecisionParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.accept_review(
            &params.review_id,
            params.expected_segment_revision,
        )?))
    }

    pub fn reject_review(
        &mut self,
        params: ReviewDecisionParams,
    ) -> Result<translunar_domain::ReviewRevision> {
        Ok(self
            .store
            .reject_review(&params.review_id, params.expected_segment_revision)?)
    }

    pub fn get_editor_preferences(&self, _params: EmptyParams) -> Result<EditorPreferences> {
        self.store.get_editor_preferences().map_err(Into::into)
    }

    pub fn update_editor_preferences(
        &mut self,
        params: UpdateEditorPreferencesParams,
    ) -> Result<EditorPreferences> {
        self.store
            .update_editor_preferences(&params.preferences)
            .map_err(Into::into)
    }

    pub fn list_pdf_pages(&self, params: PdfPageListParams) -> Result<PdfPageListResult> {
        let document = self.store.get_document(&params.document_id)?;
        if document.document.filter_id != "builtin.pdf" {
            return Err(EngineError::InvalidRequest(
                "pdf.page.list requires a PDF document".to_string(),
            ));
        }
        let segments = collapse_structural_segments(self.store.all_segments(&params.document_id)?)?;
        let mut counts = BTreeMap::<u32, (u32, u32, Vec<String>)>::new();
        for segment in &segments {
            let path = PdfPath::decode(&segment.structural_path)
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
            let count = counts.entry(path.page).or_default();
            count.0 = count
                .0
                .checked_add(1)
                .ok_or_else(|| EngineError::InvalidState("PDF block count overflow".to_string()))?;
            if path.source_kind == "ocr" {
                count.1 = count.1.checked_add(1).ok_or_else(|| {
                    EngineError::InvalidState("PDF OCR block count overflow".to_string())
                })?;
            }
            count.2.push(segment.id.clone());
        }
        let layouts = PdfFilter
            .page_layouts(&ImportRequest::new(document.managed_source_path.clone()))
            .map_err(map_pdf_service_error)?;
        Ok(PdfPageListResult {
            pages: layouts
                .into_iter()
                .map(|layout| {
                    let (block_count, ocr_block_count, segment_ids) = counts
                        .get(&layout.summary.page)
                        .cloned()
                        .unwrap_or_default();
                    PdfPageSummary {
                        page: layout.summary.page,
                        width: layout.summary.width,
                        height: layout.summary.height,
                        block_count,
                        ocr_block_count,
                        segment_ids,
                    }
                })
                .collect(),
        })
    }

    pub fn get_pdf_page(&self, params: PdfPageGetParams) -> Result<PdfPageDetail> {
        if !(72..=200).contains(&params.dpi) {
            return Err(EngineError::InvalidRequest(
                "PDF page DPI must be between 72 and 200".to_string(),
            ));
        }
        let document = self.store.get_document(&params.document_id)?;
        if document.document.filter_id != "builtin.pdf" {
            return Err(EngineError::InvalidRequest(
                "pdf.page.get requires a PDF document".to_string(),
            ));
        }
        let layouts = PdfFilter
            .page_layouts(&ImportRequest::new(document.managed_source_path.clone()))
            .map_err(map_pdf_service_error)?;
        let layout = layouts
            .into_iter()
            .find(|layout| layout.summary.page == params.page)
            .ok_or_else(|| {
                EngineError::Storage(StorageError::NotFound {
                    entity: "pdf_page",
                    id: params.page.to_string(),
                })
            })?;
        let temporary = tempfile::Builder::new()
            .prefix("pdf-preview-")
            .suffix(".png")
            .tempfile_in(&self.store.paths().temporary)?;
        let path = temporary.path().to_path_buf();
        drop(temporary);
        PdfFilter
            .render_page(
                &document.managed_source_path,
                params.page,
                params.dpi,
                &path,
            )
            .map_err(map_pdf_service_error)?;
        let image = std::fs::read(&path);
        let _ = std::fs::remove_file(&path);
        let image = image?;
        if image.len() > 32 * 1024 * 1024 {
            return Err(EngineError::InvalidState(
                "rendered PDF page exceeds the 32 MiB limit".to_string(),
            ));
        }
        let mut blocks = self
            .store
            .all_segments(&params.document_id)?
            .into_iter()
            .filter_map(|segment| {
                let path = PdfPath::decode(&segment.structural_path).ok()?;
                (path.page == params.page).then_some((path, segment))
            })
            .collect::<Vec<_>>();
        blocks.sort_by_key(|(path, _)| path.order);
        Ok(PdfPageDetail {
            page: params.page,
            width: layout.summary.width,
            height: layout.summary.height,
            dpi: params.dpi,
            image_png_base64: base64::engine::general_purpose::STANDARD.encode(image),
            blocks: blocks
                .into_iter()
                .map(|(path, segment)| PdfPageBlock {
                    segment_id: segment.id,
                    revision: segment.revision,
                    source_text: segment.source_text,
                    target_text: segment.target_text,
                    state: segment.state,
                    bbox: PdfBoundingBox {
                        x: path.x as f64 / 1000.0,
                        y: path.y as f64 / 1000.0,
                        width: path.width as f64 / 1000.0,
                        height: path.height as f64 / 1000.0,
                    },
                    kind: path.kind,
                    source_kind: path.source_kind,
                    confidence: path.confidence,
                })
                .collect(),
        })
    }

    pub fn correct_ocr(&mut self, params: CorrectOcrParams) -> Result<Segment> {
        self.store
            .correct_ocr_source(
                &params.segment_id,
                &params.source_text,
                &params.reason,
                params.expected_revision,
            )
            .map_err(Into::into)
    }

    pub fn update_target(&mut self, params: UpdateTargetParams) -> Result<Segment> {
        self.store
            .update_target(
                &params.segment_id,
                &params.target_text,
                params.expected_revision,
            )
            .map_err(Into::into)
    }

    pub fn confirm_segment(
        &mut self,
        params: ConfirmSegmentParams,
    ) -> Result<ConfirmSegmentResult> {
        let confirmation = self
            .store
            .confirm_segment(&params.segment_id, params.expected_revision)?;
        Ok(ConfirmSegmentResult {
            segment: confirmation.segment,
            counts: confirmation.counts,
            tm_entry: confirmation.tm_entry,
            qa_issues: confirmation.qa_issues,
            propagated: confirmation.propagated,
        })
    }

    pub fn lookup_exact(&self, params: ExactLookupParams) -> Result<ExactLookupResult> {
        Ok(ExactLookupResult {
            matches: self
                .store
                .lookup_exact(&params.project_id, &params.source_text)?,
        })
    }

    pub fn list_tm_libraries(&self, params: TmLibraryListParams) -> Result<TmLibraryPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_tm_libraries(params.project_id.as_deref(), params.offset, limit)?;
        let mounts = params
            .project_id
            .as_deref()
            .map(|project_id| self.store.list_tm_library_mounts(project_id))
            .transpose()?
            .unwrap_or_default();
        Ok(TmLibraryPage {
            items,
            mounts,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_tm_library(
        &mut self,
        params: TmLibraryCreateParams,
    ) -> Result<translunar_asset_core::TmLibrary> {
        Ok(self.store.create_tm_library(NewTmLibrary {
            name: params.name,
            source_locale: params.source_locale,
            target_locale: params.target_locale,
            domain: params.domain,
            writable: params.writable,
            owner_project_id: params.owner_project_id,
        })?)
    }

    pub fn mount_tm_library(
        &mut self,
        params: TmLibraryMountParams,
    ) -> Result<translunar_asset_core::TmLibraryMount> {
        Ok(self.store.mount_tm_library(
            &params.project_id,
            &params.library_id,
            params.mode,
            params.priority,
            params.enabled,
            params.expected_revision,
        )?)
    }

    pub fn unmount_tm_library(&mut self, params: TmLibraryUnmountParams) -> Result<EmptyResult> {
        self.store.unmount_tm_library(
            &params.project_id,
            &params.library_id,
            params.expected_revision,
        )?;
        Ok(EmptyResult {})
    }

    pub fn search_tm(&self, params: TmSearchParams) -> Result<TmSearchResult> {
        let limit = bounded_page_size(params.limit)?;
        if params.threshold > 101 {
            return Err(EngineError::InvalidRequest(
                "threshold must be between 0 and 101".to_string(),
            ));
        }
        let (matches, total) = self.store.search_tm(&StorageTmSearchRequest {
            project_id: params.project_id,
            source_locale: params.source_locale,
            target_locale: params.target_locale,
            query: params.query,
            threshold: params.threshold,
            offset: params.offset,
            limit,
            library_ids: params.library_ids,
            domain: params.domain,
            since_ms: params.since_ms,
            origin_project_id: params.origin_project_id,
            origin_document_id: params.origin_document_id,
            context_before_hash: params.context_before_hash,
            context_after_hash: params.context_after_hash,
        })?;
        Ok(TmSearchResult {
            matches,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn concordance(&self, params: ConcordanceParams) -> Result<ConcordanceResult> {
        let limit = bounded_page_size(params.limit)?;
        let (hits, total) = self.store.concordance(&StorageConcordanceRequest {
            project_id: params.project_id,
            query: params.query,
            side: params.side,
            offset: params.offset,
            limit,
        })?;
        Ok(ConcordanceResult {
            hits,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn import_tm(&mut self, params: TmImportParams) -> Result<TmImportResult> {
        let library = self.store.get_tm_library(&params.library_id)?;
        let bytes = read_asset_input(&params.source_path)?;
        let units = match params.format {
            AssetExchangeFormat::Tmx => translunar_asset_core::parse_tmx(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Csv => translunar_asset_core::parse_tm_csv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tsv => translunar_asset_core::parse_tm_tsv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tbx => {
                return Err(EngineError::InvalidRequest(
                    "TBX is a termbase format, not a translation-memory format".to_string(),
                ));
            }
        };
        if units.len() > 1_000_000 {
            return Err(EngineError::InvalidRequest(
                "asset import exceeds the 1,000,000-unit limit".to_string(),
            ));
        }
        let (inserted, skipped) = self.store.import_tm_units(&library.id, &units)?;
        Ok(TmImportResult {
            library_id: library.id,
            inserted,
            skipped,
            diagnostics: Vec::new(),
        })
    }

    pub fn export_tm(&self, params: TmExportParams) -> Result<TmExportResult> {
        let library = self.store.get_tm_library(&params.library_id)?;
        let units = self.store.export_tm_units(&library.id)?;
        let exchange = units.iter().map(tm_unit_to_exchange).collect::<Vec<_>>();
        let source_locale = library.source_locale.clone();
        let target_locale = library.target_locale.clone();
        let format = params.format;
        let output_path = PathBuf::from(&params.output_path);
        publish_asset_file(
            &output_path,
            |file| {
                match format {
                    AssetExchangeFormat::Tmx => translunar_asset_core::write_tmx(file, &exchange),
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::write_tm_csv(file, &exchange)
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::write_tm_tsv(file, &exchange)
                    }
                    AssetExchangeFormat::Tbx => Err(AssetError::Invalid {
                        row: 0,
                        message: "TBX is a termbase format, not a translation-memory format"
                            .to_string(),
                    }),
                }
                .map_err(EngineError::from)
            },
            |path| {
                let bytes = std::fs::read(path)?;
                match format {
                    AssetExchangeFormat::Tmx => {
                        translunar_asset_core::parse_tmx(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::parse_tm_csv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::parse_tm_tsv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tbx => {
                        return Err(EngineError::InvalidRequest(
                            "invalid TM export format".to_string(),
                        ));
                    }
                }
                Ok(())
            },
        )?;
        Ok(TmExportResult {
            library_id: library.id,
            output_path: output_path.to_string_lossy().into_owned(),
            unit_count: u32::try_from(exchange.len()).map_err(|_| {
                EngineError::InvalidState("TM export unit count overflow".to_string())
            })?,
        })
    }

    pub fn list_termbases(&self, params: TermbaseListParams) -> Result<TermbasePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_termbases(Some(&params.project_id), params.offset, limit)?;
        let mounts = self.store.list_termbase_mounts(&params.project_id)?;
        Ok(TermbasePage {
            items,
            mounts,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_termbase(
        &mut self,
        params: TermbaseCreateParams,
    ) -> Result<translunar_asset_core::Termbase> {
        Ok(self
            .store
            .create_termbase(translunar_storage::NewTermbase {
                name: params.name,
                source_locale: params.source_locale,
                domain: params.domain,
                writable: params.writable,
            })?)
    }

    pub fn mount_termbase(
        &mut self,
        params: TermbaseMountParams,
    ) -> Result<translunar_asset_core::TermbaseMount> {
        Ok(self.store.mount_termbase(
            &params.project_id,
            &params.termbase_id,
            params.priority,
            params.writable,
            params.enabled,
            params.expected_revision,
        )?)
    }

    pub fn unmount_termbase(&mut self, params: TermbaseUnmountParams) -> Result<EmptyResult> {
        self.store.unmount_termbase(
            &params.project_id,
            &params.termbase_id,
            params.expected_revision,
        )?;
        Ok(EmptyResult {})
    }

    pub fn search_terms(&self, params: TermSearchParams) -> Result<TermSearchResult> {
        let limit = bounded_page_size(params.limit)?;
        let (matches, total) = self.store.search_terms(&StorageTermSearchRequest {
            project_id: params.project_id,
            text: params.text,
            offset: params.offset,
            limit,
            termbase_ids: params.termbase_ids,
        })?;
        Ok(TermSearchResult {
            matches,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn upsert_term(
        &mut self,
        params: TermUpsertParams,
    ) -> Result<translunar_asset_core::TermEntry> {
        let translations = params
            .translations
            .into_iter()
            .map(|translation| NewTermTranslation {
                locale: translation.locale,
                term: translation.term,
                preferred: translation.preferred,
                forbidden: translation.forbidden,
            })
            .collect();
        Ok(self.store.upsert_term_entry(NewTermEntry {
            termbase_id: params.termbase_id,
            source_locale: params.source_locale,
            source_term: params.source_term,
            part_of_speech: params.part_of_speech,
            definition: params.definition,
            example: params.example,
            domain: params.domain,
            status: params.status,
            translations,
        })?)
    }

    pub fn import_termbase(
        &mut self,
        params: TermbaseImportParams,
    ) -> Result<TermbaseImportResult> {
        let termbase = self.store.get_termbase(&params.termbase_id)?;
        let bytes = read_asset_input(&params.source_path)?;
        let entries = match params.format {
            AssetExchangeFormat::Tbx => translunar_asset_core::parse_tbx(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Csv => translunar_asset_core::parse_term_csv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tsv => translunar_asset_core::parse_term_tsv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tmx => {
                return Err(EngineError::InvalidRequest(
                    "TMX is a translation-memory format, not a termbase format".to_string(),
                ));
            }
        };
        if entries.len() > 1_000_000 {
            return Err(EngineError::InvalidRequest(
                "termbase import exceeds the 1,000,000-entry limit".to_string(),
            ));
        }
        let (inserted, skipped) = self.store.import_term_entries(&termbase.id, &entries)?;
        Ok(TermbaseImportResult {
            termbase_id: termbase.id,
            inserted,
            skipped,
            diagnostics: Vec::new(),
        })
    }

    pub fn export_termbase(&self, params: TermbaseExportParams) -> Result<TermbaseExportResult> {
        let termbase = self.store.get_termbase(&params.termbase_id)?;
        let entries = self.store.export_term_entries(&termbase.id)?;
        let exchange = entries
            .iter()
            .filter_map(|entry| term_entry_to_exchange(entry, &params.target_locale))
            .collect::<Vec<_>>();
        let source_locale = termbase.source_locale.clone();
        let target_locale = params.target_locale.clone();
        let format = params.format;
        let output_path = PathBuf::from(&params.output_path);
        publish_asset_file(
            &output_path,
            |file| {
                match format {
                    AssetExchangeFormat::Tbx => translunar_asset_core::write_tbx(file, &exchange),
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::write_term_csv(file, &exchange)
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::write_term_tsv(file, &exchange)
                    }
                    AssetExchangeFormat::Tmx => Err(AssetError::Invalid {
                        row: 0,
                        message: "TMX is a translation-memory format, not a termbase format"
                            .to_string(),
                    }),
                }
                .map_err(EngineError::from)
            },
            |path| {
                let bytes = std::fs::read(path)?;
                match format {
                    AssetExchangeFormat::Tbx => {
                        translunar_asset_core::parse_tbx(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::parse_term_csv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::parse_term_tsv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tmx => {
                        return Err(EngineError::InvalidRequest(
                            "invalid termbase export format".to_string(),
                        ));
                    }
                }
                Ok(())
            },
        )?;
        Ok(TermbaseExportResult {
            termbase_id: termbase.id,
            output_path: output_path.to_string_lossy().into_owned(),
            entry_count: u32::try_from(exchange.len()).map_err(|_| {
                EngineError::InvalidState("termbase export entry count overflow".to_string())
            })?,
        })
    }

    pub fn run_document_qa(&mut self, document_id: &str) -> Result<QaListResult> {
        Ok(QaListResult {
            issues: self.store.run_document_qa(document_id)?,
        })
    }

    pub fn list_qa(&self, params: ListQaParams) -> Result<QaListResult> {
        Ok(QaListResult {
            issues: self
                .store
                .list_qa(&params.document_id, params.include_resolved)?,
        })
    }

    pub fn export_docx(&self, params: ExportDocxParams) -> Result<ExportDocxResult> {
        let result = self.export_document(ExportDocumentParams {
            document_id: params.document_id,
            output_path: params.output_path,
        })?;
        Ok(ExportDocxResult {
            output_path: result.output_path,
            translated_segments: result.translated_segments,
        })
    }

    pub fn export_document(&self, params: ExportDocumentParams) -> Result<ExportDocumentResult> {
        let document = self.store.get_document(&params.document_id)?;
        let segments = self.store.all_segments(&params.document_id)?;
        let output_path = PathBuf::from(&params.output_path);
        let filter = self
            .filters
            .resolve(&document.document.filter_id)
            .map_err(EngineError::Export)?;
        let report = filter
            .export(ExportRequest {
                source: &document.managed_source_path,
                output: &output_path,
                segments: &segments,
            })
            .map_err(EngineError::Export)?;
        Ok(ExportDocumentResult {
            output_path: report.output_path,
            filter_id: document.document.filter_id,
            translated_segments: report.translated_segments,
            degradation: report.degradation,
        })
    }

    pub fn list_filters(&self, _params: EmptyParams) -> FilterListResult {
        FilterListResult {
            filters: self.filters.descriptors(),
        }
    }

    pub fn list_history(&self, params: HistoryListParams) -> Result<OperationPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_operations(
            &params.project_id,
            params.offset,
            limit,
            params.descending,
        )?;
        Ok(OperationPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn check_health(&self, _params: EmptyParams) -> Result<DataHealthReport> {
        Ok(self.store.check_health()?)
    }

    pub fn create_backup(&self, params: CreateBackupParams) -> Result<BackupResult> {
        if params.destination_path.trim().is_empty() {
            return Err(EngineError::InvalidRequest(
                "destinationPath must not be empty".to_string(),
            ));
        }
        let destination = PathBuf::from(&params.destination_path);
        let manifest = self.store.create_backup(&destination)?;
        Ok(BackupResult {
            destination_path: destination.to_string_lossy().into_owned(),
            manifest,
        })
    }

    pub fn pipeline_capabilities(&self) -> PipelineCapabilityResult {
        PipelineCapabilityResult {
            status_values: vec![
                translunar_pipeline::PipelineRunStatus::Queued,
                translunar_pipeline::PipelineRunStatus::Running,
                translunar_pipeline::PipelineRunStatus::Canceling,
                translunar_pipeline::PipelineRunStatus::Canceled,
                translunar_pipeline::PipelineRunStatus::Interrupted,
                translunar_pipeline::PipelineRunStatus::Succeeded,
                translunar_pipeline::PipelineRunStatus::Failed,
            ],
            steps: self.pipeline.descriptors(),
        }
    }

    pub fn validate_pipeline(&self, params: ValidatePipelineParams) -> PipelineValidationResult {
        self.pipeline.validate(params.name, params.steps)
    }

    pub fn create_pipeline(&mut self, params: CreatePipelineParams) -> Result<PipelineDefinition> {
        let validation = self
            .pipeline
            .validate(params.name.clone(), params.steps.clone());
        if !validation.valid {
            return Err(EngineError::InvalidRequest(validation.errors.join("; ")));
        }
        self.store
            .create_pipeline_definition(NewPipelineDefinition {
                project_id: params.project_id,
                name: params.name,
                steps: params.steps,
            })
            .map_err(Into::into)
    }

    pub fn list_pipelines(&self, params: PipelineListParams) -> Result<PipelineDefinitionPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_pipeline_definitions(
            params.project_id.as_deref(),
            params.offset,
            limit,
        )?;
        Ok(PipelineDefinitionPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_pipeline(&self, params: PipelineIdParams) -> Result<PipelineDefinition> {
        Ok(self.store.get_pipeline_definition(&params.pipeline_id)?)
    }

    pub fn run_pipeline(
        &mut self,
        params: RunPipelineParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        let definition = self.store.get_pipeline_definition(&params.definition_id)?;
        self.pipeline
            .registry
            .validate_definition(&definition)
            .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        let snapshot = self.store.create_pipeline_run(
            &params.definition_id,
            &params.project_id,
            params.document_id.as_deref(),
            params.input,
        )?;
        let run_id = snapshot.run.id.clone();
        self.pipeline.spawn(run_id);
        Ok(to_protocol_pipeline_snapshot(snapshot))
    }

    pub fn list_pipeline_runs(&self, params: PipelineRunListParams) -> Result<PipelineRunPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_pipeline_runs(&params.project_id, params.offset, limit)?;
        Ok(PipelineRunPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_pipeline_run(
        &self,
        params: PipelineRunIdParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        Ok(to_protocol_pipeline_snapshot(
            self.store.get_pipeline_run(&params.run_id)?,
        ))
    }

    pub fn cancel_pipeline_run(
        &mut self,
        params: PipelineRunRevisionParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        let snapshot = self
            .store
            .request_pipeline_cancel(&params.run_id, params.expected_revision)?;
        self.pipeline.cancel(&params.run_id);
        Ok(to_protocol_pipeline_snapshot(snapshot))
    }

    pub fn resume_pipeline_run(
        &mut self,
        params: PipelineRunRevisionParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        let current = self.store.get_pipeline_run(&params.run_id)?;
        if current.run.status == translunar_pipeline::PipelineRunStatus::Interrupted {
            if current.run.revision != params.expected_revision {
                return Err(EngineError::Storage(StorageError::EntityConflict {
                    entity: "pipeline_run",
                    id: params.run_id.clone(),
                    expected_revision: params.expected_revision,
                    actual_revision: current.run.revision,
                }));
            }
            let definition = self
                .store
                .get_pipeline_definition(&current.run.definition_id)?;
            let step = definition
                .steps
                .get(current.run.current_step_index as usize)
                .ok_or_else(|| {
                    EngineError::InvalidState(format!(
                        "pipeline run points to missing step {}",
                        current.run.current_step_index
                    ))
                })?;
            let descriptor = self
                .pipeline
                .registry
                .resolve(&step.step_id)
                .map_err(|error| EngineError::InvalidState(error.to_string()))?
                .descriptor();
            if !descriptor.resumable {
                let failed = self.store.fail_pipeline_run(
                    &params.run_id,
                    PipelineFailure {
                        code: "step_not_resumable".to_string(),
                        message: format!("pipeline step {} cannot resume", descriptor.id),
                        retryable: false,
                    },
                )?;
                return Ok(to_protocol_pipeline_snapshot(failed));
            }
        }
        let snapshot = self
            .store
            .resume_pipeline_run(&params.run_id, params.expected_revision)?;
        let run_id = snapshot.run.id.clone();
        self.pipeline.spawn(run_id);
        Ok(to_protocol_pipeline_snapshot(snapshot))
    }
}

fn to_protocol_pipeline_snapshot(
    snapshot: translunar_storage::PipelineRunSnapshot,
) -> ProtocolPipelineRunSnapshot {
    ProtocolPipelineRunSnapshot {
        run: snapshot.run,
        steps: snapshot.steps,
    }
}

fn read_asset_input(path: &str) -> Result<Vec<u8>> {
    if path.trim().is_empty() {
        return Err(EngineError::InvalidRequest(
            "sourcePath must not be empty".to_string(),
        ));
    }
    let path = Path::new(path);
    let metadata = path.metadata().map_err(EngineError::Io)?;
    if !metadata.is_file() {
        return Err(EngineError::InvalidRequest(
            "asset source path must name a file".to_string(),
        ));
    }
    if metadata.len() > 256 * 1024 * 1024 {
        return Err(EngineError::InvalidRequest(
            "asset source exceeds the 256 MiB limit".to_string(),
        ));
    }
    std::fs::read(path).map_err(EngineError::Io)
}

fn tm_unit_to_exchange(unit: &translunar_asset_core::TmUnit) -> TmExchangeUnit {
    TmExchangeUnit {
        source_locale: unit.source_locale.clone(),
        target_locale: unit.target_locale.clone(),
        source_text: unit.source_text.clone(),
        target_text: unit.target_text.clone(),
        domain: unit.domain.clone(),
        author: unit.author.clone(),
        created_at_ms: Some(unit.created_at_ms),
        metadata: unit.metadata.clone(),
    }
}

fn term_entry_to_exchange(
    entry: &translunar_asset_core::TermEntry,
    target_locale: &str,
) -> Option<TermExchangeEntry> {
    let target_translations = entry
        .translations
        .iter()
        .filter(|translation| {
            target_locale.trim().is_empty() || translation.locale == target_locale
        })
        .map(|translation| TermExchangeTranslation {
            locale: translation.locale.clone(),
            term: translation.term.clone(),
            preferred: translation.preferred,
            forbidden: translation.forbidden,
        })
        .collect::<Vec<_>>();
    if target_translations.is_empty() {
        return None;
    }
    Some(TermExchangeEntry {
        source_locale: entry.source_locale.clone(),
        source_term: entry.source_term.clone(),
        target_translations,
        part_of_speech: entry.part_of_speech.clone(),
        definition: entry.definition.clone(),
        example: entry.example.clone(),
        domain: entry.domain.clone(),
        status: match entry.status {
            TermStatus::Candidate => "candidate",
            TermStatus::Active => "active",
            TermStatus::Deprecated => "deprecated",
        }
        .to_string(),
        metadata: Default::default(),
    })
}

fn publish_asset_file(
    output_path: &Path,
    write: impl FnOnce(&mut File) -> Result<()>,
    validate: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    if output_path.as_os_str().is_empty() {
        return Err(EngineError::InvalidRequest(
            "outputPath must not be empty".to_string(),
        ));
    }
    if output_path.exists() {
        return Err(EngineError::InvalidState(
            "asset export destination already exists".to_string(),
        ));
    }
    let parent = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    write(temporary.as_file_mut())?;
    temporary.as_file_mut().flush()?;
    temporary.as_file().sync_all()?;
    validate(temporary.path())?;
    temporary
        .persist_noclobber(output_path)
        .map_err(|error| EngineError::Io(error.error))?;
    Ok(())
}

pub struct RpcDispatcher {
    service: EngineService,
    initialized: bool,
}

impl RpcDispatcher {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            service: EngineService::open(data_dir)?,
            initialized: false,
        })
    }

    pub fn handle(&mut self, request: RpcRequest) -> RpcResponse {
        let id = request.id.clone();
        match self.dispatch(request) {
            Ok(value) => RpcResponse::success(id, value),
            Err(error) => RpcResponse::failure(id, rpc_error(error)),
        }
    }

    fn dispatch(&mut self, request: RpcRequest) -> Result<Value> {
        if request.jsonrpc != "2.0" {
            return Err(EngineError::InvalidRequest(
                "jsonrpc must be exactly '2.0'".to_string(),
            ));
        }
        if request.method == methods::INITIALIZE {
            return self.initialize(parse_params(request.params)?);
        }
        if !self.initialized {
            return Err(EngineError::InvalidState(
                "engine.initialize must succeed before other methods".to_string(),
            ));
        }

        match request.method.as_str() {
            methods::PROJECT_CREATE => {
                serialize_result(self.service.create_project(parse_params(request.params)?)?)
            }
            methods::PROJECT_GET => {
                let params: ProjectIdParams = parse_params(request.params)?;
                serialize_result(self.service.get_project(&params.project_id)?)
            }
            methods::PROJECT_LIST => {
                serialize_result(self.service.list_projects(parse_params(request.params)?)?)
            }
            methods::PROJECT_UPDATE => {
                serialize_result(self.service.update_project(parse_params(request.params)?)?)
            }
            methods::PROJECT_SET_LIFECYCLE => serialize_result(
                self.service
                    .set_project_lifecycle(parse_params(request.params)?)?,
            ),
            methods::DOCUMENT_LIST => {
                serialize_result(self.service.list_documents(parse_params(request.params)?)?)
            }
            methods::DOCUMENT_GET => {
                let params: DocumentIdParams = parse_params(request.params)?;
                serialize_result(self.service.get_document(&params.document_id)?)
            }
            methods::DOCUMENT_IMPORT => serialize_result(
                self.service
                    .import_document(parse_params(request.params)?)?,
            ),
            methods::DOCUMENT_IMPORT_DOCX => {
                serialize_result(self.service.import_docx(parse_params(request.params)?)?)
            }
            methods::SEGMENT_LIST => {
                serialize_result(self.service.list_segments(parse_params(request.params)?)?)
            }
            methods::SEGMENT_UPDATE_TARGET => {
                serialize_result(self.service.update_target(parse_params(request.params)?)?)
            }
            methods::SEGMENT_CONFIRM => serialize_result(
                self.service
                    .confirm_segment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_EDITOR_LIST => serialize_result(
                self.service
                    .list_editor_segments(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_TAG_SET => serialize_result(
                self.service
                    .set_segment_tags(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_CHINESE_CONVERT => serialize_result(
                self.service
                    .convert_segment_chinese(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_PROPAGATE => serialize_result(
                self.service
                    .propagate_segment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_FIND => {
                serialize_result(self.service.find_segments(parse_params(request.params)?)?)
            }
            methods::SEGMENT_REPLACE_PREVIEW => serialize_result(
                self.service
                    .preview_replace(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_REPLACE_APPLY => {
                serialize_result(self.service.apply_replace(parse_params(request.params)?)?)
            }
            methods::SEGMENT_SPLIT => {
                serialize_result(self.service.split_segment(parse_params(request.params)?)?)
            }
            methods::SEGMENT_MERGE => {
                serialize_result(self.service.merge_segments(parse_params(request.params)?)?)
            }
            methods::SEGMENT_CORRECT_SOURCE => {
                serialize_result(self.service.correct_source(parse_params(request.params)?)?)
            }
            methods::SEGMENT_WORKFLOW_SET => serialize_result(
                self.service
                    .set_editor_workflow(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_LIST => serialize_result(
                self.service
                    .list_segment_comments(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_CREATE => serialize_result(
                self.service
                    .create_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_UPDATE => serialize_result(
                self.service
                    .update_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_RESOLVE => serialize_result(
                self.service
                    .resolve_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_DELETE => serialize_result(
                self.service
                    .delete_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_SPELL_CHECK => {
                serialize_result(self.service.spell_check(parse_params(request.params)?)?)
            }
            methods::DICTIONARY_LIST => serialize_result(
                self.service
                    .list_dictionary(parse_params(request.params)?)?,
            ),
            methods::DICTIONARY_ADD => serialize_result(
                self.service
                    .add_dictionary_word(parse_params(request.params)?)?,
            ),
            methods::DICTIONARY_REMOVE => serialize_result(
                self.service
                    .remove_dictionary_word(parse_params(request.params)?)?,
            ),
            methods::EDITOR_UNDO => {
                serialize_result(self.service.undo_editor(parse_params(request.params)?)?)
            }
            methods::EDITOR_REDO => {
                serialize_result(self.service.redo_editor(parse_params(request.params)?)?)
            }
            methods::EDITOR_HISTORY => {
                serialize_result(self.service.editor_history(parse_params(request.params)?)?)
            }
            methods::REVIEW_CREATE => {
                serialize_result(self.service.create_review(parse_params(request.params)?)?)
            }
            methods::REVIEW_LIST => {
                serialize_result(self.service.list_reviews(parse_params(request.params)?)?)
            }
            methods::REVIEW_ACCEPT => {
                serialize_result(self.service.accept_review(parse_params(request.params)?)?)
            }
            methods::REVIEW_REJECT => {
                serialize_result(self.service.reject_review(parse_params(request.params)?)?)
            }
            methods::EDITOR_PREFERENCES_GET => serialize_result(
                self.service
                    .get_editor_preferences(parse_params(request.params)?)?,
            ),
            methods::EDITOR_PREFERENCES_UPDATE => serialize_result(
                self.service
                    .update_editor_preferences(parse_params(request.params)?)?,
            ),
            methods::PDF_PAGE_LIST => {
                serialize_result(self.service.list_pdf_pages(parse_params(request.params)?)?)
            }
            methods::PDF_PAGE_GET => {
                serialize_result(self.service.get_pdf_page(parse_params(request.params)?)?)
            }
            methods::PDF_CORRECT_OCR => {
                serialize_result(self.service.correct_ocr(parse_params(request.params)?)?)
            }
            methods::TM_LOOKUP_EXACT => {
                serialize_result(self.service.lookup_exact(parse_params(request.params)?)?)
            }
            methods::TM_LIBRARY_LIST => serialize_result(
                self.service
                    .list_tm_libraries(parse_params(request.params)?)?,
            ),
            methods::TM_LIBRARY_CREATE => serialize_result(
                self.service
                    .create_tm_library(parse_params(request.params)?)?,
            ),
            methods::TM_LIBRARY_MOUNT => serialize_result(
                self.service
                    .mount_tm_library(parse_params(request.params)?)?,
            ),
            methods::TM_LIBRARY_UNMOUNT => serialize_result(
                self.service
                    .unmount_tm_library(parse_params(request.params)?)?,
            ),
            methods::TM_SEARCH => {
                serialize_result(self.service.search_tm(parse_params(request.params)?)?)
            }
            methods::TM_CONCORDANCE => {
                serialize_result(self.service.concordance(parse_params(request.params)?)?)
            }
            methods::TM_IMPORT => {
                serialize_result(self.service.import_tm(parse_params(request.params)?)?)
            }
            methods::TM_EXPORT => {
                serialize_result(self.service.export_tm(parse_params(request.params)?)?)
            }
            methods::TERMBASE_LIST => {
                serialize_result(self.service.list_termbases(parse_params(request.params)?)?)
            }
            methods::TERMBASE_CREATE => serialize_result(
                self.service
                    .create_termbase(parse_params(request.params)?)?,
            ),
            methods::TERMBASE_MOUNT => {
                serialize_result(self.service.mount_termbase(parse_params(request.params)?)?)
            }
            methods::TERMBASE_UNMOUNT => serialize_result(
                self.service
                    .unmount_termbase(parse_params(request.params)?)?,
            ),
            methods::TERM_SEARCH => {
                serialize_result(self.service.search_terms(parse_params(request.params)?)?)
            }
            methods::TERM_UPSERT => {
                serialize_result(self.service.upsert_term(parse_params(request.params)?)?)
            }
            methods::TERMBASE_IMPORT => serialize_result(
                self.service
                    .import_termbase(parse_params(request.params)?)?,
            ),
            methods::TERMBASE_EXPORT => serialize_result(
                self.service
                    .export_termbase(parse_params(request.params)?)?,
            ),
            methods::QA_RUN_DOCUMENT => {
                let params: DocumentIdParams = parse_params(request.params)?;
                serialize_result(self.service.run_document_qa(&params.document_id)?)
            }
            methods::QA_LIST => {
                serialize_result(self.service.list_qa(parse_params(request.params)?)?)
            }
            methods::DOCUMENT_EXPORT_DOCX => {
                serialize_result(self.service.export_docx(parse_params(request.params)?)?)
            }
            methods::DOCUMENT_EXPORT => serialize_result(
                self.service
                    .export_document(parse_params(request.params)?)?,
            ),
            methods::FILTER_LIST => {
                serialize_result(self.service.list_filters(parse_params(request.params)?))
            }
            methods::HISTORY_LIST => {
                serialize_result(self.service.list_history(parse_params(request.params)?)?)
            }
            methods::DATA_CHECK_HEALTH => {
                serialize_result(self.service.check_health(parse_params(request.params)?)?)
            }
            methods::DATA_CREATE_BACKUP => {
                serialize_result(self.service.create_backup(parse_params(request.params)?)?)
            }
            methods::PIPELINE_STEP_LIST => {
                let _: EmptyParams = parse_params(request.params)?;
                serialize_result(self.service.pipeline_capabilities())
            }
            methods::PIPELINE_CREATE => serialize_result(
                self.service
                    .create_pipeline(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_LIST => {
                serialize_result(self.service.list_pipelines(parse_params(request.params)?)?)
            }
            methods::PIPELINE_GET => {
                serialize_result(self.service.get_pipeline(parse_params(request.params)?)?)
            }
            methods::PIPELINE_VALIDATE => serialize_result(
                self.service
                    .validate_pipeline(parse_params(request.params)?),
            ),
            methods::PIPELINE_RUN => {
                serialize_result(self.service.run_pipeline(parse_params(request.params)?)?)
            }
            methods::PIPELINE_RUN_LIST => serialize_result(
                self.service
                    .list_pipeline_runs(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_RUN_GET => serialize_result(
                self.service
                    .get_pipeline_run(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_RUN_CANCEL => serialize_result(
                self.service
                    .cancel_pipeline_run(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_RUN_RESUME => serialize_result(
                self.service
                    .resume_pipeline_run(parse_params(request.params)?)?,
            ),
            _ => Err(EngineError::InvalidRequest(format!(
                "unknown method {}",
                request.method
            ))),
        }
    }

    fn initialize(&mut self, params: InitializeParams) -> Result<Value> {
        if params.protocol_version != PROTOCOL_VERSION {
            return Err(EngineError::InvalidRequest(format!(
                "unsupported protocol version {}; expected {}",
                params.protocol_version, PROTOCOL_VERSION
            )));
        }
        self.initialized = true;
        serialize_result(InitializeResult {
            protocol_version: PROTOCOL_VERSION,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            capabilities: vec![
                "docx".to_string(),
                "document.multi-file".to_string(),
                "filter.registry".to_string(),
                "history.operations".to_string(),
                "data.health".to_string(),
                "data.backup".to_string(),
                "pipeline.checkpoint".to_string(),
                "pipeline.document-qa".to_string(),
                "pipeline.resumable".to_string(),
                "project.lifecycle".to_string(),
                "translation-memory.exact".to_string(),
                "translation-memory.library".to_string(),
                "translation-memory.fuzzy-cjk".to_string(),
                "translation-memory.concordance".to_string(),
                "translation-memory.exchange".to_string(),
                "termbase".to_string(),
                "termbase.exchange".to_string(),
                "qa.number-mismatch".to_string(),
                "qa.term-forbidden".to_string(),
                "editor.projection".to_string(),
                "editor.protected-tags".to_string(),
                "editor.chinese-conversion.opencc".to_string(),
                "editor.find-replace".to_string(),
                "editor.split-merge".to_string(),
                "editor.comments".to_string(),
                "editor.spell-fallback".to_string(),
                "editor.spell-hunspell".to_string(),
                "editor.undo-redo".to_string(),
                "editor.review".to_string(),
                "editor.workflow".to_string(),
                "editor.preferences".to_string(),
            ],
        })
    }
}

pub fn invalid_rpc_response(message: impl Into<String>) -> RpcResponse {
    RpcResponse::failure(
        Value::Null,
        RpcError {
            code: ErrorCode::InvalidRequest,
            message: message.into(),
            data: None,
        },
    )
}

fn parse_params<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|error| EngineError::InvalidRequest(error.to_string()))
}

fn serialize_result<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|error| {
        EngineError::InvalidState(format!("failed to serialize engine result: {error}"))
    })
}

fn rpc_error(error: EngineError) -> RpcError {
    match error {
        EngineError::Storage(StorageError::NotFound { entity, id }) => RpcError {
            code: ErrorCode::NotFound,
            message: format!("{entity} not found: {id}"),
            data: Some(json!({ "entity": entity, "id": id })),
        },
        EngineError::Storage(StorageError::Conflict {
            segment_id,
            expected_revision,
            actual_revision,
        }) => RpcError {
            code: ErrorCode::Conflict,
            message: "segment was modified by another writer".to_string(),
            data: Some(json!({
                "segmentId": segment_id,
                "expectedRevision": expected_revision,
                "actualRevision": actual_revision,
            })),
        },
        EngineError::Storage(StorageError::EntityConflict {
            entity,
            id,
            expected_revision,
            actual_revision,
        }) => RpcError {
            code: ErrorCode::Conflict,
            message: format!("{entity} was modified by another writer"),
            data: Some(json!({
                "entity": entity,
                "id": id,
                "expectedRevision": expected_revision,
                "actualRevision": actual_revision,
            })),
        },
        EngineError::Storage(StorageError::InvalidState(message))
        | EngineError::InvalidState(message) => RpcError {
            code: ErrorCode::InvalidState,
            message,
            data: None,
        },
        EngineError::Import(FilterError::NotFound(id))
        | EngineError::Export(FilterError::NotFound(id)) => RpcError {
            code: ErrorCode::NotFound,
            message: format!("filter not found: {id}"),
            data: Some(json!({ "entity": "filter", "id": id })),
        },
        EngineError::Import(error) => RpcError {
            code: ErrorCode::UnsupportedDocument,
            message: error.to_string(),
            data: None,
        },
        EngineError::Export(error) => RpcError {
            code: ErrorCode::ExportError,
            message: error.to_string(),
            data: None,
        },
        EngineError::Asset(AssetError::Invalid { row, message }) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "asset exchange data is invalid".to_string(),
            data: Some(json!({ "row": row, "detail": message })),
        },
        EngineError::Asset(AssetError::Csv(error)) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "asset CSV data is invalid".to_string(),
            data: error
                .position()
                .map(|position| json!({ "row": position.line() })),
        },
        EngineError::Asset(AssetError::Xml(_error)) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "asset XML data is invalid".to_string(),
            data: None,
        },
        EngineError::Asset(AssetError::Io(error)) => RpcError {
            code: ErrorCode::StorageError,
            message: "asset exchange I/O failed".to_string(),
            data: Some(json!({ "kind": error.kind().to_string() })),
        },
        EngineError::InvalidRequest(message) => RpcError {
            code: ErrorCode::InvalidRequest,
            message,
            data: None,
        },
        EngineError::Storage(error) => RpcError {
            code: ErrorCode::StorageError,
            message: error.to_string(),
            data: None,
        },
        EngineError::Io(error) => RpcError {
            code: ErrorCode::StorageError,
            message: error.to_string(),
            data: None,
        },
    }
}

fn copy_and_hash(source: &Path, destination: &mut File) -> Result<String> {
    let mut reader = BufReader::new(File::open(source)?);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        destination.write_all(&buffer[..count])?;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;
    use translunar_domain::{ChineseConversionProfile, QaIssueStatus, SegmentState};
    use translunar_filter_docx::fixture;
    use translunar_filter_pptx::fixture as pptx_fixture;
    use translunar_filter_xlsx::fixture as xlsx_fixture;
    use translunar_protocol::ClientInfo;

    use super::*;

    struct TestContext {
        root: TempDir,
        source: PathBuf,
    }

    impl TestContext {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("temporary directory");
            let source = root.path().join("source.docx");
            fixture::write_fixture(&source).expect("write DOCX fixture");
            Self { root, source }
        }

        fn project(service: &mut EngineService) -> Project {
            service
                .create_project(CreateProjectParams {
                    name: "Retention".to_string(),
                    source_locale: "en-US".to_string(),
                    target_locale: "zh-CN".to_string(),
                    domain: "legal".to_string(),
                })
                .expect("create project")
        }
    }

    struct NonResumableStep;

    impl PipelineStep for NonResumableStep {
        fn descriptor(&self) -> StepDescriptor {
            StepDescriptor {
                id: "test.nonresumable".to_string(),
                version: "1".to_string(),
                display_name: "Non-resumable test step".to_string(),
                input: ArtifactKind::None,
                output: ArtifactKind::Json,
                config_schema_version: 1,
                resumable: false,
                cancellable: false,
            }
        }

        fn execute(
            &self,
            _context: StepExecutionContext,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            Ok(StepOutcome {
                output: json!({ "completed": true }),
                checkpoint: None,
                usage: None,
            })
        }
    }

    #[test]
    fn complete_service_flow_survives_restart() {
        let context = TestContext::new();
        let project;
        let document;
        let draft;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            project = TestContext::project(&mut service);
            document = service
                .import_docx(ImportDocxParams {
                    project_id: project.id.clone(),
                    source_path: context.source.to_string_lossy().into_owned(),
                })
                .expect("import DOCX");
            assert_eq!(document.segment_count, 3);
            let page = service
                .list_segments(SegmentListParams {
                    document_id: document.id.clone(),
                    offset: 0,
                    limit: 200,
                })
                .expect("list segments");
            draft = service
                .update_target(UpdateTargetParams {
                    segment_id: page.items[0].id.clone(),
                    target_text: "保留期为 60 天。".to_string(),
                    expected_revision: 0,
                })
                .expect("save draft");
        }

        let mut service = EngineService::open(context.root.path()).expect("reopen engine");
        let recovered = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 200,
            })
            .expect("recover segments");
        assert_eq!(recovered.items[0], draft);
        let confirmation = service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: draft.id.clone(),
                expected_revision: draft.revision,
            })
            .expect("confirm segment");
        assert_eq!(confirmation.segment.state, SegmentState::Confirmed);
        assert_eq!(confirmation.qa_issues.len(), 1);

        let exact = service
            .lookup_exact(ExactLookupParams {
                project_id: project.id.clone(),
                source_text: draft.source_text.clone(),
            })
            .expect("lookup TM");
        assert_eq!(exact.matches.len(), 1);

        let corrected = service
            .update_target(UpdateTargetParams {
                segment_id: draft.id.clone(),
                target_text: "保留期为 30 天。".to_string(),
                expected_revision: confirmation.segment.revision,
            })
            .expect("correct target");
        service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: corrected.id,
                expected_revision: corrected.revision,
            })
            .expect("confirm correction");
        let issues = service
            .list_qa(ListQaParams {
                document_id: document.id.clone(),
                include_resolved: true,
            })
            .expect("list QA");
        assert_eq!(issues.issues.len(), 1);
        assert_eq!(issues.issues[0].status, QaIssueStatus::Resolved);

        let output = context.root.path().join("translated.docx");
        let exported = service
            .export_docx(ExportDocxParams {
                document_id: document.id,
                output_path: output.to_string_lossy().into_owned(),
            })
            .expect("export DOCX");
        assert_eq!(exported.translated_segments, 1);
        let exported_units = DocxFilter
            .extract_units(&output)
            .expect("reopen exported DOCX");
        assert_eq!(exported_units[0].source_text, "保留期为 30 天。");
        assert_eq!(
            exported_units[2].source_text,
            "This paragraph remains untranslated."
        );
    }

    #[test]
    fn pipeline_runs_authoritative_document_qa_and_persists_progress() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "QA delivery".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "qa".to_string(),
                    step_id: "core.qa.document".to_string(),
                    config: Value::Null,
                }],
            })
            .expect("create pipeline");
        let run = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: Some(document.id),
                input: json!({}),
            })
            .expect("start pipeline");
        assert_eq!(
            run.run.status,
            translunar_pipeline::PipelineRunStatus::Queued
        );

        let mut final_snapshot = run;
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            final_snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: final_snapshot.run.id.clone(),
                })
                .expect("poll pipeline");
            if final_snapshot.run.status.is_terminal() {
                break;
            }
        }
        assert_eq!(
            final_snapshot.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded
        );
        assert_eq!(
            final_snapshot.steps[0].status,
            translunar_pipeline::PipelineStepStatus::Succeeded
        );
        assert!(final_snapshot.steps[0].output.is_some());
    }

    #[test]
    fn pipeline_cancellation_converges_to_canceled() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "Cancelable checkpoint".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "wait".to_string(),
                    step_id: "core.checkpoint".to_string(),
                    config: json!({ "delayMs": 1_000 }),
                }],
            })
            .expect("create cancelable pipeline");
        let mut snapshot = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: None,
                input: json!({}),
            })
            .expect("start cancelable pipeline");
        for _ in 0..100 {
            if snapshot.run.status == translunar_pipeline::PipelineRunStatus::Running {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: snapshot.run.id.clone(),
                })
                .expect("poll running pipeline");
        }
        let canceling = service
            .cancel_pipeline_run(PipelineRunRevisionParams {
                run_id: snapshot.run.id.clone(),
                expected_revision: snapshot.run.revision,
            })
            .expect("request cancellation");
        assert_eq!(
            canceling.run.status,
            translunar_pipeline::PipelineRunStatus::Canceling
        );
        let mut final_snapshot = canceling;
        for _ in 0..200 {
            if final_snapshot.run.status.is_terminal() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
            final_snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: final_snapshot.run.id.clone(),
                })
                .expect("poll canceled pipeline");
        }
        assert_eq!(
            final_snapshot.run.status,
            translunar_pipeline::PipelineRunStatus::Canceled
        );
        assert_eq!(
            final_snapshot.steps[0].status,
            translunar_pipeline::PipelineStepStatus::Canceled
        );
    }

    #[test]
    fn interrupted_resumable_pipeline_keeps_previous_checkpoint_and_completes() {
        let context = TestContext::new();
        let definition_id;
        let run_id;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            let project = TestContext::project(&mut service);
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Resumable checkpoints".to_string(),
                    steps: vec![
                        PipelineStepDefinition {
                            key: "first".to_string(),
                            step_id: "core.checkpoint".to_string(),
                            config: Value::Null,
                        },
                        PipelineStepDefinition {
                            key: "second".to_string(),
                            step_id: "core.checkpoint".to_string(),
                            config: Value::Null,
                        },
                    ],
                })
                .expect("create resumable pipeline");
            let created = service
                .store
                .create_pipeline_run(&definition.id, &project.id, None, json!({}))
                .expect("create run");
            run_id = created.run.id.clone();
            definition_id = definition.id;
            service
                .store
                .start_pipeline_run(&run_id)
                .expect("start run");
            service
                .store
                .start_pipeline_step(&run_id, 0, json!({}))
                .expect("start first step");
            service
                .store
                .complete_pipeline_step(
                    &run_id,
                    0,
                    json!({ "first": true }),
                    Some(json!({ "checkpoint": 1 })),
                    None,
                )
                .expect("complete first step");
            service
                .store
                .start_pipeline_step(&run_id, 1, json!({ "first": true }))
                .expect("start second step");
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted run");
        assert_eq!(
            interrupted.run.status,
            translunar_pipeline::PipelineRunStatus::Interrupted
        );
        assert_eq!(
            interrupted.steps[0].checkpoint,
            Some(json!({ "checkpoint": 1 }))
        );
        let resumed = service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id: run_id.clone(),
                expected_revision: interrupted.run.revision,
            })
            .expect("resume run");
        assert_eq!(
            resumed.run.status,
            translunar_pipeline::PipelineRunStatus::Queued
        );
        assert_eq!(resumed.run.definition_id, definition_id);
        let mut final_snapshot = resumed;
        for _ in 0..100 {
            if final_snapshot.run.status.is_terminal() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
            final_snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: run_id.clone(),
                })
                .expect("poll resumed run");
        }
        assert_eq!(
            final_snapshot.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded
        );
        assert_eq!(
            final_snapshot.steps[0].checkpoint,
            Some(json!({ "checkpoint": 1 }))
        );
    }

    #[test]
    fn interrupted_non_resumable_pipeline_fails_explicitly() {
        let context = TestContext::new();
        let run_id;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            service
                .pipeline
                .registry
                .register(Arc::new(NonResumableStep))
                .expect("register test step");
            let project = TestContext::project(&mut service);
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Non-resumable recovery".to_string(),
                    steps: vec![PipelineStepDefinition {
                        key: "once".to_string(),
                        step_id: "test.nonresumable".to_string(),
                        config: Value::Null,
                    }],
                })
                .expect("create non-resumable pipeline");
            let created = service
                .store
                .create_pipeline_run(&definition.id, &project.id, None, json!({}))
                .expect("create run");
            run_id = created.run.id.clone();
            service
                .store
                .start_pipeline_run(&run_id)
                .expect("start run");
            service
                .store
                .start_pipeline_step(&run_id, 0, json!({}))
                .expect("start step");
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        service
            .pipeline
            .registry
            .register(Arc::new(NonResumableStep))
            .expect("register test step after restart");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted run");
        let failed = service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id,
                expected_revision: interrupted.run.revision,
            })
            .expect("explicitly fail non-resumable run");
        assert_eq!(
            failed.run.status,
            translunar_pipeline::PipelineRunStatus::Failed
        );
        assert_eq!(
            failed.run.error.as_ref().map(|error| error.code.as_str()),
            Some("step_not_resumable")
        );
        assert_eq!(
            failed.steps[0].status,
            translunar_pipeline::PipelineStepStatus::Failed
        );
    }

    #[test]
    fn generic_import_keeps_same_basenames_and_legacy_docx_path_works() {
        let context = TestContext::new();
        let first = context.root.path().join("source-a").join("shared.docx");
        let second = context.root.path().join("source-b").join("shared.docx");
        std::fs::create_dir_all(first.parent().expect("first parent")).expect("first dir");
        std::fs::create_dir_all(second.parent().expect("second parent")).expect("second dir");
        std::fs::copy(&context.source, &first).expect("copy first");
        std::fs::copy(&context.source, &second).expect("copy second");

        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let first_document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: first.to_string_lossy().into_owned(),
                relative_path: Some("chapter-a/shared.docx".to_string()),
                filter_id: None,
                options: Default::default(),
            })
            .expect("generic import first");
        let second_document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: second.to_string_lossy().into_owned(),
            })
            .expect("legacy import second");
        for (document_id, target) in [
            (first_document.document.id.clone(), "第一份译文"),
            (second_document.id.clone(), "第二份译文"),
        ] {
            let segments = service
                .list_segments(SegmentListParams {
                    document_id,
                    offset: 0,
                    limit: 10,
                })
                .expect("list imported segments");
            service
                .update_target(UpdateTargetParams {
                    segment_id: segments.items[0].id.clone(),
                    target_text: target.to_string(),
                    expected_revision: segments.items[0].revision,
                })
                .expect("edit imported document");
        }
        let page = service
            .list_documents(DocumentListParams {
                project_id: project.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list documents");
        assert_eq!(page.total, 2);
        assert_eq!(page.items[0].relative_path, "chapter-a/shared.docx");
        assert_eq!(page.items[1].name, "shared.docx");
        assert_eq!(first_document.filter_id, "builtin.docx");
        assert_eq!(second_document.relative_path, "shared.docx");
        let filter_ids: Vec<_> = service
            .list_filters(EmptyParams::default())
            .filters
            .into_iter()
            .map(|filter| filter.id)
            .collect();
        assert_eq!(
            filter_ids,
            [
                "builtin.docx",
                "builtin.html",
                "builtin.markdown",
                "builtin.pdf",
                "builtin.pptx",
                "builtin.txt",
                "builtin.xliff",
                "builtin.xlsx",
            ]
        );

        drop(service);
        let service = EngineService::open(context.root.path()).expect("restart engine");
        let recovered = service
            .list_documents(DocumentListParams {
                project_id: project.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list documents after restart");
        assert_eq!(recovered.items.len(), 2);
        for (document_id, expected_target) in [
            (first_document.document.id.clone(), "第一份译文"),
            (second_document.id.clone(), "第二份译文"),
        ] {
            let segments = service
                .list_segments(SegmentListParams {
                    document_id: document_id.clone(),
                    offset: 0,
                    limit: 10,
                })
                .expect("reload document segments");
            assert_eq!(segments.items[0].target_text, expected_target);
        }
        let generic_output = context.root.path().join("generic-shared.docx");
        let legacy_output = context.root.path().join("legacy-shared.docx");
        let generic_result = service
            .export_document(ExportDocumentParams {
                document_id: first_document.document.id,
                output_path: generic_output.to_string_lossy().into_owned(),
            })
            .expect("generic export after restart");
        let legacy_result = service
            .export_docx(ExportDocxParams {
                document_id: second_document.id,
                output_path: legacy_output.to_string_lossy().into_owned(),
            })
            .expect("legacy export after restart");
        assert_eq!(generic_result.translated_segments, 1);
        assert_eq!(legacy_result.translated_segments, 1);
        assert!(generic_output.is_file());
        assert!(legacy_output.is_file());
    }

    #[test]
    fn text_html_xliff_and_office_filters_round_trip_through_generic_engine() {
        let context = TestContext::new();
        let txt = context.root.path().join("sample.txt");
        let markdown = context.root.path().join("sample.md");
        let html = context.root.path().join("sample.html");
        let xliff = context.root.path().join("sample.xlf");
        let xlsx = context.root.path().join("sample.xlsx");
        let pptx = context.root.path().join("sample.pptx");
        std::fs::write(
            &txt,
            "\u{feff}First paragraph.\r\n\r\nSecond paragraph.\r\n",
        )
        .expect("write TXT");
        std::fs::write(
            &markdown,
            "# Heading\n\nVisible **bold** [link](https://example.test) `code`.\n",
        )
        .expect("write Markdown");
        std::fs::write(
            &html,
            "<!-- keep --><p title=\"Greeting\">Hello <strong>world</strong>.</p><script>skip()</script>",
        )
        .expect("write HTML");
        std::fs::write(
            &xliff,
            r#"<xliff version="2.1" srcLang="en" trgLang="zh" xmlns="urn:oasis:names:tc:xliff:document:2.1"><file id="f"><unit id="u"><notes><note id="n">Keep tone</note></notes><segment id="s" state="initial"><source>Hello <ph id="p"/> world</source></segment></unit></file></xliff>"#,
        )
        .expect("write XLIFF");
        xlsx_fixture::write_fixture(&xlsx).expect("write XLSX");
        pptx_fixture::write_fixture(&pptx).expect("write PPTX");

        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let oversized_options = (0..33)
            .map(|index| (format!("option-{index}"), "value".to_string()))
            .collect();
        assert!(matches!(
            service.import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: txt.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: None,
                options: oversized_options,
            }),
            Err(EngineError::InvalidRequest(_))
        ));
        let cases = [
            (&txt, "builtin.txt", "第一段。", "translated.txt"),
            (&markdown, "builtin.markdown", "标题", "translated.md"),
            (&html, "builtin.html", "你好", "translated.html"),
            (&xliff, "builtin.xliff", "你好世界", "translated.xlf"),
            (&xlsx, "builtin.xlsx", "你好表格", "translated.xlsx"),
            (&pptx, "builtin.pptx", "你好幻灯片", "translated.pptx"),
        ];
        let mut exports = Vec::new();
        for (source, filter_id, target, output_name) in cases {
            let imported = service
                .import_document(ImportDocumentParams {
                    project_id: project.id.clone(),
                    source_path: source.to_string_lossy().into_owned(),
                    relative_path: None,
                    filter_id: None,
                    options: Default::default(),
                })
                .expect("generic format import");
            assert_eq!(imported.filter_id, filter_id);
            let segments = service
                .list_segments(SegmentListParams {
                    document_id: imported.document.id.clone(),
                    offset: 0,
                    limit: 200,
                })
                .expect("list imported segments");
            assert!(!segments.items.is_empty());
            if filter_id == "builtin.xliff" {
                let notes = service
                    .store
                    .list_segment_notes(&segments.items[0].id)
                    .expect("list imported XLIFF notes");
                assert_eq!(notes.len(), 2);
                assert!(notes.iter().any(|note| note.text == "Keep tone"));
                assert!(notes.iter().any(|note| note.text == "initial"));
            }
            service
                .update_target(UpdateTargetParams {
                    segment_id: segments.items[0].id.clone(),
                    target_text: target.to_string(),
                    expected_revision: segments.items[0].revision,
                })
                .expect("edit imported segment");
            exports.push((imported.document.id, context.root.path().join(output_name)));
        }
        service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: html.to_string_lossy().into_owned(),
                relative_path: Some("duplicate/sample.html".to_string()),
                filter_id: None,
                options: Default::default(),
            })
            .expect("import second tagged HTML without global tag ID collision");

        let sources_before_failure = std::fs::read_dir(&service.store.paths().sources)
            .expect("read managed sources")
            .count();
        let malformed = context.root.path().join("malformed.xlf");
        std::fs::write(&malformed, "<xliff version=\"2.1\"><file>").expect("write malformed XLIFF");
        assert!(
            service
                .import_document(ImportDocumentParams {
                    project_id: project.id.clone(),
                    source_path: malformed.to_string_lossy().into_owned(),
                    relative_path: None,
                    filter_id: None,
                    options: Default::default(),
                })
                .is_err()
        );
        assert_eq!(
            std::fs::read_dir(&service.store.paths().sources)
                .expect("read managed sources after failure")
                .count(),
            sources_before_failure
        );

        drop(service);
        let service = EngineService::open(context.root.path()).expect("restart engine");
        for (document_id, output) in &exports {
            service
                .export_document(ExportDocumentParams {
                    document_id: document_id.clone(),
                    output_path: output.to_string_lossy().into_owned(),
                })
                .expect("export after restart");
        }
        let recovered_xliff = service
            .list_segments(SegmentListParams {
                document_id: exports[3].0.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("reload XLIFF segment");
        assert_eq!(
            service
                .store
                .list_segment_notes(&recovered_xliff.items[0].id)
                .expect("reload XLIFF notes")
                .len(),
            2
        );
        let txt_output = std::fs::read_to_string(&exports[0].1).expect("read TXT export");
        assert!(txt_output.contains("第一段。"));
        assert!(txt_output.contains("Second paragraph."));
        let markdown_output = std::fs::read_to_string(&exports[1].1).expect("read Markdown export");
        assert!(markdown_output.contains("# 标题"));
        assert!(markdown_output.contains("https://example.test"));
        assert!(markdown_output.contains("`code`"));
        let html_output = std::fs::read_to_string(&exports[2].1).expect("read HTML export");
        assert!(html_output.contains("<!-- keep -->"));
        assert!(html_output.contains("<strong>world</strong>"));
        assert!(html_output.contains("<script>skip()</script>"));
        let xliff_output = std::fs::read_to_string(&exports[3].1).expect("read XLIFF export");
        assert!(xliff_output.contains("<target>"));
        assert!(xliff_output.contains("<ph id=\"p\"/>"));
        assert!(xliff_output.contains("id=\"s\""));
        let xlsx_units = XlsxFilter
            .extract_units(&ImportRequest::new(exports[4].1.clone()))
            .expect("read XLSX export");
        assert_eq!(xlsx_units[0].source_text, "你好表格");
        let pptx_units = PptxFilter
            .extract_units(&ImportRequest::new(exports[5].1.clone()))
            .expect("read PPTX export");
        assert_eq!(pptx_units[0].source_text, "你好幻灯片");
    }

    #[test]
    fn health_and_backup_round_trip_authoritative_workspace() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let segment = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list segments")
            .items
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: segment.id,
                target_text: "保留期为 30 天。".to_string(),
                expected_revision: segment.revision,
            })
            .expect("save translated target");
        let health = service
            .check_health(EmptyParams::default())
            .expect("check health");
        assert!(health.healthy, "unexpected findings: {:?}", health.findings);
        assert_eq!(health.schema_version, 7);

        let destination = context.root.path().join("workspace-backup");
        let backup = service
            .create_backup(CreateBackupParams {
                destination_path: destination.to_string_lossy().into_owned(),
            })
            .expect("create backup");
        assert_eq!(backup.manifest.schema_version, 7);
        assert!(destination.join("translunar.sqlite3").is_file());
        assert!(
            destination
                .join("sources")
                .join(format!("{}.docx", document.id))
                .is_file()
        );
        drop(service);
        std::fs::remove_file(
            context
                .root
                .path()
                .join("sources")
                .join(format!("{}.docx", document.id)),
        )
        .expect("remove original managed source");
        let restored = EngineService::open(&destination).expect("open restored backup");
        let restored_health = restored
            .check_health(EmptyParams::default())
            .expect("check restored health");
        assert!(
            restored_health.healthy,
            "restored findings: {:?}",
            restored_health.findings
        );
        assert_eq!(
            restored
                .get_project(&project.id)
                .expect("restored project")
                .documents
                .len(),
            1
        );
        let history = restored
            .list_history(HistoryListParams {
                project_id: project.id,
                offset: 0,
                limit: 10,
                descending: false,
            })
            .expect("restored history");
        assert_eq!(history.total, 1);
        let restored_output = destination.join("exports").join("restored.docx");
        let exported = restored
            .export_document(ExportDocumentParams {
                document_id: document.id,
                output_path: restored_output.to_string_lossy().into_owned(),
            })
            .expect("export restored document");
        assert_eq!(exported.translated_segments, 1);
        assert!(restored_output.is_file());
    }

    #[test]
    fn dispatcher_requires_handshake_and_returns_typed_conflicts() {
        let context = TestContext::new();
        let mut dispatcher = RpcDispatcher::open(context.root.path()).expect("open dispatcher");
        let before_initialize = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(1),
            method: methods::PROJECT_CREATE.to_string(),
            params: json!({}),
        });
        assert_eq!(
            before_initialize.error.expect("typed error").code,
            ErrorCode::InvalidState
        );

        let initialized = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(2),
            method: methods::INITIALIZE.to_string(),
            params: serde_json::to_value(InitializeParams {
                protocol_version: PROTOCOL_VERSION,
                client: ClientInfo {
                    name: "test".to_string(),
                    version: "0".to_string(),
                },
            })
            .expect("serialize params"),
        });
        assert!(initialized.error.is_none());

        let created = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(3),
            method: methods::PROJECT_CREATE.to_string(),
            params: serde_json::to_value(CreateProjectParams {
                name: "Protocol project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
            })
            .expect("serialize project params"),
        });
        let project: Project = serde_json::from_value(created.result.expect("project result"))
            .expect("decode project");
        let update = UpdateProjectParams {
            project_id: project.id.clone(),
            name: "Updated project".to_string(),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            domain: project.domain.clone(),
            configuration: project.configuration.clone(),
            expected_revision: project.revision,
            actor: "test".to_string(),
            correlation_id: None,
        };
        let updated = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(4),
            method: methods::PROJECT_UPDATE.to_string(),
            params: serde_json::to_value(&update).expect("serialize update"),
        });
        assert!(updated.error.is_none());
        let stale = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(5),
            method: methods::PROJECT_UPDATE.to_string(),
            params: serde_json::to_value(update).expect("serialize stale update"),
        });
        let stale_error = stale.error.expect("stale conflict");
        assert_eq!(stale_error.code, ErrorCode::Conflict);
        assert_eq!(
            stale_error
                .data
                .as_ref()
                .and_then(|data| data.get("entity")),
            Some(&json!("project"))
        );
        assert_eq!(
            stale_error
                .data
                .as_ref()
                .and_then(|data| data.get("expectedRevision")),
            Some(&json!(0))
        );
        assert_eq!(
            stale_error
                .data
                .as_ref()
                .and_then(|data| data.get("actualRevision")),
            Some(&json!(1))
        );

        let unknown_filter = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(6),
            method: methods::DOCUMENT_IMPORT.to_string(),
            params: serde_json::to_value(ImportDocumentParams {
                project_id: project.id,
                source_path: context.source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("missing.filter".to_string()),
                options: Default::default(),
            })
            .expect("serialize generic import"),
        });
        let filter_error = unknown_filter.error.expect("unknown filter error");
        assert_eq!(filter_error.code, ErrorCode::NotFound);
        assert_eq!(
            filter_error
                .data
                .as_ref()
                .and_then(|data| data.get("entity")),
            Some(&json!("filter"))
        );
    }

    #[test]
    fn professional_editor_commands_are_transactional_and_persist() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let page = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: document.id.clone(),
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: true,
            })
            .expect("list editor rows");
        assert_eq!(page.items.len(), 3);
        assert!(page.items[0].context_after.is_some());

        let first = &page.items[0].segment;
        let saved = service
            .update_target(UpdateTargetParams {
                segment_id: first.id.clone(),
                target_text: "保留期为 30 天。".to_string(),
                expected_revision: first.revision,
            })
            .expect("save target");
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo target");
        assert!(
            undone
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("undone row")
                .segment
                .target_text
                .is_empty()
        );
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo target");
        let mut redone_first = redone
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("redone row")
            .segment
            .clone();
        assert_eq!(redone_first.target_text, saved.target_text);
        let redone_editor_row = redone
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("redone editor row");
        let target_length = u32::try_from(redone_first.target_text.chars().count()).unwrap_or(1);
        let denominator = u32::try_from(redone_editor_row.source_tags.len().saturating_sub(1))
            .unwrap_or(1)
            .max(1);
        let target_tags = redone_editor_row
            .source_tags
            .iter()
            .enumerate()
            .map(|(index, tag)| translunar_domain::InlineTag {
                id: format!("smoke-target-{index}"),
                side: translunar_domain::TagSide::Target,
                position: u32::try_from(index)
                    .unwrap_or(u32::MAX)
                    .saturating_mul(target_length)
                    / denominator,
                kind: tag.kind,
                pair_id: tag.pair_id.clone(),
                payload: tag.payload.clone(),
                display_text: tag.display_text.clone(),
                protected: true,
            })
            .collect::<Vec<_>>();
        let partial_tags = target_tags.iter().take(2).cloned().collect::<Vec<_>>();
        let partial_mutation = service
            .set_segment_tags(SetSegmentTagsParams {
                segment_id: first.id.clone(),
                target_tags: partial_tags,
                expected_revision: redone_first.revision,
            })
            .expect("insert one protected target tag pair");
        let partial_row = partial_mutation
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("partially tagged row");
        assert_eq!(partial_row.target_tags.len(), 2);
        assert!(
            partial_row
                .tag_issues
                .iter()
                .any(|issue| issue.code == "tag_missing")
        );
        let reverted_partial = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo partial protected target tags");
        redone_first = reverted_partial
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("row after undoing partial protected target tags")
            .segment
            .clone();
        service
            .set_segment_tags(SetSegmentTagsParams {
                segment_id: first.id.clone(),
                target_tags,
                expected_revision: redone_first.revision,
            })
            .expect("set protected target tags");
        let undone_tags = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo protected target tags");
        assert!(
            undone_tags
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("undone protected tag row")
                .target_tags
                .is_empty()
        );
        let redone_tags = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo protected target tags");
        redone_first = redone_tags
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("redone tagged row")
            .segment
            .clone();
        assert_eq!(
            redone_tags
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("redone protected tag row")
                .target_tags
                .len(),
            redone_editor_row.source_tags.len()
        );

        let stale_preview = service
            .preview_replace(ReplacePreviewParams {
                document_id: document.id.clone(),
                query: "30".to_string(),
                replacement: "60".to_string(),
                field: EditorSearchField::Target,
                regex: false,
                case_sensitive: true,
                whole_word: false,
            })
            .expect("preview replace");
        let changed = service
            .update_target(UpdateTargetParams {
                segment_id: redone_first.id.clone(),
                target_text: "保留期为 45 天。".to_string(),
                expected_revision: redone_first.revision,
            })
            .expect("create stale preview");
        assert!(matches!(
            service.apply_replace(ReplaceApplyParams {
                preview: stale_preview
            }),
            Err(EngineError::Storage(StorageError::Conflict { .. }))
        ));
        let preview = service
            .preview_replace(ReplacePreviewParams {
                document_id: document.id.clone(),
                query: "45".to_string(),
                replacement: "60".to_string(),
                field: EditorSearchField::Target,
                regex: false,
                case_sensitive: true,
                whole_word: false,
            })
            .expect("fresh preview");
        let replaced = service
            .apply_replace(ReplaceApplyParams { preview })
            .expect("apply replace");
        assert_eq!(
            replaced
                .rows
                .iter()
                .find(|row| row.segment.id == changed.id)
                .expect("replaced row")
                .segment
                .target_text,
            "保留期为 60 天。"
        );

        let comment = service
            .create_segment_comment(CreateSegmentCommentParams {
                segment_id: first.id.clone(),
                author: "reviewer".to_string(),
                text: "Check the number.".to_string(),
            })
            .expect("create comment");
        let comment = service
            .resolve_segment_comment(ResolveSegmentCommentParams {
                comment_id: comment.id,
                resolved: true,
                expected_revision: comment.revision,
            })
            .expect("resolve comment");
        assert!(comment.resolved);
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo comment resolution");
        assert!(
            !service
                .list_segment_comments(SegmentCommentListParams {
                    segment_id: first.id.clone(),
                    include_resolved: true,
                })
                .expect("list undone comment")
                .comments[0]
                .resolved
        );
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo comment resolution");

        let second = &page.items[1].segment;
        let review = service
            .create_review(ReviewCreateParams {
                segment_id: second.id.clone(),
                proposed_target: Some("审阅后的译文。".to_string()),
                proposed_source: None,
                proposed_target_tags: None,
                author: "reviewer".to_string(),
                reason: "Improve clarity".to_string(),
                expected_revision: second.revision,
            })
            .expect("create review");
        let accepted = service
            .accept_review(ReviewDecisionParams {
                review_id: review.id,
                expected_segment_revision: second.revision,
            })
            .expect("accept review");
        assert_eq!(
            accepted
                .rows
                .iter()
                .find(|row| row.segment.id == second.id)
                .expect("reviewed row")
                .segment
                .target_text,
            "审阅后的译文。"
        );
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo accepted review");
        let pending_review = service
            .list_reviews(ReviewListParams {
                document_id: document.id.clone(),
                include_closed: true,
            })
            .expect("list undone review");
        assert_eq!(
            pending_review.revisions[0].status,
            translunar_domain::ReviewStatus::Pending
        );
        let redone_review = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo accepted review");
        let reviewed_second = redone_review
            .rows
            .iter()
            .find(|row| row.segment.id == second.id)
            .expect("redone reviewed row")
            .segment
            .clone();
        let confirmed_second = service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: reviewed_second.id.clone(),
                expected_revision: reviewed_second.revision,
            })
            .expect("confirm reviewed segment")
            .segment;
        let signed = service
            .set_editor_workflow(SetEditorWorkflowParams {
                segment_id: confirmed_second.id.clone(),
                state: translunar_domain::EditorWorkflowState::Signed,
                expected_revision: confirmed_second.revision,
            })
            .expect("sign reviewed segment");
        assert_eq!(
            signed
                .rows
                .iter()
                .find(|row| row.segment.id == second.id)
                .expect("signed row")
                .workflow_state,
            translunar_domain::EditorWorkflowState::Signed
        );
        let signed_segment = signed
            .rows
            .iter()
            .find(|row| row.segment.id == second.id)
            .expect("signed segment")
            .segment
            .clone();
        assert!(matches!(
            service.update_target(UpdateTargetParams {
                segment_id: signed_segment.id,
                target_text: "signed content must not change".to_string(),
                expected_revision: signed_segment.revision,
            }),
            Err(EngineError::Storage(StorageError::InvalidState(_)))
        ));
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo signed workflow");
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo signed workflow");

        let third_document_row = &page.items[2];
        let source_review = service
            .create_review(ReviewCreateParams {
                segment_id: third_document_row.segment.id.clone(),
                proposed_target: None,
                proposed_source: Some(format!(
                    "{} corrected",
                    third_document_row.segment.source_text
                )),
                proposed_target_tags: None,
                author: "source-reviewer".to_string(),
                reason: "Correct the source".to_string(),
                expected_revision: third_document_row.segment.revision,
            })
            .expect("create source review");
        assert!(source_review.proposed_source.is_some());
        let accepted_source = service
            .accept_review(ReviewDecisionParams {
                review_id: source_review.id,
                expected_segment_revision: third_document_row.segment.revision,
            })
            .expect("accept source review");
        assert!(
            accepted_source
                .rows
                .iter()
                .find(|row| row.segment.id == third_document_row.segment.id)
                .expect("source-reviewed row")
                .segment
                .source_text
                .ends_with(" corrected")
        );
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo source review");
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo source review");

        let first_review_row = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: document.id.clone(),
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: true,
            })
            .expect("list tag review row")
            .items
            .into_iter()
            .find(|row| row.segment.id == first.id)
            .expect("tag review row");
        let tag_review = service
            .create_review(ReviewCreateParams {
                segment_id: first.id.clone(),
                proposed_target: Some("保留期为 60 天（审阅）。".to_string()),
                proposed_source: None,
                proposed_target_tags: Some(first_review_row.target_tags.clone()),
                author: "tag-reviewer".to_string(),
                reason: "Review target and protected tags together".to_string(),
                expected_revision: first_review_row.segment.revision,
            })
            .expect("create tag review");
        assert_eq!(
            tag_review
                .proposed_target_tags
                .as_ref()
                .expect("proposed review tags")
                .len(),
            first_review_row.target_tags.len()
        );
        let accepted_tags = service
            .accept_review(ReviewDecisionParams {
                review_id: tag_review.id,
                expected_segment_revision: first_review_row.segment.revision,
            })
            .expect("accept tag review");
        assert_eq!(
            accepted_tags
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("accepted tag review row")
                .target_tags
                .len(),
            first_review_row.target_tags.len()
        );

        let split_source = context.root.path().join("split.txt");
        std::fs::write(&split_source, "Alpha beta gamma.").expect("write split fixture");
        let split_document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: split_source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import split fixture")
            .document;
        let third = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: split_document.id,
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: true,
            })
            .expect("list split fixture")
            .items
            .remove(0)
            .segment;
        let split = service
            .split_segment(SplitSegmentParams {
                segment_id: third.id.clone(),
                source_offset: 6,
                target_offset: Some(0),
                expected_revision: third.revision,
            })
            .expect("split segment");
        assert_eq!(split.rows.len(), 2);
        let unsplit = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo split");
        assert_eq!(unsplit.rows.len(), 1);
        assert_eq!(unsplit.rows[0].segment.source_text, "Alpha beta gamma.");
        let split = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo split");
        assert_eq!(split.rows.len(), 2);
        let split_index = split
            .rows
            .iter()
            .position(|row| row.segment.id == third.id)
            .expect("split first row");
        let split_first = &split.rows[split_index].segment;
        let split_second = &split.rows[split_index + 1].segment;
        let merged = service
            .merge_segments(MergeSegmentsParams {
                first_segment_id: split_first.id.clone(),
                second_segment_id: split_second.id.clone(),
                first_expected_revision: split_first.revision,
                second_expected_revision: split_second.revision,
            })
            .expect("merge segment");
        assert_eq!(merged.rows.len(), 1);
        let unmerged = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo merge");
        assert_eq!(unmerged.rows.len(), 2);
        let remerged = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo merge");
        assert_eq!(remerged.rows.len(), 1);

        service
            .add_dictionary_word(DictionaryWordParams {
                locale: "en-US".to_string(),
                word: "mispellled".to_string(),
            })
            .expect("add dictionary word");
        let spell = service
            .spell_check(SpellCheckParams {
                locale: "en-US".to_string(),
                text: "mispellled word".to_string(),
                limit: 20,
            })
            .expect("spell check");
        assert!(spell.findings.iter().all(|item| item.word != "mispellled"));

        service
            .update_editor_preferences(UpdateEditorPreferencesParams {
                preferences: EditorPreferences {
                    theme: "dark".to_string(),
                    zoom: 125,
                    show_nonprinting: true,
                    ..EditorPreferences::default()
                },
            })
            .expect("update preferences");
        drop(service);

        let service = EngineService::open(context.root.path()).expect("reopen engine");
        assert_eq!(
            service
                .get_editor_preferences(EmptyParams {})
                .expect("persisted preferences")
                .theme,
            "dark"
        );
        assert_eq!(
            service
                .list_segment_comments(SegmentCommentListParams {
                    segment_id: first.id.clone(),
                    include_resolved: true,
                })
                .expect("persisted comments")
                .comments
                .len(),
            1
        );
        assert_eq!(
            service
                .list_reviews(ReviewListParams {
                    document_id: document.id,
                    include_closed: true,
                })
                .expect("persisted reviews")
                .revisions[0]
                .status,
            translunar_domain::ReviewStatus::Accepted
        );
    }

    #[test]
    fn chinese_conversion_is_phrase_aware_durable_and_undoable() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let page = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: document.id,
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: false,
            })
            .expect("list editor rows");
        let first = &page.items[0].segment;
        let saved = service
            .update_target(UpdateTargetParams {
                segment_id: first.id.clone(),
                target_text: "鼠标和打印机里的软件".to_string(),
                expected_revision: first.revision,
            })
            .expect("save simplified target");
        let converted = service
            .convert_segment_chinese(ConvertSegmentChineseParams {
                segment_id: first.id.clone(),
                profile: ChineseConversionProfile::SimplifiedToTaiwan,
                expected_revision: saved.revision,
            })
            .expect("convert target to Taiwan vocabulary");
        assert_eq!(
            converted
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("converted row")
                .segment
                .target_text,
            "滑鼠和印表機裡的軟體"
        );
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo Chinese conversion");
        assert_eq!(
            undone
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("undone conversion row")
                .segment
                .target_text,
            "鼠标和打印机里的软件"
        );
        drop(service);

        let mut service = EngineService::open(context.root.path()).expect("reopen engine");
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id,
            })
            .expect("redo Chinese conversion after restart");
        assert_eq!(
            redone
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("redone conversion row")
                .segment
                .target_text,
            "滑鼠和印表機裡的軟體"
        );
    }

    #[test]
    fn editor_history_invalidates_abandoned_redo_branch() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let source = context.root.path().join("history.txt");
        std::fs::write(&source, "Branching editor history.").expect("write history fixture");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import history fixture")
            .document;
        let initial = service
            .list_segments(SegmentListParams {
                document_id: document.id,
                offset: 0,
                limit: 10,
            })
            .expect("list history segment")
            .items
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: initial.id.clone(),
                target_text: "first branch".to_string(),
                expected_revision: initial.revision,
            })
            .expect("write first branch");
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo first branch");
        let base = undone
            .rows
            .iter()
            .find(|row| row.segment.id == initial.id)
            .expect("history base")
            .segment
            .clone();
        service
            .update_target(UpdateTargetParams {
                segment_id: base.id.clone(),
                target_text: "second branch".to_string(),
                expected_revision: base.revision,
            })
            .expect("write second branch");
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo second branch");
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo second branch");
        assert_eq!(redone.rows[0].segment.target_text, "second branch");
        assert!(matches!(
            service.redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            }),
            Err(EngineError::Storage(StorageError::InvalidState(_)))
        ));
        drop(service);

        let mut service = EngineService::open(context.root.path()).expect("reopen engine");
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo branch after restart");
        assert!(undone.rows[0].segment.target_text.is_empty());
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id,
            })
            .expect("redo branch after restart");
        assert_eq!(redone.rows[0].segment.target_text, "second branch");
    }

    #[test]
    fn undo_redo_restores_confirmation_tm_and_qa_side_effects() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let source = context.root.path().join("confirm-history.txt");
        std::fs::write(&source, "Retention is 30 days.").expect("write confirmation fixture");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import confirmation fixture")
            .document;
        let segment = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list confirmation fixture")
            .items
            .remove(0);
        let draft = service
            .update_target(UpdateTargetParams {
                segment_id: segment.id.clone(),
                target_text: "保留期为 60 天。".to_string(),
                expected_revision: segment.revision,
            })
            .expect("save confirmation target");
        service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: segment.id.clone(),
                expected_revision: draft.revision,
            })
            .expect("confirm fixture");
        assert_eq!(
            service
                .lookup_exact(ExactLookupParams {
                    project_id: project.id.clone(),
                    source_text: segment.source_text.clone(),
                })
                .expect("confirmed exact lookup")
                .matches
                .len(),
            1
        );
        assert_eq!(
            service
                .list_qa(ListQaParams {
                    document_id: document.id.clone(),
                    include_resolved: false,
                })
                .expect("confirmed QA")
                .issues
                .len(),
            1
        );
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo confirmation");
        assert!(
            service
                .lookup_exact(ExactLookupParams {
                    project_id: project.id.clone(),
                    source_text: segment.source_text.clone(),
                })
                .expect("undone exact lookup")
                .matches
                .is_empty()
        );
        assert!(
            service
                .list_qa(ListQaParams {
                    document_id: document.id.clone(),
                    include_resolved: true,
                })
                .expect("undone QA")
                .issues
                .is_empty()
        );
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo confirmation");
        assert_eq!(
            service
                .lookup_exact(ExactLookupParams {
                    project_id: project.id,
                    source_text: segment.source_text,
                })
                .expect("redone exact lookup")
                .matches
                .len(),
            1
        );
    }

    #[test]
    fn parses_bounded_hunspell_output_at_unicode_scalar_offsets() {
        let text = "前缀 correct mispellled wrng";
        let words = spell_word_spans(text);
        let findings = parse_hunspell_output(
            "@(#) Hunspell 1.7\n*\n& mispellled 1 0: misspelled\n# wrng 0\n",
            &words,
            text,
            "hunspell:test",
            1,
        )
        .expect("parse hunspell output");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].word, "mispellled");
        assert_eq!(findings[0].start, 11);
        assert_eq!(findings[0].end, 21);
        assert_eq!(findings[0].suggestions, ["misspelled"]);
        assert_eq!(findings[0].provider, "hunspell:test");
        assert!(parse_hunspell_output("*\n", &words, text, "hunspell:test", 10).is_none());
    }
}
