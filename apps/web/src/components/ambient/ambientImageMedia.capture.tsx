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
import { page, userEvent } from "vitest/browser";
import { afterAll, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AmbientImageLayer } from "../../ambient/AmbientImageLayer";
import { __resetLocalApiForTests } from "../../localApi";
import { AmbientImageSettingsSection } from "../settings/AmbientImageSettings";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";

/**
 * PR media capture — not a test of behavior.
 *
 * Renders the real `AmbientImageSettingsSection` and the real
 * `AmbientImageLayer` over a mock app shell, drives a synthetic file selection
 * through the actual component, and writes the before/after stills used in
 * `docs/pr-assets/ambient-images/`. The WebM of the same run is recorded by the
 * Playwright context configured in `apps/web/vitest.capture.config.ts`.
 *
 * Synthetic everywhere: the `File` objects are built here, the ambient-media
 * HTTP surface is a stubbed `fetch` plus a dev-server middleware that generates
 * gradient PNGs from the requested id, and `updateClientSettings` is a mock
 * holding one in-memory settings document. No OS picker, no user file and no
 * Cafe backend is involved.
 */
const DOCS = "../../../../../docs/pr-assets/ambient-images";

const assetFor = (hexSeed: string): AmbientImageAsset => {
  const id = `sha256-${hexSeed.repeat(64).slice(0, 64)}.png`;
  return {
    id,
    url: `/api/ambient-media/image/${id}`,
    mimeType: "image/png",
    width: 960,
    height: 600,
    sizeBytes: 262_144,
  } as AmbientImageAsset;
};

const syntheticAssets = ["a", "b", "c"].map(assetFor);
const syntheticFiles = ["dune-ridge.png", "harbour-fog.png", "pine-dusk.png"].map(
  (name) => new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/png" }),
);

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

/** Fake Cafe backend: one in-memory settings document, uploads answered locally. */
function installFakeBackend() {
  let saved: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS };
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

  let uploads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/ambient-media/image" && init?.method === "POST") {
        const asset = syntheticAssets[uploads++ % syntheticAssets.length]!;
        // A visible pause so the recording shows the upload actually running.
        await new Promise((resolve) => setTimeout(resolve, 450));
        return new Response(JSON.stringify({ ambientImage: asset }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname.startsWith("/api/ambient-media/image/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ removed: true }), { status: 200 });
      }
      throw new Error(`Unhandled capture fetch ${url.pathname}`);
    }),
  );
}

/** Mock app shell: opaque chrome with real-looking copy, so the overlay's
 * readability and stacking are judged against something representative. */
function MockAppShell() {
  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-border bg-card p-4">
        <div className="text-sm font-semibold">Cafe Code</div>
        <div className="text-muted-foreground text-xs uppercase tracking-wider">Threads</div>
        <div className="rounded-md bg-accent px-2.5 py-2 text-sm">Ambient images slice</div>
        <div className="px-2.5 py-2 text-sm text-muted-foreground">Route admission review</div>
        <div className="px-2.5 py-2 text-sm text-muted-foreground">Docs: test evidence</div>
        <div className="mt-auto text-[11px] text-muted-foreground">
          Mock shell — synthetic capture
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="text-sm font-medium">Ambient images slice</div>
          <div className="text-muted-foreground text-xs">claude · local environment</div>
        </header>
        <div className="flex-1 space-y-3 overflow-hidden p-5">
          <div className="max-w-xl rounded-xl border border-border bg-card p-3 text-sm">
            Add three images, then turn the ambient layer on.
          </div>
          <div className="max-w-xl rounded-xl bg-accent p-3 text-sm">
            The layer paints over app content and stays click-through, so the composer below keeps
            working while an image is showing.
          </div>
          <div className="max-w-xl rounded-xl border border-border bg-card p-3 text-sm">
            Images in this capture are generated gradients, not real user files.
          </div>
        </div>
        <div className="border-t border-border p-4">
          <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
            Message Cafe Code…
          </div>
        </div>
      </main>

      <section className="w-[26rem] shrink-0 overflow-y-auto border-l border-border bg-background p-4">
        <div className="mb-3 text-sm font-semibold">Settings · Ambiance</div>
        <AmbientImageSettingsSection />
      </section>
    </div>
  );
}

const selectSyntheticFiles = () => {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="ambient-image-file-input"]',
  )!;
  const transfer = new DataTransfer();
  for (const file of syntheticFiles) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "nativeApi");
  resetServerStateForTests();
  resetAppAtomRegistryForTests();
  await __resetLocalApiForTests();
});

it("captures ambient images before and after a synthetic library upload", async () => {
  resetAppAtomRegistryForTests();
  resetServerStateForTests();
  await __resetLocalApiForTests();
  installFakeBackend();

  await render(
    <AppAtomRegistryProvider>
      <AmbientImageLayer />
      <MockAppShell />
    </AppAtomRegistryProvider>,
  );

  // Before: default profile — the feature is off and the library is empty.
  await settle(600);
  await page.screenshot({ path: `${DOCS}/ambient-images-before.png`, save: true });

  // Turn the feature on first, so the recording shows the layer appearing the
  // moment the first image lands.
  await userEvent.click(document.querySelector('[aria-label="Enable ambient image"]')!);
  await settle(400);

  selectSyntheticFiles();
  await vi.waitFor(
    () => expect(document.querySelector('[data-testid="ambient-image-notice"]')).not.toBeNull(),
    { timeout: 15_000 },
  );
  await settle(700);

  // Theater mode, so the still shows the full-window wash over app content.
  const presentation = document.querySelector<HTMLSelectElement>(
    '[aria-label="Ambient image presentation"]',
  )!;
  presentation.value = "theater";
  presentation.dispatchEvent(new Event("change", { bubbles: true }));

  await vi.waitFor(() =>
    expect(
      document
        .querySelector('[data-testid="ambient-image-layer"]')
        ?.getAttribute("data-ambient-image-mode"),
    ).toBe("theater"),
  );
  // Let the decoded gradient paint before the still is taken.
  await settle(900);
  await page.screenshot({ path: `${DOCS}/ambient-images-after.png`, save: true });

  // A last beat of interaction for the video: rotation on, then one removal.
  await userEvent.click(document.querySelector('[aria-label="Enable ambient image cycling"]')!);
  await settle(900);
  const firstRemove = document
    .querySelector('[data-testid="ambient-image-grid"] > div')
    ?.querySelectorAll("button")[1];
  if (firstRemove) await userEvent.click(firstRemove);
  await settle(1_200);
}, 60_000);
