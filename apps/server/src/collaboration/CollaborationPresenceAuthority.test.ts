import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
  type CollaborationPresenceUpdate,
} from "@cafecode/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vitest";

import type { CollaborationDeviceKeyAuthorityShape } from "./CollaborationEventAdmission.ts";
import {
  type CollaborationPresenceAuditEvent,
  CollaborationPresenceError,
  makeCollaborationPresenceAuthority,
} from "./CollaborationPresenceAuthority.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const PROJECT_ID = decodeProjectId("presence-project-1");

function principal(overrides: Record<string, unknown> = {}) {
  return decodePrincipal({
    sessionId: "presence-access-session-1",
    sharedProjectId: PROJECT_ID,
    userId: "operator-1",
    deviceId: "device-1",
    membershipEpoch: 4,
    issuedAt: "2026-08-01T11:59:00.000Z",
    expiresAt: "2026-08-01T12:30:00.000Z",
    ...overrides,
  });
}

function membership(epoch = 4) {
  return decodeMembership({
    sharedProjectId: PROJECT_ID,
    epoch,
    members: [
      {
        userId: "operator-1",
        displayName: "Operator One",
        role: "operator",
        permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
        joinedAt: "2026-08-01T11:00:00.000Z",
      },
    ],
    updatedAt: "2026-08-01T11:00:00.000Z",
  });
}

function openRequest(requestId = "open-1", supersedesSessionId: unknown = null) {
  return {
    requestId,
    sharedProjectId: PROJECT_ID,
    state: "online",
    capabilities: ["operator-chat", "shared-context"],
    supersedesSessionId,
  };
}

function failureCode(effect: Effect.Effect<unknown, CollaborationPresenceError>) {
  return effect.pipe(
    Effect.map(() => "accepted" as const),
    Effect.catch((error) => Effect.succeed(error.code)),
  );
}

function harness(
  overrides: { readonly maxSessionsPerDevice?: number; readonly ttlMillis?: number } = {},
) {
  let currentMembership = membership();
  let deviceActive = true;
  const audit: CollaborationPresenceAuditEvent[] = [];
  const deviceKeyAuthority: CollaborationDeviceKeyAuthorityShape = {
    getActiveEd25519PublicKey: (lookup) =>
      Effect.succeed(
        deviceActive ? { ...lookup, publicKeySpkiDer: new Uint8Array([1, 2, 3]) } : null,
      ),
  };
  const authority = makeCollaborationPresenceAuthority({
    membershipAuthority: { getCurrent: () => Effect.succeed(currentMembership) },
    deviceKeyAuthority,
    auditSink: { record: (event) => Effect.sync(() => void audit.push(event)) },
    auditSecret: new Uint8Array(32).fill(7),
    ...(overrides.maxSessionsPerDevice === undefined
      ? {}
      : { maxSessionsPerDevice: overrides.maxSessionsPerDevice }),
    ...(overrides.ttlMillis === undefined ? {} : { sessionTtlMillis: overrides.ttlMillis }),
  });
  const input = (request: unknown) => ({
    principal: principal(),
    deviceKeyId: "device-key-1",
    request,
  });
  return {
    authority,
    audit,
    input,
    revokeDevice: () => {
      deviceActive = false;
    },
    advanceMembershipEpoch: () => {
      currentMembership = membership(5);
    },
  };
}

describe("CollaborationPresenceAuthority", () => {
  it.effect("uses server-clock heartbeats and exposes only a coarse capability roster", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const { authority, input, audit } = harness();
      const opened = yield* authority.open(input(openRequest()));
      expect(opened.snapshot.version).toBe(1);
      expect(opened.snapshot.entries).toHaveLength(1);
      expect(opened.snapshot.entries[0]).toMatchObject({
        userId: "operator-1",
        deviceId: "device-1",
        state: "online",
        capabilities: ["operator-chat", "shared-context"],
      });
      expect(JSON.stringify(opened.snapshot)).not.toMatch(/path|prompt|provider|output/i);

      yield* TestClock.adjust("20 seconds");
      const afterHeartbeat = yield* authority.heartbeat(
        input({
          requestId: "heartbeat-1",
          sharedProjectId: PROJECT_ID,
          sessionId: opened.sessionId,
          state: "away",
          capabilities: ["operator-chat"],
        }),
      );
      expect(afterHeartbeat.version).toBe(2);
      expect(afterHeartbeat.entries[0]?.state).toBe("away");
      expect(afterHeartbeat.entries[0]?.capabilities).toEqual(["operator-chat"]);
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain("device-key-1");
      expect(JSON.stringify(audit)).not.toContain(PROJECT_ID);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("expires stale sessions on the fake server clock and rejects stale heartbeats", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const { authority, input } = harness({ ttlMillis: 15_000 });
      const opened = yield* authority.open(input(openRequest()));
      expect(DateTime.toEpochMillis(opened.expiresAt) - NOW).toBe(15_000);
      yield* TestClock.adjust("15 seconds");
      yield* authority.sweepExpired();
      expect(
        yield* failureCode(
          authority.heartbeat(
            input({
              requestId: "late-heartbeat",
              sharedProjectId: PROJECT_ID,
              sessionId: opened.sessionId,
              state: "online",
              capabilities: [],
            }),
          ),
        ),
      ).toBe("not-found");
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "replays an open idempotently, enforces per-device capacity, and supersedes reconnects",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const { authority, input } = harness({ maxSessionsPerDevice: 2 });
        const first = yield* authority.open(input(openRequest("open-1")));
        const replayed = yield* authority.open(input(openRequest("open-1")));
        expect(replayed.sessionId).toBe(first.sessionId);
        const second = yield* authority.open(input(openRequest("open-2")));
        expect(yield* failureCode(authority.open(input(openRequest("open-3"))))).toBe(
          "resource-exhausted",
        );
        const replaced = yield* authority.open(input(openRequest("open-4", second.sessionId)));
        expect(replaced.snapshot.entries).toHaveLength(2);
        expect(replaced.snapshot.entries.map((entry) => entry.sessionId)).not.toContain(
          second.sessionId,
        );
        expect(replaced.snapshot.entries.map((entry) => entry.sessionId)).toContain(
          replaced.sessionId,
        );
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps the per-device cap correct when concurrent opens race", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const { authority, input } = harness({ maxSessionsPerDevice: 1 });
      const results = yield* Effect.all(
        [
          authority.open(input(openRequest("concurrent-open-1"))).pipe(
            Effect.map(() => ({ outcome: "accepted" as const })),
            Effect.catch((error) => Effect.succeed({ outcome: error.code })),
          ),
          authority.open(input(openRequest("concurrent-open-2"))).pipe(
            Effect.map(() => ({ outcome: "accepted" as const })),
            Effect.catch((error) => Effect.succeed({ outcome: error.code })),
          ),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.map((result) => result.outcome).toSorted()).toEqual([
        "accepted",
        "resource-exhausted",
      ]);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "removes revoked membership/device sessions immediately through the authority recheck hook",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const { authority, input, advanceMembershipEpoch, revokeDevice } = harness();
        const opened = yield* authority.open(input(openRequest()));
        const updates: CollaborationPresenceUpdate[] = [];
        yield* authority.subscribe({
          ...input({ sharedProjectId: PROJECT_ID, sessionId: opened.sessionId, afterVersion: 0 }),
          consumer: { offer: (update) => (updates.push(update), true) },
        });
        advanceMembershipEpoch();
        yield* authority.recheckProject(PROJECT_ID);
        expect(updates.at(-1)).toMatchObject({
          kind: "delta",
          delta: { removedSessionIds: [opened.sessionId] },
        });

        const reopened = yield* authority.open({
          ...input(openRequest("open-2")),
          principal: principal({ membershipEpoch: 5 }),
        });
        revokeDevice();
        yield* authority.recheckProject(PROJECT_ID);
        expect(
          yield* failureCode(
            authority.heartbeat({
              ...input({
                requestId: "revoked-heartbeat",
                sharedProjectId: PROJECT_ID,
                sessionId: reopened.sessionId,
                state: "online",
                capabilities: [],
              }),
              principal: principal({ membershipEpoch: 5 }),
            }),
          ),
        ).toBe("not-found");
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "fails closed for corrupt requests and drops slow consumers without retaining activity history",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const { authority, input } = harness();
        expect(yield* failureCode(authority.open(input({ sharedProjectId: PROJECT_ID })))).toBe(
          "invalid-request",
        );
        const opened = yield* authority.open(input(openRequest()));
        expect(
          yield* failureCode(
            authority.subscribe({
              ...input({
                sharedProjectId: PROJECT_ID,
                sessionId: opened.sessionId,
                afterVersion: 0,
              }),
              consumer: { offer: () => false },
            }),
          ),
        ).toBe("slow-consumer");
      }).pipe(Effect.provide(TestClock.layer())),
  );
});
