// PDF import options + page review + OCR AI honesty, against a real Engine.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/desktop/package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const artifacts = "/opt/cursor/artifacts";
await mkdir(artifacts, { recursive: true });

const findings = [];
function note(step, verdict, detail) {
  findings.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step} :: ${detail}`);
}

const FIXTURE_CONTENT_LIST = [
  {
    type: "text",
    text: "Contract Title",
    text_level: 1,
    page_idx: 0,
    bbox: [100, 50, 900, 120],
  },
  {
    type: "text",
    text: "Article 1. Parties agree to the terms.",
    page_idx: 0,
    bbox: [100, 150, 900, 220],
  },
  {
    type: "table",
    table_caption: ["Schedule A"],
    table_body: "<table><tr><td>Item</td><td>Qty</td></tr></table>",
    page_idx: 1,
    bbox: [50, 100, 950, 400],
  },
];

function startMineruMock() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url?.startsWith("/file_parse")) {
        const body = JSON.stringify({
          backend: "pipeline",
          version: "test",
          results: { sample: { content_list: FIXTURE_CONTENT_LIST } },
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

async function launchApp(options) {
  const userData = await mkdtemp(join(tmpdir(), "tl-pdf-ocr-"));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = userData;
  env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
  env.TRANSLUNAR_TEST_SOURCE = options.sourcePath;
  env.TRANSLUNAR_TEST_SOURCE_FILES = options.sourcePath;
  env.TRANSLUNAR_MINERU_TEST_MODE = "1";
  if (options.mineruBaseUrl) {
    env.TRANSLUNAR_MINERU_BASE_URL = options.mineruBaseUrl;
    env.TRANSLUNAR_MINERU_TEST_MODE = "1";
    env.TRANSLUNAR_MINERU_TEST_API_KEY = "gate-key";
  }
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ["."],
    cwd: join(repoRoot, "apps/desktop"),
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(async ({ BrowserWindow }) => {
    const [w] = BrowserWindow.getAllWindows();
    w.setContentSize(1680, 942);
  });
  return { app, page, userData };
}

async function createAndImport(page, name, ocr) {
  await page.getByTestId("welcome").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByTestId("import-document").waitFor({ timeout: 30_000 });
  await page.getByTestId("import-ocr-options").waitFor();
  if (ocr?.engine) {
    await page.getByTestId("import-ocr-engine").selectOption(ocr.engine);
  }
  if (ocr?.mode) {
    await page.getByTestId("import-ocr-mode").selectOption(ocr.mode);
  }
  if (ocr?.languages) {
    await page.getByTestId("import-ocr-languages").fill(ocr.languages);
  }
  await page.getByRole("button", { name: "Choose files" }).click();
  await page.getByTestId("workbench").waitFor({ timeout: 90_000 });
}

async function runTextLayout() {
  const { app, page } = await launchApp({
    sourcePath: join(repoRoot, "fixtures/pdf/text-layout.pdf"),
  });
  try {
    await createAndImport(page, "TextPdf", { engine: "auto", mode: "auto" });
    await page.getByTestId("pdf-page-review").waitFor({ timeout: 60_000 });
    await page.getByTestId("pdf-page-image").waitFor({ timeout: 30_000 });
    note("text-pdf-dock", "WORKS", "PDF dock and page image mounted");

    const block = page.locator("[data-testid^='pdf-block-']").first();
    await block.waitFor({ timeout: 15_000 });
    const segmentId = (await block.getAttribute("data-testid"))?.replace(
      "pdf-block-",
      "",
    );
    await block.click();
    await page.waitForTimeout(400);
    const active = await page.locator(".segment-row--active").count();
    note(
      "click-block-selects-segment",
      active > 0 ? "WORKS" : "BUG",
      segmentId ? `selected ${segmentId}` : "no block id",
    );
    await page.screenshot({
      path: join(artifacts, "pdf_text_layout_dock.png"),
    });
  } finally {
    await app.close();
  }
}

async function runScannedOcr() {
  const { app, page } = await launchApp({
    sourcePath: join(repoRoot, "fixtures/pdf/scanned.pdf"),
  });
  try {
    await createAndImport(page, "ScanPdf", {
      engine: "tesseract",
      mode: "always",
      languages: "eng",
    });
    await page.getByTestId("pdf-page-review").waitFor({ timeout: 90_000 });
    const rows = page.locator("[data-testid^='segment-row-']");
    const empty = page.getByTestId("segments-empty");
    await Promise.race([
      rows.first().waitFor({ timeout: 30_000 }),
      empty.waitFor({ timeout: 30_000 }),
    ]).catch(() => undefined);
    const grid = await page.getByTestId("workbench").innerText();
    const hasInvoice = /INV-2048/i.test(grid);
    note(
      "scanned-ocr-text",
      hasInvoice ? "WORKS" : "BUG",
      hasInvoice ? "INV-2048 present" : grid.replace(/\s+/g, " ").slice(0, 240),
    );
    const ocrMarks = await page.locator("[data-testid^='mark-ocr-']").count();
    note(
      "ocr-row-mark",
      ocrMarks > 0 ? "WORKS" : "BUG",
      `${ocrMarks} OCR marks`,
    );

    const correct = page.locator("[data-testid^='pdf-correct-']").first();
    const correctCount = await page.locator("[data-testid^='pdf-correct-']").count();
    note(
      "ocr-correct-chip",
      correctCount > 0 ? "WORKS" : "BUG",
      `${correctCount} Correct chips`,
    );
    if (correctCount > 0) {
      await correct.click();
      await page.getByTestId("pdf-ocr-correct-dialog").waitFor({ timeout: 10_000 });
      await page.getByTestId("pdf-ocr-ai-no-profile").waitFor({ timeout: 10_000 });
      const saveDisabled = await page.getByTestId("pdf-ocr-save").isDisabled();
      note(
        "ocr-ai-honest",
        saveDisabled ? "WORKS" : "BUG",
        "no-profile shown; Save stays disabled without a reason",
      );
      await page.screenshot({
        path: join(artifacts, "pdf_ocr_ai_no_profile.png"),
      });
      await page.getByRole("button", { name: "Cancel" }).click();
    }

    // Stacked dock: AI is a tool chip in the memory pane, not a tab.
    await page
      .getByTestId("intel-dock")
      .getByRole("button", { name: /^AI/ })
      .click({ force: true });
    await page.waitForTimeout(400);
    const ocrNote = await page.getByTestId("ai-ocr-source-note").count();
    note(
      "intel-ocr-note",
      ocrNote > 0 ? "WORKS" : "INFO",
      ocrNote > 0
        ? "AI tab explains OCR source vs target"
        : "AI OCR note not on this row",
    );
    await page.screenshot({
      path: join(artifacts, "pdf_scanned_workbench.png"),
    });

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("product-settings").waitFor({ timeout: 15_000 });
    await page.getByTestId("settings-tab-ocr").click();
    await page.getByTestId("settings-ocr").waitFor();
    await page.getByTestId("settings-ocr-status").waitFor({ timeout: 15_000 });
    await page.getByTestId("settings-ocr-secret").fill("gate-secret");
    await page.getByTestId("settings-ocr-save").click();
    await page.waitForTimeout(400);
    const status = await page.getByTestId("settings-ocr-status").innerText();
    note(
      "settings-ocr",
      /stored/i.test(status) ? "WORKS" : "BUG",
      status.replace(/\s+/g, " ").slice(0, 200),
    );
    await page.screenshot({ path: join(artifacts, "settings_ocr.png") });
  } finally {
    await app.close();
  }
}

async function runMineruMock() {
  const mock = await startMineruMock();
  const { app, page } = await launchApp({
    sourcePath: join(repoRoot, "fixtures/pdf/text-layout.pdf"),
    mineruBaseUrl: mock.baseUrl,
  });
  try {
    await createAndImport(page, "MinerUPdf", {
      engine: "mineru",
      mode: "auto",
      languages: "eng",
    });
    await page.getByTestId("workbench").waitFor({ timeout: 90_000 });
    const rows = page.locator("[data-testid^='segment-row-']");
    await rows.first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    const grid = await page.getByTestId("workbench").innerText();
    const fromList =
      /Contract Title/.test(grid) && /Article 1/.test(grid);
    note(
      "mineru-mock-import",
      fromList ? "WORKS" : "BUG",
      fromList
        ? "content_list segments present"
        : grid.replace(/\s+/g, " ").slice(0, 240),
    );
    await page.screenshot({
      path: join(artifacts, "pdf_mineru_mock_import.png"),
    });
  } finally {
    await app.close();
    mock.server.close();
  }
}

await runTextLayout();
await runScannedOcr();
await runMineruMock();

const failed = findings.filter((f) => f.verdict === "BUG").length;
const report = {
  failed,
  findings,
};
await writeFile(
  join(artifacts, "pdf_ocr_ai_gate.json"),
  JSON.stringify(report, null, 2),
);
console.log(`\n=== PDF OCR AI: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`);
process.exit(failed === 0 ? 0 : 1);
