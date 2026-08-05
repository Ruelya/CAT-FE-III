/**
 * IME 组合态守卫（全局单例）
 *
 * PRD C-13 把 CJK IME 体验定为选择 Electron 的唯一理由，
 * `07-interaction.md §3` 因此把本模块列为不可协商项。
 *
 * 组合态期间必须禁止：全局快捷键、焦点移动、弹层开合、
 * 单元格高度过渡、草稿写盘。
 *
 * 三重保险（§3.2）：
 *   1. 自己维护的 `composing` 标志（compositionstart/end 捕获阶段）
 *   2. `event.isComposing`
 *   3. `event.keyCode === 229` —— 部分 Windows IME 的 keydown 上
 *      `isComposing` 不可靠，229 是必要补充
 *
 * Source: docs/design-ii/07-interaction.md §3
 */

let composing = false;
let installed = false;

/** 当前是否处于 IME 组合态 */
export function isComposing(): boolean {
  return composing;
}

/**
 * 安装全局组合态监听。
 * 幂等：重复调用不会重复绑定（React StrictMode 下会双调用）。
 * 在 `main.tsx` 挂载前调用一次即可，无需卸载——它与文档同生命周期。
 */
export function installCompositionGuard(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  document.addEventListener(
    "compositionstart",
    () => {
      composing = true;
      document.documentElement.dataset.composing = "";
    },
    true,
  );

  const end = () => {
    composing = false;
    delete document.documentElement.dataset.composing;
  };

  document.addEventListener("compositionend", end, true);
  // 组合中的输入框被移除/失焦时 compositionend 可能不触发，
  // 否则守卫会永久卡在 true，快捷键全部失效。
  document.addEventListener("blur", end, true);
}

/**
 * 快捷键分发守卫。所有全局键盘处理的第一行都应调用它。
 *
 * @returns true 表示当前事件应被忽略
 */
export function shouldIgnoreKey(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return composing || event.isComposing || event.keyCode === 229;
}
