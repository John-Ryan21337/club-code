import {
  MAX_AMBIENT_IMAGE_DIMENSION,
  MAX_AMBIENT_IMAGE_FILE_BYTES,
  MAX_AMBIENT_IMAGE_PIXEL_COUNT,
  type AmbientImageAsset,
} from "@cafecode/contracts/settings";

import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

const ASSET_ID = /^sha256-[a-f0-9]{64}\.(?:gif|jpe?g|png|webp)$/;

function isAmbientImageAsset(value: unknown): value is AmbientImageAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<AmbientImageAsset>;
  return (
    typeof asset.id === "string" &&
    ASSET_ID.test(asset.id) &&
    asset.url === `/api/ambient-media/image/${asset.id}` &&
    (asset.mimeType === "image/gif" ||
      asset.mimeType === "image/jpeg" ||
      asset.mimeType === "image/png" ||
      asset.mimeType === "image/webp") &&
    Number.isInteger(asset.width) &&
    (asset.width ?? 0) > 0 &&
    (asset.width ?? 0) <= MAX_AMBIENT_IMAGE_DIMENSION &&
    Number.isInteger(asset.height) &&
    (asset.height ?? 0) > 0 &&
    (asset.height ?? 0) <= MAX_AMBIENT_IMAGE_DIMENSION &&
    (asset.width ?? 0) * (asset.height ?? 0) <= MAX_AMBIENT_IMAGE_PIXEL_COUNT &&
    Number.isInteger(asset.sizeBytes) &&
    (asset.sizeBytes ?? 0) > 0 &&
    (asset.sizeBytes ?? 0) <= MAX_AMBIENT_IMAGE_FILE_BYTES
  );
}

export function resolveAmbientImageSrc(asset: AmbientImageAsset): string {
  try {
    return resolvePrimaryEnvironmentHttpUrl(asset.url);
  } catch {
    return asset.url;
  }
}

export async function uploadAmbientImage(file: File): Promise<AmbientImageAsset> {
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/ambient-media/image"), {
    method: "POST",
    body: file,
    credentials: "include",
    ...(file.type ? { headers: { "content-type": file.type } } : {}),
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Ambient image upload failed (${response.status}).`);
  }
  const payload = (await response.json()) as { readonly ambientImage?: unknown };
  if (!isAmbientImageAsset(payload.ambientImage)) {
    throw new Error("Ambient image upload returned an invalid response.");
  }
  return payload.ambientImage;
}

export async function removeAmbientImage(id: AmbientImageAsset["id"]): Promise<void> {
  if (!ASSET_ID.test(id)) throw new Error("Ambient image identifier is invalid.");
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl(`/api/ambient-media/image/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Ambient image removal failed (${response.status}).`);
  }
}
