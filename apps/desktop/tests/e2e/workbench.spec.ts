import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { inflateRawSync } from "node:zlib";

import {
  _electron as electron,
  expect,
  test,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { Project, ProjectTemplate } from "@translunar/contracts";

import type { DesktopApi } from "../../src/shared/desktop-api.js";

type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;

interface ElectronHarness {
  application: ElectronApplication;
  page: Page;
  dataDirectory: string;
  exportPath: string;
  curationExportPath: string;
  archivePath: string;
  consoleErrors: string[];
}

interface HarnessOptions {
  source?: string;
  sourceFiles?: string[];
  sourceFolder?: string;
  replacementSource?: string;
  corpusInput?: string;
  interopExportPath?: string;
  curationExportPath?: string;
  interopReviewInput?: string;
  interopTableInput?: string;
  taskPackageInput?: string;
  taskPackageDestination?: string;
}

async function launchHarness(
  label: string,
  sourceOverride?: string | HarnessOptions,
): Promise<ElectronHarness> {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory = mkdtempSync(
    join(tmpdir(), `translunar-desktop-${label}-`),
  );
  const options: HarnessOptions =
    typeof sourceOverride === "string"
      ? { source: sourceOverride }
      : (sourceOverride ?? {});
  const exportPath =
    options.interopExportPath ?? join(dataDirectory, "translated.docx");
  const curationExportPath =
    options.curationExportPath ?? join(dataDirectory, "curation-clean.jsonl");
  const fixture =
    options.source ?? join(workspaceRoot, "fixtures", "docx", "m0-source.docx");
  const engine =
    process.env.TRANSLUNAR_ENGINE_PATH ??
    join(
      workspaceRoot,
      "target",
      "debug",
      process.platform === "win32"
        ? "translunar-engine.exe"
        : "translunar-engine",
    );
  const consoleErrors: string[] = [];
  const archivePath = join(dataDirectory, "project-archive.tlcat");
  const sourceDelimiter = process.platform === "win32" ? ";" : ":";
  const application = await electron.launch({
    args: [
      "--no-sandbox",
      "--user-data-dir=" + join(dataDirectory, "electron-user-data"),
      ".",
    ],
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      TRANSLUNAR_DATA_DIR: dataDirectory,
      TRANSLUNAR_ENGINE_PATH: engine,
      TRANSLUNAR_TEST_EXPORT_DOCX: exportPath,
      TRANSLUNAR_TEST_CURATION_EXPORT: curationExportPath,
      TRANSLUNAR_TEST_EXPORT_DIRECTORY: dataDirectory,
      TRANSLUNAR_TEST_SOURCE: options.replacementSource ?? fixture,
      TRANSLUNAR_TEST_SOURCE_FILES: (options.sourceFiles ?? [fixture]).join(
        sourceDelimiter,
      ),
      ...(options.sourceFolder
        ? { TRANSLUNAR_TEST_SOURCE_FOLDER: options.sourceFolder }
        : {}),
      ...(options.corpusInput
        ? { TRANSLUNAR_TEST_CORPUS_INPUT: options.corpusInput }
        : {}),
      TRANSLUNAR_TEST_PROJECT_ARCHIVE: archivePath,
      TRANSLUNAR_TEST_PROJECT_ARCHIVE_DESTINATION: archivePath,
      ...(options.interopReviewInput
        ? { TRANSLUNAR_TEST_REVIEW_INPUT: options.interopReviewInput }
        : {}),
      ...(options.interopTableInput
        ? { TRANSLUNAR_TEST_TABLE_INPUT: options.interopTableInput }
        : {}),
      ...(options.taskPackageInput
        ? { TRANSLUNAR_TEST_TASK_PACKAGE_INPUT: options.taskPackageInput }
        : {}),
      ...(options.taskPackageDestination
        ? {
            TRANSLUNAR_TEST_TASK_PACKAGE_DESTINATION:
              options.taskPackageDestination,
          }
        : {}),
      TRANSLUNAR_AI_TEST_MODE: "1",
      TRANSLUNAR_AI_TEST_CREDENTIAL: "desktop-ai-secret",
    },
  });
  const page = await application.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  return {
    application,
    page,
    dataDirectory,
    exportPath,
    curationExportPath,
    archivePath,
    consoleErrors,
  };
}

async function closeHarness(harness: ElectronHarness): Promise<void> {
  await harness.application.close();
  await rm(harness.dataDirectory, { recursive: true, force: true });
}

async function importFixture(
  page: Page,
  expectedName = "m0-source.docx",
  timeout = 10_000,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Continue translating" }),
  ).toBeVisible({ timeout });
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Add files" }).click();
  await expect(page.getByText(expectedName, { exact: true })).toBeVisible({
    timeout,
  });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("region", { name: "Translation segments" }),
  ).toBeVisible({ timeout });
}

async function resizeWindow(
  application: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await application.evaluate(
    ({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0]?.setSize(
        dimensions.width,
        dimensions.height,
      );
    },
    { width, height },
  );
}

async function waitForPanelMotion(page: Page): Promise<void> {
  await page.waitForTimeout(270);
}

async function openApplicationMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(
    page.getByRole("navigation", { name: "Application views" }),
  ).toBeVisible();
}

async function dropLocalFiles(
  page: Page,
  dropzoneSelector: string,
  paths: string[],
): Promise<void> {
  const inputSelector = 'input[data-e2e-drop-source="true"]';
  await page.evaluate(() => {
    document.querySelector('input[data-e2e-drop-source="true"]')?.remove();
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.dataset.e2eDropSource = "true";
    input.style.position = "fixed";
    input.style.inset = "0 auto auto 0";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.append(input);
  });
  await page.locator(inputSelector).setInputFiles(paths);
  await page.evaluate(
    ({ inputSelector, dropzoneSelector }) => {
      const input = document.querySelector<HTMLInputElement>(inputSelector);
      const dropzone = document.querySelector<HTMLElement>(dropzoneSelector);
      if (!input?.files || !dropzone) {
        throw new Error("E2E drop source or destination was not mounted.");
      }
      const dataTransfer = new DataTransfer();
      for (const file of input.files) dataTransfer.items.add(file);
      for (const type of ["dragenter", "dragover", "drop"] as const) {
        dropzone.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        );
      }
      input.remove();
    },
    { inputSelector, dropzoneSelector },
  );
}

async function captureResponsiveSurface(
  harness: ElectronHarness,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  for (const viewport of [
    { width: 1250, height: 744 },
    { width: 1680, height: 942 },
    { width: 1920, height: 1080 },
  ]) {
    await resizeWindow(harness.application, viewport.width, viewport.height);
    await harness.page.waitForTimeout(120);
    const overflow = await harness.page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      html:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      root:
        (document.querySelector<HTMLElement>("#root")?.scrollWidth ?? 0) -
        (document.querySelector<HTMLElement>("#root")?.clientWidth ?? 0),
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.html).toBeLessThanOrEqual(1);
    expect(overflow.root).toBeLessThanOrEqual(1);
    await harness.page.screenshot({
      path: testInfo.outputPath(
        `${label}-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
}

async function expectNamedControls(
  page: Page,
  selector: string,
): Promise<void> {
  const controls = page.locator(
    `${selector} button, ${selector} input, ${selector} textarea, ${selector} select`,
  );
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (await control.isVisible()) {
      await expect(control).toHaveAccessibleName(/\S/u);
    }
  }
}

function writeBilingualXlsxFixture(path: string): void {
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRelationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRelationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Source</t></is></c><c r="B1" t="inlineStr"><is><t>Target</t></is></c><c r="C1" t="inlineStr"><is><t>Context</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>DesktopInteropAlpha</t></is></c><c r="B2" t="inlineStr"><is><t>Desktop target alpha</t></is></c><c r="C2" t="inlineStr"><is><t>Legal</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>DesktopInteropBeta</t></is></c><c r="B3" t="inlineStr"><is><t>Desktop target beta</t></is></c><c r="C3" t="inlineStr"><is><t>Memo</t></is></c></row></sheetData></worksheet>`;
  writeFileSync(
    path,
    makeStoredZip([
      ["[Content_Types].xml", contentTypes],
      ["_rels/.rels", rootRelationships],
      ["xl/workbook.xml", workbook],
      ["xl/_rels/workbook.xml.rels", workbookRelationships],
      ["xl/worksheets/sheet1.xml", sheet],
    ]),
  );
}

function editReviewDocx(
  path: string,
  changes: Readonly<Record<"target" | "comments", string>>,
  rowIndex = 2,
): void {
  const entries = readZipEntries(readFileSync(path));
  const documentIndex = entries.findIndex(
    ([name]) => name === "word/document.xml",
  );
  if (documentIndex < 0) {
    throw new Error("Review package has no word/document.xml part.");
  }
  const documentEntry = entries[documentIndex];
  if (!documentEntry) {
    throw new Error("Review package document entry is unavailable.");
  }
  let document = documentEntry[1].toString("utf8");
  for (const [field, value] of Object.entries(changes)) {
    const pattern = new RegExp(
      `(<w:bookmarkStart\\b[^>]*w:name="[^"]+_${field}"[^>]*/>\\s*<w:r><w:t\\b[^>]*>)[\\s\\S]*?(</w:t></w:r>\\s*<w:bookmarkEnd\\b[^>]*/>)`,
      "gu",
    );
    let replaced = false;
    let occurrence = 0;
    document = document.replace(pattern, (_match, prefix, suffix) => {
      const currentOccurrence = occurrence;
      occurrence += 1;
      if (currentOccurrence !== rowIndex) return _match;
      replaced = true;
      return `${prefix}${escapeXml(value)}${suffix}`;
    });
    if (!replaced) {
      throw new Error(`Review package has no ${field} bookmark.`);
    }
  }
  entries[documentIndex] = [documentEntry[0], Buffer.from(document, "utf8")];
  writeFileSync(path, makeStoredZip(entries));
}

function readZipEntries(buffer: Buffer): Array<[string, Buffer]> {
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
  if (end < 0) throw new Error("ZIP end record is missing.");
  const count = buffer.readUInt16LE(end + 10);
  let centralOffset = buffer.readUInt32LE(end + 16);
  const entries: Array<[string, Buffer]> = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("ZIP central entry is invalid.");
    }
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
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("ZIP local entry is invalid.");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      compression === 0
        ? Buffer.from(compressed)
        : compression === 8
          ? inflateRawSync(compressed)
          : null;
    if (!data || data.length !== uncompressedSize) {
      throw new Error(`ZIP entry ${name} has unsupported or invalid data.`);
    }
    entries.push([name, data]);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function makeStoredZip(
  entries: ReadonlyArray<readonly [string, string | Buffer]>,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
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
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface AiFixture {
  url: string;
  readonly requestCount: number;
  close(): Promise<void>;
}

interface AlignmentFixturePayload {
  sourceSegments: Array<{ id: string }>;
  targetSegments: Array<{ id: string }>;
}

async function startAiFixture(): Promise<AiFixture> {
  let requestCount = 0;
  const server: Server = createServer((request, response) => {
    requestCount += 1;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      expect(body).not.toContain("desktop-ai-secret");
      const alignmentPayload = extractAlignmentFixturePayload(body);
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
        : ["Desktop fixture ", "translation"];
      const events = [
        ...completionChunks.map(
          (content) =>
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        ),
        `data: ${JSON.stringify({
          choices: [],
          usage: {
            prompt_tokens: alignmentPayload ? 24 : 20,
            completion_tokens: alignmentPayload ? 18 : 4,
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
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("AI fixture address is unavailable.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    get requestCount() {
      return requestCount;
    },
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) rejectPromise(error);
          else resolvePromise();
        });
      }),
  };
}

function extractAlignmentFixturePayload(
  body: string,
): AlignmentFixturePayload | null {
  let request: unknown;
  try {
    request = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  const message = findAlignmentFixtureMessage(request);
  const match = message?.match(
    /<alignment-refinement-data>\s*([\s\S]*?)\s*<\/alignment-refinement-data>/u,
  );
  if (!match?.[1]) return null;
  try {
    const payload = JSON.parse(match[1]) as {
      sourceSegments?: unknown;
      targetSegments?: unknown;
    };
    if (
      !isAlignmentFixtureSegments(payload.sourceSegments) ||
      !isAlignmentFixtureSegments(payload.targetSegments)
    ) {
      return null;
    }
    return {
      sourceSegments: payload.sourceSegments,
      targetSegments: payload.targetSegments,
    };
  } catch {
    return null;
  }
}

function findAlignmentFixtureMessage(value: unknown): string | null {
  if (typeof value === "string") {
    return value.includes("<alignment-refinement-data>") ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = findAlignmentFixtureMessage(item);
      if (message) return message;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const message = findAlignmentFixtureMessage(item);
      if (message) return message;
    }
  }
  return null;
}

function isAlignmentFixtureSegments(
  value: unknown,
): value is Array<{ id: string }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        (item as { id: string }).id.length > 0,
    )
  );
}

test("runs the local-first CAT workflow through Electron", async () => {
  const harness = await launchHarness("workflow");
  const { page, exportPath, consoleErrors } = harness;

  try {
    await importFixture(page);

    let firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 60 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saving");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await page.evaluate("window.translunar.restartEngine()");
    await page.reload();
    await expect(page.locator(".segment-row")).toHaveCount(3);
    firstTarget = page.locator(".segment-row").first().locator("textarea");
    await expect(firstTarget).toHaveValue("保留期为 60 天。");

    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
    });
    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    await expect(
      page.locator(".segment-row").nth(1).locator("textarea"),
    ).not.toBeFocused();
    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    await firstTarget.focus();
    await firstTarget.press("Control+Enter");
    await expect(page.locator(".segment-row").first()).toContainText("Issues");
    await expect(
      page.locator(".segment-row").nth(1).locator("textarea"),
    ).toBeFocused();

    await page.getByRole("tab", { name: /^QA/u }).click();
    const lengthIssue = page.locator(".qa-card", {
      hasText: "Target length",
    });
    await expect(lengthIssue).toHaveCount(1);
    await firstTarget.focus();
    await page.getByRole("tab", { name: /^Matches/u }).click();
    await expect(page.locator(".match-card")).toHaveCount(1);
    await expect(page.locator(".match-target")).toContainText(
      "保留期为 60 天。",
    );

    firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 30 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.locator(".segment-row").first()).toContainText("Issues");
    await page.getByRole("button", { name: "Run QA" }).click();
    await expect(page.locator(".qa-card").first()).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator(".toast")).toContainText("QA");
    expect(existsSync(exportPath)).toBe(false);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("curates translation assets through Project Insights with the real Engine", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(180_000);
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-asset-curation-ui-"),
  );
  const sourcePath = join(fixtureDirectory, "curation-source.txt");
  const seedPath = join(fixtureDirectory, "curation-seed.csv");
  const revisionSeedPath = join(fixtureDirectory, "curation-revision.csv");
  const curationExportPath = join(fixtureDirectory, "curation-clean.jsonl");
  writeFileSync(
    sourcePath,
    "Curation source document.\n\nA stable source segment.",
    "utf8",
  );
  writeFileSync(
    seedPath,
    [
      "source,target,sourceLocale,targetLocale,domain,author,createdAtMs",
      "Duplicate source,Duplicate target,en-US,zh-CN,Curation,desktop-e2e,100",
      "Duplicate source,Duplicate target,en-US,zh-CN,Curation,desktop-e2e,110",
      "Source equals target,Source equals target,en-US,zh-CN,Curation,desktop-e2e,120",
      "Number 30 days,数字 31 天,en-US,zh-CN,Curation,desktop-e2e,130",
      "Long source phrase that should be translated,短,en-US,zh-CN,Curation,desktop-e2e,140",
      "Wrong language target,This target is still English,en-US,zh-CN,Curation,desktop-e2e,150",
      "Payment terms are due in 30 days,付款条款将在 30 天内到期,en-US,zh-CN,Curation,desktop-e2e,160",
      "Payment terms are due in 30 days,付款条款于 30 天内到期,en-US,zh-CN,Curation,desktop-e2e,170",
      "Good source sentence,良好的源句,en-US,zh-CN,Curation,desktop-e2e,180",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    revisionSeedPath,
    [
      "source,target,sourceLocale,targetLocale,domain,author,createdAtMs",
      "Revision-only source,仅用于修订的句子,en-US,zh-CN,Curation,desktop-e2e,190",
    ].join("\n"),
    "utf8",
  );

  let harness: ElectronHarness | null = null;
  try {
    harness = await launchHarness("asset-curation", {
      source: sourcePath,
      curationExportPath,
    });
    const { page, consoleErrors } = harness;
    await importFixture(page, "curation-source.txt");

    const ids = await page.evaluate(
      async ({ seedPath }) => {
        const api = (window as unknown as { translunar: DesktopApi })
          .translunar;
        const projects = await api.invoke("project.list", {
          lifecycle: "active",
          offset: 0,
          limit: 20,
        });
        const project = projects.items.find(
          (item: Project) => item.name === "Craft Contracts 2026",
        );
        if (!project) throw new Error("curation project was not created");
        const library = await api.invoke("tm.library.create", {
          name: "Desktop curation fixture",
          ownerProjectId: project.id,
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
          domain: "Curation",
          writable: true,
        });
        await api.invoke("tm.library.mount", {
          projectId: project.id,
          libraryId: library.id,
          mode: "write",
          priority: 1,
          enabled: true,
        });
        await api.invoke("tm.import", {
          libraryId: library.id,
          sourcePath: seedPath,
          format: "csv",
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
        });
        return { projectId: project.id, libraryId: library.id };
      },
      { seedPath },
    );

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await expect(
      page.getByRole("heading", { name: "Project insights" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Assets" }).click();

    const catalogSection = page.locator(".asset-curation-catalog-section");
    const runSection = page.locator(".asset-curation-run-section");
    const findingsSection = page.locator(".asset-curation-findings-section");
    await expect(
      page.getByRole("heading", { name: "Unified asset catalog" }),
    ).toBeVisible();
    await expect(catalogSection.locator("tbody tr").first()).toBeVisible();
    await expect(catalogSection).toContainText("Duplicate source");

    const query = catalogSection.getByLabel("Query");
    await query.fill("Duplicate source");
    await catalogSection.getByRole("button", { name: "Apply filters" }).click();
    await expect(catalogSection).toContainText("Duplicate source");
    expect(await catalogSection.locator("tbody tr").count()).toBeGreaterThan(0);
    await query.fill("");
    await catalogSection.getByRole("button", { name: "Apply filters" }).click();

    await runSection.getByLabel("TM library").selectOption(ids.libraryId);
    await expect(runSection.getByLabel("TM library")).toHaveValue(
      ids.libraryId,
    );
    await runSection.getByRole("button", { name: "Analyze library" }).click();
    await expect(page.locator(".asset-curation-status")).toHaveText("open", {
      timeout: 45_000,
    });
    await expect(
      page.getByRole("heading", { name: "Review and select changes" }),
    ).toBeVisible();
    await expect(findingsSection.locator("tbody tr").first()).toBeVisible();
    await expect(page.locator(".asset-curation-summary-section")).toContainText(
      "Analyzed",
    );

    await page.evaluate(
      async ({ libraryId, revisionSeedPath }) => {
        const api = (window as unknown as { translunar: DesktopApi })
          .translunar;
        const projectPage = await api.invoke("project.list", {
          lifecycle: "active",
          offset: 0,
          limit: 20,
        });
        const project = projectPage.items[0];
        if (!project) throw new Error("curation project disappeared");
        await api.invoke("tm.import", {
          libraryId,
          sourcePath: revisionSeedPath,
          format: "csv",
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
        });
      },
      { libraryId: ids.libraryId, revisionSeedPath },
    );

    await findingsSection
      .getByRole("button", { name: "Select visible" })
      .click();
    await page.getByRole("button", { name: "Apply selected" }).click();
    const applyDialog = page.getByRole("dialog", {
      name: "Apply curation selection",
    });
    await applyDialog.getByRole("button", { name: "Apply selection" }).click();
    await expect(page.locator(".asset-curation-stale")).toBeVisible({
      timeout: 20_000,
    });
    await applyDialog.getByRole("button", { name: "Close dialog" }).click();
    await page
      .locator(".asset-curation-stale")
      .getByRole("button", { name: "Reload authoritative state" })
      .click();
    await expect(page.locator(".asset-curation-notice")).toContainText(
      "refreshed from Engine",
    );

    await runSection.getByRole("button", { name: "Analyze library" }).click();
    await expect(page.locator(".asset-curation-status")).toHaveText("open", {
      timeout: 45_000,
    });
    await findingsSection
      .getByRole("button", { name: "Select visible" })
      .click();
    await page.getByRole("button", { name: "Apply selected" }).click();
    const secondApplyDialog = page.getByRole("dialog", {
      name: "Apply curation selection",
    });
    await secondApplyDialog
      .getByRole("button", { name: "Apply selection" })
      .click();
    await expect(page.locator(".asset-curation-status")).toHaveText("applied", {
      timeout: 45_000,
    });
    await expect(page.locator(".asset-curation-notice")).toContainText(
      "Applied curation",
    );

    await page.evaluate("window.translunar.restartEngine()");
    await page.getByRole("button", { name: "Refresh curation state" }).click();
    await expect(page.locator(".asset-curation-status")).toHaveText("applied");

    await page.getByLabel("Export format").selectOption("jsonl");
    await page.getByRole("button", { name: "Export clean dataset" }).click();
    await expect(page.locator(".asset-curation-export-status")).toContainText(
      "curation-clean.jsonl",
    );
    expect(existsSync(curationExportPath)).toBe(true);
    const exportedRows = readFileSync(curationExportPath, "utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as { instruction: string; response: string },
      );
    expect(exportedRows.length).toBeGreaterThan(0);
    expect(exportedRows.every((row) => row.instruction && row.response)).toBe(
      true,
    );

    await page.getByRole("button", { name: "Rollback run" }).click();
    const rollbackDialog = page.getByRole("dialog", {
      name: "Rollback curation run",
    });
    await rollbackDialog.getByRole("button", { name: "Rollback run" }).click();
    await expect(page.locator(".asset-curation-status")).toHaveText(
      "Rolled back",
      { timeout: 45_000 },
    );
    await page.evaluate("window.translunar.restartEngine()");
    await page.getByRole("button", { name: "Refresh curation state" }).click();
    await expect(page.locator(".asset-curation-status")).toHaveText(
      "Rolled back",
    );

    const restoredCatalog = await page.evaluate(async (projectId) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      return api.invoke("asset.catalog.list", {
        projectId,
        kind: "tm",
        offset: 0,
        limit: 100,
      });
    }, ids.projectId);
    expect(
      restoredCatalog.items.every(
        (item) => item.curationState !== "quarantined",
      ),
    ).toBe(true);

    await expectNamedControls(page, ".asset-curation-layout");
    await captureResponsiveSurface(harness, testInfo, "asset-curation");
    const headingOverlap = await page.evaluate(() => {
      const issues: string[] = [];
      document
        .querySelectorAll<HTMLElement>(".asset-curation-heading")
        .forEach((heading, index) => {
          const title = heading.querySelector("h2")?.getBoundingClientRect();
          const actions = heading
            .querySelector<HTMLElement>(".asset-curation-heading-actions")
            ?.getBoundingClientRect();
          if (
            title &&
            actions &&
            title.right > actions.left &&
            title.bottom > actions.top
          ) {
            issues.push(`heading-${index}`);
          }
        });
      return issues;
    });
    expect(headingOverlap).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    if (harness) await closeHarness(harness);
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("manages the offline Assistant and real workspace projections", async () => {
  const harness = await launchHarness("assistant-pages");
  const { application, page, exportPath, consoleErrors } = harness;

  try {
    await importFixture(page);
    await resizeWindow(application, 1250, 744);

    let firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 60 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await firstTarget.press("Control+Enter");
    await expect(page.locator(".segment-row").first()).toContainText("Issues");

    await page.getByRole("tab", { name: /Assistant/u }).click();
    await expect(page.getByLabel("Requested model")).toHaveValue("grok-4.5");
    await expect(page.getByLabel("Reasoning level")).toHaveValue("high");
    await expect(page.getByText("Offline preview")).toBeVisible();
    await expect(page.locator(".assistant-metric")).toHaveCount(7);
    const inputMetric = page.getByLabel("Synthetic input tokens: 1,438");
    const metricBox = await inputMetric.boundingBox();
    expect(metricBox).not.toBeNull();
    await page.mouse.move(1, 1);
    await page.mouse.move(
      (metricBox?.x ?? 0) + (metricBox?.width ?? 0) / 2,
      (metricBox?.y ?? 0) + (metricBox?.height ?? 0) / 2,
    );
    await expect
      .poll(() =>
        inputMetric.evaluate(
          (element) => getComputedStyle(element, "::after").opacity,
        ),
      )
      .toBe("1");

    const secondTarget = page
      .locator(".segment-row")
      .nth(1)
      .locator("textarea");
    const useInTarget = page.getByRole("button", { name: "Use in target" });
    await useInTarget.click();
    await expect(useInTarget).toContainText("Applied");
    await expect(secondTarget).not.toHaveValue("");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await secondTarget.fill("");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await page.getByLabel("Requested model").selectOption("local-preview");
    await page.getByLabel("Reasoning level").selectOption("low");
    await page.getByRole("button", { name: /Terminology and tone/u }).click();
    await page.getByRole("menuitem", { name: "New conversation" }).click();
    await expect(page.getByText("No messages", { exact: true })).toBeVisible();
    const composer = page.getByLabel("Ask about the active segment");
    await composer.fill("Shorten the target");
    await composer.press("Control+Enter");
    await expect(page.locator(".assistant-message")).toHaveCount(2);
    await expect(
      page.getByLabel("Offline model profile: local-preview"),
    ).toBeVisible();
    await page.getByRole("button", { name: /Shorten the target/u }).click();
    await page
      .getByRole("menuitemradio", {
        name: "Terminology and tone",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /Terminology and tone/u }).click();
    await page
      .getByRole("menuitem", { name: "Archive Shorten the target" })
      .click();
    await expect(page.locator(".conversation-row")).toHaveCount(2);

    const thirdTarget = page.locator(".segment-row").nth(2).locator("textarea");
    await thirdTarget.fill("临时草稿");
    await openApplicationMenu(page);
    await page.getByRole("button", { name: "QA review" }).click();
    await expect(
      page.getByRole("heading", { name: "QA and review" }),
    ).toBeVisible();
    const editProfileButton = page
      .getByLabel("QA controls")
      .getByRole("button", { name: "Edit profile" });
    await expect(editProfileButton).toBeEnabled();
    await editProfileButton.click();
    let profileDialog = page.locator(".profile-editor");
    await expect(profileDialog).toBeVisible();
    await profileDialog
      .locator("label", { hasText: "Name" })
      .locator("input")
      .fill("E2E QA profile");
    await profileDialog.getByRole("button", { name: "Clone profile" }).click();
    await expect(profileDialog).not.toBeVisible();
    await expect(page.getByLabel("Profile")).toContainText("E2E QA profile");

    await expect(editProfileButton).toBeEnabled();
    await editProfileButton.click();
    profileDialog = page.locator(".profile-editor");
    await expect(profileDialog).toBeVisible();
    await profileDialog.getByRole("button", { name: "Add rule" }).click();
    await profileDialog.getByLabel("Pattern").fill("临时草稿");
    await profileDialog
      .getByLabel("Message")
      .fill("Temporary draft marker remains");
    await profileDialog.getByRole("button", { name: "Save profile" }).click();
    await expect(profileDialog).not.toBeVisible();

    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("button", { name: "Run QA" }).click();
    await page.getByRole("button", { name: "Document", exact: true }).click();
    await page.getByRole("button", { name: "Run QA" }).click();
    await page.getByRole("button", { name: "HTML" }).click();
    await expect(page.getByText(/Saved HTML report/u)).toBeVisible();
    await page.getByRole("button", { name: "XLSX" }).click();
    await expect(page.getByText(/Saved XLSX report/u)).toBeVisible();
    const reportFiles = readdirSync(harness.dataDirectory).filter((name) =>
      name.startsWith("qa-"),
    );
    expect(reportFiles.some((name) => name.endsWith(".html"))).toBe(true);
    expect(reportFiles.some((name) => name.endsWith(".xlsx"))).toBe(true);
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `test-results/qa-review-${viewport.label}.png`,
      });
      const overflow = await page
        .locator(".qa-workspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await resizeWindow(application, 1250, 744);
    const mandatoryReview = page.getByLabel("Mandatory review");
    await mandatoryReview.click();
    await page.waitForTimeout(150);
    const reviewPolicyError =
      (await page.locator(".qa-banner").textContent()) ?? "";
    await expect(mandatoryReview, reviewPolicyError).not.toBeChecked();
    await expect(page.getByText(/Direct sign-off is enabled/u)).toBeVisible();
    await expect(page.locator(".qa-issue-row").first()).toBeVisible();
    await expect(
      page.getByText("Temporary draft marker remains"),
    ).toBeVisible();
    await expect(page.getByLabel("Review statistics and queue")).toBeVisible();
    await page.getByLabel("Disposition").selectOption("all");
    await page.getByLabel("Disposition").selectOption("open");
    await page
      .locator(".qa-issue-row", { hasText: "Temporary draft marker remains" })
      .click();
    await page.getByRole("button", { name: "Waive finding" }).click();
    const waiverDialog = page.getByRole("dialog", {
      name: "Waive this finding",
    });
    await waiverDialog.getByLabel("Actor").fill("E2E QA reviewer");
    await waiverDialog
      .getByLabel("Reason")
      .fill("Verified fixture-specific false positive");
    await waiverDialog.getByRole("button", { name: "Record waiver" }).click();
    await page.getByLabel("Disposition").selectOption("all");
    await page
      .locator(".qa-issue-row", { hasText: "Temporary draft marker remains" })
      .click();
    await expect(
      page.getByRole("button", { name: "Revoke waiver" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke waiver" }).click();
    await expect(
      page.getByRole("button", { name: "Waive finding" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/page-qa-review-1250x744.png" });
    await page.getByRole("button", { name: "Open segment" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(
      page.locator(".segment-row").nth(2).locator("textarea"),
    ).toBeFocused();
    await expect(
      page.locator(".segment-row").nth(2).locator("textarea"),
    ).toHaveValue("临时草稿");
    const firstRowForSignoff = page.locator(".segment-row").first();
    await firstRowForSignoff.locator("textarea").click();
    await firstRowForSignoff
      .getByRole("button", { name: "Open review panel" })
      .click();
    await page.getByRole("button", { name: "signed", exact: true }).click();
    const signoffDialog = page.getByRole("dialog", {
      name: "Sign off directly",
    });
    await signoffDialog.getByLabel("Actor").fill("E2E direct reviewer");
    await signoffDialog
      .getByLabel("Reason")
      .fill("Exercise explicit direct sign-off audit");
    await signoffDialog.getByRole("button", { name: "Sign off" }).click();
    await expect(firstRowForSignoff).toContainText("signed");
    await page
      .getByRole("button", { name: "translation", exact: true })
      .click();
    await page.getByRole("button", { name: "Close review panel" }).click();
    await page.locator(".segment-row").nth(2).locator("textarea").fill("");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Translation memory" }).click();
    await expect(
      page.getByRole("heading", { name: "Translation memory" }),
    ).toBeVisible();
    await expect(page.locator(".tm-entry")).toHaveCount(1);
    await page.screenshot({ path: "test-results/page-tm-1250x744.png" });
    await page.getByRole("button", { name: "Back to workbench" }).click();

    firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 30 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Run QA" }).click();

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Export review" }).click();
    await expect(
      page.getByRole("heading", { name: "Export review" }),
    ).toBeVisible();
    await expect(page.getByText("Publication blocked")).toBeVisible();
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `test-results/export-review-${viewport.label}.png`,
      });
      const overflow = await page
        .locator(".export-review-workspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await resizeWindow(application, 1250, 744);
    await page.screenshot({ path: "test-results/page-export-1250x744.png" });
    await page.getByLabel("Override the QA delivery gate").check();
    await page.getByLabel("Actor").fill("E2E delivery reviewer");
    await page
      .getByLabel("Reason")
      .fill(
        "Fixture intentionally leaves untranslated segments for round-trip coverage",
      );
    await page.getByRole("button", { name: "Export document" }).click();
    await expect(
      page.getByText(/Exported \d+ translated segments/u),
    ).toBeVisible();
    expect(statSync(exportPath).size).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("configures BYOK AI, streams a grounded run, applies its diff, and reports usage", async () => {
  const fixture = await startAiFixture();
  const harness = await launchHarness("live-ai");
  const { application, page, consoleErrors } = harness;

  try {
    await importFixture(page);
    await openApplicationMenu(page);
    await page.getByRole("button", { name: "AI control" }).click();
    await expect(
      page.getByRole("heading", { name: "AI control" }),
    ).toBeVisible();

    await page.getByLabel("Connector").selectOption("openaiCompatible");
    await page.getByLabel("Profile name").fill("Desktop fixture");
    await page.getByLabel("Base URL").fill(fixture.url);
    await page.getByLabel("Model").fill("fixture-model");
    await page.getByRole("button", { name: "Add provider" }).click();

    const profile = page.locator(".ai-profile-row", {
      hasText: "Desktop fixture",
    });
    await expect(profile).toBeVisible();
    await profile.getByRole("button", { name: "Edit Desktop fixture" }).click();
    const profileEdit = page.locator(".ai-profile-edit");
    await profileEdit.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Desktop fixture profile updated."),
    ).toBeVisible();
    await profile
      .getByRole("textbox", {
        name: "Credential for Desktop fixture",
        exact: true,
      })
      .fill("desktop-ai-secret");
    const storeCredential = profile.locator(".ai-credential-entry button");
    await expect(storeCredential).toBeEnabled();
    await storeCredential.click();
    await expect(profile).toContainText("Stored");

    await page.getByLabel("AI enabled").check();
    await page
      .getByLabel("Default profile")
      .selectOption({ label: "Desktop fixture" });
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByText("AI workspace policy saved.")).toBeVisible();
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/ai-control-${viewport.label}.png`,
      });
      const horizontalOverflow = await page
        .locator(".ai-control-surface")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(horizontalOverflow).toBeLessThanOrEqual(1);
    }
    await page.getByRole("button", { name: "Back to workbench" }).click();

    const targetRow = page.locator(".segment-row").nth(2);
    const target = targetRow.locator("textarea");
    await target.click();
    await targetRow
      .getByRole("button", { name: "Copy protected tags" })
      .click();
    await expect(
      targetRow.locator(".target-tag-strip .tag-capsule"),
    ).not.toHaveCount(0);
    await page.getByRole("tab", { name: /Assistant/u }).click();
    await expect(page.getByText("Engine connected")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByLabel("Requested model")).toContainText(
      "Desktop fixture",
    );
    await page.getByRole("button", { name: /Translate/u }).click();
    await expect(page.locator(".grounding-inspector")).toBeVisible();
    await expect(page.locator(".ai-diff-proposal")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".assistant-metric")).toHaveCount(7);
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/assistant-online-${viewport.label}.png`,
      });
      const transcriptOverflow = await page
        .locator(".assistant-transcript")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(transcriptOverflow).toBeLessThanOrEqual(1);
      if (viewport.width <= 1320) {
        const filterBox = await page.locator(".filter-group").boundingBox();
        const matchScopeBox = await page.locator(".match-scope").boundingBox();
        expect(filterBox).not.toBeNull();
        expect(matchScopeBox).not.toBeNull();
        expect(
          (filterBox?.x ?? 0) + (filterBox?.width ?? 0),
        ).toBeLessThanOrEqual((matchScopeBox?.x ?? 0) + 1);
      }
    }
    await page
      .locator(".ai-diff-proposal")
      .getByRole("button", { name: "Use in target" })
      .click();
    await expect(target).toHaveValue("Desktop fixture translation");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "AI control" }).click();
    await page.getByRole("tab", { name: /Usage/u }).click();
    await expect(page.locator(".usage-table")).toContainText(
      "openai_compatible",
    );
    await expect(page.locator(".usage-table")).toContainText("20");
    await page.getByRole("tab", { name: /Batch/u }).click();
    await page.getByLabel("Requests / minute").fill("600");
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.locator(".batch-meter")).toContainText(
      "completedWithErrors",
      { timeout: 15_000 },
    );
    await expect(page.locator(".batch-item-list")).toContainText(
      "tag_validation_failed",
    );
    expect(fixture.requestCount).toBe(3);
    await page.getByRole("tab", { name: /Providers/u }).click();
    await profile
      .getByRole("button", {
        name: "Delete credential for Desktop fixture",
      })
      .click();
    await expect(profile).toContainText("Missing");
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await fixture.close();
  }
});

test("uses the authoritative professional editor commands", async () => {
  const harness = await launchHarness("professional-editor");
  const { page, consoleErrors } = harness;

  try {
    await importFixture(page);
    const firstRow = page
      .locator(".segment-row")
      .filter({ has: page.getByLabel("Target segment 1") });
    const firstTarget = firstRow.getByLabel("Target segment 1");
    await expect(firstRow.locator(".tag-capsule.source-tag")).toHaveCount(4);
    await expect(firstRow.locator(".tag-issue")).toHaveCount(0);

    await firstTarget.fill("保留期为 30 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await firstTarget.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error("Target editor is not a textarea.");
      }
      element.focus();
      element.setSelectionRange(0, 0);
    });
    await firstRow
      .getByRole("button", { name: "Insert protected tag pair" })
      .click();
    await expect(
      firstRow.locator(".target-tag-strip .tag-capsule"),
    ).toHaveCount(2);
    const insertedPairEnd = firstRow
      .locator(".target-tag-strip .tag-capsule")
      .nth(1);
    await expect(insertedPairEnd.locator("small")).toHaveText("0");
    await insertedPairEnd.click();
    await expect(insertedPairEnd).toHaveClass(/selected/u);
    await firstTarget.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error("Target editor is not a textarea.");
      }
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
    await firstTarget.press("Control+K");
    await page.getByLabel("Filter commands").fill("move selected tag");
    await page
      .getByRole("option", { name: /Move selected tag to caret/u })
      .click();
    await expect(insertedPairEnd.locator("small")).not.toHaveText("0");
    await firstRow.getByRole("button", { name: "Copy protected tags" }).click();
    await expect(
      firstRow.locator(".target-tag-strip .tag-capsule"),
    ).toHaveCount(4);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(firstRow).toContainText("Issues");
    await expect(firstTarget).toHaveValue("保留期为 30 天。");

    await firstTarget.fill("保留期为");
    await expect(
      firstRow.getByRole("button", { name: "Accept TM autocomplete" }),
    ).toContainText("30 天。");
    await firstTarget.press("Tab");
    await expect(firstTarget).toHaveValue("保留期为 30 天。");

    await firstTarget.focus();
    await firstTarget.press("Control+A");
    await firstTarget.dispatchEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    await expect(
      page.getByRole("dialog", { name: "Concordance" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".concordance-results article")).toHaveCount(1);
    await expect(page.locator(".concordance-results")).toContainText(
      "保留期为 30 天。",
    );
    await page.getByRole("button", { name: "Close concordance" }).click();

    await firstTarget.focus();
    await firstTarget.dispatchEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      bubbles: true,
    });
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
    await page.getByLabel("Filter commands").fill("cycle theme");
    await page.getByRole("option", { name: /Cycle theme/u }).click();
    await expect(page.locator(".workbench-app")).toHaveClass(/theme-dark/u);

    await firstTarget.focus();
    await firstTarget.dispatchEvent("keydown", {
      key: ",",
      code: "Comma",
      ctrlKey: true,
      bubbles: true,
    });
    await expect(
      page.getByRole("dialog", { name: "Editor preferences" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Trados", exact: true }).click();
    await expect(page.getByLabel("Shortcut for Next segment")).toHaveValue(
      "Ctrl+Alt+ArrowDown",
    );
    await page.getByRole("button", { name: "Save shortcuts" }).click();

    await page.getByRole("button", { name: "Open find and replace" }).click();
    await expect(
      page.getByRole("dialog", { name: "Find and replace" }),
    ).toBeVisible();
    const replaceInputs = page.locator(".find-dialog input");
    await replaceInputs.nth(0).fill("30");
    await replaceInputs.nth(1).fill("45");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".replace-preview")).toContainText("1 segments");
    await page.getByRole("button", { name: "Apply unchanged preview" }).click();
    await expect(firstTarget).toHaveValue("保留期为 45 天。");

    await page.getByRole("button", { name: "Undo editor operation" }).click();
    await expect(firstTarget).toHaveValue("保留期为 30 天。");
    await page.getByRole("button", { name: "Redo editor operation" }).click();
    await expect(firstTarget).toHaveValue("保留期为 45 天。");

    await firstRow.getByRole("button", { name: "Open comments" }).click();
    await page.getByLabel("New comment").fill("Verify the retention number.");
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByText("Verify the retention number.")).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Edited comment text")
      .fill("Verify the updated retention number.");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(
      page.getByText("Verify the updated retention number."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await page.getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No comments on this segment.")).toBeVisible();
    await page.getByRole("button", { name: "Close comments" }).click();

    const thirdRow = page.locator(".segment-row").nth(2);
    await thirdRow.click();
    const thirdTarget = thirdRow.locator("textarea");
    await thirdTarget.fill("鼠标和打印机里的软件");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await thirdRow
      .getByRole("button", { name: "Open Chinese conversion" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Chinese conversion" }),
    ).toBeVisible();
    await page
      .getByLabel("Chinese conversion profile")
      .selectOption("simplifiedToTaiwan");
    await page.getByRole("button", { name: "Apply conversion" }).click();
    await expect(thirdTarget).toHaveValue("滑鼠和印表機裡的軟體");
    await thirdRow.getByRole("button", { name: "Correct source" }).click();
    await page
      .getByLabel("Corrected source")
      .fill("Corrected source for review.");
    await page.getByLabel("Source correction reason").fill("Fix source typo");
    await page.getByRole("button", { name: "Apply correction" }).click();
    await expect(thirdRow.locator(".source-cell .tagged-text")).toHaveAttribute(
      "aria-label",
      "Corrected source for review.",
    );

    await thirdRow.getByRole("button", { name: "Open review panel" }).click();
    await page
      .getByLabel("Proposed source revision")
      .fill("Corrected source after reviewer feedback.");
    await page.getByRole("button", { name: "Create review proposal" }).click();
    await expect(page.locator(".review-thread")).toContainText(
      "Source revision",
    );
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(thirdRow.locator(".source-cell .tagged-text")).toHaveAttribute(
      "aria-label",
      "Corrected source after reviewer feedback.",
    );
    await page.getByRole("button", { name: "Close review panel" }).click();

    await firstRow.click();
    await firstRow.getByRole("button", { name: "Open review panel" }).click();
    await page
      .getByLabel("Proposed target revision")
      .fill("保留期限为 45 天。");
    await page.getByRole("button", { name: "Create review proposal" }).click();
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(firstTarget).toHaveValue("保留期限为 45 天。");
    await expect(page.getByText("accepted", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close review panel" }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await firstRow.click();
    await firstRow.getByRole("button", { name: "Open review panel" }).click();
    await page.getByRole("button", { name: "signed", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "signed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Close review panel" }).click();
    await expect(firstTarget).toBeDisabled();
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("pages the bounded project home list", async ({ browserName }) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(60_000);
  const harness = await launchHarness("project-pagination");
  const { page, consoleErrors } = harness;

  try {
    await expect(
      page.getByRole("heading", { name: "Continue translating" }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      for (let index = 0; index < 51; index += 1) {
        await api.invoke("project.create", {
          name: `Pagination project ${String(index).padStart(2, "0")}`,
          sourceLocale: "en-US",
          targetLocale: "zh-CN",
          domain: "Pagination",
        });
      }
    });
    await page.getByRole("button", { name: "Refresh project data" }).click();
    await expect(page.locator(".project-card")).toHaveCount(50);
    const pagination = page.getByLabel("Project pages");
    await expect(pagination).toContainText("1-50 of 51");
    await pagination.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".project-card")).toHaveCount(1);
    await expect(pagination).toContainText("51-51 of 51");
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("manages the complete project lifecycle through the real Engine", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(120_000);
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "translunar-lifecycle-"));
  const sourceDirectory = join(fixtureDirectory, "initial");
  const addDirectory = join(fixtureDirectory, "additional");
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(addDirectory, { recursive: true });
  const sourceA = join(sourceDirectory, "alpha.txt");
  const sourceB = join(sourceDirectory, "beta.txt");
  const sourceC = join(addDirectory, "gamma.txt");
  const sourceD = join(fixtureDirectory, "delta.txt");
  const replacement = join(fixtureDirectory, "alpha-revised.txt");
  writeFileSync(
    sourceA,
    "Stable lifecycle sentence.\n\nChanged lifecycle sentence.\n\nSearchable source note.",
    "utf8",
  );
  writeFileSync(
    sourceB,
    "Second project file.\n\nAnother source segment.",
    "utf8",
  );
  writeFileSync(sourceC, "Added from folder.\n\nFolder detail.", "utf8");
  writeFileSync(sourceD, "Added by a real file drop.\n\nDrop detail.", "utf8");
  writeFileSync(
    replacement,
    "Stable lifecycle sentence.\n\nRevised lifecycle sentence.\n\nNew lifecycle sentence.",
    "utf8",
  );
  const harness = await launchHarness("lifecycle", {
    source: sourceA,
    sourceFiles: [sourceA, sourceB],
    sourceFolder: addDirectory,
    replacementSource: replacement,
  });
  const { page, archivePath, consoleErrors } = harness;
  const projectName = "Lifecycle desktop project";
  const templateName = "Lifecycle UI template";

  try {
    await expect(
      page.getByRole("heading", { name: "Continue translating" }),
    ).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem("translunar.active-workspace.v1", "{malformed");
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Continue translating" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("translunar.active-workspace.v1"),
        ),
      )
      .toBeNull();
    await captureResponsiveSurface(harness, testInfo, "project-home");

    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByRole("button", { name: "New template" }).click();
    let templateDialog = page.getByRole("dialog", {
      name: "New project template",
    });
    await templateDialog.getByLabel("Name").fill(templateName);
    await templateDialog.getByLabel("Description").fill("Lifecycle defaults");
    await templateDialog.getByLabel("Domain").fill("Product");
    await templateDialog.getByLabel("Require review before sign-off").uncheck();
    await templateDialog.getByRole("button", { name: "Save template" }).click();
    let templateCard = page
      .locator(".template-list > article")
      .filter({ hasText: templateName });
    await expect(templateCard).toContainText("revision 1");
    await page.evaluate(async (name) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const templatePage = await api.invoke("project.template.list", {
        offset: 0,
        limit: 100,
      });
      const template = templatePage.items.find(
        (item: ProjectTemplate) => item.name === name,
      );
      if (!template) throw new Error("lifecycle template was not found");
      const definition =
        typeof template.definition === "object" &&
        template.definition !== null &&
        !Array.isArray(template.definition)
          ? template.definition
          : {};
      await api.invoke("project.template.update", {
        templateId: template.id,
        expectedRevision: template.revision,
        name: template.name,
        description: template.description,
        definition: { ...definition, pipelineId: "missing.lifecycle.pipeline" },
      });
    }, templateName);
    await page.getByRole("button", { name: "Refresh project data" }).click();
    await expect(templateCard).toContainText("revision 2");
    await templateCard.getByRole("button", { name: "Edit" }).click();
    templateDialog = page.getByRole("dialog", {
      name: "Edit project template",
    });
    await templateDialog
      .getByLabel("Description")
      .fill("Updated lifecycle defaults");
    await templateDialog.getByRole("button", { name: "Save template" }).click();
    templateCard = page
      .locator(".template-list > article")
      .filter({ hasText: templateName });
    await expect(templateCard).toContainText("revision 3");
    const editedTemplateDefinition = await page.evaluate(async (name) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const templatePage = await api.invoke("project.template.list", {
        offset: 0,
        limit: 100,
      });
      return templatePage.items.find(
        (item: ProjectTemplate) => item.name === name,
      )?.definition;
    }, templateName);
    expect(
      (editedTemplateDefinition as { pipelineId?: string } | undefined)
        ?.pipelineId,
    ).toBe("missing.lifecycle.pipeline");

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: "Continue" }).click();
    const templateSelect = page.getByLabel("Project template");
    await expect(
      templateSelect.locator("option", { hasText: templateName }),
    ).toHaveCount(1);
    await templateSelect.selectOption({ label: `${templateName} · r3` });
    await page.getByRole("button", { name: "Continue" }).click();
    await dropLocalFiles(page, ".wizard-dropzone", [sourceA, sourceB]);
    await expect(page.getByText("alpha.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("beta.txt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(
      page
        .locator(".wizard-diagnostics")
        .filter({ hasText: "missing.lifecycle.pipeline" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open workspace" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    const createdProject = await page.evaluate(async (name) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const projectPage = await api.invoke("project.list", {
        lifecycle: "active",
        offset: 0,
        limit: 100,
      });
      const project = projectPage.items.find(
        (item: Project) => item.name === name,
      );
      if (!project) throw new Error("lifecycle project was not found");
      const snapshot = await api.invoke("project.get", {
        projectId: project.id,
      });
      const documentId = snapshot.documents[0]?.id;
      if (!documentId) throw new Error("lifecycle document was not found");
      return { project, documentId };
    }, projectName);
    expect(createdProject.project.configuration).toMatchObject({
      reviewRequired: false,
      pipelineId: null,
    });
    expect(createdProject.project.configuration.templateId).toBeTruthy();
    await expect(page.locator(".document-switcher")).toContainText("alpha.txt");
    const firstTarget = page.locator(".segment-row textarea").first();
    await firstTarget.fill("Lifecycle retained target.");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await expect(
      page.getByRole("heading", { name: "Project insights" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect(page.locator(".insights-file-list > article")).toHaveCount(2);
    await page.getByRole("button", { name: "Add folder" }).click();
    await expect(page.locator(".insights-file-list > article")).toHaveCount(3);
    await expect(page.getByRole("status")).toContainText("1 succeeded");
    await dropLocalFiles(page, ".insights-dropzone", [sourceD]);
    await expect(page.locator(".insights-file-list > article")).toHaveCount(4);
    await expect(page.getByRole("status")).toContainText("1 succeeded");
    await expect(page.locator(".insights-diagnostic-row")).toContainText(
      "delta.txt",
    );
    const deltaFile = page
      .locator(".insights-file-list > article")
      .filter({ hasText: "delta.txt" });
    await deltaFile.getByRole("button", { name: "Recycle delta.txt" }).click();
    await page
      .getByRole("dialog", { name: "Recycle document" })
      .getByRole("button", { name: "Recycle document" })
      .click();
    await expect(deltaFile).toHaveCount(0);
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(
      page.locator(".insights-metric").filter({ hasText: "Files" }),
    ).toContainText("3");

    await page.getByRole("tab", { name: "Re-import" }).click();
    await page.getByRole("button", { name: "Select replacement" }).click();
    await expect(
      page.getByText("alpha-revised.txt", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Preview reconciliation" }).click();
    await expect(page.locator(".reimport-counts")).toBeVisible();
    await expect(page.locator(".reimport-counts")).toContainText("Unchanged");
    await expect(page.locator(".reimport-counts")).toContainText("Changed");
    await expect(page.locator(".reimport-counts")).toContainText("New");
    await expect(page.locator(".reimport-counts")).toContainText("Removed");
    await expect(page.locator(".reimport-counts")).toContainText("Ambiguous");
    await page.getByRole("button", { name: "Apply preview" }).click();
    await page
      .getByRole("dialog", { name: "Apply re-import" })
      .getByRole("button", { name: "Apply preview" })
      .click();
    await expect(page.getByRole("status")).toContainText("was re-imported");

    await page.getByRole("tab", { name: "Analysis" }).click();
    await page.getByRole("button", { name: "Run analysis" }).click();
    await expect(page.locator(".analysis-results")).toContainText(
      "Analysis snapshot",
    );
    await expect(page.locator(".analysis-results")).toContainText(
      "Weighted effort",
    );
    await page.getByRole("tab", { name: "History" }).click();
    await expect(
      page.locator(".insights-history-list article").first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.locator(".insights-metric-strip")).toContainText(
      "QA blockers",
    );
    await expect(page.locator(".insights-overview")).toContainText(
      "AI contribution",
    );
    await expect(page.locator(".insights-overview")).toContainText(
      "Asset health",
    );
    await captureResponsiveSurface(harness, testInfo, "project-insights");

    await page.getByRole("tab", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Export .tlcat" }).click();
    await expect.poll(() => existsSync(archivePath)).toBe(true);
    await page.getByRole("button", { name: "Export .tlcat" }).click();
    await expect(page.getByRole("alert")).toContainText("already exists");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Global search query").fill("Stable lifecycle");
    await page.getByLabel("Search field").selectOption("source");
    await page
      .locator(".global-search-form")
      .getByRole("button", { name: "Search" })
      .click();
    const sourceSearchResult = page.locator(".search-results > button").first();
    await expect(sourceSearchResult).toBeVisible();
    await expect(sourceSearchResult.locator("mark")).not.toHaveCount(0);
    await expect(sourceSearchResult).not.toContainText("<mark>");
    await sourceSearchResult.click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(page.locator(".segment-row textarea").first()).toBeFocused();

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByLabel("Global search query")
      .fill("Lifecycle retained target");
    await page.getByLabel("Search field").selectOption("target");
    await page
      .locator(".global-search-form")
      .getByRole("button", { name: "Search" })
      .click();
    await expect(
      page.locator(".search-results > button").first(),
    ).toContainText("Lifecycle");
    await expect(
      page.locator(".search-results > button").first(),
    ).toContainText("target");

    await page.getByLabel("Global search query").fill(projectName);
    await page.getByLabel("Search field").selectOption("project");
    await page
      .locator(".global-search-form")
      .getByRole("button", { name: "Search" })
      .click();
    await expect(
      page.locator(".search-results > button").first(),
    ).toContainText(projectName);
    await expect(page.locator(".search-result-field").first()).toHaveText(
      "project",
    );

    await page.getByLabel("Global search query").fill("alpha");
    await page.getByLabel("Search field").selectOption("document");
    await page
      .locator(".global-search-form")
      .getByRole("button", { name: "Search" })
      .click();
    await expect(
      page.locator(".search-results > button").first(),
    ).toContainText("alpha.txt");
    await expect(page.locator(".search-result-field").first()).toHaveText(
      "document",
    );
    await page.getByLabel("Search field").selectOption({
      label: "Import notes",
    });
    await expect(page.getByLabel("Search field")).toHaveValue("note");

    await page.getByRole("button", { name: "Templates", exact: true }).click();
    templateCard = page
      .locator(".template-list > article")
      .filter({ hasText: templateName });
    await templateCard
      .getByRole("button", { name: `Delete ${templateName}` })
      .click();
    await page
      .getByRole("dialog", { name: "Delete project template" })
      .getByRole("button", { name: "Delete template" })
      .click();
    await expect(templateCard).toHaveCount(0);

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    let projectCard = page
      .locator(".project-card")
      .filter({ hasText: projectName });
    await projectCard
      .getByRole("button", { name: `Recycle ${projectName}` })
      .click();
    await page
      .getByRole("dialog", { name: "Move project to recycle bin" })
      .getByRole("button", { name: "Move to recycle bin" })
      .click();
    await expect(projectCard).toHaveCount(0);
    await page.evaluate(
      ({ projectId, documentId }) => {
        localStorage.setItem(
          "translunar.active-workspace.v1",
          JSON.stringify({ projectId, documentId }),
        );
      },
      {
        projectId: createdProject.project.id,
        documentId: createdProject.documentId,
      },
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Continue translating" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("translunar.active-workspace.v1"),
        ),
      )
      .toBeNull();
    await page
      .locator(".project-home-nav")
      .getByRole("button", { name: /^Recycle/u })
      .click();
    let recycleEntry = page
      .locator(".recycle-list > article")
      .filter({ hasText: projectName });
    await recycleEntry.getByRole("button", { name: "Restore" }).click();
    await page
      .getByRole("dialog", { name: "Restore recycled item" })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(recycleEntry).toHaveCount(0);

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "Restore archive" }).click();
    await expect(
      page.locator(".project-card").filter({ hasText: projectName }),
    ).toHaveCount(2);

    projectCard = page
      .locator(".project-card")
      .filter({ hasText: projectName })
      .last();
    await projectCard
      .getByRole("button", { name: `Recycle ${projectName}` })
      .click();
    await page
      .getByRole("dialog", { name: "Move project to recycle bin" })
      .getByRole("button", { name: "Move to recycle bin" })
      .click();
    await page
      .locator(".project-home-nav")
      .getByRole("button", { name: /^Recycle/u })
      .click();
    recycleEntry = page
      .locator(".recycle-list > article")
      .filter({ hasText: projectName });
    await recycleEntry
      .getByRole("button", { name: `Purge ${projectName}` })
      .click();
    const purgeDialog = page.getByRole("dialog", {
      name: "Permanently purge item",
    });
    await purgeDialog
      .getByRole("button", { name: "Permanently purge" })
      .click();
    await expect(purgeDialog).toHaveCount(0);
    await expect(recycleEntry).toHaveCount(0);

    await page.evaluate("window.translunar.restartEngine()");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Continue translating" }),
    ).toBeVisible();
    await expect(
      page.locator(".project-card").filter({ hasText: projectName }),
    ).toHaveCount(1);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("manages revision-bound discussions and project snapshots through Insights", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(120_000);
  const harness = await launchHarness("discussion-snapshot");
  const { page, consoleErrors } = harness;
  const successNotice = page.locator('p.surface-success[role="status"]');

  try {
    await importFixture(page);
    const ids = await page.evaluate(async () => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const projects = await api.invoke("project.list", {
        lifecycle: "active",
        offset: 0,
        limit: 20,
      });
      const project = projects.items[0];
      if (!project) throw new Error("Discussion project is missing.");
      const snapshot = await api.invoke("project.get", {
        projectId: project.id,
      });
      const document = snapshot.documents[0];
      if (!document) throw new Error("Discussion document is missing.");
      const segments = await api.invoke("segment.list", {
        documentId: document.id,
        offset: 0,
        limit: 20,
      });
      const segment = segments.items[0];
      if (!segment) throw new Error("Discussion segment is missing.");
      return {
        projectId: project.id,
        documentId: document.id,
        segmentId: segment.id,
      };
    });

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await expect(
      page.getByRole("heading", { name: "Project insights" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Discussions \/ snapshots/u }).click();
    await expect(
      page.getByRole("tab", { name: "Discussions", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Title (optional)").fill("Terminology review");
    await page
      .getByLabel("First message")
      .fill("Please check this phrase with @Reviewer.");
    await page.getByRole("button", { name: "Create discussion" }).click();
    await expect(successNotice).toContainText("Discussion created");
    await expect(page.locator(".discussion-thread-row")).toHaveCount(1);
    await expect(page.locator(".discussion-mentions")).toContainText(
      "@reviewer",
    );

    await page.getByLabel("Reply").fill("Confirmed with @Owner.");
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(successNotice).toContainText("Reply added");
    await expect(page.locator(".discussion-message")).toHaveCount(2);

    await page
      .locator(".discussion-message")
      .nth(1)
      .getByRole("button", { name: "Edit message 2" })
      .click();
    await page
      .locator(".discussion-message-edit textarea")
      .fill("Confirmed with @Owner and @Reviewer.");
    await page
      .locator(".discussion-message-edit")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(successNotice).toContainText("Message 2 updated");

    await page
      .locator(".discussion-message")
      .nth(1)
      .getByRole("button", { name: "Delete message 2" })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: "Delete message 2",
    });
    await deleteDialog.getByRole("button", { name: "Delete message" }).click();
    await expect(successNotice).toContainText("deleted as a tombstone");

    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(successNotice).toContainText("Discussion resolved");
    await page.getByLabel("Include resolved").check();
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(successNotice).toContainText("Discussion reopened");

    await page.getByRole("button", { name: "Document", exact: true }).click();
    await page.getByLabel("First message").fill("Document-level note.");
    await page.getByRole("button", { name: "Create discussion" }).click();
    await expect(successNotice).toContainText("Discussion created");

    await page.getByRole("button", { name: "Segment", exact: true }).click();
    await page.getByLabel("Segment").selectOption(ids.segmentId);
    await page.getByLabel("First message").fill("Segment note for @QA.");
    await page.getByRole("button", { name: "Create discussion" }).click();
    await expect(successNotice).toContainText("Discussion created");

    await page.getByRole("tab", { name: "Project snapshots" }).click();
    await page.getByLabel("Snapshot name").fill("Before review");
    await page.getByRole("button", { name: "Create snapshot" }).click();
    await expect(successNotice).toContainText("Snapshot Before review created");
    await expect(page.locator(".snapshot-row")).toHaveCount(1);

    await page.getByLabel("Snapshot name").fill("Before review");
    await page.getByRole("button", { name: "Create snapshot" }).click();
    await expect(page.getByRole("alert")).toContainText(
      /already exists|duplicate/u,
    );

    await page.getByRole("button", { name: "Preview restore" }).click();
    await expect(
      page.getByRole("region", { name: "Restore preview" }),
    ).toBeVisible();

    await page.evaluate(async (projectId) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const current = await api.invoke("project.get", { projectId });
      await api.invoke("project.update", {
        projectId,
        name: `${current.project.name} changed after preview`,
        sourceLocale: current.project.sourceLocale,
        targetLocale: current.project.targetLocale,
        domain: current.project.domain,
        configuration: current.project.configuration,
        expectedRevision: current.project.revision,
        actor: "desktop-e2e",
        correlationId: "discussion-snapshot-stale",
      });
    }, ids.projectId);
    await page.getByRole("button", { name: "Restore snapshot" }).click();
    const restoreDialog = page.getByRole("dialog", {
      name: "Restore Before review",
    });
    await restoreDialog
      .getByRole("button", { name: "Restore snapshot" })
      .click();
    await expect(restoreDialog.getByRole("alert")).toContainText(
      /modified by another writer/u,
    );
    await restoreDialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Refresh preview" }).click();
    await expect(successNotice).toContainText("preview is ready");
    await page.getByRole("button", { name: "Restore snapshot" }).click();
    await page
      .getByRole("dialog", { name: "Restore Before review" })
      .getByRole("button", { name: "Restore snapshot" })
      .click();
    await expect(successNotice).toContainText("Snapshot restored");
    await expect(page.locator(".snapshot-preview-status")).toHaveText(
      "applied",
    );

    await page.evaluate("window.translunar.restartEngine()");
    await page.reload();
    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await expect(
      page.getByRole("heading", { name: "Project insights" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Discussions \/ snapshots/u }).click();
    await page.getByRole("tab", { name: "Project snapshots" }).click();
    await expect(
      page.locator(".snapshot-row").filter({ hasText: "Before review" }),
    ).toHaveCount(1);
    await expectNamedControls(page, ".snapshot-workflow");
    await captureResponsiveSurface(harness, testInfo, "project-snapshots");
    await page.getByRole("tab", { name: "Discussions", exact: true }).click();
    await page.getByLabel("Include resolved").check();
    await expect(page.locator(".discussion-thread-row")).toHaveCount(1);
    const recoveredThreadCounts = await page.evaluate(async (projectId) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const counts = [];
      for (const scope of ["project", "document", "segment"] as const) {
        const page = await api.invoke("discussion.thread.list", {
          projectId,
          scope,
          includeResolved: true,
          offset: 0,
          limit: 20,
        });
        counts.push(page.total);
      }
      return counts;
    }, ids.projectId);
    expect(recoveredThreadCounts).toEqual([1, 1, 1]);

    await expectNamedControls(page, ".discussion-workflow");
    await captureResponsiveSurface(harness, testInfo, "project-discussions");
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("applies review DOCX and a bilingual table through Project Insights", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-interop-ui-"),
  );
  const sourcePath = join(fixtureDirectory, "interop-source.txt");
  const tablePath = join(fixtureDirectory, "bilingual-table.xlsx");
  const reviewPath = join(fixtureDirectory, "offline-review.docx");
  writeFileSync(
    sourcePath,
    "Desktop source alpha.\n\nDesktop source beta.\n\nDesktop source gamma.\n",
  );
  writeBilingualXlsxFixture(tablePath);
  const harness = await launchHarness("interop-ui", {
    source: sourcePath,
    interopExportPath: reviewPath,
    interopReviewInput: reviewPath,
    interopTableInput: tablePath,
  });
  const { page, consoleErrors } = harness;
  try {
    await importFixture(page, "interop-source.txt");
    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await expect(
      page.getByRole("heading", { name: "Project insights" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Interop" }).click();

    await page
      .getByRole("button", { name: "Review export destination" })
      .click();
    await expect(
      page.getByText("offline-review.docx", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Export review" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Review DOCX exported",
    );
    expect(statSync(reviewPath).size).toBeGreaterThan(0);
    editReviewDocx(reviewPath, {
      target: "Desktop review target",
      comments: "Verified through the desktop interop flow",
    });

    await page.getByRole("button", { name: "Select review DOCX" }).click();
    await page.getByRole("button", { name: "Preview" }).click();
    const reviewPreview = page.getByRole("region", { name: "Review preview" });
    await expect(reviewPreview).toBeVisible();
    await expect(reviewPreview).toContainText("Desktop review target");
    await expect(reviewPreview.locator(".interop-disposition")).toHaveText([
      "unchanged",
      "unchanged",
      "changed",
    ]);
    await expect(
      reviewPreview.locator('input[type="checkbox"]:checked'),
    ).toHaveCount(1);
    await expect(page.locator(".interop-empty")).toHaveCount(0);
    await reviewPreview.getByRole("button", { name: "Apply 1" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Applied 1 review row(s).",
    );
    await expect(reviewPreview.locator(".interop-status")).toHaveText(
      "applied",
    );
    const proposals = await page.evaluate(async () => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const projects = await api.invoke("project.list", {
        offset: 0,
        limit: 10,
      });
      const project = projects.items[0];
      if (!project) throw new Error("Interop project is missing.");
      return api.invoke("review.queue", {
        projectId: project.id,
        status: "pending",
        offset: 0,
        limit: 10,
      });
    });
    expect(proposals.items).toHaveLength(1);
    expect(proposals.items[0]?.revision.proposedTarget).toBe(
      "Desktop review target",
    );
    await captureResponsiveSurface(harness, testInfo, "interop-review");

    await page.getByRole("tab", { name: "Table to TM" }).click();
    await page.getByRole("button", { name: "Select table" }).click();
    await expect(
      page.getByText("bilingual-table.xlsx", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    const tablePreview = page.getByRole("region", { name: "Table preview" });
    await expect(tablePreview).toBeVisible();
    await expect(page.locator(".interop-empty")).toHaveCount(0);
    await expect(tablePreview).toContainText("DesktopInteropAlpha");
    await expect(
      tablePreview.locator('input[type="checkbox"]:checked'),
    ).toHaveCount(2);
    await tablePreview.getByRole("button", { name: "Apply 2" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Imported 2 table row(s) into the TM.",
    );
    await expect(tablePreview.locator(".interop-status")).toHaveText("applied");
    await captureResponsiveSurface(harness, testInfo, "interop-table");
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("hands off an offline task package between real Engine workspaces", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(120_000);
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-task-package-ui-"),
  );
  const sourcePath = join(fixtureDirectory, "task-owner.txt");
  const assignmentPath = join(fixtureDirectory, "desktop-assignment.tltask");
  const returnPath = join(fixtureDirectory, "desktop-return.tltask");
  writeFileSync(
    sourcePath,
    `${Array.from(
      { length: 26 },
      (_, index) => `Desktop task source ${index + 1}.`,
    ).join("\n\n")}\n`,
    "utf8",
  );
  const owner = await launchHarness("task-package-owner", {
    source: sourcePath,
    taskPackageInput: returnPath,
    taskPackageDestination: assignmentPath,
  });
  let recipient: ElectronHarness | null = null;
  try {
    await importFixture(owner.page, "task-owner.txt");
    const ownerIds = await owner.page.evaluate(async () => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const projects = await api.invoke("project.list", {
        lifecycle: "active",
        offset: 0,
        limit: 20,
      });
      const project = projects.items[0];
      if (!project) throw new Error("Task package owner project is missing.");
      const snapshot = await api.invoke("project.get", {
        projectId: project.id,
      });
      const document = snapshot.documents[0];
      if (!document) throw new Error("Task package owner document is missing.");
      const segments = await api.invoke("segment.list", {
        documentId: document.id,
        offset: 0,
        limit: 20,
      });
      const first = segments.items[0];
      const second = segments.items[1];
      if (!first || !second) {
        throw new Error("Task package owner segments are missing.");
      }
      return {
        projectId: project.id,
        documentId: document.id,
        firstSegmentId: first.id,
        secondSegmentId: second.id,
        secondSegmentRevision: second.revision,
      };
    });

    await openApplicationMenu(owner.page);
    await owner.page.getByRole("button", { name: "Project insights" }).click();
    await owner.page.getByRole("tab", { name: "Task packages" }).click();
    await expect(
      owner.page.getByRole("heading", { name: "Create an assignment package" }),
    ).toBeVisible();
    await owner.page
      .getByLabel("Instructions for recipient")
      .fill("Translate this assignment without the owner workspace.");
    await owner.page
      .getByRole("button", { name: "Choose .tltask destination" })
      .click();
    await expect(
      owner.page.getByText("desktop-assignment.tltask", { exact: true }),
    ).toBeVisible();
    const assignmentExport = owner.page.getByRole("button", {
      name: "Export assignment",
    });
    const actorInput = owner.page.getByLabel("Actor");
    const reasonInput = owner.page.getByLabel("Reason");
    await actorInput.fill("");
    await expect(assignmentExport).toBeDisabled();
    await actorInput.fill("Desktop task owner");
    await reasonInput.fill("");
    await expect(assignmentExport).toBeDisabled();
    await reasonInput.fill("Delegate the bounded desktop assignment");
    const addSlice = owner.page.getByRole("button", { name: "Add slice" });
    await expect(addSlice).toBeEnabled();
    await addSlice.click();
    await expect(assignmentExport).toBeDisabled();
    await expect(owner.page.getByRole("alert")).toContainText(
      "Every added asset slice",
    );
    await owner.page.getByLabel("Asset slice 1 row IDs").fill("fixture-row-id");
    await expect(assignmentExport).toBeEnabled();
    await owner.page
      .getByRole("button", { name: "Remove asset slice 1" })
      .click();
    await expectNamedControls(owner.page, ".task-package-layout");
    await assignmentExport.click();
    await expect(owner.page.locator(".task-package-feedback")).toContainText(
      "Assignment package",
    );
    expect(statSync(assignmentPath).size).toBeGreaterThan(0);

    recipient = await launchHarness("task-package-recipient", {
      taskPackageInput: assignmentPath,
      taskPackageDestination: returnPath,
    });
    await importFixture(recipient.page);
    await openApplicationMenu(recipient.page);
    await recipient.page
      .getByRole("button", { name: "Project insights" })
      .click();
    await recipient.page.getByRole("tab", { name: "Task packages" }).click();
    await recipient.page.getByRole("tab", { name: "Open package" }).click();
    await recipient.page.getByRole("button", { name: "Open .tltask" }).click();
    await expect(
      recipient.page.getByText("desktop-assignment.tltask", { exact: true }),
    ).toBeVisible();
    await recipient.page
      .getByRole("button", { name: "Preview package" })
      .click();
    await expect(
      recipient.page.getByRole("heading", { name: "Engine classifications" }),
    ).toBeVisible();
    await expect(recipient.page.locator(".task-package-row")).toHaveCount(25);
    await expect(
      recipient.page.locator(".task-package-pagination"),
    ).toContainText("1-25 of 26");
    await expectNamedControls(recipient.page, ".task-package-layout");
    await captureResponsiveSurface(
      recipient,
      testInfo,
      "task-package-assignment",
    );
    await recipient.page.getByRole("button", { name: "Next" }).click();
    await expect(recipient.page.locator(".task-package-row")).toHaveCount(1);
    await expect(
      recipient.page.locator(".task-package-pagination"),
    ).toContainText("26-26 of 26");
    await recipient.page.getByRole("button", { name: "Previous" }).click();
    await recipient.page
      .getByLabel("Detached project name")
      .fill("Desktop detached task");
    await recipient.page
      .getByRole("button", { name: "Import detached task" })
      .click();
    await expect(
      recipient.page.getByText("Detached task project is ready"),
    ).toBeVisible();
    await expect(
      recipient.page.getByRole("button", { name: "Import detached task" }),
    ).toBeDisabled();
    await expect(
      recipient.page.getByRole("button", { name: "Discard staged package" }),
    ).toBeDisabled();
    await recipient.page
      .getByRole("button", { name: "Open task project" })
      .click();
    await expect(
      recipient.page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    const returnedTarget = "Returned through the desktop task package flow.";
    await recipient.page.evaluate(async (targetText) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const projects = await api.invoke("project.list", {
        lifecycle: "active",
        offset: 0,
        limit: 20,
      });
      const taskProject = projects.items.find(
        (project) =>
          project.configuration.taskPackage !== null &&
          project.configuration.taskPackage !== undefined,
      );
      if (!taskProject) throw new Error("Detached task project is missing.");
      const snapshot = await api.invoke("project.get", {
        projectId: taskProject.id,
      });
      const document = snapshot.documents[0];
      if (!document) throw new Error("Detached task document is missing.");
      const page = await api.invoke("segment.list", {
        documentId: document.id,
        offset: 0,
        limit: 20,
      });
      const segment = page.items[0];
      if (!segment) throw new Error("Detached task segment is missing.");
      await api.invoke("segment.updateTarget", {
        segmentId: segment.id,
        targetText,
        expectedRevision: segment.revision,
      });
    }, returnedTarget);
    await openApplicationMenu(recipient.page);
    await recipient.page
      .getByRole("button", { name: "Project insights" })
      .click();
    await recipient.page.getByRole("tab", { name: "Task packages" }).click();
    await recipient.page.getByRole("tab", { name: "Export return" }).click();
    await expect(
      recipient.page.getByRole("heading", { name: "Export a return package" }),
    ).toBeVisible();
    await recipient.page
      .getByRole("button", { name: "Choose .tltask destination" })
      .click();
    await recipient.page.getByRole("button", { name: "Export return" }).click();
    await expect(
      recipient.page.locator(".task-package-feedback"),
    ).toContainText("Return package");
    expect(statSync(returnPath).size).toBeGreaterThan(0);

    await owner.page.getByRole("tab", { name: "Open package" }).click();
    await owner.page.getByRole("button", { name: "Open .tltask" }).click();
    await owner.page.getByRole("button", { name: "Preview package" }).click();
    const ownerPreview = owner.page.locator(".task-package-preview");
    await expect(ownerPreview).toContainText("Remote changed");
    await expect(ownerPreview.locator(".task-package-row")).toHaveCount(25);
    await expect(
      ownerPreview.locator(".task-package-pagination"),
    ).toContainText("1-25 of 26");
    await ownerPreview
      .getByRole("button", { name: "Select safe on page" })
      .click();
    await ownerPreview.getByRole("button", { name: "Next" }).click();
    await expect(ownerPreview.locator(".task-package-row")).toHaveCount(1);
    await expect(
      ownerPreview.getByRole("button", { name: "Apply 1" }),
    ).toBeEnabled();

    const localTarget = "Owner edit retained while retrying the return merge.";
    await owner.page.evaluate(
      async ({ projectId, segmentId, expectedRevision, targetText }) => {
        const api = (window as unknown as { translunar: DesktopApi })
          .translunar;
        const snapshot = await api.invoke("project.get", { projectId });
        await api.invoke("project.update", {
          projectId,
          name: snapshot.project.name,
          sourceLocale: snapshot.project.sourceLocale,
          targetLocale: snapshot.project.targetLocale,
          domain: `${snapshot.project.domain}-updated`,
          configuration: snapshot.project.configuration,
          expectedRevision: snapshot.project.revision,
          actor: "Desktop stale-state fixture",
        });
        await api.invoke("segment.updateTarget", {
          segmentId,
          targetText,
          expectedRevision,
        });
      },
      {
        projectId: ownerIds.projectId,
        segmentId: ownerIds.secondSegmentId,
        expectedRevision: ownerIds.secondSegmentRevision,
        targetText: localTarget,
      },
    );

    await ownerPreview.getByRole("button", { name: "Apply 1" }).click();
    let applyDialog = owner.page.getByRole("dialog", {
      name: "Apply selected rows?",
    });
    await applyDialog.getByRole("button", { name: "Apply merge" }).click();
    await expect(owner.page.getByRole("alert")).toContainText(
      /revision|conflict|modified/iu,
    );
    await expect(
      ownerPreview.getByRole("button", { name: "Apply 1" }),
    ).toBeEnabled();

    await owner.page.getByRole("button", { name: "Preview package" }).click();
    await expect(ownerPreview).toContainText("Remote changed");
    await expect(ownerPreview).toContainText("Local changed");
    await ownerPreview
      .getByRole("button", { name: "Select safe on page" })
      .click();
    await ownerPreview.getByRole("button", { name: "Next" }).click();
    await expect(
      ownerPreview.getByRole("button", { name: "Apply 1" }),
    ).toBeEnabled();
    await ownerPreview.getByRole("button", { name: "Apply 1" }).click();
    applyDialog = owner.page.getByRole("dialog", {
      name: "Apply selected rows?",
    });
    await expect(applyDialog).toHaveAttribute("aria-modal", "true");
    await applyDialog.getByRole("button", { name: "Apply merge" }).click();
    await expect(owner.page.locator(".task-package-feedback")).toContainText(
      "Applied 1 selected row",
    );
    await expect(
      ownerPreview.getByRole("button", { name: "Apply 1" }),
    ).toBeDisabled();
    await expect(
      ownerPreview.getByRole("button", { name: "Discard staged package" }),
    ).toBeDisabled();
    await ownerPreview.getByRole("button", { name: "Previous" }).click();
    await expect(ownerPreview.locator(".task-package-row")).toHaveCount(25);
    await expectNamedControls(owner.page, ".task-package-layout");
    await captureResponsiveSurface(owner, testInfo, "task-package-return");

    const ownerTargets = await owner.page.evaluate(
      async ({ documentId, firstSegmentId, secondSegmentId }) => {
        const api = (window as unknown as { translunar: DesktopApi })
          .translunar;
        const page = await api.invoke("segment.list", {
          documentId,
          offset: 0,
          limit: 30,
        });
        return {
          first: page.items.find((segment) => segment.id === firstSegmentId)
            ?.targetText,
          second: page.items.find((segment) => segment.id === secondSegmentId)
            ?.targetText,
        };
      },
      ownerIds,
    );
    expect(ownerTargets.first).toBe(returnedTarget);
    expect(ownerTargets.second).toBe(localTarget);
    expect(owner.consoleErrors).toEqual([]);
    expect(recipient.consoleErrors).toEqual([]);
  } finally {
    if (recipient) await closeHarness(recipient);
    await closeHarness(owner);
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("runs real-Engine alignment and reference-corpus workflows", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(120_000);
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "translunar-alignment-ui-"),
  );
  const sourcePath = join(fixtureDirectory, "source.txt");
  const targetPath = join(fixtureDirectory, "target.txt");
  const corpusPath = join(fixtureDirectory, "corpus.txt");
  writeFileSync(sourcePath, "Invoice 2026 is due.\n\nPay within 30 days.\n");
  writeFileSync(targetPath, "2026 年发票已到期。\n\n请在 30 天内付款。\n");
  writeFileSync(
    corpusPath,
    "Invoice 2026 is due.\n\nPayment remains due in 30 days.\n",
  );
  const aiFixture = await startAiFixture();
  const harness = await launchHarness("alignment-corpus-ui", {
    sourceFiles: [sourcePath, targetPath],
    corpusInput: corpusPath,
  });
  const { page, consoleErrors } = harness;
  const alignmentCorpusName = "Desktop alignment corpus";
  const fileCorpusName = "Desktop source corpus";

  try {
    await importFixture(page, "source.txt");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "AI control" }).click();
    await expect(
      page.getByRole("heading", { name: "AI control" }),
    ).toBeVisible();
    await page.getByLabel("Connector").selectOption("openaiCompatible");
    await page.getByLabel("Profile name").fill("Desktop fixture");
    await page.getByLabel("Base URL").fill(aiFixture.url);
    await page.getByLabel("Model").fill("fixture-model");
    await page.getByRole("button", { name: "Add provider" }).click();
    const profile = page.locator(".ai-profile-row", {
      hasText: "Desktop fixture",
    });
    await expect(profile).toBeVisible();
    await profile.getByRole("button", { name: "Edit Desktop fixture" }).click();
    await page
      .locator(".ai-profile-edit")
      .getByRole("button", { name: "Save" })
      .click();
    await profile
      .getByRole("textbox", {
        name: "Credential for Desktop fixture",
        exact: true,
      })
      .fill("desktop-ai-secret");
    await profile.locator(".ai-credential-entry button").click();
    await expect(profile).toContainText("Stored");
    await page.getByLabel("AI enabled").check();
    await page
      .getByLabel("Default profile")
      .selectOption({ label: "Desktop fixture" });
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByText("AI workspace policy saved.")).toBeVisible();
    await page.getByRole("button", { name: "Back to workbench" }).click();

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await expect(
      page.getByRole("heading", { name: "Project insights" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Alignment / corpora" }).click();
    await expect(
      page.getByRole("heading", { name: "Document alignment" }),
    ).toBeVisible();

    const sourceSelect = page.getByLabel("Source document");
    const targetSelect = page.getByLabel("Target document");
    const sourceValue = await sourceSelect
      .locator("option")
      .filter({ hasText: "source.txt" })
      .first()
      .getAttribute("value");
    const targetValue = await targetSelect
      .locator("option")
      .filter({ hasText: "target.txt" })
      .first()
      .getAttribute("value");
    if (!sourceValue || !targetValue) {
      throw new Error("Alignment document options were not loaded.");
    }
    await sourceSelect.selectOption(sourceValue);
    await targetSelect.selectOption(targetValue);
    await page
      .getByRole("button", { name: "Create session", exact: true })
      .click();
    await expect(page.locator(".surface-success")).toContainText(
      "Created 2 candidates",
      { timeout: 20_000 },
    );

    const linkRows = page.locator(".alignment-link-row");
    await expect(linkRows).toHaveCount(2);
    for (const row of [linkRows.nth(0), linkRows.nth(1)]) {
      await row.getByRole("checkbox").check();
    }
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.locator(".surface-success")).toContainText(
      "Merge correction saved",
    );
    await expect(linkRows).toHaveCount(1);
    await linkRows.first().getByRole("checkbox").check();
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect(page.locator(".surface-success")).toContainText(
      "Split correction saved",
    );
    await expect(linkRows).toHaveCount(2);

    const refinementProfile = page.getByLabel("AI refinement profile");
    await expect(refinementProfile.locator("option")).toContainText(
      "Desktop fixture",
    );
    await refinementProfile.selectOption({
      label: "Desktop fixture · fixture-model",
    });
    await linkRows.first().getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Refine/u }).click();
    await expect(page.locator(".surface-success")).toContainText(
      "AI suggestions are ready",
      { timeout: 30_000 },
    );
    await expect(
      page.locator('.alignment-link-row[data-origin="ai"]'),
    ).toHaveCount(1);

    for (let index = 0; index < 2; index += 1) {
      const row = linkRows.nth(index);
      if ((await row.getAttribute("data-status")) !== "confirmed") {
        await row.getByRole("button", { name: "Confirm", exact: true }).click();
        await expect(page.locator(".surface-success")).toContainText(
          "marked confirmed",
        );
      }
    }
    await expect(
      page.locator('.alignment-link-row[data-status="confirmed"]'),
    ).toHaveCount(2);
    await page.locator(".alignment-select-page input").check();
    await page.getByLabel("Bilingual corpus name").fill(alignmentCorpusName);
    await page
      .getByRole("button", { name: "Create corpus", exact: true })
      .click();
    await expect(page.locator(".surface-success")).toContainText(
      `Created ${alignmentCorpusName} with 2 bilingual entries.`,
    );
    await captureResponsiveSurface(harness, testInfo, "alignment-workflow");

    await page.getByRole("button", { name: /^Apply \d+$/u }).click();
    await expect(page.locator(".surface-success")).toContainText(
      "Applied 2 TM units",
    );
    await expect(page.locator(".alignment-terminal")).toContainText(
      "Session applied",
    );

    await page
      .getByRole("tab", { name: "Reference corpora", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Import reference corpus" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Select file", exact: true })
      .click();
    await expect(page.getByText("corpus.txt", { exact: true })).toBeVisible();
    await page.getByLabel("Corpus name").fill(fileCorpusName);
    await page
      .getByRole("button", { name: "Import corpus", exact: true })
      .click();
    await expect(page.locator(".surface-success")).toContainText(
      `Imported ${fileCorpusName}: 2 entries`,
      { timeout: 20_000 },
    );
    const fileCorpusRow = page
      .locator(".corpus-list-row")
      .filter({ hasText: fileCorpusName });
    const alignmentCorpusRow = page
      .locator(".corpus-list-row")
      .filter({ hasText: alignmentCorpusName });
    await expect(fileCorpusRow).toHaveCount(1);
    await expect(alignmentCorpusRow).toHaveCount(1);

    const corpusSearchForm = page.locator(".corpus-search-form");
    await corpusSearchForm.getByLabel("Query").fill("Invoice 2026");
    await corpusSearchForm.getByLabel("Side").selectOption("source");
    await corpusSearchForm
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await expect(page.locator(".corpus-search-results article")).toHaveCount(2);
    await expect(page.locator(".corpus-search-results")).toContainText(
      alignmentCorpusName,
    );
    await expect(page.locator(".corpus-search-results")).toContainText(
      fileCorpusName,
    );

    await fileCorpusRow
      .getByRole("button", { name: "Reindex", exact: true })
      .click();
    await expect(page.locator(".surface-success")).toContainText(
      `Reindexed ${fileCorpusName}`,
    );
    await captureResponsiveSurface(harness, testInfo, "corpus-workflow");

    await page.getByRole("button", { name: "Back to workbench" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open command palette" }).click();
    const commandPalette = page.getByRole("dialog", {
      name: "Command palette",
    });
    await commandPalette
      .getByRole("option")
      .filter({ hasText: "Concordance" })
      .click();
    const concordance = page.getByRole("dialog", { name: "Concordance" });
    await concordance.getByLabel("Concordance query").fill("Invoice 2026");
    await concordance
      .getByLabel("Concordance direction")
      .selectOption("source");
    await concordance
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await expect(concordance.locator(".concordance-corpus-result")).toHaveCount(
      2,
    );
    const sourceCorpusHit = concordance
      .locator(".concordance-corpus-result")
      .filter({ hasText: fileCorpusName });
    const alignmentCorpusHit = concordance
      .locator(".concordance-corpus-result")
      .filter({ hasText: alignmentCorpusName });
    await expect(sourceCorpusHit).toHaveCount(1);
    await expect(
      sourceCorpusHit.getByRole("button", { name: "Insert target" }),
    ).toHaveCount(0);
    await expect(alignmentCorpusHit).toHaveCount(1);
    await alignmentCorpusHit
      .getByRole("button", { name: "Insert target" })
      .click();
    await expect(
      page.locator(".segment-row").first().locator("textarea"),
    ).toHaveValue("2026 年发票已到期。");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Project insights" }).click();
    await page.getByRole("tab", { name: "Alignment / corpora" }).click();
    await page
      .getByRole("tab", { name: "Reference corpora", exact: true })
      .click();
    const removableCorpusRow = page
      .locator(".corpus-list-row")
      .filter({ hasText: fileCorpusName });
    await removableCorpusRow
      .getByRole("button", { name: `Remove ${fileCorpusName}` })
      .click();
    const removeDialog = page.getByRole("dialog", {
      name: `Remove ${fileCorpusName}`,
    });
    await expect(removeDialog).toBeVisible();
    await expect(
      removeDialog.getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(removeDialog).toHaveCount(0);
    await removableCorpusRow
      .getByRole("button", { name: `Remove ${fileCorpusName}` })
      .click();
    await page
      .getByRole("dialog", { name: `Remove ${fileCorpusName}` })
      .getByRole("button", { name: "Remove corpus", exact: true })
      .click();
    await expect(page.locator(".surface-success")).toContainText(
      `${fileCorpusName} was removed from retrieval`,
    );
    await page.getByLabel("Status").selectOption("removed");
    await expect(
      page.locator(".corpus-list-row").filter({ hasText: fileCorpusName }),
    ).toContainText("removed");
    await page.getByLabel("Status").selectOption("active");
    await expect(
      page.locator(".corpus-list-row").filter({ hasText: alignmentCorpusName }),
    ).toHaveCount(1);

    expect(aiFixture.requestCount).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await aiFixture.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("keeps a 10,000 segment document inside the virtual row and 60-second performance budget", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(150_000);
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "translunar-10k-"));
  const source = join(fixtureDirectory, "ten-thousand.txt");
  writeFileSync(
    source,
    Array.from(
      { length: 10_000 },
      (_, index) => `Segment ${String(index).padStart(5, "0")} benchmark text.`,
    ).join("\n\n"),
  );
  const harness = await launchHarness("virtual-10k", source);
  const { page, consoleErrors } = harness;

  try {
    await importFixture(page, "ten-thousand.txt", 60_000);
    await expect(page.locator(".document-switcher")).toContainText(
      "10000 segments",
    );
    await expect
      .poll(() => page.locator(".segment-row").count())
      .toBeLessThanOrEqual(100);
    await expect
      .poll(() => page.locator(".segment-row").count())
      .toBeGreaterThan(0);

    await page.locator(".segment-grid").evaluate((element) => {
      element.scrollTop = 620_000;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect
      .poll(async () =>
        Number(await page.locator(".id-cell").first().textContent()),
      )
      .toBeGreaterThan(1_000);
    await expect
      .poll(() => page.locator(".segment-row").count())
      .toBeLessThanOrEqual(100);

    const performanceEvidence = await page.evaluate(async () => {
      const grid = document.querySelector<HTMLElement>(".segment-grid");
      if (!grid) throw new Error("Segment grid was not mounted.");
      const durationMs = 60_000;
      const frameDeltas: number[] = [];
      const heapSamples: number[] = [];
      let maxMountedRows = 0;
      let frame = 0;
      const startedAt = performance.now();
      let previousFrameAt = startedAt;
      const memory = () =>
        (
          performance as Performance & {
            memory?: { usedJSHeapSize: number };
          }
        ).memory?.usedJSHeapSize;

      return await new Promise<{
        durationMs: number;
        frameCount: number;
        frameP95Ms: number;
        frameMaxMs: number;
        maxMountedRows: number;
        heapSampleCount: number;
        baselineHeapBytes: number | null;
        peakHeapBytes: number | null;
        finalHeapBytes: number | null;
        peakHeapGrowthBytes: number | null;
        finalHeapGrowthBytes: number | null;
      }>((resolvePerformance) => {
        const sample = () => {
          maxMountedRows = Math.max(
            maxMountedRows,
            document.querySelectorAll(".segment-row").length,
          );
          const usedHeap = memory();
          if (usedHeap !== undefined) heapSamples.push(usedHeap);
        };
        sample();
        const tick = (now: number) => {
          frameDeltas.push(now - previousFrameAt);
          previousFrameAt = now;
          frame += 1;
          if (frame % 30 === 0) {
            const elapsedRatio = Math.min(1, (now - startedAt) / durationMs);
            const wave = (Math.sin(elapsedRatio * Math.PI * 12) + 1) / 2;
            grid.scrollTop = wave * (grid.scrollHeight - grid.clientHeight);
            grid.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
          if (frame % 60 === 0) sample();
          if (now - startedAt < durationMs) {
            requestAnimationFrame(tick);
            return;
          }
          sample();
          const sortedFrames = [...frameDeltas].sort(
            (left, right) => left - right,
          );
          const p95Index = Math.max(
            0,
            Math.ceil(sortedFrames.length * 0.95) - 1,
          );
          const baselineHeap = heapSamples[0] ?? null;
          const peakHeap = heapSamples.length ? Math.max(...heapSamples) : null;
          const finalHeap = heapSamples.at(-1) ?? null;
          resolvePerformance({
            durationMs: now - startedAt,
            frameCount: frameDeltas.length,
            frameP95Ms: sortedFrames[p95Index] ?? 0,
            frameMaxMs: sortedFrames.at(-1) ?? 0,
            maxMountedRows,
            heapSampleCount: heapSamples.length,
            baselineHeapBytes: baselineHeap,
            peakHeapBytes: peakHeap,
            finalHeapBytes: finalHeap,
            peakHeapGrowthBytes:
              baselineHeap === null || peakHeap === null
                ? null
                : peakHeap - baselineHeap,
            finalHeapGrowthBytes:
              baselineHeap === null || finalHeap === null
                ? null
                : finalHeap - baselineHeap,
          });
        };
        requestAnimationFrame(tick);
      });
    });
    expect(performanceEvidence.durationMs).toBeGreaterThanOrEqual(60_000);
    expect(performanceEvidence.frameP95Ms).toBeLessThan(33);
    expect(performanceEvidence.maxMountedRows).toBeLessThanOrEqual(120);
    expect(performanceEvidence.heapSampleCount).toBeGreaterThan(0);
    expect(performanceEvidence.peakHeapGrowthBytes).not.toBeNull();
    expect(performanceEvidence.peakHeapGrowthBytes ?? Infinity).toBeLessThan(
      128 * 1024 * 1024,
    );
    expect(performanceEvidence.finalHeapGrowthBytes).not.toBeNull();
    expect(performanceEvidence.finalHeapGrowthBytes ?? Infinity).toBeLessThan(
      64 * 1024 * 1024,
    );
    await testInfo.attach("renderer-60-second-performance", {
      body: JSON.stringify(performanceEvidence, null, 2),
      contentType: "application/json",
    });

    await page.getByLabel("Search in document").fill("Segment 09999");
    await expect(page.locator(".segment-row")).toHaveCount(1);
    await expect(page.locator(".segment-row").first()).toContainText(
      "Segment 09999 benchmark text.",
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("keeps panel motion, geometry, and Windows rendering coherent", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const harness = await launchHarness("visual");
  const { application, page, consoleErrors } = harness;

  try {
    await importFixture(page);
    await resizeWindow(application, 1920, 1080);
    await page.waitForTimeout(180);

    const suggestions = page.locator(".suggestions-panel");
    const expandedWidth = (await suggestions.boundingBox())?.width ?? 0;
    await page.getByRole("button", { name: "Collapse Suggestions" }).click();
    await page.waitForTimeout(80);
    const collapsingWidth = (await suggestions.boundingBox())?.width ?? 0;
    expect(collapsingWidth).toBeGreaterThan(48);
    expect(collapsingWidth).toBeLessThan(expandedWidth);
    await waitForPanelMotion(page);
    expect((await suggestions.boundingBox())?.width).toBeCloseTo(48, 0);
    await expect(
      page.getByRole("button", { name: "Open Suggestions" }),
    ).toBeFocused();

    await page.getByRole("button", { name: "Open Suggestions" }).click();
    await page.waitForTimeout(80);
    const expandingWidth = (await suggestions.boundingBox())?.width ?? 0;
    expect(expandingWidth).toBeGreaterThan(48);
    expect(expandingWidth).toBeLessThan(expandedWidth);
    await waitForPanelMotion(page);
    expect((await suggestions.boundingBox())?.width).toBeCloseTo(
      expandedWidth,
      0,
    );
    await expect(
      page.getByRole("button", { name: "Collapse Suggestions" }),
    ).toBeFocused();

    const previewResizer = page.getByRole("separator", {
      name: "Resize document preview",
    });
    await previewResizer.focus();
    await previewResizer.press("End");
    await waitForPanelMotion(page);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeCloseTo(320, 0);
    await previewResizer.press("Home");
    await waitForPanelMotion(page);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeCloseTo(120, 0);
    for (let index = 0; index < 10; index += 1) {
      await previewResizer.press("ArrowUp");
    }
    await waitForPanelMotion(page);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeCloseTo(200, 0);
    await page.getByLabel("Follow active segment").uncheck();
    await expect(page.getByLabel("Follow active segment")).not.toBeChecked();
    await page.getByLabel("Follow active segment").check();

    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/workbench-default-${viewport.label}.png`,
      });

      if (viewport.width === 1250) {
        await page.getByRole("tab", { name: /Assistant/u }).click();
        await page.screenshot({
          path: `test-results/workbench-assistant-${viewport.label}.png`,
        });
        const assistantOverflow = await page
          .locator(".assistant-transcript")
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(assistantOverflow).toBeLessThanOrEqual(1);
        await page.getByRole("tab", { name: /^Matches/u }).click();
      }

      await page.getByRole("button", { name: "Collapse Suggestions" }).click();
      await waitForPanelMotion(page);
      await page.screenshot({
        path: `test-results/suggestions-collapsed-${viewport.label}.png`,
      });
      await page.getByRole("button", { name: "Open Suggestions" }).click();
      await waitForPanelMotion(page);

      await page.getByRole("button", { name: "Maximize Suggestions" }).click();
      await waitForPanelMotion(page);
      expect(
        (await page.locator(".editor-region").boundingBox())?.width,
      ).toBeLessThan(2);
      await page.screenshot({
        path: `test-results/suggestions-maximized-${viewport.label}.png`,
      });
      if (viewport.width === 1920) {
        await page.getByRole("tab", { name: /Assistant/u }).click();
        await page.screenshot({
          path: "test-results/suggestions-maximized-assistant-1920x1080.png",
        });
        await page.getByRole("tab", { name: /^Matches/u }).click();
      }
      await page.getByRole("button", { name: "Restore Suggestions" }).click();
      await waitForPanelMotion(page);

      await page.getByRole("button", { name: "Collapse preview" }).click();
      await waitForPanelMotion(page);
      expect(
        (await page.locator(".document-preview").boundingBox())?.height,
      ).toBeLessThanOrEqual(33);
      await expect(
        page.getByRole("button", { name: "Open preview" }),
      ).toBeFocused();
      await page.screenshot({
        path: `test-results/preview-collapsed-${viewport.label}.png`,
      });
      await page.getByRole("button", { name: "Open preview" }).click();
      await waitForPanelMotion(page);

      await page.getByRole("button", { name: "Maximize preview" }).click();
      await waitForPanelMotion(page);
      expect(
        (await page.locator(".segment-grid").boundingBox())?.height,
      ).toBeLessThan(2);
      await page.screenshot({
        path: `test-results/preview-maximized-${viewport.label}.png`,
      });
      await page.getByRole("button", { name: "Restore preview" }).click();
      await waitForPanelMotion(page);

      const editorBox = await page.locator(".editor-region").boundingBox();
      const suggestionsBox = await suggestions.boundingBox();
      expect(
        editorBox &&
          suggestionsBox &&
          editorBox.x + editorBox.width <= suggestionsBox.x + 1,
      ).toBeTruthy();
      await expect(page.locator(".segment-row").first()).toHaveClass(/active/u);
    }

    const renderingEvidence = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const suggestionsTitle = document.querySelector(
        ".suggestions-header > strong",
      );
      const panel = document.querySelector(".suggestions-panel");
      const panelBox = panel?.getBoundingClientRect();
      return {
        devicePixelRatio: window.devicePixelRatio,
        bodyFontFamily: bodyStyle.fontFamily,
        bodyTextRendering: bodyStyle.textRendering,
        segoeAvailable: document.fonts.check('14px "Segoe UI"'),
        yaheiAvailable: document.fonts.check('14px "Microsoft YaHei UI"'),
        suggestionsTitleAfter: suggestionsTitle
          ? getComputedStyle(suggestionsTitle, "::after").content
          : null,
        suggestionsX: panelBox?.x ?? null,
        suggestionsWidth: panelBox?.width ?? null,
      };
    });
    expect(renderingEvidence.devicePixelRatio).toBeGreaterThan(0);
    expect(renderingEvidence.bodyFontFamily).toContain("Segoe UI");
    expect(renderingEvidence.suggestionsTitleAfter).toBe("none");
    expect(renderingEvidence.suggestionsWidth).toBeCloseTo(400, 0);
    await testInfo.attach("rendering-evidence", {
      body: JSON.stringify(renderingEvidence, null, 2),
      contentType: "application/json",
    });
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});
