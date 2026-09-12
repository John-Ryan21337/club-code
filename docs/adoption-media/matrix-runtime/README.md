# Matrix runtime media

These captures show the production atmosphere and settings components with
synthetic settings and the app stylesheet. No account, project, provider or
user-file data was used.

- `01-before-foundation-defaults.png` uses foundation defaults in the new component.
- `02-after-walk-forward-rainbow.png` shows the adopted motion and color controls.
- `03` through `07` show other motion modes, forced fallback, reduced motion and
  a hidden-window pause.
- `08` and `09` exercise software WebGL rendering and a simulated context-loss event.
- `10` and `11` show settings interactions changing the actual layer.
- `matrix-runtime-interaction.webm` is the verified 22.92-second interaction
  recording. Its metadata and a decoded frame were inspected in a fresh Chromium
  context.

The host reported ANGLE SwiftShader. The production WebGL request was refused;
the explicit software-WebGL exercise relaxes that acquisition attribute. This
evidence does not establish hardware acceleration. Real driver context loss and
visible GL pixels are checked separately by the browser tests.

Reproduce with `yarn workspace @cafecode/web capture:matrix`. Playwright assigns
a new WebM filename on each capture; this reviewed recording uses a stable name.
The capture file is outside normal test
includes. All six capture scenarios passed after the stylesheet and synthetic
focus setup were corrected.

The captures were refreshed after the palette-lifecycle and hard-pixel-cap
review repairs. The video metadata and a decoded frame were checked in a fresh
Chromium context. They remain synthetic component evidence, not a live user session.
