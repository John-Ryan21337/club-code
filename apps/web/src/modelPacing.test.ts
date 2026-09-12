import type {
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
  ServerProviderModel,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  calculateModelPacing,
  formatModelPacingDuration,
  identifyModelPacingLimit,
} from "./modelPacing";

const RESET_SECONDS = 2_000_000_000;
const WINDOW_MINUTES = 100;
const startMs = (RESET_SECONDS - WINDOW_MINUTES * 60) * 1_000;
const window = (
  usedPercent: number | null,
  overrides: Partial<ServerProviderAccountRateLimitWindow> = {},
): ServerProviderAccountRateLimitWindow => ({
  usedPercent,
  windowDurationMins: WINDOW_MINUTES,
  resetsAt: RESET_SECONDS,
  ...overrides,
});

describe("calculateModelPacing", () => {
  it("is on pace at the beginning of a window", () => {
    expect(
      calculateModelPacing({
        window: window(0),
        nowMs: startMs,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "on-pace",
      usedPercent: 0,
      remainingPercent: 100,
      targetUsedPercent: 0,
      targetRemainingPercent: 100,
      timeToResetMs: WINDOW_MINUTES * 60_000,
      elapsedFraction: 0,
    });
  });

  it("shows room to use an under-pace limit halfway through", () => {
    expect(
      calculateModelPacing({
        window: window(30),
        nowMs: startMs + (WINDOW_MINUTES * 60_000) / 2,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "under-pace",
      remainingPercent: 70,
      targetUsedPercent: 50,
      targetRemainingPercent: 50,
      elapsedFraction: 0.5,
      recommendation: "Under pace: room to use this limit.",
    });
  });

  it("treats the exact reset boundary as stale provider data", () => {
    expect(
      calculateModelPacing({
        window: window(90),
        nowMs: RESET_SECONDS * 1_000,
        reservePercent: 10,
      }),
    ).toMatchObject({
      status: "reset-due",
      targetUsedPercent: null,
      targetRemainingPercent: null,
      timeToResetMs: 0,
      reservePercent: 10,
    });
  });

  it("recommends conservation when use is ahead of the buffered pace", () => {
    expect(
      calculateModelPacing({
        window: window(60),
        nowMs: startMs + (WINDOW_MINUTES * 60_000) / 2,
        reservePercent: 10,
      }),
    ).toMatchObject({
      status: "over-pace",
      targetUsedPercent: 45,
      targetRemainingPercent: 55,
      recommendation: "Over pace: conserve this limit until the next reset.",
    });
  });

  it("requests fresh data after the reported reset", () => {
    expect(
      calculateModelPacing({
        window: window(100),
        nowMs: RESET_SECONDS * 1_000 + 1,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "reset-due",
      timeToResetMs: 0,
      targetUsedPercent: null,
      targetRemainingPercent: null,
    });
  });

  it("does not fabricate pacing when data is incomplete", () => {
    expect(
      calculateModelPacing({
        window: window(null, { resetsAt: null }),
        nowMs: startMs,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "unavailable",
      usedPercent: null,
      remainingPercent: null,
      targetUsedPercent: null,
      timeToResetMs: null,
    });
  });

  it("flags clock skew instead of treating a future window as zero usage", () => {
    expect(
      calculateModelPacing({
        window: window(0),
        nowMs: startMs - 1,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "clock-skew",
      targetUsedPercent: null,
      elapsedFraction: null,
    });
  });

  it("bounds malformed percentages and reserve settings", () => {
    expect(
      calculateModelPacing({
        window: window(120),
        nowMs: startMs + (WINDOW_MINUTES * 60_000) / 2,
        reservePercent: 75,
      }),
    ).toMatchObject({
      usedPercent: 100,
      remainingPercent: 0,
      targetUsedPercent: 25,
      targetRemainingPercent: 75,
      reservePercent: 50,
      status: "over-pace",
    });
  });

  it("does not emit a pace for non-finite window arithmetic", () => {
    expect(
      calculateModelPacing({
        window: window(50, { windowDurationMins: Number.MAX_VALUE }),
        nowMs: RESET_SECONDS * 1_000 - 1,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "unavailable",
      targetUsedPercent: null,
      targetRemainingPercent: null,
      elapsedFraction: null,
      timeToResetMs: null,
    });
  });

  it("does not expose an infinite reset countdown for malformed timestamps", () => {
    expect(
      calculateModelPacing({
        window: window(50, { resetsAt: Number.MAX_VALUE }),
        nowMs: -Number.MAX_VALUE,
        reservePercent: 0,
      }),
    ).toMatchObject({
      status: "unavailable",
      timeToResetMs: null,
    });
  });
});

describe("identifyModelPacingLimit", () => {
  const models: Array<ServerProviderModel> = [
    {
      slug: "gpt-5.6-codex",
      name: "GPT-5.6 Codex",
      shortName: "Codex 5.6",
      isCustom: false,
      capabilities: null,
    },
  ];

  it("labels only an exact provider-reported model match as model-specific", () => {
    expect(
      identifyModelPacingLimit({
        snapshotKey: "gpt-5.6-codex",
        snapshot: { limitId: "gpt-5.6-codex" },
        models,
      }),
    ).toEqual({
      scope: "model",
      label: "GPT-5.6 Codex",
      matchingModelSlug: "gpt-5.6-codex",
    });
  });

  it("labels generic and ambiguous limits as shared/account limits", () => {
    const snapshot: ServerProviderAccountRateLimitSnapshot = {
      limitId: "codex",
      limitName: "Codex",
    };
    expect(
      identifyModelPacingLimit({
        snapshotKey: "codex",
        snapshot,
        models,
      }),
    ).toEqual({
      scope: "shared",
      label: "Codex (shared/account limit)",
      matchingModelSlug: null,
    });
  });
});

describe("formatModelPacingDuration", () => {
  it("renders bounded relative reset durations", () => {
    expect(formatModelPacingDuration(90_000)).toBe("2m to reset");
    expect(formatModelPacingDuration(90 * 60_000)).toBe("1h 30m to reset");
    expect(formatModelPacingDuration(26 * 60 * 60_000)).toBe("1d 2h to reset");
    expect(formatModelPacingDuration(0)).toBe("reset due");
    expect(formatModelPacingDuration(null)).toBe("reset unknown");
  });
});
