# Cafe backend comparison: 2026-11-03

The operator requested a parallel comparison of Cafe's backend, prompt handling, and CLI integration, with selective improvements and no loss of Club behavior. Compare the actual working Club source, including its existing local changes, rather than treating its older Git base as the implementation.

## Compared sources

- Cafe released main: `dd55bf906f31f8b9434d09cce10e79280efdb3f8`, October 21.
- Cafe development: `8df4c96a0d593355a6561acd481ff9740fe0efd9`, November 3. Development changes are not described as a published release.
- Club's verified current provider update: Codex 0.166.0, Claude Code 2.1.317, SDK 0.3.317.

Cafe main uses SDK 0.3.295; development uses 0.3.314. Development's Codex protocol ref matches Club's 0.166.0 ref. Keep Club's newer Claude conformance and Ultra verification/usage handling. No release-age quarantine applies.

## Selected improvements

Claude query retirement, based on Cafe development `e66ef653`: close the exact native query before joining its reader. A real SDK-style async generator can queue `return()` behind a pending `next()`, so joining first can hold the lifecycle lock forever. Retirement has a finite deadline. If closure cannot be confirmed, keep the owner, refuse a competing replacement, and let explicit Stop retry the same query. Do not emit a successful session exit for an uncertain close.

Native custom instructions, based on Cafe `27f64a0b`: send the operator's custom guidance through supported provider instruction channels while keeping the user's turn text and recovery bootstrap intact. Preserve native provider guidance, blank-file behavior, UltraCaching options, existing model controls, and the compatibility path for other providers. Do not copy Cafe's image or renderer promises into Club prompts when Club does not supply those features. This corrects instruction placement; no measured quality or cache-cost improvement is claimed.

## Examined changes not copied wholesale

- Cache-duration pricing (`c3f56a57`): Club counts the parent cache-write total once and does not add its nested TTL counters. Its existing accounting/persistence tests passed. Cafe's newer cost display depends on a larger accounting ledger and migration; a partial pricing port would lack reliable inputs.
- Exact output-limit continuation (`5f934c86`): depends on ownership, cancellation, history evidence, and one-use recovery controls absent from Club's architecture. A bare error matcher would not reproduce the safe behavior.
- Native-agent attention and permission reconciliation (`4c90f116`): spans a migration and many projection/UI boundaries. It is not a small provider fix.
- Rejected-auth handling (`37a39d68`): includes credential fences and owner-side logout behavior. Do not transplant automatic logout into Club's shared CLI account handling.
- MCP thread-context/shared-quota reporting, OpenCode cost estimates, notifications, computer-use controls, and renderer changes were included in the inventory. They do not justify replacing Club's current backend or copying prompts that promise unsupported tools.
- A Claude output-budget setting can be useful, but it is separate from the current prompt-retirement defects and is not required to keep the latest native CLI available.

## Validation

Keep focused regressions for native start/resume instructions, unchanged user text, recovery bootstrap, UltraCaching, pending async-generator retirement, failed-close ownership, and retry. Run Club's required formatting, lint, typecheck, full tests, and desktop build after the combined changes. Record build and activation evidence separately; the preceding CLI/Ultra update is already live.

Evidence directory: `M:/Cafe-Code/.maintenance/upstream-adoption-20261103`. No broad merge, provider downgrade, credential change, commit, or publication is authorized by this comparison.

Final source verification: formatting, lint, all nine typecheck tasks, and all nine full test tasks passed (4,791 passed; three skips). Fresh independent review found no material in-scope defect and passed 325 focused tests without changing the source. A metadata-only probe using the installed Claude CLI 2.1.317 and SDK 0.3.317 confirmed that a pending reader settles after query closure; no model prompt or tool call was sent. Desktop artifact and activation results are recorded separately in the evidence directory.
