import { AuthSessionId } from "@cafecode/contracts/auth";
import * as Effect from "effect/Effect";
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

  it("refreshes only in memory and best-effort revokes on disconnect", async () => {
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
              ? { access_token: "refreshed-access", expires_in: 3600, scope: READONLY_SCOPE }
              : {
                  access_token: "initial-access",
                  refresh_token: "memory-only-refresh",
                  expires_in: 60,
                  scope: READONLY_SCOPE,
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
    expect(revoked).toEqual(["memory-only-refresh"]);
    expect(await Effect.runPromise(connection.status(SESSION))).toEqual({
      status: "disconnected",
    });
  });

  it("serializes refresh and disconnect so a completed refresh cannot resurrect a grant", async () => {
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

    const listing = Effect.runPromise(connection.listOwnedPlaylists(SESSION));
    await refreshStarted;
    const disconnecting = Effect.runPromise(connection.disconnect(SESSION));
    resolveRefresh(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access",
          expires_in: 3_600,
          scope: READONLY_SCOPE,
        }),
        { status: 200 },
      ),
    );
    await listing;
    await disconnecting;

    expect(revoked).toEqual(["refresh-token"]);
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
