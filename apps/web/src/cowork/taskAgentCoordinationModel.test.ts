import type { CollaborationSharedTask, SharedProjectId } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  SHARED_TASK_PAGE_LIMIT,
  SharedTaskAgentCoordinationModel,
  classifySharedTaskClientError,
  type SharedTaskMutationRequest,
} from "./taskAgentCoordinationModel";

const project = (value: string) => value as SharedProjectId;

const task = (taskId: string, revision: number, overrides: Partial<CollaborationSharedTask> = {}) =>
  ({
    sharedProjectId: project("project-a"),
    taskId,
    provenance: "operator-authored",
    title: `Task ${taskId}`,
    body: "Operator-authored coordination intent.",
    status: "open",
    ownerUserId: null,
    dependencies: [],
    revision,
    fencingToken: revision - 1,
    activeAgentLease: null,
    createdByUserId: "user-a",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }) as unknown as CollaborationSharedTask;

const command = (
  overrides: Partial<SharedTaskMutationRequest> = {},
): SharedTaskMutationRequest => ({
  sharedProjectId: project("project-a"),
  commandId: "command-1",
  kind: "claim",
  taskId: task("task-a", 1).taskId,
  expectedRevision: 1,
  ...overrides,
});

const seed = (
  model: SharedTaskAgentCoordinationModel,
  tasks: ReadonlyArray<CollaborationSharedTask>,
) => {
  const ticket = model.beginPage(null)!;
  model.acceptPage(ticket, {
    sharedProjectId: project("project-a"),
    requestCursor: null,
    tasks,
    nextCursor: null,
  });
};

describe("SharedTaskAgentCoordinationModel", () => {
  it("rejects stale pages after a project switch and after disposal", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    const stale = model.beginPage(null)!;

    model.selectProject(project("project-b"));
    expect(
      model.acceptPage(stale, {
        sharedProjectId: project("project-a"),
        requestCursor: null,
        tasks: [task("task-a", 1)],
        nextCursor: null,
      }),
    ).toBe(false);
    expect(model.snapshot().tasks).toEqual([]);

    const disposed = model.beginPage(null)!;
    model.dispose();
    expect(model.rejectPage(disposed)).toBe(false);
  });

  it("bounds pages and refuses mismatched project or cursor responses", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    const ticket = model.beginPage(null)!;
    expect(
      model.acceptPage(ticket, {
        sharedProjectId: project("project-b"),
        requestCursor: "cursor-a",
        tasks: [],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(model.snapshot().pageState).toBe("error");

    const retry = model.beginPage(null)!;
    expect(
      model.acceptPage(retry, {
        sharedProjectId: project("project-a"),
        requestCursor: null,
        tasks: Array.from({ length: SHARED_TASK_PAGE_LIMIT + 1 }, (_, index) =>
          task(`task-${index}`, 1),
        ),
        nextCursor: null,
      }),
    ).toBe(true);
    expect(model.snapshot().tasks).toHaveLength(0);
  });

  it("deduplicates tasks monotonically and exposes equal-revision conflicts", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    const first = model.beginPage(null)!;
    model.acceptPage(first, {
      sharedProjectId: project("project-a"),
      requestCursor: null,
      tasks: [task("task-a", 2), task("task-a", 2), task("task-b", 3)],
      nextCursor: "next",
    });

    const second = model.beginPage("next")!;
    model.acceptPage(second, {
      sharedProjectId: project("project-a"),
      requestCursor: "next",
      tasks: [task("task-a", 1), task("task-b", 3, { title: "Conflicting title" })],
      nextCursor: null,
    });

    const snapshot = model.snapshot();
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.find((value) => value.taskId === "task-a")?.revision).toBe(2);
    expect(snapshot.revisionConflicts.has("task-b")).toBe(true);

    const canonicalRefresh = model.beginPage(null)!;
    model.acceptPage(canonicalRefresh, {
      sharedProjectId: project("project-a"),
      requestCursor: null,
      tasks: [task("task-b", 3)],
      nextCursor: null,
    });
    expect(model.snapshot().revisionConflicts.has("task-b")).toBe(false);

    const third = model.beginPage(null)!;
    model.acceptPage(third, {
      sharedProjectId: project("project-a"),
      requestCursor: null,
      tasks: [task("task-b", 4)],
      nextCursor: null,
    });
    expect(model.snapshot().revisionConflicts.has("task-b")).toBe(false);
  });

  it("binds an exact command ID to one intent and keeps exact retries", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    seed(model, [task("task-a", 1), task("task-b", 1)]);
    const request = command();
    const first = model.beginCommand(request)!;
    model.rejectCommand(first, { kind: "retry", message: "Retry safely." });

    const retryState = model.snapshot().commandByTaskId.get("task-a");
    expect(retryState?.kind).toBe("retry");
    if (retryState?.kind !== "retry") throw new Error("expected retry state");
    expect(retryState.request).toStrictEqual(request);
    expect(Object.isFrozen(retryState)).toBe(true);
    expect(Object.isFrozen(retryState.request)).toBe(true);
    expect(model.beginCommand(retryState.request)?.request).toBe(retryState.request);

    expect(
      model.beginCommand(
        command({
          taskId: task("task-b", 1).taskId,
        }),
      ),
    ).toBeNull();
    expect(model.snapshot().commandByTaskId.get("task-b")?.kind).toBe("conflict");
  });

  it("rejects mismatched command acknowledgements and stale completions", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    seed(model, [task("task-a", 1)]);
    const ticket = model.beginCommand(command())!;
    expect(
      model.acceptCommand(ticket, {
        sharedProjectId: project("project-a"),
        commandId: "different-command",
        task: task("task-a", 2),
      }),
    ).toBe(true);
    expect(model.snapshot().commandByTaskId.get("task-a")?.kind).toBe("conflict");

    const refresh = model.beginPage(null)!;
    model.acceptPage(refresh, {
      sharedProjectId: project("project-a"),
      requestCursor: null,
      tasks: [task("task-a", 1)],
      nextCursor: null,
    });
    const stale = model.beginCommand(command({ commandId: "command-2" }))!;
    model.selectProject(project("project-b"));
    expect(
      model.acceptCommand(stale, {
        sharedProjectId: project("project-a"),
        commandId: "command-2",
        task: task("task-a", 2),
      }),
    ).toBe(false);
  });

  it("rejects cursor cycles, replayed page tickets, and out-of-chain cursors", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    expect(model.beginPage("invented")).toBeNull();
    expect(model.snapshot().pageState).toBe("error");

    const first = model.beginPage(null)!;
    expect(
      model.acceptPage(first, {
        sharedProjectId: project("project-a"),
        requestCursor: null,
        tasks: [task("task-a", 1)],
        nextCursor: "next-a",
      }),
    ).toBe(true);
    expect(
      model.acceptPage(first, {
        sharedProjectId: project("project-a"),
        requestCursor: null,
        tasks: [task("task-replay", 1)],
        nextCursor: null,
      }),
    ).toBe(false);

    const second = model.beginPage("next-a")!;
    model.acceptPage(second, {
      sharedProjectId: project("project-a"),
      requestCursor: "next-a",
      tasks: [],
      nextCursor: "next-a",
    });
    expect(model.snapshot().pageState).toBe("error");
  });

  it("defensively copies tasks and rejects regressing immutable task authority", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    const mutable = task("task-a", 2);
    seed(model, [mutable]);

    (mutable as { title: string }).title = "Changed after acceptance";
    expect(model.snapshot().tasks[0]?.title).toBe("Task task-a");
    expect(Object.isFrozen(model.snapshot().tasks[0])).toBe(true);
    expect(Object.isFrozen(model.snapshot().tasks[0]?.dependencies)).toBe(true);

    const page = model.beginPage(null)!;
    model.acceptPage(page, {
      sharedProjectId: project("project-a"),
      requestCursor: null,
      tasks: [task("task-a", 3, { title: "Hostile replacement" })],
      nextCursor: null,
    });
    expect(model.snapshot().tasks[0]?.revision).toBe(2);
    expect(model.snapshot().revisionConflicts.has("task-a")).toBe(true);
  });

  it("serializes each task command attempt and ignores replayed tickets", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    seed(model, [task("task-a", 1)]);
    const first = model.beginCommand(command())!;
    expect(model.beginCommand(command({ commandId: "command-other" }))).toBeNull();
    model.rejectCommand(first, { kind: "retry", message: "Retry safely." });

    const retry = model.snapshot().commandByTaskId.get("task-a");
    if (retry?.kind !== "retry") throw new Error("expected retry state");
    const second = model.beginCommand(retry.request)!;
    expect(
      model.acceptCommand(first, {
        sharedProjectId: project("project-a"),
        commandId: "command-1",
        task: task("task-a", 2),
      }),
    ).toBe(false);
    expect(
      model.acceptCommand(second, {
        sharedProjectId: project("project-a"),
        commandId: "command-1",
        task: task("task-a", 2),
      }),
    ).toBe(true);
    expect(model.snapshot().tasks[0]?.revision).toBe(2);
  });

  it("requires the exact next revision in a command acknowledgement", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    seed(model, [task("task-a", 1)]);
    const ticket = model.beginCommand(command())!;
    model.acceptCommand(ticket, {
      sharedProjectId: project("project-a"),
      commandId: "command-1",
      task: task("task-a", 3),
    });
    expect(model.snapshot().tasks[0]?.revision).toBe(1);
    expect(model.snapshot().commandByTaskId.get("task-a")?.kind).toBe("conflict");
  });

  it("can reactivate after lifecycle cleanup without accepting stale work", () => {
    const model = new SharedTaskAgentCoordinationModel(project("project-a"));
    const stale = model.beginPage(null)!;
    model.dispose();
    model.activate();
    expect(
      model.acceptPage(stale, {
        sharedProjectId: project("project-a"),
        requestCursor: null,
        tasks: [task("task-stale", 1)],
        nextCursor: null,
      }),
    ).toBe(false);
    expect(model.beginPage(null)).not.toBeNull();
  });

  it("classifies hostile thrown values without invoking an unhandled getter", () => {
    const hostile = new Proxy(
      {},
      {
        has: () => {
          throw new Error("hostile proxy");
        },
      },
    );
    expect(classifySharedTaskClientError(hostile)).toEqual({
      kind: "retry",
      message: "No acknowledgement was received. Retry sends the same ID.",
    });
  });
});
