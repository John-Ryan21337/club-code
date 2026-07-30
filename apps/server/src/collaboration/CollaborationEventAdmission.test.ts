import {
  COLLABORATION_ED25519_SIGNATURE_BASE64URL_CHARS,
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationEventProposal,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
} from "@cafecode/contracts";
import { it } from "@effect/vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vitest";

import {
  admitCollaborationEventProposal,
  CollaborationDeviceKeyAuthority,
  type CollaborationDeviceKeyAuthorityShape,
  CollaborationEventAdmissionError,
  collaborationEventProposalSignatureBytes,
} from "./CollaborationEventAdmission.ts";
import {
  CollaborationAuthorizationError,
  CollaborationMembershipAuthority,
  type CollaborationMembershipAuthorityShape,
} from "./CollaborationAuthorization.ts";

const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeProposal = Schema.decodeUnknownSync(CollaborationEventProposal);

const PROJECT_ID = decodeProjectId("shared-project-1");
const OTHER_PROJECT_ID = decodeProjectId("shared-project-2");
const NOW_EPOCH_MILLIS = Date.parse("2026-07-30T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_DER = publicKey.export({ format: "der", type: "spki" });

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function membership(overrides: Partial<Parameters<typeof decodeMembership>[0]> = {}) {
  return decodeMembership({
    sharedProjectId: PROJECT_ID,
    epoch: 4,
    members: [
      {
        userId: "user-1",
        displayName: "Operator One",
        role: "operator",
        permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
        joinedAt: "2026-07-30T00:00:00.000Z",
      },
      {
        userId: "viewer-1",
        displayName: "Viewer One",
        role: "viewer",
        permissions: [...COLLABORATION_ROLE_PERMISSIONS.viewer],
        joinedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  });
}

function principal(overrides: Partial<Parameters<typeof decodePrincipal>[0]> = {}) {
  return decodePrincipal({
    sessionId: "collaboration-session-1",
    sharedProjectId: PROJECT_ID,
    userId: "user-1",
    deviceId: "device-1",
    membershipEpoch: 4,
    issuedAt: "2026-07-30T11:30:00.000Z",
    expiresAt: "2026-07-30T12:30:00.000Z",
    ...overrides,
  });
}

function signedProposal(overrides: Readonly<Record<string, unknown>> = {}) {
  const payloadJson =
    typeof overrides.payloadJson === "string" ? overrides.payloadJson : '{"body":"hello"}';
  const draft = decodeProposal({
    version: 1,
    sharedProjectId: PROJECT_ID,
    eventId: "collaboration-event-1",
    commandId: "collaboration-command-1",
    membershipEpoch: 4,
    actor: {
      kind: "operator",
      userId: "user-1",
      deviceId: "device-1",
    },
    type: "operator-chat.message",
    payloadJson,
    payloadSha256: sha256(payloadJson),
    authorSignature: "A".repeat(COLLABORATION_ED25519_SIGNATURE_BASE64URL_CHARS),
    causationEventId: null,
    correlationId: null,
    occurredAt: "2026-07-30T11:59:00.000Z",
    ...overrides,
  });
  return decodeProposal({
    ...draft,
    authorSignature: sign(
      null,
      collaborationEventProposalSignatureBytes(draft),
      privateKey,
    ).toString("base64url"),
  });
}

function membershipAuthority(
  getCurrent: CollaborationMembershipAuthorityShape["getCurrent"] = () =>
    Effect.succeed(membership()),
): CollaborationMembershipAuthorityShape {
  return { getCurrent };
}

function keyAuthority(
  getActiveEd25519PublicKey: CollaborationDeviceKeyAuthorityShape["getActiveEd25519PublicKey"] = () =>
    Effect.succeed(PUBLIC_KEY_DER),
): CollaborationDeviceKeyAuthorityShape {
  return { getActiveEd25519PublicKey };
}

function admit(
  overrides: Partial<Parameters<typeof admitCollaborationEventProposal>[0]> = {},
  authorities: {
    membership?: CollaborationMembershipAuthorityShape;
    key?: CollaborationDeviceKeyAuthorityShape;
  } = {},
) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW_EPOCH_MILLIS);
    return yield* admitCollaborationEventProposal({
      principal: principal(),
      targetProjectId: PROJECT_ID,
      proposal: signedProposal(),
      ...overrides,
    });
  }).pipe(
    Effect.provideService(
      CollaborationMembershipAuthority,
      authorities.membership ?? membershipAuthority(),
    ),
    Effect.provideService(CollaborationDeviceKeyAuthority, authorities.key ?? keyAuthority()),
  );
}

function denialReason(effect: ReturnType<typeof admit>): Effect.Effect<string, never, never> {
  return effect.pipe(
    Effect.flatMap(() => Effect.die("Expected event admission to be denied.")),
    Effect.catch((failure: CollaborationAuthorizationError | CollaborationEventAdmissionError) =>
      Effect.succeed(failure.reason),
    ),
  );
}

describe("CollaborationEventAdmission", () => {
  it.effect("admits an attributed, authorized, hash-matched Ed25519 proposal", () =>
    Effect.gen(function* () {
      const admitted = yield* admit();

      expect(admitted.permission).toBe("chat.append");
      expect(admitted.authorization.member.userId).toBe("user-1");
      expect(admitted.payload).toEqual({ body: "hello" });
      expect(Buffer.from(admitted.payloadBytes).toString("utf8")).toBe('{"body":"hello"}');
    }),
  );

  it.effect("uses the fixed transcript permission instead of a client-selected permission", () =>
    Effect.gen(function* () {
      const proposal = signedProposal({ type: "shared-transcript.prompt" });
      const admitted = yield* admit({ proposal });
      expect(admitted.permission).toBe("transcript.append");
    }),
  );

  it.effect("cannot append through a role whose server-owned ceiling is read-only", () =>
    Effect.gen(function* () {
      const viewerPrincipal = principal({ userId: "viewer-1" });
      const proposal = signedProposal({
        actor: { kind: "operator", userId: "viewer-1", deviceId: "device-1" },
      });

      expect(yield* denialReason(admit({ principal: viewerPrincipal, proposal }))).toBe(
        "permission-denied",
      );
    }),
  );

  it.effect("rejects cross-project input before membership or device-key lookup", () =>
    Effect.gen(function* () {
      let membershipLookups = 0;
      let keyLookups = 0;
      const reason = yield* denialReason(
        admit(
          {
            targetProjectId: OTHER_PROJECT_ID,
          },
          {
            membership: membershipAuthority(() => {
              membershipLookups += 1;
              return Effect.succeed(membership());
            }),
            key: keyAuthority(() => {
              keyLookups += 1;
              return Effect.succeed(PUBLIC_KEY_DER);
            }),
          },
        ),
      );

      expect(reason).toBe("project-mismatch");
      expect(membershipLookups).toBe(0);
      expect(keyLookups).toBe(0);
    }),
  );

  for (const { expected, label, proposal } of [
    {
      label: "operator impersonation",
      proposal: signedProposal({
        actor: { kind: "operator", userId: "other-user", deviceId: "device-1" },
      }),
      expected: "actor-mismatch",
    },
    {
      label: "device impersonation",
      proposal: signedProposal({
        actor: { kind: "operator", userId: "user-1", deviceId: "other-device" },
      }),
      expected: "actor-mismatch",
    },
    {
      label: "agent authority before agent enrollment exists",
      proposal: signedProposal({
        actor: {
          kind: "agent",
          userId: "user-1",
          deviceId: "device-1",
          agentId: "agent-1",
        },
      }),
      expected: "unsupported-actor",
    },
    {
      label: "proposal epoch differing from its access session",
      proposal: signedProposal({ membershipEpoch: 3 }),
      expected: "membership-epoch-mismatch",
    },
  ] as const) {
    it.effect(`fails closed for ${label}`, () =>
      Effect.gen(function* () {
        expect(yield* denialReason(admit({ proposal }))).toBe(expected);
      }),
    );
  }

  it.effect("rejects a stale epoch through current membership authorization", () =>
    Effect.gen(function* () {
      const reason = yield* denialReason(
        admit(
          {},
          { membership: membershipAuthority(() => Effect.succeed(membership({ epoch: 5 }))) },
        ),
      );
      expect(reason).toBe("membership-epoch-mismatch");
    }),
  );

  it.effect("rejects an exact-byte payload hash mismatch before key lookup", () =>
    Effect.gen(function* () {
      let keyLookups = 0;
      const proposal = signedProposal({ payloadSha256: "0".repeat(64) });
      const reason = yield* denialReason(
        admit(
          { proposal },
          {
            key: keyAuthority(() => {
              keyLookups += 1;
              return Effect.succeed(PUBLIC_KEY_DER);
            }),
          },
        ),
      );

      expect(reason).toBe("payload-hash-mismatch");
      expect(keyLookups).toBe(0);
    }),
  );

  it.effect("rejects payloads whose UTF-8 bytes exceed the protocol bound", () =>
    Effect.gen(function* () {
      const oversizedUtf8 = JSON.stringify({ body: "😀".repeat(20_000) });
      const reason = yield* denialReason(
        admit({ proposal: signedProposal({ payloadJson: oversizedUtf8 }) }),
      );
      expect(reason).toBe("payload-too-large");
    }),
  );

  it.effect("rejects invalid JSON and invalid audit timestamps", () =>
    Effect.gen(function* () {
      expect(
        yield* denialReason(admit({ proposal: signedProposal({ payloadJson: "{nope" }) })),
      ).toBe("payload-invalid-json");
      expect(
        yield* denialReason(admit({ proposal: signedProposal({ occurredAt: "not-a-timestamp" }) })),
      ).toBe("occurred-at-invalid");
    }),
  );

  it.effect("rejects missing, unavailable, and wrong device keys", () =>
    Effect.gen(function* () {
      expect(
        yield* denialReason(admit({}, { key: keyAuthority(() => Effect.succeed(null)) })),
      ).toBe("device-key-not-found");
      expect(
        yield* denialReason(
          admit({}, { key: keyAuthority(() => Effect.fail(new Error("key store unavailable"))) }),
        ),
      ).toBe("device-key-unavailable");

      const otherKey = generateKeyPairSync("ed25519").publicKey.export({
        format: "der",
        type: "spki",
      });
      expect(
        yield* denialReason(admit({}, { key: keyAuthority(() => Effect.succeed(otherKey)) })),
      ).toBe("signature-invalid");
    }),
  );

  it.effect("rejects a signature replay after any signed field changes", () =>
    Effect.gen(function* () {
      const original = signedProposal();
      const replay = decodeProposal({
        ...original,
        eventId: "collaboration-event-2",
      });

      expect(yield* denialReason(admit({ proposal: replay }))).toBe("signature-invalid");
    }),
  );
});
