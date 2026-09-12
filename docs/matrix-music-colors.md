# Matrix music colors / Matrix の音楽反応色

[Cafe issue #107](https://github.com/cafeai/cafe-code/issues/107) tracks this slice.

This incremental port adds **Music** and **Music Extra** to **Settings > Window atmosphere > Matrix color mode**. Its exact prerequisite is `bdda92a109698a076dbb823abb092d3f141aab76`, which combines [Matrix #100](https://github.com/John-Ryan21337/club-code/pull/100) and [local audio visualization #112](https://github.com/John-Ryan21337/club-code/pull/112). The prerequisite resolves duplicate schemas and excludes the added Matrix settings from profile imports; it preserves both legacy profile key lists.

この差分は、設定の Window atmosphere > Matrix color mode に **Music** と **Music Extra** を追加します。上記の Matrix とローカル音声表示を統合したコミットが前提です。前提コミットは重複スキーマを解消し、追加した Matrix 設定をプロファイルの取り込み対象から除外します。従来の二つのプロファイルキー一覧は維持します。

Enable falling effects, choose Matrix, and select Music or Music Extra. Start approved local playback through the local media player. Music uses one audio-driven palette; Music Extra gives each stream its own color phase. Quiet, unavailable, stale or future-dated samples use the configured fixed color. Selecting a color mode does not start playback, acquire audio, or open a microphone or chooser. The default mode remains Fixed and falling effects remain off by default.

落下効果を有効にし、Matrix と Music または Music Extra を選びます。ローカルメディアプレーヤーで許可された再生を開始します。Music は音声に応じた共通の配色を使い、Music Extra は各ストリームに異なる色の位相を与えます。無音、取得できない音声、古いサンプル、未来時刻のサンプルでは、設定した固定色を使います。色モードの選択だけでは、再生・音声取得・マイク・選択画面を開始しません。既定の色モードは Fixed、落下効果は既定で無効です。

Explicitly shared audio can also supply the existing approved stream boundary when [shared-audio controls #115](https://github.com/John-Ryan21337/club-code/pull/115) and its native prerequisite are integrated. That sibling is not included in this branch. The music mode does not infer audio from a YouTube or Spotify iframe. Live service audio and capture on every operating system remain unqualified.

[共有音声の操作 #115](https://github.com/John-Ryan21337/club-code/pull/115) とネイティブ前提を統合すると、明示的に共有した音声も既存の許可済みストリーム境界を通して使えます。この兄弟ブランチは本差分に含みません。YouTube や Spotify の iframe から音声を推測しません。実サービスの音声と全 OS の取得は未確認です。

The producer publishes only bounded level, bass, mid, treble and beat values in memory. Samples expire after 100 milliseconds. The atmosphere reads them in its existing frame loop; it does not add a sample subscription to React or a second animation loop. The shared Canvas scene applies the same palette to GPU glyph collection and Canvas fallback. Palette changes preserve the scene. Continuous hue motion is limited to 110 degrees per second, with an additional beat impulse of at most 22 degrees per fresh sample; lightness changes by at most 42 units per second after initialization. These are rendering bounds, not an accessibility certification.

生成側は、上限付きの音量・低音・中音・高音・拍の値だけをメモリーで公開します。サンプルは 100 ミリ秒で期限切れになります。描画側は既存のフレームループで読み取り、React のサンプル購読や第二のアニメーションループを追加しません。共通の Canvas シーンが GPU 文字と Canvas 代替描画に同じ配色を適用し、配色の変更でシーンを作り直しません。連続的な色相変化は毎秒 110 度まで、追加の拍の変化は新しいサンプルごとに最大 22 度です。初期化後の明度変化は毎秒 42 単位までです。これは描画の上限であり、アクセシビリティ認証ではありません。

Changing away from a music mode or losing atmosphere capability revokes publication synchronously. Hidden, unfocused or reduced-motion input does not publish audio samples. Reduced motion resolves its one static frame directly from an empty sample, so listener ordering cannot leave an old music color on screen. The existing source-owner and late-audio-initialization cleanup still apply. No audio samples, recording, source names or provider content are stored in settings or sent to a server.

音楽モードを解除した場合や雰囲気機能の許可が失われた場合は、公開を同期的に取り消します。非表示・非フォーカス・動きを減らす設定では音声サンプルを公開しません。動きを減らす場合の静止フレームは、空のサンプルから直接固定色を決めます。イベントの順序で古い音楽色を残しません。既存のソース所有権と遅れた音声初期化の解放処理も適用します。音声サンプル、録音、ソース名、プロバイダーの内容を設定に保存したりサーバーへ送ったりしません。

The [synthetic media](pr-assets/matrix-music/README.md) shows the real settings, analyser, WebGL glyph renderer and Canvas fallback. This headless host refused the production WebGL context and selected Canvas. The opt-in capture alone relaxes that context attribute to exercise actual shaders and context loss; it does not prove physical GPU acceleration or change production policy. No live user audio, microphone, chooser, account or playback service was used. Sibling console, privacy, work-vocabulary and activity-overlay integrations remain separate from this branch.

[合成データの検証資料](pr-assets/matrix-music/README.md)は、実際の設定・アナライザー・WebGL 文字描画・Canvas 代替描画を示します。このヘッドレス環境では本番の WebGL コンテキストを拒否し、Canvas を選びました。明示的な検証用キャプチャーだけがコンテキスト属性を緩め、実際のシェーダーとコンテキスト喪失を検査します。物理 GPU の高速化を証明せず、本番の規則も変更しません。ユーザー音声、マイク、選択画面、アカウント、再生サービスは使いません。コンソール、プライバシー、作業語彙、活動表示との兄弟機能の統合は別です。
