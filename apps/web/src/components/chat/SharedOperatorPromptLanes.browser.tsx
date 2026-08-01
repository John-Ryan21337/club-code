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
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SharedOperatorPromptTimeline } from "./SharedOperatorPromptTimeline.tsx";
import type { SharedOperatorPromptTimelineClient } from "./SharedOperatorPromptTimeline.model.ts";

const projectId = SharedProjectId.make("shared-project-a");
const currentUserId = UserId.make("operator-0");

function participant(index: number): CollaborationProjectMember {
  return {
    userId: UserId.make(`operator-${index}`),
    displayName: `Operator ${index}`,
    role: index === 0 ? "owner" : "operator",
    permissions: ["transcript.read", "transcript.append"],
    joinedAt: `2026-08-01T10:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

function prompt(input: {
  readonly projectSequence: number;
  readonly operatorSequence: number;
  readonly authorIndex?: number;
  readonly authorUserId?: string;
  readonly body: string;
  readonly tombstoned?: boolean;
}): CollaborationAuthoredMessage {
  const messageId = CollaborationAuthoredMessageId.make(`prompt-${input.projectSequence}`);
  const authorUserId = UserId.make(input.authorUserId ?? `operator-${input.authorIndex ?? 0}`);
  return {
    sharedProjectId: projectId,
    projectSequence: input.projectSequence,
    operatorSequence: input.operatorSequence,
    messageId,
    kind: "authored-prompt",
    body: input.body,
    contextInclusion: "eligible",
    authorUserId,
    authorDeviceId: DeviceId.make("device-a"),
    membershipEpoch: CollaborationMembershipEpoch.make(1),
    previousMessageSha256: null,
    messageSha256: CollaborationSha256.make(input.projectSequence.toString(16).padStart(64, "0")),
    occurredAt: DateTime.makeUnsafe(
      `2026-08-01T12:00:${String(input.projectSequence).padStart(2, "0")}.000Z`,
    ),
    receivedAt: DateTime.makeUnsafe(
      `2026-08-01T12:01:${String(input.projectSequence).padStart(2, "0")}.000Z`,
    ),
    tombstone: input.tombstoned
      ? {
          commandId: CollaborationAuthoredMessageCommandId.make("remove-command"),
          targetMessageId: messageId,
          actorUserId: currentUserId,
          actorDeviceId: DeviceId.make("device-b"),
          membershipEpoch: CollaborationMembershipEpoch.make(1),
          reason: "Removed by project policy.",
          createdAt: DateTime.makeUnsafe("2026-08-01T12:02:00.000Z"),
          recoverable: true,
        }
      : null,
  };
}

function promptPage(
  messages: readonly CollaborationAuthoredMessage[],
): CollaborationAuthoredMessagePage {
  return {
    sharedProjectId: projectId,
    messages,
    mergedOrder: messages.map((message) => message.messageId),
    lanePositions: messages.map((message) => ({
      messageId: message.messageId,
      userId: message.authorUserId,
      projectSequence: message.projectSequence,
      operatorSequence: message.operatorSequence,
    })),
    nextCursor: messages.at(-1)?.projectSequence ?? 0,
    hasMore: false,
  };
}

describe("shared operator prompt lanes", () => {
  it("switches explicitly between merged and lane views without opening another read", async () => {
    const removedBody = "REMOVED_PRIVATE_PROMPT_BODY";
    const readAuthoredMessages = vi.fn(async () =>
      promptPage([
        prompt({
          projectSequence: 1,
          operatorSequence: 4,
          authorIndex: 1,
          body: "First lane prompt",
        }),
        prompt({
          projectSequence: 2,
          operatorSequence: 6,
          authorIndex: 1,
          body: removedBody,
          tombstoned: true,
        }),
        prompt({
          projectSequence: 3,
          operatorSequence: 2,
          authorIndex: 0,
          body: "Current operator prompt",
        }),
      ]),
    );
    const mounted = await render(
      <SharedOperatorPromptTimeline
        client={{ readAuthoredMessages }}
        currentUserId={currentUserId}
        participants={[participant(0), participant(1)]}
        projectId={projectId}
      />,
    );
    try {
      await expect.element(page.getByText("First lane prompt")).toBeVisible();
      expect(
        page.getByRole("button", { name: "Merged" }).element().getAttribute("aria-pressed"),
      ).toBe("true");
      await page.getByRole("button", { name: "Side by side" }).click();
      await expect.element(page.getByLabelText("Prompt lane for Operator 1")).toBeVisible();
      await expect.element(page.getByText("Operator prompt #4")).toBeVisible();
      await expect.element(page.getByText("Operator prompt #6")).toBeVisible();
      await expect
        .element(page.getByText("This shared operator prompt was removed."))
        .toBeVisible();
      expect(document.body.textContent).not.toContain(removedBody);
      expect(readAuthoredMessages).toHaveBeenCalledTimes(1);
      expect(page.getByRole("button", { name: /send|replay/i }).query()).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("bounds the side-by-side viewport to twenty selectable roster lanes", async () => {
    const participants = Array.from({ length: 24 }, (_, index) => participant(index));
    const readAuthoredMessages = vi.fn(async () =>
      promptPage([
        prompt({ projectSequence: 1, operatorSequence: 1, authorIndex: 0, body: "Lane zero" }),
        prompt({
          projectSequence: 2,
          operatorSequence: 1,
          authorIndex: 23,
          body: "Lane twenty three",
        }),
      ]),
    );
    const mounted = await render(
      <SharedOperatorPromptTimeline
        client={{ readAuthoredMessages }}
        currentUserId={currentUserId}
        participants={participants}
        projectId={projectId}
      />,
    );
    try {
      await expect.element(page.getByText("Lane zero")).toBeVisible();
      await page.getByRole("button", { name: "Side by side" }).click();
      expect(document.querySelectorAll('[aria-label^="Prompt lane for "]')).toHaveLength(20);
      await expect.element(page.getByLabelText("Prompt lane for Operator 0")).toBeVisible();
      expect(page.getByLabelText("Prompt lane for Operator 23").query()).toBeNull();
      await page.getByLabelText("First visible operator lane").selectOptions("4");
      expect(document.querySelectorAll('[aria-label^="Prompt lane for "]')).toHaveLength(20);
      await expect.element(page.getByLabelText("Prompt lane for Operator 23")).toBeVisible();
      expect(page.getByLabelText("Prompt lane for Operator 0").query()).toBeNull();
      expect(readAuthoredMessages).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps former-operator attribution and prompt bodies in merged mode only", async () => {
    const formerBody = "Former operator retained prompt";
    const readAuthoredMessages = vi.fn(async () =>
      promptPage([
        prompt({
          projectSequence: 1,
          operatorSequence: 1,
          authorUserId: "former-operator",
          body: formerBody,
        }),
      ]),
    );
    const mounted = await render(
      <SharedOperatorPromptTimeline
        client={{ readAuthoredMessages }}
        currentUserId={currentUserId}
        participants={[participant(0)]}
        projectId={projectId}
      />,
    );
    try {
      await expect
        .element(page.getByLabelText("Prompt from Former project operator"))
        .toBeVisible();
      await page.getByRole("button", { name: "Side by side" }).click();
      await expect
        .element(
          page.getByText(
            "1 prompt from former project operators remain available in the merged view.",
          ),
        )
        .toBeVisible();
      expect(document.body.textContent).not.toContain(formerBody);
      expect(readAuthoredMessages).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
    }
  });

  it("synchronously clears lane bodies and resets presentation on roster drift", async () => {
    const nextScope = new Promise<CollaborationAuthoredMessagePage>(() => undefined);
    const readAuthoredMessages = vi
      .fn<SharedOperatorPromptTimelineClient["readAuthoredMessages"]>()
      .mockResolvedValueOnce(
        promptPage([
          prompt({ projectSequence: 1, operatorSequence: 1, body: "PRIOR_ROSTER_BODY" }),
        ]),
      )
      .mockImplementationOnce(() => nextScope);
    const mounted = await render(
      <SharedOperatorPromptTimeline
        client={{ readAuthoredMessages }}
        currentUserId={currentUserId}
        participants={[participant(0)]}
        projectId={projectId}
      />,
    );
    try {
      await expect.element(page.getByText("PRIOR_ROSTER_BODY")).toBeVisible();
      await page.getByRole("button", { name: "Side by side" }).click();
      await mounted.rerender(
        <SharedOperatorPromptTimeline
          client={{ readAuthoredMessages }}
          currentUserId={currentUserId}
          participants={[{ ...participant(0), displayName: "Replacement Name" }]}
          projectId={projectId}
        />,
      );
      expect(document.body.textContent).not.toContain("PRIOR_ROSTER_BODY");
      expect(
        page.getByRole("button", { name: "Merged" }).element().getAttribute("aria-pressed"),
      ).toBe("true");
      await vi.waitFor(() => expect(readAuthoredMessages).toHaveBeenCalledTimes(2));
    } finally {
      await mounted.unmount();
    }
  });
});
