# API/CLI foundation evidence (2026-07-24)

- EngineService is the authoritative application service; external production
  transport is stdio JSON-RPC only.
- Clap exists on `translunar-engine` for `--data-dir` / `--protocol stdio`.
- No production HTTP API, workflow CLI, watch, clipboard, or webhook stack.
- AI keyring pattern is the model for local API bearer tokens.
- MVP = X-01 loopback HTTP + X-02 direct-service CLI; defer X-03..X-07.
