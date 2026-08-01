import "../../index.css";

import {
  CollaborationAuthoredMessageCommandId,
  CollaborationAuthoredMessageId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
  type CollaborationAuthoredMessage,
  type CollaborationAuthoredMessagePage,
  type CollaborationProjectMember,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { StrictMode } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  SharedOperatorPromptTimeline,
  type SharedOperatorPromptTimelineProps,
} from "./SharedOperatorPromptTimeline.tsx";
import type { SharedOperatorPromptTimelineClient } from "./SharedOperatorPromptTimeline.model.ts";

const projectA = SharedProjectId.make("shared-project-a");
const projectB = SharedProjectId.make("shared-project-b");
const userA = UserId.make("operator-a");
const userB = UserId.make("operator-b");

const participants: readonly CollaborationProjectMember[] = [
  {
    userId: userA,
    displayName: "Aiko",
    role: "owner",
    permissions: ["transcript.read", "transcript.append"],
    joinedAt: "2026-08-01T10:00:00.000Z",
  },
  {
    userId: userB,
    displayName: "Ren",
    role: "operator",
    permissions: ["transcript.read", "transcript.append"],
    joinedAt: "2026-08-01T10:01:00.000Z",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function prompt(input: {
  readonly sequence: number;
  readonly author?: typeof userA;
  readonly body?: string;
  readonly tombstoned?: boolean;
  readonly projectId?: typeof projectA;
}): CollaborationAuthoredMessage {
  const messageId = CollaborationAuthoredMessageId.make(`prompt-${input.sequence}`);
  return {
    sharedProjectId: input.projectId ?? projectA,
    projectSequence: input.sequence,
    operatorSequence: input.sequence,
    messageId,
    kind: "authored-prompt",
    body: input.body ?? `Shared prompt ${input.sequence}`,
    contextInclusion: "eligible",
    authorUserId: input.author ?? userA,
    authorDeviceId: DeviceId.make("device-a"),
    membershipEpoch: CollaborationMembershipEpoch.make(1),
    previousMessageSha256: null,
    messageSha256: CollaborationSha256.make(
      input.sequence.toString(16).padStart(64, "0").slice(-64),
    ),
    occurredAt: DateTime.makeUnsafe(`2026-08-01T12:00:0${input.sequence}.000Z`),
    receivedAt: DateTime.makeUnsafe(`2026-08-01T12:00:0${input.sequence}.100Z`),
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

function promptPage(
  messages: readonly CollaborationAuthoredMessage[] = [],
  input: { readonly projectId?: typeof projectA; readonly hasMore?: boolean } = {},
): CollaborationAuthoredMessagePage {
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
    nextCursor: messages.at(-1)?.projectSequence ?? 0,
    hasMore: input.hasMore ?? false,
  };
}

function panelProps(
  client?: SharedOperatorPromptTimelineClient | null,
): SharedOperatorPromptTimelineProps {
  const base = {
    projectId: projectA,
    currentUserId: userA,
    participants,
  };
  return client === undefined ? base : { ...base, client };
}

describe("SharedOperatorPromptTimeline", () => {
  it("is null-inert without an injected transport", async () => {
    const mounted = await render(<SharedOperatorPromptTimeline {...panelProps()} />);
    try {
      expect(document.querySelector("[data-shared-prompt-project-id]")).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("requests only bounded authored prompts and renders explicit operator attribution", async () => {
    const removedBody = "removed prompt must not remain visible";
    const readAuthoredMessages = vi
      .fn<SharedOperatorPromptTimelineClient["readAuthoredMessages"]>()
      .mockResolvedValue(
        promptPage([
          prompt({ sequence: 1, body: "Plan the shared schema migration." }),
          prompt({ sequence: 2, author: userB, body: removedBody, tombstoned: true }),
        ]),
      );
    const mounted = await render(
      <SharedOperatorPromptTimeline {...panelProps({ readAuthoredMessages })} />,
    );
    try {
      await expect.element(page.getByText("Plan the shared schema migration.")).toBeVisible();
      await expect.element(page.getByLabelText("Prompt from Aiko")).toBeVisible();
      await expect.element(page.getByLabelText("Prompt from Ren")).toBeVisible();
      await expect
        .element(page.getByText("This shared operator prompt was removed."))
        .toBeVisible();
      expect(document.body.textContent).not.toContain(removedBody);
      expect(readAuthoredMessages).toHaveBeenCalledTimes(1);
      expect(readAuthoredMessages.mock.calls[0]![0]).toMatchObject({
        sharedProjectId: projectA,
        afterSequence: 0,
        limit: 50,
        kinds: ["authored-prompt"],
      });
      expect(page.getByRole("button", { name: /send|replay/i }).query()).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("rejects hostile excess payloads without rendering hidden context", async () => {
    const malicious = {
      ...prompt({ sequence: 1, body: "Visible prompt" }),
      providerOutput: "SECRET_PROVIDER_OUTPUT",
      hiddenThreadContext: "SECRET_HIDDEN_CONTEXT",
    };
    const readAuthoredMessages = vi.fn(async () => promptPage([malicious]));
    const mounted = await render(
      <SharedOperatorPromptTimeline {...panelProps({ readAuthoredMessages })} />,
    );
    try {
      await expect.element(page.getByText("No prompt history was admitted.")).toBeVisible();
      expect(document.body.textContent).not.toContain("Visible prompt");
      expect(document.body.textContent).not.toContain("SECRET_PROVIDER_OUTPUT");
      expect(document.body.textContent).not.toContain("SECRET_HIDDEN_CONTEXT");
    } finally {
      await mounted.unmount();
    }
  });

  it("pages from the exact admitted cursor and does not fetch while offline", async () => {
    const readAuthoredMessages = vi
      .fn<SharedOperatorPromptTimelineClient["readAuthoredMessages"]>()
      .mockResolvedValueOnce(promptPage([prompt({ sequence: 1 })], { hasMore: true }))
      .mockResolvedValueOnce(promptPage([prompt({ sequence: 3, author: userB })]));
    const mounted = await render(
      <SharedOperatorPromptTimeline
        {...panelProps({ readAuthoredMessages })}
        connectionState="offline"
      />,
    );
    try {
      await Promise.resolve();
      expect(readAuthoredMessages).not.toHaveBeenCalled();
      await mounted.rerender(
        <SharedOperatorPromptTimeline
          {...panelProps({ readAuthoredMessages })}
          connectionState="online"
        />,
      );
      await expect.element(page.getByText("Shared prompt 1")).toBeVisible();
      await page.getByRole("button", { name: "Load more shared operator prompts" }).click();
      await expect.element(page.getByText("Shared prompt 3")).toBeVisible();
      expect(readAuthoredMessages).toHaveBeenCalledTimes(2);
      expect(readAuthoredMessages.mock.calls[1]![0]).toMatchObject({ afterSequence: 1 });
    } finally {
      await mounted.unmount();
    }
  });

  it("drops stale project responses and remains StrictMode single-flight", async () => {
    const first = deferred<unknown>();
    const readAuthoredMessages = vi
      .fn<SharedOperatorPromptTimelineClient["readAuthoredMessages"]>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(
        promptPage([prompt({ sequence: 1, projectId: projectB })], { projectId: projectB }),
      );
    const mounted = await render(
      <StrictMode>
        <SharedOperatorPromptTimeline {...panelProps({ readAuthoredMessages })} />
      </StrictMode>,
    );
    try {
      await vi.waitFor(() => expect(readAuthoredMessages).toHaveBeenCalledTimes(1));
      await mounted.rerender(
        <StrictMode>
          <SharedOperatorPromptTimeline
            client={{ readAuthoredMessages }}
            currentUserId={userA}
            participants={participants}
            projectId={projectB}
          />
        </StrictMode>,
      );
      first.resolve(promptPage([prompt({ sequence: 1, body: "STALE_PROJECT_PROMPT" })]));
      await expect.element(page.getByText("Shared prompt 1")).toBeVisible();
      expect(document.body.textContent).not.toContain("STALE_PROJECT_PROMPT");
      expect(readAuthoredMessages).toHaveBeenCalledTimes(2);
    } finally {
      await mounted.unmount();
    }
  });
});
