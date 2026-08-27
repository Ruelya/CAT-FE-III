# Windows 标题栏集成审计

> 分支：`cursor/gf-win-titlebar-2398`（基于 `cursor/gf-workbench-s3d-2398`）
> 性质：事实审计 + 一处最小修正，不动 CSS、不动 UI 文案。
> 截图存档：`/opt/cursor/artifacts/windows-titlebar/`（Linux/xvfb 环境，见 §5 的限制说明）。

## 0. 结论

**已原生集成（native frame 路线），无伪造。** 窗口没有任何自定义 chrome：
不是 CSS 仿制的标题栏，也不是 mac 风格的自绘按钮。Windows 上最小化/最大化/
关闭按钮、拖拽区、双击最大化、Aero Snap、Win11 Snap Layouts 全部来自 DWM
原生标题栏。唯一发现的缺口是颜色：`nativeTheme` 此前跟随系统，深色模式的
Windows 会把原生标题栏和菜单栏涂黑，而渲染层只有一套浅色 INSTRUMENT 令牌。
本次把 `nativeTheme.themeSource` 钉为 `"light"`（`apps/desktop/src/main/index.ts`
一处主进程改动），其余保持原样。

## 1. 现状：真实的 BrowserWindow 选项

`apps/desktop/src/main/index.ts` 的 `createWindow()` 全部窗口选项如下：

```ts
new BrowserWindow({
  width: 1440,
  height: 900,
  minWidth: 1080,
  minHeight: 640,
  backgroundColor: "#eef0f4",   // = --tl-gray-2 = --tl-color-bg，首帧不闪白
  webPreferences: {
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
});
```

明确**没有**设置的项（即全部走 Electron 默认值）：

| 选项 | 值 | 含义 |
| --- | --- | --- |
| `frame` | 默认（`true`） | OS 原生窗框与标题栏 |
| `titleBarStyle` | 未设置 | 不隐藏原生标题栏 |
| `titleBarOverlay` | 未设置 | 不用 overlay 路线 |
| `autoHideMenuBar` | 默认（`false`） | Windows/Linux 菜单栏常驻 |
| `transparent` / `vibrancy` / `backgroundMaterial` | 未设置 | 无透明、无毛玻璃、无 Mica |
| `trafficLightPosition` | 未设置 | 无 mac 红绿灯定制 |

渲染层已逐一排查：

- 全仓库（`apps/desktop/src/renderer/`、`packages/ui/`）**没有**任何
  `-webkit-app-region` / `app-region` 规则，没有自定义 HTML 标题栏组件。
- preload（`src/preload/index.cts`）只暴露引擎调用、文件对话框与菜单命令，
  **没有** minimize/maximize/close 之类的窗口控制桥 —— 渲染层想画假按钮
  也没有通道。
- 菜单是 `Menu.setApplicationMenu`（`src/main/menu.ts` +
  `menu-template.ts`）：Windows/Linux 上是窗口内的经典菜单栏
  （文件 / 编辑 / 视图 / 导航 / 帮助），macOS 上进系统菜单栏。
- 窗口标题跟随 `document.title`（主进程不写死标题），显示当前项目/文档名。
- 顶部的 ribbon（`renderer/components/Ribbon.tsx`，背景
  `--tl-color-surface` = `#f7f8fa`）是菜单栏**下方**的应用内工具条，
  不承担任何窗口 chrome 职责。

## 2. Windows 用户实际看到什么（截图级描述）

Win10/Win11 上从上到下依次是：

1. **DWM 原生标题栏**：左侧应用图标 + 实时文档标题，右侧原生
   最小化 / 最大化 / 关闭三个 caption 按钮。Win11 上悬停最大化按钮弹出
   Snap Layouts 网格；双击标题栏最大化；拖标题栏移动窗口、拖到屏幕边缘
   Aero Snap —— 这些全是 OS 行为，代码里没有一行仿制品。
2. **经典菜单栏**（Chromium 在客户区内绘制）：文件 编辑 视图 导航 帮助，
   Alt 键可聚焦，助记键与加速器显示由 Electron 菜单系统处理。
3. **HTML ribbon**（`#f7f8fa` 表面）与工作台本体。

颜色：原生标题栏的颜色由 Windows 个性化设置决定（浅色 ≈ 白，
或用户开启"标题栏显示强调色"时为强调色），不读 CSS 令牌 ——
这是所有经典原生 Windows 应用的行为，不是缺陷。浅色标题栏挨着
`#f7f8fa` 的 ribbon 表面观感连续。

## 3. 与 Windows 11 旗舰应用的差距（诚实清单）

| 对照物 | 它做了什么 | Translunar 现状 | 判断 |
| --- | --- | --- | --- |
| 文件资源管理器 / 记事本 | Mica 背景材质（标题栏与窗体同料，随桌面壁纸变化） | 无 Mica | Electron 的 `backgroundMaterial: "mica"` 在当前栈（Electron 41 + Chromium 合成器）存在官方已知问题：要求 Win11 22H2+、与不透明网页内容和最大化动画组合时有视觉伪影。无法诚实做到就不伪造，**不采用**。 |
| VS Code | 默认自定义标题栏，把菜单并入标题行省一行；caption 按钮为自绘 | 原生标题栏 + 菜单栏共两行 chrome | 多花一行，换来 100% 原生 caption 行为（Snap Layouts、辅助功能、多显示器 DPI、系统主题联动）。这是取舍不是缺口。 |
| Trados Studio | Win32 自绘 ribbon chrome（标题区并入 ribbon） | 原生标题栏与 ribbon 分离 | 同上，属设计取舍。 |
| 深色模式下的任意 Win11 应用 | 标题栏颜色跟随应用主题 | **修正前**：系统深色时原生标题栏 + 菜单栏翻黑，但应用只有浅色令牌，出现黑标题栏压浅色工作台的错配 | **本次已修**：`nativeTheme.themeSource = "light"`，原生 chrome 恒定浅色，与唯一的浅色令牌集一致。将来若做深色主题，此处应改回跟随主题开关。 |

### 为什么不切到 `titleBarOverlay`

overlay 路线（`titleBarStyle: "hidden"` + `titleBarOverlay`）同样能拿到原生
caption 按钮，但会摘掉原生标题栏这一行：标题文本、拖拽区
（`-webkit-app-region`）乃至菜单入口都得在 HTML 里重建。对一个以
"经典菜单栏 + ribbon"为骨架、目前零自定义 chrome 的应用来说，那是纯增熵：
现有 native frame 已经把任务要求的全部 Windows 行为（原生按钮、拖拽、
双击最大化、Snap Layouts）免费拿到手。故不切换、不churn CSS。

## 4. macOS / Linux 分支现状（顺带记录）

代码里**没有**平台分支 —— 三个平台共用同一套默认 frame：

- **macOS**：原生红绿灯 + 系统菜单栏（`menu-template.ts` 的 `isMac` 分支
  只影响菜单内容：追加 appMenu、退出项归位）。没有自绘红绿灯，没有
  `trafficLightPosition` / `vibrancy`，符合"不在任何平台伪造 mac 控件"的要求。
- **Linux**：窗口装饰由窗口管理器提供（服务端装饰）。正常桌面环境下
  有原生标题栏；无 WM 的裸 X（如 xvfb）下没有装饰，属环境事实，非应用缺陷。

## 5. 验证记录与环境限制

- 本审计环境是 Linux 容器，**无法目测 Windows DWM 标题栏**。Windows 部分
  的行为判断依据：Electron 默认 `frame: true` 的文档语义 +
  代码中不存在任何覆盖项。xvfb 下无窗口管理器，截图只能呈现客户区
  （菜单栏 + ribbon + 工作台），原生装饰不会出现 —— 截图旁注已写明。
- xvfb 实测（Playwright 驱动真实主进程 + 真实引擎走完建项目/导入）：
  `nativeTheme.themeSource === "light"`、`win.isMenuBarVisible() === true`、
  窗口标题随文档变为「演示项目 — m0-source.docx (en-US → zh-CN)」。
  整窗抓屏：`01-projects-full-window.png`（浅色菜单栏 + 项目列表）、
  `02-workbench-full-window.png`（菜单栏 → ribbon → 工作台三层 chrome）。
- 改动面：仅 `apps/desktop/src/main/index.ts`（import `nativeTheme` +
  `themeSource = "light"` 一行 + 注释）。通过 `pnpm --filter
  @translunar/desktop typecheck` 与 `vitest run`。
- 不改任何 UI 文案与 CSS。
