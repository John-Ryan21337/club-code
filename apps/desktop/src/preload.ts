import type { DesktopBridge } from "@cafecode/contracts";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getAppBranding"]>;
  },
  getLocalEnvironmentBootstrap: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstrap"]>;
  },
  getDebugEndpointState: () => ipcRenderer.invoke(IpcChannels.GET_DEBUG_ENDPOINT_STATE_CHANNEL),
  publishDebugSnapshot: (snapshot) =>
    ipcRenderer.invoke(IpcChannels.PUBLISH_DEBUG_SNAPSHOT_CHANNEL, snapshot),
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.SET_CLIENT_SETTINGS_CHANNEL, settings),
  setPowerSaveBlockerState: (state) =>
    ipcRenderer.invoke(IpcChannels.SET_POWER_SAVE_BLOCKER_STATE_CHANNEL, state),
  getSavedEnvironmentRegistry: () =>
    ipcRenderer.invoke(IpcChannels.GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL),
  setSavedEnvironmentRegistry: (records) =>
    ipcRenderer.invoke(IpcChannels.SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, records),
  getSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(IpcChannels.GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  setSavedEnvironmentSecret: (environmentId, secret) =>
    ipcRenderer.invoke(IpcChannels.SET_SAVED_ENVIRONMENT_SECRET_CHANNEL, { environmentId, secret }),
  removeSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(IpcChannels.REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  getServerExposureState: () => ipcRenderer.invoke(IpcChannels.GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) =>
    ipcRenderer.invoke(IpcChannels.SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  setServerHttpsEnabled: (enabled) =>
    ipcRenderer.invoke(IpcChannels.SET_SERVER_HTTPS_ENABLED_CHANNEL, enabled),
  getAdvertisedEndpoints: () => ipcRenderer.invoke(IpcChannels.GET_ADVERTISED_ENDPOINTS_CHANNEL),
  getWindowOpacityState: () => ipcRenderer.invoke(IpcChannels.GET_WINDOW_OPACITY_STATE_CHANNEL),
  setWindowOpacityPreference: (preference) =>
    ipcRenderer.invoke(IpcChannels.SET_WINDOW_OPACITY_PREFERENCE_CHANNEL, preference),
  getCompletionSpeechCapability: () =>
    ipcRenderer.invoke(IpcChannels.GET_COMPLETION_SPEECH_CAPABILITY_CHANNEL),
  synthesizeCompletionSpeech: (input) =>
    ipcRenderer.invoke(IpcChannels.SYNTHESIZE_COMPLETION_SPEECH_CHANNEL, input),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.PICK_FOLDER_CHANNEL, options),
  getLocalMediaCapability: () => ipcRenderer.invoke(IpcChannels.GET_LOCAL_MEDIA_CAPABILITY_CHANNEL),
  pickLocalMedia: () => ipcRenderer.invoke(IpcChannels.PICK_LOCAL_MEDIA_CHANNEL),
  navigateLocalMedia: (input) =>
    ipcRenderer.invoke(IpcChannels.NAVIGATE_LOCAL_MEDIA_CHANNEL, input),
  releaseLocalMedia: (input) => ipcRenderer.invoke(IpcChannels.RELEASE_LOCAL_MEDIA_CHANNEL, input),
  openEmbeddedBrowser: (input = {}) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_OPEN_CHANNEL, input),
  closeEmbeddedBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_CLOSE_CHANNEL, input),
  setEmbeddedBrowserBounds: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_SET_BOUNDS_CHANNEL, input),
  shareEmbeddedBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_SHARE_CHANNEL, input),
  navigateEmbeddedBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_NAVIGATE_CHANNEL, input),
  controlEmbeddedBrowserHistory: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_HISTORY_CHANNEL, input),
  snapshotEmbeddedBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_SNAPSHOT_CHANNEL, input),
  clickEmbeddedBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_CLICK_CHANNEL, input),
  typeInEmbeddedBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.EMBEDDED_BROWSER_TYPE_CHANNEL, input),
  onEmbeddedBrowserState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IpcChannels.EMBEDDED_BROWSER_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.EMBEDDED_BROWSER_STATE_CHANNEL, wrappedListener);
    };
  },
  confirm: (message) => ipcRenderer.invoke(IpcChannels.CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_CHANNEL, {
      items,
      ...(position === undefined ? {} : { position }),
    }),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),
  openPath: (path: string) => ipcRenderer.invoke(IpcChannels.OPEN_PATH_CHANNEL, path),
  revealPath: (path: string) => ipcRenderer.invoke(IpcChannels.REVEAL_PATH_CHANNEL, path),
  copyText: (text: string) => ipcRenderer.invoke(IpcChannels.COPY_TEXT_CHANNEL, text),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL_CHANNEL, channel),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  getSourceUpdateState: () => ipcRenderer.invoke(IpcChannels.SOURCE_UPDATE_GET_STATE_CHANNEL),
  checkSourceUpdate: () => ipcRenderer.invoke(IpcChannels.SOURCE_UPDATE_CHECK_CHANNEL),
  onSourceUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.SOURCE_UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SOURCE_UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
