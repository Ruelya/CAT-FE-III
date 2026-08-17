import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import { formatTokens, previewInnerHtml } from "./preview-markup";

function tag(
  id: string,
  kind: "start" | "end" | "standalone",
  position: number,
  displayText: string,
  pairId?: string,
): InlineTag {
  return {
    id,
    kind,
    position,
    displayText,
    side: "source",
    payload: displayText,
    protected: true,
    ...(pairId ? { pairId } : {}),
  };
}

describe("formatTokens", () => {
  it("reads HTML, OOXML, and stacked labels", () => {
    expect(formatTokens("<b>")).toEqual(["b"]);
    expect(formatTokens("</i>")).toEqual(["i"]);
    expect(formatTokens("b i")).toEqual(["b", "i"]);
    expect(formatTokens("<md>")).toEqual([]);
  });
});

describe("previewInnerHtml", () => {
  it("wraps a bold span in strong", () => {
    const html = previewInnerHtml("Read the TL-900 guide.", [
      tag("1s", "start", 9, "b", "p1"),
      tag("1e", "end", 15, "b", "p1"),
    ]);
    expect(html).toBe("Read the <strong>TL-900</strong> guide.");
  });

  it("applies HTML tag labels and escapes text", () => {
    const html = previewInnerHtml("a<b>", [
      tag("1s", "start", 0, "<i>"),
      tag("1e", "end", 1, "</i>"),
    ]);
    expect(html).toBe("<em>a</em>&lt;b&gt;");
  });

  it("ignores standalone placeables", () => {
    expect(previewInnerHtml("code", [tag("m", "standalone", 0, "<md>")])).toBe(
      "code",
    );
  });
});
