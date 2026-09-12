# Optional local atmosphere interpretation

This incremental adoption builds on the local Atmosphere console. Choose
**LM Studio fallback** in its Interpreter control to interpret short wording
that the local parser does not recognize. The default is **Local grammar — no
model**, and closing the console resets that choice.

Recognized commands still use the local parser without a model request. Invalid
percentages, conflicting commands, and known unsupported features are refused
locally; selecting a model does not bypass those checks.

The application sends the typed sentence to the fixed LM Studio server at
`http://127.0.0.1:1234` on the device that runs the browser. It lists models and
uses the first returned model ID. The server must already be running and permit
requests from the Cafe browser origin. Model availability and loading remain
under LM Studio's control. This slice does not install or launch LM Studio.

Only a fixed interpretation prompt and the typed sentence are sent. The request
does not add project, chat, file, provider-session, or account data. Browser
credentials and referrers are omitted; redirects are rejected. No Claude, Codex,
or other cloud-provider call is made by this path.

The full discovery, inference, and response-body operation has one eight-second
deadline. Each response body is limited to 32 KiB. Requests are limited to 500
characters and are refused rather than truncated. Transport and response errors
produce fixed local messages; raw server diagnostics are not shown.

Model output is untrusted. Every field must match the installed console command
union, with at most four commands. Extra fields, invalid values, unknown actions,
and overlapping settings refuse the entire proposal. A supported proposal uses
the same settings-save path as a local command. Relative changes use the current
settings at dispatch, after interpretation has finished.

Closing the console or changing the primary environment cancels the browser request.
A late proposal from an old connection cannot send a settings write. The server's
atmosphere capability is checked again immediately before saving. Once the
settings write has been sent, it cannot be cancelled; a missing acknowledgment
still requires checking Appearance before retrying.

Claude/Codex interpretation, media commands, arbitrary model endpoints, and model
installation are separate features. The generic text-generation CLI path is not
treated as proof that interpretation runs without tools or project access.

## 日本語

コンソールの **Interpreter → LM Studio fallback** を選ぶと、ローカル解析で
認識できない短い表現をLM Studioに送れます。初期値は **Local grammar — no
model** です。コンソールを閉じると選択は初期値に戻ります。

既知のコマンドはモデルを呼び出しません。範囲外の割合、重複指定、既知の未対応機能は
端末内で拒否します。モデルの選択で検証を回避することはできません。

送信先はブラウザーを動かしている端末の `http://127.0.0.1:1234` に固定します。
LM Studioが返した一覧の先頭のモデルIDを使います。LM Studioサーバーを事前に起動し、
Cafeのブラウザーからのアクセスを許可してください。モデルの準備・読み込みは
LM Studio側で管理します。この機能はLM Studioをインストール・起動しません。

送る内容は固定の解析指示と入力した一文だけです。プロジェクト、会話、ファイル、
プロバイダーセッション、アカウントの情報は追加しません。ブラウザーの認証情報や
リファラーは送らず、リダイレクトも拒否します。この経路はClaudeやCodexなどの
クラウドプロバイダーを呼び出しません。

モデル一覧の取得から応答本文の読み取りまで、全体の期限は8秒です。各応答本文は
32 KiBまで、入力は500文字までです。長すぎる入力は切り詰めずに拒否します。
通信や応答のエラーは固定のメッセージで示し、生の診断情報を表示しません。

モデル出力は未信頼として扱います。最大4コマンドとし、このビルドが扱う項目だけを
許可します。余分な項目、不正な値、未知の操作、同じ設定への重複があると全体を拒否
します。対応した提案は通常の設定保存経路を使い、相対変更は送信時点の現在値から
計算します。

コンソールの終了や主環境の変更でブラウザーの解析要求を中止します。古い接続から遅れて届いた提案で
設定を送信することはありません。保存の直前にサーバーの外観操作権限も再確認します。
ただし、すでに送信した保存要求は取り消せません。
確認が返らない場合、再送信前に外観設定を確認してください。

Claude/Codexの解釈、メディア操作、任意の接続先、モデルのインストールは別機能です。
汎用のテキスト生成CLIだけでは、ツールやプロジェクトを使わない実行を保証しません。
