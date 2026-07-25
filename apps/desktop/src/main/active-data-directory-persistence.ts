import type {
  DataDirectoryMigrationResult,
  ProductShellSettings,
} from "../shared/product-shell.js";

export interface ActiveDataDirectoryOwner {
  readonly livePath: string;
  readonly isTestOverride: boolean;
}

export interface ActiveDataDirectorySettingsStore {
  update(
    patch: Pick<ProductShellSettings, "dataDirectoryPath">,
  ): Promise<unknown>;
}

/**
 * Persist the fallback workspace selected by a restore rollback.
 *
 * Normal restore outcomes continue using the same live path and need no extra
 * write. Environment overrides are deliberately disposable and must never
 * leak into product-shell settings. Any invariant or atomic settings-write
 * failure rejects the caller so a non-durable rollback is not reported as a
 * durable success.
 */
export async function persistRestoreActiveDataDirectory(
  owner: ActiveDataDirectoryOwner,
  result: DataDirectoryMigrationResult,
  settings: ActiveDataDirectorySettingsStore,
): Promise<void> {
  if (result.activePath !== owner.livePath) {
    throw new Error(
      "Restore active path does not match the data directory manager live path.",
    );
  }
  if (owner.isTestOverride || result.activePath === result.sourcePath) {
    return;
  }
  await settings.update({ dataDirectoryPath: result.activePath });
}
