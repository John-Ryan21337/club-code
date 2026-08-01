import type {
  CollaborationCreateTaskCommand,
  CollaborationPrincipal,
  CollaborationSharedTask,
  CollaborationTaskAuditEvent,
  CollaborationTaskHistoryRequest,
  CollaborationTaskMutationCommand,
  CollaborationTaskReadRequest,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  COLLABORATION_ACTIVE_AGENT_LEASE_LIMIT,
  COLLABORATION_TASK_HISTORY_PAGE_MAX_UTF8_BYTES,
  COLLABORATION_TASK_PROJECT_LIMIT,
  CollaborationProjectMembershipSnapshot,
  CollaborationCreateTaskCommand as CreateSchema,
  CollaborationSharedTask as TaskSchema,
  CollaborationTaskAuditEvent as AuditSchema,
  CollaborationTaskHistoryRequest as HistorySchema,
  CollaborationTaskMutationCommand as MutationSchema,
  CollaborationTaskReadRequest as ReadSchema,
  collaborationRoleAllowsPermission,
} from "@cafecode/contracts";
import { createHash } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { authorizeCollaborationPermission } from "./CollaborationAuthorization.ts";
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";

type Operation =
  | CollaborationCreateTaskCommand["kind"]
  | CollaborationTaskMutationCommand["kind"]
  | "mutate"
  | "read"
  | "history";
export type CollaborationTaskStoreFailureReason =
  | "invalid-request"
  | "not-authorized"
  | "device-key-unavailable"
  | "not-found"
  | "revision-conflict"
  | "idempotency-conflict"
  | "invalid-transition"
  | "dependency-missing"
  | "dependency-cycle"
  | "dependency-blocked"
  | "lease-active"
  | "lease-mismatch"
  | "agent-capacity"
  | "task-capacity"
  | "integrity-failure"
  | "storage-unavailable";

export class CollaborationTaskStoreError extends Data.TaggedError("CollaborationTaskStoreError")<{
  readonly operation: Operation;
  readonly reason: CollaborationTaskStoreFailureReason;
}> {}

export interface CollaborationTaskStoreShape {
  readonly create: (input: {
    readonly principal: unknown;
    readonly command: CollaborationCreateTaskCommand;
  }) => Effect.Effect<
    CollaborationTaskAuditEvent,
    CollaborationTaskStoreError,
    CollaborationMembershipAuthority | CollaborationDeviceKeyAuthority
  >;
  readonly mutate: (input: {
    readonly principal: unknown;
    readonly command: CollaborationTaskMutationCommand;
  }) => Effect.Effect<
    CollaborationTaskAuditEvent,
    CollaborationTaskStoreError,
    CollaborationMembershipAuthority | CollaborationDeviceKeyAuthority
  >;
  readonly read: (input: {
    readonly principal: unknown;
    readonly request: CollaborationTaskReadRequest;
  }) => Effect.Effect<
    CollaborationSharedTask,
    CollaborationTaskStoreError,
    CollaborationMembershipAuthority | CollaborationDeviceKeyAuthority
  >;
  readonly history: (input: {
    readonly principal: unknown;
    readonly request: CollaborationTaskHistoryRequest;
  }) => Effect.Effect<
    ReadonlyArray<CollaborationTaskAuditEvent>,
    CollaborationTaskStoreError,
    CollaborationMembershipAuthority | CollaborationDeviceKeyAuthority
  >;
}
export class CollaborationTaskStore extends Context.Service<
  CollaborationTaskStore,
  CollaborationTaskStoreShape
>()("cafecode/collaboration/CollaborationTaskStore") {}

interface TaskRow {
  readonly sharedProjectId: string;
  readonly taskId: string;
  readonly provenance: "operator-authored";
  readonly title: string;
  readonly body: string;
  readonly status: "open" | "claimed" | "completed" | "cancelled";
  readonly ownerUserId: string | null;
  readonly dependenciesJson: string;
  readonly revision: number;
  readonly fencingToken: number;
  readonly activeLeaseId: string | null;
  readonly activeAgentId: string | null;
  readonly activeHolderUserId: string | null;
  readonly activeHolderDeviceId: string | null;
  readonly activeMembershipEpoch: number | null;
  readonly activeLeaseFencingToken: number | null;
  readonly activeLeaseGrantedAt: string | null;
  readonly activeLeaseExpiresAt: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordSha256: string;
}
interface AuditRow {
  readonly sharedProjectId: string;
  readonly sequence: number;
  readonly commandId: string;
  readonly inputSha256: string;
  readonly operation: CollaborationTaskAuditEvent["operation"];
  readonly taskId: string;
  readonly taskJson: string;
  readonly actorUserId: string;
  readonly actorDeviceId: string;
  readonly membershipEpoch: number;
  readonly previousEventSha256: string | null;
  readonly eventSha256: string;
  readonly createdAt: string;
}
const taskColumns = `shared_project_id AS "sharedProjectId", task_id AS "taskId", provenance, title, body, status,
 owner_user_id AS "ownerUserId", dependencies_json AS "dependenciesJson", revision, fencing_token AS "fencingToken",
 active_lease_id AS "activeLeaseId", active_agent_id AS "activeAgentId", active_holder_user_id AS "activeHolderUserId",
 active_holder_device_id AS "activeHolderDeviceId", active_membership_epoch AS "activeMembershipEpoch",
 active_lease_fencing_token AS "activeLeaseFencingToken", active_lease_granted_at AS "activeLeaseGrantedAt",
 active_lease_expires_at AS "activeLeaseExpiresAt", created_by_user_id AS "createdByUserId", created_at AS "createdAt",
 updated_at AS "updatedAt", record_sha256 AS "recordSha256"`;
const auditColumns = `shared_project_id AS "sharedProjectId", sequence, command_id AS "commandId", input_sha256 AS "inputSha256",
 operation, task_id AS "taskId", task_json AS "taskJson", actor_user_id AS "actorUserId", actor_device_id AS "actorDeviceId",
 membership_epoch AS "membershipEpoch", previous_event_sha256 AS "previousEventSha256", event_sha256 AS "eventSha256", created_at AS "createdAt"`;

const fail = (operation: Operation, reason: CollaborationTaskStoreFailureReason) =>
  new CollaborationTaskStoreError({ operation, reason });
const isStoreError = (value: unknown): value is CollaborationTaskStoreError =>
  value instanceof CollaborationTaskStoreError;
const hash = (domain: string, value: string) =>
  createHash("sha256").update(domain).update("\0").update(value).digest("hex");
const encodeTask = Schema.encodeUnknownSync(TaskSchema);
const encodeAudit = Schema.encodeUnknownSync(AuditSchema);
const encodeCreateCommand = Schema.encodeUnknownSync(CreateSchema);
const encodeMutationCommand = Schema.encodeUnknownSync(MutationSchema);
const decodeTask = Schema.decodeUnknownSync(TaskSchema);
const decodeAudit = Schema.decodeUnknownSync(AuditSchema);
const decodeCreateCommand = Schema.decodeUnknownEffect(CreateSchema);
const decodeMutationCommand = Schema.decodeUnknownEffect(MutationSchema);
const decodeReadRequest = Schema.decodeUnknownEffect(ReadSchema);
const decodeHistoryRequest = Schema.decodeUnknownEffect(HistorySchema);
const decodeMembership = Schema.decodeUnknownEffect(CollaborationProjectMembershipSnapshot);
const decodeCreate = (value: unknown) => decodeCreateCommand(value, { onExcessProperty: "error" });
const decodeMutation = (value: unknown) =>
  decodeMutationCommand(value, { onExcessProperty: "error" });

function taskPayload(row: Omit<TaskRow, "recordSha256">) {
  return JSON.stringify(row);
}
function auditPayload(event: CollaborationTaskAuditEvent, inputSha256: string) {
  const encoded = encodeAudit(event);
  return JSON.stringify({
    sharedProjectId: encoded.sharedProjectId,
    sequence: encoded.sequence,
    commandId: encoded.commandId,
    operation: encoded.operation,
    task: encoded.task,
    actorUserId: encoded.actorUserId,
    actorDeviceId: encoded.actorDeviceId,
    membershipEpoch: encoded.membershipEpoch,
    previousEventSha256: encoded.previousEventSha256,
    createdAt: encoded.createdAt,
    inputSha256,
  });
}
function rowToTask(row: TaskRow, operation: Operation): CollaborationSharedTask {
  const { recordSha256: _record, ...payload } = row;
  if (hash("club-code-collaboration-task-record-v1", taskPayload(payload)) !== row.recordSha256)
    throw fail(operation, "integrity-failure");
  const dependencies = JSON.parse(row.dependenciesJson) as unknown;
  const activeAgentLease =
    row.activeLeaseId === null
      ? null
      : {
          leaseId: row.activeLeaseId,
          agentId: row.activeAgentId,
          holderUserId: row.activeHolderUserId,
          holderDeviceId: row.activeHolderDeviceId,
          membershipEpoch: row.activeMembershipEpoch,
          fencingToken: row.activeLeaseFencingToken,
          grantedAt: row.activeLeaseGrantedAt,
          expiresAt: row.activeLeaseExpiresAt,
        };
  return decodeTask({
    sharedProjectId: row.sharedProjectId,
    taskId: row.taskId,
    provenance: row.provenance,
    title: row.title,
    body: row.body,
    status: row.status,
    ownerUserId: row.ownerUserId,
    dependencies,
    revision: row.revision,
    fencingToken: row.fencingToken,
    activeAgentLease,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
function auditFromRow(row: AuditRow, operation: Operation) {
  const event = decodeAudit({
    sharedProjectId: row.sharedProjectId,
    sequence: row.sequence,
    commandId: row.commandId,
    operation: row.operation,
    task: JSON.parse(row.taskJson),
    actorUserId: row.actorUserId,
    actorDeviceId: row.actorDeviceId,
    membershipEpoch: row.membershipEpoch,
    previousEventSha256: row.previousEventSha256,
    eventSha256: row.eventSha256,
    createdAt: row.createdAt,
  });
  if (
    event.sharedProjectId !== row.sharedProjectId ||
    event.task.sharedProjectId !== row.sharedProjectId ||
    event.task.taskId !== row.taskId ||
    hash("club-code-collaboration-task-audit-v1", auditPayload(event, row.inputSha256)) !==
      row.eventSha256
  )
    throw fail(operation, "integrity-failure");
  return event;
}
const auditFromRowEffect = (row: AuditRow, operation: Operation) =>
  Effect.try({
    try: () => auditFromRow(row, operation),
    catch: (error) => (isStoreError(error) ? error : fail(operation, "integrity-failure")),
  });

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const authorize = (
    operation: Operation,
    principal: unknown,
    project: SharedProjectId,
    deviceKeyId: CollaborationTaskReadRequest["deviceKeyId"],
    permission: "task.read" | "task.manage" | "agent.dispatch",
  ) =>
    Effect.gen(function* () {
      const grant = yield* authorizeCollaborationPermission({
        principal,
        targetProjectId: project,
        permission,
      }).pipe(Effect.mapError(() => fail(operation, "not-authorized")));
      const devices = yield* CollaborationDeviceKeyAuthority;
      const key = yield* devices
        .getActiveEd25519PublicKey({
          sharedProjectId: project,
          userId: grant.principal.userId,
          deviceId: grant.principal.deviceId,
          deviceKeyId,
          membershipEpoch: grant.principal.membershipEpoch,
        })
        .pipe(Effect.mapError(() => fail(operation, "device-key-unavailable")));
      if (
        key === null ||
        key.sharedProjectId !== project ||
        key.userId !== grant.principal.userId ||
        key.deviceId !== grant.principal.deviceId ||
        key.deviceKeyId !== deviceKeyId ||
        key.membershipEpoch !== grant.principal.membershipEpoch ||
        !(key.publicKeySpkiDer instanceof Uint8Array) ||
        key.publicKeySpkiDer.byteLength !== 44
      )
        return yield* Effect.fail(fail(operation, "not-authorized"));
      return grant.principal;
    });
  const lock = (project: string) =>
    sql`INSERT INTO collaboration_task_write_locks(shared_project_id) VALUES(${project}) ON CONFLICT(shared_project_id) DO UPDATE SET shared_project_id=excluded.shared_project_id`;
  const rowsFor = (project: string, task: string) =>
    sql<TaskRow>`SELECT ${sql.unsafe(taskColumns)} FROM collaboration_tasks WHERE shared_project_id=${project} AND task_id=${task}`;
  const dependencyRowsFor = (project: string, task: string) =>
    sql<{
      readonly taskId: string;
    }>`SELECT depends_on_task_id AS "taskId" FROM collaboration_task_dependencies WHERE shared_project_id=${project} AND task_id=${task} ORDER BY depends_on_task_id`;
  const loadTask = (operation: Operation, project: string, taskId: string) =>
    Effect.gen(function* () {
      const rows = yield* rowsFor(project, taskId);
      if (rows.length !== 1)
        return yield* Effect.fail(
          fail(operation, rows.length === 0 ? "not-found" : "integrity-failure"),
        );
      const task = yield* Effect.try({
        try: () => rowToTask(rows[0]!, operation),
        catch: (error) => (isStoreError(error) ? error : fail(operation, "integrity-failure")),
      });
      const projected = (yield* dependencyRowsFor(project, taskId)).map((row) => row.taskId);
      const declared = task.dependencies.toSorted();
      if (JSON.stringify(projected) !== JSON.stringify(declared))
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      return task;
    });
  const assertAssignableOwner = (
    operation: Operation,
    project: SharedProjectId,
    userId: string,
    membershipEpoch: number,
  ) =>
    Effect.gen(function* () {
      const authority = yield* CollaborationMembershipAuthority;
      const raw = yield* authority
        .getCurrent(project)
        .pipe(Effect.mapError(() => fail(operation, "not-authorized")));
      const current = yield* decodeMembership(raw, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail(operation, "not-authorized")),
      );
      const member = current.members.find((candidate) => candidate.userId === userId);
      if (
        current.sharedProjectId !== project ||
        current.epoch !== membershipEpoch ||
        !member ||
        !member.permissions.includes("task.manage") ||
        !collaborationRoleAllowsPermission(member.role, "task.manage")
      )
        return yield* Effect.fail(fail(operation, "not-authorized"));
    });
  const commandRows = (project: string, command: string) =>
    sql<AuditRow>`SELECT ${sql.unsafe(auditColumns)} FROM collaboration_task_audit_events WHERE shared_project_id=${project} AND command_id=${command}`;
  const validatedAudit = (operation: Operation, row: AuditRow) =>
    Effect.gen(function* () {
      const event = yield* auditFromRowEffect(row, operation);
      if (row.sequence === 1) {
        if (event.previousEventSha256 !== null)
          return yield* Effect.fail(fail(operation, "integrity-failure"));
        return event;
      }
      const predecessor =
        yield* sql<AuditRow>`SELECT ${sql.unsafe(auditColumns)} FROM collaboration_task_audit_events WHERE shared_project_id=${row.sharedProjectId} AND sequence=${row.sequence - 1}`;
      if (predecessor.length !== 1) return yield* Effect.fail(fail(operation, "integrity-failure"));
      const previous = yield* auditFromRowEffect(predecessor[0]!, operation);
      if (event.previousEventSha256 !== previous.eventSha256)
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      return event;
    });
  const inputHash = (command: unknown, principal: CollaborationPrincipal) =>
    hash(
      "club-code-collaboration-task-command-v1",
      JSON.stringify({
        command,
        principal: {
          userId: principal.userId,
          deviceId: principal.deviceId,
          membershipEpoch: principal.membershipEpoch,
        },
      }),
    );
  const replay = (
    operation: Operation,
    rows: ReadonlyArray<AuditRow>,
    expectedHash: string,
    principal: CollaborationPrincipal,
  ) =>
    Effect.gen(function* () {
      if (rows.length !== 1)
        return yield* Effect.fail(
          fail(operation, rows.length === 0 ? "not-found" : "integrity-failure"),
        );
      const row = rows[0]!;
      if (
        row.inputSha256 !== expectedHash ||
        row.actorUserId !== principal.userId ||
        row.actorDeviceId !== principal.deviceId ||
        row.membershipEpoch !== principal.membershipEpoch ||
        row.operation !== operation
      )
        return yield* Effect.fail(fail(operation, "idempotency-conflict"));
      yield* loadTask(operation, row.sharedProjectId, row.taskId);
      return yield* validatedAudit(operation, row);
    });
  const appendAudit = (
    operation: CollaborationTaskAuditEvent["operation"],
    commandId: string,
    inputSha256: string,
    task: CollaborationSharedTask,
    principal: CollaborationPrincipal,
    now: string,
  ) =>
    Effect.gen(function* () {
      const tails =
        yield* sql<AuditRow>`SELECT ${sql.unsafe(auditColumns)} FROM collaboration_task_audit_events WHERE shared_project_id=${task.sharedProjectId} ORDER BY sequence DESC LIMIT 1`;
      const tail = tails.length === 0 ? null : yield* validatedAudit(operation, tails[0]!);
      if (tail !== null && Date.parse(now) < DateTime.toEpochMillis(tail.createdAt))
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      const sequence = (tail?.sequence ?? 0) + 1;
      if (!Number.isSafeInteger(sequence))
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      const encodedTask = encodeTask(task);
      const unsigned = {
        sharedProjectId: task.sharedProjectId,
        sequence,
        commandId,
        operation,
        task: encodedTask,
        actorUserId: principal.userId,
        actorDeviceId: principal.deviceId,
        membershipEpoch: principal.membershipEpoch,
        previousEventSha256: tail?.eventSha256 ?? null,
        eventSha256: undefined,
        createdAt: now,
      };
      const event = decodeAudit({ ...unsigned, eventSha256: "0".repeat(64) });
      const eventSha256 = hash(
        "club-code-collaboration-task-audit-v1",
        auditPayload(event, inputSha256),
      );
      yield* sql`INSERT INTO collaboration_task_audit_events(shared_project_id,sequence,command_id,input_sha256,operation,task_id,task_json,actor_user_id,actor_device_id,membership_epoch,previous_event_sha256,event_sha256,created_at)
      VALUES(${task.sharedProjectId},${sequence},${commandId},${inputSha256},${operation},${task.taskId},${JSON.stringify(encodedTask)},${principal.userId},${principal.deviceId},${principal.membershipEpoch},${tail?.eventSha256 ?? null},${eventSha256},${now})`;
      return decodeAudit({ ...unsigned, eventSha256 });
    });
  const persistTask = (task: CollaborationSharedTask) =>
    Effect.gen(function* () {
      const encoded = encodeTask(task);
      const lease = encoded.activeAgentLease;
      const row = {
        sharedProjectId: encoded.sharedProjectId,
        taskId: encoded.taskId,
        provenance: encoded.provenance,
        title: encoded.title,
        body: encoded.body,
        status: encoded.status,
        ownerUserId: encoded.ownerUserId,
        dependenciesJson: JSON.stringify(encoded.dependencies),
        revision: encoded.revision,
        fencingToken: encoded.fencingToken,
        activeLeaseId: lease?.leaseId ?? null,
        activeAgentId: lease?.agentId ?? null,
        activeHolderUserId: lease?.holderUserId ?? null,
        activeHolderDeviceId: lease?.holderDeviceId ?? null,
        activeMembershipEpoch: lease?.membershipEpoch ?? null,
        activeLeaseFencingToken: lease?.fencingToken ?? null,
        activeLeaseGrantedAt: lease?.grantedAt ?? null,
        activeLeaseExpiresAt: lease?.expiresAt ?? null,
        createdByUserId: encoded.createdByUserId,
        createdAt: encoded.createdAt,
        updatedAt: encoded.updatedAt,
      };
      const record = hash("club-code-collaboration-task-record-v1", taskPayload(row));
      yield* sql`UPDATE collaboration_tasks SET status=${row.status},owner_user_id=${row.ownerUserId},dependencies_json=${row.dependenciesJson},revision=${row.revision},fencing_token=${row.fencingToken},
      active_lease_id=${row.activeLeaseId},active_agent_id=${row.activeAgentId},active_holder_user_id=${row.activeHolderUserId},active_holder_device_id=${row.activeHolderDeviceId},active_membership_epoch=${row.activeMembershipEpoch},
      active_lease_fencing_token=${row.activeLeaseFencingToken},active_lease_granted_at=${row.activeLeaseGrantedAt},active_lease_expires_at=${row.activeLeaseExpiresAt},updated_at=${row.updatedAt},record_sha256=${record}
      WHERE shared_project_id=${row.sharedProjectId} AND task_id=${row.taskId}`;
    });

  const create: CollaborationTaskStoreShape["create"] = (input) =>
    Effect.gen(function* () {
      const operation = "create" as const;
      const command = yield* decodeCreate(input.command).pipe(
        Effect.mapError(() => fail(operation, "invalid-request")),
      );
      const initial = yield* authorize(
        operation,
        input.principal,
        command.sharedProjectId,
        command.deviceKeyId,
        "task.manage",
      );
      const digest = inputHash(encodeCreateCommand(command), initial);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lock(command.sharedProjectId);
          const principal = yield* authorize(
            operation,
            initial,
            command.sharedProjectId,
            command.deviceKeyId,
            "task.manage",
          );
          const prior = yield* commandRows(command.sharedProjectId, command.commandId);
          if (prior.length > 0) {
            const event = yield* replay(operation, prior, digest, principal);
            yield* authorize(
              operation,
              principal,
              command.sharedProjectId,
              command.deviceKeyId,
              "task.manage",
            );
            return event;
          }
          if ((yield* rowsFor(command.sharedProjectId, command.taskId)).length !== 0)
            return yield* Effect.fail(fail(operation, "idempotency-conflict"));
          const taskCount = yield* sql<{
            readonly count: number;
          }>`SELECT COUNT(*) AS count FROM collaboration_tasks WHERE shared_project_id=${command.sharedProjectId}`;
          if ((taskCount[0]?.count ?? 0) >= COLLABORATION_TASK_PROJECT_LIMIT)
            return yield* Effect.fail(fail(operation, "task-capacity"));
          for (const dependency of command.dependencies) {
            const loaded = yield* loadTask(operation, command.sharedProjectId, dependency).pipe(
              Effect.mapError((error) =>
                error.reason === "not-found" ? fail(operation, "dependency-missing") : error,
              ),
            );
            if (loaded.sharedProjectId !== command.sharedProjectId)
              return yield* Effect.fail(fail(operation, "integrity-failure"));
          }
          const nowInstant = yield* DateTime.now;
          const now = DateTime.formatIso(nowInstant);
          const task = decodeTask({
            sharedProjectId: command.sharedProjectId,
            taskId: command.taskId,
            provenance: "operator-authored",
            title: command.title,
            body: command.body,
            status: "open",
            ownerUserId: null,
            dependencies: command.dependencies,
            revision: 1,
            fencingToken: 0,
            activeAgentLease: null,
            createdByUserId: principal.userId,
            createdAt: now,
            updatedAt: now,
          });
          const encoded = encodeTask(task);
          const row = {
            sharedProjectId: encoded.sharedProjectId,
            taskId: encoded.taskId,
            provenance: encoded.provenance,
            title: encoded.title,
            body: encoded.body,
            status: encoded.status,
            ownerUserId: encoded.ownerUserId,
            dependenciesJson: JSON.stringify(encoded.dependencies),
            revision: 1,
            fencingToken: 0,
            activeLeaseId: null,
            activeAgentId: null,
            activeHolderUserId: null,
            activeHolderDeviceId: null,
            activeMembershipEpoch: null,
            activeLeaseFencingToken: null,
            activeLeaseGrantedAt: null,
            activeLeaseExpiresAt: null,
            createdByUserId: encoded.createdByUserId,
            createdAt: encoded.createdAt,
            updatedAt: encoded.updatedAt,
          };
          const record = hash("club-code-collaboration-task-record-v1", taskPayload(row));
          yield* sql`INSERT INTO collaboration_tasks(shared_project_id,task_id,provenance,title,body,status,owner_user_id,dependencies_json,revision,fencing_token,created_by_user_id,created_at,updated_at,record_sha256)
        VALUES(${row.sharedProjectId},${row.taskId},${row.provenance},${row.title},${row.body},${row.status},NULL,${row.dependenciesJson},1,0,${row.createdByUserId},${row.createdAt},${row.updatedAt},${record})`;
          for (const dependency of command.dependencies)
            yield* sql`INSERT INTO collaboration_task_dependencies(shared_project_id,task_id,depends_on_task_id) VALUES(${command.sharedProjectId},${command.taskId},${dependency})`;
          const event = yield* appendAudit(
            operation,
            command.commandId,
            digest,
            task,
            principal,
            now,
          );
          yield* authorize(
            operation,
            principal,
            command.sharedProjectId,
            command.deviceKeyId,
            "task.manage",
          );
          return event;
        }),
      );
    }).pipe(Effect.mapError((e) => (isStoreError(e) ? e : fail("create", "storage-unavailable"))));

  const mutate: CollaborationTaskStoreShape["mutate"] = (input) =>
    Effect.gen(function* () {
      const command = yield* decodeMutation(input.command).pipe(
        Effect.mapError(() => fail("mutate", "invalid-request")),
      );
      const operation = command.kind;
      const permission = operation.startsWith("agent.")
        ? ("agent.dispatch" as const)
        : ("task.manage" as const);
      const initial = yield* authorize(
        operation,
        input.principal,
        command.sharedProjectId,
        command.deviceKeyId,
        permission,
      );
      const digest = inputHash(encodeMutationCommand(command), initial);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lock(command.sharedProjectId);
          const principal = yield* authorize(
            operation,
            initial,
            command.sharedProjectId,
            command.deviceKeyId,
            permission,
          );
          const prior = yield* commandRows(command.sharedProjectId, command.commandId);
          if (prior.length > 0) {
            const event = yield* replay(operation, prior, digest, principal);
            yield* authorize(
              operation,
              principal,
              command.sharedProjectId,
              command.deviceKeyId,
              permission,
            );
            return event;
          }
          const current = yield* loadTask(operation, command.sharedProjectId, command.taskId);
          if (current.revision !== command.expectedRevision)
            return yield* Effect.fail(fail(operation, "revision-conflict"));
          const nextRevision = current.revision + 1;
          const nextFence = current.fencingToken + 1;
          if (!Number.isSafeInteger(nextRevision) || !Number.isSafeInteger(nextFence))
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          const nowInstant = yield* DateTime.now;
          const now = DateTime.formatIso(nowInstant);
          const nowMs = Date.parse(now);
          if (nowMs < DateTime.toEpochMillis(current.updatedAt))
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          let status = current.status;
          let owner = current.ownerUserId;
          let dependencies = [...current.dependencies];
          let lease = current.activeAgentLease;
          if (operation === "claim") {
            if (status !== "open") return yield* Effect.fail(fail(operation, "invalid-transition"));
            status = "claimed";
            owner = principal.userId;
            lease = null;
          } else if (operation === "reassign") {
            if (status === "completed" || status === "cancelled")
              return yield* Effect.fail(fail(operation, "invalid-transition"));
            yield* assertAssignableOwner(
              operation,
              command.sharedProjectId,
              command.ownerUserId,
              principal.membershipEpoch,
            );
            status = "claimed";
            owner = command.ownerUserId;
            lease = null;
          } else if (operation === "complete") {
            if (status !== "claimed" || owner !== principal.userId)
              return yield* Effect.fail(fail(operation, "invalid-transition"));
            for (const dependency of current.dependencies) {
              const prerequisite = yield* loadTask(
                operation,
                command.sharedProjectId,
                dependency,
              ).pipe(
                Effect.mapError((error) =>
                  error.reason === "not-found" ? fail(operation, "integrity-failure") : error,
                ),
              );
              if (prerequisite.status !== "completed")
                return yield* Effect.fail(fail(operation, "dependency-blocked"));
            }
            status = "completed";
            lease = null;
          } else if (operation === "cancel") {
            if (status === "completed" || status === "cancelled")
              return yield* Effect.fail(fail(operation, "invalid-transition"));
            status = "cancelled";
            lease = null;
          } else if (operation === "reopen") {
            if (status !== "completed" && status !== "cancelled")
              return yield* Effect.fail(fail(operation, "invalid-transition"));
            const completedRows =
              yield* sql<TaskRow>`SELECT ${sql.unsafe(taskColumns)} FROM collaboration_tasks WHERE shared_project_id=${command.sharedProjectId} AND status='completed'`;
            for (const row of completedRows) {
              const dependent = yield* Effect.try({
                try: () => rowToTask(row, operation),
                catch: (error) =>
                  isStoreError(error) ? error : fail(operation, "integrity-failure"),
              });
              if (dependent.dependencies.includes(command.taskId))
                return yield* Effect.fail(fail(operation, "dependency-blocked"));
            }
            status = "open";
            owner = null;
            lease = null;
          } else if (operation === "set-dependencies") {
            if (
              status === "completed" ||
              status === "cancelled" ||
              (lease !== null && DateTime.toEpochMillis(lease.expiresAt) > nowMs)
            )
              return yield* Effect.fail(fail(operation, "invalid-transition"));
            for (const dep of command.dependencies) {
              yield* loadTask(operation, command.sharedProjectId, dep).pipe(
                Effect.mapError((error) =>
                  error.reason === "not-found" ? fail(operation, "dependency-missing") : error,
                ),
              );
              const reach = yield* sql<{
                taskId: string;
              }>`WITH RECURSIVE reach(id) AS (SELECT depends_on_task_id FROM collaboration_task_dependencies WHERE shared_project_id=${command.sharedProjectId} AND task_id=${dep} UNION SELECT d.depends_on_task_id FROM collaboration_task_dependencies d JOIN reach r ON d.task_id=r.id WHERE d.shared_project_id=${command.sharedProjectId}) SELECT id AS "taskId" FROM reach`;
              if (reach.some((entry) => entry.taskId === command.taskId))
                return yield* Effect.fail(fail(operation, "dependency-cycle"));
              for (const entry of reach)
                yield* loadTask(operation, command.sharedProjectId, entry.taskId).pipe(
                  Effect.mapError((error) =>
                    error.reason === "not-found" ? fail(operation, "integrity-failure") : error,
                  ),
                );
            }
            dependencies = [...command.dependencies];
            lease = null;
          } else if (operation === "agent.acquire") {
            if (status !== "claimed" || owner !== principal.userId)
              return yield* Effect.fail(fail(operation, "invalid-transition"));
            if (lease !== null && DateTime.toEpochMillis(lease.expiresAt) > nowMs)
              return yield* Effect.fail(fail(operation, "lease-active"));
            const duplicateLeaseIds =
              yield* sql<TaskRow>`SELECT ${sql.unsafe(taskColumns)} FROM collaboration_tasks WHERE shared_project_id=${command.sharedProjectId} AND active_lease_id=${command.leaseId} AND task_id<>${command.taskId}`;
            for (const row of duplicateLeaseIds)
              yield* loadTask(operation, command.sharedProjectId, row.taskId);
            if (duplicateLeaseIds.length > 0)
              return yield* Effect.fail(fail(operation, "lease-active"));
            const active =
              yield* sql<TaskRow>`SELECT ${sql.unsafe(taskColumns)} FROM collaboration_tasks WHERE shared_project_id=${command.sharedProjectId} AND active_lease_expires_at>${now} ORDER BY task_id LIMIT ${COLLABORATION_ACTIVE_AGENT_LEASE_LIMIT + 1}`;
            for (const row of active) {
              const activeTask = yield* loadTask(operation, command.sharedProjectId, row.taskId);
              if (
                activeTask.activeAgentLease === null ||
                DateTime.toEpochMillis(activeTask.activeAgentLease.expiresAt) <= nowMs
              )
                return yield* Effect.fail(fail(operation, "integrity-failure"));
            }
            if (active.length >= COLLABORATION_ACTIVE_AGENT_LEASE_LIMIT)
              return yield* Effect.fail(fail(operation, "agent-capacity"));
            lease = {
              leaseId: command.leaseId,
              agentId: command.agentId,
              holderUserId: principal.userId,
              holderDeviceId: principal.deviceId,
              membershipEpoch: principal.membershipEpoch,
              fencingToken: nextFence,
              grantedAt: nowInstant,
              expiresAt: DateTime.add(nowInstant, { milliseconds: command.leaseMillis }),
            };
          } else if (operation === "agent.renew") {
            if (
              lease === null ||
              lease.leaseId !== command.leaseId ||
              lease.holderUserId !== principal.userId ||
              lease.holderDeviceId !== principal.deviceId ||
              lease.membershipEpoch !== principal.membershipEpoch ||
              DateTime.toEpochMillis(lease.expiresAt) <= nowMs
            )
              return yield* Effect.fail(fail(operation, "lease-mismatch"));
            lease = {
              ...lease,
              fencingToken: nextFence,
              grantedAt: nowInstant,
              expiresAt: DateTime.add(nowInstant, { milliseconds: command.leaseMillis }),
            };
          } else {
            if (
              lease === null ||
              lease.leaseId !== command.leaseId ||
              lease.holderUserId !== principal.userId ||
              lease.holderDeviceId !== principal.deviceId ||
              lease.membershipEpoch !== principal.membershipEpoch
            )
              return yield* Effect.fail(fail(operation, "lease-mismatch"));
            lease = null;
          }
          const next = decodeTask({
            ...encodeTask(current),
            status,
            ownerUserId: owner,
            dependencies,
            revision: nextRevision,
            fencingToken: nextFence,
            activeAgentLease:
              lease === null
                ? null
                : {
                    ...lease,
                    grantedAt: DateTime.formatIso(lease.grantedAt),
                    expiresAt: DateTime.formatIso(lease.expiresAt),
                  },
            updatedAt: now,
          });
          yield* persistTask(next);
          if (operation === "set-dependencies") {
            yield* sql`DELETE FROM collaboration_task_dependencies WHERE shared_project_id=${command.sharedProjectId} AND task_id=${command.taskId}`;
            for (const dep of dependencies)
              yield* sql`INSERT INTO collaboration_task_dependencies(shared_project_id,task_id,depends_on_task_id) VALUES(${command.sharedProjectId},${command.taskId},${dep})`;
          }
          const event = yield* appendAudit(
            operation,
            command.commandId,
            digest,
            next,
            principal,
            now,
          );
          const commitPrincipal = yield* authorize(
            operation,
            principal,
            command.sharedProjectId,
            command.deviceKeyId,
            permission,
          );
          if (operation === "reassign")
            yield* assertAssignableOwner(
              operation,
              command.sharedProjectId,
              command.ownerUserId,
              commitPrincipal.membershipEpoch,
            );
          return event;
        }),
      );
    }).pipe(Effect.mapError((e) => (isStoreError(e) ? e : fail("mutate", "storage-unavailable"))));

  const read: CollaborationTaskStoreShape["read"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeReadRequest(input.request, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail("read", "invalid-request")));
      const principal = yield* authorize(
        "read",
        input.principal,
        request.sharedProjectId,
        request.deviceKeyId,
        "task.read",
      );
      const task = yield* loadTask("read", request.sharedProjectId, request.taskId);
      yield* authorize(
        "read",
        principal,
        request.sharedProjectId,
        request.deviceKeyId,
        "task.read",
      );
      return task;
    }).pipe(Effect.mapError((e) => (isStoreError(e) ? e : fail("read", "storage-unavailable"))));
  const history: CollaborationTaskStoreShape["history"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeHistoryRequest(input.request, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail("history", "invalid-request")));
      const principal = yield* authorize(
        "history",
        input.principal,
        request.sharedProjectId,
        request.deviceKeyId,
        "task.read",
      );
      yield* loadTask("history", request.sharedProjectId, request.taskId);
      const rows =
        yield* sql<AuditRow>`SELECT ${sql.unsafe(auditColumns)} FROM collaboration_task_audit_events WHERE shared_project_id=${request.sharedProjectId} AND task_id=${request.taskId} AND sequence>${request.afterSequence} ORDER BY sequence ASC LIMIT ${request.limit}`;
      const events = [];
      // Include the JSON array delimiters and inter-event comma so the bound
      // applies to the returned encoded page, not merely the sum of objects.
      let encodedBytes = 2;
      for (const row of rows) {
        const event = yield* validatedAudit("history", row);
        const eventBytes = Buffer.byteLength(JSON.stringify(encodeAudit(event)), "utf8");
        const separatorBytes = events.length === 0 ? 0 : 1;
        if (
          events.length > 0 &&
          encodedBytes + separatorBytes + eventBytes >
            COLLABORATION_TASK_HISTORY_PAGE_MAX_UTF8_BYTES
        )
          break;
        encodedBytes += separatorBytes + eventBytes;
        events.push(event);
      }
      yield* authorize(
        "history",
        principal,
        request.sharedProjectId,
        request.deviceKeyId,
        "task.read",
      );
      return events;
    }).pipe(Effect.mapError((e) => (isStoreError(e) ? e : fail("history", "storage-unavailable"))));
  return { create, mutate, read, history } satisfies CollaborationTaskStoreShape;
});

export const CollaborationTaskStoreLive = Layer.effect(CollaborationTaskStore, makeStore);
