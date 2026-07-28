import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AutoNudgeControl } from "./AutoNudgeControl";

async function renderControl(
  overrides: Partial<React.ComponentProps<typeof AutoNudgeControl>> = {},
) {
  return render(
    <AutoNudgeControl
      mode="off"
      countdownSeconds={null}
      disabled={false}
      arming={false}
      backgroundEnabled={false}
      backgroundDispatchSupported
      backgroundOwnedByThisThread={false}
      backgroundStatus="stopped"
      backgroundRounds={0}
      backgroundMaxRounds={5}
      backgroundMaxMinutes={30}
      backgroundReason={null}
      backgroundLedger={[]}
      onModeChange={() => undefined}
      onBackgroundChange={() => undefined}
      onPauseBackground={() => undefined}
      onResumeBackground={() => undefined}
      onStop={() => undefined}
      {...overrides}
    />,
  );
}

describe("AutoNudgeControl", () => {
  it("renders the durable mode state", async () => {
    await renderControl({ mode: "steady-progress" });

    await expect
      .element(page.getByText("Auto nudge - Armed for the next safely settled turn"))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  it("keeps Stop available while an enable write is still pending", async () => {
    const onStop = vi.fn();
    await renderControl({ mode: "off", disabled: true, arming: true, onStop });

    await expect.element(page.getByText("Auto nudge - Saving mode")).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
