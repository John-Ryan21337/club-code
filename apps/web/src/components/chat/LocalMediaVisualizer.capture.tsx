import "../../index.css";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocalMediaPanel } from "./LocalMediaPanel";
import { localMediaStore } from "../../localMedia";

function syntheticWave(): File {
  const rate = 16000,
    count = rate * 12,
    buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let n = 0; n < value.length; n++) view.setUint8(offset + n, value.charCodeAt(n));
  };
  ascii(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, count * 2, true);
  for (let n = 0; n < count; n++)
    view.setInt16(44 + n * 2, Math.round(Math.sin((n * Math.PI * 2 * 440) / rate) * 4000), true);
  return new File([buffer], "synthetic-tone.wav", { type: "audio/wav" });
}

it("shows real local-player spectrum and MilkDrop from a generated tone with browser audio muted", async () => {
  document.documentElement.classList.add("dark");
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  let sampled = 0,
    peak = 0,
    gpuDraws = 0;
  const read = AnalyserNode.prototype.getByteFrequencyData;
  const sample = vi
    .spyOn(AnalyserNode.prototype, "getByteFrequencyData")
    .mockImplementation(function (this: AnalyserNode, array) {
      read.call(this, array);
      sampled++;
      for (const value of array) peak = Math.max(peak, value);
    });
  const draw = WebGL2RenderingContext.prototype.drawArrays;
  const gpu = vi
    .spyOn(WebGL2RenderingContext.prototype, "drawArrays")
    .mockImplementation(function (this: WebGL2RenderingContext, mode, first, count) {
      gpuDraws++;
      draw.call(this, mode, first, count);
    });
  localMediaStore.clear();
  localMediaStore.selectFile(syntheticWave());
  localMediaStore.update({ presetSize: "large" });
  const screen = await render(
    <main className="p-8">
      <h1 className="text-2xl">Optional local audio visualizer</h1>
      <p className="mt-3 text-sm">
        Real player component. Generated tone; browser audio output is muted. No user files,
        microphone, capture devices, or accounts were read.
      </p>
      <p className="mt-2 text-sm">
        Capture fixture selects the two styles. Product Settings contains these choices.
      </p>
      <LocalMediaPanel
        backgroundEffective={false}
        cinemaEffective={false}
        cinemaHeadingRef={createRef<HTMLHeadingElement>()}
        floatingAnchor={{ left: 40, top: 180, width: 900, height: 530 }}
      />
    </main>,
  );
  const path = "../../../../../docs/pr-assets/local-media-visualizer/";
  try {
    await page.screenshot({ path: path + "before.png" });
    await page.getByLabelText("Toggle local media audio visualizer").click();
    const audio = document.querySelector("audio")!;
    await audio.play();
    await vi.waitFor(() => {
      expect(sampled).toBeGreaterThan(2);
      expect(peak).toBeGreaterThan(0);
    });
    expect(audio.controls).toBe(true);
    await page.screenshot({ path: path + "spectrum.png" });
    const beforeGpu = gpuDraws;
    localMediaStore.update({ visualizerStyle: "milkdrop" });
    await expect.element(page.getByLabelText("Next MilkDrop preset")).toBeEnabled();
    await vi.waitFor(() => expect(gpuDraws).toBeGreaterThan(beforeGpu + 5));
    await page.getByLabelText("Next MilkDrop preset").click();
    await page.screenshot({ path: path + "milkdrop.png" });
    localMediaStore.update({ visualizerStyle: "spectrum" });
    const resumedSamples = sampled;
    await vi.waitFor(() => expect(sampled).toBeGreaterThan(resumedSamples + 2));
    localMediaStore.update({ visualizerStyle: "milkdrop" });
    await expect.element(page.getByLabelText("Next MilkDrop preset")).toBeEnabled();
    const liveCanvas = document.querySelectorAll("canvas")[1]!;
    expect(liveCanvas.getContext("webgl2")!.isContextLost()).toBe(false);
    const resumedGpu = gpuDraws;
    await vi.waitFor(() => expect(gpuDraws).toBeGreaterThan(resumedGpu + 5));
    audio.pause();
    await expect.element(page.getByText("Play media to start the visualizer.")).toBeVisible();
    const pausedDraws = gpuDraws;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(gpuDraws).toBe(pausedDraws);
    await page.screenshot({ path: path + "paused.png" });
    await page.getByLabelText("Toggle local media audio visualizer").click();
    expect(audio.controls).toBe(true);
    expect(audio.isConnected).toBe(true);
    await vi.waitFor(() =>
      expect(getComputedStyle(document.querySelectorAll("canvas")[1]!).opacity).toBe("0"),
    );
    console.log(
      JSON.stringify({
        syntheticToneOnly: true,
        browserAudioMuted: true,
        realAnalyserReads: sampled,
        peak,
        realGpuDraws: gpuDraws,
        pausedStable: true,
      }),
    );
  } finally {
    await screen.unmount();
    localMediaStore.clear();
    focused.mockRestore();
    sample.mockRestore();
    gpu.mockRestore();
  }
});
