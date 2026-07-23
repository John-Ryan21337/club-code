import { MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";
import { type ChangeEvent, useCallback, useRef, useState } from "react";

import { removeAmbientImage, uploadAmbientImage } from "../../ambientImages";
import { resetAmbientMediaGeometry } from "../../ambientMediaGeometryStorage";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Kept self-contained so Appearance can remain a narrow integration point. */
export function AmbientImageSettings() {
  const settings = useSettings();
  const { updateSettings, updateSettingsAsync } = useUpdateSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setError("Choose an image under 1 MB.");
        return;
      }
      setUploading(true);
      let uploadedAsset: Awaited<ReturnType<typeof uploadAmbientImage>> | null = null;
      try {
        const previousAsset = settings.ambientImageAsset;
        uploadedAsset = await uploadAmbientImage(file);
        await updateSettingsAsync({ ambientImageAsset: uploadedAsset });
        if (previousAsset && previousAsset.id !== uploadedAsset.id) {
          await removeAmbientImage(previousAsset.id);
        }
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
    [settings.ambientImageAsset, updateSettingsAsync],
  );
  const remove = useCallback(async () => {
    const asset = settings.ambientImageAsset;
    if (!asset) return;
    setRemoving(true);
    try {
      await updateSettingsAsync({ ambientImageAsset: null });
      await removeAmbientImage(asset.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove ambient image.");
    } finally {
      setRemoving(false);
    }
  }, [settings.ambientImageAsset, updateSettingsAsync]);
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
          settings.ambientImageAsset
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
          <div className="flex gap-2">
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
              disabled={uploading || removing}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading…" : settings.ambientImageAsset ? "Replace" : "Upload"}
            </Button>
            {settings.ambientImageAsset ? (
              <Button
                type="button"
                variant="ghost"
                disabled={uploading || removing}
                onClick={() => void remove()}
              >
                {removing ? "Removing…" : "Remove"}
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingsRow
        title="Layout"
        description="Preset uses a comfortable corner. Custom adds mouse and keyboard move/resize handles."
        control={
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={settings.ambientImageLayoutMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "preset" || value === "custom") {
                updateSettings({ ambientImageLayoutMode: value });
              }
            }}
            aria-label="Ambient image layout"
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
