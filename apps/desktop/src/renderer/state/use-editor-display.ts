import { useEffect, useState } from "react";

import {
  EDITOR_DISPLAY_EVENT,
  readEditorDisplay,
  writeEditorDisplay,
  type EditorDisplay,
} from "../lib/editor-display";

export function useEditorDisplay(): [
  EditorDisplay,
  (patch: Partial<EditorDisplay>) => void,
] {
  const [display, setDisplay] = useState(readEditorDisplay);

  useEffect(() => {
    const refresh = () => setDisplay(readEditorDisplay());
    window.addEventListener(EDITOR_DISPLAY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EDITOR_DISPLAY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const update = (patch: Partial<EditorDisplay>) => {
    const next = writeEditorDisplay({ ...readEditorDisplay(), ...patch });
    setDisplay(next);
    window.dispatchEvent(new Event(EDITOR_DISPLAY_EVENT));
  };

  return [display, update];
}
