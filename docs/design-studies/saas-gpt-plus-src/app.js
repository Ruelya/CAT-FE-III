/* Prototype runtime shared by every visual system.
   Owns state, the command dispatcher, all markup, and the keymap. Themes
   never touch this file — identical IA by construction. */

/* ---------------------------------------------------------------- utils */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Placeholder grammar mirrored from lib/tokens.ts. */
const TOKEN_RE = /(\{\{[^}]+\}\}|\{[^}\s]+\}|%[sd]|<\/?[a-zA-Z][^>]*>|&[a-z]+;)/g;

function tokens(text, danger) {
  if (!text) return "";
  return esc(text).replace(
    /(\{\{[^}]+\}\}|\{[^}\s]+\}|%[sd]|&lt;\/?[a-zA-Z][^&]*&gt;|&amp;[a-z]+;)/g,
    (m) => {
      const raw = m.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const bad = danger && danger.includes(raw);
      return `<span class="tok"${bad ? ' data-danger="1"' : ""}>${m}</span>`;
    },
  );
}

const ICONS = {
  undo: "M9 14 4 9l5-5|M4 9h11a5 5 0 0 1 0 10h-4",
  redo: "m15 14 5-5-5-5|M20 9H9a5 5 0 0 0 0 10h4",
  import: "M12 4v10m0 0 4-4m-4 4-4-4|M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  export: "M12 14V4m0 0 4 4m-4-4-4 4|M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  check: "m5 12 5 5L20 7",
  lock: "M6 11h12v9H6z|M9 11V8a3 3 0 0 1 6 0v3",
  unlock: "M6 11h12v9H6z|M9 11V8a3 3 0 0 1 5.7-1.3",
  memory:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  term: "M12 6c-1.6-1.3-3.6-2-6-2H4v13h2c2.4 0 4.4.7 6 2 1.6-1.3 3.6-2 6-2h2V4h-2c-2.4 0-4.4.7-6 2z|M12 6v13",
  bolt: "M13 3 4 14h7l-1 7 9-11h-7l1-7z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|m20 20-3.6-3.6",
  next: "M12 5v14m0 0 5-5m-5 5-5-5",
  prev: "M12 19V5m0 0 5 5m-5-5-5 5",
  replace: "M4 4h9v9H4z|M11 11h9v9h-9z",
  concord: "M4 6h10M4 12h6M4 18h5|M16 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z|m19 19 2 2",
  qa: "M9 4h6v3H9z|M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2|m9 14 2 2 4-4",
  preview: "M4 4h16v16H4z|M4 14h16",
  settings:
    "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z|M18.9 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.5 1.5 0 0 0-2.5 1.1v.2a1.9 1.9 0 1 1-3.8 0V20a1.5 1.5 0 0 0-2.5-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.5 1.5 0 0 0-1.1-2.5H3.6a1.9 1.9 0 1 1 0-3.8h.2A1.5 1.5 0 0 0 4.9 7.4l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.5 1.5 0 0 0 2.5-1.1V3.4a1.9 1.9 0 1 1 3.8 0v.2a1.5 1.5 0 0 0 2.5 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.5 1.5 0 0 0 1.1 2.5h.2a1.9 1.9 0 1 1 0 3.8H20a1.5 1.5 0 0 0-1.1.8z",
  ai: "m12 3 1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z|m18.2 15 .8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z",
  dots: "M6 12h.01|M12 12h.01|M18 12h.01",
  x: "m6 6 12 12|m18 6-12 12",
  down: "m6 9 6 6 6-6",
  up: "m6 15 6-6 6 6",
  right: "m9 6 6 6-6 6",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  folder: "M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  file: "M14 3v4a1 1 0 0 0 1 1h4|M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13",
  cmd: "M9 9h6v6H9z|M9 9V7a2 2 0 1 0-2 2h2zm0 6v2a2 2 0 1 1-2-2h2zm6-6V7a2 2 0 1 1 2 2h-2zm0 6v2a2 2 0 1 0 2-2h-2z",
  agent: "M9 4h6a2 2 0 0 1 2 2v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V6a2 2 0 0 1 2-2z|M9 14h.01|M15 14h.01",
};

function ic(name, size) {
  const d = ICONS[name];
  if (!d) return "";
  const paths = d.split("|").map((p) => `<path d="${p}"/>`).join("");
  return `<svg class="ic" width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const kbd = (k) =>
  k
    ? `<span class="kbd">${k
        .split("+")
        .map((p) => `<kbd>${esc(p)}</kbd>`)
        .join("")}</span>`
    : "";

/* ---------------------------------------------------------------- state */

const S = {
  scenario: "grid",
  segments: JSON.parse(JSON.stringify(SEGMENTS)),
  issues: JSON.parse(JSON.stringify(ISSUES)),
  active: 10,
  editing: true,
  openDocs: ["doc-onboarding", "doc-release"],
  activeDoc: "doc-onboarding",
  dock: "memory",
  filters: [],
  query: "",
  find: { open: false, mode: "find", q: "", r: "", incl: false },
  palette: { open: false, q: "", sel: 0 },
  dialog: null,
  menu: null,
  rowMenu: null,
  banner: null,
  unacked: false,
  preview: { open: true, mode: "proofread" },
  leftCollapsed: false,
  rightCollapsed: false,
  ai: { configured: true },
  agent: null,
  engine: "ready",
  status: "已加载「onboarding-guide.docx」：26 个句段",
  caret: { line: 1, col: 12 },
  fileQuery: "",
  treeOpen: ["workspace", "source", "guides", "api", "reference", "screenshots", "memories", "termbases"],
  concord: CONCORDANCE.query,
  tmPage: 1,
  removeArmed: null,
  settingsTab: "info",
  cascade: false,
};

const FILTER_DEFS = [
  { id: "untranslated", label: "未译" },
  { id: "draft", label: "草稿" },
  { id: "confirmed", label: "已确认" },
  { id: "qa", label: "QA" },
  { id: "locked", label: "锁定" },
  { id: "term", label: "有术语" },
  { id: "tag", label: "有标签" },
];

const TERM_SEGMENTS = [10, 12, 14, 18];

function seg(n) {
  return S.segments.find((x) => x.n === n) || null;
}
function openIssues(n) {
  return S.issues.filter((i) => i.seg === n && i.status === "open");
}
function counts() {
  const c = { total: S.segments.length, confirmed: 0, draft: 0, untranslated: 0 };
  S.segments.forEach((s) => (c[s.state] += 1));
  c.open = S.issues.filter((i) => i.status === "open").length;
  return c;
}
function hasTag(s) {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(s.src) || TOKEN_RE.test(s.tgt);
}
function visibleSegments() {
  const q = S.query.trim().toLowerCase();
  return S.segments.filter((s) => {
    for (const f of S.filters) {
      if (f === "qa" && openIssues(s.n).length === 0) return false;
      if (f === "locked" && !s.locked) return false;
      if (f === "term" && !TERM_SEGMENTS.includes(s.n)) return false;
      if (f === "tag" && !hasTag(s)) return false;
      if (["untranslated", "draft", "confirmed"].includes(f) && s.state !== f) return false;
    }
    if (q && !(s.src + "\n" + s.tgt).toLowerCase().includes(q)) return false;
    return true;
  });
}
function findMatches() {
  const q = S.find.q.trim().toLowerCase();
  if (!q) return [];
  return visibleSegments().filter((s) => (s.src + "\n" + s.tgt).toLowerCase().includes(q));
}

/* ------------------------------------------------------------ scenarios */

function applyScenario(id) {
  S.scenario = id;
  S.segments = JSON.parse(JSON.stringify(SEGMENTS));
  S.issues = JSON.parse(JSON.stringify(ISSUES));
  S.banner = null;
  S.dialog = null;
  S.menu = null;
  S.rowMenu = null;
  S.palette.open = false;
  S.find.open = false;
  S.unacked = false;
  S.agent = null;
  S.ai.configured = true;
  S.engine = "ready";
  S.filters = [];
  S.query = "";
  S.editing = true;
  S.dock = "memory";
  S.preview.open = true;
  S.preview.mode = "proofread";
  S.active = 10;

  if (id === "projects") {
    S.status = "Translunar CAT 就绪";
  } else if (id === "grid") {
    S.status = "已加载「onboarding-guide.docx」：26 个句段";
  } else if (id === "confirmed") {
    const s = seg(10);
    s.state = "confirmed";
    s.origin = { kind: "tmExact", score: 100 };
    S.active = 12;
    S.dock = "memory";
    S.status = "句段 #10 已确认并写入 TM，TM 传播 2 个重复句段";
  } else if (id === "locked") {
    S.active = 11;
    S.editing = false;
    S.status = "句段 #11 已锁定";
  } else if (id === "qa") {
    S.active = 9;
    S.dock = "qa";
    S.filters = ["qa"];
    S.status = `QA 完成：检查 ${S.segments.length} 个句段，${counts().open} 个未解决问题`;
  } else if (id === "ai") {
    S.ai.configured = false;
    S.dock = "ai";
    S.active = 23;
    S.status = "未配置 AI 供应商";
  } else if (id === "agent") {
    S.dock = "ai";
    S.agent = "awaitingReview";
    S.active = 23;
    S.status = `Agent 已完成：TM 5，AI 草稿 6，失败 1，QA 未解决 ${counts().open}`;
  } else if (id === "gate") {
    S.banner = "gate";
    S.dock = "qa";
    S.active = 15;
    S.status = "导出被质量门拦截";
  }
  render();
}

/* ----------------------------------------------------------- dispatcher */

function status(msg) {
  S.status = msg;
}

function dispatch(cmd, arg) {
  S.menu = null;
  S.rowMenu = null;
  const a = seg(S.active);
  switch (cmd) {
    case "new-project":
      S.dialog = "newproject";
      break;
    case "import-document":
      S.dialog = "import";
      break;
    case "export-document":
      if (S.issues.filter((i) => i.status === "open" && i.severity === "error").length > 0) {
        S.banner = "gate";
        status("导出被质量门拦截");
      } else {
        S.banner = "overwrite";
        status("目标已存在，等待覆盖决定");
      }
      break;
    case "open-project-settings":
      S.dialog = "settings";
      break;
    case "open-tm-manage":
      S.dialog = "tm";
      break;
    case "open-term-manage":
      S.dialog = "term";
      break;
    case "close-project":
      applyScenario("projects");
      return;
    case "archive-project":
      S.dialog = "settings";
      S.settingsTab = "lifecycle";
      break;
    case "open-command-palette":
      S.palette = { open: true, q: "", sel: 0 };
      break;
    case "toggle-preview":
      S.preview.open = !S.preview.open;
      status(S.preview.open ? "已展开预览面板" : "已折叠预览面板");
      break;
    case "toggle-left":
      S.leftCollapsed = !S.leftCollapsed;
      break;
    case "toggle-right":
      S.rightCollapsed = !S.rightCollapsed;
      break;
    case "show-dock-memory":
      S.dock = "memory";
      break;
    case "show-dock-term":
      S.dock = "term";
      break;
    case "show-dock-qa":
      S.dock = "qa";
      break;
    case "show-dock-ai":
      S.dock = "ai";
      break;
    case "open-find":
      S.find.open = true;
      S.find.mode = "find";
      break;
    case "open-replace":
      S.find.open = true;
      S.find.mode = "replace";
      break;
    case "find-next":
    case "find-prev": {
      const m = findMatches();
      if (!S.find.q.trim()) {
        S.find.open = true;
        S.find.mode = "find";
        break;
      }
      if (m.length === 0) {
        status(`查找「${S.find.q.trim()}」：没有匹配`);
        break;
      }
      const idx = m.findIndex((x) => x.n === S.active);
      const step = cmd === "find-next" ? 1 : -1;
      const nx = m[(idx + step + m.length * 2) % m.length];
      const wrapped = cmd === "find-next" ? idx >= m.length - 1 : idx <= 0;
      S.active = nx.n;
      status(
        wrapped
          ? `查找「${S.find.q.trim()}」：已从${cmd === "find-next" ? "头" : "末尾"}继续，跳到句段 #${nx.n}`
          : `查找「${S.find.q.trim()}」：句段 #${nx.n}`,
      );
      break;
    }
    case "replace-one":
      if (a && a.state === "confirmed" && !S.find.incl) {
        status(`句段 #${a.n} 已确认，未替换`);
      } else if (a && S.find.q.trim()) {
        const before = a.tgt;
        a.tgt = a.tgt.split(S.find.q).join(S.find.r);
        const n = before === a.tgt ? 0 : 1;
        status(n ? `句段 #${a.n} 已替换 1 处「${S.find.q}」` : `句段 #${a.n} 无匹配，已跳到下一处`);
      }
      break;
    case "replace-all": {
      let segs = 0;
      let occ = 0;
      let skippedConfirmed = 0;
      let skippedLocked = 0;
      S.segments.forEach((s) => {
        if (!s.tgt.includes(S.find.q) || !S.find.q.trim()) return;
        if (s.locked) return skippedLocked++;
        if (s.state === "confirmed" && !S.find.incl) return skippedConfirmed++;
        occ += s.tgt.split(S.find.q).length - 1;
        s.tgt = s.tgt.split(S.find.q).join(S.find.r);
        if (s.state === "confirmed") s.state = "draft";
        segs++;
      });
      status(
        segs
          ? `全部替换完成：${segs} 个句段、${occ} 处「${S.find.q}」→「${S.find.r}」${skippedConfirmed ? `；跳过 ${skippedConfirmed} 个已确认句段` : ""}${skippedLocked ? `；跳过 ${skippedLocked} 个已锁定句段` : ""}`
          : `全部替换：译文中没有「${S.find.q}」`,
      );
      break;
    }
    case "focus-filter":
      S.focusFilter = true;
      break;
    case "open-concordance":
      S.dock = "memory";
      S.concord = "memory";
      break;
    case "confirm-segment":
    case "confirm-segment-any":
    case "confirm-segment-stay": {
      if (!a) break;
      if (a.locked) {
        status(`句段 #${a.n} 已锁定，无法确认`);
        break;
      }
      if (!a.tgt.trim()) {
        status(`句段 #${a.n} 译文为空，无法确认`);
        break;
      }
      a.state = "confirmed";
      if (!a.origin) a.origin = { kind: "tmExact", score: 100 };
      const q = openIssues(a.n).length;
      status(
        `句段 #${a.n} 已确认并写入 TM，TM 传播 2 个重复句段${q ? `，QA ${q} 个问题` : ""}`,
      );
      if (cmd !== "confirm-segment-stay") {
        const vis = visibleSegments();
        const i = vis.findIndex((x) => x.n === a.n);
        for (let k = i + 1; k < vis.length; k++) {
          const c = vis[k];
          if (c.locked) continue;
          if (cmd === "confirm-segment-any" || c.state !== "confirmed") {
            S.active = c.n;
            break;
          }
        }
      }
      break;
    }
    case "toggle-lock-segment":
      if (!a) break;
      a.locked = !a.locked;
      if (a.locked) S.editing = false;
      status(`句段 #${a.n} 已${a.locked ? "锁定" : "解锁"}`);
      break;
    case "copy-source":
      if (!a || a.locked) break;
      a.tgt = a.src;
      if (a.state === "untranslated") a.state = "draft";
      status(`句段 #${a.n} 已复制源文为草稿`);
      break;
    case "clear-target":
      if (!a || a.locked) break;
      a.tgt = "";
      a.state = "untranslated";
      a.origin = undefined;
      status(`句段 #${a.n} 已清空译文`);
      break;
    case "pretranslate": {
      let filled = 0;
      S.segments.forEach((s) => {
        if (s.state === "untranslated" && !s.locked && s.n >= 23) {
          s.tgt =
            {
              23: "未经明确决定，导出不会覆盖已存在的文件。",
              24: "当项目开启“有错误时阻止导出”时，质量门会列出未通过的规则。",
              25: "Agent 负责起草与检查；审核与导出仍由人完成。",
              26: "这里不会报告引擎未确认的成功。",
            }[s.n] || s.tgt;
          s.state = "draft";
          s.origin = { kind: "tmFuzzy", score: 78 };
          filled++;
        }
      });
      status(
        `预翻译完成：检查 ${counts().untranslated + filled} 个未译句段，填充 ${filled} 个（精确 0 / 模糊 ${filled}），跳过 1 个已锁定句段`,
      );
      break;
    }
    case "insert-tm":
      if (!a || a.locked) break;
      a.tgt = TM_MATCHES[0].tgt;
      a.state = "draft";
      a.origin = { kind: "tmExact", score: 100 };
      S.dock = "memory";
      status("已应用第 1 条记忆匹配（100%）为草稿");
      break;
    case "insert-term":
      if (!a || a.locked) break;
      a.tgt = a.tgt + "记忆库";
      S.dock = "term";
      status("已在光标处插入术语「记忆库」");
      break;
    case "apply-tm":
      if (!a || a.locked) break;
      a.tgt = TM_MATCHES[arg].tgt;
      a.state = "draft";
      a.origin = {
        kind: TM_MATCHES[arg].grade === "fuzzy" ? "tmFuzzy" : "tmExact",
        score: TM_MATCHES[arg].score,
      };
      status(`已应用第 ${arg + 1} 条记忆匹配（${TM_MATCHES[arg].score}%）为草稿`);
      break;
    case "run-qa":
      S.dock = "qa";
      status(`QA 完成：检查 ${S.segments.length} 个句段，${counts().open} 个未解决问题`);
      break;
    case "waive": {
      const i = S.issues.find((x) => x.id === arg);
      if (i) i.status = "waived";
      status("已忽略 QA 问题");
      break;
    }
    case "waive-rule": {
      const i = S.issues.find((x) => x.id === arg);
      let n = 0;
      if (i)
        S.issues.forEach((x) => {
          if (x.rule === i.rule && x.status === "open") {
            x.status = "waived";
            n++;
          }
        });
      status(`已忽略 ${n} 个 QA 问题`);
      break;
    }
    case "waive-segment": {
      const i = S.issues.find((x) => x.id === arg);
      let n = 0;
      if (i)
        S.issues.forEach((x) => {
          if (x.seg === i.seg && x.status === "open") {
            x.status = "waived";
            n++;
          }
        });
      status(`已忽略 ${n} 个 QA 问题`);
      break;
    }
    case "restore": {
      const i = S.issues.find((x) => x.id === arg);
      if (i) i.status = "open";
      status("已恢复 QA 问题为未解决");
      break;
    }
    case "apply-fix": {
      const i = S.issues.find((x) => x.id === arg);
      if (i && i.fix) {
        const t = seg(i.seg);
        t.tgt = i.fix.text;
        if (t.state === "confirmed") t.state = "draft";
        i.status = "resolved";
        status(`句段 #${i.seg} 已应用修复`);
      }
      break;
    }
    case "jump":
      S.active = arg;
      if (!visibleSegments().some((s) => s.n === arg)) S.filters = [];
      break;
    case "ai-translate":
      S.dock = "ai";
      S.aiCandidate = true;
      status("AI 翻译完成（gpt-4o-mini，1,180ms）");
      break;
    case "ai-refine":
      S.dock = "ai";
      S.aiCandidate = true;
      status("AI 润色完成（gpt-4o-mini，940ms）");
      break;
    case "ai-configure":
      S.ai.configured = true;
      status("AI 供应商已配置：openai / gpt-4o-mini");
      break;
    case "agent-start":
      S.agent = "awaitingReview";
      status(`Agent 已完成：TM 5，AI 草稿 6，失败 1，QA 未解决 ${counts().open}`);
      break;
    case "agent-cancel":
      S.agent = null;
      status("Agent 运行已取消");
      break;
    case "gate-override":
      S.banner = "overwrite";
      status("已通过质量门，目标文件已存在");
      break;
    case "gate-cancel":
    case "overwrite-cancel":
      S.banner = null;
      status("已取消导出");
      break;
    case "overwrite-confirm":
      S.banner = null;
      status("导出完成（已覆盖）：/Users/lin/exports/onboarding-guide-translated.docx（22 个已译单元）");
      break;
    case "engine-relaunch":
      S.engine = "ready";
      status("引擎已恢复，已重新同步");
      break;
    case "undo":
    case "redo":
      status(cmd === "undo" ? "已撤销上一步编辑" : "已重做上一步编辑");
      break;
    case "toggle-gate":
      PROJECT.blockExportOnError = !PROJECT.blockExportOnError;
      status(PROJECT.blockExportOnError ? "已开启导出前 QA 检查" : "已关闭导出前 QA 检查");
      break;
    case "help-keys":
      S.palette = { open: true, q: "", sel: 0 };
      break;
    default:
      if (cmd && cmd.startsWith("open-doc-")) {
        S.activeDoc = cmd.replace("open-doc-", "doc-");
        if (!S.openDocs.includes(S.activeDoc)) S.openDocs.push(S.activeDoc);
        status(`已切换到「${DOCUMENTS.find((d) => d.id === S.activeDoc).name}」`);
      }
      break;
  }
  render();
}

/* -------------------------------------------------------------- markup */

function vTitlebar() {
  const doc = DOCUMENTS.find((d) => d.id === S.activeDoc);
  const title =
    S.scenario === "projects"
      ? "Translunar"
      : `${PROJECT.name} — ${doc.name}（${PROJECT.source} → ${PROJECT.target}）`;
  return `
  <div class="titlebar">
    <div class="titlebar__brand"><span class="mark"></span>Translunar</div>
    <nav class="menubar" role="menubar">
      ${MENUS.map(
        (m, i) => `<button class="menubar__item" role="menuitem" data-menu="${i}"
          ${S.menu === i ? 'data-open="1"' : ""}>${esc(m.label)}</button>`,
      ).join("")}
    </nav>
    <div class="titlebar__title">${esc(title)}</div>
    <div class="wincontrols">
      <button class="wincontrol" aria-label="最小化"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg></button>
      <button class="wincontrol" aria-label="最大化"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg></button>
      <button class="wincontrol wincontrol--close" aria-label="关闭"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg></button>
    </div>
  </div>
  ${S.menu !== null ? vMenuDrop(S.menu) : ""}`;
}

function vMenuDrop(i) {
  const m = MENUS[i];
  const disabled = S.scenario === "projects";
  return `<div class="menudrop" style="--menu-index:${i}" role="menu">
    ${m.items
      .map((it) => {
        if (it.sep) return `<div class="menudrop__sep"></div>`;
        const off =
          disabled && !["new-project", "help-keys", null].includes(it.cmd) && i !== 6 && i !== 0;
        return `<button class="menudrop__item" role="menuitem" ${off ? "disabled" : ""}
          data-cmd="${it.cmd || ""}">
          <span class="menudrop__check">${it.checked && PROJECT.blockExportOnError ? "✓" : ""}</span>
          <span class="menudrop__label">${esc(it.label)}</span>
          ${it.key ? `<span class="menudrop__key">${esc(it.key)}</span>` : ""}
        </button>`;
      })
      .join("")}
  </div>`;
}

function vRibbon() {
  const a = seg(S.active);
  return `<div class="ribbon" role="toolbar" aria-label="工具栏">
    <div class="ribbon__groups">
      ${RIBBON.map(
        (g) => `<div class="rgroup" data-group="${esc(g.group)}">
          <div class="rgroup__items">
          ${g.items
            .map((it) => {
              const label =
                it.id === "toggle-lock-segment" && a && a.locked ? "解锁" : it.label;
              const icon =
                it.id === "toggle-lock-segment" && a && a.locked ? "unlock" : it.icon;
              return `<button class="rbtn${it.primary ? " rbtn--primary" : ""}"
                data-cmd="${it.id}" title="${esc(it.title)}">
                ${ic(icon, 17)}<span>${esc(label)}</span></button>`;
            })
            .join("")}
          </div>
          <div class="rgroup__label">${esc(g.group)}</div>
        </div>`,
      ).join("")}
    </div>
    <div class="ribbon__tail">
      <button class="rbtn rbtn--quiet" data-cmd="open-command-palette" title="命令搜索（Ctrl+K）">
        ${ic("cmd", 15)}<span>命令搜索</span>${kbd("Ctrl+K")}
      </button>
      <label class="searchbox">
        ${ic("search", 14)}
        <input id="filterbox" type="search" placeholder="搜索句段" aria-label="按文本筛选" value="${esc(S.query)}">
      </label>
    </div>
  </div>`;
}

function treeMatches(node, query) {
  if (!query) return true;
  if (node.name.toLowerCase().includes(query)) return true;
  return (node.children || []).some((child) => treeMatches(child, query));
}

function vTreeNode(node, depth = 0) {
  const query = S.fileQuery.trim().toLowerCase();
  if (!treeMatches(node, query)) return "";
  const style = `style="--depth:${depth}"`;

  if (node.kind === "folder") {
    const open = query ? true : S.treeOpen.includes(node.id);
    const childCount = (node.children || []).length;
    return `<div class="treebranch" ${style}>
      <button class="treeitem treeitem--folder" data-tree="${node.id}" aria-expanded="${open}">
        <span class="treeitem__indent"></span>
        <span class="treeitem__chev">${ic(open ? "down" : "right", 12)}</span>
        <span class="treeitem__ico">${ic("folder", 14)}</span>
        <span class="treeitem__name">${esc(node.name)}</span>
        <span class="treeitem__count num">${childCount}</span>
      </button>
      ${open ? `<div class="treechildren">${(node.children || []).map((child) => vTreeNode(child, depth + 1)).join("")}</div>` : ""}
    </div>`;
  }

  const doc = node.doc ? DOCUMENTS.find((d) => d.id === node.doc) : null;
  const active = doc && doc.id === S.activeDoc;
  const armed = doc && S.removeArmed === doc.id;
  const pct = doc ? Math.round((doc.confirmed / doc.total) * 100) : null;
  const ext = node.name.split(".").pop().toLowerCase();
  const detail = doc
    ? `${doc.format} · 确认 ${doc.confirmed}/${doc.total}${doc.draft ? ` · 草稿 ${doc.draft}` : ""}${doc.open ? ` · QA ${doc.open}` : ""}`
    : node.meta || "";
  return `<div class="treeleaf"${active ? ' data-active="1"' : ""} ${style}>
    <button class="treeitem treeitem--file" ${doc ? `data-cmd="open-doc-${doc.id.replace("doc-", "")}"` : ""} title="${esc(detail)}">
      <span class="treeitem__indent"></span>
      <span class="treeitem__chev"></span>
      <span class="treeitem__ico" data-ext="${esc(ext)}">${ic("file", 14)}</span>
      <span class="treeitem__name">${esc(node.name)}</span>
      ${doc ? `<span class="treeitem__pct num">${pct}%</span>` : ""}
    </button>
    ${
      active
        ? `<div class="treeleaf__detail">
          <span>${esc(detail)}</span>
          <span class="treeleaf__bar"><span class="meter"><span class="meter__confirmed" style="width:${pct}%"></span></span><span class="num">${pct}%</span></span>
        </div>`
        : node.meta
          ? `<div class="treeleaf__asset">${esc(node.meta)}</div>`
          : ""
    }
    ${
      doc
        ? armed
          ? `<span class="treeleaf__confirm"><button class="btn btn--danger btn--xs" data-act="remove-yes">确认移除</button><button class="btn btn--ghost btn--xs" data-act="remove-no">取消</button></span>`
          : `<button class="treeleaf__remove iconbtn" data-act="remove-arm" data-doc="${doc.id}" title="移除文档">${ic("trash", 12)}</button>`
        : ""
    }
  </div>`;
}

function vLeft() {
  const totals = DOCUMENTS.reduce(
    (t, d) => ({ total: t.total + d.total, confirmed: t.confirmed + d.confirmed }),
    { total: 0, confirmed: 0 },
  );
  const ppct = Math.round((totals.confirmed / totals.total) * 100);
  return `<aside class="rail rail--left"${S.leftCollapsed ? ' data-collapsed="1"' : ""}>
    <section class="railsec">
      <header class="railsec__head">
        <h2>项目</h2>
        <button class="iconbtn" data-cmd="open-project-settings" title="项目设置">${ic("settings", 15)}</button>
      </header>
      <p class="proj__name">${esc(PROJECT.name)}</p>
      <p class="proj__pair">语言对 <span class="num">${PROJECT.source} → ${PROJECT.target}</span></p>
      <div class="proj__progress">
        <div class="meter" role="img" aria-label="已确认 ${totals.confirmed}/${totals.total}">
          <span class="meter__confirmed" style="width:${ppct}%"></span>
          <span class="meter__draft" style="width:12%"></span>
        </div>
        <span class="num">${ppct}%</span>
      </div>
    </section>

    <section class="railsec railsec--files">
      <header class="railsec__head">
        <h2>文件</h2>
        <button class="iconbtn" data-cmd="import-document" title="导入文档（Ctrl+O）">${ic("plus", 15)}</button>
      </header>
      <label class="railsearch">${ic("search", 13)}
        <input id="filesearch" type="search" placeholder="搜索文件" aria-label="搜索文件" value="${esc(S.fileQuery)}">
      </label>
      ${
        !treeMatches(WORKSPACE_TREE[0], S.fileQuery.trim().toLowerCase())
          ? `<p class="empty">无匹配文件</p>`
          : `<div class="filetree" role="tree" aria-label="项目文件">${vTreeNode(WORKSPACE_TREE[0])}</div>`
      }
    </section>

    <section class="railsec railsec--details">
      <header class="railsec__head"><h2>项目详情</h2></header>
      <dl class="details">
        <div><dt>名称</dt><dd>${esc(PROJECT.name)}</dd></div>
        <div><dt>源语言</dt><dd class="num">${PROJECT.source}</dd></div>
        <div><dt>目标语言</dt><dd class="num">${PROJECT.target}</dd></div>
        <div><dt>创建时间</dt><dd class="num">${PROJECT.created}</dd></div>
        <div><dt>文件数</dt><dd class="num">${DOCUMENTS.length}</dd></div>
        <div><dt>总句段</dt><dd class="num">${totals.total}</dd></div>
        <div><dt>已确认句段</dt><dd class="num">${totals.confirmed}（${ppct}%）</dd></div>
        <div><dt>分段默认</dt><dd>句子（内置 SRX）</dd></div>
      </dl>
    </section>
  </aside>`;
}

function vDocTabs() {
  return `<div class="doctabs" role="tablist">
    ${S.openDocs
      .map((id) => {
        const d = DOCUMENTS.find((x) => x.id === id);
        return `<div class="doctab"${id === S.activeDoc ? ' data-active="1"' : ""}>
        <button role="tab" data-cmd="open-doc-${id.replace("doc-", "")}">${esc(d.name)}</button>
        <button class="doctab__x" data-act="close-tab" data-doc="${id}" aria-label="关闭标签页 ${esc(d.name)}">${ic("x", 12)}</button>
      </div>`;
      })
      .join("")}
    <button class="doctab__add" data-cmd="import-document" aria-label="导入文档">${ic("plus", 13)}</button>
  </div>`;
}

function vBanners() {
  let out = "";
  if (S.banner === "gate") {
    const errs = S.issues.filter((i) => i.status === "open" && i.severity === "error");
    out += `<div class="banner" data-tone="danger" role="alertdialog">
      <span class="banner__icon">⛔</span>
      <span class="banner__text"><b>存在 QA 错误，仍要导出吗？</b>
        <span class="banner__sub"><span class="num">${errs.length}</span> 个错误未解决：${errs.map((e) => `<code>${e.rule}</code>`).join("、")}</span></span>
      <span class="banner__acts">
        <button class="btn btn--danger btn--sm" data-cmd="gate-override">仍要导出</button>
        <button class="btn btn--ghost btn--sm" data-cmd="gate-cancel">取消</button>
      </span></div>`;
  }
  if (S.banner === "overwrite") {
    out += `<div class="banner" data-tone="warn" role="alertdialog">
      <span class="banner__icon">⚠</span>
      <span class="banner__text"><b>目标已存在，要覆盖吗？</b>
        <span class="banner__sub"><code>/Users/lin/exports/onboarding-guide-translated.docx</code></span></span>
      <span class="banner__acts">
        <button class="btn btn--danger btn--sm" data-cmd="overwrite-confirm">覆盖</button>
        <button class="btn btn--ghost btn--sm" data-cmd="overwrite-cancel">取消</button>
      </span></div>`;
  }
  if (S.unacked) {
    out += `<div class="banner" data-tone="danger" role="alert">
      <span class="banner__icon">⛔</span>
      <span class="banner__text"><b>句段 #10 的草稿未被引擎确认写入</b>
        <span class="banner__sub">engine unavailable: broken pipe</span></span>
      <span class="banner__acts"><button class="btn btn--ghost btn--sm" data-act="dismiss-unacked">关闭</button></span></div>`;
  }
  return out;
}

function vGridbar() {
  const vis = visibleSegments();
  return `<div class="gridbar">
    <span class="gridbar__label">${ic("filter", 14)}筛选</span>
    <div class="chips">
      ${FILTER_DEFS.map((f) => {
        const on = S.filters.includes(f.id);
        return `<button class="chip${on ? " chip--on" : ""}" data-filter="${f.id}">
          ${esc(f.label)}${on ? `<span class="chip__x">${ic("x", 11)}</span>` : ""}</button>`;
      }).join("")}
      ${
        S.query.trim()
          ? `<button class="chip chip--on chip--text" data-act="clear-query">“${esc(S.query.trim())}”<span class="chip__x">${ic("x", 11)}</span></button>`
          : ""
      }
    </div>
    <span class="gridbar__spacer"></span>
    ${S.filters.length || S.query.trim() ? `<button class="btn btn--ghost btn--xs" data-act="clear-filters">清除全部<span class="kbdi">Esc</span></button>` : ""}
    <span class="gridbar__count num">${vis.length}/${S.segments.length}</span>
  </div>`;
}

function vFind() {
  if (!S.find.open) return "";
  const m = findMatches();
  const idx = m.findIndex((x) => x.n === S.active);
  return `<div class="findwidget" role="dialog" aria-label="${S.find.mode === "replace" ? "查找替换" : "查找"}">
    <button class="findwidget__toggle" data-act="find-mode" aria-expanded="${S.find.mode === "replace"}">
      ${ic(S.find.mode === "replace" ? "down" : "right", 13)}</button>
    <div class="findwidget__rows">
      <div class="findwidget__row">
        <input id="findq" class="findwidget__input" placeholder="查找" aria-label="查找" value="${esc(S.find.q)}">
        <span class="findwidget__count num">${S.find.q.trim() ? `${idx >= 0 ? idx + 1 : 0}/${m.length} 段` : ""}</span>
        <button class="iconbtn" data-cmd="find-prev" title="查找上一个（Shift+F4）">${ic("up", 13)}</button>
        <button class="iconbtn" data-cmd="find-next" title="查找下一个（F4）">${ic("down", 13)}</button>
        <button class="iconbtn" data-act="find-close" title="关闭（Esc）">${ic("x", 13)}</button>
      </div>
      ${
        S.find.mode === "replace"
          ? `<div class="findwidget__row">
        <input id="findr" class="findwidget__input" placeholder="替换为" aria-label="替换为" value="${esc(S.find.r)}">
        <button class="btn btn--sm btn--outline" data-cmd="replace-one">替换</button>
        <button class="btn btn--sm btn--outline" data-cmd="replace-all">全部替换</button>
        <label class="check"><input type="checkbox" data-act="incl" ${S.find.incl ? "checked" : ""}>含已确认</label>
      </div>`
          : ""
      }
    </div>
  </div>`;
}

const STATE_GLYPH = { untranslated: "○", draft: "✎", confirmed: "✓" };
const STATE_LABEL = { untranslated: "未译", draft: "草稿", confirmed: "已确认" };

function vOrigin(s) {
  if (!s.origin) return "";
  const o = s.origin;
  const isTm = o.kind === "tmExact" || o.kind === "tmFuzzy";
  const label = isTm ? "TM" : "AI";
  const title = [
    `状态：${STATE_LABEL[s.state]}`,
    `来源：${o.kind === "tmExact" ? "TM 精确" : o.kind === "tmFuzzy" ? "TM 模糊" : "AI"}`,
    o.score !== undefined ? `分值：${o.score}` : null,
    o.model ? `模型：${o.model}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `<span class="origin" data-grade="${isTm ? (o.kind === "tmFuzzy" ? "fuzzy" : "exact") : "ai"}"${o.edited ? ' data-muted="1"' : ""} title="${esc(title)}">
    ${o.score !== undefined ? `<span class="num">${o.score}</span>` : ""}<span class="origin__k">${label}</span></span>`;
}

function vGrid() {
  const vis = visibleSegments();
  if (vis.length === 0)
    return `<div class="grid"><p class="empty empty--big">没有符合筛选条件的句段</p></div>`;
  const danger = {};
  S.issues.forEach((i) => {
    if (i.status !== "open") return;
    if (i.rule.startsWith("qa.tag-placeholder")) {
      danger[i.seg] = (i.evidence.source || []).concat(i.evidence.target || []);
    }
  });
  return `<div class="grid" id="grid">
    <table>
      <thead><tr>
        <th class="c-n">#</th>
        <th class="c-src">源文<span class="loc">${PROJECT.source}</span></th>
        <th class="c-tgt">译文<span class="loc">${PROJECT.target}</span></th>
        <th class="c-st">状态</th>
      </tr></thead>
      <tbody>
      ${vis
        .map((s) => {
          const act = s.n === S.active;
          const iss = openIssues(s.n);
          const editing = act && S.editing && !s.locked;
          return `<tr data-row="${s.n}" data-state="${s.state}"${act ? ' data-active="1"' : ""}${
            editing ? ' data-editing="1"' : ""
          }${iss.length ? ' data-qa="1"' : ""}${s.locked ? ' data-locked="1"' : ""}>
        <td class="c-n"><span class="rowbar"></span><span class="num">${s.n}</span></td>
        <td class="c-src">${tokens(s.src, danger[s.n])}</td>
        <td class="c-tgt">${
          editing
            ? `<div class="editor"><textarea id="editor" aria-label="句段 ${s.n} 译文" rows="1">${esc(s.tgt)}</textarea></div>`
            : `<span class="tgt">${tokens(s.tgt, danger[s.n]) || '<span class="tgt--empty">—</span>'}</span>`
        }</td>
        <td class="c-st">
          <span class="statecell">
            ${s.locked ? `<span class="lockglyph" title="已锁定">${ic("lock", 12)}</span>` : ""}
            <span class="statechip" data-state="${s.state}" title="${STATE_LABEL[s.state]}${iss.length ? `，${iss.length} 个未解决 QA 问题` : ""}">
              <span class="statechip__g">${STATE_GLYPH[s.state]}</span>
              <span class="statechip__t">${STATE_LABEL[s.state]}</span>
              ${iss.length ? `<span class="statechip__qa">⚠${iss.length}</span>` : ""}
            </span>
            ${vOrigin(s)}
            <span class="rowmenu-wrap">
              <button class="iconbtn rowmenu__btn" data-act="rowmenu" data-row="${s.n}" aria-label="句段 ${s.n} 菜单">${ic("dots", 14)}</button>
              ${
                S.rowMenu === s.n
                  ? `<div class="rowmenu" role="menu">
                  <button role="menuitem" data-cmd="copy-source" ${s.locked ? "disabled" : ""}>复制源文</button>
                  <button role="menuitem" data-cmd="clear-target" ${s.locked || !s.tgt ? "disabled" : ""}>清空译文</button>
                  <button role="menuitem" data-cmd="toggle-lock-segment">${s.locked ? "解锁" : "锁定"}<span class="rowmenu__k">Ctrl+L</span></button>
                  <div class="rowmenu__sep"></div>
                  <button role="menuitem" data-cmd="confirm-segment" ${s.locked ? "disabled" : ""}>确认句段<span class="rowmenu__k">Ctrl+Enter</span></button>
                </div>`
                  : ""
              }
            </span>
          </span>
        </td>
      </tr>`;
        })
        .join("")}
      </tbody>
    </table>
  </div>`;
}

function vPreview() {
  const c = counts();
  const open = S.preview.open;
  return `<section class="preview"${open ? ' data-open="1"' : ""}>
    <header class="preview__bar">
      <span class="preview__title">预览</span>
      ${
        open
          ? `<div class="tabs tabs--sm" role="tablist">
        <button role="tab" data-act="pv-proofread"${S.preview.mode === "proofread" ? ' data-active="1"' : ""}>校对视图</button>
        <button role="tab" data-act="pv-layout"${S.preview.mode === "layout" ? ' data-active="1"' : ""}>版式视图（DOCX）</button>
      </div>`
          : ""
      }
      <span class="preview__spacer"></span>
      ${
        open && S.preview.mode === "proofread"
          ? `<span class="legend"><span class="lg" data-state="confirmed">已确认</span><span class="lg" data-state="draft">草稿</span><span class="lg" data-state="untranslated">未译</span></span>`
          : ""
      }
      <button class="iconbtn" data-cmd="toggle-preview" title="${open ? "折叠预览（Ctrl+P）" : "展开预览（Ctrl+P）"}">${ic(open ? "down" : "up", 14)}</button>
    </header>
    ${
      open
        ? `<div class="preview__body">
      ${
        S.preview.mode === "proofread"
          ? `<p class="preview__summary">共 <span class="num">${c.total}</span> 个句段：<span class="num">${c.total - c.untranslated}</span> 个已有译文，<span class="num">${c.untranslated}</span> 个未译</p>
        <div class="preview__doc">
          ${[[1], [2, 3, 4], [5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [16, 17, 18, 19], [20, 21, 22], [23, 24, 25, 26]]
            .map(
              (blk) =>
                `<p class="preview__block">${blk
                  .map((n) => {
                    const s = seg(n);
                    const fb = s.state === "untranslated";
                    return `<button class="pvseg" data-state="${s.state}"${fb ? ' data-fallback="1"' : ""}${
                      n === S.active ? ' data-active="1"' : ""
                    } data-jump="${n}" title="句段 #${n}${fb ? "（未译）" : ""}">${esc(fb ? s.src : s.tgt)}</button>`;
                  })
                  .join("")}</p>`,
            )
            .join("")}
        </div>`
          : `<p class="preview__summary">已回填 <span class="num">22</span> 个已译单元 · 由 <code>document.export</code> 真实导出管线生成</p>
        <div class="preview__page">
          <h3>Translunar 工作台</h3>
          <p>本指南带新译员走完第一个文档的完整流程：从导入到导出。开始之前，请确认桌面引擎正在运行。</p>
          <p>导入源文件会按句生成句段。选择 {mode} 可改为按段落分段。</p>
          <p>确认会把句对写入可写记忆库，并传播到重复句段。</p>
        </div>`
      }
    </div>`
        : ""
    }
  </section>`;
}

/* ------------------------------------------------------------- 4 docks */

function vDockTabs() {
  const c = counts();
  const t = [
    ["memory", "记忆", "memory", `${TM_MATCHES[0].score}%`, "ok"],
    ["term", "术语", "term", "3", "neutral"],
    ["qa", "QA", "qa", c.open ? String(c.open) : "", "danger"],
    ["ai", "AI", "ai", S.ai.configured ? "" : "未配置", "warn"],
  ];
  return `<nav class="docktabs" role="tablist">
    ${t
      .map(
        ([id, label, icon, chip, tone], i) =>
          `<button role="tab" data-dock="${id}"${S.dock === id ? ' data-active="1"' : ""} title="${label}面板（Ctrl+${i + 1}）">
        ${ic(icon, 14)}<span>${label}</span>${chip ? `<span class="dchip" data-tone="${tone}">${chip}</span>` : ""}
      </button>`,
      )
      .join("")}
  </nav>`;
}

function vMemoryDock() {
  const a = seg(S.active);
  const q = S.concord.trim();
  const hits = q
    ? CONCORDANCE.hits.filter((h) => h.text.toLowerCase().includes(q.toLowerCase()))
    : [];
  return `
  <section class="panel">
    <header class="panel__head"><h3>翻译记忆</h3>
      <span class="panel__act">${a ? `<span class="score" data-grade="exact"><span class="num">${TM_MATCHES[0].score}</span>%</span>` : ""}</span>
    </header>
    <div class="panel__body">
      ${
        !a
          ? `<p class="empty">未选中句段</p>`
          : TM_MATCHES.map(
              (m, i) => `<article class="card card--match"${i === 0 ? ' data-best="1"' : ""}>
        <div class="card__row">
          <span class="card__lead">
            <span class="score" data-grade="${m.grade}"><span class="num">${m.score}</span>%</span>
            <span class="gradelabel">${m.grade === "exact" ? "精确" : "模糊"}</span>
            <span class="memname" title="来源记忆库">${esc(m.memory)}</span>
          </span>
          <span class="card__acts">
            <span class="kbdi">Ctrl+${i + 1}</span>
            <button class="btn btn--outline btn--xs" data-cmd="apply-tm" data-arg="${i}">应用为草稿</button>
          </span>
        </div>
        <p class="card__text">${esc(m.tgt)}</p>
        <p class="card__sub">源：${esc(m.src)}</p>
      </article>`,
            ).join("")
      }
    </div>
  </section>
  <section class="panel">
    <header class="panel__head"><h3>检索</h3>
      <span class="panel__act">${q ? `<span class="pill"><span class="num">${hits.length}</span> 命中</span>` : ""}</span>
    </header>
    <div class="panel__body">
      <label class="field"><span>检索词<span class="kbdi">F3</span></span>
        <input id="concord" value="${esc(S.concord)}" placeholder="输入检索词"></label>
      ${
        !q
          ? `<p class="empty">输入检索词</p>`
          : hits.length === 0
            ? `<p class="empty">文档内无命中</p>`
            : hits
                .map(
                  (h) => `<article class="card">
        <div class="card__row">
          <span class="card__lead"><span class="pill pill--quiet">${h.field === "source" ? "源文" : "译文"}</span><span class="num">#${h.n}</span></span>
          <button class="btn btn--ghost btn--xs" data-jump="${h.n}">定位句段</button>
        </div>
        <p class="card__text">${esc(h.text).replace(new RegExp(q, "ig"), (m) => `<mark>${m}</mark>`)}</p>
      </article>`,
                )
                .join("")
      }
      ${
        q
          ? `<div class="subhead">项目 TM（模糊检索）<span class="pill"><span class="num">${CONCORDANCE.tm.length}</span> 条</span></div>
      ${CONCORDANCE.tm
        .map(
          (m) => `<article class="card">
        <div class="card__row"><span class="score" data-grade="${m.score >= 90 ? "exact" : "fuzzy"}"><span class="num">${m.score}</span>%</span></div>
        <p class="card__text">${esc(m.src)}</p>
        <p class="card__sub">译：${esc(m.tgt)}</p>
      </article>`,
        )
        .join("")}`
          : ""
      }
    </div>
  </section>`;
}

function vTermDock() {
  const a = seg(S.active);
  const hits = a && TERM_SEGMENTS.includes(a.n) ? TERM_HITS : [];
  return `<section class="panel panel--fill">
    <header class="panel__head"><h3>术语</h3>
      <span class="panel__act"><span class="pill" data-tone="ok"><span class="num">2</span> 个术语库</span>
      <button class="btn btn--ghost btn--xs" data-cmd="open-term-manage">管理…</button></span>
    </header>
    <div class="panel__body">
      ${
        !a
          ? `<p class="empty">未选中句段</p>`
          : hits.length === 0
            ? `<p class="empty">当前句段无术语命中</p>`
            : hits
                .map(
                  (h) => `<article class="card">
        <div class="card__row"><span class="card__text card__text--term">${esc(h.src)}</span></div>
        ${h.translations
          .map(
            (t) => `<div class="card__row card__row--sub">
          <span class="termtgt">${esc(t.term)}
            ${t.tag === "preferred" ? `<span class="pill" data-tone="ok">首选</span>` : ""}
            ${t.tag === "forbidden" ? `<span class="pill" data-tone="danger">禁用</span>` : ""}</span>
          <button class="btn btn--outline btn--xs" data-cmd="insert-term" ${t.tag === "forbidden" ? "disabled" : ""}>插入</button>
        </div>`,
          )
          .join("")}
      </article>`,
                )
                .join("")
      }
      <div class="subhead">快速添加术语</div>
      <div class="formgrid">
        <label class="field"><span>源术语</span><input placeholder="memory"></label>
        <label class="field"><span>目标术语</span><input placeholder="记忆库"></label>
      </div>
      <div class="row-end"><button class="btn btn--outline btn--sm">添加术语</button></div>
      <p class="note">写入「Aster 产品术语」（唯一可写术语库）</p>
    </div>
  </section>`;
}

const SEV = { error: ["⛔", "错误"], warning: ["⚠", "警告"], info: ["ⓘ", "提示"] };
const STATUS_CN = { open: "未解决", waived: "已忽略", resolved: "已解决" };

function vIssue(i, ruleCount, segCount) {
  const ev = (i.evidence.source || []).length || (i.evidence.target || []).length;
  return `<article class="issue" data-status="${i.status}" data-severity="${i.severity}">
    <div class="issue__head">
      <span class="issue__lead">
        <span class="sev" data-severity="${i.severity}" title="${SEV[i.severity][1]}">${SEV[i.severity][0]}</span>
        <span class="pill" data-tone="${i.status === "open" ? "danger" : i.status === "waived" ? "warn" : "ok"}">${STATUS_CN[i.status]}</span>
        <code class="rule">${i.rule}</code>
      </span>
      <button class="btn btn--ghost btn--xs" data-jump="${i.seg}">句段 <span class="num">#${i.seg}</span></button>
    </div>
    <p class="issue__msg">${esc(i.message)}</p>
    ${ev ? `<p class="issue__ev">源 [<span class="num">${(i.evidence.source || []).map(esc).join(", ")}</span>] ≠ 译 [<span class="num">${(i.evidence.target || []).map(esc).join(", ")}</span>]</p>` : ""}
    ${
      i.fix && i.status === "open"
        ? `<div class="fix">
      <span class="fix__text">修复为：${esc(i.fix.text)}</span>
      <button class="btn btn--outline btn--xs" data-cmd="apply-fix" data-arg="${i.id}" title="${esc(i.fix.label)}">应用修复</button>
    </div>`
        : ""
    }
    ${i.note ? `<p class="issue__note">备注：${esc(i.note)}</p>` : ""}
    <div class="issue__acts">
      ${i.status === "open" ? `<button class="btn btn--outline btn--xs" data-cmd="waive" data-arg="${i.id}">忽略</button>` : ""}
      ${i.status === "open" && ruleCount > 1 ? `<button class="btn btn--outline btn--xs" data-cmd="waive-rule" data-arg="${i.id}" title="忽略同一规则的 ${ruleCount} 个问题">忽略同类 <span class="num">${ruleCount}</span></button>` : ""}
      ${i.status === "open" && segCount > 1 ? `<button class="btn btn--outline btn--xs" data-cmd="waive-segment" data-arg="${i.id}" title="忽略句段 #${i.seg} 的 ${segCount} 个问题">忽略本句 <span class="num">${segCount}</span></button>` : ""}
      ${i.status === "waived" ? `<button class="btn btn--outline btn--xs" data-cmd="restore" data-arg="${i.id}">恢复为未解决</button>` : ""}
    </div>
  </article>`;
}

function vQaDock() {
  const open = S.issues.filter((i) => i.status === "open");
  const groups = [];
  open.forEach((i) => {
    const g = groups.find((x) => x[0] === i.rule);
    if (g) g[1].push(i);
    else groups.push([i.rule, [i]]);
  });
  const rank = { error: 0, warning: 1, info: 2 };
  groups.sort((a, b) => rank[a[1][0].severity] - rank[b[1][0].severity]);
  const segCount = {};
  open.forEach((i) => (segCount[i.seg] = (segCount[i.seg] || 0) + 1));
  const waived = S.issues.filter((i) => i.status === "waived");
  const resolved = S.issues.filter((i) => i.status === "resolved");
  return `<section class="panel panel--fill">
    <header class="panel__head"><h3>质量检查<span class="hcount">未解决 <span class="num">${open.length}</span></span></h3>
      <span class="panel__act"><button class="btn btn--primary btn--xs" data-cmd="run-qa">运行 QA</button></span>
    </header>
    <div class="panel__body">
      ${
        S.issues.length === 0
          ? `<p class="empty">尚未运行检查</p>`
          : groups
              .map(
                ([rule, list]) => `<section class="issuegroup">
        <div class="issuegroup__head"><code class="rule">${rule}</code><span class="num">${list.length}</span></div>
        ${list.map((i) => vIssue(i, list.length, segCount[i.seg] || 1)).join("")}
      </section>`,
              )
              .join("") +
            (waived.length
              ? `<div class="subhead">已忽略 <span class="num">${waived.length}</span></div>` +
                waived.map((i) => vIssue(i, 0, 0)).join("")
              : "") +
            (resolved.length
              ? `<div class="subhead">已解决 <span class="num">${resolved.length}</span></div>` +
                resolved.map((i) => vIssue(i, 0, 0)).join("")
              : "")
      }
    </div>
  </section>`;
}

function vAiDock() {
  const a = seg(S.active);
  const conf = S.ai.configured;
  const agent = S.agent;
  return `<section class="panel">
    <header class="panel__head"><h3>AI 辅助</h3>
      <span class="panel__act">${
        conf
          ? `<span class="pill" data-tone="ok">openai · gpt-4o-mini</span>`
          : `<span class="pill" data-tone="warn">未配置</span>`
      }</span>
    </header>
    <div class="panel__body">
    ${
      conf
        ? `${
            !a
              ? `<p class="empty">未选中句段</p>`
              : a.state === "confirmed"
                ? `<p class="note">该句段已确认</p>`
                : `<div class="row">
          <button class="btn btn--primary btn--sm" data-cmd="ai-translate">AI 翻译</button>
          <button class="btn btn--outline btn--sm" data-cmd="ai-refine" ${a.tgt.trim() ? "" : "disabled"}>AI 润色</button>
        </div>`
          }
        ${
          S.aiCandidate && a && a.state !== "confirmed"
            ? `<article class="card card--cand">
          <div class="card__row">
            <span class="card__lead"><span class="pill pill--quiet">翻译候选</span><span class="pill" data-tone="ok">标签完整</span></span>
            <span class="card__acts"><span class="num">1,180ms</span></span>
          </div>
          <p class="card__text">确认会把句对写入可写记忆库，并将结果传播到全部重复句段。</p>
          <p class="diff"><span class="eq">确认会把句对写入可写记忆库，并</span><span class="del">传播到重复句段</span><span class="ins">将结果传播到全部重复句段</span><span class="eq">。</span></p>
          <div class="row">
            <button class="btn btn--primary btn--xs" data-act="ai-apply">应用为草稿</button>
            <button class="btn btn--ghost btn--xs" data-act="ai-reject">拒绝</button>
          </div>
        </article>`
            : ""
        }`
        : `<div class="formgrid formgrid--1">
        <label class="field"><span>供应商</span><select>${AI_PROVIDERS.map((p) => `<option>${p}</option>`).join("")}</select></label>
        <label class="field"><span>模型</span><input placeholder="gpt-4o-mini"></label>
        <label class="field"><span>Base URL</span><input placeholder="https://api.openai.com/v1"></label>
        <label class="field"><span>API Key</span><input type="password" placeholder="sk-…"></label>
      </div>
      <div class="row-end"><button class="btn btn--primary btn--sm" data-cmd="ai-configure">保存配置</button></div>`
    }
    </div>
  </section>

  <section class="panel">
    <header class="panel__head"><h3>Agent 模式</h3>
      <span class="panel__act">${
        agent ? `<span class="pill" data-tone="warn">等待人工审核</span>` : ""
      }</span>
    </header>
    <div class="panel__body">
      ${!conf ? `<p class="note note--warn">未配置 AI 供应商</p>` : ""}
      <label class="field"><span>任务指令（可选）</span><textarea rows="2" placeholder="保持术语一致，句末用中文标点"></textarea></label>
      <div class="row">
        <button class="btn btn--primary btn--sm" data-cmd="agent-start" ${!conf || agent ? "disabled" : ""}>创建任务单并运行</button>
        ${agent ? `<button class="btn btn--outline btn--sm" data-cmd="agent-cancel">取消运行</button>` : ""}
      </div>
      ${
        agent
          ? `<div class="agentsum">
        <span>计划 <b class="num">12</b></span><span>TM <b class="num">5</b></span>
        <span>AI 草稿 <b class="num">6</b></span><span>失败 <b class="num">1</b></span>
        <span>QA 未解决 <b class="num">${counts().open}</b></span>
      </div>
      <div class="gate">
        <button class="btn btn--primary btn--sm" data-act="agent-review">去工作台查看草稿</button>
        <button class="btn btn--outline btn--sm" data-cmd="export-document">去导出…</button>
      </div>
      <div class="subhead">运行步骤</div>
      ${AGENT_STEPS.map(
        (s) => `<div class="step" data-status="${s.status}">
        <div class="step__head"><span class="pill" data-tone="${s.status === "done" ? "ok" : s.status === "failed" ? "danger" : "neutral"}">${s.kind}</span>
          <span class="num">#${s.i}</span>${s.seg ? `<span class="step__seg num">句段 ${s.seg}…</span>` : ""}</div>
        <p class="step__detail">${esc(s.detail)}</p>
      </div>`,
      ).join("")}`
          : `<p class="empty">尚未运行</p>`
      }
    </div>
  </section>`;
}

function vRight() {
  return `<aside class="rail rail--right"${S.rightCollapsed ? ' data-collapsed="1"' : ""}>
    ${vDockTabs()}
    <div class="dockbody">
      ${
        S.dock === "memory"
          ? vMemoryDock()
          : S.dock === "term"
            ? vTermDock()
            : S.dock === "qa"
              ? vQaDock()
              : vAiDock()
      }
    </div>
  </aside>`;
}

/* ----------------------------------------------------------- status bar */

function vStatus() {
  const c = counts();
  const pct = Math.round((c.confirmed / c.total) * 100);
  const doc = DOCUMENTS.find((d) => d.id === S.activeDoc);
  const eng =
    S.engine === "ready"
      ? `engine 0.9.4 · pid 48213`
      : S.engine === "down"
        ? `engine: 已停止：spawn ENOENT`
        : `engine: 重启中 (2)`;
  const work = S.scenario !== "projects";
  return `<footer class="statusbar">
    <span class="statusbar__msg">${esc(S.status)}</span>
    <span class="statusbar__stats">
      ${
        work
          ? `<span class="stat" title="当前句段 / 总句段">句段 <span class="num">${S.active}/${c.total}</span></span>
      <span class="stat" title="已确认句段">已确认 <span class="num">${c.confirmed}</span></span>
      ${c.draft ? `<button class="stat stat--jump" data-act="jump-draft" title="筛选草稿句段">草稿 <span class="num">${c.draft}</span></button>` : ""}
      <span class="stat" title="未译句段">剩余 <span class="num">${c.untranslated}</span></span>
      <span class="stat" title="源文词数 · CJK 按字">字数 <span class="num">${doc.words.toLocaleString("en-US")}</span></span>
      ${c.open ? `<button class="stat stat--jump" data-tone="danger" data-act="jump-qa" title="筛选 QA 问题句段">QA <span class="num">${c.open}</span></button>` : ""}
      <span class="stat stat--meter"><span class="meter"><span class="meter__confirmed" style="width:${pct}%"></span><span class="meter__draft" style="width:${Math.round((c.draft / c.total) * 100)}%"></span></span><span class="num">${pct}%</span></span>
      <span class="stat" title="行:列">行列 <span class="num">${S.caret.line}:${S.caret.col}</span></span>
      <span class="stat" title="插入模式">INS</span>`
          : ""
      }
      <span class="stat stat--engine"><span class="dot" data-state="${S.engine === "ready" ? "ok" : S.engine === "down" ? "down" : "busy"}"></span>${esc(eng)}</span>
    </span>
  </footer>`;
}

/* ------------------------------------------------------------- overlays */

function vPalette() {
  if (!S.palette.open) return "";
  const q = S.palette.q.trim().toLowerCase();
  const items = PALETTE.filter((p) => p.label.toLowerCase().includes(q));
  let last = null;
  return `<div class="overlay overlay--palette" data-act="close-palette">
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="palette__inputwrap">${ic("search", 15)}
        <input id="paletteq" placeholder="输入命令名称、面板或文档" aria-label="搜索命令" value="${esc(S.palette.q)}">
        <span class="kbdi">Esc</span>
      </div>
      <div class="palette__list" role="listbox">
        ${
          items.length === 0
            ? `<p class="empty">没有匹配的命令</p>`
            : items
                .map((p, i) => {
                  const head = p.g !== last ? `<div class="palette__group">${p.g}</div>` : "";
                  last = p.g;
                  return `${head}<button class="palette__item" role="option" data-cmd="${p.cmd}"${
                    i === S.palette.sel ? ' data-sel="1"' : ""
                  }${p.disabled ? " disabled" : ""}>
          <span>${esc(p.label).replace(new RegExp(q ? q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "$^", "i"), (m) => `<mark>${m}</mark>`)}</span>
          ${kbd(p.key)}</button>`;
                })
                .join("")
        }
      </div>
      <div class="palette__foot"><span class="kbdi">↑↓</span> 移动 <span class="kbdi">Enter</span> 执行 <span class="kbdi">Esc</span> 关闭</div>
    </div>
  </div>`;
}

function dialog(title, body, foot, wide) {
  return `<div class="overlay" data-act="close-dialog">
    <div class="dialog${wide ? " dialog--wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="dialog__head"><h2>${esc(title)}</h2>
        <button class="iconbtn" data-act="close-dialog" aria-label="关闭">${ic("x", 15)}</button></header>
      <div class="dialog__body">${body}</div>
      <footer class="dialog__foot">${foot}</footer>
    </div></div>`;
}

function vDialogs() {
  if (!S.dialog) return "";
  if (S.dialog === "newproject")
    return dialog(
      "新建项目",
      `<div class="formgrid formgrid--1">
        <label class="field"><span>项目名称</span><input placeholder="Aster 4.3 文档本地化" autofocus></label>
        <div class="formgrid">
          <label class="field"><span>源语言</span><input value="en-US"></label>
          <label class="field"><span>目标语言</span><input value="zh-CN"></label>
        </div>
      </div>
      <p class="note">项目创建后即可导入文档；语言对在项目产生内容后不可再改。</p>`,
      `<button class="btn btn--ghost" data-act="close-dialog">取消</button>
       <button class="btn btn--primary" data-act="create-project">创建项目</button>`,
    );

  if (S.dialog === "import")
    return dialog(
      "导入文档",
      `<div class="filepick">
        <button class="btn btn--outline btn--sm">选择文件…</button>
        <span class="path">onboarding-guide.docx</span>
      </div>
      <label class="field"><span>分段方式</span>
        <select><option>句子（SRX 规则）</option><option>段落</option></select></label>
      <div class="filepick">
        <button class="btn btn--outline btn--sm">选择 SRX 规则…</button>
        <span class="path path--muted">内置规则（en-US）</span>
      </div>
      <p class="note">导入成功后，这里选择的分段方式会保存为项目默认。</p>`,
      `<button class="btn btn--ghost" data-act="close-dialog">取消</button>
       <button class="btn btn--primary" data-act="close-dialog">导入</button>`,
    );

  if (S.dialog === "settings") {
    const tabs = [
      ["info", "项目信息"],
      ["import", "导入默认"],
      ["qa", "质量检查"],
      ["lifecycle", "生命周期"],
      ["tm", "翻译记忆"],
      ["tb", "术语库"],
    ];
    const t = S.settingsTab;
    let body = "";
    if (t === "info")
      body = `<div class="formgrid formgrid--1">
        <label class="field"><span>项目名称</span><input value="${esc(PROJECT.name)}"></label>
        <div class="formgrid">
          <label class="field"><span>源语言</span><input value="${PROJECT.source}"></label>
          <label class="field"><span>目标语言</span><input value="${PROJECT.target}"></label>
        </div></div>
        <p class="note">项目已有文档与 TM 条目，引擎会拒绝更改语言对。</p>
        <div class="row-end"><button class="btn btn--primary btn--sm">保存项目信息</button></div>`;
    if (t === "import")
      body = `<label class="field"><span>默认分段方式</span>
        <select><option>句子（SRX 规则）</option><option>段落</option></select></label>
      <div class="filepick"><button class="btn btn--outline btn--sm">选择默认 SRX 规则…</button>
        <span class="path path--muted">内置规则（en-US）</span></div>
      <div class="row-end"><button class="btn btn--primary btn--sm">保存导入默认</button></div>`;
    if (t === "qa")
      body = `<label class="check check--row"><input type="checkbox" ${PROJECT.blockExportOnError ? "checked" : ""} data-cmd="toggle-gate">
        <span><b>有错误时阻止导出</b><span class="note">开启后，存在 error 级未解决问题时导出会被拦截，仍可在确认对话框里明确越过。</span></span></label>`;
    if (t === "lifecycle")
      body = `<div class="row"><span>当前状态</span><span class="pill" data-tone="ok">进行中</span>
        <button class="btn btn--outline btn--sm">归档项目</button></div>
        <p class="note">归档只影响项目列表的默认可见性，可随时恢复。</p>`;
    if (t === "tm")
      body = `<div class="row">
        <label class="field field--grow"><span>记忆库</span><select>${MEMORIES.map((m) => `<option>${m.name}${m.writable ? "（可写）" : ""}</option>`).join("")}</select></label>
        <button class="btn btn--outline btn--sm">导入外部 TM…</button>
        <button class="btn btn--outline btn--sm">导出 TM…</button></div>
        <p class="note">导入 TMX/CSV/TSV，导出 TMX。目标库始终显式选择，不会隐式落到工作记忆库。</p>
        <div class="row-end"><button class="btn btn--outline btn--sm" data-act="open-tm">打开记忆库管理…</button></div>`;
    if (t === "tb")
      body =
        TERMBASES.map(
          (b) => `<div class="row row--line">
        <span class="grow">${esc(b.name)}</span>
        ${b.mounted ? `<span class="pill" data-tone="ok">已挂载</span>` : ""}
        <span class="num">${b.entries} 条</span>
        ${
          b.mounted
            ? `<button class="btn btn--outline btn--xs" data-act="open-term">管理术语</button>
             <button class="btn btn--outline btn--xs">导入 CSV/TBX…</button>
             <button class="btn btn--outline btn--xs">导出…</button>
             <button class="btn btn--outline btn--xs">卸载</button>`
            : `<button class="btn btn--outline btn--xs">挂载</button>`
        }
      </div>`,
        ).join("") +
        `<div class="row"><label class="field field--grow"><span>新术语库名称</span><input placeholder="Aster UI 术语"></label>
        <button class="btn btn--outline btn--sm">新建并挂载</button></div>`;
    return dialog(
      `项目设置 — ${PROJECT.name}`,
      `<div class="dialog__split">
        <nav class="vtabs">${tabs
          .map(
            ([id, label]) =>
              `<button data-settab="${id}"${t === id ? ' data-active="1"' : ""}>${label}</button>`,
          )
          .join("")}</nav>
        <div class="vtabs__body">${body}</div>
      </div>`,
      `<button class="btn btn--ghost" data-act="close-dialog">关闭</button>`,
      true,
    );
  }

  if (S.dialog === "tm") {
    return dialog(
      `记忆库管理 — ${PROJECT.name}`,
      `<section class="dsec">
        <h3>挂载的记忆库</h3>
        ${MEMORIES.map(
          (m, i) => `<div class="row row--line">
          <span class="grow">${esc(m.name)}</span>
          <span class="pill" data-tone="${m.writable ? "ok" : "neutral"}">${m.writable ? "可写" : "只读"}</span>
          ${m.enabled ? "" : `<span class="pill" data-tone="warn">已停用</span>`}
          ${m.pair ? `<span class="pill" data-tone="warn">${esc(m.pair)}</span>` : ""}
          <span class="num">${m.entries.toLocaleString("en-US")} 条</span>
          <span class="rowacts">
            <button class="btn btn--ghost btn--xs" ${i === 0 ? "disabled" : ""}>上移</button>
            <button class="btn btn--ghost btn--xs" ${i === MEMORIES.length - 1 ? "disabled" : ""}>下移</button>
            <button class="btn btn--outline btn--xs">${m.enabled ? "停用" : "启用"}</button>
            ${m.writable ? "" : `<button class="btn btn--outline btn--xs">设为可写</button>`}
            <button class="btn btn--outline btn--xs">重命名</button>
            <button class="btn btn--outline btn--xs">卸载</button>
          </span>
        </div>`,
        ).join("")}
        <div class="row">
          <label class="field field--grow"><span>挂载已有记忆库</span><select><option>选择记忆库…</option><option>Helios 主 TM</option></select></label>
          <button class="btn btn--outline btn--sm">挂载</button>
          <button class="btn btn--outline btn--sm" data-act="tm-cascade">删除</button>
        </div>
        ${
          S.cascade
            ? `<div class="banner banner--inline" data-tone="danger">
          <span class="banner__text">memory "Helios 主 TM" still has 1,204 TM entries; pass deleteEntries to remove them</span>
          <span class="banner__acts"><button class="btn btn--danger btn--xs">连同条目删除</button>
          <button class="btn btn--ghost btn--xs" data-act="tm-cascade-cancel">取消</button></span></div>`
            : ""
        }
        <div class="row">
          <label class="field field--grow"><span>新建记忆库</span><input placeholder="Aster 4.3 TM"></label>
          <button class="btn btn--outline btn--sm">新建并挂载</button>
        </div>
      </section>
      <section class="dsec">
        <h3>条目</h3>
        <div class="row">
          <label class="field"><span>记忆库</span><select>${MEMORIES.map((m) => `<option>${m.name}</option>`).join("")}</select></label>
          <label class="field field--grow"><span>搜索源文或译文</span><input placeholder="memory"></label>
          <button class="btn btn--outline btn--sm">搜索</button>
        </div>
        <p class="note">记忆库「Aster 主记忆库 2026」共 <span class="num">8,412</span> 条</p>
        ${TM_ENTRIES.map(
          (e) => `<article class="card">
          <p class="card__sub">源：${esc(e.src)}</p>
          <p class="card__text">${esc(e.tgt)}</p>
          <div class="row-end"><button class="btn btn--outline btn--xs">编辑</button><button class="btn btn--outline btn--xs">删除</button></div>
        </article>`,
        ).join("")}
        <div class="pager">
          <button class="btn btn--ghost btn--xs" ${S.tmPage === 1 ? "disabled" : ""}>上一页</button>
          <span>第 <span class="num">${S.tmPage}</span> / <span class="num">169</span> 页</span>
          <button class="btn btn--ghost btn--xs">下一页</button>
        </div>
      </section>`,
      `<button class="btn btn--ghost" data-act="close-dialog">关闭</button>`,
      true,
    );
  }

  if (S.dialog === "term")
    return dialog(
      "术语库管理 — Aster 产品术语",
      `<div class="row"><span class="pill"><span class="num">512</span> 条术语</span>
        <span class="grow"></span>
        <button class="btn btn--outline btn--sm">导入 CSV/TBX…</button>
        <button class="btn btn--outline btn--sm">导出…</button></div>
      ${TERM_ENTRIES.map(
        (e) => `<article class="card">
        <div class="card__row"><span class="card__text card__text--term">${esc(e.src)}</span>
          <span class="card__acts"><button class="btn btn--outline btn--xs">编辑</button>
          <button class="btn btn--outline btn--xs">删除</button></span></div>
        ${e.translations
          .map(
            (t) => `<div class="card__row card__row--sub">
          <span class="termtgt">${esc(t.term)}
            ${t.tag === "preferred" ? `<span class="pill" data-tone="ok">首选</span>` : ""}
            ${t.tag === "forbidden" ? `<span class="pill" data-tone="danger">禁用</span>` : ""}</span>
          <span class="card__acts"><button class="btn btn--outline btn--xs">编辑</button>
          ${e.translations.length > 1 ? `<button class="btn btn--outline btn--xs">删除译文</button>` : ""}</span>
        </div>`,
          )
          .join("")}
      </article>`,
      ).join("")}`,
      `<button class="btn btn--ghost" data-act="close-dialog">关闭</button>`,
      true,
    );
  return "";
}

function vEngineGate() {
  if (S.engine === "ready") return "";
  const down = S.engine === "down";
  return `<div class="overlay overlay--gate">
    <div class="gatecard" role="alertdialog" aria-modal="true">
      <p class="gatecard__title"><span class="dot" data-state="${down ? "down" : "busy"}"></span>
        ${down ? "翻译引擎已停止" : "翻译引擎正在自动重启"}</p>
      <p class="gatecard__body">${down ? "编辑已锁定" : "第 2 次重试，编辑已锁定"}</p>
      <p class="gatecard__err">spawn tl-engine ENOENT</p>
      ${down ? `<button class="btn btn--primary" data-cmd="engine-relaunch">重新启动引擎</button>` : ""}
    </div></div>`;
}

function vProjects() {
  const empty = S.projectsEmpty !== false;
  return `<main class="projects">
    <form class="projects__toolbar" onsubmit="return false">
      <label class="field field--grow"><span>项目名称</span><input placeholder="新项目名称"></label>
      <label class="field"><span>源语言</span><input value="en-US"></label>
      <label class="field"><span>目标语言</span><input value="zh-CN"></label>
      <button class="btn btn--primary" data-act="seed-projects">创建项目</button>
    </form>
    <div class="projects__head">
      <h2>项目<span class="num">（${empty ? 0 : PROJECTS.filter((p) => !p.archived).length}）</span></h2>
      ${empty ? "" : `<label class="check"><input type="checkbox">显示已归档项目（1）</label>`}
    </div>
    ${
      empty
        ? `<div class="bigempty">
        <p class="bigempty__title">还没有项目</p>
        <p class="bigempty__sub">新建一个项目，然后导入第一个文档。</p>
      </div>`
        : `<div class="projlist">${PROJECTS.filter((p) => !p.archived)
            .map(
              (p) => `<button class="projlist__row" data-act="open-project">
        <span class="projlist__name">${esc(p.name)}</span>
        <span class="projlist__pair num">${esc(p.pair)}</span>
      </button>`,
            )
            .join("")}</div>`
    }
  </main>`;
}

/* ------------------------------------------------------------- assemble */

function view() {
  const work = S.scenario !== "projects";
  return `
  <div class="proto">
    <span class="proto__brand">saas-gpt-plus · <b>${THEME_NAME}</b></span>
    <span class="proto__label">场景</span>
    <div class="proto__scenes">
      ${SCENARIOS.map(
        (s) =>
          `<button class="scene${S.scenario === s.id ? " scene--on" : ""}" data-scene="${s.id}">${s.label}</button>`,
      ).join("")}
    </div>
  </div>
  <div class="app"${work ? "" : ' data-noproject="1"'}>
    ${vTitlebar()}
    ${work ? vRibbon() : ""}
    <div class="body">
      ${
        work
          ? `${vLeft()}
        <div class="splitter" data-act="toggle-left" title="折叠左栏"></div>
        <main class="center">
          ${vDocTabs()}
          ${vBanners()}
          ${vGridbar()}
          <div class="gridwrap">${vGrid()}${vFind()}</div>
          ${vPreview()}
        </main>
        <div class="splitter" data-act="toggle-right" title="折叠右栏"></div>
        ${vRight()}`
          : vProjects()
      }
    </div>
    ${vStatus()}
    ${vPalette()}
    ${vDialogs()}
    ${vEngineGate()}
  </div>`;
}

/* --------------------------------------------------------------- runtime */

let ROOT;
let refocus = null;

function render() {
  const el = document.activeElement;
  if (el && el.id) refocus = { id: el.id, pos: el.selectionStart };
  const prevGrid = document.getElementById("grid");
  const keepScroll = prevGrid ? prevGrid.scrollTop : 0;
  ROOT.innerHTML = view();

  /* Keep the caller's scroll position, then pull the active segment back
     into view — a jump from the palette, a QA finding or F4 is useless if
     the row it selected is off-screen. */
  const grid = document.getElementById("grid");
  const row = grid && grid.querySelector("tr[data-active]");
  if (grid) {
    grid.scrollTop = keepScroll;
    if (row) {
      const head = grid.querySelector("thead").offsetHeight;
      const top = row.offsetTop - head;
      const bottom = row.offsetTop + row.offsetHeight;
      if (top < grid.scrollTop || bottom > grid.scrollTop + grid.clientHeight) {
        grid.scrollTop = Math.max(0, top - grid.clientHeight / 3);
      }
    }
  }
  if (refocus) {
    const t = document.getElementById(refocus.id);
    if (t) {
      t.focus();
      if (refocus.pos != null && t.setSelectionRange)
        try {
          t.setSelectionRange(refocus.pos, refocus.pos);
        } catch (e) {}
    }
    refocus = null;
  }
  if (S.focusFilter) {
    S.focusFilter = false;
    const f = document.getElementById("filterbox");
    if (f) f.focus();
  }
  const ta = document.getElementById("editor");
  if (ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }
}

function onClick(e) {
  const t = e.target.closest("[data-scene],[data-cmd],[data-act],[data-filter],[data-dock],[data-jump],[data-menu],[data-settab],[data-tree],[data-row]");
  if (!t) {
    if (S.menu !== null || S.rowMenu !== null) {
      S.menu = null;
      S.rowMenu = null;
      render();
    }
    return;
  }
  if (t.disabled) return;

  if (t.dataset.scene) return applyScenario(t.dataset.scene);
  if (t.dataset.menu !== undefined && t.classList.contains("menubar__item")) {
    const i = Number(t.dataset.menu);
    S.menu = S.menu === i ? null : i;
    return render();
  }
  if (t.dataset.settab) {
    S.settingsTab = t.dataset.settab;
    return render();
  }
  if (t.dataset.tree) {
    const id = t.dataset.tree;
    S.treeOpen = S.treeOpen.includes(id) ? S.treeOpen.filter((x) => x !== id) : S.treeOpen.concat(id);
    return render();
  }
  if (t.dataset.dock) {
    S.dock = t.dataset.dock;
    return render();
  }
  if (t.dataset.filter) {
    const f = t.dataset.filter;
    S.filters = S.filters.includes(f) ? S.filters.filter((x) => x !== f) : S.filters.concat(f);
    return render();
  }
  if (t.dataset.jump) return dispatch("jump", Number(t.dataset.jump));

  const act = t.dataset.act;
  if (act) {
    switch (act) {
      case "close-dialog":
        if (e.target.closest(".dialog") && !t.dataset.act) return;
        S.dialog = null;
        S.cascade = false;
        break;
      case "close-palette":
        if (e.target !== t) return;
        S.palette.open = false;
        break;
      case "rowmenu": {
        const n = Number(t.dataset.row);
        S.rowMenu = S.rowMenu === n ? null : n;
        S.active = n;
        break;
      }
      case "find-mode":
        S.find.mode = S.find.mode === "replace" ? "find" : "replace";
        break;
      case "find-close":
        S.find.open = false;
        break;
      case "incl":
        S.find.incl = !S.find.incl;
        break;
      case "clear-filters":
        S.filters = [];
        S.query = "";
        status("已清除筛选");
        break;
      case "clear-query":
        S.query = "";
        break;
      case "jump-draft":
        S.filters = ["draft"];
        break;
      case "jump-qa":
        S.filters = ["qa"];
        break;
      case "pv-proofread":
        S.preview.mode = "proofread";
        break;
      case "pv-layout":
        S.preview.mode = "layout";
        break;
      case "toggle-left":
        S.leftCollapsed = !S.leftCollapsed;
        break;
      case "toggle-right":
        S.rightCollapsed = !S.rightCollapsed;
        break;
      case "close-tab":
        S.openDocs = S.openDocs.filter((d) => d !== t.dataset.doc);
        if (S.activeDoc === t.dataset.doc) S.activeDoc = S.openDocs[0] || "doc-onboarding";
        break;
      case "remove-arm":
        S.removeArmed = t.dataset.doc;
        break;
      case "remove-no":
        S.removeArmed = null;
        break;
      case "remove-yes":
        status("已移除「api-reference.md」：删除 118 个句段、4 条 QA 记录");
        S.removeArmed = null;
        break;
      case "dismiss-unacked":
        S.unacked = false;
        break;
      case "ai-apply":
        {
          const a = seg(S.active);
          if (a) {
            a.tgt = "确认会把句对写入可写记忆库，并将结果传播到全部重复句段。";
            a.state = "draft";
            a.origin = { kind: "aiDraft", model: "gpt-4o-mini" };
          }
          S.aiCandidate = false;
          status(`句段 #${S.active} 已应用 AI 候选为草稿`);
        }
        break;
      case "ai-reject":
        S.aiCandidate = false;
        break;
      case "agent-review":
        S.dock = "qa";
        status(`已跳转到工作台：${counts().open} 个 QA 问题待处理`);
        break;
      case "tm-cascade":
        S.cascade = true;
        break;
      case "tm-cascade-cancel":
        S.cascade = false;
        break;
      case "open-tm":
        S.dialog = "tm";
        break;
      case "open-term":
        S.dialog = "term";
        break;
      case "seed-projects":
      case "open-project":
        return applyScenario("grid");
    }
    return render();
  }

  if (t.dataset.cmd) {
    const arg = t.dataset.arg;
    return dispatch(t.dataset.cmd, arg === undefined ? undefined : isNaN(Number(arg)) ? arg : Number(arg));
  }
  if (t.dataset.row) {
    S.active = Number(t.dataset.row);
    S.editing = !seg(S.active).locked;
    return render();
  }
}

function onInput(e) {
  const t = e.target;
  if (t.id === "filterbox") {
    S.query = t.value;
    render();
  } else if (t.id === "findq") {
    S.find.q = t.value;
    render();
  } else if (t.id === "findr") {
    S.find.r = t.value;
  } else if (t.id === "paletteq") {
    S.palette.q = t.value;
    S.palette.sel = 0;
    render();
  } else if (t.id === "filesearch") {
    S.fileQuery = t.value;
    render();
  } else if (t.id === "concord") {
    S.concord = t.value;
    render();
  } else if (t.id === "editor") {
    const a = seg(S.active);
    if (a) {
      a.tgt = t.value;
      if (a.state === "untranslated" && t.value.trim()) a.state = "draft";
    }
    t.style.height = "auto";
    t.style.height = t.scrollHeight + "px";
    const upto = t.value.slice(0, t.selectionStart);
    S.caret = { line: upto.split("\n").length, col: upto.length - upto.lastIndexOf("\n") };
    const bar = document.querySelector(".statusbar__msg");
    if (bar) bar.textContent = `句段 #${S.active} 草稿已保存`;
  }
}

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const tag = (e.target.tagName || "").toLowerCase();
  const inText = tag === "input" || tag === "textarea" || tag === "select";

  if (S.palette.open) {
    if (e.key === "Escape") {
      e.preventDefault();
      S.palette.open = false;
      return render();
    }
    const items = PALETTE.filter((p) =>
      p.label.toLowerCase().includes(S.palette.q.trim().toLowerCase()),
    );
    if (e.key === "ArrowDown") {
      e.preventDefault();
      S.palette.sel = Math.min(items.length - 1, S.palette.sel + 1);
      return render();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      S.palette.sel = Math.max(0, S.palette.sel - 1);
      return render();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = items[S.palette.sel];
      S.palette.open = false;
      if (it) return dispatch(it.cmd);
      return render();
    }
  }

  if (mod && !e.altKey && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    return dispatch("open-command-palette");
  }
  if (mod && e.shiftKey && (e.key === "p" || e.key === "P")) {
    e.preventDefault();
    return dispatch("open-command-palette");
  }
  if (mod && e.shiftKey && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    return dispatch("focus-filter");
  }
  if (mod && !e.shiftKey && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    return dispatch("open-find");
  }
  if (mod && (e.key === "h" || e.key === "H")) {
    e.preventDefault();
    return dispatch("open-replace");
  }
  if (mod && (e.key === "p" || e.key === "P") && !e.shiftKey) {
    e.preventDefault();
    return dispatch("toggle-preview");
  }
  if (mod && (e.key === "l" || e.key === "L")) {
    e.preventDefault();
    return dispatch("toggle-lock-segment");
  }
  if (mod && e.key === "Enter") {
    e.preventDefault();
    return dispatch(
      e.altKey ? (e.shiftKey ? "confirm-segment-stay" : "confirm-segment-any") : "confirm-segment",
    );
  }
  if (e.key === "F3") {
    e.preventDefault();
    return dispatch("open-concordance");
  }
  if (e.key === "F4" && !e.altKey && !mod) {
    e.preventDefault();
    return dispatch(e.shiftKey ? "find-prev" : "find-next");
  }
  if (mod && !e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
    const i = Number(e.key) - 1;
    e.preventDefault();
    if (e.target.id === "editor") {
      if (TM_MATCHES[i]) return dispatch("apply-tm", i);
      status(`没有第 ${i + 1} 条记忆匹配`);
      return render();
    }
    const d = ["memory", "term", "qa", "ai"][i];
    if (d) {
      S.dock = d;
      return render();
    }
    return;
  }
  if (e.altKey && !mod && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const vis = visibleSegments();
    const i = vis.findIndex((s) => s.n === S.active);
    const nx = vis[Math.min(vis.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (nx) S.active = nx.n;
    return render();
  }
  if (e.key === "Escape") {
    if (S.dialog) {
      S.dialog = null;
      return render();
    }
    if (S.rowMenu !== null || S.menu !== null) {
      S.rowMenu = null;
      S.menu = null;
      return render();
    }
    if (S.find.open) {
      S.find.open = false;
      return render();
    }
    if (!inText && (S.filters.length || S.query)) {
      S.filters = [];
      S.query = "";
      status("已清除筛选");
      return render();
    }
  }
  if (!inText && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const vis = visibleSegments();
    const i = vis.findIndex((s) => s.n === S.active);
    const nx = vis[Math.min(vis.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (nx) S.active = nx.n;
    return render();
  }
}

function boot() {
  ROOT = document.getElementById("root");
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKey);
  const url = new URLSearchParams(location.search);
  const sc = url.get("scene");
  if (sc && SCENARIOS.some((s) => s.id === sc)) return applyScenario(sc);
  render();
}

document.addEventListener("DOMContentLoaded", boot);
