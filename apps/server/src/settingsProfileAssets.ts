import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Unknown or unreadable profile libraries cannot prove that an image is unused. */
export function profileLibraryMayReferenceImage(raw: string | null, id: string): boolean {
  if (raw === null || raw.length > 2 * 1024 * 1024) return true;
  try {
    const document = JSON.parse(raw) as {
      version?: number;
      profiles?: Array<{
        clientSettings?: {
          ambientImageAsset?: { id?: string };
          ambientImageCycleAssets?: Array<{ id?: string }>;
        };
      }>;
    };
    if (![1, 2, 3, 4, 5].includes(document.version ?? 0) || !Array.isArray(document.profiles))
      return true;
    return document.profiles.some(
      (profile) =>
        profile.clientSettings?.ambientImageAsset?.id === id ||
        profile.clientSettings?.ambientImageCycleAssets?.some((asset) => asset.id === id),
    );
  } catch {
    return true;
  }
}

export const savedProfilesMayReferenceImage = Effect.fn(function* (stateDir: string, id: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(stateDir, "settings-profiles.json");
  const raw = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  if (profileLibraryMayReferenceImage(raw, id)) return true;
  const backup = `${file}.previous`;
  if (!(yield* fs.exists(backup))) return false;
  const prior = yield* fs.readFileString(backup).pipe(Effect.orElseSucceed(() => null));
  return profileLibraryMayReferenceImage(prior, id);
});
