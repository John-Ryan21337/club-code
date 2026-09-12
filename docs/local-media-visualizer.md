# Local media audio visualizer

This player integration follows the [bundled engine prerequisite PR109](https://github.com/John-Ryan21337/club-code/pull/109) for [Cafe issue 101](https://github.com/cafeai/cafe-code/issues/101). It applies to the session-only local player from [PR90](https://github.com/John-Ryan21337/club-code/pull/90). YouTube and Spotify frames, screen capture, microphone access, and music-reactive Matrix colors are separate features.

Select a local audio or video file, then turn on **Audio visualizer** in the local media settings or use **Visualizer** in the player header. The default is off. Spectrum is the first style. Choose MilkDrop in Settings to use the bundled preset catalog. Its player toolbar supports previous, next and random presets. Optional cycling uses a 30-second interval and a four-second blend. These choices remain in this document session; Clear turns analysis off and resets its choices.

MilkDrop can contain rapid motion and flashing colors. Analysis pauses when the media pauses, the window is hidden or unfocused, or reduced motion is active. Disabling the visualizer leaves normal playback controls available. No audio is recorded or uploaded. The controller admits only a marked local object URL or the local player's opaque VLC URL; this slice does not read remote player frames. Native VLC playback and individual codecs retain the limits documented in the native/player prerequisites.

Spectrum uses an FFT size of 256, one reused frequency buffer, 48 bars, at most 30 frames per second, and a bounded brightness step. Its canvas is capped at 2,048 pixels per edge and 1,048,576 pixels total. MilkDrop retains the separate engine limits and trusted bundled-preset boundary. The controller does not close another feature's audio graph. It retains the local element's audible connection while analysis is paused and closes its own graph when its component is removed. Display-audio approval helpers and the signal store are present as local prerequisites; no capture UI or Matrix consumer is activated here.

MilkDrop initialization is serialized. A stopped renderer remains owned by the same input across style changes or disabling analysis, so its canvas can be used again. Owner teardown releases it; replacing the input creates fresh canvases. A pending AudioContext is owned immediately and can be closed while its resume promise is waiting. Source approval is checked again after asynchronous boundaries.

The real Chromium fixture creates a 12-second sine-wave WAV in memory and plays it with browser audio output muted. It checks nonzero samples from the real analyser, real GPU draw calls, paused rendering, preset navigation, repeated Spectrum/MilkDrop transitions with a live WebGL context, and retained native controls. Screenshots and the video use the real player component. They demonstrate synthetic browser playback, not a user's file, account, desktop capture, installed Electron session, or every GPU/codec.

Run focused checks with `yarn workspace @cafecode/web test src/localMediaAudioVisualizer.test.ts src/localMediaAudioSignal.test.ts src/localMedia.test.ts`. The separate opt-in fixture is `yarn workspace @cafecode/web exec vitest run --config vitest.local-visualizer-capture.config.ts`. It requires Chromium with WebGL2. See [media notes](pr-assets/local-media-visualizer/README.md).

## 日本語

この変更は、同梱 MilkDrop エンジンに続くローカルプレーヤー用の差分です。音声または動画ファイルを選択し、設定またはプレーヤーの Visualizer ボタンで有効にします。初期状態はオフ、最初の形式は Spectrum です。MilkDrop では前・次・ランダムのプリセットを選べます。任意の自動切り替えは30秒間隔、ブレンドは4秒です。選択はこの画面のセッション内に保持し、Clear で解除します。

MilkDrop には速い動きや点滅が含まれます。再生の一時停止、非表示、フォーカス解除、動きを減らす設定で解析を一時停止します。録音やアップロードは行いません。無効にしても通常の再生操作は使えます。YouTube・Spotify のフレーム、画面音声取得、マイク、Matrix の音楽連動は、この差分では有効になりません。

検証はメモリー内で作成した12秒の合成 WAV を使用し、ブラウザーの音声出力をミュートします。実際の解析値、GPU 描画、一時停止、プリセット操作、再生ボタンの保持を確認します。画像と動画は実コンポーネントですが、ユーザーのファイル・アカウント・画面取得・インストール済み Electron アプリを検証したものではありません。すべての GPU やコーデックの動作を保証するものでもありません。
