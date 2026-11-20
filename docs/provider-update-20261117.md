# Provider update: 2026-11-17

This update targets Codex CLI `0.169.1`, Claude Code `2.1.327`, and Claude Agent SDK `0.3.327`.
The Codex release commit is `c376cf7396eff83ce4c6ac61b9553df142e7a0be`.
The compatibility matrix retains exact versions. No release-age quarantine applies.

## Sources

- [Codex release](https://github.com/openai/codex/releases/tag/rust-v0.169.1)
- [Codex app-server protocol](https://developers.openai.com/codex/app-server)
- [GPT-6.2 Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra)
- [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- [Claude Agent SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript)

## Codex compatibility

Live `model/list` remains authoritative. The fallback catalog now includes GPT-6.2 Sol and Astra for CLI 0.169.1 or newer.
Both models retain the High effort and 200K context defaults. Sol supports 500K and 872K native context choices; Astra supports 272K and 872K.
Model capabilities control speed choices. The per-instance paid-usage switch remains authoritative.

The protocol was regenerated from the exact release commit. Additions include model-provider discovery and configuration, account security setup, and nullable gateway parameters.
The new schemas also retain audio file IDs, agent-message display metadata, content token counts, and history filtering fields.
These protocol additions do not change Club's approval authority or provider-owned thread lifecycle.

## Claude compatibility

Claude's current catalog already includes Fable 5.2, Opus 5.5, Sonnet 5.5, and Haiku 5.5.
The SDK now sends browser MCP connection headers through stdin with `mcpServersDelivery: "initialize"`.
This keeps browser credentials out of process arguments. Claude Code 2.1.327 or newer must acknowledge the transport before prompt submission.
Older or unparseable CLI versions show an upgrade error, even if capability initialization fails. No credential-bearing fallback is allowed.

## Verification status

All required source gates passed: formatting, lint, nine typecheck tasks, the full test suite, desktop build, and provider conformity smoke.
The full suite passed 4,964 tests across 525 files, with three skipped tests. Lint retained warnings but reported no errors.
The desktop build completed all three tasks without cache reuse. The generated protocol reproduced identical hashes on a second generation.
An independent audit repaired one Claude readiness defect. A fresh review and focused tests verified the repair.
The installed system CLIs now report Codex 0.169.1 and Claude Code 2.1.327. The installed SDK reports 0.3.327.
Live initialization returned both GPT-6.2 models and the current Claude model lineup.
Renderer checks passed 50 unit tests and 34 Chromium tests, including model search, selection, and paid-usage controls.
Claude's bounded no-tools inference check was blocked by HTTP 403 with `oauth_not_allowed_for_organization`.
Model discovery does not prove inference access. The account must permit Claude Code OAuth before a real response can be verified.
The existing Club process owns this update task. Its provider daemon remains on the previous build until a normal restart.
The rebuilt server passed a fresh-state startup smoke test: HTTP readiness, renderer HTML and assets, and SQLite creation.
The smoke test stopped only its isolated process. The original application still returned HTTP 200 afterward.
This verifies fresh backend startup, not activation of the existing desktop window or live Codex inference.
Validation logs are stored under `.club-runtime/checks/provider-update-20261117/`.
