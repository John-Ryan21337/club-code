# Ambient image panel — PR assets

**SYNTHETIC IMAGES. FAKE BACKEND.** Nothing here shows a real user, a real
account, a real file or a real Cafe backend.

| File                                   | What it shows                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ambient-image-panel-before.png`       | The preset layout. Medium size, bottom-right corner, no glow.                               |
| `ambient-image-panel-after.png`        | The same panel after a move, a resize and a glow change. The Layout control reads `Custom`. |
| `ambient-image-panel-interaction.webm` | The full run: move, resize, glow, arrow-key steps, reset.                                   |

## How the assets are made

```
cd apps/web
yarn vitest run --config vitest.ambient-image-panel-capture.config.ts --browser.headless
```

The config is opt-in. The default browser config globs
`src/components/**/*.browser.tsx`, and a `*.capture.tsx` file never matches it,
so this capture never runs on the default test path.

## What is synthetic

- **The image.** A dev-server middleware generates a gradient PNG from the
  requested content-addressed id. The middleware comes from
  `apps/web/vitest.ambient-image-capture.config.ts`, which the ambient image
  library slice added.
- **The backend.** `updateClientSettings` is a mock that holds one in-memory
  settings document. Image requests reach only the local capture server, which generates labelled pixels. No external service or user profile is used.
- **The app shell.** A mock sidebar, thread and composer, so the overlay is
  judged against opaque chrome instead of an empty page.

## What is real

- The rendered component is the real `AmbientImageLayer` and the real
  `AmbientImagePanel`.
- The settings rows are the real `AmbientImagePanelSettingsRows`.
- Move and resize use synthetic DOM pointer events on the real component handles. This does not test native desktop pointer delivery.
- The recorded video is the same run as the two stills.
