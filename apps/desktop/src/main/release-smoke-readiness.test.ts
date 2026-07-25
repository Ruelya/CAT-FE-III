import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RELEASE_SMOKE_ENV,
  RELEASE_SMOKE_MARKER_ENV,
  RELEASE_SMOKE_MARKER_KIND,
  writeReleaseSmokeReadiness,
} from "./release-smoke-readiness.js";

describe("release smoke readiness marker", () => {
  it("is disabled by default and publishes bounded evidence when opted in", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-app-ready-"));
    const markerPath = join(root, "ready.json");
    expect(
      await writeReleaseSmokeReadiness(
        {},
        {
          appVersion: "0.1.0",
          health: { healthy: true, schemaVersion: 7 },
        },
      ),
    ).toBeNull();

    const evidence = await writeReleaseSmokeReadiness(
      {
        [RELEASE_SMOKE_ENV]: "1",
        [RELEASE_SMOKE_MARKER_ENV]: markerPath,
      },
      {
        appVersion: "0.1.0",
        health: { healthy: true, schemaVersion: 7 },
        pid: 42,
        nowMs: 1234,
      },
    );

    expect(evidence).toEqual({
      kind: RELEASE_SMOKE_MARKER_KIND,
      version: 1,
      appVersion: "0.1.0",
      pid: 42,
      healthy: true,
      schemaVersion: 7,
      readyAtMs: 1234,
    });
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toEqual(evidence);
  });

  it("fails closed for unhealthy Engine, relative paths, and stale markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-app-ready-invalid-"));
    const markerPath = join(root, "ready.json");
    const env = {
      [RELEASE_SMOKE_ENV]: "1",
      [RELEASE_SMOKE_MARKER_ENV]: markerPath,
    };

    await expect(
      writeReleaseSmokeReadiness(env, {
        appVersion: "0.1.0",
        health: { healthy: false },
      }),
    ).rejects.toThrow(/health check failed/iu);
    await expect(
      writeReleaseSmokeReadiness(
        {
          [RELEASE_SMOKE_ENV]: "1",
          [RELEASE_SMOKE_MARKER_ENV]: "relative-ready.json",
        },
        {
          appVersion: "0.1.0",
          health: { healthy: true },
        },
      ),
    ).rejects.toThrow(/absolute path/iu);

    await writeFile(markerPath, "stale", "utf8");
    await expect(
      writeReleaseSmokeReadiness(env, {
        appVersion: "0.1.0",
        health: { healthy: true },
      }),
    ).rejects.toThrow(/already exists/iu);
    expect(await readFile(markerPath, "utf8")).toBe("stale");
  });
});
