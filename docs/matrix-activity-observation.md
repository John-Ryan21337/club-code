# Provider-observed Matrix categories / プロバイダー報告による Matrix 分類

This first activity-route slice ports Club Code's existing classifier into current Cafe ingestion. It builds on [Matrix vocabulary #105](https://github.com/John-Ryan21337/club-code/pull/105), exact base `b996a95a3f385818604a0ec59ebbf172fcae06f9`. [Cafe issue 102](https://github.com/cafeai/cafe-code/issues/102) tracks this slice and the separate visual overlay. The source is Club `886feafc`; current Cafe provider versions and ingestion behavior remain authoritative.

活動経路の最初の差分として、Club Code の既存の分類処理を現行 Cafe のイベント取り込みへ接続します。上記の作業語彙ドラフトを前提とし、Cafe issue 102 でこの差分と別の描画差分を追跡します。現行 Cafe のプロバイダーバージョンと取り込み処理を維持します。

## Behavior / 動作

New started, updated and completed tool activities can carry an `observed` object with exactly two fields: `providerObserved: true` and one fixed category (`network`, `database`, `build`, or `agent`). The classifier uses canonical item types and bounded, sanitized structured tool identities or command prefixes. Unknown and conflicting evidence receives no category. It does not inspect titles, summaries or output to guess activity.

新しいツール開始・更新・完了イベントには、`providerObserved: true` と固定の分類1つ（`network`・`database`・`build`・`agent`）だけを持つ `observed` を追加できます。正規化された項目の種類と、長さを制限・整理した構造化ツール識別子またはコマンドの先頭を使います。不明・矛盾する情報には分類を付けません。タイトル・要約・出力から推測しません。

Classification does not execute a command, open a URL, read a database, or collect new provider data. Structured identity strings have a 128-character limit; commands have a 4,096-character limit, at most six parsed leading tokens and a 512-character token limit. The existing ingestion sanitizer runs before classification. Started events gain only the fixed observation, without adding a copy of their command data. Updated events retain the exact item ID, as started/completed events already do; turn IDs remain unchanged. Existing Codex asynchronous questions keep their earlier handling.

分類のためにコマンド実行・URL接続・データベース参照・新しいプロバイダーデータ収集は行いません。構造化識別子は128文字、コマンドは4,096文字までです。先頭から解析する要素は6個、各要素は512文字までです。既存の整理処理を先に実行します。開始イベントには固定の分類だけを追加し、コマンドデータのコピーは追加しません。更新イベントには、開始・完了と同様に正確な項目IDを保持します。ターンIDと既存の Codex 非同期質問の処理を維持します。

The existing opt-in vocabulary consumer can show the fixed BUILD/構築 or DATABASE/データベース labels from these observations. It still does not render source commands or raw item IDs. This slice does not add routes, packets, colors, timing settings, new polling or a separate visualization. The next overlay must retain exact thread/turn/item correlation, bounded expiry, and clear old route data before paint.

既存の任意の作業語彙表示は、この分類から固定の BUILD/構築 や DATABASE/データベースを表示できます。コマンド本文や生の項目IDは表示しません。この差分は経路・パケット・色・時間設定・新しい定期取得・別の可視化を追加しません。次の描画差分では、スレッド・ターン・項目の正確な対応、期限、切り替え前の古い表示の消去を維持する必要があります。

These are provider reports and conservative semantic categories, not proof of network traffic, database access, successful builds, real agent communication, or measured execution time. Existing stored activities are not rewritten. Historical fork proposals are not claimed to be merged or replaced automatically.

これはプロバイダーの報告と保守的な意味分類です。実際の通信・データベースアクセス・ビルド成功・エージェント通信・実行時間を計測または証明するものではありません。保存済みの過去のイベントは書き換えません。過去のフォーク提案が統合済み、または自動的に置き換わったとは扱いません。
