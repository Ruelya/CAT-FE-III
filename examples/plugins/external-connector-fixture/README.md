# External connector fixture

Deterministic public-SDK-only fixture for P-08 external connectors.

- Exercises authenticated `test`, `pull`, `push`, `poll`, and `webhook`.
- Uses local configuration scenario switches (`success`, `empty`, `page`,
  `auth`, `rate`) without network or paid services.
- Imports only `@translunar/plugin-sdk` public APIs.
- Fixture credential value for Engine keyring tests: `fixture-token-not-for-production`.

This package does **not** own automation jobs, webhook HTTP ingress, or CAT
application writes. Those belong to later automation work.
