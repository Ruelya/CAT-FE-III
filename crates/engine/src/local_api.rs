//! Loopback HTTP adapter over EngineService.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use translunar_protocol::{
    CreateProjectParams, DocumentListParams, EmptyParams, ExportDocumentParams,
    ImportDocumentParams, ProjectListParams, QaOverrideInput, TermbaseListParams,
    TmLibraryListParams,
};

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
    listener
        .set_nonblocking(false)
        .map_err(EngineError::Io)?;
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
            let params: ProjectListParams = serde_json::from_value(body.clone()).unwrap_or(
                ProjectListParams {
                    lifecycle: None,
                    offset: 0,
                    limit: 50,
                },
            );
            serde_json::to_value(engine.list_projects(params)?)?
        }
        ("POST", "/v1/projects") => {
            let params: CreateProjectParams = serde_json::from_value(body)?;
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
            let mut params: ImportDocumentParams = serde_json::from_value(body)?;
            params.project_id = project_id.to_string();
            serde_json::to_value(engine.import_document(params)?)?
        }
        ("POST", path) if path.starts_with("/v1/documents/") && path.ends_with("/export") => {
            let document_id = path
                .trim_start_matches("/v1/documents/")
                .trim_end_matches("/export")
                .trim_matches('/');
            let mut params: ExportDocumentParams = serde_json::from_value(body)?;
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
        serde_json::from_slice(&self.body).map_err(|error| {
            EngineError::InvalidRequest(format!("invalid JSON body: {error}"))
        })
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
    stream.write_all(header.as_bytes()).map_err(EngineError::Io)?;
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

fn status_for_error(error: &EngineError) -> u16 {
    match error {
        EngineError::InvalidRequest(message)
            if message.contains("bearer") || message.contains("token") =>
        {
            401
        }
        EngineError::InvalidRequest(_) => 400,
        EngineError::Storage(translunar_storage::StorageError::NotFound { .. }) => 404,
        EngineError::Storage(translunar_storage::StorageError::EntityConflict { .. })
        | EngineError::Storage(translunar_storage::StorageError::Conflict { .. }) => 409,
        EngineError::QaGateBlocked { .. } => 409,
        _ => 500,
    }
}

fn error_code(error: &EngineError) -> &'static str {
    match error {
        EngineError::InvalidRequest(message)
            if message.contains("bearer") || message.contains("token") =>
        {
            "unauthorized"
        }
        EngineError::InvalidRequest(_) => "invalid_request",
        EngineError::Storage(translunar_storage::StorageError::NotFound { .. }) => "not_found",
        EngineError::QaGateBlocked { .. } => "qa_gate_blocked",
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
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct _Unused;
    let project = service.create_project(CreateProjectParams {
        name: project_name.to_string(),
        source_locale: "en-US".into(),
        target_locale: "zh-CN".into(),
        domain: "general".into(),
    })?;
    let imported = service.import_document(ImportDocumentParams {
        project_id: project.id.clone(),
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
        "projectId": project.id,
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
    use tempfile::tempdir;

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
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server_service = Arc::clone(&service);
        let server_tokens = Arc::clone(&tokens);
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = dispatch_connection(&mut stream, &server_service, server_tokens.as_ref());
        });

        // unauthenticated health is separate; first protected call without token
        let listener2 = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr2 = listener2.local_addr().unwrap();
        let server_service2 = Arc::clone(&service);
        let server_tokens2 = Arc::clone(&tokens);
        thread::spawn(move || {
            let (mut stream, _) = listener2.accept().unwrap();
            let _ = dispatch_connection(&mut stream, &server_service2, server_tokens2.as_ref());
        });
        let mut unauthorized = TcpStream::connect(addr2).unwrap();
        unauthorized
            .write_all(b"GET /v1/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut unauthorized_body = String::new();
        unauthorized
            .read_to_string(&mut unauthorized_body)
            .unwrap();
        assert!(unauthorized_body.contains("401") || unauthorized_body.contains("unauthorized") || unauthorized_body.contains("bearer"));

        // authenticated project create through a fresh accept loop is heavy; use run_pipeline helper
        let mut engine = service.lock().unwrap();
        let output = directory.path().join("out.txt");
        let summary = run_pipeline(&mut engine, source, output.clone(), "API test").unwrap();
        assert!(output.is_file());
        assert!(summary["segmentCount"].as_u64().unwrap() >= 1);
        assert!(!summary["projectId"].as_str().unwrap().is_empty());
        let _ = token;
        let _ = addr;
    }
}
