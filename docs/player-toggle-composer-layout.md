# Player view toggle and composer layout

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

The final Chromium suite passed all 436 checks in 50 files. The repository test
graph, formatting, lint, type checks, and forced desktop build passed. Player
checks use a synthetic iframe load; these results do not certify live playback.
