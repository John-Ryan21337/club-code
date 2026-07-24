import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";
import type {
  EmbeddedBrowserActionResult,
  EmbeddedBrowserBounds,
  EmbeddedBrowserClickInput,
  EmbeddedBrowserHistoryActionInput,
  EmbeddedBrowserNavigateInput,
  EmbeddedBrowserOpenInput,
  EmbeddedBrowserSetBoundsInput,
  EmbeddedBrowserShareInput,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserSnapshotInput,
  EmbeddedBrowserState,
  EmbeddedBrowserTabInput,
  EmbeddedBrowserTypeInput,
} from "@cafecode/contracts";
import {
  EMBEDDED_BROWSER_MAX_IMAGE_REGIONS,
  EMBEDDED_BROWSER_MAX_SNAPSHOT_TARGETS,
  EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS,
  EMBEDDED_BROWSER_OCR_MAX_CAPTURE_EDGE,
  EMBEDDED_BROWSER_OCR_MAX_CAPTURE_PIXELS,
  EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE,
  EMBEDDED_BROWSER_OCR_MAX_INPUT_PIXELS,
  EMBEDDED_BROWSER_OCR_MAX_PNG_BYTES,
} from "@cafecode/contracts";

import type { DesktopIpcWebContents } from "../ipc/DesktopIpc.ts";
import { EMBEDDED_BROWSER_STATE_CHANNEL } from "../ipc/channels.ts";
import { embeddedBrowserOcrEngine, type EmbeddedBrowserOcrEngine } from "./EmbeddedBrowserOcr.ts";

const BLANK_URL = "about:blank";
const REDACTION_NOTICE =
  "Form values are not queried; URL credentials/query data, probable one-time codes, tokens, and likely password patterns are omitted from DOM and OCR text.";

interface CapturedEmbeddedBrowserViewport {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface EmbeddedBrowserPlatform {
  readonly createView: (partition: string) => Electron.WebContentsView;
  readonly findOwnerWindow: (owner: DesktopIpcWebContents) => Electron.BrowserWindow | null;
  readonly confirm: (
    ownerWindow: Electron.BrowserWindow,
    input: {
      readonly title: string;
      readonly detail: string;
      readonly approveLabel: string;
      readonly destructive?: boolean;
    },
  ) => Promise<boolean>;
  readonly randomId: () => string;
  readonly nowIso: () => string;
  readonly captureVisibleViewport: (
    contents: Electron.WebContents,
    bounds: EmbeddedBrowserBounds,
  ) => Promise<CapturedEmbeddedBrowserViewport>;
  readonly ocr: EmbeddedBrowserOcrEngine;
}

interface SnapshotTargetLocator {
  readonly selector: string;
  readonly sensitive: boolean;
  readonly role: string;
  readonly name: string;
  readonly text: string;
}

interface ClaimedSnapshotTarget {
  readonly documentUrl: string;
  readonly target: SnapshotTargetLocator;
}

interface SnapshotGrant {
  readonly id: string;
  readonly documentUrl: string;
  readonly targets: ReadonlyMap<string, SnapshotTargetLocator>;
}

interface OwnedTab {
  readonly id: string;
  readonly owner: DesktopIpcWebContents;
  readonly ownerWindow: Electron.BrowserWindow;
  readonly view: Electron.WebContentsView;
  readonly isolatedSession: Electron.Session;
  sharedOrigin: string | null;
  bounds: EmbeddedBrowserBounds | null;
  snapshot: SnapshotGrant | null;
  closed: boolean;
}

interface RawSnapshotTarget {
  readonly targetId?: unknown;
  readonly selector?: unknown;
  readonly role?: unknown;
  readonly name?: unknown;
  readonly text?: unknown;
  readonly sensitive?: unknown;
}

interface RawImageRegion {
  readonly alt?: unknown;
  readonly labelledBy?: unknown;
}

interface RawDomSnapshot {
  readonly title?: unknown;
  readonly text?: unknown;
  readonly targets?: unknown;
  readonly imageRegions?: unknown;
}

interface TargetPoint {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly editable?: unknown;
  readonly sensitive?: unknown;
  readonly role?: unknown;
  readonly name?: unknown;
  readonly text?: unknown;
}

const DOM_SNAPSHOT_SCRIPT = String.raw`
(() => {
  const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const selectorFor = (element) => {
    if (element.id) {
      const idSelector = "#" + CSS.escape(element.id);
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    }
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement && parts.length < 8) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((entry) => entry.tagName === current.tagName)
        : [];
      const suffix = siblings.length > 1 ? ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : "";
      parts.unshift(tag + suffix);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  const roleFor = (element) => element.getAttribute("role") || ({
    A: "link",
    BUTTON: "button",
    INPUT: element.type === "checkbox" ? "checkbox" : "textbox",
    SELECT: "combobox",
    TEXTAREA: "textbox"
  }[element.tagName] || element.tagName.toLowerCase());
  const nameFor = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelled = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : "";
    const label = element.labels ? Array.from(element.labels).map((entry) => entry.textContent || "").join(" ") : "";
    return clip(
      element.getAttribute("aria-label") || labelled || label || element.getAttribute("alt") ||
      element.getAttribute("title") || element.getAttribute("placeholder") || element.textContent,
      512
    );
  };
  const interactiveSelector =
    "a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=menuitem],[tabindex]";
  const elements = Array.from(document.querySelectorAll(interactiveSelector)).filter(visible).slice(0, 200);
  const targets = elements.map((element, index) => {
    const attributes = [
      element.getAttribute("type"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder")
    ].join(" ").toLowerCase();
    return {
      targetId: "e" + index,
      selector: selectorFor(element),
      role: clip(roleFor(element), 64),
      name: nameFor(element),
      text: element.matches("input,textarea,select") ? "" : clip(element.textContent, 1024),
      sensitive: /(password|passcode|one-time|otp|2fa|verification|security.?code|token)/.test(attributes)
    };
  });
  const imageRegions = Array.from(document.images).filter(visible).slice(0, 100).map((image) => ({
    alt: clip(image.alt, 1024),
    labelledBy: clip(image.getAttribute("aria-label") || image.getAttribute("title"), 1024)
  }));
  return {
    title: clip(document.title, 512),
    text: String(document.body?.innerText || "").slice(0, 30000),
    targets,
    imageRegions
  };
})()
`;

function isAllowedRemoteUrl(rawUrl: string): boolean {
  if (rawUrl === BLANK_URL) return true;
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function normalizeEmbeddedBrowserUrl(rawUrl: string): string | null {
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawUrl.trim())
    ? rawUrl.trim()
    : `https://${rawUrl.trim()}`;
  if (!isAllowedRemoteUrl(candidate) || candidate === BLANK_URL) {
    return candidate === BLANK_URL ? BLANK_URL : null;
  }
  return new URL(candidate).href;
}

export function embeddedBrowserDisplayUrl(rawUrl: string): string {
  if (rawUrl === BLANK_URL || rawUrl.length === 0) return BLANK_URL;
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return BLANK_URL;
  }
}

function originFor(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function redactEmbeddedBrowserText(rawText: string, maxLength: number): string {
  return rawText
    .replace(
      /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/gi,
      "[redacted token]",
    )
    .replace(
      /\b(?:AKIA[A-Z0-9]{16}|(?:sk|api|key|token)[-_][A-Za-z0-9_-]{12,})\b/gi,
      "[redacted token]",
    )
    .replace(
      /\b(password|passwd|pwd|client[- ]secret|recovery[- ]code)(\s*[:=]\s*)\S{2,128}/gi,
      "$1$2[redacted secret]",
    )
    .replace(/\b\d{4,8}\b/g, "[redacted numeric code]")
    .replace(
      /((?:verification|security|one[- ]time|otp|2fa|passcode)[^\r\n]{0,32})\b[A-Z0-9-]{4,16}\b/gi,
      "$1[redacted code]",
    )
    .slice(0, maxLength);
}

function isIpv4LoopbackHostname(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    Number(parts[0]) === 127
  );
}

export function canTypeSensitiveValue(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:") return true;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      url.protocol === "http:" &&
      (hostname === "localhost" || hostname === "::1" || isIpv4LoopbackHostname(hostname))
    );
  } catch {
    return false;
  }
}

function stringField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function navigationApprovalUrl(rawUrl: string): string {
  const displayUrl = embeddedBrowserDisplayUrl(rawUrl);
  try {
    return new URL(rawUrl).search.length > 0 ? `${displayUrl} (query data hidden)` : displayUrl;
  } catch {
    return displayUrl;
  }
}

function snapshotState(tab: OwnedTab): EmbeddedBrowserState {
  const contents = tab.view.webContents;
  const url = contents.isDestroyed() ? BLANK_URL : contents.getURL() || BLANK_URL;
  const origin = originFor(url);
  const shared = tab.sharedOrigin !== null && tab.sharedOrigin === origin;
  return {
    status: tab.closed ? "closed" : "open",
    tabId: tab.closed ? null : tab.id,
    displayUrl: embeddedBrowserDisplayUrl(url),
    title:
      tab.closed || contents.isDestroyed()
        ? ""
        : redactEmbeddedBrowserText(contents.getTitle(), 512),
    loading: !tab.closed && !contents.isDestroyed() && contents.isLoading(),
    canGoBack: !tab.closed && !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
    canGoForward:
      !tab.closed && !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
    shared,
    sharedOrigin: shared ? tab.sharedOrigin : null,
  };
}

function closedState(): EmbeddedBrowserState {
  return {
    status: "closed",
    tabId: null,
    displayUrl: BLANK_URL,
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    shared: false,
    sharedOrigin: null,
  };
}

function completed(tab: OwnedTab, message: string): EmbeddedBrowserActionResult {
  return { status: "completed", message, state: snapshotState(tab) };
}

function result(
  tab: OwnedTab,
  status: Exclude<EmbeddedBrowserActionResult["status"], "completed">,
  message: string,
): EmbeddedBrowserActionResult {
  return { status, message, state: snapshotState(tab) };
}

function invalidateSnapshot(tab: OwnedTab): void {
  tab.snapshot = null;
}

function locateTarget(
  tab: OwnedTab,
  snapshotId: string,
  targetId: string,
): SnapshotTargetLocator | null {
  const grant = tab.snapshot;
  if (!grant || grant.id !== snapshotId || grant.documentUrl !== tab.view.webContents.getURL()) {
    return null;
  }
  return grant.targets.get(targetId) ?? null;
}

function claimTarget(
  tab: OwnedTab,
  snapshotId: string,
  targetId: string,
): ClaimedSnapshotTarget | null {
  const grant = tab.snapshot;
  const target = locateTarget(tab, snapshotId, targetId);
  if (!grant || !target) return null;
  tab.snapshot = null;
  return { documentUrl: grant.documentUrl, target };
}

function sendTrustedClick(tab: OwnedTab, point: { x: number; y: number }): void {
  tab.view.webContents.sendInputEvent({
    type: "mouseDown",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  tab.view.webContents.sendInputEvent({
    type: "mouseUp",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

export interface DesktopEmbeddedBrowserShape {
  readonly open: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserOpenInput,
  ) => Promise<EmbeddedBrowserState>;
  readonly close: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserTabInput,
  ) => Promise<EmbeddedBrowserState>;
  readonly setBounds: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserSetBoundsInput,
  ) => Promise<EmbeddedBrowserState>;
  readonly share: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserShareInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  readonly navigate: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserNavigateInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  readonly history: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserHistoryActionInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  readonly snapshot: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserSnapshotInput,
  ) => Promise<EmbeddedBrowserSnapshot | null>;
  readonly click: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserClickInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  readonly type: (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserTypeInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  readonly closeAll: () => Promise<void>;
}

export class DesktopEmbeddedBrowser extends Context.Service<
  DesktopEmbeddedBrowser,
  DesktopEmbeddedBrowserShape
>()("cafecode/desktop/EmbeddedBrowser") {}

export function makeDesktopEmbeddedBrowser(
  platform: EmbeddedBrowserPlatform,
): DesktopEmbeddedBrowserShape {
  const tabsByOwner = new Map<DesktopIpcWebContents, OwnedTab>();

  const notify = (tab: OwnedTab): void => {
    if (tab.closed || tab.owner.isDestroyed?.() === true) return;
    const sender = tab.owner as Electron.WebContents;
    if (typeof sender.send === "function") {
      sender.send(EMBEDDED_BROWSER_STATE_CHANNEL, snapshotState(tab));
    }
  };

  const getOwnedTab = (owner: DesktopIpcWebContents, tabId: string): OwnedTab => {
    const tab = tabsByOwner.get(owner);
    if (!tab || tab.id !== tabId || tab.closed) {
      throw new Error("The embedded browser tab is closed or belongs to another renderer.");
    }
    return tab;
  };

  const closeTab = async (tab: OwnedTab): Promise<void> => {
    if (tab.closed) return;
    tab.closed = true;
    tab.sharedOrigin = null;
    tab.snapshot = null;
    tabsByOwner.delete(tab.owner);
    try {
      tab.ownerWindow.contentView.removeChildView(tab.view);
    } catch {
      // The parent window can already be tearing down.
    }
    const contents = tab.view.webContents;
    if (!contents.isDestroyed()) contents.close();
    await tab.isolatedSession.clearStorageData().catch(() => undefined);
    await tab.isolatedSession.clearCache().catch(() => undefined);
    await tab.isolatedSession.clearAuthCache().catch(() => undefined);
  };

  const confirm = async (
    tab: OwnedTab,
    input: Parameters<EmbeddedBrowserPlatform["confirm"]>[1],
  ): Promise<boolean> => platform.confirm(tab.ownerWindow, input);

  const ensureShared = (tab: OwnedTab): boolean => {
    if (tab.closed || tab.view.webContents.isDestroyed()) return false;
    const origin = originFor(tab.view.webContents.getURL());
    return tab.sharedOrigin !== null && origin === tab.sharedOrigin;
  };

  const approveSharedAction = async (
    tab: OwnedTab,
    input: Parameters<EmbeddedBrowserPlatform["confirm"]>[1],
  ): Promise<boolean> => {
    if (!ensureShared(tab)) return false;
    const approvedUrl = tab.view.webContents.getURL();
    const approved = await confirm(tab, input);
    return approved && ensureShared(tab) && tab.view.webContents.getURL() === approvedUrl;
  };

  const configureTab = (tab: OwnedTab): void => {
    const contents = tab.view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    contents.session.on("will-download", (event) => {
      event.preventDefault();
    });

    const guardNavigation = (
      event: Electron.Event<Electron.WebContentsWillNavigateEventParams>,
    ): void => {
      if (!isAllowedRemoteUrl(event.url)) {
        event.preventDefault();
      }
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);

    const navigationChanged = (): void => {
      invalidateSnapshot(tab);
      const currentOrigin = originFor(contents.getURL());
      if (tab.sharedOrigin !== null && currentOrigin !== tab.sharedOrigin) {
        tab.sharedOrigin = null;
      }
      notify(tab);
    };
    contents.on("did-start-loading", () => {
      invalidateSnapshot(tab);
      notify(tab);
    });
    contents.on("did-stop-loading", navigationChanged);
    contents.on("did-navigate", navigationChanged);
    contents.on("did-navigate-in-page", navigationChanged);
    contents.on("page-title-updated", (event) => {
      event.preventDefault();
      invalidateSnapshot(tab);
      notify(tab);
    });
    contents.on("render-process-gone", () => {
      tab.sharedOrigin = null;
      tab.snapshot = null;
      notify(tab);
    });
  };

  const open = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserOpenInput,
  ): Promise<EmbeddedBrowserState> => {
    const ownerWindow = platform.findOwnerWindow(owner);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      throw new Error("The embedded browser requires a live desktop window.");
    }
    const previous = tabsByOwner.get(owner);
    if (previous) await closeTab(previous);

    const id = platform
      .randomId()
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 128);
    const view = platform.createView(`club-code-embedded-${id}`);
    const tab: OwnedTab = {
      id,
      owner,
      ownerWindow,
      view,
      isolatedSession: view.webContents.session,
      sharedOrigin: null,
      bounds: null,
      snapshot: null,
      closed: false,
    };
    tabsByOwner.set(owner, tab);
    configureTab(tab);
    ownerWindow.contentView.addChildView(view);
    owner.once?.("destroyed", () => {
      void closeTab(tab);
    });
    ownerWindow.once("closed", () => {
      void closeTab(tab);
    });
    try {
      await view.webContents.loadURL(BLANK_URL);

      if (input.initialUrl) {
        const normalized = normalizeEmbeddedBrowserUrl(input.initialUrl);
        if (normalized) {
          const approved = await confirm(tab, {
            title: "Approve browser navigation",
            detail: `Open ${navigationApprovalUrl(normalized)} in this isolated tab?`,
            approveLabel: "Open site",
          });
          if (approved) await view.webContents.loadURL(normalized);
        }
      }
    } catch {
      await closeTab(tab);
      throw new Error("The isolated browser could not open the approved page.");
    }
    notify(tab);
    return snapshotState(tab);
  };

  const close = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserTabInput,
  ): Promise<EmbeddedBrowserState> => {
    const tab = getOwnedTab(owner, input.tabId);
    await closeTab(tab);
    return closedState();
  };

  const setBounds = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserSetBoundsInput,
  ): Promise<EmbeddedBrowserState> => {
    const tab = getOwnedTab(owner, input.tabId);
    const parentBounds = tab.ownerWindow.getContentBounds();
    const x = Math.min(input.bounds.x, Math.max(0, parentBounds.width - 1));
    const y = Math.min(input.bounds.y, Math.max(0, parentBounds.height - 1));
    const bounds = {
      x,
      y,
      width: Math.max(1, Math.min(input.bounds.width, parentBounds.width - x)),
      height: Math.max(1, Math.min(input.bounds.height, parentBounds.height - y)),
    };
    tab.bounds = bounds;
    tab.view.setBounds(bounds);
    return snapshotState(tab);
  };

  const share = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserShareInput,
  ): Promise<EmbeddedBrowserActionResult> => {
    const tab = getOwnedTab(owner, input.tabId);
    if (!input.shared) {
      tab.sharedOrigin = null;
      tab.snapshot = null;
      notify(tab);
      return completed(tab, "Page sharing revoked.");
    }
    const currentOrigin = originFor(tab.view.webContents.getURL());
    if (!currentOrigin) return result(tab, "failed", "Navigate to an HTTP or HTTPS page first.");
    const approved = await confirm(tab, {
      title: "Share this browser tab",
      detail:
        `Allow agent-requested snapshots and separately approved controls on ${currentOrigin}? ` +
        "Sharing does not read the page until you approve a snapshot, click, or typing action.",
      approveLabel: "Share this origin",
    });
    if (!approved) return result(tab, "denied", "Page sharing was not approved.");
    if (tab.closed || originFor(tab.view.webContents.getURL()) !== currentOrigin) {
      return result(tab, "stale", "The page changed while sharing approval was open.");
    }
    tab.sharedOrigin = currentOrigin;
    tab.snapshot = null;
    notify(tab);
    return completed(tab, `Shared ${currentOrigin}.`);
  };

  const navigate = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserNavigateInput,
  ): Promise<EmbeddedBrowserActionResult> => {
    const tab = getOwnedTab(owner, input.tabId);
    const normalized = normalizeEmbeddedBrowserUrl(input.url);
    if (!normalized) return result(tab, "failed", "Only HTTP and HTTPS navigation is allowed.");
    const approved = await confirm(tab, {
      title: "Approve browser navigation",
      detail: `Navigate this isolated tab to ${navigationApprovalUrl(normalized)}?`,
      approveLabel: "Navigate",
    });
    if (!approved || tab.closed) return result(tab, "denied", "Navigation was not approved.");
    invalidateSnapshot(tab);
    try {
      await tab.view.webContents.loadURL(normalized);
    } catch {
      return result(tab, "failed", "The approved page could not be loaded.");
    }
    return completed(tab, "Navigation completed.");
  };

  const history = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserHistoryActionInput,
  ): Promise<EmbeddedBrowserActionResult> => {
    const tab = getOwnedTab(owner, input.tabId);
    if (input.action === "stop") {
      tab.view.webContents.stop();
      return completed(tab, "Loading stopped.");
    }
    const currentUrl = tab.view.webContents.getURL();
    const approved = await confirm(tab, {
      title: "Approve browser navigation",
      detail: `Allow the ${input.action} action in this isolated tab?`,
      approveLabel:
        input.action === "reload" ? "Reload" : input.action === "back" ? "Go back" : "Go forward",
    });
    if (!approved || tab.closed) {
      return result(tab, "denied", "History navigation was not approved.");
    }
    if (currentUrl !== tab.view.webContents.getURL()) {
      return result(tab, "stale", "The page changed while navigation approval was open.");
    }
    invalidateSnapshot(tab);
    if (input.action === "reload") {
      tab.view.webContents.reload();
    } else if (input.action === "back" && tab.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    } else if (
      input.action === "forward" &&
      tab.view.webContents.navigationHistory.canGoForward()
    ) {
      tab.view.webContents.navigationHistory.goForward();
    } else {
      return result(tab, "failed", `Cannot go ${input.action}.`);
    }
    return completed(tab, `Browser ${input.action} action started.`);
  };

  const snapshot = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserSnapshotInput,
  ): Promise<EmbeddedBrowserSnapshot | null> => {
    const tab = getOwnedTab(owner, input.tabId);
    const approvedDocumentUrl = tab.view.webContents.getURL();
    const approved = await approveSharedAction(tab, {
      title: input.mode === "ocr" ? "Approve local image analysis" : "Approve page snapshot",
      detail:
        (input.mode === "ocr"
          ? "This one-time action captures only the currently visible isolated browser viewport for bounded, offline OCR, and also exposes a separately labeled redacted DOM/accessibility snapshot. No image leaves this device. "
          : "This one-time action exposes compact rendered top-level page text, including content below the current viewport, and accessibility labels. ") +
        "Do not approve it on an inbox or page containing secrets you do not want shared.",
      approveLabel: input.mode === "ocr" ? "Analyze locally" : "Create snapshot",
    });
    if (!approved) return null;

    let raw: RawDomSnapshot;
    try {
      raw = (await tab.view.webContents.executeJavaScript(
        DOM_SNAPSHOT_SCRIPT,
        true,
      )) as RawDomSnapshot;
    } catch {
      invalidateSnapshot(tab);
      return null;
    }
    if (typeof raw !== "object" || raw === null) {
      invalidateSnapshot(tab);
      return null;
    }
    if (!ensureShared(tab) || tab.view.webContents.getURL() !== approvedDocumentUrl) {
      invalidateSnapshot(tab);
      return null;
    }
    let ocr: EmbeddedBrowserSnapshot["ocr"] = null;
    if (input.mode === "ocr") {
      const bounds = tab.bounds;
      if (!bounds) {
        ocr = {
          status: "unavailable",
          reason: "The visible isolated browser viewport is not ready for local OCR.",
        };
      } else {
        let captured: CapturedEmbeddedBrowserViewport | undefined;
        try {
          captured = await platform.captureVisibleViewport(tab.view.webContents, bounds);
          ocr = await platform.ocr.recognize({
            ...captured,
            language: input.ocrLanguage ?? "eng",
          });
          if (ocr.status === "completed") {
            ocr = {
              ...ocr,
              text: redactEmbeddedBrowserText(ocr.text, EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS),
            };
          }
        } catch {
          ocr = {
            status: "unavailable",
            reason:
              "Bounded offline OCR could not analyze this viewport. No image or partial OCR text was retained.",
          };
        } finally {
          captured?.png.fill(0);
          captured = undefined;
        }
      }
      if (!ensureShared(tab) || tab.view.webContents.getURL() !== approvedDocumentUrl) {
        invalidateSnapshot(tab);
        return null;
      }
    }
    const targetsRaw = Array.isArray(raw.targets)
      ? raw.targets.slice(0, EMBEDDED_BROWSER_MAX_SNAPSHOT_TARGETS)
      : [];
    const targetLocators = new Map<string, SnapshotTargetLocator>();
    const targets = targetsRaw.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const candidate = entry as RawSnapshotTarget;
      const targetId = stringField(candidate.targetId, 32);
      const selector = stringField(candidate.selector, 2_048);
      if (!/^e[0-9]+$/.test(targetId) || selector.length === 0) return [];
      const sensitive = candidate.sensitive === true;
      const name = redactEmbeddedBrowserText(stringField(candidate.name, 512), 512);
      const role = redactEmbeddedBrowserText(stringField(candidate.role, 64), 64);
      const text = redactEmbeddedBrowserText(stringField(candidate.text, 1_024), 1_024);
      targetLocators.set(targetId, { selector, sensitive, role, name, text });
      return [
        {
          targetId,
          role,
          name,
          text,
          sensitive,
        },
      ];
    });
    const imageRegionsRaw = Array.isArray(raw.imageRegions)
      ? raw.imageRegions.slice(0, EMBEDDED_BROWSER_MAX_IMAGE_REGIONS)
      : [];
    const imageRegions = imageRegionsRaw.flatMap((entry, index) => {
      if (typeof entry !== "object" || entry === null) return [];
      const candidate = entry as RawImageRegion;
      return [
        {
          index,
          alt: redactEmbeddedBrowserText(stringField(candidate.alt, 1_024), 1_024),
          labelledBy: redactEmbeddedBrowserText(stringField(candidate.labelledBy, 1_024), 1_024),
        },
      ];
    });
    const snapshotId = platform
      .randomId()
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 128);
    const documentUrl = approvedDocumentUrl;
    tab.snapshot = { id: snapshotId, documentUrl, targets: targetLocators };
    return {
      snapshotId,
      mode: input.mode,
      displayUrl: embeddedBrowserDisplayUrl(documentUrl),
      title: redactEmbeddedBrowserText(stringField(raw.title, 512), 512),
      capturedAt: platform.nowIso(),
      text: redactEmbeddedBrowserText(
        stringField(raw.text, EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS + 6_000),
        EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS,
      ),
      targets,
      imageRegions,
      ocr,
      redactionNotice: REDACTION_NOTICE,
    };
  };

  const targetPoint = async (
    tab: OwnedTab,
    target: SnapshotTargetLocator,
    selectText: boolean,
  ): Promise<{ x: number; y: number; editable: boolean; sensitive: boolean } | null> => {
    let raw: TargetPoint | null;
    try {
      raw = (await tab.view.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${JSON.stringify(target.selector)});
          if (!(element instanceof HTMLElement)) return null;
          const clip = (value, max) => String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, max);
          const roleFor = (candidate) => candidate.getAttribute("role") || ({
            A: "link",
            BUTTON: "button",
            INPUT: candidate.type === "checkbox" ? "checkbox" : "textbox",
            SELECT: "combobox",
            TEXTAREA: "textbox"
          }[candidate.tagName] || candidate.tagName.toLowerCase());
          const nameFor = (candidate) => {
            const labelledBy = candidate.getAttribute("aria-labelledby");
            const labelled = labelledBy
              ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
              : "";
            const label = candidate.labels
              ? Array.from(candidate.labels).map((entry) => entry.textContent || "").join(" ")
              : "";
            return clip(
              candidate.getAttribute("aria-label") || labelled || label || candidate.getAttribute("alt") ||
              candidate.getAttribute("title") || candidate.getAttribute("placeholder") || candidate.textContent,
              512
            );
          };
          const attributes = [
            element.getAttribute("type"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("autocomplete"),
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder")
          ].join(" ").toLowerCase();
          const editable =
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element.isContentEditable;
          element.focus();
          if (document.activeElement !== element) return null;
          if (${selectText ? "true" : "false"} && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.select();
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return null;
          const x = Math.round(rect.left + rect.width / 2);
          const y = Math.round(rect.top + rect.height / 2);
          const hit = document.elementFromPoint(x, y);
          if (!hit || (hit !== element && !element.contains(hit))) return null;
          return {
            x,
            y,
            editable,
            sensitive: /(password|passcode|one-time|otp|2fa|verification|security.?code|token)/.test(attributes),
            role: clip(roleFor(element), 64),
            name: nameFor(element),
            text: element.matches("input,textarea,select") ? "" : clip(element.textContent, 1024)
          };
        })()`,
        true,
      )) as TargetPoint | null;
    } catch {
      return null;
    }
    if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
    const role = redactEmbeddedBrowserText(stringField(raw.role, 64), 64);
    const name = redactEmbeddedBrowserText(stringField(raw.name, 512), 512);
    const text = redactEmbeddedBrowserText(stringField(raw.text, 1_024), 1_024);
    if (role !== target.role || name !== target.name || text !== target.text) return null;
    return {
      x: Number(raw.x),
      y: Number(raw.y),
      editable: raw.editable === true,
      sensitive: raw.sensitive === true,
    };
  };

  const click = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserClickInput,
  ): Promise<EmbeddedBrowserActionResult> => {
    const tab = getOwnedTab(owner, input.tabId);
    const claimed = claimTarget(tab, input.snapshotId, input.targetId);
    if (!claimed) return result(tab, "stale", "Take a new snapshot before controlling this page.");
    const approved = await approveSharedAction(tab, {
      title: "Approve browser click",
      detail: `Allow one click on ${claimed.target.name || input.targetId} at ${snapshotState(tab).displayUrl}?`,
      approveLabel: "Click once",
    });
    if (!approved) return result(tab, "denied", "The click was not approved.");
    if (tab.view.webContents.getURL() !== claimed.documentUrl) {
      return result(tab, "stale", "The page changed while click approval was open.");
    }
    const point = await targetPoint(tab, claimed.target, false);
    if (!point) return result(tab, "stale", "The target moved or is no longer visible.");
    if (!ensureShared(tab) || tab.view.webContents.getURL() !== claimed.documentUrl) {
      return result(tab, "stale", "The page changed before the approved click could be sent.");
    }
    try {
      sendTrustedClick(tab, point);
    } catch {
      return result(tab, "failed", "The approved click could not be sent.");
    }
    invalidateSnapshot(tab);
    return completed(tab, "One approved click was sent.");
  };

  const type = async (
    owner: DesktopIpcWebContents,
    input: EmbeddedBrowserTypeInput,
  ): Promise<EmbeddedBrowserActionResult> => {
    const tab = getOwnedTab(owner, input.tabId);
    const target = locateTarget(tab, input.snapshotId, input.targetId);
    if (!target) return result(tab, "stale", "Take a new snapshot before controlling this page.");
    if (target.sensitive && !input.sensitive) {
      return result(tab, "failed", "This field requires sensitive-entry approval.");
    }
    const sensitive = target.sensitive || input.sensitive;
    if (sensitive && !canTypeSensitiveValue(tab.view.webContents.getURL())) {
      return result(
        tab,
        "failed",
        "Sensitive entry is allowed only on HTTPS pages or a loopback HTTP page.",
      );
    }
    const claimed = claimTarget(tab, input.snapshotId, input.targetId);
    if (!claimed) return result(tab, "stale", "Take a new snapshot before controlling this page.");
    const approved = await approveSharedAction(tab, {
      title: sensitive ? "Approve credential or 2FA entry" : "Approve browser typing",
      detail:
        `${sensitive ? "Type a sensitive value" : "Type text"} into ${claimed.target.name || input.targetId} ` +
        `at ${snapshotState(tab).displayUrl}? The value is not shown in this prompt or retained by Club Code.`,
      approveLabel: sensitive ? "Type sensitive value once" : "Type once",
      destructive: sensitive,
    });
    if (!approved) return result(tab, "denied", "Typing was not approved.");
    if (tab.view.webContents.getURL() !== claimed.documentUrl) {
      return result(tab, "stale", "The page changed while typing approval was open.");
    }
    const point = await targetPoint(tab, claimed.target, true);
    if (!point) return result(tab, "stale", "The target moved or is no longer visible.");
    if (!ensureShared(tab) || tab.view.webContents.getURL() !== claimed.documentUrl) {
      return result(tab, "stale", "The page changed before the approved text could be entered.");
    }
    if (!point.editable) return result(tab, "failed", "The selected target is not editable.");
    if (point.sensitive && !input.sensitive) {
      return result(tab, "failed", "The field became sensitive; approve it as sensitive entry.");
    }
    try {
      tab.view.webContents.insertText(input.value);
    } catch {
      return result(tab, "failed", "The approved text could not be entered.");
    }
    invalidateSnapshot(tab);
    return completed(
      tab,
      sensitive ? "The sensitive value was entered once." : "The text was entered once.",
    );
  };

  return {
    open,
    close,
    setBounds,
    share,
    navigate,
    history,
    snapshot,
    click,
    type,
    closeAll: async () => {
      await Promise.all([...tabsByOwner.values()].map(closeTab));
      await platform.ocr.close();
    },
  };
}

export function embeddedBrowserWebPreferences(partition: string): Electron.WebPreferences {
  return {
    partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
  };
}

const electronPlatform: EmbeddedBrowserPlatform = {
  createView: (partition) =>
    new Electron.WebContentsView({
      webPreferences: embeddedBrowserWebPreferences(partition),
    }),
  findOwnerWindow: (owner) => Electron.BrowserWindow.fromWebContents(owner as Electron.WebContents),
  confirm: async (ownerWindow, input) => {
    const response = await Electron.dialog.showMessageBox(ownerWindow, {
      type: input.destructive ? "warning" : "question",
      title: input.title,
      message: input.title,
      detail: input.detail,
      buttons: [input.approveLabel, "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return response.response === 0;
  },
  randomId: () => crypto.randomUUID(),
  nowIso: () => new Date().toISOString(),
  captureVisibleViewport: async (contents, bounds) => {
    if (
      bounds.width > EMBEDDED_BROWSER_OCR_MAX_CAPTURE_EDGE ||
      bounds.height > EMBEDDED_BROWSER_OCR_MAX_CAPTURE_EDGE ||
      bounds.width * bounds.height > EMBEDDED_BROWSER_OCR_MAX_CAPTURE_PIXELS
    ) {
      throw new Error("The visible browser viewport exceeds the OCR capture limits.");
    }
    const captured = await contents.capturePage({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
    const capturedSize = captured.getSize();
    if (
      capturedSize.width < 1 ||
      capturedSize.height < 1 ||
      capturedSize.width > EMBEDDED_BROWSER_OCR_MAX_CAPTURE_EDGE ||
      capturedSize.height > EMBEDDED_BROWSER_OCR_MAX_CAPTURE_EDGE ||
      capturedSize.width * capturedSize.height > EMBEDDED_BROWSER_OCR_MAX_CAPTURE_PIXELS
    ) {
      throw new Error("The captured browser viewport exceeds the OCR limits.");
    }
    const scale = Math.min(
      1,
      EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE / capturedSize.width,
      EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE / capturedSize.height,
      Math.sqrt(EMBEDDED_BROWSER_OCR_MAX_INPUT_PIXELS / (capturedSize.width * capturedSize.height)),
    );
    const width = Math.max(1, Math.floor(capturedSize.width * scale));
    const height = Math.max(1, Math.floor(capturedSize.height * scale));
    const prepared = scale < 1 ? captured.resize({ width, height, quality: "good" }) : captured;
    const png = prepared.toPNG();
    if (png.byteLength < 1 || png.byteLength > EMBEDDED_BROWSER_OCR_MAX_PNG_BYTES) {
      png.fill(0);
      throw new Error("The encoded browser viewport exceeds the OCR byte limit.");
    }
    return { png, width, height };
  },
  ocr: embeddedBrowserOcrEngine,
};

export const layer = Layer.effect(
  DesktopEmbeddedBrowser,
  Effect.acquireRelease(
    Effect.sync(() => DesktopEmbeddedBrowser.of(makeDesktopEmbeddedBrowser(electronPlatform))),
    (service) => Effect.promise(() => service.closeAll()),
  ),
);
