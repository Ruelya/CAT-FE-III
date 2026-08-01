//! Loopback HTTP adapter over EngineService.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use translunar_filter_core::FilterError;
use translunar_protocol::{
    CreateProjectParams, DocumentListParams, EmptyParams, ExportDocumentParams,
    ImportDocumentParams, ProjectListParams, QaOverrideInput, TermbaseListParams,
    TmLibraryListParams,
};
use translunar_storage::StorageError;

use crate::local_auth::{LocalApiTokenStore, authorize};
use crate::{EngineError, EngineService, Result};

#[derive(Debug, Clone)]
pub struct LocalApiConfig {
    pub host: IpAddr,
    pub port: u16,
    pub allow_remote: bool,
}

impl Default for LocalApiConfig {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 7431,
            allow_remote: false,
        }
    }
}

pub fn validate_bind(config: &LocalApiConfig) -> Result<()> {
    if config.allow_remote {
        return Ok(());
    }
    match config.host {
        IpAddr::V4(addr) if addr.is_loopback() => Ok(()),
        IpAddr::V6(addr) if addr.is_loopback() => Ok(()),
        other => Err(EngineError::InvalidRequest(format!(
            "refusing non-loopback bind {other}; pass --allow-remote to override"
        ))),
    }
}

pub fn serve(
    service: Arc<Mutex<EngineService>>,
    tokens: Arc<dyn LocalApiTokenStore>,
    config: LocalApiConfig,
) -> Result<()> {
    validate_bind(&config)?;
    let addr = SocketAddr::new(config.host, config.port);
    let listener = TcpListener::bind(addr).map_err(EngineError::Io)?;
    listener.set_nonblocking(false).map_err(EngineError::Io)?;
    for connection in listener.incoming() {
        let mut stream = match connection {
            Ok(stream) => stream,
            Err(error) => {
                tracing::warn!(%error, "local API accept failed");
                continue;
            }
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
        let _ = dispatch_connection(&mut stream, &service, tokens.as_ref());
    }
    Ok(())
}

fn dispatch_connection(
    stream: &mut TcpStream,
    service: &Arc<Mutex<EngineService>>,
    tokens: &dyn LocalApiTokenStore,
) -> Result<()> {
    match handle_connection(stream, service, tokens) {
        Ok(()) => Ok(()),
        Err(error) => write_json(
            stream,
            status_for_error(&error),
            json!({
                "error": {
                    "code": error_code(&error),
                    "message": error.to_string(),
                }
            }),
        ),
    }
}

fn handle_connection(
    stream: &mut TcpStream,
    service: &Arc<Mutex<EngineService>>,
    tokens: &dyn LocalApiTokenStore,
) -> Result<()> {
    let request = read_http_request(stream)?;
    let path = request.path.as_str();
    let method = request.method.as_str();

    if method == "GET" && path == "/health" {
        return write_json(
            stream,
            200,
            json!({ "ok": true, "service": "translunar-local-api", "version": env!("CARGO_PKG_VERSION") }),
        );
    }

    authorize(tokens, request.header("authorization"))?;

    let body = request.body_json()?;
    let mut engine = service
        .lock()
        .map_err(|_| EngineError::InvalidState("engine lock poisoned".into()))?;

    let response = match (method, path) {
        ("GET", "/v1/capabilities") => json!({
            "protocolVersion": 1,
            "capabilities": [
                "local-api.v1",
                "project",
                "document.import-export",
                "qa.document",
                "assets.list"
            ]
        }),
        ("GET", "/v1/projects") => {
            let params: ProjectListParams = match decode_params(body.clone()) {
                Ok(params) => params,
                Err(_) => ProjectListParams {
                    lifecycle: None,
                    offset: 0,
                    limit: 50,
                },
            };
            serde_json::to_value(engine.list_projects(params)?)?
        }
        ("POST", "/v1/projects") => {
            let params: CreateProjectParams = decode_params(body)?;
            serde_json::to_value(engine.create_project(params)?)?
        }
        ("GET", path) if path.starts_with("/v1/projects/") && path.ends_with("/documents") => {
            let project_id = path
                .trim_start_matches("/v1/projects/")
                .trim_end_matches("/documents")
                .trim_matches('/');
            let params = DocumentListParams {
                project_id: project_id.to_string(),
                offset: query_u32(&request, "offset").unwrap_or(0),
                limit: query_u32(&request, "limit").unwrap_or(50),
            };
            serde_json::to_value(engine.list_documents(params)?)?
        }
        ("GET", path) if path.starts_with("/v1/projects/") => {
            let project_id = path.trim_start_matches("/v1/projects/").trim_matches('/');
            serde_json::to_value(engine.get_project(project_id)?)?
        }
        ("POST", path) if path.starts_with("/v1/projects/") && path.ends_with("/import") => {
            let project_id = path
                .trim_start_matches("/v1/projects/")
                .trim_end_matches("/import")
                .trim_matches('/');
            let mut params: ImportDocumentParams = decode_params(body)?;
            params.project_id = project_id.to_string();
            serde_json::to_value(engine.import_document(params)?)?
        }
        ("POST", path) if path.starts_with("/v1/documents/") && path.ends_with("/export") => {
            let document_id = path
                .trim_start_matches("/v1/documents/")
                .trim_end_matches("/export")
                .trim_matches('/');
            let mut params: ExportDocumentParams = decode_params(body)?;
            params.document_id = document_id.to_string();
            serde_json::to_value(engine.export_document(params)?)?
        }
        ("POST", path) if path.starts_with("/v1/documents/") && path.ends_with("/qa") => {
            let document_id = path
                .trim_start_matches("/v1/documents/")
                .trim_end_matches("/qa")
                .trim_matches('/');
            serde_json::to_value(engine.run_document_qa(document_id)?)?
        }
        ("GET", "/v1/filters") => serde_json::to_value(engine.list_filters(EmptyParams {}))?,
        ("GET", "/v1/tm/libraries") => {
            let params = TmLibraryListParams {
                project_id: query_string(&request, "projectId"),
                offset: query_u32(&request, "offset").unwrap_or(0),
                limit: query_u32(&request, "limit").unwrap_or(50),
            };
            serde_json::to_value(engine.list_tm_libraries(params)?)?
        }
        ("GET", "/v1/termbases") => {
            let project_id = query_string(&request, "projectId").ok_or_else(|| {
                EngineError::InvalidRequest("projectId query parameter is required".into())
            })?;
            let params = TermbaseListParams {
                project_id,
                offset: query_u32(&request, "offset").unwrap_or(0),
                limit: query_u32(&request, "limit").unwrap_or(50),
            };
            serde_json::to_value(engine.list_termbases(params)?)?
        }
        _ => {
            return write_json(
                stream,
                404,
                json!({ "error": { "code": "not_found", "message": "route not found" } }),
            );
        }
    };

    write_json(stream, 200, response)
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    raw_path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    fn body_json(&self) -> Result<Value> {
        if self.body.is_empty() {
            return Ok(json!({}));
        }
        serde_json::from_slice(&self.body)
            .map_err(|error| EngineError::InvalidRequest(format!("invalid JSON body: {error}")))
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = stream.read(&mut chunk).map_err(EngineError::Io)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 1024 * 1024 {
            return Err(EngineError::InvalidRequest(
                "HTTP header exceeds 1 MiB".into(),
            ));
        }
    }
    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| EngineError::InvalidRequest("incomplete HTTP request".into()))?;
    let header_bytes = &buffer[..header_end];
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|_| EngineError::InvalidRequest("HTTP headers must be UTF-8".into()))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| EngineError::InvalidRequest("missing request line".into()))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| EngineError::InvalidRequest("missing method".into()))?
        .to_string();
    let raw_path = parts
        .next()
        .ok_or_else(|| EngineError::InvalidRequest("missing path".into()))?
        .to_string();
    let path = raw_path
        .split('?')
        .next()
        .unwrap_or(raw_path.as_str())
        .to_string();
    let mut headers = Vec::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }
    let content_length = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > 16 * 1024 * 1024 {
        return Err(EngineError::InvalidRequest(
            "request body exceeds 16 MiB".into(),
        ));
    }
    let mut body = buffer[header_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).map_err(EngineError::Io)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);
    Ok(HttpRequest {
        method,
        path,
        raw_path,
        headers,
        body,
    })
}

fn write_json(stream: &mut TcpStream, status: u16, body: Value) -> Result<()> {
    let payload = serde_json::to_vec_pretty(&body)?;
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(header.as_bytes())
        .map_err(EngineError::Io)?;
    stream.write_all(&payload).map_err(EngineError::Io)?;
    stream.flush().map_err(EngineError::Io)?;
    Ok(())
}

fn query_string(request: &HttpRequest, key: &str) -> Option<String> {
    let query = request.raw_path.split_once('?')?.1;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=')?;
        if name == key {
            return Some(value.to_string());
        }
    }
    None
}

fn query_u32(request: &HttpRequest, key: &str) -> Option<u32> {
    query_string(request, key)?.parse().ok()
}

/// Decode a typed request body. Structural JSON mistakes become `invalid_request` (400),
/// never `EngineError::Json` / HTTP 500.
fn decode_params<T: DeserializeOwned>(body: Value) -> Result<T> {
    serde_json::from_value(body).map_err(|error| {
        EngineError::InvalidRequest(format!("invalid request body: {error}"))
    })
}

/// HTTP status for Engine failures, aligned with the protocol/RPC taxonomy.
fn status_for_error(error: &EngineError) -> u16 {
    match error_code(error) {
        "unauthorized" => 401,
        "not_found" => 404,
        "conflict" | "qa_gate_blocked" => 409,
        "invalid_request"
        | "unsupported_document"
        | "unsupported_corpus_input"
        | "export_error"
        | "invalid_state"
        | "policy_denied" => 400,
        "credential_unavailable" => 503,
        // storage_error, plugin/AI faults, and true internal errors
        _ => 500,
    }
}

/// Stable error codes aligned with `engine_error_code` / RPC for automation clients.
fn error_code(error: &EngineError) -> &'static str {
    match error {
        EngineError::InvalidRequest(message)
            if message.contains("bearer") || message.contains("token") =>
        {
            "unauthorized"
        }
        EngineError::InvalidRequest(_) | EngineError::Json(_) => "invalid_request",
        EngineError::Storage(StorageError::NotFound { .. })
        | EngineError::Import(FilterError::NotFound(_))
        | EngineError::Export(FilterError::NotFound(_))
        | EngineError::CorpusImport(FilterError::NotFound(_)) => "not_found",
        EngineError::Storage(StorageError::EntityConflict { .. })
        | EngineError::Storage(StorageError::Conflict { .. })
        | EngineError::Storage(StorageError::LockHeld { .. }) => "conflict",
        EngineError::QaGateBlocked { .. } => "qa_gate_blocked",
        EngineError::Import(_) => "unsupported_document",
        EngineError::Export(_)
        | EngineError::TaskPackageExport(_)
        | EngineError::CurationExport(_)
        | EngineError::ReportExport(_) => "export_error",
        EngineError::CorpusImport(_) | EngineError::CorpusInput(_) => "unsupported_corpus_input",
        EngineError::Io(_) | EngineError::Storage(_) => "storage_error",
        EngineError::InvalidState(_) => "invalid_state",
        EngineError::PolicyDenied { .. } => "policy_denied",
        EngineError::CredentialUnavailable(_) => "credential_unavailable",
        EngineError::PluginPermissionDenied(_) | EngineError::PluginCapabilityDenied(_) => {
            "plugin_permission_denied"
        }
        EngineError::PluginProcessFailed(_) => "plugin_process_failed",
        EngineError::PluginSandboxFailed(_) | EngineError::PluginAiActionFailed { .. } => {
            "plugin_sandbox_failed"
        }
        _ => "internal_error",
    }
}

/// One-shot helper used by CLI `run` and tests without starting a server.
pub fn run_pipeline(
    service: &mut EngineService,
    source: PathBuf,
    output: PathBuf,
    project_name: &str,
) -> Result<Value> {
    run_pipeline_with_project(service, source, output, project_name, None)
}

/// Same as [`run_pipeline`], optionally reusing an existing project id.
pub fn run_pipeline_with_project(
    service: &mut EngineService,
    source: PathBuf,
    output: PathBuf,
    project_name: &str,
    project_id: Option<&str>,
) -> Result<Value> {
    let project_id = if let Some(existing) = project_id {
        let snapshot = service.get_project(existing)?;
        snapshot.project.id
    } else {
        service
            .create_project(CreateProjectParams {
                name: project_name.to_string(),
                source_locale: "en-US".into(),
                target_locale: "zh-CN".into(),
                domain: "general".into(),
            })?
            .id
    };
    let imported = service.import_document(ImportDocumentParams {
        project_id: project_id.clone(),
        source_path: source.to_string_lossy().into_owned(),
        relative_path: None,
        filter_id: None,
        options: Default::default(),
    })?;
    let qa = service.run_document_qa(&imported.document.id)?;
    let exported = match service.export_document(ExportDocumentParams {
        document_id: imported.document.id.clone(),
        output_path: output.to_string_lossy().into_owned(),
        qa_override: None,
    }) {
        Ok(result) => result,
        Err(EngineError::QaGateBlocked { .. }) => service.export_document(ExportDocumentParams {
            document_id: imported.document.id.clone(),
            output_path: output.to_string_lossy().into_owned(),
            qa_override: Some(QaOverrideInput {
                actor: "cli".into(),
                reason: "CLI/API automation export with open QA findings".into(),
            }),
        })?,
        Err(error) => return Err(error),
    };
    Ok(json!({
        "projectId": project_id,
        "documentId": imported.document.id,
        "filterId": imported.filter_id,
        "segmentCount": imported.document.segment_count,
        "qaIssueCount": qa.issues.len(),
        "export": exported,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_auth::{MemoryTokenStore, ensure_token};
    use std::io::Write;
    use std::net::TcpStream;
    use std::thread;
    use std::time::Duration;
    use tempfile::tempdir;

    fn exchange(addr: SocketAddr, request: &str) -> String {
        let mut stream = TcpStream::connect(addr).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut body = String::new();
        stream.read_to_string(&mut body).unwrap();
        body
    }

    fn spawn_server(
        service: Arc<Mutex<EngineService>>,
        tokens: Arc<dyn LocalApiTokenStore>,
        connections: usize,
    ) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for _ in 0..connections {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let _ = dispatch_connection(&mut stream, &service, tokens.as_ref());
            }
        });
        // Brief yield so the accept thread is ready on slow CI.
        thread::sleep(Duration::from_millis(20));
        addr
    }

    fn json_body(response: &str) -> Value {
        let body = response
            .split("\r\n\r\n")
            .nth(1)
            .expect("response body missing");
        serde_json::from_str(body).expect("json body")
    }

    #[test]
    fn rejects_non_loopback_without_opt_in() {
        let error = validate_bind(&LocalApiConfig {
            host: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
            port: 9,
            allow_remote: false,
        })
        .unwrap_err();
        assert!(error.to_string().contains("non-loopback"));
    }

    #[test]
    fn local_api_requires_token_and_imports_fixture() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("sample.txt");
        std::fs::write(&source, "Hello local API.\n\nSecond paragraph.\n").unwrap();
        let service = Arc::new(Mutex::new(
            EngineService::open(directory.path().join("data")).unwrap(),
        ));
        let tokens: Arc<dyn LocalApiTokenStore> = Arc::new(MemoryTokenStore::default());
        let token = ensure_token(tokens.as_ref()).unwrap();
        let addr = spawn_server(Arc::clone(&service), Arc::clone(&tokens), 8);

        let health = exchange(
            addr,
            "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        );
        assert!(health.contains("200"));
        assert!(health.contains("translunar-local-api"));

        let unauthorized = exchange(
            addr,
            "GET /v1/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        );
        assert!(unauthorized.contains("401") || unauthorized.contains("unauthorized"));

        let bad_token = exchange(
            addr,
            "GET /v1/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer not-the-token\r\nConnection: close\r\n\r\n",
        );
        assert!(bad_token.contains("401") || bad_token.contains("invalid"));

        let create_body = r#"{"name":"API HTTP project","sourceLocale":"en-US","targetLocale":"zh-CN","domain":"general"}"#;
        let create = exchange(
            addr,
            &format!(
                "POST /v1/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{create_body}",
                create_body.len()
            ),
        );
        assert!(create.starts_with("HTTP/1.1 200") || create.contains("200 OK"));
        let project = json_body(&create);
        let project_id = project["id"].as_str().expect("project id");

        let source_path = source.to_string_lossy().replace('\\', "\\\\");
        let import_body = format!(
            r#"{{"projectId":"{project_id}","sourcePath":"{source_path}"}}"#
        );
        let import = exchange(
            addr,
            &format!(
                "POST /v1/projects/{project_id}/import HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{import_body}",
                import_body.len()
            ),
        );
        assert!(import.contains("200"));
        let imported = json_body(&import);
        let document_id = imported["document"]["id"]
            .as_str()
            .expect("document id");
        assert!(
            imported["document"]["segmentCount"]
                .as_u64()
                .unwrap_or(0)
                >= 1
        );

        let documents = exchange(
            addr,
            &format!(
                "GET /v1/projects/{project_id}/documents HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
            ),
        );
        assert!(documents.contains("200"));
        assert!(json_body(&documents)["total"].as_u64().unwrap_or(0) >= 1);

        let qa = exchange(
            addr,
            &format!(
                "POST /v1/documents/{document_id}/qa HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            ),
        );
        assert!(qa.contains("200"));
        assert!(json_body(&qa).get("issues").is_some());

        let output = directory.path().join("http-out.txt");
        let output_path = output.to_string_lossy().replace('\\', "\\\\");
        let export_body = format!(
            r#"{{"documentId":"{document_id}","outputPath":"{output_path}","qaOverride":{{"actor":"test","reason":"local api unit export"}}}}"#
        );
        let export = exchange(
            addr,
            &format!(
                "POST /v1/documents/{document_id}/export HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{export_body}",
                export_body.len()
            ),
        );
        assert!(export.contains("200"), "export response: {export}");
        assert!(output.is_file());

        // CLI helper path remains covered for durable rows without HTTP.
        let mut engine = service.lock().unwrap();
        let cli_output = directory.path().join("cli-out.txt");
        let summary = run_pipeline(
            &mut engine,
            source,
            cli_output.clone(),
            "API CLI helper",
        )
        .unwrap();
        assert!(cli_output.is_file());
        assert!(summary["segmentCount"].as_u64().unwrap() >= 1);
        assert!(!summary["projectId"].as_str().unwrap().is_empty());
    }

    #[test]
    fn run_pipeline_reuses_existing_project() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("sample.txt");
        std::fs::write(&source, "Reuse project flow.\n").unwrap();
        let mut service = EngineService::open(directory.path().join("data")).unwrap();
        let project = service
            .create_project(CreateProjectParams {
                name: "Reuse me".into(),
                source_locale: "en-US".into(),
                target_locale: "zh-CN".into(),
                domain: "general".into(),
            })
            .unwrap();
        let output = directory.path().join("reuse-out.txt");
        let summary = run_pipeline_with_project(
            &mut service,
            source,
            output.clone(),
            "ignored name",
            Some(project.id.as_str()),
        )
        .unwrap();
        assert_eq!(summary["projectId"], project.id);
        assert!(output.is_file());
    }

    #[test]
    fn http_error_taxonomy_client_failures_are_not_internal_error() {
        let directory = tempdir().unwrap();
        let service = Arc::new(Mutex::new(
            EngineService::open(directory.path().join("data")).unwrap(),
        ));
        let tokens: Arc<dyn LocalApiTokenStore> = Arc::new(MemoryTokenStore::default());
        let token = ensure_token(tokens.as_ref()).unwrap();
        let addr = spawn_server(Arc::clone(&service), Arc::clone(&tokens), 4);

        // 1) Typed body with missing/wrong fields → 400 / invalid_request (not Json/500).
        let bad_create = r#"{"name":1}"#;
        let malformed = exchange(
            addr,
            &format!(
                "POST /v1/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{bad_create}",
                bad_create.len()
            ),
        );
        assert!(
            malformed.contains("400"),
            "malformed DTO must be 400, got: {malformed}"
        );
        let malformed_body = json_body(&malformed);
        assert_eq!(
            malformed_body["error"]["code"], "invalid_request",
            "malformed DTO code: {malformed_body}"
        );

        // Create a real project for import/export failure paths.
        let create_body = r#"{"name":"Error taxonomy","sourceLocale":"en-US","targetLocale":"zh-CN","domain":"general"}"#;
        let create = exchange(
            addr,
            &format!(
                "POST /v1/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{create_body}",
                create_body.len()
            ),
        );
        assert!(create.contains("200"), "create project: {create}");
        let project_id = json_body(&create)["id"].as_str().expect("project id").to_string();

        // 2) Unsupported / unmatchable document → protocol import code, not internal_error.
        let junk = directory.path().join("no-filter.unknownext");
        std::fs::write(&junk, b"\0\0\0not a document").unwrap();
        let junk_path = junk.to_string_lossy().replace('\\', "\\\\");
        let import_body = format!(r#"{{"projectId":"{project_id}","sourcePath":"{junk_path}"}}"#);
        let import = exchange(
            addr,
            &format!(
                "POST /v1/projects/{project_id}/import HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{import_body}",
                import_body.len()
            ),
        );
        let import_body_json = json_body(&import);
        let import_code = import_body_json["error"]["code"]
            .as_str()
            .unwrap_or_default();
        assert_ne!(
            import_code, "internal_error",
            "import failure must not collapse to internal_error: {import}"
        );
        assert!(
            import_code == "unsupported_document"
                || import_code == "invalid_request"
                || import_code == "not_found",
            "import failure should map to import/client taxonomy, got {import_code}: {import}"
        );
        assert!(
            !import.contains("500") || import_code != "internal_error",
            "import failure status should not look like a server fault: {import}"
        );
        assert!(
            import.contains("400") || import.contains("404"),
            "import client failure status expected 400/404: {import}"
        );

        // 3) Export of unknown document → not_found (not internal_error / 500).
        let export_body = r#"{"documentId":"missing-doc","outputPath":"/tmp/out.txt"}"#;
        let export = exchange(
            addr,
            &format!(
                "POST /v1/documents/missing-doc/export HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{export_body}",
                export_body.len()
            ),
        );
        assert!(
            export.contains("404"),
            "missing document export must be 404: {export}"
        );
        let export_body_json = json_body(&export);
        assert_eq!(
            export_body_json["error"]["code"], "not_found",
            "export missing document: {export_body_json}"
        );
        assert_ne!(export_body_json["error"]["code"], "internal_error");
    }
}
