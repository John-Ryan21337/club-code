# Matrix runtime adoption

Status of the Club Code falling-atmosphere adoption in Cafe Code. Club Code
(`M:\ClubCode-local-release`, read only) is the canonical implementation; this
document records what has landed here, what deliberately differs, and what is
still deferred.

## Slice history

### Foundation (PR 28, eight commits, already on this branch)

- `ambientExperienceCapabilities.atmosphere` server capability.
- `fallingEffects*` client settings: enable switch, effect kind, color, Matrix
  color mode, opacity, speed, density, Japanese ratio, background continuation.
- Bounded Canvas2D simulation (`apps/web/src/windowAtmosphere.ts`), the
  `WindowAtmosphere` root layer, and the Appearance settings panel.

### GPU renderer and bounded motion (this slice)

Ported surgically from Club Code:

| Cafe file                                      | Club source                       |
| ---------------------------------------------- | --------------------------------- |
| `apps/web/src/matrixWebGlRenderer.ts`          | same path (with adoption fixes)   |
| `apps/web/src/matrixGpuFrameCollector.ts`      | same path (with adoption fixes)   |
| `apps/web/src/windowAtmosphere.ts`             | same path, reduced (see below)    |
| `apps/web/src/matrixWebGlRenderer.test.ts`     | same path (with adoption fixes)   |
| `apps/web/src/matrixGpuFrameCollector.test.ts` | same path, minus work-label cases |

New settings, in `ClientSettings`, `ClientSettingsPatch`, and the Appearance
panel:

- `fallingEffectMatrixMotionMode` — `flat`, `forward`, `reverse`, `tunnel`
  (labelled **Warp**), `walk-forward`, `walk-reverse`. Default `flat`.
- `fallingEffectMatrixBaseFontSize` — 1..72px, default 14.
- `fallingEffectMatrixColorCycleSpeed` — 0.25..64x, default 1.
- `fallingEffectMatrixWalkStartFontSize` / `...WalkEndFontSize` — exact user
  endpoints, defaults 1px and 72px. The schema still decodes Club Code's legacy
  two-decimal values so an imported settings file is never discarded; new edits
  are normalized onto the whole-pixel grid the glyph cache addresses.
- `fallingEffectMatrixWalkLifecyclePercent` — 5..100%, default 30.
- `fallingEffectMatrixCenterWindIntensity` — 0..10, default 4.

## Architecture

One traversal, two backends. `drawAtmosphereScene` remains the authoritative
scene function. In GPU mode `MatrixGpuFrameCollector` runs that exact function
against a recording Canvas2D-like context and converts the intercepted
`fillText` calls into instances; `MatrixWebGl2Renderer` uploads them to a single
dynamic instance buffer and issues one instanced draw against a glyph atlas.
Switching backends therefore cannot change motion, language selection, stream
counts, occupancy, alpha, or glyph order.

Bounds retained from Club Code: DPR capped at 2, backing pixels at 8,388,608,
frame step at 0.1s, particles per kind, atlas capacity 1024 entries (2048 hard),
8192 instances (16384 hard), Walk occupancy grid, and the 32-code-point token
limit.

Lifecycle: both canvases are fixed, full-viewport, and `pointer-events: none`
(set inline, so pointer transparency does not depend on stylesheet load order).
Animation runs only when permitted; hidden/unfocused cancels the animation frame
unless background continuation is on; reduced motion draws exactly one dimmed
static frame and schedules no loop; resize is coalesced into one scheduled
rebuild; every listener, animation frame, and GL resource is released on
teardown. WebGL context loss is reported through a typed status and the
component continues on Canvas2D.

Diagnostics on the Canvas element say what actually rendered:
`data-atmosphere-renderer`, `data-atmosphere-text-rasterization`, and
`data-atmosphere-frame-commit`. The GPU canvas carries
`data-matrix-gpu-availability` and, on failure, `data-matrix-gpu-fallback-reason`
(`webgl2-unavailable`, `insufficient-capability`, `atlas-unavailable`,
`gpu-initialization-failed`).

## Intentional differences from Club Code

These are omissions, not approximations. Nothing below is stubbed or faked.

- **No music-reactive color.** Club Code's `music-reactive` and
  `music-reactive-extra` modes require an approved local-media audio analyser
  that does not exist in this base. The mode literals are not offered, so there
  is no control that appears enabled without a signal behind it. `fixed`,
  `rainbow`, and `rainbow-extra` are complete, including the per-stream hue
  distribution above `MATRIX_MAX_UNIFORM_RAINBOW_SPEED`.
- **Static vocabulary only.** Live work vocabulary, 2ch-enriched glyphs, and AA
  tokens are removed; particles carry no token fields. The Roman and Japanese
  pools are the whole vocabulary and the whole GPU atlas.
- **No activity routes.** `matrixActivityOverlay.ts` and every
  `fallingEffectActivityLink*` setting are out of scope. No mock activity, no
  fabricated provider events.
- **No usage-reactive particle modulation**, no cinema or console copies, no
  `fallingEffectsOverCinemaEnabled`, no hardware lighting. Club Code's renderer
  has consumers for those hosts; they are not present here and were removed
  rather than ported inert.
- **Rendering stays on the main thread.** The glyph atlas can use OffscreenCanvas
  when available. Neither the simulation nor the fallback renderer runs in a worker.

## Named profiles

Named appearance profiles are not in this base. Club Code's
`settingsProfiles.ts` splits appearance from authority: presentation fields may
travel with a profile, while activation switches and any live-observation opt-in
must not be enabled by importing or selecting one. When the profile work from
PR 17/53 lands, the settings added here (`fallingEffectMatrix*` motion, sizes,
lifecycle, wind, color cycle) are presentation fields and are profile-eligible;
`fallingEffectsEnabled` is an activation switch and must stay excluded. That
boundary is documented, not implemented — there is no profile code in this
slice.

## Localization

All new user-facing strings are English. Localization is tracked separately in
draft `a12e553c`. The new strings are plain literals in
`WindowAtmosphereSettings.tsx` and the motion labels live in one
`ATMOSPHERE_MOTION_MODES` table, so extraction is a single mechanical pass. The
persisted values are stable identifiers (`tunnel`, `walk-forward`, …) and are
never translated; only labels are, so a localized build and an English build
interoperate over the same settings file and the same RPC patch.

## Verification

Deterministic (`vitest`):

- `apps/web/src/matrixAtmosphereMotion.test.ts` — every effect x motion x
  viewport combination produces finite bounded geometry; Flat is identity;
  Forward/Reverse depth ramps mirror; Warp projects radially from center; Walk
  hits the exact configured size endpoints and reverses for Walk Reverse; Walk
  depth follows the particle lifecycle (not viewport Y), fades before respawn,
  and respawns inside the viewport; center wind is signed by distance from
  center and is exactly zero at intensity 0.
- `apps/web/src/matrixWebGlRenderer.test.ts` — atlas packing and bounds, one
  instanced draw, typed Canvas2D fallback, and rebuild after context
  restoration against a scripted context.
- `apps/web/src/matrixGpuFrameCollector.test.ts` — pooled frames, bounded
  instances, per-frame color-cache clearing.
- `packages/contracts/src/settings.test.ts` — defaults, bounds, and the
  "every client setting is reachable through `ClientSettingsPatch`" gate.

Real Chromium (`vitest.browser.config.ts`,
`apps/web/src/components/MatrixAtmosphereGpu.browser.tsx`): real WebGL2
capability probe; a collected Matrix frame draws once with no GL error and
`readPixels` reports lit pixels; Walk Forward stays inside the instance budget;
typed fallback when the context cannot be acquired; a real driver context loss
reports `context-lost`; the component mounts pointer-transparent layers, reports
the Canvas fallback truthfully, paints visible fallback pixels, and removes both
canvases on unmount.

**Acceleration evidence.** This host reported Chromium's SwiftShader software
driver and refused the production request with `failIfMajorPerformanceCaveat`.
The component supports either available WebGL2 or Canvas2D. Fallback-specific
tests explicitly refuse acquisition; renderer tests relax that attribute and
verify actual GL pixels. Driver context loss is real; success and failure of
reacquisition are driven separately because restoration behavior varies by host.
No hardware-acceleration claim is made.

Independent adoption review repaired two boundaries: presentation-only changes
now preserve the advanced particle scene, and integer backing dimensions obey
the hard pixel cap even at extreme aspect ratios. The WebGL renderer and tests
therefore include a small bounds correction beyond the original Club copies.
Before-fix regressions reproduced both failures. Reduced-motion palette changes
repaint once without starting an animation loop.

Component regressions verify that reduced-motion context loss and restoration
repaint the same scene without starting a loop, and that hidden/unfocused policy
still prevents drawing. Frame diagnostics change only after a frame is committed.

Synthetic media uses the real atmosphere and settings components with fixture
settings and the app stylesheet. Run `yarn workspace @cafecode/web capture:matrix`
to reproduce screenshots and WebM under `docs/adoption-media/matrix-runtime`.
The named capture configuration is outside the default unit/browser test paths.
Its before view uses foundation defaults in the new component; it is not a
screenshot of an older application binary. Capture notes distinguish production
acquisition, forced Canvas fallback, and software WebGL context exercises.

## 日本語の操作ガイド

外観設定の「Falling effects」で、雪、雨、Matrix文字の背景を有効にできます。初期状態は無効です。
動きは Flat、Forward、Reverse、Warp、Walk Forward、Walk Reverse の6種類です。
Walk は文字の開始サイズと終了サイズの間を移動します。初期値は1pxと72pxです。
色は固定、全体の虹色、流れごとに位相が異なる虹色を選べます。日本語文字の割合も設定できます。
色、透明度、速度などの表示設定を変更しても、移動済みの粒子を初期位置に戻しません。

Matrix文字は利用可能な場合に WebGL2 でまとめて描画します。GPU の初期化やコンテキスト復旧に失敗すると、同じ場面を Canvas2D で描画します。
雪と雨は Canvas2D を使います。描画方式を変えても、動き、文字、配置の仕様は共通です。
DPR は最大2、描画面は最大8,388,608ピクセル、フレーム間隔は最大0.1秒として処理します。
極端に細長い画面でもピクセル上限を超えません。

背景のレイヤーはクリックを遮りません。通常は非表示・非フォーカス時に停止します。
背景での継続を明示的に有効にした場合だけ、その状態でも動かします。
動きを減らす設定では暗めの静止画を1回描画し、アニメーションのループを開始しません。
表示を終了するとイベント、フレーム予約、GPU リソースを解放します。

この変更に音楽連動、作業内容の文字表示、活動経路、映画・コンソール用コピーは含みません。
表示する文字は固定の英字・日本語文字集だけです。プロンプト、ファイル内容、プロバイダーのイベントを読みません。
設定プロフィールと UI 翻訳は別の採用変更です。音楽や作業内容の入力がない状態で対応済みとは表示しません。

検証用の画面は実際の描画・設定コンポーネントに合成データを渡したものです。
このホストのドライバーは SwiftShader でした。ソフトウェア WebGL と Canvas フォールバックを検証していますが、ハードウェア GPU の性能は実測していません。
