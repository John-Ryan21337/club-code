import type * as Electron from "electron";
import { describe, expect, it, vi } from "vitest";

import type { DesktopIpcWebContents } from "../ipc/DesktopIpc.ts";
import {
  canTypeSensitiveValue,
  embeddedBrowserDisplayUrl,
  embeddedBrowserWebPreferences,
  makeDesktopEmbeddedBrowser,
  normalizeEmbeddedBrowserUrl,
  redactEmbeddedBrowserText,
  type EmbeddedBrowserPlatform,
} from "./DesktopEmbeddedBrowser.ts";

type Listener = (...args: Array<any>) => void;

function createHarness() {
  const contentListeners = new Map<string, Array<Listener>>();
  const sessionListeners = new Map<string, Array<Listener>>();
  const ownerListeners = new Map<string, Array<Listener>>();
  const windowListeners = new Map<string, Array<Listener>>();
  const confirmations: Array<boolean | (() => boolean)> = [];
  const confirmationInputs: Array<Parameters<EmbeddedBrowserPlatform["confirm"]>[1]> = [];
  const sentStates: Array<unknown> = [];
  const createdPartitions: Array<string> = [];
  const executedScripts: Array<string> = [];
  const capturedPngs: Array<Buffer> = [];
  const ids = ["tab-1", "snapshot-1", "snapshot-2", "snapshot-3", "snapshot-4"];
  let rawSnapshot: unknown = {
    title: "Portal",
    text: "Visible portal content",
    targets: [
      {
        targetId: "e0",
        selector: "#submit",
        role: "button",
        name: "Submit",
        text: "Submit",
        sensitive: false,
      },
      {
        targetId: "e1",
        selector: "#otp",
        role: "textbox",
        name: "Verification code",
        text: "",
        sensitive: true,
      },
    ],
    imageRegions: [{ alt: "Receipt", labelledBy: "Uploaded receipt" }],
  };
  let targetPoint: unknown = {
    x: 20,
    y: 30,
    editable: true,
    sensitive: false,
    role: "button",
    name: "Submit",
    text: "Submit",
  };
  let currentUrl = "about:blank";
  let title = "";
  let loading = false;
  let canGoBack = false;
  let canGoForward = false;
  let windowOpenHandler: (() => { action: string }) | null = null;
  let permissionCheckHandler: (() => boolean) | null = null;
  let permissionRequestHandler:
    | ((_contents: unknown, _permission: unknown, callback: (allowed: boolean) => void) => void)
    | null = null;

  const emitContent = (event: string, ...args: Array<unknown>) => {
    for (const listener of contentListeners.get(event) ?? []) listener(...args);
  };
  const emitSession = (event: string, ...args: Array<unknown>) => {
    for (const listener of sessionListeners.get(event) ?? []) listener(...args);
  };

  const session = {
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined),
    setPermissionCheckHandler: vi.fn((handler: () => boolean) => {
      permissionCheckHandler = handler;
    }),
    setPermissionRequestHandler: vi.fn(
      (
        handler: (
          contents: unknown,
          permission: unknown,
          callback: (allowed: boolean) => void,
        ) => void,
      ) => {
        permissionRequestHandler = handler;
      },
    ),
    on: vi.fn((event: string, listener: Listener) => {
      sessionListeners.set(event, [...(sessionListeners.get(event) ?? []), listener]);
    }),
  };

  const navigationHistory = {
    canGoBack: vi.fn(() => canGoBack),
    canGoForward: vi.fn(() => canGoForward),
    goBack: vi.fn(),
    goForward: vi.fn(),
  };

  const webContents = {
    session,
    navigationHistory,
    close: vi.fn(),
    executeJavaScript: vi.fn(async (script: string) => {
      executedScripts.push(script);
      const value = script.includes("document.body?.innerText") ? rawSnapshot : targetPoint;
      return typeof value === "function" ? value() : value;
    }),
    getTitle: vi.fn(() => title),
    getURL: vi.fn(() => currentUrl),
    insertText: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => loading),
    loadURL: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    on: vi.fn((event: string, listener: Listener) => {
      contentListeners.set(event, [...(contentListeners.get(event) ?? []), listener]);
    }),
    reload: vi.fn(),
    sendInputEvent: vi.fn(),
    setWindowOpenHandler: vi.fn((handler: () => { action: string }) => {
      windowOpenHandler = handler;
    }),
    stop: vi.fn(),
  };

  const view = {
    setBounds: vi.fn(),
    webContents,
  };

  const contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };

  const ownerWindow = {
    contentView,
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: Listener) => {
      windowListeners.set(event, [...(windowListeners.get(event) ?? []), listener]);
    }),
  };

  const owner = {
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: Listener) => {
      ownerListeners.set(event, [...(ownerListeners.get(event) ?? []), listener]);
    }),
    send: vi.fn((_channel: string, state: unknown) => {
      sentStates.push(state);
    }),
  } as unknown as DesktopIpcWebContents;

  const platform: EmbeddedBrowserPlatform = {
    createView: vi.fn((partition) => {
      createdPartitions.push(partition);
      return view as unknown as Electron.WebContentsView;
    }),
    findOwnerWindow: vi.fn(() => ownerWindow as unknown as Electron.BrowserWindow),
    confirm: vi.fn(async (_window, input) => {
      confirmationInputs.push(input);
      const decision = confirmations.shift() ?? false;
      return typeof decision === "function" ? decision() : decision;
    }),
    randomId: vi.fn(() => ids.shift() ?? "fallback-id"),
    nowIso: vi.fn(() => "2026-07-23T12:00:00.000Z"),
    captureVisibleViewport: vi.fn(async () => {
      const png = Buffer.from("visible viewport");
      capturedPngs.push(png);
      return { png, width: 640, height: 480 };
    }),
    ocr: {
      recognize: vi.fn(async () => ({
        status: "completed" as const,
        engine: "test-ocr",
        language: "eng" as const,
        confidence: 91.2,
        truncated: false,
        text: "OCR verification code 864209 and visible words",
      })),
      close: vi.fn(async () => undefined),
    },
  };

  return {
    browser: makeDesktopEmbeddedBrowser(platform),
    capturedPngs,
    confirmations,
    confirmationInputs,
    contentView,
    createdPartitions,
    emitContent,
    emitSession,
    executedScripts,
    navigationHistory,
    owner,
    permissionAllowed: () => permissionCheckHandler?.() ?? true,
    requestPermission: () =>
      new Promise<boolean>((resolve) => {
        permissionRequestHandler?.({}, "camera", resolve);
      }),
    sentStates,
    session,
    setCanGoBack: (value: boolean) => {
      canGoBack = value;
    },
    setCanGoForward: (value: boolean) => {
      canGoForward = value;
    },
    setLoading: (value: boolean) => {
      loading = value;
    },
    setRawSnapshot: (value: unknown) => {
      rawSnapshot = value;
    },
    setTargetPoint: (value: unknown) => {
      targetPoint = value;
    },
    setTitle: (value: string) => {
      title = value;
    },
    setUrl: (value: string) => {
      currentUrl = value;
    },
    view,
    webContents,
    windowOpenDisposition: () => windowOpenHandler?.().action,
  };
}

describe("embedded browser security helpers", () => {
  it("allows only guarded web URLs and strips sensitive URL state", () => {
    expect(normalizeEmbeddedBrowserUrl("portal.example/sign-in")).toBe(
      "https://portal.example/sign-in",
    );
    expect(normalizeEmbeddedBrowserUrl("https://user:secret@portal.example")).toBeNull();
    expect(normalizeEmbeddedBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeEmbeddedBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(embeddedBrowserDisplayUrl("https://portal.example/path?code=123456#token")).toBe(
      "https://portal.example/path",
    );
  });

  it("redacts likely codes and tokens before they cross IPC", () => {
    const redacted = redactEmbeddedBrowserText(
      "OTP 1234, code 123456, sk-secret_token_123456789, eyJabcabcabcabcabcabcabcabc.eyJdefdefdefdefdef.signaturehere",
      1_000,
    );
    expect(redacted).not.toContain("1234");
    expect(redacted).not.toContain("123456");
    expect(redacted).not.toContain("sk-secret_token");
    expect(redacted).not.toContain("eyJabc");
    expect(redacted).toContain("[redacted");
  });

  it("pins hardened remote-content preferences to an ephemeral partition", () => {
    expect(embeddedBrowserWebPreferences("club-code-embedded-id")).toMatchObject({
      partition: "club-code-embedded-id",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    });
    expect(embeddedBrowserWebPreferences("club-code-embedded-id").partition).not.toMatch(
      /^persist:/,
    );
  });

  it("accepts cleartext sensitive entry only on actual loopback hosts", () => {
    expect(canTypeSensitiveValue("http://127.0.0.1/login")).toBe(true);
    expect(canTypeSensitiveValue("http://127.12.34.56/login")).toBe(true);
    expect(canTypeSensitiveValue("http://localhost/login")).toBe(true);
    expect(canTypeSensitiveValue("http://127.attacker.example/login")).toBe(false);
    expect(canTypeSensitiveValue("http://localhost.attacker.example/login")).toBe(false);
    expect(canTypeSensitiveValue("http://portal.example/login")).toBe(false);
  });
});

describe("DesktopEmbeddedBrowser", () => {
  it("isolates ownership, clamps bounds, denies capabilities, and clears the session", async () => {
    const harness = createHarness();
    const state = await harness.browser.open(harness.owner, {});

    expect(state.tabId).toBe("tab-1");
    expect(harness.createdPartitions).toEqual(["club-code-embedded-tab-1"]);
    expect(harness.contentView.addChildView).toHaveBeenCalledWith(harness.view);
    expect(harness.windowOpenDisposition()).toBe("deny");
    expect(harness.permissionAllowed()).toBe(false);
    await expect(harness.requestPermission()).resolves.toBe(false);

    const downloadEvent = { preventDefault: vi.fn() };
    harness.emitSession("will-download", downloadEvent);
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce();

    const unsafeNavigation = { url: "file:///secret", preventDefault: vi.fn() };
    harness.emitContent("will-navigate", unsafeNavigation);
    expect(unsafeNavigation.preventDefault).toHaveBeenCalledOnce();

    await harness.browser.setBounds(harness.owner, {
      tabId: "tab-1",
      bounds: { x: 799, y: 599, width: 500, height: 500 },
    });
    expect(harness.view.setBounds).toHaveBeenCalledWith({
      x: 799,
      y: 599,
      width: 1,
      height: 1,
    });

    const otherOwner = {} as DesktopIpcWebContents;
    await expect(
      harness.browser.setBounds(otherOwner, {
        tabId: "tab-1",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).rejects.toThrow("belongs to another renderer");

    await harness.browser.close(harness.owner, { tabId: "tab-1" });
    expect(harness.contentView.removeChildView).toHaveBeenCalledWith(harness.view);
    expect(harness.webContents.close).toHaveBeenCalledOnce();
    expect(harness.session.clearStorageData).toHaveBeenCalledOnce();
    expect(harness.session.clearCache).toHaveBeenCalledOnce();
    expect(harness.session.clearAuthCache).toHaveBeenCalledOnce();
  });

  it("requires one-time approval, OCRs only the visible viewport, redacts it, and clears bytes", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account?code=123456");

    await expect(
      harness.browser.snapshot(harness.owner, {
        tabId: "tab-1",
        mode: "dom-accessibility",
      }),
    ).resolves.toBeNull();
    expect(harness.confirmationInputs).toHaveLength(0);

    harness.confirmations.push(true);
    const share = await harness.browser.share(harness.owner, {
      tabId: "tab-1",
      shared: true,
    });
    expect(share.status).toBe("completed");
    await harness.browser.setBounds(harness.owner, {
      tabId: "tab-1",
      bounds: { x: 0, y: 0, width: 640, height: 480 },
    });

    harness.setRawSnapshot({
      title: "Security code 1234",
      text: "Use verification code 123456 and token sk-secret_abcdefghijklmnop",
      targets: [
        {
          targetId: "e1",
          selector: "#otp",
          role: "textbox",
          name: "Verification code 654321",
          text: "",
          sensitive: true,
        },
      ],
      imageRegions: [{ alt: "Receipt 1234", labelledBy: "Security code 777777" }],
    });
    harness.confirmations.push(true);
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "ocr",
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.displayUrl).toBe("https://portal.example/account");
    expect(snapshot?.title).not.toContain("1234");
    expect(snapshot?.text).not.toContain("123456");
    expect(snapshot?.text).not.toContain("sk-secret");
    expect(snapshot?.targets[0]?.name).not.toContain("654321");
    expect(snapshot?.imageRegions[0]?.alt).not.toContain("1234");
    expect(snapshot?.ocr).toMatchObject({
      status: "completed",
      engine: "test-ocr",
      language: "eng",
      confidence: 91.2,
    });
    expect(snapshot?.ocr?.status === "completed" ? snapshot.ocr.text : "").not.toContain("864209");
    expect(harness.capturedPngs[0]?.every((byte) => byte === 0)).toBe(true);
    expect(harness.confirmationInputs.at(-1)?.detail).toContain("currently visible");
    expect(harness.confirmationInputs.at(-1)?.detail).toContain("Do not approve");
  });

  it("uses stale snapshot grants once and never places sensitive values in approvals", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/login");
    harness.confirmations.push(true, true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    expect(snapshot).not.toBeNull();

    harness.confirmations.push(false);
    const denied = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(denied.status).toBe("denied");
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();

    const reusedAfterDenial = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(reusedAfterDenial.status).toBe("stale");

    harness.confirmations.push(true);
    const clickSnapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    harness.confirmations.push(true);
    const clicked = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: clickSnapshot!.snapshotId,
      targetId: "e0",
    });
    expect(clicked.status).toBe("completed");
    expect(harness.webContents.sendInputEvent).toHaveBeenCalledTimes(2);

    harness.confirmations.push(true);
    const nextSnapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    const missingSensitiveApproval = await harness.browser.type(harness.owner, {
      tabId: "tab-1",
      snapshotId: nextSnapshot!.snapshotId,
      targetId: "e1",
      value: "928401",
      sensitive: false,
    });
    expect(missingSensitiveApproval.status).toBe("failed");

    harness.setTargetPoint({
      x: 20,
      y: 30,
      editable: true,
      sensitive: true,
      role: "textbox",
      name: "Verification code",
      text: "",
    });
    harness.confirmations.push(true);
    const typed = await harness.browser.type(harness.owner, {
      tabId: "tab-1",
      snapshotId: nextSnapshot!.snapshotId,
      targetId: "e1",
      value: "928401",
      sensitive: true,
    });
    expect(typed.status).toBe("completed");
    expect(harness.webContents.insertText).toHaveBeenCalledWith("928401");
    expect(JSON.stringify(harness.confirmationInputs)).not.toContain("928401");
  });

  it("rejects replaced or occluded targets after action approval", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account");
    harness.confirmations.push(true, true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });

    harness.setTargetPoint({
      x: 20,
      y: 30,
      editable: false,
      sensitive: false,
      role: "button",
      name: "Delete account",
      text: "Delete account",
    });
    harness.confirmations.push(true);
    const replaced = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(replaced.status).toBe("stale");
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();

    harness.confirmations.push(true);
    const nextSnapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    harness.setTargetPoint(null);
    harness.confirmations.push(true);
    const occluded = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: nextSnapshot!.snapshotId,
      targetId: "e0",
    });
    expect(occluded.status).toBe("stale");
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();
    expect(harness.executedScripts.at(-1)).toContain("document.elementFromPoint");
  });

  it("revokes sharing on cross-origin navigation and blocks approval races", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/start");
    harness.confirmations.push(true, true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });

    harness.confirmations.push(() => {
      harness.setUrl("https://attacker.example/");
      harness.emitContent("did-navigate");
      return true;
    });
    const result = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });

    expect(result.status).not.toBe("completed");
    expect(result.state.shared).toBe(false);
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();
    expect(harness.sentStates.at(-1)).toMatchObject({ shared: false, sharedOrigin: null });
  });

  it("discards a capture if the document changes while DOM text is being read", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/start");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    harness.setRawSnapshot(() => {
      harness.setUrl("https://attacker.example/");
      return {
        title: "Old portal",
        text: "Old portal content",
        targets: [],
        imageRegions: [],
      };
    });
    harness.confirmations.push(true);

    await expect(
      harness.browser.snapshot(harness.owner, {
        tabId: "tab-1",
        mode: "dom-accessibility",
      }),
    ).resolves.toBeNull();
  });

  it("does not allow sensitive entry over cleartext remote HTTP", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("http://portal.example/login");
    harness.confirmations.push(true, true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });

    const result = await harness.browser.type(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e1",
      value: "928401",
      sensitive: true,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("HTTPS");
    expect(harness.webContents.insertText).not.toHaveBeenCalled();
  });
});
