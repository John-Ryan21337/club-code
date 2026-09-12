# Compare database previews / データベース表示の比較

This incremental feature builds on [project SQLite previews #114](https://github.com/John-Ryan21337/club-code/pull/114), exact `4ae938a5021313e68a537d3a33ab59e285302486`. It compares successive previews and adds an optional ten-second row refresh. [Cafe issue106](https://github.com/cafeai/cafe-code/issues/106) tracks this slice. Database discovery #116 is a separate compatible feature.

この差分は、上記のプロジェクト内 SQLite 表示を前提とします。続けて取得した表示を比較し、任意の 10 秒ごとの行更新を追加します。データベース検索 #116 は別の機能です。

Select a database, load its tables, and select a table. Select **Refresh rows** to compare a new accepted snapshot with the previous one. The comparison reports rows new to the snapshot, rows missing from it, and changed preview strings. It shows at most 40 differences while counting all differences within the bounded snapshots. It does not compare unrelated paths, tables, column orders or row limits.

データベースを選んでテーブルを読み、テーブルを選びます。**行を更新**で、新しく受け付けたスナップショットと前回の表示を比較します。今回だけの行、前回だけの行、表示文字列の変化を示します。上限付きスナップショット内の差を数え、最大 40 件を表示します。異なるパス・テーブル・列順・行数上限は比較しません。

Matching requires complete, unmasked snapshots with compatible primary-key metadata. The fixed worker hashes bounded typed key representations, including every visible primary-key column in declared order. Integer and text keys retain their SQLite byte representations; finite REAL keys use native binary64 values. It does not derive keys from the displayed text, which can lose distinctions through formatting or embedded NUL characters. Missing keys, null/blob/oversized/nonfinite key values, hidden key columns, masked values or truncated previews disable matching. Old servers without key metadata still show previews but cannot provide row matching.

照合には、省略やマスキングがなく、主キー情報が対応するスナップショットが必要です。固定の処理プログラムは、表示対象のすべての主キー列を宣言順に使い、上限付きの型付きキー表現をハッシュ化します。整数と文字列は SQLite のバイト表現を保持し、有限の REAL キーはネイティブの binary64 値を使います。書式や NUL 文字で区別が失われる表示文字列からキーを作りません。キーなし、null・バイナリー・長すぎる値・有限でない値、非表示のキー列、マスキング、省略がある場合は照合しません。キー情報を返さない旧サーバーでも表示はできますが、行の照合はできません。

These are preview differences, not a database audit log or proof of insert, update or delete operations. Key representations do not establish SQL collation equivalence. Non-key cells are compared as displayed strings: a database type or hidden value change that renders the same text is not detected, including omitted BLOBs or content after a displayed NUL. Hashes are matching identifiers, not authentication or a promise of anonymization.

これは表示の差であり、データベースの監査ログや追加・更新・削除操作の証明ではありません。キー表現は SQL の照合規則で同値かどうかを証明しません。キー以外の値は表示文字列で比較するため、型や非表示の値が変わっても同じ文字列になる場合は検出しません。省略された BLOB や、表示中の NUL より後の内容も含みます。ハッシュは照合用の識別子であり、認証や匿名化の保証ではありません。

Automatic refresh is off by default. **Refresh every 10 seconds** starts it only for the open table. It pauses while the window is hidden or unfocused, admits one UI read at a time, and stops on an error, table or row-limit change, connection replacement, or closing the viewer. **Stop row refresh** prevents future reads; an already accepted read can still finish and update the preview. No refresh starts when a viewer opens.

自動更新は既定でオフです。**10 秒ごとに更新**で、開いているテーブルの更新を始めます。非表示やフォーカスがない間は休止し、画面からの読み取りは同時に 1 回だけです。エラー、テーブル・行数上限・接続の変更、表示の終了で停止します。**行の自動更新を停止**は次の読み取りを止めます。すでに受け付けた読み取りは完了して表示を更新する場合があります。表示を開くだけでは自動更新を開始しません。

Snapshots and comparisons stay in the mounted viewer's memory and are hidden after connection replacement. The exact connection, project and path remain the caller's scope. The existing private-copy reader, fixed SQL, file/WAL limits, process deadline, output cap and source-root checks remain in force. No global application-state database access or arbitrary SQL is added. A UI timeout does not cancel an accepted server operation. The original portable path and non-atomic snapshot limitations still apply.

スナップショットと比較は、開いている表示のメモリー内に保持し、接続が変わると非表示にします。正確な接続・プロジェクト・パスを呼び出し元の範囲として維持します。既存の非公開コピー、固定 SQL、ファイルと WAL の上限、処理期限、出力上限、ルート確認を使います。アプリケーション全体の状態へのアクセスや任意 SQL は追加しません。画面の時間切れは、サーバーが受け付けた処理の取り消しではありません。既存の移植可能なパス検査と不可分ではないスナップショットの制約も残ります。

Tests use synthetic temporary SQLite databases and browser API fixtures. No user database or account is read. Required local gates, independent source review and final synthetic media apply before publication; they do not establish live deployment or GitHub CI success.

検査は一時的な合成 SQLite と、ブラウザー用の合成 API を使います。ユーザーのデータベースやアカウントは読みません。公開前に必要なローカル検査・独立レビュー・最終的な合成メディアを用意します。これらは稼働中アプリへの導入や GitHub CI の成功を証明しません。

[Before](pr-assets/workspace-row-comparisons/before.png) · [After](pr-assets/workspace-row-comparisons/after.png) · [Synthetic recording](pr-assets/workspace-row-comparisons/interaction.webm) · [Media details](pr-assets/workspace-row-comparisons/README.md)
