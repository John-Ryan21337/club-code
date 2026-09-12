import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";

import {
  DEFAULT_DESKTOP_WINDOW_OPACITY,
  type DesktopWindowOpacityPreference,
} from "@cafecode/contracts";
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
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
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
  const setPermissionCheckHandler = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const webContents = {
    copyImageAt: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    openDevTools: vi.fn(),
    replaceMisspelling: vi.fn(),
    send: vi.fn(),
    session: {
      setPermissionCheckHandler,
      setPermissionRequestHandler,
    },
    setWindowOpenHandler: vi.fn(),
  };

  const window = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setOpacity: vi.fn(),
    setTitle: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    show: vi.fn(),
    webContents,
  };

  return {
    window: window as unknown as Electron.BrowserWindow,
    loadURL: window.loadURL,
    setOpacity: window.setOpacity,
    openDevTools: webContents.openDevTools,
    setPermissionCheckHandler,
    setPermissionRequestHandler,
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

const desktopEnvironmentLayer = DesktopEnvironment.layer(environmentInput).pipe(
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
  readonly createCount: Ref.Ref<number>;
  readonly mainWindow: Ref.Ref<Option.Option<Electron.BrowserWindow>>;
  readonly settingsLayer?: Layer.Layer<DesktopAppSettings.DesktopAppSettings>;
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
    syncAllAppearance: (sync) => sync(input.window),
  } satisfies ElectronWindow.ElectronWindowShape);

  return DesktopWindow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        desktopAssetsLayer,
        desktopEnvironmentLayer,
        desktopServerExposureLayer,
        DesktopState.layer,
        electronMenuLayer,
        electronShellLayer,
        electronThemeLayer,
        electronWindowLayer,
        desktopIpcLayer,
        input.settingsLayer ?? DesktopAppSettings.layerTest(),
      ),
    ),
  );
}

describe("DesktopWindow", () => {
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

  it.effect("grants only trusted top-level microphone requests", () =>
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
        yield* desktopWindow.handleBackendReady;

        const checkHandler = fakeWindow.setPermissionCheckHandler.mock.calls[0]?.[0] as
          | NonNullable<Parameters<Electron.Session["setPermissionCheckHandler"]>[0]>
          | undefined;
        const requestHandler = fakeWindow.setPermissionRequestHandler.mock.calls[0]?.[0] as
          | NonNullable<Parameters<Electron.Session["setPermissionRequestHandler"]>[0]>
          | undefined;
        assert.isDefined(checkHandler);
        assert.isDefined(requestHandler);

        const trustedWebContents = fakeWindow.window.webContents;
        const checkDetails: Electron.PermissionCheckHandlerHandlerDetails = {
          isMainFrame: true,
          mediaType: "audio",
          requestingUrl: "http://127.0.0.1:5733/chat",
          securityOrigin: "http://127.0.0.1:5733",
        };
        assert.isTrue(
          checkHandler(trustedWebContents, "media", "http://127.0.0.1:5733", checkDetails),
        );
        assert.isFalse(
          checkHandler(trustedWebContents, "media", "https://attacker.example", checkDetails),
        );
        assert.isFalse(
          checkHandler(trustedWebContents, "media", "http://127.0.0.1:5733", {
            ...checkDetails,
            mediaType: "video",
          }),
        );
        assert.isFalse(
          checkHandler(trustedWebContents, "media", "http://127.0.0.1:5733", {
            ...checkDetails,
            isMainFrame: false,
          }),
        );
        assert.isFalse(
          checkHandler({} as Electron.WebContents, "media", "http://127.0.0.1:5733", checkDetails),
        );

        const requestResult = vi.fn();
        requestHandler(trustedWebContents, "media", requestResult, {
          isMainFrame: true,
          requestingUrl: "http://127.0.0.1:5733/chat",
          securityOrigin: "http://127.0.0.1:5733",
          mediaTypes: ["audio"],
        });
        assert.deepStrictEqual(requestResult.mock.calls, [[true]]);

        const cameraResult = vi.fn();
        requestHandler(trustedWebContents, "media", cameraResult, {
          isMainFrame: true,
          requestingUrl: "http://127.0.0.1:5733/chat",
          securityOrigin: "http://127.0.0.1:5733",
          mediaTypes: ["audio", "video"],
        });
        assert.deepStrictEqual(cameraResult.mock.calls, [[false]]);
      }).pipe(Effect.provide(layer));
    }),
  );
});

/**
 * These suites drive the production DesktopWindow service with a mocked
 * Electron window. They assert the native `setOpacity` calls, so no test can
 * pass on renderer-only styling.
 */
const persistingSettingsLayer = (initial?: Partial<DesktopAppSettings.DesktopSettings>) =>
  DesktopAppSettings.layerTest({
    ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
    ...initial,
  });

function failingSettingsLayer(settings: DesktopAppSettings.DesktopSettings) {
  const writes: DesktopWindowOpacityPreference[] = [];
  const layer = Layer.succeed(DesktopAppSettings.DesktopAppSettings, {
    get: Effect.succeed(settings),
    load: Effect.succeed(settings),
    setServerExposureMode: () => Effect.die("unexpected setServerExposureMode"),
    setServerHttpsEnabled: () => Effect.die("unexpected setServerHttpsEnabled"),
    setUpdateChannel: () => Effect.die("unexpected setUpdateChannel"),
    setWindowOpacityPreference: (preference) => {
      writes.push(preference);
      return Effect.fail(
        new DesktopAppSettings.DesktopSettingsWriteError({
          cause: new PlatformError.PlatformError(
            new PlatformError.SystemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "writeFileString",
              description: "settings file is read-only",
            }),
          ),
        }),
      );
    },
  } satisfies DesktopAppSettings.DesktopAppSettingsShape);
  return { layer, writes };
}

describe("DesktopWindow whole-window opacity", () => {
  const withWindow = <A, E>(
    body: (
      fake: ReturnType<typeof makeFakeBrowserWindow>,
    ) => Effect.Effect<A, E, DesktopWindow.DesktopWindow>,
    settingsLayer?: Layer.Layer<DesktopAppSettings.DesktopAppSettings>,
  ) =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        ...(settingsLayer === undefined ? {} : { settingsLayer }),
      });
      return yield* body(fakeWindow).pipe(Effect.provide(layer));
    });

  it("reports an unsupported platform explicitly and never applies opacity", () => {
    assert.deepStrictEqual(DesktopWindow.resolveDesktopWindowOpacityCapability("linux", false), {
      supported: false,
      reason: "unsupported-platform",
    });
    assert.deepStrictEqual(DesktopWindow.resolveDesktopWindowOpacityCapability("win32", false), {
      supported: true,
    });
    assert.deepStrictEqual(DesktopWindow.resolveDesktopWindowOpacityCapability("win32", true), {
      supported: false,
      reason: "release-not-validated",
    });
    assert.deepStrictEqual(DesktopWindow.resolveDesktopWindowOpacityCapability("darwin", true), {
      supported: false,
      reason: "release-not-validated",
    });
  });

  it.effect("defaults to a fully opaque supported window", () =>
    withWindow((fakeWindow) =>
      Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        const state = yield* desktopWindow.getWindowOpacityState;
        assert.deepStrictEqual(state, {
          supported: true,
          enabled: false,
          opacity: DEFAULT_DESKTOP_WINDOW_OPACITY,
          effectiveOpacity: 1,
          reason: null,
        });
        assert.equal(fakeWindow.setOpacity.mock.calls.length, 0);
      }),
    ),
  );

  it.effect("applies the native opacity and persists only after the native call succeeds", () =>
    withWindow((fakeWindow) =>
      Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        const state = yield* desktopWindow.setWindowOpacityPreference({
          enabled: true,
          opacity: 0.8,
        });
        assert.deepStrictEqual(state, {
          supported: true,
          enabled: true,
          opacity: 0.8,
          effectiveOpacity: 0.8,
          reason: null,
        });
        assert.deepStrictEqual(fakeWindow.setOpacity.mock.calls, [[0.8]]);
        assert.deepStrictEqual(yield* desktopWindow.getWindowOpacityState, state);
      }),
    ),
  );

  it.effect("restores an opaque window and a safe preference when the native call fails", () =>
    withWindow((fakeWindow) =>
      Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        const setOpacity = fakeWindow.setOpacity as unknown as ReturnType<typeof vi.fn>;
        setOpacity.mockImplementationOnce(() => {
          throw new Error("native opacity unavailable");
        });

        const state = yield* desktopWindow.setWindowOpacityPreference({
          enabled: true,
          opacity: 0.7,
        });
        assert.deepStrictEqual(state, {
          supported: true,
          enabled: false,
          opacity: 1,
          effectiveOpacity: 1,
          reason: "apply-failed",
        });
        assert.deepStrictEqual(setOpacity.mock.calls, [[0.7], [1]]);
      }),
    ),
  );

  it.effect("rolls the native window back when the preference cannot be persisted", () => {
    const failing = failingSettingsLayer({
      ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
      windowOpacityEnabled: true,
      windowOpacity: 0.9,
    });
    return withWindow(
      (fakeWindow) =>
        Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;
          const state = yield* desktopWindow.setWindowOpacityPreference({
            enabled: true,
            opacity: 0.7,
          });
          assert.deepStrictEqual(state, {
            supported: true,
            enabled: true,
            opacity: 0.9,
            effectiveOpacity: 0.9,
            reason: "persistence-failed",
          });
          assert.deepStrictEqual(fakeWindow.setOpacity.mock.calls, [[0.7], [0.9]]);
        }),
      failing.layer,
    );
  });

  it.effect("reports an unknown live window when the rollback also fails", () => {
    const failing = failingSettingsLayer(DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS);
    return withWindow(
      (fakeWindow) =>
        Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;
          const setOpacity = fakeWindow.setOpacity as unknown as ReturnType<typeof vi.fn>;
          setOpacity
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
              throw new Error("native rollback failed");
            });

          const state = yield* desktopWindow.setWindowOpacityPreference({
            enabled: true,
            opacity: 0.7,
          });
          assert.equal(state.effectiveOpacity, null);
          assert.equal(state.reason, "safe-reset-failed");
          assert.deepStrictEqual(yield* desktopWindow.getWindowOpacityState, state);
        }),
      failing.layer,
    );
  });

  it.effect("serializes concurrent preference updates", () =>
    withWindow((fakeWindow) =>
      Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* Effect.all(
          [
            desktopWindow.setWindowOpacityPreference({ enabled: true, opacity: 0.7 }),
            desktopWindow.setWindowOpacityPreference({ enabled: true, opacity: 0.9 }),
            desktopWindow.setWindowOpacityPreference({ enabled: false, opacity: 0.9 }),
          ],
          { concurrency: "unbounded" },
        );
        const applied = fakeWindow.setOpacity.mock.calls.map(([value]) => value);
        assert.equal(applied.length, 3);
        // The last accepted request owns the final native and persisted state.
        const state = yield* desktopWindow.getWindowOpacityState;
        assert.equal(state.effectiveOpacity, applied.at(-1));
      }),
    ),
  );

  it.effect("applies the persisted opacity to a newly created window", () =>
    withWindow(
      (fakeWindow) =>
        Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;
          yield* desktopWindow.handleBackendReady;
          assert.deepStrictEqual(fakeWindow.setOpacity.mock.calls, [[0.75]]);
        }),
      persistingSettingsLayer({ windowOpacityEnabled: true, windowOpacity: 0.75 }),
    ),
  );
});
