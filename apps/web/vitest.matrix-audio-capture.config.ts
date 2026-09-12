import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const viewport = { width: 1360, height: 850 };
export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { strictPort: false },
    test: {
      include: ["src/components/MatrixAudio.capture.tsx"],
      browser: {
        enabled: true,
        provider: playwright({
          launchOptions: { args: ["--mute-audio"] },
          contextOptions: {
            recordVideo: {
              dir: fileURLToPath(
                new URL("../../docs/pr-assets/matrix-music/raw-video", import.meta.url),
              ),
              size: viewport,
            },
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
        viewport,
        api: { strictPort: false },
      },
      testTimeout: 30000,
    },
  }),
);
