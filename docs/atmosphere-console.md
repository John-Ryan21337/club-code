# Atmosphere console adoption

Exact reviewed Matrix base commit: `1fb29f2b`
(`feat(atmosphere): port GPU glyph renderer and six motion modes`).

Source of the port: `M:/ClubCode-local-release`, read-only, files
`apps/web/src/components/AtmosphereConsole.tsx` and
`apps/web/src/atmosphereCommandParser.ts`.

## What this adds

This guide describes **Local grammar** mode. The optional [LM Studio fallback](atmosphere-local-model.md)
is a separate opt-in path for unrecognized wording; it does not change the local grammar's refusal rules.

A movable, resizable, minimizable panel that accepts short local commands for
the falling-effect settings this build already installs. The console is a second
way to reach the same settings the Appearance panel writes. It adds no new
runtime capability.

The console is closed by default. It is opened from the **Window atmosphere**
section of Appearance, with the **Open console** control. Opening the console
renders a panel and nothing else: no effect turns on until a command is applied.

## Command grammar

The grammar is finite and local. A request is normalized, split into segments on
`,` `;` newline `、` `。` `and` `そして`, and each segment must match exactly one
rule. Limits are 500 characters and 4 commands per request.

| Command       | English                                                                          | Japanese                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Effect        | `snow`, `rain`, `matrix`, `effects off`, `turn off the falling effects`          | `雪`, `雨`, `マトリックス`, `オフ`                                                                                                 |
| Motion        | `motion flat\|forward\|reverse\|warp\|walk forward\|walk reverse`, `warp motion` | `モーション ワープ`, `モーション 平坦`, `モーション 前進`, `モーション 後退`, `モーション ウォーク前進`, `モーション ウォーク後退` |
| Fixed color   | `color green`, `colour #a1b2c3`, `color auto`                                    | `色 赤`                                                                                                                            |
| Percentage    | `density 60%`, `speed to 25`, `opacity 100`, `japanese 70%`                      | `密度 60%`, `速度 40％`, `不透明度 50`, `日本語 70%`                                                                               |
| Relative step | `density up`, `speed down`, `opacity increase`, `faster`, `slower`               | `密度 上げる`, `速度 下げる`                                                                                                       |
| Reset         | `reset`, `reset all`, `reset density`, `reset color`, `reset motion`             | `リセット`, `密度リセット`                                                                                                         |

A color request also pins the Matrix color mode to `fixed`, so the chosen color
is the color that renders. Relative steps move by 10 percent of the setting's
range and stop at its bounds. Japanese ratio is absolute only.

`reset all` resets the controls in this grammar. It preserves advanced Matrix
settings that the console does not expose. A reset and another command for the
same property conflict; send them as separate requests if the override is intended.

### Refusals

Validation is complete before anything is applied, and it is all-or-nothing. If
any segment is unknown, malformed, over a limit, repeats a setting already given
in the same request, or names a feature this build does not install, the whole
request is refused, no settings are written, and the status line says what was
wrong and that nothing changed. A sentence that mixes a supported command with
an unsupported one is refused in full; it never reports partial success.

Words belonging to features this build does not ship (`next song`, `pause`,
`next visualizer`, `2ch on`, `use lm studio`, any `http(s)` address) produce a
named refusal rather than a vague "unknown", so the message explains that the
feature is not installed instead of implying a typo.

## Confirmed writes

The console does not use the optimistic `useUpdateSettings` path. It awaits
`server.updateClientSettings`, which returns the stored `ClientSettings`, and
reports the confirmed values read back from that result. If the acknowledgment
fails, the server may already have stored the change. The console leaves the
request visible and tells the user to check Appearance before sending another
command. It does not retry automatically.

The console ignores a late acknowledgment after unmount, a primary environment
change, or replacement of the exact connection. This prevents an old result from
overwriting the current client view. It cannot cancel a write already sent to the
previous server. Duplicate submit events while a write is pending send only one
request.

## Security boundary

- No shell, no `eval`, no dynamic code, no remote address, no provider prompt.
- No project, chat, or file content is read; only the typed control sentence is
  parsed, and it is parsed locally.
- The grammar is a fixed vocabulary. It cannot be extended by input.
- The console refuses to apply anything when the server has not advertised the
  `ambientExperienceCapabilities.atmosphere` capability.

## Storage

No settings schema changed. Console open state, minimized state, and panel
geometry are a device-local preference in `localStorage` under
`cafe-code:atmosphere-console:v1`, because placement is a property of one screen
rather than of the account. Geometry is clamped into the viewport on load, on
every move and resize, and on window resize, so a rectangle stored on a larger
display cannot put the panel off-screen. **Reset position** clears the stored
rectangle and returns the panel to its default placement.

Storage reads are limited to 4,096 characters before JSON parsing. If storage is
denied or full, mounted controls share an in-memory preference and remain usable.
That fallback does not promise persistence after the page is reloaded. Changes
from another tab update the mounted controls through the storage event.

Everything the console writes goes to existing `ClientSettings` falling-effect
fields, so `ClientSettings` and `ClientSettingsPatch` were not extended.

## Panel controls

Move, reset position, minimize/restore, close, and resize. Move and resize each
have keyboard equivalents: focus the control and use the arrow keys for
8-pixel steps. The panel sits at `z-45`, below the `z-50` dialog layer, so
existing dialogs and clickable UI keep working above it. Pointer, animation
frame, and window listeners are released on close and on unmount.

## Deferred: provider and media integration

The source Club console also offered model interpretation and media, 2ch, and
visualizer commands. This branch includes an opt-in LM Studio path described in
the separate guide. Claude/Codex interpretation and the media integrations are
still deferred. Their vocabulary is recognized only well enough to refuse it.

Future extensions, each of which needs its own slice:

- **Claude/Codex interpreter.** Requires a server `interpretAtmosphereCommand` RPC and
  a decoder that admits only the same command union this parser produces, so a
  model cannot widen the boundary. Club's `decodeAtmosphereCommandProposal`
  is the reference for that shape. It must stay opt-in and must state which
  provider usage it consumes.
- **Media transport and `play-url`.** Requires an ambient media player and a
  host allow-list. Until a player exists, a `play-url` command would have no
  destination.
- **Visualizers and 2ch enrichment.** Require the visualizer runtime and the
  `fallingEffect2chEnriched` setting, neither of which is present here.

When any of these lands, extend `AtmosphereCommand`, the segment rules, and
`buildAtmospherePatch` together, and remove the matching entry from
`MISSING_FEATURE_WORDS` so the refusal turns into a real command.

## Verification

Independent review repaired inherited object-key matches, newline splitting,
overlapping reset commands, duplicate submissions, stale connection results,
unconfirmed-write wording, pointer capture, minimized-drag size retention, small
viewport/caption placement, and unavailable local storage. The focused parser
and patch suite passes 100 tests; the component suite passes 26 tests. The final
full Chromium suite passes 356 tests. Full repository typecheck, formatting, and
lint pass. The opt-in capture passes and its 15.2-second WebM was decoded and
visually inspected; it contains only synthetic settings.

- `apps/web/src/atmosphereCommandParser.test.ts` — grammar, both languages,
  request limits, mixed and misleading requests, invalid numbers and colors.
- `apps/web/src/atmosphereConsoleCommands.test.ts` — patch mapping, range
  round-trips, and confirmed-value reporting that differs from the request.
- `apps/web/src/components/AtmosphereConsole.browser.tsx` — default-closed,
  open-enables-nothing, confirmed write, failed write, capability refusal,
  environment-switch late acknowledgement, keyboard move/resize/reset, viewport
  clamping, minimize/restore, close/reopen, and unmount abandonment.

Media: `docs/adoption-media/atmosphere-console/`, produced by
`yarn workspace @cafecode/web run capture:atmosphere-console`.

## 日本語の操作ガイド

**外観 → Window atmosphere → Open console** でコンソールを開きます。
初期状態は閉じています。開くだけではエフェクトは有効になりません。
このコンソールは、現在のビルドにある降下エフェクトの設定を変更します。

上の表にある英語・日本語のコマンドを使ってください。入力は最大500文字、
1回につき最大4コマンドです。カンマ、セミコロン、改行、`、`、`。`、`and`、
`そして`で区切ります。例は `雪、密度 60%、日本語 70%` です。
モーションは `モーション ワープ`、色は `色 赤` のように指定します。
相対変更は設定範囲の10%ずつです。日本語の割合は絶対値で指定します。
色の指定はMatrixの色モードを固定にします。

不明なコマンド、範囲外の値、同じ設定への重複指定、未対応機能が1つでもあると、
その入力全体を拒否します。設定は送信しません。`reset all` はこのコンソールが
扱う設定だけを初期値に戻し、未公開の高度なMatrix設定は保持します。
リセットと同じ設定への指定を意図的に続ける場合は、別々に送信してください。

入力の解析は端末内で行い、変更は選択中のCafeサーバーに保存します。
モデルやシェルは使いません。サーバーから確認が返ると保存済みの値を表示します。
確認が失敗しても、サーバー側では保存済みの場合があります。再送信の前に外観設定を
確認してください。自動再試行はしません。送信中の重複操作は1回の要求にまとめます。

接続先の変更、同じ環境の接続の置き換え、コンソールの終了後に届いた古い応答は、
現在の表示に適用しません。ただし、すでに送信した保存要求を取り消すことはできません。
サーバーがエフェクト機能を公開していない場合、コマンドを送信しません。

移動・サイズ変更はマウスか、対象ボタンにフォーカスして矢印キーで操作できます。
矢印キーは8ピクセルずつ移動します。位置のリセット、最小化・復元、終了も可能です。
位置と開閉状態はこの端末の設定です。画面サイズが変わると画面内に収めます。
保存領域が無効または満杯でも、表示中のコントロールはメモリ上の設定で使えます。
その場合、ページの再読み込み後まで設定を保持することは保証しません。
保存されたJSONは解析前に4,096文字までに制限し、別タブの変更も反映します。

音楽・動画の操作、ビジュアライザー、2ch補完、Claude/Codexによる自由文解釈はこの差分に
含みません。任意で使えるLM Studio経路は別ガイドを参照してください。
未対応の語句はその旨を説明します。プロジェクト・会話・ファイルの
内容を解析しません。レビュー用画像と動画は実際のコンポーネントを合成設定で動かした
もので、アカウントやプロジェクトの情報を含みません。
