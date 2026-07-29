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
      limitsSaving={false}
      onSaveLimits={() => undefined}
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
  const mounted = await render(control(overrides));
  await page.getByRole("button", { name: "Expand Auto Nudge controls" }).click();
  await expect
    .element(page.getByRole("button", { name: "Collapse Auto Nudge controls" }))
    .toHaveAttribute("aria-expanded", "true");
  return mounted;
}

async function renderCollapsedControl(
  overrides: Partial<React.ComponentProps<typeof AutoNudgeControl>> = {},
) {
  return render(control(overrides));
}

function autoNudgeDisclosure(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-auto-nudge-disclosure="true"]');
}

function autoNudgeRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-auto-nudge-control="true"]');
}

function autoNudgeBackgroundAnimation(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-auto-nudge-background-animation="true"]');
}

function autoNudgeBackgroundBase(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-auto-nudge-background-base="true"]');
}

describe("AutoNudgeControl", () => {
  it("starts minimized on phone and desktop while keeping a live status summary", async () => {
    await page.viewport(390, 844);
    const mobile = await renderCollapsedControl({
      mode: "steady-progress",
      countdownSeconds: 4,
    });

    try {
      const mobileToggle = page.getByRole("button", { name: "Expand Auto Nudge controls" });
      await expect.element(mobileToggle).toHaveAttribute("aria-expanded", "false");
      await expect.element(page.getByText("Next nudge in 4s")).toBeVisible();
      expect(autoNudgeRoot()?.classList.contains("max-w-3xl")).toBe(true);
      expect(autoNudgeRoot()?.dataset.autoNudgeExpanded).toBe("false");
      expect(document.querySelector('[data-auto-nudge-details="true"]')).toBeNull();
      await mobileToggle.click();
      const mobileDetails = document.querySelector<HTMLElement>('[data-auto-nudge-details="true"]');
      expect(mobileDetails).not.toBeNull();
      await expect.element(mobileDetails!).toBeVisible();
      expect(autoNudgeRoot()?.classList.contains("max-w-3xl")).toBe(false);
      expect(autoNudgeRoot()?.dataset.autoNudgeExpanded).toBe("true");
      expect(mobileDetails!.classList.contains("overflow-y-auto")).toBe(true);
      expect(mobileDetails!.classList.contains("max-h-[min(60dvh,32rem)]")).toBe(true);
    } finally {
      await mobile.unmount();
    }

    await page.viewport(1_200, 800);
    const desktop = await renderCollapsedControl();
    try {
      await expect
        .element(page.getByRole("button", { name: "Expand Auto Nudge controls" }))
        .toHaveAttribute("aria-expanded", "false");
      await expect.element(page.getByText("Off", { exact: true })).toBeVisible();
      expect(autoNudgeRoot()?.classList.contains("max-w-3xl")).toBe(true);
    } finally {
      await desktop.unmount();
      await page.viewport(800, 600);
    }
  });

  it("maps Off, active, and background continuation to distinct disclosure treatments", async () => {
    const mounted = await renderCollapsedControl();

    expect(autoNudgeDisclosure()?.dataset.autoNudgeVisualState).toBe("off");
    expect(autoNudgeDisclosure()?.classList.contains("border-red-500/50")).toBe(true);
    expect(autoNudgeDisclosure()?.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      autoNudgeDisclosure()
        ?.getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    ).toContain("Auto Nudge is off.");
    expect(autoNudgeBackgroundBase()).toBeNull();
    expect(autoNudgeBackgroundAnimation()).toBeNull();

    await mounted.rerender(control({ mode: "steady-progress" }));
    expect(autoNudgeDisclosure()?.dataset.autoNudgeVisualState).toBe("active");
    expect(autoNudgeDisclosure()?.classList.contains("border-emerald-500/50")).toBe(true);
    expect(autoNudgeBackgroundBase()).toBeNull();
    expect(autoNudgeBackgroundAnimation()).toBeNull();

    await mounted.rerender(control({ mode: "steady-progress", backgroundEnabled: true }));
    expect(autoNudgeDisclosure()?.dataset.autoNudgeVisualState).toBe("background");
    expect(autoNudgeBackgroundBase()?.classList.contains("bg-cyan-500/20")).toBe(true);
    expect(autoNudgeBackgroundAnimation()?.classList.contains("bg-emerald-500/30")).toBe(true);
    expect(autoNudgeBackgroundAnimation()?.classList.contains("motion-safe:animate-pulse")).toBe(
      true,
    );
    expect(autoNudgeBackgroundAnimation()?.classList.contains("motion-reduce:animate-none")).toBe(
      true,
    );
    expect(autoNudgeDisclosure()?.classList.contains("motion-safe:animate-pulse")).toBe(false);
    expect(
      autoNudgeDisclosure()
        ?.getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    ).toContain("Auto Nudge is on with background continuation.");
  });

  it("opens and minimizes without mutating Auto Nudge authority", async () => {
    const callbacks = {
      onSavePrompt: vi.fn(),
      onSaveLimits: vi.fn(),
      onModeChange: vi.fn(),
      onBackgroundChange: vi.fn(),
      onStop: vi.fn(),
      onEmergencyStopAll: vi.fn(),
      onAllowAutoNudgeAgain: vi.fn(),
    };
    await renderCollapsedControl(callbacks);

    await page.getByRole("button", { name: "Expand Auto Nudge controls" }).click();
    const collapse = page.getByRole("button", { name: "Collapse Auto Nudge controls" });
    await expect.element(collapse).toHaveAttribute("aria-expanded", "true");
    const controlsId = collapse.element().getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId ?? "")).not.toBeNull();
    expect(
      document
        .getElementById(controlsId ?? "")
        ?.classList.contains("motion-reduce:transition-none"),
    ).toBe(true);
    await collapse.click();
    await expect
      .element(page.getByRole("button", { name: "Expand Auto Nudge controls" }))
      .toHaveAttribute("aria-expanded", "false");

    Object.values(callbacks).forEach((callback) => expect(callback).not.toHaveBeenCalled());
  });

  it("keeps exact-thread Stop available while minimized without opening the controls", async () => {
    const onStop = vi.fn();
    await renderCollapsedControl({ mode: "steady-progress", onStop });

    await page.getByRole("button", { name: "Stop this thread" }).click();

    expect(onStop).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByRole("button", { name: "Expand Auto Nudge controls" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-auto-nudge-details="true"]')).toBeNull();
  });

  it("renders the durable mode state", async () => {
    await renderControl({ mode: "steady-progress" });

    await expect.element(page.getByText("Armed for the next safely settled turn")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Stop this thread" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Emergency Stop all" })).toBeVisible();
  });

  it("keeps exact-thread Stop available while an enable write is still pending", async () => {
    const onStop = vi.fn();
    await renderControl({ mode: "off", disabled: true, arming: true, onStop });

    await expect.element(page.getByText("Saving this thread")).toBeVisible();
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

    await expect.element(page.getByText("Emergency stop is active")).toBeVisible();
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

  it("discards an unsaved draft on an exact environment/thread change without silently saving it", async () => {
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
        promptScopeKey: "environment-b/thread-a",
        persistedPrompt: "The same saved text",
        onSavePrompt,
      }),
    );

    await expect
      .element(page.getByRole("button", { name: "Expand Auto Nudge controls" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-auto-nudge-details="true"]')).toBeNull();
    await page.getByRole("button", { name: "Expand Auto Nudge controls" }).click();
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
        promptScopeKey: "environment-b/thread-a",
        persistedPrompt: "Thread B saved prompt",
        onSavePrompt,
      }),
    );
    await expect
      .element(page.getByRole("button", { name: "Expand Auto Nudge controls" }))
      .toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Expand Auto Nudge controls" }).click();
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

    await expect.element(page.getByText("Prompt cannot be empty")).toBeVisible();
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
    expect(
      document.querySelector<HTMLButtonElement>('[data-auto-nudge-disclosure="true"]')?.textContent,
    ).toContain("Off");
  });

  it("edits and explicitly saves bounded whole-number limits for the exact thread", async () => {
    const onSaveLimits = vi.fn(async () => undefined);
    await renderControl({
      maxRounds: 5,
      maxMinutes: 30,
      onSaveLimits,
    });

    const maxRounds = page.getByLabelText("Maximum rounds");
    const maxMinutes = page.getByLabelText("Maximum minutes");
    await expect.element(maxRounds).toHaveValue(5);
    await expect.element(maxMinutes).toHaveValue(30);
    await maxRounds.fill("9");
    await maxMinutes.fill("75");

    await expect.element(page.getByText("Unsaved limit changes")).toBeVisible();
    await page.getByRole("button", { name: "Save limits" }).click();

    await vi.waitFor(() => {
      expect(onSaveLimits).toHaveBeenCalledTimes(1);
      expect(onSaveLimits).toHaveBeenCalledWith(9, 75);
    });
  });

  it("rejects fractional and out-of-range limits before the thread configure boundary", async () => {
    const onSaveLimits = vi.fn(async () => undefined);
    await renderControl({ onSaveLimits });

    const maxRounds = page.getByLabelText("Maximum rounds");
    await maxRounds.fill("1.5");

    await expect
      .element(page.getByText("Enter whole numbers within the allowed ranges"))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save limits" })).toBeDisabled();
    expect(onSaveLimits).not.toHaveBeenCalled();

    await maxRounds.fill("21");
    await expect.element(maxRounds).toHaveAttribute("aria-invalid", "true");
    await expect.element(page.getByRole("button", { name: "Save limits" })).toBeDisabled();
  });
});
