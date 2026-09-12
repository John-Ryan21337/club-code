# Synthetic SQLite viewer evidence

The capture uses the production Workspace observatory and database viewer with a synthetic environment API. It opens a tree entry, explicitly loads tables, reads rows, displays masking/truncation flags, and refreshes through the bounded row control. It does not query a real user database or account. Separate server tests exercise actual synthetic SQLite/WAL files and authenticated WebSocket RPC.

- `before.png`: the database preview before explicit table loading.
- `after.png`: bounded synthetic rows and the separate file-preview refresh controls.
- `interaction.webm`: 6.88 seconds; muted playback was decoded to its end and an ending frame inspected. The screenshot was also visually inspected for wrapping and clipping.

The generator is a development-only temporary capture harness. Its fixture and temporary browser configuration were removed before final repository checks. This evidence does not establish a physical GPU or native database performance claim.

本番の観測画面とデータベース表示を、合成の環境 API で操作した記録です。ツリーで選択し、明示的にテーブルと行を読み、マスキング・省略の表示と行の更新を確認します。実ユーザーのデータベースやアカウントは使いません。別のサーバーテストで合成 SQLite/WAL と認証付き WebSocket RPC を確認します。動画は6.88秒で、最後までデコードして終了付近の画像を確認しました。一時的な検証用コードは最終チェック前に削除しています。
