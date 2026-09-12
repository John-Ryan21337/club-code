import "../index.css";
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
  useServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: true } }),
  getServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: true } }),
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

const MEDIA = "../../../../docs/adoption-media/atmosphere-local-model";
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

it("records local-first behavior and explicit LM Studio opt-in with synthetic responses", async () => {
  window.localStorage.clear();
  document.documentElement.classList.add("dark");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  harness.patch({ ...DEFAULT_UNIFIED_SETTINGS, continueBackgroundAnimations: true });
  window.localStorage.setItem(
    ATMOSPHERE_CONSOLE_STORAGE_KEY,
    JSON.stringify({ open: true, minimized: false, geometry: null }),
  );
  harness.interpret.mockResolvedValue([
    { kind: "set-effect", effect: "snow" },
    { kind: "set-percent", property: "density", percent: 65 },
  ]);
  const screen = await render(
    <div style={{ minHeight: "100vh", background: "#080b10", color: "#e6edf3", padding: 24 }}>
      <WindowAtmosphere />
      <h1 style={{ fontSize: 24, position: "relative", zIndex: 20 }}>
        Optional local atmosphere interpretation
      </h1>
      <p style={{ marginTop: 12, maxWidth: 720, position: "relative", zIndex: 20 }}>
        Real console and falling effects. Synthetic settings and model responses. No LM Studio
        server, account, project, or provider was contacted.
      </p>
      <AtmosphereConsole />
    </div>,
  );
  try {
    await settle();
    await page.screenshot({ path: `${MEDIA}/before-local-grammar.png` });
    const select = page.getByLabelText("Atmosphere interpreter").element() as HTMLSelectElement;
    select.value = "lm-studio";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Only the typed request is sent");
    await settle();
    await page.screenshot({ path: `${MEDIA}/opt-in-local-model.png` });
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
