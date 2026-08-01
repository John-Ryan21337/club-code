import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
  COLLABORATION_PRESENCE_ROSTER_MAX,
  CollaborationPresenceOpenRequest,
  CollaborationPresenceRosterEntry,
  CollaborationPresenceSubscribeRequest,
} from "./collaborationPresence.ts";

const decodeOpenSchema = Schema.decodeUnknownSync(CollaborationPresenceOpenRequest);
const decodeEntrySchema = Schema.decodeUnknownSync(CollaborationPresenceRosterEntry);
const decodeSubscribeSchema = Schema.decodeUnknownSync(CollaborationPresenceSubscribeRequest);
const decodeOpen = (value: unknown) => decodeOpenSchema(value, { onExcessProperty: "error" });
const decodeEntry = (value: unknown) => decodeEntrySchema(value, { onExcessProperty: "error" });
const decodeSubscribe = (value: unknown) =>
  decodeSubscribeSchema(value, { onExcessProperty: "error" });

describe("collaboration presence contracts", () => {
  it("uses a bounded opaque session request and rejects unrepresentable private activity fields", () => {
    const valid = {
      requestId: "presence-open-1",
      sharedProjectId: "presence-project-1",
      state: "online",
      capabilities: ["operator-chat"],
      supersedesSessionId: null,
    };
    expect(decodeOpen(valid)).toMatchObject(valid);
    expect(() => decodeOpen({ ...valid, provider: "private-provider" })).toThrow();
    expect(() =>
      decodeEntry({
        sessionId: "a".repeat(43),
        userId: "operator-1",
        deviceId: "device-1",
        membershipEpoch: 1,
        state: "online",
        capabilities: ["operator-chat"],
        expiresAt: "2026-08-01T12:00:45.000Z",
        prompt: "private prompt",
      }),
    ).toThrow();
  });

  it("caps roster requests at the protocol maximum while documenting the smaller default", () => {
    expect(COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT).toBe(20);
    expect(COLLABORATION_PRESENCE_ROSTER_MAX).toBe(128);
    expect(
      decodeSubscribe({
        sharedProjectId: "presence-project-1",
        sessionId: "a".repeat(43),
        afterVersion: 0,
        rosterLimit: COLLABORATION_PRESENCE_ROSTER_MAX,
      }).rosterLimit,
    ).toBe(COLLABORATION_PRESENCE_ROSTER_MAX);
    expect(() =>
      decodeSubscribe({
        sharedProjectId: "presence-project-1",
        sessionId: "a".repeat(43),
        afterVersion: 0,
        rosterLimit: COLLABORATION_PRESENCE_ROSTER_MAX + 1,
      }),
    ).toThrow();
  });
});
