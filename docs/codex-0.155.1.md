# Codex 0.155.1 integration

Club Code targets Codex CLI `0.155.1`, release commit
`be2951ea34f0d295ed0becf97079f92fa5f6950e`. This change includes the previous
0.154.0 conformance fixes, including exact assistant-message whitespace across
the provider daemon boundary. Existing model and effort selections remain intact.

## Controls

Open a connected Codex thread. The controls appear above the prompt.

- **Optional questions**: Select an option or enter your answer. Select **Add
  answer to prompt**, review the prompt, then send it. This preserves your draft
  and does not pause the agent. Questions do not submit a suggested answer automatically.
- **Codex attachments**: Select **Read attachments** to read up to 20 records.
  Use **Next page** for more. These are provider-stored JSON records, not prompt
  uploads. They do not automatically add text or files to model context. A type
  and unique key identify each record. Saving an existing identity returns the
  existing record. Removal requires confirmation. Read again after a change.
- **Codex experimental controls**: Enable the controls for the current view.
  **Read memory status** returns the consolidated-thread count and readiness,
  without exposing memory contents. **Check native verification** checks local
  readiness without prompting, enrolling a credential, or signing a challenge.
- **Start voice**: The browser requests microphone permission and connects to
  Codex through WebRTC. **Mute microphone** silences outgoing audio while retaining
  the microphone track and connection. **Stop voice**, leaving the view, hiding the application, disabling
  the controls, or replacing the server connection releases microphone tracks.
  The provider needs realtime access and compatible experimental configuration.
  Voice can delegate work to the connected Codex thread under its existing tool
  and approval settings. The live transcript is bounded and displayed in the panel.

Attachment content is limited to 16,384 characters per record. Type and identity
keys are limited to 256 characters. Large or malformed pages fail with a generic
error. Attachment and experimental controls require a current owner session and the matching live Codex
provider. They never recover or restart a missing provider session automatically.

## Release coverage

| Upstream change                                                                                                    | Club Code handling                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent thread attachments                                                                                      | Typed add/list/remove operations, explicit UI, bounded pages, owner checks, current provider routing.                                                                                                       |
| Inline asynchronous questions (0.154)                                                                              | Durable optional-question activity and answer drafting through normal prompt/steer/queue flow.                                                                                                              |
| Experimental voice                                                                                                 | Opt-in WebRTC control, microphone and playback controls, live captions, transient signaling, server lease.                                                                                                  |
| Memory readiness                                                                                                   | Explicit read of `memory/status`; no raw memory disclosure.                                                                                                                                                 |
| Native verification and cancellation                                                                               | Exact protocol types and local readiness check. Native enrollment, signing, and elicitation verification are not implemented in Club Code. Touch ID requires a supported Mac; it is unavailable on Windows. |
| Reasoning status and completion timestamps                                                                         | Existing reasoning-delta work log and provider lifecycle timestamps remain authoritative. The CLI's terminal status-row presentation is not copied.                                                         |
| Task archive/delete and worktree overview                                                                          | Club Code retains its own thread sidebar and VCS worktree controls. Codex's native task manager does not replace Club's durable thread database or authorize deletion of Club-owned worktrees.              |
| Codex daemon update schedules and recovery                                                                         | Provider-owned CLI daemon behavior. Club's provider daemon is a separate process with separate health, recovery, and update controls. No automatic CLI daemon update or application restart is introduced.  |
| Bedrock credential refresh, MCP OAuth recovery, guardian review fixes, account invalidation, Windows sandbox fixes | Run in the upgraded Codex CLI. Club preserves user configuration, shadow-home isolation, tool approvals, and current-session routing.                                                                       |
| 0.155.1 reasoning-summary default repair                                                                           | The patch changes new local TUI defaults. Club does not force summaries or replace explicit user settings.                                                                                                  |
| Feedback response additions                                                                                        | Generated protocol accepts the release response fields. No feedback upload is performed automatically.                                                                                                      |

This is not a claim that every native TUI operation has a Club Code UI. The native
verification and CLI-daemon controls above remain explicit platform/integration limits.

## Privacy and lifecycle

Attachment list responses and experimental operations bypass the durable command
ledger. Attachment mutations keep the existing idempotent command path. The
server checks owner authority before and after operations; the provider service
rejects responses from changed bindings. Older daemons must advertise support
before receiving new operation payloads. An unsupported daemon returns a refusal
without restarting active work.

Audio travels between the browser and the provider over WebRTC. Realtime
notifications, including SDP, audio chunks, and session keys, are excluded from durable provider activity; protocol diagnostics omit
payloads. Realtime stderr details and continuation lines are masked. Voice renews
a 30-second lease every five seconds while connected. The backend checks for
expiry every five seconds and stops an abandoned voice session. Provider stop
requests have a five-second deadline. Failed startup also attempts cleanup.
Failed provider stops retain the session lease and block replacement until closure
is confirmed. The browser releases microphone tracks after a 30-second startup
deadline or a 25-second renewal deadline if an RPC stops responding. Losing owner
authority during Start or Renew also triggers immediate provider cleanup.

Desktop Start requests a short-lived microphone grant for the exact trusted main
frame in the visible, focused window. Embedded browser tabs and media frames cannot
use that grant. Electron does not expose a user-gesture flag for microphone permission
callbacks; this is an explicit renderer action with native sender checks, not proof
of a native gesture. Browser policy allows microphone access only from the app's
own origin. macOS packages include the microphone purpose string and audio-input
entitlement; operating-system permission still applies.
Synthetic tests cannot prove live-account entitlement, actual microphone hardware,
native Touch ID, or provider-side audio processing.

## 日本語

接続済みのCodexスレッドでは、プロンプトの上に新しい操作欄が表示されます。

- **任意の質問**：選択肢を選ぶか回答を入力し、**回答をプロンプトに追加**を押します。
  内容を確認してから送信してください。既存の下書きは保持され、エージェントの作業は停止しません。
- **Codexの添付レコード**：明示的に読み込み、保存、削除できます。プロンプトへの
  ファイル添付とは異なり、内容はモデルのコンテキストに自動追加されません。
- **実験的な機能**：現在の画面で有効にすると、メモリの準備状態とネイティブ認証の
  状態を確認できます。音声は開始ボタンを押した後にマイクの権限を要求します。
  停止、画面の移動、アプリを非表示にする操作、接続の切り替えで録音を終了します。
- Touch IDの登録や署名はClub Codeには未実装です。WindowsではTouch IDを利用できません。
  Codex CLI自身のデーモン更新設定も、Club Codeのデーモンとは別の機能です。

古いデーモンは新しい操作を拒否します。実行中の作業を自動的に再起動しません。
実際のアカウント、マイク、Touch IDを使用した検証は行っていません。

## Synthetic interface previews

These previews use fixture data without an account, microphone, or provider session.
The wide attachment fields use a 1:2.414 split. Narrow panels stack the fields.

| Language         | Narrow panel                                  | Wide panel                                    |
| ---------------- | --------------------------------------------- | --------------------------------------------- |
| English          | [Preview](pr-assets/codex-01551/en-260.png)   | [Preview](pr-assets/codex-01551/en-832.png)   |
| 日本語           | [Preview](pr-assets/codex-01551/ja-260.png)   | [Preview](pr-assets/codex-01551/ja-832.png)   |
| English / 日本語 | [Preview](pr-assets/codex-01551/dual-260.png) | [Preview](pr-assets/codex-01551/dual-832.png) |

## Sources

- [Codex 0.155.0 release](https://github.com/openai/codex/releases/tag/rust-v0.155.0)
- [Codex 0.155.1 release](https://github.com/openai/codex/releases/tag/rust-v0.155.1)
- [Pinned app-server protocol](https://github.com/openai/codex/tree/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/app-server-protocol)
- [Pinned realtime processor](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/app-server/src/request_processors/turn_processor.rs)
- [Official app-server documentation](https://developers.openai.com/codex/app-server)
