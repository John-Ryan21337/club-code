import type { ClientSettingsPatch } from "@cafecode/contracts/settings";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { usePresentationProfiles } from "../presentationProfiles";
import { settingsProfileLibraryStore } from "../settingsProfiles";

const mocks = vi.hoisted(() => ({
  settings: {
    mobileOptimizedPresentation: true,
    fallingEffectKind: "rain",
    fallingEffectSpeed: 1.5,
  } as Record<string, unknown>,
  theme: "dark" as "dark" | "light" | "system",
  updateClientSettingsConfirmed: vi.fn<(patch: ClientSettingsPatch) => Promise<void>>(),
}));

vi.mock("../hooks/useSettings", () => ({
  getClientSettings: () => mocks.settings,
  useClientSettingsHydrated: () => true,
  useSettings: (selector: (settings: Record<string, unknown>) => unknown) =>
    selector(mocks.settings),
  useUpdateSettings: () => ({
    updateClientSettingsConfirmed: mocks.updateClientSettingsConfirmed,
  }),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: mocks.theme,
    setTheme: (theme: "dark" | "light" | "system") => {
      mocks.theme = theme;
    },
  }),
}));

function PresentationProfileHarness() {
  const presentation = usePresentationProfiles();
  return (
    <div>
      <output data-testid="active-mode">{presentation.activeMode}</output>
      <output data-testid="busy">{presentation.busy ? "busy" : "idle"}</output>
      <button
        disabled={presentation.busy}
        onClick={() => void presentation.switchTo("desktop")}
        type="button"
      >
        Desktop
      </button>
      <button
        disabled={presentation.busy}
        onClick={() => void presentation.switchTo("mobile")}
        type="button"
      >
        Mobile
      </button>
    </div>
  );
}

describe("presentation profile switching", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsProfileLibraryStore.resetForTests();
    mocks.settings = {
      mobileOptimizedPresentation: true,
      fallingEffectKind: "rain",
      fallingEffectSpeed: 1.5,
    };
    mocks.theme = "dark";
    mocks.updateClientSettingsConfirmed.mockReset();
    mocks.updateClientSettingsConfirmed.mockImplementation(async (patch) => {
      mocks.settings = { ...mocks.settings, ...patch };
    });

    settingsProfileLibraryStore.upsert("Desktop Profile", {
      theme: "dark",
      clientSettings: {
        mobileOptimizedPresentation: false,
        fallingEffectKind: "matrix",
        fallingEffectSpeed: 4,
      },
    });
    settingsProfileLibraryStore.upsert("Mobile Profile", {
      theme: "dark",
      clientSettings: {
        mobileOptimizedPresentation: true,
        fallingEffectKind: "rain",
        fallingEffectSpeed: 1.5,
      },
    });
  });

  afterEach(() => {
    settingsProfileLibraryStore.resetForTests();
  });

  it("commits Desktop layout and visual settings as one authoritative patch", async () => {
    const screen = await render(<PresentationProfileHarness />);
    await expect.element(page.getByTestId("active-mode")).toHaveTextContent("mobile");

    await page.getByRole("button", { name: "Desktop" }).click();

    await expect.element(page.getByTestId("active-mode")).toHaveTextContent("desktop");
    await expect.element(page.getByTestId("busy")).toHaveTextContent("idle");
    expect(mocks.updateClientSettingsConfirmed).toHaveBeenCalledTimes(1);
    expect(mocks.updateClientSettingsConfirmed).toHaveBeenCalledWith({
      mobileOptimizedPresentation: false,
      fallingEffectKind: "matrix",
      fallingEffectSpeed: 4,
    });
    expect(settingsProfileLibraryStore.getSnapshot().activeProfileId).toBe(
      "profile:desktop%20profile",
    );
    expect(mocks.settings).toMatchObject({
      mobileOptimizedPresentation: false,
      fallingEffectKind: "matrix",
      fallingEffectSpeed: 4,
    });

    await screen.unmount();
  });
});
