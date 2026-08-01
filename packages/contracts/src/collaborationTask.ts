import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationAgentId,
  CollaborationDeviceKeyId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

export const COLLABORATION_TASK_DEPENDENCY_LIMIT = 32;
export const COLLABORATION_TASK_PAGE_LIMIT = 256;
export const COLLABORATION_ACTIVE_AGENT_LEASE_LIMIT = 8;
export const COLLABORATION_AGENT_LEASE_MAX_MILLIS = 15 * 60_000;
export const COLLABORATION_TASK_TITLE_MAX_UTF8_BYTES = 512;
export const COLLABORATION_TASK_BODY_MAX_UTF8_BYTES = 32_768;

const Identifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
const hasForbiddenControl = (value: string) =>
  Array.from(value).some((character) => {
    const point = character.codePointAt(0)!;
    return (
      (point >= 0 && point <= 8) ||
      point === 11 ||
      point === 12 ||
      (point >= 14 && point <= 31) ||
      point === 127
    );
  });
const safeOperatorText = (limit: number) =>
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.makeFilter((value) =>
      value === value.normalize("NFC") ? undefined : "task text must be NFC normalized",
    ),
    Schema.makeFilter((value) =>
      hasForbiddenControl(value) ? "task text must not contain control characters" : undefined,
    ),
    Schema.makeFilter((value) =>
      utf8(value) <= limit ? undefined : `task text exceeds ${limit} UTF-8 bytes`,
    ),
    Schema.makeFilter((value) =>
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}|\bgh[opsu]_[A-Za-z0-9]{20,}/u.test(
        value,
      )
        ? "task text must not contain credential material"
        : undefined,
    ),
    Schema.makeFilter((value) =>
      /(?:^|[\s'"`])(?:[A-Za-z]:\\Users\\[^\s'"`]+|\/Users\/[^\s/'"`]+|\/home\/[^\s/'"`]+)/u.test(
        value,
      )
        ? "task text must not contain raw private home paths"
        : undefined,
    ),
  );

export const CollaborationTaskId = Identifier.pipe(Schema.brand("CollaborationTaskId"));
export type CollaborationTaskId = typeof CollaborationTaskId.Type;
export const CollaborationTaskCommandId = Identifier.pipe(
  Schema.brand("CollaborationTaskCommandId"),
);
export type CollaborationTaskCommandId = typeof CollaborationTaskCommandId.Type;
export const CollaborationTaskLeaseId = Identifier.pipe(Schema.brand("CollaborationTaskLeaseId"));
export type CollaborationTaskLeaseId = typeof CollaborationTaskLeaseId.Type;
export const CollaborationTaskRevision = PositiveInt.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type CollaborationTaskRevision = typeof CollaborationTaskRevision.Type;
export const CollaborationTaskFencingToken = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type CollaborationTaskFencingToken = typeof CollaborationTaskFencingToken.Type;

export const CollaborationTaskStatus = Schema.Literals([
  "open",
  "claimed",
  "completed",
  "cancelled",
]);
export type CollaborationTaskStatus = typeof CollaborationTaskStatus.Type;
export const CollaborationTaskTitle = safeOperatorText(COLLABORATION_TASK_TITLE_MAX_UTF8_BYTES);
export const CollaborationTaskBody = safeOperatorText(COLLABORATION_TASK_BODY_MAX_UTF8_BYTES);
export const CollaborationTaskDependencies = Schema.Array(CollaborationTaskId).check(
  Schema.isMaxLength(COLLABORATION_TASK_DEPENDENCY_LIMIT),
  Schema.makeFilter((ids) =>
    new Set(ids).size === ids.length ? undefined : "task dependencies must be unique",
  ),
);

export const CollaborationTaskAgentLease = Schema.Struct({
  leaseId: CollaborationTaskLeaseId,
  agentId: CollaborationAgentId,
  holderUserId: UserId,
  holderDeviceId: Identifier,
  membershipEpoch: NonNegativeInt,
  fencingToken: CollaborationTaskFencingToken,
  grantedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}).check(
  Schema.makeFilter((lease) => {
    const grantedAt =
      typeof lease.grantedAt === "string"
        ? Date.parse(lease.grantedAt)
        : DateTime.toEpochMillis(lease.grantedAt);
    const expiresAt =
      typeof lease.expiresAt === "string"
        ? Date.parse(lease.expiresAt)
        : DateTime.toEpochMillis(lease.expiresAt);
    return expiresAt > grantedAt ? undefined : "agent lease must expire after it is granted";
  }),
);
export type CollaborationTaskAgentLease = typeof CollaborationTaskAgentLease.Type;

export const CollaborationSharedTask = Schema.Struct({
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  provenance: Schema.Literal("operator-authored"),
  title: CollaborationTaskTitle,
  body: CollaborationTaskBody,
  status: CollaborationTaskStatus,
  ownerUserId: Schema.NullOr(UserId),
  dependencies: CollaborationTaskDependencies,
  revision: CollaborationTaskRevision,
  fencingToken: CollaborationTaskFencingToken,
  activeAgentLease: Schema.NullOr(CollaborationTaskAgentLease),
  createdByUserId: UserId,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type CollaborationSharedTask = typeof CollaborationSharedTask.Type;

const CommonCommand = {
  sharedProjectId: SharedProjectId,
  commandId: CollaborationTaskCommandId,
  deviceKeyId: CollaborationDeviceKeyId,
} as const;

export const CollaborationCreateTaskCommand = Schema.Struct({
  ...CommonCommand,
  kind: Schema.Literal("create"),
  taskId: CollaborationTaskId,
  provenance: Schema.Literal("operator-authored"),
  title: CollaborationTaskTitle,
  body: CollaborationTaskBody,
  dependencies: CollaborationTaskDependencies,
}).check(
  Schema.makeFilter((command) =>
    command.dependencies.includes(command.taskId) ? "a task cannot depend on itself" : undefined,
  ),
);

const ExistingTaskCommand = {
  ...CommonCommand,
  taskId: CollaborationTaskId,
  expectedRevision: CollaborationTaskRevision,
} as const;

export const CollaborationTaskMutationCommand = Schema.Union([
  Schema.Struct({ ...ExistingTaskCommand, kind: Schema.Literal("claim") }),
  Schema.Struct({
    ...ExistingTaskCommand,
    kind: Schema.Literal("reassign"),
    ownerUserId: UserId,
  }),
  Schema.Struct({ ...ExistingTaskCommand, kind: Schema.Literal("complete") }),
  Schema.Struct({ ...ExistingTaskCommand, kind: Schema.Literal("cancel") }),
  Schema.Struct({ ...ExistingTaskCommand, kind: Schema.Literal("reopen") }),
  Schema.Struct({
    ...ExistingTaskCommand,
    kind: Schema.Literal("set-dependencies"),
    dependencies: CollaborationTaskDependencies,
  }).check(
    Schema.makeFilter((command) =>
      command.dependencies.includes(command.taskId) ? "a task cannot depend on itself" : undefined,
    ),
  ),
  Schema.Struct({
    ...ExistingTaskCommand,
    kind: Schema.Literal("agent.acquire"),
    leaseId: CollaborationTaskLeaseId,
    agentId: CollaborationAgentId,
    leaseMillis: PositiveInt.check(
      Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_LEASE_MAX_MILLIS),
    ),
  }),
  Schema.Struct({
    ...ExistingTaskCommand,
    kind: Schema.Literal("agent.renew"),
    leaseId: CollaborationTaskLeaseId,
    leaseMillis: PositiveInt.check(
      Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_LEASE_MAX_MILLIS),
    ),
  }),
  Schema.Struct({
    ...ExistingTaskCommand,
    kind: Schema.Literal("agent.release"),
    leaseId: CollaborationTaskLeaseId,
  }),
]);
export type CollaborationTaskMutationCommand = typeof CollaborationTaskMutationCommand.Type;
export type CollaborationCreateTaskCommand = typeof CollaborationCreateTaskCommand.Type;

export const CollaborationTaskAuditEvent = Schema.Struct({
  sharedProjectId: SharedProjectId,
  sequence: CollaborationTaskRevision,
  commandId: CollaborationTaskCommandId,
  operation: Schema.Literals([
    "create",
    "claim",
    "reassign",
    "complete",
    "cancel",
    "reopen",
    "set-dependencies",
    "agent.acquire",
    "agent.renew",
    "agent.release",
  ]),
  task: CollaborationSharedTask,
  actorUserId: UserId,
  actorDeviceId: Identifier,
  membershipEpoch: NonNegativeInt,
  previousEventSha256: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  eventSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  createdAt: Schema.DateTimeUtcFromString,
});
export type CollaborationTaskAuditEvent = typeof CollaborationTaskAuditEvent.Type;

export const CollaborationTaskReadRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  deviceKeyId: CollaborationDeviceKeyId,
});
export type CollaborationTaskReadRequest = typeof CollaborationTaskReadRequest.Type;

export const CollaborationTaskHistoryRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  deviceKeyId: CollaborationDeviceKeyId,
  afterSequence: NonNegativeInt,
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_TASK_PAGE_LIMIT)),
});
export type CollaborationTaskHistoryRequest = typeof CollaborationTaskHistoryRequest.Type;
