#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const hooksPath = ".githooks";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  process.exit(0);
}

execFileSync("git", ["config", "core.hooksPath", hooksPath], {
  stdio: "ignore",
});
console.log(`git config core.hooksPath ${resolve(hooksPath)}`);
