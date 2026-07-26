import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type * as Electron from "electron";
import type {
  DesktopWindowAlwaysOnTopPreference,
  DesktopWindowAlwaysOnTopState,
} from "@cafecode/contracts";

import { stopStartupCpuProfiler } from "@cafecode/shared/startupProfiler";
import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";

const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const DESKTOP_ALWAYS_ON_TOP_LEVEL = "floating" as const;

export type DesktopWindowAlwaysOnTopCapability =
  | { readonly supported: true }
  | {
      readonly supported: false;
      readonly reason: "window-manager-dependent" | "unsupported-platform";
    };

/**
 * Electron's native API is stable on Windows and macOS. Linux support depends
 * on the active X11/Wayland window manager, so Cafe fails closed there instead
 * of claiming a topmost state it cannot confirm.
 */
export function resolveDesktopWindowAlwaysOnTopCapability(
  platform: string,
): DesktopWindowAlwaysOnTopCapability {
  if (platform === "darwin" || platform === "win32") {
    return { supported: true };
  }
  if (platform === "linux") {
    return { supported: false, reason: "window-manager-dependent" };
  }
  return { supported: false, reason: "unsupported-platform" };
}

type WindowTitleBarOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type DesktopWindowRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopAssets.DesktopAssets
  | DesktopServerExposure.DesktopServerExposure
  | DesktopState.DesktopState
  | ElectronMenu.ElectronMenu
  | ElectronShell.ElectronShell
  | ElectronTheme.ElectronTheme
  | ElectronWindow.ElectronWindow
  | DesktopIpc.DesktopIpc
  | DesktopAppSettings.DesktopAppSettings;

export class DesktopWindowDevServerUrlMissingError extends Data.TaggedError(
  "DesktopWindowDevServerUrlMissingError",
)<{}> {
  override get message() {
    return "VITE_DEV_SERVER_URL is required in desktop development.";
  }
}

export type DesktopWindowError =
  | DesktopWindowDevServerUrlMissingError
  | ElectronWindow.ElectronWindowCreateError;

export interface DesktopWindowShape {
  readonly createMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly ensureMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly revealOrCreateMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly activate: Effect.Effect<void, DesktopWindowError>;
  readonly createMainIfBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly handleBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly dispatchMenuAction: (action: string) => Effect.Effect<void, DesktopWindowError>;
  readonly syncAppearance: Effect.Effect<void>;
  readonly getWindowAlwaysOnTopState: Effect.Effect<DesktopWindowAlwaysOnTopState>;
  readonly setWindowAlwaysOnTopPreference: (
    preference: DesktopWindowAlwaysOnTopPreference,
  ) => Effect.Effect<DesktopWindowAlwaysOnTopState>;
}

export class DesktopWindow extends Context.Service<DesktopWindow, DesktopWindowShape>()(
  "cafecode/desktop/Window",
) {}

const { logInfo: logWindowInfo, logWarning: logWindowWarning } =
  DesktopObservability.makeComponentLogger("desktop-window");

function resolveDesktopDevServerUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.Effect<string, DesktopWindowDevServerUrlMissingError> {
  return Option.match(environment.devServerUrl, {
    onNone: () => Effect.fail(new DesktopWindowDevServerUrlMissingError()),
    onSome: (url) => Effect.succeed(url.href),
  });
}

function getIconOption(
  iconPaths: DesktopAssets.DesktopIconPaths,
): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  return Option.match(iconPaths[ext], {
    onNone: () => ({}),
    onSome: (icon) => ({ icon }),
  });
}

function getInitialWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
}

function getWindowTitleBarOptions(shouldUseDarkColors: boolean): WindowTitleBarOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: shouldUseDarkColors ? TITLEBAR_DARK_SYMBOL_COLOR : TITLEBAR_LIGHT_SYMBOL_COLOR,
    },
  };
}

function syncWindowAppearance(
  window: Electron.BrowserWindow,
  shouldUseDarkColors: boolean,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (window.isDestroyed()) {
      return;
    }

    window.setBackgroundColor(getInitialWindowBackgroundColor(shouldUseDarkColors));
    const { titleBarOverlay } = getWindowTitleBarOptions(shouldUseDarkColors);
    if (typeof titleBarOverlay === "object") {
      window.setTitleBarOverlay(titleBarOverlay);
    }
  });
}

class DesktopWindowAlwaysOnTopApplyError extends Data.TaggedError(
  "DesktopWindowAlwaysOnTopApplyError",
)<{
  readonly cause: unknown;
}> {}

function applyWindowAlwaysOnTop(
  window: Electron.BrowserWindow,
  enabled: boolean,
): Effect.Effect<void, DesktopWindowAlwaysOnTopApplyError> {
  return Effect.try({
    try: () => {
      if (window.isDestroyed()) {
        return;
      }
      window.setAlwaysOnTop(enabled, DESKTOP_ALWAYS_ON_TOP_LEVEL);
      if (window.isAlwaysOnTop() !== enabled) {
        throw new Error("BrowserWindow did not confirm the requested always-on-top state.");
      }
    },
    catch: (cause) => new DesktopWindowAlwaysOnTopApplyError({ cause }),
  });
}

function effectSucceeded<E, R>(effect: Effect.Effect<unknown, E, R>) {
  return effect.pipe(
    Effect.match({
      onFailure: () => false,
      onSuccess: () => true,
    }),
  );
}

type RevealSubscription = (listener: () => void) => void;

function bindFirstRevealTrigger(
  subscribers: readonly RevealSubscription[],
  reveal: () => void,
): void {
  let revealed = false;
  const fire = () => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  for (const subscribe of subscribers) {
    subscribe(fire);
  }
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopIpc = yield* DesktopIpc.DesktopIpc;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
  const state = yield* DesktopState.DesktopState;
  const context = yield* Effect.context<DesktopWindowRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);
  const alwaysOnTopCapability = resolveDesktopWindowAlwaysOnTopCapability(environment.platform);
  const alwaysOnTopMutex = yield* Semaphore.make(1);

  const alwaysOnTopState = (
    settings: DesktopAppSettings.DesktopSettings,
    reason: DesktopWindowAlwaysOnTopState["reason"] = null,
    effectiveEnabled: boolean | null = settings.windowAlwaysOnTopEnabled,
  ): DesktopWindowAlwaysOnTopState => ({
    supported: alwaysOnTopCapability.supported,
    enabled: alwaysOnTopCapability.supported && settings.windowAlwaysOnTopEnabled,
    effectiveEnabled: alwaysOnTopCapability.supported ? effectiveEnabled : false,
    reason: alwaysOnTopCapability.supported ? reason : alwaysOnTopCapability.reason,
  });

  /**
   * Visit every live window even when one native call fails. Stopping at the
   * first failure can leave a later window topmost after Cafe reports that it
   * restored normal stacking.
   */
  const applyAllWindowAlwaysOnTop = (enabled: boolean) =>
    Effect.gen(function* () {
      let succeeded = true;
      yield* electronWindow.syncAllAppearance((window) =>
        applyWindowAlwaysOnTop(window, enabled).pipe(
          Effect.match({
            onFailure: () => {
              succeeded = false;
            },
            onSuccess: () => undefined,
          }),
        ),
      );
      return succeeded;
    });

  const observeAllWindowAlwaysOnTop = Effect.gen(function* () {
    let observedWindowCount = 0;
    let enabledWindowCount = 0;
    let readFailed = false;

    yield* electronWindow.syncAllAppearance((window) =>
      Effect.try({
        try: () => window.isAlwaysOnTop(),
        catch: (cause) => cause,
      }).pipe(
        Effect.match({
          onFailure: () => {
            readFailed = true;
          },
          onSuccess: (enabled) => {
            observedWindowCount += 1;
            if (enabled) {
              enabledWindowCount += 1;
            }
          },
        }),
      ),
    );

    if (
      readFailed ||
      observedWindowCount === 0 ||
      (enabledWindowCount !== 0 && enabledWindowCount !== observedWindowCount)
    ) {
      return null;
    }
    return enabledWindowCount === observedWindowCount;
  });

  const getWindowAlwaysOnTopState = alwaysOnTopMutex.withPermits(1)(
    Effect.gen(function* () {
      const settings = yield* desktopSettings.get;
      if (!alwaysOnTopCapability.supported) {
        return alwaysOnTopState(settings);
      }

      const effectiveEnabled = yield* observeAllWindowAlwaysOnTop;
      const reason =
        effectiveEnabled === null
          ? "native-state-unconfirmed"
          : effectiveEnabled === settings.windowAlwaysOnTopEnabled
            ? null
            : "native-state-mismatch";
      return alwaysOnTopState(settings, reason, effectiveEnabled);
    }),
  );

  const persistSafeAlwaysOnTopPreference = desktopSettings.setWindowAlwaysOnTopPreference({
    enabled: false,
  });

  const setWindowAlwaysOnTopPreferenceUnlocked = Effect.fn(
    "desktop.window.setWindowAlwaysOnTopPreference",
  )(function* (preference: DesktopWindowAlwaysOnTopPreference) {
    const previous = yield* desktopSettings.get;
    if (!alwaysOnTopCapability.supported) {
      if (previous.windowAlwaysOnTopEnabled) {
        yield* effectSucceeded(persistSafeAlwaysOnTopPreference);
      }
      return alwaysOnTopState(yield* desktopSettings.get);
    }

    if (!(yield* applyAllWindowAlwaysOnTop(preference.enabled))) {
      const resetSucceeded = yield* applyAllWindowAlwaysOnTop(false);
      const safeSettingsSucceeded = yield* effectSucceeded(persistSafeAlwaysOnTopPreference);
      return alwaysOnTopState(
        yield* desktopSettings.get,
        resetSucceeded && safeSettingsSucceeded ? "apply-failed" : "safe-reset-failed",
        resetSucceeded ? false : null,
      );
    }

    if (yield* effectSucceeded(desktopSettings.setWindowAlwaysOnTopPreference(preference))) {
      return alwaysOnTopState(yield* desktopSettings.get, null, preference.enabled);
    }

    const resetSucceeded = yield* applyAllWindowAlwaysOnTop(false);
    const safeSettingsSucceeded = yield* effectSucceeded(persistSafeAlwaysOnTopPreference);
    return alwaysOnTopState(
      yield* desktopSettings.get,
      resetSucceeded && safeSettingsSucceeded ? "persistence-failed" : "safe-reset-failed",
      resetSucceeded ? false : null,
    );
  });

  const setWindowAlwaysOnTopPreference = (preference: DesktopWindowAlwaysOnTopPreference) =>
    alwaysOnTopMutex.withPermits(1)(setWindowAlwaysOnTopPreferenceUnlocked(preference));

  const prepareWindowAlwaysOnTop = (window: Electron.BrowserWindow) =>
    Effect.gen(function* () {
      const persistedSettings = yield* desktopSettings.get;
      if (!alwaysOnTopCapability.supported) {
        if (persistedSettings.windowAlwaysOnTopEnabled) {
          yield* effectSucceeded(persistSafeAlwaysOnTopPreference);
        }
        return;
      }

      if (
        yield* effectSucceeded(
          applyWindowAlwaysOnTop(window, persistedSettings.windowAlwaysOnTopEnabled),
        )
      ) {
        return;
      }

      const resetSucceeded = yield* effectSucceeded(applyWindowAlwaysOnTop(window, false));
      const safeSettingsSucceeded = yield* effectSucceeded(persistSafeAlwaysOnTopPreference);
      yield* logWindowWarning(
        resetSucceeded && safeSettingsSucceeded
          ? "persisted whole-window always-on-top could not be applied; restored normal stacking"
          : "persisted whole-window always-on-top recovery could not be confirmed",
      );
    });

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (
    backendHttpUrl: URL,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths);
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const window = yield* electronWindow.create({
      width: 1100,
      height: 780,
      minWidth: 840,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors),
      ...iconOption,
      title: environment.displayName,
      ...getWindowTitleBarOptions(shouldUseDarkColors),
      webPreferences: {
        preload: environment.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    yield* alwaysOnTopMutex.withPermits(1)(prepareWindowAlwaysOnTop(window));
    yield* desktopIpc.trustWebContents(window.webContents);

    window.webContents.on("context-menu", (event, params) => {
      event.preventDefault();

      const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          menuTemplate.push({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          });
        }
        if (params.dictionarySuggestions.length === 0) {
          menuTemplate.push({ label: "No suggestions", enabled: false });
        }
        menuTemplate.push({ type: "separator" });
      }

      if (Option.isSome(ElectronShell.parseSafeExternalUrl(params.linkURL))) {
        menuTemplate.push(
          {
            label: "Copy Link",
            click: () => {
              void runPromise(electronShell.copyText(params.linkURL));
            },
          },
          { type: "separator" },
        );
      }

      if (params.mediaType === "image") {
        menuTemplate.push({
          label: "Copy Image",
          click: () => window.webContents.copyImageAt(params.x, params.y),
        });
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );

      void runPromise(electronMenu.popupTemplate({ window, template: menuTemplate }));
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(environment.displayName);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(environment.displayName);
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        void runPromise(
          logWindowWarning("main window failed to load", {
            errorCode,
            errorDescription,
            url: validatedURL,
          }),
        );
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      void runPromise(
        logWindowWarning("main window render process gone", {
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
    });

    const revealSubscribers: RevealSubscription[] = [(fire) => window.once("ready-to-show", fire)];
    if (process.platform === "linux") {
      revealSubscribers.push((fire) => window.webContents.once("did-finish-load", fire));
    }
    bindFirstRevealTrigger(revealSubscribers, () => {
      void runPromise(electronWindow.reveal(window));
      void stopStartupCpuProfiler("desktop-window-revealed");
    });

    if (environment.isDevelopment) {
      const devServerUrl = yield* resolveDesktopDevServerUrl(environment);
      void window.loadURL(devServerUrl);
      window.webContents.openDevTools({ mode: "detach" });
    } else {
      void window.loadURL(backendHttpUrl.href);
    }

    window.on("closed", () => {
      void runPromise(electronWindow.clearMain(Option.some(window)));
    });

    return window;
  });

  const createMain = Effect.gen(function* () {
    const backendConfig = yield* serverExposure.backendConfig;
    const window = yield* createWindow(backendConfig.httpBaseUrl);
    yield* electronWindow.setMain(window);
    yield* logWindowInfo("main window created");
    return window;
  }).pipe(Effect.withSpan("desktop.window.createMain"));

  const ensureMain = Effect.gen(function* () {
    const existingWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(existingWindow)) {
      return existingWindow.value;
    }
    return yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.ensureMain"));

  const revealOrCreateMain = Effect.gen(function* () {
    const window = yield* ensureMain;
    yield* electronWindow.reveal(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.revealOrCreateMain"));

  const createMainIfBackendReady = Effect.gen(function* () {
    const backendReady = yield* Ref.get(state.backendReady);
    if (!backendReady) return;
    const existingWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(existingWindow)) return;
    yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.createMainIfBackendReady"));

  return DesktopWindow.of({
    createMain,
    ensureMain,
    revealOrCreateMain,
    activate: Effect.gen(function* () {
      const existingWindow = yield* electronWindow.currentMainOrFirst;
      if (Option.isSome(existingWindow)) {
        yield* electronWindow.reveal(existingWindow.value);
      } else {
        yield* createMainIfBackendReady;
      }
    }).pipe(Effect.withSpan("desktop.window.activate")),
    createMainIfBackendReady,
    handleBackendReady: Effect.gen(function* () {
      yield* Ref.set(state.backendReady, true);
      yield* logWindowInfo("backend ready", { source: "http" });
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.handleBackendReady")),
    dispatchMenuAction: Effect.fn("desktop.window.dispatchMenuAction")(function* (action) {
      yield* Effect.annotateCurrentSpan({ action });
      const existingWindow = yield* electronWindow.focusedMainOrFirst;
      const targetWindow = Option.isSome(existingWindow) ? existingWindow.value : yield* createMain;

      const send = () => {
        if (targetWindow.isDestroyed()) return;
        targetWindow.webContents.send(IpcChannels.MENU_ACTION_CHANNEL, action);
        void runPromise(electronWindow.reveal(targetWindow));
      };

      if (targetWindow.webContents.isLoadingMainFrame()) {
        targetWindow.webContents.once("did-finish-load", send);
        return;
      }

      send();
    }),
    syncAppearance: Effect.gen(function* () {
      const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
      yield* electronWindow.syncAllAppearance((window) =>
        syncWindowAppearance(window, shouldUseDarkColors),
      );
    }).pipe(Effect.withSpan("desktop.window.syncAppearance")),
    getWindowAlwaysOnTopState,
    setWindowAlwaysOnTopPreference,
  });
});

export const layer = Layer.effect(DesktopWindow, make);
