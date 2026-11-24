# Provider update: 2026-11-03

Source pins now target Codex CLI `0.166.0`, Claude Code `2.1.317`, and Claude Agent SDK `0.3.317`. Codex protocol bindings come from immutable release commit `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`. Installed system CLIs already match these releases. No release-age quarantine applies.

## Ultra usage and verification

Anthropic renamed Max 20x to Ultra. Verified Ultra accounts have no five-hour usage limit; shared weekly limits and a separate Fable weekly limit remain. Phone verification is separate from plan verification.

The current native account initialization reports “Claude Ultra”, while its usage response can still report legacy `max`. The decoder combines identity and usage from the same account-bound disposable query. It infers verified status only from Ultra identity, an explicitly null five-hour window, and a valid weekly percentage. A present five-hour window means the temporary session limit applies. Missing fields and unavailable usage never prove verification. Tooltips explain this inference because SDK 0.3.317 does not expose a dedicated verification field.

Both apps show weekly and model limits independently, retain valid zero percentages, and omit a five-hour bar only when no window is reported. Retained model windows keep their original check time. Verification and usage become visibly stale rather than remaining current after a failed refresh. Scoped streaming events must not replace shared weekly usage. Unscoped session-limit events restore pending status immediately.

Extra usage retains the reported currency and converts minor units using `decimal_places` (legacy default 2). Unknown currency is not labeled USD. These values describe subscription allowances and extra spending, not session token cost.

Sources:

- https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan
- https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work

## Current CLI coverage

Reuse the completed Club Code 0.165.0 / 2.1.312 audit; inspect the incremental upstream changes rather than repeating it. Cafe Code's older protocol bindings and SDK are advanced to the same versions. Existing Claude Opus/Sonnet/Haiku 5.5 and Fable 5.1 catalogue entries remain available; the live CLI catalogue remains authoritative. Cafe's static Codex fallback now includes Terra 6.1. GCP is available through Cafe's provider settings, with OSS precedence and native GCP authentication. No credentials are copied into settings.

Codex 0.166.0 adds account workspace names, timing metadata, native usage fields, and additional errors. Regenerated bindings carry these fields. Stable RPC methods are unchanged from 0.165.0. Review delivery is inline only; neither adapter depends on detached reviews. Native transport, permissions, authentication, and history handling remain under the CLI. The upstream thread-unload default is 60 seconds again. Retry overrides still require the custom OpenAI-compatible provider.

Codex native next-prompt prediction is still explicitly unimplemented at this release. Preserve the operator's decision to wait for native support; do not invoke a model fallback.

Claude 2.1.317 / SDK 0.3.317 supply hook failure policy, clearer native authentication/region failures, and runtime fixes through the pinned SDK/CLI. A new `session_writes_lost` notification now produces a fixed warning about disk space or quota without exposing transcript identifiers or changing a completed result into a failed turn. The SDK adds a pending-elicitation response type, but its public query implementation does not redeliver that field; this is not claimed as a new reconnect feature. Native CLI terminal commands and account-wide workspace changes are not silently translated into unsafe desktop actions.

Upstream:

- https://github.com/openai/codex/releases/tag/rust-v0.166.0
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

## Validation and activation

Detailed gate outputs and pre-change tracked-file copies are retained in the local conformance maintenance directory. Do not infer deployment from source pins or a successful build. Record final gate, build, audit, and live activation results separately.

Final local checks passed: formatting, lint, nine typecheck tasks, nine full test tasks (4,769 passed; three skips), desktop build, provider conformity, and the focused Ultra Chromium regression. Independent review repaired scoped usage freshness, native logging privacy, and Cafe fallback model gating; 476 focused tests passed across both apps.

After the restart on November 3, the live Club Code backend returned HTTP 200 and served the matching renderer asset. Its provider-runtime hash matches the verified server bundle and SDK 0.3.317. Cafe Code is updated and built separately; no second desktop instance was launched.

Cafe's required supervised ChatGPT Web audit remains blocked because the session has no approved text-upload tool. A local redacted review packet is prepared; no web audit or upload is claimed. Linear requires reauthentication. No new commit or GitHub publication is claimed.
