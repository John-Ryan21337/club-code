import { expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { AuthSessionId } from "@cafecode/contracts";
import { researchRoutes } from "./http.ts";
import { AuthError, ServerAuth, type ServerAuthShape } from "../auth/Services/ServerAuth.ts";
import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";

function fixture(role: "owner" | "client" | "none") {
  const values = new Map<string, Uint8Array>();
  const set = vi.fn((name: string, value: Uint8Array) =>
    Effect.sync(() => {
      values.set(name, value);
    }),
  );
  const auth = {
    authenticateHttpRequest: () =>
      role === "none"
        ? Effect.fail(new AuthError({ message: "Sign in first.", status: 401 }))
        : Effect.succeed({
            role,
            sessionId: AuthSessionId.make("test-session"),
            subject: "test-owner",
            method: "browser-session-cookie" as const,
          }),
  } as unknown as ServerAuthShape;
  const routes = researchRoutes.pipe(
    Layer.provideMerge(Layer.succeed(ServerAuth, auth)),
    Layer.provide(
      Layer.succeed(ServerSecretStore, {
        get: (name) => Effect.succeed(values.get(name) ?? null),
        set,
        remove: (name) =>
          Effect.sync(() => {
            values.delete(name);
          }),
        getOrCreateRandom: () => Effect.die("unused"),
      }),
    ),
  );
  return { ...HttpRouter.toWebHandler(routes, { disableLogger: true }), set };
}
const key = "sk-fixture-only-not-a-real-secret";
function request(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/research", {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  });
}

it.each(["none", "client"] as const)(
  "blocks %s access before reading or writing the API key",
  async (role) => {
    const app = fixture(role);
    try {
      const response = await app.handler(request({ action: "configure", key }));
      expect(response.status).toBe(role === "none" ? 401 : 403);
      expect(app.set).not.toHaveBeenCalled();
    } finally {
      await app.dispose();
    }
  },
);

it("lets an owner save a key and returns only its presence", async () => {
  const app = fixture("owner");
  try {
    const response = await app.handler(request({ action: "configure", key }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ configured: true, jobs: [] });
    expect(app.set).toHaveBeenCalledTimes(1);
  } finally {
    await app.dispose();
  }
});

it("rejects cross-origin form content types and invalid paid requests", async () => {
  const app = fixture("owner");
  try {
    expect((await app.handler(request({ action: "configure", key }, "text/plain"))).status).toBe(
      415,
    );
    expect(
      (
        await app.handler(
          request({ action: "start", id: "../private", model: "unknown", maxToolCalls: 999 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.handler(
          request({
            action: "prepare",
            id: "e1f83530-2d40-4bca-a315-74a94ab0b2ec",
            scope: "thread",
            prompt: "x".repeat(200000),
          }),
        )
      ).status,
    ).toBe(400);
    expect(app.set).not.toHaveBeenCalled();
  } finally {
    await app.dispose();
  }
});
