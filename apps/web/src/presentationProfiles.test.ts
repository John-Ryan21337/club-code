import type { SettingsProfile } from "./settingsProfiles";
import { describe, expect, it } from "vitest";

import {
  buildPresentationProfilePatch,
  createPresentationSwitchCoordinator,
  presentationProfilePatchMatches,
  resolvePresentationProfile,
} from "./presentationProfiles";

function profile(name: string, mobileOptimizedPresentation: boolean): SettingsProfile {
  return {
    id: `profile:${name}`,
    name,
    theme: "dark",
    clientSettings: { mobileOptimizedPresentation },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("resolvePresentationProfile", () => {
  it("wires canonical Desktop Profile and Mobile Profile names", () => {
    const profiles = [profile("Desktop Profile", false), profile("Mobile Profile", true)];
    expect(resolvePresentationProfile(profiles, "desktop")?.name).toBe("Desktop Profile");
    expect(resolvePresentationProfile(profiles, "mobile")?.name).toBe("Mobile Profile");
  });

  it("uses an unambiguous presentation setting when profiles have custom names", () => {
    const profiles = [profile("Workstation", false), profile("Phone", true)];
    expect(resolvePresentationProfile(profiles, "desktop")?.name).toBe("Workstation");
    expect(resolvePresentationProfile(profiles, "mobile")?.name).toBe("Phone");
  });

  it("fails closed when multiple profiles could own one presentation button", () => {
    const profiles = [profile("Workstation", false), profile("Laptop", false)];
    expect(resolvePresentationProfile(profiles, "desktop")).toBeNull();
  });
});

describe("buildPresentationProfilePatch", () => {
  it("makes the button association authoritative over a stale captured mode", () => {
    const staleDesktop = profile("Desktop Profile", true);
    const staleMobile = profile("Mobile Profile", false);

    expect(buildPresentationProfilePatch(staleDesktop, "desktop")).toMatchObject({
      mobileOptimizedPresentation: false,
    });
    expect(buildPresentationProfilePatch(staleMobile, "mobile")).toMatchObject({
      mobileOptimizedPresentation: true,
    });
  });

  it("detects when a competing settings write supersedes part of the selected profile", () => {
    const patch = {
      mobileOptimizedPresentation: false,
      fallingEffectKind: "matrix" as const,
      fallingEffectSpeed: 4,
    };
    expect(presentationProfilePatchMatches({ ...patch }, patch)).toBe(true);
    expect(presentationProfilePatchMatches({ ...patch, fallingEffectKind: "rain" }, patch)).toBe(
      false,
    );
  });
});

describe("createPresentationSwitchCoordinator", () => {
  it("keeps one switch authoritative across component remounts", async () => {
    const coordinator = createPresentationSwitchCoordinator();
    let finishDesktop!: (value: boolean) => void;
    const desktopOperation = new Promise<boolean>((resolve) => {
      finishDesktop = resolve;
    });
    const desktop = coordinator.run("desktop", () => desktopOperation);
    const unintendedMobile = coordinator.run("mobile", async () => true);

    expect(coordinator.getSnapshot()).toEqual({ busy: true, targetMode: "desktop" });
    await expect(unintendedMobile).resolves.toBe(false);
    finishDesktop(true);
    await expect(desktop).resolves.toBe(true);
    expect(coordinator.getSnapshot()).toEqual({ busy: false, targetMode: null });

    await expect(coordinator.run("mobile", async () => true)).resolves.toBe(true);
  });
});
