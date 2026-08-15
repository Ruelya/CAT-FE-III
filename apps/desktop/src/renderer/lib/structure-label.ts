/**
 * Short labels for structural paths the Engine stores on every segment.
 *
 * The full path (word/document.xml#p:12) is useful for export and for
 * debugging; it is not what a translator needs while scanning a grid. A short
 * label that says "this row is a heading / a cell / a footnote" is.
 */
export function structureLabel(path: string): string {
  if (!path) return "";
  const lower = path.toLowerCase();
  if (lower.includes("header")) return "Hdr";
  if (lower.includes("footer")) return "Ftr";
  if (lower.includes("footnote")) return "Fn";
  if (lower.includes("endnote")) return "En";
  if (lower.includes("comment")) return "Cmt";
  if (lower.includes("slide")) return "Sld";
  if (/sheet|cell|![a-z]+\d+/i.test(path) || /#r\d+c\d+/i.test(path)) {
    return "Cell";
  }
  if (/#h\d|#heading|title/i.test(path)) return "H";
  if (/#p:\d+|paragraph/i.test(path)) return "¶";
  // Fall back to the last path fragment so an unknown structure is still
  // distinguishable from a blank cell.
  const fragment = path.split(/[/\\]/).pop() ?? path;
  return fragment.length > 8 ? `${fragment.slice(0, 7)}…` : fragment;
}

/** Full path shown on hover so the short label is never the only record. */
export function structureTitle(path: string): string {
  return path || "No structural path";
}
