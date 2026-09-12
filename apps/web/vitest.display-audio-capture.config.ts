import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";
export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { strictPort: false },
    test: {
      include: ["src/components/ambient/AmbientAudioCapture.capture.tsx"],
      browser: {
        enabled: true,
        provider: playwright({
          launchOptions: { args: ["--mute-audio"] },
          contextOptions: {
            recordVideo: {
              dir: fileURLToPath(
                new URL("../../docs/pr-assets/display-audio-capture/raw-video", import.meta.url),
              ),
              size: { width: 1200, height: 850 },
            },
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
        viewport: { width: 1200, height: 850 },
        api: { strictPort: false },
      },
      testTimeout: 30000,
    },
  }),
);
