import { describe, expect, it } from "vitest";

import {
  assertHostArchOnly,
  engineBinaryMatchesPlatform,
  expectedEngineBinaryName,
  MAX_PACKAGE_BYTES,
  noLoginRequired,
  packageSizeOk,
  readinessOk,
  resolvePackageArch,
} from "./package-readiness.js";

describe("package readiness gates", () => {
  it("enforces the 200 MB artifact gate", () => {
    expect(packageSizeOk(MAX_PACKAGE_BYTES)).toBe(true);
    expect(packageSizeOk(MAX_PACKAGE_BYTES + 1)).toBe(false);
  });

  it("enforces the three-minute readiness gate", () => {
    expect(readinessOk(179_000, true)).toBe(true);
    expect(readinessOk(181_000, true)).toBe(false);
    expect(readinessOk(1_000, false)).toBe(false);
  });

  it("records no-login by default", () => {
    expect(noLoginRequired({})).toBe(true);
  });

  it("names the platform Engine binary", () => {
    expect(expectedEngineBinaryName("win32")).toBe("translunar-engine.exe");
    expect(expectedEngineBinaryName("darwin")).toBe("translunar-engine");
    expect(expectedEngineBinaryName("linux")).toBe("translunar-engine");
  });

  it("matches engine binary names against the platform", () => {
    expect(engineBinaryMatchesPlatform("translunar-engine.exe", "win32")).toBe(
      true,
    );
    expect(engineBinaryMatchesPlatform("translunar-engine", "darwin")).toBe(
      true,
    );
    expect(engineBinaryMatchesPlatform("translunar-engine", "win32")).toBe(
      false,
    );
    expect(
      engineBinaryMatchesPlatform(
        "resources/engine/translunar-engine",
        "linux",
      ),
    ).toBe(true);
  });

  it("resolves package arch from env overrides and host arch", () => {
    expect(
      resolvePackageArch({ TRANSLUNAR_PACKAGE_ARCH: "amd64" }, "arm64"),
    ).toBe("x64");
    expect(resolvePackageArch({ PROCESSOR_ARCHITECTURE: "ARM64" }, "x64")).toBe(
      "arm64",
    );
    expect(resolvePackageArch({}, "x64")).toBe("x64");
  });

  it("requires package arch to match the host", () => {
    expect(assertHostArchOnly("x64", "x64")).toBe(true);
    expect(assertHostArchOnly("amd64", "x64")).toBe(true);
    expect(assertHostArchOnly("arm64", "x64")).toBe(false);
  });
});
