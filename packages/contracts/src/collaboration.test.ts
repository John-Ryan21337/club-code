import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS,
  COLLABORATION_ED25519_SIGNATURE_BASE64URL_CHARS,
  COLLABORATION_EVENT_PAYLOAD_MAX_UTF8_BYTES,
  COLLABORATION_IDENTIFIER_MAX_CHARS,
  COLLABORATION_PROJECT_MEMBER_LIMIT,
  COLLABORATION_ROLE_PERMISSIONS,
  COLLABORATION_SESSION_ID_MAX_CHARS,
  CollaborationEventEnvelope,
  CollaborationEventProposal,
  CollaborationOperatorChatMessagePayload,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  CollaborationSharedTranscriptPromptPayload,
} from "./collaboration.js";

const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const encodeMembership = Schema.encodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const encodePrincipal = Schema.encodeUnknownSync(CollaborationPrincipal);
const decodeEvent = Schema.decodeUnknownSync(CollaborationEventEnvelope);
const encodeEvent = Schema.encodeUnknownSync(CollaborationEventEnvelope);
const decodeEventProposal = Schema.decodeUnknownSync(CollaborationEventProposal);
const decodeChatPayload = Schema.decodeUnknownSync(CollaborationOperatorChatMessagePayload);
const decodePromptPayload = Schema.decodeUnknownSync(CollaborationSharedTranscriptPromptPayload);

function member(index: number) {
  return {
    userId: `user-${index}`,
    displayName: `Operator ${index}`,
    role: "operator" as const,
    permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
    joinedAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("collaboration contracts", () => {
  it("round-trips an authenticated principal without client-asserted authority", () => {
    const encoded = {
      sessionId: "collaboration-session-1",
      sharedProjectId: "shared-project-1",
      userId: "user-1",
      deviceId: "device-1",
      membershipEpoch: 4,
      issuedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-07-30T01:00:00.000Z",
    };

    expect(encodePrincipal(decodePrincipal(encoded))).toEqual(encoded);
    expect(
      encodePrincipal(
        decodePrincipal({
          ...encoded,
          role: "owner",
          permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
        }),
      ),
    ).toEqual(encoded);
    expect(Object.hasOwn(encoded, "role")).toBe(false);
    expect(Object.hasOwn(encoded, "permissions")).toBe(false);
  });

  it("rejects unbounded or invalid authenticated collaboration sessions", () => {
    const valid = {
      sessionId: "collaboration-session-1",
      sharedProjectId: "shared-project-1",
      userId: "user-1",
      deviceId: "device-1",
      membershipEpoch: 4,
      issuedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-07-30T01:00:00.000Z",
    };

    expect(() =>
      decodePrincipal({
        ...valid,
        sessionId: "s".repeat(COLLABORATION_SESSION_ID_MAX_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      decodePrincipal({
        ...valid,
        expiresAt: valid.issuedAt,
      }),
    ).toThrow();
    expect(() =>
      decodePrincipal({
        ...valid,
        expiresAt: new Date(
          Date.parse(valid.issuedAt) + COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS + 1,
        ).toISOString(),
      }),
    ).toThrow();
    for (const sessionId of ["session with spaces", "session/with/slash", "s\u0000x", "café"]) {
      expect(() => decodePrincipal({ ...valid, sessionId })).toThrow();
    }
  });

  it("round-trips a project membership snapshot", () => {
    const decoded = decodeMembership({
      sharedProjectId: "shared-project-1",
      epoch: 4,
      members: [
        {
          ...member(1),
          role: "owner",
          permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
        },
        member(2),
      ],
      updatedAt: "2026-07-30T00:00:00.000Z",
    });

    expect(encodeMembership(decoded)).toEqual({
      sharedProjectId: "shared-project-1",
      epoch: 4,
      members: [
        {
          ...member(1),
          role: "owner",
          permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
        },
        member(2),
      ],
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("rejects a project membership snapshot above the protocol hard cap", () => {
    expect(() =>
      decodeMembership({
        sharedProjectId: "shared-project-1",
        epoch: 1,
        members: Array.from({ length: COLLABORATION_PROJECT_MEMBER_LIMIT + 1 }, (_, index) =>
          member(index),
        ),
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts a project membership snapshot at the protocol hard cap", () => {
    expect(
      decodeMembership({
        sharedProjectId: "shared-project-1",
        epoch: 1,
        members: Array.from({ length: COLLABORATION_PROJECT_MEMBER_LIMIT }, (_, index) =>
          member(index),
        ),
        updatedAt: "2026-07-30T00:00:00.000Z",
      }).members,
    ).toHaveLength(COLLABORATION_PROJECT_MEMBER_LIMIT);
  });

  it("rejects invalid project roles and membership epochs", () => {
    expect(() =>
      decodeMembership({
        sharedProjectId: "shared-project-1",
        epoch: 1,
        members: [{ ...member(1), role: "super-admin" }],
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
    ).toThrow();

    for (const epoch of [-1, 1.5]) {
      expect(() =>
        decodeMembership({
          sharedProjectId: "shared-project-1",
          epoch,
          members: [member(1)],
          updatedAt: "2026-07-30T00:00:00.000Z",
        }),
      ).toThrow();
    }

    for (const invalidTimestamp of [
      "2026-02-30T00:00:00.000Z",
      "2026-07-30T24:00:00.000Z",
      "2026-07-30T00:00:00.000+00:00",
    ]) {
      expect(() =>
        decodeMembership({
          sharedProjectId: "shared-project-1",
          epoch: 1,
          members: [member(1)],
          updatedAt: invalidTimestamp,
        }),
      ).toThrow();
    }
  });

  it("rejects duplicate permissions and permissions above the member role", () => {
    expect(() =>
      decodeMembership({
        sharedProjectId: "shared-project-1",
        epoch: 1,
        members: [
          {
            ...member(1),
            permissions: ["transcript.read", "transcript.read"],
          },
        ],
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      decodeMembership({
        sharedProjectId: "shared-project-1",
        epoch: 1,
        members: [
          {
            ...member(1),
            role: "viewer",
            permissions: ["transcript.read", "project.manage-members"],
          },
        ],
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("keeps the server-owned role permission ceilings immutable", () => {
    expect(Object.isFrozen(COLLABORATION_ROLE_PERMISSIONS)).toBe(true);
    for (const permissions of Object.values(COLLABORATION_ROLE_PERMISSIONS)) {
      expect(Object.isFrozen(permissions)).toBe(true);
    }
  });

  it("round-trips an attributed append-only event envelope", () => {
    const encoded = {
      version: 1 as const,
      sharedProjectId: "shared-project-1",
      sequence: 9,
      eventId: "collaboration-event-9",
      commandId: "collaboration-command-7",
      membershipEpoch: 4,
      actor: {
        kind: "agent" as const,
        userId: "user-1",
        deviceId: "device-1",
        agentId: "agent-1",
      },
      deviceKeyId: "device-key-1",
      type: "task.completed",
      payload: { taskId: "task-1", artifactSha256: "b".repeat(64) },
      payloadSha256: "a".repeat(64),
      previousEventSha256: "b".repeat(64),
      authorSignature: "signature-v1",
      causationEventId: "collaboration-event-8",
      correlationId: "collaboration-command-1",
      occurredAt: "2026-07-30T00:00:01.000Z",
      receivedAt: "2026-07-30T00:00:02.000Z",
    };

    expect(encodeEvent(decodeEvent(encoded))).toEqual(encoded);
  });

  it("accepts only bounded phase-one event proposals with fixed-size signatures", () => {
    const proposal = {
      version: 1 as const,
      sharedProjectId: "shared-project-1",
      eventId: "collaboration-event-9",
      commandId: "collaboration-command-7",
      membershipEpoch: 4,
      actor: {
        kind: "operator" as const,
        userId: "user-1",
        deviceId: "device-1",
      },
      deviceKeyId: "device-key-1",
      type: "operator-chat.message" as const,
      payloadJson: '{"body":"hello"}',
      payloadSha256: "a".repeat(64),
      authorSignature: "A".repeat(COLLABORATION_ED25519_SIGNATURE_BASE64URL_CHARS),
      causationEventId: null,
      correlationId: null,
      occurredAt: "2026-07-30T00:00:01.000Z",
    };

    expect(decodeEventProposal(proposal)).toEqual(proposal);
    expect(() =>
      decodeEventProposal({
        ...proposal,
        type: "client-selected.permission",
      }),
    ).toThrow();
    expect(() =>
      decodeEventProposal({
        ...proposal,
        payloadJson: "x".repeat(COLLABORATION_EVENT_PAYLOAD_MAX_UTF8_BYTES + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeEventProposal({
        ...proposal,
        authorSignature: "A".repeat(COLLABORATION_ED25519_SIGNATURE_BASE64URL_CHARS - 1),
      }),
    ).toThrow();
    expect(() =>
      decodeEventProposal({
        ...proposal,
        eventId: "x".repeat(COLLABORATION_IDENTIFIER_MAX_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeEventProposal({
        ...proposal,
        deviceKeyId: "x".repeat(COLLABORATION_IDENTIFIER_MAX_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeEventProposal({
        ...proposal,
        sharedProjectId: " shared-project-1",
      }),
    ).toThrow();
    expect(() =>
      decodeEventProposal({
        ...proposal,
        occurredAt: "2026-07-30T00:00:01Z",
      }),
    ).toThrow();
    for (const eventId of [
      "event with spaces",
      "event/with/slash",
      "event\u0000suffix",
      "\u00e9",
      "e\u0301",
    ]) {
      expect(() => decodeEventProposal({ ...proposal, eventId })).toThrow();
    }
  });

  it("defines distinct bounded payload contracts for chat and shared prompts", () => {
    expect(decodeChatPayload({ body: "hello" })).toEqual({ body: "hello" });
    expect(decodePromptPayload({ prompt: "continue" })).toEqual({ prompt: "continue" });
    expect(() =>
      decodeChatPayload({ prompt: "wrong event" }, { onExcessProperty: "error" }),
    ).toThrow();
    expect(() =>
      decodePromptPayload({ body: "wrong event" }, { onExcessProperty: "error" }),
    ).toThrow();
    expect(() => decodeChatPayload({ body: "\uD800" })).toThrow();
  });
});
