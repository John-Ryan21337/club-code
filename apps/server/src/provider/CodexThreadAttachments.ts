import {
  CodexThreadAttachmentsError,
  CodexThreadAttachmentsResult,
  type AuthClientSession,
  type AuthSessionId,
  type CodexThreadAttachmentsInput,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { CodexAppServerClientShape } from "effect-codex-app-server/client";
import { CodexAppServerRequestError } from "effect-codex-app-server/errors";

const decodePayload = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));
const decodeAttachments = Schema.decodeUnknownEffect(CodexThreadAttachmentsResult);

export function requireCodexAttachmentOwner(
  sessions: readonly AuthClientSession[],
  sessionId: AuthSessionId,
  now: number,
): boolean {
  return sessions.some(
    (session) =>
      session.sessionId === sessionId &&
      session.role === "owner" &&
      DateTime.toEpochMillis(session.expiresAt) > now,
  );
}

export function withCodexAttachmentOwner<A, E, E2>(input: {
  readonly sessionId: AuthSessionId;
  readonly listSessions: Effect.Effect<readonly AuthClientSession[], E>;
  readonly operation: Effect.Effect<A, E2>;
  readonly onInvalidated?: Effect.Effect<void>;
}) {
  const check = Effect.gen(function* () {
    if (!requireCodexAttachmentOwner(yield* input.listSessions, input.sessionId, Date.now())) {
      return yield* Effect.fail(
        new CodexThreadAttachmentsError({ detail: "An active owner session is required." }),
      );
    }
  });
  return Effect.gen(function* () {
    yield* check;
    const result = yield* input.operation;
    yield* check.pipe(Effect.onError(() => input.onInvalidated ?? Effect.void));
    return result;
  });
}

export function runCodexThreadAttachments(
  client: Pick<CodexAppServerClientShape, "request">,
  threadId: string,
  action: CodexThreadAttachmentsInput["action"],
) {
  return Effect.gen(function* () {
    if (action.kind === "remove") {
      yield* client.request("thread/attachment/remove", {
        threadId,
        attachmentType: action.attachmentType,
        identityKey: action.identityKey,
      });
      return { data: [], nextCursor: null };
    }
    const response =
      action.kind === "add"
        ? yield* Effect.gen(function* () {
            const payload = yield* decodePayload(action.payloadJson);
            const result = yield* client.request("thread/attachment/add", {
              threadId,
              attachmentType: action.attachmentType,
              identityKey: action.identityKey,
              payload,
            });
            return { data: [result.attachment], nextCursor: null };
          })
        : yield* client.request("thread/attachment/list", {
            threadId,
            limit: 20,
            ...(action.cursor ? { cursor: action.cursor } : {}),
          });
    return yield* decodeAttachments({
      data: response.data.map(({ payload, ...attachment }) => ({
        ...attachment,
        payloadJson: JSON.stringify(payload),
      })),
      nextCursor: response.nextCursor,
    });
  }).pipe(
    // Provider refusals and schema errors can quote record content. Sanitize at
    // the runtime boundary, before daemon ledgers and error diagnostics see it.
    Effect.mapError(
      () =>
        new CodexAppServerRequestError({
          code: -32000,
          errorMessage:
            "Could not read or change Codex attachments. Check the session and record limits.",
        }),
    ),
  );
}
