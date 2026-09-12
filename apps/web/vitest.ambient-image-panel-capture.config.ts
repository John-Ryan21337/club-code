import type { UserConfig } from "vitest/config";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";

import captureConfig from "./vitest.ambient-image-capture.config";
const videoDir = fileURLToPath(
  new URL("../../docs/pr-assets/ambient-image-panel/raw-video", import.meta.url),
);
mkdirSync(videoDir, { recursive: true });

/**
 * Media-capture harness for `docs/pr-assets/ambient-image-panel/`.
 *
 * This config is opt-in and is deliberately *not* on the test path: the default
 * browser config (`vitest.browser.config.ts`) globs
 * `src/components/**\/*.browser.tsx`, and a `*.capture.tsx` file never matches
 * it. Run it only with an explicit `--config`.
 *
 * It reuses the synthetic ambient-media middleware and the Playwright video
 * recorder from `vitest.ambient-image-capture.config.ts`, which the ambient
 * image library slice added, and only replaces the file to run. Everything the
 * capture shows is synthetic: gradient PNGs generated from the requested
 * content-addressed id, and a fake in-memory settings backend. No user file, no
 * user account and no real Cafe backend is involved.
 */
const panelCaptureConfig: UserConfig = {
  ...captureConfig,
  test: {
    ...captureConfig.test,
    include: ["src/components/ambient/ambientImagePanelMedia.capture.tsx"],
    browser: {
      ...captureConfig.test?.browser,
      provider: playwright({
        contextOptions: {
          viewport: { width: 1280, height: 800 },
          recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
        },
      }),
    },
  },
};

export default panelCaptureConfig;
