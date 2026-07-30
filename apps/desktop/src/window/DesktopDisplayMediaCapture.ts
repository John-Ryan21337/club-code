import type * as Electron from "electron";

export interface DisplayMediaSession {
  readonly setDisplayMediaRequestHandler: Electron.Session["setDisplayMediaRequestHandler"];
}

export interface DisplayMediaWebContents {
  readonly session: DisplayMediaSession;
  readonly mainFrame: Electron.WebFrameMain;
}

/**
 * Electron 42 has no cross-platform native display picker: its system picker is
 * experimental and macOS 15+ only. The desktop app therefore grants only the
 * already-visible, trusted Club Code main frame after a renderer user gesture.
 * That is enough to analyse audio produced by the embedded YouTube/Spotify
 * player without granting a silent system-wide loopback capture.
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
    trustedFrame.origin !== trustedOrigin ||
    request.securityOrigin !== trustedOrigin
  ) {
    return null;
  }
  return {
    video: trustedFrame,
    audio: trustedFrame,
    enableLocalEcho: true,
  };
}

export function installTrustedFrameAudioCapture(
  webContents: DisplayMediaWebContents,
  trustedOrigin: string,
): () => void {
  let installed = true;
  const session = webContents.session;
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Resolve at request time: cross-process main-frame navigation can
      // replace the WebFrameMain object that existed when the window opened.
      const trustedFrame = webContents.mainFrame;
      callback(resolveTrustedFrameAudioGrant(request, trustedFrame, trustedOrigin) ?? {});
    },
    { useSystemPicker: false },
  );
  return () => {
    if (!installed) return;
    installed = false;
    session.setDisplayMediaRequestHandler(null);
  };
}
