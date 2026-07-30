import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  COLLABORATION_EVENT_REPLAY_DEFAULT_LIMIT,
  COLLABORATION_EVENT_REPLAY_MAX_LIMIT,
  CollaborationEventReplayPage,
  CollaborationEventReplayRequest,
} from "./collaboration.js";

const decodeRequest = Schema.decodeUnknownSync(CollaborationEventReplayRequest);
const decodePage = Schema.decodeUnknownSync(CollaborationEventReplayPage);

describe("collaboration replay contracts", () => {
  it("admits a project-scoped cursor with an optional bounded page size", () => {
    expect(
      decodeRequest({
        sharedProjectId: "shared-project-1",
        afterSequence: 0,
      }),
    ).toEqual({
      sharedProjectId: "shared-project-1",
      afterSequence: 0,
    });
    expect(COLLABORATION_EVENT_REPLAY_DEFAULT_LIMIT).toBeLessThanOrEqual(
      COLLABORATION_EVENT_REPLAY_MAX_LIMIT,
    );
    expect(() =>
      decodeRequest({
        sharedProjectId: "shared-project-1",
        afterSequence: -1,
      }),
    ).toThrow();
    expect(() =>
      decodeRequest({
        sharedProjectId: "shared-project-1",
        afterSequence: 0,
        limit: COLLABORATION_EVENT_REPLAY_MAX_LIMIT + 1,
      }),
    ).toThrow();
  });

  it("rejects replay pages that exceed the backpressure cap", () => {
    const event = {
      version: 1 as const,
      sharedProjectId: "shared-project-1",
      sequence: 1,
      eventId: "event-1",
      commandId: "command-1",
      membershipEpoch: 1,
      actor: {
        kind: "operator" as const,
        userId: "user-1",
        deviceId: "device-1",
      },
      type: "operator-chat.message",
      payload: { body: "hello" },
      payloadSha256: "a".repeat(64),
      previousEventSha256: null,
      authorSignature: "A".repeat(86),
      causationEventId: null,
      correlationId: null,
      occurredAt: "2026-07-30T12:00:00.000Z",
      receivedAt: "2026-07-30T12:00:01.000Z",
    };
    expect(
      decodePage({
        sharedProjectId: "shared-project-1",
        events: [event],
        nextCursor: 1,
        hasMore: false,
      }).events,
    ).toHaveLength(1);
    expect(() =>
      decodePage({
        sharedProjectId: "shared-project-1",
        events: Array.from({ length: COLLABORATION_EVENT_REPLAY_MAX_LIMIT + 1 }, () => event),
        nextCursor: 1,
        hasMore: true,
      }),
    ).toThrow();
  });
});
