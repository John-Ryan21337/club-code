# Atmosphere console media

These captures show the production `AtmosphereConsole`, the production
`WindowAtmosphere` layer, and the production `WindowAtmosphereSettings` panel
with the application stylesheet and a synthetic settings fixture. No account,
project, provider, or user-file data was used. The fixture stands in for the
settings RPC: it stores what the console sends and returns the stored value, so
successful status lines report that fixture's confirmed values. Refusal captures
exercise the real parser without a settings write.

- `01-before-console-closed-effects-off.png` — before. The console is closed and
  falling effects are off.
- `02-console-open-nothing-enabled.png` — the Appearance control opened the
  console. Nothing is enabled, which is the point of this capture.
- `03-after-matrix-density-japanese.png` — after. `matrix, density 80%, 日本語 70%`
  drives the real layer; the settings panel and the confirmation agree.
- `04-motion-warp-fixed-color.png` — `motion warp and color green`, with the
  Matrix color mode pinned to Fixed.
- `05-refused-unsupported-media-request.png` — `snow and next song` is refused in
  full. The effect does not change to snow.
- `06-refused-invalid-number.png` — `density 120` is refused and the offending
  value is named.
- `07-moved-and-resized.png` — keyboard move and resize, still inside the
  viewport.
- `08-minimized-to-header.png` — minimized to its header bar.
- `09-after-reset-defaults.png` — `reset` returns the supported console fields to
  their defaults.
- `atmosphere-console-interaction.webm` — the interaction recording for
  the same run, written by Playwright for the browser context. The retained
  recording is 15.2 seconds; decoded frames were visually inspected.

Reproduce with `yarn workspace @cafecode/web run capture:atmosphere-console`.
Playwright assigns a new WebM filename on each capture; the reviewed recording
is retained under the stable name above.

The capture file is `src/components/AtmosphereConsole.capture.tsx` and is
outside every normal test include: the unit include matches `*.test.ts` and the
browser include matches `*.browser.tsx`. Its opt-in configuration,
`vitest.atmosphere-console-capture.config.ts`, names that single file, so it
cannot re-record the separate Matrix runtime capture in
`docs/adoption-media/matrix-runtime/`.
