import { describe, expect, it } from "vitest";

import {
  clearSessionStorage,
  makeSession,
  parseSession,
  readSessionFromStorage,
  serializeSession,
  SESSION_STORAGE_KEY,
  writeSessionToStorage,
} from "./session";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

describe("session parser", () => {
  it("rejects missing, malformed, and unsupported values", () => {
    expect(parseSession(null).ok).toBe(false);
    expect(parseSession("").ok).toBe(false);
    expect(parseSession("not-json").ok).toBe(false);
    expect(parseSession("null").ok).toBe(false);
    expect(parseSession("[]").ok).toBe(false);
    expect(
      parseSession(
        JSON.stringify({ version: 2, projectId: "p", documentId: "d" }),
      ).ok,
    ).toBe(false);
    expect(
      parseSession(
        JSON.stringify({ version: 1, projectId: "", documentId: "d" }),
      ).ok,
    ).toBe(false);
    expect(
      parseSession(
        JSON.stringify({ version: 1, projectId: "p", documentId: "  " }),
      ).ok,
    ).toBe(false);
  });

  it("accepts a valid identity and round-trips serialization", () => {
    const session = makeSession("proj-1", "doc-1");
    const raw = serializeSession(session);
    const parsed = parseSession(raw);
    expect(parsed).toEqual({ ok: true, session });
  });

  it("reads and clears storage", () => {
    const storage = memoryStorage();
    writeSessionToStorage(makeSession("p", "d"), storage);
    expect(readSessionFromStorage(storage)).toEqual({
      ok: true,
      session: makeSession("p", "d"),
    });
    clearSessionStorage(storage);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
