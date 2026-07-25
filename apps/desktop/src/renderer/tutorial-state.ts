import type { TutorialStep } from "../shared/product-shell";

export type TutorialAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "skip" }
  | { type: "restart" }
  | { type: "goto"; step: TutorialStep }
  | { type: "complete" };

export const TUTORIAL_FLOW: TutorialStep[] = [
  "welcome",
  "create",
  "import",
  "edit",
  "qa",
  "export",
  "complete",
];

export interface TutorialReducerState {
  step: TutorialStep;
  skipped: boolean;
  completed: boolean;
}

export function tutorialReducer(
  state: TutorialReducerState,
  action: TutorialAction,
): TutorialReducerState {
  switch (action.type) {
    case "next": {
      const index = TUTORIAL_FLOW.indexOf(state.step);
      const next =
        TUTORIAL_FLOW[Math.min(index + 1, TUTORIAL_FLOW.length - 1)]!;
      return {
        ...state,
        step: next,
        completed: false,
      };
    }
    case "back": {
      const index = TUTORIAL_FLOW.indexOf(state.step);
      const prev = TUTORIAL_FLOW[Math.max(index - 1, 0)]!;
      return { ...state, step: prev, completed: false };
    }
    case "skip":
      return { ...state, skipped: true, completed: true, step: "complete" };
    case "restart":
      return { step: "welcome", skipped: false, completed: false };
    case "goto":
      return {
        ...state,
        step: action.step,
        completed: false,
      };
    case "complete":
      return { ...state, completed: true, step: "complete" };
    default:
      return state;
  }
}

export function tutorialTargetId(step: TutorialStep): string | null {
  switch (step) {
    case "create":
      return "tutorial-target-create";
    case "import":
      return "tutorial-target-import";
    case "edit":
      return "tutorial-target-edit";
    case "qa":
      return "tutorial-target-qa";
    case "export":
      return "tutorial-target-export";
    default:
      return null;
  }
}
