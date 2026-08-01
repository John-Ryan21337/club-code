import {
  CollaborationMembershipEpoch,
  DeviceId,
  SharedProjectId,
  UserId,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  CoworkDeviceEnrollmentModel,
  type CoworkDeviceEnrollmentClient,
  type CoworkDeviceEnrollmentSigner,
} from "./deviceEnrollmentPanel.ts";

const PUBLIC_KEY = "MCowBQYDK2VwAyEAeYSfBObPytF2-WlIwwrI8R_xYnamhwUiIEA-PouMC38";
const LOW_ORDER_KEY = "MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NONCE = "N".repeat(43);
const SIGNATURE = "A".repeat(86);
const scope = {
  sharedProjectId: Schema.decodeUnknownSync(SharedProjectId)("project-device-ui"),
  userId: Schema.decodeUnknownSync(UserId)("user-device-ui"),
  deviceId: Schema.decodeUnknownSync(DeviceId)("device-ui"),
  membershipEpoch: Schema.decodeUnknownSync(CollaborationMembershipEpoch)(7),
};

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    challengeId: "challenge-device-ui",
    sharedProjectId: scope.sharedProjectId,
    userId: scope.userId,
    deviceId: scope.deviceId,
    deviceKeyId: "device-key-ui",
    publicKeySpkiDer: PUBLIC_KEY,
    membershipEpoch: scope.membershipEpoch,
    issuedAt: "2026-08-01T12:00:00.000Z",
    expiresAt: "2026-08-01T12:05:00.000Z",
    ...overrides,
  };
}

function activated(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "activated",
    key: {
      sharedProjectId: scope.sharedProjectId,
      userId: scope.userId,
      deviceId: scope.deviceId,
      deviceKeyId: "device-key-ui",
      publicKeySpkiDer: PUBLIC_KEY,
      membershipEpoch: scope.membershipEpoch,
      activatedAt: "2026-08-01T12:01:00.000Z",
      revokedAt: null,
      ...overrides,
    },
  };
}

function harness(input?: {
  readonly begin?: CoworkDeviceEnrollmentClient["beginEnrollment"];
  readonly complete?: CoworkDeviceEnrollmentClient["completeEnrollment"];
  readonly identity?: Record<string, unknown>;
  readonly getIdentity?: CoworkDeviceEnrollmentSigner["getPublicIdentity"];
  readonly sign?: CoworkDeviceEnrollmentSigner["signEnrollmentProof"];
}) {
  const beginEnrollment = vi.fn(
    input?.begin ??
      (async () => ({ disposition: "created", challenge: challenge(), nonce: NONCE })),
  );
  const completeEnrollment = vi.fn(input?.complete ?? (async () => activated()));
  const getPublicIdentity = vi.fn(
    input?.getIdentity ??
      (async () => ({
        ...scope,
        publicKeySpkiDer: PUBLIC_KEY,
        ...input?.identity,
      })),
  );
  const signEnrollmentProof = vi.fn(input?.sign ?? (async () => SIGNATURE));
  const client = { beginEnrollment, completeEnrollment };
  const signer = { getPublicIdentity, signEnrollmentProof };
  const model = new CoworkDeviceEnrollmentModel(client, signer, scope);
  model.start();
  return {
    model,
    client,
    signer,
    beginEnrollment,
    completeEnrollment,
    getPublicIdentity,
    signEnrollmentProof,
  };
}

async function status(model: CoworkDeviceEnrollmentModel, expected: string) {
  await vi.waitFor(() => expect(model.getSnapshot().status).toBe(expected));
}

describe("CoworkDeviceEnrollmentModel", () => {
  it("binds the exact device challenge while keeping nonce and proof out of display state", async () => {
    const h = harness();
    const commandId = vi
      .fn()
      .mockReturnValueOnce("begin-command")
      .mockReturnValueOnce("complete-command");
    h.model.enroll(commandId);
    await status(h.model, "activated");

    expect(h.beginEnrollment).toHaveBeenCalledWith({
      commandId: "begin-command",
      sharedProjectId: scope.sharedProjectId,
      publicKeySpkiDer: PUBLIC_KEY,
    });
    const signedChallenge = h.signEnrollmentProof.mock.calls[0]![0];
    expect(signedChallenge).toMatchObject({
      challengeId: "challenge-device-ui",
      sharedProjectId: scope.sharedProjectId,
      userId: scope.userId,
      deviceId: scope.deviceId,
      deviceKeyId: "device-key-ui",
      publicKeySpkiDer: PUBLIC_KEY,
      membershipEpoch: scope.membershipEpoch,
    });
    expect(h.signEnrollmentProof.mock.calls[0]![1]).toBe(NONCE);
    expect(h.completeEnrollment).toHaveBeenCalledWith({
      commandId: "complete-command",
      sharedProjectId: scope.sharedProjectId,
      challengeId: "challenge-device-ui",
      nonce: NONCE,
      proofSignature: SIGNATURE,
    });
    expect(JSON.stringify(h.model.getSnapshot())).not.toContain(NONCE);
    expect(JSON.stringify(h.model.getSnapshot())).not.toContain(SIGNATURE);
    expect(h.model.getSnapshot()).toMatchObject({
      status: "activated",
      deviceKeyId: "device-key-ui",
      membershipEpoch: 7,
    });
  });

  it("makes the signer-visible challenge transitively immutable", async () => {
    const sign = vi.fn<CoworkDeviceEnrollmentSigner["signEnrollmentProof"]>(
      async (signingChallenge) => {
        expect(Reflect.set(signingChallenge.issuedAt, "epochMilliseconds", 0)).toBe(false);
        expect(Reflect.set(signingChallenge.expiresAt, "epochMilliseconds", 0)).toBe(false);
        return SIGNATURE;
      },
    );
    const h = harness({ sign });
    h.model.enroll(
      vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
    );
    await status(h.model, "activated");
    expect(sign).toHaveBeenCalledOnce();
  });

  it("retries an indeterminate begin with the same object and treats nonce-null replay as lost", async () => {
    const begin = vi
      .fn<CoworkDeviceEnrollmentClient["beginEnrollment"]>()
      .mockRejectedValueOnce(new Error("lost ack"))
      .mockResolvedValueOnce({
        disposition: "already-applied",
        challenge: challenge(),
        nonce: null,
      });
    const h = harness({ begin });
    const commandId = vi.fn(() => "begin-command");
    h.model.enroll(commandId);
    await status(h.model, "retry-begin");
    h.model.enroll(commandId);
    await status(h.model, "lost-nonce");

    expect(begin).toHaveBeenCalledTimes(2);
    expect(begin.mock.calls[1]![0]).toBe(begin.mock.calls[0]![0]);
    expect(commandId).toHaveBeenCalledTimes(1);
    expect(h.signEnrollmentProof).not.toHaveBeenCalled();
    expect(h.model.getSnapshot()).toMatchObject({
      status: "lost-nonce",
      challengeId: "challenge-device-ui",
    });
  });

  it("retries an indeterminate completion with the exact nonce-bearing command", async () => {
    const complete = vi
      .fn<CoworkDeviceEnrollmentClient["completeEnrollment"]>()
      .mockRejectedValueOnce(new Error("lost complete ack"))
      .mockResolvedValueOnce({ ...activated(), disposition: "already-applied" });
    const h = harness({ complete });
    const commandId = vi
      .fn()
      .mockReturnValueOnce("begin-command")
      .mockReturnValueOnce("complete-command");
    h.model.enroll(commandId);
    await status(h.model, "retry-complete");
    h.model.enroll(commandId);
    await status(h.model, "activated");

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0]).toBe(complete.mock.calls[0]![0]);
    expect(commandId).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-device, stale-epoch, and rollback-shaped responses", async () => {
    const begin = vi.fn<CoworkDeviceEnrollmentClient["beginEnrollment"]>(async () => ({
      disposition: "created",
      challenge: challenge({ deviceId: "other-device" }),
      nonce: NONCE,
    }));
    const h = harness({ begin });
    h.model.enroll(() => "begin-command");
    await status(h.model, "retry-begin");
    expect(h.signEnrollmentProof).not.toHaveBeenCalled();

    const stale = harness({
      complete: async () => activated({ membershipEpoch: 6 }),
    });
    stale.model.enroll(
      vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
    );
    await status(stale.model, "retry-complete");
    expect(stale.model.getSnapshot().status).toBe("retry-complete");

    const rollback = harness({
      complete: async () => activated({ activatedAt: "2026-08-01T11:59:59.999Z" }),
    });
    rollback.model.enroll(
      vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
    );
    await status(rollback.model, "retry-complete");
  });

  it("rejects identity and low-order public keys before invoking the client", async () => {
    for (const publicKeySpkiDer of [LOW_ORDER_KEY, "A".repeat(59)]) {
      const h = harness({ identity: { publicKeySpkiDer } });
      h.model.enroll(() => "begin-command");
      await vi.waitFor(() => expect(h.getPublicIdentity).toHaveBeenCalledOnce());
      await status(h.model, "prepare-failed");
      expect(h.beginEnrollment).not.toHaveBeenCalled();
    }
  });

  it("captures only the exact adapter methods and does not publicly re-export capabilities", async () => {
    const h = harness();
    const swappedIdentity = vi.fn(async () => ({ ...scope, publicKeySpkiDer: PUBLIC_KEY }));
    const swappedSign = vi.fn(async () => SIGNATURE);
    const swappedBegin = vi.fn(async () => ({
      disposition: "created",
      challenge: challenge(),
      nonce: NONCE,
    }));
    const swappedComplete = vi.fn(async () => activated());
    Object.defineProperties(h.signer, {
      getPublicIdentity: { configurable: true, value: swappedIdentity },
      signEnrollmentProof: { configurable: true, value: swappedSign },
    });
    Object.defineProperties(h.client, {
      beginEnrollment: { configurable: true, value: swappedBegin },
      completeEnrollment: { configurable: true, value: swappedComplete },
    });

    h.model.enroll(
      vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
    );
    await status(h.model, "activated");

    expect(h.getPublicIdentity).toHaveBeenCalledOnce();
    expect(h.beginEnrollment).toHaveBeenCalledOnce();
    expect(h.signEnrollmentProof).toHaveBeenCalledOnce();
    expect(h.completeEnrollment).toHaveBeenCalledOnce();
    expect(swappedIdentity).not.toHaveBeenCalled();
    expect(swappedBegin).not.toHaveBeenCalled();
    expect(swappedSign).not.toHaveBeenCalled();
    expect(swappedComplete).not.toHaveBeenCalled();
    expect(Object.hasOwn(h.model, "client")).toBe(false);
    expect(Object.hasOwn(h.model, "signer")).toBe(false);
  });

  it("rejects proxy-wrapped scope before retaining or invoking adapter capabilities", () => {
    const h = harness();
    expect(
      () => new CoworkDeviceEnrollmentModel(h.client, h.signer, new Proxy(scope, {})),
    ).toThrow();
    expect(h.getPublicIdentity).not.toHaveBeenCalled();
    expect(h.beginEnrollment).not.toHaveBeenCalled();
  });

  it("rejects proxy, accessor, and excess-field adapter payloads fail closed", async () => {
    const base = { disposition: "created", challenge: challenge(), nonce: NONCE };
    const payloads: unknown[] = [
      new Proxy(base, {}),
      Object.defineProperty({ ...base }, "injected", { enumerable: true, get: () => true }),
      { ...base, injected: true },
    ];
    for (const payload of payloads) {
      const h = harness({ begin: async () => payload });
      h.model.enroll(() => "begin-command");
      await status(h.model, "retry-begin");
      expect(h.signEnrollmentProof).not.toHaveBeenCalled();
    }

    for (const payload of payloads) {
      const h = harness({ complete: async () => payload });
      h.model.enroll(
        vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
      );
      await status(h.model, "retry-complete");
      expect(h.completeEnrollment).toHaveBeenCalledOnce();
    }

    const identityBase = { ...scope, publicKeySpkiDer: PUBLIC_KEY };
    for (const identity of [
      new Proxy(identityBase, {}),
      Object.defineProperty({ ...identityBase }, "injected", {
        enumerable: true,
        get: () => true,
      }),
      { ...identityBase, injected: true },
    ]) {
      const h = harness({ getIdentity: async () => identity });
      h.model.enroll(() => "begin-command");
      await status(h.model, "prepare-failed");
      expect(h.beginEnrollment).not.toHaveBeenCalled();
    }
  });

  it("stops synchronously at every published lifecycle boundary before the next capability", async () => {
    const cases = [
      {
        stopAt: "reading-signer",
        assertStopped: (h: ReturnType<typeof harness>) =>
          expect(h.getPublicIdentity).not.toHaveBeenCalled(),
      },
      {
        stopAt: "beginning",
        assertStopped: (h: ReturnType<typeof harness>) =>
          expect(h.beginEnrollment).not.toHaveBeenCalled(),
      },
      {
        stopAt: "signing",
        assertStopped: (h: ReturnType<typeof harness>) =>
          expect(h.signEnrollmentProof).not.toHaveBeenCalled(),
      },
      {
        stopAt: "completing",
        assertStopped: (h: ReturnType<typeof harness>) =>
          expect(h.completeEnrollment).not.toHaveBeenCalled(),
      },
    ] as const;

    for (const testCase of cases) {
      const h = harness();
      const unsubscribe = h.model.subscribe(() => {
        if (h.model.getSnapshot().status === testCase.stopAt) h.model.stop();
      });
      h.model.enroll(
        vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
      );
      await vi.waitFor(() => expect(h.model.getSnapshot().status).toBe(testCase.stopAt));
      await Promise.resolve();
      testCase.assertStopped(h);
      expect(JSON.stringify(h.model.getSnapshot())).not.toContain(NONCE);
      expect(JSON.stringify(h.model.getSnapshot())).not.toContain(SIGNATURE);
      unsubscribe();
    }
  });

  it("does not reattach a nonce-bearing completion after command creation stops the model", async () => {
    const h = harness();
    const createCommandId = vi
      .fn()
      .mockReturnValueOnce("begin-command")
      .mockImplementationOnce(() => {
        h.model.stop();
        return "complete-command";
      });
    h.model.enroll(createCommandId);
    await vi.waitFor(() => expect(createCommandId).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(h.completeEnrollment).not.toHaveBeenCalled();

    h.model.start();
    h.model.enroll(
      vi.fn().mockReturnValueOnce("new-begin-command").mockReturnValueOnce("new-complete-command"),
    );
    await status(h.model, "activated");
    expect(h.completeEnrollment).toHaveBeenCalledOnce();
  });

  it("drops late begin results after stop and never signs them", async () => {
    let resolve!: (value: unknown) => void;
    const h = harness({
      begin: () => new Promise((done) => (resolve = done)),
    });
    h.model.enroll(() => "begin-command");
    await status(h.model, "beginning");
    h.model.stop();
    resolve({ disposition: "created", challenge: challenge(), nonce: NONCE });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.signEnrollmentProof).not.toHaveBeenCalled();
    expect(JSON.stringify(h.model.getSnapshot())).not.toContain(NONCE);
  });

  it("contains synchronous throws and hostile thenables at every injected boundary", async () => {
    const syncIdentity = harness({
      getIdentity: (() => {
        throw new Error("sync identity");
      }) as CoworkDeviceEnrollmentSigner["getPublicIdentity"],
    });
    syncIdentity.model.enroll(() => "begin-command");
    await status(syncIdentity.model, "prepare-failed");
    expect(syncIdentity.beginEnrollment).not.toHaveBeenCalled();

    const syncBegin = harness({
      begin: (() => {
        throw new Error("sync begin");
      }) as CoworkDeviceEnrollmentClient["beginEnrollment"],
    });
    syncBegin.model.enroll(() => "begin-command");
    await status(syncBegin.model, "retry-begin");

    const hostileThenable = {};
    Reflect.defineProperty(hostileThenable, ["th", "en"].join(""), {
      get() {
        throw new Error("hostile then getter");
      },
    });
    const hostileBegin = harness({
      begin: (() => hostileThenable) as unknown as CoworkDeviceEnrollmentClient["beginEnrollment"],
    });
    hostileBegin.model.enroll(() => "begin-command");
    await status(hostileBegin.model, "retry-begin");

    const hostileIdentity = harness({
      getIdentity: (() =>
        hostileThenable) as unknown as CoworkDeviceEnrollmentSigner["getPublicIdentity"],
    });
    hostileIdentity.model.enroll(() => "begin-command");
    await status(hostileIdentity.model, "prepare-failed");
    expect(hostileIdentity.beginEnrollment).not.toHaveBeenCalled();

    const hostileSign = harness({
      sign: (() =>
        hostileThenable) as unknown as CoworkDeviceEnrollmentSigner["signEnrollmentProof"],
    });
    hostileSign.model.enroll(() => "begin-command");
    await status(hostileSign.model, "retry-sign");

    const hostileComplete = harness({
      complete: (() =>
        hostileThenable) as unknown as CoworkDeviceEnrollmentClient["completeEnrollment"],
    });
    hostileComplete.model.enroll(
      vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
    );
    await status(hostileComplete.model, "retry-complete");

    const syncSign = harness({
      sign: (() => {
        throw new Error("sync sign");
      }) as CoworkDeviceEnrollmentSigner["signEnrollmentProof"],
    });
    syncSign.model.enroll(() => "begin-command");
    await status(syncSign.model, "retry-sign");

    const syncComplete = harness({
      complete: (() => {
        throw new Error("sync complete");
      }) as CoworkDeviceEnrollmentClient["completeEnrollment"],
    });
    syncComplete.model.enroll(
      vi.fn().mockReturnValueOnce("begin-command").mockReturnValueOnce("complete-command"),
    );
    await status(syncComplete.model, "retry-complete");
  });

  it("starts a fresh authority flow after activation rather than retaining the old attempt", async () => {
    const h = harness();
    const commandId = vi
      .fn()
      .mockReturnValueOnce("begin-command-1")
      .mockReturnValueOnce("complete-command-1")
      .mockReturnValueOnce("begin-command-2");
    h.model.enroll(commandId);
    await status(h.model, "activated");

    let resolveSecond!: (value: unknown) => void;
    h.beginEnrollment.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSecond = resolve)),
    );
    h.model.enroll(commandId);
    await status(h.model, "beginning");
    expect(h.getPublicIdentity).toHaveBeenCalledTimes(2);
    expect(h.beginEnrollment).toHaveBeenCalledTimes(2);
    expect(h.beginEnrollment.mock.calls[1]![0]).not.toBe(h.beginEnrollment.mock.calls[0]![0]);
    expect(h.beginEnrollment.mock.calls[1]![0].commandId).toBe("begin-command-2");
    expect(JSON.stringify(h.model.getSnapshot())).not.toContain(NONCE);
    resolveSecond({ disposition: "already-applied", challenge: challenge(), nonce: null });
  });
});
