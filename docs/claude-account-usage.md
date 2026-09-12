# Claude account usage

Enable **Provider usage** in provider settings to request subscription usage for a configured Claude instance. The existing usage widget controls visibility and polling. A refresh uses that instance's binary, home, and environment. It does not send a model prompt or redeem credits.

This port uses the experimental usage control in the pinned Claude Agent SDK 0.3.266. It requires Claude Code 2.1.266 or later, an authenticated subscription plan, and a known account email. Earlier runtimes and API-key accounts do not advertise this polling capability. The initialization response must match the expected email and subscription family before Cafe requests usage.

The disposable query runs in an empty temporary directory. It preserves user settings for authentication resolution, disables hooks, skills, plugins, and tools, ignores external MCP configuration, and requests `skipBehaviors: true` to skip local transcript analysis. The query has a 12-second deadline and closes before its temporary directory is removed. No query session is saved. This is a control request, not proof that a model can complete a turn.

Cafe retains only bounded quota windows and optional paid-usage metadata. Session data, behavior analysis, account identity, and unknown response fields are dropped. Provider amounts stay in provider units unless the response explicitly supplies a currency. Missing values stay unknown. Each window and paid-usage record keeps its own observation time; a later quota event cannot refresh unrelated older facts. Failed refreshes retain previous values with their original dates. An authoritative account change clears cached account usage.

Verification uses synthetic SDK responses and browser fixtures. It does not read a real subscription's usage or redeem credits. The experimental method can change; unsupported or malformed responses do not become inferred percentages.

## 日本語

プロバイダー設定の **Provider usage** を有効にすると、設定済みの Claude インスタンスの使用量を取得します。表示と定期更新には既存の使用量ウィジェットを使います。対象インスタンスの実行ファイル、ホーム、環境設定を使い、モデルへのプロンプト送信やクレジットの交換は行いません。

固定済み Claude Agent SDK 0.3.266 の実験的な使用量 API を使います。Claude Code 2.1.266 以降、認証済みのサブスクリプション、確認済みのメールアドレスが必要です。古い実行環境と API キー認証では、この定期取得機能を表示しません。使用量を要求する前に、初期化結果のメールアドレスとプラン種別が対象アカウントに一致することを確認します。

一時クエリは空の一時ディレクトリで動作します。認証に必要なユーザー設定を保持し、フック、スキル、プラグイン、ツールを無効にし、外部 MCP 設定を読み込みません。`skipBehaviors: true` でローカル履歴の分析を省略します。制限時間は12秒です。クエリを終了してから一時ディレクトリを削除し、セッションは保存しません。これは制御要求であり、モデルの応答能力を確認するものではありません。

保持するのは上限を設けた使用量枠と任意の有料使用量データだけです。セッション、行動分析、アカウント識別情報、未知の項目は除外します。通貨が明示されていなければ、数値はプロバイダーの単位として表示します。欠けた値は不明のままにします。各使用量枠と有料使用量には個別の確認時刻を保持するため、新しいイベントで古い情報が新しく見えることはありません。更新失敗時は元の時刻と値を保持し、確定したアカウント変更では保存済みの使用量を消去します。

検証には合成 SDK 応答とブラウザ用のテストデータを使います。実際の契約の使用量取得やクレジット交換は行いません。実験的 API が未対応または不正な応答を返した場合、使用率を推測しません。
