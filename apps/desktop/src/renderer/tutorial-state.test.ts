import { describe, expect, it } from "vitest";

import {
  tutorialReducer,
  TUTORIAL_FLOW,
  type TutorialReducerState,
} from "./tutorial-state";

describe("tutorial reducer", () => {
  it("walks forward, back, skip, and restart", () => {
    let state: TutorialReducerState = {
      step: "welcome",
      skipped: false,
      completed: false,
    };
    state = tutorialReducer(state, { type: "next" });
    expect(state.step).toBe("create");
    state = tutorialReducer(state, { type: "back" });
    expect(state.step).toBe("welcome");
    state = tutorialReducer(state, { type: "skip" });
    expect(state.skipped).toBe(true);
    expect(state.completed).toBe(true);
    state = tutorialReducer(state, { type: "restart" });
    expect(state).toEqual({
      step: "welcome",
      skipped: false,
      completed: false,
    });

    state = tutorialReducer(
      { step: "export", skipped: false, completed: false },
      { type: "next" },
    );
    expect(state).toEqual({
      step: "complete",
      skipped: false,
      completed: false,
    });
    state = tutorialReducer(state, { type: "complete" });
    expect(state.completed).toBe(true);
  });

  it("covers the full bilingual guided sequence", () => {
    expect(TUTORIAL_FLOW).toEqual([
      "welcome",
      "create",
      "import",
      "edit",
      "qa",
      "export",
      "complete",
    ]);
  });
});
