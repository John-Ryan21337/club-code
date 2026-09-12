# Use a Codex reset credit

The provider-usage widget can show **Use one reset credit** for an authenticated ChatGPT account with a supported Codex instance and a fresh, available Codex reset-credit record. Expired, unknown, and already used credits do not show the action.

Select the action, then confirm use of one credit. Cafe sends the selected credit ID and one UUID attempt ID through the current generated `account/rateLimitResetCredit/consume` protocol. The native account email must match the account shown at confirmation. The instance must still be active before the mutation starts. Concurrent requests for that instance are rejected instead of queued.

The action uses the configured Codex binary, effective shadow home, and environment. It refreshes that instance's shadow authentication before launch, starts a disposable app-server, and makes no thread or model request. The request has a 15-second deadline with bounded child cleanup. A native `reset`, `nothingToReset`, `noCredit`, or `alreadyRedeemed` result is shown as reported. A missing acknowledgement is unknown, and no automatic retry occurs. Refresh usage to read the account balance. No provider failure text or credential path is shown.

This port preserves the current Cafe SDK and generated protocol. Tests and media use synthetic accounts and responses. They do not redeem real credits.

## 日本語

使用量ウィジェットは、対応する Codex インスタンスで認証済みの ChatGPT アカウントに、新しく確認された利用可能な Codex リセットクレジットがある場合、**Use one reset credit** を表示します。期限切れ、不明、使用済みのクレジットには操作を表示しません。

操作を選択し、クレジット1個の使用を確認します。Cafe は現在の生成済み `account/rateLimitResetCredit/consume` プロトコルで、選択したクレジット ID と1回の試行を表す UUID を送ります。ネイティブ側のメールアドレスが確認画面のアカウントと一致し、操作開始時も同じインスタンスが有効であることを確認します。同じインスタンスへの同時要求は待ち行列に入れず拒否します。

設定された Codex 実行ファイル、シャドウホーム、環境を使います。起動前にそのインスタンスの認証情報を更新し、一時 app-server を起動します。スレッドやモデルへの要求は行いません。制限時間は15秒で、子プロセスの終了にも制限時間があります。ネイティブ側の `reset`、`nothingToReset`、`noCredit`、`alreadyRedeemed` をそのまま結果として扱います。応答が確認できない場合は不明とし、自動再試行しません。残高を確認するには使用量を更新します。プロバイダーの生のエラーや認証ファイルのパスは表示しません。

現在の Cafe SDK と生成済みプロトコルを保持します。テストと画像には合成アカウントと応答を使い、実際のクレジットは交換しません。
