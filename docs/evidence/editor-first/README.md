# 编辑器优先迭代 —— 实测证据包（2026-08-15）

本目录是 `docs/editor-first-iteration.md` §1.1 实测剧本的原始证据与复现工具。
探针是诊断脚本，不是产品代码，也不是回归测试；它们记录"一个译者做一单活"
在当前构建上逐步发生了什么。

## 内容

- `real.docx` —— 自造真实感测试稿：10 段，含一处粗体 run、一处斜体 run、
  数字/日期/邮箱、两对完全重复的句子（用于验证 TM 写回与自动传播）。
- `probe1.mjs`–`probe4.mjs` —— 四轮剧本探针（Playwright 驱动真实 Electron
  构建 + 真实引擎）。
- `findings1.json`–`findings4.json` —— 各轮逐步判定（WORKS / MISSING /
  BUG / BROKE / INFO）。
- `shot-*.png` —— 关键截图：
  - `shot-tags-panel.png`：段 2 的 Tags 面板（tag_missing 报错、数字偏移
    输入框），而网格源文中标签完全不可见。
  - `shot-propagate-conflict.png`：Propagate 模态框挡住网格；同屏可见
    重复段被引擎传播为 draft、活动段 save error。
  - `shot-conflict-banner.png`：单人操作出现
    "segment was modified by another writer" 横幅。
  - `shot-qa-blocked.png` / `shot-export-blocked.png`：对全部 10 段执行
    Apply tags 后 tag_missing 仍 10 处，导出被质量门禁永久阻断。

## 复现

```bash
pnpm build:desktop
mkdir -p /tmp/probe-fixtures && cp docs/evidence/editor-first/real.docx /tmp/probe-fixtures/
mkdir -p /tmp/editor-probe
./scripts/linux-display.sh node docs/evidence/editor-first/probe4.mjs
cat /tmp/editor-probe/findings4.json
```

预期（在被修复之前）：`confirmed-after-retry = BUG（8/10）`、
`qa-tag-missing-after-apply = BUG（10 处）`、`export = BLOCKED`。
当 `docs/editor-first-iteration.md` 的 W1 与 R6 完成后，probe4 四项应全部
转为 WORKS——届时应将该剧本改写为正式 E2E 并删除本目录的探针。
