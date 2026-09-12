import type * as Electron from "electron";
import { EMBEDDED_BROWSER_MAX_TABS } from "@cafecode/contracts";
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
      if (script === 'document.visibilityState === "visible"') return true;
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
    getVisible: vi.fn(() => true),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    webContents,
  };

  const contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };

  const ownerWindow = {
    contentView,
    isFocused: vi.fn(() => true),
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
    platform,
    browser: makeDesktopEmbeddedBrowser(platform),
    capturedPngs,
    confirmations,
    confirmationInputs,
    contentView,
    createdPartitions,
    emitContent,
    emitSession,
    emitOwner: (event: string) => {
      for (const listener of ownerListeners.get(event) ?? []) listener();
    },
    executedScripts,
    navigationHistory,
    owner,
    ownerWindow,
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

  it("redacts whole labelled secrets, including one-character and long values", () => {
    for (const value of ["x", "x".repeat(129), "x".repeat(2_000)]) {
      expect(redactEmbeddedBrowserText(`password=${value}\nNext line`, 3_000)).toBe(
        "password=[redacted secret]\nNext line",
      );
    }
  });

  it("pins hardened remote-content preferences to an ephemeral partition", () => {
    expect(embeddedBrowserWebPreferences("cafe-code-embedded-id")).toMatchObject({
      partition: "cafe-code-embedded-id",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    });
    expect(embeddedBrowserWebPreferences("cafe-code-embedded-id").partition).not.toMatch(
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
  it("reports an unavailable OCR engine without capturing pixels or claiming OCR text", async () => {
    const harness = createHarness();
    const platform = { ...harness.platform };
    Reflect.deleteProperty(platform, "ocr");
    const browser = makeDesktopEmbeddedBrowser(platform);
    await browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/");
    harness.confirmations.push(true);
    await browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const result = await browser.snapshot(harness.owner, { tabId: "tab-1", mode: "ocr" });
    expect(result?.ocr?.status).toBe("unavailable");
    expect(platform.captureVisibleViewport).not.toHaveBeenCalled();
    await browser.closeAll();
  });
  it("reuses origin authorization for routine controls and stops immediately on revocation", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/start");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    expect(
      (
        await harness.browser.click(harness.owner, {
          tabId: "tab-1",
          snapshotId: snapshot!.snapshotId,
          targetId: "e0",
        })
      ).status,
    ).toBe("completed");
    const typing = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    expect(
      (
        await harness.browser.type(harness.owner, {
          tabId: "tab-1",
          snapshotId: typing!.snapshotId,
          targetId: "e0",
          value: "Cafe Code",
          sensitive: false,
        })
      ).status,
    ).toBe("completed");
    expect(
      (
        await harness.browser.navigate(harness.owner, {
          tabId: "tab-1",
          url: "https://portal.example/next",
        })
      ).status,
    ).toBe("completed");
    expect(
      (await harness.browser.history(harness.owner, { tabId: "tab-1", action: "reload" })).status,
    ).toBe("completed");
    expect(harness.confirmationInputs).toHaveLength(1);
    // A different origin is not included in the existing authorization.
    expect(
      (
        await harness.browser.navigate(harness.owner, {
          tabId: "tab-1",
          url: "https://other.example/",
        })
      ).status,
    ).toBe("denied");
    expect(harness.webContents.getURL()).toBe("https://portal.example/next");
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: false });
    expect(
      await harness.browser.snapshot(harness.owner, { tabId: "tab-1", mode: "dom-accessibility" }),
    ).toBeNull();
    expect(
      (
        await harness.browser.navigate(harness.owner, {
          tabId: "tab-1",
          url: "https://portal.example/last",
        })
      ).status,
    ).toBe("denied");
  });

  it("keeps explicit sensitive-entry consent separate from origin authorization", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/login");
    harness.confirmations.push(true);
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
    expect(result.status).toBe("denied");
    expect(harness.webContents.insertText).not.toHaveBeenCalled();
    expect(harness.confirmationInputs).toHaveLength(2);
    expect(JSON.stringify(harness.confirmationInputs)).not.toContain("928401");

    const failureSnapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    harness.setTargetPoint({
      x: 20,
      y: 30,
      editable: true,
      sensitive: true,
      role: "textbox",
      name: "Verification code",
      text: "",
    });
    harness.webContents.insertText.mockImplementationOnce(() =>
      Promise.reject(new Error("Synthetic native input failure")),
    );
    harness.confirmations.push(true);
    const failed = await harness.browser.type(harness.owner, {
      tabId: "tab-1",
      snapshotId: failureSnapshot!.snapshotId,
      targetId: "e1",
      value: "928401",
      sensitive: true,
    });
    expect(failed.status).toBe("failed");
    expect(failed.message).not.toContain("928401");
  });

  it("does not capture pixels from a hidden browser tab", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    await harness.browser.setBounds(harness.owner, {
      tabId: "tab-1",
      bounds: { x: 0, y: 0, width: 640, height: 480 },
      visible: false,
    });
    harness.view.getVisible.mockReturnValue(false);
    const snapshot = await harness.browser.snapshot(harness.owner, { tabId: "tab-1", mode: "ocr" });
    expect(snapshot?.ocr?.status).toBe("unavailable");
    expect(harness.platform.captureVisibleViewport).not.toHaveBeenCalled();
    expect(harness.platform.ocr!.recognize).not.toHaveBeenCalled();
  });

  it.each(["snapshot", "ocr", "click", "type"] as const)(
    "rejects an in-flight %s after revocation and re-sharing the same page",
    async (action) => {
      const harness = createHarness();
      await harness.browser.open(harness.owner, {});
      harness.setUrl("https://portal.example/account");
      harness.confirmations.push(true);
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
      const snapshot = await harness.browser.snapshot(harness.owner, {
        tabId: "tab-1",
        mode: "dom-accessibility",
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = vi.fn(async () => {
        await gate;
        return action === "snapshot"
          ? { title: "Old page", text: "Old page content", targets: [], imageRegions: [] }
          : {
              x: 20,
              y: 30,
              editable: true,
              sensitive: false,
              role: "button",
              name: "Submit",
              text: "Submit",
            };
      });
      if (action === "snapshot") harness.setRawSnapshot(delayed);
      else harness.setTargetPoint(delayed);
      const delayedOcr = vi.fn(async () => {
        await gate;
        return {
          status: "completed" as const,
          engine: "test-ocr",
          language: "eng" as const,
          confidence: 90,
          truncated: false,
          text: "Old OCR content",
        };
      });
      if (action === "ocr") {
        await harness.browser.setBounds(harness.owner, {
          tabId: "tab-1",
          bounds: { x: 0, y: 0, width: 640, height: 480 },
        });
        vi.mocked(harness.platform.ocr!.recognize).mockImplementationOnce(delayedOcr);
      }
      const input = { tabId: "tab-1", snapshotId: snapshot!.snapshotId, targetId: "e0" };
      const pending =
        action === "snapshot" || action === "ocr"
          ? harness.browser.snapshot(harness.owner, {
              tabId: "tab-1",
              mode: action === "ocr" ? "ocr" : "dom-accessibility",
            })
          : action === "click"
            ? harness.browser.click(harness.owner, input)
            : harness.browser.type(harness.owner, {
                ...input,
                value: "Cafe Code",
                sensitive: false,
              });
      await vi.waitFor(() =>
        expect(action === "ocr" ? delayedOcr : delayed).toHaveBeenCalledOnce(),
      );
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: false });
      harness.confirmations.push(true);
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
      release();
      const result = await pending;
      if (action === "snapshot" || action === "ocr") expect(result).toBeNull();
      else expect(result).toMatchObject({ status: "stale" });
      expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();
      expect(harness.webContents.insertText).not.toHaveBeenCalled();
      expect(harness.confirmationInputs).toHaveLength(2);
      if (action === "ocr") expect(harness.capturedPngs[0]?.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("rejects a capture when the same URL reloads during the read", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    harness.setRawSnapshot(() => {
      harness.emitContent("did-start-loading");
      return { title: "Old page", text: "Old content", targets: [], imageRegions: [] };
    });
    expect(
      await harness.browser.snapshot(harness.owner, { tabId: "tab-1", mode: "dom-accessibility" }),
    ).toBeNull();
    expect(harness.webContents.getURL()).toBe("https://portal.example/account");
  });

  it.each(["navigate", "reload"] as const)(
    "stops %s if sharing is revoked before dispatch",
    async (action) => {
      const harness = createHarness();
      await harness.browser.open(harness.owner, {});
      harness.setUrl("https://portal.example/account");
      harness.confirmations.push(true);
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
      const pending =
        action === "navigate"
          ? harness.browser.navigate(harness.owner, {
              tabId: "tab-1",
              url: "https://portal.example/next",
            })
          : harness.browser.history(harness.owner, { tabId: "tab-1", action: "reload" });
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: false });
      expect(await pending).toMatchObject({ status: "stale" });
      expect(harness.webContents.reload).not.toHaveBeenCalled();
      expect(harness.webContents.loadURL).toHaveBeenCalledTimes(1);
      expect(harness.confirmationInputs).toHaveLength(1);
    },
  );

  it("does not let an older sharing dialog undo explicit revocation", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account");
    vi.mocked(harness.platform.confirm).mockImplementationOnce(async () => {
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: false });
      return true;
    });
    expect(
      await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true }),
    ).toMatchObject({ status: "stale", state: { shared: false } });
    expect(
      await harness.browser.snapshot(harness.owner, { tabId: "tab-1", mode: "dom-accessibility" }),
    ).toBeNull();
  });

  it("rejects duplicate tab IDs and enforces the owner tab limit before allocating a view", async () => {
    const harness = createHarness();
    vi.mocked(harness.platform.randomId).mockReturnValue("same-tab");
    await harness.browser.open(harness.owner, {});
    await expect(harness.browser.open(harness.owner, {})).rejects.toThrow("allocate a browser tab");
    expect(harness.platform.createView).toHaveBeenCalledOnce();
    expect(harness.webContents.close).not.toHaveBeenCalled();
    let nextId = 1;
    vi.mocked(harness.platform.randomId).mockImplementation(() => `retained-${nextId++}`);
    for (let index = 1; index < EMBEDDED_BROWSER_MAX_TABS; index += 1) {
      const retained = createHarness();
      vi.mocked(harness.platform.createView).mockReturnValueOnce(
        retained.view as unknown as Electron.WebContentsView,
      );
      await harness.browser.open(harness.owner, {});
    }
    await expect(harness.browser.open(harness.owner, {})).rejects.toThrow("up to 8 open tabs");
    expect(harness.platform.createView).toHaveBeenCalledTimes(EMBEDDED_BROWSER_MAX_TABS);
    await harness.browser.close(harness.owner, { tabId: "same-tab" });
    const replacement = await harness.browser.open(harness.owner, {});
    expect(replacement.status).toBe("open");
    await harness.browser.closeAll();
  });

  it("cleans a failed tab attachment without discarding an existing login", async () => {
    const first = createHarness();
    const second = createHarness();
    vi.mocked(first.platform.createView)
      .mockReturnValueOnce(first.view as unknown as Electron.WebContentsView)
      .mockReturnValueOnce(second.view as unknown as Electron.WebContentsView);
    await first.browser.open(first.owner, {});
    first.contentView.addChildView.mockImplementationOnce(() => {
      throw new Error("Window closed during attachment");
    });
    await expect(first.browser.open(first.owner, {})).rejects.toThrow("could not open");
    expect(second.webContents.close).toHaveBeenCalledOnce();
    expect(second.session.clearStorageData).toHaveBeenCalledOnce();
    expect(first.session.clearStorageData).not.toHaveBeenCalled();
    first.emitOwner("destroyed");
    await vi.waitFor(() => expect(first.session.clearAuthCache).toHaveBeenCalledOnce());
  });

  it("clears every retained session when its owning renderer is destroyed", async () => {
    const first = createHarness();
    const second = createHarness();
    vi.mocked(first.platform.createView)
      .mockReturnValueOnce(first.view as unknown as Electron.WebContentsView)
      .mockReturnValueOnce(second.view as unknown as Electron.WebContentsView);
    await first.browser.open(first.owner, {});
    await first.browser.open(first.owner, {});
    first.emitOwner("destroyed");
    await vi.waitFor(() => {
      expect(first.session.clearAuthCache).toHaveBeenCalledOnce();
      expect(second.session.clearAuthCache).toHaveBeenCalledOnce();
    });
    expect(first.webContents.close).toHaveBeenCalledOnce();
    expect(second.webContents.close).toHaveBeenCalledOnce();
  });

  it("retains independent tabs on open and hide, and clears only the discarded session", async () => {
    const first = createHarness();
    const second = createHarness();
    vi.mocked(first.platform.createView)
      .mockReturnValueOnce(first.view as unknown as Electron.WebContentsView)
      .mockReturnValueOnce(second.view as unknown as Electron.WebContentsView);
    const one = await first.browser.open(first.owner, {});
    first.setUrl("https://example.test/signed-in");
    const two = await first.browser.open(first.owner, {});
    expect(two.tabId).not.toBe(one.tabId);
    expect(first.webContents.close).not.toHaveBeenCalled();
    expect(first.session.clearStorageData).not.toHaveBeenCalled();
    expect(first.webContents.getURL()).toBe("https://example.test/signed-in");
    first.browser.setBounds(first.owner, {
      tabId: two.tabId!,
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      visible: true,
    });
    expect(first.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(second.view.setVisible).toHaveBeenLastCalledWith(true);
    first.browser.setBounds(first.owner, {
      tabId: one.tabId!,
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      visible: true,
    });
    expect(second.view.setVisible).toHaveBeenLastCalledWith(false);
    await first.browser.close(first.owner, { tabId: two.tabId! });
    expect(second.session.clearStorageData).toHaveBeenCalledOnce();
    expect(first.session.clearStorageData).not.toHaveBeenCalled();
    await first.browser.closeAll();
    expect(first.session.clearStorageData).toHaveBeenCalledOnce();
  });

  it("isolates ownership, clamps bounds, denies capabilities, and clears the session", async () => {
    const harness = createHarness();
    const state = await harness.browser.open(harness.owner, {});

    expect(state.tabId).toBe("tab-1");
    expect(harness.createdPartitions).toEqual(["cafe-code-embedded-tab-1"]);
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

    await harness.browser.setBounds(harness.owner, {
      tabId: "tab-1",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      visible: false,
    });
    expect(harness.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(harness.webContents.close).not.toHaveBeenCalled();
    expect(harness.session.clearStorageData).not.toHaveBeenCalled();
    expect(harness.session.clearAuthCache).not.toHaveBeenCalled();
    await harness.browser.setBounds(harness.owner, {
      tabId: "tab-1",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
      visible: true,
    });
    expect(harness.view.setVisible).toHaveBeenLastCalledWith(true);
    expect(harness.createdPartitions).toHaveLength(1);
    await harness.browser.close(harness.owner, { tabId: "tab-1" });
    expect(harness.contentView.removeChildView).toHaveBeenCalledWith(harness.view);
    expect(harness.webContents.close).toHaveBeenCalledOnce();
    expect(harness.session.clearStorageData).toHaveBeenCalledOnce();
    expect(harness.session.clearCache).toHaveBeenCalledOnce();
    expect(harness.session.clearAuthCache).toHaveBeenCalledOnce();
  });

  it("authorizes routine snapshots once per origin, redacts OCR, and clears bytes", async () => {
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
    expect(harness.confirmationInputs).toHaveLength(1);
  });

  it("uses stale snapshot grants once and never places sensitive values in approvals", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/login");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    expect(snapshot).not.toBeNull();

    const clickedOnce = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(clickedOnce.status).toBe("completed");
    expect(harness.webContents.sendInputEvent).toHaveBeenCalledTimes(2);
    expect(harness.confirmationInputs).toHaveLength(1);

    const reusedAfterClick = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(reusedAfterClick.status).toBe("stale");

    const clickSnapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    const clicked = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: clickSnapshot!.snapshotId,
      targetId: "e0",
    });
    expect(clicked.status).toBe("completed");
    expect(harness.webContents.sendInputEvent).toHaveBeenCalledTimes(4);

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
    expect(harness.confirmationInputs).toHaveLength(2);
    expect(harness.confirmations).toHaveLength(0);
    expect(harness.webContents.insertText).toHaveBeenCalledWith("928401");
    expect(JSON.stringify(harness.confirmationInputs)).not.toContain("928401");
  });

  it("rejects replaced or occluded targets under origin authorization", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account");
    harness.confirmations.push(true);
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
    const replaced = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(replaced.status).toBe("stale");
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();

    const nextSnapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    harness.setTargetPoint(null);
    const occluded = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: nextSnapshot!.snapshotId,
      targetId: "e0",
    });
    expect(occluded.status).toBe("stale");
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();
    expect(harness.executedScripts.at(-1)).toContain("document.elementFromPoint");
    expect(harness.executedScripts.at(-1)).toContain('document.visibilityState !== "visible"');
    expect(harness.confirmationInputs).toHaveLength(1);
  });

  it("does not claim a click was sent when the owner cannot receive native input", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/account");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });
    harness.ownerWindow.isFocused.mockReturnValue(false);
    const clicked = await harness.browser.click(harness.owner, {
      tabId: "tab-1",
      snapshotId: snapshot!.snapshotId,
      targetId: "e0",
    });
    expect(clicked.status).toBe("stale");
    expect(harness.webContents.sendInputEvent).not.toHaveBeenCalled();
  });

  it("revokes sharing on cross-origin navigation and blocks approval races", async () => {
    const harness = createHarness();
    await harness.browser.open(harness.owner, {});
    harness.setUrl("https://portal.example/start");
    harness.confirmations.push(true);
    await harness.browser.share(harness.owner, { tabId: "tab-1", shared: true });
    const snapshot = await harness.browser.snapshot(harness.owner, {
      tabId: "tab-1",
      mode: "dom-accessibility",
    });

    harness.setUrl("https://attacker.example/");
    harness.emitContent("did-navigate");
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
    harness.confirmations.push(true);
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
