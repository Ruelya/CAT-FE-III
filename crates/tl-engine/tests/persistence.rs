//! Persistence-focused integration tests for the SQLite store: real
//! process-kill crash safety and TM behavior at a scale the old whole-state
//! JSON store could not handle.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tl_engine::Engine;
use tl_protocol::RpcRequest;

fn call(engine: &mut Engine, method: &str, params: Value) -> Value {
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
    response.result.expect("result")
}

/// SIGKILL the real engine binary right after a write is acknowledged: no
/// destructors, no WAL checkpoint, no clean shutdown. Reopening the data
/// directory must recover every acknowledged write.
#[test]
fn sigkilled_engine_keeps_every_acknowledged_write() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let data_dir = workspace.path().join("data");
    let mut child = Command::new(env!("CARGO_BIN_EXE_tl-engine"))
        .arg("--data-dir")
        .arg(&data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn engine binary");
    let mut stdin = child.stdin.take().expect("engine stdin");
    let mut reader = BufReader::new(child.stdout.take().expect("engine stdout"));

    // The ready notification arrives first.
    let mut line = String::new();
    reader.read_line(&mut line).expect("read ready frame");
    assert!(
        line.contains("notify.engine.ready"),
        "unexpected first frame: {line}"
    );

    let request = json!({
        "id": 1,
        "method": "project.create",
        "params": {"name": "CrashSafe", "sourceLocale": "en-US", "targetLocale": "zh-CN"},
    });
    writeln!(stdin, "{request}").expect("write request");
    stdin.flush().expect("flush request");

    // Wait for the acknowledgement so the write is committed, skipping any
    // interleaved notifications.
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        assert!(Instant::now() < deadline, "engine response timed out");
        let mut line = String::new();
        let read = reader.read_line(&mut line).expect("read frame");
        assert!(read > 0, "engine closed stdout before responding");
        let frame: Value = serde_json::from_str(&line).expect("parse frame");
        if frame["id"] == 1 {
            assert!(
                frame["result"]["id"].is_string(),
                "project.create failed: {frame}"
            );
            break;
        }
    }

    child.kill().expect("SIGKILL engine");
    child.wait().expect("reap engine");

    let mut engine = Engine::open(&data_dir).expect("reopen data dir after kill");
    let listed = call(&mut engine, "project.list", json!({}));
    let projects = listed["projects"].as_array().expect("projects");
    assert_eq!(projects.len(), 1, "acknowledged project survives the kill");
    assert_eq!(projects[0]["name"], "CrashSafe");
}

/// Distinct alphabetic token per entry. Match scoring normalizes digits
/// away, so digit-only variation would make every entry a 100% fuzzy match
/// of every other; letters keep the corpus honestly distinct.
fn alpha_token(index: usize) -> String {
    let mut token = String::new();
    let mut value = index;
    for _ in 0..4 {
        token.push(char::from(b'a' + (value % 26) as u8));
        value /= 26;
    }
    token
}

/// 50k-entry TM import: an insert pass, an update pass over the same
/// sources, a restart, and an exact lookup. The old store linear-scanned
/// the whole TM table for every upsert (~1.25 billion comparisons for this
/// shape) and rewrote all state as one JSON file per import; the time
/// bounds are generous for debug builds but sit far below what that
/// behavior would need.
#[test]
fn tm_import_scales_to_fifty_thousand_entries() {
    const ENTRIES: usize = 50_000;
    let workspace = tempfile::tempdir().expect("tempdir");
    let data_dir = workspace.path().join("data");
    let mut engine = Engine::open(&data_dir).expect("open engine");
    let project = call(
        &mut engine,
        "project.create",
        json!({"name": "Scale", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let project_id = project["id"].as_str().expect("project id").to_string();

    let mut csv = String::from("source,target\n");
    for index in 0..ENTRIES {
        let token = alpha_token(index);
        csv.push_str(&format!(
            "Clause {token} of the master agreement remains binding.,条款 {token} 仍然有效。\n"
        ));
    }
    let insert_path = workspace.path().join("tm-insert.csv");
    std::fs::write(&insert_path, &csv).expect("write insert fixture");

    let started = Instant::now();
    let imported = call(
        &mut engine,
        "tm.import",
        json!({"projectId": project_id, "path": insert_path.display().to_string()}),
    );
    let insert_elapsed = started.elapsed();
    assert_eq!(imported["imported"].as_u64(), Some(ENTRIES as u64));
    assert_eq!(imported["added"].as_u64(), Some(ENTRIES as u64));
    assert_eq!(imported["updated"].as_u64(), Some(0));
    assert!(
        insert_elapsed < Duration::from_secs(120),
        "insert pass took {insert_elapsed:?}"
    );

    // Update pass: same sources, new targets, so every row goes through the
    // upsert-existing path that used to be the linear scan.
    let mut updated_csv = String::from("source,target\n");
    for index in 0..ENTRIES {
        let token = alpha_token(index);
        updated_csv.push_str(&format!(
            "Clause {token} of the master agreement remains binding.,条款 {token} 已修订。\n"
        ));
    }
    let update_path = workspace.path().join("tm-update.csv");
    std::fs::write(&update_path, &updated_csv).expect("write update fixture");

    let started = Instant::now();
    let reimported = call(
        &mut engine,
        "tm.import",
        json!({"projectId": project_id, "path": update_path.display().to_string()}),
    );
    let update_elapsed = started.elapsed();
    assert_eq!(reimported["added"].as_u64(), Some(0));
    assert_eq!(reimported["updated"].as_u64(), Some(ENTRIES as u64));
    assert!(
        update_elapsed < Duration::from_secs(120),
        "update pass took {update_elapsed:?}"
    );

    // Restart: rows and the exact index survive, nothing is duplicated.
    drop(engine);
    let started = Instant::now();
    let mut engine = Engine::open(&data_dir).expect("reopen engine");
    let reopen_elapsed = started.elapsed();
    assert!(
        reopen_elapsed < Duration::from_secs(60),
        "reopen took {reopen_elapsed:?}"
    );

    let probe = alpha_token(31_415);
    let lookup = call(
        &mut engine,
        "tm.lookup",
        json!({
            "projectId": project_id,
            "sourceText": format!("Clause {probe} of the master agreement remains binding."),
            "minScore": 100,
        }),
    );
    let matches = lookup["matches"].as_array().expect("matches");
    assert_eq!(matches.len(), 1, "exactly one exact match after restart");
    assert_eq!(matches[0]["score"].as_u64(), Some(100));
    assert_eq!(
        matches[0]["entry"]["targetText"],
        format!("条款 {probe} 已修订。")
    );

    // Paged listing after the restart: one 50-row window plus the total.
    // The engine no longer holds a TM map at all (open() only streams the
    // fuzzy-index seed), so this window is the only row transfer — a full
    // in-RAM clone of 50k entries is not something this path can do anymore.
    let started = Instant::now();
    let page = call(
        &mut engine,
        "tm.list",
        json!({"projectId": project_id, "limit": 50}),
    );
    let page_elapsed = started.elapsed();
    assert_eq!(page["entries"].as_array().expect("entries").len(), 50);
    assert_eq!(page["totalEntries"].as_u64(), Some(ENTRIES as u64));
    assert!(
        page_elapsed < Duration::from_secs(5),
        "one 50-row page took {page_elapsed:?}"
    );

    // A window straddling the tail clips to the remaining rows.
    let deep = call(
        &mut engine,
        "tm.list",
        json!({"projectId": project_id, "offset": ENTRIES - 25, "limit": 100}),
    );
    assert_eq!(deep["entries"].as_array().expect("entries").len(), 25);

    let export_path = workspace.path().join("tm-roundtrip.csv");
    let exported = call(
        &mut engine,
        "tm.export",
        json!({"projectId": project_id, "path": export_path.display().to_string()}),
    );
    assert_eq!(
        exported["exported"].as_u64(),
        Some(ENTRIES as u64),
        "every entry exists exactly once after both passes and a restart"
    );
}
