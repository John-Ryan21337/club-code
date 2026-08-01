import "../../index.css";

import type { CollaborationSharedTask, SharedProjectId } from "@cafecode/contracts";
import { StrictMode } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type {
  SharedTaskAgentClient,
  SharedTaskMutationRequest,
} from "../../cowork/taskAgentCoordinationModel";
import { SharedTaskAgentPanel } from "./SharedTaskAgentPanel";

const sharedProjectId = "project-a" as SharedProjectId;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const openTask = () =>
  ({
    sharedProjectId,
    taskId: "task-open",
    provenance: "operator-authored",
    title: "Review the shared schema",
    body: "Operator-authored body that is deliberately not rendered.",
    status: "open",
    ownerUserId: null,
    dependencies: ["task-foundation"],
    revision: 3,
    fencingToken: 2,
    activeAgentLease: null,
    createdByUserId: "operator-a",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }) as unknown as CollaborationSharedTask;

const leasedTask = (index: number) =>
  ({
    sharedProjectId,
    taskId: `task-agent-${index}`,
    provenance: "operator-authored",
    title: `Bounded lane ${index}`,
    body: "Operator-authored body.",
    status: "claimed",
    ownerUserId: `operator-${index}`,
    dependencies: [],
    revision: 2,
    fencingToken: 1,
    activeAgentLease: {
      leaseId: `lease-${index}`,
      agentId: `agent-${index}`,
      holderUserId: `operator-${index}`,
      holderDeviceId: `device-${index}`,
      membershipEpoch: 4,
      fencingToken: 1,
      grantedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:05:00.000Z",
    },
    createdByUserId: "operator-a",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:01:00.000Z",
  }) as unknown as CollaborationSharedTask;

describe("SharedTaskAgentPanel", () => {
  it("renders nothing and contacts nothing without an injected client", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <SharedTaskAgentPanel client={null} sharedProjectId={sharedProjectId} />,
      { container: host },
    );
    try {
      expect(host.innerHTML).toBe("");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders bounded lease truth and retries the exact command object", async () => {
    const requests: Array<SharedTaskMutationRequest> = [];
    let dispatchAttempt = 0;
    const client: SharedTaskAgentClient = {
      readPage: vi.fn(async (request) => ({
        sharedProjectId,
        requestCursor: request.cursor,
        tasks: [openTask(), ...Array.from({ length: 9 }, (_, index) => leasedTask(index))],
        nextCursor: null,
      })),
      dispatch: vi.fn(async (request) => {
        requests.push(request);
        dispatchAttempt += 1;
        if (dispatchAttempt === 1) throw new Error("indeterminate transport acknowledgement");
        return {
          sharedProjectId,
          commandId: request.commandId,
          task: {
            ...openTask(),
            status: "claimed",
            ownerUserId: "operator-a",
            revision: 4,
            fencingToken: 3,
          } as unknown as CollaborationSharedTask,
        };
      }),
    };

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <SharedTaskAgentPanel
        client={client}
        sharedProjectId={sharedProjectId}
        makeCommandId={() => "command-exact"}
      />,
      { container: host },
    );

    try {
      await expect.element(page.getByText("Review the shared schema")).toBeInTheDocument();
      await expect
        .element(page.getByText("Showing 8 of 9 recorded agent leases."))
        .toBeInTheDocument();
      expect((host.textContent ?? "").match(/Admission: not started/g)).toHaveLength(8);
      expect(host.textContent ?? "").not.toContain(
        "Operator-authored body that is deliberately not rendered.",
      );

      await page.getByRole("button", { name: "Claim task" }).click();
      await expect.element(page.getByRole("button", { name: "Retry exact command" })).toBeVisible();
      await page.getByRole("button", { name: "Retry exact command" }).click();

      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[0]).toBe(requests[1]);
      expect(requests[0]?.commandId).toBe("command-exact");
      await expect.element(page.getByText(/claimed · revision 4 · fence 3/)).toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("survives StrictMode effect replay without retaining the disposed first request", async () => {
    const client: SharedTaskAgentClient = {
      readPage: vi.fn(async (request) => ({
        sharedProjectId,
        requestCursor: request.cursor,
        tasks: [openTask()],
        nextCursor: null,
      })),
      dispatch: vi.fn(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <StrictMode>
        <SharedTaskAgentPanel client={client} sharedProjectId={sharedProjectId} />
      </StrictMode>,
      { container: host },
    );
    try {
      await expect.element(page.getByText("Review the shared schema")).toBeInTheDocument();
      expect(client.readPage).toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("drops a stale project response after a project switch", async () => {
    const projectB = "project-b" as SharedProjectId;
    const responseA = deferred<Awaited<ReturnType<SharedTaskAgentClient["readPage"]>>>();
    const responseB = deferred<Awaited<ReturnType<SharedTaskAgentClient["readPage"]>>>();
    const client: SharedTaskAgentClient = {
      readPage: vi.fn((request) =>
        request.sharedProjectId === sharedProjectId ? responseA.promise : responseB.promise,
      ),
      dispatch: vi.fn(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <SharedTaskAgentPanel client={client} sharedProjectId={sharedProjectId} />,
      { container: host },
    );
    try {
      await vi.waitFor(() => expect(client.readPage).toHaveBeenCalledTimes(1));
      await screen.rerender(<SharedTaskAgentPanel client={client} sharedProjectId={projectB} />);
      await vi.waitFor(() => expect(client.readPage).toHaveBeenCalledTimes(2));
      responseB.resolve({
        sharedProjectId: projectB,
        requestCursor: null,
        tasks: [
          {
            ...openTask(),
            sharedProjectId: projectB,
            taskId: "task-project-b",
            title: "Current project task",
          } as unknown as CollaborationSharedTask,
        ],
        nextCursor: null,
      });
      await expect.element(page.getByText("Current project task")).toBeInTheDocument();

      responseA.resolve({
        sharedProjectId,
        requestCursor: null,
        tasks: [openTask()],
        nextCursor: null,
      });
      await vi.waitFor(() => expect(host.textContent).not.toContain("Review the shared schema"));
      expect(host.textContent).toContain("Current project task");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders hostile operator text as inert text and never renders the task body", async () => {
    const hostileTitle = "<img src=x onerror=\"document.body.dataset.pwned='yes'\">";
    const client: SharedTaskAgentClient = {
      readPage: vi.fn(async (request) => ({
        sharedProjectId,
        requestCursor: request.cursor,
        tasks: [
          {
            ...openTask(),
            title: hostileTitle,
            body: "sensitive body must stay absent",
          } as unknown as CollaborationSharedTask,
        ],
        nextCursor: null,
      })),
      dispatch: vi.fn(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <SharedTaskAgentPanel client={client} sharedProjectId={sharedProjectId} />,
      { container: host },
    );
    try {
      await expect.element(page.getByText(hostileTitle)).toBeInTheDocument();
      expect(host.querySelector("img")).toBeNull();
      expect(document.body.dataset.pwned).toBeUndefined();
      expect(host.textContent).not.toContain("sensitive body must stay absent");
    } finally {
      await screen.unmount();
      host.remove();
      delete document.body.dataset.pwned;
    }
  });
});
