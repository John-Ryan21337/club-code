import { useEffect, useRef, useState } from "react";
import {
  MAX_AMBIENT_IMAGE_CYCLE_ASSETS,
  MAX_AMBIENT_IMAGE_CYCLE_SECONDS,
  MIN_AMBIENT_IMAGE_CYCLE_SECONDS,
  type AmbientImageAsset,
  type ClientSettingsPatch,
} from "@cafecode/contracts/settings";

import {
  prepareAmbientImageDirectory,
  type AmbientDirectoryImageFile,
} from "../../ambientImageCycle";
import {
  AmbientImageClientError,
  ambientImageErrorMessage,
  removeAmbientImage,
  resolveAmbientImageSrc,
  uploadAmbientImage,
} from "../../ambientImages";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { AmbientImagePanelSettingsRows } from "./AmbientImagePanelSettings";
import { Switch } from "../ui/switch";
import { ensureLocalApi } from "../../localApi";
import { applyClientSettingsUpdated } from "../../rpc/serverState";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/**
 * Ambient image library. Uploading, folder selection and removal all go through
 * the authenticated Cafe routes; the library persists only server-minted asset
 * records, never a local path, handle or the picked directory name.
 */
export function AmbientImageSettingsSection() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "file" | "folder" | "remove">(null);
  const operationActive = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const library = settings.ambientImageCycleAssets;

  /**
   * Commit a library change and wait for the backend-authoritative answer.
   * Deletion needs a confirmed write: the server refuses to remove bytes the
   * settings document still references, so a fire-and-forget patch would make
   * cleanup race the guard and lose.
   */
  const commitLibrary = async (patch: ClientSettingsPatch) => {
    if (!mounted.current) throw new AmbientImageClientError("Ambient image selection was closed.");
    try {
      const saved = await ensureLocalApi().server.updateClientSettings(patch);
      applyClientSettingsUpdated(saved);
      return saved;
    } catch {
      throw new AmbientImageClientError("Ambient image settings could not be saved.");
    }
  };

  /**
   * Best-effort removal of bytes that the saved settings no longer reference.
   * Bounded by the library cap (at most `MAX_AMBIENT_IMAGE_CYCLE_ASSETS` ids per
   * call) and run only after the settings write is acknowledged, so a folder
   * replacement or a removal cannot silently strand a profile-quota worth of
   * files. Failures are counted, not thrown: the new library is already saved
   * and correct, and the server-side reference guard remains the only thing
   * that decides whether bytes may go.
   */
  const pruneUnreferenced = async (
    previous: readonly AmbientImageAsset[],
    saved: { readonly ambientImageCycleAssets: readonly AmbientImageAsset[] } & {
      readonly ambientImageAsset: AmbientImageAsset | null;
    },
  ): Promise<number> => {
    const stillReferenced = new Set(saved.ambientImageCycleAssets.map((entry) => entry.id));
    if (saved.ambientImageAsset) stillReferenced.add(saved.ambientImageAsset.id);
    return discardUnreferenced(previous.filter((entry) => !stillReferenced.has(entry.id)));
  };

  /**
   * Ask the server to drop bytes this view believes nothing references, and
   * report how many it would not or could not drop. The server re-reads the
   * settings document when the DELETE arrives and refuses (409) while the id is
   * still referenced, so a refusal is counted as "still stored", never forced.
   */
  const discardUnreferenced = async (assets: readonly AmbientImageAsset[]): Promise<number> => {
    let stranded = 0;
    for (const entry of assets.slice(0, MAX_AMBIENT_IMAGE_CYCLE_ASSETS)) {
      try {
        await removeAmbientImage(entry.id);
      } catch {
        stranded += 1;
      }
    }
    return stranded;
  };

  const runUpload = async (
    label: "file" | "folder" | "remove",
    work: (uploaded: AmbientImageAsset[]) => Promise<void>,
  ) => {
    // Guard synchronously: two input events can arrive before React paints disabled controls.
    if (operationActive.current) return;
    operationActive.current = true;
    const uploaded: AmbientImageAsset[] = [];
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await work(uploaded);
    } catch (cause) {
      const previousIds = new Set(library.map((asset) => asset.id));
      if (settings.ambientImageAsset) previousIds.add(settings.ambientImageAsset.id);
      const provisional = uploaded.filter(
        (asset, index) =>
          !previousIds.has(asset.id) &&
          uploaded.findIndex((other) => other.id === asset.id) === index,
      );
      const stranded = await discardUnreferenced(provisional);
      const reason = ambientImageErrorMessage(cause, "Ambient image change failed. Try again.");
      const cleanup =
        provisional.length === 0
          ? ""
          : stranded > 0
            ? ` ${stranded} uploaded ${stranded === 1 ? "file is" : "files are"} still stored on the server.`
            : " The uploaded files were discarded.";
      if (mounted.current) setError(`${reason}${cleanup}`);
    } finally {
      operationActive.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const addFiles = (files: readonly File[]) =>
    runUpload("file", async (uploaded) => {
      const room = MAX_AMBIENT_IMAGE_CYCLE_ASSETS - library.length;
      if (room <= 0) {
        throw new AmbientImageClientError(
          `The library already holds ${MAX_AMBIENT_IMAGE_CYCLE_ASSETS} images.`,
        );
      }
      for (const file of files.slice(0, room)) {
        if (!mounted.current)
          throw new AmbientImageClientError("Ambient image selection was closed.");
        uploaded.push(await uploadAmbientImage(file));
      }
      const merged = [...library];
      // Content addressing means re-uploading a picture that is already in the
      // library yields the same id. Only the genuinely new ids belong to this
      // call: the rest stay referenced by the saved document, and the server
      // would correctly refuse to delete them.
      const added: AmbientImageAsset[] = [];
      for (const asset of uploaded) {
        if (merged.some((entry) => entry.id === asset.id)) continue;
        merged.push(asset);
        added.push(asset);
      }
      const firstUploaded = uploaded[0];
      // Uploading puts bytes on disk before anything references them, so this
      // save has to be confirmed too. The fire-and-forget `updateSettings`
      // path would paint the new thumbnails, report success, and leave a
      // failed write behind as bytes nothing points at.
      await commitLibrary({
        ambientImageCycleAssets: merged,
        ...(settings.ambientImageAsset || !firstUploaded
          ? {}
          : { ambientImageAsset: firstUploaded }),
      });
      setNotice(`Added ${added.length} ${added.length === 1 ? "image" : "images"}.`);
    });

  const addFolder = (picked: readonly AmbientDirectoryImageFile[]) =>
    runUpload("folder", async (uploaded) => {
      let prepared: ReturnType<typeof prepareAmbientImageDirectory>;
      try {
        prepared = prepareAmbientImageDirectory(picked);
      } catch (cause) {
        // This local validator authors fixed messages and never includes file names or paths.
        throw new AmbientImageClientError(
          cause instanceof Error ? cause.message : "Image folder is invalid.",
        );
      }
      for (const file of prepared.files) {
        if (!mounted.current)
          throw new AmbientImageClientError("Ambient image selection was closed.");
        uploaded.push(await uploadAmbientImage(file));
      }
      const unique: AmbientImageAsset[] = [];
      for (const asset of uploaded) {
        if (!unique.some((entry) => entry.id === asset.id)) unique.push(asset);
      }
      // A folder selection replaces the rotation wholesale; that is the point of
      // picking a folder. The replaced entries are then pruned so repeatedly
      // switching folders cannot walk the profile up to its storage quota.
      const previous = library;
      const saved = await commitLibrary({
        ambientImageCycleAssets: unique,
        ambientImageCycleEnabled: unique.length > 1,
        ambientImageAsset: unique[0] ?? settings.ambientImageAsset,
      });
      const stranded = await pruneUnreferenced(previous, saved);
      const skipped =
        prepared.skippedUnsupported > 0
          ? `; skipped ${prepared.skippedUnsupported} unsupported files`
          : "";
      const kept = stranded > 0 ? `; ${stranded} replaced files could not be deleted yet` : "";
      setNotice(`Added ${unique.length} images${skipped}${kept}.`);
    });

  const remove = (asset: AmbientImageAsset) =>
    runUpload("remove", async () => {
      const remaining = library.filter((entry) => entry.id !== asset.id);
      const nextSelected =
        settings.ambientImageAsset?.id === asset.id
          ? (remaining[0] ?? null)
          : settings.ambientImageAsset;
      // Drop the reference first: the server refuses to delete bytes the settings
      // document still points at.
      const saved = await commitLibrary({
        ambientImageCycleAssets: remaining,
        ambientImageAsset: nextSelected,
        ...(remaining.length > 1 ? {} : { ambientImageCycleEnabled: false }),
      });
      const stranded = await pruneUnreferenced([asset], saved);
      // The library entry is gone either way, but a failed delete leaves bytes
      // occupying the profile quota. Say so instead of letting the removal look
      // completely clean.
      setNotice(
        stranded > 0
          ? "Removed from the library, but its file is still stored on the server."
          : "Removed 1 image.",
      );
    });

  return (
    <SettingsSection title="Ambient images">
      <SettingsRow
        title="Ambient image"
        description="Show one of your own images or GIFs as a faint layer over the app. Off by default; only images you add are shown, and no image is ever fetched from a third party."
        control={
          <Switch
            checked={settings.ambientImageEnabled}
            onCheckedChange={(checked) => updateSettings({ ambientImageEnabled: Boolean(checked) })}
            aria-label="Enable ambient image"
          />
        }
      />

      <SettingsRow
        title="Library"
        description={`Upload PNG, JPEG, GIF or WebP images (10 MiB each, ${MAX_AMBIENT_IMAGE_CYCLE_ASSETS} total). Choosing a folder replaces the rotation with the images it contains.`}
      >
        <div className="flex flex-col gap-3 pt-3 pb-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => fileInput.current?.click()}
            >
              {busy === "file" ? "Uploading…" : "Add images"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => folderInput.current?.click()}
            >
              {busy === "folder" ? "Uploading folder…" : "Choose folder…"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              data-testid="ambient-image-file-input"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) void addFiles(files);
              }}
            />
            <input
              ref={folderInput}
              type="file"
              accept={ACCEPT}
              hidden
              multiple
              data-testid="ambient-image-folder-input"
              // Directory selection stays an explicit per-use OS picker: the
              // browser hands back only the chosen files, and Cafe never keeps a
              // handle, watcher or path to that folder.
              {...{ webkitdirectory: "", directory: "" }}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []) as AmbientDirectoryImageFile[];
                event.target.value = "";
                if (files.length) void addFolder(files);
              }}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid="ambient-image-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="text-muted-foreground text-sm" data-testid="ambient-image-notice">
              {notice}
            </p>
          ) : null}

          {library.length === 0 ? (
            <p className="text-muted-foreground text-sm">No ambient images yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="ambient-image-grid">
              {library.map((asset) => {
                const selected = settings.ambientImageAsset?.id === asset.id;
                return (
                  <div key={asset.id} className="flex flex-col gap-1">
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={busy !== null}
                      aria-label={`Show ambient image ${asset.id}`}
                      className={`overflow-hidden rounded-md border ${selected ? "border-primary" : "border-border"}`}
                      onClick={() => updateSettings({ ambientImageAsset: asset })}
                    >
                      <img
                        src={resolveAmbientImageSrc(asset)}
                        alt=""
                        className="h-16 w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground text-xs hover:text-destructive"
                      disabled={busy !== null}
                      onClick={() => void remove(asset)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingsRow>

      <SettingsRow
        title="Cycle through the library"
        description="Rotate between the images above instead of showing a single one."
        control={
          <Switch
            checked={settings.ambientImageCycleEnabled}
            disabled={library.length < 2}
            onCheckedChange={(checked) =>
              updateSettings({ ambientImageCycleEnabled: Boolean(checked) })
            }
            aria-label="Enable ambient image cycling"
          />
        }
      />

      <SettingsRow
        title="Seconds per image"
        description={`Between ${MIN_AMBIENT_IMAGE_CYCLE_SECONDS} and ${MAX_AMBIENT_IMAGE_CYCLE_SECONDS} seconds.`}
        control={
          <input
            type="number"
            className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            min={MIN_AMBIENT_IMAGE_CYCLE_SECONDS}
            max={MAX_AMBIENT_IMAGE_CYCLE_SECONDS}
            value={settings.ambientImageCycleSeconds}
            aria-label="Seconds per ambient image"
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (
                Number.isFinite(next) &&
                next >= MIN_AMBIENT_IMAGE_CYCLE_SECONDS &&
                next <= MAX_AMBIENT_IMAGE_CYCLE_SECONDS
              ) {
                updateSettings({ ambientImageCycleSeconds: next });
              }
            }}
          />
        }
      />

      <SettingsRow
        title="Presentation"
        description="Floating keeps a small bordered panel in the corner; theater spreads a faint wash across the whole window. Both stay click-through."
        control={
          <select
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            value={settings.ambientImagePresentationMode}
            aria-label="Ambient image presentation"
            onChange={(event) =>
              updateSettings({
                ambientImagePresentationMode:
                  event.target.value === "theater" ? "theater" : "floating",
              })
            }
          >
            <option value="floating">Floating</option>
            <option value="theater">Theater</option>
          </select>
        }
      />

      <AmbientImagePanelSettingsRows />
    </SettingsSection>
  );
}
