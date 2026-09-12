# Bundled MilkDrop engine

This is the engine prerequisite for [Cafe issue 101](https://github.com/cafeai/cafe-code/issues/101), based on the local-media player in [draft PR90](https://github.com/John-Ryan21337/club-code/pull/90). It provides a controller and preset catalog. It does not mount product controls, start playback, read files, or request microphone or screen access. The player integration is a separate incremental draft.

`loadMilkdropPresetNames()` loads the bundled engine and six preset packs on demand. `activateMilkdropVisualizer()` takes a caller-owned `AudioContext`, a source node from that same context and a dedicated canvas. It returns either a controller or a fixed failure code. The controller supports preset selection, next/previous/random navigation, optional cycling, resize, pause, resume and idempotent destruction.

The canvas has a 4,096-pixel edge limit and a 4,194,304-pixel area limit. Frame rate is bounded at 60 FPS. Preset cycles range from 3 to 3,600 seconds; blends are capped at 30 seconds. Render, resize and context-loss failures stop the loop. The caller must stop when hidden or paused and destroy any late activation that no longer belongs to its current view. Dynamic module imports themselves cannot be cancelled.

Butterchurn 2.6.7 and butterchurn-presets 2.4.7 use MIT licenses. The lockfile retains existing Cafe dependencies and adds the pinned packages and their runtime dependencies, including legacy Babel 6/core-js 2 for the preset package. The six packs are main, Extra, Extra2, MD1, Minimal and NonMinimal. Duplicate names use the first pack; ordering is independent of locale.

The library compiles bundled preset equations as JavaScript and GLSL. These are trusted third-party programs, not inert data or a sandbox. This wrapper exposes no preset upload, URL, external image or code input. It does not weaken a Content Security Policy; environments that prohibit the library's code generation may report a fixed initialization failure. See the pinned package code and [Butterchurn source](https://github.com/jberg/butterchurn) and [preset source](https://github.com/jberg/butterchurn-presets) before changing this boundary.

Stop disconnects only Butterchurn's analysis destination. It does not disconnect the source's other outputs or close the caller's audio context. Destruction also cancels the RAF, removes the context-loss listener and releases WebGL resources. The library has no public destructor, so release uses `WEBGL_lose_context` when supported; final reclamation otherwise depends on the browser.

Run deterministic tests with `yarn workspace @cafecode/web exec vitest run src/milkdropVisualizer.test.ts`. Run the separate real browser check from the repository root with `node apps/web/scripts/milkdrop-engine-smoke.mjs`. The check uses a synthetic oscillator behind zero output gain, blocks external requests and checks actual pixels, navigation, stop/resume, an independent analysis branch and cleanup. It needs Chromium/WebGL2 and has a 90-second deadline. It is not part of the default unit suite and does not qualify every GPU or preset.

## 日本語

この変更は MilkDrop のエンジンと同梱プリセットを提供する前提 PR です。製品の UI、再生、ファイル読み込み、マイクや画面の取得は有効にしません。プレーヤーへの接続は別の増分 PR で行います。

明示的な呼び出しで同梱モジュールを読み込みます。呼び出し側が所有する AudioContext、同じコンテキストの音声ノード、専用の canvas を渡します。プリセット選択、順送り・逆送り・ランダム選択、任意の自動切り替え、サイズ変更、一時停止、再開、破棄を提供します。

canvas は各辺 4,096 ピクセル、面積 4,194,304 ピクセル、描画は最大 60 FPS です。切り替え間隔は 3～3,600 秒、ブレンドは最大 30 秒です。描画・サイズ変更・コンテキスト消失のエラーでループを停止します。非表示や一時停止への対応、古くなった非同期結果の破棄は呼び出し側が行います。モジュールの読み込み自体は中止できません。

Butterchurn 2.6.7 とプリセット 2.4.7 は MIT ライセンスです。同梱プリセットの式は JavaScript と GLSL として実行されるため、信頼する外部コードとして扱います。アップロード、外部 URL、画像、コードの入力は受け付けません。CSP は緩和しません。停止は専用の解析接続だけを外し、他の出力や呼び出し側の音声コンテキストを保持します。

検証コマンドは上記を参照してください。ブラウザー検証は合成信号を出力ゲイン 0 で使い、実際の音声やアカウントを読みません。すべての GPU やプリセットの動作を保証するものではありません。
