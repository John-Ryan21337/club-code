# Check provider access / プロバイダーの接続確認

Saved credentials can expire before a long run starts. A local status check can
find those credentials without proving that the provider will accept a request.
Use a small live check before external CLI fan-out or a long Claude task.
The request can consume a small amount of provider usage.

保存した認証情報は、長時間の作業を始める前に期限切れになる場合があります。
ローカルの状態確認で認証情報が見つかっても、実際にリクエストが成功するとは限りません。
外部CLIの並列実行や長時間のClaude作業の前に、小さな実リクエストで確認してください。
確認には、プロバイダーの利用枠を少量消費する場合があります。

## In Club Code / Club Codeでの確認

1. Open **Settings > Providers**.
2. Open the settings for the Claude connection you will use.
3. In **Check access before a long run**, select the model.
4. Select **Check access** and read the result and check time.

The check uses the saved provider instance, its runtime and authentication
environment. It sends synthetic text from an empty temporary directory with no
tools. It does not resume or interrupt a chat. It checks saved account and model
access; project-specific settings can still change the behavior of an actual task.

The result clears when the displayed configuration or selected model changes.
It is not a promise that access or quota will last for the full run. This action
is explicit; ordinary turns do not trigger an extra paid request. The first app
implementation supports Claude connections.

1. **設定 > プロバイダー**を開きます。
2. 使用するClaude接続の設定を開きます。
3. **長時間の実行前に接続を確認**でモデルを選びます。
4. **接続を確認**を選び、結果と確認時刻を読みます。

保存済みの接続、ランタイム、認証環境を使います。空の一時ディレクトリから、
ツールを使わずに確認用テキストを送ります。チャットを再開・中断しません。
確認対象は保存済みアカウントとモデルです。実際の作業では、プロジェクト固有の設定が
動作を変える場合があります。

表示中の設定またはモデルを変更すると、結果を消去します。実行終了まで接続や利用枠が
維持される保証ではありません。確認は利用者が選んだときに行い、通常の送信に追加の
有料リクエストを挿入しません。最初のアプリ実装はClaude接続に対応します。

## Before external CLI fan-out / 外部CLIの並列実行前

From a Club Code checkout, use the exact model selected for the work:

```sh
corepack yarn providers:check-access --claude-model claude-opus-5
```

Use `--claude-binary` and `--claude-home` with absolute paths when the work uses a
specific executable or `CLAUDE_CONFIG_DIR`. Otherwise the check uses the inherited
CLI environment. Run the actual work with the same choices. The app's managed
runtime can differ from the CLI found on your shell's `PATH`.

The command returns JSON with fixed status text and check times. It exits with
zero only when all selected checks verify access. It never prints raw provider
responses or credential values. A timeout or an unsupported CLI is unverified,
not an authentication failure. Run this command before starting expensive work;
it does not intercept unrelated CLI commands automatically.

`--codex-model`, `--codex-binary`, and `--codex-home` can identify a required Codex
lane. In this initial version it returns **unverified** and makes the command
exit nonzero: a reliable empty-tool check that preserves Codex's authentication
configuration has not been established. Do not interpret that result as an
expired Codex login. Other providers and GitHub/Notion/Linear connections are
outside this command's scope.

Club Codeのチェックアウトで、作業に使うモデルを指定して上のコマンドを実行します。
実行ファイルや`CLAUDE_CONFIG_DIR`を指定する場合は、`--claude-binary`と
`--claude-home`に絶対パスを渡します。それ以外は、呼び出し元CLIの環境を継承します。
実作業も同じ設定で実行してください。アプリが管理するランタイムと、シェルの`PATH`で
見つかるCLIは異なる場合があります。

結果は固定の状態と確認時刻を含むJSONです。選択したすべての確認に成功した場合のみ、
終了コード0になります。プロバイダーの生の応答や認証情報は出力しません。
タイムアウトや未対応CLIは「未確認」であり、認証失敗とは区別します。
大きな作業を始める前に実行してください。無関係なCLIコマンドを自動で監視する機能ではありません。

`--codex-model`、`--codex-binary`、`--codex-home`で必要なCodexの実行を指定できます。
ただし最初の実装では、認証設定を維持してツールを完全に無効にする確認方法が
確立していないため、**未確認**として終了コードを非0にします。
これをCodexのログイン期限切れと解釈しないでください。
他のプロバイダーやGitHub・Notion・Linearの接続は、このコマンドの対象外です。

## Read the result / 結果の読み方

| Status                    | Meaning                                                                           | 意味                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `verified`                | A live request succeeded at the recorded time.                                    | 記録した時刻に実リクエストが成功しました。                                               |
| `authentication-required` | Sign in through the selected provider's normal login flow, then check again.      | 選択したプロバイダーの通常のログイン手順で再ログインし、再確認してください。             |
| `account-restricted`      | The account or model is unavailable for this request. Check the provider account. | このリクエストではアカウントまたはモデルを利用できません。アカウントを確認してください。 |
| `rate-limited`            | The failed request reported a usage limit.                                        | 失敗したリクエストが利用制限を報告しました。                                             |
| `unverified`              | Access was not proved. Check the connection, CLI support, or model choice.        | 接続の成功を確認できませんでした。接続状態、CLIの対応状況、モデルを確認してください。    |
| `unsupported` / `busy`    | The app cannot run this check now.                                                | アプリは現在この確認を実行できません。                                                   |

Successful output that happens to mention a limit is not a rate-limit failure.
Do not rotate models or wait for hours based only on words in a successful response.

成功した応答に「制限」という言葉が含まれても、利用制限による失敗とは扱いません。
成功した応答内の単語だけを根拠に、モデルを切り替えたり長時間待機したりしないでください。

The CLI boundaries follow the official [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)
and [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
Supported flags must also match the installed CLI; newer documentation alone does
not establish support in an older binary.

CLIの境界は上記の公式資料を参照しています。オプションが実際にインストールしたCLIで
使えることも確認します。新しい資料に記載されているだけでは、古いCLIでの対応を証明しません。
