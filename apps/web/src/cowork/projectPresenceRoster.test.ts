import {
  CollaborationPresenceUpdate,
  SharedProjectId,
  type CollaborationPresenceCapability,
  type CollaborationPresenceState,
  type CollaborationPresenceUpdate as PresenceUpdate,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  type ProjectPresenceSubscriptionClient,
  ProjectPresenceRosterModel,
} from "./projectPresenceRoster.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeUpdate = Schema.decodeUnknownSync(CollaborationPresenceUpdate);
const PROJECT_A = decodeProjectId("presence-project-a");
const PROJECT_B = decodeProjectId("presence-project-b");

function sessionId(index: number): string {
  return `s${String(index).padStart(42, "0")}`;
}

function entry(
  index: number,
  userId = `operator-${index}`,
  state: CollaborationPresenceState = "online",
  capabilities: ReadonlyArray<CollaborationPresenceCapability> = ["operator-chat"],
) {
  return {
    sessionId: sessionId(index),
    userId,
    deviceId: `device-${index}`,
    membershipEpoch: 4,
    state,
    capabilities,
    expiresAt: "2026-08-01T12:00:45.000Z",
  };
}

function snapshot(
  project: typeof PROJECT_A,
  version: number,
  entries: ReadonlyArray<ReturnType<typeof entry>>,
): PresenceUpdate {
  return decodeUpdate({
    kind: "snapshot",
    snapshot: { sharedProjectId: project, version, entries },
  });
}

function delta(
  project: typeof PROJECT_A,
  version: number,
  upserts: ReadonlyArray<ReturnType<typeof entry>> = [],
  removedSessionIds: ReadonlyArray<string> = [],
): PresenceUpdate {
  return decodeUpdate({
    kind: "delta",
    delta: { sharedProjectId: project, version, upserts, removedSessionIds },
  });
}

interface CapturedSubscription {
  readonly input: Parameters<ProjectPresenceSubscriptionClient["subscribe"]>[0];
  readonly unsubscribe: ReturnType<typeof vi.fn>;
}

function harness() {
  const subscriptions: CapturedSubscription[] = [];
  const client: ProjectPresenceSubscriptionClient = {
    subscribe: (input) => {
      const unsubscribe = vi.fn();
      subscriptions.push({ input, unsubscribe });
      return unsubscribe;
    },
  };
  return { client, subscriptions };
}

describe("ProjectPresenceRosterModel", () => {
  it("is unreachable without an injected client", () => {
    const model = new ProjectPresenceRosterModel(null);
    const listener = vi.fn();
    const detach = model.subscribe(listener);

    model.start(PROJECT_A);

    expect(model.getSnapshot()).toEqual({
      status: "unavailable",
      version: 0,
      participants: [],
      overflowCount: 0,
    });
    expect(listener).toHaveBeenCalled();
    detach();
    model.stop();
  });

  it("requires a bounded roster limit", () => {
    expect(() => new ProjectPresenceRosterModel(null, 0)).toThrow("invalid presence roster limit");
    expect(() => new ProjectPresenceRosterModel(null, 129)).toThrow(
      "invalid presence roster limit",
    );
    expect(() => new ProjectPresenceRosterModel(null, 1.5)).toThrow(
      "invalid presence roster limit",
    );
  });

  it("collapses device sessions, orders users, and reports bounded overflow", () => {
    const { client, subscriptions } = harness();
    const model = new ProjectPresenceRosterModel(client, 2);
    model.start(PROJECT_A);
    expect(subscriptions[0]?.input).toMatchObject({
      sharedProjectId: PROJECT_A,
      rosterLimit: 2,
    });

    subscriptions[0]?.input.onUpdate(
      snapshot(PROJECT_A, 1, [
        entry(1, "operator-b", "away", ["operator-chat"]),
        entry(2, "operator-a", "offline", ["shared-context"]),
        entry(3, "operator-b", "online", ["shared-context"]),
        entry(4, "operator-c"),
      ]),
    );

    expect(model.getSnapshot()).toEqual({
      status: "ready",
      version: 1,
      participants: [
        {
          userId: "operator-a",
          state: "offline",
          capabilities: ["shared-context"],
        },
        {
          userId: "operator-b",
          state: "online",
          capabilities: ["operator-chat", "shared-context"],
        },
      ],
      overflowCount: 1,
    });
  });

  it("never consumes more than the 128-entry protocol maximum", () => {
    const { client, subscriptions } = harness();
    const model = new ProjectPresenceRosterModel(client, 128);
    model.start(PROJECT_A);
    subscriptions[0]?.input.onUpdate(
      snapshot(
        PROJECT_A,
        1,
        Array.from({ length: 128 }, (_, index) => entry(index + 1)),
      ),
    );
    expect(model.getSnapshot().participants).toHaveLength(128);
    expect(model.getSnapshot().overflowCount).toBe(0);

    subscriptions[0]?.input.onUpdate(delta(PROJECT_A, 2, [entry(129)]));
    expect(model.getSnapshot()).toEqual({
      status: "resync-required",
      version: 1,
      participants: [],
      overflowCount: 0,
    });
  });

  it("ignores duplicate and stale deltas, but requires a snapshot after a gap", () => {
    const { client, subscriptions } = harness();
    const model = new ProjectPresenceRosterModel(client);
    model.start(PROJECT_A);
    const subscription = subscriptions[0]!;

    subscription.input.onUpdate(snapshot(PROJECT_A, 1, [entry(1)]));
    subscription.input.onUpdate(delta(PROJECT_A, 2, [entry(2)]));
    subscription.input.onUpdate(delta(PROJECT_A, 2, [entry(3)]));
    expect(model.getSnapshot()).toMatchObject({ status: "ready", version: 2 });
    expect(model.getSnapshot().participants.map(({ userId }) => userId)).toEqual([
      "operator-1",
      "operator-2",
    ]);

    subscription.input.onUpdate(delta(PROJECT_A, 4, [entry(4)]));
    expect(model.getSnapshot()).toEqual({
      status: "resync-required",
      version: 2,
      participants: [],
      overflowCount: 0,
    });

    subscription.input.onUpdate(delta(PROJECT_A, 3, [entry(3)]));
    expect(model.getSnapshot().status).toBe("resync-required");
    subscription.input.onUpdate(snapshot(PROJECT_A, 4, [entry(4)]));
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      version: 4,
      participants: [{ userId: "operator-4" }],
    });
  });

  it("rejects a delta before the first authoritative snapshot", () => {
    const { client, subscriptions } = harness();
    const model = new ProjectPresenceRosterModel(client);
    model.start(PROJECT_A);

    subscriptions[0]?.input.onUpdate(delta(PROJECT_A, 1, [entry(1)]));

    expect(model.getSnapshot()).toEqual({
      status: "resync-required",
      version: 0,
      participants: [],
      overflowCount: 0,
    });
  });

  it("isolates project switches from late updates and tears down each subscription once", () => {
    const { client, subscriptions } = harness();
    const model = new ProjectPresenceRosterModel(client);
    model.start(PROJECT_A);
    const first = subscriptions[0]!;
    first.input.onUpdate(snapshot(PROJECT_A, 1, [entry(1)]));

    model.start(PROJECT_B);
    const second = subscriptions[1]!;
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().status).toBe("loading");

    first.input.onUpdate(snapshot(PROJECT_A, 9, [entry(9)]));
    first.input.onError();
    second.input.onUpdate(snapshot(PROJECT_A, 1, [entry(8)]));
    expect(model.getSnapshot().status).toBe("loading");

    second.input.onUpdate(snapshot(PROJECT_B, 1, [entry(2)]));
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      participants: [{ userId: "operator-2" }],
    });
    model.stop();
    model.stop();
    expect(second.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("clears revoked presence and rejects every callback after the transport fails", () => {
    const { client, subscriptions } = harness();
    const model = new ProjectPresenceRosterModel(client);
    model.start(PROJECT_A);
    const subscription = subscriptions[0]!;
    subscription.input.onUpdate(snapshot(PROJECT_A, 1, [entry(1)]));

    subscription.input.onError();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot()).toEqual({
      status: "unavailable",
      version: 1,
      participants: [],
      overflowCount: 0,
    });
    subscription.input.onUpdate(snapshot(PROJECT_A, 2, [entry(2)]));
    subscription.input.onError();
    expect(model.getSnapshot().version).toBe(1);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("cleans up a subscription that fails synchronously before returning", () => {
    const unsubscribe = vi.fn();
    const client: ProjectPresenceSubscriptionClient = {
      subscribe: (input) => {
        input.onError();
        return unsubscribe;
      },
    };
    const model = new ProjectPresenceRosterModel(client);

    model.start(PROJECT_A);

    expect(model.getSnapshot().status).toBe("unavailable");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the injected client throws", () => {
    const client: ProjectPresenceSubscriptionClient = {
      subscribe: () => {
        throw new Error("transport unavailable");
      },
    };
    const model = new ProjectPresenceRosterModel(client);

    expect(() => model.start(PROJECT_A)).not.toThrow();
    expect(model.getSnapshot().status).toBe("unavailable");
  });
});
