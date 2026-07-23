import { describe, expect, it } from "vitest";

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
  it("keeps only a current-session object URL and revokes it when replaced or cleared", () => {
    const { api, created, revoked } = createUrlApi();
    const store = createLocalMediaStore(api);
    const audio = { type: "audio/mpeg" } as Blob;
    const video = { type: "video/mp4" } as Blob;

    expect(store.selectFile(audio)).toBe(true);
    expect(store.getSnapshot().source).toEqual({ kind: "audio", objectUrl: "blob:local-media-1" });
    expect(store.selectFile(video)).toBe(true);
    expect(store.getSnapshot().source).toEqual({ kind: "video", objectUrl: "blob:local-media-2" });
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
  });

  it("accepts a known local media extension when the browser supplies no MIME type", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);

    expect(store.selectFile({ name: "private-recording.mp3", type: "" } as unknown as Blob)).toBe(
      true,
    );
    expect(store.getSnapshot().source).toEqual({ kind: "audio", objectUrl: "blob:local-media-1" });
  });

  it("keeps presentation preferences ephemeral alongside the selected source", () => {
    const { api } = createUrlApi();
    const store = createLocalMediaStore(api);
    store.update({
      glowEnabled: true,
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
