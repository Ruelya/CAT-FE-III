//! Phase 1 vertical slice: project -> DOCX import -> edit/confirm -> exact TM
//! -> number QA -> DOCX export, plus honest AI degradation without a key and
//! the asynchronous agent run driven end-to-end over a loopback SSE fixture.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tl_engine::{AgentEvent, Engine};
use tl_protocol::{
    AgentRunStatus, AgentRunView, AgentStartParams, AgentStepKind, AiAssistAction, AiAssistParams,
    AiAssistResult, AiStatusResult, DocumentExportResult, DocumentImportResult, InitializeResult,
    PROTOCOL_VERSION, QaRunResult, RpcErrorCode, RpcNotification, RpcRequest, SegmentConfirmResult,
    SegmentListResult, SegmentUpdateResult, TmLookupResult, methods,
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
    events: &Receiver<AgentEvent>,
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
                .handle_agent_event(event, &mut |notification| notifications.push(notification))
                .expect("agent event applies"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => panic!("agent event channel closed"),
        }
    }
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

    // Assist refuses instead of fabricating a translation.
    let params = serde_json::to_value(AiAssistParams {
        segment_id: listed.segments[0].id.clone(),
        action: AiAssistAction::Translate,
        instruction: None,
    })
    .expect("params");
    assert_eq!(
        call_err(&mut engine, methods::AI_ASSIST, params),
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
    let broken: AiAssistResult = call(
        &mut engine,
        methods::AI_ASSIST,
        json!({"segmentId": tagged.id, "action": "translate"}),
    );
    assert!(!broken.tag_check.ok);
    assert_eq!(broken.tag_check.missing, vec!["{button}".to_string()]);
    assert!(broken.tag_check.extra.is_empty());

    // A proposal that carries the placeholder through passes the check.
    let intact_url = spawn_sse_server("点击 {button} 继续。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &intact_url);
    let intact: AiAssistResult = call(
        &mut engine,
        methods::AI_ASSIST,
        json!({"segmentId": tagged.id, "action": "translate"}),
    );
    assert!(intact.tag_check.ok);
    assert_eq!(intact.draft_target, "点击 {button} 继续。");

    // Refine requires an existing target.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST,
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
            methods::AI_ASSIST,
            json!({"segmentId": plain.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );
}

#[test]
fn agent_run_pretranslates_drafts_and_parks_at_the_human_gate() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_agent_events();
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
fn agent_run_cancels_between_segments_and_rejects_concurrent_runs() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_agent_events();
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

    // A second run cannot start while one is in flight.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_START,
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
