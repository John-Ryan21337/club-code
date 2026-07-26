import {
  MAX_AMBIENT_IMAGE_CYCLE_ASSETS,
  MAX_AMBIENT_IMAGE_FILE_BYTES,
} from "@cafecode/contracts/settings";

const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const ACCEPTED_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"]);
/** Keep a directory selection bounded even when every individual file is valid. */
export const MAX_AMBIENT_IMAGE_CYCLE_TOTAL_BYTES = 80 * 1024 * 1024;
export const MAX_AMBIENT_IMAGE_DIRECTORY_ENTRIES = 128;

export type AmbientDirectoryImageFile = File & { readonly webkitRelativePath: string };

export interface PreparedAmbientImageDirectory {
  readonly files: readonly AmbientDirectoryImageFile[];
  readonly skippedUnsupported: number;
}

function extensionOf(file: AmbientDirectoryImageFile): string | null {
  const name = file.name.trim();
  const extension = name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1) : "";
  return extension ? extension.toLowerCase() : null;
}

export function isSupportedAmbientImageFile(file: AmbientDirectoryImageFile): boolean {
  const mimeType = file.type.toLowerCase();
  return (
    ACCEPTED_MIME_TYPES.has(mimeType) ||
    (mimeType.length === 0 && ACCEPTED_EXTENSIONS.has(extensionOf(file) ?? ""))
  );
}

/**
 * Sort before upload so a selected directory is reproducible. `webkitRelativePath`
 * is used only for renderer-local ordering; callers must not persist, log, or
 * upload it. The upload request body contains only each selected file's bytes.
 */
function stableDirectoryOrder(
  left: AmbientDirectoryImageFile,
  right: AmbientDirectoryImageFile,
): number {
  const leftPath = (left.webkitRelativePath || left.name).normalize("NFC");
  const rightPath = (right.webkitRelativePath || right.name).normalize("NFC");
  const leftFolded = leftPath.toLowerCase();
  const rightFolded = rightPath.toLowerCase();
  if (leftFolded !== rightFolded) return leftFolded < rightFolded ? -1 : 1;
  return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
}

export function prepareAmbientImageDirectory(
  picked: Iterable<AmbientDirectoryImageFile>,
): PreparedAmbientImageDirectory {
  const candidates = Array.from(picked);
  if (candidates.length > MAX_AMBIENT_IMAGE_DIRECTORY_ENTRIES) {
    throw new Error(
      `Choose a folder with at most ${MAX_AMBIENT_IMAGE_DIRECTORY_ENTRIES} entries to scan.`,
    );
  }
  const supported = candidates.filter(isSupportedAmbientImageFile).toSorted(stableDirectoryOrder);
  if (supported.length === 0) {
    throw new Error("That folder contains no supported PNG, JPEG, GIF, or WebP images.");
  }
  if (supported.length > MAX_AMBIENT_IMAGE_CYCLE_ASSETS) {
    throw new Error(
      `Choose a folder with at most ${MAX_AMBIENT_IMAGE_CYCLE_ASSETS} supported image files.`,
    );
  }
  if (supported.some((file) => file.size <= 0 || file.size > MAX_AMBIENT_IMAGE_FILE_BYTES)) {
    throw new Error("Each cycling image must be larger than zero and no more than 10 MiB.");
  }
  const totalBytes = supported.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_AMBIENT_IMAGE_CYCLE_TOTAL_BYTES) {
    throw new Error(
      "The selected image folder is too large; keep supported images under 80 MiB total.",
    );
  }
  return { files: supported, skippedUnsupported: candidates.length - supported.length };
}
