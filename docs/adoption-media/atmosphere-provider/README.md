# Provider interpreter review media

The screenshots and recording show the real Atmosphere Console and falling-effect renderer. Provider account metadata, model responses, and settings acknowledgements are synthetic. No provider process, account, project, or chat was accessed.

Run this opt-in capture from the repository root:

```text
corepack yarn workspace @cafecode/web exec vitest run --config vitest.atmosphere-provider-capture.config.ts
```

The capture is excluded from default browser tests. It records local-first presentation, explicit Claude instance/model selection, a validated snow command, and a local refusal with no second provider request. The video is the unedited Playwright recording. This is browser component evidence, not a physical GPU or live provider qualification.

日本語：実際のコンソールと背景描画を使用し、アカウント、モデル応答、設定確認は合成データです。プロバイダーの起動や実際のアカウントへの接続は行いません。明示的な選択、検証済みコマンド、追加のモデル要求を伴わないローカル拒否を記録します。
