/**
 * Pre-React appearance bootstrap. Reads versioned localStorage preference and
 * applies theme/accent before the React tree mounts.
 */
import { applyAppearance, readAppearancePreference } from "./state/appearance";

const preference = readAppearancePreference();
applyAppearance(preference);
