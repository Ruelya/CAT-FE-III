import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
} from "../test/fake-desktop-api";
import {
  mineruCredentialDelete,
  mineruCredentialSet,
  mineruCredentialStatus,
} from "./mineru-credential";

describe("mineru credential wrapper", () => {
  beforeEach(() => {
    window.translunar = createFakeDesktopApi(createFakeEngineState());
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("reports absence, then presence, then absence again", async () => {
    await expect(mineruCredentialStatus()).resolves.toEqual({
      available: true,
      present: false,
      backend: "memory",
    });

    await expect(mineruCredentialSet("sk-test")).resolves.toEqual({
      available: true,
      present: true,
      backend: "memory",
    });
    await expect(mineruCredentialStatus()).resolves.toMatchObject({
      present: true,
    });

    await expect(mineruCredentialDelete()).resolves.toMatchObject({
      present: false,
    });
  });
});
