import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { clearTimeout, setTimeout } from "node:timers";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const binary =
    process.env.TRANSLUNAR_ENGINE_BIN ??
    join(
      root,
      "target",
      "debug",
      process.platform === "win32"
        ? "translunar-engine.exe"
        : "translunar-engine",
    );
  const fixture = join(root, "fixtures", "docx", "m0-source.docx");
  const pdfTextPath = join(root, "fixtures", "pdf", "text-layout.pdf");
  const pdfScannedPath = join(root, "fixtures", "pdf", "scanned.pdf");
  const pdfMixedPath = join(root, "fixtures", "pdf", "mixed.pdf");
  if (!existsSync(binary))
    throw new Error(`Engine binary not found: ${binary}`);
  if (!existsSync(fixture))
    throw new Error(`DOCX fixture not found: ${fixture}`);

  const dataDirectory = mkdtempSync(join(tmpdir(), "translunar-engine-smoke-"));
  const outputPath = join(dataDirectory, "translated-generic.docx");
  const legacyOutputPath = join(dataDirectory, "translated-legacy.docx");
  const backupParent = mkdtempSync(join(tmpdir(), "translunar-engine-backup-"));
  const backupPath = join(backupParent, "workspace-backup");
  const tmSeedPath = join(dataDirectory, "seed.csv");
  const badTmPath = join(dataDirectory, "bad-seed.csv");
  const tmExportPath = join(dataDirectory, "tm-export.tmx");
  const termExportPath = join(dataDirectory, "terms.tbx");
  const txtPath = join(dataDirectory, "sample.txt");
  const markdownPath = join(dataDirectory, "sample.md");
  const htmlPath = join(dataDirectory, "sample.html");
  const xliffPath = join(dataDirectory, "sample.xlf");
  const sdlxliffPath = join(dataDirectory, "sample.sdlxliff");
  const mqxliffPath = join(dataDirectory, "sample.mqxliff");
  const mqxlzPath = join(dataDirectory, "sample.mqxlz");
  const xlsxPath = join(dataDirectory, "sample.xlsx");
  const pptxPath = join(dataDirectory, "sample.pptx");
  const malformedXliffPath = join(dataDirectory, "malformed.xlf");
  const malformedSdlxliffPath = join(dataDirectory, "malformed.sdlxliff");
  const malformedMqxlzPath = join(dataDirectory, "malformed.mqxlz");
  const malformedXlsxPath = join(dataDirectory, "malformed.xlsx");
  const malformedPptxPath = join(dataDirectory, "malformed.pptx");
  const textOutputPath = join(dataDirectory, "translated.txt");
  const splitTextOutputPath = join(dataDirectory, "split-translated.txt");
  const markdownOutputPath = join(dataDirectory, "translated.md");
  const htmlOutputPath = join(dataDirectory, "translated.html");
  const xliffOutputPath = join(dataDirectory, "translated.xlf");
  const sdlxliffOutputPath = join(dataDirectory, "translated.sdlxliff");
  const mqxliffOutputPath = join(dataDirectory, "translated.mqxliff");
  const mqxlzOutputPath = join(dataDirectory, "translated.mqxlz");
  const xlsxOutputPath = join(dataDirectory, "translated.xlsx");
  const pptxOutputPath = join(dataDirectory, "translated.pptx");
  const pdfTextOutputPath = join(dataDirectory, "text-layout-translated.docx");
  const pdfScannedOutputPath = join(dataDirectory, "scanned-translated.docx");
  const pdfMixedOutputPath = join(dataDirectory, "mixed-translated.docx");
  const qaHtmlReportPath = join(dataDirectory, "qa-report.html");
  const qaXlsxReportPath = join(dataDirectory, "qa-report.xlsx");
  const aiSourcePath = join(dataDirectory, "ai-source.txt");
  let processHandle;
  const aiFixture = await startAiFixture();

  try {
    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    if (process.env.TRANSLUNAR_SMOKE_SCOPE === "curation") {
      await exerciseFocusedCurationSmoke(
        processHandle,
        dataDirectory,
        aiFixture.url,
      );
      console.log("Focused asset-curation Engine smoke passed.");
      return;
    }
    if (process.env.TRANSLUNAR_SMOKE_SCOPE === "plugin") {
      await exerciseFocusedPluginSmoke(processHandle, dataDirectory);
      console.log("Focused plugin-runtime Engine smoke passed.");
      return;
    }
    if (process.env.TRANSLUNAR_SMOKE_SCOPE === "api") {
      await exerciseFocusedApiCliSmoke(dataDirectory);
      console.log("Focused local API/CLI smoke passed.");
      return;
    }
    if (process.env.TRANSLUNAR_SMOKE_SCOPE === "ai-quality") {
      await exerciseFocusedAiQualitySmoke(processHandle);
      console.log("Focused AI quality smoke passed.");
      return;
    }
    if (process.env.TRANSLUNAR_SMOKE_SCOPE === "collab") {
      await exerciseFocusedCollabSmoke(processHandle);
      console.log("Focused collaboration smoke passed.");
      return;
    }
    const project = await processHandle.call("project.create", {
      name: "Smoke project",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      domain: "legal",
    });
    const imported = await processHandle.call("document.import", {
      projectId: project.id,
      sourcePath: fixture,
      relativePath: "chapter-a/m0-source.docx",
    });
    const document = imported.document;
    writeFileSync(
      txtPath,
      "\ufeffFirst sentence. Second sentence.\r\n\r\nThird paragraph.\r\n",
      "utf8",
    );
    writeFileSync(
      markdownPath,
      "# Heading\n\nVisible **bold** [link](https://example.test) `code`.\n",
      "utf8",
    );
    writeFileSync(
      htmlPath,
      '<!-- keep --><p title="Greeting">Hello <strong>world</strong>.</p><script>skip()</script>',
      "utf8",
    );
    writeFileSync(
      xliffPath,
      '<xliff version="2.1" srcLang="en" trgLang="zh" xmlns="urn:oasis:names:tc:xliff:document:2.1"><file id="f"><unit id="u"><segment id="s"><source>Hello <ph id="p"/> world</source></segment></unit></file></xliff>',
      "utf8",
    );
    writeFileSync(
      sdlxliffPath,
      '<xliff version="1.2" xmlns:sdl="urn:sdl" xmlns:x="urn:opaque"><file id="f" source-language="en" target-language="zh"><body><trans-unit id="u" sdl:locked="true"><source>SDL <g id="1">source</g></source><target state="translated">SDL <g id="1">target</g></target><note from="reviewer">Keep SDL tone</note><x:meta keep="yes"/></trans-unit></body></file></xliff>',
      "utf8",
    );
    writeFileSync(
      mqxliffPath,
      '<xliff version="2.0" srcLang="en" trgLang="zh" xmlns="urn:oasis:names:tc:xliff:document:2.0" xmlns:mq="urn:memoq"><file id="f"><unit id="u"><segment id="s" mq:status="Confirmed"><source>memoQ <ph id="1"/>source</source><target>memoQ <ph id="1"/>target</target><mq:metadata keep="yes"/></segment></unit></file></xliff>',
      "utf8",
    );
    writeFileSync(
      mqxlzPath,
      makeZip([
        [
          "documents/main.mqxliff",
          '<xliff version="1.2" xmlns:mq="urn:memoq"><file id="f" source-language="en" target-language="zh"><body><trans-unit id="u" mq:status="Translated"><source>Package source</source><target>Package target</target></trans-unit></body></file></xliff>',
        ],
        ["resources/opaque.bin", Buffer.from("opaque-mqxlz-payload")],
      ]),
    );
    writeFileSync(
      xlsxPath,
      makeZip([
        ["[Content_Types].xml", officeXlsxContentTypes],
        ["_rels/.rels", officeXlsxRootRels],
        ["xl/workbook.xml", officeXlsxWorkbook],
        ["xl/_rels/workbook.xml.rels", officeXlsxWorkbookRels],
        ["xl/sharedStrings.xml", officeXlsxSharedStrings],
        ["xl/worksheets/sheet1.xml", officeXlsxSheet],
        [
          "xl/styles.xml",
          '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts></styleSheet>',
        ],
      ]),
    );
    writeFileSync(
      pptxPath,
      makeZip([
        ["[Content_Types].xml", officePptxContentTypes],
        ["_rels/.rels", officePptxRootRels],
        ["ppt/presentation.xml", officePptxPresentation],
        ["ppt/_rels/presentation.xml.rels", officePptxPresentationRels],
        ["ppt/slides/slide1.xml", officePptxSlide],
        ["ppt/slides/_rels/slide1.xml.rels", officePptxSlideRels],
        ["ppt/diagrams/data1.xml", officePptxDiagram],
        ["ppt/media/image1.png", Buffer.from("fixture-png")],
      ]),
    );
    const formatCases = [
      {
        sourcePath: txtPath,
        filterId: "builtin.txt",
        targetText: "第一句。",
        outputPath: textOutputPath,
        options: { segmentationMode: "sentence" },
        expectedSegments: 3,
      },
      {
        sourcePath: markdownPath,
        filterId: "builtin.markdown",
        targetText: "标题",
        outputPath: markdownOutputPath,
        expectedSegments: 5,
      },
      {
        sourcePath: htmlPath,
        filterId: "builtin.html",
        targetText: "你好",
        outputPath: htmlOutputPath,
        expectedSegments: 4,
      },
      {
        sourcePath: xliffPath,
        filterId: "builtin.xliff",
        targetText: "你好世界",
        outputPath: xliffOutputPath,
        expectedSegments: 1,
      },
      {
        sourcePath: sdlxliffPath,
        filterId: "builtin.sdlxliff",
        targetText: "SDL 新译文",
        outputPath: sdlxliffOutputPath,
        expectedSegments: 1,
      },
      {
        sourcePath: mqxliffPath,
        filterId: "builtin.mqxliff",
        targetText: "memoQ 新译文",
        outputPath: mqxliffOutputPath,
        expectedSegments: 1,
      },
      {
        sourcePath: mqxlzPath,
        filterId: "builtin.mqxlz",
        targetText: "包内新译文",
        outputPath: mqxlzOutputPath,
        expectedSegments: 1,
      },
      {
        sourcePath: xlsxPath,
        filterId: "builtin.xlsx",
        targetText: "你好表格",
        outputPath: xlsxOutputPath,
        expectedSegments: 3,
      },
      {
        sourcePath: pptxPath,
        filterId: "builtin.pptx",
        targetText: "你好幻灯片",
        outputPath: pptxOutputPath,
        expectedSegments: 2,
      },
      {
        sourcePath: pdfTextPath,
        filterId: "builtin.pdf",
        targetText: "保留与付款条款",
        outputPath: pdfTextOutputPath,
        options: { ocrMode: "never" },
        minimumSegments: 10,
      },
      {
        sourcePath: pdfScannedPath,
        filterId: "builtin.pdf",
        targetText: "扫描服务通知",
        outputPath: pdfScannedOutputPath,
        options: { ocrMode: "auto", ocrLanguages: "eng", ocrDpi: "200" },
        minimumSegments: 3,
      },
      {
        sourcePath: pdfMixedPath,
        filterId: "builtin.pdf",
        targetText: "混合 PDF 文本页",
        outputPath: pdfMixedOutputPath,
        options: { ocrMode: "auto", ocrLanguages: "eng", ocrDpi: "200" },
        minimumSegments: 5,
      },
    ];
    const formatDocuments = [];
    for (const formatCase of formatCases) {
      const formatImport = await processHandle.call("document.import", {
        projectId: project.id,
        sourcePath: formatCase.sourcePath,
        options: formatCase.options ?? {},
      });
      assert(
        formatImport.filterId === formatCase.filterId,
        `${formatCase.filterId} should be selected`,
      );
      const formatSegments = await processHandle.call("segment.list", {
        documentId: formatImport.document.id,
        offset: 0,
        limit: 200,
      });
      if (formatCase.expectedSegments !== undefined) {
        assert(
          formatSegments.items.length === formatCase.expectedSegments,
          "format filter should produce the expected segments",
        );
      } else {
        assert(
          formatSegments.items.length >= formatCase.minimumSegments,
          "PDF block count mismatch: " +
            formatCase.sourcePath +
            " produced " +
            formatSegments.items.length,
        );
      }
      await processHandle.call("segment.updateTarget", {
        segmentId: formatSegments.items[0].id,
        targetText: formatCase.targetText,
        expectedRevision: formatSegments.items[0].revision,
      });
      formatDocuments.push({
        documentId: formatImport.document.id,
        outputPath: formatCase.outputPath,
        sourcePath: formatCase.sourcePath,
        filterId: formatCase.filterId,
      });
    }
    writeFileSync(malformedXliffPath, '<xliff version="2.1"><file>', "utf8");
    writeFileSync(
      malformedSdlxliffPath,
      '<!DOCTYPE xliff SYSTEM "remote.dtd"><xliff version="1.2"/>',
      "utf8",
    );
    writeFileSync(
      malformedMqxlzPath,
      makeZip([
        [
          "documents/main.mqxliff",
          '<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Unsafe</source></trans-unit></body></file></xliff>',
        ],
        ["../escape.bin", Buffer.from("escape")],
      ]),
    );
    writeFileSync(malformedXlsxPath, "not a zip", "utf8");
    writeFileSync(malformedPptxPath, "not a zip", "utf8");
    const documentsBeforeMalformed = await processHandle.call("document.list", {
      projectId: project.id,
      offset: 0,
      limit: 100,
    });
    try {
      await processHandle.call("document.import", {
        projectId: project.id,
        sourcePath: malformedXliffPath,
      });
      throw new Error("malformed XLIFF unexpectedly imported");
    } catch (error) {
      assert(
        error?.code === "unsupported_document",
        "malformed XLIFF should return a typed import error",
      );
    }
    for (const malformedPath of [
      malformedSdlxliffPath,
      malformedMqxlzPath,
      malformedXlsxPath,
      malformedPptxPath,
    ]) {
      try {
        await processHandle.call("document.import", {
          projectId: project.id,
          sourcePath: malformedPath,
        });
        throw new Error(`${malformedPath} unexpectedly imported`);
      } catch (error) {
        assert(
          error?.code === "unsupported_document",
          "malformed format should return a typed import error",
        );
      }
    }
    const documentsAfterMalformed = await processHandle.call("document.list", {
      projectId: project.id,
      offset: 0,
      limit: 100,
    });
    assert(
      documentsAfterMalformed.total === documentsBeforeMalformed.total,
      "failed vendor imports must not persist partial documents",
    );
    const libraries = await processHandle.call("tm.library.list", {
      projectId: project.id,
      offset: 0,
      limit: 50,
    });
    assert(
      libraries.items.length === 1,
      "project should have a default TM library",
    );
    const defaultLibrary = libraries.items[0];
    assert(defaultLibrary.writable, "default TM library should be writable");
    const extraLibrary = await processHandle.call("tm.library.create", {
      name: "Smoke reference",
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      domain: project.domain,
      writable: true,
    });
    await processHandle.call("tm.library.mount", {
      projectId: project.id,
      libraryId: extraLibrary.id,
      mode: "write",
      priority: 1,
      enabled: true,
    });
    writeFileSync(
      tmSeedPath,
      [
        "source,target,sourceLocale,targetLocale,domain,author,createdAtMs",
        "A CJK sentence,一个中文句子,en-US,zh-CN,general,smoke,42",
      ].join("\n"),
      "utf8",
    );
    const importedTm = await processHandle.call("tm.import", {
      libraryId: extraLibrary.id,
      sourcePath: tmSeedPath,
      format: "csv",
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
    });
    assert(importedTm.inserted === 1, "TM CSV import should insert one unit");
    writeFileSync(badTmPath, "source,target\nvalid,ok\nbroken,\n", "utf8");
    try {
      await processHandle.call("tm.import", {
        libraryId: extraLibrary.id,
        sourcePath: badTmPath,
        format: "csv",
        sourceLocale: project.sourceLocale,
        targetLocale: project.targetLocale,
      });
      throw new Error("malformed TM import unexpectedly succeeded");
    } catch (error) {
      assert(
        error?.code === "invalid_request",
        "malformed TM import should be typed",
      );
      assert(
        error?.data?.row === 3,
        "malformed TM import should report its row",
      );
    }
    const rolledBackImport = await processHandle.call("tm.concordance", {
      projectId: project.id,
      query: "valid",
      side: "source",
      offset: 0,
      limit: 50,
    });
    assert(
      rolledBackImport.total === 0,
      "malformed TM import must not partially commit",
    );
    const tmMatches = await processHandle.call("tm.search", {
      projectId: project.id,
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      query: "A CJK sentence",
      threshold: 100,
      offset: 0,
      limit: 50,
      libraryIds: [extraLibrary.id],
    });
    assert(
      tmMatches.matches.length === 1,
      "TM search should find imported unit",
    );
    const concordance = await processHandle.call("tm.concordance", {
      projectId: project.id,
      query: "中文",
      side: "target",
      offset: 0,
      limit: 50,
    });
    assert(
      concordance.hits.length === 1,
      "concordance should search target text",
    );
    const sourceConcordance = await processHandle.call("tm.concordance", {
      projectId: project.id,
      query: "CJK",
      side: "source",
      offset: 0,
      limit: 50,
    });
    assert(
      sourceConcordance.hits.length === 1,
      "concordance should search source text",
    );
    const exportedTm = await processHandle.call("tm.export", {
      libraryId: extraLibrary.id,
      outputPath: tmExportPath,
      format: "tmx",
    });
    assert(
      exportedTm.unitCount === 1 && statSync(tmExportPath).size > 0,
      "TMX export should publish atomically",
    );
    const importedTmxLibrary = await processHandle.call("tm.library.create", {
      name: "Smoke TMX import",
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      writable: true,
    });
    const importedTmx = await processHandle.call("tm.import", {
      libraryId: importedTmxLibrary.id,
      sourcePath: tmExportPath,
      format: "tmx",
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
    });
    assert(importedTmx.inserted === 1, "TMX import should insert one unit");
    const termbases = await processHandle.call("termbase.list", {
      projectId: project.id,
      offset: 0,
      limit: 50,
    });
    assert(
      termbases.items.length === 1,
      "project should have a default termbase",
    );
    const defaultTermbase = termbases.items[0];
    const termEntry = await processHandle.call("term.upsert", {
      termbaseId: defaultTermbase.id,
      sourceLocale: project.sourceLocale,
      sourceTerm: "paragraph",
      partOfSpeech: "noun",
      definition: "A block of text",
      status: "active",
      translations: [
        {
          locale: project.targetLocale,
          term: "段落",
          preferred: true,
          forbidden: false,
        },
        {
          locale: project.targetLocale,
          term: "禁用词",
          preferred: false,
          forbidden: true,
        },
      ],
    });
    assert(
      termEntry.translations.length === 2,
      "term upsert should retain multiple translations",
    );
    const recognized = await processHandle.call("term.search", {
      projectId: project.id,
      text: "This paragraph remains untranslated.",
      offset: 0,
      limit: 50,
    });
    assert(
      recognized.matches.length === 1,
      "term search should recognize a Latin term",
    );
    const exportedTerms = await processHandle.call("termbase.export", {
      termbaseId: defaultTermbase.id,
      outputPath: termExportPath,
      format: "tbx",
      targetLocale: project.targetLocale,
    });
    assert(
      exportedTerms.entryCount === 1 && statSync(termExportPath).size > 0,
      "TBX export should publish atomically",
    );
    const importedTermbase = await processHandle.call("termbase.create", {
      name: "Smoke imported terms",
      sourceLocale: project.sourceLocale,
      domain: project.domain,
      writable: true,
    });
    const importedTerms = await processHandle.call("termbase.import", {
      termbaseId: importedTermbase.id,
      sourcePath: termExportPath,
      format: "tbx",
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
    });
    assert(importedTerms.inserted === 1, "TBX import should insert one entry");
    const legacyDocument = await processHandle.call("document.importDocx", {
      projectId: project.id,
      sourcePath: fixture,
    });
    const filters = await processHandle.call("filter.list", {});
    assert(
      filters.filters.length === 13,
      "all built-in filters should register",
    );
    assert(
      [
        "builtin.docx",
        "builtin.bilingual-docx",
        "builtin.html",
        "builtin.markdown",
        "builtin.pdf",
        "builtin.pptx",
        "builtin.txt",
        "builtin.xliff",
        "builtin.xlsx",
        "builtin.bilingual-xlsx",
        "builtin.sdlxliff",
        "builtin.mqxliff",
        "builtin.mqxlz",
      ].every((id) => filters.filters.some((filter) => filter.id === id)),
      "filter catalog should contain every P0 text filter",
    );
    const documents = await processHandle.call("document.list", {
      projectId: project.id,
      offset: 0,
      limit: 50,
    });
    assert(
      documents.total === 14,
      "fourteen logical documents should be listed",
    );
    const page = await processHandle.call("segment.list", {
      documentId: document.id,
      offset: 0,
      limit: 200,
    });
    assert(page.items.length === 3, "fixture should produce three segments");
    const first = page.items[0];
    await processHandle.call("segment.updateTarget", {
      segmentId: first.id,
      targetText: "保留期为 60 天。",
      expectedRevision: first.revision,
    });
    const lifecycleUpdate = await processHandle.call("project.update", {
      projectId: project.id,
      name: "Smoke project updated",
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      domain: project.domain,
      configuration: {},
      expectedRevision: project.revision,
      actor: "engine-smoke",
      correlationId: "smoke-project-update",
    });
    const archived = await processHandle.call("project.setLifecycle", {
      projectId: project.id,
      lifecycle: "archived",
      expectedRevision: lifecycleUpdate.revision,
      actor: "engine-smoke",
    });
    await processHandle.call("project.setLifecycle", {
      projectId: project.id,
      lifecycle: "active",
      expectedRevision: archived.revision,
      actor: "engine-smoke",
    });
    const lifecycleEvidence = await exerciseLifecycleBeforeRestart(
      processHandle,
      dataDirectory,
    );
    await processHandle.stop();

    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    const recovered = await processHandle.call("segment.list", {
      documentId: document.id,
      offset: 0,
      limit: 200,
    });
    assert(
      recovered.items[0].targetText === "保留期为 60 天。",
      "draft should recover after restart",
    );
    const recoveredLegacy = await processHandle.call("segment.list", {
      documentId: legacyDocument.id,
      offset: 0,
      limit: 200,
    });
    assert(
      recoveredLegacy.items.length === 3,
      "legacy document should recover after restart",
    );
    for (const formatDocument of formatDocuments) {
      const recoveredFormat = await processHandle.call("segment.list", {
        documentId: formatDocument.documentId,
        offset: 0,
        limit: 200,
      });
      assert(
        recoveredFormat.items[0].targetText.length > 0,
        "format draft should recover after restart",
      );
    }
    await verifyLifecycleAfterRestart(processHandle, lifecycleEvidence);
    const editorPage = await processHandle.call("segment.editor.list", {
      documentId: document.id,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: true,
    });
    assert(
      editorPage.items.length === 3 && editorPage.items[0].contextAfter,
      "editor projection should include bounded context",
    );
    await processHandle.call("segment.propagate", {
      segmentId: editorPage.items[0].segment.id,
      expectedRevision: editorPage.items[0].segment.revision,
    });
    let propagatedLegacy = await processHandle.call("segment.list", {
      documentId: legacyDocument.id,
      offset: 0,
      limit: 200,
    });
    assert(
      propagatedLegacy.items[0].targetText ===
        editorPage.items[0].segment.targetText,
      "duplicate propagation should update the legacy document",
    );
    await processHandle.call("editor.undo", { projectId: project.id });
    propagatedLegacy = await processHandle.call("segment.list", {
      documentId: legacyDocument.id,
      offset: 0,
      limit: 200,
    });
    assert(
      propagatedLegacy.items[0].targetText === "",
      "duplicate propagation should undo atomically",
    );
    await processHandle.call("editor.redo", { projectId: project.id });

    const txtDocument = formatDocuments.find(
      (item) => item.filterId === "builtin.txt",
    );
    const xliffDocument = formatDocuments.find(
      (item) => item.filterId === "builtin.xliff",
    );
    assert(txtDocument && xliffDocument, "editor smoke documents should exist");
    let txtEditor = await processHandle.call("segment.editor.list", {
      documentId: txtDocument.documentId,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: true,
    });
    const staleReplace = await processHandle.call("segment.replace.preview", {
      documentId: txtDocument.documentId,
      query: "第一句。",
      replacement: "首句。",
      field: "target",
      regex: false,
      caseSensitive: true,
      wholeWord: false,
    });
    const simplifiedTxt = await processHandle.call("segment.updateTarget", {
      segmentId: txtEditor.items[0].segment.id,
      targetText: "鼠标和打印机里的软件",
      expectedRevision: txtEditor.items[0].segment.revision,
    });
    const convertedTxt = await processHandle.call("segment.chinese.convert", {
      segmentId: simplifiedTxt.id,
      profile: "simplifiedToTaiwan",
      expectedRevision: simplifiedTxt.revision,
    });
    assert(
      convertedTxt.rows[0].segment.targetText === "滑鼠和印表機裡的軟體",
      "OpenCC phrase conversion should be authoritative",
    );
    const undoneConversion = await processHandle.call("editor.undo", {
      projectId: project.id,
    });
    const undoneConvertedRow = undoneConversion.rows.find(
      (row) => row.segment.id === simplifiedTxt.id,
    );
    assert(
      undoneConvertedRow?.segment.targetText === "鼠标和打印机里的软件",
      "Chinese conversion should undo atomically",
    );
    const changedTxt = await processHandle.call("segment.updateTarget", {
      segmentId: simplifiedTxt.id,
      targetText: "临时译文。",
      expectedRevision: undoneConvertedRow.segment.revision,
    });
    try {
      await processHandle.call("segment.replace.apply", {
        preview: staleReplace,
      });
      throw new Error("stale editor replace unexpectedly succeeded");
    } catch (error) {
      assert(
        error?.code === "conflict",
        "stale editor replace should conflict",
      );
    }
    const freshReplace = await processHandle.call("segment.replace.preview", {
      documentId: txtDocument.documentId,
      query: "临时译文。",
      replacement: "第一句。",
      field: "target",
      regex: false,
      caseSensitive: true,
      wholeWord: false,
    });
    await processHandle.call("segment.replace.apply", {
      preview: freshReplace,
    });
    const undoneReplace = await processHandle.call("editor.undo", {
      projectId: project.id,
    });
    assert(
      undoneReplace.rows[0].segment.targetText === "临时译文。",
      "replace should undo atomically",
    );
    await processHandle.call("editor.redo", { projectId: project.id });

    const comment = await processHandle.call("segment.comment.create", {
      segmentId: changedTxt.id,
      author: "engine-smoke",
      text: "Check the translated sentence.",
    });
    const resolvedComment = await processHandle.call(
      "segment.comment.resolve",
      {
        commentId: comment.id,
        resolved: true,
        expectedRevision: comment.revision,
      },
    );
    await processHandle.call("editor.undo", { projectId: project.id });
    const undoneComments = await processHandle.call("segment.comment.list", {
      segmentId: changedTxt.id,
      includeResolved: true,
    });
    assert(
      undoneComments.comments[0].resolved === false,
      "comment resolution should undo",
    );
    await processHandle.call("editor.redo", { projectId: project.id });

    txtEditor = await processHandle.call("segment.editor.list", {
      documentId: txtDocument.documentId,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: true,
    });
    const sourceReview = await processHandle.call("review.create", {
      segmentId: txtEditor.items[0].segment.id,
      proposedTarget: null,
      proposedSource: `${txtEditor.items[0].segment.sourceText} corrected`,
      proposedTargetTags: null,
      author: "engine-smoke",
      reason: "Source review smoke",
      expectedRevision: txtEditor.items[0].segment.revision,
    });
    const acceptedSourceReview = await processHandle.call("review.accept", {
      reviewId: sourceReview.id,
      expectedSegmentRevision: txtEditor.items[0].segment.revision,
    });
    assert(
      acceptedSourceReview.rows[0].segment.sourceText.endsWith(" corrected"),
      "source review should apply authoritatively",
    );
    await processHandle.call("editor.undo", { projectId: project.id });
    await processHandle.call("editor.redo", { projectId: project.id });
    txtEditor = await processHandle.call("segment.editor.list", {
      documentId: txtDocument.documentId,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: true,
    });
    const review = await processHandle.call("review.create", {
      segmentId: txtEditor.items[1].segment.id,
      proposedTarget: "第二句审阅译文。",
      author: "engine-smoke",
      reason: "Review smoke",
      expectedRevision: txtEditor.items[1].segment.revision,
    });
    await processHandle.call("review.accept", {
      reviewId: review.id,
      expectedSegmentRevision: txtEditor.items[1].segment.revision,
    });
    await processHandle.call("editor.undo", { projectId: project.id });
    let reviews = await processHandle.call("review.list", {
      documentId: txtDocument.documentId,
      includeClosed: true,
    });
    assert(reviews.revisions[0].status === "pending", "review should undo");
    await processHandle.call("editor.redo", { projectId: project.id });
    txtEditor = await processHandle.call("segment.editor.list", {
      documentId: txtDocument.documentId,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: true,
    });
    const confirmedReview = await processHandle.call("segment.confirm", {
      segmentId: txtEditor.items[1].segment.id,
      expectedRevision: txtEditor.items[1].segment.revision,
    });
    const signedReview = await processHandle.call("segment.workflow.set", {
      segmentId: confirmedReview.segment.id,
      state: "signed",
      expectedRevision: confirmedReview.segment.revision,
    });
    assert(
      signedReview.rows.find(
        (row) => row.segment.id === confirmedReview.segment.id,
      )?.workflowState === "signed",
      "reviewed segment should enter signed workflow state",
    );
    await processHandle.call("editor.undo", { projectId: project.id });
    await processHandle.call("editor.redo", { projectId: project.id });

    const xliffEditor = await processHandle.call("segment.editor.list", {
      documentId: xliffDocument.documentId,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: false,
    });
    const xliffTargetLength = xliffEditor.items[0].segment.targetText.length;
    const targetTags = xliffEditor.items[0].sourceTags.map((tag, index) => ({
      ...tag,
      id: `engine-smoke-target-${index}`,
      side: "target",
      position: Math.min(index + 1, xliffTargetLength),
    }));
    await processHandle.call("segment.tag.set", {
      segmentId: xliffEditor.items[0].segment.id,
      targetTags,
      expectedRevision: xliffEditor.items[0].segment.revision,
    });
    const undoneTags = await processHandle.call("editor.undo", {
      projectId: project.id,
    });
    assert(
      undoneTags.rows[0].targetTags.length === 0,
      "protected tags should undo",
    );
    await processHandle.call("editor.redo", { projectId: project.id });

    await processHandle.call("dictionary.add", {
      locale: "en-US",
      word: "mispellled",
    });
    const spell = await processHandle.call("segment.spell.check", {
      locale: "en-US",
      text: "mispellled mixed中文 punctuation，",
      limit: 20,
    });
    assert(
      spell.findings.every((finding) => finding.word !== "mispellled"),
      "user dictionary should suppress its word",
    );
    const preferences = await processHandle.call("editor.preferences.get", {});
    await processHandle.call("editor.preferences.update", {
      preferences: {
        ...preferences,
        theme: "dark",
        zoom: 125,
        showNonprinting: true,
      },
    });

    const splitBase = txtEditor.items[2].segment;
    let splitResult = await processHandle.call("segment.split", {
      segmentId: splitBase.id,
      sourceOffset: 5,
      targetOffset: 0,
      expectedRevision: splitBase.revision,
    });
    assert(splitResult.rows.length === 4, "TXT segment should split");
    const unsplitResult = await processHandle.call("editor.undo", {
      projectId: project.id,
    });
    assert(unsplitResult.rows.length === 3, "split should undo");
    splitResult = await processHandle.call("editor.redo", {
      projectId: project.id,
    });
    const firstSplitIndex = splitResult.rows.findIndex(
      (row) => row.segment.id === splitBase.id,
    );
    const firstSplit = splitResult.rows[firstSplitIndex].segment;
    const secondSplit = splitResult.rows[firstSplitIndex + 1].segment;
    const mergedResult = await processHandle.call("segment.merge", {
      firstSegmentId: firstSplit.id,
      secondSegmentId: secondSplit.id,
      firstExpectedRevision: firstSplit.revision,
      secondExpectedRevision: secondSplit.revision,
    });
    assert(mergedResult.rows.length === 3, "split siblings should merge");
    await processHandle.call("editor.undo", { projectId: project.id });
    await processHandle.call("editor.redo", { projectId: project.id });
    const editorHistory = await processHandle.call("editor.history", {
      projectId: project.id,
      offset: 0,
      limit: 100,
    });
    assert(
      editorHistory.canUndo,
      "editor history should survive compound actions",
    );
    const mergedTxtPage = await processHandle.call("segment.list", {
      documentId: txtDocument.documentId,
      offset: 0,
      limit: 20,
    });
    const exportSplitBase = mergedTxtPage.items.at(-1);
    await processHandle.call("segment.split", {
      segmentId: exportSplitBase.id,
      sourceOffset: 5,
      targetOffset: 0,
      expectedRevision: exportSplitBase.revision,
    });
    await exportWithQaDecision(
      processHandle,
      project.id,
      txtDocument.documentId,
      splitTextOutputPath,
      "Exercise split structural export with intentionally incomplete fixture targets",
    );
    assert(
      readFileSync(splitTextOutputPath, "utf8").includes("Third paragraph."),
      "split TXT should collapse to its safe structural path on export",
    );

    const alignmentEvidence = await exerciseAlignmentBeforeRestart(
      processHandle,
      dataDirectory,
      project.id,
    );
    const interopEvidence = await exerciseInteropBeforeRestart(
      processHandle,
      dataDirectory,
      project,
    );

    await processHandle.stop();
    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    await verifyInteropAfterRestart(processHandle, interopEvidence);
    await verifyAlignmentAfterRestart(processHandle, alignmentEvidence);
    const persistedPreferences = await processHandle.call(
      "editor.preferences.get",
      {},
    );
    assert(
      persistedPreferences.theme === "dark" &&
        persistedPreferences.zoom === 125,
      "editor preferences should persist through restart",
    );
    const persistedComments = await processHandle.call("segment.comment.list", {
      segmentId: changedTxt.id,
      includeResolved: true,
    });
    assert(
      persistedComments.comments[0].id === resolvedComment.id &&
        persistedComments.comments[0].resolved,
      "comments should persist through restart",
    );
    reviews = await processHandle.call("review.list", {
      documentId: txtDocument.documentId,
      includeClosed: true,
    });
    assert(
      reviews.revisions[0].status === "accepted",
      "review acceptance should persist through restart",
    );
    const persistedXliff = await processHandle.call("segment.editor.list", {
      documentId: xliffDocument.documentId,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset: 0,
      limit: 80,
      includeContext: false,
    });
    assert(
      persistedXliff.items[0].targetTags.length === targetTags.length,
      "protected tags should persist through restart",
    );
    const scannedPdfDocument = formatDocuments.find(
      (item) => item.sourcePath === pdfScannedPath,
    );
    assert(scannedPdfDocument, "scanned PDF document should be retained");
    const pdfPages = await processHandle.call("pdf.page.list", {
      documentId: scannedPdfDocument.documentId,
    });
    assert(
      pdfPages.pages.length === 1 &&
        pdfPages.pages[0].ocrBlockCount >= 3 &&
        pdfPages.pages[0].width > 500,
      "PDF page list should project stored OCR blocks and page geometry",
    );
    const pdfPage = await processHandle.call("pdf.page.get", {
      documentId: scannedPdfDocument.documentId,
      page: 1,
      dpi: 144,
    });
    assert(
      pdfPage.imagePngBase64.startsWith("iVBOR") &&
        pdfPage.blocks.every((block) => block.sourceKind === "ocr"),
      "PDF page get should return a real PNG and OCR block projection",
    );
    const correctedBlock = pdfPage.blocks.find((block) =>
      block.sourceText.includes("INV-2048"),
    );
    assert(correctedBlock, "OCR invoice block should be available");
    const correctedOcr = await processHandle.call("pdf.correctOcr", {
      segmentId: correctedBlock.segmentId,
      sourceText: correctedBlock.sourceText.replace("unchanged.", "unchanged!"),
      reason: "Verified against original scan",
      expectedRevision: correctedBlock.revision,
    });
    assert(
      correctedOcr.sourceText.endsWith("unchanged!") &&
        correctedOcr.revision === correctedBlock.revision + 1,
      "OCR correction should update source and revision atomically",
    );
    try {
      await processHandle.call("pdf.correctOcr", {
        segmentId: correctedBlock.segmentId,
        sourceText: correctedBlock.sourceText,
        reason: "Stale retry",
        expectedRevision: correctedBlock.revision,
      });
      throw new Error("stale OCR correction unexpectedly succeeded");
    } catch (error) {
      assert(
        error?.code === "conflict",
        "stale OCR correction should conflict",
      );
    }
    try {
      await processHandle.call("segment.updateTarget", {
        segmentId: first.id,
        targetText: "stale",
        expectedRevision: 0,
      });
      throw new Error("stale write unexpectedly succeeded");
    } catch (error) {
      assert(error?.code === "conflict", "stale write should return conflict");
    }
    const confirmed = await processHandle.call("segment.confirm", {
      segmentId: first.id,
      expectedRevision: recovered.items[0].revision,
    });
    assert(
      confirmed.qaIssues.some((issue) => issue.ruleId === "qa.number-mismatch"),
      "30/60 should create the authoritative number-mismatch finding",
    );
    const exact = await processHandle.call("tm.lookupExact", {
      projectId: project.id,
      sourceText: first.sourceText,
    });
    assert(exact.matches.length === 1, "confirmation should sink one TM entry");
    const assetExact = await processHandle.call("tm.search", {
      projectId: project.id,
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      query: first.sourceText,
      threshold: 100,
      offset: 0,
      limit: 50,
      libraryIds: [defaultLibrary.id],
    });
    const contextualUnit = assetExact.matches[0].unit;
    const contextMatch = await processHandle.call("tm.search", {
      projectId: project.id,
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      query: first.sourceText,
      threshold: 100,
      offset: 0,
      limit: 50,
      libraryIds: [defaultLibrary.id],
      contextBeforeHash: contextualUnit.contextBeforeHash,
      contextAfterHash: contextualUnit.contextAfterHash,
    });
    assert(
      contextMatch.matches[0].score === 101,
      "context match should score 101",
    );
    const second = recovered.items[2];
    const forbiddenDraft = await processHandle.call("segment.updateTarget", {
      segmentId: second.id,
      targetText: "这里包含禁用词。",
      expectedRevision: second.revision,
    });
    const forbiddenConfirmation = await processHandle.call("segment.confirm", {
      segmentId: second.id,
      expectedRevision: forbiddenDraft.revision,
    });
    assert(
      forbiddenConfirmation.qaIssues.some((issue) =>
        issue.ruleId.startsWith("term-forbidden:"),
      ),
      "forbidden term should produce a typed QA issue",
    );
    const corrected = await processHandle.call("segment.updateTarget", {
      segmentId: first.id,
      targetText: "保留期为 30 天。",
      expectedRevision: confirmed.segment.revision,
    });
    await processHandle.call("segment.confirm", {
      segmentId: first.id,
      expectedRevision: corrected.revision,
    });
    const cleanSecond = await processHandle.call("segment.updateTarget", {
      segmentId: second.id,
      targetText: "这里包含段落。",
      expectedRevision: forbiddenConfirmation.segment.revision,
    });
    await processHandle.call("segment.confirm", {
      segmentId: second.id,
      expectedRevision: cleanSecond.revision,
    });
    const issues = await processHandle.call("qa.list", {
      documentId: document.id,
      includeResolved: true,
    });
    assert(
      issues.issues.some(
        (issue) =>
          issue.ruleId === "qa.number-mismatch" && issue.status === "resolved",
      ) &&
        issues.issues.some(
          (issue) =>
            issue.ruleId.includes("term") && issue.status === "resolved",
        ),
      "corrected number and forbidden-term findings should resolve",
    );
    const definition = await processHandle.call("pipeline.create", {
      projectId: project.id,
      name: "Smoke QA pipeline",
      steps: [{ key: "qa", stepId: "core.qa.document", config: null }],
    });
    const run = await processHandle.call("pipeline.run", {
      definitionId: definition.id,
      projectId: project.id,
      documentId: document.id,
      input: {},
    });
    let finalRun = run;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (["succeeded", "failed", "canceled"].includes(finalRun.run.status)) {
        break;
      }
      await delay(10);
      finalRun = await processHandle.call("pipeline.run.get", {
        runId: run.run.id,
      });
    }
    assert(finalRun.run.status === "succeeded", "QA pipeline should succeed");
    const history = await processHandle.call("history.list", {
      projectId: project.id,
      offset: 0,
      limit: 500,
      descending: false,
    });
    assert(
      history.total >= 6,
      "project and segment operations should be recorded",
    );
    const ocrHistory = history.items.find(
      (operation) => operation.kind === "pdf.correct_ocr",
    );
    assert(
      ocrHistory?.after?.reason === "Verified against original scan",
      "OCR correction history should retain the required reason",
    );

    writeFileSync(aiSourcePath, "AI smoke source segment.\n", "utf8");
    const aiDocument = await processHandle.call("document.import", {
      projectId: project.id,
      sourcePath: aiSourcePath,
      filterId: "builtin.txt",
      options: { segmentationMode: "paragraph" },
    });
    const aiSegments = await processHandle.call("segment.list", {
      documentId: aiDocument.document.id,
      offset: 0,
      limit: 20,
    });
    const aiCatalog = await processHandle.call("ai.provider.catalog", {});
    assert(
      aiCatalog.items.length >= 10,
      "AI provider catalog should expose all first-release connectors",
    );
    const aiProfile = await processHandle.call("ai.provider.create", {
      name: "Smoke OpenAI-compatible",
      kind: "openaiCompatible",
      baseUrl: aiFixture.url,
      model: "fixture-model",
      timeoutMs: 5000,
      maxResponseBytes: 1048576,
      enabled: true,
    });
    const credentialStatus = await processHandle.call("ai.credential.set", {
      profileId: aiProfile.id,
      secret: "engine-smoke-secret",
    });
    assert(
      credentialStatus.present && credentialStatus.backend === "test-memory",
      "AI credential should use the injected test backend",
    );
    const aiSettings = await processHandle.call("ai.settings.get", {});
    await processHandle.call("ai.settings.update", {
      enabled: true,
      defaultProfileId: aiProfile.id,
      monthlyTokenBudget: 100000,
      allowInteractive: true,
      allowBatch: true,
      allowedOrigins: [aiFixture.url],
      expectedRevision: aiSettings.revision,
    });
    const conversation = await processHandle.call("ai.conversation.create", {
      projectId: project.id,
      title: "Smoke conversation",
    });
    const groundingOptions = defaultGroundingOptions();
    const grounding = await processHandle.call("ai.grounding.preview", {
      projectId: project.id,
      segmentId: aiSegments.items[0].id,
      expectedRevision: aiSegments.items[0].revision,
      action: "translate",
      prompt: "Translate for the smoke test",
      options: groundingOptions,
    });
    assert(
      grounding.bundle.sections.length >= 3 &&
        grounding.bundle.promptHash.length === 64,
      "grounding preview should be inspectable and hashed",
    );
    const aiRun = await processHandle.call("ai.run.start", {
      projectId: project.id,
      segmentId: aiSegments.items[0].id,
      profileId: aiProfile.id,
      expectedRevision: aiSegments.items[0].revision,
      action: "translate",
      prompt: "Translate for the smoke test",
      options: groundingOptions,
      conversationId: conversation.id,
      maxAttempts: 2,
    });
    const completedAiRun = await waitForAiRun(processHandle, aiRun.id);
    assert(
      completedAiRun.status === "succeeded" &&
        completedAiRun.proposalText === "AI fixture translation",
      "AI run should retain the authoritative streamed proposal",
    );
    const aiEvents = await processHandle.call("ai.run.events", {
      runId: aiRun.id,
      afterSequence: 0,
      limit: 100,
    });
    assert(
      aiEvents.items.some((event) => event.kind === "delta") &&
        aiEvents.items.some((event) => event.kind === "usage") &&
        aiEvents.items.some((event) => event.kind === "completed"),
      "AI event log should include streaming, usage, and completion",
    );
    await processHandle.call("ai.result.apply", {
      runId: aiRun.id,
      expectedRunRevision: completedAiRun.revision,
      expectedSegmentRevision: aiSegments.items[0].revision,
    });
    const aiUsage = await processHandle.call("ai.usage.query", {
      projectId: project.id,
      sinceMs: 0,
      untilMs: Date.now() + 1000,
      dimension: "provider",
      offset: 0,
      limit: 100,
    });
    assert(
      aiUsage.records.length === 1 &&
        aiUsage.records[0].usage.inputTokens === 20,
      "AI usage should be authoritative and exactly once",
    );
    const aiMessages = await processHandle.call("ai.conversation.messages", {
      conversationId: conversation.id,
      offset: 0,
      limit: 20,
    });
    assert(
      aiMessages.items.length === 2 &&
        aiMessages.items[1].targetProposal === "AI fixture translation",
      "AI conversation should retain the durable turn",
    );
    const emptyBatch = await processHandle.call("ai.batch.start", {
      projectId: project.id,
      documentId: aiDocument.document.id,
      profileId: aiProfile.id,
      tmThreshold: 85,
      concurrency: 2,
      requestsPerMinute: 600,
      maxAttempts: 2,
      replaceDrafts: false,
      options: groundingOptions,
    });
    const completedBatch = await waitForAiBatch(processHandle, emptyBatch.id);
    assert(
      completedBatch.status === "succeeded" && completedBatch.total === 0,
      "empty AI batch scope should converge to succeeded",
    );
    const pipelineSteps = await processHandle.call("pipeline.step.list", {});
    assert(
      pipelineSteps.steps.some((step) => step.id === "core.ai.pretranslate"),
      "AI pretranslation should be registered as a pipeline step",
    );

    const alignmentApplyEvidence = await exerciseAlignmentBeforeApplyRestart(
      processHandle,
      dataDirectory,
      project.id,
      alignmentEvidence,
      aiProfile.id,
    );
    const curationEvidence = await exerciseCurationBeforeRestart(
      processHandle,
      dataDirectory,
      project.id,
      aiProfile.id,
    );
    await processHandle.stop();
    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    const restoredCredential = await processHandle.call("ai.credential.set", {
      profileId: aiProfile.id,
      secret: "engine-smoke-secret",
    });
    assert(
      restoredCredential.present,
      "AI fixture credential should be restored after alignment restart",
    );
    await verifyAlignmentAfterApplyRestart(
      processHandle,
      project.id,
      alignmentApplyEvidence,
    );
    await verifyCurationAfterRestart(
      processHandle,
      dataDirectory,
      project.id,
      curationEvidence,
    );

    const qaProfiles = await processHandle.call("qa.profile.list", {
      projectId: project.id,
      offset: 0,
      limit: 100,
    });
    const builtInProfile = qaProfiles.items.find((profile) => profile.builtIn);
    assert(builtInProfile, "QA should expose a built-in profile");
    const customQaProfile = await processHandle.call("qa.profile.clone", {
      profileId: builtInProfile.id,
      ownerProjectId: project.id,
      name: "Smoke QA profile",
    });
    const updatedQaProfile = await processHandle.call("qa.profile.update", {
      profileId: customQaProfile.id,
      expectedRevision: customQaProfile.revision,
      name: customQaProfile.name,
      definition: {
        ...customQaProfile.definition,
        regexRules: [
          ...(customQaProfile.definition.regexRules ?? []),
          {
            id: "smoke.target-marker",
            label: "Smoke target marker",
            field: "target",
            pattern: "保留期",
            severity: "warning",
            message: "Smoke target marker matched",
            replacementHint: null,
          },
        ],
      },
    });
    const projectQaRun = await processHandle.call("qa.run", {
      projectId: project.id,
      profileId: updatedQaProfile.id,
    });
    assert(
      projectQaRun.scope === "project" && projectQaRun.checkedSegments > 3,
      "project QA should check every active document",
    );
    const documentQaRun = await processHandle.call("qa.run", {
      projectId: project.id,
      documentId: document.id,
      profileId: updatedQaProfile.id,
    });
    const qaIssues = await processHandle.call("qa.issue.list", {
      projectId: project.id,
      documentId: document.id,
      disposition: "open",
      offset: 0,
      limit: 100,
    });
    assert(
      qaIssues.total > 0 &&
        qaIssues.items.some(
          (issue) => issue.ruleId === "qa.regex:smoke.target-marker",
        ),
      "document QA should return mechanical and custom regex findings",
    );
    const waiverTarget = qaIssues.items[0];
    const waivedIssue = await processHandle.call("qa.issue.waive", {
      issueId: waiverTarget.id,
      actor: "engine-smoke",
      reason: "Exercise durable false-positive review",
    });
    assert(waivedIssue.disposition === "waived", "QA issue should be waived");
    const reopenedIssue = await processHandle.call("qa.issue.revoke", {
      issueId: waivedIssue.id,
      expectedRevision: waivedIssue.waiver.revision,
    });
    assert(reopenedIssue.disposition === "open", "QA waiver should revoke");
    const htmlReport = await processHandle.call("qa.report.export", {
      runId: documentQaRun.id,
      format: "html",
      outputPath: qaHtmlReportPath,
    });
    const xlsxReport = await processHandle.call("qa.report.export", {
      runId: documentQaRun.id,
      format: "xlsx",
      outputPath: qaXlsxReportPath,
    });
    assert(
      htmlReport.format === "html" &&
        xlsxReport.format === "xlsx" &&
        readFileSync(qaHtmlReportPath, "utf8").includes(
          "translunar://segment/",
        ) &&
        statSync(qaXlsxReportPath).size > 0,
      "QA HTML/XLSX reports should publish navigable snapshots",
    );
    const reviewStats = await processHandle.call("review.stats", {
      projectId: project.id,
      documentId: document.id,
    });
    const reviewQueue = await processHandle.call("review.queue", {
      projectId: project.id,
      documentId: document.id,
      offset: 0,
      limit: 100,
    });
    assert(
      reviewStats.translationSegments +
        reviewStats.reviewSegments +
        reviewStats.signedSegments ===
        document.segmentCount && Array.isArray(reviewQueue.items),
      "review statistics and queue should be authoritative",
    );
    try {
      await processHandle.call("document.export", {
        documentId: document.id,
        outputPath,
      });
      throw new Error("dirty document unexpectedly bypassed the QA gate");
    } catch (error) {
      assert(
        error?.code === "qa_gate_blocked" && !existsSync(outputPath),
        "dirty export should be blocked without publication",
      );
    }

    const health = await processHandle.call("data.checkHealth", {});
    assert(health.healthy, "valid workspace should pass health check");
    const backup = await processHandle.call("data.createBackup", {
      destinationPath: backupPath,
    });
    assert(
      backup.manifest.schemaVersion === health.schemaVersion,
      "backup should contain latest schema",
    );
    assert(
      existsSync(join(backupPath, "translunar.sqlite3")),
      "backup database should exist",
    );
    const exported = await processHandle.call("document.export", {
      documentId: document.id,
      outputPath,
      qaOverride: {
        actor: "engine-smoke",
        reason:
          "Exercise an audited delivery override for the dirty smoke fixture",
      },
    });
    assert(
      exported.translatedSegments === 2,
      "export should contain two translated segments",
    );
    const legacyGate = await processHandle.call("qa.gate.check", {
      projectId: project.id,
      documentId: legacyDocument.id,
    });
    const legacyExported = await processHandle.call("document.exportDocx", {
      documentId: legacyDocument.id,
      outputPath: legacyOutputPath,
      ...(!legacyGate.clear
        ? {
            qaOverride: {
              actor: "engine-smoke",
              reason: "Exercise legacy export compatibility with the QA gate",
            },
          }
        : {}),
    });
    assert(
      legacyExported.translatedSegments === 2,
      "legacy export should contain the confirmed duplicate propagated by the editor",
    );
    assert(statSync(outputPath).size > 0, "export should be non-empty");
    assert(
      statSync(legacyOutputPath).size > 0,
      "legacy export should be non-empty",
    );
    for (const formatDocument of formatDocuments) {
      await exportWithQaDecision(
        processHandle,
        project.id,
        formatDocument.documentId,
        formatDocument.outputPath,
        "Exercise format round-trip with intentionally partial translations",
      );
      assert(
        statSync(formatDocument.outputPath).size > 0,
        "format export should be non-empty",
      );
    }
    const mqxlzDocument = formatDocuments.find(
      (item) => item.filterId === "builtin.mqxlz",
    );
    assert(mqxlzDocument, "MQXLZ smoke document should exist");
    try {
      await exportWithQaDecision(
        processHandle,
        project.id,
        mqxlzDocument.documentId,
        mqxlzDocument.outputPath,
        "Reach the MQXLZ no-clobber publication check",
      );
      throw new Error("MQXLZ export unexpectedly replaced an existing file");
    } catch (error) {
      assert(error?.code === "export_error", "MQXLZ export should not clobber");
    }
    try {
      const scannedGate = await processHandle.call("qa.gate.check", {
        projectId: project.id,
        documentId: scannedPdfDocument.documentId,
      });
      await processHandle.call("document.export", {
        documentId: scannedPdfDocument.documentId,
        outputPath: pdfScannedOutputPath,
        ...(!scannedGate.clear
          ? {
              qaOverride: {
                actor: "engine-smoke",
                reason:
                  "Reach the no-clobber publication check through the QA gate",
              },
            }
          : {}),
      });
      throw new Error("PDF export unexpectedly replaced an existing file");
    } catch (error) {
      assert(error?.code === "export_error", "PDF export should not clobber");
    }
    const reconstructedPdf = await processHandle.call("document.import", {
      projectId: project.id,
      sourcePath: pdfTextOutputPath,
    });
    assert(
      reconstructedPdf.filterId === "builtin.docx",
      "reconstructed PDF output should re-import as DOCX",
    );
    const reconstructedSegments = await processHandle.call("segment.list", {
      documentId: reconstructedPdf.document.id,
      offset: 0,
      limit: 200,
    });
    assert(
      reconstructedSegments.items.length >= 10,
      "reconstructed DOCX should retain PDF block order",
    );
    const textOutput = readFileSync(textOutputPath, "utf8");
    assert(
      textOutput.includes("第一句。") &&
        textOutput.includes("第二句审阅译文。") &&
        textOutput.includes("Third paragraph."),
      "TXT export should preserve BOM/newlines and untranslated content",
    );
    const markdownOutput = readFileSync(markdownOutputPath, "utf8");
    assert(
      markdownOutput.includes("# 标题") &&
        markdownOutput.includes("https://example.test") &&
        markdownOutput.includes("`code`"),
      "Markdown export should preserve syntax, code, and URL",
    );
    const htmlOutput = readFileSync(htmlOutputPath, "utf8");
    assert(
      htmlOutput.includes("<!-- keep -->") &&
        htmlOutput.includes("<strong>world</strong>") &&
        htmlOutput.includes("<script>skip()</script>"),
      "HTML export should preserve unowned nodes",
    );
    const xliffOutput = readFileSync(xliffOutputPath, "utf8");
    assert(
      xliffOutput.includes("<target>") &&
        xliffOutput.includes('<ph id="p"/>') &&
        xliffOutput.includes('id="s"'),
      "XLIFF export should insert a target and preserve IDs/inline code",
    );
    const sdlxliffOutput = readFileSync(sdlxliffOutputPath, "utf8");
    assert(
      sdlxliffOutput.includes("SDL ") &&
        sdlxliffOutput.includes("新译文") &&
        sdlxliffOutput.includes('<x:meta keep="yes"/>') &&
        sdlxliffOutput.includes('sdl:locked="true"') &&
        sdlxliffOutput.includes('<g id="1">'),
      "SDLXLIFF export should preserve vendor metadata and inline code",
    );
    const mqxliffOutput = readFileSync(mqxliffOutputPath, "utf8");
    assert(
      mqxliffOutput.includes("memoQ ") &&
        mqxliffOutput.includes("新译文") &&
        mqxliffOutput.includes('<mq:metadata keep="yes"/>') &&
        mqxliffOutput.includes('mq:status="Confirmed"') &&
        mqxliffOutput.includes('<ph id="1"/>'),
      "MQXLIFF export should preserve memoQ state and inline code",
    );
    const mqxlzOutput = readFileSync(mqxlzOutputPath);
    assert(
      mqxlzOutput.includes(Buffer.from("包内新译文")) &&
        mqxlzOutput.includes(Buffer.from("opaque-mqxlz-payload")),
      "MQXLZ export should retain translated XML and opaque auxiliary bytes",
    );
    for (const [sourcePath, filterId, expectedTarget] of [
      [sdlxliffOutputPath, "builtin.sdlxliff", "SDL 新译文"],
      [mqxliffOutputPath, "builtin.mqxliff", "memoQ 新译文"],
      [mqxlzOutputPath, "builtin.mqxlz", "包内新译文"],
    ]) {
      const roundTrip = await processHandle.call("document.import", {
        projectId: project.id,
        sourcePath,
      });
      assert(
        roundTrip.filterId === filterId,
        `${filterId} output should re-import`,
      );
      const roundTripSegments = await processHandle.call("segment.list", {
        documentId: roundTrip.document.id,
        offset: 0,
        limit: 10,
      });
      assert(
        roundTripSegments.items[0].targetText === expectedTarget,
        `${filterId} output should retain its target text`,
      );
    }
    const xlsxOutput = readFileSync(xlsxOutputPath);
    assert(
      xlsxOutput.includes(Buffer.from("你好表格")) &&
        xlsxOutput.includes(Buffer.from("SUM(A1:B1)")),
      "XLSX export should translate selected text and preserve formulas",
    );
    const pptxOutput = readFileSync(pptxOutputPath);
    assert(
      pptxOutput.includes(Buffer.from("你好幻灯片")) &&
        pptxOutput.includes(Buffer.from("SmartArt text")) &&
        pptxOutput.includes(Buffer.from("fixture-png")),
      "PPTX export should translate text and preserve SmartArt/media",
    );
    await exerciseDiscussionAndSnapshotWorkflow(
      processHandle,
      project.id,
      document.id,
    );
    await exerciseTaskPackageWorkflow(processHandle, binary, dataDirectory);
    console.log(`Engine smoke passed: ${outputPath}; backup: ${backupPath}`);
  } finally {
    await processHandle?.stop();
    await aiFixture.close();
    await rm(dataDirectory, { recursive: true, force: true });
    await rm(backupParent, { recursive: true, force: true });
  }
}

async function exerciseFocusedCollabSmoke(processHandle) {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-collab-smoke-"),
  );
  const sourcePath = join(fixtureDirectory, "sample.txt");
  writeFileSync(
    sourcePath,
    ["Hello collab.", "", "Second."].join(String.fromCharCode(10)),
    "utf8",
  );
  const project = await processHandle.call("project.create", {
    name: "Collab smoke",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    domain: "general",
  });
  const imported = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath,
  });
  const segments = await processHandle.call("segment.list", {
    documentId: imported.document.id,
    offset: 0,
    limit: 10,
  });
  assert(segments.items.length >= 1, "segments");
  const member = await processHandle.call("collab.member.add", {
    projectId: project.id,
    actorId: "alice",
    role: "owner",
    actingActor: "alice",
  });
  assert(member.actorId === "alice", "member");
  await processHandle.call("collab.member.add", {
    projectId: project.id,
    actorId: "bob",
    role: "member",
    actingActor: "alice",
  });
  const members = await processHandle.call("collab.member.list", {
    projectId: project.id,
  });
  assert(members.items.length >= 2, "members");
  const lock = await processHandle.call("collab.lock.acquire", {
    projectId: project.id,
    documentId: imported.document.id,
    segmentId: segments.items[0].id,
    actorId: "alice",
    ttlMs: 60000,
  });
  assert(lock.actorId === "alice", "lock holder");
  let conflicted = false;
  try {
    await processHandle.call("collab.lock.acquire", {
      projectId: project.id,
      documentId: imported.document.id,
      segmentId: segments.items[0].id,
      actorId: "bob",
    });
  } catch (error) {
    conflicted = true;
  }
  assert(conflicted, "bob should conflict");
  await processHandle.call("collab.presence.heartbeat", {
    projectId: project.id,
    actorId: "alice",
    documentId: imported.document.id,
    segmentId: segments.items[0].id,
  });
  const presence = await processHandle.call("collab.presence.list", {
    projectId: project.id,
  });
  assert(
    presence.items.some((item) => item.actorId === "alice"),
    "presence",
  );
  const assignment = await processHandle.call("collab.assignment.create", {
    projectId: project.id,
    documentId: imported.document.id,
    assigneeActorId: "bob",
    ordinalStart: 0,
    ordinalEnd: 0,
    createdBy: "alice",
  });
  await processHandle.call("collab.assignment.complete", {
    assignmentId: assignment.id,
    expectedRevision: assignment.revision,
    actorId: "bob",
  });
  await processHandle.call("collab.lock.release", {
    segmentId: segments.items[0].id,
    actorId: "alice",
  });
  const ops = await processHandle.call("collab.opLog.list", {
    projectId: project.id,
    afterSequence: 0,
    limit: 50,
  });
  assert(ops.total >= 3, "op log entries");
}

async function exerciseFocusedAiQualitySmoke(processHandle) {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-ai-quality-smoke-"),
  );
  const sourcePath = join(fixtureDirectory, "sample.txt");
  const sourceBody = [
    "Replace the actuator housing now.",
    "",
    "Clean the actuator housing carefully.",
    "",
    "Do not remove safety covers.",
    "",
  ].join(String.fromCharCode(10));
  writeFileSync(sourcePath, sourceBody, "utf8");
  const project = await processHandle.call("project.create", {
    name: "AI quality smoke",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    domain: "general",
  });
  const imported = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath,
  });
  const segments = await processHandle.call("segment.list", {
    documentId: imported.document.id,
    offset: 0,
    limit: 50,
  });
  // Leave one empty and one equal-to-source for detectors.
  if (segments.items[0]) {
    await processHandle.call("segment.updateTarget", {
      segmentId: segments.items[0].id,
      targetText: "更换执行器外壳",
      expectedRevision: segments.items[0].revision,
    });
  }
  if (segments.items[1]) {
    await processHandle.call("segment.updateTarget", {
      segmentId: segments.items[1].id,
      targetText: segments.items[1].sourceText,
      expectedRevision: segments.items[1].revision,
    });
  }
  const scores = await processHandle.call("ai.quality.scoreDocument", {
    documentId: imported.document.id,
  });
  assert(scores.scores.length >= 2, "score rows");
  const semantic = await processHandle.call("ai.quality.semanticQa", {
    documentId: imported.document.id,
  });
  assert(
    semantic.findings.some(
      (item) => item.code === "semantic.source_equals_target",
    ),
    "semantic equal finding",
  );
  const terms = await processHandle.call("ai.quality.extractTerms", {
    documentId: imported.document.id,
    minimumFrequency: 2,
  });
  assert(
    terms.candidates.some((item) => item.sourceTerm === "actuator"),
    "actuator candidate",
  );
}

async function exerciseFocusedApiCliSmoke(dataDirectory) {
  const root = resolve(import.meta.dirname, "..");
  const cli = join(
    root,
    "target",
    "debug",
    process.platform === "win32" ? "translunar.exe" : "translunar",
  );
  assert(existsSync(cli), `missing translunar CLI at ${cli}`);
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-api-cli-smoke-"),
  );
  const sourcePath = join(fixtureDirectory, "sample.txt");
  const outputPath = join(fixtureDirectory, "out.txt");
  const sourceBody = ["Hello API CLI smoke.", "", "Second unit.", ""].join(
    String.fromCharCode(10),
  );
  writeFileSync(sourcePath, sourceBody, "utf8");

  const run = spawnSync(
    cli,
    [
      "--data-dir",
      dataDirectory,
      "--json",
      "run",
      "--source",
      sourcePath,
      "--output",
      outputPath,
      "--name",
      "API CLI smoke",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TRANSLUNAR_API_TEST_MODE: "1",
        TRANSLUNAR_API_TEST_TOKEN: "test-local-api-token-value-32b",
      },
    },
  );
  assert(run.status === 0, `cli run failed: ${run.stderr || run.stdout}`);
  const summary = JSON.parse(run.stdout);
  assert(summary.projectId, "project id");
  assert(summary.segmentCount >= 1, "segments");
  assert(existsSync(outputPath), "export exists");

  const token = spawnSync(
    cli,
    ["--data-dir", dataDirectory, "--json", "token", "ensure"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TRANSLUNAR_API_TEST_MODE: "1",
        TRANSLUNAR_API_TEST_TOKEN: "test-local-api-token-value-32b",
      },
    },
  );
  assert(
    token.status === 0,
    `token ensure failed: ${token.stderr || token.stdout}`,
  );
  const tokenJson = JSON.parse(token.stdout);
  assert(tokenJson.token, "token present");
}

async function exerciseFocusedPluginSmoke(processHandle, dataDirectory) {
  const root = resolve(import.meta.dirname, "..");
  const pluginSource = join(root, "examples", "plugins", "hello-srt");
  const crashPluginSource = join(root, "fixtures", "plugins", "crash-filter");
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-plugin-smoke-"),
  );
  const sourcePath = join(fixtureDirectory, "sample.srt");
  const outputPath = join(fixtureDirectory, "translated.srt");
  const crashSourcePath = join(fixtureDirectory, "sample.crash");
  const srtBody = [
    "1",
    "00:00:01,000 --> 00:00:02,000",
    "Hello plugin world",
    "",
    "2",
    "00:00:03,000 --> 00:00:04,000",
    "Second cue",
    "",
  ].join(String.fromCharCode(10));
  writeFileSync(sourcePath, srtBody, "utf8");
  writeFileSync(crashSourcePath, "crash fixture", "utf8");

  const installed = await processHandle.call("plugin.install", {
    sourcePath: pluginSource,
    grantRequested: true,
    actor: "smoke",
    reason: "focused plugin smoke install",
  });
  assert(installed.plugin.id === "example.hello-srt", "install id");
  assert(installed.plugin.status === "installed", "install status");

  const enabled = await processHandle.call("plugin.enable", {
    pluginId: "example.hello-srt",
    actor: "smoke",
    reason: "enable hello-srt",
  });
  assert(enabled.plugin.status === "enabled", "enable status");

  let duplicateError;
  try {
    await processHandle.call("plugin.install", {
      sourcePath: pluginSource,
      grantRequested: false,
      actor: "smoke",
      reason: "duplicate install must fail closed",
    });
  } catch (error) {
    duplicateError = error;
  }
  assert(duplicateError?.code === "invalid_state", "duplicate typed conflict");
  const afterDuplicate = await processHandle.call("plugin.get", {
    pluginId: "example.hello-srt",
  });
  assert(
    afterDuplicate.revision === enabled.plugin.revision &&
      afterDuplicate.status === "enabled",
    "duplicate install leaves enabled record unchanged",
  );

  const filters = await processHandle.call("filter.list", {});
  assert(
    filters.filters.some((item) => item.id === "example.hello-srt"),
    "filter contribution registered",
  );

  await processHandle.restart();
  await processHandle.call("engine.initialize", {
    protocolVersion: 1,
    client: { name: "plugin-smoke-restart", version: "0.1.0" },
  });
  const restartedPlugin = await processHandle.call("plugin.get", {
    pluginId: "example.hello-srt",
  });
  assert(
    restartedPlugin.status === "enabled",
    "enabled status survives restart",
  );
  const restartedFilters = await processHandle.call("filter.list", {});
  assert(
    restartedFilters.filters.some((item) => item.id === "example.hello-srt"),
    "enabled contribution survives restart",
  );

  const project = await processHandle.call("project.create", {
    name: "Plugin smoke",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    domain: "general",
  });
  const imported = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath,
    filterId: "example.hello-srt",
  });
  assert(imported.document.segmentCount >= 2, "imported srt cues");
  const segments = await processHandle.call("segment.list", {
    documentId: imported.document.id,
    offset: 0,
    limit: 100,
  });
  const exported = await processHandle.call("document.export", {
    documentId: imported.document.id,
    outputPath,
    qaOverride: {
      actor: "plugin-smoke",
      reason: "qualify plugin export with untranslated fixture segments",
    },
  });
  assert(exported.filterId === "example.hello-srt", "plugin export filter id");
  assert(
    exported.translatedSegments === segments.total && existsSync(outputPath),
    "plugin export publishes subtitle output",
  );

  const listed = await processHandle.call("plugin.list", {
    offset: 0,
    limit: 20,
  });
  assert(listed.total >= 1, "plugin list total");

  const crashInstalled = await processHandle.call("plugin.install", {
    sourcePath: crashPluginSource,
    grantRequested: true,
    actor: "smoke",
    reason: "install crash isolation fixture",
  });
  const crashEnabled = await processHandle.call("plugin.enable", {
    pluginId: "fixture.crash-filter",
    expectedRevision: crashInstalled.plugin.revision,
    actor: "smoke",
    reason: "enable crash isolation fixture",
  });
  let crashError;
  try {
    await processHandle.call("document.import", {
      projectId: project.id,
      sourcePath: crashSourcePath,
      filterId: "fixture.crash-filter",
    });
  } catch (error) {
    crashError = error;
  }
  assert(
    crashError?.code === "plugin_process_failed",
    "typed crash error code",
  );
  assert(
    crashError?.data?.pluginId === "fixture.crash-filter" &&
      crashError?.data?.filterId === "fixture.crash-filter" &&
      crashError?.data?.operation === "filter.import" &&
      crashError?.data?.failureKind === "crash" &&
      crashError?.data?.retryable === false,
    "typed crash error data",
  );
  assert(
    !String(crashError?.message).includes("private fixture stderr"),
    "plugin stderr is not exposed over RPC",
  );
  const degraded = await processHandle.call("plugin.get", {
    pluginId: "fixture.crash-filter",
  });
  assert(degraded.status === "degraded", "crashed plugin is degraded");
  assert(
    degraded.crashCount === crashEnabled.plugin.crashCount + 1,
    "crash count increments once",
  );
  assert(
    degraded.lastError.includes("filter.import") &&
      !degraded.lastError.includes("private fixture stderr"),
    "bounded last error is durable and excludes stderr",
  );
  const filtersAfterCrash = await processHandle.call("filter.list", {});
  assert(
    !filtersAfterCrash.filters.some(
      (item) => item.id === "fixture.crash-filter",
    ),
    "crashed contribution is unregistered",
  );
  await processHandle.call("project.list", { offset: 0, limit: 10 });

  await processHandle.restart();
  await processHandle.call("engine.initialize", {
    protocolVersion: 1,
    client: { name: "plugin-crash-restart", version: "0.1.0" },
  });
  const degradedAfterRestart = await processHandle.call("plugin.get", {
    pluginId: "fixture.crash-filter",
  });
  assert(
    degradedAfterRestart.status === "degraded" &&
      degradedAfterRestart.crashCount === degraded.crashCount &&
      degradedAfterRestart.lastError === degraded.lastError,
    "degraded diagnostics survive restart",
  );
  const filtersAfterCrashRestart = await processHandle.call("filter.list", {});
  assert(
    !filtersAfterCrashRestart.filters.some(
      (item) => item.id === "fixture.crash-filter",
    ),
    "degraded contribution stays unregistered after restart",
  );
  await processHandle.call("project.list", { offset: 0, limit: 10 });
  await processHandle.call("plugin.uninstall", {
    pluginId: "fixture.crash-filter",
    expectedRevision: degradedAfterRestart.revision,
    actor: "smoke",
    reason: "remove crash isolation fixture",
  });

  const disabled = await processHandle.call("plugin.disable", {
    pluginId: "example.hello-srt",
    actor: "smoke",
    reason: "disable after import",
  });
  assert(disabled.plugin.status === "disabled", "disable status");
  const filtersAfter = await processHandle.call("filter.list", {});
  assert(
    !filtersAfter.filters.some((item) => item.id === "example.hello-srt"),
    "filter contribution removed",
  );

  await processHandle.call("plugin.uninstall", {
    pluginId: "example.hello-srt",
    actor: "smoke",
    reason: "uninstall hello-srt",
  });
  const after = await processHandle.call("plugin.list", {
    offset: 0,
    limit: 20,
  });
  assert(
    !after.items.some((item) => item.id === "example.hello-srt"),
    "plugin uninstalled",
  );

  await processHandle.call("project.list", { offset: 0, limit: 10 });
}

async function exerciseFocusedCurationSmoke(
  processHandle,
  dataDirectory,
  providerUrl,
) {
  const project = await processHandle.call("project.create", {
    name: "Focused curation smoke",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    domain: "general",
  });
  const termbases = await processHandle.call("termbase.list", {
    projectId: project.id,
    offset: 0,
    limit: 10,
  });
  const defaultTermbase = termbases.items[0];
  assert(defaultTermbase, "focused curation smoke requires a termbase");
  await processHandle.call("term.upsert", {
    termbaseId: defaultTermbase.id,
    sourceLocale: project.sourceLocale,
    sourceTerm: "payment terms",
    status: "candidate",
    translations: [
      {
        locale: project.targetLocale,
        term: "付款条款",
        preferred: true,
        forbidden: false,
      },
    ],
  });

  const corpusPath = join(dataDirectory, "curation-catalog-corpus.txt");
  writeFileSync(corpusPath, "Payment terms remain available for reference.\n");
  const projectBeforeCorpus = await processHandle.call("project.get", {
    projectId: project.id,
  });
  await processHandle.call("corpus.import", {
    projectId: project.id,
    expectedProjectRevision: projectBeforeCorpus.project.revision,
    sourcePath: corpusPath,
    name: "Focused curation corpus",
    kind: "monolingualSource",
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
    filterId: "builtin.txt",
    options: { segmentationMode: "paragraph" },
    actor: "engine-smoke",
    reason: "Seed the unified asset catalog",
  });

  const profile = await processHandle.call("ai.provider.create", {
    name: "Focused curation provider",
    kind: "openaiCompatible",
    baseUrl: providerUrl,
    model: "fixture-model",
    timeoutMs: 5_000,
    maxResponseBytes: 1_048_576,
    enabled: true,
  });
  await processHandle.call("ai.credential.set", {
    profileId: profile.id,
    secret: "engine-smoke-secret",
  });
  const settings = await processHandle.call("ai.settings.get", {});
  await processHandle.call("ai.settings.update", {
    enabled: true,
    defaultProfileId: profile.id,
    monthlyTokenBudget: 100_000,
    allowInteractive: true,
    allowBatch: true,
    allowedOrigins: [providerUrl],
    expectedRevision: settings.revision,
  });

  const evidence = await exerciseCurationBeforeRestart(
    processHandle,
    dataDirectory,
    project.id,
    profile.id,
  );
  await processHandle.restart();
  await processHandle.call("engine.initialize", {
    protocolVersion: 1,
    client: { name: "engine-smoke", version: "0.1.0" },
  });
  await verifyCurationAfterRestart(
    processHandle,
    dataDirectory,
    project.id,
    evidence,
  );
}

async function exerciseCurationBeforeRestart(
  processHandle,
  dataDirectory,
  projectId,
  providerProfileId,
) {
  const projectSnapshot = await processHandle.call("project.get", {
    projectId,
  });
  const project = projectSnapshot.project;
  const seedPath = join(dataDirectory, "curation-dirty.csv");
  const duplicatePath = join(dataDirectory, "curation-duplicates.txt");
  const jsonlPath = join(dataDirectory, "curation-clean.jsonl");
  const stalePath = join(dataDirectory, "curation-stale.jsonl");
  const existingPath = join(dataDirectory, "curation-existing.tsv");
  const library = await processHandle.call("tm.library.create", {
    name: "Smoke curation library",
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
    domain: "curation-smoke",
    writable: true,
    ownerProjectId: projectId,
  });
  await processHandle.call("tm.library.mount", {
    projectId,
    libraryId: library.id,
    mode: "write",
    priority: 2,
    enabled: true,
  });
  writeFileSync(
    seedPath,
    [
      "source,target,sourceLocale,targetLocale,domain,author,createdAtMs",
      "A stable legal sentence,稳定的法律句子,en-US,zh-CN,curation-smoke,smoke,500",
      "CurateSmoke mirror text,CurateSmoke mirror text,en-US,zh-CN,curation-smoke,smoke,520",
      "CurateSmoke invoice 10 is due,策展发票 20 已到期,en-US,zh-CN,curation-smoke,smoke,540",
      "CurateSmoke hello {name},策展你好,en-US,zh-CN,curation-smoke,smoke,560",
      "CurateSmoke this extremely detailed contractual sentence contains many important payment obligations,短,en-US,zh-CN,curation-smoke,smoke,580",
      "CurateSmoke payment terms are due in 30 days,策展付款条款在 30 天内到期,en-US,zh-CN,curation-smoke,smoke,600",
      "CurateSmoke payment terms are due in 30 days,策展款项须于三十日内支付,en-US,zh-CN,curation-smoke,smoke,620",
      "X,乙,en-US,zh-CN,curation-smoke,smoke,640",
      "CurateSmoke the sky is blue,策展合同已经终止,en-US,zh-CN,curation-smoke,smoke,660",
      "CurateSmoke archived sentence,策展归档句子,en-US,zh-CN,curation-smoke,smoke,42",
    ].join("\n"),
    "utf8",
  );
  const imported = await processHandle.call("tm.import", {
    libraryId: library.id,
    sourcePath: seedPath,
    format: "csv",
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
  });
  assert(
    imported.inserted === 10 && imported.skipped === 0,
    "curation fixture should import every distinct dirty TM row",
  );

  writeFileSync(
    duplicatePath,
    "CurateSmoke duplicate clause.\n\nCurateSmoke duplicate clause.\n",
    "utf8",
  );
  const duplicateDocument = await processHandle.call("document.import", {
    projectId,
    sourcePath: duplicatePath,
    relativePath: "curation/duplicates.txt",
    filterId: "builtin.txt",
    options: { segmentationMode: "paragraph" },
  });
  const duplicateSegments = await processHandle.call("segment.list", {
    documentId: duplicateDocument.document.id,
    offset: 0,
    limit: 10,
  });
  assert(
    duplicateSegments.items.length === 2,
    "curation duplicate fixture should create two distinct source segments",
  );
  for (const originalSegment of duplicateSegments.items) {
    const currentDuplicatePage = await processHandle.call("segment.list", {
      documentId: duplicateDocument.document.id,
      offset: 0,
      limit: 10,
    });
    const segment = currentDuplicatePage.items.find(
      (item) => item.id === originalSegment.id,
    );
    assert(
      segment,
      "duplicate segment should remain addressable after propagation",
    );
    const updated = await processHandle.call("segment.updateTarget", {
      segmentId: segment.id,
      targetText: "策展重复条款。",
      expectedRevision: segment.revision,
    });
    await processHandle.call("segment.confirm", {
      segmentId: segment.id,
      expectedRevision: updated.revision,
    });
  }

  const libraryPage = await processHandle.call("tm.library.list", {
    projectId,
    offset: 0,
    limit: 100,
  });
  const currentLibrary = libraryPage.items.find(
    (item) => item.id === library.id,
  );
  assert(currentLibrary, "curation library should remain project-visible");

  const catalog = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "all",
    sourceLocale: project.sourceLocale,
    offset: 0,
    limit: 500,
  });
  const catalogKinds = new Set(catalog.items.map((item) => item.kind));
  assert(
    ["tm", "termbase", "corpus"].every((kind) => catalogKinds.has(kind)),
    "unified asset catalog should project TM, termbase, and corpus rows",
  );
  const curationCatalog = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
    domain: "curation-smoke",
    offset: 0,
    limit: 500,
  });
  assert(
    curationCatalog.total === 12 &&
      curationCatalog.items.every(
        (item) =>
          item.collectionId === library.id &&
          item.curationState === "active" &&
          item.qualityScoreBasisPoints == null,
      ),
    "catalog should expose the complete pre-analysis TM projection without mutation",
  );
  const firstCatalogPage = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    query: "CurateSmoke",
    offset: 0,
    limit: 3,
  });
  const secondCatalogPage = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    query: "CurateSmoke",
    offset: 3,
    limit: 3,
  });
  assert(
    firstCatalogPage.total === 10 &&
      firstCatalogPage.items.length === 3 &&
      secondCatalogPage.items.length === 3 &&
      !firstCatalogPage.items.some((item) =>
        secondCatalogPage.items.some((next) => next.id === item.id),
      ),
    "catalog filters and deterministic offset paging should remain bounded",
  );

  const providerRun = await processHandle.call("curation.run", {
    projectId,
    libraryId: library.id,
    expectedLibraryRevision: currentLibrary.revision,
    providerProfileId,
    actor: "engine-smoke",
    reason: "Exercise strict provider-backed curation annotations",
    correlationId: "engine-smoke-curation-provider",
    offset: 0,
    limit: 3,
  });
  assert(
    providerRun.run.mode === "provider" && providerRun.total === 12,
    "valid ID-only provider annotations should create a provider curation run",
  );
  await assertRpcError(
    () =>
      processHandle.call("curation.run", {
        projectId,
        libraryId: library.id,
        expectedLibraryRevision: currentLibrary.revision,
        providerProfileId,
        actor: "engine-smoke",
        reason: "Reject an unknown provider annotation ID",
        correlationId: "engine-smoke-curation-provider-invalid",
        offset: 0,
        limit: 3,
      }),
    "provider_protocol",
    "unknown curation provider annotation",
  );
  const libraryAfterProviderFailure = await processHandle.call(
    "tm.library.list",
    { projectId, offset: 0, limit: 100 },
  );
  assert(
    libraryAfterProviderFailure.items.find((item) => item.id === library.id)
      ?.revision === currentLibrary.revision,
    "invalid provider annotations must not advance the TM library revision",
  );

  const createdBeforeMs = Date.now() + 60_000;
  const run = await processHandle.call("curation.run", {
    projectId,
    libraryId: library.id,
    expectedLibraryRevision: currentLibrary.revision,
    policy: {
      minimumChars: 2,
      minimumLengthRatioPercent: 20,
      maximumLengthRatioPercent: 500,
      nearDuplicateThreshold: 80,
      semanticAlignmentThresholdBasisPoints: 3_500,
      quarantineThresholdBasisPoints: 5_000,
      minimumTermFrequency: 2,
      createdAfterMs: 100,
      createdBeforeMs,
    },
    actor: "engine-smoke",
    reason: "Analyze the deterministic dirty TM fixture",
    correlationId: "engine-smoke-curation-offline",
    offset: 0,
    limit: 3,
  });
  assert(
    run.run.mode === "offline" &&
      run.run.status === "open" &&
      run.total === 12 &&
      run.units.length === 3,
    "offline curation should create an immutable bounded run snapshot",
  );
  const fullRun = await processHandle.call("curation.run.get", {
    runId: run.run.id,
    offset: 0,
    limit: 500,
  });
  const findings = await processHandle.call("curation.finding.list", {
    runId: run.run.id,
    offset: 0,
    limit: 500,
  });
  const findingKinds = new Set(findings.items.map((finding) => finding.kind));
  assert(
    [
      "exactDuplicate",
      "competingTranslation",
      "sourceEqualsTarget",
      "minimumLength",
      "lengthRatio",
      "numberMismatch",
      "placeholderMismatch",
      "createdOutsideRange",
    ].every((kind) => findingKinds.has(kind)),
    "curation should detect every deterministic dirty-fixture rule family",
  );
  assert(
    fullRun.run.summary.analysis.findingCount === findings.total &&
      fullRun.run.summary.analysis.driftGroupCount > 0 &&
      fullRun.run.summary.analysis.termCandidateCount > 0,
    "curation summary should retain findings, drift, and mined terms",
  );
  const firstFindingPage = await processHandle.call("curation.finding.list", {
    runId: run.run.id,
    offset: 0,
    limit: 2,
  });
  const secondFindingPage = await processHandle.call("curation.finding.list", {
    runId: run.run.id,
    offset: 2,
    limit: 2,
  });
  assert(
    firstFindingPage.total === findings.total &&
      firstFindingPage.items.length === 2 &&
      secondFindingPage.items.length === 2 &&
      firstFindingPage.items.every(
        (item) => !secondFindingPage.items.some((next) => next.id === item.id),
      ),
    "curation findings should page without duplicated IDs",
  );
  const qualityItem = curationCatalog.items.find(
    (item) => item.sourceText === "A stable legal sentence",
  );
  const qualityUnit = fullRun.units.find(
    (unit) => unit.unitId === qualityItem?.id,
  );
  assert(
    qualityUnit?.recommendedAction === "keep" &&
      qualityUnit.qualityScoreBasisPoints >= 5_000,
    "known high-quality fixture data should remain a keep recommendation",
  );
  const selectedFinding = findings.items.find(
    (finding) =>
      finding.kind === "sourceEqualsTarget" &&
      finding.disposition === "quarantine",
  );
  assert(
    selectedFinding,
    "source-equals-target should provide an explicit quarantine candidate",
  );

  await assertRpcError(
    () =>
      processHandle.call("curation.export", {
        runId: run.run.id,
        expectedRunRevision: run.run.revision + 1,
        expectedLibraryRevision: currentLibrary.revision,
        format: "jsonl",
        outputPath: stalePath,
      }),
    "conflict",
    "stale curation export",
  );
  assert(!existsSync(stalePath), "stale curation export must publish no file");
  await assertRpcError(
    () =>
      processHandle.call("curation.apply", {
        runId: run.run.id,
        expectedRunRevision: run.run.revision,
        expectedLibraryRevision: currentLibrary.revision + 1,
        selectedFindingIds: [selectedFinding.id],
        actor: "engine-smoke",
        reason: "Reject stale curation apply",
      }),
    "conflict",
    "stale curation apply",
  );
  const catalogAfterStale = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    offset: 0,
    limit: 500,
  });
  assert(
    catalogAfterStale.items.every(
      (item) =>
        item.curationState === "active" && item.qualityScoreBasisPoints == null,
    ),
    "stale curation requests must leave every TM projection unchanged",
  );

  const applied = await processHandle.call("curation.apply", {
    runId: run.run.id,
    expectedRunRevision: run.run.revision,
    expectedLibraryRevision: currentLibrary.revision,
    selectedFindingIds: [selectedFinding.id],
    actor: "engine-smoke",
    reason: "Quarantine one explicitly selected dirty TM unit",
    correlationId: "engine-smoke-curation-apply",
  });
  assert(
    applied.status === "applied" &&
      applied.changedUnitCount === 12 &&
      applied.quarantinedUnitCount === 1,
    "curation apply should score the snapshot and quarantine only the selection",
  );
  const appliedCatalog = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    offset: 0,
    limit: 500,
  });
  const quarantined = appliedCatalog.items.filter(
    (item) => item.curationState === "quarantined",
  );
  assert(
    quarantined.length === 1 &&
      quarantined[0].id === selectedFinding.unitId &&
      appliedCatalog.items.every(
        (item) => item.qualityScoreBasisPoints != null,
      ),
    "catalog should expose authoritative scores and only the selected quarantine",
  );

  const exported = await processHandle.call("curation.export", {
    runId: run.run.id,
    expectedRunRevision: applied.runRevision,
    expectedLibraryRevision: applied.libraryRevision,
    minimumScoreBasisPoints: 0,
    format: "jsonl",
    outputPath: jsonlPath,
  });
  const jsonlBytes = readFileSync(jsonlPath, "utf8");
  const jsonlRows = jsonlBytes
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert(
    exported.rowCount === 11 &&
      jsonlRows.length === exported.rowCount &&
      jsonlRows.every(
        (row) =>
          row.unitId &&
          row.instruction &&
          row.response &&
          Number.isInteger(row.qualityScoreBasisPoints),
      ) &&
      !jsonlRows.some((row) => row.unitId === selectedFinding.unitId),
    "JSONL export should contain active instruction/response rows with provenance",
  );
  await assertRpcError(
    () =>
      processHandle.call("curation.export", {
        runId: run.run.id,
        expectedRunRevision: applied.runRevision,
        expectedLibraryRevision: applied.libraryRevision,
        format: "jsonl",
        outputPath: jsonlPath,
      }),
    "export_error",
    "curation JSONL no-clobber",
  );
  assert(
    readFileSync(jsonlPath, "utf8") === jsonlBytes,
    "failed no-clobber export must preserve existing JSONL bytes",
  );
  writeFileSync(existingPath, "do not replace", "utf8");
  await assertRpcError(
    () =>
      processHandle.call("curation.export", {
        runId: run.run.id,
        expectedRunRevision: applied.runRevision,
        expectedLibraryRevision: applied.libraryRevision,
        format: "tsv",
        outputPath: existingPath,
      }),
    "export_error",
    "curation TSV no-clobber",
  );
  assert(
    readFileSync(existingPath, "utf8") === "do not replace",
    "failed TSV publication must preserve the destination sentinel",
  );

  return {
    runId: run.run.id,
    libraryId: library.id,
    selectedFindingId: selectedFinding.id,
    selectedUnitId: selectedFinding.unitId,
    applied,
    findingFingerprints: findings.items.map((finding) => finding.fingerprint),
    jsonlPath,
  };
}

async function verifyCurationAfterRestart(
  processHandle,
  dataDirectory,
  projectId,
  evidence,
) {
  const recovered = await processHandle.call("curation.run.get", {
    runId: evidence.runId,
    offset: 0,
    limit: 3,
  });
  assert(
    recovered.run.status === "applied" &&
      recovered.run.revision === evidence.applied.runRevision &&
      recovered.total === 12,
    "applied curation run should retain its snapshot after restart",
  );
  const recoveredFindings = await processHandle.call("curation.finding.list", {
    runId: evidence.runId,
    offset: 0,
    limit: 500,
  });
  assert(
    JSON.stringify(
      recoveredFindings.items.map((finding) => finding.fingerprint),
    ) === JSON.stringify(evidence.findingFingerprints),
    "curation findings should retain deterministic order through restart",
  );
  const appliedCatalog = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    offset: 0,
    limit: 500,
  });
  assert(
    appliedCatalog.items.find((item) => item.id === evidence.selectedUnitId)
      ?.curationState === "quarantined" &&
      appliedCatalog.items.every(
        (item) => item.qualityScoreBasisPoints != null,
      ),
    "curation scores and quarantine state should survive restart",
  );

  const tsvPath = join(dataDirectory, "curation-clean.tsv");
  const tsv = await processHandle.call("curation.export", {
    runId: evidence.runId,
    expectedRunRevision: recovered.run.revision,
    expectedLibraryRevision: evidence.applied.libraryRevision,
    minimumScoreBasisPoints: 0,
    format: "tsv",
    outputPath: tsvPath,
  });
  const tsvLines = readFileSync(tsvPath, "utf8").trim().split(/\r?\n/u);
  assert(
    tsv.rowCount === 11 &&
      tsvLines.length === tsv.rowCount + 1 &&
      tsvLines[0].startsWith("unit_id\tsource_locale\ttarget_locale"),
    "TSV export should validate a structured active-row dataset after restart",
  );

  const rollbackRequest = {
    runId: evidence.runId,
    expectedRunRevision: recovered.run.revision,
    expectedLibraryRevision: evidence.applied.libraryRevision,
    actor: "engine-smoke",
    reason: "Restore the curation fixture before image",
    correlationId: "engine-smoke-curation-rollback",
  };
  const rolledBack = await processHandle.call(
    "curation.rollback",
    rollbackRequest,
  );
  assert(
    rolledBack.status === "rolledBack" &&
      rolledBack.restoredUnitCount === 12 &&
      rolledBack.quarantinedUnitCount === 0,
    "curation rollback should restore every scored unit atomically",
  );
  const replay = await processHandle.call("curation.rollback", rollbackRequest);
  assert(
    replay.operationId === rolledBack.operationId &&
      replay.runRevision === rolledBack.runRevision &&
      replay.libraryRevision === rolledBack.libraryRevision,
    "curation rollback should be idempotent before another restart",
  );
  const restoredCatalog = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    offset: 0,
    limit: 500,
  });
  assert(
    restoredCatalog.items.length === 12 &&
      restoredCatalog.items.every(
        (item) =>
          item.curationState === "active" &&
          item.qualityScoreBasisPoints == null,
      ),
    "rollback should restore the original active and unscored TM projection",
  );
  const history = await processHandle.call("history.list", {
    projectId,
    offset: 0,
    limit: 500,
    descending: false,
  });
  assert(
    ["curation.apply", "curation.rollback"].every((kind) =>
      history.items.some((operation) => operation.kind === kind),
    ),
    "curation apply and rollback should remain in project operation history",
  );

  await processHandle.restart();
  await processHandle.call("engine.initialize", {
    protocolVersion: 1,
    client: { name: "engine-smoke", version: "0.1.0" },
  });
  const terminal = await processHandle.call("curation.run.get", {
    runId: evidence.runId,
    offset: 0,
    limit: 500,
  });
  const terminalCatalog = await processHandle.call("asset.catalog.list", {
    projectId,
    kind: "tm",
    domain: "curation-smoke",
    offset: 0,
    limit: 500,
  });
  const replayAfterRestart = await processHandle.call(
    "curation.rollback",
    rollbackRequest,
  );
  assert(
    terminal.run.status === "rolledBack" &&
      terminalCatalog.items.every(
        (item) =>
          item.curationState === "active" &&
          item.qualityScoreBasisPoints == null,
      ) &&
      replayAfterRestart.operationId === rolledBack.operationId,
    "rolled-back curation state and idempotency should survive another restart",
  );
  assert(
    statSync(evidence.jsonlPath).size > 0,
    "published curation dataset should remain readable after Engine restarts",
  );
}

async function exerciseDiscussionAndSnapshotWorkflow(
  processHandle,
  projectId,
  documentId,
) {
  const projectSnapshot = await processHandle.call("project.get", {
    projectId,
  });
  const segments = await processHandle.call("segment.list", {
    documentId,
    offset: 0,
    limit: 20,
  });
  const segment = segments.items[0];
  assert(segment, "discussion smoke requires one document segment");

  const scopes = [
    {
      scope: "project",
      title: "Project handoff",
      body: "Confirm the project handoff with @Owner.",
    },
    {
      scope: "document",
      documentId,
      title: "Document review",
      body: "Review this document with @Reviewer.",
    },
    {
      scope: "segment",
      documentId,
      segmentId: segment.id,
      title: "Segment terminology",
      body: "Check this segment with @Terminology.",
    },
  ];
  const threads = [];
  for (const scope of scopes) {
    threads.push(
      await processHandle.call("discussion.thread.create", {
        projectId,
        ...scope,
        actor: "engine-smoke",
        reason: `Create ${scope.scope} discussion`,
        expectedProjectRevision: projectSnapshot.project.revision,
      }),
    );
  }

  const segmentThread = threads[2];
  const segmentPage = await processHandle.call("discussion.thread.list", {
    projectId,
    scope: "segment",
    documentId,
    segmentId: segment.id,
    includeResolved: false,
    offset: 0,
    limit: 1,
  });
  assert(
    segmentPage.total === 1 && segmentPage.items[0].id === segmentThread.id,
    "segment discussion should be deterministically pageable",
  );
  const firstMessages = await processHandle.call("discussion.message.list", {
    threadId: segmentThread.id,
    includeDeleted: true,
    offset: 0,
    limit: 1,
  });
  assert(
    firstMessages.total === 1 &&
      firstMessages.items[0].ordinal === 0 &&
      firstMessages.items[0].mentions[0] === "@terminology",
    "discussion creation should retain stable ordinals and literal mentions",
  );
  await assertRpcError(
    () =>
      processHandle.call("discussion.message.create", {
        threadId: segmentThread.id,
        body: "Stale reply",
        actor: "engine-smoke",
        reason: "Prove stale discussion rejection",
        expectedThreadRevision: segmentThread.revision + 1,
      }),
    "conflict",
    "stale discussion reply",
  );
  const reply = await processHandle.call("discussion.message.create", {
    threadId: segmentThread.id,
    body: "Agreed with @Owner.",
    actor: "engine-smoke-reviewer",
    reason: "Answer segment discussion",
    expectedThreadRevision: segmentThread.revision,
  });
  const edited = await processHandle.call("discussion.message.update", {
    messageId: reply.id,
    body: "Agreed with @Owner and @Reviewer.",
    actor: "engine-smoke-reviewer",
    reason: "Clarify segment discussion answer",
    expectedRevision: reply.revision,
  });
  const deleted = await processHandle.call("discussion.message.delete", {
    messageId: edited.id,
    actor: "engine-smoke-reviewer",
    reason: "Retain an auditable tombstone",
    expectedRevision: edited.revision,
  });
  const tombstonePage = await processHandle.call("discussion.message.list", {
    threadId: segmentThread.id,
    includeDeleted: true,
    offset: 0,
    limit: 1,
  });
  const secondMessagePage = await processHandle.call(
    "discussion.message.list",
    {
      threadId: segmentThread.id,
      includeDeleted: true,
      offset: 1,
      limit: 1,
    },
  );
  assert(
    tombstonePage.total === 2 &&
      tombstonePage.items[0].ordinal === 0 &&
      secondMessagePage.items[0].ordinal === 1 &&
      secondMessagePage.items[0].deleted,
    "message paging should preserve ordinals and durable tombstones",
  );
  const resolved = await processHandle.call("discussion.thread.resolve", {
    threadId: segmentThread.id,
    resolved: true,
    expectedRevision: deleted.threadRevision,
    actor: "engine-smoke",
    reason: "Resolve segment discussion",
  });
  const hiddenResolved = await processHandle.call("discussion.thread.list", {
    projectId,
    scope: "segment",
    documentId,
    segmentId: segment.id,
    includeResolved: false,
    offset: 0,
    limit: 20,
  });
  assert(
    resolved.status === "resolved" && hiddenResolved.total === 0,
    "resolved discussion should leave the default open page",
  );
  const reopened = await processHandle.call("discussion.thread.resolve", {
    threadId: segmentThread.id,
    resolved: false,
    expectedRevision: resolved.revision,
    actor: "engine-smoke",
    reason: "Reopen segment discussion",
  });
  assert(reopened.status === "open", "discussion should reopen by revision");

  const beforeSnapshot = await processHandle.call("project.get", { projectId });
  const namedSnapshot = await processHandle.call("project.snapshot.create", {
    projectId,
    name: "Engine smoke checkpoint",
    expectedProjectRevision: beforeSnapshot.project.revision,
    actor: "engine-smoke",
    reason: "Capture discussion and project state",
  });
  assert(
    namedSnapshot.threadCount === 3 && namedSnapshot.stateHash.length === 64,
    "named snapshot should capture discussions and a SHA-256 state hash",
  );
  await assertRpcError(
    () =>
      processHandle.call("project.snapshot.create", {
        projectId,
        name: namedSnapshot.name,
        expectedProjectRevision: beforeSnapshot.project.revision,
        actor: "engine-smoke",
        reason: "Prove duplicate snapshot rejection",
      }),
    "invalid_state",
    "duplicate project snapshot name",
  );

  const stalePreview = await processHandle.call(
    "project.snapshot.previewRestore",
    {
      snapshotId: namedSnapshot.id,
      expectedProjectRevision: beforeSnapshot.project.revision,
    },
  );
  const changedProject = await processHandle.call("project.update", {
    projectId,
    name: `${beforeSnapshot.project.name} after snapshot`,
    sourceLocale: beforeSnapshot.project.sourceLocale,
    targetLocale: beforeSnapshot.project.targetLocale,
    domain: beforeSnapshot.project.domain,
    configuration: beforeSnapshot.project.configuration,
    expectedRevision: beforeSnapshot.project.revision,
    actor: "engine-smoke",
    correlationId: "engine-smoke-snapshot-stale",
  });
  await assertRpcError(
    () =>
      processHandle.call("project.snapshot.restore", {
        previewId: stalePreview.previewId,
        expectedProjectRevision: stalePreview.expectedProjectRevision,
        actor: "engine-smoke",
        reason: "Prove stale preview rejection",
      }),
    "conflict",
    "stale project snapshot preview",
  );

  const freshPreview = await processHandle.call(
    "project.snapshot.previewRestore",
    {
      snapshotId: namedSnapshot.id,
      expectedProjectRevision: changedProject.revision,
    },
  );
  assert(
    freshPreview.status === "open" &&
      freshPreview.missingDependencyIds.length === 0,
    "fresh snapshot preview should be open with available dependencies",
  );
  const restored = await processHandle.call("project.snapshot.restore", {
    previewId: freshPreview.previewId,
    expectedProjectRevision: freshPreview.expectedProjectRevision,
    actor: "engine-smoke",
    reason: "Restore named project state",
  });
  assert(
    restored.status === "applied" &&
      restored.projectRevision === changedProject.revision + 1 &&
      restored.operationId,
    "snapshot restore should increment the project once and append history",
  );
  await assertRpcError(
    () =>
      processHandle.call("project.snapshot.restore", {
        previewId: freshPreview.previewId,
        expectedProjectRevision: freshPreview.expectedProjectRevision,
        actor: "engine-smoke",
        reason: "Prove terminal preview rejection",
      }),
    "invalid_state",
    "terminal project snapshot preview",
  );

  await processHandle.restart();
  await processHandle.call("engine.initialize", {
    protocolVersion: 1,
    client: { name: "engine-smoke", version: "0.1.0" },
  });
  const recoveredThreads = await processHandle.call("discussion.thread.list", {
    projectId,
    includeResolved: true,
    offset: 0,
    limit: 20,
  });
  const recoveredMessages = await processHandle.call(
    "discussion.message.list",
    {
      threadId: segmentThread.id,
      includeDeleted: true,
      offset: 0,
      limit: 20,
    },
  );
  const recoveredSnapshots = await processHandle.call("project.snapshot.list", {
    projectId,
    offset: 0,
    limit: 20,
  });
  const recoveredSnapshot = await processHandle.call("project.snapshot.get", {
    snapshotId: namedSnapshot.id,
  });
  const history = await processHandle.call("history.list", {
    projectId,
    descending: false,
    offset: 0,
    limit: 500,
  });
  assert(
    recoveredThreads.total === 3 &&
      recoveredMessages.total === 2 &&
      recoveredMessages.items[1].deleted &&
      recoveredSnapshots.total === 1 &&
      recoveredSnapshot.stateHash === namedSnapshot.stateHash,
    "discussions, tombstones, and snapshots should survive Engine restart",
  );
  assert(
    history.items.some(
      (operation) => operation.kind === "project.snapshot.restore",
    ) &&
      history.items.some(
        (operation) => operation.kind === "discussion.thread.reopen",
      ),
    "discussion and snapshot mutations should remain in project history",
  );
}

async function exerciseAlignmentBeforeRestart(
  processHandle,
  dataDirectory,
  projectId,
) {
  const sourcePath = join(dataDirectory, "alignment-source.txt");
  const targetPath = join(dataDirectory, "alignment-target.txt");
  writeFileSync(
    sourcePath,
    "Invoice 2026 is due.\n\nPay within 30 days.\n",
    "utf8",
  );
  writeFileSync(
    targetPath,
    "2026 年发票已到期。\n\n请在 30 天内付款。\n",
    "utf8",
  );
  const sourceImport = await processHandle.call("document.import", {
    projectId,
    sourcePath,
    relativePath: "alignment/source.txt",
    filterId: "builtin.txt",
    options: { segmentationMode: "paragraph" },
  });
  const targetImport = await processHandle.call("document.import", {
    projectId,
    sourcePath: targetPath,
    relativePath: "alignment/target.txt",
    filterId: "builtin.txt",
    options: { segmentationMode: "paragraph" },
  });
  const sourceSegments = await processHandle.call("segment.list", {
    documentId: sourceImport.document.id,
    offset: 0,
    limit: 20,
  });
  const targetSegments = await processHandle.call("segment.list", {
    documentId: targetImport.document.id,
    offset: 0,
    limit: 20,
  });
  assert(
    sourceSegments.items.length === 2 && targetSegments.items.length === 2,
    "alignment fixtures should each contain two ordered paragraphs",
  );

  const projectSnapshot = await processHandle.call("project.get", {
    projectId,
  });
  const created = await processHandle.call("alignment.session.create", {
    projectId,
    sourceDocumentId: sourceImport.document.id,
    targetDocumentId: targetImport.document.id,
    expectedProjectRevision: projectSnapshot.project.revision,
    expectedSourceDocumentRevision: sourceImport.document.revision,
    expectedTargetDocumentRevision: targetImport.document.revision,
    actor: "engine-smoke",
    reason: "Create deterministic alignment smoke session",
    correlationId: "engine-smoke-alignment-create",
  });
  assert(
    created.linkCount > 0 && created.workUnits > 0,
    "alignment creation should return bounded deterministic candidates",
  );
  const initial = await processHandle.call("alignment.session.get", {
    sessionId: created.session.id,
    offset: 0,
    limit: 100,
  });
  assert(
    initial.total === initial.links.length && initial.links.length > 0,
    "alignment session should page every initial candidate",
  );

  const canonicalReplacement = sourceSegments.items.map((segment, index) => ({
    sourceSegmentIds: [segment.id],
    targetSegmentIds: [targetSegments.items[index].id],
  }));
  const canonical = await processHandle.call("alignment.session.update", {
    sessionId: initial.session.id,
    expectedSessionRevision: initial.session.revision,
    mutation: {
      kind: "replaceLinks",
      links: initial.links.map((link) => ({
        linkId: link.id,
        expectedRevision: link.revision,
      })),
      replacement: canonicalReplacement,
    },
    actor: "engine-smoke",
    reason: "Normalize the smoke partition into two reviewed links",
    correlationId: "engine-smoke-alignment-normalize",
  });
  assert(
    canonical.links.length === 2 &&
      canonical.links.every(
        (link) =>
          link.origin === "manual" &&
          link.sourceSegmentIds.length === 1 &&
          link.targetSegmentIds.length === 1,
      ),
    "manual replacement should produce two one-to-one proposed links",
  );

  const merged = await processHandle.call("alignment.session.update", {
    sessionId: canonical.session.id,
    expectedSessionRevision: canonical.session.revision,
    mutation: {
      kind: "replaceLinks",
      links: canonical.links.map((link) => ({
        linkId: link.id,
        expectedRevision: link.revision,
      })),
      replacement: [
        {
          sourceSegmentIds: sourceSegments.items.map((segment) => segment.id),
          targetSegmentIds: targetSegments.items.map((segment) => segment.id),
        },
      ],
    },
    actor: "engine-smoke",
    reason: "Exercise an ordered manual alignment merge",
    correlationId: "engine-smoke-alignment-merge",
  });
  assert(
    merged.links.length === 1 && merged.links[0].origin === "manual",
    "manual merge should replace the selected partition atomically",
  );
  await assertRpcError(
    () =>
      processHandle.call("alignment.session.update", {
        sessionId: merged.session.id,
        expectedSessionRevision: merged.session.revision,
        mutation: {
          kind: "setStatus",
          linkId: merged.links[0].id,
          expectedLinkRevision: merged.links[0].revision + 1,
          status: "confirmed",
        },
        actor: "engine-smoke",
        reason: "Prove a stale link revision cannot mutate alignment state",
      }),
    "conflict",
    "stale alignment edit",
  );
  const afterStale = await processHandle.call("alignment.session.get", {
    sessionId: merged.session.id,
    offset: 0,
    limit: 100,
  });
  assert(
    afterStale.session.revision === merged.session.revision &&
      afterStale.links.length === 1 &&
      afterStale.links[0].status === "proposed",
    "stale alignment edit should leave the session and link unchanged",
  );

  const split = await processHandle.call("alignment.session.update", {
    sessionId: afterStale.session.id,
    expectedSessionRevision: afterStale.session.revision,
    mutation: {
      kind: "replaceLinks",
      links: [
        {
          linkId: afterStale.links[0].id,
          expectedRevision: afterStale.links[0].revision,
        },
      ],
      replacement: canonicalReplacement,
    },
    actor: "engine-smoke",
    reason: "Split the reviewed smoke partition before restart",
    correlationId: "engine-smoke-alignment-split",
  });
  assert(
    split.links.length === 2 &&
      split.links.every((link) => link.status === "proposed"),
    "manual split should restore two proposed links",
  );
  return {
    sessionId: split.session.id,
    sessionRevision: split.session.revision,
    sourceDocumentId: sourceImport.document.id,
    targetDocumentId: targetImport.document.id,
    sourceSegmentIds: sourceSegments.items.map((segment) => segment.id),
    targetSegmentIds: targetSegments.items.map((segment) => segment.id),
    linkIds: split.links.map((link) => link.id),
  };
}

async function verifyAlignmentAfterRestart(processHandle, evidence) {
  const recovered = await processHandle.call("alignment.session.get", {
    sessionId: evidence.sessionId,
    offset: 0,
    limit: 100,
  });
  assert(
    recovered.session.status === "open" &&
      recovered.session.revision === evidence.sessionRevision &&
      JSON.stringify(recovered.links.map((link) => link.id)) ===
        JSON.stringify(evidence.linkIds),
    "manual alignment partition should persist unchanged through restart",
  );
  assert(
    JSON.stringify(recovered.links.flatMap((link) => link.sourceSegmentIds)) ===
      JSON.stringify(evidence.sourceSegmentIds) &&
      JSON.stringify(
        recovered.links.flatMap((link) => link.targetSegmentIds),
      ) === JSON.stringify(evidence.targetSegmentIds),
    "recovered alignment should retain ordered one-owner membership",
  );
  const sessions = await processHandle.call("alignment.session.list", {
    projectId: recovered.session.projectId,
    status: "open",
    offset: 0,
    limit: 50,
  });
  assert(
    sessions.items.some((session) => session.id === evidence.sessionId),
    "open alignment session should remain pageable after restart",
  );
}

async function exerciseAlignmentBeforeApplyRestart(
  processHandle,
  dataDirectory,
  projectId,
  alignmentEvidence,
  profileId,
) {
  const openSession = await processHandle.call("alignment.session.get", {
    sessionId: alignmentEvidence.sessionId,
    offset: 0,
    limit: 100,
  });
  const refinement = await processHandle.call("alignment.session.refine", {
    sessionId: openSession.session.id,
    expectedSessionRevision: openSession.session.revision,
    links: openSession.links.map((link) => ({
      linkId: link.id,
      expectedRevision: link.revision,
    })),
    profileId,
    maxAttempts: 1,
    actor: "engine-smoke",
    reason: "Exercise strict ID-only alignment refinement",
    correlationId: "engine-smoke-alignment-refine",
  });
  assert(
    refinement.action === "alignment_refinement",
    "alignment refinement should start as a typed AI run",
  );
  const completedRefinement = await waitForAiRun(processHandle, refinement.id);
  assert(
    completedRefinement.status === "succeeded",
    `alignment refinement should succeed, received ${completedRefinement.status}`,
  );
  const refined = await processHandle.call("alignment.session.get", {
    sessionId: alignmentEvidence.sessionId,
    offset: 0,
    limit: 100,
  });
  assert(
    refined.session.revision === openSession.session.revision + 1 &&
      refined.links.length === 1 &&
      refined.links[0].origin === "ai" &&
      refined.links[0].status === "proposed" &&
      refined.links[0].evidence.some((item) => item.kind === "aiRefinement"),
    "AI refinement should persist one proposed ID-only partition",
  );

  let confirmedState = refined;
  for (const link of refined.links) {
    confirmedState = await processHandle.call("alignment.session.update", {
      sessionId: confirmedState.session.id,
      expectedSessionRevision: confirmedState.session.revision,
      mutation: {
        kind: "setStatus",
        linkId: link.id,
        expectedLinkRevision: link.revision,
        status: "confirmed",
      },
      actor: "engine-smoke",
      reason: "Confirm the reviewed AI alignment suggestion",
      correlationId: "engine-smoke-alignment-confirm",
    });
  }
  const confirmedLinks = confirmedState.links.filter(
    (link) =>
      link.status === "confirmed" &&
      link.sourceText.trim() &&
      link.targetText.trim(),
  );
  assert(
    confirmedLinks.length === 1,
    "one non-empty bilingual alignment link should be explicitly confirmed",
  );

  const libraries = await processHandle.call("tm.library.list", {
    projectId,
    offset: 0,
    limit: 100,
  });
  const library = libraries.items.find((item) => item.writable);
  assert(library, "alignment apply should find a writable project TM");
  const applyRequest = {
    sessionId: confirmedState.session.id,
    libraryId: library.id,
    expectedSessionRevision: confirmedState.session.revision,
    expectedLibraryRevision: library.revision,
    links: confirmedLinks.map((link) => ({
      linkId: link.id,
      expectedRevision: link.revision,
    })),
    actor: "engine-smoke",
    reason: "Apply one explicitly confirmed alignment link",
    correlationId: "engine-smoke-alignment-apply",
  };
  await assertRpcError(
    () =>
      processHandle.call("alignment.session.apply", {
        ...applyRequest,
        expectedSessionRevision: applyRequest.expectedSessionRevision - 1,
      }),
    "conflict",
    "stale alignment apply",
  );
  const librariesAfterStale = await processHandle.call("tm.library.list", {
    projectId,
    offset: 0,
    limit: 100,
  });
  assert(
    librariesAfterStale.items.find((item) => item.id === library.id)
      ?.revision === library.revision,
    "stale alignment apply should not advance the TM library revision",
  );
  const applied = await processHandle.call(
    "alignment.session.apply",
    applyRequest,
  );
  assert(
    applied.status === "applied" &&
      applied.selectedCount === confirmedLinks.length &&
      applied.insertedCount + applied.duplicateCount ===
        applied.selectedCount &&
      applied.tmUnitIds.length === applied.insertedCount,
    "alignment apply should atomically return its terminal TM result",
  );

  const currentProject = await processHandle.call("project.get", {
    projectId,
  });
  const alignmentCorpus = await processHandle.call("corpus.fromAlignment", {
    projectId,
    expectedProjectRevision: currentProject.project.revision,
    sessionId: confirmedState.session.id,
    expectedSessionRevision: applied.sessionRevision,
    name: "Smoke alignment corpus",
    links: applyRequest.links,
    actor: "engine-smoke",
    reason: "Mount the confirmed alignment as a reference corpus",
    correlationId: "engine-smoke-corpus-alignment",
  });
  assert(
    alignmentCorpus.corpus.sourceKind === "alignment" &&
      alignmentCorpus.corpus.entryCount === confirmedLinks.length,
    "confirmed alignment should materialize as a provenance-bearing corpus",
  );

  const sourceCorpusPath = join(dataDirectory, "alignment-source-corpus.txt");
  const bilingualCorpusPath = join(
    dataDirectory,
    "alignment-bilingual-corpus.xlf",
  );
  const emptyCorpusPath = join(dataDirectory, "alignment-empty-corpus.txt");
  writeFileSync(
    sourceCorpusPath,
    "Invoice 2026 is due.\n\nPayment remains due in 30 days.\n",
    "utf8",
  );
  writeFileSync(
    bilingualCorpusPath,
    '<xliff version="2.1" srcLang="en-US" trgLang="zh-CN" xmlns="urn:oasis:names:tc:xliff:document:2.1"><file id="f"><unit id="u"><segment id="s"><source>Invoice 2026 is due.</source><target>2026 年发票已到期。</target></segment></unit></file></xliff>',
    "utf8",
  );
  writeFileSync(emptyCorpusPath, "", "utf8");

  const sourceProject = await processHandle.call("project.get", { projectId });
  const sourceCorpus = await processHandle.call("corpus.import", {
    projectId,
    expectedProjectRevision: sourceProject.project.revision,
    sourcePath: sourceCorpusPath,
    name: "Smoke source corpus",
    kind: "monolingualSource",
    sourceLocale: sourceProject.project.sourceLocale,
    targetLocale: sourceProject.project.targetLocale,
    filterId: "builtin.txt",
    options: { segmentationMode: "paragraph" },
    actor: "engine-smoke",
    reason: "Import a monolingual source reference corpus",
    correlationId: "engine-smoke-corpus-source",
  });
  assert(
    sourceCorpus.corpus.entryCount === 2 &&
      sourceCorpus.corpus.managedSourcePath &&
      sourceCorpus.corpus.inputSha256?.length === 64,
    "source corpus import should retain entries and managed-source metadata",
  );

  const bilingualProject = await processHandle.call("project.get", {
    projectId,
  });
  const bilingualCorpus = await processHandle.call("corpus.import", {
    projectId,
    expectedProjectRevision: bilingualProject.project.revision,
    sourcePath: bilingualCorpusPath,
    name: "Smoke bilingual corpus",
    kind: "bilingual",
    sourceLocale: bilingualProject.project.sourceLocale,
    targetLocale: bilingualProject.project.targetLocale,
    filterId: "builtin.xliff",
    options: {},
    actor: "engine-smoke",
    reason: "Import a bilingual XLIFF reference corpus",
    correlationId: "engine-smoke-corpus-bilingual",
  });
  assert(
    bilingualCorpus.corpus.entryCount === 1 &&
      bilingualCorpus.corpus.inputFilterId === "builtin.xliff",
    "bilingual corpus import should require an authoritative target",
  );

  const corpusCountBeforeInvalid = await processHandle.call("corpus.list", {
    projectId,
    status: "active",
    offset: 0,
    limit: 100,
  });
  const managedCountBeforeInvalid = countFiles(join(dataDirectory, "sources"));
  const invalidProject = await processHandle.call("project.get", { projectId });
  await assertRpcError(
    () =>
      processHandle.call("corpus.import", {
        projectId,
        expectedProjectRevision: invalidProject.project.revision,
        sourcePath: emptyCorpusPath,
        name: "Empty corpus should roll back",
        kind: "monolingualSource",
        sourceLocale: invalidProject.project.sourceLocale,
        targetLocale: invalidProject.project.targetLocale,
        filterId: "builtin.txt",
        options: {},
        actor: "engine-smoke",
        reason: "Prove empty corpus import cleanup",
      }),
    "unsupported_corpus_input",
    "empty corpus import",
  );
  const corpusCountAfterInvalid = await processHandle.call("corpus.list", {
    projectId,
    status: "active",
    offset: 0,
    limit: 100,
  });
  assert(
    corpusCountAfterInvalid.total === corpusCountBeforeInvalid.total &&
      countFiles(join(dataDirectory, "sources")) === managedCountBeforeInvalid,
    "failed corpus import should leave no row or managed-source residue",
  );

  const preRestartSearch = await processHandle.call("corpus.search", {
    projectId,
    query: "Invoice 2026",
    side: "both",
    corpusIds: [
      alignmentCorpus.corpus.id,
      sourceCorpus.corpus.id,
      bilingualCorpus.corpus.id,
    ],
    offset: 0,
    limit: 100,
  });
  assert(
    preRestartSearch.total >= 3 &&
      preRestartSearch.items.every(
        (hit) => hit.entry.structuralPath && hit.entry.provenance,
      ),
    "corpus search should return ranked file/path provenance before restart",
  );
  return {
    alignment: alignmentEvidence,
    applyRequest,
    applied,
    refinementRunId: refinement.id,
    alignmentCorpusId: alignmentCorpus.corpus.id,
    sourceCorpusId: sourceCorpus.corpus.id,
    bilingualCorpusId: bilingualCorpus.corpus.id,
    managedSourceFiles: [
      sourceCorpus.corpus.managedSourcePath,
      bilingualCorpus.corpus.managedSourcePath,
    ].map((path) => resolve(dataDirectory, path)),
    preRestartSearch: preRestartSearch.items.map(corpusHitProjection),
  };
}

async function verifyAlignmentAfterApplyRestart(
  processHandle,
  projectId,
  evidence,
) {
  const repeatedApply = await processHandle.call(
    "alignment.session.apply",
    evidence.applyRequest,
  );
  assert(
    repeatedApply.operationId === evidence.applied.operationId &&
      repeatedApply.sessionRevision === evidence.applied.sessionRevision &&
      repeatedApply.libraryRevision === evidence.applied.libraryRevision &&
      JSON.stringify(repeatedApply.tmUnitIds) ===
        JSON.stringify(evidence.applied.tmUnitIds),
    "identical alignment apply should return its terminal result after restart",
  );
  const terminal = await processHandle.call("alignment.session.get", {
    sessionId: evidence.alignment.sessionId,
    offset: 0,
    limit: 100,
  });
  assert(
    terminal.session.status === "applied" &&
      terminal.session.terminalResult?.operationId ===
        evidence.applied.operationId,
    "applied alignment session should retain its terminal result",
  );

  const activeCorpora = await processHandle.call("corpus.list", {
    projectId,
    status: "active",
    offset: 0,
    limit: 100,
  });
  const corpusIds = [
    evidence.alignmentCorpusId,
    evidence.sourceCorpusId,
    evidence.bilingualCorpusId,
  ];
  assert(
    corpusIds.every((id) =>
      activeCorpora.items.some((corpus) => corpus.id === id),
    ),
    "alignment and file corpora should remain active after restart",
  );
  const recoveredSearch = await processHandle.call("corpus.search", {
    projectId,
    query: "Invoice 2026",
    side: "both",
    corpusIds,
    offset: 0,
    limit: 100,
  });
  assert(
    JSON.stringify(recoveredSearch.items.map(corpusHitProjection)) ===
      JSON.stringify(evidence.preRestartSearch),
    "corpus ranking and provenance should be stable through restart",
  );
  const alignmentHit = recoveredSearch.items.find(
    (hit) => hit.corpus.id === evidence.alignmentCorpusId,
  );
  assert(
    alignmentHit?.entry.provenance?.alignmentSessionId ===
      evidence.alignment.sessionId,
    "alignment corpus search should expose its session provenance",
  );

  const sourceCorpus = activeCorpora.items.find(
    (corpus) => corpus.id === evidence.sourceCorpusId,
  );
  assert(sourceCorpus, "source corpus should be available for reindex");
  const sourceSearchBefore = await processHandle.call("corpus.search", {
    projectId,
    query: "Invoice 2026",
    side: "source",
    corpusIds: [sourceCorpus.id],
    offset: 0,
    limit: 100,
  });
  const reindexed = await processHandle.call("corpus.reindex", {
    corpusId: sourceCorpus.id,
    expectedRevision: sourceCorpus.revision,
    actor: "engine-smoke",
    reason: "Rebuild the source corpus index deterministically",
    correlationId: "engine-smoke-corpus-reindex",
  });
  const sourceSearchAfter = await processHandle.call("corpus.search", {
    projectId,
    query: "Invoice 2026",
    side: "source",
    corpusIds: [sourceCorpus.id],
    offset: 0,
    limit: 100,
  });
  assert(
    reindexed.corpus.revision === sourceCorpus.revision + 1 &&
      JSON.stringify(sourceSearchAfter.items.map(corpusHitProjection)) ===
        JSON.stringify(sourceSearchBefore.items.map(corpusHitProjection)),
    "corpus reindex should preserve the authoritative search projection",
  );
  await assertRpcError(
    () =>
      processHandle.call("corpus.reindex", {
        corpusId: sourceCorpus.id,
        expectedRevision: sourceCorpus.revision,
        actor: "engine-smoke",
        reason: "Prove stale corpus reindex rollback",
      }),
    "conflict",
    "stale corpus reindex",
  );
  const sourceSearchAfterStale = await processHandle.call("corpus.search", {
    projectId,
    query: "Invoice 2026",
    side: "source",
    corpusIds: [sourceCorpus.id],
    offset: 0,
    limit: 100,
  });
  assert(
    JSON.stringify(sourceSearchAfterStale.items.map(corpusHitProjection)) ===
      JSON.stringify(sourceSearchAfter.items.map(corpusHitProjection)),
    "stale corpus reindex should leave the rebuilt projection unchanged",
  );

  const bilingualSearch = await processHandle.call("corpus.search", {
    projectId,
    query: "发票已到期",
    side: "target",
    corpusIds: [evidence.bilingualCorpusId],
    offset: 0,
    limit: 100,
  });
  assert(
    bilingualSearch.total === 1 &&
      bilingualSearch.items[0].matchedSide === "target" &&
      bilingualSearch.items[0].entry.targetText,
    "bilingual corpus should search its authoritative target side",
  );
  const concordance = await processHandle.call("tm.concordance", {
    projectId,
    query: "Invoice 2026",
    side: "source",
    offset: 0,
    limit: 100,
  });
  assert(
    concordance.total >= 1 &&
      concordance.corpusTotal >= 3 &&
      concordance.corpusHits.some(
        (hit) => hit.corpus.id === evidence.alignmentCorpusId,
      ),
    "TM concordance should add authoritative corpus hits without replacing TM hits",
  );

  const sourceSegments = await processHandle.call("segment.list", {
    documentId: evidence.alignment.sourceDocumentId,
    offset: 0,
    limit: 20,
  });
  const groundingSegment = sourceSegments.items.find(
    (segment) => segment.id === evidence.alignment.sourceSegmentIds[0],
  );
  assert(groundingSegment, "alignment source segment should survive restart");
  const grounding = await processHandle.call("ai.grounding.preview", {
    projectId,
    segmentId: groundingSegment.id,
    expectedRevision: groundingSegment.revision,
    action: "translate",
    prompt: "Inspect corpus grounding for the alignment smoke",
    options: {
      ...defaultGroundingOptions(),
      includeCorpus: true,
      corpusTopN: 5,
    },
  });
  const corpusSection = grounding.bundle.sections.find(
    (section) => section.id === "corpus",
  );
  assert(
    corpusSection?.itemCount >= 1 &&
      corpusSection.text.includes(evidence.alignmentCorpusId),
    "AI grounding should include bounded visible corpus provenance",
  );

  const sourceTextBeforeRemove = groundingSegment.sourceText;
  for (const corpusId of corpusIds) {
    const current = await processHandle.call("corpus.list", {
      projectId,
      status: "active",
      offset: 0,
      limit: 100,
    });
    const corpus = current.items.find((item) => item.id === corpusId);
    assert(corpus, `active corpus ${corpusId} should be removable`);
    const removed = await processHandle.call("corpus.remove", {
      corpusId,
      expectedRevision: corpus.revision,
      actor: "engine-smoke",
      reason: "Remove the smoke corpus without mutating source assets",
      correlationId: `engine-smoke-corpus-remove-${corpusId}`,
    });
    assert(
      removed.corpus.status === "removed",
      "corpus removal should return a terminal removed record",
    );
  }
  const activeAfterRemove = await processHandle.call("corpus.list", {
    projectId,
    status: "active",
    offset: 0,
    limit: 100,
  });
  const searchAfterRemove = await processHandle.call("corpus.search", {
    projectId,
    query: "Invoice 2026",
    side: "both",
    corpusIds: [],
    offset: 0,
    limit: 100,
  });
  const concordanceAfterRemove = await processHandle.call("tm.concordance", {
    projectId,
    query: "Invoice 2026",
    side: "source",
    offset: 0,
    limit: 100,
  });
  const sourceSegmentsAfterRemove = await processHandle.call("segment.list", {
    documentId: evidence.alignment.sourceDocumentId,
    offset: 0,
    limit: 20,
  });
  assert(
    activeAfterRemove.total === 0 &&
      searchAfterRemove.total === 0 &&
      concordanceAfterRemove.corpusTotal === 0 &&
      concordanceAfterRemove.total === concordance.total &&
      sourceSegmentsAfterRemove.items[0].sourceText === sourceTextBeforeRemove,
    "corpus removal should isolate search while preserving TM and documents",
  );
  assert(
    evidence.managedSourceFiles.every((path) => existsSync(path)),
    "removed corpora should retain immutable managed sources until workspace cleanup",
  );
}

function corpusHitProjection(hit) {
  return [
    hit.corpus.id,
    hit.entry.id,
    hit.entry.ordinal,
    hit.entry.sourceText,
    hit.entry.targetText,
    hit.entry.structuralPath,
    JSON.stringify(hit.entry.provenance),
    hit.matchedSide,
    hit.matchKind,
  ];
}

async function exerciseInteropBeforeRestart(
  processHandle,
  dataDirectory,
  project,
) {
  const reviewSourcePath = join(dataDirectory, "interop-review-source.txt");
  const reviewOutputPath = join(dataDirectory, "interop-review.docx");
  const editedReviewPath = join(dataDirectory, "interop-review-edited.docx");
  const tamperedReviewPath = join(
    dataDirectory,
    "interop-review-tampered.docx",
  );
  const malformedReviewPath = join(
    dataDirectory,
    "interop-review-malformed.docx",
  );
  const bilingualXlsxPath = join(dataDirectory, "interop-table.xlsx");
  const bilingualDocxPath = join(dataDirectory, "interop-table.docx");
  const malformedTablePath = join(dataDirectory, "interop-table-formula.xlsx");
  const bilingualXlsxOutputPath = join(
    dataDirectory,
    "interop-table-export.xlsx",
  );
  const bilingualDocxOutputPath = join(
    dataDirectory,
    "interop-table-export.docx",
  );

  writeFileSync(
    reviewSourcePath,
    "Offline review source one.\n\nOffline review source two.",
    "utf8",
  );
  writeFileSync(bilingualXlsxPath, makeBilingualXlsx(), "binary");
  writeFileSync(bilingualDocxPath, makeBilingualDocx(), "binary");
  writeFileSync(malformedTablePath, makeBilingualXlsx(true), "binary");
  writeFileSync(malformedReviewPath, Buffer.from("not a DOCX package"));

  const reviewImport = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath: reviewSourcePath,
    filterId: "builtin.txt",
    options: {},
  });
  const reviewDocument = reviewImport.document;
  const reviewExport = await processHandle.call("interop.review.export", {
    projectId: project.id,
    documentId: reviewDocument.id,
    expectedDocumentRevision: reviewDocument.revision,
    outputPath: reviewOutputPath,
  });
  assert(
    reviewExport.rowCount === 2 && statSync(reviewOutputPath).size > 0,
    "review export should publish a deterministic DOCX",
  );
  const exportedBytes = readFileSync(reviewOutputPath);
  await assertRpcError(
    () =>
      processHandle.call("interop.review.export", {
        projectId: project.id,
        documentId: reviewDocument.id,
        expectedDocumentRevision: reviewDocument.revision,
        outputPath: reviewOutputPath,
      }),
    "export_error",
    "review export should not clobber an existing destination",
  );
  assert(
    Buffer.compare(exportedBytes, readFileSync(reviewOutputPath)) === 0,
    "review no-clobber failure should leave the destination unchanged",
  );

  rewriteReviewPackage(reviewOutputPath, editedReviewPath, {
    target: "Offline review target.",
    comments: "Please verify the legal tone.",
  });
  const editedPreview = await processHandle.call("interop.review.preview", {
    projectId: project.id,
    documentId: reviewDocument.id,
    inputPath: editedReviewPath,
    expectedDocumentRevision: reviewDocument.revision,
    offset: 0,
    limit: 100,
  });
  const changedReviewRows = editedPreview.rows.filter(
    (row) => row.disposition === "changed",
  );
  assert(
    editedPreview.total === 2 &&
      changedReviewRows.length === 1 &&
      editedPreview.rows.some((row) => row.disposition === "unchanged"),
    "edited review preview should classify changed and unchanged rows",
  );
  await assertRpcError(
    () =>
      processHandle.call("interop.review.preview", {
        projectId: project.id,
        documentId: reviewDocument.id,
        inputPath: editedReviewPath,
        expectedDocumentRevision: reviewDocument.revision + 1,
        offset: 0,
        limit: 100,
      }),
    "conflict",
    "review preview should reject a stale document revision",
  );

  rewriteReviewPackage(reviewOutputPath, tamperedReviewPath, {
    source: "Tampered immutable source.",
    target: "Offline review target.",
  });
  const tamperedPreview = await processHandle.call("interop.review.preview", {
    projectId: project.id,
    documentId: reviewDocument.id,
    inputPath: tamperedReviewPath,
    expectedDocumentRevision: reviewDocument.revision,
    offset: 0,
    limit: 100,
  });
  const invalidReviewRow = tamperedPreview.rows.find(
    (row) => row.disposition === "invalid",
  );
  assert(
    invalidReviewRow &&
      invalidReviewRow.diagnostics.some((diagnostic) =>
        diagnostic.toLocaleLowerCase().includes("source"),
      ),
    "source tamper should produce an invalid review row",
  );
  await assertRpcError(
    () =>
      processHandle.call("interop.review.apply", {
        previewId: tamperedPreview.previewId,
        expectedDocumentRevision: reviewDocument.revision,
        selectedRowIds: [invalidReviewRow.rowId],
        actor: "engine-smoke",
        reason: "Reject tampered source",
      }),
    "invalid_state",
    "tampered review rows should block apply",
  );

  const malformedTmpBefore = countFiles(join(dataDirectory, "tmp"));
  await assertRpcError(
    () =>
      processHandle.call("interop.review.preview", {
        projectId: project.id,
        documentId: reviewDocument.id,
        inputPath: malformedReviewPath,
        expectedDocumentRevision: reviewDocument.revision,
        offset: 0,
        limit: 100,
      }),
    "unsupported_document",
    "malformed review package should be rejected",
  );
  assert(
    countFiles(join(dataDirectory, "tmp")) === malformedTmpBefore,
    "malformed review package should clean its staging file",
  );

  const reviewApply = await processHandle.call("interop.review.apply", {
    previewId: editedPreview.previewId,
    expectedDocumentRevision: reviewDocument.revision,
    selectedRowIds: [changedReviewRows[0].rowId],
    actor: "engine-smoke",
    reason: "Apply offline review changes",
  });
  const reviewRetry = await processHandle.call("interop.review.apply", {
    previewId: editedPreview.previewId,
    expectedDocumentRevision: reviewDocument.revision,
    selectedRowIds: [changedReviewRows[0].rowId],
    actor: "engine-smoke",
    reason: "Retry offline review changes",
  });
  assert(
    reviewApply.status === "applied" &&
      reviewApply.appliedCount === 1 &&
      reviewApply.reviewIds.length === 1 &&
      JSON.stringify(reviewRetry) === JSON.stringify(reviewApply),
    "review apply should be atomic and idempotent",
  );

  const libraries = await processHandle.call("tm.library.list", {
    projectId: project.id,
    offset: 0,
    limit: 50,
  });
  const library = libraries.items.find((item) => item.writable);
  assert(library, "interop table smoke needs a writable TM library");
  const xlsxPreview = await processHandle.call("interop.table.preview", {
    projectId: project.id,
    libraryId: library.id,
    sourceLocale: library.sourceLocale,
    targetLocale: library.targetLocale,
    expectedLibraryRevision: library.revision,
    inputPath: bilingualXlsxPath,
    format: "xlsx",
    offset: 0,
    limit: 100,
  });
  assert(
    xlsxPreview.total === 2 &&
      xlsxPreview.rows.every((row) => row.disposition === "valid") &&
      xlsxPreview.rows[0].metadata.Context === "Legal",
    "XLSX table preview should expose valid rows and metadata",
  );
  const xlsxApply = await processHandle.call("interop.table.apply", {
    previewId: xlsxPreview.previewId,
    expectedLibraryRevision: library.revision,
    selectedRowIds: [xlsxPreview.rows[0].rowId],
    actor: "engine-smoke",
    reason: "Import XLSX bilingual row",
  });
  const xlsxRetry = await processHandle.call("interop.table.apply", {
    previewId: xlsxPreview.previewId,
    expectedLibraryRevision: library.revision,
    selectedRowIds: [xlsxPreview.rows[0].rowId],
    actor: "engine-smoke",
    reason: "Retry XLSX bilingual row",
  });
  assert(
    xlsxApply.tmUnitIds.length === 1 &&
      JSON.stringify(xlsxRetry) === JSON.stringify(xlsxApply),
    "XLSX table apply should be atomic and idempotent",
  );

  const bilingualXlsxImport = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath: bilingualXlsxPath,
    filterId: "builtin.bilingual-xlsx",
    options: {},
  });
  assert(
    bilingualXlsxImport.filterId === "builtin.bilingual-xlsx",
    "explicit bilingual XLSX mode should remain separate from builtin.xlsx",
  );
  await exportWithQaDecision(
    processHandle,
    project.id,
    bilingualXlsxImport.document.id,
    bilingualXlsxOutputPath,
    "Export bilingual XLSX smoke fixture",
  );

  const currentLibraryRevision = xlsxApply.currentRevision;
  const docxPreview = await processHandle.call("interop.table.preview", {
    projectId: project.id,
    libraryId: library.id,
    sourceLocale: library.sourceLocale,
    targetLocale: library.targetLocale,
    expectedLibraryRevision: currentLibraryRevision,
    inputPath: bilingualDocxPath,
    format: "docx",
    offset: 0,
    limit: 100,
  });
  assert(
    docxPreview.total === 2 &&
      docxPreview.rows.every((row) => row.disposition === "valid") &&
      docxPreview.rows[0].structuralPath.startsWith("bilingual-docx:"),
    "DOCX table preview should expose bounded structural paths",
  );
  const docxApply = await processHandle.call("interop.table.apply", {
    previewId: docxPreview.previewId,
    expectedLibraryRevision: currentLibraryRevision,
    selectedRowIds: [docxPreview.rows[1].rowId],
    actor: "engine-smoke",
    reason: "Import DOCX bilingual row",
  });
  assert(docxApply.tmUnitIds.length === 1, "DOCX table row should apply");
  const bilingualDocxImport = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath: bilingualDocxPath,
    filterId: "builtin.bilingual-docx",
    options: {},
  });
  assert(
    bilingualDocxImport.filterId === "builtin.bilingual-docx",
    "explicit bilingual DOCX mode should remain separate from builtin.docx",
  );
  await exportWithQaDecision(
    processHandle,
    project.id,
    bilingualDocxImport.document.id,
    bilingualDocxOutputPath,
    "Export bilingual DOCX smoke fixture",
  );

  const duplicatePreview = await processHandle.call("interop.table.preview", {
    projectId: project.id,
    libraryId: library.id,
    sourceLocale: library.sourceLocale,
    targetLocale: library.targetLocale,
    expectedLibraryRevision: docxApply.currentRevision,
    inputPath: bilingualXlsxPath,
    format: "xlsx",
    offset: 0,
    limit: 100,
  });
  assert(
    duplicatePreview.rows[0].disposition === "duplicate" &&
      duplicatePreview.rows[1].disposition === "valid",
    "table preview should detect persisted duplicates",
  );
  const malformedTableTmpBefore = countFiles(join(dataDirectory, "tmp"));
  await assertRpcError(
    () =>
      processHandle.call("interop.table.preview", {
        projectId: project.id,
        libraryId: library.id,
        sourceLocale: library.sourceLocale,
        targetLocale: library.targetLocale,
        expectedLibraryRevision: docxApply.currentRevision,
        inputPath: malformedTablePath,
        format: "xlsx",
        offset: 0,
        limit: 100,
      }),
    "unsupported_document",
    "formula table input should be rejected",
  );
  assert(
    countFiles(join(dataDirectory, "tmp")) === malformedTableTmpBefore,
    "rejected table input should clean its staging file",
  );

  return {
    reviewDocumentId: reviewDocument.id,
    reviewSegmentId: changedReviewRows[0].segmentId,
    reviewPreviewId: editedPreview.previewId,
    reviewExpectedRevision: reviewDocument.revision,
    reviewRowId: changedReviewRows[0].rowId,
    reviewIds: reviewApply.reviewIds,
    commentIds: reviewApply.commentIds,
    xlsxPreviewId: xlsxPreview.previewId,
    xlsxExpectedRevision: library.revision,
    xlsxRowId: xlsxPreview.rows[0].rowId,
    xlsxUnitId: xlsxApply.tmUnitIds[0],
    docxPreviewId: docxPreview.previewId,
    docxExpectedRevision: currentLibraryRevision,
    docxRowId: docxPreview.rows[1].rowId,
    docxUnitId: docxApply.tmUnitIds[0],
    libraryId: library.id,
    sourceLocale: library.sourceLocale,
    targetLocale: library.targetLocale,
    projectId: project.id,
  };
}

async function verifyInteropAfterRestart(processHandle, evidence) {
  const reviewPreview = await processHandle.call("interop.review.preview", {
    projectId: evidence.projectId,
    documentId: evidence.reviewDocumentId,
    previewId: evidence.reviewPreviewId,
    expectedDocumentRevision: evidence.reviewExpectedRevision,
    offset: 0,
    limit: 100,
  });
  assert(
    reviewPreview.status === "applied" &&
      reviewPreview.rows.some((row) => row.rowId === evidence.reviewRowId),
    "applied review preview should reopen after restart",
  );
  const reviewRetry = await processHandle.call("interop.review.apply", {
    previewId: evidence.reviewPreviewId,
    expectedDocumentRevision: evidence.reviewExpectedRevision,
    selectedRowIds: [evidence.reviewRowId],
    actor: "engine-smoke",
    reason: "Restart-safe review retry",
  });
  assert(
    reviewRetry.reviewIds.length === 1 &&
      reviewRetry.reviewIds[0] === evidence.reviewIds[0] &&
      reviewRetry.commentIds[0] === evidence.commentIds[0],
    "review retry after restart should return the terminal result",
  );
  const reviews = await processHandle.call("review.list", {
    documentId: evidence.reviewDocumentId,
    includeClosed: true,
  });
  assert(
    reviews.revisions.filter((revision) =>
      evidence.reviewIds.includes(revision.id),
    ).length === 1,
    "review apply should persist exactly one proposal",
  );
  const comments = await processHandle.call("segment.comment.list", {
    segmentId: evidence.reviewSegmentId,
    includeResolved: true,
  });
  assert(
    comments.comments.filter((comment) =>
      evidence.commentIds.includes(comment.id),
    ).length === 1,
    "review apply should persist exactly one comment",
  );

  const xlsxPreview = await processHandle.call("interop.table.preview", {
    projectId: evidence.projectId,
    libraryId: evidence.libraryId,
    sourceLocale: evidence.sourceLocale,
    targetLocale: evidence.targetLocale,
    expectedLibraryRevision: evidence.xlsxExpectedRevision,
    previewId: evidence.xlsxPreviewId,
    offset: 0,
    limit: 100,
  });
  const docxPreview = await processHandle.call("interop.table.preview", {
    projectId: evidence.projectId,
    libraryId: evidence.libraryId,
    sourceLocale: evidence.sourceLocale,
    targetLocale: evidence.targetLocale,
    expectedLibraryRevision: evidence.docxExpectedRevision,
    previewId: evidence.docxPreviewId,
    offset: 0,
    limit: 100,
  });
  assert(
    xlsxPreview.status === "applied" &&
      docxPreview.status === "applied" &&
      xlsxPreview.rows.some((row) => row.rowId === evidence.xlsxRowId) &&
      docxPreview.rows.some((row) => row.rowId === evidence.docxRowId),
    "applied table previews should reopen after restart",
  );
  const xlsxRetry = await processHandle.call("interop.table.apply", {
    previewId: evidence.xlsxPreviewId,
    expectedLibraryRevision: evidence.xlsxExpectedRevision,
    selectedRowIds: [evidence.xlsxRowId],
    actor: "engine-smoke",
    reason: "Restart-safe XLSX retry",
  });
  const docxRetry = await processHandle.call("interop.table.apply", {
    previewId: evidence.docxPreviewId,
    expectedLibraryRevision: evidence.docxExpectedRevision,
    selectedRowIds: [evidence.docxRowId],
    actor: "engine-smoke",
    reason: "Restart-safe DOCX retry",
  });
  assert(
    xlsxRetry.tmUnitIds[0] === evidence.xlsxUnitId &&
      docxRetry.tmUnitIds[0] === evidence.docxUnitId,
    "table retries after restart should not duplicate TM units",
  );
  const search = await processHandle.call("tm.search", {
    projectId: evidence.projectId,
    sourceLocale: evidence.sourceLocale,
    targetLocale: evidence.targetLocale,
    query: "InteropSheetAlpha",
    libraryIds: [evidence.libraryId],
    threshold: 100,
    offset: 0,
    limit: 20,
  });
  assert(
    search.matches.some((match) => match.unit.id === evidence.xlsxUnitId),
    "table provenance should survive restart and remain searchable",
  );
}

function countFiles(directory) {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory).length;
}

function rewriteReviewPackage(inputPath, outputPath, changes) {
  const entries = readZipEntries(readFileSync(inputPath));
  const documentEntry = entries.findIndex(
    ([name]) => name === "word/document.xml",
  );
  assert(documentEntry >= 0, "review package should contain word/document.xml");
  let xml = entries[documentEntry][1].toString("utf8");
  for (const [field, value] of Object.entries(changes)) {
    xml = replaceReviewBookmark(xml, field, value);
  }
  entries[documentEntry][1] = Buffer.from(xml, "utf8");
  writeFileSync(outputPath, makeZip(entries));
}

function replaceReviewBookmark(xml, field, value) {
  const pattern = new RegExp(
    `(<w:bookmarkStart\\b[^>]*w:name="[^"]+_${field}"[^>]*/>\\s*<w:r><w:t\\b[^>]*>)[\\s\\S]*?(</w:t></w:r>\\s*<w:bookmarkEnd\\b[^>]*/>)`,
    "u",
  );
  let replaced = false;
  const result = xml.replace(pattern, (_match, prefix, suffix) => {
    replaced = true;
    return `${prefix}${escapeXml(String(value))}${suffix}`;
  });
  assert(replaced, `review package should contain a ${field} bookmark`);
  return result;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function readZipEntries(buffer) {
  let end = -1;
  for (
    let index = buffer.length - 22;
    index >= Math.max(0, buffer.length - 65_557);
    index -= 1
  ) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  assert(end >= 0, "ZIP end-of-central-directory record is missing");
  const count = buffer.readUInt16LE(end + 10);
  let centralOffset = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert(
      buffer.readUInt32LE(centralOffset) === 0x02014b50,
      "ZIP central entry is invalid",
    );
    const compression = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");
    assert(
      buffer.readUInt32LE(localOffset) === 0x04034b50,
      "ZIP local entry is invalid",
    );
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      compression === 0
        ? Buffer.from(compressed)
        : compression === 8
          ? inflateRawSync(compressed)
          : (() => {
              throw new Error(
                `Unsupported ZIP compression method: ${compression}`,
              );
            })();
    assert(
      data.length === uncompressedSize,
      `ZIP entry size mismatch for ${name}`,
    );
    entries.push([name, data]);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function makeBilingualXlsx(formula = false) {
  const sheet = formula
    ? `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Source</t></is></c><c r="B1" t="inlineStr"><is><t>Target</t></is></c></row><row r="2"><c r="A2"><f>SUM(1,2)</f><v>3</v></c><c r="B2" t="inlineStr"><is><t>Three</t></is></c></row></sheetData></worksheet>`
    : `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Source</t></is></c><c r="B1" t="inlineStr"><is><t>Target</t></is></c><c r="C1" t="inlineStr"><is><t>Context</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>InteropSheetAlpha</t></is></c><c r="B2" t="inlineStr"><is><t>Alpha target</t></is></c><c r="C2" t="inlineStr"><is><t>Legal</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>InteropSheetBeta</t></is></c><c r="B3" t="inlineStr"><is><t>Beta target</t></is></c><c r="C3" t="inlineStr"><is><t>Memo</t></is></c></row></sheetData></worksheet>`;
  return makeZip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
}

function makeBilingualDocx() {
  const cell = (value) =>
    `<w:tc><w:p><w:r><w:t>${escapeXml(value)}</w:t></w:r></w:p></w:tc>`;
  const row = (values) => `<w:tr>${values.map(cell).join("")}</w:tr>`;
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${row(["Source", "Target", "Context"])}${row(["InteropDocxAlpha", "Alpha DOCX target", "Contract"])}${row(["InteropDocxBeta", "Beta DOCX target", "Memo"])}</w:tbl><w:sectPr/></w:body></w:document>`;
  return makeZip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    ["word/document.xml", document],
  ]);
}

async function exerciseLifecycleBeforeRestart(processHandle, dataDirectory) {
  const sourceQuery = "OrbitLifecycleAlpha";
  const targetQuery = "OrbitLifecycleTarget";
  const expectedTarget = `${targetQuery} retained translation.`;
  const inputDirectory = join(dataDirectory, "lifecycle-inputs");
  const alphaDirectory = join(inputDirectory, "alpha");
  const betaDirectory = join(inputDirectory, "beta");
  mkdirSync(alphaDirectory, { recursive: true });
  mkdirSync(betaDirectory, { recursive: true });
  const alphaPath = join(alphaDirectory, "lifecycle-alpha.txt");
  const betaPath = join(betaDirectory, "lifecycle-beta.txt");
  const unsupportedPath = join(betaDirectory, "unsupported.bin");
  const replacementPath = join(dataDirectory, "lifecycle-alpha-revised.txt");
  const archivePath = join(dataDirectory, "lifecycle-project.tlcat");
  const corruptArchivePath = join(dataDirectory, "lifecycle-corrupt.tlcat");
  writeFileSync(
    alphaPath,
    `${sourceQuery} stable source.\n\nOrbitLifecycleChange old source.\n\nOrbitLifecycleRemove old source.`,
    "utf8",
  );
  writeFileSync(
    betaPath,
    "OrbitLifecycleBeta source.\n\nOrbitLifecycleBeta detail.",
    "utf8",
  );
  writeFileSync(unsupportedPath, Buffer.from([0, 1, 2, 3]));
  writeFileSync(
    replacementPath,
    `${sourceQuery} stable source.\n\nOrbitLifecycleChange new source.\n\nOrbitLifecycleNew source.`,
    "utf8",
  );

  const createdTemplate = await processHandle.call("project.template.create", {
    name: "Lifecycle smoke template",
    description: "Initial lifecycle defaults",
    definition: {
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      domain: "legal",
      qaProfileId: "builtin.qa.cjk-professional",
      pipelineId: "missing.lifecycle.pipeline",
      analysisProfileId: "builtin.analysis.standard",
      reviewRequired: false,
    },
  });
  const updatedTemplate = await processHandle.call("project.template.update", {
    templateId: createdTemplate.id,
    expectedRevision: createdTemplate.revision,
    name: "Lifecycle smoke template",
    description: "Updated lifecycle defaults",
    definition: {
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      domain: "product",
      qaProfileId: "builtin.qa.cjk-professional",
      pipelineId: "missing.lifecycle.pipeline",
      analysisProfileId: "builtin.analysis.standard",
      reviewRequired: false,
    },
  });
  assert(
    updatedTemplate.revision === createdTemplate.revision + 1,
    "template update should create a new revision",
  );
  const firstTemplateRevision = await processHandle.call(
    "project.template.get",
    { templateId: createdTemplate.id, revision: createdTemplate.revision },
  );
  const currentTemplate = await processHandle.call("project.template.get", {
    templateId: createdTemplate.id,
  });
  assert(
    firstTemplateRevision.description === "Initial lifecycle defaults" &&
      currentTemplate.description === "Updated lifecycle defaults",
    "template get should expose historical and current revisions",
  );
  const templatePage = await processHandle.call("project.template.list", {
    offset: 0,
    limit: 100,
  });
  assert(
    templatePage.items.some(
      (item) =>
        item.id === createdTemplate.id &&
        item.revision === updatedTemplate.revision,
    ),
    "template list should return the latest revision",
  );

  const instantiated = await processHandle.call("project.createFromTemplate", {
    templateId: updatedTemplate.id,
    templateRevision: updatedTemplate.revision,
    name: "Lifecycle stdio project",
    dependencyRemaps: {},
  });
  assert(
    instantiated.project.domain === "product" &&
      instantiated.project.configuration.reviewRequired === false,
    "create-from-template should apply safe reusable configuration",
  );
  assert(
    instantiated.diagnostics.some(
      (diagnostic) =>
        diagnostic.kind === "pipeline" && diagnostic.status === "missing",
    ),
    "create-from-template should report a missing dependency",
  );
  await processHandle.call("project.template.delete", {
    templateId: updatedTemplate.id,
    expectedRevision: updatedTemplate.revision,
  });

  const batch = await processHandle.call("project.batchImport", {
    projectId: instantiated.project.id,
    items: [{ path: inputDirectory }],
    options: { segmentationMode: "paragraph" },
    atomicity: "bestEffort",
  });
  assert(
    batch.items.length === 3 && batch.succeeded === 2 && batch.failed === 1,
    "batch import should return every mixed diagnostic",
  );
  assert(
    batch.items.some(
      (item) =>
        item.relativePath === "alpha/lifecycle-alpha.txt" &&
        item.status === "succeeded",
    ) &&
      batch.items.some(
        (item) =>
          item.path.endsWith("unsupported.bin") && item.status === "failed",
      ),
    "batch import should preserve nested paths and unsupported-file failures",
  );
  const alphaDiagnostic = batch.items.find(
    (item) => item.relativePath === "alpha/lifecycle-alpha.txt",
  );
  assert(
    alphaDiagnostic?.document,
    "batch import should return the lifecycle alpha document",
  );
  const alphaDocument = alphaDiagnostic.document;
  const alphaSegments = await processHandle.call("segment.list", {
    documentId: alphaDocument.id,
    offset: 0,
    limit: 20,
  });
  assert(
    alphaSegments.items.length === 3,
    "lifecycle alpha fixture should contain three segments",
  );
  await processHandle.call("segment.updateTarget", {
    segmentId: alphaSegments.items[0].id,
    targetText: expectedTarget,
    expectedRevision: alphaSegments.items[0].revision,
  });

  const sourceSearch = await processHandle.call("search.global", {
    text: sourceQuery,
    projectId: instantiated.project.id,
    fields: ["source"],
    offset: 0,
    limit: 1,
  });
  const targetSearch = await processHandle.call("search.global", {
    text: targetQuery,
    projectId: instantiated.project.id,
    fields: ["target"],
    offset: 0,
    limit: 1,
  });
  assert(
    sourceSearch.total === 1 &&
      sourceSearch.items[0].field === "source" &&
      sourceSearch.items[0].snippet.includes("<mark>"),
    "global search should page and highlight source hits",
  );
  assert(
    targetSearch.total === 1 &&
      targetSearch.items[0].field === "target" &&
      targetSearch.items[0].segmentId === alphaSegments.items[0].id,
    "global search should return the authoritative target hit",
  );

  const preview = await processHandle.call("document.reimport.preview", {
    documentId: alphaDocument.id,
    sourcePath: replacementPath,
    expectedRevision: alphaDocument.revision,
    options: { segmentationMode: "paragraph" },
    actor: "engine-smoke",
  });
  assert(
    preview.plan.items.length ===
      preview.plan.unchanged +
        preview.plan.changed +
        preview.plan.newSegments +
        preview.plan.removed +
        preview.plan.ambiguous &&
      preview.plan.unchanged === 1 &&
      preview.plan.changed === 1 &&
      preview.plan.newSegments === 1 &&
      preview.plan.removed === 1 &&
      preview.plan.ambiguous === 0,
    "re-import preview should expose the authoritative reconciliation plan",
  );
  await assertRpcError(
    () =>
      processHandle.call("document.reimport.apply", {
        previewId: preview.previewId,
        expectedDocumentRevision: preview.expectedDocumentRevision + 1,
        actor: "engine-smoke",
      }),
    "conflict",
    "stale re-import apply",
  );
  const reimported = await processHandle.call("document.reimport.apply", {
    previewId: preview.previewId,
    expectedDocumentRevision: preview.expectedDocumentRevision,
    actor: "engine-smoke",
  });
  assert(
    reimported.currentVersion === alphaDocument.currentVersion + 1,
    "re-import apply should publish a new document version",
  );
  const reimportedSegments = await processHandle.call("segment.list", {
    documentId: alphaDocument.id,
    offset: 0,
    limit: 20,
  });
  assert(
    reimportedSegments.items[0].sourceText.includes(sourceQuery) &&
      reimportedSegments.items[0].targetText === expectedTarget,
    "re-import should preserve unchanged translated work",
  );

  const profiles = await processHandle.call("analysis.profile.list", {});
  const standardProfile = profiles.items.find(
    (profile) => profile.id === "builtin.analysis.standard",
  );
  assert(standardProfile, "standard analysis profile should be available");
  const analysis = await processHandle.call("analysis.run", {
    projectId: instantiated.project.id,
    profileId: standardProfile.id,
    profileRevision: standardProfile.revision,
  });
  const analysisRead = await processHandle.call("analysis.run.get", {
    runId: analysis.id,
  });
  assert(
    analysisRead.id === analysis.id &&
      analysisRead.summary.segments >= 5 &&
      analysisRead.summary.weightedEffortMilliUnits > 0 &&
      !analysisRead.stale,
    "analysis run/get should return a durable authoritative snapshot",
  );
  const analytics = await processHandle.call("project.analytics.get", {
    projectId: instantiated.project.id,
    trendBucketCount: 3,
  });
  assert(
    analytics.progress.totalSegments >= 5 &&
      analytics.documentProgress[alphaDocument.id]?.totalSegments === 3 &&
      typeof analytics.productivity.activeEditingMs.available === "boolean" &&
      analytics.trends.length === 3,
    "project analytics should expose progress, availability, and bounded trends",
  );
  const history = await processHandle.call("history.list", {
    projectId: instantiated.project.id,
    offset: 0,
    limit: 100,
    descending: false,
  });
  assert(
    history.items.some((operation) => operation.kind === "document.reimport"),
    "project history should include the re-import operation",
  );

  const exportedArchive = await processHandle.call("project.archive.export", {
    projectId: instantiated.project.id,
    destinationPath: archivePath,
    actor: "engine-smoke",
  });
  assert(
    exportedArchive.projectId === instantiated.project.id &&
      exportedArchive.archiveSha256.length === 64 &&
      statSync(archivePath).size > 0,
    "project archive export should publish a hashed archive",
  );
  await assertRpcError(
    () =>
      processHandle.call("project.archive.export", {
        projectId: instantiated.project.id,
        destinationPath: archivePath,
        actor: "engine-smoke",
      }),
    "invalid_state",
    "project archive no-clobber",
  );
  const corruptBytes = Buffer.from(readFileSync(archivePath));
  corruptBytes[Math.floor(corruptBytes.length / 2)] ^= 0x5a;
  writeFileSync(corruptArchivePath, corruptBytes);
  const projectsBeforeCorruptRestore = await processHandle.call(
    "project.list",
    { offset: 0, limit: 100 },
  );
  await assertRpcError(
    () =>
      processHandle.call("project.archive.restore", {
        archivePath: corruptArchivePath,
        dependencyRemaps: {},
        actor: "engine-smoke",
      }),
    "invalid_request",
    "corrupt project archive restore",
  );
  const projectsAfterCorruptRestore = await processHandle.call("project.list", {
    offset: 0,
    limit: 100,
  });
  assert(
    projectsAfterCorruptRestore.total === projectsBeforeCorruptRestore.total,
    "corrupt archive restore should not mutate project storage",
  );
  const restoredArchive = await processHandle.call("project.archive.restore", {
    archivePath,
    dependencyRemaps: {},
    actor: "engine-smoke",
  });
  assert(
    restoredArchive.projectId !== instantiated.project.id,
    "valid archive restore should create a new project identity",
  );
  const restoredSnapshot = await processHandle.call("project.get", {
    projectId: restoredArchive.projectId,
  });
  const restoredAlpha = restoredSnapshot.documents.find(
    (item) => item.relativePath === alphaDocument.relativePath,
  );
  assert(
    restoredAlpha && restoredAlpha.id !== alphaDocument.id,
    "archive restore should remap document identities",
  );
  const restoredSegments = await processHandle.call("segment.list", {
    documentId: restoredAlpha.id,
    offset: 0,
    limit: 20,
  });
  assert(
    restoredSegments.items[0].targetText === expectedTarget,
    "archive restore should preserve translated segment state",
  );

  const recycleEntry = await processHandle.call("recycle.delete", {
    entityType: "document",
    entityId: alphaDocument.id,
    expectedRevision: reimported.revision,
    actor: "engine-smoke",
    reason: "Exercise restart-safe document recycle",
  });
  const excludedSearch = await processHandle.call("search.global", {
    text: targetQuery,
    projectId: instantiated.project.id,
    fields: ["target"],
    offset: 0,
    limit: 20,
  });
  const recycledSearch = await processHandle.call("search.global", {
    text: targetQuery,
    projectId: instantiated.project.id,
    fields: ["target"],
    includeRecycled: true,
    offset: 0,
    limit: 20,
  });
  assert(
    excludedSearch.total === 0 && recycledSearch.total === 1,
    "normal search should exclude recycled documents while admin search can find them",
  );

  return {
    projectId: instantiated.project.id,
    templateId: updatedTemplate.id,
    documentId: alphaDocument.id,
    documentRelativePath: alphaDocument.relativePath,
    recycleEntryId: recycleEntry.id,
    analysisRunId: analysis.id,
    restoredProjectId: restoredArchive.projectId,
    sourceQuery,
    targetQuery,
    expectedTarget,
  };
}

async function verifyLifecycleAfterRestart(processHandle, evidence) {
  const recoveredProject = await processHandle.call("project.get", {
    projectId: evidence.projectId,
  });
  assert(
    recoveredProject.documents.every(
      (document) => document.id !== evidence.documentId,
    ),
    "recycled document should remain outside the active project after restart",
  );
  const templates = await processHandle.call("project.template.list", {
    offset: 0,
    limit: 100,
  });
  assert(
    templates.items.every((template) => template.id !== evidence.templateId),
    "deleted template should remain deleted after restart",
  );
  const recoveredAnalysis = await processHandle.call("analysis.run.get", {
    runId: evidence.analysisRunId,
  });
  assert(
    recoveredAnalysis.id === evidence.analysisRunId &&
      recoveredAnalysis.summary.segments >= 5,
    "analysis snapshot should remain readable after restart",
  );
  const recyclePage = await processHandle.call("recycle.list", {
    offset: 0,
    limit: 100,
  });
  assert(
    recyclePage.items.some((entry) => entry.id === evidence.recycleEntryId),
    "recycle entry should survive process restart",
  );
  const excludedSearch = await processHandle.call("search.global", {
    text: evidence.targetQuery,
    projectId: evidence.projectId,
    fields: ["target"],
    offset: 0,
    limit: 20,
  });
  const recycledSearch = await processHandle.call("search.global", {
    text: evidence.targetQuery,
    projectId: evidence.projectId,
    fields: ["target"],
    includeRecycled: true,
    offset: 0,
    limit: 20,
  });
  assert(
    excludedSearch.total === 0 && recycledSearch.total === 1,
    "search recycle filtering should survive process restart",
  );

  await processHandle.call("recycle.restore", {
    entryId: evidence.recycleEntryId,
    actor: "engine-smoke",
    reason: "Restore after process restart",
  });
  const restoredDocument = await processHandle.call("document.get", {
    documentId: evidence.documentId,
  });
  assert(
    restoredDocument.relativePath === evidence.documentRelativePath,
    "document restore should recover the original identity and relative path",
  );
  const restoredSegments = await processHandle.call("segment.list", {
    documentId: evidence.documentId,
    offset: 0,
    limit: 20,
  });
  assert(
    restoredSegments.items[0].targetText === evidence.expectedTarget,
    "document restore should preserve re-imported translated work",
  );
  const restoredSearch = await processHandle.call("search.global", {
    text: evidence.targetQuery,
    projectId: evidence.projectId,
    fields: ["target"],
    offset: 0,
    limit: 20,
  });
  assert(
    restoredSearch.total === 1,
    "restored document should return to normal search",
  );
  const analytics = await processHandle.call("project.analytics.get", {
    projectId: evidence.projectId,
    trendBucketCount: 3,
  });
  assert(
    analytics.progress.totalSegments >= 5 && analytics.trends.length === 3,
    "project analytics should remain authoritative after restart and restore",
  );
  const history = await processHandle.call("history.list", {
    projectId: evidence.projectId,
    offset: 0,
    limit: 100,
    descending: false,
  });
  assert(
    history.items.some((operation) => operation.kind === "recycle.delete") &&
      history.items.some((operation) => operation.kind === "recycle.restore"),
    "history should retain recycle and restore operations across restart",
  );

  const restoredArchiveProject = await processHandle.call("project.get", {
    projectId: evidence.restoredProjectId,
  });
  const restoredArchiveDocument = restoredArchiveProject.documents.find(
    (document) => document.relativePath === evidence.documentRelativePath,
  );
  assert(
    restoredArchiveDocument,
    "archive-restored project should remain readable after restart",
  );
  const restoredArchiveSegments = await processHandle.call("segment.list", {
    documentId: restoredArchiveDocument.id,
    offset: 0,
    limit: 20,
  });
  assert(
    restoredArchiveSegments.items[0].targetText === evidence.expectedTarget,
    "archive-restored document should preserve translated work after restart",
  );
  const archiveRecycleEntry = await processHandle.call("recycle.delete", {
    entityType: "project",
    entityId: evidence.restoredProjectId,
    expectedRevision: restoredArchiveProject.project.revision,
    actor: "engine-smoke",
    reason: "Exercise permanent purge of a versioned restored project",
  });
  const archivedProjectSearch = await processHandle.call("search.global", {
    text: evidence.targetQuery,
    projectId: evidence.restoredProjectId,
    fields: ["target"],
    offset: 0,
    limit: 20,
  });
  assert(
    archivedProjectSearch.total === 0,
    "recycled archive project should leave normal search",
  );
  await processHandle.call("recycle.purge", {
    entryId: archiveRecycleEntry.id,
    actor: "engine-smoke",
    reason: "Complete lifecycle purge acceptance",
  });
  await assertRpcError(
    () =>
      processHandle.call("project.get", {
        projectId: evidence.restoredProjectId,
      }),
    "not_found",
    "purged archive project lookup",
  );
  const recycleAfterPurge = await processHandle.call("recycle.list", {
    offset: 0,
    limit: 100,
  });
  assert(
    recycleAfterPurge.items.every(
      (entry) => entry.id !== archiveRecycleEntry.id,
    ),
    "purged project should leave the active recycle list",
  );
  const searchAfterPurge = await processHandle.call("search.global", {
    text: evidence.targetQuery,
    projectId: evidence.restoredProjectId,
    fields: ["target"],
    includeRecycled: true,
    offset: 0,
    limit: 20,
  });
  assert(
    searchAfterPurge.total === 0,
    "purged project should leave global search projections",
  );
}

async function exerciseTaskPackageWorkflow(owner, binary, ownerDataDirectory) {
  const recipientDataDirectory = mkdtempSync(
    join(tmpdir(), "translunar-task-recipient-"),
  );
  const transferDirectory = mkdtempSync(
    join(tmpdir(), "translunar-task-transfer-"),
  );
  const sourcePath = join(ownerDataDirectory, "task-package-source.txt");
  const assignmentPath = join(transferDirectory, "assignment.tltask");
  const tamperedPath = join(transferDirectory, "assignment-tampered.tltask");
  const returnPath = join(transferDirectory, "return.tltask");
  let recipient;
  try {
    writeFileSync(
      sourcePath,
      "One base row.\n\nTwo base row.\n\nThree base row.\n\nFour base row.\n\nFive base row.",
      "utf8",
    );
    const ownerProject = await owner.call("project.create", {
      name: "Offline task owner",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      domain: "offline-task-smoke",
    });
    const ownerDocument = await owner.call("document.import", {
      projectId: ownerProject.id,
      sourcePath,
      relativePath: "task-package/source.txt",
      filterId: "builtin.txt",
      options: { segmentationMode: "paragraph" },
    });
    const ownerSegments = await owner.call("segment.list", {
      documentId: ownerDocument.document.id,
      offset: 0,
      limit: 50,
    });
    assert(
      ownerSegments.items.length === 5,
      "task package fixture should have five rows",
    );
    const ownerSnapshot = await owner.call("project.get", {
      projectId: ownerProject.id,
    });
    const assignment = await owner.call("taskPackage.export", {
      kind: "assignment",
      projectId: ownerProject.id,
      expectedProjectRevision: ownerSnapshot.project.revision,
      documents: [
        {
          documentId: ownerDocument.document.id,
          segmentIds: ownerSegments.items.map((segment) => segment.id),
        },
      ],
      assetSlices: [],
      instructions: "Translate the bounded offline task.",
      destinationPath: assignmentPath,
      actor: "engine-smoke-owner",
      reason: "Create task package smoke assignment",
    });
    assert(
      assignment.kind === "assignment",
      "assignment package kind should be stable",
    );
    assert(
      existsSync(assignmentPath),
      "assignment package should be published",
    );
    await assertRpcError(
      () =>
        owner.call("taskPackage.export", {
          kind: "assignment",
          projectId: ownerProject.id,
          expectedProjectRevision: ownerSnapshot.project.revision,
          documents: [
            {
              documentId: ownerDocument.document.id,
              segmentIds: ownerSegments.items.map((segment) => segment.id),
            },
          ],
          destinationPath: assignmentPath,
          actor: "engine-smoke-owner",
          reason: "Reject destination overwrite",
        }),
      "invalid_state",
      "task package export should be no-clobber",
    );

    const assignmentEntries = readZipEntries(readFileSync(assignmentPath));
    const instructionsEntry = assignmentEntries.findIndex(
      ([name]) => name === "instructions.txt",
    );
    assert(instructionsEntry >= 0, "assignment should contain instructions");
    assignmentEntries[instructionsEntry][1] = Buffer.from(
      "tampered instructions",
      "utf8",
    );
    writeFileSync(tamperedPath, makeZip(assignmentEntries));

    recipient = await EngineProcess.start(binary, recipientDataDirectory);
    await recipient.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke-recipient", version: "0.1.0" },
    });
    await assertRpcError(
      () =>
        recipient.call("taskPackage.preview", {
          packagePath: tamperedPath,
          offset: 0,
          limit: 25,
          actor: "engine-smoke-recipient",
          reason: "Reject tampered task package",
        }),
      "invalid_request",
      "tampered task package preview",
    );
    const assignmentPreview = await recipient.call("taskPackage.preview", {
      packagePath: assignmentPath,
      offset: 0,
      limit: 25,
      actor: "engine-smoke-recipient",
      reason: "Preview valid task package",
    });
    assert(
      assignmentPreview.kind === "assignment" &&
        assignmentPreview.total === 5 &&
        assignmentPreview.rows.length === 5,
      "assignment preview should persist all selected rows",
    );
    const importedTask = await recipient.call("taskPackage.import", {
      previewId: assignmentPreview.previewId,
      projectName: "Offline recipient task",
      domain: "offline-task-smoke",
      actor: "engine-smoke-recipient",
      reason: "Import task package",
    });
    assert(
      importedTask.bindingCount === 5 && importedTask.documents.length === 1,
      "assignment import should create all origin bindings",
    );
    const importedAgain = await recipient.call("taskPackage.import", {
      previewId: assignmentPreview.previewId,
      projectName: "Offline recipient task",
      domain: "offline-task-smoke",
      actor: "engine-smoke-recipient",
      reason: "Retry task package import",
    });
    assert(
      importedAgain.project.id === importedTask.project.id,
      "assignment import should be idempotent before and after restart",
    );
    await recipient.restart();
    await recipient.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke-recipient", version: "0.1.0" },
    });
    const importedAfterRestart = await recipient.call("taskPackage.import", {
      previewId: assignmentPreview.previewId,
      projectName: "Offline recipient task",
      domain: "offline-task-smoke",
      actor: "engine-smoke-recipient",
      reason: "Retry task package import after restart",
    });
    assert(
      importedAfterRestart.project.id === importedTask.project.id,
      "assignment import should replay the durable result after restart",
    );

    let recipientSegments = await recipient.call("segment.list", {
      documentId: importedTask.documents[0].id,
      offset: 0,
      limit: 50,
    });
    const recipientEdit = async (index, targetText) => {
      const current = recipientSegments.items[index];
      const updated = await recipient.call("segment.updateTarget", {
        segmentId: current.id,
        targetText,
        expectedRevision: current.revision,
      });
      recipientSegments.items[index] = updated;
    };
    await recipientEdit(0, "Remote only");
    await recipientEdit(2, "Same change");
    await recipientEdit(3, "Second same change");
    const returnResult = await recipient.call("taskPackage.export", {
      kind: "return",
      workingProjectId: importedTask.project.id,
      parentPackageId: assignment.packageId,
      instructions: "Return the completed offline task.",
      destinationPath: returnPath,
      actor: "engine-smoke-recipient",
      reason: "Export task return",
    });
    assert(
      returnResult.kind === "return" && existsSync(returnPath),
      "return package should be published",
    );

    let ownerCurrent = await owner.call("segment.list", {
      documentId: ownerDocument.document.id,
      offset: 0,
      limit: 50,
    });
    const ownerEdit = async (index, targetText) => {
      const current = ownerCurrent.items[index];
      const updated = await owner.call("segment.updateTarget", {
        segmentId: current.id,
        targetText,
        expectedRevision: current.revision,
      });
      ownerCurrent.items[index] = updated;
    };
    await ownerEdit(1, "Local only");
    await ownerEdit(2, "Same change");
    await ownerEdit(3, "Second same change");
    const returnPreview = await owner.call("taskPackage.preview", {
      packagePath: returnPath,
      offset: 0,
      limit: 25,
      actor: "engine-smoke-owner",
      reason: "Preview task return",
    });
    const dispositionCounts = returnPreview.counts;
    assert(
      dispositionCounts.unchanged >= 1 &&
        dispositionCounts.remoteChanged >= 1 &&
        dispositionCounts.localChanged >= 1 &&
        dispositionCounts.bothChanged >= 1,
      "return preview should classify unchanged, remote-only, local-only, and both edits",
    );
    const safeRows = returnPreview.rows.filter(
      (row) => row.disposition === "bothChanged" && row.identicalChange,
    );
    const remoteRow = returnPreview.rows.find(
      (row) => row.disposition === "remoteChanged",
    );
    assert(
      safeRows.length === 2 && remoteRow,
      "return preview should expose selectable safe rows",
    );

    await ownerEdit(2, "Owner changed after preview");
    await assertRpcError(
      () =>
        owner.call("taskPackage.apply", {
          previewId: returnPreview.previewId,
          expectedProjectRevision: returnPreview.expectedProjectRevision,
          selectedRowIds: [safeRows[0].rowId],
          actor: "engine-smoke-owner",
          reason: "Reject stale task merge",
        }),
      "conflict",
      "stale task package apply",
    );
    const refreshedPreview = await owner.call("taskPackage.preview", {
      packagePath: returnPath,
      offset: 0,
      limit: 25,
      actor: "engine-smoke-owner",
      reason: "Retry task return preview",
    });
    const refreshedSafeRow = refreshedPreview.rows.find(
      (row) => row.disposition === "bothChanged" && row.identicalChange,
    );
    assert(
      refreshedSafeRow,
      "a safe identical row should remain retryable after stale apply",
    );
    const applyParams = {
      previewId: refreshedPreview.previewId,
      expectedProjectRevision: refreshedPreview.expectedProjectRevision,
      selectedRowIds: [refreshedSafeRow.rowId],
      actor: "engine-smoke-owner",
      reason: "Apply safe task merge",
    };
    const applied = await owner.call("taskPackage.apply", applyParams);
    assert(applied.appliedCount === 1, "safe task row should apply atomically");
    await owner.restart();
    await owner.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    const replay = await owner.call("taskPackage.apply", applyParams);
    assert(
      replay.operationId === applied.operationId &&
        replay.projectRevision === applied.projectRevision,
      "task package apply should replay the terminal result after restart",
    );
    const finalOwnerSegments = await owner.call("segment.list", {
      documentId: ownerDocument.document.id,
      offset: 0,
      limit: 50,
    });
    assert(
      finalOwnerSegments.items[2].targetText ===
        "Owner changed after preview" &&
        finalOwnerSegments.items[3].targetText === "Second same change",
      "task merge should preserve the stale local edit and apply the selected identical edit",
    );
  } finally {
    await recipient?.stop();
    await rm(recipientDataDirectory, { recursive: true, force: true });
    await rm(transferDirectory, { recursive: true, force: true });
  }
}

async function assertRpcError(call, expectedCode, label) {
  try {
    await call();
  } catch (error) {
    assert(
      error?.code === expectedCode,
      `${label} should return ${expectedCode}, received ${error?.code ?? "unknown"}`,
    );
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function exportWithQaDecision(
  processHandle,
  projectId,
  documentId,
  outputPath,
  reason,
) {
  const gate = await processHandle.call("qa.gate.check", {
    projectId,
    documentId,
  });
  return processHandle.call("document.export", {
    documentId,
    outputPath,
    ...(!gate.clear ? { qaOverride: { actor: "engine-smoke", reason } } : {}),
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function defaultGroundingOptions() {
  return {
    includeTerms: true,
    includeTm: true,
    includeCorpus: true,
    includeContext: true,
    includeStyle: true,
    tmTopN: 5,
    corpusTopN: 5,
    contextBefore: 2,
    contextAfter: 2,
    maxChars: 24000,
    systemInstruction: "",
    styleInstruction: "",
  };
}

async function waitForAiRun(processHandle, runId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const run = await processHandle.call("ai.run.get", { runId });
    if (["succeeded", "failed", "canceled"].includes(run.status)) return run;
    await delay(20);
  }
  throw new Error("AI run did not finish");
}

async function waitForAiBatch(processHandle, batchId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const batch = await processHandle.call("ai.batch.get", { batchId });
    if (
      ["succeeded", "completedWithErrors", "failed", "canceled"].includes(
        batch.status,
      )
    ) {
      return batch;
    }
    await delay(20);
  }
  throw new Error("AI batch did not finish");
}

async function startAiFixture() {
  let curationRequestCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      assert(
        !body.includes("engine-smoke-secret"),
        "AI credential must not appear in the request body",
      );
      const alignmentPayload = extractAlignmentFixturePayload(body);
      const curationPayload = extractCurationFixturePayload(body);
      if (curationPayload) curationRequestCount += 1;
      const completionChunks = alignmentPayload
        ? [
            JSON.stringify({
              links: [
                {
                  sourceSegmentIds: alignmentPayload.sourceSegments.map(
                    (segment) => segment.id,
                  ),
                  targetSegmentIds: alignmentPayload.targetSegments.map(
                    (segment) => segment.id,
                  ),
                  confidenceBasisPoints: 9_300,
                  evidence:
                    "The fixture preserves the ordered bilingual partition.",
                },
              ],
            }),
          ]
        : curationPayload
          ? [
              JSON.stringify(
                curationRequestCount === 2
                  ? {
                      annotations: [
                        {
                          unitId: "unknown-curation-unit",
                          scoreBasisPoints: 9_000,
                          label: "aligned",
                          evidence: "Unknown fixture identity.",
                        },
                      ],
                    }
                  : {
                      annotations: [
                        {
                          unitId: curationPayload[0].unitId,
                          scoreBasisPoints: 9_000,
                          label: "aligned",
                          evidence: "Fixture semantic review passed.",
                        },
                      ],
                    },
              ),
            ]
          : ["AI fixture ", "translation"];
      const events = [
        ...completionChunks.map(
          (content) =>
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        ),
        `data: ${JSON.stringify({
          choices: [],
          usage: {
            prompt_tokens: alignmentPayload ? 24 : curationPayload ? 32 : 20,
            completion_tokens: alignmentPayload ? 18 : curationPayload ? 10 : 4,
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n\n");
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "content-length": Buffer.byteLength(events),
        connection: "close",
      });
      response.end(events);
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("AI fixture address unavailable");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

function extractCurationFixturePayload(body) {
  let request;
  try {
    request = JSON.parse(body);
  } catch {
    return null;
  }
  const findMessage = (value) => {
    if (typeof value === "string") {
      return value.includes("<curation-data>") ? value : null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findMessage(item);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        const found = findMessage(item);
        if (found) return found;
      }
    }
    return null;
  };
  const message = findMessage(request);
  if (!message) return null;
  const match = message.match(
    /<curation-data>\s*([\s\S]*?)\s*<\/curation-data>/,
  );
  if (!match) return null;
  try {
    const payload = JSON.parse(match[1]);
    if (
      !Array.isArray(payload) ||
      payload.length === 0 ||
      payload.some((unit) => typeof unit?.unitId !== "string")
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function extractAlignmentFixturePayload(body) {
  let request;
  try {
    request = JSON.parse(body);
  } catch {
    return null;
  }
  const findMessage = (value) => {
    if (typeof value === "string") {
      return value.includes("<alignment-refinement-data>") ? value : null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findMessage(item);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        const found = findMessage(item);
        if (found) return found;
      }
    }
    return null;
  };
  const message = findMessage(request);
  if (!message) return null;
  const match = message.match(
    /<alignment-refinement-data>\s*([\s\S]*?)\s*<\/alignment-refinement-data>/,
  );
  if (!match) return null;
  try {
    const payload = JSON.parse(match[1]);
    if (
      !Array.isArray(payload.sourceSegments) ||
      !Array.isArray(payload.targetSegments) ||
      payload.sourceSegments.length === 0 ||
      payload.targetSegments.length === 0
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// The smoke fixture writer intentionally stores entries without compression;
// this keeps the process test self-contained and makes byte assertions clear.
function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localParts.push(local, data);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const officeXlsxContentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
const officeXlsxRootRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const officeXlsxWorkbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const officeXlsxWorkbookRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const officeXlsxSharedStrings = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Hello table</t></si><si><t>Repeated</t></si></sst>`;
const officeXlsxSheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Inline cell</t></is></c><c r="D1"><f>SUM(A1:B1)</f><v>3</v></c></row></sheetData></worksheet>`;
const officePptxContentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`;
const officePptxRootRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
const officePptxPresentation = `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`;
const officePptxPresentationRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`;
const officePptxSlide = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const officePptxSlideRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/></Relationships>`;
const officePptxDiagram = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt><dgm:txBody><a:p><a:r><a:t>SmartArt text</a:t></a:r></a:p></dgm:txBody></dgm:pt></dgm:ptLst></dgm:dataModel>`;

class EngineProcess {
  #child;
  #nextId = 1;
  #buffer = "";
  #waiters = [];

  static async start(binaryPath, dataDir) {
    const processHandle = new EngineProcess(binaryPath, dataDir);
    await processHandle.#start();
    return processHandle;
  }

  constructor(binaryPath, dataDir) {
    this.binaryPath = binaryPath;
    this.dataDir = dataDir;
  }

  async #start() {
    this.#child = spawn(
      this.binaryPath,
      ["--data-dir", this.dataDir, "--protocol", "stdio"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          TRANSLUNAR_AI_TEST_MODE: "1",
          TRANSLUNAR_AI_TEST_CREDENTIAL: "engine-smoke-secret",
        },
      },
    );
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.#child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    this.#child.once("error", (error) => this.#fail(error));
    await new Promise((resolvePromise, rejectPromise) => {
      this.#child.once("spawn", resolvePromise);
      this.#child.once("error", rejectPromise);
    });
  }

  call(method, params) {
    const id = this.#nextId++;
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return new Promise((resolvePromise, rejectPromise) => {
      this.#waiters.push({
        id,
        method,
        resolve: resolvePromise,
        reject: rejectPromise,
      });
    });
  }

  async stop() {
    if (!this.#child) return;
    const child = this.#child;
    this.#child = null;
    child.stdin.end();
    await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill();
        resolvePromise();
      }, 1_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  async restart() {
    await this.stop();
    this.#buffer = "";
    this.#waiters = [];
    await this.#start();
  }

  #consume(chunk) {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const waiterIndex = this.#waiters.findIndex(
        (waiter) => waiter.id === response.id,
      );
      if (waiterIndex < 0) continue;
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      if (response.error) {
        const error = new Error(`${waiter.method}: ${response.error.message}`);
        error.code = response.error.code;
        error.data = response.error.data;
        waiter.reject(error);
      } else {
        waiter.resolve(response.result);
      }
    }
  }

  #fail(error) {
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await main();
