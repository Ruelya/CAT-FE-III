const PE_MACHINE = {
  0x014c: "ia32",
  0x8664: "x64",
  0xaa64: "arm64",
};

const MACH_CPU = {
  0x00000007: "ia32",
  0x01000007: "x64",
  0x0100000c: "arm64",
};

const ELF_MACHINE = {
  3: "ia32",
  62: "x64",
  183: "arm64",
};

export function normalizeArch(value) {
  const lower = String(value).toLowerCase();
  if (["x64", "amd64", "x86_64", "x86-64"].includes(lower)) return "x64";
  if (["arm64", "aarch64", "arm64e"].includes(lower)) return "arm64";
  if (["ia32", "x86", "i386", "i686"].includes(lower)) return "ia32";
  return lower;
}

export function expectedEngineBinaryName(platform = process.platform) {
  return platform === "win32" ? "translunar-engine.exe" : "translunar-engine";
}

/**
 * Return an error message when a packaging target cannot be produced on the
 * current host platform, or null when the target is allowed. `--win` requires
 * a Windows host and `--mac` requires a macOS host, because cross-platform
 * builds would bundle the wrong-named host Engine binary (translunar-engine vs
 * translunar-engine.exe) with no early failure. `dir` is host-neutral.
 */
export function crossPlatformPackagingError(
  target,
  platform = process.platform,
) {
  if (target === "win" && platform !== "win32") {
    return `--win packaging requested on ${platform}. Cross-platform packaging is not supported.`;
  }
  if (target === "mac" && platform !== "darwin") {
    return `--mac packaging requested on ${platform}. Cross-platform packaging is not supported.`;
  }
  return null;
}

export function detectExecutableArch(bytes, platform = process.platform) {
  const view = asDataView(bytes);
  if (platform === "win32") return detectPeArch(view);
  if (platform === "darwin") return detectMachArch(view);
  return detectElfArch(view);
}

function detectPeArch(view) {
  if (
    view.byteLength < 0x40 ||
    view.getUint8(0) !== 0x4d ||
    view.getUint8(1) !== 0x5a
  ) {
    return "unknown";
  }
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 6 > view.byteLength) return "unknown";
  if (view.getUint32(peOffset, true) !== 0x00004550) return "unknown";
  return PE_MACHINE[view.getUint16(peOffset + 4, true)] ?? "unknown";
}

function detectMachArch(view) {
  if (view.byteLength < 8) return "unknown";
  const magicLittle = view.getUint32(0, true);
  const magicBig = view.getUint32(0, false);
  if (
    magicBig === 0xcafebabe ||
    magicBig === 0xcafebabf ||
    magicLittle === 0xcafebabe ||
    magicLittle === 0xcafebabf
  ) {
    return "universal";
  }
  if (magicLittle === 0xfeedface || magicLittle === 0xfeedfacf) {
    return MACH_CPU[view.getUint32(4, true)] ?? "unknown";
  }
  if (magicBig === 0xfeedface || magicBig === 0xfeedfacf) {
    return MACH_CPU[view.getUint32(4, false)] ?? "unknown";
  }
  return "unknown";
}

function detectElfArch(view) {
  if (
    view.byteLength < 20 ||
    view.getUint8(0) !== 0x7f ||
    view.getUint8(1) !== 0x45 ||
    view.getUint8(2) !== 0x4c ||
    view.getUint8(3) !== 0x46
  ) {
    return "unknown";
  }
  const byteOrder = view.getUint8(5);
  if (byteOrder !== 1 && byteOrder !== 2) return "unknown";
  return ELF_MACHINE[view.getUint16(18, byteOrder === 1)] ?? "unknown";
}

function asDataView(bytes) {
  if (bytes instanceof Uint8Array) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new TypeError("Executable bytes must be a Uint8Array.");
}
