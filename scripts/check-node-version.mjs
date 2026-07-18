const [major, minor] = process.versions.node
  .split(".")
  .slice(0, 2)
  .map((value) => Number.parseInt(value, 10));

if (major !== 22 || (minor ?? 0) < 17) {
  console.error(
    `Translunar requires Node.js 22.17.x or newer 22.x; found ${process.versions.node}. ` +
      "Electron 39 does not install reliably under Node.js 24.",
  );
  process.exit(1);
}
