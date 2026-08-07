import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useLocale } from "./i18n/LocaleProvider";
import {
  tutorialReducer,
  tutorialTargetId,
  TUTORIAL_FLOW,
  type TutorialReducerState,
} from "./tutorial-state";
import type { TutorialState } from "../shared/product-shell";

interface TutorialOverlayProps {
  initial: TutorialState;
  onChange: (state: TutorialReducerState) => void;
  onOpenExample: () => void;
}

interface AnchorBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Coach-mark presentation for first-run tutorial.
 * Non-blocking: no document focus trap, no full-screen scrim.
 * Reducer + persistence contracts unchanged.
 */
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
  const markRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<AnchorBox | null>(null);
  const hidden = state.completed || state.skipped;

  const skipTutorial = useCallback(() => {
    dispatch({ type: "skip" });
  }, []);

  useEffect(() => {
    onChange(state);
  }, [state, onChange]);

  useEffect(() => {
    if (hidden) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skipTutorial();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, skipTutorial]);

  useEffect(() => {
    if (hidden) return;
    const targetId = tutorialTargetId(state.step);
    if (!targetId) {
      setAnchor(null);
      return;
    }
    let target: HTMLElement | null = null;
    let previousDescription: string | null = null;
    const advance = () => dispatch({ type: "next" });
    const measure = () => {
      if (!target) {
        setAnchor(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setAnchor({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };
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
      if (!nextTarget) {
        detach();
        setAnchor(null);
        return;
      }
      if (nextTarget !== target) {
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
      }
      measure();
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      detach();
    };
  }, [hidden, state.step]);

  if (hidden) return null;

  const index = Math.max(0, TUTORIAL_FLOW.indexOf(state.step));
  const titleKey = titleFor(state.step);
  const bodyKey = bodyFor(state.step);
  const targetId = tutorialTargetId(state.step);
  const progress = ((index + 1) / TUTORIAL_FLOW.length) * 100;
  const style = positionCoachMark(anchor, markRef.current);

  return (
    <div className="coach-mark-layer" role="presentation">
      <div
        ref={markRef}
        className="coach-mark"
        style={style}
        role="dialog"
        aria-modal="false"
        aria-label={t("aria.tutorialOverlay")}
      >
        <div className="coach-mark__progress">
          <span className="coach-mark__step">
            {t("tutorial.progressShort", {
              current: index + 1,
              total: TUTORIAL_FLOW.length,
            })}
          </span>
          <div
            className="coach-mark__bar"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={TUTORIAL_FLOW.length}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <h2>{t(titleKey)}</h2>
        <p id="tutorial-dialog-body">{t(bodyKey)}</p>
        <div className="coach-mark__actions">
          <button
            type="button"
            className="button ghost"
            onClick={() => dispatch({ type: "skip" })}
          >
            {t("action.skip")}
          </button>
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

function positionCoachMark(
  anchor: AnchorBox | null,
  mark: HTMLElement | null,
): CSSProperties {
  const margin = 12;
  const markWidth = mark?.offsetWidth || 320;
  const markHeight = mark?.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!anchor) {
    // Welcome / complete steps: bottom-end dock without covering center work
    return {
      bottom: 24,
      right: 24,
      top: "auto",
      left: "auto",
    };
  }

  let top = anchor.top + anchor.height + margin;
  let left = anchor.left;

  if (top + markHeight > vh - margin) {
    top = Math.max(margin, anchor.top - markHeight - margin);
  }
  if (left + markWidth > vw - margin) {
    left = Math.max(margin, vw - markWidth - margin);
  }
  if (left < margin) left = margin;
  if (top < margin) top = margin;

  return {
    top,
    left,
    bottom: "auto",
    right: "auto",
  };
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
