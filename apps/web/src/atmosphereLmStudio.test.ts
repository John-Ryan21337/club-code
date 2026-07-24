import { describe, expect, it, vi } from "vitest";

import {
  ATMOSPHERE_LM_STUDIO_ORIGIN,
  AtmosphereLmStudioError,
  interpretAtmosphereCommandWithLmStudio,
} from "./atmosphereLmStudio";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("interpretAtmosphereCommandWithLmStudio", () => {
  it("uses only the fixed loopback endpoint and sends no application context", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "local-model" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  commands: [{ kind: "set-effect", effect: "rain" }],
                }),
              },
            },
          ],
        }),
      );

    await expect(
      interpretAtmosphereCommandWithLmStudio("make it look stormy", {
        fetch,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual([{ kind: "set-effect", effect: "rain" }]);

    expect(fetch.mock.calls[0]?.[0]).toBe(`${ATMOSPHERE_LM_STUDIO_ORIGIN}/v1/models`);
    expect(fetch.mock.calls[1]?.[0]).toBe(`${ATMOSPHERE_LM_STUDIO_ORIGIN}/v1/chat/completions`);
    const request = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)) as {
      messages: readonly { role: string; content: string }[];
    };
    expect(request.messages.at(-1)).toEqual({
      role: "user",
      content: "make it look stormy",
    });
    expect(JSON.stringify(request)).not.toContain("project");
    expect(JSON.stringify(request)).not.toContain("thread");
  });

  it("fails closed on malformed or unsupported proposals", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "local-model" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  commands: [{ kind: "run-shell", command: "whoami" }],
                }),
              },
            },
          ],
        }),
      );
    await expect(
      interpretAtmosphereCommandWithLmStudio("do something strange", {
        fetch,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual([]);
  });

  it("reports unavailable local models without falling through to a paid provider", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [],
      }),
    );
    await expect(
      interpretAtmosphereCommandWithLmStudio("make it cozy", {
        fetch,
        timeoutMs: 1_000,
      }),
    ).rejects.toEqual(new AtmosphereLmStudioError("Load a model in LM Studio first."));
    expect(fetch).toHaveBeenCalledOnce();
  });
});
