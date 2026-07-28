import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AutoNudgeControl } from "./AutoNudgeControl";

function control(overrides: Partial<React.ComponentProps<typeof AutoNudgeControl>> = {}) {
  return (
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
      promptScopeKey="environment-a/thread-a"
      persistedPrompt="Keep this thread moving"
      promptMaxLength={4_000}
      promptSaving={false}
      onSavePrompt={() => undefined}
      onModeChange={() => undefined}
      onBackgroundChange={() => undefined}
      onPauseBackground={() => undefined}
      onResumeBackground={() => undefined}
      onStop={() => undefined}
      {...overrides}
    />
  );
}

async function renderControl(
  overrides: Partial<React.ComponentProps<typeof AutoNudgeControl>> = {},
) {
  return render(control(overrides));
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

  it("keeps Stop available for a background owner even when the saved mode is off", async () => {
    const onStop = vi.fn();
    await renderControl({
      mode: "off",
      backgroundOwnedByThisThread: true,
      backgroundStatus: "active",
      onStop,
    });

    await page.getByRole("button", { name: "Stop" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("edits and explicitly saves a multiline prompt while Auto Nudge is off", async () => {
    const onSavePrompt = vi.fn(async () => undefined);
    await renderControl({
      disabled: true,
      persistedPrompt: "Original prompt",
      onSavePrompt,
    });

    const prompt = page.getByLabelText("Prompt for this thread");
    await expect.element(prompt).toBeEnabled();
    await expect.element(prompt).toHaveValue("Original prompt");
    await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
    await prompt.fill("First lane\nSecond lane");

    await expect.element(page.getByText("Unsaved changes")).toBeVisible();
    expect(onSavePrompt).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Save prompt" }).click();

    await vi.waitFor(() => {
      expect(onSavePrompt).toHaveBeenCalledTimes(1);
      expect(onSavePrompt).toHaveBeenCalledWith("First lane\nSecond lane");
    });
    await expect
      .element(
        page.getByText("Auto Nudge is off. Saving this text does not enable it.", {
          exact: false,
        }),
      )
      .toBeVisible();
  });

  it("shows persisted confirmation after the saved prompt is returned", async () => {
    const onSavePrompt = vi.fn(async () => undefined);
    const mounted = await renderControl({ persistedPrompt: "Before", onSavePrompt });

    await page.getByLabelText("Prompt for this thread").fill("After");
    await page.getByRole("button", { name: "Save prompt" }).click();
    await vi.waitFor(() => expect(onSavePrompt).toHaveBeenCalledTimes(1));
    await mounted.rerender(
      control({
        persistedPrompt: "After",
        onSavePrompt,
      }),
    );

    await expect.element(page.getByLabelText("Prompt for this thread")).toHaveValue("After");
    await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save prompt" })).toBeDisabled();
  });

  it("discards an unsaved draft on an exact-thread change without silently saving it", async () => {
    const onSavePrompt = vi.fn(async () => undefined);
    const mounted = await renderControl({
      promptScopeKey: "environment-a/thread-a",
      persistedPrompt: "The same saved text",
      onSavePrompt,
    });

    await page.getByLabelText("Prompt for this thread").fill("Thread A unsaved draft");
    await expect.element(page.getByText("Unsaved changes")).toBeVisible();
    await mounted.rerender(
      control({
        promptScopeKey: "environment-a/thread-b",
        persistedPrompt: "The same saved text",
        onSavePrompt,
      }),
    );

    await expect
      .element(page.getByLabelText("Prompt for this thread"))
      .toHaveValue("The same saved text");
    await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(onSavePrompt).not.toHaveBeenCalled();
  });

  it("requires nonblank bounded text and exposes the save status accessibly", async () => {
    const onSavePrompt = vi.fn(async () => undefined);
    await renderControl({
      mode: "steady-progress",
      persistedPrompt: "Valid",
      promptMaxLength: 12,
      onSavePrompt,
    });

    const prompt = page.getByLabelText("Prompt for this thread");
    await prompt.fill("   ");

    await expect.element(page.getByRole("status")).toHaveTextContent("Prompt cannot be empty");
    await expect.element(page.getByRole("button", { name: "Save prompt" })).toBeDisabled();
    expect(onSavePrompt).not.toHaveBeenCalled();

    await expect.element(prompt).toHaveAttribute("maxlength", "12");
  });

  it("can clear a saved prompt while off without changing the mode", async () => {
    const onSavePrompt = vi.fn(async () => undefined);
    await renderControl({
      mode: "off",
      persistedPrompt: "No longer needed",
      onSavePrompt,
    });

    await page.getByLabelText("Prompt for this thread").fill("");
    await expect.element(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save prompt" }).click();

    await vi.waitFor(() => {
      expect(onSavePrompt).toHaveBeenCalledTimes(1);
      expect(onSavePrompt).toHaveBeenCalledWith("");
    });
    await expect.element(page.getByText("Auto nudge - Off", { exact: true })).toBeVisible();
  });
});
