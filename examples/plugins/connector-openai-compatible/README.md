# OpenAI-compatible Tier 1 connector

This manifest-only package demonstrates the connector V1 declarative HTTP
mapping. It is deliberately pinned to the loopback fixture origin
`http://127.0.0.1:43123`; profile configuration cannot replace or widen that
origin.

Run the shared fixture qualification from the repository root:

```powershell
node --test scripts/connector-examples.test.mjs
```

The credential is stored by the Engine and injected as a Bearer value only for
the selected invocation. It is not a manifest or profile configuration field.
The fixture credential is `fixture-secret` and is suitable only for local
tests.
