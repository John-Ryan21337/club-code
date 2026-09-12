# Player view toggle and composer layout

The chat header shows a YouTube on/off button when a YouTube source or URL queue
is loaded. Off removes the player and stops playback. On reloads the source;
the playlist or queue and saved player geometry remain available. Playback time
inside a YouTube playlist is not restored after turning the player off.
The button has translated English, Japanese, and bilingual accessible labels.
Its width follows the silver ratio of its height.

New composer effort defaults to High for models that offer High. Saved choices
still take precedence. Models without High retain their supported default.
This applies to Codex reasoning effort, Claude effort, and OpenCode variants.
The worker-count control currently belongs to the Codex integration only; it
sets a concurrent worker ceiling and does not request a fixed deployment count.

YouTubeのソースまたはURLキューを読み込むと、チャットヘッダーにオン／オフボタンが表示されます。
オフにすると再生が停止します。オンにするとソースを再読み込みします。
プレイリスト、キュー、保存した位置とサイズは維持されます。再生位置は復元されません。
対応モデルの初期推論強度はHighです。保存済みの選択は優先されます。

The floating YouTube player has a theater icon next to its close control.
The theater header has a restore icon. Restore returns to the saved floating
position and size. Both actions keep the same iframe and selected video.
The docked view has the same toggle. A window too small for theater shows a
disabled toggle with a size explanation. Escape also restores the player.
Keyboard focus returns to the theater toggle after restoration.

The composer, its background, and its guard controls share a wider maximum:
52rem × (δs − 1) = 73.539105rem, where δs = 1 + √2. This is about 1177px
with the default root font. Smaller panes use their available width.
Model and effort labels wrap instead of using ellipses. Effort stays visible
in the compact toolbar. The option controls can move to another row while the
send/stop control remains available. Icon hit targets remain square for access.
Below 24rem of actual composer width, the primary action moves below the options
to prevent overlap in narrow split panes.

## 日本語

YouTubeのフローティング表示では、閉じるボタンの隣にシアター切替アイコンがあります。
シアター表示のヘッダーにある復元アイコンで、保存した位置とサイズに戻ります。
切替時も同じiframeと選択中の動画を維持します。
ドック表示にも同じ切替アイコンがあります。シアター表示に必要な幅がない場合は、
アイコンを無効にして理由を表示します。Escapeキーでも元の表示に戻ります。
復元後はキーボードフォーカスがシアター切替ボタンに戻ります。

入力欄、背景、ガード操作の最大幅を白銀比のスケールに合わせて広げました。
最大幅は52rem × √2 = 73.539105remです。狭い画面では利用可能な幅に収まります。
モデル名と推論量は省略せず折り返します。コンパクト表示でも推論量を表示します。
操作は必要に応じて次の行に移り、送信・停止ボタンを使用できます。
入力欄の実際の幅が24rem以下の場合は、主操作を設定項目の下に配置して重なりを防ぎます。

## Verification

Browser regressions check repeated theater/restore transitions, iframe identity,
saved geometry, keyboard focus, and complete model/effort labels at desktop and phone widths in
English, Japanese and dual mode. The screenshots in `pr-assets/player-composer`
use the real application components with synthetic projects and provider metadata.
They do not use a personal account or media library.

The updated Chromium suite passed all 443 checks in 50 files. The repository test
graph passed 4,678 tests with three skips. Formatting, lint, type checks, and the
forced desktop build passed. Player
checks use a synthetic iframe load; these results do not certify live playback.
