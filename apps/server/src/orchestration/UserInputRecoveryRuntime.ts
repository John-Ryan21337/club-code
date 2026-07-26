import { type MessageId, type ThreadId } from "@cafecode/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProviderAdapterRequestError, type ProviderServiceError } from "../provider/Errors.ts";
import { USER_INPUT_RECOVERY_MESSAGE_ID_PREFIX } from "./UserInputRecovery.ts";

const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const USER_INPUT_CALLBACK_MISSING_ERROR_TAGS = new Set([
  "CodexSessionRuntimePendingUserInputNotFoundError",
]);
const USER_INPUT_SESSION_MISSING_ERROR_TAGS = new Set([
  "ProviderSessionNotFoundError",
  "ProviderAdapterSessionNotFoundError",
  "ProviderAdapterSessionClosedError",
  "ProviderInstanceNotFoundError",
  "ProviderUnsupportedError",
]);

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function findProviderAdapterRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): ProviderAdapterRequestError | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason);
  return isProviderAdapterRequestError(failReason?.error) ? failReason.error : undefined;
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error === undefined) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return (
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

function isUserInputRecoveryMessage(messageId: MessageId): boolean {
  return messageId.startsWith(USER_INPUT_RECOVERY_MESSAGE_ID_PREFIX);
}

/**
 * Classify only provider-owned callback loss. Transport and protocol outages
 * remain ordinary retryable failures and must never start a second turn.
 */
export function classifyUserInputCallbackOwnershipLoss(
  cause: Cause.Cause<ProviderServiceError>,
): "callback-missing" | "session-missing" | undefined {
  if (isUnknownPendingUserInputRequestError(cause)) {
    return "callback-missing";
  }

  for (const reason of cause.reasons) {
    const reasonValue = Cause.isFailReason(reason)
      ? reason.error
      : Cause.isDieReason(reason)
        ? reason.defect
        : undefined;
    const error = readRecord(reasonValue);
    if (error === undefined) {
      continue;
    }
    const nestedCause = readRecord(error.cause);
    const errorTag = typeof error._tag === "string" ? error._tag : undefined;
    const remoteErrorTag =
      typeof error.remoteErrorTag === "string" ? error.remoteErrorTag : undefined;
    const nestedCauseTag = typeof nestedCause?._tag === "string" ? nestedCause._tag : undefined;
    const tags = [errorTag, remoteErrorTag, nestedCauseTag];

    if (tags.some((tag) => tag !== undefined && USER_INPUT_CALLBACK_MISSING_ERROR_TAGS.has(tag))) {
      return "callback-missing";
    }
    if (tags.some((tag) => tag !== undefined && USER_INPUT_SESSION_MISSING_ERROR_TAGS.has(tag))) {
      return "session-missing";
    }
  }

  return undefined;
}

export function makeUserInputRecoveryDeliveryState() {
  const deliveriesInFlight = new Set<MessageId>();
  const acceptedMessages = new Set<MessageId>();

  return {
    hasDeliveryInFlight: (messageId: MessageId): boolean => deliveriesInFlight.has(messageId),
    hasAcceptedMessage: (messageId: MessageId): boolean => acceptedMessages.has(messageId),
    rememberAcceptedMessage: (messageId: MessageId): void => {
      if (isUserInputRecoveryMessage(messageId)) {
        acceptedMessages.add(messageId);
      }
    },
    forgetAcceptedMessage: (messageId: MessageId): void => {
      acceptedMessages.delete(messageId);
    },
    forkTrackedDelivery: <A, E, R>(messageId: MessageId, delivery: Effect.Effect<A, E, R>) => {
      if (!isUserInputRecoveryMessage(messageId)) {
        return delivery.pipe(Effect.forkScoped);
      }
      return Effect.sync(() => {
        deliveriesInFlight.add(messageId);
      }).pipe(
        Effect.andThen(
          delivery.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                deliveriesInFlight.delete(messageId);
              }),
            ),
            Effect.forkScoped,
          ),
        ),
      );
    },
    protectAcceptedBookkeeping: <A, E, R>(
      input: {
        readonly threadId: ThreadId;
        readonly recoveryMessageId: MessageId;
      },
      bookkeeping: Effect.Effect<A, E, R>,
    ) => {
      if (!isUserInputRecoveryMessage(input.recoveryMessageId)) {
        return bookkeeping;
      }
      return bookkeeping.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "provider command reactor could not update session bookkeeping after recovered user input provider acceptance",
            {
              threadId: input.threadId,
              recoveryMessageId: input.recoveryMessageId,
              cause: Cause.pretty(cause),
            },
          ),
        ),
      );
    },
  };
}
