import { describe, expect, it } from "vitest";

import {
  cloneTemplateDefinition,
  parseSearchSnippet,
  readTemplateDefinition,
} from "./project-home-utils";

describe("project home search snippets", () => {
  it("extracts balanced Engine highlight markers", () => {
    expect(
      parseSearchSnippet("Before <mark>matched</mark> after <mark>CJK</mark>"),
    ).toEqual([
      { text: "Before ", highlighted: false },
      { text: "matched", highlighted: true },
      { text: " after ", highlighted: false },
      { text: "CJK", highlighted: true },
    ]);
  });

  it("keeps markup-like source content as text", () => {
    expect(
      parseSearchSnippet(
        "<img src=x onerror=alert(1)> <mark>safe</mark> <script>text</script>",
      ),
    ).toEqual([
      {
        text: "<img src=x onerror=alert(1)> ",
        highlighted: false,
      },
      { text: "safe", highlighted: true },
      { text: " <script>text</script>", highlighted: false },
    ]);
  });

  it("does not consume an unbalanced highlight marker", () => {
    expect(parseSearchSnippet("Before <mark>unterminated")).toEqual([
      { text: "Before <mark>unterminated", highlighted: false },
    ]);
  });

  it("preserves safe extensions while excluding credentials and source content", () => {
    const definition = {
      sourceLocale: "en-GB",
      targetLocale: "zh-TW",
      qaProfileId: "qa.custom",
      pipelineId: "pipeline.custom",
      aiProfileIds: ["ai.one", 42],
      analysisProfileId: "builtin.analysis.standard",
      reviewRequired: false,
      editorDefaults: { fontSize: 14 },
      customSafeExtension: "preserved",
      credentials: { apiKey: "renderer-must-not-reserialize" },
      nested: {
        safe: "preserved",
        refreshToken: "renderer-must-not-reserialize",
      },
      privateSource: {
        content: "private source text",
        path: "C:/private/source.txt",
      },
      sourcePayload: {
        text: "private source text",
        locale: "en-GB",
      },
    };

    expect(readTemplateDefinition(definition)).toEqual({
      sourceLocale: "en-GB",
      targetLocale: "zh-TW",
      domain: "",
      qaProfileId: "qa.custom",
      pipelineId: "pipeline.custom",
      aiProfileIds: ["ai.one"],
      analysisProfileId: "builtin.analysis.standard",
      reviewRequired: false,
    });
    expect(cloneTemplateDefinition(definition)).toEqual({
      sourceLocale: "en-GB",
      targetLocale: "zh-TW",
      qaProfileId: "qa.custom",
      pipelineId: "pipeline.custom",
      aiProfileIds: ["ai.one", 42],
      analysisProfileId: "builtin.analysis.standard",
      reviewRequired: false,
      editorDefaults: { fontSize: 14 },
      customSafeExtension: "preserved",
      nested: { safe: "preserved" },
      sourcePayload: { locale: "en-GB" },
    });
    expect(definition.credentials.apiKey).toBe("renderer-must-not-reserialize");
  });
});
