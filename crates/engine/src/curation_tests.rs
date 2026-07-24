use std::collections::BTreeMap;
use std::fs;

use tempfile::TempDir;
use translunar_asset_core::TmExchangeUnit;
use translunar_protocol::{
    AssetCatalogKind, AssetCatalogListParams, ClientInfo, CurationApplyParams,
    CurationExportFormat, CurationExportParams, CurationFindingListParams, CurationRollbackParams,
    CurationRunIdParams, CurationRunParams, InitializeParams, PROTOCOL_VERSION, RpcRequest,
};
use translunar_storage::NewTmLibrary;

use super::*;

struct Fixture {
    root: TempDir,
    service: EngineService,
    project: translunar_domain::Project,
    library: translunar_asset_core::TmLibrary,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().expect("temporary data directory");
        let mut service = EngineService::open(root.path()).expect("open engine");
        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "Curation fixture".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
            })
            .expect("create project");
        let library = service
            .store
            .create_tm_library(NewTmLibrary {
                name: "Curation fixture TM".to_string(),
                source_locale: project.source_locale.clone(),
                target_locale: project.target_locale.clone(),
                domain: Some(project.domain.clone()),
                writable: true,
                owner_project_id: Some(project.id.clone()),
            })
            .expect("create library");
        service
            .store
            .import_tm_units(
                &library.id,
                &[
                    TmExchangeUnit {
                        source_locale: "en-US".to_string(),
                        target_locale: "zh-CN".to_string(),
                        source_text: "Amount 10".to_string(),
                        target_text: "Amount 20".to_string(),
                        domain: Some("general".to_string()),
                        author: Some("fixture".to_string()),
                        created_at_ms: Some(10),
                        metadata: BTreeMap::new(),
                    },
                    TmExchangeUnit {
                        source_locale: "en-US".to_string(),
                        target_locale: "zh-CN".to_string(),
                        source_text: "Hello world".to_string(),
                        target_text: "Hello world".to_string(),
                        domain: Some("general".to_string()),
                        author: Some("fixture".to_string()),
                        created_at_ms: Some(20),
                        metadata: BTreeMap::new(),
                    },
                    TmExchangeUnit {
                        source_locale: "en-US".to_string(),
                        target_locale: "zh-CN".to_string(),
                        source_text: "A stable legal sentence".to_string(),
                        target_text: "稳定的法律句子".to_string(),
                        domain: Some("legal".to_string()),
                        author: Some("fixture".to_string()),
                        created_at_ms: Some(30),
                        metadata: BTreeMap::new(),
                    },
                ],
            )
            .expect("import fixture units");
        let library = service
            .store
            .get_tm_library(&library.id)
            .expect("reload library");
        Self {
            root,
            service,
            project,
            library,
        }
    }
}

#[test]
fn curation_lifecycle_is_revision_safe_across_restart_and_export() {
    let mut fixture = Fixture::new();
    let run = fixture
        .service
        .run_curation(CurationRunParams {
            project_id: fixture.project.id.clone(),
            library_id: fixture.library.id.clone(),
            expected_library_revision: fixture.library.revision,
            policy: Default::default(),
            actor: "engine-test".to_string(),
            reason: "inspect fixture".to_string(),
            provider_profile_id: None,
            correlation_id: Some("curation-test".to_string()),
            offset: 0,
            limit: 50,
        })
        .expect("run offline curation");
    assert_eq!(run.total, 3);
    assert_eq!(run.run.status, translunar_protocol::CurationRunStatus::Open);
    assert_eq!(run.run.mode, translunar_protocol::CurationRunMode::Offline);

    let findings = fixture
        .service
        .list_curation_findings(CurationFindingListParams {
            run_id: run.run.id.clone(),
            offset: 0,
            limit: 50,
        })
        .expect("list findings");
    assert!(findings.total >= 2);
    let selected = findings
        .items
        .iter()
        .find(|finding| {
            finding.kind == translunar_curation_core::CurationFindingKind::SourceEqualsTarget
        })
        .expect("source equals target finding");
    let applied = fixture
        .service
        .apply_curation(CurationApplyParams {
            run_id: run.run.id.clone(),
            expected_run_revision: run.run.revision,
            expected_library_revision: fixture.library.revision,
            selected_finding_ids: vec![selected.id.clone()],
            actor: "engine-test".to_string(),
            reason: "quarantine confirmed anomaly".to_string(),
            correlation_id: Some("curation-apply".to_string()),
        })
        .expect("apply selected finding");
    assert_eq!(
        applied.status,
        translunar_protocol::CurationRunStatus::Applied
    );
    assert_eq!(applied.changed_unit_count, 3);
    assert_eq!(applied.quarantined_unit_count, 1);

    let export_path = fixture.root.path().join("clean.jsonl");
    let exported = fixture
        .service
        .export_curation(CurationExportParams {
            run_id: run.run.id.clone(),
            expected_run_revision: applied.run_revision,
            expected_library_revision: applied.library_revision,
            minimum_score_basis_points: None,
            format: CurationExportFormat::Jsonl,
            output_path: export_path.to_string_lossy().into_owned(),
        })
        .expect("export active rows");
    assert_eq!(exported.row_count, 2);
    let bytes = fs::read(&export_path).expect("read export");
    assert!(
        bytes
            .windows(b"\"instruction\"".len())
            .any(|window| { window == b"\"instruction\"" })
    );
    let tsv_path = fixture.root.path().join("clean.tsv");
    let exported_tsv = fixture
        .service
        .export_curation(CurationExportParams {
            run_id: run.run.id.clone(),
            expected_run_revision: applied.run_revision,
            expected_library_revision: applied.library_revision,
            minimum_score_basis_points: None,
            format: CurationExportFormat::Tsv,
            output_path: tsv_path.to_string_lossy().into_owned(),
        })
        .expect("export active rows as TSV");
    assert_eq!(exported_tsv.row_count, 2);
    let mut tsv_reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .from_path(&tsv_path)
        .expect("open TSV export");
    assert_eq!(
        tsv_reader
            .records()
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("read TSV export")
            .len(),
        2
    );

    drop(fixture.service);
    let mut reopened = EngineService::open(fixture.root.path()).expect("reopen engine");
    let reopened_run = reopened
        .get_curation_run(CurationRunIdParams {
            run_id: run.run.id.clone(),
            offset: 0,
            limit: 50,
        })
        .expect("reload run");
    assert_eq!(
        reopened_run.run.status,
        translunar_protocol::CurationRunStatus::Applied
    );
    let current_library = reopened
        .store
        .get_tm_library(&fixture.library.id)
        .expect("reload library revision");
    let rollback_expected_run_revision = reopened_run.run.revision;
    let rollback_expected_library_revision = current_library.revision;
    let rolled_back = reopened
        .rollback_curation(CurationRollbackParams {
            run_id: run.run.id.clone(),
            expected_run_revision: rollback_expected_run_revision,
            expected_library_revision: rollback_expected_library_revision,
            actor: "engine-test".to_string(),
            reason: "restore fixture".to_string(),
            correlation_id: Some("curation-rollback".to_string()),
        })
        .expect("rollback applied curation");
    assert_eq!(
        rolled_back.status,
        translunar_protocol::CurationRunStatus::RolledBack
    );
    let replay = reopened
        .rollback_curation(CurationRollbackParams {
            run_id: run.run.id,
            expected_run_revision: rollback_expected_run_revision,
            expected_library_revision: rollback_expected_library_revision,
            actor: "engine-test".to_string(),
            reason: "restore fixture".to_string(),
            correlation_id: Some("curation-rollback".to_string()),
        })
        .expect("rollback is idempotent");
    assert_eq!(replay.operation_id, rolled_back.operation_id);
    assert_eq!(replay.library_revision, rolled_back.library_revision);

    let catalog = reopened
        .list_asset_catalog(AssetCatalogListParams {
            project_id: Some(fixture.project.id),
            kind: AssetCatalogKind::Tm,
            source_locale: None,
            target_locale: None,
            domain: None,
            origin_project_id: None,
            origin_document_id: None,
            created_after_ms: None,
            created_before_ms: None,
            query: None,
            offset: 0,
            limit: 50,
        })
        .expect("catalog after rollback");
    assert_eq!(catalog.total, 3);
    assert!(
        catalog.items.iter().all(|item| {
            item.curation_state == Some(translunar_protocol::CurationState::Active)
        })
    );

    let existing = fixture.root.path().join("existing.tsv");
    fs::write(&existing, b"do not replace").expect("write sentinel");
    let error = reopened
        .export_curation(CurationExportParams {
            run_id: reopened_run.run.id,
            expected_run_revision: rolled_back.run_revision,
            expected_library_revision: rolled_back.library_revision,
            minimum_score_basis_points: None,
            format: CurationExportFormat::Tsv,
            output_path: existing.to_string_lossy().into_owned(),
        })
        .expect_err("existing destination must be rejected");
    assert!(matches!(error, EngineError::CurationExport(_)));
    assert_eq!(
        fs::read(&existing).expect("read sentinel"),
        b"do not replace"
    );
}

#[test]
fn curation_dispatcher_advertises_and_routes_catalog() {
    let root = tempfile::tempdir().expect("temporary data directory");
    let mut dispatcher = RpcDispatcher::open(root.path()).expect("open dispatcher");
    let response = dispatcher.handle(RpcRequest {
        jsonrpc: "2.0".to_string(),
        id: serde_json::json!(1),
        method: methods::INITIALIZE.to_string(),
        params: serde_json::to_value(InitializeParams {
            protocol_version: PROTOCOL_VERSION,
            client: ClientInfo {
                name: "curation-test".to_string(),
                version: "1".to_string(),
            },
        })
        .expect("serialize initialize"),
    });
    let initialize: InitializeResult =
        serde_json::from_value(response.result.expect("initialize result"))
            .expect("decode initialize");
    assert!(
        initialize
            .capabilities
            .iter()
            .any(|capability| capability == "asset.catalog")
    );
    assert!(
        initialize
            .capabilities
            .iter()
            .any(|capability| capability == "asset.curation.rollback")
    );

    let project = dispatcher.handle(RpcRequest {
        jsonrpc: "2.0".to_string(),
        id: serde_json::json!(2),
        method: methods::PROJECT_CREATE.to_string(),
        params: serde_json::json!({
            "name": "Dispatcher curation",
            "sourceLocale": "en-US",
            "targetLocale": "zh-CN",
            "domain": "general"
        }),
    });
    let project: translunar_domain::Project =
        serde_json::from_value(project.result.expect("project result")).expect("decode project");
    let catalog = dispatcher.handle(RpcRequest {
        jsonrpc: "2.0".to_string(),
        id: serde_json::json!(3),
        method: methods::ASSET_CATALOG_LIST.to_string(),
        params: serde_json::json!({
            "projectId": project.id,
            "kind": "tm",
            "offset": 0,
            "limit": 1
        }),
    });
    assert!(catalog.error.is_none());
    let page: translunar_protocol::AssetCatalogPage =
        serde_json::from_value(catalog.result.expect("catalog result"))
            .expect("decode catalog page");
    assert_eq!(page.limit, 1);
}

#[test]
fn curation_stale_export_maps_to_conflict_without_file() {
    let mut fixture = Fixture::new();
    let run = fixture
        .service
        .run_curation(CurationRunParams {
            project_id: fixture.project.id.clone(),
            library_id: fixture.library.id.clone(),
            expected_library_revision: fixture.library.revision,
            policy: Default::default(),
            actor: "engine-test".to_string(),
            reason: "stale export".to_string(),
            provider_profile_id: None,
            correlation_id: None,
            offset: 0,
            limit: 10,
        })
        .expect("run curation");
    let path = fixture.root.path().join("stale.jsonl");
    let error = fixture
        .service
        .export_curation(CurationExportParams {
            run_id: run.run.id,
            expected_run_revision: 99,
            expected_library_revision: fixture.library.revision,
            minimum_score_basis_points: None,
            format: CurationExportFormat::Jsonl,
            output_path: path.to_string_lossy().into_owned(),
        })
        .expect_err("stale run revision must fail");
    assert!(matches!(
        error,
        EngineError::Storage(StorageError::EntityConflict { .. })
    ));
    assert!(!path.exists());
}
