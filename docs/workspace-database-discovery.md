# Find project SQLite files / プロジェクト内の SQLite 検索

This incremental port adds an explicit **Find SQLite files / SQLite を探す** action to the workspace observatory. It builds on [project database previews #114](https://github.com/John-Ryan21337/club-code/pull/114), exact `4ae938a5021313e68a537d3a33ab59e285302486`. [Cafe issue105](https://github.com/cafeai/cafe-code/issues/105) tracks this slice.

この差分は、ワークスペースの観測画面に明示的な SQLite 検索を追加します。上記のプロジェクト内データベース表示を前提とします。

Open a project's observatory and select **Find SQLite files**. The scan starts only on this action. Select a result to open the existing database viewer, then select **Load tables** to read its tables. Finding a file does not run SQLite queries. No scan, database read, or refresh starts automatically.

プロジェクトの観測画面を開き、**SQLite を探す**を選びます。この操作で初めて検索します。結果を選ぶと既存のデータベース表示を開きます。テーブルを読むには **Load tables** を選びます。検索中は SQLite クエリーを実行しません。検索・データベースの読み取り・更新を自動では開始しません。

The server uses the selected project's registered root. It checks the first 16 bytes of observable regular files for the SQLite header, including files without an extension. It excludes existing hidden, generated, sensitive-name and linked paths. Reads use a regular-file descriptor with the available no-follow and nonblocking flags, and check file identity and path containment. The project root is checked again before results return. No application-state database outside that project is included.

サーバーは、選択プロジェクトの登録済みルートを使います。拡張子のない通常ファイルも含め、先頭 16 バイトの SQLite ヘッダーを確認します。既存の規則で隠しパス・生成物・機密情報らしい名前・リンクを除外します。利用可能なリンク拒否・非ブロックのフラグで通常ファイルを開き、ファイルの同一性とルート内のパスを確認します。結果を返す前にプロジェクトのルートも再確認します。プロジェクト外のアプリケーション状態データベースは含みません。

The scan can return at most 40 paths. It schedules at most 128 directories, including the root, descends at most six levels, inspects at most 2,000 directory entries, and attempts at most 64 file-header checks. Each directory also retains the existing bounded listing. Ordinary files consume the header-check budget, so a later database can be missed. Limits or unreadable entries produce a partial result. Withheld names are reported separately. These are scan limits, not a guarantee of complete discovery.

結果は最大 40 パスです。ルートを含む最大 128 ディレクトリー、最大 6 階層、最大 2,000 項目を調べ、ファイルヘッダーの確認は最大 64 回です。各ディレクトリーにも既存の一覧上限があります。通常ファイルもヘッダー確認の回数を使うため、後のデータベースを見つけられない場合があります。上限や読み取れない項目があると、結果は一部だけになります。名前を非表示にした場合は別に表示します。すべてのデータベースを見つける保証ではありません。

Discovery uses the existing four-operation pool and five-second filesystem-operation deadline. A timed-out operation retains its slot until the underlying I/O settles; the loop also checks its deadline before further work. The UI waits at most 20 seconds and ignores late results. This does not cancel an accepted server operation. Results and selection belong to the exact connection and project. Reopen the observatory after a connection change.

検索は既存の同時 4 処理と、ファイルシステム処理の 5 秒期限を使います。時間切れでも、実際の入出力が終わるまでは処理枠を保持します。検索ループも次の処理の前に期限を確認します。画面は最大 20 秒待ち、遅れた結果を無視します。これはサーバーが受け付けた処理の取り消しではありません。結果と選択は正確な接続・プロジェクトに結び付けます。接続が変わった場合は観測画面を開き直してください。

A matching header does not prove database integrity, readable tables, or compliance with the preview's separate file/WAL size limits. Another process can change a file after discovery; the viewer checks it again. The portable path checks do not provide an atomic traversal or a sandbox against a hostile workspace writer. Name exclusions are best effort and do not prove that a returned path contains no private information. Primary-key comparisons and global application-state access remain separate work.

ヘッダーの一致は、データベースの完全性・テーブルの読み取り・表示機能の別のファイルや WAL サイズ上限への適合を証明しません。検索後に他の処理がファイルを変更できるため、表示時に再確認します。移植可能なパス検査は、不可分な探索や悪意あるワークスペース書き込み者に対するサンドボックスではありません。名前の除外だけで、結果に非公開情報がないと証明することもできません。主キー比較とアプリケーション全体の状態へのアクセスは別の作業です。

Tests use temporary synthetic workspaces, a real generated SQLite database, and authenticated WebSocket forwarding. UI fixtures use synthetic results. No real user database or account is scanned. Required local gates and independent review apply before publication; this guide does not claim live deployment or GitHub CI success.

検査では一時的な合成ワークスペース、生成した実際の SQLite データベース、認証済み WebSocket の転送を使います。画面の検査結果は合成データです。ユーザーの実際のデータベースやアカウントは検索しません。公開前に必要なローカル検査と独立レビューを実施します。この説明は、稼働中アプリへの導入や GitHub CI の成功を主張しません。

Synthetic UI evidence: [before](pr-assets/workspace-database-discovery/before.png), [after](pr-assets/workspace-database-discovery/after.png), and [6.68-second interaction](pr-assets/workspace-database-discovery/interaction.webm). The recording shows an explicit scan, an extensionless result, and a separate table read. The video was decoded and a frame was inspected.

合成データの画面検証：[操作前](pr-assets/workspace-database-discovery/before.png)、[操作後](pr-assets/workspace-database-discovery/after.png)、[6.68 秒の操作動画](pr-assets/workspace-database-discovery/interaction.webm)。明示的な検索、拡張子のない結果、別の操作でのテーブル読み取りを示します。動画をデコードし、フレームを確認しました。
