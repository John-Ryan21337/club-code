import * as Schema from "effect/Schema";
import { ThreadId, NonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const Key = NonEmptyString.check(Schema.isMaxLength(256));
export const CodexThreadAttachmentAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("list"),
    cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
  }),
  Schema.Struct({
    kind: Schema.Literal("add"),
    attachmentType: Key,
    identityKey: Key,
    payloadJson: Schema.String.check(Schema.isMaxLength(16_384)),
  }),
  Schema.Struct({ kind: Schema.Literal("remove"), attachmentType: Key, identityKey: Key }),
]);
export const CodexThreadAttachmentsInput = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  action: CodexThreadAttachmentAction,
});
export type CodexThreadAttachmentsInput = typeof CodexThreadAttachmentsInput.Type;
export const CodexThreadAttachment = Schema.Struct({
  id: Key,
  attachmentType: Key,
  identityKey: Key,
  // A bounded, display-only JSON representation. Never evaluate or render as HTML.
  payloadJson: Schema.String.check(Schema.isMaxLength(16_384)),
  createdAt: Schema.Number,
});
export const CodexThreadAttachmentsResult = Schema.Struct({
  data: Schema.Array(CodexThreadAttachment).check(Schema.isMaxLength(20)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
});
export type CodexThreadAttachmentsResult = typeof CodexThreadAttachmentsResult.Type;
export class CodexThreadAttachmentsError extends Schema.TaggedErrorClass<CodexThreadAttachmentsError>()(
  "CodexThreadAttachmentsError",
  { detail: Schema.String },
) {}
