# Executable connector fixture

This Tier 3 example implements `EngineConnectorHandlerV1` and starts it with
`startProcessEngineConnector`. The source imports only
`@translunar/plugin-sdk`; the checked-in executable is a deterministic bundle
created by `scripts/build-connector-examples.mjs`.

The companion loopback test exercises validation, model listing, streaming,
usage, authentication failure, rate limiting, malformed data, timeout, and
cancellation without an external account or paid credential:

```powershell
node scripts/build-connector-examples.mjs
node --test scripts/connector-examples.test.mjs
```

Use `fixture-secret` only with the local fixture. Tier 3 receives the selected
credential inside its child process and is not an OS sandbox.
