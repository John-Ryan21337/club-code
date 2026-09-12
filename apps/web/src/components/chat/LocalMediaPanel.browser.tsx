import "../../index.css";

import { createRef } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { localMediaStore, registerLocalMediaElement } from "../../localMedia";
import { LocalMediaPanel } from "./LocalMediaPanel";
import { LocalMediaAudioVisualizer } from "./LocalMediaAudioVisualizer";

it("replaces visualization canvases only when the exact media input changes", async () => {
  const first = document.createElement("audio");
  const second = document.createElement("audio");
  const screen = await render(<LocalMediaAudioVisualizer enabled={false} mediaElement={first} />);
  try {
    const original = document.querySelector('[data-testid="local-media-audio-visualizer"] canvas');
    expect(original).not.toBeNull();
    await screen.rerender(
      <LocalMediaAudioVisualizer enabled={false} style="milkdrop" mediaElement={first} />,
    );
    expect(document.querySelector('[data-testid="local-media-audio-visualizer"] canvas')).toBe(
      original,
    );
    await screen.rerender(
      <LocalMediaAudioVisualizer enabled={false} style="milkdrop" mediaElement={second} />,
    );
    expect(document.querySelector('[data-testid="local-media-audio-visualizer"] canvas')).not.toBe(
      original,
    );
    expect(original!.isConnected).toBe(false);
  } finally {
    await screen.unmount();
  }
});

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function silentWavFile(name = "private-session-audio.wav"): File {
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
  return new File([buffer], name, { type: "audio/wav" });
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
      'video[data-local-media-source="browser"]',
    );
    expect(video).not.toBeNull();
    expect(video!.controls).toBe(false);
    expect(video!.tabIndex).toBe(-1);
    expect(video!.disablePictureInPicture).toBe(true);
  } finally {
    await screen.unmount();
  }
});

it("shows queue position and supports previous, next, ended, and bounded error skip", async () => {
  expect(
    localMediaStore.selectFiles([
      silentWavFile("one.wav"),
      silentWavFile("two.wav"),
      silentWavFile("three.wav"),
    ]),
  ).toBe(true);
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
    await expect.element(page.getByText(/Local media · one · 1\/3/)).toBeVisible();
    await page.getByLabelText("Next local media").click();
    await expect.element(page.getByText(/Local media · two · 2\/3/)).toBeVisible();
    await page.getByLabelText("Previous local media").click();
    await expect.element(page.getByText(/Local media · one · 1\/3/)).toBeVisible();

    document.querySelector("audio")?.dispatchEvent(new Event("ended"));
    await expect.element(page.getByText(/Local media · two · 2\/3/)).toBeVisible();
    document.querySelector("audio")?.dispatchEvent(new Event("error"));
    await expect.element(page.getByText(/Local media · three · 3\/3/)).toBeVisible();
  } finally {
    await screen.unmount();
  }
});

it("continues once after a played item ends, but initial selection and unplayed ends remain manual", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  localMediaStore.selectFiles([silentWavFile("one.wav"), silentWavFile("two.wav")]);
  const view = await render(
    <LocalMediaPanel
      backgroundEffective={false}
      cinemaEffective={false}
      cinemaHeadingRef={createRef<HTMLHeadingElement>()}
      floatingAnchor={{ left: 0, top: 0, width: 900, height: 600 }}
    />,
  );
  try {
    const audio = document.querySelector("audio")!;
    expect(play).not.toHaveBeenCalled();
    audio.dispatchEvent(new Event("ended"));
    await expect.poll(() => localMediaStore.getSnapshot().queue?.currentIndex).toBe(1);
    expect(play).not.toHaveBeenCalled();
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("ended"));
    await expect.poll(() => play.mock.calls.length).toBe(1);
    expect(localMediaStore.getSnapshot().queue?.currentIndex).toBe(0);
    audio.dispatchEvent(new Event("ended"));
    await expect.poll(() => localMediaStore.getSnapshot().queue?.currentIndex).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
    play.mockRestore();
  }
});

it("does not resume a queue replaced in the ended continuation gap", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  localMediaStore.selectFiles([silentWavFile("one.wav"), silentWavFile("two.wav")]);
  const view = await render(
    <LocalMediaPanel
      backgroundEffective={false}
      cinemaEffective={false}
      cinemaHeadingRef={createRef<HTMLHeadingElement>()}
      floatingAnchor={{ left: 0, top: 0, width: 900, height: 600 }}
    />,
  );
  try {
    const audio = document.querySelector("audio")!;
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("ended"));
    localMediaStore.clear();
    localMediaStore.selectFile(silentWavFile("new-choice.wav"));
    await expect.element(page.getByText(/new-choice/)).toBeVisible();
    expect(play).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    play.mockRestore();
  }
});

it("retains manual playback controls when the next-item continuation is denied", async () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockRejectedValue(new DOMException("A user gesture is required", "NotAllowedError"));
  localMediaStore.selectFiles([silentWavFile("one.wav"), silentWavFile("two.wav")]);
  const view = await render(
    <LocalMediaPanel
      backgroundEffective={false}
      cinemaEffective={false}
      cinemaHeadingRef={createRef<HTMLHeadingElement>()}
      floatingAnchor={{ left: 0, top: 0, width: 900, height: 600 }}
    />,
  );
  try {
    const audio = document.querySelector("audio")!;
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("ended"));
    await expect.poll(() => play.mock.calls.length).toBe(1);
    await expect.poll(() => document.querySelector("audio")?.controls).toBe(true);
    expect(localMediaStore.getSnapshot().queue?.currentIndex).toBe(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    play.mockResolvedValue();
    await document.querySelector("audio")!.play();
    expect(play).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
    play.mockRestore();
  }
});

it.each([false, true])(
  "keeps the complete video control surface inside the panel (cinema=%s)",
  async (cinema) => {
    // Layout needs a decodable local source, but does not depend on video pixels.
    // Chromium can play WAV bytes in the video element used for this fixture.
    localMediaStore.selectFile(new File([silentWavFile()], "layout.webm", { type: "video/webm" }));
    const view = await render(
      <div className="relative grid h-[200px] w-[600px]">
        <LocalMediaPanel
          backgroundEffective={false}
          cinemaEffective={cinema}
          cinemaHeadingRef={createRef<HTMLHeadingElement>()}
          floatingAnchor={{ left: 0, top: 0, width: 600, height: 200 }}
        />
      </div>,
    );
    try {
      const region = page.getByRole("region", { name: "Local media player" });
      await expect.element(region).toBeVisible();
      const video = document.querySelector("video")!;
      expect(video.controls).toBe(true);
      const panel = region.element().getBoundingClientRect();
      const media = video.getBoundingClientRect();
      const heading = document.querySelector("h2")!.getBoundingClientRect();
      expect(media.top).toBeGreaterThanOrEqual(heading.bottom);
      expect(media.bottom).toBeLessThanOrEqual(panel.bottom);
      expect(media.height).toBeGreaterThan(100);
    } finally {
      await view.unmount();
    }
  },
);

it("ignores a failed navigation result after the queue has been replaced", async () => {
  let resolveNavigation!: (value: boolean) => void;
  const navigate = vi.spyOn(localMediaStore, "navigate").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveNavigation = resolve;
      }),
  );
  localMediaStore.selectFile(silentWavFile("old.wav"));
  const view = await render(
    <LocalMediaPanel
      backgroundEffective={false}
      cinemaEffective={false}
      cinemaHeadingRef={createRef<HTMLHeadingElement>()}
      floatingAnchor={{ left: 0, top: 0, width: 900, height: 600 }}
    />,
  );
  try {
    await page.getByLabelText("Next local media").click();
    expect(navigate).toHaveBeenCalledTimes(1);
    localMediaStore.selectFile(silentWavFile("new.wav"));
    await expect.element(page.getByText(/Local media · new/)).toBeVisible();
    resolveNavigation(false);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    expect(document.querySelector("audio")?.controls).toBe(true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await view.unmount();
    navigate.mockRestore();
  }
});

it("keeps narrow native controls usable when the optional visualizer is enabled", async () => {
  localMediaStore.selectFile(silentWavFile());
  const screen = await render(
    <LocalMediaPanel
      backgroundEffective={false}
      cinemaEffective={false}
      cinemaHeadingRef={createRef<HTMLHeadingElement>()}
      floatingAnchor={{ left: 0, top: 0, width: 280, height: 400 }}
    />,
  );
  try {
    await page.getByLabelText("Toggle local media audio visualizer").click();
    expect(localMediaStore.getSnapshot().visualizerEnabled).toBe(true);
    const panel = page
      .getByRole("region", { name: "Local media player" })
      .element()
      .getBoundingClientRect();
    for (const label of [
      "Toggle local media audio visualizer",
      "Next local media",
      "Clear local media",
    ]) {
      const control = page.getByLabelText(label).element().getBoundingClientRect();
      expect(control.left).toBeGreaterThanOrEqual(panel.left);
      expect(control.right).toBeLessThanOrEqual(panel.right);
    }
    const audio = document.querySelector("audio")!;
    expect(audio.controls).toBe(true);
    expect(document.querySelector('[data-testid="local-media-audio-visualizer"]')).not.toBeNull();
    await page.getByLabelText("Toggle local media audio visualizer").click();
    expect(localMediaStore.getSnapshot().visualizerEnabled).toBe(false);
    expect(audio.isConnected).toBe(true);
  } finally {
    await screen.unmount();
  }
});

it("shows playback guidance before loading a MilkDrop preset for paused media", async () => {
  localMediaStore.selectFile(silentWavFile());
  localMediaStore.update({ visualizerEnabled: true, visualizerStyle: "milkdrop" });
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const screen = await render(
    <LocalMediaPanel
      backgroundEffective={false}
      cinemaEffective={false}
      cinemaHeadingRef={createRef<HTMLHeadingElement>()}
      floatingAnchor={{ left: 0, top: 0, width: 600, height: 400 }}
    />,
  );
  try {
    await expect.element(page.getByText("Play media to start the visualizer.")).toBeVisible();
    await expect.element(page.getByLabelText("Next MilkDrop preset")).toBeDisabled();
    expect(document.body.textContent).not.toContain("Loading MilkDrop");
  } finally {
    await screen.unmount();
    focused.mockRestore();
  }
});
