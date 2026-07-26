import { MAX_AMBIENT_IMAGE_FILE_BYTES, type AmbientImageAsset } from "@cafecode/contracts/settings";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import { prepareAmbientImageDirectory } from "../../ambientImageCycle";
import { removeAmbientImage, uploadAmbientImage } from "../../ambientImages";
import { resetAmbientMediaGeometry } from "../../ambientMediaGeometryStorage";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_AMBIENT_IMAGE_FILE_MIB = MAX_AMBIENT_IMAGE_FILE_BYTES / (1024 * 1024);

async function removeObsoleteAssets(
  candidates: readonly AmbientImageAsset[],
  retained: readonly AmbientImageAsset[],
): Promise<void> {
  const retainedIds = new Set(retained.map((asset) => asset.id));
  const removed = new Set<string>();
  await Promise.all(
    candidates.flatMap((asset) => {
      if (retainedIds.has(asset.id) || removed.has(asset.id)) return [];
      removed.add(asset.id);
      return [removeAmbientImage(asset.id).catch(() => undefined)];
    }),
  );
}

/** Kept self-contained so Appearance can remain a narrow integration point. */
export function AmbientImageSettings() {
  const settings = useSettings();
  const { updateSettings, updateSettingsAsync } = useUpdateSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [directoryUploading, setDirectoryUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cycleSecondsDraft, setCycleSecondsDraft] = useState(
    String(settings.ambientImageCycleSeconds),
  );
  useEffect(() => {
    setCycleSecondsDraft(String(settings.ambientImageCycleSeconds));
  }, [settings.ambientImageCycleSeconds]);
  const commitCycleSeconds = useCallback(() => {
    const seconds = Number(cycleSecondsDraft);
    if (
      cycleSecondsDraft.trim() !== "" &&
      Number.isInteger(seconds) &&
      seconds >= 3 &&
      seconds <= 3600
    ) {
      updateSettings({ ambientImageCycleSeconds: seconds });
      return;
    }
    setCycleSecondsDraft(String(settings.ambientImageCycleSeconds));
  }, [cycleSecondsDraft, settings.ambientImageCycleSeconds, updateSettings]);
  const upload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      if (file.type && !ACCEPTED_TYPES.has(file.type.toLowerCase())) {
        setError("Choose a PNG, JPEG, GIF, or WebP image.");
        return;
      }
      if (file.size > MAX_AMBIENT_IMAGE_FILE_BYTES) {
        setError(`Choose an image up to ${MAX_AMBIENT_IMAGE_FILE_MIB} MiB.`);
        return;
      }
      setUploading(true);
      let uploadedAsset: Awaited<ReturnType<typeof uploadAmbientImage>> | null = null;
      try {
        const previousAssets = [
          ...(settings.ambientImageAsset ? [settings.ambientImageAsset] : []),
          ...settings.ambientImageCycleAssets,
        ];
        uploadedAsset = await uploadAmbientImage(file);
        await updateSettingsAsync({
          ambientImageAsset: uploadedAsset,
          ambientImageCycleAssets: [],
          ambientImageCycleEnabled: false,
        });
        await removeObsoleteAssets(previousAssets, [uploadedAsset]);
        setError(null);
      } catch (cause) {
        if (uploadedAsset && uploadedAsset.id !== settings.ambientImageAsset?.id) {
          await removeAmbientImage(uploadedAsset.id).catch(() => undefined);
        }
        setError(cause instanceof Error ? cause.message : "Could not upload ambient image.");
      } finally {
        setUploading(false);
      }
    },
    [settings.ambientImageAsset, settings.ambientImageCycleAssets, updateSettingsAsync],
  );
  const uploadDirectory = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) return;
      const uploadedAssets: AmbientImageAsset[] = [];
      try {
        const prepared = prepareAmbientImageDirectory(files);
        setDirectoryUploading(true);
        const previousAssets = [
          ...(settings.ambientImageAsset ? [settings.ambientImageAsset] : []),
          ...settings.ambientImageCycleAssets,
        ];
        // The server already limits image decoding concurrency. Sequential upload
        // keeps cancellation/error cleanup deterministic and avoids a burst from a
        // directory picker.
        for (const file of prepared.files) uploadedAssets.push(await uploadAmbientImage(file));
        const distinctAssets = uploadedAssets.filter(
          (asset, index) =>
            uploadedAssets.findIndex((candidate) => candidate.id === asset.id) === index,
        );
        await updateSettingsAsync({
          ambientImageAsset: distinctAssets[0] ?? null,
          ambientImageCycleAssets: distinctAssets,
          ambientImageCycleEnabled: distinctAssets.length > 1,
        });
        await removeObsoleteAssets(previousAssets, distinctAssets);
        setError(
          prepared.skippedUnsupported > 0
            ? `${prepared.skippedUnsupported} unsupported file${prepared.skippedUnsupported === 1 ? " was" : "s were"} skipped.`
            : null,
        );
      } catch (cause) {
        await removeObsoleteAssets(uploadedAssets, [
          ...(settings.ambientImageAsset ? [settings.ambientImageAsset] : []),
          ...settings.ambientImageCycleAssets,
        ]).catch(() => undefined);
        setError(cause instanceof Error ? cause.message : "Could not load the image folder.");
      } finally {
        setDirectoryUploading(false);
      }
    },
    [settings.ambientImageAsset, settings.ambientImageCycleAssets, updateSettingsAsync],
  );
  const remove = useCallback(async () => {
    const assets = [
      ...(settings.ambientImageAsset ? [settings.ambientImageAsset] : []),
      ...settings.ambientImageCycleAssets,
    ];
    if (assets.length === 0) return;
    setRemoving(true);
    try {
      await updateSettingsAsync({
        ambientImageAsset: null,
        ambientImageCycleAssets: [],
        ambientImageCycleEnabled: false,
      });
      await removeObsoleteAssets(assets, []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove ambient image.");
    } finally {
      setRemoving(false);
    }
  }, [settings.ambientImageAsset, settings.ambientImageCycleAssets, updateSettingsAsync]);
  const directorySupported = typeof window !== "undefined" && window.desktopBridge !== undefined;
  return (
    <SettingsSection title="Ambient image">
      <SettingsRow
        title="Show ambient image"
        description="An optional GIF or image floats inside the chat area."
        control={
          <Switch
            checked={settings.ambientImageEnabled}
            onCheckedChange={(ambientImageEnabled) => updateSettings({ ambientImageEnabled })}
            aria-label="Show ambient image"
          />
        }
      />
      <SettingsRow
        title="Image source"
        description={
          settings.ambientImageCycleAssets.length > 0
            ? `${settings.ambientImageCycleAssets.length} private image${settings.ambientImageCycleAssets.length === 1 ? "" : "s"} in the cycle.`
            : settings.ambientImageAsset
              ? `${settings.ambientImageAsset.mimeType}, ${settings.ambientImageAsset.width} × ${settings.ambientImageAsset.height}`
              : "Upload an image. It stays private to authenticated Cafe Code sessions."
        }
        status={
          error ? (
            <span className="text-destructive" role="alert">
              {error}
            </span>
          ) : null
        }
        control={
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={upload}
              aria-label="Ambient image file"
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading || directoryUploading || removing}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading…" : settings.ambientImageAsset ? "Replace" : "Upload"}
            </Button>
            {settings.ambientImageAsset ? (
              <Button
                type="button"
                variant="ghost"
                disabled={uploading || directoryUploading || removing}
                onClick={() => void remove()}
              >
                {removing ? "Removing…" : "Remove"}
              </Button>
            ) : null}
            {directorySupported ? (
              <>
                <input
                  ref={(input) => {
                    directoryInputRef.current = input;
                    input?.setAttribute("webkitdirectory", "");
                  }}
                  className="sr-only"
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={uploadDirectory}
                  aria-label="Ambient image folder"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading || directoryUploading || removing}
                  onClick={() => directoryInputRef.current?.click()}
                >
                  {directoryUploading ? "Loading folder…" : "Choose image folder"}
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <SettingsRow
        title="Image folder cycling"
        description={
          directorySupported
            ? "Desktop only. Choose a folder of up to 24 PNG, JPEG, GIF, or WebP images (80 MiB total). Relative paths are used only to sort locally and are never uploaded or persisted; only private, content-addressed images are saved. Choosing a folder does not turn the ambient image on."
            : "Image-folder cycling is available in the Cafe Code desktop app. Browser sessions keep single-image upload only."
        }
        control={
          <Switch
            checked={settings.ambientImageCycleEnabled}
            disabled={settings.ambientImageCycleAssets.length < 2}
            onCheckedChange={(ambientImageCycleEnabled) =>
              updateSettings({ ambientImageCycleEnabled })
            }
            aria-label="Cycle ambient images"
          />
        }
      >
        {settings.ambientImageCycleAssets.length > 1 ? (
          <div className="flex flex-wrap items-center gap-3 pb-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              Change every
              <input
                aria-label="Ambient image cycle seconds"
                className="w-20 rounded border bg-background px-2 py-1 text-foreground"
                type="number"
                min="3"
                max="3600"
                step="1"
                value={cycleSecondsDraft}
                onChange={(event) => setCycleSecondsDraft(event.currentTarget.value)}
                onBlur={commitCycleSeconds}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setCycleSecondsDraft(String(settings.ambientImageCycleSeconds));
                    event.currentTarget.blur();
                  }
                }}
              />
              seconds
            </label>
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Presentation"
        description="Float the image in the chat area or expand it into a softly blurred theater backdrop."
        control={
          <select
            aria-label="Ambient image presentation"
            className="rounded border bg-background px-2 py-1 text-foreground"
            value={settings.ambientImagePresentationMode}
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (mode === "floating" || mode === "theater") {
                updateSettings({ ambientImagePresentationMode: mode });
              }
            }}
          >
            <option value="floating">Floating</option>
            <option value="theater">Theater</option>
          </select>
        }
      />
      <SettingsRow
        title="Layout"
        description="Use a preset corner, or drag and resize a custom floating image. Custom placement is stored only on this device."
        resetAction={
          settings.ambientImageLayoutMode === "custom" ? (
            <SettingResetButton
              label="custom ambient image layout"
              onClick={() => {
                resetAmbientMediaGeometry("image");
                updateSettings({ ambientImageLayoutMode: "preset" });
              }}
            />
          ) : null
        }
        control={
          <select
            aria-label="Ambient image layout"
            className="rounded border bg-background px-2 py-1 text-foreground"
            value={settings.ambientImageLayoutMode}
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (mode === "preset" || mode === "custom") {
                updateSettings({ ambientImageLayoutMode: mode });
              }
            }}
          >
            <option value="preset">Preset</option>
            <option value="custom">Custom</option>
          </select>
        }
      />
      <SettingsRow
        title="Preset placement"
        description="Choose the starting bottom corner for the preset image."
        control={
          <div
            className="flex rounded-lg border p-0.5 text-xs"
            role="group"
            aria-label="Ambient image preset placement"
          >
            <label
              className={
                settings.ambientImagePresetPlacement === "bottom-left"
                  ? "cursor-pointer rounded bg-accent px-2 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  : "cursor-pointer px-2 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              }
            >
              <input
                className="sr-only"
                type="radio"
                name="ambient-image-preset-placement"
                value="bottom-left"
                checked={settings.ambientImagePresetPlacement === "bottom-left"}
                onChange={() => updateSettings({ ambientImagePresetPlacement: "bottom-left" })}
              />
              Bottom left
            </label>
            <label
              className={
                settings.ambientImagePresetPlacement === "bottom-right"
                  ? "cursor-pointer rounded bg-accent px-2 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  : "cursor-pointer px-2 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              }
            >
              <input
                className="sr-only"
                type="radio"
                name="ambient-image-preset-placement"
                value="bottom-right"
                checked={settings.ambientImagePresetPlacement === "bottom-right"}
                onChange={() => updateSettings({ ambientImagePresetPlacement: "bottom-right" })}
              />
              Bottom right
            </label>
          </div>
        }
      />
      <SettingsRow
        title="Preset size"
        description="Preset sizes preserve the image aspect ratio."
        control={
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={settings.ambientImagePresetSize}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "small" || value === "medium" || value === "large")
                updateSettings({ ambientImagePresetSize: value });
            }}
            aria-label="Ambient image size"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        }
      />
      <SettingsRow
        title="Ambient glow"
        description="A soft edge glow uses your selected color."
        control={
          <Switch
            checked={settings.ambientImageGlowEnabled}
            onCheckedChange={(ambientImageGlowEnabled) =>
              updateSettings({ ambientImageGlowEnabled })
            }
            aria-label="Ambient image glow"
          />
        }
      >
        {settings.ambientImageGlowEnabled ? (
          <div className="flex items-center gap-3 pb-3">
            <input
              aria-label="Ambient image glow color"
              type="color"
              value={
                settings.ambientImageGlowColor === "auto"
                  ? "#7dd3fc"
                  : settings.ambientImageGlowColor
              }
              onChange={(event) => updateSettings({ ambientImageGlowColor: event.target.value })}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Intensity{" "}
              <input
                aria-label="Ambient image glow intensity"
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={settings.ambientImageGlowOpacity}
                onChange={(event) =>
                  updateSettings({ ambientImageGlowOpacity: Number(event.target.value) })
                }
              />
            </label>
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Reset ambient image"
        description="Restores the layout and glow defaults without deleting the uploaded image."
        resetAction={
          <SettingResetButton
            label="ambient image"
            onClick={() => {
              resetAmbientMediaGeometry("image");
              updateSettings({
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
            }}
          />
        }
      />
    </SettingsSection>
  );
}
