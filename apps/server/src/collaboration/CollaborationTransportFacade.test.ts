import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessage,
  CollaborationAuthoredMessagePage,
  CollaborationContextPacket,
  CollaborationCreateContextPacketRequest,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
  type CollaborationTransportPage,
} from "@cafecode/contracts";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { describe, expect } from "vitest";

import type { CollaborationAuthoredMessageStoreShape } from "./CollaborationAuthoredMessageStore.ts";
import type { CollaborationDeviceKeyAuthorityShape } from "./CollaborationEventAdmission.ts";
import type { CollaborationDeviceKeyStoreShape } from "./CollaborationDeviceKeyStore.ts";
import {
  type CollaborationTransportAuditEvent,
  type CollaborationTransportFacadeOptions,
  type CollaborationTransportPrincipalResolver,
  CollaborationTransportError,
  makeCollaborationTransportFacade,
} from "./CollaborationTransportFacade.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeAppend = Schema.decodeUnknownSync(CollaborationAppendAuthoredMessageRequest);
const decodeMessage = Schema.decodeUnknownSync(CollaborationAuthoredMessage);
const encodeMessage = Schema.encodeUnknownSync(CollaborationAuthoredMessage);
const decodePage = Schema.decodeUnknownSync(CollaborationAuthoredMessagePage);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodeContextRequest = Schema.decodeUnknownSync(CollaborationCreateContextPacketRequest);
const decodeContextPacket = Schema.decodeUnknownSync(CollaborationContextPacket);

const PROJECT_ID = decodeProjectId("shared-project-transport-1");
const OTHER_PROJECT_ID = decodeProjectId("shared-project-transport-2");

function principal(projectId = PROJECT_ID) {
  return decodePrincipal({
    sessionId: "transport-session-1",
    sharedProjectId: projectId,
    userId: "operator-1",
    deviceId: "device-1",
    membershipEpoch: 4,
    // @effect/vitest's deterministic clock starts at the Unix epoch.
    issuedAt: "1969-12-31T23:59:00.000Z",
    expiresAt: "1970-01-01T00:30:00.000Z",
  });
}

function appendRequest(body = "shared operator message") {
  return {
    commandId: "transport-command-1",
    sharedProjectId: PROJECT_ID,
    messageId: "transport-message-1",
    kind: "operator-chat",
    body,
    contextInclusion: "eligible",
    occurredAt: new Date().toISOString(),
  } as const;
}

function message(sequence = 1, body = "shared operator message") {
  return decodeMessage({
    sharedProjectId: PROJECT_ID,
    projectSequence: sequence,
    operatorSequence: sequence,
    messageId: `transport-message-${sequence}`,
    kind: "operator-chat",
    body,
    contextInclusion: "eligible",
    authorUserId: "operator-1",
    authorDeviceId: "device-1",
    membershipEpoch: 4,
    previousMessageSha256: null,
    messageSha256: "a".repeat(64),
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    tombstone: null,
  });
}

function page(afterSequence = 0, hasMore = false) {
  const next = afterSequence + 1;
  const nextMessage = message(next);
  const encodedMessage = encodeMessage(nextMessage);
  return decodePage({
    sharedProjectId: PROJECT_ID,
    messages: [encodedMessage],
    mergedOrder: [nextMessage.messageId],
    lanePositions: [
      {
        messageId: nextMessage.messageId,
        userId: nextMessage.authorUserId,
        projectSequence: next,
        operatorSequence: next,
      },
    ],
    nextCursor: next,
    hasMore,
  });
}

function contextRequest() {
  return {
    commandId: "transport-context-command-1",
    sharedProjectId: PROJECT_ID,
    packetId: "transport-context-packet-1",
    basePacketId: null,
    selection: {
      messageIds: ["transport-message-1"],
      sourceKinds: ["operator-chat"],
    },
    tokenBudget: 2_048,
    encodedByteBudget: 8_192,
  } as const;
}

function contextPacket() {
  return decodeContextPacket({
    sharedProjectId: PROJECT_ID,
    packetId: "transport-context-packet-1",
    basePacketId: null,
    sources: [
      {
        messageId: "transport-message-1",
        projectSequence: 1,
        operatorSequence: 1,
        authorUserId: "operator-1",
        kind: "operator-chat",
        bodySha256: "b".repeat(64),
      },
    ],
    excludedSources: [],
    tokenBudget: 2_048,
    estimatedTokens: 24,
    encodedBytes: 24,
    throughSequence: 1,
    packetSha256: "c".repeat(64),
    createdByUserId: "operator-1",
    createdByDeviceId: "device-1",
    membershipEpoch: 4,
    createdAt: new Date().toISOString(),
  });
}

function makeStore(
  overrides: Partial<CollaborationAuthoredMessageStoreShape> = {},
): CollaborationAuthoredMessageStoreShape {
  return {
    append: ({ command }) => Effect.succeed(message(1, decodeAppend(command).body)),
    tombstone: () => Effect.die("not used"),
    page: ({ request }) => Effect.succeed(page(request.afterSequence, false)),
    createContextPacket: () => Effect.die("not used"),
    ...overrides,
  };
}

function makeDeviceKeyStore(
  authority: CollaborationDeviceKeyAuthorityShape,
  overrides: Partial<CollaborationDeviceKeyStoreShape> = {},
): CollaborationDeviceKeyStoreShape {
  return {
    getCurrentDeviceKeyStatus: () => Effect.die("not used"),
    beginEnrollment: () => Effect.die("not used"),
    completeEnrollment: () => Effect.die("not used"),
    revokeKey: () => Effect.die("not used"),
    getActiveEd25519PublicKey: authority.getActiveEd25519PublicKey,
    ...overrides,
  };
}

function makeHarness(overrides: Partial<CollaborationTransportFacadeOptions> = {}) {
  const auditEvents: CollaborationTransportAuditEvent[] = [];
  const trustedPrincipal = principal();
  const principalResolver: CollaborationTransportPrincipalResolver = {
    resolve: () =>
      Effect.succeed({ principal: trustedPrincipal, deviceKeyId: "device-key-1" as never }),
  };
  const membership = decodeMembership({
    sharedProjectId: PROJECT_ID,
    epoch: 4,
    members: [
      {
        userId: "operator-1",
        displayName: "Operator One",
        role: "operator",
        permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
        joinedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
  const deviceKeyAuthority: CollaborationDeviceKeyAuthorityShape = {
    getActiveEd25519PublicKey: (lookup) =>
      Effect.succeed({ ...lookup, publicKeySpkiDer: new Uint8Array([1, 2, 3]) }),
  };
  const deviceKeyStore = makeDeviceKeyStore(deviceKeyAuthority);
  const options: CollaborationTransportFacadeOptions = {
    principalResolver,
    membershipAuthority: { getCurrent: () => Effect.succeed(membership) },
    deviceKeyAuthority,
    deviceKeyStore,
    messageStore: makeStore(),
    auditSink: {
      record: (event) => Effect.sync(() => void auditEvents.push(event)),
    },
    cursorSecret: new Uint8Array(32).fill(7),
    ...overrides,
  };
  return { facade: makeCollaborationTransportFacade(options), auditEvents, trustedPrincipal };
}

function failureCode<A>(effect: Effect.Effect<A, CollaborationTransportError>) {
  return effect.pipe(
    Effect.map(() => "unexpected-success" as const),
    Effect.catch((failure) => Effect.succeed(failure.code)),
  );
}

function currentDeviceStatus() {
  return {
    sharedProjectId: PROJECT_ID,
    userId: "operator-1",
    deviceId: "device-1",
    membershipEpoch: 4,
    status: "active",
    activeKey: {
      deviceKeyId: "device-key-1",
      activatedAt: "2026-08-01T12:00:00.000Z",
    },
  } as const;
}

function revokedDeviceKey(disposition: "revoked" | "already-applied" = "revoked") {
  return {
    disposition,
    key: {
      sharedProjectId: PROJECT_ID,
      userId: "operator-1",
      deviceId: "device-1",
      deviceKeyId: "device-key-1",
      publicKeySpkiDer: "A".repeat(59),
      membershipEpoch: 4,
      activatedAt: "2026-08-01T12:00:00.000Z",
      revokedAt: "2026-08-01T13:00:00.000Z",
    },
  } as const;
}

describe("CollaborationTransportFacade", () => {
  it.effect("resolves current-device status only from opaque authentication", () =>
    Effect.gen(function* () {
      let receivedPrincipal: unknown;
      let receivedRequest: unknown;
      const authority: CollaborationDeviceKeyAuthorityShape = {
        getActiveEd25519PublicKey: (lookup) =>
          Effect.succeed({ ...lookup, publicKeySpkiDer: new Uint8Array([1]) }),
      };
      const { facade, trustedPrincipal } = makeHarness({
        deviceKeyAuthority: authority,
        deviceKeyStore: makeDeviceKeyStore(authority, {
          getCurrentDeviceKeyStatus: (input) => {
            receivedPrincipal = input.principal;
            receivedRequest = input.request;
            return Effect.succeed(currentDeviceStatus() as never);
          },
        }),
      });

      const result = yield* facade.getCurrentDeviceKeyStatus({
        authentication: { token: "opaque", principal: principal(OTHER_PROJECT_ID) },
        request: { sharedProjectId: PROJECT_ID },
      });
      expect(receivedPrincipal).toBe(trustedPrincipal);
      expect(receivedRequest).toEqual({ sharedProjectId: PROJECT_ID });
      expect(Reflect.ownKeys(receivedRequest as object)).toEqual(["sharedProjectId"]);
      expect(result).toMatchObject({
        sharedProjectId: PROJECT_ID,
        userId: "operator-1",
        deviceId: "device-1",
        membershipEpoch: 4,
        status: "active",
        activeKey: { deviceKeyId: "device-key-1" },
      });
    }),
  );

  it.effect("fails closed on forged status selectors and cross-scope store output", () =>
    Effect.gen(function* () {
      let resolutions = 0;
      const authority: CollaborationDeviceKeyAuthorityShape = {
        getActiveEd25519PublicKey: (lookup) =>
          Effect.succeed({ ...lookup, publicKeySpkiDer: new Uint8Array([1]) }),
      };
      const { facade } = makeHarness({
        principalResolver: {
          resolve: () => {
            resolutions += 1;
            return Effect.succeed({ principal: principal(), deviceKeyId: "device-key-1" as never });
          },
        },
        deviceKeyAuthority: authority,
        deviceKeyStore: makeDeviceKeyStore(authority, {
          getCurrentDeviceKeyStatus: () =>
            Effect.succeed({ ...currentDeviceStatus(), userId: "other-user" } as never),
        }),
      });
      expect(
        yield* failureCode(
          facade.getCurrentDeviceKeyStatus({
            authentication: "opaque",
            request: { sharedProjectId: PROJECT_ID, userId: "forged-user" },
          }),
        ),
      ).toBe("invalid-request");
      expect(resolutions).toBe(0);
      expect(
        yield* failureCode(
          facade.getCurrentDeviceKeyStatus({
            authentication: "opaque",
            request: { sharedProjectId: PROJECT_ID },
          }),
        ),
      ).toBe("unavailable");
    }),
  );

  it.effect("self-revokes only the authenticated key and preserves exact command reuse", () =>
    Effect.gen(function* () {
      let keyChecks = 0;
      let revocations = 0;
      const receivedRequests: unknown[] = [];
      const authority: CollaborationDeviceKeyAuthorityShape = {
        getActiveEd25519PublicKey: () => {
          keyChecks += 1;
          return Effect.succeed(null);
        },
      };
      const store = makeDeviceKeyStore(authority, {
        revokeKey: (input) => {
          receivedRequests.push(input.request);
          revocations += 1;
          return Effect.succeed(
            revokedDeviceKey(revocations === 1 ? "revoked" : "already-applied") as never,
          );
        },
      });
      const { facade } = makeHarness({ deviceKeyAuthority: authority, deviceKeyStore: store });
      const request = {
        commandId: "device-revoke-command-1",
        sharedProjectId: PROJECT_ID,
        deviceKeyId: "device-key-1",
      } as const;
      expect(
        (yield* facade.revokeCurrentDeviceKey({ authentication: "opaque", request })).disposition,
      ).toBe("revoked");
      expect(
        (yield* facade.revokeCurrentDeviceKey({ authentication: "opaque", request })).disposition,
      ).toBe("already-applied");
      expect(receivedRequests).toEqual([request, request]);
      expect(keyChecks).toBe(0);

      expect(
        yield* failureCode(
          facade.revokeCurrentDeviceKey({
            authentication: "opaque",
            request: { ...request, deviceKeyId: "other-device-key" },
          }),
        ),
      ).toBe("not-found");
      expect(revocations).toBe(2);
    }),
  );

  it.effect("uses only the resolver-issued principal and emits metadata-only audit", () =>
    Effect.gen(function* () {
      let receivedPrincipal: unknown;
      const secretBody = "do-not-copy-this-prompt-body";
      const secretToken = "bearer-secret-value";
      const { facade, auditEvents, trustedPrincipal } = makeHarness({
        messageStore: makeStore({
          append: ({ principal: received, command }) => {
            receivedPrincipal = received;
            return Effect.succeed(message(1, command.body));
          },
        }),
      });

      const result = yield* facade.append({
        authentication: {
          token: secretToken,
          principal: principal(OTHER_PROJECT_ID),
        },
        request: appendRequest(secretBody),
      });

      expect(receivedPrincipal).toEqual(trustedPrincipal);
      expect(result.body).toBe(secretBody);
      expect(auditEvents).toHaveLength(1);
      const serializedAudit = JSON.stringify(auditEvents);
      expect(serializedAudit).not.toContain(secretBody);
      expect(serializedAudit).not.toContain(secretToken);
      expect(serializedAudit).not.toContain(PROJECT_ID);
      expect(auditEvents[0]?.outcome).toBe("accepted");
    }),
  );

  it.effect(
    "maps cross-project and revoked-device authority failures to one non-enumerating code",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const crossProject = makeHarness({
          principalResolver: {
            resolve: () =>
              Effect.succeed({
                principal: principal(OTHER_PROJECT_ID),
                deviceKeyId: "device-key-1" as never,
              }),
          },
          messageStore: makeStore({
            append: () => {
              calls += 1;
              return Effect.succeed(message());
            },
          }),
        }).facade;
        const revoked = makeHarness({
          deviceKeyAuthority: {
            getActiveEd25519PublicKey: () => Effect.succeed(null),
          },
        }).facade;

        expect(
          yield* failureCode(crossProject.append({ authentication: {}, request: appendRequest() })),
        ).toBe("not-found");
        expect(
          yield* failureCode(revoked.append({ authentication: {}, request: appendRequest() })),
        ).toBe("not-found");
        expect(calls).toBe(0);
      }),
  );

  it.effect("rejects oversized frames before authentication or schema decoding", () =>
    Effect.gen(function* () {
      let resolverCalls = 0;
      const { facade } = makeHarness({
        maxRequestBytes: 256,
        principalResolver: {
          resolve: () => {
            resolverCalls += 1;
            return Effect.fail("must-not-run");
          },
        },
      });
      const code = yield* failureCode(
        facade.append({
          authentication: {},
          request: { ...appendRequest(), body: "x".repeat(1_024) },
        }),
      );
      expect(code).toBe("resource-exhausted");
      expect(resolverCalls).toBe(0);
    }),
  );

  it.effect("suppresses an oversized store response", () =>
    Effect.gen(function* () {
      const { facade } = makeHarness({
        maxRequestBytes: 2_048,
        maxResponseBytes: 256,
        messageStore: makeStore({
          append: () => Effect.succeed(message(1, "response-expansion".repeat(64))),
        }),
      });
      expect(
        yield* failureCode(
          facade.append({ authentication: {}, request: appendRequest("small request") }),
        ),
      ).toBe("resource-exhausted");
    }),
  );

  it.effect("routes tombstones and compact context creation through the bounded store facade", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const packet = contextPacket();
      const { facade } = makeHarness({
        messageStore: makeStore({
          tombstone: () => {
            calls.push("tombstone");
            return Effect.succeed(message());
          },
          createContextPacket: ({ command }) => {
            calls.push(`context:${decodeContextRequest(command).packetId}`);
            return Effect.succeed(packet);
          },
        }),
      });
      yield* facade.tombstone({
        authentication: {},
        request: {
          commandId: "transport-tombstone-command-1",
          sharedProjectId: PROJECT_ID,
          targetMessageId: "transport-message-1",
          targetKind: "operator-chat",
          reason: "operator-requested removal",
        },
      });
      const result = yield* facade.createContextPacket({
        authentication: {},
        request: contextRequest(),
      });
      expect(result.packetId).toBe(packet.packetId);
      expect(calls).toEqual(["tombstone", "context:transport-context-packet-1"]);
    }),
  );

  it.effect("enforces per-project concurrency without an unbounded wait queue", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const { facade } = makeHarness({
        maxProjectConcurrency: 1,
        messageStore: makeStore({
          append: ({ command }) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(message(1, command.body)),
            ),
        }),
      });
      const first = yield* Effect.forkChild(
        facade.append({ authentication: {}, request: appendRequest("first") }),
      );
      yield* Deferred.await(entered);
      expect(
        yield* failureCode(
          facade.append({
            authentication: {},
            request: { ...appendRequest("second"), commandId: "transport-command-2" },
          }),
        ),
      ).toBe("resource-exhausted");
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(first)).body).toBe("first");
    }),
  );

  it.effect("binds opaque cursors to one project and rejects tampering", () =>
    Effect.gen(function* () {
      const { facade } = makeHarness();
      const first = yield* facade.page({
        authentication: {},
        request: {
          sharedProjectId: PROJECT_ID,
          cursor: null,
          kinds: ["operator-chat"],
        },
      });
      const cursor = first.nextCursor;
      const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
      expect(
        yield* failureCode(
          facade.page({
            authentication: {},
            request: {
              sharedProjectId: PROJECT_ID,
              cursor: tampered,
              kinds: ["operator-chat"],
            },
          }),
        ),
      ).toBe("not-found");
      expect(
        yield* failureCode(
          facade.page({
            authentication: {},
            request: {
              sharedProjectId: OTHER_PROJECT_ID,
              cursor,
              kinds: ["operator-chat"],
            },
          }),
        ),
      ).toBe("not-found");
    }),
  );

  it.effect("terminates replay when a bounded downstream consumer is slow", () =>
    Effect.gen(function* () {
      const { facade } = makeHarness({
        messageStore: makeStore({
          page: ({ request }) => Effect.succeed(page(request.afterSequence, true)),
        }),
      });
      const received: CollaborationTransportPage[] = [];
      const code = yield* failureCode(
        facade.replaySubscription({
          authentication: {},
          request: {
            sharedProjectId: PROJECT_ID,
            cursor: null,
            kinds: ["operator-chat"],
            maxBatches: 4,
          },
          consumer: {
            offer: (value) => {
              received.push(value);
              return false;
            },
          },
        }),
      );
      expect(code).toBe("slow-consumer");
      expect(received).toHaveLength(1);
    }),
  );

  it.effect("bounds replay work and honors cancellation before admission", () =>
    Effect.gen(function* () {
      let pageCalls = 0;
      const { facade } = makeHarness({
        messageStore: makeStore({
          page: ({ request }) => {
            pageCalls += 1;
            return Effect.succeed(page(request.afterSequence, true));
          },
        }),
      });
      const replay = yield* facade.replaySubscription({
        authentication: {},
        request: {
          sharedProjectId: PROJECT_ID,
          cursor: null,
          kinds: ["operator-chat"],
          maxBatches: 2,
        },
        consumer: { offer: () => true },
      });
      expect(replay.deliveredBatches).toBe(2);
      expect(replay.caughtUp).toBe(false);
      expect(pageCalls).toBe(2);

      const abort = new AbortController();
      abort.abort();
      expect(
        yield* failureCode(
          facade.append({ authentication: {}, request: appendRequest(), signal: abort.signal }),
        ),
      ).toBe("cancelled");
    }),
  );

  it.effect("interrupts in-flight work and releases project admission", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const neverRelease = yield* Deferred.make<void>();
      let block = true;
      const { facade } = makeHarness({
        maxProjectConcurrency: 1,
        messageStore: makeStore({
          append: ({ command }) =>
            block
              ? Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(neverRelease)),
                  Effect.as(message(1, command.body)),
                )
              : Effect.succeed(message(1, command.body)),
        }),
      });
      const abort = new AbortController();
      const running = yield* Effect.forkChild(
        failureCode(
          facade.append({
            authentication: {},
            request: appendRequest("cancel me"),
            signal: abort.signal,
          }),
        ),
      );
      yield* Deferred.await(entered);
      abort.abort();
      expect(yield* Fiber.join(running)).toBe("cancelled");

      block = false;
      const next = yield* facade.append({
        authentication: {},
        request: { ...appendRequest("after cancellation"), commandId: "transport-command-2" },
      });
      expect(next.body).toBe("after cancellation");
    }),
  );
});
