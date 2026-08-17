import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import { reconstructWithPayloads } from "./preview-reconstruct";

function tag(
  kind: InlineTag["kind"],
  position: number,
  payload: string,
  displayText = payload,
): InlineTag {
  return {
    id: `${kind}-${position}`,
    kind,
    position,
    displayText,
    side: "source",
    payload,
    protected: true,
  };
}

describe("reconstructWithPayloads", () => {
  it("restores a markdown heading prefix from the standalone payload", () => {
    expect(
      reconstructWithPayloads("Title", [tag("standalone", 0, "# ")], false),
    ).toBe("# Title");
  });

  it("restores HTML pairs and escapes text when asked", () => {
    const html = reconstructWithPayloads(
      "a<b>",
      [tag("start", 0, "<em>", "<i>"), tag("end", 4, "</em>", "</i>")],
      true,
    );
    expect(html).toBe("<em>a&lt;b&gt;</em>");
  });
});
