# World clock adoption media

**All files here are synthetic component capture.** They are isolated renders of
the real `WorldClockWidget` component in a headless Chromium, driven by a
throwaway harness — _not_ screenshots or recordings of a running Cafe Code app,
a live backend, or the Desktop build. Everything behind the panel is a stand-in
backdrop drawn by the harness, and every frame carries a caption saying so.

| File                           | What it shows                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `world-clock-before.png`       | The same viewport with `worldClockEnabled: false`. The widget returns `null`, so no overlay node exists and the chrome is untouched.                                                                                                             |
| `world-clock-after.png`        | `worldClockEnabled: true` with four cities (Tokyo, Los Angeles, London, New York), the `rainbow` style, and weather consent granted in this renderer: per-city local time and date, the fake weather row, and the Open-Meteo attribution footer. |
| `world-clock-interaction.webm` | One recording of the whole capture session: the before state, the after state, then the interaction pass — pointer drag to move, corner-handle drag to resize, keyboard arrow nudges on the focused move handle, collapse, expand.               |

## How they were produced

- Harness: a temporary vitest browser-mode spec kept **outside** the checkout
  (`M:/wc-capture-tmp/worldClockCapture.browser.tsx` plus
  `wc.capture.config.mts`), so nothing was added to `apps/web`. The config
  reuses the app's real `vite.config.ts`, so the components build exactly as
  they do in the app.
- Browser: Chromium via `@vitest/browser-playwright`, headless, 1280×800. The
  WebM comes from the Playwright context's `recordVideo`.
- Settings: `hooks/useSettings` is mocked. No backend, no settings RPC, no
  account.
- Clock: `vi.setSystemTime("2026-09-11T12:34:56Z")` with `toFake: ["Date"]`, so
  the base instant is reproducible while the one-second tick still runs.
- Weather: a fake `WorldWeatherClient` is injected through the widget's
  `weatherClient` prop. **No `fetch` call, no live request, no Open-Meteo
  account, no credentials.** The readings shown are invented.
- Pointer capture (`Element.prototype.setPointerCapture`) is stubbed to a no-op
  for the recording, because the harness dispatches synthetic pointer events
  that do not own a real pointer. This affects only the capture, not the
  shipped component.

Nothing under `apps/`, `packages/` or any existing test was modified to produce
these files.
