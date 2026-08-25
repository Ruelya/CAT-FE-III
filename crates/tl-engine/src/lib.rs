//! tl-engine: the CAT engine behind the desktop shell.
//!
//! Scope: project lifecycle, DOCX (and friends) import with SRX sentence
//! segmentation (built-in or user-supplied rulesets), grid editing with
//! optimistic concurrency, exact + fuzzy translation memory with
//! confirmation-time propagation, TMX/CSV TM exchange, threshold-based
//! pretranslation, termbases with CSV/TBX exchange and in-text hits, the
//! deterministic QA rule library from `tl-qa`, filter-backed export, and an
//! honest AI assist/agent skeleton that refuses to fabricate output when no
//! provider is configured.

mod agent;
mod aiops;
mod assets;
mod export;
mod import;
mod qacheck;
mod store;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use tl_ai::check_tag_integrity;
use tl_asset::TmIndex;
use tl_domain::{
    Document, DocumentStatus, Project, ProjectLifecycle, Segment, SegmentState, new_id, sha256_hex,
};
use tl_filter_core::{
    DocumentFilter, FilterError, FilterRegistry, ImportRequest, collect_imported_document,
};
use tl_protocol::{
    AgentCancelParams, AgentRunStatus, AgentRunView, AgentStartParams, AgentStatusParams,
    AgentStep, AgentStepKind, AgentStepNotification, AgentStepStatus, AiAssistAction,
    AiAssistParams, AiAssistResult, AiConfigureParams, AiStatusResult, DocumentExportParams,
    DocumentExportResult, DocumentImportParams, DocumentImportResult, DocumentListParams,
    DocumentListResult, EngineCapabilities, EngineReadyNotification, InitializeParams,
    InitializeResult, PROTOCOL_VERSION, ProjectCreateParams, ProjectGetParams, ProjectListResult,
    QaRunParams, RpcError, RpcErrorCode, RpcNotification, RpcRequest, RpcResponse,
    SegmentConfirmParams, SegmentConfirmResult, SegmentListParams, SegmentListResult,
    SegmentUpdateParams, SegmentUpdateResult, ShutdownResult, methods, notifications,
};
use tl_segmentation::{SegmentationMode, SrxRules};

pub use agent::AgentEvent;
pub use store::{DocumentRecord, EngineState};

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

/// In-flight or finished agent run bookkeeping. Runs live in engine memory
/// only; the segment drafts they produce are persisted like any other edit.
struct AgentRunState {
    view: AgentRunView,
    cancel: Arc<AtomicBool>,
}

pub struct Engine {
    data_dir: PathBuf,
    store: store::Store,
    state: EngineState,
    registry: FilterRegistry,
    ai: Option<aiops::AiRuntime>,
    /// Fuzzy recall indexes, one per translation memory, rebuilt on open and
    /// maintained on every TM write.
    tm_indexes: BTreeMap<String, TmIndex>,
    agent_runs: BTreeMap<String, AgentRunState>,
    agent_events_tx: Sender<AgentEvent>,
    agent_events_rx: Option<Receiver<AgentEvent>>,
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
            // Explicit two-column bilingual table modes. Both probe as
            // no-match, so ordinary .docx/.xlsx probing is unchanged; they
            // only run when document.import names their filter id.
            Arc::new(tl_filter_docx::BilingualDocxFilter),
            Arc::new(tl_filter_xlsx::BilingualXlsxFilter),
        ];
        for filter in filters {
            registry
                .register(filter)
                .map_err(|error| EngineError::Internal(error.to_string()))?;
        }
        let mut tm_indexes: BTreeMap<String, TmIndex> = BTreeMap::new();
        for entry in state.tm_entries.values() {
            tm_indexes
                .entry(entry.memory_id.clone())
                .or_default()
                .insert(&entry.id, &entry.source_text);
        }
        let (agent_events_tx, agent_events_rx) = channel();
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            store,
            state,
            registry,
            ai: None,
            tm_indexes,
            agent_runs: BTreeMap::new(),
            agent_events_tx,
            agent_events_rx: Some(agent_events_rx),
        })
    }

    /// Hand the agent event stream to the caller's loop. Worker threads feed
    /// it; the caller must route every event back through
    /// [`Engine::handle_agent_event`]. Callable once.
    pub fn take_agent_events(&mut self) -> Receiver<AgentEvent> {
        self.agent_events_rx
            .take()
            .expect("agent event receiver was already taken")
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
            methods::TM_IMPORT => to_value(self.tm_import(parse(params)?)?),
            methods::TM_EXPORT => to_value(self.tm_export(parse(params)?)?),
            methods::TM_PRETRANSLATE => to_value(self.tm_pretranslate(parse(params)?)?),
            methods::TERMBASE_CREATE => to_value(self.termbase_create(parse(params)?)?),
            methods::TERMBASE_LIST => to_value(self.termbase_list(parse(params)?)?),
            methods::TERMBASE_ATTACH => to_value(self.termbase_attach(parse(params)?)?),
            methods::TERMBASE_IMPORT => to_value(self.termbase_import(parse(params)?)?),
            methods::TERMBASE_EXPORT => to_value(self.termbase_export(parse(params)?)?),
            methods::TERM_ADD => to_value(self.term_add(parse(params)?)?),
            methods::TERM_LIST => to_value(self.term_list(parse(params)?)?),
            methods::TERM_LOOKUP => to_value(self.term_lookup(parse(params)?)?),
            methods::QA_RUN => to_value(self.qa_run(parse(params)?)?),
            methods::QA_LIST => to_value(self.qa_list(parse(params)?)?),
            methods::AI_CONFIGURE => to_value(self.ai_configure(parse(params)?)?),
            methods::AI_STATUS => to_value(self.ai_status()),
            methods::AI_ASSIST => to_value(self.ai_assist(parse(params)?)?),
            methods::AI_AGENT_START => to_value(self.ai_agent_start(parse(params)?, notify)?),
            methods::AI_AGENT_STATUS => to_value(self.ai_agent_status(parse(params)?)?),
            methods::AI_AGENT_CANCEL => to_value(self.ai_agent_cancel(parse(params)?)?),
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

        // Resolve the segmentation ruleset before touching any state so a bad
        // SRX file fails the import cleanly.
        let srx_rules = match params.srx_path.as_deref() {
            Some(path) => {
                let xml = std::fs::read_to_string(path)?;
                SrxRules::parse(&xml).map_err(|error| {
                    EngineError::InvalidParams(format!("invalid SRX ruleset {path}: {error}"))
                })?
            }
            None => SrxRules::builtin(&project.source_locale),
        };
        let segmentation_mode = match params.segmentation.as_deref().map(str::trim) {
            None | Some("") | Some("sentence") | Some("srx") => SegmentationMode::Sentence,
            Some("paragraph") => SegmentationMode::Paragraph,
            Some(other) => {
                return Err(EngineError::InvalidParams(format!(
                    "unknown segmentation mode: {other}"
                )));
            }
        };

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
        let prepared = import::build_segments(
            &document_id,
            &imported,
            &project.source_locale,
            &srx_rules,
            segmentation_mode,
            now,
        );
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
        let memory_id = Self::project_memory_id(&project_id);
        let (tm_entry, _) = self.upsert_tm_entry(
            &memory_id,
            &project_id,
            &confirmed.source_text,
            &confirmed.target_text,
            &confirmed.source_hash,
            &confirmed.document_id,
            &confirmed.id,
            now,
        );

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
        if segment.state == SegmentState::Confirmed {
            return Err(EngineError::Conflict(
                "segment is confirmed; AI assist never overwrites confirmed work".to_string(),
            ));
        }
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
            &runtime.profile,
            &runtime.credential,
            messages,
            &segment.source_text,
            &project.source_locale,
            &project.target_locale,
            &AtomicBool::new(false),
        )
        .map_err(|error| EngineError::AiFailed(error.to_string()))?;
        let draft_target = completion.text.trim().to_string();
        let tag_check = check_tag_integrity(&segment.source_text, &draft_target);
        Ok(AiAssistResult {
            draft_target,
            provider: runtime.profile.kind,
            model: runtime.profile.model.clone(),
            elapsed_ms: completion.elapsed_ms,
            tag_check,
        })
    }

    /// Start an agent run: plan, apply exact TM pretranslation inline, then
    /// hand the TM misses to a worker thread for AI drafting. Returns the
    /// task order immediately; heavy provider calls never block the RPC loop.
    fn ai_agent_start(
        &mut self,
        params: AgentStartParams,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> Result<AgentRunView, EngineError> {
        // Honest degradation: without a provider the run must not start.
        let runtime = self.ai.as_ref().ok_or(EngineError::AiNotConfigured)?;
        if let Some(active) = self
            .agent_runs
            .values()
            .find(|run| run.view.status == AgentRunStatus::Running)
        {
            return Err(EngineError::Conflict(format!(
                "agent run {} is still running; cancel it or wait",
                active.view.run_id
            )));
        }
        let record = self.require_document(&params.document_id)?;
        let project = self.require_project(&record.document.project_id)?.clone();
        let document_id = record.document.id.clone();
        let memory_id = Self::project_memory_id(&project.id);
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

        let now = now_ms();
        let mut view = AgentRunView {
            run_id: new_id(),
            document_id: document_id.clone(),
            status: AgentRunStatus::Running,
            cancel_requested: false,
            planned_segments: pending.len() as u32,
            tm_applied: 0,
            ai_drafted: 0,
            failed_segments: 0,
            open_qa_issues: 0,
            steps: Vec::new(),
            created_at_ms: now,
            updated_at_ms: now,
        };
        push_agent_step(
            &mut view,
            notify,
            AgentStepKind::Plan,
            AgentStepStatus::Done,
            None,
            format!(
                "任务单：{} 个未翻译句段；TM 预翻 → AI 起草未命中段 → QA；结束停在人工审核门",
                pending.len()
            ),
        );

        // Phase 1 of the run: exact TM pretranslation, cheap and local.
        let mut misses: Vec<agent::AgentWorkItem> = Vec::new();
        for segment_id in &pending {
            let Some(segment) = self.state.segments.get(segment_id).cloned() else {
                continue;
            };
            let tm_hit = self
                .state
                .tm_entries
                .values()
                .find(|entry| {
                    entry.memory_id == memory_id && entry.source_hash == segment.source_hash
                })
                .map(|entry| entry.target_text.clone());
            match tm_hit {
                Some(target) if !target.trim().is_empty() => {
                    if let Some(stored) = self.state.segments.get_mut(segment_id) {
                        stored.target_text = target;
                        stored.state = SegmentState::Draft;
                        stored.revision += 1;
                        stored.updated_at_ms = now;
                    }
                    view.tm_applied += 1;
                    push_agent_step(
                        &mut view,
                        notify,
                        AgentStepKind::Tm,
                        AgentStepStatus::Done,
                        Some(segment_id.clone()),
                        "复用精确 TM 匹配，落为草稿".to_string(),
                    );
                }
                _ => misses.push(agent::AgentWorkItem {
                    segment_id: segment_id.clone(),
                    source_text: segment.source_text.clone(),
                }),
            }
        }
        if view.tm_applied > 0 {
            self.store.save(&self.state)?;
        }

        let cancel = Arc::new(AtomicBool::new(false));
        agent::spawn_worker(agent::AgentJob {
            run_id: view.run_id.clone(),
            items: misses,
            instruction: params.instruction.clone(),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            profile: runtime.profile.clone(),
            credential: runtime.credential.duplicate(),
            cancel: Arc::clone(&cancel),
            events: self.agent_events_tx.clone(),
        });
        let run_id = view.run_id.clone();
        self.agent_runs.insert(
            run_id,
            AgentRunState {
                view: view.clone(),
                cancel,
            },
        );
        Ok(view)
    }

    fn ai_agent_status(&self, params: AgentStatusParams) -> Result<AgentRunView, EngineError> {
        self.agent_runs
            .get(&params.run_id)
            .map(|run| run.view.clone())
            .ok_or_else(|| EngineError::NotFound(format!("agent run {}", params.run_id)))
    }

    fn ai_agent_cancel(&mut self, params: AgentCancelParams) -> Result<AgentRunView, EngineError> {
        let run = self
            .agent_runs
            .get_mut(&params.run_id)
            .ok_or_else(|| EngineError::NotFound(format!("agent run {}", params.run_id)))?;
        if run.view.status == AgentRunStatus::Running {
            run.cancel.store(true, Ordering::Relaxed);
            run.view.cancel_requested = true;
            run.view.updated_at_ms = now_ms();
        }
        Ok(run.view.clone())
    }

    /// Apply one worker event to engine state. The caller (stdio loop or
    /// test) owns event delivery so the engine stays single-threaded.
    pub fn handle_agent_event(
        &mut self,
        event: AgentEvent,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> Result<(), EngineError> {
        match event {
            AgentEvent::Drafted {
                run_id,
                segment_id,
                outcome,
            } => {
                let Some(run) = self.agent_runs.get_mut(&run_id) else {
                    return Ok(());
                };
                if run.view.status != AgentRunStatus::Running {
                    return Ok(());
                }
                match outcome {
                    Ok(draft) if !draft.target.trim().is_empty() => {
                        let still_pending =
                            self.state.segments.get(&segment_id).is_some_and(|segment| {
                                segment.state == SegmentState::Untranslated
                                    && segment.target_text.trim().is_empty()
                            });
                        if !still_pending {
                            push_agent_step(
                                &mut run.view,
                                notify,
                                AgentStepKind::Translate,
                                AgentStepStatus::Skipped,
                                Some(segment_id),
                                "句段在运行期间被人工修改，保留人工内容".to_string(),
                            );
                            return Ok(());
                        }
                        let source_text = self
                            .state
                            .segments
                            .get(&segment_id)
                            .map(|segment| segment.source_text.clone())
                            .unwrap_or_default();
                        let integrity = check_tag_integrity(&source_text, &draft.target);
                        if !integrity.ok {
                            run.view.failed_segments += 1;
                            push_agent_step(
                                &mut run.view,
                                notify,
                                AgentStepKind::Translate,
                                AgentStepStatus::Failed,
                                Some(segment_id),
                                format!(
                                    "标签完整性校验未通过（缺失 {}，多余 {}），不落草稿",
                                    integrity.missing.len(),
                                    integrity.extra.len()
                                ),
                            );
                            return Ok(());
                        }
                        let now = now_ms();
                        if let Some(stored) = self.state.segments.get_mut(&segment_id) {
                            stored.target_text = draft.target;
                            stored.state = SegmentState::Draft;
                            stored.revision += 1;
                            stored.updated_at_ms = now;
                        }
                        run.view.ai_drafted += 1;
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Translate,
                            AgentStepStatus::Done,
                            Some(segment_id),
                            format!("AI 草稿（{}，{} ms）", draft.model, draft.elapsed_ms),
                        );
                        self.store.save(&self.state)?;
                    }
                    Ok(_) => {
                        run.view.failed_segments += 1;
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Translate,
                            AgentStepStatus::Failed,
                            Some(segment_id),
                            "AI 返回空译文，不落草稿".to_string(),
                        );
                    }
                    Err(message) => {
                        run.view.failed_segments += 1;
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Translate,
                            AgentStepStatus::Failed,
                            Some(segment_id),
                            format!("AI 调用失败：{message}"),
                        );
                    }
                }
                Ok(())
            }
            AgentEvent::Finished { run_id } => {
                let Some(run) = self.agent_runs.get(&run_id) else {
                    return Ok(());
                };
                if run.view.status != AgentRunStatus::Running {
                    return Ok(());
                }
                let document_id = run.view.document_id.clone();
                // Deterministic QA runs on the engine thread; it is local and
                // fast. Borrow of the run ends before qa_run needs &mut self.
                let qa = self.qa_run(QaRunParams {
                    document_id: document_id.clone(),
                });
                let Some(run) = self.agent_runs.get_mut(&run_id) else {
                    return Ok(());
                };
                match qa {
                    Ok(qa) => {
                        run.view.open_qa_issues = qa.open_issues;
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Qa,
                            AgentStepStatus::Done,
                            None,
                            format!(
                                "数字 QA 检查 {} 个句段，{} 个未解决问题",
                                qa.checked_segments, qa.open_issues
                            ),
                        );
                        run.view.status = AgentRunStatus::AwaitingReview;
                        let summary = format!(
                            "TM 复用 {}，AI 草稿 {}，失败 {}，QA 未解决 {}。已停在人工审核门：请到工作台确认或导出，Agent 不会代做。",
                            run.view.tm_applied,
                            run.view.ai_drafted,
                            run.view.failed_segments,
                            run.view.open_qa_issues
                        );
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Summary,
                            AgentStepStatus::Done,
                            None,
                            summary,
                        );
                    }
                    Err(error) => {
                        run.view.status = AgentRunStatus::Failed;
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Qa,
                            AgentStepStatus::Failed,
                            None,
                            format!("QA 运行失败：{error}"),
                        );
                    }
                }
                Ok(())
            }
            AgentEvent::Canceled { run_id } => {
                let Some(run) = self.agent_runs.get_mut(&run_id) else {
                    return Ok(());
                };
                if run.view.status != AgentRunStatus::Running {
                    return Ok(());
                }
                run.view.status = AgentRunStatus::Canceled;
                push_agent_step(
                    &mut run.view,
                    notify,
                    AgentStepKind::Cancel,
                    AgentStepStatus::Done,
                    None,
                    "运行已取消：已生成的草稿保留，剩余句段未触碰".to_string(),
                );
                Ok(())
            }
        }
    }
}

/// Append a step to the run, refresh its timestamp, and emit the reserved
/// step notification carrying the current run status.
fn push_agent_step(
    view: &mut AgentRunView,
    notify: &mut dyn FnMut(RpcNotification),
    kind: AgentStepKind,
    status: AgentStepStatus,
    segment_id: Option<String>,
    detail: String,
) {
    let step = AgentStep {
        index: view.steps.len() as u32,
        kind,
        status,
        segment_id,
        detail,
    };
    view.steps.push(step.clone());
    view.updated_at_ms = now_ms();
    notify(RpcNotification {
        method: notifications::AGENT_STEP.to_string(),
        params: serde_json::to_value(AgentStepNotification {
            run_id: view.run_id.clone(),
            document_id: view.document_id.clone(),
            run_status: view.status,
            step,
        })
        .unwrap_or(Value::Null),
    });
}
