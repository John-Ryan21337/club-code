const YOUTUBE_PRIVACY_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
const YOUTUBE_LISTENING_INTERVAL_MS = 250;
const YOUTUBE_READY_TIMEOUT_MS = 10_000;
const MAX_YOUTUBE_EVENT_BYTES = 32_768;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const YOUTUBE_PLAYLIST_IFRAME_ID = "cafecode-ambient-youtube-playlist";

export interface YouTubePlaylistController {
  next(): void;
  previous(): void;
  play(): void;
  pause(): void;
  stop(): void;
}

export type YouTubePlaylistConnection =
  | { readonly status: "connecting"; readonly controller: null }
  | { readonly status: "ready"; readonly controller: YouTubePlaylistController }
  | { readonly status: "unavailable"; readonly controller: null };

type YouTubePlaylistCommand =
  | "nextVideo"
  | "previousVideo"
  | "playVideo"
  | "pauseVideo"
  | "stopVideo";
export type YouTubeQueuePlaybackEvent = "ended" | "unplayable";
const YOUTUBE_UNPLAYABLE_ERROR_CODES = new Set([2, 5, 100, 101, 150]);

export interface YouTubeIframeCommandPlatform {
  readonly addMessageListener: (listener: (event: MessageEvent) => void) => void;
  readonly removeMessageListener: (listener: (event: MessageEvent) => void) => void;
  readonly setInterval: (callback: () => void, delay: number) => number;
  readonly clearInterval: (handle: number) => void;
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

const browserPlatform: YouTubeIframeCommandPlatform = {
  addMessageListener: (listener) => window.addEventListener("message", listener),
  removeMessageListener: (listener) => window.removeEventListener("message", listener),
  setInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: (handle) => window.clearInterval(handle),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

function isTrustedPlayerSource(source: string): boolean {
  try {
    const url = new URL(source);
    if (
      url.origin !== YOUTUBE_PRIVACY_EMBED_ORIGIN ||
      url.username !== "" ||
      url.password !== "" ||
      url.searchParams.get("enablejsapi") !== "1"
    ) {
      return false;
    }
    if (url.pathname === "/embed/videoseries") {
      return /^[A-Za-z0-9_-]{10,80}$/.test(url.searchParams.get("list") ?? "");
    }
    const match = /^\/embed\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
    return match !== null && YOUTUBE_VIDEO_ID.test(match[1]!);
  } catch {
    return false;
  }
}

function validatedPlayerWindow(element: HTMLIFrameElement): Window | null {
  if (element.id !== YOUTUBE_PLAYLIST_IFRAME_ID || !isTrustedPlayerSource(element.src)) {
    return null;
  }
  return element.contentWindow;
}

function parseYouTubeEvent(data: unknown): {
  readonly event: string;
  readonly info: unknown;
} | null {
  if (typeof data === "string") {
    if (data.length > MAX_YOUTUBE_EVENT_BYTES) return null;
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const event = (data as { readonly event?: unknown }).event;
  if (typeof event !== "string" || event.length > 64) return null;
  return {
    event,
    info: (data as { readonly info?: unknown }).info,
  };
}

export function decodeYouTubeCurrentVideoId(info: unknown): string | null {
  if (typeof info !== "object" || info === null || Array.isArray(info)) {
    return null;
  }
  const videoData = (info as { readonly videoData?: unknown }).videoData;
  if (typeof videoData !== "object" || videoData === null || Array.isArray(videoData)) {
    return null;
  }
  const videoId = (videoData as { readonly video_id?: unknown }).video_id;
  return typeof videoId === "string" && YOUTUBE_VIDEO_ID.test(videoId) ? videoId : null;
}

function postFixedMessage(
  element: HTMLIFrameElement,
  playerWindow: Window,
  message: Readonly<Record<string, unknown>>,
): void {
  if (
    element.isConnected === false ||
    element.contentWindow !== playerWindow ||
    validatedPlayerWindow(element) !== playerWindow
  ) {
    return;
  }
  try {
    playerWindow.postMessage(
      JSON.stringify({
        ...message,
        id: YOUTUBE_PLAYLIST_IFRAME_ID,
        channel: "widget",
      }),
      YOUTUBE_PRIVACY_EMBED_ORIGIN,
    );
  } catch {
    // The frame may navigate or detach between validation and postMessage.
  }
}

/**
 * Establish the smallest possible control boundary with the isolated YouTube
 * iframe. No YouTube-authored script executes in Cafe's parent renderer.
 *
 * The fixed wire envelope is an upstream compatibility dependency rather than
 * a public API. We therefore require the iframe's exact source/origin plus its
 * provider `onReady` acknowledgement, fail closed on timeout/error, and keep a
 * live-browser compatibility smoke alongside the deterministic unit tests.
 */
function connectYouTubeIframe(
  element: HTMLIFrameElement,
  onConnection: (connection: YouTubePlaylistConnection) => void,
  platform: YouTubeIframeCommandPlatform,
  onPlaybackEvent?: (event: YouTubeQueuePlaybackEvent) => void,
  onVideoIdChange?: (videoId: string) => void,
): () => void {
  const playerWindow = validatedPlayerWindow(element);
  if (playerWindow === null) {
    onConnection({ status: "unavailable", controller: null });
    return () => undefined;
  }

  let disposed = false;
  let ready = false;
  let listeningInterval: number | null = null;
  let readyTimeout: number | null = null;
  let terminalPlaybackEventSent = false;
  let currentVideoId: string | null = null;

  const stopHandshakeTimers = () => {
    if (listeningInterval !== null) {
      platform.clearInterval(listeningInterval);
      listeningInterval = null;
    }
    if (readyTimeout !== null) {
      platform.clearTimeout(readyTimeout);
      readyTimeout = null;
    }
  };

  const sendCommand = (command: YouTubePlaylistCommand) => {
    if (!ready || disposed) return;
    postFixedMessage(element, playerWindow, {
      event: "command",
      func: command,
      args: [],
    });
  };
  const controller: YouTubePlaylistController = {
    next: () => sendCommand("nextVideo"),
    previous: () => sendCommand("previousVideo"),
    play: () => sendCommand("playVideo"),
    pause: () => sendCommand("pauseVideo"),
    stop: () => sendCommand("stopVideo"),
  };

  const onMessage = (event: MessageEvent) => {
    if (
      disposed ||
      event.source !== playerWindow ||
      event.origin !== YOUTUBE_PRIVACY_EMBED_ORIGIN ||
      // contentWindow can survive an iframe navigation. Re-check the current
      // element source so a same-origin navigation cannot keep using the old
      // command/event trust grant.
      validatedPlayerWindow(element) !== playerWindow
    ) {
      return;
    }
    const message = parseYouTubeEvent(event.data);
    if (message === null) return;
    if (message.event === "infoDelivery" || message.event === "initialDelivery") {
      const videoId = decodeYouTubeCurrentVideoId(message.info);
      if (videoId !== null && videoId !== currentVideoId) {
        currentVideoId = videoId;
        onVideoIdChange?.(videoId);
      }
    }
    if (message.event === "onReady") {
      ready = true;
      stopHandshakeTimers();
      if (onPlaybackEvent) {
        postFixedMessage(element, playerWindow, {
          event: "command",
          func: "addEventListener",
          args: ["onStateChange"],
        });
        postFixedMessage(element, playerWindow, {
          event: "command",
          func: "addEventListener",
          args: ["onError"],
        });
      }
      onConnection({ status: "ready", controller });
    } else if (
      message.event === "onError" &&
      typeof message.info === "number" &&
      YOUTUBE_UNPLAYABLE_ERROR_CODES.has(message.info)
    ) {
      ready = false;
      stopHandshakeTimers();
      onConnection({ status: "unavailable", controller: null });
      if (!terminalPlaybackEventSent) {
        terminalPlaybackEventSent = true;
        onPlaybackEvent?.("unplayable");
      }
    } else if (
      !terminalPlaybackEventSent &&
      ((message.event === "onStateChange" && message.info === 0) ||
        (message.event === "infoDelivery" &&
          typeof message.info === "object" &&
          message.info !== null &&
          (message.info as { readonly playerState?: unknown }).playerState === 0))
    ) {
      terminalPlaybackEventSent = true;
      onPlaybackEvent?.("ended");
    }
  };
  platform.addMessageListener(onMessage);
  onConnection({ status: "connecting", controller: null });

  const announceListening = () =>
    postFixedMessage(element, playerWindow, {
      event: "listening",
    });
  announceListening();
  listeningInterval = platform.setInterval(announceListening, YOUTUBE_LISTENING_INTERVAL_MS);
  readyTimeout = platform.setTimeout(() => {
    if (disposed || ready) return;
    stopHandshakeTimers();
    onConnection({ status: "unavailable", controller: null });
  }, YOUTUBE_READY_TIMEOUT_MS);

  return () => {
    if (disposed) return;
    disposed = true;
    ready = false;
    stopHandshakeTimers();
    platform.removeMessageListener(onMessage);
  };
}

export function connectYouTubePlaylistIframe(
  element: HTMLIFrameElement,
  onConnection: (connection: YouTubePlaylistConnection) => void,
  platform: YouTubeIframeCommandPlatform = browserPlatform,
  onVideoIdChange?: (videoId: string) => void,
): () => void {
  return connectYouTubeIframe(element, onConnection, platform, undefined, onVideoIdChange);
}

/**
 * Connects the same exact-origin command bridge for a single YouTube embed.
 * A normal video receives transport only; it never acquires invented playlist
 * navigation or queue state.
 */
export function connectYouTubeTransportIframe(
  element: HTMLIFrameElement,
  onConnection: (connection: YouTubePlaylistConnection) => void,
  platform: YouTubeIframeCommandPlatform = browserPlatform,
  onVideoIdChange?: (videoId: string) => void,
): () => void {
  return connectYouTubeIframe(element, onConnection, platform, undefined, onVideoIdChange);
}

/**
 * Observes only documented YouTube IFrame API terminal events for one strict
 * youtube-nocookie frame. A handshake timeout is not treated as an unavailable
 * video because it cannot reliably distinguish policy/network failure; manual
 * URL-queue controls remain independent from this connection.
 */
export function connectYouTubeQueueIframe(
  element: HTMLIFrameElement,
  onPlaybackEvent: (event: YouTubeQueuePlaybackEvent) => void,
  platform: YouTubeIframeCommandPlatform = browserPlatform,
  onVideoIdChange?: (videoId: string) => void,
): () => void {
  return connectYouTubeIframe(element, () => undefined, platform, onPlaybackEvent, onVideoIdChange);
}
