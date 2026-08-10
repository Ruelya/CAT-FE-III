import { describe, expect, it } from "vitest";

import {
  createTemplateDefinition,
  decodeTemplateDefinition,
  isBuiltInTemplate,
  mergeTemplateDefinition,
} from "./template-definition";

describe("template-definition", () => {
  it("rejects null/array definitions", () => {
    expect(decodeTemplateDefinition(null).ok).toBe(false);
    expect(decodeTemplateDefinition([]).ok).toBe(false);
  });

  it("decodes P1 defaults with missing keys as empty strings", () => {
    const result = decodeTemplateDefinition({
      sourceLocale: "en-US",
      extra: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.defaults).toEqual({
        sourceLocale: "en-US",
        targetLocale: "",
        domain: "",
      });
      expect(result.raw.extra).toBe(1);
    }
  });

  it("creates a plain P1 definition", () => {
    expect(
      createTemplateDefinition({
        sourceLocale: "en",
        targetLocale: "zh",
        domain: "legal",
      }),
    ).toEqual({
      sourceLocale: "en",
      targetLocale: "zh",
      domain: "legal",
    });
  });

  it("preserves unknown keys on update merge", () => {
    const result = mergeTemplateDefinition(
      {
        sourceLocale: "en",
        targetLocale: "zh",
        domain: "general",
        pipelineId: "keep-me",
        nested: { a: 1 },
      },
      { sourceLocale: "ja", targetLocale: "ko", domain: "tech" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition).toEqual({
        sourceLocale: "ja",
        targetLocale: "ko",
        domain: "tech",
        pipelineId: "keep-me",
        nested: { a: 1 },
      });
    }
  });

  it("rejects merge of non-object definition", () => {
    expect(
      mergeTemplateDefinition("x", {
        sourceLocale: "a",
        targetLocale: "b",
        domain: "c",
      }).ok,
    ).toBe(false);
  });

  it("detects built-in templates", () => {
    expect(isBuiltInTemplate({ builtIn: true })).toBe(true);
    expect(isBuiltInTemplate({ builtIn: false })).toBe(false);
  });
});
