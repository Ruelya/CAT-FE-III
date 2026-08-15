import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import { splitTaggedText, tagLabel } from "./tagged-text";

function tag(
  id: string,
  kind: "start" | "end" | "standalone",
  position: number,
  displayText: string,
): InlineTag {
  return {
    id,
    kind,
    position,
    displayText,
    side: "source",
    payload: displayText,
    protected: true,
  };
}

describe("splitTaggedText", () => {
  it("renders a bold span as capsules around the phrase", () => {
    const pieces = splitTaggedText("Read the TL-900 guide.", [
      tag("1s", "start", 9, "b"),
      tag("1e", "end", 15, "b"),
    ]);
    expect(pieces.map((p) => p.text)).toEqual([
      "Read the ",
      "b",
      "TL-900",
      "/b",
      " guide.",
    ]);
  });

  it("counts characters so CJK offsets stay aligned", () => {
    const pieces = splitTaggedText("电池容量", [
      tag("1s", "start", 0, "b"),
      tag("1e", "end", 2, "b"),
    ]);
    expect(pieces.map((p) => p.text)).toEqual(["b", "电池", "/b", "容量"]);
  });

  it("emits start before end at the same offset", () => {
    const pieces = splitTaggedText("", [
      tag("1s", "start", 0, "b"),
      tag("1e", "end", 0, "b"),
    ]);
    expect(pieces.map((p) => p.text)).toEqual(["b", "/b"]);
  });
});

describe("tagLabel", () => {
  it("marks ends with a slash", () => {
    expect(tagLabel(tag("1", "end", 0, "b"))).toBe("/b");
    expect(tagLabel(tag("1", "start", 0, "i"))).toBe("i");
  });
});
