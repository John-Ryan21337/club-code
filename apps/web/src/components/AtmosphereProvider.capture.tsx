import "../index.css";
import { ProviderInstanceId, ProviderDriverKind, type ServerProvider } from "@cafecode/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AtmosphereConsole } from "./AtmosphereConsole";
import { WindowAtmosphere } from "./WindowAtmosphere";
import { ATMOSPHERE_CONSOLE_STORAGE_KEY } from "../atmosphereConsolePreferences";

const harness = vi.hoisted(() => {
  let settings = {} as UnifiedSettings;
  const listeners = new Set<() => void>();
  return {
    get: () => settings,
    patch: (patch: Partial<UnifiedSettings>) => {
      settings = { ...settings, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    interpret: vi.fn(),
    providers: [] as ServerProvider[],
  };
});

vi.mock("../hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    getClientSettings: harness.get,
    useSettings: <T,>(selector?: (settings: UnifiedSettings) => T) => {
      const settings = useSyncExternalStore(harness.subscribe, harness.get, harness.get);
      return selector ? selector(settings) : settings;
    },
  };
});
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: true },
    settings: harness.get(),
    providers: harness.providers,
  }),
  getServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: true },
    settings: harness.get(),
    providers: harness.providers,
  }),
  applyClientSettingsUpdated: harness.patch,
}));
vi.mock("../environments/primary", () => ({
  usePrimaryEnvironmentId: () => "synthetic-environment",
}));
vi.mock("../environments/runtime", () => {
  const connection = {
    environmentId: "synthetic-environment",
    client: {
      server: {
        getConfig: async () => ({ settings: harness.get(), providers: harness.providers }),
        interpretAtmosphereCommand: harness.interpret,
        updateClientSettings: async (patch: Partial<UnifiedSettings>) => ({
          ...harness.get(),
          ...patch,
        }),
      },
    },
  };
  return { getPrimaryEnvironmentConnection: () => connection };
});
vi.mock("../atmosphereLmStudio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../atmosphereLmStudio")>()),
  interpretAtmosphereCommandWithLmStudio: harness.interpret,
}));

const MEDIA = "../../../../docs/adoption-media/atmosphere-provider";
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

it("records explicit Claude instance/model selection with synthetic responses", async () => {
  window.localStorage.clear();
  document.documentElement.classList.add("dark");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  harness.patch({ ...DEFAULT_UNIFIED_SETTINGS, continueBackgroundAnimations: true });
  window.localStorage.setItem(
    ATMOSPHERE_CONSOLE_STORAGE_KEY,
    JSON.stringify({
      open: true,
      minimized: false,
      geometry: { x: 830, y: 260, width: 438, height: 448 },
    }),
  );
  const instanceId = ProviderInstanceId.make("claude-work");
  const driver = ProviderDriverKind.make("claudeAgent");
  harness.providers = [
    {
      instanceId,
      driver,
      installed: true,
      enabled: true,
      auth: { status: "authenticated", email: "work@example.invalid" },
      models: [{ slug: "claude-test", name: "Claude test (synthetic)" }],
    } as unknown as ServerProvider,
  ];
  harness.patch({
    providerInstances: { [instanceId]: { driver, config: { binaryPath: "selected-claude" } } },
  });
  harness.interpret.mockResolvedValue({
    instanceId,
    model: "claude-test",
    status: "completed",
    proposal: JSON.stringify({ commands: [{ kind: "set-effect", effect: "snow" }] }),
  });
  const screen = await render(
    <div style={{ minHeight: "100vh", background: "#080b10", color: "#e6edf3", padding: 24 }}>
      <WindowAtmosphere />
      <h1 style={{ fontSize: 24, position: "relative", zIndex: 20 }}>
        Optional provider atmosphere interpretation
      </h1>
      <p style={{ marginTop: 12, maxWidth: 720, position: "relative", zIndex: 20 }}>
        Real console and falling effects. Synthetic settings and model responses. No account,
        project, or provider was contacted.
      </p>
      <AtmosphereConsole />
    </div>,
  );
  try {
    await settle();
    await page.screenshot({ path: `${MEDIA}/before-local-grammar.png` });
    for (const [label, value] of [
      ["Atmosphere interpreter", "provider"],
      ["Atmosphere provider instance", "claude-work"],
      ["Atmosphere provider model", "claude-test"],
    ]) {
      const select = page.getByLabelText(label!).element() as HTMLSelectElement;
      select.value = value!;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await expect.element(page.getByLabelText(label!)).toHaveValue(value!);
    }
    await settle();
    await page.screenshot({ path: `${MEDIA}/selected-provider.png` });
    await page.getByLabelText("Falling-effect command").fill("make it feel snowy");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Confirmed: Effect snow");
    expect(harness.interpret).toHaveBeenCalledTimes(1);
    expect(harness.get().fallingEffectKind).toBe("snow");
    await settle();
    await page.screenshot({ path: `${MEDIA}/after-confirmed-snow.png` });
    await page.getByLabelText("Falling-effect command").fill("density 120");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("not a whole percentage");
    expect(harness.interpret).toHaveBeenCalledTimes(1);
    await settle();
    await page.screenshot({ path: `${MEDIA}/refusal-without-model-request.png` });
  } finally {
    await screen.unmount();
    vi.restoreAllMocks();
    window.localStorage.clear();
  }
});
