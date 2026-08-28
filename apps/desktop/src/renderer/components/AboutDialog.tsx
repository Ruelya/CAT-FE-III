import { Button, Dialog } from "@translunar/ui";

import packageJson from "../../../package.json";

export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 帮助 ▸ 关于 (Windows/Linux; macOS keeps the native role:about). The one
 * fact worth a dialog: the app and the version it was built from.
 */
export function AboutDialog({ open, onClose }: AboutDialogProps) {
  return (
    <Dialog
      title="关于"
      open={open}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <p className="about__line">
        Translunar CAT <span className="tl-num">{packageJson.version}</span>
      </p>
    </Dialog>
  );
}
