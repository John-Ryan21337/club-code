import "../index.css";
import { useSyncExternalStore } from "react";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WindowAtmosphereSettings } from "./settings/WindowAtmosphereSettings";
import { WindowAtmosphere } from "./WindowAtmosphere";
import { LocalMediaAudioVisualizer } from "./chat/LocalMediaAudioVisualizer";
import { localMediaAudioSignalStore } from "../localMediaAudioSignal";
import {
  approveSessionAudioCaptureStream,
  revokeSessionAudioCaptureStream,
} from "../localMediaAudioVisualizer";

const fixture = vi.hoisted(() => ({
  settings: {} as UnifiedSettings,
  available: true,
  listeners: new Set<() => void>(),
  serverListeners: new Set<() => void>(),
  colors: [] as string[],
}));
vi.mock("../hooks/useSettings", () => ({
  getClientSettings: () => fixture.settings,
  useUpdateSettings: () => ({ updateSettings: (patch: Partial<UnifiedSettings>) => update(patch) }),
  useSettings: <T,>(selector?: (settings: UnifiedSettings) => T) => {
    const settings = useSyncExternalStore(
      (listener) => {
        fixture.listeners.add(listener);
        return () => fixture.listeners.delete(listener);
      },
      () => fixture.settings,
    );
    return selector ? selector(settings) : settings;
  },
}));
vi.mock("../hooks/clientSettingsState", () => ({
  subscribeClientSettingsSnapshot: (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../rpc/serverState", () => ({
  getServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: fixture.available } }),
  useServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: fixture.available } }),
  onServerConfigUpdated: (listener: () => void) => {
    fixture.serverListeners.add(listener);
    return () => fixture.serverListeners.delete(listener);
  },
}));
vi.mock("../windowAtmosphere", async (importOriginal) => {
  const original = await importOriginal<typeof import("../windowAtmosphere")>();
  return {
    ...original,
    resolveMatrixAtmosphereColorFrame: (
      ...args: Parameters<typeof original.resolveMatrixAtmosphereColorFrame>
    ) => {
      const result = original.resolveMatrixAtmosphereColorFrame(...args);
      fixture.colors.push(result.color);
      if (fixture.colors.length > 64) fixture.colors.shift();
      return result;
    },
  };
});
vi.mock("../matrixWebGlRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../matrixWebGlRenderer")>();
  return {
    ...actual,
    createMatrixWebGl2Renderer: ((canvas, glyphs, options = {}) => {
      const production = actual.createMatrixWebGl2Renderer(canvas, glyphs, options);
      if (production.kind !== "canvas2d-fallback" || production.reason !== "webgl2-unavailable")
        return production;
      console.log("Production context refused; capture-only relaxed context attributes.");
      return actual.createMatrixWebGl2Renderer(canvas, glyphs, {
        ...options,
        acquireContext: (target) =>
          target.getContext("webgl2", {
            alpha: true,
            antialias: false,
            depth: false,
            desynchronized: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            stencil: false,
          }),
      });
    }) satisfies typeof actual.createMatrixWebGl2Renderer,
  };
});
const update = (patch: Partial<UnifiedSettings>) => {
  fixture.settings = { ...fixture.settings, ...patch };
  for (const listener of fixture.listeners) listener();
};

it("shows actual audio-driven GPU and Canvas palettes with explicit synthetic source admission", async () => {
  await page.viewport(1360, 850);
  document.documentElement.classList.add("dark");
  fixture.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    fallingEffectsEnabled: true,
    fallingEffectKind: "matrix",
    fallingEffectMatrixColorMode: "fixed",
    fallingEffectDensity: 160,
    fallingEffectOpacity: 0.8,
  };
  fixture.available = true;
  fixture.colors.length = 0;
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const context = new AudioContext();
  const source = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  source.frequency.value = 220;
  source.connect(destination);
  source.start();
  const stream = destination.stream;
  let draws = 0;
  const originalDraw = WebGL2RenderingContext.prototype.drawArraysInstanced;
  const draw = vi
    .spyOn(WebGL2RenderingContext.prototype, "drawArraysInstanced")
    .mockImplementation(function (this: WebGL2RenderingContext, ...args) {
      draws++;
      originalDraw.apply(this, args);
    });
  const view = await render(
    <div className="h-[810px] w-full">
      <WindowAtmosphere />
      <section className="fixed left-8 top-8 z-50 max-w-[430px] rounded-xl border bg-card/95 p-6 text-foreground">
        <h1 className="text-xl font-semibold">Matrix music colors</h1>
        <p className="mt-3 text-sm">
          Real settings, stream analysis and GPU glyph rendering. This fixture supplies a generated
          silent tone. Browser output is muted.
        </p>
        <p className="mt-3 text-sm">
          Capture-only WebGL attributes permit software rendering; production keeps its Canvas
          fallback. No microphone, chooser, user audio or account was accessed.
        </p>
        <button
          className="mt-5 rounded border px-3 py-2"
          onClick={() => {
            void context.resume().then(() => approveSessionAudioCaptureStream(stream));
          }}
        >
          Start synthetic source
        </button>
      </section>
      <section className="fixed right-8 top-8 z-50 max-h-[770px] w-[780px] overflow-y-auto rounded-xl border bg-card/95 p-5 text-foreground">
        <WindowAtmosphereSettings />
      </section>
      <LocalMediaAudioVisualizer enabled={false} mediaElement={null} mediaStream={stream} />
    </div>,
  );
  const path = "../../../../docs/pr-assets/matrix-music/";
  const canvas = () =>
    document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]');
  try {
    await expect.poll(() => draws).toBeGreaterThan(5);
    expect(localMediaAudioSignalStore.getSnapshot().active).toBe(false);
    await page.screenshot({ path: path + "before.png" });
    await page.getByRole("button", { name: "Start synthetic source" }).click();
    await page.getByText("Music", { exact: true }).click();
    await expect.poll(() => localMediaAudioSignalStore.getSnapshot().level).toBeGreaterThan(0);
    await expect.poll(() => fixture.colors.some((color) => color.startsWith("hsl("))).toBe(true);
    await page.screenshot({ path: path + "music.png" });
    await page.getByText("Music Extra", { exact: true }).click();
    await expect
      .poll(() => fixture.settings.fallingEffectMatrixColorMode)
      .toBe("music-reactive-extra");
    await page.screenshot({ path: path + "extra.png" });
    const gpu = document.querySelector<HTMLCanvasElement>(
      '[data-testid="window-atmosphere-matrix-gpu"]',
    );
    const gl = gpu?.getContext("webgl2");
    expect(gl?.getError()).toBe(0);
    const loss = gl?.getExtension("WEBGL_lose_context");
    expect(loss).not.toBeNull();
    loss?.loseContext();
    await expect.poll(() => canvas()?.dataset.atmosphereRenderer).toBe("canvas2d");
    await page.screenshot({ path: path + "canvas.png" });
    await page.getByText("Fixed", { exact: true }).click();
    await expect.poll(() => localMediaAudioSignalStore.getSnapshot().active).toBe(false);
    await page.screenshot({ path: path + "stopped.png" });
    console.log(
      JSON.stringify({
        syntheticAudio: true,
        actualGpuDraws: draws,
        realCanvasFallback: true,
        signalRevoked: true,
      }),
    );
  } finally {
    await view.unmount();
    revokeSessionAudioCaptureStream(stream);
    source.stop();
    for (const track of stream.getTracks()) track.stop();
    await context.close();
    focus.mockRestore();
    draw.mockRestore();
  }
});
