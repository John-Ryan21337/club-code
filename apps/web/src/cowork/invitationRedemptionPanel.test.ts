import { describe, expect, it, vi } from "vitest";

import {
  type CoworkInvitationRedemptionClient,
  type CoworkInvitationRedemptionIdentity,
  CoworkInvitationRedemptionPanelModel,
} from "./invitationRedemptionPanel.ts";

const IDENTITY = Object.freeze({
  sessionId: "pre-member-session",
  userId: "joining-user",
  deviceId: "joining-device",
  issuedAt: "2026-08-01T12:00:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
} satisfies CoworkInvitationRedemptionIdentity);

const INPUT = Object.freeze({
  sharedProjectId: "shared-project-one",
  secret: "A".repeat(43),
  displayName: "Joining Operator",
});

function result(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "applied",
    member: {
      userId: IDENTITY.userId,
      displayName: INPUT.displayName,
      role: "viewer",
      permissions: ["transcript.read", "chat.read", "task.read", "file.read"],
      joinedAt: "2026-08-01T12:05:00.000Z",
    },
    membershipEpoch: 4,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("CoworkInvitationRedemptionPanelModel", () => {
  it("starts with a frozen token-free state", () => {
    const client: CoworkInvitationRedemptionClient = {
      redeemInvitation: vi.fn(async () => result()),
    };
    const state = new CoworkInvitationRedemptionPanelModel(client, IDENTITY).getSnapshot();

    expect(Object.isFrozen(state)).toBe(true);
    expect(state).toEqual({ status: "idle", canSubmit: true, member: null });
    expect(JSON.stringify(state)).not.toContain(INPUT.secret);
  });

  it("submits one deeply frozen identity-bound command and accepts an exact member", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(
      async (command) => {
        expect(Object.isFrozen(command)).toBe(true);
        expect(Object.isFrozen(command.expectedIdentity)).toBe(true);
        expect(Object.isFrozen(command.request)).toBe(true);
        return result();
      },
    );
    const client = { redeemInvitation };
    const model = new CoworkInvitationRedemptionPanelModel(client, IDENTITY);

    model.redeem(INPUT, () => "redeem-command-one");
    await settle();

    expect(redeemInvitation).toHaveBeenCalledTimes(1);
    expect(redeemInvitation.mock.calls[0]![0]).toEqual({
      expectedIdentity: IDENTITY,
      request: { ...INPUT, commandId: "redeem-command-one" },
    });
    expect(model.getSnapshot()).toEqual({
      status: "succeeded",
      canSubmit: false,
      member: {
        userId: IDENTITY.userId,
        displayName: INPUT.displayName,
        role: "viewer",
        permissionCount: 4,
        joinedAt: "2026-08-01T12:05:00.000Z",
        membershipEpoch: 4,
      },
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain(INPUT.secret);
  });

  it("preserves the injected receiver", async () => {
    const observed: { receiver: unknown } = { receiver: null };
    const client: CoworkInvitationRedemptionClient = {
      redeemInvitation() {
        observed.receiver = this;
        return Promise.resolve(result());
      },
    };
    const model = new CoworkInvitationRedemptionPanelModel(client, IDENTITY);

    model.redeem(INPUT, () => "receiver-command");
    await settle();

    expect(observed.receiver).toBe(client);
    expect(model.getSnapshot().status).toBe("succeeded");
  });

  it("treats a synchronous adapter throw as indeterminate without exposing its text", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(() => {
      throw new Error(`synchronous transport failure ${INPUT.secret}`);
    });
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(INPUT, () => "sync-throw-command");
    await settle();

    expect(model.getSnapshot()).toEqual({
      status: "indeterminate",
      canSubmit: false,
      member: null,
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain(INPUT.secret);
    expect(JSON.stringify(model.getSnapshot())).not.toContain("transport failure");
  });

  it("contains hostile thenable assimilation as an indeterminate acknowledgement", async () => {
    let thenReads = 0;
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(() => {
      const hostile = {};
      // oxlint-disable-next-line no-thenable -- deliberate untrusted adapter fixture
      Object.defineProperty(hostile, "then", {
        get: () => {
          thenReads += 1;
          throw new Error(`thenable capability ${INPUT.secret}`);
        },
      });
      return hostile as Promise<unknown>;
    });
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(INPUT, () => "hostile-thenable-command");
    await settle();

    expect(thenReads).toBe(1);
    expect(model.getSnapshot()).toEqual({
      status: "indeterminate",
      canSubmit: false,
      member: null,
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain(INPUT.secret);
  });

  it("retries an indeterminate acknowledgement with the exact same object", async () => {
    const redeemInvitation = vi
      .fn<CoworkInvitationRedemptionClient["redeemInvitation"]>()
      .mockRejectedValueOnce(new Error(`transport ${INPUT.secret}`))
      .mockResolvedValueOnce(result({ disposition: "already-applied" }));
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);
    const createCommandId = vi.fn(() => "retry-command");

    model.redeem(INPUT, createCommandId);
    await settle();
    expect(model.getSnapshot()).toEqual({
      status: "indeterminate",
      canSubmit: false,
      member: null,
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain(INPUT.secret);

    model.retry();
    await settle();
    expect(redeemInvitation).toHaveBeenCalledTimes(2);
    expect(redeemInvitation.mock.calls[1]![0]).toBe(redeemInvitation.mock.calls[0]![0]);
    expect(createCommandId).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().status).toBe("succeeded");
  });

  it("drops an indeterminate capability instead of reconstructing it", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      Promise.reject(new Error("lost acknowledgement")),
    );
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(INPUT, () => "discard-command");
    await settle();
    model.discardIndeterminate();
    model.retry();

    expect(model.getSnapshot()).toEqual({ status: "idle", canSubmit: true, member: null });
    expect(redeemInvitation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid project", { ...INPUT, sharedProjectId: "../other-project" }],
    ["invalid token", { ...INPUT, secret: "short" }],
    ["empty name", { ...INPUT, displayName: "   " }],
    ["overlong name", { ...INPUT, displayName: "N".repeat(129) }],
  ])("rejects %s without calling the adapter", async (_name, input) => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(input, () => "invalid-input-command");
    await settle();

    expect(redeemInvitation).not.toHaveBeenCalled();
    expect(model.getSnapshot()).toEqual({ status: "rejected", canSubmit: true, member: null });
  });

  it("does not invoke accessors or Proxy get traps on command input", async () => {
    let accessorReads = 0;
    const accessorInput = { ...INPUT };
    Object.defineProperty(accessorInput, "secret", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return INPUT.secret;
      },
    });
    const proxyInputReads = { count: 0 };
    const proxyInput = new Proxy(
      { ...INPUT },
      {
        get(target, property, receiver) {
          proxyInputReads.count += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const accessorRedeem = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const accessorModel = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation: accessorRedeem },
      IDENTITY,
    );

    accessorModel.redeem(accessorInput, () => "accessor-input-command");
    await settle();

    expect(accessorReads).toBe(0);
    expect(accessorRedeem).not.toHaveBeenCalled();
    expect(accessorModel.getSnapshot()).toEqual({
      status: "rejected",
      canSubmit: true,
      member: null,
    });

    const proxyRedeem = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const proxyModel = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation: proxyRedeem },
      IDENTITY,
    );
    proxyModel.redeem(proxyInput, () => "proxy-input-command");
    await settle();

    expect(proxyInputReads.count).toBe(0);
    expect(proxyRedeem).toHaveBeenCalledTimes(1);
    expect(proxyRedeem.mock.calls[0]![0].request).toEqual({
      ...INPUT,
      commandId: "proxy-input-command",
    });
    expect(proxyModel.getSnapshot().status).toBe("succeeded");
  });

  it("contains a reentrant command-id factory before any capability dispatch", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(INPUT, () => {
      model.redeem(INPUT, () => "nested-command");
      model.stop();
      return "outer-command";
    });
    await settle();

    expect(redeemInvitation).not.toHaveBeenCalled();
    expect(model.getSnapshot()).toEqual({
      status: "unavailable",
      canSubmit: false,
      member: null,
    });
  });

  it("does not dispatch after a pending-state observer closes the scope", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);
    const unsubscribe = model.subscribe(() => {
      if (model.getSnapshot().status === "pending") model.stop();
    });

    model.redeem(INPUT, () => "observer-stop-command");
    unsubscribe();
    await settle();

    expect(redeemInvitation).not.toHaveBeenCalled();
    expect(model.getSnapshot()).toEqual({
      status: "unavailable",
      canSubmit: false,
      member: null,
    });
  });

  it("snapshots listeners so subscription mutation cannot extend one notification pass", () => {
    const model = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation: vi.fn(async () => result()) },
      IDENTITY,
    );
    const lateListener = vi.fn();
    const firstListener = vi.fn(() => {
      model.subscribe(lateListener);
    });
    model.subscribe(firstListener);

    model.start();

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(lateListener).not.toHaveBeenCalled();
  });

  it.each([
    ["null member", () => result({ member: null })],
    [
      "cross-user member",
      () => result({ member: { ...result().member, userId: "different-user" } }),
    ],
    [
      "display-name drift",
      () => result({ member: { ...result().member, displayName: "Different Name" } }),
    ],
    ["owner escalation", () => result({ member: { ...result().member, role: "owner" } })],
    ["impossible epoch", () => result({ membershipEpoch: 0 })],
    ["excess response", () => ({ ...result(), sharedProjectId: INPUT.sharedProjectId })],
    [
      "inherited response",
      () => Object.assign(Object.create({ disposition: "applied" }), result()),
    ],
    ["transparent proxy", () => new Proxy(result(), {})],
    [
      "nested transparent proxy",
      () => {
        const payload = result();
        return { ...payload, member: new Proxy(payload.member, {}) };
      },
    ],
    ["symbol-bearing response", () => Object.assign(result(), { [Symbol("hidden")]: "forbidden" })],
    [
      "sparse permissions",
      () => {
        const payload = result();
        const permissions: string[] = [];
        permissions.length = 4;
        permissions[0] = "transcript.read";
        permissions[3] = "file.read";
        return { ...payload, member: { ...payload.member, permissions } };
      },
    ],
    [
      "oversize graph",
      () => ({
        ...result(),
        member: { ...result().member, permissions: Array.from({ length: 65 }, () => "file.read") },
      }),
    ],
  ])("fails closed and clears the command on hostile result: %s", async (_name, makeResult) => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      makeResult(),
    );
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(INPUT, () => "hostile-result-command");
    await settle();
    model.retry();

    expect(model.getSnapshot()).toEqual({ status: "rejected", canSubmit: true, member: null });
    expect(redeemInvitation).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(model.getSnapshot())).not.toContain(INPUT.secret);
  });

  it("does not invoke response accessors", async () => {
    let reads = 0;
    const payload = result();
    Object.defineProperty(payload, "member", {
      enumerable: true,
      get: () => {
        reads += 1;
        return result().member;
      },
    });
    const model = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation: vi.fn(async () => payload) },
      IDENTITY,
    );

    model.redeem(INPUT, () => "accessor-command");
    await settle();

    expect(reads).toBe(0);
    expect(model.getSnapshot().status).toBe("rejected");
  });

  it("fails closed for malformed authenticated identity", () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const model = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation },
      { ...IDENTITY, deviceId: "../device" },
    );

    model.redeem(INPUT, () => "unavailable-command");

    expect(model.getSnapshot()).toEqual({
      status: "unavailable",
      canSubmit: false,
      member: null,
    });
    expect(redeemInvitation).not.toHaveBeenCalled();
  });

  it("does not invoke authenticated-identity accessors and rejects identity Proxies", () => {
    let accessorReads = 0;
    const accessorIdentity = { ...IDENTITY };
    Object.defineProperty(accessorIdentity, "userId", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return IDENTITY.userId;
      },
    });
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      result(),
    );
    const accessorModel = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation },
      accessorIdentity,
    );
    const proxyModel = new CoworkInvitationRedemptionPanelModel(
      { redeemInvitation },
      new Proxy({ ...IDENTITY }, {}),
    );

    accessorModel.redeem(INPUT, () => "accessor-identity-command");
    proxyModel.redeem(INPUT, () => "proxy-identity-command");

    expect(accessorReads).toBe(0);
    expect(accessorModel.getSnapshot().status).toBe("unavailable");
    expect(proxyModel.getSnapshot().status).toBe("unavailable");
    expect(redeemInvitation).not.toHaveBeenCalled();
  });

  it("clears a pending request on stop and ignores its stale result", async () => {
    const pending = deferred<unknown>();
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(
      () => pending.promise,
    );
    const model = new CoworkInvitationRedemptionPanelModel({ redeemInvitation }, IDENTITY);

    model.redeem(INPUT, () => "late-command");
    model.stop();
    pending.resolve(result());
    await settle();

    expect(model.getSnapshot()).toEqual({
      status: "unavailable",
      canSubmit: false,
      member: null,
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain(INPUT.secret);
  });
});
