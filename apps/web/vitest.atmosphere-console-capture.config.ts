/**
 * Opt-in media capture configuration for the Atmosphere Console adoption.
 *
 * Deliberately separate from `vitest.browser.config.ts` and from
 * `vitest.matrix-capture.config.ts`. The `include` below names exactly one
 * file, so this configuration cannot re-record the Matrix runtime capture, and
 * neither the unit `include` (`*.test.ts`) nor the browser `include`
 * (`*.browser.tsx`) matches `*.capture.tsx`, so no normal test run records
 * video or writes into `docs/`. Run it explicitly:
 *
 *   yarn workspace @cafecode/web run capture:atmosphere-console
 *
 * Screenshots are written by the spec itself; Playwright writes one WebM per
 * browser context into `docs/adoption-media/atmosphere-console/`.
 */
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const mediaPath = fileURLToPath(
  new URL("../../docs/adoption-media/atmosphere-console", import.meta.url),
);
const VIEWPORT = { width: 1_280, height: 720 };

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        "~": srcPath,
      },
    },
    server: {
      strictPort: false,
    },
    test: {
      // Exactly one capture file. The Matrix capture is never included here.
      include: ["src/components/AtmosphereConsole.capture.tsx"],
      browser: {
        enabled: true,
        provider: playwright({
          contextOptions: {
            recordVideo: { dir: mediaPath, size: VIEWPORT },
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
        viewport: VIEWPORT,
        api: {
          strictPort: false,
        },
      },
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
