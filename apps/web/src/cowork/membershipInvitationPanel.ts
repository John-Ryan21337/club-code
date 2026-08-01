import {
  COLLABORATION_EVENT_SEQUENCE_MAX,
  CollaborationInvitationGrant,
  CollaborationMembershipCommandId,
  CollaborationMembershipMutationResult,
  CollaborationProjectMembershipSnapshot,
  CollaborationRevokeInvitationRequest,
  NonNegativeInt,
  collaborationPermissionsFitRole,
  type CollaborationInvitationId,
  type CollaborationProjectMember,
  type CollaborationProjectRole,
  type SharedProjectId,
  type UserId,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const MEMBERSHIP_INVITATION_PAGE_MAX = 100;

const MembershipInvitationReadPage = Schema.Struct({
  snapshot: CollaborationProjectMembershipSnapshot,
  revision: NonNegativeInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_EVENT_SEQUENCE_MAX)),
  invitations: Schema.Array(CollaborationInvitationGrant).check(
    Schema.isMaxLength(MEMBERSHIP_INVITATION_PAGE_MAX),
  ),
  nextCursor: NonNegativeInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_EVENT_SEQUENCE_MAX)),
  hasMore: Schema.Boolean,
}).check(
  Schema.makeFilter((page) => {
    if (page.nextCursor > page.revision) return "invitation cursor must not exceed revision";
    if (page.hasMore && page.invitations.length === 0) {
      return "a continued invitation page must not be empty";
    }
    if (
      page.invitations.some(
        (invitation) =>
          invitation.sharedProjectId !== page.snapshot.sharedProjectId ||
          invitation.role === "owner" ||
          !collaborationPermissionsFitRole(invitation.role, invitation.permissions) ||
          DateTime.toEpochMillis(invitation.expiresAt) <=
            DateTime.toEpochMillis(invitation.notBefore),
      )
    ) {
      return "invitation metadata must be project-scoped and fit its role";
    }
    if (
      new Set(page.invitations.map((invitation) => invitation.invitationId)).size !==
      page.invitations.length
    ) {
      return "invitation metadata must not contain duplicate invitations";
    }
    return undefined;
  }),
);

export interface MembershipInvitationClient {
  readonly load: (input: {
    readonly sharedProjectId: SharedProjectId;
    readonly limit: number;
  }) => Promise<unknown>;
  readonly revokeInvitation: (
    request: Readonly<{
      readonly commandId: string;
      readonly sharedProjectId: SharedProjectId;
      readonly invitationId: CollaborationInvitationId;
    }>,
  ) => Promise<unknown>;
}

export interface MembershipInvitationMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role: CollaborationProjectRole;
  readonly joinedAt: string;
}

export interface MembershipInvitationMetadata {
  readonly invitationId: CollaborationInvitationId;
  readonly role: CollaborationProjectRole;
  readonly createdByUserId: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly permissionCount: number;
  readonly canRevoke: boolean;
  readonly revokeStatus: "idle" | "pending" | "failed";
}

export interface MembershipInvitationPanelState {
  readonly status: "loading" | "ready" | "unavailable";
  readonly sharedProjectId: SharedProjectId;
  readonly epoch: number;
  readonly revision: number;
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly actorRole: CollaborationProjectRole | null;
  readonly members: ReadonlyArray<MembershipInvitationMember>;
  readonly invitations: ReadonlyArray<MembershipInvitationMetadata>;
}

interface LoadedInvitation {
  readonly invitationId: CollaborationInvitationId;
  readonly role: CollaborationProjectRole;
  readonly permissions: ReadonlyArray<CollaborationProjectMember["permissions"][number]>;
  readonly createdByUserId: string;
  readonly notBefore: string;
  readonly expiresAt: string;
}

interface RevokeAttempt {
  readonly request: Readonly<{
    readonly commandId: string;
    readonly sharedProjectId: SharedProjectId;
    readonly invitationId: CollaborationInvitationId;
  }>;
  status: "pending" | "failed";
}

interface ActiveScope {
  readonly generation: number;
  readonly sharedProjectId: SharedProjectId;
  closed: boolean;
}

const roleRank: Readonly<Record<CollaborationProjectRole, number>> = {
  owner: 4,
  admin: 3,
  operator: 2,
  contributor: 1,
  viewer: 0,
};

const decodePageSchema = Schema.decodeUnknownSync(MembershipInvitationReadPage);
const decodeRevokeRequestSchema = Schema.decodeUnknownSync(CollaborationRevokeInvitationRequest);
const decodeMutationSchema = Schema.decodeUnknownSync(CollaborationMembershipMutationResult);
const decodeCommandIdSchema = Schema.decodeUnknownSync(CollaborationMembershipCommandId);
const strictOptions = { onExcessProperty: "error" } as const;
const decodePage = (value: unknown) => decodePageSchema(value, strictOptions);
const decodeRevokeRequest = (value: unknown) => decodeRevokeRequestSchema(value, strictOptions);
const decodeMutation = (value: unknown) => decodeMutationSchema(value, strictOptions);
const decodeCommandId = (value: unknown) => decodeCommandIdSchema(value, strictOptions);

function initialState(sharedProjectId: SharedProjectId): MembershipInvitationPanelState {
  return {
    status: "loading",
    sharedProjectId,
    epoch: 0,
    revision: 0,
    nextCursor: 0,
    hasMore: false,
    actorRole: null,
    members: [],
    invitations: [],
  };
}

function unavailableState(
  sharedProjectId: SharedProjectId,
  previous?: MembershipInvitationPanelState,
): MembershipInvitationPanelState {
  return {
    ...initialState(sharedProjectId),
    status: "unavailable",
    epoch: previous?.sharedProjectId === sharedProjectId ? previous.epoch : 0,
    revision: previous?.sharedProjectId === sharedProjectId ? previous.revision : 0,
  };
}

function cloneMember(member: CollaborationProjectMember): MembershipInvitationMember {
  return Object.freeze({
    userId: String(member.userId),
    displayName: String(member.displayName),
    role: member.role,
    joinedAt: String(member.joinedAt),
  });
}

function cloneInvitation(invitation: typeof CollaborationInvitationGrant.Type): LoadedInvitation {
  return Object.freeze({
    invitationId: invitation.invitationId,
    role: invitation.role,
    permissions: Object.freeze([...invitation.permissions]),
    createdByUserId: String(invitation.createdByUserId),
    notBefore: new Date(DateTime.toEpochMillis(invitation.notBefore)).toISOString(),
    expiresAt: new Date(DateTime.toEpochMillis(invitation.expiresAt)).toISOString(),
  });
}

export class MembershipInvitationPanelModel {
  #state: MembershipInvitationPanelState;
  #active: ActiveScope | null = null;
  #generation = 0;
  #members: ReadonlyArray<MembershipInvitationMember> = [];
  #invitations: ReadonlyArray<LoadedInvitation> = [];
  #actor: CollaborationProjectMember | null = null;
  #attempts = new Map<CollaborationInvitationId, RevokeAttempt>();
  #listeners = new Set<() => void>();

  constructor(
    readonly client: MembershipInvitationClient,
    readonly actorUserId: UserId,
    initialProjectId: SharedProjectId,
  ) {
    this.#state = initialState(initialProjectId);
  }

  readonly getSnapshot = (): MembershipInvitationPanelState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(sharedProjectId: SharedProjectId): void {
    this.stop();
    const scope: ActiveScope = {
      generation: ++this.#generation,
      sharedProjectId,
      closed: false,
    };
    this.#active = scope;
    this.#members = [];
    this.#invitations = [];
    this.#actor = null;
    this.#attempts.clear();
    this.#setState(initialState(sharedProjectId));
    void this.#load(scope);
  }

  stop(): void {
    if (this.#active) this.#active.closed = true;
    this.#active = null;
    this.#attempts.clear();
  }

  revokeInvitation(invitationId: CollaborationInvitationId, createCommandId: () => string): void {
    const scope = this.#active;
    if (!scope || scope.closed || this.#state.status !== "ready") return;
    const invitation = this.#invitations.find(
      (candidate) => candidate.invitationId === invitationId,
    );
    if (!invitation || !this.#canRevoke(invitation)) return;

    const previous = this.#attempts.get(invitationId);
    if (previous?.status === "pending") return;

    let attempt = previous;
    if (!attempt) {
      let commandId: string;
      try {
        commandId = decodeCommandId(createCommandId());
      } catch {
        return;
      }
      const request = decodeRevokeRequest({
        commandId,
        sharedProjectId: scope.sharedProjectId,
        invitationId,
      });
      attempt = { request: Object.freeze({ ...request }), status: "pending" };
      this.#attempts.set(invitationId, attempt);
    } else {
      attempt.status = "pending";
    }
    this.#publishReady();
    void this.#revoke(scope, invitation, attempt);
  }

  async #load(scope: ActiveScope): Promise<void> {
    try {
      const input = Object.freeze({
        sharedProjectId: scope.sharedProjectId,
        limit: MEMBERSHIP_INVITATION_PAGE_MAX,
      });
      const decoded = decodePage(await this.client.load(input));
      if (!this.#isActive(scope) || decoded.snapshot.sharedProjectId !== scope.sharedProjectId) {
        return;
      }
      const actor = decoded.snapshot.members.find((member) => member.userId === this.actorUserId);
      if (!actor) throw new Error("current actor is not a project member");

      this.#actor = Object.freeze({
        ...actor,
        permissions: Object.freeze([...actor.permissions]),
      });
      this.#members = Object.freeze(decoded.snapshot.members.map(cloneMember));
      this.#invitations = Object.freeze(decoded.invitations.map(cloneInvitation));
      this.#state = Object.freeze({
        status: "ready",
        sharedProjectId: scope.sharedProjectId,
        epoch: decoded.snapshot.epoch,
        revision: decoded.revision,
        nextCursor: decoded.nextCursor,
        hasMore: decoded.hasMore,
        actorRole: actor.role,
        members: this.#members,
        invitations: [],
      });
      this.#publishReady();
    } catch {
      if (this.#isActive(scope)) {
        this.#members = [];
        this.#invitations = [];
        this.#actor = null;
        this.#attempts.clear();
        this.#setState(unavailableState(scope.sharedProjectId, this.#state));
      }
    }
  }

  async #revoke(
    scope: ActiveScope,
    invitation: LoadedInvitation,
    attempt: RevokeAttempt,
  ): Promise<void> {
    try {
      const decoded = decodeMutation(await this.client.revokeInvitation(attempt.request));
      if (!this.#isActive(scope) || this.#attempts.get(invitation.invitationId) !== attempt) return;
      if (decoded.member !== null || decoded.membershipEpoch !== this.#state.epoch) {
        throw new Error("stale invitation mutation response");
      }
      this.#attempts.delete(invitation.invitationId);
      this.#invitations = Object.freeze(
        this.#invitations.filter((candidate) => candidate.invitationId !== invitation.invitationId),
      );
      this.#publishReady();
    } catch {
      if (!this.#isActive(scope) || this.#attempts.get(invitation.invitationId) !== attempt) return;
      attempt.status = "failed";
      this.#publishReady();
    }
  }

  #canRevoke(invitation: LoadedInvitation): boolean {
    const actor = this.#actor;
    return (
      actor !== null &&
      (actor.role === "owner" || actor.role === "admin") &&
      actor.permissions.includes("project.manage-members") &&
      roleRank[invitation.role] < roleRank[actor.role]
    );
  }

  #publishReady(): void {
    if (this.#state.status !== "ready") return;
    const invitations = Object.freeze(
      this.#invitations.map((invitation) => {
        const attempt = this.#attempts.get(invitation.invitationId);
        return Object.freeze({
          invitationId: invitation.invitationId,
          role: invitation.role,
          createdByUserId: invitation.createdByUserId,
          notBefore: invitation.notBefore,
          expiresAt: invitation.expiresAt,
          permissionCount: invitation.permissions.length,
          canRevoke: this.#canRevoke(invitation),
          revokeStatus: attempt?.status ?? "idle",
        });
      }),
    );
    this.#setState(Object.freeze({ ...this.#state, members: this.#members, invitations }));
  }

  #isActive(scope: ActiveScope): boolean {
    return !scope.closed && this.#active === scope && scope.generation === this.#generation;
  }

  #setState(state: MembershipInvitationPanelState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
