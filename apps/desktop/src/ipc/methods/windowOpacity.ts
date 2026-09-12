import {
  DesktopWindowOpacityPreferenceSchema,
  DesktopWindowOpacityStateSchema,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getWindowOpacityState = makeIpcMethod({
  channel: IpcChannels.GET_WINDOW_OPACITY_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopWindowOpacityStateSchema,
  handler: Effect.fn("desktop.ipc.windowOpacity.getState")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    return yield* desktopWindow.getWindowOpacityState;
  }),
});

export const setWindowOpacityPreference = makeIpcMethod({
  channel: IpcChannels.SET_WINDOW_OPACITY_PREFERENCE_CHANNEL,
  payload: DesktopWindowOpacityPreferenceSchema,
  result: DesktopWindowOpacityStateSchema,
  handler: Effect.fn("desktop.ipc.windowOpacity.setPreference")(function* (preference) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    return yield* desktopWindow.setWindowOpacityPreference(preference);
  }),
});
