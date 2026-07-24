import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  getSavedEnvironmentRegistry,
  getSavedEnvironmentSecret,
  removeSavedEnvironmentSecret,
  setSavedEnvironmentRegistry,
  setSavedEnvironmentSecret,
} from "./methods/savedEnvironments.ts";
import {
  getAdvertisedEndpoints,
  getServerExposureState,
  setServerExposureMode,
  setServerHttpsEnabled,
} from "./methods/serverExposure.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import { checkSourceUpdate, getSourceUpdateState } from "./methods/sourceUpdates.ts";
import { setPowerSaveBlockerState } from "./methods/powerSaveBlocker.ts";
import { getDebugEndpointState, publishDebugSnapshot } from "./methods/debug.ts";
import { getWindowOpacityState, setWindowOpacityPreference } from "./methods/windowOpacity.ts";
import {
  getCompletionSpeechCapability,
  synthesizeCompletionSpeech,
} from "./methods/completionSpeech.ts";
import {
  getLocalMediaCapability,
  navigateLocalMedia,
  pickLocalMedia,
  releaseLocalMedia,
} from "./methods/localMedia.ts";
import {
  clickEmbeddedBrowser,
  closeEmbeddedBrowser,
  controlEmbeddedBrowserHistory,
  navigateEmbeddedBrowser,
  openEmbeddedBrowser,
  setEmbeddedBrowserBounds,
  shareEmbeddedBrowser,
  snapshotEmbeddedBrowser,
  typeInEmbeddedBrowser,
} from "./methods/embeddedBrowser.ts";
import {
  confirm,
  getAppBranding,
  getLocalEnvironmentBootstrap,
  openExternal,
  openPath,
  pickFolder,
  revealPath,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getLocalEnvironmentBootstrap);

  yield* ipc.handle(getDebugEndpointState);
  yield* ipc.handle(publishDebugSnapshot);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(setPowerSaveBlockerState);
  yield* ipc.handle(getSavedEnvironmentRegistry);
  yield* ipc.handle(setSavedEnvironmentRegistry);
  yield* ipc.handle(getSavedEnvironmentSecret);
  yield* ipc.handle(setSavedEnvironmentSecret);
  yield* ipc.handle(removeSavedEnvironmentSecret);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);
  yield* ipc.handle(setServerHttpsEnabled);
  yield* ipc.handle(getAdvertisedEndpoints);
  yield* ipc.handle(getWindowOpacityState);
  yield* ipc.handle(setWindowOpacityPreference);
  yield* ipc.handle(getCompletionSpeechCapability);
  yield* ipc.handle(synthesizeCompletionSpeech);
  yield* ipc.handle(getLocalMediaCapability);
  yield* ipc.handleFromSender(pickLocalMedia);
  yield* ipc.handleFromSender(navigateLocalMedia);
  yield* ipc.handleFromSender(releaseLocalMedia);
  yield* ipc.handleFromSender(openEmbeddedBrowser);
  yield* ipc.handleFromSender(closeEmbeddedBrowser);
  yield* ipc.handleFromSender(setEmbeddedBrowserBounds);
  yield* ipc.handleFromSender(shareEmbeddedBrowser);
  yield* ipc.handleFromSender(navigateEmbeddedBrowser);
  yield* ipc.handleFromSender(controlEmbeddedBrowserHistory);
  yield* ipc.handleFromSender(snapshotEmbeddedBrowser);
  yield* ipc.handleFromSender(clickEmbeddedBrowser);
  yield* ipc.handleFromSender(typeInEmbeddedBrowser);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(confirm);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openPath);
  yield* ipc.handle(revealPath);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  yield* ipc.handle(getSourceUpdateState);
  yield* ipc.handle(checkSourceUpdate);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
