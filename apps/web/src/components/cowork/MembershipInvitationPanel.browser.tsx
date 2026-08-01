import "../../index.css";

import { SharedProjectId, UserId } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { CoworkMembershipInvitationPanel } from "../../cowork/CoworkMembershipInvitationPanel.tsx";
import type { MembershipInvitationClient } from "../../cowork/membershipInvitationPanel.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeUserId = Schema.decodeUnknownSync(UserId);
const PROJECT_A = decodeProjectId("membership-browser-a");
const PROJECT_B = decodeProjectId("membership-browser-b");
const OWNER = decodeUserId("owner-browser");

type Mounted = Awaited<ReturnType<typeof render>>;
let mounted: Mounted | null = null;

function readPage(project = PROJECT_A, invitationId = "invite-browser") {
  return {
    snapshot: {
      sharedProjectId: project,
      epoch: 5,
      members: [
        {
          userId: OWNER,
          displayName: "Browser Owner",
          role: "owner",
          permissions: [
            "project.manage-members",
            "project.manage-settings",
            "transcript.read",
            "transcript.append",
            "chat.read",
            "chat.append",
            "task.read",
            "task.manage",
            "agent.dispatch",
            "approval.review",
            "file.read",
            "file.publish",
            "file.apply",
            "file.tombstone",
            "audit.read",
          ],
          joinedAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T12:00:00.000Z",
    },
    revision: 8,
    invitations: [
      {
        invitationId,
        sharedProjectId: project,
        role: "viewer",
        permissions: ["transcript.read", "chat.read", "task.read", "file.read"],
        createdByUserId: OWNER,
        notBefore: "2026-08-01T12:00:00.000Z",
        expiresAt: "2026-08-02T12:00:00.000Z",
      },
    ],
    nextCursor: 8,
    hasMore: false,
  };
}

function clientHarness() {
  const load = vi.fn<MembershipInvitationClient["load"]>(async ({ sharedProjectId }) =>
    readPage(sharedProjectId),
  );
  const revokeInvitation = vi.fn<MembershipInvitationClient["revokeInvitation"]>(async () => ({
    disposition: "applied",
    member: null,
    membershipEpoch: 5,
  }));
  return { client: { load, revokeInvitation }, load, revokeInvitation };
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("CoworkMembershipInvitationPanel", () => {
  it("renders nothing and performs no work without an injected client", async () => {
    mounted = await render(
      <CoworkMembershipInvitationPanel
        client={null}
        sharedProjectId={PROJECT_A}
        actorUserId={OWNER}
      />,
    );

    await expect
      .element(page.getByRole("heading", { name: "Project access" }))
      .not.toBeInTheDocument();
    expect(document.body.textContent?.trim()).toBe("");
  });

  it("renders semantic bounded membership and invitation metadata without secret material", async () => {
    const { client, load } = clientHarness();
    mounted = await render(
      <CoworkMembershipInvitationPanel
        client={client}
        sharedProjectId={PROJECT_A}
        actorUserId={OWNER}
      />,
    );

    await expect.element(page.getByRole("status")).toHaveTextContent("1 member, epoch 5");
    await expect.element(page.getByRole("list", { name: "Project members" })).toBeVisible();
    await expect.element(page.getByText("Browser Owner")).toBeVisible();
    await expect.element(page.getByRole("list", { name: "Pending invitations" })).toBeVisible();
    await expect.element(page.getByText(/viewer invitation invite-browser/)).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Revoke invitation invite-browser" }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("secret");
    expect(load).toHaveBeenCalledWith({ sharedProjectId: PROJECT_A, limit: 100 });
  });

  it("disables duplicate revocation and retries with the same command id", async () => {
    const { client, revokeInvitation } = clientHarness();
    let rejectFirst!: (cause?: unknown) => void;
    revokeInvitation.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        }),
    );
    const createCommandId = vi.fn(() => "browser-command-1");
    mounted = await render(
      <CoworkMembershipInvitationPanel
        client={client}
        sharedProjectId={PROJECT_A}
        actorUserId={OWNER}
        createCommandId={createCommandId}
      />,
    );
    const revoke = page.getByRole("button", { name: "Revoke invitation invite-browser" });
    await expect.element(revoke).toBeVisible();
    await revoke.click();
    await expect
      .element(page.getByRole("button", { name: "Revoking invitation invite-browser" }))
      .toBeDisabled();
    expect(revokeInvitation).toHaveBeenCalledTimes(1);

    rejectFirst(new Error("lost response"));
    const retry = page.getByRole("button", { name: "Retry revoke invitation invite-browser" });
    await expect.element(retry).toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Retry uses the same command");
    await retry.click();

    await expect.element(page.getByText("No pending invitations.")).toBeVisible();
    expect(createCommandId).toHaveBeenCalledTimes(1);
    expect(revokeInvitation.mock.calls[1]![0]).toBe(revokeInvitation.mock.calls[0]![0]);
  });

  it("disambiguates invitation actions and disables other revokes while one is active", async () => {
    const response = readPage();
    response.invitations.push({
      ...response.invitations[0]!,
      invitationId: "invite-browser-2",
    });
    const revokeInvitation = vi.fn<MembershipInvitationClient["revokeInvitation"]>(
      () => new Promise(() => undefined),
    );
    const client: MembershipInvitationClient = {
      load: vi.fn(async () => response),
      revokeInvitation,
    };
    mounted = await render(
      <CoworkMembershipInvitationPanel
        client={client}
        sharedProjectId={PROJECT_A}
        actorUserId={OWNER}
        createCommandId={() => "browser-active-command"}
      />,
    );

    const first = page.getByRole("button", {
      name: "Revoke invitation invite-browser",
      exact: true,
    });
    await expect.element(first).toBeVisible();
    await first.click();

    await expect
      .element(page.getByRole("button", { name: "Revoking invitation invite-browser" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Wait to revoke invitation invite-browser-2" }))
      .toBeDisabled();
    expect(revokeInvitation).toHaveBeenCalledTimes(1);
  });

  it("does not expose a stale StrictMode load after a project switch", async () => {
    const pending: Array<{
      readonly project: typeof PROJECT_A;
      readonly resolve: (value: unknown) => void;
    }> = [];
    const client: MembershipInvitationClient = {
      load: ({ sharedProjectId }) =>
        new Promise((resolve) => pending.push({ project: sharedProjectId, resolve })),
      revokeInvitation: vi.fn(async () => ({
        disposition: "applied",
        member: null,
        membershipEpoch: 5,
      })),
    };
    mounted = await render(
      <StrictMode>
        <CoworkMembershipInvitationPanel
          client={client}
          sharedProjectId={PROJECT_A}
          actorUserId={OWNER}
        />
      </StrictMode>,
    );
    await expect.poll(() => pending.length).toBeGreaterThanOrEqual(1);

    await mounted.rerender(
      <StrictMode>
        <CoworkMembershipInvitationPanel
          client={client}
          sharedProjectId={PROJECT_B}
          actorUserId={OWNER}
        />
      </StrictMode>,
    );
    await expect.poll(() => pending.some(({ project }) => project === PROJECT_B)).toBe(true);
    for (const request of pending.filter(({ project }) => project === PROJECT_A)) {
      request.resolve(readPage(PROJECT_A, "stale-invite"));
    }
    pending
      .find(({ project }) => project === PROJECT_B)!
      .resolve(readPage(PROJECT_B, "current-invite"));

    await expect.element(page.getByText(/current-invite/)).toBeVisible();
    await expect.element(page.getByText(/stale-invite/)).not.toBeInTheDocument();
  });
});
