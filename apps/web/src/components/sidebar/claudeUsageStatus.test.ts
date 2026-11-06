import { describe, expect, it } from "vitest";
import type { ServerProvider } from "@cafecode/contracts";
import { claudeUsageStatus } from "./claudeUsageStatus";
const checkedAt = "2026-11-03T08:00:00.000Z";
const provider = {
  driver: "claudeAgent",
  auth: { status: "authenticated", type: "Claude Ultra" },
  accountRateLimits: {
    checkedAt,
    rateLimits: {},
    claudeAccount: { plan: "ultra", verification: "verified", fiveHourLimit: "removed", checkedAt },
  },
} as ServerProvider;
describe("Ultra verification display", () => {
  it("shows the provider's no-five-hour status and remaining weekly limits", () => {
    expect(claudeUsageStatus(provider, Date.parse(checkedAt))).toMatchObject({
      verification: "verified",
      stale: false,
      message: expect.stringContaining("Weekly and model limits still apply"),
    });
  });
  it("marks old verification stale even when another usage event is recent", () => {
    const next = {
      ...provider,
      accountRateLimits: { ...provider.accountRateLimits!, checkedAt: "2026-11-03T08:10:00.000Z" },
    };
    expect(claudeUsageStatus(next, Date.parse("2026-11-03T08:10:00.000Z"))).toMatchObject({
      stale: true,
      message: expect.stringContaining("stale"),
    });
  });
  it("shows unknown without account evidence and hides status after logout", () => {
    const { accountRateLimits: _usage, ...withoutUsage } = provider;
    expect(claudeUsageStatus(withoutUsage)).toMatchObject({ verification: "unknown" });
    expect(claudeUsageStatus({ ...provider, auth: { status: "unauthenticated" } })).toBeNull();
  });
});
