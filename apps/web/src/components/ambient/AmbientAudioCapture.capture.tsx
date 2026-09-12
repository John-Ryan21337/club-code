import "../../index.css";
import { useSyncExternalStore } from "react";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AmbientVideoWorkspace, useAmbientVideoWorkspace } from "./AmbientVideoWorkspace";
import { AmbientAudioCaptureControl } from "./AmbientAudioCaptureControl";
import { ambientAudioCaptureStore } from "../../ambientAudioCapture";
import { localMediaStore } from "../../localMedia";

const fixture = vi.hoisted(() => ({
  settings: {} as UnifiedSettings,
  connection: {},
  listeners: new Set<() => void>(),
}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => fixture.connection,
  subscribeEnvironmentConnections: () => () => {},
}));
vi.mock("../../hooks/useSettings", () => ({
  getClientSettings: () => fixture.settings,
  useSettings: () =>
    useSyncExternalStore(
      (listener) => {
        fixture.listeners.add(listener);
        return () => fixture.listeners.delete(listener);
      },
      () => fixture.settings,
    ),
  useUpdateSettings: () => ({
    updateSettings: (patch: Partial<UnifiedSettings>) => {
      fixture.settings = { ...fixture.settings, ...patch };
      for (const listener of fixture.listeners) listener();
    },
  }),
}));
vi.mock("../../ambientVideo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ambientVideo")>()),
  youtubeEmbedUrl: () => "about:blank",
}));
vi.mock("../../ambientVideoGlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ambientVideoGlow")>()),
  loadYouTubeEdgePalette: async () => null,
}));

function Controls() {
  const { registerChatAnchor, audioCaptureOwner } = useAmbientVideoWorkspace();
  return (
    <main ref={registerChatAnchor} className="h-full p-6">
      <section className="max-w-[520px] rounded-xl border bg-card p-5">
        <h1 className="text-xl">Optional shared-audio analysis</h1>
        <p className="mt-3 text-sm">
          Real controls, stream analyser and GPU renderer. This fixture supplies a generated tone
          and a blank player frame. Browser output is muted.
        </p>
        <p className="mt-2 text-sm">
          No chooser, microphone, user audio, service playback or account was accessed.
        </p>
        <AmbientAudioCaptureControl owner={audioCaptureOwner} />
      </section>
    </main>
  );
}

it("renders real Spectrum and MilkDrop from a synthetic shared stream, then stops all tracks", async () => {
  document.documentElement.classList.add("dark");
  localMediaStore.clear();
  fixture.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    ambientVideoEnabled: true,
    ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
  };
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const audio = new AudioContext();
  const tone = audio.createOscillator();
  const destination = audio.createMediaStreamDestination();
  tone.frequency.value = 440;
  tone.connect(destination);
  tone.start();
  const video = document.createElement("canvas").captureStream(0);
  const stream = new MediaStream([
    ...destination.stream.getAudioTracks(),
    ...video.getVideoTracks(),
  ]);
  const chooser = vi
    .spyOn(navigator.mediaDevices, "getDisplayMedia")
    .mockImplementation(async () => {
      await audio.resume();
      return stream;
    });
  let samples = 0,
    peak = 0,
    draws = 0;
  const sample = AnalyserNode.prototype.getByteFrequencyData;
  const read = vi
    .spyOn(AnalyserNode.prototype, "getByteFrequencyData")
    .mockImplementation(function (this: AnalyserNode, values) {
      sample.call(this, values);
      samples++;
      for (const value of values) peak = Math.max(peak, value);
    });
  const draw = WebGL2RenderingContext.prototype.drawArrays;
  const gpu = vi
    .spyOn(WebGL2RenderingContext.prototype, "drawArrays")
    .mockImplementation(function (this: WebGL2RenderingContext, mode, first, count) {
      draws++;
      draw.call(this, mode, first, count);
    });
  const view = await render(
    <div className="h-[820px] w-full">
      <AmbientVideoWorkspace environmentScopeKey="synthetic-capture">
        <Controls />
      </AmbientVideoWorkspace>
    </div>,
  );
  const path = "../../../../../docs/pr-assets/display-audio-capture/";
  try {
    await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
    document.querySelector("iframe")!.dispatchEvent(new Event("load"));
    const frame = document.querySelector("iframe");
    await expect
      .element(page.getByRole("button", { name: "Start shared audio analysis" }))
      .toBeEnabled();
    expect(chooser).not.toHaveBeenCalled();
    await page.screenshot({ path: path + "before.png" });
    await page.getByRole("button", { name: "Start shared audio analysis" }).click();
    await vi.waitFor(() => {
      expect(samples).toBeGreaterThan(2);
      expect(peak).toBeGreaterThan(0);
    });
    expect(stream.getVideoTracks()[0]?.readyState).toBe("ended");
    expect(document.querySelector("iframe")).toBe(frame);
    await page.screenshot({ path: path + "spectrum.png" });
    await page.getByRole("combobox", { name: "Shared audio visualizer style" }).click();
    await page.getByRole("option", { name: "MilkDrop", exact: true }).click();
    await vi.waitFor(() => expect(draws).toBeGreaterThan(5));
    await page.screenshot({ path: path + "milkdrop.png" });
    await page.getByRole("button", { name: "Stop shared audio", exact: true }).first().click();
    await expect.poll(() => ambientAudioCaptureStore.getSnapshot().status).toBe("idle");
    expect(stream.getTracks().every((track) => track.readyState === "ended")).toBe(true);
    await page.screenshot({ path: path + "stopped.png" });
    console.log(
      JSON.stringify({
        syntheticStream: true,
        realAnalyserReads: samples,
        peak,
        realGpuDraws: draws,
        tracksStopped: true,
        iframeRetained: document.querySelector("iframe") === frame,
      }),
    );
  } finally {
    await view.unmount();
    ambientAudioCaptureStore.stop();
    localMediaStore.clear();
    tone.stop();
    for (const track of stream.getTracks()) track.stop();
    await audio.close();
    focused.mockRestore();
    chooser.mockRestore();
    read.mockRestore();
    gpu.mockRestore();
  }
});
