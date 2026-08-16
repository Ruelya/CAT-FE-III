# Research: rebase the CAT surface from a mature project

| Item | Value |
| --- | --- |
| Date | 2026-08-16 |
| Status | Decision research, not an implementation plan |
| Trigger | Incremental Trados-lookalike work is only touching the fur |

This note answers one question: **should Translunar keep painting the homemade Electron grid, or rebase the translator-facing editor from a mature project?**

It does not claim we can become Trados. No open project does.

## 1. Why the last iterations felt empty

Trados Studio is a **bilingual file system** with an editor on top. The last Translunar iterations were an **editor chrome** with a bilingual file system underneath.

What Trados actually is (the parts translators mean by "完善"):

- A filter factory that owns hundreds of formats and round-trips them
- A native bilingual container (SDLXLIFF), not "segments in SQLite + reconstruct HTML"
- Original-layout preview that is the real document (Word/embedded), not a live reconstruction
- TM that is a product: fuzzy, context, PerfectMatch, AutoSuggest dictionaries, concordance
- Batch tasks, QA Checker profiles, MultiTerm, packages, alignment

What the recent Translunar loops actually changed:

- Workbench chrome (IntelDock placement, wizard steps, copy, Ctrl+S)
- Homemade preview upgraded to `marked` / `DOMPurify` / `docx-preview`
- Desktop dialogs for TMX/TBX

Those are real, small, and honest. They do not move the product across the Trados gap. More rounds of the same layer will produce the same feeling.

The engine is not the empty part. `crates/` already has a local-first protocol, revisioned segments, TM/TB/QA, filters for DOCX/HTML/Markdown/TXT/PDF/XLSX/PPTX/XLIFF, and an asset hub. The hollow part is the **translator editor surface**: a homemade grid pretending to be Studio.

## 2. Two different "fork another project" ideas

They are not interchangeable.

| Idea | What you inherit | What you still have to build |
| --- | --- | --- |
| A. Fork a **code editor** (VS Code, Zed, Theia, Monaco) | Buffers, extensions, search, keybindings | The entire CAT: grid, tags, TM, filters, preview, QA, packages |
| B. Fork a **CAT** (OmegaT, Swordfish, MateCat, translate5) | Segment workflow, TM/glossary, filters or XLIFF, QA | Brand, engine integration, and whatever that CAT never had (Word COM, MultiTerm, Studio-grade batch) |
| C. Fork a **document suite** (OnlyOffice, Collabora) | Real DOCX/PPTX layout | The entire CAT on top of a Word clone |

Trados itself is **B with a C embedded for preview**. It is not A, and it is not a Word fork.

Previous project policy ("do not fork Zed / VS Code") was correct for A. It was never a reason to keep painting the homemade grid forever.

## 3. Candidates

### 3.1 Do not rebase onto these

**VS Code / Theia / Zed / Monaco**

Mature editors. Wrong noun. A CAT spine is a segment pair plus tags plus TM, not a text buffer. A VS Code-shaped CAT is a multi-year product rewrite that still has no filters, no SDLXLIFF, and no original-layout preview. This is how teams lose another year and still have fur.

**OnlyOffice / Collabora / LibreOffice**

Mature document engines. Useful as an **embedded preview host**, not as the product. OnlyOffice's Bergamot plugin is whole-document MT, not a CAT. If the app becomes "Word plus a plugin", you invert Trados: layout first, bilingual second. Translators will fight the document instead of the grid.

**CafeTran**

Feature-rich desktop CAT. Proprietary. Not a 二开 base.

**Weblate / Pootle / Lokalize / Qt Linguist**

Software localization. Wrong job. Keep them as future connectors, not the editor.

**translate5**

Real cloud TMS, AGPLv3. The layout preview translators want (`translate5 visual`, TrackChanges) is a **paid plugin**. Forking the core does not give you the visual. License also forces source disclosure for a network service.

### 3.2 Real CAT bases

**OmegaT** — [omegat-org/omegat](https://github.com/omegat-org/omegat)

- What it is: the only long-lived open desktop CAT that translators already accept as "a CAT".
- Has: fuzzy TM, glossary, concordance, tag protection, Hunspell, LanguageTool, MT hooks, Groovy scripts, team projects, 50+ formats via Okapi plugin, aligner.
- Stack: Java / Swing. License: **GPLv3+**.
- 二开 cost: you inherit a complete CAT and a 20-year UI. Modifications you distribute must stay GPL. Integrating the Rust engine means either throwing the engine away or running two cores.
- Verdict: **fastest path to a complete CAT**. Worst path if the product identity is "our engine, our desktop, our license".

**Swordfish** — [maxprograms-com/Swordfish](https://github.com/maxprograms-com/Swordfish)

- What it is: XLIFF-native desktop CAT (Maxprograms). TypeScript + Java. **EPL-1.0**.
- Has: XLIFF as the working file, TMX/TBX, conversion from many formats, Trados Studio package handling, regular releases (v5.24 in 2026).
- 二开 cost: small maintainer set (effectively one author). Less depth than OmegaT. EPL is the most business-friendly CAT license in this list. Stack is closer to Translunar's desktop than OmegaT is.
- Verdict: **best license-and-stack fit** if the decision is "replace our editor with a real CAT, keep an open-standards core".

**MateCat** — [matecat/MateCat](https://github.com/matecat/MateCat)

- What it is: web CAT for MTPE and outsourcing. **LGPL-3.0**.
- Has: a real segment editor, QA, MyMemory, project dashboard.
- 二开 cost: PHP monolith, cloud/collab-shaped. Filters repo is archived; conversion historically depended on a hosted Java service. This repo already excluded GroupShare-style collaboration.
- Verdict: steal the **editor interaction**, do not rebase the product onto MateCat.

**Okapi Framework** — [okapiframework/Okapi](https://gitlab.com/okapiframework/Okapi)

- What it is: Apache-2.0 filter and pipeline library. Not an editor.
- This is the piece PRD §4.1 already named as the architecture to copy.
- Verdict: **reuse as a library**. Do not "fork Okapi to make a CAT". OmegaT already did the editor half.

## 4. What Translunar should keep

Do not throw away the Rust engine to chase a Java UI.

Keep:

- Local-first engine process and generated protocol
- Revisioned segment mutations, save coordinator, draft journal
- Asset hub (TM / TB / corpus / curation)
- Existing filters as a compatibility layer until Okapi (or Swordfish conversion) owns more formats
- Offline / BYOK stance from `docs/PRD.md`

Replace or stop investing in:

- Homemade structure preview as the path to "Trados preview"
- Further Trados-lookalike chrome (wizard steps, dock placement, copy tweaks) as a substitute for editor depth
- Any plan that starts with "fork VS Code, then add CAT"

## 5. Decision

Three honest options. Pick one. Do not mix them in the same month.

### Option 1 — Stop pretending, ship a known CAT

Rebase the **translator app** onto OmegaT or Swordfish.

- OmegaT if the only goal is "a translator can finish a job with TM, glossary, tags, and 50 formats".
- Swordfish if the goal is "XLIFF-native desktop, EPL, TypeScript, Studio packages".
- Translunar becomes the **asset hub / engine** behind it, or a later brand on top. The current Electron workbench stops being the spine.

### Option 2 — Keep the engine, replace only the editor surface

Do not fork a whole CAT monolith.

- Extract or reimplement the bilingual editor from Swordfish (EPL) or MateCat (LGPL editor ideas)
- Ingest **Okapi** for filters that we do not want to keep writing in Rust
- Embed OnlyOffice **or** Collabora **only** as a preview host, same way Studio embeds Word
- Freeze chrome-only Trados iterations

This is the only option that preserves the PRD (open, local-first, asset hub) without another year of fur.

### Option 3 — Continue the current loop

Keep adding preview libraries, dock layouts, and wizard chrome.

This will not produce Trados. It will produce more screenshots.

## 6. Recommendation

**Do Option 2. Explicitly reject Option 3. Do not do Option 1 unless the product decision is "we are no longer building our own CAT editor".**

Option 2 exploration (done): [research-option2-spike.md](./research-option2-spike.md).

Swordfish `TranslationView` cannot mount on `segment.editor.list`. Reimplement the grid; keep the engine. Okapi Tikal 1.48.0 can extract HTML to XLIFF 1.2 and merge it back, but `.sdlxliff` already has `builtin.sdlxliff` — do not send it through Tikal. Two `builtin.xliff` ingest bugs (ITS `version` shadowing, `<mrk mtype="seg">` as a tag) are fixed in this branch. Tagged Tikal units still scramble on export. OnlyOffice Docs is a later preview host, not week one.

If Option 1 is accepted instead, choose Swordfish over OmegaT unless GPL and Java are acceptable. Do not choose MateCat or translate5 as the desktop spine.

## 7. What this is not

- Not a claim that Swordfish or OmegaT equals Trados.
- Not permission to open a second product repo in the same week as a spike.
- Not a new engine protocol.
- Not Word COM.
