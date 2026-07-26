import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";
import { vi } from "vitest";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

function makeFakeBrowserWindow() {
  let alwaysOnTop = false;
  const webContents = {
    copyImageAt: vi.fn(),
    isLoadingMainFrame: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    openDevTools: vi.fn(),
    replaceMisspelling: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  const window = {
    focus: vi.fn(),
    isAlwaysOnTop: vi.fn(() => alwaysOnTop),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setAlwaysOnTop: vi.fn((enabled: boolean) => {
      alwaysOnTop = enabled;
    }),
    setTitle: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    show: vi.fn(),
    webContents,
  };

  return {
    window: window as unknown as Electron.BrowserWindow,
    loadURL: window.loadURL,
    openDevTools: webContents.openDevTools,
    focus: window.focus,
    isAlwaysOnTop: window.isAlwaysOnTop,
    setAlwaysOnTop: window.setAlwaysOnTop,
  };
}

const desktopAssetsLayer = Layer.succeed(DesktopAssets.DesktopAssets, {
  iconPaths: Effect.succeed({
    ico: Option.none<string>(),
    icns: Option.none<string>(),
    png: Option.none<string>(),
  }),
  resolveResourcePath: () => Effect.succeed(Option.none<string>()),
} satisfies DesktopAssets.DesktopAssetsShape);

const desktopServerExposureLayer = Layer.succeed(DesktopServerExposure.DesktopServerExposure, {
  getState: Effect.die("unexpected getState"),
  backendConfig: Effect.succeed({
    port: 3773,
    httpsPort: undefined,
    bindHost: "127.0.0.1",
    httpBaseUrl: new URL("http://127.0.0.1:3773"),
    httpsBaseUrl: undefined,
  }),
  configureFromSettings: () => Effect.die("unexpected configureFromSettings"),
  setMode: () => Effect.die("unexpected setMode"),
  setHttpsEnabled: () => Effect.die("unexpected setHttpsEnabled"),
  getAdvertisedEndpoints: Effect.die("unexpected getAdvertisedEndpoints"),
} satisfies DesktopServerExposure.DesktopServerExposureShape);

const electronMenuLayer = Layer.succeed(ElectronMenu.ElectronMenu, {
  setApplicationMenu: () => Effect.void,
  popupTemplate: () => Effect.void,
  showContextMenu: () => Effect.succeed(Option.none()),
} satisfies ElectronMenu.ElectronMenuShape);

const electronShellLayer = Layer.succeed(ElectronShell.ElectronShell, {
  openExternal: () => Effect.succeed(true),
  openPath: () => Effect.succeed(true),
  revealPath: () => Effect.succeed(true),
  copyText: () => Effect.void,
} satisfies ElectronShell.ElectronShellShape);

const electronThemeLayer = Layer.succeed(ElectronTheme.ElectronTheme, {
  shouldUseDarkColors: Effect.succeed(false),
  setSource: () => Effect.void,
  onUpdated: () => Effect.void,
} satisfies ElectronTheme.ElectronThemeShape);

const desktopIpcLayer = Layer.succeed(DesktopIpc.DesktopIpc, {
  trustWebContents: () => Effect.void,
  handle: () => Effect.void,
  handleSync: () => Effect.void,
} satisfies DesktopIpc.DesktopIpcShape);

const makeDesktopEnvironmentLayer = (platform: NodeJS.Platform = environmentInput.platform) =>
  DesktopEnvironment.layer({
    ...environmentInput,
    platform,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          CAFE_CODE_DESKTOP_DEV: "true",
          CAFE_CODE_PORT: "3773",
          VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
        }),
      ),
    ),
  );

function makeTestLayer(input: {
  readonly window: Electron.BrowserWindow;
  readonly windows?: readonly Electron.BrowserWindow[];
  readonly createCount: Ref.Ref<number>;
  readonly mainWindow: Ref.Ref<Option.Option<Electron.BrowserWindow>>;
  readonly initialSettings?: DesktopAppSettings.DesktopSettings;
  readonly settings?: DesktopAppSettings.DesktopAppSettingsShape;
  readonly platform?: NodeJS.Platform;
}) {
  const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    create: () => Ref.update(input.createCount, (count) => count + 1).pipe(Effect.as(input.window)),
    main: Ref.get(input.mainWindow),
    currentMainOrFirst: Ref.get(input.mainWindow),
    focusedMainOrFirst: Ref.get(input.mainWindow),
    setMain: (window) => Ref.set(input.mainWindow, Option.some(window)),
    clearMain: () => Ref.set(input.mainWindow, Option.none()),
    reveal: () => Effect.void,
    sendAll: () => Effect.void,
    destroyAll: Effect.void,
    syncAllAppearance: (sync) =>
      Effect.forEach(input.windows ?? [input.window], sync, { discard: true }),
  } satisfies ElectronWindow.ElectronWindowShape);
  const desktopSettingsLayer =
    input.settings === undefined
      ? DesktopAppSettings.layerTest(input.initialSettings)
      : Layer.succeed(DesktopAppSettings.DesktopAppSettings, input.settings);

  return DesktopWindow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        desktopAssetsLayer,
        makeDesktopEnvironmentLayer(input.platform),
        desktopServerExposureLayer,
        DesktopState.layer,
        electronMenuLayer,
        electronShellLayer,
        electronThemeLayer,
        electronWindowLayer,
        desktopIpcLayer,
        desktopSettingsLayer,
      ),
    ),
  );
}

describe("DesktopWindow", () => {
  it("supports native whole-window topmost only where Electron can confirm it reliably", () => {
    assert.deepEqual(DesktopWindow.resolveDesktopWindowAlwaysOnTopCapability("win32"), {
      supported: true,
    });
    assert.deepEqual(DesktopWindow.resolveDesktopWindowAlwaysOnTopCapability("darwin"), {
      supported: true,
    });
    assert.deepEqual(DesktopWindow.resolveDesktopWindowAlwaysOnTopCapability("linux"), {
      supported: false,
      reason: "window-manager-dependent",
    });
    assert.deepEqual(DesktopWindow.resolveDesktopWindowAlwaysOnTopCapability("freebsd"), {
      supported: false,
      reason: "unsupported-platform",
    });
  });

  it.effect(
    "reports observed native state instead of treating saved intent as effective state",
    () =>
      Effect.gen(function* () {
        const fakeWindow = makeFakeBrowserWindow();
        const createCount = yield* Ref.make(0);
        const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
        const layer = makeTestLayer({
          window: fakeWindow.window,
          createCount,
          mainWindow,
          initialSettings: {
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            windowAlwaysOnTopEnabled: true,
          },
        });

        yield* Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;
          assert.deepEqual(yield* desktopWindow.getWindowAlwaysOnTopState, {
            supported: true,
            enabled: true,
            effectiveEnabled: false,
            reason: "native-state-mismatch",
          });
          assert.equal(fakeWindow.setAlwaysOnTop.mock.calls.length, 0);
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("reports mixed live-window state as unconfirmed", () =>
    Effect.gen(function* () {
      const firstWindow = makeFakeBrowserWindow();
      const secondWindow = makeFakeBrowserWindow();
      secondWindow.isAlwaysOnTop.mockReturnValue(true);
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: firstWindow.window,
        windows: [firstWindow.window, secondWindow.window],
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.getWindowAlwaysOnTopState, {
          supported: true,
          enabled: false,
          effectiveEnabled: null,
          reason: "native-state-unconfirmed",
        });
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("does not open a development window until the backend is ready", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.activate;
        assert.equal(yield* Ref.get(createCount), 0);

        yield* desktopWindow.handleBackendReady;
        assert.equal(yield* Ref.get(createCount), 1);
        assert.deepEqual(fakeWindow.loadURL.mock.calls[0], ["http://127.0.0.1:5733/"]);
        assert.equal(fakeWindow.openDevTools.mock.calls.length, 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("toggles whole-window topmost without focusing the window", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: true }), {
          supported: true,
          enabled: true,
          effectiveEnabled: true,
          reason: null,
        });
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: false }), {
          supported: true,
          enabled: false,
          effectiveEnabled: false,
          reason: null,
        });
        assert.deepEqual(fakeWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [false, "floating"],
        ]);
        assert.equal(fakeWindow.focus.mock.calls.length, 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fails closed when native whole-window topmost application fails", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      fakeWindow.setAlwaysOnTop
        .mockImplementationOnce(() => {
          throw new Error("native setAlwaysOnTop failed");
        })
        .mockImplementation((enabled: boolean) => {
          fakeWindow.isAlwaysOnTop.mockReturnValue(enabled);
        });
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: true }), {
          supported: true,
          enabled: false,
          effectiveEnabled: false,
          reason: "apply-failed",
        });
        assert.deepEqual(fakeWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [false, "floating"],
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("visits and safely resets every live window after a partial apply failure", () =>
    Effect.gen(function* () {
      const firstWindow = makeFakeBrowserWindow();
      const secondWindow = makeFakeBrowserWindow();
      secondWindow.setAlwaysOnTop.mockImplementationOnce(() => {
        throw new Error("second window rejected topmost");
      });
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: firstWindow.window,
        windows: [firstWindow.window, secondWindow.window],
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: true }), {
          supported: true,
          enabled: false,
          effectiveEnabled: false,
          reason: "apply-failed",
        });
        assert.deepEqual(firstWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [false, "floating"],
        ]);
        assert.deepEqual(secondWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [false, "floating"],
        ]);
        assert.isFalse(firstWindow.isAlwaysOnTop());
        assert.isFalse(secondWindow.isAlwaysOnTop());
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("continues a safe reset after one window rejects the reset", () =>
    Effect.gen(function* () {
      const firstWindow = makeFakeBrowserWindow();
      const secondWindow = makeFakeBrowserWindow();
      firstWindow.setAlwaysOnTop.mockImplementation((enabled: boolean) => {
        if (!enabled) {
          throw new Error("first window rejected safe reset");
        }
        firstWindow.isAlwaysOnTop.mockReturnValue(true);
      });
      secondWindow.setAlwaysOnTop.mockImplementationOnce(() => {
        throw new Error("second window rejected topmost");
      });
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: firstWindow.window,
        windows: [firstWindow.window, secondWindow.window],
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: true }), {
          supported: true,
          enabled: false,
          effectiveEnabled: null,
          reason: "safe-reset-failed",
        });
        assert.deepEqual(secondWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [false, "floating"],
        ]);
        assert.isFalse(secondWindow.isAlwaysOnTop());
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fails closed without invoking native topmost on Linux window managers", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        platform: "linux",
        initialSettings: {
          ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
          windowAlwaysOnTopEnabled: true,
        },
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: true }), {
          supported: false,
          enabled: false,
          effectiveEnabled: false,
          reason: "window-manager-dependent",
        });
        assert.equal(fakeWindow.setAlwaysOnTop.mock.calls.length, 0);
        assert.equal((yield* desktopWindow.getWindowAlwaysOnTopState).enabled, false);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("restores normal stacking when whole-window topmost persistence fails", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      let currentSettings = DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS;
      let alwaysOnTopWriteCount = 0;
      const settings = {
        get: Effect.sync(() => currentSettings),
        load: Effect.sync(() => currentSettings),
        setServerExposureMode: () => Effect.die("unexpected setServerExposureMode"),
        setServerHttpsEnabled: () => Effect.die("unexpected setServerHttpsEnabled"),
        setUpdateChannel: () => Effect.die("unexpected setUpdateChannel"),
        setWindowAlwaysOnTopPreference: ({ enabled }) =>
          Effect.suspend(() => {
            alwaysOnTopWriteCount += 1;
            if (alwaysOnTopWriteCount === 1) {
              return Effect.fail("test persistence failure") as unknown as Effect.Effect<
                DesktopAppSettings.DesktopSettingsChange,
                DesktopAppSettings.DesktopSettingsWriteError
              >;
            }
            currentSettings = {
              ...currentSettings,
              windowAlwaysOnTopEnabled: enabled,
            };
            return Effect.succeed({
              settings: currentSettings,
              changed: true,
            });
          }),
      } satisfies DesktopAppSettings.DesktopAppSettingsShape;
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        settings,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        assert.deepEqual(yield* desktopWindow.setWindowAlwaysOnTopPreference({ enabled: true }), {
          supported: true,
          enabled: false,
          effectiveEnabled: false,
          reason: "persistence-failed",
        });
        assert.deepEqual(fakeWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [false, "floating"],
        ]);
        assert.equal(alwaysOnTopWriteCount, 2);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("reapplies the persisted topmost preference before each main window loads", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        initialSettings: {
          ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
          windowAlwaysOnTopEnabled: true,
        },
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.createMain;
        yield* Ref.set(mainWindow, Option.none());
        yield* desktopWindow.createMain;

        assert.deepEqual(fakeWindow.setAlwaysOnTop.mock.calls, [
          [true, "floating"],
          [true, "floating"],
        ]);
        assert.equal(fakeWindow.loadURL.mock.calls.length, 2);
        assert.equal(
          fakeWindow.setAlwaysOnTop.mock.invocationCallOrder[0]! <
            fakeWindow.loadURL.mock.invocationCallOrder[0]!,
          true,
        );
      }).pipe(Effect.provide(layer));
    }),
  );
});
