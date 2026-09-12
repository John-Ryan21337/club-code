# Whole-window opacity adoption media

**All files here are synthetic component capture.** They are isolated renders of
the real `WindowOpacitySettings` control in a headless Chromium, driven by a
throwaway harness — _not_ screenshots or recordings of a running Cafe Code app,
a live backend, a real Electron window, or any real user profile.

Two things in every frame are stand-ins drawn by the harness, and every frame
carries a caption saying so:

- **The desktop bridge.** `window.desktopBridge` is a synthetic in-page object
  that mirrors the desktop's contract (bounded values, opaque-on-failure,
  adopt-what-the-desktop-returns). There is no Electron process, no IPC and no
  persisted preference behind it.
- **The window translucency.** The shipped feature is a native
  `BrowserWindow.setOpacity` call. A browser cannot make a native window frame
  or the desktop behind the app show through, so the harness applies a CSS
  opacity to its own stand-in "app window" to make the control's effect legible.
  **These frames are not evidence that the operating system composites the real
  window.** That question is covered by the separate native smoke described in
  [`../../window-opacity.md`](../../window-opacity.md).

| File               | What it shows                                                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before.png`       | The supported, default state: the switch is off, the synthetic bridge reports `enabled=false opacity=0.84 effective=1.00`, and the stand-in window is fully opaque.                                                                                                        |
| `after.png`        | The switch on and the slider clicked to 70%: the bridge reports `enabled=true opacity=0.70 effective=0.70` and the synthetic backdrop shows through the stand-in window.                                                                                                   |
| `interaction.webm` | One 15.6 s, 1280×800 recording of the whole capture session (all three cases share one browser context): the before state, the after state, then the interaction pass — enable, three pointer clicks along the slider track, the reset button, and a native apply failure. |

Frames verified by decoding `interaction.webm` and drawing it to a canvas
(t = 9.34 s, 11.0 s, 12.76 s, 15.09 s):

- **t ≈ 11.0 s** — slider at 67%, `enabled=true opacity=0.67 effective=0.67`,
  backdrop clearly visible through the stand-in window.
- **t ≈ 12.76 s** — after the reset button: `enabled=false opacity=0.84
effective=1.00`, window opaque again.
- **t ≈ 15.09 s** — the synthetic bridge reports a native failure on the last
  request. The control adopts the desktop's recovery state:
  `enabled=false effective=1.00 reason=apply-failed`, and the row shows "The
  requested opacity could not be applied. The window was restored to opaque."

The recording's page is larger than the 1280×800 capture viewport, so a white
and grey border from the vitest runner page is visible along the right and
bottom edges. That is runner chrome, not app UI.

## How they were produced

- Harness: a temporary vitest browser-mode spec kept **outside** the checkout
  (`M:/opacity-capture-tmp/windowOpacityCapture.browser.tsx` plus
  `opacity.capture.config.mts`), so nothing was added to `apps/web`. The config
  reuses the app's real `vite.config.ts`, so the control builds exactly as it
  does in the app. The harness directory was deleted after capture.
- Browser: Chromium via `@vitest/browser-playwright`, headless, 1280×800. The
  WebM comes from the Playwright context's `recordVideo`, so the whole run lands
  in one recording.
- Interaction: real pointer clicks (`userEvent.click`) on the real switch,
  slider track and reset button. Slider values come from the click position on
  the track, the same way a user's pointer selects a value.
- No backend, no settings RPC, no account, no credentials, no network request,
  and no file outside the harness's own output directory.

Nothing under `apps/`, `packages/` or any existing test was modified to produce
these files.
