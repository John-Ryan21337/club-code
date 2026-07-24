import { describe, expect, it, vi } from "vitest";

import {
  connectYouTubePlaylistIframe,
  connectYouTubeQueueIframe,
  decodeYouTubeCurrentVideoId,
  type YouTubeIframeCommandPlatform,
  type YouTubePlaylistConnection,
  YOUTUBE_PLAYLIST_IFRAME_ID,
} from "./youtubeIframeCommands";

function fixture(
  source = "https://www.youtube-nocookie.com/embed/videoseries?list=PL1234567890&enablejsapi=1",
) {
  const postMessage = vi.fn();
  const playerWindow = { postMessage } as unknown as Window;
  const element = {
    id: YOUTUBE_PLAYLIST_IFRAME_ID,
    src: source,
    contentWindow: playerWindow,
    isConnected: true,
  } as unknown as HTMLIFrameElement;
  let messageListener: ((event: MessageEvent) => void) | null = null;
  let intervalCallback: (() => void) | null = null;
  let timeoutCallback: (() => void) | null = null;
  const platform: YouTubeIframeCommandPlatform = {
    addMessageListener: (listener) => {
      messageListener = listener;
    },
    removeMessageListener: (listener) => {
      if (messageListener === listener) messageListener = null;
    },
    setInterval: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearInterval: () => {
      intervalCallback = null;
    },
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 2;
    },
    clearTimeout: () => {
      timeoutCallback = null;
    },
  };
  const emit = (origin: string, sourceWindow: Window, data: unknown) =>
    messageListener?.({ origin, source: sourceWindow, data } as MessageEvent);
  return {
    element,
    emit,
    platform,
    playerWindow,
    postMessage,
    runInterval: () => intervalCallback?.(),
    runTimeout: () => timeoutCallback?.(),
    hasListener: () => messageListener !== null,
  };
}

describe("connectYouTubePlaylistIframe", () => {
  it("waits for an exact-source, exact-origin provider acknowledgement", () => {
    const test = fixture();
    const connections: YouTubePlaylistConnection[] = [];
    const dispose = connectYouTubePlaylistIframe(
      test.element,
      (connection) => connections.push(connection),
      test.platform,
    );

    expect(connections).toEqual([{ status: "connecting", controller: null }]);
    expect(test.postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        event: "listening",
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );

    test.emit("https://example.com", test.playerWindow, JSON.stringify({ event: "onReady" }));
    test.emit(
      "https://www.youtube-nocookie.com",
      {} as Window,
      JSON.stringify({ event: "onReady" }),
    );
    expect(connections).toHaveLength(1);

    test.emit(
      "https://www.youtube-nocookie.com",
      test.playerWindow,
      JSON.stringify({ event: "onReady" }),
    );
    expect(connections.at(-1)?.status).toBe("ready");
    expect(connections.at(-1)?.controller).not.toBeNull();

    connections.at(-1)?.controller?.previous();
    connections.at(-1)?.controller?.next();
    connections.at(-1)?.controller?.play();
    connections.at(-1)?.controller?.pause();
    connections.at(-1)?.controller?.stop();
    expect(test.postMessage).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({
        event: "command",
        func: "previousVideo",
        args: [],
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );
    expect(test.postMessage).toHaveBeenNthCalledWith(
      3,
      JSON.stringify({
        event: "command",
        func: "nextVideo",
        args: [],
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );
    expect(test.postMessage).toHaveBeenNthCalledWith(
      4,
      JSON.stringify({
        event: "command",
        func: "playVideo",
        args: [],
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );
    expect(test.postMessage).toHaveBeenNthCalledWith(
      5,
      JSON.stringify({
        event: "command",
        func: "pauseVideo",
        args: [],
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );
    expect(test.postMessage).toHaveBeenNthCalledWith(
      6,
      JSON.stringify({
        event: "command",
        func: "stopVideo",
        args: [],
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );

    dispose();
    expect(test.hasListener()).toBe(false);
  });

  it("fails closed on timeout, provider error, invalid origin, or detachment", () => {
    const timed = fixture();
    const timedConnections: YouTubePlaylistConnection[] = [];
    connectYouTubePlaylistIframe(
      timed.element,
      (connection) => timedConnections.push(connection),
      timed.platform,
    );
    timed.runInterval();
    timed.runTimeout();
    expect(timedConnections.at(-1)).toEqual({ status: "unavailable", controller: null });

    const errored = fixture();
    const erroredConnections: YouTubePlaylistConnection[] = [];
    connectYouTubePlaylistIframe(
      errored.element,
      (connection) => erroredConnections.push(connection),
      errored.platform,
    );
    errored.emit(
      "https://www.youtube-nocookie.com",
      errored.playerWindow,
      JSON.stringify({ event: "onError", info: 101 }),
    );
    expect(erroredConnections.at(-1)).toEqual({ status: "unavailable", controller: null });

    const wrongOrigin = fixture("https://example.com/embed/videoseries");
    const invalidConnections: YouTubePlaylistConnection[] = [];
    connectYouTubePlaylistIframe(
      wrongOrigin.element,
      (connection) => invalidConnections.push(connection),
      wrongOrigin.platform,
    );
    expect(invalidConnections).toEqual([{ status: "unavailable", controller: null }]);
    expect(wrongOrigin.postMessage).not.toHaveBeenCalled();

    const wrongEmbedPath = fixture(
      "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ&enablejsapi=1",
    );
    const wrongEmbedConnections: YouTubePlaylistConnection[] = [];
    connectYouTubePlaylistIframe(
      wrongEmbedPath.element,
      (connection) => wrongEmbedConnections.push(connection),
      wrongEmbedPath.platform,
    );
    expect(wrongEmbedConnections).toEqual([{ status: "unavailable", controller: null }]);
    expect(wrongEmbedPath.postMessage).not.toHaveBeenCalled();

    const detached = fixture();
    Object.assign(detached.element, { isConnected: false });
    const detachedConnections: YouTubePlaylistConnection[] = [];
    connectYouTubePlaylistIframe(
      detached.element,
      (connection) => detachedConnections.push(connection),
      detached.platform,
    );
    detached.emit(
      "https://www.youtube-nocookie.com",
      detached.playerWindow,
      JSON.stringify({ event: "onReady" }),
    );
    detachedConnections.at(-1)?.controller?.next();
    expect(detached.postMessage).not.toHaveBeenCalled();
  });

  it("ignores malformed or oversized provider messages", () => {
    const test = fixture();
    const connections: YouTubePlaylistConnection[] = [];
    connectYouTubePlaylistIframe(
      test.element,
      (connection) => connections.push(connection),
      test.platform,
    );
    test.emit("https://www.youtube-nocookie.com", test.playerWindow, "{");
    test.emit(
      "https://www.youtube-nocookie.com",
      test.playerWindow,
      JSON.stringify({ event: "onReady", padding: "x".repeat(40_000) }),
    );
    expect(connections).toEqual([{ status: "connecting", controller: null }]);
  });

  it("delivers only strict current-video IDs from the authenticated frame", () => {
    expect(decodeYouTubeCurrentVideoId({ videoData: { video_id: "dQw4w9WgXcQ" } })).toBe(
      "dQw4w9WgXcQ",
    );
    expect(decodeYouTubeCurrentVideoId({ videoData: { video_id: "../not-safe" } })).toBeNull();

    const test = fixture();
    const videoIds: string[] = [];
    connectYouTubePlaylistIframe(
      test.element,
      () => undefined,
      test.platform,
      (videoId) => videoIds.push(videoId),
    );
    const delivery = JSON.stringify({
      event: "infoDelivery",
      info: { videoData: { video_id: "dQw4w9WgXcQ" } },
    });
    test.emit("https://example.com", test.playerWindow, delivery);
    test.emit("https://www.youtube-nocookie.com", {} as Window, delivery);
    test.emit("https://www.youtube-nocookie.com", test.playerWindow, delivery);
    test.emit("https://www.youtube-nocookie.com", test.playerWindow, delivery);
    test.emit(
      "https://www.youtube-nocookie.com",
      test.playerWindow,
      JSON.stringify({
        event: "infoDelivery",
        info: { videoData: { video_id: "9bZkp7q19f0" } },
      }),
    );
    expect(videoIds).toEqual(["dQw4w9WgXcQ", "9bZkp7q19f0"]);

    Object.assign(test.element, {
      src: "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ&enablejsapi=1",
    });
    test.emit(
      "https://www.youtube-nocookie.com",
      test.playerWindow,
      JSON.stringify({
        event: "infoDelivery",
        info: { videoData: { video_id: "kJQP7kiw5Fk" } },
      }),
    );
    expect(videoIds).toEqual(["dQw4w9WgXcQ", "9bZkp7q19f0"]);
  });

  it("observes exact-origin ended and unplayable events once for URL queues", () => {
    const ended = fixture("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    const playbackEvents: string[] = [];
    connectYouTubeQueueIframe(ended.element, (event) => playbackEvents.push(event), ended.platform);
    ended.emit(
      "https://www.youtube-nocookie.com",
      ended.playerWindow,
      JSON.stringify({ event: "onReady" }),
    );
    expect(ended.postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        event: "command",
        func: "addEventListener",
        args: ["onStateChange"],
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      "https://www.youtube-nocookie.com",
    );
    ended.emit(
      "https://example.com",
      ended.playerWindow,
      JSON.stringify({ event: "onStateChange", info: 0 }),
    );
    ended.emit(
      "https://www.youtube-nocookie.com",
      ended.playerWindow,
      JSON.stringify({ event: "onStateChange", info: 0 }),
    );
    ended.emit(
      "https://www.youtube-nocookie.com",
      ended.playerWindow,
      JSON.stringify({ event: "infoDelivery", info: { playerState: 0 } }),
    );
    expect(playbackEvents).toEqual(["ended"]);

    for (const errorCode of [2, 5, 100, 101, 150]) {
      const unavailable = fixture(
        "https://www.youtube-nocookie.com/embed/9bZkp7q19f0?enablejsapi=1",
      );
      connectYouTubeQueueIframe(
        unavailable.element,
        (event) => playbackEvents.push(`${event}:${errorCode}`),
        unavailable.platform,
      );
      unavailable.emit(
        "https://www.youtube-nocookie.com",
        unavailable.playerWindow,
        JSON.stringify({ event: "onError", info: errorCode }),
      );
      unavailable.emit(
        "https://www.youtube-nocookie.com",
        unavailable.playerWindow,
        JSON.stringify({ event: "onError", info: errorCode }),
      );
    }
    const unknownError = fixture(
      "https://www.youtube-nocookie.com/embed/9bZkp7q19f0?enablejsapi=1",
    );
    connectYouTubeQueueIframe(
      unknownError.element,
      (event) => playbackEvents.push(`${event}:unknown`),
      unknownError.platform,
    );
    unknownError.emit(
      "https://www.youtube-nocookie.com",
      unknownError.playerWindow,
      JSON.stringify({ event: "onError", info: 999 }),
    );
    expect(playbackEvents).toEqual([
      "ended",
      "unplayable:2",
      "unplayable:5",
      "unplayable:100",
      "unplayable:101",
      "unplayable:150",
    ]);
  });

  it("updates URL-queue artwork IDs only from the authenticated frame", () => {
    const test = fixture("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    const videoIds: string[] = [];
    connectYouTubeQueueIframe(
      test.element,
      () => undefined,
      test.platform,
      (videoId) => {
        videoIds.push(videoId);
      },
    );
    test.emit(
      "https://example.com",
      test.playerWindow,
      JSON.stringify({
        event: "infoDelivery",
        info: { videoData: { video_id: "9bZkp7q19f0" } },
      }),
    );
    test.emit(
      "https://www.youtube-nocookie.com",
      test.playerWindow,
      JSON.stringify({
        event: "infoDelivery",
        info: { videoData: { video_id: "9bZkp7q19f0" } },
      }),
    );
    expect(videoIds).toEqual(["9bZkp7q19f0"]);
  });
});
