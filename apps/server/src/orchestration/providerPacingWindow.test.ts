import {
  ProviderDriverKind,
  type ServerProviderAccountRateLimitSnapshot,
  type ServerProviderAccountRateLimits,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { providerPacingFamily, selectProviderPacingWindow } from "./providerPacingWindow.ts";

const CHECKED_AT = "2026-07-26T17:00:00.000Z";
const RESET_SECONDS = 1_800_000_000;

function rateLimits(
  snapshot: ServerProviderAccountRateLimitSnapshot,
  patch: Partial<ServerProviderAccountRateLimits> = {},
): ServerProviderAccountRateLimits {
  return {
    rateLimits: snapshot,
    checkedAt: CHECKED_AT,
    ...patch,
  };
}

describe("providerPacingFamily", () => {
  it("maps only the supported driver families", () => {
    expect(providerPacingFamily(ProviderDriverKind.make("claudeAgent"))).toBe("claude");
    expect(providerPacingFamily(ProviderDriverKind.make("codex"))).toBe("codex");
    expect(providerPacingFamily(ProviderDriverKind.make("ollama"))).toBe("other");
  });
});

describe("selectProviderPacingWindow", () => {
  it("selects Claude's five-hour window and converts provider units", () => {
    const selection = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits({
        primary: {
          usedPercent: 91.5,
          windowDurationMins: 300,
          resetsAt: RESET_SECONDS,
        },
        secondary: {
          usedPercent: 40,
          windowDurationMins: 10_080,
          resetsAt: RESET_SECONDS + 60,
        },
      }),
    });

    expect(selection).toEqual({
      providerFamily: "claude",
      usedPercent: 91.5,
      resetsAtMs: RESET_SECONDS * 1_000,
      windowDurationMs: 300 * 60_000,
      sourceCheckedAtMs: Date.parse(CHECKED_AT),
      usageFingerprint: expect.any(String),
      rateLimitReachedType: null,
      spendControlReached: null,
    });
  });

  it("selects Codex's weekly window from its driver-specific snapshot", () => {
    const selection = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("codex"),
      accountRateLimits: rateLimits(
        {
          secondary: {
            usedPercent: 10,
            windowDurationMins: 10_080,
            resetsAt: RESET_SECONDS,
          },
        },
        {
          rateLimitsByLimitId: {
            other: {
              secondary: {
                usedPercent: 20,
                windowDurationMins: 10_080,
                resetsAt: RESET_SECONDS,
              },
            },
            codex: {
              primary: {
                usedPercent: 70,
                windowDurationMins: 300,
                resetsAt: RESET_SECONDS,
              },
              secondary: {
                usedPercent: 82,
                windowDurationMins: 10_080,
                resetsAt: RESET_SECONDS + 120,
              },
            },
          },
        },
      ),
    });

    expect(selection.providerFamily).toBe("codex");
    expect(selection.usedPercent).toBe(82);
    expect(selection.windowDurationMs).toBe(10_080 * 60_000);
    expect(selection.resetsAtMs).toBe((RESET_SECONDS + 120) * 1_000);
  });

  it("preserves reset-only Claude evidence without fabricating utilization", () => {
    const first = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits({
        primary: { windowDurationMins: 300, resetsAt: RESET_SECONDS },
      }),
    });
    const next = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits({
        primary: { windowDurationMins: 300, resetsAt: RESET_SECONDS + 1 },
      }),
    });

    expect(first.usedPercent).toBeNull();
    expect(first.usageFingerprint).not.toBeNull();
    expect(next.usageFingerprint).not.toBe(first.usageFingerprint);
  });

  it("does not turn malformed utilization or timestamps into authority", () => {
    const selection = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits(
        {
          primary: {
            usedPercent: 101,
            windowDurationMins: 300,
            resetsAt: 0,
          },
        },
        { checkedAt: "not-a-date" },
      ),
    });

    expect(selection.usedPercent).toBeNull();
    expect(selection.resetsAtMs).toBeNull();
    expect(selection.sourceCheckedAtMs).toBeNull();
    expect(selection.windowDurationMs).toBe(300 * 60_000);
  });

  it("keeps the fingerprint stable across registry replays and unrelated windows", () => {
    const initial = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("codex"),
      accountRateLimits: rateLimits({
        primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: RESET_SECONDS },
        secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: RESET_SECONDS },
      }),
    });
    const replay = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("codex"),
      accountRateLimits: rateLimits({
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: RESET_SECONDS + 10 },
        secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: RESET_SECONDS },
      }),
    });

    expect(replay.usageFingerprint).toBe(initial.usageFingerprint);
    expect(replay.sourceCheckedAtMs).toBe(initial.sourceCheckedAtMs);
  });

  it("distinguishes a completed provider usage refresh from a registry replay", () => {
    const initialRateLimits = rateLimits({
      secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: RESET_SECONDS },
    });
    const initial = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("codex"),
      accountRateLimits: initialRateLimits,
    });
    const refreshed = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("codex"),
      accountRateLimits: {
        ...initialRateLimits,
        checkedAt: "2026-07-26T17:05:00.000Z",
      },
    });

    expect(refreshed.sourceCheckedAtMs).not.toBe(initial.sourceCheckedAtMs);
    expect(refreshed.usageFingerprint).not.toBe(initial.usageFingerprint);
  });

  it("includes provider quota status in the evidence fingerprint", () => {
    const allowed = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits({
        rateLimitReachedType: null,
        spendControlReached: false,
        primary: { usedPercent: 89, windowDurationMins: 300, resetsAt: RESET_SECONDS },
      }),
    });
    const limited = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits({
        rateLimitReachedType: "five_hour",
        spendControlReached: false,
        primary: { usedPercent: 89, windowDurationMins: 300, resetsAt: RESET_SECONDS },
      }),
    });

    expect(limited.rateLimitReachedType).toBe("five_hour");
    expect(limited.usageFingerprint).not.toBe(allowed.usageFingerprint);
  });

  it("uses only the configured family window ranges", () => {
    const claude = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("claudeAgent"),
      accountRateLimits: rateLimits({
        primary: { usedPercent: 95, windowDurationMins: 120, resetsAt: RESET_SECONDS },
        secondary: { usedPercent: 95, windowDurationMins: 10_080, resetsAt: RESET_SECONDS },
      }),
    });
    const codex = selectProviderPacingWindow({
      driver: ProviderDriverKind.make("codex"),
      accountRateLimits: rateLimits({
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: RESET_SECONDS },
      }),
    });

    expect(claude.usageFingerprint).toBeNull();
    expect(codex.usageFingerprint).toBeNull();
  });

  it("returns no quota authority for missing data or unsupported providers", () => {
    expect(
      selectProviderPacingWindow({ driver: ProviderDriverKind.make("claudeAgent") }),
    ).toMatchObject({
      providerFamily: "claude",
      usageFingerprint: null,
      usedPercent: null,
    });
    expect(
      selectProviderPacingWindow({
        driver: ProviderDriverKind.make("ollama"),
        accountRateLimits: rateLimits({
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: RESET_SECONDS },
        }),
      }),
    ).toMatchObject({
      providerFamily: "other",
      usageFingerprint: null,
      resetsAtMs: null,
    });
  });
});
