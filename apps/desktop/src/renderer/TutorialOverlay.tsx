import { useCallback, useEffect, useReducer, useRef } from "react";

import { useLocale } from "./i18n/LocaleProvider";
import {
  tutorialReducer,
  tutorialTargetId,
  TUTORIAL_FLOW,
  type TutorialReducerState,
} from "./tutorial-state";
import type { TutorialState } from "../shared/product-shell";
import { useFocusTrap } from "./useFocusTrap";

interface TutorialOverlayProps {
  initial: TutorialState;
  onChange: (state: TutorialReducerState) => void;
  onOpenExample: () => void;
}

export function TutorialOverlay({
  initial,
  onChange,
  onOpenExample,
}: TutorialOverlayProps) {
  const { t } = useLocale();
  const [state, dispatch] = useReducer(tutorialReducer, {
    step: initial.step,
    skipped: initial.skipped,
    completed: initial.completed,
  });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const hidden = state.completed || state.skipped;

  const skipTutorial = useCallback(() => {
    dispatch({ type: "skip" });
  }, []);

  useFocusTrap(dialogRef, {
    active: !hidden,
    onEscape: skipTutorial,
  });

  useEffect(() => {
    onChange(state);
  }, [state, onChange]);

  useEffect(() => {
    if (hidden) return;
    const targetId = tutorialTargetId(state.step);
    if (!targetId) return;
    let target: HTMLElement | null = null;
    let previousDescription: string | null = null;
    const advance = () => dispatch({ type: "next" });
    const detach = () => {
      if (!target) return;
      target.classList.remove("tutorial-target-active");
      target.removeEventListener("click", advance);
      if (previousDescription === null) {
        target.removeAttribute("aria-describedby");
      } else {
        target.setAttribute("aria-describedby", previousDescription);
      }
      target = null;
    };
    const attach = () => {
      const nextTarget = document.getElementById(targetId);
      if (!nextTarget || nextTarget === target) return;
      detach();
      target = nextTarget;
      previousDescription = target.getAttribute("aria-describedby");
      target.classList.add("tutorial-target-active");
      target.setAttribute("aria-describedby", "tutorial-dialog-body");
      target.addEventListener("click", advance, { once: true });
      target.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [hidden, state.step]);

  if (hidden) return null;

  const index = Math.max(0, TUTORIAL_FLOW.indexOf(state.step));
  const titleKey = titleFor(state.step);
  const bodyKey = bodyFor(state.step);
  const targetId = tutorialTargetId(state.step);

  return (
    <div className="tutorial-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="tutorial-dialog"
        role="dialog"
        aria-modal="false"
        aria-label={t("aria.tutorialOverlay")}
      >
        <p className="surface-kicker">
          {t("tutorial.progress", {
            current: index + 1,
            total: TUTORIAL_FLOW.length,
          })}
        </p>
        <h2>{t(titleKey)}</h2>
        <p id="tutorial-dialog-body">{t(bodyKey)}</p>
        <div className="tutorial-actions">
          <button
            type="button"
            className="button ghost"
            onClick={() => dispatch({ type: "skip" })}
          >
            {t("action.skip")}
          </button>
          {index > 0 ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => dispatch({ type: "back" })}
            >
              {t("action.back")}
            </button>
          ) : null}
          {targetId ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                const target = document.getElementById(targetId);
                target?.scrollIntoView({
                  block: "center",
                  behavior: prefersReducedMotion() ? "auto" : "smooth",
                });
                target?.focus({ preventScroll: true });
              }}
            >
              {t("action.focusControl")}
            </button>
          ) : null}
          {state.step === "complete" ? (
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  onOpenExample();
                  dispatch({ type: "complete" });
                }}
              >
                {t("action.openExample")}
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => dispatch({ type: "complete" })}
              >
                {t("action.finish")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button primary"
              onClick={() => dispatch({ type: "next" })}
            >
              {t("action.next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function titleFor(
  step: TutorialReducerState["step"],
):
  | "tutorial.welcomeTitle"
  | "tutorial.createTitle"
  | "tutorial.importTitle"
  | "tutorial.editTitle"
  | "tutorial.qaTitle"
  | "tutorial.exportTitle"
  | "tutorial.completeTitle" {
  switch (step) {
    case "create":
      return "tutorial.createTitle";
    case "import":
      return "tutorial.importTitle";
    case "edit":
      return "tutorial.editTitle";
    case "qa":
      return "tutorial.qaTitle";
    case "export":
      return "tutorial.exportTitle";
    case "complete":
      return "tutorial.completeTitle";
    default:
      return "tutorial.welcomeTitle";
  }
}

function bodyFor(
  step: TutorialReducerState["step"],
):
  | "tutorial.welcomeBody"
  | "tutorial.createBody"
  | "tutorial.importBody"
  | "tutorial.editBody"
  | "tutorial.qaBody"
  | "tutorial.exportBody"
  | "tutorial.completeBody" {
  switch (step) {
    case "create":
      return "tutorial.createBody";
    case "import":
      return "tutorial.importBody";
    case "edit":
      return "tutorial.editBody";
    case "qa":
      return "tutorial.qaBody";
    case "export":
      return "tutorial.exportBody";
    case "complete":
      return "tutorial.completeBody";
    default:
      return "tutorial.welcomeBody";
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
