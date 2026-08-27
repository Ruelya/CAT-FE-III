/* Shared fake workbench data for the three SaaS design studies.
   Mirrors the real engine contracts: segments carry state/origin/lock,
   QA issues carry ruleId/severity/status/evidence/fix, TM hits carry
   score/grade/memory. One data module guarantees the three studies show
   the same information architecture. */

window.TL_DATA = (() => {
  const project = {
    id: "p1",
    name: "Relay 桌面客户端 3.2 文档",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    createdAt: "2026-07-30",
    lifecycle: "active",
    blockExportOnError: true,
    segmentation: "sentence",
    srxPath: null,
  };

  const memories = [
    { id: "m1", name: "主工作记忆", writable: true, enabled: true, mounted: true, pair: "en-US → zh-CN", entries: 1284 },
    { id: "m2", name: "产品文档 2025", writable: false, enabled: true, mounted: true, pair: "en-US → zh-CN", entries: 862 },
    { id: "m3", name: "市场素材（旧）", writable: false, enabled: false, mounted: false, pair: "en-US → zh-TW", entries: 90 },
  ];

  const termbases = [
    {
      id: "tb1",
      name: "产品术语库",
      writable: true,
      mounted: true,
      entries: [
        { id: "te1", source: "workspace", translations: [ { id: "tt1", term: "工作区", preferred: true }, { id: "tt2", term: "工作空间" } ] },
        { id: "te2", source: "sync", translations: [ { id: "tt3", term: "同步", preferred: true } ] },
        { id: "te3", source: "legacy client", translations: [ { id: "tt4", term: "旧版客户端", forbidden: true } ] },
        { id: "te4", source: "linked device", translations: [ { id: "tt5", term: "关联设备", preferred: true } ] },
      ],
    },
    { id: "tb2", name: "平台通用词表", writable: false, mounted: false, entries: [] },
  ];

  // Segment fields: state untranslated|draft|confirmed, locked, origin
  // {kind:'tmExact'|'tmFuzzy'|'ai'|null, score, model, edited}.
  const seg = (n, source, target, state, extra = {}) => ({
    id: `s${n}`,
    ordinal: n - 1,
    source,
    target,
    state,
    locked: false,
    origin: null,
    ...extra,
  });

  const segsGuide = [
    seg(1, "Relay keeps your files in sync across every device you sign in to.",
      "Relay 会在您登录的所有设备之间保持文件同步。", "confirmed",
      { origin: { kind: "tmExact", score: 100 } }),
    seg(2, "Choose a folder to get started, then select {folderName} to confirm.",
      "选择一个文件夹开始，然后选择 {folderName} 以确认。", "draft"),
    seg(3, "Your workspace stays available offline and syncs when you reconnect.",
      "工作区在离线时仍可使用，重新联网后会自动同步。", "draft",
      { origin: { kind: "tmFuzzy", score: 88, edited: true } }),
    seg(4, "Up to %d devices can be linked to one account.",
      "", "untranslated"),
    seg(5, "Shared folders are read-only until the owner grants edit access.",
      "共享文件夹在所有者授予编辑权限之前为只读。", "confirmed"),
    seg(6, "<b>Warning:</b> removing a device also clears its local cache.",
      "<b>警告：移除设备的同时会清除其本地缓存。", "draft"),
    seg(7, "Sync history keeps the last 30 versions of every file.",
      "同步历史会保留每个文件最近 30 个版本。", "confirmed",
      { origin: { kind: "tmFuzzy", score: 91, edited: false } }),
    seg(8, "Drag files onto the tray icon to queue them for upload.",
      "将文件拖到托盘图标上即可加入上传队列。", "confirmed", { locked: true }),
    seg(9, "Bandwidth limits apply only while the desktop app is running.",
      "带宽限制仅在桌面应用运行期间生效。", "draft",
      { origin: { kind: "ai", model: "gpt-5.2" } }),
    seg(10, "Use &amp; to combine filters in the search bar.",
      "", "untranslated"),
    seg(11, "Conflicted copies are renamed with the device name and timestamp.",
      "发生冲突的副本会以设备名和时间戳重命名.", "draft"),
    seg(12, "The free plan includes 5 GB of storage and 2 linked devices.",
      "免费方案包含 5 GB 存储空间和 3 台关联设备。", "draft"),
  ];

  const segsNotes = [
    seg(1, "Relay 3.2 ships selective sync for teams.", "Relay 3.2 为团队带来选择性同步。", "confirmed"),
    seg(2, "Improved conflict resolution for large binary files.", "改进了大型二进制文件的冲突处理。", "confirmed"),
    seg(3, "The transfer queue now survives app restarts.", "传输队列现在可以在应用重启后保留。", "draft"),
    seg(4, "Fixed a crash when unlinking a device mid-sync.", "", "untranslated"),
    seg(5, "New keyboard shortcuts for the activity feed.", "", "untranslated"),
    seg(6, "Reduced memory usage during initial indexing.", "降低了首次索引期间的内存占用。", "draft"),
  ];

  const segsStrings = [
    seg(1, "Sign in", "登录", "confirmed"),
    seg(2, "Pause sync", "暂停同步", "confirmed"),
    seg(3, "Resume sync", "继续同步", "confirmed"),
    seg(4, "Linked devices", "关联设备", "confirmed"),
    seg(5, "Storage used: {used} of {total}", "已用存储：{used} / {total}", "draft"),
    seg(6, "Remove this device", "移除此设备", "draft"),
    seg(7, "Open folder", "", "untranslated"),
    seg(8, "Preferences", "", "untranslated"),
  ];

  const documents = [
    { id: "d1", name: "user-guide.docx", folder: "docs/manual", format: "docx", sourceWords: 214, segments: segsGuide },
    { id: "d2", name: "release-notes-3.2.docx", folder: "docs", format: "docx", sourceWords: 96, segments: segsNotes },
    { id: "d3", name: "ui-strings.json", folder: "app/locales", format: "json", sourceWords: 42, segments: segsStrings },
  ];

  // QA issues for d1. fix != null renders 修复为 + 应用修复.
  const qaIssues = [
    {
      id: "q1", docId: "d1", segId: "s12", ruleId: "qa.number-mismatch",
      severity: "error", status: "open",
      message: "数字与源文不一致",
      evidence: { source: ["5", "2"], target: ["5", "3"] },
      fix: { label: "数字改为源文数值", text: "免费方案包含 5 GB 存储空间和 2 台关联设备。" },
    },
    {
      id: "q2", docId: "d1", segId: "s6", ruleId: "qa.tag-placeholder_missing",
      severity: "error", status: "open",
      message: "译文缺少源文中的占位符/标签",
      evidence: { source: ["</b>"], target: [] },
      fix: null,
    },
    {
      id: "q3", docId: "d1", segId: "s7", ruleId: "qa.unedited-fuzzy",
      severity: "warning", status: "open",
      message: "模糊匹配（91%）未修改即确认",
      evidence: { source: [], target: [] },
      fix: null,
    },
    {
      id: "q4", docId: "d1", segId: "s11", ruleId: "qa.cjk-halfwidth-punctuation",
      severity: "info", status: "open",
      message: "中文译文使用了半角标点",
      evidence: { source: [], target: ["."] },
      fix: { label: "标点改全角", text: "发生冲突的副本会以设备名和时间戳重命名。" },
    },
    {
      id: "q5", docId: "d1", segId: "s3", ruleId: "qa.length-ratio",
      severity: "warning", status: "waived",
      message: "译文长度比 148%，超出 40%–130%",
      evidence: { source: [], target: [] },
      fix: null,
    },
  ];

  // TM hits per segment (active-segment lookup, best first).
  const tmHits = {
    s1: [ { score: 100, grade: "exact", memory: "主工作记忆", source: "Relay keeps your files in sync across every device you sign in to.", target: "Relay 会在您登录的所有设备之间保持文件同步。" } ],
    s4: [ { score: 74, grade: "fuzzy", memory: "产品文档 2025", source: "Up to 10 devices can be linked to one account.", target: "一个账户最多可关联 10 台设备。" } ],
    s2: [
      { score: 84, grade: "fuzzy", memory: "主工作记忆", source: "Choose a folder to get started, then press Continue to confirm.", target: "选择一个文件夹开始，然后按「继续」以确认。" },
      { score: 71, grade: "fuzzy", memory: "产品文档 2025", source: "Select a folder to get started with selective sync.", target: "选择一个文件夹，开始使用选择性同步。" },
    ],
    s3: [ { score: 88, grade: "fuzzy", memory: "主工作记忆", source: "Your workspace stays available offline.", target: "工作区在离线时仍然可用。" } ],
    s7: [ { score: 91, grade: "fuzzy", memory: "产品文档 2025", source: "Sync history keeps the last 25 versions of every file.", target: "同步历史会保留每个文件最近 25 个版本。" } ],
    s9: [ { score: 63, grade: "fuzzy", memory: "主工作记忆", source: "Limits apply while the app is running.", target: "限制在应用运行期间生效。" } ],
    s12: [ { score: 76, grade: "fuzzy", memory: "主工作记忆", source: "The free plan includes 5 GB of storage.", target: "免费方案包含 5 GB 存储空间。" } ],
  };

  // Term hits per segment.
  const termHits = {
    s1: [ { source: "sync", translations: [ { term: "同步", preferred: true } ] } ],
    s3: [
      { source: "workspace", translations: [ { term: "工作区", preferred: true }, { term: "工作空间" } ] },
      { source: "sync", translations: [ { term: "同步", preferred: true } ] },
    ],
    s7: [ { source: "sync", translations: [ { term: "同步", preferred: true } ] } ],
    s12: [ { source: "linked device", translations: [ { term: "关联设备", preferred: true } ] } ],
  };

  // TM manage sample entries (主工作记忆 first page).
  const tmEntries = [
    { id: "e1", source: "Relay keeps your files in sync across every device you sign in to.", target: "Relay 会在您登录的所有设备之间保持文件同步。" },
    { id: "e2", source: "Choose a folder to get started, then press Continue to confirm.", target: "选择一个文件夹开始，然后按「继续」以确认。" },
    { id: "e3", source: "Your workspace stays available offline.", target: "工作区在离线时仍然可用。" },
    { id: "e4", source: "Shared folders are read-only by default.", target: "共享文件夹默认只读。" },
    { id: "e5", source: "Limits apply while the app is running.", target: "限制在应用运行期间生效。" },
    { id: "e6", source: "The free plan includes 5 GB of storage.", target: "免费方案包含 5 GB 存储空间。" },
    { id: "e7", source: "Drag files onto the tray icon.", target: "将文件拖到托盘图标上。" },
    { id: "e8", source: "Open the activity feed.", target: "打开动态列表。" },
    { id: "e9", source: "Pause sync for one hour.", target: "暂停同步一小时。" },
    { id: "e10", source: "Storage used", target: "已用存储" },
    { id: "e11", source: "Unlink this device.", target: "取消关联此设备。" },
    { id: "e12", source: "Version history", target: "版本历史" },
  ];

  const agentRun = {
    status: "awaitingReview",
    planned: 14, tm: 3, ai: 9, failed: 2, qaOpen: 3,
    steps: [
      { index: 1, kind: "规划", status: "done", detail: "扫描 14 个未译句段，生成任务单" },
      { index: 2, kind: "TM 预翻", status: "done", detail: "填充 3 个（精确 2 / 模糊 1），跳过 1 个已锁定句段" },
      { index: 3, kind: "AI 起草", status: "done", detail: "起草 9 个句段（gpt-5.2），2 个请求失败" },
      { index: 4, kind: "质检", status: "done", detail: "qa.run：3 个未解决问题" },
      { index: 5, kind: "总结", status: "done", detail: "草稿已就绪，等待人工审核；未确认任何句段" },
    ],
  };

  const providers = [
    "OpenAI", "OpenAI Responses", "Anthropic", "Google Gemini", "DeepL",
    "DeepSeek", "通义千问", "智谱 GLM", "Kimi", "火山引擎", "OpenAI 兼容端点",
  ];

  return { project, memories, termbases, documents, qaIssues, tmHits, termHits, tmEntries, agentRun, providers };
})();
