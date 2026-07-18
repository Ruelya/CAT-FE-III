use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use translunar_domain::{Document, Project, Segment};
use translunar_filter_docx::{DocxError, DocxFilter};
use translunar_protocol::methods;
use translunar_protocol::{
    ConfirmSegmentParams, ConfirmSegmentResult, CreateProjectParams, DocumentIdParams, ErrorCode,
    ExactLookupParams, ExactLookupResult, ExportDocxParams, ExportDocxResult, ImportDocxParams,
    InitializeParams, InitializeResult, ListQaParams, PROTOCOL_VERSION, ProjectIdParams,
    ProjectSnapshot, QaListResult, RpcError, RpcRequest, RpcResponse, SegmentListParams,
    SegmentPage, UpdateTargetParams,
};
use translunar_storage::{NewDocument, StorageError, Store};

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Storage(#[from] StorageError),

    #[error("document import failed: {0}")]
    Import(#[source] DocxError),

    #[error("document export failed: {0}")]
    Export(#[source] DocxError),

    #[error("engine I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("invalid engine state: {0}")]
    InvalidState(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;

pub struct EngineService {
    store: Store,
    docx: DocxFilter,
}

impl EngineService {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            store: Store::open(data_dir)?,
            docx: DocxFilter,
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

    pub fn import_docx(&mut self, params: ImportDocxParams) -> Result<Document> {
        self.store.get_project(&params.project_id)?;
        let source_path = PathBuf::from(&params.source_path);
        let name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                EngineError::InvalidRequest("sourcePath must name a DOCX file".to_string())
            })?
            .to_string();
        if !source_path.is_file() {
            return Err(EngineError::InvalidRequest(format!(
                "source DOCX does not exist: {}",
                source_path.display()
            )));
        }

        let document_id = translunar_domain::new_id();
        let managed_source_path = self.store.paths().managed_docx(&document_id);
        let mut temporary = NamedTempFile::new_in(&self.store.paths().temporary)?;
        let source_sha256 = copy_and_hash(&source_path, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        let units = self
            .docx
            .extract_units(temporary.path())
            .map_err(EngineError::Import)?;
        if units.is_empty() {
            return Err(EngineError::Import(DocxError::InvalidPackage(
                "DOCX contains no translatable body paragraphs".to_string(),
            )));
        }
        temporary
            .persist_noclobber(&managed_source_path)
            .map_err(|error| EngineError::Io(error.error))?;

        let input = NewDocument {
            id: document_id,
            project_id: params.project_id,
            name,
            format: "docx".to_string(),
            source_sha256,
            original_source_path: source_path,
            managed_source_path: managed_source_path.clone(),
        };
        match self.store.insert_document(&input, &units) {
            Ok(document) => Ok(document),
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
        let document = self.store.get_document(&params.document_id)?;
        let segments = self.store.all_segments(&params.document_id)?;
        let output_path = PathBuf::from(&params.output_path);
        let summary = self
            .docx
            .export(&document.managed_source_path, &output_path, &segments)
            .map_err(EngineError::Export)?;
        Ok(ExportDocxResult {
            output_path: output_path.to_string_lossy().into_owned(),
            translated_segments: summary.translated_segments,
        })
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
        EngineError::Storage(StorageError::InvalidState(message))
        | EngineError::InvalidState(message) => RpcError {
            code: ErrorCode::InvalidState,
            message,
            data: None,
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
    }
}
