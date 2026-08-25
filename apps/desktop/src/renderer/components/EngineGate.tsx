import { Button, StatusDot } from "@translunar/ui";

import type { EngineStatusPayload } from "../../shared/desktop-api.js";

export interface EngineGateProps {
  /** null means the first status fetch has not resolved yet. */
  status: EngineStatusPayload | null;
  onRelaunch: () => void;
  /** True while a manual relaunch request is in flight. */
  relaunching: boolean;
}

/**
 * Honest blocking surface shown whenever the engine is not ready: the
 * workbench underneath is inert, so nothing can pretend to save. `down`
 * offers a manual relaunch; `starting`/`restarting` state exactly what the
 * supervisor is doing instead of a success-looking spinner.
 */
export function EngineGate({
  status,
  onRelaunch,
  relaunching,
}: EngineGateProps) {
  const state = status?.state ?? "starting";

  let dot: "busy" | "down" = "busy";
  let title: string;
  let body: string;
  if (state === "down") {
    dot = "down";
    title = "翻译引擎已停止";
    body =
      "编辑已锁定：引擎进程未运行，任何修改都无法保存。" +
      "可尝试重新启动引擎；若持续失败，请检查引擎日志。";
  } else if (state === "restarting") {
    title = "翻译引擎已意外退出，正在自动重启";
    body =
      `第 ${status?.restarts ?? 0} 次重试。重启期间编辑已锁定；` +
      "引擎未确认写入的草稿不会保存，恢复后请检查最近编辑的句段。";
  } else {
    title = "正在启动本地翻译引擎";
    body = "引擎就绪前编辑不可用，就绪后此提示会自动消失。";
  }

  return (
    <div
      className="engine-gate"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="engine-gate__card" data-state={state}>
        <p className="engine-gate__title">
          <StatusDot state={dot} />
          {title}
        </p>
        <p className="engine-gate__body">{body}</p>
        {status?.lastError ? (
          <p className="engine-gate__error">{status.lastError}</p>
        ) : null}
        {state === "down" ? (
          <div className="engine-gate__actions">
            <Button
              variant="primary"
              onClick={onRelaunch}
              disabled={relaunching}
            >
              {relaunching ? "正在重新启动…" : "重新启动引擎"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
