import { describe, expect, it, vi } from "vitest";

import type * as Electron from "electron";

import {
  installTrustedFrameAudioCapture,
  resolveTrustedFrameAudioGrant,
} from "./DesktopDisplayMediaCapture.ts";

function frame() {
  return {
    origin: "http://127.0.0.1:3773",
    visibilityState: "visible",
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
  it("accepts Electron's root-slash origin serialization without accepting other URLs", () => {
    const trustedFrame = frame();
    expect(
      resolveTrustedFrameAudioGrant(
        request(trustedFrame, { securityOrigin: `${trustedFrame.origin}/` }),
        trustedFrame,
        trustedFrame.origin,
      ),
    ).toEqual({ video: trustedFrame, audio: trustedFrame, enableLocalEcho: true });
    for (const securityOrigin of [
      `${trustedFrame.origin}/path`,
      `${trustedFrame.origin}/?secret=value`,
      `${trustedFrame.origin}/#fragment`,
      `${trustedFrame.origin}//`,
      "http://user@127.0.0.1:3773/",
      "http://127.0.0.1:3774/",
    ]) {
      expect(
        resolveTrustedFrameAudioGrant(
          request(trustedFrame, { securityOrigin }),
          trustedFrame,
          trustedFrame.origin,
        ),
      ).toBeNull();
    }
  });

  it("contains Electron callback failures without a second grant or raw logging", () => {
    const setDisplayMediaRequestHandler = vi.fn();
    const trustedFrame = frame();
    installTrustedFrameAudioCapture(
      {
        session: { setDisplayMediaRequestHandler },
        mainFrame: trustedFrame,
        isDestroyed: () => false,
        isFocused: () => true,
      },
      trustedFrame.origin,
    );
    const [handler] = setDisplayMediaRequestHandler.mock.calls[0]!;
    for (const userGesture of [false, true]) {
      const callback = vi.fn(() => {
        throw new Error("synthetic native callback failure");
      });
      expect(() => handler(request(trustedFrame, { userGesture }), callback)).not.toThrow();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        userGesture ? { video: trustedFrame, audio: trustedFrame, enableLocalEcho: true } : {},
      );
    }
  });

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
      isDestroyed: () => false,
      isFocused: () => true,
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
      isDestroyed: () => false,
      isFocused: () => true,
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

it("refuses hidden or unfocused capture and cannot clear a replacement session owner", () => {
  const session = { setDisplayMediaRequestHandler: vi.fn() },
    trustedFrame = frame();
  let focused = true;
  const webContents = {
    session,
    mainFrame: trustedFrame,
    isDestroyed: () => false,
    isFocused: () => focused,
  };
  const closeOld = installTrustedFrameAudioCapture(webContents, trustedFrame.origin);
  const oldHandler = session.setDisplayMediaRequestHandler.mock.calls[0]![0];
  const callback = vi.fn();
  focused = false;
  oldHandler(request(trustedFrame), callback);
  expect(callback).toHaveBeenLastCalledWith({});
  focused = true;
  Object.defineProperty(trustedFrame, "visibilityState", { value: "hidden", configurable: true });
  oldHandler(request(trustedFrame), callback);
  expect(callback).toHaveBeenLastCalledWith({});
  Object.defineProperty(trustedFrame, "visibilityState", { value: "visible", configurable: true });
  const closeNew = installTrustedFrameAudioCapture(webContents, trustedFrame.origin);
  const currentHandler = session.setDisplayMediaRequestHandler.mock.calls[1]![0];
  closeOld();
  expect(session.setDisplayMediaRequestHandler).toHaveBeenCalledTimes(2);
  oldHandler(request(trustedFrame), callback);
  expect(callback).toHaveBeenLastCalledWith({});
  currentHandler(request(trustedFrame), callback);
  expect(callback).toHaveBeenLastCalledWith({
    video: trustedFrame,
    audio: trustedFrame,
    enableLocalEcho: true,
  });
  closeNew();
  expect(session.setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(null);
  currentHandler(request(trustedFrame), callback);
  expect(callback).toHaveBeenLastCalledWith({});
});
