# Cafe feature adoption PR index

This index tracks the missing-feature ports started on 11 September 2026.
Published heads and remaining work were checked again on 12 September 2026.
The comparison is Club `886feafcdcda4475c34396dc6d46c77cde7f010e` against
Cafe dev `99fbaec89da429924171c89d66a8f3455e42d9b0`.
The [earlier inventory](./cafe-code-adoption-2026-09.md#existing-cafe-proposals)
lists the existing proposals that these ports extend.

日本語：2026年9月11日に開始した未移植機能のPR一覧です。比較対象は上記のClubとCafeのコミットです。
既存の提案はリンク先の一覧にあります。作業中の項目を公開済みのPRとして扱わないでください。

## How to adopt a feature

Small independent changes are submitted directly to Cafe. Larger features are incremental
drafts in the Club fork, linked from Cafe issues. This follows Cafe's request for
small, issue-first contributions. A fork draft is available to review and fetch;
it is not an upstream merge or a released binary.

Start from the exact base shown in the PR. The published fork branch
`adoption/cafe-dev-base-20260911` points to the Cafe dev commit above. Preserve
current Cafe provider adapters and SDK versions. Cherry-pick or merge the listed
prerequisites before the feature commits, then run the combined checks. Separate
PRs can touch the same settings or root component; their individual green checks
do not prove an arbitrary combination merges cleanly.

日本語：小さな独立変更はCafeへのPR、大きな機能はClubフォークの差分ドラフトPRとして公開し、
CafeのIssueからリンクします。各PRの基準コミットと依存PRを確認してから取り込んでください。
現行Cafeのプロバイダー実装とSDKを維持し、組み合わせた状態でも検証してください。
ドラフトの公開は上流へのマージやバイナリのリリースを意味しません。

## Published adoption changes

Each row links to its implementation, exact head, validation, and limits.
The new software PRs below passed formatting, lint, type checking, the full
workspace test graph, and a forced desktop build before publication. Focused
runtime evidence is scoped separately in each PR. Synthetic fixtures do not
qualify every physical device or provider account.

| Feature / 機能                                                           | PR and head                                                                 | Adoption boundary                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider daemon scheduling / デーモン優先度                              | [Cafe #74](https://github.com/cafeai/cafe-code/pull/74), `573cd9b6`         | Direct to dev. Lower scheduling priority for the daemon and ordinary descendants; not a RAM/GPU limit.                                                                                          |
| Desktop IPC authority / IPCの送信元検証                                  | [Cafe #75](https://github.com/cafeai/cafe-code/pull/75), `cadc2e7f`         | Direct to dev. Exact owner frame and main-frame navigation checks.                                                                                                                              |
| App Claude access check / アプリ内Claude接続確認                         | [Club #69](https://github.com/John-Ryan21337/club-code/pull/69), `ffe937dd` | Direct to the Cafe adoption base. Checks the selected model through the current SDK; does not certify every saved account. [Cafe issue #69](https://github.com/cafeai/cafe-code/issues/69).     |
| External CLI access check / 外部CLI接続確認                              | [Club #71](https://github.com/John-Ryan21337/club-code/pull/71), `77a6a51d` | Direct to the Cafe adoption base. Isolated Claude preflight with bounded execution. Codex is explicitly unverified when safe probe isolation is unsupported.                                    |
| Native browser tabs / ネイティブブラウザーのタブ                         | [Club #70](https://github.com/John-Ryan21337/club-code/pull/70), `53ba65fb` | Requires Cafe #63, #64 and #75. Native lifecycle passed 12 real Electron checks. Renderer and broker integration are separate units.                                                            |
| Browser broker and provider transport / ブラウザー仲介とプロバイダー接続 | [Club #72](https://github.com/John-Ryan21337/club-code/pull/72), `19eba5d1` | Based on browser foundations #63/#64. Requires native runtime and renderer to provide an end-to-end browser. [Cafe issue #70](https://github.com/cafeai/cafe-code/issues/70).                   |
| Meeting privacy / 会議中の表示保護                                       | [Club #75](https://github.com/John-Ryan21337/club-code/pull/75), `baf86b58` | Direct to the Cafe adoption base. Presentation masking; no content redaction. Web Push/history limits and local manual-queue behavior are documented.                                           |
| World clock and optional weather / 世界時計と任意の天気表示              | [Club #76](https://github.com/John-Ryan21337/club-code/pull/76), `57e79752` | Direct to the Cafe adoption base. One to six cities; weather uses separate device-local consent and bounded fixed-endpoint requests.                                                            |
| Native window opacity / ウィンドウ透明度                                 | [Club #77](https://github.com/John-Ryan21337/club-code/pull/77), `5362eaad` | Direct to the Cafe adoption base. Native API values verified; compositor capture inconclusive. Packaged-release capability gate stays empty until visual qualification.                         |
| Packaged update-target audit / 更新先の検証                              | [Cafe #84](https://github.com/cafeai/cafe-code/pull/84), `01bd7908`         | Direct to dev. Bind the packaged audit to the actual artifact manifest, including fork update targets.                                                                                          |
| Browser workspace and context handoff / ブラウザー画面とコンテキスト送信 | [Club #79](https://github.com/John-Ryan21337/club-code/pull/79), `7fcd074a` | Requires native runtime and broker at combined base `28cd002c`. Split, resize, minimize, retained tabs and explicit review before Send/Queue. 321 browser tests passed.                         |
| Offline English/Japanese OCR / 英語・日本語のオフラインOCR               | [Club #80](https://github.com/John-Ryan21337/club-code/pull/80), `20bbf313` | Based on native runtime `53ba65fb`. Visible-document checks before capture and after async recognition; packaged ASAR verified with 14 synthetic checks.                                        |
| English/Japanese/bilingual UI / 英語・日本語・二言語のUI                 | [Club #81](https://github.com/John-Ryan21337/club-code/pull/81), `a12e553c` | Direct to the Cafe adoption base. 673 supported authored labels; device-local language preference. User messages, code, and project names retain their original text. 309 browser tests passed. |

日本語：上の新規ソフトウェアPRは、公開前に整形・lint・型検査・全ワークスペースのテスト・
強制デスクトップビルドを通過しています。実行時の証拠と制限は各PRを確認してください。
合成データによる検証は、すべての実機やアカウントでの動作保証ではありません。

## Additional published ports checked on 12 September

These rows extend the published table above. PR numbers are repository-specific:
Cafe #94 and Club #94 are different proposals. All entries below are draft proposals,
not merged upstream features or installed releases. Each software change passed its
required checks and forced desktop build before publication; the PR records the exact scope.

日本語：以下は追加の公開済みドラフトです。Cafe #94 と Club #94 は別の提案です。
上流へのマージやインストール済みリリースを意味しません。各変更は公開前に必須検証と
強制デスクトップビルドを完了し、検証範囲と制限を各 PR に記録しています。

| Feature / 機能                                                                   | PR and head                                                                   | Adoption boundary                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundled audit skill / 同梱監査スキル                                             | [Club #82](https://github.com/John-Ryan21337/club-code/pull/82), `8b22ba4d`   | Direct to the Cafe adoption base. Managed skill installation using current provider paths.                                                                                                                                                                                                                                      |
| NVIDIA GPU telemetry / NVIDIA GPU 計測                                           | [Club #83](https://github.com/John-Ryan21337/club-code/pull/83), `51580a72`   | Based on the restacked telemetry foundations. Bounded NVIDIA probe and live Resources integration; not all GPU vendors.                                                                                                                                                                                                         |
| Host temperatures / ホスト温度                                                   | [Club #84](https://github.com/John-Ryan21337/club-code/pull/84), `7fd2bc84`   | Based on #83. Optional bounded Windows/Linux readers with unavailable states; synthetic tests do not qualify physical sensors.                                                                                                                                                                                                  |
| Host network rates / ホスト通信量                                                | [Club #85](https://github.com/John-Ryan21337/club-code/pull/85), `da2a4158`   | Sibling of #84, based on #83. Host aggregate counters, not Internet speed or process attribution. Interface-set changes can distort deltas.                                                                                                                                                                                     |
| Idle Thread Guard / 待機スレッドの確認                                           | [Club #86](https://github.com/John-Ryan21337/club-code/pull/86), `68c669b5`   | Based on localization #81. Opt-in guard; see the proposal for provider and queue limits.                                                                                                                                                                                                                                        |
| Streaming workspace / ストリーミング画面                                         | [Club #87](https://github.com/John-Ryan21337/club-code/pull/87), `079e775b`   | Prerequisite base `9cbc7c30` reuses Cafe #53/#60. Retained player, geometry, cinema and saved queues. Public YouTube ready handshake was checked; full service playback/account access was not qualified.                                                                                                                       |
| Provider usage and advisory pacing / 使用量と送信間隔の目安                      | [Club #88](https://github.com/John-Ryan21337/club-code/pull/88), `e73add1d`   | Direct to the Cafe adoption base. Usage presentation and advisory pacing; not a guaranteed provider rate limiter.                                                                                                                                                                                                               |
| Native local media / ローカルメディアのネイティブ実行                            | [Club #89](https://github.com/John-Ryan21337/club-code/pull/89), `5b795366`   | Requires Cafe IPC #75. Owner-bound native selection and VLC transport. Synthetic silent WAV decoding was checked on Windows; physical/platform coverage remains scoped.                                                                                                                                                         |
| Local media player / ローカルメディア画面                                        | [Club #90](https://github.com/John-Ryan21337/club-code/pull/90), `6a2496d8`   | Combined base `063db8d5` includes #87/#89. In-memory queue, floating/cinema/background video and one continuation attempt after actual playback ends. No persisted library, capture or visualizer.                                                                                                                              |
| Claude account usage / Claude アカウント使用量                                   | [Club #91](https://github.com/John-Ryan21337/club-code/pull/91), `3ba8e6d8`   | Based on #88. Account-bound quota and paid-usage display; no claim that every account is currently reachable.                                                                                                                                                                                                                   |
| Codex reset credits / Codex リセットクレジット                                   | [Club #92](https://github.com/John-Ryan21337/club-code/pull/92), `49dc83e0`   | Sibling of #91, based on #88. Explicit selected-credit/account confirmation and bounded native request. No real credit was consumed during verification.                                                                                                                                                                        |
| Temperature histories / 温度履歴                                                 | [Club #93](https://github.com/John-Ryan21337/club-code/pull/93), `0a2bb641`   | Based on #84. Hottest reported sensor per category with missing-sample gaps and a stated clipped scale.                                                                                                                                                                                                                         |
| Per-GPU histories / GPU 別履歴                                                   | [Club #94](https://github.com/John-Ryan21337/club-code/pull/94), `3f414435`   | Based on #93. Histories keyed by the reported GPU index, not a permanent physical identity.                                                                                                                                                                                                                                     |
| Resource panel geometry / リソース画面の配置                                     | [Club #95](https://github.com/John-Ryan21337/club-code/pull/95), `e44cc991`   | Based on #94. Move, resize and hide unavailable graphs; guarded local persistence retains controls on storage failures. Network #85 remains a separate sibling integration.                                                                                                                                                     |
| Local image library / ローカル画像ライブラリ                                     | [Club #96](https://github.com/John-Ryan21337/club-code/pull/96), `6869f0bf`   | Direct to the Cafe adoption base. Authenticated image storage and presentation; no remote image account integration.                                                                                                                                                                                                            |
| Completion sound and speech / 完了音と読み上げ                                   | [Club #97](https://github.com/John-Ryan21337/club-code/pull/97), `69ede49a`   | Requires Cafe IPC #75. Optional completion audio and English/Japanese speech; browser/native capability limits remain explicit.                                                                                                                                                                                                 |
| Image reference-safe cleanup / 参照を保護する画像整理                            | [Club #98](https://github.com/John-Ryan21337/club-code/pull/98), `ae4bae12`   | Based on #96. Shared reference lock and bounded cleanup; malformed/unreadable settings do not authorize deletion.                                                                                                                                                                                                               |
| Movable image panels / 移動可能な画像パネル                                      | [Club #99](https://github.com/John-Ryan21337/club-code/pull/99), `d63bf980`   | Sibling of #98, based on #96. Accessible pointer/keyboard geometry and minimized-state handling.                                                                                                                                                                                                                                |
| Advanced Matrix runtime / 高度な Matrix 描画                                     | [Club #100](https://github.com/John-Ryan21337/club-code/pull/100), `1fb29f2b` | Based on the Matrix foundations. Six motion modes, bounded GPU glyph rendering and Canvas fallback. Live work vocabulary and activity routes remain separate.                                                                                                                                                                   |
| Atmosphere Console / 背景設定コンソール                                          | [Club #101](https://github.com/John-Ryan21337/club-code/pull/101), `b94429d6` | Based on #100. Local bounded English/Japanese command parsing and acknowledged settings RPCs. No model or shell is used in this slice.                                                                                                                                                                                          |
| Local-model console interpretation / ローカルモデルによる解釈                    | [Club #102](https://github.com/John-Ryan21337/club-code/pull/102), `3ce5c6c6` | Based on #101. Opt-in LM Studio interpretation under the existing command whitelist. This does not add Claude/Codex provider interpretation.                                                                                                                                                                                    |
| Matrix hardware lighting / Matrix ハードウェア照明                               | [Club #103](https://github.com/John-Ryan21337/club-code/pull/103), `7c5a09a4` | Based on #100. Explicit owner opt-in and selected OpenRGB devices, bounded protocol/runtime and safety lease. No native-client attestation or physical-device qualification; restoration is best effort.                                                                                                                        |
| Public YouTube discovery / 公開 YouTube 検索                                     | [Club #104](https://github.com/John-Ryan21337/club-code/pull/104), `f7e6e2e6` | Based on streaming #87. Explicit authenticated search with bounded response/query handling and exact renderer connection fences. Synthetic checks only; account access is a separate port.                                                                                                                                      |
| Selected-thread Matrix vocabulary / 選択スレッドの Matrix 作業語彙               | [Club #105](https://github.com/John-Ryan21337/club-code/pull/105), `b996a95a` | Based on Matrix #100. Default-off operation labels and filtered file basenames from one routed thread, bounded traversal and Canvas/GPU clearing without reseeding. Filename filtering is best effort; full activity routes remain separate.                                                                                    |
| Claude console interpretation / Claude によるコンソール解釈                      | [Club #106](https://github.com/John-Ryan21337/club-code/pull/106), `d781b459` | Combined base `03461c02` includes local-model #102 and app access #69. Explicit Claude instance/model, tools-disabled bounded SDK request, current account/config checks and local command whitelist. The 45-second client deadline does not cancel an accepted server request. Codex is unsupported in this slice.             |
| Local-owner YouTube account connection / ローカル所有者の YouTube アカウント接続 | [Club #107](https://github.com/John-Ryan21337/club-code/pull/107), `01f529c5` | Based on public discovery #104. Explicit direct-loopback owner actions, PKCE callback, memory-only grants and bounded owned-playlist selection. Root-query and launcher traces omit OAuth material. Disconnect removes local grants; it does not revoke Google access. Synthetic checks only; no live OAuth exchange qualified. |
| Workspace file observatory / ワークスペースのファイル表示                        | [Cafe #94](https://github.com/cafeai/cafe-code/pull/94), `67d19445`           | Direct to dev. Bounded read-only selected-project file panes, opt-in refresh and snapshot differences. No database inspector or writer attribution; masking is best effort.                                                                                                                                                     |
| Recorded workflow observatory / 記録された作業フロー表示                         | [Cafe #95](https://github.com/cafeai/cafe-code/pull/95), `b39a169b`           | Direct to dev. Reported task list/graph and observed update spans. No invented relationships, provider runtime duration or new event collector.                                                                                                                                                                                 |

Additional Matrix appearance slice: [Club #108](https://github.com/John-Ryan21337/club-code/pull/108), `d3dcb18b`, is based on #105. It adds default-off fixed cat AA and half-width kana to Japanese streams, preserves work-label priority and clears text without reseeding. Console/profile integration remains separate.

日本語：追加の Matrix 外観差分は Club #108（#105 が前提）です。既定でオフの固定猫AAと半角カナを日本語の流れに追加し、作業語彙の優先と、動きを初期化しない文字消去を維持します。コンソール・プロファイルとの統合は別です。

Bundled visualizer prerequisite: [Club #109](https://github.com/John-Ryan21337/club-code/pull/109), `c6d1d1e5`, is based on local player #90. It supplies the MilkDrop engine and 395 bundled presets. Silent synthetic browser checks verified pixels and targeted analyser cleanup while preserving the caller's audio graph, without external requests. Product activation, capture and music-reactive integration remain separate.

日本語：Club #109 はローカルプレーヤー #90 を前提とする描画基盤です。MilkDrop エンジンと395個の同梱プリセットを提供します。無音の合成ブラウザー検査で描画と対象アナライザーの後始末を確認し、呼び出し側の音声グラフを維持しました。外部通信は使っていません。製品での有効化、音声取得、音楽反応は別です。

Provider observations: [Club #110](https://github.com/John-Ryan21337/club-code/pull/110), `d6e1d0f7`, is based on vocabulary #105. Bounded classification adds fixed category observations through current Cafe ingestion; the vocabulary consumes BUILD/DATABASE labels. Provider versions and asynchronous-question handling are preserved. The visual route overlay is not part of this draft.

日本語：Club #110 は作業語彙 #105 を前提とし、長さを制限した分類から固定の活動分類を現行 Cafe の取り込み処理へ追加します。作業語彙は構築・データベースの固定ラベルを使えます。現行プロバイダーと非同期質問の処理を維持します。経路の描画はこのドラフトに含みません。

Native frame-audio prerequisite: [Club #111](https://github.com/John-Ryan21337/club-code/pull/111), `2a82499f`, is based on Cafe IPC #75 (`cadc2e7f`). It admits explicit capture only from the exact live, visible, focused Cafe main frame and selects that frame's audio/video. An isolated Electron 42.5.1 probe obtained and stopped synthetic tracks. It adds no product Start/Stop control and grants no system-wide loopback source; live media-source audio and other platforms remain unqualified.

日本語：Club #111 は Cafe IPC #75 を前提とする、フレーム音声取得のネイティブ基盤です。明示された要求を、表示・フォーカス中の正確な Cafe メインフレームからだけ受け付け、そのフレームの音声・映像を選びます。分離した Electron 42.5.1 の検査で合成トラックの取得と停止を確認しました。製品の開始・停止ボタンは追加せず、システム全体の音声取得は許可しません。実メディアの音声や他のOSは未確認です。

Local media visualization: [Club #112](https://github.com/John-Ryan21337/club-code/pull/112), `66408536`, is based on engine #109. It adds explicit visualization controls for the local player, with retained audio-node ownership, preset changes and lifecycle cleanup. A real silent browser fixture and repeated activation were checked. Display capture and Matrix music reaction remain separate.

日本語：Club #112 はエンジン #109 を前提とし、ローカルプレーヤーの明示的な可視化操作、音声ノードの所有権、プリセット切替、終了処理を追加します。実ブラウザーの無音検査と再有効化を確認しました。画面音声の取得と Matrix の音楽反応は別です。

Matrix activity overlay: [Club #113](https://github.com/John-Ryan21337/club-code/pull/113), `e5d6b347`, is based on observations #110. Default-off selected-thread routes, category/color controls and bounded retention work above Canvas or GPU glyphs. Old routes clear before paint without reseeding; static reduced-motion routes expire while the provider is quiet. Decorative reports are not measured traffic, authenticated relationships or verified execution. Sibling console/privacy/profile integration remains separate.

日本語：Club #113 は分類 #110 を前提とし、既定でオフの選択スレッド経路、分類・色・保持時間の設定を Canvas と GPU の文字層へ追加します。描画前に古い経路を消し、落下を初期化しません。動きを減らす設定でも、プロバイダー更新がない間に期限を処理します。装飾された報告であり、実通信の計測・認証済み関係・実行の証明ではありません。別のコンソール・プライバシー・プロファイルとの統合は別です。

## Browser adoption order

1. [Cafe #63](https://github.com/cafeai/cafe-code/pull/63) defines bounded contracts;
   [Cafe #64](https://github.com/cafeai/cafe-code/pull/64) defines URL/redaction helpers.
   Published combined base: `adoption/browser-foundations-20260911` at `91d2aa4d`.
2. Add [Cafe #75](https://github.com/cafeai/cafe-code/pull/75).
   Native prerequisite base: `adoption/browser-native-prerequisites-20260911` at `73204da1`.
3. Add native runtime [Club #70](https://github.com/John-Ryan21337/club-code/pull/70)
   and broker/provider transport [Club #72](https://github.com/John-Ryan21337/club-code/pull/72).
4. Add [Club #79](https://github.com/John-Ryan21337/club-code/pull/79), `7fcd074a`,
   for the renderer workspace and one-time composer handoff.
   It provides move, resize, split, minimize, retained tabs, sharing controls, and
   explicit context review before Send or Queue.
   Its combined prerequisite branch is `adoption/browser-workspace-prerequisites-20260911`
   at `28cd002c`.
5. Add optional offline English/Japanese OCR with
   [Club #80](https://github.com/John-Ryan21337/club-code/pull/80), `20bbf313`,
   based on native runtime `53ba65fb`. The packaged ASAR passed 14 synthetic checks.

日本語：ブラウザーは上の順序で基盤、IPC検証、ネイティブ実装、仲介、画面UIを取り込みます。
英語・日本語のオフラインOCRは任意の追加機能です。基盤だけではブラウザーは起動しません。

## Auth checks and defined fan-out

The worker ceiling already has [Cafe #66](https://github.com/cafeai/cafe-code/pull/66),
head `8b610928`. It allows a per-thread limit from 1 to 64 for Codex and Claude.
A ceiling limits concurrent workers; it does not promise that the model will
spawn exactly that many agents. Use the existing PR rather than duplicating it.

The access checks above detect failed access before a long run. Authentication,
model access, and quota can still change during execution; a successful check is
time-stamped evidence, not a permanent guarantee.

日本語：同時エージェント数の上限は既存のCafe #66にあります。CodexとClaudeのスレッドごとに
1～64を設定できます。上限は、必ずその人数を起動する指定ではありません。
接続確認は長時間実行前の失敗検出に使いますが、認証・モデル利用権・利用枠は後から変わる場合があります。

## Club-only repairs found during adoption

These target Club `main`, not Cafe dev:

- [Club #73](https://github.com/John-Ryan21337/club-code/pull/73), `5244b07d`:
  keep Claude browser MCP authority inside the SDK host instead of child arguments.
- [Club #74](https://github.com/John-Ryan21337/club-code/pull/74), `388b7108`:
  bind Windows CLI paths and disable delayed expansion for shim execution.
- Earlier [Club #67](https://github.com/John-Ryan21337/club-code/pull/67) adds access checks;
  [Club #68](https://github.com/John-Ryan21337/club-code/pull/68) repairs worker-limit precedence.
  The Cafe counterparts use current Cafe APIs and appear separately above.

日本語：この節の修正はClubのmain向けです。Cafeには、上の表にある現行Cafe用の移植版を使います。

## Remaining current-dev adoption work

This is not a claim that every implemented Club feature now has a current-dev PR.
The following remain separate from the published ports above:

- Public YouTube discovery is #104 and the separate local-owner account/OAuth port is #107. These do not imply persistent account libraries or verified live access to Google.
- Claude console interpretation is now #106. Codex still requires a verified containment boundary before it can be called supported.
- Routed live work vocabulary is #105, optional cat AA/kana enrichment is #108, the fixed provider-observation producer is #110, and the activity overlay is #113. [Cafe issue #102](https://github.com/cafeai/cafe-code/issues/102) links both activity slices. Historical Club fork #4/#7/#18 proposed pieces on older lineages; neither those proposals nor individually green sibling PRs establish combined console/privacy/profile integration.
- The bundled visualizer engine is #109, local-player activation is #112, and the native current-frame capture grant is #111. Renderer capture controls and Matrix music-reactive integration remain follow-ups. These published slices do not imply those additional capabilities.
- SQLite/database observatory views and additional attribution are outside the file-only observatory #94. Cafe intentionally retired its diff viewer and worker-pool caller in `a4d4e3768e38f9c967f4715a4a4e9cbdc5c66992`; a pool-only transplant would be inert, and a diff-viewer return needs its own product proposal. Any further enrichment or collaboration claim needs concrete production-caller and existing-PR reconciliation.

日本語：Club の全実装機能が現行 dev 向け PR になったという主張ではありません。
公開 YouTube 検索・ローカル所有者のアカウント接続・Claude によるコンソール解釈・選択スレッドの作業語彙は、上の新しいドラフトにあります。
永続的なアカウントライブラリや Google への実接続を確認したという意味ではありません。
猫AA装飾は #108、固定の活動分類は #110、活動表示は #113、描画エンジンは #109、ローカルプレーヤーでの有効化は #112、フレーム音声取得のネイティブ基盤は #111 として公開済みです。画面からの音声取得操作、Matrix の音楽反応、
データベース表示などには、別の移植・確認作業が残っています。
古い系統の提案が存在しても、現行 dev で統合済みとは扱いません。Codex の解釈機能には、
安全な実行制限の確認が必要です。

Cafe は差分ビューとワーカープールの呼び出し元を意図的に削除しました。プールだけを移しても使われないため、差分ビューの復帰には独立した製品提案が必要です。

Collaboration authorization/journal modules are excluded from runnable-feature
claims: the audited source wires contracts and a migration, while runtime
membership/journal callers remain test-only. A module name or passing unit tests
do not establish an implemented collaboration feature.

日本語：この節は残作業と範囲外の項目です。公開済み機能の一覧ではありません。
共同作業の認可・ジャーナル基盤には実運用の呼び出し元がなく、動作する共同作業機能としては扱いません。

The running Club application and logged-in browser were not restarted during
these ports. PR publication, merge, build, installation, and launch are separate
states. ChatGPT agents and actual Claude Opus 5 CLI runs contributed to this pass;
independent reviews repaired defects before publication.
