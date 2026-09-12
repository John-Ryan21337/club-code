import { AuthSessionId } from "@cafecode/contracts/auth";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import { describe, expect, it, vi } from "vitest";

import {
  decodeYouTubeOwnedPlaylists,
  makeYouTubeAccountConnection,
} from "./YouTubeAccountConnection.ts";

const CLIENT_ID = "1234567890-cafecodeclient.apps.googleusercontent.com";
const REDIRECT_URI = "http://127.0.0.1:3773";
const READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const SESSION = AuthSessionId.make("session-owner-a");

function deterministicRandom() {
  let next = 1;
  return (size: number) => new Uint8Array(size).fill(next++);
}

describe("YouTube account connection", () => {
  it("opens a system-browser PKCE request and exposes only a pending status", async () => {
    let launched: string | undefined;
    const connection = makeYouTubeAccountConnection({
      enabled: true,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      randomBytes: deterministicRandom(),
      launchBrowser: (target) =>
        Effect.sync(() => {
          launched = target;
        }),
    });

    await expect(Effect.runPromise(connection.start(SESSION))).resolves.toEqual({
      status: "pending",
    });
    expect(await Effect.runPromise(connection.status(SESSION))).toEqual({ status: "pending" });

    const authorizationUrl = new URL(launched!);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.pathname).toBe("/o/oauth2/v2/auth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(authorizationUrl.searchParams.get("scope")).toBe(READONLY_SCOPE);
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("binds a one-use callback to the owner session and returns bounded playlist fields", async () => {
    let launched: string | undefined;
    const upstreamCalls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      upstreamCalls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: READONLY_SCOPE,
            token_type: "Bearer",
            id_token: "must-not-be-retained",
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/playlists?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "PL1234567890",
                snippet: {
                  title: "Owner playlist",
                  description: "must not pass through",
                  thumbnails: { default: { url: "https://example.invalid/private.jpg" } },
                },
                contentDetails: { itemCount: 12 },
              },
            ],
            nextPageToken: "must-not-pass-through",
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 200 });
    });
    const connection = makeYouTubeAccountConnection({
      enabled: true,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      fetch,
      randomBytes: deterministicRandom(),
      launchBrowser: (target) =>
        Effect.sync(() => {
          launched = target;
        }),
    });

    await Effect.runPromise(connection.start(SESSION));
    const state = new URL(launched!).searchParams.get("state")!;
    await Effect.runPromise(connection.complete({ state, code: "authorization-code" }));
    expect(await Effect.runPromise(connection.status(SESSION))).toEqual({ status: "connected" });
    await expect(
      Effect.runPromise(connection.complete({ state, code: "replay" })),
    ).rejects.toMatchObject({
      code: "invalid-callback",
      status: 400,
    });

    await expect(Effect.runPromise(connection.listOwnedPlaylists(SESSION))).resolves.toEqual([
      { id: "PL1234567890", title: "Owner playlist", itemCount: 12 },
    ]);
    const tokenCall = upstreamCalls.find((call) => call.url.includes("/token"));
    expect(tokenCall?.init.redirect).toBe("error");
    const tokenBody = new URLSearchParams(String(tokenCall?.init.body));
    expect(tokenBody.get("code")).toBe("authorization-code");
    expect(tokenBody.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(tokenBody.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(tokenBody.get("client_secret")).toBeNull();

    const playlistCall = upstreamCalls.find((call) => call.url.includes("/youtube/v3/playlists"));
    const playlistUrl = new URL(playlistCall!.url);
    expect(playlistUrl.searchParams.get("mine")).toBe("true");
    expect(playlistUrl.searchParams.get("maxResults")).toBe("50");
    expect(playlistCall?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
  });

  it("refreshes only in memory and disconnects locally without project-wide revocation", async () => {
    let launched: string | undefined;
    let timestamp = 1_000;
    const tokenBodies: URLSearchParams[] = [];
    const revoked: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init.body));
        tokenBodies.push(body);
        return new Response(
          JSON.stringify(
            body.get("grant_type") === "refresh_token"
              ? {
                  access_token: "refreshed-access",
                  expires_in: 3600,
                  scope: READONLY_SCOPE,
                  token_type: "Bearer",
                }
              : {
                  access_token: "initial-access",
                  refresh_token: "memory-only-refresh",
                  expires_in: 60,
                  scope: READONLY_SCOPE,
                  token_type: "Bearer",
                },
          ),
          { status: 200 },
        );
      }
      if (url === "https://oauth2.googleapis.com/revoke") {
        revoked.push(new URLSearchParams(String(init.body)).get("token") ?? "");
        return new Response("", { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const connection = makeYouTubeAccountConnection({
      enabled: true,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      fetch,
      now: () => timestamp,
      randomBytes: deterministicRandom(),
      launchBrowser: (target) =>
        Effect.sync(() => {
          launched = target;
        }),
    });

    await Effect.runPromise(connection.start(SESSION));
    await Effect.runPromise(
      connection.complete({
        state: new URL(launched!).searchParams.get("state")!,
        code: "authorization-code",
      }),
    );
    timestamp += 1_000;
    await Effect.runPromise(connection.listOwnedPlaylists(SESSION));
    expect(tokenBodies.map((body) => body.get("grant_type"))).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(tokenBodies[1]?.get("refresh_token")).toBe("memory-only-refresh");

    await Effect.runPromise(connection.disconnect(SESSION));
    expect(revoked).toEqual([]);
    expect(await Effect.runPromise(connection.status(SESSION))).toEqual({
      status: "disconnected",
    });
  });

  it("disconnects immediately and rejects a late refresh without resurrecting a grant", async () => {
    let launched: string | undefined;
    let resolveRefresh!: (response: Response) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const revoked: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init.body));
        if (body.get("grant_type") === "refresh_token") {
          markRefreshStarted();
          return refreshResponse;
        }
        return new Response(
          JSON.stringify({
            access_token: "initial-access",
            refresh_token: "refresh-token",
            expires_in: 60,
            scope: READONLY_SCOPE,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }
      if (url === "https://oauth2.googleapis.com/revoke") {
        revoked.push(new URLSearchParams(String(init.body)).get("token") ?? "");
        return new Response("", { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const connection = makeYouTubeAccountConnection({
      enabled: true,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      fetch,
      now: () => 1_000,
      randomBytes: deterministicRandom(),
      launchBrowser: (target) =>
        Effect.sync(() => {
          launched = target;
        }),
    });

    await Effect.runPromise(connection.start(SESSION));
    await Effect.runPromise(
      connection.complete({
        state: new URL(launched!).searchParams.get("state")!,
        code: "authorization-code",
      }),
    );

    const listing = Effect.runPromise(connection.listOwnedPlaylists(SESSION)).then(
      () => "unexpected-success",
      () => "rejected",
    );
    await refreshStarted;
    await Effect.runPromise(connection.disconnect(SESSION));
    resolveRefresh(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access",
          expires_in: 3_600,
          scope: READONLY_SCOPE,
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    expect(await listing).toBe("rejected");

    expect(revoked).toEqual([]);
    expect(await Effect.runPromise(connection.status(SESSION))).toEqual({
      status: "disconnected",
    });
  });

  it("decodes only safe playlist selection data", () => {
    expect(
      decodeYouTubeOwnedPlaylists({
        items: [
          {
            id: "PL1234567890",
            snippet: { title: "Safe" },
            contentDetails: { itemCount: 3 },
          },
          {
            id: "unsafe id",
            snippet: { title: "Skip" },
            contentDetails: { itemCount: 1 },
          },
          {
            id: "PLabcdefghijk",
            snippet: { title: "bad\u0000title" },
            contentDetails: { itemCount: 1 },
          },
        ],
      }),
    ).toEqual([{ id: "PL1234567890", title: "Safe", itemCount: 3 }]);
  });
});

function accountFixture(options: Partial<Parameters<typeof makeYouTubeAccountConnection>[0]> = {}) {
  let launched = "";
  const fetch = vi.fn(async () =>
    Response.json({
      access_token: "private-access",
      refresh_token: "private-refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: READONLY_SCOPE,
    }),
  );
  const service = makeYouTubeAccountConnection({
    enabled: true,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    randomBytes: deterministicRandom(),
    fetch,
    launchBrowser: (url) =>
      Effect.sync(() => {
        launched = url;
      }),
    ...options,
  });
  return { service, fetch, state: () => new URL(launched).searchParams.get("state")! };
}

describe("YouTube account lifecycle boundaries", () => {
  it("does not trace launcher failures that can contain the private authorization URL", async () => {
    const spans: string[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        spans.push(options.name);
        return new Tracer.NativeSpan(options);
      },
    });
    const fixture = accountFixture({
      launchBrowser: (url) =>
        Effect.fail(new Error(url)).pipe(Effect.withSpan("synthetic-private-browser-launch")),
    });
    await expect(
      Effect.runPromise(fixture.service.start(SESSION).pipe(Effect.withTracer(tracer))),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(spans).not.toContain("synthetic-private-browser-launch");
    expect(await Effect.runPromise(fixture.service.status(SESSION))).toEqual({
      status: "disconnected",
    });
  });
  it.each([NaN, Infinity, -Infinity, 999])(
    "does not launch for an invalid owner expiry: %s",
    async (expiresAt) => {
      const launchBrowser = vi.fn(() => Effect.void);
      const fixture = accountFixture({ now: () => 1000, launchBrowser });
      await expect(
        Effect.runPromise(fixture.service.start(SESSION, expiresAt)),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(launchBrowser).not.toHaveBeenCalled();
      expect(fixture.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { enabled: false },
    { clientId: undefined },
    { clientId: "not-a-desktop-id" },
    { redirectUri: "http://localhost:3773" },
    { redirectUri: "http://127.0.0.1:3773/callback" },
    { redirectUri: "http://127.0.0.1:3773?state=override" },
  ])("keeps invalid or disabled configuration closed: %j", async (configuration) => {
    const launchBrowser = vi.fn(() => Effect.void);
    const fixture = accountFixture({ ...configuration, launchBrowser });
    await expect(Effect.runPromise(fixture.service.start(SESSION))).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(launchBrowser).not.toHaveBeenCalled();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("expires pending callbacks and limits repeated browser launches", async () => {
    let now = 1000;
    const fixture = accountFixture({ now: () => now });
    await Effect.runPromise(fixture.service.start(SESSION));
    const state = fixture.state();
    now += 600001;
    await expect(
      Effect.runPromise(fixture.service.complete({ state, code: "expired" })),
    ).rejects.toMatchObject({ code: "invalid-callback" });
    for (let i = 0; i < 4; i++) await Effect.runPromise(fixture.service.start(SESSION));
    await expect(Effect.runPromise(fixture.service.start(SESSION))).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "shutdown", "revoked-owner"] as const)(
    "does not retain a late token after %s",
    async (action) => {
      let active = true;
      let resolve!: (value: Response) => void;
      let signal: AbortSignal | undefined;
      const request = new Promise<Response>((done) => {
        resolve = done;
      });
      const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal!;
        return request;
      });
      const fixture = accountFixture({
        fetch,
        isOwnerSessionActive: () => Effect.sync(() => active),
      });
      await Effect.runPromise(fixture.service.start(SESSION));
      const result = Effect.runPromise(
        fixture.service.complete({ state: fixture.state(), code: "private-code" }),
      ).then(
        () => "unexpected",
        () => "rejected",
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      if (action === "disconnect") await Effect.runPromise(fixture.service.disconnect(SESSION));
      else if (action === "shutdown") await Effect.runPromise(fixture.service.shutdown());
      else active = false;
      if (action !== "revoked-owner") expect(signal?.aborted).toBe(true);
      resolve(
        Response.json({
          access_token: "private-access",
          refresh_token: "private-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: READONLY_SCOPE,
        }),
      );
      expect(await result).toBe("rejected");
      if (action !== "shutdown")
        expect(await Effect.runPromise(fixture.service.status(SESSION))).toEqual({
          status: "disconnected",
        });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each(["type", "scope", "declared-size", "streamed-size", "redirect", "malformed"])(
    "rejects %s token responses without retaining a session",
    async (kind) => {
      const fetch = vi.fn(async () => {
        if (kind === "declared-size")
          return new Response("{}", { headers: { "content-length": "16385" } });
        if (kind === "streamed-size") return new Response("x".repeat(16385));
        if (kind === "malformed") return new Response("private-invalid-json");
        const response = Response.json({
          access_token: "private-access",
          refresh_token: "private-refresh",
          token_type: kind === "type" ? "Other" : "Bearer",
          expires_in: 3600,
          scope: kind === "scope" ? "other" : READONLY_SCOPE,
        });
        if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true });
        return response;
      });
      const fixture = accountFixture({ fetch });
      await Effect.runPromise(fixture.service.start(SESSION));
      await expect(
        Effect.runPromise(
          fixture.service.complete({ state: fixture.state(), code: "private-code" }),
        ),
      ).rejects.toMatchObject({ code: "upstream-unavailable" });
      expect(await Effect.runPromise(fixture.service.status(SESSION))).toEqual({
        status: "disconnected",
      });
    },
  );

  it("bounds an uncooperative fetch and keeps its actual slot until late settlement", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const fixture = accountFixture({ fetch });
    try {
      await Effect.runPromise(fixture.service.start(SESSION));
      const first = Effect.runPromise(
        fixture.service.complete({ state: fixture.state(), code: "first" }),
      ).then(
        () => "unexpected",
        () => "rejected",
      );
      await vi.advanceTimersByTimeAsync(10001);
      expect(await first).toBe("rejected");
      await Effect.runPromise(fixture.service.start(SESSION));
      await expect(
        Effect.runPromise(fixture.service.complete({ state: fixture.state(), code: "second" })),
      ).rejects.toMatchObject({ code: "upstream-unavailable" });
      expect(fetch).toHaveBeenCalledOnce();
      const cancel = vi.fn();
      resolve(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(1);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      await Effect.runPromise(fixture.service.shutdown());
      vi.useRealTimers();
    }
  });

  it("cancels a stalled response body at the total upstream deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fixture = accountFixture({
      fetch: async () => new Response(new ReadableStream({ cancel })),
    });
    try {
      await Effect.runPromise(fixture.service.start(SESSION));
      const result = Effect.runPromise(
        fixture.service.complete({ state: fixture.state(), code: "private-code" }),
      ).then(
        () => "unexpected",
        () => "rejected",
      );
      await vi.advanceTimersByTimeAsync(10001);
      expect(await result).toBe("rejected");
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      await Effect.runPromise(fixture.service.shutdown());
      vi.useRealTimers();
    }
  });
});
