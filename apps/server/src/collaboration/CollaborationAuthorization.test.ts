import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationPermission,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
} from "@cafecode/contracts";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vitest";

import {
  authorizeCollaborationPermission,
  CollaborationAuthorizationError,
  CollaborationMembershipAuthority,
  type CollaborationAuthorizationFailureReason,
  type CollaborationAuthorizationInput,
  type CollaborationMembershipAuthorityShape,
} from "./CollaborationAuthorization.ts";

const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodePermission = Schema.decodeUnknownSync(CollaborationPermission);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);

const PROJECT_ID = decodeProjectId("shared-project-1");
const OTHER_PROJECT_ID = decodeProjectId("shared-project-2");
const NOW_EPOCH_MILLIS = Date.parse("2026-07-30T12:00:00.000Z");

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

function authority(
  getCurrent: CollaborationMembershipAuthorityShape["getCurrent"] = () =>
    Effect.succeed(membership()),
): CollaborationMembershipAuthorityShape {
  return { getCurrent };
}

function authorize(
  overrides: Partial<CollaborationAuthorizationInput> = {},
  membershipAuthority: CollaborationMembershipAuthorityShape = authority(),
) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW_EPOCH_MILLIS);
    return yield* authorizeCollaborationPermission({
      principal: principal(),
      targetProjectId: PROJECT_ID,
      permission: decodePermission("chat.append"),
      ...overrides,
    });
  }).pipe(Effect.provideService(CollaborationMembershipAuthority, membershipAuthority));
}

function denialReason(
  overrides: Partial<CollaborationAuthorizationInput> = {},
  membershipAuthority?: CollaborationMembershipAuthorityShape,
) {
  return authorizationDenial(authorize(overrides, membershipAuthority));
}

function authorizationDenial<Requirements>(
  effect: Effect.Effect<unknown, CollaborationAuthorizationError, Requirements>,
) {
  return effect.pipe(
    Effect.flatMap(() => Effect.die("Expected collaboration authorization to be denied.")),
    Effect.catch((failure) => {
      expect(failure._tag).toBe("CollaborationAuthorizationError");
      return Effect.succeed(failure.reason);
    }),
  );
}

describe("CollaborationAuthorization", () => {
  it.effect("resolves a grant from the current server-owned membership", () =>
    Effect.gen(function* () {
      const grant = yield* authorize();

      expect(grant.member.userId).toBe("user-1");
      expect(grant.member.role).toBe("operator");
      expect(grant.permission).toBe("chat.append");
    }),
  );

  it.effect("denies every cross-project principal, snapshot, and target combination", () =>
    Effect.gen(function* () {
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
        const effect = authorize(
          {
            principal: principal({ sharedProjectId: entry.principalProjectId }),
            targetProjectId: entry.targetProjectId,
            permission: decodePermission("chat.read"),
          },
          authority(() =>
            Effect.succeed(membership({ sharedProjectId: entry.membershipProjectId })),
          ),
        );

        if (entry.expected === "grant") {
          expect((yield* effect).permission).toBe("chat.read");
        } else {
          expect(yield* authorizationDenial(effect)).toBe("project-mismatch");
        }
      }
    }),
  );

  it.effect("rejects a cross-project principal without looking up the target project", () =>
    Effect.gen(function* () {
      let lookupCount = 0;
      const reason = yield* denialReason(
        {
          principal: principal({ sharedProjectId: OTHER_PROJECT_ID }),
          targetProjectId: PROJECT_ID,
        },
        authority(() => {
          lookupCount += 1;
          return Effect.succeed(membership());
        }),
      );

      expect(reason).toBe("project-mismatch");
      expect(lookupCount).toBe(0);
    }),
  );

  it.effect("maps membership resolution failures to a fail-closed authorization denial", () =>
    Effect.gen(function* () {
      const reason = yield* denialReason(
        {},
        authority(() => Effect.fail(new Error("database unavailable"))),
      );

      expect(reason).toBe("membership-unavailable");
    }),
  );

  it.effect("rejects an invalid runtime lifetime before membership lookup", () =>
    Effect.gen(function* () {
      let lookupCount = 0;
      const validPrincipal = principal();
      const forgedPrincipal = {
        ...validPrincipal,
        expiresAt: DateTime.makeUnsafe("2026-07-30T13:30:00.000Z"),
      } as CollaborationPrincipal;

      const reason = yield* denialReason(
        { principal: forgedPrincipal },
        authority(() => {
          lookupCount += 1;
          return Effect.succeed(membership());
        }),
      );

      expect(reason).toBe("session-lifetime-invalid");
      expect(lookupCount).toBe(0);
    }),
  );

  it.effect("revokes an existing session as soon as the current membership epoch advances", () =>
    Effect.gen(function* () {
      let currentMembership = membership();
      const membershipAuthority = authority(() => Effect.succeed(currentMembership));

      expect((yield* authorize({}, membershipAuthority)).permission).toBe("chat.append");

      currentMembership = membership({ epoch: 5 });
      expect(yield* denialReason({}, membershipAuthority)).toBe("membership-epoch-mismatch");
    }),
  );

  it.effect("uses the server clock and expires a previously valid session at its boundary", () =>
    Effect.gen(function* () {
      const input = {
        principal: principal({
          issuedAt: "2026-07-30T11:30:00.000Z",
          expiresAt: "2026-07-30T12:00:01.000Z",
        }),
      };

      expect((yield* authorize(input)).permission).toBe("chat.append");
      yield* TestClock.setTime(Date.parse("2026-07-30T12:00:01.000Z"));
      const reason = yield* authorizationDenial(
        authorizeCollaborationPermission({
          principal: input.principal,
          targetProjectId: PROJECT_ID,
          permission: decodePermission("chat.append"),
        }).pipe(Effect.provideService(CollaborationMembershipAuthority, authority())),
      );
      expect(reason).toBe("session-expired");
    }),
  );

  for (const { expected, label, overrides } of [
    {
      label: "stale membership epoch",
      overrides: { principal: principal({ membershipEpoch: 3 }) },
      expected: "membership-epoch-mismatch",
    },
    {
      label: "future session",
      overrides: {
        principal: principal({
          issuedAt: "2026-07-30T12:00:00.001Z",
          expiresAt: "2026-07-30T12:30:00.000Z",
        }),
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
    overrides: Partial<CollaborationAuthorizationInput>;
    expected: CollaborationAuthorizationFailureReason;
  }>) {
    it.effect(`fails closed for ${label}`, () =>
      Effect.gen(function* () {
        expect(yield* denialReason(overrides)).toBe(expected);
      }),
    );
  }
});
