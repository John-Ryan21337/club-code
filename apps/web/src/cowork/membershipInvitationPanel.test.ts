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

const CREATE_INPUT = Object.freeze({
  role: "viewer" as const,
  permissions: Object.freeze(["transcript.read", "chat.read", "task.read", "file.read"] as const),
  notBeforeDelayMillis: 0,
  lifetimeMillis: 24 * 60 * 60_000,
});

function createResult(
  request: Parameters<NonNullable<MembershipInvitationClient["createInvitation"]>>[0],
  disposition: "created" | "already-applied" = "created",
) {
  return {
    scope: { ...request, permissions: [...request.permissions] },
    result: {
      disposition,
      invitation: invitation(request.sharedProjectId, "invite-created"),
      secret: disposition === "created" ? "A".repeat(43) : null,
    },
  };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("MembershipInvitationPanelModel", () => {
  it("starts with a deeply immutable empty snapshot", () => {
    const { client } = harness();
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    const state = model.getSnapshot();

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.members)).toBe(true);
    expect(Object.isFrozen(state.invitations)).toBe(true);
    expect(Object.isFrozen(state.creation)).toBe(true);
  });

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
    [
      "overlong invitation interval",
      () => ({
        ...page(),
        invitations: [
          {
            ...invitation(),
            expiresAt: "2026-09-01T12:00:00.001Z",
          },
        ],
      }),
    ],
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

  it("rejects inherited or accessor-backed adapter data without invoking the accessor", async () => {
    let accessorReads = 0;
    const accessorPage = page();
    const snapshot = accessorPage.snapshot;
    Object.defineProperty(accessorPage, "snapshot", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return snapshot;
      },
    });
    const inheritedPage = page();
    Object.setPrototypeOf(inheritedPage, { credential: "must-not-be-observed" });
    const load = vi
      .fn<MembershipInvitationClient["load"]>()
      .mockResolvedValueOnce(accessorPage)
      .mockResolvedValueOnce(inheritedPage);
    const { client } = harness(load);
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);

    model.start(PROJECT_A);
    await settle();
    expect(model.getSnapshot().status).toBe("unavailable");
    expect(accessorReads).toBe(0);

    model.start(PROJECT_A);
    await settle();
    expect(model.getSnapshot().status).toBe("unavailable");
  });

  it("publishes deterministic member and invitation ordering", async () => {
    const unordered = page(PROJECT_A, "owner", [
      invitation(PROJECT_A, "invite-2"),
      invitation(PROJECT_A, "invite-1"),
    ]);
    unordered.snapshot.members.reverse();
    const { client } = harness(async () => unordered);
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);

    model.start(PROJECT_A);
    await settle();

    expect(model.getSnapshot().members.map(({ displayName }) => displayName)).toEqual([
      "Project Owner",
      "Project Viewer",
    ]);
    expect(model.getSnapshot().invitations.map(({ invitationId }) => invitationId)).toEqual([
      "invite-1",
      "invite-2",
    ]);
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

  it("permits only one active revoke across the project", async () => {
    const pending = deferred<unknown>();
    const { client, revokeInvitation } = harness(async () =>
      page(PROJECT_A, "owner", [
        invitation(PROJECT_A, "invite-1"),
        invitation(PROJECT_A, "invite-2"),
      ]),
    );
    revokeInvitation.mockImplementationOnce(() => pending.promise);
    const commandFactory = vi
      .fn<() => string>()
      .mockReturnValueOnce("first-command")
      .mockReturnValueOnce("second-command");
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.revokeInvitation("invite-1" as never, commandFactory);
    model.revokeInvitation("invite-2" as never, commandFactory);

    expect(revokeInvitation).toHaveBeenCalledTimes(1);
    expect(commandFactory).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().invitations).toMatchObject([
      { invitationId: "invite-1", revokeBlocked: false, revokeStatus: "pending" },
      { invitationId: "invite-2", revokeBlocked: true, revokeStatus: "idle" },
    ]);
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

  it("refreshes current authority after an indeterminate revoke before allowing retry", async () => {
    const revokedAuthority = page();
    revokedAuthority.snapshot.epoch = 8;
    revokedAuthority.snapshot.members[0] = member("owner-1", "viewer");
    const load = vi
      .fn<MembershipInvitationClient["load"]>()
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(revokedAuthority);
    const { client, revokeInvitation } = harness(load);
    revokeInvitation.mockRejectedValueOnce(new Error("credential=/private/secret"));
    const commandFactory = vi.fn(() => "refresh-command");
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.revokeInvitation("invite-1" as never, commandFactory);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      epoch: 8,
      actorRole: "viewer",
      invitations: [{ invitationId: "invite-1", canRevoke: false, revokeStatus: "idle" }],
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain("credential");
    model.revokeInvitation("invite-1" as never, commandFactory);
    expect(revokeInvitation).toHaveBeenCalledTimes(1);
    expect(commandFactory).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["epoch rollback", 6],
    ["membership change under a reused epoch", 7],
  ])("rejects %s during a failed-revoke authority refresh", async (_name, epoch) => {
    const regressed = page();
    regressed.snapshot.epoch = epoch;
    regressed.snapshot.members[0] = member("owner-1", "viewer");
    const load = vi
      .fn<MembershipInvitationClient["load"]>()
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(regressed);
    const { client, revokeInvitation } = harness(load);
    revokeInvitation.mockRejectedValueOnce(new Error("indeterminate"));
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.revokeInvitation("invite-1" as never, () => "rollback-command");
    await settle();

    expect(model.getSnapshot()).toMatchObject({
      epoch: 7,
      actorRole: "owner",
      invitations: [{ invitationId: "invite-1", canRevoke: true, revokeStatus: "failed" }],
    });
  });

  it("isolates throwing subscribers so loading and other subscribers still progress", async () => {
    const { client } = harness();
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    const observed = vi.fn();
    model.subscribe(() => {
      throw new Error("observer failure");
    });
    model.subscribe(observed);

    expect(() => model.start(PROJECT_A)).not.toThrow();
    await settle();
    expect(model.getSnapshot().status).toBe("ready");
    expect(observed).toHaveBeenCalled();
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

  it("ignores a late failed-revoke authority refresh after stop", async () => {
    const refresh = deferred<unknown>();
    const load = vi
      .fn<MembershipInvitationClient["load"]>()
      .mockResolvedValueOnce(page())
      .mockImplementationOnce(() => refresh.promise);
    const { client, revokeInvitation } = harness(load);
    revokeInvitation.mockRejectedValueOnce(new Error("indeterminate"));
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();
    model.revokeInvitation("invite-1" as never, () => "stopped-refresh-command");
    await settle();
    expect(model.getSnapshot().invitations[0]?.revokeStatus).toBe("refreshing");

    model.stop();
    const stopped = model.getSnapshot();
    refresh.resolve(page());
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

  it("presents a strictly scoped token once and drops it on dismissal", async () => {
    const { client: baseClient } = harness(async () => page(PROJECT_A, "owner", []));
    const createInvitation = vi.fn<NonNullable<MembershipInvitationClient["createInvitation"]>>(
      async (request) => createResult(request),
    );
    const client: MembershipInvitationClient = { ...baseClient, createInvitation };
    const commandFactory = vi.fn(() => "create-command-1");
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.createInvitation(CREATE_INPUT, commandFactory);
    await settle();

    const request = createInvitation.mock.calls[0]![0];
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.permissions)).toBe(true);
    expect(request).toEqual({
      commandId: "create-command-1",
      sharedProjectId: PROJECT_A,
      actorUserId: OWNER,
      expectedMembershipEpoch: 7,
      expectedMembershipRevision: 12,
      ...CREATE_INPUT,
    });
    expect(model.getSnapshot().creation).toEqual({
      status: "presented",
      canCreate: true,
      invitationId: "invite-created",
      secret: "A".repeat(43),
    });

    model.dismissInvitationSecret();
    expect(model.getSnapshot().creation).toEqual({
      status: "idle",
      canCreate: true,
      invitationId: null,
      secret: null,
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain("A".repeat(43));
  });

  it("reuses one exact command after an indeterminate ACK and locks a lost token until revoke", async () => {
    const { client: baseClient, revokeInvitation } = harness(async () =>
      page(PROJECT_A, "owner", []),
    );
    const createInvitation = vi
      .fn<NonNullable<MembershipInvitationClient["createInvitation"]>>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockImplementationOnce(async (request) => createResult(request, "already-applied"));
    const client: MembershipInvitationClient = { ...baseClient, createInvitation };
    const commandFactory = vi.fn(() => "create-command-replay");
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.createInvitation(CREATE_INPUT, commandFactory);
    await settle();
    expect(model.getSnapshot().creation.status).toBe("failed");
    expect(model.getSnapshot().creation.secret).toBeNull();

    model.createInvitation({ ...CREATE_INPUT, lifetimeMillis: 60_000 }, commandFactory);
    await settle();
    expect(commandFactory).toHaveBeenCalledTimes(1);
    expect(createInvitation.mock.calls[1]![0]).toBe(createInvitation.mock.calls[0]![0]);
    expect(model.getSnapshot().creation).toMatchObject({
      status: "lost",
      invitationId: "invite-created",
      secret: null,
      canCreate: false,
    });

    model.createInvitation(CREATE_INPUT, commandFactory);
    expect(createInvitation).toHaveBeenCalledTimes(2);
    model.revokeInvitation("invite-created" as never, () => "revoke-lost-token");
    await settle();
    expect(revokeInvitation).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().creation).toMatchObject({ status: "idle", canCreate: true });
  });

  it("rejects stale or hostile create results without retaining a token", async () => {
    const { client: baseClient } = harness(async () => page(PROJECT_A, "owner", []));
    const client: MembershipInvitationClient = {
      ...baseClient,
      createInvitation: vi.fn(async (request) => ({
        ...createResult(request),
        scope: { ...request, expectedMembershipEpoch: 8 },
      })),
    };
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.createInvitation(CREATE_INPUT, () => "hostile-create-command");
    await settle();
    expect(model.getSnapshot().creation).toMatchObject({
      status: "failed",
      secret: null,
      invitationId: null,
    });
    expect(model.getSnapshot().invitations).toEqual([]);
  });

  it("does not invoke accessors in a create response", async () => {
    let secretReads = 0;
    const { client: baseClient } = harness(async () => page(PROJECT_A, "owner", []));
    const createInvitation = vi.fn<NonNullable<MembershipInvitationClient["createInvitation"]>>(
      async (request) => {
        const response = createResult(request);
        const result = response.result;
        Object.defineProperty(result, "secret", {
          enumerable: true,
          get: () => {
            secretReads += 1;
            return "C".repeat(43);
          },
        });
        return response;
      },
    );
    const client: MembershipInvitationClient = { ...baseClient, createInvitation };
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();

    model.createInvitation(CREATE_INPUT, () => "accessor-create-command");
    await settle();
    expect(secretReads).toBe(0);
    expect(model.getSnapshot().creation).toMatchObject({ status: "failed", secret: null });
  });

  it("drops a presented token on superseding request and ignores late results after context loss", async () => {
    const late = deferred<unknown>();
    const { client: baseClient } = harness(async () => page(PROJECT_A, "owner", []));
    const createInvitation = vi
      .fn<NonNullable<MembershipInvitationClient["createInvitation"]>>()
      .mockImplementationOnce(async (request) => createResult(request))
      .mockImplementationOnce(() => late.promise);
    const client: MembershipInvitationClient = { ...baseClient, createInvitation };
    const model = new MembershipInvitationPanelModel(client, OWNER, PROJECT_A);
    model.start(PROJECT_A);
    await settle();
    model.createInvitation(CREATE_INPUT, () => "first-create-command");
    await settle();
    expect(model.getSnapshot().creation.secret).toBe("A".repeat(43));

    model.createInvitation(CREATE_INPUT, () => "second-create-command");
    expect(model.getSnapshot().creation).toMatchObject({ status: "pending", secret: null });
    const secondRequest = createInvitation.mock.calls[1]![0];
    model.start(PROJECT_B);
    await settle();
    late.resolve(createResult(secondRequest));
    await settle();
    expect(model.getSnapshot().sharedProjectId).toBe(PROJECT_B);
    expect(model.getSnapshot().creation.secret).toBeNull();

    model.stop();
    expect(model.getSnapshot().creation.secret).toBeNull();
  });
});
