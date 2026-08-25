import type { Project } from "@translunar/contracts";
import { Badge, Button, Dialog } from "@translunar/ui";

export interface ProjectSettingsDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

/**
 * Project settings. The engine protocol (v1) exposes no project.update,
 * tm.import/mount, or termbase methods, so the language pair is read-only
 * and the TM/termbase mount rows are honest placeholders — disabled with
 * an explanation instead of pretending to save.
 */
export function ProjectSettingsDialog({
  open,
  project,
  onClose,
}: ProjectSettingsDialogProps) {
  return (
    <Dialog
      title={`项目设置 — ${project.name}`}
      open={open}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="settings">
        <section className="settings__section">
          <h3 className="settings__heading">语言对</h3>
          <div className="settings__row">
            <span className="settings__locales">
              {project.sourceLocale} → {project.targetLocale}
            </span>
            <Badge tone="neutral">创建时固定</Badge>
          </div>
          <p className="settings__note">
            引擎协议（v1）尚无 project.update
            方法，语言对在创建项目时确定，暂不可修改。
          </p>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">翻译记忆</h3>
          <div className="settings__row">
            <span>项目内置 TM</span>
            <Badge tone="ok">已启用</Badge>
          </div>
          <p className="settings__note">
            确认句段时自动写入；相同源文在 TM 面板显示 100%
            精确匹配，并向重复句段传播。
          </p>
          <div className="settings__row">
            <Button size="sm" variant="outline" disabled>
              挂载外部 TM…
            </Button>
          </div>
          <div className="honest-note">
            挂载外部 TM 需要引擎提供 tm.import / tm.mount
            API，当前版本尚未提供。此按钮在引擎支持前保持禁用——不做假成功。
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">术语库</h3>
          <div className="settings__row">
            <Button size="sm" variant="outline" disabled>
              挂载术语库…
            </Button>
          </div>
          <div className="honest-note">
            引擎协议（v1）不包含术语库方法。挂载与术语命中将在引擎支持后接入。
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">质量检查</h3>
          <div className="settings__row">
            <span>数字一致性检查（builtin.qa.numbers）</span>
            <Badge tone="ok">内置</Badge>
          </div>
          <p className="settings__note">
            在右侧 QA 面板手动运行；更多规则档案随引擎演进接入。
          </p>
        </section>
      </div>
    </Dialog>
  );
}
