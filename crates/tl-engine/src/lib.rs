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
mod assist;
mod events;
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
    Document, DocumentStatus, Project, ProjectLifecycle, ProjectSegmentation, Segment,
    SegmentOrigin, SegmentOriginKind, SegmentState, new_id, sha256_hex,
};
use tl_filter_core::{
    DocumentFilter, FilterError, FilterRegistry, ImportRequest, collect_imported_document,
};
use tl_protocol::{
    AgentCancelParams, AgentRunStatus, AgentRunView, AgentStartParams, AgentStatusParams,
    AgentStep, AgentStepKind, AgentStepNotification, AgentStepStatus, AiAssistAction,
    AiAssistCancelParams, AiAssistParams, AiAssistResult, AiAssistRunStatus, AiAssistRunView,
    AiAssistStatusParams, AiConfigureParams, AiProviderKind, AiStatusResult, DocumentExportParams,
    DocumentExportResult, DocumentImportParams, DocumentImportResult, DocumentListParams,
    DocumentListResult, DocumentProgress, DocumentRemoveParams, DocumentRemoveResult,
    EngineCapabilities, EngineReadyNotification, InitializeParams, InitializeResult,
    PROTOCOL_VERSION, ProjectArchiveParams, ProjectCreateParams, ProjectGetParams,
    ProjectListResult, ProjectUpdateParams, QaRunParams, RpcError, RpcErrorCode, RpcNotification,
    RpcRequest, RpcResponse, SegmentConfirmParams, SegmentConfirmResult, SegmentListParams,
    SegmentListResult, SegmentLockParams, SegmentLockResult, SegmentReplaceParams,
    SegmentReplaceResult, SegmentUpdateParams, SegmentUpdateResult, ShutdownResult, methods,
    notifications,
};
use tl_segmentation::{SegmentationMode, SrxRules};

pub use events::EngineEvent;
pub use store::{DocumentRecord, EngineState};

use store::StateDelta;

const AGENT_DEFAULT_MAX_SEGMENTS: u32 = 50;
/// Upper bound on agent runs in flight at once. Each run owns a small worker
/// pool ([`agent::AGENT_SEGMENT_WORKERS`] threads), so this cap bounds the
/// total thread and provider load. Hitting it is an honest Conflict, not a
/// queue.
const AGENT_MAX_CONCURRENT_RUNS: usize = 4;
/// Terminal assist runs kept for late status polls before being pruned.
const ASSIST_TERMINAL_HISTORY: usize = 16;
/// Terminal agent runs kept for late status polls before being pruned.
const AGENT_TERMINAL_HISTORY: usize = 16;

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

/// In-flight or finished assist request bookkeeping. Lives in engine memory
/// only; assist never writes segments, so there is nothing to persist.
struct AssistRunState {
    view: AiAssistRunView,
    /// Segment source at start time, for the tag-integrity verdict.
    source_text: String,
    provider: AiProviderKind,
    model: String,
    cancel: Arc<AtomicBool>,
}

pub struct Engine {
    data_dir: PathBuf,
    store: store::Store,
    /// Metadata working set only (projects, document metadata, termbases,
    /// mounts). Segments, TM entries, term entries, and QA issues are never
    /// held here; they are read from SQLite per document / termbase / page.
    state: EngineState,
    registry: FilterRegistry,
    ai: Option<aiops::AiRuntime>,
    /// Fuzzy recall indexes, one per translation memory, rebuilt on open by
    /// streaming `(id, memory_id, source_text)` from the store and
    /// maintained on every TM insert. Memory-resident by design: recall
    /// needs token postings for the whole memory, but it keeps tokens and
    /// entry ids only — candidate rows are fetched from SQL at lookup time.
    /// Exact matches don't come through here at all; they are point queries
    /// on the store's unique `(memory_id, source_hash)` index.
    tm_indexes: BTreeMap<String, TmIndex>,
    agent_runs: BTreeMap<String, AgentRunState>,
    assist_runs: BTreeMap<String, AssistRunState>,
    events_tx: Sender<EngineEvent>,
    events_rx: Option<Receiver<EngineEvent>>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// A sibling path in the destination's directory (same filesystem, so the
/// final `rename` is an atomic replace) that cannot collide with a real file.
fn export_staging_path(output: &Path) -> PathBuf {
    let file_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export");
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    output.with_file_name(format!(
        ".{file_name}.{}.{nanos}.tl-export.tmp",
        std::process::id()
    ))
}

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, EngineError> {
    serde_json::from_value(params).map_err(|error| EngineError::InvalidParams(error.to_string()))
}

fn to_value<T: Serialize>(value: T) -> Result<Value, EngineError> {
    serde_json::to_value(value).map_err(|error| EngineError::Internal(error.to_string()))
}

/// `None`, `null`, and blank strings all mean "keep the current value".
fn provided(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Accepts `sentence` (alias `srx`) and `paragraph`.
fn parse_segmentation(value: &str) -> Result<ProjectSegmentation, EngineError> {
    match value {
        "sentence" | "srx" => Ok(ProjectSegmentation::Sentence),
        "paragraph" => Ok(ProjectSegmentation::Paragraph),
        other => Err(EngineError::InvalidParams(format!(
            "unknown segmentation mode: {other}"
        ))),
    }
}

fn to_segmentation_mode(choice: ProjectSegmentation) -> SegmentationMode {
    match choice {
        ProjectSegmentation::Sentence => SegmentationMode::Sentence,
        ProjectSegmentation::Paragraph => SegmentationMode::Paragraph,
    }
}

/// `None` keeps the current value; `Some` is trimmed and must not be empty.
fn resolve_update_field(
    value: Option<String>,
    current: &str,
    label: &str,
) -> Result<String, EngineError> {
    match value {
        None => Ok(current.to_string()),
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(EngineError::InvalidParams(format!(
                    "{label} must not be empty"
                )));
            }
            Ok(trimmed.to_string())
        }
    }
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
        // One streaming pass to seed the fuzzy recall index; the rows
        // themselves are not retained.
        let mut tm_indexes: BTreeMap<String, TmIndex> = BTreeMap::new();
        store.for_each_tm_index_seed(|id, memory_id, source_text| {
            tm_indexes
                .entry(memory_id.to_string())
                .or_default()
                .insert(id, source_text);
        })?;
        let (events_tx, events_rx) = channel();
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            store,
            state,
            registry,
            ai: None,
            tm_indexes,
            agent_runs: BTreeMap::new(),
            assist_runs: BTreeMap::new(),
            events_tx,
            events_rx: Some(events_rx),
        })
    }

    /// Hand the worker event stream to the caller's loop. Worker threads
    /// (agent, assist) feed it; the caller must route every event back
    /// through [`Engine::handle_engine_event`]. Callable once.
    pub fn take_engine_events(&mut self) -> Receiver<EngineEvent> {
        self.events_rx
            .take()
            .expect("engine event receiver was already taken")
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
            methods::PROJECT_UPDATE => to_value(self.project_update(parse(params)?)?),
            methods::PROJECT_ARCHIVE => to_value(self.project_archive(parse(params)?)?),
            methods::DOCUMENT_IMPORT => to_value(self.document_import(parse(params)?)?),
            methods::DOCUMENT_LIST => to_value(self.document_list(parse(params)?)?),
            methods::DOCUMENT_REMOVE => to_value(self.document_remove(parse(params)?)?),
            methods::DOCUMENT_EXPORT => to_value(self.document_export(parse(params)?)?),
            methods::SEGMENT_LIST => to_value(self.segment_list(parse(params)?)?),
            methods::SEGMENT_UPDATE => to_value(self.segment_update(parse(params)?)?),
            methods::SEGMENT_REPLACE => to_value(self.segment_replace(parse(params)?)?),
            methods::SEGMENT_CONFIRM => to_value(self.segment_confirm(parse(params)?)?),
            methods::SEGMENT_LOCK => to_value(self.segment_lock(parse(params)?)?),
            methods::TM_LOOKUP => to_value(self.tm_lookup(parse(params)?)?),
            methods::TM_LIST => to_value(self.tm_list(parse(params)?)?),
            methods::TM_UPDATE => to_value(self.tm_update(parse(params)?)?),
            methods::TM_DELETE => to_value(self.tm_delete(parse(params)?)?),
            methods::TM_IMPORT => to_value(self.tm_import(parse(params)?)?),
            methods::TM_EXPORT => to_value(self.tm_export(parse(params)?)?),
            methods::TM_PRETRANSLATE => to_value(self.tm_pretranslate(parse(params)?)?),
            methods::TERMBASE_CREATE => to_value(self.termbase_create(parse(params)?)?),
            methods::TERMBASE_LIST => to_value(self.termbase_list(parse(params)?)?),
            methods::TERMBASE_ATTACH => to_value(self.termbase_attach(parse(params)?)?),
            methods::TERMBASE_DETACH => to_value(self.termbase_detach(parse(params)?)?),
            methods::TERMBASE_IMPORT => to_value(self.termbase_import(parse(params)?)?),
            methods::TERMBASE_EXPORT => to_value(self.termbase_export(parse(params)?)?),
            methods::TERM_ADD => to_value(self.term_add(parse(params)?)?),
            methods::TERM_UPDATE => to_value(self.term_update(parse(params)?)?),
            methods::TERM_DELETE => to_value(self.term_delete(parse(params)?)?),
            methods::TERM_LIST => to_value(self.term_list(parse(params)?)?),
            methods::TERM_LOOKUP => to_value(self.term_lookup(parse(params)?)?),
            methods::QA_RUN => to_value(self.qa_run(parse(params)?)?),
            methods::QA_LIST => to_value(self.qa_list(parse(params)?)?),
            methods::QA_WAIVE => to_value(self.qa_waive(parse(params)?)?),
            methods::AI_CONFIGURE => to_value(self.ai_configure(parse(params)?)?),
            methods::AI_STATUS => to_value(self.ai_status()),
            methods::AI_ASSIST_START => to_value(self.ai_assist_start(parse(params)?)?),
            methods::AI_ASSIST_STATUS => to_value(self.ai_assist_status(parse(params)?)?),
            methods::AI_ASSIST_CANCEL => to_value(self.ai_assist_cancel(parse(params)?)?),
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
        self.store.apply(&StateDelta {
            projects: vec![project.clone()],
            ..Default::default()
        })?;
        self.state
            .projects
            .insert(project.id.clone(), project.clone());
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

    /// Rename, change the language pair, and/or persist the default import
    /// segmentation. Omitted fields stay unchanged.
    ///
    /// Language-pair rule (documented on [`ProjectUpdateParams`]): locales may
    /// only change while the project holds no linguistic assets. Imported
    /// documents were segmented with the old source locale, and TM entries /
    /// termbase mounts carry translations for the old pair, so changing the
    /// pair over them would silently serve wrong-language matches. The engine
    /// rejects that with `conflict` instead of allowing it with a warning.
    ///
    /// Import-default rule (documented on [`ProjectUpdateParams`]): the
    /// stored `srxPath` is a path only — its file is validated at import
    /// time, never here — and a new `srxPath` is rejected while the
    /// effective segmentation default is paragraph, where SRX rules would
    /// silently do nothing. A default that already exists survives a switch
    /// to paragraph so switching back to sentence restores it.
    fn project_update(&mut self, params: ProjectUpdateParams) -> Result<Project, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        let name = resolve_update_field(params.name, &project.name, "project name")?;
        let source_locale = resolve_update_field(
            params.source_locale,
            &project.source_locale,
            "source locale",
        )?;
        let target_locale = resolve_update_field(
            params.target_locale,
            &project.target_locale,
            "target locale",
        )?;
        let language_changed =
            source_locale != project.source_locale || target_locale != project.target_locale;
        if language_changed {
            let blockers = self.language_change_blockers(&project.id)?;
            if !blockers.is_empty() {
                return Err(EngineError::Conflict(format!(
                    "cannot change the language pair: the project already has {}; \
                     export or remove them first",
                    blockers.join(", ")
                )));
            }
        }
        let mut configuration = project.configuration.clone();
        if let Some(mode) = provided(params.segmentation.as_deref()) {
            configuration.segmentation = Some(parse_segmentation(mode)?);
        }
        let new_srx_path = provided(params.srx_path.as_deref());
        if params.clear_srx_path && new_srx_path.is_some() {
            return Err(EngineError::InvalidParams(
                "srxPath and clearSrxPath are contradictory; provide at most one".to_string(),
            ));
        }
        if params.clear_srx_path {
            configuration.srx_path = None;
        } else if let Some(path) = new_srx_path {
            if configuration.segmentation == Some(ProjectSegmentation::Paragraph) {
                return Err(EngineError::InvalidParams(
                    "srxPath only applies while the segmentation default is sentence".to_string(),
                ));
            }
            configuration.srx_path = Some(path.to_string());
        }
        let configuration_changed = configuration != project.configuration;
        if name == project.name && !language_changed && !configuration_changed {
            return Ok(project);
        }
        let now = now_ms();
        let stored = self
            .state
            .projects
            .get_mut(&params.project_id)
            .expect("project just resolved");
        stored.name = name;
        stored.source_locale = source_locale;
        stored.target_locale = target_locale;
        stored.configuration = configuration;
        stored.revision += 1;
        stored.updated_at_ms = now;
        let updated = stored.clone();
        self.store.apply(&StateDelta {
            projects: vec![updated.clone()],
            ..Default::default()
        })?;
        Ok(updated)
    }

    /// Assets that pin the project's language pair, as human-readable counts.
    /// The TM total is a SQL count — the TM table has no RAM copy to scan.
    fn language_change_blockers(&self, project_id: &str) -> Result<Vec<String>, EngineError> {
        let mut blockers = Vec::new();
        let documents = self
            .state
            .documents
            .values()
            .filter(|record| record.document.project_id == project_id)
            .count();
        if documents > 0 {
            blockers.push(format!("{documents} imported document(s)"));
        }
        let memory_id = Self::project_memory_id(project_id);
        let tm_entries = self.store.tm_entry_count(&memory_id, None)?;
        if tm_entries > 0 {
            blockers.push(format!("{tm_entries} TM entry(ies)"));
        }
        let mounts = self
            .state
            .termbase_mounts
            .iter()
            .filter(|mount| mount.project_id == project_id)
            .count();
        if mounts > 0 {
            blockers.push(format!("{mounts} attached termbase(s)"));
        }
        Ok(blockers)
    }

    /// Archive (`archived: true`) or restore (`archived: false`) a project.
    /// Archiving stamps `archived_at_ms`; restoring clears it. Both
    /// directions are idempotent and return the stored project.
    fn project_archive(&mut self, params: ProjectArchiveParams) -> Result<Project, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        let already_there = if params.archived {
            project.lifecycle == ProjectLifecycle::Archived
        } else {
            project.lifecycle == ProjectLifecycle::Active
        };
        if already_there {
            return Ok(project);
        }
        let now = now_ms();
        let stored = self
            .state
            .projects
            .get_mut(&params.project_id)
            .expect("project just resolved");
        if params.archived {
            stored.lifecycle = ProjectLifecycle::Archived;
            stored.archived_at_ms = Some(now);
        } else {
            stored.lifecycle = ProjectLifecycle::Active;
            stored.archived_at_ms = None;
        }
        stored.revision += 1;
        stored.updated_at_ms = now;
        let updated = stored.clone();
        self.store.apply(&StateDelta {
            projects: vec![updated.clone()],
            ..Default::default()
        })?;
        Ok(updated)
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

    /// The honest overwrite rule: an explicit `overwrite: true` replaces
    /// exactly the file the caller pointed at — the engine cannot tell who
    /// owns an arbitrary path on disk. The one thing it *can* detect and
    /// protect is its own managed data directory (imported source copies and
    /// databases for every project live there), so destinations inside it
    /// are refused even with overwrite.
    pub(crate) fn refuse_managed_overwrite(&self, destination: &Path) -> Result<(), EngineError> {
        let data_dir = self
            .data_dir
            .canonicalize()
            .unwrap_or_else(|_| self.data_dir.clone());
        let resolved = destination
            .canonicalize()
            .unwrap_or_else(|_| destination.to_path_buf());
        if resolved.starts_with(&data_dir) {
            return Err(EngineError::ExportBlocked(format!(
                "refusing to overwrite engine-managed file: {}",
                destination.display()
            )));
        }
        Ok(())
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

        // Resolve the effective segmentation choice. Params carrying an
        // explicit segmentation are the complete choice (so `srxPath: null`
        // then means the built-in rules); an srxPath alone implies sentence
        // mode; fully omitted params fall back to the project's stored
        // defaults from project.update.
        let params_srx = provided(params.srx_path.as_deref());
        let (segmentation_mode, srx_source) =
            match (provided(params.segmentation.as_deref()), params_srx) {
                (Some(mode), srx) => {
                    let mode = parse_segmentation(mode)?;
                    if mode == ProjectSegmentation::Paragraph && srx.is_some() {
                        return Err(EngineError::InvalidParams(
                            "srxPath only applies to sentence segmentation".to_string(),
                        ));
                    }
                    (to_segmentation_mode(mode), srx.map(str::to_string))
                }
                (None, Some(srx)) => (SegmentationMode::Sentence, Some(srx.to_string())),
                (None, None) => {
                    let default_mode = project
                        .configuration
                        .segmentation
                        .unwrap_or(ProjectSegmentation::Sentence);
                    let default_srx = match default_mode {
                        ProjectSegmentation::Sentence => project.configuration.srx_path.clone(),
                        // A stored srxPath is kept but never applied in
                        // paragraph mode, so it must not fail the import.
                        ProjectSegmentation::Paragraph => None,
                    };
                    (to_segmentation_mode(default_mode), default_srx)
                }
            };

        // Resolve the segmentation ruleset before touching any state so a bad
        // or missing SRX file fails the import cleanly — project.update only
        // stores the path, so this is where a stale default surfaces.
        let srx_rules = match srx_source.as_deref() {
            Some(path) => {
                if !Path::new(path).is_file() {
                    return Err(EngineError::NotFound(format!("SRX ruleset {path}")));
                }
                let xml = std::fs::read_to_string(path)?;
                SrxRules::parse(&xml).map_err(|error| {
                    EngineError::InvalidParams(format!("invalid SRX ruleset {path}: {error}"))
                })?
            }
            None => SrxRules::builtin(&project.source_locale),
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
        };
        // Persist first: if the write fails, memory stays consistent with
        // the database and the import surfaces as an error. Segment rows and
        // their leading text live in SQL only; RAM keeps the metadata record.
        let delta = StateDelta {
            documents: vec![record.clone()],
            segments: prepared.segments,
            segment_leading: prepared.leading,
            ..Default::default()
        };
        self.store.apply(&delta)?;
        self.state.documents.insert(document_id, record);
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
        // Progress is counted in SQL per document (two indexed aggregates
        // each); no segment or QA rows are materialized for the rail.
        let mut progress = Vec::with_capacity(documents.len());
        for document in &documents {
            progress.push(DocumentProgress {
                document_id: document.id.clone(),
                counts: self.store.document_segment_counts(&document.id)?,
            });
        }
        Ok(DocumentListResult {
            documents,
            progress,
        })
    }

    /// Remove one document from its project: the document row, its
    /// segments, and its QA issues go in one SQLite transaction. The
    /// project TM keeps every entry — including ones confirmed from this
    /// document — and termbases/mounts are untouched; removing a bad import
    /// must never cost linguistic assets.
    fn document_remove(
        &mut self,
        params: DocumentRemoveParams,
    ) -> Result<DocumentRemoveResult, EngineError> {
        let record = self.require_document(&params.document_id)?.clone();
        // A running agent still lands drafts on this document's segments;
        // removing it mid-run would fail the run's closing QA pass. Honest
        // Conflict instead, mirroring the run-start rule.
        if let Some(active) = self.agent_runs.values().find(|run| {
            run.view.status == AgentRunStatus::Running && run.view.document_id == record.document.id
        }) {
            return Err(EngineError::Conflict(format!(
                "agent run {} is still running on this document; cancel it or wait",
                active.view.run_id
            )));
        }
        let removed_segments = self.store.document_segment_count(&record.document.id)?;
        let removed_qa_issues = self.store.document_qa_issue_count(&record.document.id)?;
        // Persist first (one transaction; see StateDelta::deleted_documents
        // for the cascade), then drop the RAM record only after the commit.
        self.store.apply(&StateDelta {
            deleted_documents: vec![record.document.id.clone()],
            ..Default::default()
        })?;
        self.state.documents.remove(&record.document.id);
        let managed_copy_deleted = self.remove_managed_document_copy(&record);
        Ok(DocumentRemoveResult {
            document: record.document,
            removed_segments,
            removed_qa_issues,
            managed_copy_deleted,
        })
    }

    /// Best-effort cleanup of the engine's managed copy of a removed
    /// document's source file, after the database transaction committed.
    ///
    /// The honest rule (the mirror of [`Engine::refuse_managed_overwrite`]):
    /// the engine only deletes files inside its own data directory. The
    /// original file at the import path is never touched, and a managed
    /// path that resolves elsewhere — possible for records imported from a
    /// legacy `state.json` — is left alone, because the engine cannot tell
    /// who owns an arbitrary path on disk.
    fn remove_managed_document_copy(&self, record: &DocumentRecord) -> bool {
        let data_dir = self
            .data_dir
            .canonicalize()
            .unwrap_or_else(|_| self.data_dir.clone());
        let managed_source = Path::new(&record.managed_source_path);
        let resolved = managed_source
            .canonicalize()
            .unwrap_or_else(|_| managed_source.to_path_buf());
        if !resolved.starts_with(&data_dir) {
            return false;
        }
        // Imports keep the copy in a per-document directory; remove the
        // whole directory when the copy lives there, otherwise just the file.
        let managed_dir = self.data_dir.join("documents").join(&record.document.id);
        let resolved_dir = managed_dir
            .canonicalize()
            .unwrap_or_else(|_| managed_dir.clone());
        if resolved.starts_with(&resolved_dir) {
            std::fs::remove_dir_all(&managed_dir).is_ok()
        } else {
            std::fs::remove_file(&resolved).is_ok()
        }
    }

    fn document_export(
        &mut self,
        params: DocumentExportParams,
    ) -> Result<DocumentExportResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let output = PathBuf::from(&params.output_path);
        let replace_existing = output.exists();
        if replace_existing {
            if !params.overwrite.unwrap_or(false) {
                return Err(EngineError::ExportBlocked(format!(
                    "output path already exists: {}",
                    output.display()
                )));
            }
            self.refuse_managed_overwrite(&output)?;
        }
        // One document materialized transiently for the outgoing file; the
        // rest of the segments table stays on disk.
        let (segments, leading) = self
            .store
            .document_segments_with_leading(&record.document.id)?;
        // Preview-only anchors: structural path → first grid segment on that
        // path, covering untranslated paths too, so a layout click anywhere
        // jumps to the paragraph's first segment. Off by default: plain user
        // exports stay byte-identical to the pre-anchor pipeline.
        let segment_anchors: BTreeMap<String, String> = if params.segment_anchors.unwrap_or(false) {
            let mut anchors = BTreeMap::new();
            for segment in &segments {
                anchors
                    .entry(segment.structural_path.clone())
                    .or_insert_with(|| segment.id.clone());
            }
            anchors
        } else {
            BTreeMap::new()
        };
        let merged = export::merge_for_export(&segments, &leading);
        let filter = self.registry.resolve(&record.document.filter_id)?;
        let source = PathBuf::from(&record.managed_source_path);
        // Filters only publish no-clobber. A confirmed overwrite exports to a
        // sibling staging file first and renames it over the destination, so
        // a failed export never destroys the file being replaced.
        let staging = replace_existing.then(|| export_staging_path(&output));
        let report = filter
            .export(tl_filter_core::ExportRequest {
                source: &source,
                output: staging.as_deref().unwrap_or(&output),
                segments: &merged,
                segment_anchors,
            })
            .inspect_err(|_| {
                if let Some(staging) = &staging {
                    let _ = std::fs::remove_file(staging);
                }
            })?;
        if let Some(staging) = &staging
            && let Err(error) = std::fs::rename(staging, &output)
        {
            let _ = std::fs::remove_file(staging);
            return Err(error.into());
        }
        Ok(DocumentExportResult {
            output_path: if staging.is_some() {
                output.display().to_string()
            } else {
                report.output_path
            },
            translated_segments: report.translated_segments,
            degradation: report.degradation,
        })
    }

    /// Pages straight from SQL over the `(document_id, ordinal)` index; no
    /// full RAM copy of the segments table backs this anymore. Omitting
    /// `limit` returns the whole document, as before.
    fn segment_list(&self, params: SegmentListParams) -> Result<SegmentListResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        if params.limit == Some(0) {
            return Err(EngineError::InvalidParams(
                "limit must be at least 1".to_string(),
            ));
        }
        let segments = self.store.document_segments_page(
            &record.document.id,
            params.offset.unwrap_or(0),
            params.limit,
        )?;
        let total_segments = self.store.document_segment_count(&record.document.id)?;
        Ok(SegmentListResult {
            segments,
            total_segments,
        })
    }

    fn segment_update(
        &mut self,
        params: SegmentUpdateParams,
    ) -> Result<SegmentUpdateResult, EngineError> {
        let now = now_ms();
        // Fetch-mutate-persist against the row itself; there is no RAM copy.
        let mut segment = self
            .store
            .segment(&params.segment_id)?
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        if segment.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "segment revision moved to {}; refresh before editing",
                segment.revision
            )));
        }
        if segment.locked {
            return Err(EngineError::Conflict(
                "segment is locked; unlock it before editing".to_string(),
            ));
        }
        let target_changed = segment.target_text != params.target_text;
        segment.target_text = params.target_text;
        segment.state = if segment.target_text.trim().is_empty() {
            SegmentState::Untranslated
        } else {
            SegmentState::Draft
        };
        apply_origin_rules(&mut segment, params.origin, target_changed);
        segment.revision += 1;
        segment.updated_at_ms = now;
        self.store.apply(&StateDelta {
            segments: vec![segment.clone()],
            ..Default::default()
        })?;
        Ok(SegmentUpdateResult { segment })
    }

    /// Document-wide search-and-replace over target text, in one SQLite
    /// transaction. Matching is case-insensitive (per-character Unicode
    /// lowercase folding — the grid find box semantics) and non-overlapping;
    /// source text is never touched.
    ///
    /// Honesty rules: rewritten segments become drafts — including formerly
    /// confirmed ones when `includeConfirmed` is set, because the
    /// confirmation covered the old text — and the TM is never written
    /// (replace drafts, it never confirms). Without `includeConfirmed`,
    /// matching confirmed segments are skipped and reported instead of
    /// silently rewritten. Locked segments are always skipped and counted,
    /// even with `includeConfirmed`. A target emptied by the replacement
    /// honestly returns to `untranslated`, mirroring `segment.update`.
    fn segment_replace(
        &mut self,
        params: SegmentReplaceParams,
    ) -> Result<SegmentReplaceResult, EngineError> {
        if params.find.is_empty() {
            return Err(EngineError::InvalidParams(
                "find text must not be empty".to_string(),
            ));
        }
        let record = self.require_document(&params.document_id)?;
        let include_confirmed = params.include_confirmed.unwrap_or(false);
        let rows = self
            .store
            .document_segments_page(&record.document.id, 0, None)?;
        let now = now_ms();
        let mut segments = Vec::new();
        let mut replaced_occurrences = 0u32;
        let mut demoted_confirmed = 0u32;
        let mut skipped_confirmed = 0u32;
        let mut skipped_locked = 0u32;
        for mut segment in rows {
            let Some((target, count)) =
                replace_case_insensitive(&segment.target_text, &params.find, &params.replace_with)
            else {
                continue;
            };
            if segment.locked {
                skipped_locked += 1;
                continue;
            }
            if segment.state == SegmentState::Confirmed {
                if !include_confirmed {
                    skipped_confirmed += 1;
                    continue;
                }
                demoted_confirmed += 1;
            }
            segment.target_text = target;
            segment.state = if segment.target_text.trim().is_empty() {
                SegmentState::Untranslated
            } else {
                SegmentState::Draft
            };
            // A replace rewrote the text without applying stored material:
            // plain-edit origin semantics, same as typing.
            apply_origin_rules(&mut segment, None, true);
            segment.revision += 1;
            segment.updated_at_ms = now;
            replaced_occurrences = replaced_occurrences.saturating_add(count);
            segments.push(segment);
        }
        if !segments.is_empty() {
            self.store.apply(&StateDelta {
                segments: segments.clone(),
                ..Default::default()
            })?;
        }
        Ok(SegmentReplaceResult {
            segments,
            replaced_occurrences,
            demoted_confirmed,
            skipped_confirmed,
            skipped_locked,
        })
    }

    fn segment_confirm(
        &mut self,
        params: SegmentConfirmParams,
    ) -> Result<SegmentConfirmResult, EngineError> {
        let now = now_ms();
        let mut segment = self
            .store
            .segment(&params.segment_id)?
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        if segment.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "segment revision moved to {}; refresh before confirming",
                segment.revision
            )));
        }
        if segment.locked {
            return Err(EngineError::Conflict(
                "segment is locked; unlock it before confirming".to_string(),
            ));
        }
        if segment.target_text.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "cannot confirm a segment without a target".to_string(),
            ));
        }
        segment.state = SegmentState::Confirmed;
        segment.revision += 1;
        segment.updated_at_ms = now;
        let confirmed = segment;

        let project_id = self
            .state
            .documents
            .get(&confirmed.document_id)
            .map(|record| record.document.project_id.clone())
            .ok_or_else(|| {
                EngineError::Internal("confirmed segment has no document".to_string())
            })?;
        let project = self.require_project(&project_id)?.clone();

        // Upsert the project TM entry for this normalized source.
        let memory_id = Self::project_memory_id(&project_id);
        let (tm_entry, _) = self.upsert_tm_entry(
            &mut BTreeMap::new(),
            &memory_id,
            &project_id,
            &confirmed.source_text,
            &confirmed.target_text,
            &confirmed.source_hash,
            &confirmed.document_id,
            &confirmed.id,
            now,
        )?;

        // Propagate to untranslated duplicates across the project as drafts.
        // The source-hash index narrows this to the matching rows; the old
        // code scanned every segment of every document in RAM.
        let mut propagated =
            self.store
                .untranslated_siblings(&project_id, &confirmed.source_hash, &confirmed.id)?;
        // SQL filtered on state; whitespace-only targets are a Rust-side
        // check so the trim semantics stay identical to the editor's.
        propagated.retain(|sibling| sibling.target_text.trim().is_empty());
        for sibling in &mut propagated {
            sibling.target_text = confirmed.target_text.clone();
            sibling.state = SegmentState::Draft;
            // Propagation reuses an exact-source translation: an honest
            // tmExact/100 origin. The confirmed row itself keeps whatever
            // origin it had — confirming never restamps.
            sibling.origin = Some(SegmentOrigin {
                kind: SegmentOriginKind::TmExact,
                score: Some(100),
                model: None,
                edited: false,
            });
            sibling.revision += 1;
            sibling.updated_at_ms = now;
        }
        // Confirm-time QA: re-run the segment-scoped rules against the
        // confirmed text. The changed issue rows join the same transaction
        // as the segment, the TM write, and the propagation — one atomic
        // commit. QA never blocks the confirm: findings become issues, not
        // errors (an Err here is an internal profile bug, not a finding).
        let (changed_issues, qa_issues) = self.refresh_segment_qa(&project, &confirmed)?;
        let mut delta = StateDelta {
            segments: vec![confirmed.clone()],
            tm_entries: vec![tm_entry.clone()],
            qa_issues: changed_issues,
            ..Default::default()
        };
        delta.segments.extend(propagated.iter().cloned());
        self.store.apply(&delta)?;
        Ok(SegmentConfirmResult {
            segment: confirmed,
            tm_entry,
            propagated,
            qa_issues,
        })
    }

    /// `segment.lock`: set or clear the read-only flag. Lock state is
    /// engine-owned and orthogonal to translation state — any state can be
    /// locked. While locked: update and confirm return Conflict; replace,
    /// pretranslate, propagation, and agent drafting skip the row; QA
    /// leaves its issues untouched. The write is idempotent but still bumps
    /// the revision, like every mutation.
    fn segment_lock(&mut self, params: SegmentLockParams) -> Result<SegmentLockResult, EngineError> {
        let now = now_ms();
        let mut segment = self
            .store
            .segment(&params.segment_id)?
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        if segment.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "segment revision moved to {}; refresh before changing the lock",
                segment.revision
            )));
        }
        segment.locked = params.locked;
        segment.revision += 1;
        segment.updated_at_ms = now;
        self.store.apply(&StateDelta {
            segments: vec![segment.clone()],
            ..Default::default()
        })?;
        Ok(SegmentLockResult { segment })
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

    /// Start an assist request: validate on the RPC thread, then hand the
    /// slow provider call to a worker thread. Returns the running view
    /// immediately; clients poll [`Engine::ai_assist_status`] until the run
    /// turns terminal. Assist never writes segments, TM, sign-off, or export.
    fn ai_assist_start(&mut self, params: AiAssistParams) -> Result<AiAssistRunView, EngineError> {
        let segment = self
            .store
            .segment(&params.segment_id)?
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", params.segment_id)))?;
        let record = self.require_document(&segment.document_id)?;
        let project = self.require_project(&record.document.project_id)?.clone();
        if segment.state == SegmentState::Confirmed {
            return Err(EngineError::Conflict(
                "segment is confirmed; AI assist never overwrites confirmed work".to_string(),
            ));
        }
        if segment.locked {
            return Err(EngineError::Conflict(
                "segment is locked; a proposal could never be applied".to_string(),
            ));
        }
        if params.action == AiAssistAction::Refine && segment.target_text.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "cannot refine a segment without a target".to_string(),
            ));
        }
        // Honest degradation: without a provider the request must not start.
        let runtime = self.ai.as_ref().ok_or(EngineError::AiNotConfigured)?;
        // Single flight per segment; a cancel-requested run no longer blocks
        // a retry (its late result is discarded when the event arrives).
        if let Some(active) = self.assist_runs.values().find(|run| {
            run.view.status == AiAssistRunStatus::Running
                && !run.view.cancel_requested
                && run.view.segment_id == params.segment_id
        }) {
            return Err(EngineError::Conflict(format!(
                "assist {} is still running for this segment; cancel it or wait",
                active.view.assist_id
            )));
        }
        let messages = aiops::assist_messages(
            params.action,
            params.instruction.as_deref(),
            &project.source_locale,
            &project.target_locale,
            &segment.source_text,
            &segment.target_text,
        );
        let now = now_ms();
        let view = AiAssistRunView {
            assist_id: new_id(),
            segment_id: segment.id.clone(),
            action: params.action,
            status: AiAssistRunStatus::Running,
            cancel_requested: false,
            result: None,
            error_message: None,
            created_at_ms: now,
            updated_at_ms: now,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        assist::spawn_worker(assist::AssistJob {
            assist_id: view.assist_id.clone(),
            messages,
            source_text: segment.source_text.clone(),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            profile: runtime.profile.clone(),
            credential: runtime.credential.duplicate(),
            cancel: Arc::clone(&cancel),
            events: self.events_tx.clone(),
        });
        self.assist_runs.insert(
            view.assist_id.clone(),
            AssistRunState {
                view: view.clone(),
                source_text: segment.source_text,
                provider: runtime.profile.kind,
                model: runtime.profile.model.clone(),
                cancel,
            },
        );
        self.prune_assist_runs();
        Ok(view)
    }

    fn ai_assist_status(
        &self,
        params: AiAssistStatusParams,
    ) -> Result<AiAssistRunView, EngineError> {
        self.assist_runs
            .get(&params.assist_id)
            .map(|run| run.view.clone())
            .ok_or_else(|| EngineError::NotFound(format!("assist run {}", params.assist_id)))
    }

    fn ai_assist_cancel(
        &mut self,
        params: AiAssistCancelParams,
    ) -> Result<AiAssistRunView, EngineError> {
        let run = self
            .assist_runs
            .get_mut(&params.assist_id)
            .ok_or_else(|| EngineError::NotFound(format!("assist run {}", params.assist_id)))?;
        if run.view.status == AiAssistRunStatus::Running {
            run.cancel.store(true, Ordering::Relaxed);
            run.view.cancel_requested = true;
            run.view.updated_at_ms = now_ms();
        }
        Ok(run.view.clone())
    }

    /// Drop the oldest terminal assist runs beyond the polling grace window
    /// so the map cannot grow without bound. Running requests are never
    /// pruned.
    fn prune_assist_runs(&mut self) {
        let mut terminal: Vec<(i64, String)> = self
            .assist_runs
            .values()
            .filter(|run| run.view.status.is_terminal())
            .map(|run| (run.view.updated_at_ms, run.view.assist_id.clone()))
            .collect();
        if terminal.len() <= ASSIST_TERMINAL_HISTORY {
            return;
        }
        terminal.sort();
        for (_, assist_id) in &terminal[..terminal.len() - ASSIST_TERMINAL_HISTORY] {
            self.assist_runs.remove(assist_id);
        }
    }

    /// Start an agent run: plan, apply exact TM pretranslation inline, then
    /// hand the TM misses to a worker pool for AI drafting. Returns the
    /// task order immediately; heavy provider calls never block the RPC loop.
    ///
    /// Concurrency rules: runs on *different* documents proceed in parallel
    /// (each claims only its own document's segments, so they cannot fight).
    /// A second run on the *same* document is an honest Conflict while the
    /// first is running — its worker may still land drafts there, even after
    /// a cancel was requested, until the terminal event arrives. A global cap
    /// of [`AGENT_MAX_CONCURRENT_RUNS`] bounds worker threads and provider
    /// load.
    fn ai_agent_start(
        &mut self,
        params: AgentStartParams,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> Result<AgentRunView, EngineError> {
        // Honest degradation: without a provider the run must not start.
        let runtime = self.ai.as_ref().ok_or(EngineError::AiNotConfigured)?;
        if let Some(active) = self.agent_runs.values().find(|run| {
            run.view.status == AgentRunStatus::Running && run.view.document_id == params.document_id
        }) {
            return Err(EngineError::Conflict(format!(
                "agent run {} is still running on this document; cancel it or wait",
                active.view.run_id
            )));
        }
        let running = self
            .agent_runs
            .values()
            .filter(|run| run.view.status == AgentRunStatus::Running)
            .count();
        if running >= AGENT_MAX_CONCURRENT_RUNS {
            return Err(EngineError::Conflict(format!(
                "{running} agent runs are already in flight; wait for one to finish or cancel one"
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
        // Only the document's untranslated rows leave SQL, and only up to
        // the planning cap after the whitespace-target filter. Locked rows
        // are never planned: the agent must not claim read-only work.
        let pending: Vec<Segment> = self
            .store
            .untranslated_document_segments(&document_id)?
            .into_iter()
            .filter(|segment| segment.target_text.trim().is_empty() && !segment.locked)
            .take(max_segments)
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
        // Exact hits are point queries on the unique (memory, hash) index.
        let mut misses: Vec<agent::AgentWorkItem> = Vec::new();
        let mut tm_applied_segments: Vec<Segment> = Vec::new();
        for mut segment in pending {
            let tm_hit = self
                .store
                .tm_entry_by_source(&memory_id, &segment.source_hash)?
                .map(|entry| entry.target_text);
            match tm_hit {
                Some(target) if !target.trim().is_empty() => {
                    let segment_id = segment.id.clone();
                    segment.target_text = target;
                    segment.state = SegmentState::Draft;
                    // Point query on the unique (memory, hash) index: an
                    // exact reuse by construction.
                    segment.origin = Some(SegmentOrigin {
                        kind: SegmentOriginKind::TmExact,
                        score: Some(100),
                        model: None,
                        edited: false,
                    });
                    segment.revision += 1;
                    segment.updated_at_ms = now;
                    tm_applied_segments.push(segment);
                    view.tm_applied += 1;
                    push_agent_step(
                        &mut view,
                        notify,
                        AgentStepKind::Tm,
                        AgentStepStatus::Done,
                        Some(segment_id),
                        "复用精确 TM 匹配，落为草稿".to_string(),
                    );
                }
                _ => misses.push(agent::AgentWorkItem {
                    segment_id: segment.id.clone(),
                    source_text: segment.source_text.clone(),
                }),
            }
        }
        if !tm_applied_segments.is_empty() {
            self.store.apply(&StateDelta {
                segments: tm_applied_segments,
                ..Default::default()
            })?;
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
            events: self.events_tx.clone(),
        });
        let run_id = view.run_id.clone();
        self.agent_runs.insert(
            run_id,
            AgentRunState {
                view: view.clone(),
                cancel,
            },
        );
        self.prune_agent_runs();
        Ok(view)
    }

    /// Drop the oldest terminal agent runs beyond the polling grace window
    /// so the map cannot grow without bound now that runs are concurrent.
    /// Running runs are never pruned.
    fn prune_agent_runs(&mut self) {
        let mut terminal: Vec<(i64, String)> = self
            .agent_runs
            .values()
            .filter(|run| run.view.status.is_terminal())
            .map(|run| (run.view.updated_at_ms, run.view.run_id.clone()))
            .collect();
        if terminal.len() <= AGENT_TERMINAL_HISTORY {
            return;
        }
        terminal.sort();
        for (_, run_id) in &terminal[..terminal.len() - AGENT_TERMINAL_HISTORY] {
            self.agent_runs.remove(run_id);
        }
    }

    fn ai_agent_status(&self, params: AgentStatusParams) -> Result<AgentRunView, EngineError> {
        self.agent_runs
            .get(&params.run_id)
            .map(|run| run.view.clone())
            .ok_or_else(|| EngineError::NotFound(format!("agent run {}", params.run_id)))
    }

    /// Request cancellation of a running agent run. The flag aborts each
    /// worker's in-flight HTTP call within the tl-ai cancel poll interval;
    /// the run turns `canceled` once every worker has stopped and the
    /// terminal event arrives. Drafts already applied stay in the grid.
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
    pub fn handle_engine_event(
        &mut self,
        event: EngineEvent,
        notify: &mut dyn FnMut(RpcNotification),
    ) -> Result<(), EngineError> {
        match event {
            EngineEvent::AgentDrafted {
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
                        // Fetch the live row: a human may have edited or
                        // locked it while the provider call was in flight.
                        let stored = self.store.segment(&segment_id)?;
                        let still_pending = stored.as_ref().is_some_and(|segment| {
                            segment.state == SegmentState::Untranslated
                                && segment.target_text.trim().is_empty()
                                && !segment.locked
                        });
                        let Some(mut stored) = stored.filter(|_| still_pending) else {
                            push_agent_step(
                                &mut run.view,
                                notify,
                                AgentStepKind::Translate,
                                AgentStepStatus::Skipped,
                                Some(segment_id),
                                "句段在运行期间被人工修改或锁定，保留人工状态".to_string(),
                            );
                            return Ok(());
                        };
                        let integrity = check_tag_integrity(&stored.source_text, &draft.target);
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
                        stored.target_text = draft.target;
                        stored.state = SegmentState::Draft;
                        stored.origin = Some(SegmentOrigin {
                            kind: SegmentOriginKind::AiDraft,
                            score: None,
                            model: Some(draft.model.clone()),
                            edited: false,
                        });
                        stored.revision += 1;
                        stored.updated_at_ms = now;
                        run.view.ai_drafted += 1;
                        push_agent_step(
                            &mut run.view,
                            notify,
                            AgentStepKind::Translate,
                            AgentStepStatus::Done,
                            Some(segment_id),
                            format!("AI 草稿（{}，{} ms）", draft.model, draft.elapsed_ms),
                        );
                        self.store.apply(&StateDelta {
                            segments: vec![stored],
                            ..Default::default()
                        })?;
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
            EngineEvent::AgentFinished { run_id } => {
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
                                "QA 检查 {} 个句段，{} 个未解决问题",
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
            EngineEvent::AgentCanceled { run_id } => {
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
            EngineEvent::AssistFinished { assist_id, outcome } => {
                let Some(run) = self.assist_runs.get_mut(&assist_id) else {
                    return Ok(());
                };
                if run.view.status != AiAssistRunStatus::Running {
                    return Ok(());
                }
                run.view.updated_at_ms = now_ms();
                // A cancel that lost the race to the completion still wins:
                // the client asked to discard, so no result is surfaced.
                if run.view.cancel_requested {
                    run.view.status = AiAssistRunStatus::Canceled;
                    return Ok(());
                }
                match outcome {
                    Ok(completion) => {
                        let tag_check = check_tag_integrity(&run.source_text, &completion.text);
                        run.view.result = Some(AiAssistResult {
                            draft_target: completion.text,
                            provider: run.provider,
                            model: run.model.clone(),
                            elapsed_ms: completion.elapsed_ms,
                            tag_check,
                        });
                        run.view.status = AiAssistRunStatus::Done;
                    }
                    Err(message) => {
                        run.view.error_message = Some(format!("AI call failed: {message}"));
                        run.view.status = AiAssistRunStatus::Failed;
                    }
                }
                Ok(())
            }
        }
    }
}

/// Origin rules shared by every target-text write (`segment.update`,
/// `segment.replace`). Call after the new target and state are set:
///
/// - an empty target (untranslated) has no origin — clear it;
/// - a write carrying a stamp records it with `edited: false` (`edited` is
///   engine-owned; whatever a client sent is ignored);
/// - a plain write that changes the target of a stamped row marks the
///   stamp `edited` — the Studio-style pollution signal — keeping the
///   kind, score, and model;
/// - a plain write on an origin-less row leaves it origin-less (human
///   authorship is the absent default, never fabricated).
fn apply_origin_rules(segment: &mut Segment, stamp: Option<SegmentOrigin>, target_changed: bool) {
    if segment.state == SegmentState::Untranslated {
        segment.origin = None;
        return;
    }
    if let Some(stamp) = stamp {
        segment.origin = Some(SegmentOrigin {
            edited: false,
            ..stamp
        });
        return;
    }
    if target_changed && let Some(origin) = segment.origin.as_mut() {
        origin.edited = true;
    }
}

/// Case-insensitive, non-overlapping search-and-replace. Folds one
/// character at a time through [`char::to_lowercase`], so it matches the
/// renderer find box (`toLowerCase().includes(...)`) for practical inputs;
/// a haystack character whose folding straddles the needle boundary is
/// honestly treated as a non-match rather than half-replaced. Returns the
/// rewritten string and the occurrence count, or `None` when the needle
/// does not occur (or is empty).
fn replace_case_insensitive(
    haystack: &str,
    needle: &str,
    replacement: &str,
) -> Option<(String, u32)> {
    if needle.is_empty() {
        return None;
    }
    let needle_folded: Vec<char> = needle.chars().flat_map(char::to_lowercase).collect();
    let haystack_chars: Vec<char> = haystack.chars().collect();
    let mut result = String::with_capacity(haystack.len());
    let mut count = 0u32;
    let mut index = 0usize;
    while index < haystack_chars.len() {
        if let Some(end) = fold_match_at(&haystack_chars, index, &needle_folded) {
            result.push_str(replacement);
            count += 1;
            index = end;
        } else {
            result.push(haystack_chars[index]);
            index += 1;
        }
    }
    if count == 0 {
        None
    } else {
        Some((result, count))
    }
}

/// When the haystack characters starting at `start` fold to exactly the
/// (already folded) needle characters, returns the haystack index one past
/// the match.
fn fold_match_at(haystack: &[char], start: usize, needle_folded: &[char]) -> Option<usize> {
    let mut needle_position = 0usize;
    let mut index = start;
    while needle_position < needle_folded.len() {
        let character = *haystack.get(index)?;
        for folded in character.to_lowercase() {
            if needle_folded.get(needle_position) != Some(&folded) {
                return None;
            }
            needle_position += 1;
        }
        index += 1;
    }
    Some(index)
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

#[cfg(test)]
mod tests {
    use super::replace_case_insensitive;

    #[test]
    fn replaces_case_insensitively_and_counts_occurrences() {
        assert_eq!(
            replace_case_insensitive("Server error: SERVER down", "server", "服务器"),
            Some(("服务器 error: 服务器 down".to_string(), 2))
        );
        assert_eq!(
            replace_case_insensitive("保留期为 30 天。", "30 天", "60 天"),
            Some(("保留期为 60 天。".to_string(), 1))
        );
    }

    #[test]
    fn returns_none_without_a_match_or_with_an_empty_needle() {
        assert_eq!(replace_case_insensitive("nothing here", "miss", "x"), None);
        assert_eq!(replace_case_insensitive("text", "", "x"), None);
    }

    #[test]
    fn replacements_never_rematch_and_empty_replacement_deletes() {
        // The replacement text contains the needle; occurrences must not
        // cascade into an infinite or double replacement.
        assert_eq!(
            replace_case_insensitive("aba", "a", "aa"),
            Some(("aabaa".to_string(), 2))
        );
        assert_eq!(
            replace_case_insensitive("well, well", "well", ""),
            Some((", ".to_string(), 2))
        );
    }

    #[test]
    fn folds_non_ascii_case_pairs() {
        assert_eq!(
            replace_case_insensitive("СЕРВЕР готов", "сервер", "server"),
            Some(("server готов".to_string(), 1))
        );
    }
}
