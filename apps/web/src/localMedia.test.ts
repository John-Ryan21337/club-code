import { describe, expect, it, vi } from "vitest";
import type { DesktopLocalMediaSelection } from "@cafecode/contracts";

import { createLocalMediaStore, DEFAULT_LOCAL_MEDIA_STATE } from "./localMedia";

function createUrlApi() {
  let nextId = 0;
  const created: Blob[] = [];
  const revoked: string[] = [];
  return {
    api: {
      createObjectURL: (file: Blob) => {
        created.push(file);
        nextId += 1;
        return `blob:local-media-${nextId}`;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    },
    created,
    revoked,
  };
}

describe("local media store", () => {
  it("keeps only a current-session object URL and display title, then revokes it when replaced or cleared", () => {
    const { api, created, revoked } = createUrlApi();
    const store = createLocalMediaStore(api);
    const audio = {
      name: "C:\\private\\mixes\\night-drive.mp3",
      type: "audio/mpeg",
    } as unknown as Blob;
    const video = { name: "clip.mp4", type: "video/mp4" } as unknown as Blob;

    expect(store.selectFile(audio)).toBe(true);
    expect(store.getSnapshot().source).toEqual({
      kind: "audio",
      objectUrl: "blob:local-media-1",
      displayTitle: "night-drive",
      engine: "browser",
    });
    expect(store.selectFile(video)).toBe(true);
    expect(store.getSnapshot().source).toEqual({
      kind: "video",
      objectUrl: "blob:local-media-2",
      displayTitle: "clip",
      engine: "browser",
    });
    expect(revoked).toEqual(["blob:local-media-1"]);

    store.clear();
    store.clear();
    expect(store.getSnapshot().source).toBeNull();
    expect(created).toEqual([audio, video]);
    expect(revoked).toEqual(["blob:local-media-1", "blob:local-media-2"]);
  });

  it("rejects non-media picker values without allocating a URL", () => {
    const { api, created, revoked } = createUrlApi();
    const store = createLocalMediaStore(api);
    const text = { type: "text/plain" } as Blob;

    expect(store.selectFile(text)).toBe(false);
    expect(store.getSnapshot()).toEqual(DEFAULT_LOCAL_MEDIA_STATE);
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
    expect(store.getSelectionRevision()).toBe(0);
  });

  it("advances a session-only selection revision for successful choices and clear intent", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(store.getSelectionRevision()).toBe(0);
    expect(store.selectFile({ name: "song.mp3", type: "audio/mpeg" } as unknown as Blob)).toBe(
      true,
    );
    expect(store.getSelectionRevision()).toBe(1);
    store.clear();
    expect(store.getSelectionRevision()).toBe(2);
    // An empty Clear still invalidates an outstanding native picker.
    store.clear();
    expect(store.getSelectionRevision()).toBe(3);
  });

  it("accepts a known local media extension when the browser supplies no MIME type", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(store.selectFile({ name: "private-recording.mp3", type: "" } as unknown as Blob)).toBe(
      true,
    );
    expect(store.getSnapshot().source).toEqual({
      kind: "audio",
      objectUrl: "blob:local-media-1",
      displayTitle: "private-recording",
      engine: "browser",
    });
  });

  it("keeps a bounded direct queue private and creates only the current object URL", async () => {
    const { api, created, revoked } = createUrlApi();
    const store = createLocalMediaStore(api);
    const files = [
      { name: "C:\\private\\one.mp3", type: "audio/mpeg", size: 10 },
      { name: "/private/two.flv", type: "", size: 20 },
      { name: "three.wav", type: "audio/wav", size: 30 },
    ] as unknown as Blob[];

    expect(store.selectFiles(files)).toBe(true);
    expect(created).toEqual([files[0]]);
    expect(store.getSnapshot()).toMatchObject({
      source: { displayTitle: "one", kind: "audio", engine: "browser" },
      queue: { currentIndex: 0, totalItems: 3 },
    });
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private");

    await expect(store.navigate("next")).resolves.toBe(true);
    expect(created).toEqual([files[0], files[1]]);
    expect(revoked).toEqual(["blob:local-media-1"]);
    expect(store.getSnapshot()).toMatchObject({
      source: { displayTitle: "two", kind: "video" },
      queue: { currentIndex: 1, totalItems: 3 },
    });

    await expect(store.navigate("previous")).resolves.toBe(true);
    expect(store.getSnapshot().queue?.currentIndex).toBe(0);
    await expect(store.handlePlaybackEnded()).resolves.toBe(true);
    expect(store.getSnapshot().queue?.currentIndex).toBe(1);
  });

  it("bounds direct queue selection and rejects misleading or unsupported files", () => {
    const { api, created } = createUrlApi();
    const store = createLocalMediaStore(api);
    const supported = { name: "song.mp3", type: "text/plain", size: 1 } as unknown as Blob;
    const misleading = { name: "notes.txt", type: "audio/mpeg", size: 1 } as unknown as Blob;
    const tooLarge = {
      name: "movie.mp4",
      type: "video/mp4",
      size: 64 * 1024 * 1024 * 1024 + 1,
    } as unknown as Blob;

    expect(store.selectFiles(Array.from({ length: 65 }, () => supported))).toBe(false);
    expect(store.selectFiles([misleading])).toBe(false);
    expect(
      store.selectFiles([
        { name: "looks-like-a-song.mp3", type: "text/plain", size: 1 } as unknown as Blob,
      ]),
    ).toBe(false);
    expect(store.selectFiles([tooLarge])).toBe(false);
    expect(created).toEqual([]);
  });

  it("skips failed direct items once and stops after every queue item failed", async () => {
    const { api, created } = createUrlApi();
    const store = createLocalMediaStore(api);
    expect(
      store.selectFiles([
        { name: "one.mp3", type: "audio/mpeg" } as unknown as Blob,
        { name: "two.mp3", type: "audio/mpeg" } as unknown as Blob,
        { name: "three.mp3", type: "audio/mpeg" } as unknown as Blob,
      ]),
    ).toBe(true);

    await expect(store.handlePlaybackFailure()).resolves.toBe(true);
    expect(store.getSnapshot().queue?.currentIndex).toBe(1);
    await expect(store.handlePlaybackFailure()).resolves.toBe(true);
    expect(store.getSnapshot().queue?.currentIndex).toBe(2);
    await expect(store.handlePlaybackFailure()).resolves.toBe(false);
    expect(store.getSnapshot().queue?.currentIndex).toBe(2);
    expect(created).toHaveLength(3);
  });

  it("replays a one-item direct queue on ended but stops after its one failure", async () => {
    const { api, created } = createUrlApi();
    const store = createLocalMediaStore(api);
    expect(store.selectFiles([{ name: "loop.mp3", type: "audio/mpeg" } as unknown as Blob])).toBe(
      true,
    );

    await expect(store.handlePlaybackEnded()).resolves.toBe(true);
    expect(created).toHaveLength(2);
    await expect(store.handlePlaybackFailure()).resolves.toBe(false);
    expect(created).toHaveLength(2);
  });

  it("uses supplied metadata titles without retaining an absolute path", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(
      store.selectFile(
        { name: "C:\\private\\recording.mp3", type: "audio/mpeg" } as unknown as Blob,
        { displayTitle: "Studio cut" },
      ),
    ).toBe(true);
    expect(store.getSnapshot().source).toEqual({
      kind: "audio",
      objectUrl: "blob:local-media-1",
      displayTitle: "Studio cut",
      engine: "browser",
    });
    expect(JSON.stringify(store.getSnapshot().source)).not.toContain("C:\\private");
  });

  it("reduces path-like metadata titles to a safe basename and falls back when no title exists", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(
      store.selectFile({ name: "", type: "audio/mpeg" } as unknown as Blob, {
        displayTitle: "C:\\private\\takes\\first-pass.wav",
      }),
    ).toBe(true);
    expect(store.getSnapshot().source?.displayTitle).toBe("first-pass");

    expect(
      store.selectFile({ name: "", type: "audio/mpeg" } as unknown as Blob, {
        displayTitle: "file:///private/takes/second-pass.wav",
      }),
    ).toBe(true);
    expect(store.getSnapshot().source?.displayTitle).toBe("second-pass");

    expect(store.selectFile({ name: "", type: "audio/mpeg" } as unknown as Blob)).toBe(true);
    expect(store.getSnapshot().source?.displayTitle).toBe("Untitled local media");
  });

  it("removes display controls from direct browser and desktop titles", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(
      store.selectFile({ name: "song\u202Etxt.mp3", type: "audio/mpeg" } as unknown as Blob),
    ).toBe(true);
    expect(store.getSnapshot().source?.displayTitle).toBe("song txt");

    expect(
      store.selectDesktopMedia({
        sessionId: "s".repeat(43),
        kind: "video",
        displayTitle: "C:\\private\\clip\u202Emp4.mkv",
        playbackUrl: `cafecode-media://stream/${"p".repeat(43)}`,
        currentIndex: 0,
        totalItems: 1,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toBe(true);
    expect(store.getSnapshot().source?.displayTitle).toBe("clip mp4");
  });

  it.each([
    ["trailer.flv", "video"],
    ["movie.mkv", "video"],
    ["capture.avi", "video"],
    ["archive.wmv", "video"],
    ["feature.mpeg", "video"],
    ["feature.mpg", "video"],
    ["broadcast.ts", "video"],
    ["disc.m2ts", "video"],
    ["phone.3gp", "video"],
    ["session.aiff", "audio"],
    ["recording.wma", "audio"],
  ] as const)("classifies common VLC format %s as %s when MIME type is absent", (name, kind) => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(store.selectFile({ name, type: "" } as unknown as Blob)).toBe(true);
    expect(store.getSnapshot().source).toMatchObject({
      kind,
      displayTitle: name.slice(0, name.lastIndexOf(".")),
    });
  });

  it("adopts and releases only an opaque desktop VLC session", async () => {
    const { api, revoked } = createUrlApi();
    const release = vi.fn(async () => true);
    const store = createLocalMediaStore(api, DEFAULT_LOCAL_MEDIA_STATE, { release });

    expect(
      store.selectDesktopMedia({
        sessionId: "s".repeat(43),
        kind: "video",
        displayTitle: "old-film",
        playbackUrl: `cafecode-media://stream/${"p".repeat(43)}`,
        currentIndex: 1,
        totalItems: 3,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toBe(true);
    expect(store.getSnapshot().source).toEqual({
      kind: "video",
      objectUrl: `cafecode-media://stream/${"p".repeat(43)}`,
      displayTitle: "old-film",
      engine: "vlc",
      sessionId: "s".repeat(43),
    });
    expect(store.getSnapshot().queue).toEqual({ currentIndex: 1, totalItems: 3 });
    expect(JSON.stringify(store.getSnapshot().source)).not.toContain("127.0.0.1");

    store.clear();
    await Promise.resolve();
    expect(release).toHaveBeenCalledWith("s".repeat(43));
    expect(revoked).toEqual([]);
  });

  it("navigates one VLC queue with rotated playback tokens and ignores stale results", async () => {
    const { api } = createUrlApi();
    let resolveNavigate!: (selection: DesktopLocalMediaSelection) => void;
    const navigate = vi.fn(
      async () =>
        await new Promise<DesktopLocalMediaSelection>((resolve) => {
          resolveNavigate = resolve;
        }),
    );
    const release = vi.fn(async () => true);
    const store = createLocalMediaStore(api, DEFAULT_LOCAL_MEDIA_STATE, { navigate, release });
    const sessionId = "s".repeat(43);
    expect(
      store.selectDesktopMedia({
        sessionId,
        kind: "video",
        displayTitle: "one",
        playbackUrl: `cafecode-media://stream/${"p".repeat(43)}`,
        currentIndex: 0,
        totalItems: 2,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toBe(true);

    const pending = store.navigate("next");
    expect(store.getSnapshot().navigationPending).toBe(true);
    expect(store.selectFiles([{ name: "newer.mp3", type: "audio/mpeg" } as unknown as Blob])).toBe(
      true,
    );
    resolveNavigate({
      sessionId,
      kind: "audio",
      displayTitle: "stale",
      playbackUrl: `cafecode-media://stream/${"q".repeat(43)}`,
      currentIndex: 1,
      totalItems: 2,
      engine: { label: "VLC", version: null, reason: null },
    });

    await expect(pending).resolves.toBe(false);
    expect(store.getSnapshot().source).toMatchObject({ engine: "browser", displayTitle: "newer" });
    expect(release).toHaveBeenCalledWith(sessionId);
  });

  it.each(["null", "malformed", "rejected"] as const)(
    "fails closed when VLC navigation returns %s after native state may have changed",
    async (resultKind) => {
      const { api } = createUrlApi();
      const sessionId = "s".repeat(43);
      const navigate =
        resultKind === "rejected"
          ? vi.fn(async () => {
              throw new Error("native failure");
            })
          : resultKind === "null"
            ? vi.fn(async () => null)
            : vi.fn(async () => ({ sessionId: "bad" }) as never);
      const release = vi.fn(async () => true);
      const store = createLocalMediaStore(api, DEFAULT_LOCAL_MEDIA_STATE, { navigate, release });
      expect(
        store.selectDesktopMedia({
          sessionId,
          kind: "video",
          displayTitle: "one",
          playbackUrl: `cafecode-media://stream/${"p".repeat(43)}`,
          currentIndex: 0,
          totalItems: 2,
          engine: { label: "VLC", version: null, reason: null },
        }),
      ).toBe(true);

      await expect(store.navigate("next")).resolves.toBe(false);
      expect(store.getSnapshot()).toMatchObject({
        source: null,
        queue: null,
        navigationPending: false,
      });
      expect(release).toHaveBeenCalledWith(sessionId);
    },
  );

  it("fails closed for a malformed desktop selection without replacing browser media", () => {
    const { api, revoked } = createUrlApi();
    const release = vi.fn();
    const store = createLocalMediaStore(api, DEFAULT_LOCAL_MEDIA_STATE, { release });
    expect(store.selectFile({ name: "safe.mp3", type: "audio/mpeg" } as unknown as Blob)).toBe(
      true,
    );

    expect(
      store.selectDesktopMedia({
        sessionId: "short",
        kind: "video",
        displayTitle: "unsafe",
        playbackUrl: "https://example.com/movie.flv",
        currentIndex: 0,
        totalItems: 1,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toBe(false);
    expect(store.getSnapshot().source).toMatchObject({
      engine: "browser",
      objectUrl: "blob:local-media-1",
    });
    expect(release).not.toHaveBeenCalled();
    expect(revoked).toEqual([]);
  });

  it("allows a separately rotated opaque playback token while keeping the queue session opaque", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(
      store.selectDesktopMedia({
        sessionId: "s".repeat(43),
        kind: "video",
        displayTitle: "mismatched-token",
        playbackUrl: `cafecode-media://stream/${"t".repeat(43)}`,
        currentIndex: 0,
        totalItems: 2,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toBe(true);
    expect(store.getSnapshot().source).toMatchObject({
      sessionId: "s".repeat(43),
      objectUrl: `cafecode-media://stream/${"t".repeat(43)}`,
    });
  });

  it("rejects malformed runtime bridge values without throwing or releasing the current source", () => {
    const { api, revoked } = createUrlApi();
    const release = vi.fn();
    const store = createLocalMediaStore(api, DEFAULT_LOCAL_MEDIA_STATE, { release });
    expect(store.selectFile({ name: "safe.mp3", type: "audio/mpeg" } as unknown as Blob)).toBe(
      true,
    );

    expect(
      store.selectDesktopMedia({
        sessionId: "s".repeat(43),
        kind: "video",
        displayTitle: "unsafe",
        playbackUrl: `cafecode-media://stream/${"s".repeat(43)}`,
        currentIndex: 0,
        totalItems: 1,
        engine: null,
      } as never),
    ).toBe(false);
    expect(store.getSnapshot().source).toMatchObject({ engine: "browser" });
    expect(release).not.toHaveBeenCalled();
    expect(revoked).toEqual([]);
  });

  it("keeps presentation preferences ephemeral alongside the selected source", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);
    store.update({
      glowEnabled: true,
      glowMode: "adaptive",
      glowOpacity: 0.5,
      layoutMode: "custom",
      presetPlacement: "bottom-left",
      presetSize: "large",
      presentationMode: "cinema",
      visualizerEnabled: true,
    });

    expect(store.getSnapshot()).toMatchObject({
      source: null,
      glowEnabled: true,
      glowMode: "adaptive",
      glowOpacity: 0.5,
      layoutMode: "custom",
      presetPlacement: "bottom-left",
      presetSize: "large",
      presentationMode: "cinema",
      visualizerEnabled: true,
    });
  });

  it("keeps audio controls reachable and bounds presentation opacity", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(store.selectFile({ type: "video/mp4" } as Blob)).toBe(true);
    store.update({ presentationMode: "background", backgroundOpacity: 9 });
    expect(store.getSnapshot()).toMatchObject({
      presentationMode: "background",
      backgroundOpacity: 0.7,
    });

    expect(store.selectFile({ type: "audio/mpeg" } as Blob)).toBe(true);
    expect(store.getSnapshot().presentationMode).toBe("floating");

    store.update({ presentationMode: "background", backgroundOpacity: -1 });
    expect(store.getSnapshot()).toMatchObject({
      presentationMode: "floating",
      backgroundOpacity: 0.15,
    });

    store.update({ backgroundOpacity: Number.NaN, glowOpacity: Number.POSITIVE_INFINITY });
    expect(store.getSnapshot()).toMatchObject({
      backgroundOpacity: DEFAULT_LOCAL_MEDIA_STATE.backgroundOpacity,
      glowOpacity: DEFAULT_LOCAL_MEDIA_STATE.glowOpacity,
    });
  });
});
