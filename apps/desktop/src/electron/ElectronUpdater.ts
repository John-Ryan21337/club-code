import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AppImageUpdater,
  DebUpdater,
  MacUpdater,
  NsisUpdater,
  PacmanUpdater,
  RpmUpdater,
} from "electron-updater";
import { ElectronAppAdapter } from "electron-updater/out/ElectronAppAdapter.js";

type AutoUpdater =
  | NsisUpdater
  | MacUpdater
  | AppImageUpdater
  | DebUpdater
  | RpmUpdater
  | PacmanUpdater;

class ReleaseAppAdapter extends ElectronAppAdapter {
  override get baseCachePath(): string {
    const root = process.env.CAFE_CODE_RELEASE_ROOT;
    if (!root || !path.isAbsolute(root))
      throw new Error("Club Code release storage is not initialized.");
    return path.join(root, ".club-runtime", "cache", "updates");
  }
}

// Keep the normal constructor: passing an adapter disables Electron's HTTP executor.
class ReleaseNsisUpdater extends NsisUpdater {
  protected override readonly app = new ReleaseAppAdapter();
}
class ReleaseMacUpdater extends MacUpdater {
  protected override readonly app = new ReleaseAppAdapter();
}
class ReleaseAppImageUpdater extends AppImageUpdater {
  protected override readonly app = new ReleaseAppAdapter();
}
class ReleaseDebUpdater extends DebUpdater {
  protected override readonly app = new ReleaseAppAdapter();
}
class ReleaseRpmUpdater extends RpmUpdater {
  protected override readonly app = new ReleaseAppAdapter();
}
class ReleasePacmanUpdater extends PacmanUpdater {
  protected override readonly app = new ReleaseAppAdapter();
}

export function createReleaseUpdater(platform = process.platform, packageType = ""): AutoUpdater {
  if (platform === "win32") return new ReleaseNsisUpdater();
  if (platform === "darwin") return new ReleaseMacUpdater();
  switch (packageType.trim()) {
    case "deb":
      return new ReleaseDebUpdater();
    case "rpm":
      return new ReleaseRpmUpdater();
    case "pacman":
      return new ReleasePacmanUpdater();
    default:
      return new ReleaseAppImageUpdater();
  }
}

let releaseUpdater: AutoUpdater | undefined;
function getUpdater(): AutoUpdater {
  if (releaseUpdater) return releaseUpdater;
  let packageType = "";
  if (process.platform !== "win32" && process.platform !== "darwin" && process.resourcesPath) {
    try {
      packageType = fs.readFileSync(path.join(process.resourcesPath, "package-type"), "utf8");
    } catch {
      /* Use AppImage when the package marker is absent. */
    }
  }
  releaseUpdater = createReleaseUpdater(process.platform, packageType);
  return releaseUpdater;
}

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export class ElectronUpdaterCheckForUpdatesError extends Data.TaggedError(
  "ElectronUpdaterCheckForUpdatesError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to check for updates.";
  }
}

export class ElectronUpdaterDownloadUpdateError extends Data.TaggedError(
  "ElectronUpdaterDownloadUpdateError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to download the update.";
  }
}

export class ElectronUpdaterQuitAndInstallError extends Data.TaggedError(
  "ElectronUpdaterQuitAndInstallError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to quit and install the update.";
  }
}

export type ElectronUpdaterError =
  | ElectronUpdaterCheckForUpdatesError
  | ElectronUpdaterDownloadUpdateError
  | ElectronUpdaterQuitAndInstallError;

export interface ElectronUpdaterShape {
  readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
  readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
  readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
  readonly setChannel: (channel: string) => Effect.Effect<void>;
  readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
  readonly allowDowngrade: Effect.Effect<boolean>;
  readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
  readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
  readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
  readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
  readonly quitAndInstall: (options: {
    readonly isSilent: boolean;
    readonly isForceRunAfter: boolean;
  }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
  readonly on: <Args extends ReadonlyArray<unknown>>(
    eventName: string,
    listener: (...args: Args) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronUpdater extends Context.Service<ElectronUpdater, ElectronUpdaterShape>()(
  "cafecode/desktop/electron/Updater",
) {}

export const layer = Layer.succeed(ElectronUpdater, {
  setFeedURL: (options) =>
    Effect.suspend(() => {
      getUpdater().setFeedURL(options);
      return Effect.void;
    }),
  setAutoDownload: (value) =>
    Effect.suspend(() => {
      getUpdater().autoDownload = value;
      return Effect.void;
    }),
  setAutoInstallOnAppQuit: (value) =>
    Effect.suspend(() => {
      getUpdater().autoInstallOnAppQuit = value;
      return Effect.void;
    }),
  setChannel: (channel) =>
    Effect.suspend(() => {
      getUpdater().channel = channel;
      return Effect.void;
    }),
  setAllowPrerelease: (value) =>
    Effect.suspend(() => {
      getUpdater().allowPrerelease = value;
      return Effect.void;
    }),
  allowDowngrade: Effect.sync(() => getUpdater().allowDowngrade),
  setAllowDowngrade: (value) =>
    Effect.suspend(() => {
      getUpdater().allowDowngrade = value;
      return Effect.void;
    }),
  setDisableDifferentialDownload: (value) =>
    Effect.suspend(() => {
      getUpdater().disableDifferentialDownload = value;
      return Effect.void;
    }),
  checkForUpdates: Effect.tryPromise({
    try: () => getUpdater().checkForUpdates(),
    catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ cause }),
  }).pipe(Effect.asVoid),
  downloadUpdate: Effect.tryPromise({
    try: () => getUpdater().downloadUpdate(),
    catch: (cause) => new ElectronUpdaterDownloadUpdateError({ cause }),
  }).pipe(Effect.asVoid),
  quitAndInstall: ({ isSilent, isForceRunAfter }) =>
    Effect.try({
      try: () => getUpdater().quitAndInstall(isSilent, isForceRunAfter),
      catch: (cause) => new ElectronUpdaterQuitAndInstallError({ cause }),
    }),
  on: (eventName, listener) => {
    const eventTarget = getUpdater() as unknown as {
      on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
      removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
    };
    const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
    return Effect.acquireRelease(
      Effect.sync(() => {
        eventTarget.on(eventName, untypedListener);
      }),
      () =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
        }),
    ).pipe(Effect.asVoid);
  },
} satisfies ElectronUpdaterShape);
