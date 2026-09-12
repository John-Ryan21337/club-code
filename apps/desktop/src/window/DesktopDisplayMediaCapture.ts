import type * as Electron from "electron";

export interface DisplayMediaSession {
  readonly setDisplayMediaRequestHandler: Electron.Session["setDisplayMediaRequestHandler"];
}

export interface DisplayMediaWebContents {
  readonly session: DisplayMediaSession;
  readonly mainFrame: Electron.WebFrameMain;
  readonly isDestroyed: () => boolean;
  readonly isFocused: () => boolean;
}

/**
 * Electron 42 has no cross-platform native display picker: its system picker is
 * experimental and macOS 15+ only. The desktop app therefore grants only the
 * visible, focused Cafe Code main frame after a renderer user gesture.
 * The grant selects this Cafe frame. Embedded-player audio availability still
 * depends on the platform and media source; system-wide loopback is not granted.
 */
export function resolveTrustedFrameAudioGrant(
  request: Electron.DisplayMediaRequestHandlerHandlerRequest,
  trustedFrame: Electron.WebFrameMain,
  trustedOrigin: string,
): Electron.Streams | null {
  if (
    !request.userGesture ||
    !request.audioRequested ||
    !request.videoRequested ||
    request.frame !== trustedFrame ||
    trustedFrame.isDestroyed() ||
    trustedFrame.visibilityState !== "visible" ||
    trustedFrame.origin !== trustedOrigin ||
    // Electron can serialize the same security origin with its root slash.
    // Accept exactly those two forms, never a URL with a path or credentials.
    (request.securityOrigin !== trustedOrigin && request.securityOrigin !== `${trustedOrigin}/`)
  ) {
    return null;
  }
  return {
    video: trustedFrame,
    audio: trustedFrame,
    enableLocalEcho: true,
  };
}

const sessionOwners = new WeakMap<DisplayMediaSession, symbol>();

export function installTrustedFrameAudioCapture(
  webContents: DisplayMediaWebContents,
  trustedOrigin: string,
): () => void {
  let installed = true;
  const session = webContents.session;
  const owner = Symbol("display audio owner");
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Resolve at request time: cross-process main-frame navigation can
      // replace the WebFrameMain object that existed when the window opened.
      let grant: Electron.Streams | null = null;
      try {
        if (
          installed &&
          sessionOwners.get(session) === owner &&
          !webContents.isDestroyed() &&
          webContents.isFocused()
        ) {
          grant = resolveTrustedFrameAudioGrant(request, webContents.mainFrame, trustedOrigin);
        }
      } catch {
        // A destroyed or navigating frame cannot authorize capture.
      }
      try {
        callback(grant ?? {});
      } catch {
        // Electron can throw while rejecting an empty grant or a frame that
        // closes during delivery. Do not retry this one-use native callback.
      }
    },
    { useSystemPicker: false },
  );
  sessionOwners.set(session, owner);
  return () => {
    if (!installed) return;
    installed = false;
    if (sessionOwners.get(session) !== owner) return;
    sessionOwners.delete(session);
    try {
      session.setDisplayMediaRequestHandler(null);
    } catch {
      // The Electron session may already have closed during window teardown.
    }
  };
}
