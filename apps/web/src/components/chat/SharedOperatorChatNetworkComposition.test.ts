import {
  CollaborationNetworkClientError,
  type CollaborationNetworkClient,
} from "@cafecode/client-runtime";
import {
  CollaborationAuthoredMessageCommandId,
  CollaborationAuthoredMessageId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
  type CollaborationAppendAuthoredMessageRequest,
  type CollaborationAuthoredMessage,
  type CollaborationTransportPage,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vitest";

import {
  SharedOperatorChatNetworkCompositionError,
  createSharedOperatorChatNetworkComposition,
} from "./SharedOperatorChatNetworkComposition.ts";

const projectA = SharedProjectId.make("project-a");
const projectB = SharedProjectId.make("project-b");
const userA = UserId.make("operator-a");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function authoredMessage(input: {
  readonly sequence: number;
  readonly projectId?: typeof projectA;
  readonly messageId?: CollaborationAuthoredMessage["messageId"];
  readonly body?: string;
}): CollaborationAuthoredMessage {
  return {
    sharedProjectId: input.projectId ?? projectA,
    projectSequence: input.sequence,
    operatorSequence: input.sequence,
    messageId: input.messageId ?? CollaborationAuthoredMessageId.make(`message-${input.sequence}`),
    kind: "operator-chat",
    body: input.body ?? `message ${input.sequence}`,
    contextInclusion: "eligible",
    authorUserId: userA,
    authorDeviceId: DeviceId.make("device-a"),
    membershipEpoch: CollaborationMembershipEpoch.make(1),
    previousMessageSha256: null,
    messageSha256: CollaborationSha256.make("a".repeat(64)),
    occurredAt: DateTime.makeUnsafe("2026-08-01T12:00:00.000Z"),
    receivedAt: DateTime.makeUnsafe("2026-08-01T12:00:00.100Z"),
    tombstone: null,
  };
}

function transportPage(
  input: {
    readonly messages?: readonly CollaborationAuthoredMessage[];
    readonly projectId?: typeof projectA;
    readonly nextCursor?: string;
    readonly hasMore?: boolean;
  } = {},
): CollaborationTransportPage {
  const messages = input.messages ?? [];
  return {
    sharedProjectId: input.projectId ?? projectA,
    messages,
    mergedOrder: messages.map((message) => message.messageId),
    lanePositions: messages.map((message) => ({
      messageId: message.messageId,
      userId: message.authorUserId,
      projectSequence: message.projectSequence,
      operatorSequence: message.operatorSequence,
    })),
    nextCursor: (input.nextCursor ?? "cursor-next") as never,
    hasMore: input.hasMore ?? false,
  };
}

function networkClient(input: {
  readonly state?: () => "disconnected" | "connecting" | "connected";
  readonly connect?: () => Promise<void>;
  readonly disconnect?: () => void;
  readonly command?: (...args: readonly unknown[]) => Promise<unknown>;
}): CollaborationNetworkClient {
  return {
    state: input.state ?? (() => "connected"),
    connect: input.connect ?? (async () => undefined),
    disconnect: input.disconnect ?? (() => undefined),
    command: (input.command ?? (async () => transportPage())) as never,
    subscribeReplay: vi.fn() as never,
  };
}

function pageRequest(afterSequence = 0) {
  return {
    sharedProjectId: projectA,
    afterSequence,
    limit: 20,
    kinds: ["operator-chat"] as const,
    signal: new AbortController().signal,
  };
}

function appendRequest(): CollaborationAppendAuthoredMessageRequest & {
  readonly signal: AbortSignal;
} {
  return {
    commandId: CollaborationAuthoredMessageCommandId.make("command-a"),
    sharedProjectId: projectA,
    messageId: CollaborationAuthoredMessageId.make("message-a"),
    kind: "operator-chat",
    body: "exact retry body",
    contextInclusion: "eligible",
    occurredAt: DateTime.makeUnsafe("2026-08-01T12:00:00.000Z"),
    signal: new AbortController().signal,
  };
}

describe("shared operator chat network composition", () => {
  it("is inert until explicit connect and publishes explicit lifecycle snapshots", async () => {
    let state: "disconnected" | "connecting" | "connected" = "disconnected";
    const pending = deferred<void>();
    const connect = vi.fn(() => {
      state = "connecting";
      return pending.promise.then(() => {
        state = "connected";
      });
    });
    const disconnect = vi.fn(() => {
      state = "disconnected";
    });
    const composition = createSharedOperatorChatNetworkComposition({
      projectId: projectA,
      networkClient: networkClient({ state: () => state, connect, disconnect }),
    });
    const listener = vi.fn();
    const unsubscribe = composition.subscribe(listener);

    expect(composition.getSnapshot()).toBe("offline");
    expect(connect).not.toHaveBeenCalled();
    const connecting = composition.connect();
    expect(composition.getSnapshot()).toBe("reconnecting");
    pending.resolve();
    await connecting;
    expect(composition.getSnapshot()).toBe("online");
    composition.disconnect();
    expect(composition.getSnapshot()).toBe("offline");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    composition.refreshState();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("bridges only validated numeric checkpoints to opaque transport cursors", async () => {
    const first = authoredMessage({ sequence: 4 });
    const second = authoredMessage({ sequence: 7 });
    const command = vi
      .fn()
      .mockResolvedValueOnce(transportPage({ messages: [first], nextCursor: "cursor-4" }))
      .mockResolvedValueOnce(transportPage({ messages: [second], nextCursor: "cursor-7" }));
    const composition = createSharedOperatorChatNetworkComposition({
      projectId: projectA,
      networkClient: networkClient({ command }),
    });

    const firstPage = await composition.client.readAuthoredMessages(pageRequest());
    expect(firstPage.nextCursor).toBe(4);
    const secondPage = await composition.client.readAuthoredMessages(pageRequest(4));
    expect(secondPage.nextCursor).toBe(7);
    expect(command.mock.calls.map((call) => call[1])).toEqual([
      {
        sharedProjectId: projectA,
        cursor: null,
        limit: 20,
        kinds: ["operator-chat"],
      },
      {
        sharedProjectId: projectA,
        cursor: "cursor-4",
        limit: 20,
        kinds: ["operator-chat"],
      },
    ]);

    await expect(composition.client.readAuthoredMessages(pageRequest(6))).rejects.toMatchObject({
      code: "cursor-unavailable",
    });
    expect(command).toHaveBeenCalledTimes(2);
  });

  it("rejects hostile page project, order, lane, and forward-progress responses", async () => {
    const valid = transportPage({ messages: [authoredMessage({ sequence: 1 })] });
    const hostilePages = [
      { ...valid, sharedProjectId: projectB },
      { ...valid, mergedOrder: [] },
      { ...valid, lanePositions: [{ ...valid.lanePositions[0]!, projectSequence: 99 }] },
      transportPage({ messages: [], hasMore: true }),
      { ...valid, unexpected: "hostile" },
    ];

    for (const hostilePage of hostilePages) {
      const composition = createSharedOperatorChatNetworkComposition({
        projectId: projectA,
        networkClient: networkClient({ command: async () => hostilePage }),
      });
      await expect(composition.client.readAuthoredMessages(pageRequest())).rejects.toBeInstanceOf(
        SharedOperatorChatNetworkCompositionError,
      );
    }
  });

  it("forwards exact append retry fields and strictly correlates its acknowledgement", async () => {
    const request = appendRequest();
    const command = vi.fn(async (_operation, forwarded) =>
      authoredMessage({
        sequence: 1,
        messageId: (forwarded as CollaborationAppendAuthoredMessageRequest).messageId,
        body: (forwarded as CollaborationAppendAuthoredMessageRequest).body,
      }),
    );
    const composition = createSharedOperatorChatNetworkComposition({
      projectId: projectA,
      networkClient: networkClient({ command }),
    });

    await expect(composition.client.appendAuthoredMessage(request)).resolves.toMatchObject({
      disposition: "accepted",
      message: { messageId: request.messageId },
    });
    await expect(composition.client.appendAuthoredMessage(request)).resolves.toMatchObject({
      disposition: "accepted",
      message: { messageId: request.messageId },
    });
    expect(command).toHaveBeenCalledWith(
      "message.append",
      {
        commandId: request.commandId,
        sharedProjectId: request.sharedProjectId,
        messageId: request.messageId,
        kind: request.kind,
        body: request.body,
        contextInclusion: request.contextInclusion,
        occurredAt: request.occurredAt,
      },
      { signal: request.signal },
    );
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[1]).toEqual(command.mock.calls[0]);

    const hostile = createSharedOperatorChatNetworkComposition({
      projectId: projectA,
      networkClient: networkClient({
        command: async () =>
          authoredMessage({
            sequence: 1,
            messageId: CollaborationAuthoredMessageId.make("wrong-message"),
          }),
      }),
    });
    await expect(hostile.client.appendAuthoredMessage(appendRequest())).rejects.toMatchObject({
      code: "protocol-error",
    });
  });

  it("maps only the bounded network conflict code into a conflict disposition", async () => {
    const composition = createSharedOperatorChatNetworkComposition({
      projectId: projectA,
      networkClient: networkClient({
        command: async () => {
          throw new CollaborationNetworkClientError("conflict");
        },
      }),
    });

    await expect(composition.client.appendAuthoredMessage(appendRequest())).resolves.toEqual({
      disposition: "conflict",
      safeCode: "conflict",
    });
  });

  it("collapses unknown failures without exposing their raw text", async () => {
    const composition = createSharedOperatorChatNetworkComposition({
      projectId: projectA,
      networkClient: networkClient({
        command: async () => {
          throw new Error("M:\\private\\credential.json");
        },
      }),
    });
    const failure = composition.client.appendAuthoredMessage(appendRequest());
    await expect(failure).rejects.toMatchObject({ code: "unavailable" });
    await expect(failure).rejects.not.toThrow("credential.json");
  });
});
