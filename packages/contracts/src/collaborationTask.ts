import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationAgentId,
  CollaborationDeviceKeyId,
  COLLABORATION_MEMBERSHIP_EPOCH_MAX,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

export const COLLABORATION_TASK_DEPENDENCY_LIMIT = 32;
export const COLLABORATION_TASK_PAGE_LIMIT = 256;
export const COLLABORATION_TASK_HISTORY_PAGE_MAX_UTF8_BYTES = 1024 * 1024;
export const COLLABORATION_ACTIVE_AGENT_LEASE_LIMIT = 8;
export const COLLABORATION_TASK_PROJECT_LIMIT = 10_000;
export const COLLABORATION_AGENT_LEASE_MAX_MILLIS = 15 * 60_000;
export const COLLABORATION_TASK_TITLE_MAX_UTF8_BYTES = 512;
export const COLLABORATION_TASK_BODY_MAX_UTF8_BYTES = 32_768;

const hasCredentialMaterial = (value: string) =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}|\bsk-(?:ant|proj)-[A-Za-z0-9_-]{16,}|\bgh[opsu]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{35}\b/u.test(
    value,
  );
const Identifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  Schema.makeFilter((value) =>
    hasCredentialMaterial(value)
      ? "task identifier must not contain credential material"
      : undefined,
  ),
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
const hasUnsafeUnicode = (value: string) =>
  Array.from(value).some((character) => {
    const point = character.codePointAt(0)!;
    return (
      (point >= 0xd800 && point <= 0xdfff) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069) ||
      point === 0xfeff ||
      (point & 0xffff) === 0xfffe ||
      (point & 0xffff) === 0xffff
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
      hasUnsafeUnicode(value) ? "task text must not contain unsafe Unicode controls" : undefined,
    ),
    Schema.makeFilter((value) =>
      value.trim().length > 0 ? undefined : "task text must contain visible content",
    ),
    Schema.makeFilter((value) =>
      utf8(value) <= limit ? undefined : `task text exceeds ${limit} UTF-8 bytes`,
    ),
    Schema.makeFilter((value) =>
      hasCredentialMaterial(value) ? "task text must not contain credential material" : undefined,
    ),
    Schema.makeFilter((value) =>
      /(?:[A-Za-z]:[\\/]Users[\\/][^\s'"`]+|\\\\[^\s\\]+\\[^\s\\]+|\/Users\/[^\s/'"`]+|\/home\/[^\s/'"`]+|\/root\/[^\s'"`]+)/u.test(
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
export const CollaborationTaskSequence = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type CollaborationTaskSequence = typeof CollaborationTaskSequence.Type;

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
  holderDeviceId: DeviceId,
  membershipEpoch: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_MEMBERSHIP_EPOCH_MAX),
  ),
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
    const duration = expiresAt - grantedAt;
    return duration > 0 && duration <= COLLABORATION_AGENT_LEASE_MAX_MILLIS
      ? undefined
      : "agent lease duration is outside the supported range";
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
}).check(
  Schema.makeFilter((task) =>
    task.dependencies.includes(task.taskId) ? "a task cannot depend on itself" : undefined,
  ),
  Schema.makeFilter((task) =>
    task.fencingToken === task.revision - 1
      ? undefined
      : "task revision and fencing token are inconsistent",
  ),
  Schema.makeFilter((task) => {
    if (task.status === "open" && task.ownerUserId !== null)
      return "open tasks cannot retain an owner";
    if ((task.status === "claimed" || task.status === "completed") && task.ownerUserId === null)
      return "claimed and completed tasks require an owner";
    if (task.activeAgentLease === null) return undefined;
    return task.status === "claimed" &&
      task.ownerUserId === task.activeAgentLease.holderUserId &&
      task.fencingToken === task.activeAgentLease.fencingToken
      ? undefined
      : "active task lease is inconsistent with task ownership or fencing";
  }),
  Schema.makeFilter((task) => {
    const createdAt =
      typeof task.createdAt === "string"
        ? Date.parse(task.createdAt)
        : DateTime.toEpochMillis(task.createdAt);
    const updatedAt =
      typeof task.updatedAt === "string"
        ? Date.parse(task.updatedAt)
        : DateTime.toEpochMillis(task.updatedAt);
    return updatedAt >= createdAt ? undefined : "task update cannot predate creation";
  }),
);
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
  membershipEpoch: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_MEMBERSHIP_EPOCH_MAX),
  ),
  previousEventSha256: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  eventSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  createdAt: Schema.DateTimeUtcFromString,
}).check(
  Schema.makeFilter((event) =>
    event.task.sharedProjectId === event.sharedProjectId
      ? undefined
      : "audit event task must belong to the same project",
  ),
  Schema.makeFilter((event) => {
    const task = event.task;
    if (event.operation === "create")
      return task.revision === 1 &&
        task.createdByUserId === event.actorUserId &&
        task.status === "open"
        ? undefined
        : "create audit snapshot is inconsistent";
    if (task.revision <= 1) return "mutation audit snapshot must advance the task revision";
    if (event.operation === "claim")
      return task.status === "claimed" && task.ownerUserId === event.actorUserId
        ? undefined
        : "claim audit snapshot is inconsistent";
    if (event.operation === "reassign")
      return task.status === "claimed" ? undefined : "reassign audit snapshot is inconsistent";
    if (event.operation === "complete")
      return task.status === "completed" && task.ownerUserId === event.actorUserId
        ? undefined
        : "complete audit snapshot is inconsistent";
    if (event.operation === "cancel")
      return task.status === "cancelled" && task.activeAgentLease === null
        ? undefined
        : "cancel audit snapshot is inconsistent";
    if (event.operation === "reopen")
      return task.status === "open" && task.ownerUserId === null
        ? undefined
        : "reopen audit snapshot is inconsistent";
    if (event.operation === "set-dependencies" || event.operation === "agent.release")
      return task.activeAgentLease === null
        ? undefined
        : "lease-free audit snapshot is inconsistent";
    const lease = task.activeAgentLease;
    return lease !== null &&
      lease.holderUserId === event.actorUserId &&
      lease.holderDeviceId === event.actorDeviceId &&
      lease.membershipEpoch === event.membershipEpoch
      ? undefined
      : "agent lease audit snapshot is inconsistent";
  }),
);
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
  afterSequence: CollaborationTaskSequence,
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_TASK_PAGE_LIMIT)),
});
export type CollaborationTaskHistoryRequest = typeof CollaborationTaskHistoryRequest.Type;
