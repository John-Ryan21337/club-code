# Codex 0.163.0 integration

Club Code targets Codex CLI `0.163.0`, release commit
`83086188ae0614bd882818ff1aa23f3194962012`. This change spans the upstream
0.158.0 through 0.163.0 releases. The npm `latest` tag and the installed CLI
(`codex-cli 0.163.0`) match this pin. Existing model and effort selections
remain intact; `gpt-6-astra` is still the bundled catalog default.

## Release coverage

| Upstream change                                                                                                                                                                                                                                                  | Club Code handling                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paginated history is now the default for local threads                                                                                                                                                                                                           | Club already pages its own durable transcript and uses bounded `thread/read` snapshots for reconciliation only. Persisted command output in paginated history is capped at 64 KiB upstream; Club must not expect full output from history reads.                                   |
| `thread/read includeTurns` / `thread/turns/list` on an unmaterialized loaded thread now return invalid_request ("thread … is not materialized yet")                                                                                                              | Club snapshots an active turn only after a user message exists, so the new rejection is unreachable in the follow-up path. The stale-cursor recovery texts (`no rollout found for thread id`, `failed to resolve rollout path`) are unchanged and the recovery lists stay in step. |
| Turn lineage: `TurnStartParams.parentTurnId`/`rootTurnId`, `Turn.rootTurnId`; `Turn.error` now also set for interrupted turns                                                                                                                                    | Decoded by the regenerated schema. Club keys failure on `status === "failed"` (`codexTerminalSessionPatch`), so an interrupted turn carrying an error still reconciles to ready without resurrecting a failure.                                                                    |
| `CodexErrorInfo` is now an open union (adds `flexUnavailable`, `tooManyDenials`, then `string \| record`)                                                                                                                                                        | Club reads `codexErrorInfo` as loose records everywhere (transport classifier, command reactor), so unknown variants degrade to generic retry/error handling instead of decode failures.                                                                                           |
| `thread/revert` now rejected for ephemeral threads                                                                                                                                                                                                               | Club's checkpoint rewind only reverts persistent threads; the fail-closed recovery semantics from the 0.157 integration are unchanged.                                                                                                                                             |
| `thread_unload_delay_secs` default changed 60s → 1800s (30 min)                                                                                                                                                                                                  | Club does not set this key and follows the upstream default. Loaded threads now stay resident longer; the bounded snapshot decode (`readThreadSnapshotBounded`) remains the guard against large-history stalls. Set the key explicitly if daemon memory pressure returns.          |
| Plugin `extensions` entrypoint surface removed from `plugin/list` summaries; richer `interface`/availability metadata added                                                                                                                                      | Club has no plugin UI and never consumed `extensions`. The protocol regression test now tracks the 0.163 shape and proves a legacy payload carrying `extensions` still decodes with the retired key dropped.                                                                       |
| `ModelProviderCapabilitiesReadResponse.namespaceTools` removed                                                                                                                                                                                                   | Not referenced anywhere in Club (proved by a controlled source search).                                                                                                                                                                                                            |
| `PlanType` gains `promax`                                                                                                                                                                                                                                        | Labeled "ChatGPT Pro Max Subscription" in provider status, with a registry regression test. Upstream display name is "Pro (Max)".                                                                                                                                                  |
| Retry budgets (`request_max_retries`/`stream_max_retries`) still hard-coded for the built-in `openai` provider; `[model_providers.openai]` overrides still ignored; ChatGPT behavior still gated on provider name "OpenAI"; `supports_websockets` gate unchanged | The Cafe-scoped tuned provider launch (`cafecode-openai`, 10/12 retry budgets with the user-config sniff guard) and the HTTPS-only fallback provider remain necessary and valid at 0.163.                                                                                          |
| New experimental surfaces: thread read-state (`thread/readState/changed`), thread predictions (`thread/prediction/updated`), attachment-owner lookup, environment skills, `rollout/compress` (still experimental)                                                | Decoded for protocol compatibility only. Generating types is not evidence that a product surface is implemented; none of these are adopted.                                                                                                                                        |
| `MessagePhase` gains `partial_answer`; MCP OAuth gains `loginId`; `TurnToolOutput.retain`; `ThreadListParams.excludedThreadIds`; item-anchor cursors                                                                                                             | Accepted by the regenerated schema. Club has no exhaustive switch on message phase. `McpServerOauthLoginResponse.authorizationUrl` stays out of logs as before; `loginId` is a correlator, not a secret.                                                                           |
| Model catalog: `gpt-5.4` removed, `gpt-6.1-sol` added                                                                                                                                                                                                            | Club's missing-selection default (`gpt-6-astra`) and git text-generation default (`gpt-5.6-luna`) are unaffected. Explicit saved `gpt-5.4` selections surface the backend entitlement error rather than being rewritten.                                                           |
| zsh execution backend removed                                                                                                                                                                                                                                    | Club never selected zsh; no configuration change.                                                                                                                                                                                                                                  |

This is not a claim that every native capability has a Club Code UI. Thread
read-state, predictions, plugin management, and gateway login remain explicit
integration limits.

## Verification

- Regenerated `packages/effect-codex-app-server` from the immutable release
  commit; typecheck passes across all packages.
- Protocol regression updated: the 0.157 plugin-extensions test now tracks the
  0.163 `interface`/availability shape and legacy-payload tolerance.
- Provider registry regression covers the new `promax` plan label.
- Worker-limit semantics re-verified at the new anchors
  (`config/mod.rs#L2813`, `config_tests.rs#L12543`, `merge.rs#L73`); the
  `agents.*`/`features.multi_agent_v2.*` dual-key mapping is unchanged.

## 日本語

Codex 0.163.0 への準拠更新です。ローカルスレッドの履歴はページネーションが
既定になり、スレッドのアンロード遅延は 60 秒から 30 分に変更されました。
`CodexErrorInfo` は開かれた列挙型になったため、未知のエラー種別も安全に
処理されます。組み込み `openai` プロバイダーの再試行回数は依然として変更
できないため、`cafecode-openai` プロバイダーによる再試行強化は引き続き
有効です。新しい `promax` プランは「ChatGPT Pro Max Subscription」と表示
されます。

## Sources

- [Codex releases 0.158.0–0.163.0](https://github.com/openai/codex/releases)
- [Pinned app-server protocol](https://github.com/openai/codex/tree/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol)
- [Pinned app-server documentation](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/README.md)
- [Official app-server documentation](https://developers.openai.com/codex/app-server)
