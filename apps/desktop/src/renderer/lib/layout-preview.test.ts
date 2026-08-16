import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  layoutPreviewConfigured,
  onlyOfficeBootstrapHtml,
} from "./layout-preview";

const session = {
  fileUrl: "http://127.0.0.1:9/a/b.docx",
  docsUrl: "http://127.0.0.1:8080",
  token: "signed.jwt.here",
  documentType: "word" as const,
  fileType: "docx",
  title: "Brief <doc>",
  key: "k1",
};

describe("layout preview bootstrap", () => {
  it("escapes the title and keeps view mode", () => {
    const html = onlyOfficeBootstrapHtml(session);
    expect(html).toContain("Brief &lt;doc&gt;");
    expect(html).toContain('"mode":"view"');
    expect(html).toContain("signed.jwt.here");
    expect(html).not.toContain("TRANSLUNAR_ONLYOFFICE_JWT_SECRET");
    expect(layoutPreviewConfigured(session)).toBe(true);
    expect(layoutPreviewConfigured({ ...session, docsUrl: null })).toBe(false);
  });

  it("escapes markup in helper text", () => {
    expect(escapeHtml(`<img src="x">`)).toBe("&lt;img src=&quot;x&quot;&gt;");
  });
});
