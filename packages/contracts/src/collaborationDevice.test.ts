import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  COLLABORATION_DEVICE_CHALLENGE_BASE64URL_CHARS,
  COLLABORATION_ED25519_SPKI_DER_BASE64URL_CHARS,
  CollaborationBeginDeviceEnrollmentResult,
  CollaborationCompleteDeviceEnrollmentRequest,
  CollaborationCurrentDeviceKeyStatus,
  CollaborationCurrentDeviceKeyStatusRequest,
  CollaborationDeviceKeyMutationResult,
} from "./collaborationDevice.ts";

const decodeBeginResult = Schema.decodeUnknownSync(CollaborationBeginDeviceEnrollmentResult);
const decodeMutationResult = Schema.decodeUnknownSync(CollaborationDeviceKeyMutationResult);
const decodeCompleteRequest = Schema.decodeUnknownSync(
  CollaborationCompleteDeviceEnrollmentRequest,
);
const decodeCurrentStatus = Schema.decodeUnknownSync(CollaborationCurrentDeviceKeyStatus);
const decodeCurrentStatusRequest = Schema.decodeUnknownSync(
  CollaborationCurrentDeviceKeyStatusRequest,
);

describe("collaboration device contracts", () => {
  it("round-trips bounded challenge and key mutation payloads", () => {
    const challenge = {
      challengeId: "challenge-1",
      sharedProjectId: "project-1",
      userId: "user-1",
      deviceId: "device-1",
      deviceKeyId: "device-key-1",
      publicKeySpkiDer: "A".repeat(COLLABORATION_ED25519_SPKI_DER_BASE64URL_CHARS),
      membershipEpoch: 3,
      issuedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-08-01T12:05:00.000Z",
    };
    expect(
      decodeBeginResult({
        disposition: "created",
        challenge,
        nonce: "A".repeat(COLLABORATION_DEVICE_CHALLENGE_BASE64URL_CHARS),
      }).challenge.deviceKeyId,
    ).toBe("device-key-1");
    expect(
      decodeMutationResult({
        disposition: "activated",
        key: {
          sharedProjectId: "project-1",
          userId: "user-1",
          deviceId: "device-1",
          deviceKeyId: "device-key-1",
          publicKeySpkiDer: challenge.publicKeySpkiDer,
          membershipEpoch: 3,
          activatedAt: challenge.issuedAt,
          revokedAt: null,
        },
      }).key.deviceId,
    ).toBe("device-1");
  });

  it("rejects malformed nonces, signatures, keys, epochs, and excess fields", () => {
    expect(() =>
      decodeCompleteRequest(
        {
          commandId: "command-1",
          sharedProjectId: "project-1",
          challengeId: "challenge-1",
          nonce: "short",
          proofSignature: "A".repeat(86),
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow();
    expect(() =>
      decodeCompleteRequest(
        {
          commandId: "command-1",
          sharedProjectId: "project-1",
          challengeId: "challenge-1",
          nonce: "A".repeat(COLLABORATION_DEVICE_CHALLENGE_BASE64URL_CHARS),
          proofSignature: "A".repeat(86),
          injected: true,
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow();
  });

  it("keeps current-device discovery bounded to server-derived identity and public status", () => {
    expect(
      decodeCurrentStatusRequest({ sharedProjectId: "project-1" }, { onExcessProperty: "error" }),
    ).toEqual({ sharedProjectId: "project-1" });
    expect(() =>
      decodeCurrentStatusRequest(
        { sharedProjectId: "project-1", userId: "other-user" },
        { onExcessProperty: "error" },
      ),
    ).toThrow();

    const identity = {
      sharedProjectId: "project-1",
      userId: "user-1",
      deviceId: "device-1",
      membershipEpoch: 3,
    };
    expect(
      decodeCurrentStatus(
        {
          ...identity,
          status: "active",
          activeKey: {
            deviceKeyId: "device-key-1",
            activatedAt: "2026-08-01T12:00:00.000Z",
          },
        },
        { onExcessProperty: "error" },
      ).status,
    ).toBe("active");
    expect(
      decodeCurrentStatus(
        { ...identity, status: "enrollment-required", activeKey: null },
        { onExcessProperty: "error" },
      ).status,
    ).toBe("enrollment-required");
    expect(() =>
      decodeCurrentStatus(
        {
          ...identity,
          status: "active",
          activeKey: {
            deviceKeyId: "device-key-1",
            activatedAt: "2026-08-01T12:00:00.000Z",
            publicKeySpkiDer: "forbidden",
          },
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow();
  });
});
