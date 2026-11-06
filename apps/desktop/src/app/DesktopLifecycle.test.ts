import { assert, describe, it } from "@effect/vitest";
import { EventEmitter } from "node:events";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import type * as Electron from "electron";
import type { ProviderDaemonHealth } from "@cafecode/contracts";

import * as DesktopProviderDaemonManager from "../backend/DesktopProviderDaemonManager.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

type BeforeQuitListener = (event: Electron.Event) => void;
type SecondInstanceListener = (
  event: Electron.Event,
  argv: readonly string[],
  workingDirectory: string,
  additionalData?: Record<string, unknown>,
) => void;

function makeEvent() {
  let preventDefaultCount = 0;
  return {
    event: {
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    } as Electron.Event,
    preventDefaultCount: () => preventDefaultCount,
  };
}

const flushMicrotasks = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* Effect.yieldNow;
});

function makeProviderDaemonHealth(activeSessionCount: number): ProviderDaemonHealth {
  return {
    ok: true,
    mode: "provider-daemon",
    pid: 12_345,
    ppid: process.pid,
    version: "0.0.0-test",
    startedAt: "1970-01-01T00:00:00.000Z",
    activeSessionCount,
    configuredInstanceCount: 2,
    eventCursor: 0,
  };
}

function makeLifecycleHarness(options?: {
  readonly activeProviderSessionCount?: number;
  readonly providerDaemonDialogResponse?: number;
  readonly platform?: "win32" | "darwin" | "linux";
  readonly healthUnavailable?: boolean;
}) {
  let beforeQuitListener: BeforeQuitListener | undefined;
  let windowCreatedListener:
    | ((event: Electron.Event, window: Electron.BrowserWindow) => void)
    | undefined;
  let secondInstanceListener: SecondInstanceListener | undefined;
  let windowAllClosedListener: (() => void) | undefined;
  let recoveredWindowCount = 0;
  let activateCount = 0;
  let quitCount = 0;
  let shutdownOverlayCount = 0;
  let providerDaemonStopCount = 0;
  let providerDaemonDialogCount = 0;

  return Effect.gen(function* () {
    const overlaySent = yield* Deferred.make<void>();

    const electronAppLayer = Layer.succeed(ElectronApp.ElectronApp, {
      metadata: Effect.die("unexpected metadata"),
      name: Effect.succeed("Cafe Code"),
      whenReady: Effect.void,
      quit: Effect.sync(() => {
        quitCount += 1;
      }),
      exit: () => Effect.void,
      requestSingleInstanceLock: Effect.succeed(true),
      relaunch: () => Effect.void,
      setPath: () => Effect.void,
      setName: () => Effect.void,
      setAboutPanelOptions: () => Effect.void,
      setAppUserModelId: () => Effect.void,
      setDesktopName: () => Effect.void,
      setDockIcon: () => Effect.void,
      appendCommandLineSwitch: () => Effect.void,
      on: (eventName, listener) =>
        Effect.sync(() => {
          if (eventName === "before-quit") {
            beforeQuitListener = listener as unknown as BeforeQuitListener;
          } else if (eventName === "second-instance") {
            secondInstanceListener = listener as unknown as SecondInstanceListener;
          } else if (eventName === "browser-window-created") {
            windowCreatedListener = listener as unknown as typeof windowCreatedListener;
          } else if (eventName === "window-all-closed") {
            windowAllClosedListener = listener as () => void;
          }
        }),
    } satisfies ElectronApp.ElectronAppShape);

    const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
      create: () => Effect.die("unexpected create"),
      main: Effect.succeed(Option.none()),
      currentMainOrFirst: Effect.succeed(Option.none()),
      focusedMainOrFirst: Effect.succeed(Option.none()),
      setMain: () => Effect.void,
      clearMain: () => Effect.void,
      reveal: () => Effect.void,
      sendAll: (channel, action) =>
        Effect.gen(function* () {
          if (
            channel === IpcChannels.MENU_ACTION_CHANNEL &&
            action === "desktop-shutdown-started"
          ) {
            shutdownOverlayCount += 1;
            yield* Deferred.succeed(overlaySent, void 0);
          }
        }),
      destroyAll: Effect.void,
      syncAllAppearance: () => Effect.void,
    } satisfies ElectronWindow.ElectronWindowShape);

    const electronDialogLayer = Layer.succeed(ElectronDialog.ElectronDialog, {
      pickFolder: () => Effect.die("unexpected pickFolder"),
      confirm: () => Effect.die("unexpected confirm"),
      showMessageBox: () =>
        Effect.sync(() => {
          providerDaemonDialogCount += 1;
          return {
            response: options?.providerDaemonDialogResponse ?? 0,
            checkboxChecked: false,
          };
        }),
      showErrorBox: () => Effect.void,
    } satisfies ElectronDialog.ElectronDialogShape);

    const electronThemeLayer = Layer.succeed(ElectronTheme.ElectronTheme, {
      shouldUseDarkColors: Effect.succeed(false),
      setSource: () => Effect.void,
      onUpdated: () => Effect.void,
    } satisfies ElectronTheme.ElectronThemeShape);

    const desktopWindowLayer = Layer.succeed(DesktopWindow.DesktopWindow, {
      createMain: Effect.die("unexpected createMain"),
      ensureMain: Effect.die("unexpected ensureMain"),
      revealOrCreateMain: Effect.sync(() => {
        recoveredWindowCount += 1;
        return {} as Electron.BrowserWindow;
      }),
      activate: Effect.sync(() => {
        activateCount += 1;
      }),
      createMainIfBackendReady: Effect.void,
      handleBackendReady: Effect.void,
      dispatchMenuAction: () => Effect.void,
      syncAppearance: Effect.void,
      getWindowOpacityState: Effect.succeed({
        supported: false,
        enabled: false,
        opacity: 1,
        effectiveOpacity: 1,
        reason: "unsupported-platform",
      }),
      setWindowOpacityPreference: () => Effect.die("unexpected setWindowOpacityPreference"),
    } satisfies DesktopWindow.DesktopWindowShape);

    const desktopEnvironmentLayer = Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
      platform: options?.platform ?? "darwin",
      isDevelopment: false,
    } as DesktopEnvironment.DesktopEnvironmentShape);

    const providerDaemonLayer = Layer.succeed(
      DesktopProviderDaemonManager.DesktopProviderDaemonManager,
      {
        ensureRunning: Effect.die("unexpected ensureRunning"),
        recover: () => Effect.die("unexpected recover"),
        currentConfig: Effect.succeed(Option.none()),
        probeLiveness: Effect.succeed(Option.none()),
        refreshHealth: Effect.succeed(
          options?.healthUnavailable
            ? Option.none()
            : Option.some(makeProviderDaemonHealth(options?.activeProviderSessionCount ?? 0)),
        ),
        snapshot: Effect.die("unexpected snapshot"),
        stop: Effect.sync(() => {
          providerDaemonStopCount += 1;
        }),
      } satisfies DesktopProviderDaemonManager.DesktopProviderDaemonManagerShape,
    );

    const layer = Layer.mergeAll(
      DesktopLifecycle.layer,
      DesktopLifecycle.layerShutdown,
      DesktopState.layer,
      desktopEnvironmentLayer,
      desktopWindowLayer,
      providerDaemonLayer,
      electronAppLayer,
      electronDialogLayer,
      electronThemeLayer,
      electronWindowLayer,
      TestClock.layer(),
    );

    return {
      layer,
      overlaySent,
      getBeforeQuitListener: () => beforeQuitListener,
      getWindowCreatedListener: () => windowCreatedListener,
      getWindowAllClosedListener: () => windowAllClosedListener,
      getRecoveredWindowCount: () => recoveredWindowCount,
      getSecondInstanceListener: () => secondInstanceListener,
      getActivateCount: () => activateCount,
      getQuitCount: () => quitCount,
      getShutdownOverlayCount: () => shutdownOverlayCount,
      getProviderDaemonStopCount: () => providerDaemonStopCount,
      getProviderDaemonDialogCount: () => providerDaemonDialogCount,
    };
  });
}

describe("DesktopLifecycle", () => {
  it.effect("restores unexpected Windows window loss without quitting, with a recovery limit", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness({ platform: "win32" });
      yield* Effect.gen(function* () {
        yield* (yield* DesktopLifecycle.DesktopLifecycle).register;
        for (let index = 0; index < 4; index += 1) {
          harness.getWindowAllClosedListener()!();
          yield* flushMicrotasks;
        }
        assert.equal(harness.getRecoveredWindowCount(), 3);
        assert.equal(harness.getQuitCount(), 0);
        assert.equal(harness.getProviderDaemonStopCount(), 0);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps the quit decision available when provider health cannot be read", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness({
        platform: "win32",
        healthUnavailable: true,
        providerDaemonDialogResponse: 2,
      });
      yield* Effect.gen(function* () {
        yield* (yield* DesktopLifecycle.DesktopLifecycle).register;
        const window = new EventEmitter();
        harness.getWindowCreatedListener()!(
          makeEvent().event,
          window as unknown as Electron.BrowserWindow,
        );
        const close = makeEvent();
        window.emit("close", close.event);
        assert.equal(close.preventDefaultCount(), 1);
        yield* flushMicrotasks;
        assert.equal(harness.getProviderDaemonDialogCount(), 1);
        assert.equal(harness.getShutdownOverlayCount(), 0);
        assert.equal(harness.getProviderDaemonStopCount(), 0);
        assert.equal(harness.getQuitCount(), 0);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("preserves a Windows window on Cancel Quit and permits a later close request", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness({
        platform: "win32",
        activeProviderSessionCount: 1,
        providerDaemonDialogResponse: 2,
      });
      const window = new EventEmitter();
      yield* Effect.gen(function* () {
        yield* (yield* DesktopLifecycle.DesktopLifecycle).register;
        const created = harness.getWindowCreatedListener();
        assert.isDefined(created);
        created!(makeEvent().event, window as unknown as Electron.BrowserWindow);
        const close = makeEvent();
        window.emit("close", close.event);
        // Electron requires synchronous prevention before its close callback returns.
        assert.equal(close.preventDefaultCount(), 1);
        yield* flushMicrotasks;
        assert.equal(harness.getProviderDaemonDialogCount(), 1);
        assert.equal(harness.getShutdownOverlayCount(), 0);
        assert.equal(harness.getProviderDaemonStopCount(), 0);
        assert.equal(harness.getQuitCount(), 0);

        const retry = makeEvent();
        window.emit("close", retry.event);
        assert.equal(retry.preventDefaultCount(), 1);
        yield* flushMicrotasks;
        assert.equal(harness.getProviderDaemonDialogCount(), 2);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
      assert.equal(window.listenerCount("close"), 0);
    }),
  );

  it.effect("coalesces Windows close requests and releases the window only after shutdown", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness({
        platform: "win32",
        activeProviderSessionCount: 1,
        providerDaemonDialogResponse: 0,
      });
      yield* Effect.gen(function* () {
        yield* (yield* DesktopLifecycle.DesktopLifecycle).register;
        const window = new EventEmitter();
        harness.getWindowCreatedListener()!(
          makeEvent().event,
          window as unknown as Electron.BrowserWindow,
        );
        const first = makeEvent();
        const duplicate = makeEvent();
        window.emit("close", first.event);
        window.emit("close", duplicate.event);
        yield* Deferred.await(harness.overlaySent);
        assert.equal(first.preventDefaultCount(), 1);
        assert.equal(duplicate.preventDefaultCount(), 1);
        assert.equal(harness.getProviderDaemonDialogCount(), 1);
        assert.equal(harness.getQuitCount(), 0);
        harness.getWindowAllClosedListener()!();
        yield* flushMicrotasks;
        assert.equal(harness.getRecoveredWindowCount(), 0);
        yield* (yield* DesktopLifecycle.DesktopShutdown).markComplete;
        yield* TestClock.adjust(DesktopLifecycle.DESKTOP_SHUTDOWN_OVERLAY_MINIMUM_DWELL);
        yield* flushMicrotasks;
        assert.equal(harness.getQuitCount(), 1);
        assert.equal(harness.getProviderDaemonStopCount(), 0);
        const finalClose = makeEvent();
        window.emit("close", finalClose.event);
        assert.equal(finalClose.preventDefaultCount(), 0);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  for (const platform of ["darwin", "linux"] as const) {
    it.effect(`preserves native window closing on ${platform}`, () =>
      Effect.gen(function* () {
        const harness = yield* makeLifecycleHarness({ platform });
        yield* Effect.gen(function* () {
          yield* (yield* DesktopLifecycle.DesktopLifecycle).register;
          assert.isUndefined(harness.getWindowCreatedListener());
        }).pipe(Effect.scoped, Effect.provide(harness.layer));
      }),
    );
  }

  it.effect("keeps the shutdown overlay visible for the minimum dwell before quitting", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();

      yield* Effect.gen(function* () {
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        const shutdown = yield* DesktopLifecycle.DesktopShutdown;
        yield* lifecycle.register;

        const beforeQuit = harness.getBeforeQuitListener();
        assert.isDefined(beforeQuit);
        if (!beforeQuit) {
          throw new Error("before-quit listener was not registered.");
        }
        const quitEvent = makeEvent();
        beforeQuit(quitEvent.event);

        yield* Deferred.await(harness.overlaySent);
        assert.equal(quitEvent.preventDefaultCount(), 1);
        assert.equal(harness.getShutdownOverlayCount(), 1);
        assert.equal(harness.getProviderDaemonDialogCount(), 0);

        yield* shutdown.markComplete;
        yield* TestClock.adjust(Duration.millis(2_999));
        yield* flushMicrotasks;
        assert.equal(harness.getQuitCount(), 0);

        yield* TestClock.adjust(Duration.millis(1));
        yield* flushMicrotasks;
        assert.equal(harness.getQuitCount(), 1);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("ignores duplicate quit requests while shutdown is already in progress", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();

      yield* Effect.gen(function* () {
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        const shutdown = yield* DesktopLifecycle.DesktopShutdown;
        yield* lifecycle.register;

        const beforeQuit = harness.getBeforeQuitListener();
        assert.isDefined(beforeQuit);
        if (!beforeQuit) {
          throw new Error("before-quit listener was not registered.");
        }
        const firstEvent = makeEvent();
        const secondEvent = makeEvent();

        beforeQuit(firstEvent.event);
        beforeQuit(secondEvent.event);

        yield* Deferred.await(harness.overlaySent);
        yield* flushMicrotasks;
        assert.equal(firstEvent.preventDefaultCount(), 1);
        assert.equal(secondEvent.preventDefaultCount(), 1);
        assert.equal(harness.getShutdownOverlayCount(), 1);

        yield* shutdown.markComplete;
        yield* TestClock.adjust(DesktopLifecycle.DESKTOP_SHUTDOWN_OVERLAY_MINIMUM_DWELL);
        yield* flushMicrotasks;
        assert.equal(harness.getQuitCount(), 1);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("activates the existing window when a second desktop instance starts", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();

      yield* Effect.gen(function* () {
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        yield* lifecycle.register;

        const secondInstance = harness.getSecondInstanceListener();
        assert.isDefined(secondInstance);
        if (!secondInstance) {
          throw new Error("second-instance listener was not registered.");
        }

        secondInstance({} as Electron.Event, ["Cafe Code"], "/repo", { source: "test" });
        yield* flushMicrotasks;

        assert.equal(harness.getActivateCount(), 1);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("stops the provider daemon when active sessions exist and the user chooses stop", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness({
        activeProviderSessionCount: 2,
        providerDaemonDialogResponse: 1,
      });

      yield* Effect.gen(function* () {
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        const shutdown = yield* DesktopLifecycle.DesktopShutdown;
        yield* lifecycle.register;

        const beforeQuit = harness.getBeforeQuitListener();
        assert.isDefined(beforeQuit);
        if (!beforeQuit) {
          throw new Error("before-quit listener was not registered.");
        }

        const quitEvent = makeEvent();
        beforeQuit(quitEvent.event);

        yield* Deferred.await(harness.overlaySent);
        assert.equal(quitEvent.preventDefaultCount(), 1);
        assert.equal(harness.getProviderDaemonDialogCount(), 1);

        yield* shutdown.markComplete;
        yield* TestClock.adjust(DesktopLifecycle.DESKTOP_SHUTDOWN_OVERLAY_MINIMUM_DWELL);
        yield* flushMicrotasks;
        assert.equal(harness.getProviderDaemonStopCount(), 1);
        assert.equal(harness.getQuitCount(), 1);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("cancels quit when active provider sessions exist and the user cancels", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness({
        activeProviderSessionCount: 1,
        providerDaemonDialogResponse: 2,
      });

      yield* Effect.gen(function* () {
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        yield* lifecycle.register;

        const beforeQuit = harness.getBeforeQuitListener();
        assert.isDefined(beforeQuit);
        if (!beforeQuit) {
          throw new Error("before-quit listener was not registered.");
        }

        const quitEvent = makeEvent();
        beforeQuit(quitEvent.event);
        yield* flushMicrotasks;

        assert.equal(quitEvent.preventDefaultCount(), 1);
        assert.equal(harness.getProviderDaemonDialogCount(), 1);
        assert.equal(harness.getShutdownOverlayCount(), 0);
        assert.equal(harness.getProviderDaemonStopCount(), 0);
        assert.equal(harness.getQuitCount(), 0);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );
});
