import { assert, describe, it } from "@effect/vitest";

import * as Schema from "effect/Schema";

import {
  COLLABORATION_AGENT_LEASE_MAX_MILLIS,
  COLLABORATION_TASK_BODY_MAX_UTF8_BYTES,
  CollaborationCreateTaskCommand,
  CollaborationSharedTask,
  CollaborationTaskAuditEvent,
  CollaborationTaskHistoryRequest,
} from "./collaborationTask.ts";

const decodeCreate = Schema.decodeUnknownSync(CollaborationCreateTaskCommand);
const decodeTask = Schema.decodeUnknownSync(CollaborationSharedTask);
const decodeAudit = Schema.decodeUnknownSync(CollaborationTaskAuditEvent);
const decodeHistory = Schema.decodeUnknownSync(CollaborationTaskHistoryRequest);
const hash = "a".repeat(64);
const openTask = {
  sharedProjectId: "project-1",
  taskId: "task-1",
  provenance: "operator-authored" as const,
  title: "Review the bounded change",
  body: "Operator-authored work only.",
  status: "open" as const,
  ownerUserId: null,
  dependencies: [],
  revision: 1,
  fencingToken: 0,
  activeAgentLease: null,
  createdByUserId: "user-1",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
};

describe("collaboration task contracts", () => {
  it("enforces task ownership, dependency, revision and lease cross-field invariants", () => {
    assert.equal(decodeTask(openTask).taskId, "task-1");
    assert.throws(() => decodeTask({ ...openTask, ownerUserId: "user-1" }));
    assert.throws(() => decodeTask({ ...openTask, fencingToken: 1 }));
    assert.throws(() => decodeTask({ ...openTask, dependencies: ["task-1"] }));
    assert.throws(() =>
      decodeTask({
        ...openTask,
        status: "claimed",
        ownerUserId: "user-1",
        revision: 2,
        fencingToken: 1,
        activeAgentLease: {
          leaseId: "lease-1",
          agentId: "agent-1",
          holderUserId: "user-2",
          holderDeviceId: "device-1",
          membershipEpoch: 1,
          fencingToken: 1,
          grantedAt: "2026-08-01T12:00:00.000Z",
          expiresAt: new Date(
            Date.parse("2026-08-01T12:00:00.000Z") + COLLABORATION_AGENT_LEASE_MAX_MILLIS + 1,
          ).toISOString(),
        },
      }),
    );
  });

  it("rejects invisible controls, common credentials, private paths, and UTF-8 overflow", () => {
    const base = {
      sharedProjectId: "project-1",
      commandId: "create-1",
      deviceKeyId: "key-1",
      kind: "create" as const,
      taskId: "task-1",
      provenance: "operator-authored" as const,
      title: "Safe task",
      body: "Safe operator-authored body",
      dependencies: [],
    };
    for (const body of [
      "\u202eexe.txt",
      "sk-ant-api03_abcdefghijklmnop",
      "glpat-abcdefghijklmnop",
      "AKIAABCDEFGHIJKLMNOP",
      "Open C:/Users/Alice/secret.txt",
      "path=(C:\\Users\\Alice\\secret.txt)",
      String.raw`copy \\private-server\secret\token.txt`,
      "read /root/.ssh/id_ed25519",
      " ",
      "界".repeat(Math.floor(COLLABORATION_TASK_BODY_MAX_UTF8_BYTES / 3) + 1),
    ])
      assert.throws(() => decodeCreate({ ...base, body }));
    assert.throws(() => decodeCreate({ ...base, taskId: `ghp_${"a".repeat(24)}` }));
  });

  it("binds audit task snapshots to the audit project", () => {
    const event = {
      sharedProjectId: "project-1",
      sequence: 1,
      commandId: "create-1",
      operation: "create" as const,
      task: openTask,
      actorUserId: "user-1",
      actorDeviceId: "device-1",
      membershipEpoch: 1,
      previousEventSha256: null,
      eventSha256: hash,
      createdAt: "2026-08-01T12:00:00.000Z",
    };
    assert.equal(decodeAudit(event).sharedProjectId, "project-1");
    assert.throws(() =>
      decodeAudit({
        ...event,
        task: { ...openTask, sharedProjectId: "project-2" },
      }),
    );
    assert.throws(() =>
      decodeAudit({
        ...event,
        operation: "claim",
        task: { ...openTask, revision: 2, fencingToken: 1 },
      }),
    );
    assert.throws(() =>
      decodeHistory({
        sharedProjectId: "project-1",
        taskId: "task-1",
        deviceKeyId: "key-1",
        afterSequence: Number.MAX_SAFE_INTEGER + 1,
        limit: 1,
      }),
    );
  });
});
