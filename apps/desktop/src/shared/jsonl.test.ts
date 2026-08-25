import { describe, expect, it, vi } from "vitest";

import { createJsonlDecoder, encodeJsonlFrame } from "./jsonl.js";

describe("createJsonlDecoder", () => {
  it("decodes frames split across chunks", () => {
    const frames: unknown[] = [];
    const decoder = createJsonlDecoder((frame) => frames.push(frame));
    decoder.push('{"id":1,"resu');
    decoder.push('lt":true}\n{"id":2');
    expect(frames).toEqual([{ id: 1, result: true }]);
    decoder.push(',"result":false}\n');
    expect(frames).toEqual([
      { id: 1, result: true },
      { id: 2, result: false },
    ]);
    expect(decoder.pending()).toBe("");
  });

  it("decodes multiple frames in one chunk and skips blank lines", () => {
    const frames: unknown[] = [];
    const decoder = createJsonlDecoder((frame) => frames.push(frame));
    decoder.push('{"a":1}\n\n{"b":2}\n');
    expect(frames).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reports invalid lines without dropping later frames", () => {
    const frames: unknown[] = [];
    const onError = vi.fn();
    const decoder = createJsonlDecoder((frame) => frames.push(frame), onError);
    decoder.push('not-json\n{"ok":true}\n');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([{ ok: true }]);
  });
});

describe("encodeJsonlFrame", () => {
  it("terminates every frame with a newline", () => {
    expect(encodeJsonlFrame({ id: 7 })).toBe('{"id":7}\n');
  });
});
