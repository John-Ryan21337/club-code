import {
  DEFAULT_CLIENT_SETTINGS,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  type AgentBrowserSessionContext,
  type ClientSettingsPatch,
  type ProviderSession,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Semaphore from "effect/Semaphore";
import { describe, expect, it, vi } from "vitest";
import { makeAgentBrowserRpc } from "./agentBrowserRpc.ts";

const threadId = ThreadId.make("browser-thread");
const providerInstanceId = ProviderInstanceId.make("codex");
const context = { tabId: "tab", origin: "https://example.test", defaultAccess: true };
const grant = { ...context, threadId, providerInstanceId, durationSeconds: 60 };
const inactive = { status: "inactive" as const, reason: "Test" };
const session: ProviderSession = {
  threadId,
  providerInstanceId,
  provider: ProviderDriverKind.make("codex"),
  status: "ready",
  runtimeMode: "full-access",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const harness = (owner = true, secureTransport = true) =>
  Effect.gen(function* () {
    let settings = DEFAULT_CLIENT_SETTINGS;
    const poll = vi.fn((_input: AgentBrowserSessionContext) =>
      Effect.succeed({ grant: inactive, request: null }),
    );
    const revoke = vi.fn(() => Effect.succeed(inactive));
    const grantBrowser = vi.fn(() => Effect.succeed(inactive));
    const listSessions = vi.fn(() => Effect.succeed([session]));
    const updateSettings = vi.fn((patch: ClientSettingsPatch) =>
      Effect.sync(() => (settings = { ...settings, ...patch })),
    );
    const rpc = makeAgentBrowserRpc({
      owner,
      secureTransport,
      semaphore: yield* Semaphore.make(1),
      settingsPath: "test-settings.json",
      provider: {
        pollAgentBrowser: poll,
        revokeAgentBrowser: revoke,
        grantAgentBrowser: grantBrowser,
        listSessions,
      },
      settings: { getSettings: Effect.sync(() => settings), updateSettings },
    });
    return { rpc, poll, revoke, grantBrowser, listSessions, updateSettings };
  });

describe("Agent Browser RPC ownership", () => {
  it.each([
    [false, true],
    [true, false],
  ])("denies owner=%s secure=%s before calling the provider", async (owner, secure) => {
    const h = await Effect.runPromise(harness(owner, secure));
    await expect(Effect.runPromise(h.rpc.poll(context))).rejects.toThrow(
      "Agent Browser request failed",
    );
    await expect(Effect.runPromise(h.rpc.grant(grant))).rejects.toThrow();
    expect(h.poll).not.toHaveBeenCalled();
    expect(h.listSessions).not.toHaveBeenCalled();
  });

  it("takes disabled threads from durable settings and requires the exact live provider", async () => {
    const h = await Effect.runPromise(harness());
    await Effect.runPromise(h.rpc.updateSettings({ agentBrowserDisabledThreadIds: [threadId] }));
    expect(h.revoke).toHaveBeenCalledWith({ reason: "operator", threadId });
    await Effect.runPromise(h.rpc.poll({ ...context, disabledThreadIds: [] }));
    expect(h.poll).toHaveBeenLastCalledWith({ ...context, disabledThreadIds: [threadId] });
    await expect(Effect.runPromise(h.rpc.grant(grant))).rejects.toThrow();
    expect(h.grantBrowser).not.toHaveBeenCalled();
    await Effect.runPromise(h.rpc.updateSettings({ agentBrowserDisabledThreadIds: [] }));
    await expect(
      Effect.runPromise(
        h.rpc.grant({ ...grant, providerInstanceId: ProviderInstanceId.make("other") }),
      ),
    ).rejects.toThrow();
    expect(h.grantBrowser).not.toHaveBeenCalled();
    await Effect.runPromise(h.rpc.grant(grant));
    expect(h.grantBrowser).toHaveBeenCalledOnce();
  });

  it("does not let a non-owner persist a browser access change", async () => {
    const h = await Effect.runPromise(harness(false));
    await expect(
      Effect.runPromise(h.rpc.updateSettings({ agentBrowserDisabledThreadIds: [] })),
    ).rejects.toThrow("Only the Cafe owner");
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("orders a durable deny after an older poll and makes the next poll observe the deny", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          h.poll.mockImplementationOnce(() =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ grant: inactive, request: null }),
            ),
          );
          const polling = yield* h.rpc.poll(context).pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          const denying = yield* h.rpc
            .updateSettings({ agentBrowserDisabledThreadIds: [threadId] })
            .pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          expect(h.updateSettings).not.toHaveBeenCalled();
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(polling);
          yield* Fiber.join(denying);
          expect(h.revoke).toHaveBeenCalledOnce();
          yield* h.rpc.poll(context);
          expect(h.poll).toHaveBeenLastCalledWith({ ...context, disabledThreadIds: [threadId] });
        }),
      ),
    );
  });
});
