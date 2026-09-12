# Shared-audio analysis / 共有音声の解析

This renderer slice adds **Start shared audio analysis** and **Stop shared audio** to Streaming player settings and a stop indicator above the player. It requires [native frame capture #111](https://github.com/John-Ryan21337/club-code/pull/111) and [visualizer activation #112](https://github.com/John-Ryan21337/club-code/pull/112). The published prerequisite branch `adoption/display-audio-prerequisites-20260912`, exact `6b4f2eb6aa3a49483f3578a50a1171128f1b5df3`, combines those heads. [Cafe issue103](https://github.com/cafeai/cafe-code/issues/103) tracks both capture slices.

この画面側の差分は、Streaming player 設定に共有音声の解析開始・停止操作を追加し、プレーヤーにも停止表示を追加します。上記のネイティブ取得とビジュアライザーの両方を前提とします。

Open a streaming player in chat first. Keep the window visible and focused, then open Settings > Streaming player. Select **Start shared audio analysis**. Desktop builds request only the current Cafe frame through the native prerequisite. Browser builds use the browser's chooser. A source can provide no audio. This port does not grant system-wide audio capture in Electron.

最初にチャットで配信プレーヤーを開きます。ウィンドウを表示してフォーカスを保ち、Settings > Streaming player を開いて解析開始を選びます。デスクトップ版はネイティブ基盤を通じて現在の Cafe フレームだけを要求します。ブラウザー版はブラウザーの選択画面を使います。音声が提供されない場合もあります。Electron でシステム全体の音声を許可する差分ではありません。

Capture is explicit and held in memory. The renderer stops video tracks before allowing audio analysis. There is no microphone fallback, recording, audio upload or saved audio. Spectrum and MilkDrop use the existing bounded visualizer. MilkDrop can contain rapid motion and flashing colors; reduced-motion mode prevents capture. First-time settings without a mounted player cannot start a request.

取得は明示的な操作で始まり、メモリー内だけで保持します。解析を許可する前に映像トラックを停止します。マイクへの切り替え・録音・音声送信・音声保存はありません。Spectrum と MilkDrop は既存の上限付きビジュアライザーを使います。MilkDrop は速い動きや点滅を含む場合があり、動きを減らす設定では取得を開始しません。プレーヤー未表示の設定画面だけでは開始できません。

The request belongs to one observed connection, selected source, queue revision and mounted player. Late results are stopped if that ownership changed. One actual chooser request remains admitted until it settles, even after Stop; the API cannot close a pending browser chooser. A chooser may temporarily take focus, but its result must pass the current focus check. Active capture stops on window blur, hidden document, reduced-motion activation, disabled visualization, source/environment replacement or workspace unmount. Stop does not pause the embedded service itself.

要求は、確認した接続・選択ソース・キューの版・表示プレーヤーに結び付けます。所有状態が変わった後の結果は停止します。停止操作をしても、実際の選択要求が終わるまでは次の要求を受け付けません。この API でブラウザーの選択画面自体を閉じることはできません。選択画面が一時的にフォーカスを取ることは許しますが、結果の受理時に現在のフォーカスを再確認します。取得中にフォーカスを失った場合、画面が非表示になった場合、動きを減らす設定・可視化の無効化・ソースや環境の変更・画面の終了があった場合は停止します。埋め込みサービスの再生自体は停止しません。

The native prerequisite has an isolated Electron 42.5.1 Windows check for synthetic frame track grant and stop. This slice's opt-in browser fixture supplies a generated stream and a blank iframe, then exercises the real controls, analyser and GPU renderer with output muted. It does not prove browser chooser operation, audible YouTube/Spotify capture, system audio or other-OS behavior. No real account, microphone or user audio is used. Matrix music-reactive colors remain a separate follow-up.

ネイティブ基盤では、分離した Windows の Electron 42.5.1 で合成フレームのトラック取得・停止を確認しています。この差分の任意ブラウザー検査は、生成したストリームと空の iframe を使い、実際の操作部・解析器・GPU 描画を無音で検査します。ブラウザーの選択画面、YouTube や Spotify の実音声、システム音声、他 OS の動作を確認したという意味ではありません。実アカウント・マイク・ユーザー音声は使いません。Matrix の音楽反応色は別の差分です。

Run the synthetic fixture with `yarn workspace @cafecode/web exec vitest run --config vitest.display-audio-capture.config.ts`. Media under `docs/pr-assets/display-audio-capture` is labelled as synthetic. Required repository checks and the forced desktop build apply before publication.
