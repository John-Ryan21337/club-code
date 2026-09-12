/**
 * Opt-in media capture configuration.
 *
 * Deliberately separate from `vitest.browser.config.ts`: the capture specs are
 * `*.capture.tsx`, which neither the unit `include` nor the browser `include`
 * matches, so no normal test run records video or writes into `docs/`. Run it
 * explicitly:
 *
 *   yarn workspace @cafecode/web run capture:matrix
 *
 * Screenshots are written by the spec itself; Playwright writes one WebM per
 * browser context into `docs/adoption-media/matrix-runtime/`.
 */
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const mediaPath = fileURLToPath(
  new URL("../../docs/adoption-media/matrix-runtime", import.meta.url),
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
      include: ["src/components/WindowAtmosphere.capture.tsx"],
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
