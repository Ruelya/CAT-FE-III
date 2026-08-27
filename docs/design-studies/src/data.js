/* Fixture data for the Translunar Workbench prototypes.
   Shared verbatim by every visual system, so the three studies can only
   differ in visual language — never in information architecture. */

const PROJECT = {
  name: "Aster 4.2 文档本地化",
  source: "en-US",
  target: "zh-CN",
  created: "2026-07-14",
  lifecycle: "active",
  segmentation: "sentence",
  srx: null,
  blockExportOnError: true,
};

const PROJECTS = [
  { name: "Aster 4.2 文档本地化", pair: "en-US → zh-CN", archived: false },
  { name: "Helios 控制台 UI 串", pair: "en-US → zh-CN", archived: false },
  { name: "Meridian 合同模板", pair: "de-DE → zh-CN", archived: false },
  { name: "Aster 3.9 文档（归档）", pair: "en-US → zh-CN", archived: true },
];

/* `dir` is the folder path the file sits in; the left rail derives its tree
   from these, so adding a document is enough to grow the tree. */
const DOCUMENTS = [
  {
    id: "doc-onboarding",
    name: "onboarding-guide.docx",
    dir: "docs/guides",
    format: "docx",
    total: 26,
    confirmed: 14,
    draft: 8,
    open: 7,
    words: 612,
  },
  {
    id: "doc-trouble",
    name: "troubleshooting.docx",
    dir: "docs/guides",
    format: "docx",
    total: 32,
    confirmed: 0,
    draft: 0,
    open: 0,
    words: 741,
  },
  {
    id: "doc-release",
    name: "release-notes-4.2.docx",
    dir: "docs",
    format: "docx",
    total: 41,
    confirmed: 41,
    draft: 0,
    open: 0,
    words: 903,
  },
  {
    id: "doc-api",
    name: "api-reference.md",
    dir: "reference",
    format: "markdown",
    total: 118,
    confirmed: 32,
    draft: 11,
    open: 4,
    words: 2417,
  },
  {
    id: "doc-strings",
    name: "console-strings.json",
    dir: "ui/strings",
    format: "json",
    total: 204,
    confirmed: 61,
    draft: 18,
    open: 2,
    words: 1180,
  },
  {
    id: "doc-terms",
    name: "terms-of-service.docx",
    dir: "legal",
    format: "docx",
    total: 57,
    confirmed: 57,
    draft: 0,
    open: 0,
    words: 1642,
  },
];

/* One segment per row of the shipped grid contract:
   ordinal, source, target, state, locked, origin, and the ids of any open
   QA findings. `origin` mirrors Segment.origin exactly — a score exists only
   for TM origins, never for AI. */
const SEGMENTS = [
  {
    n: 1,
    src: "Translunar Workbench",
    tgt: "Translunar 工作台",
    state: "confirmed",
    origin: { kind: "tmExact", score: 100 },
  },
  {
    n: 2,
    src: "This guide walks a new translator through a first document, from import to export.",
    tgt: "本指南带新译员走完第一个文档的完整流程：从导入到导出。",
    state: "confirmed",
  },
  {
    n: 3,
    src: "Before you begin, confirm that the desktop engine is running.",
    tgt: "开始之前，请确认桌面引擎正在运行。",
    state: "confirmed",
  },
  {
    n: 4,
    src: "The status bar reports the engine version and the process id.",
    tgt: "状态栏会显示引擎版本与进程号。",
    state: "confirmed",
    origin: { kind: "tmFuzzy", score: 92, edited: true },
    qa: ["q-ratio"],
  },
  {
    n: 5,
    src: "Importing a source file creates one segment per sentence.",
    tgt: "导入源文件会按句生成句段。",
    state: "confirmed",
    origin: { kind: "tmExact", score: 100 },
  },
  {
    n: 6,
    src: "Choose {mode} to segment by paragraph instead.",
    tgt: "选择 {mode} 可改为按段落分段。",
    state: "draft",
    origin: { kind: "aiDraft", model: "gpt-4o-mini" },
  },
  {
    n: 7,
    src: "Each segment carries its own state: untranslated, draft, or confirmed.",
    tgt: "每个句段都有独立状态：未译、草稿或已确认。 ",
    state: "draft",
    qa: ["q-space"],
  },
  {
    n: 8,
    src: "Type in the target cell; the draft saves itself after a short pause.",
    tgt: "在译文单元格中输入，草稿会在短暂停顿后自动保存。",
    state: "draft",
  },
  {
    n: 9,
    src: "Press Ctrl+Enter to confirm the segment and move to the next unconfirmed row.",
    tgt: "按 Ctrl+Enter 确认句段并跳至下一个未确认行。",
    state: "confirmed",
    origin: { kind: "tmFuzzy", score: 95 },
    qa: ["q-fuzzy"],
  },
  {
    n: 10,
    src: "Confirming writes the pair into the writable memory and propagates duplicates.",
    tgt: "确认会把句对写入可写记忆库，并传播到重复句段。",
    state: "draft",
  },
  {
    n: 11,
    src: "A locked segment is read-only: the editor never mounts and batch operations skip it.",
    tgt: "已锁定句段为只读：编辑器不会挂载，批量操作会跳过它。",
    state: "confirmed",
    locked: true,
  },
  {
    n: 12,
    src: "The memory panel lists up to {count} matches for the selected segment.",
    tgt: "记忆面板会为选中句段列出匹配项,按分值排序。",
    state: "draft",
    qa: ["q-token", "q-punct2"],
  },
  {
    n: 13,
    src: "Double-click a match, or press Ctrl+1, to apply it as a draft.",
    tgt: "双击匹配项，或按 Ctrl+1，即可将其应用为草稿。",
    state: "confirmed",
    origin: { kind: "tmExact", score: 100 },
  },
  {
    n: 14,
    src: "Terminology hits appear in the term dock; forbidden terms cannot be inserted.",
    tgt: "术语命中会出现在术语面板中，禁用词条无法插入。",
    state: "draft",
    qa: ["q-term"],
  },
  {
    n: 15,
    src: "Support for the 2026 file formats landed in this release.",
    tgt: "本次发布支持 2025 年的文件格式。",
    state: "draft",
    qa: ["q-number"],
  },
  {
    n: 16,
    src: "Run QA before export to catch number, tag, and terminology problems.",
    tgt: "导出前运行 QA，可发现数字、标签与术语问题。",
    state: "confirmed",
  },
  {
    n: 17,
    src: "Findings can be waived one at a time, by rule, or for a whole segment.",
    tgt: "问题可以逐条忽略、按规则忽略，或整句忽略。",
    state: "confirmed",
  },
  {
    n: 18,
    src: "Waiving records a human decision; it never edits the text and never writes memory.",
    tgt: "忽略只记录人工判断,不会修改译文,也不会写入记忆库。",
    state: "draft",
    qa: ["q-punct"],
  },
  {
    n: 19,
    src: "Where the engine can compute a correction, the panel offers to apply it.",
    tgt: "当引擎能算出修正时，面板会提供「应用修复」。",
    state: "confirmed",
  },
  {
    n: 20,
    src: "The preview pane has two honest views: proofread and layout.",
    tgt: "预览面板提供两种视图：校对视图与版式视图。",
    state: "confirmed",
  },
  {
    n: 21,
    src: "The layout view renders the real export artifact, so it cannot drift.",
    tgt: "版式视图渲染真实的导出产物，因此不会与导出结果不一致。",
    state: "confirmed",
  },
  {
    n: 22,
    src: "Click any paragraph in the preview to jump back to its segment.",
    tgt: "在预览中点击任意段落即可跳回对应句段。",
    state: "confirmed",
  },
  {
    n: 23,
    src: "Export refuses to overwrite an existing file without an explicit decision.",
    tgt: "",
    state: "untranslated",
  },
  {
    n: 24,
    src: "When the project blocks export on errors, the gate lists the failing rules.",
    tgt: "",
    state: "untranslated",
  },
  {
    n: 25,
    src: "The agent drafts and checks; a human still reviews and exports.",
    tgt: "",
    state: "untranslated",
  },
  {
    n: 26,
    src: "Nothing here reports a success the engine did not acknowledge.",
    tgt: "",
    state: "untranslated",
  },
];

/* QA findings. Severity and rule ids are the engine's; the localized message
   map mirrors QaPanel.messageFor, and `fix` exists only where qa.fix.list
   would actually propose a replacement. */
const ISSUES = [
  {
    id: "q-token",
    seg: 12,
    rule: "qa.tag-placeholder_missing",
    severity: "error",
    status: "open",
    message: "译文缺少源文中的占位符",
    evidence: { source: ["{count}"], target: [] },
  },
  {
    id: "q-number",
    seg: 15,
    rule: "qa.number-mismatch",
    severity: "error",
    status: "open",
    message: "数字与源文不一致",
    evidence: { source: ["2026"], target: ["2025"] },
    fix: {
      label: "数字改为源文数值",
      text: "本次发布支持 2026 年的文件格式。",
    },
  },
  {
    id: "q-space",
    seg: 7,
    rule: "qa.edge-whitespace",
    severity: "warning",
    status: "open",
    message: "译文首尾存在多余空白",
    evidence: { source: [], target: ["…已确认。 "] },
    fix: {
      label: "去除首尾空白",
      text: "每个句段都有独立状态：未译、草稿或已确认。",
    },
  },
  {
    id: "q-punct",
    seg: 18,
    rule: "qa.cjk-halfwidth-punctuation",
    severity: "warning",
    status: "open",
    message: "中文译文使用了半角标点",
    evidence: { source: [], target: [",", ","] },
    fix: {
      label: "标点改全角",
      text: "忽略只记录人工判断，不会修改译文，也不会写入记忆库。",
    },
  },
  {
    id: "q-punct2",
    seg: 12,
    rule: "qa.cjk-halfwidth-punctuation",
    severity: "warning",
    status: "open",
    message: "中文译文使用了半角标点",
    evidence: { source: [], target: [","] },
    fix: {
      label: "标点改全角",
      text: "记忆面板会为选中句段列出匹配项，按分值排序。",
    },
  },
  {
    id: "q-fuzzy",
    seg: 9,
    rule: "qa.unedited-fuzzy",
    severity: "warning",
    status: "open",
    message: "模糊匹配（95%）未修改即确认",
    evidence: { source: [], target: [] },
    behavioral: true,
  },
  {
    id: "q-term",
    seg: 14,
    rule: "qa.term-forbidden",
    severity: "warning",
    status: "open",
    message: "译文使用了禁用术语",
    evidence: { source: ["term"], target: ["词条"] },
  },
  {
    id: "q-ratio",
    seg: 4,
    rule: "qa.length-ratio",
    severity: "info",
    status: "waived",
    message: "译文长度比 46%，超出 60%–140%",
    evidence: { source: [], target: [] },
    note: "中文正常压缩，本文档统一忽略",
  },
  {
    id: "q-empty",
    seg: 8,
    rule: "qa.empty-target",
    severity: "error",
    status: "resolved",
    message: "译文为空",
    evidence: { source: [], target: [] },
  },
];

/* tm.lookup for the active segment (#10), best-first. */
const TM_MATCHES = [
  {
    score: 100,
    grade: "exact",
    memory: "Aster 主记忆库 2026",
    src: "Confirming writes the pair into the writable memory and propagates duplicates.",
    tgt: "确认会把句对写入可写记忆库，并传播到重复句段。",
  },
  {
    score: 86,
    grade: "fuzzy",
    memory: "Aster 旧版指南 TM",
    src: "Confirming writes the pair into the project memory.",
    tgt: "确认会把句对写入项目记忆库。",
  },
  {
    score: 71,
    grade: "fuzzy",
    memory: "通用参考 TM（只读）",
    src: "Confirming a segment propagates duplicates across the document.",
    tgt: "确认句段会在文档内传播重复内容。",
  },
];

const CONCORDANCE = {
  query: "memory",
  hits: [
    { n: 10, field: "source", text: "Confirming writes the pair into the writable memory and propagates duplicates." },
    { n: 12, field: "source", text: "The memory panel lists up to {count} matches for the selected segment." },
    { n: 18, field: "source", text: "Waiving records a human decision; it never edits the text and never writes memory." },
  ],
  tm: [
    { score: 94, src: "Attach a second memory to widen the lookup.", tgt: "挂载第二个记忆库可扩大检索范围。" },
    { score: 68, src: "The working memory is the single writable mount.", tgt: "工作记忆库是唯一可写的挂载。" },
  ],
};

const TERM_HITS = [
  {
    src: "memory",
    translations: [
      { term: "记忆库", tag: "preferred" },
      { term: "记忆", tag: null },
    ],
  },
  {
    src: "propagate",
    translations: [{ term: "传播", tag: "preferred" }],
  },
  {
    src: "term",
    translations: [
      { term: "术语", tag: "preferred" },
      { term: "词条", tag: "forbidden" },
    ],
  },
];

const MEMORIES = [
  { name: "Aster 主记忆库 2026", writable: true, enabled: true, entries: 8412, pair: null },
  { name: "Aster 旧版指南 TM", writable: false, enabled: true, entries: 3190, pair: null },
  { name: "通用参考 TM", writable: false, enabled: false, entries: 21744, pair: "语言对 en-GB → zh-CN（项目 en-US → zh-CN）" },
];

const TM_ENTRIES = [
  { src: "Confirming writes the pair into the writable memory and propagates duplicates.", tgt: "确认会把句对写入可写记忆库，并传播到重复句段。" },
  { src: "Import a source document to create segments.", tgt: "导入源文档以生成句段。" },
  { src: "The status bar reports the engine version and the process id.", tgt: "状态栏会显示引擎版本与进程号。" },
  { src: "Run QA before export.", tgt: "导出前请运行 QA。" },
];

const TERMBASES = [
  { name: "Aster 产品术语", mounted: true, writable: true, entries: 512 },
  { name: "法务用语（只读）", mounted: true, writable: false, entries: 88 },
  { name: "Helios 术语（未挂载）", mounted: false, writable: false, entries: 240 },
];

const TERM_ENTRIES = [
  { src: "memory", translations: [{ term: "记忆库", tag: "preferred" }, { term: "记忆", tag: null }] },
  { src: "term", translations: [{ term: "术语", tag: "preferred" }, { term: "词条", tag: "forbidden" }] },
  { src: "segment", translations: [{ term: "句段", tag: "preferred" }] },
];

const AI_PROVIDERS = [
  "OpenAI",
  "OpenAI Responses",
  "Anthropic",
  "Google Gemini",
  "DeepL",
  "DeepSeek",
  "通义千问",
  "智谱 GLM",
  "Kimi",
  "火山引擎",
  "OpenAI 兼容端点",
];

const AGENT_STEPS = [
  { i: 1, kind: "规划", status: "done", detail: "12 个未翻译句段进入任务单" },
  { i: 2, kind: "TM 预翻", status: "done", detail: "精确 3 / 模糊 2，填充 5 个句段" },
  { i: 3, kind: "AI 起草", status: "done", detail: "句段 #23 起草完成（gpt-4o-mini，1.2s）", seg: "3f9a41c8" },
  { i: 4, kind: "AI 起草", status: "done", detail: "句段 #24 起草完成（gpt-4o-mini，0.9s）", seg: "7b21d05e" },
  { i: 5, kind: "AI 起草", status: "failed", detail: "句段 #25 起草失败：provider timeout（已保留原译文）", seg: "c40e8812" },
  { i: 6, kind: "质检", status: "done", detail: "检查 26 个句段，7 个未解决问题" },
  { i: 7, kind: "总结", status: "done", detail: "TM 5 / AI 草稿 6 / 失败 1，等待人工审核" },
];

/* Application menu. Commands carry the real MenuCommand id where one exists;
   `note` marks a prototype-only regrouping of a shipped command. */
const MENUS = [
  {
    label: "文件",
    items: [
      { label: "新建项目…", cmd: "new-project", key: "" },
      { label: "导入文档…", cmd: "import-document", key: "Ctrl+O" },
      { label: "导出译文…", cmd: "export-document", key: "Ctrl+E" },
      { sep: true },
      { label: "项目设置…", cmd: "open-project-settings", key: "Ctrl+," },
      { label: "返回项目列表", cmd: "close-project", key: "" },
      { sep: true },
      { label: "退出", cmd: null, key: "Ctrl+Q" },
    ],
  },
  {
    label: "编辑",
    items: [
      { label: "撤销", cmd: "undo", key: "Ctrl+Z" },
      { label: "重做", cmd: "redo", key: "Ctrl+Y" },
      { sep: true },
      { label: "剪切", cmd: null, key: "Ctrl+X" },
      { label: "复制", cmd: null, key: "Ctrl+C" },
      { label: "粘贴", cmd: null, key: "Ctrl+V" },
      { label: "全选", cmd: null, key: "Ctrl+A" },
      { sep: true },
      { label: "查找…", cmd: "open-find", key: "Ctrl+F" },
      { label: "替换…", cmd: "open-replace", key: "Ctrl+H" },
      { label: "查找下一个", cmd: "find-next", key: "F4" },
      { label: "查找上一个", cmd: "find-prev", key: "Shift+F4" },
      { label: "筛选句段", cmd: "focus-filter", key: "Ctrl+Shift+F" },
      { label: "检索（取选中文本）", cmd: "open-concordance", key: "F3" },
    ],
  },
  {
    label: "视图",
    items: [
      { label: "命令面板", cmd: "open-command-palette", key: "Ctrl+K" },
      { sep: true },
      { label: "预览面板", cmd: "toggle-preview", key: "Ctrl+P" },
      { label: "折叠左栏", cmd: "toggle-left", key: "" },
      { label: "折叠右栏", cmd: "toggle-right", key: "" },
      { sep: true },
      { label: "记忆面板", cmd: "show-dock-memory", key: "Ctrl+1" },
      { label: "术语面板", cmd: "show-dock-term", key: "Ctrl+2" },
      { label: "QA 面板", cmd: "show-dock-qa", key: "Ctrl+3" },
      { label: "AI 面板", cmd: "show-dock-ai", key: "Ctrl+4" },
      { sep: true },
      { label: "实际大小", cmd: null, key: "Ctrl+0" },
      { label: "放大", cmd: null, key: "Ctrl+=" },
      { label: "缩小", cmd: null, key: "Ctrl+-" },
      { label: "切换全屏", cmd: null, key: "F11" },
    ],
  },
  {
    label: "项目",
    items: [
      { label: "项目设置…", cmd: "open-project-settings", key: "Ctrl+," },
      { label: "记忆库管理…", cmd: "open-tm-manage", key: "" },
      { label: "术语库管理…", cmd: "open-term-manage", key: "" },
      { sep: true },
      { label: "导入文档…", cmd: "import-document", key: "Ctrl+O" },
      { label: "归档项目", cmd: "archive-project", key: "" },
      { sep: true },
      { label: "返回项目列表", cmd: "close-project", key: "" },
    ],
  },
  {
    label: "翻译",
    items: [
      { label: "确认当前句段", cmd: "confirm-segment", key: "Ctrl+Enter" },
      { label: "确认并到下一句段", cmd: "confirm-segment-any", key: "Ctrl+Alt+Enter" },
      { label: "确认并停留", cmd: "confirm-segment-stay", key: "Ctrl+Alt+Shift+Enter" },
      { sep: true },
      { label: "锁定/解锁句段", cmd: "toggle-lock-segment", key: "Ctrl+L" },
      { label: "复制源文到译文", cmd: "copy-source", key: "" },
      { label: "清空译文", cmd: "clear-target", key: "" },
      { sep: true },
      { label: "预翻译（TM）", cmd: "pretranslate", key: "" },
      { label: "插入记忆匹配", cmd: "insert-tm", key: "Ctrl+1…9" },
      { label: "插入术语", cmd: "insert-term", key: "" },
      { sep: true },
      { label: "AI 翻译当前句段", cmd: "ai-translate", key: "" },
      { label: "AI 润色当前句段", cmd: "ai-refine", key: "" },
      { label: "Agent 模式…", cmd: "show-dock-ai", key: "Ctrl+4" },
    ],
  },
  {
    label: "QA",
    items: [
      { label: "运行 QA", cmd: "run-qa", key: "" },
      { label: "QA 面板", cmd: "show-dock-qa", key: "Ctrl+3" },
      { sep: true },
      { label: "忽略当前问题", cmd: "waive", key: "" },
      { label: "忽略同类问题", cmd: "waive-rule", key: "" },
      { label: "忽略本句问题", cmd: "waive-segment", key: "" },
      { label: "恢复为未解决", cmd: "restore", key: "" },
      { sep: true },
      { label: "应用引擎修复", cmd: "apply-fix", key: "" },
      { label: "有错误时阻止导出", cmd: "toggle-gate", key: "", checked: true },
    ],
  },
  {
    label: "帮助",
    items: [
      { label: "键盘快捷键…", cmd: "help-keys", key: "" },
      { label: "重新加载窗口", cmd: null, key: "Ctrl+R" },
      { label: "开发者工具", cmd: null, key: "F12" },
      { sep: true },
      { label: "关于 Translunar", cmd: null, key: "" },
    ],
  },
];

/* Command palette catalog: commands, dock jumps, and document jumps —
   exactly the three sources the shipped palette draws from. */
const PALETTE = [
  { g: "文件", label: "导入文档…", key: "Ctrl+O", cmd: "import-document" },
  { g: "文件", label: "导出译文…", key: "Ctrl+E", cmd: "export-document" },
  { g: "文件", label: "项目设置…", key: "Ctrl+,", cmd: "open-project-settings" },
  { g: "文件", label: "记忆库管理…", key: "", cmd: "open-tm-manage" },
  { g: "文件", label: "返回项目列表", key: "", cmd: "close-project" },
  { g: "翻译", label: "确认当前句段", key: "Ctrl+Enter", cmd: "confirm-segment" },
  { g: "翻译", label: "确认并到下一句段", key: "Ctrl+Alt+Enter", cmd: "confirm-segment-any" },
  { g: "翻译", label: "确认并停留", key: "Ctrl+Alt+Shift+Enter", cmd: "confirm-segment-stay" },
  { g: "翻译", label: "锁定/解锁当前句段", key: "Ctrl+L", cmd: "toggle-lock-segment" },
  { g: "翻译", label: "预翻译（TM）", key: "", cmd: "pretranslate" },
  { g: "审校", label: "查找…", key: "Ctrl+F", cmd: "open-find" },
  { g: "审校", label: "替换…", key: "Ctrl+H", cmd: "open-replace" },
  { g: "审校", label: "查找下一个", key: "F4", cmd: "find-next" },
  { g: "审校", label: "查找上一个", key: "Shift+F4", cmd: "find-prev" },
  { g: "审校", label: "筛选句段", key: "Ctrl+Shift+F", cmd: "focus-filter" },
  { g: "审校", label: "检索（取选中文本）", key: "F3", cmd: "open-concordance" },
  { g: "审校", label: "运行 QA", key: "", cmd: "run-qa" },
  { g: "视图", label: "预览面板", key: "Ctrl+P", cmd: "toggle-preview" },
  { g: "面板", label: "记忆面板", key: "Ctrl+1", cmd: "show-dock-memory" },
  { g: "面板", label: "术语面板", key: "Ctrl+2", cmd: "show-dock-term" },
  { g: "面板", label: "QA 面板", key: "Ctrl+3", cmd: "show-dock-qa" },
  { g: "面板", label: "AI 面板", key: "Ctrl+4", cmd: "show-dock-ai" },
  { g: "文档", label: "打开文档：docs/guides/onboarding-guide.docx", key: "", cmd: "open-doc-onboarding" },
  { g: "文档", label: "打开文档：docs/guides/troubleshooting.docx", key: "", cmd: "open-doc-trouble" },
  { g: "文档", label: "打开文档：docs/release-notes-4.2.docx", key: "", cmd: "open-doc-release" },
  { g: "文档", label: "打开文档：reference/api-reference.md", key: "", cmd: "open-doc-api" },
  { g: "文档", label: "打开文档：ui/strings/console-strings.json", key: "", cmd: "open-doc-strings" },
  { g: "文档", label: "打开文档：legal/terms-of-service.docx", key: "", cmd: "open-doc-terms" },
];

/* Ribbon rows. `verb` ids reuse the menu command ids so one dispatcher
   serves menu, ribbon, palette and shortcuts — as in the shipped app. */
const RIBBON = [
  {
    group: "历史",
    items: [
      { id: "undo", label: "撤销", title: "撤销（Ctrl+Z）", icon: "undo" },
      { id: "redo", label: "重做", title: "重做（Ctrl+Y）", icon: "redo" },
    ],
  },
  {
    group: "文档",
    items: [
      { id: "import-document", label: "导入", title: "导入文档（Ctrl+O）", icon: "import" },
      { id: "export-document", label: "导出", title: "导出译文（Ctrl+E）", icon: "export" },
    ],
  },
  {
    group: "翻译",
    items: [
      { id: "confirm-segment", label: "确认", title: "确认句段（Ctrl+Enter）", icon: "check", primary: true },
      { id: "toggle-lock-segment", label: "锁定", title: "锁定句段（Ctrl+L）", icon: "lock" },
      { id: "insert-tm", label: "插入记忆", title: "插入记忆匹配（Ctrl+1…9）", icon: "memory" },
      { id: "insert-term", label: "插入术语", title: "插入术语", icon: "term" },
      { id: "pretranslate", label: "预翻译", title: "TM 预翻译整篇文档", icon: "bolt" },
    ],
  },
  {
    group: "审校",
    items: [
      { id: "open-find", label: "查找", title: "查找（Ctrl+F）", icon: "search" },
      { id: "find-next", label: "查找下一个", title: "查找下一个（F4）", icon: "next" },
      { id: "open-replace", label: "替换", title: "替换（Ctrl+H）", icon: "replace" },
      { id: "open-concordance", label: "检索", title: "检索（F3，取选中文本）", icon: "concord" },
      { id: "run-qa", label: "运行 QA", title: "对整篇文档运行质量检查", icon: "qa" },
      { id: "toggle-preview", label: "预览", title: "预览面板（Ctrl+P）", icon: "preview" },
    ],
  },
];

const SCENARIOS = [
  { id: "projects", label: "空项目列表" },
  { id: "grid", label: "导入后的网格" },
  { id: "confirmed", label: "确认写入 TM" },
  { id: "locked", label: "锁定句段" },
  { id: "qa", label: "模糊未改 QA" },
  { id: "ai", label: "AI 未配置" },
  { id: "agent", label: "Agent 待审核" },
  { id: "gate", label: "导出 QA 门" },
];
