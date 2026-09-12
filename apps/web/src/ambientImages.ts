import { AmbientImageAsset, MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";
import * as Schema from "effect/Schema";

import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

const ASSET_ID = /^sha256-[a-f0-9]{64}\.(?:gif|jpe?g|png|webp)$/;

/** Only locally authored messages from this error type may reach settings UI. */
export class AmbientImageClientError extends Error {}

export const ambientImageErrorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof AmbientImageClientError ? cause.message : fallback;

const isAmbientImageAsset = Schema.is(AmbientImageAsset);
const MAX_RESPONSE_BYTES = 16 * 1024;

async function requestAmbientImage(path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const deadline = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl(path), {
      ...init,
      credentials: "include",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      // Do not display an arbitrary response body, including a proxy error page.
      void response.body?.cancel().catch(() => undefined);
      const message =
        response.status === 413
          ? "Ambient image or stored library exceeds the server limit."
          : response.status === 409
            ? "Ambient image is still in use."
            : response.status === 401 || response.status === 403
              ? "Owner access is required to change ambient images."
              : response.status === 429
                ? "Ambient image uploads are busy. Try again shortly."
                : "Ambient image request failed. Try again.";
      throw new AmbientImageClientError(message);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AmbientImageClientError("Ambient image response is invalid.");
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          throw new AmbientImageClientError("Ambient image response is too large.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch (cause) {
    if (cause instanceof AmbientImageClientError) throw cause;
    throw new AmbientImageClientError(
      controller.signal.aborted
        ? "Ambient image request timed out. Try again."
        : "Ambient image request failed. Try again.",
    );
  } finally {
    window.clearTimeout(deadline);
  }
}

export function resolveAmbientImageSrc(asset: AmbientImageAsset): string {
  try {
    return resolvePrimaryEnvironmentHttpUrl(asset.url);
  } catch {
    return asset.url;
  }
}

export async function uploadAmbientImage(file: File): Promise<AmbientImageAsset> {
  if (file.size <= 0 || file.size > MAX_AMBIENT_IMAGE_FILE_BYTES) {
    throw new AmbientImageClientError(
      "Each image must be larger than zero and no more than 10 MiB.",
    );
  }
  const payload = await requestAmbientImage("/api/ambient-media/image", {
    method: "POST",
    body: file,
    ...(file.type ? { headers: { "content-type": file.type } } : {}),
  });
  if (
    !payload ||
    typeof payload !== "object" ||
    !("ambientImage" in payload) ||
    !isAmbientImageAsset(payload.ambientImage)
  ) {
    throw new AmbientImageClientError("Ambient image upload returned an invalid response.");
  }
  return payload.ambientImage;
}

export async function removeAmbientImage(id: AmbientImageAsset["id"]): Promise<void> {
  if (!ASSET_ID.test(id)) throw new AmbientImageClientError("Ambient image identifier is invalid.");
  await requestAmbientImage(`/api/ambient-media/image/${id}`, {
    method: "DELETE",
  });
}
