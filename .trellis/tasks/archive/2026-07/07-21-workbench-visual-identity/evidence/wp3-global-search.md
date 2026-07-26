# WP3 app-bar identity and global search evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer.

## Delivered behavior

- `GlobalSearchPanel` is the single controller/result surface used by Project
  Home and Workbench. It owns the generated `search.global` request shape,
  bounded paging, balanced `<mark>` snippet rendering, workflow/field labels,
  stale-request protection, and typed error presentation.
- Workbench keeps in-document search in the editor toolbar with the accurate
  `Search in document` label. The app bar now exposes a real project-wide
  search command with the existing BrandMark/project identity and a restrained
  orbital/ruler treatment. The single five-stripe Translunar Band remains in
  the shell row below the app bar.
- `Ctrl+Shift+K` opens global search. `Ctrl+K` remains the established editor
  command-palette shortcut, so existing professional-editor keyboard behavior
  is not displaced. Escape and outside-click close the search layer and return
  focus to the app-bar command.
- Result selection awaits `persistAllSegments()` before calling the parent
  `openWorkspace(project, document, segment, ordinal)` callback. A rejected
  save leaves the Workbench, draft, and search layer mounted and shows the
  normalized Engine error.

## Focused verification

```text
pnpm --filter @translunar/desktop typecheck   pass
pnpm --filter @translunar/desktop build       pass
pnpm lint                                     pass
pnpm exec prettier --check <focused files>    pass
```

The real-Engine Electron test
`opens app-bar global search, flushes navigation, and retains a failed draft`
passed. It verifies:

- mouse and keyboard opening, auto-focus, Escape, and focus return;
- safe highlighted snippets (no literal markup rendered);
- awaited save-before-result navigation and persisted target text;
- a real revision conflict, retained renderer draft, visible typed error, and
  an open search layer after failure;
- app-bar geometry at 1250x744, 1680x942, and 1920x1080 in English and
  Simplified Chinese, with identity, document, search, Run QA, Export, and
  overflow controls ordered without overlap;
- no renderer console/page errors.

## Visual evidence

| Locale | 1250x744 | 1680x942 | 1920x1080 |
| --- | --- | --- | --- |
| English | `screenshots/wp3-app-bar-en-1250x744.png` | `screenshots/wp3-app-bar-en-1680x942.png` | `screenshots/wp3-app-bar-en-1920x1080.png` |
| Simplified Chinese | `screenshots/wp3-app-bar-zh-1250x744.png` | `screenshots/wp3-app-bar-zh-1680x942.png` | `screenshots/wp3-app-bar-zh-1920x1080.png` |

The existing real-Engine Project Home lifecycle coverage continues to exercise
cross-document global-search navigation; this package reuses the same callback
and result contract from both consumers.
