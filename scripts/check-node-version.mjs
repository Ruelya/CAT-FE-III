import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MINIMUM_NODE_22_MINOR = 17;

export function parseNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function isSupportedNodeVersion(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  return (
    (parsed.major === 22 && parsed.minor >= MINIMUM_NODE_22_MINOR) ||
    parsed.major === 24
  );
}

export function unsupportedNodeVersionMessage(version) {
  return (
    "Translunar requires Node.js 22.17.x or newer 22.x, or Node.js 24.x; " +
    `found ${version}. Node.js 23.x, 25.x, and other majors are not supported.`
  );
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule() && !isSupportedNodeVersion(process.versions.node)) {
  console.error(unsupportedNodeVersionMessage(process.versions.node));
  process.exitCode = 1;
}
