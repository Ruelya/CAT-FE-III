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
