# Accessibility / visual manual matrix status

**Candidate:** `8c8df12`  
**Host:** Windows x64 only

| Gate | Status | Notes |
| --- | --- | --- |
| Automated axe (Project Home / Settings / Tutorial) | pass (Windows E2E) | `product-shell-accessibility.spec.ts` + shell cases among 34 passed Electron tests |
| Workbench viewports 1250×744 / 1680×942 / 1920×1080 | partial | Historical screenshots exist under archived plugin/workbench tasks; **not** re-captured on this SHA as complete matrix |
| Keyboard-only + focus return (native Windows) | not-run | Requires manual session |
| NVDA spot checks | blocked-external | Assistive tech session not run |
| VoiceOver / macOS | blocked-external | No macOS runner |
| CJK IME composition | partial | Unit coverage exists; native IME session not-run |
| 125% font scaling | partial | E2E has 125% zoom case; incomplete suite |
| Light/dark contrast + reduced motion | not-run | Manual |
| Packaged macOS Space Grotesk / Chivo / Space Mono / Noto Sans SC | blocked-external | Fonts present in Windows build assets (~7.7 MB Noto SC); macOS packaged `file://` proof missing |
| WOFF2 payload ≤20 MiB | pass (Windows build assets) | Sum of shipped renderer fonts ≈ 7.9 MiB |

## Verdict

**fail / blocked-external** for AC4 — cannot close inherited Workbench macOS or full native a11y gates from this runner.
