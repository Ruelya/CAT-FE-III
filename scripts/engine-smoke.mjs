import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

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
  const malformedXliffPath = join(dataDirectory, "malformed.xlf");
  const textOutputPath = join(dataDirectory, "translated.txt");
  const markdownOutputPath = join(dataDirectory, "translated.md");
  const htmlOutputPath = join(dataDirectory, "translated.html");
  const xliffOutputPath = join(dataDirectory, "translated.xlf");
  let processHandle;

  try {
    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
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
      assert(
        formatSegments.items.length === formatCase.expectedSegments,
        `${formatCase.filterId} should produce segments`,
      );
      await processHandle.call("segment.updateTarget", {
        segmentId: formatSegments.items[0].id,
        targetText: formatCase.targetText,
        expectedRevision: formatSegments.items[0].revision,
      });
      formatDocuments.push({
        documentId: formatImport.document.id,
        outputPath: formatCase.outputPath,
      });
    }
    writeFileSync(
      malformedXliffPath,
      '<xliff version="2.1"><file>',
      "utf8",
    );
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
    assert(filters.filters.length === 5, "all built-in filters should register");
    assert(
      [
        "builtin.docx",
        "builtin.html",
        "builtin.markdown",
        "builtin.txt",
        "builtin.xliff",
      ].every((id) => filters.filters.some((filter) => filter.id === id)),
      "filter catalog should contain every P0 text filter",
    );
    const documents = await processHandle.call("document.list", {
      projectId: project.id,
      offset: 0,
      limit: 50,
    });
    assert(documents.total === 6, "six logical documents should be listed");
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
    assert(confirmed.qaIssues.length === 1, "30/60 should create one QA issue");
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
      issues.issues.length === 2 &&
        issues.issues.every((issue) => issue.status === "resolved"),
      "QA issue should resolve",
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
    const health = await processHandle.call("data.checkHealth", {});
    assert(health.healthy, "valid workspace should pass health check");
    const backup = await processHandle.call("data.createBackup", {
      destinationPath: backupPath,
    });
    assert(
      backup.manifest.schemaVersion === 5,
      "backup should contain latest schema",
    );
    assert(
      existsSync(join(backupPath, "translunar.sqlite3")),
      "backup database should exist",
    );
    const exported = await processHandle.call("document.export", {
      documentId: document.id,
      outputPath,
    });
    assert(
      exported.translatedSegments === 2,
      "export should contain two translated segments",
    );
    const legacyExported = await processHandle.call("document.exportDocx", {
      documentId: legacyDocument.id,
      outputPath: legacyOutputPath,
    });
    assert(
      legacyExported.translatedSegments === 0,
      "legacy export should preserve an untranslated document",
    );
    assert(statSync(outputPath).size > 0, "export should be non-empty");
    assert(
      statSync(legacyOutputPath).size > 0,
      "legacy export should be non-empty",
    );
    for (const formatDocument of formatDocuments) {
      await processHandle.call("document.export", {
        documentId: formatDocument.documentId,
        outputPath: formatDocument.outputPath,
      });
      assert(
        statSync(formatDocument.outputPath).size > 0,
        "format export should be non-empty",
      );
    }
    const textOutput = readFileSync(textOutputPath, "utf8");
    assert(
      textOutput.includes("第一句。") &&
        textOutput.includes("Second sentence.") &&
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
    console.log(`Engine smoke passed: ${outputPath}; backup: ${backupPath}`);
  } finally {
    await processHandle?.stop();
    await rm(dataDirectory, { recursive: true, force: true });
    await rm(backupParent, { recursive: true, force: true });
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

class EngineProcess {
  #child;
  #nextId = 1;
  #buffer = "";
  #responses = [];
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
        const error = new Error(response.error.message);
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
