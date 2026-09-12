# Synthetic Matrix music evidence

- [Before: fixed color](before.png)
- [Music](music.png)
- [Music Extra](extra.png)
- [Canvas after real context loss](canvas.png)
- [Fixed mode after signal revocation](stopped.png)
- [Unedited 6.72-second interaction](interaction.webm)

The opt-in `MatrixAudio.capture.tsx` mounts the production settings, atmosphere and local audio analyser with a generated oscillator routed to a media-stream destination. It has no audible output connection and Chromium is muted. Approval is a fixture action. Focus is fixed for this headless check. No microphone, chooser, user audio, account or external playback service is used.

The host refused production WebGL acquisition (`webgl2-unavailable`), which correctly selected Canvas. Only this capture retries with relaxed context attributes, permitting software WebGL. It then observes real instanced draws, a zero GL error, nonzero analyser output, audio-derived palette values, actual context loss with Canvas fallback, and signal revocation. The screenshots and a decoded video frame were inspected. This is real rendering with synthetic audio, not a physical-GPU or live-service qualification.

Run explicitly with the pinned Yarn and Node environment:

```sh
yarn workspace @cafecode/web exec vitest run --config vitest.matrix-audio-capture.config.ts
```

This capture is separate from normal browser tests. It writes screenshots and a raw video under this owned media directory.

日本語：合成音声を使い、実際の設定・解析・WebGL 文字描画・Canvas 代替描画・公開の取り消しを検査しました。動画は未編集の 6.72 秒で、デコードしたフレームを確認しました。本番の WebGL 取得が拒否されたため、検証用キャプチャーだけが属性を緩めています。ソフトウェア WebGL を許可する検査であり、物理 GPU や実サービスの動作確認ではありません。マイク・選択画面・ユーザー音声・アカウントには接続しません。
