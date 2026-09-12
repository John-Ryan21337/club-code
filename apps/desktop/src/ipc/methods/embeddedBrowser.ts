import {
  EmbeddedBrowserActionResultSchema,
  EmbeddedBrowserClickInputSchema,
  EmbeddedBrowserHistoryActionInputSchema,
  EmbeddedBrowserNavigateInputSchema,
  EmbeddedBrowserOpenInputSchema,
  EmbeddedBrowserSetBoundsInputSchema,
  EmbeddedBrowserShareInputSchema,
  EmbeddedBrowserSnapshotInputSchema,
  EmbeddedBrowserSnapshotSchema,
  EmbeddedBrowserStateSchema,
  EmbeddedBrowserTabInputSchema,
  EmbeddedBrowserTypeInputSchema,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopEmbeddedBrowser from "../../browser/DesktopEmbeddedBrowser.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const owner = (event: { readonly sender?: object }) => event.sender ?? {};

export const openEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_OPEN_CHANNEL,
  payload: EmbeddedBrowserOpenInputSchema,
  result: EmbeddedBrowserStateSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.open")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.open(owner(event), input));
  }),
});

export const closeEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_CLOSE_CHANNEL,
  payload: EmbeddedBrowserTabInputSchema,
  result: EmbeddedBrowserStateSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.close")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.close(owner(event), input));
  }),
});

export const setEmbeddedBrowserBounds = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_SET_BOUNDS_CHANNEL,
  payload: EmbeddedBrowserSetBoundsInputSchema,
  result: EmbeddedBrowserStateSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.setBounds")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.setBounds(owner(event), input));
  }),
});

export const shareEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_SHARE_CHANNEL,
  payload: EmbeddedBrowserShareInputSchema,
  result: EmbeddedBrowserActionResultSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.share")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.share(owner(event), input));
  }),
});

export const navigateEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_NAVIGATE_CHANNEL,
  payload: EmbeddedBrowserNavigateInputSchema,
  result: EmbeddedBrowserActionResultSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.navigate")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.navigate(owner(event), input));
  }),
});

export const controlEmbeddedBrowserHistory = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_HISTORY_CHANNEL,
  payload: EmbeddedBrowserHistoryActionInputSchema,
  result: EmbeddedBrowserActionResultSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.history")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.history(owner(event), input));
  }),
});

export const snapshotEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_SNAPSHOT_CHANNEL,
  payload: EmbeddedBrowserSnapshotInputSchema,
  result: Schema.NullOr(EmbeddedBrowserSnapshotSchema),
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.snapshot")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.snapshot(owner(event), input));
  }),
});

export const clickEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_CLICK_CHANNEL,
  payload: EmbeddedBrowserClickInputSchema,
  result: EmbeddedBrowserActionResultSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.click")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.click(owner(event), input));
  }),
});

export const typeInEmbeddedBrowser = makeIpcMethod({
  channel: IpcChannels.EMBEDDED_BROWSER_TYPE_CHANNEL,
  payload: EmbeddedBrowserTypeInputSchema,
  result: EmbeddedBrowserActionResultSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.embeddedBrowser.type")(function* (input, event) {
    const browser = yield* DesktopEmbeddedBrowser.DesktopEmbeddedBrowser;
    return yield* Effect.promise(() => browser.type(owner(event), input));
  }),
});
