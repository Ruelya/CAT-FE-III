import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import {
  buildTaggedEditorHtml,
  copySourceTagsToTarget,
  deleteRangeFromTagged,
  deleteRangeKeepingTags,
  pasteTaggedSpan,
  rememberTaggedClip,
  rememberedTaggedClip,
  sliceTaggedSpan,
  insertTextIntoTagged,
  mergeTargetTags,
  alignGhostPositions,
  findAlignedSpan,
  mapTagsToTargetPositions,
  placeSourceTagsAtCaret,
  placeSourceTagsProportional,
  replaceSelectionInTagged,
  serializeTaggedEditor,
  setCaretInTaggedEditor,
  caretOffsetsInTaggedEditor,
  selectTagAtoms,
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

  it("keeps a ghost opening before a real closer at the same offset", () => {
    const pieces = splitTaggedText("ab", [tag("1e", "end", 0, "b")], [
      tag("1s", "start", 0, "b"),
    ]);
    expect(pieces.map((p) => `${p.kind}:${p.text}`)).toEqual([
      "ghost:b",
      "tag:/b",
      "text:ab",
    ]);
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

  it("keeps a start tag put when typing inside a collapsed pair", () => {
    const next = insertTextIntoTagged(
      "ab",
      [tag("1s", "start", 1, "b"), tag("1e", "end", 1, "b")],
      1,
      "XX",
    );
    expect(next.text).toBe("aXXb");
    expect(next.tags.map((item) => item.position)).toEqual([1, 3]);
    expect(next.tags.map((item) => item.kind)).toEqual(["start", "end"]);
  });

  it("drops tags inside a deleted range and shifts the rest", () => {
    const next = deleteRangeFromTagged(
      "abcdef",
      [
        tag("1s", "start", 1, "b"),
        tag("mid", "standalone", 3, "x"),
        tag("1e", "end", 5, "b"),
      ],
      2,
      4,
    );
    expect(next.text).toBe("abef");
    expect(next.tags.map((item) => `${item.id}:${item.position}`)).toEqual([
      "1s:1",
      "1e:3",
    ]);
  });

  it("replaces a selection without using UTF-16 indexes", () => {
    const next = replaceSelectionInTagged(
      "电池容量",
      [tag("1s", "start", 0, "b"), tag("1e", "end", 2, "b")],
      2,
      4,
      "XX",
    );
    expect(next.text).toBe("电池XX");
    expect(next.tags.map((item) => item.position)).toEqual([0, 2]);
  });

  it("keeps replacement text inside a pair that wrapped the selection", () => {
    const next = replaceSelectionInTagged(
      "电池容量",
      [tag("1s", "start", 0, "b"), tag("1e", "end", 4, "b")],
      2,
      4,
      "XX",
    );
    expect(next.text).toBe("电池XX");
    expect(next.tags.map((item) => item.position)).toEqual([0, 4]);
  });

  it("slices a tagged span so pasted tags stay relative to the clip", () => {
    const clip = sliceTaggedSpan(
      "Read the TL-900 guide.",
      [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")],
      9,
      15,
    );
    expect(clip.text).toBe("TL-900");
    expect(clip.tags.map((item) => item.position)).toEqual([0, 6]);
  });

  it("pastes a tagged clip without dropping an existing other pair", () => {
    const next = pasteTaggedSpan(
      "ab",
      [tag("old", "start", 0, "i"), tag("olde", "end", 2, "i")],
      2,
      2,
      {
        text: "XX",
        tags: [tag("1s", "start", 0, "b"), tag("1e", "end", 2, "b")],
      },
    );
    expect(next.text).toBe("abXX");
    expect(next.tags.map((item) => `${item.displayText}:${item.kind}:${item.position}`)).toEqual([
      "i:start:0",
      "b:start:2",
      "i:end:4",
      "b:end:4",
    ]);
  });

  it("reuses an in-app tagged clip when the OS drops custom MIME", () => {
    const clip = { text: "TL-900", tags: [tag("1s", "start", 0, "b")] };
    rememberTaggedClip(clip);
    expect(rememberedTaggedClip("TL-900")?.tags).toHaveLength(1);
    expect(rememberedTaggedClip("other")).toBeNull();
  });

  it("keeps tags when deleting text under Protect Tags", () => {
    const next = deleteRangeKeepingTags(
      "abcdef",
      [tag("1s", "start", 1, "b"), tag("1e", "end", 4, "b")],
      2,
      4,
    );
    expect(next.text).toBe("abef");
    expect(next.tags.map((item) => item.position)).toEqual([1, 2]);
  });

  it("copies source tags onto the target at the same offsets", () => {
    const copied = copySourceTagsToTarget([
      tag("1s", "start", 9, "b"),
      tag("1e", "end", 15, "b"),
    ]);
    expect(copied.map((item) => item.position)).toEqual([9, 15]);
    expect(copied.every((item) => item.side === "target")).toBe(true);
    expect(copied.every((item) => item.id.startsWith("placed-copy:"))).toBe(true);
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

  it("puts the caret after a start capsule at the same offset", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    root.innerHTML = buildTaggedEditorHtml(
      "hello ",
      [tag("1s", "start", 6, "b")],
      [tag("1e", "end", 6, "b")],
    );
    setCaretInTaggedEditor(root, 6);
    const selection = root.ownerDocument.defaultView?.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const start = root.querySelector(".inline-tag--start");
    expect(start).toBeTruthy();
    expect(range && start && range.comparePoint(start, 0) < 0).toBe(true);
    document.body.removeChild(root);
  });

  it("applies formatting to text between a start and end capsule", () => {
    const html = buildTaggedEditorHtml("Read the TL-900 guide.", [
      tag("1s", "start", 9, "b"),
      tag("1e", "end", 15, "b"),
    ]);
    expect(html).toContain('class="tagged-run tagged-run--b"');
    expect(html).toContain("TL-900");
  });

  it("keeps hidden formatting tags in the DOM so serialize still finds them", () => {
    const tags = [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")];
    const html = buildTaggedEditorHtml("Read the TL-900 guide.", tags, [], {
      formatting: "formatted",
      tagText: "partial",
      whitespace: false,
    });
    expect(html).toContain("inline-tag--hidden");
    expect(html).toContain("tagged-run--b");
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(serializeTaggedEditor(root).tags).toHaveLength(2);
  });

  it("marks spaces without changing serialized text", () => {
    const html = buildTaggedEditorHtml("a b", [], [], {
      formatting: "full",
      tagText: "partial",
      whitespace: true,
    });
    expect(html).toContain("ws--space");
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(serializeTaggedEditor(root).text).toBe("a b");
  });

  it("maps a full surface selection to the whole tagged document", () => {
    const tags = [tag("1s", "start", 6, "b"), tag("1e", "end", 10, "b")];
    const host = document.createElement("div");
    host.contentEditable = "true";
    host.innerHTML = buildTaggedEditorHtml("hello bold", tags);
    document.body.append(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(caretOffsetsInTaggedEditor(host, selection)).toEqual({
      start: 0,
      end: 10,
    });
    const clip = sliceTaggedSpan("hello bold", tags, 0, 10);
    expect(clip.text).toBe("hello bold");
    expect(clip.tags).toHaveLength(2);
    host.remove();
  });

  it("selects every atom in an adjacent placeholder group", () => {
    const tags = [tag("p1", "standalone", 4, "ph"), tag("p2", "standalone", 4, "x")];
    const host = document.createElement("div");
    host.innerHTML = buildTaggedEditorHtml("See the unit.", tags);
    document.body.append(host);
    expect(selectTagAtoms(host, ["p1", "p2"])).toBe(true);
    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    const atoms = host.querySelectorAll("[data-tag]");
    expect(atoms).toHaveLength(2);
    expect(selection?.getRangeAt(0).intersectsNode(atoms[0]!)).toBe(true);
    expect(selection?.getRangeAt(0).intersectsNode(atoms[1]!)).toBe(true);
    host.remove();
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
