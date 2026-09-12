# Synthetic operational-state preview

[Before reading](before.png) · [Daily counters](after.png) · [Projection status](projection.png) · [7.6-second recording](interaction.webm)

The actual observatory and application-state panel use synthetic API responses with the worker's fixed counter columns and allowed projector names. The fixture explicitly loads the table list, reads daily counters, then selects projection status. It does not query a user database or prove backend authorization through the video.

The unedited recording is 278,819 bytes. It was decoded and a frame was inspected; all three screenshots were also inspected. Temporary capture source, configuration and duplicate video were removed. Separate synthetic server and authenticated RPC tests cover the backend.

日本語：[読み取り前](before.png)・[日次カウンター](after.png)・[投影処理の状態](projection.png)・[7.6 秒の動画](interaction.webm)。実際の観測画面と運用状態パネルに、固定のカウンター列と許可された投影処理名を含む合成 API 応答を使います。テーブル一覧・日次カウンター・投影処理の状態を順に明示的に読みます。ユーザーのデータベースは検索せず、動画でバックエンドの認可を証明するものではありません。動画は未編集の 278,819 バイトで、デコードしたフレームと三つの画像を確認しました。一時的な検査ファイルと重複動画は削除しました。サーバーと認証済み RPC は別の合成検査で確認します。
