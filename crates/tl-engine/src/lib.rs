//! tl-engine: the CAT engine behind the desktop shell.
//!
//! Phase 1 scope: project lifecycle, DOCX (and friends) import with SRX
//! sentence segmentation, grid editing with optimistic concurrency, exact
//! translation memory with confirmation-time propagation, deterministic number
//! QA, filter-backed export, and an honest AI assist/agent skeleton that
//! refuses to fabricate output when no provider is configured.

mod aiops;
mod export;
mod import;
mod store;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use tl_domain::{
    Document, DocumentStatus, Project, ProjectLifecycle, QaIssue, QaIssueStatus, QaSeverity,
    Segment, SegmentState, TmEntry, new_id, normalize_text, number_issue_fingerprint,
    number_mismatch, sha256_hex,
};
use tl_filter_core::{
    DocumentFilter, FilterError, FilterRegistry, ImportRequest, collect_imported_document,
};
use tl_protocol::{
    AgentRunParams, AgentRunResult, AgentRunStatus, AgentStep, AgentStepKind,
    AgentStepNotification, AgentStepStatus, AiAssistAction, AiAssistParams, AiAssistResult,
    AiConfigureParams, AiStatusResult, DocumentExportParams, DocumentExportResult,
    DocumentImportParams, DocumentImportResult, DocumentListParams, DocumentListResult,
    EngineCapabilities, EngineReadyNotification, InitializeParams, InitializeResult,
    PROTOCOL_VERSION, ProjectCreateParams, ProjectGetParams, ProjectListResult, QaListParams,
    QaListResult, QaRunParams, QaRunResult, RpcError, RpcErrorCode, RpcNotification, RpcRequest,
    RpcResponse, SegmentConfirmParams, SegmentConfirmResult, SegmentListParams, SegmentListResult,
    SegmentUpdateParams, SegmentUpdateResult, ShutdownResult, TmLookupParams, TmLookupResult,
    TmMatchGrade, TmMatchItem, methods, notifications,
};

pub use store::{DocumentRecord, EngineState};

const QA_NUMBER_RULE_ID: &str = "builtin.qa.numbers";
const AGENT_DEFAULT_MAX_SEGMENTS: u32 = 50;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("invalid params: {0}")]
    InvalidParams(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("filter failed: {0}")]
    Filter(#[from] FilterError),
    #[error("export blocked: {0}")]
    ExportBlocked(String),
    #[error("AI provider is not configured")]
    AiNotConfigured,
    #[error("AI call failed: {0}")]
    AiFailed(String),
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

impl EngineError {
    fn code(&self) -> RpcErrorCode {
        match self {
            Self::InvalidParams(_) => RpcErrorCode::InvalidParams,
            Self::NotFound(_) => RpcErrorCode::NotFound,
            Self::Conflict(_) => RpcErrorCode::Conflict,
            Self::Filter(_) => RpcErrorCode::FilterFailed,
            Self::ExportBlocked(_) => RpcErrorCode::ExportBlocked,
            Self::AiNotConfigured => RpcErrorCode::AiNotConfigured,
            Self::AiFailed(_) => RpcErrorCode::AiFailed,
            Self::Io(_) => RpcErrorCode::Io,
            Self::Internal(_) => RpcErrorCode::Internal,
        }
    }

    pub fn to_rpc(&self) -> RpcError {
        RpcError {
            code: self.code(),
            message: self.to_string(),
            data: None,
        }
    }
}

pub struct Engine {
    data_dir: PathBuf,
    store: store::Store,
    state: EngineState,
    registry: FilterRegistry,
    ai: Option<aiops::AiRuntime>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, EngineError> {
    serde_json::from_value(params).map_err(|error| EngineError::InvalidParams(error.to_string()))
}

fn to_value<T: Serialize>(value: T) -> Result<Value, EngineError> {
    serde_json::to_value(value).map_err(|error| EngineError::Internal(error.to_string()))
}

impl Engine {
    pub fn open(data_dir: &Path) -> Result<Self, EngineError> {
        let (store, state) = store::Store::open(data_dir)?;
        let registry = FilterRegistry::default();
        let filters: Vec<Arc<dyn DocumentFilter>> = vec![
            Arc::new(tl_filter_docx::DocxFilter),
            Arc::new(tl_filter_text::TxtFilter),
            Arc::new(tl_filter_text::MarkdownFilter),
            Arc::new(tl_filter_html::HtmlFilter),
            Arc::new(tl_filter_xliff::XliffFilter),
            Arc::new(tl_filter_xlsx::XlsxFilter),
            Arc::new(tl_filter_pptx::PptxFilter),
        ];
        for filter in filters {
            registry
                .register(filter)
                .map_err(|error| EngineError::Internal(error.to_string()))?;
        }
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            store,
            state,
            registry,
            ai: None,
        })
    }

    pub fn ready_notification(&self) -> RpcNotification {
        RpcNotification {
            method: notifications::ENGINE_READY.to_string(),
            params: serde_json::to_value(EngineReadyNotification {
                engine_name: tl_protocol::ENGINE_NAME.to_string(),
                engine_version: env!("CARGO_PKG_VERSION").to_string(),
                protocol_version: PROTOCOL_VERSION,
            })
            .unwrap_or(Value::Null),
        }
    }

    pub fn handle(
        &mut self,
        request: RpcRequest,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> RpcResponse {
        let id = request.id;
        match self.dispatch(&request.method, request.params, notify) {
            Ok(result) => RpcResponse::success(id, result),
            Err(error) => RpcResponse::failure(Some(id), error.to_rpc()),
        }
    }

    fn dispatch(
        &mut self,
        method: &str,
        params: Value,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> Result<Value, EngineError> {
        match method {
            methods::ENGINE_INITIALIZE => to_value(self.initialize(parse(params)?)?),
            methods::ENGINE_SHUTDOWN => to_value(ShutdownResult { ok: true }),
            methods::PROJECT_CREATE => to_value(self.project_create(parse(params)?)?),
            methods::PROJECT_LIST => to_value(self.project_list()),
            methods::PROJECT_GET => to_value(self.project_get(parse(params)?)?),
            methods::DOCUMENT_IMPORT => to_value(self.document_import(parse(params)?)?),
            methods::DOCUMENT_LIST => to_value(self.document_list(parse(params)?)?),
            methods::DOCUMENT_EXPORT => to_value(self.document_export(parse(params)?)?),
            methods::SEGMENT_LIST => to_value(self.segment_list(parse(params)?)?),
            methods::SEGMENT_UPDATE => to_value(self.segment_update(parse(params)?)?),
            methods::SEGMENT_CONFIRM => to_value(self.segment_confirm(parse(params)?)?),
            methods::TM_LOOKUP => to_value(self.tm_lookup(parse(params)?)?),
            methods::QA_RUN => to_value(self.qa_run(parse(params)?)?),
            methods::QA_LIST => to_value(self.qa_list(parse(params)?)?),
            methods::AI_CONFIGURE => to_value(self.ai_configure(parse(params)?)?),
            methods::AI_STATUS => to_value(self.ai_status()),
            methods::AI_ASSIST => to_value(self.ai_assist(parse(params)?)?),
            methods::AI_AGENT_RUN => to_value(self.ai_agent_run(parse(params)?, notify)?),
            other => Err(EngineError::InvalidParams(format!(
                "unknown method: {other}"
            ))),
        }
    }

    fn initialize(&self, params: InitializeParams) -> Result<InitializeResult, EngineError> {
        if params.protocol_version != PROTOCOL_VERSION {
            return Err(EngineError::Conflict(format!(
                "protocol version mismatch: client {} vs engine {PROTOCOL_VERSION}",
                params.protocol_version
            )));
        }
        Ok(InitializeResult {
            protocol_version: PROTOCOL_VERSION,
            engine_name: tl_protocol::ENGINE_NAME.to_string(),
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            capabilities: EngineCapabilities {
                filters: self
                    .registry
                    .descriptors()
                    .into_iter()
                    .map(|descriptor| descriptor.id)
                    .collect(),
                ai_assist: true,
                ai_agent: true,
                notifications: true,
            },
        })
    }

    fn project_create(&mut self, params: ProjectCreateParams) -> Result<Project, EngineError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(EngineError::InvalidParams(
                "project name must not be empty".to_string(),
            ));
        }
        if params.source_locale.trim().is_empty() || params.target_locale.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "source and target locales are required".to_string(),
            ));
        }
        let now = now_ms();
        let project = Project {
            id: new_id(),
            name: name.to_string(),
            source_locale: params.source_locale.trim().to_string(),
            target_locale: params.target_locale.trim().to_string(),
            domain: "general".to_string(),
            lifecycle: ProjectLifecycle::Active,
            revision: 1,
            configuration: Default::default(),
            created_at_ms: now,
            updated_at_ms: now,
            archived_at_ms: None,
        };
        self.state
            .projects
            .insert(project.id.clone(), project.clone());
        self.store.save(&self.state)?;
        Ok(project)
    }

    fn project_list(&self) -> ProjectListResult {
        let mut projects: Vec<Project> = self.state.projects.values().cloned().collect();
        projects.sort_by_key(|project| std::cmp::Reverse(project.created_at_ms));
        ProjectListResult { projects }
    }

    fn project_get(&self, params: ProjectGetParams) -> Result<Project, EngineError> {
        self.state
            .projects
            .get(&params.project_id)
            .cloned()
            .ok_or_else(|| EngineError::NotFound(format!("project {}", params.project_id)))
    }

    fn require_project(&self, project_id: &str) -> Result<&Project, EngineError> {
        self.state
            .projects
            .get(project_id)
            .ok_or_else(|| EngineError::NotFound(format!("project {project_id}")))
    }

    fn require_document(&self, document_id: &str) -> Result<&DocumentRecord, EngineError> {
        self.state
            .documents
            .get(document_id)
            .ok_or_else(|| EngineError::NotFound(format!("document {document_id}")))
    }

    fn document_import(
        &mut self,
        params: DocumentImportParams,
    ) -> Result<DocumentImportResult, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        let source = PathBuf::from(&params.source_path);
        if !source.is_file() {
            return Err(EngineError::NotFound(format!(
                "source file {}",
                source.display()
            )));
        }
        let filter = self.registry.select(&source, params.filter_id.as_deref())?;
        let document_id = new_id();

        let mut request = ImportRequest::new(source.clone());
        request.document_id = Some(document_id.clone());
        request.source_locale = Some(project.source_locale.clone());
        let imported = collect_imported_document(filter.import(request)?)?;
        if imported.units.is_empty() {
            return Err(EngineError::InvalidParams(
                "document contains no translatable text".to_string(),
            ));
        }

        // Keep a managed copy so export never depends on the original path.
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bin");
        let managed_dir = self.data_dir.join("documents").join(&document_id);
        std::fs::create_dir_all(&managed_dir)?;
        let managed_source_path = managed_dir.join(format!("source.{extension}"));
        std::fs::copy(&source, &managed_source_path)?;
        let bytes = std::fs::read(&managed_source_path)?;

        let now = now_ms();
        let prepared = import::build_segments(&document_id, &imported, &project.source_locale, now);
        let segment_count = u32::try_from(prepared.segments.len()).unwrap_or(u32::MAX);
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document")
            .to_string();
        let document = Document {
            id: document_id.clone(),
            project_id: project.id.clone(),
            name,
            relative_path: params.source_path.clone(),
            format: imported.metadata.format.clone(),
            filter_id: filter.descriptor().id,
            source_sha256: sha256_hex(&bytes),
            current_version: 1,
            status: DocumentStatus::Active,
            revision: 1,
            segment_count,
            degradation: imported.degradation.clone(),
            imported_at_ms: now,
            updated_at_ms: now,
        };
        let record = DocumentRecord {
            document: document.clone(),
            managed_source_path: managed_source_path.display().to_string(),
            segment_ids: prepared.segments.iter().map(|s| s.id.clone()).collect(),
            segment_leading: prepared.leading,
        };
        for segment in prepared.segments {
            self.state.segments.insert(segment.id.clone(), segment);
        }
        self.state.documents.insert(document_id, record);
        self.store.save(&self.state)?;
        Ok(DocumentImportResult {
            document,
            segment_count,
        })
    }

    fn document_list(&self, params: DocumentListParams) -> Result<DocumentListResult, EngineError> {
        self.require_project(&params.project_id)?;
        let mut documents: Vec<Document> = self
            .state
            .documents
            .values()
            .filter(|record| record.document.project_id == params.project_id)
            .map(|record| record.document.clone())
            .collect();
        documents.sort_by_key(|document| document.imported_at_ms);
        Ok(DocumentListResult { documents })
    }

    fn document_export(
        &mut self,
        params: DocumentExportParams,
    ) -> Result<DocumentExportResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let output = PathBuf::from(&params.output_path);
        if output.exists() {
            return Err(EngineError::ExportBlocked(format!(
                "output path already exists: {}",
                output.display()
            )));
        }
        let segments: Vec<Segment> = record
            .segment_ids
            .iter()
            .filter_map(|id| self.state.segments.get(id).cloned())
            .collect();
        let merged = export::merge_for_export(&segments, &record.segment_leading);
        let filter = self.registry.resolve(&record.document.filter_id)?;
        let source = PathBuf::from(&record.managed_source_path);
        let report = filter.export(tl_filter_core::ExportRequest {
            source: &source,
            output: &output,
            segments: &merged,
        })?;
        Ok(DocumentExportResult {
            output_path: report.output_path,
            translated_segments: report.translated_segments,
            degradation: report.degradation,
        })
    }

    fn segment_list(&self, params: SegmentListParams) -> Result<SegmentListResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let segments = record
            .segment_ids
            .iter()
            .filter_map(|id| self.state.segments.get(id).cloned())
            .collect();
        Ok(SegmentListResult { segments })
    }

    fn segment_update(
        &mut self,
        params: SegmentUpdateParams,
    ) -> Result<SegmentUpdateResult, EngineError> {
        let now = now_ms();
        let segment = self
            .state
            .segments
            .get_mut(&params.segment_id)
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        if segment.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "segment revision moved to {}; refresh before editing",
                segment.revision
            )));
        }
        segment.target_text = params.target_text;
        segment.state = if segment.target_text.trim().is_empty() {
            SegmentState::Untranslated
        } else {
            SegmentState::Draft
        };
        segment.revision += 1;
        segment.updated_at_ms = now;
        let updated = segment.clone();
        self.store.save(&self.state)?;
        Ok(SegmentUpdateResult { segment: updated })
    }

    fn segment_confirm(
        &mut self,
        params: SegmentConfirmParams,
    ) -> Result<SegmentConfirmResult, EngineError> {
        let now = now_ms();
        let segment = self
            .state
            .segments
            .get_mut(&params.segment_id)
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        if segment.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "segment revision moved to {}; refresh before confirming",
                segment.revision
            )));
        }
        if segment.target_text.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "cannot confirm a segment without a target".to_string(),
            ));
        }
        segment.state = SegmentState::Confirmed;
        segment.revision += 1;
        segment.updated_at_ms = now;
        let confirmed = segment.clone();

        let project_id = self
            .state
            .documents
            .get(&confirmed.document_id)
            .map(|record| record.document.project_id.clone())
            .ok_or_else(|| {
                EngineError::Internal("confirmed segment has no document".to_string())
            })?;

        // Upsert the project TM entry for this normalized source.
        let memory_id = format!("tm-{project_id}");
        let existing = self.state.tm_entries.values_mut().find(|entry| {
            entry.memory_id == memory_id && entry.source_hash == confirmed.source_hash
        });
        let tm_entry = match existing {
            Some(entry) => {
                entry.target_text = confirmed.target_text.clone();
                entry.origin_document_id = confirmed.document_id.clone();
                entry.origin_segment_id = confirmed.id.clone();
                entry.confirmed_at_ms = now;
                entry.clone()
            }
            None => {
                let entry = TmEntry {
                    id: new_id(),
                    memory_id,
                    source_text: confirmed.source_text.clone(),
                    target_text: confirmed.target_text.clone(),
                    source_hash: confirmed.source_hash.clone(),
                    origin_project_id: project_id.clone(),
                    origin_document_id: confirmed.document_id.clone(),
                    origin_segment_id: confirmed.id.clone(),
                    confirmed_at_ms: now,
                };
                self.state
                    .tm_entries
                    .insert(entry.id.clone(), entry.clone());
                entry
            }
        };

        // Propagate to untranslated duplicates across the project as drafts.
        let project_document_ids: Vec<String> = self
            .state
            .documents
            .values()
            .filter(|record| record.document.project_id == project_id)
            .map(|record| record.document.id.clone())
            .collect();
        let mut propagated = Vec::new();
        for sibling in self.state.segments.values_mut() {
            if sibling.id != confirmed.id
                && project_document_ids.contains(&sibling.document_id)
                && sibling.source_hash == confirmed.source_hash
                && sibling.state == SegmentState::Untranslated
                && sibling.target_text.trim().is_empty()
            {
                sibling.target_text = confirmed.target_text.clone();
                sibling.state = SegmentState::Draft;
                sibling.revision += 1;
                sibling.updated_at_ms = now;
                propagated.push(sibling.clone());
            }
        }
        self.store.save(&self.state)?;
        Ok(SegmentConfirmResult {
            segment: confirmed,
            tm_entry,
            propagated,
        })
    }

    fn tm_lookup(&self, params: TmLookupParams) -> Result<TmLookupResult, EngineError> {
        self.require_project(&params.project_id)?;
        let memory_id = format!("tm-{}", params.project_id);
        let hash = sha256_hex(normalize_text(&params.source_text).as_bytes());
        let mut matches: Vec<TmMatchItem> = self
            .state
            .tm_entries
            .values()
            .filter(|entry| entry.memory_id == memory_id && entry.source_hash == hash)
            .map(|entry| TmMatchItem {
                entry: entry.clone(),
                score: 100,
                grade: TmMatchGrade::Exact,
            })
            .collect();
        matches.sort_by_key(|item| std::cmp::Reverse(item.entry.confirmed_at_ms));
        Ok(TmLookupResult { matches })
    }

    fn qa_run(&mut self, params: QaRunParams) -> Result<QaRunResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let segment_ids = record.segment_ids.clone();
        let now = now_ms();
        let mut checked = 0_u32;
        let mut current_fingerprints = Vec::new();
        for segment_id in &segment_ids {
            let Some(segment) = self.state.segments.get(segment_id) else {
                continue;
            };
            if segment.target_text.trim().is_empty() {
                continue;
            }
            checked += 1;
            let Some(evidence) = number_mismatch(&segment.source_text, &segment.target_text) else {
                continue;
            };
            let fingerprint = number_issue_fingerprint(&segment.id, &evidence);
            current_fingerprints.push(fingerprint.clone());
            let existing = self
                .state
                .qa_issues
                .values_mut()
                .find(|issue| issue.fingerprint == fingerprint);
            match existing {
                Some(issue) => {
                    issue.status = QaIssueStatus::Open;
                    issue.evidence = evidence;
                    issue.updated_at_ms = now;
                }
                None => {
                    let issue = QaIssue {
                        id: new_id(),
                        segment_id: segment.id.clone(),
                        rule_id: QA_NUMBER_RULE_ID.to_string(),
                        severity: QaSeverity::Error,
                        status: QaIssueStatus::Open,
                        message: format!(
                            "numbers differ between source [{}] and target [{}]",
                            evidence.source_numbers.join(", "),
                            evidence.target_numbers.join(", ")
                        ),
                        fingerprint,
                        evidence,
                        created_at_ms: now,
                        updated_at_ms: now,
                    };
                    self.state.qa_issues.insert(issue.id.clone(), issue);
                }
            }
        }
        // Resolve issues that no longer reproduce for this document.
        for issue in self.state.qa_issues.values_mut() {
            if segment_ids.contains(&issue.segment_id)
                && issue.status == QaIssueStatus::Open
                && !current_fingerprints.contains(&issue.fingerprint)
            {
                issue.status = QaIssueStatus::Resolved;
                issue.updated_at_ms = now;
            }
        }
        self.store.save(&self.state)?;
        let issues = self.document_issues(&segment_ids);
        let open_issues = issues
            .iter()
            .filter(|issue| issue.status == QaIssueStatus::Open)
            .count() as u32;
        Ok(QaRunResult {
            checked_segments: checked,
            open_issues,
            issues,
        })
    }

    fn qa_list(&self, params: QaListParams) -> Result<QaListResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        Ok(QaListResult {
            issues: self.document_issues(&record.segment_ids),
        })
    }

    fn document_issues(&self, segment_ids: &[String]) -> Vec<QaIssue> {
        let mut issues: Vec<QaIssue> = self
            .state
            .qa_issues
            .values()
            .filter(|issue| segment_ids.contains(&issue.segment_id))
            .cloned()
            .collect();
        issues.sort_by(|a, b| {
            (a.status == QaIssueStatus::Resolved)
                .cmp(&(b.status == QaIssueStatus::Resolved))
                .then(a.created_at_ms.cmp(&b.created_at_ms))
        });
        issues
    }

    fn ai_configure(&mut self, params: AiConfigureParams) -> Result<AiStatusResult, EngineError> {
        let runtime = aiops::build_runtime(params, now_ms())
            .map_err(|error| EngineError::InvalidParams(error.to_string()))?;
        self.ai = Some(runtime);
        Ok(self.ai_status())
    }

    fn ai_status(&self) -> AiStatusResult {
        match &self.ai {
            Some(runtime) => AiStatusResult {
                configured: true,
                provider: Some(runtime.profile.kind),
                model: Some(runtime.profile.model.clone()),
            },
            None => AiStatusResult {
                configured: false,
                provider: None,
                model: None,
            },
        }
    }

    fn ai_assist(&mut self, params: AiAssistParams) -> Result<AiAssistResult, EngineError> {
        let segment = self
            .state
            .segments
            .get(&params.segment_id)
            .cloned()
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        let record = self.require_document(&segment.document_id)?;
        let project = self.require_project(&record.document.project_id)?.clone();
        if params.action == AiAssistAction::Refine && segment.target_text.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "cannot refine a segment without a target".to_string(),
            ));
        }
        let runtime = self.ai.as_ref().ok_or(EngineError::AiNotConfigured)?;
        let messages = aiops::assist_messages(
            params.action,
            params.instruction.as_deref(),
            &project.source_locale,
            &project.target_locale,
            &segment.source_text,
            &segment.target_text,
        );
        let completion = aiops::run_completion(
            runtime,
            messages,
            &segment.source_text,
            &project.source_locale,
            &project.target_locale,
        )
        .map_err(|error| EngineError::AiFailed(error.to_string()))?;
        Ok(AiAssistResult {
            draft_target: completion.text.trim().to_string(),
            provider: runtime.profile.kind,
            model: runtime.profile.model.clone(),
            elapsed_ms: completion.elapsed_ms,
        })
    }

    fn ai_agent_run(
        &mut self,
        params: AgentRunParams,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> Result<AgentRunResult, EngineError> {
        if self.ai.is_none() {
            return Err(EngineError::AiNotConfigured);
        }
        let record = self.require_document(&params.document_id)?;
        let project = self.require_project(&record.document.project_id)?.clone();
        let document_id = record.document.id.clone();
        let memory_id = format!("tm-{}", project.id);
        let max_segments = params
            .max_segments
            .unwrap_or(AGENT_DEFAULT_MAX_SEGMENTS)
            .max(1) as usize;
        let pending: Vec<String> = record
            .segment_ids
            .iter()
            .filter(|id| {
                self.state.segments.get(*id).is_some_and(|segment| {
                    segment.state == SegmentState::Untranslated
                        && segment.target_text.trim().is_empty()
                })
            })
            .take(max_segments)
            .cloned()
            .collect();

        let run_id = new_id();
        let mut steps: Vec<AgentStep> = Vec::new();
        let emit = |steps: &mut Vec<AgentStep>,
                    notify: &mut dyn FnMut(RpcNotification),
                    kind: AgentStepKind,
                    status: AgentStepStatus,
                    segment_id: Option<String>,
                    detail: String| {
            let step = AgentStep {
                index: steps.len() as u32,
                kind,
                status,
                segment_id,
                detail,
            };
            steps.push(step.clone());
            notify(RpcNotification {
                method: notifications::AGENT_STEP.to_string(),
                params: serde_json::to_value(AgentStepNotification {
                    run_id: run_id.clone(),
                    document_id: document_id.clone(),
                    step,
                })
                .unwrap_or(Value::Null),
            });
        };

        emit(
            &mut steps,
            notify,
            AgentStepKind::Plan,
            AgentStepStatus::Done,
            None,
            format!(
                "planned run: {} untranslated segment(s), TM first, then AI drafting",
                pending.len()
            ),
        );

        let mut translated = 0_u32;
        let mut failed = 0_u32;
        let now = now_ms();
        for segment_id in &pending {
            let Some(segment) = self.state.segments.get(segment_id).cloned() else {
                continue;
            };
            // Tool 1: exact TM reuse.
            let tm_hit = self
                .state
                .tm_entries
                .values()
                .find(|entry| {
                    entry.memory_id == memory_id && entry.source_hash == segment.source_hash
                })
                .map(|entry| entry.target_text.clone());
            let (draft, detail) = if let Some(target) = tm_hit {
                (Some(target), "reused exact TM match".to_string())
            } else {
                // Tool 2: AI drafting.
                let runtime = self.ai.as_ref().ok_or(EngineError::AiNotConfigured)?;
                let messages = aiops::assist_messages(
                    AiAssistAction::Translate,
                    params.instruction.as_deref(),
                    &project.source_locale,
                    &project.target_locale,
                    &segment.source_text,
                    "",
                );
                match aiops::run_completion(
                    runtime,
                    messages,
                    &segment.source_text,
                    &project.source_locale,
                    &project.target_locale,
                ) {
                    Ok(completion) => (
                        Some(completion.text.trim().to_string()),
                        format!(
                            "AI draft from {} in {} ms",
                            runtime.profile.model, completion.elapsed_ms
                        ),
                    ),
                    Err(error) => (None, format!("AI call failed: {error}")),
                }
            };
            match draft {
                Some(target) if !target.trim().is_empty() => {
                    if let Some(stored) = self.state.segments.get_mut(segment_id) {
                        stored.target_text = target;
                        stored.state = SegmentState::Draft;
                        stored.revision += 1;
                        stored.updated_at_ms = now;
                    }
                    translated += 1;
                    emit(
                        &mut steps,
                        notify,
                        AgentStepKind::Translate,
                        AgentStepStatus::Done,
                        Some(segment_id.clone()),
                        detail,
                    );
                }
                _ => {
                    failed += 1;
                    emit(
                        &mut steps,
                        notify,
                        AgentStepKind::Translate,
                        AgentStepStatus::Failed,
                        Some(segment_id.clone()),
                        detail,
                    );
                }
            }
        }
        self.store.save(&self.state)?;

        // Tool 3: deterministic QA over the whole document.
        let qa = self.qa_run(QaRunParams {
            document_id: document_id.clone(),
        })?;
        emit(
            &mut steps,
            notify,
            AgentStepKind::Qa,
            AgentStepStatus::Done,
            None,
            format!(
                "number QA checked {} segment(s), {} open issue(s)",
                qa.checked_segments, qa.open_issues
            ),
        );

        let status = if failed == 0 && qa.open_issues == 0 {
            AgentRunStatus::Completed
        } else if translated > 0 || failed == 0 {
            AgentRunStatus::CompletedWithIssues
        } else {
            AgentRunStatus::Failed
        };
        emit(
            &mut steps,
            notify,
            AgentStepKind::Summary,
            AgentStepStatus::Done,
            None,
            format!(
                "translated {translated}, failed {failed}, open QA issues {}",
                qa.open_issues
            ),
        );
        Ok(AgentRunResult {
            run_id,
            document_id,
            status,
            steps,
            translated_segments: translated,
            failed_segments: failed,
            open_qa_issues: qa.open_issues,
        })
    }
}
