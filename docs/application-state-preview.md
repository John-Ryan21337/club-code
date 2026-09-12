# Operational application state / アプリケーションの運用状態

This incremental draft builds on [SQLite previews and comparisons #118](https://github.com/John-Ryan21337/club-code/pull/118), exact `e3b5090889ee265d20d7f690e25c6d3ac46ec6f9`. [Cafe issue #108](https://github.com/cafeai/cafe-code/issues/108) tracks the proposal. It adds selected operational data from the server's configured `state.sqlite`. It does not expose the full Club state database or a forensic dump.

この差分は上記の SQLite 表示・比較を前提とします。サーバーに設定された `state.sqlite` から、許可した運用データだけを追加します。Club の状態全体やフォレンジック用の生データを公開する機能ではありません。

Open the observatory and select **Load operational tables** in **Application operational state**. Select daily usage counters or projection status, then a row limit of 25, 50 or 100. Changing the limit clears the rows; select **Read operational rows** to read again. Opening the panel performs no state read. There is no polling or snapshot comparison in this panel. Its scope is the selected server, across projects.

観測画面の **アプリケーションの運用状態** で **運用テーブルを読む** を選びます。日次利用カウンターか投影処理の状態を選び、行数上限を 25・50・100 から選びます。上限を変えると行を消します。**運用行を読む** で再取得します。画面を開くだけでは状態を読みません。このパネルは定期更新やスナップショット比較をしません。対象は選択したサーバー全体で、プロジェクトをまたぎます。

Only `usage_stats_days` and `projection_state` are eligible. The fixed column list includes dates, seven usage counters, installed projector names, sequence numbers and timestamps. Values must match bounded dates, timestamps, known names or nonnegative safe integers. Missing tables are omitted; incompatible schemas or unsafe values refuse the read. Additional columns are never selected. Auth records, prompts, messages, plans, events, raw JSON, daemon payloads and workspace paths are excluded. These counters are stored observations, not a new provider usage measurement.

対象は `usage_stats_days` と `projection_state` だけです。固定の列は日付、7 種の利用カウンター、実装済みの投影処理名、シーケンス番号、時刻です。値は上限付きの日付・時刻・既知の名前・非負の安全な整数でなければなりません。存在しないテーブルは省き、対応しない構造や安全でない値がある場合は読み取りを拒否します。追加の列を選びません。認証情報、プロンプト、メッセージ、計画、イベント、生の JSON、デーモンの内容、作業パスは対象外です。保存済みカウンターの表示であり、プロバイダー利用量の新しい測定ではありません。

Each RPC requires an active owner session and a backend connection whose observed peer is loopback. The server checks the session ID, current role and expiry before and after the worker. Paired client sessions are refused. This checks the backend peer, not the originating browser: Cafe's HTTPS sibling or another local reverse proxy can forward remote traffic over loopback. Forwarded headers do not grant access. The browser pins its exact connection, hides old results after replacement and requires reopening the observatory.

各 RPC は有効な所有者セッションと、観測した相手がループバックであるバックエンド接続を必要とします。サーバーは処理の前後でセッション ID・現在の権限・期限を確認します。ペアリングされたクライアント権限は拒否します。これはバックエンドの接続相手の確認であり、元のブラウザーがローカルである証明ではありません。Cafe の HTTPS 接続やローカルのリバースプロキシは、遠隔通信をループバック経由で中継できます。転送ヘッダーで権限を得ることはできません。画面は正確な接続に固定し、接続が変わると以前の結果を隠し、観測画面の開き直しを求めます。

Only a separate fixed child opens the configured file. No caller path or SQL is accepted. It uses read-only SQLite, disables extensions and trusted schema, and returns at most 100 rows, 12 columns, 128 characters per cell and 64 KiB. Fixed SQL checks types and admits only text of at most 128 bytes before transferring exact values to JavaScript. Embedded NUL and invalid values are refused, not shortened into valid dates or names. The parent kills the child after three seconds and retains its single admission slot until the child closes and private temporary-directory cleanup completes. Shutdown closes admission, kills the owned child and waits for cleanup. The UI's 20-second waiter does not cancel an accepted server read.

設定されたファイルを開くのは、別の固定子プロセスだけです。呼び出し元のパスや SQL は受け付けません。SQLite は読み取り専用で、拡張機能と信頼済みスキーマを無効にします。結果は最大 100 行・12 列・セル当たり 128 文字・64 KiB です。固定 SQL が型を確認し、128 バイト以下の文字列だけを正確な値のまま JavaScript に渡します。埋め込まれた NUL や無効な値を、有効な日付や名前に短縮せず拒否します。親は 3 秒で子を終了させ、子の終了と非公開一時ディレクトリーの後処理が済むまで唯一の実行枠を保持します。終了時は新規受付を閉じ、所有する子を終了させて後処理を待ちます。画面の 20 秒待機上限は、サーバーが受け付けた読み取りの取り消しではありません。

Unlike project previews, this reader opens Cafe's own live state directly and has no 32 MiB copy limit. It performs no logical database writes, checkpoints or journal-mode changes. SQLite can still use or create WAL/SHM sidecars and hold reader locks that delay checkpoints until the child closes. Large or busy state files can exceed the deadline. Regular-file identity and configured-path checks surround the read; normal WAL changes are allowed. Portable path checks do not eliminate every hostile replacement race. The project's private-copy policy and file limits remain separate.

プロジェクト表示と異なり、Cafe 自身の稼働中の状態を直接開くため、32 MiB のコピー上限はありません。論理的な書き込み、チェックポイント、ジャーナル方式の変更はしません。ただし SQLite は WAL/SHM 補助ファイルを利用・作成し、子が終了するまでチェックポイントを遅らせる読み取りロックを保持する場合があります。大きいファイルや使用中のファイルは期限を超える場合があります。読み取りの前後で通常ファイルの同一性と設定パスを確認し、通常の WAL 更新は許可します。移植可能なパス検査ですべての悪意ある差し替え競合を防ぐとは保証しません。プロジェクトの非公開コピー方針とファイル上限は別のままです。

Validation uses generated SQLite files, synthetic authenticated sessions and browser fixtures. No user state database, account or provider is accessed. The inspected media shows the actual component with synthetic responses; it does not qualify a live installation.

検査は生成した SQLite、合成認証セッション、ブラウザー用の合成データを使います。ユーザーの状態データベース、アカウント、プロバイダーにアクセスしません。確認済みメディアは実際の部品と合成応答を示し、稼働中アプリへの導入を証明するものではありません。

[Before](pr-assets/application-state-preview/before.png) · [After](pr-assets/application-state-preview/after.png) · [Recording and details](pr-assets/application-state-preview/README.md)
