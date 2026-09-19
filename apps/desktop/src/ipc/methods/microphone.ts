import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { requestTrustedMicrophoneAccess } from "../../window/DesktopCameraPermission.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const requestMicrophoneAccess = makeIpcMethod({
  channel: IpcChannels.REQUEST_MICROPHONE_ACCESS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: (_input, event) =>
    Effect.sync(() => requestTrustedMicrophoneAccess(event.sender, event.senderFrame)),
});
