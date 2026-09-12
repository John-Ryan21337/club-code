# Native current-frame audio capture

This is the desktop prerequisite for [Cafe issue103](https://github.com/cafeai/cafe-code/issues/103). It is based on the trusted-renderer IPC change in [Cafe PR75](https://github.com/cafeai/cafe-code/pull/75). The separate renderer draft will add an explicit Start/Stop action and the analyser/visualizer. This prerequisite adds no product button or automatic capture.

Electron's handler grants a request only when it has a renderer user gesture, requests audio and video, and belongs to the exact live Cafe main frame. The frame must have the configured renderer origin and be visible, and its web contents must be focused. Other frames, origins, inactive windows and stale handlers receive no stream. Electron can serialize the requesting origin with a root slash; the guard accepts only that form or the exact configured origin, never another path, query, fragment or credentials.

The grant uses the trusted frame for both audio and video. It does not use a system-wide loopback source, desktop source enumeration or a native source chooser. Local echo remains enabled so the existing player stays audible. The renderer follow-up must immediately stop video tracks, retain only session audio and stop it on the relevant lifecycle boundaries. Browser builds have a different browser-controlled chooser and must describe that difference.

The session has one display-media handler. This module tracks its current owner; cleanup from an older Cafe window cannot remove the replacement owner's handler. Closed/destroyed windows remove their handler. This ownership protection covers installations through this module; another subsystem that replaces the same Electron session handler must coordinate that singleton boundary.

Run `yarn workspace @cafecode/desktop test src/window/DesktopDisplayMediaCapture.test.ts src/window/DesktopWindow.test.ts`. The separate opt-in native probe is `node apps/desktop/scripts/display-frame-audio-smoke.mjs`. It transpiles the exact source into an owned temporary folder, creates an isolated user-data profile and synthetic loopback page, and launches a separate Electron process with a restricted environment. An offscreen-window test flag disables native occlusion calculation; production does not add that flag. A native mouse click requests the current frame's stream while synthetic audio output is zero and the window is muted. The check requires audio/video tracks, stops both and closes the owned window. It has a 45-second host deadline and prints a source hash and report path.

The probe qualifies stream admission and teardown for the tested Electron/platform combination. It does not prove nonzero samples from YouTube/Spotify, system-audio capture, every operating system, or a user's logged-in player. No live app is restarted, microphone requested, account opened or user audio recorded.

## 日本語

この差分は、明示的な音声取得操作を追加する前の Electron 側の前提実装です。製品のボタンや自動取得は追加しません。ユーザー操作、正確な Cafe メインフレーム、設定済みオリジン、表示状態、フォーカスを確認してから、そのフレームだけの音声と映像を許可します。システム全体の音声や別ウィンドウを取得する許可ではありません。

後続の画面実装は、映像トラックをすぐ停止し、セッション中の音声だけを使用します。古いウィンドウの終了処理が新しい所有者のハンドラーを削除しないようにします。別機能が同じ Electron セッションのハンドラーを変更する場合は調整が必要です。

検証は専用の一時プロファイルと別 Electron プロセスを使用し、合成ページをネイティブのクリックで操作します。音声出力はゼロで、ウィンドウもミュートします。トラックの取得と停止を確認しますが、YouTube・Spotify の実音声、全 OS、ログイン済みプレーヤーを検証したものではありません。実行中アプリの再起動、マイク取得、ユーザー音声の録音は行いません。
