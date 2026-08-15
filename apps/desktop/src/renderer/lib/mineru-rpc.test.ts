import { describe, expect, it } from "vitest";

import {
  MINERU_CREDENTIAL_METHODS,
  isMinerUCredentialMethod,
} from "../../shared/mineru-rpc";

describe("mineru RPC allowlist", () => {
  it("names the three Engine credential methods", () => {
    expect(MINERU_CREDENTIAL_METHODS).toEqual([
      "mineru.credential.set",
      "mineru.credential.status",
      "mineru.credential.delete",
    ]);
    expect(isMinerUCredentialMethod("mineru.credential.status")).toBe(true);
    expect(isMinerUCredentialMethod("ai.run.start")).toBe(false);
  });
});
