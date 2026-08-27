(() => {
  const root = document.querySelector("#prototype");
  if (!root) return;

  const icons = {
    undo: '<path d="M9 7 5 11l4 4"/><path d="M6 11h6a4 4 0 0 1 4 4"/>',
    redo: '<path d="m11 7 4 4-4 4"/><path d="M14 11H8a4 4 0 0 0-4 4"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
    next: '<path d="m7 5 7 7-7 7"/><path d="M15 5v14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    memory: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    term: '<path d="M5 5h14M12 5v14M8 19h8"/><path d="M7 9h10"/>',
    qa: '<path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="m8 13 2.5 2.5L16 10"/>',
    preview: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h7"/>',
    export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/>',
    palette: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m8 10 2 2-2 2m5 0h3"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1A8 8 0 0 0 14.7 6L14.3 3h-4.6l-.4 3a8 8 0 0 0-1.7 1.1l-2.5-1-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.5-1A8 8 0 0 0 9.3 18l.4 3h4.6l.4-3a8 8 0 0 0 1.7-1.1l2.5 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m6 15 6-6 6 6"/>',
    spark: '<path d="m12 3 1.2 4.3L17 9l-3.8 1.7L12 15l-1.2-4.3L7 9l3.8-1.7z"/><path d="m18 15 .6 2.1L21 18l-2.4.9L18 21l-.6-2.1L15 18l2.4-.9z"/>',
    folder: '<path d="M3 7h7l2 2h9v11H3z"/><path d="M3 7V5h7l2 2"/>',
    warning: '<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5m0 3v.2"/>',
  };

  const icon = (name, small = false) =>
    `<svg class="icon${small ? " icon--sm" : ""}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;

  const scenarios = {
    empty: { label: "空项目列表", dock: "memory", active: "s2", status: "Translunar CAT 就绪" },
    imported: { label: "已导入工作台", dock: "memory", active: "s2", status: "已自动保存句段 #2 草稿" },
    confirmed: { label: "确认并写入 TM", dock: "memory", active: "s3", status: "句段 #2 已确认并写入 TM，已前往下一未确认句段" },
    locked: { label: "锁定句段", dock: "memory", active: "s4", status: "句段 #4 已锁定" },
    fuzzy: { label: "未编辑模糊匹配 QA", dock: "qa", active: "s5", status: "QA 完成：2 个未解决问题" },
    unconfigured: { label: "AI 未配置", dock: "ai", active: "s2", status: "未配置 AI 供应商" },
    agent: { label: "Agent 等待人工审核", dock: "ai", active: "s6", status: "Agent 已完成：等待人工审核" },
    exportGate: { label: "导出 QA 门", dock: "qa", active: "s5", status: "导出已暂停：2 个 QA 错误未解决" },
  };

  const menuData = [
    ["文件", [
      ["导入文档…", "Ctrl+O", "import", "file"],
      ["导出译文…", "Ctrl+E", "export", "export"],
      ["sep"],
      ["项目设置…", "Ctrl+,", "settings", "settings"],
      ["返回项目列表", "", "empty", "folder"],
    ]],
    ["编辑", [
      ["撤销", "Ctrl+Z", "toast", "undo"],
      ["重做", "Ctrl+Shift+Z", "toast", "redo"],
      ["sep"],
      ["剪切", "Ctrl+X", "toast", "file"],
      ["复制", "Ctrl+C", "toast", "file"],
      ["粘贴", "Ctrl+V", "toast", "file"],
      ["sep"],
      ["查找…", "Ctrl+F", "find", "search"],
      ["替换…", "Ctrl+H", "replace", "search"],
    ]],
    ["视图", [
      ["命令搜索", "Ctrl+K", "palette", "palette"],
      ["预览面板", "Ctrl+P", "preview", "preview"],
      ["sep"],
      ["记忆面板", "Ctrl+1", "dock-memory", "memory"],
      ["术语面板", "Ctrl+2", "dock-term", "term"],
      ["QA 面板", "Ctrl+3", "dock-qa", "qa"],
      ["AI 面板", "Ctrl+4", "dock-ai", "spark"],
      ["sep"],
      ["实际大小", "Ctrl+0", "toast", "search"],
      ["切换全屏", "F11", "toast", "preview"],
    ]],
    ["项目", [
      ["新建项目…", "Ctrl+N", "new-project", "plus"],
      ["项目设置…", "Ctrl+,", "settings", "settings"],
      ["记忆库管理…", "", "tm-manage", "memory"],
      ["术语库管理…", "", "term-manage", "term"],
      ["sep"],
      ["归档项目", "", "toast", "folder"],
    ]],
    ["翻译", [
      ["确认当前句段", "Ctrl+Enter", "confirm", "check"],
      ["确认并到下一句段", "Ctrl+Alt+Enter", "confirm", "next"],
      ["确认并停留", "Ctrl+Alt+Shift+Enter", "confirm", "check"],
      ["锁定/解锁句段", "Ctrl+L", "lock", "lock"],
      ["sep"],
      ["插入记忆匹配", "Ctrl+1", "insert-memory", "memory"],
      ["插入术语", "Ctrl+2", "insert-term", "term"],
      ["预翻译", "", "toast", "spark"],
      ["检索选中文本", "F3", "concordance", "search"],
    ]],
    ["QA", [
      ["运行 QA", "", "run-qa", "qa"],
      ["查找下一个", "F4", "find-next", "next"],
      ["查找上一个", "Shift+F4", "find-prev", "next"],
      ["筛选 QA 问题", "", "chip-qa", "qa"],
      ["导出 QA 配置…", "", "settings", "settings"],
    ]],
    ["帮助", [
      ["键盘快捷键", "", "palette", "palette"],
      ["功能文档", "", "palette", "file"],
      ["sep"],
      ["界面状态：导出覆盖", "", "overwrite", "warning"],
      ["界面状态：引擎闸门", "", "engine-gate", "warning"],
      ["关于 Translunar", "", "toast", "spark"],
    ]],
  ];

  const rows = [
    {
      id: "s1", n: 1, source: "Welcome to {product}.", target: "欢迎使用 {product}。",
      state: "confirmed", origin: "100 TM", originClass: "", qa: "", locked: false,
    },
    {
      id: "s2", n: 2, source: "Your trial includes 30 days of full access.", target: "试用期包含 30 天的完整访问权限。",
      state: "draft", origin: "AI", originClass: "origin--ai", qa: "", locked: false,
    },
    {
      id: "s3", n: 3, source: "Invite your team and assign a project owner.", target: "",
      state: "untranslated", origin: "", originClass: "", qa: "", locked: false,
    },
    {
      id: "s4", n: 4, source: "Billing changes take effect on the next renewal date.", target: "账单变更将在下一个续订日期生效。",
      state: "confirmed", origin: "96 TM", originClass: "", qa: "", locked: true,
    },
    {
      id: "s5", n: 5, source: "Files are retained for 60 days after cancellation.", target: "取消后，文件会保留 30 天。",
      state: "confirmed", origin: "84 TM", originClass: "", qa: "2", locked: false,
    },
    {
      id: "s6", n: 6, source: "Click <b>Export</b> to download {{file_name}}.", target: "单击<b>导出</b>以下载 {{file_name}}。",
      state: "draft", origin: "AI", originClass: "origin--muted", qa: "", locked: false,
    },
    {
      id: "s7", n: 7, source: "Do not share your API key with anyone.", target: "请勿与任何人分享您的 API 密钥。",
      state: "confirmed", origin: "100 TM", originClass: "", qa: "", locked: false,
    },
    {
      id: "s8", n: 8, source: "Need help? Contact support@example.com.", target: "",
      state: "untranslated", origin: "", originClass: "", qa: "1", locked: false,
    },
  ];

  const tokenized = (value, danger = false) => {
    const escaped = value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    return escaped.replace(
      /(&lt;\/?[A-Za-z][^&]*?&gt;|\{\{[^{}]+\}\}|\{[^{}]+\}|%[a-zA-Z]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g,
      (token) => `<span class="token${danger ? " token--danger" : ""}">${token}</span>`,
    );
  };

  const stateGlyph = (state) =>
    state === "confirmed" ? "✓" : state === "draft" ? "✎" : "○";

  const menuMarkup = () =>
    menuData.map(([heading, entries], index) => `
      <div class="menu-wrap">
        <button class="menu-trigger" aria-expanded="false" data-menu="${index}">${heading}</button>
        <div class="menu" data-menu-panel="${index}" hidden>
          ${entries.map((entry) => entry[0] === "sep"
            ? '<div class="menu__sep"></div>'
            : `<button class="menu__item" data-command="${entry[2]}">
                ${icon(entry[3], true)}<span>${entry[0]}</span><kbd>${entry[1]}</kbd>
              </button>`).join("")}
        </div>
      </div>`).join("");

  const ribbonButton = (iconName, label, command, title, primary = false) => `
    <button class="ribbon__button${primary ? " ribbon__button--primary" : ""}" data-command="${command}" title="${title}">
      ${icon(iconName)}<span>${label}</span>
    </button>`;

  const renderRibbon = () => `
    <div class="ribbon" role="toolbar" aria-label="工作台命令">
      <div class="ribbon__group">
        ${ribbonButton("undo", "撤销", "toast", "撤销 Ctrl+Z")}
        ${ribbonButton("redo", "重做", "toast", "重做 Ctrl+Shift+Z")}
      </div>
      <div class="ribbon__group">
        ${ribbonButton("search", "查找", "find", "查找 Ctrl+F")}
        ${ribbonButton("next", "查找下一个", "find-next", "查找下一个 F4")}
      </div>
      <div class="ribbon__group">
        ${ribbonButton("check", "确认", "confirm", "确认并到下一未确认 Ctrl+Enter · 到下一句段 Ctrl+Alt+Enter · 停留 Ctrl+Alt+Shift+Enter", true)}
        ${ribbonButton("lock", "锁定", "lock", "锁定/解锁当前句段 Ctrl+L")}
        ${ribbonButton("memory", "插入记忆", "insert-memory", "应用最佳记忆匹配 Ctrl+1")}
        ${ribbonButton("term", "插入术语", "insert-term", "在光标处插入首选术语 Ctrl+2")}
      </div>
      <div class="ribbon__group">
        ${ribbonButton("qa", "运行 QA", "run-qa", "运行当前文档质量检查")}
        ${ribbonButton("preview", "预览", "preview", "展开/折叠预览 Ctrl+P")}
        ${ribbonButton("export", "导出", "export", "导出译文 Ctrl+E")}
        ${ribbonButton("palette", "命令搜索", "palette", "命令搜索 Ctrl+K")}
      </div>
      <span class="ribbon__spacer"></span>
      <label class="ribbon__filter">
        ${icon("search", true)}
        <input aria-label="搜索句段" placeholder="搜索句段" />
        <kbd>Ctrl⇧F</kbd>
      </label>
    </div>`;

  const renderRail = () => `
    <aside class="rail" aria-label="项目与文件">
      <div class="rail__scroll">
        <section class="rail-section">
          <div class="project-head">
            <div>
              <p class="eyebrow">项目</p>
              <h1 class="project-title">Orion Release Notes</h1>
            </div>
            <button class="icon-button" data-command="settings" title="项目设置">${icon("settings", true)}</button>
          </div>
          <div class="lang-pair"><span>EN-US</span><span>→</span><span>ZH-CN</span></div>
          <div class="progress-meta"><span>项目进度</span><strong>68%</strong></div>
          <div class="progress" aria-label="项目进度 68%"><span class="progress__done"></span><span class="progress__draft"></span></div>
        </section>
        <section class="rail-section">
          <p class="section-title">文件 · 3</p>
          <label class="file-search">${icon("search", true)}<input aria-label="搜索文件" placeholder="搜索文件" /></label>
          <div class="file-list">
            <button class="file" data-active="true" data-file="release-notes.docx">
              ${icon("file", true)}
              <span class="file__body"><span class="file__name">release-notes.docx</span><span class="file__meta">DOCX · 确认 68/100 · QA 3</span></span>
              <span class="file__pct">68%</span>
            </button>
            <button class="file" data-file="billing-faq.xlsx">
              ${icon("file", true)}
              <span class="file__body"><span class="file__name">billing-faq.xlsx</span><span class="file__meta">XLSX · 确认 42/54 · 草稿 8</span></span>
              <span class="file__pct">78%</span>
            </button>
            <button class="file" data-file="emails.json">
              ${icon("file", true)}
              <span class="file__body"><span class="file__name">emails.json</span><span class="file__meta">JSON · 确认 7/31 · 未译 20</span></span>
              <span class="file__pct">23%</span>
            </button>
          </div>
          <div class="doc-actions">
            <button class="btn btn--primary btn--xs" data-command="import">${icon("plus", true)}导入文档</button>
            <button class="btn btn--ghost btn--xs" data-action="toast">移除</button>
          </div>
        </section>
        <section class="rail-section">
          <p class="section-title">项目详情</p>
          <dl class="project-facts">
            <dt>创建</dt><dd>2026-08-21</dd>
            <dt>文件</dt><dd>3</dd>
            <dt>句段</dt><dd>185</dd>
            <dt>已确认</dt><dd>117</dd>
            <dt>草稿</dt><dd>24</dd>
            <dt>QA</dt><dd>3 未解决</dd>
          </dl>
        </section>
      </div>
    </aside>`;

  const renderRows = (scenario, activeId) =>
    rows.map((row) => {
      const active = row.id === activeId;
      const locked = scenario === "locked" && row.id === "s4" ? true : row.locked;
      const qa = (scenario === "fuzzy" || scenario === "exportGate") && row.id === "s5" ? "2" : row.qa;
      const rowState = scenario === "confirmed" && row.id === "s2" ? "confirmed" : row.state;
      const target = scenario === "confirmed" && row.id === "s2"
        ? "试用期包含 30 天的完整访问权限。"
        : row.target;
      const editing = active && !locked && scenario !== "confirmed";
      return `
        <tr data-row="${row.id}" data-active="${active}" data-locked="${locked}">
          <td class="grid__ordinal">${row.n}</td>
          <td><div class="source-text">${tokenized(row.source, row.id === "s8")}</div></td>
          <td>
            ${editing
              ? `<textarea class="target-editor" aria-label="句段 ${row.n} 译文" placeholder="输入译文">${target}</textarea>`
              : target
                ? `<div class="target-text">${tokenized(target, row.id === "s8")}</div>`
                : '<span class="target-placeholder">输入译文…</span>'}
          </td>
          <td>
            <div class="state-stack">
              ${locked ? `<span title="已锁定">${icon("lock", true)}</span>` : ""}
              <span class="state-glyph" data-state="${rowState}" title="${rowState === "confirmed" ? "已确认" : rowState === "draft" ? "草稿" : "未译"}">${stateGlyph(rowState)}</span>
              ${row.origin ? `<span class="origin ${row.originClass}" title="${row.origin.includes("AI") ? "来源：AI · 模型：gpt-5-mini" : `来源：TM · 分值：${row.origin.split(" ")[0]}`}">${row.origin}</span>` : ""}
              ${qa ? `<span class="qa-mark" title="${qa} 个未解决 QA 问题">⚠ ${qa}</span>` : ""}
              <span class="row-more">
                <button class="icon-button" data-row-menu="${row.id}" aria-label="句段 ${row.n} 菜单">${icon("dots", true)}</button>
                <span class="row-menu" data-row-menu-panel="${row.id}" hidden>
                  <button data-row-action="copy-source">${icon("file", true)}复制源文</button>
                  <button data-row-action="clear-target">${icon("close", true)}清空译文</button>
                  <button data-row-action="toggle-lock">${icon(locked ? "unlock" : "lock", true)}${locked ? "解锁" : "锁定"}</button>
                </span>
              </span>
            </div>
          </td>
        </tr>`;
    }).join("");

  const renderFind = () => `
    <div class="find-widget" hidden>
      <div class="find-row">
        <input type="text" aria-label="查找" value="retained" />
        <span class="find-count">1 / 3</span>
        <button class="icon-button" title="查找上一个 Shift+F4">${icon("chevronUp", true)}</button>
        <button class="icon-button" title="查找下一个 F4">${icon("chevronDown", true)}</button>
        <button class="icon-button" data-command="close-find" title="关闭 Esc">${icon("close", true)}</button>
      </div>
      <div class="find-row" data-replace-row hidden>
        <input type="text" aria-label="替换为" placeholder="替换为" />
        <button class="btn btn--xs" data-action="toast">替换</button>
        <button class="btn btn--xs" data-action="toast">全部替换</button>
        <label class="check"><input type="checkbox" />含已确认</label>
      </div>
    </div>`;

  const renderCenter = (scenario, active) => `
    <main class="center">
      <div class="doc-tabs" role="tablist">
        <button class="doc-tab" data-active="true"><span class="doc-tab__name">release-notes.docx</span><span class="doc-tab__close" data-action="toast">×</span></button>
        <button class="doc-tab"><span class="doc-tab__name">billing-faq.xlsx</span><span class="doc-tab__close" data-action="toast">×</span></button>
      </div>
      <div class="filterbar" aria-label="句段筛选">
        <span class="filter-label">${icon("search", true)}</span>
        ${["未译", "草稿", "已确认", "QA", "锁定", "有术语", "有标签"].map((filter, index) =>
          `<button class="chip" data-filter="${filter}" data-active="${(scenario === "fuzzy" || scenario === "exportGate") && filter === "QA"}">${filter}<span class="chip__x">×</span></button>`).join("")}
        <span class="filterbar__spacer"></span>
        <span class="filter-count">8 / 185</span>
      </div>
      <div class="grid-shell">
        <table class="grid">
          <thead><tr><th>#</th><th>源文 <span class="seg-context">EN-US</span></th><th>译文 <span class="seg-context">ZH-CN</span></th><th>状态</th></tr></thead>
          <tbody>${renderRows(scenario, active)}</tbody>
        </table>
      </div>
      <section class="preview" data-open="true">
        <div class="preview__bar">
          <span class="preview__title">预览</span>
          <div class="mini-tabs">
            <button class="mini-tab" data-preview-mode="proofread" data-active="true">校对</button>
            <button class="mini-tab" data-preview-mode="layout">版式</button>
          </div>
          <span class="preview__spacer"></span>
          <span class="badge badge--good">✓ 已确认</span>
          <span class="badge badge--warn">✎ 草稿</span>
          <button class="icon-button" data-command="preview" title="折叠预览 Ctrl+P">${icon("chevronDown", true)}</button>
        </div>
        <div class="preview__body">
          <div class="preview__document" data-preview-view="proofread">
            <button class="preview__segment" data-jump="s1">欢迎使用 <span class="token">{product}</span>。</button>
            <button class="preview__segment" data-jump="s2">试用期包含 30 天的完整访问权限。</button>
            <button class="preview__segment" data-jump="s3">Invite your team and assign a project owner.</button>
            <button class="preview__segment" data-jump="s4">账单变更将在下一个续订日期生效。</button>
            <button class="preview__segment" data-jump="s5">取消后，文件会保留 30 天。</button>
          </div>
          <div class="preview__document" data-preview-view="layout" hidden>
            <div style="width:76%;min-height:92px;margin:auto;padding:14px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-sm)">
              <strong style="font-family:var(--display)">Orion 发行说明</strong>
              <p style="margin:8px 0;color:var(--muted)">欢迎使用 Translunar。试用期包含 30 天的完整访问权限。</p>
            </div>
          </div>
          <aside class="preview__meta"><strong>release-notes.docx</strong><span>185 个句段 · 141 个已有译文</span><br /><span>版式预览与导出管线同步</span><br /><span>单击内容定位句段</span></aside>
        </div>
      </section>
      ${renderFind()}
    </main>`;

  const tmPanel = (scenario) => `
    <div class="subtabs">
      <button class="mini-tab" data-memory-view="matches" data-active="true">匹配</button>
      <button class="mini-tab" data-memory-view="concordance">Concordance</button>
    </div>
    <div data-memory-panel="matches">
      <section class="panel">
        <div class="panel__head"><h2 class="panel__title">翻译记忆</h2><span class="badge badge--good">${scenario === "confirmed" ? "100%" : "96%"} 最佳</span></div>
        <span class="seg-context">活动句段 #${scenario === "confirmed" ? "3" : "2"} · 3 条匹配</span>
        <div style="height:8px"></div>
        <article class="match" data-best="true">
          <div class="match__head"><span><span class="match__score">${scenario === "confirmed" ? "100%" : "96%"}</span><span class="match__memory">Orion Product TM</span></span><button class="btn btn--xs" data-command="insert-memory">应用</button></div>
          <p class="match__target">${scenario === "confirmed" ? "邀请您的团队并指定项目负责人。" : "试用期包含 30 天的完整访问权限。"}</p>
          <span class="match__source">${scenario === "confirmed" ? "Invite your team and assign a project owner." : "Your trial includes 30 days of full access."}</span>
        </article>
        <article class="match">
          <div class="match__head"><span><span class="match__score">87%</span><span class="match__memory">Customer Success</span></span><button class="btn btn--xs" data-command="insert-memory">应用</button></div>
          <p class="match__target">您的试用版包含 30 天完整功能。</p>
          <span class="match__source">The trial gives you 30 days of complete access.</span>
        </article>
      </section>
    </div>
    <div data-memory-panel="concordance" hidden>
      <section class="panel">
        <div class="panel__head"><h2 class="panel__title">检索</h2><span class="badge badge--info">F3</span></div>
        <label class="search-box">${icon("search", true)}<input value="trial" aria-label="检索词" /></label>
        <div style="height:8px"></div>
        <article class="match"><div class="match__head"><span class="badge">源文 · #2</span><button class="btn btn--ghost btn--xs" data-jump="s2">定位句段</button></div><p class="match__target">Your <mark>trial</mark> includes 30 days of full access.</p></article>
        <article class="match"><div class="match__head"><span class="badge badge--info">项目 TM · 87%</span></div><p class="match__target">The <mark>trial</mark> gives you 30 days of complete access.</p><span class="match__source">您的试用版包含 30 天完整功能。</span></article>
      </section>
    </div>`;

  const termPanel = () => `
    <section class="panel">
      <div class="panel__head"><h2 class="panel__title">术语</h2><span class="badge badge--good">2 个术语库</span></div>
      <span class="seg-context">活动句段 #2 · 2 个命中</span>
      <div class="term-row"><span class="term-pair"><strong>full access</strong><span>完整访问权限 <span class="badge badge--good">首选</span></span></span><button class="btn btn--xs" data-command="insert-term">插入</button></div>
      <div class="term-row"><span class="term-pair"><strong>trial</strong><span>试用期</span><span>试用版 <span class="badge badge--danger">禁用</span></span></span><button class="btn btn--xs" data-command="insert-term">插入</button></div>
    </section>
    <section class="panel">
      <div class="panel__head"><h2 class="panel__title">快速添加术语</h2><span class="badge">Product Terms · 可写</span></div>
      <div class="form-grid form-grid--2"><label class="field"><span>源术语</span><input value="renewal date" /></label><label class="field"><span>目标术语</span><input value="续订日期" /></label></div>
      <div style="height:8px"></div><button class="btn btn--xs" data-action="toast">添加术语</button>
    </section>`;

  const qaPanel = (scenario) => `
    <section class="panel">
      <div class="panel__head"><h2 class="panel__title">质量检查</h2><button class="btn btn--primary btn--xs" data-command="run-qa">运行 QA</button></div>
      <span class="seg-context">未解决 3 · 已忽略 1 · 已解决 12</span>
      <div class="qa-group">
        <div class="qa-group__head"><span>qa.unedited-fuzzy</span><span class="count count--danger">1</span></div>
        <article class="issue">
          <div class="issue__head"><span class="issue__severity">⚠</span><span class="badge badge--danger">未解决</span><span class="issue__rule">qa.unedited-fuzzy</span></div>
          <p class="issue__message">模糊匹配（84%）未修改即确认</p>
          <span class="issue__evidence">句段 #5 · Orion Product TM</span>
          <div class="issue__actions"><button class="btn btn--ghost btn--xs" data-action="toast">忽略</button><button class="btn btn--ghost btn--xs" data-action="toast">忽略同类</button><button class="btn btn--ghost btn--xs" data-action="toast">忽略本句</button><button class="btn btn--ghost btn--xs" data-jump="s5">定位</button></div>
        </article>
      </div>
      <div class="qa-group">
        <div class="qa-group__head"><span>qa.number-mismatch</span><span class="count count--danger">1</span></div>
        <article class="issue">
          <div class="issue__head"><span class="issue__severity">⛔</span><span class="badge badge--danger">未解决</span><span class="issue__rule">qa.number-mismatch</span></div>
          <p class="issue__message">源文数字与译文数字不一致</p>
          <span class="issue__evidence">源 [60] ≠ 译 [30]</span>
          <div class="issue__fix"><span>修复为：取消后，文件会保留 60 天。</span><button class="btn btn--xs" data-action="toast">应用修复</button></div>
          <div class="issue__actions"><button class="btn btn--ghost btn--xs" data-action="toast">忽略</button><button class="btn btn--ghost btn--xs" data-action="toast">忽略本句</button><button class="btn btn--ghost btn--xs" data-jump="s5">定位</button></div>
        </article>
      </div>
      <div class="qa-group">
        <div class="qa-group__head"><span>已忽略</span><span class="count">1</span></div>
        <article class="issue"><div class="issue__head"><span class="issue__severity" style="color:var(--warn)">⚠</span><span class="badge badge--warn">已忽略</span><span class="issue__rule">qa.length-ratio</span></div><p class="issue__message">译文长度比超出配置范围</p><div class="issue__actions"><button class="btn btn--ghost btn--xs" data-action="toast">恢复</button><button class="btn btn--ghost btn--xs" data-jump="s8">定位</button></div></article>
      </div>
    </section>`;

  const aiPanel = (scenario) => {
    const unconfigured = scenario === "unconfigured";
    const awaiting = scenario === "agent";
    return `
      <section class="panel">
        <div class="panel__head"><h2 class="panel__title">AI 辅助</h2><span class="badge ${unconfigured ? "badge--warn" : "badge--good"}">${unconfigured ? "未配置" : "OpenAI · gpt-5-mini"}</span></div>
        ${unconfigured ? `
          <div class="honest">未配置 AI 供应商</div>
          <div style="height:9px"></div>
          <div class="form-grid">
            <label class="field"><span>供应商</span><select><option>OpenAI</option><option>OpenAI Responses</option><option>Anthropic</option><option>Google Gemini</option><option>DeepL</option><option>DeepSeek</option><option>通义千问</option><option>智谱 GLM</option><option>Kimi</option><option>火山引擎</option><option>OpenAI 兼容端点</option></select></label>
            <label class="field"><span>模型</span><input placeholder="例如 gpt-5-mini" /></label>
            <label class="field"><span>Base URL · 可选</span><input placeholder="https://api.openai.com/v1" /></label>
            <label class="field"><span>API Key</span><input type="password" value="sk-placeholder" /></label>
            <button class="btn btn--primary" data-action="toast">保存并验证</button>
          </div>` : `
          <span class="seg-context">活动句段 #${awaiting ? "6" : "2"}</span>
          <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn--primary btn--xs" data-action="toast">${icon("spark", true)}AI 翻译</button><button class="btn btn--xs" data-action="toast">AI 润色</button><button class="btn btn--ghost btn--xs" data-action="toast">取消请求</button></div>
          <div class="candidate"><div><span class="badge badge--info">翻译候选</span> <span class="badge badge--good">标签完整</span></div><p>试用期包含 30 天的完整访问权限。</p><div style="display:flex;gap:5px"><button class="btn btn--primary btn--xs" data-action="toast">应用为草稿</button><button class="btn btn--ghost btn--xs" data-action="toast">拒绝</button></div></div>`}
      </section>
      <section class="panel">
        <div class="panel__head"><h2 class="panel__title">Agent</h2>${awaiting ? '<span class="badge badge--warn">等待人工审核</span>' : ""}</div>
        <label class="field"><span>任务指令 · 可选</span><textarea>沿用产品语气，保留所有占位符。</textarea></label>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn--primary btn--xs" ${unconfigured || awaiting ? "disabled" : ""}>创建任务单并运行</button><button class="btn btn--ghost btn--xs" ${awaiting ? "" : "disabled"}>取消运行</button></div>
        ${awaiting ? `
          <div class="agent-summary"><div><span>计划</span><strong>24</strong></div><div><span>TM</span><strong>9</strong></div><div><span>AI 草稿</span><strong>14</strong></div><div><span>失败</span><strong>1</strong></div><div><span>QA</span><strong>3</strong></div></div>
          <div style="margin-top:8px" class="honest"><strong>人工审核</strong><br />14 个 AI 草稿已写入工作台，导出仍需人工触发。</div>
          <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn--primary btn--xs" data-jump="s6">去工作台查看草稿</button><button class="btn btn--xs" data-command="export">去导出…</button></div>
          <div style="margin-top:8px">
            <div class="agent-step"><span class="agent-step__mark">✓</span><div><strong>规划 · #1</strong><span>识别 24 个未翻译句段</span></div></div>
            <div class="agent-step"><span class="agent-step__mark">✓</span><div><strong>TM 预翻 · #2</strong><span>应用 9 个高质量记忆匹配</span></div></div>
            <div class="agent-step"><span class="agent-step__mark">✓</span><div><strong>AI 起草 · #3</strong><span>生成 14 个草稿，1 个调用失败</span></div></div>
            <div class="agent-step"><span class="agent-step__mark">✓</span><div><strong>质检 · #4</strong><span>发现 3 个未解决问题</span></div></div>
          </div>` : unconfigured ? '<div style="height:8px"></div><div class="honest">Agent 需要已验证的 AI 配置</div>' : '<div style="height:8px"></div><span class="seg-context">尚未运行 · 当前文档 31 个未译句段</span>'}
      </section>`;
  };

  const renderDock = (scenario, activeDock) => `
    <aside class="dock" aria-label="辅助面板">
      <nav class="dock-tabs">
        <button class="dock-tab" data-dock="memory" data-active="${activeDock === "memory"}">${icon("memory", true)}记忆 <span class="count">96%</span></button>
        <button class="dock-tab" data-dock="term" data-active="${activeDock === "term"}">${icon("term", true)}术语 <span class="count">2</span></button>
        <button class="dock-tab" data-dock="qa" data-active="${activeDock === "qa"}">${icon("qa", true)}QA <span class="count count--danger">3</span></button>
        <button class="dock-tab" data-dock="ai" data-active="${activeDock === "ai"}">${icon("spark", true)}AI</button>
      </nav>
      <div class="dock-body">
        <div class="dock-view" data-dock-view="memory" ${activeDock === "memory" ? "" : "hidden"}>${tmPanel(scenario)}</div>
        <div class="dock-view" data-dock-view="term" ${activeDock === "term" ? "" : "hidden"}>${termPanel()}</div>
        <div class="dock-view" data-dock-view="qa" ${activeDock === "qa" ? "" : "hidden"}>${qaPanel(scenario)}</div>
        <div class="dock-view" data-dock-view="ai" ${activeDock === "ai" ? "" : "hidden"}>${aiPanel(scenario)}</div>
      </div>
    </aside>`;

  const renderStatus = (scenario) => `
    <footer class="statusbar">
      <span class="statusbar__message">${scenarios[scenario].status}</span>
      ${scenario === "empty" ? "" : `
        <span class="statusbar__item">句段 <strong>2/185</strong></span>
        <span class="statusbar__item">已确认 <strong>117</strong></span>
        <button class="statusbar__jump" data-command="chip-draft">草稿 <strong>24</strong></button>
        <span class="statusbar__item">剩余 <strong>44</strong></span>
        <span class="statusbar__item">字数 <strong>2,846</strong></span>
        <button class="statusbar__jump" data-command="chip-qa">QA <strong>3</strong></button>
        <span class="statusbar__progress"><span></span></span><strong>68%</strong>
        <span class="statusbar__item">行列 <strong>1:18</strong></span><span class="statusbar__item">INS</span>`}
      <button class="statusbar__jump statusbar__item" data-command="engine-gate"><span class="engine-dot"></span><strong>engine 0.4.0 · pid 2398</strong></button>
    </footer>`;

  const renderProjects = () => `
    <section class="projects">
      <div class="projects__create">
        <label class="field"><span>项目名称</span><input placeholder="例如：Q4 发布说明" /></label>
        <label class="field"><span>源语言</span><select><option>en-US</option><option>de-DE</option><option>ja-JP</option></select></label>
        <label class="field"><span>目标语言</span><select><option>zh-CN</option><option>fr-FR</option><option>ko-KR</option></select></label>
        <button class="btn btn--primary" data-command="new-project">${icon("plus", true)}创建项目</button>
      </div>
      <div class="projects__body">
        <div class="projects__head"><h2>项目 · 0</h2><label class="check"><input type="checkbox" />显示已归档项目</label></div>
        <div class="project-empty"><div class="project-empty__inner"><span class="project-empty__mark">${icon("folder")}</span><h3>还没有项目</h3><p>创建项目以设置语言对并开始导入源文档。</p><button class="btn btn--primary" data-command="new-project">新建项目</button></div></div>
      </div>
    </section>`;

  const renderApp = (scenario = "imported") => {
    const config = scenarios[scenario] || scenarios.imported;
    root.innerHTML = `
      <div class="app" data-scenario="${scenario}">
        <header class="topbar">
          <div class="brand"><span class="brand__mark">TL</span><span>Translunar</span></div>
          <nav class="menubar" aria-label="应用菜单">${menuMarkup()}</nav>
          <div class="topbar__title">${scenario === "empty" ? "项目" : "Orion Release Notes — release-notes.docx (en-US → zh-CN)"}</div>
          <div class="scenario"><label for="scenario-select">场景</label><select id="scenario-select">${Object.entries(scenarios).map(([id, item]) => `<option value="${id}" ${id === scenario ? "selected" : ""}>${item.label}</option>`).join("")}</select></div>
        </header>
        ${renderRibbon()}
        <div class="workspace">${scenario === "empty" ? renderProjects() : `${renderRail()}${renderCenter(scenario, config.active)}${renderDock(scenario, config.dock)}`}</div>
        ${renderStatus(scenario)}
      </div>
      <div id="modal-root"></div>
      <div class="toast" role="status" hidden><span class="engine-dot"></span><span data-toast-text>操作已完成</span></div>`;
    bindInteractions(scenario);
    if (scenario === "exportGate") {
      requestAnimationFrame(() => openDialog("qa-gate"));
    }
  };

  const field = (label, value = "", type = "text") =>
    `<label class="field"><span>${label}</span><input type="${type}" value="${value}" /></label>`;

  const dialogData = {
    "new-project": () => ({
      title: "新建项目", width: "narrow",
      body: `<div class="form-grid">${field("项目名称", "Orion Help Center")}${field("源语言", "en-US")}${field("目标语言", "zh-CN")}</div>`,
      foot: `<button class="btn" data-close-dialog>取消</button><button class="btn btn--primary" data-action="dialog-done">创建并打开</button>`,
    }),
    import: () => ({
      title: "导入文档", width: "narrow",
      body: `<div class="form-grid">
        <label class="field"><span>源文件</span><div style="display:flex;gap:7px"><input value="release-notes.docx" readonly /><button class="btn" data-action="toast">选择…</button></div></label>
        <label class="field"><span>分段方式</span><select><option>句子（SRX 规则）</option><option>段落</option></select></label>
        <label class="field"><span>SRX 规则</span><div style="display:flex;gap:7px"><input value="legal-en.srx" /><button class="btn" data-action="toast">选择…</button><button class="btn btn--ghost">清除</button></div></label>
        <span class="seg-context">此选择将保存为项目的导入默认</span>
      </div>`,
      foot: `<button class="btn" data-close-dialog>取消</button><button class="btn btn--primary" data-action="dialog-done">导入 185 个句段</button>`,
    }),
    settings: () => ({
      title: "项目设置 — Orion Release Notes", width: "wide",
      body: `<div class="settings-layout">
        <nav class="settings-nav"><button data-active="true">项目信息</button><button>导入默认</button><button>质量检查</button><button>翻译记忆</button><button>术语库</button><button>生命周期</button></nav>
        <div>
          <section class="settings-section"><h3>项目信息</h3><div class="form-grid form-grid--2">${field("项目名称", "Orion Release Notes")}${field("源语言", "en-US")}${field("目标语言", "zh-CN")}</div><div style="height:8px"></div><button class="btn btn--xs" data-action="toast">保存项目信息</button></section>
          <section class="settings-section"><h3>导入默认</h3><div class="form-grid form-grid--2"><label class="field"><span>默认分段方式</span><select><option>句子（SRX 规则）</option><option>段落</option></select></label>${field("默认 SRX", "legal-en.srx")}</div></section>
          <section class="settings-section"><h3>质量检查</h3><div class="setting-row"><span class="setting-row__body"><strong>有错误时阻止导出</strong><small>导出前运行 QA；人工可在门中选择仍要导出</small></span><button class="switch" data-on="true" aria-label="有错误时阻止导出"></button></div></section>
          <section class="settings-section"><h3>翻译记忆</h3><div class="setting-row"><label class="field" style="min-width:250px"><span>记忆库</span><select><option>Orion Product TM（可写）</option><option>Customer Success</option></select></label><span class="resource-table__actions"><button class="btn btn--xs" data-action="toast">导入外部 TM…</button><button class="btn btn--xs" data-command="overwrite">导出 TM…</button><button class="btn btn--ghost btn--xs" data-dialog="tm-manage">管理库</button></span></div></section>
          <section class="settings-section"><h3>术语库</h3><div class="setting-row"><span class="setting-row__body"><strong>Product Terms</strong><small>已挂载 · 248 条 · 可写</small></span><span class="resource-table__actions"><button class="btn btn--xs" data-dialog="term-manage">管理术语</button><button class="btn btn--xs" data-action="toast">导入 CSV/TBX…</button><button class="btn btn--xs" data-command="overwrite">导出…</button><button class="btn btn--ghost btn--xs" data-action="toast">卸载</button></span></div><div class="setting-row"><span class="setting-row__body"><strong>Legal Terms</strong><small>可挂载 · 82 条</small></span><button class="btn btn--xs" data-action="toast">挂载</button></div></section>
          <section class="settings-section"><h3>生命周期</h3><div class="setting-row"><span class="setting-row__body"><strong>进行中</strong><small>归档后从默认项目列表隐藏</small></span><button class="btn btn--xs" data-action="toast">归档项目</button></div></section>
        </div>
      </div>`,
      foot: `<button class="btn" data-close-dialog>关闭</button>`,
    }),
    "tm-manage": () => ({
      title: "记忆库管理 — Orion Release Notes", width: "wide",
      body: `<section class="settings-section"><h3>挂载的记忆库</h3>
        <table class="resource-table"><thead><tr><th>优先级</th><th>记忆库</th><th>状态</th><th>语言对</th><th>操作</th></tr></thead><tbody>
          <tr><td>1</td><td><strong>Orion Product TM</strong><br /><span class="seg-context">1,842 条</span></td><td><span class="badge badge--good">启用</span> <span class="badge badge--good">可写</span></td><td>en-US → zh-CN</td><td><span class="resource-table__actions"><button class="btn btn--xs">下移</button><button class="btn btn--xs">停用</button><button class="btn btn--xs">重命名</button><button class="btn btn--ghost btn--xs">卸载</button></span></td></tr>
          <tr><td>2</td><td><strong>Customer Success</strong><br /><span class="seg-context">964 条</span></td><td><span class="badge badge--good">启用</span> <span class="badge">只读</span></td><td>en-US → zh-CN</td><td><span class="resource-table__actions"><button class="btn btn--xs">上移</button><button class="btn btn--xs">停用</button><button class="btn btn--xs">设为可写</button><button class="btn btn--xs">重命名</button><button class="btn btn--ghost btn--xs">卸载</button></span></td></tr>
        </tbody></table></section>
        <section class="settings-section"><h3>挂载或新建</h3><div class="form-grid form-grid--2"><label class="field"><span>挂载已有记忆库</span><select><option>Legacy Website TM</option></select></label>${field("新建记忆库", "Orion Marketing")}</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn--xs" data-action="toast">挂载</button><button class="btn btn--xs" data-action="toast">新建并挂载</button><button class="btn btn--danger btn--xs" data-action="toast">删除未挂载库</button></div></section>
        <section class="settings-section"><h3>条目</h3><div style="display:grid;grid-template-columns:180px 1fr auto;gap:7px"><label class="field"><span>记忆库</span><select><option>Orion Product TM</option></select></label>${field("搜索源文或译文", "trial")}<button class="btn" data-action="toast" style="align-self:end">搜索</button></div>
        <table class="resource-table" style="margin-top:9px"><thead><tr><th>源文</th><th>译文</th><th>操作</th></tr></thead><tbody><tr><td>Your trial includes 30 days of full access.</td><td>试用期包含 30 天的完整访问权限。</td><td><span class="resource-table__actions"><button class="btn btn--xs">编辑</button><button class="btn btn--danger btn--xs">删除</button></span></td></tr><tr><td>Invite your team.</td><td>邀请您的团队。</td><td><span class="resource-table__actions"><button class="btn btn--xs">编辑</button><button class="btn btn--danger btn--xs">删除</button></span></td></tr></tbody></table><div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn btn--ghost btn--xs">上一页</button><span class="seg-context" style="padding-top:7px">第 1 / 37 页</span><button class="btn btn--ghost btn--xs">下一页</button></div></section>`,
      foot: `<button class="btn" data-close-dialog>关闭</button>`,
    }),
    "term-manage": () => ({
      title: "术语库管理 — Product Terms", width: "wide",
      body: `<div style="display:flex;justify-content:space-between;align-items:end;margin-bottom:9px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;min-width:440px">${field("源术语", "trial")}${field("目标术语", "试用期")}</div><button class="btn btn--primary" data-action="toast">添加术语</button></div>
        <table class="resource-table"><thead><tr><th>源术语</th><th>目标术语</th><th>属性</th><th>操作</th></tr></thead><tbody>
          <tr><td>trial</td><td>试用期</td><td><span class="badge badge--good">首选</span></td><td><span class="resource-table__actions"><button class="btn btn--xs">编辑</button><button class="btn btn--danger btn--xs">删除</button></span></td></tr>
          <tr><td>trial</td><td>试用版</td><td><span class="badge badge--danger">禁用</span></td><td><span class="resource-table__actions"><button class="btn btn--xs">编辑</button><button class="btn btn--danger btn--xs">删除译文</button></span></td></tr>
          <tr><td>renewal date</td><td>续订日期</td><td><span class="badge">允许</span></td><td><span class="resource-table__actions"><button class="btn btn--xs">编辑</button><button class="btn btn--danger btn--xs">删除</button></span></td></tr>
        </tbody></table>`,
      foot: `<button class="btn btn--ghost" data-action="toast">导入 CSV/TBX…</button><button class="btn" data-command="overwrite">导出…</button><span style="flex:1"></span><button class="btn" data-close-dialog>关闭</button>`,
    }),
    overwrite: () => ({
      title: "目标文件已存在", width: "narrow",
      body: `<div class="honest honest--danger">${icon("warning", true)} 已有文件将被替换。</div><div style="height:10px"></div><label class="field"><span>目标路径</span><input value="/exports/release-notes-zh-CN.docx" readonly /></label>`,
      foot: `<button class="btn" data-close-dialog>取消</button><button class="btn btn--danger" data-action="dialog-done">覆盖</button>`,
    }),
    "qa-gate": () => ({
      title: "存在 QA 错误，仍要导出吗？", width: "narrow",
      body: `<div class="honest honest--danger"><strong>2 个错误未解决</strong><br />qa.number-mismatch · qa.tag-placeholder_missing</div><div style="height:10px"></div><p class="dialog__intro">已运行导出前质量检查。可返回工作台处理问题，或记录本次人工决定并继续导出。</p><button class="btn btn--ghost btn--xs" data-command="dock-qa" data-close-dialog>打开 QA 面板</button>`,
      foot: `<button class="btn" data-close-dialog>取消</button><button class="btn btn--danger" data-action="dialog-done">仍要导出</button>`,
    }),
  };

  const openDialog = (id) => {
    if (id === "engine-gate") return openEngineGate();
    if (id === "palette") return openPalette();
    const factory = dialogData[id];
    if (!factory) return;
    const data = factory();
    const modalRoot = document.querySelector("#modal-root");
    modalRoot.innerHTML = `<div class="backdrop" data-backdrop>
      <section class="dialog dialog--${data.width || "narrow"}" role="dialog" aria-modal="true" aria-label="${data.title}">
        <header class="dialog__head"><h2 class="dialog__title">${data.title}</h2><button class="icon-button" data-close-dialog aria-label="关闭">${icon("close")}</button></header>
        <div class="dialog__body">${data.body}</div>
        <footer class="dialog__foot">${data.foot}</footer>
      </section>
    </div>`;
    bindModalInteractions();
  };

  const openEngineGate = () => {
    const modalRoot = document.querySelector("#modal-root");
    modalRoot.innerHTML = `<div class="backdrop" data-backdrop><section class="gate-card" role="alertdialog" aria-modal="true" aria-label="翻译引擎已停止"><span class="gate-card__mark">${icon("warning")}</span><h2>翻译引擎已停止</h2><p>编辑已锁定。上次错误：engine process exited with code 1。</p><span class="badge badge--danger">engine: 已停止</span><div class="gate-actions"><button class="btn" data-close-dialog>关闭</button><button class="btn btn--primary" data-action="dialog-done">重新启动引擎</button></div></section></div>`;
    bindModalInteractions();
  };

  const paletteRows = [
    ["命令", "导入文档…", "Ctrl+O", "import", "file"],
    ["命令", "导出译文…", "Ctrl+E", "export", "export"],
    ["命令", "确认当前句段", "Ctrl+Enter", "confirm", "check"],
    ["命令", "确认并到下一句段", "Ctrl+Alt+Enter", "confirm", "next"],
    ["命令", "确认并停留", "Ctrl+Alt+Shift+Enter", "confirm", "check"],
    ["命令", "查找与替换", "Ctrl+H", "replace", "search"],
    ["命令", "项目设置…", "Ctrl+,", "settings", "settings"],
    ["面板", "跳转到记忆", "Ctrl+1", "dock-memory", "memory"],
    ["面板", "跳转到术语", "Ctrl+2", "dock-term", "term"],
    ["面板", "跳转到 QA", "Ctrl+3", "dock-qa", "qa"],
    ["面板", "跳转到 AI / Agent", "Ctrl+4", "dock-ai", "spark"],
    ["文档", "打开文档：release-notes.docx", "", "toast", "file"],
    ["文档", "打开文档：billing-faq.xlsx", "", "toast", "file"],
    ["帮助", "功能文档：工作台快捷键", "", "toast", "palette"],
    ["帮助", "功能文档：QA 规则与导出门", "", "toast", "file"],
  ];

  const openPalette = () => {
    const grouped = [...new Set(paletteRows.map((row) => row[0]))];
    const modalRoot = document.querySelector("#modal-root");
    modalRoot.innerHTML = `<div class="backdrop" data-backdrop><section class="palette" role="dialog" aria-modal="true" aria-label="命令搜索">
      <input class="palette__input" aria-label="搜索命令" placeholder="输入命令、面板或文档…" autofocus />
      <div class="palette__list">${grouped.map((group) => `<div class="palette__section">${group}</div>${paletteRows.filter((row) => row[0] === group).map((row, index) => `<button class="palette__item" data-command="${row[3]}" data-label="${row[1]}" ${group === "命令" && index === 0 ? 'data-active="true"' : ""}>${icon(row[4], true)}<span>${row[1]}</span><kbd>${row[2]}</kbd></button>`).join("")}`).join("")}</div>
    </section></div>`;
    bindModalInteractions();
    const input = modalRoot.querySelector(".palette__input");
    input?.focus();
    input?.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      modalRoot.querySelectorAll(".palette__item").forEach((item) => {
        item.hidden = !item.dataset.label.toLowerCase().includes(query);
      });
      modalRoot.querySelectorAll(".palette__section").forEach((section) => {
        let sibling = section.nextElementSibling;
        let hasVisible = false;
        while (sibling && !sibling.classList.contains("palette__section")) {
          if (!sibling.hidden) hasVisible = true;
          sibling = sibling.nextElementSibling;
        }
        section.hidden = !hasVisible;
      });
    });
  };

  const showToast = (message = "操作已完成") => {
    const toast = document.querySelector(".toast");
    if (!toast) return;
    toast.querySelector("[data-toast-text]").textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2400);
  };

  const closeModal = () => {
    const modalRoot = document.querySelector("#modal-root");
    if (modalRoot) modalRoot.innerHTML = "";
  };

  const activateDock = (dock) => {
    document.querySelectorAll("[data-dock]").forEach((tab) => {
      tab.dataset.active = String(tab.dataset.dock === dock);
    });
    document.querySelectorAll("[data-dock-view]").forEach((view) => {
      view.hidden = view.dataset.dockView !== dock;
    });
  };

  const executeCommand = (command) => {
    document.querySelectorAll(".menu").forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll(".menu-trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    if (!command) return;
    if (dialogData[command] || command === "engine-gate") {
      openDialog(command);
      return;
    }
    if (command === "palette") {
      openPalette();
      return;
    }
    if (command.startsWith("dock-")) {
      closeModal();
      activateDock(command.replace("dock-", ""));
      return;
    }
    if (command === "run-qa") {
      activateDock("qa");
      showToast("QA 完成：检查 185 个句段，3 个未解决问题");
      return;
    }
    if (command === "concordance") {
      activateDock("memory");
      document.querySelector('[data-memory-view="concordance"]')?.click();
      return;
    }
    if (command === "find" || command === "replace") {
      const widget = document.querySelector(".find-widget");
      if (widget) {
        widget.hidden = false;
        const replace = widget.querySelector("[data-replace-row]");
        replace.hidden = command !== "replace";
        widget.querySelector('input[aria-label="查找"]')?.focus();
      }
      return;
    }
    if (command === "close-find") {
      const widget = document.querySelector(".find-widget");
      if (widget) widget.hidden = true;
      return;
    }
    if (command === "preview") {
      const preview = document.querySelector(".preview");
      if (preview) preview.dataset.open = String(preview.dataset.open !== "true");
      return;
    }
    if (command === "confirm") {
      const active = document.querySelector(".grid tr[data-active='true']");
      if (active) {
        active.querySelector(".state-glyph").dataset.state = "confirmed";
        active.querySelector(".state-glyph").textContent = "✓";
      }
      showToast("句段已确认并写入 TM");
      return;
    }
    if (command === "lock") {
      const active = document.querySelector(".grid tr[data-active='true']");
      if (active) {
        const next = active.dataset.locked !== "true";
        active.dataset.locked = String(next);
        showToast(next ? "当前句段已锁定" : "当前句段已解锁");
      }
      return;
    }
    if (command === "insert-memory") {
      const editor = document.querySelector(".target-editor");
      if (editor) editor.value = "试用期包含 30 天的完整访问权限。";
      showToast("已应用最佳记忆匹配（96%）为草稿");
      return;
    }
    if (command === "insert-term") {
      const editor = document.querySelector(".target-editor");
      if (editor) {
        const start = editor.selectionStart || editor.value.length;
        editor.value = editor.value.slice(0, start) + "完整访问权限" + editor.value.slice(start);
      }
      showToast("已在光标处插入术语");
      return;
    }
    if (command === "export") {
      openDialog("qa-gate");
      return;
    }
    if (command === "empty") {
      renderApp("empty");
      return;
    }
    if (command.startsWith("chip-")) {
      const name = command.replace("chip-", "").toUpperCase();
      const chip = [...document.querySelectorAll("[data-filter]")].find((item) => item.dataset.filter.toUpperCase().includes(name));
      if (chip) chip.dataset.active = "true";
      return;
    }
    if (command === "find-next" || command === "find-prev") {
      showToast(command === "find-next" ? "查找：已跳到下一匹配句段（F4）" : "查找：已跳到上一匹配句段（Shift+F4）");
      return;
    }
    showToast("命令已执行");
  };

  const bindModalInteractions = () => {
    const modalRoot = document.querySelector("#modal-root");
    modalRoot.querySelector("[data-backdrop]")?.addEventListener("mousedown", (event) => {
      if (event.target === event.currentTarget) closeModal();
    });
    modalRoot.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeModal));
    modalRoot.querySelectorAll("[data-action='dialog-done']").forEach((button) => button.addEventListener("click", () => {
      closeModal();
      showToast(button.textContent.trim() === "覆盖" ? "已覆盖并完成导出" : "操作已完成");
    }));
    modalRoot.querySelectorAll("[data-action='toast']").forEach((button) => button.addEventListener("click", () => showToast(button.textContent.trim() + "：完成")));
    modalRoot.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeCommand(button.dataset.command)));
    modalRoot.querySelectorAll("[data-dialog]").forEach((button) => button.addEventListener("click", () => openDialog(button.dataset.dialog)));
    modalRoot.querySelectorAll(".switch").forEach((toggle) => toggle.addEventListener("click", () => {
      toggle.dataset.on = String(toggle.dataset.on !== "true");
    }));
    modalRoot.querySelectorAll(".settings-nav button").forEach((button) => button.addEventListener("click", () => {
      modalRoot.querySelectorAll(".settings-nav button").forEach((item) => item.dataset.active = "false");
      button.dataset.active = "true";
    }));
  };

  const closeMenusFromOutside = (event) => {
    if (event.target.closest(".menu-wrap")) return;
    document.querySelectorAll(".menu").forEach((menu) => {
      menu.hidden = true;
    });
    document.querySelectorAll(".menu-trigger").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
  };

  const bindInteractions = (scenario) => {
    document.querySelector("#scenario-select")?.addEventListener("change", (event) => renderApp(event.target.value));
    document.querySelectorAll(".menu-trigger").forEach((trigger) => trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = document.querySelector(`[data-menu-panel="${trigger.dataset.menu}"]`);
      const opening = panel.hidden;
      document.querySelectorAll(".menu").forEach((menu) => { menu.hidden = true; });
      document.querySelectorAll(".menu-trigger").forEach((item) => item.setAttribute("aria-expanded", "false"));
      panel.hidden = !opening;
      trigger.setAttribute("aria-expanded", String(opening));
    }));
    document.removeEventListener("click", closeMenusFromOutside);
    document.addEventListener("click", closeMenusFromOutside);
    document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeCommand(button.dataset.command)));
    document.querySelectorAll("[data-action='toast']").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      showToast(button.textContent.trim() + "：完成");
    }));
    document.querySelectorAll("[data-dock]").forEach((tab) => tab.addEventListener("click", () => activateDock(tab.dataset.dock)));
    document.querySelectorAll("[data-filter]").forEach((chip) => chip.addEventListener("click", () => {
      chip.remove();
      showToast(`已移除筛选：${chip.dataset.filter}`);
    }));
    document.querySelectorAll("[data-row]").forEach((row) => row.addEventListener("click", (event) => {
      if (event.target.closest(".row-more")) return;
      document.querySelectorAll("[data-row]").forEach((item) => item.dataset.active = "false");
      row.dataset.active = "true";
      document.querySelectorAll("[data-jump]").forEach((item) => item.dataset.active = String(item.dataset.jump === row.dataset.row));
    }));
    document.querySelectorAll("[data-row-menu]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = document.querySelector(`[data-row-menu-panel="${button.dataset.rowMenu}"]`);
      document.querySelectorAll("[data-row-menu-panel]").forEach((menu) => {
        if (menu !== panel) menu.hidden = true;
      });
      panel.hidden = !panel.hidden;
    }));
    document.querySelectorAll("[data-row-action]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      button.closest(".row-menu").hidden = true;
      showToast(button.textContent.trim() + "：完成");
    }));
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => {
      const row = document.querySelector(`[data-row="${button.dataset.jump}"]`);
      row?.click();
      row?.scrollIntoView({ block: "center" });
    }));
    document.querySelectorAll("[data-preview-mode]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-preview-mode]").forEach((item) => item.dataset.active = String(item === button));
      document.querySelectorAll("[data-preview-view]").forEach((view) => view.hidden = view.dataset.previewView !== button.dataset.previewMode);
    }));
    document.querySelectorAll("[data-memory-view]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-memory-view]").forEach((item) => item.dataset.active = String(item === button));
      document.querySelectorAll("[data-memory-panel]").forEach((view) => view.hidden = view.dataset.memoryPanel !== button.dataset.memoryView);
    }));
    document.querySelector(".file-search input")?.addEventListener("input", (event) => {
      const query = event.target.value.toLowerCase();
      document.querySelectorAll("[data-file]").forEach((file) => file.hidden = !file.dataset.file.toLowerCase().includes(query));
    });
    document.removeEventListener("keydown", keyHandler);
    document.addEventListener("keydown", keyHandler);
  };

  const keyHandler = (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
    } else if (ctrl && event.key.toLowerCase() === "f") {
      event.preventDefault();
      executeCommand("find");
    } else if (ctrl && event.key.toLowerCase() === "h") {
      event.preventDefault();
      executeCommand("replace");
    } else if (ctrl && event.key === "Enter") {
      event.preventDefault();
      executeCommand("confirm");
    } else if (event.key === "F4") {
      event.preventDefault();
      executeCommand(event.shiftKey ? "find-prev" : "find-next");
    } else if (event.key === "Escape") {
      closeModal();
      executeCommand("close-find");
    }
  };

  renderApp(new URLSearchParams(window.location.search).get("scene") || "imported");
})();
