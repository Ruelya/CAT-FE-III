import type { MessageKey } from "./i18n/messages";
import type { ShellActionResult } from "../shared/product-shell";

/**
 * Coherent mapping from main-process shell failure codes to localized message
 * keys. Main-process/OS-facing shell operations (data-directory migrate,
 * backup, restore preview/apply) return stable `{ ok, code, message }` shapes;
 * the renderer renders localized copy from the code instead of surfacing the
 * raw English `message`.
 *
 * A bounded, explicitly audited set of technical detail may still be shown by
 * callers when the code is unknown (see `shellErrorMessageKey` fallback), but
 * the default surface is always a localized category string.
 */
const SHELL_ERROR_KEYS: Record<string, MessageKey> = {
  // User canceled a native dialog selection.
  canceled: "shellError.canceled",
  // Path / permission validation.
  not_writable: "shellError.notWritable",
  insufficient_space: "shellError.insufficientSpace",
  existing_workspace: "shellError.existingWorkspace",
  destination_exists: "shellError.destinationExists",
  duplicate_path: "shellError.unsafePath",
  unsafe_path: "shellError.unsafePath",
  unsafe_manifest: "shellError.unsafePath",
  unsafe_backup_entry: "shellError.unsafePath",
  unsafe_workspace_entry: "shellError.unsafePath",
  // Backup / manifest integrity.
  invalid_backup: "shellError.invalidBackup",
  invalid_manifest: "shellError.invalidBackup",
  manifest_too_large: "shellError.invalidBackup",
  manifest_too_many_files: "shellError.invalidBackup",
  extra_backup_file: "shellError.invalidBackup",
  incompatible_manifest: "shellError.incompatibleBackup",
  schema_too_new: "shellError.schemaTooNew",
  size_mismatch: "shellError.hashMismatch",
  hash_mismatch: "shellError.hashMismatch",
  invalid_workspace_shape: "shellError.invalidWorkspaceShape",
  // Restore confirmation lifecycle.
  restore_in_progress: "shellError.restoreInProgress",
  confirmation_in_progress: "shellError.restoreInProgress",
  missing_confirmation: "shellError.confirmationInvalid",
  invalid_confirmation: "shellError.confirmationInvalid",
  confirmation_consumed: "shellError.confirmationInvalid",
  confirmation_path_mismatch: "shellError.confirmationInvalid",
  backup_changed: "shellError.confirmationInvalid",
  confirmation_expired: "shellError.confirmationExpired",
  // Health / staging failures during migrate/swap.
  health_failed: "shellError.healthFailed",
  post_swap_health_failed: "shellError.healthFailed",
  staging_incomplete: "shellError.stagingIncomplete",
  staging_mismatch: "shellError.stagingIncomplete",
  backup_failed: "error.backupFailed",
};

/**
 * Resolve a shell failure code to its localized message key. Returns null when
 * the code has no coherent category mapping, so the caller can decide whether
 * to fall back to a bounded technical detail or a generic message.
 */
export function shellErrorMessageKey(
  code: string | null | undefined,
): MessageKey | null {
  if (!code) return null;
  return SHELL_ERROR_KEYS[code] ?? null;
}

/**
 * Render a localized message for a failed shell action result. Prefers the
 * coded category mapping; falls back to a supplied localized default. The raw
 * English `message` is never surfaced as primary UI copy.
 */
export function localizeShellError(
  result: Pick<ShellActionResult, "code" | "message">,
  t: (key: MessageKey) => string,
  fallbackKey: MessageKey,
): string {
  const key = shellErrorMessageKey(result.code);
  return key ? t(key) : t(fallbackKey);
}
