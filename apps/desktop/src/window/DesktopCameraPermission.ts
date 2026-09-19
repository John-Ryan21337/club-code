import type * as Electron from "electron";

export interface CameraPermissionSession {
  readonly setPermissionCheckHandler: Electron.Session["setPermissionCheckHandler"];
  readonly setPermissionRequestHandler: Electron.Session["setPermissionRequestHandler"];
}

export interface CameraPermissionWebContents {
  readonly session: CameraPermissionSession;
  readonly mainFrame: Pick<Electron.WebFrameMain, "isDestroyed" | "origin">;
  readonly getURL: () => string;
  readonly isDestroyed: () => boolean;
}

const sessionOwners = new WeakMap<CameraPermissionSession, symbol>();
const microphoneGrants = new WeakMap<
  object,
  {
    request: (frame: object | null | undefined) => boolean;
    revoke: () => void;
  }
>();

/** Called only through the sender-validated desktop IPC route. */
export function requestTrustedMicrophoneAccess(
  sender: object | undefined,
  frame?: object | null,
): boolean {
  return sender !== undefined && (microphoneGrants.get(sender)?.request(frame) ?? false);
}

export function revokeTrustedMicrophoneAccess(sender: object): void {
  microphoneGrants.get(sender)?.revoke();
}

function clearPermissionHandlers(session: CameraPermissionSession): void {
  // Electron exposes independent setters and no atomic replace/reset operation.
  // Attempt both resets even if one setter throws so a partially installed
  // permission boundary cannot retain the other handler.
  try {
    session.setPermissionCheckHandler(null);
  } catch {
    // The retained handler still fails closed once its trusted WebContents is
    // destroyed. Do not let a teardown failure prevent the request reset.
  }
  try {
    session.setPermissionRequestHandler(null);
  } catch {
    // Teardown is best-effort because Electron provides no fallback removal API.
  }
}

function urlHasOrigin(url: string, trustedOrigin: string): boolean {
  try {
    return new URL(url).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function isLiveTrustedMainContents(
  requestingWebContents: unknown,
  trustedWebContents: CameraPermissionWebContents,
  trustedOrigin: string,
): boolean {
  try {
    const trustedFrame = trustedWebContents.mainFrame;
    return (
      requestingWebContents === trustedWebContents &&
      !trustedWebContents.isDestroyed() &&
      !trustedFrame.isDestroyed() &&
      trustedFrame.origin === trustedOrigin &&
      urlHasOrigin(trustedWebContents.getURL(), trustedOrigin)
    );
  } catch {
    // WebContents/WebFrameMain properties can become unavailable during
    // cross-process navigation or teardown. Permission checks fail closed.
    return false;
  }
}

export function allowsTrustedMainFrameCameraCheck(
  requestingWebContents: unknown,
  permission: string,
  requestingOrigin: string,
  details: Electron.PermissionCheckHandlerHandlerDetails,
  trustedWebContents: CameraPermissionWebContents,
  trustedOrigin: string,
): boolean {
  return (
    permission === "media" &&
    details.isMainFrame &&
    details.mediaType === "video" &&
    requestingOrigin === trustedOrigin &&
    details.securityOrigin === trustedOrigin &&
    (details.embeddingOrigin === undefined || details.embeddingOrigin === trustedOrigin) &&
    details.requestingUrl !== undefined &&
    urlHasOrigin(details.requestingUrl, trustedOrigin) &&
    isLiveTrustedMainContents(requestingWebContents, trustedWebContents, trustedOrigin)
  );
}

export function allowsTrustedMainFrameCameraRequest(
  requestingWebContents: unknown,
  permission: string,
  details:
    | Electron.PermissionRequest
    | Electron.FilesystemPermissionRequest
    | Electron.MediaAccessPermissionRequest
    | Electron.OpenExternalPermissionRequest,
  trustedWebContents: CameraPermissionWebContents,
  trustedOrigin: string,
): boolean {
  const mediaDetails = details as Electron.MediaAccessPermissionRequest;
  return (
    permission === "media" &&
    mediaDetails.isMainFrame &&
    mediaDetails.mediaTypes?.length === 1 &&
    mediaDetails.mediaTypes[0] === "video" &&
    mediaDetails.securityOrigin === trustedOrigin &&
    urlHasOrigin(mediaDetails.requestingUrl, trustedOrigin) &&
    isLiveTrustedMainContents(requestingWebContents, trustedWebContents, trustedOrigin)
  );
}

/**
 * Grants getUserMedia camera video only to the live Club Code main frame.
 * Microphone access additionally requires a recent, frame-bound IPC grant.
 *
 * Electron's media permission callbacks do not expose a user-gesture flag.
 * This handler therefore responds only to Chromium's actual permission
 * check/request flow; it never pre-opens a device.
 */
export function installTrustedMainFrameCameraPermission(
  webContents: CameraPermissionWebContents,
  trustedOrigin: string,
  isForeground: () => boolean = () => false,
): () => void {
  const session = webContents.session;
  const owner = Symbol("desktop-camera-permission");
  sessionOwners.set(session, owner);
  let microphoneUntil = 0;
  let microphoneFrame = webContents.mainFrame;
  const revoke = () => {
    microphoneUntil = 0;
  };
  const microphoneAllowed = () => {
    try {
      const allowed =
        sessionOwners.get(session) === owner &&
        performance.now() < microphoneUntil &&
        webContents.mainFrame === microphoneFrame &&
        isForeground() &&
        isLiveTrustedMainContents(webContents, webContents, trustedOrigin);
      if (!allowed) revoke();
      return allowed;
    } catch {
      revoke();
      return false;
    }
  };
  const grant = {
    revoke,
    request: (frame: object | null | undefined) => {
      revoke();
      try {
        if (
          sessionOwners.get(session) !== owner ||
          !isForeground() ||
          frame !== webContents.mainFrame ||
          !isLiveTrustedMainContents(webContents, webContents, trustedOrigin)
        )
          return false;
        microphoneFrame = webContents.mainFrame;
        microphoneUntil = performance.now() + 5000;
        return true;
      } catch {
        return false;
      }
    },
  };
  microphoneGrants.set(webContents, grant);

  try {
    session.setPermissionCheckHandler(
      (requestingWebContents, permission, requestingOrigin, details) =>
        sessionOwners.get(session) === owner &&
        (allowsTrustedMainFrameCameraCheck(
          requestingWebContents,
          permission,
          requestingOrigin,
          details,
          webContents,
          trustedOrigin,
        ) ||
          (details.mediaType === "audio" &&
            microphoneAllowed() &&
            allowsTrustedMainFrameCameraCheck(
              requestingWebContents,
              permission,
              requestingOrigin,
              { ...details, mediaType: "video" },
              webContents,
              trustedOrigin,
            ))),
    );
    session.setPermissionRequestHandler((requestingWebContents, permission, callback, details) => {
      const allowed =
        sessionOwners.get(session) === owner &&
        (allowsTrustedMainFrameCameraRequest(
          requestingWebContents,
          permission,
          details,
          webContents,
          trustedOrigin,
        ) ||
          ((details as Electron.MediaAccessPermissionRequest).mediaTypes?.length === 1 &&
            (details as Electron.MediaAccessPermissionRequest).mediaTypes?.[0] === "audio" &&
            microphoneAllowed() &&
            allowsTrustedMainFrameCameraRequest(
              requestingWebContents,
              permission,
              { ...details, mediaTypes: ["video"] } as Electron.MediaAccessPermissionRequest,
              webContents,
              trustedOrigin,
            )));
      try {
        callback(allowed);
      } catch {
        revoke();
      }
    });
  } catch (cause) {
    if (sessionOwners.get(session) === owner) {
      sessionOwners.delete(session);
      microphoneGrants.delete(webContents);
      clearPermissionHandlers(session);
    }
    throw cause;
  }

  return () => {
    revoke();
    if (microphoneGrants.get(webContents) === grant) microphoneGrants.delete(webContents);
    if (sessionOwners.get(session) !== owner) return;
    sessionOwners.delete(session);
    microphoneGrants.delete(webContents);
    clearPermissionHandlers(session);
  };
}
