import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeAmbientImage, resolveAmbientImageSrc, uploadAmbientImage } from "./ambientImages";

vi.mock("./environments/primary/target", () => ({
  resolvePrimaryEnvironmentHttpUrl: (pathname: string) => `https://cafe.test${pathname}`,
}));

const asset = {
  id: `sha256-${"a".repeat(64)}.png`,
  url: `/api/ambient-media/image/sha256-${"a".repeat(64)}.png`,
  mimeType: "image/png" as const,
  width: 640,
  height: 360,
  sizeBytes: 1024,
};

describe("ambient image HTTP client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves only the authenticated asset URL from validated metadata", () => {
    expect(resolveAmbientImageSrc(asset)).toBe(`https://cafe.test${asset.url}`);
  });

  it("uploads image bytes without adding a local path to the request URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ambientImage: asset }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const file = new File(["png"], "private-workspace-image.png", { type: "image/png" });

    await expect(uploadAmbientImage(file)).resolves.toEqual(asset);
    expect(fetchMock).toHaveBeenCalledWith("https://cafe.test/api/ambient-media/image", {
      method: "POST",
      body: file,
      credentials: "include",
      headers: { "content-type": "image/png" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain(file.name);
  });

  it("rejects malformed upload metadata before it reaches settings", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ambientImage: {
            ...asset,
            url: "/api/ambient-media/image/not-the-returned-id.png",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(
      uploadAmbientImage(new File(["png"], "image.png", { type: "image/png" })),
    ).rejects.toThrow("Ambient image upload returned an invalid response.");
  });

  it("surfaces bounded server errors and removes only validated asset identifiers", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Profile quota is full.", { status: 413 }));
    await expect(
      uploadAmbientImage(new File(["png"], "image.png", { type: "image/png" })),
    ).rejects.toThrow("Profile quota is full.");

    await expect(removeAmbientImage("not-an-id" as typeof asset.id)).rejects.toThrow(
      "Ambient image identifier is invalid.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(removeAmbientImage(asset.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(`https://cafe.test${asset.url}`, {
      method: "DELETE",
      credentials: "include",
    });
  });
});
