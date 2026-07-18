# Implementation Plan: Full Translunar CAT Product

## Preconditions

- Use Codex inline mode; do not dispatch implementation/check sub-agents.
- Work serially. Each child receives complete `prd.md`, `design.md`, and
  `implement.md`, is activated, implemented, checked, committed and archived
  before the next dependent child starts.
- Preserve the existing working DOCX path throughout all migrations.
- Run Rust linking/checks on `ssh moehub` when the Windows SDK linker remains
  unavailable locally.

## 0. Planning and Bootstrap

- [x] Read `docs/PRD.md`, architecture/design decisions, current protocol,
      migrations, renderer, tests, and archived MVP evidence.
- [x] Record the current capability gap and map full PRD modules to child tasks.
- [x] Create the parent plus 17 implementation/release children and link the
      existing Bootstrap task.
- [x] Complete `00-bootstrap-guidelines`: fill every backend/frontend spec with
      current examples, update indexes, check documentation, commit and archive.
- [x] Run the parent PRD convergence pass and activate the parent task.

## 1. Foundation

1. `07-19-core-domain-storage-pipeline`
   - domain v2, migrations, protocol services, multi-document lifecycle,
     histories, repair/backup primitives, typed filter/pipeline registry;
   - compatibility tests for the schema-v1 MVP database and DOCX workflow.

2. `07-19-tm-termbase-asset-hub`
   - multi-library assets, provenance, fuzzy/context/CJK search, concordance,
     TMX/TBX/CSV exchange, term recognition and automatic sinking;
   - 1M-entry benchmark fixture and deterministic ranking tests.

## 2. Formats

3. `07-19-text-html-xliff-srx`
   - TXT/Markdown/HTML/XLIFF 1.2/2.1 filters, protected tags and SRX rules.

4. `07-19-office-document-filters`
   - complete DOCX ownership plus XLSX/PPTX import/export and fidelity fixtures.

5. `07-19-pdf-ocr-workflow`
   - text PDF layout, OCR comparison/editing, reconstruction and degradation.

## 3. Daily Translation Workflow

6. `07-19-professional-editor`
   - tags, propagation, concordance, replace, split/merge, comments, spelling,
     undo/redo, shortcuts, themes/zoom, virtualization and accessibility.

7. `07-19-ai-engine-grounding`
   - keychain, provider registry, six real connectors, custom endpoints,
     grounded streaming and resumable batch pretranslation.

8. `07-19-qa-review-workflow`
   - QA profiles/rules/reports, terminology/consistency, review revisions,
     sign-off and export gates.

9. `07-19-project-lifecycle-analytics`
   - multi-file UX, drag/drop, archive/restore, templates, re-import, global
     search/history and non-billing analysis/analytics.

## 4. Asset and Ecosystem Depth

10. `07-19-interop-alignment-review`
    - external CAT interchange, bilingual DOCX/task packages, alignment,
      reference corpora, discussion and snapshot workflows.

11. `07-19-asset-curation-center`
    - cleaning, semantic findings, quality, terminology mining, drift,
      reversible runs, scheduler and datasets.

12. `07-19-plugin-runtime-sdk`
    - three plugin tiers, capability permissions, lifecycle, SDKs, public docs,
      official filter/connector/QA/UI examples and local distribution.

13. `07-19-api-cli-automation`
    - authenticated local API, CLI, folder watch, clipboard, webhooks and
      external connector examples.

14. `07-19-advanced-ai-quality`
    - QE, semantic QA, fuzzy repair, terminology extraction, RAG, adaptive
      context, source/tag diagnosis, agentic and multimodal workflows.

15. `07-19-collaboration-server`
    - self-hosted engine, op-log asset sync, locks, presence, board, roles,
      assignments, mentions and reconnect/conflict tests.

## 5. Productization and Release

16. `07-19-platform-packaging-product-shell`
    - Windows/macOS packaging, localization, secure secrets, backup/update,
      tutorial, accessibility, CI, license and contribution/plugin docs.

17. `07-19-full-prd-release-qualification`
    - ID-by-ID closure audit, full format/AI/plugin/API/collaboration E2E,
      performance/capacity/fidelity corpus, package smoke and release evidence.

## Per-Child Quality Gate

Run relevant subsets during implementation, then the complete gate before each
child commit:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

Additional gates are added by children for benchmarks, filter fixtures,
connectors, plugin processes, API/CLI, collaboration and packaging. External
provider tests use local deterministic HTTP fixtures unless credentials are
explicitly present.

## Integration Gates

- After schema/protocol changes: old DB recovery + contract generation + MVP E2E.
- After each filter: import/export validation, structural diff and degradation.
- After assets/AI/QA: deterministic ranking/rules plus real renderer flow.
- After plugins/API/collaboration: crash isolation, auth, permission and
  multi-process tests.
- Before parent completion: Windows/macOS package evidence, all NFR fixtures,
  full PRD requirement matrix with no unmapped or presentation-only claims.

## Rollback Points

- Commit and archive every child independently; never mix unrelated children.
- Keep old protocol methods during additive migrations until all consumers move.
- Keep filter/provider capabilities disabled until their acceptance fixtures pass.
- Never irreversibly rewrite or delete user assets; migrations back up first and
  curation/history retain inverse operations.
