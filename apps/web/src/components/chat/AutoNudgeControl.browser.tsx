import "../../index.css";

import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ComponentProps } from "react";

import { AutoNudgeControl } from "./AutoNudgeControl";

function renderControl(overrides: Partial<ComponentProps<typeof AutoNudgeControl>> = {}) {
  return render(
    <AutoNudgeControl
      mode="steady-progress"
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
  it("makes background continuation reachable from the chat composer", async () => {
    const onBackgroundChange = vi.fn();
    await renderControl({ onBackgroundChange });

    await expect.element(page.getByText(/Auto nudge - Armed/)).toBeVisible();
    await page.getByRole("switch", { name: "Continue this thread in background" }).click();

    expect(onBackgroundChange).toHaveBeenCalledWith(true);
  });

  it("disables policy changes while confirmed settings are arming", async () => {
    const onBackgroundChange = vi.fn();
    await renderControl({ disabled: true, onBackgroundChange });

    await expect
      .element(page.getByRole("switch", { name: "Continue this thread in background" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(onBackgroundChange).not.toHaveBeenCalled();
  });

  it("keeps Stop available while an enable write is still pending", async () => {
    const onStop = vi.fn();
    await renderControl({ mode: "off", disabled: true, arming: true, onStop });

    await expect.element(page.getByText("Auto nudge - Saving mode")).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
