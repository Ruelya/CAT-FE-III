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
