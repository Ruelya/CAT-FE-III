import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(
  root,
  "examples",
  "plugins",
  "external-connector-fixture",
);

describe("external connector fixture package", () => {
  it("ships a public-sdk-only process fixture with closed V1 operations", () => {
    const manifest = JSON.parse(
      readFileSync(join(fixtureDir, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.id, "example.external-connector-fixture");
    const contribution = manifest.contributions.find(
      (item) => item.kind === "externalConnector",
    );
    assert.ok(contribution);
    assert.equal(contribution.protocol, "translunar.externalConnector.v1");
    assert.equal(contribution.contractVersion, 1);
    for (const operation of [
      "validateConfig",
      "test",
      "pull",
      "push",
      "poll",
      "webhook",
    ]) {
      assert.ok(contribution.operations.includes(operation));
    }
    assert.deepEqual(contribution.origins, ["http://127.0.0.1:43124"]);
    const source = readFileSync(join(fixtureDir, "src", "index.ts"), "utf8");
    assert.match(source, /@translunar\/plugin-sdk/);
    assert.doesNotMatch(
      source,
      /(?:crates\/|packages\/contracts|apps\/desktop)/u,
    );
    assert.doesNotMatch(source, /outbox|DurableJob|webhook listener/u);
  });

  it("documents the automation boundary", () => {
    const readme = readFileSync(join(fixtureDir, "README.md"), "utf8");
    assert.match(readme, /automation/i);
    assert.match(readme, /does \*\*not\*\* own/i);
    const docs = readFileSync(
      join(root, "docs", "plugins", "external-connector-sdk.md"),
      "utf8",
    );
    assert.match(docs, /out of scope/i);
    assert.match(docs, /externalConnector\.invoke/);
    assert.match(docs, /translunar-cat\.external-connector/);
  });
});
