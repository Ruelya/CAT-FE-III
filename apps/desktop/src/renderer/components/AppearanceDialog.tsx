import { Dialog } from "@translunar/ui";

import { ThemePicker } from "./ThemePicker.js";

/**
 * Appearance settings. Theme is an application preference rather than a
 * project one, so it lives here instead of inside ProjectSettingsDialog —
 * switching a project must not switch the theme back.
 */
export function AppearanceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title="外观" onClose={onClose} wide>
      <ThemePicker />
    </Dialog>
  );
}
