import * as Effect from "effect/Effect";
import type * as NodeChildProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  net: { fetch: vi.fn() },
}));

import type * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as DesktopVlcMedia from "./DesktopVlcMedia.ts";

const noop = (): void => undefined;

class MockVlcChild extends EventEmitter {
  readonly pid = 12_345;
  readonly writes: string[] = [];
  readonly stdin = {
    write: (value: string) => {
      this.writes.push(value);
      return true;
    },
    end: vi.fn(),
    on: vi.fn(),
  };
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  });
}

interface CapturedProtocol {
  readonly scheme: string;
  readonly handler: (request: Request) => Effect.Effect<Response, unknown>;
  readonly authorizeRequest?: (requestUrl: string, webContentsId: number | undefined) => boolean;
}

function makeHarness(input?: {
  readonly canceled?: boolean;
  readonly exists?: boolean;
  readonly filePath?: string;
  readonly filePaths?: readonly string[];
  readonly platform?: NodeJS.Platform;
}) {
  const children: MockVlcChild[] = [];
  const tokens = [
    "s".repeat(43),
    "u".repeat(43),
    "p".repeat(43),
    "v".repeat(43),
    "t".repeat(43),
    "w".repeat(43),
    "x".repeat(43),
    "y".repeat(43),
  ];
  const spawn = vi.fn(
    (_executable: string, _args: readonly string[], _options: NodeChildProcess.SpawnOptions) => {
      const child = new MockVlcChild();
      children.push(child);
      return child;
    },
  );
  const fetch = vi.fn(async () => {
    return new Response("transcoded", {
      status: 200,
      headers: {
        "Content-Type": "video/webm",
        "X-Upstream-Secret": "must-not-pass-through",
      },
    });
  });
  let capturedProtocol: CapturedProtocol | null = null;
  const protocol = {
    registerFileProtocol: () => Effect.void,
    registerResponseProtocol: (registration: CapturedProtocol) =>
      Effect.sync(() => {
        capturedProtocol = registration;
      }),
    registerDesktopFileProtocol: Effect.void,
  } as unknown as ElectronProtocol.ElectronProtocolShape;
  const dependencies: DesktopVlcMedia.DesktopVlcMediaDependencies = {
    platform: input?.platform ?? "win32",
    env: {
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
    exists: vi.fn(async () => input?.exists ?? true),
    getFileSize: vi.fn(async () => 1024),
    showOpenDialog: vi.fn(async () => ({
      canceled: input?.canceled ?? false,
      filePaths: input?.canceled
        ? []
        : [
            ...(input?.filePaths ?? [
              input?.filePath ?? "C:\\Users\\private-user\\Videos\\holiday.flv",
            ]),
          ],
    })),
    spawn,
    reserveLoopbackPort: vi.fn(async () => 45_555),
    waitForLoopbackListener: vi.fn(async () => undefined),
    createPrivatePlaylist: vi.fn(
      async (_mediaUrl, sessionId) => `C:\\Temp\\cafecode-media-${sessionId}.xspf`,
    ),
    createPrivateConfig: vi.fn(
      async (_sout, sessionId) => `C:\\Temp\\cafecode-media-${sessionId}.conf`,
    ),
    removePrivateFile: vi.fn(async () => undefined),
    randomToken: () => tokens.shift() ?? "z".repeat(43),
    fetch,
  };
  const media = DesktopVlcMedia.make(dependencies, protocol);
  return {
    children,
    dependencies,
    fetch,
    getCapturedProtocol: () => capturedProtocol,
    media,
    spawn,
  };
}

describe("DesktopVlcMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the selected path out of argv and exposes only the opaque protocol URL", async () => {
    const harness = makeHarness();
    const owner = { id: 42, isDestroyed: () => false, once: vi.fn() };
    await Effect.runPromise(Effect.scoped(harness.media.registerProtocol));

    const selection = await Effect.runPromise(harness.media.pick(owner));

    expect(selection).toEqual({
      sessionId: "s".repeat(43),
      kind: "video",
      displayTitle: "holiday",
      playbackUrl: `cafecode-media://stream/${"p".repeat(43)}`,
      currentIndex: 0,
      totalItems: 1,
      engine: { label: "VLC", version: null, reason: null },
    });
    expect(JSON.stringify(selection)).not.toContain("private-user");
    expect(JSON.stringify(selection)).not.toContain("45555");
    expect(JSON.stringify(selection)).not.toContain("u".repeat(43));

    const [executable, args, options] = harness.spawn.mock.calls[0] ?? [];
    expect(executable).toBe("C:\\Program Files\\VideoLAN\\VLC\\vlc.exe");
    expect(args).toContain("--http-host=127.0.0.1");
    expect(args).toContain("--no-one-instance");
    expect(args).toContain("--no-video-title-show");
    expect(args?.join(" ")).not.toContain("private-user");
    expect(args?.join(" ")).not.toContain("45555");
    expect(args?.join(" ")).not.toContain("u".repeat(43));
    expect(args?.join(" ")).not.toContain("s".repeat(43));
    expect(args?.join(" ")).not.toContain("p".repeat(43));
    expect(harness.dependencies.createPrivateConfig).toHaveBeenCalledWith(
      expect.stringContaining("dst=127.0.0.1:45555/"),
      "v".repeat(43),
    );
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
    expect(harness.children[0]?.writes).toEqual([]);
    expect(harness.dependencies.createPrivatePlaylist).toHaveBeenCalledWith(
      "file:///C:/Users/private-user/Videos/holiday.flv",
      "v".repeat(43),
    );
    expect(args).toContain(`C:\\Temp\\cafecode-media-${"v".repeat(43)}.xspf`);
    expect(args).toContain(`--config=C:\\Temp\\cafecode-media-${"v".repeat(43)}.conf`);
    expect(harness.dependencies.removePrivateFile).toHaveBeenCalledWith(
      `C:\\Temp\\cafecode-media-${"v".repeat(43)}.xspf`,
    );
    expect(harness.dependencies.removePrivateFile).toHaveBeenCalledWith(
      `C:\\Temp\\cafecode-media-${"v".repeat(43)}.conf`,
    );

    const protocol = harness.getCapturedProtocol();
    expect(protocol?.scheme).toBe("cafecode-media");
    expect(protocol?.authorizeRequest?.(selection?.playbackUrl ?? "", 42)).toBe(true);
    expect(protocol?.authorizeRequest?.(selection?.playbackUrl ?? "", 41)).toBe(false);
    expect(
      protocol?.authorizeRequest?.(`${selection?.playbackUrl ?? ""}?unexpected=true`, 42),
    ).toBe(false);

    const response = await Effect.runPromise(
      protocol?.handler(new Request(selection?.playbackUrl ?? "")) ??
        Effect.succeed(new Response(null, { status: 500 })),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.has("x-upstream-secret")).toBe(false);
    expect(harness.fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:45555/${"u".repeat(43)}.webm`,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects a selected container outside the explicit VLC format allowlist", async () => {
    const harness = makeHarness({ filePath: "C:\\Users\\private-user\\Videos\\archive.mxf" });

    await expect(Effect.runPromise(harness.media.pick({ id: 42 }))).rejects.toThrow(
      "unsupported media format",
    );
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it("replaces and releases only the invoking renderer's exact session", async () => {
    const harness = makeHarness();
    const owner = { id: 42, isDestroyed: () => false, once: vi.fn() };
    const first = await Effect.runPromise(harness.media.pick(owner));
    const second = await Effect.runPromise(harness.media.pick(owner));

    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
    expect(owner.once).toHaveBeenCalledTimes(1);
    expect(
      await Effect.runPromise(harness.media.release({ id: 7 }, { sessionId: second!.sessionId })),
    ).toBe(false);
    expect(
      await Effect.runPromise(
        harness.media.release(owner, {
          sessionId: first!.sessionId,
        }),
      ),
    ).toBe(false);
    expect(
      await Effect.runPromise(
        harness.media.release(owner, {
          sessionId: second!.sessionId,
        }),
      ),
    ).toBe(true);
    expect(harness.children[1]?.kill).toHaveBeenCalledTimes(1);
  });

  it("owns a multi-file queue and lazily replaces one VLC child during navigation", async () => {
    const harness = makeHarness({
      filePaths: [
        "C:\\Users\\private-user\\Music\\first.mp3",
        "C:\\Users\\private-user\\Videos\\second.flv",
      ],
    });
    const owner = { id: 42, isDestroyed: () => false, once: vi.fn() };

    const first = await Effect.runPromise(harness.media.pick(owner));
    expect(first).toMatchObject({
      sessionId: "s".repeat(43),
      displayTitle: "first",
      currentIndex: 0,
      totalItems: 2,
      kind: "audio",
    });
    expect(harness.spawn).toHaveBeenCalledTimes(1);

    const second = await Effect.runPromise(
      harness.media.navigate(owner, { sessionId: first!.sessionId, direction: "next" }),
    );
    expect(second).toMatchObject({
      sessionId: first!.sessionId,
      displayTitle: "second",
      currentIndex: 1,
      totalItems: 2,
      kind: "video",
    });
    expect(second?.playbackUrl).not.toBe(first?.playbackUrl);
    expect(harness.spawn).toHaveBeenCalledTimes(2);
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
    expect(harness.children[1]?.kill).not.toHaveBeenCalled();
    expect(JSON.stringify(second)).not.toContain("private-user");
    expect(harness.spawn.mock.calls[1]?.[1].join(" ")).not.toContain("second.flv");
  });

  it("bounded-skips a VLC startup failure without launching the whole queue", async () => {
    const harness = makeHarness({
      filePaths: [
        "C:\\Users\\private-user\\Videos\\broken.flv",
        "C:\\Users\\private-user\\Music\\working.mp3",
        "C:\\Users\\private-user\\Videos\\later.mp4",
      ],
    });
    let readinessCalls = 0;
    vi.mocked(harness.dependencies.waitForLoopbackListener).mockImplementation(async () => {
      readinessCalls += 1;
      if (readinessCalls === 1) throw new Error("decoder rejected input");
    });

    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));

    expect(selection).toMatchObject({
      displayTitle: "working",
      currentIndex: 1,
      totalItems: 3,
      kind: "audio",
    });
    expect(harness.spawn).toHaveBeenCalledTimes(2);
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
    expect(harness.children[1]?.kill).not.toHaveBeenCalled();
  });

  it("terminates after one bounded pass when every VLC queue item fails", async () => {
    const harness = makeHarness({
      filePaths: [
        "C:\\Users\\private-user\\Videos\\broken.flv",
        "C:\\Users\\private-user\\Music\\also-broken.mp3",
      ],
    });
    vi.mocked(harness.dependencies.waitForLoopbackListener).mockRejectedValue(
      new Error("decoder rejected input"),
    );

    await expect(Effect.runPromise(harness.media.pick({ id: 42 }))).rejects.toThrow(
      "could not start the selected local media queue",
    );
    expect(harness.spawn).toHaveBeenCalledTimes(2);
    expect(harness.children.every((child) => child.kill.mock.calls.length === 1)).toBe(true);
  });

  it("restarts a one-item VLC queue on next without changing its queue identity", async () => {
    const harness = makeHarness();
    const owner = { id: 42, isDestroyed: () => false };
    const first = await Effect.runPromise(harness.media.pick(owner));

    const replay = await Effect.runPromise(
      harness.media.navigate(owner, { sessionId: first!.sessionId, direction: "next" }),
    );

    expect(replay).toMatchObject({
      sessionId: first!.sessionId,
      currentIndex: 0,
      totalItems: 1,
    });
    expect(replay?.playbackUrl).not.toBe(first?.playbackUrl);
    expect(harness.spawn).toHaveBeenCalledTimes(2);
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it("rejects queue count and aggregate byte caps before launching VLC", async () => {
    const tooMany = makeHarness({
      filePaths: Array.from(
        { length: 65 },
        (_, index) => `C:\\Users\\private-user\\Videos\\clip-${index}.mp4`,
      ),
    });
    await expect(Effect.runPromise(tooMany.media.pick({ id: 42 }))).rejects.toThrow(
      "no more than 64",
    );
    expect(tooMany.spawn).not.toHaveBeenCalled();
    expect(tooMany.dependencies.getFileSize).not.toHaveBeenCalled();

    const tooLarge = makeHarness({
      filePaths: [
        "C:\\Users\\private-user\\Videos\\one.mp4",
        "C:\\Users\\private-user\\Videos\\two.mp4",
      ],
    });
    vi.mocked(tooLarge.dependencies.getFileSize).mockResolvedValue(40 * 1024 * 1024 * 1024);
    await expect(Effect.runPromise(tooLarge.media.pick({ id: 42 }))).rejects.toThrow("too large");
    expect(tooLarge.spawn).not.toHaveBeenCalled();
  });

  it("rejects duplicate picker paths before it starts VLC", async () => {
    const harness = makeHarness({
      filePaths: [
        "C:\\Users\\private-user\\Videos\\same.mp4",
        "C:\\Users\\private-user\\Videos\\SAME.mp4",
      ],
    });

    await expect(Effect.runPromise(harness.media.pick({ id: 42 }))).rejects.toThrow("only once");
    expect(harness.dependencies.getFileSize).not.toHaveBeenCalled();
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it("removes bidi controls from the only title returned to the renderer", async () => {
    const harness = makeHarness({ filePath: "C:\\Users\\private-user\\Videos\\clip\u202Emp4.mkv" });

    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));

    expect(selection?.displayTitle).toBe("clip mp4");
    expect(selection?.displayTitle).not.toContain("\u202E");
  });

  it("cleans the current child and private files when its renderer owner is destroyed", async () => {
    const harness = makeHarness();
    const listeners: { destroyed?: () => void } = {};
    const owner = {
      id: 42,
      isDestroyed: () => false,
      once: vi.fn((_event: "destroyed", listener: () => void) => {
        listeners.destroyed = listener;
      }),
    };
    const selection = await Effect.runPromise(harness.media.pick(owner));

    listeners.destroyed?.();
    await vi.waitFor(() => expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1));
    expect(
      await Effect.runPromise(harness.media.release(owner, { sessionId: selection!.sessionId })),
    ).toBe(false);
  });

  it("returns an honest unavailable capability and does not open the picker", async () => {
    const harness = makeHarness({ exists: false });

    const capability = await Effect.runPromise(harness.media.capability);

    expect(capability.available).toBe(false);
    expect(capability.engine.label).toBe("VLC");
    expect(capability.engine.reason).toContain("not found");
    await expect(Effect.runPromise(harness.media.pick({ id: 42 }))).rejects.toThrow(
      "VLC was not found",
    );
    expect(harness.dependencies.showOpenDialog).not.toHaveBeenCalled();
  });

  it("does not start VLC when the native picker is canceled", async () => {
    const harness = makeHarness({ canceled: true });

    await expect(Effect.runPromise(harness.media.pick({ id: 42 }))).resolves.toBeNull();
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it("preserves the POSIX RC-stdin path without creating a temporary playlist", async () => {
    const harness = makeHarness({
      platform: "linux",
      // Filesystem fixtures stay host-native even while command policy is
      // simulated as Linux.
      filePath: "C:\\Users\\private-user\\Music\\song.flac",
    });

    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));
    const [, args, options] = harness.spawn.mock.calls[0] ?? [];

    expect(selection?.kind).toBe("audio");
    expect(args).toContain("--intf=rc");
    expect(args).toContain("--rc-fake-tty");
    expect(args?.join(" ")).not.toContain("private-user");
    expect(options?.stdio).toEqual(["pipe", "ignore", "ignore"]);
    expect(harness.dependencies.createPrivatePlaylist).not.toHaveBeenCalled();
    expect(harness.children[0]?.writes).toEqual([
      'add "file:///C:/Users/private-user/Music/song.flac"\n',
    ]);
  });

  it("fails closed for malformed protocol requests and cleans up on child failure", async () => {
    const harness = makeHarness();
    await Effect.runPromise(Effect.scoped(harness.media.registerProtocol));
    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));
    const protocol = harness.getCapturedProtocol();

    const malformed = await Effect.runPromise(
      protocol?.handler(new Request(`${selection!.playbackUrl}/extra`)) ??
        Effect.succeed(new Response(null, { status: 500 })),
    );
    expect(malformed.status).toBe(404);
    expect(harness.fetch).not.toHaveBeenCalled();

    harness.children[0]?.emit("exit", 1, null);
    expect(protocol?.authorizeRequest?.(selection!.playbackUrl, 42)).toBe(false);
  });

  it("bounds a stalled VLC loopback response", async () => {
    const harness = makeHarness();
    vi.mocked(harness.dependencies.fetch).mockImplementation(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("timed out")), {
            once: true,
          });
        }),
    );
    await Effect.runPromise(Effect.scoped(harness.media.registerProtocol));
    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));
    const protocol = harness.getCapturedProtocol();

    vi.useFakeTimers();
    try {
      const response = Effect.runPromise(
        protocol?.handler(new Request(selection!.playbackUrl)) ??
          Effect.succeed(new Response(null, { status: 500 })),
      );
      await vi.advanceTimersByTimeAsync(8_000);
      expect((await response).status).toBe(502);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not return a session if VLC exits immediately after readiness", async () => {
    const harness = makeHarness();
    vi.mocked(harness.dependencies.waitForLoopbackListener).mockImplementation(
      async (_port, child) => {
        (child as MockVlcChild).emit("exit", 1, null);
      },
    );

    await expect(Effect.runPromise(harness.media.pick({ id: 42 }))).rejects.toThrow(
      "VLC could not start the selected local media queue",
    );
    // The process already emitted its terminal exit; cleanup must not pretend
    // it needs another termination signal.
    expect(harness.children[0]?.kill).not.toHaveBeenCalled();
  });

  it("aborts an in-flight loopback response before releasing the VLC process", async () => {
    const harness = makeHarness();
    vi.mocked(harness.dependencies.fetch).mockImplementation(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("released")), {
            once: true,
          });
        }),
    );
    await Effect.runPromise(Effect.scoped(harness.media.registerProtocol));
    const owner = { id: 42 };
    const selection = await Effect.runPromise(harness.media.pick(owner));
    const protocol = harness.getCapturedProtocol();
    const responsePromise = Effect.runPromise(
      protocol?.handler(new Request(selection!.playbackUrl)) ??
        Effect.succeed(new Response(null, { status: 500 })),
    );
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1));

    await expect(
      Effect.runPromise(harness.media.release(owner, { sessionId: selection!.sessionId })),
    ).resolves.toBe(true);
    await expect(responsePromise).resolves.toMatchObject({ status: 502 });
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it("keeps a streaming response abortable after VLC has returned its headers", async () => {
    const harness = makeHarness();
    const captured: { signal: AbortSignal | null } = { signal: null };
    const cancelBody = vi.fn();
    vi.mocked(harness.dependencies.fetch).mockImplementation(async (_url, init) => {
      captured.signal = init.signal ?? null;
      return new Response(
        new ReadableStream({
          cancel: cancelBody,
        }),
        { status: 200, headers: { "Content-Type": "video/webm" } },
      );
    });
    await Effect.runPromise(Effect.scoped(harness.media.registerProtocol));
    const owner = { id: 42 };
    const selection = await Effect.runPromise(harness.media.pick(owner));
    const protocol = harness.getCapturedProtocol();

    const response = await Effect.runPromise(
      protocol?.handler(new Request(selection!.playbackUrl)) ??
        Effect.succeed(new Response(null, { status: 500 })),
    );
    expect(response.status).toBe(200);
    expect(captured.signal?.aborted).toBe(false);

    await Effect.runPromise(harness.media.release(owner, { sessionId: selection!.sessionId }));

    expect(captured.signal?.aborted).toBe(true);
    await response.body?.cancel();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a running child's error event for process exit", async () => {
    const harness = makeHarness();
    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));
    const child = harness.children[0]!;
    child.kill.mockImplementation(() => true);

    child.emit("error", new Error("termination signal was rejected"));
    // Cleanup signals a still-running child. Treating `error` as terminal
    // would skip this call and falsely report that the process had exited.
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("exit", 0, null);
    await Effect.runPromise(harness.media.shutdown);
    expect(
      await Effect.runPromise(
        harness.media.release({ id: 42 }, { sessionId: selection!.sessionId }),
      ),
    ).toBe(false);
  });

  it("terminates every owned child when the desktop media scope shuts down", async () => {
    const harness = makeHarness();
    await Effect.runPromise(Effect.scoped(harness.media.registerProtocol));
    const selection = await Effect.runPromise(harness.media.pick({ id: 42 }));
    const protocol = harness.getCapturedProtocol();

    await Effect.runPromise(harness.media.shutdown);

    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
    expect(protocol?.authorizeRequest?.(selection!.playbackUrl, 42)).toBe(false);
  });

  it("awaits renderer-destroy cleanup that is already in flight during shutdown", async () => {
    const harness = makeHarness();
    let playlistRemoveAttempts = 0;
    let markCleanupStarted: () => void = noop;
    let releaseCleanup: () => void = noop;
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.mocked(harness.dependencies.removePrivateFile).mockImplementation(async (path) => {
      if (!path.endsWith(".xspf")) return;
      playlistRemoveAttempts += 1;
      if (playlistRemoveAttempts === 1) {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
      if (playlistRemoveAttempts === 2) {
        markCleanupStarted();
        await cleanupGate;
      }
    });

    await Effect.runPromise(harness.media.pick({ id: 42 }));
    harness.children[0]?.emit("exit", 0, null);
    await cleanupStarted;

    let shutdownFinished = false;
    const shutdown = Effect.runPromise(harness.media.shutdown).then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    releaseCleanup();
    await shutdown;
    expect(shutdownFinished).toBe(true);
  });

  it("never consults PATH while discovering VLC", async () => {
    const harness = makeHarness({ exists: false });
    harness.dependencies.env.PATH = "C:\\untrusted-bin";

    await Effect.runPromise(harness.media.capability);

    expect(harness.dependencies.exists).not.toHaveBeenCalledWith(
      expect.stringContaining("untrusted-bin"),
    );
  });

  it("serializes concurrent picks from one renderer so only one child is live", async () => {
    const harness = makeHarness();
    let releaseFirstReadiness: () => void = noop;
    let readinessCalls = 0;
    vi.mocked(harness.dependencies.waitForLoopbackListener).mockImplementation(async () => {
      readinessCalls += 1;
      if (readinessCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstReadiness = resolve;
        });
      }
    });
    const owner = { id: 42, isDestroyed: () => false };

    const firstPick = Effect.runPromise(harness.media.pick(owner));
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    const secondPick = Effect.runPromise(harness.media.pick(owner));
    await Promise.resolve();
    expect(harness.spawn).toHaveBeenCalledTimes(1);

    releaseFirstReadiness();
    await firstPick;
    await secondPick;

    expect(harness.spawn).toHaveBeenCalledTimes(2);
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it("retains an EBUSY launch file and retries deletion after child termination", async () => {
    const harness = makeHarness();
    let playlistRemoveAttempts = 0;
    vi.mocked(harness.dependencies.removePrivateFile).mockImplementation(async (path) => {
      if (path.endsWith(".xspf")) {
        playlistRemoveAttempts += 1;
        if (playlistRemoveAttempts === 1) {
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        }
      }
    });
    const owner = { id: 42 };
    const selection = await Effect.runPromise(harness.media.pick(owner));

    expect(playlistRemoveAttempts).toBe(1);
    await Effect.runPromise(
      harness.media.release(owner, {
        sessionId: selection!.sessionId,
      }),
    );

    expect(playlistRemoveAttempts).toBe(2);
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(1);
  });
});
