import * as path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 5_000;

export default defineConfig({
  test: {
    // Successful tests should not flood CI and local terminals with fixture logs.
    // Vitest still prints failures and their captured output in full.
    silent: "passed-only",
    testTimeout: TEST_TIMEOUT_MS,
  },
  resolve: {
    alias: [
      {
        find: /^@cafecode\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
    ],
  },
});
