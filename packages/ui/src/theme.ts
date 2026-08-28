/**
 * The theme registry.
 *
 * A theme is a named override of the `--tl-*` token contract in tokens.css
 * plus, for some of them, a signature effect that cannot be expressed as a
 * token — a CRT's scanlines, a riso's paper fibre, a drifting light field.
 * Those effects are the reason a theme is worth having and also the reason
 * some readers cannot use it for eight hours, so each one is a switch rather
 * than a fact of the theme.
 *
 * Themes restyle the surfaces the app already has. Nothing here invents
 * chrome the engine cannot back.
 */

/** The switchable effect families. */
export type ThemeFxKey = "scanlines" | "grain" | "ambient";

export const THEME_FX_KEYS: readonly ThemeFxKey[] = [
  "scanlines",
  "grain",
  "ambient",
];

export interface ThemeFxLabel {
  key: ThemeFxKey;
  label: string;
  /** What the reader gives up by turning it off, in one clause. */
  hint: string;
}

export const THEME_FX_LABELS: readonly ThemeFxLabel[] = [
  { key: "scanlines", label: "扫描线", hint: "CRT 行栅与刷新滚动" },
  { key: "grain", label: "颗粒", hint: "纸纹、网点与噪点" },
  { key: "ambient", label: "环境光", hint: "漂移光场与呼吸辉光" },
];

export type ThemeFx = Record<ThemeFxKey, boolean>;

export interface ThemeDefinition {
  id: string;
  /** Short noun shown in the picker; the id stays visible next to it. */
  label: string;
  /** Which family the theme came from, for grouping in the picker. */
  group: "saas" | "art";
  /** Drives `color-scheme` and the native window chrome. */
  scheme: "light" | "dark";
  /**
   * Effects this theme ships on. A key absent from here has no effect in
   * this theme at all, so its switch is hidden rather than shown dead.
   */
  fx: readonly ThemeFxKey[];
}

export const THEMES: readonly ThemeDefinition[] = [
  { id: "terra", label: "陶土", group: "art", scheme: "light", fx: [] },
  { id: "compact", label: "紧凑", group: "saas", scheme: "light", fx: [] },
  { id: "comfortable", label: "舒适", group: "saas", scheme: "light", fx: [] },
  { id: "dark", label: "暗色", group: "saas", scheme: "dark", fx: [] },
  {
    id: "aurora",
    label: "极光",
    group: "art",
    scheme: "dark",
    fx: ["ambient"],
  },
  {
    id: "blueprint",
    label: "蓝晒",
    group: "art",
    scheme: "dark",
    fx: ["grain"],
  },
  { id: "acid", label: "酸性", group: "art", scheme: "light", fx: [] },
  { id: "quarry", label: "温石", group: "saas", scheme: "light", fx: [] },
  { id: "cobalt", label: "钴蓝", group: "saas", scheme: "dark", fx: [] },
  { id: "ledger", label: "账表", group: "saas", scheme: "light", fx: [] },
  { id: "riso", label: "孔版", group: "art", scheme: "light", fx: ["grain"] },
  {
    id: "atelier",
    label: "画廊",
    group: "art",
    scheme: "dark",
    fx: ["grain", "ambient"],
  },
  {
    id: "atelier-light",
    label: "白昼画廊",
    group: "art",
    scheme: "light",
    fx: ["grain"],
  },
  {
    id: "phosphor",
    label: "荧光",
    group: "art",
    scheme: "dark",
    fx: ["scanlines", "grain", "ambient"],
  },
  {
    id: "phosphor-light",
    label: "日光终端",
    group: "art",
    scheme: "light",
    fx: ["scanlines"],
  },
  {
    id: "vitrine",
    label: "液态玻璃",
    group: "art",
    scheme: "light",
    fx: ["ambient"],
  },
];

export const DEFAULT_THEME_ID = "terra";

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

export function findTheme(id: string): ThemeDefinition | undefined {
  return BY_ID.get(id);
}

export function themeOrDefault(id: string | null | undefined): ThemeDefinition {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(DEFAULT_THEME_ID)!;
}

/**
 * A theme's signature effects start on — that is what makes it that theme —
 * and every other key is off, so switching to a quiet theme cannot inherit a
 * loud theme's grain.
 */
export function defaultFxFor(theme: ThemeDefinition): ThemeFx {
  return {
    scanlines: theme.fx.includes("scanlines"),
    grain: theme.fx.includes("grain"),
    ambient: theme.fx.includes("ambient"),
  };
}
