import { useCallback } from "react";

/**
 * useViewTransition
 *
 * 包装 View Transitions API，用于 Surface 切换动效。
 * 转场期间在 <html> 上设置 data-transition 属性，供 CSS 触发 Band Sweep。
 *
 * 降级：不支持 API 或用户偏好减少动效时，直接执行回调。
 *
 * Source: docs/design-ii/04-motion.md 编排 A
 */

type TransitionKind = "surface" | "panel";

export function useViewTransition() {
  return useCallback(
    (kind: TransitionKind, update: () => void | Promise<void>) => {
      const prefersReduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      const supportsVT =
        typeof document.startViewTransition === "function";

      if (!supportsVT || prefersReduced) {
        void update();
        return;
      }

      const root = document.documentElement;
      root.dataset.transition = kind;

      const transition = document.startViewTransition(async () => {
        await update();
      });

      void transition.finished.finally(() => {
        delete root.dataset.transition;
      });
    },
    [],
  );
}
