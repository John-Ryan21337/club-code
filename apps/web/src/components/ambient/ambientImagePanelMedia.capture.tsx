import "../../index.css";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ClientSettings,
  type LocalApi,
  type ServerConfig,
} from "@cafecode/contracts";
import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { page } from "vitest/browser";
import { afterAll, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AmbientImageLayer } from "../../ambient/AmbientImageLayer";
import { AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY } from "../../ambientImageGeometry";
import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { AmbientImagePanelSettingsRows } from "../settings/AmbientImagePanelSettings";
import { SettingsSection } from "../settings/settingsLayout";

/**
 * PR media capture — not a test of behavior.
 *
 * Renders the real `AmbientImageLayer` and the real
 * `AmbientImagePanelSettingsRows` over a mock app shell, drives the real panel
 * handles, and writes the before/after stills for
 * `docs/pr-assets/ambient-image-panel/`. The WebM of the same run is recorded
 * by the Playwright context in `vitest.ambient-image-panel-capture.config.ts`.
 *
 * SYNTHETIC IMAGES / FAKE BACKEND. The ambient image is a gradient PNG that the
 * dev-server middleware generates from the requested content-addressed id, and
 * `updateClientSettings` is a mock holding one in-memory settings document. No
 * user file, no user account, no OS picker and no real Cafe backend is
 * involved. See `docs/pr-assets/ambient-image-panel/README.md`.
 */
const DOCS = "../../../../../docs/pr-assets/ambient-image-panel";

const ASSET_ID = `sha256-${"5a7d".repeat(16)}.png`;
const SYNTHETIC_ASSET = {
  id: ASSET_ID,
  url: `/api/ambient-media/image/${ASSET_ID}`,
  mimeType: "image/png",
  width: 960,
  height: 600,
  sizeBytes: 262_144,
} as AmbientImageAsset;

function createServerConfig(clientSettings: ClientSettings): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-capture",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    systemPromptPath: "/repo/project/.t3code-system-prompt.md",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: false,
      otlpTracesUrl: "",
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
    clientSettings,
  } as ServerConfig;
}

/** Fake Cafe backend: one in-memory settings document, no network. */
function installFakeBackend(initial: Partial<ClientSettings>) {
  let saved: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, ...initial };
  setServerConfigSnapshot(createServerConfig(saved));
  window.nativeApi = {
    persistence: {
      getClientSettings: vi.fn().mockResolvedValue(null),
      setClientSettings: vi.fn().mockResolvedValue(undefined),
    },
    server: {
      updateClientSettings: vi.fn().mockImplementation(async (patch: Partial<ClientSettings>) => {
        saved = { ...saved, ...patch };
        return saved;
      }),
    },
  } as unknown as LocalApi;
}

/** Mock app shell: opaque chrome, so the overlay is judged against something
 * representative and the click-through claim is visible. */
function MockAppShell() {
  return (
    <div className="bg-background text-foreground flex h-[100dvh] w-full">
      <aside className="border-border bg-card flex w-60 shrink-0 flex-col gap-3 border-r p-4">
        <div className="text-sm font-semibold">Cafe Code</div>
        <div className="text-muted-foreground text-xs tracking-wider uppercase">Threads</div>
        <div className="bg-accent rounded-md px-2.5 py-2 text-sm">Ambient image panel slice</div>
        <div className="text-muted-foreground px-2.5 py-2 text-sm">Route admission review</div>
        <div className="text-muted-foreground mt-auto text-[11px]">
          Mock shell — synthetic capture
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex items-center justify-between border-b px-5 py-3">
          <div className="text-sm font-medium">Ambient image panel slice</div>
          <div className="text-muted-foreground text-xs">claude · local environment</div>
        </header>
        <div className="flex-1 space-y-3 overflow-hidden p-5">
          <div className="border-border bg-card max-w-xl rounded-xl border p-3 text-sm">
            The panel can be moved and resized with its handles, or with the arrow keys.
          </div>
          <div className="bg-accent max-w-xl rounded-xl p-3 text-sm">
            Only the four handles take pointer events. The frame and the image stay click-through,
            so the composer below keeps working while an image is showing.
          </div>
          <div className="border-border bg-card max-w-xl rounded-xl border p-3 text-sm">
            The image in this capture is a generated gradient, not a real user file.
          </div>
        </div>
        <div className="border-border border-t p-4">
          <div className="border-border bg-card text-muted-foreground rounded-xl border px-3 py-2.5 text-sm">
            Message Cafe Code…
          </div>
        </div>
      </main>
      <section className="border-border bg-background w-[26rem] shrink-0 overflow-y-auto border-l p-4">
        <div className="mb-3 text-sm font-semibold">Settings · Ambient image panel</div>
        <SettingsSection title="Ambient image panel">
          <AmbientImagePanelSettingsRows />
        </SettingsSection>
      </section>
    </div>
  );
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const query = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const panel = () => query<HTMLElement>('[data-testid="ambient-image-panel"]');

/** Drives one real pointer interaction through a handle, slowly enough to see. */
async function drag(target: HTMLElement, deltaX: number, deltaY: number, steps = 18) {
  const rect = target.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  const options = { pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true };
  target.dispatchEvent(
    new PointerEvent("pointerdown", { ...options, clientX: startX, clientY: startY }),
  );
  for (let step = 1; step <= steps; step++) {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        ...options,
        clientX: startX + (deltaX * step) / steps,
        clientY: startY + (deltaY * step) / steps,
      }),
    );
    await settle(28);
  }
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      ...options,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
    }),
  );
  await settle(220);
}

afterAll(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "nativeApi");
  window.localStorage.removeItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY);
  resetServerStateForTests();
  resetAppAtomRegistryForTests();
  await __resetLocalApiForTests();
});

it("captures the ambient image panel controls before and after adjustment", async () => {
  resetAppAtomRegistryForTests();
  resetServerStateForTests();
  window.localStorage.removeItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY);
  await __resetLocalApiForTests();
  installFakeBackend({
    ambientImageEnabled: true,
    ambientImageAsset: SYNTHETIC_ASSET,
    ambientImageCycleAssets: [SYNTHETIC_ASSET],
  });

  await render(
    <AppAtomRegistryProvider>
      <AmbientImageLayer />
      <MockAppShell />
    </AppAtomRegistryProvider>,
  );

  // Before: the preset layout, the default corner, no glow.
  await vi.waitFor(() => expect(panel()).not.toBeNull(), { timeout: 15_000 });
  await settle(900);
  await page.screenshot({ path: `${DOCS}/ambient-image-panel-before.png`, save: true });

  // Move the panel with its handle. The layout becomes Custom.
  await drag(query<HTMLElement>('[data-testid="ambient-image-move-handle"]'), -430, -240);
  await vi.waitFor(() => expect(panel().dataset["ambientImageLayout"]).toBe("custom"));

  // Resize the panel with its handle.
  await drag(query<HTMLElement>('[data-testid="ambient-image-resize-handle"]'), 180, 0, 12);

  // Turn the glow on through the real settings row.
  const glowSwitch = query<HTMLElement>('[aria-label="Enable ambient image glow"]');
  glowSwitch.click();
  await settle(700);

  // After: a moved, resized, glowing panel over the same app shell.
  await settle(500);
  await page.screenshot({ path: `${DOCS}/ambient-image-panel-after.png`, save: true });

  // A last beat for the video: keyboard nudges, then the reset control.
  const move = query<HTMLElement>('[data-testid="ambient-image-move-handle"]');
  move.focus();
  for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown"]) {
    move.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await settle(260);
  }
  query<HTMLElement>('[data-testid="ambient-image-reset-button"]').click();
  await settle(1_200);
}, 90_000);
