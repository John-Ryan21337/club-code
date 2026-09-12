import "../index.css";
import { useSyncExternalStore } from "react";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
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
const update = (patch: Partial<UnifiedSettings>) => {
  fixture.settings = { ...fixture.settings, ...patch };
  for (const listener of fixture.listeners) listener();
};

it("feeds the actual atmosphere from explicit approved silent analysis and revokes it synchronously", async () => {
  fixture.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    fallingEffectsEnabled: true,
    fallingEffectKind: "matrix",
    fallingEffectMatrixColorMode: "music-reactive",
  };
  fixture.available = true;
  fixture.colors.length = 0;
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const context = new AudioContext(),
    source = context.createOscillator(),
    destination = context.createMediaStreamDestination();
  source.connect(destination);
  source.start();
  const stream = destination.stream;
  const view = await render(
    <div>
      <button
        onClick={() => {
          void context.resume().then(() => {
            approveSessionAudioCaptureStream(stream);
            update({ fallingEffectMatrixColorMode: "music-reactive-extra" });
          });
        }}
      >
        Approve synthetic audio
      </button>
      <WindowAtmosphere />
      <div className="relative h-40">
        <LocalMediaAudioVisualizer enabled={false} mediaElement={null} mediaStream={stream} />
      </div>
    </div>,
  );
  try {
    await expect.poll(() => fixture.colors.length).toBeGreaterThan(1);
    expect(localMediaAudioSignalStore.getSnapshot().active).toBe(false);
    expect(fixture.colors.every((color) => color === "#4ade80")).toBe(true);
    await page.getByRole("button", { name: "Approve synthetic audio" }).click();
    await expect.poll(() => localMediaAudioSignalStore.getSnapshot().level).toBeGreaterThan(0);
    await expect.poll(() => fixture.colors.some((color) => color.startsWith("hsl("))).toBe(true);
    update({ fallingEffectMatrixColorMode: "fixed" });
    expect(localMediaAudioSignalStore.getSnapshot().active).toBe(false);
    update({ fallingEffectMatrixColorMode: "music-reactive" });
    await expect.poll(() => localMediaAudioSignalStore.getSnapshot().active).toBe(true);
    fixture.available = false;
    for (const listener of fixture.serverListeners) listener();
    expect(localMediaAudioSignalStore.getSnapshot().active).toBe(false);
  } finally {
    await view.unmount();
    revokeSessionAudioCaptureStream(stream);
    source.stop();
    for (const track of stream.getTracks()) track.stop();
    await context.close();
    focus.mockRestore();
  }
  expect(localMediaAudioSignalStore.getSnapshot().active).toBe(false);
});
