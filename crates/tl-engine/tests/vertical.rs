//! Phase 1 vertical slice: project -> DOCX import -> edit/confirm -> exact TM
//! -> number QA -> DOCX export, plus honest AI degradation without a key.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use tl_engine::Engine;
use tl_protocol::{
    AgentRunParams, AiAssistAction, AiAssistParams, AiStatusResult, DocumentExportResult,
    DocumentImportResult, InitializeResult, PROTOCOL_VERSION, QaRunResult, RpcErrorCode,
    RpcNotification, RpcRequest, SegmentConfirmResult, SegmentListResult, SegmentUpdateResult,
    TmLookupResult, methods,
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
    let params = serde_json::to_value(AgentRunParams {
        document_id: imported.document.id.clone(),
        instruction: None,
        max_segments: None,
    })
    .expect("params");
    assert_eq!(
        call_err(&mut engine, methods::AI_AGENT_RUN, params),
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
fn ready_notification_reports_engine_identity() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let RpcNotification { method, params } = engine.ready_notification();
    assert_eq!(method, tl_protocol::notifications::ENGINE_READY);
    assert_eq!(params["engineName"], "tl-engine");
    assert_eq!(params["protocolVersion"], PROTOCOL_VERSION);
}
