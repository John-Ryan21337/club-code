import { createHash } from "node:crypto";

import {
  MessageId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ThreadId,
  type TurnId,
} from "@cafecode/contracts";

export const USER_INPUT_RECOVERY_PENDING_KIND = "user-input.recovery-pending";
export const USER_INPUT_RECOVERY_MESSAGE_ID_PREFIX = "user-input-recovery:";

const USER_INPUT_RECOVERY_MESSAGE_PREFIX =
  "I am answering a structured question from the previous provider turn. " +
  "That provider runtime stopped before it could receive the callback, so Cafe Code is " +
  "continuing with the durable answer in this new turn.";
const USER_INPUT_RECOVERY_MESSAGE_SUFFIX =
  "Continue the prior task using this answer. Do not ask me to submit it again unless " +
  "clarification is genuinely needed.";
const USER_INPUT_RECOVERY_QUESTION_LABEL_MAX_CHARS = 512;

interface UserInputRecoveryThreadView {
  readonly activities: ReadonlyArray<
    Pick<OrchestrationThreadActivity, "kind" | "payload" | "turnId">
  >;
  readonly messages: ReadonlyArray<Pick<OrchestrationMessage, "id" | "role" | "text">>;
}

export interface UserInputRequestContext {
  readonly questions: ReadonlyArray<Record<string, unknown>>;
  readonly turnId: TurnId | null;
}

export interface PendingUserInputRecovery {
  readonly requestId: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly recoveryMessageId: MessageId;
  readonly recoveryMessageText: string;
  readonly requestTurnId: TurnId | null;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Produce a fixed-width, non-secret idempotency key without copying a
 * provider-controlled request id into Cafe's message, event, or command ids.
 */
export function userInputRecoveryIdentity(threadId: ThreadId, requestId: string): string {
  return createHash("sha256")
    .update(String(threadId), "utf8")
    .update("\0", "utf8")
    .update(requestId, "utf8")
    .digest("hex");
}

export function userInputRecoveryMessageId(threadId: ThreadId, requestId: string): MessageId {
  return MessageId.make(
    `${USER_INPUT_RECOVERY_MESSAGE_ID_PREFIX}${userInputRecoveryIdentity(threadId, requestId)}`,
  );
}

function formatRecoveredUserInputAnswer(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "[no answer supplied]";
  }
  try {
    return JSON.stringify(value) ?? "[answer could not be represented as text]";
  } catch {
    return "[answer could not be represented as text]";
  }
}

export function findUserInputRequestContext(
  thread: Pick<UserInputRecoveryThreadView, "activities">,
  requestId: string,
): UserInputRequestContext | undefined {
  for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
    const activity = thread.activities[index];
    if (activity?.kind !== "user-input.requested") {
      continue;
    }
    const payload = readRecord(activity.payload);
    if (payload?.requestId !== requestId || !Array.isArray(payload.questions)) {
      continue;
    }
    return {
      questions: payload.questions.flatMap((question) => {
        const record = readRecord(question);
        return record === undefined ? [] : [record];
      }),
      turnId: activity.turnId,
    };
  }
  return undefined;
}

export function hasResolvedUserInputRequest(
  thread: Pick<UserInputRecoveryThreadView, "activities">,
  requestId: string,
): boolean {
  return thread.activities.some((activity) => {
    if (activity.kind !== "user-input.resolved") {
      return false;
    }
    return readRecord(activity.payload)?.requestId === requestId;
  });
}

export function findPendingUserInputRecovery(
  thread: UserInputRecoveryThreadView,
  recoveryMessageId: MessageId,
): PendingUserInputRecovery | undefined {
  for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
    const activity = thread.activities[index];
    if (activity?.kind !== USER_INPUT_RECOVERY_PENDING_KIND) {
      continue;
    }
    const payload = readRecord(activity.payload);
    if (
      payload?.recoveryMessageId !== recoveryMessageId ||
      typeof payload.requestId !== "string" ||
      payload.requestId.length === 0
    ) {
      continue;
    }
    const answers = readRecord(payload.answers);
    const recoveryMessageText =
      typeof payload.recoveryMessageText === "string" ? payload.recoveryMessageText : undefined;
    if (
      answers === undefined ||
      recoveryMessageText === undefined ||
      recoveryMessageText.length === 0 ||
      recoveryMessageText.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS ||
      hasResolvedUserInputRequest(thread, payload.requestId)
    ) {
      return undefined;
    }
    return {
      requestId: payload.requestId,
      answers,
      recoveryMessageId,
      recoveryMessageText,
      requestTurnId: activity.turnId,
    };
  }
  return undefined;
}

/**
 * A deterministic recovery message id is not an acceptance proof by itself.
 * The persisted user message must contain the exact continuation text Cafe
 * recorded with the pending answer.
 */
export function threadCarriesRecoveryContinuationMessage(
  thread: Pick<UserInputRecoveryThreadView, "messages">,
  pendingRecovery: PendingUserInputRecovery,
): boolean {
  const message = thread.messages.find((entry) => entry.id === pendingRecovery.recoveryMessageId);
  return (
    message !== undefined &&
    message.role === "user" &&
    message.text === pendingRecovery.recoveryMessageText
  );
}

function truncateRecoveredUserInputQuestionLabel(value: string): string {
  if (value.length <= USER_INPUT_RECOVERY_QUESTION_LABEL_MAX_CHARS) {
    return value;
  }
  const suffix = "… [question truncated]";
  return `${value.slice(
    0,
    Math.max(0, USER_INPUT_RECOVERY_QUESTION_LABEL_MAX_CHARS - suffix.length),
  )}${suffix}`;
}

function recoveredUserInputQuestionLabel(input: {
  readonly answerKey: string;
  readonly questions: ReadonlyArray<Record<string, unknown>>;
}): string {
  const matchingQuestion = input.questions.find(
    (question) =>
      question.id === input.answerKey ||
      question.question === input.answerKey ||
      question.header === input.answerKey,
  );
  const questionText =
    typeof matchingQuestion?.question === "string" ? matchingQuestion.question.trim() : "";
  const header = typeof matchingQuestion?.header === "string" ? matchingQuestion.header.trim() : "";
  if (questionText.length > 0) {
    return truncateRecoveredUserInputQuestionLabel(questionText);
  }
  if (header.length > 0) {
    return truncateRecoveredUserInputQuestionLabel(header);
  }
  return truncateRecoveredUserInputQuestionLabel(input.answerKey);
}

export function composeStoppedSessionUserInputRecoveryMessage(input: {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly questions: ReadonlyArray<Record<string, unknown>>;
}): string | undefined {
  const answerLines = Object.entries(input.answers).map(([answerKey, answer]) => {
    const label = recoveredUserInputQuestionLabel({
      answerKey,
      questions: input.questions,
    });
    return `- ${label}: ${formatRecoveredUserInputAnswer(answer)}`;
  });
  if (answerLines.length === 0) {
    answerLines.push("- [The user submitted the question without a non-empty answer.]");
  }
  const message = [
    USER_INPUT_RECOVERY_MESSAGE_PREFIX,
    answerLines.join("\n"),
    USER_INPUT_RECOVERY_MESSAGE_SUFFIX,
  ].join("\n\n");
  return message.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS ? message : undefined;
}
