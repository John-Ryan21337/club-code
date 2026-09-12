import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";
export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { strictPort: false },
    test: {
      include: ["src/components/settings/YouTubeAccountSettings.capture.tsx"],
      browser: {
        enabled: true,
        provider: playwright({
          contextOptions: {
            recordVideo: {
              dir: fileURLToPath(
                new URL("../../docs/pr-assets/youtube-account/raw-video", import.meta.url),
              ),
              size: { width: 1280, height: 900 },
            },
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
        viewport: { width: 1280, height: 900 },
        api: { strictPort: false },
      },
      testTimeout: 30000,
    },
  }),
);
