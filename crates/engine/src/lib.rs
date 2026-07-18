use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use translunar_domain::{DataHealthReport, Document, Project, Segment};
use translunar_filter_core::{
    ExportRequest, FilterError, FilterRegistry, ImportRequest, collect_imported_document,
};
use translunar_filter_docx::DocxFilter;
use translunar_pipeline::{
    ArtifactKind, PipelineDefinition, PipelineError, PipelineFailure, PipelineStep,
    PipelineStepDefinition, StepDescriptor, StepExecutionContext, StepOutcome, StepRegistry,
};
use translunar_protocol::methods;
use translunar_protocol::{
    BackupResult, ConfirmSegmentParams, ConfirmSegmentResult, CreateBackupParams,
    CreatePipelineParams, CreateProjectParams, DocumentIdParams, DocumentListParams, DocumentPage,
    EmptyParams, ErrorCode, ExactLookupParams, ExactLookupResult, ExportDocumentParams,
    ExportDocumentResult, ExportDocxParams, ExportDocxResult, FilterListResult, HistoryListParams,
    ImportDocumentParams, ImportDocumentResult, ImportDocxParams, InitializeParams,
    InitializeResult, ListQaParams, OperationPage, PROTOCOL_VERSION, PipelineCapabilityResult,
    PipelineDefinitionPage, PipelineIdParams, PipelineListParams, PipelineRunIdParams,
    PipelineRunListParams, PipelineRunPage, PipelineRunRevisionParams,
    PipelineRunSnapshot as ProtocolPipelineRunSnapshot, PipelineValidationResult, ProjectIdParams,
    ProjectListParams, ProjectPage, ProjectSnapshot, QaListResult, RpcError, RpcRequest,
    RpcResponse, RunPipelineParams, SegmentListParams, SegmentPage, SetProjectLifecycleParams,
    UpdateProjectParams, UpdateTargetParams, ValidatePipelineParams,
};
use translunar_storage::{NewDocument, NewPipelineDefinition, ProjectUpdate, StorageError, Store};

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Storage(#[from] StorageError),

    #[error("document import failed: {0}")]
    Import(#[source] FilterError),

    #[error("document export failed: {0}")]
    Export(#[source] FilterError),

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
            })?
            .document)
    }

    pub fn import_document(
        &mut self,
        params: ImportDocumentParams,
    ) -> Result<ImportDocumentResult> {
        self.store.get_project(&params.project_id)?;
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
        let mut temporary = NamedTempFile::new_in(&self.store.paths().temporary)?;
        let source_sha256 = copy_and_hash(&source_path, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        let stream = filter
            .import(ImportRequest {
                source: temporary.path().to_path_buf(),
            })
            .map_err(EngineError::Import)?;
        let imported = collect_imported_document(stream).map_err(EngineError::Import)?;
        if imported.units.is_empty() {
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
        })
    }

    pub fn lookup_exact(&self, params: ExactLookupParams) -> Result<ExactLookupResult> {
        Ok(ExactLookupResult {
            matches: self
                .store
                .lookup_exact(&params.project_id, &params.source_text)?,
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
            methods::TM_LOOKUP_EXACT => {
                serialize_result(self.service.lookup_exact(parse_params(request.params)?)?)
            }
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
                "qa.number-mismatch".to_string(),
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
    use translunar_domain::{QaIssueStatus, SegmentState};
    use translunar_filter_docx::fixture;
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
        assert_eq!(
            service.list_filters(EmptyParams::default()).filters.len(),
            1
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
        assert_eq!(health.schema_version, 3);

        let destination = context.root.path().join("workspace-backup");
        let backup = service
            .create_backup(CreateBackupParams {
                destination_path: destination.to_string_lossy().into_owned(),
            })
            .expect("create backup");
        assert_eq!(backup.manifest.schema_version, 3);
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
}
