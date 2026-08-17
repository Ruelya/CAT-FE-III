import { formatTokens } from "./preview-markup";

/** Trados File > Options > Editor > Formatting display style. */
export type FormattingDisplayStyle = "formatted" | "full" | "tags";

/** Trados View > Options > tag text: none / partial / full. */
export type TagTextMode = "none" | "partial" | "full";

export interface EditorDisplay {
  formatting: FormattingDisplayStyle;
  tagText: TagTextMode;
  whitespace: boolean;
}

export const EDITOR_DISPLAY_KEY = "translunar.renderer.editor-display.v1";
export const EDITOR_DISPLAY_EVENT = "translunar-editor-display";

export const DEFAULT_EDITOR_DISPLAY: EditorDisplay = {
  formatting: "full",
  tagText: "partial",
  whitespace: false,
};

const FORMAT_TOKENS = new Set(["b", "strong", "i", "em", "u", "s", "strike"]);

export function isRecognizedFormatting(displayText: string): boolean {
  return formatTokens(displayText).some((token) => FORMAT_TOKENS.has(token));
}

export function readEditorDisplay(
  storage: Pick<Storage, "getItem"> = localStorage,
): EditorDisplay {
  try {
    const raw = storage.getItem(EDITOR_DISPLAY_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_DISPLAY };
    const parsed = JSON.parse(raw) as Partial<EditorDisplay>;
    return {
      formatting:
        parsed.formatting === "formatted" || parsed.formatting === "tags"
          ? parsed.formatting
          : "full",
      tagText:
        parsed.tagText === "none" || parsed.tagText === "full"
          ? parsed.tagText
          : "partial",
      whitespace: parsed.whitespace === true,
    };
  } catch {
    return { ...DEFAULT_EDITOR_DISPLAY };
  }
}

export function writeEditorDisplay(
  next: EditorDisplay,
  storage: Pick<Storage, "setItem"> = localStorage,
): EditorDisplay {
  storage.setItem(EDITOR_DISPLAY_KEY, JSON.stringify(next));
  return next;
}

export function hideFormattingCapsule(
  kind: string,
  displayText: string,
  formatting: FormattingDisplayStyle,
  ghost: boolean,
): boolean {
  if (ghost || formatting !== "formatted") return false;
  if (kind !== "start" && kind !== "end") return false;
  return isRecognizedFormatting(displayText);
}

/** Collapse extra spaces when pasting beside existing whitespace (Trados Smart cut and paste). */
export function smartPastePlain(
  host: string,
  from: number,
  to: number,
  insert: string,
): string {
  const characters = [...host];
  const lo = Math.max(0, Math.min(from, to, characters.length));
  const hi = Math.max(0, Math.min(Math.max(from, to), characters.length));
  const before = lo > 0 ? characters[lo - 1] : "";
  const after = hi < characters.length ? characters[hi] : "";
  let next = insert;
  if (before === " " || before === "\u00a0") next = next.replace(/^\s+/, "");
  if (
    after === " " ||
    after === "\u00a0" ||
    (after !== undefined && /[.,;:!?)]/.test(after))
  ) {
    next = next.replace(/\s+$/, "");
  }
  return next;
}

export interface WhitespacePiece {
  kind: "text" | "space" | "nbsp" | "tab";
  text: string;
}

export function splitWhitespace(text: string): WhitespacePiece[] {
  const pieces: WhitespacePiece[] = [];
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    pieces.push({ kind: "text", text: buffer });
    buffer = "";
  };
  for (const character of text) {
    if (character === " ") {
      flush();
      pieces.push({ kind: "space", text: " " });
    } else if (character === "\u00a0") {
      flush();
      pieces.push({ kind: "nbsp", text: "\u00a0" });
    } else if (character === "\t") {
      flush();
      pieces.push({ kind: "tab", text: "\t" });
    } else {
      buffer += character;
    }
  }
  flush();
  return pieces;
}

export function wrapWhitespaceHtml(escapedText: string, show: boolean): string {
  const withBreaks = escapedText.replaceAll("\n", "<br>");
  if (!show) return withBreaks;
  return withBreaks
    .replaceAll("\t", '<span class="ws ws--tab" data-ws="tab">\t</span>')
    .replaceAll(
      "\u00a0",
      '<span class="ws ws--nbsp" data-ws="nbsp">\u00a0</span>',
    )
    .replaceAll(" ", '<span class="ws ws--space" data-ws="space"> </span>');
}
