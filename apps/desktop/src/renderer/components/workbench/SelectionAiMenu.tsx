import { useCallback, useEffect, useRef, useState } from "react";
import type { Segment } from "@translunar/contracts";

import { PluginAiActions } from "../../PluginAiActions";
import { isComposing } from "../../hooks/useComposition";
import { useLocale } from "../../i18n/LocaleProvider";
import { wordDiff } from "./Stack/wordDiff";

export interface SelectionAiMenuProps {
  enabled: boolean;
  activeSegment: Segment | undefined;
  sourceLocale: string;
  targetLocale: string;
  onUseTarget(target: string): void;
}

interface AnchorState {
  text: string;
  top: number;
  left: number;
  segmentId: string;
}

/**
 * §A4 selection-anchored AI menu. Opens on non-collapsed selection inside
 * workbench editors when AI is enabled and IME is idle.
 * Built-in polish residual: no Engine selection-rewrite path → plugin actions only.
 */
export function SelectionAiMenu({
  enabled,
  activeSegment,
  sourceLocale,
  targetLocale,
  onUseTarget,
}: SelectionAiMenuProps) {
  const { t } = useLocale();
  const [anchor, setAnchor] = useState<AnchorState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    const focusEl = lastFocusRef.current;
    if (focusEl && document.contains(focusEl)) {
      focusEl.focus();
    }
  }, []);

  const tryOpenFromSelection = useCallback(() => {
    if (!enabled || isComposing()) {
      setAnchor(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setAnchor(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    const editor = el?.closest?.("textarea[data-editor-for]") as
      | HTMLTextAreaElement
      | null;
    if (!editor) {
      // Source cells may use non-textarea nodes; only editor targets for now.
      const sourceCell = el?.closest?.("[data-source-for],[data-segment-row]");
      if (!sourceCell) {
        setAnchor(null);
        return;
      }
    }
    const segmentId =
      editor?.getAttribute("data-editor-for") ??
      el?.closest?.("[data-segment-row]")?.getAttribute("data-segment-row") ??
      activeSegment?.id ??
      "";
    if (!segmentId) {
      setAnchor(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setAnchor(null);
      return;
    }
    lastFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? editor;
    const top = Math.min(
      window.innerHeight - 12,
      Math.max(8, rect.bottom + 6),
    );
    const left = Math.min(
      window.innerWidth - 12,
      Math.max(8, rect.left),
    );
    setAnchor({ text, top, left, segmentId });
  }, [enabled, activeSegment?.id]);

  useEffect(() => {
    if (!enabled) {
      setAnchor(null);
      return;
    }
    const onMouseUp = () => {
      window.requestAnimationFrame(() => tryOpenFromSelection());
    };
    const onSelectionChange = () => {
      if (isComposing()) {
        setAnchor(null);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        // Keep open while interacting with menu; only clear when selection gone
        // and focus is outside the menu.
        if (
          anchor &&
          menuRef.current &&
          !menuRef.current.contains(document.activeElement)
        ) {
          // do not auto-close on every selectionchange flicker inside menu
        }
      }
    };
    const onCompositionStart = () => setAnchor(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && anchor) {
        event.preventDefault();
        close();
      }
    };
    const onScroll = () => {
      if (anchor) close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor || !menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener(
        "compositionstart",
        onCompositionStart,
        true,
      );
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [enabled, tryOpenFromSelection, close, anchor]);

  if (!enabled || !anchor || !activeSegment) return null;

  // Segment may lag selection; still mount with active segment + selectionText.
  const currentText =
    activeSegment.targetText || activeSegment.sourceText || "";
  const proposalBaseline = anchor.text;

  return (
    <div
      ref={menuRef}
      className="selection-ai-menu"
      role="menu"
      aria-label={t("ai.selection.menuAria")}
      style={{ top: anchor.top, left: anchor.left }}
      data-testid="selection-ai-menu"
    >
      <PluginAiActions
        activeSegment={activeSegment}
        sourceLocale={sourceLocale}
        targetLocale={targetLocale}
        placement="editorSelection"
        variant="menu"
        selectionText={anchor.text}
        onUseTarget={(text) => {
          onUseTarget(text);
          close();
        }}
        onMenuAction={close}
      />
      {/* Inline result presentation is handled inside PluginAiActions menu variant.
          Extra wordDiff strip when proposal replaces selection baseline is residual
          if PluginAiActions already shows accept/discard. */}
      {proposalBaseline && currentText && proposalBaseline !== currentText ? (
        <div className="selection-ai-result" hidden>
          <div className="selection-ai-result__diff">
            {wordDiff(currentText, proposalBaseline).map((token, index) => (
              <span key={`${token.kind}:${index}`} data-diff={token.kind}>
                {token.text}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Pure helper for tests: whether a menu open is allowed. */
export function canOpenSelectionAiMenu(options: {
  enabled: boolean;
  composing: boolean;
  selectionText: string;
}): boolean {
  if (!options.enabled) return false;
  if (options.composing) return false;
  return options.selectionText.trim().length >= 1;
}
