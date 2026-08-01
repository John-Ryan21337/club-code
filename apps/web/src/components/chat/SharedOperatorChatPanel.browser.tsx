import "../../index.css";

import {
  CollaborationAuthoredMessageCommandId,
  CollaborationAuthoredMessageId,
  CollaborationContextPacketId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
  type CollaborationAuthoredMessage,
  type CollaborationAuthoredMessagePage,
  type CollaborationContextPacket,
  type CollaborationProjectMember,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { StrictMode } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  SharedOperatorChatPanel,
  type SharedOperatorChatIdFactory,
} from "./SharedOperatorChatPanel.tsx";
import type { SharedOperatorChatClient } from "./SharedOperatorChatPanel.model.ts";

const projectA = SharedProjectId.make("shared-project-a");
const projectB = SharedProjectId.make("shared-project-b");
const userA = UserId.make("operator-a");
const userB = UserId.make("operator-b");
const fixedCommandId = CollaborationAuthoredMessageCommandId.make("fixed-command");
const fixedMessageId = CollaborationAuthoredMessageId.make("fixed-message");
const idFactory: SharedOperatorChatIdFactory = {
  commandId: () => fixedCommandId,
  messageId: () => fixedMessageId,
};

const participants: readonly CollaborationProjectMember[] = [
  {
    userId: userA,
    displayName: "Aiko",
    role: "owner",
    permissions: ["chat.read", "chat.append", "transcript.read"],
    joinedAt: "2026-08-01T10:00:00.000Z",
  },
  {
    userId: userB,
    displayName: "Ren",
    role: "operator",
    permissions: ["chat.read", "chat.append", "transcript.read"],
    joinedAt: "2026-08-01T10:01:00.000Z",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function message(input: {
  readonly sequence: number;
  readonly projectId?: typeof projectA;
  readonly messageId?: CollaborationAuthoredMessage["messageId"];
  readonly author?: typeof userA;
  readonly kind?: CollaborationAuthoredMessage["kind"];
  readonly body?: string;
  readonly tombstoned?: boolean;
}): CollaborationAuthoredMessage {
  const messageId =
    input.messageId ?? CollaborationAuthoredMessageId.make(`message-${input.sequence}`);
  return {
    sharedProjectId: input.projectId ?? projectA,
    projectSequence: input.sequence,
    operatorSequence: input.sequence,
    messageId,
    kind: input.kind ?? "operator-chat",
    body: input.body ?? `shared text ${input.sequence}`,
    contextInclusion: "eligible",
    authorUserId: input.author ?? userA,
    authorDeviceId: DeviceId.make("device-a"),
    membershipEpoch: CollaborationMembershipEpoch.make(1),
    previousMessageSha256: null,
    messageSha256: CollaborationSha256.make("a".repeat(64)),
    occurredAt: DateTime.makeUnsafe(`2026-08-01T12:00:0${Math.min(input.sequence, 9)}.000Z`),
    receivedAt: DateTime.makeUnsafe(`2026-08-01T12:00:0${Math.min(input.sequence, 9)}.100Z`),
    tombstone: input.tombstoned
      ? {
          commandId: CollaborationAuthoredMessageCommandId.make("remove-command"),
          targetMessageId: messageId,
          actorUserId: userB,
          actorDeviceId: DeviceId.make("device-b"),
          membershipEpoch: CollaborationMembershipEpoch.make(1),
          reason: "Removed by project policy.",
          createdAt: DateTime.makeUnsafe("2026-08-01T12:01:00.000Z"),
          recoverable: true,
        }
      : null,
  };
}

function messagePage(
  input: {
    readonly projectId?: typeof projectA;
    readonly messages?: readonly CollaborationAuthoredMessage[];
    readonly nextCursor?: number;
    readonly hasMore?: boolean;
  } = {},
): CollaborationAuthoredMessagePage {
  const messages = input.messages ?? [];
  const projectId = input.projectId ?? projectA;
  return {
    sharedProjectId: projectId,
    messages,
    mergedOrder: messages.map((entry) => entry.messageId),
    lanePositions: messages.map((entry) => ({
      messageId: entry.messageId,
      userId: entry.authorUserId,
      projectSequence: entry.projectSequence,
      operatorSequence: entry.operatorSequence,
    })),
    nextCursor: input.nextCursor ?? Math.max(0, ...messages.map((entry) => entry.projectSequence)),
    hasMore: input.hasMore ?? false,
  };
}

const clientFrom = (input: Partial<SharedOperatorChatClient> = {}): SharedOperatorChatClient => ({
  readAuthoredMessages: input.readAuthoredMessages ?? vi.fn(async () => messagePage()),
  appendAuthoredMessage:
    input.appendAuthoredMessage ??
    vi.fn(async (request) => ({
      disposition: "accepted" as const,
      message: message({ sequence: 1, messageId: request.messageId, body: request.body }),
    })),
});

describe("SharedOperatorChatPanel", () => {
  it("is default-unreachable without an injected collaboration client", async () => {
    const mounted = await render(
      <SharedOperatorChatPanel
        currentUserId={userA}
        participants={participants}
        projectId={projectA}
      />,
    );
    try {
      expect(document.querySelector("[data-shared-project-id]")).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("renders only project-authored chat/prompts in canonical order and hides tombstoned bodies", async () => {
    const secretRemovedBody = "removed private-looking body";
    const first = {
      ...message({
        sequence: 2,
        author: userB,
        kind: "authored-prompt",
        body: "Review the shared migration.",
      }),
      providerOutput: "must never render provider output",
      reconstructedPrivatePrompt: "must never reconstruct a private prompt",
    } as CollaborationAuthoredMessage;
    const second = message({ sequence: 1, body: secretRemovedBody, tombstoned: true });
    const client = clientFrom({
      readAuthoredMessages: vi.fn(async () => messagePage({ messages: [first, second] })),
    });
    const mounted = await render(
      <SharedOperatorChatPanel
        client={client}
        currentUserId={userA}
        participants={participants}
        projectId={projectA}
      />,
    );
    try {
      await expect.element(page.getByText("Review the shared migration.")).toBeVisible();
      await expect
        .element(page.getByText("This shared authored message was removed."))
        .toBeVisible();
      expect(document.body.textContent).not.toContain(secretRemovedBody);
      expect(document.body.textContent).not.toContain("must never render provider output");
      expect(document.body.textContent).not.toContain("must never reconstruct a private prompt");
      const rows = [...document.querySelectorAll("[data-message-id]")];
      expect(rows.map((row) => row.getAttribute("data-message-id"))).toEqual([
        "message-1",
        "message-2",
      ]);
      await expect.element(page.getByLabelText("Shared prompt from Ren")).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("queues offline and reconnects with the exact same idempotent request", async () => {
    const appendAuthoredMessage = vi.fn(async (request) => ({
      disposition: "accepted" as const,
      message: message({ sequence: 1, messageId: request.messageId, body: request.body }),
    }));
    const client = clientFrom({ appendAuthoredMessage });
    const mounted = await render(
      <SharedOperatorChatPanel
        client={client}
        connectionState="offline"
        currentUserId={userA}
        idFactory={idFactory}
        participants={participants}
        projectId={projectA}
      />,
    );
    try {
      await page.getByLabelText("Message project operators").fill("Safe offline message");
      await page.getByRole("button", { name: "Send shared operator message" }).click();
      expect(appendAuthoredMessage).not.toHaveBeenCalled();
      await expect.element(page.getByText("retry", { exact: true })).toBeVisible();

      await mounted.rerender(
        <SharedOperatorChatPanel
          client={client}
          connectionState="online"
          currentUserId={userA}
          idFactory={idFactory}
          participants={participants}
          projectId={projectA}
        />,
      );
      await vi.waitFor(() => expect(appendAuthoredMessage).toHaveBeenCalledTimes(1));
      const request = appendAuthoredMessage.mock.calls[0]![0];
      expect(request.commandId).toBe(fixedCommandId);
      expect(request.messageId).toBe(fixedMessageId);
      await expect.element(page.getByText("Accepted.")).toBeVisible();
      await expect.element(page.getByText("Safe offline message")).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("retries an unconfirmed send with identical IDs and never exposes the raw failure", async () => {
    const appendAuthoredMessage = vi
      .fn<SharedOperatorChatClient["appendAuthoredMessage"]>()
      .mockRejectedValueOnce(new Error("M:\\private\\credential.json"))
      .mockImplementationOnce(async (request) => ({
        disposition: "already-accepted",
        message: message({ sequence: 1, messageId: request.messageId, body: request.body }),
      }));
    const client = clientFrom({ appendAuthoredMessage });
    const mounted = await render(
      <SharedOperatorChatPanel
        client={client}
        currentUserId={userA}
        idFactory={idFactory}
        participants={participants}
        projectId={projectA}
      />,
    );
    try {
      await page.getByLabelText("Message project operators").fill("Idempotent retry");
      await page.getByRole("button", { name: "Send shared operator message" }).click();
      await expect.element(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
      expect(document.body.textContent).not.toContain("credential.json");
      await page.getByRole("button", { name: "Retry same request" }).click();
      await vi.waitFor(() => expect(appendAuthoredMessage).toHaveBeenCalledTimes(2));
      const [first, second] = appendAuthoredMessage.mock.calls.map((call) => call[0]);
      expect(second!.commandId).toBe(first!.commandId);
      expect(second!.messageId).toBe(first!.messageId);
      await expect.element(page.getByText("Already accepted.")).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("aborts an old project read and ignores its late page", async () => {
    const projectARead = deferred<CollaborationAuthoredMessagePage>();
    let oldSignal: AbortSignal | null = null;
    const readAuthoredMessages = vi.fn((request) => {
      if (request.sharedProjectId === projectA) {
        oldSignal = request.signal;
        return projectARead.promise;
      }
      return Promise.resolve(
        messagePage({
          projectId: projectB,
          messages: [message({ sequence: 1, projectId: projectB, body: "Project B only" })],
        }),
      );
    });
    const client = clientFrom({ readAuthoredMessages });
    const mounted = await render(
      <SharedOperatorChatPanel
        client={client}
        currentUserId={userA}
        participants={participants}
        projectId={projectA}
      />,
    );
    try {
      await vi.waitFor(() => expect(readAuthoredMessages).toHaveBeenCalledTimes(1));
      await mounted.rerender(
        <SharedOperatorChatPanel
          client={client}
          currentUserId={userA}
          participants={participants}
          projectId={projectB}
        />,
      );
      await vi.waitFor(() => expect(readAuthoredMessages).toHaveBeenCalledTimes(2));
      expect((oldSignal as AbortSignal | null)?.aborted).toBe(true);
      projectARead.resolve(messagePage({ messages: [message({ sequence: 1, body: "Stale A" })] }));
      await expect.element(page.getByText("Project B only")).toBeVisible();
      expect(document.body.textContent).not.toContain("Stale A");
    } finally {
      await mounted.unmount();
    }
  });

  it("admits one initial read under StrictMode and aborts it on unmount", async () => {
    const pending = deferred<CollaborationAuthoredMessagePage>();
    let signal: AbortSignal | null = null;
    const readAuthoredMessages = vi.fn((request) => {
      signal = request.signal;
      return pending.promise;
    });
    const mounted = await render(
      <StrictMode>
        <SharedOperatorChatPanel
          client={clientFrom({ readAuthoredMessages })}
          currentUserId={userA}
          participants={participants}
          projectId={projectA}
        />
      </StrictMode>,
    );
    await vi.waitFor(() => expect(readAuthoredMessages).toHaveBeenCalledTimes(1));
    await mounted.unmount();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    pending.resolve(messagePage());
  });

  it("renders bounded pointer-only context summaries and blocks an oversized roster", async () => {
    const packet: CollaborationContextPacket = {
      sharedProjectId: projectA,
      packetId: CollaborationContextPacketId.make("packet-a"),
      basePacketId: null,
      sources: [
        {
          messageId: CollaborationAuthoredMessageId.make("source-message"),
          projectSequence: 1,
          operatorSequence: 1,
          authorUserId: userA,
          kind: "operator-chat",
          bodySha256: CollaborationSha256.make("b".repeat(64)),
        },
      ],
      excludedSources: [],
      tokenBudget: 1_000,
      estimatedTokens: 25,
      encodedBytes: 100,
      throughSequence: 1,
      packetSha256: CollaborationSha256.make("c".repeat(64)),
      createdByUserId: userA,
      createdByDeviceId: DeviceId.make("device-a"),
      membershipEpoch: CollaborationMembershipEpoch.make(1),
      createdAt: DateTime.makeUnsafe("2026-08-01T12:00:00.000Z"),
    };
    const client = clientFrom();
    const mounted = await render(
      <SharedOperatorChatPanel
        client={client}
        contextPackets={[packet]}
        currentUserId={userA}
        participants={participants}
        projectId={projectA}
      />,
    );
    try {
      await expect.element(page.getByText(/Context packet packet-a/)).toBeVisible();
      expect(document.body.textContent).toContain("source-message");
    } finally {
      await mounted.unmount();
    }

    const oversized = Array.from({ length: 129 }, (_, index) => ({
      ...participants[0]!,
      userId: UserId.make(`operator-${index}`),
      displayName: `Operator ${index}`,
    }));
    const readAuthoredMessages = vi.fn(async () => messagePage());
    const blocked = await render(
      <SharedOperatorChatPanel
        client={clientFrom({ readAuthoredMessages })}
        currentUserId={userA}
        participants={oversized}
        projectId={projectA}
      />,
    );
    try {
      await expect.element(page.getByLabelText("Shared operator chat unavailable")).toBeVisible();
      expect(readAuthoredMessages).not.toHaveBeenCalled();
    } finally {
      await blocked.unmount();
    }
  });
});
