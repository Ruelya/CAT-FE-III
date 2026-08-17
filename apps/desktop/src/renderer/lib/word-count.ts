/**
 * Translator-facing word count for the status bar.
 *
 * CJK / Hangul runs count as one word per character. Everything else splits
 * on whitespace so "power station" is two words and "电站" is two as well.
 */
const CJK =
  /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let words = 0;
  let latin = "";
  const flushLatin = () => {
    const parts = latin.trim().match(/[^\s]+/g);
    if (parts) words += parts.length;
    latin = "";
  };
  for (const char of trimmed) {
    if (CJK.test(char)) {
      flushLatin();
      words += 1;
    } else {
      latin += char;
    }
  }
  flushLatin();
  return words;
}
