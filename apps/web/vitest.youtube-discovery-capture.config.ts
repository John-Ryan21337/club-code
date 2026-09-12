import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const videoDir = fileURLToPath(
  new URL("../../docs/pr-assets/youtube-discovery/raw-video", import.meta.url),
);
mkdirSync(videoDir, { recursive: true });

// Explicit UI media capture. The default *.browser.tsx test glob excludes this fixture.
export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { strictPort: false },
    test: {
      include: ["src/components/settings/YouTubeDiscovery.capture.tsx"],
      testTimeout: 30_000,
      browser: {
        enabled: true,
        headless: true,
        api: { strictPort: false },
        instances: [{ browser: "chromium" }],
        provider: playwright({
          contextOptions: {
            viewport: { width: 960, height: 800 },
            recordVideo: { dir: videoDir, size: { width: 960, height: 800 } },
          },
        }),
      },
    },
  }),
);
