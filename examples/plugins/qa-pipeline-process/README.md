# QA And Resumable Pipeline Example

This Tier 3 package uses only `@translunar/plugin-sdk`. It contributes a
deterministic brand-style QA rule and a resumable JSON pipeline step with
closed config, progress checkpoints, cancellation, and typed failures.

Build and exercise its real newline JSON-RPC process through the SDK tests:

```powershell
pnpm --filter @translunar/plugin-sdk build
pnpm --filter @translunar/plugin-sdk test
```

To use it through CAT, inspect and install this directory, review the exact
`qa.register` and `pipeline.register` requests, grant the listed contribution
IDs, enable it, run QA or a pipeline, and inspect the durable run provenance.
Disable or revoke a grant to stop new calls; uninstall only after inspecting
the retained history. The example needs no network or filesystem capability.
