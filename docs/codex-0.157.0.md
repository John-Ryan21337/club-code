# Codex 0.157.0 integration

Club Code targets Codex CLI `0.157.0`, release commit
`00c972ed5d6ff6499317fd41b7f23605b8e6850d`. This change spans the upstream
0.156.0, 0.156.1, and 0.157.0 releases. The npm `latest` tag and the installed
CLI (`codex-cli 0.157.0`) match this pin. Existing model and effort selections
remain intact.

## Breaking change: thread rewind

Codex 0.156 removed `thread/rollback` from the app-server API. Club Code's
checkpoint revert now uses the supported replacement:

- For a **paginated** provider history, Club locates the exact native cutoff
  turn through bounded metadata-only pages (64 turns per page, 256 pages, one
  30-second preflight deadline) and issues one `thread/revert` with the exact
  `beforeTurnId`. The preflight requires an idle thread, no active or
  usage-limited native goal, and an unchanged latest turn immediately before
  the mutation.
- For a **legacy** (non-paginated) history, Club keeps the old rollback
  operation through a narrow compatibility decoder outside the generated
  method map.
- Native revert can commit before its acknowledgment arrives. A failed ACK
  permits only bounded read-only reconciliation, never a retry or another
  mutation. A verified commit proceeds; a settled rejection plus a proven
  unchanged history permits filesystem compensation; an uncertain outcome
  fails closed with a fixed actionable message.

The checkpoint reactor captures a private recovery snapshot before it touches
the filesystem. A definite provider refusal restores that snapshot and deletes
it. An uncertain provider outcome keeps both the reverted files and the
recovery snapshot, and blocks further rewinds on that thread until the
retained snapshot is inspected and removed. No raw provider error, path, or
native identity enters the work log.

## Release coverage

| Upstream change                                                        | Club Code handling                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thread/rollback` removal, `thread/revert` replacement (0.156)         | Bounded native rewind described above, with fail-closed recovery and regression tests for every refusal, compensation, and uncertain-outcome path.                                                                                                                                                                                                                                                 |
| Gateway OAuth sign-in (`account/gatewayOAuth/*`, 0.157)                | Generated protocol decodes the new requests and notification. Club does not opt into gateway-login UI ownership: the `explicitGatewayOauth` capability stays unset, and `account/gatewayOAuth/changed` notifications are dropped before event projection, native provider logs, and child-liveness accounting because they carry authorization URLs and provider-authored errors.                  |
| Item lifecycle timestamps (`startedAtMs`/`completedAtMs` on items)     | Accepted as optional display metadata. Club does not invent local timestamps for older history and does not treat them as a new lifecycle boundary.                                                                                                                                                                                                                                                |
| MCP App UI metadata (`mcpToolCall.mcpAppUi`), MCP server capabilities  | Accepted by the generated schema. Descriptive metadata stays inert; Club has no MCP status panel and grants no new tool or resource authorization from it.                                                                                                                                                                                                                                         |
| Hosted MCP resource targets (`mcpServer/resource/read` `target`)       | Accepted by the generated schema. Club does not call this method; a null `linkId` (no-auth access) remains distinguishable from a selected account link.                                                                                                                                                                                                                                           |
| Plugin summaries and extensions, thread `disabledPluginIds`            | Accepted by the generated schema. Club has no plugin UI and sends no plugin selection, so upstream defaults apply unchanged.                                                                                                                                                                                                                                                                       |
| Personality deprecation (`friendly`/`pragmatic` no longer style)       | Club never sends `personality` on thread or turn start; the only use is passive settings diagnostics. `model/list` now reports `supportsPersonality: false` for every model.                                                                                                                                                                                                                       |
| Model catalog provider requirements (`model/list` restart errors)      | A non-compliant startup provider fails the provider probe visibly. Club does not silently retry; the probe error asks the operator to restart the provider.                                                                                                                                                                                                                                        |
| Selected workspace routing (`account/read.workspaceRouting`)           | Native account-level discovery inside the CLI. Club's Cafe-scoped HTTPS provider is named `OpenAI` with the default base URL, so it participates in the same discovery as the stock provider. Routing rewrites only the origin and preserves API paths and HTTPS; Club does not read or cache routing state itself. A discovery failure fails the request visibly instead of silently downgrading. |
| Windows sandbox implementation selection (MXC readiness)               | Readiness reporting is native. Club offers no legacy sandbox setup when MXC is selected.                                                                                                                                                                                                                                                                                                           |
| Application network policy                                             | Enforced natively by the app-server for its own HTTP/WebSocket traffic. No Club configuration change is required.                                                                                                                                                                                                                                                                                  |
| Local rollout compression (`rollout/compress`, experimental)           | Not adopted. Acknowledgment does not imply completion, there is no progress or cancellation API, and every process sharing the Codex home must support compressed rollout files first.                                                                                                                                                                                                             |
| Attachment copying on non-ephemeral forks                              | Accepted. Club does not call `thread/fork`; attachment reads remain explicit.                                                                                                                                                                                                                                                                                                                      |
| Descendant channel-post compaction, resume checkpoints, cache affinity | Native efficiency work inside the CLI. Club preserves native compaction and resume identity and does not add a second summarizer.                                                                                                                                                                                                                                                                  |

This is not a claim that every native capability has a Club Code UI. Gateway
login, plugin management, and MCP app hosting remain explicit integration
limits.

## Verification

- Regenerated `packages/effect-codex-app-server` from the immutable release
  commit; typecheck passes across all ten packages.
- New protocol regressions cover gateway capability opt-in and response
  typing, item timestamps, MCP origins and resource targets, and plugin
  extensions.
- The rewind module has a dedicated suite covering exact cutoff selection
  across bounded pages, legacy fallback, uncertain-outcome retention, tail
  reconciliation, idle/goal admission refusals, unsafe-history rejection, and
  shared preflight deadlines.
- Checkpoint reactor regressions prove filesystem compensation for definite
  refusals, retention for uncertain outcomes, and refusal to overwrite a
  surviving recovery snapshot.

## 日本語

Codex 0.156 で `thread/rollback` が削除されました。チェックポイントの巻き戻しは
`thread/revert` を使用します。実行前にスレッドがアイドル状態であること、
アクティブなゴールがないこと、履歴が変化していないことを確認します。
結果が不確定な場合は、対象ファイルと回復スナップショットの両方を保持し、
確認するまで再試行をブロックします。ゲートウェイのログイン通知は認証URLを
含むため、ログや診断には記録されません。

## Sources

- [Codex 0.156.0 release](https://github.com/openai/codex/releases/tag/rust-v0.156.0)
- [Codex 0.156.1 release](https://github.com/openai/codex/releases/tag/rust-v0.156.1)
- [Codex 0.157.0 release](https://github.com/openai/codex/releases/tag/rust-v0.157.0)
- [Pinned app-server protocol](https://github.com/openai/codex/tree/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/app-server-protocol)
- [Pinned app-server documentation](https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/app-server/README.md)
- [Official app-server documentation](https://developers.openai.com/codex/app-server)
