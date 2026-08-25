import { EmptyState, Panel } from "@translunar/ui";

/**
 * Honest placeholder: the engine protocol has no terminology methods yet
 * (no term.list / term.lookup / termbase mount). This panel states that
 * plainly instead of rendering fake hits.
 */
export function TermPanel() {
  return (
    <Panel title="术语" className="dock-panel">
      <div className="dock-stack">
        <EmptyState
          title="术语功能尚未接入引擎"
          hint="当前引擎协议（v1）不包含术语库方法，本面板不会展示假数据。"
        />
        <div className="honest-note">
          待引擎提供 term.lookup / termbase 挂载 API
          后，此处将显示当前句段的术语命中并支持一键插入。挂载入口见「项目设置」。
        </div>
      </div>
    </Panel>
  );
}
