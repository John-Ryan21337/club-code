import {
  DesktopLocalMediaCapabilitySchema,
  DesktopLocalMediaNavigateInputSchema,
  DesktopLocalMediaReleaseInputSchema,
  DesktopLocalMediaSelectionSchema,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopVlcMedia from "../../media/DesktopVlcMedia.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getLocalMediaCapability = makeIpcMethod({
  channel: IpcChannels.GET_LOCAL_MEDIA_CAPABILITY_CHANNEL,
  payload: Schema.Void,
  result: DesktopLocalMediaCapabilitySchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.localMedia.getCapability")(function* () {
    const media = yield* DesktopVlcMedia.DesktopVlcMedia;
    return yield* media.capability;
  }),
});

export const pickLocalMedia = makeIpcMethod({
  channel: IpcChannels.PICK_LOCAL_MEDIA_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopLocalMediaSelectionSchema),
  strict: true,
  handler: Effect.fn("desktop.ipc.localMedia.pick")(function* (_input, event) {
    const media = yield* DesktopVlcMedia.DesktopVlcMedia;
    return yield* media.pick(event.sender ?? {});
  }),
});

export const releaseLocalMedia = makeIpcMethod({
  channel: IpcChannels.RELEASE_LOCAL_MEDIA_CHANNEL,
  payload: DesktopLocalMediaReleaseInputSchema,
  result: Schema.Boolean,
  strict: true,
  handler: Effect.fn("desktop.ipc.localMedia.release")(function* (input, event) {
    const media = yield* DesktopVlcMedia.DesktopVlcMedia;
    return yield* media.release(event.sender ?? {}, input);
  }),
});

export const navigateLocalMedia = makeIpcMethod({
  channel: IpcChannels.NAVIGATE_LOCAL_MEDIA_CHANNEL,
  payload: DesktopLocalMediaNavigateInputSchema,
  result: Schema.NullOr(DesktopLocalMediaSelectionSchema),
  strict: true,
  handler: Effect.fn("desktop.ipc.localMedia.navigate")(function* (input, event) {
    const media = yield* DesktopVlcMedia.DesktopVlcMedia;
    return yield* media.navigate(event.sender ?? {}, input);
  }),
});
