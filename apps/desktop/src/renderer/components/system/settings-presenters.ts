/**
 * Pure data for Settings Surface §E3 vertical tab list.
 */

export type SettingsSectionId =
  | "appearance"
  | "locale"
  | "shortcuts"
  | "data"
  | "backup"
  | "updates"
  | "engines"
  | "tutorial"
  | "about";

export type SettingsGroupId = "app" | "data" | "engines" | "other";

export interface SettingsNavItem {
  id: SettingsSectionId;
  /** i18n MessageKey string — cast at call site */
  labelKey: string;
  group: SettingsGroupId;
}

export interface SettingsNavGroup {
  id: SettingsGroupId;
  labelKey: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    id: "app",
    labelKey: "settings.group.app",
    items: [
      {
        id: "appearance",
        labelKey: "settings.section.appearance",
        group: "app",
      },
      { id: "locale", labelKey: "settings.section.locale", group: "app" },
      {
        id: "shortcuts",
        labelKey: "settings.section.shortcuts",
        group: "app",
      },
    ],
  },
  {
    id: "data",
    labelKey: "settings.group.data",
    items: [
      { id: "data", labelKey: "settings.section.dataDir", group: "data" },
      { id: "backup", labelKey: "settings.section.backup", group: "data" },
      { id: "updates", labelKey: "settings.section.updates", group: "data" },
    ],
  },
  {
    id: "engines",
    labelKey: "settings.group.engines",
    items: [
      {
        id: "engines",
        labelKey: "settings.section.engines",
        group: "engines",
      },
    ],
  },
  {
    id: "other",
    labelKey: "settings.group.other",
    items: [
      {
        id: "tutorial",
        labelKey: "settings.section.tutorial",
        group: "other",
      },
      { id: "about", labelKey: "settings.section.about", group: "other" },
    ],
  },
] as const;

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "appearance";

const ALL_SECTION_IDS = new Set<string>(
  SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id)),
);

export function isSettingsSectionId(
  value: unknown,
): value is SettingsSectionId {
  return typeof value === "string" && ALL_SECTION_IDS.has(value);
}

export function normalizeSettingsSection(
  value: unknown,
): SettingsSectionId {
  if (isSettingsSectionId(value)) return value;
  return DEFAULT_SETTINGS_SECTION;
}

/** Flat ordered list of section ids for keyboard cycling if needed. */
export function listSettingsSections(): SettingsSectionId[] {
  return SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id));
}
