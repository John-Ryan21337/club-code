import { describe, expect, it } from "vitest";

import { isIdleThreadGuardDue, latestIdleActivityAt } from "./idleThreadGuard";

describe("Idle Thread Guard safety timing", () => {
  it("uses the newest transcript, tool, session, or arming activity", () => {
    expect(
      latestIdleActivityAt([
        "2026-07-30T01:00:00.000Z",
        "2026-07-30T03:00:00.000Z",
        null,
        "2026-07-30T02:00:00.000Z",
      ]),
    ).toBe("2026-07-30T03:00:00.000Z");
  });

  it("never accepts a sub-hour deadline even from malformed persisted state", () => {
    expect(
      isIdleThreadGuardDue({
        nowMs: Date.parse("2026-07-30T01:59:59.000Z"),
        latestActivityAt: "2026-07-30T01:00:00.000Z",
        armedAt: "2026-07-30T01:00:00.000Z",
        idleHours: 0.01,
      }),
    ).toBe(false);
    expect(
      isIdleThreadGuardDue({
        nowMs: Date.parse("2026-07-30T02:00:00.000Z"),
        latestActivityAt: "2026-07-30T01:00:00.000Z",
        armedAt: "2026-07-30T01:00:00.000Z",
        idleHours: 0.01,
      }),
    ).toBe(true);
  });

  it("starts a newly enabled guard from arming time instead of immediately firing on old silence", () => {
    expect(
      isIdleThreadGuardDue({
        nowMs: Date.parse("2026-07-30T06:00:00.000Z"),
        latestActivityAt: "2026-07-30T01:00:00.000Z",
        armedAt: "2026-07-30T05:30:00.000Z",
        idleHours: 1,
      }),
    ).toBe(false);
  });
});
