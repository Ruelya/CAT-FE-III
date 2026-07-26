# WP1 font evidence

Measured 2026-07-26 on the Windows Electron lane from the checked-in renderer
assets and production Vite output.

## Asset budget and packaging

| Asset | Weight(s) | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `translunar-space-grotesk.woff2` | variable 300–700 | 49,256 | `8e085aa438094f11487a836652edd5c054fa6a96f63fc7c282105ee3a4b08c07` |
| `translunar-chivo.woff2` | variable 100–900 | 62,100 | `665cf19af7c64db9a73bf9c3382a67e79886d93877a5e517888eff5245ae2625` |
| `translunar-space-mono-400.woff2` | 400 | 34,932 | `a3281287939a152ec1485709aff1a77515b4f0d657a24fcda3a5a439aa39adb2` |
| `translunar-space-mono-700.woff2` | 700 | 35,324 | `aa90806275743a460cb47b707d975c27358473cd6068bba1d4c62d13d747b120` |
| `translunar-noto-sans-sc.woff2` | variable 100–900 | 7,782,072 | `aef8c34277afad81ecd0227138a830263c0caea65b7aea66d1195395f097b55a` |
| **Total** | 5 WOFF2 files | **7,963,684 (7.595 MiB)** | — |

The production command `pnpm --filter @translunar/desktop build` emitted the
same five files under `apps/desktop/dist/renderer/assets` (7,963,684 bytes),
so the measured renderer packaged-app delta for local typography is 7,963,684
bytes. This is below the 20 MiB cap. Noto Sans SC is the complete upstream
variable cmap (30,890 mapped code points); it was compressed to WOFF2 without
fixture glyph or Unicode-range subsetting.

## Runtime evidence

The focused Electron test passed:

```text
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g "keeps panel motion"
1 passed (26.5s)
```

That test awaits `document.fonts.ready`, loads both Space Mono weights and
representative Latin/SC text (`简体中文翻译龘㐀𠂇`), checks the computed display,
body, mono, and CJK roles, and rejects observed HTTP(S) font requests. Under
Electron's `file://` renderer, PerformanceResourceTiming does not expose local
font entries; the Playwright request listener and successful Font Loading API
statuses provide the local/offline evidence instead.

Static checks also passed:

```text
pnpm exec prettier --check ...       pass
pnpm lint                            pass
pnpm --filter @translunar/desktop typecheck  pass
pnpm --filter @translunar/desktop build      pass
```

Upstream URLs, pinned snapshots/commits, license files, conversion method, and
per-file provenance are recorded in
`apps/desktop/src/renderer/assets/fonts/manifest.json`.
