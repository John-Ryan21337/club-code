import type {
  DesktopLocalMediaCapability,
  DesktopLocalMediaKind,
  DesktopLocalMediaNavigateInput,
  DesktopLocalMediaReleaseInput,
  DesktopLocalMediaSelection,
} from "@cafecode/contracts";
import {
  MAX_DESKTOP_LOCAL_MEDIA_QUEUE_BYTES,
  MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS,
} from "@cafecode/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFs from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import * as NodeTimers from "node:timers";
import * as NodeUrl from "node:url";

import * as Electron from "electron";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import type { DesktopIpcWebContents } from "../ipc/DesktopIpc.ts";

const VLC_READY_TIMEOUT_MS = 8_000;
const VLC_READY_RETRY_MS = 50;
const VLC_UPSTREAM_RESPONSE_TIMEOUT_MS = 8_000;
const VLC_GRACEFUL_EXIT_TIMEOUT_MS = 2_000;
const VLC_FORCED_EXIT_TIMEOUT_MS = 1_000;
const VLC_PRIVATE_FILE_REMOVE_RETRIES = 20;
const VLC_PRIVATE_FILE_REMOVE_RETRY_MS = 50;
const SESSION_TOKEN_BYTES = 32;
const noop = (): void => undefined;

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "alac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "wma",
]);
const VIDEO_EXTENSIONS = new Set([
  "3gp",
  "avi",
  "flv",
  "m2ts",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "mts",
  "ogv",
  "ts",
  "webm",
  "wmv",
]);
const PICKER_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].toSorted();

export class DesktopVlcMediaError extends Data.TaggedError("DesktopVlcMediaError")<{
  readonly reason: string;
}> {
  override get message() {
    return this.reason;
  }
}

interface VlcChild {
  readonly pid?: number | undefined;
  readonly stdin: {
    write(value: string): boolean;
    end(): void;
    on(event: "error", listener: (error: Error) => void): unknown;
  } | null;
  readonly stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface DesktopVlcMediaDependencies {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly exists: (path: string) => Promise<boolean>;
  readonly getFileSize: (path: string) => Promise<number>;
  readonly showOpenDialog: (
    owner: DesktopIpcWebContents,
    options: Electron.OpenDialogOptions,
  ) => Promise<Electron.OpenDialogReturnValue>;
  readonly spawn: (
    executable: string,
    args: readonly string[],
    options: NodeChildProcess.SpawnOptions,
  ) => VlcChild;
  readonly reserveLoopbackPort: () => Promise<number>;
  readonly waitForLoopbackListener: (port: number, child: VlcChild) => Promise<void>;
  readonly createPrivatePlaylist: (mediaUrl: string, sessionId: string) => Promise<string>;
  readonly createPrivateConfig: (sout: string, sessionId: string) => Promise<string>;
  readonly removePrivateFile: (path: string) => Promise<void>;
  readonly randomToken: () => string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

interface QueueEntry {
  readonly path: string;
  readonly kind: DesktopLocalMediaKind;
  readonly displayTitle: string;
  readonly size: number;
}

interface LiveItem {
  readonly ownerId: number;
  readonly queue: QueueSession;
  readonly playbackUrl: string;
  readonly upstreamUrl: string;
  readonly child: VlcChild;
  readonly childExit: Promise<void>;
  readonly requestControllers: Set<AbortController>;
  privateLaunchPaths: readonly string[];
  childExited: boolean;
  stopped: boolean;
  stopPromise: Promise<void> | null;
}

interface QueueSession {
  readonly ownerId: number;
  readonly sessionId: string;
  readonly entries: readonly QueueEntry[];
  currentIndex: number;
  liveItem: LiveItem | null;
  stopped: boolean;
}

async function waitForChildExit(session: LiveItem, timeoutMs: number): Promise<boolean> {
  if (session.childExited) return true;
  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      session.childExit,
      new Promise<void>((resolve) => {
        timeout = NodeTimers.setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) NodeTimers.clearTimeout(timeout);
  }
  return session.childExited;
}

export interface DesktopVlcMediaShape {
  readonly capability: Effect.Effect<DesktopLocalMediaCapability>;
  readonly pick: (
    owner: DesktopIpcWebContents,
  ) => Effect.Effect<DesktopLocalMediaSelection | null, DesktopVlcMediaError>;
  readonly navigate: (
    owner: DesktopIpcWebContents,
    input: DesktopLocalMediaNavigateInput,
  ) => Effect.Effect<DesktopLocalMediaSelection | null, DesktopVlcMediaError>;
  readonly release: (
    owner: DesktopIpcWebContents,
    input: DesktopLocalMediaReleaseInput,
  ) => Effect.Effect<boolean>;
  readonly registerProtocol: Effect.Effect<
    void,
    ElectronProtocol.ElectronProtocolRegistrationError,
    import("effect/Scope").Scope
  >;
  readonly shutdown: Effect.Effect<void>;
}

export class DesktopVlcMedia extends Context.Service<DesktopVlcMedia, DesktopVlcMediaShape>()(
  "cafecode/desktop/media/VlcMedia",
) {}

function defaultVlcCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const explicitPath = env.CAFE_CODE_VLC_PATH?.trim();
  const explicit = explicitPath && NodePath.isAbsolute(explicitPath) ? [explicitPath] : [];
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    return [
      ...explicit,
      ...roots.map((root) =>
        root === env.LOCALAPPDATA
          ? NodePath.join(root, "Programs", "VideoLAN", "VLC", "vlc.exe")
          : NodePath.join(root, "VideoLAN", "VLC", "vlc.exe"),
      ),
    ];
  }
  if (platform === "darwin") {
    return [...explicit, "/Applications/VLC.app/Contents/MacOS/VLC"];
  }
  return [...explicit, "/usr/bin/vlc", "/usr/local/bin/vlc"];
}

async function resolveVlcExecutable(
  dependencies: DesktopVlcMediaDependencies,
): Promise<string | null> {
  for (const candidate of defaultVlcCandidates(dependencies.platform, dependencies.env)) {
    if (await dependencies.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function classifyMedia(path: string): DesktopLocalMediaKind | null {
  const extension = NodePath.extname(path).slice(1).toLowerCase();
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function displayTitle(path: string): string {
  const sanitizedTitle = [...NodePath.basename(path, NodePath.extname(path))]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 ||
        codePoint === 127 ||
        (codePoint >= 0x200e && codePoint <= 0x200f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
        ? " "
        : character;
    })
    .join("");
  const rawTitle = sanitizedTitle.replace(/\s+/g, " ").trim();
  const title = rawTitle.length > 0 ? rawTitle : "Local media";
  let boundedTitle = "";
  for (const character of title) {
    if (boundedTitle.length + character.length > 256) break;
    boundedTitle += character;
  }
  return boundedTitle;
}

function makeSout(kind: DesktopLocalMediaKind, port: number, token: string): string {
  if (kind === "audio") {
    return `#transcode{acodec=vorb,ab=96}:standard{access=http,mux=ogg,dst=127.0.0.1:${port}/${token}.ogg}`;
  }
  return `#transcode{vcodec=VP80,acodec=vorb,vb=1600,ab=128,scale=1}:standard{access=http,mux=webm,dst=127.0.0.1:${port}/${token}.webm}`;
}

function upstreamUrl(kind: DesktopLocalMediaKind, port: number, token: string): string {
  const extension = kind === "audio" ? "ogg" : "webm";
  return `http://127.0.0.1:${port}/${token}.${extension}`;
}

function makeVlcArgs(
  platform: NodeJS.Platform,
  configPath: string,
  playlistPath: string | null,
): readonly string[] {
  const base = [
    "--no-one-instance",
    platform === "win32" ? "--intf=dummy" : "--intf=rc",
    ...(platform === "win32" ? [] : ["--rc-fake-tty"]),
    "--no-video-title-show",
    "--no-sout-all",
    "--sout-keep",
    "--http-host=127.0.0.1",
    `--config=${configPath}`,
  ];
  return playlistPath ? [...base, playlistPath] : base;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function waitForLoopbackListener(port: number, child: VlcChild): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    child.once("error", () => finish(new Error("VLC failed to start.")));
    child.once("exit", () => finish(new Error("VLC exited before its stream was ready.")));

    const probe = () => {
      if (settled) return;
      const socket = NodeNet.createConnection({ host: "127.0.0.1", port });
      let retryScheduled = false;
      socket.setTimeout(VLC_READY_RETRY_MS);
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      const retry = () => {
        if (retryScheduled) return;
        retryScheduled = true;
        socket.destroy();
        if (settled) return;
        if (performance.now() - startedAt >= VLC_READY_TIMEOUT_MS) {
          finish(new Error("VLC stream startup timed out."));
          return;
        }
        NodeTimers.setTimeout(probe, VLC_READY_RETRY_MS);
      };
      socket.once("error", retry);
      socket.once("timeout", retry);
    };

    probe();
  });
}

async function reserveLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a loopback port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function defaultDependencies(): DesktopVlcMediaDependencies {
  return {
    platform: process.platform,
    env: process.env,
    exists: async (path) => {
      try {
        await NodeFs.promises.access(path, NodeFs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    getFileSize: async (path) => {
      // Do not let the picker turn a symlink, directory, device, FIFO, or
      // socket into a VLC input. `stat` alone follows links and would make the
      // selected path a mutable alias after operator confirmation.
      const stat = await NodeFs.promises.lstat(path);
      return stat.isFile() && !stat.isSymbolicLink() ? stat.size : -1;
    },
    showOpenDialog: async (owner, options) => {
      const browserWindow = Electron.BrowserWindow.fromWebContents(owner as Electron.WebContents);
      return browserWindow
        ? await Electron.dialog.showOpenDialog(browserWindow, options)
        : await Electron.dialog.showOpenDialog(options);
    },
    spawn: (executable, args, options) => NodeChildProcess.spawn(executable, args, options),
    reserveLoopbackPort,
    waitForLoopbackListener,
    createPrivatePlaylist: async (mediaUrl, sessionId) => {
      const playlistPath = NodePath.join(NodeOs.tmpdir(), `cafecode-media-${sessionId}.xspf`);
      const contents =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<playlist version="1" xmlns="http://xspf.org/ns/0/"><trackList><track>' +
        `<location>${escapeXmlText(mediaUrl)}</location>` +
        "</track></trackList></playlist>";
      await NodeFs.promises.writeFile(playlistPath, contents, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return playlistPath;
    },
    createPrivateConfig: async (sout, sessionId) => {
      const configPath = NodePath.join(NodeOs.tmpdir(), `cafecode-media-${sessionId}.conf`);
      await NodeFs.promises.writeFile(
        configPath,
        `sout=${sout}\nsout-keep=1\nno-sout-all=1\nhttp-host=127.0.0.1\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );
      return configPath;
    },
    removePrivateFile: async (path) => {
      await NodeFs.promises.rm(path, { force: true });
    },
    randomToken: () => NodeCrypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url"),
    fetch: (url, init) =>
      Electron.net.fetch(url, {
        ...init,
        bypassCustomProtocolHandlers: true,
      }),
  };
}

export function make(
  dependencies: DesktopVlcMediaDependencies,
  electronProtocol: ElectronProtocol.ElectronProtocolShape,
): DesktopVlcMediaShape {
  const sessionsByOwner = new Map<number, QueueSession>();
  const itemsByPlaybackUrl = new Map<string, LiveItem>();
  const activeItems = new Set<LiveItem>();
  const pendingPrivateFileCleanup = new Set<string>();
  const ownerOperationTails = new Map<number, Promise<void>>();
  const ownersWithDestroyCleanup = new WeakSet<object>();

  const capability = Effect.promise(async (): Promise<DesktopLocalMediaCapability> => {
    const executable = await resolveVlcExecutable(dependencies);
    return executable
      ? {
          available: true,
          engine: { label: "VLC", version: null, reason: null },
        }
      : {
          available: false,
          engine: {
            label: "VLC",
            version: null,
            reason: "VLC was not found in the configured or standard install locations.",
          },
        };
  });

  const removePrivateFiles = async (paths: readonly string[]): Promise<readonly string[]> => {
    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          await dependencies.removePrivateFile(path);
          return null;
        } catch {
          return path;
        }
      }),
    );
    return results.filter((path): path is string => path !== null);
  };

  const removePrivateFilesWithRetry = async (paths: readonly string[]): Promise<void> => {
    const uniquePaths = [...new Set(paths)];
    for (const path of uniquePaths) pendingPrivateFileCleanup.add(path);
    let remaining: readonly string[] = uniquePaths;
    for (let attempt = 0; attempt < VLC_PRIVATE_FILE_REMOVE_RETRIES; attempt += 1) {
      remaining = await removePrivateFiles(remaining);
      const remainingSet = new Set(remaining);
      for (const path of uniquePaths) {
        if (!remainingSet.has(path)) pendingPrivateFileCleanup.delete(path);
      }
      if (remaining.length === 0) return;
      if (attempt + 1 < VLC_PRIVATE_FILE_REMOVE_RETRIES) {
        await new Promise<void>((resolve) => {
          NodeTimers.setTimeout(resolve, VLC_PRIVATE_FILE_REMOVE_RETRY_MS);
        });
      }
    }
  };

  const stopItem = (item: LiveItem): Promise<void> => {
    if (item.stopPromise) return item.stopPromise;
    const stopPromise = (async () => {
      item.stopped = true;
      itemsByPlaybackUrl.delete(item.playbackUrl);
      if (item.queue.liveItem === item) item.queue.liveItem = null;
      const privateLaunchPaths = item.privateLaunchPaths;
      item.privateLaunchPaths = [];
      for (const controller of item.requestControllers) {
        controller.abort();
      }
      item.requestControllers.clear();
      if (!item.childExited) {
        try {
          item.child.stdin?.write("stop\nquit\n");
          item.child.stdin?.end();
        } catch {
          // The child has already closed its control stream.
        }
        try {
          item.child.kill();
        } catch {
          // Process exit raced cleanup.
        }
        await waitForChildExit(item, VLC_GRACEFUL_EXIT_TIMEOUT_MS);
      }
      if (!item.childExited) {
        try {
          item.child.kill("SIGKILL");
        } catch {
          // Process exit raced forced cleanup.
        }
        await waitForChildExit(item, VLC_FORCED_EXIT_TIMEOUT_MS);
      }
      await removePrivateFilesWithRetry(privateLaunchPaths);
      if (item.childExited) {
        activeItems.delete(item);
      }
    })().finally(() => {
      // A process that ignored both termination attempts remains tracked so a
      // later desktop shutdown or eventual exit can retry cleanup. Never turn
      // `child.kill()` (which only signals) into a false "terminated" claim.
      if (!item.childExited && activeItems.has(item)) {
        item.stopPromise = null;
      }
    });
    item.stopPromise = stopPromise;
    return stopPromise;
  };

  const stopQueue = async (queue: QueueSession): Promise<void> => {
    if (queue.stopped) {
      if (queue.liveItem) await stopItem(queue.liveItem);
      return;
    }
    queue.stopped = true;
    if (sessionsByOwner.get(queue.ownerId) === queue) sessionsByOwner.delete(queue.ownerId);
    if (queue.liveItem) await stopItem(queue.liveItem);
  };

  const withOwnerOperation = async <A>(
    ownerId: number,
    operation: () => Promise<A>,
  ): Promise<A> => {
    const previous = ownerOperationTails.get(ownerId) ?? Promise.resolve();
    let releaseTurn: () => void = noop;
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => turn);
    ownerOperationTails.set(ownerId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      releaseTurn();
      if (ownerOperationTails.get(ownerId) === tail) {
        ownerOperationTails.delete(ownerId);
      }
    }
  };

  const ensureOwnerCleanup = (owner: DesktopIpcWebContents): void => {
    if (!owner.once || ownersWithDestroyCleanup.has(owner)) return;
    ownersWithDestroyCleanup.add(owner);
    owner.once("destroyed", () => {
      if (typeof owner.id !== "number") return;
      const queue = sessionsByOwner.get(owner.id);
      if (queue) void stopQueue(queue);
    });
  };

  const release = (
    owner: DesktopIpcWebContents,
    input: DesktopLocalMediaReleaseInput,
  ): Effect.Effect<boolean> =>
    Effect.promise(() =>
      withOwnerOperation(owner.id ?? -1, async () => {
        if (typeof owner.id !== "number") return false;
        const queue = sessionsByOwner.get(owner.id);
        if (!queue || queue.sessionId !== input.sessionId) return false;
        await stopQueue(queue);
        return true;
      }),
    );

  const startItem = async (
    owner: DesktopIpcWebContents,
    executable: string,
    queue: QueueSession,
    index: number,
  ): Promise<DesktopLocalMediaSelection> => {
    if (queue.stopped || owner.isDestroyed?.() === true) {
      throw new DesktopVlcMediaError({ reason: "The media picker owner is unavailable." });
    }
    if (queue.liveItem) await stopItem(queue.liveItem);

    const entry = queue.entries[index];
    if (!entry) {
      throw new DesktopVlcMediaError({ reason: "The local media queue item is unavailable." });
    }
    const port = await dependencies.reserveLoopbackPort();
    const upstreamToken = dependencies.randomToken();
    const playbackToken = dependencies.randomToken();
    const launchId = dependencies.randomToken();
    const playbackUrl = `${ElectronProtocol.DESKTOP_MEDIA_SCHEME}://stream/${playbackToken}`;
    const sout = makeSout(entry.kind, port, upstreamToken);
    const mediaUrl = NodeUrl.pathToFileURL(entry.path).href;
    const playlistPath =
      dependencies.platform === "win32"
        ? await dependencies.createPrivatePlaylist(mediaUrl, launchId)
        : null;
    let configPath: string;
    try {
      configPath = await dependencies.createPrivateConfig(sout, launchId);
    } catch (cause) {
      if (playlistPath) await removePrivateFilesWithRetry([playlistPath]);
      throw cause;
    }
    const privateLaunchPaths = [configPath, ...(playlistPath ? [playlistPath] : [])];
    let child: VlcChild;
    try {
      child = dependencies.spawn(
        executable,
        makeVlcArgs(dependencies.platform, configPath, playlistPath),
        {
          shell: false,
          windowsHide: true,
          detached: false,
          stdio: [playlistPath ? "ignore" : "pipe", "ignore", "ignore"],
        },
      );
    } catch (cause) {
      await removePrivateFilesWithRetry(privateLaunchPaths);
      throw cause;
    }
    child.stdin?.on("error", () => undefined);
    let resolveChildExit: () => void = noop;
    const childExit = new Promise<void>((resolve) => {
      resolveChildExit = resolve;
    });
    const item: LiveItem = {
      ownerId: queue.ownerId,
      queue,
      playbackUrl,
      upstreamUrl: upstreamUrl(entry.kind, port, upstreamToken),
      child,
      childExit,
      requestControllers: new Set(),
      privateLaunchPaths,
      childExited: false,
      stopped: false,
      stopPromise: null,
    };
    const markChildExited = () => {
      if (item.childExited) return;
      item.childExited = true;
      resolveChildExit();
      void stopItem(item);
    };
    const handleChildError = () => {
      if (typeof child.pid !== "number") {
        markChildExited();
        return;
      }
      void stopItem(item);
    };
    queue.currentIndex = index;
    queue.liveItem = item;
    activeItems.add(item);
    itemsByPlaybackUrl.set(playbackUrl, item);
    child.once("exit", markChildExited);
    child.once("error", handleChildError);
    try {
      if (!playlistPath) child.stdin?.write(`add "${mediaUrl}"\n`);
      await dependencies.waitForLoopbackListener(port, child);
      if (item.stopped || queue.stopped || owner.isDestroyed?.() === true) {
        throw new Error("owner unavailable");
      }
      const pathsToRemove = item.privateLaunchPaths;
      item.privateLaunchPaths = await removePrivateFiles(pathsToRemove);
      return {
        sessionId: queue.sessionId,
        kind: entry.kind,
        displayTitle: entry.displayTitle,
        playbackUrl,
        currentIndex: index,
        totalItems: queue.entries.length,
        engine: { label: "VLC", version: null, reason: null },
      };
    } catch (cause) {
      await stopItem(item);
      throw cause;
    }
  };

  const startWithBoundedSkip = async (
    owner: DesktopIpcWebContents,
    executable: string,
    queue: QueueSession,
    startIndex: number,
    direction: 1 | -1,
  ): Promise<DesktopLocalMediaSelection> => {
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt < queue.entries.length; attempt += 1) {
      const index =
        (startIndex + direction * attempt + queue.entries.length * 2) % queue.entries.length;
      try {
        return await startItem(owner, executable, queue, index);
      } catch (cause) {
        lastFailure = cause;
        if (queue.stopped || owner.isDestroyed?.() === true) break;
      }
    }
    throw new DesktopVlcMediaError({
      reason:
        lastFailure instanceof DesktopVlcMediaError &&
        lastFailure.reason === "The media picker owner is unavailable."
          ? lastFailure.reason
          : "VLC could not start any supported item in the local media queue.",
    });
  };

  const pick = (
    owner: DesktopIpcWebContents,
  ): Effect.Effect<DesktopLocalMediaSelection | null, DesktopVlcMediaError> =>
    Effect.tryPromise({
      try: async () =>
        await withOwnerOperation(owner.id ?? -1, async () => {
          if (
            typeof owner.id !== "number" ||
            !Number.isSafeInteger(owner.id) ||
            owner.id <= 0 ||
            owner.isDestroyed?.() === true
          ) {
            throw new DesktopVlcMediaError({ reason: "The media picker owner is unavailable." });
          }

          const executable = await resolveVlcExecutable(dependencies);
          if (!executable) {
            throw new DesktopVlcMediaError({
              reason: "VLC was not found in the configured or standard install locations.",
            });
          }

          const picked = await dependencies.showOpenDialog(owner, {
            title: "Choose local media queue",
            properties: ["openFile", "multiSelections"],
            filters: [{ name: "Audio and video", extensions: PICKER_EXTENSIONS }],
          });
          if (picked.canceled || picked.filePaths.length === 0) return null;
          if (owner.isDestroyed?.() === true) {
            throw new DesktopVlcMediaError({ reason: "The media picker owner is unavailable." });
          }
          if (picked.filePaths.length > MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS) {
            throw new DesktopVlcMediaError({
              reason: `Choose no more than ${MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS} media files.`,
            });
          }
          const entries: QueueEntry[] = [];
          const seenPaths = new Set<string>();
          for (const path of picked.filePaths) {
            // Electron returns native paths. Normalize only for duplicate
            // detection; the original path remains private and is never sent
            // across the IPC boundary.
            const duplicateKey =
              dependencies.platform === "win32"
                ? NodePath.resolve(path).toLocaleLowerCase("en-US")
                : NodePath.resolve(path);
            if (seenPaths.has(duplicateKey)) {
              throw new DesktopVlcMediaError({
                reason: "Choose each local media file only once.",
              });
            }
            seenPaths.add(duplicateKey);
          }
          let totalBytes = 0;
          for (const path of picked.filePaths) {
            const kind = classifyMedia(path);
            if (!kind) {
              throw new DesktopVlcMediaError({
                reason: "The selection contains an unsupported media format.",
              });
            }
            const size = await dependencies.getFileSize(path);
            if (!Number.isSafeInteger(size) || size < 0) {
              throw new DesktopVlcMediaError({
                reason: "The selection contains an unavailable media file.",
              });
            }
            totalBytes += size;
            if (
              !Number.isSafeInteger(totalBytes) ||
              totalBytes > MAX_DESKTOP_LOCAL_MEDIA_QUEUE_BYTES
            ) {
              throw new DesktopVlcMediaError({
                reason: "The selected local media queue is too large.",
              });
            }
            entries.push({ path, kind, displayTitle: displayTitle(path), size });
          }

          const sessionId = dependencies.randomToken();
          const queue: QueueSession = {
            ownerId: owner.id,
            sessionId,
            entries,
            currentIndex: 0,
            liveItem: null,
            stopped: false,
          };
          const previous = sessionsByOwner.get(owner.id);
          if (previous) await stopQueue(previous);
          sessionsByOwner.set(owner.id, queue);
          ensureOwnerCleanup(owner);
          try {
            return await startWithBoundedSkip(owner, executable, queue, 0, 1);
          } catch {
            await stopQueue(queue);
            throw new DesktopVlcMediaError({
              reason: "VLC could not start the selected local media queue.",
            });
          }
        }),
      catch: (cause) =>
        cause instanceof DesktopVlcMediaError
          ? cause
          : new DesktopVlcMediaError({ reason: "VLC could not open the selected media." }),
    });

  const navigate = (
    owner: DesktopIpcWebContents,
    input: DesktopLocalMediaNavigateInput,
  ): Effect.Effect<DesktopLocalMediaSelection | null, DesktopVlcMediaError> =>
    Effect.tryPromise({
      try: () =>
        withOwnerOperation(owner.id ?? -1, async () => {
          if (typeof owner.id !== "number" || owner.isDestroyed?.() === true) return null;
          const queue = sessionsByOwner.get(owner.id);
          if (!queue || queue.sessionId !== input.sessionId || queue.stopped) return null;
          const executable = await resolveVlcExecutable(dependencies);
          if (!executable) {
            await stopQueue(queue);
            throw new DesktopVlcMediaError({ reason: "VLC is no longer available." });
          }
          const direction = input.direction === "previous" ? -1 : 1;
          const startIndex =
            (queue.currentIndex + direction + queue.entries.length) % queue.entries.length;
          try {
            return await startWithBoundedSkip(owner, executable, queue, startIndex, direction);
          } catch (cause) {
            await stopQueue(queue);
            throw cause;
          }
        }),
      catch: (cause) =>
        cause instanceof DesktopVlcMediaError
          ? cause
          : new DesktopVlcMediaError({ reason: "VLC could not navigate the local media queue." }),
    });

  const parseLiveRequest = (requestUrl: string): LiveItem | null => {
    try {
      const url = new URL(requestUrl);
      if (
        url.protocol !== `${ElectronProtocol.DESKTOP_MEDIA_SCHEME}:` ||
        url.hostname !== "stream" ||
        url.port.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.search.length > 0 ||
        url.hash.length > 0
      ) {
        return null;
      }
      return itemsByPlaybackUrl.get(url.href) ?? null;
    } catch {
      return null;
    }
  };

  const handleProtocolRequest = async (request: Request): Promise<Response> => {
    const item = parseLiveRequest(request.url);
    if (!item || item.stopped || (request.method !== "GET" && request.method !== "HEAD")) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) headers.set("range", range.slice(0, 256));

    const controller = new AbortController();
    item.requestControllers.add(controller);
    const timeout = NodeTimers.setTimeout(
      () => controller.abort(),
      VLC_UPSTREAM_RESPONSE_TIMEOUT_MS,
    );
    let responseOwnsController = false;
    let controllerReleased = false;
    const releaseController = () => {
      if (controllerReleased) return;
      controllerReleased = true;
      item.requestControllers.delete(controller);
    };
    try {
      const upstream = await dependencies.fetch(item.upstreamUrl, {
        method: request.method,
        headers,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      const responseHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      });
      for (const name of ["accept-ranges", "content-length", "content-range", "content-type"]) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      let body: ReadableStream<Uint8Array> | null = null;
      if (request.method !== "HEAD" && upstream.body !== null) {
        const upstreamReader = upstream.body.getReader();
        responseOwnsController = true;
        body = new ReadableStream<Uint8Array>({
          pull: async (downstream) => {
            try {
              const chunk = await upstreamReader.read();
              if (chunk.done) {
                releaseController();
                downstream.close();
              } else {
                downstream.enqueue(chunk.value);
              }
            } catch (error) {
              releaseController();
              downstream.error(error);
            }
          },
          cancel: async (reason) => {
            controller.abort();
            try {
              await upstreamReader.cancel(reason);
            } finally {
              releaseController();
            }
          },
        });
      }
      return new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return new Response(null, {
        status: 502,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    } finally {
      NodeTimers.clearTimeout(timeout);
      if (!responseOwnsController) releaseController();
    }
  };

  const registerProtocol = electronProtocol.registerResponseProtocol({
    scheme: ElectronProtocol.DESKTOP_MEDIA_SCHEME,
    handler: (request) => Effect.promise(() => handleProtocolRequest(request)),
    authorizeRequest: (requestUrl, webContentsId) => {
      const session = parseLiveRequest(requestUrl);
      return session !== null && webContentsId === session.ownerId;
    },
  });

  const shutdown = Effect.promise(async () => {
    await Promise.all([...sessionsByOwner.values()].map(stopQueue));
    await Promise.all([...activeItems].map(stopItem));
    if (pendingPrivateFileCleanup.size > 0) {
      await removePrivateFilesWithRetry([...pendingPrivateFileCleanup]);
    }
  });

  return DesktopVlcMedia.of({
    capability,
    pick,
    navigate,
    release,
    registerProtocol,
    shutdown,
  });
}

const makeService = Effect.gen(function* () {
  const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
  return make(defaultDependencies(), electronProtocol);
});

export const layer = Layer.effect(
  DesktopVlcMedia,
  Effect.acquireRelease(makeService, (service) => service.shutdown),
);
