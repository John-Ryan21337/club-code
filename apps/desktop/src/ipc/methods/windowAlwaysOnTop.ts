import {
  DesktopWindowAlwaysOnTopPreferenceSchema,
  DesktopWindowAlwaysOnTopStateSchema,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getWindowAlwaysOnTopState = makeIpcMethod({
  channel: IpcChannels.GET_WINDOW_ALWAYS_ON_TOP_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopWindowAlwaysOnTopStateSchema,
  handler: Effect.fn("desktop.ipc.windowAlwaysOnTop.getState")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    return yield* desktopWindow.getWindowAlwaysOnTopState;
  }),
});

export const setWindowAlwaysOnTopPreference = makeIpcMethod({
  channel: IpcChannels.SET_WINDOW_ALWAYS_ON_TOP_PREFERENCE_CHANNEL,
  payload: DesktopWindowAlwaysOnTopPreferenceSchema,
  result: DesktopWindowAlwaysOnTopStateSchema,
  handler: Effect.fn("desktop.ipc.windowAlwaysOnTop.setPreference")(function* (preference) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    return yield* desktopWindow.setWindowAlwaysOnTopPreference(preference);
  }),
});
