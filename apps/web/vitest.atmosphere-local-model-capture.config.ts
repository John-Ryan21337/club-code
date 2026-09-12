import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Opt-in capture only; neither default test include matches *.capture.tsx.
export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { strictPort: false },
    test: {
      include: ["src/components/AtmosphereLocalModel.capture.tsx"],
      browser: {
        enabled: true,
        provider: playwright({
          contextOptions: {
            recordVideo: {
              dir: fileURLToPath(
                new URL("../../docs/adoption-media/atmosphere-local-model", import.meta.url),
              ),
              size: { width: 1280, height: 720 },
            },
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
        viewport: { width: 1280, height: 720 },
        api: { strictPort: false },
      },
      testTimeout: 30000,
    },
  }),
);
