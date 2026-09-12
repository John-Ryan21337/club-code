# Provider access review media

- `before.png`: current Cafe provider settings without an access check.
- `after.png`: the same provider settings with the new access check.
- `verified.png`: result and timestamp after the request completes.
- `access-check.webm`: before/after dialog, check completion, then changing the
  selected model clears the verification result.

These captures render the actual before/after `ProviderInstanceCard` components
with synthetic provider data and a mocked successful RPC. They demonstrate UI
behavior; they do not prove live provider authentication. The temporary capture
fixtures are excluded from the product and test suite.
