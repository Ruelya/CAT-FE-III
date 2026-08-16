// Format matrix gate: import one realistic file per supported format through
// the real engine, translate every segment, confirm, run QA, export, and check
// the produced file. Reports per format so a regression in one filter cannot
// hide behind another passing.
import { createRequire } from "node:module";
import { mkdtemp, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop/package.json"),
);
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const FIXTURE_DIR = join(repoRoot, "fixtures", "formats");

const FIXTURES = [
  { format: "txt", file: join(FIXTURE_DIR, "real.txt") },
  { format: "md", file: join(FIXTURE_DIR, "real.md") },
  { format: "html", file: join(FIXTURE_DIR, "real.html") },
  { format: "xliff", file: join(FIXTURE_DIR, "real.xlf") },
  { format: "sdlxliff", file: join(FIXTURE_DIR, "real.sdlxliff") },
  { format: "mqxliff", file: join(FIXTURE_DIR, "real.mqxliff") },
  { format: "docx", file: join(FIXTURE_DIR, "real.docx") },
  { format: "xlsx", file: join(FIXTURE_DIR, "real.xlsx") },
  { format: "pptx", file: join(FIXTURE_DIR, "real.pptx") },
];

const results = [];

for (const fixture of FIXTURES) {
  const userData = await mkdtemp(join(tmpdir(), `tl-fmt-${fixture.format}-`));
  const outPath = join(userData, `out.${fixture.format}`);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.TRANSLUNAR_TEST_USER_DATA = userData;
  env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
  env.TRANSLUNAR_TEST_SOURCE = fixture.file;
  env.TRANSLUNAR_TEST_SOURCE_FILES = fixture.file;
  env.TRANSLUNAR_TEST_EXPORT_DIRECTORY = userData;
  env.TRANSLUNAR_TEST_EXPORT_DOCX = outPath;

  const record = { format: fixture.format };
  let app;
  try {
    app = await electron.launch({
      executablePath: electronExecutable,
      args: ["."],
      cwd: desktopRoot,
      env,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await app.evaluate(async ({ BrowserWindow }) => {
      const [w] = BrowserWindow.getAllWindows();
      w.setContentSize(1680, 942);
    });

    await page.getByTestId("welcome").waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByLabel("Name").fill(`Fmt ${fixture.format}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByTestId("import-document").waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Choose files" }).click();
    await page.getByTestId("workbench").waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);

    // Everything below talks to the engine directly so the measurement is of
    // the pipeline, not of the grid's click targets.
    const state = await page.evaluate(async () => {
      const api = window.translunar;
      const projects = await api.invoke("project.list", {
        offset: 0,
        limit: 10,
      });
      const project = projects.items[0];
      const docs = await api.invoke("document.list", {
        projectId: project.id,
        offset: 0,
        limit: 50,
      });
      const doc = docs.items[0];
      const rows = await api.invoke("segment.editor.list", {
        documentId: doc.id,
        offset: 0,
        limit: 500,
      });
      return {
        projectId: project.id,
        documentId: doc.id,
        rows: rows.items.map((r) => ({
          id: r.segment.id,
          rev: r.segment.revision,
          src: r.segment.sourceText,
          sourceTags: r.sourceTags ?? [],
          tags: (r.sourceTags ?? []).length,
          labels: [...new Set((r.sourceTags ?? []).map((t) => t.displayText))],
        })),
      };
    });

    record.segments = state.rows.length;
    record.taggedSegments = state.rows.filter((r) => r.tags > 0).length;
    record.tagLabels = [...new Set(state.rows.flatMap((r) => r.labels))].sort();

    // Translate + confirm every segment through the engine.
    const outcome = await page.evaluate(async (snapshot) => {
      const api = window.translunar;
      let confirmed = 0;
      const failures = [];
      for (const row of snapshot.rows) {
        try {
          const targetText = `[zh] ${row.src}`;
          const saved = await api.invoke("segment.updateTarget", {
            segmentId: row.id,
            expectedRevision: row.rev,
            targetText,
          });
          let revision = saved.revision;
          if (row.sourceTags.length > 0) {
            const sourceLen = Math.max([...row.src].length, 1);
            const targetLen = [...targetText].length;
            const targetTags = row.sourceTags.map((tag, index) => ({
              ...tag,
              id: `placed-${index}:${tag.id}`,
              side: "target",
              position: Math.min(
                targetLen,
                Math.round((tag.position * targetLen) / sourceLen),
              ),
              protected: true,
            }));
            const tagged = await api.invoke("segment.tag.set", {
              segmentId: row.id,
              expectedRevision: revision,
              targetTags,
            });
            const current = tagged.rows.find((item) => item.segment.id === row.id);
            if (current) revision = current.segment.revision;
          }
          await api.invoke("segment.confirm", {
            segmentId: row.id,
            expectedRevision: revision,
          });
          confirmed += 1;
        } catch (error) {
          // A segment already carrying a propagated target is fine: re-read and
          // confirm it. Anything still failing is a real defect.
          try {
            const fresh = await api.invoke("segment.editor.list", {
              documentId: snapshot.documentId,
              offset: 0,
              limit: 500,
            });
            const current = fresh.items.find((i) => i.segment.id === row.id);
            if (current && current.segment.state !== "confirmed") {
              await api.invoke("segment.confirm", {
                segmentId: row.id,
                expectedRevision: current.segment.revision,
              });
            }
            confirmed += 1;
          } catch (retryError) {
            failures.push({
              src: row.src.slice(0, 40),
              error: String(retryError?.message ?? retryError).slice(0, 160),
            });
          }
        }
      }
      const gate = await api.invoke("qa.gate.check", {
        projectId: snapshot.projectId,
        documentId: snapshot.documentId,
      });
      return {
        confirmed,
        failures,
        gateClear: gate.clear,
        errors: gate.errorCount,
        warnings: gate.warningCount,
      };
    }, state);

    record.confirmed = `${outcome.confirmed}/${state.rows.length}`;
    record.confirmFailures = outcome.failures;
    record.gateClear = outcome.gateClear;
    record.qaErrors = outcome.errors;
    record.qaWarnings = outcome.warnings;

    // Export through the engine and inspect the artefact.
    const exportResult = await page.evaluate(
      async ({ documentId, outPath }) => {
        const api = window.translunar;
        try {
          const report = await api.invoke("document.export", {
            documentId,
            outputPath: outPath,
          });
          return { ok: true, report };
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) };
        }
      },
      { documentId: state.documentId, outPath },
    );

    if (exportResult.ok) {
      const info = await stat(outPath).catch(() => null);
      record.export = info ? `ok (${info.size} bytes)` : "reported ok, no file";
      record.degradation = (exportResult.report?.degradation ?? []).map(
        (d) => d.code,
      );
      if (
        ["txt", "md", "html", "xliff", "sdlxliff", "mqxliff"].includes(
          fixture.format,
        ) &&
        info
      ) {
        const text = await readFile(outPath, "utf8");
        record.targetPresent = text.includes("[zh]");
      } else if (info) {
        // OOXML packages are ZIPs: the text only exists inside the compressed
        // parts, so grepping the container proves nothing either way.
        const { execFileSync } = await import("node:child_process");
        try {
          const dumped = execFileSync(
            "python3",
            [
              "-c",
              "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);" +
                "print(any(b'[zh]' in z.read(n) for n in z.namelist()))",
              outPath,
            ],
            { encoding: "utf8" },
          ).trim();
          record.targetPresent = dumped === "True";
        } catch (error) {
          record.targetPresent = `unreadable: ${String(error).slice(0, 80)}`;
        }
      }
    } else {
      record.export = `BLOCKED: ${exportResult.error.slice(0, 120)}`;
    }
  } catch (error) {
    record.fatal = String(error).slice(0, 200);
  } finally {
    if (app) await app.close().catch(() => undefined);
  }
  results.push(record);
  console.log(JSON.stringify(record));
}

await writeFile(
  join(repoRoot, "format-matrix.json"),
  JSON.stringify(results, null, 2),
);

console.log("\n=== FORMAT MATRIX ===");
let failed = 0;
for (const r of results) {
  const verdict =
    r.fatal || !r.export || String(r.export).startsWith("BLOCKED")
      ? "FAIL"
      : r.confirmed && r.confirmed.split("/")[0] !== r.confirmed.split("/")[1]
        ? "PARTIAL"
        : r.targetPresent !== true
          ? "EXPORT-NO-TARGET"
          : "PASS";
  if (verdict !== "PASS") failed += 1;
  console.log(
    `${verdict.padEnd(17)} ${r.format.padEnd(8)} segs=${r.segments ?? "?"} tagged=${r.taggedSegments ?? "?"} labels=${JSON.stringify(r.tagLabels ?? [])} confirmed=${r.confirmed ?? "?"} gateClear=${r.gateClear} qa=${r.qaErrors}E/${r.qaWarnings}W export=${r.export ?? r.fatal}`,
  );
}
if (failed > 0) {
  console.error(
    `\n${failed} of ${results.length} formats did not complete the round trip.`,
  );
  process.exitCode = 1;
}
