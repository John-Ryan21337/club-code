import { describe, expect, it } from "vitest";

import {
  CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT,
  resolveCodexAutoCompactTokenLimit,
} from "./codexCompaction.ts";

describe("resolveCodexAutoCompactTokenLimit", () => {
  it("leaves the configured limit alone when ultra caching is off", () => {
    expect(
      resolveCodexAutoCompactTokenLimit({
        configuredLimit: 200_000,
        ultraCaching: false,
      }),
    ).toBe(200_000);
  });

  it("applies the ultra caching ceiling without raising a lower user limit", () => {
    expect(
      resolveCodexAutoCompactTokenLimit({
        configuredLimit: 200_000,
        ultraCaching: true,
      }),
    ).toBe(CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT);
    expect(
      resolveCodexAutoCompactTokenLimit({
        configuredLimit: 80_000,
        ultraCaching: true,
      }),
    ).toBe(80_000);
  });
});
