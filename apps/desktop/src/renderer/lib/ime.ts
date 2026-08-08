/**
 * IME-safe confirmation guards.
 * Composition and keyCode/which 229 must never trigger confirm/mutation/focus moves.
 */

export interface CompositionState {
  isComposing: boolean;
}

export function createCompositionState(): CompositionState {
  return { isComposing: false };
}

export function onCompositionStart(state: CompositionState): void {
  state.isComposing = true;
}

export function onCompositionEnd(state: CompositionState): void {
  state.isComposing = false;
}

export function isImeKeyboardEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}): boolean {
  if (event.isComposing === true) return true;
  if (event.keyCode === 229) return true;
  if (event.which === 229) return true;
  return false;
}

/**
 * Returns true when confirm / mutation / focus-advance must be suppressed.
 */
export function shouldBlockConfirm(
  composition: CompositionState,
  event?: { isComposing?: boolean; keyCode?: number; which?: number } | null,
  pendingConfirm = false,
): boolean {
  if (pendingConfirm) return true;
  if (composition.isComposing) return true;
  if (event && isImeKeyboardEvent(event)) return true;
  return false;
}
