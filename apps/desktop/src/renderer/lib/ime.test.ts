import { describe, expect, it, vi } from "vitest";

import {
  createCompositionState,
  isImeKeyboardEvent,
  onCompositionEnd,
  onCompositionStart,
  shouldBlockConfirm,
} from "./ime";

describe("IME guards", () => {
  it("blocks during composition lifecycle", () => {
    const state = createCompositionState();
    expect(shouldBlockConfirm(state)).toBe(false);
    onCompositionStart(state);
    expect(shouldBlockConfirm(state)).toBe(true);
    onCompositionEnd(state);
    expect(shouldBlockConfirm(state)).toBe(false);
  });

  it("blocks isComposing and keyCode/which 229", () => {
    const state = createCompositionState();
    expect(isImeKeyboardEvent({ isComposing: true })).toBe(true);
    expect(isImeKeyboardEvent({ keyCode: 229 })).toBe(true);
    expect(isImeKeyboardEvent({ which: 229 })).toBe(true);
    expect(shouldBlockConfirm(state, { isComposing: true })).toBe(true);
    expect(shouldBlockConfirm(state, { keyCode: 229 })).toBe(true);
    expect(shouldBlockConfirm(state, { which: 229 })).toBe(true);
  });

  it("blocks while a confirm is already pending", () => {
    const state = createCompositionState();
    expect(shouldBlockConfirm(state, null, true)).toBe(true);
  });

  it("allows confirm after composition ends", () => {
    const state = createCompositionState();
    const action = vi.fn();
    onCompositionStart(state);
    if (!shouldBlockConfirm(state)) action();
    expect(action).not.toHaveBeenCalled();
    onCompositionEnd(state);
    if (!shouldBlockConfirm(state, { isComposing: false })) {
      action();
    }
    expect(action).toHaveBeenCalledTimes(1);
  });
});
