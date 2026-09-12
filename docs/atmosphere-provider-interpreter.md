# Claude atmosphere interpretation

This incremental proposal adds an optional Claude interpreter to the Atmosphere Console. Its combined prerequisite is `03461c02`, which merges [local-model console PR 102](https://github.com/John-Ryan21337/club-code/pull/102) and [selected-instance access PR 69](https://github.com/John-Ryan21337/club-code/pull/69). It retains Cafe dev's provider registry and Claude SDK version. See [Cafe issue 97](https://github.com/cafeai/cafe-code/issues/97).

Open the console from Appearance. Select **Claude provider fallback**, then choose a provider instance and a model. The console shows the account identity last reported by the provider. This observation is not a new login check. Unknown wording sends a request through that selected account and can use quota or incur charges. Local commands still use the local parser. Closing the console resets the interpreter choice.

日本語：外観設定からコンソールを開き、**Claude provider fallback**、プロバイダーのインスタンス、モデルを選択します。表示されるアカウントは、プロバイダーが最後に報告した情報です。新しいログイン確認ではありません。ローカル構文で解釈できない文は、選択したアカウントへ送信され、利用枠や料金が発生する場合があります。既知のコマンドはローカルで処理します。コンソールを閉じると選択はリセットされます。

Only Claude is supported here. Codex appears with an unsupported label. Its current read-only filesystem sandbox does not establish a tools-disabled interpretation request. This proposal does not silently route an unsupported instance to a different account or model. LM Studio remains a separate explicit loopback option from PR 102.

日本語：この提案で対応するプロバイダーは Claude のみです。Codex は未対応と表示します。現在の読み取り専用サンドボックスでは、すべてのツールを無効にした解釈要求を確認できません。未対応のインスタンスを別のアカウントやモデルへ自動的に切り替えることはありません。LM Studio は PR 102 の明示的なローカル接続オプションとして残ります。

## Request and settings boundaries

The application sends the typed control sentence and a fixed interpretation prompt. It does not attach project files, chat history, or thread instructions. The dedicated SDK request uses a disposable directory, a custom system prompt, and the selected instance's resolved binary, home, and authentication environment. User authentication settings remain available. Project/local settings and project `CLAUDE.md` files are excluded. The pinned SDK's `settingSources` documentation requires `project` to load those instruction files.

Tools, skills, plugins, MCP servers, hooks, and automatic memory are disabled for this request. It has one turn, a 512-output-token cap, a USD 0.25 SDK budget, a 30-second stream deadline, a 64-message limit, and a 4,096-character result limit. One request per instance can run at a time. A successful terminal SDK result with output usage is required. Raw SDK errors and stderr do not reach the renderer.

The server checks the displayed redacted configuration, saved configuration, exact registry instance, selected model, and observed account identity. It checks again after interpretation. The renderer also checks the primary connection, pending settings writes, configuration, and account before it sends any settings change. Its 45-second deadline covers both fresh configuration reads and the interpretation RPC. A configuration response that arrives after that deadline cannot start a paid request. A proposal can name only the existing supported command shapes. The complete batch must pass the same parser whitelist before the existing settings RPC runs. Model output cannot authorize a shell command, provider change, arbitrary setting, or file write.

Closing the panel or replacing the connection discards late results. It does not promise to cancel a paid request already accepted by the server; the server deadline still applies. After a timeout, the instance stays busy until its owned SDK iterator finishes cleanup. This prevents a stalled child from accumulating more requests. Account identities can change outside Cafe, so the checks apply to the configuration and account state Cafe observes. No permanent access or quota guarantee is made.

日本語：アプリは入力した操作文と固定の解釈指示を送信し、プロジェクトのファイル、チャット履歴、スレッドの指示を添付しません。選択した実行ファイル、ホーム、認証環境を使用し、一時ディレクトリで専用の SDK 要求を実行します。ユーザー認証設定は維持し、プロジェクト設定と指示ファイルは読み込みません。

ツール、スキル、プラグイン、MCP、フック、自動メモリーを無効にします。上限は 1 ターン、出力 512 トークン、SDK 予算 0.25 米ドル、ストリーム 30 秒、64 メッセージ、結果 4,096 文字です。インスタンスごとに同時実行は 1 件です。正常な終了結果と出力使用量が必要で、生のエラーは画面へ返しません。

サーバーと画面は、保存設定、インスタンス、モデル、観測されたアカウント、接続の一致を確認します。画面の 45 秒の制限は最新設定の読み込みと解釈 RPC 全体に適用し、時間切れ後の設定応答から有料要求を開始しません。モデルの提案全体が既存のコマンド検証に合格した場合だけ、既存の設定 RPC を実行します。シェル、任意の設定、ファイル書き込みは許可しません。閉じた画面や古い接続への遅延結果は破棄しますが、サーバーが受理した有料要求の取消しは保証しません。サーバーの時間制限は引き続き適用されます。時間切れの後も SDK の後処理が終了するまで同じインスタンスの追加要求を拒否し、停止した処理への要求の積み重ねを防ぎます。

## Verification

SDK, account, and RPC responses in tests and review media are synthetic. No provider account was contacted and no real model charge was incurred for this port. Tests exercise the exact invocation options, stream limits and cleanup, selected-instance admission, stale account/configuration results, command validation, and actual React controls. They do not certify every CLI version or account.

日本語：テストと確認用メディアは SDK、アカウント、RPC の合成データを使用します。この移植で実際のアカウントへの接続やモデル料金の発生は行っていません。呼び出し設定、制限と後処理、接続の一致、古い結果の破棄、コマンド検証、実際の React 操作を確認します。すべての CLI バージョンやアカウントの動作保証ではありません。
