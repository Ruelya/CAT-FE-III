import { describe, expect, it } from "vitest";

import {
  listDialogMessageKeys,
  dialogTitle,
  normalizeDialogLocale,
} from "../../shared/dialog-messages";
import {
  catalogDiagnostics,
  formatBytes,
  formatDate,
  formatMessage,
  formatNumber,
  listLocales,
  listMessageKeys,
  normalizeLocale,
  t,
} from "./messages";

describe("desktop i18n catalogs", () => {
  it("normalizes zh locales", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en-US");
  });

  it("keeps equal non-empty key sets for en-US and zh-CN", () => {
    const keys = listMessageKeys();
    expect(keys.length).toBeGreaterThan(40);
    for (const locale of listLocales()) {
      expect(catalogDiagnostics(locale)).toEqual([]);
      for (const key of keys) {
        expect(formatMessage(locale, key).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("formats interpolation, plural, date, and number values", () => {
    expect(
      formatMessage("en-US", "update.available", { version: "1.2.3" }),
    ).toContain("1.2.3");
    expect(formatMessage("en-US", "plural.backup", { count: 1 })).toBe(
      "1 backup",
    );
    expect(formatMessage("en-US", "plural.backup", { count: 3 })).toBe(
      "3 backups",
    );
    expect(formatMessage("zh-CN", "plural.draft", { count: 2 })).toContain("2");
    expect(formatNumber("en-US", 12345)).toMatch(/12/);
    expect(formatBytes("en-US", 2048)).toMatch(/KB/);
    expect(formatBytes("en-US", 2048)).not.toMatch(/大小/);
    const stamped = formatDate("en-US", new Date("2026-07-24T12:00:00Z"), {
      dateStyle: "medium",
    });
    expect(stamped.length).toBeGreaterThan(0);
  });

  it("uses meaningful Chinese product copy, not English placeholders", () => {
    expect(t("zh-CN", "action.settings")).toBe("设置");
    expect(t("zh-CN", "tutorial.welcomeTitle")).toContain("欢迎");
    expect(t("zh-CN", "backup.reminder")).toContain("备份");
    expect(t("zh-CN", "settings.dataDirectory")).toBe("数据目录");
    expect(t("zh-CN", "action.backup")).not.toBe(t("en-US", "action.backup"));
    expect(t("zh-CN", "restore.previewTitle")).toBe("恢复预览");
    expect(t("zh-CN", "action.confirmRestore")).toBe("确认恢复");
    expect(t("zh-CN", "nav.home")).toBe("首页");
    expect(t("zh-CN", "dialog.selectSource")).toBe("导入源文档");
  });

  it("covers update recovery keys bilingually", () => {
    expect(t("en-US", "action.rollbackUpdate")).toMatch(/backup/i);
    expect(t("zh-CN", "action.rollbackUpdate")).toContain("备份");
    expect(t("zh-CN", "action.openInstaller")).toContain("安装包");
    expect(t("zh-CN", "action.rollbackUpdate")).not.toBe(
      t("en-US", "action.rollbackUpdate"),
    );
    expect(
      formatMessage("en-US", "update.recoveryRequired", { detail: "health" }),
    ).toContain("health");
    expect(t("zh-CN", "update.manualInstallerOpened")).toContain("手动");
    expect(t("zh-CN", "update.notConfigured")).toContain("更新源");
  });

  it("covers dialog catalog keys in both locales", () => {
    const dialogKeys = listDialogMessageKeys();
    expect(dialogKeys.length).toBeGreaterThan(10);
    expect(normalizeDialogLocale("zh-Hans")).toBe("zh-CN");
    for (const key of dialogKeys) {
      const en = dialogTitle("en-US", key);
      const zh = dialogTitle("zh-CN", key);
      expect(en.trim().length).toBeGreaterThan(0);
      expect(zh.trim().length).toBeGreaterThan(0);
      // Chinese dialog titles must not be English duplicates (product name ok).
      if (!en.includes("Translunar") || zh.includes("Translunar")) {
        expect(zh).not.toBe(en);
      }
    }
    // Renderer catalog must include the shared dialog keys used by settings UI.
    const messageKeys = new Set(listMessageKeys());
    for (const key of [
      "dialog.selectDataDirectory",
      "dialog.selectBackupDestination",
      "dialog.selectRestoreSource",
      "dialog.selectSource",
      "dialog.selectExport",
    ] as const) {
      expect(messageKeys.has(key)).toBe(true);
    }
  });

  it("covers restore preview summary keys bilingually", () => {
    expect(formatMessage("en-US", "restore.schema", { version: 2 })).toContain(
      "2",
    );
    expect(formatMessage("zh-CN", "restore.files", { count: 3 })).toContain(
      "3",
    );
    expect(
      formatMessage("en-US", "restore.hashStatus", { status: "ok" }),
    ).toMatch(/ok/i);
    expect(t("zh-CN", "restore.confirmAction")).toContain("恢复");
  });

  it("covers core panel localization keys with meaningful Chinese", () => {
    expect(t("zh-CN", "alignment.tabAlignment")).toBe("对齐");
    expect(t("zh-CN", "alignment.tabCorpora")).toContain("语料");
    expect(t("zh-CN", "discussion.createDiscussion")).toContain("讨论");
    expect(t("zh-CN", "snapshot.restoreSnapshot")).toContain("恢复");
    expect(t("zh-CN", "curation.applyDialogTitle")).toContain("应用");
    expect(t("zh-CN", "curation.metricQuarantine")).toContain("隔离");
    expect(t("zh-CN", "alignment.tabAlignment")).not.toBe(
      t("en-US", "alignment.tabAlignment"),
    );
    expect(t("zh-CN", "corpus.removeBody")).not.toBe(
      t("en-US", "corpus.removeBody"),
    );
  });
});
