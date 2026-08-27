/* Shared workbench behavior engine for the three SaaS design studies.
   Renders the complete information architecture (shell, explorer, grid,
   find/replace, four docks, preview, eight dialogs, engine gate, command
   palette, status bar) from TL_DATA and wires every interaction with a
   fake engine. The visual system lives entirely in each study's CSS. */

(() => {
  const D = window.TL_DATA;

  /* ---------- helpers ---------- */

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const TOKEN_RE =
    /\{\{[^{}]*\}\}|\{[^{}\s][^{}]*\}|%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?[sdifucxXeg@]|<\/?[A-Za-z][A-Za-z0-9:._-]*(?:\s[^<>]*)?\/?>|&#?[A-Za-z0-9]+;/g;

  function tokenHtml(text, dangerTokens) {
    if (!text) return "";
    let out = "";
    let cursor = 0;
    for (const m of text.matchAll(TOKEN_RE)) {
      if (m.index > cursor) out += esc(text.slice(cursor, m.index));
      const danger = dangerTokens && dangerTokens.includes(m[0]);
      out += `<span class="tok${danger ? " tok--danger" : ""}">${esc(m[0])}</span>`;
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) out += esc(text.slice(cursor));
    return out;
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* ---------- icons (inline, stroke) ---------- */

  const P = {
    import: "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM12 11v6M9.5 14.5 12 17l2.5-2.5",
    export: "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM12 17v-6M9.5 13.5 12 11l2.5 2.5",
    check: "M5 12l5 5L20 7",
    lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9z",
    unlock: "M7 11V7a5 5 0 0 1 9.9-1M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9z",
    undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
    redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
    search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5.2-5.2",
    next: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5.2-5.2M8 10h5M10.5 7.5 13 10l-2.5 2.5",
    replace: "M4 7a3 3 0 0 1 3-3h4v6H7a3 3 0 0 1-3-3zM13 14h4a3 3 0 0 1 0 6h-4v-6zM14 4l3 3-3 3M10 20l-3-3 3-3",
    bolt: "M13 3 5 13h6l-1 8 8-10h-6l1-8z",
    db: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM9 7h6M9 11h6",
    clip: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 14l2 2 4-4",
    spark: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
    x: "M6 6l12 12M18 6 6 18",
    chevD: "M6 9l6 6 6-6",
    chevU: "M6 15l6-6 6 6",
    chevR: "M9 6l6 6-6 6",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    cmd: "M7 9a2 2 0 1 1 2-2v10a2 2 0 1 1-2-2h10a2 2 0 1 1-2 2V7a2 2 0 1 1 2 2H7z",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
    list: "M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01",
    folders: "M9 4H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-9L9 4z",
    folderOpen: "M5 19l2.2-7.5a1 1 0 0 1 1-.7H22l-2.4 7.9a1 1 0 0 1-1 .7H5zM5 19V5a1 1 0 0 1 1-1h5l2 3h7a1 1 0 0 1 1 1v2.8",
    fileDoc: "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM9 13h6M9 17h4",
    braces: "M8 4H7.5A1.5 1.5 0 0 0 6 5.5v4A2.5 2.5 0 0 1 3.5 12 2.5 2.5 0 0 1 6 14.5v4A1.5 1.5 0 0 0 7.5 20H8M16 4h.5A1.5 1.5 0 0 1 18 5.5v4a2.5 2.5 0 0 0 2.5 2.5A2.5 2.5 0 0 0 18 14.5v4a1.5 1.5 0 0 1-1.5 1.5H16",
    plus: "M12 5v14M5 12h14",
    warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  };
  const icon = (name, cls = "") =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name]}"/></svg>`;

  /* ---------- state ---------- */

  function baseState() {
    return {
      view: "workbench",
      projects: [clone(D.project)],
      documents: clone(D.documents),
      qaIssues: clone(D.qaIssues),
      tmHits: clone(D.tmHits),
      memories: clone(D.memories),
      termbases: clone(D.termbases),
      tmEntries: clone(D.tmEntries),
      blockExportOnError: D.project.blockExportOnError,
      archived: false,

      openDocIds: ["d1"],
      activeDocId: "d1",
      activeSegId: "s2",
      editing: true,
      drafts: {},

      chips: [], // active filter chips: untranslated draft confirmed qa locked term tag
      query: "",
      fileQuery: "",
      collapsed: [], // collapsed folder paths in the file tree

      dock: "memory",
      concordance: "",
      findOpen: false,
      findMode: "find",
      findQuery: "",
      replaceWith: "",
      includeConfirmed: false,

      paletteOpen: false,
      paletteQuery: "",
      paletteSel: 0,

      previewOpen: true,
      previewMode: "proofread",

      menuOpen: null,
      rowMenu: null,
      dialog: null, // {kind, ...}
      pendingRemoveId: null,
      tmPage: 0,
      tmEditId: null,
      tmDeleteId: null,
      termEditId: null,
      termDeleteId: null,

      aiConfigured: true,
      aiProvider: "OpenAI",
      aiModel: "gpt-5.2",
      aiBusy: false,
      aiCandidate: null,
      agentRun: null,
      agentInstruction: "",

      engine: "ready",
      status: "就绪",
      toast: null,
      undoStack: [],
      redoStack: [],
      caret: { line: 1, column: 1 },
    };
  }

  let S = baseState();
  let toastTimer = null;
  let draftTimer = null;

  /* ---------- derived ---------- */

  const activeDoc = () => S.documents.find((d) => d.id === S.activeDocId) || null;
  const segsOf = (docId) => (S.documents.find((d) => d.id === docId) || { segments: [] }).segments;
  const activeSeg = () => segsOf(S.activeDocId).find((s) => s.id === S.activeSegId) || null;
  const openIssues = () => S.qaIssues.filter((q) => q.docId === S.activeDocId && q.status === "open");
  const issuesOf = (segId) => openIssues().filter((q) => q.segId === segId);
  const segTm = (segId) => S.tmHits[segId] || [];
  const segTerms = (segId) => D.termHits[segId] || [];
  const hasTokens = (seg) => TOKEN_RE.test(seg.source) || TOKEN_RE.test(seg.target);

  function counts(docId) {
    const list = segsOf(docId);
    const c = { total: list.length, untranslated: 0, draft: 0, confirmed: 0 };
    for (const s of list) c[s.state] += 1;
    c.openIssues = S.qaIssues.filter((q) => q.docId === docId && q.status === "open").length;
    return c;
  }

  function visibleSegs() {
    const chips = S.chips;
    const states = chips.filter((c) => ["untranslated", "draft", "confirmed"].includes(c));
    const q = S.query.trim().toLowerCase();
    return segsOf(S.activeDocId).filter((s) => {
      if (states.length && !states.includes(s.state)) return false;
      if (chips.includes("qa") && issuesOf(s.id).length === 0) return false;
      if (chips.includes("locked") && !s.locked) return false;
      if (chips.includes("term") && segTerms(s.id).length === 0) return false;
      if (chips.includes("tag") && !hasTokens(s)) return false;
      if (q && !(s.source + "\n" + s.target).toLowerCase().includes(q)) return false;
      return true;
    });
  }

  const CHIP_LABEL = {
    untranslated: "未译", draft: "草稿", confirmed: "已确认",
    qa: "QA", locked: "锁定", term: "有术语", tag: "有标签",
  };

  /* ---------- status / toast ---------- */

  function say(msg, withToast) {
    S.status = msg;
    if (withToast) {
      S.toast = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { S.toast = null; render(); }, 2800);
    }
  }

  /* ---------- commands ---------- */

  function selectSeg(id, { edit = true } = {}) {
    commitDraft();
    S.activeSegId = id;
    S.editing = edit;
    S.rowMenu = null;
  }

  function currentDraft() {
    const ta = document.querySelector(".grid textarea");
    return ta ? ta.value : null;
  }

  function commitDraft() {
    clearTimeout(draftTimer);
    const seg = activeSeg();
    const text = currentDraft();
    if (!seg || text === null || seg.locked) return;
    if (text === seg.target) return;
    S.undoStack.push({ segId: seg.id, before: seg.target, after: text });
    S.redoStack = [];
    seg.target = text;
    if (seg.origin && !seg.origin.edited) seg.origin.edited = true;
    if (seg.state === "confirmed") seg.state = "draft";
    if (text.trim() === "") { seg.state = "untranslated"; }
    else if (seg.state === "untranslated") seg.state = "draft";
  }

  function confirmSeg(mode) {
    const seg = activeSeg();
    if (!seg) { say("没有正在编辑的句段，无法确认"); render(); return; }
    if (seg.locked) { say(`句段 #${seg.ordinal + 1} 已锁定，无法确认`); render(); return; }
    const text = currentDraft() ?? seg.target;
    if (text.trim() === "") {
      say(`句段 #${seg.ordinal + 1} 译文为空，无法确认`);
      render();
      return;
    }
    commitDraft();
    seg.target = text;
    seg.state = "confirmed";
    // Confirm writes the working memory: the lookup for this source now
    // surfaces the entry that was just written, best first.
    S.tmHits[seg.id] = [
      { score: 100, grade: "exact", memory: "主工作记忆", source: seg.source, target: seg.target },
      ...segTm(seg.id).filter((h) => h.score !== 100),
    ];
    // Confirm-time QA for this segment: unedited-fuzzy resolves once edited.
    const openQa = issuesOf(seg.id).length;
    say(`句段 #${seg.ordinal + 1} 已确认并写入 TM${openQa ? `，QA ${openQa} 个问题` : ""}`, true);
    if (mode !== "stay") {
      const vis = visibleSegs();
      const i = vis.findIndex((s) => s.id === seg.id);
      for (let k = i + 1; k < vis.length; k += 1) {
        const c = vis[k];
        if (c.locked) continue;
        if (mode === "nextAny" || c.state !== "confirmed") { S.activeSegId = c.id; S.editing = true; break; }
      }
    }
    render();
  }

  function toggleLock(segId) {
    const seg = segsOf(S.activeDocId).find((s) => s.id === segId) || activeSeg();
    if (!seg) { say("没有选中的句段，无法锁定"); render(); return; }
    commitDraft();
    seg.locked = !seg.locked;
    say(seg.locked ? `句段 #${seg.ordinal + 1} 已锁定` : `句段 #${seg.ordinal + 1} 已解锁`);
    render();
  }

  function applyTm(hit, note) {
    const seg = activeSeg();
    if (!seg || seg.locked) return;
    S.undoStack.push({ segId: seg.id, before: seg.target, after: hit.target });
    seg.target = hit.target;
    seg.state = "draft";
    seg.origin = { kind: hit.grade === "exact" ? "tmExact" : "tmFuzzy", score: hit.score };
    say(note || `已应用记忆匹配（${hit.score}%）为草稿`);
    render();
  }

  function insertTerm(term) {
    const ta = document.querySelector(".grid textarea");
    const seg = activeSeg();
    if (!seg || seg.locked) return;
    if (ta) {
      const a = ta.selectionStart ?? ta.value.length;
      const b = ta.selectionEnd ?? a;
      ta.value = ta.value.slice(0, a) + term + ta.value.slice(b);
      ta.focus();
      ta.setSelectionRange(a + term.length, a + term.length);
      scheduleDraft();
    } else {
      seg.target += term;
      seg.state = seg.state === "confirmed" ? "draft" : seg.state === "untranslated" ? "draft" : seg.state;
      render();
    }
  }

  function runQa() {
    const c = counts(S.activeDocId);
    say(`QA 完成：检查 ${c.total} 个句段，${c.openIssues} 个未解决问题`);
    S.dock = "qa";
    render();
  }

  function pretranslate() {
    const list = segsOf(S.activeDocId).filter((s) => s.state === "untranslated" && !s.locked);
    let exact = 0, fuzzy = 0;
    for (const s of list) {
      const hit = segTm(s.id)[0];
      if (!hit) continue;
      s.target = hit.target;
      s.state = "draft";
      s.origin = { kind: hit.grade === "exact" ? "tmExact" : "tmFuzzy", score: hit.score };
      if (hit.grade === "exact") exact += 1; else fuzzy += 1;
    }
    say(`预翻译完成：检查 ${list.length} 个未译句段，填充 ${exact + fuzzy} 个（精确 ${exact} / 模糊 ${fuzzy}）`);
    render();
  }

  function exportDoc() {
    const errors = openIssues().filter((q) => q.severity === "error");
    if (S.blockExportOnError && errors.length > 0) {
      S.dialog = { kind: "exportQaGate", openErrors: errors.length, rules: [...new Set(errors.map((q) => q.ruleId))] };
    } else {
      S.dialog = { kind: "exportOverwrite", path: "~/Documents/交付/user-guide-translated.docx" };
    }
    render();
  }

  function findMatches() {
    const q = S.findQuery.trim().toLowerCase();
    if (!q) return [];
    return visibleSegs().filter((s) => (s.source + "\n" + s.target).toLowerCase().includes(q));
  }

  function findJump(dir) {
    const q = S.findQuery.trim();
    if (!q) { S.findOpen = true; S.findMode = "find"; render(".find input[data-refocus='find']"); return; }
    const vis = visibleSegs();
    const matches = findMatches();
    if (!matches.length) { say(`查找「${q}」：没有匹配`); render(); return; }
    const ids = matches.map((s) => s.id);
    const cur = vis.findIndex((s) => s.id === S.activeSegId);
    const step = dir === "next" ? 1 : -1;
    for (let k = 1; k <= vis.length; k += 1) {
      const idx = (cur + step * k + vis.length * k) % vis.length;
      const cand = vis[idx];
      if (ids.includes(cand.id)) {
        const wrapped = dir === "next" ? idx <= cur : idx >= cur;
        selectSeg(cand.id);
        if (wrapped) say(dir === "next" ? `查找「${q}」：已从头继续，跳到句段 #${cand.ordinal + 1}` : `查找「${q}」：已从末尾继续，跳到句段 #${cand.ordinal + 1}`);
        render();
        return;
      }
    }
  }

  function replaceActive() {
    const q = S.findQuery.trim();
    const seg = activeSeg();
    if (!q || !seg) return;
    if (!seg.target.toLowerCase().includes(q.toLowerCase())) { findJump("next"); return; }
    if (seg.state === "confirmed" && !S.includeConfirmed) {
      say(`句段 #${seg.ordinal + 1} 已确认，未替换`); render(); return;
    }
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const n = (seg.target.match(re) || []).length;
    S.undoStack.push({ segId: seg.id, before: seg.target, after: seg.target.replace(re, S.replaceWith) });
    seg.target = seg.target.replace(re, S.replaceWith);
    if (seg.state === "confirmed") seg.state = "draft";
    say(`句段 #${seg.ordinal + 1} 已替换 ${n} 处「${q}」`);
    render();
  }

  function replaceAll() {
    const q = S.findQuery.trim();
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let segsHit = 0, occurrences = 0, skippedConfirmed = 0, skippedLocked = 0, demoted = 0;
    for (const s of segsOf(S.activeDocId)) {
      const n = (s.target.match(re) || []).length;
      if (!n) continue;
      if (s.locked) { skippedLocked += 1; continue; }
      if (s.state === "confirmed" && !S.includeConfirmed) { skippedConfirmed += 1; continue; }
      if (s.state === "confirmed") { s.state = "draft"; demoted += 1; }
      s.target = s.target.replace(re, S.replaceWith);
      segsHit += 1; occurrences += n;
    }
    const notes =
      (demoted ? `；${demoted} 个已确认句段退回草稿` : "") +
      (skippedConfirmed ? `；跳过 ${skippedConfirmed} 个已确认句段` : "") +
      (skippedLocked ? `；跳过 ${skippedLocked} 个已锁定句段` : "");
    say(segsHit === 0
      ? `全部替换：译文中没有「${q}」${notes}`
      : `全部替换完成：${segsHit} 个句段、${occurrences} 处「${q}」→「${S.replaceWith}」${notes}`);
    render();
  }

  function waive(sel, waived) {
    let hit = [];
    if (sel.issueId) hit = S.qaIssues.filter((q) => q.id === sel.issueId);
    if (sel.ruleId) hit = S.qaIssues.filter((q) => q.docId === S.activeDocId && q.ruleId === sel.ruleId && q.status === "open");
    if (sel.segId) hit = S.qaIssues.filter((q) => q.segId === sel.segId && q.status === "open");
    for (const q of hit) q.status = waived ? "waived" : "open";
    const label = hit.length > 1 ? `${hit.length} 个 QA 问题` : "QA 问题";
    say(waived ? `已忽略 ${label}` : `已恢复 ${label}为未解决`);
    render();
  }

  function applyFix(issueId) {
    const q = S.qaIssues.find((i) => i.id === issueId);
    if (!q || !q.fix) return;
    const seg = segsOf(q.docId).find((s) => s.id === q.segId);
    S.undoStack.push({ segId: seg.id, before: seg.target, after: q.fix.text });
    seg.target = q.fix.text;
    if (seg.state === "confirmed") seg.state = "draft";
    q.status = "resolved";
    say(`句段 #${seg.ordinal + 1} 已应用修复`);
    render();
  }

  function jumpTo(segId) {
    const vis = visibleSegs();
    if (!vis.some((s) => s.id === segId)) { S.chips = []; S.query = ""; }
    selectSeg(segId);
    render();
    const row = document.querySelector(`tr[data-seg="${segId}"]`);
    if (row) row.scrollIntoView({ block: "center" });
  }

  function aiAssist(action) {
    const seg = activeSeg();
    if (!seg || S.aiBusy) return;
    S.aiBusy = true;
    S.aiCandidate = null;
    render();
    setTimeout(() => {
      S.aiBusy = false;
      const drafts = {
        s2: "选择一个文件夹以开始，然后选择 {folderName} 进行确认。",
        s4: "一个账户最多可关联 %d 台设备。",
        s10: "在搜索栏中使用 &amp; 组合多个筛选条件。",
      };
      const text = drafts[seg.id] || (seg.target ? seg.target + "（润色稿）" : "（AI 草稿）" + seg.source);
      S.aiCandidate = {
        segId: seg.id, action,
        text, base: seg.target,
        tagOk: true,
      };
      say(`AI ${action === "translate" ? "翻译" : "润色"}完成（${S.aiModel}，742ms）`);
      render();
    }, 700);
  }

  function agentStart() {
    if (!S.aiConfigured) return;
    S.agentRun = { ...clone(D.agentRun), status: "running", steps: [] };
    say(`Agent 任务单已创建：${S.agentRun.planned} 个未翻译句段，TM 预翻 ${S.agentRun.tm} 个`);
    render();
    const steps = clone(D.agentRun.steps);
    const tick = () => {
      if (!S.agentRun || S.agentRun.status !== "running") return;
      const next = steps.shift();
      if (next) { S.agentRun.steps.push(next); render(); setTimeout(tick, 650); }
      else {
        S.agentRun.status = "awaitingReview";
        say(`Agent 已完成：TM ${S.agentRun.tm}，AI 草稿 ${S.agentRun.ai}，失败 ${S.agentRun.failed}，QA 未解决 ${S.agentRun.qaOpen}`, true);
        render();
      }
    };
    setTimeout(tick, 500);
  }

  /* ---------- menus / palette catalogs ---------- */

  const docOpen = () => S.view === "workbench" && activeDoc() !== null;

  function menuModel() {
    const seg = activeSeg();
    return [
      { id: "file", label: "文件", items: [
        { label: "导入文档…", cmd: "import", key: "Ctrl+O" },
        { label: "导出译文…", cmd: "export", key: "Ctrl+E", disabled: !docOpen() },
        { sep: true },
        { label: "项目设置…", cmd: "settings", key: "Ctrl+," },
        { label: "返回项目列表", cmd: "close-project" },
        { sep: true },
        { label: "退出", cmd: "noop" },
      ]},
      { id: "edit", label: "编辑", items: [
        { label: "撤销", cmd: "undo", key: "Ctrl+Z", disabled: S.undoStack.length === 0 },
        { label: "重做", cmd: "redo", key: "Ctrl+Y", disabled: S.redoStack.length === 0 },
        { sep: true },
        { label: "确认当前句段", cmd: "confirm", key: "Ctrl+Enter", disabled: !docOpen() },
        { label: "确认并到下一句段", cmd: "confirm-any", key: "Ctrl+Alt+Enter", disabled: !docOpen() },
        { label: "确认并停留", cmd: "confirm-stay", key: "Ctrl+Alt+Shift+Enter", disabled: !docOpen() },
        { sep: true },
        { label: seg && seg.locked ? "解锁句段" : "锁定句段", cmd: "lock", key: "Ctrl+L", disabled: !seg },
      ]},
      { id: "view", label: "视图", items: [
        { label: "命令面板", cmd: "palette", key: "Ctrl+K" },
        { sep: true },
        { label: "预览面板", cmd: "preview", key: "Ctrl+P", disabled: !docOpen() },
        { sep: true },
        { label: "记忆面板", cmd: "dock-memory", key: "Ctrl+1" },
        { label: "术语面板", cmd: "dock-term", key: "Ctrl+2" },
        { label: "QA 面板", cmd: "dock-qa", key: "Ctrl+3" },
        { label: "AI 面板", cmd: "dock-ai", key: "Ctrl+4" },
      ]},
      { id: "project", label: "项目", items: [
        { label: "项目设置…", cmd: "settings", key: "Ctrl+," },
        { label: "记忆库管理…", cmd: "tm-manage" },
        { label: "术语库管理…", cmd: "term-manage" },
        { sep: true },
        { label: S.archived ? "恢复项目" : "归档项目", cmd: "archive" },
        { label: "返回项目列表", cmd: "close-project" },
      ]},
      { id: "translate", label: "翻译", items: [
        { label: "预翻译", cmd: "pretranslate", disabled: !docOpen() },
        { label: "插入记忆", cmd: "insert-tm", disabled: !seg || segTm(S.activeSegId).length === 0 },
        { label: "插入术语", cmd: "insert-term", disabled: !seg || segTerms(S.activeSegId).length === 0 },
        { sep: true },
        { label: "查找…", cmd: "find", key: "Ctrl+F", disabled: !docOpen() },
        { label: "替换…", cmd: "replace", key: "Ctrl+H", disabled: !docOpen() },
        { label: "查找下一个", cmd: "find-next", key: "F4", disabled: !docOpen() },
        { label: "查找上一个", cmd: "find-prev", key: "Shift+F4", disabled: !docOpen() },
        { label: "筛选句段", cmd: "focus-filter", key: "Ctrl+Shift+F", disabled: !docOpen() },
        { label: "检索（取选中文本）", cmd: "concordance", key: "F3" },
      ]},
      { id: "qa", label: "QA", items: [
        { label: "运行 QA", cmd: "run-qa", disabled: !docOpen() },
        { label: "QA 面板", cmd: "dock-qa", key: "Ctrl+3" },
        { sep: true },
        { label: `${S.blockExportOnError ? "✓ " : ""}有错误时阻止导出`, cmd: "toggle-gate" },
        { label: "导出译文…", cmd: "export", key: "Ctrl+E", disabled: !docOpen() },
      ]},
      { id: "help", label: "帮助", items: [
        { label: "命令面板", cmd: "palette", key: "Ctrl+K" },
        { label: "重新加载窗口", cmd: "reload" },
      ]},
    ];
  }

  function paletteModel() {
    const seg = activeSeg();
    const cmds = [
      { label: "导入文档…", cmd: "import", key: "Ctrl+O", enabled: true },
      { label: "导出译文…", cmd: "export", key: "Ctrl+E", enabled: docOpen() },
      { label: "项目设置…", cmd: "settings", key: "Ctrl+,", enabled: true },
      { label: "记忆库管理…", cmd: "tm-manage", enabled: true },
      { label: "术语库管理…", cmd: "term-manage", enabled: true },
      { label: "返回项目列表", cmd: "close-project", enabled: true },
      { label: "确认当前句段", cmd: "confirm", key: "Ctrl+Enter", enabled: docOpen() },
      { label: "确认并到下一句段", cmd: "confirm-any", key: "Ctrl+Alt+Enter", enabled: docOpen() },
      { label: "确认并停留", cmd: "confirm-stay", key: "Ctrl+Alt+Shift+Enter", enabled: docOpen() },
      { label: seg && seg.locked ? "解锁当前句段" : "锁定当前句段", cmd: "lock", key: "Ctrl+L", enabled: !!seg },
      { label: "预翻译", cmd: "pretranslate", enabled: docOpen() },
      { label: "运行 QA", cmd: "run-qa", enabled: docOpen() },
      { label: "预览面板", cmd: "preview", key: "Ctrl+P", enabled: docOpen() },
      { label: "查找…", cmd: "find", key: "Ctrl+F", enabled: docOpen() },
      { label: "替换…", cmd: "replace", key: "Ctrl+H", enabled: docOpen() },
      { label: "查找下一个", cmd: "find-next", key: "F4", enabled: docOpen() },
      { label: "查找上一个", cmd: "find-prev", key: "Shift+F4", enabled: docOpen() },
      { label: "筛选句段", cmd: "focus-filter", key: "Ctrl+Shift+F", enabled: docOpen() },
      { label: "检索（取选中文本）", cmd: "concordance", key: "F3", enabled: true },
      { label: "记忆面板", cmd: "dock-memory", key: "Ctrl+1", enabled: true },
      { label: "术语面板", cmd: "dock-term", key: "Ctrl+2", enabled: true },
      { label: "QA 面板", cmd: "dock-qa", key: "Ctrl+3", enabled: true },
      { label: "AI 面板", cmd: "dock-ai", key: "Ctrl+4", enabled: true },
      ...S.documents.map((d) => ({ label: `打开文档：${d.name}`, cmd: `open-doc:${d.id}`, enabled: true })),
    ];
    const q = S.paletteQuery.trim().toLowerCase();
    return q ? cmds.filter((c) => c.label.toLowerCase().includes(q)) : cmds;
  }

  function run(cmd) {
    if (cmd.startsWith("open-doc:")) {
      const id = cmd.slice(9);
      if (!S.openDocIds.includes(id)) S.openDocIds.push(id);
      S.activeDocId = id;
      S.activeSegId = segsOf(id)[0] ? segsOf(id)[0].id : null;
      render();
      return;
    }
    switch (cmd) {
      case "import": S.dialog = { kind: "import", path: null, segmentation: S.projects[0].segmentation, srx: null }; break;
      case "export": exportDoc(); return;
      case "settings": S.dialog = { kind: "settings" }; break;
      case "tm-manage": S.dialog = { kind: "tmManage" }; S.tmPage = 0; break;
      case "term-manage": S.dialog = { kind: "termManage" }; break;
      case "new-project": S.dialog = { kind: "newProject", name: "", src: "en-US", tgt: "zh-CN" }; break;
      case "close-project": S.view = "projects"; S.dialog = null; break;
      case "open-project": S.view = "workbench"; break;
      case "confirm": confirmSeg("nextUnconfirmed"); return;
      case "confirm-any": confirmSeg("nextAny"); return;
      case "confirm-stay": confirmSeg("stay"); return;
      case "lock": toggleLock(S.activeSegId); return;
      case "undo": {
        const op = S.undoStack.pop();
        if (op) {
          const seg = segsOf(S.activeDocId).find((s) => s.id === op.segId);
          if (seg) { seg.target = op.before; if (seg.target.trim() === "") seg.state = "untranslated"; else if (seg.state === "confirmed") seg.state = "draft"; }
          S.redoStack.push(op);
          say(`已撤销：句段 #${seg ? seg.ordinal + 1 : "?"}`);
        }
        break;
      }
      case "redo": {
        const op = S.redoStack.pop();
        if (op) {
          const seg = segsOf(S.activeDocId).find((s) => s.id === op.segId);
          if (seg) { seg.target = op.after; if (seg.state === "untranslated" && op.after.trim()) seg.state = "draft"; }
          S.undoStack.push(op);
          say(`已重做：句段 #${seg ? seg.ordinal + 1 : "?"}`);
        }
        break;
      }
      case "palette": S.paletteOpen = true; S.paletteQuery = ""; S.paletteSel = 0; break;
      case "preview": S.previewOpen = !S.previewOpen; break;
      case "dock-memory": S.dock = "memory"; break;
      case "dock-term": S.dock = "term"; break;
      case "dock-qa": S.dock = "qa"; break;
      case "dock-ai": S.dock = "ai"; break;
      case "find": S.findOpen = true; S.findMode = "find"; break;
      case "replace": S.findOpen = true; S.findMode = "replace"; break;
      case "find-next": findJump("next"); return;
      case "find-prev": findJump("prev"); return;
      case "focus-filter": render(".ribbon input[data-refocus='filter']"); return;
      case "concordance": {
        const sel = window.getSelection ? String(window.getSelection()).trim() : "";
        if (sel) S.concordance = sel;
        S.dock = "memory";
        break;
      }
      case "run-qa": runQa(); return;
      case "pretranslate": pretranslate(); return;
      case "insert-tm": {
        const hit = segTm(S.activeSegId)[0];
        if (hit) applyTm(hit, `已应用第 1 条记忆匹配（${hit.score}%）为草稿`);
        return;
      }
      case "insert-term": {
        const t = segTerms(S.activeSegId)[0];
        if (t) { const tr = t.translations.find((x) => !x.forbidden); if (tr) insertTerm(tr.term); }
        return;
      }
      case "archive": S.archived = !S.archived; say(S.archived ? "项目已归档" : "项目已恢复为进行中"); break;
      case "toggle-gate": S.blockExportOnError = !S.blockExportOnError; say(S.blockExportOnError ? "已开启导出前 QA 检查" : "已关闭导出前 QA 检查"); break;
      case "reload": say("窗口已重新加载"); break;
      case "engine-down": S.engine = "down"; break;
      case "engine-up": S.engine = "ready"; say("引擎已恢复，已重新同步"); break;
      default: break;
    }
    S.menuOpen = null;
    render();
  }

  /* ---------- scenes ---------- */

  const SCENES = [
    ["empty", "空项目"],
    ["grid", "已导入"],
    ["confirm-tm", "确认写入 TM"],
    ["locked", "锁定行"],
    ["fuzzy-qa", "模糊 QA"],
    ["ai-unconfigured", "AI 未配置"],
    ["agent-review", "Agent 待审核"],
    ["export-gate", "导出门"],
    ["engine-gate", "引擎闸门"],
  ];

  function applyScene(name) {
    S = baseState();
    S.scene = name;
    switch (name) {
      case "empty":
        S.view = "projects";
        S.projects = [];
        S.status = "就绪";
        break;
      case "grid":
        break;
      case "confirm-tm": {
        const seg = segsOf("d1").find((s) => s.id === "s2");
        seg.state = "confirmed";
        S.tmHits.s2 = [
          { score: 100, grade: "exact", memory: "主工作记忆", source: seg.source, target: seg.target },
          ...S.tmHits.s2,
        ];
        S.dock = "memory";
        say("句段 #2 已确认并写入 TM", true);
        break;
      }
      case "locked":
        S.activeSegId = "s8";
        S.editing = false;
        say("句段 #8 已锁定");
        break;
      case "fuzzy-qa":
        S.activeSegId = "s7";
        S.dock = "qa";
        say("QA 完成：检查 12 个句段，4 个未解决问题");
        break;
      case "ai-unconfigured":
        S.aiConfigured = false;
        S.dock = "ai";
        break;
      case "agent-review":
        S.dock = "ai";
        S.agentRun = clone(D.agentRun);
        say("Agent 已完成：TM 3，AI 草稿 9，失败 2，QA 未解决 3");
        break;
      case "export-gate":
        S.dialog = { kind: "exportQaGate", openErrors: 2, rules: ["qa.number-mismatch", "qa.tag-placeholder_missing"] };
        say("导出被 QA 门拦截：2 个错误未解决");
        break;
      case "engine-gate":
        S.engine = "down";
        break;
      default:
        break;
    }
    render();
  }

  /* ---------- render: shell pieces ---------- */

  const kbd = (k) => (k ? `<kbd>${esc(k)}</kbd>` : "");

  function rDemoStrip() {
    return `<div class="demo" role="navigation" aria-label="场景">
      <span class="demo__label">场景</span>
      ${SCENES.map(([id, label]) =>
        `<button class="demo__btn" data-action="scene" data-arg="${id}" data-on="${S.scene === id}">${label}</button>`).join("")}
      <span class="demo__spacer"></span>
      <span class="demo__study">${window.STUDY ? window.STUDY.label : ""}</span>
    </div>`;
  }

  function rMenubar() {
    return `<header class="menubar">
      <span class="menubar__app">Translunar</span>
      <nav class="menubar__menus" role="menubar">
        ${menuModel().map((m) => `
          <span class="menubar__wrap">
            <button class="menubar__item" data-action="menu" data-arg="${m.id}" data-open="${S.menuOpen === m.id}" aria-haspopup="menu" aria-expanded="${S.menuOpen === m.id}">${m.label}</button>
            ${S.menuOpen === m.id ? `<div class="menu" role="menu">
              ${m.items.map((it) => it.sep
                ? `<div class="menu__sep"></div>`
                : `<button class="menu__item" role="menuitem" data-action="cmd" data-arg="${it.cmd}" ${it.disabled ? "disabled" : ""}>
                     <span>${esc(it.label)}</span>${kbd(it.key)}
                   </button>`).join("")}
            </div>` : ""}
          </span>`).join("")}
      </nav>
      <span class="menubar__spacer"></span>
      <span class="menubar__doc">${S.view === "workbench" && activeDoc() ? `${esc(S.projects[0] ? S.projects[0].name : D.project.name)} · ${esc(activeDoc().name)}` : ""}</span>
    </header>`;
  }

  function rRibbon() {
    const seg = activeSeg();
    const open = docOpen();
    const b = (cmd, label, ic, opts = {}) =>
      `<button class="rb${opts.primary ? " rb--primary" : ""}" data-action="cmd" data-arg="${cmd}" ${opts.disabled ? "disabled" : ""} ${opts.tip ? `data-tip="${esc(opts.tip)}"` : ""}>
        ${icon(ic)}<span class="rb__label">${label}</span>
      </button>`;
    return `<div class="ribbon" role="toolbar" aria-label="工具栏">
      <div class="ribbon__group">
        ${b("import", "导入", "import", { tip: "导入文档 Ctrl+O" })}
        ${b("export", "导出译文", "export", { disabled: !open, tip: "导出译文 Ctrl+E" })}
      </div>
      <div class="ribbon__group">
        ${b("undo", "撤销", "undo", { disabled: S.undoStack.length === 0, tip: "撤销 Ctrl+Z" })}
        ${b("redo", "重做", "redo", { disabled: S.redoStack.length === 0, tip: "重做 Ctrl+Y" })}
      </div>
      <div class="ribbon__group">
        ${b("confirm", "确认", "check", { primary: true, disabled: !open, tip: "确认 Ctrl+Enter · 确认并到下一句 Ctrl+Alt+Enter · 确认并停留 Ctrl+Alt+Shift+Enter" })}
        ${b("lock", seg && seg.locked ? "解锁句段" : "锁定句段", seg && seg.locked ? "unlock" : "lock", { disabled: !seg, tip: "锁定/解锁 Ctrl+L" })}
        ${b("insert-tm", "插入记忆", "db", { disabled: !seg || segTm(S.activeSegId).length === 0, tip: "应用最佳记忆匹配为草稿 Ctrl+1..9" })}
        ${b("insert-term", "插入术语", "book", { disabled: !seg || segTerms(S.activeSegId).length === 0, tip: "插入首选术语到光标处" })}
        ${b("pretranslate", "预翻译", "bolt", { disabled: !open, tip: "用 TM 填充未译句段" })}
      </div>
      <div class="ribbon__group">
        ${b("find", "查找", "search", { disabled: !open, tip: "查找 Ctrl+F" })}
        ${b("find-next", "查找下一个", "next", { disabled: !open, tip: "查找下一个 F4 · 上一个 Shift+F4" })}
        ${b("replace", "替换", "replace", { disabled: !open, tip: "替换 Ctrl+H" })}
        ${b("concordance", "检索", "list", { tip: "检索选中文本 F3" })}
        ${b("run-qa", "运行 QA", "clip", { disabled: !open, tip: "运行质量检查" })}
      </div>
      <div class="ribbon__group">
        ${b("preview", "预览", "eye", { disabled: !open, tip: "预览面板 Ctrl+P" })}
      </div>
      <span class="ribbon__spacer"></span>
      <span class="ribbon__search">
        ${icon("search", "ic--dim")}
        <input data-refocus="filter" data-input="query" type="search" placeholder="搜索句段" aria-label="按文本筛选" value="${esc(S.query)}" ${!open ? "disabled" : ""} data-tip="筛选句段 Ctrl+Shift+F">
      </span>
      <button class="rb rb--cmdk" data-action="cmd" data-arg="palette" data-tip="命令面板 Ctrl+K">${icon("cmd")}<span class="rb__label">命令搜索</span><kbd>Ctrl K</kbd></button>
    </div>`;
  }

  function rExplorer() {
    const proj = S.projects[0] || D.project;
    const c = S.documents.reduce((acc, d) => {
      const k = counts(d.id);
      acc.total += k.total; acc.confirmed += k.confirmed; acc.draft += k.draft;
      return acc;
    }, { total: 0, confirmed: 0, draft: 0 });
    const pct = c.total ? Math.round((c.confirmed / c.total) * 100) : 0;
    const fq = S.fileQuery.trim().toLowerCase();
    const docs = fq ? S.documents.filter((d) => d.name.toLowerCase().includes(fq)) : S.documents;
    return `<aside class="explorer">
      <section class="ex__sec">
        <header class="ex__head"><h2>项目</h2>
          <button class="iconbtn" data-action="cmd" data-arg="settings" aria-label="项目设置" data-tip="项目设置 Ctrl+,">${icon("gear")}</button>
        </header>
        <p class="ex__name">${esc(proj.name)}</p>
        <p class="ex__langs">语言对：<span class="num">${proj.sourceLocale} → ${proj.targetLocale}</span></p>
        <div class="ex__progress">
          <span class="ex__pct">进度 <span class="num">${pct}%</span></span>
          <span class="bar" role="img" aria-label="已确认 ${c.confirmed}/${c.total}">
            <span class="bar__ok" style="width:${c.total ? (c.confirmed / c.total) * 100 : 0}%"></span>
            <span class="bar__draft" style="width:${c.total ? (c.draft / c.total) * 100 : 0}%"></span>
          </span>
        </div>
      </section>
      <section class="ex__sec ex__sec--files">
        <header class="ex__head"><h2>文件</h2><span class="ex__count num">${S.documents.length}</span></header>
        <span class="ex__search">${icon("search", "ic--dim")}<input data-refocus="files" data-input="fileQuery" type="search" placeholder="搜索文件" aria-label="搜索文件" value="${esc(S.fileQuery)}"></span>
        <div class="tree" role="tree" aria-label="项目文件">${rTree(docs, fq.length > 0)}</div>
        <button class="dropzone" data-action="cmd" data-arg="import" data-tip="导入文档 Ctrl+O">
          ${icon("import")}<span>拖放文件导入，或点击选择</span>
        </button>
      </section>
      <section class="ex__sec">
        <header class="ex__head"><h2>筛选</h2>${S.chips.length ? `<button class="linkbtn" data-action="chips-clear">清除（Esc）</button>` : ""}</header>
        <div class="chips">
          ${Object.entries(CHIP_LABEL).map(([id, label]) => {
            const on = S.chips.includes(id);
            return `<button class="chip" data-action="chip" data-arg="${id}" data-on="${on}" aria-pressed="${on}">${label}${on ? `<span class="chip__x">×</span>` : ""}</button>`;
          }).join("")}
        </div>
      </section>
      <section class="ex__sec ex__sec--details">
        <header class="ex__head"><h2>项目详情</h2></header>
        <dl class="ex__dl">
          <div><dt>源语言</dt><dd class="num">${proj.sourceLocale}</dd></div>
          <div><dt>目标语言</dt><dd class="num">${proj.targetLocale}</dd></div>
          <div><dt>创建时间</dt><dd class="num">${proj.createdAt || D.project.createdAt}</dd></div>
          <div><dt>文件数</dt><dd class="num">${S.documents.length}</dd></div>
          <div><dt>总句段</dt><dd class="num">${c.total}</dd></div>
          <div><dt>已确认</dt><dd class="num">${c.confirmed}（${pct}%）</dd></div>
        </dl>
      </section>
    </aside>`;
  }

  function rTree(docs, forceOpen) {
    const root = { folders: new Map(), files: [] };
    for (const d of docs) {
      const parts = (d.folder || "").split("/").filter(Boolean);
      let node = root;
      let path = "";
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        if (!node.folders.has(part)) node.folders.set(part, { name: part, path, folders: new Map(), files: [] });
        node = node.folders.get(part);
      }
      node.files.push(d);
    }
    const fileCount = (node) =>
      node.files.length + [...node.folders.values()].reduce((n, f) => n + fileCount(f), 0);
    const fileRow = (d) => {
      const k = counts(d.id);
      const dpct = k.total ? Math.round((k.confirmed / k.total) * 100) : 0;
      const active = d.id === S.activeDocId;
      return `<div class="tree__item" data-active="${active}" role="none">
        <button class="tree__row tree__row--file" role="treeitem" aria-selected="${active}" data-action="cmd" data-arg="open-doc:${d.id}"
          data-tip="${d.format} · 确认 ${k.confirmed}/${k.total}${k.draft ? ` · 草稿 ${k.draft}` : ""}${k.openIssues ? ` · QA ${k.openIssues}` : ""}">
          ${icon(d.format === "json" ? "braces" : "fileDoc", "tree__fic")}
          <span class="tree__name">${esc(d.name)}</span>
          ${k.openIssues ? `<span class="tree__qa num" aria-label="${k.openIssues} 个 QA 问题">${k.openIssues}</span>` : ""}
          <span class="tree__pct num">${dpct}%</span>
        </button>
        <button class="iconbtn tree__remove" data-action="remove-arm" data-arg="${d.id}" aria-label="移除 ${esc(d.name)}" data-tip="移除文档">${icon("x")}</button>
        ${S.pendingRemoveId === d.id ? `<span class="tree__confirm">
            <button class="btn btn--danger btn--sm" data-action="remove-doc" data-arg="${d.id}">确认移除</button>
            <button class="btn btn--ghost btn--sm" data-action="remove-cancel">取消</button>
          </span>` : ""}
      </div>`;
    };
    const renderNode = (node) => {
      const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
      const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
      return [
        ...folders.map((f) => {
          const open = forceOpen || !S.collapsed.includes(f.path);
          return `<div class="tree__group" role="none">
            <button class="tree__row tree__row--folder" role="treeitem" aria-expanded="${open}" data-action="folder-toggle" data-arg="${esc(f.path)}">
              <span class="tree__chevron" data-open="${open}">${icon("chevR")}</span>
              ${icon(open ? "folderOpen" : "folders", "tree__fic tree__fic--folder")}
              <span class="tree__name">${esc(f.name)}</span>
              <span class="tree__count num">${fileCount(f)}</span>
            </button>
            ${open ? `<div class="tree__children" role="group">${renderNode(f)}</div>` : ""}
          </div>`;
        }),
        ...files.map(fileRow),
      ].join("");
    };
    if (!docs.length) return `<div class="empty">${S.fileQuery.trim() ? "没有匹配的文件" : "拖放或导入文档"}</div>`;
    return renderNode(root);
  }

  const STATE_GLYPH = { untranslated: "○", draft: "✎", confirmed: "✓" };
  const STATE_LABEL = { untranslated: "未译", draft: "草稿", confirmed: "已确认" };

  function originChip(seg) {
    if (!seg.origin) return "";
    const o = seg.origin;
    if (o.kind === "ai") {
      return `<span class="origin origin--ai${o.edited ? " origin--muted" : ""}" data-tip="来源：AI · 模型：${esc(o.model || "")}${o.edited ? " · 已人工修改" : ""}">AI</span>`;
    }
    const grade = o.kind === "tmExact" ? "exact" : "fuzzy";
    return `<span class="origin origin--${grade}${o.edited ? " origin--muted" : ""}" data-tip="来源：TM ${grade === "exact" ? "精确" : "模糊"} · 分值：${o.score}${o.edited ? " · 已人工修改" : ""}">${o.score} TM</span>`;
  }

  function rGrid() {
    const doc = activeDoc();
    if (!doc) return `<div class="empty">选择或导入一个文档</div>`;
    const vis = visibleSegs();
    const all = counts(S.activeDocId);
    const dangerBySeg = {};
    for (const q of openIssues()) {
      if (!q.ruleId.startsWith("qa.tag-placeholder")) continue;
      dangerBySeg[q.segId] = dangerBySeg[q.segId] || { src: [], tgt: [] };
      dangerBySeg[q.segId].src.push(...q.evidence.source);
      dangerBySeg[q.segId].tgt.push(...q.evidence.target);
    }
    const rows = vis.map((seg) => {
      const active = seg.id === S.activeSegId;
      const editing = active && S.editing && !seg.locked;
      const issues = issuesOf(seg.id);
      const danger = dangerBySeg[seg.id];
      const bestHit = active ? segTm(seg.id)[0] : null;
      return `<tr data-seg="${seg.id}" data-active="${active}" data-state="${seg.state}" ${seg.locked ? 'data-locked="true"' : ""} ${issues.length ? 'data-qa="true"' : ""} tabindex="${active ? 0 : -1}" aria-selected="${active}">
        <td class="grid__n num">${seg.ordinal + 1}</td>
        <td class="grid__src" lang="en">${tokenHtml(seg.source, danger ? danger.src : null)}</td>
        <td class="grid__tgt" lang="zh-CN">${editing
          ? `<textarea data-refocus="editor" aria-label="句段 ${seg.ordinal + 1} 译文" rows="1">${esc(seg.target)}</textarea>`
          : `<span class="grid__text${seg.target ? "" : " grid__text--empty"}">${seg.target ? tokenHtml(seg.target, danger ? danger.tgt : null) : ""}</span>`}
        </td>
        <td class="grid__state">
          <span class="staterow">
            ${seg.locked ? `<span class="lockmark" data-tip="已锁定，编辑已停用">${icon("lock")}</span>` : ""}
            <span class="glyph glyph--${seg.state}" data-tip="${STATE_LABEL[seg.state]}${issues.length ? ` · ${issues.length} 个未解决 QA 问题` : ""}">
              ${STATE_GLYPH[seg.state]}${issues.length ? `<i class="glyph__qa">⚠${issues.length}</i>` : ""}
            </span>
            ${originChip(seg) || (bestHit ? `<span class="origin origin--${bestHit.grade} origin--live" data-tip="TM 最佳匹配 ${bestHit.score}%">${bestHit.score}%</span>` : "")}
            <span class="rowmenu">
              <button class="iconbtn rowmenu__btn" data-action="row-menu" data-arg="${seg.id}" aria-haspopup="menu" aria-expanded="${S.rowMenu === seg.id}" aria-label="句段 ${seg.ordinal + 1} 菜单">${icon("dots")}</button>
              ${S.rowMenu === seg.id ? `<div class="menu menu--row" role="menu">
                <button class="menu__item" role="menuitem" data-action="row-copy-src" data-arg="${seg.id}" ${seg.locked ? "disabled" : ""}>复制源文</button>
                <button class="menu__item" role="menuitem" data-action="row-clear" data-arg="${seg.id}" ${seg.locked || !seg.target ? "disabled" : ""}>清空译文</button>
                <button class="menu__item" role="menuitem" data-action="row-lock" data-arg="${seg.id}">${seg.locked ? "解锁" : "锁定"}</button>
              </div>` : ""}
            </span>
          </span>
        </td>
      </tr>`;
    }).join("");
    return `<div class="gridwrap">
      <div class="gridbar" role="toolbar" aria-label="筛选">
        ${S.chips.map((c) => `<button class="fchip" data-action="chip" data-arg="${c}" aria-label="清除筛选 ${CHIP_LABEL[c]}">${CHIP_LABEL[c]}<span class="fchip__x">×</span></button>`).join("")}
        ${S.query.trim() ? `<button class="fchip" data-action="query-clear" aria-label="清除文本筛选">“${esc(S.query.trim())}”<span class="fchip__x">×</span></button>` : ""}
        <span class="gridbar__spacer"></span>
        <span class="gridbar__count num" data-tip="可见句段 / 总句段">${vis.length}/${all.total}</span>
      </div>
      ${rFind()}
      ${vis.length === 0
        ? `<div class="empty">没有符合筛选条件的句段</div>`
        : `<div class="grid"><table>
            <thead><tr>
              <th class="grid__n">#</th>
              <th>源文 <span class="th__locale num">${D.project.sourceLocale}</span></th>
              <th>译文 <span class="th__locale num">${D.project.targetLocale}</span></th>
              <th class="grid__state">状态</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`}
    </div>`;
  }

  function rFind() {
    if (!S.findOpen) return "";
    const n = findMatches().length;
    const has = S.findQuery.trim().length > 0;
    return `<div class="find" role="dialog" aria-label="${S.findMode === "replace" ? "查找替换" : "查找"}">
      <button class="iconbtn find__toggle" data-action="find-mode" aria-expanded="${S.findMode === "replace"}" data-tip="${S.findMode === "replace" ? "收起替换" : "展开替换 Ctrl+H"}">${icon(S.findMode === "replace" ? "chevD" : "chevR")}</button>
      <div class="find__rows">
        <div class="find__row">
          <input data-refocus="find" data-input="findQuery" placeholder="查找" aria-label="查找" value="${esc(S.findQuery)}">
          <span class="find__count num" aria-label="匹配句段数">${has ? `${n} 段` : ""}</span>
          <button class="iconbtn" data-action="cmd" data-arg="find-prev" ${!has ? "disabled" : ""} data-tip="查找上一个 Shift+F4">${icon("chevU")}</button>
          <button class="iconbtn" data-action="cmd" data-arg="find-next" ${!has ? "disabled" : ""} data-tip="查找下一个 F4">${icon("chevD")}</button>
          <button class="iconbtn" data-action="find-close" data-tip="关闭 Esc">${icon("x")}</button>
        </div>
        ${S.findMode === "replace" ? `<div class="find__row">
          <input data-refocus="replace" data-input="replaceWith" placeholder="替换为" aria-label="替换为" value="${esc(S.replaceWith)}">
          <button class="btn btn--sm" data-action="find-replace" ${!has ? "disabled" : ""}>替换</button>
          <button class="btn btn--sm" data-action="find-replace-all" ${!has ? "disabled" : ""}>全部替换</button>
          <label class="find__check"><input type="checkbox" data-input="includeConfirmed" ${S.includeConfirmed ? "checked" : ""}>含已确认</label>
        </div>` : ""}
      </div>
    </div>`;
  }

  function rTabs() {
    if (!S.openDocIds.length) return "";
    return `<div class="tabs" role="tablist" aria-label="打开的文档">
      ${S.openDocIds.map((id) => {
        const d = S.documents.find((x) => x.id === id);
        if (!d) return "";
        return `<span class="tabs__tab" data-active="${id === S.activeDocId}">
          <button class="tabs__name" role="tab" aria-selected="${id === S.activeDocId}" data-action="cmd" data-arg="open-doc:${id}">${esc(d.name)}</button>
          <button class="tabs__close" data-action="tab-close" data-arg="${id}" aria-label="关闭标签页 ${esc(d.name)}">${icon("x")}</button>
        </span>`;
      }).join("")}
    </div>`;
  }

  function rPreview() {
    const doc = activeDoc();
    if (!doc) return "";
    const segs = segsOf(S.activeDocId);
    const translated = segs.filter((s) => s.target.trim()).length;
    const blocks = [];
    for (let i = 0; i < segs.length; i += 3) blocks.push(segs.slice(i, i + 3));
    return `<section class="preview" data-open="${S.previewOpen}">
      <header class="preview__bar">
        <span class="preview__title">预览</span>
        ${S.previewOpen ? `<div class="preview__tabs" role="tablist">
          <button role="tab" aria-selected="${S.previewMode === "proofread"}" data-active="${S.previewMode === "proofread"}" data-action="preview-mode" data-arg="proofread">校对视图</button>
          <button role="tab" aria-selected="${S.previewMode === "layout"}" data-active="${S.previewMode === "layout"}" data-action="preview-mode" data-arg="layout" ${doc.format === "docx" ? "" : "disabled"}>版式视图（DOCX）</button>
        </div>` : ""}
        <span class="preview__spacer"></span>
        ${S.previewOpen && S.previewMode === "proofread" ? `<span class="preview__legend">
          <span class="badge badge--ok">已确认</span><span class="badge badge--accent">草稿</span><span class="badge badge--warn">未译</span>
        </span>` : ""}
        <button class="iconbtn" data-action="cmd" data-arg="preview" aria-expanded="${S.previewOpen}" data-tip="${S.previewOpen ? "折叠预览 Ctrl+P" : "展开预览 Ctrl+P"}">${icon(S.previewOpen ? "chevD" : "chevU")}</button>
      </header>
      ${S.previewOpen ? `<div class="preview__body">
        ${S.previewMode === "proofread" ? `
          <p class="preview__summary">共 ${segs.length} 个句段：${translated} 个已有译文${segs.length - translated ? `，${segs.length - translated} 个未译` : ""}</p>
          <div class="preview__doc">
            ${blocks.map((block) => `<p class="preview__block">${block.map((s) =>
              `<button class="pseg" data-state="${s.state}" data-fallback="${!s.target.trim()}" data-active="${s.id === S.activeSegId}" data-action="jump" data-arg="${s.id}" data-tip="句段 #${s.ordinal + 1}${s.target.trim() ? "" : "（未译）"}">${esc(s.target.trim() || s.source)}</button>`).join("")}</p>`).join("")}
          </div>` : `
          <p class="preview__summary">已回填 ${translated} 个已译单元 · 点击段落跳转句段</p>
          <div class="preview__page">
            <p class="preview__pagetitle">Relay User Guide</p>
            ${blocks.map((block) => `<p class="preview__para">${block.map((s) =>
              `<button class="pseg pseg--layout" data-action="jump" data-arg="${s.id}" data-active="${s.id === S.activeSegId}">${esc(s.target.trim() || s.source)}</button>`).join(" ")}</p>`).join("")}
          </div>`}
      </div>` : ""}
    </section>`;
  }

  /* ---------- render: docks ---------- */

  function rDock() {
    const best = segTm(S.activeSegId)[0];
    const qaOpen = openIssues().length;
    const tabs = [
      ["memory", "记忆", "db", best ? `<span class="dtab__chip dtab__chip--${best.grade === "exact" ? "ok" : "accent"}">${best.score}%</span>` : ""],
      ["term", "术语", "book", ""],
      ["qa", "QA", "clip", qaOpen ? `<span class="dtab__chip dtab__chip--danger">${qaOpen}</span>` : ""],
      ["ai", "AI", "spark", ""],
    ];
    return `<aside class="dock">
      <nav class="dtabs" role="tablist" aria-label="资源面板">
        ${tabs.map(([id, label, ic, chip]) =>
          `<button class="dtab" role="tab" data-active="${S.dock === id}" aria-selected="${S.dock === id}" data-action="cmd" data-arg="dock-${id}" data-tip="${label}面板 Ctrl+${tabs.findIndex((t) => t[0] === id) + 1}">${icon(ic)}<span>${label}</span>${chip}</button>`).join("")}
      </nav>
      <div class="dock__panel">
        ${S.dock === "memory" ? rDockMemory() : ""}
        ${S.dock === "term" ? rDockTerm() : ""}
        ${S.dock === "qa" ? rDockQa() : ""}
        ${S.dock === "ai" ? rDockAi() : ""}
      </div>
    </aside>`;
  }

  function rDockMemory() {
    const seg = activeSeg();
    const hits = seg ? segTm(seg.id) : [];
    const cq = S.concordance.trim();
    const docHits = cq
      ? segsOf(S.activeDocId).flatMap((s) => {
          const out = [];
          if (s.source.toLowerCase().includes(cq.toLowerCase())) out.push({ seg: s, field: "source", text: s.source });
          if (s.target && s.target.toLowerCase().includes(cq.toLowerCase())) out.push({ seg: s, field: "target", text: s.target });
          return out;
        })
      : [];
    const mark = (text) => {
      if (!cq) return esc(text);
      const i = text.toLowerCase().indexOf(cq.toLowerCase());
      if (i < 0) return esc(text);
      return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + cq.length))}</mark>${esc(text.slice(i + cq.length))}`;
    };
    return `<div class="panel">
      <header class="panel__head"><h3>翻译记忆</h3>${hits[0] ? `<span class="badge badge--${hits[0].grade === "exact" ? "ok" : "accent"}">${hits[0].score}%</span>` : ""}</header>
      ${!seg ? `<div class="empty">未选中句段</div>` : hits.length === 0 ? `<div class="empty">无匹配</div>` : `
        <div class="stack">
          ${hits.map((h, i) => `<article class="card${i === 0 ? " card--best" : ""}" data-action="tm-apply" data-arg="${i}" data-tip="双击或点应用 · 编辑器内 Ctrl+${i + 1}">
            <div class="card__row">
              <span class="card__meta">
                <span class="score score--${h.grade}">${h.score}%</span>
                <span class="card__grade">${h.grade === "exact" ? "精确" : "模糊"}</span>
                <span class="card__mem" data-tip="来源记忆库">${esc(h.memory)}</span>
              </span>
              <button class="btn btn--sm btn--outline" data-action="tm-apply" data-arg="${i}">应用为草稿</button>
            </div>
            <p class="card__text" lang="zh-CN">${esc(h.target)}</p>
            <p class="card__origin" lang="en">源：${esc(h.source)}</p>
          </article>`).join("")}
        </div>`}
      <header class="panel__head panel__head--sub"><h3>检索</h3>${cq ? `<span class="badge badge--accent">${docHits.length} 命中</span>` : ""}</header>
      <span class="field"><label>检索词</label><input data-refocus="concordance" data-input="concordance" value="${esc(S.concordance)}" placeholder="F3 取选中文本"></span>
      ${!cq ? `<div class="empty">输入检索词</div>` : docHits.length === 0 ? `<div class="empty">文档内无命中</div>` : `
        <div class="stack">
          ${docHits.map((h) => `<article class="card">
            <div class="card__row">
              <span class="card__meta"><span class="badge badge--${h.field === "source" ? "neutral" : "accent"}">${h.field === "source" ? "源文" : "译文"}</span><span class="num">#${h.seg.ordinal + 1}</span></span>
              <button class="btn btn--sm btn--ghost" data-action="jump" data-arg="${h.seg.id}">定位句段</button>
            </div>
            <p class="card__text">${mark(h.text)}</p>
          </article>`).join("")}
        </div>`}
    </div>`;
  }

  function rDockTerm() {
    const seg = activeSeg();
    const hits = seg ? segTerms(seg.id) : [];
    return `<div class="panel">
      <header class="panel__head"><h3>术语</h3><span class="badge badge--ok">1 个术语库</span></header>
      ${!seg ? `<div class="empty">未选中句段</div>` : hits.length === 0 ? `<div class="empty">当前句段无术语命中</div>` : `
        <div class="stack">
          ${hits.map((h) => `<article class="card">
            <p class="card__text" lang="en">${esc(h.source)}</p>
            ${h.translations.map((t) => `<div class="card__row">
              <span class="termline">${esc(t.term)}${t.forbidden ? `<span class="badge badge--danger">禁用</span>` : t.preferred ? `<span class="badge badge--ok">首选</span>` : ""}</span>
              <button class="btn btn--sm btn--outline" data-action="term-insert" data-arg="${esc(t.term)}" ${t.forbidden ? "disabled" : ""}>插入</button>
            </div>`).join("")}
          </article>`).join("")}
        </div>`}
      <header class="panel__head panel__head--sub"><h3>快速添加</h3></header>
      <form class="formstack" data-form="term-add" aria-label="快速添加术语">
        <span class="field"><label>源术语</label><input name="src" required></span>
        <span class="field"><label>目标术语</label><input name="tgt" required></span>
        <button class="btn btn--sm btn--outline" type="submit">添加术语</button>
      </form>
    </div>`;
  }

  const SEV = { error: ["⛔", "错误"], warning: ["⚠", "警告"], info: ["ⓘ", "提示"] };
  const QA_STATUS = { open: ["未解决", "danger"], waived: ["已忽略", "warn"], resolved: ["已解决", "ok"] };

  function rDockQa() {
    const all = S.qaIssues.filter((q) => q.docId === S.activeDocId);
    const open = all.filter((q) => q.status === "open");
    const groups = new Map();
    const rank = { error: 0, warning: 1, info: 2 };
    for (const q of [...open].sort((a, b) => rank[a.severity] - rank[b.severity])) {
      (groups.get(q.ruleId) || groups.set(q.ruleId, []).get(q.ruleId)).push(q);
    }
    const rest = all.filter((q) => q.status !== "open");
    const issueCard = (q, groupSize) => {
      const seg = segsOf(q.docId).find((s) => s.id === q.segId);
      const sameSeg = open.filter((x) => x.segId === q.segId).length;
      const [glyph, sevLabel] = SEV[q.severity];
      const [stLabel, stTone] = QA_STATUS[q.status];
      return `<article class="issue" data-status="${q.status}">
        <div class="issue__head">
          <span class="issue__meta">
            <span class="sev sev--${q.severity}" data-tip="${sevLabel}">${glyph}</span>
            <span class="badge badge--${stTone}">${stLabel}</span>
            <span class="issue__rule">${q.ruleId}</span>
          </span>
          <span class="issue__actions">
            ${q.status === "open" ? `<button class="btn btn--sm btn--ghost" data-action="qa-waive" data-arg="${q.id}">忽略</button>` : ""}
            ${q.status === "open" && groupSize > 1 ? `<button class="btn btn--sm btn--ghost" data-action="qa-waive-rule" data-arg="${q.ruleId}">忽略同类</button>` : ""}
            ${q.status === "open" && sameSeg > 1 ? `<button class="btn btn--sm btn--ghost" data-action="qa-waive-seg" data-arg="${q.segId}">忽略本句</button>` : ""}
            ${q.status === "waived" ? `<button class="btn btn--sm btn--ghost" data-action="qa-restore" data-arg="${q.id}">恢复</button>` : ""}
            <button class="btn btn--sm btn--ghost" data-action="jump" data-arg="${q.segId}">定位句段</button>
          </span>
        </div>
        <p class="issue__msg">句段 #${seg ? seg.ordinal + 1 : "?"}：${esc(q.message)}</p>
        ${q.evidence.source.length || q.evidence.target.length
          ? `<p class="issue__evidence num">源 [${q.evidence.source.join(", ")}] ≠ 译 [${q.evidence.target.join(", ")}]</p>` : ""}
        ${q.fix && q.status === "open" ? `<div class="issue__fix">
            <span class="issue__fixtext">修复为：${esc(q.fix.text)}</span>
            <button class="btn btn--sm btn--outline" data-action="qa-fix" data-arg="${q.id}" data-tip="${esc(q.fix.label)}">应用修复</button>
          </div>` : ""}
      </article>`;
    };
    return `<div class="panel">
      <header class="panel__head"><h3>质量检查（未解决 ${open.length}）</h3>
        <button class="btn btn--sm btn--primary" data-action="cmd" data-arg="run-qa">运行 QA</button>
      </header>
      ${all.length === 0 ? `<div class="empty">尚未运行检查</div>` : `
        <div class="stack">
          ${[...groups.entries()].map(([ruleId, list]) => `
            <section class="issuegroup" aria-label="${ruleId} 未解决 ${list.length} 项">
              <div class="issuegroup__head"><span class="issue__rule">${ruleId}</span><span class="issuegroup__count num">${list.length}</span></div>
              ${list.map((q) => issueCard(q, list.length)).join("")}
            </section>`).join("")}
          ${rest.map((q) => issueCard(q, 0)).join("")}
        </div>`}
    </div>`;
  }

  function rDockAi() {
    const seg = activeSeg();
    const cand = S.aiCandidate && seg && S.aiCandidate.segId === seg.id ? S.aiCandidate : null;
    let diffHtml = "";
    if (cand && cand.base && cand.base.trim()) {
      const a = cand.base, b = cand.text;
      let p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
      let sA = a.length, sB = b.length;
      while (sA > p && sB > p && a[sA - 1] === b[sB - 1]) { sA -= 1; sB -= 1; }
      diffHtml = `<p class="ai__diff" aria-label="候选与当前译文的差异">${esc(a.slice(0, p))}<del>${esc(a.slice(p, sA))}</del><ins>${esc(b.slice(p, sB))}</ins>${esc(a.slice(sA))}</p>`;
    }
    const run = S.agentRun;
    const RUN_LABEL = { running: ["运行中", "neutral"], awaitingReview: ["等待人工审核", "warn"], canceled: ["已取消", "neutral"], failed: ["失败", "danger"] };
    return `<div class="panel">
      <header class="panel__head"><h3>AI 辅助</h3>
        ${S.aiConfigured ? `<span class="badge badge--ok">${esc(S.aiProvider)} · ${esc(S.aiModel)}</span>` : `<span class="badge badge--warn">未配置</span>`}
      </header>
      ${S.aiConfigured ? `
        ${!seg ? `<div class="empty">未选中句段</div>` : seg.state === "confirmed" ? `<div class="note">该句段已确认</div>` : `
          <div class="btnrow">
            <button class="btn btn--sm btn--primary" data-action="ai-translate" ${S.aiBusy ? "disabled" : ""}>AI 翻译</button>
            <button class="btn btn--sm btn--outline" data-action="ai-refine" ${S.aiBusy || !seg.target.trim() ? "disabled" : ""}>AI 润色</button>
            ${S.aiBusy ? `<button class="btn btn--sm btn--ghost" data-action="ai-cancel">取消请求</button>` : ""}
          </div>`}
        ${cand ? `<div class="ai__cand">
          <div class="card__row"><span class="card__meta">
            <span class="badge badge--neutral">${cand.action === "translate" ? "翻译候选" : "润色候选"}</span>
            <span class="badge badge--${cand.tagOk ? "ok" : "danger"}">${cand.tagOk ? "标签完整" : "标签破损"}</span>
          </span></div>
          <p class="card__text">${tokenHtml(cand.text)}</p>
          ${diffHtml}
          <div class="btnrow">
            <button class="btn btn--sm btn--primary" data-action="ai-apply" ${cand.tagOk ? "" : "disabled"}>应用为草稿</button>
            <button class="btn btn--sm btn--ghost" data-action="ai-reject">拒绝</button>
          </div>
        </div>` : ""}` : `
        <form class="formstack" data-form="ai-configure" aria-label="配置 AI 供应商">
          <span class="field"><label>供应商</label><select name="provider">${D.providers.map((p) => `<option${p === S.aiProvider ? " selected" : ""}>${p}</option>`).join("")}</select></span>
          <span class="field"><label>模型</label><input name="model" required placeholder="gpt-5.2"></span>
          <span class="field"><label>Base URL</label><input name="baseUrl" placeholder="可留空"></span>
          <span class="field"><label>API Key</label><input name="apiKey" type="password" required></span>
          <button class="btn btn--sm btn--primary" type="submit">保存配置</button>
        </form>`}
      <header class="panel__head panel__head--sub"><h3>Agent 模式</h3>
        ${run ? `<span class="badge badge--${RUN_LABEL[run.status][1]}">${RUN_LABEL[run.status][0]}</span>` : ""}
      </header>
      ${!S.aiConfigured ? `<div class="note">未配置 AI 供应商</div>` : ""}
      <span class="field"><label>任务指令（可选）</label><textarea data-input="agentInstruction" rows="2" ${!S.aiConfigured ? "disabled" : ""}>${esc(S.agentInstruction)}</textarea></span>
      <div class="btnrow">
        <button class="btn btn--sm btn--primary" data-action="agent-start" ${!S.aiConfigured || (run && run.status === "running") ? "disabled" : ""}>${run && run.status === "running" ? "运行中…" : "创建任务单并运行"}</button>
        ${run && run.status === "running" ? `<button class="btn btn--sm btn--outline" data-action="agent-cancel">取消运行</button>` : ""}
      </div>
      ${run ? `<div class="agent__summary num">
        <span>计划 ${run.planned}</span><span>TM ${run.tm}</span><span>AI 草稿 ${run.ai}</span><span>失败 ${run.failed}</span><span>QA 未解决 ${run.qaOpen}</span>
      </div>` : `<div class="empty">尚未运行</div>`}
      ${run && run.status === "awaitingReview" ? `<div class="agent__gate" role="group" aria-label="人工审核">
        <button class="btn btn--sm btn--primary" data-action="agent-review">去工作台查看草稿</button>
        <button class="btn btn--sm btn--outline" data-action="cmd" data-arg="export">去导出…</button>
      </div>` : ""}
      ${run && run.steps.length ? `<div class="stack">
        ${run.steps.map((st) => `<article class="step">
          <div class="step__meta"><span class="badge badge--${st.status === "done" ? "ok" : st.status === "failed" ? "danger" : "neutral"}">${st.kind}</span><span class="num">#${st.index}</span></div>
          <p class="step__detail">${esc(st.detail)}</p>
        </article>`).join("")}
      </div>` : ""}
    </div>`;
  }

  /* ---------- render: dialogs ---------- */

  function dialogShell(title, body, footer, opts = {}) {
    return `<div class="overlay" data-action="${opts.locked ? "" : "dialog-backdrop"}">
      <div class="dialog${opts.wide ? " dialog--wide" : ""}" role="${opts.alert ? "alertdialog" : "dialog"}" aria-modal="true" aria-label="${esc(title)}">
        <header class="dialog__head"><h2>${esc(title)}</h2>
          ${opts.locked ? "" : `<button class="iconbtn" data-action="dialog-close" aria-label="关闭" data-tip="关闭 Esc">${icon("x")}</button>`}
        </header>
        <div class="dialog__body">${body}</div>
        ${footer ? `<footer class="dialog__foot">${footer}</footer>` : ""}
      </div>
    </div>`;
  }

  function rDialog() {
    const d = S.dialog;
    if (S.engine !== "ready") {
      return `<div class="overlay overlay--gate">
        <div class="gate" role="alertdialog" aria-modal="true" aria-label="翻译引擎已停止">
          <p class="gate__title"><span class="dot dot--down"></span>翻译引擎已停止</p>
          <p class="gate__body">编辑已锁定</p>
          <p class="gate__err num">engine exited with code 137 (out of memory)</p>
          <button class="btn btn--primary" data-action="cmd" data-arg="engine-up">重新启动引擎</button>
        </div>
      </div>`;
    }
    if (!d) return "";
    if (d.kind === "newProject") {
      return dialogShell("新建项目", `
        <form class="formstack" data-form="new-project">
          <span class="field"><label>项目名称</label><input name="name" required value="${esc(d.name || "")}" data-refocus="np-name"></span>
          <div class="fieldrow">
            <span class="field"><label>源语言</label><input name="src" required value="${esc(d.src)}"></span>
            <span class="field"><label>目标语言</label><input name="tgt" required value="${esc(d.tgt)}"></span>
          </div>
        </form>`,
        `<button class="btn btn--outline" data-action="dialog-close">取消</button>
         <button class="btn btn--primary" data-action="np-create">创建项目</button>`);
    }
    if (d.kind === "import") {
      return dialogShell("导入文档", `
        <div class="formstack">
          <div class="fieldrow fieldrow--center">
            <button class="btn btn--sm btn--outline" data-action="import-pick">选择文件…</button>
            <span class="pathnote">${d.path ? esc(d.path) : "未选择文件"}</span>
          </div>
          <span class="field"><label>分段方式</label>
            <select data-input="dialog.segmentation">
              <option value="sentence"${d.segmentation === "sentence" ? " selected" : ""}>句子（SRX 规则）</option>
              <option value="paragraph"${d.segmentation === "paragraph" ? " selected" : ""}>段落</option>
            </select>
          </span>
          <div class="fieldrow fieldrow--center">
            <button class="btn btn--sm btn--outline" data-action="import-srx" ${d.segmentation !== "sentence" ? "disabled" : ""}>选择 SRX 规则…</button>
            <span class="pathnote">${d.srx ? esc(d.srx) : `内置规则（${D.project.sourceLocale}）`}</span>
            ${d.srx ? `<button class="btn btn--sm btn--ghost" data-action="import-srx-clear">清除</button>` : ""}
          </div>
        </div>`,
        `<button class="btn btn--outline" data-action="dialog-close">取消</button>
         <button class="btn btn--primary" data-action="import-run" ${d.path ? "" : "disabled"}>导入</button>`);
    }
    if (d.kind === "settings") {
      const proj = S.projects[0] || D.project;
      return dialogShell(`项目设置：${proj.name}`, `
        <div class="settings">
          <section class="set__sec"><h3>项目信息</h3>
            <div class="fieldrow">
              <span class="field"><label>项目名称</label><input value="${esc(proj.name)}"></span>
              <span class="field"><label>源语言</label><input value="${proj.sourceLocale}"></span>
              <span class="field"><label>目标语言</label><input value="${proj.targetLocale}"></span>
            </div>
            <button class="btn btn--sm btn--primary" data-action="set-save-info">保存项目信息</button>
          </section>
          <section class="set__sec"><h3>导入默认</h3>
            <div class="fieldrow fieldrow--center">
              <span class="field"><label>默认分段方式</label>
                <select><option selected>句子（SRX 规则）</option><option>段落</option></select>
              </span>
              <button class="btn btn--sm btn--outline" data-action="noop">选择默认 SRX 规则…</button>
              <span class="pathnote">内置规则（${D.project.sourceLocale}）</span>
              <button class="btn btn--sm btn--primary" data-action="set-save-defaults">保存导入默认</button>
            </div>
          </section>
          <section class="set__sec"><h3>质量检查</h3>
            <label class="checkrow"><input type="checkbox" data-input="blockExportOnError" ${S.blockExportOnError ? "checked" : ""}>有错误时阻止导出</label>
          </section>
          <section class="set__sec"><h3>生命周期</h3>
            <div class="fieldrow fieldrow--center">
              <span class="badge badge--${S.archived ? "neutral" : "ok"}">${S.archived ? "已归档" : "进行中"}</span>
              <button class="btn btn--sm btn--outline" data-action="cmd" data-arg="archive">${S.archived ? "恢复项目" : "归档项目"}</button>
            </div>
          </section>
          <section class="set__sec"><h3>翻译记忆</h3>
            <div class="fieldrow fieldrow--center">
              <span class="field"><label>记忆库</label>
                <select>${S.memories.filter((m) => m.mounted).map((m) => `<option>${esc(m.name)}${m.writable ? "（可写）" : ""}</option>`).join("")}</select>
              </span>
              <button class="btn btn--sm btn--outline" data-action="set-tm-import">导入外部 TM…</button>
              <button class="btn btn--sm btn--outline" data-action="set-tm-export">导出 TM…</button>
            </div>
          </section>
          <section class="set__sec"><h3>术语库</h3>
            ${S.termbases.filter((t) => t.mounted).map((t) => `
              <div class="fieldrow fieldrow--center">
                <span class="tbname">${esc(t.name)}</span><span class="badge badge--ok">已挂载</span>
                <button class="btn btn--sm btn--outline" data-action="cmd" data-arg="term-manage">管理术语</button>
                <button class="btn btn--sm btn--outline" data-action="set-tb-import" data-arg="${t.id}">导入 CSV/TBX…</button>
                <button class="btn btn--sm btn--outline" data-action="set-tb-export" data-arg="${t.id}">导出…</button>
                <button class="btn btn--sm btn--outline" data-action="set-tb-detach" data-arg="${t.id}">卸载</button>
              </div>`).join("")}
            ${S.termbases.filter((t) => !t.mounted).map((t) => `
              <div class="fieldrow fieldrow--center">
                <span class="tbname">${esc(t.name)}</span>
                <button class="btn btn--sm btn--outline" data-action="set-tb-attach" data-arg="${t.id}">挂载</button>
              </div>`).join("")}
            <div class="fieldrow fieldrow--center">
              <span class="field"><label>新术语库名称</label><input data-refocus="new-tb"></span>
              <button class="btn btn--sm btn--outline" data-action="set-tb-create">新建并挂载</button>
            </div>
          </section>
        </div>`,
        `<button class="btn btn--outline" data-action="dialog-close">关闭</button>`, { wide: true });
    }
    if (d.kind === "tmManage") {
      const PAGE = 8;
      const pages = Math.max(1, Math.ceil(S.tmEntries.length / PAGE));
      const page = Math.min(S.tmPage, pages - 1);
      const slice = S.tmEntries.slice(page * PAGE, page * PAGE + PAGE);
      return dialogShell(`记忆库管理：${D.project.name}`, `
        <div class="tmm">
          <section class="set__sec"><h3>挂载的记忆库</h3>
            ${S.memories.filter((m) => m.mounted).map((m, i, arr) => `
              <div class="fieldrow fieldrow--center tmm__mount">
                <span class="tbname">${esc(m.name)}</span>
                <span class="badge badge--${m.writable ? "ok" : "neutral"}">${m.writable ? "可写" : "只读"}</span>
                ${m.enabled ? "" : `<span class="badge badge--warn">已停用</span>`}
                ${m.pair !== "en-US → zh-CN" ? `<span class="badge badge--warn">语言对 ${m.pair}</span>` : ""}
                <span class="tmm__actions">
                  <button class="btn btn--sm btn--ghost" data-action="tmm-move" data-arg="${m.id}:-1" ${i === 0 ? "disabled" : ""}>上移</button>
                  <button class="btn btn--sm btn--ghost" data-action="tmm-move" data-arg="${m.id}:1" ${i === arr.length - 1 ? "disabled" : ""}>下移</button>
                  <button class="btn btn--sm btn--outline" data-action="tmm-toggle" data-arg="${m.id}">${m.enabled ? "停用" : "启用"}</button>
                  ${m.writable ? "" : `<button class="btn btn--sm btn--outline" data-action="tmm-writable" data-arg="${m.id}">设为可写</button>`}
                  <button class="btn btn--sm btn--outline" data-action="tmm-rename" data-arg="${m.id}">重命名</button>
                  <button class="btn btn--sm btn--outline" data-action="tmm-detach" data-arg="${m.id}">卸载</button>
                </span>
              </div>`).join("")}
            <div class="fieldrow fieldrow--center">
              <span class="field"><label>挂载已有记忆库</label>
                <select data-input="tmm.attachChoice">${S.memories.filter((m) => !m.mounted).map((m) => `<option value="${m.id}">${esc(m.name)}（${m.pair}）</option>`).join("") || "<option value=''>（无）</option>"}</select>
              </span>
              <button class="btn btn--sm btn--outline" data-action="tmm-attach">挂载</button>
              <button class="btn btn--sm btn--outline" data-action="tmm-delete-arm">删除</button>
              ${S.tmDeleteId ? `<span class="confirmrow">确认删除记忆库「${esc((S.memories.find((m) => m.id === S.tmDeleteId) || {}).name || "")}」？其余 90 条条目将保留
                <button class="btn btn--sm btn--danger" data-action="tmm-delete">连同条目删除</button>
                <button class="btn btn--sm btn--ghost" data-action="tmm-delete-cancel">取消</button></span>` : ""}
            </div>
            <div class="fieldrow fieldrow--center">
              <span class="field"><label>新建记忆库</label><input data-refocus="tmm-new" placeholder="记忆库名称"></span>
              <button class="btn btn--sm btn--outline" data-action="tmm-create">新建并挂载</button>
            </div>
          </section>
          <section class="set__sec"><h3>条目</h3>
            <div class="fieldrow fieldrow--center">
              <span class="field"><label>记忆库</label><select>${S.memories.filter((m) => m.mounted).map((m) => `<option>${esc(m.name)}</option>`).join("")}</select></span>
              <span class="field"><label>搜索源文或译文</label><input data-refocus="tmm-q"></span>
              <button class="btn btn--sm btn--outline" data-action="noop">搜索</button>
            </div>
            <p class="pathnote">记忆库「主工作记忆」共 ${S.tmEntries.length} 条</p>
            <div class="stack">
              ${slice.map((e) => S.tmEditId === e.id ? `
                <article class="card">
                  <span class="field"><label>源文</label><textarea data-refocus="tmm-es" rows="2" data-input="tmm.editSource">${esc(e.source)}</textarea></span>
                  <span class="field"><label>译文</label><textarea rows="2" data-input="tmm.editTarget">${esc(e.target)}</textarea></span>
                  <div class="btnrow">
                    <button class="btn btn--sm btn--primary" data-action="tmm-save" data-arg="${e.id}">保存</button>
                    <button class="btn btn--sm btn--ghost" data-action="tmm-edit-cancel">取消</button>
                  </div>
                </article>` : `
                <article class="card">
                  <p class="card__origin" lang="en">源：${esc(e.source)}</p>
                  <p class="card__text" lang="zh-CN">${esc(e.target)}</p>
                  <div class="btnrow">
                    ${S.tmDeleteId === "e:" + e.id ? `
                      <span class="confirmrow">确认删除该条目？
                        <button class="btn btn--sm btn--danger" data-action="tmm-entry-delete" data-arg="${e.id}">确认删除</button>
                        <button class="btn btn--sm btn--ghost" data-action="tmm-delete-cancel">取消</button></span>` : `
                      <button class="btn btn--sm btn--outline" data-action="tmm-edit" data-arg="${e.id}">编辑</button>
                      <button class="btn btn--sm btn--outline" data-action="tmm-entry-delete-arm" data-arg="${e.id}">删除</button>`}
                  </div>
                </article>`).join("")}
            </div>
            <div class="pager">
              <button class="btn btn--sm btn--ghost" data-action="tmm-page" data-arg="-1" ${page === 0 ? "disabled" : ""}>上一页</button>
              <span class="num">第 ${page + 1} / ${pages} 页</span>
              <button class="btn btn--sm btn--ghost" data-action="tmm-page" data-arg="1" ${page >= pages - 1 ? "disabled" : ""}>下一页</button>
            </div>
          </section>
        </div>`,
        `<button class="btn btn--outline" data-action="dialog-close">关闭</button>`, { wide: true });
    }
    if (d.kind === "termManage") {
      const tb = S.termbases[0];
      return dialogShell(`术语库管理：${tb.name}`, `
        <div class="fieldrow fieldrow--center"><span class="badge badge--neutral">${tb.entries.length} 条术语</span><span class="badge badge--ok">可写</span></div>
        <div class="stack">
          ${tb.entries.map((e) => `<article class="card">
            <div class="card__row">
              <span class="card__text" lang="en">${esc(e.source)}</span>
              ${S.termDeleteId === e.id ? `
                <span class="confirmrow">确认删除术语？
                  <button class="btn btn--sm btn--danger" data-action="term-delete" data-arg="${e.id}">确认删除</button>
                  <button class="btn btn--sm btn--ghost" data-action="term-delete-cancel">取消</button></span>` : `
                <button class="btn btn--sm btn--outline" data-action="term-delete-arm" data-arg="${e.id}">删除</button>`}
            </div>
            ${e.translations.map((t) => `<div class="card__row">
              <span class="termline">${esc(t.term)}${t.forbidden ? `<span class="badge badge--danger">禁用</span>` : t.preferred ? `<span class="badge badge--ok">首选</span>` : ""}</span>
              <button class="btn btn--sm btn--outline" data-action="term-edit" data-arg="${e.id}:${t.id}">编辑</button>
            </div>`).join("")}
            ${S.termEditId === e.id ? `
              <form class="formstack" data-form="term-save" data-arg="${e.id}">
                <div class="fieldrow">
                  <span class="field"><label>源术语</label><input name="src" value="${esc(e.source)}" data-refocus="term-src" required></span>
                  <span class="field"><label>目标术语</label><input name="tgt" value="${esc(e.translations[0] ? e.translations[0].term : "")}" required></span>
                </div>
                <div class="btnrow">
                  <button class="btn btn--sm btn--primary" type="submit">保存修改</button>
                  <button class="btn btn--sm btn--ghost" data-action="term-edit-cancel">取消</button>
                </div>
              </form>` : ""}
          </article>`).join("")}
        </div>`,
        `<button class="btn btn--outline" data-action="dialog-close">关闭</button>`, { wide: true });
    }
    if (d.kind === "exportOverwrite") {
      return dialogShell("导出覆盖确认", `
        <p class="dialog__lead">目标已存在，要覆盖吗？</p>
        <p class="pathnote num">${esc(d.path)}</p>`,
        `<button class="btn btn--outline" data-action="export-cancel">取消</button>
         <button class="btn btn--danger" data-action="export-overwrite">覆盖</button>`, { alert: true });
    }
    if (d.kind === "exportQaGate") {
      return dialogShell("导出被 QA 拦截", `
        <p class="dialog__lead">存在 QA 错误，仍要导出吗？</p>
        <p class="pathnote">${d.openErrors} 个错误未解决：<span class="num">${d.rules.join("、")}</span></p>
        <p class="pathnote">项目设置勾选了「有错误时阻止导出」。可先在 QA 面板修复或忽略。</p>`,
        `<button class="btn btn--outline" data-action="export-cancel">取消</button>
         <button class="btn btn--ghost" data-action="export-goto-qa">查看 QA 面板</button>
         <button class="btn btn--danger" data-action="export-override">仍要导出</button>`, { alert: true });
    }
    return "";
  }

  function rPalette() {
    if (!S.paletteOpen) return "";
    const items = paletteModel();
    const sel = Math.min(S.paletteSel, Math.max(0, items.length - 1));
    return `<div class="overlay overlay--palette" data-action="palette-backdrop">
      <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <input class="palette__input" data-refocus="palette" data-input="paletteQuery" placeholder="输入命令名称" aria-label="搜索命令" value="${esc(S.paletteQuery)}">
        <div class="palette__list" role="listbox">
          ${items.length === 0 ? `<p class="empty">没有匹配的命令</p>` : items.map((it, i) => `
            <button class="palette__item" role="option" data-selected="${i === sel}" aria-selected="${i === sel}" ${it.enabled ? "" : 'aria-disabled="true" disabled'} data-action="palette-run" data-arg="${it.cmd}" data-idx="${i}">
              <span>${hlPalette(it.label)}</span>${kbd(it.key)}
            </button>`).join("")}
        </div>
      </div>
    </div>`;
  }

  function hlPalette(label) {
    const q = S.paletteQuery.trim();
    if (!q) return esc(label);
    const i = label.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(label);
    return `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, i + q.length))}</mark>${esc(label.slice(i + q.length))}`;
  }

  function rStatusbar() {
    if (S.view !== "workbench") {
      return `<footer class="statusbar">
        <span class="statusbar__msg">${esc(S.status)}</span>
        <span class="statusbar__stats">
          <span class="statusbar__engine"><span class="dot dot--${S.engine === "ready" ? "ok" : "down"}"></span><span class="num">engine 0.9.4 · pid 21437</span></span>
        </span>
      </footer>`;
    }
    const c = counts(S.activeDocId);
    const seg = activeSeg();
    const doc = activeDoc();
    const pct = c.total ? Math.round((c.confirmed / c.total) * 100) : 0;
    return `<footer class="statusbar">
      <span class="statusbar__msg" role="status">${esc(S.status)}</span>
      <span class="statusbar__stats">
        <span class="stat" data-tip="当前句段 / 总句段">句段 <span class="num">${seg ? `${seg.ordinal + 1}/${c.total}` : c.total}</span></span>
        <span class="stat" data-tip="已确认句段">已确认 <span class="num">${c.confirmed}</span></span>
        ${c.draft ? `<button class="stat stat--jump" data-action="stat-draft" data-tip="筛选草稿句段">草稿 <span class="num">${c.draft}</span></button>` : ""}
        <span class="stat" data-tip="未译句段">剩余 <span class="num">${c.untranslated}</span></span>
        ${doc ? `<span class="stat" data-tip="源文词数 · CJK 按字">字数 <span class="num">${doc.sourceWords}</span></span>` : ""}
        ${c.openIssues ? `<button class="stat stat--jump stat--danger" data-action="stat-qa" data-tip="筛选 QA 问题句段">QA <span class="num">${c.openIssues}</span></button>` : ""}
        <span class="stat statusbar__progress"><span class="bar"><span class="bar__ok" style="width:${pct}%"></span><span class="bar__draft" style="width:${c.total ? (c.draft / c.total) * 100 : 0}%"></span></span><span class="num">${pct}%</span></span>
        <span class="stat" data-tip="行:列">行列 <span class="num" data-caret>${S.caret.line}:${S.caret.column}</span></span>
        <span class="stat" data-tip="插入模式">INS</span>
        <span class="statusbar__engine"><span class="dot dot--${S.engine === "ready" ? "ok" : "down"}"></span><span class="num">engine 0.9.4 · pid 21437</span></span>
      </span>
    </footer>`;
  }

  function rProjects() {
    return `<main class="projects">
      <form class="projects__toolbar" data-form="new-project-inline" aria-label="新建项目">
        <span class="field"><label>项目名称</label><input name="name" data-refocus="pj-name" required></span>
        <span class="field"><label>源语言</label><input name="src" value="en-US" required></span>
        <span class="field"><label>目标语言</label><input name="tgt" value="zh-CN" required></span>
        <button class="btn btn--primary" type="submit">创建项目</button>
        <span class="projects__spacer"></span>
        <button class="btn btn--outline" data-action="cmd" data-arg="new-project">新建项目…</button>
      </form>
      <div class="projects__head"><h2>项目（${S.projects.length}）</h2></div>
      ${S.projects.length === 0
        ? `<div class="empty empty--projects">
            ${icon("folders")}
            <p>还没有项目</p>
            <button class="btn btn--primary" data-action="cmd" data-arg="new-project">新建项目</button>
           </div>`
        : `<div class="projects__list">
            ${S.projects.map((p) => `<button class="projects__item" data-action="cmd" data-arg="open-project">
              <span class="projects__name">${esc(p.name)}${S.archived ? `<span class="badge badge--neutral">已归档</span>` : ""}</span>
              <span class="projects__locales num">${p.sourceLocale} → ${p.targetLocale}</span>
            </button>`).join("")}
          </div>`}
    </main>`;
  }

  /* ---------- full render ---------- */

  function render(refocusSel) {
    const focused = document.activeElement;
    const refocus = refocusSel || (focused && focused.dataset && focused.dataset.refocus ? `[data-refocus="${focused.dataset.refocus}"]` : null);
    const selStart = focused && focused.selectionStart != null ? focused.selectionStart : null;
    const selEnd = focused && focused.selectionEnd != null ? focused.selectionEnd : null;

    const app = document.getElementById("app");
    app.innerHTML = `
      ${rDemoStrip()}
      <div class="shell" ${S.dialog || S.paletteOpen || S.engine !== "ready" ? 'data-blur="true"' : ""}>
        ${rMenubar()}
        ${S.view === "workbench" ? `
          ${rRibbon()}
          <div class="body">
            ${rExplorer()}
            <main class="center">
              ${rTabs()}
              ${rGrid()}
              ${rPreview()}
            </main>
            ${rDock()}
          </div>` : rProjects()}
        ${rStatusbar()}
      </div>
      ${rPalette()}
      ${rDialog()}
      ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ""}
    `;

    // Auto-size the editor and restore focus. Overlays own the focus:
    // the palette input first, then the topmost dialog/gate, then whatever
    // element carried data-refocus, then the grid editor.
    const ta = app.querySelector(".grid textarea");
    if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }
    const restoreSel = (el) => {
      if (selStart != null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selEnd ?? selStart); } catch { /* selects */ }
      }
    };
    if (S.paletteOpen) {
      const inp = app.querySelector("[data-refocus='palette']");
      if (inp) {
        inp.focus();
        if (focused && focused.dataset && focused.dataset.refocus === "palette") restoreSel(inp);
        else inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    } else if (S.dialog || S.engine !== "ready") {
      const overlays = app.querySelectorAll(".overlay");
      const scope = overlays[overlays.length - 1];
      const wasInOverlay = focused && focused.closest && focused.closest(".overlay");
      if (scope && wasInOverlay) {
        const el = refocus ? scope.querySelector(refocus) : null;
        if (el) { el.focus(); restoreSel(el); }
      } else if (scope) {
        const el = scope.querySelector("[data-refocus]")
          || scope.querySelector("input:not([type='checkbox']), select, textarea, .dialog__foot button, button");
        if (el) el.focus();
      }
    } else if (refocus) {
      const el = app.querySelector(refocus);
      if (el) { el.focus(); restoreSel(el); }
    } else if (S.editing && ta) {
      // Keep the keyboard loop in the editor unless something else holds focus.
      if (!document.activeElement || document.activeElement === document.body) ta.focus();
    }
  }

  /* ---------- draft scheduling / caret ---------- */

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { commitDraft(); render(); }, 700);
  }

  function updateCaret(ta) {
    const i = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, i);
    const line = (before.match(/\n/g) || []).length + 1;
    const column = i - before.lastIndexOf("\n");
    S.caret = { line, column };
    const el = document.querySelector("[data-caret]");
    if (el) el.textContent = `${line}:${column}`;
  }

  /* ---------- events ---------- */

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-action]");
    if (!t) {
      if (!ev.target.closest(".menu") && S.menuOpen) { S.menuOpen = null; render(); }
      if (!ev.target.closest(".rowmenu") && S.rowMenu) { S.rowMenu = null; render(); }
      return;
    }
    const action = t.dataset.action;
    const arg = t.dataset.arg;
    switch (action) {
      case "scene": applyScene(arg); return;
      case "menu": S.menuOpen = S.menuOpen === arg ? null : arg; render(); return;
      case "cmd": run(arg); return;
      case "chip": {
        S.chips = S.chips.includes(arg) ? S.chips.filter((c) => c !== arg) : [...S.chips, arg];
        render(); return;
      }
      case "chips-clear": S.chips = []; S.query = ""; say("已清除筛选"); render(); return;
      case "folder-toggle": {
        S.collapsed = S.collapsed.includes(arg) ? S.collapsed.filter((p) => p !== arg) : [...S.collapsed, arg];
        render(); return;
      }
      case "query-clear": S.query = ""; render(); return;
      case "remove-arm": S.pendingRemoveId = arg; render(); return;
      case "remove-cancel": S.pendingRemoveId = null; render(); return;
      case "remove-doc": {
        const doc = S.documents.find((d) => d.id === arg);
        S.documents = S.documents.filter((d) => d.id !== arg);
        S.openDocIds = S.openDocIds.filter((id) => id !== arg);
        if (S.activeDocId === arg) {
          S.activeDocId = S.openDocIds[0] || (S.documents[0] && S.documents[0].id) || null;
          S.activeSegId = S.activeDocId && segsOf(S.activeDocId)[0] ? segsOf(S.activeDocId)[0].id : null;
        }
        S.pendingRemoveId = null;
        say(`已移除「${doc.name}」：删除 ${doc.segments.length} 个句段`);
        render(); return;
      }
      case "tab-close": {
        S.openDocIds = S.openDocIds.filter((id) => id !== arg);
        if (S.activeDocId === arg) {
          S.activeDocId = S.openDocIds[0] || null;
          S.activeSegId = S.activeDocId && segsOf(S.activeDocId)[0] ? segsOf(S.activeDocId)[0].id : null;
        }
        render(); return;
      }
      case "row-menu": ev.stopPropagation(); S.rowMenu = S.rowMenu === arg ? null : arg; render(); return;
      case "row-copy-src": {
        const seg = segsOf(S.activeDocId).find((s) => s.id === arg);
        S.undoStack.push({ segId: seg.id, before: seg.target, after: seg.source });
        seg.target = seg.source; seg.state = "draft"; S.rowMenu = null;
        say(`句段 #${seg.ordinal + 1} 已复制源文为草稿`); render(); return;
      }
      case "row-clear": {
        const seg = segsOf(S.activeDocId).find((s) => s.id === arg);
        S.undoStack.push({ segId: seg.id, before: seg.target, after: "" });
        seg.target = ""; seg.state = "untranslated"; S.rowMenu = null;
        say(`句段 #${seg.ordinal + 1} 已清空译文`); render(); return;
      }
      case "row-lock": S.rowMenu = null; toggleLock(arg); return;
      case "jump": jumpTo(arg); return;
      case "tm-apply": {
        const hit = segTm(S.activeSegId)[Number(arg)];
        if (hit) applyTm(hit, `已应用第 ${Number(arg) + 1} 条记忆匹配（${hit.score}%）为草稿`);
        return;
      }
      case "term-insert": insertTerm(arg); return;
      case "qa-waive": waive({ issueId: arg }, true); return;
      case "qa-waive-rule": waive({ ruleId: arg }, true); return;
      case "qa-waive-seg": waive({ segId: arg }, true); return;
      case "qa-restore": waive({ issueId: arg }, false); return;
      case "qa-fix": applyFix(arg); return;
      case "find-mode": S.findMode = S.findMode === "replace" ? "find" : "replace"; render(); return;
      case "find-close": S.findOpen = false; render(); return;
      case "find-replace": replaceActive(); return;
      case "find-replace-all": replaceAll(); return;
      case "preview-mode": S.previewMode = arg; render(); return;
      case "stat-draft": S.chips = ["draft"]; render(); return;
      case "stat-qa": S.chips = ["qa"]; render(); return;
      case "ai-translate": aiAssist("translate"); return;
      case "ai-refine": aiAssist("refine"); return;
      case "ai-cancel": S.aiBusy = false; say("已取消 AI 请求"); render(); return;
      case "ai-apply": {
        const seg = activeSeg();
        if (seg && S.aiCandidate) {
          S.undoStack.push({ segId: seg.id, before: seg.target, after: S.aiCandidate.text });
          seg.target = S.aiCandidate.text; seg.state = "draft";
          seg.origin = { kind: "ai", model: S.aiModel };
          S.aiCandidate = null;
          say(`句段 #${seg.ordinal + 1} 已应用 AI 草稿`);
          render();
        }
        return;
      }
      case "ai-reject": S.aiCandidate = null; render(); return;
      case "agent-start": agentStart(); return;
      case "agent-cancel": if (S.agentRun) { S.agentRun.status = "canceled"; say("Agent 运行已取消"); } render(); return;
      case "agent-review": S.chips = ["draft"]; say("已筛选 Agent 草稿句段"); render(); return;
      case "palette-backdrop": if (ev.target === t) { S.paletteOpen = false; render(); } return;
      case "palette-run": S.paletteOpen = false; run(arg); return;
      case "dialog-backdrop": if (ev.target === t) { S.dialog = null; render(); } return;
      case "dialog-close": S.dialog = null; render(); return;
      case "np-create": {
        const form = document.querySelector("[data-form='new-project']");
        const name = form ? form.querySelector("[name='name']").value.trim() : "";
        if (!name) return;
        S.projects.push({ ...clone(D.project), name });
        S.dialog = null;
        say(`项目「${name}」已创建`);
        render(); return;
      }
      case "import-pick": S.dialog.path = "~/Documents/handoff/chapter-2.docx"; render(); return;
      case "import-srx": S.dialog.srx = "zh-rules-2024.srx"; render(); return;
      case "import-srx-clear": S.dialog.srx = null; render(); return;
      case "import-run": {
        const id = `d${S.documents.length + 1}`;
        const sources = [
          "Chapter 2 covers selective sync in depth.",
          "Pick the folders each device should keep locally.",
          "Everything else stays in the cloud until you open it.",
          "Selective sync settings are per device, not per account.",
          "Changing the selection never deletes remote files.",
          "Admins can enforce a default selection for new devices.",
        ];
        S.documents.push({ id, name: "chapter-2.docx", folder: "docs/manual", format: "docx", sourceWords: 74,
          segments: sources.map((s, i) => ({ id: `${id}s${i + 1}`, ordinal: i, source: s, target: "", state: "untranslated", locked: false, origin: null })) });
        S.openDocIds.push(id);
        S.activeDocId = id;
        S.activeSegId = `${id}s1`;
        S.dialog = null;
        say(`已导入「chapter-2.docx」：6 个句段`, true);
        render(); return;
      }
      case "set-save-info": say("项目设置已保存"); render(); return;
      case "set-save-defaults": say("导入默认已保存：句子分段（内置 SRX 规则）"); render(); return;
      case "set-tm-import": say("外部 TM 导入完成（库「主工作记忆」）：读取 320 条，新增 214，更新 38"); render(); return;
      case "set-tm-export": S.dialog = { kind: "exportOverwrite", path: "~/Documents/交付/relay-tm.tmx", from: "settings" }; render(); return;
      case "set-tb-import": say("术语库「产品术语库」导入完成：读取 57 条，新增 41，合并 9"); render(); return;
      case "set-tb-export": say("术语库「产品术语库」导出完成：4 条 → ~/Documents/交付/terms.csv"); render(); return;
      case "set-tb-detach": { const tb = S.termbases.find((x) => x.id === arg); tb.mounted = false; say(`术语库「${tb.name}」已卸载`); render(); return; }
      case "set-tb-attach": { const tb = S.termbases.find((x) => x.id === arg); tb.mounted = true; say(`术语库「${tb.name}」已挂载`); render(); return; }
      case "set-tb-create": {
        const input = document.querySelector("[data-refocus='new-tb']");
        const name = input ? input.value.trim() : "";
        if (!name) return;
        S.termbases.push({ id: `tb${S.termbases.length + 1}`, name, writable: false, mounted: true, entries: [] });
        say(`已新建并挂载：${name}`); render(); return;
      }
      case "tmm-move": {
        const [id, dir] = arg.split(":");
        const mounted = S.memories.filter((m) => m.mounted);
        const idx = mounted.findIndex((m) => m.id === id);
        const swap = mounted[idx + Number(dir)];
        if (swap) {
          const a = S.memories.indexOf(mounted[idx]);
          const b = S.memories.indexOf(swap);
          [S.memories[a], S.memories[b]] = [S.memories[b], S.memories[a]];
        }
        render(); return;
      }
      case "tmm-toggle": { const m = S.memories.find((x) => x.id === arg); m.enabled = !m.enabled; render(); return; }
      case "tmm-writable": {
        for (const m of S.memories) m.writable = false;
        const m = S.memories.find((x) => x.id === arg);
        m.writable = true;
        say(`已设为可写：${m.name}`); render(); return;
      }
      case "tmm-rename": {
        const m = S.memories.find((x) => x.id === arg);
        const name = window.prompt("重命名记忆库", m.name);
        if (name && name.trim()) { m.name = name.trim(); say(`已重命名为：${m.name}`); }
        render(); return;
      }
      case "tmm-detach": { const m = S.memories.find((x) => x.id === arg); m.mounted = false; say(`已卸载：${m.name}（条目保留）`); render(); return; }
      case "tmm-attach": {
        const sel = document.querySelector("[data-input='tmm.attachChoice']");
        const m = S.memories.find((x) => x.id === (sel ? sel.value : ""));
        if (m) { m.mounted = true; say(`已挂载：${m.name}（只读，语言对 ${m.pair}）`); }
        render(); return;
      }
      case "tmm-delete-arm": {
        const sel = document.querySelector("[data-input='tmm.attachChoice']");
        S.tmDeleteId = sel ? sel.value : null;
        render(); return;
      }
      case "tmm-delete": {
        const m = S.memories.find((x) => x.id === S.tmDeleteId);
        S.memories = S.memories.filter((x) => x.id !== S.tmDeleteId);
        S.tmDeleteId = null;
        say(`已删除记忆库「${m.name}」（连同 90 条条目）`); render(); return;
      }
      case "tmm-delete-cancel": S.tmDeleteId = null; render(); return;
      case "tmm-create": {
        const input = document.querySelector("[data-refocus='tmm-new']");
        const name = input ? input.value.trim() : "";
        if (!name) return;
        S.memories.push({ id: `m${S.memories.length + 1}`, name, writable: false, enabled: true, mounted: true, pair: "en-US → zh-CN", entries: 0 });
        say(`已新建并挂载：${name}（只读）`); render(); return;
      }
      case "tmm-edit": S.tmEditId = arg; render(); return;
      case "tmm-edit-cancel": S.tmEditId = null; render(); return;
      case "tmm-save": {
        const card = t.closest(".card");
        const e = S.tmEntries.find((x) => x.id === arg);
        const [src, tgt] = card.querySelectorAll("textarea");
        e.source = src.value; e.target = tgt.value;
        S.tmEditId = null; say("条目已保存"); render(); return;
      }
      case "tmm-entry-delete-arm": S.tmDeleteId = "e:" + arg; render(); return;
      case "tmm-entry-delete": {
        const e = S.tmEntries.find((x) => x.id === arg);
        S.tmEntries = S.tmEntries.filter((x) => x.id !== arg);
        S.tmDeleteId = null; say(`已删除条目：${e.source}`); render(); return;
      }
      case "tmm-page": S.tmPage = Math.max(0, S.tmPage + Number(arg)); render(); return;
      case "term-edit": S.termEditId = arg.split(":")[0]; render(); return;
      case "term-edit-cancel": S.termEditId = null; render(); return;
      case "term-delete-arm": S.termDeleteId = arg; render(); return;
      case "term-delete-cancel": S.termDeleteId = null; render(); return;
      case "term-delete": {
        const tb = S.termbases[0];
        tb.entries = tb.entries.filter((e) => e.id !== arg);
        S.termDeleteId = null; say("已删除术语"); render(); return;
      }
      case "export-cancel": S.dialog = null; say("已取消导出"); render(); return;
      case "export-goto-qa": S.dialog = null; S.dock = "qa"; render(); return;
      case "export-override": S.dialog = { kind: "exportOverwrite", path: "~/Documents/交付/user-guide-translated.docx" }; render(); return;
      case "export-overwrite": {
        const from = S.dialog.from;
        S.dialog = null;
        say(from === "settings"
          ? "TM 导出完成（已覆盖，库「主工作记忆」）：1284 条 → ~/Documents/交付/relay-tm.tmx"
          : "导出完成（已覆盖）：~/Documents/交付/user-guide-translated.docx（10 个已译单元）", true);
        render(); return;
      }
      case "noop": return;
      default: return;
    }
  });

  document.addEventListener("dblclick", (ev) => {
    const card = ev.target.closest("[data-action='tm-apply']");
    if (card) {
      const hit = segTm(S.activeSegId)[Number(card.dataset.arg)];
      if (hit) applyTm(hit, `已应用记忆匹配（${hit.score}%）为草稿`);
    }
  });

  document.addEventListener("submit", (ev) => {
    const form = ev.target.closest("[data-form]");
    if (!form) return;
    ev.preventDefault();
    const kind = form.dataset.form;
    if (kind === "term-add") {
      const src = form.querySelector("[name='src']").value.trim();
      const tgt = form.querySelector("[name='tgt']").value.trim();
      if (!src || !tgt) return;
      S.termbases[0].entries.push({ id: `te${Date.now()}`, source: src, translations: [{ id: `tt${Date.now()}`, term: tgt }] });
      say(`术语已添加：${src} → ${tgt}`);
      render();
    } else if (kind === "ai-configure") {
      S.aiConfigured = true;
      S.aiProvider = form.querySelector("[name='provider']").value;
      S.aiModel = form.querySelector("[name='model']").value.trim() || "gpt-5.2";
      say(`AI 供应商已配置：${S.aiProvider} / ${S.aiModel}`);
      render();
    } else if (kind === "new-project-inline") {
      const name = form.querySelector("[name='name']").value.trim();
      if (!name) return;
      S.projects.push({ ...clone(D.project), name });
      say(`项目「${name}」已创建`);
      render();
    } else if (kind === "term-save") {
      const tb = S.termbases[0];
      const e = tb.entries.find((x) => x.id === form.dataset.arg);
      e.source = form.querySelector("[name='src']").value.trim();
      if (e.translations[0]) e.translations[0].term = form.querySelector("[name='tgt']").value.trim();
      S.termEditId = null;
      say("术语已保存");
      render();
    }
  });

  document.addEventListener("input", (ev) => {
    const el = ev.target;
    const key = el.dataset ? el.dataset.input : null;
    if (el.matches(".grid textarea")) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
      updateCaret(el);
      scheduleDraft();
      return;
    }
    if (!key) return;
    if (key === "query") { S.query = el.value; render(); return; }
    if (key === "fileQuery") { S.fileQuery = el.value; render(); return; }
    if (key === "findQuery") { S.findQuery = el.value; render(); return; }
    if (key === "replaceWith") { S.replaceWith = el.value; return; }
    if (key === "includeConfirmed") { S.includeConfirmed = el.checked; return; }
    if (key === "concordance") { S.concordance = el.value; render(); return; }
    if (key === "paletteQuery") { S.paletteQuery = el.value; S.paletteSel = 0; render(); return; }
    if (key === "agentInstruction") { S.agentInstruction = el.value; return; }
    if (key === "blockExportOnError") { S.blockExportOnError = el.checked; say(el.checked ? "已开启导出前 QA 检查" : "已关闭导出前 QA 检查"); return; }
    if (key === "dialog.segmentation") { S.dialog.segmentation = el.value; render(); return; }
  });

  document.addEventListener("selectionchange", () => {
    const ta = document.querySelector(".grid textarea");
    if (ta && document.activeElement === ta) updateCaret(ta);
  });

  document.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    const inEditor = ev.target.matches && ev.target.matches(".grid textarea");

    // Palette-scoped keys.
    if (S.paletteOpen) {
      const items = paletteModel();
      if (ev.key === "Escape") { ev.preventDefault(); S.paletteOpen = false; render(); return; }
      if (ev.key === "ArrowDown") { ev.preventDefault(); S.paletteSel = Math.min(items.length - 1, S.paletteSel + 1); render(); return; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); S.paletteSel = Math.max(0, S.paletteSel - 1); render(); return; }
      if (ev.key === "Enter") {
        ev.preventDefault();
        const it = items[S.paletteSel];
        if (it && it.enabled) { S.paletteOpen = false; run(it.cmd); }
        return;
      }
    }

    if (mod && !ev.altKey && !ev.shiftKey && (ev.key === "k" || ev.key === "K")) { ev.preventDefault(); run("palette"); return; }
    if (mod && ev.shiftKey && !ev.altKey && (ev.key === "p" || ev.key === "P")) { ev.preventDefault(); run("palette"); return; }

    if (ev.key === "Escape") {
      if (S.menuOpen) { S.menuOpen = null; render(); return; }
      if (S.rowMenu) { S.rowMenu = null; render(); return; }
      if (S.dialog && S.dialog.kind !== "exportQaGate" && S.dialog.kind !== "exportOverwrite") { S.dialog = null; render(); return; }
      if (S.dialog) { S.dialog = null; say("已取消导出"); render(); return; }
      if (S.findOpen && (ev.target.closest && ev.target.closest(".find"))) { S.findOpen = false; render(); return; }
      if (inEditor) { commitDraft(); S.editing = false; render(`tr[data-seg="${S.activeSegId}"]`); return; }
      if (S.findOpen) { S.findOpen = false; render(); return; }
      if (S.chips.length || S.query.trim()) { S.chips = []; S.query = ""; say("已清除筛选"); render(); return; }
      return;
    }

    if (S.view !== "workbench") return;

    if (mod && ev.key === "Enter") {
      ev.preventDefault();
      confirmSeg(ev.altKey ? (ev.shiftKey ? "stay" : "nextAny") : ev.shiftKey ? null : "nextUnconfirmed");
      return;
    }
    if (mod && !ev.shiftKey && !ev.altKey && (ev.key === "l" || ev.key === "L")) { ev.preventDefault(); toggleLock(S.activeSegId); return; }
    if (mod && !ev.shiftKey && !ev.altKey && (ev.key === "f" || ev.key === "F")) { ev.preventDefault(); S.findOpen = true; S.findMode = "find"; render("[data-refocus='find']"); return; }
    if (mod && !ev.shiftKey && !ev.altKey && (ev.key === "h" || ev.key === "H")) { ev.preventDefault(); S.findOpen = true; S.findMode = "replace"; render("[data-refocus='replace']"); return; }
    if (mod && ev.shiftKey && (ev.key === "f" || ev.key === "F")) { ev.preventDefault(); render("[data-refocus='filter']"); return; }
    if (mod && !ev.shiftKey && (ev.key === "p" || ev.key === "P")) { ev.preventDefault(); run("preview"); return; }
    if (mod && (ev.key === "o" || ev.key === "O")) { ev.preventDefault(); run("import"); return; }
    if (mod && (ev.key === "e" || ev.key === "E")) { ev.preventDefault(); run("export"); return; }
    if (mod && ev.key === ",") { ev.preventDefault(); run("settings"); return; }
    if (ev.key === "F3") { ev.preventDefault(); run("concordance"); return; }
    if (ev.key === "F4" && !ev.altKey && !mod) { ev.preventDefault(); findJump(ev.shiftKey ? "prev" : "next"); return; }
    if (mod && !ev.altKey && !ev.shiftKey && ev.key >= "1" && ev.key <= "9") {
      const idx = Number(ev.key) - 1;
      if (inEditor) {
        ev.preventDefault();
        const hit = segTm(S.activeSegId)[idx];
        if (hit) applyTm(hit, `已应用第 ${idx + 1} 条记忆匹配（${hit.score}%）为草稿`);
        else { say(`没有第 ${idx + 1} 条记忆匹配`); render(); }
        return;
      }
      const dock = ["memory", "term", "qa", "ai"][idx];
      if (dock) { ev.preventDefault(); S.dock = dock; render(); }
      return;
    }
    if (ev.altKey && !mod && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      ev.preventDefault();
      const vis = visibleSegs();
      const i = vis.findIndex((s) => s.id === S.activeSegId);
      const next = vis[Math.min(vis.length - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)))];
      if (next && next.id !== S.activeSegId) { selectSeg(next.id); render(); }
      return;
    }
    // Row-level keys (row focused, not editor).
    if (ev.target.matches && ev.target.matches("tr[data-seg]")) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const vis = visibleSegs();
        const i = vis.findIndex((s) => s.id === S.activeSegId);
        const next = vis[Math.min(vis.length - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)))];
        if (next) { selectSeg(next.id, { edit: false }); render(`tr[data-seg="${next.id}"]`); }
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        const seg = activeSeg();
        if (seg && !seg.locked) { S.editing = true; render(); }
        return;
      }
    }
  });

  // Row click selects (delegated separately from data-action buttons).
  document.addEventListener("mousedown", (ev) => {
    const row = ev.target.closest("tr[data-seg]");
    if (!row || ev.target.closest("button, textarea, .menu")) return;
    const id = row.dataset.seg;
    if (id !== S.activeSegId || !S.editing) {
      selectSeg(id);
      render();
    }
  });

  /* ---------- boot ---------- */

  window.__tl = { get state() { return S; }, applyScene, run, render };
  applyScene("grid");
})();
