import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretAtmosphereCommandWithLmStudio } from "./atmosphereLmStudio";

const modelList = () => Response.json({ data: [{ id: "synthetic-model" }] });
const completion = (commands: unknown[]) =>
  Response.json({ choices: [{ message: { content: JSON.stringify({ commands }) } }] });
const request = "make the atmosphere feel snowy";
const command = { kind: "set-effect", effect: "snow" };

afterEach(() => vi.useRealTimers());

describe("local LM Studio atmosphere interpretation", () => {
  it("uses only fixed loopback endpoints, no credentials, and the bounded request", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(modelList())
      .mockResolvedValueOnce(completion([command]));
    expect(
      await interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, {
        fetch,
      }),
    ).toEqual([command]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:1234/v1/chat/completions",
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
    const body = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string);
    expect(body).toMatchObject({
      model: "synthetic-model",
      max_tokens: 512,
      stream: false,
      response_format: { type: "json_object" },
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toEqual({ role: "user", content: request });
  });

  it("does not truncate oversized input into a different request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await interpretAtmosphereCommandWithLmStudio("x".repeat(501), new AbortController().signal, {
        fetch,
      }),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses mixed supported and unsupported output without partial success", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(modelList())
      .mockResolvedValueOnce(completion([command, { kind: "shell", command: "unused" }]));
    expect(
      await interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, {
        fetch,
      }),
    ).toEqual([]);
  });

  it.each(["declared", "streamed"])("caps %s response bytes", async (kind) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          "x".repeat(32_769),
          kind === "declared" ? { headers: { "content-length": "32769" } } : {},
        ),
      );
    await expect(
      interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, { fetch }),
    ).rejects.toThrow("too much data");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not expose a raw HTTP or transport error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("private synthetic diagnostic"));
    await expect(
      interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, { fetch }),
    ).rejects.toThrow("could not interpret");
    fetch.mockResolvedValueOnce(new Response("private synthetic diagnostic", { status: 500 }));
    await expect(
      interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, { fetch }),
    ).rejects.toThrow("refused the request");
  });

  it("refuses a redirected response even if an injected fetch ignored the redirect policy", async () => {
    const response = modelList();
    Object.defineProperty(response, "redirected", { value: true });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    await expect(
      interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, { fetch }),
    ).rejects.toThrow("refused the request");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("settles at the deadline even if fetch does not honor abort", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
    const result = interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, {
      fetch,
      timeoutMs: 10,
    }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toContain("did not finish in time");
    expect((fetch.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes body consumption in the same deadline and cancels the reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const result = interpretAtmosphereCommandWithLmStudio(request, new AbortController().signal, {
      fetch,
      timeoutMs: 10,
    }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toContain("did not finish in time");
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a late response body after caller cancellation", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const controller = new AbortController();
    const result = interpretAtmosphereCommandWithLmStudio(request, controller.signal, {
      fetch,
    }).catch((error: Error) => error.message);
    controller.abort();
    expect(await result).toContain("cancelled");
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
