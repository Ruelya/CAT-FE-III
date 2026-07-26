import { describe, expect, it } from "vitest";

import {
  HOST_API_VERSION,
  validateManifest,
  type PluginManifest,
} from "./index.js";

const base: PluginManifest = {
  manifestVersion: 1,
  id: "example.hello-srt",
  displayName: "Hello SRT",
  version: "0.1.0",
  apiVersion: HOST_API_VERSION,
  apiVersionMin: 1,
  tier: "process",
  entry: { kind: "node", path: "bin/hello-srt.mjs" },
  contributions: {
    filters: [
      {
        id: "example.hello-srt",
        version: "0.1.0",
        displayName: "Hello SRT",
        extensions: ["srt"],
        capabilities: {
          import: true,
          export: true,
          validate: true,
          inlineTags: false,
          notes: false,
          degradationReport: true,
        },
      },
    ],
  },
  permissions: ["file.read:source", "file.write:output"],
};

describe("plugin-sdk manifest validation", () => {
  it("accepts a valid hello-srt style manifest", () => {
    expect(validateManifest(base)).toEqual([]);
  });

  it("rejects builtin ids", () => {
    expect(validateManifest({ ...base, id: "builtin.x" }).join(" ")).toContain(
      "builtin",
    );
  });
});
