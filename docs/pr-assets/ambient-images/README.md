# Ambient images — PR media

| File                              | What it shows                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ambient-images-before.png`       | Default profile: ambient image **off**, library empty. This is what every existing profile gets with no action.                                        |
| `ambient-images-after.png`        | After three synthetic images are added and theater presentation is selected: the layer washes over app content, and the text underneath stays legible. |
| `ambient-images-interaction.webm` | The same run end to end: enabling the feature, the three uploads, the library filling in, switching to theater, enabling rotation, and one removal.    |

## Provenance — everything here is synthetic

- **No real user files.** The "uploads" are `File` objects constructed in the
  capture (`new File([Uint8Array], "dune-ridge.png", …)`). No OS folder picker
  is opened; the component's hidden `<input type="file">` is driven directly
  with a `DataTransfer` and a `change` event, which is exactly what a picker
  does to it.
- **No real backend.** `server.updateClientSettings` is a mock holding one
  in-memory settings document, and the ambient-media HTTP routes are answered by
  a stubbed `fetch`. Nothing was written to a profile directory.
- **The pictures are generated.** The striped gradients are produced by a
  dev-server middleware in `apps/web/vitest.ambient-image-capture.config.ts`, which encodes a
  PNG on the fly from the requested content-addressed id. They are stand-ins for
  a user's own wallpaper, not sample photography.
- **The app shell is a mock**, and says so in its own footer. The sidebar,
  transcript and composer are static markup.
- **The ambient settings section and the ambient layer are the real
  components** — `AmbientImageSettingsSection` and `AmbientImageLayer`, imported
  from `apps/web/src`, rendered in Chromium. These are not mocked screenshots or
  redrawn mockups: the wash, the stacking over app content, the thumbnails, the
  notice line and the disabled states are what those components produced.

## How to regenerate

```sh
# From the repository root. Requires the Playwright Chromium browser
# (yarn workspace @cafecode/web test:browser:install).
yarn workspace @cafecode/web exec vitest run --config vitest.ambient-image-capture.config.ts

# The video lands in docs/pr-assets/ambient-images/raw-video/ with a
# Playwright-generated name; give it its published name and drop the folder:
mv docs/pr-assets/ambient-images/raw-video/*.webm \
   docs/pr-assets/ambient-images/ambient-images-interaction.webm
rmdir docs/pr-assets/ambient-images/raw-video
```

Sources: `apps/web/vitest.ambient-image-capture.config.ts` (synthetic PNG middleware, 1280×800
viewport, Playwright `recordVideo`) and
`apps/web/src/components/ambient/ambientImageMedia.capture.tsx` (mock shell plus
the real components and the scripted interaction). The capture is deliberately
kept off the test path: `vitest.browser.config.ts` only globs
`src/components/**/*.browser.tsx`, so `*.capture.tsx` never runs with the suite.

The stills are captured with `page.screenshot` at fixed points in that script,
so re-running reproduces them up to font rendering and the gradient seed.
