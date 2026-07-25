import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DataDirectoryManager,
  type DataDirectoryEngineBridge,
  resolveBackupDestinationInput,
  resolveDataDirectory,
} from "./data-directory-manager.js";
import * as diskSpace from "./disk-space.js";
import { validateAbsoluteCandidate } from "./path-safety.js";

describe("data directory resolution", () => {
  it("prefers TRANSLUNAR_DATA_DIR test override", () => {
    const resolved = resolveDataDirectory({
      envOverride: "K:/tmp/override",
      settingsPath: "K:/settings/path",
      defaultPath: "K:/default",
    });
    expect(resolved.isTestOverride).toBe(true);
    expect(resolved.path.replaceAll("\\", "/")).toContain("override");
  });

  it("uses settings path when override absent", () => {
    const resolved = resolveDataDirectory({
      settingsPath: "K:/settings/path",
      defaultPath: "K:/default",
    });
    expect(resolved.isTestOverride).toBe(false);
    expect(resolved.path.replaceAll("\\", "/")).toContain("settings");
  });
});

describe("backup destination selection", () => {
  it("treats canceled or empty selection as a no-op", () => {
    expect(resolveBackupDestinationInput(null)).toMatchObject({
      ok: false,
      code: "canceled",
    });
    expect(resolveBackupDestinationInput(undefined)).toMatchObject({
      ok: false,
      code: "canceled",
    });
    expect(resolveBackupDestinationInput("   ")).toMatchObject({
      ok: false,
      code: "canceled",
    });
  });

  it("accepts an explicit destination or the test override only", () => {
    expect(resolveBackupDestinationInput(" K:/backups/one ")).toEqual({
      ok: true,
      path: "K:/backups/one",
    });
    expect(resolveBackupDestinationInput(null, " K:/test-override ")).toEqual({
      ok: true,
      path: "K:/test-override",
    });
  });
});

describe("migration target validation", () => {
  it("rejects related live paths", () => {
    const live = "K:/data/live";
    const result = validateAbsoluteCandidate("K:/data/live/child", live);
    expect(result.ok).toBe(false);
  });

  it("stages, health-checks, swaps, and preserves the original workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-data-migrate-"));
    const source = join(root, "live");
    const target = join(root, "migrated");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "translunar.sqlite3"), "database", "utf8");
    const engine = new FakeEngine(source);
    const manager = new DataDirectoryManager(source, engine);

    const result = await manager.migrate(target);

    expect(result.ok).toBe(true);
    expect(result.activePath).toBe(target);
    expect(engine.currentPath).toBe(target);
    expect(await readFile(join(target, "translunar.sqlite3"), "utf8")).toBe(
      "database",
    );
    expect(await readFile(join(source, "translunar.sqlite3"), "utf8")).toBe(
      "database",
    );
  });

  it("quiesces the Engine before copying the live workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-data-quiesce-"));
    const source = join(root, "live");
    const target = join(root, "migrated");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "translunar.sqlite3"), "database", "utf8");
    const engine = new FakeEngine(source);
    engine.runOnStop(1, async () => {
      await writeFile(join(source, "quiesced.marker"), "stopped", "utf8");
    });
    const manager = new DataDirectoryManager(source, engine);

    await expect(manager.migrate(target)).resolves.toMatchObject({ ok: true });

    expect(await readFile(join(target, "quiesced.marker"), "utf8")).toBe(
      "stopped",
    );
    expect(engine.events[0]).toBe(`stop:${source}`);
  });

  it("never overwrites a destination that appears before migration swap", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-data-race-"));
    const source = join(root, "live");
    const target = join(root, "migrated");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "translunar.sqlite3"), "original", "utf8");
    const engine = new FakeEngine(source);
    engine.runOnStop(2, async () => {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "competitor.marker"), "keep", "utf8");
    });
    const manager = new DataDirectoryManager(source, engine);

    const result = await manager.migrate(target);

    expect(result).toMatchObject({
      ok: false,
      phase: "rollback",
      code: "destination_exists",
    });
    expect(await readFile(join(target, "competitor.marker"), "utf8")).toBe(
      "keep",
    );
    expect(await readFile(join(source, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
    expect(engine.currentPath).toBe(source);
  });

  it("restarts the source and preserves the published target after post-swap failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-data-post-swap-"));
    const source = join(root, "live");
    const target = join(root, "migrated");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "translunar.sqlite3"), "original", "utf8");
    const engine = new FakeEngine(source);
    engine.queueHealthResults(true, false);
    const manager = new DataDirectoryManager(source, engine);

    const result = await manager.migrate(target);

    expect(result).toMatchObject({
      ok: false,
      phase: "rollback",
      code: "post_swap_health_failed",
    });
    expect(engine.currentPath).toBe(source);
    expect(engine.events.at(-1)).toBe(`start:${source}`);
    expect(await readFile(join(source, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
    expect(await readFile(join(target, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
  });

  it("rolls back to the untouched source when staged health fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-data-rollback-"));
    const source = join(root, "live");
    const target = join(root, "broken");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "translunar.sqlite3"), "original", "utf8");
    const engine = new FakeEngine(
      source,
      (path) => !path.includes(".staging-"),
    );
    const manager = new DataDirectoryManager(source, engine);

    const result = await manager.migrate(target);

    expect(result.ok).toBe(false);
    expect(result.phase).toBe("rollback");
    expect(engine.currentPath).toBe(source);
    expect(await readFile(join(source, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
  });
});

describe("backup validation", () => {
  it("checks workspace shape, hashes, and schema compatibility before restore", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-backup-validate-"));
    const live = join(root, "live");
    const backup = join(root, "backup");
    await mkdir(live, { recursive: true });
    await mkdir(backup, { recursive: true });
    await writeFile(join(live, "translunar.sqlite3"), "live", "utf8");
    const bytes = Buffer.from("backup");
    await writeFile(join(backup, "translunar.sqlite3"), bytes);
    await writeManifest(backup, bytes, 2);
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);

    expect((await manager.validateBackup(backup)).ok).toBe(true);

    await writeFile(join(backup, "translunar.sqlite3"), "tampered", "utf8");
    const invalid = await manager.validateBackup(backup);
    expect(invalid).toMatchObject({ ok: false, code: "size_mismatch" });
    const restore = await manager.restoreFromBackup(backup);
    expect(restore).toMatchObject({ ok: false, phase: "validating" });
    expect(engine.stopCount).toBe(0);
    await expect(
      access(join(live, "translunar.sqlite3")),
    ).resolves.toBeUndefined();

    await writeFile(join(backup, "translunar.sqlite3"), bytes);
    await writeManifest(backup, bytes, 99);
    expect(await manager.validateBackup(backup)).toMatchObject({
      ok: false,
      code: "schema_too_new",
    });
  });

  it("rejects malformed and low-space restore inputs without stopping the Engine", async () => {
    const { live, backup } = await createRestoreFixture(
      "tl-restore-preflight-",
    );
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);

    await writeFile(join(backup, "manifest.json"), "{not-json", "utf8");
    await expect(manager.restoreFromBackup(backup)).resolves.toMatchObject({
      ok: false,
      phase: "validating",
      code: "invalid_backup",
    });
    expect(engine.stopCount).toBe(0);
    expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );

    const bytes = Buffer.from("backup");
    await writeManifest(backup, bytes, 2);
    const freeSpace = vi.spyOn(diskSpace, "freeDiskSpace").mockResolvedValue(0);
    try {
      await expect(manager.restoreFromBackup(backup)).resolves.toMatchObject({
        ok: false,
        phase: "validating",
        code: "insufficient_space",
      });
      expect(engine.stopCount).toBe(0);
      expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
        "original",
      );
    } finally {
      freeSpace.mockRestore();
    }
  });

  it("excludes ad-hoc credential files from workspace backups", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-backup-privacy-"));
    const live = join(root, "live");
    const destination = join(root, "backup-out");
    await mkdir(join(live, "sources"), { recursive: true });
    await mkdir(join(live, "exports"), { recursive: true });
    await writeFile(join(live, "translunar.sqlite3"), "project-db", "utf8");
    await writeFile(
      join(live, "sources", "sample.txt"),
      "hello source",
      "utf8",
    );
    // Secret-shaped file outside sources/exports must never be copied.
    await writeFile(
      join(live, "credentials.json"),
      JSON.stringify({ apiKey: "sk-super-secret-do-not-copy" }),
      "utf8",
    );
    await writeFile(
      join(live, "notes-with-secret.txt"),
      "token=sk-super-secret-do-not-copy",
      "utf8",
    );

    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);
    const created = await manager.createBackup(destination);

    expect(created.destinationPath).toBe(destination);
    const names = await readdir(destination);
    expect(names).not.toContain("credentials.json");
    expect(names).not.toContain("notes-with-secret.txt");
    expect(names).toContain("translunar.sqlite3");
    expect(names).toContain("sources");
    expect(names).toContain("manifest.json");

    const manifestRaw = await readFile(
      join(destination, "manifest.json"),
      "utf8",
    );
    expect(manifestRaw).not.toContain("sk-super-secret");
    expect(manifestRaw).not.toContain("credentials.json");
    expect(manifestRaw).toContain("translunar.sqlite3");
    expect(manifestRaw).toContain("sources/sample.txt");

    // Walk every backup file and ensure the secret string is absent.
    async function assertNoSecret(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await assertNoSecret(full);
        } else {
          const text = await readFile(full, "utf8");
          expect(text).not.toContain("sk-super-secret");
        }
      }
    }
    await assertNoSecret(destination);
    expect(
      created.manifest.files.some(
        (f) => f.relativePath === "sources/sample.txt",
      ),
    ).toBe(true);
  });
});

describe("confirmed restore boundary", () => {
  it("binds the token to the previewed path and consumes it after success", async () => {
    const { root, live, backup } =
      await createRestoreFixture("tl-restore-token-");
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);
    const preview = await manager.previewRestore(backup);
    expect(preview.ok).toBe(true);
    const token = preview.summary?.confirmationToken;
    expect(token).toBeTruthy();

    const mismatch = await manager.restoreFromConfirmedPreview({
      path: join(root, "different-backup"),
      confirmationToken: token ?? "",
    });
    expect(mismatch).toMatchObject({
      ok: false,
      code: "confirmation_path_mismatch",
    });
    expect(engine.stopCount).toBe(0);

    const restored = await manager.restoreFromConfirmedPreview({
      path: backup,
      confirmationToken: token ?? "",
    });
    expect(restored).toMatchObject({ ok: true, phase: "committed" });
    expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
      "backup",
    );
    await expect(access(join(live, "manifest.json"))).rejects.toBeDefined();

    const stopCount = engine.stopCount;
    const replay = await manager.restoreFromConfirmedPreview({
      path: backup,
      confirmationToken: token ?? "",
    });
    expect(replay).toMatchObject({
      ok: false,
      code: "confirmation_consumed",
    });
    expect(engine.stopCount).toBe(stopCount);
  });

  it("invalidates a token when the backup is changed after preview", async () => {
    const { live, backup } = await createRestoreFixture("tl-restore-tamper-");
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);
    const preview = await manager.previewRestore(backup);
    const token = preview.summary?.confirmationToken ?? "";

    await writeFile(join(backup, "translunar.sqlite3"), "hacked", "utf8");
    const changed = await manager.restoreFromConfirmedPreview({
      path: backup,
      confirmationToken: token,
    });
    expect(changed).toMatchObject({ ok: false, code: "hash_mismatch" });
    expect(engine.stopCount).toBe(0);
    expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );

    const replay = await manager.restoreFromConfirmedPreview({
      path: backup,
      confirmationToken: token,
    });
    expect(replay).toMatchObject({
      ok: false,
      code: "invalid_confirmation",
    });
  });

  it("expires preview confirmation tokens", async () => {
    const { live, backup } = await createRestoreFixture("tl-restore-expiry-");
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      const preview = await manager.previewRestore(backup);
      clock.mockReturnValue(1_000_000 + 11 * 60 * 1000);
      const expired = await manager.restoreFromConfirmedPreview({
        path: backup,
        confirmationToken: preview.summary?.confirmationToken ?? "",
      });
      expect(expired).toMatchObject({
        ok: false,
        code: "confirmation_expired",
      });
      expect(engine.stopCount).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("reserves a token before awaiting revalidation", async () => {
    const { live, backup } = await createRestoreFixture(
      "tl-restore-concurrent-",
    );
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);
    const preview = await manager.previewRestore(backup);
    const params = {
      path: backup,
      confirmationToken: preview.summary?.confirmationToken ?? "",
    };
    const barrier = engine.blockNextHealthCheck();

    const first = manager.restoreFromConfirmedPreview(params);
    await barrier.entered;
    const second = await manager.restoreFromConfirmedPreview(params);
    expect(second).toMatchObject({
      ok: false,
      code: "confirmation_in_progress",
    });
    barrier.release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("rechecks source hashes while staging to close the preview/apply race", async () => {
    const { live, backup } = await createRestoreFixture("tl-restore-toctou-");
    const engine = new FakeEngine(live);
    const manager = new DataDirectoryManager(live, engine);
    const preview = await manager.previewRestore(backup);
    engine.runOnNextHealthCheck(async () => {
      await writeFile(join(backup, "translunar.sqlite3"), "hacked", "utf8");
    });

    const result = await manager.restoreFromConfirmedPreview({
      path: backup,
      confirmationToken: preview.summary?.confirmationToken ?? "",
    });
    expect(result).toMatchObject({ ok: false, code: "backup_changed" });
    expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
    await expect(access(join(live, "manifest.json"))).rejects.toBeDefined();
  });
});

describe("restore manifest hardening", () => {
  it("rejects duplicate, traversing, and extra payload paths", async () => {
    const duplicate = await createRestoreFixture("tl-restore-duplicate-");
    const bytes = Buffer.from("backup");
    const entry = manifestEntry("translunar.sqlite3", bytes);
    await writeManifestEntries(duplicate.backup, [entry, entry]);
    const duplicateManager = new DataDirectoryManager(
      duplicate.live,
      new FakeEngine(duplicate.live),
    );
    await expect(
      duplicateManager.validateBackup(duplicate.backup),
    ).resolves.toMatchObject({
      ok: false,
      code: "duplicate_path",
    });

    const traversing = await createRestoreFixture("tl-restore-traversal-");
    await writeManifestEntries(traversing.backup, [
      manifestEntry("translunar.sqlite3", bytes),
      manifestEntry("../outside.txt", bytes),
    ]);
    const traversalManager = new DataDirectoryManager(
      traversing.live,
      new FakeEngine(traversing.live),
    );
    await expect(
      traversalManager.validateBackup(traversing.backup),
    ).resolves.toMatchObject({
      ok: false,
      code: "unsafe_path",
    });

    const extra = await createRestoreFixture("tl-restore-extra-");
    await writeFile(join(extra.backup, "unlisted.txt"), "not listed", "utf8");
    const extraManager = new DataDirectoryManager(
      extra.live,
      new FakeEngine(extra.live),
    );
    await expect(
      extraManager.validateBackup(extra.backup),
    ).resolves.toMatchObject({
      ok: false,
      code: "extra_backup_file",
    });
  });

  it("rejects an oversized manifest before parsing it", async () => {
    const { live, backup } = await createRestoreFixture(
      "tl-restore-large-manifest-",
    );
    await writeFile(
      join(backup, "manifest.json"),
      Buffer.alloc(8 * 1024 * 1024 + 1, 0x20),
    );
    const manager = new DataDirectoryManager(live, new FakeEngine(live));
    await expect(manager.validateBackup(backup)).resolves.toMatchObject({
      ok: false,
      code: "manifest_too_large",
    });
  });

  if (process.platform !== "win32") {
    it("rejects a symbolic-link manifest", async () => {
      const { live, backup } = await createRestoreFixture(
        "tl-restore-manifest-link-",
      );
      const manifestPath = join(backup, "manifest.json");
      const targetPath = join(backup, "manifest-target.json");
      const manifest = await readFile(manifestPath);
      await writeFile(targetPath, manifest);
      await rm(manifestPath, { force: true });
      await symlink(targetPath, manifestPath);
      const manager = new DataDirectoryManager(live, new FakeEngine(live));
      await expect(manager.validateBackup(backup)).resolves.toMatchObject({
        ok: false,
        code: "unsafe_manifest",
      });
    });
  }

  it("rolls back a failed post-swap health check to the original workspace", async () => {
    const { root, live, backup } = await createRestoreFixture(
      "tl-restore-rollback-",
    );
    const engine = new FakeEngine(live);
    engine.queueHealthResults(true, true, false);
    const manager = new DataDirectoryManager(live, engine);

    const result = await manager.restoreFromBackup(backup);
    expect(result).toMatchObject({
      ok: false,
      phase: "rollback",
      code: "post_swap_health_failed",
      activePath: live,
    });
    expect(manager.livePath).toBe(live);
    expect(engine.currentPath).toBe(live);
    expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
    const rollbackArtifacts = (await readdir(root)).filter((name) =>
      name.includes(".restore-failed-"),
    );
    expect(rollbackArtifacts).toHaveLength(1);
    expect(
      await readFile(
        join(root, rollbackArtifacts[0] ?? "", "translunar.sqlite3"),
        "utf8",
      ),
    ).toBe("backup");
  });

  it("quarantines an unknown restore-path occupant and never starts the Engine against it", async () => {
    const { root, live, backup } = await createRestoreFixture(
      "tl-restore-competitor-",
    );
    const displacedRestore = join(root, "displaced-restored-workspace");
    const engine = new FakeEngine(live);
    engine.queueHealthResults(true, true, false);
    engine.runOnHealthCheck(3, async () => {
      // Simulate an external actor replacing the published restore path while
      // the post-swap health check is in flight.
      await rename(live, displacedRestore);
      await mkdir(live);
      await writeFile(join(live, "competitor.marker"), "keep", "utf8");
    });
    const manager = new DataDirectoryManager(live, engine);

    const result = await manager.restoreFromBackup(backup);

    expect(result).toMatchObject({
      ok: false,
      phase: "rollback",
      code: "post_swap_health_failed",
      activePath: live,
    });
    expect(manager.livePath).toBe(live);
    expect(engine.currentPath).toBe(live);
    expect(await readFile(join(live, "translunar.sqlite3"), "utf8")).toBe(
      "original",
    );
    expect(
      await readFile(join(displacedRestore, "translunar.sqlite3"), "utf8"),
    ).toBe("backup");
    const quarantined = (await readdir(root)).filter((name) =>
      name.includes(".restore-failed-"),
    );
    expect(quarantined).toHaveLength(1);
    expect(
      await readFile(
        join(root, quarantined[0] ?? "", "competitor.marker"),
        "utf8",
      ),
    ).toBe("keep");
    expect(engine.events.at(-1)).toBe(`start:${live}`);
    expect(engine.events).not.toContain(
      `start:${join(root, quarantined[0] ?? "")}`,
    );
  });

  it("keeps the original workspace active at its fallback artifact when quarantine fails", async () => {
    const { root, live, backup } = await createRestoreFixture(
      "tl-restore-quarantine-fail-",
    );
    const displacedRestore = join(root, "displaced-restored-workspace");
    const competitorEvent = `competitor-installed:${live}`;
    const engine = new FakeEngine(live);
    engine.queueHealthResults(true, true, false);
    engine.runOnHealthCheck(3, async () => {
      await rename(live, displacedRestore);
      await mkdir(live);
      await writeFile(join(live, "competitor.marker"), "keep", "utf8");
      engine.events.push(competitorEvent);
    });
    const manager = new DataDirectoryManager(live, engine, {
      quarantinePath: () =>
        Promise.reject(
          Object.assign(new Error("simulated quarantine failure"), {
            code: "EPERM",
          }),
        ),
    });

    const result = await manager.restoreFromBackup(backup);

    const fallbackArtifacts = (await readdir(root)).filter((name) =>
      name.includes(".pre-restore-"),
    );
    expect(fallbackArtifacts).toHaveLength(1);
    const fallbackPath = join(root, fallbackArtifacts[0] ?? "");
    expect(result).toMatchObject({
      ok: false,
      phase: "rollback",
      code: "post_swap_health_failed",
      activePath: fallbackPath,
    });
    expect(manager.livePath).toBe(fallbackPath);
    expect(engine.currentPath).toBe(fallbackPath);
    expect(engine.events.at(-1)).toBe(`start:${fallbackPath}`);
    const competitorIndex = engine.events.indexOf(competitorEvent);
    expect(competitorIndex).toBeGreaterThanOrEqual(0);
    expect(engine.events.slice(competitorIndex + 1)).not.toContain(
      `start:${live}`,
    );
    expect(await readFile(join(live, "competitor.marker"), "utf8")).toBe(
      "keep",
    );
    expect(
      await readFile(join(fallbackPath, "translunar.sqlite3"), "utf8"),
    ).toBe("original");
    expect(
      await readFile(join(displacedRestore, "translunar.sqlite3"), "utf8"),
    ).toBe("backup");
    expect(
      (await readdir(root)).filter((name) => name.includes(".restore-failed-")),
    ).toHaveLength(0);
  });
});

class FakeEngine implements DataDirectoryEngineBridge {
  currentPath: string;
  stopCount = 0;
  healthCount = 0;
  readonly events: string[] = [];
  readonly #healthy: (path: string) => boolean;
  readonly #healthResults: boolean[] = [];
  readonly #stopEffects = new Map<number, () => void | Promise<void>>();
  readonly #healthEffects = new Map<number, () => void | Promise<void>>();
  #nextHealthBarrier:
    | {
        entered: () => void;
        wait: Promise<void>;
      }
    | undefined;
  #nextHealthEffect: (() => void | Promise<void>) | undefined;

  constructor(path: string, healthy: (path: string) => boolean = () => true) {
    this.currentPath = path;
    this.#healthy = healthy;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.events.push(`stop:${this.currentPath}`);
    const effect = this.#stopEffects.get(this.stopCount);
    if (effect) {
      this.#stopEffects.delete(this.stopCount);
      await effect();
    }
  }

  startWithDataDirectory(dataDirectory: string): Promise<void> {
    this.currentPath = dataDirectory;
    this.events.push(`start:${dataDirectory}`);
    return Promise.resolve();
  }

  async checkHealth(): Promise<{ healthy: boolean; schemaVersion: number }> {
    this.healthCount += 1;
    this.events.push(`health:${this.currentPath}`);
    const barrier = this.#nextHealthBarrier;
    if (barrier) {
      this.#nextHealthBarrier = undefined;
      barrier.entered();
      await barrier.wait;
    }
    const effect = this.#nextHealthEffect;
    if (effect) {
      this.#nextHealthEffect = undefined;
      await effect();
    }
    const countedEffect = this.#healthEffects.get(this.healthCount);
    if (countedEffect) {
      this.#healthEffects.delete(this.healthCount);
      await countedEffect();
    }
    return {
      healthy: this.#healthResults.shift() ?? this.#healthy(this.currentPath),
      schemaVersion: 2,
    };
  }

  queueHealthResults(...results: boolean[]): void {
    this.#healthResults.push(...results);
  }

  runOnStop(count: number, effect: () => void | Promise<void>): void {
    this.#stopEffects.set(count, effect);
  }

  runOnNextHealthCheck(effect: () => void | Promise<void>): void {
    this.#nextHealthEffect = effect;
  }

  runOnHealthCheck(count: number, effect: () => void | Promise<void>): void {
    this.#healthEffects.set(count, effect);
  }

  blockNextHealthCheck(): { entered: Promise<void>; release: () => void } {
    let markEntered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#nextHealthBarrier = {
      entered: () => markEntered?.(),
      wait,
    };
    return {
      entered,
      release: () => release?.(),
    };
  }

  /**
   * Mirror real Engine backup: only sqlite + sources + exports (+ manifest).
   * Ad-hoc files in the data root (e.g. credentials.json) are not copied.
   */
  async createBackup(destinationPath: string): Promise<{
    destinationPath: string;
    manifest: {
      schemaVersion: number;
      engineVersion: string;
      createdAtMs: number;
      files: Array<{ relativePath: string; size: number; sha256: string }>;
    };
  }> {
    await mkdir(destinationPath, { recursive: true });
    const sqliteSrc = join(this.currentPath, "translunar.sqlite3");
    const sqliteDst = join(destinationPath, "translunar.sqlite3");
    await cp(sqliteSrc, sqliteDst).catch(async () => {
      await writeFile(sqliteDst, "empty", "utf8");
    });
    for (const dir of ["sources", "exports"] as const) {
      const from = join(this.currentPath, dir);
      const to = join(destinationPath, dir);
      try {
        await cp(from, to, { recursive: true });
      } catch {
        await mkdir(to, { recursive: true });
      }
    }
    const files = await collectFiles(destinationPath, destinationPath);
    const manifest = {
      formatVersion: 1,
      schemaVersion: 2,
      engineVersion: "test",
      createdAtMs: Date.now(),
      files,
    };
    await writeFile(
      join(destinationPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    return {
      destinationPath,
      manifest: {
        schemaVersion: manifest.schemaVersion,
        engineVersion: manifest.engineVersion,
        createdAtMs: manifest.createdAtMs,
        files: manifest.files,
      },
    };
  }

  getDataDirectory(): string {
    return this.currentPath;
  }

  setDataDirectory(path: string): void {
    this.currentPath = path;
  }
}

async function createRestoreFixture(prefix: string): Promise<{
  root: string;
  live: string;
  backup: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const live = join(root, "live");
  const backup = join(root, "backup");
  await mkdir(live, { recursive: true });
  await mkdir(backup, { recursive: true });
  await writeFile(join(live, "translunar.sqlite3"), "original", "utf8");
  const bytes = Buffer.from("backup");
  await writeFile(join(backup, "translunar.sqlite3"), bytes);
  await writeManifest(backup, bytes, 2);
  return { root, live, backup };
}

function manifestEntry(
  relativePath: string,
  bytes: Buffer,
): { relativePath: string; size: number; sha256: string } {
  return {
    relativePath,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function writeManifestEntries(
  backup: string,
  files: Array<{ relativePath: string; size: number; sha256: string }>,
): Promise<void> {
  await writeFile(
    join(backup, "manifest.json"),
    JSON.stringify({
      formatVersion: 1,
      schemaVersion: 2,
      engineVersion: "test",
      createdAtMs: 1,
      files,
    }),
    "utf8",
  );
}

async function collectFiles(
  root: string,
  current: string,
): Promise<Array<{ relativePath: string; size: number; sha256: string }>> {
  const out: Array<{ relativePath: string; size: number; sha256: string }> = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(root, full)));
    } else if (entry.name !== "manifest.json") {
      const bytes = await readFile(full);
      const relativePath = full
        .slice(root.length)
        .replaceAll("\\", "/")
        .replace(/^\//u, "");
      out.push({
        relativePath,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return out;
}

async function writeManifest(
  backup: string,
  bytes: Buffer,
  schemaVersion: number,
): Promise<void> {
  await writeFile(
    join(backup, "manifest.json"),
    JSON.stringify({
      formatVersion: 1,
      schemaVersion,
      engineVersion: "test",
      createdAtMs: 1,
      files: [
        {
          relativePath: "translunar.sqlite3",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    }),
    "utf8",
  );
}
