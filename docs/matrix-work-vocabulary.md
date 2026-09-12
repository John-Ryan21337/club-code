# Selected-thread Matrix work vocabulary

This incremental proposal extends Matrix runtime PR #100 at `1fb29f2b`. It ports the
live vocabulary from Club `886feafc` to current Cafe APIs. See
[Cafe issue #98](https://github.com/cafeai/cafe-code/issues/98).

In **Settings → Appearance → Window atmosphere**, enable falling effects, select
Matrix, then enable **Live work vocabulary / 作業語彙**. The default is off. Reset
window atmosphere turns it off. The setting uses the existing shared server
settings; it is not a separate device consent or native-client authority.

The selected route supplies an explicit environment and thread. Only its retained
activity tail contributes labels. Settings pages, drafts, unresolved routes and a
disabled effect supply no work labels. Completed activity can remain in that tail;
the words do not mean that a task is currently running. This adds no provider
request, polling, event collection or filesystem read.

日本語：設定の Appearance → Window atmosphere で降下エフェクトを有効にし、Matrix
を選んで **Live work vocabulary / 作業語彙** をオンにします。初期値はオフです。
背景設定のリセットでもオフになります。これは既存の共有サーバー設定であり、端末別の
同意やネイティブクライアントの権限ではありません。選択中の環境とスレッドに保持された
活動だけを使います。設定画面・下書き・未解決の経路では作業語彙を表示しません。
完了した活動も含まれるため、文字の表示は実行中という証拠ではありません。
プロバイダー要求・ポーリング・イベント収集・ファイル読み込みは追加しません。

## Data and display bounds

- Inspect at most the last 160 retained activities and emit at most 32 terms per language.
- Read fixed structured operation fields. Never classify free-form summaries,
  command text, prompts or file contents.
- File-bearing work may contribute allowlisted structured path fields. Display
  only the basename, filtered for sensitive names/extensions and common opaque
  identifiers, with a 32-character display cap. A path longer than 4,096 characters
  is ignored.
- Traverse at most 256 nodes per structured input, depth 5, and 4,096 nodes across
  the complete activity tail. Arrays and objects admit at most 32/64 child entries.
  Read own data properties, skip accessors and cycles, and collect filenames once
  for both languages. Encoded vocabulary is capped at 8,192 characters.
- Use whole operation words, not substring guesses. Fixed concepts have English
  and Japanese equivalents. Filenames retain their original spelling in both pools.
- Assign a work label only to a stream head. Both Canvas and GPU consume the same
  scene traversal and existing text-width/font/instance limits.

These filters are best effort. An ordinary-looking filename can still reveal
private work. Turn the setting off before screen sharing. It is presentation,
not a secret scanner or an access-control boundary.

日本語：直近160件までの活動から、各言語32語までを生成します。固定の構造化操作名と
許可されたパス項目だけを読み、自由記述の要約・コマンド・プロンプト・ファイル内容は
分類しません。ファイル名は機密語・拡張子・一般的な不透明識別子を除外し、基底名のみ
32文字まで表示します。長さ4,096文字を超えるパスは無視します。構造の探索は入力ごと
256ノード、深さ5、活動全体で4,096ノードまでです。配列32項目・オブジェクト64項目を
上限とし、アクセサーや循環参照を使いません。符号化語彙の上限は8,192文字です。
操作名は単語単位で対応させ、ファイル名は両言語で同じ表記を保ちます。
フィルターを通った通常の名前にも非公開情報が残る場合があるため、画面共有前にオフに
してください。機密検出やアクセス制御の機能ではありません。

## Lifecycle and adoption limits

A committed route change replaces labels before browser paint. The previous GPU
surface is hidden until its replacement atlas is ready; the existing Canvas path
can immediately draw the new labels. Particle positions, velocity and lifecycle
are preserved. Reduced motion updates its static frame without starting a loop;
hidden-window and background-animation policy remain unchanged.

This prerequisite does not contain Club's generic appearance-profile importer or
meeting-privacy port. When combining those proposals, keep live vocabulary outside
automatic profile activation and suppress it with private project presentation.
Do not assume independent green branches provide those combined guarantees.
Activity links, 2ch enrichment, music response and hardware lighting are separate
features. Current Cafe has fewer provider-observed operation fields than Club;
this slice uses only available evidence and does not infer missing categories.

日本語：経路の確定時に、次の描画より前に語彙を置き換えます。古いGPU画面は新しい
アトラスが使えるまで非表示にし、既存Canvas経路ですぐに新しい語彙を描画できます。
粒子の位置・速度・寿命は維持します。動きを抑える設定では静止画だけを更新し、非表示時
とバックグラウンド描画の方針も維持します。プロフィールの自動適用や会議中の表示保護は
この基準ブランチに含まれません。組み合わせる際は作業語彙の自動有効化を禁止し、非公開
プロジェクトの表示抑制と連携して再検証してください。活動リンク・2ch表現・音楽反応・
ハードウェア照明は別機能です。現行Cafeにない観測項目を推測して補いません。

## Verification

Independent audit repaired substring category matches, accessor reads and the
aggregate traversal budget. Synthetic unit and Chromium regressions cover exact
route isolation, secret-looking filenames, malformed input, getter/cycle bounds,
stream-head token rendering, no reseed, disablement and reduced motion.

The full workspace graph passed 10/10 tasks, including 2,004 server tests and its
one existing POSIX-only bootstrap FIFO skip on Windows. Full type checking passed.
The full browser run exposed an incomplete GPU-test store mock; that fixture now
provides the selected-route seam while retaining its real WebGL checks.

The [before image](./pr-assets/matrix-work-vocabulary/before.png),
[after image](./pr-assets/matrix-work-vocabulary/after.png), and
[8.6-second interaction video](./pr-assets/matrix-work-vocabulary/interaction.webm)
use actual components and styles with synthetic activities. The video was decoded
and inspected: enabling labels, changing the fixture thread and disabling labels
are visible. This is browser rendering evidence, not hardware acceleration or
physical-device qualification.

Final formatting, lint and type checks passed. All 332 Chromium tests passed, then
the forced desktop build passed 3/3 tasks. The generated renderer and server
settings schema were checked for the new vocabulary setting.
