import { useEffect, useRef } from "react";

import type { SegmentEditState } from "../state/save-coordinator";

export interface TargetEditorProps {
  segmentId: string;
  value: string;
  editState: SegmentEditState | null;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onConfirm: (event: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
    altKey?: boolean;
    shiftKey?: boolean;
  }) => void;
}

export function TargetEditor({
  segmentId,
  value,
  editState,
  disabled,
  autoFocus,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
}: TargetEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
    }
  }, [autoFocus, segmentId]);

  const dirty =
    editState &&
    editState.segmentId === segmentId &&
    (editState.editGeneration !== editState.savedGeneration ||
      editState.draftTarget !== editState.engineTarget);
  const errored =
    editState?.segmentId === segmentId && editState.saveState === "error";

  const className = [
    "target-editor",
    dirty ? "target-editor--dirty" : "",
    errored ? "target-editor--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      ref={ref}
      className={className}
      data-testid={`target-editor-${segmentId}`}
      aria-label="Target"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          // Do not preventDefault when IME is active — check all 229 signals first.
          if (
            e.nativeEvent.isComposing ||
            e.keyCode === 229 ||
            e.which === 229
          ) {
            return;
          }
          e.preventDefault();
          // Alt and Shift choose where the caret lands next; see
          // state/confirm-advance.ts for the contract.
          onConfirm({
            isComposing: e.nativeEvent.isComposing,
            keyCode: e.keyCode,
            which: e.which,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
          });
        }
      }}
    />
  );
}
