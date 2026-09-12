# Cafe feature adoption PR index

This index tracks the missing-feature ports started on 11 September 2026.
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

| Feature / 機能                                                           | PR and head                                                                 | Adoption boundary                                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider daemon scheduling / デーモン優先度                              | [Cafe #74](https://github.com/cafeai/cafe-code/pull/74), `573cd9b6`         | Direct to dev. Lower scheduling priority for the daemon and ordinary descendants; not a RAM/GPU limit.                                                                                      |
| Desktop IPC authority / IPCの送信元検証                                  | [Cafe #75](https://github.com/cafeai/cafe-code/pull/75), `cadc2e7f`         | Direct to dev. Exact owner frame and main-frame navigation checks.                                                                                                                          |
| App Claude access check / アプリ内Claude接続確認                         | [Club #69](https://github.com/John-Ryan21337/club-code/pull/69), `ffe937dd` | Direct to the Cafe adoption base. Checks the selected model through the current SDK; does not certify every saved account. [Cafe issue #69](https://github.com/cafeai/cafe-code/issues/69). |
| External CLI access check / 外部CLI接続確認                              | [Club #71](https://github.com/John-Ryan21337/club-code/pull/71), `77a6a51d` | Direct to the Cafe adoption base. Isolated Claude preflight with bounded execution. Codex is explicitly unverified when safe probe isolation is unsupported.                                |
| Native browser tabs / ネイティブブラウザーのタブ                         | [Club #70](https://github.com/John-Ryan21337/club-code/pull/70), `53ba65fb` | Requires Cafe #63, #64 and #75. Native lifecycle passed 12 real Electron checks. Renderer and broker integration are separate units.                                                        |
| Browser broker and provider transport / ブラウザー仲介とプロバイダー接続 | [Club #72](https://github.com/John-Ryan21337/club-code/pull/72), `19eba5d1` | Based on browser foundations #63/#64. Requires native runtime and renderer to provide an end-to-end browser. [Cafe issue #70](https://github.com/cafeai/cafe-code/issues/70).               |
| Meeting privacy / 会議中の表示保護                                       | [Club #75](https://github.com/John-Ryan21337/club-code/pull/75), `baf86b58` | Direct to the Cafe adoption base. Presentation masking; no content redaction. Web Push/history limits and local manual-queue behavior are documented.                                       |
| World clock and optional weather / 世界時計と任意の天気表示              | [Club #76](https://github.com/John-Ryan21337/club-code/pull/76), `57e79752` | Direct to the Cafe adoption base. One to six cities; weather uses separate device-local consent and bounded fixed-endpoint requests.                                                        |
| Native window opacity / ウィンドウ透明度                                 | [Club #77](https://github.com/John-Ryan21337/club-code/pull/77), `5362eaad` | Direct to the Cafe adoption base. Native API values verified; compositor capture inconclusive. Packaged-release capability gate stays empty until visual qualification.                     |
| Packaged update-target audit / 更新先の検証                              | [Cafe #84](https://github.com/cafeai/cafe-code/pull/84), `01bd7908`         | Direct to dev. Bind the packaged audit to the actual artifact manifest, including fork update targets.                                                                                      |

日本語：上の新規ソフトウェアPRは、公開前に整形・lint・型検査・全ワークスペースのテスト・
強制デスクトップビルドを通過しています。実行時の証拠と制限は各PRを確認してください。
合成データによる検証は、すべての実機やアカウントでの動作保証ではありません。

## Browser adoption order

1. [Cafe #63](https://github.com/cafeai/cafe-code/pull/63) defines bounded contracts;
   [Cafe #64](https://github.com/cafeai/cafe-code/pull/64) defines URL/redaction helpers.
   Published combined base: `adoption/browser-foundations-20260911` at `91d2aa4d`.
2. Add [Cafe #75](https://github.com/cafeai/cafe-code/pull/75).
   Native prerequisite base: `adoption/browser-native-prerequisites-20260911` at `73204da1`.
3. Add native runtime [Club #70](https://github.com/John-Ryan21337/club-code/pull/70)
   and broker/provider transport [Club #72](https://github.com/John-Ryan21337/club-code/pull/72).
4. Add the renderer workspace and one-time composer handoff when its PR is published.
   It provides move, resize, split, minimize, retained tabs, sharing controls, and
   explicit context review before Send or Queue.
5. Offline English/Japanese OCR is an optional native-runtime extension.

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

## Work still awaiting publication

The following are implementation or review work, not published feature PRs yet:
browser workspace and OCR; English/Japanese/bilingual UI; Idle Thread Guard;
bundled audit skill installation; image/GIF runtime; completion audio and speech;
GPU/temperature/network telemetry; embedded media playback; advanced GPU Matrix;
image panel controls and orphan cleanup; local media and visualization;
activity overlays and hardware lighting; Atmosphere Console; workflow/workspace
observatories; provider usage display and advisory pacing.

Collaboration authorization/journal modules are excluded from runnable-feature
claims: the audited source wires contracts and a migration, while runtime
membership/journal callers remain test-only. A module name or passing unit tests
do not establish an implemented collaboration feature.

日本語：この節は未公開の作業です。公開済みPRの一覧ではありません。
共同作業の認可・ジャーナル基盤には実運用の呼び出し元がなく、動作する共同作業機能としては扱いません。

The running Club application and logged-in browser were not restarted during
these ports. PR publication, merge, build, installation, and launch are separate
states. ChatGPT agents and actual Claude Opus 5 CLI runs contributed to this pass;
independent reviews repaired defects before publication.
