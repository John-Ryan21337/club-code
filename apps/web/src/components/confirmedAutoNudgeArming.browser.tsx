import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUTO_NUDGE_SUPPRESSION_STORAGE_KEY,
  __resetConfirmedAutoNudgeArmingForTests,
  getConfirmedAutoNudgeArming,
} from "../confirmedAutoNudgeArming";

describe("confirmed Auto Nudge browser barrier", () => {
  beforeEach(() => {
    __resetConfirmedAutoNudgeArmingForTests({ clearStorage: true });
  });

  afterEach(() => {
    __resetConfirmedAutoNudgeArmingForTests({ clearStorage: true });
  });

  it("persists Stop in both the port-independent cookie and the storage-event signal", () => {
    getConfirmedAutoNudgeArming().suppress();

    expect(document.cookie).toContain(`${encodeURIComponent(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)}=`);
    expect(localStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).not.toBeNull();

    __resetConfirmedAutoNudgeArmingForTests();
    expect(getConfirmedAutoNudgeArming().getSuppressedSnapshot()).toBe(true);
  });

  it("clears Stop only after an explicit enable is confirmed", async () => {
    const arming = getConfirmedAutoNudgeArming();
    arming.suppress();

    await expect(
      arming.arm({
        persistEnabled: () => Promise.resolve(),
        start: () => undefined,
        clearSuppression: true,
      }),
    ).resolves.toBe(true);

    __resetConfirmedAutoNudgeArmingForTests();
    expect(getConfirmedAutoNudgeArming().getSuppressedSnapshot()).toBe(false);
  });
});
