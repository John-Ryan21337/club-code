import * as Schema from "effect/Schema";
import { NonEmptyString, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const VoiceSessionKey = NonEmptyString.check(Schema.isMaxLength(128));
export const CodexExperimentalAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("memoryStatus") }),
  Schema.Struct({ kind: Schema.Literal("verificationStatus") }),
  Schema.Struct({
    kind: Schema.Literal("voiceStart"),
    sessionKey: VoiceSessionKey,
    offerSdp: NonEmptyString.check(Schema.isMaxLength(65_536)),
  }),
  Schema.Struct({ kind: Schema.Literal("voiceRenew"), sessionKey: VoiceSessionKey }),
  Schema.Struct({ kind: Schema.Literal("voiceStop"), sessionKey: VoiceSessionKey }),
]);
export const CodexExperimentalInput = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  action: CodexExperimentalAction,
});
export type CodexExperimentalInput = typeof CodexExperimentalInput.Type;
export const CodexExperimentalResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("memoryStatus"),
    consolidatedThreads: Schema.Int,
    ready: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("verificationStatus"),
    available: Schema.Boolean,
    reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  }),
  Schema.Struct({
    kind: Schema.Literal("voiceStart"),
    answerSdp: NonEmptyString.check(Schema.isMaxLength(65_536)),
  }),
  Schema.Struct({ kind: Schema.Literal("voiceRenew") }),
  Schema.Struct({ kind: Schema.Literal("voiceStop") }),
]);
export type CodexExperimentalResult = typeof CodexExperimentalResult.Type;
export class CodexExperimentalError extends Schema.TaggedErrorClass<CodexExperimentalError>()(
  "CodexExperimentalError",
  { detail: Schema.String },
) {}
