import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import {
  buildTaggedEditorHtml,
  insertTextIntoTagged,
  mergeTargetTags,
  alignGhostPositions,
  findAlignedSpan,
  mapTagsToTargetPositions,
  placeSourceTagsAtCaret,
  placeSourceTagsProportional,
  serializeTaggedEditor,
  splitTaggedText,
  tagLabel,
  tagsEqual,
  wrapSelectionWithTagPair,
} from "./tagged-text";

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

describe("placeSourceTags", () => {
  it("scales offsets onto a shorter target", () => {
    const placed = placeSourceTagsProportional(
      [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")],
      22,
      11,
    );
    expect(placed.map((item) => item.position)).toEqual([5, 8]);
    expect(placed.every((item) => item.side === "target")).toBe(true);
  });

  it("drops every tag at the caret for QuickPlace", () => {
    const placed = placeSourceTagsAtCaret(
      [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")],
      4,
    );
    expect(placed.map((item) => item.position)).toEqual([4, 4]);
  });

  it("wraps a selection with a start/end pair", () => {
    const wrapped = wrapSelectionWithTagPair(
      tag("1s", "start", 9, "b"),
      tag("1e", "end", 15, "b"),
      3,
      8,
    );
    expect(wrapped.map((item) => item.position)).toEqual([3, 8]);
    expect(wrapped.map((item) => item.kind)).toEqual(["start", "end"]);
  });

  it("shifts later tags when text is inserted at the caret", () => {
    const next = insertTextIntoTagged(
      "ab",
      [tag("1s", "start", 2, "b")],
      1,
      "XX",
    );
    expect(next.text).toBe("aXXb");
    expect(next.tags[0]?.position).toBe(4);
  });

  it("replaces a carried tag of the same kind when merging", () => {
    const merged = mergeTargetTags(
      [{ ...tag("old", "start", 1, "b"), side: "target" }],
      [{ ...tag("new", "start", 4, "b"), side: "target" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.position).toBe(4);
  });
});

describe("tagged editor html", () => {
  it("round-trips text and tag offsets through the DOM", () => {
    const tags = [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")];
    const root = document.createElement("div");
    root.innerHTML = buildTaggedEditorHtml("Read the TL-900 guide.", tags);
    const serialized = serializeTaggedEditor(root);
    expect(serialized.text).toBe("Read the TL-900 guide.");
    expect(serialized.tags.map((item) => item.position)).toEqual([9, 15]);
    expect(serialized.tags.map((item) => item.id)).toEqual(["1s", "1e"]);
    expect(serialized.tags[0]?.side).toBe("target");
    expect(
      tagsEqual(serialized.tags, [
        { ...tags[0]!, side: "target", position: 9 },
        { ...tags[1]!, side: "target", position: 15 },
      ]),
    ).toBe(true);
  });

  it("overlays ghosts at expected offsets without serializing them", () => {
    const ghosts = mapTagsToTargetPositions(
      [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")],
      22,
      11,
    );
    const root = document.createElement("div");
    root.innerHTML = buildTaggedEditorHtml("你好电源站。", [], ghosts);
    expect(root.querySelectorAll("[data-ghost]")).toHaveLength(2);
    expect(root.querySelector('[data-testid="ghost-tag-1s"]')?.textContent).toBe(
      "b",
    );
    const serialized = serializeTaggedEditor(root);
    expect(serialized.text).toBe("你好电源站。");
    expect(serialized.tags).toEqual([]);
  });
});

describe("mapTagsToTargetPositions", () => {
  it("keeps source ids while scaling offsets", () => {
    const mapped = mapTagsToTargetPositions(
      [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")],
      22,
      11,
    );
    expect(mapped.map((item) => item.id)).toEqual(["1s", "1e"]);
    expect(mapped.map((item) => item.position)).toEqual([5, 8]);
  });
});

describe("alignGhostPositions", () => {
  it("wraps a shared token instead of a proportional guess", () => {
    const source = "Read the TL-900 guide.";
    const target = "请阅读 TL-900 指南。";
    const aligned = alignGhostPositions(source, target, [
      { ...tag("1s", "start", 9, "b"), pairId: "p1" },
      { ...tag("1e", "end", 15, "b"), pairId: "p1" },
    ]);
    expect(findAlignedSpan("TL-900", target)).toEqual({ start: 4, end: 10 });
    expect(aligned.map((item) => item.position)).toEqual([4, 10]);
  });
});
