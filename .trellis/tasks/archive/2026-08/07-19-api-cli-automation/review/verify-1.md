# Verify report round 1

## mission_echo
- purpose: Independently establish AC-01 through AC-05 at runtime, especially CLI row durability after process exit and continued stdio viability; the implementation self-check is only a claim, and the current API smoke does not reopen the workspace and assert that the CLI-created project/document still exist. Also confirm whether the just-applied F1–F3 fixes (error taxonomy, CSPRNG token, test mode `=1`) look green under the same gates.
- questions_addressed:
  - Q1 (AC-01 bind/auth): **Yes.** Default/loopback `serve` listens; `GET /health` is public (`200`, `ok: true`); protected routes return **401** with `error.code = "unauthorized"` for both missing and invalid bearer tokens. Non-loopback `0.0.0.0` without `--allow-remote` fails before listen with `refusing non-loopback bind …; pass --allow-remote to override` (exit 1). Unit test `rejects_non_loopback_without_opt_in` also passes.
  - Q2 (AC-02 authenticated workflow): **Yes (independent HTTP probe).** With a valid test-mode token, create project → import fixture → list documents → document QA → export produced a real file (`http-out.txt` present). Unit test `local_api_requires_token_and_imports_fixture` also covers this path in-process.
  - Q3 (AC-03 CLI durability): **Yes (second-process evidence).** `translunar --json run` exited 0 with `projectId=019fbe6a-ae06-71a1-8614-8a12c45974d8`, `documentId=019fbe6a-ae08-7561-912c-75f9ebacd6a3`, `segmentCount=2`, export file present. A **new** CLI process `project list` on the same `--data-dir` returned that exact project id. A **new** `serve` process on the same data-dir listed the exact document id under `/v1/projects/{projectId}/documents`. Rows are durable SQLite workspace state, not only in-process objects.
  - Q4 (AC-04 tokens / test-memory): **Mostly yes, with one contract break.** `TRANSLUNAR_API_TEST_MODE=1` only (unit: unset/`0`/`false`/`true`/`yes` do not enable; only `"1"` does). Ensure then rotate produced distinct CSPRNG base64url tokens (43 chars / 32 decoded bytes); **neither** raw token nor `translunar-cat.local-api` appears in `translunar.sqlite3` bytes. Unit `token_never_persists_into_sqlite_workspace` also checks both ensure+rotated. **However**, smoke’s fixed env token `test-local-api-token-value-32b` fails post-F2 `validate_token` (not base64url≥32 decoded bytes); `default_token_store` swallows `set` errors, so `token ensure` invents a random token and smoke asserts equality → **API smoke fails**.
  - Q5 (AC-05 stdio + gates): **Partial.** Minimal stdio probe: `engine.initialize` + `project.list` succeeded (`STDIO_PROBE_PASS`). Focused unit tests, binary build, and clippy `-D warnings` all pass. Focused `TRANSLUNAR_SMOKE_SCOPE=api` smoke **fails** (token contract; see V1). Smoke still does not itself reopen and assert CLI IDs (F4 automation gap; runtime durability still proven by this report).

## environment
- cwd: `K:\Workbench\CAT`
- branch: `task/07-19-api-cli-automation`
- head_sha (git): `6d380294606fa4c296f4914106283817b02c1e0b` (uncommitted product changes in engine/auth/smoke as review scope)
- OS: Windows; shell Git Bash; binaries `target/debug/translunar.exe`, `translunar-engine.exe`
- Test-mode: `TRANSLUNAR_API_TEST_MODE=1`; for successful multi-process HTTP, used valid fixed token `BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc` (32× `0x07` base64url, no pad)
- Disposable workspaces under `./target/tl-verify-*`, `./target/tl-tok-*`, `./target/tl-stdio-*`
- deviations:
  - Suggested smoke was run and failed; AC-01/02/03 re-probed via direct CLI + curl against disposable data-dir (mission allows adjusting commands).
  - Relative/`/tmp` paths broke export on Windows (`os error 3`); absolute `K:/…` paths required for CLI run export — environment detail, not product AC failure when paths are valid.
  - Memory token store is process-local; ensure/rotate across separate CLI processes do not share one store. SQLite non-persistence still checked for both process outputs + unit same-store path.

## actions

### A1
- command: `cargo test -p translunar-engine --lib local_`
- exit_code: 0
- duration_note: ~0.8s test runtime after warm build
- log_excerpt: |
    running 10 tests
    test local_auth::tests::api_test_mode_only_when_value_is_one ... ok
    test local_api::tests::rejects_non_loopback_without_opt_in ... ok
    test local_auth::tests::generated_token_is_base64url_of_32_csprng_bytes ... ok
    test local_auth::tests::memory_store_round_trip_and_auth ... ok
    test local_auth::tests::token_never_persists_into_sqlite_workspace ... ok
    test local_api::tests::run_pipeline_reuses_existing_project ... ok
    test local_api::tests::http_error_taxonomy_client_failures_are_not_internal_error ... ok
    test local_api::tests::local_api_requires_token_and_imports_fixture ... ok
    … plugin_bundled local_* … ok
    test result: ok. 10 passed; 0 failed
- interpretation: F1 taxonomy, F2 CSPRNG/format, F3 test-mode `=1`, loopback guard, token SQLite absence (both ensure+rotated in unit), and in-process API import path are green.

### A2
- command: `cargo build -p translunar-engine --bin translunar --bin translunar-engine`
- exit_code: 0
- duration_note: ~21s recompile
- log_excerpt: |
    Compiling translunar-engine v0.1.0
    Finished `dev` profile [unoptimized + debuginfo]
- interpretation: Both user CLI and stdio engine binaries build cleanly.

### A3
- command: `TRANSLUNAR_SMOKE_SCOPE=api node scripts/engine-smoke.mjs`
- exit_code: 1
- log_excerpt: |
    Error: test token should come from env memory backend
        at exerciseFocusedApiCliSmoke (…/engine-smoke.mjs:2094)
- interpretation: CLI `run` portion of smoke likely progressed (failure is at post-run `token ensure` equality). Env `TRANSLUNAR_API_TEST_TOKEN=test-local-api-token-value-32b` is rejected by `validate_token` after F2; `default_token_store` uses `let _ = store.set(&token)` so silent fall-through to `generate_token()`. Smoke contract and F2 validation are misaligned → blocks AC-05 “focused API smoke” gate as written. See V1.

### A4
- command: `cargo clippy -p translunar-engine --all-targets -- -D warnings`
- exit_code: 0
- log_excerpt: |
    Checking translunar-engine v0.1.0
    Finished `dev` profile
- interpretation: Owned package clippy clean under `-D warnings`.

### A5
- command: (disposable) `translunar --json run` then new process `project list` + new process `serve` + curl document list; absolute Win paths
- exit_code: run 0; durability asserts true
- log_excerpt: |
    run.json: projectId=019fbe6a-ae06-71a1-8614-8a12c45974d8
              documentId=019fbe6a-ae08-7561-912c-75f9ebacd6a3
              segmentCount=2, export present
    project list (2nd process): total=1, id matches projectId
    GET …/documents (3rd process via serve): document id matches documentId, segmentCount=2
    OUT_OK
- interpretation: AC-03 durable rows proven across process boundaries on the same `--data-dir` / SQLite workspace.

### A6
- command: curl against live `serve` on 127.0.0.1:18555 (test-mode valid token)
- exit_code: 0
- log_excerpt: |
    GET /health → 200 {"ok":true,"service":"translunar-local-api",…}
    GET /v1/projects (no auth) → 401 unauthorized "missing bearer token"
    GET /v1/projects (Bearer wrong…) → 401 unauthorized "invalid local API bearer token"
    GET /v1/projects (valid) → 200, includes durable CLI project
    POST create → import → qa → export → HTTP_OUT_OK
- interpretation: AC-01 and AC-02 satisfied at runtime outside unit tests. Auth failures use stable `unauthorized` + HTTP 401 (taxonomy maps bearer/token InvalidRequest specially).

### A7
- command: `translunar serve --host 0.0.0.0 --port 18557` (no `--allow-remote`)
- exit_code: 1
- log_excerpt: |
    Error: invalid request: refusing non-loopback bind 0.0.0.0; pass --allow-remote to override
- interpretation: Non-loopback refused before listening (AC-01).

### A8
- command: `token ensure` then separate-process `token rotate`; byte-scan `translunar.sqlite3` for both raw tokens; also probe invalid env test token
- exit_code: 0
- log_excerpt: |
    ensure token len=43, rotate token len=43, ensure≠rotate
    ensureTokenInSqlite: false
    rotateTokenInSqlite: false
    serviceMarkerInSqlite: false
    with TRANSLUNAR_API_TEST_TOKEN=test-local-api-token-value-32b:
      ensure returns random 43-char token, matchesEnv: false
- interpretation: Raw secrets do not land in SQLite (AC-04 core). Smoke’s legacy env token no longer seeds the memory store (V1).

### A9
- command: minimal stdio client → `engine.initialize` + `project.list` via `translunar-engine --protocol stdio`
- exit_code: 0
- log_excerpt: |
    INIT_OK {"capabilities":["docx","document.multi-file",…]}
    PROJECT_LIST_OK {"total":0,"items":0}
    STDIO_PROBE_PASS
- interpretation: Desktop stdio engine path still initializes and serves a protected post-init method (AC-05 stdio viability).

## findings_for_reviewer

### V1
- severity: major
- related_review_ids: F2, F4
- title: F2 token validation breaks smoke/env test-token contract
- evidence: `scripts/engine-smoke.mjs` asserts `tokenJson.token === "test-local-api-token-value-32b"`; `local_auth::validate_token` requires base64url decode ≥32 bytes; `default_token_store` does `let _ = store.set(&token)` ignoring failure; runtime `token ensure` with that env value returns a random CSPRNG token (`matchesEnv: false`); smoke exit 1 at line ~2094.
- detail: F2 correctly tightens generation/validation, but leaves CI/smoke’s fixed plaintext-ish env token invalid. Silent set failure makes multi-process test auth non-deterministic unless callers switch to a valid base64url 32-byte env token. This is the only hard failure blocking the focused API smoke gate required by AC-05 / success_criteria.
- suggested_next: fix_recipe_hint — either (a) change smoke (and docs) to a fixed valid base64url 32-byte `TRANSLUNAR_API_TEST_TOKEN`, and/or (b) allow test-mode env injection to bypass generate-format validation while still rejecting whitespace/empty, and/or (c) surface set failure instead of `let _ = …` so misconfiguration fails loud. Prefer (a)+(c) for clarity.

### V2
- severity: minor
- related_review_ids: F4
- title: Focused API smoke still does not reopen workspace to assert CLI project/document IDs
- evidence: `exerciseFocusedApiCliSmoke` captures `summary.projectId` and checks export file existence, but never spawns a second CLI/engine process to re-list those IDs; durability proven only by this verify report (A5), not by automated smoke.
- detail: AC-03 product behavior is good; regression protection for durability remains incomplete in smoke. Not an AC-03 runtime failure after independent probe.
- suggested_next: fix_recipe_hint — after `run`, spawn a new process `project list` (and optionally serve+document list or engine stdio document list) and assert exact IDs; keep disposable data-dir.

### V3
- severity: info
- related_review_ids: F1
- title: F1 HTTP error taxonomy unit coverage is green
- evidence: `http_error_taxonomy_client_failures_are_not_internal_error` asserts malformed DTO → 400/`invalid_request`; bad import ↛ `internal_error`/500; missing export → 404/`not_found`. Runtime auth path returns 401/`unauthorized` for bearer failures.
- detail: No residual F1 failure observed under focused tests. Full HTTP smoke workflow also succeeded when token contract was satisfied with a valid env token.
- suggested_next: out_of_scope — treat F1 as fixed pending reviewer status flip; no further verify work unless smoke rewrite surfaces new taxonomy regressions.

### V4
- severity: info
- related_review_ids: F3
- title: F3 test-mode opt-in is exact `1`
- evidence: unit `api_test_mode_only_when_value_is_one`; runtime smoke/CLI use `TRANSLUNAR_API_TEST_MODE=1` successfully for memory backend once token is valid.
- detail: Presence-based bug appears fixed; no counter-evidence at runtime.
- suggested_next: out_of_scope for fix unless review wants env-matrix beyond unit tests.

### V5
- severity: info
- related_review_ids: F2
- title: F2 CSPRNG generation unit green; format is 32-byte base64url
- evidence: `generated_token_is_base64url_of_32_csprng_bytes` ok; runtime ensure/rotate tokens length 43, decode to 32 bytes, distinct.
- detail: Generation contract met. Side-effect on env test token is V1.
- suggested_next: re-run_with smoke after V1 fix.

## unanswered
- Whether OS keyring backend (non-test-mode) ensure/rotate/status works on this host was not exercised (mission prefers test-memory + disposable data; residual risk already noted in findings).
- Whether `--allow-remote` still requires bearer auth after opt-in was not re-probed (unit/structure imply yes; not a mission failure signal).
- Full authenticated API surface beyond project/document/QA/export (filters, TM, termbase list) was not exhaustively exercised; not required by AC-02 minimum.
- Smoke after a corrected test token was not re-run end-to-end (would need product/smoke edit; verify does not fix product).

## overall
- mission_status: partial
- summary_for_reviewer: Independent runtime evidence supports AC-01 (loopback + public health + 401 missing/wrong token + non-loopback refuse), AC-02 (authenticated create/import/list/QA/export with real output file), AC-03 (CLI `run` IDs durable across new CLI and new serve processes on the same data-dir), AC-04 secret non-persistence in SQLite for both ensure and rotated tokens under test-memory, and AC-05 stdio initialize+use plus build/unit/clippy. F1–F3 look green under `local_*` tests. The mission is only **partial** because the focused API smoke gate fails: F2’s stricter token validation invalidated smoke’s `TRANSLUNAR_API_TEST_TOKEN`, and silent set failure hides the misconfiguration (V1, major). Durability is proven by verify but not yet automated in smoke (V2, minor). Closeout should wait on fixing V1 (and ideally V2) then a green `TRANSLUNAR_SMOKE_SCOPE=api` re-run; F1–F3 product status can move to fixed with V1 tracked as a follow-on from F2.
- recommended_review_focus:
  1. Confirm V1 as open major / fix-before-closeout (smoke + env token contract).
  2. Mark F1, F3 fixed; F2 generation fixed but validation integration incomplete until V1.
  3. Use this report’s A5 evidence to close F4 durability/token-scan needs_evidence for AC-03/04 runtime; keep V2 if review wants smoke-level regression lock.
  4. After fix: re-verify only `TRANSLUNAR_SMOKE_SCOPE=api` (+ optional token ensure equality and second-process ID assert).
