import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";
import { errors as playwrightErrors } from "playwright";

import type { DesktopApi } from "../../src/shared/desktop-api.js";

type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;

const SESSION_KEY = "translunar.active-workspace.v1";

interface CrashHarness {
  application: ElectronApplication;
  page: Page;
  dataDirectory: string;
  consoleErrors: string[];
  close: () => Promise<void>;
}

/**
 * Launch the desktop app against the real Rust Engine with the opt-in,
 * main-process-only crash seam enabled. `close()` always stops the app first
 * so the Engine child releases the SQLite/WAL handles; only then is the data
 * directory removed (with a bounded Windows retry for lingering locks).
 */
async function launchWithCrashSeam(
  label: string,
  existingDataDirectory?: string,
): Promise<CrashHarness> {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory =
    existingDataDirectory ??
    mkdtempSync(join(tmpdir(), `translunar-crash-${label}-`));
  const userData = join(dataDirectory, "electron-user-data");
  const fixture = join(workspaceRoot, "fixtures", "docx", "m0-source.docx");
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
  const sourceDelimiter = process.platform === "win32" ? ";" : ":";
  const consoleErrors: string[] = [];

  const application = await electron.launch({
    args: ["--no-sandbox", `--user-data-dir=${userData}`, "."],
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      TRANSLUNAR_DATA_DIR: dataDirectory,
      TRANSLUNAR_ENGINE_PATH: engine,
      TRANSLUNAR_TEST_SOURCE: fixture,
      TRANSLUNAR_TEST_SOURCE_FILES: [fixture].join(sourceDelimiter),
      TRANSLUNAR_E2E_ENGINE_CRASH_SEAM: "1",
    },
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await application.close();
    if (!existingDataDirectory) {
      await removeDirectoryWithRetry(dataDirectory);
    }
  };

  try {
    const page = await application.firstWindow();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await dismissFirstRunTutorial(page);

    return { application, page, dataDirectory, consoleErrors, close };
  } catch (error) {
    // Partial launch: electron.launch() already spawned a live app and Engine
    // child, but firstWindow/tutorial setup threw before a harness was
    // returned, so no caller can close it. Tear down here (app first so the
    // Engine releases its handles, then the temp data directory we created)
    // before rethrowing, or the process and directory leak.
    await close().catch(() => undefined);
    throw error;
  }
}

/**
 * Windows can hold a brief lock on translunar.sqlite3 immediately after the
 * Engine child exits. Retry a bounded number of times after the app has been
 * closed; this does not hide a leak because `close()` awaits app shutdown.
 */
async function removeDirectoryWithRetry(directory: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function dismissFirstRunTutorial(page: Page): Promise<void> {
  const tutorial = page.getByRole("dialog", {
    name: /First-run tutorial|首次使用教程/i,
  });
  try {
    await tutorial.waitFor({ state: "visible", timeout: 8_000 });
  } catch (error: unknown) {
    if (error instanceof playwrightErrors.TimeoutError) return;
    throw error;
  }
  await tutorial.getByRole("button", { name: /^(Skip|跳过)$/i }).click();
  await expect(tutorial).toHaveCount(0);
}

interface WorkspaceIds {
  projectId: string;
  documentId: string;
}

/** Import the fixture project through the real setup wizard and Engine. */
async function importProjectAndDocument(page: Page): Promise<WorkspaceIds> {
  await expect(
    page.getByRole("heading", { name: /Continue translating|继续翻译/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("button", { name: /New project|新建项目/i })
    .first()
    .click();
  const continueButton = page.getByRole("button", {
    name: /^(Continue|继续)$/,
  });
  await continueButton.click();
  await continueButton.click();
  await page.getByRole("button", { name: /^(Add files|添加文件)$/ }).click();
  await expect(page.getByText("m0-source.docx", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page
    .getByRole("button", { name: /^(Create project|创建项目)$/ })
    .click();
  await expect(
    page.getByRole("region", { name: /Translation segments|翻译句段/ }),
  ).toBeVisible({ timeout: 15_000 });

  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("No active session after import.");
    return JSON.parse(raw) as { projectId: string; documentId: string };
  }, SESSION_KEY);
}

interface SegmentView {
  id: string;
  revision: number;
  state: string;
  targetText: string;
}

/** List the first N segments through the real Engine via the renderer bridge. */
async function listSegments(
  page: Page,
  documentId: string,
  limit = 10,
): Promise<SegmentView[]> {
  return page.evaluate(
    async ({ docId, max }) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const segments = await api.invoke("segment.list", {
        documentId: docId,
        offset: 0,
        limit: max,
      });
      return segments.items.map((item) => ({
        id: item.id,
        revision: item.revision,
        state: item.state,
        targetText: item.targetText,
      }));
    },
    { docId: documentId, max: limit },
  );
}

/** Force-kill the live Engine child through the main-only E2E seam. */
async function killEngine(application: ElectronApplication): Promise<boolean> {
  return application.evaluate(() => {
    const global = globalThis as typeof globalThis & {
      __translunarE2E?: { forceKillEngine: () => boolean };
    };
    return global.__translunarE2E?.forceKillEngine() ?? false;
  });
}

/** Read the live Engine child PID through the main-only E2E seam. */
async function enginePid(
  application: ElectronApplication,
): Promise<number | null> {
  return application.evaluate(() => {
    const global = globalThis as typeof globalThis & {
      __translunarE2E?: { getEnginePid: () => number | null };
    };
    return global.__translunarE2E?.getEnginePid() ?? null;
  });
}

/** Read the OS clipboard through Electron main, not renderer permissions. */
async function readMainClipboard(
  application: ElectronApplication,
): Promise<string> {
  return application.evaluate(({ clipboard }) => clipboard.readText());
}

interface JournalRecordView {
  segmentId: string;
  targetText: string;
  expectedRevision: number;
}

/** Read every draft-journal record through the main-owned journal API. */
async function readJournal(page: Page): Promise<JournalRecordView[]> {
  return page.evaluate(async () => {
    const api = (window as unknown as { translunar: DesktopApi }).translunar;
    const snapshot = await api.getDraftJournal();
    return snapshot.records.map((item) => ({
      segmentId: item.segmentId,
      targetText: item.targetText,
      expectedRevision: item.expectedRevision,
    }));
  });
}

/** Poll the main-owned journal until a segment record matches exactly. */
async function waitForJournalRecord(
  page: Page,
  segmentId: string,
  targetText: string,
): Promise<JournalRecordView> {
  return expectPoll(async () => {
    const records = await readJournal(page);
    const found = records.find((item) => item.segmentId === segmentId);
    if (!found || found.targetText !== targetText) {
      throw new Error(
        `Journal record for ${segmentId} not durable yet (got ${
          found ? JSON.stringify(found.targetText) : "none"
        }).`,
      );
    }
    return found;
  });
}

/** Poll an async assertion until it resolves without throwing, or time out. */
async function expectPoll<T>(
  probe: () => Promise<T>,
  { timeout = 8_000, interval = 100 } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  for (;;) {
    try {
      return await probe();
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await delay(interval);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("Engine crash recovery: kill, bounded reconnect, projection reload, draft restore/copy/discard", async () => {
  const harness = await launchWithCrashSeam("full-recovery");
  const { application, page, consoleErrors, close } = harness;

  const reconnectingBanner = page.locator(".engine-status-banner", {
    hasText: /reconnecting|重新连接/i,
  });
  const reconnectedBanner = page.locator(".engine-status-banner", {
    hasText: /reconnected|已重连/i,
  });
  const draftDialog = page.getByRole("dialog", {
    name: /draft|草稿|recovery|恢复/i,
  });

  try {
    // Requirement 1: real import through the setup wizard and Engine.
    const { projectId, documentId } = await importProjectAndDocument(page);
    const segments = await listSegments(page, documentId);
    const firstId = segments[0]?.id;
    const secondId = segments[1]?.id;
    expect(firstId, "first segment id").toBeTruthy();
    expect(secondId, "second segment id").toBeTruthy();
    if (!firstId || !secondId) throw new Error("Missing fixture segments.");

    // Requirement 1: capture the live Engine PID through the main-only seam.
    const pidBeforeCrash = await enginePid(application);
    expect(pidBeforeCrash, "Engine PID before crash").toBeGreaterThan(0);

    // Requirement 3: create a controlled authoritative Engine-side change that
    // the mounted React tree has NOT applied. Do this BEFORE the final UI draft
    // input so the 650ms debounced save cannot fire during this out-of-band
    // step and clear the journal we are about to write.
    await page.evaluate(async (segId: string) => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      const list = await api.invoke("segment.list", {
        documentId: (
          JSON.parse(
            localStorage.getItem("translunar.active-workspace.v1") ?? "{}",
          ) as { documentId: string }
        ).documentId,
        offset: 0,
        limit: 10,
      });
      const target = list.items.find((item) => item.id === segId);
      if (!target) throw new Error("Second segment vanished before change.");
      const saved = await api.invoke("segment.updateTarget", {
        segmentId: segId,
        targetText: "Confirmed target before crash",
        expectedRevision: target.revision,
      });
      await api.invoke("segment.confirm", {
        segmentId: segId,
        expectedRevision: saved.revision,
      });
    }, secondId);

    // The mounted Workbench must still show the pre-change (empty) target for
    // the second segment: it has not reloaded the authoritative projection yet.
    const secondEditor = page.locator(`[data-editor-for="${secondId}"]`);
    await expect(secondEditor).toHaveValue("");

    // Requirement 4: an editor input is journaled at the input boundary, before
    // the debounced Engine mutation. Type into the first segment, then poll the
    // main-owned journal until the exact record is durable.
    const firstEditor = page.locator(`[data-editor-for="${firstId}"]`);
    await firstEditor.click();
    await firstEditor.fill("Draft text before crash");
    const journaled = await waitForJournalRecord(
      page,
      firstId,
      "Draft text before crash",
    );

    // Requirement 2: kill the live child immediately after the journal record
    // is observed, before the 650ms debounced Engine mutation can fire and
    // clear it. No extra RPC round-trip is issued between the observation and
    // the kill so the debounce window is not consumed.
    expect(await killEngine(application), "kill seam").toBe(true);

    // Prove the journal write preceded the Engine mutation: the record was
    // captured at the first segment's pre-crash authoritative revision, and the
    // pre-input Engine target (fetched before any draft input) was not the
    // draft text. The debounced save never reached the killed Engine.
    const firstBefore = segments.find((item) => item.id === firstId);
    expect(firstBefore?.targetText).not.toBe("Draft text before crash");
    expect(journaled.expectedRevision).toBe(firstBefore?.revision);

    // Requirement 2 + 7: bounded, observable reconnect status.
    await expect(reconnectingBanner).toBeVisible({ timeout: 10_000 });
    await expect(reconnectedBanner).toBeVisible({ timeout: 20_000 });

    // Requirement 2: replacement child is a different, non-null PID.
    const pidAfterReconnect = await expectPoll(async () => {
      const pid = await enginePid(application);
      if (pid === null || pid === pidBeforeCrash) {
        throw new Error(`Engine PID not yet replaced (got ${String(pid)}).`);
      }
      return pid;
    });
    expect(pidAfterReconnect, "replacement PID").toBeGreaterThan(0);
    expect(pidAfterReconnect).not.toBe(pidBeforeCrash);

    // Requirement 3: the still-mounted Workbench replaced its stale projection
    // WITHOUT page.reload(). The second segment's editor now shows the
    // authoritative confirmed target created out-of-band before the crash.
    await expect(secondEditor).toHaveValue("Confirmed target before crash", {
      timeout: 20_000,
    });

    // Requirement 4: the mounted DraftRecoveryDialog opens after reconnect.
    await expect(draftDialog).toBeVisible({ timeout: 10_000 });
    await expect(
      draftDialog.getByText("Draft text before crash"),
    ).toBeVisible();

    // Requirement 5: a non-stale restore applies through segment.updateTarget
    // with the expected revision, clears the journal, refreshes the workspace,
    // and shows the restored target in the mounted editor.
    const restoreButton = draftDialog.getByRole("button", {
      name: /^(Restore|恢复)$/,
    });
    await expect(restoreButton).toBeEnabled();
    await restoreButton.click();
    await expect(draftDialog).toHaveCount(0, { timeout: 5_000 });

    await expect(firstEditor).toHaveValue("Draft text before crash", {
      timeout: 10_000,
    });
    await expectPoll(async () => {
      const engineAfter = await listSegments(page, documentId);
      const first = engineAfter.find((item) => item.id === firstId);
      if (first?.targetText !== "Draft text before crash") {
        throw new Error("Engine target not yet restored.");
      }
    });
    const journalAfterRestore = await readJournal(page);
    expect(
      journalAfterRestore.some((item) => item.segmentId === firstId),
      "journal cleared after restore",
    ).toBe(false);

    // Requirement 6: a deliberately stale draft. Seed the journal record
    // through the real DesktopApi at the current revision, then advance the
    // Engine revision so the record is stale, then crash to re-inspect.
    const restored = await listSegments(page, documentId);
    const firstRestored = restored.find((item) => item.id === firstId);
    expect(firstRestored, "first segment after restore").toBeTruthy();
    if (!firstRestored) throw new Error("Missing first segment after restore.");
    const staleExpectedRevision = firstRestored.revision;

    await page.evaluate(
      async ({
        projId,
        docId,
        segId,
        expectedRevision,
      }: {
        projId: string;
        docId: string;
        segId: string;
        expectedRevision: number;
      }) => {
        const api = (window as unknown as { translunar: DesktopApi })
          .translunar;
        await api.writeDraftJournal({
          projectId: projId,
          documentId: docId,
          segmentId: segId,
          expectedRevision,
          targetText: "Seeded stale draft",
        });
        // Advance the authoritative Engine revision so the seeded record
        // becomes stale against the live segment.
        await api.invoke("segment.updateTarget", {
          segmentId: segId,
          targetText: "Authoritative text wins",
          expectedRevision,
        });
      },
      {
        projId: projectId,
        docId: documentId,
        segId: firstId,
        expectedRevision: staleExpectedRevision,
      },
    );

    expect(await killEngine(application), "second kill seam").toBe(true);
    await expect(reconnectingBanner).toBeVisible({ timeout: 10_000 });
    await expect(reconnectedBanner).toBeVisible({ timeout: 20_000 });

    // The dialog reopens with the seeded stale record flagged and restore
    // disabled (no-op).
    await expect(draftDialog).toBeVisible({ timeout: 10_000 });
    await expect(draftDialog.getByText("Seeded stale draft")).toBeVisible();
    await expect(
      draftDialog.locator(".surface-error", {
        hasText: /mismatch|stale|不匹配|过时|修订/i,
      }),
    ).toBeVisible();
    await expect(restoreButton).toBeDisabled();

    // Requirement 6: copy returns the draft text for review (read through
    // Electron main's clipboard, not renderer navigator permissions).
    await draftDialog
      .getByRole("button", { name: /^(Copy text|复制文本)$/ })
      .click();
    await expectPoll(async () => {
      const text = await readMainClipboard(application);
      if (text !== "Seeded stale draft") {
        throw new Error(`Clipboard not yet set (got ${JSON.stringify(text)}).`);
      }
    });

    // Requirement 6: discard removes only that journal record and preserves the
    // authoritative Engine text.
    await draftDialog.getByRole("button", { name: /^(Discard|丢弃)$/ }).click();
    await expect(draftDialog.getByText("Seeded stale draft")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expectPoll(async () => {
      const records = await readJournal(page);
      if (records.some((item) => item.segmentId === firstId)) {
        throw new Error("Stale journal record not yet discarded.");
      }
    });
    const finalEngine = await listSegments(page, documentId);
    expect(finalEngine.find((item) => item.id === firstId)?.targetText).toBe(
      "Authoritative text wins",
    );

    // Requirement 3 + 6: the still-mounted editor shows the authoritative text
    // (not the discarded stale draft and not the pre-crash value). This proves
    // the reconnect projection reload replaced the mounted UI, so the discard
    // evidence is visible in the DOM and not RPC-only.
    await expect(firstEditor).toHaveValue("Authoritative text wins", {
      timeout: 10_000,
    });

    // Requirement 7: no renderer console/page errors across the whole flow.
    expect(consoleErrors, "no renderer console/page errors").toEqual([]);
  } finally {
    await close();
  }
});

test("Engine data directory persists the draft journal across an app relaunch", async () => {
  const dataDirectory = mkdtempSync(
    join(tmpdir(), "translunar-crash-journal-persist-"),
  );
  const harnesses: CrashHarness[] = [];

  try {
    // First launch: import, journal an editor draft, and let it become durable.
    const first = await launchWithCrashSeam("journal-persist-1", dataDirectory);
    harnesses.push(first);
    const { documentId } = await importProjectAndDocument(first.page);
    const segments = await listSegments(first.page, documentId);
    const firstId = segments[0]?.id;
    expect(firstId, "first segment id").toBeTruthy();
    if (!firstId) throw new Error("Missing fixture segment.");

    const editor = first.page.locator(`[data-editor-for="${firstId}"]`);
    await editor.click();
    await editor.fill("Journal persistence test");
    await waitForJournalRecord(first.page, firstId, "Journal persistence test");

    // Kill the Engine immediately after the journal poll succeeds so the 650ms
    // debounced save RPC cannot fire and clear the journal. The test proves the
    // journal persists across app shutdown when the draft is unsaved; if the
    // debounced save completed before shutdown, the journal would (correctly)
    // be cleared and the relaunch dialog would never appear.
    expect(await killEngine(first.application), "kill before debounce").toBe(
      true,
    );

    // Stop the app cleanly; the journal file must remain on disk.
    await first.close();
    const journalPath = join(dataDirectory, ".desktop", "draft-journal.json");
    expect(existsSync(journalPath), "journal file persists").toBe(true);

    // Relaunch against the same data/user directories: the mounted recovery
    // dialog must surface the durable journal record.
    const second = await launchWithCrashSeam(
      "journal-persist-2",
      dataDirectory,
    );
    harnesses.push(second);
    const draftDialog = second.page.getByRole("dialog", {
      name: /draft|草稿|recovery|恢复/i,
    });
    await expect(draftDialog).toBeVisible({ timeout: 12_000 });
    await expect(
      draftDialog.getByText("Journal persistence test"),
    ).toBeVisible();
  } finally {
    // Close every launched harness, including partial-launch failures.
    for (const harness of harnesses) {
      await harness.close().catch(() => undefined);
    }
    await removeDirectoryWithRetry(dataDirectory);
  }
});
