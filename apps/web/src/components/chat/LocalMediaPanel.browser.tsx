import "../../index.css";

import { createRef } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { localMediaStore, registerLocalMediaElement } from "../../localMedia";
import { LocalMediaPanel } from "./LocalMediaPanel";

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function silentWavFile(): File {
  const buffer = new ArrayBuffer(45);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 37, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 8_000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, 1, true);
  view.setUint8(44, 128);
  return new File([buffer], "private-session-audio.wav", { type: "audio/wav" });
}

beforeEach(() => {
  localMediaStore.clear();
  registerLocalMediaElement(null);
});

afterEach(() => {
  localMediaStore.clear();
  registerLocalMediaElement(null);
});

it("keeps a floating player inside the registered chat anchor without exposing its file name", async () => {
  expect(localMediaStore.selectFile(silentWavFile())).toBe(true);
  const screen = await render(
    <div className="relative h-[600px] w-[900px]">
      <LocalMediaPanel
        backgroundEffective={false}
        cinemaEffective={false}
        cinemaHeadingRef={createRef<HTMLHeadingElement>()}
        floatingAnchor={{ left: 100, top: 50, width: 600, height: 400 }}
      />
    </div>,
  );

  try {
    const panel = page.getByRole("region", { name: "Local media player" });
    await expect.element(panel).toBeVisible();
    const rect = panel.element().getBoundingClientRect();
    expect(rect.left).toBeCloseTo(208, 0);
    expect(rect.top).toBeCloseTo(198, 0);
    expect(rect.width).toBeCloseTo(480, 0);
    expect(rect.height).toBeCloseTo(240, 0);
    expect(document.body.textContent).not.toContain("private-session-audio.wav");
  } finally {
    await screen.unmount();
  }

  // A route/layout remount must not revoke a document-session selection. The
  // browser releases the final object URL on document unload; replacement and
  // explicit Clear revoke it eagerly in the store.
  expect(localMediaStore.getSnapshot().source?.kind).toBe("audio");
});

it("removes inaccessible native controls while a local video is a background", async () => {
  expect(
    localMediaStore.selectFile(
      new File(["not-decoded"], "private-video.mp4", { type: "video/mp4" }),
    ),
  ).toBe(true);
  const screen = await render(
    <div className="relative h-[600px] w-[900px]">
      <LocalMediaPanel
        backgroundEffective
        cinemaEffective={false}
        cinemaHeadingRef={createRef<HTMLHeadingElement>()}
        floatingAnchor={{ left: 100, top: 50, width: 600, height: 400 }}
      />
    </div>,
  );

  try {
    const video = document.querySelector<HTMLVideoElement>(
      'video[data-local-media-source="selected-file"]',
    );
    expect(video).not.toBeNull();
    expect(video!.controls).toBe(false);
    expect(video!.tabIndex).toBe(-1);
    expect(video!.disablePictureInPicture).toBe(true);
  } finally {
    await screen.unmount();
  }
});
