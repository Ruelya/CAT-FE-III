#!/usr/bin/env node
// Enforce the only allowed git identity for this repository:
//   Ruelya <239264465+Ruelya@users.noreply.github.com>
// Reject Co-authored-by trailers and the ruelya.miko / Cursor Agent identities.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ALLOWED_NAME = "Ruelya";
export const ALLOWED_EMAILS = [
  "239264465+ruelya@users.noreply.github.com",
  "ruelya@users.noreply.github.com",
];

const ZERO_SHA = "0".repeat(40);

export function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

export function parseIdent(ident) {
  const text = String(ident ?? "").trim();
  const match = text.match(/^(.*)\s+<([^>]+)>(?:\s+\d+\s+[+-]\d{4})?$/);
  if (!match) {
    return { name: text, email: "" };
  }
  return { name: match[1].trim(), email: match[2].trim() };
}

function isAllowedEmail(email) {
  return ALLOWED_EMAILS.includes(normalizeEmail(email));
}

function identityIssues(role, name, email) {
  const issues = [];
  const folded = `${name} <${email}>`;
  if (/ruelya\.miko/i.test(folded)) {
    issues.push(`${role} uses the forbidden ruelya.miko identity: ${folded}`);
  }
  if (/cursoragent@cursor\.com/i.test(email) || /^cursor agent$/i.test(name)) {
    issues.push(`${role} uses the Cursor Agent identity: ${folded}`);
  }
  if (name !== ALLOWED_NAME) {
    issues.push(
      `${role} name must be exactly "${ALLOWED_NAME}" (got "${name}")`,
    );
  }
  if (!isAllowedEmail(email)) {
    issues.push(
      `${role} email must be 239264465+Ruelya@users.noreply.github.com (got "${email}")`,
    );
  }
  return issues;
}

export function issuesForMessage(message) {
  const issues = [];
  const lines = String(message ?? "").split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*co-authored-by:/i.test(line) || /^\s*co-author:/i.test(line)) {
      issues.push(
        `commit message contains a forbidden Co-author trailer: ${line.trim()}`,
      );
    }
    if (/ruelya\.miko/i.test(line)) {
      issues.push(`commit message mentions the forbidden ruelya.miko identity`);
    }
  }
  return issues;
}

export function issuesForCommit({
  authorName,
  authorEmail,
  committerName,
  committerEmail,
  message,
}) {
  return [
    ...identityIssues("author", authorName, authorEmail),
    ...identityIssues("committer", committerName, committerEmail),
    ...issuesForMessage(message),
  ];
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function checkIdentFromEnv() {
  const author = parseIdent(git(["var", "GIT_AUTHOR_IDENT"]));
  const committer = parseIdent(git(["var", "GIT_COMMITTER_IDENT"]));
  return issuesForCommit({
    authorName: author.name,
    authorEmail: author.email,
    committerName: committer.name,
    committerEmail: committer.email,
    message: "",
  });
}

function checkRange(range) {
  const text = String(range);
  if (!text.includes("..")) {
    return checkRevList(text || "HEAD");
  }
  const [rawStart, rawEnd] = text.split("..");
  const start = !rawStart || /^0+$/.test(rawStart) ? "" : rawStart;
  const end = rawEnd && !/^0+$/.test(rawEnd) ? rawEnd : "HEAD";
  const spec = start ? `${start}..${end}` : end;
  return checkRevList(spec);
}

function checkRevList(spec) {
  const shas = git(["rev-list", spec])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const issues = [];
  for (const sha of shas) {
    const authorName = git(["show", "-s", "--format=%an", sha]);
    const authorEmail = git(["show", "-s", "--format=%ae", sha]);
    const committerName = git(["show", "-s", "--format=%cn", sha]);
    const committerEmail = git(["show", "-s", "--format=%ce", sha]);
    const message = git(["show", "-s", "--format=%B", sha]);
    for (const issue of issuesForCommit({
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      message,
    })) {
      issues.push(`${sha.slice(0, 7)}: ${issue}`);
    }
  }
  return issues;
}

function parseArgs(argv) {
  const options = {
    messageFile: "",
    checkIdent: false,
    range: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--message-file") {
      options.messageFile = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--check-ident") {
      options.checkIdent = true;
    } else if (arg === "--range") {
      options.range = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--help") {
      options.help = true;
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: check-commit-identity.mjs [--message-file FILE] [--check-ident] [--range A..B]",
    );
    return 0;
  }
  const issues = [];
  if (options.messageFile) {
    issues.push(...issuesForMessage(readFileSync(options.messageFile, "utf8")));
  }
  if (options.checkIdent) {
    issues.push(...checkIdentFromEnv());
  }
  if (options.range) {
    issues.push(...checkRange(options.range));
  }
  if (issues.length > 0) {
    console.error("Commit identity check failed:");
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    return 1;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.exit(main());
}

export { ZERO_SHA, main };
