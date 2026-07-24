import { describe, expect, it, vi } from "vitest";

import type * as Electron from "electron";

import {
  installTrustedFrameAudioCapture,
  resolveTrustedFrameAudioGrant,
} from "./DesktopDisplayMediaCapture.ts";

function frame() {
  return {
    origin: "http://127.0.0.1:3773",
    isDestroyed: vi.fn(() => false),
  } as unknown as Electron.WebFrameMain;
}

function request(
  trustedFrame: Electron.WebFrameMain,
  patch: Partial<Electron.DisplayMediaRequestHandlerHandlerRequest> = {},
): Electron.DisplayMediaRequestHandlerHandlerRequest {
  return {
    frame: trustedFrame,
    securityOrigin: trustedFrame.origin,
    audioRequested: true,
    videoRequested: true,
    userGesture: true,
    ...patch,
  };
}

describe("desktop display-media audio capture", () => {
  it("grants only an explicit request from the exact trusted main frame", () => {
    const trustedFrame = frame();
    const trustedOrigin = trustedFrame.origin;
    expect(
      resolveTrustedFrameAudioGrant(request(trustedFrame), trustedFrame, trustedOrigin),
    ).toEqual({
      video: trustedFrame,
      audio: trustedFrame,
      enableLocalEcho: true,
    });
    expect(
      resolveTrustedFrameAudioGrant(
        request(trustedFrame, { userGesture: false }),
        trustedFrame,
        trustedOrigin,
      ),
    ).toBeNull();
    expect(
      resolveTrustedFrameAudioGrant(
        request(trustedFrame, { audioRequested: false }),
        trustedFrame,
        trustedOrigin,
      ),
    ).toBeNull();
    expect(
      resolveTrustedFrameAudioGrant(
        request(trustedFrame, { frame: frame() }),
        trustedFrame,
        trustedOrigin,
      ),
    ).toBeNull();
    expect(
      resolveTrustedFrameAudioGrant(
        request(trustedFrame, { securityOrigin: "https://attacker.example" }),
        trustedFrame,
        trustedOrigin,
      ),
    ).toBeNull();
    expect(
      resolveTrustedFrameAudioGrant(
        request(trustedFrame),
        trustedFrame,
        "https://attacker.example",
      ),
    ).toBeNull();
  });

  it("fails closed through Electron's handler and removes the grant on cleanup", () => {
    const setDisplayMediaRequestHandler = vi.fn();
    const trustedFrame = frame();
    const webContents = {
      session: { setDisplayMediaRequestHandler },
      mainFrame: trustedFrame,
    };
    const cleanup = installTrustedFrameAudioCapture(webContents, trustedFrame.origin);
    const [handler, options] = setDisplayMediaRequestHandler.mock.calls[0]!;
    expect(options).toEqual({ useSystemPicker: false });
    const callback = vi.fn();
    handler(request(trustedFrame, { userGesture: false }), callback);
    expect(callback).toHaveBeenCalledWith({});
    handler(request(trustedFrame), callback);
    expect(callback).toHaveBeenLastCalledWith({
      video: trustedFrame,
      audio: trustedFrame,
      enableLocalEcho: true,
    });

    cleanup();
    cleanup();
    expect(setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(null);
    expect(setDisplayMediaRequestHandler).toHaveBeenCalledTimes(2);
  });

  it("resolves the current main frame after a cross-process navigation", () => {
    const setDisplayMediaRequestHandler = vi.fn();
    const initialFrame = frame();
    const navigatedFrame = frame();
    const webContents = {
      session: { setDisplayMediaRequestHandler },
      mainFrame: initialFrame,
    };
    installTrustedFrameAudioCapture(webContents, navigatedFrame.origin);
    const [handler] = setDisplayMediaRequestHandler.mock.calls[0]!;
    webContents.mainFrame = navigatedFrame;

    const staleCallback = vi.fn();
    handler(request(initialFrame), staleCallback);
    expect(staleCallback).toHaveBeenCalledWith({});

    const currentCallback = vi.fn();
    handler(request(navigatedFrame), currentCallback);
    expect(currentCallback).toHaveBeenCalledWith({
      video: navigatedFrame,
      audio: navigatedFrame,
      enableLocalEcho: true,
    });
  });
});
