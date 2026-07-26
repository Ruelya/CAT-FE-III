import test from "node:test";
import assert from "node:assert/strict";

function validateManifest(manifest) {
  const errors = [];
  if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1");
  if (!manifest.id?.trim()) errors.push("id is required");
  if (manifest.id?.startsWith("builtin."))
    errors.push("id must not use builtin. prefix");
  if (!manifest.contributions?.filters?.length) {
    errors.push("at least one filter contribution is required");
  }
  return errors;
}

test("accepts valid manifest", () => {
  assert.deepEqual(
    validateManifest({
      manifestVersion: 1,
      id: "example.hello-srt",
      contributions: { filters: [{ id: "example.hello-srt" }] },
    }),
    [],
  );
});

test("rejects builtin", () => {
  assert.match(
    validateManifest({
      manifestVersion: 1,
      id: "builtin.x",
      contributions: { filters: [{ id: "x" }] },
    }).join(" "),
    /builtin/,
  );
});
