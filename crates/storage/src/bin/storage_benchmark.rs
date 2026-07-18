use std::error::Error;
use std::fs;
use std::path::Path;
use std::time::Instant;

use rusqlite::{Connection, TransactionBehavior, params};
use serde::Serialize;
use translunar_asset_core::{exact_key, normalize_match_key};
use translunar_domain::sha256_hex;

use translunar_storage::{Store, TmSearchRequest};

const SEGMENT_COUNT: u32 = 100_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkReport {
    segment_count: u32,
    history_count: u32,
    cold_open_ms: u128,
    project_count_ms: u128,
    first_page_ms: u128,
    middle_page_ms: u128,
    last_page_ms: u128,
    history_page_ms: u128,
    tm_unit_count: u32,
    tm_exact_search_ms: u128,
    tm_fuzzy_search_ms: u128,
    peak_rss_kib: Option<u64>,
    retained_directory: Option<String>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let keep = std::env::args().any(|argument| argument == "--keep");
    let root = std::env::temp_dir().join(format!(
        "translunar-storage-benchmark-{}",
        translunar_domain::new_id()
    ));
    fs::create_dir_all(&root)?;

    let result = build_fixture(&root).and_then(|ids| measure(&root, &ids, keep));
    if !keep {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

struct FixtureIds {
    project_id: String,
    document_id: String,
    library_id: String,
}

fn build_fixture(root: &Path) -> Result<FixtureIds, Box<dyn Error>> {
    let mut store = Store::open(root)?;
    let project = store.create_project("100k benchmark", "en-US", "zh-CN", "benchmark")?;
    let library_id = store
        .list_tm_libraries(Some(&project.id), 0, 1)?
        .0
        .remove(0)
        .id;
    let document_id = "benchmark-document";
    let source = root.join("sources").join("benchmark.source");
    fs::write(&source, b"deterministic benchmark source")?;
    let digest = sha256_hex(fs::read(&source)?);
    drop(store);

    let mut connection = Connection::open(root.join("translunar.sqlite3"))?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute(
        "INSERT INTO documents (
            id, project_id, name, relative_path, format, filter_id, source_sha256,
            original_source_path, managed_source_path, current_version, status,
            revision, segment_count, degradation_json, imported_at_ms, updated_at_ms
         ) VALUES (?1, ?2, 'benchmark.source', 'benchmark.source', 'text',
                   'benchmark.text', ?3, ?4, 'sources/benchmark.source', 1,
                   'active', 0, ?5, '[]', 1, 1)",
        params![
            document_id,
            project.id,
            digest,
            root.join("benchmark-input.source").to_string_lossy(),
            i64::from(SEGMENT_COUNT),
        ],
    )?;
    transaction.execute(
        "INSERT INTO document_versions (
            id, document_id, version, source_sha256, original_source_path,
            managed_source_path, reason, created_at_ms
         ) VALUES ('benchmark-version', ?1, 1, ?2, ?3,
                   'sources/benchmark.source', 'benchmark', 1)",
        params![
            document_id,
            digest,
            root.join("benchmark-input.source").to_string_lossy(),
        ],
    )?;
    {
        let mut segments = transaction.prepare(
            "INSERT INTO segments (
                id, document_id, ordinal, structural_path, source_text, target_text,
                state, revision, source_hash, context_hash, updated_at_ms,
                document_version_id, source_version
             ) VALUES (?1, ?2, ?3, ?4, ?5, '', 'untranslated', 0,
                       'benchmark-source-hash', 'benchmark-context-hash', ?6,
                       'benchmark-version', 1)",
        )?;
        let mut operations = transaction.prepare(
            "INSERT INTO operations (
                id, project_id, sequence, entity_type, entity_id, kind,
                base_revision, result_revision, actor, correlation_id,
                before_json, after_json, created_at_ms
             ) VALUES (?1, ?2, ?3, 'segment', ?4, 'segment.update_target',
                       0, 1, 'benchmark', NULL, NULL, NULL, ?5)",
        )?;
        let mut tm_units = transaction.prepare(
            "INSERT INTO tm_units (
                id, library_id, source_locale, target_locale, source_text,
                target_text, source_hash, source_key, target_hash, domain,
                origin_project_id, origin_document_id, origin_segment_id,
                context_before_hash, context_after_hash, author, metadata_json,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'en-US', 'zh-CN', ?3, ?4, ?5, ?6, ?7,
                       'benchmark', NULL, NULL, NULL, NULL, NULL, 'benchmark',
                       '{}', ?8, ?8)",
        )?;
        for ordinal in 0..SEGMENT_COUNT {
            let segment_id = format!("benchmark-segment-{ordinal:06}");
            let source_text = format!("Benchmark source segment {ordinal:06}");
            let structural_path = format!("benchmark:{ordinal}");
            segments.execute(params![
                segment_id,
                document_id,
                i64::from(ordinal),
                structural_path,
                source_text,
                i64::from(ordinal) + 1,
            ])?;
            let operation_id = format!("benchmark-operation-{ordinal:06}");
            operations.execute(params![
                operation_id,
                project.id,
                i64::from(ordinal) + 1,
                segment_id,
                i64::from(ordinal) + 1,
            ])?;
            let key = alpha_key(ordinal);
            let tm_source = format!("Benchmark TM source {key}");
            let tm_target = format!("基准翻译 {key}");
            tm_units.execute(params![
                format!("benchmark-tm-unit-{ordinal:06}"),
                library_id,
                tm_source,
                tm_target,
                sha256_hex(normalize_match_key(&tm_source).as_bytes()),
                exact_key(&tm_source),
                sha256_hex(normalize_match_key(&tm_target).as_bytes()),
                i64::from(ordinal) + 1,
            ])?;
        }
    }
    transaction.commit()?;
    Ok(FixtureIds {
        project_id: project.id,
        document_id: document_id.to_string(),
        library_id,
    })
}

fn measure(root: &Path, ids: &FixtureIds, keep: bool) -> Result<(), Box<dyn Error>> {
    let started = Instant::now();
    let store = Store::open(root)?;
    let cold_open_ms = started.elapsed().as_millis();

    let started = Instant::now();
    let aggregate = store.get_project(&ids.project_id)?;
    let project_count_ms = started.elapsed().as_millis();
    if aggregate.counts.total != SEGMENT_COUNT {
        return Err(format!(
            "expected {SEGMENT_COUNT} segments, got {}",
            aggregate.counts.total
        )
        .into());
    }

    let started = Instant::now();
    let first = store.list_segments(&ids.document_id, 0, 100)?;
    let first_page_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let middle = store.list_segments(&ids.document_id, 49_950, 100)?;
    let middle_page_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let last = store.list_segments(&ids.document_id, 99_900, 100)?;
    let last_page_ms = started.elapsed().as_millis();
    if first.0.len() != 100 || middle.0.len() != 100 || last.0.len() != 100 {
        return Err("segment pages did not return 100 rows".into());
    }

    let started = Instant::now();
    let history = store.list_operations(&ids.project_id, 49_950, 100, true)?;
    let history_page_ms = started.elapsed().as_millis();
    if history.0.len() != 100 || history.1 != SEGMENT_COUNT {
        return Err("history page/count mismatch".into());
    }

    let (_, tm_unit_count) = store.list_tm_units(&ids.library_id, 0, 1)?;
    if tm_unit_count != SEGMENT_COUNT {
        return Err(format!("expected {SEGMENT_COUNT} TM units, got {tm_unit_count}").into());
    }
    let exact_query = format!("Benchmark TM source {}", alpha_key(SEGMENT_COUNT - 1));
    let started = Instant::now();
    let exact = store.search_tm(&TmSearchRequest {
        project_id: ids.project_id.clone(),
        source_locale: "en-US".to_string(),
        target_locale: "zh-CN".to_string(),
        query: exact_query.clone(),
        threshold: 100,
        offset: 0,
        limit: 50,
        library_ids: vec![ids.library_id.clone()],
        domain: Some("benchmark".to_string()),
        since_ms: None,
        origin_project_id: None,
        origin_document_id: None,
        context_before_hash: None,
        context_after_hash: None,
    })?;
    let tm_exact_search_ms = started.elapsed().as_millis();
    if exact.0.first().map(|item| item.unit.source_text.as_str()) != Some(exact_query.as_str()) {
        return Err("exact TM search did not return the requested unit first".into());
    }
    let started = Instant::now();
    let fuzzy = store.search_tm(&TmSearchRequest {
        project_id: ids.project_id.clone(),
        source_locale: "en-US".to_string(),
        target_locale: "zh-CN".to_string(),
        query: format!("{exact_query} revised"),
        threshold: 60,
        offset: 0,
        limit: 50,
        library_ids: vec![ids.library_id.clone()],
        domain: Some("benchmark".to_string()),
        since_ms: None,
        origin_project_id: None,
        origin_document_id: None,
        context_before_hash: None,
        context_after_hash: None,
    })?;
    let tm_fuzzy_search_ms = started.elapsed().as_millis();
    if fuzzy.0.is_empty() {
        return Err("fuzzy TM search returned no bounded results".into());
    }

    let report = BenchmarkReport {
        segment_count: aggregate.counts.total,
        history_count: history.1,
        cold_open_ms,
        project_count_ms,
        first_page_ms,
        middle_page_ms,
        last_page_ms,
        history_page_ms,
        tm_unit_count,
        tm_exact_search_ms,
        tm_fuzzy_search_ms,
        peak_rss_kib: peak_rss_kib(),
        retained_directory: keep.then(|| root.to_string_lossy().into_owned()),
    };
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn alpha_key(mut value: u32) -> String {
    let mut characters = ['a'; 5];
    for character in characters.iter_mut().rev() {
        *character = char::from_u32(u32::from(b'a') + value % 26).unwrap_or('a');
        value /= 26;
    }
    characters.into_iter().collect()
}

fn peak_rss_kib() -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line.strip_prefix("VmHWM:")?.trim();
        value.split_whitespace().next()?.parse().ok()
    })
}
