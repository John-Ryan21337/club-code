import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type * as Electron from "electron";
import type {
  DesktopWindowOpacityPreference,
  DesktopWindowOpacityState,
} from "@cafecode/contracts";

import { stopStartupCpuProfiler } from "@cafecode/shared/startupProfiler";
import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import { installTrustedFrameAudioCapture } from "./DesktopDisplayMediaCapture.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";

const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const VALIDATED_RELEASE_OPACITY_PLATFORMS = new Set<"darwin" | "win32">(["win32"]);

export type DesktopWindowOpacityCapability =
  | { readonly supported: true }
  | {
      readonly supported: false;
      readonly reason: "unsupported-platform" | "release-not-validated";
    };

/**
 * Release artifacts fail closed until their native opacity smoke evidence is
 * recorded in the release allowlist above. Development builds remain usable
 * for carrying out that native validation.
 */
export function resolveDesktopWindowOpacityCapability(
  platform: string,
  isPackaged: boolean,
): DesktopWindowOpacityCapability {
  if (platform !== "darwin" && platform !== "win32") {
    return { supported: false, reason: "unsupported-platform" };
  }
  if (isPackaged && !VALIDATED_RELEASE_OPACITY_PLATFORMS.has(platform)) {
    return { supported: false, reason: "release-not-validated" };
  }
  return { supported: true };
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
  readonly getWindowOpacityState: Effect.Effect<DesktopWindowOpacityState>;
  readonly setWindowOpacityPreference: (
    preference: DesktopWindowOpacityPreference,
  ) => Effect.Effect<DesktopWindowOpacityState>;
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

class DesktopWindowOpacityApplyError extends Data.TaggedError("DesktopWindowOpacityApplyError")<{
  readonly cause: unknown;
}> {}

function applyWindowOpacity(
  window: Electron.BrowserWindow,
  opacity: number,
): Effect.Effect<void, DesktopWindowOpacityApplyError> {
  return Effect.try({
    try: () => {
      if (!window.isDestroyed()) {
        window.setOpacity(opacity);
      }
    },
    catch: (cause) => new DesktopWindowOpacityApplyError({ cause }),
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
  const opacityCapability = resolveDesktopWindowOpacityCapability(
    environment.platform,
    environment.isPackaged,
  );
  const opacityMutex = yield* Semaphore.make(1);

  const opacityState = (
    settings: DesktopAppSettings.DesktopSettings,
    reason: DesktopWindowOpacityState["reason"] = null,
  ): DesktopWindowOpacityState => ({
    supported: opacityCapability.supported,
    enabled: opacityCapability.supported && settings.windowOpacityEnabled,
    opacity: opacityCapability.supported ? settings.windowOpacity : 1,
    effectiveOpacity:
      opacityCapability.supported && settings.windowOpacityEnabled ? settings.windowOpacity : 1,
    reason: opacityCapability.supported ? reason : opacityCapability.reason,
  });

  const applyAllWindowOpacity = (opacity: number) =>
    electronWindow.syncAllAppearance((window) => applyWindowOpacity(window, opacity));

  const getWindowOpacityState = opacityMutex.withPermits(1)(
    desktopSettings.get.pipe(Effect.map((settings) => opacityState(settings))),
  );

  const setWindowOpacityPreferenceUnlocked = Effect.fn("desktop.window.setWindowOpacityPreference")(
    function* (preference: DesktopWindowOpacityPreference) {
      const previous = yield* desktopSettings.get;
      if (!opacityCapability.supported) {
        return opacityState(previous);
      }

      const proposedEffectiveOpacity = preference.enabled ? preference.opacity : 1;
      if (!(yield* effectSucceeded(applyAllWindowOpacity(proposedEffectiveOpacity)))) {
        const resetSucceeded = yield* effectSucceeded(applyAllWindowOpacity(1));
        const safeSettingsSucceeded = yield* effectSucceeded(
          desktopSettings.setWindowOpacityPreference({
            enabled: false,
            opacity: 1,
          }),
        );
        const recoveredSettings = yield* desktopSettings.get;
        return {
          ...opacityState(recoveredSettings),
          effectiveOpacity: resetSucceeded ? 1 : null,
          reason: resetSucceeded && safeSettingsSucceeded ? "apply-failed" : "safe-reset-failed",
        } satisfies DesktopWindowOpacityState;
      }

      if (yield* effectSucceeded(desktopSettings.setWindowOpacityPreference(preference))) {
        return opacityState(yield* desktopSettings.get);
      }

      const previousEffectiveOpacity = previous.windowOpacityEnabled ? previous.windowOpacity : 1;
      const rollbackSucceeded = yield* effectSucceeded(
        applyAllWindowOpacity(previousEffectiveOpacity),
      );
      return {
        ...opacityState(previous),
        effectiveOpacity: rollbackSucceeded ? previousEffectiveOpacity : null,
        reason: rollbackSucceeded ? "persistence-failed" : "safe-reset-failed",
      } satisfies DesktopWindowOpacityState;
    },
  );
  const setWindowOpacityPreference = (preference: DesktopWindowOpacityPreference) =>
    opacityMutex.withPermits(1)(setWindowOpacityPreferenceUnlocked(preference));

  const prepareWindowOpacity = (window: Electron.BrowserWindow) =>
    Effect.gen(function* () {
      if (!opacityCapability.supported) {
        return;
      }
      const persistedSettings = yield* desktopSettings.get;
      const effectiveOpacity = persistedSettings.windowOpacityEnabled
        ? persistedSettings.windowOpacity
        : 1;
      const applied = yield* effectSucceeded(applyWindowOpacity(window, effectiveOpacity));
      if (applied) {
        return;
      }

      const resetSucceeded = yield* effectSucceeded(applyWindowOpacity(window, 1));
      const safeSettingsSucceeded = yield* effectSucceeded(
        desktopSettings.setWindowOpacityPreference({
          enabled: false,
          opacity: 1,
        }),
      );
      yield* logWindowWarning(
        resetSucceeded && safeSettingsSucceeded
          ? "persisted window opacity could not be applied; restored opaque"
          : "persisted window opacity recovery could not be confirmed",
      );
    });

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (
    backendHttpUrl: URL,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const rendererUrl = environment.isDevelopment
      ? yield* resolveDesktopDevServerUrl(environment)
      : backendHttpUrl.href;
    const rendererOrigin = new URL(rendererUrl).origin;
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
    window.maximize();
    yield* opacityMutex.withPermits(1)(prepareWindowOpacity(window));
    yield* desktopIpc.trustWebContents(window.webContents, rendererUrl);
    const removeDisplayMediaCapture = installTrustedFrameAudioCapture(
      window.webContents,
      rendererOrigin,
    );

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
    const guardRendererNavigation = (
      event: Electron.Event<Electron.WebContentsWillNavigateEventParams>,
    ) => {
      if (!DesktopIpc.isTrustedDesktopIpcNavigation(event.url, rendererUrl)) {
        event.preventDefault();
      }
    };
    window.webContents.on("will-navigate", guardRendererNavigation);
    window.webContents.on("will-redirect", guardRendererNavigation);

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
      void runPromise(
        opacityMutex.withPermits(1)(
          prepareWindowOpacity(window).pipe(Effect.andThen(electronWindow.reveal(window))),
        ),
      );
      void stopStartupCpuProfiler("desktop-window-revealed");
    });

    void window.loadURL(rendererUrl);
    if (environment.isDevelopment) {
      window.webContents.openDevTools({ mode: "detach" });
    }

    window.on("closed", () => {
      removeDisplayMediaCapture();
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
    getWindowOpacityState,
    setWindowOpacityPreference,
  });
});

export const layer = Layer.effect(DesktopWindow, make);
