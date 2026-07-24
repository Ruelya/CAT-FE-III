use std::collections::BTreeMap;
use std::fs;

use translunar_asset_core::{AssetMountMode, TermStatus, TmExchangeUnit, TmLibrary};
use translunar_curation_core::{CurationFindingKind, analyze};
use translunar_domain::Project;

use super::*;
use crate::{
    NewReferenceCorpus, NewReferenceCorpusEntry, NewTermEntry, NewTermTranslation, NewTermbase,
    NewTmLibrary, ReferenceCorpusKind, TmSearchRequest,
};

struct SeededAssets {
    project: Project,
    library: TmLibrary,
    clean_unit_id: String,
    dirty_unit_id: String,
    snapshot: CurationSnapshot,
    analysis: CurationAnalysis,
}

struct OpenRun {
    assets: SeededAssets,
    run: CurationRunRecord,
    selected_finding_id: String,
}

fn exchange_unit(source_text: &str, target_text: &str, created_at_ms: i64) -> TmExchangeUnit {
    TmExchangeUnit {
        source_locale: "en".to_string(),
        target_locale: "zh".to_string(),
        source_text: source_text.to_string(),
        target_text: target_text.to_string(),
        domain: Some("legal".to_string()),
        author: Some("curation-test".to_string()),
        created_at_ms: Some(created_at_ms),
        metadata: BTreeMap::new(),
    }
}

fn seed_assets(store: &mut Store) -> SeededAssets {
    let project = store
        .create_project("Curation project", "en", "zh", "legal")
        .expect("create curation project");
    let library = store
        .create_tm_library(NewTmLibrary {
            name: "Curation library".to_string(),
            source_locale: "en".to_string(),
            target_locale: "zh".to_string(),
            domain: Some("legal".to_string()),
            writable: true,
            owner_project_id: Some(project.id.clone()),
        })
        .expect("create curation library");
    store
        .mount_tm_library(
            &project.id,
            &library.id,
            AssetMountMode::Reference,
            10,
            true,
            None,
        )
        .expect("mount curation library");
    store
        .import_tm_units(
            &library.id,
            &[
                exchange_unit("The agreement remains valid.", "协议继续有效。", 10),
                exchange_unit("Do not translate Acme", "Do not translate Acme", 20),
            ],
        )
        .expect("import curation units");
    let snapshot = store
        .load_curation_snapshot(&project.id, &library.id)
        .expect("load curation snapshot");
    let clean_unit_id = snapshot
        .units
        .iter()
        .find(|unit| unit.source_text == "The agreement remains valid.")
        .expect("clean curation unit")
        .id
        .clone();
    let dirty_unit_id = snapshot
        .units
        .iter()
        .find(|unit| unit.source_text == "Do not translate Acme")
        .expect("dirty curation unit")
        .id
        .clone();
    let analysis =
        analyze(&snapshot.units, &CurationPolicy::default(), &[]).expect("analyze curation units");
    SeededAssets {
        project,
        library: snapshot.library.clone(),
        clean_unit_id,
        dirty_unit_id,
        snapshot,
        analysis,
    }
}

fn create_run_input(assets: &SeededAssets) -> CreateCurationRun {
    CreateCurationRun {
        project_id: assets.project.id.clone(),
        library_id: assets.library.id.clone(),
        expected_library_revision: assets.snapshot.library.revision,
        mode: CurationRunMode::Offline,
        policy: CurationPolicy::default(),
        analysis: assets.analysis.clone(),
        actor: "curation-test".to_string(),
        reason: "review imported translation memory".to_string(),
        provider_profile_id: None,
        correlation_id: Some("curation-run-test".to_string()),
    }
}

fn seed_open_run(store: &mut Store) -> OpenRun {
    let assets = seed_assets(store);
    let run = store
        .create_curation_run(create_run_input(&assets))
        .expect("create curation run");
    let findings = store
        .list_curation_findings(&run.id, 0, 500)
        .expect("list curation findings")
        .0;
    let selected_finding_id = findings
        .iter()
        .find(|finding| {
            finding.unit_id == assets.dirty_unit_id
                && finding.kind == CurationFindingKind::SourceEqualsTarget
        })
        .expect("source-equals-target finding")
        .id
        .clone();
    OpenRun {
        assets,
        run,
        selected_finding_id,
    }
}

fn apply_input(open: &OpenRun) -> ApplyCuration {
    ApplyCuration {
        run_id: open.run.id.clone(),
        expected_run_revision: open.run.revision,
        expected_library_revision: open.assets.library.revision,
        selected_finding_ids: vec![open.selected_finding_id.clone()],
        actor: "curation-test".to_string(),
        reason: "quarantine the selected dirty unit".to_string(),
        correlation_id: Some("curation-apply-test".to_string()),
    }
}

fn rollback_input(applied: &CurationMutationResultRecord) -> RollbackCuration {
    RollbackCuration {
        run_id: applied.run_id.clone(),
        expected_run_revision: applied.run_revision,
        expected_library_revision: applied.library_revision,
        actor: "curation-test".to_string(),
        reason: "restore the reviewed translation memory".to_string(),
        correlation_id: Some("curation-rollback-test".to_string()),
    }
}

fn search_request(project_id: &str, library_id: &str, query: &str) -> TmSearchRequest {
    TmSearchRequest {
        project_id: project_id.to_string(),
        source_locale: "en".to_string(),
        target_locale: "zh".to_string(),
        query: query.to_string(),
        threshold: 100,
        offset: 0,
        limit: 20,
        library_ids: vec![library_id.to_string()],
        domain: None,
        since_ms: None,
        origin_project_id: None,
        origin_document_id: None,
        context_before_hash: None,
        context_after_hash: None,
    }
}

fn catalog_filter(
    project_id: Option<&str>,
    kind: AssetCatalogKind,
    query: Option<&str>,
) -> AssetCatalogFilter {
    AssetCatalogFilter {
        project_id: project_id.map(str::to_string),
        kind,
        source_locale: None,
        target_locale: None,
        domain: None,
        origin_project_id: None,
        origin_document_id: None,
        created_after_ms: None,
        created_before_ms: None,
        query: query.map(str::to_string),
        offset: 0,
        limit: 20,
    }
}

#[test]
fn curation_lifecycle_is_restart_safe_revisioned_and_idempotent() {
    let temp = tempfile::tempdir().expect("temporary curation directory");
    let mut store = Store::open(temp.path()).expect("open curation store");
    let open = seed_open_run(&mut store);

    assert_eq!(open.run.status, CurationRunStatus::Open);
    assert_eq!(open.run.revision, 0);
    assert_eq!(open.run.base_library_revision, open.assets.library.revision);
    assert!(open.run.completed_at_ms.is_some());
    let (run_units, run_unit_total) = store
        .list_curation_run_units(&open.run.id, 0, 1)
        .expect("page curation run units");
    assert_eq!(run_units.len(), 1);
    assert_eq!(run_unit_total, 2);
    assert_eq!(
        store
            .search_tm(&search_request(
                &open.assets.project.id,
                &open.assets.library.id,
                "Do not translate Acme",
            ))
            .expect("search dirty unit before apply")
            .1,
        1
    );

    let apply = apply_input(&open);
    let applied = store.apply_curation(apply.clone()).expect("apply curation");
    assert_eq!(applied.status, CurationRunStatus::Applied);
    assert_eq!(applied.run_revision, 1);
    assert_eq!(applied.library_revision, open.assets.library.revision + 1);
    assert_eq!(applied.changed_unit_count, 2);
    assert_eq!(applied.quarantined_unit_count, 1);
    assert_eq!(
        store
            .search_tm(&search_request(
                &open.assets.project.id,
                &open.assets.library.id,
                "Do not translate Acme",
            ))
            .expect("search dirty unit after apply")
            .1,
        0
    );
    let (_, active_total) = store
        .list_tm_units(&open.assets.library.id, 0, 20)
        .expect("list active TM units after apply");
    assert_eq!(active_total, 1);
    assert_eq!(
        store
            .export_tm_units(&open.assets.library.id)
            .expect("export recoverable TM units")
            .len(),
        2
    );
    let dataset = store
        .export_curation_dataset(&open.run.id, None)
        .expect("load applied curation dataset");
    assert_eq!(dataset.units.len(), 1);
    assert_eq!(dataset.units[0].unit_id, open.assets.clean_unit_id);

    let changes = store
        .list_curation_changes(&open.run.id)
        .expect("list applied curation changes");
    assert_eq!(changes.len(), 2);
    let dirty_change = changes
        .iter()
        .find(|change| change.unit_id == open.assets.dirty_unit_id)
        .expect("dirty curation change");
    assert_eq!(dirty_change.action, CurationChangeAction::Quarantine);
    assert_eq!(dirty_change.before["curationState"], "active");
    assert!(dirty_change.before["qualityScoreBasisPoints"].is_null());
    assert_eq!(dirty_change.after["curationState"], "quarantined");
    assert_eq!(dirty_change.after["curationRevision"], 1);
    assert_eq!(
        dirty_change.after["lastCuratedRunId"].as_str(),
        Some(open.run.id.as_str())
    );

    drop(store);
    let mut store = Store::open(temp.path()).expect("reopen applied curation store");
    assert_eq!(
        store
            .get_curation_run(&open.run.id)
            .expect("recover applied curation run")
            .status,
        CurationRunStatus::Applied
    );
    assert_eq!(
        store
            .apply_curation(apply)
            .expect("retry applied curation after restart"),
        applied
    );
    assert_eq!(
        store
            .list_operations(&open.assets.project.id, 0, 20, false)
            .expect("list apply operation")
            .1,
        1
    );

    let rollback = rollback_input(&applied);
    let rolled_back = store
        .rollback_curation(rollback.clone())
        .expect("roll back curation");
    assert_eq!(rolled_back.status, CurationRunStatus::RolledBack);
    assert_eq!(rolled_back.run_revision, 2);
    assert_eq!(rolled_back.library_revision, applied.library_revision + 1);
    assert_eq!(rolled_back.restored_unit_count, 2);
    assert_eq!(
        store
            .list_tm_units(&open.assets.library.id, 0, 20)
            .expect("list restored TM units")
            .1,
        2
    );
    assert_eq!(
        store
            .search_tm(&search_request(
                &open.assets.project.id,
                &open.assets.library.id,
                "Do not translate Acme",
            ))
            .expect("search restored dirty unit")
            .1,
        1
    );
    assert!(
        store
            .list_curation_changes(&open.run.id)
            .expect("list restored changes")
            .iter()
            .all(|change| change.restored && change.revision == 1)
    );

    drop(store);
    let mut store = Store::open(temp.path()).expect("reopen rolled-back curation store");
    assert_eq!(
        store
            .rollback_curation(rollback)
            .expect("retry rollback after restart"),
        rolled_back
    );
    let operations = store
        .list_operations(&open.assets.project.id, 0, 20, false)
        .expect("list curation operations");
    assert_eq!(operations.1, 2);
    assert_eq!(
        operations
            .0
            .iter()
            .map(|operation| operation.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["curation.apply", "curation.rollback"]
    );
    let restored_catalog = store
        .list_asset_catalog(&catalog_filter(
            Some(&open.assets.project.id),
            AssetCatalogKind::Tm,
            Some("Do not translate Acme"),
        ))
        .expect("catalog restored unit");
    assert_eq!(restored_catalog.items.len(), 1);
    assert_eq!(
        restored_catalog.items[0].curation_state,
        Some(CurationState::Active)
    );
    assert_eq!(restored_catalog.items[0].quality_score_basis_points, None);
}

#[test]
fn curation_transactions_roll_back_late_failures_and_stale_snapshots() {
    let temp = tempfile::tempdir().expect("temporary atomic curation directory");
    let mut store = Store::open(temp.path()).expect("open atomic curation store");
    let mut assets = seed_assets(&mut store);

    store
        .import_tm_units(
            &assets.library.id,
            &[exchange_unit("A later unit.", "后续单元。", 30)],
        )
        .expect("mutate library after analysis");
    let stale_error = store
        .create_curation_run(create_run_input(&assets))
        .expect_err("reject stale curation snapshot");
    assert!(matches!(
        stale_error,
        StorageError::EntityConflict {
            entity: "tm_library",
            ..
        }
    ));
    let run_count = store
        .connection()
        .query_row("SELECT COUNT(*) FROM curation_runs", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("count stale curation runs");
    assert_eq!(run_count, 0);

    assets.snapshot = store
        .load_curation_snapshot(&assets.project.id, &assets.library.id)
        .expect("reload current curation snapshot");
    assets.library = assets.snapshot.library.clone();
    assets.analysis = analyze(&assets.snapshot.units, &CurationPolicy::default(), &[])
        .expect("reanalyze current curation snapshot");
    store
        .connection()
        .execute_batch(
            "CREATE TEMP TRIGGER fail_curation_finding_insert
             BEFORE INSERT ON curation_findings
             BEGIN SELECT RAISE(ABORT, 'injected curation finding failure'); END;",
        )
        .expect("install run creation failure trigger");
    let create_error = store
        .create_curation_run(create_run_input(&assets))
        .expect_err("roll back failed run creation");
    assert!(matches!(create_error, StorageError::Database(_)));
    let partial_counts = store
        .connection()
        .query_row(
            "SELECT (SELECT COUNT(*) FROM curation_runs),
                    (SELECT COUNT(*) FROM curation_run_units),
                    (SELECT COUNT(*) FROM curation_findings)",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .expect("count rolled-back run rows");
    assert_eq!(partial_counts, (0, 0, 0));
    store
        .connection()
        .execute_batch("DROP TRIGGER fail_curation_finding_insert")
        .expect("remove run creation failure trigger");

    let run = store
        .create_curation_run(create_run_input(&assets))
        .expect("create curation run after failure");
    let selected_finding_id = store
        .list_curation_findings(&run.id, 0, 500)
        .expect("list findings after run retry")
        .0
        .into_iter()
        .find(|finding| {
            finding.unit_id == assets.dirty_unit_id
                && finding.kind == CurationFindingKind::SourceEqualsTarget
        })
        .expect("select finding after run retry")
        .id;
    let open = OpenRun {
        assets,
        run,
        selected_finding_id,
    };
    let apply = apply_input(&open);
    store
        .connection()
        .execute_batch(
            "CREATE TEMP TRIGGER fail_curation_library_update
             BEFORE UPDATE OF revision ON tm_libraries
             BEGIN SELECT RAISE(ABORT, 'injected curation library failure'); END;",
        )
        .expect("install apply failure trigger");
    let apply_error = store
        .apply_curation(apply.clone())
        .expect_err("roll back failed curation apply");
    assert!(matches!(apply_error, StorageError::Database(_)));
    assert_eq!(
        store
            .get_curation_run(&open.run.id)
            .expect("run after failed apply")
            .status,
        CurationRunStatus::Open
    );
    assert_eq!(
        store
            .get_tm_library(&open.assets.library.id)
            .expect("library after failed apply")
            .revision,
        open.assets.library.revision
    );
    assert!(
        store
            .list_curation_changes(&open.run.id)
            .expect("changes after failed apply")
            .is_empty()
    );
    assert_eq!(
        store
            .list_tm_units(&open.assets.library.id, 0, 20)
            .expect("active units after failed apply")
            .1,
        3
    );
    assert_eq!(
        store
            .list_operations(&open.assets.project.id, 0, 20, false)
            .expect("operations after failed apply")
            .1,
        0
    );
    store
        .connection()
        .execute_batch("DROP TRIGGER fail_curation_library_update")
        .expect("remove apply failure trigger");
    let applied = store
        .apply_curation(apply)
        .expect("apply after injected failure");

    let rollback = rollback_input(&applied);
    store
        .connection()
        .execute_batch(
            "CREATE TEMP TRIGGER fail_curation_rollback_terminal
             BEFORE UPDATE OF status ON curation_runs
             WHEN NEW.status = 'rolled_back'
             BEGIN SELECT RAISE(ABORT, 'injected curation rollback failure'); END;",
        )
        .expect("install rollback failure trigger");
    let rollback_error = store
        .rollback_curation(rollback.clone())
        .expect_err("roll back failed curation rollback");
    assert!(matches!(rollback_error, StorageError::Database(_)));
    assert_eq!(
        store
            .get_curation_run(&open.run.id)
            .expect("run after failed rollback")
            .status,
        CurationRunStatus::Applied
    );
    assert_eq!(
        store
            .get_tm_library(&open.assets.library.id)
            .expect("library after failed rollback")
            .revision,
        applied.library_revision
    );
    assert!(
        store
            .list_curation_changes(&open.run.id)
            .expect("changes after failed rollback")
            .iter()
            .all(|change| !change.restored && change.revision == 0)
    );
    assert_eq!(
        store
            .list_operations(&open.assets.project.id, 0, 20, false)
            .expect("operations after failed rollback")
            .1,
        1
    );
    store
        .connection()
        .execute_batch("DROP TRIGGER fail_curation_rollback_terminal")
        .expect("remove rollback failure trigger");
    store
        .rollback_curation(rollback)
        .expect("rollback after injected failure");
}

#[test]
fn asset_catalog_filters_pages_and_reopens_across_all_asset_kinds() {
    let temp = tempfile::tempdir().expect("temporary catalog directory");
    let mut store = Store::open(temp.path()).expect("open catalog store");
    let project = store
        .create_project("Catalog project", "en", "zh", "legal")
        .expect("create catalog project");
    let library = store
        .create_tm_library(NewTmLibrary {
            name: "Catalog TM".to_string(),
            source_locale: "en".to_string(),
            target_locale: "zh".to_string(),
            domain: Some("legal".to_string()),
            writable: true,
            owner_project_id: Some(project.id.clone()),
        })
        .expect("create catalog TM");
    store
        .import_tm_units(
            &library.id,
            &[exchange_unit("Catalog TM source", "目录记忆库译文", 42)],
        )
        .expect("import catalog TM unit");
    let local_original_id = store
        .export_tm_units(&library.id)
        .expect("read catalog TM unit")[0]
        .id
        .clone();

    let other_project = store
        .create_project("Other catalog project", "fr", "de", "general")
        .expect("create other catalog project");
    let other_library = store
        .create_tm_library(NewTmLibrary {
            name: "Other catalog TM".to_string(),
            source_locale: "fr".to_string(),
            target_locale: "de".to_string(),
            domain: Some("general".to_string()),
            writable: true,
            owner_project_id: Some(other_project.id.clone()),
        })
        .expect("create other catalog TM");
    store
        .import_tm_units(
            &other_library.id,
            &[TmExchangeUnit {
                source_locale: "fr".to_string(),
                target_locale: "de".to_string(),
                source_text: "Catalog outside source".to_string(),
                target_text: "Externer Katalogtext".to_string(),
                domain: Some("general".to_string()),
                author: None,
                created_at_ms: Some(42),
                metadata: BTreeMap::new(),
            }],
        )
        .expect("import other catalog TM unit");
    let other_original_id = store
        .export_tm_units(&other_library.id)
        .expect("read other catalog TM unit")[0]
        .id
        .clone();

    store
        .connection()
        .execute(
            "UPDATE tm_units SET origin_project_id = ?1 WHERE id = ?2",
            params![project.id, local_original_id],
        )
        .expect("set local catalog unit provenance");

    let termbase = store
        .create_termbase(NewTermbase {
            name: "Catalog termbase".to_string(),
            source_locale: "en".to_string(),
            domain: Some("legal".to_string()),
            writable: true,
        })
        .expect("create catalog termbase");
    store
        .mount_termbase(&project.id, &termbase.id, 10, true, true, None)
        .expect("mount catalog termbase");
    let term = store
        .upsert_term_entry(NewTermEntry {
            termbase_id: termbase.id.clone(),
            source_locale: "en".to_string(),
            source_term: "Catalog terminology".to_string(),
            part_of_speech: Some("noun".to_string()),
            definition: None,
            example: None,
            domain: Some("legal".to_string()),
            status: TermStatus::Active,
            translations: vec![NewTermTranslation {
                locale: "zh".to_string(),
                term: "目录术语".to_string(),
                preferred: true,
                forbidden: false,
            }],
        })
        .expect("create catalog term");

    let source_bytes = b"catalog reference source";
    let managed_source = store.paths().managed_source("catalog-corpus", "txt");
    fs::write(&managed_source, source_bytes).expect("write catalog corpus source");
    let corpus = store
        .create_reference_corpus(NewReferenceCorpus {
            project_id: project.id.clone(),
            expected_project_revision: project.revision,
            name: "Catalog corpus".to_string(),
            kind: ReferenceCorpusKind::Bilingual,
            source_locale: "en".to_string(),
            target_locale: "zh".to_string(),
            managed_source_path: managed_source,
            input_filter_id: "builtin.txt".to_string(),
            input_format: "txt".to_string(),
            input_sha256: translunar_domain::sha256_hex(source_bytes),
            entries: vec![NewReferenceCorpusEntry {
                ordinal: 0,
                source_text: "Catalog corpus source".to_string(),
                target_text: "目录语料译文".to_string(),
                structural_path: "line:1".to_string(),
                provenance: json!({"filterId": "builtin.txt", "line": 1}),
            }],
            diagnostics: Vec::new(),
            actor: "catalog-test".to_string(),
            reason: "create catalog corpus fixture".to_string(),
            correlation_id: Some("catalog-corpus-test".to_string()),
        })
        .expect("create catalog corpus");
    store
        .connection()
        .execute(
            "UPDATE term_entries SET created_at_ms = 42, updated_at_ms = 42
             WHERE id = ?1",
            [&term.id],
        )
        .expect("stabilize catalog term time");
    store
        .connection()
        .execute(
            "UPDATE reference_corpus_entries
             SET created_at_ms = 42, updated_at_ms = 42 WHERE corpus_id = ?1",
            [&corpus.corpus.id],
        )
        .expect("stabilize catalog corpus time");

    let scoped = store
        .list_asset_catalog(&catalog_filter(
            Some(&project.id),
            AssetCatalogKind::All,
            Some("Catalog"),
        ))
        .expect("list scoped catalog");
    assert_eq!(scoped.total, 3);
    assert_eq!(
        scoped
            .items
            .iter()
            .map(|item| item.kind)
            .collect::<Vec<_>>(),
        vec![
            AssetCatalogKind::Tm,
            AssetCatalogKind::Termbase,
            AssetCatalogKind::Corpus,
        ]
    );

    let global = store
        .list_asset_catalog(&catalog_filter(
            None,
            AssetCatalogKind::All,
            Some("Catalog"),
        ))
        .expect("list complete global catalog");
    assert_eq!(global.total, 4);
    assert!(global.items.iter().any(|item| item.id == other_original_id));
    let mut global_first = catalog_filter(None, AssetCatalogKind::All, Some("Catalog"));
    global_first.limit = 1;
    let first = store
        .list_asset_catalog(&global_first)
        .expect("page first global catalog row");
    assert_eq!(first.total, 4);
    assert_eq!(first.items[0].id, global.items[0].id);
    let mut global_second = global_first.clone();
    global_second.offset = 1;
    let second = store
        .list_asset_catalog(&global_second)
        .expect("page second global catalog row");
    assert_eq!(second.items[0].id, global.items[1].id);

    for kind in [
        AssetCatalogKind::Tm,
        AssetCatalogKind::Termbase,
        AssetCatalogKind::Corpus,
    ] {
        assert_eq!(
            store
                .list_asset_catalog(&catalog_filter(Some(&project.id), kind, Some("Catalog"),))
                .expect("filter catalog kind")
                .total,
            1
        );
    }
    let mut locale = catalog_filter(Some(&project.id), AssetCatalogKind::All, Some("Catalog"));
    locale.source_locale = Some("en".to_string());
    locale.target_locale = Some("zh".to_string());
    locale.domain = Some("legal".to_string());
    assert_eq!(
        store
            .list_asset_catalog(&locale)
            .expect("filter catalog locale and domain")
            .total,
        3
    );
    let mut origin = catalog_filter(Some(&project.id), AssetCatalogKind::All, None);
    origin.origin_project_id = Some(project.id.clone());
    let origin_page = store
        .list_asset_catalog(&origin)
        .expect("filter catalog origin project");
    assert_eq!(origin_page.total, 2);
    assert_eq!(origin_page.items[0].kind, AssetCatalogKind::Tm);
    assert_eq!(origin_page.items[1].kind, AssetCatalogKind::Corpus);
    let terminology = store
        .list_asset_catalog(&catalog_filter(
            Some(&project.id),
            AssetCatalogKind::All,
            Some("terminology"),
        ))
        .expect("query catalog term");
    assert_eq!(terminology.total, 1);
    assert_eq!(terminology.items[0].kind, AssetCatalogKind::Termbase);
    let mut after = catalog_filter(Some(&project.id), AssetCatalogKind::All, Some("Catalog"));
    after.created_after_ms = Some(43);
    assert_eq!(
        store
            .list_asset_catalog(&after)
            .expect("filter catalog created time")
            .total,
        0
    );

    let stable_ids = scoped
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    drop(store);
    let store = Store::open(temp.path()).expect("reopen catalog store");
    let reopened = store
        .list_asset_catalog(&catalog_filter(
            Some(&project.id),
            AssetCatalogKind::All,
            Some("Catalog"),
        ))
        .expect("list reopened catalog");
    assert_eq!(
        reopened
            .items
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>(),
        stable_ids
    );
    assert_eq!(reopened.total, 3);
}
