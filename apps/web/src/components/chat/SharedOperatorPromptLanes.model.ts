import {
  COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS,
  COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES,
  COLLABORATION_PROJECT_MEMBER_LIMIT,
} from "@cafecode/contracts";

import {
  isSharedOperatorPromptIdentifier,
  SHARED_OPERATOR_PROMPT_MAX_RECORDS,
  type SharedOperatorPromptAuthor,
  type SharedOperatorPromptEntry,
} from "./SharedOperatorPromptTimeline.model.ts";

export const SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT = 20;

const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface SharedOperatorPromptLane {
  readonly userId: string;
  readonly displayName: string;
  readonly entries: readonly SharedOperatorPromptEntry[];
}

export interface SharedOperatorPromptLaneWindow {
  readonly lanes: readonly SharedOperatorPromptLane[];
  readonly totalLaneCount: number;
  readonly windowStart: number;
  readonly hiddenFormerOperatorPromptCount: number;
}

export class SharedOperatorPromptLanePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedOperatorPromptLanePayloadError";
  }
}

function fail(message: string): never {
  throw new SharedOperatorPromptLanePayloadError(message);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} could not be inspected safely`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail(`${label} has an unsupported shape`);
  }
  const actualKeys = (ownKeys as string[]).toSorted(compareCodeUnits);
  const canonicalKeys = [...expectedKeys].toSorted(compareCodeUnits);
  if (
    actualKeys.length !== canonicalKeys.length ||
    actualKeys.some((key, index) => key !== canonicalKeys[index])
  ) {
    fail(`${label} has an unsupported shape`);
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(`${label}.${key} must be a data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function denseArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be a plain array`);
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} could not be inspected safely`);
  }
  if (prototype !== Array.prototype) fail(`${label} must be a plain array`);
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    fail(`${label} exceeds its bound`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) {
    fail(`${label} must be dense and data-only`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(`${label}[${index}] must be a data property`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(`${label} is invalid`);
  return value as number;
}

function hasUnsafeAttributionControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return true;
    }
  }
  return false;
}

function snapshotEntry(value: unknown, index: number): SharedOperatorPromptEntry {
  const label = `prompt entries[${index}]`;
  const candidate = exactRecord(
    value,
    [
      "messageId",
      "authorUserId",
      "projectSequence",
      "operatorSequence",
      "body",
      "occurredAtIso",
      "messageSha256",
    ],
    label,
  );
  if (!isSharedOperatorPromptIdentifier(candidate.messageId)) fail(`${label}.messageId is invalid`);
  if (!isSharedOperatorPromptIdentifier(candidate.authorUserId)) {
    fail(`${label}.authorUserId is invalid`);
  }
  const projectSequence = positiveSafeInteger(
    candidate.projectSequence,
    `${label}.projectSequence`,
  );
  const operatorSequence = positiveSafeInteger(
    candidate.operatorSequence,
    `${label}.operatorSequence`,
  );
  if (
    candidate.body !== null &&
    (typeof candidate.body !== "string" ||
      candidate.body.length === 0 ||
      candidate.body.length > COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS ||
      candidate.body.trim().length === 0 ||
      /[\uD800-\uDFFF]/u.test(candidate.body) ||
      new TextEncoder().encode(candidate.body).byteLength >
        COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES)
  ) {
    fail(`${label}.body is invalid`);
  }
  const occurredAtMillis =
    typeof candidate.occurredAtIso === "string" ? Date.parse(candidate.occurredAtIso) : NaN;
  if (
    typeof candidate.occurredAtIso !== "string" ||
    !CANONICAL_UTC_PATTERN.test(candidate.occurredAtIso) ||
    !Number.isFinite(occurredAtMillis) ||
    new Date(occurredAtMillis).toISOString() !== candidate.occurredAtIso
  ) {
    fail(`${label}.occurredAtIso is invalid`);
  }
  if (
    typeof candidate.messageSha256 !== "string" ||
    !SHA256_PATTERN.test(candidate.messageSha256)
  ) {
    fail(`${label}.messageSha256 is invalid`);
  }
  return Object.freeze({
    messageId: candidate.messageId,
    authorUserId: candidate.authorUserId,
    projectSequence,
    operatorSequence,
    body: candidate.body,
    occurredAtIso: candidate.occurredAtIso,
    messageSha256: candidate.messageSha256,
  });
}

function snapshotAuthor(value: unknown, index: number): SharedOperatorPromptAuthor {
  const label = `prompt authors[${index}]`;
  const candidate = exactRecord(
    value,
    ["userId", "displayName", "canReadTranscript", "membershipFingerprint"],
    label,
  );
  if (!isSharedOperatorPromptIdentifier(candidate.userId)) fail(`${label}.userId is invalid`);
  if (
    typeof candidate.displayName !== "string" ||
    candidate.displayName.length === 0 ||
    candidate.displayName.length > 128 ||
    candidate.displayName.trim() !== candidate.displayName ||
    hasUnsafeAttributionControl(candidate.displayName)
  ) {
    fail(`${label}.displayName is invalid`);
  }
  if (typeof candidate.canReadTranscript !== "boolean") {
    fail(`${label}.canReadTranscript is invalid`);
  }
  if (
    typeof candidate.membershipFingerprint !== "string" ||
    candidate.membershipFingerprint.length === 0 ||
    candidate.membershipFingerprint.length > 1024
  ) {
    fail(`${label}.membershipFingerprint is invalid`);
  }
  return Object.freeze({
    userId: candidate.userId,
    displayName: candidate.displayName,
    canReadTranscript: candidate.canReadTranscript,
    membershipFingerprint: candidate.membershipFingerprint,
  });
}

export function buildSharedOperatorPromptLaneWindow(
  entriesValue: readonly SharedOperatorPromptEntry[] | unknown,
  authorsValue: readonly SharedOperatorPromptAuthor[] | unknown,
  requestedWindowStart: number,
): SharedOperatorPromptLaneWindow {
  if (!Number.isSafeInteger(requestedWindowStart) || requestedWindowStart < 0) {
    fail("prompt lane window start is invalid");
  }
  const rawEntries = denseArray(entriesValue, SHARED_OPERATOR_PROMPT_MAX_RECORDS, "prompt entries");
  const rawAuthors = denseArray(authorsValue, COLLABORATION_PROJECT_MEMBER_LIMIT, "prompt authors");
  const authors = rawAuthors.map(snapshotAuthor);
  const authorIds = new Set<string>();
  for (const author of authors) {
    if (authorIds.has(author.userId)) fail("prompt authors contain a duplicate user");
    authorIds.add(author.userId);
  }
  const entries = rawEntries.map(snapshotEntry);
  const messageIds = new Set<string>();
  const projectSequences = new Set<number>();
  const lastOperatorSequence = new Map<string, number>();
  let lastProjectSequence = 0;
  for (const entry of entries) {
    if (messageIds.has(entry.messageId) || projectSequences.has(entry.projectSequence)) {
      fail("prompt entries repeat an immutable identity");
    }
    if (entry.projectSequence <= lastProjectSequence) {
      fail("prompt entries are not in project order");
    }
    const previousOperatorSequence = lastOperatorSequence.get(entry.authorUserId) ?? 0;
    if (entry.operatorSequence <= previousOperatorSequence) {
      fail("prompt lane operator sequence did not advance");
    }
    messageIds.add(entry.messageId);
    projectSequences.add(entry.projectSequence);
    lastProjectSequence = entry.projectSequence;
    lastOperatorSequence.set(entry.authorUserId, entry.operatorSequence);
  }

  const totalLaneCount = authors.length;
  const maximumWindowStart = Math.max(
    0,
    totalLaneCount - SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT,
  );
  const windowStart = Math.min(requestedWindowStart, maximumWindowStart);
  const visibleAuthors = authors.slice(
    windowStart,
    windowStart + SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT,
  );
  const entriesByAuthor = new Map<string, SharedOperatorPromptEntry[]>();
  let hiddenFormerOperatorPromptCount = 0;
  for (const entry of entries) {
    if (!authorIds.has(entry.authorUserId)) {
      hiddenFormerOperatorPromptCount += 1;
      continue;
    }
    const laneEntries = entriesByAuthor.get(entry.authorUserId) ?? [];
    laneEntries.push(entry);
    entriesByAuthor.set(entry.authorUserId, laneEntries);
  }
  const lanes = visibleAuthors.map((author) =>
    Object.freeze({
      userId: author.userId,
      displayName: author.displayName,
      entries: Object.freeze([...(entriesByAuthor.get(author.userId) ?? [])]),
    }),
  );
  return Object.freeze({
    lanes: Object.freeze(lanes),
    totalLaneCount,
    windowStart,
    hiddenFormerOperatorPromptCount,
  });
}
