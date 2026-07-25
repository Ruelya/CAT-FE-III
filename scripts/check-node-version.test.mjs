import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedNodeVersion,
  parseNodeVersion,
  unsupportedNodeVersionMessage,
} from "./check-node-version.mjs";

test("accepts the supported Node 22 release lane", () => {
  assert.equal(isSupportedNodeVersion("22.16.9"), false);
  assert.equal(isSupportedNodeVersion("22.17.0"), true);
  assert.equal(isSupportedNodeVersion("22.99.0"), true);
});

test("accepts Node 24 and rejects adjacent unsupported majors", () => {
  assert.equal(isSupportedNodeVersion("23.11.1"), false);
  assert.equal(isSupportedNodeVersion("24.0.0"), true);
  assert.equal(isSupportedNodeVersion("24.17.0"), true);
  assert.equal(isSupportedNodeVersion("25.0.0"), false);
});

test("rejects malformed and prerelease version strings deterministically", () => {
  assert.equal(parseNodeVersion("v24.17.0"), null);
  assert.equal(parseNodeVersion("24.17"), null);
  assert.equal(parseNodeVersion("24.17.0-rc.1"), null);
  assert.equal(isSupportedNodeVersion("not-a-version"), false);
});

test("reports the complete support policy", () => {
  assert.match(unsupportedNodeVersionMessage("25.0.0"), /22\.17\.x/iu);
  assert.match(unsupportedNodeVersionMessage("25.0.0"), /24\.x/iu);
  assert.match(unsupportedNodeVersionMessage("25.0.0"), /25\.0\.0/iu);
});
