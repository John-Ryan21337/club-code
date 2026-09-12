# MilkDrop engine verification media

The images and recording show the real bundled engine in a dedicated verification fixture. They do not show a new product screen. The separate player integration supplies product controls.

Run `node apps/web/scripts/milkdrop-engine-smoke.mjs` from the repository root. An optional first argument selects another output directory. The script starts an owned loopback Vite server and Chromium, and closes both afterward. It uses the repository-pinned dependencies and a synthetic oscillator behind zero output gain. It does not read a microphone, file, screen or account. Nonlocal requests are blocked and cause failure.

- `before.png`: the fixture before engine activation.
- `after.png`: actual bundled rendering after preset navigation and pause/resume.
- `interaction.webm`: the unedited recording of that run.

The checks require actual nonzero rendered pixels, more than one preset, changed selection, a stable frame count while stopped, an independent caller-owned analyser that still receives the synthetic signal, and cleanup without late frames. A successful run is not evidence that every preset or GPU works, or that a live media source was tested.

日本語：画像と録画は専用の検証画面で動く実際の同梱エンジンです。製品の新しい画面ではありません。合成信号を出力ゲイン 0 で使い、マイク、ファイル、画面、アカウントは読みません。外部通信は拒否します。描画、選択変更、一時停止と再開、既存の解析接続の保持、破棄後の停止を確認します。すべてのプリセットや GPU の動作を保証するものではありません。
