import { SharedProjectId, UserId } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  type MembershipInvitationClient,
  MembershipInvitationPanelModel,
} from "./membershipInvitationPanel.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeUserId = Schema.decodeUnknownSync(UserId);
const PROJECT_A = decodeProjectId("membership-ui-project-a");
const PROJECT_B = decodeProjectId("membership-ui-project-b");
const OWNER = decodeUserId("owner-1");
const VIEWER = decodeUserId("viewer-1");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function member(userId: string, role: "owner" | "admin" | "operator" | "contributor" | "viewer") {
  const permissions =
    role === "owner" || role === "admin"
      ? [
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
        ]
      : ["transcript.read", "chat.read", "task.read", "file.read"];
  return {
    userId,
    displayName: userId === "owner-1" ? "Project Owner" : "Project Viewer",
    role,
    permissions,
    joinedAt: "2026-08-01T12:00:00.000Z",
  };
}

function invitation(project = PROJECT_A, invitationId = "invite-1") {
  return {
    invitationId,
    sharedProjectId: project,
    role: "viewer",
    permissions: ["transcript.read", "chat.read", "task.read", "file.read"],
    createdByUserId: "owner-1",
    notBefore: "2026-08-01T12:00:00.000Z",
    expiresAt: "2026-08-02T12:00:00.000Z",
  };
}

function page(
  project = PROJECT_A,
  actor: "owner" | "viewer" = "owner",
  invitations: ReadonlyArray<ReturnType<typeof invitation>> = [invitation(project)],
) {
  return {
    snapshot: {
      sharedProjectId: project,
      epoch: 7,
      members:
        actor === "owner"
          ? [member("owner-1", "owner"), member("viewer-1", "viewer")]
          : [member("owner-1", "owner"), member("viewer-1", "viewer")],
      updatedAt: "2026-08-01T12:00:00.000Z",
    },
    revision: 12,
    invitations,
    nextCursor: 12,
    hasMore: false,
  };
}

function harness(load: MembershipInvitationClient["load"] = vi.fn(async () => page())) {
  const revokeInvitation = vi.fn<MembershipInvitationClient["revokeInvitation"]>(async () => ({
    disposition: "applied",
    member: null,
    membershipEpoch: 7,
  }));
  const client: MembershipInvitationClient = { load, revokeInvitation };
  return { client, revokeInvitation };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MembershipInvitationPanelModel", () => {
  it("loads a bounded project-scoped snapshot and detaches it from mutable input", async () => {
    const source = page();
    const { client } = harness(async () => source);
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);

    model.start(PROJECT_A);
    await settle();

    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      sharedProjectId: PROJECT_A,
      epoch: 7,
      revision: 12,
      nextCursor: 12,
      actorRole: "owner",
      members: [
        { userId: "owner-1", displayName: "Project Owner", role: "owner" },
        { userId: "viewer-1", displayName: "Project Viewer", role: "viewer" },
      ],
      invitations: [{ invitationId: "invite-1", role: "viewer", canRevoke: true }],
    });

    source.snapshot.members[0]!.displayName = "Hostile mutation";
    source.invitations[0]!.role = "owner";
    expect(model.getSnapshot().members[0]?.displayName).toBe("Project Owner");
    expect(model.getSnapshot().invitations[0]?.role).toBe("viewer");
  });

  it.each([
    ["cross-project invitation", () => page(PROJECT_A, "owner", [invitation(PROJECT_B)])],
    ["duplicate invitation", () => page(PROJECT_A, "owner", [invitation(), invitation()])],
    ["cursor beyond revision", () => ({ ...page(), nextCursor: 13 })],
    ["secret-bearing excess field", () => ({ ...page(), invitationSecret: "do-not-render" })],
    ["unknown actor", () => page()],
  ])("rejects hostile read payload: %s", async (_name, makePayload) => {
    const actor = _name === "unknown actor" ? decodeUserId("not-a-member") : OWNER;
    const { client } = harness(async () => makePayload());
    const model = new MembershipInvitationPanelModel(client, actor, PROJECT_A);

    model.start(PROJECT_A);
    await settle();

    expect(model.getSnapshot()).toMatchObject({
      status: "unavailable",
      members: [],
      invitations: [],
    });
  });

  it("never offers revocation above the current actor role ceiling", async () => {
    const { client, revokeInvitation } = harness(async () => page(PROJECT_A, "viewer"));
    const model = new MembershipInvitationPanelModel(client, VIEWER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    expect(model.getSnapshot().invitations[0]?.canRevoke).toBe(false);
    model.revokeInvitation("invite-1" as never, () => "command-viewer");
    await settle();
    expect(revokeInvitation).not.toHaveBeenCalled();
  });

  it("permits one active revocation and reuses the exact frozen command on retry", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const { client, revokeInvitation } = harness();
    revokeInvitation
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const commandFactory = vi.fn(() => "revoke-command-1");
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.revokeInvitation("invite-1" as never, commandFactory);
    model.revokeInvitation("invite-1" as never, commandFactory);
    expect(revokeInvitation).toHaveBeenCalledTimes(1);
    expect(commandFactory).toHaveBeenCalledTimes(1);
    const firstRequest = revokeInvitation.mock.calls[0]![0];
    expect(firstRequest).toEqual({
      commandId: "revoke-command-1",
      sharedProjectId: PROJECT_A,
      invitationId: "invite-1",
    });
    expect(Object.isFrozen(firstRequest)).toBe(true);

    first.reject(new Error("indeterminate transport"));
    await settle();
    expect(model.getSnapshot().invitations[0]?.revokeStatus).toBe("failed");

    model.revokeInvitation("invite-1" as never, commandFactory);
    expect(revokeInvitation).toHaveBeenCalledTimes(2);
    expect(commandFactory).toHaveBeenCalledTimes(1);
    expect(revokeInvitation.mock.calls[1]![0]).toBe(firstRequest);

    second.resolve({ disposition: "already-applied", member: null, membershipEpoch: 7 });
    await settle();
    expect(model.getSnapshot().invitations).toEqual([]);
  });

  it("fails closed on a stale or hostile mutation response without replacing the command", async () => {
    const { client, revokeInvitation } = harness();
    revokeInvitation.mockResolvedValueOnce({
      disposition: "applied",
      member: null,
      membershipEpoch: 8,
    });
    const commandFactory = vi.fn(() => "stale-command");
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.revokeInvitation("invite-1" as never, commandFactory);
    await settle();
    expect(model.getSnapshot().invitations[0]?.revokeStatus).toBe("failed");

    model.revokeInvitation("invite-1" as never, commandFactory);
    expect(commandFactory).toHaveBeenCalledTimes(1);
    expect(revokeInvitation.mock.calls[1]![0]).toBe(revokeInvitation.mock.calls[0]![0]);
  });

  it("ignores late loads and mutations after a project switch or stop", async () => {
    const loadA = deferred<unknown>();
    const loadB = deferred<unknown>();
    const load = vi
      .fn<MembershipInvitationClient["load"]>()
      .mockImplementationOnce(() => loadA.promise)
      .mockImplementationOnce(() => loadB.promise);
    const { client } = harness(load);
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);

    model.start(PROJECT_A);
    model.start(PROJECT_B);
    loadA.resolve(page(PROJECT_A));
    loadB.resolve(page(PROJECT_B, "owner", [invitation(PROJECT_B, "invite-b")]));
    await settle();
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      sharedProjectId: PROJECT_B,
      invitations: [{ invitationId: "invite-b" }],
    });

    model.stop();
    const before = model.getSnapshot();
    loadA.resolve(page(PROJECT_A));
    await settle();
    expect(model.getSnapshot()).toBe(before);
  });

  it("ignores a late revocation result after stop", async () => {
    const pending = deferred<unknown>();
    const { client, revokeInvitation } = harness();
    revokeInvitation.mockImplementationOnce(() => pending.promise);
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();
    model.revokeInvitation("invite-1" as never, () => "stop-command");
    expect(model.getSnapshot().invitations[0]?.revokeStatus).toBe("pending");

    model.stop();
    const stopped = model.getSnapshot();
    pending.resolve({ disposition: "applied", member: null, membershipEpoch: 7 });
    await settle();
    expect(model.getSnapshot()).toBe(stopped);
  });

  it("does not dispatch a malformed command identifier", async () => {
    const { client, revokeInvitation } = harness();
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.revokeInvitation("invite-1" as never, () => "contains spaces");
    await settle();
    expect(revokeInvitation).not.toHaveBeenCalled();
    expect(model.getSnapshot().invitations[0]?.revokeStatus).toBe("idle");
  });
});
