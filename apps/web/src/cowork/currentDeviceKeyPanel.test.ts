import {
  CollaborationMembershipEpoch,
  DeviceId,
  SharedProjectId,
  UserId,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  CoworkCurrentDeviceKeyModel,
  type CoworkCurrentDeviceKeyClient,
} from "./currentDeviceKeyPanel.ts";

const scope = {
  sharedProjectId: Schema.decodeUnknownSync(SharedProjectId)("device-status-project"),
  userId: Schema.decodeUnknownSync(UserId)("device-status-user"),
  deviceId: Schema.decodeUnknownSync(DeviceId)("device-status-device"),
  membershipEpoch: Schema.decodeUnknownSync(CollaborationMembershipEpoch)(7),
};
const DEVICE_KEY_ID = "device-status-key";
const ACTIVATED_AT = "2026-08-01T12:00:00.000Z";
const REVOKED_AT = "2026-08-01T13:00:00.000Z";
const PUBLIC_KEY = "A".repeat(59);

function activeStatus(overrides: Record<string, unknown> = {}) {
  return {
    ...scope,
    status: "active",
    activeKey: { deviceKeyId: DEVICE_KEY_ID, activatedAt: ACTIVATED_AT },
    ...overrides,
  };
}

function enrollmentRequired(overrides: Record<string, unknown> = {}) {
  return { ...scope, status: "enrollment-required", activeKey: null, ...overrides };
}

function revoked(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "revoked",
    key: {
      ...scope,
      deviceKeyId: DEVICE_KEY_ID,
      publicKeySpkiDer: PUBLIC_KEY,
      activatedAt: ACTIVATED_AT,
      revokedAt: REVOKED_AT,
    },
    ...overrides,
  };
}

function harness(input?: {
  readonly status?: CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"];
  readonly revoke?: CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"];
}) {
  const getCurrentDeviceKeyStatus = vi.fn(input?.status ?? (async () => activeStatus()));
  const revokeCurrentDeviceKey = vi.fn(input?.revoke ?? (async () => revoked()));
  const client = { getCurrentDeviceKeyStatus, revokeCurrentDeviceKey };
  const model = new CoworkCurrentDeviceKeyModel(client, scope);
  return { client, model, getCurrentDeviceKeyStatus, revokeCurrentDeviceKey };
}

async function phase(model: CoworkCurrentDeviceKeyModel, expected: string) {
  await vi.waitFor(() => expect(model.getSnapshot().phase).toBe(expected));
}

describe("CoworkCurrentDeviceKeyModel", () => {
  it("requests only the project and admits an exactly bound active current device", async () => {
    const h = harness();
    h.model.start();
    await phase(h.model, "active");

    expect(h.getCurrentDeviceKeyStatus).toHaveBeenCalledOnce();
    expect(h.getCurrentDeviceKeyStatus.mock.calls[0]![0]).toEqual({
      sharedProjectId: scope.sharedProjectId,
    });
    expect(h.getCurrentDeviceKeyStatus.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    expect(Reflect.ownKeys(h.getCurrentDeviceKeyStatus.mock.calls[0]![0])).toEqual([
      "sharedProjectId",
    ]);
    expect(Object.isFrozen(h.getCurrentDeviceKeyStatus.mock.calls[0]![0])).toBe(true);
    expect(h.model.getSnapshot()).toMatchObject({
      phase: "active",
      deviceKeyId: DEVICE_KEY_ID,
      activatedAt: ACTIVATED_AT,
    });
  });

  it("presents enrollment-required without inventing current key metadata", async () => {
    const h = harness({ status: async () => enrollmentRequired() });
    h.model.start();
    await phase(h.model, "enrollment-required");
    expect(h.model.getSnapshot().deviceKeyId).toBeNull();
    expect(h.model.getSnapshot().activatedAt).toBeNull();
    h.model.requestSelfRevoke();
    expect(h.model.getSnapshot().phase).toBe("enrollment-required");
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();
  });

  it("conceals incomplete, substituted, excess, accessor, and proxy status responses", async () => {
    const accessor = Object.defineProperty(activeStatus(), "injected", {
      enumerable: true,
      get: () => "secret",
    });
    const responses: unknown[] = [
      { ...activeStatus(), sharedProjectId: "another-project" },
      { ...activeStatus(), userId: "another-user" },
      { ...activeStatus(), deviceId: "another-device" },
      { ...activeStatus(), membershipEpoch: 8 },
      { ...activeStatus(), activeKey: null },
      {
        ...activeStatus(),
        activeKey: { ...activeStatus().activeKey, publicKeySpkiDer: PUBLIC_KEY },
      },
      accessor,
      new Proxy(activeStatus(), {}),
    ];

    for (const response of responses) {
      const h = harness({ status: async () => response });
      h.model.start();
      await phase(h.model, "unavailable");
      expect(h.model.getSnapshot().deviceKeyId).toBeNull();
      expect(JSON.stringify(h.model.getSnapshot())).not.toContain(DEVICE_KEY_ID);
      expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();
    }
  });

  it("requires explicit destructive confirmation and validates the exact revoke result", async () => {
    const h = harness();
    const createCommandId = vi.fn(() => "device-self-revoke-command");
    h.model.start();
    await phase(h.model, "active");

    h.model.requestSelfRevoke();
    expect(h.model.getSnapshot().phase).toBe("confirming-revoke");
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();
    h.model.cancelSelfRevoke();
    expect(h.model.getSnapshot().phase).toBe("active");
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();

    h.model.requestSelfRevoke();
    h.model.confirmSelfRevoke(createCommandId);
    await phase(h.model, "enrollment-required");
    expect(createCommandId).toHaveBeenCalledOnce();
    expect(h.revokeCurrentDeviceKey).toHaveBeenCalledOnce();
    const request = h.revokeCurrentDeviceKey.mock.calls[0]![0];
    expect(request).toEqual({
      commandId: "device-self-revoke-command",
      sharedProjectId: scope.sharedProjectId,
      deviceKeyId: DEVICE_KEY_ID,
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(JSON.stringify(h.model.getSnapshot())).not.toContain(PUBLIC_KEY);
  });

  it("retries an indeterminate revoke with the exact same frozen request", async () => {
    const revoke = vi
      .fn<CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]>()
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce(revoked());
    const h = harness({ revoke });
    const createCommandId = vi.fn(() => "indeterminate-revoke-command");
    h.model.start();
    await phase(h.model, "active");
    h.model.requestSelfRevoke();
    h.model.confirmSelfRevoke(createCommandId);
    await phase(h.model, "retry-revoke");

    const originalRequest = revoke.mock.calls[0]![0];
    h.model.retrySelfRevoke();
    await phase(h.model, "enrollment-required");
    expect(revoke.mock.calls[1]![0]).toBe(originalRequest);
    expect(revoke.mock.calls[1]![1]?.signal).not.toBe(revoke.mock.calls[0]![1]?.signal);
    expect(Object.isFrozen(originalRequest)).toBe(true);
    expect(createCommandId).toHaveBeenCalledOnce();
  });

  it("admits only one command construction across a reentrant command-id callback", async () => {
    const h = harness();
    const nestedCommandId = vi.fn(() => "nested-command-must-not-run");
    const createCommandId = vi.fn(() => {
      h.model.confirmSelfRevoke(nestedCommandId);
      return "outer-reentrant-command";
    });
    h.model.start();
    await phase(h.model, "active");
    h.model.requestSelfRevoke();
    h.model.confirmSelfRevoke(createCommandId);
    await phase(h.model, "enrollment-required");

    expect(createCommandId).toHaveBeenCalledOnce();
    expect(nestedCommandId).not.toHaveBeenCalled();
    expect(h.revokeCurrentDeviceKey).toHaveBeenCalledOnce();
    expect(h.revokeCurrentDeviceKey.mock.calls[0]![0]).toMatchObject({
      commandId: "outer-reentrant-command",
    });
  });

  it("keeps the exact retry after malformed or authority-drifted revoke results", async () => {
    const results = [
      { ...revoked(), disposition: "activated" },
      revoked({ key: { ...revoked().key, deviceId: "other-device" } }),
      revoked({ key: { ...revoked().key, membershipEpoch: 8 } }),
      revoked({ key: { ...revoked().key, activatedAt: "2026-08-01T11:00:00.000Z" } }),
      revoked({ key: { ...revoked().key, revokedAt: null } }),
      new Proxy(revoked(), {}),
    ];
    for (const result of results) {
      const h = harness({ revoke: async () => result });
      h.model.start();
      await phase(h.model, "active");
      h.model.requestSelfRevoke();
      h.model.confirmSelfRevoke(() => "bound-revoke-command");
      await phase(h.model, "retry-revoke");
      expect(h.model.getSnapshot().deviceKeyId).toBe(DEVICE_KEY_ID);
    }
  });

  it("clears pending authority synchronously and drops late status or revoke results after stop", async () => {
    let resolveStatus!: (value: unknown) => void;
    let statusSignal: AbortSignal | undefined;
    const statusPending = harness({
      status: (_request, options) => {
        statusSignal = options?.signal;
        return new Promise((resolve) => (resolveStatus = resolve));
      },
    });
    statusPending.model.start();
    await phase(statusPending.model, "loading");
    statusPending.model.stop();
    expect(statusSignal?.aborted).toBe(true);
    expect(statusPending.model.getSnapshot().phase).toBe("idle");
    resolveStatus(activeStatus());
    await Promise.resolve();
    await Promise.resolve();
    expect(statusPending.model.getSnapshot().phase).toBe("idle");

    let resolveRevoke!: (value: unknown) => void;
    let revokeSignal: AbortSignal | undefined;
    const revokePending = harness({
      revoke: (_request, options) => {
        revokeSignal = options?.signal;
        return new Promise((resolve) => (resolveRevoke = resolve));
      },
    });
    revokePending.model.start();
    await phase(revokePending.model, "active");
    revokePending.model.requestSelfRevoke();
    revokePending.model.confirmSelfRevoke(() => "pending-revoke-command");
    await phase(revokePending.model, "revoking");
    revokePending.model.stop();
    expect(revokeSignal?.aborted).toBe(true);
    expect(revokePending.model.getSnapshot()).toMatchObject({
      phase: "idle",
      deviceKeyId: null,
    });
    resolveRevoke(revoked());
    await Promise.resolve();
    await Promise.resolve();
    expect(revokePending.model.getSnapshot().phase).toBe("idle");
  });

  it("captures exact client methods and contains synchronous or hostile thenable failures", async () => {
    const h = harness();
    const swappedStatus = vi.fn(async () => enrollmentRequired());
    const swappedRevoke = vi.fn(async () => revoked());
    Object.defineProperties(h.client, {
      getCurrentDeviceKeyStatus: { configurable: true, value: swappedStatus },
      revokeCurrentDeviceKey: { configurable: true, value: swappedRevoke },
    });
    h.model.start();
    await phase(h.model, "active");
    h.model.requestSelfRevoke();
    h.model.confirmSelfRevoke(() => "captured-method-command");
    await phase(h.model, "enrollment-required");
    expect(swappedStatus).not.toHaveBeenCalled();
    expect(swappedRevoke).not.toHaveBeenCalled();
    expect(Object.hasOwn(h.model, "client")).toBe(false);

    const hostileThenable = {};
    Reflect.defineProperty(hostileThenable, ["th", "en"].join(""), {
      get() {
        throw new Error("hostile then getter");
      },
    });
    const hostile = harness({
      status: (() =>
        hostileThenable) as unknown as CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"],
    });
    hostile.model.start();
    await phase(hostile.model, "unavailable");

    const throwing = harness({
      status: (() => {
        throw new Error("synchronous failure");
      }) as CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"],
    });
    throwing.model.start();
    await phase(throwing.model, "unavailable");

    const hostileRevokeThenable = {};
    Reflect.defineProperty(hostileRevokeThenable, ["th", "en"].join(""), {
      get() {
        throw new Error("hostile revoke then getter");
      },
    });
    const revokeHostile = harness({
      revoke: (() =>
        hostileRevokeThenable) as unknown as CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"],
    });
    revokeHostile.model.start();
    await phase(revokeHostile.model, "active");
    revokeHostile.model.requestSelfRevoke();
    revokeHostile.model.confirmSelfRevoke(() => "hostile-revoke-command");
    await phase(revokeHostile.model, "retry-revoke");
    expect(revokeHostile.revokeCurrentDeviceKey).toHaveBeenCalledOnce();
  });

  it("rejects an accessor-backed or hostile client before retaining its capability", () => {
    const accessorClient = {
      revokeCurrentDeviceKey: async () => revoked(),
    } as unknown as CoworkCurrentDeviceKeyClient;
    Object.defineProperty(accessorClient, "getCurrentDeviceKeyStatus", {
      enumerable: true,
      get: () => async () => activeStatus(),
    });
    expect(() => new CoworkCurrentDeviceKeyModel(accessorClient, scope)).toThrow(
      /own callable getCurrentDeviceKeyStatus/,
    );

    const hostileClient = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("SECRET_CLIENT_TRAP_DETAIL");
        },
      },
    ) as CoworkCurrentDeviceKeyClient;
    expect(() => new CoworkCurrentDeviceKeyModel(hostileClient, scope)).toThrow(
      /could not be inspected safely/,
    );
  });

  it("bounds hostile scalar responses before schema decoding", async () => {
    const oversizedSecret = "S".repeat(4097);
    const h = harness({
      status: async () => ({ ...activeStatus(), injected: oversizedSecret }),
    });
    h.model.start();
    await phase(h.model, "unavailable");
    expect(h.model.getSnapshot().deviceKeyId).toBeNull();
    expect(JSON.stringify(h.model.getSnapshot())).not.toContain(oversizedSecret);
  });

  it("isolates throwing and self-expanding observers from authority transitions", async () => {
    const h = harness();
    let expandingCalls = 0;
    const expandingListener = (): (() => void) => () => {
      expandingCalls += 1;
      h.model.subscribe(expandingListener());
    };
    h.model.subscribe(expandingListener());
    h.model.subscribe(() => {
      throw new Error("observer failure must not alter authority state");
    });

    h.model.start();
    await phase(h.model, "active");
    expect(expandingCalls).toBe(3);
    expect(h.getCurrentDeviceKeyStatus).toHaveBeenCalledOnce();
    expect(h.model.getSnapshot().deviceKeyId).toBe(DEVICE_KEY_ID);
  });

  it("can be stopped at published lifecycle boundaries before invoking the next client method", async () => {
    const loading = harness();
    const unsubscribeLoading = loading.model.subscribe(() => {
      if (loading.model.getSnapshot().phase === "loading") loading.model.stop();
    });
    loading.model.start();
    expect(loading.getCurrentDeviceKeyStatus).not.toHaveBeenCalled();
    unsubscribeLoading();

    const revoking = harness();
    revoking.model.start();
    await phase(revoking.model, "active");
    revoking.model.requestSelfRevoke();
    const unsubscribeRevoke = revoking.model.subscribe(() => {
      if (revoking.model.getSnapshot().phase === "revoking") revoking.model.stop();
    });
    revoking.model.confirmSelfRevoke(() => "stopped-revoke-command");
    expect(revoking.revokeCurrentDeviceKey).not.toHaveBeenCalled();
    expect(revoking.model.getSnapshot().deviceKeyId).toBeNull();
    unsubscribeRevoke();
  });
});
