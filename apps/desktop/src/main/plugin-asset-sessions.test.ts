import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLUGIN_ASSET_SESSION_TTL_MS,
  PLUGIN_DOCUMENT_CSP,
  PluginAssetSessionRegistry,
} from "./plugin-asset-sessions.js";
const TOKEN = "a".repeat(64);

function source(root: string) {
  return {
    ownerWebContentsId: 7,
    pluginId: "example.panel",
    versionId: "version-1",
    revision: 4,
    contributionId: "example.panel.ui",
    bridgeVersion: 1 as const,
    packageRoot: root,
    surface: "panel/index.html",
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requestWithRawUrl(url: string): Request {
  return {
    headers: new Headers(),
    method: "GET",
    url,
  } as Request;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "plugin-assets-"));
  await mkdir(join(root, "panel"));
  await writeFile(join(root, "panel", "index.html"), "<h1>Panel</h1>");
  await writeFile(join(root, "panel", "app.mjs"), "export {};\n");
  return root;
}

describe("PluginAssetSessionRegistry", () => {
  it("serves an opaque session with strict headers and MIME", async () => {
    const root = await fixture();
    const registry = new PluginAssetSessionRegistry(
      () => 10,
      () => TOKEN,
    );
    const issued = await registry.issue(source(root));
    expect(issued.url).toBe(`translunar-plugin://${TOKEN}/panel/index.html`);
    expect(issued.url).not.toContain("example.panel");
    expect(issued.url).not.toContain(root);
    const response = await registry.handle(new Request(issued.url));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>Panel</h1>");
    expect(response.headers.get("content-security-policy")).toBe(
      PLUGIN_DOCUMENT_CSP,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect((await registry.handle(new Request(issued.url))).status).toBe(404);
    const moduleResponse = await registry.handle(
      new Request(`translunar-plugin://${TOKEN}/panel/app.mjs`),
    );
    expect(moduleResponse.status).toBe(200);
    expect(await moduleResponse.text()).toBe("export {};\n");
  });

  it("rejects method, range, traversal, query, unknown MIME, and expiry", async () => {
    const root = await fixture();
    let now = 1;
    const registry = new PluginAssetSessionRegistry(
      () => now,
      () => TOKEN,
    );
    const issued = await registry.issue(source(root));
    expect(
      (await registry.handle(new Request(issued.url, { method: "POST" })))
        .status,
    ).toBe(405);
    expect(
      (
        await registry.handle(
          new Request(issued.url, { headers: { range: "bytes=0-1" } }),
        )
      ).status,
    ).toBe(416);
    for (const suffix of [
      "/../manifest.json",
      "/%2e%2e/manifest.json",
      "/panel/index.html?x=1",
      "/panel/index.html#x",
      "/panel%2findex.html",
    ]) {
      const response = await registry.handle(
        new Request(`translunar-plugin://${TOKEN}${suffix}`),
      );
      expect(response.status, suffix).toBe(404);
    }
    now += PLUGIN_ASSET_SESSION_TTL_MS + 1;
    expect((await registry.handle(new Request(issued.url))).status).toBe(404);
  });

  it("rejects raw dot traversal before URL normalization can erase it", async () => {
    const root = await fixture();
    await writeFile(join(root, "sibling.mjs"), "export const secret = true;\n");
    const registry = new PluginAssetSessionRegistry(
      () => 1,
      () => TOKEN,
    );
    const issued = await registry.issue(source(root));
    expect((await registry.handle(new Request(issued.url))).status).toBe(200);

    for (const component of ["..", "%2e%2e", ".%2e", "%2e."]) {
      const rawUrl = `translunar-plugin://${TOKEN}/panel/${component}/sibling.mjs`;
      expect(new URL(rawUrl).pathname).toBe("/sibling.mjs");
      expect(
        (await registry.handle(requestWithRawUrl(rawUrl))).status,
        component,
      ).toBe(404);
      expect(
        (await registry.handle(new Request(rawUrl))).status,
        `${component} after Request normalization`,
      ).toBe(404);
    }
  });

  it("does not serve a request revoked during asynchronous file checks", async () => {
    const root = await fixture();
    const readStarted = deferred();
    const continueRead = deferred();
    let delayRead = false;
    const registry = new PluginAssetSessionRegistry(
      () => 1,
      () => TOKEN,
      {
        lstat,
        realpath,
        readFile: async (path) => {
          if (delayRead) {
            readStarted.resolve();
            await continueRead.promise;
          }
          return readFile(path);
        },
      },
    );
    const issued = await registry.issue(source(root));
    delayRead = true;
    const pending = registry.handle(new Request(issued.url));
    await readStarted.promise;
    expect(registry.revoke(issued.sessionId, 7)).toBe(true);
    continueRead.resolve();
    expect((await pending).status).toBe(404);
    expect((await registry.handle(new Request(issued.url))).status).toBe(404);
  });

  it.each([
    [
      "owner revoke",
      (registry: PluginAssetSessionRegistry) => registry.revokeOwner(7),
    ],
    [
      "plugin revoke",
      (registry: PluginAssetSessionRegistry) =>
        registry.revokePlugin("example.panel"),
    ],
    [
      "global revoke",
      (registry: PluginAssetSessionRegistry) => registry.revokeAll(),
    ],
  ])(
    "does not register an issue after an in-flight %s",
    async (_name, revoke) => {
      const root = await fixture();
      const validationStarted = deferred();
      const continueValidation = deferred();
      let firstRealpath = true;
      const registry = new PluginAssetSessionRegistry(
        () => 1,
        () => TOKEN,
        {
          lstat,
          readFile,
          realpath: async (path) => {
            if (firstRealpath) {
              firstRealpath = false;
              validationStarted.resolve();
              await continueValidation.promise;
            }
            return realpath(path);
          },
        },
      );
      const pending = registry.issue(source(root));
      await validationStarted.promise;
      revoke(registry);
      continueValidation.resolve();

      await expect(pending).rejects.toThrow(
        "Plugin asset session request was revoked.",
      );
      expect(
        (
          await registry.handle(
            new Request(`translunar-plugin://${TOKEN}/panel/index.html`),
          )
        ).status,
      ).toBe(404);
    },
  );

  it("revokes by owner and rejects link traversal", async () => {
    const root = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "plugin-outside-"));
    await writeFile(join(outside, "secret.html"), "secret");
    await expect(
      symlink(
        outside,
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      ),
    ).resolves.toBeUndefined();
    const registry = new PluginAssetSessionRegistry(
      () => 1,
      () => TOKEN,
    );
    const issued = await registry.issue({
      ...source(root),
      ownerWebContentsId: 9,
    });
    expect(
      (
        await registry.handle(
          new Request(`translunar-plugin://${TOKEN}/linked/secret.html`),
        )
      ).status,
    ).toBe(404);
    expect(registry.revoke(issued.sessionId, 8)).toBe(false);
    registry.revokeOwner(9);
    expect((await registry.handle(new Request(issued.url))).status).toBe(404);
  });
});
