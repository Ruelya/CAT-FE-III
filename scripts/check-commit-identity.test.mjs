import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_NAME,
  issuesForCommit,
  issuesForMessage,
  parseIdent,
} from "./check-commit-identity.mjs";

const allowed = {
  authorName: ALLOWED_NAME,
  authorEmail: "239264465+Ruelya@users.noreply.github.com",
  committerName: ALLOWED_NAME,
  committerEmail: "239264465+Ruelya@users.noreply.github.com",
  message: "feat: something\n",
};

describe("parseIdent", () => {
  it("reads name, email, and optional timestamp", () => {
    const ident = parseIdent(
      "Ruelya <239264465+Ruelya@users.noreply.github.com> 1700000000 +0000",
    );
    assert.equal(ident.name, "Ruelya");
    assert.equal(ident.email, "239264465+Ruelya@users.noreply.github.com");
  });
});

describe("issuesForMessage", () => {
  it("rejects Co-authored-by trailers", () => {
    const issues = issuesForMessage(
      "fix: thing\n\nCo-authored-by: Ruelya <239264465+Ruelya@users.noreply.github.com>\n",
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0], /Co-author/);
  });

  it("rejects ruelya.miko in the message body", () => {
    const issues = issuesForMessage("chore: ping ruelya.miko@gmail.com\n");
    assert.equal(issues.length, 1);
    assert.match(issues[0], /ruelya\.miko/);
  });

  it("accepts a plain subject", () => {
    assert.deepEqual(issuesForMessage("fix: windows titlebar\n"), []);
  });
});

describe("issuesForCommit", () => {
  it("accepts the GitHub noreply identity on both sides", () => {
    assert.deepEqual(issuesForCommit(allowed), []);
  });

  it("accepts the account-name noreply form", () => {
    assert.deepEqual(
      issuesForCommit({
        ...allowed,
        authorEmail: "Ruelya@users.noreply.github.com",
        committerEmail: "Ruelya@users.noreply.github.com",
      }),
      [],
    );
  });

  it("rejects ruelya.miko as author", () => {
    const issues = issuesForCommit({
      ...allowed,
      authorName: "ShiroSugar",
      authorEmail: "ruelya.miko@gmail.com",
    });
    assert.ok(issues.some((issue) => /ruelya\.miko/.test(issue)));
  });

  it("rejects Cursor Agent as committer", () => {
    const issues = issuesForCommit({
      ...allowed,
      committerName: "Cursor Agent",
      committerEmail: "cursoragent@cursor.com",
    });
    assert.ok(issues.some((issue) => /Cursor Agent/.test(issue)));
  });

  it("rejects a Co-author trailer even when the identity is otherwise allowed", () => {
    const issues = issuesForCommit({
      ...allowed,
      message: "feat: x\n\nCo-authored-by: Someone <dev@example.com>\n",
    });
    assert.ok(issues.some((issue) => /Co-author/.test(issue)));
  });
});
