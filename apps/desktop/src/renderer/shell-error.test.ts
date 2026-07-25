import { describe, expect, it } from "vitest";

import {
  catalogDiagnostics,
  formatMessage,
  listLocales,
  listMessageKeys,
} from "./i18n/messages";
import { localizeShellError, shellErrorMessageKey } from "./shell-error";

describe("shell-error localization mapping", () => {
  const messageKeys = new Set<string>(listMessageKeys());

  it("maps every mapped shell code to a real, non-empty catalog key", () => {
    // Representative stable codes emitted by DataDirectoryManager and the
    // backup/restore IPC handlers.
    const codes = [
      "canceled",
      "not_writable",
      "insufficient_space",
      "existing_workspace",
      "destination_exists",
      "duplicate_path",
      "unsafe_path",
      "unsafe_manifest",
      "unsafe_backup_entry",
      "unsafe_workspace_entry",
      "invalid_backup",
      "invalid_manifest",
      "manifest_too_large",
      "manifest_too_many_files",
      "extra_backup_file",
      "incompatible_manifest",
      "schema_too_new",
      "size_mismatch",
      "hash_mismatch",
      "invalid_workspace_shape",
      "restore_in_progress",
      "confirmation_in_progress",
      "missing_confirmation",
      "invalid_confirmation",
      "confirmation_consumed",
      "confirmation_path_mismatch",
      "backup_changed",
      "confirmation_expired",
      "health_failed",
      "post_swap_health_failed",
      "staging_incomplete",
      "staging_mismatch",
      "backup_failed",
    ] as const;
    for (const code of codes) {
      const key = shellErrorMessageKey(code);
      expect(key, `code ${code} must map to a message key`).not.toBeNull();
      expect(messageKeys.has(key as string)).toBe(true);
      for (const locale of listLocales()) {
        expect(
          formatMessage(locale, key as never).trim().length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("returns null for unknown or missing codes so callers can fall back", () => {
    expect(shellErrorMessageKey(null)).toBeNull();
    expect(shellErrorMessageKey(undefined)).toBeNull();
    expect(shellErrorMessageKey("")).toBeNull();
    expect(shellErrorMessageKey("totally_unknown_code")).toBeNull();
  });

  it("localizes a coded result and ignores the raw English message", () => {
    const t = (key: Parameters<typeof formatMessage>[1]) =>
      formatMessage("zh-CN", key);
    const localized = localizeShellError(
      { code: "insufficient_space", message: "Not enough disk space." },
      t,
      "error.backupFailed",
    );
    expect(localized).toBe(formatMessage("zh-CN", "shellError.insufficientSpace"));
    // The raw English detail is never surfaced.
    expect(localized).not.toContain("disk space");
  });

  it("falls back to the supplied localized key for unmapped codes", () => {
    const t = (key: Parameters<typeof formatMessage>[1]) =>
      formatMessage("zh-CN", key);
    const localized = localizeShellError(
      { code: "unmapped_weird_code", message: "Raw English detail." },
      t,
      "error.restoreFailed",
    );
    expect(localized).toBe(formatMessage("zh-CN", "error.restoreFailed"));
    expect(localized).not.toContain("Raw English");
  });

  it("keeps the shellError.* catalog free of Chinese placeholder drift", () => {
    // Reuse the shared catalog diagnostics: both bundles complete, and zh-CN is
    // not an English duplicate for these keys.
    for (const locale of listLocales()) {
      expect(catalogDiagnostics(locale)).toEqual([]);
    }
  });
});
