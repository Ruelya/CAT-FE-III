/**
 * Pre-paint theme attribute.
 *
 * A blocking classic script in <head> so the persisted theme is on the root
 * element before the body is parsed. It only sets `data-theme`; the accent
 * seed and derived focus colour are applied a moment later by
 * `appearance-bootstrap.ts`, which owns the real schema.
 *
 * Kept deliberately tiny and dependency-free. The storage key and version must
 * stay in sync with `state/appearance.ts`; `state/appearance.test.ts` fails if
 * they drift.
 */
(function bootTheme() {
  try {
    var raw = window.localStorage.getItem("translunar.renderer.appearance.v1");
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.style.colorScheme = "dark";
    }
  } catch (error) {
    // Unavailable or malformed storage falls back to the light default.
    void error;
  }
})();
