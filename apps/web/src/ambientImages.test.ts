import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAmbientImage } from "./ambientImages";

vi.mock("./environments/primary/target", () => ({
  resolvePrimaryEnvironmentHttpUrl: (path: string) => `https://cafe.test${path}`,
}));

const id = `sha256-${"a".repeat(64)}.png`;
const asset = {
  id,
  url: `/api/ambient-media/image/${id}`,
  mimeType: "image/png",
  width: 1,
  height: 1,
  sizeBytes: 4,
};
const file = () =>
  new File([new Uint8Array([1, 2, 3, 4])], "private-name.png", { type: "image/png" });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ambient image HTTP boundary", () => {
  it("accepts a schema-bound response and prohibits redirects", async () => {
    vi.stubGlobal("window", globalThis);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ambientImage: asset }));
    vi.stubGlobal("fetch", fetch);
    await expect(uploadAmbientImage(file())).resolves.toEqual(asset);
    expect(fetch).toHaveBeenCalledWith(
      "https://cafe.test/api/ambient-media/image",
      expect.objectContaining({
        redirect: "error",
        credentials: "include",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects a MIME and content-id mismatch", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ ambientImage: { ...asset, mimeType: "image/gif" } })),
    );
    await expect(uploadAmbientImage(file())).rejects.toThrow("invalid response");
  });

  it("does not read or display a failed response body", async () => {
    vi.stubGlobal("window", globalThis);
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("SECRET_PROXY_TRACE"));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 500 })));
    await expect(uploadAmbientImage(file())).rejects.toThrow(
      "Ambient image request failed. Try again.",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels an oversized response before parsing it", async () => {
    vi.stubGlobal("window", globalThis);
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(uploadAmbientImage(file())).rejects.toThrow("response is too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps the deadline active until a stalled response body ends", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal!;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                signal!.addEventListener(
                  "abort",
                  () => controller.error(new Error("SECRET_TRANSPORT_ERROR")),
                  { once: true },
                );
              },
            }),
          ),
        );
      }),
    );
    const result = uploadAmbientImage(file());
    const assertion = expect(result).rejects.toThrow("Ambient image request timed out. Try again.");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an oversized selected file before sending bytes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const selected = file();
    Object.defineProperty(selected, "size", { value: 10 * 1024 * 1024 + 1 });
    await expect(uploadAmbientImage(selected)).rejects.toThrow("no more than 10 MiB");
    expect(fetch).not.toHaveBeenCalled();
  });
});
