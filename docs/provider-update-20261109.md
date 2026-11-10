# Provider update: 2026-11-09

Source pins now target Codex CLI `0.167.0`, Claude Code `2.1.322`, and Claude Agent SDK `0.3.322`. Codex protocol bindings come from immutable release commit `086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`. No release-age quarantine applies. This audit builds on the completed 0.166.0 / 2.1.317 audit in `docs/provider-update-20261103.md` and inspects only the incremental changes.

## Claude Fable 5.2

Claude Code 2.1.321 adds Claude Fable 5.2 (`claude-fable-5-2`). The bare `fable` alias, and the `fable[1m]` alias, now resolve to Fable 5.2. The explicit `fable-5.1` and `fable-5` spellings still resolve to the model they name, so existing threads keep their saved model.

The catalog entry in `ClaudeModelCatalog.json` has these capabilities:

- Minimum Claude Code version: 2.1.321. On an older installed CLI, the entry stays hidden and Settings shows the upgrade message for Fable 5.2.
- Effort: low, medium, high, xhigh, and max, plus the prompt-injected `ultrathink`. Upstream defaults to medium. Club defaults to High, as the model-controls policy requires.
- Context: 200K is the default, and 1M is an option. Explicit saved choices are kept.
- Fast mode: Fable 5.2 supports it. The `allowPaidUsage` switch controls it. While the switch is Off, Club sends `fastMode: false` and the composer shows the Standard chip. Fable 5.1 still has no fast mode.

The live CLI model list remains authoritative. The catalog only supplies option descriptors and the version gate.

## Codex 0.167.0

The 0.167.0 models catalog is identical to 0.166.0. The protocol changes are additive:

- `thread/section/changed` is a new notification. Codex sends it when a provider thread moves into, within, or out of a provider sidebar section. Club decodes it for wire compatibility and then drops it. Club does not use provider sections as sidebar truth, because one Club thread can switch provider instances. The runtime routes the notification by its native `threadId` and suppresses it for child agent threads, as it does for `thread/name/updated`.
- The `requiredHumanApproval` initialize capability and the `humanCommand` approval kind are opt-in. Club does not declare the capability, so app-server never sends that approval kind to Club. Approval behavior does not change.
- The `log_sse_deltas` configuration key and changes to descriptions and annotations need no adapter change.

The regenerated bindings in `packages/effect-codex-app-server` carry the new ref in their headers. Do not hand-edit them.

## Claude Code 2.1.318–2.1.322 and SDK 0.3.322

The SDK changes are additive. Club source does not use the changed unions, so no adapter change is required apart from the catalog entry. Keep the wrapper SDK and the system CLI on matching patch releases.

Upstream:

- https://github.com/openai/codex/releases/tag/rust-v0.167.0
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

## Validation and activation

The source pins, managed-runtime installer versions, and compatibility matrix are updated. A source pin is not proof of deployment.

On this machine, the installed system CLIs were still Claude Code 2.1.317 and Codex 0.166.0 at audit time. Fable 5.2 appears in the Claude model list only after the system Claude Code is 2.1.321 or newer, because the catalog gate reads the installed CLI version. Club continues to run on the older system CLIs, but it does not offer Fable 5.2 until then.

Local source gates passed on 2026-11-09: formatting, lint, nine typecheck tasks, and nine full test tasks (4,944 passed; three skipped). The desktop build was deferred because the running Club Code instance serves `apps/server/dist`. No live activation or commit is claimed. Record the build, restart, and live activation results separately when they become true.
