//! Phase 1 vertical slice: project -> DOCX import -> edit/confirm -> exact TM
//! -> number QA -> DOCX export, plus honest AI degradation without a key and
//! the asynchronous agent run driven end-to-end over a loopback SSE fixture.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tl_engine::{Engine, EngineEvent};
use tl_protocol::{
    AgentRunStatus, AgentRunView, AgentStartParams, AgentStepKind, AiAssistAction, AiAssistParams,
    AiAssistRunStatus, AiAssistRunView, AiProviderKind, AiStatusResult, DocumentExportResult,
    DocumentImportResult, DocumentRemoveResult, InitializeResult, PROTOCOL_VERSION, QaRunResult,
    RpcErrorCode, RpcNotification, RpcRequest, SegmentConfirmResult, SegmentListResult,
    SegmentUpdateResult, TmLookupResult, methods,
};

fn fixture_docx() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/docx/m0-source.docx")
        .canonicalize()
        .expect("fixture exists")
}

fn call<T: serde::de::DeserializeOwned>(engine: &mut Engine, method: &str, params: Value) -> T {
    let response = engine.handle(
        RpcRequest {
            id: 1,
            method: method.to_string(),
            params,
        },
        &mut |_notification| {},
    );
    assert!(
        response.error.is_none(),
        "{method} failed: {:?}",
        response.error
    );
    serde_json::from_value(response.result.expect("result present")).expect("decode result")
}

fn call_err(engine: &mut Engine, method: &str, params: Value) -> RpcErrorCode {
    let response = engine.handle(
        RpcRequest {
            id: 1,
            method: method.to_string(),
            params,
        },
        &mut |_notification| {},
    );
    response.error.expect("expected an error").code
}

/// Loopback OpenAI-compatible SSE endpoint: every request gets `reply` back
/// as a single streamed delta after `delay`. Serves until the test ends.
fn spawn_sse_server(reply: &'static str, delay: Duration) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind SSE fixture");
    let address = listener.local_addr().expect("fixture address");
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0u8; content_length];
                let _ = reader.read_exact(&mut body);
                thread::sleep(delay);
                let payload = json!({"choices": [{"delta": {"content": reply}}]});
                let body = format!("data: {payload}\n\ndata: [DONE]\n\n");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            });
        }
    });
    format!("http://{address}")
}

/// Loopback endpoint that answers every request with `body` as an SSE stream
/// and captures the raw request head + body so tests can assert which wire
/// protocol the engine actually spoke (path, auth header, JSON shape).
fn spawn_capturing_sse_server(body: &'static str) -> (String, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind capturing fixture");
    let address = listener.local_addr().expect("fixture address");
    let captured = Arc::new(Mutex::new(String::new()));
    let capture = Arc::clone(&captured);
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let capture = Arc::clone(&capture);
            thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
                let mut request = String::new();
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                    request.push_str(&line);
                }
                let mut payload = vec![0u8; content_length];
                let _ = reader.read_exact(&mut payload);
                request.push_str(&String::from_utf8_lossy(&payload));
                *capture.lock().expect("capture fixture request") = request;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            });
        }
    });
    (format!("http://{address}"), captured)
}

/// Loopback endpoint that accepts connections, swallows the request, and
/// never replies: the honest way to simulate a hung provider. Sockets stay
/// open until the test process exits.
fn spawn_hanging_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind hanging fixture");
    let address = listener.local_addr().expect("fixture address");
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            thread::spawn(move || {
                let mut sink = [0u8; 4096];
                while stream.read(&mut sink).is_ok_and(|bytes| bytes > 0) {
                    // Hold the socket open, never answer.
                }
            });
        }
    });
    format!("http://{address}")
}

fn configure_loopback_ai(engine: &mut Engine, base_url: &str) {
    let status: AiStatusResult = call(
        engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "openaiCompatible",
            "model": "fixture-model",
            "baseUrl": base_url,
            "apiKey": "fixture-key",
        }),
    );
    assert!(status.configured);
}

fn write_txt(directory: &Path, name: &str, contents: &str) -> PathBuf {
    let path = directory.join(name);
    std::fs::write(&path, contents).expect("write txt fixture");
    path
}

/// Pump agent worker events through the engine until the run leaves
/// `running`, mirroring what the stdio loop does in production.
fn drive_agent_run(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    run_id: &str,
    notifications: &mut Vec<RpcNotification>,
) -> AgentRunView {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let view: AgentRunView = call(engine, methods::AI_AGENT_STATUS, json!({ "runId": run_id }));
        if view.status != AgentRunStatus::Running {
            return view;
        }
        assert!(Instant::now() < deadline, "agent run timed out");
        match events.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => engine
                .handle_engine_event(event, &mut |notification| notifications.push(notification))
                .expect("engine event applies"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => panic!("engine event channel closed"),
        }
    }
}

/// Pump worker events through the engine until the assist run turns
/// terminal, mirroring what the stdio loop does in production.
fn wait_assist_terminal(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    assist_id: &str,
) -> AiAssistRunView {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let view: AiAssistRunView = call(
            engine,
            methods::AI_ASSIST_STATUS,
            json!({ "assistId": assist_id }),
        );
        if view.status.is_terminal() {
            return view;
        }
        assert!(Instant::now() < deadline, "assist run timed out");
        match events.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => engine
                .handle_engine_event(event, &mut |_notification| {})
                .expect("engine event applies"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => panic!("engine event channel closed"),
        }
    }
}

/// Start an assist request and drive it to its terminal state.
fn drive_assist(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    params: Value,
) -> AiAssistRunView {
    let started: AiAssistRunView = call(engine, methods::AI_ASSIST_START, params);
    assert_eq!(started.status, AiAssistRunStatus::Running);
    assert!(started.result.is_none(), "start never carries a result");
    wait_assist_terminal(engine, events, &started.assist_id)
}

#[test]
fn vertical_slice_docx_roundtrip() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");

    // Handshake.
    let ready: InitializeResult = call(
        &mut engine,
        methods::ENGINE_INITIALIZE,
        json!({"protocolVersion": PROTOCOL_VERSION, "clientName": "test", "clientVersion": "0"}),
    );
    assert_eq!(ready.protocol_version, PROTOCOL_VERSION);
    assert!(
        ready
            .capabilities
            .filters
            .iter()
            .any(|f| f == "builtin.docx")
    );

    // Project.
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Demo", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );

    // DOCX import.
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": fixture_docx().display().to_string()}),
    );
    assert!(imported.segment_count > 0, "fixture yields segments");
    let document_id = imported.document.id.clone();

    // Grid editing.
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": document_id}),
    );
    let first = listed.segments[0].clone();
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": first.id, "targetText": "第一句译文。", "baseRevision": first.revision}),
    );
    assert_eq!(updated.segment.state, tl_domain::SegmentState::Draft);

    // Stale revision is rejected.
    assert_eq!(
        call_err(
            &mut engine,
            methods::SEGMENT_UPDATE,
            json!({"segmentId": first.id, "targetText": "x", "baseRevision": first.revision}),
        ),
        RpcErrorCode::Conflict
    );

    // Confirm writes the exact TM.
    let confirmed: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": first.id, "baseRevision": updated.segment.revision}),
    );
    assert_eq!(confirmed.segment.state, tl_domain::SegmentState::Confirmed);
    assert_eq!(confirmed.tm_entry.target_text, "第一句译文。");

    // Exact TM lookup hits for the same source text.
    let lookup: TmLookupResult = call(
        &mut engine,
        methods::TM_LOOKUP,
        json!({"projectId": project.id, "sourceText": first.source_text}),
    );
    assert_eq!(lookup.matches.len(), 1);
    assert_eq!(lookup.matches[0].score, 100);

    // Number QA: write a target with a wrong number into a segment that has one.
    let with_number = listed
        .segments
        .iter()
        .find(|segment| !tl_domain::number_tokens(&segment.source_text).is_empty())
        .expect("fixture has a numeric segment")
        .clone();
    if with_number.id != first.id {
        let _: SegmentUpdateResult = call(
            &mut engine,
            methods::SEGMENT_UPDATE,
            json!({"segmentId": with_number.id, "targetText": "保留期为 999 天。", "baseRevision": with_number.revision}),
        );
    }
    let qa: QaRunResult = call(
        &mut engine,
        methods::QA_RUN,
        json!({"documentId": document_id}),
    );
    assert!(qa.open_issues >= 1, "number mismatch is detected");

    // Export.
    let output = workspace.path().join("translated.docx");
    let exported: DocumentExportResult = call(
        &mut engine,
        methods::DOCUMENT_EXPORT,
        json!({"documentId": document_id, "outputPath": output.display().to_string()}),
    );
    assert!(output.is_file(), "export file exists");
    assert!(exported.translated_segments >= 1);

    // Existing output path is refused instead of overwritten.
    assert_eq!(
        call_err(
            &mut engine,
            methods::DOCUMENT_EXPORT,
            json!({"documentId": document_id, "outputPath": output.display().to_string()}),
        ),
        RpcErrorCode::ExportBlocked
    );

    // An explicit overwrite replaces the blocked file (staged sibling temp +
    // atomic rename), still through the real filter pipeline.
    let overwritten: DocumentExportResult = call(
        &mut engine,
        methods::DOCUMENT_EXPORT,
        json!({
            "documentId": document_id,
            "outputPath": output.display().to_string(),
            "overwrite": true,
        }),
    );
    assert_eq!(overwritten.output_path, output.display().to_string());
    assert!(overwritten.translated_segments >= 1);
    assert!(output.is_file(), "overwritten export file exists");

    // Even with overwrite, the engine never replaces a file inside its own
    // data directory: project state lives there.
    assert_eq!(
        call_err(
            &mut engine,
            methods::DOCUMENT_EXPORT,
            json!({
                "documentId": document_id,
                "outputPath": workspace.path().join("data/engine.sqlite").display().to_string(),
                "overwrite": true,
            }),
        ),
        RpcErrorCode::ExportBlocked
    );
}

#[test]
fn state_survives_reopen() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let data_dir = workspace.path().join("data");
    {
        let mut engine = Engine::open(&data_dir).expect("open engine");
        let _: tl_domain::Project = call(
            &mut engine,
            methods::PROJECT_CREATE,
            json!({"name": "Persisted", "sourceLocale": "en-US", "targetLocale": "de-DE"}),
        );
    }
    let mut engine = Engine::open(&data_dir).expect("reopen engine");
    let listed: tl_protocol::ProjectListResult =
        call(&mut engine, methods::PROJECT_LIST, json!({}));
    assert_eq!(listed.projects.len(), 1);
    assert_eq!(listed.projects[0].name, "Persisted");
}

#[test]
fn ai_degrades_honestly_without_credentials() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "AI", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": fixture_docx().display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );

    // Status reports unconfigured.
    let status: AiStatusResult = call(&mut engine, methods::AI_STATUS, json!({}));
    assert!(!status.configured);

    // Assist refuses to start instead of fabricating a translation.
    let params = serde_json::to_value(AiAssistParams {
        segment_id: listed.segments[0].id.clone(),
        action: AiAssistAction::Translate,
        instruction: None,
    })
    .expect("params");
    assert_eq!(
        call_err(&mut engine, methods::AI_ASSIST_START, params),
        RpcErrorCode::AiNotConfigured
    );

    // The agent refuses to start a run it cannot execute.
    let params = serde_json::to_value(AgentStartParams {
        document_id: imported.document.id.clone(),
        instruction: None,
        max_segments: None,
    })
    .expect("params");
    assert_eq!(
        call_err(&mut engine, methods::AI_AGENT_START, params),
        RpcErrorCode::AiNotConfigured
    );

    // A bad key is rejected at configure time, before any provider call.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_CONFIGURE,
            json!({"provider": "openai", "model": "gpt-test", "apiKey": "  "}),
        ),
        RpcErrorCode::InvalidParams
    );
}

#[test]
fn ai_assist_checks_tag_integrity_and_never_touches_confirmed_segments() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "assist.txt",
        "Click {button} to continue.\n\nPlain sentence here.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let tagged = listed
        .segments
        .iter()
        .find(|segment| segment.source_text.contains("{button}"))
        .expect("tagged segment")
        .clone();
    let plain = listed
        .segments
        .iter()
        .find(|segment| segment.source_text.contains("Plain sentence"))
        .expect("plain segment")
        .clone();

    // A proposal that drops the {button} placeholder is flagged as broken.
    let broken_url = spawn_sse_server("点击按钮继续。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &broken_url);
    let broken = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": tagged.id, "action": "translate"}),
    );
    assert_eq!(broken.status, AiAssistRunStatus::Done);
    let broken = broken.result.expect("done run carries the proposal");
    assert!(!broken.tag_check.ok);
    assert_eq!(broken.tag_check.missing, vec!["{button}".to_string()]);
    assert!(broken.tag_check.extra.is_empty());

    // A proposal that carries the placeholder through passes the check.
    let intact_url = spawn_sse_server("点击 {button} 继续。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &intact_url);
    let intact = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": tagged.id, "action": "translate"}),
    );
    assert_eq!(intact.status, AiAssistRunStatus::Done);
    let intact = intact.result.expect("done run carries the proposal");
    assert!(intact.tag_check.ok);
    assert_eq!(intact.draft_target, "点击 {button} 继续。");

    // Refine requires an existing target; the request never starts.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": plain.id, "action": "refine"}),
        ),
        RpcErrorCode::InvalidParams
    );

    // Confirmed segments are off limits for AI assist entirely.
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": plain.id, "targetText": "普通句子。", "baseRevision": plain.revision}),
    );
    let confirmed: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": plain.id, "baseRevision": updated.segment.revision}),
    );
    assert_eq!(confirmed.segment.state, tl_domain::SegmentState::Confirmed);
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": plain.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );
}

#[test]
fn ai_assist_runs_off_the_rpc_thread_and_other_calls_answer_meanwhile() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Async assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "async-assist.txt",
        "Assist must not block the grid.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let segment = listed.segments[0].clone();

    // The provider sleeps before answering; a blocking assist would freeze
    // every call below for the whole delay.
    let delay = Duration::from_millis(1_500);
    let base_url = spawn_sse_server("异步草稿。", delay);
    configure_loopback_ai(&mut engine, &base_url);

    let clock = Instant::now();
    let started: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate"}),
    );
    assert_eq!(started.status, AiAssistRunStatus::Running);

    // Unrelated RPC traffic keeps flowing while the provider call is in
    // flight: project listing, grid reads, TM lookups, status polls.
    let projects: tl_protocol::ProjectListResult =
        call(&mut engine, methods::PROJECT_LIST, json!({}));
    assert_eq!(projects.projects.len(), 1);
    let grid: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(grid.segments.len(), 1);
    let lookup: TmLookupResult = call(
        &mut engine,
        methods::TM_LOOKUP,
        json!({"projectId": project.id, "sourceText": segment.source_text}),
    );
    assert_eq!(lookup.total_matches, 0);
    let polled: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_STATUS,
        json!({"assistId": started.assist_id}),
    );
    assert_eq!(polled.status, AiAssistRunStatus::Running);
    assert!(
        clock.elapsed() < delay,
        "RPC calls answered while the provider was still sleeping ({:?})",
        clock.elapsed()
    );

    // A second assist for the same segment is refused while one is running.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": segment.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );

    let finished = wait_assist_terminal(&mut engine, &events, &started.assist_id);
    assert_eq!(finished.status, AiAssistRunStatus::Done);
    let result = finished.result.expect("done run carries the proposal");
    assert_eq!(result.draft_target, "异步草稿。");
    assert!(result.tag_check.ok);

    // Assist only proposes: the segment itself was never written.
    let after: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(
        after.segments[0].state,
        tl_domain::SegmentState::Untranslated
    );
    assert!(after.segments[0].target_text.is_empty());
}

#[test]
fn ai_assist_cancel_discards_late_results_and_frees_the_segment() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Cancel assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(workspace.path(), "cancel-assist.txt", "One sentence.\n");
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let segment = listed.segments[0].clone();

    let base_url = spawn_sse_server("慢速候选。", Duration::from_millis(600));
    configure_loopback_ai(&mut engine, &base_url);

    let first: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate"}),
    );
    let canceled: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_CANCEL,
        json!({"assistId": first.assist_id}),
    );
    assert!(canceled.cancel_requested);

    // A cancel-requested run no longer blocks a retry on the same segment.
    let second: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate"}),
    );
    assert_eq!(second.status, AiAssistRunStatus::Running);

    // Even if the first provider call completes, its result is discarded.
    let first_finished = wait_assist_terminal(&mut engine, &events, &first.assist_id);
    assert_eq!(first_finished.status, AiAssistRunStatus::Canceled);
    assert!(first_finished.result.is_none());

    let second_finished = wait_assist_terminal(&mut engine, &events, &second.assist_id);
    assert_eq!(second_finished.status, AiAssistRunStatus::Done);
    assert_eq!(
        second_finished
            .result
            .expect("second run result")
            .draft_target,
        "慢速候选。"
    );

    // Unknown assist runs are a NotFound, not a silent success.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_STATUS,
            json!({"assistId": "missing"}),
        ),
        RpcErrorCode::NotFound
    );
}

#[test]
fn ai_assist_reports_provider_failure_honestly() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Failing assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(workspace.path(), "failing-assist.txt", "A sentence.\n");
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );

    // Bind a port, then drop the listener: connections are refused.
    let dead_url = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind dead port");
        format!("http://{}", listener.local_addr().expect("dead address"))
    };
    configure_loopback_ai(&mut engine, &dead_url);

    let finished = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(finished.status, AiAssistRunStatus::Failed);
    assert!(finished.result.is_none(), "failed runs carry no proposal");
    let message = finished.error_message.expect("failure reason");
    assert!(
        message.contains("unavailable"),
        "honest provider error, got: {message}"
    );
}

#[test]
fn agent_run_pretranslates_drafts_and_parks_at_the_human_gate() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Agent", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );

    // Seed the project TM through the normal human confirm path.
    let seed = write_txt(workspace.path(), "seed.txt", "Shared sentence here.\n");
    let seeded: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": seed.display().to_string()}),
    );
    let seed_segments: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": seeded.document.id}),
    );
    let seed_segment = seed_segments.segments[0].clone();
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": seed_segment.id, "targetText": "这里是共享句子。", "baseRevision": seed_segment.revision}),
    );
    let _: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": seed_segment.id, "baseRevision": updated.segment.revision}),
    );

    // The work document: one TM hit, one plain miss, one numeric miss.
    let work = write_txt(
        workspace.path(),
        "work.txt",
        "Shared sentence here.\n\nUnique alpha sentence.\n\nNumbers 42 stay intact.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    assert_eq!(imported.segment_count, 3);

    // The fixture reply carries no numbers, so number QA must flag the
    // numeric segment afterwards.
    let base_url = spawn_sse_server("机器草稿译文。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "instruction": "保持术语一致"}),
    );
    assert_eq!(run.status, AgentRunStatus::Running);
    assert_eq!(run.planned_segments, 3);
    assert_eq!(run.tm_applied, 1, "exact TM hit is applied at start");
    assert!(run.steps.iter().any(|step| step.kind == AgentStepKind::Tm));

    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);

    // The run parks at the human gate: drafts exist, nothing is confirmed,
    // nothing is exported.
    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 2);
    assert_eq!(finished.failed_segments, 0);
    assert!(finished.open_qa_issues >= 1, "number QA flags the fixture");
    let kinds: Vec<AgentStepKind> = finished.steps.iter().map(|step| step.kind).collect();
    assert_eq!(kinds[0], AgentStepKind::Plan);
    assert!(kinds.contains(&AgentStepKind::Qa));
    assert_eq!(*kinds.last().expect("steps"), AgentStepKind::Summary);

    let segments: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    for segment in &segments.segments {
        assert_eq!(
            segment.state,
            tl_domain::SegmentState::Draft,
            "agent leaves drafts, never confirms"
        );
        assert!(!segment.target_text.trim().is_empty());
    }

    // Step notifications stream while the worker runs and carry the run
    // status so clients can observe the terminal transition.
    assert!(!notifications.is_empty());
    let last = notifications.last().expect("last notification");
    assert_eq!(last.method, "notify.ai.agent.step");
    assert_eq!(last.params["runStatus"], "awaitingReview");
}

#[test]
fn agent_runs_on_different_documents_proceed_concurrently() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Concurrent", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let first_doc = write_txt(
        workspace.path(),
        "concurrent-a.txt",
        "Alpha sentence one.\n\nAlpha sentence two.\n",
    );
    let second_doc = write_txt(
        workspace.path(),
        "concurrent-b.txt",
        "Beta sentence one.\n\nBeta sentence two.\n",
    );
    let imported_a: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": first_doc.display().to_string()}),
    );
    let imported_b: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": second_doc.display().to_string()}),
    );

    // Slow fixture so the first run is still in flight when the second starts.
    let base_url = spawn_sse_server("并发草稿。", Duration::from_millis(400));
    configure_loopback_ai(&mut engine, &base_url);

    let run_a: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported_a.document.id}),
    );
    assert_eq!(run_a.status, AgentRunStatus::Running);

    // Same document while running: honest Conflict.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_START,
            json!({"documentId": imported_a.document.id}),
        ),
        RpcErrorCode::Conflict
    );

    // A different document does not fight: the second run starts at once.
    let run_b: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported_b.document.id}),
    );
    assert_eq!(run_b.status, AgentRunStatus::Running);
    assert_ne!(run_a.run_id, run_b.run_id, "each job has its own run id");

    // Both runs park at the human gate; status stays addressable per run id.
    let mut notifications = Vec::new();
    let finished_a = drive_agent_run(&mut engine, &events, &run_a.run_id, &mut notifications);
    let finished_b = drive_agent_run(&mut engine, &events, &run_b.run_id, &mut notifications);
    assert_eq!(finished_a.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished_b.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished_a.ai_drafted, 2);
    assert_eq!(finished_b.ai_drafted, 2);

    // Both documents got drafts, nothing was confirmed anywhere.
    for document_id in [&imported_a.document.id, &imported_b.document.id] {
        let segments: SegmentListResult = call(
            &mut engine,
            methods::SEGMENT_LIST,
            json!({"documentId": document_id}),
        );
        for segment in &segments.segments {
            assert_eq!(segment.state, tl_domain::SegmentState::Draft);
        }
    }

    // Once the first run is terminal, its document is free again.
    let rerun: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported_a.document.id}),
    );
    assert_eq!(rerun.planned_segments, 0, "nothing left to draft");
}

#[test]
fn agent_drafts_segments_in_parallel_within_one_run() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Parallel", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "parallel.txt",
        "Parallel one.\n\nParallel two.\n\nParallel three.\n\nParallel four.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    assert_eq!(imported.segment_count, 4);

    // 4 segments x 600 ms: serial drafting needs >= 2.4 s, the worker pool
    // finishes in roughly one round trip.
    let delay = Duration::from_millis(600);
    let base_url = spawn_sse_server("并行草稿。", delay);
    configure_loopback_ai(&mut engine, &base_url);

    let clock = Instant::now();
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id}),
    );
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    let elapsed = clock.elapsed();

    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 4);
    assert_eq!(finished.failed_segments, 0);
    assert!(
        elapsed < delay * 4,
        "worker pool drafts segments concurrently; serial would need >= {:?}, got {elapsed:?}",
        delay * 4
    );
}

#[test]
fn agent_cancel_aborts_in_flight_provider_calls_without_waiting_for_the_timeout() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Abort", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "abort.txt",
        "Hang one.\n\nHang two.\n\nHang three.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );

    // The provider never answers; the runtime profile timeout is 60 s. A
    // cooperative-only cancel would leave the run "running" for the whole
    // timeout; the abortive cancel must turn it terminal within seconds.
    let base_url = spawn_hanging_server();
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(run.status, AgentRunStatus::Running);

    // Let the workers actually enter their provider calls before canceling.
    std::thread::sleep(Duration::from_millis(300));
    let clock = Instant::now();
    let canceled: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_CANCEL,
        json!({"runId": run.run_id}),
    );
    assert!(canceled.cancel_requested);

    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::Canceled);
    assert_eq!(finished.ai_drafted, 0, "hung calls never produce drafts");
    assert!(
        clock.elapsed() < Duration::from_secs(5),
        "cancel aborted in-flight HTTP in {:?}, far below the 60 s provider timeout",
        clock.elapsed()
    );

    // The canceled run frees its document for a fresh start.
    let rerun: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(rerun.status, AgentRunStatus::Running);
    let _: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_CANCEL,
        json!({"runId": rerun.run_id}),
    );
    let finished_rerun = drive_agent_run(&mut engine, &events, &rerun.run_id, &mut notifications);
    assert_eq!(finished_rerun.status, AgentRunStatus::Canceled);
}

#[test]
fn agent_run_cancels_mid_run_and_same_document_run_conflicts() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Cancel", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "cancel.txt",
        "First sentence one.\n\nSecond sentence two.\n\nThird sentence three.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );

    // Slow fixture so cancellation lands while drafting is still in flight.
    let base_url = spawn_sse_server("慢速草稿。", Duration::from_millis(400));
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(run.status, AgentRunStatus::Running);

    // A second run on the same document cannot start while one is in flight.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_START,
            json!({"documentId": imported.document.id}),
        ),
        RpcErrorCode::Conflict
    );

    // Removing the document out from under the live run is refused the same
    // honest way — its workers still land drafts on these segments.
    assert_eq!(
        call_err(
            &mut engine,
            methods::DOCUMENT_REMOVE,
            json!({"documentId": imported.document.id}),
        ),
        RpcErrorCode::Conflict
    );

    let canceled: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_CANCEL,
        json!({"runId": run.run_id}),
    );
    assert!(canceled.cancel_requested);

    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::Canceled);
    assert!(
        finished.ai_drafted < 3,
        "cancellation stops before the whole document is drafted"
    );
    assert!(
        finished
            .steps
            .iter()
            .any(|step| step.kind == AgentStepKind::Cancel),
        "cancel step is observable"
    );

    // Unknown runs are a NotFound, not a silent success.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_STATUS,
            json!({"runId": "missing"})
        ),
        RpcErrorCode::NotFound
    );

    // Once the run is terminal the document can be removed.
    let removed: DocumentRemoveResult = call(
        &mut engine,
        methods::DOCUMENT_REMOVE,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(removed.document.id, imported.document.id);
}

/// The `ai.configure` provider selector is real: `gemini` speaks the native
/// Google Generative Language API and `anthropic` speaks the Messages API.
/// Both run against loopback mocks — no real key or endpoint is involved —
/// and the captured wire traffic proves the protocol switch, not just the
/// label in `ai.status`.
#[test]
fn ai_configure_routes_native_gemini_and_anthropic_protocols() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Providers", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "providers.txt",
        "First provider sentence.\n\nSecond provider sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert!(listed.segments.len() >= 2, "two segments to assist");

    // Gemini: streamGenerateContent with the key in the query string, and a
    // candidates/parts SSE payload instead of the OpenAI delta shape.
    let gemini_body = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"双子座草稿。\"}]}}]}\n\n",
        "data: {\"usageMetadata\":{\"promptTokenCount\":7,\"candidatesTokenCount\":3}}\n\n"
    );
    let (gemini_url, gemini_captured) = spawn_capturing_sse_server(gemini_body);
    let status: AiStatusResult = call(
        &mut engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "gemini",
            "model": "gemini-fixture",
            "baseUrl": gemini_url,
            "apiKey": "fixture-gemini-key",
        }),
    );
    assert!(status.configured);
    assert_eq!(status.provider, Some(AiProviderKind::Gemini));
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let result = done.result.expect("gemini run carries the proposal");
    assert_eq!(result.draft_target, "双子座草稿。");
    assert_eq!(result.provider, AiProviderKind::Gemini);
    assert_eq!(result.model, "gemini-fixture");
    let request = gemini_captured
        .lock()
        .expect("captured gemini request")
        .clone();
    assert!(
        request.contains("/models/gemini-fixture:streamGenerateContent"),
        "gemini speaks the native generateContent route, got: {request}"
    );
    assert!(request.contains("alt=sse"), "gemini asks for SSE framing");
    assert!(
        request.contains("key=fixture-gemini-key"),
        "gemini carries the key as a query parameter"
    );
    assert!(
        !request.contains("chat/completions"),
        "gemini must not fall back to the OpenAI route"
    );
    assert!(
        request.contains("\"contents\""),
        "gemini body uses contents/parts, got: {request}"
    );

    // Anthropic: /v1/messages with the x-api-key header and the Messages
    // API event stream. Reconfiguring swaps the runtime wholesale.
    let anthropic_body = concat!(
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"人择草稿。\"}}\n\n",
        "data: {\"type\":\"message_stop\"}\n\n"
    );
    let (anthropic_url, anthropic_captured) = spawn_capturing_sse_server(anthropic_body);
    let status: AiStatusResult = call(
        &mut engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "anthropic",
            "model": "claude-fixture",
            "baseUrl": anthropic_url,
            "apiKey": "fixture-anthropic-key",
        }),
    );
    assert!(status.configured);
    assert_eq!(status.provider, Some(AiProviderKind::Anthropic));
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[1].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let result = done.result.expect("anthropic run carries the proposal");
    assert_eq!(result.draft_target, "人择草稿。");
    assert_eq!(result.provider, AiProviderKind::Anthropic);
    let request = anthropic_captured
        .lock()
        .expect("captured anthropic request")
        .clone();
    assert!(
        request.contains("POST /v1/messages"),
        "anthropic speaks the Messages API, got: {request}"
    );
    assert!(
        request
            .to_ascii_lowercase()
            .contains("x-api-key: fixture-anthropic-key"),
        "anthropic authenticates via x-api-key"
    );
    assert!(
        request.to_ascii_lowercase().contains("anthropic-version:"),
        "anthropic pins its API version header"
    );
    assert!(
        !request.contains("chat/completions"),
        "anthropic must not fall back to the OpenAI route"
    );
}

/// `openaiResponses` speaks the OpenAI Responses API: `POST {base}/responses`
/// with an `input` item list, streamed `response.output_text.delta` events,
/// and usage on the terminal `response.completed` envelope. The captured
/// loopback wire proves the route — the existing `openaiCompatible`
/// chat-completions path stays untouched.
#[test]
fn ai_configure_routes_openai_responses_protocol() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Responses", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "responses.txt",
        "Responses provider sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert!(!listed.segments.is_empty(), "one segment to assist");

    let responses_body = concat!(
        "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"应答草稿。\"}\n\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"应答草稿。\"}]}],\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}}\n\n"
    );
    let (responses_url, responses_captured) = spawn_capturing_sse_server(responses_body);
    let status: AiStatusResult = call(
        &mut engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "openaiResponses",
            "model": "responses-fixture",
            "baseUrl": format!("{responses_url}/v1"),
            "apiKey": "fixture-responses-key",
        }),
    );
    assert!(status.configured);
    assert_eq!(status.provider, Some(AiProviderKind::OpenaiResponses));
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let result = done.result.expect("responses run carries the proposal");
    assert_eq!(result.draft_target, "应答草稿。");
    assert_eq!(result.provider, AiProviderKind::OpenaiResponses);
    assert_eq!(result.model, "responses-fixture");
    let request = responses_captured
        .lock()
        .expect("captured responses request")
        .clone();
    assert!(
        request.contains("POST /v1/responses HTTP"),
        "openaiResponses speaks the Responses route, got: {request}"
    );
    assert!(
        !request.contains("chat/completions"),
        "openaiResponses must not fall back to the chat-completions route"
    );
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer fixture-responses-key"),
        "openaiResponses authenticates with the bearer key"
    );
    assert!(
        request.contains("\"input\""),
        "Responses body carries input items, got: {request}"
    );
    assert!(
        !request.contains("\"messages\""),
        "Responses body must not reuse the chat-completions messages field"
    );
}

#[test]
fn ready_notification_reports_engine_identity() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let RpcNotification { method, params } = engine.ready_notification();
    assert_eq!(method, tl_protocol::notifications::ENGINE_READY);
    assert_eq!(params["engineName"], "tl-engine");
    assert_eq!(params["protocolVersion"], PROTOCOL_VERSION);
}

/// Locked segments are invisible to the AI surfaces: the agent never plans
/// or drafts them, and assist on a locked row is an honest conflict.
#[test]
fn agent_and_assist_leave_locked_segments_alone() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Locked", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "locked.txt",
        "Locked alpha sentence.\n\nFree bravo sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    let segments: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let locked_row = segments.segments[0].clone();
    let _: Value = call(
        &mut engine,
        methods::SEGMENT_LOCK,
        json!({"segmentId": locked_row.id, "locked": true, "baseRevision": locked_row.revision}),
    );

    let base_url = spawn_sse_server("机器草稿译文。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    // Assist on the locked row: conflict before any provider call.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": locked_row.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );

    // The agent plans only the unlocked row and drafts exactly it.
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(run.planned_segments, 1, "locked row is never planned");
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 1);

    let after: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert!(after.segments[0].locked);
    assert_eq!(after.segments[0].target_text, "", "locked row stays empty");
    assert_eq!(
        after.segments[0].state,
        tl_domain::SegmentState::Untranslated
    );
    assert_eq!(after.segments[1].target_text, "机器草稿译文。");
    assert_eq!(after.segments[1].state, tl_domain::SegmentState::Draft);
}
