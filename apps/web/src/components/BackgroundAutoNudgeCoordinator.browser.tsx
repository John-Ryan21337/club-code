import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { StrictMode } from "react";

interface TestAutoNudgeSummary {
  authorityRevision: number;
  mode: "off" | "steady-progress" | "hardcore-fanout";
  backgroundContinuation: boolean;
  maxRounds: number;
  maxMinutes: number;
  armedAt: string | null;
  baselineSettledTurnId: string | null;
  lastDispatchedSettledTurnId: string | null;
  roundsDispatched: number;
  lastDispatchedAt: string | null;
}

interface TestLatestTurn {
  state: "completed";
  turnId: string;
  completedAt: string;
}

interface TestEnvironmentState {
  bootstrapComplete: boolean;
  threadIds: string[];
  threadShellById: Record<
    string,
    {
      id: string;
      environmentId: string;
      projectId: string;
      archivedAt: string | null;
      error: string | null;
      manualFollowUpCount: number;
      modelSelection: { instanceId: string; model: string };
      autoNudge: TestAutoNudgeSummary;
    }
  >;
  sidebarThreadSummaryById: Record<
    string,
    {
      session: TestSession;
      latestTurn: TestLatestTurn | null;
      hasPendingApprovals: boolean;
      hasPendingUserInput: boolean;
      hasActionableProposedPlan: boolean;
    }
  >;
  threadSessionById: Record<string, TestSession>;
  threadTurnStateById: Record<string, { latestTurn: TestLatestTurn | null }>;
}

interface TestSession {
  status: "ready";
  provider: "claude";
  providerInstanceId: string;
}

interface TestServerConfig {
  providers: Array<{
    instanceId: string;
    status: "ready";
    enabled: boolean;
    installed: boolean;
    availability: "available";
    auth: { status: "authenticated" };
  }>;
}

interface TestThreadFixture {
  readonly shell: TestEnvironmentState["threadShellById"][string];
  readonly summary: TestEnvironmentState["sidebarThreadSummaryById"][string];
  readonly session: TestSession;
  readonly turnState: TestEnvironmentState["threadTurnStateById"][string];
}

interface TestEnvironmentApi {
  orchestration: {
    dispatchCommand: ReturnType<typeof vi.fn>;
  };
}

const mocks = vi.hoisted(() => ({
  globallySuppressed: false,
  executionBlocked: false,
  commandId: 0,
  messageId: 0,
  primaryEnvironmentId: "environment-a",
  environmentStateById: {} as Record<string, TestEnvironmentState>,
  apiByEnvironmentId: new Map<string, TestEnvironmentApi>(),
  savedRuntimeById: {} as Record<string, { serverConfig: TestServerConfig | null }>,
  serverConfig: null as TestServerConfig | null,
  confirmExecutionAuthorized: vi.fn(),
  synchronizeSuppressionFromStorage: vi.fn(),
  getSuppressedSnapshot: vi.fn(),
}));

vi.mock("../autoNudger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../autoNudger")>();
  return {
    ...actual,
    AUTO_NUDGE_DELAY_MS: 20,
  };
});

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({
      getComposerDraft: () => null,
    }),
  },
}));

vi.mock("../confirmedAutoNudgeArming", () => ({
  useAutoNudgeSuppressedState: () => mocks.globallySuppressed,
  getConfirmedAutoNudgeArming: () => ({
    synchronizeSuppressionFromStorage: mocks.synchronizeSuppressionFromStorage,
    confirmExecutionAuthorized: mocks.confirmExecutionAuthorized,
    getSuppressedSnapshot: mocks.getSuppressedSnapshot,
  }),
}));

vi.mock("../environmentApi", () => ({
  readEnvironmentApi: (environmentId: string) => mocks.apiByEnvironmentId.get(environmentId),
}));

vi.mock("../environments/runtime", () => ({
  useSavedEnvironmentRuntimeStore: <T,>(
    selector: (state: { byId: Record<string, { serverConfig: TestServerConfig | null }> }) => T,
  ) => selector({ byId: mocks.savedRuntimeById }),
  getSavedEnvironmentRuntimeState: (environmentId: string) =>
    mocks.savedRuntimeById[environmentId] ?? { serverConfig: null },
}));

vi.mock("../environments/primary", () => ({
  readPrimaryEnvironmentDescriptor: () => ({
    environmentId: mocks.primaryEnvironmentId,
  }),
}));

vi.mock("../lib/utils", () => ({
  newCommandId: () => `command-${++mocks.commandId}`,
  newMessageId: () => `message-${++mocks.messageId}`,
}));

vi.mock("../rpc/serverState", () => ({
  getServerConfig: () => mocks.serverConfig,
  useServerConfig: () => mocks.serverConfig,
}));

vi.mock("../store", () => {
  const getState = () => ({ environmentStateById: mocks.environmentStateById });
  const useStore = Object.assign(
    <T,>(selector: (state: { environmentStateById: Record<string, TestEnvironmentState> }) => T) =>
      selector(getState()),
    { getState },
  );
  return { useStore };
});

import { __resetAutoNudgeTurnLedgerForTests } from "../autoNudger";
import { manualFollowUpPriorityStore } from "../manualFollowUpPriorityStore";
import { BackgroundAutoNudgeCoordinator } from "./BackgroundAutoNudgeCoordinator";

const READY_SERVER_CONFIG: TestServerConfig = {
  providers: [
    {
      instanceId: "claude",
      status: "ready",
      enabled: true,
      installed: true,
      availability: "available",
      auth: { status: "authenticated" },
    },
  ],
};

function autoNudgeSummary(overrides: Partial<TestAutoNudgeSummary> = {}): TestAutoNudgeSummary {
  return {
    authorityRevision: 1,
    mode: "steady-progress",
    backgroundContinuation: true,
    maxRounds: 10,
    maxMinutes: 60,
    armedAt: new Date().toISOString(),
    baselineSettledTurnId: "baseline-turn",
    lastDispatchedSettledTurnId: null,
    roundsDispatched: 0,
    lastDispatchedAt: null,
    ...overrides,
  };
}

function threadFixture(input: {
  environmentId: string;
  threadId: string;
  projectId?: string;
  completedTurnId: string;
  manualFollowUpCount?: number;
  autoNudge?: Partial<TestAutoNudgeSummary>;
}): TestThreadFixture {
  const session: TestSession = {
    status: "ready",
    provider: "claude",
    providerInstanceId: "claude",
  };
  const latestTurn: TestLatestTurn = {
    state: "completed",
    turnId: input.completedTurnId,
    completedAt: new Date().toISOString(),
  };
  return {
    shell: {
      id: input.threadId,
      environmentId: input.environmentId,
      projectId: input.projectId ?? "project-shared",
      archivedAt: null,
      error: null,
      manualFollowUpCount: input.manualFollowUpCount ?? 0,
      modelSelection: { instanceId: "claude", model: "claude-sonnet" },
      autoNudge: autoNudgeSummary(input.autoNudge),
    },
    summary: {
      session,
      latestTurn,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    },
    session,
    turnState: { latestTurn },
  };
}

function environmentFixture(
  environmentId: string,
  threads: ReadonlyArray<TestThreadFixture>,
): TestEnvironmentState {
  return {
    bootstrapComplete: true,
    threadIds: threads.map((thread) => thread.shell.id),
    threadShellById: Object.fromEntries(threads.map((thread) => [thread.shell.id, thread.shell])),
    sidebarThreadSummaryById: Object.fromEntries(
      threads.map((thread) => [thread.shell.id, thread.summary]),
    ),
    threadSessionById: Object.fromEntries(
      threads.map((thread) => [thread.shell.id, thread.session]),
    ),
    threadTurnStateById: Object.fromEntries(
      threads.map((thread) => [thread.shell.id, thread.turnState]),
    ),
  };
}

function installEnvironmentApi(
  environmentId: string,
  implementation: (...args: unknown[]) => Promise<unknown> = () => Promise.resolve(undefined),
): ReturnType<typeof vi.fn> {
  const dispatchCommand = vi.fn(implementation);
  mocks.apiByEnvironmentId.set(environmentId, {
    orchestration: { dispatchCommand },
  });
  return dispatchCommand;
}

function commands(dispatchCommand: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return dispatchCommand.mock.calls.map(
    (call) => (call as unknown[])[0] as Record<string, unknown>,
  );
}

async function waitForCalls(
  dispatchCommand: ReturnType<typeof vi.fn>,
  count: number,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(dispatchCommand).toHaveBeenCalledTimes(count);
    },
    { timeout: 2_000 },
  );
}

beforeEach(() => {
  mocks.globallySuppressed = false;
  mocks.executionBlocked = false;
  mocks.commandId = 0;
  mocks.messageId = 0;
  mocks.primaryEnvironmentId = "environment-a";
  mocks.environmentStateById = {};
  mocks.apiByEnvironmentId.clear();
  mocks.savedRuntimeById = {};
  mocks.serverConfig = READY_SERVER_CONFIG;
  mocks.confirmExecutionAuthorized.mockReset();
  mocks.confirmExecutionAuthorized.mockImplementation(
    () => !mocks.executionBlocked && !mocks.globallySuppressed,
  );
  mocks.synchronizeSuppressionFromStorage.mockReset();
  mocks.getSuppressedSnapshot.mockReset();
  mocks.getSuppressedSnapshot.mockImplementation(
    () => mocks.executionBlocked || mocks.globallySuppressed,
  );
  __resetAutoNudgeTurnLedgerForTests({ clearSessionStorage: true });
});

afterEach(async () => {
  await cleanup();
  __resetAutoNudgeTurnLedgerForTests({ clearSessionStorage: true });
});

describe("BackgroundAutoNudgeCoordinator exact-thread authority", () => {
  it("survives the app's StrictMode setup-cleanup replay without duplicating authority", async () => {
    const dispatch = installEnvironmentApi("environment-a");
    const completedTurn = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-strict",
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [completedTurn]),
    };

    await render(
      <StrictMode>
        <BackgroundAutoNudgeCoordinator />
      </StrictMode>,
    );
    await waitForCalls(dispatch, 1);
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("never turns elapsed idle time into authority and dispatches once per new completed turn", async () => {
    const dispatch = installEnvironmentApi("environment-a");
    const withoutTerminal = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-placeholder",
    });
    const noCompletedTurn = {
      ...withoutTerminal,
      summary: { ...withoutTerminal.summary, latestTurn: null },
      turnState: { latestTurn: null },
    };
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [noCompletedTurn]),
    };

    const mounted = await render(<BackgroundAutoNudgeCoordinator />);
    // Cross many former polling windows and safety-debounce windows. Wall-clock
    // passage without provider-confirmed terminal evidence must remain inert.
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    expect(dispatch).not.toHaveBeenCalled();

    const firstCompletedTurn = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [firstCompletedTurn]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    // A replay of the same projection event cannot arm a second debounce.
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [firstCompletedTurn]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 1);

    // Time and another replay do not create another send for the same terminal.
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [firstCompletedTurn]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);

    const nextCompletedTurn = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-b",
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [nextCompletedTurn]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 2);

    // Even a regressed/replayed projection cannot re-arm an older authority.
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [firstCompletedTurn]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(commands(dispatch).map((command) => command.completedTurnId)).toEqual([
      "turn-a",
      "turn-b",
    ]);
  });

  it("always yields exact-thread authority to queued operator follow-ups", async () => {
    const owner = {};
    const dispatchA = installEnvironmentApi("environment-a");
    const dispatchB = installEnvironmentApi("environment-b");
    mocks.savedRuntimeById = {
      "environment-b": { serverConfig: READY_SERVER_CONFIG },
    };
    const queuedThread = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-shared",
      completedTurnId: "turn-a",
    });
    const sameIdOtherEnvironment = threadFixture({
      environmentId: "environment-b",
      threadId: "thread-shared",
      completedTurnId: "turn-b",
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [queuedThread]),
      "environment-b": environmentFixture("environment-b", [sameIdOtherEnvironment]),
    };

    try {
      const mounted = await render(<BackgroundAutoNudgeCoordinator />);
      // Let both exact-thread authorities begin their one-shot delay, then
      // publish an operator follow-up before its callback. The terminal event
      // is consumed rather than merely paused.
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      manualFollowUpPriorityStore.replace(owner, [
        { environmentId: "environment-a", threadId: "thread-shared" },
      ]);
      await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
      await waitForCalls(dispatchB, 1);
      await new Promise((resolve) => window.setTimeout(resolve, 100));

      expect(dispatchA).not.toHaveBeenCalled();
      expect(commands(dispatchB)[0]).toEqual(
        expect.objectContaining({
          type: "thread.auto-nudge.dispatch",
          threadId: "thread-shared",
          completedTurnId: "turn-b",
        }),
      );

      manualFollowUpPriorityStore.replace(owner, []);
      await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect(dispatchA).not.toHaveBeenCalled();

      const nextQueuedThreadTerminal = threadFixture({
        environmentId: "environment-a",
        threadId: "thread-shared",
        completedTurnId: "turn-a-next",
      });
      mocks.environmentStateById = {
        "environment-a": environmentFixture("environment-a", [nextQueuedThreadTerminal]),
        "environment-b": environmentFixture("environment-b", [sameIdOtherEnvironment]),
      };
      await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
      await waitForCalls(dispatchA, 1);
      expect(commands(dispatchA)[0]).toEqual(
        expect.objectContaining({
          type: "thread.auto-nudge.dispatch",
          threadId: "thread-shared",
          completedTurnId: "turn-a-next",
        }),
      );
    } finally {
      manualFollowUpPriorityStore.release(owner);
    }
  });

  it("consumes a newly projected durable manual queue instead of reviving its terminal", async () => {
    const dispatch = installEnvironmentApi("environment-a");
    const terminal = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [terminal]),
    };

    const mounted = await render(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    const queued = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
      manualFollowUpCount: 1,
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [queued]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(dispatch).not.toHaveBeenCalled();

    // Clearing the queue cannot turn its old terminal back into authority.
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [terminal]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(dispatch).not.toHaveBeenCalled();

    const nextTerminal = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-b",
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [nextTerminal]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 1);
    expect(commands(dispatch)[0]?.completedTurnId).toBe("turn-b");
  });

  it("dispatches two same-project threads independently and never sends the prompt", async () => {
    const dispatch = installEnvironmentApi("environment-a");
    const threadA = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
      autoNudge: { authorityRevision: 11 },
    });
    const threadB = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-b",
      completedTurnId: "turn-b",
      autoNudge: { authorityRevision: 22, mode: "hardcore-fanout" },
    });
    const offSibling = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-off",
      completedTurnId: "turn-off",
      autoNudge: {
        authorityRevision: 33,
        mode: "off",
        backgroundContinuation: false,
        armedAt: null,
      },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [threadA, threadB, offSibling]),
    };

    await render(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 2);

    const dispatched = commands(dispatch);
    expect(dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "thread.auto-nudge.dispatch",
          threadId: "thread-a",
          expectedAuthorityRevision: 11,
          completedTurnId: "turn-a",
          dispatchSource: "background",
        }),
        expect.objectContaining({
          type: "thread.auto-nudge.dispatch",
          threadId: "thread-b",
          expectedAuthorityRevision: 22,
          completedTurnId: "turn-b",
          dispatchSource: "background",
        }),
      ]),
    );
    expect(dispatched.some((command) => command.threadId === "thread-off")).toBe(false);
    expect(dispatched.every((command) => !Object.hasOwn(command, "prompt"))).toBe(true);
    expect(JSON.stringify(dispatched)).not.toContain("Keep a few lanes");
    expect(JSON.stringify(dispatched)).not.toContain("Fan out");
  });

  it("issues exact Stop commands through each environment and retries unavailable routes", async () => {
    mocks.globallySuppressed = true;
    const dispatchA = installEnvironmentApi("environment-a");
    const dispatchC = installEnvironmentApi(
      "environment-c",
      (() => {
        let attempt = 0;
        return () => {
          attempt += 1;
          return attempt === 1
            ? Promise.reject(new Error("connection dropped"))
            : Promise.resolve(undefined);
        };
      })(),
    );
    const enabledA = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
      autoNudge: { authorityRevision: 4 },
    });
    const enabledB = threadFixture({
      environmentId: "environment-b",
      threadId: "thread-b",
      completedTurnId: "turn-b",
      autoNudge: { authorityRevision: 5 },
    });
    const enabledC = threadFixture({
      environmentId: "environment-c",
      threadId: "thread-c",
      completedTurnId: "turn-c",
      autoNudge: { authorityRevision: 6 },
    });
    const offB = threadFixture({
      environmentId: "environment-b",
      threadId: "thread-off",
      completedTurnId: "turn-off",
      autoNudge: { mode: "off", backgroundContinuation: false, armedAt: null },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [enabledA]),
      "environment-b": environmentFixture("environment-b", [enabledB, offB]),
      "environment-c": environmentFixture("environment-c", [enabledC]),
    };

    const mounted = await render(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatchA, 1);
    await waitForCalls(dispatchC, 2);
    expect(commands(dispatchA)[0]).toEqual(
      expect.objectContaining({
        type: "thread.auto-nudge.stop",
        threadId: "thread-a",
      }),
    );
    expect(commands(dispatchC)).toEqual([
      expect.objectContaining({
        type: "thread.auto-nudge.stop",
        threadId: "thread-c",
      }),
      expect.objectContaining({
        type: "thread.auto-nudge.stop",
        threadId: "thread-c",
      }),
    ]);

    const dispatchB = installEnvironmentApi("environment-b");
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatchB, 1);

    expect(commands(dispatchB)).toEqual([
      expect.objectContaining({
        type: "thread.auto-nudge.stop",
        threadId: "thread-b",
      }),
    ]);
    expect(commands(dispatchB).some((command) => command.threadId === "thread-off")).toBe(false);
  });

  it("does not issue a stale Stop after storage reconciliation observes a cleared barrier", async () => {
    // Model the render/effect boundary where the hook value still reflects the
    // previous suppression snapshot but the synchronous storage reconciliation
    // has already observed an explicit clear from another renderer.
    mocks.globallySuppressed = true;
    mocks.getSuppressedSnapshot.mockReturnValue(false);
    const dispatch = installEnvironmentApi("environment-a");
    const enabledForegroundThread = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-enabled-after-clear",
      completedTurnId: "turn-after-clear",
      autoNudge: { backgroundContinuation: false },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [enabledForegroundThread]),
    };

    await render(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    expect(mocks.synchronizeSuppressionFromStorage).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reconciles a cross-port durable Stop before evaluating foreground-only authority", async () => {
    mocks.executionBlocked = true;
    const dispatch = installEnvironmentApi("environment-a");
    const foregroundOnly = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-foreground-only",
      completedTurnId: "turn-foreground-only",
      autoNudge: {
        authorityRevision: 17,
        backgroundContinuation: false,
      },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [foregroundOnly]),
    };

    await render(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 1);

    expect(mocks.synchronizeSuppressionFromStorage).toHaveBeenCalled();
    expect(commands(dispatch)).toEqual([
      expect.objectContaining({
        type: "thread.auto-nudge.stop",
        threadId: "thread-foreground-only",
      }),
    ]);
    expect(
      commands(dispatch).some((command) => command.type === "thread.auto-nudge.dispatch"),
    ).toBe(false);
  });

  it("drops delayed authority when an identically keyed route is replaced", async () => {
    const dispatchA = installEnvironmentApi("environment-a");
    const dispatchB = installEnvironmentApi("environment-b");
    mocks.savedRuntimeById = {
      "environment-b": { serverConfig: READY_SERVER_CONFIG },
    };
    const staleThread = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-shared-id",
      completedTurnId: "turn-stale",
      autoNudge: { authorityRevision: 7 },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [staleThread]),
    };

    const mounted = await render(<BackgroundAutoNudgeCoordinator />);

    const replacementThread = threadFixture({
      environmentId: "environment-b",
      threadId: "thread-shared-id",
      completedTurnId: "turn-current",
      autoNudge: { authorityRevision: 8 },
    });
    mocks.environmentStateById = {
      "environment-b": environmentFixture("environment-b", [replacementThread]),
    };
    await mounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatchB, 1);

    expect(dispatchA).not.toHaveBeenCalled();
    expect(commands(dispatchB)[0]).toEqual(
      expect.objectContaining({
        type: "thread.auto-nudge.dispatch",
        threadId: "thread-shared-id",
        expectedAuthorityRevision: 8,
        completedTurnId: "turn-current",
      }),
    );
  });

  it("keeps an uncertain dispatch consumed across remounts and authority revisions", async () => {
    const dispatch = installEnvironmentApi("environment-a", () =>
      Promise.reject(new Error("acknowledgement lost")),
    );
    const initial = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
      autoNudge: { authorityRevision: 40 },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [initial]),
    };

    const mounted = await render(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 1);
    await mounted.unmount();

    // Simulate a renderer reload: discard the in-memory singleton and reload
    // the authority key from the session-backed ledger.
    __resetAutoNudgeTurnLedgerForTests();
    const remounted = await render(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(dispatch).toHaveBeenCalledTimes(1);

    const revised = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-a",
      autoNudge: { authorityRevision: 41 },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [revised]),
    };
    await remounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(dispatch).toHaveBeenCalledTimes(1);

    const nextTerminal = threadFixture({
      environmentId: "environment-a",
      threadId: "thread-a",
      completedTurnId: "turn-b",
      autoNudge: { authorityRevision: 41 },
    });
    mocks.environmentStateById = {
      "environment-a": environmentFixture("environment-a", [nextTerminal]),
    };
    await remounted.rerender(<BackgroundAutoNudgeCoordinator />);
    await waitForCalls(dispatch, 2);

    expect(commands(dispatch).map((command) => command.completedTurnId)).toEqual([
      "turn-a",
      "turn-b",
    ]);
    expect(commands(dispatch).map((command) => command.expectedAuthorityRevision)).toEqual([
      40, 41,
    ]);
  });
});
