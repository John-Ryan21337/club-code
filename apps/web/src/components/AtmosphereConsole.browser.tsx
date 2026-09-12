// The panel positions itself with fixed-position utility classes, so the real
// stylesheet has to be loaded for geometry assertions to mean anything.
import "../index.css";
import type { EnvironmentId } from "@cafecode/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_FALLING_EFFECT_DENSITY,
  type ClientSettings,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  ATMOSPHERE_CONSOLE_STORAGE_KEY,
  useAtmosphereConsolePreferences,
} from "../atmosphereConsolePreferences";
import { AtmosphereConsole } from "./AtmosphereConsole";

const harness = vi.hoisted(() => {
  let environmentId: EnvironmentId | null = "env-alpha" as EnvironmentId;
  const listeners = new Set<() => void>();
  return {
    settings: {} as UnifiedSettings,
    atmosphereAvailable: true,
    connection: { environmentId: "env-alpha" as EnvironmentId },
    applyClientSettingsUpdated: vi.fn(),
    updateClientSettings: vi.fn(),
    interpret: vi.fn(),
    getEnvironmentId: () => environmentId,
    setEnvironmentId: (next: EnvironmentId | null) => {
      environmentId = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("../atmosphereLmStudio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../atmosphereLmStudio")>()),
  interpretAtmosphereCommandWithLmStudio: harness.interpret,
}));

vi.mock("../hooks/useSettings", () => ({
  getClientSettings: () => harness.settings,
  useSettings: <T,>(selector?: (settings: UnifiedSettings) => T) =>
    selector ? selector(harness.settings) : harness.settings,
}));

vi.mock("../rpc/serverState", () => ({
  getServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: harness.atmosphereAvailable },
  }),
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: harness.atmosphereAvailable },
  }),
  applyClientSettingsUpdated: (settings: ClientSettings) =>
    harness.applyClientSettingsUpdated(settings),
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: () => ({
    server: { updateClientSettings: harness.updateClientSettings },
  }),
}));

vi.mock("../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () =>
    Object.assign(harness.connection, {
      client: { server: { updateClientSettings: harness.updateClientSettings } },
    }),
}));

vi.mock("../environments/primary", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePrimaryEnvironmentId: () =>
      useSyncExternalStore(harness.subscribe, harness.getEnvironmentId, harness.getEnvironmentId),
  };
});

function openConsole(geometry: unknown = null): void {
  window.localStorage.setItem(
    ATMOSPHERE_CONSOLE_STORAGE_KEY,
    JSON.stringify({ open: true, minimized: false, geometry }),
  );
}

function ConsolePreferenceOpener() {
  const [preferences, setPreferences] = useAtmosphereConsolePreferences();
  return (
    <button
      onClick={() => setPreferences((current) => ({ ...current, open: true, minimized: false }))}
    >
      Open from settings {preferences.open ? "open" : "closed"}
    </button>
  );
}

function panel(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-testid="atmosphere-console"]')!;
}

function storedPreferences(): {
  geometry: { x: number; width: number; height: number } | null;
  open: boolean;
} {
  return JSON.parse(window.localStorage.getItem(ATMOSPHERE_CONSOLE_STORAGE_KEY)!);
}

function focus(label: string): void {
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.focus();
}

async function apply(request: string): Promise<void> {
  const field = page.getByLabelText("Falling-effect command");
  await field.fill(request);
  await page.getByRole("button", { name: "Apply" }).click();
}

async function chooseLocalModel(): Promise<void> {
  const select = page.getByLabelText("Atmosphere interpreter").element() as HTMLSelectElement;
  select.value = "lm-studio";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await expect
    .element(page.getByTestId("atmosphere-console-status"))
    .toHaveTextContent("Unrecognized wording goes to LM Studio");
}

describe("AtmosphereConsole", () => {
  beforeEach(() => {
    window.localStorage.clear();
    harness.settings = { ...DEFAULT_UNIFIED_SETTINGS };
    harness.atmosphereAvailable = true;
    harness.connection = { environmentId: "env-alpha" as EnvironmentId };
    harness.applyClientSettingsUpdated.mockReset();
    harness.updateClientSettings.mockReset();
    harness.interpret.mockReset();
    harness.setEnvironmentId("env-alpha" as EnvironmentId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("stays closed by default and renders nothing at the root", async () => {
    const screen = await render(<AtmosphereConsole />);
    expect(document.querySelector('[data-testid="atmosphere-console"]')).toBeNull();
    await screen.unmount();
  });

  it("opens without enabling any effect until a command is applied", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);

    await expect.element(page.getByTestId("atmosphere-console")).toBeInTheDocument();
    expect(harness.updateClientSettings).not.toHaveBeenCalled();
    expect(harness.applyClientSettingsUpdated).not.toHaveBeenCalled();
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Local commands only.");

    await screen.unmount();
  });

  it.each(["full", "denied"])(
    "keeps shared open, minimize and close controls usable when preference storage is %s",
    async (failure) => {
      if (failure === "denied") {
        const originalGet = Storage.prototype.getItem;
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
          if (key === ATMOSPHERE_CONSOLE_STORAGE_KEY)
            throw new DOMException("Fixture denial", "SecurityError");
          return originalGet.call(this, key);
        });
      }
      const screen = await render(
        <>
          <ConsolePreferenceOpener />
          <AtmosphereConsole />
        </>,
      );
      const originalSet = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(
        function (this: Storage, key, value) {
          if (key === ATMOSPHERE_CONSOLE_STORAGE_KEY)
            throw new DOMException("Fixture quota", "QuotaExceededError");
          originalSet.call(this, key, value);
        },
      );
      try {
        await page.getByRole("button", { name: "Open from settings closed" }).click();
        await expect.element(page.getByTestId("atmosphere-console")).toBeInTheDocument();
        await page.getByLabelText("Minimize atmosphere console").click();
        await expect.element(page.getByLabelText("Restore atmosphere console")).toBeInTheDocument();
        await page.getByLabelText("Close atmosphere console").click();
        await expect
          .element(page.getByRole("button", { name: "Open from settings closed" }))
          .toBeInTheDocument();
        expect(document.querySelector('[data-testid="atmosphere-console"]')).toBeNull();
        expect(harness.updateClientSettings).not.toHaveBeenCalled();
      } finally {
        await screen.unmount();
      }
    },
  );

  it("updates mounted controls from another tab and safely resets malformed stored preferences", async () => {
    const screen = await render(
      <>
        <ConsolePreferenceOpener />
        <AtmosphereConsole />
      </>,
    );
    try {
      openConsole();
      window.dispatchEvent(new StorageEvent("storage", { key: ATMOSPHERE_CONSOLE_STORAGE_KEY }));
      await expect.element(page.getByTestId("atmosphere-console")).toBeInTheDocument();
      window.localStorage.setItem(ATMOSPHERE_CONSOLE_STORAGE_KEY, "x".repeat(4_097));
      window.dispatchEvent(new StorageEvent("storage", { key: ATMOSPHERE_CONSOLE_STORAGE_KEY }));
      await expect
        .element(page.getByRole("button", { name: "Open from settings closed" }))
        .toBeInTheDocument();
      expect(document.querySelector('[data-testid="atmosphere-console"]')).toBeNull();
      await page.getByRole("button", { name: "Open from settings closed" }).click();
      await expect.element(page.getByTestId("atmosphere-console")).toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps model interpretation off by default", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);
    await expect.element(page.getByLabelText("Atmosphere interpreter")).toHaveValue("local");
    await apply("make it feel snowy");
    expect(harness.interpret).not.toHaveBeenCalled();
    expect(harness.updateClientSettings).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("uses the local parser first even when LM Studio is selected", async () => {
    openConsole();
    harness.updateClientSettings.mockResolvedValue({
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "snow",
    });
    const screen = await render(<AtmosphereConsole />);
    await chooseLocalModel();
    await apply("snow");
    expect(harness.interpret).not.toHaveBeenCalled();
    expect(harness.updateClientSettings).toHaveBeenCalledWith({
      fallingEffectsEnabled: true,
      fallingEffectKind: "snow",
    });
    await screen.unmount();
  });

  it("saves a supported local-model proposal only after explicit opt-in", async () => {
    openConsole();
    harness.interpret.mockResolvedValue([{ kind: "set-effect", effect: "snow" }]);
    harness.updateClientSettings.mockResolvedValue({
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "snow",
    });
    const screen = await render(<AtmosphereConsole />);
    await chooseLocalModel();
    await apply("make it feel snowy");
    expect(harness.interpret).toHaveBeenCalledTimes(1);
    expect(harness.interpret.mock.calls[0]?.[0]).toBe("make it feel snowy");
    expect(harness.updateClientSettings).toHaveBeenCalledWith({
      fallingEffectsEnabled: true,
      fallingEffectKind: "snow",
    });
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Confirmed: Effect snow.");
    await screen.unmount();
  });

  it("does not apply a late proposal after the server withdraws the capability", async () => {
    openConsole();
    let release!: (value: unknown) => void;
    harness.interpret.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const screen = await render(<AtmosphereConsole />);
    await chooseLocalModel();
    await apply("make it feel snowy");
    harness.atmosphereAvailable = false;
    release([{ kind: "set-effect", effect: "snow" }]);
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("has not enabled");
    expect(harness.updateClientSettings).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("describes model use truthfully after opting in", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);
    await chooseLocalModel();
    expect(panel().textContent).not.toContain("No model or shell is used");
    expect(panel().querySelector("section > p")?.textContent).toContain("LM Studio");
    await screen.unmount();
  });

  it("keeps the command reachable through scrolling in a short console", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(180);
    openConsole();
    const screen = await render(<AtmosphereConsole />);
    const form = panel().querySelector("form")!;
    expect(form.scrollHeight).toBeGreaterThan(form.clientHeight);
    expect(getComputedStyle(form).overflowY).toBe("auto");
    const button = page.getByRole("button", { name: "Apply" }).element();
    button.scrollIntoView({ block: "nearest" });
    const visible = form.getBoundingClientRect();
    const control = button.getBoundingClientRect();
    expect(control.top).toBeGreaterThanOrEqual(visible.top);
    expect(control.bottom).toBeLessThanOrEqual(visible.bottom);
    await screen.unmount();
  });

  it("uses current settings for a relative proposal after interpretation finishes", async () => {
    openConsole();
    let release!: (value: unknown) => void;
    harness.interpret.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    harness.updateClientSettings.mockResolvedValue({
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY,
    });
    const screen = await render(<AtmosphereConsole />);
    await chooseLocalModel();
    await apply("make it more dense");
    harness.settings = { ...harness.settings, fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY };
    release([{ kind: "adjust", property: "density", direction: "increase" }]);
    await vi.waitFor(() =>
      expect(harness.updateClientSettings).toHaveBeenCalledWith({
        fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY,
      }),
    );
    await screen.unmount();
  });

  it.each(["density 120", "snow and next song", "snow, rain"])(
    "does not send a local validation refusal to a model: %s",
    async (request) => {
      openConsole();
      const screen = await render(<AtmosphereConsole />);
      await chooseLocalModel();
      await apply(request);
      expect(harness.interpret).not.toHaveBeenCalled();
      expect(harness.updateClientSettings).not.toHaveBeenCalled();
      await screen.unmount();
    },
  );

  it.each(["unmount", "environment", "connection"])(
    "ignores a late model proposal after %s changes",
    async (ending) => {
      openConsole();
      let release!: (value: unknown) => void;
      let signal!: AbortSignal;
      harness.interpret.mockImplementation((_input: string, nextSignal: AbortSignal) => {
        signal = nextSignal;
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const screen = await render(<AtmosphereConsole />);
      await chooseLocalModel();
      await apply("make it feel snowy");
      if (ending === "unmount") await screen.unmount();
      else if (ending === "environment") {
        harness.setEnvironmentId("env-beta" as EnvironmentId);
        await expect
          .element(page.getByTestId("atmosphere-console-status"))
          .toHaveTextContent("primary environment changed");
      } else harness.connection = { environmentId: "env-alpha" as EnvironmentId };
      if (ending !== "connection") expect(signal.aborted).toBe(true);
      release([{ kind: "set-effect", effect: "snow" }]);
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      expect(harness.updateClientSettings).not.toHaveBeenCalled();
      if (ending !== "unmount") await screen.unmount();
    },
  );

  it("reports the settings the confirming write returned", async () => {
    openConsole();
    harness.updateClientSettings.mockImplementation(async () => ({
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    }));
    const screen = await render(<AtmosphereConsole />);

    await apply("matrix");

    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Confirmed: Effect matrix.");
    expect(harness.updateClientSettings).toHaveBeenCalledWith({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
    expect(harness.applyClientSettingsUpdated).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it("refuses a mixed request without writing anything", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);

    await apply("snow and next song");

    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("media playback");
    expect(harness.updateClientSettings).not.toHaveBeenCalled();

    await screen.unmount();
  });

  it("reports an unconfirmed write without claiming that the server made no change", async () => {
    openConsole();
    harness.updateClientSettings.mockRejectedValue(new Error("settings write refused"));
    const screen = await render(<AtmosphereConsole />);

    await apply("matrix");

    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Check Appearance before sending another command");
    expect(page.getByTestId("atmosphere-console-status").element().textContent).not.toContain(
      "nothing was applied",
    );
    expect(harness.applyClientSettingsUpdated).not.toHaveBeenCalled();
    // The request stays in the field so the operator can retry it.
    await expect.element(page.getByLabelText("Falling-effect command")).toHaveValue("matrix");

    await screen.unmount();
  });

  it("refuses to apply when the server has not enabled the atmosphere capability", async () => {
    openConsole();
    harness.atmosphereAvailable = false;
    const screen = await render(<AtmosphereConsole />);

    await apply("matrix");

    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("has not enabled the window atmosphere capability");
    expect(harness.updateClientSettings).not.toHaveBeenCalled();

    await screen.unmount();
  });

  it("discards a late acknowledgement after the primary environment changes", async () => {
    openConsole();
    let release: ((settings: ClientSettings) => void) | undefined;
    harness.updateClientSettings.mockImplementation(
      () =>
        new Promise<ClientSettings>((resolve) => {
          release = resolve;
        }),
    );
    const screen = await render(<AtmosphereConsole />);

    await apply("matrix");
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("Applying…");

    harness.setEnvironmentId("env-beta" as EnvironmentId);
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("primary environment changed");

    release?.({
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
    await vi.waitFor(() => {
      expect(harness.applyClientSettingsUpdated).not.toHaveBeenCalled();
    });
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("primary environment changed");
    await expect.element(page.getByRole("button", { name: "Apply" })).toBeDisabled();

    await screen.unmount();
  });

  it("ignores confirmation from a replaced connection with the same environment ID", async () => {
    openConsole();
    let release!: (settings: ClientSettings) => void;
    harness.updateClientSettings.mockImplementation(
      () =>
        new Promise<ClientSettings>((resolve) => {
          release = resolve;
        }),
    );
    const screen = await render(<AtmosphereConsole />);
    await apply("matrix");
    harness.connection = { environmentId: "env-alpha" as EnvironmentId };
    release({ ...DEFAULT_UNIFIED_SETTINGS, fallingEffectsEnabled: true });
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("connection changed");
    expect(harness.applyClientSettingsUpdated).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("admits only one write when two submit events arrive before a repaint", async () => {
    openConsole();
    harness.updateClientSettings.mockImplementation(() => new Promise(() => {}));
    const screen = await render(<AtmosphereConsole />);
    await page.getByLabelText("Falling-effect command").fill("matrix");
    const form = panel().querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(harness.updateClientSettings).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it.each(["blur", "reset", "minimize", "unmount"])(
    "releases pointer capture on %s",
    async (ending) => {
      openConsole();
      const screen = await render(<AtmosphereConsole />);
      const move = page.getByLabelText("Move atmosphere console").element() as HTMLButtonElement;
      vi.spyOn(move, "setPointerCapture").mockImplementation(() => {});
      vi.spyOn(move, "hasPointerCapture").mockReturnValue(true);
      const release = vi.spyOn(move, "releasePointerCapture").mockImplementation(() => {});
      move.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, button: 0 }),
      );
      if (ending === "blur") window.dispatchEvent(new Event("blur"));
      if (ending === "reset")
        await page.getByLabelText("Reset atmosphere console position").click();
      if (ending === "minimize") await page.getByLabelText("Minimize atmosphere console").click();
      if (ending === "unmount") await screen.unmount();
      expect(release).toHaveBeenCalledWith(7);
      if (ending !== "unmount") await screen.unmount();
    },
  );

  it("fits the panel when the viewport is smaller than its preferred minimum", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(180);
    openConsole();
    const screen = await render(<AtmosphereConsole />);
    const rect = panel().getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(280);
    expect(rect.bottom).toBeLessThanOrEqual(180);
    await screen.unmount();
  });

  it.each(["Win32", "MacIntel"])(
    "reserves only the Windows desktop caption band on %s",
    async (platform) => {
      const original = Object.getOwnPropertyDescriptor(navigator, "windowControlsOverlay");
      const listeners = new Set<EventListener>();
      let height = 64;
      vi.stubGlobal("desktopBridge", {});
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      Object.defineProperty(navigator, "windowControlsOverlay", {
        configurable: true,
        value: {
          visible: true,
          getTitlebarAreaRect: () => ({ y: 0, height }),
          addEventListener: (_: string, listener: EventListener) => listeners.add(listener),
          removeEventListener: (_: string, listener: EventListener) => listeners.delete(listener),
        },
      });
      try {
        openConsole({ x: 12, y: 0, width: 372, height: 268 });
        const screen = await render(<AtmosphereConsole />);
        expect(panel().getBoundingClientRect().top).toBe(platform === "Win32" ? 76 : 12);
        height = 80;
        for (const listener of listeners) listener(new Event("geometrychange"));
        await vi.waitFor(() =>
          expect(panel().getBoundingClientRect().top).toBe(platform === "Win32" ? 92 : 12),
        );
        await screen.unmount();
        expect(listeners.size).toBe(0);
      } finally {
        if (original) Object.defineProperty(navigator, "windowControlsOverlay", original);
        else Reflect.deleteProperty(navigator, "windowControlsOverlay");
      }
    },
  );

  it("refuses submission from a render that belongs to the previous environment", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);
    harness.connection = { environmentId: "env-beta" as EnvironmentId };
    await apply("matrix");
    expect(harness.updateClientSettings).not.toHaveBeenCalled();
    await expect
      .element(page.getByTestId("atmosphere-console-status"))
      .toHaveTextContent("primary environment changed");
    await screen.unmount();
  });

  it("moves and resizes with the keyboard and restores the default placement", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);

    const defaultLeft = panel().getBoundingClientRect().left;

    focus("Move atmosphere console");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await vi.waitFor(() => {
      expect(panel().getBoundingClientRect().left).toBeLessThan(defaultLeft);
    });

    const beforeResize = panel().getBoundingClientRect().width;
    focus("Resize atmosphere console");
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => {
      expect(panel().getBoundingClientRect().width).toBeGreaterThan(beforeResize);
    });

    await page.getByLabelText("Reset atmosphere console position").click();
    await vi.waitFor(() => {
      expect(storedPreferences().geometry).toBeNull();
      expect(panel().getBoundingClientRect().left).toBeCloseTo(defaultLeft, 0);
    });

    await screen.unmount();
  });

  it("keeps a stored rectangle from earlier sessions inside the viewport", async () => {
    openConsole({ x: 99_000, y: 99_000, width: 12_000, height: 12_000 });
    const screen = await render(<AtmosphereConsole />);

    const rect = panel().getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);

    await screen.unmount();
  });

  it("minimizes to its header and restores the command field", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);

    await page.getByLabelText("Minimize atmosphere console").click();
    await expect.element(page.getByLabelText("Falling-effect command")).not.toBeInTheDocument();

    await page.getByLabelText("Restore atmosphere console").click();
    await expect.element(page.getByLabelText("Falling-effect command")).toBeInTheDocument();

    await screen.unmount();
  });

  it("preserves the expanded size when the minimized header is dragged", async () => {
    openConsole({ x: 80, y: 80, width: 400, height: 320 });
    const screen = await render(<AtmosphereConsole />);
    const expandedHeight = panel().getBoundingClientRect().height;
    await page.getByLabelText("Minimize atmosphere console").click();
    const move = page.getByLabelText("Move atmosphere console").element() as HTMLButtonElement;
    vi.spyOn(move, "setPointerCapture").mockImplementation(() => {});
    vi.spyOn(move, "hasPointerCapture").mockReturnValue(true);
    vi.spyOn(move, "releasePointerCapture").mockImplementation(() => {});
    move.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 8,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 8, clientX: 140, clientY: 120 }),
    );
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8 }));
    await page.getByLabelText("Restore atmosphere console").click();
    expect(panel().getBoundingClientRect().height).toBe(expandedHeight);
    expect(storedPreferences().geometry?.height).toBe(expandedHeight);
    await screen.unmount();
  });

  it("closes to nothing and can be reopened from the stored preference", async () => {
    openConsole();
    const screen = await render(<AtmosphereConsole />);

    await page.getByLabelText("Close atmosphere console").click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="atmosphere-console"]')).toBeNull();
      expect(storedPreferences().open).toBe(false);
    });
    await screen.unmount();

    openConsole();
    const reopened = await render(<AtmosphereConsole />);
    await expect.element(page.getByTestId("atmosphere-console")).toBeInTheDocument();
    await reopened.unmount();
  });

  it("abandons an in-flight confirmation when the console unmounts", async () => {
    openConsole();
    let release: ((settings: ClientSettings) => void) | undefined;
    harness.updateClientSettings.mockImplementation(
      () =>
        new Promise<ClientSettings>((resolve) => {
          release = resolve;
        }),
    );
    const screen = await render(<AtmosphereConsole />);

    await apply("matrix");
    await screen.unmount();

    release?.({ ...DEFAULT_UNIFIED_SETTINGS, fallingEffectsEnabled: true });
    await vi.waitFor(() => {
      expect(harness.applyClientSettingsUpdated).not.toHaveBeenCalled();
    });
    expect(document.querySelector('[data-testid="atmosphere-console"]')).toBeNull();
  });
});
