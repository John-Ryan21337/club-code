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
    });
    expect(store.selectFile(video)).toBe(true);
    expect(store.getSnapshot().source).toEqual({
      kind: "video",
      objectUrl: "blob:local-media-2",
      displayTitle: "clip",
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
    });
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
