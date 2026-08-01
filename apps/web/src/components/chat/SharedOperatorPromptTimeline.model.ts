import {
  COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS,
  COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES,
  COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_UTF8_BYTES,
  COLLABORATION_EVENT_SEQUENCE_MAX,
  COLLABORATION_MEMBERSHIP_EPOCH_MAX,
  COLLABORATION_PROJECT_MEMBER_LIMIT,
  collaborationRoleAllowsPermission,
  type CollaborationAuthoredMessagePageRequest,
  type CollaborationPermission,
  type CollaborationProjectMember,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";

export const SHARED_OPERATOR_PROMPT_PAGE_LIMIT = 50;
export const SHARED_OPERATOR_PROMPT_MAX_PAGES = 8;
export const SHARED_OPERATOR_PROMPT_MAX_RECORDS =
  SHARED_OPERATOR_PROMPT_PAGE_LIMIT * SHARED_OPERATOR_PROMPT_MAX_PAGES;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MESSAGE_KEYS = [
  "sharedProjectId",
  "projectSequence",
  "operatorSequence",
  "messageId",
  "kind",
  "body",
  "contextInclusion",
  "authorUserId",
  "authorDeviceId",
  "membershipEpoch",
  "previousMessageSha256",
  "messageSha256",
  "occurredAt",
  "receivedAt",
  "tombstone",
] as const;
const TOMBSTONE_KEYS = [
  "commandId",
  "targetMessageId",
  "actorUserId",
  "actorDeviceId",
  "membershipEpoch",
  "reason",
  "createdAt",
  "recoverable",
] as const;

export type SharedOperatorPromptConnectionState = "online" | "offline" | "reconnecting";

export interface SharedOperatorPromptTimelineClient {
  readonly readAuthoredMessages: (
    request: CollaborationAuthoredMessagePageRequest & { readonly signal: AbortSignal },
  ) => Promise<unknown>;
}

export interface SharedOperatorPromptEntry {
  readonly messageId: string;
  readonly authorUserId: string;
  readonly projectSequence: number;
  readonly operatorSequence: number;
  readonly body: string | null;
  readonly occurredAtIso: string;
  readonly messageSha256: string;
}

export interface SharedOperatorPromptPage {
  readonly sharedProjectId: string;
  readonly entries: readonly SharedOperatorPromptEntry[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
}

export interface SharedOperatorPromptTimelineState {
  readonly sharedProjectId: string | null;
  readonly entries: readonly SharedOperatorPromptEntry[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly pageCount: number;
  readonly consumedCursors: readonly number[];
  readonly truncated: boolean;
}

export interface SharedOperatorPromptAuthor {
  readonly userId: string;
  readonly displayName: string;
  readonly canReadTranscript: boolean;
  readonly membershipFingerprint: string;
}

export const EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE: SharedOperatorPromptTimelineState =
  Object.freeze({
    sharedProjectId: null,
    entries: Object.freeze([]),
    nextCursor: 0,
    hasMore: true,
    pageCount: 0,
    consumedCursors: Object.freeze([]),
    truncated: false,
  });

export class SharedOperatorPromptPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedOperatorPromptPayloadError";
  }
}

function fail(message: string): never {
  throw new SharedOperatorPromptPayloadError(message);
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

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

export function isSharedOperatorPromptIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label} is invalid`);
  return value as number;
}

function boundedNonNegativeInteger(value: unknown, maximum: number, label: string): number {
  const decoded = nonNegativeSafeInteger(value, label);
  if (decoded > maximum) fail(`${label} exceeds its bound`);
  return decoded;
}

function positiveSafeInteger(value: unknown, label: string): number {
  const decoded = nonNegativeSafeInteger(value, label);
  if (decoded === 0) fail(`${label} is invalid`);
  return decoded;
}

function boundedPositiveInteger(value: unknown, maximum: number, label: string): number {
  const decoded = positiveSafeInteger(value, label);
  if (decoded > maximum) fail(`${label} exceeds its bound`);
  return decoded;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${label} is invalid`);
  return value;
}

function optionalSha256(value: unknown, label: string): string | null {
  return value === null ? null : sha256(value, label);
}

function canonicalUtc(value: unknown, label: string): string {
  let iso: string;
  if (typeof value === "string") {
    iso = value;
  } else if (DateTime.isDateTime(value)) {
    iso = new Date(DateTime.toEpochMillis(value)).toISOString();
  } else {
    fail(`${label} is invalid`);
  }
  if (
    !CANONICAL_UTC_PATTERN.test(iso) ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(Date.parse(iso)).toISOString() !== iso
  ) {
    fail(`${label} is invalid`);
  }
  return iso;
}

function authoredBody(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS ||
    value.trim().length === 0 ||
    /[\uD800-\uDFFF]/u.test(value) ||
    new TextEncoder().encode(value).byteLength > COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES
  ) {
    fail("prompt body is invalid");
  }
  return value;
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

function tombstone(value: unknown, expectedMessageId: string): boolean {
  if (value === null) return false;
  const candidate = exactRecord(value, TOMBSTONE_KEYS, "prompt tombstone");
  identifier(candidate.commandId, "prompt tombstone commandId");
  if (
    identifier(candidate.targetMessageId, "prompt tombstone targetMessageId") !== expectedMessageId
  ) {
    fail("prompt tombstone targets another message");
  }
  identifier(candidate.actorUserId, "prompt tombstone actorUserId");
  identifier(candidate.actorDeviceId, "prompt tombstone actorDeviceId");
  boundedNonNegativeInteger(
    candidate.membershipEpoch,
    COLLABORATION_MEMBERSHIP_EPOCH_MAX,
    "prompt tombstone membershipEpoch",
  );
  if (
    typeof candidate.reason !== "string" ||
    candidate.reason.length === 0 ||
    candidate.reason.length > 512
  ) {
    fail("prompt tombstone reason is invalid");
  }
  canonicalUtc(candidate.createdAt, "prompt tombstone createdAt");
  if (candidate.recoverable !== true) fail("prompt tombstone is not recoverable");
  return true;
}

function promptEntry(value: unknown, expectedProjectId: string): SharedOperatorPromptEntry {
  const candidate = exactRecord(value, MESSAGE_KEYS, "authored prompt");
  if (
    identifier(candidate.sharedProjectId, "authored prompt sharedProjectId") !== expectedProjectId
  ) {
    fail("authored prompt belongs to another project");
  }
  if (candidate.kind !== "authored-prompt") fail("page contains a non-prompt message");
  if (
    candidate.contextInclusion !== "eligible" &&
    candidate.contextInclusion !== "excluded-sensitive"
  ) {
    fail("authored prompt context inclusion is invalid");
  }
  const messageId = identifier(candidate.messageId, "authored prompt messageId");
  const body = authoredBody(candidate.body);
  identifier(candidate.authorDeviceId, "authored prompt authorDeviceId");
  boundedNonNegativeInteger(
    candidate.membershipEpoch,
    COLLABORATION_MEMBERSHIP_EPOCH_MAX,
    "authored prompt membershipEpoch",
  );
  optionalSha256(candidate.previousMessageSha256, "authored prompt previousMessageSha256");
  const messageSha256 = sha256(candidate.messageSha256, "authored prompt messageSha256");
  const occurredAtIso = canonicalUtc(candidate.occurredAt, "authored prompt occurredAt");
  canonicalUtc(candidate.receivedAt, "authored prompt receivedAt");
  const removed = tombstone(candidate.tombstone, messageId);
  return Object.freeze({
    messageId,
    authorUserId: identifier(candidate.authorUserId, "authored prompt authorUserId"),
    projectSequence: boundedPositiveInteger(
      candidate.projectSequence,
      COLLABORATION_EVENT_SEQUENCE_MAX,
      "authored prompt projectSequence",
    ),
    operatorSequence: boundedPositiveInteger(
      candidate.operatorSequence,
      COLLABORATION_EVENT_SEQUENCE_MAX,
      "authored prompt operatorSequence",
    ),
    body: removed ? null : body,
    occurredAtIso,
    messageSha256,
  });
}

export function decodeSharedOperatorPromptPage(
  value: unknown,
  expectedProjectId: string,
  requestedAfterSequence: number,
): SharedOperatorPromptPage {
  identifier(expectedProjectId, "expected shared project id");
  boundedNonNegativeInteger(
    requestedAfterSequence,
    COLLABORATION_EVENT_SEQUENCE_MAX,
    "requested cursor",
  );
  const candidate = exactRecord(
    value,
    ["sharedProjectId", "messages", "mergedOrder", "lanePositions", "nextCursor", "hasMore"],
    "authored prompt page",
  );
  const sharedProjectId = identifier(candidate.sharedProjectId, "page sharedProjectId");
  if (sharedProjectId !== expectedProjectId) fail("prompt page belongs to another project");
  const rawMessages = denseArray(candidate.messages, SHARED_OPERATOR_PROMPT_PAGE_LIMIT, "messages");
  const entries = rawMessages.map((entry) => promptEntry(entry, expectedProjectId));
  const rawOrder = denseArray(
    candidate.mergedOrder,
    SHARED_OPERATOR_PROMPT_PAGE_LIMIT,
    "mergedOrder",
  );
  const rawLanePositions = denseArray(
    candidate.lanePositions,
    SHARED_OPERATOR_PROMPT_PAGE_LIMIT,
    "lanePositions",
  );
  if (rawOrder.length !== entries.length || rawLanePositions.length !== entries.length) {
    fail("prompt page indexes do not match its messages");
  }
  const messageIds = new Set<string>();
  const projectSequences = new Set<number>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (messageIds.has(entry.messageId) || projectSequences.has(entry.projectSequence)) {
      fail("prompt page repeats an immutable identity");
    }
    messageIds.add(entry.messageId);
    projectSequences.add(entry.projectSequence);
    if (entry.projectSequence <= requestedAfterSequence)
      fail("prompt page replays an old sequence");
    if (index > 0 && entries[index - 1]!.projectSequence >= entry.projectSequence) {
      fail("prompt page is not in canonical project order");
    }
    if (identifier(rawOrder[index], `mergedOrder[${index}]`) !== entry.messageId) {
      fail("prompt page merged order is inconsistent");
    }
    const lane = exactRecord(
      rawLanePositions[index],
      ["messageId", "userId", "projectSequence", "operatorSequence"],
      `lanePositions[${index}]`,
    );
    if (
      identifier(lane.messageId, `lanePositions[${index}].messageId`) !== entry.messageId ||
      identifier(lane.userId, `lanePositions[${index}].userId`) !== entry.authorUserId ||
      boundedPositiveInteger(
        lane.projectSequence,
        COLLABORATION_EVENT_SEQUENCE_MAX,
        `lanePositions[${index}].projectSequence`,
      ) !== entry.projectSequence ||
      boundedPositiveInteger(
        lane.operatorSequence,
        COLLABORATION_EVENT_SEQUENCE_MAX,
        `lanePositions[${index}].operatorSequence`,
      ) !== entry.operatorSequence
    ) {
      fail("prompt page lane position is inconsistent");
    }
  }
  const nextCursor = boundedNonNegativeInteger(
    candidate.nextCursor,
    COLLABORATION_EVENT_SEQUENCE_MAX,
    "page nextCursor",
  );
  const expectedNextCursor = entries.at(-1)?.projectSequence ?? requestedAfterSequence;
  if (nextCursor !== expectedNextCursor) fail("prompt page cursor is inconsistent");
  if (typeof candidate.hasMore !== "boolean") fail("prompt page hasMore is invalid");
  if (entries.length === 0 && candidate.hasMore) fail("empty prompt page cannot continue");
  const retainedUtf8Bytes = entries.reduce(
    (total, entry) =>
      total +
      new TextEncoder().encode(
        `${entry.messageId}\u0000${entry.authorUserId}\u0000${entry.occurredAtIso}\u0000${entry.messageSha256}\u0000${entry.body ?? ""}`,
      ).byteLength,
    0,
  );
  if (retainedUtf8Bytes > COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_UTF8_BYTES) {
    fail("prompt page exceeds its retained UTF-8 byte bound");
  }
  return Object.freeze({
    sharedProjectId,
    entries: Object.freeze(entries),
    nextCursor,
    hasMore: candidate.hasMore,
  });
}

export function appendSharedOperatorPromptPage(
  current: SharedOperatorPromptTimelineState,
  page: SharedOperatorPromptPage,
  requestedAfterSequence: number,
): SharedOperatorPromptTimelineState {
  if (!current.hasMore || current.truncated) fail("prompt timeline is already complete");
  if (current.sharedProjectId !== null && current.sharedProjectId !== page.sharedProjectId) {
    fail("prompt project changed across pages");
  }
  if (current.nextCursor !== requestedAfterSequence) fail("prompt response cursor changed");
  if (current.consumedCursors.includes(requestedAfterSequence)) {
    fail("prompt response cursor was already consumed");
  }
  if (page.nextCursor < requestedAfterSequence) fail("prompt response cursor regressed");
  if (page.entries.length > 0 && page.nextCursor === requestedAfterSequence) {
    fail("prompt response cursor did not advance");
  }
  const existingIds = new Map(current.entries.map((entry) => [entry.messageId, entry]));
  const existingSequences = new Set(current.entries.map((entry) => entry.projectSequence));
  const operatorSequences = new Map<string, number>();
  for (const entry of current.entries) {
    operatorSequences.set(
      entry.authorUserId,
      Math.max(operatorSequences.get(entry.authorUserId) ?? 0, entry.operatorSequence),
    );
  }
  for (const entry of page.entries) {
    const existing = existingIds.get(entry.messageId);
    if (existing !== undefined) {
      if (
        existing.projectSequence !== entry.projectSequence ||
        existing.messageSha256 !== entry.messageSha256
      ) {
        fail("prompt message identity changed across pages");
      }
      fail("prompt page replays an existing message");
    }
    if (existingSequences.has(entry.projectSequence))
      fail("prompt page replays a project sequence");
    const lastOperatorSequence = operatorSequences.get(entry.authorUserId) ?? 0;
    if (entry.operatorSequence <= lastOperatorSequence) {
      fail("prompt operator sequence did not advance");
    }
    operatorSequences.set(entry.authorUserId, entry.operatorSequence);
  }
  const entries = [...current.entries, ...page.entries];
  if (entries.length > SHARED_OPERATOR_PROMPT_MAX_RECORDS)
    fail("prompt timeline exceeds its bound");
  const pageCount = current.pageCount + 1;
  const truncated = page.hasMore && pageCount >= SHARED_OPERATOR_PROMPT_MAX_PAGES;
  return Object.freeze({
    sharedProjectId: page.sharedProjectId,
    entries: Object.freeze(entries),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore && !truncated,
    pageCount,
    consumedCursors: Object.freeze([...current.consumedCursors, requestedAfterSequence]),
    truncated,
  });
}

const COLLABORATION_PERMISSIONS = new Set([
  "project.manage-members",
  "project.manage-settings",
  "transcript.read",
  "transcript.append",
  "chat.read",
  "chat.append",
  "task.read",
  "task.manage",
  "agent.dispatch",
  "approval.review",
  "file.read",
  "file.publish",
  "file.apply",
  "file.tombstone",
  "audit.read",
]);

export function snapshotSharedOperatorPromptAuthors(
  value: readonly CollaborationProjectMember[] | unknown,
): readonly SharedOperatorPromptAuthor[] {
  const members = denseArray(value, COLLABORATION_PROJECT_MEMBER_LIMIT, "project members");
  const seen = new Set<string>();
  const authors = members.map((member, index) => {
    const candidate = exactRecord(
      member,
      ["userId", "displayName", "role", "permissions", "joinedAt"],
      `project members[${index}]`,
    );
    const userId = identifier(candidate.userId, `project members[${index}].userId`);
    if (seen.has(userId)) fail("project members contain a duplicate user");
    seen.add(userId);
    if (
      typeof candidate.displayName !== "string" ||
      candidate.displayName.length === 0 ||
      candidate.displayName.length > 128 ||
      candidate.displayName.trim() !== candidate.displayName ||
      hasUnsafeAttributionControl(candidate.displayName)
    ) {
      fail(`project members[${index}].displayName is invalid`);
    }
    const role = candidate.role;
    if (
      role !== "owner" &&
      role !== "admin" &&
      role !== "operator" &&
      role !== "contributor" &&
      role !== "viewer"
    ) {
      fail(`project members[${index}].role is invalid`);
    }
    const permissions = denseArray(
      candidate.permissions,
      15,
      `project members[${index}].permissions`,
    );
    const permissionNames = permissions.map((permission) => {
      if (typeof permission !== "string" || !COLLABORATION_PERMISSIONS.has(permission)) {
        fail(`project members[${index}].permissions is invalid`);
      }
      const permissionName = permission as CollaborationPermission;
      if (!collaborationRoleAllowsPermission(role, permissionName)) {
        fail(`project members[${index}].permissions exceeds its role`);
      }
      return permissionName;
    });
    if (new Set(permissionNames).size !== permissionNames.length) {
      fail(`project members[${index}].permissions contains duplicates`);
    }
    const joinedAtIso = canonicalUtc(candidate.joinedAt, `project members[${index}].joinedAt`);
    return Object.freeze({
      userId,
      displayName: candidate.displayName,
      canReadTranscript: permissionNames.includes("transcript.read"),
      membershipFingerprint: JSON.stringify([role, permissionNames, joinedAtIso]),
    });
  });
  return Object.freeze(authors);
}
