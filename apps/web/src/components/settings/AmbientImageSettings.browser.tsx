import "../../index.css";

import type { DesktopBridge } from "@cafecode/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@cafecode/contracts/settings";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY } from "../../ambientMediaGeometryStorage";
import { AmbientImageSettings } from "./AmbientImageSettings";

const ambientAsset = {
  id: `sha256-${"a".repeat(64)}.png`,
  mimeType: "image/png" as const,
  sizeBytes: 128,
  width: 320,
  height: 180,
  url: `/api/ambient-media/image/sha256-${"a".repeat(64)}.png`,
};

function directoryFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: `ambient/${name}`,
  });
  return file;
}

const settingsHarness = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  updateSettings: vi.fn(),
  updateSettingsAsync: vi.fn(async () => undefined),
}));

const ambientImageHarness = vi.hoisted(() => ({
  removeAmbientImage: vi.fn(async () => undefined),
  uploadAmbientImage: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => settingsHarness.settings,
  useUpdateSettings: () => ({
    updateSettings: settingsHarness.updateSettings,
    updateSettingsAsync: settingsHarness.updateSettingsAsync,
  }),
}));

vi.mock("../../ambientImages", () => ({
  removeAmbientImage: ambientImageHarness.removeAmbientImage,
  uploadAmbientImage: ambientImageHarness.uploadAmbientImage,
}));

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("AmbientImageSettings", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  beforeEach(() => {
    delete window.desktopBridge;
    window.localStorage.clear();
    settingsHarness.settings = { ...DEFAULT_CLIENT_SETTINGS };
    settingsHarness.updateSettings.mockReset();
    settingsHarness.updateSettingsAsync.mockClear();
    ambientImageHarness.removeAmbientImage.mockReset();
    ambientImageHarness.removeAmbientImage.mockResolvedValue(undefined);
    ambientImageHarness.uploadAmbientImage.mockReset();
  });

  afterEach(async () => {
    await mounted?.unmount().catch(() => undefined);
    mounted = null;
    delete window.desktopBridge;
    document.body.innerHTML = "";
  });

  it("exposes bounded preset, custom layout, cycle, and glow controls", async () => {
    mounted = await render(<AmbientImageSettings />);

    await expect
      .element(page.getByRole("heading", { name: "Ambient image", exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole("switch", { name: "Show ambient image" })).toBeVisible();
    await expect.element(page.getByLabelText("Ambient image size")).toHaveValue("medium");
    await expect
      .element(page.getByRole("group", { name: "Ambient image preset placement" }))
      .toBeVisible();
    await expect.element(page.getByRole("switch", { name: "Cycle ambient images" })).toBeDisabled();
    await expect.element(page.getByLabelText("Ambient image layout")).toHaveValue("preset");
  });

  it("selects and resets device-local custom positioning", async () => {
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageLayoutMode: "custom",
    };
    window.localStorage.setItem(
      AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        slots: { image: { x: 0.2, y: 0.3, width: 0.4 } },
      }),
    );
    mounted = await render(<AmbientImageSettings />);

    await userEvent.click(
      page.getByRole("button", { name: "Reset custom ambient image layout to default" }),
    );

    expect(window.localStorage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)).toBeNull();
    expect(settingsHarness.updateSettings).toHaveBeenCalledWith({
      ambientImageLayoutMode: "preset",
    });
  });

  it("enables custom positioning without changing the selected image", async () => {
    mounted = await render(<AmbientImageSettings />);

    await userEvent.selectOptions(page.getByLabelText("Ambient image layout"), "custom");

    expect(settingsHarness.updateSettings).toHaveBeenCalledWith({
      ambientImageLayoutMode: "custom",
    });
  });

  it("restores ambient presentation defaults without deleting the selected asset", async () => {
    mounted = await render(<AmbientImageSettings />);

    await userEvent.click(page.getByRole("button", { name: "Reset ambient image" }));
    expect(settingsHarness.updateSettings).toHaveBeenCalledWith({
      ambientImageEnabled: false,
      ambientImageCycleEnabled: false,
      ambientImageCycleSeconds: 20,
      ambientImagePresentationMode: "floating",
      ambientImageLayoutMode: "preset",
      ambientImagePresetPlacement: "bottom-left",
      ambientImagePresetSize: "medium",
      ambientImageGlowEnabled: false,
      ambientImageGlowColor: "auto",
      ambientImageGlowOpacity: 0.35,
    });
    expect(settingsHarness.updateSettings.mock.calls[0]?.[0]).not.toHaveProperty(
      "ambientImageAsset",
    );
  });

  it("offers theater presentation for a single ambient image", async () => {
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageAsset: ambientAsset,
      ambientImageCycleAssets: [ambientAsset],
    };
    mounted = await render(<AmbientImageSettings />);

    await userEvent.selectOptions(page.getByLabelText("Ambient image presentation"), "theater");

    expect(settingsHarness.updateSettings).toHaveBeenCalledWith({
      ambientImagePresentationMode: "theater",
    });
  });

  it("keeps the previous asset until its replacement settings are confirmed", async () => {
    const replacementAsset = {
      ...ambientAsset,
      id: `sha256-${"b".repeat(64)}.png`,
      url: `/api/ambient-media/image/sha256-${"b".repeat(64)}.png`,
    };
    const settingsConfirmation = createDeferredPromise<undefined>();
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageAsset: ambientAsset,
      ambientImageCycleAssets: [ambientAsset],
    };
    ambientImageHarness.uploadAmbientImage.mockResolvedValue(replacementAsset);
    settingsHarness.updateSettingsAsync.mockReturnValueOnce(settingsConfirmation.promise);
    mounted = await render(<AmbientImageSettings />);

    await userEvent.upload(
      page.getByLabelText("Ambient image file"),
      new File(["replacement"], "replacement.png", { type: "image/png" }),
    );
    await vi.waitFor(() => {
      expect(settingsHarness.updateSettingsAsync).toHaveBeenCalledWith({
        ambientImageAsset: replacementAsset,
        ambientImageCycleAssets: [],
        ambientImageCycleEnabled: false,
      });
    });
    expect(ambientImageHarness.removeAmbientImage).not.toHaveBeenCalled();

    settingsConfirmation.resolve(undefined);
    await vi.waitFor(() => {
      expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledOnce();
    });
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledWith(ambientAsset.id);
  });

  it("removes only the new upload when its settings write fails", async () => {
    const replacementAsset = {
      ...ambientAsset,
      id: `sha256-${"c".repeat(64)}.png`,
      url: `/api/ambient-media/image/sha256-${"c".repeat(64)}.png`,
    };
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageAsset: ambientAsset,
      ambientImageCycleAssets: [ambientAsset],
    };
    ambientImageHarness.uploadAmbientImage.mockResolvedValue(replacementAsset);
    settingsHarness.updateSettingsAsync.mockRejectedValueOnce(new Error("settings write failed"));
    mounted = await render(<AmbientImageSettings />);

    await userEvent.upload(
      page.getByLabelText("Ambient image file"),
      new File(["replacement"], "replacement.png", { type: "image/png" }),
    );

    await expect.element(page.getByRole("alert")).toHaveTextContent("settings write failed");
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledOnce();
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledWith(replacementAsset.id);
    expect(ambientImageHarness.removeAmbientImage).not.toHaveBeenCalledWith(ambientAsset.id);
  });

  it("cleans only completed folder uploads when a later upload fails", async () => {
    const previousCycleAsset = {
      ...ambientAsset,
      id: `sha256-${"b".repeat(64)}.png`,
      url: `/api/ambient-media/image/sha256-${"b".repeat(64)}.png`,
    };
    const completedUpload = {
      ...ambientAsset,
      id: `sha256-${"c".repeat(64)}.png`,
      url: `/api/ambient-media/image/sha256-${"c".repeat(64)}.png`,
    };
    window.desktopBridge = {} as DesktopBridge;
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageAsset: ambientAsset,
      ambientImageCycleAssets: [ambientAsset, previousCycleAsset],
    };
    ambientImageHarness.uploadAmbientImage
      .mockResolvedValueOnce(completedUpload)
      .mockRejectedValueOnce(new Error("second upload failed"));
    mounted = await render(<AmbientImageSettings />);

    await expect.element(page.getByLabelText("Ambient image folder")).toBeInTheDocument();
    const directoryInput = document.querySelector(
      'input[aria-label="Ambient image folder"]',
    ) as HTMLInputElement | null;
    expect(directoryInput).not.toBeNull();
    Object.defineProperty(directoryInput, "files", {
      configurable: true,
      value: [directoryFile("01-first.png", "first"), directoryFile("02-second.png", "second")],
    });
    directoryInput!.dispatchEvent(new Event("change", { bubbles: true }));

    await expect.element(page.getByRole("alert")).toHaveTextContent("second upload failed");
    expect(settingsHarness.updateSettingsAsync).not.toHaveBeenCalled();
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledOnce();
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledWith(completedUpload.id);
    expect(ambientImageHarness.removeAmbientImage).not.toHaveBeenCalledWith(ambientAsset.id);
    expect(ambientImageHarness.removeAmbientImage).not.toHaveBeenCalledWith(previousCycleAsset.id);
  });

  it("does not delete selected assets until clearing settings is confirmed", async () => {
    const previousCycleAsset = {
      ...ambientAsset,
      id: `sha256-${"d".repeat(64)}.png`,
      url: `/api/ambient-media/image/sha256-${"d".repeat(64)}.png`,
    };
    const settingsConfirmation = createDeferredPromise<undefined>();
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageAsset: ambientAsset,
      ambientImageCycleAssets: [ambientAsset, previousCycleAsset],
    };
    settingsHarness.updateSettingsAsync.mockReturnValueOnce(settingsConfirmation.promise);
    mounted = await render(<AmbientImageSettings />);

    await userEvent.click(page.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => {
      expect(settingsHarness.updateSettingsAsync).toHaveBeenCalledWith({
        ambientImageAsset: null,
        ambientImageCycleAssets: [],
        ambientImageCycleEnabled: false,
      });
    });
    expect(ambientImageHarness.removeAmbientImage).not.toHaveBeenCalled();

    settingsConfirmation.resolve(undefined);
    await vi.waitFor(() => {
      expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledTimes(2);
    });
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledWith(ambientAsset.id);
    expect(ambientImageHarness.removeAmbientImage).toHaveBeenCalledWith(previousCycleAsset.id);
  });

  it("allows replacing the cycle interval before committing the bounded value", async () => {
    settingsHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageCycleAssets: [
        ambientAsset,
        { ...ambientAsset, id: `sha256-${"b".repeat(64)}.png` },
      ],
    };
    mounted = await render(<AmbientImageSettings />);
    const cycleSeconds = page.getByLabelText("Ambient image cycle seconds");

    await userEvent.clear(cycleSeconds);
    await expect.element(cycleSeconds).toHaveValue(null);
    await userEvent.fill(cycleSeconds, "300");
    await userEvent.tab();

    expect(settingsHarness.updateSettings).toHaveBeenCalledWith({
      ambientImageCycleSeconds: 300,
    });
  });
});
