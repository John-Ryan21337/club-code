import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";
export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { strictPort: false },
    test: {
      include: ["src/components/chat/LocalMediaVisualizer.capture.tsx"],
      browser: {
        enabled: true,
        provider: playwright({
          launchOptions: { args: ["--mute-audio"] },
          contextOptions: {
            recordVideo: {
              dir: fileURLToPath(
                new URL("../../docs/pr-assets/local-media-visualizer/raw-video", import.meta.url),
              ),
              size: { width: 1000, height: 760 },
            },
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
        viewport: { width: 1000, height: 760 },
        api: { strictPort: false },
      },
      testTimeout: 30000,
    },
  }),
);
