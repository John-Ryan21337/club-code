import { EnvironmentId, ThreadId } from "@cafecode/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { IdleThreadGuardCoordinator } from "./IdleThreadGuardCoordinator";
import {
  __resetIdleThreadGuardForTests,
  claimIdleThreadGuardRequest,
  configureIdleThreadGuard,
  readIdleThreadGuardConfig,
  settleIdleThreadGuardRequest,
} from "../idleThreadGuard";

const harness = vi.hoisted(() => ({
  state: { environmentStateById: {} } as { environmentStateById: Record<string, unknown> },
  dispatch: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("../store", () => ({
  useStore: Object.assign(
    (selector: (state: typeof harness.state) => unknown) => selector(harness.state),
    { getState: () => harness.state },
  ),
}));
vi.mock("../environmentApi", () => ({
  readEnvironmentApi: () => ({ orchestration: { dispatchCommand: harness.dispatch } }),
}));
vi.mock("./chat/followUpQueuePersistence", () => ({
  createFollowUpQueuePersistence: () => ({ hasForThread: harness.queue }),
}));
const scope = {
  environmentId: EnvironmentId.make("guard-environment"),
  threadId: ThreadId.make("guard-thread"),
};
const start = Date.parse("2026-09-12T00:00:00.000Z");
function runningState(
  overrides: {
    archived?: boolean;
    approval?: boolean;
    input?: boolean;
    plan?: boolean;
    ready?: boolean;
    error?: boolean;
    activity?: number;
  } = {},
) {
  const updatedAt = new Date(overrides.activity ?? start).toISOString();
  const session = {
    status: overrides.ready ? "ready" : "running",
    activeTurnId: overrides.ready ? null : "guard-turn",
    updatedAt,
  };
  const latestTurn = {
    state: overrides.ready ? "completed" : "running",
    startedAt: new Date(start).toISOString(),
    requestedAt: new Date(start).toISOString(),
  };
  harness.state = {
    environmentStateById: {
      [scope.environmentId]: {
        bootstrapComplete: true,
        threadShellById: {
          [scope.threadId]: {
            updatedAt,
            archivedAt: overrides.archived ? updatedAt : null,
            error: overrides.error ? "synthetic thread error" : null,
          },
        },
        sidebarThreadSummaryById: {
          [scope.threadId]: {
            updatedAt,
            session,
            latestTurn,
            hasPendingApprovals: overrides.approval,
            hasPendingUserInput: overrides.input,
            hasActionableProposedPlan: overrides.plan,
          },
        },
        threadSessionById: { [scope.threadId]: session },
        threadTurnStateById: { [scope.threadId]: { latestTurn } },
      },
    },
  };
}
beforeEach(() => {
  __resetIdleThreadGuardForTests();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(start);
  harness.dispatch.mockReset().mockResolvedValue(undefined);
  harness.queue.mockReset().mockReturnValue({ ok: true, value: false });
  runningState();
});
afterEach(() => vi.useRealTimers());
async function arm() {
  await configureIdleThreadGuard(scope, {
    enabled: true,
    idleHours: 1,
    prompt: "Synthetic status request",
  });
  vi.setSystemTime(start + 2 * 3_600_000);
}

it("persists the one-shot barrier before dispatch and requires later activity plus another idle period", async () => {
  await arm();
  harness.dispatch.mockImplementation(async () => {
    expect(readIdleThreadGuardConfig(scope)?.awaitingActivityAfterDispatchAt).not.toBeNull();
  });
  const screen = await render(<IdleThreadGuardCoordinator />);
  await expect.poll(() => harness.dispatch.mock.calls.length).toBe(1);
  expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
    type: "thread.turn.steer",
    threadId: scope.threadId,
    message: { role: "user", text: "Synthetic status request", attachments: [] },
  });
  expect(harness.queue).toHaveBeenCalledWith(expect.objectContaining(scope));
  await vi.advanceTimersByTimeAsync(2 * 3_600_000);
  expect(harness.dispatch).toHaveBeenCalledTimes(1);
  runningState({ activity: Date.now() });
  await screen.rerender(<IdleThreadGuardCoordinator />);
  await expect
    .poll(() => readIdleThreadGuardConfig(scope)?.awaitingActivityAfterDispatchAt)
    .toBeNull();
  // The deadline can fall between the coordinator's one-minute reconciliation ticks.
  await vi.advanceTimersByTimeAsync(3_600_000 + 60_000);
  await expect.poll(() => harness.dispatch.mock.calls.length).toBe(2);
});

it("does not treat its own pre-acknowledgement projection as new provider activity", async () => {
  await arm();
  let acknowledge!: () => void;
  harness.dispatch.mockReturnValue(
    new Promise<void>((resolve) => {
      acknowledge = resolve;
    }),
  );
  const screen = await render(<IdleThreadGuardCoordinator />);
  await expect.poll(() => harness.dispatch.mock.calls.length).toBe(1);
  vi.setSystemTime(Date.now() + 1_000);
  runningState({ activity: Date.now() });
  await screen.rerender(<IdleThreadGuardCoordinator />);
  vi.setSystemTime(Date.now() + 1_000);
  acknowledge();
  await expect
    .poll(() => readIdleThreadGuardConfig(scope)?.awaitingActivityAfterDispatchAt)
    .toBe(new Date(Date.now()).toISOString());
  await vi.advanceTimersByTimeAsync(3 * 3_600_000);
  expect(harness.dispatch).toHaveBeenCalledTimes(1);
});

it("keeps an unacknowledged request behind its persisted barrier across remount", async () => {
  await arm();
  harness.dispatch.mockRejectedValue(new Error("private synthetic transport detail"));
  const screen = await render(<IdleThreadGuardCoordinator />);
  await expect
    .poll(() => readIdleThreadGuardConfig(scope)?.lastError)
    .toContain("not acknowledged");
  expect(readIdleThreadGuardConfig(scope)?.lastError).not.toContain("private synthetic");
  await screen.unmount();
  __resetIdleThreadGuardForTests();
  vi.setSystemTime(Date.now() + 24 * 3_600_000);
  await render(<IdleThreadGuardCoordinator />);
  expect(harness.dispatch).toHaveBeenCalledTimes(1);
});

it("pauses a synchronous transport failure without exposing its details", async () => {
  await arm();
  harness.dispatch.mockImplementation(() => {
    throw new Error("private synthetic synchronous failure");
  });
  await render(<IdleThreadGuardCoordinator />);
  await expect
    .poll(() => readIdleThreadGuardConfig(scope)?.lastError)
    .toContain("not acknowledged");
  expect(readIdleThreadGuardConfig(scope)?.lastError).not.toContain("private synthetic");
  expect(readIdleThreadGuardConfig(scope)?.awaitingAcknowledgement).toBe(true);
  await vi.advanceTimersByTimeAsync(24 * 3_600_000);
  expect(harness.dispatch).toHaveBeenCalledTimes(1);
});

it.each(["archived", "approval", "input", "plan", "ready", "error"] as const)(
  "does not dispatch when the thread is %s",
  async (condition) => {
    await arm();
    runningState({ [condition]: true });
    await render(<IdleThreadGuardCoordinator />);
    expect(harness.dispatch).not.toHaveBeenCalled();
  },
);

it.each([
  { ok: true, value: true },
  { ok: false, error: "synthetic unavailable queue" },
])("does not bypass pending/claimed follow-ups or an unreadable queue: %j", async (result) => {
  await arm();
  harness.queue.mockReturnValue(result);
  await render(<IdleThreadGuardCoordinator />);
  expect(harness.dispatch).not.toHaveBeenCalled();
});

it("stays off by default", async () => {
  vi.setSystemTime(start + 24 * 3_600_000);
  await render(<IdleThreadGuardCoordinator />);
  expect(harness.dispatch).not.toHaveBeenCalled();
});

it("serializes concurrent coordinators and keeps own activity behind the unacknowledged claim", async () => {
  await arm();
  let acknowledge!: () => void;
  harness.dispatch.mockReturnValue(
    new Promise<void>((resolve) => {
      acknowledge = resolve;
    }),
  );
  const screen = await render(
    <>
      <IdleThreadGuardCoordinator />
      <IdleThreadGuardCoordinator />
    </>,
  );
  await expect.poll(() => harness.dispatch.mock.calls.length).toBe(1);
  vi.setSystemTime(Date.now() + 1_000);
  runningState({ activity: Date.now() });
  await screen.rerender(
    <>
      <IdleThreadGuardCoordinator />
      <IdleThreadGuardCoordinator />
    </>,
  );
  await vi.advanceTimersByTimeAsync(2 * 3_600_000);
  expect(harness.dispatch).toHaveBeenCalledTimes(1);
  expect(readIdleThreadGuardConfig(scope)?.awaitingAcknowledgement).toBe(true);
  acknowledge();
  await expect.poll(() => readIdleThreadGuardConfig(scope)?.awaitingAcknowledgement).toBe(false);
  await vi.advanceTimersByTimeAsync(2 * 3_600_000);
  expect(harness.dispatch).toHaveBeenCalledTimes(1);
});

it("does not dispatch when the claim cannot be persisted", async () => {
  await arm();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("synthetic full storage");
  });
  try {
    await render(<IdleThreadGuardCoordinator />);
    await expect.poll(() => write.mock.calls.length).toBeGreaterThan(0);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(readIdleThreadGuardConfig(scope)?.awaitingActivityAfterDispatchAt).toBeNull();
  } finally {
    write.mockRestore();
  }
});

it("does not settle a newer request with an old acknowledgement at the same wall-clock time", async () => {
  await arm();
  const oldClaim = await claimIdleThreadGuardRequest(scope, () => new Date(start).toISOString());
  expect(oldClaim).not.toBeNull();
  // A user can resave after an uncertain request, and the system clock can move back.
  vi.setSystemTime(start);
  await arm();
  const newClaim = await claimIdleThreadGuardRequest(scope, () => new Date(start).toISOString());
  expect(newClaim).not.toBeNull();
  expect(newClaim!.dispatchedAt).toBe(oldClaim!.dispatchedAt);
  expect(newClaim!.requestId).not.toBe(oldClaim!.requestId);
  await settleIdleThreadGuardRequest(
    scope,
    oldClaim!.requestId,
    oldClaim!.dispatchedAt,
    new Date(Date.now() + 1_000).toISOString(),
  );
  expect(readIdleThreadGuardConfig(scope)?.awaitingAcknowledgement).toBe(true);
  expect(readIdleThreadGuardConfig(scope)?.awaitingRequestId).toBe(newClaim!.requestId);
  await settleIdleThreadGuardRequest(
    scope,
    newClaim!.requestId,
    newClaim!.dispatchedAt,
    new Date(Date.now() + 1_000).toISOString(),
  );
  expect(readIdleThreadGuardConfig(scope)?.awaitingAcknowledgement).toBe(false);
});

it.each(["unmount", "disable", "queue", "activity"] as const)(
  "rechecks %s after claiming and before starting a paid command",
  async (change) => {
    await arm();
    const request = navigator.locks.request.bind(navigator.locks);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let waiting = false;
    let finished = false;
    const spy = vi.spyOn(navigator.locks, "request").mockImplementation((async (
      name,
      options,
      callback,
    ) => {
      calls += 1;
      if (calls === 2) {
        waiting = true;
        await gate;
        try {
          return await request(name, options, callback);
        } finally {
          finished = true;
        }
      }
      return request(name, options, callback);
    }) as typeof navigator.locks.request);
    try {
      const screen = await render(<IdleThreadGuardCoordinator />);
      await expect.poll(() => waiting).toBe(true);
      expect(readIdleThreadGuardConfig(scope)?.awaitingRequestId).not.toBeNull();
      if (change === "unmount") await screen.unmount();
      if (change === "disable")
        await configureIdleThreadGuard(scope, {
          enabled: false,
          idleHours: 1,
          prompt: "Synthetic status request",
        });
      if (change === "queue") harness.queue.mockReturnValue({ ok: true, value: true });
      if (change === "activity") runningState({ activity: Date.now() });
      release();
      await expect.poll(() => finished).toBe(true);
      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(readIdleThreadGuardConfig(scope)?.awaitingAcknowledgement).toBe(false);
      expect(readIdleThreadGuardConfig(scope)?.awaitingRequestId).toBeNull();
    } finally {
      release();
      spy.mockRestore();
    }
  },
);
