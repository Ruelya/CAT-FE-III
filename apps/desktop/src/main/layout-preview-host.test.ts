import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LayoutPreviewHost,
  buildOnlyOfficePayload,
  layoutDocumentType,
  readLayoutPreviewEnv,
  sanitizeLayoutFileType,
  signHs256Jwt,
} from "./layout-preview-host.js";

const TOKEN = "a".repeat(64);

describe("layout preview host", () => {
  const host = new LayoutPreviewHost(() => TOKEN);

  afterEach(async () => {
    await host.revoke();
  });

  it("maps office families without inventing a new engine method", () => {
    expect(layoutDocumentType("docx")).toBe("word");
    expect(layoutDocumentType("xlsx")).toBe("cell");
    expect(layoutDocumentType("pptx")).toBe("slide");
    expect(sanitizeLayoutFileType("../exe")).toBe("bin");
  });

  it("reads sidecar env without echoing the JWT secret", () => {
    const env = readLayoutPreviewEnv({
      TRANSLUNAR_ONLYOFFICE_DOCS_URL: " http://127.0.0.1:8080 ",
      TRANSLUNAR_ONLYOFFICE_JWT_SECRET: "s3cret",
    });
    expect(env.docsUrl).toBe("http://127.0.0.1:8080");
    expect(env.jwtSecret).toBe("s3cret");
    expect(JSON.stringify(env)).not.toContain("TRANSLUNAR_ONLYOFFICE_JWT_SECRET");
  });

  it("serves an exported file on loopback and signs view-mode JWT", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-preview-"));
    const sink = await host.createSink(root, "docx");
    await writeFile(sink.outputPath, "PK-fake-docx");
    const session = await host.publish({
      rootDir: root,
      outputPath: sink.outputPath,
      title: "Brief.docx",
      fileType: "docx",
      docsUrl: "http://127.0.0.1:8080",
      jwtSecret: "unit-test-secret",
    });
    expect(session.fileUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(session.docsUrl).toBe("http://127.0.0.1:8080");
    expect(session.documentType).toBe("word");
    expect(session.token).toBeTruthy();
    expect(JSON.stringify(session)).not.toContain("unit-test-secret");

    const response = await fetch(session.fileUrl);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("PK-fake-docx");

    const payload = buildOnlyOfficePayload(session);
    expect(payload.editorConfig).toMatchObject({ mode: "view" });
    expect(session.token).toBe(
      signHs256Jwt(payload, "unit-test-secret"),
    );
  });

  it("rejects a path outside the preview root", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-preview-"));
    const outside = join(root, "..", "escape.docx");
    await writeFile(outside, "nope");
    await expect(
      host.publish({
        rootDir: root,
        outputPath: outside,
        title: "nope",
        fileType: "docx",
        docsUrl: null,
        jwtSecret: null,
      }),
    ).rejects.toThrow(/outside the preview root/);
  });
});
