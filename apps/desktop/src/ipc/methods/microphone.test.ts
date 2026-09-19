import * as Effect from "effect/Effect";
import { expect, it, vi } from "vitest";
import * as DesktopIpc from "../DesktopIpc.ts";
import { requestMicrophoneAccess } from "./microphone.ts";
import { installTrustedMainFrameCameraPermission } from "../../window/DesktopCameraPermission.ts";

it("grants microphone access through validated IPC only for the exact live main frame", async () => {
  const origin = "http://127.0.0.1:3773";
  const frame = { url: `${origin}/chat`, origin, isDestroyed: () => false, top: null };
  const sender = {
    session: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() },
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false,
  };
  const remove = installTrustedMainFrameCameraPermission(sender, origin, () => true);
  let listener!: DesktopIpc.DesktopIpcHandleListener;
  const ipc = DesktopIpc.make({
    removeHandler: vi.fn(),
    handle: (_channel, registered) => {
      listener = registered;
    },
    removeAllListeners: vi.fn(),
    on: vi.fn(),
  });
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.trustWebContents(sender, origin);
          yield* ipc.handleFromSender(requestMicrophoneAccess);
          yield* Effect.promise(async () => {
            await expect(listener({ sender, senderFrame: frame }, undefined)).resolves.toBe(true);
            await expect(listener({ sender, senderFrame: { ...frame } }, undefined)).resolves.toBe(
              false,
            );
            await expect(
              listener({ sender, senderFrame: { ...frame, top: frame } }, undefined),
            ).rejects.toThrow("untrusted frame");
            await expect(listener({ sender: {}, senderFrame: frame }, undefined)).rejects.toThrow(
              "untrusted webContents",
            );
            await expect(
              listener(
                { sender, senderFrame: { ...frame, url: "https://foreign.example/" } },
                undefined,
              ),
            ).rejects.toThrow("untrusted frame URL");
          });
        }),
      ),
    );
  } finally {
    remove();
  }
});
