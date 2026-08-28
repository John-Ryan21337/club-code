import { describe, expect, it } from "vitest";

import { canPublishHardwareLightingFrame } from "./HardwareLightingAuthority.ts";

describe("canPublishHardwareLightingFrame", () => {
  it("accepts only the owner Electron renderer over loopback", () => {
    expect(
      canPublishHardwareLightingFrame({
        role: "owner",
        browser: "Electron",
        ipAddress: "127.0.0.1",
      }),
    ).toBe(true);
    expect(
      canPublishHardwareLightingFrame({ role: "owner", browser: "Electron", ipAddress: "::1" }),
    ).toBe(true);
  });

  it("rejects remote, browser-only, and non-owner publishers", () => {
    expect(
      canPublishHardwareLightingFrame({
        role: "owner",
        browser: "Electron",
        ipAddress: "192.168.1.20",
      }),
    ).toBe(false);
    expect(
      canPublishHardwareLightingFrame({
        role: "owner",
        browser: "Chrome",
        ipAddress: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      canPublishHardwareLightingFrame({
        role: "client",
        browser: "Electron",
        ipAddress: "127.0.0.1",
      }),
    ).toBe(false);
  });
});
