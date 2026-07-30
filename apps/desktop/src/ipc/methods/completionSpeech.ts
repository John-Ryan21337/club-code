import {
  DesktopCompletionSpeechCapabilitySchema,
  DesktopCompletionSpeechSynthesizeInputSchema,
  DesktopCompletionSpeechSynthesizeResultSchema,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  getWindowsCompletionSpeechCapability,
  synthesizeWindowsCompletionSpeech,
} from "../../speech/WindowsCompletionSpeech.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getCompletionSpeechCapability = makeIpcMethod({
  channel: IpcChannels.GET_COMPLETION_SPEECH_CAPABILITY_CHANNEL,
  payload: Schema.Void,
  result: DesktopCompletionSpeechCapabilitySchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.completionSpeech.getCapability")(() =>
    Effect.promise(() => getWindowsCompletionSpeechCapability()),
  ),
});

export const synthesizeCompletionSpeech = makeIpcMethod({
  channel: IpcChannels.SYNTHESIZE_COMPLETION_SPEECH_CHANNEL,
  payload: DesktopCompletionSpeechSynthesizeInputSchema,
  result: DesktopCompletionSpeechSynthesizeResultSchema,
  strict: true,
  handler: Effect.fn("desktop.ipc.completionSpeech.synthesize")((input) =>
    Effect.promise(() => synthesizeWindowsCompletionSpeech(input)),
  ),
});
