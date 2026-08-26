//! End-to-end RPC tests for the fuzzy TM, termbase, pretranslation, QA, and
//! SRX segmentation surfaces added on top of the phase-1 vertical slice.

use serde_json::{Value, json};
use tl_engine::Engine;
use tl_protocol::{RpcRequest, RpcResponse};

struct Harness {
    engine: Engine,
    directory: tempfile::TempDir,
    next_id: u64,
}

impl Harness {
    fn new() -> Self {
        let directory = tempfile::tempdir().expect("tempdir");
        let engine = Engine::open(&directory.path().join("data")).expect("open engine");
        Self {
            engine,
            directory,
            next_id: 1,
        }
    }

    fn reopen(&mut self) {
        self.engine = Engine::open(&self.directory.path().join("data")).expect("reopen engine");
    }

    fn raw(&mut self, method: &str, params: Value) -> RpcResponse {
        let id = self.next_id;
        self.next_id += 1;
        self.engine.handle(
            RpcRequest {
                id,
                method: method.to_string(),
                params,
            },
            &mut |_notification| {},
        )
    }

    fn call(&mut self, method: &str, params: Value) -> Value {
        let response = self.raw(method, params);
        assert!(
            response.error.is_none(),
            "{method} failed: {:?}",
            response.error
        );
        response.result.expect("result")
    }

    fn call_err(&mut self, method: &str, params: Value) -> String {
        let response = self.raw(method, params);
        let error = response
            .error
            .unwrap_or_else(|| panic!("{method} unexpectedly succeeded: {:?}", response.result));
        serde_json::to_value(error.code)
            .expect("code")
            .as_str()
            .expect("code string")
            .to_string()
    }

    fn write_file(&self, name: &str, contents: &str) -> String {
        let path = self.directory.path().join(name);
        std::fs::write(&path, contents).expect("write fixture");
        path.display().to_string()
    }

    fn path_of(&self, name: &str) -> String {
        self.directory.path().join(name).display().to_string()
    }

    fn create_project(&mut self) -> String {
        let project = self.call(
            "project.create",
            json!({ "name": "Test", "sourceLocale": "en-US", "targetLocale": "zh-CN" }),
        );
        project["id"].as_str().expect("project id").to_string()
    }

    fn import_txt(&mut self, project_id: &str, name: &str, contents: &str) -> String {
        let path = self.write_file(name, contents);
        let imported = self.call(
            "document.import",
            json!({ "projectId": project_id, "sourcePath": path }),
        );
        imported["document"]["id"]
            .as_str()
            .expect("document id")
            .to_string()
    }

    fn segments(&mut self, document_id: &str) -> Vec<Value> {
        self.call("segment.list", json!({ "documentId": document_id }))["segments"]
            .as_array()
            .expect("segments")
            .clone()
    }

    fn set_target(&mut self, segment: &Value, target: &str) -> Value {
        self.call(
            "segment.update",
            json!({
                "segmentId": segment["id"],
                "targetText": target,
                "baseRevision": segment["revision"],
            }),
        )["segment"]
            .clone()
    }

    fn confirm(&mut self, segment: &Value) -> Value {
        self.call(
            "segment.confirm",
            json!({ "segmentId": segment["id"], "baseRevision": segment["revision"] }),
        )
    }

    fn lock(&mut self, segment: &Value, locked: bool) -> Value {
        self.call(
            "segment.lock",
            json!({
                "segmentId": segment["id"],
                "locked": locked,
                "baseRevision": segment["revision"],
            }),
        )["segment"]
            .clone()
    }
}

#[test]
fn project_update_edits_name_and_language_pair_while_empty() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    // Rename plus a full language-pair change on an asset-free project.
    let updated = harness.call(
        "project.update",
        json!({
            "projectId": project_id,
            "name": "  Renamed  ",
            "sourceLocale": "de-DE",
            "targetLocale": "fr-FR",
        }),
    );
    assert_eq!(updated["name"], "Renamed");
    assert_eq!(updated["sourceLocale"], "de-DE");
    assert_eq!(updated["targetLocale"], "fr-FR");
    assert_eq!(updated["revision"], 2);

    // Omitted fields stay unchanged; identical values do not bump revision.
    let same = harness.call(
        "project.update",
        json!({ "projectId": project_id, "name": "Renamed" }),
    );
    assert_eq!(same["revision"], 2);
    assert_eq!(same["sourceLocale"], "de-DE");

    // Provided-but-empty fields are rejected, as is an unknown project.
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({ "projectId": project_id, "name": "   " }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({ "projectId": project_id, "sourceLocale": "" }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err("project.update", json!({ "projectId": "missing" })),
        "notFound"
    );

    // The update survives an engine restart through state.json.
    harness.reopen();
    let reloaded = harness.call("project.get", json!({ "projectId": project_id }));
    assert_eq!(reloaded["name"], "Renamed");
    assert_eq!(reloaded["sourceLocale"], "de-DE");
    assert_eq!(reloaded["targetLocale"], "fr-FR");
}

#[test]
fn project_update_rejects_language_change_once_assets_exist() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    // An attached termbase alone pins the pair; detaching unpins it.
    let termbase = harness.call(
        "termbase.create",
        json!({ "name": "Pinning", "sourceLocale": "en-US" }),
    );
    let termbase_id = termbase["id"].as_str().expect("termbase id").to_string();
    harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({ "projectId": project_id, "targetLocale": "fr-FR" }),
        ),
        "conflict"
    );
    harness.call(
        "termbase.detach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    let updated = harness.call(
        "project.update",
        json!({ "projectId": project_id, "targetLocale": "fr-FR" }),
    );
    assert_eq!(updated["targetLocale"], "fr-FR");

    // Imported documents and TM entries pin the pair for good (no removal
    // methods exist), but renaming stays allowed.
    harness.import_txt(&project_id, "pin.txt", "Pinned content.\n");
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({ "projectId": project_id, "targetLocale": "ja-JP" }),
        ),
        "conflict"
    );
    // Re-asserting the current pair is a no-op, not a conflict.
    let unchanged = harness.call(
        "project.update",
        json!({
            "projectId": project_id,
            "name": "Still editable",
            "sourceLocale": "en-US",
            "targetLocale": "fr-FR",
        }),
    );
    assert_eq!(unchanged["name"], "Still editable");
    assert_eq!(unchanged["targetLocale"], "fr-FR");
}

/// A custom SRX whose no-break rule keeps "Alpha. Beta." together, so a
/// sentence import that really used it yields 2 segments where the built-in
/// rules would yield 3.
const CUSTOM_SRX: &str = r#"<srx version="2.0"><header/><body>
  <languagerules><languagerule languagerulename="custom" languagepattern="en.*">
    <rule break="no"><beforebreak>Alpha\.</beforebreak><afterbreak>\s</afterbreak></rule>
    <rule break="yes"><beforebreak>\.</beforebreak><afterbreak>\s</afterbreak></rule>
  </languagerule></languagerules>
  <maprules><maprule languagerulename="custom" languagepattern="en.*"/></maprules>
</body></srx>"#;

#[test]
fn project_update_persists_import_defaults_used_by_import() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    // Paragraph becomes the stored default and applies to an import that
    // sends no segmentation params at all.
    let updated = harness.call(
        "project.update",
        json!({ "projectId": project_id, "segmentation": "paragraph" }),
    );
    assert_eq!(updated["configuration"]["segmentation"], "paragraph");
    assert_eq!(updated["revision"], 2);
    let paragraph_source = harness.write_file("default-para.txt", "One. Two. Three.\n");
    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": paragraph_source }),
    );
    assert_eq!(imported["segmentCount"], 1, "stored paragraph default");

    // Sentence + a stored SRX default: the next bare import segments with
    // the custom ruleset (2 segments, not the built-in 3).
    let srx_path = harness.write_file("default.srx", CUSTOM_SRX);
    let updated = harness.call(
        "project.update",
        json!({
            "projectId": project_id,
            "segmentation": "sentence",
            "srxPath": srx_path,
        }),
    );
    assert_eq!(updated["configuration"]["segmentation"], "sentence");
    assert_eq!(updated["configuration"]["srxPath"], json!(srx_path));
    let sentence_source = harness.write_file("default-srx.txt", "Alpha. Beta. Gamma.\n");
    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": sentence_source }),
    );
    assert_eq!(imported["segmentCount"], 2, "stored SRX default");

    // Explicit params override the stored default: paragraph keeps the line
    // whole, and an explicit sentence choice with no srxPath means the
    // built-in rules, not the stored default.
    let explicit_para = harness.write_file("explicit-para.txt", "Alpha. Beta. Gamma.\n");
    let imported = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": explicit_para,
            "segmentation": "paragraph",
        }),
    );
    assert_eq!(imported["segmentCount"], 1, "explicit paragraph override");
    let explicit_builtin = harness.write_file("explicit-builtin.txt", "Alpha. Beta. Gamma.\n");
    let imported = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": explicit_builtin,
            "segmentation": "sentence",
        }),
    );
    assert_eq!(imported["segmentCount"], 3, "explicit sentence = built-in");

    // Switching the default to paragraph keeps the stored SRX (ignored, not
    // lost), so switching back to sentence restores it.
    let updated = harness.call(
        "project.update",
        json!({ "projectId": project_id, "segmentation": "paragraph" }),
    );
    assert_eq!(updated["configuration"]["srxPath"], json!(srx_path));
    let para_again = harness.write_file("para-again.txt", "Alpha. Beta. Gamma.\n");
    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": para_again }),
    );
    assert_eq!(imported["segmentCount"], 1, "paragraph ignores stored SRX");
    harness.call(
        "project.update",
        json!({ "projectId": project_id, "segmentation": "sentence" }),
    );
    let sentence_again = harness.write_file("sentence-again.txt", "Alpha. Beta. Gamma.\n");
    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": sentence_again }),
    );
    assert_eq!(imported["segmentCount"], 2, "stored SRX restored");

    // clearSrxPath resets to the built-in rules.
    let updated = harness.call(
        "project.update",
        json!({ "projectId": project_id, "clearSrxPath": true }),
    );
    assert_eq!(updated["configuration"]["srxPath"], Value::Null);
    let cleared = harness.write_file("cleared.txt", "Alpha. Beta. Gamma.\n");
    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": cleared }),
    );
    assert_eq!(imported["segmentCount"], 3, "cleared default = built-in");

    // The defaults survive an engine restart through the store.
    harness.call(
        "project.update",
        json!({ "projectId": project_id, "srxPath": srx_path }),
    );
    harness.reopen();
    let reloaded = harness.call("project.get", json!({ "projectId": project_id }));
    assert_eq!(reloaded["configuration"]["segmentation"], "sentence");
    assert_eq!(reloaded["configuration"]["srxPath"], json!(srx_path));
}

#[test]
fn project_update_validates_import_defaults_and_import_fails_honestly() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    // Unknown modes and contradictory SRX instructions are invalid.
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({ "projectId": project_id, "segmentation": "words" }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({
                "projectId": project_id,
                "srxPath": "/tmp/rules.srx",
                "clearSrxPath": true,
            }),
        ),
        "invalidParams"
    );

    // An SRX default is rejected while the effective segmentation default is
    // paragraph — whether both arrive together or the paragraph default was
    // stored earlier.
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({
                "projectId": project_id,
                "segmentation": "paragraph",
                "srxPath": "/tmp/rules.srx",
            }),
        ),
        "invalidParams"
    );
    harness.call(
        "project.update",
        json!({ "projectId": project_id, "segmentation": "paragraph" }),
    );
    assert_eq!(
        harness.call_err(
            "project.update",
            json!({ "projectId": project_id, "srxPath": "/tmp/rules.srx" }),
        ),
        "invalidParams"
    );

    // Empty strings mean "keep the current defaults" and do not bump the
    // revision.
    let before = harness.call("project.get", json!({ "projectId": project_id }));
    let same = harness.call(
        "project.update",
        json!({ "projectId": project_id, "segmentation": "", "srxPath": "  " }),
    );
    assert_eq!(same["revision"], before["revision"]);
    assert_eq!(same["configuration"]["segmentation"], "paragraph");

    // Saving only stores the path: a missing SRX file is accepted here and
    // fails honestly at import time instead.
    let missing_srx = harness.path_of("gone.srx");
    let updated = harness.call(
        "project.update",
        json!({
            "projectId": project_id,
            "segmentation": "sentence",
            "srxPath": missing_srx,
        }),
    );
    assert_eq!(updated["configuration"]["srxPath"], json!(missing_srx));
    let source = harness.write_file("honest.txt", "Alpha. Beta. Gamma.\n");
    assert_eq!(
        harness.call_err(
            "document.import",
            json!({ "projectId": project_id, "sourcePath": source }),
        ),
        "notFound"
    );

    // Explicit params keep working around the broken default: sentence with
    // the built-in rules, or paragraph mode. Paragraph with an SRX is the
    // same contradiction as in project.update.
    let imported = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": source,
            "segmentation": "sentence",
        }),
    );
    assert_eq!(imported["segmentCount"], 3);
    assert_eq!(
        harness.call_err(
            "document.import",
            json!({
                "projectId": project_id,
                "sourcePath": source,
                "segmentation": "paragraph",
                "srxPath": missing_srx,
            }),
        ),
        "invalidParams"
    );
}

#[test]
fn project_archive_stamps_and_clears_archived_at() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    let archived = harness.call("project.archive", json!({ "projectId": project_id }));
    assert_eq!(archived["lifecycle"], "archived");
    assert!(archived["archivedAtMs"].as_i64().expect("stamp") > 0);
    assert_eq!(archived["revision"], 2);

    // Idempotent: archiving again changes nothing.
    let again = harness.call(
        "project.archive",
        json!({ "projectId": project_id, "archived": true }),
    );
    assert_eq!(again["revision"], 2);

    // The lifecycle survives a restart.
    harness.reopen();
    let reloaded = harness.call("project.get", json!({ "projectId": project_id }));
    assert_eq!(reloaded["lifecycle"], "archived");
    assert!(reloaded["archivedAtMs"].is_i64());

    // Restore clears the stamp.
    let restored = harness.call(
        "project.archive",
        json!({ "projectId": project_id, "archived": false }),
    );
    assert_eq!(restored["lifecycle"], "active");
    assert!(restored["archivedAtMs"].is_null());
    assert_eq!(restored["revision"], 3);

    assert_eq!(
        harness.call_err("project.archive", json!({ "projectId": "missing" })),
        "notFound"
    );
}

#[test]
fn termbase_detach_removes_mount_and_compacts_priorities() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let mut termbase_ids = Vec::new();
    for name in ["First", "Second"] {
        let termbase = harness.call(
            "termbase.create",
            json!({ "name": name, "sourceLocale": "en-US" }),
        );
        let id = termbase["id"].as_str().expect("termbase id").to_string();
        harness.call(
            "termbase.attach",
            json!({ "projectId": project_id, "termbaseId": id }),
        );
        termbase_ids.push(id);
    }
    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_ids[0],
            "sourceTerm": "actuator",
            "targetTerm": "执行器",
            "targetLocale": "zh-CN",
        }),
    );
    let hits = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "Check the actuator." }),
    );
    assert_eq!(hits["matches"].as_array().expect("matches").len(), 1);

    // Detach the priority-0 mount: the survivor compacts to priority 0 and
    // the entries stop hitting term.lookup.
    let detached = harness.call(
        "termbase.detach",
        json!({ "projectId": project_id, "termbaseId": termbase_ids[0] }),
    );
    assert_eq!(detached["mount"]["termbaseId"], termbase_ids[0].as_str());
    let listed = harness.call("termbase.list", json!({ "projectId": project_id }));
    let mounts = listed["mounts"].as_array().expect("mounts");
    assert_eq!(mounts.len(), 1);
    assert_eq!(mounts[0]["termbaseId"], termbase_ids[1].as_str());
    assert_eq!(mounts[0]["priority"], 0);
    let hits = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "Check the actuator." }),
    );
    assert_eq!(hits["matches"].as_array().expect("matches").len(), 0);

    // The next attach lands on priority 1 without colliding.
    let reattached = harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_ids[0] }),
    );
    assert_eq!(reattached["mount"]["priority"], 1);

    // Detaching an unattached termbase is an honest notFound, and both ids
    // are validated. The termbase itself is never deleted by a detach.
    let stray = harness.call(
        "termbase.create",
        json!({ "name": "Stray", "sourceLocale": "en-US" }),
    );
    assert_eq!(
        harness.call_err(
            "termbase.detach",
            json!({ "projectId": project_id, "termbaseId": stray["id"] }),
        ),
        "notFound"
    );
    assert_eq!(
        harness.call_err(
            "termbase.detach",
            json!({ "projectId": "missing", "termbaseId": termbase_ids[0] }),
        ),
        "notFound"
    );
    let listed = harness.call("termbase.list", json!({ "projectId": project_id }));
    assert_eq!(listed["termbases"].as_array().expect("termbases").len(), 3);

    // Mount removal persists across a restart.
    harness.reopen();
    let listed = harness.call("termbase.list", json!({ "projectId": project_id }));
    let mounts = listed["mounts"].as_array().expect("mounts");
    assert_eq!(mounts.len(), 2);
}

#[test]
fn fuzzy_tm_lookup_recalls_and_reranks() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "source.txt",
        "The retention period is 30 days.\n\nCats enjoy sleeping in warm sunlight.\n",
    );
    let segments = harness.segments(&document_id);
    let updated = harness.set_target(&segments[0], "保留期为 30 天。");
    harness.confirm(&updated);

    // Identical text: exact grade at score 100.
    let exact = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The retention period is 30 days." }),
    );
    assert_eq!(exact["matches"][0]["grade"], "exact");
    assert_eq!(exact["matches"][0]["score"], 100);
    assert_eq!(exact["totalMatches"], 1);

    // Number-only difference: recalled as fuzzy, never claimed exact.
    let fuzzy = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The retention period is 45 days." }),
    );
    assert_eq!(fuzzy["matches"][0]["grade"], "fuzzy");
    assert_eq!(fuzzy["matches"][0]["score"], 100);

    // Paraphrase: fuzzy with a mid-range score above the floor.
    let paraphrase = harness.call(
        "tm.lookup",
        json!({
            "projectId": project_id,
            "sourceText": "The retention time is 30 days.",
            "minScore": 60,
        }),
    );
    assert_eq!(paraphrase["matches"][0]["grade"], "fuzzy");
    let score = paraphrase["matches"][0]["score"].as_u64().expect("score");
    assert!((60..100).contains(&score), "unexpected score {score}");

    // Unrelated text stays out.
    let unrelated = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "totally different topic" }),
    );
    assert_eq!(unrelated["totalMatches"], 0);

    // Parameter validation is explicit.
    assert_eq!(
        harness.call_err(
            "tm.lookup",
            json!({ "projectId": project_id, "sourceText": "x", "minScore": 0 }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "tm.lookup",
            json!({ "projectId": project_id, "sourceText": "x", "limit": 0 }),
        ),
        "invalidParams"
    );

    // The fuzzy index survives an engine restart.
    harness.reopen();
    let after_restart = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The retention period is 45 days." }),
    );
    assert_eq!(after_restart["matches"][0]["grade"], "fuzzy");
}

/// Both list surfaces page from SQL: stable windows, totals independent of
/// the window, and identical answers after a restart (so nothing depended
/// on rows hydrated at open).
#[test]
fn segment_and_tm_lists_page_from_sql() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "paged.txt",
        "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\nSix.\n",
    );

    // Omitting the window keeps the pre-paging behavior: the whole document.
    let full = harness.call("segment.list", json!({ "documentId": document_id }));
    assert_eq!(full["totalSegments"], 6);
    assert_eq!(full["segments"].as_array().expect("segments").len(), 6);

    // A middle window in grid order, with the total unaffected.
    let page = harness.call(
        "segment.list",
        json!({ "documentId": document_id, "offset": 2, "limit": 2 }),
    );
    let rows = page["segments"].as_array().expect("segments");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["sourceText"], "Three.");
    assert_eq!(rows[1]["sourceText"], "Four.");
    assert_eq!(page["totalSegments"], 6);

    // Overhang clips, past-the-end is empty, and limit 0 is rejected.
    let tail = harness.call(
        "segment.list",
        json!({ "documentId": document_id, "offset": 4, "limit": 10 }),
    );
    assert_eq!(tail["segments"].as_array().expect("segments").len(), 2);
    let past = harness.call(
        "segment.list",
        json!({ "documentId": document_id, "offset": 10, "limit": 2 }),
    );
    assert_eq!(past["segments"].as_array().expect("segments").len(), 0);
    assert_eq!(past["totalSegments"], 6);
    assert_eq!(
        harness.call_err(
            "segment.list",
            json!({ "documentId": document_id, "limit": 0 }),
        ),
        "invalidParams"
    );

    // Two TM entries; then a confirm refreshes one so it is provably the
    // newest. The sleep keeps the confirmation in a later millisecond.
    let csv_path = harness.write_file("paged-memory.csv", "source,target\nOne.,一。\nTwo.,二。\n");
    harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path }),
    );
    std::thread::sleep(std::time::Duration::from_millis(5));
    let segments = harness.segments(&document_id);
    let updated = harness.set_target(&segments[1], "二！");
    harness.confirm(&updated);

    let listed = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(listed["total"], 2);
    let entries = listed["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0]["sourceText"], "Two.",
        "newest confirmation first"
    );
    assert_eq!(entries[0]["targetText"], "二！");

    let first = harness.call("tm.list", json!({ "projectId": project_id, "limit": 1 }));
    assert_eq!(first["entries"].as_array().expect("entries").len(), 1);
    assert_eq!(first["entries"][0]["sourceText"], "Two.");
    assert_eq!(first["total"], 2);
    let second = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "offset": 1, "limit": 1 }),
    );
    assert_eq!(second["entries"][0]["sourceText"], "One.");
    let past_tm = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "offset": 2, "limit": 1 }),
    );
    assert_eq!(past_tm["entries"].as_array().expect("entries").len(), 0);
    assert_eq!(
        harness.call_err("tm.list", json!({ "projectId": project_id, "limit": 0 })),
        "invalidParams"
    );

    // Restart: the pages answer from SQL identically, proving no list
    // surface depended on state hydrated at open.
    harness.reopen();
    let page = harness.call(
        "segment.list",
        json!({ "documentId": document_id, "offset": 2, "limit": 2 }),
    );
    assert_eq!(page["segments"][0]["sourceText"], "Three.");
    assert_eq!(page["totalSegments"], 6);
    let listed = harness.call("tm.list", json!({ "projectId": project_id, "limit": 1 }));
    assert_eq!(listed["entries"][0]["sourceText"], "Two.");
    assert_eq!(listed["total"], 2);
}

/// term.list and qa.list page from SQL like segment.list and tm.list do:
/// stable windows in list order, totals independent of the window, omitted
/// limits keeping the pre-paging full-list behavior, and identical answers
/// after a restart (open() no longer hydrates either table).
#[test]
fn term_and_qa_lists_page_from_sql() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let termbase = harness.call(
        "termbase.create",
        json!({ "name": "Paged", "sourceLocale": "en-US" }),
    );
    let termbase_id = termbase["id"].as_str().expect("termbase id").to_string();
    harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    for (source, target) in [
        ("coupling", "联轴器"),
        ("actuator", "执行器"),
        ("flange", "法兰"),
        ("bracket", "支架"),
        ("dowel", "定位销"),
    ] {
        harness.call(
            "term.add",
            json!({
                "termbaseId": termbase_id,
                "sourceTerm": source,
                "targetTerm": target,
                "targetLocale": "zh-CN",
            }),
        );
    }

    // Omitting the window keeps the pre-paging behavior: the whole termbase
    // in source-term order, with the honest total alongside.
    let full = harness.call("term.list", json!({ "termbaseId": termbase_id }));
    assert_eq!(full["total"], 5);
    let sources: Vec<&str> = full["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .filter_map(|entry| entry["sourceTerm"].as_str())
        .collect();
    assert_eq!(
        sources,
        vec!["actuator", "bracket", "coupling", "dowel", "flange"]
    );

    // A middle window, an overhanging window, past-the-end, and limit 0.
    let page = harness.call(
        "term.list",
        json!({ "termbaseId": termbase_id, "offset": 1, "limit": 2 }),
    );
    let rows = page["entries"].as_array().expect("entries");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["sourceTerm"], "bracket");
    assert_eq!(rows[1]["sourceTerm"], "coupling");
    assert_eq!(page["total"], 5);
    let tail = harness.call(
        "term.list",
        json!({ "termbaseId": termbase_id, "offset": 4, "limit": 10 }),
    );
    assert_eq!(tail["entries"].as_array().expect("entries").len(), 1);
    assert_eq!(tail["entries"][0]["sourceTerm"], "flange");
    let past = harness.call(
        "term.list",
        json!({ "termbaseId": termbase_id, "offset": 10, "limit": 2 }),
    );
    assert_eq!(past["entries"].as_array().expect("entries").len(), 0);
    assert_eq!(past["total"], 5);
    assert_eq!(
        harness.call_err(
            "term.list",
            json!({ "termbaseId": termbase_id, "limit": 0 })
        ),
        "invalidParams"
    );

    // Two number mismatches and one empty target give the QA run a stable
    // multi-issue result to page over.
    let document_id = harness.import_txt(
        &project_id,
        "qa-paged.txt",
        "Count 1.\n\nCount 2.\n\nCount 3.\n",
    );
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "数 9。");
    harness.set_target(&segments[1], "数 8。");
    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    let run_issues = run["issues"].as_array().expect("issues").clone();
    assert!(run_issues.len() >= 3, "expected several issues");

    // The full list equals the run result; a window is the matching slice
    // of it, and the total never depends on the window.
    let full = harness.call("qa.list", json!({ "documentId": document_id }));
    let all_ids: Vec<&str> = full["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter_map(|issue| issue["id"].as_str())
        .collect();
    assert_eq!(full["total"], all_ids.len() as u64);
    assert_eq!(
        all_ids,
        run_issues
            .iter()
            .filter_map(|issue| issue["id"].as_str())
            .collect::<Vec<_>>(),
        "qa.list order matches the run result"
    );
    let window = harness.call(
        "qa.list",
        json!({ "documentId": document_id, "offset": 1, "limit": 2 }),
    );
    assert_eq!(
        window["issues"]
            .as_array()
            .expect("issues")
            .iter()
            .filter_map(|issue| issue["id"].as_str())
            .collect::<Vec<_>>(),
        all_ids[1..3].to_vec()
    );
    assert_eq!(window["total"], all_ids.len() as u64);
    let past = harness.call(
        "qa.list",
        json!({ "documentId": document_id, "offset": 99, "limit": 2 }),
    );
    assert_eq!(past["issues"].as_array().expect("issues").len(), 0);
    assert_eq!(
        harness.call_err("qa.list", json!({ "documentId": document_id, "limit": 0 })),
        "invalidParams"
    );

    // Fixing one number resolves that issue; resolved rows keep their place
    // in the total but sort last.
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "数 1。");
    harness.call("qa.run", json!({ "documentId": document_id }));
    let after = harness.call("qa.list", json!({ "documentId": document_id }));
    let after_issues = after["issues"].as_array().expect("issues");
    assert_eq!(after["total"], all_ids.len() as u64, "resolved rows remain");
    assert_eq!(
        after_issues
            .last()
            .map(|issue| issue["status"].as_str().expect("status")),
        Some("resolved"),
        "resolved issues sort last"
    );
    assert!(
        after_issues
            .iter()
            .any(|issue| issue["status"] == "resolved" && issue["ruleId"] == "qa.number-mismatch"),
        "the fixed number mismatch turned resolved"
    );

    // Restart: both lists answer from SQL identically, proving neither
    // depended on rows hydrated at open.
    harness.reopen();
    let page = harness.call(
        "term.list",
        json!({ "termbaseId": termbase_id, "offset": 1, "limit": 2 }),
    );
    assert_eq!(page["entries"][0]["sourceTerm"], "bracket");
    assert_eq!(page["total"], 5);
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    assert_eq!(listed["total"], all_ids.len() as u64);
    assert_eq!(
        listed["issues"]
            .as_array()
            .expect("issues")
            .last()
            .map(|issue| issue["status"].as_str().expect("status")),
        Some("resolved")
    );
}

#[test]
fn tm_import_export_roundtrip_and_pretranslate() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let csv_path = harness.write_file(
        "memory.csv",
        "source,target\nThe retention period is 30 days.,保留期为 30 天。\nSave your work often.,请经常保存工作。\n",
    );
    let imported = harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path }),
    );
    assert_eq!(imported["imported"], 2);
    assert_eq!(imported["added"], 2);
    assert_eq!(imported["updated"], 0);

    // Re-import updates in place instead of duplicating.
    let csv_path_2 = harness.write_file(
        "memory-2.csv",
        "source,target\nThe retention period is 30 days.,保留期是 30 天。\n",
    );
    let reimported = harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path_2 }),
    );
    assert_eq!(reimported["added"], 0);
    assert_eq!(reimported["updated"], 1);

    let document_id = harness.import_txt(
        &project_id,
        "job.txt",
        "The retention period is 30 days.\n\nThe retention period is 45 days.\n\nUnrelated content entirely.\n",
    );
    let result = harness.call("tm.pretranslate", json!({ "documentId": document_id }));
    assert_eq!(result["checked"], 3);
    assert_eq!(result["exact"], 1);
    assert_eq!(result["fuzzy"], 1);
    assert_eq!(result["pretranslated"], 2);
    let segments = harness.segments(&document_id);
    assert_eq!(segments[0]["state"], "draft");
    assert_eq!(segments[0]["targetText"], "保留期是 30 天。");
    assert_eq!(segments[1]["state"], "draft");
    assert_eq!(segments[2]["state"], "untranslated");
    // Pretranslation stamps the real lookup grade and score as the origin.
    assert_eq!(segments[0]["origin"]["kind"], "tmExact");
    assert_eq!(segments[0]["origin"]["score"], 100);
    assert_eq!(segments[0]["origin"]["edited"], false);
    assert_eq!(segments[1]["origin"]["kind"], "tmFuzzy");
    // "45 days" vs "30 days" keys to the same normalized placeholder text, so
    // the scorer honestly reports 100 while the grade stays fuzzy (different
    // source hash). The origin stores that reported score verbatim.
    assert_eq!(segments[1]["origin"]["score"], 100);
    // The untouched row stays origin-less — the field is absent, not faked.
    assert!(segments[2].get("origin").is_none());

    // A rerun has nothing left to fill.
    let rerun = harness.call("tm.pretranslate", json!({ "documentId": document_id }));
    assert_eq!(rerun["pretranslated"], 0);
    assert_eq!(rerun["checked"], 1);

    // Export to TMX and read it back with the asset codec.
    let tmx_path = harness.path_of("memory.tmx");
    let exported = harness.call(
        "tm.export",
        json!({ "projectId": project_id, "path": tmx_path }),
    );
    assert_eq!(exported["exported"], 2);
    let file = std::fs::File::open(&tmx_path).expect("open TMX");
    let units = tl_asset::parse_tmx(file, "en-US", "zh-CN").expect("parse TMX");
    assert_eq!(units.len(), 2);
    assert!(units.iter().any(
        |unit| unit.source_text == "The retention period is 30 days."
            && unit.target_text == "保留期是 30 天。"
    ));

    // Refuses to clobber an existing file.
    assert_eq!(
        harness.call_err(
            "tm.export",
            json!({ "projectId": project_id, "path": tmx_path }),
        ),
        "exportBlocked"
    );

    // An explicit overwrite replaces the blocked file and still yields a
    // parseable TMX.
    let overwritten = harness.call(
        "tm.export",
        json!({ "projectId": project_id, "path": tmx_path, "overwrite": true }),
    );
    assert_eq!(overwritten["exported"], 2);
    let file = std::fs::File::open(&tmx_path).expect("open overwritten TMX");
    let units = tl_asset::parse_tmx(file, "en-US", "zh-CN").expect("parse overwritten TMX");
    assert_eq!(units.len(), 2);

    // Even with overwrite, a destination inside the engine's own data
    // directory is refused: project state lives there.
    let managed_path = harness.path_of("data/engine.sqlite");
    assert!(
        std::path::Path::new(&managed_path).is_file(),
        "managed database exists"
    );
    assert_eq!(
        harness.call_err(
            "tm.export",
            json!({ "projectId": project_id, "path": managed_path, "overwrite": true }),
        ),
        "exportBlocked"
    );
}

#[test]
fn segment_origin_write_paths_persist_and_stay_honest() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "job.txt",
        "Repeat me.\n\nRepeat me.\n\nSolo line.\n",
    );
    let segments = harness.segments(&document_id);
    // Freshly imported rows carry no origin — the field is absent, not null.
    for segment in &segments {
        assert!(segment.get("origin").is_none());
    }

    // A stamped write records the stamp; `edited` is engine-owned, so the
    // client-sent `true` is ignored and stored as false.
    let solo = harness.call(
        "segment.update",
        json!({
            "segmentId": segments[2]["id"],
            "targetText": "独行译文",
            "baseRevision": segments[2]["revision"],
            "origin": { "kind": "tmFuzzy", "score": 85, "edited": true },
        }),
    )["segment"]
        .clone();
    assert_eq!(
        solo["origin"],
        json!({ "kind": "tmFuzzy", "score": 85, "edited": false })
    );

    // A plain write that does not change the target leaves the stamp alone.
    let solo = harness.set_target(&solo, "独行译文");
    assert_eq!(solo["origin"]["edited"], false);

    // A plain write that changes the target marks the stamp edited — the
    // pollution signal — while keeping kind and score.
    let solo = harness.set_target(&solo, "独行译文（改）");
    assert_eq!(
        solo["origin"],
        json!({ "kind": "tmFuzzy", "score": 85, "edited": true })
    );

    // Emptying the target returns the row to untranslated and clears the
    // origin entirely: no translation, no source to attribute.
    let solo = harness.set_target(&solo, "");
    assert_eq!(solo["state"], "untranslated");
    assert!(solo.get("origin").is_none());

    // An AI-draft apply is a stamped update carrying the provider model.
    let first = harness.call(
        "segment.update",
        json!({
            "segmentId": segments[0]["id"],
            "targetText": "重复我。",
            "baseRevision": segments[0]["revision"],
            "origin": { "kind": "aiDraft", "model": "test-model" },
        }),
    )["segment"]
        .clone();
    assert_eq!(
        first["origin"],
        json!({ "kind": "aiDraft", "model": "test-model", "edited": false })
    );

    // Confirming never restamps: the confirmed row keeps its aiDraft origin,
    // the TM entry is still written, and the propagated sibling gets an
    // honest tmExact/100 (exact-source reuse by construction).
    let confirmed = harness.confirm(&first);
    assert_eq!(confirmed["segment"]["state"], "confirmed");
    assert_eq!(
        confirmed["segment"]["origin"],
        json!({ "kind": "aiDraft", "model": "test-model", "edited": false })
    );
    assert_eq!(confirmed["tmEntry"]["sourceText"], "Repeat me.");
    let propagated = confirmed["propagated"].as_array().expect("propagated");
    assert_eq!(propagated.len(), 1);
    assert_eq!(propagated[0]["id"], segments[1]["id"]);
    assert_eq!(propagated[0]["state"], "draft");
    assert_eq!(
        propagated[0]["origin"],
        json!({ "kind": "tmExact", "score": 100, "edited": false })
    );

    // Origins live in SQL, not RAM: everything reads back after a restart,
    // and the never-stamped row is still origin-less.
    harness.reopen();
    let segments = harness.segments(&document_id);
    assert_eq!(
        segments[0]["origin"],
        json!({ "kind": "aiDraft", "model": "test-model", "edited": false })
    );
    assert_eq!(
        segments[1]["origin"],
        json!({ "kind": "tmExact", "score": 100, "edited": false })
    );
    assert!(segments[2].get("origin").is_none());

    // segment.replace is plain-edit semantics: the rewritten row keeps its
    // stamp but gains the edited mark.
    let replaced = harness.call(
        "segment.replace",
        json!({ "documentId": document_id, "find": "重复", "replaceWith": "重复了" }),
    );
    assert_eq!(replaced["segments"].as_array().expect("segments").len(), 1);
    assert_eq!(
        replaced["segments"][0]["origin"],
        json!({ "kind": "tmExact", "score": 100, "edited": true })
    );
}

#[test]
fn tm_list_pages_and_filters() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let csv_path = harness.write_file(
        "memory.csv",
        "source,target\nThe retention period is 30 days.,保留期为 30 天。\nSave your work often.,请经常保存工作。\n",
    );
    harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path }),
    );
    // A later human confirmation lands the newest entry.
    let document_id = harness.import_txt(&project_id, "job.txt", "Cats sleep in sunlight.\n");
    let segments = harness.segments(&document_id);
    let updated = harness.set_target(&segments[0], "猫在阳光下睡觉。");
    harness.confirm(&updated);

    let listed = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(listed["total"], 3);
    let entries = listed["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0]["sourceText"], "Cats sleep in sunlight.");

    // Case-insensitive substring filter over source and target.
    let filtered = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "query": "RETENTION" }),
    );
    assert_eq!(filtered["total"], 1);
    assert_eq!(
        filtered["entries"][0]["sourceText"],
        "The retention period is 30 days."
    );
    let by_target = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "query": "保存工作" }),
    );
    assert_eq!(by_target["total"], 1);
    let none = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "query": "nowhere" }),
    );
    assert_eq!(none["total"], 0);
    assert_eq!(none["entries"].as_array().expect("entries").len(), 0);

    // Paging keeps the honest pre-page total.
    let page = harness.call("tm.list", json!({ "projectId": project_id, "limit": 2 }));
    assert_eq!(page["total"], 3);
    assert_eq!(page["entries"].as_array().expect("entries").len(), 2);
    let rest = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "limit": 2, "offset": 2 }),
    );
    assert_eq!(rest["total"], 3);
    assert_eq!(rest["entries"].as_array().expect("entries").len(), 1);
    let past_end = harness.call("tm.list", json!({ "projectId": project_id, "offset": 99 }));
    assert_eq!(past_end["total"], 3);
    assert_eq!(past_end["entries"].as_array().expect("entries").len(), 0);

    assert_eq!(
        harness.call_err("tm.list", json!({ "projectId": project_id, "limit": 0 })),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err("tm.list", json!({ "projectId": "missing" })),
        "notFound"
    );
}

#[test]
fn tm_update_and_delete_keep_index_and_confirm_path_coherent() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "source.txt",
        "The retention period is 30 days.\n\nCats enjoy sleeping in warm sunlight.\n",
    );
    let segments = harness.segments(&document_id);
    let first = harness.set_target(&segments[0], "保留期为 30 天。");
    harness.confirm(&first);
    let second = harness.set_target(&segments[1], "猫喜欢在温暖的阳光下睡觉。");
    harness.confirm(&second);

    let listed = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(listed["total"], 2);
    let entry_of = |listed: &Value, source: &str| -> String {
        listed["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .find(|entry| entry["sourceText"] == source)
            .and_then(|entry| entry["id"].as_str())
            .expect("entry id")
            .to_string()
    };
    let retention_id = entry_of(&listed, "The retention period is 30 days.");
    let cats_id = entry_of(&listed, "Cats enjoy sleeping in warm sunlight.");

    // Target-only edit: lookup returns the curated translation.
    let updated = harness.call(
        "tm.update",
        json!({
            "entryId": retention_id,
            "sourceText": "The retention period is 30 days.",
            "targetText": "保留期共 30 天。",
        }),
    );
    assert_eq!(updated["entry"]["targetText"], "保留期共 30 天。");
    let lookup = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The retention period is 30 days." }),
    );
    assert_eq!(lookup["matches"][0]["grade"], "exact");
    assert_eq!(
        lookup["matches"][0]["entry"]["targetText"],
        "保留期共 30 天。"
    );

    // Source edit re-keys the hash and the fuzzy index.
    harness.call(
        "tm.update",
        json!({
            "entryId": retention_id,
            "sourceText": "The data retention window is 30 days.",
            "targetText": "数据保留窗口为 30 天。",
        }),
    );
    let old_source = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The retention period is 30 days." }),
    );
    assert!(
        old_source["matches"]
            .as_array()
            .expect("matches")
            .iter()
            .all(|item| item["grade"] != "exact"),
        "old source must no longer match exactly"
    );
    let new_source = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The data retention window is 30 days." }),
    );
    assert_eq!(new_source["matches"][0]["grade"], "exact");
    assert_eq!(
        new_source["matches"][0]["entry"]["targetText"],
        "数据保留窗口为 30 天。"
    );
    let fuzzy = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The data retention window is 45 days." }),
    );
    assert_eq!(fuzzy["matches"][0]["grade"], "fuzzy");
    assert_eq!(fuzzy["matches"][0]["entry"]["id"], retention_id.as_str());

    // One entry per normalized source per memory stays enforced.
    assert_eq!(
        harness.call_err(
            "tm.update",
            json!({
                "entryId": cats_id,
                "sourceText": "The data retention window is 30 days.",
                "targetText": "重复源文。",
            }),
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err(
            "tm.update",
            json!({ "entryId": retention_id, "sourceText": "  ", "targetText": "x" }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "tm.update",
            json!({ "entryId": "missing", "sourceText": "a", "targetText": "b" }),
        ),
        "notFound"
    );

    // Delete removes the entry from lookup, fuzzy recall, and the list.
    let deleted = harness.call("tm.delete", json!({ "entryId": cats_id }));
    assert_eq!(
        deleted["entry"]["sourceText"],
        "Cats enjoy sleeping in warm sunlight."
    );
    let exact_gone = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Cats enjoy sleeping in warm sunlight." }),
    );
    assert_eq!(exact_gone["totalMatches"], 0);
    let fuzzy_gone = harness.call(
        "tm.lookup",
        json!({
            "projectId": project_id,
            "sourceText": "Cats enjoy sleeping in the warm sunlight.",
        }),
    );
    assert_eq!(fuzzy_gone["totalMatches"], 0);
    assert_eq!(
        harness.call("tm.list", json!({ "projectId": project_id }))["total"],
        1
    );
    assert_eq!(
        harness.call_err("tm.delete", json!({ "entryId": cats_id })),
        "notFound"
    );

    // Edits and deletions survive an engine restart via state.json, and the
    // rebuilt fuzzy index matches the persisted entries.
    harness.reopen();
    assert_eq!(
        harness.call("tm.list", json!({ "projectId": project_id }))["total"],
        1
    );
    let after_restart = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "The data retention window is 45 days." }),
    );
    assert_eq!(after_restart["matches"][0]["grade"], "fuzzy");
    assert_eq!(
        harness.call(
            "tm.lookup",
            json!({
                "projectId": project_id,
                "sourceText": "Cats enjoy sleeping in warm sunlight.",
            }),
        )["totalMatches"],
        0
    );

    // The human confirm path keeps writing TM after manage operations.
    let segments = harness.segments(&document_id);
    harness.confirm(&segments[1]);
    let relisted = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(relisted["total"], 2);

    // Pretranslation picks up the curated target for the edited source.
    let job_id = harness.import_txt(
        &project_id,
        "job.txt",
        "The data retention window is 30 days.\n",
    );
    let pretranslated = harness.call("tm.pretranslate", json!({ "documentId": job_id }));
    assert_eq!(pretranslated["exact"], 1);
    assert_eq!(
        pretranslated["segments"][0]["targetText"],
        "数据保留窗口为 30 天。"
    );
}

#[test]
fn termbase_lifecycle_hits_and_csv_tbx_roundtrip() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let termbase = harness.call(
        "termbase.create",
        json!({ "name": "Industrial", "sourceLocale": "en-US" }),
    );
    let termbase_id = termbase["id"].as_str().expect("termbase id").to_string();
    let mount = harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    assert_eq!(mount["mount"]["priority"], 0);
    // Attach is idempotent.
    let again = harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    assert_eq!(again["mount"]["priority"], 0);

    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "actuator",
            "targetTerm": "执行器",
            "targetLocale": "zh-CN",
            "definition": "Converts energy into motion.",
        }),
    );
    let entry = harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "actuator",
            "targetTerm": "作动器",
            "targetLocale": "zh-CN",
            "forbidden": true,
        }),
    );
    assert_eq!(
        entry["entry"]["translations"]
            .as_array()
            .expect("translations")
            .len(),
        2
    );

    let listed = harness.call("termbase.list", json!({ "projectId": project_id }));
    assert_eq!(listed["termbases"].as_array().expect("termbases").len(), 1);
    assert_eq!(listed["mounts"].as_array().expect("mounts").len(), 1);

    // In-text hit with spans over the normalized source text.
    let lookup = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "Install the actuator now." }),
    );
    let matches = lookup["matches"].as_array().expect("matches");
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0]["sourceTerm"], "actuator");
    assert_eq!(matches[0]["start"], 12);
    assert_eq!(matches[0]["end"], 20);

    // Word boundaries hold: no hit inside another word.
    let none = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "The actuators differ." }),
    );
    assert_eq!(none["matches"].as_array().expect("matches").len(), 0);

    // CSV and TBX exports both round-trip through fresh termbases.
    for format in ["csv", "tbx"] {
        let export_path = harness.path_of(&format!("terms.{format}"));
        let exported = harness.call(
            "termbase.export",
            json!({ "termbaseId": termbase_id, "path": export_path }),
        );
        assert_eq!(exported["exported"], 1);

        let copy = harness.call(
            "termbase.create",
            json!({ "name": format!("Copy {format}"), "sourceLocale": "en-US" }),
        );
        let copy_id = copy["id"].as_str().expect("copy id").to_string();
        let imported = harness.call(
            "termbase.import",
            json!({
                "termbaseId": copy_id,
                "path": harness.path_of(&format!("terms.{format}")),
                "targetLocale": "zh-CN",
            }),
        );
        assert_eq!(imported["imported"], 1, "{format} import count");
        assert_eq!(imported["added"], 1, "{format} added count");

        let entries = harness.call("term.list", json!({ "termbaseId": copy_id }));
        let entries = entries["entries"].as_array().expect("entries");
        assert_eq!(entries.len(), 1, "{format} entry count");
        assert_eq!(entries[0]["sourceTerm"], "actuator");
        let translations = entries[0]["translations"].as_array().expect("translations");
        assert_eq!(translations.len(), 2, "{format} translation count");
        let forbidden: Vec<&Value> = translations
            .iter()
            .filter(|translation| translation["forbidden"] == true)
            .collect();
        assert_eq!(forbidden.len(), 1, "{format} forbidden count");
        assert_eq!(forbidden[0]["term"], "作动器");
    }

    // Re-exporting to an existing path is refused, then an explicit
    // overwrite replaces the file in place.
    let export_path = harness.path_of("terms.csv");
    assert_eq!(
        harness.call_err(
            "termbase.export",
            json!({ "termbaseId": termbase_id, "path": export_path }),
        ),
        "exportBlocked"
    );
    let overwritten = harness.call(
        "termbase.export",
        json!({ "termbaseId": termbase_id, "path": export_path, "overwrite": true }),
    );
    assert_eq!(overwritten["exported"], 1);
}

#[test]
fn term_update_and_delete_manage_a_mounted_termbase() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let termbase = harness.call(
        "termbase.create",
        json!({ "name": "Industrial", "sourceLocale": "en-US" }),
    );
    let termbase_id = termbase["id"].as_str().expect("termbase id").to_string();
    harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "actuator",
            "targetTerm": "执行器",
            "targetLocale": "zh-CN",
        }),
    );
    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "actuator",
            "targetTerm": "作动器",
            "targetLocale": "zh-CN",
            "forbidden": true,
        }),
    );
    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "gasket",
            "targetTerm": "垫片",
            "targetLocale": "zh-CN",
        }),
    );

    let listed = harness.call("term.list", json!({ "termbaseId": termbase_id }));
    let entries = listed["entries"].as_array().expect("entries").clone();
    assert_eq!(entries.len(), 2);
    let actuator = &entries[0];
    let gasket = &entries[1];
    assert_eq!(actuator["sourceTerm"], "actuator");
    assert_eq!(gasket["sourceTerm"], "gasket");
    let actuator_id = actuator["id"].as_str().expect("entry id").to_string();
    let gasket_id = gasket["id"].as_str().expect("entry id").to_string();
    let forbidden_translation_id = actuator["translations"]
        .as_array()
        .expect("translations")
        .iter()
        .find(|translation| translation["forbidden"] == true)
        .and_then(|translation| translation["id"].as_str())
        .expect("forbidden translation id")
        .to_string();

    // Rename the source term; lookup follows the new spelling.
    let renamed = harness.call(
        "term.update",
        json!({ "entryId": gasket_id, "sourceTerm": "sensor" }),
    );
    assert_eq!(renamed["entry"]["sourceTerm"], "sensor");
    assert_eq!(renamed["entry"]["revision"], 2);
    let hits = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "Replace the sensor today." }),
    );
    assert_eq!(hits["matches"].as_array().expect("matches").len(), 1);
    let stale = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "Replace the gasket today." }),
    );
    assert_eq!(stale["matches"].as_array().expect("matches").len(), 0);

    // Edit one translation's text and clear its forbidden flag.
    let edited = harness.call(
        "term.update",
        json!({
            "entryId": actuator_id,
            "translationId": forbidden_translation_id,
            "targetTerm": "促动器",
            "forbidden": false,
        }),
    );
    let translations = edited["entry"]["translations"]
        .as_array()
        .expect("translations");
    let edited_translation = translations
        .iter()
        .find(|translation| translation["id"] == forbidden_translation_id.as_str())
        .expect("edited translation");
    assert_eq!(edited_translation["term"], "促动器");
    assert_eq!(edited_translation["forbidden"], false);
    assert_eq!(edited_translation["preferred"], true);

    // Honest failures: collisions, empty edits, and unknown ids.
    assert_eq!(
        harness.call_err(
            "term.update",
            json!({ "entryId": gasket_id, "sourceTerm": "Actuator" }),
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err(
            "term.update",
            json!({
                "entryId": actuator_id,
                "translationId": forbidden_translation_id,
                "targetTerm": "执行器",
            }),
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err("term.update", json!({ "entryId": actuator_id })),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "term.update",
            json!({ "entryId": actuator_id, "sourceTerm": "  " }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "term.update",
            json!({ "entryId": actuator_id, "targetTerm": "促动装置" }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "term.update",
            json!({ "entryId": "missing", "sourceTerm": "x" }),
        ),
        "notFound"
    );
    assert_eq!(
        harness.call_err(
            "term.update",
            json!({
                "entryId": actuator_id,
                "translationId": "missing",
                "targetTerm": "x",
            }),
        ),
        "notFound"
    );
    assert_eq!(
        harness.call_err("term.delete", json!({ "entryId": "missing" })),
        "notFound"
    );
    assert_eq!(
        harness.call_err(
            "term.delete",
            json!({ "entryId": actuator_id, "translationId": "missing" }),
        ),
        "notFound"
    );

    // Remove one translation; the entry survives with the other one.
    let trimmed = harness.call(
        "term.delete",
        json!({ "entryId": actuator_id, "translationId": forbidden_translation_id }),
    );
    let remaining = trimmed["entry"]["translations"]
        .as_array()
        .expect("translations");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0]["term"], "执行器");

    // Remove the whole entry; list and lookup both drop it.
    let removed = harness.call("term.delete", json!({ "entryId": gasket_id }));
    assert!(removed["entry"].is_null());
    let listed = harness.call("term.list", json!({ "termbaseId": termbase_id }));
    let entries = listed["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["sourceTerm"], "actuator");
    let gone = harness.call(
        "term.lookup",
        json!({ "projectId": project_id, "sourceText": "Replace the sensor today." }),
    );
    assert_eq!(gone["matches"].as_array().expect("matches").len(), 0);

    // Edits and deletes persist through the state store across a restart.
    harness.reopen();
    let listed = harness.call("term.list", json!({ "termbaseId": termbase_id }));
    let entries = listed["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["sourceTerm"], "actuator");
    let translations = entries[0]["translations"].as_array().expect("translations");
    assert_eq!(translations.len(), 1);
    assert_eq!(translations[0]["term"], "执行器");
}

#[test]
fn qa_run_applies_rule_library_and_terminology() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let termbase = harness.call(
        "termbase.create",
        json!({ "name": "UI", "sourceLocale": "en-US" }),
    );
    let termbase_id = termbase["id"].as_str().expect("termbase id").to_string();
    harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );
    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "file",
            "targetTerm": "文件",
            "targetLocale": "zh-CN",
        }),
    );
    harness.call(
        "term.add",
        json!({
            "termbaseId": termbase_id,
            "sourceTerm": "file",
            "targetTerm": "档案",
            "targetLocale": "zh-CN",
            "forbidden": true,
        }),
    );

    let document_id = harness.import_txt(
        &project_id,
        "qa.txt",
        "Save the file.\n\nThe amount is 30 kg.\n\nHello world.\n",
    );
    let segments = harness.segments(&document_id);
    // Uses the forbidden term and omits the preferred one.
    harness.set_target(&segments[0], "保存档案。");
    // Wrong number and dropped unit.
    harness.set_target(&segments[1], "数量是 40。");
    // segments[2] stays empty.

    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(run["checkedSegments"], 3);
    let issues = run["issues"].as_array().expect("issues");
    let open_rules: Vec<&str> = issues
        .iter()
        .filter(|issue| issue["status"] == "open")
        .filter_map(|issue| issue["ruleId"].as_str())
        .collect();
    assert!(
        open_rules
            .iter()
            .any(|rule| rule.starts_with("qa.term-required:")),
        "missing term-required in {open_rules:?}"
    );
    assert!(
        open_rules
            .iter()
            .any(|rule| rule.starts_with("qa.term-forbidden:")),
        "missing term-forbidden in {open_rules:?}"
    );
    assert!(open_rules.contains(&"qa.number-mismatch"));
    assert!(open_rules.contains(&"qa.unit-mismatch"));
    assert!(open_rules.contains(&"qa.empty-target"));
    let number_issue = issues
        .iter()
        .find(|issue| issue["ruleId"] == "qa.number-mismatch")
        .expect("number issue");
    assert_eq!(number_issue["evidence"]["sourceNumbers"][0], "30");
    assert_eq!(number_issue["evidence"]["targetNumbers"][0], "40");

    // Fixing the number resolves that issue on the next run.
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[1], "数量是 30 kg。");
    let rerun = harness.call("qa.run", json!({ "documentId": document_id }));
    let number_after: Vec<&Value> = rerun["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter(|issue| issue["ruleId"] == "qa.number-mismatch")
        .collect();
    assert!(
        number_after
            .iter()
            .all(|issue| issue["status"] == "resolved"),
        "number issue should be resolved"
    );
}

/// The full `qa.waive` lifecycle and its human red line.
///
/// Waiving records "a human accepted exactly this finding" without
/// pretending the numbers now match: the segment stays a draft, nothing is
/// confirmed, and no TM entry appears. The waiver sticks across reruns while
/// the same fingerprint + evidence reproduce; changed numbers open a fresh
/// issue instead of hiding behind the old waiver.
#[test]
fn qa_waive_sticks_until_evidence_changes_and_never_writes_tm() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "waive.txt",
        "The amount is 30.\n\nThe size is 50.\n",
    );
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "金额是 40。");
    harness.set_target(&segments[1], "大小是 60。");
    // Post-draft snapshot: the red-line checks below compare against this.
    let drafted = harness.segments(&document_id);

    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(run["openIssues"], 2);
    let issues = run["issues"].as_array().expect("issues").clone();
    let first_issue = issues
        .iter()
        .find(|issue| issue["segmentId"] == segments[0]["id"])
        .expect("issue on segment 0");
    let first_issue_id = first_issue["id"].as_str().expect("issue id").to_string();
    let first_fingerprint = first_issue["fingerprint"]
        .as_str()
        .expect("fingerprint")
        .to_string();

    // Waive with a note. The note is optional by design; this one proves it
    // round-trips when given.
    let waived = harness.call(
        "qa.waive",
        json!({ "issueId": first_issue_id, "waived": true, "note": "客户确认金额以译文为准" }),
    );
    assert_eq!(waived["issues"][0]["status"], "waived");
    assert_eq!(waived["issues"][0]["waiveNote"], "客户确认金额以译文为准");
    assert_eq!(
        waived["issues"][0]["evidence"]["targetNumbers"][0], "40",
        "the evidence still shows the mismatch; waiving does not rewrite it"
    );

    // Human red line: waive is not confirm and writes no TM. The segment is
    // still a draft at the same revision, and the project memory is empty.
    let segments_after = harness.segments(&document_id);
    assert_eq!(segments_after[0]["state"], "draft");
    assert_eq!(segments_after[0]["revision"], drafted[0]["revision"]);
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"], 0, "waiving must never write a TM entry");

    // A rerun with unchanged text reproduces the same fingerprint and
    // evidence, so the waiver holds and the issue is not counted as open.
    let rerun = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(rerun["openIssues"], 1, "only the un-waived issue is open");
    let rerun_first = rerun["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .find(|issue| issue["id"].as_str() == Some(first_issue_id.as_str()))
        .expect("waived issue survives the rerun")
        .clone();
    assert_eq!(rerun_first["status"], "waived");
    assert_eq!(rerun_first["waiveNote"], "客户确认金额以译文为准");

    // List order: open first, then waived; the waiver note pages through.
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    let listed_statuses: Vec<&str> = listed["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter_map(|issue| issue["status"].as_str())
        .collect();
    assert_eq!(listed_statuses, vec!["open", "waived"]);

    // Restore flips the waived issue back to open and drops the note.
    let restored = harness.call(
        "qa.waive",
        json!({ "issueId": first_issue_id, "waived": false }),
    );
    assert_eq!(restored["issues"][0]["status"], "open");
    assert!(restored["issues"][0]["waiveNote"].is_null());

    // Re-waive without any note: an empty note is a perfectly valid waiver.
    let rewaived = harness.call(
        "qa.waive",
        json!({ "issueId": first_issue_id, "waived": true, "note": "   " }),
    );
    assert_eq!(rewaived["issues"][0]["status"], "waived");
    assert!(rewaived["issues"][0]["waiveNote"].is_null());

    // The waiver survives an engine restart: it lives on the SQL row.
    harness.reopen();
    let reloaded = harness.call("qa.list", json!({ "documentId": document_id }));
    let reloaded_first = reloaded["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .find(|issue| issue["id"].as_str() == Some(first_issue_id.as_str()))
        .expect("waived issue after restart")
        .clone();
    assert_eq!(reloaded_first["status"], "waived");

    // Changed evidence breaks the waiver honestly: a different wrong number
    // is a new fingerprint, so a fresh open issue appears and the old waived
    // row resolves (that exact finding no longer reproduces).
    let segments_now = harness.segments(&document_id);
    harness.set_target(&segments_now[0], "金额是 70。");
    let changed = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(
        changed["openIssues"], 2,
        "the changed number must open a new issue instead of hiding behind the waiver"
    );
    let changed_issues = changed["issues"].as_array().expect("issues");
    let old_row = changed_issues
        .iter()
        .find(|issue| issue["id"].as_str() == Some(first_issue_id.as_str()))
        .expect("old issue row");
    assert_eq!(old_row["status"], "resolved");
    assert!(old_row["waiveNote"].is_null());
    let new_row = changed_issues
        .iter()
        .find(|issue| {
            issue["segmentId"] == segments[0]["id"]
                && issue["ruleId"] == "qa.number-mismatch"
                && issue["status"] == "open"
        })
        .expect("new open issue for the changed number");
    assert_ne!(
        new_row["fingerprint"].as_str(),
        Some(first_fingerprint.as_str())
    );
    assert_eq!(new_row["evidence"]["targetNumbers"][0], "70");

    // Honest errors: unknown issue, waiving what is already resolved, and
    // restoring what is not waived.
    assert_eq!(
        harness.call_err("qa.waive", json!({ "issueId": "missing", "waived": true })),
        "notFound"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({ "issueId": first_issue_id, "waived": true })
        ),
        "conflict",
        "a resolved issue has nothing left to waive"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({ "issueId": new_row["id"], "waived": false })
        ),
        "conflict",
        "an open issue has nothing to restore"
    );
}

/// Deterministic tag/placeholder integrity is part of every `qa.run`:
/// dropped source tokens and invented target tokens are flagged with the
/// tokens as evidence, waivers ride the fingerprint exactly like the number
/// rule (same tokens → the waiver holds; different tokens → a fresh open
/// issue), and waiving a tag issue never confirms the segment or writes TM.
#[test]
fn qa_flags_tag_placeholder_integrity_with_sticky_waivers_and_no_tm_writes() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "tags.txt",
        "Click {button} or {link} to continue.\n\nSave the file.\n",
    );
    let segments = harness.segments(&document_id);
    // Both placeholders dropped from the target.
    harness.set_target(&segments[0], "点击以继续。");
    // The target invents markup the source never had.
    harness.set_target(&segments[1], "保存<b>文件</b>。");
    let drafted = harness.segments(&document_id);

    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    let issues = run["issues"].as_array().expect("issues").clone();
    let missing = issues
        .iter()
        .find(|issue| issue["ruleId"] == "qa.tag-placeholder_missing")
        .expect("missing-placeholder issue");
    assert_eq!(missing["segmentId"], segments[0]["id"]);
    assert_eq!(missing["severity"], "error");
    assert_eq!(missing["status"], "open");
    assert_eq!(
        missing["evidence"]["sourceValues"],
        json!(["{button}", "{link}"])
    );
    let extra = issues
        .iter()
        .find(|issue| issue["ruleId"] == "qa.tag-placeholder_extra")
        .expect("extra-placeholder issue");
    assert_eq!(extra["segmentId"], segments[1]["id"]);
    assert_eq!(extra["severity"], "error");
    assert_eq!(extra["evidence"]["targetValues"], json!(["</b>", "<b>"]));

    // Waive the missing-placeholder issue; the waiver rides the fingerprint.
    let missing_id = missing["id"].as_str().expect("issue id").to_string();
    let missing_fingerprint = missing["fingerprint"]
        .as_str()
        .expect("fingerprint")
        .to_string();
    let waived = harness.call(
        "qa.waive",
        json!({ "issueId": missing_id, "waived": true, "note": "占位符由排版阶段补齐" }),
    );
    assert_eq!(waived["issues"][0]["status"], "waived");

    // Human red line: waiving a tag issue confirms nothing and writes no TM.
    let after = harness.segments(&document_id);
    assert_eq!(after[0]["state"], "draft");
    assert_eq!(after[0]["revision"], drafted[0]["revision"]);
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"], 0, "waiving a QA issue must never write TM");

    // Unchanged text on a rerun: same tokens, same fingerprint, the waiver
    // holds and the issue is not reopened.
    let rerun = harness.call("qa.run", json!({ "documentId": document_id }));
    let rerun_issue = rerun["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .find(|issue| issue["id"].as_str() == Some(missing_id.as_str()))
        .expect("waived issue survives the rerun")
        .clone();
    assert_eq!(rerun_issue["status"], "waived");

    // Restoring one placeholder changes the evidence: the old waived row
    // resolves and a fresh open issue appears for the still-missing token.
    let segments_now = harness.segments(&document_id);
    harness.set_target(&segments_now[0], "点击 {button} 以继续。");
    let changed = harness.call("qa.run", json!({ "documentId": document_id }));
    let changed_issues = changed["issues"].as_array().expect("issues");
    let old_row = changed_issues
        .iter()
        .find(|issue| issue["id"].as_str() == Some(missing_id.as_str()))
        .expect("old issue row");
    assert_eq!(old_row["status"], "resolved");
    let new_row = changed_issues
        .iter()
        .find(|issue| issue["ruleId"] == "qa.tag-placeholder_missing" && issue["status"] == "open")
        .expect("fresh open issue for the remaining token");
    assert_ne!(
        new_row["fingerprint"].as_str(),
        Some(missing_fingerprint.as_str())
    );
    assert_eq!(new_row["evidence"]["sourceValues"], json!(["{link}"]));

    // Restoring every token on both segments resolves the tag family.
    let segments_now = harness.segments(&document_id);
    harness.set_target(&segments_now[0], "点击 {button} 或 {link} 以继续。");
    harness.set_target(&segments_now[1], "保存文件。");
    let fixed = harness.call("qa.run", json!({ "documentId": document_id }));
    assert!(
        fixed["issues"]
            .as_array()
            .expect("issues")
            .iter()
            .filter(|issue| issue["ruleId"]
                .as_str()
                .is_some_and(|rule| rule.starts_with("qa.tag-")))
            .all(|issue| issue["status"] == "resolved"),
        "fixed tokens must resolve every tag issue"
    );
}

#[test]
fn bilingual_xlsx_filter_registers_imports_and_exports_via_explicit_id() {
    let mut harness = Harness::new();

    // Both bilingual table modes are registered engine capabilities.
    let ready = harness.call(
        "engine.initialize",
        json!({
            "protocolVersion": tl_protocol::PROTOCOL_VERSION,
            "clientName": "test",
            "clientVersion": "0",
        }),
    );
    let filters = ready["capabilities"]["filters"]
        .as_array()
        .expect("filters");
    for id in ["builtin.bilingual-xlsx", "builtin.bilingual-docx"] {
        assert!(
            filters.iter().any(|filter| filter == id),
            "{id} missing from {filters:?}"
        );
    }

    let project_id = harness.create_project();
    let source_path = harness.path_of("bilingual.xlsx");
    tl_filter_xlsx::fixture::write_bilingual_fixture(source_path.as_ref())
        .expect("write bilingual XLSX fixture");

    // Without an explicit filter id, probing still picks the ordinary XLSX
    // filter: the bilingual mode never hijacks automatic selection.
    let probed = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": source_path }),
    );
    assert_eq!(probed["document"]["filterId"], "builtin.xlsx");

    // The explicit id runs the bilingual table mode: rows become segments
    // with their existing targets carried over as drafts.
    let imported = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": source_path,
            "filterId": "builtin.bilingual-xlsx",
        }),
    );
    assert_eq!(imported["document"]["filterId"], "builtin.bilingual-xlsx");
    assert_eq!(imported["document"]["format"], "bilingual-xlsx");
    let document_id = imported["document"]["id"]
        .as_str()
        .expect("document id")
        .to_string();
    let segments = harness.segments(&document_id);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0]["sourceText"], "Hello");
    assert_eq!(segments[0]["targetText"], "Existing");
    assert_eq!(segments[0]["state"], "draft");
    assert_eq!(segments[1]["sourceText"], "Second");
    assert_eq!(segments[1]["targetText"], "第二");

    // Edit one row, export, and reparse the workbook: only target cells
    // change and the untouched row keeps its original translation.
    harness.set_target(&segments[0], "你好更新");
    let output_path = harness.path_of("bilingual.out.xlsx");
    let exported = harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": output_path }),
    );
    assert_eq!(exported["translatedSegments"], 2);
    let rows = tl_filter_xlsx::extract_bilingual_table_rows(
        harness.path_of("bilingual.out.xlsx").as_ref(),
    )
    .expect("reparse exported workbook");
    let updated = rows.iter().find(|row| row.row_number == 2).expect("row 2");
    assert_eq!(updated.cells[0], "Hello");
    assert_eq!(updated.cells[1], "你好更新");
    let untouched = rows.iter().find(|row| row.row_number == 3).expect("row 3");
    assert_eq!(untouched.cells[1], "第二");

    // The human overwrite rule stays: an existing output path is refused.
    assert_eq!(
        harness.call_err(
            "document.export",
            json!({
                "documentId": document_id,
                "outputPath": harness.path_of("bilingual.out.xlsx"),
            }),
        ),
        "exportBlocked"
    );
}

#[test]
fn bilingual_docx_filter_reports_layout_format_and_roundtrips() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let source_path = harness.path_of("bilingual.docx");
    tl_filter_docx::fixture::write_bilingual_fixture(source_path.as_ref())
        .expect("write bilingual DOCX fixture");

    let imported = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": source_path,
            "filterId": "builtin.bilingual-docx",
        }),
    );
    assert_eq!(imported["document"]["filterId"], "builtin.bilingual-docx");
    // The exact format id the desktop layout preview keys on: its export
    // artifact really is a DOCX file rendered by the same pipeline.
    assert_eq!(imported["document"]["format"], "bilingual-docx");
    let document_id = imported["document"]["id"]
        .as_str()
        .expect("document id")
        .to_string();
    let segments = harness.segments(&document_id);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0]["sourceText"], "Hello world");
    assert_eq!(segments[0]["targetText"], "Existing target");
    assert_eq!(segments[1]["sourceText"], "Second source");
    assert_eq!(segments[1]["targetText"], "第二译文");

    harness.set_target(&segments[0], "你好世界更新");
    let output_path = harness.path_of("bilingual.out.docx");
    let exported = harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": output_path }),
    );
    assert_eq!(exported["translatedSegments"], 2);
    let rows = tl_filter_docx::extract_bilingual_table_rows(
        harness.path_of("bilingual.out.docx").as_ref(),
    )
    .expect("reparse exported document");
    let updated = rows
        .iter()
        .find(|row| row.table_index == 0 && row.row_number == 1)
        .expect("first data row");
    assert_eq!(updated.cells[0], "Hello world");
    assert_eq!(updated.cells[1], "你好世界更新");
    let untouched = rows
        .iter()
        .find(|row| row.table_index == 1 && row.row_number == 1)
        .expect("second data row");
    assert_eq!(untouched.cells[1], "第二译文");

    // No clobber on re-export.
    assert_eq!(
        harness.call_err(
            "document.export",
            json!({
                "documentId": document_id,
                "outputPath": harness.path_of("bilingual.out.docx"),
            }),
        ),
        "exportBlocked"
    );
}

#[test]
fn bilingual_docx_export_embeds_segment_anchors_only_when_requested() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let source_path = harness.path_of("bilingual-anchored.docx");
    tl_filter_docx::fixture::write_bilingual_fixture(source_path.as_ref())
        .expect("write bilingual DOCX fixture");
    let imported = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": source_path,
            "filterId": "builtin.bilingual-docx",
        }),
    );
    let document_id = imported["document"]["id"]
        .as_str()
        .expect("document id")
        .to_string();
    let segments = harness.segments(&document_id);
    assert_eq!(segments.len(), 2, "fixture yields two bilingual rows");
    harness.set_target(&segments[0], "你好世界更新");

    let document_xml_of = |path: &str| -> String {
        let package =
            tl_filter_office::OfficePackage::open(std::path::Path::new(path)).expect("package");
        String::from_utf8(package.require("word/document.xml").expect("main").to_vec())
            .expect("utf-8 document part")
    };

    // The plain export — what「导出译文」writes — carries no preview anchors.
    let plain_path = harness.path_of("bilingual-plain.docx");
    harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": plain_path }),
    );
    assert!(!document_xml_of(&harness.path_of("bilingual-plain.docx")).contains("tlseg-"));

    // The anchored export bookmarks every row's target-cell paragraph with
    // its grid segment id, so the layout preview can jump from a click on
    // the target cell — rows the user has not edited included.
    let anchored_path = harness.path_of("bilingual-anchored.out.docx");
    let result = harness.call(
        "document.export",
        json!({
            "documentId": document_id,
            "outputPath": anchored_path,
            "segmentAnchors": true,
        }),
    );
    assert_eq!(result["translatedSegments"], 2);
    let anchored_xml = document_xml_of(&harness.path_of("bilingual-anchored.out.docx"));
    for segment in &segments {
        let segment_id = segment["id"].as_str().expect("segment id");
        assert!(
            anchored_xml.contains(&format!("w:name=\"tlseg-{segment_id}\"")),
            "missing anchor for segment {segment_id}"
        );
    }
    // The anchored artifact still parses as the same bilingual table, with
    // the edited row updated and the untouched row preserved.
    let rows = tl_filter_docx::extract_bilingual_table_rows(
        harness.path_of("bilingual-anchored.out.docx").as_ref(),
    )
    .expect("reparse anchored export");
    let updated = rows
        .iter()
        .find(|row| row.table_index == 0 && row.row_number == 1)
        .expect("first data row");
    assert_eq!(updated.cells[1], "你好世界更新");
    let untouched = rows
        .iter()
        .find(|row| row.table_index == 1 && row.row_number == 1)
        .expect("second data row");
    assert_eq!(untouched.cells[1], "第二译文");
}

#[test]
fn custom_srx_controls_segmentation_and_export_reassembles() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let srx_path = harness.write_file(
        "custom.srx",
        r#"<srx version="2.0"><header/><body>
          <languagerules><languagerule languagerulename="custom" languagepattern="en.*">
            <rule break="no"><beforebreak>Alpha\.</beforebreak><afterbreak>\s</afterbreak></rule>
            <rule break="yes"><beforebreak>\.</beforebreak><afterbreak>\s</afterbreak></rule>
          </languagerule></languagerules>
          <maprules><maprule languagerulename="custom" languagepattern="en.*"/></maprules>
        </body></srx>"#,
    );
    let source_path = harness.write_file("srx-job.txt", "Alpha. Beta. Gamma.\n");

    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": source_path, "srxPath": srx_path }),
    );
    let document_id = imported["document"]["id"].as_str().expect("id").to_string();
    let segments = harness.segments(&document_id);
    assert_eq!(
        segments.len(),
        2,
        "custom no-break rule keeps Alpha+Beta together"
    );
    assert_eq!(segments[0]["sourceText"], "Alpha. Beta.");
    assert_eq!(segments[1]["sourceText"], "Gamma.");

    // Translate both sentences and export: the paragraph reassembles with the
    // original inter-sentence gap.
    let first = harness.set_target(&segments[0], "第一句。");
    harness.confirm(&first);
    let second = harness.set_target(&segments[1], "第二句。");
    harness.confirm(&second);
    let output_path = harness.path_of("srx-job.out.txt");
    harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": output_path }),
    );
    let exported = std::fs::read_to_string(harness.path_of("srx-job.out.txt")).expect("output");
    assert_eq!(exported, "第一句。 第二句。\n");

    // Paragraph mode keeps the whole line as one segment.
    let paragraph_source = harness.write_file("para-job.txt", "One. Two. Three.\n");
    let paragraph = harness.call(
        "document.import",
        json!({
            "projectId": project_id,
            "sourcePath": paragraph_source,
            "segmentation": "paragraph",
        }),
    );
    assert_eq!(paragraph["segmentCount"], 1);

    // A malformed SRX fails the import cleanly.
    let broken_srx = harness.write_file("broken.srx", "<srx><body></body></srx>");
    let another_source = harness.write_file("another.txt", "Text.\n");
    assert_eq!(
        harness.call_err(
            "document.import",
            json!({
                "projectId": project_id,
                "sourcePath": another_source,
                "srxPath": broken_srx,
            }),
        ),
        "invalidParams"
    );
}

#[test]
fn docx_export_embeds_segment_anchors_only_when_requested() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let source = harness.directory.path().join("anchored-source.docx");
    tl_filter_docx::fixture::write_fixture(&source).expect("write docx fixture");
    let imported = harness.call(
        "document.import",
        json!({ "projectId": project_id, "sourcePath": source.display().to_string() }),
    );
    let document_id = imported["document"]["id"].as_str().expect("id").to_string();
    let segments = harness.segments(&document_id);
    assert_eq!(segments.len(), 3, "fixture yields three DOCX paragraphs");
    harness.set_target(&segments[0], "保留期为 30 天。");

    let document_xml_of = |path: &str| -> String {
        let package =
            tl_filter_office::OfficePackage::open(std::path::Path::new(path)).expect("package");
        String::from_utf8(package.require("word/document.xml").expect("main").to_vec())
            .expect("utf-8 document part")
    };

    // The plain export — what「导出译文」writes — carries no preview anchors.
    let plain_path = harness.path_of("plain.docx");
    harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": plain_path }),
    );
    assert!(!document_xml_of(&harness.path_of("plain.docx")).contains("tlseg-"));

    // The anchored export bookmarks every paragraph with its first grid
    // segment id — untranslated paragraphs included, since the layout preview
    // renders and must jump from those too.
    let anchored_path = harness.path_of("anchored.docx");
    let result = harness.call(
        "document.export",
        json!({
            "documentId": document_id,
            "outputPath": anchored_path,
            "segmentAnchors": true,
        }),
    );
    assert_eq!(result["translatedSegments"], 1);
    let anchored_xml = document_xml_of(&harness.path_of("anchored.docx"));
    for segment in &segments {
        let segment_id = segment["id"].as_str().expect("segment id");
        assert!(
            anchored_xml.contains(&format!("w:name=\"tlseg-{segment_id}\"")),
            "missing anchor for segment {segment_id}"
        );
    }
}

/// document.remove deletes the document row, its segments, and its QA
/// issues in one call — and nothing else. The project TM (including the
/// entry confirmed from the removed document), the attached termbase, the
/// sibling document, and the original file on disk all survive; only the
/// engine's managed copy of the source is deleted. A restart proves the
/// rows are gone from SQLite, not just from engine memory.
#[test]
fn document_remove_deletes_rows_keeps_assets_and_survives_restart() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    // A termbase mount that must survive the removal untouched.
    let termbase = harness.call(
        "termbase.create",
        json!({ "name": "Kept glossary", "sourceLocale": "en-US" }),
    );
    let termbase_id = termbase["id"].as_str().expect("termbase id").to_string();
    harness.call(
        "termbase.attach",
        json!({ "projectId": project_id, "termbaseId": termbase_id }),
    );

    let doomed_id = harness.import_txt(
        &project_id,
        "doomed.txt",
        "Hello world.\n\nThe count is 30.\n",
    );
    let kept_id = harness.import_txt(&project_id, "kept.txt", "Keep me around.\n");

    // A confirmed segment writes the project TM; a wrong number gives the
    // QA run an open issue to persist. Both hang off the doomed document.
    let segments = harness.segments(&doomed_id);
    assert_eq!(segments.len(), 2);
    let drafted = harness.set_target(&segments[0], "你好，世界。");
    harness.confirm(&drafted);
    harness.set_target(&segments[1], "数量是 60。");
    let run = harness.call("qa.run", json!({ "documentId": doomed_id }));
    let open_issues = run["openIssues"].as_u64().expect("open issues");
    assert!(open_issues >= 1, "the number mismatch persists an issue");

    // The engine's managed copy exists before the removal.
    let managed_dir = harness
        .directory
        .path()
        .join("data")
        .join("documents")
        .join(&doomed_id);
    assert!(managed_dir.is_dir(), "managed copy exists after import");

    let removed = harness.call("document.remove", json!({ "documentId": doomed_id }));
    assert_eq!(removed["document"]["id"].as_str(), Some(doomed_id.as_str()));
    assert_eq!(removed["removedSegments"].as_u64(), Some(2));
    assert!(removed["removedQaIssues"].as_u64().expect("qa count") >= open_issues);
    assert_eq!(removed["managedCopyDeleted"].as_bool(), Some(true));

    // Deleted: the document row, its segments, and its QA issues.
    let listed = harness.call("document.list", json!({ "projectId": project_id }));
    let documents = listed["documents"].as_array().expect("documents");
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0]["id"].as_str(), Some(kept_id.as_str()));
    assert_eq!(
        harness.call_err("segment.list", json!({ "documentId": doomed_id })),
        "notFound"
    );
    assert_eq!(
        harness.call_err("qa.list", json!({ "documentId": doomed_id })),
        "notFound"
    );
    assert_eq!(
        harness.call_err(
            "document.export",
            json!({ "documentId": doomed_id, "outputPath": harness.path_of("gone.txt") }),
        ),
        "notFound"
    );

    // Kept: the project TM still serves the confirmed translation, the
    // termbase mount is untouched, the sibling document still lists its
    // segments, and the original import file is still on disk.
    let lookup = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Hello world.", "minScore": 100 }),
    );
    assert_eq!(lookup["matches"].as_array().expect("matches").len(), 1);
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"].as_u64(), Some(1));
    let termbases = harness.call("termbase.list", json!({ "projectId": project_id }));
    assert_eq!(termbases["mounts"].as_array().expect("mounts").len(), 1);
    assert_eq!(harness.segments(&kept_id).len(), 1);
    assert!(
        std::path::Path::new(&harness.path_of("doomed.txt")).is_file(),
        "the original file outside the data dir is never touched"
    );
    assert!(
        !managed_dir.exists(),
        "the engine-managed copy is deleted with the document"
    );

    // Restart: the deletion is in SQLite, not just in engine memory.
    harness.reopen();
    let listed = harness.call("document.list", json!({ "projectId": project_id }));
    let documents = listed["documents"].as_array().expect("documents");
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0]["id"].as_str(), Some(kept_id.as_str()));
    assert_eq!(
        harness.call_err("segment.list", json!({ "documentId": doomed_id })),
        "notFound"
    );
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"].as_u64(), Some(1), "TM survives the restart too");
    assert_eq!(harness.segments(&kept_id).len(), 1);

    // Removing again — or removing an id that never existed — is an honest
    // NotFound, not a silent success.
    assert_eq!(
        harness.call_err("document.remove", json!({ "documentId": doomed_id })),
        "notFound"
    );
    assert_eq!(
        harness.call_err("document.remove", json!({ "documentId": "missing" })),
        "notFound"
    );
}

/// Where `document.remove` meets `qa.waive`: the cascade drops waived
/// issues along with open ones. A waiver is a human decision about one
/// document's finding, so it must not outlive the document — after the
/// removal (and a restart) no waived row remains for the old issue id.
#[test]
fn document_remove_drops_waived_issues_with_the_document() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "waived-then-removed.txt",
        "The amount is 30.\n\nThe size is 50.\n",
    );
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "金额是 40。");
    harness.set_target(&segments[1], "大小是 60。");

    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(run["openIssues"], 2);
    let waived_id = run["issues"][0]["id"]
        .as_str()
        .expect("issue id")
        .to_string();
    let waived = harness.call(
        "qa.waive",
        json!({ "issueId": waived_id, "waived": true, "note": "客户已确认" }),
    );
    assert_eq!(waived["issues"][0]["status"], "waived");

    // The removal counts the waived row alongside the open one.
    let removed = harness.call("document.remove", json!({ "documentId": document_id }));
    assert_eq!(removed["removedQaIssues"].as_u64(), Some(2));

    // Gone from SQLite, not just from engine memory: after a restart the
    // document's QA list is gone and the waived issue id no longer resolves
    // for a restore attempt.
    harness.reopen();
    assert_eq!(
        harness.call_err("qa.list", json!({ "documentId": document_id })),
        "notFound"
    );
    assert_eq!(
        harness.call_err("qa.waive", json!({ "issueId": waived_id, "waived": false })),
        "notFound"
    );
}

/// segment.replace rewrites target text case-insensitively across one
/// document in a single call: drafts are rewritten in place, confirmed
/// segments are skipped (and counted) unless includeConfirmed demotes them
/// back to draft, the TM entry written by an earlier confirmation is never
/// touched, and the rewrites survive a restart.
#[test]
fn segment_replace_rewrites_targets_and_respects_confirmations() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "replace.txt",
        "First line.\n\nSecond line.\n\nThird line.\n\nFourth line.\n",
    );
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "Server 已就绪");
    let confirmed = harness.set_target(&segments[1], "重启 server");
    harness.confirm(&confirmed);
    harness.set_target(&segments[2], "server Server SERVER");
    // segments[3] stays untranslated: an empty target can never match.

    // Empty find and unknown documents fail honestly.
    assert_eq!(
        harness.call_err(
            "segment.replace",
            json!({ "documentId": document_id, "find": "", "replaceWith": "x" }),
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "segment.replace",
            json!({ "documentId": "missing", "find": "a", "replaceWith": "b" }),
        ),
        "notFound"
    );

    // Default run: drafts are rewritten, the confirmed match is skipped.
    let replaced = harness.call(
        "segment.replace",
        json!({ "documentId": document_id, "find": "server", "replaceWith": "服务器" }),
    );
    assert_eq!(replaced["replacedOccurrences"], 4);
    assert_eq!(replaced["skippedConfirmed"], 1);
    assert_eq!(replaced["demotedConfirmed"], 0);
    let rows = replaced["segments"].as_array().expect("segments");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["targetText"], "服务器 已就绪");
    assert_eq!(rows[0]["state"], "draft");
    assert_eq!(rows[1]["targetText"], "服务器 服务器 服务器");

    let after = harness.segments(&document_id);
    assert_eq!(
        after[1]["targetText"], "重启 server",
        "confirmed segment untouched without includeConfirmed"
    );
    assert_eq!(after[1]["state"], "confirmed");
    assert_eq!(after[3]["targetText"], "", "untranslated row untouched");

    // includeConfirmed rewrites the confirmed row and demotes it to draft;
    // the TM entry from its confirmation keeps the old translation.
    let with_confirmed = harness.call(
        "segment.replace",
        json!({
            "documentId": document_id,
            "find": "server",
            "replaceWith": "服务器",
            "includeConfirmed": true,
        }),
    );
    assert_eq!(with_confirmed["replacedOccurrences"], 1);
    assert_eq!(with_confirmed["demotedConfirmed"], 1);
    assert_eq!(with_confirmed["skippedConfirmed"], 0);
    assert_eq!(with_confirmed["segments"][0]["targetText"], "重启 服务器");
    assert_eq!(with_confirmed["segments"][0]["state"], "draft");
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"], 1);
    assert_eq!(
        tm["entries"][0]["targetText"], "重启 server",
        "replace drafts, it never rewrites the TM"
    );

    // A replacement that empties the target honestly reverts the row to
    // untranslated, mirroring segment.update semantics.
    let emptied = harness.call(
        "segment.replace",
        json!({ "documentId": document_id, "find": "重启 服务器", "replaceWith": "" }),
    );
    assert_eq!(emptied["segments"][0]["state"], "untranslated");
    assert_eq!(emptied["segments"][0]["targetText"], "");

    // The rewrites live in SQLite, not only in engine memory.
    harness.reopen();
    let persisted = harness.segments(&document_id);
    assert_eq!(persisted[0]["targetText"], "服务器 已就绪");
    assert_eq!(persisted[1]["targetText"], "");
    assert_eq!(persisted[1]["state"], "untranslated");
    assert_eq!(persisted[2]["targetText"], "服务器 服务器 服务器");
}

/// document.list reports honest per-document progress counts (segment
/// states plus open QA issues) straight from SQL, aligned with the
/// documents list, and stays correct after edits and a restart.
#[test]
fn document_list_reports_per_document_progress() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let first_id = harness.import_txt(
        &project_id,
        "progress-a.txt",
        "The amount is 30.\n\nSecond line.\n\nThird line.\n",
    );
    let second_id = harness.import_txt(&project_id, "progress-b.txt", "One.\n\nTwo.\n");

    // Fresh imports: everything untranslated, no issues.
    let listed = harness.call("document.list", json!({ "projectId": project_id }));
    let documents = listed["documents"].as_array().expect("documents");
    let progress = listed["progress"].as_array().expect("progress");
    assert_eq!(documents.len(), 2);
    assert_eq!(progress.len(), 2);
    for (document, entry) in documents.iter().zip(progress) {
        assert_eq!(document["id"], entry["documentId"], "aligned by order");
    }
    // sourceWords follows the documented 口径 (UAX #29; numbers count 1):
    // "The amount is 30." = 4, "Second line." = 2, "Third line." = 2.
    assert_eq!(
        progress[0]["counts"],
        json!({
            "total": 3,
            "untranslated": 3,
            "draft": 0,
            "confirmed": 0,
            "openIssues": 0,
            "sourceWords": 8,
        })
    );

    // One draft with a number mismatch (open QA issues after qa.run), one
    // confirmation, one row untouched. The progress open count must agree
    // with what qa.run itself reports.
    let segments = harness.segments(&first_id);
    harness.set_target(&segments[0], "金额是 40。");
    let updated = harness.set_target(&segments[1], "第二行。");
    harness.confirm(&updated);
    let run = harness.call("qa.run", json!({ "documentId": first_id }));
    let open_issues = run["openIssues"].as_u64().expect("open issues");
    assert!(open_issues >= 1, "the number mismatch must open an issue");

    let listed = harness.call("document.list", json!({ "projectId": project_id }));
    let progress = listed["progress"].as_array().expect("progress");
    let first = progress
        .iter()
        .find(|entry| entry["documentId"] == json!(first_id))
        .expect("first document progress");
    assert_eq!(
        first["counts"],
        json!({
            "total": 3,
            "untranslated": 1,
            "draft": 1,
            "confirmed": 1,
            "openIssues": open_issues,
            // Target edits never move the source word count.
            "sourceWords": 8,
        })
    );
    let second = progress
        .iter()
        .find(|entry| entry["documentId"] == json!(second_id))
        .expect("second document progress");
    assert_eq!(
        second["counts"],
        json!({
            "total": 2,
            "untranslated": 2,
            "draft": 0,
            "confirmed": 0,
            "openIssues": 0,
            "sourceWords": 2,
        })
    );

    // Waiving one issue removes exactly it from the open count without
    // touching the segment states.
    let issues = harness.call("qa.list", json!({ "documentId": first_id }));
    let issue_id = issues["issues"][0]["id"].as_str().expect("issue id");
    harness.call("qa.waive", json!({ "issueId": issue_id, "waived": true }));
    let listed = harness.call("document.list", json!({ "projectId": project_id }));
    assert_eq!(
        listed["progress"][0]["counts"]["openIssues"],
        json!(open_issues - 1)
    );

    // Counts answer from SQL identically after a restart.
    harness.reopen();
    let listed = harness.call("document.list", json!({ "projectId": project_id }));
    let first = listed["progress"]
        .as_array()
        .expect("progress")
        .iter()
        .find(|entry| entry["documentId"] == json!(first_id))
        .cloned()
        .expect("first document progress");
    assert_eq!(
        first["counts"],
        json!({
            "total": 3,
            "untranslated": 1,
            "draft": 1,
            "confirmed": 1,
            "openIssues": open_issues - 1,
            "sourceWords": 8,
        })
    );
}

/// segment.lock toggles the engine-owned flag with optimistic concurrency,
/// survives a restart, and guards the direct write paths: update and
/// confirm on a locked row are honest conflicts until it is unlocked.
#[test]
fn segment_lock_toggles_and_guards_update_and_confirm() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(&project_id, "lock.txt", "First line.\n\nSecond line.\n");
    let segments = harness.segments(&document_id);
    let drafted = harness.set_target(&segments[0], "第一行。");

    // Stale baseRevision and unknown ids fail honestly.
    assert_eq!(
        harness.call_err(
            "segment.lock",
            json!({ "segmentId": drafted["id"], "locked": true, "baseRevision": 1 }),
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err(
            "segment.lock",
            json!({ "segmentId": "missing", "locked": true, "baseRevision": 1 }),
        ),
        "notFound"
    );

    let locked = harness.lock(&drafted, true);
    assert_eq!(locked["locked"], true);
    assert_eq!(locked["state"], "draft", "lock is orthogonal to state");
    assert_eq!(
        locked["revision"].as_u64(),
        drafted["revision"].as_u64().map(|revision| revision + 1)
    );

    // Locked: editing and confirming conflict instead of writing.
    assert_eq!(
        harness.call_err(
            "segment.update",
            json!({
                "segmentId": locked["id"],
                "targetText": "改写。",
                "baseRevision": locked["revision"],
            }),
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err(
            "segment.confirm",
            json!({ "segmentId": locked["id"], "baseRevision": locked["revision"] }),
        ),
        "conflict"
    );

    // The flag lives in SQLite, not in engine memory.
    harness.reopen();
    let persisted = harness.segments(&document_id);
    assert_eq!(persisted[0]["locked"], true);
    assert_eq!(persisted[0]["targetText"], "第一行。");
    assert_eq!(persisted[1]["locked"], false);

    // Unlock restores the normal write path.
    let unlocked = harness.lock(&persisted[0], false);
    assert_eq!(unlocked["locked"], false);
    let edited = harness.set_target(&unlocked, "第一行（改）。");
    let confirmed = harness.confirm(&edited);
    assert_eq!(confirmed["segment"]["state"], "confirmed");
}

/// Locked rows are read-only for every bulk write: replace skips and counts
/// them (even with includeConfirmed), pretranslate sets them aside, and
/// confirm-time propagation never fills them.
#[test]
fn locked_segments_skip_replace_pretranslate_and_propagation() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    // Replace: two matching drafts, one locked.
    let replace_doc = harness.import_txt(
        &project_id,
        "lock-replace.txt",
        "First line.\n\nSecond line.\n",
    );
    let segments = harness.segments(&replace_doc);
    harness.set_target(&segments[0], "server 就绪");
    let second = harness.set_target(&segments[1], "重启 server");
    harness.lock(&second, true);
    let replaced = harness.call(
        "segment.replace",
        json!({
            "documentId": replace_doc,
            "find": "server",
            "replaceWith": "服务器",
            "includeConfirmed": true,
        }),
    );
    assert_eq!(replaced["replacedOccurrences"], 1);
    assert_eq!(replaced["skippedLocked"], 1);
    assert_eq!(replaced["segments"].as_array().expect("rows").len(), 1);
    let after = harness.segments(&replace_doc);
    assert_eq!(after[0]["targetText"], "服务器 就绪");
    assert_eq!(
        after[1]["targetText"], "重启 server",
        "locked row untouched"
    );

    // Propagation: confirming a duplicate source skips the locked sibling.
    let source_doc = harness.import_txt(
        &project_id,
        "lock-propagate-a.txt",
        "Shared sentence here.\n",
    );
    let sibling_doc = harness.import_txt(
        &project_id,
        "lock-propagate-b.txt",
        "Shared sentence here.\n\nShared sentence here.\n",
    );
    let siblings = harness.segments(&sibling_doc);
    harness.lock(&siblings[0], true);
    let origin = harness.segments(&source_doc)[0].clone();
    let drafted = harness.set_target(&origin, "这里是共享句子。");
    let confirmed = harness.confirm(&drafted);
    let propagated = confirmed["propagated"].as_array().expect("propagated");
    assert_eq!(propagated.len(), 1, "locked sibling is not propagated");
    assert_eq!(propagated[0]["id"], siblings[1]["id"]);
    let siblings_after = harness.segments(&sibling_doc);
    assert_eq!(siblings_after[0]["targetText"], "");
    assert_eq!(siblings_after[0]["state"], "untranslated");
    assert_eq!(siblings_after[1]["targetText"], "这里是共享句子。");

    // Pretranslate: the locked untranslated row is reported, never filled.
    let pretranslated = harness.call(
        "tm.pretranslate",
        json!({ "documentId": sibling_doc, "minScore": 75 }),
    );
    assert_eq!(pretranslated["checked"], 0, "only the locked row was left");
    assert_eq!(pretranslated["skippedLocked"], 1);
    assert_eq!(pretranslated["pretranslated"], 0);
    let final_rows = harness.segments(&sibling_doc);
    assert_eq!(final_rows[0]["targetText"], "");
    assert_eq!(final_rows[0]["locked"], true);
}

/// segment.confirm refreshes the confirmed segment's QA in the same
/// transaction: findings open as issues in the result and the dock list,
/// the confirm itself never blocks, the TM write still happens, and a
/// later confirm of the fixed text resolves the issue.
#[test]
fn segment_confirm_refreshes_segment_qa_without_blocking() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(&project_id, "confirm-qa.txt", "The amount is 30.\n");
    let segments = harness.segments(&document_id);

    // Confirm a number mismatch: the confirm succeeds and reports the issue.
    let drafted = harness.set_target(&segments[0], "金额是 40。");
    let confirmed = harness.confirm(&drafted);
    assert_eq!(confirmed["segment"]["state"], "confirmed");
    assert_eq!(
        confirmed["tmEntry"]["targetText"], "金额是 40。",
        "QA findings never block the confirm or its TM write"
    );
    let issues = confirmed["qaIssues"].as_array().expect("qa issues");
    let open: Vec<&Value> = issues
        .iter()
        .filter(|issue| issue["status"] == "open")
        .collect();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0]["ruleId"], "qa.number-mismatch");

    // The issue is already in the dock list without a manual qa.run.
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    assert_eq!(listed["total"], 1);
    assert_eq!(listed["issues"][0]["status"], "open");

    // Fix the number and confirm again: the same transaction resolves it.
    let refreshed = harness.segments(&document_id)[0].clone();
    let fixed = harness.set_target(&refreshed, "金额是 30。");
    let reconfirmed = harness.confirm(&fixed);
    let issues = reconfirmed["qaIssues"].as_array().expect("qa issues");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0]["status"], "resolved");
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    assert_eq!(listed["issues"][0]["status"], "resolved");

    // The refresh is persisted with the confirm, not recomputed on read.
    harness.reopen();
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    assert_eq!(listed["total"], 1);
    assert_eq!(listed["issues"][0]["status"], "resolved");
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["entries"][0]["targetText"], "金额是 30。");
}

/// qa.run leaves locked rows out entirely: they are not checked, produce no
/// candidates, and their existing issues stay open instead of being
/// dishonestly resolved by a run that never looked at them.
#[test]
fn qa_run_excludes_locked_segments_and_keeps_their_issues() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "lock-qa.txt",
        "The amount is 30.\n\nThe total is 50.\n",
    );
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "金额是 40。");
    let second = harness.set_target(&segments[1], "总额是 60。");

    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(run["checkedSegments"], 2);
    assert_eq!(run["openIssues"], 2);

    // Lock the second row, fix the first, and re-run.
    harness.lock(&second, true);
    let first = harness.segments(&document_id)[0].clone();
    harness.set_target(&first, "金额是 30。");
    let rerun = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(rerun["checkedSegments"], 1, "locked row is not checked");
    assert_eq!(
        rerun["openIssues"], 1,
        "the locked row's issue stays open; the fixed row's resolves"
    );
    let issues = rerun["issues"].as_array().expect("issues");
    let by_segment = |segment_id: &Value| {
        issues
            .iter()
            .find(|issue| &issue["segmentId"] == segment_id)
            .expect("issue for segment")
    };
    assert_eq!(by_segment(&segments[0]["id"])["status"], "resolved");
    assert_eq!(by_segment(&segments[1]["id"])["status"], "open");

    // Unlock and fix: the next run resolves the remaining issue honestly.
    let locked_row = harness.segments(&document_id)[1].clone();
    let unlocked = harness.lock(&locked_row, false);
    harness.set_target(&unlocked, "总额是 50。");
    let final_run = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(final_run["checkedSegments"], 2);
    assert_eq!(final_run["openIssues"], 0);
}

/// PRD S3 ④ Correction channel: `qa.fix.list` proposes deterministic
/// corrections for mechanically fixable open findings only, and
/// `qa.fix.apply` rewrites the segment through the exact `segment.update`
/// guards with a same-transaction segment QA refresh. Applying never
/// confirms and never writes TM.
#[test]
fn qa_fix_lists_and_applies_engine_corrections() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "fix.txt",
        "The retention period is 30 days.\n\nHello world.\n\nSave the file.\n",
    );
    let segments = harness.segments(&document_id);
    // Fixable: wrong number (unambiguous single-number shape).
    harness.set_target(&segments[0], "保留期为 60 天。");
    // Fixable: edge whitespace.
    harness.set_target(&segments[1], " 你好世界。 ");
    // segments[2] stays empty: qa.empty-target has no mechanical fix.
    harness.call("qa.run", json!({ "documentId": document_id }));

    let listed = harness.call("qa.fix.list", json!({ "documentId": document_id }));
    let fixes = listed["fixes"].as_array().expect("fixes");
    let fix_for = |rule_id: &str| {
        fixes
            .iter()
            .find(|fix| fix["ruleId"] == rule_id)
            .unwrap_or_else(|| panic!("no fix for {rule_id} in {fixes:?}"))
    };
    let number_fix = fix_for("qa.number-mismatch");
    assert_eq!(number_fix["currentTargetText"], "保留期为 60 天。");
    assert_eq!(number_fix["fixedTargetText"], "保留期为 30 天。");
    assert_eq!(number_fix["segmentId"], segments[0]["id"]);
    let whitespace_fix = fix_for("qa.edge-whitespace");
    assert_eq!(whitespace_fix["fixedTargetText"], "你好世界。");
    // The empty target's finding offers no fake 一键修复.
    assert!(
        fixes.iter().all(|fix| fix["ruleId"] != "qa.empty-target"),
        "unfixable rules must not appear: {fixes:?}"
    );

    // Stale baseRevision conflicts before anything is written.
    assert_eq!(
        harness.call_err(
            "qa.fix.apply",
            json!({
                "issueId": number_fix["issueId"],
                "baseRevision": number_fix["baseRevision"].as_u64().expect("revision") + 7,
            }),
        ),
        "conflict"
    );

    // Apply the number fix: the segment carries the engine's text verbatim
    // and its QA refreshes in the same transaction.
    let applied = harness.call(
        "qa.fix.apply",
        json!({
            "issueId": number_fix["issueId"],
            "baseRevision": number_fix["baseRevision"],
        }),
    );
    assert_eq!(applied["segment"]["targetText"], "保留期为 30 天。");
    assert_eq!(applied["segment"]["state"], "draft");
    let refreshed = applied["qaIssues"].as_array().expect("refreshed issues");
    let number_issue = refreshed
        .iter()
        .find(|issue| issue["ruleId"] == "qa.number-mismatch")
        .expect("number issue after refresh");
    assert_eq!(number_issue["status"], "resolved");
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"], 0, "applying a fix must never write TM");

    // The issue resolved, so a second apply has nothing left to fix; the
    // fix list stops offering it too.
    assert_eq!(
        harness.call_err(
            "qa.fix.apply",
            json!({
                "issueId": number_fix["issueId"],
                "baseRevision": applied["segment"]["revision"],
            }),
        ),
        "conflict"
    );
    let relisted = harness.call("qa.fix.list", json!({ "documentId": document_id }));
    assert!(
        relisted["fixes"]
            .as_array()
            .expect("fixes")
            .iter()
            .all(|fix| fix["ruleId"] != "qa.number-mismatch"),
        "a resolved finding must not keep offering its fix"
    );
}

/// Corrections respect the same shields as editing: locked segments offer
/// no fix and refuse to apply one; a confirmed segment honestly returns to
/// draft when its text is rewritten.
#[test]
fn qa_fix_apply_shields_locked_rows_and_demotes_confirmed() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "fix-guard.txt",
        "The amount is 30.\n\nThe size is 50.\n",
    );
    let segments = harness.segments(&document_id);
    harness.set_target(&segments[0], "金额是 40。");
    // Confirm the second row with a fixable whitespace problem: confirm-time
    // QA records the issue and the confirm writes TM.
    let drafted = harness.set_target(&segments[1], " 大小是 50。 ");
    harness.confirm(&drafted);
    harness.call("qa.run", json!({ "documentId": document_id }));

    // Lock the first row: its finding disappears from the fix list and an
    // apply against it conflicts.
    let listed = harness.call("qa.fix.list", json!({ "documentId": document_id }));
    let number_fix = listed["fixes"]
        .as_array()
        .expect("fixes")
        .iter()
        .find(|fix| fix["ruleId"] == "qa.number-mismatch")
        .expect("number fix before locking")
        .clone();
    let first = harness.segments(&document_id)[0].clone();
    harness.lock(&first, true);
    let relisted = harness.call("qa.fix.list", json!({ "documentId": document_id }));
    assert!(
        relisted["fixes"]
            .as_array()
            .expect("fixes")
            .iter()
            .all(|fix| fix["segmentId"] != segments[0]["id"]),
        "locked rows must not offer fixes"
    );
    let locked_revision = harness.segments(&document_id)[0]["revision"].clone();
    assert_eq!(
        harness.call_err(
            "qa.fix.apply",
            json!({ "issueId": number_fix["issueId"], "baseRevision": locked_revision }),
        ),
        "conflict"
    );

    // Apply the whitespace fix on the confirmed row: the rewrite demotes it
    // to draft — the confirmation covered the old text — and the issue
    // resolves in the same transaction.
    let whitespace_fix = relisted["fixes"]
        .as_array()
        .expect("fixes")
        .iter()
        .find(|fix| fix["ruleId"] == "qa.edge-whitespace")
        .expect("whitespace fix")
        .clone();
    let applied = harness.call(
        "qa.fix.apply",
        json!({
            "issueId": whitespace_fix["issueId"],
            "baseRevision": whitespace_fix["baseRevision"],
        }),
    );
    assert_eq!(applied["segment"]["targetText"], "大小是 50。");
    assert_eq!(
        applied["segment"]["state"], "draft",
        "a fixed confirmed segment returns to draft"
    );
    assert!(
        applied["qaIssues"]
            .as_array()
            .expect("issues")
            .iter()
            .filter(|issue| issue["ruleId"] == "qa.edge-whitespace")
            .all(|issue| issue["status"] == "resolved"),
    );

    // Waived findings are a recorded human decision, not a fix queue.
    let waived = harness.call(
        "qa.waive",
        json!({ "issueId": number_fix["issueId"], "waived": true }),
    );
    assert_eq!(waived["issues"][0]["status"], "waived");
    let after_waive = harness.call("qa.fix.list", json!({ "documentId": document_id }));
    assert!(
        after_waive["fixes"]
            .as_array()
            .expect("fixes")
            .iter()
            .all(|fix| fix["issueId"] != number_fix["issueId"]),
        "waived findings must not offer fixes"
    );
}

/// Granular waivers (PRD ③): one call can waive per rule (document-scoped)
/// or per segment; storage stays per-issue, batches skip rows already in
/// the requested state, and the strict per-issue conflicts are untouched.
#[test]
fn qa_waive_supports_rule_and_segment_granularity() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(
        &project_id,
        "granular.txt",
        "The amount is 30.\n\nThe size is 50.\n",
    );
    let segments = harness.segments(&document_id);
    // Segment 0: number mismatch + edge whitespace; segment 1: mismatch only.
    harness.set_target(&segments[0], " 金额是 40。");
    harness.set_target(&segments[1], "大小是 60。");
    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    assert_eq!(run["openIssues"], 3);

    // Waive by rule: both number mismatches flip; the whitespace issue and
    // the segment states stay untouched.
    let by_rule = harness.call(
        "qa.waive",
        json!({
            "ruleId": "qa.number-mismatch",
            "documentId": document_id,
            "waived": true,
            "note": "数字以译文为准",
        }),
    );
    let affected = by_rule["issues"].as_array().expect("affected issues");
    assert_eq!(affected.len(), 2);
    assert!(affected.iter().all(|issue| issue["status"] == "waived"
        && issue["ruleId"] == "qa.number-mismatch"
        && issue["waiveNote"] == "数字以译文为准"));
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    let open_rules: Vec<&str> = listed["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter(|issue| issue["status"] == "open")
        .filter_map(|issue| issue["ruleId"].as_str())
        .collect();
    assert_eq!(open_rules, vec!["qa.edge-whitespace"]);
    let tm = harness.call("tm.list", json!({ "projectId": project_id }));
    assert_eq!(tm["total"], 0, "batch waiving must never write TM");

    // The batch is idempotent: nothing left to flip, nothing touched.
    let again = harness.call(
        "qa.waive",
        json!({ "ruleId": "qa.number-mismatch", "documentId": document_id, "waived": true }),
    );
    assert_eq!(again["issues"].as_array().expect("issues").len(), 0);

    // Restore by rule flips both back and drops the notes.
    let restored = harness.call(
        "qa.waive",
        json!({ "ruleId": "qa.number-mismatch", "documentId": document_id, "waived": false }),
    );
    let affected = restored["issues"].as_array().expect("affected issues");
    assert_eq!(affected.len(), 2);
    assert!(
        affected
            .iter()
            .all(|issue| issue["status"] == "open" && issue["waiveNote"].is_null())
    );

    // Waive by segment: only segment 0's two issues flip.
    let by_segment = harness.call(
        "qa.waive",
        json!({ "segmentId": segments[0]["id"], "waived": true }),
    );
    let affected = by_segment["issues"].as_array().expect("affected issues");
    assert_eq!(affected.len(), 2);
    assert!(
        affected
            .iter()
            .all(|issue| issue["segmentId"] == segments[0]["id"])
    );
    let listed = harness.call("qa.list", json!({ "documentId": document_id }));
    let open_segments: Vec<&Value> = listed["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter(|issue| issue["status"] == "open")
        .collect();
    assert_eq!(open_segments.len(), 1);
    assert_eq!(open_segments[0]["segmentId"], segments[1]["id"]);

    // Batch waivers persist like per-issue ones: they live on the SQL rows.
    harness.reopen();
    let reloaded = harness.call("qa.list", json!({ "documentId": document_id }));
    let waived_count = reloaded["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter(|issue| issue["status"] == "waived")
        .count();
    assert_eq!(waived_count, 2);

    // Selector validation: exactly one of issueId / ruleId+documentId /
    // segmentId, and honest notFound for unknown scopes.
    assert_eq!(
        harness.call_err("qa.waive", json!({ "waived": true })),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({
                "ruleId": "qa.number-mismatch",
                "documentId": document_id,
                "segmentId": segments[0]["id"],
                "waived": true,
            })
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({ "ruleId": "qa.number-mismatch", "waived": true })
        ),
        "invalidParams",
        "per-rule waivers are document-scoped by contract"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({ "segmentId": segments[0]["id"], "documentId": document_id, "waived": true })
        ),
        "invalidParams",
        "documentId only scopes ruleId"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({ "ruleId": "qa.number-mismatch", "documentId": "missing", "waived": true })
        ),
        "notFound"
    );
    assert_eq!(
        harness.call_err(
            "qa.waive",
            json!({ "segmentId": "missing", "waived": true })
        ),
        "notFound"
    );
}

/// The behavioral check: confirming a fuzzy TM match without editing it
/// opens `qa.unedited-fuzzy` at confirm time (warning, score in params),
/// the confirm and its TM write still go through, a full qa.run reproduces
/// the same issue instead of duplicating it, and editing the target before
/// re-confirming resolves it.
#[test]
fn confirming_an_unedited_fuzzy_match_opens_a_behavioral_warning() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(&project_id, "fuzzy.txt", "Save the file.\n");
    let segment = harness.segments(&document_id)[0].clone();

    // Apply a fuzzy TM match: the write stamps tmFuzzy with the real score.
    let applied = harness.call(
        "segment.update",
        json!({
            "segmentId": segment["id"],
            "targetText": "保存文件。",
            "baseRevision": segment["revision"],
            "origin": { "kind": "tmFuzzy", "score": 82 },
        }),
    )["segment"]
        .clone();
    assert_eq!(applied["origin"]["edited"], false);

    // Confirm without touching the text: warning opens, confirm not blocked.
    let confirmed = harness.confirm(&applied);
    assert_eq!(confirmed["segment"]["state"], "confirmed");
    assert_eq!(
        confirmed["tmEntry"]["targetText"], "保存文件。",
        "the behavioral warning never blocks the confirm or its TM write"
    );
    let issues = confirmed["qaIssues"].as_array().expect("qa issues");
    let behavioral = issues
        .iter()
        .find(|issue| issue["ruleId"] == "qa.unedited-fuzzy")
        .expect("unedited-fuzzy issue");
    assert_eq!(behavioral["status"], "open");
    assert_eq!(behavioral["severity"], "warning");
    assert_eq!(behavioral["params"]["score"], "82");

    // A full run reproduces the same fingerprint: no duplicate row.
    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    let behavioral_rows: Vec<&Value> = run["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .filter(|issue| issue["ruleId"] == "qa.unedited-fuzzy")
        .collect();
    assert_eq!(behavioral_rows.len(), 1);
    assert_eq!(behavioral_rows[0]["status"], "open");
    assert_eq!(behavioral_rows[0]["id"], behavioral["id"]);

    // Editing the target marks the origin edited; re-confirming resolves
    // the behavioral issue in the same transaction.
    let current = harness.segments(&document_id)[0].clone();
    let edited = harness.set_target(&current, "保存该文件。");
    assert_eq!(edited["origin"]["edited"], true);
    let reconfirmed = harness.confirm(&edited);
    let refreshed = reconfirmed["qaIssues"].as_array().expect("qa issues");
    let behavioral = refreshed
        .iter()
        .find(|issue| issue["ruleId"] == "qa.unedited-fuzzy")
        .expect("behavioral row is kept, resolved");
    assert_eq!(behavioral["status"], "resolved");

    // Exact matches are not fuzzy: confirming an unedited tmExact apply
    // stays clean.
    let other_doc = harness.import_txt(&project_id, "exact.txt", "Close the file.\n");
    let other = harness.segments(&other_doc)[0].clone();
    let exact = harness.call(
        "segment.update",
        json!({
            "segmentId": other["id"],
            "targetText": "关闭文件。",
            "baseRevision": other["revision"],
            "origin": { "kind": "tmExact", "score": 100 },
        }),
    )["segment"]
        .clone();
    let confirmed = harness.confirm(&exact);
    assert!(
        confirmed["qaIssues"]
            .as_array()
            .expect("qa issues")
            .iter()
            .all(|issue| issue["ruleId"] != "qa.unedited-fuzzy"),
        "tmExact confirms never fire the fuzzy behavioral check"
    );
}

/// qa.profile.get/update: the project layer clones and overrides the
/// built-in profile — severity remaps flow into qa.run results, settings
/// that cannot compile are refused instead of stored, stale revisions
/// conflict, and the stored overrides survive a restart.
#[test]
fn qa_profile_overrides_remap_severity_and_guard_updates() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(&project_id, "profile.txt", "The amount is 30.\n");
    let segment = harness.segments(&document_id)[0].clone();
    harness.set_target(&segment, "金额是 40。");

    // Fresh project: the zh-CN default base, no remaps, gate off.
    let view = harness.call("qa.profile.get", json!({ "projectId": project_id }));
    assert_eq!(view["baseProfileId"], "builtin.qa.cjk-professional");
    assert_eq!(view["severityOverrides"], json!({}));
    assert_eq!(view["blockExportOnError"], false);
    assert_eq!(view["settings"]["minLengthRatioPercent"], 35);
    let revision = view["revision"].as_u64().expect("revision");

    // Guards: stale revision, non-rule keys, uncompilable settings, and
    // contradictory settings/clearSettings all refuse without storing.
    assert_eq!(
        harness.call_err(
            "qa.profile.update",
            json!({
                "projectId": project_id,
                "baseRevision": revision + 7,
                "blockExportOnError": true,
            })
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err(
            "qa.profile.update",
            json!({
                "projectId": project_id,
                "baseRevision": revision,
                "severityOverrides": { "not-a-rule": "warning" },
            })
        ),
        "invalidParams"
    );
    let mut broken_settings = view["settings"].clone();
    broken_settings["minLengthRatioPercent"] = json!(500);
    broken_settings["maxLengthRatioPercent"] = json!(100);
    assert_eq!(
        harness.call_err(
            "qa.profile.update",
            json!({
                "projectId": project_id,
                "baseRevision": revision,
                "settings": broken_settings,
            })
        ),
        "invalidParams"
    );
    assert_eq!(
        harness.call_err(
            "qa.profile.update",
            json!({
                "projectId": project_id,
                "baseRevision": revision,
                "settings": view["settings"],
                "clearSettings": true,
            })
        ),
        "invalidParams"
    );
    let unchanged = harness.call("qa.profile.get", json!({ "projectId": project_id }));
    assert_eq!(unchanged["revision"].as_u64(), Some(revision));

    // Remap number-mismatch to warning: the next run reports the remapped
    // severity on the same finding.
    let updated = harness.call(
        "qa.profile.update",
        json!({
            "projectId": project_id,
            "baseRevision": revision,
            "severityOverrides": { "qa.number-mismatch": "warning" },
        }),
    );
    assert_eq!(
        updated["severityOverrides"]["qa.number-mismatch"],
        "warning"
    );
    let bumped = updated["revision"].as_u64().expect("revision");
    assert!(bumped > revision, "a stored override bumps the revision");
    let run = harness.call("qa.run", json!({ "documentId": document_id }));
    let mismatch = run["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .find(|issue| issue["ruleId"] == "qa.number-mismatch")
        .expect("number mismatch issue")
        .clone();
    assert_eq!(mismatch["severity"], "warning");

    // The overrides live on the project row: a restart keeps them.
    harness.reopen();
    let reloaded = harness.call("qa.profile.get", json!({ "projectId": project_id }));
    assert_eq!(
        reloaded["severityOverrides"]["qa.number-mismatch"],
        "warning"
    );
    assert_eq!(reloaded["revision"].as_u64(), Some(bumped));

    // Clearing the remaps restores the built-in severity.
    let cleared = harness.call(
        "qa.profile.update",
        json!({
            "projectId": project_id,
            "baseRevision": bumped,
            "severityOverrides": {},
        }),
    );
    assert_eq!(cleared["severityOverrides"], json!({}));
    let rerun = harness.call("qa.run", json!({ "documentId": document_id }));
    let mismatch = rerun["issues"]
        .as_array()
        .expect("issues")
        .iter()
        .find(|issue| issue["ruleId"] == "qa.number-mismatch")
        .expect("number mismatch issue")
        .clone();
    assert_eq!(mismatch["severity"], "error");
}

/// The QA export gate (PRD S3 ②): off by default, refuses with structured
/// `exportBlocked` data while error-severity open issues exist, lets an
/// explicit override or a recorded waiver through, and runs before the
/// destination-exists check.
#[test]
fn export_gate_blocks_open_errors_until_override_or_waiver() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(&project_id, "gate.txt", "The amount is 30.\n");
    let segment = harness.segments(&document_id)[0].clone();
    harness.set_target(&segment, "金额是 40。");

    // Default: no gate. The export goes through with the open error.
    let plain_path = harness.path_of("gate-plain.txt");
    harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": plain_path }),
    );

    // Enable the gate.
    let view = harness.call("qa.profile.get", json!({ "projectId": project_id }));
    harness.call(
        "qa.profile.update",
        json!({
            "projectId": project_id,
            "baseRevision": view["revision"],
            "blockExportOnError": true,
        }),
    );

    // The gate refuses with the count and rule ids in message and data, and
    // writes nothing.
    let gated_path = harness.path_of("gate-blocked.txt");
    let refusal = harness.raw(
        "document.export",
        json!({ "documentId": document_id, "outputPath": gated_path }),
    );
    let error = refusal.error.expect("gate refusal");
    assert_eq!(
        serde_json::to_value(error.code).expect("code"),
        json!("exportBlocked")
    );
    assert!(
        error.message.contains("qa.number-mismatch"),
        "{}",
        error.message
    );
    let data = error.data.expect("gate data");
    assert_eq!(data["reason"], "qaGate");
    assert_eq!(data["openErrors"], 1);
    assert_eq!(data["ruleIds"], json!(["qa.number-mismatch"]));
    assert!(
        !std::path::Path::new(&gated_path).exists(),
        "a refused export writes nothing"
    );

    // The explicit override is the user's decision: the export proceeds.
    harness.call(
        "document.export",
        json!({
            "documentId": document_id,
            "outputPath": gated_path,
            "overrideQaGate": true,
        }),
    );
    assert!(std::path::Path::new(&gated_path).exists());

    // The gate runs before the destination check: exporting onto the file
    // just written still reports the QA refusal first, and an override then
    // surfaces the plain destination-exists refusal (no qaGate data).
    let layered = harness.raw(
        "document.export",
        json!({ "documentId": document_id, "outputPath": gated_path }),
    );
    assert_eq!(
        layered.error.expect("qa refusal").data.expect("data")["reason"],
        "qaGate"
    );
    let exists = harness.raw(
        "document.export",
        json!({
            "documentId": document_id,
            "outputPath": gated_path,
            "overrideQaGate": true,
        }),
    );
    let exists_error = exists.error.expect("destination refusal");
    assert!(exists_error.data.is_none());
    assert!(exists_error.message.contains("already exists"));

    // Waiving the finding is the recorded acceptance: the gate opens
    // without any override.
    let issues = harness.call("qa.list", json!({ "documentId": document_id }));
    let issue_id = issues["issues"][0]["id"].as_str().expect("issue id");
    harness.call("qa.waive", json!({ "issueId": issue_id, "waived": true }));
    let waived_path = harness.path_of("gate-waived.txt");
    harness.call(
        "document.export",
        json!({ "documentId": document_id, "outputPath": waived_path }),
    );
    assert!(std::path::Path::new(&waived_path).exists());
}

// ---- Multi-TM: memories, mounts, and the single writable write path ----

/// Every new project starts with its own memory mounted enabled + writable
/// at priority 0 — the working memory. The mount model survives a reopen.
#[test]
fn project_create_mounts_a_writable_working_memory() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    let listed = harness.call("memory.list", json!({ "projectId": project_id }));
    let memories = listed["memories"].as_array().expect("memories");
    let mounts = listed["mounts"].as_array().expect("mounts");
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0]["name"], "Test");
    assert_eq!(memories[0]["sourceLocale"], "en-US");
    assert_eq!(memories[0]["targetLocale"], "zh-CN");
    assert_eq!(mounts.len(), 1);
    assert_eq!(mounts[0]["memoryId"], memories[0]["id"]);
    assert_eq!(mounts[0]["priority"], 0);
    assert_eq!(mounts[0]["enabled"], true);
    assert_eq!(mounts[0]["writable"], true);

    harness.reopen();
    let reloaded = harness.call("memory.list", json!({ "projectId": project_id }));
    assert_eq!(reloaded["memories"].as_array().expect("memories").len(), 1);
    assert_eq!(reloaded["mounts"].as_array().expect("mounts").len(), 1);
}

/// Two mounted memories: lookup merges both and annotates every match with
/// the memory it came from; equal scores rank by mount priority, and a
/// priority move flips the order.
#[test]
fn tm_lookup_merges_mounts_best_first_with_priority_tiebreak() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let document_id = harness.import_txt(&project_id, "seed.txt", "Save your work often.\n");
    let segments = harness.segments(&document_id);
    let updated = harness.set_target(&segments[0], "请经常保存工作。");
    harness.confirm(&updated);

    // A second memory mounted read-only at priority 1 with a colliding
    // exact entry, imported explicitly into that memory.
    let extra = harness.call(
        "memory.create",
        json!({ "name": "参考库", "sourceLocale": "en-US", "targetLocale": "zh-CN" }),
    );
    let extra_id = extra["id"].as_str().expect("memory id").to_string();
    let mount = harness.call(
        "memory.attach",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    )["mount"]
        .clone();
    assert_eq!(mount["priority"], 1);
    assert_eq!(mount["enabled"], true);
    assert_eq!(
        mount["writable"], false,
        "attach never silently creates a second write target"
    );
    let csv_path = harness.write_file(
        "reference.csv",
        "source,target\nSave your work often.,请常存档。\n",
    );
    harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path, "memoryId": extra_id }),
    );

    let result = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Save your work often." }),
    );
    let matches = result["matches"].as_array().expect("matches");
    assert_eq!(matches.len(), 2, "both memories contribute");
    assert_eq!(result["totalMatches"], 2);
    // Equal 100-scores: the priority-0 working memory wins the tiebreak.
    assert_eq!(matches[0]["score"], 100);
    assert_eq!(matches[1]["score"], 100);
    assert_eq!(matches[0]["entry"]["targetText"], "请经常保存工作。");
    assert_eq!(matches[0]["memoryName"], "Test");
    assert_eq!(matches[1]["entry"]["targetText"], "请常存档。");
    assert_eq!(matches[1]["memoryName"], "参考库");
    assert_eq!(matches[1]["entry"]["memoryId"], json!(extra_id));

    // Move the reference memory to priority 0: the merged order flips.
    let moved = harness.call(
        "memory.update",
        json!({ "projectId": project_id, "memoryId": extra_id, "priority": 0 }),
    );
    let mounts = moved["mounts"].as_array().expect("mounts");
    assert_eq!(mounts[0]["memoryId"], json!(extra_id));
    assert_eq!(mounts[0]["priority"], 0);
    assert_eq!(mounts[1]["priority"], 1);
    let flipped = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Save your work often." }),
    );
    assert_eq!(
        flipped["matches"][0]["memoryName"], "参考库",
        "priority decides equal-score order"
    );
}

/// `enabled: false` removes a mount from the read path: lookup and
/// pretranslation no longer see its entries, and re-enabling restores them.
#[test]
fn disabled_mounts_are_excluded_from_lookup_and_pretranslate() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let extra = harness.call(
        "memory.create",
        json!({ "name": "参考库", "sourceLocale": "en-US", "targetLocale": "zh-CN" }),
    );
    let extra_id = extra["id"].as_str().expect("memory id").to_string();
    harness.call(
        "memory.attach",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );
    let csv_path = harness.write_file(
        "reference.csv",
        "source,target\nSave your work often.,请常存档。\n",
    );
    harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path, "memoryId": extra_id }),
    );

    let both = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Save your work often." }),
    );
    assert_eq!(both["matches"].as_array().expect("matches").len(), 1);

    harness.call(
        "memory.update",
        json!({ "projectId": project_id, "memoryId": extra_id, "enabled": false }),
    );
    let excluded = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Save your work often." }),
    );
    assert_eq!(
        excluded["matches"].as_array().expect("matches").len(),
        0,
        "disabled mounts leave the read path"
    );

    // Pretranslate sees the same read path: nothing fills while the only
    // memory holding the match is disabled, and it fills after re-enable.
    let document_id = harness.import_txt(&project_id, "job.txt", "Save your work often.\n");
    let dry = harness.call("tm.pretranslate", json!({ "documentId": document_id }));
    assert_eq!(dry["pretranslated"], 0);
    harness.call(
        "memory.update",
        json!({ "projectId": project_id, "memoryId": extra_id, "enabled": true }),
    );
    let filled = harness.call("tm.pretranslate", json!({ "documentId": document_id }));
    assert_eq!(filled["exact"], 1);
    let segments = harness.segments(&document_id);
    assert_eq!(segments[0]["targetText"], "请常存档。");
}

/// Confirm-time TM writes go to exactly one writable mount. Promoting a
/// second memory while one is writable is a conflict; after an explicit
/// demote + promote, confirms write the new working memory only; with no
/// writable mount at all, confirm fails honestly.
#[test]
fn confirm_writes_only_the_writable_mount() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();
    let own = harness.call("memory.list", json!({ "projectId": project_id }));
    let own_id = own["memories"][0]["id"].as_str().expect("id").to_string();
    let extra = harness.call(
        "memory.create",
        json!({ "name": "参考库", "sourceLocale": "en-US", "targetLocale": "zh-CN" }),
    );
    let extra_id = extra["id"].as_str().expect("memory id").to_string();
    harness.call(
        "memory.attach",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );

    let document_id = harness.import_txt(
        &project_id,
        "job.txt",
        "Save your work often.\n\nThe retention period is 30 days.\n",
    );
    let segments = harness.segments(&document_id);
    let first = harness.set_target(&segments[0], "请经常保存工作。");
    let confirmed = harness.confirm(&first);
    assert_eq!(confirmed["tmEntry"]["memoryId"], json!(own_id));
    let own_entries = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "memoryId": own_id }),
    );
    assert_eq!(own_entries["total"], 1);
    let extra_entries = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );
    assert_eq!(
        extra_entries["total"], 0,
        "the read-only mount never receives confirm writes"
    );

    // Promoting a second writable mount is a conflict, never a silent
    // demotion of the current working memory.
    assert_eq!(
        harness.call_err(
            "memory.update",
            json!({ "projectId": project_id, "memoryId": extra_id, "writable": true }),
        ),
        "conflict"
    );

    // Explicit demote + promote moves the write path.
    harness.call(
        "memory.update",
        json!({ "projectId": project_id, "memoryId": own_id, "writable": false }),
    );
    harness.call(
        "memory.update",
        json!({ "projectId": project_id, "memoryId": extra_id, "writable": true }),
    );
    let segments = harness.segments(&document_id);
    let second = harness.set_target(&segments[1], "保留期为 30 天。");
    let confirmed = harness.confirm(&second);
    assert_eq!(confirmed["tmEntry"]["memoryId"], json!(extra_id));
    let extra_entries = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );
    assert_eq!(extra_entries["total"], 1);
    let own_entries = harness.call(
        "tm.list",
        json!({ "projectId": project_id, "memoryId": own_id }),
    );
    assert_eq!(own_entries["total"], 1, "the demoted memory keeps its rows");

    // No writable mount anywhere: confirm refuses instead of picking a
    // memory itself, and the default-memory management calls refuse too.
    harness.call(
        "memory.update",
        json!({ "projectId": project_id, "memoryId": extra_id, "writable": false }),
    );
    let segments = harness.segments(&document_id);
    let third = harness.set_target(&segments[0], "另一个译文。");
    let response = harness.raw(
        "segment.confirm",
        json!({ "segmentId": third["id"], "baseRevision": third["revision"] }),
    );
    let error = response.error.expect("confirm refused");
    assert_eq!(serde_json::to_value(error.code).unwrap(), "conflict");
    assert!(error.message.contains("no writable memory"));
    assert_eq!(
        harness.call_err("tm.list", json!({ "projectId": project_id })),
        "conflict"
    );

    // Detach the read-only reference mount: its memory and entries survive,
    // only the project link goes.
    harness.call(
        "memory.detach",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );
    assert_eq!(
        harness.call_err(
            "tm.list",
            json!({ "projectId": project_id, "memoryId": extra_id }),
        ),
        "notFound"
    );
    let listed = harness.call("memory.list", json!({ "projectId": project_id }));
    assert_eq!(listed["memories"].as_array().expect("memories").len(), 2);
    assert_eq!(listed["mounts"].as_array().expect("mounts").len(), 1);
}

/// `memory.rename` renames the memory row under optimistic concurrency and
/// the new name flows into merged-lookup annotations; `memory.delete`
/// refuses while mounted and while entries remain, and the explicit
/// cascade removes the rows for good (surviving a reopen).
#[test]
fn memory_rename_and_delete_guard_mounts_and_entries() {
    let mut harness = Harness::new();
    let project_id = harness.create_project();

    let extra = harness.call(
        "memory.create",
        json!({ "name": "参考库", "sourceLocale": "en-US", "targetLocale": "zh-CN" }),
    );
    let extra_id = extra["id"].as_str().expect("memory id").to_string();
    harness.call(
        "memory.attach",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );
    let csv_path = harness.write_file(
        "reference.csv",
        "source,target\nSave your work often.,请常存档。\n",
    );
    harness.call(
        "tm.import",
        json!({ "projectId": project_id, "path": csv_path, "memoryId": extra_id }),
    );

    // Rename: a stale baseRevision conflicts; the current one lands, and
    // lookup annotations pick up the new name immediately.
    assert_eq!(
        harness.call_err(
            "memory.rename",
            json!({ "memoryId": extra_id, "name": "参考库 v2", "baseRevision": 99 }),
        ),
        "conflict"
    );
    assert_eq!(
        harness.call_err(
            "memory.rename",
            json!({ "memoryId": extra_id, "name": "  ", "baseRevision": extra["revision"] }),
        ),
        "invalidParams"
    );
    let renamed = harness.call(
        "memory.rename",
        json!({
            "memoryId": extra_id,
            "name": "参考库 v2",
            "baseRevision": extra["revision"],
        }),
    );
    assert_eq!(renamed["memory"]["name"], "参考库 v2");
    assert_eq!(renamed["memory"]["revision"], 2);
    let lookup = harness.call(
        "tm.lookup",
        json!({ "projectId": project_id, "sourceText": "Save your work often." }),
    );
    assert_eq!(lookup["matches"][0]["memoryName"], "参考库 v2");

    // Delete refuses while the memory is mounted anywhere.
    assert_eq!(
        harness.call_err("memory.delete", json!({ "memoryId": extra_id })),
        "conflict"
    );
    harness.call(
        "memory.detach",
        json!({ "projectId": project_id, "memoryId": extra_id }),
    );

    // Detached but entries remain: still a conflict without the explicit
    // cascade, and the message carries the real count.
    let refused = harness.raw("memory.delete", json!({ "memoryId": extra_id }));
    let error = refused.error.expect("delete refused");
    assert_eq!(serde_json::to_value(error.code).unwrap(), "conflict");
    assert!(error.message.contains("1 TM entries"));

    // The explicit cascade removes the entries and the memory row; the
    // deletion is durable across a reopen (recall index rebuilt without it).
    let deleted = harness.call(
        "memory.delete",
        json!({ "memoryId": extra_id, "deleteEntries": true }),
    );
    assert_eq!(deleted["deletedEntries"], 1);
    assert_eq!(deleted["memory"]["id"], json!(extra_id));
    assert_eq!(
        harness.call_err("memory.delete", json!({ "memoryId": extra_id })),
        "notFound"
    );

    harness.reopen();
    let reloaded = harness.call("memory.list", json!({}));
    let memories = reloaded["memories"].as_array().expect("memories");
    assert_eq!(memories.len(), 1, "only the project's own memory remains");
    assert_eq!(memories[0]["name"], "Test");

    // An empty, unmounted memory deletes without any flag.
    let scratch = harness.call(
        "memory.create",
        json!({ "name": "草稿库", "sourceLocale": "en-US", "targetLocale": "zh-CN" }),
    );
    let scratch_id = scratch["id"].as_str().expect("memory id");
    let removed = harness.call("memory.delete", json!({ "memoryId": scratch_id }));
    assert_eq!(removed["deletedEntries"], 0);
}
