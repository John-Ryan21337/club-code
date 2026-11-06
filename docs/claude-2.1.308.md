# Claude Code 2.1.308 conformance audit

Audit date: 2026-10-22. Reviewed CLI range: 2.1.303 to 2.1.308.
Reviewed Agent SDK range: 0.3.302 to 0.3.308.

The approved source baseline is **CLI 2.1.308 / SDK 0.3.308**. The operator
explicitly approved this exact release before the 24-hour quarantine expired.
Yarn exempts only SDK 0.3.308 and its exact platform packages. The normal gate
remains in force for all other versions. No wildcard or global gate override
is used. The installed system CLI is 2.1.308.

## Features and integration

| Upstream change                                                                            | Club Code handling                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/auto-mode-setup`, `/claude-api managed-agents-secure`, `/claude-api api-version`         | Keep SDK command discovery and normal skill loading. The composer exposes commands the provider advertises. Typed commands go through the same provider input path. Availability depends on the installed runtime and account; do not fabricate terminal-only commands in the SDK catalog. |
| Plugin `tool.check` with `decider: "person"`                                               | Show the existing human approval controls even in Bypass mode. Remove the adapter's redundant blanket allow. Ordinary Bypass tools remain approved by Claude before the host callback.                                                                                                     |
| Plugin read-only metadata and settings hooks                                               | Preserve configured plugins and upstream hook execution. These are runtime plugin APIs, not new Club settings.                                                                                                                                                                             |
| `sandbox.allowNestedUserNamespaces`                                                        | Available through Claude user or managed settings on Linux/WSL. Keep upstream's default off. This option weakens filesystem isolation; the app must not enable it automatically.                                                                                                           |
| Retry-watchdog usage-limit recheck                                                         | Preserve explicitly configured provider environment variables. The runtime owns retry timing; do not create a second Club retry loop.                                                                                                                                                      |
| `claude_code.safety_event` telemetry                                                       | Available through the user's Claude OpenTelemetry configuration in 2.1.307+. Do not copy telemetry payloads into Club diagnostics or enable a collector automatically.                                                                                                                     |
| MCP retry, tool refresh, server precedence, gateway tool-search fixes                      | Delivered by the CLI upgrade. Keep the embedded browser MCP server process-local and preserve upstream settings precedence.                                                                                                                                                                |
| Faster control requests, model-switch confirmation, resume, compaction, subagent fixes     | Delivered by the CLI upgrade. Keep awaited `setModel`, streaming input, explicit permission modes, result correlation, and upstream terminal events authoritative.                                                                                                                         |
| Context category IDs, MCP instruction estimates, usage recommendations                     | The SDK decodes these additions. Club retains its bounded subscription-usage probe with `skipBehaviors: true`. This patch does not collect transcript-derived recommendations or run provider-generated fix messages.                                                                      |
| Organization usage attribution                                                             | Preserve normal Claude settings/environment precedence. Do not copy organization identifiers into profile presets or diagnostics.                                                                                                                                                          |
| Claude Desktop SSH host commands, terminal mod drawing, VS Code, Cloud, Slack, Code Review | Owned by those products. The local Agent SDK does not expose those product interfaces as Club features.                                                                                                                                                                                    |

No new model families, effort levels, fast-mode capability fields, permission
modes, or top-level chat-message discriminants appear in this SDK delta.
Existing model options and generic dynamic tool handling remain available.
The 0.3.306 to 0.3.308 declaration delta consists of a sandbox help-text correction,
the Claude Desktop-only `sshHostCommands` setting, and whitespace.

Suggested next prompts retain their existing optional Claude-only implementation.
Codex suggestions remain unavailable, as the operator requested.

## Approval boundary

The flow is Claude's permission policy, then the SDK callback, then Club's
authenticated approval event and explicit user response. The protected asset is
authority to execute a tool. A broad host allow could otherwise override a
plugin or organization request for a human decision.

The adapter now sends every residual callback through human approval. It handles
already-aborted requests without creating a prompt, closes the abort-registration
race, and removes abort listeners on settlement. Regression tests cover explicit
allow, decline, cancellation, and listener cleanup. The public SDK exposes no
person-only discriminator, so the adapter must not infer one from reason text.

## Validation and activation

The isolated source copy at `M:/Cafe-Code/.validation/claude-20261022` passed
`corepack yarn fmt`, `lint`, `typecheck`, `test`, and `build:desktop`. All nine
test workspaces passed; the server suite passed 2,226 tests with one intentional
skip. The Claude adapter suite passed 95 tests, including the new approval and
cancellation regressions. No remote CI or other operating-system run was made.

The final run used SDK 0.3.308 and CLI 2.1.308. A tool-disabled SDK request
returned the exact fresh nonce with positive output usage on Sonnet 5.5.
The separate CLI access checker also passed.
No-prompt SDK discovery returned 83 commands, including `auto-mode-setup` and
`claude-api`, with both binaries. Model effort and fast-mode capabilities stayed
consistent. The conformance check reports installed CLI 2.1.308, approved
installation target 2.1.308, and npm latest 2.1.308.

The built server includes the new cancellation check and SDK 0.3.308 matrix.
Validation logs remain under `.pr-staging/claude-308-*` in the isolated
copy, with copies in the live checkout.

Activation completed on 2026-10-22 after the operator authorized shutdown.
The shutdown command reported zero survivors. The live checkout completed
`yarn install --immutable` and restored the verified desktop build from the
shared build cache. Installed versions are CLI 2.1.308, SDK 0.3.308, and the
previously pending Electron 43.8.3 runtime.

The one-shot helper's launcher process exited before its health check, so the
helper recorded a launch failure. Subsequent verification confirmed the app
running from the live checkout: the provider daemon's runtime hash matches
its server bundle, startup logged backend readiness and window creation, and
the local HTTP endpoint returned 200. A fresh tool-disabled request through
the live checkout's SDK returned the expected nonce with positive output usage.
The helper failure is retained in the activation log rather than reported as
a successful automatic launch. Recovery evidence is under
`M:/Cafe-Code/.maintenance/claude-308-activation`.

These changes are active locally. They are not committed or published.

## Sources

- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Claude SDK permission evaluation](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Claude SDK and headless feature loading](https://code.claude.com/docs/en/headless)
- [Claude settings precedence](https://code.claude.com/docs/en/settings)
- Exact npm packages: `@anthropic-ai/claude-agent-sdk@0.3.306` and `@0.3.308`;
  tarball SHA-512 integrity checked before declaration inspection.
