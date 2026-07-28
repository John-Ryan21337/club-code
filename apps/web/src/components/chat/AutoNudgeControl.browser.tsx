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
      roundsDispatched={0}
      maxRounds={5}
      maxMinutes={30}
      globallySuppressed={false}
      promptScopeKey="environment-a/thread-a"
      persistedPrompt="Keep this thread moving"
      promptMaxLength={4_000}
      promptSaving={false}
      promptEditable
      onSavePrompt={() => undefined}
      onModeChange={() => undefined}
      onBackgroundChange={() => undefined}
      onStop={() => undefined}
      onEmergencyStopAll={() => undefined}
      onAllowAutoNudgeAgain={() => undefined}
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
    await expect.element(page.getByRole("button", { name: "Stop this thread" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Emergency Stop all" })).toBeVisible();
  });

  it("keeps exact-thread Stop available while an enable write is still pending", async () => {
    const onStop = vi.fn();
    await renderControl({ mode: "off", disabled: true, arming: true, onStop });

    await expect.element(page.getByText("Auto nudge - Saving this thread")).toBeVisible();
    await page.getByRole("button", { name: "Stop this thread" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("separates exact-thread Stop from Emergency Stop all", async () => {
    const onStop = vi.fn();
    const onEmergencyStopAll = vi.fn();
    await renderControl({
      mode: "steady-progress",
      onStop,
      onEmergencyStopAll,
    });

    await page.getByRole("button", { name: "Stop this thread" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onEmergencyStopAll).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Emergency Stop all" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onEmergencyStopAll).toHaveBeenCalledTimes(1);
  });

  it("shows exact-thread background accounting without singleton ownership language", async () => {
    const onBackgroundChange = vi.fn();
    await renderControl({
      mode: "steady-progress",
      backgroundEnabled: true,
      roundsDispatched: 2,
      maxRounds: 7,
      maxMinutes: 45,
      onBackgroundChange,
    });

    await expect
      .element(
        page.getByText(
          "Background continuation is enabled for this thread - 2/7 rounds dispatched.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByText("Another thread owns background continuation.", { exact: false }))
      .not.toBeInTheDocument();
    await page.getByText("Continue this thread in background", { exact: true }).click();

    expect(onBackgroundChange).toHaveBeenCalledTimes(1);
    expect(onBackgroundChange).toHaveBeenCalledWith(false);
  });

  it("requires an explicit action to clear Emergency Stop all", async () => {
    const onAllowAutoNudgeAgain = vi.fn();
    const onStop = vi.fn();
    await renderControl({
      mode: "steady-progress",
      globallySuppressed: true,
      onAllowAutoNudgeAgain,
      onStop,
    });

    await expect.element(page.getByText("Auto nudge - Emergency stop is active")).toBeVisible();
    await expect
      .element(
        page.getByText("Emergency Stop all is blocking Auto Nudge in every thread.", {
          exact: false,
        }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Emergency Stop all" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Allow Auto Nudge again" }).click();

    expect(onAllowAutoNudgeAgain).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
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

  it("does not present an unpersisted route as an editable prompt", async () => {
    const onSavePrompt = vi.fn(async () => undefined);
    await renderControl({
      disabled: true,
      promptEditable: false,
      persistedPrompt: "",
      onSavePrompt,
    });

    await expect.element(page.getByLabelText("Prompt for this thread")).toBeDisabled();
    await expect.element(page.getByText("Prompt unavailable for this thread")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save prompt" })).toBeDisabled();
    await expect
      .element(page.getByText("Open a persisted thread to edit its prompt.", { exact: false }))
      .toBeVisible();
    expect(onSavePrompt).not.toHaveBeenCalled();
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

  it("isolates a stale async save completion from the replacement thread", async () => {
    let releaseSave: (() => void) | undefined;
    let oldSaveFinished = false;
    const onSavePrompt = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      oldSaveFinished = true;
      throw new Error("Thread A save failed");
    });
    const mounted = await renderControl({
      promptScopeKey: "environment-a/thread-a",
      persistedPrompt: "Thread A saved prompt",
      onSavePrompt,
    });

    await page.getByLabelText("Prompt for this thread").fill("Thread A pending prompt");
    await page.getByRole("button", { name: "Save prompt" }).click();
    await expect.element(page.getByText("Saving prompt", { exact: true })).toBeVisible();

    await mounted.rerender(
      control({
        promptScopeKey: "environment-a/thread-b",
        persistedPrompt: "Thread B saved prompt",
        onSavePrompt,
      }),
    );
    await expect
      .element(page.getByLabelText("Prompt for this thread"))
      .toHaveValue("Thread B saved prompt");
    await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();

    releaseSave?.();
    await vi.waitFor(() => expect(oldSaveFinished).toBe(true));
    await expect
      .element(page.getByText("Prompt could not be saved. Try again."))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Prompt for this thread"))
      .toHaveValue("Thread B saved prompt");
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
