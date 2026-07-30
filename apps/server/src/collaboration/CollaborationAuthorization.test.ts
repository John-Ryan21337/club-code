import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationPermission,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  authorizeCollaborationPermission,
  type CollaborationAuthorizationFailureReason,
} from "./CollaborationAuthorization.ts";

const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodePermission = Schema.decodeUnknownSync(CollaborationPermission);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);

const PROJECT_ID = decodeProjectId("shared-project-1");
const OTHER_PROJECT_ID = decodeProjectId("shared-project-2");
const NOW = DateTime.makeUnsafe("2026-07-30T12:00:00.000Z");

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
    issuedAt: "2026-07-30T11:00:00.000Z",
    expiresAt: "2026-07-30T13:00:00.000Z",
    ...overrides,
  });
}

async function denialReason(
  overrides: Partial<Parameters<typeof authorizeCollaborationPermission>[0]> = {},
) {
  const failure = await Effect.runPromise(
    Effect.flip(
      authorizeCollaborationPermission({
        principal: principal(),
        membership: membership(),
        targetProjectId: PROJECT_ID,
        permission: decodePermission("chat.append"),
        now: NOW,
        ...overrides,
      }),
    ),
  );

  expect(failure._tag).toBe("CollaborationAuthorizationError");
  return failure.reason;
}

describe("CollaborationAuthorization", () => {
  it("resolves a grant from the current server-owned membership", async () => {
    const grant = await Effect.runPromise(
      authorizeCollaborationPermission({
        principal: principal(),
        membership: membership(),
        targetProjectId: PROJECT_ID,
        permission: decodePermission("chat.append"),
        now: NOW,
      }),
    );

    expect(grant.member.userId).toBe("user-1");
    expect(grant.member.role).toBe("operator");
    expect(grant.permission).toBe("chat.append");
  });

  it("denies every cross-project principal, snapshot, and target combination", async () => {
    const projectIds = [PROJECT_ID, OTHER_PROJECT_ID] as const;
    const matrix = projectIds.flatMap((principalProjectId) =>
      projectIds.flatMap((membershipProjectId) =>
        projectIds.map((targetProjectId) => ({
          principalProjectId,
          membershipProjectId,
          targetProjectId,
          expected:
            principalProjectId === targetProjectId && membershipProjectId === targetProjectId
              ? ("grant" as const)
              : ("deny" as const),
        })),
      ),
    );

    for (const entry of matrix) {
      const effect = authorizeCollaborationPermission({
        principal: principal({ sharedProjectId: entry.principalProjectId }),
        membership: membership({ sharedProjectId: entry.membershipProjectId }),
        targetProjectId: entry.targetProjectId,
        permission: decodePermission("chat.read"),
        now: NOW,
      });

      if (entry.expected === "grant") {
        await expect(Effect.runPromise(effect)).resolves.toMatchObject({
          permission: "chat.read",
        });
      } else {
        await expect(Effect.runPromise(effect)).rejects.toMatchObject({
          reason: "project-mismatch",
        });
      }
    }
  });

  it.each([
    {
      label: "stale membership epoch",
      overrides: { principal: principal({ membershipEpoch: 3 }) },
      expected: "membership-epoch-mismatch",
    },
    {
      label: "future session",
      overrides: {
        principal: principal({ issuedAt: "2026-07-30T12:00:00.001Z" }),
      },
      expected: "session-not-yet-valid",
    },
    {
      label: "expired session",
      overrides: {
        principal: principal({ expiresAt: "2026-07-30T12:00:00.000Z" }),
      },
      expected: "session-expired",
    },
    {
      label: "removed member",
      overrides: { principal: principal({ userId: "removed-user" }) },
      expected: "member-not-found",
    },
    {
      label: "permission outside explicit membership",
      overrides: {
        principal: principal({ userId: "viewer-1" }),
        permission: decodePermission("chat.append"),
      },
      expected: "permission-denied",
    },
  ] satisfies ReadonlyArray<{
    label: string;
    overrides: Partial<Parameters<typeof authorizeCollaborationPermission>[0]>;
    expected: CollaborationAuthorizationFailureReason;
  }>)("fails closed for $label", async ({ expected, overrides }) => {
    await expect(denialReason(overrides)).resolves.toBe(expected);
  });
});
