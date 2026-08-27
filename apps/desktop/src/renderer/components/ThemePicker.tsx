import { THEME_FX_LABELS, THEMES } from "@translunar/ui";

import { useTheme } from "../lib/theme.js";

/**
 * Theme control: the list of themes, then the effect switches for whichever
 * one is active.
 *
 * Only the effects a theme actually ships appear. A theme with no signature
 * effect shows no switches rather than three dead ones, and a switch that
 * the OS is currently overriding says so instead of lying about its state.
 */
export function ThemePicker() {
  const { theme, fx, reducedMotion, setThemeId, setFx, resetFx } = useTheme();
  const saas = THEMES.filter((t) => t.group === "saas");
  const art = THEMES.filter((t) => t.group === "art");

  return (
    <div className="theme-picker">
      {[
        { key: "saas", caption: "界面", list: saas },
        { key: "art", caption: "材质", list: art },
      ].map((section) => (
        <section key={section.key} className="theme-picker__section">
          <h4 className="theme-picker__caption">{section.caption}</h4>
          <div className="theme-picker__grid" role="radiogroup">
            {section.list.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === theme.id}
                className="theme-picker__swatch"
                data-theme-preview={item.id}
                data-active={item.id === theme.id}
                title={item.id}
                onClick={() => setThemeId(item.id)}
              >
                {/* The swatch paints itself from the theme it selects, so a
                    reader picks by the thing rather than by its name. */}
                <span className="theme-picker__chip" aria-hidden="true">
                  <span className="theme-picker__chip-bar" />
                  <span className="theme-picker__chip-accent" />
                </span>
                <span className="theme-picker__name">{item.label}</span>
                <span className="theme-picker__id">{item.id}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {theme.fx.length > 0 ? (
        <section className="theme-picker__section">
          <h4 className="theme-picker__caption">效果</h4>
          {THEME_FX_LABELS.filter((entry) => theme.fx.includes(entry.key)).map(
            (entry) => {
              const overridden = entry.key === "ambient" && reducedMotion;
              return (
                <label key={entry.key} className="theme-picker__fx">
                  <input
                    type="checkbox"
                    checked={fx[entry.key]}
                    onChange={(event) => setFx(entry.key, event.target.checked)}
                  />
                  <span className="theme-picker__fx-label">{entry.label}</span>
                  <span className="theme-picker__fx-hint">
                    {overridden
                      ? `${entry.hint}（系统已减弱动效）`
                      : entry.hint}
                  </span>
                </label>
              );
            },
          )}
          <button
            type="button"
            className="theme-picker__reset"
            onClick={resetFx}
          >
            恢复默认效果
          </button>
        </section>
      ) : null}
    </div>
  );
}
